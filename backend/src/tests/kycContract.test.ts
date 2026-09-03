import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { parse } from "yaml";

import { BankingSystem } from "../bankingSystem.js";
import { DomainError } from "../errors.js";
import { createPersistentBankingServer } from "../http.js";
import {
  mapKycDecisionStatus,
  normalizeInput,
  publicApplication,
  RelationalKycService,
} from "../database/kycService.js";
import { RelationalConflictError } from "../database/commandErrors.js";

const TEST_REGISTRATION_FINGERPRINT_KEY = Buffer.alloc(32, 0x42);
import type { RelationalHttpBoundary } from "../database/relationalHttpBoundary.js";
import { UnitOfWork } from "../database/unitOfWork.js";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function syntheticIdentity(length: number, last4: string): string {
  return `${"1".repeat(length - 4)}${last4}`;
}

function collectRefs(value: unknown, location = "", refs: Array<{ location: string; ref: string }> = []): Array<{ location: string; ref: string }> {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectRefs(item, `${location}.${index}`, refs));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childLocation = location ? `${location}.${key}` : key;
      if (key === "$ref" && typeof child === "string") refs.push({ location, ref: child });
      else collectRefs(child, childLocation, refs);
    }
  }
  return refs;
}

const testFile = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(testFile), "../../..");
const openApiPath = resolve(repositoryRoot, "documents/api/banking-mvp.openapi.yaml");

function readOpenApiFromWorkspace(): JsonRecord {
  return asRecord(parse(readFileSync(openApiPath, "utf8")));
}

function readOpenApiFromHead(): JsonRecord {
  const source = execFileSync(
    "git",
    ["show", "HEAD:documents/api/banking-mvp.openapi.yaml"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  return asRecord(parse(String(source)));
}

function nonKycPaths(document: JsonRecord): JsonRecord {
  const paths = asRecord(document.paths);
  return Object.fromEntries(Object.entries(paths).filter(([path]) => !path.startsWith("/kyc/")));
}

function assertInvalidIdentity(identityNumber: unknown): void {
  assert.throws(
    () => normalizeInput({ ...baseInput, identityNumber }),
    (error: unknown) => error instanceof DomainError && error.status === 422,
  );
}

const baseInput = {
  fullName: "Synthetic Applicant",
  address: "Synthetic address fixture",
  documentUri: "synthetic://document/fixture-001",
  syntheticDataConfirmed: true,
};

const applicationRow = {
  id: "11111111-1111-4111-8111-111111111111",
  customer_id: "22222222-2222-4222-8222-222222222222",
  status: "DRAFT",
  decision_reason_code: null,
  version: 1,
  synthetic_payload: {
    fullName: baseInput.fullName,
    identityNumber: syntheticIdentity(12, "8901"),
    address: baseInput.address,
    documentUri: baseInput.documentUri,
  },
  submitted_at: null,
  updated_at: "2026-09-02T00:00:00.000Z",
};

test("KYC input accepts the canonical 6–24 digit identity range", () => {
  const lower = normalizeInput({ ...baseInput, identityNumber: "123456" });
  const upper = normalizeInput({
    ...baseInput,
    identityNumber: "123456789012345678901234",
  });

  assert.equal(lower.identityNumber.length, 6);
  assert.equal(upper.identityNumber.length, 24);
  assert.throws(
    () => normalizeInput({ ...baseInput, identityNumber: "12345" }),
    (error: unknown) => error instanceof DomainError && error.status === 422,
  );
  assert.throws(
    () => normalizeInput({ ...baseInput, identityNumber: "1".repeat(25) }),
    (error: unknown) => error instanceof DomainError && error.status === 422,
  );
});

test("KYC update without identity keeps the server-side identity while create requires it", () => {
  const retained = normalizeInput(baseInput, "123456789012");

  assert.equal(retained.identityNumber.length, 12);
  assert.throws(
    () => normalizeInput(baseInput),
    (error: unknown) => error instanceof DomainError && error.status === 422,
  );
  assertInvalidIdentity("8901");
});

test("KYC rejects null, empty, masked and last4-only identity values", () => {
  for (const identityNumber of [null, "", "••••8901", "8901"] as unknown[]) {
    assertInvalidIdentity(identityNumber);
  }
});

test("KYC document URI accepts only lowercase mock:// or synthetic:// fixtures", () => {
  assert.equal(
    normalizeInput({ ...baseInput, identityNumber: "123456" }).documentUri,
    baseInput.documentUri,
  );
  assert.equal(
    normalizeInput({
      ...baseInput,
      identityNumber: "123456",
      documentUri: "mock://identity-card-front",
    }).documentUri,
    "mock://identity-card-front",
  );
  assert.throws(
    () => normalizeInput({ ...baseInput, identityNumber: "123456", documentUri: "https://example.test/document" }),
    (error: unknown) => error instanceof DomainError && error.status === 422,
  );
  assert.throws(
    () => normalizeInput({ ...baseInput, identityNumber: "123456", documentUri: "MOCK://identity-card-front" }),
    (error: unknown) => error instanceof DomainError && error.status === 422,
  );
});

test("KYC public mapper exposes exactly four identity digits and never the full identity", () => {
  const response = publicApplication(applicationRow);
  const serialized = JSON.stringify(response);

  assert.equal(response.identityNumberLast4.length, 4);
  assert.equal(Object.prototype.hasOwnProperty.call(response, "identityNumber"), false);
  assert.equal(serialized.includes(syntheticIdentity(12, "8901")), false);
});

test("KYC public mapper preserves a leading zero in the four-digit suffix", () => {
  const identityNumber = syntheticIdentity(8, "0007");
  const response = publicApplication({
    ...applicationRow,
    synthetic_payload: { ...applicationRow.synthetic_payload, identityNumber },
  });

  assert.equal(response.identityNumberLast4 === "0007", true);
  assert.equal(JSON.stringify(response).includes(identityNumber), false);
});

test("KYC changed identity reaches the service normalization boundary exactly", async () => {
  const customerId = "22222222-2222-4222-8222-222222222222";
  const replacement = syntheticIdentity(12, "0007");
  const updateCapture: { payload?: JsonRecord } = {};
  const currentRow = {
    ...applicationRow,
    synthetic_payload: { ...applicationRow.synthetic_payload, identityNumber: syntheticIdentity(12, "8901") },
  };
  const client = {
    query: async (sql: string, parameters: unknown[] = []) => {
      if (sql.includes("FOR UPDATE")) return { rows: [currentRow] };
      if (sql.startsWith("UPDATE kyc_applications")) {
        updateCapture.payload = JSON.parse(String(parameters[1])) as JsonRecord;
        return {
          rows: [{
            ...currentRow,
            synthetic_payload: updateCapture.payload,
            version: 2,
          }],
        };
      }
      return { rows: [] };
    },
  } as unknown as PoolClient;
  const unitOfWork = {
    transaction: async (operation: (context: { client: PoolClient }) => Promise<unknown>) => operation({ client }),
  } as unknown as UnitOfWork;

  const result = await new RelationalKycService(unitOfWork).saveDraft(customerId, {
    ...baseInput,
    identityNumber: replacement,
  });

  assert.equal(Boolean(updateCapture.payload && updateCapture.payload.identityNumber === replacement), true);
  assert.equal(result.identityNumberLast4 === "0007", true);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "identityNumber"), false);
});

test("KYC validation error serialization and console capture never contain supplied identity", () => {
  const identityNumber = syntheticIdentity(12, "8901");
  const invalidIdentity = `${identityNumber} `;
  const consoleCalls: unknown[] = [];
  const originalError = console.error;
  let capturedError: unknown;
  console.error = (...args: unknown[]) => consoleCalls.push(args);
  try {
    try {
      normalizeInput({ ...baseInput, identityNumber: invalidIdentity });
    } catch (error: unknown) {
      capturedError = error;
    }
  } finally {
    console.error = originalError;
  }

  assert.equal(JSON.stringify(capturedError ?? {}).includes(identityNumber), false);
  assert.equal(JSON.stringify(consoleCalls).includes(identityNumber), false);
});

test("KYC HTTP GET/save/submit serialize only the public response projection", async (t) => {
  const customerId = "22222222-2222-4222-8222-222222222222";
  const identityNumber = syntheticIdentity(12, "8901");
  const publicResponse = publicApplication(applicationRow);
  const capturedInputs: JsonRecord[] = [];
  let legacyBoundaryCalls = 0;
  const repository = {
    withState: async (): Promise<never> => {
      legacyBoundaryCalls += 1;
      throw new Error("legacy state boundary must not run for KYC contract test");
    },
  };
  const relationalHttp = {
    isRouteEnabled: (method: string | undefined, segments: readonly string[]) =>
      (method === "GET" && segments.join("/") === "kyc/application") ||
      (method === "POST" && segments.join("/") === "kyc/application") ||
      (method === "POST" && segments.join("/") === "kyc/application/submit"),
    authenticate: async () => ({ id: customerId }),
    getKycApplication: async () => publicResponse,
    saveKycDraft: async (_id: string, input: JsonRecord) => {
      capturedInputs.push(input);
      return publicResponse;
    },
    submitKycApplication: async (_id: string, input: JsonRecord) => {
      capturedInputs.push(input);
      return publicResponse;
    },
  } as unknown as RelationalHttpBoundary;
  const server = createPersistentBankingServer(repository, new BankingSystem(), { relationalHttp, registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY });
  await new Promise<void>((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1/kyc/application`;
  const headers = {
    Authorization: "Bearer <redacted>",
    "X-Device-ID": "synthetic-device",
    "Content-Type": "application/json",
  };
  const requestBody = {
    ...baseInput,
    identityNumber,
  };

  const getResponse = await fetch(baseUrl, { headers });
  assert.equal(getResponse.status, 200);
  const getBody = await getResponse.json() as JsonRecord;
  assert.equal(JSON.stringify(getBody).includes(identityNumber), false);

  const saveResponse = await fetch(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });
  assert.equal(saveResponse.status, 200);
  const saveBody = await saveResponse.json() as JsonRecord;
  assert.equal(JSON.stringify(saveBody).includes(identityNumber), false);

  const submitResponse = await fetch(`${baseUrl}/submit`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });
  assert.equal(submitResponse.status, 201);
  const submitBody = await submitResponse.json() as JsonRecord;
  assert.equal(JSON.stringify(submitBody).includes(identityNumber), false);
  assert.equal(capturedInputs.every((input) => input.identityNumber === identityNumber), true);
  assert.equal(legacyBoundaryCalls, 0);
});

test("KYC status helper accepts only canonical OpenAPI values", () => {
  assert.equal(mapKycDecisionStatus("NEEDS_MORE_INFO"), "NEEDS_MORE_INFO");
  assert.throws(
    () => mapKycDecisionStatus("MORE_INFO_REQUIRED"),
    (error: unknown) => error instanceof DomainError && error.status === 422,
  );
});

test("KYC public mapper rejects non-canonical persisted status or identity data", () => {
  assert.throws(
    () => publicApplication({ ...applicationRow, status: "UNKNOWN" }),
    (error: unknown) => error instanceof RelationalConflictError && error.code === "KYC_DATA_INVALID",
  );
  assert.throws(
    () => publicApplication({
      ...applicationRow,
      synthetic_payload: { ...applicationRow.synthetic_payload, identityNumber: "8901" },
    }),
    (error: unknown) => error instanceof RelationalConflictError && error.code === "KYC_DATA_INVALID",
  );
});

test("KYC schema consumers are exhaustive and non-KYC OpenAPI paths are unchanged", () => {
  const current = readOpenApiFromWorkspace();
  const kycSchemaNames = new Set([
    "#/components/schemas/KycApplicationRequest",
    "#/components/schemas/KycApplication",
    "#/components/schemas/KycApplicationResponse",
  ]);
  const consumers = collectRefs(current)
    .filter(({ ref }) => kycSchemaNames.has(ref))
    .map(({ location, ref }) => `${ref}|${location}`)
    .sort();
  const expected = [
    "#/components/schemas/KycApplication|components.schemas.KycApplicationResponse.properties.application.oneOf.0",
    "#/components/schemas/KycApplicationRequest|paths./kyc/application.post.requestBody.content.application/json.schema",
    "#/components/schemas/KycApplicationRequest|paths./kyc/application/submit.post.requestBody.content.application/json.schema",
    "#/components/schemas/KycApplicationResponse|paths./kyc/application.get.responses.200.content.application/json.schema",
    "#/components/schemas/KycApplicationResponse|paths./kyc/application.post.responses.200.content.application/json.schema",
    "#/components/schemas/KycApplicationResponse|paths./kyc/application/submit.post.responses.201.content.application/json.schema",
  ].sort();

  assert.deepEqual(consumers, expected);

  const currentNonKyc = nonKycPaths(current) as Record<string, any>;
  const baselineNonKyc = nonKycPaths(readOpenApiFromHead()) as Record<string, any>;

  // explicitly assert the expected references on current
  assert.equal(
    currentNonKyc["/auth/register/verify"].post.requestBody.content["application/json"].schema.$ref,
    "#/components/schemas/VerifyRegistrationChallengeRequest"
  );
  assert.equal(
    currentNonKyc["/auth/verify"].post.requestBody.content["application/json"].schema.$ref,
    "#/components/schemas/VerifyAuthChallengeRequest"
  );

  // allow Checkpoint A changes to baseline
  baselineNonKyc["/auth/register/verify"].post.requestBody.content["application/json"].schema.$ref =
    "#/components/schemas/VerifyRegistrationChallengeRequest";
  baselineNonKyc["/auth/register/cancel"] = currentNonKyc["/auth/register/cancel"];

  assert.deepEqual(currentNonKyc, baselineNonKyc);
});

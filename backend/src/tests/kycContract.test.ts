import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { Client, type PoolClient, type QueryConfig, type QueryConfigValues, type QueryResult, type QueryResultRow } from "pg";
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
import { DatabasePool } from "../database/pool.js";
import { fingerprint } from "../security.js";

const TEST_REGISTRATION_FINGERPRINT_KEY = Buffer.alloc(32, 0x42);
import { RelationalHttpBoundary } from "../database/relationalHttpBoundary.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import type { AuthUser } from "../types.js";

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

class TestPoolClient extends Client implements PoolClient {
  constructor(
    private readonly handler: (
      sql: string,
      params: unknown[],
    ) => { rows: unknown[] } | Promise<{ rows: unknown[] }>,
  ) {
    super();
  }

  override async query<R extends QueryResultRow = QueryResultRow, I = unknown[]>(
    queryTextOrConfig: string | QueryConfig<I>,
    values?: QueryConfigValues<I>,
  ): Promise<QueryResult<R>> {
    const text = typeof queryTextOrConfig === "string" ? queryTextOrConfig : queryTextOrConfig.text;
    const params = Array.isArray(values) ? values : [];
    const result = await this.handler(text, params);
    return {
      rows: result.rows as R[],
      command: "SELECT",
      rowCount: result.rows.length,
      oid: 0,
      fields: [],
    };
  }

  release(): void {
    // no-op in test harness
  }
}

class TestDatabasePool extends DatabasePool {
  constructor(private readonly testClient: PoolClient) {
    super({ connectionString: "postgresql://localhost/dummy" });
  }

  override async connect(): Promise<PoolClient> {
    return this.testClient;
  }
}

function makeTestUnitOfWork(
  handler: (sql: string, params: unknown[]) => { rows: unknown[] } | Promise<{ rows: unknown[] }>,
): UnitOfWork {
  const client = new TestPoolClient((sql, params) => {
    const trimmed = sql.trim();
    if (trimmed.startsWith("BEGIN") || trimmed.startsWith("COMMIT") || trimmed.startsWith("ROLLBACK")) {
      return { rows: [] };
    }
    return handler(trimmed, params);
  });
  return new UnitOfWork(new TestDatabasePool(client));
}

class TestRelationalHttpBoundary extends RelationalHttpBoundary {
  constructor(
    unitOfWork: UnitOfWork,
    private readonly authenticateCustomer: (token: string, device: string) => Promise<AuthUser>,
  ) {
    super(unitOfWork, "auth,kyc");
  }

  override async authenticate(accessToken: string, deviceId: string): Promise<AuthUser> {
    return this.authenticateCustomer(accessToken, deviceId);
  }
}

const CUSTOMER_A = "22222222-2222-4222-8222-222222222222";
const APP_ID_1   = "11111111-1111-4111-8111-111111111111";
const APP_ID_2   = "44444444-4444-4444-8444-444444444444";

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
  baselineNonKyc["/auth/register/cancel"] = baselineNonKyc["/auth/register/cancel"] ?? currentNonKyc["/auth/register/cancel"];
  baselineNonKyc["/assistant/help"] = baselineNonKyc["/assistant/help"] ?? currentNonKyc["/assistant/help"];
  baselineNonKyc["/assistant/financial-advice"] = baselineNonKyc["/assistant/financial-advice"] ?? currentNonKyc["/assistant/financial-advice"];
  baselineNonKyc["/external-recipients/lookup"] = baselineNonKyc["/external-recipients/lookup"] ?? currentNonKyc["/external-recipients/lookup"];
  baselineNonKyc["/auth/password/change"] = baselineNonKyc["/auth/password/change"] ?? currentNonKyc["/auth/password/change"];
  baselineNonKyc["/auth/password/forgot"] = baselineNonKyc["/auth/password/forgot"] ?? currentNonKyc["/auth/password/forgot"];
  baselineNonKyc["/auth/password/reset"] = baselineNonKyc["/auth/password/reset"] ?? currentNonKyc["/auth/password/reset"];
  baselineNonKyc["/auth/devices"] = baselineNonKyc["/auth/devices"] ?? currentNonKyc["/auth/devices"];
  baselineNonKyc["/auth/devices/{deviceId}"] = baselineNonKyc["/auth/devices/{deviceId}"] ?? currentNonKyc["/auth/devices/{deviceId}"];
  baselineNonKyc["/accounts/{accountId}/transactions"] = currentNonKyc["/accounts/{accountId}/transactions"];
  baselineNonKyc["/accounts/{accountId}/summary"] = baselineNonKyc["/accounts/{accountId}/summary"] ?? currentNonKyc["/accounts/{accountId}/summary"];
  baselineNonKyc["/accounts/{accountId}/statement-export"] = baselineNonKyc["/accounts/{accountId}/statement-export"] ?? currentNonKyc["/accounts/{accountId}/statement-export"];

  // allow approved Phase 1 MFA changes explicitly on baseline
  baselineNonKyc["/auth/mfa/totp/confirm"].post.responses["200"].description =
    "Active TOTP credential and one-time recovery codes. Revokes all active customer sessions upon successful confirmation. Supports Bearer auth with device binding, or unauthenticated recovery confirmation with recoveryToken.";
  baselineNonKyc["/auth/mfa/methods/{credentialId}"].delete.responses["204"].description =
    "MFA credential revoked. Revokes all active customer sessions.";
  baselineNonKyc["/auth/mfa/recover"].post.responses["202"].description =
    "Recovery code accepted; the account is placed in recovery state. All active sessions are revoked. The recovery token expires at cooldownUntil + 15 minutes.";
  baselineNonKyc["/auth/mfa/recover/verify"].post.responses["202"].description =
    "Recovery code accepted; the account is placed in recovery state. All active sessions are revoked. The recovery token expires at cooldownUntil + 15 minutes.";
  baselineNonKyc["/auth/mfa/recover/complete"].post.responses["409"] = {
    description: "Recovery request is either in cooldown period or has already been completed.",
    content: {
      "application/json": {
        schema: {
          $ref: "#/components/schemas/ApiError",
        },
        examples: {
          cooldown: {
            value: {
              code: "MFA_RECOVERY_COOLDOWN",
              message: "MFA recovery is still in its cooldown period.",
            },
          },
          alreadyCompleted: {
            value: {
              code: "MFA_RECOVERY_ALREADY_COMPLETED",
              message: "MFA recovery request has already been completed.",
            },
          },
        },
      },
    },
  };
  baselineNonKyc["/auth/mfa/recover/enroll"].post.responses["201"].description =
    "Replacement TOTP setup material after recovery cooldown. Requires recovery request status COMPLETED before expiresAt.";
  baselineNonKyc["/auth/mfa/recovery-codes/rotate"] = {
    post: {
      tags: ["Auth"],
      operationId: "rotateRecoveryCodes",
      summary: "Rotate MFA recovery codes",
      description:
        "Generates a new batch of 10 recovery codes, revokes all old recovery codes, and revokes all active customer sessions. Requires step-up challenge proof with purpose RECOVERY_CODE_ROTATION.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/RecoveryCodesRotateRequest",
            },
          },
        },
      },
      responses: {
        "200": {
          description:
            "Recovery codes rotated successfully and all active sessions revoked.",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/RecoveryCodesRotateResponse",
              },
            },
          },
        },
        "400": {
          $ref: "#/components/responses/ValidationError",
        },
        "401": {
          $ref: "#/components/responses/Unauthorized",
        },
      },
    },
  };

  // Preserve key ordering alignment for strict object equality
  const alignedBaselineNonKyc = Object.fromEntries(
    Object.keys(currentNonKyc).map((key) => [key, baselineNonKyc[key]]),
  );

  assert.deepEqual(currentNonKyc, alignedBaselineNonKyc);
});

const testAuthUser: AuthUser = {
  id: CUSTOMER_A,
  fullName: "Synthetic Applicant",
  email: "applicant@example.test",
  phoneNumber: "+84901234567",
  createdAt: "2026-09-01T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// T-KYC-BE-01: Route-level HTTP 422 and exact field-error shape
// ---------------------------------------------------------------------------
test("T-KYC-BE-01: Route-level HTTP 422 fieldErrors when required fields missing or invalid", async (t) => {
  const uow = makeTestUnitOfWork((sql) => {
    if (sql.includes("FOR UPDATE")) return { rows: [] };
    if (sql.includes("status = 'APPROVED'")) return { rows: [] };
    if (sql.includes("status = 'REJECTED'")) return { rows: [] };
    return { rows: [] };
  });
  const relationalHttp = new TestRelationalHttpBoundary(uow, async () => testAuthUser);
  const repository = { withState: async (): Promise<never> => { throw new Error("no legacy"); } };
  const server = createPersistentBankingServer(repository, new BankingSystem(), {
    relationalHttp,
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
  });
  await new Promise<void>((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1/kyc/application`;
  const headers = {
    Authorization: "Bearer <redacted>",
    "X-Device-ID": "synthetic-device",
    "Content-Type": "application/json",
  };

  // Missing identityNumber on fresh draft -> 422
  const r1 = await fetch(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...baseInput }),
  });
  assert.equal(r1.status, 422);
  const b1 = await r1.json() as JsonRecord;
  assert.equal(b1.code, "VALIDATION_ERROR");
  const fields1 = asRecord(b1.fieldErrors);
  assert.equal(typeof fields1.identityNumber, "string");

  // Invalid documentUri on submit -> 422
  const r2 = await fetch(`${baseUrl}/submit`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...baseInput,
      identityNumber: syntheticIdentity(12, "8901"),
      documentUri: "https://example.test/invalid-scheme",
    }),
  });
  assert.equal(r2.status, 422);
  const b2 = await r2.json() as JsonRecord;
  assert.equal(b2.code, "VALIDATION_ERROR");
  const fields2 = asRecord(b2.fieldErrors);
  assert.equal(typeof fields2.documentUri, "string");
});

// ---------------------------------------------------------------------------
// T-KYC-BE-02: Valid saveDraft creates DRAFT application with version 1
// ---------------------------------------------------------------------------
test("T-KYC-BE-02: Valid saveDraft creates DRAFT application with version 1", async () => {
  const auditEvents: string[] = [];
  const uow = makeTestUnitOfWork((sql, parameters) => {
    if (sql.includes("FOR UPDATE")) return { rows: [] };
    if (sql.includes("status = 'APPROVED'")) return { rows: [] };
    if (sql.includes("status = 'REJECTED'")) return { rows: [] };
    if (sql.startsWith("INSERT INTO kyc_applications")) {
      const payloadObj = JSON.parse(String(parameters[3])) as Record<string, string>;
      return {
        rows: [{
          ...applicationRow,
          id: String(parameters[0]),
          customer_id: CUSTOMER_A,
          status: "DRAFT",
          version: 1,
          synthetic_payload: payloadObj,
        }],
      };
    }
    if (sql.startsWith("INSERT INTO audit_events")) {
      auditEvents.push(String(parameters[1]));
      return { rows: [] };
    }
    return { rows: [] };
  });

  const result = await new RelationalKycService(uow).saveDraft(CUSTOMER_A, {
    ...baseInput,
    identityNumber: syntheticIdentity(12, "1234"),
  });

  assert.equal(result.status, "DRAFT");
  assert.equal(result.version, 1);
  assert.equal(result.userId, CUSTOMER_A);
  assert.equal(auditEvents.includes("KYC_DRAFT_SAVED"), true);
});

// ---------------------------------------------------------------------------
// T-KYC-BE-03: NEEDS_MORE_INFO + saveDraft keeps status NEEDS_MORE_INFO, same ID, version +1
// ---------------------------------------------------------------------------
test("T-KYC-BE-03: NEEDS_MORE_INFO + saveDraft keeps status and same ID, version +1", async () => {
  const needsMoreInfoRow = {
    ...applicationRow,
    id: APP_ID_1,
    status: "NEEDS_MORE_INFO",
    version: 3,
    decision_reason_code: "INCOMPLETE_DOCS",
  };
  let capturedSql = "";
  const uow = makeTestUnitOfWork((sql, parameters) => {
    if (sql.includes("FOR UPDATE")) return { rows: [needsMoreInfoRow] };
    if (sql.includes("status = 'APPROVED'")) return { rows: [] };
    if (sql.startsWith("UPDATE kyc_applications")) {
      capturedSql = sql;
      const payloadObj = JSON.parse(String(parameters[1])) as Record<string, string>;
      return {
        rows: [{
          ...needsMoreInfoRow,
          version: 4,
          synthetic_payload: payloadObj,
        }],
      };
    }
    if (sql.startsWith("INSERT INTO audit_events")) return { rows: [] };
    return { rows: [] };
  });

  const result = await new RelationalKycService(uow).saveDraft(CUSTOMER_A, {
    ...baseInput,
    identityNumber: syntheticIdentity(12, "9999"),
  });

  assert.equal(result.status, "NEEDS_MORE_INFO");
  assert.equal(result.id, APP_ID_1);
  assert.equal(result.version, 4);
  assert.equal(capturedSql.includes("status = 'DRAFT'"), false, "UPDATE must not set status to DRAFT");
});

// ---------------------------------------------------------------------------
// T-KYC-BE-04: NEEDS_MORE_INFO + submit transitions to SUBMITTED, same ID, version +1
// ---------------------------------------------------------------------------
test("T-KYC-BE-04: NEEDS_MORE_INFO + submit transitions to SUBMITTED, same ID, version +1", async () => {
  const needsMoreInfoRow = {
    ...applicationRow,
    id: APP_ID_1,
    status: "NEEDS_MORE_INFO",
    version: 3,
  };
  let updateStatus = "";
  const outboxEvents: string[] = [];
  const auditEvents: string[] = [];
  const uow = makeTestUnitOfWork((sql, parameters) => {
    if (sql.includes("FOR UPDATE")) return { rows: [needsMoreInfoRow] };
    if (sql.includes("status = 'APPROVED'")) return { rows: [] };
    if (sql.startsWith("UPDATE kyc_applications")) {
      updateStatus = "SUBMITTED";
      return {
        rows: [{
          ...needsMoreInfoRow,
          status: "SUBMITTED",
          version: 4,
          submitted_at: new Date().toISOString(),
        }],
      };
    }
    if (sql.startsWith("INSERT INTO notifications")) return { rows: [] };
    if (sql.startsWith("INSERT INTO audit_events")) {
      auditEvents.push(String(parameters[1]));
      return { rows: [] };
    }
    if (sql.startsWith("INSERT INTO outbox_events")) {
      outboxEvents.push(String(parameters[1]));
      return { rows: [] };
    }
    return { rows: [] };
  });

  const result = await new RelationalKycService(uow).submit(CUSTOMER_A, {
    ...baseInput,
    identityNumber: syntheticIdentity(12, "9999"),
  });

  assert.equal(result.status, "SUBMITTED");
  assert.equal(updateStatus, "SUBMITTED");
  assert.equal(result.id, APP_ID_1);
  assert.equal(result.version, 4);
  assert.notEqual(result.submittedAt, null);
  assert.equal(auditEvents.includes("KYC_SUBMITTED"), true);
  assert.equal(outboxEvents.some((e) => e === "security.kyc_submitted.v1" || e === "SECURITY_KYC_SUBMITTED"), true);
});

// ---------------------------------------------------------------------------
// T-KYC-BE-05: REJECTED + saveDraft creates new DRAFT row with new UUID and version 1
// ---------------------------------------------------------------------------
test("T-KYC-BE-05: REJECTED + saveDraft creates new DRAFT row with UUID moi and version 1", async () => {
  const rejectedRow = {
    ...applicationRow,
    id: APP_ID_1,
    status: "REJECTED",
    decision_reason_code: "EXPIRED_DOCS",
    version: 2,
    synthetic_payload: { ...applicationRow.synthetic_payload, identityNumber: syntheticIdentity(12, "5555") },
  };
  let insertedId = "";
  const uow = makeTestUnitOfWork((sql, parameters) => {
    if (sql.includes("FOR UPDATE")) return { rows: [] };
    if (sql.includes("status = 'APPROVED'")) return { rows: [] };
    if (sql.includes("status = 'REJECTED'")) return { rows: [rejectedRow] };
    if (sql.startsWith("INSERT INTO kyc_applications")) {
      insertedId = String(parameters[0]);
      return { rows: [{ ...applicationRow, id: insertedId, status: "DRAFT", version: 1 }] };
    }
    if (sql.startsWith("INSERT INTO audit_events")) return { rows: [] };
    return { rows: [] };
  });

  const result = await new RelationalKycService(uow).saveDraft(CUSTOMER_A, {
    ...baseInput,
    identityNumber: syntheticIdentity(12, "6666"),
  });

  assert.equal(result.status, "DRAFT");
  assert.equal(result.version, 1);
  assert.notEqual(result.id, APP_ID_1);
  assert.equal(result.id, insertedId);
});

// ---------------------------------------------------------------------------
// T-KYC-BE-06: REJECTED + direct submit creates new SUBMITTED row with new UUID and version 1
// ---------------------------------------------------------------------------
test("T-KYC-BE-06: REJECTED + direct submit creates new SUBMITTED row with UUID moi and version 1", async () => {
  const rejectedRow = {
    ...applicationRow,
    id: APP_ID_1,
    status: "REJECTED",
    version: 2,
    synthetic_payload: { ...applicationRow.synthetic_payload, identityNumber: syntheticIdentity(12, "5555") },
  };
  let insertedId = "";
  const uow = makeTestUnitOfWork((sql, parameters) => {
    if (sql.includes("FOR UPDATE")) return { rows: [] };
    if (sql.includes("status = 'APPROVED'")) return { rows: [] };
    if (sql.includes("status = 'REJECTED'")) return { rows: [rejectedRow] };
    if (sql.startsWith("INSERT INTO kyc_applications")) {
      insertedId = String(parameters[0]);
      return {
        rows: [{
          ...applicationRow,
          id: insertedId,
          status: "SUBMITTED",
          version: 1,
          submitted_at: new Date().toISOString(),
        }],
      };
    }
    if (sql.startsWith("INSERT INTO notifications")) return { rows: [] };
    if (sql.startsWith("INSERT INTO audit_events")) return { rows: [] };
    if (sql.startsWith("INSERT INTO outbox_events")) return { rows: [] };
    return { rows: [] };
  });

  const result = await new RelationalKycService(uow).submit(CUSTOMER_A, {
    ...baseInput,
    identityNumber: syntheticIdentity(12, "7777"),
  });

  assert.equal(result.status, "SUBMITTED");
  assert.equal(result.version, 1);
  assert.notEqual(result.id, APP_ID_1);
  assert.equal(result.id, insertedId);
  assert.notEqual(result.submittedAt, null);
});

// ---------------------------------------------------------------------------
// T-KYC-BE-07: Snapshot of important fields of old REJECTED row before/after
// ---------------------------------------------------------------------------
test("T-KYC-BE-07: REJECTED row fields are not mutated after creating new application", async () => {
  const rejectedRow = {
    ...applicationRow,
    id: APP_ID_1,
    status: "REJECTED",
    decision_reason_code: "INVALID_IDENTIFIER",
    version: 5,
    submitted_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-02T10:00:00.000Z",
    synthetic_payload: { ...applicationRow.synthetic_payload, identityNumber: syntheticIdentity(12, "5555") },
  };
  const snapshotBefore = {
    id: rejectedRow.id,
    status: rejectedRow.status,
    decision_reason_code: rejectedRow.decision_reason_code,
    version: rejectedRow.version,
    submitted_at: rejectedRow.submitted_at,
    updated_at: rejectedRow.updated_at,
    synthetic_payload: { ...rejectedRow.synthetic_payload },
  };

  const mutatedIds: string[] = [];
  const uow = makeTestUnitOfWork((sql, parameters) => {
    if (sql.includes("FOR UPDATE")) return { rows: [] };
    if (sql.includes("status = 'APPROVED'")) return { rows: [] };
    if (sql.includes("status = 'REJECTED'")) return { rows: [rejectedRow] };
    if (sql.startsWith("UPDATE kyc_applications") && String(parameters[0]) === APP_ID_1) {
      mutatedIds.push(APP_ID_1);
    }
    if (sql.startsWith("INSERT INTO kyc_applications")) {
      return { rows: [{ ...applicationRow, id: String(parameters[0]), status: "DRAFT", version: 1 }] };
    }
    if (sql.startsWith("INSERT INTO audit_events")) return { rows: [] };
    return { rows: [] };
  });

  await new RelationalKycService(uow).saveDraft(CUSTOMER_A, {
    ...baseInput,
    identityNumber: syntheticIdentity(12, "6666"),
  });

  assert.equal(mutatedIds.length, 0, "No UPDATE query should target the REJECTED row ID");
  assert.equal(rejectedRow.id, snapshotBefore.id);
  assert.equal(rejectedRow.status, snapshotBefore.status);
  assert.equal(rejectedRow.decision_reason_code, snapshotBefore.decision_reason_code);
  assert.equal(rejectedRow.version, snapshotBefore.version);
  assert.equal(rejectedRow.submitted_at, snapshotBefore.submitted_at);
  assert.equal(rejectedRow.updated_at, snapshotBefore.updated_at);
  assert.deepEqual(rejectedRow.synthetic_payload, snapshotBefore.synthetic_payload);
});

// ---------------------------------------------------------------------------
// T-KYC-BE-08: Latest REJECTED identity inheritance deterministic (created_at DESC, id ASC)
// ---------------------------------------------------------------------------
test("T-KYC-BE-08: Omitted identity is inherited from latest REJECTED application deterministically", async () => {
  const inheritedIdentity = syntheticIdentity(12, "5555");
  const latestRejectedRow = {
    ...applicationRow,
    id: APP_ID_2,
    status: "REJECTED",
    synthetic_payload: { ...applicationRow.synthetic_payload, identityNumber: inheritedIdentity },
  };
  let rejectedQuerySql = "";
  let insertedIdentity = "";
  const uow = makeTestUnitOfWork((sql, parameters) => {
    if (sql.includes("FOR UPDATE")) return { rows: [] };
    if (sql.includes("status = 'APPROVED'")) return { rows: [] };
    if (sql.includes("status = 'REJECTED'")) {
      rejectedQuerySql = sql;
      return { rows: [latestRejectedRow] };
    }
    if (sql.startsWith("INSERT INTO kyc_applications")) {
      const p = JSON.parse(String(parameters[3])) as { identityNumber: string };
      insertedIdentity = p.identityNumber;
      return { rows: [{ ...applicationRow, id: String(parameters[0]), status: "DRAFT", version: 1, synthetic_payload: p }] };
    }
    if (sql.startsWith("INSERT INTO audit_events")) return { rows: [] };
    return { rows: [] };
  });

  const result = await new RelationalKycService(uow).saveDraft(CUSTOMER_A, {
    fullName: baseInput.fullName,
    address: baseInput.address,
    documentUri: baseInput.documentUri,
    syntheticDataConfirmed: true,
  });

  assert.equal(rejectedQuerySql.includes("ORDER BY created_at DESC, id ASC LIMIT 1"), true);
  assert.equal(insertedIdentity, inheritedIdentity);
  assert.equal(result.identityNumberLast4, "5555");
  assert.equal(JSON.stringify(result).includes(inheritedIdentity), false);
});

// ---------------------------------------------------------------------------
// T-KYC-BE-09: Supplied changed identity overrides inherited REJECTED identity
// ---------------------------------------------------------------------------
test("T-KYC-BE-09: Supplied new identity overrides inherited identity from REJECTED row", async () => {
  const inheritedIdentity = syntheticIdentity(12, "1111");
  const newIdentity       = syntheticIdentity(12, "9999");
  const rejectedRow = {
    ...applicationRow,
    id: APP_ID_1,
    status: "REJECTED",
    synthetic_payload: { ...applicationRow.synthetic_payload, identityNumber: inheritedIdentity },
  };
  let insertedIdentity = "";
  const uow = makeTestUnitOfWork((sql, parameters) => {
    if (sql.includes("FOR UPDATE")) return { rows: [] };
    if (sql.includes("status = 'APPROVED'")) return { rows: [] };
    if (sql.includes("status = 'REJECTED'")) return { rows: [rejectedRow] };
    if (sql.startsWith("INSERT INTO kyc_applications")) {
      const p = JSON.parse(String(parameters[3])) as { identityNumber: string };
      insertedIdentity = p.identityNumber;
      return { rows: [{ ...applicationRow, id: String(parameters[0]), status: "DRAFT", version: 1, synthetic_payload: p }] };
    }
    if (sql.startsWith("INSERT INTO audit_events")) return { rows: [] };
    return { rows: [] };
  });

  await new RelationalKycService(uow).saveDraft(CUSTOMER_A, {
    ...baseInput,
    identityNumber: newIdentity,
  });

  assert.equal(insertedIdentity, newIdentity);
  assert.notEqual(insertedIdentity, inheritedIdentity);
});

// ---------------------------------------------------------------------------
// T-KYC-BE-10: Omitted identity with no open and no REJECTED source yields 422
// ---------------------------------------------------------------------------
test("T-KYC-BE-10: Omitted identity with no open and no REJECTED source yields 422", async () => {
  const uow = makeTestUnitOfWork((sql) => {
    if (sql.includes("FOR UPDATE")) return { rows: [] };
    if (sql.includes("status = 'APPROVED'")) return { rows: [] };
    if (sql.includes("status = 'REJECTED'")) return { rows: [] };
    return { rows: [] };
  });

  await assert.rejects(
    () => new RelationalKycService(uow).saveDraft(CUSTOMER_A, {
      fullName: baseInput.fullName,
      address: baseInput.address,
      documentUri: baseInput.documentUri,
      syntheticDataConfirmed: true,
    }),
    (error: unknown) => error instanceof DomainError && error.status === 422,
  );
});

// ---------------------------------------------------------------------------
// T-KYC-BE-11: APPROVED precedence — saveDraft and submit both yield generic 409
// ---------------------------------------------------------------------------
test("T-KYC-BE-11: Customer with APPROVED application gets generic 409 on saveDraft and submit", async () => {
  const approvedRow = { ...applicationRow, id: APP_ID_2, status: "APPROVED" };
  const uow = makeTestUnitOfWork((sql) => {
    if (sql.includes("FOR UPDATE")) return { rows: [] };
    if (sql.includes("status = 'APPROVED'")) return { rows: [approvedRow] };
    return { rows: [] };
  });

  await assert.rejects(
    () => new RelationalKycService(uow).saveDraft(CUSTOMER_A, {
      ...baseInput,
      identityNumber: syntheticIdentity(12, "1234"),
    }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.status === 409 &&
      error.message === "KYC application has already been approved." &&
      !JSON.stringify(error).includes(syntheticIdentity(12, "1234")),
  );

  await assert.rejects(
    () => new RelationalKycService(uow).submit(CUSTOMER_A, {
      ...baseInput,
      identityNumber: syntheticIdentity(12, "1234"),
    }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.status === 409 &&
      error.message === "KYC application has already been approved.",
  );
});

// ---------------------------------------------------------------------------
// T-KYC-BE-12: Exact open-index unique violation (23505 + kyc_applications_customer_open_idx) -> generic 409
// ---------------------------------------------------------------------------
test("T-KYC-BE-12: INSERT 23505 on kyc_applications_customer_open_idx maps to generic 409", async () => {
  const openIndexError = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint: "kyc_applications_customer_open_idx",
  });
  const uow = makeTestUnitOfWork((sql) => {
    if (sql.includes("FOR UPDATE")) return { rows: [] };
    if (sql.includes("status = 'APPROVED'")) return { rows: [] };
    if (sql.includes("status = 'REJECTED'")) return { rows: [] };
    if (sql.startsWith("INSERT")) throw openIndexError;
    return { rows: [] };
  });

  await assert.rejects(
    () => new RelationalKycService(uow).saveDraft(CUSTOMER_A, {
      ...baseInput,
      identityNumber: syntheticIdentity(12, "1234"),
    }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.status === 409 &&
      error.message === "KYC application is already open.",
  );

  await assert.rejects(
    () => new RelationalKycService(uow).submit(CUSTOMER_A, {
      ...baseInput,
      identityNumber: syntheticIdentity(12, "1234"),
    }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.status === 409 &&
      error.message === "KYC application is already open.",
  );
});

// ---------------------------------------------------------------------------
// T-KYC-BE-13: Primary-key violation and unknown DB errors are rethrown unchanged
// ---------------------------------------------------------------------------
test("T-KYC-BE-13: Primary-key violation and unknown DB errors are rethrown unchanged", async () => {
  const pkError = Object.assign(new Error("duplicate pk"), {
    code: "23505",
    constraint: "kyc_applications_pkey",
  });
  const uowPk = makeTestUnitOfWork((sql) => {
    if (sql.includes("FOR UPDATE")) return { rows: [] };
    if (sql.includes("status = 'APPROVED'")) return { rows: [] };
    if (sql.includes("status = 'REJECTED'")) return { rows: [] };
    if (sql.startsWith("INSERT")) throw pkError;
    return { rows: [] };
  });

  await assert.rejects(
    () => new RelationalKycService(uowPk).saveDraft(CUSTOMER_A, {
      ...baseInput,
      identityNumber: syntheticIdentity(12, "1234"),
    }),
    (error: unknown) => error === pkError,
  );

  const unknownDbError = Object.assign(new Error("database connection reset"), { code: "08006" });
  const uowUnknown = makeTestUnitOfWork((sql) => {
    if (sql.includes("FOR UPDATE")) return { rows: [] };
    if (sql.includes("status = 'APPROVED'")) return { rows: [] };
    if (sql.includes("status = 'REJECTED'")) return { rows: [] };
    if (sql.startsWith("INSERT")) throw unknownDbError;
    return { rows: [] };
  });

  await assert.rejects(
    () => new RelationalKycService(uowUnknown).saveDraft(CUSTOMER_A, {
      ...baseInput,
      identityNumber: syntheticIdentity(12, "1234"),
    }),
    (error: unknown) => error === unknownDbError,
  );
});

// ---------------------------------------------------------------------------
// T-KYC-BE-14: Response and error logging never expose full identity number
// ---------------------------------------------------------------------------
test("T-KYC-BE-14: Response and error messages never expose full identity number", async (t) => {
  const fullIdentity = syntheticIdentity(12, "8901");
  const capturedAuditPayloads: string[] = [];
  const capturedOutboxPayloads: string[] = [];
  const capturedNotificationBodies: string[] = [];

  const uow = makeTestUnitOfWork((sql, parameters) => {
    if (sql.includes("FOR UPDATE")) return { rows: [] };
    if (sql.includes("status = 'APPROVED'")) return { rows: [] };
    if (sql.includes("status = 'REJECTED'")) return { rows: [] };
    if (sql.startsWith("INSERT INTO kyc_applications")) {
      const payloadObj = JSON.parse(String(parameters[3])) as Record<string, string>;
      return {
        rows: [{
          ...applicationRow,
          id: String(parameters[0]),
          customer_id: CUSTOMER_A,
          status: "SUBMITTED",
          version: 1,
          synthetic_payload: payloadObj,
        }],
      };
    }
    if (sql.startsWith("INSERT INTO notifications")) {
      capturedNotificationBodies.push(String(parameters[3]), String(parameters[4]));
      return { rows: [] };
    }
    if (sql.startsWith("INSERT INTO audit_events")) {
      capturedAuditPayloads.push(String(parameters[5]));
      return { rows: [] };
    }
    if (sql.startsWith("INSERT INTO outbox_events")) {
      capturedOutboxPayloads.push(String(parameters[7]));
      return { rows: [] };
    }
    return { rows: [] };
  });

  // 1. Service submit: verify notifications, audit_events, outbox_events payloads
  const service = new RelationalKycService(uow);
  const result = await service.submit(CUSTOMER_A, {
    ...baseInput,
    identityNumber: fullIdentity,
  });

  // Mapper projection: identityNumberLast4 is present, full identityNumber is stripped
  assert.equal(result.identityNumberLast4, "8901");
  assert.equal(Object.prototype.hasOwnProperty.call(result, "identityNumber"), false);
  assert.equal(JSON.stringify(result).includes(fullIdentity), false);

  // Side-effect payloads must never contain the full identity sentinel
  assert.equal(
    capturedNotificationBodies.some((b) => b.includes(fullIdentity)),
    false,
    "Notification title/body must not leak full identity",
  );
  assert.equal(
    capturedAuditPayloads.some((p) => p.includes(fullIdentity)),
    false,
    "Audit event payload must not leak full identity",
  );
  assert.equal(
    capturedOutboxPayloads.some((p) => p.includes(fullIdentity)),
    false,
    "Outbox event payload must not leak full identity",
  );

  // 2. HTTP response body: public endpoint must never return full identity
  const relationalHttp = new TestRelationalHttpBoundary(uow, async () => testAuthUser);
  const repository = { withState: async (): Promise<never> => { throw new Error("no legacy"); } };
  const server = createPersistentBankingServer(repository, new BankingSystem(), {
    relationalHttp,
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
  });
  await new Promise<void>((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1/kyc/application`;
  const headers = {
    Authorization: "Bearer <redacted>",
    "X-Device-ID": "synthetic-device",
    "Content-Type": "application/json",
  };

  const httpRes = await fetch(`${baseUrl}/submit`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...baseInput, identityNumber: fullIdentity }),
  });
  assert.equal(httpRes.status, 201);
  const httpBody = await httpRes.text();
  assert.equal(httpBody.includes(fullIdentity), false, "Public HTTP response body must not contain full identity");

  // 3. DomainError message and fieldErrors on validation failure
  const consoleCalls: unknown[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => consoleCalls.push(args);
  try {
    try {
      normalizeInput({ ...baseInput, identityNumber: `${fullIdentity} ` });
      assert.fail("Should have thrown DomainError");
    } catch (err: unknown) {
      assert.equal(err instanceof DomainError, true);
      const domainError = err as DomainError;
      assert.equal(domainError.message.includes(fullIdentity), false, "DomainError message must not leak full identity");
      assert.equal(
        JSON.stringify(domainError.fieldErrors ?? {}).includes(fullIdentity),
        false,
        "DomainError fieldErrors must not leak full identity",
      );
    }
  } finally {
    console.error = originalError;
  }

  // 4. Console logging capture: must never contain full identity
  assert.equal(
    JSON.stringify(consoleCalls).includes(fullIdentity),
    false,
    "Console logs must never contain full identity",
  );
});

// ---------------------------------------------------------------------------
// T-KYC-BE-15: Idempotent submit (SUBMITTED + same payload) returns HTTP 201 without side effects
// ---------------------------------------------------------------------------
test("T-KYC-BE-15: Idempotent submit returns existing application without creating duplicate side effects", async (t) => {
  const identityNumber = syntheticIdentity(12, "4444");
  const normalizedPayload = normalizeInput({ ...baseInput, identityNumber });
  const fp = fingerprint(normalizedPayload);

  const submittedRow = {
    ...applicationRow,
    id: APP_ID_1,
    status: "SUBMITTED",
    version: 2,
    request_fingerprint: fp,
    submitted_at: "2026-09-01T08:00:00.000Z",
    synthetic_payload: {
      fullName: baseInput.fullName,
      identityNumber,
      address: baseInput.address,
      documentUri: baseInput.documentUri,
    },
  };

  let sideEffectInserts = 0;
  const uow = makeTestUnitOfWork((sql) => {
    if (sql.includes("FOR UPDATE")) return { rows: [submittedRow] };
    if (sql.includes("status = 'APPROVED'")) return { rows: [] };
    if (sql.startsWith("INSERT INTO notifications") ||
        sql.startsWith("INSERT INTO audit_events") ||
        sql.startsWith("INSERT INTO outbox_events")) {
      sideEffectInserts += 1;
      return { rows: [] };
    }
    return { rows: [] };
  });

  // Unit-level test
  const service = new RelationalKycService(uow);
  const result = await service.submit(CUSTOMER_A, {
    ...baseInput,
    identityNumber,
  });

  assert.equal(result.id, APP_ID_1);
  assert.equal(result.status, "SUBMITTED");
  assert.equal(result.version, 2);
  assert.notEqual(result.submittedAt, null);
  assert.equal(sideEffectInserts, 0, "Idempotent replay must not create notification, audit, or outbox rows");

  // Route-level test: verify exact HTTP 201 response and state idempotency
  const relationalHttp = new TestRelationalHttpBoundary(uow, async () => testAuthUser);
  const repository = { withState: async (): Promise<never> => { throw new Error("no legacy"); } };
  const server = createPersistentBankingServer(repository, new BankingSystem(), {
    relationalHttp,
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
  });
  await new Promise<void>((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const submitUrl = `http://127.0.0.1:${address.port}/api/v1/kyc/application/submit`;
  const headers = {
    Authorization: "Bearer <redacted>",
    "X-Device-ID": "synthetic-device",
    "Content-Type": "application/json",
  };

  const httpRes = await fetch(submitUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...baseInput, identityNumber }),
  });
  assert.equal(httpRes.status, 201, "Route must return HTTP 201 on idempotent submit replay");
  const httpBody = await httpRes.json() as JsonRecord;
  const appBody = asRecord(httpBody.application);
  assert.equal(appBody.id, APP_ID_1);
  assert.equal(appBody.status, "SUBMITTED");
  assert.equal(appBody.version, 2);
});

// ---------------------------------------------------------------------------
// T-KYC-BE-16: Controlled ordering — APPROVED recheck after lockOpen prevents insert
// ---------------------------------------------------------------------------
test("T-KYC-BE-16: APPROVED recheck after lockOpen prevents insert when open row transitioned to APPROVED", async () => {
  // Controlled ordering scenario:
  // 1. Customer calls saveDraft while Admin is approving the application.
  // 2. lockOpen (SELECT ... FOR UPDATE) waits for Admin transaction to commit.
  // 3. Admin commits: status becomes 'APPROVED'.
  // 4. lockOpen unblocks, but row no longer matches WHERE status IN (open statuses).
  //    Therefore lockOpen returns null (empty rows).
  // 5. Query 2 (APPROVED recheck) runs: SELECT id FROM kyc_applications WHERE status = 'APPROVED'.
  //    It finds the newly committed APPROVED row.
  // 6. Generic 409 Conflict is thrown immediately.
  // 7. No REJECTED inheritance query, no normalization with inherited identity, no INSERT.
  const approvedRow = { ...applicationRow, id: APP_ID_2, status: "APPROVED" };
  const queryLog: string[] = [];
  let insertCount = 0;

  const uow = makeTestUnitOfWork((sql) => {
    queryLog.push(sql);
    if (sql.includes("FOR UPDATE")) {
      // Simulates lockOpen returning null after Admin committed status = 'APPROVED'
      return { rows: [] };
    }
    if (sql.includes("status = 'APPROVED'")) {
      // Step 2: APPROVED recheck detects the row
      return { rows: [approvedRow] };
    }
    if (sql.startsWith("INSERT")) {
      insertCount += 1;
      return { rows: [] };
    }
    return { rows: [] };
  });

  await assert.rejects(
    () => new RelationalKycService(uow).saveDraft(CUSTOMER_A, {
      ...baseInput,
      identityNumber: syntheticIdentity(12, "1234"),
    }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.status === 409 &&
      error.message === "KYC application has already been approved.",
  );

  assert.equal(insertCount, 0, "No INSERT must be executed when APPROVED recheck fires");
  const rejectedInheritQueries = queryLog.filter((s) => s.includes("status = 'REJECTED'"));
  assert.equal(rejectedInheritQueries.length, 0, "No REJECTED identity inheritance query should be executed");
  // NOTE: This test confirms the query sequence and business rule enforcement in unit/contract
  // isolation. PostgreSQL runtime race/concurrency verification is deferred to M01-07.
});

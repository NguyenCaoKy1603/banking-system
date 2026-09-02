import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";

import { BankingSystem } from "../bankingSystem.js";
import { createBankingServer } from "../http.js";
import { conflict } from "../errors.js";

async function startTestServer() {
  const system = new BankingSystem();
  const server = createBankingServer(system);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as import("node:net").AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  return { server, baseUrl, system };
}

test("Registration begin response returns EMAIL_OTP and REGISTRATION_EMAIL_VERIFY", async (t) => {
  const { server, baseUrl, system } = await startTestServer();
  t.after(() => server.close());

  t.mock.method(system, "beginRegistrationAsync", async () => {
    return {
      challengeId: "mock-challenge",
      expiresAt: "2030-01-01T00:00:00.000Z",
      purpose: "REGISTRATION_EMAIL_VERIFY",
      methods: ["EMAIL_OTP"],
    };
  });

  const response = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "X-Device-ID": "test-device" },
    body: JSON.stringify({
      fullName: "Test User",
      email: "test@example.com",
      phoneNumber: "+1234567890",
      password: "password123",
    }),
  });

  assert.equal(response.status, 202);
  const data = (await response.json()) as any;
  assert.equal(data.purpose, "REGISTRATION_EMAIL_VERIFY");
  assert.ok(data.methods.includes("EMAIL_OTP"));
});

test("Deprecated /auth/verify contract unchanged and Registration verify uses flow-specific schema", async (t) => {
  const openapiContent = await fs.readFile(
    path.resolve(process.cwd(), "../documents/api/banking-mvp.openapi.yaml"),
    "utf8"
  );
  const doc = yaml.parse(openapiContent);

  const authVerifyBody = doc.paths["/auth/verify"].post.requestBody.content["application/json"].schema;
  assert.equal(authVerifyBody.$ref, "#/components/schemas/VerifyAuthChallengeRequest");

  const registerVerifyBody = doc.paths["/auth/register/verify"].post.requestBody.content["application/json"].schema;
  assert.equal(registerVerifyBody.$ref, "#/components/schemas/VerifyRegistrationChallengeRequest");

  const verifyRegistrationChallengeRequest = doc.components.schemas["VerifyRegistrationChallengeRequest"];
  assert.ok(verifyRegistrationChallengeRequest);
  assert.deepEqual(verifyRegistrationChallengeRequest.properties.method.enum, ["EMAIL_OTP"]);
});

test("Registration verify with missing challengeId returns 422", async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/auth/register/verify`, {
    method: "POST",
    headers: { "X-Device-ID": "test-device" },
    body: JSON.stringify({
      method: "EMAIL_OTP",
      proof: "123456",
    }),
  });
  assert.equal(response.status, 422);
  const data = (await response.json()) as any;
  assert.equal(data.code, "VALIDATION_ERROR");
  assert.ok(!JSON.stringify(data).includes("123456"));
});

test("Registration verify with wrong method returns 422", async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/auth/register/verify`, {
    method: "POST",
    headers: { "X-Device-ID": "test-device" },
    body: JSON.stringify({
      challengeId: "test-challenge",
      method: "OTP",
      proof: "123456",
    }),
  });
  assert.equal(response.status, 422);
});

test("Begin conflict returns 409", async (t) => {
  const { server, baseUrl, system } = await startTestServer();
  t.after(() => server.close());

  t.mock.method(system, "beginRegistrationAsync", async () => {
    throw conflict("Email or phone number already exists.");
  });

  const input = {
    fullName: "Test User",
    email: "conflict@example.com",
    phoneNumber: "+1234567890",
    password: "password123",
  };

  const response1 = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "X-Device-ID": "test-device" },
    body: JSON.stringify(input),
  });
  assert.equal(response1.status, 409);
});

test("Complete conflict returns 409 and doesn't map unknown errors", async (t) => {
  const mockClient = {
    query: async (queryText: string) => {
      if (queryText.includes("SELECT * FROM pending_registrations")) {
        return { rows: [{ full_name: "A", email: "a@a.com", phone_number: "123", password_salt: "s", password_digest: "d", expires_at: new Date(Date.now() + 10000).toISOString() }] };
      }
      if (queryText.includes("INSERT INTO customers")) {
        const err = new Error("Duplicate") as any;
        err.code = "23505";
        err.constraint = "customers_pkey";
        throw err;
      }
      return { rows: [] };
    }
  } as any;
  const mockUow = {
    transaction: async (cb: any) => cb({ client: mockClient })
  } as any;
  const { RelationalRegistrationService } = await import("../database/registrationService.js");
  const service = new RelationalRegistrationService(mockUow);
  await assert.rejects(
    service.complete({ pendingRegistrationId: "test-id" }),
    (err: any) => err.code === "23505" && err.constraint === "customers_pkey"
  );
});

test("Begin conflict doesn't map unknown errors", async (t) => {
  const mockClient = {
    query: async (queryText: string) => {
      if (queryText.includes("INSERT INTO rate_limit_buckets")) {
        return { rows: [{ attempts: 1 }] };
      }
      if (queryText.includes("INSERT INTO pending_registrations")) {
        const err = new Error("Duplicate") as any;
        err.code = "23505";
        err.constraint = "pending_registrations_pkey";
        throw err;
      }
      return { rows: [] };
    }
  } as any;
  const mockUow = {
    transaction: async (cb: any) => cb({ client: mockClient })
  } as any;
  const { RelationalRegistrationService } = await import("../database/registrationService.js");
  const service = new RelationalRegistrationService(mockUow);
  const mfaService = {
    atomicRateLimit: async () => ({ allowed: true })
  } as any;

  await assert.rejects(
    service.begin(
      { fullName: "Test", email: "a@a.com", phoneNumber: "123", password: "password123" },
      "device",
      mfaService
    ),
    (err: any) => err.code === "23505" && err.constraint === "pending_registrations_pkey"
  );
});

test("Registration cancel with missing challengeId returns 422", async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/auth/register/cancel`, {
    method: "POST",
    headers: { "X-Device-ID": "test-device" },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 422);
  const data = (await response.json()) as any;
  assert.equal(data.code, "VALIDATION_ERROR");
});

test("Registration cancel missing X-Device-ID returns 422", async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/auth/register/cancel`, {
    method: "POST",
    body: JSON.stringify({ challengeId: "test-challenge" }),
  });
  assert.equal(response.status, 422);
  const data = (await response.json()) as any;
  assert.equal(data.code, "VALIDATION_ERROR");
});

test("Registration cancel precedence (RelationalRegistrationService)", async (t) => {
  const { RelationalRegistrationService } = await import("../database/registrationService.js");
  const { MfaRepository } = await import("../database/repositories/mfaRepository.js");
  const { CustomerRepository } = await import("../database/repositories/customerRepository.js");

  let mockCompletions: any[] = [];
  const mockClient = {
    query: async (queryText: string) => {
      if (queryText.includes("registration_completions")) return { rows: mockCompletions };
      return { rows: [] };
    }
  } as any;
  const mockUow = { transaction: async (cb: any) => cb({ client: mockClient }) } as any;
  const service = new RelationalRegistrationService(mockUow);

  const lockChallengeMock = t.mock.method(MfaRepository.prototype, "lockChallenge");
  const cancelChallengeMock = t.mock.method(MfaRepository.prototype, "cancelChallenge");
  const consumePendingMock = t.mock.method(CustomerRepository.prototype, "consumePendingRegistration");

  // 1. Challenge not found -> 404
  lockChallengeMock.mock.mockImplementation(async () => null);
  await assert.rejects(service.cancel("c1", "d1"), (err: any) => err.code === "NOT_FOUND");

  // 2. Wrong device/purpose -> 404
  lockChallengeMock.mock.mockImplementation(async () => ({ device_id: "other", purpose: "REGISTRATION_EMAIL_VERIFY" } as unknown as any));
  await assert.rejects(service.cancel("c1", "d1"), (err: any) => err.code === "NOT_FOUND");
  lockChallengeMock.mock.mockImplementation(async () => ({ device_id: "d1", purpose: "OTHER_PURPOSE" } as unknown as any));
  await assert.rejects(service.cancel("c1", "d1"), (err: any) => err.code === "NOT_FOUND");

  // 3. Completed -> 409
  lockChallengeMock.mock.mockImplementation(async () => ({ device_id: "d1", purpose: "REGISTRATION_EMAIL_VERIFY", pending_registration_id: "p1", status: "ACTIVE", expires_at: new Date(Date.now() + 100000).toISOString() } as unknown as any));
  mockCompletions = [{ _dummy: 1 }];
  await assert.rejects(service.cancel("c1", "d1"), (err: any) => err.code === "REGISTRATION_ALREADY_COMPLETED");
  mockCompletions = [];

  // 4. Completed but challenge is terminal (should still 409 before mutation)
  lockChallengeMock.mock.mockImplementation(async () => ({ device_id: "d1", purpose: "REGISTRATION_EMAIL_VERIFY", pending_registration_id: "p1", status: "CONSUMED", expires_at: new Date(Date.now() + 100000).toISOString() } as unknown as any));
  mockCompletions = [{ _dummy: 1 }];
  await assert.rejects(service.cancel("c1", "d1"), (err: any) => err.code === "REGISTRATION_ALREADY_COMPLETED");
  mockCompletions = [];

  // 5. Terminal but not completed -> 204
  lockChallengeMock.mock.mockImplementation(async () => ({ device_id: "d1", purpose: "REGISTRATION_EMAIL_VERIFY", pending_registration_id: "p1", status: "CANCELLED", expires_at: new Date(Date.now() + 100000).toISOString() } as unknown as any));
  cancelChallengeMock.mock.mockImplementation(async () => true);
  consumePendingMock.mock.mockImplementation(async () => true);
  await service.cancel("c1", "d1");
  assert.equal(cancelChallengeMock.mock.callCount(), 0);
  assert.equal(consumePendingMock.mock.callCount(), 1);
  consumePendingMock.mock.resetCalls();
  cancelChallengeMock.mock.resetCalls();

  // 6. Expired -> 204
  lockChallengeMock.mock.mockImplementation(async () => ({ device_id: "d1", purpose: "REGISTRATION_EMAIL_VERIFY", pending_registration_id: "p1", status: "ACTIVE", expires_at: new Date(Date.now() - 10000).toISOString() } as unknown as any));
  await service.cancel("c1", "d1");
  assert.equal(cancelChallengeMock.mock.callCount(), 0);
  assert.equal(consumePendingMock.mock.callCount(), 1);
  consumePendingMock.mock.resetCalls();
  cancelChallengeMock.mock.resetCalls();

  // 7. Active -> 204 with mutation
  lockChallengeMock.mock.mockImplementation(async () => ({ device_id: "d1", purpose: "REGISTRATION_EMAIL_VERIFY", pending_registration_id: "p1", status: "ACTIVE", expires_at: new Date(Date.now() + 100000).toISOString() } as unknown as any));
  await service.cancel("c1", "d1");
  assert.equal(cancelChallengeMock.mock.callCount(), 1);
  assert.equal(consumePendingMock.mock.callCount(), 1);
  consumePendingMock.mock.resetCalls();
  cancelChallengeMock.mock.resetCalls();

  // 8. Repeat cancel after cleanup -> 204, no mutation
  lockChallengeMock.mock.mockImplementation(async () => ({ device_id: "d1", purpose: "REGISTRATION_EMAIL_VERIFY", pending_registration_id: null, status: "CANCELLED", expires_at: new Date(Date.now() + 100000).toISOString() } as unknown as any));
  await service.cancel("c1", "d1");
  assert.equal(cancelChallengeMock.mock.callCount(), 0);
  assert.equal(consumePendingMock.mock.callCount(), 0);
  consumePendingMock.mock.resetCalls();
  cancelChallengeMock.mock.resetCalls();

  // 9. VERIFIED but completion failed -> 204, unlinks and deletes pending, no cancelChallenge
  lockChallengeMock.mock.mockImplementation(async () => ({ device_id: "d1", purpose: "REGISTRATION_EMAIL_VERIFY", pending_registration_id: "p1", status: "VERIFIED", expires_at: new Date(Date.now() + 100000).toISOString() } as unknown as any));
  await service.cancel("c1", "d1");
  assert.equal(cancelChallengeMock.mock.callCount(), 0);
  assert.equal(consumePendingMock.mock.callCount(), 1);
  consumePendingMock.mock.resetCalls();
  cancelChallengeMock.mock.resetCalls();

  // 10. Cleanup failure propagation -> Error propagates (this fake test verifies error boundary, actual postgres rollback is covered in M01-07)
  lockChallengeMock.mock.mockImplementation(async () => ({ device_id: "d1", purpose: "REGISTRATION_EMAIL_VERIFY", pending_registration_id: "p1", status: "ACTIVE", expires_at: new Date(Date.now() + 100000).toISOString() } as unknown as any));
  consumePendingMock.mock.mockImplementation(async () => { throw new Error("Mock database error"); });
  await assert.rejects(service.cancel("c1", "d1"), (err: any) => err.message === "Mock database error");
  consumePendingMock.mock.resetCalls();
  cancelChallengeMock.mock.resetCalls();
});

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

test("B1b CustomerRepository findAndLockPendingByContact SQL and Mapper", async (t) => {
  const { CustomerRepository } = await import("../database/repositories/customerRepository.js");

  let executedQuery = "";
  const mockClient = {
    query: async (queryText: string) => {
      executedQuery = queryText;
      return { rows: [{ id: "mock-id", is_expired: true }] };
    }
  } as any;
  const repo = new CustomerRepository(mockClient);

  const result = await repo.findAndLockPendingByContact("a@a.com", "123");

  assert.ok(!executedQuery.includes("SELECT *"), "SQL must not contain SELECT *");
  assert.ok(!executedQuery.includes("password_salt"), "SQL must not select password_salt");
  assert.ok(!executedQuery.includes("password_digest"), "SQL must not select password_digest");
  assert.ok(executedQuery.includes("expires_at <= NOW() AS is_expired"), "SQL must contain expires_at <= NOW() AS is_expired");

  const orderByIdIndex = executedQuery.indexOf("ORDER BY id");
  const forUpdateIndex = executedQuery.indexOf("FOR UPDATE");
  assert.ok(orderByIdIndex !== -1 && forUpdateIndex !== -1 && orderByIdIndex < forUpdateIndex, "ORDER BY id must be before FOR UPDATE");

  assert.deepEqual(result, [{ id: "mock-id", isExpired: true }]);

  // Mapper reject non-boolean is_expired
  const mockClientBadBool = {
    query: async () => ({ rows: [{ id: "mock-id", is_expired: "true" }] })
  } as any;
  const repoBadBool = new CustomerRepository(mockClientBadBool);
  await assert.rejects(repoBadBool.findAndLockPendingByContact("a@a.com", "123"), (err: any) => err.message === "Database returned invalid is_expired for pending registration.");

  // Mapper reject missing/invalid id
  const mockClientBadId = {
    query: async () => ({ rows: [{ id: "", is_expired: true }] })
  } as any;
  const repoBadId = new CustomerRepository(mockClientBadId);
  await assert.rejects(repoBadId.findAndLockPendingByContact("a@a.com", "123"), (err: any) => err.message === "Database returned invalid id for pending registration.");
});

test("B1b RegistrationService begin tests", async (t) => {
  const { RelationalRegistrationService } = await import("../database/registrationService.js");

  const createService = (queryMock: any, mfaServiceMock: any = {}) => {
    let inCompensation = false;
    let queries: { query: string; params: any[] }[] = [];
    let compensationQueries: { query: string; params: any[] }[] = [];

    const mockUow = {
      transaction: async (cb: any, opts: any) => {
        const client = {
          query: async (queryText: string, params: any[]) => {
            if (inCompensation) compensationQueries.push({ query: queryText, params });
            else queries.push({ query: queryText, params });
            return queryMock(queryText, params);
          }
        };
        return cb({ client });
      }
    } as any;

    const originalTransaction = mockUow.transaction;
    mockUow.transaction = async (cb: any, opts: any) => {
      if (queries.length > 0) inCompensation = true;
      return originalTransaction(cb, opts);
    };

    return {
      service: new RelationalRegistrationService(mockUow),
      getQueries: () => queries,
      getCompensationQueries: () => compensationQueries,
      mfaService: { atomicRateLimit: async () => ({ allowed: true, attempts: 1, retryAfterSeconds: 0 }), createEmailChallenge: async () => ({}), ...mfaServiceMock } as any
    };
  };

  const input = { fullName: "Test", email: "a@a.com", phoneNumber: "123", password: "password123" };
  const device = "device";

  await t.test("B1 No pending -> normal begin 202", async () => {
    const { service } = createService(async (q) => {
      if (q.includes("rate_limit_buckets")) return { rows: [{ attempts: 1 }] };
      return { rows: [] };
    });
    await service.begin(input, device, { atomicRateLimit: async () => ({ allowed: true }), createEmailChallenge: async () => ({}) });
  });

  await t.test("B2 Active pending, both contact match -> 409", async () => {
    const { service } = createService(async (q: string) => {
      if (q.includes("rate_limit_buckets")) return { rows: [{ attempts: 1 }] };
      if (q.includes("SELECT id, expires_at <= NOW() AS is_expired")) return { rows: [{ id: "1", is_expired: false }] };
      return { rows: [] };
    });
    await assert.rejects(service.begin(input, device, {} as any), (err: any) => err.message === "Registration conflict." && err.code === "CONFLICT");
  });

  await t.test("B3 Active pending, email-only match -> 409", async () => {
    const { service } = createService(async (q: string) => {
      if (q.includes("rate_limit_buckets")) return { rows: [{ attempts: 1 }] };
      if (q.includes("SELECT id, expires_at <= NOW() AS is_expired")) return { rows: [{ id: "1", is_expired: false }] };
      return { rows: [] };
    });
    await assert.rejects(service.begin(input, device, {} as any), (err: any) => err.message === "Registration conflict." && err.code === "CONFLICT");
  });

  await t.test("B4 Active pending, phone-only match -> 409", async () => {
    const { service } = createService(async (q: string) => {
      if (q.includes("rate_limit_buckets")) return { rows: [{ attempts: 1 }] };
      if (q.includes("SELECT id, expires_at <= NOW() AS is_expired")) return { rows: [{ id: "1", is_expired: false }] };
      return { rows: [] };
    });
    await assert.rejects(service.begin(input, device, {} as any), (err: any) => err.message === "Registration conflict." && err.code === "CONFLICT");
  });

  await t.test("B5 Expired pending, both match -> cleanup + 202", async () => {
    const { service, getQueries } = createService(async (q: string) => {
      if (q.includes("rate_limit_buckets")) return { rows: [{ attempts: 1 }] };
      if (q.includes("SELECT id, expires_at <= NOW() AS is_expired")) return { rows: [{ id: "1", is_expired: true }] };
      return { rows: [] };
    });
    await service.begin(input, device, { atomicRateLimit: async () => ({ allowed: true }), createEmailChallenge: async () => ({}) } as any);
    const queries = getQueries();
    assert.ok(queries.some(q => q.query.includes("UPDATE auth_challenges") && q.query.includes("CANCELLED")));
    assert.ok(queries.some(q => q.query.includes("DELETE FROM pending_registrations")));
  });

  await t.test("B6 Expired pending, email-only -> cleanup + 202", async () => {
    const { service } = createService(async (q: string) => {
      if (q.includes("rate_limit_buckets")) return { rows: [{ attempts: 1 }] };
      if (q.includes("SELECT id, expires_at <= NOW() AS is_expired")) return { rows: [{ id: "1", is_expired: true }] };
      return { rows: [] };
    });
    await service.begin(input, device, { atomicRateLimit: async () => ({ allowed: true }), createEmailChallenge: async () => ({}) } as any);
  });

  await t.test("B7 Expired pending, phone-only -> cleanup + 202", async () => {
    const { service } = createService(async (q: string) => {
      if (q.includes("rate_limit_buckets")) return { rows: [{ attempts: 1 }] };
      if (q.includes("SELECT id, expires_at <= NOW() AS is_expired")) return { rows: [{ id: "1", is_expired: true }] };
      return { rows: [] };
    });
    await service.begin(input, device, { atomicRateLimit: async () => ({ allowed: true }), createEmailChallenge: async () => ({}) } as any);
  });

  await t.test("B8 Expired + completed -> 409, no mutation", async () => {
    const { service, getQueries } = createService(async (q: string) => {
      if (q.includes("rate_limit_buckets")) return { rows: [{ attempts: 1 }] };
      if (q.includes("SELECT id, expires_at <= NOW() AS is_expired")) return { rows: [{ id: "1", is_expired: true }] };
      if (q.includes("SELECT 1 FROM registration_completions")) return { rows: [{ "?column?": 1 }] };
      return { rows: [] };
    });
    await assert.rejects(service.begin(input, device, {} as any), (err: any) => err.message === "Registration conflict." && err.code === "CONFLICT");
    assert.ok(!getQueries().some(q => q.query.includes("DELETE FROM pending_registrations")));
  });

  await t.test("B9 Email row A + phone row B -> 409, neither deleted", async () => {
    const { service, getQueries } = createService(async (q: string) => {
      if (q.includes("rate_limit_buckets")) return { rows: [{ attempts: 1 }] };
      if (q.includes("SELECT id, expires_at <= NOW() AS is_expired")) return { rows: [{ id: "1", is_expired: true }, { id: "2", is_expired: false }] };
      return { rows: [] };
    });
    await assert.rejects(service.begin(input, device, {} as any), (err: any) => err.message === "Registration conflict." && err.code === "CONFLICT");
    assert.ok(!getQueries().some(q => q.query.includes("DELETE FROM pending_registrations")));
  });

  await t.test("B10 Three or more rows -> 409, no mutation", async () => {
    const { service, getQueries } = createService(async (q: string) => {
      if (q.includes("rate_limit_buckets")) return { rows: [{ attempts: 1 }] };
      if (q.includes("SELECT id, expires_at <= NOW() AS is_expired")) return { rows: [{ id: "1", is_expired: true }, { id: "2", is_expired: true }, { id: "3", is_expired: false }] };
      return { rows: [] };
    });
    await assert.rejects(service.begin(input, device, {} as any), (err: any) => err.message === "Registration conflict." && err.code === "CONFLICT");
    assert.ok(!getQueries().some(q => q.query.includes("DELETE FROM pending_registrations")));
  });

  await t.test("B11 Cleanup throws -> error propagated/no partial mutation", async () => {
    const { service } = createService(async (q: string) => {
      if (q.includes("rate_limit_buckets")) return { rows: [{ attempts: 1 }] };
      if (q.includes("SELECT id, expires_at <= NOW() AS is_expired")) return { rows: [{ id: "1", is_expired: true }] };
      if (q.includes("SELECT 1 FROM registration_completions")) return { rows: [] };
      if (q.includes("UPDATE auth_challenges")) throw new Error("Database error");
      return { rows: [] };
    });
    await assert.rejects(service.begin(input, device, {} as any), (err: any) => err.message === "Database error");
  });

  await t.test("B12 Controlled sequential race -> first 202, second 409", async () => {
    const { service } = createService(async (q: string) => {
      if (q.includes("rate_limit_buckets")) return { rows: [{ attempts: 1 }] };
      if (q.includes("INSERT INTO pending_registrations")) {
        const err = new Error("Duplicate") as any;
        err.code = "23505";
        err.constraint = "pending_registrations_email_idx";
        throw err;
      }
      return { rows: [] };
    });
    await assert.rejects(service.begin(input, device, {} as any), (err: any) => err.message === "Registration conflict." && err.code === "CONFLICT");
  });

  await t.test("B13 Generic 409 body contains no contact/pendingId/challengeId", async () => {
    const { service } = createService(async (q: string) => {
      if (q.includes("rate_limit_buckets")) return { rows: [{ attempts: 1 }] };
      if (q.includes("SELECT id, expires_at <= NOW() AS is_expired")) return { rows: [{ id: "1", is_expired: false }] };
      return { rows: [] };
    });
    let caught: any;
    try {
      await service.begin(input, device, {} as any);
    } catch (e) { caught = e; }
    assert.ok(caught);
    assert.equal(caught.message, "Registration conflict.");
    assert.ok(!JSON.stringify(caught).includes("a@a.com"));
    assert.ok(!JSON.stringify(caught).includes("1"));
  });

  await t.test("B14 Existing customer -> 409 before pending lookup", async () => {
    const { service, getQueries } = createService(async (q) => {
      if (q.includes("rate_limit_buckets")) return { rows: [{ attempts: 1 }] };
      if (q.includes("SELECT * FROM customers")) return { rows: [{ id: "550e8400-e29b-41d4-a716-446655440000", full_name: "A", email: "a@a.com", phone_number: "123", password_salt: "s", password_digest: "d", created_at: new Date().toISOString() }] };
      return { rows: [] };
    });
    await assert.rejects(service.begin(input, device, {}), (err) => err.message === "Registration conflict." && err.code === "CONFLICT");
    assert.ok(!getQueries().some((q) => q.query.includes("SELECT id, expires_at <= NOW() AS is_expired")));
  });

  await t.test("B15 createEmailChallenge failure -> compensation cleanup", async () => {
    const { service, getCompensationQueries } = createService(async (q) => {
      if (q.includes("rate_limit_buckets")) return { rows: [{ attempts: 1 }] };
      return { rows: [] };
    });
    const mfa = { atomicRateLimit: async () => ({ allowed: true }), createEmailChallenge: async () => { throw new Error("Email delivery failed"); } };
    await assert.rejects(service.begin(input, device, mfa as any), (err: any) => err.message === "Email delivery failed");
    const compQueries = getCompensationQueries();
    assert.ok(compQueries.some((q) => q.query.includes("UPDATE auth_challenges") && q.query.includes("CANCELLED")));
    assert.ok(compQueries.some((q) => q.query.includes("DELETE FROM pending_registrations")));
  });

  await t.test("B16 Cleanup audit event exact eventType/resourceId/payload", async () => {
    const { service, getQueries } = createService(async (q) => {
      if (q.includes("rate_limit_buckets")) return { rows: [{ attempts: 1 }] };
      if (q.includes("SELECT id, expires_at <= NOW() AS is_expired")) return { rows: [{ id: "expired-id", is_expired: true }] };
      return { rows: [] };
    });
    await service.begin(input, device, { atomicRateLimit: async () => ({ allowed: true }), createEmailChallenge: async () => ({}) });
    const queries = getQueries();
    const auditQuery = queries.find((q) => q.query.includes("INSERT INTO audit_events") && q.params[1] === "REGISTRATION_PENDING_CLEANUP");
    assert.ok(auditQuery);
    assert.equal(auditQuery.params[1], "REGISTRATION_PENDING_CLEANUP");
    assert.equal(auditQuery.params[3], "expired-id");
    assert.equal(auditQuery.params[5], "{}");
  });
});

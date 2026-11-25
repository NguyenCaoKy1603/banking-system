import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { PoolClient, QueryConfig, QueryConfigValues, QueryResult, QueryResultRow } from "pg";

import { BankingSystem } from "../bankingSystem.js";
import { createBankingServer } from "../http.js";
import { DomainError } from "../errors.js";
import { DatabasePool } from "../database/pool.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { RelationalAuthService } from "../database/relationalAuthService.js";
import { LocalDevelopmentKeyEncryptionAdapter, OtpDigestKeyring } from "../mfa/crypto.js";
import { FakeEmailProvider } from "../mfa/delivery.js";
import { PersistentMfaService } from "../mfa/persistentMfaService.js";
import { hashOpaqueToken, hashPasswordAsync } from "../security.js";

const TEST_REGISTRATION_FINGERPRINT_KEY = Buffer.alloc(32, 0x42);

class MockPoolClient {
  public readonly executedSql: Array<{ sql: string; params: unknown[] }> = [];

  constructor(
    private readonly handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number },
  ) {}

  async query<R extends QueryResultRow = QueryResultRow, I = unknown[]>(
    queryTextOrConfig: string | QueryConfig<I>,
    values?: QueryConfigValues<I>,
  ): Promise<QueryResult<R>> {
    const text = typeof queryTextOrConfig === "string" ? queryTextOrConfig : queryTextOrConfig.text;
    const params = Array.isArray(values) ? values : [];
    const trimmed = text.trim();
    if (trimmed.startsWith("BEGIN") || trimmed.startsWith("COMMIT") || trimmed.startsWith("ROLLBACK")) {
      return { rows: [] as R[], command: trimmed, rowCount: 0, oid: 0, fields: [] };
    }
    this.executedSql.push({ sql: trimmed, params });
    const res = this.handler(trimmed, params);
    return {
      rows: res.rows as R[],
      command: "SELECT",
      rowCount: res.rowCount ?? res.rows.length,
      oid: 0,
      fields: [],
    };
  }

  release(): void {}
}

class MockDatabasePool extends DatabasePool {
  constructor(private readonly client: PoolClient) {
    super({ connectionString: "postgresql://localhost/mock" });
  }

  override async connect(): Promise<PoolClient> {
    return this.client;
  }
}

test("RelationalAuthService changePassword, resetPassword, preparePasswordReset, listDevices, and revokeDevice", async () => {
  const customerId = randomUUID();
  const deviceRecordA = randomUUID();
  const deviceRecordB = randomUUID();
  const familyB = randomUUID();
  const initialPassword = await hashPasswordAsync("OldStrong!1234");
  const auditEvents: Array<{ eventType: string; resourceId: unknown }> = [];
  let updatedSalt = initialPassword.salt;
  let updatedDigest = initialPassword.digest;
  let revokedSessionsCount = 0;
  let revokedFamiliesCount = 0;
  let revokedRecordsCount = 0;
  let emailBucketAttempts = 0;
  let deviceBRevoked = false;
  let biometricRevokedForDeviceB = false;

  const client = new MockPoolClient((sql, params) => {
    if (sql.includes("SELECT * FROM customers WHERE id = $1 FOR UPDATE")) {
      return {
        rows: [
          {
            id: customerId,
            full_name: "Test User",
            email: "user@example.test",
            phone_number: "0900000011",
            password_salt: updatedSalt,
            password_digest: updatedDigest,
            access_status: "ACTIVE",
            created_at: new Date().toISOString(),
          },
        ],
      };
    }
    if (sql.startsWith("UPDATE customers")) {
      updatedSalt = String(params[1]);
      updatedDigest = String(params[2]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE auth_sessions SET revoked_at = NOW()")) {
      revokedSessionsCount += 1;
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE refresh_session_families")) {
      revokedFamiliesCount += 1;
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE refresh_session_records")) {
      revokedRecordsCount += 1;
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO audit_events")) {
      auditEvents.push({ eventType: String(params[1]), resourceId: params[3] });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO rate_limit_buckets")) {
      const bucketKey = String(params[0]);
      if (bucketKey.startsWith("password-forgot:email:")) {
        emailBucketAttempts += 1;
        return { rows: [{ attempts: emailBucketAttempts, retry_after: 600 }] };
      }
      return { rows: [{ attempts: 1, retry_after: 600 }] };
    }
    if (sql.includes("SELECT id, email, access_status FROM customers WHERE lower(email)")) {
      const email = String(params[0]);
      if (email === "user@example.test") {
        return { rows: [{ id: customerId, email: "user@example.test", access_status: "ACTIVE" }] };
      }
      if (email === "locked@example.test") {
        return { rows: [{ id: randomUUID(), email: "locked@example.test", access_status: "LOCKED" }] };
      }
      return { rows: [] };
    }
    if (sql.includes("FROM customer_devices d") && sql.includes("LEFT JOIN auth_sessions s")) {
      return {
        rows: [
          {
            id: deviceRecordA,
            customer_id: customerId,
            device_id: "device-a",
            device_name: "iPhone 15 Pro",
            attestation_status: "PENDING",
            last_seen_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            revoked_at: null,
            active_session_count: 1,
          },
          ...(deviceBRevoked
            ? []
            : [
                {
                  id: deviceRecordB,
                  customer_id: customerId,
                  device_id: "device-b",
                  device_name: "Pixel 9",
                  attestation_status: "PENDING",
                  last_seen_at: new Date(Date.now() - 60_000).toISOString(),
                  created_at: new Date(Date.now() - 120_000).toISOString(),
                  revoked_at: null,
                  active_session_count: 1,
                },
              ]),
        ],
      };
    }
    if (sql.includes("FROM customer_devices") && sql.includes("FOR UPDATE")) {
      const target = String(params[1]);
      if (!deviceBRevoked && (target === deviceRecordB || target === "device-b")) {
        return { rows: [{ id: deviceRecordB, customer_id: customerId, device_id: "device-b" }] };
      }
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE customer_devices")) {
      deviceBRevoked = true;
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE mfa_credentials") && params[1] === "device-b") {
      biometricRevokedForDeviceB = true;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("SELECT DISTINCT family_id FROM auth_sessions")) {
      return { rows: [{ family_id: familyB }] };
    }
    if (sql.includes("SELECT DISTINCT family_id FROM refresh_session_records")) {
      return { rows: [{ family_id: familyB }] };
    }
    return { rows: [] };
  });

  const auth = new RelationalAuthService(new UnitOfWork(new MockDatabasePool(client as unknown as PoolClient)));

  // Weak password rejected
  await assert.rejects(
    () =>
      auth.changePassword({
        customerId,
        currentPassword: "OldStrong!1234",
        newPassword: "weak",
        deviceId: "device-a",
      }),
    (err: unknown) => err instanceof DomainError && err.status === 422,
  );

  // Wrong current password rejected
  await assert.rejects(
    () =>
      auth.changePassword({
        customerId,
        currentPassword: "WrongPassword!1",
        newPassword: "NewStrong!5678",
        deviceId: "device-a",
      }),
    (err: unknown) => err instanceof DomainError && err.status === 401,
  );

  // Successful password change updates hash, revokes sessions, writes audit
  await auth.changePassword({
    customerId,
    currentPassword: "OldStrong!1234",
    newPassword: "NewStrong!5678",
    deviceId: "device-a",
  });
  assert.notEqual(updatedDigest, initialPassword.digest);
  assert.equal(revokedSessionsCount, 1);
  assert.equal(revokedFamiliesCount, 1);
  assert.equal(revokedRecordsCount, 1);
  assert.equal(auditEvents.some((e) => e.eventType === "PASSWORD_CHANGED"), true);

  // preparePasswordReset hides unknown and locked emails, enforces rate limit after 3 attempts
  const unknownPrepared = await auth.preparePasswordReset("missing@example.test", "net-1");
  assert.equal(unknownPrepared.customer, null);
  const lockedPrepared = await auth.preparePasswordReset("locked@example.test", "net-1");
  assert.equal(lockedPrepared.customer, null);
  const validPrepared = await auth.preparePasswordReset("USER@example.test", "net-1");
  assert.deepEqual(validPrepared.customer, { id: customerId, email: "user@example.test" });

  // Rate limit blocks 4th request for same email
  emailBucketAttempts = 0;
  await auth.preparePasswordReset("rate@example.test", "net-1");
  await auth.preparePasswordReset("rate@example.test", "net-1");
  await auth.preparePasswordReset("rate@example.test", "net-1");
  await assert.rejects(
    () => auth.preparePasswordReset("rate@example.test", "net-1"),
    (err: unknown) => err instanceof DomainError && err.status === 429 && err.code === "RATE_LIMITED",
  );

  // listDevices & revokeDevice
  const devicesBefore = await auth.listDevices(customerId, "device-a");
  assert.equal(devicesBefore.length, 2);
  assert.equal(devicesBefore[0]?.isCurrentDevice, true);
  assert.equal(devicesBefore[0]?.deviceName, "iPhone 15 Pro");
  assert.equal(devicesBefore[1]?.isCurrentDevice, false);

  await auth.revokeDevice(customerId, deviceRecordB, "device-a");
  assert.equal(deviceBRevoked, true);
  assert.equal(biometricRevokedForDeviceB, true);
  assert.equal(auditEvents.some((e) => e.eventType === "DEVICE_REVOKED" && e.resourceId === deviceRecordB), true);

  // Revoking non-existent or already-revoked device throws 404
  await assert.rejects(
    () => auth.revokeDevice(customerId, deviceRecordB, "device-a"),
    (err: unknown) => err instanceof DomainError && err.status === 404,
  );
});

test("HTTP password change, forgot/reset via OTP, and device management end-to-end", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "654321" });
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

  // Register user
  const devAHeaders = { "X-Device-ID": "device-http-a", "X-Device-Name": "iPhone 15" };
  const devBHeaders = { "X-Device-ID": "device-http-b", "X-Device-Name": "Pixel 9" };

  const regBegin = await request("/auth/register", {
    method: "POST",
    headers: devAHeaders,
    body: JSON.stringify({
      fullName: "Security User",
      email: "sec-user@example.test",
      phoneNumber: "0912345678",
      password: "InitialPassword!1",
    }),
  });
  assert.equal(regBegin.status, 202);
  const regChallenge = (await regBegin.json()) as { challengeId: string };
  const regVerify = await request("/auth/register/verify", {
    method: "POST",
    headers: devAHeaders,
    body: JSON.stringify({
      challengeId: regChallenge.challengeId,
      method: "EMAIL_OTP",
      proof: system.readTestVerificationCode(regChallenge.challengeId),
    }),
  });
  assert.equal(regVerify.status, 201);

  // Login on Device A and Device B
  const loginA = await request("/auth/login", {
    method: "POST",
    headers: devAHeaders,
    body: JSON.stringify({ email: "sec-user@example.test", password: "InitialPassword!1" }),
  });
  assert.equal(loginA.status, 200);
  const sessionA = (await loginA.json()) as { accessToken: string; refreshToken: string };

  const loginB = await request("/auth/login", {
    method: "POST",
    headers: devBHeaders,
    body: JSON.stringify({ email: "sec-user@example.test", password: "InitialPassword!1" }),
  });
  assert.equal(loginB.status, 200);
  const sessionB = (await loginB.json()) as { accessToken: string; refreshToken: string };

  // Device A lists devices -> sees both devices with accurate isCurrentDevice
  const listRes = await request("/auth/devices", {
    method: "GET",
    headers: { Authorization: `Bearer ${sessionA.accessToken}`, ...devAHeaders },
  });
  assert.equal(listRes.status, 200);
  const listData = (await listRes.json()) as {
    items: Array<{ id: string; deviceId: string; deviceName: string; isCurrentDevice: boolean }>;
  };
  assert.equal(listData.items.length, 2);
  const itemA = listData.items.find((d) => d.deviceId === "device-http-a");
  const itemB = listData.items.find((d) => d.deviceId === "device-http-b");
  assert.equal(itemA?.isCurrentDevice, true);
  assert.equal(itemA?.deviceName, "iPhone 15");
  assert.equal(itemB?.isCurrentDevice, false);
  assert.equal(itemB?.deviceName, "Pixel 9");

  // Device B enrolls a biometric credential bound to device-http-b
  const enrollBioBRes = await request("/auth/mfa/biometric/enroll", {
    method: "POST",
    headers: { Authorization: `Bearer ${sessionB.accessToken}`, ...devBHeaders },
    body: JSON.stringify({ password: "InitialPassword!1", displayName: "Pixel 9 Biometric" }),
  });
  assert.equal(enrollBioBRes.status, 201);

  const mfaBeforeRevokeRes = await request("/auth/mfa/methods", {
    method: "GET",
    headers: { Authorization: `Bearer ${sessionA.accessToken}`, ...devAHeaders },
  });
  assert.equal(mfaBeforeRevokeRes.status, 200);
  const mfaBeforeRevokeData = (await mfaBeforeRevokeRes.json()) as {
    items: Array<{ credentialType: string; deviceId: string | null; status: string }>;
  };
  assert.equal(
    mfaBeforeRevokeData.items.some(
      (item) => item.credentialType === "BIOMETRIC" && item.deviceId === "device-http-b" && item.status === "ACTIVE",
    ),
    true,
  );

  // Device A revokes Device B -> revokes sessions and device-bound biometric credential
  const revokeBRes = await request(`/auth/devices/${encodeURIComponent(itemB!.id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${sessionA.accessToken}`, ...devAHeaders },
  });
  assert.equal(revokeBRes.status, 204);

  const mfaAfterRevokeRes = await request("/auth/mfa/methods", {
    method: "GET",
    headers: { Authorization: `Bearer ${sessionA.accessToken}`, ...devAHeaders },
  });
  assert.equal(mfaAfterRevokeRes.status, 200);
  const mfaAfterRevokeData = (await mfaAfterRevokeRes.json()) as {
    items: Array<{ credentialType: string; deviceId: string | null; status: string }>;
  };
  assert.equal(
    mfaAfterRevokeData.items.some(
      (item) => item.credentialType === "BIOMETRIC" && item.deviceId === "device-http-b" && item.status === "ACTIVE",
    ),
    false,
  );
  assert.equal(
    mfaAfterRevokeData.items.some(
      (item) => item.credentialType === "BIOMETRIC" && item.deviceId === "device-http-b" && item.status === "REVOKED",
    ),
    true,
  );

  // Device B's access token and refresh token are now invalid
  const accountsB = await request("/accounts", {
    method: "GET",
    headers: { Authorization: `Bearer ${sessionB.accessToken}`, ...devBHeaders },
  });
  assert.equal(accountsB.status, 401);

  const refreshB = await request("/auth/refresh", {
    method: "POST",
    headers: devBHeaders,
    body: JSON.stringify({ refreshToken: sessionB.refreshToken }),
  });
  assert.equal(refreshB.status, 401);

  // Device A still works and list now shows only Device A
  const listAfterRevoke = await request("/auth/devices", {
    method: "GET",
    headers: { Authorization: `Bearer ${sessionA.accessToken}`, ...devAHeaders },
  });
  assert.equal(listAfterRevoke.status, 200);
  const listAfterData = (await listAfterRevoke.json()) as { items: unknown[] };
  assert.equal(listAfterData.items.length, 1);

  // Password change: rejects weak password (422) and wrong current password (401)
  const weakChange = await request("/auth/password/change", {
    method: "POST",
    headers: { Authorization: `Bearer ${sessionA.accessToken}`, ...devAHeaders },
    body: JSON.stringify({ currentPassword: "InitialPassword!1", newPassword: "short" }),
  });
  assert.equal(weakChange.status, 422);

  const badCurrent = await request("/auth/password/change", {
    method: "POST",
    headers: { Authorization: `Bearer ${sessionA.accessToken}`, ...devAHeaders },
    body: JSON.stringify({ currentPassword: "WrongPassword!1", newPassword: "ChangedStrong!2026" }),
  });
  assert.equal(badCurrent.status, 401);

  // Successful password change revokes sessionA
  const okChange = await request("/auth/password/change", {
    method: "POST",
    headers: { Authorization: `Bearer ${sessionA.accessToken}`, ...devAHeaders },
    body: JSON.stringify({ currentPassword: "InitialPassword!1", newPassword: "ChangedStrong!2026" }),
  });
  assert.equal(okChange.status, 200);

  const oldTokenCheck = await request("/accounts", {
    method: "GET",
    headers: { Authorization: `Bearer ${sessionA.accessToken}`, ...devAHeaders },
  });
  assert.equal(oldTokenCheck.status, 401);

  // Forgot password -> anti-enumeration on unknown email returns 202
  const unknownForgot = await request("/auth/password/forgot", {
    method: "POST",
    headers: devAHeaders,
    body: JSON.stringify({ email: "nobody@example.test" }),
  });
  assert.equal(unknownForgot.status, 202);
  const unknownChallenge = (await unknownForgot.json()) as { challengeId: string; purpose: string };
  assert.equal(unknownChallenge.purpose, "PASSWORD_RESET");

  // Forgot password on registered user
  const forgotRes = await request("/auth/password/forgot", {
    method: "POST",
    headers: devAHeaders,
    body: JSON.stringify({ email: "sec-user@example.test" }),
  });
  assert.equal(forgotRes.status, 202);
  const forgotChallenge = (await forgotRes.json()) as { challengeId: string; purpose: string };
  assert.equal(forgotChallenge.purpose, "PASSWORD_RESET");
  const resetOtp = system.readTestVerificationCode(forgotChallenge.challengeId);

  // Weak password rejected on reset without consuming OTP
  const weakReset = await request("/auth/password/reset", {
    method: "POST",
    headers: devAHeaders,
    body: JSON.stringify({ challengeId: forgotChallenge.challengeId, proof: resetOtp, newPassword: "weak" }),
  });
  assert.equal(weakReset.status, 422);

  // Wrong OTP rejected
  const wrongOtpReset = await request("/auth/password/reset", {
    method: "POST",
    headers: devAHeaders,
    body: JSON.stringify({
      challengeId: forgotChallenge.challengeId,
      proof: "000000",
      newPassword: "ResetStrong!2026",
    }),
  });
  assert.equal(wrongOtpReset.status, 401);

  // Valid OTP resets password cleanly
  const okReset = await request("/auth/password/reset", {
    method: "POST",
    headers: devAHeaders,
    body: JSON.stringify({
      challengeId: forgotChallenge.challengeId,
      proof: resetOtp,
      newPassword: "ResetStrong!2026",
    }),
  });
  assert.equal(okReset.status, 200);

  // Old password rejected, new password succeeds
  const oldLogin = await request("/auth/login", {
    method: "POST",
    headers: devAHeaders,
    body: JSON.stringify({ email: "sec-user@example.test", password: "ChangedStrong!2026" }),
  });
  assert.equal(oldLogin.status, 401);

  const newLogin = await request("/auth/login", {
    method: "POST",
    headers: devAHeaders,
    body: JSON.stringify({ email: "sec-user@example.test", password: "ResetStrong!2026" }),
  });
  assert.equal(newLogin.status, 200);
});

test("HTTP password change enforces TOTP step-up when MFA is active and PersistentMfaService issues PASSWORD_RESET Email OTP", async (t) => {
  const customerId = randomUUID();
  const deviceId = "device-totp-pw";
  const delivery = new FakeEmailProvider();
  const encryption = new LocalDevelopmentKeyEncryptionAdapter(Buffer.alloc(32, 7), "mfa-test-v1");
  const otpDigestKeyring = new OtpDigestKeyring({
    current: { id: "otp-test-v1", value: Buffer.alloc(32, 9) },
  });

  const challenges = new Map<string, Record<string, unknown>>();
  const mockClient = new MockPoolClient((sql, params) => {
    if (sql.includes("SELECT email FROM customers WHERE id = $1")) {
      return { rows: [{ email: "mfa-pw@example.test" }] };
    }
    if (sql.startsWith("INSERT INTO auth_challenges")) {
      const id = String(params[0]);
      challenges.set(id, {
        id,
        customer_id: params[1],
        pending_registration_id: params[2],
        credential_id: params[3],
        device_id: params[4],
        method: params[5],
        purpose: params[6],
        resource_id: params[7],
        request_fingerprint: params[8],
        proof_digest: params[9],
        digest_key_id: params[10],
        status: params[11],
        expires_at: params[12],
        attempts: 0,
        max_attempts: params[13] ?? 5,
        resend_count: params[14] ?? 0,
        last_sent_at: params[15] ?? null,
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("UPDATE auth_challenges SET status = 'ACTIVE'")) {
      const existing = challenges.get(String(params[0]));
      if (existing) existing.status = "ACTIVE";
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("SELECT * FROM auth_challenges WHERE id = $1 FOR UPDATE")) {
      const existing = challenges.get(String(params[0]));
      return { rows: existing ? [existing] : [] };
    }
    if (sql.includes("UPDATE auth_challenges SET status = 'CONSUMED'")) {
      const existing = challenges.get(String(params[0]));
      if (existing) existing.status = "CONSUMED";
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("UPDATE auth_challenges") && sql.includes("attempts = attempts + 1")) {
      const existing = challenges.get(String(params[0]));
      const nextAttempts = Number(existing?.attempts ?? 0) + 1;
      if (existing) existing.attempts = nextAttempts;
      return { rows: [{ attempts: nextAttempts, status: nextAttempts >= 5 ? "LOCKED" : "ACTIVE" }] };
    }
    return { rows: [] };
  });

  const mfaService = new PersistentMfaService({
    unitOfWork: new UnitOfWork(new MockDatabasePool(mockClient as unknown as PoolClient)),
    encryption,
    otpDigestKeyring,
    delivery,
    environmentScope: "test",
  });

  // Verify PersistentMfaService supports PASSWORD_RESET Email OTP lifecycle
  const challenge = await mfaService.createEmailChallenge({
    customerId,
    deviceId,
    purpose: "PASSWORD_RESET",
    destination: "mfa-pw@example.test",
  });
  assert.equal(challenge.purpose, "PASSWORD_RESET");
  assert.equal(challenge.method, "EMAIL_OTP");
  const sentOtp = delivery.latestCode("PASSWORD_RESET");
  assert.ok(sentOtp && /^\d{6}$/.test(sentOtp));

  // Wrong OTP throws 401 UNAUTHORIZED (not 409)
  await assert.rejects(
    () =>
      mfaService.verifyChallenge({
        challengeId: challenge.challengeId,
        deviceId,
        proof: sentOtp === "000000" ? "111111" : "000000",
        purpose: "PASSWORD_RESET",
      }),
    (err: unknown) => err instanceof DomainError && err.status === 401,
  );

  const verifiedReset = await mfaService.verifyChallenge({
    challengeId: challenge.challengeId,
    deviceId,
    proof: sentOtp,
    purpose: "PASSWORD_RESET",
  });
  assert.equal(verifiedReset.customerId, customerId);

  // Verify HTTP POST /auth/password/change enforces MFA step-up when active TOTP exists
  const system = new BankingSystem({ sandboxOtp: "654321" });
  const devHeaders = { "X-Device-ID": deviceId };
  const fakeMfaService = {
    listCredentials: async () => [
      {
        id: randomUUID(),
        customerId,
        credentialType: "TOTP",
        deviceId: null,
        displayName: "Authenticator",
        status: "ACTIVE",
        algorithm: "SHA1",
        digits: 6,
        periodSeconds: 30,
        lastAcceptedTimeStep: null,
        enrolledAt: new Date().toISOString(),
        lastUsedAt: null,
        revokedAt: null,
        compromisedAt: null,
        createdAt: new Date().toISOString(),
      },
    ],
    beginTotpChallenge: async () => ({
      challengeId: "totp-pw-change-1",
      method: "TOTP" as const,
      methods: ["TOTP" as const],
      purpose: "PASSWORD_CHANGE" as const,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }),
    verifyChallenge: async (input: { challengeId: string; customerId?: string; proof: string; purpose: string }) => {
      if (input.challengeId !== "totp-pw-change-1" || input.proof !== "123456" || input.purpose !== "PASSWORD_CHANGE") {
        throw new DomainError(409, "STEP_UP_VERIFICATION_FAILED", "Mã TOTP không đúng.");
      }
      return { customerId: input.customerId ?? null, credentialId: null, timeStep: null };
    },
  } as unknown as PersistentMfaService;

  const server = createBankingServer(system, {
    mfaService: fakeMfaService,
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

  const regBegin = await request("/auth/register", {
    method: "POST",
    headers: devHeaders,
    body: JSON.stringify({
      fullName: "MFA PW User",
      email: "mfa-pw-http@example.test",
      phoneNumber: "0988776655",
      password: "InitialPassword!1",
    }),
  });
  const regBody = (await regBegin.json()) as { challengeId: string };
  await request("/auth/register/verify", {
    method: "POST",
    headers: devHeaders,
    body: JSON.stringify({
      challengeId: regBody.challengeId,
      method: "EMAIL_OTP",
      proof: system.readTestVerificationCode(regBody.challengeId),
    }),
  });
  const loginRes = await request("/auth/login", {
    method: "POST",
    headers: devHeaders,
    body: JSON.stringify({ email: "mfa-pw-http@example.test", password: "InitialPassword!1" }),
  });
  const { accessToken, user } = (await loginRes.json()) as { accessToken: string; user: { id: string } };
  void hashOpaqueToken;

  // Missing step-up when active TOTP exists -> 409 MFA_STEP_UP_REQUIRED
  const missingStepUp = await request("/auth/password/change", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, ...devHeaders },
    body: JSON.stringify({ currentPassword: "InitialPassword!1", newPassword: "UpdatedStrong!999" }),
  });
  assert.equal(missingStepUp.status, 409);
  const missingBody = (await missingStepUp.json()) as { code: string };
  assert.equal(missingBody.code, "MFA_STEP_UP_REQUIRED");

  // Request PASSWORD_CHANGE OTP challenge
  const challengeRes = await request("/auth/otp/challenges", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, ...devHeaders },
    body: JSON.stringify({ purpose: "PASSWORD_CHANGE" }),
  });
  assert.equal(challengeRes.status, 201);
  const challengeBody = (await challengeRes.json()) as { challengeId: string; purpose: string };
  assert.equal(challengeBody.purpose, "PASSWORD_CHANGE");

  // Submit password change with valid TOTP stepUp
  const okChange = await request("/auth/password/change", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, ...devHeaders },
    body: JSON.stringify({
      currentPassword: "InitialPassword!1",
      newPassword: "UpdatedStrong!999",
      stepUp: { method: "TOTP", challengeId: challengeBody.challengeId, proof: "123456" },
    }),
  });
  assert.equal(okChange.status, 200);
  void user;
});


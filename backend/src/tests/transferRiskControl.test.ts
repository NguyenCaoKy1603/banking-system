import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PoolClient, QueryConfig, QueryConfigValues, QueryResult, QueryResultRow } from "pg";

import { RelationalConflictError } from "../database/commandErrors.js";
import { ControlPolicyRepository } from "../database/controlPolicyRepository.js";
import { DatabasePool } from "../database/pool.js";
import { RelationalTransferService } from "../database/transferService.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { DomainError } from "../errors.js";
import {
  computeBiometricAssertion,
  LocalDevelopmentKeyEncryptionAdapter,
  OtpDigestKeyring,
} from "../mfa/crypto.js";
import { PersistentMfaService } from "../mfa/persistentMfaService.js";
import { hashOpaqueToken } from "../security.js";

class MockPoolClient {
  public readonly executedSql: string[] = [];

  constructor(
    private readonly queryHandler: (
      sql: string,
      params: unknown[],
    ) => { rows: unknown[]; rowCount?: number } | Promise<{ rows: unknown[]; rowCount?: number }>,
  ) {}

  async query<R extends QueryResultRow = QueryResultRow, I = unknown[]>(
    queryTextOrConfig: string | QueryConfig<I>,
    values?: QueryConfigValues<I>,
  ): Promise<QueryResult<R>> {
    const text = typeof queryTextOrConfig === "string" ? queryTextOrConfig : queryTextOrConfig.text;
    const params = Array.isArray(values) ? values : [];
    const trimmed = text.replace(/\s+/g, " ").trim();
    this.executedSql.push(trimmed);
    if (trimmed.startsWith("BEGIN") || trimmed.startsWith("COMMIT") || trimmed.startsWith("ROLLBACK")) {
      return { rows: [] as R[], command: trimmed, rowCount: 0, oid: 0, fields: [] };
    }
    const res = await this.queryHandler(trimmed, params);
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

function buildPolicyRow(overrides?: { maxTransferMinor?: string; dailyLimitMinor?: string }) {
  return {
    config_version: "v1",
    global_kill_switch: false,
    transfers_enabled: true,
    allowlist_enabled: false,
    max_transfer_amount_minor: overrides?.maxTransferMinor ?? "20000000",
    daily_transfer_limit_minor: overrides?.dailyLimitMinor ?? "50000000",
    step_up_methods: ["TOTP"],
    savings_enabled: true,
    savings_allowlist_enabled: false,
    max_savings_amount_minor: "100000000",
    savings_step_up_methods: ["TOTP"],
    credit_enabled: true,
    credit_allowlisted: false,
    credit_payments_enabled: true,
    card_controls_enabled: true,
    max_credit_payment_amount_minor: "100000000",
    credit_payment_step_up_methods: ["TOTP"],
    card_unlock_step_up_methods: ["TOTP"],
    updated_at: new Date().toISOString(),
  };
}

test("ControlPolicyRepository.assertTransferAllowed enforces cumulative daily transfer limit", async () => {
  const customerId = randomUUID();
  let dailyTotalMinor = "40000000";

  const mockClient = new MockPoolClient((sql) => {
    if (sql.includes("FROM control_policy")) {
      return { rows: [buildPolicyRow({ maxTransferMinor: "20000000", dailyLimitMinor: "50000000" })] };
    }
    if (sql.includes("AS daily_total_minor")) {
      return { rows: [{ daily_total_minor: dailyTotalMinor }] };
    }
    return { rows: [] };
  });

  const repo = new ControlPolicyRepository(mockClient as unknown as PoolClient);

  // 40M + 10M = 50M <= 50M daily limit -> allowed
  await repo.assertTransferAllowed(customerId, 10_000_000n);

  // 45M + 5.000.001 = 50.000.001 > 50M daily limit (even though single transfer <= 20M) -> 409 DAILY_TRANSFER_LIMIT_EXCEEDED
  dailyTotalMinor = "45000000";
  await assert.rejects(
    () => repo.assertTransferAllowed(customerId, 5_000_001n),
    (err: unknown) =>
      err instanceof RelationalConflictError &&
      err.status === 409 &&
      err.code === "DAILY_TRANSFER_LIMIT_EXCEEDED",
  );
});

test("PersistentMfaService enforces tiered Biometric eligibility and blocks biometric proof on TOTP challenges", async () => {
  const customerId = randomUUID();
  const sourceAccountId = randomUUID();
  const destinationAccountId = randomUUID();
  const quoteId = randomUUID();
  const totpCredentialId = randomUUID();
  let biometricCredentialId: string = randomUUID();
  let biometricSecretCiphertext = "";
  const deviceId = "device-tiered-mfa";
  const nowMs = Date.parse("2026-11-18T07:00:00.000Z"); // 14:00 Vietnam time
  const nowIso = new Date(nowMs).toISOString();

  const encryption = new LocalDevelopmentKeyEncryptionAdapter(Buffer.alloc(32, 7), "mfa-test-v1");
  const otpDigestKeyring = new OtpDigestKeyring({
    current: { id: "otp-test-v1", value: Buffer.alloc(32, 9) },
  });

  let quoteAmountMinor = "500000";
  let velocityRecent10m = 0;
  let velocitySameRecipient15m = 0;
  let activeChallengeRow: Record<string, unknown> | null = null;
  let biometricSecretPlain = "";

  const mockClient = new MockPoolClient((sql, params) => {
    if (sql.includes("INSERT INTO rate_limit_buckets")) {
      return { rows: [{ attempts: 1, retry_after: 600 }] };
    }
    if (sql.includes("UPDATE mfa_credentials SET status = 'REVOKED'")) {
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO mfa_credentials")) {
      biometricCredentialId = String(params[0]);
      biometricSecretCiphertext = String(params[4]);
      return {
        rows: [
          {
            id: biometricCredentialId,
            customer_id: params[1],
            credential_type: "BIOMETRIC",
            device_id: params[2],
            display_name: params[3],
            status: "ACTIVE",
            secret_ciphertext: biometricSecretCiphertext,
            secret_key_id: params[5],
            algorithm: "HMAC-SHA256",
            digits: 6,
            period_seconds: 30,
            last_accepted_time_step: null,
            enrolled_at: nowIso,
            last_used_at: null,
            revoked_at: null,
            compromised_at: null,
            created_at: nowIso,
          },
        ],
      };
    }
    if (sql.includes("INSERT INTO auth_security_events")) {
      return { rows: [] };
    }
    if (sql.includes("FROM mfa_credentials WHERE customer_id = $1 AND credential_type = 'BIOMETRIC'")) {
      return {
        rows: [
          {
            id: biometricCredentialId,
            customer_id: customerId,
            credential_type: "BIOMETRIC",
            device_id: deviceId,
            display_name: "Face ID",
            status: "ACTIVE",
            secret_ciphertext: biometricSecretCiphertext,
            secret_key_id: encryption.keyId,
            algorithm: "HMAC-SHA256",
            digits: 6,
            period_seconds: 30,
            last_accepted_time_step: null,
            enrolled_at: nowIso,
            last_used_at: null,
            revoked_at: null,
            compromised_at: null,
            created_at: nowIso,
          },
        ],
      };
    }
    if (sql.includes("FROM mfa_credentials WHERE customer_id = $1 AND credential_type = 'TOTP'")) {
      return {
        rows: [
          {
            id: totpCredentialId,
            customer_id: customerId,
            credential_type: "TOTP",
            device_id: null,
            display_name: "Authenticator",
            status: "ACTIVE",
            secret_ciphertext: encryption.encrypt("JBSWY3DPEHPK3PXP", {
              environment: "test",
              recordType: "mfa-totp",
              recordId: totpCredentialId,
              subjectId: customerId,
              schemaVersion: "026",
            }),
            secret_key_id: encryption.keyId,
            algorithm: "SHA1",
            digits: 6,
            period_seconds: 30,
            last_accepted_time_step: null,
            enrolled_at: nowIso,
            last_used_at: null,
            revoked_at: null,
            compromised_at: null,
            created_at: nowIso,
          },
        ],
      };
    }
    if (sql.includes("FROM mfa_credentials WHERE id = $1 FOR UPDATE")) {
      const id = String(params[0]);
      if (id === biometricCredentialId) {
        return {
          rows: [
            {
              id: biometricCredentialId,
              customer_id: customerId,
              credential_type: "BIOMETRIC",
              device_id: deviceId,
              display_name: "Face ID",
              status: "ACTIVE",
              secret_ciphertext: biometricSecretCiphertext,
              secret_key_id: encryption.keyId,
              algorithm: "HMAC-SHA256",
              digits: 6,
              period_seconds: 30,
              last_accepted_time_step: null,
              enrolled_at: nowIso,
              last_used_at: null,
              revoked_at: null,
              compromised_at: null,
              created_at: nowIso,
            },
          ],
        };
      }
      return {
        rows: [
          {
            id: totpCredentialId,
            customer_id: customerId,
            credential_type: "TOTP",
            device_id: null,
            display_name: "Authenticator",
            status: "ACTIVE",
            secret_ciphertext: encryption.encrypt("JBSWY3DPEHPK3PXP", {
              environment: "test",
              recordType: "mfa-totp",
              recordId: totpCredentialId,
              subjectId: customerId,
              schemaVersion: "026",
            }),
            secret_key_id: encryption.keyId,
            algorithm: "SHA1",
            digits: 6,
            period_seconds: 30,
            last_accepted_time_step: null,
            enrolled_at: nowIso,
            last_used_at: null,
            revoked_at: null,
            compromised_at: null,
            created_at: nowIso,
          },
        ],
      };
    }
    if (sql.includes("FROM transfer_quotes WHERE id = $1")) {
      return {
        rows: [
          {
            customer_id: customerId,
            source_account_id: sourceAccountId,
            destination_account_id: destinationAccountId,
            beneficiary_id: randomUUID(),
            amount_minor: quoteAmountMinor,
            fee_minor: "1000",
          },
        ],
      };
    }
    if (sql.includes("SELECT available_minor::text FROM payment_accounts WHERE id = $1")) {
      return { rows: [{ available_minor: "10000000" }] };
    }
    if (sql.includes("COUNT(*) FILTER")) {
      return { rows: [{ recent_10m: velocityRecent10m, same_recipient_15m: velocitySameRecipient15m }] };
    }
    if (sql.includes("AS has_prior")) {
      return { rows: [{ has_prior: true }] };
    }
    if (sql.includes("INSERT INTO auth_challenges")) {
      activeChallengeRow = {
        id: params[0],
        customer_id: params[1],
        pending_registration_id: params[2] ?? null,
        credential_id: params[3] ?? null,
        device_id: params[4],
        method: params[5],
        purpose: params[6],
        resource_id: params[7] ?? null,
        request_fingerprint: params[8] ?? null,
        status: "ACTIVE",
        proof_digest: null,
        digest_key_id: null,
        expires_at: new Date(nowMs + 300_000).toISOString(),
        attempts: 0,
        max_attempts: 5,
        resend_count: 0,
        last_sent_at: null,
      };
      return { rows: [] };
    }
    if (sql.includes("FROM auth_challenges WHERE id = $1 FOR UPDATE")) {
      return {
        rows: activeChallengeRow && activeChallengeRow.id === params[0] ? [activeChallengeRow] : [],
      };
    }
    if (sql.includes("UPDATE auth_challenges SET attempts = attempts + 1")) {
      return { rows: [{ attempts: 1, status: "ACTIVE" }] };
    }
    if (sql.includes("UPDATE auth_challenges SET status = 'CONSUMED'")) {
      return { rows: [{ id: params[0] }], rowCount: 1 };
    }
    return { rows: [] };
  });

  const service = new PersistentMfaService({
    unitOfWork: new UnitOfWork(new MockDatabasePool(mockClient as unknown as PoolClient)),
    encryption,
    otpDigestKeyring,
    environmentScope: "test",
    clock: () => nowMs,
  });

  const enrolled = await service.enrollBiometricCredential({ customerId, deviceId });
  biometricSecretPlain = enrolled.biometricSecret;

  // 1. Transfer < 1,000,000 VND & LOW risk -> BIOMETRIC challenge succeeds and verifies
  const bioChallenge = await service.beginBiometricChallenge({
    customerId,
    deviceId,
    purpose: "TRANSFER",
    resourceId: quoteId,
    requestFingerprint: "fp-bio",
  });
  assert.equal(bioChallenge.method, "BIOMETRIC");
  assert.equal(
    (activeChallengeRow as Record<string, unknown> | null)?.id,
    hashOpaqueToken(bioChallenge.challengeId),
  );

  const validBioProof = computeBiometricAssertion(biometricSecretPlain, {
    challengeId: bioChallenge.challengeId,
    deviceId,
    purpose: "TRANSFER",
    resourceId: quoteId,
  });
  const verifiedBio = await service.verifyChallenge({
    challengeId: bioChallenge.challengeId,
    customerId,
    deviceId,
    proof: validBioProof,
    purpose: "TRANSFER",
    resourceId: quoteId,
    requestFingerprint: "fp-bio",
  });
  assert.equal(verifiedBio.customerId, customerId);

  // 2. Transfer <= 1,000,000 VND (exact boundary) succeeds, while > 1,000,000 VND -> 409 BIOMETRIC_TIER_LIMIT_EXCEEDED
  quoteAmountMinor = "1000000";
  const boundaryBioChallenge = await service.beginBiometricChallenge({
    customerId,
    deviceId,
    purpose: "TRANSFER",
    resourceId: quoteId,
    requestFingerprint: "fp-bio-boundary",
  });
  assert.equal(boundaryBioChallenge.method, "BIOMETRIC");

  quoteAmountMinor = "1000001";
  await assert.rejects(
    () =>
      service.beginBiometricChallenge({
        customerId,
        deviceId,
        purpose: "TRANSFER",
        resourceId: quoteId,
      }),
    (err: unknown) =>
      err instanceof DomainError &&
      err.status === 409 &&
      err.code === "BIOMETRIC_TIER_LIMIT_EXCEEDED",
  );

  // 3. Transfer < 1,000,000 VND but HIGH risk (velocity spike + repeated recipient = 75 score = CRITICAL) -> rejected
  quoteAmountMinor = "900000";
  velocityRecent10m = 4;
  velocitySameRecipient15m = 2;
  await assert.rejects(
    () =>
      service.beginBiometricChallenge({
        customerId,
        deviceId,
        purpose: "TRANSFER",
        resourceId: quoteId,
      }),
    (err: unknown) =>
      err instanceof DomainError &&
      err.status === 409 &&
      err.code === "BIOMETRIC_HIGH_RISK_NOT_ALLOWED",
  );

  // 4. TOTP challenge must NOT accept biometric-v1.* proof
  const totpChallenge = await service.beginTotpChallenge({
    customerId,
    deviceId,
    purpose: "TRANSFER",
    resourceId: quoteId,
    requestFingerprint: "fp-totp",
  });
  assert.equal(totpChallenge.method, "TOTP");
  const forgedBioProofForTotp = computeBiometricAssertion(biometricSecretPlain, {
    challengeId: totpChallenge.challengeId,
    deviceId,
    purpose: "TRANSFER",
    resourceId: quoteId,
  });
  await assert.rejects(
    () =>
      service.verifyChallenge({
        challengeId: totpChallenge.challengeId,
        customerId,
        deviceId,
        proof: forgedBioProofForTotp,
        purpose: "TRANSFER",
        resourceId: quoteId,
        requestFingerprint: "fp-totp",
      }),
    (err: unknown) =>
      err instanceof DomainError &&
      err.status === 409 &&
      err.code === "STEP_UP_VERIFICATION_FAILED",
  );
});

test("RelationalTransferService.submit blocks CRITICAL risk transfers before creating transfer or mutating balances", async () => {
  const customerId = randomUUID();
  const recipientId = randomUUID();
  const sourceAccountId = randomUUID();
  const destinationAccountId = randomUUID();
  const quoteId = randomUUID();
  const nightTime = "2026-11-17T19:30:00.000Z"; // 02:30 Vietnam time
  const expiresAt = "2026-11-17T19:35:00.000Z";
  let transferInserted = false;
  let accountUpdated = false;

  const mockClient = new MockPoolClient((sql, params) => {
    if (sql.includes("INSERT INTO command_idempotency")) {
      return {
        rows: [
          {
            id: params[0],
            customer_id: params[1],
            operation_type: params[2],
            idempotency_key: params[3],
            request_fingerprint: params[4],
            aggregate_id: null,
            status: "PENDING",
            response_payload: null,
            created_at: nightTime,
            updated_at: nightTime,
          },
        ],
      };
    }
    if (sql.includes("FROM transfer_quotes WHERE id = $1 FOR UPDATE")) {
      return {
        rows: [
          {
            id: quoteId,
            customer_id: customerId,
            source_account_id: sourceAccountId,
            beneficiary_id: null,
            amount_minor: "4000000",
            fee_minor: "1000",
            expires_at: expiresAt,
            consumed_at: null,
            request_fingerprint: "fp-critical",
            consumed_transfer_id: null,
            destination_account_id: destinationAccountId,
            destination_owner_id: recipientId,
            destination_owner_name: "New Recipient",
          },
        ],
      };
    }
    if (sql.includes("FROM control_policy")) {
      return { rows: [buildPolicyRow()] };
    }
    if (sql.includes("AS daily_total_minor")) {
      return { rows: [{ daily_total_minor: "0" }] };
    }
    if (sql.includes("FROM payment_accounts WHERE id = ANY($1::uuid[])")) {
      return {
        rows: [
          {
            id: sourceAccountId,
            customer_id: customerId,
            display_name: "Source",
            account_number: "970400000001",
            masked_number: "•••• 0001",
            bank_name: "Ngân hàng reference",
            available_minor: "4500000", // >80% drain
            current_minor: "4500000",
            held_minor: "0",
            status: "ACTIVE",
            version: "0",
            updated_at: nightTime,
          },
          {
            id: destinationAccountId,
            customer_id: recipientId,
            display_name: "Destination",
            account_number: "970400000002",
            masked_number: "•••• 0002",
            bank_name: "Ngân hàng reference",
            available_minor: "0",
            current_minor: "0",
            held_minor: "0",
            status: "ACTIVE",
            version: "0",
            updated_at: nightTime,
          },
        ].sort((a, b) => a.id.localeCompare(b.id)),
      };
    }
    if (sql.includes("COUNT(*) FILTER")) {
      return { rows: [{ recent_10m: 4, same_recipient_15m: 2 }] };
    }
    if (sql.includes("AS has_prior")) {
      return { rows: [{ has_prior: false }] };
    }
    if (sql.includes("INSERT INTO transfers")) {
      transferInserted = true;
      return { rows: [] };
    }
    if (sql.includes("UPDATE payment_accounts")) {
      accountUpdated = true;
      return { rows: [] };
    }
    return { rows: [] };
  });

  const service = new RelationalTransferService(
    new UnitOfWork(new MockDatabasePool(mockClient as unknown as PoolClient)),
  );

  await assert.rejects(
    () =>
      service.submit({
        customerId,
        idempotencyKey: "critical-block-key-0001",
        requestFingerprint: "fp-critical",
        quoteId,
        now: nightTime,
      }),
    (err: unknown) =>
      err instanceof RelationalConflictError &&
      err.status === 409 &&
      err.code === "CRITICAL_ANOMALY_BLOCKED",
  );
  assert.equal(transferInserted, false);
  assert.equal(accountUpdated, false);
});

test("POST /transfers enforces confirmHighRisk on CRITICAL risk and accepts when confirmHighRisk=true", async (t) => {
  const { BankingSystem } = await import("../bankingSystem.js");
  const { createBankingServer } = await import("../http.js");
  const { computeRegistrationNetworkFingerprint } = await import("../security.js");
  void computeRegistrationNetworkFingerprint;

  let clockMs = Date.UTC(2026, 10, 17, 19, 30, 0); // 02:30 Vietnam time (night hour rule)
  const system = new BankingSystem({
    sandboxOtp: "123456",
    allowUnsafeDirectSandboxStepUp: true,
    clock: () => clockMs,
  });
  const server = createBankingServer(system, {
    registrationFingerprintKey: Buffer.alloc(32, 0x42),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const headers = { "Content-Type": "application/json", "X-Device-ID": "dev-critical-http" };

  const registerAndLogin = async (email: string, phone: string, fullName: string) => {
    const reg = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers,
      body: JSON.stringify({ fullName, email, phoneNumber: phone, password: "Password!1234" }),
    });
    const regBody = (await reg.json()) as { challengeId: string };
    await fetch(`${baseUrl}/auth/register/verify`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        challengeId: regBody.challengeId,
        method: "EMAIL_OTP",
        proof: system.readTestVerificationCode(regBody.challengeId),
      }),
    });
    const login = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, password: "Password!1234" }),
    });
    return (await login.json()) as { accessToken: string; user: { id: string } };
  };

  const sender = await registerAndLogin("crit-sender@example.test", "0901112233", "Crit Sender");
  const receiver = await registerAndLogin("crit-recv@example.test", "0901112244", "Crit Receiver");

  const receiverAccountsRes = await fetch(`${baseUrl}/accounts`, {
    headers: { ...headers, Authorization: `Bearer ${receiver.accessToken}` },
  });
  const receiverAccounts = (await receiverAccountsRes.json()) as { accounts: Array<{ id: string }> };
  const receiverNumberRes = await fetch(`${baseUrl}/accounts/${receiverAccounts.accounts[0]!.id}/number`, {
    headers: { ...headers, Authorization: `Bearer ${receiver.accessToken}` },
  });
  const receiverNumber = ((await receiverNumberRes.json()) as { accountNumber: string }).accountNumber;

  const senderAccountsRes = await fetch(`${baseUrl}/accounts`, {
    headers: { ...headers, Authorization: `Bearer ${sender.accessToken}` },
  });
  const senderAccounts = (await senderAccountsRes.json()) as { accounts: Array<{ id: string }> };
  const senderAccountId = senderAccounts.accounts[0]!.id;
  const senderNumberRes = await fetch(`${baseUrl}/accounts/${senderAccountId}/number`, {
    headers: { ...headers, Authorization: `Bearer ${sender.accessToken}` },
  });
  const senderNumber = ((await senderNumberRes.json()) as { accountNumber: string }).accountNumber;
  system.seedReferenceFunding("crit-seed-funding", {
    recipientAccountNumber: senderNumber,
    amount: { currency: "VND", amountMinor: "5000000" },
    reason: "Seed test balance",
  });

  const lookupRes = await fetch(`${baseUrl}/internal-recipients/lookup`, {
    method: "POST",
    headers: { ...headers, Authorization: `Bearer ${sender.accessToken}` },
    body: JSON.stringify({ accountNumber: receiverNumber }),
  });
  const lookupId = ((await lookupRes.json()) as { recipient: { lookupId: string } }).recipient.lookupId;

  // High value (>=3.5M, +35) + >80% drain (+30) + new recipient (+30) + night hour (+25) => CRITICAL (100)
  const quoteRes = await fetch(`${baseUrl}/transfers/quote`, {
    method: "POST",
    headers: { ...headers, Authorization: `Bearer ${sender.accessToken}` },
    body: JSON.stringify({
      sourceAccountId: senderAccountId,
      lookupId,
      amount: { currency: "VND", amountMinor: "4500000" },
    }),
  });
  assert.equal(quoteRes.status, 200);
  const quote = (await quoteRes.json()) as { quoteId: string };

  const blockedSubmit = await fetch(`${baseUrl}/transfers`, {
    method: "POST",
    headers: {
      ...headers,
      Authorization: `Bearer ${sender.accessToken}`,
      "Idempotency-Key": "crit-blocked-idem-0001",
    },
    body: JSON.stringify({
      quoteId: quote.quoteId,
      stepUp: { method: "OTP", proof: "123456" },
    }),
  });
  assert.equal(blockedSubmit.status, 409);
  const blockedBody = (await blockedSubmit.json()) as { code: string };
  assert.equal(blockedBody.code, "CRITICAL_ANOMALY_BLOCKED");

  const confirmedSubmit = await fetch(`${baseUrl}/transfers`, {
    method: "POST",
    headers: {
      ...headers,
      Authorization: `Bearer ${sender.accessToken}`,
      "Idempotency-Key": "crit-confirm-idem-0001",
    },
    body: JSON.stringify({
      quoteId: quote.quoteId,
      confirmHighRisk: true,
      stepUp: { method: "OTP", proof: "123456" },
    }),
  });
  assert.equal(confirmedSubmit.status, 200);
  const receipt = (await confirmedSubmit.json()) as { status: string; anomalyAssessment?: { riskLevel: string } };
  assert.equal(receipt.status, "SUCCEEDED");
  assert.equal(receipt.anomalyAssessment?.riskLevel, "CRITICAL");
  void clockMs;
});

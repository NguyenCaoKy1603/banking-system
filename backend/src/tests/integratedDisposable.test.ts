import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { BankingSystem } from "../bankingSystem.js";
import { createPersistentBankingServer } from "../http.js";
import { PostgresRelationalRepository } from "../postgresRelationalRepository.js";
import { KeyEncryptionKeyringAdapter, LocalDevelopmentKeyEncryptionAdapter, OtpDigestKeyring } from "../mfa/crypto.js";
import { PersistentMfaService } from "../mfa/persistentMfaService.js";
import { HttpEmailProvider } from "../mfa/httpEmailProvider.js";
import { RelationalHttpBoundary } from "../database/relationalHttpBoundary.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { DatabasePool } from "../database/pool.js";
import { RelationalSavingsService } from "../database/savingsService.js";
import { assertDisposableDatabaseResetAllowed } from "../database/disposableDatabaseGuard.js";
import { EndpointCrypto } from "../notifications/endpointCrypto.js";
import { FakeEmailProvider, FakePushProvider } from "../notifications/providers/provider.js";
import { hashOpaqueToken } from "../security.js";
import { WorkerHealthServer } from "../workers/workerHealth.js";
import { WorkerRuntime, type WorkerConfig } from "../workers/workerRuntime.js";

const databaseUrl = process.env.RELATIONAL_DATABASE_URL?.trim();
if (databaseUrl) assertDisposableDatabaseResetAllowed(databaseUrl, process.env, { targetEnvName: "RELATIONAL_DATABASE_URL" });

type CapturedMessage = Record<string, unknown>;

async function listen(server: Server): Promise<AddressInfo> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address() as AddressInfo;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function disposableFixture(database: DatabasePool): Promise<{ customerId: string; accountId: string }> {
  const customerId = randomUUID();
  const accountId = randomUUID();
  await database.query(
    `INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at)
     VALUES ($1, 'Integrated Scheduler User', $2, $3, 'salt', 'digest', NOW())`,
    [customerId, `${customerId}@example.test`, `09${customerId.replaceAll("-", "").slice(0, 8)}`],
  );
  await database.query(
    `INSERT INTO payment_accounts
      (id, customer_id, display_name, masked_number, currency, available_minor, current_minor,
       status, version, updated_at, account_number, bank_name, opening_balance_minor, held_minor)
     VALUES ($1,$2,'Integrated source',$3,'VND',10000000,10000000,'ACTIVE',0,NOW(),$4,'Reference Bank',0,0)`,
    [accountId, customerId, `•••• ${accountId.slice(-4)}`, `9704${(Number.parseInt(accountId.replaceAll("-", "").slice(0, 8), 16) % 100000000).toString().padStart(8, "0")}`],
  );
  return { customerId, accountId };
}

function workerConfig(databaseUrlValue: string, workerId: string): WorkerConfig {
  return {
    workerId,
    workerVersion: "integrated-disposable-test",
    pollIntervalMs: 25,
    batchSize: 50,
    concurrency: 4,
    leaseSeconds: 5,
    maxAttempts: 3,
    heartbeatIntervalMs: 50,
    shutdownTimeoutMs: 2_000,
    databaseUrl: databaseUrlValue,
    persistenceMode: "relational-v2",
    allowLegacyWriter: false,
    scheduledLifecycle: { enabled: true, pollIntervalMs: 50, batchSize: 50, stallThresholdMs: 500 },
  };
}

test("integrated relational-v2 rehearsal uses HTTP OTP capture, two workers and two lifecycle schedulers", { skip: !databaseUrl }, async (t) => {
  const previousPersistenceMode = process.env.BANKING_PERSISTENCE_MODE;
  process.env.BANKING_PERSISTENCE_MODE = "relational-v2";
  const captured: CapturedMessage[] = [];
  const captureServer = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      try { captured.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as CapturedMessage); } catch { /* malformed provider requests are rejected below */ }
      response.statusCode = 202;
      response.end();
    });
  });
  const captureAddress = await listen(captureServer);
  const repository = new PostgresRelationalRepository({ connectionString: databaseUrl! });
  await repository.initialize();
  const apiServer = createPersistentBankingServer(repository, new BankingSystem(), {
    environment: "test",
    startupReady: true,
    mfaService: new PersistentMfaService({
      unitOfWork: repository.unitOfWork,
      encryption: new LocalDevelopmentKeyEncryptionAdapter(Buffer.alloc(32, 7), "integrated-mfa-v1"),
      otpDigestKeyring: new OtpDigestKeyring({ current: { id: "integrated-otp-v1", value: Buffer.alloc(32, 9) } }),
      environmentScope: "test",
      delivery: new HttpEmailProvider({
        endpoint: `http://127.0.0.1:${captureAddress.port}/capture`,
        timeoutMs: 500,
        maxAttempts: 3,
        retryDelayMs: 0,
      }),
    }),
    relationalHttp: new RelationalHttpBoundary(repository.unitOfWork, "auth,registration,mfa,accounts,beneficiaries,transfers,savings,credit,recipients,notifications,fraud"),
    emailProviderHealth: () => ({ provider: "http", status: "ok", configured: true, credentialConfigured: false }),
  });
  const apiAddress = await listen(apiServer);
  const baseUrl = `http://127.0.0.1:${apiAddress.port}/api/v1`;
  const request = (path: string, init: RequestInit = {}) => fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });

  const workerDatabaseA = new DatabasePool({ connectionString: databaseUrl!, max: 8 });
  const workerDatabaseB = new DatabasePool({ connectionString: databaseUrl!, max: 8 });
  const providers = () => ({ push: new FakePushProvider(), email: new FakeEmailProvider(), endpointCrypto: new EndpointCrypto("integrated-worker-key") });
  const workerA = new WorkerRuntime(workerConfig(databaseUrl!, "integrated-worker-a"), workerDatabaseA, providers());
  const workerB = new WorkerRuntime(workerConfig(databaseUrl!, "integrated-worker-b"), workerDatabaseB, providers());
  await workerA.initialize();
  await workerB.initialize();
  const healthPortProbe = createServer();
  const healthProbeAddress = await listen(healthPortProbe);
  await close(healthPortProbe);
  const workerHealth = new WorkerHealthServer(workerA, healthProbeAddress.port);

  t.after(async () => {
    await workerHealth.close().catch(() => undefined);
    await workerA.stop().catch(() => undefined);
    await workerB.stop().catch(() => undefined);
    await workerDatabaseA.close().catch(() => undefined);
    await workerDatabaseB.close().catch(() => undefined);
    await close(apiServer).catch(() => undefined);
    await repository.close().catch(() => undefined);
    await close(captureServer).catch(() => undefined);
    if (previousPersistenceMode === undefined) delete process.env.BANKING_PERSISTENCE_MODE;
    else process.env.BANKING_PERSISTENCE_MODE = previousPersistenceMode;
  });

  const email = `integrated-${randomUUID()}@example.test`;
  const register = await request("/auth/register", {
    method: "POST",
    headers: { "X-Device-ID": "integrated-device" },
    body: JSON.stringify({ fullName: "Integrated User", email, phoneNumber: `09${randomUUID().replaceAll("-", "").slice(0, 8)}`, password: "Password1!" }),
  });
  assert.equal(register.status, 202);
  const challenge = await register.json() as { challengeId: string };
  assert.equal(captured.length, 1);
  const code = String(captured[0]?.code ?? "");
  assert.match(code, /^\d{6}$/);
  const challengeRow = await repository.unitOfWork.transaction(async ({ client }) => client.query<{ proof_digest: string }>("SELECT proof_digest FROM auth_challenges WHERE id = $1", [hashOpaqueToken(challenge.challengeId)]));
  assert.notEqual(challengeRow.rows[0]?.proof_digest, code);
  const outboxPayload = await repository.unitOfWork.transaction(async ({ client }) => client.query<{ payload: Record<string, unknown> }>("SELECT payload FROM outbox_events WHERE event_type = 'security.registration_otp_requested.v1' ORDER BY occurred_at DESC LIMIT 1"));
  assert.equal(JSON.stringify(outboxPayload.rows[0]?.payload ?? {}).includes(code), false);

  await repository.unitOfWork.transaction(async ({ client }) => {
    await client.query(
      "UPDATE auth_challenges SET last_sent_at = NOW() - INTERVAL '2 minutes' WHERE id = $1",
      [hashOpaqueToken(challenge.challengeId)],
    );
  });
  const resend = await request(`/auth/challenges/${encodeURIComponent(challenge.challengeId)}/resend`, {
    method: "POST",
    headers: { "X-Device-ID": "integrated-device" },
    body: JSON.stringify({}),
  });
  assert.equal(resend.status, 200);
  const resentChallenge = await resend.json() as { challengeId: string; method: string; methods: string[]; purpose: string };
  assert.equal(resentChallenge.method, "EMAIL_OTP");
  assert.deepEqual(resentChallenge.methods, ["EMAIL_OTP"]);
  assert.equal(resentChallenge.purpose, "REGISTRATION_EMAIL_VERIFY");
  assert.equal(captured.length, 2);
  const resentCode = String(captured[1]?.code ?? "");
  assert.match(resentCode, /^\d{6}$/);
  assert.notEqual(resentCode, code);

  const verified = await request("/auth/register/verify", {
    method: "POST",
    headers: { "X-Device-ID": "integrated-device" },
    body: JSON.stringify({ challengeId: resentChallenge.challengeId, method: "EMAIL_OTP", proof: resentCode }),
  });
  assert.equal(verified.status, 201);
  const replay = await request("/auth/register/verify", {
    method: "POST",
    headers: { "X-Device-ID": "integrated-device" },
    body: JSON.stringify({ challengeId: resentChallenge.challengeId, method: "EMAIL_OTP", proof: resentCode }),
  });
  assert.notEqual(replay.status, 201);
  const registrationCounts = await repository.unitOfWork.transaction(async ({ client }) => client.query<{ customers: string; accounts: string }>(
    "SELECT (SELECT COUNT(*)::text FROM customers WHERE email = $1) AS customers, (SELECT COUNT(*)::text FROM payment_accounts WHERE customer_id = (SELECT id FROM customers WHERE email = $1)) AS accounts",
    [email],
  ));
  assert.deepEqual(registrationCounts.rows[0], { customers: "1", accounts: "1" });

  // Registration OTP is not a login factor. A relational session is issued
  // directly after the email/password check, even with the MFA service wired.
  const login = await request("/auth/login", {
    method: "POST",
    headers: { "X-Device-ID": "integrated-login-device" },
    body: JSON.stringify({ email, password: "Password1!" }),
  });
  assert.equal(login.status, 200);
  const loginPayload = await login.json() as { accessToken?: string; refreshToken?: string };
  assert.ok(loginPayload.accessToken);
  assert.ok(loginPayload.refreshToken);

  const fixtureDatabase = new DatabasePool({ connectionString: databaseUrl!, max: 8 });
  const fixture = await disposableFixture(fixtureDatabase);
  const savings = new RelationalSavingsService(new UnitOfWork(fixtureDatabase));
  const quote = await savings.createQuote(fixture.customerId, {
    sourceAccountId: fixture.accountId,
    productId: "savings-vnd-1m",
    principal: { currency: "VND", amountMinor: "1000000" },
    maturityInstruction: "RETURN_PRINCIPAL_AND_INTEREST",
  });
  const opening = await savings.submitOpening({ customerId: fixture.customerId, idempotencyKey: `integrated-${randomUUID()}`, request: { quoteId: quote.quoteId, stepUp: { method: "TOTP", proof: "not-used" } } });
  await fixtureDatabase.query("UPDATE savings_deposits SET maturity_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [opening.depositId]);
  await fixtureDatabase.close();

  const workerStartA = workerA.start();
  const workerStartB = workerB.start();
  await workerHealth.start();
  const healthUrl = `http://127.0.0.1:${healthProbeAddress.port}/readyz`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(healthUrl);
    if (response.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
  const workerReady = await fetch(healthUrl);
  assert.equal(workerReady.status, 200);
  const workerHealthPayload = await workerReady.json() as { scheduledLifecycle?: { status: string; lastSuccessfulTick: string | null } };
  assert.equal(workerHealthPayload.scheduledLifecycle?.status, "ok");
  assert.ok(workerHealthPayload.scheduledLifecycle?.lastSuccessfulTick);
  await workerA.stop();
  await workerB.stop();
  await Promise.all([workerStartA, workerStartB]);

  const state = await repository.unitOfWork.transaction(async ({ client }) => client.query<{ pending: string; maturityOps: string; unbalanced: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM outbox_events WHERE status IN ('PENDING','PROCESSING')) AS pending,
       (SELECT COUNT(*)::text FROM savings_maturity_operations WHERE deposit_id = $1 AND status = 'SUCCEEDED') AS "maturityOps",
       (SELECT COUNT(*)::text FROM (SELECT journal_id FROM ledger_entries GROUP BY journal_id HAVING SUM(CASE WHEN side = 'DEBIT' THEN amount_minor ELSE 0 END) <> SUM(CASE WHEN side = 'CREDIT' THEN amount_minor ELSE 0 END)) unbalanced) AS unbalanced`,
    [opening.depositId],
  ));
  assert.equal(state.rows[0]?.pending, "0");
  assert.equal(state.rows[0]?.maturityOps, "1");
  assert.equal(state.rows[0]?.unbalanced, "0");
  const apiReady = await fetch(`${baseUrl.replace("/api/v1", "")}/readyz`);
  assert.equal(apiReady.status, 200);
  const apiHealth = await apiReady.json() as { emailProvider?: { configured: boolean; credentialConfigured: boolean } };
  assert.deepEqual(apiHealth.emailProvider, { provider: "http", status: "ok", configured: true, credentialConfigured: false });
});

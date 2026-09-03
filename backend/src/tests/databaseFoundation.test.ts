import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { BankingSystem } from "../bankingSystem.js";
import { DatabasePool, UnitOfWork, withTransactionRetry } from "../database/index.js";
import { IdempotencyConflictError } from "../database/commandErrors.js";
import { assertDisposableDatabaseResetAllowed } from "../database/disposableDatabaseGuard.js";
import { RelationalHttpBoundary } from "../database/relationalHttpBoundary.js";
import { RelationalTransferService } from "../database/transferService.js";
import { RelationalRegistrationService } from "../database/registrationService.js";
import { RelationalAuthService } from "../database/relationalAuthService.js";
import { RelationalAccountReadService } from "../database/relationalAccountReadService.js";
import { RelationalBeneficiaryService } from "../database/relationalBeneficiaryService.js";
import { RelationalKycService } from "../database/kycService.js";
import { hashPasswordAsync } from "../security.js";
import { createPersistentBankingServer } from "../http.js";
import { PostgresRelationalRepository } from "../postgresRelationalRepository.js";

const TEST_REGISTRATION_FINGERPRINT_KEY = Buffer.alloc(32, 0x42);

const databaseUrl =
  process.env.P0_RELATIONAL_DATABASE_URL?.trim() ??
  process.env.RELATIONAL_DATABASE_URL?.trim();

if (databaseUrl) {
  assertDisposableDatabaseResetAllowed(databaseUrl, process.env, {
    targetEnvName: process.env.P0_RELATIONAL_DATABASE_URL ? "P0_RELATIONAL_DATABASE_URL" : "RELATIONAL_DATABASE_URL",
  });
}

async function clearDatabase(database: DatabasePool): Promise<void> {
  // This helper owns a disposable relational-v2 test database. TRUNCATE avoids
  // mutating append-only audit/outbox rows through the production DELETE guard.
  await database.query(`
    TRUNCATE TABLE
      notification_deliveries,
      dead_letter_events,
      notification_endpoints,
      notification_preferences,
      worker_instances,
      notifications,
      savings_maturity_suspense,
      savings_maturity_operations,
      kyc_reviews,
      kyc_application_documents,
      kyc_applications,
      savings_idempotency,
      credit_idempotency,
      refresh_session_records,
      refresh_session_families,
      auth_challenges,
      pending_registrations,
      rate_limit_buckets,
      command_idempotency,
      registration_completions,
      reference_runtime_records,
      outbox_events,
      audit_events,
      account_transactions,
      ledger_entries,
      ledger_journals,
      transfers,
      transfer_quotes,
      beneficiaries,
      payment_accounts,
      auth_sessions,
      customer_devices,
      customer_feature_entitlements,
      customers
    RESTART IDENTITY CASCADE
  `);
}

async function insertFixture(database: DatabasePool): Promise<{
  senderId: string;
  recipientId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  quoteId: string;
}> {
  const senderId = randomUUID();
  const recipientId = randomUUID();
  const sourceAccountId = randomUUID();
  const destinationAccountId = randomUUID();
  const beneficiaryId = randomUUID();
  const quoteId = randomUUID();
  await database.query(
    `INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at)
     VALUES ($1, 'P0 Sender', $2, $3, 'salt', 'digest', NOW()),
            ($4, 'P0 Recipient', $5, $6, 'salt', 'digest', NOW())`,
    [
      senderId,
      `p0-sender-${senderId}@example.com`,
      `09${senderId.replaceAll("-", "").slice(0, 8)}`,
      recipientId,
      `p0-recipient-${recipientId}@example.com`,
      `09${recipientId.replaceAll("-", "").slice(0, 8)}`,
    ],
  );
  await database.query(
    `INSERT INTO payment_accounts
      (id, customer_id, display_name, masked_number, currency, available_minor,
       current_minor, status, version, updated_at, account_number, bank_name,
       opening_balance_minor, held_minor)
     VALUES
      ($1, $2, 'Sender account', '•••• 0001', 'VND', 10000000, 10000000, 'ACTIVE', 0, NOW(), '970499000001', 'Reference Bank', 0, 0),
      ($3, $4, 'Recipient account', '•••• 0002', 'VND', 0, 0, 'ACTIVE', 0, NOW(), '970499000002', 'Reference Bank', 0, 0)`,
    [sourceAccountId, senderId, destinationAccountId, recipientId],
  );
  await database.query(
    `INSERT INTO beneficiaries
      (id, customer_id, display_name, account_holder_name, masked_account_number,
       account_number_fingerprint, bank_name, status, destination_account_id,
       destination_owner_id, created_at)
     VALUES ($1, $2, 'P0 Recipient', 'P0 Recipient', '•••• 0002', 'p0-recipient-fingerprint',
             'Reference Bank', 'ACTIVE', $3, $4, NOW())`,
    [beneficiaryId, senderId, destinationAccountId, recipientId],
  );
  await database.query(
    `INSERT INTO transfer_quotes
      (id, customer_id, source_account_id, beneficiary_id, amount_minor, fee_minor,
       currency, expires_at, created_at, beneficiary_snapshot, destination_account_id,
       destination_owner_id, request_fingerprint)
     VALUES ($1, $2, $3, $4, 100000, 1000, 'VND', NOW() + INTERVAL '5 minutes', NOW(), '{}'::jsonb, $5, $6, 'quote-fp-1')`,
    [quoteId, senderId, sourceAccountId, beneficiaryId, destinationAccountId, recipientId],
  );
  return { senderId, recipientId, sourceAccountId, destinationAccountId, quoteId };
}

type ControlPolicyRow = {
  singleton: boolean;
  config_version: string;
  global_kill_switch: boolean;
  transfers_enabled: boolean;
  allowlist_enabled: boolean;
  max_transfer_amount_minor: string;
  step_up_methods: string[];
  savings_enabled: boolean;
  savings_allowlist_enabled: boolean;
  max_savings_amount_minor: string;
  savings_step_up_methods: string[];
  credit_enabled: boolean;
  credit_allowlisted: boolean;
  credit_payments_enabled: boolean;
  card_controls_enabled: boolean;
  max_credit_payment_amount_minor: string;
  credit_payment_step_up_methods: string[];
  card_unlock_step_up_methods: string[];
  updated_at: Date;
};

async function restoreControlPolicy(database: DatabasePool, policy: ControlPolicyRow): Promise<void> {
  await database.query(
    `INSERT INTO control_policy (
       singleton, config_version, global_kill_switch, transfers_enabled,
       allowlist_enabled, max_transfer_amount_minor, step_up_methods,
       savings_enabled, savings_allowlist_enabled, max_savings_amount_minor,
       savings_step_up_methods, credit_enabled, credit_allowlisted,
       credit_payments_enabled, card_controls_enabled,
       max_credit_payment_amount_minor, credit_payment_step_up_methods,
       card_unlock_step_up_methods, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15, $16, $17, $18, $19
     ) ON CONFLICT (singleton) DO UPDATE SET
       config_version=EXCLUDED.config_version,
       global_kill_switch=EXCLUDED.global_kill_switch,
       transfers_enabled=EXCLUDED.transfers_enabled,
       allowlist_enabled=EXCLUDED.allowlist_enabled,
       max_transfer_amount_minor=EXCLUDED.max_transfer_amount_minor,
       step_up_methods=EXCLUDED.step_up_methods,
       savings_enabled=EXCLUDED.savings_enabled,
       savings_allowlist_enabled=EXCLUDED.savings_allowlist_enabled,
       max_savings_amount_minor=EXCLUDED.max_savings_amount_minor,
       savings_step_up_methods=EXCLUDED.savings_step_up_methods,
       credit_enabled=EXCLUDED.credit_enabled,
       credit_allowlisted=EXCLUDED.credit_allowlisted,
       credit_payments_enabled=EXCLUDED.credit_payments_enabled,
       card_controls_enabled=EXCLUDED.card_controls_enabled,
       max_credit_payment_amount_minor=EXCLUDED.max_credit_payment_amount_minor,
       credit_payment_step_up_methods=EXCLUDED.credit_payment_step_up_methods,
       card_unlock_step_up_methods=EXCLUDED.card_unlock_step_up_methods,
       updated_at=EXCLUDED.updated_at`,
    [
      policy.singleton,
      policy.config_version,
      policy.global_kill_switch,
      policy.transfers_enabled,
      policy.allowlist_enabled,
      policy.max_transfer_amount_minor,
      policy.step_up_methods,
      policy.savings_enabled,
      policy.savings_allowlist_enabled,
      policy.max_savings_amount_minor,
      policy.savings_step_up_methods,
      policy.credit_enabled,
      policy.credit_allowlisted,
      policy.credit_payments_enabled,
      policy.card_controls_enabled,
      policy.max_credit_payment_amount_minor,
      policy.credit_payment_step_up_methods,
      policy.card_unlock_step_up_methods,
      policy.updated_at,
    ],
  );
}

test("migration 035 backfills only trustworthy credit cycle evidence and marks ambiguity", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 4 });
  const schema = `migration_035_${randomUUID().replaceAll("-", "")}`;
  const client = await database.connect();
  t.after(async () => {
    client.release();
    await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await database.close();
  });
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  await client.query(`
    CREATE TABLE credit_accounts (
      id uuid PRIMARY KEY,
      next_statement_at timestamptz NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE credit_statements (
      id uuid PRIMARY KEY,
      credit_account_id uuid NOT NULL,
      opening_balance_minor bigint NOT NULL DEFAULT 0,
      purchase_total_minor bigint NOT NULL DEFAULT 0,
      refund_total_minor bigint NOT NULL DEFAULT 0,
      fee_total_minor bigint NOT NULL DEFAULT 0,
      interest_total_minor bigint NOT NULL DEFAULT 0,
      closing_balance_minor bigint NOT NULL DEFAULT 0,
      remaining_amount_due_minor bigint NOT NULL DEFAULT 0,
      minimum_payment_due_minor bigint NOT NULL DEFAULT 0,
      minimum_payment_remaining_minor bigint NOT NULL DEFAULT 0,
      paid_amount_minor bigint NOT NULL DEFAULT 0,
      issued_at timestamptz NOT NULL,
      cycle_start_at timestamptz NOT NULL,
      cycle_end_at timestamptz NOT NULL
    );
    CREATE TABLE credit_transactions (id uuid PRIMARY KEY, statement_id uuid);
    CREATE TABLE credit_payments (id uuid PRIMARY KEY, statement_id uuid);
  `);
  const placeholderAccount = randomUUID();
  const evidenceAccount = randomUUID();
  const missingAccount = randomUUID();
  const ambiguousAccount = randomUUID();
  const invalidAccount = randomUUID();
  await client.query(
    `INSERT INTO credit_accounts (id, next_statement_at, status) VALUES
       ($1,'2026-03-01T00:00:00Z','ACTIVE'),
       ($2,'2026-03-01T00:00:00Z','ACTIVE'),
       ($3,'2026-04-01T00:00:00Z','ACTIVE'),
       ($4,'2026-04-01T00:00:00Z','ACTIVE'),
       ($5,'2026-03-01T00:00:00Z','ACTIVE')`,
    [placeholderAccount, evidenceAccount, missingAccount, ambiguousAccount, invalidAccount],
  );
  await client.query(
    `INSERT INTO credit_statements
       (id, credit_account_id, purchase_total_minor, issued_at, cycle_start_at, cycle_end_at)
     VALUES
       ($1,$2,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-02-01T00:00:00Z'),
       ($3,$4,500000,'2026-02-01T00:00:00Z','2026-01-01T00:00:00Z','2026-02-01T00:00:00Z'),
       ($5,$6,0,'2026-02-02T00:00:00Z','2026-02-01T00:00:00Z','2026-03-01T00:00:00Z'),
       ($7,$8,100000,'2026-03-02T00:00:00Z','2026-02-01T00:00:00Z','2026-03-02T00:00:00Z')`,
    [randomUUID(), placeholderAccount, randomUUID(), evidenceAccount, randomUUID(), ambiguousAccount, randomUUID(), invalidAccount],
  );
  const migration = await readFile(new URL("../../database/035_credit_cycle_start.sql", import.meta.url), "utf8");
  await client.query(migration);
  await client.query(migration);
  const rows = await client.query<{
    id: string;
    cycle: string;
    review: boolean;
    reason: string | null;
  }>(
    `SELECT id, current_cycle_start_at::text AS cycle,
            cycle_backfill_review_required AS review,
            cycle_backfill_review_reason AS reason
       FROM credit_accounts ORDER BY id`,
  );
  const byId = new Map(rows.rows.map((row) => [row.id, row]));
  assert.match(byId.get(placeholderAccount)!.cycle, /^2026-01-01/);
  assert.deepEqual({ review: byId.get(placeholderAccount)!.review, reason: byId.get(placeholderAccount)!.reason }, { review: false, reason: null });
  assert.match(byId.get(evidenceAccount)!.cycle, /^2026-02-01/);
  assert.deepEqual({ review: byId.get(evidenceAccount)!.review, reason: byId.get(evidenceAccount)!.reason }, { review: false, reason: null });
  assert.match(byId.get(missingAccount)!.cycle, /^2026-03-01/);
  assert.deepEqual({ review: byId.get(missingAccount)!.review, reason: byId.get(missingAccount)!.reason }, { review: true, reason: "MISSING_LEGACY_CYCLE_EVIDENCE" });
  assert.match(byId.get(ambiguousAccount)!.cycle, /^2026-03-01/);
  assert.deepEqual({ review: byId.get(ambiguousAccount)!.review, reason: byId.get(ambiguousAccount)!.reason }, { review: true, reason: "AMBIGUOUS_LEGACY_STATEMENT" });
  assert.deepEqual({ review: byId.get(invalidAccount)!.review, reason: byId.get(invalidAccount)!.reason }, { review: true, reason: "INVALID_LEGACY_CYCLE_BOUNDARY" });
});

test("control policy is bootstrapped once and missing policy fails persistent readiness closed", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 4 });
  const repository = new PostgresRelationalRepository({ connectionString: databaseUrl });
  const relationalHttp = new RelationalHttpBoundary(repository.unitOfWork);
  const server = createPersistentBankingServer(repository, new BankingSystem(), { relationalHttp, registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await repository.close();
    await database.close();
  });

  const migration = await database.query<{ migration_key: string }>(
    "SELECT migration_key FROM reference_schema_migrations WHERE migration_key = '033_control_policy_bootstrap'",
  );
  assert.equal(migration.rowCount, 1);
  const policyResult = await database.query<ControlPolicyRow>(
    `SELECT singleton, config_version, global_kill_switch, transfers_enabled,
            allowlist_enabled, max_transfer_amount_minor, step_up_methods,
            savings_enabled, savings_allowlist_enabled, max_savings_amount_minor,
            savings_step_up_methods, credit_enabled, credit_allowlisted,
            credit_payments_enabled, card_controls_enabled,
            max_credit_payment_amount_minor, credit_payment_step_up_methods,
            card_unlock_step_up_methods, updated_at
       FROM control_policy
      WHERE singleton = true`,
  );
  assert.equal(policyResult.rowCount, 1);
  const policy = policyResult.rows[0];
  assert.ok(policy);
  assert.equal(policy.config_version, "m7-sandbox-1");
  assert.equal(policy.global_kill_switch, false);
  assert.equal(policy.transfers_enabled, true);
  assert.equal(policy.max_transfer_amount_minor, "5000000");
  assert.deepEqual(policy.step_up_methods, ["TOTP"]);
  assert.deepEqual(policy.savings_step_up_methods, ["TOTP"]);
  assert.deepEqual(policy.credit_payment_step_up_methods, ["TOTP"]);
  assert.deepEqual(policy.card_unlock_step_up_methods, ["TOTP"]);

  const directPolicy = await relationalHttp.getControlPolicy();
  assert.deepEqual(directPolicy.stepUpMethods, ["TOTP"]);
  assert.equal(directPolicy.transfersEnabled, true);

  const address = server.address() as AddressInfo;
  const readyBefore = await fetch(`http://127.0.0.1:${address.port}/readyz`);
  assert.equal(readyBefore.status, 200);

  try {
    await database.query("DELETE FROM control_policy WHERE singleton = true");
    await assert.rejects(repository.healthCheck(), /control policy bootstrap is missing/i);
    const readyMissing = await fetch(`http://127.0.0.1:${address.port}/readyz`);
    assert.equal(readyMissing.status, 503);
    assert.equal((await readyMissing.json() as { code: string }).code, "PERSISTENCE_UNAVAILABLE");
  } finally {
    await restoreControlPolicy(database, policy);
  }

  await repository.healthCheck();
  const readyRecovered = await fetch(`http://127.0.0.1:${address.port}/readyz`);
  assert.equal(readyRecovered.status, 200);
});

test("relational-v2 UnitOfWork rolls back and retries only retryable errors", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 4 });
  const unitOfWork = new UnitOfWork(database);
  await clearDatabase(database);
  t.after(async () => {
    await clearDatabase(database);
    await database.close();
  });

  const rollbackId = randomUUID();
  await assert.rejects(
    unitOfWork.transaction(async ({ query }) => {
      await query(
        `INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at)
         VALUES ($1, 'Rollback', $2, $3, 'salt', 'digest', NOW())`,
        [rollbackId, `rollback-${rollbackId}@example.com`, `09${rollbackId.replaceAll("-", "").slice(0, 8)}`],
      );
      throw new Error("fault-injection");
    }),
    /fault-injection/,
  );
  const rolledBack = await database.query("SELECT 1 FROM customers WHERE id = $1", [rollbackId]);
  assert.equal(rolledBack.rowCount, 0);

  let attempts = 0;
  const retryResult = await withTransactionRetry(async () => {
    attempts += 1;
    if (attempts < 2) throw Object.assign(new Error("serialization"), { code: "40001" });
    return "ok";
  });
  assert.equal(retryResult, "ok");
  assert.equal(attempts, 2);

  const constrainedPool = new DatabasePool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMs: 100,
  });
  const heldClient = await constrainedPool.connect();
  await assert.rejects(constrainedPool.connect(), /timeout|timeout exceeded/i);
  heldClient.release();
  await constrainedPool.close();
});

test("direct transfer use case is idempotent, lock-ordered and atomically persisted", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 4 });
  const unitOfWork = new UnitOfWork(database);
  await clearDatabase(database);
  const fixture = await insertFixture(database);
  t.after(async () => {
    await clearDatabase(database);
    await database.close();
  });

  const service = new RelationalTransferService(unitOfWork);
  const first = await service.submit({
    customerId: fixture.senderId,
    idempotencyKey: "p0-transfer-key-0001",
    requestFingerprint: "transfer-body-1",
    quoteId: fixture.quoteId,
    traceId: "p0-test-trace",
  });
  const replay = await service.submit({
    customerId: fixture.senderId,
    idempotencyKey: "p0-transfer-key-0001",
    requestFingerprint: "transfer-body-1",
    quoteId: fixture.quoteId,
  });
  assert.equal(replay.id, first.id);
  await assert.rejects(
    service.submit({
      customerId: fixture.senderId,
      idempotencyKey: "p0-transfer-key-0001",
      requestFingerprint: "different-body",
      quoteId: fixture.quoteId,
    }),
    (error: unknown) => error instanceof IdempotencyConflictError,
  );

  const balances = await database.query(
    "SELECT id, available_minor::text, current_minor::text, version::text FROM payment_accounts WHERE id = ANY($1::uuid[]) ORDER BY id",
    [[fixture.sourceAccountId, fixture.destinationAccountId]],
  );
  assert.deepEqual(
    balances.rows.map((row) => [row.id, row.available_minor, row.current_minor, row.version]),
    [
      [fixture.destinationAccountId, "100000", "100000", "1"],
      [fixture.sourceAccountId, "9899000", "9899000", "1"],
    ].sort((left, right) => left[0].localeCompare(right[0])),
  );
  const integrity = await database.query(
    `SELECT
       (SELECT COUNT(*) FROM transfers) AS transfers,
       (SELECT COUNT(*) FROM account_transactions) AS transactions,
       (SELECT COUNT(*) FROM ledger_journals) AS journals,
       (SELECT COUNT(*) FROM audit_events) AS audits,
       (SELECT COUNT(*) FROM notifications WHERE resource_id IN (
         SELECT source_transaction_id::text FROM transfers WHERE id = $2
         UNION ALL
         SELECT destination_transaction_id::text FROM transfers WHERE id = $2
       )) AS notifications,
       (SELECT COUNT(*) FROM outbox_events WHERE deduplication_key = $1) AS outbox,
       (SELECT priority::text FROM outbox_events WHERE deduplication_key = $1) AS outbox_priority,
       (SELECT trace_id FROM outbox_events WHERE deduplication_key = $1) AS outbox_trace,
       (SELECT consumed_transfer_id FROM transfer_quotes WHERE id = $3) AS consumed`,
    [`TRANSFER_SUCCEEDED:${first.id}`, first.id, fixture.quoteId],
  );
  assert.equal(integrity.rows[0].transfers, "1");
  assert.equal(integrity.rows[0].transactions, "2");
  assert.equal(integrity.rows[0].journals, "1");
  assert.equal(integrity.rows[0].audits, "1");
  assert.equal(integrity.rows[0].notifications, "2");
  assert.equal(integrity.rows[0].outbox, "1");
  assert.equal(integrity.rows[0].outbox_priority, "10");
  assert.equal(integrity.rows[0].outbox_trace, "p0-test-trace");
  assert.equal(integrity.rows[0].consumed, first.id);

  const secondQuote = randomUUID();
  await database.query(
    `INSERT INTO transfer_quotes
      (id, customer_id, source_account_id, beneficiary_id, amount_minor, fee_minor,
       currency, expires_at, created_at, beneficiary_snapshot, destination_account_id,
       destination_owner_id, request_fingerprint)
     VALUES ($1, $2, $3, NULL, 50000, 1000, 'VND', NOW() + INTERVAL '5 minutes', NOW(), '{}'::jsonb, $4, $5, 'quote-fp-2')`,
    [secondQuote, fixture.senderId, fixture.sourceAccountId, fixture.destinationAccountId, fixture.recipientId],
  );
  const concurrent = await Promise.all([
    service.submit({ customerId: fixture.senderId, idempotencyKey: "p0-concurrent-a", requestFingerprint: "same", quoteId: secondQuote }),
    service.submit({ customerId: fixture.senderId, idempotencyKey: "p0-concurrent-b", requestFingerprint: "same", quoteId: secondQuote }),
  ]);
  assert.equal(concurrent[0].id, concurrent[1].id);
  const count = await database.query("SELECT COUNT(*) FROM transfers WHERE quote_id = $1", [secondQuote]);
  assert.equal(count.rows[0].count, "1");
});

test("fault after ledger write leaves no partial relational transfer", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 4 });
  const unitOfWork = new UnitOfWork(database);
  await clearDatabase(database);
  const fixture = await insertFixture(database);
  t.after(async () => {
    await clearDatabase(database);
    await database.close();
  });
  const service = new RelationalTransferService(unitOfWork);
  await assert.rejects(
    service.submit({
      customerId: fixture.senderId,
      idempotencyKey: "p0-fault-key-0001",
      requestFingerprint: "fault-body",
      quoteId: fixture.quoteId,
      fault: (point) => {
        if (point === "after_ledger_written") throw new Error("fault-after-ledger");
      },
    }),
    /fault-after-ledger/,
  );
  const state = await database.query(
    `SELECT
       (SELECT COUNT(*) FROM transfers) AS transfers,
       (SELECT COUNT(*) FROM command_idempotency) AS commands,
       (SELECT COUNT(*) FROM ledger_journals) AS journals,
       (SELECT consumed_at FROM transfer_quotes WHERE id = $1) AS consumed,
       (SELECT available_minor::text FROM payment_accounts WHERE id = $2) AS available`,
    [fixture.quoteId, fixture.sourceAccountId],
  );
  assert.equal(state.rows[0].transfers, "0");
  assert.equal(state.rows[0].commands, "0");
  assert.equal(state.rows[0].journals, "0");
  assert.equal(state.rows[0].consumed, null);
  assert.equal(state.rows[0].available, "10000000");
});

test("direct transfer quotes and submits enforce the current control policy without financial side effects", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 8 });
  const unitOfWork = new UnitOfWork(database);
  await clearDatabase(database);
  const fixture = await insertFixture(database);
  const transfers = new RelationalTransferService(unitOfWork);
  const originalPolicy = (await database.query<ControlPolicyRow>("SELECT * FROM control_policy WHERE singleton=true")).rows[0]!;
  const beneficiaryId = (await database.query<{ id: string }>("SELECT id FROM beneficiaries WHERE customer_id=$1", [fixture.senderId])).rows[0]!.id;
  t.after(async () => {
    await restoreControlPolicy(database, originalPolicy);
    await clearDatabase(database);
    await database.close();
  });

  await assert.rejects(
    transfers.createQuote({
      customerId: fixture.senderId,
      sourceAccountId: fixture.sourceAccountId,
      beneficiaryId,
      amount: { currency: "VND", amountMinor: "5000001" },
    }),
    (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "TRANSFER_LIMIT_EXCEEDED",
  );

  const beforeDisabled = await database.query<{ quotes: string; audits: string; outbox: string }>(
    "SELECT (SELECT COUNT(*)::text FROM transfer_quotes) quotes, (SELECT COUNT(*)::text FROM audit_events) audits, (SELECT COUNT(*)::text FROM outbox_events) outbox",
  );
  await database.query("UPDATE control_policy SET transfers_enabled=false, updated_at=NOW() WHERE singleton=true");
  await assert.rejects(
    transfers.createQuote({ customerId: fixture.senderId, sourceAccountId: fixture.sourceAccountId, beneficiaryId, amount: { currency: "VND", amountMinor: "100000" } }),
    (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "TRANSFER_DISABLED",
  );
  const afterDisabled = await database.query<{ quotes: string; audits: string; outbox: string }>(
    "SELECT (SELECT COUNT(*)::text FROM transfer_quotes) quotes, (SELECT COUNT(*)::text FROM audit_events) audits, (SELECT COUNT(*)::text FROM outbox_events) outbox",
  );
  assert.deepEqual(afterDisabled.rows[0], beforeDisabled.rows[0]);

  await database.query("UPDATE control_policy SET transfers_enabled=true, global_kill_switch=true, updated_at=NOW() WHERE singleton=true");
  await assert.rejects(
    transfers.createQuote({ customerId: fixture.senderId, sourceAccountId: fixture.sourceAccountId, beneficiaryId, amount: { currency: "VND", amountMinor: "100000" } }),
    (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "TRANSFER_DISABLED",
  );
  const afterGlobalKillQuote = await database.query<{ quotes: string; audits: string; outbox: string }>(
    "SELECT (SELECT COUNT(*)::text FROM transfer_quotes) quotes, (SELECT COUNT(*)::text FROM audit_events) audits, (SELECT COUNT(*)::text FROM outbox_events) outbox",
  );
  assert.deepEqual(afterGlobalKillQuote.rows[0], beforeDisabled.rows[0]);

  await database.query("UPDATE control_policy SET transfers_enabled=true, global_kill_switch=false, updated_at=NOW() WHERE singleton=true");
  const quote = await transfers.createQuote({ customerId: fixture.senderId, sourceAccountId: fixture.sourceAccountId, beneficiaryId, amount: { currency: "VND", amountMinor: "100000" } });
  await database.query("UPDATE control_policy SET global_kill_switch=true, updated_at=NOW() WHERE singleton=true");
  const beforeSubmit = await database.query<{ source: string; destination: string; transfers: string; transactions: string; journals: string; audits: string; outbox: string }>(
    `SELECT (SELECT available_minor::text FROM payment_accounts WHERE id=$1) source,
            (SELECT available_minor::text FROM payment_accounts WHERE id=$2) destination,
            (SELECT COUNT(*)::text FROM transfers) transfers,
            (SELECT COUNT(*)::text FROM account_transactions) transactions,
            (SELECT COUNT(*)::text FROM ledger_journals) journals,
            (SELECT COUNT(*)::text FROM audit_events) audits,
            (SELECT COUNT(*)::text FROM outbox_events) outbox`,
    [fixture.sourceAccountId, fixture.destinationAccountId],
  );
  const fingerprint = (await database.query<{ request_fingerprint: string }>("SELECT request_fingerprint FROM transfer_quotes WHERE id=$1", [quote.quoteId])).rows[0]!.request_fingerprint;
  await assert.rejects(
    transfers.submit({ customerId: fixture.senderId, idempotencyKey: "policy-submit-key-0001", requestFingerprint: fingerprint, quoteId: quote.quoteId }),
    (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "TRANSFER_DISABLED",
  );
  const afterSubmit = await database.query<{ source: string; destination: string; transfers: string; transactions: string; journals: string; audits: string; outbox: string }>(
    `SELECT (SELECT available_minor::text FROM payment_accounts WHERE id=$1) source,
            (SELECT available_minor::text FROM payment_accounts WHERE id=$2) destination,
            (SELECT COUNT(*)::text FROM transfers) transfers,
            (SELECT COUNT(*)::text FROM account_transactions) transactions,
            (SELECT COUNT(*)::text FROM ledger_journals) journals,
            (SELECT COUNT(*)::text FROM audit_events) audits,
            (SELECT COUNT(*)::text FROM outbox_events) outbox`,
    [fixture.sourceAccountId, fixture.destinationAccountId],
  );
  assert.deepEqual(afterSubmit.rows[0], beforeSubmit.rows[0]);

  await database.query("UPDATE control_policy SET global_kill_switch=false, transfers_enabled=true, updated_at=NOW() WHERE singleton=true");
  const disabledAfterQuote = await transfers.createQuote({ customerId: fixture.senderId, sourceAccountId: fixture.sourceAccountId, beneficiaryId, amount: { currency: "VND", amountMinor: "100000" } });
  const disabledFingerprint = (await database.query<{ request_fingerprint: string }>("SELECT request_fingerprint FROM transfer_quotes WHERE id=$1", [disabledAfterQuote.quoteId])).rows[0]!.request_fingerprint;
  await database.query("UPDATE control_policy SET transfers_enabled=false, updated_at=NOW() WHERE singleton=true");
  const beforeDisabledSubmit = await database.query<{ transfers: string; transactions: string; journals: string; outbox: string }>(
    "SELECT (SELECT COUNT(*)::text FROM transfers) transfers, (SELECT COUNT(*)::text FROM account_transactions) transactions, (SELECT COUNT(*)::text FROM ledger_journals) journals, (SELECT COUNT(*)::text FROM outbox_events) outbox",
  );
  await assert.rejects(
    transfers.submit({ customerId: fixture.senderId, idempotencyKey: "policy-disabled-after-quote", requestFingerprint: disabledFingerprint, quoteId: disabledAfterQuote.quoteId }),
    (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "TRANSFER_DISABLED",
  );
  assert.deepEqual(
    (await database.query<{ transfers: string; transactions: string; journals: string; outbox: string }>(
      "SELECT (SELECT COUNT(*)::text FROM transfers) transfers, (SELECT COUNT(*)::text FROM account_transactions) transactions, (SELECT COUNT(*)::text FROM ledger_journals) journals, (SELECT COUNT(*)::text FROM outbox_events) outbox",
    )).rows[0],
    beforeDisabledSubmit.rows[0],
  );

  await database.query("UPDATE control_policy SET transfers_enabled=true, step_up_methods=ARRAY['OTP']::text[], updated_at=NOW() WHERE singleton=true");
  await assert.rejects(
    transfers.createQuote({ customerId: fixture.senderId, sourceAccountId: fixture.sourceAccountId, beneficiaryId, amount: { currency: "VND", amountMinor: "100000" } }),
    (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "TRANSFER_STEP_UP_REQUIRED",
  );
  await assert.rejects(
    transfers.submit({ customerId: fixture.senderId, idempotencyKey: "policy-method-mismatch", requestFingerprint: disabledFingerprint, quoteId: disabledAfterQuote.quoteId }),
    (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "TRANSFER_STEP_UP_REQUIRED",
  );

  await restoreControlPolicy(database, originalPolicy);
  const missingPolicyQuote = await transfers.createQuote({ customerId: fixture.senderId, sourceAccountId: fixture.sourceAccountId, beneficiaryId, amount: { currency: "VND", amountMinor: "100000" } });
  const missingPolicyFingerprint = (await database.query<{ request_fingerprint: string }>("SELECT request_fingerprint FROM transfer_quotes WHERE id=$1", [missingPolicyQuote.quoteId])).rows[0]!.request_fingerprint;
  await database.query("DELETE FROM control_policy WHERE singleton=true");
  await assert.rejects(
    transfers.createQuote({ customerId: fixture.senderId, sourceAccountId: fixture.sourceAccountId, beneficiaryId, amount: { currency: "VND", amountMinor: "100000" } }),
    (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "CONTROL_POLICY_UNAVAILABLE",
  );
  await assert.rejects(
    transfers.submit({ customerId: fixture.senderId, idempotencyKey: "policy-missing-submit", requestFingerprint: missingPolicyFingerprint, quoteId: missingPolicyQuote.quoteId }),
    (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "CONTROL_POLICY_UNAVAILABLE",
  );
  await restoreControlPolicy(database, originalPolicy);

  await database.query("UPDATE control_policy SET global_kill_switch=false, transfers_enabled=true, allowlist_enabled=true, updated_at=NOW() WHERE singleton=true");
  await database.query("UPDATE customer_feature_entitlements SET enabled=false WHERE customer_id=$1 AND feature_code='TRANSFERS'", [fixture.senderId]);
  await assert.rejects(
    transfers.createQuote({ customerId: fixture.senderId, sourceAccountId: fixture.sourceAccountId, beneficiaryId, amount: { currency: "VND", amountMinor: "100000" } }),
    (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "TRANSFER_NOT_ALLOWLISTED",
  );
});

test("login rate-limit buckets lock before password verification, expire safely and reset on success", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 8 });
  const unitOfWork = new UnitOfWork(database);
  await clearDatabase(database);
  const customerId = randomUUID();
  const email = `rate-limit-${customerId}@example.test`;
  const password = await hashPasswordAsync("correct-password-123");
  await database.query(
    `INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at)
     VALUES ($1, 'Rate Limit User', $2, $3, $4, $5, NOW())`,
    [customerId, email, `09${customerId.replaceAll("-", "").slice(0, 8)}`, password.salt, password.digest],
  );
  const previousMax = process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS;
  const previousWindow = process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS;
  process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS = "3";
  process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS = "60";
  const auth = new RelationalAuthService(unitOfWork);
  t.after(async () => {
    if (previousMax === undefined) delete process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS; else process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS = previousMax;
    if (previousWindow === undefined) delete process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS; else process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS = previousWindow;
    await clearDatabase(database);
    await database.close();
  });
  const knownFailure = await auth.loginPasswordOnly(email, "wrong-password", "existence-known-device").then(
    () => null,
    (error: unknown) => error as { status?: number; code?: string; message?: string },
  );
  const unknownFailure = await auth.loginPasswordOnly(`unknown-${customerId}@example.test`, "wrong-password", "existence-unknown-device").then(
    () => null,
    (error: unknown) => error as { status?: number; code?: string; message?: string },
  );
  assert.deepEqual(
    { status: knownFailure?.status, code: knownFailure?.code, message: knownFailure?.message },
    { status: unknownFailure?.status, code: unknownFailure?.code, message: unknownFailure?.message },
  );
  assert.deepEqual(
    { status: knownFailure?.status, message: knownFailure?.message },
    { status: 401, message: "Invalid credentials." },
  );
  await database.query("DELETE FROM rate_limit_buckets");

  await assert.rejects(auth.loginPasswordOnly(email, "wrong-password", "rate-device"), (error: unknown) => error instanceof Error && "status" in error && (error as { status: number }).status === 401);
  await assert.rejects(auth.loginPasswordOnly(email, "wrong-password", "rate-device"), (error: unknown) => error instanceof Error && "status" in error && (error as { status: number }).status === 401);
  await assert.rejects(auth.loginPasswordOnly(email, "wrong-password", "rate-device"), (error: unknown) => error instanceof Error && "status" in error && (error as { status: number }).status === 429);
  await assert.rejects(auth.loginPasswordOnly(email, password.digest, "rate-device"), (error: unknown) => error instanceof Error && "status" in error && (error as { status: number }).status === 429);
  await database.query("UPDATE rate_limit_buckets SET blocked_until=NOW()-INTERVAL '1 second' WHERE bucket_key LIKE 'relational-login:%'");
  const user = await auth.loginPasswordOnly(email, "correct-password-123", "rate-device");
  assert.equal(user.id, customerId);
  assert.equal((await auth.loginPasswordOnly(email, "correct-password-123", "rate-device")).id, customerId);
  assert.equal((await auth.loginPasswordOnly(email, "correct-password-123", "rate-device")).id, customerId);
  const buckets = await database.query<{ attempts: number; blocked_until: Date | null }>("SELECT attempts, blocked_until FROM rate_limit_buckets WHERE bucket_key LIKE 'relational-login:%' ORDER BY bucket_key");
  assert.ok(buckets.rows.every((row) => Number(row.attempts) === 0 && row.blocked_until === null));
  const concurrent = await Promise.allSettled(Array.from({ length: 5 }, () => auth.loginPasswordOnly(email, "wrong-password", "rate-device-2")));
  assert.ok(concurrent.some((result) => result.status === "rejected" && result.reason?.status === 429));
  const concurrentBucket = await database.query<{ attempts: string; blocked_until: Date | null }>("SELECT attempts::text, blocked_until FROM rate_limit_buckets WHERE bucket_key = $1", [`relational-login:device:rate-device-2`]);
  assert.equal(concurrentBucket.rows[0]?.attempts, "3");
  assert.ok(concurrentBucket.rows[0]?.blocked_until);
});

test("persistent KYC draft/submit is idempotent, synthetic-only and emits one committed security intent", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 8 });
  const unitOfWork = new UnitOfWork(database);
  await clearDatabase(database);
  const customerId = randomUUID();
  await database.query(
    `INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at)
     VALUES ($1, 'Synthetic KYC Customer', $2, $3, 'salt', 'digest', NOW())`,
    [customerId, `kyc-${customerId}@example.test`, `09${customerId.replaceAll("-", "").slice(0, 8)}`],
  );
  const kyc = new RelationalKycService(unitOfWork);
  const input = { fullName: "Synthetic KYC Customer", identityNumber: "123456789012", address: "Synthetic address for the reference sandbox", documentUri: "synthetic://document/fixture-001", syntheticDataConfirmed: true };
  t.after(async () => { await clearDatabase(database); await database.close(); });

  assert.equal(await kyc.get(customerId), null);
  const draft = await kyc.saveDraft(customerId, input);
  assert.equal(draft.status, "DRAFT");
  assert.equal((await kyc.get(customerId))?.fullName, input.fullName);
  const submitted = await kyc.submit(customerId, input);
  const replay = await kyc.submit(customerId, input);
  assert.equal(submitted.id, replay.id);
  assert.equal(submitted.status, "SUBMITTED");
  assert.equal(replay.version, submitted.version);
  await assert.rejects(kyc.submit(customerId, { ...input, fullName: "Changed Synthetic Name" }), /đang được xử lý|không thể thay đổi/i);
  await assert.rejects(kyc.submit(customerId, { ...input, documentUri: "https://example.invalid/real-document" }), /synthetic fixture/i);
  await assert.rejects(kyc.submit(customerId, { ...input, syntheticDataConfirmed: false }), /syntheticDataConfirmed/i);
  const counts = await database.query<{ applications: string; notifications: string; audits: string; outbox: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM kyc_applications WHERE customer_id = $1) AS applications,
       (SELECT COUNT(*)::text FROM notifications WHERE customer_id = $1 AND notification_type = 'SECURITY') AS notifications,
       (SELECT COUNT(*)::text FROM audit_events WHERE actor_customer_id = $1 AND event_type = 'KYC_SUBMITTED') AS audits,
       (SELECT COUNT(*)::text FROM outbox_events WHERE aggregate_id = $2 AND event_type = 'security.kyc_submitted.v1') AS outbox`,
    [customerId, submitted.id],
  );
  assert.deepEqual(counts.rows[0], { applications: "1", notifications: "1", audits: "1", outbox: "1" });
});

test("beneficiary delete/block semantics preserve transfer counterparty snapshots", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 8 });
  const unitOfWork = new UnitOfWork(database);
  await clearDatabase(database);
  const fixture = await insertFixture(database);
  const beneficiary = new RelationalBeneficiaryService(unitOfWork);
  const transfers = new RelationalTransferService(unitOfWork);
  t.after(async () => { await clearDatabase(database); await database.close(); });

  const stored = (await database.query<{ id: string }>("SELECT id FROM beneficiaries WHERE customer_id=$1", [fixture.senderId])).rows[0]!;
  const quote = await transfers.createQuote({ customerId: fixture.senderId, sourceAccountId: fixture.sourceAccountId, beneficiaryId: stored.id, amount: { currency: "VND", amountMinor: "100000" } });
  const quoteFingerprint = (await database.query<{ request_fingerprint: string }>("SELECT request_fingerprint FROM transfer_quotes WHERE id=$1", [quote.quoteId])).rows[0]!.request_fingerprint;
  await transfers.submit({ customerId: fixture.senderId, idempotencyKey: "beneficiary-snapshot-key", requestFingerprint: quoteFingerprint, quoteId: quote.quoteId });
  await beneficiary.rename(fixture.senderId, stored.id, "Renamed after transfer");
  const snapshot = await database.query<{ sender: string | null; receiver: string | null }>(
    `SELECT
       (SELECT counterparty_name FROM account_transactions WHERE transfer_id = (SELECT id FROM transfers WHERE quote_id=$1) AND direction='DEBIT') AS sender,
       (SELECT counterparty_name FROM account_transactions WHERE transfer_id = (SELECT id FROM transfers WHERE quote_id=$1) AND direction='CREDIT') AS receiver`,
    [quote.quoteId],
  );
  assert.deepEqual(snapshot.rows[0], { sender: "P0 Recipient", receiver: "P0 Sender" });
  await beneficiary.remove(fixture.senderId, stored.id);
  assert.deepEqual(await beneficiary.list(fixture.senderId), []);
  await assert.rejects(beneficiary.get(fixture.senderId, stored.id), /Beneficiary not found/i);
  const recreated = await beneficiary.create(fixture.senderId, { displayName: "Recreated recipient", accountNumber: "970499000002" });
  assert.notEqual(recreated.id, stored.id);
  await database.query("UPDATE beneficiaries SET status='BLOCKED' WHERE id=$1", [recreated.id]);
  await assert.rejects(
    transfers.createQuote({ customerId: fixture.senderId, sourceAccountId: fixture.sourceAccountId, beneficiaryId: recreated.id, amount: { currency: "VND", amountMinor: "100000" } }),
    /Beneficiary not found|not active/i,
  );
  await beneficiary.remove(fixture.senderId, stored.id);
});

test("database keyset pagination returns more than 1000 account transactions without duplicates or cursor scope leaks", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 8 });
  const service = new RelationalAccountReadService(new UnitOfWork(database));
  await clearDatabase(database);
  const fixture = await insertFixture(database);
  t.after(async () => { await clearDatabase(database); await database.close(); });
  await database.query(
    `WITH generated AS (
       SELECT gs, md5('history-' || gs::text) AS hash
         FROM generate_series(1, 1005) AS gs
     )
     INSERT INTO account_transactions
       (id, account_id, direction, amount_minor, fee_minor, currency, status,
        description, counterparty_name, reference, occurred_at, created_at, completed_at, kind)
     SELECT
       (substr(hash,1,8) || '-' || substr(hash,9,4) || '-4' || substr(hash,14,3) || '-8' || substr(hash,18,3) || '-' || substr(hash,21,12))::uuid,
       $1, CASE WHEN gs % 2 = 0 THEN 'CREDIT' ELSE 'DEBIT' END,
       gs, 0, 'VND', 'SUCCEEDED', 'Synthetic pagination fixture',
       'Synthetic counterparty', 'HISTORY-' || gs::text,
       '2026-08-01T00:00:00Z'::timestamptz - (gs || ' seconds')::interval,
       '2026-08-01T00:00:00Z'::timestamptz - (gs || ' seconds')::interval,
       '2026-08-01T00:00:00Z'::timestamptz - (gs || ' seconds')::interval,
       'TRANSFER'
       FROM generated`,
    [fixture.sourceAccountId],
  );

  const ids: string[] = [];
  let cursor: string | undefined;
  let firstCursor: string | null = null;
  do {
    const page = await service.listTransactions(fixture.senderId, fixture.sourceAccountId, cursor, 100);
    ids.push(...page.items.map((item) => item.id));
    if (firstCursor === null) firstCursor = page.nextCursor;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(ids.length, 1005);
  assert.equal(new Set(ids).size, 1005);
  assert.ok(firstCursor);
  await assert.rejects(
    service.listTransactions(fixture.senderId, fixture.sourceAccountId, "not-a-valid-cursor", 100),
    /cursor is invalid/i,
  );
  await assert.rejects(
    service.listTransactions(fixture.recipientId, fixture.destinationAccountId, firstCursor!, 100),
    /cursor is invalid/i,
  );
  await assert.rejects(
    service.listTransactions(fixture.senderId, fixture.destinationAccountId, undefined, 100),
    /Account not found/i,
  );
});

test("normalized registration allocates a database sequence account atomically", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 4 });
  const unitOfWork = new UnitOfWork(database);
  await clearDatabase(database);
  const pendingId = randomUUID();
  await database.query(
    `INSERT INTO pending_registrations
      (id, full_name, email, phone_number, password_salt, password_digest, device_id, expires_at)
     VALUES ($1, 'P0 Registration', $2, $3, 'salt', 'digest', 'p0-device', NOW() + INTERVAL '5 minutes')`,
    [pendingId, `p0-registration-${pendingId}@example.com`, `09${pendingId.replaceAll("-", "").slice(0, 8)}`],
  );
  t.after(async () => {
    await clearDatabase(database);
    await database.close();
  });

  const service = new RelationalRegistrationService(unitOfWork);
  const results = await Promise.allSettled([
    service.complete({ pendingRegistrationId: pendingId }),
    service.complete({ pendingRegistrationId: pendingId }),
  ]);
  const fulfilled = results.filter((result): result is PromiseFulfilledResult<{ customerId: string; accountId: string }> => result.status === "fulfilled");
  assert.equal(fulfilled.length, 2);
  assert.equal(fulfilled[0].value.customerId, fulfilled[1].value.customerId);
  assert.equal(fulfilled[0].value.accountId, fulfilled[1].value.accountId);
  const accounts = await database.query(
    `SELECT account_number, customer_id FROM payment_accounts
     WHERE account_number >= '9704100000000'
     ORDER BY account_number`,
  );
  assert.equal(accounts.rowCount, 1);
  assert.match(accounts.rows[0].account_number, /^9704[0-9]{9}$/);
  const audit = await database.query("SELECT COUNT(*) FROM audit_events WHERE event_type = 'CUSTOMER_REGISTERED'");
  assert.equal(audit.rows[0].count, "1");
});

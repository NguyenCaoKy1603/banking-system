import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { DatabasePool, UnitOfWork, withTransactionRetry } from "../database/index.js";
import { IdempotencyConflictError } from "../database/commandErrors.js";
import { RelationalTransferService } from "../database/transferService.js";
import { RelationalRegistrationService } from "../database/registrationService.js";

const databaseUrl =
  process.env.P0_RELATIONAL_DATABASE_URL?.trim() ??
  process.env.RELATIONAL_DATABASE_URL?.trim();

async function clearDatabase(database: DatabasePool): Promise<void> {
  await database.query(
    "UPDATE transfer_quotes SET consumed_transfer_id = NULL WHERE consumed_transfer_id IS NOT NULL",
  );
  for (const table of [
    "savings_maturity_operations",
    "savings_idempotency",
    "credit_idempotency",
    "refresh_session_records",
    "refresh_session_families",
    "auth_challenges",
    "pending_registrations",
    "rate_limit_buckets",
    "command_idempotency",
    "registration_completions",
    "reference_runtime_records",
    "outbox_events",
    "audit_events",
    "account_transactions",
    "ledger_entries",
    "ledger_journals",
    "transfers",
    "transfer_quotes",
    "beneficiaries",
    "payment_accounts",
    "auth_sessions",
    "customer_devices",
    "customers",
  ]) {
    await database.query(`DELETE FROM ${table}`);
  }
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
       (SELECT COUNT(*) FROM outbox_events WHERE deduplication_key = $1) AS outbox,
       (SELECT consumed_transfer_id FROM transfer_quotes WHERE id = $2) AS consumed`,
    [`TRANSFER_SUCCEEDED:${first.id}`, fixture.quoteId],
  );
  assert.equal(integrity.rows[0].transfers, "1");
  assert.equal(integrity.rows[0].transactions, "2");
  assert.equal(integrity.rows[0].journals, "1");
  assert.equal(integrity.rows[0].audits, "1");
  assert.equal(integrity.rows[0].outbox, "1");
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

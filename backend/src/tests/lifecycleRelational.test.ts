import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { DatabasePool } from "../database/pool.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { RelationalLifecycleService } from "../database/lifecycleService.js";
import { RelationalSavingsService } from "../database/savingsService.js";
import { assertDisposableDatabaseResetAllowed } from "../database/disposableDatabaseGuard.js";
import { EndpointCrypto } from "../notifications/endpointCrypto.js";
import { FakeEmailProvider, FakePushProvider } from "../notifications/providers/provider.js";
import { assertWorkerCutoverConfirmed, WorkerRuntime, type WorkerConfig } from "../workers/workerRuntime.js";

const databaseUrl = process.env.RELATIONAL_DATABASE_URL?.trim();
if (databaseUrl) assertDisposableDatabaseResetAllowed(databaseUrl, process.env, { targetEnvName: "RELATIONAL_DATABASE_URL" });

function accountNumber(id: string): string {
  return `9704${(Number.parseInt(id.replaceAll("-", "").slice(0, 8), 16) % 100000000).toString().padStart(8, "0")}`;
}

async function customerAndAccount(database: DatabasePool, label: string, balance = "10000000"): Promise<{ customerId: string; accountId: string }> {
  const customerId = randomUUID();
  const accountId = randomUUID();
  await database.query(
    `INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at)
     VALUES ($1, $2, $3, $4, 'salt', 'digest', NOW())`,
    [customerId, label, `${label.toLowerCase().replaceAll(" ", "-")}-${customerId}@example.test`, `09${customerId.replaceAll("-", "").slice(0, 8)}`],
  );
  await database.query(
    `INSERT INTO payment_accounts
      (id, customer_id, display_name, masked_number, currency, available_minor,
       current_minor, status, version, updated_at, account_number, bank_name,
       opening_balance_minor, held_minor)
     VALUES ($1, $2, 'Lifecycle source', $3, 'VND', $4, $4, 'ACTIVE', 0, NOW(), $5,
             'Reference Bank', 0, 0)`,
    [accountId, customerId, `•••• ${accountId.slice(-4)}`, balance, accountNumber(accountId)],
  );
  return { customerId, accountId };
}

test("Savings maturity/renewal is durable, balanced and one-shot across concurrent catch-up", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl!, max: 16 });
  const unitOfWork = new UnitOfWork(database);
  const savings = new RelationalSavingsService(unitOfWork);
  const lifecycle = new RelationalLifecycleService(unitOfWork);
  const fixture = await customerAndAccount(database, "Savings Lifecycle");
  t.after(() => database.close());

  const instructions = ["RETURN_PRINCIPAL_AND_INTEREST", "RENEW_PRINCIPAL", "RENEW_PRINCIPAL_AND_INTEREST"] as const;
  for (const [index, instruction] of instructions.entries()) {
    const quote = await savings.createQuote(fixture.customerId, {
      sourceAccountId: fixture.accountId,
      productId: "savings-vnd-1m",
      principal: { currency: "VND", amountMinor: "1000000" },
      maturityInstruction: instruction,
    });
    const opening = await savings.submitOpening({
      customerId: fixture.customerId,
      idempotencyKey: `lifecycle-savings-${index}-key`,
      request: { quoteId: quote.quoteId, stepUp: { method: "TOTP", proof: "not-used" } },
    });
    await database.query("UPDATE savings_deposits SET maturity_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [opening.depositId]);
  }

  const asOf = new Date().toISOString();
  const [first, second] = await Promise.all([
    lifecycle.runSavingsMaturities(asOf),
    lifecycle.runSavingsMaturities(asOf),
  ]);
  assert.equal(first + second, 3);
  const state = await database.query<{ active: string; matured: string; closed: string; deposits: string; balance: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM savings_deposits WHERE customer_id = $1 AND status = 'ACTIVE') AS active,
       (SELECT COUNT(*)::text FROM savings_deposits WHERE customer_id = $1 AND status = 'MATURED') AS matured,
       (SELECT COUNT(*)::text FROM savings_deposits WHERE customer_id = $1 AND status = 'CLOSED') AS closed,
       (SELECT COUNT(*)::text FROM savings_deposits WHERE customer_id = $1) AS deposits,
       (SELECT available_minor::text FROM payment_accounts WHERE id = $2) AS balance`,
    [fixture.customerId, fixture.accountId],
  );
  assert.equal(state.rows[0]?.active, "2");
  assert.equal(state.rows[0]?.matured, "1");
  assert.equal(state.rows[0]?.closed, "2");
  assert.equal(state.rows[0]?.deposits, "5");
  assert.ok(BigInt(state.rows[0]?.balance ?? "0") > 7000000n);

  const ledger = await database.query<{ journal_id: string; debit: string; credit: string }>(
    `SELECT journal_id,
       SUM(CASE WHEN side = 'DEBIT' THEN amount_minor ELSE 0 END)::text AS debit,
       SUM(CASE WHEN side = 'CREDIT' THEN amount_minor ELSE 0 END)::text AS credit
     FROM ledger_entries JOIN ledger_journals ON ledger_journals.id = ledger_entries.journal_id
     WHERE journal_type = 'SAVINGS_MATURITY' GROUP BY journal_id`,
  );
  assert.equal(ledger.rows.length, 3);
  assert.ok(ledger.rows.every((row) => row.debit === row.credit));
  assert.equal(await lifecycle.runSavingsMaturities(asOf), 0);
});

test("Credit close, overdue, pending payment and reversal are idempotent and never overpay", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl!, max: 16 });
  const unitOfWork = new UnitOfWork(database);
  const lifecycle = new RelationalLifecycleService(unitOfWork);
  const fixture = await customerAndAccount(database, "Credit Lifecycle", "10000000");
  const creditAccountId = randomUUID();
  const cardId = randomUUID();
  const transactionId = randomUUID();
  const now = new Date();
  const cycleEnd = new Date(now.getTime() - 60 * 60 * 1000);
  const cycleStart = new Date(cycleEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
  await database.query(
    `INSERT INTO credit_accounts
      (id, customer_id, currency, credit_limit_minor, posted_outstanding_minor,
       pending_authorizations_minor, next_statement_at, status, version, updated_at)
     VALUES ($1,$2,'VND',10000000,2000000,0,$3,'ACTIVE',0,NOW())`,
    [creditAccountId, fixture.customerId, cycleEnd.toISOString()],
  );
  await database.query(
    `INSERT INTO credit_cards
      (id, credit_account_id, customer_id, display_name, brand, masked_number,
       last_four, expiry_month, expiry_year, status, updated_at)
     VALUES ($1,$2,$3,'Lifecycle card','VISA','•••• •••• •••• 2468','2468',12,30,'ACTIVE',NOW())`,
    [cardId, creditAccountId, fixture.customerId],
  );
  await database.query(
    `INSERT INTO credit_transactions
      (id, credit_account_id, statement_id, type, status, description,
       merchant_name, amount_minor, debt_effect, occurred_at, posted_at)
     VALUES ($1,$2,NULL,'PURCHASE','POSTED','Lifecycle purchase','Merchant',2000000,'INCREASE',$3,$3)`,
    [transactionId, creditAccountId, cycleStart.toISOString()],
  );
  t.after(() => database.close());

  const closeSummary = await lifecycle.runCreditLifecycle(now.toISOString());
  assert.equal(closeSummary.statementsClosed, 1);
  const statement = await database.query<{ id: string; version: string; remaining_amount_due_minor: string }>(
    "SELECT id, version, remaining_amount_due_minor::text FROM credit_statements WHERE credit_account_id = $1",
    [creditAccountId],
  );
  assert.equal(statement.rows.length, 1);
  assert.equal(statement.rows[0]?.remaining_amount_due_minor, "2000000");

  const quoteId = randomUUID();
  const paymentId = randomUUID();
  await database.query(
    `INSERT INTO credit_payment_quotes
      (id, customer_id, source_account_id, credit_account_id, statement_id,
       statement_version, payment_option, amount_minor, fee_minor,
       request_fingerprint, expires_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,'CUSTOM',500000,0,'lifecycle-payment-fingerprint',$7,NOW())`,
    [quoteId, fixture.customerId, fixture.accountId, creditAccountId, statement.rows[0]!.id, statement.rows[0]!.version, new Date(now.getTime() + 60 * 60 * 1000).toISOString()],
  );
  await database.query(
    `INSERT INTO credit_payments
      (id, customer_id, quote_id, credit_account_id, statement_id,
       source_account_id, idempotency_key, request_fingerprint, reference,
       amount_minor, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'lifecycle-payment-key','lifecycle-payment-fingerprint','CRD-LIFECYCLE',500000,'PENDING',NOW(),NOW())`,
    [paymentId, fixture.customerId, quoteId, creditAccountId, statement.rows[0]!.id, fixture.accountId],
  );

  const [first, second] = await Promise.all([
    lifecycle.runCreditLifecycle(new Date(now.getTime() + 1000).toISOString()),
    lifecycle.runCreditLifecycle(new Date(now.getTime() + 1000).toISOString()),
  ]);
  assert.equal(first.paymentsSettled + second.paymentsSettled, 1);
  const paid = await database.query<{ status: string; available_minor: string; outstanding: string; remaining: string }>(
    `SELECT p.status, a.available_minor::text,
            ca.posted_outstanding_minor::text AS outstanding,
            s.remaining_amount_due_minor::text AS remaining
     FROM credit_payments p
     JOIN payment_accounts a ON a.id = p.source_account_id
     JOIN credit_accounts ca ON ca.id = p.credit_account_id
     JOIN credit_statements s ON s.id = p.statement_id
     WHERE p.id = $1`,
    [paymentId],
  );
  assert.deepEqual(paid.rows[0], { status: "SUCCEEDED", available_minor: "9500000", outstanding: "1500000", remaining: "1500000" });

  await database.query("UPDATE credit_statements SET due_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [statement.rows[0]!.id]);
  const overdue = await lifecycle.runCreditLifecycle(new Date(now.getTime() + 2000).toISOString());
  assert.equal(overdue.statementsOverdue, 1);
  assert.equal((await database.query<{ status: string }>("SELECT status FROM credit_statements WHERE id = $1", [statement.rows[0]!.id])).rows[0]?.status, "OVERDUE");

  assert.equal(await lifecycle.reverseCreditPayment(paymentId), true);
  assert.equal(await lifecycle.reverseCreditPayment(paymentId), false);
  const reversed = await database.query<{ status: string; available_minor: string; outstanding: string; remaining: string }>(
    `SELECT p.status, a.available_minor::text,
            ca.posted_outstanding_minor::text AS outstanding,
            s.remaining_amount_due_minor::text AS remaining
     FROM credit_payments p
     JOIN payment_accounts a ON a.id = p.source_account_id
     JOIN credit_accounts ca ON ca.id = p.credit_account_id
     JOIN credit_statements s ON s.id = p.statement_id
     WHERE p.id = $1`,
    [paymentId],
  );
  assert.deepEqual(reversed.rows[0], { status: "REVERSED", available_minor: "10000000", outstanding: "2000000", remaining: "2000000" });
  const ledger = await database.query<{ journal_id: string; debit: string; credit: string }>(
    `SELECT journal_id,
       SUM(CASE WHEN side = 'DEBIT' THEN amount_minor ELSE 0 END)::text AS debit,
       SUM(CASE WHEN side = 'CREDIT' THEN amount_minor ELSE 0 END)::text AS credit
     FROM ledger_entries JOIN ledger_journals ON ledger_journals.id = ledger_entries.journal_id
     WHERE aggregate_id = $1 GROUP BY journal_id`,
    [paymentId],
  );
  assert.equal(ledger.rows.length, 2);
  assert.ok(ledger.rows.every((row) => row.debit === row.credit));
});

test("scheduled lifecycle and worker can run together, then restart without replay", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl!, max: 16 });
  const unitOfWork = new UnitOfWork(database);
  const savings = new RelationalSavingsService(unitOfWork);
  const lifecycle = new RelationalLifecycleService(unitOfWork);
  const fixture = await customerAndAccount(database, "Lifecycle Worker");
  const quote = await savings.createQuote(fixture.customerId, {
    sourceAccountId: fixture.accountId,
    productId: "savings-vnd-1m",
    principal: { currency: "VND", amountMinor: "1000000" },
    maturityInstruction: "RETURN_PRINCIPAL_AND_INTEREST",
  });
  const opening = await savings.submitOpening({
    customerId: fixture.customerId,
    idempotencyKey: "lifecycle-worker-savings-key",
    request: { quoteId: quote.quoteId, stepUp: { method: "TOTP", proof: "not-used" } },
  });
  await database.query("UPDATE savings_deposits SET maturity_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [opening.depositId]);
  assertWorkerCutoverConfirmed({ WORKER_CUTOVER_CONFIRMED: "1" });
  const workerConfig = (workerId: string): WorkerConfig => ({
    workerId,
    workerVersion: "lifecycle-worker-test",
    pollIntervalMs: 5,
    batchSize: 100,
    concurrency: 4,
    leaseSeconds: 60,
    maxAttempts: 3,
    heartbeatIntervalMs: 10_000,
    shutdownTimeoutMs: 1_000,
    databaseUrl: databaseUrl!,
    persistenceMode: "relational-v2",
    allowLegacyWriter: false,
  });
  const worker = new WorkerRuntime(workerConfig("lifecycle-worker-a"), database, {
    push: new FakePushProvider(),
    email: new FakeEmailProvider(),
    endpointCrypto: new EndpointCrypto("lifecycle-worker-test-key"),
  });
  await worker.initialize();
  const [scheduled, workerRun] = await Promise.all([
    lifecycle.runSavingsMaturities(new Date().toISOString()),
    worker.runOnce(),
  ]);
  assert.equal(scheduled, 1);
  assert.ok(workerRun.dispatched >= 0);

  const restartedLifecycle = new RelationalLifecycleService(new UnitOfWork(database));
  const restartedWorker = new WorkerRuntime(workerConfig("lifecycle-worker-b"), database, {
    push: new FakePushProvider(),
    email: new FakeEmailProvider(),
    endpointCrypto: new EndpointCrypto("lifecycle-worker-test-key"),
  });
  await restartedWorker.initialize();
  const [scheduledAfterRestart, workerAfterRestart] = await Promise.all([
    restartedLifecycle.runSavingsMaturities(new Date().toISOString()),
    restartedWorker.runOnce(),
  ]);
  assert.equal(scheduledAfterRestart, 0);
  assert.ok(workerAfterRestart.dispatched >= 0);
  const counts = await database.query<{ deposits: string; maturityOps: string; dispatched: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM savings_deposits WHERE customer_id = $1) AS deposits,
       (SELECT COUNT(*)::text FROM savings_maturity_operations WHERE deposit_id = $2) AS "maturityOps",
       (SELECT COUNT(*)::text FROM outbox_events WHERE aggregate_id = $2::text AND status = 'DISPATCHED') AS dispatched`,
    [fixture.customerId, opening.depositId],
  );
  assert.equal(counts.rows[0]?.deposits, "1");
  assert.equal(counts.rows[0]?.maturityOps, "1");
  assert.equal(counts.rows[0]?.dispatched, "1");
  await database.close();
});

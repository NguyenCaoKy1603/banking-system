import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { DatabasePool } from "../database/pool.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { RelationalCreditService } from "../database/creditService.js";
import { assertDisposableDatabaseResetAllowed } from "../database/disposableDatabaseGuard.js";

const databaseUrl = process.env.RELATIONAL_DATABASE_URL?.trim();
if (databaseUrl) assertDisposableDatabaseResetAllowed(databaseUrl, process.env, { targetEnvName: "RELATIONAL_DATABASE_URL" });

function accountNumber(id: string): string {
  return `9704${(Number.parseInt(id.replaceAll("-", "").slice(0, 8), 16) % 100000000).toString().padStart(8, "0")}`;
}

async function fixture(database: DatabasePool): Promise<{
  customerId: string;
  sourceAccountId: string;
  creditAccountId: string;
  cardId: string;
  statementId: string;
}> {
  const customerId = randomUUID();
  const sourceAccountId = randomUUID();
  const creditAccountId = randomUUID();
  const cardId = randomUUID();
  const statementId = randomUUID();
  await createSource(database, customerId, sourceAccountId);
  await database.query(
    `INSERT INTO credit_accounts
      (id, customer_id, currency, credit_limit_minor, posted_outstanding_minor,
       pending_authorizations_minor, next_statement_at, status, version, updated_at)
     VALUES ($1, $2, 'VND', 5000000, 3000000, 0, NOW() + INTERVAL '30 days', 'ACTIVE', 0, NOW())`,
    [creditAccountId, customerId],
  );
  await database.query(
    `INSERT INTO credit_cards
      (id, credit_account_id, customer_id, display_name, brand, masked_number,
       last_four, expiry_month, expiry_year, status, updated_at)
     VALUES ($1, $2, $3, 'Reference Sandbox Card', 'VISA', '•••• •••• •••• 2468',
             '2468', 12, 2029, 'ACTIVE', NOW())`,
    [cardId, creditAccountId, customerId],
  );
  await database.query(
    `INSERT INTO credit_statements
      (id, credit_account_id, cycle_start_at, cycle_end_at, issued_at, due_at,
       opening_balance_minor, purchase_total_minor, refund_total_minor,
       fee_total_minor, interest_total_minor, closing_balance_minor,
       remaining_amount_due_minor, minimum_payment_due_minor,
       minimum_payment_remaining_minor, paid_amount_minor, status, version)
     VALUES ($1, $2, NOW() - INTERVAL '30 days', NOW(), NOW(), NOW() + INTERVAL '15 days',
             3000000, 3000000, 0, 0, 0, 3000000, 3000000, 150000,
             150000, 0, 'ISSUED', 1)`,
    [statementId, creditAccountId],
  );
  return { customerId, sourceAccountId, creditAccountId, cardId, statementId };
}

async function createSource(database: DatabasePool, customerId: string, sourceAccountId: string): Promise<void> {
  await database.query(
    `INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at)
     VALUES ($1, 'Credit relational user', $2, $3, 'salt', 'digest', NOW())`,
    [customerId, `credit-${customerId}@example.test`, `09${customerId.replaceAll("-", "").slice(0, 8)}`],
  );
  await database.query(
    `INSERT INTO payment_accounts
      (id, customer_id, display_name, masked_number, currency, available_minor,
       current_minor, status, version, updated_at, account_number, bank_name,
       opening_balance_minor, held_minor)
     VALUES ($1, $2, 'Credit payment source', '•••• 9002', 'VND', 10000000, 10000000,
             'ACTIVE', 0, NOW(), $3, 'Reference Bank', 0, 0)`,
    [sourceAccountId, customerId, accountNumber(sourceAccountId)],
  );
}

test("relational credit payment is atomic, prevents concurrent overpay and is restart-readable", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 12 });
  const credit = new RelationalCreditService(new UnitOfWork(database));
  const ids = await fixture(database);
  t.after(() => database.close());

  const quote = await credit.createPaymentQuote(ids.customerId, {
    sourceAccountId: ids.sourceAccountId,
    creditAccountId: ids.creditAccountId,
    statementId: ids.statementId,
    paymentOption: "CUSTOM",
    amount: { currency: "VND", amountMinor: "1000000" },
  });
  const requestFingerprint = await credit.getPaymentStepUpRequestFingerprint(quote.quoteId);
  assert.ok(requestFingerprint);
  const results = await Promise.allSettled([
    credit.submitPayment({ customerId: ids.customerId, idempotencyKey: "credit-payment-concurrent-1", quoteId: quote.quoteId, requestFingerprint }),
    credit.submitPayment({ customerId: ids.customerId, idempotencyKey: "credit-payment-concurrent-2", quoteId: quote.quoteId, requestFingerprint }),
  ]);
  const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<RelationalCreditService["submitPayment"]>>> => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal((await credit.listAccounts(ids.customerId))[0]?.postedOutstanding.amountMinor, "2000000");

  const counts = await database.query<{ payments: string; ledger: string; outbox: string; debits: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM credit_payments WHERE customer_id = $1) AS payments,
       (SELECT COUNT(*)::text FROM ledger_journals WHERE aggregate_id = $2 AND journal_type = 'CREDIT_PAYMENT') AS ledger,
       (SELECT COUNT(*)::text FROM outbox_events WHERE aggregate_id = $2 AND event_type = 'credit.payment_succeeded.v1') AS outbox,
       (SELECT COUNT(*)::text FROM account_transactions WHERE account_id = $3 AND credit_payment_id IS NOT NULL) AS debits`,
    [ids.customerId, fulfilled[0]?.value.paymentId, ids.sourceAccountId],
  );
  assert.deepEqual(counts.rows[0], { payments: "1", ledger: "1", outbox: "1", debits: "1" });

  const restarted = new RelationalCreditService(new UnitOfWork(database));
  const statement = await restarted.getStatement(ids.customerId, ids.creditAccountId, ids.statementId);
  assert.equal(statement.remainingAmountDue.amountMinor, "2000000");
  assert.equal(statement.payments.length, 1);
  assert.equal((await restarted.listCards(ids.customerId)).items[0]?.cardId, ids.cardId);
});

test("relational credit payment rollback leaves quote, balances, ledger and outbox untouched", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 8 });
  const credit = new RelationalCreditService(new UnitOfWork(database));
  const ids = await fixture(database);
  t.after(() => database.close());
  const quote = await credit.createPaymentQuote(ids.customerId, {
    sourceAccountId: ids.sourceAccountId,
    creditAccountId: ids.creditAccountId,
    statementId: ids.statementId,
    paymentOption: "FULL_STATEMENT",
  });
  const requestFingerprint = await credit.getPaymentStepUpRequestFingerprint(quote.quoteId);
  assert.ok(requestFingerprint);
  await assert.rejects(
    credit.submitPayment({
      customerId: ids.customerId,
      idempotencyKey: "credit-payment-rollback-1",
      quoteId: quote.quoteId,
      requestFingerprint,
      fault: async (point) => { if (point === "after_ledger") throw new Error("credit-fault"); },
    }),
    /credit-fault/,
  );
  const state = await database.query<{ available: string; outstanding: string; remaining: string; consumed: string; payments: string; journals: string; outbox: string }>(
    `SELECT
       (SELECT available_minor::text FROM payment_accounts WHERE id = $1) AS available,
       (SELECT posted_outstanding_minor::text FROM credit_accounts WHERE id = $2) AS outstanding,
       (SELECT remaining_amount_due_minor::text FROM credit_statements WHERE id = $3) AS remaining,
       (SELECT COUNT(*)::text FROM credit_payment_quotes WHERE id = $4 AND consumed_at IS NOT NULL) AS consumed,
       (SELECT COUNT(*)::text FROM credit_payments WHERE customer_id = $5) AS payments,
       (SELECT COUNT(*)::text FROM ledger_journals WHERE aggregate_id = $4::text AND journal_type = 'CREDIT_PAYMENT') AS journals,
       (SELECT COUNT(*)::text FROM outbox_events WHERE event_type = 'credit.payment_succeeded.v1' AND aggregate_id = $4::text) AS outbox`,
    [ids.sourceAccountId, ids.creditAccountId, ids.statementId, quote.quoteId, ids.customerId],
  );
  assert.deepEqual(state.rows[0], { available: "10000000", outstanding: "3000000", remaining: "3000000", consumed: "0", payments: "0", journals: "0", outbox: "0" });
});

test("relational credit application activation creates account, card and statement atomically", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 8 });
  const credit = new RelationalCreditService(new UnitOfWork(database));
  const customerId = randomUUID();
  const sourceAccountId = randomUUID();
  await createSource(database, customerId, sourceAccountId);
  t.after(() => database.close());
  const application = await credit.submitApplication({
    customerId,
    idempotencyKey: "credit-application-key-1",
    request: { requestedLimit: { currency: "VND", amountMinor: "4000000" }, stepUp: { method: "TOTP", proof: "not-used" } },
  });
  await database.query("UPDATE credit_applications SET status = 'PENDING_ACTIVATION', approved_limit_minor = requested_limit_minor, decision_at = NOW(), version = version + 1, updated_at = NOW() WHERE id = $1", [application.applicationId]);
  const activated = await credit.activateApplication({ customerId, applicationId: application.applicationId, idempotencyKey: "credit-activation-key-1" });
  assert.equal(activated.status, "ACTIVE");
  assert.ok(activated.creditAccountId);
  assert.equal((await credit.listAccounts(customerId)).length, 1);
  const applicationRow = await database.query<{ cards: string; statements: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM credit_cards WHERE credit_account_id = $1) AS cards,
       (SELECT COUNT(*)::text FROM credit_statements WHERE credit_account_id = $1) AS statements`,
    [activated.creditAccountId],
  );
  assert.deepEqual(applicationRow.rows[0], { cards: "1", statements: "1" });
});

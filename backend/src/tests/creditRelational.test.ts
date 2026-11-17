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
       pending_authorizations_minor, current_cycle_start_at, next_statement_at, status, version, updated_at)
     VALUES ($1, $2, 'VND', 5000000, 3000000, 0, NOW() - INTERVAL '30 days', NOW() + INTERVAL '30 days', 'ACTIVE', 0, NOW())`,
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

test("credit repayment remains available while new credit is frozen and fails closed only on its command switch", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 8 });
  const credit = new RelationalCreditService(new UnitOfWork(database));
  const ids = await fixture(database);
  const originalPolicy = (await database.query<{
    global_kill_switch: boolean;
    credit_enabled: boolean;
    credit_payments_enabled: boolean;
  }>(
    `SELECT global_kill_switch, credit_enabled, credit_payments_enabled
       FROM control_policy
      WHERE singleton = true`,
  )).rows[0]!;

  t.after(async () => {
    await database.query(
      `UPDATE control_policy
          SET global_kill_switch = $1,
              credit_enabled = $2,
              credit_payments_enabled = $3,
              updated_at = NOW()
        WHERE singleton = true`,
      [
        originalPolicy.global_kill_switch,
        originalPolicy.credit_enabled,
        originalPolicy.credit_payments_enabled,
      ],
    );
    await database.close();
  });

  await database.query("UPDATE credit_accounts SET status = 'FROZEN', updated_at = NOW() WHERE id = $1", [ids.creditAccountId]);
  await database.query("UPDATE credit_cards SET status = 'BLOCKED', updated_at = NOW() WHERE id = $1", [ids.cardId]);
  await database.query(
    `UPDATE control_policy
        SET global_kill_switch = true,
            credit_enabled = false,
            credit_payments_enabled = true,
            updated_at = NOW()
      WHERE singleton = true`,
  );

  const quote = await credit.createPaymentQuote(ids.customerId, {
    sourceAccountId: ids.sourceAccountId,
    creditAccountId: ids.creditAccountId,
    statementId: ids.statementId,
    paymentOption: "CUSTOM",
    amount: { currency: "VND", amountMinor: "500000" },
  });
  const requestFingerprint = await credit.getPaymentStepUpRequestFingerprint(quote.quoteId);
  assert.ok(requestFingerprint);
  const payment = await credit.submitPayment({
    customerId: ids.customerId,
    idempotencyKey: "credit-payment-frozen-account-1",
    quoteId: quote.quoteId,
    requestFingerprint,
  });
  assert.equal(payment.status, "SUCCEEDED");
  assert.equal((await credit.listAccounts(ids.customerId))[0]?.status, "FROZEN");
  assert.equal((await credit.getStatement(ids.customerId, ids.creditAccountId, ids.statementId)).remainingAmountDue.amountMinor, "2500000");

  const pendingQuote = await credit.createPaymentQuote(ids.customerId, {
    sourceAccountId: ids.sourceAccountId,
    creditAccountId: ids.creditAccountId,
    statementId: ids.statementId,
    paymentOption: "CUSTOM",
    amount: { currency: "VND", amountMinor: "100000" },
  });
  const pendingFingerprint = await credit.getPaymentStepUpRequestFingerprint(pendingQuote.quoteId);
  assert.ok(pendingFingerprint);
  const beforeDisabled = await database.query<{
    source_balance: string;
    outstanding: string;
    payments: string;
  }>(
    `SELECT
       (SELECT available_minor::text FROM payment_accounts WHERE id = $1) AS source_balance,
       (SELECT posted_outstanding_minor::text FROM credit_accounts WHERE id = $2) AS outstanding,
       (SELECT COUNT(*)::text FROM credit_payments WHERE customer_id = $3) AS payments`,
    [ids.sourceAccountId, ids.creditAccountId, ids.customerId],
  );

  await database.query("UPDATE control_policy SET credit_payments_enabled = false, updated_at = NOW() WHERE singleton = true");
  await assert.rejects(
    credit.createPaymentQuote(ids.customerId, {
      sourceAccountId: ids.sourceAccountId,
      creditAccountId: ids.creditAccountId,
      statementId: ids.statementId,
      paymentOption: "CUSTOM",
      amount: { currency: "VND", amountMinor: "100000" },
    }),
    /CREDIT_PAYMENTS_DISABLED|temporarily unavailable/i,
  );
  await assert.rejects(
    credit.submitPayment({
      customerId: ids.customerId,
      idempotencyKey: "credit-payment-disabled-1",
      quoteId: pendingQuote.quoteId,
      requestFingerprint: pendingFingerprint,
    }),
    /CREDIT_PAYMENTS_DISABLED|temporarily unavailable/i,
  );

  const afterDisabled = await database.query<{
    source_balance: string;
    outstanding: string;
    payments: string;
    consumed: string;
  }>(
    `SELECT
       (SELECT available_minor::text FROM payment_accounts WHERE id = $1) AS source_balance,
       (SELECT posted_outstanding_minor::text FROM credit_accounts WHERE id = $2) AS outstanding,
       (SELECT COUNT(*)::text FROM credit_payments WHERE customer_id = $3) AS payments,
       (SELECT COUNT(*)::text FROM credit_payment_quotes WHERE id = $4 AND consumed_at IS NOT NULL) AS consumed`,
    [ids.sourceAccountId, ids.creditAccountId, ids.customerId, pendingQuote.quoteId],
  );
  assert.deepEqual(afterDisabled.rows[0], { ...beforeDisabled.rows[0], consumed: "0" });
  assert.equal((await credit.listStatements(ids.customerId, ids.creditAccountId)).items.length, 1);
});

test("relational credit application activation creates account and card without a zero placeholder statement", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 8 });
  const credit = new RelationalCreditService(new UnitOfWork(database));
  const customerId = randomUUID();
  const sourceAccountId = randomUUID();
  await createSource(database, customerId, sourceAccountId);
  t.after(() => database.close());
  await assert.rejects(
    credit.submitApplication({
      customerId,
      idempotencyKey: "credit-application-unverified-kyc",
      request: { requestedLimit: { currency: "VND", amountMinor: "4000000" }, stepUp: { method: "TOTP", proof: "not-used" } },
    }),
    /KYC_REQUIRED|KYC application must be approved/i,
  );
  await database.query(
    `INSERT INTO kyc_applications
       (id, customer_id, status, applicant_label, request_fingerprint, synthetic_payload, decision_reason_code, decision_at, version, created_at, updated_at, submitted_at)
     VALUES
       ($1, $2, 'APPROVED', 'Credit Test Applicant', $3, '{}'::jsonb, 'KYC_VERIFIED', NOW(), 1, NOW(), NOW(), NOW())`,
    [randomUUID(), customerId, `fp-kyc-${customerId}`],
  );
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
  assert.deepEqual(applicationRow.rows[0], { cards: "1", statements: "0" });
  const cycle = await database.query<{ current_cycle_start_at: Date; next_statement_at: Date }>(
    "SELECT current_cycle_start_at, next_statement_at FROM credit_accounts WHERE id = $1",
    [activated.creditAccountId],
  );
  assert.ok(cycle.rows[0]!.current_cycle_start_at < cycle.rows[0]!.next_statement_at);
});

test("persistent card lock is emergency-safe and idempotent while unlock remains policy-gated", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 8 });
  const credit = new RelationalCreditService(new UnitOfWork(database));
  const ids = await fixture(database);
  const original = (await database.query("SELECT global_kill_switch, card_controls_enabled FROM control_policy WHERE singleton=true")).rows[0]!;
  t.after(async () => {
    await database.query("UPDATE control_policy SET global_kill_switch=$1, card_controls_enabled=$2, updated_at=NOW() WHERE singleton=true", [original.global_kill_switch, original.card_controls_enabled]);
    await database.close();
  });
  await database.query("UPDATE control_policy SET global_kill_switch=true, card_controls_enabled=true, updated_at=NOW() WHERE singleton=true");
  assert.equal((await credit.setCardStatus(ids.customerId, ids.cardId, "LOCKED")).status, "LOCKED");
  const afterFirst = await database.query<{ audits: string; outbox: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM audit_events WHERE resource_id=$1 AND event_type='CREDIT_CARD_LOCKED') AS audits,
       (SELECT COUNT(*)::text FROM outbox_events WHERE aggregate_id=$1::text AND event_type='credit.card_locked.v1') AS outbox`,
    [ids.cardId],
  );
  assert.deepEqual(afterFirst.rows[0], { audits: "1", outbox: "1" });
  assert.equal((await credit.setCardStatus(ids.customerId, ids.cardId, "LOCKED")).status, "LOCKED");
  const afterRetry = await database.query<{ audits: string; outbox: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM audit_events WHERE resource_id=$1 AND event_type='CREDIT_CARD_LOCKED') AS audits,
       (SELECT COUNT(*)::text FROM outbox_events WHERE aggregate_id=$1::text AND event_type='credit.card_locked.v1') AS outbox`,
    [ids.cardId],
  );
  assert.deepEqual(afterRetry.rows[0], afterFirst.rows[0]);
  await assert.rejects(credit.setCardStatus(ids.customerId, ids.cardId, "ACTIVE"), /CARD_CONTROLS_DISABLED|temporarily unavailable/i);
  await database.query("UPDATE control_policy SET global_kill_switch=false, updated_at=NOW() WHERE singleton=true");
  assert.equal((await credit.setCardStatus(ids.customerId, ids.cardId, "ACTIVE")).status, "ACTIVE");
});

test("reported-lost card is blocked and creates one durable operations case under concurrency", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 12 });
  const credit = new RelationalCreditService(new UnitOfWork(database));
  const ids = await fixture(database);
  t.after(() => database.close());
  const [first, second] = await Promise.all([
    credit.reportCardLost(ids.customerId, ids.cardId, "card-lost-a"),
    credit.reportCardLost(ids.customerId, ids.cardId, "card-lost-b"),
  ]);
  assert.equal(first.caseId, second.caseId);
  assert.equal(first.card.status, "BLOCKED");
  assert.equal(second.card.status, "BLOCKED");
  const persisted = await database.query<{ status: string; cases: string; audits: string; outbox: string; notifications: string }>(
    `SELECT
       (SELECT status FROM credit_cards WHERE id=$1) AS status,
       (SELECT COUNT(*)::text FROM card_security_cases WHERE card_id=$1 AND case_type='REPORTED_LOST' AND status='OPEN') AS cases,
       (SELECT COUNT(*)::text FROM audit_events WHERE resource_id=$1::text AND event_type='CREDIT_CARD_REPORTED_LOST') AS audits,
       (SELECT COUNT(*)::text FROM outbox_events WHERE aggregate_id=$3::text AND event_type='credit.card_reported_lost.v1') AS outbox,
       (SELECT COUNT(*)::text FROM notifications WHERE customer_id=$2 AND resource_id=$3::text) AS notifications`,
    [ids.cardId, ids.customerId, first.caseId],
  );
  assert.deepEqual(persisted.rows[0], { status: "BLOCKED", cases: "1", audits: "1", outbox: "1", notifications: "1" });
  await assert.rejects(credit.reportCardLost(randomUUID(), ids.cardId), /Card not found/i);
});

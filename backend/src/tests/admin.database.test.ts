import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { PostgresAdminRepository } from "../admin/repositories/adminRepository.js";
import { DatabasePool } from "../database/pool.js";
import { BankingSystem } from "../bankingSystem.js";
import { PostgresRelationalRepository } from "../postgresRelationalRepository.js";
import { buildEnvelope } from "../outbox/eventRegistry.js";
import { EndpointCrypto } from "../notifications/endpointCrypto.js";
import { FakeEmailProvider, FakePushProvider } from "../notifications/providers/provider.js";
import { WorkerRuntime } from "../workers/workerRuntime.js";

const databaseUrl = process.env.ADMIN_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();

async function insertOpeningLedger(pool: Pool, accountId: string, amountMinor: string, aggregateId: string): Promise<void> {
  const client = await pool.connect();
  const journalId = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO ledger_journals (id, aggregate_id, journal_type, currency, occurred_at, created_at) VALUES ($1,$2,'REFERENCE_FIXTURE','VND',NOW(),NOW())",
      [journalId, aggregateId],
    );
    await client.query(
      "INSERT INTO ledger_entries (journal_id,line_number,account_ref,side,amount_minor,currency) VALUES ($1,1,'sandbox-funding-source','DEBIT',$2,'VND'),($1,2,$3,'CREDIT',$2,'VND')",
      [journalId, amountMinor, `payment-account:${accountId}`],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

test("PostgreSQL Admin funding action is typed, atomic and single-execution", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const repository = new PostgresAdminRepository({ connectionString: databaseUrl, maxConnections: 4 });
  const customerId = randomUUID();
  const accountId = randomUUID();
  const makerId = randomUUID();
  const checkerId = randomUUID();
  const racingCheckerId = randomUUID();
  const accountNumber = `9704${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`.slice(0, 24);
  try {
    await repository.initialize();
    await pool.query("INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at) VALUES ($1,$2,$3,$4,'test-salt','test-digest',NOW())", [customerId, "Admin integration fixture", `${customerId}@example.test`, `09${customerId.replaceAll('-', '').slice(0, 9)}`]);
    await pool.query("INSERT INTO payment_accounts (id, customer_id, display_name, masked_number, account_number, currency, available_minor, current_minor, held_minor, status, version, updated_at) VALUES ($1,$2,'Integration account','•••• 0001',$3,'VND',0,0,0,'ACTIVE',0,NOW())", [accountId, customerId, accountNumber]);
    for (const [id, email] of [[makerId, `${makerId}@example.test`], [checkerId, `${checkerId}@example.test`], [racingCheckerId, `${racingCheckerId}@example.test`]]) {
      await pool.query("INSERT INTO staff_users (id, employee_code, email_normalized, display_name, password_salt, password_digest, status) VALUES ($1,$2,lower($3),$4,'salt','digest','ACTIVE')", [id, `E-${id.slice(0, 8)}`, email, "Admin integration fixture"]);
    }
    const action = await repository.createAction({
      actionType: "SIMULATION_FUNDING", requesterStaffId: makerId, targetType: "ACCOUNT", targetId: accountId,
      requestFingerprint: `test-${randomUUID()}`, policyVersion: "admin-p0-v1", idempotencyKey: `integration-${randomUUID()}`,
      expectedTargetVersion: 0, expectedTargetStatus: "ACTIVE", expiresAt: new Date(Date.now() + 60_000).toISOString(),
      payload: { amountMinor: "1000", currency: "VND", reasonCode: "INTEGRATION_TEST", ticketReference: "TEST-ADMIN-1", description: "Synthetic integration funding" },
    });
    const typed = await pool.query("SELECT amount_minor, currency, ticket_reference FROM simulation_funding_requests WHERE request_id=$1", [action.id]);
    assert.deepEqual(typed.rows[0], { amount_minor: "1000", currency: "VND", ticket_reference: "TEST-ADMIN-1" });
    const decisions = await Promise.all([
      repository.decideAction({ requestId: action.id, reviewerStaffId: checkerId, decision: "APPROVED", approvedFingerprint: action.requestFingerprint, reasonCode: "INTEGRATION_APPROVED", mfaVerifiedAt: new Date().toISOString() }),
      repository.decideAction({ requestId: action.id, reviewerStaffId: racingCheckerId, decision: "APPROVED", approvedFingerprint: action.requestFingerprint, reasonCode: "INTEGRATION_RACE", mfaVerifiedAt: new Date().toISOString() }),
    ]);
    assert.equal(decisions[0].id, decisions[1].id);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM admin_action_decisions WHERE request_id=$1", [action.id])).rows[0].count, 1);
    const results = await Promise.all([
      repository.executeApprovedAction({ requestId: action.id, approverStaffId: checkerId, traceId: "admin-db-test-a" }),
      repository.executeApprovedAction({ requestId: action.id, approverStaffId: checkerId, traceId: "admin-db-test-b" }),
    ]);
    assert.equal(results.filter((result) => result.status === "SUCCEEDED").length, 1);
    assert.equal(results.filter((result) => result.failureCode === "ACTION_ALREADY_DECIDED").length, 1);
    const balance = await pool.query("SELECT available_minor, current_minor, version FROM payment_accounts WHERE id=$1", [accountId]);
    assert.deepEqual(balance.rows[0], { available_minor: "1000", current_minor: "1000", version: "1" });
    const ledger = await pool.query("SELECT COUNT(*)::int AS count FROM ledger_journals WHERE aggregate_id=$1", [action.id]);
    const outbox = await pool.query("SELECT COUNT(*)::int AS count FROM outbox_events WHERE deduplication_key=$1", [`admin-funding:${action.id}`]);
    const transactions = await pool.query("SELECT direction, amount_minor, kind, status FROM account_transactions WHERE account_id=$1 AND kind='SANDBOX_FUNDING'", [accountId]);
    const audit = await pool.query("SELECT event_type, outcome, request_id FROM audit_events WHERE request_id=$1 AND event_type='ADMIN_SIMULATION_FUNDING_SUCCEEDED'", [action.id]);
    assert.equal(ledger.rows[0].count, 1);
    assert.equal(outbox.rows[0].count, 1);
    assert.deepEqual(transactions.rows, [{ direction: "CREDIT", amount_minor: "1000", kind: "SANDBOX_FUNDING", status: "SUCCEEDED" }]);
    assert.deepEqual(audit.rows, [{ event_type: "ADMIN_SIMULATION_FUNDING_SUCCEEDED", outcome: "SUCCEEDED", request_id: action.id }]);
  } finally {
    await repository.close();
    await pool.end();
  }
});

test("PostgreSQL Admin funding rolls back when ledger or outbox execution faults", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  let stage: "after_ledger_write" | "after_outbox_write" = "after_ledger_write";
  const repository = new PostgresAdminRepository({ connectionString: databaseUrl, maxConnections: 4, executionFault: async (current) => { if (current === stage) throw new Error(`ADMIN_TEST_FAULT:${current}`); } });
  const makerId = randomUUID();
  const checkerId = randomUUID();
  try {
    await repository.initialize();
    for (const [id, email] of [[makerId, `${makerId}@example.test`], [checkerId, `${checkerId}@example.test`]]) {
      await pool.query("INSERT INTO staff_users (id, employee_code, email_normalized, display_name, password_salt, password_digest, status) VALUES ($1,$2,lower($3),$4,'salt','digest','ACTIVE')", [id, `F-${id.slice(0, 8)}`, email, "Admin fault fixture"]);
    }
    for (const currentStage of ["after_ledger_write", "after_outbox_write"] as const) {
      stage = currentStage;
      const customerId = randomUUID();
      const accountId = randomUUID();
      await pool.query("INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at) VALUES ($1,$2,$3,$4,'test-salt','test-digest',NOW())", [customerId, `Admin fault ${currentStage}`, `${customerId}@example.test`, `09${customerId.replaceAll('-', '').slice(0, 9)}`]);
      await pool.query("INSERT INTO payment_accounts (id, customer_id, display_name, masked_number, account_number, currency, available_minor, current_minor, held_minor, status, version, updated_at) VALUES ($1,$2,'Fault account','•••• 0009',$3,'VND',0,0,0,'ACTIVE',0,NOW())", [accountId, customerId, `9704${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`.slice(0, 24)]);
      const action = await repository.createAction({ actionType: "SIMULATION_FUNDING", requesterStaffId: makerId, targetType: "ACCOUNT", targetId: accountId, requestFingerprint: `fault-${currentStage}-${randomUUID()}`, policyVersion: "admin-p0-v1", idempotencyKey: `fault-${currentStage}-${randomUUID()}`, expectedTargetVersion: 0, expectedTargetStatus: "ACTIVE", expiresAt: new Date(Date.now() + 60_000).toISOString(), payload: { amountMinor: "1250", currency: "VND", reasonCode: "FAULT_ROLLBACK", ticketReference: `FAULT-${currentStage}`, description: "Synthetic rollback fault" } });
      await repository.decideAction({ requestId: action.id, reviewerStaffId: checkerId, decision: "APPROVED", approvedFingerprint: action.requestFingerprint, reasonCode: "FAULT_APPROVED", mfaVerifiedAt: new Date().toISOString() });
      await assert.rejects(() => repository.executeApprovedAction({ requestId: action.id, approverStaffId: checkerId, traceId: `fault-${currentStage}` }), new RegExp(`ADMIN_TEST_FAULT:${currentStage}`));
      const account = await pool.query("SELECT available_minor, current_minor, version FROM payment_accounts WHERE id=$1", [accountId]);
      const actionRow = await repository.findAction(action.id);
      const sideEffects = await pool.query("SELECT (SELECT COUNT(*) FROM account_transactions WHERE account_id=$1)::int AS transactions, (SELECT COUNT(*) FROM ledger_journals WHERE aggregate_id=$2)::int AS journals, (SELECT COUNT(*) FROM outbox_events WHERE deduplication_key=$3)::int AS outbox", [accountId, action.id, `admin-funding:${action.id}`]);
      assert.deepEqual(account.rows[0], { available_minor: "0", current_minor: "0", version: "0" });
      assert.equal(actionRow?.status, "APPROVED");
      assert.deepEqual(sideEffects.rows[0], { transactions: 0, journals: 0, outbox: 0 });
    }
  } finally {
    await repository.close();
    await pool.end();
  }
});

test("PostgreSQL fraud notes are parameterized and sanitized before persistence", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const repository = new PostgresAdminRepository({ connectionString: databaseUrl, maxConnections: 4 });
  const customerId = randomUUID();
  const accountId = randomUUID();
  const transactionId = randomUUID();
  const reportId = randomUUID();
  const staffId = randomUUID();
  try {
    await repository.initialize();
    await pool.query("INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at) VALUES ($1,'Fraud note fixture',$2,$3,'salt','digest',NOW())", [customerId, `${customerId}@example.test`, `09${customerId.replaceAll('-', '').slice(0, 9)}`]);
    await pool.query("INSERT INTO payment_accounts (id, customer_id, display_name, masked_number, account_number, currency, available_minor, current_minor, held_minor, status, version, updated_at) VALUES ($1,$2,'Fraud note account','•••• 0033',$3,'VND',100,100,0,'ACTIVE',0,NOW())", [accountId, customerId, `9704${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`.slice(0, 24)]);
    await pool.query("INSERT INTO account_transactions (id,account_id,direction,amount_minor,fee_minor,currency,status,description,reference,occurred_at,created_at,completed_at) VALUES ($1,$2,'DEBIT',100,0,'VND','SUCCEEDED','Fraud note fixture','FRAUD-NOTE-TEST',NOW(),NOW(),NOW())", [transactionId, accountId]);
    await pool.query("INSERT INTO fraud_reports (id,customer_id,account_id,transaction_id,reason,status,created_at) VALUES ($1,$2,$3,$4,'Synthetic fraud note','RECEIVED',NOW())", [reportId, customerId, accountId, transactionId]);
    await pool.query("INSERT INTO staff_users (id, employee_code, email_normalized, display_name, password_salt, password_digest, status) VALUES ($1,$2,$3,'Fraud note staff','salt','digest','ACTIVE')", [staffId, `N-${staffId.slice(0, 8)}`, `${staffId}@example.test`]);
    await repository.addFraudNote(reportId, staffId, `<script>alert('xss')</script><img src=x onerror=alert(1)> Reviewed`);
    const stored = await pool.query("SELECT note FROM case_internal_notes WHERE case_type='FRAUD' AND case_id=$1 AND author_staff_id=$2", [reportId, staffId]);
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0].note, "scriptalert('xss')/scriptimg src=x onerror=alert(1) Reviewed");
    assert.equal(/[<>]/u.test(stored.rows[0].note), false);
    const timeline = await repository.listFraudCaseTimeline(reportId);
    assert.ok(timeline.some((event) => event.eventType === "FRAUD_NOTE_ADDED" && event.metadata.note === stored.rows[0].note));
  } finally {
    await repository.close();
    await pool.end();
  }
});

test("PostgreSQL account and customer access locks survive repository restart", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const repository = new PostgresAdminRepository({ connectionString: databaseUrl, maxConnections: 4 });
  let restarted: PostgresAdminRepository | null = null;
  const customerId = randomUUID();
  const accountId = randomUUID();
  const makerId = randomUUID();
  const checkerId = randomUUID();
  try {
    await repository.initialize();
    await pool.query("INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at) VALUES ($1,'Restart lock fixture',$2,$3,'salt','digest',NOW())", [customerId, `${customerId}@example.test`, `09${customerId.replaceAll('-', '').slice(0, 9)}`]);
    await pool.query("INSERT INTO payment_accounts (id, customer_id, display_name, masked_number, account_number, currency, available_minor, current_minor, held_minor, status, version, updated_at) VALUES ($1,$2,'Restart lock account','•••• 0044',$3,'VND',0,0,0,'ACTIVE',0,NOW())", [accountId, customerId, `9704${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`.slice(0, 24)]);
    for (const [id, prefix] of [[makerId, "S-M"], [checkerId, "S-C"]]) await pool.query("INSERT INTO staff_users (id, employee_code, email_normalized, display_name, password_salt, password_digest, status) VALUES ($1,$2,$3,'Restart lock staff','salt','digest','ACTIVE')", [id, `${prefix}-${id.slice(0, 8)}`, `${id}@example.test`]);
    const accountAction = await repository.createAction({ actionType: "ACCOUNT_BLOCK", requesterStaffId: makerId, targetType: "ACCOUNT", targetId: accountId, requestFingerprint: `restart-account-${randomUUID()}`, policyVersion: "admin-p0-v1", idempotencyKey: `restart-account-${randomUUID()}`, expectedTargetVersion: 0, expectedTargetStatus: "ACTIVE", expiresAt: new Date(Date.now() + 60_000).toISOString(), payload: { reasonCode: "RESTART_LOCK", ticketReference: "RESTART-ACCOUNT", description: "Synthetic restart lock" } });
    await repository.decideAction({ requestId: accountAction.id, reviewerStaffId: checkerId, decision: "APPROVED", approvedFingerprint: accountAction.requestFingerprint, reasonCode: "RESTART_APPROVED", mfaVerifiedAt: new Date().toISOString() });
    assert.equal((await repository.executeApprovedAction({ requestId: accountAction.id, approverStaffId: checkerId, traceId: "restart-account" })).status, "SUCCEEDED");
    const customerAction = await repository.createAction({ actionType: "CUSTOMER_ACCESS_LOCK", requesterStaffId: makerId, targetType: "CUSTOMER", targetId: customerId, requestFingerprint: `restart-customer-${randomUUID()}`, policyVersion: "admin-p0-v1", idempotencyKey: `restart-customer-${randomUUID()}`, expectedTargetVersion: 1, expectedTargetStatus: "ACTIVE", expiresAt: new Date(Date.now() + 60_000).toISOString(), payload: { reasonCode: "RESTART_LOCK", ticketReference: "RESTART-CUSTOMER", description: "Synthetic restart access lock" } });
    await repository.decideAction({ requestId: customerAction.id, reviewerStaffId: checkerId, decision: "APPROVED", approvedFingerprint: customerAction.requestFingerprint, reasonCode: "RESTART_APPROVED", mfaVerifiedAt: new Date().toISOString() });
    assert.equal((await repository.executeApprovedAction({ requestId: customerAction.id, approverStaffId: checkerId, traceId: "restart-customer" })).status, "SUCCEEDED");
    await repository.close();
    restarted = new PostgresAdminRepository({ connectionString: databaseUrl, maxConnections: 4 });
    await restarted.initialize();
    assert.equal((await restarted.findAccount(accountId))?.status, "BLOCKED");
    assert.equal((await restarted.findCustomer(customerId))?.accessStatus, "LOCKED");
  } finally {
    if (restarted) await restarted.close();
    else await repository.close();
    await pool.end();
  }
});

test("PostgreSQL Admin funding and transfer reversals are balanced and idempotent", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const repository = new PostgresAdminRepository({ connectionString: databaseUrl, maxConnections: 4 });
  const customerId = randomUUID();
  const sourceAccountId = randomUUID();
  const destinationAccountId = randomUUID();
  const beneficiaryId = randomUUID();
  const quoteId = randomUUID();
  const transferId = randomUUID();
  const makerId = randomUUID();
  const checkerId = randomUUID();
  const fundingTransactionId = randomUUID();
  const sourceTransactionId = randomUUID();
  const destinationTransactionId = randomUUID();
  const sourceAccountNumber = `9704${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`.slice(0, 24);
  const destinationAccountNumber = `9705${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`.slice(0, 24);
  const insertAccount = async (id: string, number: string, balance: string) => pool.query("INSERT INTO payment_accounts (id, customer_id, display_name, masked_number, account_number, currency, available_minor, current_minor, held_minor, status, version, updated_at) VALUES ($1,$2,$3,$4,$5,'VND',$6,$6,0,'ACTIVE',1,NOW())", [id, customerId, "Reversal fixture", "•••• 0002", number, balance]);
  try {
    await repository.initialize();
    await pool.query("INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at) VALUES ($1,$2,$3,$4,'test-salt','test-digest',NOW())", [customerId, "Admin reversal fixture", `${customerId}@example.test`, `09${customerId.replaceAll('-', '').slice(0, 9)}`]);
    await insertAccount(sourceAccountId, sourceAccountNumber, "5000");
    await insertAccount(destinationAccountId, destinationAccountNumber, "10000");
    await insertOpeningLedger(pool, sourceAccountId, "5000", `fixture-opening-source-${sourceAccountId}`);
    await insertOpeningLedger(pool, destinationAccountId, "10000", `fixture-opening-destination-${destinationAccountId}`);
    for (const [id, email] of [[makerId, `${makerId}@example.test`], [checkerId, `${checkerId}@example.test`]]) await pool.query("INSERT INTO staff_users (id, employee_code, email_normalized, display_name, password_salt, password_digest, status) VALUES ($1,$2,lower($3),$4,'salt','digest','ACTIVE')", [id, `R-${id.slice(0, 8)}`, email, "Admin reversal fixture"]);
    await pool.query("INSERT INTO account_transactions (id,account_id,direction,amount_minor,fee_minor,currency,status,description,reference,occurred_at,created_at,completed_at,kind) VALUES ($1,$2,'CREDIT',5000,0,'VND','SUCCEEDED','Reference funding','REF-FUND-TEST',NOW(),NOW(),NOW(),'REFERENCE_FIXTURE_FUNDING')", [fundingTransactionId, sourceAccountId]);
    const fundingAction = await repository.createAction({ actionType: "SIMULATION_FUNDING_REVERSAL", requesterStaffId: makerId, targetType: "ACCOUNT", targetId: sourceAccountId, requestFingerprint: `reverse-funding-${randomUUID()}`, policyVersion: "admin-p0-v1", idempotencyKey: `reverse-funding-${randomUUID()}`, expectedTargetVersion: 1, expectedTargetStatus: "ACTIVE", expiresAt: new Date(Date.now() + 60_000).toISOString(), payload: { amountMinor: "5000", currency: "VND", sourceTransactionId: fundingTransactionId, reasonCode: "REVERSAL_TEST", ticketReference: "REV-TEST-1", description: "Synthetic funding reversal" } });
    await repository.decideAction({ requestId: fundingAction.id, reviewerStaffId: checkerId, decision: "APPROVED", approvedFingerprint: fundingAction.requestFingerprint, reasonCode: "REVERSAL_APPROVED", mfaVerifiedAt: new Date().toISOString() });
    const fundingResult = await repository.executeApprovedAction({ requestId: fundingAction.id, approverStaffId: checkerId, traceId: "admin-reversal-funding" });
    assert.equal(fundingResult.status, "SUCCEEDED");
    const fundingBalance = await pool.query("SELECT available_minor, current_minor, version FROM payment_accounts WHERE id=$1", [sourceAccountId]);
    assert.deepEqual(fundingBalance.rows[0], { available_minor: "0", current_minor: "0", version: "2" });
    const fundingCount = await pool.query("SELECT COUNT(*)::int AS count FROM simulation_funding_reversals WHERE source_transaction_id=$1", [fundingTransactionId]);
    assert.equal(fundingCount.rows[0].count, 1);

    await pool.query("INSERT INTO beneficiaries (id,customer_id,display_name,masked_account_number,account_number_fingerprint,bank_name,status,created_at) VALUES ($1,$2,'Reversal recipient','•••• 0003',$3,'Reference','ACTIVE',NOW())", [beneficiaryId, customerId, `fp-${beneficiaryId}`]);
    await pool.query("INSERT INTO transfer_quotes (id,customer_id,source_account_id,beneficiary_id,amount_minor,fee_minor,currency,expires_at,created_at,request_fingerprint,destination_account_id,destination_owner_id) VALUES ($1,$2,$3,$4,1000,50,'VND',NOW()+INTERVAL '1 hour',NOW(),$5,$6,$2)", [quoteId, customerId, sourceAccountId, beneficiaryId, `quote-${quoteId}`, destinationAccountId]);
    await pool.query("INSERT INTO transfers (id,customer_id,source_account_id,quote_id,idempotency_key,request_fingerprint,reference,amount_minor,fee_minor,currency,status,created_at,updated_at,destination_account_id,destination_owner_id,source_transaction_id,destination_transaction_id,refunded,version) VALUES ($1,$2,$3,$4,$5,$6,$7,1000,50,'VND','SUCCEEDED',NOW(),NOW(),$8,$2,$9,$10,false,1)", [transferId, customerId, sourceAccountId, quoteId, `transfer-${transferId}`, `fingerprint-${transferId}`, `TRANSFER-REV-${transferId.slice(0, 8)}`, destinationAccountId, sourceTransactionId, destinationTransactionId]);
    await pool.query("INSERT INTO account_transactions (id,account_id,transfer_id,direction,amount_minor,fee_minor,currency,status,description,reference,occurred_at,created_at,completed_at,kind) VALUES ($1,$2,$3,'DEBIT',1000,50,'VND','SUCCEEDED','Transfer source','TRANSFER-REV-SRC',NOW(),NOW(),NOW(),'TRANSFER'),($4,$5,$3,'CREDIT',1000,0,'VND','SUCCEEDED','Transfer destination','TRANSFER-REV-DST',NOW(),NOW(),NOW(),'TRANSFER')", [sourceTransactionId, sourceAccountId, transferId, destinationTransactionId, destinationAccountId]);
    const transferAction = await repository.createAction({ actionType: "TRANSFER_OPERATION", requesterStaffId: makerId, targetType: "TRANSFER", targetId: transferId, requestFingerprint: `reverse-transfer-${randomUUID()}`, policyVersion: "admin-p0-v1", idempotencyKey: `reverse-transfer-${randomUUID()}`, expectedTargetVersion: 1, expectedTargetStatus: "SUCCEEDED", expiresAt: new Date(Date.now() + 60_000).toISOString(), payload: { operation: "REVERSAL", reasonCode: "REVERSAL_TEST", ticketReference: "REV-TEST-2", description: "Synthetic transfer reversal" } });
    await repository.decideAction({ requestId: transferAction.id, reviewerStaffId: checkerId, decision: "APPROVED", approvedFingerprint: transferAction.requestFingerprint, reasonCode: "REVERSAL_APPROVED", mfaVerifiedAt: new Date().toISOString() });
    const transferResult = await repository.executeApprovedAction({ requestId: transferAction.id, approverStaffId: checkerId, traceId: "admin-reversal-transfer" });
    assert.equal(transferResult.status, "SUCCEEDED");
    const transferState = await pool.query("SELECT status, refunded, version FROM transfers WHERE id=$1", [transferId]);
    assert.deepEqual(transferState.rows[0], { status: "REVERSED", refunded: true, version: "2" });
    const balances = await pool.query("SELECT id, available_minor, current_minor FROM payment_accounts WHERE id=ANY($1::uuid[]) ORDER BY id", [[sourceAccountId, destinationAccountId]]);
    const byId = new Map(balances.rows.map((row) => [String(row.id), row]));
    assert.deepEqual(byId.get(sourceAccountId), { id: sourceAccountId, available_minor: "1050", current_minor: "1050" });
    assert.deepEqual(byId.get(destinationAccountId), { id: destinationAccountId, available_minor: "9000", current_minor: "9000" });
    const reversedTransactions = await pool.query("SELECT COUNT(*)::int AS count FROM account_transactions WHERE id=ANY($1::uuid[]) AND status='REVERSED'", [[sourceTransactionId, destinationTransactionId]]);
    assert.equal(reversedTransactions.rows[0].count, 2);
  } finally {
    await repository.close();
    await pool.end();
  }
});

test("legacy public replay preserves append-only Admin audit and Outbox rows", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const relational = new PostgresRelationalRepository({ connectionString: databaseUrl, maxConnections: 4 });
  const auditId = randomUUID();
  const outboxId = randomUUID();
  try {
    await relational.initialize();
    await pool.query(
      "INSERT INTO audit_events (id,event_type,actor_type,occurred_at,payload) VALUES ($1,'ADMIN_COMPATIBILITY_SENTINEL','STAFF',NOW(),'{}'::jsonb)",
      [auditId],
    );
    await pool.query(
      "INSERT INTO outbox_events (id,event_type,aggregate_id,payload,occurred_at,published_at,attempts,next_attempt_at,event_version,aggregate_type,aggregate_version,status,priority,deduplication_key,created_at,updated_at,trace_id) VALUES ($1,'ADMIN_COMPATIBILITY_SENTINEL',$2,'{}'::jsonb,NOW(),NULL,0,NOW(),1,'admin-test',1,'PENDING',100,$3,NOW(),NOW(),'admin-compatibility-test')",
      [outboxId, randomUUID(), `admin-compatibility:${outboxId}`],
    );
    await assert.rejects(() => pool.query("UPDATE audit_events SET event_type='ADMIN_TAMPERED' WHERE id=$1", [auditId]), /audit_events is append-only/);
    await assert.rejects(() => pool.query("DELETE FROM audit_events WHERE id=$1", [auditId]), /audit_events is append-only/);
    const system = new BankingSystem();
    await relational.withState(system.exportState(), async (state) => ({ result: null, nextState: state }));
    const retained = await pool.query(
      "SELECT (SELECT COUNT(*) FROM audit_events WHERE id=$1)::int AS audit_count, (SELECT COUNT(*) FROM outbox_events WHERE id=$2)::int AS outbox_count",
      [auditId, outboxId],
    );
    assert.deepEqual(retained.rows[0], { audit_count: 1, outbox_count: 1 });
  } finally {
    await relational.close();
    await pool.end();
  }
});

test("PostgreSQL Admin outbox requeue accepts only canonical DEAD/SKIPPED events", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const repository = new PostgresAdminRepository({ connectionString: databaseUrl, maxConnections: 4 });
  const checkerId = randomUUID();
  const makerId = randomUUID();
  const eventId = randomUUID();
  const aggregateId = randomUUID();
  try {
    await repository.initialize();
    for (const [id, email] of [[makerId, `${makerId}@example.test`], [checkerId, `${checkerId}@example.test`]]) {
      await pool.query("INSERT INTO staff_users (id, employee_code, email_normalized, display_name, password_salt, password_digest, status) VALUES ($1,$2,lower($3),$4,'salt','digest','ACTIVE')", [id, `Q-${id.slice(0, 8)}`, email, "Admin requeue fixture"]);
    }
    const occurredAt = new Date().toISOString();
    const envelope = buildEnvelope({ eventId, eventType: "transfer.succeeded", aggregateType: "transfer", aggregateId, aggregateVersion: 2, occurredAt, traceId: "admin-requeue-test" });
    await pool.query(
      "INSERT INTO outbox_events (id,event_type,aggregate_id,payload,occurred_at,published_at,attempts,next_attempt_at,event_version,aggregate_type,aggregate_version,status,priority,deduplication_key,created_at,updated_at,trace_id) VALUES ($1,$2,$3,$4,$5,NULL,3,NOW(),1,'transfer',2,'DEAD',10,$6,NOW(),NOW(),$7)",
      [eventId, envelope.eventType, aggregateId, JSON.stringify(envelope), occurredAt, `requeue:${eventId}`, "admin-requeue-test"],
    );
    const action = await repository.createAction({ actionType: "OUTBOX_REQUEUE", requesterStaffId: makerId, targetType: "OUTBOX_EVENT", targetId: eventId, requestFingerprint: `requeue-${eventId}`, policyVersion: "admin-p0-v1", idempotencyKey: `requeue-action-${eventId}`, expectedTargetVersion: 3, expectedTargetStatus: "DEAD", expiresAt: new Date(Date.now() + 60_000).toISOString(), payload: { eventId, reasonCode: "INCIDENT_RETRY", ticketReference: "INC-REQUEUE-1" } });
    await repository.decideAction({ requestId: action.id, reviewerStaffId: checkerId, decision: "APPROVED", approvedFingerprint: action.requestFingerprint, reasonCode: "REQUEUE_APPROVED", mfaVerifiedAt: new Date().toISOString() });
    const result = await repository.executeApprovedAction({ requestId: action.id, approverStaffId: checkerId, traceId: "admin-requeue-execute" });
    assert.equal(result.status, "SUCCEEDED");
    const requeued = await pool.query("SELECT status, attempts, dead_lettered_at, skipped_at FROM outbox_events WHERE id=$1", [eventId]);
    assert.deepEqual(requeued.rows[0], { status: "PENDING", attempts: 3, dead_lettered_at: null, skipped_at: null });

    const legacyId = randomUUID();
    const legacyAggregate = randomUUID();
    await pool.query(
      "INSERT INTO outbox_events (id,event_type,aggregate_id,payload,occurred_at,published_at,attempts,next_attempt_at,event_version,aggregate_type,aggregate_version,status,priority,deduplication_key,created_at,updated_at,trace_id) VALUES ($1,'LEGACY_UNRESOLVED',$2,'{}'::jsonb,NOW(),NULL,4,NOW(),1,'legacy',1,'DEAD',100,$3,NOW(),NOW(),'legacy-requeue-test')",
      [legacyId, legacyAggregate, `legacy-requeue:${legacyId}`],
    );
    const legacyAction = await repository.createAction({ actionType: "OUTBOX_REQUEUE", requesterStaffId: makerId, targetType: "OUTBOX_EVENT", targetId: legacyId, requestFingerprint: `legacy-requeue-${legacyId}`, policyVersion: "admin-p0-v1", idempotencyKey: `legacy-action-${legacyId}`, expectedTargetVersion: 4, expectedTargetStatus: "DEAD", expiresAt: new Date(Date.now() + 60_000).toISOString(), payload: { eventId: legacyId, reasonCode: "INCIDENT_RETRY", ticketReference: "INC-REQUEUE-2" } });
    await repository.decideAction({ requestId: legacyAction.id, reviewerStaffId: checkerId, decision: "APPROVED", approvedFingerprint: legacyAction.requestFingerprint, reasonCode: "REQUEUE_APPROVED", mfaVerifiedAt: new Date().toISOString() });
    const legacyResult = await repository.executeApprovedAction({ requestId: legacyAction.id, approverStaffId: checkerId, traceId: "admin-legacy-requeue" });
    assert.deepEqual(legacyResult, { status: "FAILED", failureCode: "OUTBOX_NOT_REQUEUEABLE" });
  } finally {
    await repository.close();
    await pool.end();
  }
});

test("Admin outbox requeue hands a canonical event to the worker exactly once", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  const workerDatabase = new DatabasePool({ connectionString: databaseUrl, max: 6 });
  const repository = new PostgresAdminRepository({ connectionString: databaseUrl, maxConnections: 4 });
  const makerId = randomUUID();
  const checkerId = randomUUID();
  const eventId = randomUUID();
  const aggregateId = randomUUID();
  let worker: WorkerRuntime | null = null;
  try {
    await repository.initialize();
    for (const [id, email] of [[makerId, `${makerId}@example.test`], [checkerId, `${checkerId}@example.test`]]) {
      await pool.query("INSERT INTO staff_users (id, employee_code, email_normalized, display_name, password_salt, password_digest, status) VALUES ($1,$2,lower($3),$4,'salt','digest','ACTIVE')", [id, `W-${id.slice(0, 8)}`, email, "Admin worker race fixture"]);
    }
    const occurredAt = new Date().toISOString();
    const envelope = buildEnvelope({ eventId, eventType: "admin.simulation_funding_succeeded", aggregateType: "payment-account", aggregateId, aggregateVersion: 2, occurredAt, traceId: "admin-worker-race" });
    await pool.query(
      "INSERT INTO outbox_events (id,event_type,aggregate_id,payload,occurred_at,published_at,attempts,next_attempt_at,event_version,aggregate_type,aggregate_version,status,priority,deduplication_key,created_at,updated_at,trace_id,dead_lettered_at) VALUES ($1,$2,$3,$4,$5,NULL,2,NOW(),1,$6,2,'DEAD',90,$7,NOW(),NOW(),'admin-worker-race',NOW())",
      [eventId, envelope.eventType, aggregateId, JSON.stringify(envelope), occurredAt, envelope.aggregate.type, `admin-worker-race:${eventId}`],
    );
    const action = await repository.createAction({ actionType: "OUTBOX_REQUEUE", requesterStaffId: makerId, targetType: "OUTBOX_EVENT", targetId: eventId, requestFingerprint: `worker-race-${eventId}`, policyVersion: "admin-p0-v1", idempotencyKey: `worker-race-action-${eventId}`, expectedTargetVersion: 2, expectedTargetStatus: "DEAD", expiresAt: new Date(Date.now() + 60_000).toISOString(), payload: { eventId, reasonCode: "WORKER_RACE", ticketReference: "WORKER-RACE-1" } });
    await repository.decideAction({ requestId: action.id, reviewerStaffId: checkerId, decision: "APPROVED", approvedFingerprint: action.requestFingerprint, reasonCode: "WORKER_RACE_APPROVED", mfaVerifiedAt: new Date().toISOString() });
    worker = new WorkerRuntime({ workerId: `admin-worker-race-${eventId.slice(0, 8)}`, workerVersion: "admin-worker-race-test", pollIntervalMs: 5, batchSize: 10, concurrency: 2, leaseSeconds: 60, maxAttempts: 3, heartbeatIntervalMs: 10_000, shutdownTimeoutMs: 1_000, databaseUrl: databaseUrl!, persistenceMode: "relational-v2", allowLegacyWriter: false }, workerDatabase, { push: new FakePushProvider(), email: new FakeEmailProvider(), endpointCrypto: new EndpointCrypto("admin-worker-race-key") });
    await worker.initialize();
    await Promise.all([
      repository.executeApprovedAction({ requestId: action.id, approverStaffId: checkerId, traceId: "admin-worker-race" }),
      worker.runOnce(),
    ]);
    await worker.runOnce();
    const state = await pool.query("SELECT status, attempts, locked_by, dead_lettered_at FROM outbox_events WHERE id=$1", [eventId]);
    const duplicate = await pool.query("SELECT COUNT(*)::int AS count FROM outbox_events WHERE deduplication_key=$1", [`admin-worker-race:${eventId}`]);
    const storedAction = await repository.findAction(action.id);
    assert.deepEqual(state.rows[0], { status: "DISPATCHED", attempts: 3, locked_by: null, dead_lettered_at: null });
    assert.equal(duplicate.rows[0].count, 1);
    assert.equal(storedAction?.status, "SUCCEEDED");
  } finally {
    if (worker) {
      await worker.stop().catch(() => undefined);
      worker = null;
    } else {
      await workerDatabase.close();
    }
    await repository.close();
    await pool.end();
  }
});

const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.resolve(__dirname, "../database/001_banking_mvp.sql");
const schema = fs.readFileSync(schemaPath, "utf8");

const requiredTables = [
  "customers",
  "customer_devices",
  "auth_sessions",
  "payment_accounts",
  "beneficiaries",
  "transfer_quotes",
  "transfers",
  "account_transactions",
  "ledger_journals",
  "ledger_entries",
  "audit_events",
  "outbox_events",
  "reference_state_snapshots",
  "notifications",
  "fraud_reports",
  "control_policy",
];

for (const tableName of requiredTables) {
  const tablePattern = new RegExp(`CREATE TABLE ${tableName} \\(`, "i");
  if (!tablePattern.test(schema)) {
    throw new Error(`Missing required table: ${tableName}`);
  }
}

const requiredFragments = [
  "UNIQUE (customer_id, idempotency_key)",
  "UNIQUE (quote_id)",
  "account_number_fingerprint text NOT NULL",
  "beneficiaries_identity_idx",
  "consumed_at timestamptz",
  "amount_minor bigint",
  "DEFERRABLE INITIALLY DEFERRED",
  "CREATE CONSTRAINT TRIGGER ledger_journal_balanced",
  "CREATE TABLE outbox_events",
  "published_at timestamptz",
  "next_attempt_at timestamptz",
];

for (const fragment of requiredFragments) {
  if (!schema.includes(fragment)) {
    throw new Error(`Missing database invariant fragment: ${fragment}`);
  }
}

const uuidPrimaryKeyTables = [
  "customers",
  "customer_devices",
  "auth_sessions",
  "payment_accounts",
  "beneficiaries",
  "transfer_quotes",
  "transfers",
  "account_transactions",
  "ledger_journals",
  "audit_events",
  "outbox_events",
  "notifications",
  "fraud_reports",
];
for (const tableName of uuidPrimaryKeyTables) {
  const tableBlock = schema.match(
    new RegExp(`CREATE TABLE ${tableName} \\(([\\s\\S]*?)\\n\\);`, "i"),
  )?.[1];
  if (!tableBlock || !/\bid uuid PRIMARY KEY\b/i.test(tableBlock)) {
    throw new Error(`${tableName}.id must be a uuid PRIMARY KEY.`);
  }
}

if (/\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i.test(schema)) {
  throw new Error("The draft migration must not contain destructive DROP statements.");
}

console.log(`Database schema contract valid: ${requiredTables.length} tables and ledger/idempotency invariants present.`);

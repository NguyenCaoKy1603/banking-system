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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tableBlock(tableName) {
  const tablePattern = new RegExp(
    `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${escapeRegExp(tableName)}\\s*\\(([\\s\\S]*?)\\n\\);`,
    "i",
  );
  const match = schema.match(tablePattern);
  if (!match) {
    throw new Error(`Missing CREATE TABLE definition: ${tableName}`);
  }
  return match[1];
}

const tableBlocks = new Map(
  requiredTables.map((tableName) => [tableName, tableBlock(tableName)]),
);

function requireColumn(tableName, columnName, definitionPattern) {
  const block = tableBlocks.get(tableName);
  const columnPattern = new RegExp(
    `^\\s*${escapeRegExp(columnName)}\\s+([^,\\n]+)`,
    "mi",
  );
  const match = block.match(columnPattern);
  if (!match || !definitionPattern.test(match[1])) {
    throw new Error(
      `Column ${tableName}.${columnName} does not match the required definition.`,
    );
  }
}

for (const tableName of [
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
]) {
  requireColumn(tableName, "id", /\buuid\s+PRIMARY\s+KEY\b/i);
}

for (const [tableName, columnName, pattern] of [
  ["transfer_quotes", "consumed_at", /\btimestamptz\b/i],
  ["payment_accounts", "available_minor", /\bbigint\b/i],
  ["beneficiaries", "account_number_fingerprint", /\btext\b.*\bNOT\s+NULL\b/i],
  ["transfers", "quote_id", /\buuid\b.*\bREFERENCES\s+transfer_quotes\b/i],
  ["transfers", "idempotency_key", /\btext\b.*\bNOT\s+NULL\b/i],
  ["transfers", "status", /\btext\b.*\bNOT\s+NULL\b/i],
  ["account_transactions", "amount_minor", /\bbigint\b.*\bNOT\s+NULL\b/i],
  ["ledger_entries", "amount_minor", /\bbigint\b.*\bNOT\s+NULL\b/i],
  ["outbox_events", "published_at", /\btimestamptz\b/i],
  ["outbox_events", "next_attempt_at", /\btimestamptz\b/i],
  ["notifications", "resource_account_id", /\buuid\b.*\bREFERENCES\s+payment_accounts\b/i],
]) {
  requireColumn(tableName, columnName, pattern);
}

for (const [label, pattern] of [
  ["transfer idempotency uniqueness", /UNIQUE\s*\(\s*customer_id\s*,\s*idempotency_key\s*\)/i],
  ["quote one-time uniqueness", /UNIQUE\s*\(\s*quote_id\s*\)/i],
  ["beneficiary identity index", /CREATE\s+UNIQUE\s+INDEX\s+beneficiaries_identity_idx/i],
  ["ledger deferred balance trigger", /CREATE\s+CONSTRAINT\s+TRIGGER\s+ledger_journal_balanced[\s\S]*?DEFERRABLE\s+INITIALLY\s+DEFERRED/i],
  ["outbox table", /CREATE\s+TABLE\s+outbox_events/i],
]) {
  if (!pattern.test(schema)) {
    throw new Error(`Missing database invariant: ${label}`);
  }
}

if (/\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i.test(schema)) {
  throw new Error("The draft migration must not contain destructive DROP statements.");
}

async function validateLiveDatabase() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.log(
      `Database source contract valid: ${requiredTables.length} table definitions and column/constraint invariants present (live DB check skipped; DATABASE_URL is not set).`,
    );
    return;
  }

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const tableResult = await pool.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
      `,
    );
    const liveTables = new Set(tableResult.rows.map((row) => row.table_name));
    for (const tableName of requiredTables) {
      if (!liveTables.has(tableName)) {
        throw new Error(`Live PostgreSQL database is missing table: ${tableName}`);
      }
    }

    const columnResult = await pool.query(
      `
        SELECT table_name, column_name, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
      `,
    );
    const liveColumns = new Map(
      columnResult.rows.map((row) => [
        `${row.table_name}.${row.column_name}`,
        row.udt_name,
      ]),
    );
    for (const tableName of [
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
    ]) {
      if (liveColumns.get(`${tableName}.id`) !== "uuid") {
        throw new Error(`Live ${tableName}.id must use PostgreSQL uuid.`);
      }
    }
    for (const [tableName, columnName, expectedType] of [
      ["transfers", "quote_id", "uuid"],
      ["transfers", "idempotency_key", "text"],
      ["transfer_quotes", "consumed_at", "timestamptz"],
      ["notifications", "resource_account_id", "uuid"],
    ]) {
      if (liveColumns.get(`${tableName}.${columnName}`) !== expectedType) {
        throw new Error(
          `Live ${tableName}.${columnName} must use PostgreSQL ${expectedType}.`,
        );
      }
    }

    const constraintResult = await pool.query(
      `
        SELECT cls.relname AS table_name,
               pg_get_constraintdef(con.oid) AS definition
        FROM pg_constraint con
        JOIN pg_class cls ON cls.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = cls.relnamespace
        WHERE ns.nspname = 'public'
      `,
    );
    const definitions = constraintResult.rows.map((row) =>
      `${row.table_name} ${row.definition}`,
    );
    for (const pattern of [
      /transfers UNIQUE \(customer_id, idempotency_key\)/i,
      /transfers UNIQUE \(quote_id\)/i,
      /notifications FOREIGN KEY \(resource_account_id\) REFERENCES payment_accounts/i,
    ]) {
      if (!definitions.some((definition) => pattern.test(definition))) {
        throw new Error(`Live PostgreSQL constraint missing: ${pattern}`);
      }
    }

    console.log(
      `Database contract valid: ${requiredTables.length} tables, live columns and key constraints verified against PostgreSQL.`,
    );
  } finally {
    await pool.end();
  }
}

validateLiveDatabase().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

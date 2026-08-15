const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.resolve(__dirname, "../database/001_banking_mvp.sql");
const schema = fs.readFileSync(schemaPath, "utf8");
const savingsSchemaPath = path.resolve(__dirname, "../database/002_savings_sandbox.sql");
const savingsSchema = fs.readFileSync(savingsSchemaPath, "utf8");
const creditSchemaPath = path.resolve(__dirname, "../database/003_credit_sandbox.sql");
const creditSchema = fs.readFileSync(creditSchemaPath, "utf8");

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
const savingsTables = [
  "savings_products",
  "savings_quotes",
  "savings_deposits",
  "savings_openings",
];
const creditTables = [
  "credit_accounts",
  "credit_cards",
  "credit_transactions",
  "credit_statements",
  "credit_statement_items",
  "credit_payment_quotes",
  "credit_payments",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tableBlock(source, tableName) {
  const tablePattern = new RegExp(
    `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${escapeRegExp(tableName)}\\s*\\(([\\s\\S]*?)\\n\\);`,
    "i",
  );
  const match = source.match(tablePattern);
  if (!match) {
    throw new Error(`Missing CREATE TABLE definition: ${tableName}`);
  }
  return match[1];
}

const tableBlocks = new Map(
  requiredTables.map((tableName) => [tableName, tableBlock(schema, tableName)]),
);
const savingsTableBlocks = new Map(
  savingsTables.map((tableName) => [tableName, tableBlock(savingsSchema, tableName)]),
);
const creditTableBlocks = new Map(
  creditTables.map((tableName) => [tableName, tableBlock(creditSchema, tableName)]),
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

for (const tableName of creditTables) {
  const block = creditTableBlocks.get(tableName);
  if (!/\bid\s+uuid\s+PRIMARY\s+KEY\b/i.test(block) && tableName !== "credit_statement_items") {
    throw new Error(`Credit table ${tableName}.id must use PostgreSQL uuid.`);
  }
}

for (const [tableName, columnName, pattern] of [
  ["credit_accounts", "customer_id", /\buuid\b.*\bREFERENCES\s+customers\b/i],
  ["credit_accounts", "credit_limit_minor", /\bbigint\b.*\bCHECK\s*\(credit_limit_minor\s*>\s*0\)/i],
  ["credit_cards", "credit_account_id", /\buuid\b.*\bREFERENCES\s+credit_accounts\b/i],
  ["credit_transactions", "amount_minor", /\bbigint\b.*\bCHECK\s*\(amount_minor\s*>\s*0\)/i],
  ["credit_statements", "version", /\bbigint\b.*\bCHECK\s*\(version\s*>\s*0\)/i],
  ["credit_payment_quotes", "request_fingerprint", /\btext\b.*\bNOT\s+NULL\b/i],
  ["credit_payments", "idempotency_key", /\btext\b.*\bNOT\s+NULL\b/i],
]) {
  const block = creditTableBlocks.get(tableName);
  const columnPattern = new RegExp(`^\\s*${escapeRegExp(columnName)}\\s+([^,\\n]+)`, "mi");
  const match = block.match(columnPattern);
  if (!match || !pattern.test(match[1])) {
    throw new Error(`Column ${tableName}.${columnName} does not match the required credit definition.`);
  }
}

for (const [label, pattern] of [
  ["credit statement cycle uniqueness", /UNIQUE\s*\(\s*credit_account_id\s*,\s*cycle_start_at\s*,\s*cycle_end_at\s*\)/i],
  ["credit payment quote uniqueness", /quote_id\s+uuid\s+NOT\s+NULL\s+UNIQUE\s+REFERENCES\s+credit_payment_quotes/i],
  ["credit payment idempotency", /UNIQUE\s*\(\s*customer_id\s*,\s*idempotency_key\s*\)/i],
  ["credit notification type", /notification_type\s+IN\s*\(\s*'TRANSFER'\s*,\s*'SAVINGS'\s*,\s*'CREDIT'\s*,\s*'SECURITY'/i],
  ["credit control policy", /ADD\s+COLUMN\s+credit_enabled\s+boolean/i],
  ["card unlock step-up policy", /ADD\s+COLUMN\s+card_unlock_step_up_methods\s+text\[\]/i],
]) {
  if (!pattern.test(creditSchema)) {
    throw new Error(`Missing credit database invariant: ${label}`);
  }
}

if (/\bpan\b|\bcvv\b|\bpin\b/i.test(creditSchema)) {
  throw new Error("Credit migration must not define PAN, CVV or PIN columns.");
}

for (const tableName of savingsTables) {
  const block = savingsTableBlocks.get(tableName);
  if (!/\bid\s+uuid\s+PRIMARY\s+KEY\b/i.test(block)) {
    throw new Error(`Savings table ${tableName}.id must use PostgreSQL uuid.`);
  }
}

for (const [tableName, columnName, pattern] of [
  ["savings_quotes", "customer_id", /\buuid\b.*\bREFERENCES\s+customers\b/i],
  ["savings_quotes", "principal_minor", /\bbigint\b.*\bCHECK\s*\(principal_minor\s*>\s*0\)/i],
  ["savings_quotes", "request_fingerprint", /\btext\b.*\bNOT\s+NULL\b/i],
  ["savings_openings", "quote_id", /\buuid\b.*\bUNIQUE\b.*\bREFERENCES\s+savings_quotes\b/i],
  ["savings_openings", "idempotency_key", /\btext\b.*\bNOT\s+NULL\b/i],
  ["savings_deposits", "maturity_instruction", /\btext\b.*\bCHECK\b/i],
  ["savings_deposits", "status", /\btext\b.*\bCHECK\b/i],
]) {
  const block = savingsTableBlocks.get(tableName);
  const columnPattern = new RegExp(
    `^\\s*${escapeRegExp(columnName)}\\s+([^,\\n]+)`,
    "mi",
  );
  const match = block.match(columnPattern);
  if (!match || !pattern.test(match[1])) {
    throw new Error(`Column ${tableName}.${columnName} does not match the required savings definition.`);
  }
}

for (const [label, pattern] of [
  ["savings quote one-time uniqueness", /savings_openings_quote_once_idx/i],
  ["savings idempotency uniqueness", /UNIQUE\s*\(\s*customer_id\s*,\s*idempotency_key\s*\)/i],
  ["savings transaction relation", /ADD\s+COLUMN\s+savings_opening_id\s+uuid\s+REFERENCES\s+savings_openings/i],
  ["savings notification type", /notification_type\s+IN\s*\(\s*'TRANSFER'\s*,\s*'SAVINGS'\s*,\s*'SECURITY'/i],
  ["savings control policy", /ADD\s+COLUMN\s+savings_enabled\s+boolean/i],
]) {
  if (!pattern.test(savingsSchema)) {
    throw new Error(`Missing savings database invariant: ${label}`);
  }
}

if (/\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i.test(`${schema}\n${savingsSchema}`)) {
  throw new Error("The draft migration must not contain destructive DROP statements.");
}

async function validateLiveDatabase() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.log(
        `Database source contract valid: ${requiredTables.length + savingsTables.length + creditTables.length} table definitions and column/constraint invariants present (live DB check skipped; DATABASE_URL is not set).`,
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
    for (const tableName of [...requiredTables, ...savingsTables, ...creditTables]) {
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
      ["savings_quotes", "customer_id", "uuid"],
      ["savings_quotes", "principal_minor", "int8"],
      ["savings_openings", "quote_id", "uuid"],
      ["savings_openings", "idempotency_key", "text"],
      ["savings_deposits", "source_account_id", "uuid"],
      ["savings_deposits", "maturity_at", "timestamptz"],
      ["credit_accounts", "customer_id", "uuid"],
      ["credit_accounts", "credit_limit_minor", "int8"],
      ["credit_cards", "credit_account_id", "uuid"],
      ["credit_statements", "version", "int8"],
      ["credit_payment_quotes", "statement_id", "uuid"],
      ["credit_payments", "idempotency_key", "text"],
      ["control_policy", "card_unlock_step_up_methods", "_text"],
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
      /savings_openings UNIQUE \(customer_id, idempotency_key\)/i,
      /savings_openings FOREIGN KEY \(quote_id\) REFERENCES savings_quotes/i,
      /savings_deposits FOREIGN KEY \(source_account_id\) REFERENCES payment_accounts/i,
      /credit_cards FOREIGN KEY \(credit_account_id\) REFERENCES credit_accounts/i,
      /credit_payment_quotes FOREIGN KEY \(statement_id\) REFERENCES credit_statements/i,
      /credit_payments UNIQUE \(customer_id, idempotency_key\)/i,
    ]) {
      if (!definitions.some((definition) => pattern.test(definition))) {
        throw new Error(`Live PostgreSQL constraint missing: ${pattern}`);
      }
    }

    console.log(
      `Database contract valid: ${requiredTables.length + savingsTables.length + creditTables.length} tables, live columns and key constraints verified against PostgreSQL.`,
    );
  } finally {
    await pool.end();
  }
}

validateLiveDatabase().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

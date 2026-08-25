const { Pool } = require("pg");
const { resolvePostgresSsl } = require("./postgres-ssl.cjs");

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for P0 inventory.");

const pool = new Pool({ connectionString: databaseUrl, max: 1, ssl: resolvePostgresSsl() });
const tables = [
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
  "reference_runtime_records",
  "command_idempotency",
  "refresh_session_families",
  "refresh_session_records",
  "auth_challenges",
  "pending_registrations",
  "rate_limit_buckets",
  "savings_products",
  "savings_quotes",
  "savings_openings",
  "savings_deposits",
  "savings_idempotency",
  "savings_maturity_operations",
  "credit_accounts",
  "credit_cards",
  "credit_transactions",
  "credit_statements",
  "credit_statement_items",
  "credit_payment_quotes",
  "credit_payments",
  "credit_idempotency",
  "registration_completions",
];

async function main() {
  try {
    const counts = {};
    for (const table of tables) {
      const result = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
      counts[table] = result.rows[0].count;
    }
    const collections = await pool.query(
      `SELECT collection, COUNT(*)::int AS count
       FROM reference_runtime_records
       GROUP BY collection ORDER BY collection`,
    );
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      database: new URL(databaseUrl).pathname.slice(1),
      counts,
      runtimeCollections: collections.rows,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

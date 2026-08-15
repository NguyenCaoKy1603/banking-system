import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to apply the draft PostgreSQL migrations.");
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const databaseDirectory = path.resolve(scriptDirectory, "../database");
const migrationFiles = (await readdir(databaseDirectory))
  .filter((fileName) => /^\d+_.+\.sql$/i.test(fileName))
  .sort((left, right) => left.localeCompare(right, "en"));

const requiredTablesByMigration: Record<string, string[]> = {
  "001_banking_mvp": [
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
  ],
  "002_savings_sandbox": [
    "savings_products",
    "savings_quotes",
    "savings_openings",
    "savings_deposits",
  ],
  "003_credit_sandbox": [
    "credit_accounts",
    "credit_cards",
    "credit_transactions",
    "credit_statements",
    "credit_statement_items",
    "credit_payment_quotes",
    "credit_payments",
  ],
};

const pool = new Pool({ connectionString: databaseUrl });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reference_schema_migrations (
      migration_key text PRIMARY KEY,
      applied_at timestamptz NOT NULL
    )
  `);

  for (const migrationFile of migrationFiles) {
    const migrationKey = migrationFile.replace(/\.sql$/i, "");
    const migration = await readFile(path.join(databaseDirectory, migrationFile), "utf8");
    const requiredTables = requiredTablesByMigration[migrationKey] ?? [];

    await pool.query("BEGIN");
    try {
      await pool.query("SELECT pg_advisory_xact_lock(hashtext($1))", [migrationKey]);
      const applied = await pool.query(
        "SELECT 1 FROM reference_schema_migrations WHERE migration_key = $1",
        [migrationKey],
      );
      if (applied.rowCount) {
        await pool.query("COMMIT");
        console.log(`PostgreSQL draft migration already applied: ${migrationKey}.`);
        continue;
      }

      const existingTables = await pool.query(
        `
          SELECT COUNT(*)::int AS count
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE'
            AND table_name = ANY($1::text[])
        `,
        [requiredTables],
      );
      if (requiredTables.length > 0 && existingTables.rows[0]?.count !== requiredTables.length) {
        await pool.query(migration);
      }
      await pool.query(
        "INSERT INTO reference_schema_migrations (migration_key, applied_at) VALUES ($1, NOW())",
        [migrationKey],
      );
      await pool.query("COMMIT");
      console.log(
        requiredTables.length > 0 && existingTables.rows[0]?.count === requiredTables.length
          ? `PostgreSQL draft migration recorded as already applied: ${migrationKey}.`
          : `PostgreSQL draft migration applied successfully: ${migrationKey}.`,
      );
    } catch (error) {
      await pool.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }
} finally {
  await pool.end();
}

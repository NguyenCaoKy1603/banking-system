import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to apply the draft PostgreSQL migration.");
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(scriptDirectory, "../database/001_banking_mvp.sql");
const migration = await readFile(migrationPath, "utf8");
const pool = new Pool({ connectionString: databaseUrl });
const migrationKey = "001_banking_mvp";
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

try {
  await pool.query("BEGIN");
  await pool.query("SELECT pg_advisory_xact_lock(hashtext($1))", [migrationKey]);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reference_schema_migrations (
      migration_key text PRIMARY KEY,
      applied_at timestamptz NOT NULL
    )
  `);
  const applied = await pool.query(
    "SELECT 1 FROM reference_schema_migrations WHERE migration_key = $1",
    [migrationKey],
  );
  if (applied.rowCount) {
    await pool.query("COMMIT");
    console.log(`PostgreSQL draft migration already applied: ${migrationKey}.`);
  } else {
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
    if (existingTables.rows[0]?.count === requiredTables.length) {
      await pool.query(
        "INSERT INTO reference_schema_migrations (migration_key, applied_at) VALUES ($1, NOW())",
        [migrationKey],
      );
      await pool.query("COMMIT");
      console.log(`PostgreSQL draft migration recorded as already applied: ${migrationKey}.`);
    } else {
      await pool.query(migration);
      await pool.query(
        "INSERT INTO reference_schema_migrations (migration_key, applied_at) VALUES ($1, NOW())",
        [migrationKey],
      );
      await pool.query("COMMIT");
      console.log(`PostgreSQL draft migration applied successfully: ${migrationKey}.`);
    }
  }
} catch (error: unknown) {
  await pool.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await pool.end();
}

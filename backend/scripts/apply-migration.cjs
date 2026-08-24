const { readdir, readFile } = require("node:fs/promises");
const { createHash } = require("node:crypto");
const path = require("node:path");
const { Pool } = require("pg");

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to apply the draft PostgreSQL migrations.");
}

const databaseDirectory = path.resolve(__dirname, "../database");
const requiredTablesByMigration = {
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
  "005_relational_reference_runtime": ["reference_runtime_records"],
  "006_relational_v2_foundation": ["command_idempotency"],
  "007_identity_runtime_normalization": [
    "refresh_session_families",
    "refresh_session_records",
    "auth_challenges",
    "pending_registrations",
    "rate_limit_buckets",
  ],
  "009_savings_relational_v2": ["savings_idempotency", "savings_maturity_operations"],
  "010_credit_relational_v2": ["credit_idempotency"],
  "011_registration_recovery": ["registration_completions"],
  "012_outbox_worker": [
    "notification_endpoints",
    "notification_preferences",
    "notification_deliveries",
    "dead_letter_events",
    "worker_instances",
  ],
  "013_outbox_worker_operations": [],
};

async function main() {
  const migrationFiles = (await readdir(databaseDirectory))
    .filter((fileName) => /^\d+_.+\.sql$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reference_schema_migrations (
        migration_key text PRIMARY KEY,
        applied_at timestamptz NOT NULL,
        checksum text
      )
    `);
    await pool.query(
      "ALTER TABLE reference_schema_migrations ADD COLUMN IF NOT EXISTS checksum text",
    );

    for (const migrationFile of migrationFiles) {
      const migrationKey = migrationFile.replace(/\.sql$/i, "");
      const migration = await readFile(path.join(databaseDirectory, migrationFile), "utf8");
      const checksum = createHash("sha256").update(migration).digest("hex");
      const requiredTables = requiredTablesByMigration[migrationKey] ?? [];

      await pool.query("BEGIN");
      try {
        await pool.query("SELECT pg_advisory_xact_lock(hashtext($1))", [migrationKey]);
        const applied = await pool.query(
          "SELECT checksum FROM reference_schema_migrations WHERE migration_key = $1",
          [migrationKey],
        );
        if (applied.rowCount) {
          const recordedChecksum = applied.rows[0]?.checksum;
          if (recordedChecksum && recordedChecksum !== checksum) {
            throw new Error(
              `Migration checksum mismatch for ${migrationKey}; refusing to run a modified applied migration.`,
            );
          }
          if (!recordedChecksum) {
            await pool.query(
              "UPDATE reference_schema_migrations SET checksum = $2 WHERE migration_key = $1",
              [migrationKey, checksum],
            );
          }
          await pool.query("COMMIT");
          console.log(`PostgreSQL migration already applied: ${migrationKey} (${checksum.slice(0, 12)}).`);
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
        const existingTableCount = Number(existingTables.rows[0]?.count ?? 0);
        if (requiredTables.length > 0 && existingTableCount > 0) {
          throw new Error(
            `Migration ${migrationKey} is not recorded but ${existingTableCount}/${requiredTables.length} expected tables already exist. Refusing to guess migration state; restore a clean database or record the reviewed migration explicitly.`,
          );
        }

        await pool.query(migration);
        await pool.query(
          "INSERT INTO reference_schema_migrations (migration_key, applied_at, checksum) VALUES ($1, NOW(), $2)",
          [migrationKey, checksum],
        );
        await pool.query("COMMIT");
        console.log(`PostgreSQL migration applied successfully: ${migrationKey} (${checksum.slice(0, 12)}).`);
      } catch (error) {
        await pool.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

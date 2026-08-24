const { Pool } = require("pg");

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for outbox worker validation.");

const pool = new Pool({ connectionString: databaseUrl, max: 1 });

async function main() {
  try {
    const migrations = await pool.query(
      `SELECT migration_key, checksum
       FROM reference_schema_migrations
       WHERE migration_key IN ('012_outbox_worker', '013_outbox_worker_operations')
       ORDER BY migration_key`,
    );
    if (migrations.rowCount !== 2 || migrations.rows.some((row) => !row.checksum)) {
      throw new Error("Outbox worker migrations 012 and 013 are not both applied with checksums.");
    }

    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [["notification_endpoints", "notification_preferences", "notification_deliveries", "dead_letter_events", "worker_instances"]],
    );
    if (tables.rowCount !== 5) throw new Error("Outbox worker tables are incomplete.");

    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'outbox_events'
         AND column_name = ANY($1::text[])`,
      [["event_version", "aggregate_type", "aggregate_version", "deduplication_key", "status", "priority", "locked_by", "lease_expires_at", "dead_lettered_at", "trace_id", "created_at", "updated_at"]],
    );
    if (columns.rowCount !== 12) throw new Error("Outbox worker columns are incomplete.");

    const invariants = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM outbox_events WHERE event_version <= 0 OR aggregate_version <= 0 OR attempts < 0) AS invalid_outbox,
        (SELECT COUNT(*) FROM notification_deliveries WHERE attempts < 0) AS invalid_deliveries,
        (SELECT COUNT(*) FROM outbox_events WHERE deduplication_key IS NULL) AS null_deduplication_keys,
        (SELECT COUNT(*) FROM notification_deliveries d LEFT JOIN outbox_events e ON e.id = d.outbox_event_id WHERE e.id IS NULL) AS orphan_deliveries,
        (SELECT COUNT(*) FROM dead_letter_events WHERE final_error_summary ~* '(password|token|secret|otp|cvv|pin)') AS secret_like_errors
    `);
    const row = invariants.rows[0];
    for (const [key, value] of Object.entries(row)) {
      if (Number(value) !== 0) throw new Error(`Outbox worker invariant failed: ${key}=${value}`);
    }

    const legacy = await pool.query(
      `SELECT COUNT(*)::int AS count FROM outbox_events
       WHERE status IN ('PENDING', 'PROCESSING')
         AND (aggregate_type = 'legacy' OR payload = '{}'::jsonb)`,
    );
    console.log(JSON.stringify({
      status: "passed",
      migrations: migrations.rows,
      invariantChecks: row,
      legacyPendingRequiresOperatorReview: legacy.rows[0].count,
      note: "Legacy pending events remain blocked from automatic dispatch until explicitly reconciled.",
    }));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

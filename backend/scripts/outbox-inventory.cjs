const { Pool } = require("pg");
const { resolvePostgresSsl } = require("./postgres-ssl.cjs");

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const pool = new Pool({ connectionString: databaseUrl, max: 1, ssl: resolvePostgresSsl() });

async function main() {
  try {
    const counts = await pool.query(`
      SELECT status, COUNT(*)::int AS count
      FROM outbox_events
      GROUP BY status
      ORDER BY status
    `);
    const legacy = await pool.query(`
      SELECT id, event_type, event_version, aggregate_type, aggregate_id,
             occurred_at, status, published_at, attempts, last_error_code,
             (payload = '{}'::jsonb) AS payload_empty
      FROM outbox_events
      WHERE aggregate_type = 'legacy' OR payload = '{}'::jsonb
      ORDER BY occurred_at, id
    `);
    const legacyRows = legacy.rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      eventVersion: row.event_version,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      occurredAt: row.occurred_at,
      status: row.status,
      publishedAt: row.published_at,
      attempts: row.attempts,
      payloadEmpty: row.payload_empty,
      // A legacy published_at flag is not provider evidence. Pending rows
      // still require an operator decision; completed reconciliation is shown
      // explicitly so inventory output does not look unresolved after audit.
      classification: row.status === "SKIPPED" && row.last_error_code === "LEGACY_MATERIALIZED"
        ? "MATERIALIZED"
        : row.status === "SKIPPED" || row.status === "DEAD"
          ? "RECONCILED"
          : "REVIEW_REQUIRED",
    }));
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      database: new URL(databaseUrl).pathname.slice(1),
      counts: counts.rows,
      legacyTotal: legacyRows.length,
      legacy: legacyRows,
      policy: "Legacy events are not dispatched automatically. An operator must classify each row as MAPPABLE_AND_FRESH, MAPPABLE_BUT_STALE, AGGREGATE_MISSING, AMBIGUOUS_RECIPIENT, or ALREADY_DELIVERED before SKIPPED/DEAD/requeue.",
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

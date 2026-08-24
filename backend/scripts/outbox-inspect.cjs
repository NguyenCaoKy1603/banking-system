const { Pool } = require("pg");

const limit = Number(process.argv[2] ?? 100);
if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
  throw new Error("Usage: npm run outbox:inspect -- [limit 1..1000]");
}
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
async function main() {
  try {
    const result = await pool.query(
      `SELECT id, event_type, status, attempts, aggregate_type, aggregate_id,
              occurred_at, next_attempt_at, last_error_code
       FROM outbox_events
       ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'PROCESSING' THEN 1 WHEN 'DEAD' THEN 2 ELSE 3 END,
                occurred_at, id
       LIMIT $1`,
      [limit],
    );
    console.log(JSON.stringify(result.rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      status: row.status,
      attempts: row.attempts,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      occurredAt: row.occurred_at,
      nextAttemptAt: row.next_attempt_at,
      lastErrorCode: row.last_error_code,
    }))));
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

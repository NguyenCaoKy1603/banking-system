const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");

const eventId = process.argv[2]?.trim();
const classification = process.argv[3]?.trim();
const reason = process.argv.slice(4).join(" ").trim();
const actor = process.env.OUTBOX_OPERATOR?.trim();
const allowed = new Set(["MAPPABLE_BUT_STALE", "AGGREGATE_MISSING", "AMBIGUOUS_RECIPIENT", "ALREADY_DELIVERED"]);
if (!eventId || !allowed.has(classification) || !reason || !actor) {
  throw new Error("Usage: OUTBOX_OPERATOR=<operator> npm run outbox:reconcile -- <event-id> <classification> <reason>");
}
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const status = classification === "AGGREGATE_MISSING" || classification === "AMBIGUOUS_RECIPIENT" ? "DEAD" : "SKIPPED";
    const code = `LEGACY_${classification}`;
    const current = await client.query(
      `SELECT event_type, event_version, attempts FROM outbox_events
       WHERE id = $1 AND status = 'PENDING'
         AND (aggregate_type = 'legacy' OR payload = '{}'::jsonb)
       FOR UPDATE`,
      [eventId],
    );
    const row = current.rows[0];
    if (!row) throw new Error("Event is not a pending legacy event, or does not exist.");
    if (status === "DEAD") {
      await client.query(
        `INSERT INTO dead_letter_events
           (id, source_kind, source_id, event_type, event_version,
            payload_snapshot, attempts, final_error_code, final_error_summary)
         VALUES ($1, 'OUTBOX', $2, $3, $4, '{}'::jsonb, $5, $6, $7)
         ON CONFLICT (source_kind, source_id) DO UPDATE SET
           attempts = EXCLUDED.attempts, final_error_code = EXCLUDED.final_error_code,
           final_error_summary = EXCLUDED.final_error_summary, dead_lettered_at = NOW()`,
        [randomUUID(), eventId, row.event_type, row.event_version, row.attempts, code, reason.slice(0, 300)],
      );
    }
    await client.query(
      `UPDATE outbox_events SET status = $2,
         skipped_at = CASE WHEN $2 = 'SKIPPED' THEN NOW() ELSE NULL END,
         dead_lettered_at = CASE WHEN $2 = 'DEAD' THEN NOW() ELSE NULL END,
         last_error_code = $3, last_error_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'PENDING'`,
      [eventId, status, code],
    );
    await client.query(
      `INSERT INTO audit_events
         (id, event_type, actor_customer_id, resource_id, occurred_at, payload)
       VALUES ($1, 'OUTBOX_LEGACY_RECONCILED', NULL, $2, NOW(), $3::jsonb)`,
      [randomUUID(), eventId, JSON.stringify({ operator: actor, classification, reason: reason.slice(0, 300) })],
    );
    await client.query("COMMIT");
    console.log(JSON.stringify({ status, eventId, classification, operator: actor }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");

const eventId = process.argv[2]?.trim();
const reason = process.argv.slice(3).join(" ").trim();
const actor = process.env.OUTBOX_OPERATOR?.trim();
if (!eventId || !reason || !actor) {
  throw new Error("Usage: OUTBOX_OPERATOR=<operator> npm run outbox:requeue -- <event-id> <reason>");
}
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE outbox_events
       SET status = 'PENDING', next_attempt_at = NOW(), locked_by = NULL,
           locked_at = NULL, lease_expires_at = NULL, dead_lettered_at = NULL,
           skipped_at = NULL, last_error_code = NULL, last_error_at = NULL,
           updated_at = NOW()
       WHERE id = $1 AND status IN ('DEAD', 'SKIPPED')
         AND aggregate_type <> 'legacy' AND payload <> '{}'::jsonb`,
      [eventId],
    );
    if ((result.rowCount ?? 0) !== 1) throw new Error("Event is not a requeueable canonical DEAD/SKIPPED event, or does not exist.");
    await client.query(
      `UPDATE dead_letter_events SET requeued_at = NOW(), requeued_by = $2,
        requeue_reason = $3 WHERE source_kind = 'OUTBOX' AND source_id = $1`,
      [eventId, actor, reason.slice(0, 300)],
    );
    await client.query(
      `INSERT INTO audit_events
         (id, event_type, actor_customer_id, resource_id, occurred_at, payload)
       VALUES ($1, 'OUTBOX_REQUEUED', NULL, $2, NOW(), $3::jsonb)`,
      [randomUUID(), eventId, JSON.stringify({ operator: actor, reason: reason.slice(0, 300) })],
    );
    await client.query("COMMIT");
    console.log(JSON.stringify({ status: "requeued", eventId, operator: actor }));
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

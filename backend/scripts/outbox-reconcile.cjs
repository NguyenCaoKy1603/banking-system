const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");

const eventId = process.argv[2]?.trim();
const classification = process.argv[3]?.trim();
const reason = process.argv.slice(4).join(" ").trim();
const actor = process.env.OUTBOX_OPERATOR?.trim();
const allowed = new Set([
  "MAPPABLE_AND_FRESH",
  "MAPPABLE_BUT_STALE",
  "AGGREGATE_MISSING",
  "AMBIGUOUS_RECIPIENT",
  "ALREADY_DELIVERED",
]);
if (!eventId || !allowed.has(classification) || !reason || !actor) {
  throw new Error("Usage: OUTBOX_OPERATOR=<operator> npm run outbox:reconcile -- <event-id> <classification> <reason>");
}
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const pool = new Pool({ connectionString: databaseUrl, max: 1 });

function shortReason(value) {
  return value.slice(0, 300);
}

async function findOrCreateTransferNotifications(client, transfer) {
  const senderCustomerId = transfer.customer_id ? String(transfer.customer_id) : null;
  const recipientCustomerId = transfer.destination_owner_id ? String(transfer.destination_owner_id) : null;
  const sourceAccountId = transfer.source_account_id ? String(transfer.source_account_id) : null;
  const destinationAccountId = transfer.destination_account_id ? String(transfer.destination_account_id) : null;
  const sourceTransactionId = transfer.source_transaction_id ? String(transfer.source_transaction_id) : null;
  const destinationTransactionId = transfer.destination_transaction_id ? String(transfer.destination_transaction_id) : null;
  if (!senderCustomerId || !recipientCustomerId || !sourceAccountId || !destinationAccountId ||
      !sourceTransactionId || !destinationTransactionId || senderCustomerId === recipientCustomerId) {
    throw new Error("Transfer recipient is ambiguous; reconcile as AMBIGUOUS_RECIPIENT.");
  }
  const subjects = [senderCustomerId, recipientCustomerId];
  const existing = await client.query(
    `SELECT id, customer_id, resource_id FROM notifications
     WHERE resource_id = $1 AND notification_type = 'TRANSFER'
       AND customer_id = ANY($2::uuid[])
     ORDER BY created_at, id`,
    [transfer.id, subjects],
  );
  const transactionExisting = await client.query(
    `SELECT id, customer_id, resource_id FROM notifications
     WHERE resource_id = ANY($1::text[]) AND notification_type = 'TRANSFER'
       AND customer_id = ANY($2::uuid[])
     ORDER BY created_at, id`,
    [[sourceTransactionId, destinationTransactionId], subjects],
  );
  const existingRows = [...existing.rows, ...transactionExisting.rows];
  const byCustomer = new Map(existingRows.map((row) => [String(row.customer_id), row]));
  const accountByCustomer = new Map([
    [senderCustomerId, sourceAccountId],
    [recipientCustomerId, destinationAccountId],
  ]);
  const transactionByCustomer = new Map([
    [senderCustomerId, sourceTransactionId],
    [recipientCustomerId, destinationTransactionId],
  ]);
  const notificationIds = [];
  for (const customerId of subjects) {
    const desiredResourceId = transactionByCustomer.get(customerId);
    const existingRow = byCustomer.get(customerId);
    let notificationId = existingRow ? String(existingRow.id) : null;
    if (existingRow && String(existingRow.resource_id ?? '') !== desiredResourceId) {
      await client.query(
        "UPDATE notifications SET resource_id = $1 WHERE id = $2",
        [desiredResourceId, notificationId],
      );
    }
    if (!notificationId) {
      notificationId = randomUUID();
      const sender = customerId === senderCustomerId;
      await client.query(
        `INSERT INTO notifications
           (id, customer_id, notification_type, title, body, resource_id,
            resource_account_id, is_read, created_at)
         VALUES ($1, $2, 'TRANSFER', $3, $4, $5, $6, false, $7)`,
        [
          notificationId,
          customerId,
          sender ? "Chuyển tiền thành công" : "Bạn nhận được tiền chuyển khoản",
          sender
            ? "Giao dịch chuyển tiền nội bộ đã hoàn tất."
            : "Tài khoản của bạn đã nhận một giao dịch chuyển tiền nội bộ.",
          desiredResourceId,
          accountByCustomer.get(customerId),
          transfer.occurred_at,
        ],
      );
    }
    notificationIds.push(notificationId);
  }
  return { subjects, notificationIds };
}

async function materializeFreshEvent(client, row, reasonValue, actorValue) {
  const eventType = String(row.event_type);
  const occurredAt = new Date(row.occurred_at).toISOString();
  const nowResult = await client.query("SELECT NOW() AS now");
  const now = new Date(nowResult.rows[0].now).getTime();
  const freshnessMs = eventType === "SANDBOX_FUNDING_SUCCEEDED"
    ? 24 * 60 * 60 * 1000
    : 7 * 24 * 60 * 60 * 1000;
  if (Date.parse(occurredAt) < now - freshnessMs) {
    throw new Error("Legacy event is outside its freshness window; reconcile as MAPPABLE_BUT_STALE.");
  }

  let mapped;
  if (eventType === "TRANSFER_SUCCEEDED") {
    const transfer = await client.query(
      `SELECT id, customer_id, destination_owner_id, source_account_id,
              destination_account_id, source_transaction_id, destination_transaction_id,
              reference, status, created_at AS occurred_at
       FROM transfers
       WHERE id::text = $1
       FOR SHARE`,
      [String(row.aggregate_id)],
    );
    if (transfer.rowCount !== 1 || transfer.rows[0].status !== "SUCCEEDED") {
      throw new Error("Transfer aggregate is missing or not succeeded; reconcile as AGGREGATE_MISSING.");
    }
    const notificationData = await findOrCreateTransferNotifications(client, transfer.rows[0]);
    mapped = {
      canonicalType: "transfer.succeeded.v1",
      aggregateType: "transfer",
      priority: 10,
      subjectCustomerIds: notificationData.subjects,
      notificationIds: notificationData.notificationIds,
      payload: { transferId: String(transfer.rows[0].id), reference: String(transfer.rows[0].reference) },
    };
  } else if (eventType === "SANDBOX_FUNDING_SUCCEEDED") {
    const records = await client.query(
      `SELECT payload
       FROM reference_runtime_records
       WHERE collection = 'fundingIdempotency'
         AND payload->'receipt'->>'fundingId' = $1
       ORDER BY record_key`,
      [String(row.aggregate_id)],
    );
    if (records.rowCount !== 1) {
      throw new Error("Sandbox funding receipt is missing or ambiguous; reconcile as AGGREGATE_MISSING.");
    }
    const receipt = records.rows[0].payload?.receipt;
    const transactionId = receipt?.transactionId;
    if (typeof transactionId !== "string") {
      throw new Error("Sandbox funding receipt has no transaction ID; reconcile as AGGREGATE_MISSING.");
    }
    const transaction = await client.query(
      `SELECT a.id, a.account_id, a.reference, a.occurred_at, p.customer_id
       FROM account_transactions a
       JOIN payment_accounts p ON p.id = a.account_id
       WHERE a.id::text = $1 AND a.direction = 'CREDIT' AND a.status = 'SUCCEEDED'`,
      [transactionId],
    );
    if (transaction.rowCount !== 1) {
      throw new Error("Sandbox funding transaction is missing or ambiguous; reconcile as AGGREGATE_MISSING.");
    }
    const customerId = String(transaction.rows[0].customer_id);
    const existing = await client.query(
      `SELECT id FROM notifications
       WHERE resource_id = $1 AND customer_id = $2 AND notification_type = 'SECURITY'
       ORDER BY created_at, id LIMIT 1`,
      [String(row.aggregate_id), customerId],
    );
    const notificationId = existing.rows[0]?.id ? String(existing.rows[0].id) : randomUUID();
    if (!existing.rows[0]) {
      await client.query(
        `INSERT INTO notifications
           (id, customer_id, notification_type, title, body, resource_id,
            resource_account_id, is_read, created_at)
         VALUES ($1, $2, 'SECURITY', 'Nạp tiền Sandbox thành công',
                 'Giao dịch nạp tiền mô phỏng đã hoàn tất.', $3, $4, false, $5)`,
        [notificationId, customerId, String(row.aggregate_id), transaction.rows[0].account_id, occurredAt],
      );
    }
    mapped = {
      canonicalType: "sandbox.funding_succeeded.v1",
      aggregateType: "sandbox",
      priority: 90,
      subjectCustomerIds: [customerId],
      notificationIds: [notificationId],
      payload: { fundingId: String(row.aggregate_id), transactionId },
    };
  } else {
    throw new Error(`Legacy event type ${eventType} is not safely materializable.`);
  }

  const materializedEventId = randomUUID();
  const envelope = {
    eventId: materializedEventId,
    eventType: mapped.canonicalType,
    eventVersion: 1,
    aggregate: { type: mapped.aggregateType, id: String(row.aggregate_id), version: 1 },
    occurredAt,
    traceId: row.trace_id ? String(row.trace_id) : null,
    subjectCustomerIds: mapped.subjectCustomerIds,
    notificationIds: mapped.notificationIds,
  };
  const inserted = await client.query(
    `INSERT INTO outbox_events
       (id, event_type, event_version, aggregate_type, aggregate_id,
        aggregate_version, deduplication_key, payload, status, priority,
        occurred_at, next_attempt_at, attempts, trace_id, created_at, updated_at)
     VALUES ($1, $2, 1, $3, $4, 1, $5, $6::jsonb, 'PENDING', $7,
             $8::timestamptz, NOW(), 0, $9, NOW(), NOW())
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      materializedEventId,
      mapped.canonicalType,
      mapped.aggregateType,
      String(row.aggregate_id),
      `legacy-materialized:${String(row.id)}`,
      JSON.stringify({ ...mapped.payload, ...envelope }),
      mapped.priority,
      occurredAt,
      envelope.traceId,
    ],
  );
  const persistedEventId = inserted.rows[0]?.id
    ? String(inserted.rows[0].id)
    : String((await client.query(
      "SELECT id FROM outbox_events WHERE deduplication_key = $1",
      [`legacy-materialized:${String(row.id)}`],
    )).rows[0]?.id ?? "");
  if (!persistedEventId) {
    throw new Error("Canonical event could not be persisted during legacy materialization.");
  }
  await client.query(
    `UPDATE outbox_events
     SET status = 'SKIPPED', skipped_at = NOW(), last_error_code = 'LEGACY_MATERIALIZED',
         last_error_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'PENDING'`,
    [String(row.id)],
  );
  await client.query(
    `INSERT INTO audit_events
       (id, event_type, actor_customer_id, resource_id, occurred_at, payload)
     VALUES ($1, 'OUTBOX_LEGACY_RECONCILED', NULL, $2, NOW(), $3::jsonb)`,
    [randomUUID(), String(row.id), JSON.stringify({
      operator: actorValue,
      classification: "MAPPABLE_AND_FRESH",
      reason: shortReason(reasonValue),
      materializedEventId: persistedEventId,
    })],
  );
  return { status: "MATERIALIZED", legacyEventId: String(row.id), materializedEventId: persistedEventId, eventType: mapped.canonicalType };
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT * FROM outbox_events
       WHERE id = $1 AND status = 'PENDING'
         AND (aggregate_type = 'legacy' OR payload = '{}'::jsonb)
       FOR UPDATE`,
      [eventId],
    );
    const row = current.rows[0];
    if (!row) throw new Error("Event is not a pending legacy event, or does not exist.");
    if (classification === "MAPPABLE_AND_FRESH") {
      const result = await materializeFreshEvent(client, row, reason, actor);
      await client.query("COMMIT");
      console.log(JSON.stringify({ ...result, classification, operator: actor }));
      return;
    }

    const status = classification === "AGGREGATE_MISSING" || classification === "AMBIGUOUS_RECIPIENT" ? "DEAD" : "SKIPPED";
    const code = `LEGACY_${classification}`;
    if (status === "DEAD") {
      await client.query(
        `INSERT INTO dead_letter_events
           (id, source_kind, source_id, event_type, event_version,
            payload_snapshot, attempts, final_error_code, final_error_summary)
         VALUES ($1, 'OUTBOX', $2, $3, $4, '{}'::jsonb, $5, $6, $7)
         ON CONFLICT (source_kind, source_id) DO UPDATE SET
           attempts = EXCLUDED.attempts, final_error_code = EXCLUDED.final_error_code,
           final_error_summary = EXCLUDED.final_error_summary, dead_lettered_at = NOW()`,
        [randomUUID(), eventId, row.event_type, row.event_version, row.attempts, code, shortReason(reason)],
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
      [randomUUID(), eventId, JSON.stringify({ operator: actor, classification, reason: shortReason(reason) })],
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

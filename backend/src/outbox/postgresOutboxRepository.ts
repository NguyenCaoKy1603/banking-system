import { randomUUID } from "node:crypto";

import type { DatabasePool } from "../database/pool.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { asIso, asJson, asNullableIso, asString, requireUuid } from "../database/rowMappers.js";
import { sanitizePayload } from "./eventRegistry.js";
import type {
  DeliveryRow,
  EndpointRow,
  NotificationChannel,
  NotificationRow,
  OutboxEventRow,
  OutboxStatus,
  WorkerStatus,
} from "./types.js";

function mapOutbox(row: Record<string, unknown>): OutboxEventRow {
  return {
    id: requireUuid(row.id),
    eventType: asString(row.event_type),
    eventVersion: Number(row.event_version ?? 1),
    aggregateType: asString(row.aggregate_type, "unknown"),
    aggregateId: asString(row.aggregate_id),
    aggregateVersion: Number(row.aggregate_version ?? 1),
    deduplicationKey: asString(row.deduplication_key),
    payload: asJson(row.payload ?? {}),
    status: asString(row.status, "PENDING") as OutboxStatus,
    priority: Number(row.priority ?? 100),
    occurredAt: asIso(row.occurred_at),
    nextAttemptAt: asNullableIso(row.next_attempt_at),
    attempts: Number(row.attempts ?? 0),
    lockedBy: row.locked_by === null || row.locked_by === undefined ? null : asString(row.locked_by),
    lockedAt: asNullableIso(row.locked_at),
    leaseExpiresAt: asNullableIso(row.lease_expires_at),
    publishedAt: asNullableIso(row.published_at),
    deadLetteredAt: asNullableIso(row.dead_lettered_at),
    skippedAt: asNullableIso(row.skipped_at),
    lastErrorCode: row.last_error_code === null || row.last_error_code === undefined ? null : asString(row.last_error_code),
    lastErrorAt: asNullableIso(row.last_error_at),
    traceId: row.trace_id === null || row.trace_id === undefined ? null : asString(row.trace_id),
    createdAt: asIso(row.created_at ?? row.occurred_at),
  };
}

function mapDelivery(row: Record<string, unknown>): DeliveryRow {
  return {
    id: requireUuid(row.id),
    outboxEventId: requireUuid(row.outbox_event_id, "outbox_event_id"),
    notificationId: requireUuid(row.notification_id, "notification_id"),
    customerId: requireUuid(row.customer_id, "customer_id"),
    endpointId: requireUuid(row.endpoint_id, "endpoint_id"),
    channel: asString(row.channel) as NotificationChannel,
    provider: asString(row.provider),
    status: asString(row.status, "PENDING") as DeliveryRow["status"],
    attempts: Number(row.attempts ?? 0),
    nextAttemptAt: asNullableIso(row.next_attempt_at),
    lockedBy: row.locked_by === null || row.locked_by === undefined ? null : asString(row.locked_by),
    leaseExpiresAt: asNullableIso(row.lease_expires_at),
    providerMessageId: row.provider_message_id === null || row.provider_message_id === undefined ? null : asString(row.provider_message_id),
    lastErrorCode: row.last_error_code === null || row.last_error_code === undefined ? null : asString(row.last_error_code),
  };
}

function mapNotification(row: Record<string, unknown>): NotificationRow {
  return {
    id: requireUuid(row.id),
    customerId: requireUuid(row.customer_id, "customer_id"),
    type: asString(row.notification_type) as NotificationRow["type"],
    title: asString(row.title),
    body: asString(row.body),
    resourceId: row.resource_id === null || row.resource_id === undefined ? null : asString(row.resource_id),
    read: Boolean(row.is_read),
    createdAt: asIso(row.created_at),
  };
}

function mapEndpoint(row: Record<string, unknown>): EndpointRow {
  return {
    id: requireUuid(row.id),
    customerId: requireUuid(row.customer_id, "customer_id"),
    deviceId: asString(row.device_id),
    channel: asString(row.channel) as EndpointRow["channel"],
    provider: asString(row.provider),
    platform: row.platform === null || row.platform === undefined ? null : asString(row.platform),
    addressCiphertext: asString(row.address_ciphertext),
    addressFingerprint: asString(row.address_fingerprint),
    status: asString(row.status, "ACTIVE") as EndpointRow["status"],
  };
}

export class PostgresOutboxRepository {
  readonly unitOfWork: UnitOfWork;

  constructor(private readonly database: DatabasePool) {
    this.unitOfWork = new UnitOfWork(database);
  }

  async claimBatch(workerId: string, batchSize: number, leaseSeconds: number): Promise<OutboxEventRow[]> {
    if (batchSize < 1 || leaseSeconds < 1) throw new Error("Outbox claim settings must be positive.");
    return this.unitOfWork.transaction(async ({ client }) => {
      const result = await client.query(
        `WITH candidates AS (
           SELECT id
           FROM outbox_events
           WHERE status = 'PENDING'
             AND COALESCE(next_attempt_at, occurred_at) <= NOW()
             AND aggregate_type <> 'legacy'
             AND payload <> '{}'::jsonb
           ORDER BY priority ASC, COALESCE(next_attempt_at, occurred_at), occurred_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE outbox_events AS event
         SET status = 'PROCESSING',
             locked_by = $2,
             locked_at = NOW(),
             lease_expires_at = NOW() + ($3::bigint * INTERVAL '1 second'),
             attempts = attempts + 1
         FROM candidates
         WHERE event.id = candidates.id
         RETURNING event.*`,
        [batchSize, workerId, leaseSeconds],
      );
      return result.rows.map((row) => mapOutbox(row as Record<string, unknown>));
    });
  }

  async reclaimExpired(workerId: string): Promise<{ outbox: number; deliveries: number }> {
    void workerId;
    return this.unitOfWork.transaction(async ({ client }) => {
      const outbox = await client.query(
        `UPDATE outbox_events
         SET status = 'PENDING', locked_by = NULL, locked_at = NULL,
             lease_expires_at = NULL, next_attempt_at = NOW(), updated_at = NOW()
         WHERE status = 'PROCESSING' AND lease_expires_at < NOW()` ,
      );
      const deliveries = await client.query(
        `UPDATE notification_deliveries
         SET status = 'PENDING', locked_by = NULL, locked_at = NULL,
             lease_expires_at = NULL, next_attempt_at = NOW(), updated_at = NOW()
         WHERE status = 'PROCESSING' AND lease_expires_at < NOW()`,
      );
      return { outbox: outbox.rowCount ?? 0, deliveries: deliveries.rowCount ?? 0 };
    });
  }

  async markDispatched(eventId: string, workerId: string): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE outbox_events
       SET status = 'DISPATCHED', published_at = NOW(), locked_by = NULL,
           locked_at = NULL, lease_expires_at = NULL, last_error_code = NULL,
           last_error_at = NULL, updated_at = NOW()
       WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2`,
      [requireUuid(eventId, "eventId"), workerId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async skipLegacy(event: OutboxEventRow, workerId: string, code: string, reason: string): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE outbox_events
       SET status = 'SKIPPED', skipped_at = NOW(), locked_by = NULL,
           locked_at = NULL, lease_expires_at = NULL, last_error_code = $3,
           last_error_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2`,
      [event.id, workerId, `${code}:${reason}`.slice(0, 120)],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async reconcileLegacy(input: {
    eventId: string;
    classification: "MAPPABLE_BUT_STALE" | "AGGREGATE_MISSING" | "AMBIGUOUS_RECIPIENT" | "ALREADY_DELIVERED";
    reason: string;
    actor: string;
  }): Promise<"SKIPPED" | "DEAD" | null> {
    const status = input.classification === "AGGREGATE_MISSING" || input.classification === "AMBIGUOUS_RECIPIENT"
      ? "DEAD"
      : "SKIPPED";
    return this.unitOfWork.transaction(async ({ client }) => {
      const current = await client.query(
        `SELECT * FROM outbox_events
         WHERE id = $1 AND status = 'PENDING'
           AND (aggregate_type = 'legacy' OR payload = '{}'::jsonb)
         FOR UPDATE`,
        [requireUuid(input.eventId, "eventId")],
      );
      const row = current.rows[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      const code = `LEGACY_${input.classification}`;
      if (status === "DEAD") {
        await client.query(
          `INSERT INTO dead_letter_events
             (id, source_kind, source_id, event_type, event_version,
              payload_snapshot, attempts, final_error_code, final_error_summary)
           VALUES ($1, 'OUTBOX', $2, $3, $4, '{}'::jsonb, $5, $6, $7)
           ON CONFLICT (source_kind, source_id) DO UPDATE SET
             attempts = EXCLUDED.attempts,
             final_error_code = EXCLUDED.final_error_code,
             final_error_summary = EXCLUDED.final_error_summary,
             dead_lettered_at = NOW()`,
          [randomUUID(), input.eventId, asString(row.event_type, "legacy"), Number(row.event_version ?? 1), Number(row.attempts ?? 0), code, input.reason.slice(0, 300)],
        );
      }
      await client.query(
        `UPDATE outbox_events
         SET status = $2,
             skipped_at = CASE WHEN $2 = 'SKIPPED' THEN NOW() ELSE NULL END,
             dead_lettered_at = CASE WHEN $2 = 'DEAD' THEN NOW() ELSE NULL END,
             last_error_code = $3, last_error_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND status = 'PENDING'`,
        [input.eventId, status, code],
      );
      await client.query(
        `INSERT INTO audit_events
           (id, event_type, actor_customer_id, resource_id, occurred_at, payload)
         VALUES ($1, 'OUTBOX_LEGACY_RECONCILED', NULL, $2, NOW(), $3::jsonb)`,
        [randomUUID(), input.eventId, JSON.stringify({ operator: input.actor, classification: input.classification, reason: input.reason.slice(0, 300) })],
      );
      return status;
    });
  }

  async failOutbox(input: {
    event: OutboxEventRow;
    workerId: string;
    code: string;
    summary: string;
    permanent: boolean;
    nextAttemptAt?: string | null;
  }): Promise<OutboxStatus | null> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const current = await client.query(
        "SELECT * FROM outbox_events WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2 FOR UPDATE",
        [input.event.id, input.workerId],
      );
      if (!current.rows[0]) return null;
      const shouldDead = input.permanent;
      const status: OutboxStatus = shouldDead ? "DEAD" : "PENDING";
      if (shouldDead) {
        await client.query(
          `INSERT INTO dead_letter_events
             (id, source_kind, source_id, event_type, event_version,
              payload_snapshot, attempts, final_error_code, final_error_summary)
           VALUES ($1, 'OUTBOX', $2, $3, $4, $5::jsonb, $6, $7, $8)
           ON CONFLICT (source_kind, source_id) DO UPDATE SET
             attempts = EXCLUDED.attempts,
             final_error_code = EXCLUDED.final_error_code,
             final_error_summary = EXCLUDED.final_error_summary,
             dead_lettered_at = NOW()`,
          [randomUUID(), input.event.id, input.event.eventType, input.event.eventVersion, JSON.stringify(sanitizePayload(input.event.payload ?? {})), input.event.attempts, input.code, input.summary.slice(0, 300)],
        );
      }
      await client.query(
        `UPDATE outbox_events
         SET status = $3, next_attempt_at = $4::timestamptz,
             locked_by = NULL, locked_at = NULL, lease_expires_at = NULL,
             last_error_code = $5, last_error_at = NOW(),
             dead_lettered_at = CASE WHEN $3 = 'DEAD' THEN NOW() ELSE NULL END,
             updated_at = NOW()
         WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2`,
        [input.event.id, input.workerId, status, input.nextAttemptAt ?? null, input.code],
      );
      return status;
    });
  }

  async createDeliveriesAndDispatch(input: {
    event: OutboxEventRow;
    workerId: string;
    notifications: NotificationRow[];
    endpoints: EndpointRow[];
    channels: readonly NotificationChannel[];
  }): Promise<{ deliveryCount: number; dispatched: boolean }> {
    return this.unitOfWork.transaction(async ({ client }) => {
      let deliveryCount = 0;
      for (const notification of input.notifications) {
        for (const channel of input.channels) {
          for (const endpoint of input.endpoints.filter(
            (candidate) => candidate.customerId === notification.customerId && candidate.channel === channel,
          )) {
            const inserted = await client.query(
              `INSERT INTO notification_deliveries
                 (id, outbox_event_id, notification_id, customer_id, endpoint_id,
                  channel, provider, status, next_attempt_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', NOW())
               ON CONFLICT (outbox_event_id, notification_id, channel, endpoint_id) DO NOTHING
               RETURNING id`,
              [randomUUID(), input.event.id, notification.id, notification.customerId, endpoint.id, channel, endpoint.provider],
            );
            deliveryCount += inserted.rowCount ?? 0;
          }
        }
      }
      const dispatched = await client.query(
        `UPDATE outbox_events
         SET status = 'DISPATCHED', published_at = NOW(), locked_by = NULL,
             locked_at = NULL, lease_expires_at = NULL, last_error_code = NULL,
             last_error_at = NULL, updated_at = NOW()
         WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2`,
        [input.event.id, input.workerId],
      );
      return { deliveryCount, dispatched: (dispatched.rowCount ?? 0) === 1 };
    });
  }

  async claimDeliveries(workerId: string, batchSize: number, leaseSeconds: number): Promise<DeliveryRow[]> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const result = await client.query(
        `WITH candidates AS (
           SELECT id FROM notification_deliveries
           WHERE status = 'PENDING' AND COALESCE(next_attempt_at, created_at) <= NOW()
           ORDER BY next_attempt_at NULLS FIRST, created_at, id
           FOR UPDATE SKIP LOCKED LIMIT $1
         )
         UPDATE notification_deliveries AS delivery
         SET status = 'PROCESSING', locked_by = $2, locked_at = NOW(),
             lease_expires_at = NOW() + ($3::bigint * INTERVAL '1 second'),
             attempts = attempts + 1, updated_at = NOW()
         FROM candidates
         WHERE delivery.id = candidates.id
         RETURNING delivery.*`,
        [batchSize, workerId, leaseSeconds],
      );
      return result.rows.map((row) => mapDelivery(row as Record<string, unknown>));
    });
  }

  async getDeliveryContext(deliveryId: string): Promise<{
    delivery: DeliveryRow;
    notification: NotificationRow;
    endpoint: EndpointRow;
    event: OutboxEventRow;
  } | null> {
    const result = await this.database.query(
      `SELECT
         d.*,
         n.id AS notification_id_value, n.customer_id AS notification_customer_id,
         n.notification_type, n.title, n.body, n.resource_id,
         n.is_read, n.created_at AS notification_created_at,
         endpoint.id AS endpoint_id_value, endpoint.customer_id AS endpoint_customer_id,
         endpoint.device_id, endpoint.channel AS endpoint_channel,
         endpoint.provider AS endpoint_provider, endpoint.platform,
         endpoint.address_ciphertext, endpoint.address_fingerprint,
         endpoint.status AS endpoint_status,
         event.id AS event_id_value, event.event_type, event.event_version,
         event.aggregate_type, event.aggregate_id, event.aggregate_version,
         event.deduplication_key, event.payload, event.status AS event_status,
         event.priority, event.occurred_at, event.next_attempt_at AS event_next_attempt_at,
         event.attempts AS event_attempts, event.locked_by AS event_locked_by,
         event.locked_at AS event_locked_at, event.lease_expires_at AS event_lease_expires_at,
         event.published_at AS event_published_at, event.dead_lettered_at AS event_dead_lettered_at,
         event.skipped_at AS event_skipped_at, event.last_error_code AS event_last_error_code,
         event.last_error_at AS event_last_error_at, event.trace_id AS event_trace_id,
         event.created_at AS event_created_at
       FROM notification_deliveries d
       JOIN notifications n ON n.id = d.notification_id
       JOIN notification_endpoints endpoint ON endpoint.id = d.endpoint_id
       JOIN outbox_events event ON event.id = d.outbox_event_id
       WHERE d.id = $1`,
      [requireUuid(deliveryId, "deliveryId")],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const deliveryRow = { ...row, notification_id: row.notification_id_value, endpoint_id: row.endpoint_id_value };
    const notificationRow = {
      id: row.notification_id_value,
      customer_id: row.notification_customer_id,
      notification_type: row.notification_type,
      title: row.title,
      body: row.body,
      resource_id: row.resource_id,
      is_read: row.is_read,
      created_at: row.notification_created_at,
    };
    const endpointRow = {
      id: row.endpoint_id_value,
      customer_id: row.endpoint_customer_id,
      device_id: row.device_id,
      channel: row.endpoint_channel,
      provider: row.endpoint_provider,
      platform: row.platform,
      address_ciphertext: row.address_ciphertext,
      address_fingerprint: row.address_fingerprint,
      status: row.endpoint_status,
    };
    const eventRow = {
      id: row.event_id_value,
      event_type: row.event_type,
      event_version: row.event_version,
      aggregate_type: row.aggregate_type,
      aggregate_id: row.aggregate_id,
      aggregate_version: row.aggregate_version,
      deduplication_key: row.deduplication_key,
      payload: row.payload,
      status: row.event_status,
      priority: row.priority,
      occurred_at: row.occurred_at,
      next_attempt_at: row.event_next_attempt_at,
      attempts: row.event_attempts,
      locked_by: row.event_locked_by,
      locked_at: row.event_locked_at,
      lease_expires_at: row.event_lease_expires_at,
      published_at: row.event_published_at,
      dead_lettered_at: row.event_dead_lettered_at,
      skipped_at: row.event_skipped_at,
      last_error_code: row.event_last_error_code,
      last_error_at: row.event_last_error_at,
      trace_id: row.event_trace_id,
      created_at: row.event_created_at,
    };
    return {
      delivery: mapDelivery(deliveryRow),
      notification: mapNotification(notificationRow),
      endpoint: mapEndpoint(endpointRow),
      event: mapOutbox(eventRow),
    };
  }

  async markDeliverySent(input: { deliveryId: string; workerId: string; providerMessageId?: string | null }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE notification_deliveries
       SET status = 'SENT', sent_at = NOW(), provider_message_id = $3,
           locked_by = NULL, locked_at = NULL, lease_expires_at = NULL,
           last_error_code = NULL, last_error_at = NULL, updated_at = NOW()
       WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2`,
      [requireUuid(input.deliveryId, "deliveryId"), input.workerId, input.providerMessageId ?? null],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async failDelivery(input: {
    delivery: DeliveryRow;
    workerId: string;
    code: string;
    summary: string;
    permanent: boolean;
    nextAttemptAt?: string | null;
  }): Promise<DeliveryRow["status"] | null> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const current = await client.query(
        "SELECT * FROM notification_deliveries WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2 FOR UPDATE",
        [input.delivery.id, input.workerId],
      );
      if (!current.rows[0]) return null;
      const status: DeliveryRow["status"] = input.permanent ? "DEAD" : "PENDING";
      if (input.permanent) {
        const event = await client.query(
          `SELECT event_type, event_version, payload FROM outbox_events WHERE id = $1`,
          [input.delivery.outboxEventId],
        );
        const eventRow = event.rows[0] as Record<string, unknown> | undefined;
        await client.query(
          `INSERT INTO dead_letter_events
             (id, source_kind, source_id, event_type, event_version,
              payload_snapshot, attempts, final_error_code, final_error_summary)
           VALUES ($1, 'DELIVERY', $2, $3, $4, $5::jsonb, $6, $7, $8)
           ON CONFLICT (source_kind, source_id) DO UPDATE SET
             attempts = EXCLUDED.attempts,
             final_error_code = EXCLUDED.final_error_code,
             final_error_summary = EXCLUDED.final_error_summary,
             dead_lettered_at = NOW()`,
          [randomUUID(), input.delivery.id, asString(eventRow?.event_type, "delivery"), Number(eventRow?.event_version ?? 1), JSON.stringify(sanitizePayload(eventRow?.payload ?? {})), input.delivery.attempts, input.code, input.summary.slice(0, 300)],
        );
      }
      await client.query(
        `UPDATE notification_deliveries
         SET status = $3, next_attempt_at = $4::timestamptz,
             locked_by = NULL, locked_at = NULL, lease_expires_at = NULL,
             last_error_code = $5, last_error_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2`,
        [input.delivery.id, input.workerId, status, input.nextAttemptAt ?? null, input.code],
      );
      return status;
    });
  }

  async invalidateEndpoint(endpointId: string): Promise<void> {
    await this.database.query(
      "UPDATE notification_endpoints SET status = 'INVALID', invalidated_at = NOW(), updated_at = NOW() WHERE id = $1",
      [requireUuid(endpointId, "endpointId")],
    );
  }

  async findNotifications(notificationIds: readonly string[]): Promise<NotificationRow[]> {
    if (notificationIds.length === 0) return [];
    const result = await this.database.query(
      "SELECT * FROM notifications WHERE id = ANY($1::uuid[]) ORDER BY created_at, id",
      [notificationIds.map((id) => requireUuid(id, "notificationId"))],
    );
    return result.rows.map((row) => mapNotification(row as Record<string, unknown>));
  }

  async findNotificationsByAggregate(aggregateId: string): Promise<NotificationRow[]> {
    const result = await this.database.query(
      "SELECT * FROM notifications WHERE resource_id = $1 ORDER BY created_at, id",
      [aggregateId],
    );
    return result.rows.map((row) => mapNotification(row as Record<string, unknown>));
  }

  async listActiveEndpoints(customerIds: readonly string[], channel: NotificationChannel): Promise<EndpointRow[]> {
    if (customerIds.length === 0) return [];
    const result = await this.database.query(
      `SELECT * FROM notification_endpoints
       WHERE customer_id = ANY($1::uuid[]) AND channel = $2 AND status = 'ACTIVE'
       ORDER BY customer_id, id`,
      [customerIds.map((id) => requireUuid(id, "customerId")), channel],
    );
    return result.rows.map((row) => mapEndpoint(row as Record<string, unknown>));
  }

  async preferenceEnabled(customerId: string, category: string, channel: NotificationChannel): Promise<boolean> {
    const result = await this.database.query(
      "SELECT enabled FROM notification_preferences WHERE customer_id = $1 AND category = $2 AND channel = $3",
      [requireUuid(customerId, "customerId"), category, channel],
    );
    return result.rows[0] === undefined ? true : Boolean(result.rows[0].enabled);
  }

  async upsertEndpoint(input: {
    id?: string;
    customerId: string;
    deviceId: string;
    channel: NotificationChannel;
    provider: string;
    platform?: string | null;
    addressCiphertext: string;
    addressFingerprint: string;
  }): Promise<EndpointRow> {
    const result = await this.database.query(
      `INSERT INTO notification_endpoints
        (id, customer_id, device_id, channel, provider, platform,
         address_ciphertext, address_fingerprint, status, last_seen_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', NOW(), NOW())
       ON CONFLICT (customer_id, device_id, channel, address_fingerprint)
       DO UPDATE SET provider = EXCLUDED.provider, platform = EXCLUDED.platform,
                     address_ciphertext = EXCLUDED.address_ciphertext,
                     status = 'ACTIVE', invalidated_at = NULL,
                     last_seen_at = NOW(), updated_at = NOW()
       RETURNING *`,
      [input.id ?? randomUUID(), requireUuid(input.customerId, "customerId"), input.deviceId, input.channel, input.provider, input.platform ?? null, input.addressCiphertext, input.addressFingerprint],
    );
    return mapEndpoint(result.rows[0] as Record<string, unknown>);
  }

  async revokeEndpoint(customerId: string, endpointId: string): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE notification_endpoints SET status = 'REVOKED', invalidated_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND customer_id = $2`,
      [requireUuid(endpointId, "endpointId"), requireUuid(customerId, "customerId")],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async setPreference(customerId: string, category: string, channel: NotificationChannel, enabled: boolean): Promise<void> {
    await this.database.query(
      `INSERT INTO notification_preferences (customer_id, category, channel, enabled, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (customer_id, category, channel)
       DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
      [requireUuid(customerId, "customerId"), category, channel, enabled],
    );
  }

  async heartbeat(input: { workerId: string; workerVersion: string; hostname: string; status: WorkerStatus }): Promise<void> {
    await this.database.query(
      `INSERT INTO worker_instances
        (worker_id, worker_version, started_at, last_heartbeat_at, status, hostname, updated_at)
       VALUES ($1, $2, NOW(), NOW(), $3, $4, NOW())
       ON CONFLICT (worker_id) DO UPDATE SET
         worker_version = EXCLUDED.worker_version,
         started_at = worker_instances.started_at,
         last_heartbeat_at = NOW(), status = EXCLUDED.status,
         hostname = EXCLUDED.hostname, updated_at = NOW()`,
      [input.workerId, input.workerVersion, input.status, input.hostname],
    );
  }

  async inspect(limit = 100): Promise<OutboxEventRow[]> {
    const result = await this.database.query(
      "SELECT * FROM outbox_events ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'PROCESSING' THEN 1 WHEN 'DEAD' THEN 2 ELSE 3 END, occurred_at, id LIMIT $1",
      [limit],
    );
    return result.rows.map((row) => mapOutbox(row as Record<string, unknown>));
  }

  async requeue(eventId: string, reason: string, actor: string): Promise<boolean> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const result = await client.query(
        `UPDATE outbox_events
         SET status = 'PENDING', next_attempt_at = NOW(), locked_by = NULL,
             locked_at = NULL, lease_expires_at = NULL, dead_lettered_at = NULL,
             skipped_at = NULL, last_error_code = NULL, last_error_at = NULL,
             updated_at = NOW()
         WHERE id = $1 AND status IN ('DEAD', 'SKIPPED')
           AND aggregate_type <> 'legacy' AND payload <> '{}'::jsonb`,
        [requireUuid(eventId, "eventId")],
      );
      if ((result.rowCount ?? 0) !== 1) return false;
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
      return true;
    });
  }

  async metrics(workerId?: string): Promise<Record<string, number>> {
    const result = await this.database.query(`
      SELECT
        (SELECT COUNT(*) FROM outbox_events WHERE status = 'PENDING')::int AS outbox_backlog_events,
        COALESCE((SELECT EXTRACT(EPOCH FROM (NOW() - MIN(occurred_at))) FROM outbox_events WHERE status = 'PENDING'), 0)::float AS outbox_oldest_pending_age_seconds,
        (SELECT COUNT(*) FROM notification_deliveries WHERE status = 'PENDING')::int AS notification_delivery_pending,
        (SELECT COUNT(*) FROM notification_deliveries WHERE status = 'SENT')::int AS notification_delivery_sent_total,
        (SELECT COUNT(*) FROM notification_deliveries WHERE status = 'DEAD')::int AS notification_delivery_dead_total,
        (SELECT COUNT(*) FROM outbox_events WHERE status = 'DEAD')::int AS outbox_dead_letter_total,
        (SELECT COUNT(*) FROM worker_instances
          WHERE status IN ('STARTING', 'READY', 'DRAINING')
            AND last_heartbeat_at < NOW() - INTERVAL '60 seconds')::int AS worker_stale_count,
        COALESCE((SELECT EXTRACT(EPOCH FROM (NOW() - last_heartbeat_at))
          FROM worker_instances WHERE worker_id = $1), 0)::float AS worker_heartbeat_age_seconds
    `, [workerId ?? ""]);
    const row = result.rows[0] as Record<string, unknown>;
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value ?? 0)]));
  }
}

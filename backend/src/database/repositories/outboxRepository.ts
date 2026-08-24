import type { PoolClient } from "pg";

import { asIso, asString, requireUuid } from "../rowMappers.js";

export type OutboxRow = {
  id: string;
  eventType: string;
  aggregateId: string;
  deduplicationKey: string | null;
  payload: unknown;
  occurredAt: string;
  publishedAt: string | null;
  attempts: number;
  nextAttemptAt: string | null;
};

export class OutboxRepository {
  constructor(private readonly client: PoolClient) {}

  async append(input: {
    id: string;
    eventType: string;
    aggregateId: string;
    deduplicationKey?: string | null;
    payload?: unknown;
    occurredAt?: string;
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO outbox_events
        (id, event_type, aggregate_id, deduplication_key, payload, occurred_at, attempts)
       VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6::timestamptz, NOW()), 0)
       ON CONFLICT DO NOTHING`,
      [
        requireUuid(input.id),
        input.eventType,
        input.aggregateId,
        input.deduplicationKey ?? null,
        JSON.stringify(input.payload ?? {}),
        input.occurredAt ?? null,
      ],
    );
  }

  async claimPending(limit = 50): Promise<OutboxRow[]> {
    const result = await this.client.query(
      `
        SELECT * FROM outbox_events
        WHERE published_at IS NULL
          AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
        ORDER BY occurred_at, id
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      `,
      [limit],
    );
    return result.rows.map((row) => ({
      id: requireUuid(row.id),
      eventType: asString(row.event_type),
      aggregateId: asString(row.aggregate_id),
      deduplicationKey: row.deduplication_key === null ? null : asString(row.deduplication_key),
      payload: row.payload,
      occurredAt: asIso(row.occurred_at),
      publishedAt: row.published_at === null ? null : asIso(row.published_at),
      attempts: Number(row.attempts ?? 0),
      nextAttemptAt: row.next_attempt_at === null ? null : asIso(row.next_attempt_at),
    }));
  }

  async markPublished(id: string): Promise<void> {
    await this.client.query("UPDATE outbox_events SET published_at = NOW(), attempts = attempts + 1 WHERE id = $1", [requireUuid(id)]);
  }
}

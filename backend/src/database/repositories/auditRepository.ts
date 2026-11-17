import type { PoolClient } from "pg";

import { requireUuid } from "../rowMappers.js";

export class AuditRepository {
  constructor(private readonly client: PoolClient) {}

  async append(input: {
    id: string;
    eventType: string;
    actorCustomerId?: string | null;
    resourceId?: string | null;
    occurredAt?: string;
    payload?: unknown;
    traceId?: string | null;
  }): Promise<void> {
    const payloadTraceId =
      input.payload &&
      typeof input.payload === "object" &&
      !Array.isArray(input.payload) &&
      typeof (input.payload as Record<string, unknown>).traceId === "string"
        ? String((input.payload as Record<string, unknown>).traceId).trim() || null
        : null;
    const traceId = input.traceId?.trim() || payloadTraceId;

    await this.client.query(
      `INSERT INTO audit_events
        (id, event_type, actor_customer_id, resource_id, occurred_at, payload, trace_id)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), $6::jsonb, $7)`,
      [
        requireUuid(input.id),
        input.eventType,
        input.actorCustomerId ? requireUuid(input.actorCustomerId, "actorCustomerId") : null,
        input.resourceId ?? null,
        input.occurredAt ?? null,
        JSON.stringify(input.payload ?? {}),
        traceId ?? null,
      ],
    );
  }
}

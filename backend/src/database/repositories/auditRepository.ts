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
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO audit_events
        (id, event_type, actor_customer_id, resource_id, occurred_at, payload)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), $6::jsonb)`,
      [
        requireUuid(input.id),
        input.eventType,
        input.actorCustomerId ? requireUuid(input.actorCustomerId, "actorCustomerId") : null,
        input.resourceId ?? null,
        input.occurredAt ?? null,
        JSON.stringify(input.payload ?? {}),
      ],
    );
  }
}

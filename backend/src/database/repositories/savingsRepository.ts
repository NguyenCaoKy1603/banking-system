import type { PoolClient } from "pg";

import { requireUuid } from "../rowMappers.js";

export class SavingsRepository {
  constructor(private readonly client: PoolClient) {}

  async lockQuote(quoteId: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.query("SELECT * FROM savings_quotes WHERE id = $1 FOR UPDATE", [requireUuid(quoteId, "quoteId")]);
    return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  async findOpeningByIdempotency(customerId: string, key: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.query("SELECT * FROM savings_openings WHERE customer_id = $1 AND idempotency_key = $2", [requireUuid(customerId, "customerId"), key]);
    return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  async lockDeposit(depositId: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.query("SELECT * FROM savings_deposits WHERE id = $1 FOR UPDATE", [requireUuid(depositId, "depositId")]);
    return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  async listDeposits(customerId: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.client.query("SELECT * FROM savings_deposits WHERE customer_id = $1 ORDER BY updated_at DESC, id", [requireUuid(customerId, "customerId")]);
    return result.rows as Array<Record<string, unknown>>;
  }

  async consumeQuote(quoteId: string, openingId: string): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE savings_quotes
       SET consumed_at = NOW()
       WHERE id = $1 AND consumed_at IS NULL
       RETURNING id`,
      [requireUuid(quoteId, "quoteId"), requireUuid(openingId, "openingId")],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async reserveIdempotency(input: {
    id: string;
    customerId: string;
    operationType: string;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<{ created: boolean; record: Record<string, unknown> }> {
    const inserted = await this.client.query(
      `INSERT INTO savings_idempotency
        (id, customer_id, operation_type, idempotency_key, request_fingerprint, status)
       VALUES ($1, $2, $3, $4, $5, 'PENDING')
       ON CONFLICT (customer_id, operation_type, idempotency_key) DO NOTHING
       RETURNING *`,
      [requireUuid(input.id), requireUuid(input.customerId, "customerId"), input.operationType, input.idempotencyKey, input.requestFingerprint],
    );
    if (inserted.rows[0]) return { created: true, record: inserted.rows[0] as Record<string, unknown> };
    const existing = await this.client.query(
      `SELECT * FROM savings_idempotency
       WHERE customer_id = $1 AND operation_type = $2 AND idempotency_key = $3
       FOR UPDATE`,
      [requireUuid(input.customerId, "customerId"), input.operationType, input.idempotencyKey],
    );
    if (!existing.rows[0]) throw new Error("Savings idempotency record disappeared after conflict.");
    return { created: false, record: existing.rows[0] as Record<string, unknown> };
  }

  async completeIdempotency(
    customerId: string,
    operationType: string,
    idempotencyKey: string,
    input: { openingId?: string | null; status: string; responsePayload: unknown },
  ): Promise<void> {
    await this.client.query(
      `UPDATE savings_idempotency
       SET opening_id = $4, status = $5, response_payload = $6::jsonb, updated_at = NOW()
       WHERE customer_id = $1 AND operation_type = $2 AND idempotency_key = $3`,
      [requireUuid(customerId, "customerId"), operationType, idempotencyKey, input.openingId ? requireUuid(input.openingId, "openingId") : null, input.status, JSON.stringify(input.responsePayload)],
    );
  }

  async createMaturityOperation(input: {
    id: string;
    depositId: string;
    operationKey: string;
    status?: "PENDING" | "SUCCEEDED" | "FAILED";
  }): Promise<Record<string, unknown>> {
    const result = await this.client.query(
      `INSERT INTO savings_maturity_operations (id, deposit_id, operation_key, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (deposit_id, operation_key) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [requireUuid(input.id), requireUuid(input.depositId, "depositId"), input.operationKey, input.status ?? "PENDING"],
    );
    return result.rows[0] as Record<string, unknown>;
  }
}

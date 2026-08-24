import type { PoolClient } from "pg";

import { requireUuid } from "../rowMappers.js";

export class CreditRepository {
  constructor(private readonly client: PoolClient) {}

  async lockPaymentQuote(quoteId: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.query("SELECT * FROM credit_payment_quotes WHERE id = $1 FOR UPDATE", [requireUuid(quoteId, "quoteId")]);
    return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  async lockCreditAccount(creditAccountId: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.query("SELECT * FROM credit_accounts WHERE id = $1 FOR UPDATE", [requireUuid(creditAccountId, "creditAccountId")]);
    return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  async lockStatement(statementId: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.query("SELECT * FROM credit_statements WHERE id = $1 FOR UPDATE", [requireUuid(statementId, "statementId")]);
    return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  async findPaymentByIdempotency(customerId: string, key: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.query("SELECT * FROM credit_payments WHERE customer_id = $1 AND idempotency_key = $2", [requireUuid(customerId, "customerId"), key]);
    return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  async consumePaymentQuote(quoteId: string): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE credit_payment_quotes
       SET consumed_at = NOW()
       WHERE id = $1 AND consumed_at IS NULL
       RETURNING id`,
      [requireUuid(quoteId, "quoteId")],
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
      `INSERT INTO credit_idempotency
        (id, customer_id, operation_type, idempotency_key, request_fingerprint, status)
       VALUES ($1, $2, $3, $4, $5, 'PENDING')
       ON CONFLICT (customer_id, operation_type, idempotency_key) DO NOTHING
       RETURNING *`,
      [requireUuid(input.id), requireUuid(input.customerId, "customerId"), input.operationType, input.idempotencyKey, input.requestFingerprint],
    );
    if (inserted.rows[0]) return { created: true, record: inserted.rows[0] as Record<string, unknown> };
    const existing = await this.client.query(
      `SELECT * FROM credit_idempotency
       WHERE customer_id = $1 AND operation_type = $2 AND idempotency_key = $3
       FOR UPDATE`,
      [requireUuid(input.customerId, "customerId"), input.operationType, input.idempotencyKey],
    );
    if (!existing.rows[0]) throw new Error("Credit idempotency record disappeared after conflict.");
    return { created: false, record: existing.rows[0] as Record<string, unknown> };
  }

  async completeIdempotency(
    customerId: string,
    operationType: string,
    idempotencyKey: string,
    input: { paymentId?: string | null; status: string; responsePayload: unknown },
  ): Promise<void> {
    await this.client.query(
      `UPDATE credit_idempotency
       SET payment_id = $4, status = $5, response_payload = $6::jsonb, updated_at = NOW()
       WHERE customer_id = $1 AND operation_type = $2 AND idempotency_key = $3`,
      [requireUuid(customerId, "customerId"), operationType, idempotencyKey, input.paymentId ? requireUuid(input.paymentId, "paymentId") : null, input.status, JSON.stringify(input.responsePayload)],
    );
  }

  async updateCreditAccount(
    creditAccountId: string,
    input: { postedOutstandingMinor: string; pendingAuthorizationsMinor: string; version: string },
  ): Promise<Record<string, unknown>> {
    const result = await this.client.query(
      `UPDATE credit_accounts
       SET posted_outstanding_minor = $2,
           pending_authorizations_minor = $3,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $1 AND version = $4
         AND posted_outstanding_minor >= 0
         AND pending_authorizations_minor >= 0
       RETURNING *`,
      [requireUuid(creditAccountId, "creditAccountId"), input.postedOutstandingMinor, input.pendingAuthorizationsMinor, input.version],
    );
    if (!result.rows[0]) throw new Error("Credit account optimistic update affected no row.");
    return result.rows[0] as Record<string, unknown>;
  }
}

import type { PoolClient } from "pg";

import { requireUuid } from "../rowMappers.js";

export class CreditRepository {
  constructor(private readonly client: PoolClient) {}

  async listApplications(customerId: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.client.query(
      "SELECT * FROM credit_applications WHERE customer_id = $1 ORDER BY created_at DESC, id",
      [requireUuid(customerId, "customerId")],
    );
    return result.rows as Array<Record<string, unknown>>;
  }

  async findApplication(customerId: string, applicationId: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.query(
      "SELECT * FROM credit_applications WHERE customer_id = $1 AND id = $2",
      [requireUuid(customerId, "customerId"), requireUuid(applicationId, "applicationId")],
    );
    return result.rows[0] ? result.rows[0] as Record<string, unknown> : null;
  }

  async lockApplication(applicationId: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.query("SELECT * FROM credit_applications WHERE id = $1 FOR UPDATE", [requireUuid(applicationId, "applicationId")]);
    return result.rows[0] ? result.rows[0] as Record<string, unknown> : null;
  }

  async createApplication(input: {
    id: string; customerId: string; requestedLimitMinor: string; requestFingerprint: string;
  }): Promise<Record<string, unknown>> {
    const result = await this.client.query(
      `INSERT INTO credit_applications
        (id, customer_id, status, requested_limit_minor, request_fingerprint,
         version, created_at, updated_at)
       VALUES ($1, $2, 'SUBMITTED', $3, $4, 1, NOW(), NOW()) RETURNING *`,
      [requireUuid(input.id), requireUuid(input.customerId, "customerId"), input.requestedLimitMinor, input.requestFingerprint],
    );
    return result.rows[0] as Record<string, unknown>;
  }

  async activateApplication(input: { applicationId: string; creditAccountId: string; approvedLimitMinor: string }): Promise<Record<string, unknown>> {
    const result = await this.client.query(
      `UPDATE credit_applications
       SET status = 'ACTIVE', approved_limit_minor = $2, credit_account_id = $3,
           activated_at = NOW(),
           decision_at = COALESCE(decision_at, NOW()), version = version + 1,
           updated_at = NOW()
       WHERE id = $1 AND status = 'PENDING_ACTIVATION'
       RETURNING *`,
      [requireUuid(input.applicationId, "applicationId"), input.approvedLimitMinor, requireUuid(input.creditAccountId, "creditAccountId")],
    );
    if (!result.rows[0]) throw new Error("Credit application activation affected no row.");
    return result.rows[0] as Record<string, unknown>;
  }

  async lockPaymentQuote(quoteId: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.query("SELECT * FROM credit_payment_quotes WHERE id = $1 FOR UPDATE", [requireUuid(quoteId, "quoteId")]);
    return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  async findPaymentQuote(customerId: string, quoteId: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.query(
      `SELECT q.*, source.masked_number AS source_account_masked_number,
              ca.posted_outstanding_minor, ca.credit_limit_minor,
              ca.pending_authorizations_minor, ca.status AS credit_account_status,
              ca.customer_id AS credit_customer_id, ca.version AS credit_account_version,
              cc.last_four, cc.status AS card_status,
              s.version AS current_statement_version
       FROM credit_payment_quotes q
       JOIN payment_accounts source ON source.id = q.source_account_id
       JOIN credit_accounts ca ON ca.id = q.credit_account_id
       JOIN credit_cards cc ON cc.credit_account_id = q.credit_account_id
       JOIN credit_statements s ON s.id = q.statement_id
       WHERE q.customer_id = $1 AND q.id = $2`,
      [requireUuid(customerId, "customerId"), requireUuid(quoteId, "quoteId")],
    );
    return result.rows[0] ? result.rows[0] as Record<string, unknown> : null;
  }

  async createPaymentQuote(input: {
    id: string; customerId: string; sourceAccountId: string; creditAccountId: string;
    statementId: string; statementVersion: string; paymentOption: string; amountMinor: string;
    feeMinor: string; requestFingerprint: string; expiresAt: string;
  }): Promise<Record<string, unknown>> {
    const result = await this.client.query(
      `INSERT INTO credit_payment_quotes
        (id, customer_id, source_account_id, credit_account_id, statement_id,
         statement_version, payment_option, amount_minor, fee_minor, request_fingerprint,
         expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()) RETURNING *`,
      [requireUuid(input.id), requireUuid(input.customerId, "customerId"), requireUuid(input.sourceAccountId, "sourceAccountId"), requireUuid(input.creditAccountId, "creditAccountId"), requireUuid(input.statementId, "statementId"), input.statementVersion, input.paymentOption, input.amountMinor, input.feeMinor, input.requestFingerprint, input.expiresAt],
    );
    return result.rows[0] as Record<string, unknown>;
  }

  async listCreditAccounts(customerId: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.client.query("SELECT * FROM credit_accounts WHERE customer_id = $1 ORDER BY id", [requireUuid(customerId, "customerId")]);
    return result.rows as Array<Record<string, unknown>>;
  }

  async findCreditAccount(customerId: string, creditAccountId: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.query("SELECT * FROM credit_accounts WHERE customer_id = $1 AND id = $2", [requireUuid(customerId, "customerId"), requireUuid(creditAccountId, "creditAccountId")]);
    return result.rows[0] ? result.rows[0] as Record<string, unknown> : null;
  }

  async listCards(customerId: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.client.query(
      `SELECT c.*, ca.currency, ca.credit_limit_minor, ca.posted_outstanding_minor,
              ca.pending_authorizations_minor, ca.next_statement_at,
              ca.status AS credit_account_status, ca.version AS credit_account_version,
              ca.updated_at AS credit_account_updated_at
       FROM credit_cards c JOIN credit_accounts ca ON ca.id = c.credit_account_id
       WHERE c.customer_id = $1 ORDER BY c.display_name, c.id`,
      [requireUuid(customerId, "customerId")],
    );
    return result.rows as Array<Record<string, unknown>>;
  }

  async findCard(customerId: string, cardId: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.query(
      `SELECT c.*, ca.currency, ca.credit_limit_minor, ca.posted_outstanding_minor,
              ca.pending_authorizations_minor, ca.next_statement_at,
              ca.status AS credit_account_status, ca.version AS credit_account_version,
              ca.updated_at AS credit_account_updated_at
       FROM credit_cards c JOIN credit_accounts ca ON ca.id = c.credit_account_id
       WHERE c.customer_id = $1 AND c.id = $2`,
      [requireUuid(customerId, "customerId"), requireUuid(cardId, "cardId")],
    );
    return result.rows[0] ? result.rows[0] as Record<string, unknown> : null;
  }

  async lockCard(customerId: string, cardId: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.query(
      `SELECT c.*, ca.currency, ca.credit_limit_minor, ca.posted_outstanding_minor,
              ca.pending_authorizations_minor, ca.next_statement_at,
              ca.status AS credit_account_status, ca.version AS credit_account_version,
              ca.updated_at AS credit_account_updated_at
       FROM credit_cards c JOIN credit_accounts ca ON ca.id = c.credit_account_id
       WHERE c.customer_id = $1 AND c.id = $2
       FOR UPDATE OF c, ca`,
      [requireUuid(customerId, "customerId"), requireUuid(cardId, "cardId")],
    );
    return result.rows[0] ? result.rows[0] as Record<string, unknown> : null;
  }

  async updateCardStatus(customerId: string, cardId: string, status: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.query(
      "UPDATE credit_cards SET status = $3, updated_at = NOW() WHERE customer_id = $1 AND id = $2 RETURNING *",
      [requireUuid(customerId, "customerId"), requireUuid(cardId, "cardId"), status],
    );
    return result.rows[0] ? result.rows[0] as Record<string, unknown> : null;
  }

  async listTransactions(customerId: string, creditAccountId: string, cursor?: { occurredAt: string; id: string } | null, limit = 101): Promise<Array<Record<string, unknown>>> {
    const result = await this.client.query(
      `SELECT t.* FROM credit_transactions t
       JOIN credit_accounts ca ON ca.id = t.credit_account_id
       WHERE ca.customer_id = $1 AND t.credit_account_id = $2
         AND ($3::timestamptz IS NULL
           OR t.occurred_at < $3::timestamptz
           OR (t.occurred_at = $3::timestamptz AND t.id < $4::uuid))
       ORDER BY t.occurred_at DESC, t.id DESC
       LIMIT $5`,
      [requireUuid(customerId, "customerId"), requireUuid(creditAccountId, "creditAccountId"), cursor?.occurredAt ?? null, cursor?.id ?? null, limit],
    );
    return result.rows as Array<Record<string, unknown>>;
  }

  async listStatements(customerId: string, creditAccountId: string, cursor?: { issuedAt: string; id: string } | null, limit = 101): Promise<Array<Record<string, unknown>>> {
    const result = await this.client.query(
      `SELECT s.* FROM credit_statements s
       JOIN credit_accounts ca ON ca.id = s.credit_account_id
       WHERE ca.customer_id = $1 AND s.credit_account_id = $2
         AND ($3::timestamptz IS NULL
           OR s.issued_at < $3::timestamptz
           OR (s.issued_at = $3::timestamptz AND s.id < $4::uuid))
       ORDER BY s.issued_at DESC, s.id DESC
       LIMIT $5`,
      [requireUuid(customerId, "customerId"), requireUuid(creditAccountId, "creditAccountId"), cursor?.issuedAt ?? null, cursor?.id ?? null, limit],
    );
    return result.rows as Array<Record<string, unknown>>;
  }

  async findStatement(customerId: string, creditAccountId: string, statementId: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.query(
      `SELECT s.* FROM credit_statements s
       JOIN credit_accounts ca ON ca.id = s.credit_account_id
       WHERE ca.customer_id = $1 AND s.credit_account_id = $2 AND s.id = $3`,
      [requireUuid(customerId, "customerId"), requireUuid(creditAccountId, "creditAccountId"), requireUuid(statementId, "statementId")],
    );
    return result.rows[0] ? result.rows[0] as Record<string, unknown> : null;
  }

  async listStatementItems(statementId: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.client.query(
      `SELECT t.* FROM credit_statement_items i
       JOIN credit_transactions t ON t.id = i.transaction_id
       WHERE i.statement_id = $1 ORDER BY t.occurred_at, t.id`,
      [requireUuid(statementId, "statementId")],
    );
    return result.rows as Array<Record<string, unknown>>;
  }

  async listPaymentsForStatement(statementId: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.client.query("SELECT * FROM credit_payments WHERE statement_id = $1 ORDER BY created_at, id", [requireUuid(statementId, "statementId")]);
    return result.rows as Array<Record<string, unknown>>;
  }

  async createCreditAccount(input: { id: string; customerId: string; limitMinor: string; currentCycleStartAt: string; nextStatementAt: string }): Promise<Record<string, unknown>> {
    const result = await this.client.query(
      `INSERT INTO credit_accounts
        (id, customer_id, currency, credit_limit_minor, posted_outstanding_minor,
        pending_authorizations_minor, current_cycle_start_at, next_statement_at,
        status, version, updated_at)
       VALUES ($1, $2, 'VND', $3, 0, 0, $4, $5, 'ACTIVE', 0, NOW()) RETURNING *`,
      [requireUuid(input.id), requireUuid(input.customerId, "customerId"), input.limitMinor, input.currentCycleStartAt, input.nextStatementAt],
    );
    return result.rows[0] as Record<string, unknown>;
  }

  async createCard(input: { id: string; customerId: string; creditAccountId: string; now: string }): Promise<Record<string, unknown>> {
    const expiry = new Date(Date.parse(input.now));
    expiry.setUTCFullYear(expiry.getUTCFullYear() + 3);
    const result = await this.client.query(
      `INSERT INTO credit_cards
        (id, credit_account_id, customer_id, display_name, brand,
         masked_number, last_four, expiry_month, expiry_year, status, updated_at)
       VALUES ($1, $2, $3, 'Reference Sandbox Card', 'VISA',
               '•••• •••• •••• 2468', '2468', $4, $5, 'ACTIVE', $6)
       RETURNING *`,
      [requireUuid(input.id), requireUuid(input.creditAccountId, "creditAccountId"), requireUuid(input.customerId, "customerId"), expiry.getUTCMonth() + 1, expiry.getUTCFullYear(), input.now],
    );
    return result.rows[0] as Record<string, unknown>;
  }

  async createStatement(input: { id: string; creditAccountId: string; cycleStartAt: string; cycleEndAt: string; issuedAt: string; dueAt: string }): Promise<Record<string, unknown>> {
    const result = await this.client.query(
      `INSERT INTO credit_statements
        (id, credit_account_id, cycle_start_at, cycle_end_at, issued_at, due_at,
         opening_balance_minor, purchase_total_minor, refund_total_minor,
         fee_total_minor, interest_total_minor, closing_balance_minor,
         remaining_amount_due_minor, minimum_payment_due_minor,
         minimum_payment_remaining_minor, paid_amount_minor, status, version)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'PAID', 1)
       RETURNING *`,
      [requireUuid(input.id), requireUuid(input.creditAccountId, "creditAccountId"), input.cycleStartAt, input.cycleEndAt, input.issuedAt, input.dueAt],
    );
    return result.rows[0] as Record<string, unknown>;
  }

  async createPayment(input: { id: string; customerId: string; quoteId: string; creditAccountId: string; statementId: string; sourceAccountId: string; idempotencyKey: string; requestFingerprint: string; reference: string; amountMinor: string }): Promise<Record<string, unknown>> {
    const result = await this.client.query(
      `INSERT INTO credit_payments
        (id, customer_id, quote_id, credit_account_id, statement_id,
         source_account_id, idempotency_key, request_fingerprint, reference,
         amount_minor, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'SUCCEEDED', NOW(), NOW()) RETURNING *`,
      [requireUuid(input.id), requireUuid(input.customerId, "customerId"), requireUuid(input.quoteId, "quoteId"), requireUuid(input.creditAccountId, "creditAccountId"), requireUuid(input.statementId, "statementId"), requireUuid(input.sourceAccountId, "sourceAccountId"), input.idempotencyKey, input.requestFingerprint, input.reference, input.amountMinor],
    );
    return result.rows[0] as Record<string, unknown>;
  }

  async createTransaction(input: { id: string; creditAccountId: string; statementId: string; amountMinor: string; description: string; occurredAt: string }): Promise<void> {
    await this.client.query(
      `INSERT INTO credit_transactions
        (id, credit_account_id, statement_id, type, status, description,
         merchant_name, amount_minor, debt_effect, occurred_at, posted_at)
       VALUES ($1, $2, $3, 'PAYMENT', 'POSTED', $4, NULL, $5, 'DECREASE', $6, $6)`,
      [requireUuid(input.id), requireUuid(input.creditAccountId, "creditAccountId"), requireUuid(input.statementId, "statementId"), input.description, input.amountMinor, input.occurredAt],
    );
    await this.client.query("INSERT INTO credit_statement_items (statement_id, transaction_id) VALUES ($1, $2)", [requireUuid(input.statementId, "statementId"), requireUuid(input.id, "transactionId")]);
  }

  async updateStatementPayment(statementId: string, amountMinor: string): Promise<Record<string, unknown>> {
    const result = await this.client.query(
      `UPDATE credit_statements
       SET remaining_amount_due_minor = remaining_amount_due_minor - $2,
           minimum_payment_remaining_minor = GREATEST(0, minimum_payment_remaining_minor - $2),
           paid_amount_minor = paid_amount_minor + $2,
           status = CASE WHEN remaining_amount_due_minor - $2 <= 0 THEN 'PAID'
                         WHEN paid_amount_minor + $2 > 0 THEN 'PARTIALLY_PAID' ELSE status END,
           version = version + 1
       WHERE id = $1 AND remaining_amount_due_minor >= $2
       RETURNING *`,
      [requireUuid(statementId, "statementId"), amountMinor],
    );
    if (!result.rows[0]) throw new Error("Credit statement payment update affected no row.");
    return result.rows[0] as Record<string, unknown>;
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
    input: { paymentId?: string | null; applicationId?: string | null; status: string; responsePayload: unknown },
  ): Promise<void> {
    await this.client.query(
      `UPDATE credit_idempotency
       SET payment_id = $4, application_id = $5, status = $6, response_payload = $7::jsonb, updated_at = NOW()
       WHERE customer_id = $1 AND operation_type = $2 AND idempotency_key = $3`,
      [requireUuid(customerId, "customerId"), operationType, idempotencyKey, input.paymentId ? requireUuid(input.paymentId, "paymentId") : null, input.applicationId ? requireUuid(input.applicationId, "applicationId") : null, input.status, JSON.stringify(input.responsePayload)],
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

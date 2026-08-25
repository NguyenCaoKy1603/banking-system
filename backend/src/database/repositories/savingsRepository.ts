import type { PoolClient } from "pg";

import { asBigIntString, asIso, asNullableIso, asString, requireUuid } from "../rowMappers.js";

export type SavingsProductRow = {
  id: string;
  productCode: string;
  name: string;
  termMonths: 1 | 3 | 6 | 12;
  annualRateBasisPoints: number;
  minAmountMinor: string;
  maxAmountMinor: string;
  status: "ACTIVE" | "INACTIVE";
  termsVersion: string;
};

export type SavingsQuoteRow = {
  id: string;
  customerId: string;
  sourceAccountId: string;
  sourceAccountMaskedNumber: string;
  productId: string;
  productCode: string;
  productName: string;
  principalMinor: string;
  annualRateBasisPoints: number;
  interestDays: number;
  expectedInterestMinor: string;
  totalAtMaturityMinor: string;
  currency: "VND";
  termMonths: 1 | 3 | 6 | 12;
  maturityInstruction: "RETURN_PRINCIPAL_AND_INTEREST" | "RENEW_PRINCIPAL" | "RENEW_PRINCIPAL_AND_INTEREST";
  termsVersion: string;
  openedAt: string;
  maturityAt: string;
  expiresAt: string;
  consumedAt: string | null;
  requestFingerprint: string;
};

export type SavingsOpeningRow = {
  id: string;
  customerId: string;
  quoteId: string;
  depositId: string | null;
  idempotencyKey: string;
  requestFingerprint: string;
  reference: string | null;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "REVERSED";
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SavingsDepositRow = {
  id: string;
  customerId: string;
  openingId: string;
  sourceAccountId: string;
  sourceAccountMaskedNumber: string;
  productId: string;
  productCode: string;
  productName: string;
  principalMinor: string;
  annualRateBasisPoints: number;
  expectedInterestMinor: string;
  totalAtMaturityMinor: string;
  currency: "VND";
  termMonths: 1 | 3 | 6 | 12;
  maturityInstruction: "RETURN_PRINCIPAL_AND_INTEREST" | "RENEW_PRINCIPAL" | "RENEW_PRINCIPAL_AND_INTEREST";
  termsVersion: string;
  reference: string;
  openedAt: string;
  maturityAt: string;
  status: "ACTIVE" | "MATURED" | "CLOSED";
  renewedDepositId: string | null;
  maturityOperationKey: string | null;
  renewalSequence: number;
  updatedAt: string;
};

function productFromRow(row: Record<string, unknown>): SavingsProductRow {
  return {
    id: requireUuid(row.id),
    productCode: asString(row.product_code, "product"),
    name: asString(row.name),
    termMonths: Number(row.term_months) as SavingsProductRow["termMonths"],
    annualRateBasisPoints: Number(row.annual_rate_basis_points),
    minAmountMinor: asBigIntString(row.min_amount_minor, "min_amount_minor"),
    maxAmountMinor: asBigIntString(row.max_amount_minor, "max_amount_minor"),
    status: asString(row.status) as SavingsProductRow["status"],
    termsVersion: asString(row.terms_version),
  };
}

function quoteFromRow(row: Record<string, unknown>): SavingsQuoteRow {
  return {
    id: requireUuid(row.id),
    customerId: requireUuid(row.customer_id, "customer_id"),
    sourceAccountId: requireUuid(row.source_account_id, "source_account_id"),
    sourceAccountMaskedNumber: asString(row.source_account_masked_number, "••••"),
    productId: requireUuid(row.product_id, "product_id"),
    productCode: asString(row.product_code),
    productName: asString(row.product_name),
    principalMinor: asBigIntString(row.principal_minor, "principal_minor"),
    annualRateBasisPoints: Number(row.annual_rate_basis_points),
    interestDays: Number(row.interest_days),
    expectedInterestMinor: asBigIntString(row.expected_interest_minor, "expected_interest_minor"),
    totalAtMaturityMinor: asBigIntString(row.total_at_maturity_minor, "total_at_maturity_minor"),
    currency: asString(row.currency, "VND") as "VND",
    termMonths: Number(row.term_months) as SavingsQuoteRow["termMonths"],
    maturityInstruction: asString(row.maturity_instruction) as SavingsQuoteRow["maturityInstruction"],
    termsVersion: asString(row.terms_version),
    openedAt: asIso(row.opened_at, "opened_at"),
    maturityAt: asIso(row.maturity_at, "maturity_at"),
    expiresAt: asIso(row.expires_at, "expires_at"),
    consumedAt: asNullableIso(row.consumed_at, "consumed_at"),
    requestFingerprint: asString(row.request_fingerprint),
  };
}

function openingFromRow(row: Record<string, unknown>): SavingsOpeningRow {
  return {
    id: requireUuid(row.id),
    customerId: requireUuid(row.customer_id, "customer_id"),
    quoteId: requireUuid(row.quote_id, "quote_id"),
    depositId: row.deposit_id === null || row.deposit_id === undefined ? null : requireUuid(row.deposit_id, "deposit_id"),
    idempotencyKey: asString(row.idempotency_key),
    requestFingerprint: asString(row.request_fingerprint),
    reference: row.reference === null || row.reference === undefined ? null : asString(row.reference),
    status: asString(row.status) as SavingsOpeningRow["status"],
    failureReason: row.failure_reason === null || row.failure_reason === undefined ? null : asString(row.failure_reason),
    createdAt: asIso(row.created_at, "created_at"),
    updatedAt: asIso(row.updated_at, "updated_at"),
  };
}

function depositFromRow(row: Record<string, unknown>): SavingsDepositRow {
  return {
    id: requireUuid(row.id),
    customerId: requireUuid(row.customer_id, "customer_id"),
    openingId: requireUuid(row.opening_id, "opening_id"),
    sourceAccountId: requireUuid(row.source_account_id, "source_account_id"),
    sourceAccountMaskedNumber: asString(row.source_account_masked_number, "••••"),
    productId: requireUuid(row.product_id, "product_id"),
    productCode: asString(row.product_code),
    productName: asString(row.product_name),
    principalMinor: asBigIntString(row.principal_minor, "principal_minor"),
    annualRateBasisPoints: Number(row.annual_rate_basis_points),
    expectedInterestMinor: asBigIntString(row.expected_interest_minor, "expected_interest_minor"),
    totalAtMaturityMinor: asBigIntString(row.total_at_maturity_minor, "total_at_maturity_minor"),
    currency: asString(row.currency, "VND") as "VND",
    termMonths: Number(row.term_months) as SavingsDepositRow["termMonths"],
    maturityInstruction: asString(row.maturity_instruction) as SavingsDepositRow["maturityInstruction"],
    termsVersion: asString(row.terms_version),
    reference: asString(row.reference),
    openedAt: asIso(row.opened_at, "opened_at"),
    maturityAt: asIso(row.maturity_at, "maturity_at"),
    status: asString(row.status) as SavingsDepositRow["status"],
    renewedDepositId: row.renewed_deposit_id === null || row.renewed_deposit_id === undefined ? null : requireUuid(row.renewed_deposit_id, "renewed_deposit_id"),
    maturityOperationKey: row.maturity_operation_key === null || row.maturity_operation_key === undefined ? null : asString(row.maturity_operation_key),
    renewalSequence: Number(row.renewal_sequence ?? 0),
    updatedAt: asIso(row.updated_at, "updated_at"),
  };
}

export class SavingsRepository {
  constructor(private readonly client: PoolClient) {}

  async listProducts(): Promise<SavingsProductRow[]> {
    const result = await this.client.query("SELECT * FROM savings_products ORDER BY term_months, product_code");
    return result.rows.map((row) => productFromRow(row as Record<string, unknown>));
  }

  async findActiveProduct(productCode: string): Promise<SavingsProductRow | null> {
    const result = await this.client.query("SELECT * FROM savings_products WHERE product_code = $1 AND status = 'ACTIVE'", [productCode]);
    return result.rows[0] ? productFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  private quoteSelect(): string {
    return `SELECT q.*, p.product_code, p.name AS product_name,
                   a.masked_number AS source_account_masked_number
            FROM savings_quotes q
            JOIN savings_products p ON p.id = q.product_id
            JOIN payment_accounts a ON a.id = q.source_account_id`;
  }

  async createQuote(input: {
    id: string;
    customerId: string;
    sourceAccountId: string;
    productId: string;
    principalMinor: string;
    annualRateBasisPoints: number;
    interestDays: number;
    expectedInterestMinor: string;
    totalAtMaturityMinor: string;
    termMonths: number;
    maturityInstruction: string;
    termsVersion: string;
    openedAt: string;
    maturityAt: string;
    expiresAt: string;
    requestFingerprint: string;
  }): Promise<SavingsQuoteRow> {
    const result = await this.client.query(
      `INSERT INTO savings_quotes
         (id, customer_id, source_account_id, product_id, principal_minor,
          annual_rate_basis_points, interest_days, expected_interest_minor,
          total_at_maturity_minor, currency, term_months, maturity_instruction,
          terms_version, opened_at, maturity_at, expires_at, request_fingerprint,
          created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'VND', $10, $11, $12,
               $13, $14, $15, $16, NOW())
       RETURNING *`,
      [
        requireUuid(input.id), requireUuid(input.customerId, "customerId"), requireUuid(input.sourceAccountId, "sourceAccountId"),
        requireUuid(input.productId, "productId"), input.principalMinor, input.annualRateBasisPoints, input.interestDays,
        input.expectedInterestMinor, input.totalAtMaturityMinor, input.termMonths, input.maturityInstruction,
        input.termsVersion, input.openedAt, input.maturityAt, input.expiresAt, input.requestFingerprint,
      ],
    );
    const row = await this.client.query(`${this.quoteSelect()} WHERE q.id = $1`, [input.id]);
    return quoteFromRow(row.rows[0] as Record<string, unknown>);
  }

  async findQuote(quoteId: string): Promise<SavingsQuoteRow | null> {
    const result = await this.client.query(`${this.quoteSelect()} WHERE q.id = $1`, [requireUuid(quoteId, "quoteId")]);
    return result.rows[0] ? quoteFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async lockQuote(quoteId: string): Promise<SavingsQuoteRow | null> {
    const result = await this.client.query(`${this.quoteSelect()} WHERE q.id = $1 FOR UPDATE OF q`, [requireUuid(quoteId, "quoteId")]);
    return result.rows[0] ? quoteFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async findOpeningByIdempotency(customerId: string, key: string): Promise<SavingsOpeningRow | null> {
    const result = await this.client.query("SELECT * FROM savings_openings WHERE customer_id = $1 AND idempotency_key = $2", [requireUuid(customerId, "customerId"), key]);
    return result.rows[0] ? openingFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async findOpening(openingId: string, customerId?: string): Promise<SavingsOpeningRow | null> {
    const result = await this.client.query(
      "SELECT * FROM savings_openings WHERE id = $1 AND ($2::uuid IS NULL OR customer_id = $2)",
      [requireUuid(openingId, "openingId"), customerId ? requireUuid(customerId, "customerId") : null],
    );
    return result.rows[0] ? openingFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async lockDeposit(depositId: string): Promise<SavingsDepositRow | null> {
    const result = await this.client.query(
      `SELECT d.*, p.product_code, p.name AS product_name,
              a.masked_number AS source_account_masked_number
       FROM savings_deposits d
       JOIN savings_products p ON p.id = d.product_id
       JOIN payment_accounts a ON a.id = d.source_account_id
       WHERE d.id = $1 FOR UPDATE OF d`,
      [requireUuid(depositId, "depositId")],
    );
    return result.rows[0] ? depositFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  private depositSelect(): string {
    return `SELECT d.*, p.product_code, p.name AS product_name,
                   a.masked_number AS source_account_masked_number
            FROM savings_deposits d
            JOIN savings_products p ON p.id = d.product_id
            JOIN payment_accounts a ON a.id = d.source_account_id`;
  }

  async listDeposits(customerId: string): Promise<SavingsDepositRow[]> {
    const result = await this.client.query(`${this.depositSelect()} WHERE d.customer_id = $1 ORDER BY d.updated_at DESC, d.id`, [requireUuid(customerId, "customerId")]);
    return result.rows.map((row) => depositFromRow(row as Record<string, unknown>));
  }

  async findDeposit(customerId: string, depositId: string): Promise<SavingsDepositRow | null> {
    const result = await this.client.query(`${this.depositSelect()} WHERE d.customer_id = $1 AND d.id = $2`, [requireUuid(customerId, "customerId"), requireUuid(depositId, "depositId")]);
    return result.rows[0] ? depositFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async createOpening(input: {
    id: string; customerId: string; quoteId: string; depositId?: string | null; idempotencyKey: string;
    requestFingerprint: string; reference: string; status?: SavingsOpeningRow["status"];
  }): Promise<SavingsOpeningRow> {
    const result = await this.client.query(
      `INSERT INTO savings_openings
         (id, customer_id, quote_id, deposit_id, idempotency_key,
          request_fingerprint, reference, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()) RETURNING *`,
      [requireUuid(input.id), requireUuid(input.customerId, "customerId"), requireUuid(input.quoteId, "quoteId"), input.depositId ? requireUuid(input.depositId, "depositId") : null, input.idempotencyKey, input.requestFingerprint, input.reference, input.status ?? "PENDING"],
    );
    return openingFromRow(result.rows[0] as Record<string, unknown>);
  }

  async updateOpening(input: { id: string; status: SavingsOpeningRow["status"]; depositId?: string | null; reference?: string | null; failureReason?: string | null }): Promise<SavingsOpeningRow> {
    const result = await this.client.query(
      `UPDATE savings_openings
       SET status = $2, deposit_id = COALESCE($3::uuid, deposit_id),
           reference = COALESCE($4, reference), failure_reason = $5, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [requireUuid(input.id, "openingId"), input.status, input.depositId ? requireUuid(input.depositId, "depositId") : null, input.reference ?? null, input.failureReason ?? null],
    );
    if (!result.rows[0]) throw new Error("Savings opening update affected no row.");
    return openingFromRow(result.rows[0] as Record<string, unknown>);
  }

  async createDeposit(input: {
    id: string; customerId: string; openingId: string; sourceAccountId: string; productId: string;
    principalMinor: string; annualRateBasisPoints: number; expectedInterestMinor: string;
    totalAtMaturityMinor: string; termMonths: number; maturityInstruction: string; termsVersion: string;
    reference: string; openedAt: string; maturityAt: string; status?: SavingsDepositRow["status"];
    maturityOperationKey?: string | null; renewalSequence?: number;
  }): Promise<SavingsDepositRow> {
    const result = await this.client.query(
      `INSERT INTO savings_deposits
         (id, customer_id, opening_id, source_account_id, product_id,
          principal_minor, annual_rate_basis_points, expected_interest_minor,
          total_at_maturity_minor, currency, term_months, maturity_instruction,
          terms_version, reference, opened_at, maturity_at, status,
          maturity_operation_key, renewal_sequence, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'VND', $10, $11, $12,
               $13, $14, $15, $16, $17, $18, NOW(), NOW()) RETURNING *`,
      [requireUuid(input.id), requireUuid(input.customerId, "customerId"), requireUuid(input.openingId, "openingId"), requireUuid(input.sourceAccountId, "sourceAccountId"), requireUuid(input.productId, "productId"), input.principalMinor, input.annualRateBasisPoints, input.expectedInterestMinor, input.totalAtMaturityMinor, input.termMonths, input.maturityInstruction, input.termsVersion, input.reference, input.openedAt, input.maturityAt, input.status ?? "ACTIVE", input.maturityOperationKey ?? null, input.renewalSequence ?? 0],
    );
    const mapped = await this.findDeposit(input.customerId, input.id);
    if (!mapped) throw new Error("Savings deposit insert could not be reloaded.");
    return mapped;
  }

  async updateDeposit(input: { id: string; status: SavingsDepositRow["status"]; renewedDepositId?: string | null; maturityOperationKey?: string | null }): Promise<SavingsDepositRow> {
    await this.client.query(
      `UPDATE savings_deposits
       SET status = $2, renewed_deposit_id = $3::uuid,
           maturity_operation_key = COALESCE($4, maturity_operation_key), updated_at = NOW()
       WHERE id = $1`,
      [requireUuid(input.id, "depositId"), input.status, input.renewedDepositId ? requireUuid(input.renewedDepositId, "renewedDepositId") : null, input.maturityOperationKey ?? null],
    );
    const result = await this.client.query(`${this.depositSelect()} WHERE d.id = $1`, [input.id]);
    if (!result.rows[0]) throw new Error("Savings deposit update affected no row.");
    return depositFromRow(result.rows[0] as Record<string, unknown>);
  }

  async consumeQuote(quoteId: string, _openingId: string): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE savings_quotes
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

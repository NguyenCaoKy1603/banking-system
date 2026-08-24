import type { PoolClient } from "pg";

import { asBigIntString, asIso, asNullableIso, asString, requireUuid } from "../rowMappers.js";

export type CommandIdempotencyRow = {
  id: string;
  customerId: string;
  operationType: string;
  idempotencyKey: string;
  requestFingerprint: string;
  aggregateId: string | null;
  status: string;
  responsePayload: unknown;
  createdAt: string;
  updatedAt: string;
};

export type TransferRow = {
  id: string;
  customerId: string;
  sourceAccountId: string;
  quoteId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  reference: string;
  amountMinor: string;
  feeMinor: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "REVERSED";
  destinationAccountId: string | null;
  destinationOwnerId: string | null;
  sourceTransactionId: string | null;
  destinationTransactionId: string | null;
  ledgerJournalId: string | null;
  refunded: boolean;
  heldMinor: string;
  createdAt: string;
  updatedAt: string;
};

export type TransferQuoteRow = {
  id: string;
  customerId: string;
  sourceAccountId: string;
  beneficiaryId: string | null;
  amountMinor: string;
  feeMinor: string;
  expiresAt: string;
  consumedAt: string | null;
  requestFingerprint: string;
  consumedTransferId: string | null;
  destinationAccountId: string | null;
  destinationOwnerId: string | null;
};

function mapQuote(row: Record<string, unknown>): TransferQuoteRow {
  return {
    id: requireUuid(row.id),
    customerId: requireUuid(row.customer_id, "customer_id"),
    sourceAccountId: requireUuid(row.source_account_id, "source_account_id"),
    beneficiaryId: row.beneficiary_id ? requireUuid(row.beneficiary_id, "beneficiary_id") : null,
    amountMinor: asBigIntString(row.amount_minor, "amount_minor"),
    feeMinor: asBigIntString(row.fee_minor, "fee_minor"),
    expiresAt: asIso(row.expires_at, "expires_at"),
    consumedAt: asNullableIso(row.consumed_at, "consumed_at"),
    requestFingerprint: asString(row.request_fingerprint),
    consumedTransferId: row.consumed_transfer_id ? requireUuid(row.consumed_transfer_id, "consumed_transfer_id") : null,
    destinationAccountId: row.destination_account_id ? requireUuid(row.destination_account_id, "destination_account_id") : null,
    destinationOwnerId: row.destination_owner_id ? requireUuid(row.destination_owner_id, "destination_owner_id") : null,
  };
}

function mapTransfer(row: Record<string, unknown>): TransferRow {
  return {
    id: requireUuid(row.id),
    customerId: requireUuid(row.customer_id, "customer_id"),
    sourceAccountId: requireUuid(row.source_account_id, "source_account_id"),
    quoteId: requireUuid(row.quote_id, "quote_id"),
    idempotencyKey: asString(row.idempotency_key),
    requestFingerprint: asString(row.request_fingerprint),
    reference: asString(row.reference),
    amountMinor: asBigIntString(row.amount_minor, "amount_minor"),
    feeMinor: asBigIntString(row.fee_minor, "fee_minor"),
    status: asString(row.status) as TransferRow["status"],
    destinationAccountId: row.destination_account_id ? requireUuid(row.destination_account_id, "destination_account_id") : null,
    destinationOwnerId: row.destination_owner_id ? requireUuid(row.destination_owner_id, "destination_owner_id") : null,
    sourceTransactionId: row.source_transaction_id ? requireUuid(row.source_transaction_id, "source_transaction_id") : null,
    destinationTransactionId: row.destination_transaction_id ? requireUuid(row.destination_transaction_id, "destination_transaction_id") : null,
    ledgerJournalId: row.ledger_journal_id ? requireUuid(row.ledger_journal_id, "ledger_journal_id") : null,
    refunded: Boolean(row.refunded),
    heldMinor: asBigIntString(row.held_minor ?? "0", "held_minor"),
    createdAt: asIso(row.created_at, "created_at"),
    updatedAt: asIso(row.updated_at, "updated_at"),
  };
}

function mapIdempotency(row: Record<string, unknown>): CommandIdempotencyRow {
  return {
    id: requireUuid(row.id),
    customerId: requireUuid(row.customer_id, "customer_id"),
    operationType: asString(row.operation_type),
    idempotencyKey: asString(row.idempotency_key),
    requestFingerprint: asString(row.request_fingerprint),
    aggregateId: row.aggregate_id === null || row.aggregate_id === undefined ? null : asString(row.aggregate_id),
    status: asString(row.status),
    responsePayload: row.response_payload,
    createdAt: asIso(row.created_at, "created_at"),
    updatedAt: asIso(row.updated_at, "updated_at"),
  };
}

export class TransferRepository {
  constructor(private readonly client: PoolClient) {}

  async findQuoteForUpdate(quoteId: string): Promise<TransferQuoteRow | null> {
    const result = await this.client.query("SELECT * FROM transfer_quotes WHERE id = $1 FOR UPDATE", [requireUuid(quoteId, "quoteId")]);
    return result.rows[0] ? mapQuote(result.rows[0] as Record<string, unknown>) : null;
  }

  async consumeQuote(quoteId: string, transferId: string): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE transfer_quotes
       SET consumed_at = NOW(), consumed_transfer_id = $2
       WHERE id = $1 AND consumed_at IS NULL
       RETURNING id`,
      [requireUuid(quoteId, "quoteId"), requireUuid(transferId, "transferId")],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async findById(transferId: string): Promise<TransferRow | null> {
    const result = await this.client.query("SELECT * FROM transfers WHERE id = $1", [requireUuid(transferId, "transferId")]);
    return result.rows[0] ? mapTransfer(result.rows[0] as Record<string, unknown>) : null;
  }

  async findByIdempotency(customerId: string, key: string): Promise<TransferRow | null> {
    const result = await this.client.query(
      "SELECT * FROM transfers WHERE customer_id = $1 AND idempotency_key = $2",
      [requireUuid(customerId, "customerId"), key],
    );
    return result.rows[0] ? mapTransfer(result.rows[0] as Record<string, unknown>) : null;
  }

  async createTransfer(input: {
    id: string;
    customerId: string;
    sourceAccountId: string;
    quoteId: string;
    idempotencyKey: string;
    requestFingerprint: string;
    reference: string;
    amountMinor: string;
    feeMinor: string;
    status: TransferRow["status"];
    destinationAccountId?: string | null;
    destinationOwnerId?: string | null;
    sourceTransactionId?: string | null;
    destinationTransactionId?: string | null;
    ledgerJournalId?: string | null;
    heldMinor?: string;
  }): Promise<TransferRow> {
    const result = await this.client.query(
      `
        INSERT INTO transfers
          (id, customer_id, source_account_id, quote_id, idempotency_key,
           request_fingerprint, reference, amount_minor, fee_minor, currency,
           status, created_at, updated_at, destination_account_id,
           destination_owner_id, source_transaction_id, destination_transaction_id,
           ledger_journal_id, held_minor)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'VND', $10, NOW(), NOW(), $11, $12, $13, $14, $15, $16)
        RETURNING *
      `,
      [
        requireUuid(input.id),
        requireUuid(input.customerId, "customerId"),
        requireUuid(input.sourceAccountId, "sourceAccountId"),
        requireUuid(input.quoteId, "quoteId"),
        input.idempotencyKey,
        input.requestFingerprint,
        input.reference,
        asBigIntString(input.amountMinor, "amountMinor"),
        asBigIntString(input.feeMinor, "feeMinor"),
        input.status,
        input.destinationAccountId ? requireUuid(input.destinationAccountId, "destinationAccountId") : null,
        input.destinationOwnerId ? requireUuid(input.destinationOwnerId, "destinationOwnerId") : null,
        input.sourceTransactionId ? requireUuid(input.sourceTransactionId, "sourceTransactionId") : null,
        input.destinationTransactionId ? requireUuid(input.destinationTransactionId, "destinationTransactionId") : null,
        input.ledgerJournalId ? requireUuid(input.ledgerJournalId, "ledgerJournalId") : null,
        asBigIntString(input.heldMinor ?? "0", "heldMinor"),
      ],
    );
    return mapTransfer(result.rows[0] as Record<string, unknown>);
  }

  async reserveCommandIdempotency(input: {
    id: string;
    customerId: string;
    operationType: string;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<{ created: boolean; record: CommandIdempotencyRow }> {
    const inserted = await this.client.query(
      `
        INSERT INTO command_idempotency
          (id, customer_id, operation_type, idempotency_key, request_fingerprint, status)
        VALUES ($1, $2, $3, $4, $5, 'PENDING')
        ON CONFLICT (customer_id, operation_type, idempotency_key) DO NOTHING
        RETURNING *
      `,
      [requireUuid(input.id), requireUuid(input.customerId, "customerId"), input.operationType, input.idempotencyKey, input.requestFingerprint],
    );
    if (inserted.rows[0]) {
      return { created: true, record: mapIdempotency(inserted.rows[0] as Record<string, unknown>) };
    }
    const existing = await this.client.query(
      "SELECT * FROM command_idempotency WHERE customer_id = $1 AND operation_type = $2 AND idempotency_key = $3 FOR UPDATE",
      [requireUuid(input.customerId, "customerId"), input.operationType, input.idempotencyKey],
    );
    if (!existing.rows[0]) throw new Error("Idempotency record disappeared after conflict.");
    return { created: false, record: mapIdempotency(existing.rows[0] as Record<string, unknown>) };
  }

  async completeCommandIdempotency(
    customerId: string,
    operationType: string,
    idempotencyKey: string,
    input: { aggregateId: string; status: string; responsePayload: unknown },
  ): Promise<CommandIdempotencyRow> {
    const result = await this.client.query(
      `UPDATE command_idempotency
       SET aggregate_id = $4, status = $5, response_payload = $6::jsonb, updated_at = NOW()
       WHERE customer_id = $1 AND operation_type = $2 AND idempotency_key = $3
       RETURNING *`,
      [requireUuid(customerId, "customerId"), operationType, idempotencyKey, input.aggregateId, input.status, JSON.stringify(input.responsePayload)],
    );
    if (!result.rows[0]) throw new Error("Idempotency completion affected no row.");
    return mapIdempotency(result.rows[0] as Record<string, unknown>);
  }
}

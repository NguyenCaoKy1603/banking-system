import type { PoolClient } from "pg";

import type {
  AnomalyFlag,
  AnomalyRiskLevel,
  AnomalyRuleCode,
  AnomalyStatus,
  TransactionAnomaly,
} from "../../domain/anomaly/types.js";
import { asBigIntString, asIso, asJson, asNullableIso, asString, requireUuid } from "../rowMappers.js";

export type TransferRiskSignals = {
  recentTransfersLast10mCount: number;
  sameRecipientLast15mCount: number;
  hasPriorRelationship: boolean;
};

function mapAnomaly(row: Record<string, unknown>): TransactionAnomaly {
  const ruleCodes = Array.isArray(row.rule_codes)
    ? row.rule_codes.map((item) => String(item) as AnomalyRuleCode)
    : [];
  const rawFlags = row.reasons ? asJson<unknown>(row.reasons) : [];
  const flags = Array.isArray(rawFlags) ? (rawFlags as AnomalyFlag[]) : [];

  return {
    id: requireUuid(row.id),
    customerId: requireUuid(row.customer_id, "customer_id"),
    accountId: requireUuid(row.account_id, "account_id"),
    transferId: row.transfer_id ? requireUuid(row.transfer_id, "transfer_id") : null,
    transactionId: row.transaction_id ? requireUuid(row.transaction_id, "transaction_id") : null,
    amount: {
      currency: "VND",
      amountMinor: asBigIntString(row.amount_minor, "amount_minor"),
    },
    counterpartyName: row.counterparty_name === null || row.counterparty_name === undefined ? null : asString(row.counterparty_name),
    maskedDestinationAccount: row.masked_destination_account === null || row.masked_destination_account === undefined ? null : asString(row.masked_destination_account),
    riskLevel: asString(row.risk_level) as Exclude<AnomalyRiskLevel, "LOW">,
    riskScore: Number(row.risk_score ?? 0),
    ruleCodes,
    summary: asString(row.summary),
    flags,
    status: asString(row.status) as AnomalyStatus,
    customerNote: row.customer_note === null || row.customer_note === undefined ? null : asString(row.customer_note),
    acknowledgedAt: asNullableIso(row.acknowledged_at, "acknowledged_at"),
    resolutionCode: row.resolution_code === null || row.resolution_code === undefined ? null : asString(row.resolution_code),
    resolvedAt: asNullableIso(row.resolved_at, "resolved_at"),
    createdAt: asIso(row.created_at, "created_at"),
    updatedAt: asIso(row.updated_at, "updated_at"),
  };
}

export class AnomalyRepository {
  constructor(private readonly client: PoolClient) {}

  async getTransferRiskSignals(input: {
    customerId: string;
    destinationAccountId: string;
    now: string;
  }): Promise<TransferRiskSignals> {
    const customerId = requireUuid(input.customerId, "customerId");
    const destinationAccountId = requireUuid(input.destinationAccountId, "destinationAccountId");

    const velocityResult = await this.client.query<{
      recent_10m: number;
      same_recipient_15m: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE created_at >= ($3::timestamptz - interval '10 minutes'))::int AS recent_10m,
         COUNT(*) FILTER (
           WHERE destination_account_id = $2
             AND created_at >= ($3::timestamptz - interval '15 minutes')
         )::int AS same_recipient_15m
       FROM transfers
       WHERE customer_id = $1`,
      [customerId, destinationAccountId, input.now],
    );

    const priorResult = await this.client.query<{ has_prior: boolean }>(
      `SELECT (
         EXISTS (
           SELECT 1 FROM beneficiaries
            WHERE customer_id = $1
              AND destination_account_id = $2
              AND deleted_at IS NULL
              AND status = 'ACTIVE'
         )
         OR EXISTS (
           SELECT 1 FROM transfers
            WHERE customer_id = $1
              AND destination_account_id = $2
              AND status = 'SUCCEEDED'
         )
       ) AS has_prior`,
      [customerId, destinationAccountId],
    );

    return {
      recentTransfersLast10mCount: Number(velocityResult.rows[0]?.recent_10m ?? 0),
      sameRecipientLast15mCount: Number(velocityResult.rows[0]?.same_recipient_15m ?? 0),
      hasPriorRelationship: Boolean(priorResult.rows[0]?.has_prior),
    };
  }

  async insertAnomaly(input: {
    id: string;
    customerId: string;
    accountId: string;
    transferId: string;
    transactionId: string | null;
    amountMinor: string;
    counterpartyName?: string | null;
    maskedDestinationAccount?: string | null;
    riskLevel: Exclude<AnomalyRiskLevel, "LOW">;
    riskScore: number;
    ruleCodes: AnomalyRuleCode[];
    summary: string;
    flags: AnomalyFlag[];
    now: string;
  }): Promise<TransactionAnomaly> {
    const result = await this.client.query(
      `INSERT INTO transaction_anomalies
        (id, customer_id, account_id, transfer_id, transaction_id, amount_minor,
         currency, counterparty_name, masked_destination_account, risk_level,
         risk_score, rule_codes, summary, reasons, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'VND', $7, $8, $9, $10, $11::text[], $12, $13::jsonb, 'OPEN', $14::timestamptz, $14::timestamptz)
       ON CONFLICT (transfer_id) DO UPDATE
         SET updated_at = transaction_anomalies.updated_at
       RETURNING *`,
      [
        requireUuid(input.id),
        requireUuid(input.customerId, "customerId"),
        requireUuid(input.accountId, "accountId"),
        requireUuid(input.transferId, "transferId"),
        input.transactionId ? requireUuid(input.transactionId, "transactionId") : null,
        asBigIntString(input.amountMinor, "amountMinor"),
        input.counterpartyName ?? null,
        input.maskedDestinationAccount ?? null,
        input.riskLevel,
        input.riskScore,
        input.ruleCodes,
        input.summary,
        JSON.stringify(input.flags),
        input.now,
      ],
    );
    return mapAnomaly(result.rows[0] as Record<string, unknown>);
  }

  async listByCustomer(customerId: string, status?: AnomalyStatus): Promise<TransactionAnomaly[]> {
    const id = requireUuid(customerId, "customerId");
    const result = await this.client.query(
      `SELECT * FROM transaction_anomalies
        WHERE customer_id = $1
          AND ($2::text IS NULL OR status = $2)
        ORDER BY created_at DESC, id DESC
        LIMIT 100`,
      [id, status ?? null],
    );
    return result.rows.map((row) => mapAnomaly(row as Record<string, unknown>));
  }

  async findByIdForCustomer(
    customerId: string,
    anomalyId: string,
    forUpdate = false,
  ): Promise<TransactionAnomaly | null> {
    const result = await this.client.query(
      `SELECT * FROM transaction_anomalies
        WHERE id = $1 AND customer_id = $2
        ${forUpdate ? "FOR UPDATE" : ""}`,
      [requireUuid(anomalyId, "anomalyId"), requireUuid(customerId, "customerId")],
    );
    return result.rows[0] ? mapAnomaly(result.rows[0] as Record<string, unknown>) : null;
  }

  async updateCustomerAcknowledgement(input: {
    anomalyId: string;
    status: "CONFIRMED_SAFE" | "REPORTED_SUSPICIOUS";
    customerNote: string | null;
    now: string;
  }): Promise<TransactionAnomaly> {
    const result = await this.client.query(
      `UPDATE transaction_anomalies
          SET status = $2,
              customer_note = COALESCE($3, customer_note),
              acknowledged_at = $4::timestamptz,
              version = version + 1,
              updated_at = $4::timestamptz
        WHERE id = $1
        RETURNING *`,
      [requireUuid(input.anomalyId, "anomalyId"), input.status, input.customerNote, input.now],
    );
    if (!result.rows[0]) {
      throw new Error("Transaction anomaly update affected no row.");
    }
    return mapAnomaly(result.rows[0] as Record<string, unknown>);
  }
}

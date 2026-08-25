import type { PoolClient } from "pg";

import { asBigIntString, asIso, asNullableIso, asString, requireUuid } from "../rowMappers.js";

export type AccountRow = {
  id: string;
  customerId: string;
  displayName: string;
  accountNumber: string;
  maskedNumber: string;
  bankName: string;
  availableMinor: string;
  currentMinor: string;
  heldMinor: string;
  status: "ACTIVE" | "BLOCKED";
  version: string;
  updatedAt: string;
};

export type AccountTransactionRow = {
  id: string;
  accountId: string;
  transferId: string | null;
  direction: "CREDIT" | "DEBIT";
  amountMinor: string;
  feeMinor: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "REVERSED";
  description: string;
  counterpartyName: string | null;
  reference: string;
  occurredAt: string;
  createdAt: string;
  completedAt: string | null;
  kind: string | null;
};

function mapAccount(row: Record<string, unknown>): AccountRow {
  return {
    id: requireUuid(row.id),
    customerId: requireUuid(row.customer_id, "customer_id"),
    displayName: asString(row.display_name),
    accountNumber: asString(row.account_number),
    maskedNumber: asString(row.masked_number),
    bankName: asString(row.bank_name, "Ngân hàng reference"),
    availableMinor: asBigIntString(row.available_minor, "available_minor"),
    currentMinor: asBigIntString(row.current_minor, "current_minor"),
    heldMinor: asBigIntString(row.held_minor, "held_minor"),
    status: asString(row.status) as AccountRow["status"],
    version: asBigIntString(row.version, "version"),
    updatedAt: asIso(row.updated_at, "updated_at"),
  };
}

function mapTransaction(row: Record<string, unknown>): AccountTransactionRow {
  return {
    id: requireUuid(row.id),
    accountId: requireUuid(row.account_id, "account_id"),
    transferId: row.transfer_id === null || row.transfer_id === undefined ? null : requireUuid(row.transfer_id, "transfer_id"),
    direction: asString(row.direction) as AccountTransactionRow["direction"],
    amountMinor: asBigIntString(row.amount_minor, "amount_minor"),
    feeMinor: asBigIntString(row.fee_minor, "fee_minor"),
    status: asString(row.status) as AccountTransactionRow["status"],
    description: asString(row.description),
    counterpartyName: row.counterparty_name === null || row.counterparty_name === undefined ? null : asString(row.counterparty_name),
    reference: asString(row.reference),
    occurredAt: asIso(row.occurred_at, "occurred_at"),
    createdAt: asIso(row.created_at, "created_at"),
    completedAt: asNullableIso(row.completed_at, "completed_at"),
    kind: row.kind === null || row.kind === undefined ? null : asString(row.kind),
  };
}

export class AccountRepository {
  constructor(private readonly client: PoolClient) {}

  async createForCustomer(input: {
    id: string;
    customerId: string;
    displayName?: string;
    openingBalanceMinor?: string;
    now?: string;
  }): Promise<AccountRow> {
    const opening = asBigIntString(input.openingBalanceMinor ?? "0", "openingBalanceMinor");
    const result = await this.client.query(
      `WITH next_account AS (
         SELECT ('9704' || nextval('payment_account_number_seq')::text) AS account_number
       )
       INSERT INTO payment_accounts
        (id, customer_id, display_name, masked_number, currency,
         available_minor, current_minor, status, version, updated_at,
         account_number, bank_name, opening_balance_minor, held_minor)
       SELECT $1, $2, $3, '•••• ' || right(next_account.account_number, 4), 'VND', $4, $4, 'ACTIVE', 0,
               COALESCE($5::timestamptz, NOW()),
               next_account.account_number,
               'Ngân hàng reference', $4, 0
       FROM next_account
       RETURNING *`,
      [
        requireUuid(input.id),
        requireUuid(input.customerId, "customerId"),
        input.displayName ?? "Tài khoản thanh toán",
        opening,
        input.now ?? null,
      ],
    );
    const account = mapAccount(result.rows[0] as Record<string, unknown>);
    return {
      ...account,
      maskedNumber: `•••• ${account.accountNumber.slice(-4)}`,
    };
  }

  async findOwnedAccount(customerId: string, accountId: string): Promise<AccountRow | null> {
    const result = await this.client.query(
      "SELECT * FROM payment_accounts WHERE id = $1 AND customer_id = $2",
      [requireUuid(accountId, "accountId"), requireUuid(customerId, "customerId")],
    );
    return result.rows[0] ? mapAccount(result.rows[0] as Record<string, unknown>) : null;
  }

  async findByAccountNumber(accountNumber: string): Promise<AccountRow | null> {
    const result = await this.client.query("SELECT * FROM payment_accounts WHERE account_number = $1", [accountNumber]);
    return result.rows[0] ? mapAccount(result.rows[0] as Record<string, unknown>) : null;
  }

  async findAccountsByCustomer(customerId: string): Promise<AccountRow[]> {
    const result = await this.client.query(
      "SELECT * FROM payment_accounts WHERE customer_id = $1 ORDER BY id",
      [requireUuid(customerId, "customerId")],
    );
    return result.rows.map((row) => mapAccount(row as Record<string, unknown>));
  }

  async lockById(accountId: string): Promise<AccountRow | null> {
    const result = await this.client.query("SELECT * FROM payment_accounts WHERE id = $1 FOR UPDATE", [
      requireUuid(accountId, "accountId"),
    ]);
    return result.rows[0] ? mapAccount(result.rows[0] as Record<string, unknown>) : null;
  }

  async lockManyByIds(accountIds: string[]): Promise<AccountRow[]> {
    const ids = accountIds.map((id) => requireUuid(id, "accountId"));
    const result = await this.client.query(
      "SELECT * FROM payment_accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [ids],
    );
    return result.rows.map((row) => mapAccount(row as Record<string, unknown>));
  }

  async updateBalances(
    accountId: string,
    input: { availableMinor: string; currentMinor: string; heldMinor: string; expectedVersion?: string },
  ): Promise<AccountRow> {
    const result = await this.client.query(
      `
        UPDATE payment_accounts
        SET available_minor = $2,
            current_minor = $3,
            held_minor = $4,
            version = version + 1,
            updated_at = NOW()
        WHERE id = $1
          AND available_minor >= 0
          AND current_minor >= 0
          AND held_minor >= 0
          AND ($5::bigint IS NULL OR version = $5)
        RETURNING *
      `,
      [
        requireUuid(accountId, "accountId"),
        asBigIntString(input.availableMinor, "availableMinor"),
        asBigIntString(input.currentMinor, "currentMinor"),
        asBigIntString(input.heldMinor, "heldMinor"),
        input.expectedVersion === undefined ? null : asBigIntString(input.expectedVersion, "expectedVersion"),
      ],
    );
    if (!result.rows[0]) throw new Error("Account balance update affected no row.");
    return mapAccount(result.rows[0] as Record<string, unknown>);
  }

  async updateStatus(accountId: string, status: AccountRow["status"]): Promise<AccountRow> {
    const result = await this.client.query(
      "UPDATE payment_accounts SET status = $2, version = version + 1, updated_at = NOW() WHERE id = $1 RETURNING *",
      [requireUuid(accountId, "accountId"), status],
    );
    if (!result.rows[0]) throw new Error("Account status update affected no row.");
    return mapAccount(result.rows[0] as Record<string, unknown>);
  }

  async listTransactions(accountId: string, limit = 100): Promise<AccountTransactionRow[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("limit must be between 1 and 1000.");
    const result = await this.client.query(
      `
        SELECT * FROM account_transactions
        WHERE account_id = $1
        ORDER BY occurred_at DESC, id DESC
        LIMIT $2
      `,
      [requireUuid(accountId, "accountId"), limit],
    );
    return result.rows.map((row) => mapTransaction(row as Record<string, unknown>));
  }

  async findTransaction(accountId: string, transactionId: string): Promise<AccountTransactionRow | null> {
    const result = await this.client.query(
      "SELECT * FROM account_transactions WHERE account_id = $1 AND id = $2",
      [requireUuid(accountId, "accountId"), requireUuid(transactionId, "transactionId")],
    );
    return result.rows[0] ? mapTransaction(result.rows[0] as Record<string, unknown>) : null;
  }

  async appendTransaction(input: {
    id: string;
    accountId: string;
    transferId?: string | null;
    savingsOpeningId?: string | null;
    savingsDepositId?: string | null;
    direction: AccountTransactionRow["direction"];
    amountMinor: string;
    feeMinor?: string;
    status: AccountTransactionRow["status"];
    description: string;
    counterpartyName?: string | null;
    reference: string;
    occurredAt?: string;
    completedAt?: string | null;
    kind?: string | null;
  }): Promise<AccountTransactionRow> {
    const result = await this.client.query(
      `INSERT INTO account_transactions
        (id, account_id, transfer_id, savings_opening_id, savings_deposit_id,
         direction, amount_minor, fee_minor,
         currency, status, description, counterparty_name, reference,
         occurred_at, created_at, completed_at, kind)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'VND', $9, $10, $11,
               $12, COALESCE($13::timestamptz, NOW()), NOW(), $14::timestamptz, $15)
       RETURNING *`,
      [
        requireUuid(input.id),
        requireUuid(input.accountId, "accountId"),
        input.transferId ? requireUuid(input.transferId, "transferId") : null,
        input.savingsOpeningId ? requireUuid(input.savingsOpeningId, "savingsOpeningId") : null,
        input.savingsDepositId ? requireUuid(input.savingsDepositId, "savingsDepositId") : null,
        input.direction,
        asBigIntString(input.amountMinor, "amountMinor"),
        asBigIntString(input.feeMinor ?? "0", "feeMinor"),
        input.status,
        input.description,
        input.counterpartyName ?? null,
        input.reference,
        input.occurredAt ?? null,
        input.completedAt ?? null,
        input.kind ?? null,
      ],
    );
    return mapTransaction(result.rows[0] as Record<string, unknown>);
  }
}

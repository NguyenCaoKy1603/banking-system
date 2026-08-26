import type { PoolClient } from "pg";

import { asBigIntString, asIso, asString, requireUuid } from "../rowMappers.js";

export type LedgerEntryInput = {
  lineNumber: number;
  accountRef: string;
  side: "DEBIT" | "CREDIT";
  amountMinor: string;
  entryId: string;
  occurredAt?: string;
};

export type LedgerEntryRow = LedgerEntryInput & {
  journalId: string;
  currency: "VND";
  occurredAt: string;
};

function mapEntry(row: Record<string, unknown>): LedgerEntryRow {
  return {
    journalId: requireUuid(row.journal_id, "journal_id"),
    lineNumber: Number(row.line_number),
    accountRef: asString(row.account_ref),
    side: asString(row.side) as LedgerEntryRow["side"],
    amountMinor: asBigIntString(row.amount_minor, "amount_minor"),
    entryId: requireUuid(row.entry_id, "entry_id"),
    currency: asString(row.currency, "currency") as LedgerEntryRow["currency"],
    occurredAt: asIso(row.occurred_at, "occurred_at"),
  };
}

export class LedgerRepository {
  constructor(private readonly client: PoolClient) {}

  async appendJournal(input: {
    id: string;
    aggregateId: string;
    journalType: string;
    occurredAt?: string;
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO ledger_journals (id, aggregate_id, journal_type, currency, occurred_at, created_at)
       VALUES ($1, $2, $3, 'VND', COALESCE($4::timestamptz, NOW()), NOW())`,
      [requireUuid(input.id), input.aggregateId, input.journalType, input.occurredAt ?? null],
    );
  }

  async appendEntries(journalId: string, entries: LedgerEntryInput[]): Promise<void> {
    const id = requireUuid(journalId, "journalId");
    if (entries.length < 2) throw new Error("A ledger journal requires at least two entries.");
    for (const entry of entries) {
      if (!Number.isInteger(entry.lineNumber) || entry.lineNumber < 1) throw new Error("Ledger line number is invalid.");
      await this.client.query(
        `INSERT INTO ledger_entries
          (journal_id, line_number, account_ref, side, amount_minor, currency, entry_id, occurred_at)
         VALUES ($1, $2, $3, $4, $5, 'VND', $6, COALESCE($7::timestamptz, NOW()))`,
        [id, entry.lineNumber, entry.accountRef, entry.side, asBigIntString(entry.amountMinor, "amountMinor"), requireUuid(entry.entryId, "entryId"), entry.occurredAt ?? null],
      );
    }
  }

  async findJournalByAggregate(aggregateId: string, journalType?: string): Promise<{ id: string; aggregateId: string; journalType: string } | null> {
    const result = await this.client.query(
      `SELECT id, aggregate_id, journal_type FROM ledger_journals
       WHERE aggregate_id = $1 AND ($2::text IS NULL OR journal_type = $2)
       ORDER BY created_at DESC LIMIT 1`,
      [aggregateId, journalType ?? null],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row
      ? { id: requireUuid(row.id), aggregateId: asString(row.aggregate_id), journalType: asString(row.journal_type) }
      : null;
  }

  async listEntries(journalId: string): Promise<LedgerEntryRow[]> {
    const result = await this.client.query(
      "SELECT * FROM ledger_entries WHERE journal_id = $1 ORDER BY line_number",
      [requireUuid(journalId, "journalId")],
    );
    return result.rows.map((row) => mapEntry(row as Record<string, unknown>));
  }

  async reconcileAccount(accountRef: string): Promise<{ ledgerCreditMinor: string; ledgerDebitMinor: string; differenceMinor: string }> {
    const result = await this.client.query(
      `SELECT
         COALESCE(SUM(CASE WHEN side = 'CREDIT' THEN amount_minor ELSE 0 END), 0)::text AS credit,
         COALESCE(SUM(CASE WHEN side = 'DEBIT' THEN amount_minor ELSE 0 END), 0)::text AS debit
       FROM ledger_entries WHERE account_ref = $1`,
      [accountRef],
    );
    const row = result.rows[0] as Record<string, unknown>;
    const credit = BigInt(asBigIntString(row.credit, "credit"));
    const debit = BigInt(asBigIntString(row.debit, "debit"));
    return {
      ledgerCreditMinor: credit.toString(),
      ledgerDebitMinor: debit.toString(),
      differenceMinor: (credit - debit).toString(),
    };
  }
}

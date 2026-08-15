import { createId } from "./security.js";

export type LedgerSide = "DEBIT" | "CREDIT";

export type LedgerEntryInput = {
  accountId: string;
  side: LedgerSide;
  amountMinor: bigint;
  currency: "VND";
};

export type LedgerJournalInput = {
  journalId: string;
  occurredAt: string;
  entries: readonly LedgerEntryInput[];
};

export type LedgerEntry = LedgerEntryInput & {
  id: string;
  journalId: string;
  occurredAt: string;
};

export type SerializedLedgerEntry = Omit<LedgerEntry, "amountMinor"> & {
  amountMinor: string;
};

export type InMemoryLedgerState = {
  journals: Array<[string, SerializedLedgerEntry[]]>;
};

export interface LedgerPort {
  append(input: LedgerJournalInput): readonly LedgerEntry[];
  getJournal(journalId: string): readonly LedgerEntry[] | null;
  listEntries(accountId?: string): readonly LedgerEntry[];
  isBalanced(journalId: string): boolean;
  getNetBalance(accountId: string): bigint;
}

function normalizeRequired(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }
  return normalized;
}

function entryFingerprint(entry: LedgerEntryInput): string {
  return [
    entry.accountId,
    entry.side,
    entry.amountMinor.toString(),
    entry.currency,
  ].join("|");
}

function cloneEntry(entry: LedgerEntry): LedgerEntry {
  return { ...entry };
}

export class InMemoryLedger implements LedgerPort {
  private readonly journals = new Map<string, LedgerEntry[]>();

  append(input: LedgerJournalInput): readonly LedgerEntry[] {
    const journalId = normalizeRequired(input.journalId, "journalId");
    const occurredAt = normalizeRequired(input.occurredAt, "occurredAt");
    const entries = [...input.entries];

    if (entries.length < 2) {
      throw new Error("A ledger journal requires at least two entries.");
    }

    const existing = this.journals.get(journalId);
    if (existing) {
      const requestedFingerprint = entries
        .map(entryFingerprint)
        .sort()
        .join(";");
      const existingFingerprint = existing
        .map(entryFingerprint)
        .sort()
        .join(";");
      if (requestedFingerprint !== existingFingerprint) {
        throw new Error("Ledger journal cannot be reused with different entries.");
      }
      return existing.map(cloneEntry);
    }

    const debitMinor = entries.reduce(
      (total, entry) => total + (entry.side === "DEBIT" ? entry.amountMinor : 0n),
      0n,
    );
    const creditMinor = entries.reduce(
      (total, entry) => total + (entry.side === "CREDIT" ? entry.amountMinor : 0n),
      0n,
    );

    if (debitMinor !== creditMinor) {
      throw new Error("Ledger journal must be balanced.");
    }

    for (const entry of entries) {
      normalizeRequired(entry.accountId, "accountId");
      if (entry.amountMinor <= 0n) {
        throw new Error("Ledger entry amount must be positive.");
      }
      if (entry.currency !== "VND") {
        throw new Error("Only VND ledger entries are supported.");
      }
    }

    const storedEntries = entries.map((entry) => ({
      ...entry,
      id: createId("ledger-entry"),
      journalId,
      occurredAt,
    }));
    this.journals.set(journalId, storedEntries);
    return storedEntries.map(cloneEntry);
  }

  getJournal(journalId: string): readonly LedgerEntry[] | null {
    const entries = this.journals.get(journalId);
    return entries ? entries.map(cloneEntry) : null;
  }

  listEntries(accountId?: string): readonly LedgerEntry[] {
    const normalizedAccountId = accountId?.trim();
    return [...this.journals.values()]
      .flat()
      .filter(
        (entry) =>
          !normalizedAccountId || entry.accountId === normalizedAccountId,
      )
      .map(cloneEntry);
  }

  isBalanced(journalId: string): boolean {
    const entries = this.journals.get(journalId);
    if (!entries) {
      return false;
    }

    const debitMinor = entries.reduce(
      (total, entry) => total + (entry.side === "DEBIT" ? entry.amountMinor : 0n),
      0n,
    );
    const creditMinor = entries.reduce(
      (total, entry) => total + (entry.side === "CREDIT" ? entry.amountMinor : 0n),
      0n,
    );
    return debitMinor === creditMinor;
  }

  getNetBalance(accountId: string): bigint {
    const normalizedAccountId = normalizeRequired(accountId, "accountId");
    return this.listEntries(normalizedAccountId).reduce(
      (balance, entry) =>
        balance +
        (entry.side === "CREDIT" ? entry.amountMinor : -entry.amountMinor),
      0n,
    );
  }

  exportState(): InMemoryLedgerState {
    return {
      journals: [...this.journals.entries()].map(([journalId, entries]) => [
        journalId,
        entries.map((entry) => ({
          ...entry,
          amountMinor: entry.amountMinor.toString(),
        })),
      ]),
    };
  }

  importState(state: InMemoryLedgerState): void {
    this.journals.clear();
    for (const [journalId, entries] of state.journals) {
      this.journals.set(
        journalId,
        entries.map((entry) => ({
          ...entry,
          amountMinor: BigInt(entry.amountMinor),
        })),
      );
    }
  }
}

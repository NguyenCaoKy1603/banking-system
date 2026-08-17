import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

import type { BankingSystemState } from "./bankingSystem.js";

export type RelationalStateOperation<T> = (state: unknown) => Promise<{
  result: T;
  nextState: unknown;
}>;

export type PostgresRelationalRepositoryOptions = {
  connectionString?: string;
  maxConnections?: number;
  legacySnapshotKey?: string;
};

type Row = Record<string, any>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function asRecord(value: unknown): Row {
  return typeof value === "object" && value !== null ? (value as Row) : {};
}

function asJson<T>(value: unknown): T {
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }
  return value as T;
}

function asIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

function asNullableIso(value: unknown): string | null {
  return value === null || value === undefined ? null : asIso(value);
}

function asString(value: unknown, fallback = ""): string {
  return value === null || value === undefined ? fallback : String(value);
}

function fallbackAccountNumber(accountId: string, maskedNumber: string): string {
  const lastFour = maskedNumber.replace(/\D/g, "").slice(-4).padStart(4, "0");
  const prefix = accountId.replace(/\D/g, "").slice(-4).padStart(4, "0");
  return `9704${prefix}${lastFour}`;
}

function quoteSnapshot(value: unknown): Row {
  return asRecord(asJson<unknown>(value));
}

function arrayEntries(value: unknown): Array<[string, unknown]> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is [string, unknown] =>
      Array.isArray(entry) && typeof entry[0] === "string",
  );
}

/**
 * PostgreSQL adapter for the reference sandbox.
 *
 * Core customer/account/transfer/ledger records are projected into the
 * relational tables from the draft schema.  Ephemeral auth and optional
 * reference-product records are kept as one JSONB record per map entry in
 * reference_runtime_records.  This is intentionally scoped to the virtual
 * money sandbox and is not a production core-banking repository.
 */
export class PostgresRelationalRepository {
  private readonly pool: Pool;
  private readonly legacySnapshotKey: string;

  constructor(options: PostgresRelationalRepositoryOptions = {}) {
    const connectionString = options.connectionString ?? process.env.DATABASE_URL;
    if (!connectionString?.trim()) {
      throw new Error("DATABASE_URL is required for the PostgreSQL relational adapter.");
    }

    this.legacySnapshotKey =
      options.legacySnapshotKey ?? process.env.BANKING_SNAPSHOT_KEY ?? "banking-reference-sandbox";
    this.pool = new Pool({
      connectionString,
      max: options.maxConnections ?? 4,
    });
  }

  async initialize(): Promise<void> {
    const result = await this.pool.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.reference_runtime_records') AS table_name",
    );
    if (!result.rows[0]?.table_name) {
      throw new Error(
        "PostgreSQL relational schema is not initialized. Run `npm run db:migrate` before starting the persistent backend.",
      );
    }

    const columns = await this.pool.query<{ column_name: string }>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payment_accounts'
          AND column_name IN ('account_number', 'held_minor')
      `,
    );
    if (columns.rows.length !== 2) {
      throw new Error(
        "PostgreSQL relational columns are missing. Run `npm run db:migrate` before starting the persistent backend.",
      );
    }
  }

  async withState<T>(initialState: unknown, operation: RelationalStateOperation<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('banking-relational-reference', 0))",
      );
      const current = await this.readState(client, initialState);
      const { result, nextState } = await operation(current);
      await this.writeState(client, nextState as BankingSystemState);
      // A legacy snapshot is only removed after the relational projection has
      // committed successfully; this also avoids queuing deferred ledger
      // triggers twice during one migration transaction.
      await client.query("DELETE FROM reference_state_snapshots WHERE snapshot_key = $1", [
        this.legacySnapshotKey,
      ]);
      await client.query("COMMIT");
      return result;
    } catch (error: unknown) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<void> {
    await this.pool.query("SELECT 1");
    await this.pool.query("SELECT 1 FROM reference_runtime_records LIMIT 1");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async clear(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.truncateRelationalState(client);
      await client.query("DELETE FROM reference_state_snapshots WHERE snapshot_key = $1", [
        this.legacySnapshotKey,
      ]);
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async readState(client: PoolClient, initialState: unknown): Promise<unknown> {
    const customerCount = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM customers",
    );
    if (customerCount.rows[0]?.count === "0") {
      const legacy = await client.query<{ state: unknown }>(
        "SELECT state FROM reference_state_snapshots WHERE snapshot_key = $1 FOR UPDATE",
        [this.legacySnapshotKey],
      );
      if (legacy.rows[0]?.state) {
        return legacy.rows[0].state as BankingSystemState;
      }
      return initialState;
    }

    return this.readRelationalState(client);
  }

  private async readRelationalState(client: PoolClient): Promise<BankingSystemState> {
    // A PoolClient supports one query at a time.  Keep these reads sequential
    // so the advisory-lock transaction cannot interleave or queue queries on
    // the same connection.
    const customers = await client.query("SELECT * FROM customers ORDER BY created_at, id");
    const accounts = await client.query("SELECT * FROM payment_accounts ORDER BY updated_at, id");
    const transactions = await client.query(
      "SELECT * FROM account_transactions ORDER BY occurred_at, created_at, id",
    );
    const coreTransfers = await client.query("SELECT * FROM transfers ORDER BY created_at, id");
    const journals = await client.query("SELECT * FROM ledger_journals ORDER BY created_at, id");
    const entries = await client.query("SELECT * FROM ledger_entries ORDER BY journal_id, line_number");
    const beneficiaries = await client.query("SELECT * FROM beneficiaries ORDER BY created_at, id");
    const quotes = await client.query("SELECT * FROM transfer_quotes ORDER BY created_at, id");
    const transfers = coreTransfers;
    const notifications = await client.query("SELECT * FROM notifications ORDER BY created_at DESC, id");
    const auditEvents = await client.query("SELECT * FROM audit_events ORDER BY occurred_at, id");
    const outboxEvents = await client.query("SELECT * FROM outbox_events ORDER BY occurred_at, id");
    const runtimeRecords = await client.query(
      "SELECT collection, record_key, payload FROM reference_runtime_records ORDER BY collection, record_key",
    );

    const runtime = new Map<string, Array<[string, unknown]>>();
    for (const row of runtimeRecords.rows as Row[]) {
      const list = runtime.get(row.collection) ?? [];
      list.push([String(row.record_key), asJson<unknown>(row.payload)]);
      runtime.set(row.collection, list);
    }
    const runtimeEntries = (collection: string): Array<[string, unknown]> =>
      runtime.get(collection) ?? [];

    const userEntries: Array<[string, any]> = (customers.rows as Row[]).map((row) => [
      String(row.id),
      {
        id: String(row.id),
        fullName: String(row.full_name),
        email: String(row.email),
        phoneNumber: String(row.phone_number),
        createdAt: asIso(row.created_at),
        passwordSalt: String(row.password_salt),
        passwordDigest: String(row.password_digest),
      },
    ]);

    const accountEntries: Array<[string, any]> = (accounts.rows as Row[]).map((row) => [
      String(row.id),
      {
        id: String(row.id),
        ownerId: String(row.customer_id),
        displayName: String(row.display_name),
        accountNumber:
          row.account_number ?? fallbackAccountNumber(String(row.id), String(row.masked_number)),
        maskedNumber: String(row.masked_number),
        bankName: String(row.bank_name ?? "Ngân hàng reference"),
        openingBalanceMinor: String(row.opening_balance_minor ?? "0"),
        heldMinor: String(row.held_minor ?? "0"),
        availableMinor: String(row.available_minor),
        currentMinor: String(row.current_minor),
        status: String(row.status),
        updatedAt: asIso(row.updated_at),
      },
    ]);

    const transferRows = coreTransfers.rows as Row[];
    const transferByTransactionId = new Map<string, string>();
    for (const row of transferRows) {
      if (row.source_transaction_id) {
        transferByTransactionId.set(String(row.source_transaction_id), String(row.id));
      }
      if (row.destination_transaction_id) {
        transferByTransactionId.set(String(row.destination_transaction_id), String(row.id));
      }
    }

    const transactionByAccount = new Map<string, any[]>();
    for (const row of transactions.rows as Row[]) {
      const accountId = String(row.account_id);
      const items = transactionByAccount.get(accountId) ?? [];
      items.push({
        id: String(row.id),
        accountId,
        direction: String(row.direction),
        amount: { currency: "VND", amountMinor: String(row.amount_minor) },
        fee: { currency: "VND", amountMinor: String(row.fee_minor) },
        status: String(row.status),
        kind: row.kind ?? undefined,
        description: String(row.description),
        counterpartyName: row.counterparty_name === null ? null : String(row.counterparty_name),
        occurredAt: asIso(row.occurred_at),
        reference: String(row.reference),
        createdAt: asIso(row.created_at),
        completedAt: asNullableIso(row.completed_at),
      });
      transactionByAccount.set(accountId, items);
    }
    for (const [accountId] of accountEntries) {
      if (!transactionByAccount.has(accountId)) {
        transactionByAccount.set(accountId, []);
      }
    }

    const ledgerEntriesByJournal = new Map<string, any[]>();
    const dbJournalToStateJournal = new Map<string, string>();
    for (const row of journals.rows as Row[]) {
      dbJournalToStateJournal.set(String(row.id), String(row.aggregate_id));
      ledgerEntriesByJournal.set(String(row.id), []);
    }
    for (const row of entries.rows as Row[]) {
      const dbJournalId = String(row.journal_id);
      const stateJournalId = dbJournalToStateJournal.get(dbJournalId) ?? dbJournalId;
      const items = ledgerEntriesByJournal.get(dbJournalId) ?? [];
      items.push({
        id: isUuid(row.entry_id) ? String(row.entry_id) : randomUUID(),
        journalId: stateJournalId,
        occurredAt: asIso(row.occurred_at ?? new Date()),
        accountId: String(row.account_ref),
        side: String(row.side),
        amountMinor: String(row.amount_minor),
        currency: "VND",
      });
      ledgerEntriesByJournal.set(dbJournalId, items);
    }
    const ledgerJournals: Array<[string, any[]]> = (journals.rows as Row[]).map((row) => [
      String(row.aggregate_id),
      ledgerEntriesByJournal.get(String(row.id)) ?? [],
    ]);

    const coreTransferEntries: Array<[string, any]> = transferRows.map((row) => [
      String(row.id),
      {
        ownerId: String(row.customer_id),
        destinationOwnerId: row.destination_owner_id ? String(row.destination_owner_id) : "",
        accountId: String(row.source_account_id),
        destinationAccountId: row.destination_account_id ? String(row.destination_account_id) : "",
        transactionId: row.source_transaction_id ? String(row.source_transaction_id) : "",
        destinationTransactionId: row.destination_transaction_id
          ? String(row.destination_transaction_id)
          : null,
        ledgerJournalId: row.ledger_journal_id ? String(row.ledger_journal_id) : null,
        receipt: {
          transferId: String(row.id),
          reference: String(row.reference),
          status: String(row.status),
          amount: { currency: "VND", amountMinor: String(row.amount_minor) },
          fee: { currency: "VND", amountMinor: String(row.fee_minor) },
          createdAt: asIso(row.created_at),
          updatedAt: asIso(row.updated_at),
        },
        refunded: Boolean(row.refunded),
        heldMinor: String(row.held_minor ?? "0"),
      },
    ]);

    const beneficiaryById = new Map<string, Row>();
    const beneficiaryGroups = new Map<string, any[]>();
    for (const row of beneficiaries.rows as Row[]) {
      const id = String(row.id);
      beneficiaryById.set(id, row);
      const userId = String(row.customer_id);
      const list = beneficiaryGroups.get(userId) ?? [];
      list.push({
        id,
        displayName: String(row.display_name),
        accountHolderName: String(row.account_holder_name ?? row.display_name),
        maskedAccountNumber: String(row.masked_account_number),
        bankName: String(row.bank_name),
        status: String(row.status),
        accountNumberFingerprint: String(row.account_number_fingerprint),
        destinationAccountId: String(row.destination_account_id ?? ""),
        destinationOwnerId: String(row.destination_owner_id ?? ""),
      });
      beneficiaryGroups.set(userId, list);
    }

    const quoteEntries: Array<[string, any]> = (quotes.rows as Row[]).map((row) => {
      const snapshot = quoteSnapshot(row.beneficiary_snapshot);
      const fallbackBeneficiary = row.beneficiary_id
        ? beneficiaryById.get(String(row.beneficiary_id))
        : undefined;
      const beneficiary = Object.keys(snapshot).length > 0
        ? snapshot
        : {
            id: row.beneficiary_id ? String(row.beneficiary_id) : "",
            displayName: String(fallbackBeneficiary?.display_name ?? "Người nhận"),
            accountHolderName: String(
              fallbackBeneficiary?.account_holder_name ?? fallbackBeneficiary?.display_name ?? "Người nhận",
            ),
            maskedAccountNumber: String(fallbackBeneficiary?.masked_account_number ?? "••••"),
            bankName: String(fallbackBeneficiary?.bank_name ?? "Ngân hàng reference"),
            status: String(fallbackBeneficiary?.status ?? "ACTIVE"),
          };
      const amountMinor = String(row.amount_minor);
      const feeMinor = String(row.fee_minor);
      return [
        String(row.id),
        {
          userId: String(row.customer_id),
          destinationAccountId: String(row.destination_account_id ?? ""),
          destinationOwnerId: String(row.destination_owner_id ?? ""),
          consumedTransferId: row.consumed_transfer_id ? String(row.consumed_transfer_id) : undefined,
          quote: {
            quoteId: String(row.id),
            sourceAccountId: String(row.source_account_id),
            beneficiary,
            amount: { currency: "VND", amountMinor },
            fee: { currency: "VND", amountMinor: feeMinor },
            totalDebit: {
              currency: "VND",
              amountMinor: (BigInt(amountMinor) + BigInt(feeMinor)).toString(),
            },
            expiresAt: asIso(row.expires_at),
          },
        },
      ];
    });

    const transferReceiptEntries: Array<[string, any]> = (transfers.rows as Row[]).map((row) => [
      String(row.id),
      {
        userId: String(row.customer_id),
        receipt: {
          transferId: String(row.id),
          reference: String(row.reference),
          status: String(row.status),
          amount: { currency: "VND", amountMinor: String(row.amount_minor) },
          fee: { currency: "VND", amountMinor: String(row.fee_minor) },
          createdAt: asIso(row.created_at),
          updatedAt: asIso(row.updated_at),
        },
      },
    ]);

    const notificationGroups = new Map<string, any[]>();
    for (const row of notifications.rows as Row[]) {
      const userId = String(row.customer_id);
      const list = notificationGroups.get(userId) ?? [];
      list.push({
        id: String(row.id),
        type: String(row.notification_type),
        title: String(row.title),
        body: String(row.body),
        resourceId: row.resource_id === null ? null : String(row.resource_id),
        resourceAccountId: row.resource_account_id ? String(row.resource_account_id) : null,
        read: Boolean(row.is_read),
        createdAt: asIso(row.created_at),
      });
      notificationGroups.set(userId, list);
    }

    const state: BankingSystemState = {
      stateVersion: 5,
      core: {
        accounts: accountEntries,
        transactions: [...transactionByAccount.entries()],
        transfers: coreTransferEntries,
        savingsOpenings: runtimeEntries("core.savingsOpenings") as any,
        creditPayments: runtimeEntries("core.creditPayments") as any,
        ledger: { journals: ledgerJournals },
      },
      users: userEntries,
      accessSessions: runtimeEntries("accessSessions") as any,
      authChallenges: runtimeEntries("authChallenges") as any,
      pendingRegistrations: runtimeEntries("pendingRegistrations") as any,
      authAttemptWindows: runtimeEntries("authAttemptWindows") as any,
      registrationAttemptWindows: runtimeEntries("registrationAttemptWindows") as any,
      transferStepUpAttemptWindows: runtimeEntries("transferStepUpAttemptWindows") as any,
      savingsStepUpAttemptWindows: runtimeEntries("savingsStepUpAttemptWindows") as any,
      creditStepUpAttemptWindows: runtimeEntries("creditStepUpAttemptWindows") as any,
      refreshSessions: runtimeEntries("refreshSessions") as any,
      refreshFamilies: runtimeEntries("refreshFamilies") as any,
      beneficiaries: [...beneficiaryGroups.entries()],
      recipientLookups: runtimeEntries("recipientLookups") as any,
      notifications: [...notificationGroups.entries()],
      quotes: quoteEntries,
      transfers: transferReceiptEntries,
      idempotency: runtimeEntries("idempotency") as any,
      fundingIdempotency: runtimeEntries("fundingIdempotency") as any,
      savingsQuotes: runtimeEntries("savingsQuotes") as any,
      savingsOpenings: runtimeEntries("savingsOpenings") as any,
      savingsDeposits: runtimeEntries("savingsDeposits") as any,
      savingsIdempotency: runtimeEntries("savingsIdempotency") as any,
      creditCards: runtimeEntries("creditCards") as any,
      creditAccounts: runtimeEntries("creditAccounts") as any,
      creditTransactions: runtimeEntries("creditTransactions") as any,
      creditStatements: runtimeEntries("creditStatements") as any,
      creditQuotes: runtimeEntries("creditQuotes") as any,
      creditPayments: runtimeEntries("creditPayments") as any,
      creditIdempotency: runtimeEntries("creditIdempotency") as any,
      creditSeedPurchases: runtimeEntries("creditSeedPurchases") as any,
      creditApplications: runtimeEntries("creditApplications") as any,
      creditApplicationIdempotency: runtimeEntries("creditApplicationIdempotency") as any,
      creditActivationIdempotency: runtimeEntries("creditActivationIdempotency") as any,
      auditEventStore: (auditEvents.rows as Row[]).map((row) => ({
        id: String(row.id),
        eventType: String(row.event_type),
        actorUserId: row.actor_customer_id ? String(row.actor_customer_id) : null,
        resourceId: row.resource_id ? String(row.resource_id) : null,
        occurredAt: asIso(row.occurred_at),
      })),
      outboxEventStore: (outboxEvents.rows as Row[]).map((row) => ({
        id: String(row.id),
        eventType: String(row.event_type),
        aggregateId: String(row.aggregate_id),
        occurredAt: asIso(row.occurred_at),
        published: row.published_at !== null,
        attempts: Number(row.attempts ?? 0),
        nextAttemptAt: asNullableIso(row.next_attempt_at),
      })),
    };

    // The account transaction table is the canonical history source.  Attach
    // its transfer relation only to the in-memory core state consumers.
    void transferByTransactionId;
    return state;
  }

  private async writeState(client: PoolClient, state: BankingSystemState): Promise<void> {
    await this.truncateRelationalState(client);
    const now = new Date().toISOString();
    const userIds = new Set(state.users.map(([userId]) => userId));

    for (const [, user] of state.users) {
      const record = asRecord(user);
      await client.query(
        `
          INSERT INTO customers
            (id, full_name, email, phone_number, password_salt, password_digest, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          record.id,
          record.fullName,
          record.email,
          record.phoneNumber,
          record.passwordSalt,
          record.passwordDigest,
          record.createdAt,
        ],
      );
    }

    for (const [, account] of state.core.accounts) {
      const record = asRecord(account);
      const accountNumber = String(
        record.accountNumber ?? fallbackAccountNumber(String(record.id), String(record.maskedNumber)),
      );
      await client.query(
        `
          INSERT INTO payment_accounts
            (id, customer_id, display_name, masked_number, currency,
             available_minor, current_minor, status, version, updated_at,
             account_number, bank_name, opening_balance_minor, held_minor)
          VALUES ($1, $2, $3, $4, 'VND', $5, $6, $7, 0, $8, $9, $10, $11, $12)
        `,
        [
          record.id,
          record.ownerId,
          record.displayName,
          record.maskedNumber,
          record.availableMinor,
          record.currentMinor,
          record.status,
          record.updatedAt,
          accountNumber,
          record.bankName ?? "Ngân hàng reference",
          record.openingBalanceMinor ?? "0",
          record.heldMinor ?? "0",
        ],
      );
    }

    for (const [userId, items] of state.beneficiaries) {
      for (const item of items) {
        const record = asRecord(item);
        await client.query(
          `
            INSERT INTO beneficiaries
              (id, customer_id, display_name, account_holder_name,
               masked_account_number, account_number_fingerprint, bank_name,
               status, destination_account_id, destination_owner_id, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `,
          [
            record.id,
            userId,
            record.displayName,
            record.accountHolderName ?? record.displayName,
            record.maskedAccountNumber,
            record.accountNumberFingerprint,
            record.bankName,
            record.status,
            isUuid(record.destinationAccountId) ? record.destinationAccountId : null,
            isUuid(record.destinationOwnerId) ? record.destinationOwnerId : null,
            now,
          ],
        );
      }
    }

    const quoteByTransferId = new Map<string, any>();
    for (const [quoteId, recordValue] of state.quotes) {
      const record = asRecord(recordValue);
      const quote = asRecord(record.quote);
      const beneficiary = asRecord(quote.beneficiary);
      const consumedTransferId = record.consumedTransferId;
      if (consumedTransferId) {
        quoteByTransferId.set(String(consumedTransferId), { quoteId, record });
      }
      await client.query(
        `
          INSERT INTO transfer_quotes
            (id, customer_id, source_account_id, beneficiary_id,
             amount_minor, fee_minor, currency, expires_at, consumed_at,
             created_at, beneficiary_snapshot, destination_account_id,
             destination_owner_id, consumed_transfer_id)
          VALUES ($1, $2, $3, $4, $5, $6, 'VND', $7, $8, $9, $10::jsonb, $11, $12, $13)
        `,
        [
          quote.quoteId,
          record.userId,
          quote.sourceAccountId,
          isUuid(beneficiary.id) ? beneficiary.id : null,
          quote.amount.amountMinor,
          quote.fee.amountMinor,
          quote.expiresAt,
          consumedTransferId ? now : null,
          now,
          JSON.stringify(beneficiary),
          isUuid(record.destinationAccountId) ? record.destinationAccountId : null,
          isUuid(record.destinationOwnerId) ? record.destinationOwnerId : null,
          isUuid(consumedTransferId) ? consumedTransferId : null,
        ],
      );
    }

    const coreTransferById = new Map<string, any>(state.core.transfers);
    const idempotencyByTransferId = new Map<string, { key: string; record: Row }>();
    for (const [key, value] of state.idempotency) {
      const record = asRecord(value);
      const transferId = asRecord(record.receipt).transferId;
      if (typeof transferId === "string") {
        idempotencyByTransferId.set(transferId, { key, record });
      }
    }

    for (const [transferId, recordValue] of state.transfers) {
      const record = asRecord(recordValue);
      const receipt = asRecord(record.receipt);
      const core = asRecord(coreTransferById.get(transferId));
      const idempotency = idempotencyByTransferId.get(transferId);
      const userId = String(record.userId);
      const quote = quoteByTransferId.get(transferId);
      if (!quote) {
        throw new Error(`Cannot persist transfer ${transferId} without its consumed quote.`);
      }
      const idempotencyKey = idempotency
        ? idempotency.key.startsWith(`${userId}:`)
          ? idempotency.key.slice(userId.length + 1)
          : idempotency.key
        : `legacy-${transferId}`;
      await client.query(
        `
          INSERT INTO transfers
            (id, customer_id, source_account_id, quote_id, idempotency_key,
             request_fingerprint, reference, amount_minor, fee_minor,
             currency, status, created_at, updated_at, destination_account_id,
             destination_owner_id, source_transaction_id,
             destination_transaction_id, ledger_journal_id, refunded, held_minor)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'VND', $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        `,
        [
          transferId,
          userId,
          core.accountId ?? "",
          quote.quoteId,
          idempotencyKey,
          idempotency?.record.fingerprint ?? "legacy-relational-record",
          receipt.reference,
          receipt.amount.amountMinor,
          receipt.fee.amountMinor,
          receipt.status,
          receipt.createdAt,
          receipt.updatedAt,
          isUuid(core.destinationAccountId) ? core.destinationAccountId : null,
          isUuid(core.destinationOwnerId) ? core.destinationOwnerId : null,
          isUuid(core.transactionId) ? core.transactionId : null,
          isUuid(core.destinationTransactionId) ? core.destinationTransactionId : null,
          isUuid(core.ledgerJournalId) ? core.ledgerJournalId : null,
          Boolean(core.refunded),
          core.heldMinor ?? "0",
        ],
      );
    }

    const journalIds = new Map<string, string>();
    for (const [journalId, journalEntries] of state.core.ledger.journals) {
      const dbId = isUuid(journalId) ? journalId : randomUUID();
      journalIds.set(journalId, dbId);
      const firstOccurredAt = asRecord(journalEntries[0]).occurredAt ?? now;
      await client.query(
        `
          INSERT INTO ledger_journals
            (id, aggregate_id, journal_type, currency, occurred_at, created_at)
          VALUES ($1, $2, 'REFERENCE', 'VND', $3, $3)
        `,
        [dbId, journalId, firstOccurredAt],
      );
      let lineNumber = 1;
      for (const entryValue of journalEntries) {
        const entry = asRecord(entryValue);
        await client.query(
          `
            INSERT INTO ledger_entries
              (journal_id, line_number, account_ref, side, amount_minor,
               currency, entry_id, occurred_at)
            VALUES ($1, $2, $3, $4, $5, 'VND', $6, $7)
          `,
          [
            dbId,
            lineNumber,
            entry.accountId,
            entry.side,
            entry.amountMinor,
            isUuid(entry.id) ? entry.id : randomUUID(),
            entry.occurredAt ?? firstOccurredAt,
          ],
        );
        lineNumber += 1;
      }
      const persistedEntryCount = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM ledger_entries WHERE journal_id = $1",
        [dbId],
      );
      if (persistedEntryCount.rows[0]?.count === "0") {
        throw new Error(`Relational ledger journal ${journalId} was written without entries.`);
      }
    }

    for (const [accountId, items] of state.core.transactions) {
      for (const itemValue of items) {
        const item = asRecord(itemValue);
        const transferId = [...coreTransferById.entries()].find(([, transfer]) => {
          const core = asRecord(transfer);
          return core.transactionId === item.id || core.destinationTransactionId === item.id;
        })?.[0] ?? null;
        await client.query(
          `
            INSERT INTO account_transactions
              (id, account_id, transfer_id, direction, amount_minor,
               fee_minor, currency, status, description, counterparty_name,
               reference, occurred_at, created_at, completed_at, kind)
            VALUES ($1, $2, $3, $4, $5, $6, 'VND', $7, $8, $9, $10, $11, $12, $13, $14)
          `,
          [
            item.id,
            accountId,
            isUuid(transferId) ? transferId : null,
            item.direction,
            item.amount.amountMinor,
            item.fee.amountMinor,
            item.status,
            item.description,
            item.counterpartyName ?? null,
            item.reference,
            item.occurredAt,
            item.createdAt,
            item.completedAt ?? null,
            item.kind ?? null,
          ],
        );
      }
    }

    for (const [userId, items] of state.notifications) {
      for (const itemValue of items) {
        const item = asRecord(itemValue);
        const notificationType = item.type === "SANDBOX_FUNDING" ? "SECURITY" : item.type;
        await client.query(
          `
            INSERT INTO notifications
              (id, customer_id, notification_type, title, body, resource_id,
               resource_account_id, is_read, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [
            item.id,
            userId,
            notificationType,
            item.title,
            item.body,
            item.resourceId ?? null,
            isUuid(item.resourceAccountId) ? item.resourceAccountId : null,
            Boolean(item.read),
            item.createdAt,
          ],
        );
      }
    }

    for (const event of state.auditEventStore) {
      await client.query(
        `
          INSERT INTO audit_events
            (id, event_type, actor_customer_id, resource_id, occurred_at, payload)
          VALUES ($1, $2, $3, $4, $5, '{}'::jsonb)
        `,
        [
          event.id,
          event.eventType,
          event.actorUserId && userIds.has(event.actorUserId) && isUuid(event.actorUserId)
            ? event.actorUserId
            : null,
          event.resourceId,
          event.occurredAt,
        ],
      );
    }

    for (const event of state.outboxEventStore) {
      await client.query(
        `
          INSERT INTO outbox_events
            (id, event_type, aggregate_id, payload, occurred_at,
             published_at, attempts, next_attempt_at)
          VALUES ($1, $2, $3, '{}'::jsonb, $4, $5, $6, $7)
        `,
        [
          event.id,
          event.eventType,
          event.aggregateId,
          event.occurredAt,
          event.published ? event.occurredAt : null,
          event.attempts ?? 0,
          event.nextAttemptAt ?? null,
        ],
      );
    }

    const runtimeCollections: Array<[string, unknown]> = [
      ["accessSessions", state.accessSessions],
      ["authChallenges", state.authChallenges],
      ["pendingRegistrations", state.pendingRegistrations ?? []],
      ["authAttemptWindows", state.authAttemptWindows],
      ["registrationAttemptWindows", state.registrationAttemptWindows],
      ["transferStepUpAttemptWindows", state.transferStepUpAttemptWindows],
      ["savingsStepUpAttemptWindows", state.savingsStepUpAttemptWindows ?? []],
      ["creditStepUpAttemptWindows", state.creditStepUpAttemptWindows ?? []],
      ["refreshSessions", state.refreshSessions],
      ["refreshFamilies", state.refreshFamilies],
      ["recipientLookups", state.recipientLookups ?? []],
      ["idempotency", state.idempotency],
      ["fundingIdempotency", state.fundingIdempotency ?? []],
      ["savingsQuotes", state.savingsQuotes ?? []],
      ["savingsOpenings", state.savingsOpenings ?? []],
      ["savingsDeposits", state.savingsDeposits ?? []],
      ["savingsIdempotency", state.savingsIdempotency ?? []],
      ["creditCards", state.creditCards ?? []],
      ["creditAccounts", state.creditAccounts ?? []],
      ["creditTransactions", state.creditTransactions ?? []],
      ["creditStatements", state.creditStatements ?? []],
      ["creditQuotes", state.creditQuotes ?? []],
      ["creditPayments", state.creditPayments ?? []],
      ["creditIdempotency", state.creditIdempotency ?? []],
      ["creditSeedPurchases", state.creditSeedPurchases ?? []],
      ["creditApplications", state.creditApplications ?? []],
      ["creditApplicationIdempotency", state.creditApplicationIdempotency ?? []],
      ["creditActivationIdempotency", state.creditActivationIdempotency ?? []],
      ["core.savingsOpenings", state.core.savingsOpenings ?? []],
      ["core.creditPayments", state.core.creditPayments ?? []],
    ];
    for (const [collection, value] of runtimeCollections) {
      for (const [recordKey, payload] of arrayEntries(value)) {
        await client.query(
          `
            INSERT INTO reference_runtime_records
              (collection, record_key, payload, updated_at)
            VALUES ($1, $2, $3::jsonb, $4)
          `,
          [collection, recordKey, JSON.stringify(payload), now],
        );
      }
    }

    void journalIds;
  }

  private async truncateRelationalState(client: PoolClient): Promise<void> {
    // DELETE is used instead of TRUNCATE because the draft ledger schema has
    // deferred constraint triggers; PostgreSQL rejects a second TRUNCATE in a
    // transaction that already queued those trigger events.
    for (const table of [
      "reference_runtime_records",
      "outbox_events",
      "audit_events",
      "fraud_reports",
      "notifications",
      "account_transactions",
      "credit_statement_items",
      "credit_payments",
      "credit_payment_quotes",
      "credit_transactions",
      "credit_statements",
      "credit_cards",
      "credit_accounts",
      "savings_deposits",
      "savings_openings",
      "savings_quotes",
      "transfers",
      "transfer_quotes",
      "beneficiaries",
      "payment_accounts",
      "ledger_entries",
      "ledger_journals",
      "auth_sessions",
      "customer_devices",
      "customers",
    ]) {
      await client.query(`DELETE FROM ${table}`);
    }
  }
}

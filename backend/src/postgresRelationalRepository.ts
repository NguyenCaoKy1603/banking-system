import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import {
  BANKING_SYSTEM_STATE_VERSION,
  type BankingSystemState,
} from "./bankingSystem.js";
import { DatabasePool, type DatabasePoolMetrics } from "./database/pool.js";
import { UnitOfWork } from "./database/unitOfWork.js";

export type RelationalStateOperation<T> = (state: unknown) => Promise<{
  result: T;
  nextState: unknown;
}>;

export type RelationalStateBoundaryOptions = {
  /**
   * MFA owns lockable PostgreSQL tables outside the legacy full-state replay.
   * Preserve those rows while the compatibility adapter rewrites banking
   * aggregates for the current request.
   */
  preservePersistentAuthState?: boolean;
};

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

type PreservedPersistentAuthState = {
  mfaCredentials: Row[];
  mfaChallenges: Row[];
  mfaRecoveryCodes: Row[];
  mfaRecoveryRequests: Row[];
  authSecurityEvents: Row[];
  pendingRegistrations: Row[];
  rateLimitBuckets: Row[];
  registrationCompletions: Row[];
};

async function readRows(client: PoolClient, table: string): Promise<Row[]> {
  const result = await client.query(`SELECT * FROM ${table}`);
  return result.rows as Row[];
}

async function insertRow(
  client: PoolClient,
  table: string,
  columns: readonly string[],
  row: Row,
): Promise<void> {
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  await client.query(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
    columns.map((column) => row[column] ?? null),
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
  private readonly pool: DatabasePool;
  private readonly legacySnapshotKey: string;
  readonly unitOfWork: UnitOfWork;

  constructor(options: PostgresRelationalRepositoryOptions = {}) {
    const connectionString = options.connectionString ?? process.env.DATABASE_URL;
    if (!connectionString?.trim()) {
      throw new Error("DATABASE_URL is required for the PostgreSQL relational adapter.");
    }

    this.legacySnapshotKey =
      options.legacySnapshotKey ?? process.env.BANKING_SNAPSHOT_KEY ?? "banking-reference-sandbox";
    this.pool = new DatabasePool({
      connectionString,
      max: options.maxConnections ?? 4,
    });
    this.unitOfWork = new UnitOfWork(this.pool);
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
    const mfaTables = await this.pool.query<{ credential_table: string | null; event_table: string | null }>(
      `SELECT to_regclass('public.mfa_credentials') AS credential_table,
              to_regclass('public.auth_security_events') AS event_table`,
    );
    if (!mfaTables.rows[0]?.credential_table || !mfaTables.rows[0]?.event_table) {
      throw new Error(
        "PostgreSQL MFA schema is not initialized. Run `npm run db:migrate` before starting the persistent backend.",
      );
    }
  }

  async withState<T>(
    initialState: unknown,
    operation: RelationalStateOperation<T>,
    boundaryOptions: RelationalStateBoundaryOptions = {},
  ): Promise<T> {
    if (process.env.BANKING_PERSISTENCE_MODE?.trim() === "relational-v2") {
      throw new Error(
        "Legacy PostgresRelationalRepository is disabled in relational-v2 mode; use direct transactional repositories before enabling the worker.",
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Once a worker has a live heartbeat, the legacy full-state replay would
      // delete/reinsert outbox and delivery rows. Refuse that write boundary
      // instead of silently overwriting worker-owned state.
      const workerTable = await client.query<{ table_name: string | null }>(
        "SELECT to_regclass('public.worker_instances') AS table_name",
      );
      if (workerTable.rows[0]?.table_name) {
        const activeWorker = await client.query(
          `SELECT worker_id FROM worker_instances
           WHERE status IN ('STARTING', 'READY', 'DRAINING')
             AND last_heartbeat_at >= NOW() - INTERVAL '90 seconds'
           LIMIT 1`,
        );
        if ((activeWorker.rowCount ?? 0) > 0) {
          throw new Error(
            "Legacy PostgresRelationalRepository refuses to write while an outbox worker heartbeat is active; complete the relational-v2 HTTP cutover first.",
          );
        }
      }
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('banking-relational-reference', 0))",
      );
      const current = await this.readState(client, initialState);
      const { result, nextState } = await operation(current);
      const preservedPersistentAuthState = boundaryOptions.preservePersistentAuthState
        ? await this.snapshotPersistentAuthState(client)
        : undefined;
      await this.writeState(client, nextState as BankingSystemState, boundaryOptions);
      if (preservedPersistentAuthState) {
        await this.restorePersistentAuthState(client, preservedPersistentAuthState);
      }
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

  async customerAccessStatus(customerId: string): Promise<"ACTIVE" | "LOCKED" | null> {
    const result = await this.pool.query<{ access_status: string | null }>(
      "SELECT COALESCE(access_status, 'ACTIVE') AS access_status FROM customers WHERE id = $1",
      [customerId],
    );
    const status = result.rows[0]?.access_status;
    return status === "LOCKED" ? "LOCKED" : status ? "ACTIVE" : null;
  }

  async close(): Promise<void> {
    await this.pool.close();
  }

  poolMetrics(): DatabasePoolMetrics {
    return this.pool.metrics();
  }

  unitOfWorkMetrics() {
    return this.unitOfWork.metrics();
  }

  async clear(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // `clear` is an explicit disposable-test operation, not the request
      // boundary.  Use TRUNCATE ... CASCADE so the append-only audit trigger
      // is bypassed only for this opt-in reset path; normal public requests
      // use the compatibility-preserving writer above.
      await client.query(`
        TRUNCATE TABLE
          reference_state_snapshots,
          reference_runtime_records,
          audit_events,
          outbox_events,
          ledger_entries,
          ledger_journals,
          staff_users,
          customers
        RESTART IDENTITY CASCADE
      `);
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
    const fraudReports = await client.query("SELECT * FROM fraud_reports ORDER BY created_at, id");
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
        // Older Admin domain adapters persisted payment accounts with the
        // `payment-account:` namespace while the in-memory core identifies
        // accounts by their bare UUID.  Normalize both representations at
        // the relational boundary so reconciliation and subsequent writes
        // use one canonical account identity.
        accountId: String(row.account_ref).startsWith("payment-account:")
          ? String(row.account_ref).slice("payment-account:".length)
          : String(row.account_ref),
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
        quoteId: String(row.quote_id),
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
      stateVersion: BANKING_SYSTEM_STATE_VERSION,
      core: {
        accounts: accountEntries,
        transactions: [...transactionByAccount.entries()],
        transfers: coreTransferEntries,
        savingsOpenings: runtimeEntries("core.savingsOpenings") as any,
        savingsMaturities: runtimeEntries("core.savingsMaturities") as any,
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
      fraudReports: (fraudReports.rows as Row[]).map((row) => [
        String(row.id),
        {
          reportId: String(row.id),
          userId: String(row.customer_id),
          accountId: String(row.account_id),
          transactionId: String(row.transaction_id),
          reason: String(row.reason),
          status: String(row.status),
          createdAt: asIso(row.created_at),
        },
      ]) as any,
      fraudReportIdempotency: runtimeEntries("fraudReportIdempotency") as any,
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

  private async snapshotPersistentAuthState(client: PoolClient): Promise<PreservedPersistentAuthState> {
    return {
      mfaCredentials: await readRows(client, "mfa_credentials"),
      mfaChallenges: await readRows(client, "auth_challenges"),
      mfaRecoveryCodes: await readRows(client, "mfa_recovery_codes"),
      mfaRecoveryRequests: await readRows(client, "mfa_recovery_requests"),
      authSecurityEvents: await readRows(client, "auth_security_events"),
      pendingRegistrations: await readRows(client, "pending_registrations"),
      rateLimitBuckets: await readRows(client, "rate_limit_buckets"),
      registrationCompletions: await readRows(client, "registration_completions"),
    };
  }

  private async restorePersistentAuthState(
    client: PoolClient,
    snapshot: PreservedPersistentAuthState,
  ): Promise<void> {
    const customerResult = await client.query<{ id: string }>("SELECT id::text AS id FROM customers");
    const customerIds = new Set(customerResult.rows.map((row) => String(row.id)));
    const pendingResult = await client.query<{ id: string }>("SELECT id FROM pending_registrations");
    const pendingIds = new Set(pendingResult.rows.map((row) => String(row.id)));
    const accountResult = await client.query<{ id: string }>("SELECT id::text AS id FROM payment_accounts");
    const accountIds = new Set(accountResult.rows.map((row) => String(row.id)));
    const credentialIds = new Set<string>();

    for (const row of snapshot.pendingRegistrations) {
      await insertRow(client, "pending_registrations", [
        "id", "full_name", "email", "phone_number", "password_salt", "password_digest",
        "device_id", "challenge_id", "expires_at", "created_at",
      ], row);
      pendingIds.add(String(row.id));
    }
    for (const row of snapshot.rateLimitBuckets) {
      await insertRow(client, "rate_limit_buckets", [
        "bucket_key", "window_started_at", "attempts", "updated_at",
      ], row);
    }
    for (const row of snapshot.mfaCredentials) {
      if (customerIds.has(String(row.customer_id))) {
        await insertRow(client, "mfa_credentials", [
          "id", "customer_id", "credential_type", "display_name", "status",
          "secret_ciphertext", "secret_key_id", "algorithm", "digits", "period_seconds",
          "last_accepted_time_step", "enrolled_at", "last_used_at", "revoked_at",
          "compromised_at", "created_at", "updated_at",
        ], row);
        credentialIds.add(String(row.id));
      }
    }
    for (const row of snapshot.mfaRecoveryCodes) {
      if (customerIds.has(String(row.customer_id))) {
        await insertRow(client, "mfa_recovery_codes", [
          "id", "customer_id", "code_digest", "salt", "digest_key_id", "status",
          "created_at", "used_at", "revoked_at",
        ], row);
      }
    }
    for (const row of snapshot.mfaRecoveryRequests) {
      if (customerIds.has(String(row.customer_id))) {
        await insertRow(client, "mfa_recovery_requests", [
          "id", "customer_id", "public_token_hash", "status", "requested_method", "risk_level",
          "requested_at", "expires_at", "verified_at", "approved_at", "completed_at",
          "cancelled_at", "cooldown_until", "reviewed_by", "review_reason", "created_at", "updated_at",
        ], row);
      }
    }

    const restoredChallengeIds = new Set<string>();
    for (const row of snapshot.mfaChallenges) {
      const customerId = row.customer_id === null ? null : String(row.customer_id);
      const pendingRegistrationId = row.pending_registration_id === null
        ? null
        : String(row.pending_registration_id);
      const credentialId = row.credential_id === null ? null : String(row.credential_id);
      if (
        (customerId !== null && !customerIds.has(customerId)) ||
        (pendingRegistrationId !== null && !pendingIds.has(pendingRegistrationId)) ||
        (credentialId !== null && !credentialIds.has(credentialId))
      ) {
        continue;
      }
      await insertRow(client, "auth_challenges", [
        "id", "customer_id", "pending_registration_id", "credential_id", "device_id",
        "method", "purpose", "resource_id", "request_fingerprint", "methods", "otp_hash",
        "expires_at", "attempts", "created_at", "consumed_at", "proof_digest", "digest_key_id",
        "max_attempts", "resend_count", "last_sent_at", "verified_at", "cancelled_at", "locked_at",
        "created_ip_fingerprint", "created_device_fingerprint", "status", "updated_at",
      ], row);
      restoredChallengeIds.add(String(row.id));
    }
    for (const row of snapshot.authSecurityEvents) {
      const customerId = row.customer_id === null ? null : String(row.customer_id);
      const challengeId = row.challenge_id === null ? null : String(row.challenge_id);
      if (
        (customerId !== null && !customerIds.has(customerId)) ||
        (challengeId !== null && !restoredChallengeIds.has(challengeId))
      ) {
        continue;
      }
      await insertRow(client, "auth_security_events", [
        "id", "customer_id", "event_type", "purpose", "device_fingerprint",
        "network_fingerprint", "risk_score", "risk_decision", "challenge_id", "resource_id",
        "occurred_at", "metadata",
      ], row);
    }
    for (const row of snapshot.registrationCompletions) {
      if (
        pendingIds.has(String(row.pending_registration_id)) &&
        customerIds.has(String(row.customer_id)) &&
        accountIds.has(String(row.account_id))
      ) {
        await insertRow(client, "registration_completions", [
          "pending_registration_id", "customer_id", "account_id", "created_at",
        ], row);
      }
    }
  }

  private async writeState(
    client: PoolClient,
    state: BankingSystemState,
    boundaryOptions: RelationalStateBoundaryOptions = {},
  ): Promise<void> {
    await this.truncateRelationalState(client, boundaryOptions);
    const now = new Date().toISOString();
    const userIds = new Set(state.users.map(([userId]) => userId));

    for (const [, user] of state.users) {
      const record = asRecord(user);
      await client.query(
        `
          INSERT INTO customers
            (id, full_name, email, phone_number, password_salt, password_digest, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            email = EXCLUDED.email,
            phone_number = EXCLUDED.phone_number,
            password_salt = EXCLUDED.password_salt,
            password_digest = EXCLUDED.password_digest
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
          ON CONFLICT (id) DO UPDATE SET
            customer_id = EXCLUDED.customer_id,
            display_name = EXCLUDED.display_name,
            masked_number = EXCLUDED.masked_number,
            available_minor = EXCLUDED.available_minor,
            current_minor = EXCLUDED.current_minor,
            status = EXCLUDED.status,
            updated_at = EXCLUDED.updated_at,
            account_number = EXCLUDED.account_number,
            bank_name = EXCLUDED.bank_name,
            opening_balance_minor = EXCLUDED.opening_balance_minor,
            held_minor = EXCLUDED.held_minor,
            version = GREATEST(payment_accounts.version, EXCLUDED.version)
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
            ON CONFLICT (id) DO UPDATE SET
              customer_id = EXCLUDED.customer_id,
              display_name = EXCLUDED.display_name,
              account_holder_name = EXCLUDED.account_holder_name,
              masked_account_number = EXCLUDED.masked_account_number,
              account_number_fingerprint = EXCLUDED.account_number_fingerprint,
              bank_name = EXCLUDED.bank_name,
              status = EXCLUDED.status,
              destination_account_id = EXCLUDED.destination_account_id,
              destination_owner_id = EXCLUDED.destination_owner_id
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
      // A few historical reference fixtures persisted the transfer relation
      // without the deferred consumed-transfer edge. Keep the quote keyed by
      // its own ID as a compatibility fallback for that data.
      quoteByTransferId.set(String(quoteId), { quoteId, record });
      await client.query(
        `
          INSERT INTO transfer_quotes
            (id, customer_id, source_account_id, beneficiary_id,
             amount_minor, fee_minor, currency, expires_at, consumed_at,
             created_at, beneficiary_snapshot, destination_account_id,
             destination_owner_id, consumed_transfer_id, request_fingerprint)
            VALUES ($1, $2, $3, $4, $5, $6, 'VND', $7, $8, $9, $10::jsonb, $11, $12, $13, $14)
          ON CONFLICT (id) DO UPDATE SET
            customer_id = EXCLUDED.customer_id,
            source_account_id = EXCLUDED.source_account_id,
            beneficiary_id = EXCLUDED.beneficiary_id,
            amount_minor = EXCLUDED.amount_minor,
            fee_minor = EXCLUDED.fee_minor,
            expires_at = EXCLUDED.expires_at,
            consumed_at = EXCLUDED.consumed_at,
            beneficiary_snapshot = EXCLUDED.beneficiary_snapshot,
            destination_account_id = EXCLUDED.destination_account_id,
            destination_owner_id = EXCLUDED.destination_owner_id,
            consumed_transfer_id = EXCLUDED.consumed_transfer_id,
            request_fingerprint = EXCLUDED.request_fingerprint
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
          String(record.requestFingerprint ?? `legacy-transfer-quote:${quote.quoteId}`),
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
      const quote =
        quoteByTransferId.get(transferId) ??
        quoteByTransferId.get(String(core.quoteId ?? ""));
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
          ON CONFLICT (id) DO UPDATE SET
            customer_id = EXCLUDED.customer_id,
            source_account_id = EXCLUDED.source_account_id,
            quote_id = EXCLUDED.quote_id,
            idempotency_key = EXCLUDED.idempotency_key,
            request_fingerprint = EXCLUDED.request_fingerprint,
            reference = EXCLUDED.reference,
            amount_minor = EXCLUDED.amount_minor,
            fee_minor = EXCLUDED.fee_minor,
            status = EXCLUDED.status,
            updated_at = EXCLUDED.updated_at,
            destination_account_id = EXCLUDED.destination_account_id,
            destination_owner_id = EXCLUDED.destination_owner_id,
            source_transaction_id = EXCLUDED.source_transaction_id,
            destination_transaction_id = EXCLUDED.destination_transaction_id,
            ledger_journal_id = EXCLUDED.ledger_journal_id,
            refunded = EXCLUDED.refunded,
            held_minor = EXCLUDED.held_minor
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
      const firstOccurredAt = asRecord(journalEntries[0]).occurredAt ?? now;
      const existingJournal = await client.query<{ id: string }>(
        "SELECT id::text AS id FROM ledger_journals WHERE aggregate_id = $1 ORDER BY created_at, id LIMIT 1",
        [journalId],
      );
      let dbId = existingJournal.rows[0]?.id;
      if (!dbId) {
        dbId = isUuid(journalId) ? journalId : randomUUID();
        await client.query(
        `
          INSERT INTO ledger_journals
            (id, aggregate_id, journal_type, currency, occurred_at, created_at)
          VALUES ($1, $2, 'REFERENCE', 'VND', $3, $3)
          ON CONFLICT (journal_type, aggregate_id) DO NOTHING
        `,
          [dbId, journalId, firstOccurredAt],
        );
        const insertedJournal = await client.query<{ id: string }>(
          "SELECT id::text AS id FROM ledger_journals WHERE aggregate_id = $1 ORDER BY created_at, id LIMIT 1",
          [journalId],
        );
        dbId = insertedJournal.rows[0]?.id ?? dbId;
      }
      journalIds.set(journalId, dbId);
      let lineNumber = 1;
      for (const entryValue of journalEntries) {
        const entry = asRecord(entryValue);
        await client.query(
          `
            INSERT INTO ledger_entries
              (journal_id, line_number, account_ref, side, amount_minor,
               currency, entry_id, occurred_at)
            VALUES ($1, $2, $3, $4, $5, 'VND', $6, $7)
            ON CONFLICT (journal_id, line_number) DO NOTHING
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
            ON CONFLICT (id) DO UPDATE SET
              account_id = EXCLUDED.account_id,
              transfer_id = EXCLUDED.transfer_id,
              direction = EXCLUDED.direction,
              amount_minor = EXCLUDED.amount_minor,
              fee_minor = EXCLUDED.fee_minor,
              status = EXCLUDED.status,
              description = EXCLUDED.description,
              counterparty_name = EXCLUDED.counterparty_name,
              reference = EXCLUDED.reference,
              occurred_at = EXCLUDED.occurred_at,
              completed_at = EXCLUDED.completed_at,
              kind = EXCLUDED.kind
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

    for (const [, report] of state.fraudReports ?? []) {
      await client.query(
        `
          INSERT INTO fraud_reports
            (id, customer_id, account_id, transaction_id, reason, status, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO UPDATE SET
            customer_id = EXCLUDED.customer_id,
            account_id = EXCLUDED.account_id,
            transaction_id = EXCLUDED.transaction_id,
            reason = EXCLUDED.reason,
            status = EXCLUDED.status
        `,
        [
          report.reportId,
          report.userId,
          report.accountId,
          report.transactionId,
          report.reason,
          report.status,
          report.createdAt,
        ],
      );
    }

    for (const event of state.auditEventStore) {
      await client.query(
        `
          INSERT INTO audit_events
            (id, event_type, actor_customer_id, resource_id, occurred_at, payload)
          VALUES ($1, $2, $3, $4, $5, '{}'::jsonb)
          ON CONFLICT (id) DO NOTHING
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
            (id, event_type, event_version, aggregate_type, aggregate_id,
             aggregate_version, deduplication_key, payload, status, priority,
             occurred_at, published_at, attempts, next_attempt_at,
             created_at, updated_at)
          VALUES ($1, $2, 1, 'legacy', $3, 1, $4, '{}'::jsonb, $5, 100,
                  $6, $7, $8, $9, $6, $6)
          ON CONFLICT (id) DO NOTHING
        `,
        [
          event.id,
          event.eventType,
          event.aggregateId,
          `legacy:${event.id}`,
          event.published ? "DISPATCHED" : "PENDING",
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
      ["fraudReportIdempotency", state.fraudReportIdempotency ?? []],
      ["core.savingsOpenings", state.core.savingsOpenings ?? []],
      ["core.savingsMaturities", state.core.savingsMaturities ?? []],
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

  private async truncateRelationalState(
    client: PoolClient,
    boundaryOptions: RelationalStateBoundaryOptions = {},
  ): Promise<void> {
    // DELETE is used instead of TRUNCATE because the draft ledger schema has
    // deferred constraint triggers; PostgreSQL rejects a second TRUNCATE in a
    // transaction that already queued those trigger events.
    // The v2 quote/transfer relation is bidirectional, so clear the optional
    // consumed-transfer edge before deleting either side of the cycle.
    await client.query(
      "UPDATE transfer_quotes SET consumed_transfer_id = NULL WHERE consumed_transfer_id IS NOT NULL",
    );
    if (boundaryOptions.preservePersistentAuthState) {
      // These rows are owned by the persistent MFA boundary, not by the
      // legacy JSON replay. Remove them only temporarily so customer/account
      // rows can be rewritten without violating foreign keys; the caller
      // restores the snapshot immediately before COMMIT.
      for (const table of [
        "auth_security_events",
        "mfa_recovery_codes",
        "mfa_recovery_requests",
        "auth_challenges",
        "mfa_credentials",
      ]) {
        await client.query(`DELETE FROM ${table}`);
      }
    }
    for (const table of [
      // Transitional compatibility only.  The legacy state adapter is not
      // allowed to leave v2 rows pointing at customers it is about to replay.
      "savings_maturity_operations",
      "savings_idempotency",
      "credit_idempotency",
      "refresh_session_records",
      "refresh_session_families",
      "auth_challenges",
      "pending_registrations",
      "rate_limit_buckets",
      "command_idempotency",
      "registration_completions",
      "reference_runtime_records",
      // Admin control-plane rows are independent sources of truth. They are
      // intentionally not part of the legacy replay deletion set; deleting
      // them would violate the append-only audit trigger and could destroy a
      // pending four-eyes request while a public request is being handled.
      "notifications",
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
      "auth_sessions",
      "customer_devices",
    ]) {
      await client.query(`DELETE FROM ${table}`);
    }
  }
}

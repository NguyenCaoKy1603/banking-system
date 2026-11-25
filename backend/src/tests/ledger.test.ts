import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PoolClient, QueryConfig, QueryConfigValues, QueryResult, QueryResultRow } from "pg";

import { DatabasePool } from "../database/pool.js";
import { RelationalTransferService } from "../database/transferService.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { InMemoryLedger } from "../domain/ledger.js";

test("ledger accepts balanced double-entry journals and is idempotent", () => {
  const ledger = new InMemoryLedger();
  const journal = {
    journalId: "journal-1",
    occurredAt: "2026-08-14T00:00:00.000Z",
    entries: [
      {
        accountId: "customer:1",
        side: "DEBIT" as const,
        amountMinor: 101_000n,
        currency: "VND" as const,
      },
      {
        accountId: "settlement:VND",
        side: "CREDIT" as const,
        amountMinor: 100_000n,
        currency: "VND" as const,
      },
      {
        accountId: "fee-income:VND",
        side: "CREDIT" as const,
        amountMinor: 1_000n,
        currency: "VND" as const,
      },
    ],
  };

  const first = ledger.append(journal);
  const second = ledger.append(journal);

  assert.equal(first.length, 3);
  assert.deepEqual(second, first);
  assert.equal(ledger.isBalanced("journal-1"), true);
  assert.equal(ledger.listEntries("customer:1").length, 1);
  assert.equal(ledger.getNetBalance("customer:1"), -101_000n);
});

test("ledger rejects unbalanced and non-positive entries", () => {
  const ledger = new InMemoryLedger();
  assert.throws(
    () =>
      ledger.append({
        journalId: "unbalanced",
        occurredAt: "2026-08-14T00:00:00.000Z",
        entries: [
          {
            accountId: "customer:1",
            side: "DEBIT",
            amountMinor: 100n,
            currency: "VND",
          },
          {
            accountId: "settlement:VND",
            side: "CREDIT",
            amountMinor: 99n,
            currency: "VND",
          },
        ],
      }),
    /balanced/,
  );

  assert.throws(
    () =>
      ledger.append({
        journalId: "zero",
        occurredAt: "2026-08-14T00:00:00.000Z",
        entries: [
          {
            accountId: "customer:1",
            side: "DEBIT",
            amountMinor: 0n,
            currency: "VND",
          },
          {
            accountId: "settlement:VND",
            side: "CREDIT",
            amountMinor: 0n,
            currency: "VND",
          },
        ],
      }),
    /positive/,
  );
});

class MockLedgerPoolClient {
  constructor(
    private readonly queryHandler: (sql: string, params: unknown[]) => { rows: unknown[] } | Promise<{ rows: unknown[] }>,
  ) {}

  async query<R extends QueryResultRow = QueryResultRow, I = unknown[]>(
    queryTextOrConfig: string | QueryConfig<I>,
    values?: QueryConfigValues<I>,
  ): Promise<QueryResult<R>> {
    const text = typeof queryTextOrConfig === "string" ? queryTextOrConfig : queryTextOrConfig.text;
    const params = Array.isArray(values) ? values : [];
    const trimmed = text.trim();
    if (trimmed.startsWith("BEGIN") || trimmed.startsWith("COMMIT") || trimmed.startsWith("ROLLBACK")) {
      return { rows: [] as R[], command: trimmed, rowCount: 0, oid: 0, fields: [] };
    }
    const res = await this.queryHandler(trimmed, params);
    return {
      rows: res.rows as R[],
      command: "SELECT",
      rowCount: res.rows.length,
      oid: 0,
      fields: [],
    };
  }

  release(): void {}
}

class MockLedgerDatabasePool extends DatabasePool {
  constructor(private readonly client: PoolClient) {
    super({ connectionString: "postgresql://localhost/mock" });
  }

  override async connect(): Promise<PoolClient> {
    return this.client;
  }
}

test("RelationalTransferService writes canonical payment-account:<uuid> account_ref entries to ledger_entries", async () => {
  const customerId = randomUUID();
  const recipientId = randomUUID();
  const sourceAccountId = randomUUID();
  const destinationAccountId = randomUUID();
  const quoteId = randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 300_000).toISOString();
  const recordedLedgerEntries: Array<{
    journalId: string;
    lineNumber: number;
    accountRef: string;
    side: string;
    amountMinor: string;
  }> = [];

  const mockClient = new MockLedgerPoolClient((sql, params) => {
    if (sql.includes("INSERT INTO command_idempotency")) {
      return {
        rows: [
          {
            id: params[0],
            customer_id: params[1],
            operation_type: params[2],
            idempotency_key: params[3],
            request_fingerprint: params[4],
            aggregate_id: null,
            status: "PENDING",
            response_payload: null,
            created_at: now,
            updated_at: now,
          },
        ],
      };
    }
    if (sql.includes("FROM transfer_quotes WHERE id = $1 FOR UPDATE")) {
      return {
        rows: [
          {
            id: quoteId,
            customer_id: customerId,
            source_account_id: sourceAccountId,
            beneficiary_id: null,
            amount_minor: "100000",
            fee_minor: "1000",
            expires_at: expiresAt,
            consumed_at: null,
            request_fingerprint: "fp-1",
            consumed_transfer_id: null,
            destination_account_id: destinationAccountId,
            destination_owner_id: recipientId,
            destination_owner_name: "Recipient User",
          },
        ],
      };
    }
    if (sql.includes("FROM control_policy")) {
      return {
        rows: [
          {
            config_version: "v1",
            global_kill_switch: false,
            transfers_enabled: true,
            allowlist_enabled: false,
            max_transfer_amount_minor: "100000000",
            step_up_methods: ["TOTP"],
            savings_enabled: true,
            savings_allowlist_enabled: false,
            max_savings_amount_minor: "100000000",
            savings_step_up_methods: ["TOTP"],
            credit_enabled: true,
            credit_allowlisted: false,
            credit_payments_enabled: true,
            card_controls_enabled: true,
            max_credit_payment_amount_minor: "100000000",
            credit_payment_step_up_methods: ["TOTP"],
            card_unlock_step_up_methods: ["TOTP"],
            updated_at: now,
          },
        ],
      };
    }
    if (sql.includes("FROM payment_accounts WHERE id = ANY($1::uuid[])")) {
      const accounts = [
        {
          id: sourceAccountId,
          customer_id: customerId,
          display_name: "Source Account",
          account_number: "970400000001",
          masked_number: "•••• 0001",
          bank_name: "Ngân hàng reference",
          available_minor: "500000",
          current_minor: "500000",
          held_minor: "0",
          status: "ACTIVE",
          version: "0",
          updated_at: now,
        },
        {
          id: destinationAccountId,
          customer_id: recipientId,
          display_name: "Destination Account",
          account_number: "970400000002",
          masked_number: "•••• 0002",
          bank_name: "Ngân hàng reference",
          available_minor: "0",
          current_minor: "0",
          held_minor: "0",
          status: "ACTIVE",
          version: "0",
          updated_at: now,
        },
      ].sort((a, b) => a.id.localeCompare(b.id));
      return { rows: accounts };
    }
    if (sql.includes("COUNT(*) FILTER")) {
      return { rows: [{ recent_10m: 0, same_recipient_15m: 0 }] };
    }
    if (sql.includes("AS has_prior")) {
      return { rows: [{ has_prior: true }] };
    }
    if (sql.includes("INSERT INTO transfers")) {
      return {
        rows: [
          {
            id: params[0],
            customer_id: params[1],
            source_account_id: params[2],
            quote_id: params[3],
            idempotency_key: params[4],
            request_fingerprint: params[5],
            reference: params[6],
            amount_minor: params[7],
            fee_minor: params[8],
            status: params[9],
            destination_account_id: params[10],
            destination_owner_id: params[11],
            source_transaction_id: params[12],
            destination_transaction_id: params[13],
            ledger_journal_id: params[14],
            refunded: false,
            held_minor: params[15],
            created_at: now,
            updated_at: now,
          },
        ],
      };
    }
    if (sql.includes("UPDATE transfer_quotes")) {
      return { rows: [{ id: quoteId }] };
    }
    if (sql.includes("UPDATE payment_accounts")) {
      const isSource = params[0] === sourceAccountId;
      return {
        rows: [
          {
            id: params[0],
            customer_id: isSource ? customerId : recipientId,
            display_name: isSource ? "Source Account" : "Destination Account",
            account_number: isSource ? "970400000001" : "970400000002",
            masked_number: isSource ? "•••• 0001" : "•••• 0002",
            bank_name: "Ngân hàng reference",
            available_minor: params[1],
            current_minor: params[2],
            held_minor: params[3],
            status: "ACTIVE",
            version: "1",
            updated_at: now,
          },
        ],
      };
    }
    if (sql.includes("SELECT full_name FROM customers WHERE id = $1")) {
      return { rows: [{ full_name: "Sender User" }] };
    }
    if (sql.includes("INSERT INTO account_transactions")) {
      return {
        rows: [
          {
            id: params[0],
            account_id: params[1],
            transfer_id: params[2],
            direction: params[6],
            amount_minor: params[7],
            fee_minor: params[8],
            status: params[9],
            description: params[10],
            counterparty_name: params[11],
            reference: params[12],
            occurred_at: params[13] ?? now,
            created_at: now,
            completed_at: params[14] ?? now,
            kind: params[15] ?? null,
          },
        ],
      };
    }
    if (sql.includes("INSERT INTO ledger_entries")) {
      recordedLedgerEntries.push({
        journalId: String(params[0]),
        lineNumber: Number(params[1]),
        accountRef: String(params[2]),
        side: String(params[3]),
        amountMinor: String(params[4]),
      });
      return { rows: [] };
    }
    if (sql.includes("UPDATE command_idempotency")) {
      return {
        rows: [
          {
            id: randomUUID(),
            customer_id: customerId,
            operation_type: "TRANSFER_SUBMIT",
            idempotency_key: "ledger-ref-key-1",
            request_fingerprint: "fp-1",
            aggregate_id: params[3],
            status: params[4],
            response_payload: params[5],
            created_at: now,
            updated_at: now,
          },
        ],
      };
    }
    return { rows: [] };
  });

  const service = new RelationalTransferService(
    new UnitOfWork(new MockLedgerDatabasePool(mockClient as unknown as PoolClient)),
  );
  await service.submit({
    customerId,
    idempotencyKey: "ledger-ref-key-1",
    requestFingerprint: "fp-1",
    quoteId,
    now,
  });

  assert.equal(recordedLedgerEntries.length, 3);
  assert.deepEqual(
    recordedLedgerEntries.map((entry) => [entry.lineNumber, entry.accountRef, entry.side, entry.amountMinor]),
    [
      [1, `payment-account:${sourceAccountId}`, "DEBIT", "101000"],
      [2, `payment-account:${destinationAccountId}`, "CREDIT", "100000"],
      [3, "fee-income:VND", "CREDIT", "1000"],
    ],
  );
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { PoolClient, QueryConfig, QueryConfigValues, QueryResult, QueryResultRow } from "pg";

import { BankingSystem } from "../bankingSystem.js";
import { DatabasePool } from "../database/pool.js";
import { RelationalTransferService } from "../database/transferService.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { MockNapasGateway, NAPAS_BANKS } from "../domain/napas/mockNapasGateway.js";
import { createBankingServer } from "../http.js";

const TEST_REGISTRATION_FINGERPRINT_KEY = Buffer.alloc(32, 0x42);

class MockInterbankPoolClient {
  public readonly executedSql: string[] = [];

  constructor(
    private readonly queryHandler: (
      sql: string,
      params: unknown[],
    ) => { rows: unknown[]; rowCount?: number } | Promise<{ rows: unknown[]; rowCount?: number }>,
  ) {}

  async query<R extends QueryResultRow = QueryResultRow, I = unknown[]>(
    queryTextOrConfig: string | QueryConfig<I>,
    values?: QueryConfigValues<I>,
  ): Promise<QueryResult<R>> {
    const text = typeof queryTextOrConfig === "string" ? queryTextOrConfig : queryTextOrConfig.text;
    const params = Array.isArray(values) ? values : [];
    const trimmed = text.replace(/\s+/g, " ").trim();
    this.executedSql.push(trimmed);
    if (trimmed.startsWith("BEGIN") || trimmed.startsWith("COMMIT") || trimmed.startsWith("ROLLBACK")) {
      return { rows: [] as R[], command: trimmed, rowCount: 0, oid: 0, fields: [] };
    }
    const res = await this.queryHandler(trimmed, params);
    return {
      rows: res.rows as R[],
      command: "SELECT",
      rowCount: res.rowCount ?? res.rows.length,
      oid: 0,
      fields: [],
    };
  }

  release(): void {}
}

class MockInterbankDatabasePool extends DatabasePool {
  constructor(private readonly client: PoolClient) {
    super({ connectionString: "postgresql://localhost/mock" });
  }

  override async connect(): Promise<PoolClient> {
    return this.client;
  }
}

function buildPolicyRow() {
  return {
    config_version: "v1",
    global_kill_switch: false,
    transfers_enabled: true,
    allowlist_enabled: false,
    max_transfer_amount_minor: "20000000",
    daily_transfer_limit_minor: "50000000",
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
    updated_at: new Date().toISOString(),
  };
}

function createInterbankStateStore(customerId: string, sourceAccountId: string) {
  const now = "2026-11-18T07:00:00.000Z";
  const accountState = {
    id: sourceAccountId,
    customer_id: customerId,
    display_name: "Tai khoan thanh toan",
    account_number: "970400000001",
    masked_number: "•••• 0001",
    bank_name: "Ngân hàng reference",
    available_minor: "10000000",
    current_minor: "10000000",
    held_minor: "0",
    status: "ACTIVE",
    version: 0,
    updated_at: now,
  };
  const balanceSnapshots: Array<{ availableMinor: string; currentMinor: string; heldMinor: string; version: number }> = [];
  const lookups = new Map<string, Record<string, unknown>>();
  const quotes = new Map<string, Record<string, unknown>>();
  const transfers = new Map<string, Record<string, unknown>>();
  const accountTransactions: Array<Record<string, unknown>> = [];
  const ledgerJournals: Array<Record<string, unknown>> = [];
  const ledgerEntries: Array<Record<string, unknown>> = [];

  const mockClient = new MockInterbankPoolClient((sql, params) => {
    if (sql.includes("FROM control_policy")) {
      return { rows: [buildPolicyRow()] };
    }
    if (sql.includes("AS daily_total_minor")) {
      return { rows: [{ daily_total_minor: "0" }] };
    }
    if (sql.includes("DELETE FROM recipient_lookups WHERE expires_at <= NOW()")) {
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO recipient_lookups")) {
      lookups.set(String(params[0]), {
        token_hash: params[0],
        customer_id: params[1],
        destination_account_id: null,
        destination_owner_id: null,
        account_holder_name: params[2],
        masked_account_number: params[3],
        bank_name: params[4],
        status: "ACTIVE",
        expires_at: params[5],
        rail: "NAPAS_IBFT",
        bank_bin: params[6],
        external_account_number: params[7],
      });
      return { rows: [] };
    }
    if (sql.includes("FROM recipient_lookups")) {
      const row = lookups.get(String(params[1]));
      return { rows: row && row.customer_id === params[0] ? [row] : [] };
    }
    if (sql.includes("DELETE FROM recipient_lookups")) {
      return { rows: [] };
    }
    if (sql.includes("SELECT * FROM payment_accounts WHERE id = $1 AND customer_id = $2")) {
      return { rows: accountState.id === params[0] && accountState.customer_id === params[1] ? [{ ...accountState }] : [] };
    }
    if (sql.includes("SELECT * FROM payment_accounts WHERE id = $1 FOR UPDATE")) {
      return { rows: accountState.id === params[0] ? [{ ...accountState }] : [] };
    }
    if (sql.includes("INSERT INTO transfer_quotes")) {
      const quoteRow = {
        id: params[0],
        customer_id: params[1],
        source_account_id: params[2],
        beneficiary_id: null,
        amount_minor: params[3],
        fee_minor: params[4],
        currency: "VND",
        expires_at: params[5],
        consumed_at: null,
        request_fingerprint: params[6],
        beneficiary_snapshot: params[7],
        destination_account_id: null,
        destination_owner_id: null,
        destination_owner_name: params[8],
        consumed_transfer_id: null,
        rail: "NAPAS_IBFT",
        external_bank_bin: params[9],
        external_bank_name: params[10],
        external_account_number: params[11],
      };
      quotes.set(String(params[0]), quoteRow);
      return { rows: [quoteRow] };
    }
    if (sql.includes("FROM transfer_quotes WHERE id = $1 FOR UPDATE")) {
      const row = quotes.get(String(params[0]));
      return { rows: row ? [{ ...row }] : [] };
    }
    if (sql.includes("SELECT rail, external_bank_bin")) {
      const row = quotes.get(String(params[0]));
      return { rows: row ? [{ ...row }] : [] };
    }
    if (sql.includes("UPDATE transfer_quotes SET consumed_at = NOW()")) {
      const row = quotes.get(String(params[0]));
      if (!row || row.consumed_at) return { rows: [], rowCount: 0 };
      row.consumed_at = now;
      row.consumed_transfer_id = params[1];
      return { rows: [{ id: row.id }], rowCount: 1 };
    }
    if (sql.includes("COUNT(*) FILTER")) {
      return { rows: [{ recent_10m: 0, same_recipient_15m: 0 }] };
    }
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
    if (sql.includes("UPDATE command_idempotency")) {
      return {
        rows: [
          {
            id: randomUUID(),
            customer_id: params[0],
            operation_type: params[1],
            idempotency_key: params[2],
            request_fingerprint: "fp",
            aggregate_id: params[3],
            status: params[4],
            response_payload: params[5],
            created_at: now,
            updated_at: now,
          },
        ],
      };
    }
    if (sql.includes("UPDATE payment_accounts")) {
      accountState.available_minor = String(params[1]);
      accountState.current_minor = String(params[2]);
      accountState.held_minor = String(params[3]);
      accountState.version += 1;
      balanceSnapshots.push({
        availableMinor: accountState.available_minor,
        currentMinor: accountState.current_minor,
        heldMinor: accountState.held_minor,
        version: accountState.version,
      });
      return { rows: [{ ...accountState }] };
    }
    if (sql.includes("INSERT INTO transfers")) {
      const row = {
        id: params[0],
        customer_id: params[1],
        source_account_id: params[2],
        quote_id: params[3],
        idempotency_key: params[4],
        request_fingerprint: params[5],
        reference: params[6],
        amount_minor: params[7],
        fee_minor: params[8],
        currency: "VND",
        status: "PENDING",
        created_at: params[9],
        updated_at: params[9],
        destination_account_id: null,
        destination_owner_id: null,
        source_transaction_id: params[10],
        destination_transaction_id: null,
        ledger_journal_id: null,
        refunded: false,
        held_minor: params[11],
        rail: "NAPAS_IBFT",
        external_bank_bin: params[12],
        external_bank_name: params[13],
        external_account_number: params[14],
        external_account_holder_name: params[15],
        napas_trace_id: null,
        failure_reason: null,
      };
      transfers.set(String(params[0]), row);
      return { rows: [{ ...row }] };
    }
    if (sql.includes("SELECT id FROM transfers WHERE rail = 'NAPAS_IBFT' AND status = 'PENDING'")) {
      return {
        rows: Array.from(transfers.values())
          .filter((row) => row.status === "PENDING" && BigInt(String(row.held_minor)) > 0n)
          .map((row) => ({ id: row.id })),
      };
    }
    if (sql.includes("SELECT * FROM transfers WHERE id = $1")) {
      const row = transfers.get(String(params[0]));
      return { rows: row ? [{ ...row }] : [] };
    }
    if (sql.includes("UPDATE transfers SET status = 'SUCCEEDED'")) {
      const row = transfers.get(String(params[0]))!;
      row.status = "SUCCEEDED";
      row.held_minor = "0";
      row.ledger_journal_id = params[1];
      row.napas_trace_id = params[2];
      row.updated_at = params[3];
      return { rows: [{ ...row }] };
    }
    if (sql.includes("UPDATE transfers SET status = 'REVERSED'")) {
      const row = transfers.get(String(params[0]))!;
      row.status = "REVERSED";
      row.refunded = true;
      row.held_minor = "0";
      row.ledger_journal_id = params[1];
      row.napas_trace_id = params[2];
      row.failure_reason = params[3];
      row.updated_at = params[4];
      return { rows: [{ ...row }] };
    }
    if (sql.includes("UPDATE transfers SET napas_trace_id = $2")) {
      const row = transfers.get(String(params[0]))!;
      row.napas_trace_id = params[1];
      row.updated_at = params[2];
      return { rows: [{ ...row }] };
    }
    if (sql.includes("INSERT INTO account_transactions")) {
      const tx = {
        id: params[0],
        account_id: params[1],
        transfer_id: params[2],
        direction: params[6],
        amount_minor: params[7],
        fee_minor: params[8],
        currency: "VND",
        status: params[9],
        description: params[10],
        counterparty_name: params[11],
        reference: params[12],
        occurred_at: params[13] ?? now,
        created_at: now,
        completed_at: params[14] ?? null,
        kind: params[15] ?? null,
      };
      accountTransactions.push(tx);
      return { rows: [tx] };
    }
    if (sql.includes("UPDATE account_transactions")) {
      const tx = accountTransactions.find((item) => item.id === params[0]);
      if (tx) {
        tx.status = sql.includes("'SUCCEEDED'") ? "SUCCEEDED" : "REVERSED";
        tx.completed_at = params[1];
      }
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO ledger_journals")) {
      ledgerJournals.push({ id: params[0], aggregateId: params[1], journalType: params[2] });
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO ledger_entries")) {
      ledgerEntries.push({
        journalId: params[0],
        lineNumber: params[1],
        accountRef: params[2],
        side: params[3],
        amountMinor: params[4],
      });
      return { rows: [] };
    }
    return { rows: [] };
  });

  return {
    mockClient,
    accountState,
    balanceSnapshots,
    transfers,
    accountTransactions,
    ledgerJournals,
    ledgerEntries,
  };
}

test("MockNapasGateway exposes 8 standard Vietnamese banks and deterministic inquiry rules", () => {
  const gateway = new MockNapasGateway();
  assert.equal(gateway.listBanks().length, 8);
  assert.deepEqual(
    NAPAS_BANKS.map((bank) => bank.bin),
    ["970436", "970407", "970422", "970423", "970416", "970418", "970415", "970405"],
  );

  const minh = gateway.inquireAccount("970436", "99990001");
  assert.equal(minh.accountHolderName, "NGUYEN VAN MINH (VCB)");
  assert.equal(minh.maskedAccountNumber, "•••• 0001");

  const failTarget = gateway.inquireAccount("970407", "99999999");
  assert.equal(failTarget.accountHolderName, "PHAM VAN LOI NAPAS (TCB)");

  assert.throws(() => gateway.inquireAccount("970436", "00000000"), /not found/i);
  assert.throws(() => gateway.inquireAccount("999999", "99990001"), /Unsupported/i);
});

test("POST /api/v1/external-recipients/lookup validates bankBin and returns NAPAS inquiry", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const headers = { "Content-Type": "application/json", "X-Device-ID": "device-napas-http" };

  const regBegin = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      fullName: "Napas HTTP Tester",
      email: "napas-http@example.com",
      phoneNumber: "0900778899",
      password: "Password1",
    }),
  });
  const regChallenge = (await regBegin.json()) as { challengeId: string };
  await fetch(`${baseUrl}/auth/register/verify`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      challengeId: regChallenge.challengeId,
      method: "EMAIL_OTP",
      proof: system.readTestVerificationCode(regChallenge.challengeId),
    }),
  });
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "napas-http@example.com", password: "Password1" }),
  });
  const { accessToken } = (await loginRes.json()) as { accessToken: string };

  const lookupRes = await fetch(`${baseUrl}/external-recipients/lookup`, {
    method: "POST",
    headers: { ...headers, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ bankBin: "970436", accountNumber: "99990001" }),
  });
  assert.equal(lookupRes.status, 200);
  const payload = (await lookupRes.json()) as {
    recipient: {
      rail: string;
      bankBin: string;
      bankCode: string;
      accountHolderName: string;
      bankName: string;
    };
  };
  assert.equal(payload.recipient.rail, "NAPAS_IBFT");
  assert.equal(payload.recipient.bankBin, "970436");
  assert.equal(payload.recipient.bankCode, "VCB");
  assert.equal(payload.recipient.accountHolderName, "NGUYEN VAN MINH (VCB)");
});

test("RelationalTransferService two-phase held_minor accounting: NAPAS Success settles to SUCCEEDED and clears held_minor", async () => {
  const customerId = randomUUID();
  const sourceAccountId = randomUUID();
  const store = createInterbankStateStore(customerId, sourceAccountId);
  const service = new RelationalTransferService(
    new UnitOfWork(new MockInterbankDatabasePool(store.mockClient as unknown as PoolClient)),
  );

  const lookup = await service.lookupExternalRecipient(customerId, {
    bankBin: "970436",
    accountNumber: "99990001",
  });
  assert.equal(lookup.accountHolderName, "NGUYEN VAN MINH (VCB)");

  const quote = await service.createQuote({
    customerId,
    sourceAccountId,
    lookupId: lookup.lookupId,
    amount: { currency: "VND", amountMinor: "500000" },
    now: "2026-11-18T07:00:00.000Z",
  });

  const receipt = await service.submit({
    customerId,
    idempotencyKey: "napas-success-key-0001",
    requestFingerprint: "fp-napas-ok",
    quoteId: quote.quoteId,
    now: "2026-11-18T07:00:00.000Z",
  });

  assert.equal(receipt.status, "SUCCEEDED");
  assert.equal(receipt.heldMinor, "0");
  // Phase 1 hold followed by Phase 2 settlement
  assert.deepEqual(store.balanceSnapshots, [
    { availableMinor: "9499000", currentMinor: "10000000", heldMinor: "501000", version: 1 },
    { availableMinor: "9499000", currentMinor: "9499000", heldMinor: "0", version: 2 },
  ]);
  assert.deepEqual(
    store.ledgerEntries.map((e) => [e.lineNumber, e.accountRef, e.side, e.amountMinor]),
    [
      [1, `payment-account:${sourceAccountId}`, "DEBIT", "501000"],
      [2, "napas-clearing:VND", "CREDIT", "500000"],
      [3, "fee-income:VND", "CREDIT", "1000"],
    ],
  );
});

test("RelationalTransferService two-phase held_minor accounting: NAPAS Failure rolls back held_minor and refunds available balance", async () => {
  const customerId = randomUUID();
  const sourceAccountId = randomUUID();
  const store = createInterbankStateStore(customerId, sourceAccountId);
  const service = new RelationalTransferService(
    new UnitOfWork(new MockInterbankDatabasePool(store.mockClient as unknown as PoolClient)),
  );

  const lookup = await service.lookupExternalRecipient(customerId, {
    bankBin: "970407",
    accountNumber: "99999999",
  });
  assert.equal(lookup.accountHolderName, "PHAM VAN LOI NAPAS (TCB)");

  const quote = await service.createQuote({
    customerId,
    sourceAccountId,
    lookupId: lookup.lookupId,
    amount: { currency: "VND", amountMinor: "500000" },
    now: "2026-11-18T07:00:00.000Z",
  });

  const receipt = await service.submit({
    customerId,
    idempotencyKey: "napas-fail-key-0001",
    requestFingerprint: "fp-napas-fail",
    quoteId: quote.quoteId,
    now: "2026-11-18T07:00:00.000Z",
  });

  assert.equal(receipt.status, "REVERSED");
  assert.equal(receipt.refunded, true);
  assert.equal(receipt.heldMinor, "0");
  // Phase 1 hold then Phase 2 full rollback: available restored to 10_000_000, held_minor back to 0
  assert.deepEqual(store.balanceSnapshots, [
    { availableMinor: "9499000", currentMinor: "10000000", heldMinor: "501000", version: 1 },
    { availableMinor: "10000000", currentMinor: "10000000", heldMinor: "0", version: 2 },
  ]);
  assert.equal(store.accountTransactions.length, 2);
  assert.equal(store.accountTransactions[0]?.status, "REVERSED");
  assert.equal(store.accountTransactions[1]?.direction, "CREDIT");
  assert.equal(store.accountTransactions[1]?.amount_minor, "501000");
  assert.equal(store.accountTransactions[1]?.kind, "TRANSFER_NAPAS_REVERSAL");
  assert.deepEqual(
    store.ledgerEntries.map((e) => [e.lineNumber, e.accountRef, e.side, e.amountMinor]),
    [
      [1, "napas-hold-clearing:VND", "DEBIT", "501000"],
      [2, `payment-account:${sourceAccountId}`, "CREDIT", "501000"],
    ],
  );
});

test("RelationalTransferService reconciles PENDING NAPAS transfer held_minor to SUCCEEDED", async () => {
  const customerId = randomUUID();
  const sourceAccountId = randomUUID();
  const store = createInterbankStateStore(customerId, sourceAccountId);
  const service = new RelationalTransferService(
    new UnitOfWork(new MockInterbankDatabasePool(store.mockClient as unknown as PoolClient)),
  );

  const lookup = await service.lookupExternalRecipient(customerId, {
    bankBin: "970422",
    accountNumber: "99998888",
  });
  const quote = await service.createQuote({
    customerId,
    sourceAccountId,
    lookupId: lookup.lookupId,
    amount: { currency: "VND", amountMinor: "500000" },
    now: "2026-11-18T07:00:00.000Z",
  });

  const pendingReceipt = await service.submit({
    customerId,
    idempotencyKey: "napas-pending-key-0001",
    requestFingerprint: "fp-napas-pending",
    quoteId: quote.quoteId,
    now: "2026-11-18T07:00:00.000Z",
  });
  assert.equal(pendingReceipt.status, "PENDING");
  assert.equal(pendingReceipt.heldMinor, "501000");
  assert.equal(store.accountState.held_minor, "501000");

  const reconciledCount = await service.reconcilePendingInterbankTransfers("2026-11-18T07:01:00.000Z", 10);
  assert.equal(reconciledCount, 1);
  assert.equal(store.accountState.held_minor, "0");
  assert.equal(store.accountState.current_minor, "9499000");
  assert.equal(store.transfers.get(pendingReceipt.id)?.status, "SUCCEEDED");
});

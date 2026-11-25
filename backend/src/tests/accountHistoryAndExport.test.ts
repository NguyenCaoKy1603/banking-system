import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { PoolClient, QueryConfig, QueryConfigValues, QueryResult, QueryResultRow } from "pg";

import { BankingSystem } from "../bankingSystem.js";
import { createBankingServer } from "../http.js";
import { DomainError } from "../errors.js";
import { DatabasePool } from "../database/pool.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { RelationalAccountReadService } from "../database/relationalAccountReadService.js";

const TEST_REGISTRATION_FINGERPRINT_KEY = Buffer.alloc(32, 0x42);

class MockPoolClient {
  public readonly executedSql: Array<{ sql: string; params: unknown[] }> = [];

  constructor(
    private readonly handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number },
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
    this.executedSql.push({ sql: trimmed, params });
    const res = this.handler(trimmed, params);
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

class MockDatabasePool extends DatabasePool {
  constructor(private readonly client: PoolClient) {
    super({ connectionString: "postgresql://localhost/mock" });
  }

  override async connect(): Promise<PoolClient> {
    return this.client;
  }
}

test("RelationalAccountReadService supports server-side filtering, monthly BigInt summary, and CSV/HTML statement export", async () => {
  const customerId = randomUUID();
  const accountId = randomUUID();
  const tx1 = randomUUID();
  const tx2 = randomUUID();

  const client = new MockPoolClient((sql, params) => {
    if (sql.includes("FROM payment_accounts WHERE id = $1 AND customer_id = $2")) {
      return {
        rows: [
          {
            id: accountId,
            customer_id: customerId,
            display_name: "Tài khoản chính",
            account_number: "970400000099",
            masked_number: "•••• 0099",
            bank_name: "NOVA Digital Bank",
            available_minor: "5500000",
            current_minor: "5500000",
            held_minor: "0",
            status: "ACTIVE",
            version: "1",
            updated_at: "2026-11-20T00:00:00.000Z",
          },
        ],
      };
    }
    if (sql.includes("SUM(CASE WHEN direction = 'CREDIT'")) {
      assert.equal(params[0], accountId);
      assert.equal(params[1], "2026-11-01T00:00:00.000Z");
      assert.equal(params[2], "2026-12-01T00:00:00.000Z");
      return {
        rows: [
          {
            total_income_minor: "15000000",
            total_expense_minor: "3250000",
            credit_count: 2,
            debit_count: 3,
          },
        ],
      };
    }
    if (sql.includes("FROM account_transactions") && params[8] !== null && params[8] !== undefined) {
      return {
        rows: [
          {
            id: tx1,
            account_id: accountId,
            transfer_id: null,
            direction: "CREDIT",
            amount_minor: "10000000",
            fee_minor: "0",
            status: "SUCCEEDED",
            description: "Nhận lương tháng 11",
            counterparty_name: "Cong ty NOVA",
            reference: "REF-LUONG-11",
            occurred_at: "2026-11-05T08:00:00.000Z",
            created_at: "2026-11-05T08:00:00.000Z",
            completed_at: "2026-11-05T08:00:00.000Z",
            kind: "TRANSFER",
          },
        ],
      };
    }
    if (sql.includes("FROM account_transactions")) {
      return {
        rows: [
          {
            id: tx1,
            account_id: accountId,
            transfer_id: null,
            direction: "CREDIT",
            amount_minor: "10000000",
            fee_minor: "0",
            status: "SUCCEEDED",
            description: "Nhận lương tháng 11",
            counterparty_name: "Cong ty NOVA",
            reference: "REF-LUONG-11",
            occurred_at: "2026-11-05T08:00:00.000Z",
            created_at: "2026-11-05T08:00:00.000Z",
            completed_at: "2026-11-05T08:00:00.000Z",
            kind: "TRANSFER",
          },
          {
            id: tx2,
            account_id: accountId,
            transfer_id: null,
            direction: "DEBIT",
            amount_minor: "250000",
            fee_minor: "0",
            status: "SUCCEEDED",
            description: "Thanh toán hóa đơn",
            counterparty_name: "EVN",
            reference: "REF-EVN-11",
            occurred_at: "2026-11-10T09:00:00.000Z",
            created_at: "2026-11-10T09:00:00.000Z",
            completed_at: "2026-11-10T09:00:00.000Z",
            kind: "TRANSFER",
          },
        ],
      };
    }
    return { rows: [] };
  });

  const service = new RelationalAccountReadService(
    new UnitOfWork(new MockDatabasePool(client as unknown as PoolClient)),
  );

  const filtered = await service.listTransactions(customerId, accountId, undefined, 20, {
    status: "SUCCEEDED",
    direction: "CREDIT",
    from: "2026-11-01",
    to: "2026-11-30",
    q: "100%_NOVA",
  });
  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0]?.description, "Nhận lương tháng 11");
  const filterSql = client.executedSql.find((entry) => entry.sql.includes("ILIKE"));
  assert.ok(filterSql);
  assert.equal(filterSql.params[4], "SUCCEEDED");
  assert.equal(filterSql.params[5], "CREDIT");
  assert.equal(filterSql.params[6], "2026-11-01T00:00:00.000Z");
  assert.equal(filterSql.params[7], "2026-11-30T23:59:59.999Z");
  assert.equal(filterSql.params[8], "%100\\%\\_NOVA%");

  await assert.rejects(
    () =>
      service.listTransactions(customerId, accountId, undefined, 20, {
        from: "2026-11-30",
        to: "2026-11-01",
      }),
    (err: unknown) => err instanceof DomainError && err.status === 422,
  );

  const summary = await service.getMonthlySummary(customerId, accountId, "2026-11");
  assert.deepEqual(summary, {
    accountId,
    month: "2026-11",
    monthLabel: "11/2026",
    currency: "VND",
    totalIncomeMinor: "15000000",
    totalExpenseMinor: "3250000",
    netMinor: "11750000",
    succeededCount: 5,
    creditCount: 2,
    debitCount: 3,
  });

  const csvExport = await service.exportStatement(customerId, accountId, {
    from: "2026-11-01",
    to: "2026-11-30",
    format: "csv",
  });
  assert.equal(csvExport.contentType, "text/csv; charset=utf-8");
  assert.ok(csvExport.body.startsWith("\uFEFF"));
  assert.ok(csvExport.body.includes("REF-LUONG-11"));
  assert.ok(csvExport.body.includes("REF-EVN-11"));

  const htmlExport = await service.exportStatement(customerId, accountId, {
    from: "2026-11-01",
    to: "2026-11-30",
    format: "html",
  });
  assert.equal(htmlExport.contentType, "text/html; charset=utf-8");
  assert.ok(htmlExport.body.includes("NOVA Digital Banking - Sao kê tài khoản"));
  assert.ok(htmlExport.body.includes("+10.000.000 VND"));
});

test("HTTP GET /transactions filters, /summary, and /statement-export work end-to-end", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "654321" });
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const devHeaders = { "Content-Type": "application/json", "X-Device-ID": "device-hist-1" };

  const regBegin = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: devHeaders,
    body: JSON.stringify({
      fullName: "Tran Thi Minh",
      email: "minh.history@example.test",
      phoneNumber: "0905556667",
      password: "HistoryStrong!1234",
    }),
  });
  assert.equal(regBegin.status, 202);
  const regChallenge = (await regBegin.json()) as { challengeId: string };

  const regVerify = await fetch(`${baseUrl}/auth/register/verify`, {
    method: "POST",
    headers: devHeaders,
    body: JSON.stringify({
      challengeId: regChallenge.challengeId,
      method: "EMAIL_OTP",
      proof: system.readTestVerificationCode(regChallenge.challengeId),
    }),
  });
  assert.equal(regVerify.status, 201);
  const verifiedBody = (await regVerify.json()) as { user: { id: string } };

  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: devHeaders,
    body: JSON.stringify({
      email: "minh.history@example.test",
      password: "HistoryStrong!1234",
    }),
  });
  assert.equal(loginRes.status, 200);
  const login = (await loginRes.json()) as { accessToken: string };

  const account = system.listAccounts(verifiedBody.user.id)[0]!;
  const accountNumber = system.getAccountNumber(verifiedBody.user.id, account.id);
  system.seedReferenceFunding("hist-fund-key-1", {
    recipientAccountNumber: accountNumber,
    amount: { currency: "VND", amountMinor: "2500000" },
    reason: "Thưởng hiệu suất quý",
  });
  system.seedReferenceFunding("hist-fund-key-2", {
    recipientAccountNumber: accountNumber,
    amount: { currency: "VND", amountMinor: "500000" },
    reason: "Hoàn tiền mua sắm",
  });

  const headers = {
    Authorization: `Bearer ${login.accessToken}`,
    "X-Device-ID": "device-hist-1",
  };

  const filteredRes = await fetch(
    `${baseUrl}/accounts/${account.id}/transactions?status=SUCCEEDED&direction=CREDIT&q=${encodeURIComponent("hiệu suất")}`,
    { headers },
  );
  assert.equal(filteredRes.status, 200);
  const filteredBody = (await filteredRes.json()) as { items: Array<{ description: string; amount: { amountMinor: string } }> };
  assert.equal(filteredBody.items.length, 1);
  assert.equal(filteredBody.items[0]?.amount.amountMinor, "2500000");

  const currentMonth = new Date().toISOString().slice(0, 7);
  const summaryRes = await fetch(
    `${baseUrl}/accounts/${account.id}/summary?month=${currentMonth}`,
    { headers },
  );
  assert.equal(summaryRes.status, 200);
  const summaryBody = (await summaryRes.json()) as {
    month: string;
    totalIncomeMinor: string;
    totalExpenseMinor: string;
    netMinor: string;
    succeededCount: number;
  };
  assert.equal(summaryBody.month, currentMonth);
  assert.equal(summaryBody.totalIncomeMinor, "3000000");
  assert.equal(summaryBody.totalExpenseMinor, "0");
  assert.equal(summaryBody.netMinor, "3000000");
  assert.equal(summaryBody.succeededCount, 2);

  const badMonthRes = await fetch(
    `${baseUrl}/accounts/${account.id}/summary?month=2026-99`,
    { headers },
  );
  assert.equal(badMonthRes.status, 422);

  const csvRes = await fetch(
    `${baseUrl}/accounts/${account.id}/statement-export?format=csv`,
    { headers },
  );
  assert.equal(csvRes.status, 200);
  assert.ok(csvRes.headers.get("content-type")?.includes("text/csv"));
  assert.ok(csvRes.headers.get("content-disposition")?.includes("attachment;"));
  const csvBytes = new Uint8Array(await csvRes.arrayBuffer());
  assert.equal(csvBytes[0], 0xef);
  assert.equal(csvBytes[1], 0xbb);
  assert.equal(csvBytes[2], 0xbf);
  const csvText = Buffer.from(csvBytes).toString("utf8");
  assert.ok(csvText.startsWith("\uFEFF"));
  assert.ok(csvText.includes("Thưởng hiệu suất quý"));
  assert.ok(csvText.includes("Hoàn tiền mua sắm"));

  const htmlRes = await fetch(
    `${baseUrl}/accounts/${account.id}/statement-export?format=html`,
    { headers },
  );
  assert.equal(htmlRes.status, 200);
  assert.ok(htmlRes.headers.get("content-type")?.includes("text/html"));
  const htmlText = await htmlRes.text();
  assert.ok(htmlText.includes("NOVA Digital Banking - Sao kê tài khoản"));
});

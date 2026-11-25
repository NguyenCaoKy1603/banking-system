import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { PoolClient, QueryConfig, QueryConfigValues, QueryResult, QueryResultRow } from "pg";

import { AdminActionEngine } from "../admin/actions/actionEngine.js";
import { StaffAuthService } from "../admin/auth/staffAuthService.js";
import { createAdminServer } from "../admin/http/adminHttp.js";
import { InMemoryAdminRepository, PostgresAdminRepository } from "../admin/repositories/adminRepository.js";
import { RelationalTransferService } from "../database/transferService.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { DatabasePool } from "../database/pool.js";
import { LocalDevelopmentKeyEncryptionAdapter, generateTotp } from "../mfa/crypto.js";

type HttpResult = { status: number; body: Record<string, unknown> | undefined; response: Response };

function mergeCookies(current: string, response: Response): string {
  const header = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = header.getSetCookie?.() ?? (response.headers.get("set-cookie")?.split(/,(?=[^;]+=)/u) ?? []);
  const jar = new Map<string, string>();
  for (const item of current.split(";")) {
    const [name, ...value] = item.trim().split("=");
    if (name && value.length > 0) jar.set(name, value.join("="));
  }
  for (const item of setCookies) {
    const [pair] = item.split(";");
    const [name, ...value] = pair.trim().split("=");
    if (name && value.length > 0) jar.set(name, value.join("="));
  }
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function readResult(response: Response): Promise<HttpResult> {
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Record<string, unknown> : undefined, response };
}

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

test("GET/PATCH /admin/control-policy enforces ADMIN role, fresh Step-up TOTP, and CONTROL_POLICY_UPDATED audit", async (t) => {
  const repository = new InMemoryAdminRepository({
    accounts: [
      {
        id: "acc-recon-1",
        customerId: "cust-1",
        displayName: "Main",
        maskedNumber: "•••• 0001",
        bankName: "NOVA",
        availableMinor: "500000",
        currentMinor: "500000",
        heldMinor: "0",
        status: "ACTIVE",
        version: 1,
        updatedAt: new Date().toISOString(),
      },
    ],
    ledgerJournals: [
      {
        id: "jr-1",
        journalType: "SANDBOX_FUNDING",
        aggregateId: "fund-1",
        entries: [
          { accountRef: "sandbox:treasury", side: "DEBIT", amountMinor: "500000" },
          { accountRef: "payment-account:acc-recon-1", side: "CREDIT", amountMinor: "500000" },
        ],
      },
    ],
  });
  await repository.initialize();

  let clockValue = Math.floor(Date.now() / 30_000) * 30_000;
  const encryption = new LocalDevelopmentKeyEncryptionAdapter(Buffer.alloc(32, 41), "policy-test-v1");
  const auth = new StaffAuthService({ repository, encryption, clock: () => clockValue, environmentScope: "preview" });

  const adminSecret = "JBSWY3DPEHPK3PXP";
  const adminInvite = await auth.invite({
    email: "policy-admin@example.test",
    employeeCode: "POL-ADMIN",
    displayName: "Policy Admin",
    role: "ADMIN",
  });
  await auth.activate({
    inviteToken: adminInvite.token,
    password: "policy-admin-password-123",
    totpSecret: adminSecret,
  });

  const opsSecret = "KRUGS4ZANFZSAYJA";
  const opsInvite = await auth.invite({
    email: "policy-ops@example.test",
    employeeCode: "POL-OPS",
    displayName: "Policy Operations",
    role: "OPERATIONS",
  });
  await auth.activate({
    inviteToken: opsInvite.token,
    password: "policy-ops-password-123",
    totpSecret: opsSecret,
  });

  const server = createAdminServer({
    repository,
    auth,
    actions: new AdminActionEngine(repository),
    allowedOrigins: [],
    environment: "development",
    secureCookies: false,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await repository.close();
  });

  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const request = async (path: string, init: RequestInit = {}, cookieJar = ""): Promise<HttpResult> => {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (cookieJar) headers.set("cookie", cookieJar);
    return readResult(await fetch(`${baseUrl}${path}`, { ...init, headers }));
  };

  // Login ADMIN with mfaVerifiedAt 6 minutes in the past (beyond 5-minute step-up window)
  const adminBegin = await request("/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "policy-admin@example.test", password: "policy-admin-password-123" }),
  });
  assert.equal(adminBegin.status, 202);
  const adminVerify = await request("/admin/auth/mfa/verify", {
    method: "POST",
    body: JSON.stringify({
      challengeId: String(adminBegin.body?.challengeId),
      code: generateTotp(adminSecret, clockValue),
    }),
  });
  assert.equal(adminVerify.status, 200);
  const adminCookies = mergeCookies("", adminVerify.response);
  const adminCsrf = String(adminVerify.body?.csrfToken);

  // Login OPERATIONS
  const opsLogin = await request("/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "policy-ops@example.test", password: "policy-ops-password-123" }),
  });
  assert.equal(opsLogin.status, 200);
  const opsCookies = mergeCookies("", opsLogin.response);
  const opsCsrf = String(opsLogin.body?.csrfToken);

  // OPERATIONS is denied from GET and PATCH /admin/control-policy
  const opsGet = await request("/admin/control-policy", {}, opsCookies);
  assert.equal(opsGet.status, 409);
  assert.equal(opsGet.body?.code, "ADMIN_PERMISSION_DENIED");

  const opsPatch = await request(
    "/admin/control-policy",
    {
      method: "PATCH",
      headers: { "X-CSRF-Token": opsCsrf },
      body: JSON.stringify({ transferFeeMinor: "2000" }),
    },
    opsCookies,
  );
  assert.equal(opsPatch.status, 409);
  assert.equal(opsPatch.body?.code, "ADMIN_PERMISSION_DENIED");

  // OPERATIONS can read ledger reconciliation (outbox.read)
  const reconRes = await request("/admin/operations/ledger-reconciliation", {}, opsCookies);
  assert.equal(reconRes.status, 200);
  const reconciliation = reconRes.body?.reconciliation as {
    status: string;
    unbalancedJournalCount: number;
    discrepancyMinor: string;
  };
  assert.equal(reconciliation.status, "BALANCED");
  assert.equal(reconciliation.unbalancedJournalCount, 0);
  assert.equal(reconciliation.discrepancyMinor, "0");

  // ADMIN without fresh step-up receives STAFF_MFA_REQUIRED
  const stalePatch = await request(
    "/admin/control-policy",
    {
      method: "PATCH",
      headers: { "X-CSRF-Token": adminCsrf },
      body: JSON.stringify({ transferFeeMinor: "2500" }),
    },
    adminCookies,
  );
  assert.equal(stalePatch.status, 409);
  assert.equal(stalePatch.body?.code, "STAFF_MFA_REQUIRED");

  // Perform fresh Step-up TOTP verification (next 30s time step so TOTP replay protection accepts)
  clockValue += 30_000;
  const stepUpRes = await request(
    "/admin/auth/step-up",
    {
      method: "POST",
      headers: { "X-CSRF-Token": adminCsrf },
      body: JSON.stringify({ code: generateTotp(adminSecret, clockValue) }),
    },
    adminCookies,
  );
  assert.equal(stepUpRes.status, 204);

  // ADMIN updates policy + fee after fresh step-up
  const patchRes = await request(
    "/admin/control-policy",
    {
      method: "PATCH",
      headers: { "X-CSRF-Token": adminCsrf },
      body: JSON.stringify({
        globalKillSwitch: false,
        transfersEnabled: true,
        maxTransferAmountMinor: "80000000",
        dailyTransferLimitMinor: "120000000",
        transferFeeMinor: "2500",
        savingsEnabled: false,
        creditEnabled: true,
        reasonCode: "FEE_PROMOTION_END",
      }),
    },
    adminCookies,
  );
  assert.equal(patchRes.status, 200);
  const updatedPolicy = patchRes.body?.policy as Record<string, unknown>;
  assert.equal(updatedPolicy.configVersion, 2);
  assert.equal(updatedPolicy.maxTransferAmountMinor, "80000000");
  assert.equal(updatedPolicy.dailyTransferLimitMinor, "120000000");
  assert.equal(updatedPolicy.transferFeeMinor, "2500");
  assert.equal(updatedPolicy.savingsEnabled, false);

  // Audit event CONTROL_POLICY_UPDATED records before/after
  const auditEvents = await repository.listAudit(20);
  const policyAudit = auditEvents.find((item) => item.action === "CONTROL_POLICY_UPDATED");
  assert.ok(policyAudit);
  assert.equal(policyAudit.reasonCode, "FEE_PROMOTION_END");
  assert.equal((policyAudit.metadata.before as Record<string, unknown>)?.transferFeeMinor, "1000");
  assert.equal((policyAudit.metadata.after as Record<string, unknown>)?.transferFeeMinor, "2500");
});

test("RelationalTransferService.createQuote uses dynamic transfer_fee_minor from ControlPolicyRepository", async () => {
  const customerId = randomUUID();
  const sourceAccountId = randomUUID();
  const beneficiaryId = randomUUID();
  const destinationAccountId = randomUUID();
  const destinationOwnerId = randomUUID();

  const client = new MockPoolClient((sql) => {
    if (sql.includes("FROM control_policy")) {
      return {
        rows: [
          {
            config_version: "2",
            global_kill_switch: false,
            transfers_enabled: true,
            allowlist_enabled: false,
            max_transfer_amount_minor: "50000000",
            daily_transfer_limit_minor: "50000000",
            transfer_fee_minor: "3500",
            step_up_methods: ["TOTP", "BIOMETRIC"],
            savings_enabled: true,
            savings_allowlist_enabled: false,
            max_savings_amount_minor: "500000000",
            savings_step_up_methods: ["TOTP"],
            credit_enabled: true,
            credit_allowlisted: false,
            credit_payments_enabled: true,
            card_controls_enabled: true,
            max_credit_payment_amount_minor: "100000000",
            credit_payment_step_up_methods: ["TOTP"],
            card_unlock_step_up_methods: ["TOTP"],
            updated_at: "2026-11-25T00:00:00.000Z",
          },
        ],
      };
    }
    if (sql.includes("FROM transfers") && sql.includes("daily_total_minor")) {
      return { rows: [{ daily_total_minor: "0" }] };
    }
    if (sql.includes("FROM payment_accounts WHERE id = $1 AND customer_id = $2")) {
      return {
        rows: [
          {
            id: sourceAccountId,
            customer_id: customerId,
            display_name: "Main",
            account_number: "970400000001",
            masked_number: "•••• 0001",
            bank_name: "NOVA",
            available_minor: "10000000",
            current_minor: "10000000",
            held_minor: "0",
            status: "ACTIVE",
            version: "1",
            updated_at: "2026-11-25T00:00:00.000Z",
          },
        ],
      };
    }
    if (sql.includes("FROM beneficiaries")) {
      return {
        rows: [
          {
            id: beneficiaryId,
            display_name: "Recipient",
            account_holder_name: "Nguyen B",
            masked_account_number: "•••• 0002",
            bank_name: "NOVA",
            status: "ACTIVE",
            destination_status: "ACTIVE",
            destination_account_id: destinationAccountId,
            destination_owner_id: destinationOwnerId,
            destination_full_name: "Nguyen B",
            rail: "INTERNAL",
          },
        ],
      };
    }
    if (sql.includes("INSERT INTO transfer_quotes")) {
      return {
        rows: [
          {
            id: randomUUID(),
            customer_id: customerId,
            source_account_id: sourceAccountId,
            beneficiary_id: beneficiaryId,
            amount_minor: "200000",
            fee_minor: "3500",
            expires_at: "2026-11-25T10:05:00.000Z",
            consumed_at: null,
            request_fingerprint: "fp",
            consumed_transfer_id: null,
            destination_account_id: destinationAccountId,
            destination_owner_id: destinationOwnerId,
            destination_owner_name: "Nguyen B",
          },
        ],
      };
    }
    if (sql.includes("FROM account_transactions") || sql.includes("FROM transfers")) {
      return { rows: [{ has_prior: true, recent_10m: 0, same_recipient_15m: 0 }] };
    }
    return { rows: [] };
  });

  const service = new RelationalTransferService(
    new UnitOfWork(new MockDatabasePool(client as unknown as PoolClient)),
  );
  const quote = await service.createQuote({
    customerId,
    sourceAccountId,
    beneficiaryId,
    amount: { currency: "VND", amountMinor: "200000" },
    now: "2026-11-25T10:00:00.000Z",
  });

  assert.equal(quote.fee.amountMinor, "3500");
  assert.equal(quote.totalDebit.amountMinor, "203500");
});

test("PostgresAdminRepository.reconcileLedger detects BALANCED vs MISMATCH invariants using BigInt", async () => {
  const client = new MockPoolClient((sql) => {
    if (sql.includes("HAVING COALESCE(SUM(CASE WHEN e.side = 'DEBIT'")) {
      return {
        rows: [
          {
            journal_id: "11111111-1111-4111-8111-111111111111",
            journal_type: "TRANSFER",
            aggregate_id: "22222222-2222-4222-8222-222222222222",
            debit_minor: "100000",
            credit_minor: "99000",
          },
        ],
      };
    }
    if (sql.includes("accounts_total_minor")) {
      return {
        rows: [
          {
            total_journals: 42,
            accounts_total_minor: "5000000",
            ledger_net_minor: "4999000",
          },
        ],
      };
    }
    return { rows: [] };
  });

  const repo = new PostgresAdminRepository({ connectionString: "postgresql://localhost/mock" });
  Object.defineProperty(repo, "unitOfWork", {
    value: new UnitOfWork(new MockDatabasePool(client as unknown as PoolClient)),
  });
  const result = await repo.reconcileLedger();
  assert.equal(result.status, "MISMATCH");
  assert.equal(result.unbalancedJournalCount, 1);
  assert.equal(result.totalJournalsChecked, 42);
  assert.equal(result.paymentAccountsTotalMinor, "5000000");
  assert.equal(result.ledgerPaymentAccountsNetMinor, "4999000");
  assert.equal(result.discrepancyMinor, "1000");
});

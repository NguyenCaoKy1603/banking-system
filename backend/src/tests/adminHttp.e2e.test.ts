import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { AddressInfo } from "node:net";

import { AdminActionEngine } from "../admin/actions/actionEngine.js";
import { StaffAuthService } from "../admin/auth/staffAuthService.js";
import { createAdminServer } from "../admin/http/adminHttp.js";
import { InMemoryAdminRepository, type AdminAccount, type CustomerSummary } from "../admin/repositories/adminRepository.js";
import { LocalDevelopmentKeyEncryptionAdapter } from "../mfa/crypto.js";
import { generateTotp } from "../mfa/crypto.js";

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

test("Admin HTTP E2E gives Operations password-only login and keeps Admin MFA, CSRF and approval controls", async () => {
  const customerId = randomUUID();
  const accountId = randomUUID();
  const now = Math.floor(Date.now() / 30_000) * 30_000;
  let clockValue = now;
  const customer: CustomerSummary = {
    id: customerId,
    fullName: "E2E Customer",
    email: "customer@example.test",
    phoneNumber: "0900000000",
    accessStatus: "ACTIVE",
    accessVersion: 1,
    createdAt: new Date(now).toISOString(),
  };
  const account: AdminAccount = {
    id: accountId,
    customerId,
    displayName: "E2E Current Account",
    maskedNumber: "****1234",
    bankName: "Reference Bank",
    availableMinor: "100000",
    currentMinor: "100000",
    heldMinor: "0",
    status: "ACTIVE",
    version: 1,
    updatedAt: new Date(now).toISOString(),
  };
  const repository = new InMemoryAdminRepository({ customers: [customer], accounts: [account] });
  await repository.initialize();
  const encryption = new LocalDevelopmentKeyEncryptionAdapter(Buffer.alloc(32, 7), "e2e-v1");
  const auth = new StaffAuthService({ repository, encryption, clock: () => clockValue, environmentScope: "preview" });
  const operationsSecret = "JBSWY3DPEHPK3PXP";
  const controlSecret = "KRUGS4ZANFZSAYJA";
  const operationsInvite = await auth.invite({ email: "operations@example.test", employeeCode: "OPS-E2E", displayName: "E2E Operations", role: "OPERATIONS" });
  const operations = await auth.activate({ inviteToken: operationsInvite.token, password: "Operations-password-2026!", totpSecret: operationsSecret });
  const controlInvite = await auth.invite({ email: "admin-checker@example.test", employeeCode: "ADMIN-CHECKER-E2E", displayName: "E2E Admin Checker", role: "ADMIN" });
  const control = await auth.activate({ inviteToken: controlInvite.token, password: "Control-password-2026!", totpSecret: controlSecret });
  const actions = new AdminActionEngine(repository);
  const server = createAdminServer({ repository, auth, actions, allowedOrigins: [], environment: "development", secureCookies: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.unref();
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const request = async (path: string, init: RequestInit = {}, cookieJar = ""): Promise<HttpResult> => {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (cookieJar) headers.set("cookie", cookieJar);
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    return readResult(response);
  };
  const body = (value: Record<string, unknown>): string => JSON.stringify(value);

  try {
    const customerToken = await request("/api/v1/admin/me", { headers: { authorization: "Bearer customer-realm-token" } });
    assert.equal(customerToken.status, 401);

    const login = await request("/api/v1/admin/auth/login", { method: "POST", headers: { "x-device-id": "e2e-operations-device" }, body: body({ email: "operations@example.test", password: "Operations-password-2026!" }) });
    assert.equal(login.status, 200);
    assert.equal(login.body?.mfaRequired, false);
    assert.equal(((login.body?.staff as Record<string, unknown>)?.roles as Array<Record<string, unknown>>)?.[0]?.role, "OPERATIONS");
    let operationsCookies = mergeCookies("", login.response);
    const operationsCsrf = String(login.body?.csrfToken);
    const obsoleteOperationsChallenge = await request("/api/v1/admin/auth/mfa/verify", { method: "POST", body: body({ challengeId: "no-operations-login-challenge", code: generateTotp(operationsSecret, clockValue) }) });
    assert.equal(obsoleteOperationsChallenge.status, 401);

    const funding = await request(`/api/v1/admin/accounts/${accountId}/funding-requests`, { method: "POST", headers: { "x-csrf-token": operationsCsrf, "idempotency-key": "e2e-funding-request-1" }, body: body({ amountMinor: "2500", currency: "VND", reasonCode: "PROJECT_TEST_FUNDING", ticketReference: "E2E-ADMIN-001", description: "E2E funding" }) }, operationsCookies);
    assert.equal(funding.status, 202);
    const action = funding.body?.action as Record<string, unknown>;
    assert.equal(action.status, "PENDING_APPROVAL");
    assert.equal(action.requesterStaffId, operations.staffId);

    const operationsApproval = await request(`/api/v1/admin/approvals/${String(action.id)}/approve`, { method: "POST", headers: { "x-csrf-token": operationsCsrf, "idempotency-key": "e2e-operations-approval-denied" }, body: body({ fingerprint: action.requestFingerprint, version: action.version, reasonCode: "PROJECT_TEST_FUNDING", decision: "APPROVED", comment: "Operations has no approval permission" }) }, operationsCookies);
    assert.equal(operationsApproval.status, 409);
    assert.equal(operationsApproval.body?.code, "ADMIN_PERMISSION_DENIED");

    const controlLogin = await request("/api/v1/admin/auth/login", { method: "POST", body: body({ email: "admin-checker@example.test", password: "Control-password-2026!" }) });
    assert.equal(controlLogin.status, 202);
    assert.equal(controlLogin.body?.mfaRequired, true);
    clockValue += 30_000;
    const controlMfa = await request("/api/v1/admin/auth/mfa/verify", { method: "POST", headers: { "x-device-id": "e2e-control-device" }, body: body({ challengeId: String(controlLogin.body?.challengeId), code: generateTotp(controlSecret, clockValue) }) });
    assert.equal(controlMfa.status, 200);
    const controlCookies = mergeCookies("", controlMfa.response);
    const controlCsrf = String(controlMfa.body?.csrfToken);
    clockValue += 30_000;
    const stepUp = await request("/api/v1/admin/auth/step-up", { method: "POST", headers: { "x-csrf-token": controlCsrf }, body: body({ code: generateTotp(controlSecret, clockValue) }) }, controlCookies);
    assert.equal(stepUp.status, 204);

    const approveBody = { fingerprint: action.requestFingerprint, version: action.version, reasonCode: "PROJECT_TEST_FUNDING", decision: "APPROVED", comment: "Admin approval" };
    const approval = await request(`/api/v1/admin/approvals/${String(action.id)}/approve`, { method: "POST", headers: { "x-csrf-token": controlCsrf, "idempotency-key": "e2e-control-approval-1" }, body: body(approveBody) }, controlCookies);
    assert.equal(approval.status, 200);
    assert.equal((approval.body?.action as Record<string, unknown>)?.status, "SUCCEEDED");

    const replay = await request(`/api/v1/admin/approvals/${String(action.id)}/approve`, { method: "POST", headers: { "x-csrf-token": controlCsrf, "idempotency-key": "e2e-control-approval-2" }, body: body(approveBody) }, controlCookies);
    assert.equal(replay.status, 200);
    assert.equal((replay.body?.action as Record<string, unknown>)?.status, "SUCCEEDED");

    const accountResult = await request(`/api/v1/admin/accounts/${accountId}`, {}, controlCookies);
    assert.equal(accountResult.status, 200);
    assert.equal((accountResult.body?.account as Record<string, unknown>)?.availableMinor, "102500");
    const transactions = await request(`/api/v1/admin/accounts/${accountId}/transactions`, {}, controlCookies);
    assert.equal(transactions.status, 200);
    assert.equal((transactions.body?.items as unknown[]).length, 1);
  } finally {
    server.closeAllConnections?.();
    server.closeIdleConnections?.();
    server.close();
    await repository.close();
  }
});

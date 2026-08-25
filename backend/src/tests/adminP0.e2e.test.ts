import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { AddressInfo } from "node:net";

import { AdminActionEngine } from "../admin/actions/actionEngine.js";
import { StaffAuthService } from "../admin/auth/staffAuthService.js";
import { createAdminServer } from "../admin/http/adminHttp.js";
import {
  InMemoryAdminRepository,
  type AdminAccount,
  type AdminApplication,
  type AdminFraudCase,
  type AdminJob,
  type AdminTransfer,
  type CustomerSummary,
} from "../admin/repositories/adminRepository.js";
import { LocalDevelopmentKeyEncryptionAdapter, generateTotp } from "../mfa/crypto.js";

type Result = { status: number; body: Record<string, unknown> | undefined; response: Response };
type Session = { cookies: string; csrf: string };

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

async function result(response: Response): Promise<Result> {
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Record<string, unknown> : undefined, response };
}

test("Admin P0 HTTP E2E covers case operations, transfer, fraud, outbox and staff disable", async () => {
  const now = Math.floor(Date.now() / 30_000) * 30_000;
  let clock = now;
  const tick = () => { clock += 30_000; };
  const customerId = randomUUID();
  const accountId = randomUUID();
  const kycId = randomUUID();
  const creditId = randomUUID();
  const transferId = randomUUID();
  const fraudId = randomUUID();
  const jobId = randomUUID();
  const deadEventId = randomUUID();
  const createdAt = new Date(now).toISOString();
  const customer: CustomerSummary = { id: customerId, fullName: "P0 E2E Customer", email: "p0-customer@example.test", phoneNumber: "0900000000", accessStatus: "ACTIVE", accessVersion: 1, createdAt };
  const account: AdminAccount = { id: accountId, customerId, displayName: "P0 Current Account", maskedNumber: "****0001", bankName: "Reference", availableMinor: "100000", currentMinor: "100000", heldMinor: "0", status: "ACTIVE", version: 1, updatedAt: createdAt };
  const application = (id: string, applicationType: "KYC" | "CREDIT"): AdminApplication => ({ id, applicationType, customerId, status: "SUBMITTED", version: 1, requestFingerprint: `case-${id}`, assignedStaffId: null, requestedLimitMinor: applicationType === "CREDIT" ? "500000" : undefined, approvedLimitMinor: null, applicantLabel: "Synthetic applicant", decisionReasonCode: null, createdAt, updatedAt: createdAt });
  const transfer: AdminTransfer = { id: transferId, customerId, sourceAccountId: accountId, reference: "P0-TRANSFER-001", amountMinor: "1000", feeMinor: "10", currency: "VND", status: "PENDING", version: 1, lastErrorCode: null, createdAt, updatedAt: createdAt };
  const fraud: AdminFraudCase = { id: fraudId, customerId, accountId, transactionId: randomUUID(), reasonPreview: "Synthetic fraud report", status: "RECEIVED", severity: "HIGH", assignedStaffId: null, resolutionCode: null, version: 1, createdAt, updatedAt: createdAt };
  const job: AdminJob = { id: jobId, jobType: "REFERENCE_RECONCILIATION", status: "DEAD", attempts: 3, lastErrorCode: "PROVIDER_TIMEOUT", leaseExpiresAt: null, createdAt, updatedAt: createdAt };
  const repository = new InMemoryAdminRepository({
    customers: [customer], accounts: [account], applications: [application(kycId, "KYC"), application(creditId, "CREDIT")],
    transfers: [transfer], fraudCases: [fraud], jobs: [job],
    outboxEvents: [{ id: deadEventId, eventType: "transfer.succeeded", aggregateId: transferId, aggregateType: "transfer", aggregateVersion: 1, eventVersion: 1, status: "DEAD", attempts: 3, requeueable: true, occurredAt: createdAt, updatedAt: createdAt, payload: { eventId: deadEventId, eventType: "transfer.succeeded" } }],
  });
  await repository.initialize();
  const encryption = new LocalDevelopmentKeyEncryptionAdapter(Buffer.alloc(32, 13), "admin-p0-e2e");
  const auth = new StaffAuthService({ repository, encryption, clock: () => clock, environmentScope: "preview" });
  const fixture = [
    { email: "p0-operations@example.test", code: "P0-OPS", name: "P0 Operations", role: "OPERATIONS" as const, password: "P0-Operations-password!" , secret: "JBSWY3DPEHPK3PXP" },
    { email: "p0-control@example.test", code: "P0-CTRL", name: "P0 Control", role: "CONTROL" as const, password: "P0-Control-password!", secret: "KRUGS4ZANFZSAYJA" },
    { email: "p0-support@example.test", code: "P0-SUP", name: "P0 Support", role: "SUPPORT" as const, password: "P0-Support-password!", secret: "MFRGGZDFMZTWQ2LK" },
    { email: "p0-admin@example.test", code: "P0-ADMIN", name: "P0 Admin", role: "ADMIN" as const, password: "P0-Admin-password!", secret: "ONSWG4TFOQ======" },
  ];
  const staffIds = new Map<string, string>();
  for (const item of fixture) {
    const invite = await auth.invite({ email: item.email, employeeCode: item.code, displayName: item.name, role: item.role });
    const activated = await auth.activate({ inviteToken: invite.token, password: item.password, totpSecret: item.secret });
    staffIds.set(item.email, activated.staffId);
  }
  const actions = new AdminActionEngine(repository, auth);
  const server = createAdminServer({ repository, auth, actions, allowedOrigins: ["http://allowed.test"], environment: "development", secureCookies: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.unref();
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const request = async (path: string, init: RequestInit = {}, session?: Session): Promise<Result> => {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (session) { headers.set("cookie", session.cookies); if (!headers.has("x-csrf-token")) headers.set("x-csrf-token", session.csrf); }
    return result(await fetch(`${baseUrl}${path}`, { ...init, headers }));
  };
  const json = (value: Record<string, unknown>) => JSON.stringify(value);
  const login = async (item: typeof fixture[number]): Promise<Session> => {
    const started = await request("/api/v1/admin/auth/login", { method: "POST", body: json({ email: item.email, password: item.password }) });
    assert.equal(started.status, 202);
    tick();
    const verified = await request("/api/v1/admin/auth/mfa/verify", { method: "POST", headers: { "x-device-id": `device-${item.code}` }, body: json({ challengeId: String(started.body?.challengeId), code: generateTotp(item.secret, clock) }) });
    assert.equal(verified.status, 200);
    return { cookies: mergeCookies("", verified.response), csrf: String(verified.body?.csrfToken) };
  };
  const createAction = async (session: Session, path: string, body: Record<string, unknown>, key: string): Promise<Record<string, unknown>> => {
    const response = await request(path, { method: "POST", headers: { "idempotency-key": key }, body: json(body) }, session);
    assert.equal(response.status, 202, JSON.stringify(response.body));
    return response.body?.action as Record<string, unknown>;
  };
  const approve = async (session: Session, action: Record<string, unknown>, key: string): Promise<Record<string, unknown>> => {
    const response = await request(`/api/v1/admin/approvals/${String(action.id)}/approve`, { method: "POST", headers: { "idempotency-key": key }, body: json({ fingerprint: action.requestFingerprint, version: action.version, reasonCode: "P0_E2E_REVIEW", decision: "APPROVED", comment: "Independent P0 checker review" }) }, session);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body?.action as Record<string, unknown>;
  };
  const reject = async (session: Session, action: Record<string, unknown>, key: string): Promise<Record<string, unknown>> => {
    const response = await request(`/api/v1/admin/approvals/${String(action.id)}/reject`, { method: "POST", headers: { "idempotency-key": key }, body: json({ fingerprint: action.requestFingerprint, version: action.version, reasonCode: "P0_E2E_REJECT", comment: "Independent P0 checker rejection" }) }, session);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body?.action as Record<string, unknown>;
  };

  try {
    const operations = await login(fixture[0]);
    const control = await login(fixture[1]);
    const support = await login(fixture[2]);
    const admin = await login(fixture[3]);
    const corsDenied = await request("/api/v1/admin/me", { headers: { Origin: "http://evil.test" } }, control);
    assert.equal(corsDenied.status, 403);
    assert.equal(corsDenied.body?.code, "CORS_ORIGIN_DENIED");
    const injectionSearch = await request("/api/v1/admin/customers?q=%27%20OR%201%3D1", {}, support);
    assert.equal(injectionSearch.status, 200);
    assert.equal((injectionSearch.body?.items as unknown[]).length, 0);
    const supportFundingDenied = await request(`/api/v1/admin/accounts/${accountId}/funding-requests`, { method: "POST", headers: { "idempotency-key": "p0-support-funding-denied" }, body: json({ amountMinor: "1", currency: "VND", reasonCode: "P0_DENIED", ticketReference: "P0-DENY", description: "must be denied" }) }, support);
    assert.equal(supportFundingDenied.status, 409);
    assert.equal(supportFundingDenied.body?.code, "ADMIN_PERMISSION_DENIED");
    const unknownField = await request(`/api/v1/admin/accounts/${accountId}/funding-requests`, { method: "POST", headers: { "idempotency-key": "p0-unknown-field-1" }, body: json({ amountMinor: "1", currency: "VND", reasonCode: "P0_UNKNOWN", ticketReference: "P0-UNKNOWN", description: "unsupported field", dangerous: "reject" }) }, operations);
    assert.equal(unknownField.status, 422);
    assert.equal(unknownField.body?.code, "VALIDATION_ERROR");
    tick();
    const stepUp = await request("/api/v1/admin/auth/step-up", { method: "POST", body: json({ code: generateTotp(fixture[1].secret, clock) }) }, control);
    assert.equal(stepUp.status, 204);

    const rejectedFunding = await createAction(operations, `/api/v1/admin/accounts/${accountId}/funding-requests`, { amountMinor: "500", currency: "VND", reasonCode: "P0_REJECTED_FUNDING", ticketReference: "P0-REJECT", description: "Must remain a rejected request" }, "p0-funding-reject-001");
    assert.equal((await reject(control, rejectedFunding, "p0-funding-reject-approve-1")).status, "REJECTED");
    const rejectedFundingAccount = (await request(`/api/v1/admin/accounts/${accountId}`, {}, control)).body?.account as Record<string, unknown>;
    assert.equal(rejectedFundingAccount.availableMinor, "100000");

    const funding = await createAction(operations, `/api/v1/admin/accounts/${accountId}/funding-requests`, { amountMinor: "2500", currency: "VND", reasonCode: "P0_FUNDING", ticketReference: "P0-001", description: "P0 funding" }, "p0-funding-001");
    const selfApproval = await request(`/api/v1/admin/approvals/${String(funding.id)}/approve`, { method: "POST", headers: { "idempotency-key": "p0-self-approval-1" }, body: json({ fingerprint: funding.requestFingerprint, version: funding.version, reasonCode: "P0_SELF", decision: "APPROVED", comment: "must be denied" }) }, operations);
    assert.equal(selfApproval.status, 409);
    assert.equal(selfApproval.body?.code, "SELF_APPROVAL_FORBIDDEN");
    const funded = await approve(control, funding, "p0-funding-approve-1");
    assert.equal(funded.status, "SUCCEEDED");

    const block = await createAction(support, `/api/v1/admin/accounts/${accountId}/block-requests`, { reasonCode: "P0_ACCOUNT_BLOCK", ticketReference: "P0-002", description: "Support block request" }, "p0-block-001");
    await approve(control, block, "p0-block-approve-1");
    assert.equal((await request(`/api/v1/admin/accounts/${accountId}`, {}, control)).body?.account && ((await request(`/api/v1/admin/accounts/${accountId}`, {}, control)).body?.account as Record<string, unknown>).status, "BLOCKED");

    const kycClaim = await request(`/api/v1/admin/kyc-applications/${kycId}/claim`, { method: "POST", headers: { "idempotency-key": "p0-kyc-claim-1" }, body: "{}" }, operations);
    assert.equal(kycClaim.status, 200);
    const kycAction = await createAction(operations, `/api/v1/admin/kyc-applications/${kycId}/review-recommendations`, { decision: "APPROVED", reasonCode: "P0_KYC_APPROVAL", ticketReference: "P0-003", description: "KYC review" }, "p0-kyc-001");
    await approve(control, kycAction, "p0-kyc-approve-1");
    assert.equal((await request("/api/v1/admin/applications", {}, control)).body?.items && ((await request("/api/v1/admin/applications", {}, control)).body?.items as Array<Record<string, unknown>>).find((item) => item.id === kycId)?.status, "APPROVED");

    const creditClaim = await request(`/api/v1/admin/credit-applications/${creditId}/claim`, { method: "POST", headers: { "idempotency-key": "p0-credit-claim-1" }, body: "{}" }, operations);
    assert.equal(creditClaim.status, 200);
    const creditAction = await createAction(operations, `/api/v1/admin/credit-applications/${creditId}/review-recommendations`, { decision: "PENDING_ACTIVATION", approvedLimitMinor: "400000", reasonCode: "P0_CREDIT_APPROVAL", ticketReference: "P0-004", description: "Credit review" }, "p0-credit-001");
    await approve(control, creditAction, "p0-credit-approve-1");

    const transferAction = await createAction(operations, `/api/v1/admin/transfers/${transferId}/cancel-requests`, { reasonCode: "P0_TRANSFER_CANCEL", ticketReference: "P0-005", description: "Cancel pending transfer" }, "p0-transfer-001");
    await approve(control, transferAction, "p0-transfer-approve-1");
    assert.equal(((await request(`/api/v1/admin/transfers/${transferId}`, {}, control)).body?.transfer as Record<string, unknown>).status, "FAILED");

    const fraudClaim = await request(`/api/v1/admin/fraud-cases/${fraudId}/claim`, { method: "POST", headers: { "idempotency-key": "p0-fraud-claim-1" }, body: "{}" }, operations);
    assert.equal(fraudClaim.status, 200);
    const note = await request(`/api/v1/admin/fraud-cases/${fraudId}/notes`, { method: "POST", headers: { "idempotency-key": "p0-fraud-note-1" }, body: json({ note: "Reviewed synthetic evidence; no secret data." }) }, operations);
    assert.equal(note.status, 201);
    const fraudAction = await createAction(operations, `/api/v1/admin/fraud-cases/${fraudId}/resolution-requests`, { operation: "RESOLVE", resolutionCode: "NOT_FRAUD", reasonCode: "P0_FRAUD_REVIEW", ticketReference: "P0-006", description: "Fraud triage" }, "p0-fraud-001");
    await approve(control, fraudAction, "p0-fraud-approve-1");
    const fraudDetail = await request(`/api/v1/admin/fraud-cases/${fraudId}`, {}, control);
    assert.equal((fraudDetail.body?.report as Record<string, unknown>).status, "RESOLVED");
    assert.ok((fraudDetail.body?.timeline as Array<Record<string, unknown>>).some((event) => event.eventType === "FRAUD_NOTE_ADDED"));

    const requeueAction = await createAction(operations, `/api/v1/admin/operations/outbox/events/${deadEventId}/requeue-requests`, { reasonCode: "P0_OUTBOX_RETRY", ticketReference: "P0-007", description: "Retry canonical dead event" }, "p0-outbox-001");
    await approve(control, requeueAction, "p0-outbox-approve-1");
    assert.equal(((await request(`/api/v1/admin/operations/outbox/events/${deadEventId}`, {}, control)).body?.event as Record<string, unknown>).status, "PENDING");

    const accessLock = await createAction(operations, `/api/v1/admin/customers/${customerId}/access-lock-requests`, { reasonCode: "P0_CUSTOMER_LOCK", ticketReference: "P0-008", description: "Lock synthetic customer access" }, "p0-customer-lock-001");
    await approve(control, accessLock, "p0-customer-lock-approve-1");
    assert.equal(((await request(`/api/v1/admin/customers/${customerId}`, {}, control)).body?.customer as Record<string, unknown>).accessStatus, "LOCKED");
    const accessUnlock = await createAction(operations, `/api/v1/admin/customers/${customerId}/access-unlock-requests`, { reasonCode: "P0_CUSTOMER_UNLOCK", ticketReference: "P0-009", description: "Unlock synthetic customer access" }, "p0-customer-unlock-001");
    await approve(control, accessUnlock, "p0-customer-unlock-approve-1");
    assert.equal(((await request(`/api/v1/admin/customers/${customerId}`, {}, control)).body?.customer as Record<string, unknown>).accessStatus, "ACTIVE");

    const staffTargetId = staffIds.get(fixture[2].email)!;
    const disableAction = await createAction(admin, `/api/v1/admin/staff/${staffTargetId}/disable-requests`, { reasonCode: "P0_STAFF_DISABLE", ticketReference: "P0-010", description: "Disable synthetic staff" }, "p0-disable-001");
    await approve(control, disableAction, "p0-disable-approve-1");
    const disabledSession = await request("/api/v1/admin/me", {}, support);
    assert.equal(disabledSession.status, 401);
    assert.equal(disabledSession.body?.code, "STAFF_SESSION_EXPIRED");

    const finalAccount = (await request(`/api/v1/admin/accounts/${accountId}`, {}, control)).body?.account as Record<string, unknown>;
    assert.equal(finalAccount.availableMinor, "102500");
    assert.equal(((await request(`/api/v1/admin/accounts/${accountId}/transactions`, {}, control)).body?.items as unknown[]).length, 1);
    const audit = await repository.listAudit(500);
    assert.ok(audit.some((event) => event.action === "ADMIN_PERMISSION_DENIED" && event.outcome === "DENIED"));
  } finally {
    server.closeAllConnections?.();
    server.closeIdleConnections?.();
    server.close();
    await repository.close();
  }
});

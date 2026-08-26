import assert from "node:assert/strict";
import test from "node:test";

import { AdminActionEngine } from "../admin/actions/actionEngine.js";
import { InMemoryAdminRepository, type AdminAccount } from "../admin/repositories/adminRepository.js";
import type { AdminSubject } from "../admin/authorization/permissionRegistry.js";

const operations: AdminSubject = { staffId: "operations-staff", status: "ACTIVE", authorizationVersion: 1, roles: [{ role: "OPERATIONS", environmentScope: "preview", expiresAt: null }] };
const control: AdminSubject = { staffId: "control-staff", status: "ACTIVE", authorizationVersion: 1, roles: [{ role: "CONTROL", environmentScope: "preview", expiresAt: null }], mfaVerifiedAt: new Date().toISOString(), stepUpVerifiedAt: new Date().toISOString() };
const account: AdminAccount = { id: "account-1", customerId: "customer-1", displayName: "Payment", maskedNumber: "•••• 0001", bankName: "Reference", availableMinor: "0", currentMinor: "0", heldMinor: "0", status: "ACTIVE", version: 1, updatedAt: new Date().toISOString() };

async function fixture() {
  const repository = new InMemoryAdminRepository({ accounts: [account] });
  await repository.initialize();
  return { repository, actions: new AdminActionEngine(repository, null as never) };
}

test("maker cannot approve own funding and checker executes once", async () => {
  const { repository, actions } = await fixture();
  const created = await actions.create({ subject: operations, actionType: "SIMULATION_FUNDING", targetType: "ACCOUNT", targetId: account.id, body: { amountMinor: "100000", ticketReference: "TEST-1", reasonCode: "PROJECT_TEST_FUNDING", description: "test" }, idempotencyKey: "funding-idempotency-1", traceId: "trace-1" });
  await assert.rejects(() => actions.approve({ subject: { ...operations, stepUpVerifiedAt: new Date().toISOString() }, accessToken: "unused", requestId: created.id, body: { fingerprint: created.requestFingerprint, reasonCode: "CHECK" }, traceId: "trace-2" }), { code: "SELF_APPROVAL_FORBIDDEN" });
  const approved = await actions.approve({ subject: control, accessToken: "unused", requestId: created.id, body: { fingerprint: created.requestFingerprint, reasonCode: "CHECK" }, traceId: "trace-3" });
  assert.equal(approved.status, "SUCCEEDED");
  assert.equal((await repository.findAccount(account.id))?.availableMinor, "100000");
  const replay = await actions.approve({ subject: control, accessToken: "unused", requestId: created.id, body: { fingerprint: created.requestFingerprint, version: approved.version, reasonCode: "CHECK" }, traceId: "trace-4" });
  assert.equal(replay.status, "SUCCEEDED");
  assert.equal((await repository.findAccount(account.id))?.availableMinor, "100000");
});

test("approved action recovers after the decision transaction boundary", async () => {
  const { repository, actions } = await fixture();
  const created = await actions.create({ subject: operations, actionType: "SIMULATION_FUNDING", targetType: "ACCOUNT", targetId: account.id, body: { amountMinor: "50000", ticketReference: "RECOVERY-1", reasonCode: "RECOVERY_TEST", description: "recovery" }, idempotencyKey: "funding-recovery-1", traceId: "trace-recovery-1" });
  await repository.decideAction({ requestId: created.id, reviewerStaffId: control.staffId, decision: "APPROVED", approvedFingerprint: created.requestFingerprint, reasonCode: "RECOVERY_APPROVED", mfaVerifiedAt: control.stepUpVerifiedAt! });
  const recovered = await actions.approve({ subject: control, accessToken: "unused", requestId: created.id, body: { fingerprint: created.requestFingerprint, reasonCode: "RECOVERY_APPROVED" }, traceId: "trace-recovery-2" });
  assert.equal(recovered.status, "SUCCEEDED");
  assert.equal((await repository.findAccount(account.id))?.availableMinor, "50000");
});

test("rejected action is an idempotent terminal receipt", async () => {
  const { repository, actions } = await fixture();
  const created = await actions.create({ subject: operations, actionType: "SIMULATION_FUNDING", targetType: "ACCOUNT", targetId: account.id, body: { amountMinor: "50000", ticketReference: "REJECT-1", reasonCode: "REJECT_TEST", description: "reject" }, idempotencyKey: "funding-reject-1", traceId: "trace-reject-1" });
  const body = { fingerprint: created.requestFingerprint, version: created.version, reasonCode: "REJECTED_BY_CONTROL", comment: "not approved" };
  const rejected = await actions.reject({ subject: control, requestId: created.id, body, traceId: "trace-reject-2" });
  const replay = await actions.reject({ subject: control, requestId: created.id, body, traceId: "trace-reject-3" });
  assert.equal(rejected.status, "REJECTED");
  assert.deepEqual(replay, rejected);
  assert.equal((await repository.findAccount(account.id))?.availableMinor, "0");
});

test("changed target version returns ACTION_STALE", async () => {
  const { repository, actions } = await fixture();
  const created = await actions.create({ subject: operations, actionType: "ACCOUNT_BLOCK", targetType: "ACCOUNT", targetId: account.id, body: { reasonCode: "FRAUD_REVIEW" }, idempotencyKey: "block-idempotency-1", traceId: "trace-5" });
  const stored = await repository.findAccount(account.id);
  assert.ok(stored);
  // Simulate another writer changing the account after the maker snapshot.
  await repository.executeApprovedAction({ requestId: "missing", approverStaffId: control.staffId, traceId: "trace-6" });
  const privateAccounts = repository as unknown as { accounts: Map<string, AdminAccount> };
  privateAccounts.accounts.get(account.id)!.version += 1;
  await assert.rejects(() => actions.approve({ subject: control, accessToken: "unused", requestId: created.id, body: { fingerprint: created.requestFingerprint, reasonCode: "CHECK" }, traceId: "trace-7" }), { code: "ACTION_STALE" });
});

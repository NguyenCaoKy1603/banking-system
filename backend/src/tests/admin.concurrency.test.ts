import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryAdminRepository } from "../admin/repositories/adminRepository.js";

test("concurrent in-memory Admin execution has one winner", async () => {
  const repository = new InMemoryAdminRepository({ accounts: [{ id: "account-concurrency", customerId: "customer-concurrency", displayName: "Test", maskedNumber: "•••• 0001", bankName: "Reference", availableMinor: "0", currentMinor: "0", heldMinor: "0", status: "ACTIVE", version: 1, updatedAt: new Date().toISOString() }] });
  await repository.initialize();
  const action = await repository.createAction({ actionType: "SIMULATION_FUNDING", requesterStaffId: "maker", targetType: "ACCOUNT", targetId: "account-concurrency", requestFingerprint: "fingerprint", policyVersion: "admin-p0-v1", idempotencyKey: "concurrency-test", expectedTargetVersion: 1, expectedTargetStatus: "ACTIVE", expiresAt: new Date(Date.now() + 60_000).toISOString(), payload: { amountMinor: "1000", description: "test" } });
  await repository.decideAction({ requestId: action.id, reviewerStaffId: "checker", decision: "APPROVED", approvedFingerprint: "fingerprint", reasonCode: "TEST", mfaVerifiedAt: new Date().toISOString() });
  const results = await Promise.all([
    repository.executeApprovedAction({ requestId: action.id, approverStaffId: "checker", traceId: "a" }),
    repository.executeApprovedAction({ requestId: action.id, approverStaffId: "checker", traceId: "b" }),
  ]);
  assert.equal(results.filter((result) => result.status === "SUCCEEDED").length, 1);
  assert.equal(results.filter((result) => result.failureCode === "ACTION_ALREADY_DECIDED").length, 1);
});

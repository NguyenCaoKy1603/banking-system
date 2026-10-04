import assert from "node:assert/strict";
import test from "node:test";

import { ADMIN_ROLES, assertAdminRouteRegistry, hasPermission, normalizeExistingAdminRole, resolvePermissions, ROLE_PERMISSIONS, type AdminSubject } from "../admin/authorization/permissionRegistry.js";
import { redactAdminMetadata } from "../admin/audit/redaction.js";
import { InMemoryAdminRepository, type AdminApplication } from "../admin/repositories/adminRepository.js";

const subject = (role: "OPERATIONS" | "ADMIN"): AdminSubject => ({ staffId: `${role.toLowerCase()}-staff`, status: "ACTIVE", authorizationVersion: 1, roles: [{ role, environmentScope: "preview", expiresAt: null }] });

test("Admin route registry is exact and deny-by-default", () => {
  assert.doesNotThrow(assertAdminRouteRegistry);
  assert.deepEqual(ADMIN_ROLES, ["OPERATIONS", "ADMIN"]);
  assert.equal(hasPermission(subject("OPERATIONS"), "account.block.request"), true);
  assert.equal(hasPermission(subject("OPERATIONS"), "simulation-funding.request"), true);
  assert.equal(hasPermission(subject("OPERATIONS"), "customer.access-unlock.request"), true);
  assert.equal(hasPermission(subject("OPERATIONS"), "customer.access-lock.approve"), false);
  assert.equal(hasPermission(subject("ADMIN"), "simulation-funding.approve"), true);
  assert.equal(hasPermission(subject("ADMIN"), "staff.operations-account.create"), true);
  assert.equal(hasPermission(subject("OPERATIONS"), "staff.operations-account.create"), false);
  assert.equal(hasPermission(subject("ADMIN"), "simulation-funding.request"), false);
  assert.equal(normalizeExistingAdminRole("SUPPORT"), "OPERATIONS");
  assert.equal(normalizeExistingAdminRole("CONTROL"), "ADMIN");
  assert.equal(normalizeExistingAdminRole("UNKNOWN"), null);
});

test("in-memory repository exposes only OPERATIONS and ADMIN", async () => {
  const repository = new InMemoryAdminRepository();
  await repository.initialize();
  try {
    assert.deepEqual((await repository.listRoles()).map((role) => role.code).sort(), ["ADMIN", "OPERATIONS"]);
  } finally {
    await repository.close();
  }
});

test("expired role and locked staff resolve to no permissions", () => {
  const expired: AdminSubject = { ...subject("ADMIN"), roles: [{ role: "ADMIN", environmentScope: "preview", expiresAt: new Date(Date.now() - 1000).toISOString() }] };
  assert.equal(resolvePermissions(expired).size, 0);
  assert.equal(resolvePermissions({ ...subject("ADMIN"), status: "LOCKED" }).size, 0);
  assert.equal(ROLE_PERMISSIONS.ADMIN.has("audit.export"), true);
});

test("audit redaction removes secrets and full account number keys", () => {
  assert.deepEqual(redactAdminMetadata({ password: "x", nested: { otp: "123456", value: "safe" }, accountNumber: "970400000001" }), { password: "[REDACTED]", nested: { otp: "[REDACTED]", value: "safe" }, accountNumber: "[REDACTED]" });
});

test("ABAC case scope hides another staff member's assigned application", async () => {
  const assignedToOther: AdminApplication = { id: "kyc-other", applicationType: "KYC", customerId: "customer-1", status: "UNDER_REVIEW", version: 2, requestFingerprint: "fp-other", assignedStaffId: "other-staff", applicantLabel: "Synthetic applicant", decisionReasonCode: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const unassigned: AdminApplication = { ...assignedToOther, id: "kyc-unassigned", assignedStaffId: null, version: 1 };
  const own: AdminApplication = { ...assignedToOther, id: "kyc-own", assignedStaffId: "support-staff" };
  const repository = new InMemoryAdminRepository({ applications: [assignedToOther, unassigned, own] });
  await repository.initialize();
  try {
    const scope = { staffId: "support-staff", scope: "preview", canSeeAll: false };
    assert.deepEqual((await repository.listApplications("KYC", scope)).map((item) => item.id).sort(), ["kyc-own", "kyc-unassigned"]);
    assert.equal(await repository.findApplication("KYC", "kyc-other", scope), null);
    assert.ok(await repository.findApplication("KYC", "kyc-own", scope));
  } finally {
    await repository.close();
  }
});

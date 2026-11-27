import assert from "node:assert/strict";
import test from "node:test";

import { AdminActionEngine } from "../admin/actions/actionEngine.js";
import { InMemoryAdminRepository, type AdminAccount, type CustomerSummary, type StaffRecord } from "../admin/repositories/adminRepository.js";
import type { AdminSubject } from "../admin/authorization/permissionRegistry.js";

const operations: AdminSubject = { staffId: "operations-staff", status: "ACTIVE", authorizationVersion: 1, roles: [{ role: "OPERATIONS", environmentScope: "preview", expiresAt: null }] };
const control: AdminSubject = { staffId: "admin-checker", status: "ACTIVE", authorizationVersion: 1, roles: [{ role: "ADMIN", environmentScope: "preview", expiresAt: null }], mfaVerifiedAt: new Date().toISOString(), stepUpVerifiedAt: new Date().toISOString() };
const account: AdminAccount = { id: "account-1", customerId: "customer-1", displayName: "Payment", maskedNumber: "•••• 0001", bankName: "Reference", availableMinor: "0", currentMinor: "0", heldMinor: "0", status: "ACTIVE", version: 1, updatedAt: new Date().toISOString() };

async function fixture() {
  const repository = new InMemoryAdminRepository({ accounts: [account] });
  await repository.initialize();
  return { repository, actions: new AdminActionEngine(repository) };
}

test("new staff requests reject the retired role codes", async () => {
  const targetStaff: StaffRecord = {
    id: "staff-role-target",
    employeeCode: "ROLE-TARGET",
    emailNormalized: "role-target@example.test",
    displayName: "Role Target",
    passwordSalt: null,
    passwordDigest: null,
    status: "ACTIVE",
    authorizationVersion: 1,
    passwordChangedAt: null,
    mfaEnrolledAt: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    roles: [{ role: "OPERATIONS", environmentScope: "preview", expiresAt: null }],
  };
  const repository = new InMemoryAdminRepository({ staff: [targetStaff] });
  await repository.initialize();
  const actions = new AdminActionEngine(repository);
  const adminMaker: AdminSubject = { staffId: "admin-maker", status: "ACTIVE", authorizationVersion: 1, roles: [{ role: "ADMIN", environmentScope: "preview", expiresAt: null }] };
  try {
    await assert.rejects(() => actions.create({
      subject: adminMaker,
      actionType: "STAFF_INVITE",
      targetType: "STAFF_INVITE",
      targetId: "new-staff",
      body: { reasonCode: "LEGACY_INVITE_TEST" },
      idempotencyKey: "legacy-invite-action",
      traceId: "trace-legacy-invite",
    }), { code: "APPROVAL_POLICY_UNCONFIGURED" });
    await assert.rejects(() => actions.create({
      subject: adminMaker,
      actionType: "STAFF_ROLE_CHANGE",
      targetType: "STAFF",
      targetId: targetStaff.id,
      body: { roleCode: "CONTROL", operation: "GRANT", environmentScope: "preview", reasonCode: "LEGACY_ROLE_TEST" },
      idempotencyKey: "legacy-role-change",
      traceId: "trace-legacy-role-change",
    }), /Staff role change fields are invalid/);
  } finally {
    await repository.close();
  }
});

test("Operations cannot approve staff disable; an Admin approval executes once", async () => {
  const { repository, actions } = await fixture();
  const targetStaff: StaffRecord = {
    id: "staff-target-1",
    employeeCode: "EMP-900",
    emailNormalized: "target@example.test",
    displayName: "Target Staff",
    passwordSalt: null,
    passwordDigest: null,
    status: "ACTIVE",
    authorizationVersion: 1,
    passwordChangedAt: null,
    mfaEnrolledAt: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    roles: [{ role: "OPERATIONS", environmentScope: "preview", expiresAt: null }],
  };
  const staffRepo = new InMemoryAdminRepository({ accounts: [account], staff: [targetStaff] });
  await staffRepo.initialize();
  const staffActions = new AdminActionEngine(staffRepo);
  try {
    const created = await staffActions.create({ subject: { ...control, stepUpVerifiedAt: null, mfaVerifiedAt: null }, actionType: "STAFF_DISABLE", targetType: "STAFF", targetId: targetStaff.id, body: { ticketReference: "TEST-1", reasonCode: "STAFF_DISABLE_REVIEW", description: "test" }, idempotencyKey: "staff-disable-idempotency-1", traceId: "trace-1" });
    await assert.rejects(() => staffActions.approve({ subject: { ...operations, stepUpVerifiedAt: new Date().toISOString() }, requestId: created.id, body: { fingerprint: created.requestFingerprint, reasonCode: "CHECK" }, traceId: "trace-2" }), { code: "ADMIN_PERMISSION_DENIED" });
    const approved = await staffActions.approve({ subject: control, requestId: created.id, body: { fingerprint: created.requestFingerprint, reasonCode: "CHECK" }, traceId: "trace-3" });
    assert.equal(approved.status, "SUCCEEDED");
    assert.equal((await staffRepo.findStaffById(targetStaff.id))?.status, "DISABLED");
  } finally {
    await staffRepo.close();
  }

  const fundingCreated = await actions.create({ subject: operations, actionType: "SIMULATION_FUNDING", targetType: "ACCOUNT", targetId: account.id, body: { amountMinor: "100000", ticketReference: "TEST-1", reasonCode: "PROJECT_TEST_FUNDING", description: "test" }, idempotencyKey: "funding-idempotency-1", traceId: "trace-1" });
  const fundingApproved = await actions.approve({ subject: control, requestId: fundingCreated.id, body: { fingerprint: fundingCreated.requestFingerprint, reasonCode: "CHECK" }, traceId: "trace-3" });
  assert.equal(fundingApproved.status, "SUCCEEDED");
  assert.equal((await repository.findAccount(account.id))?.availableMinor, "100000");
  const replay = await actions.approve({ subject: control, requestId: fundingCreated.id, body: { fingerprint: fundingCreated.requestFingerprint, version: fundingApproved.version, reasonCode: "CHECK" }, traceId: "trace-4" });
  assert.equal(replay.status, "SUCCEEDED");
  assert.equal((await repository.findAccount(account.id))?.availableMinor, "100000");
});

test("approved action recovers after the decision transaction boundary", async () => {
  const { repository, actions } = await fixture();
  const created = await actions.create({ subject: operations, actionType: "SIMULATION_FUNDING", targetType: "ACCOUNT", targetId: account.id, body: { amountMinor: "50000", ticketReference: "RECOVERY-1", reasonCode: "RECOVERY_TEST", description: "recovery" }, idempotencyKey: "funding-recovery-1", traceId: "trace-recovery-1" });
  await repository.decideAction({ requestId: created.id, reviewerStaffId: control.staffId, decision: "APPROVED", approvedFingerprint: created.requestFingerprint, reasonCode: "RECOVERY_APPROVED", mfaVerifiedAt: control.stepUpVerifiedAt! });
  const recovered = await actions.approve({ subject: control, requestId: created.id, body: { fingerprint: created.requestFingerprint, reasonCode: "RECOVERY_APPROVED" }, traceId: "trace-recovery-2" });
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
  await assert.rejects(() => actions.approve({ subject: control, requestId: created.id, body: { fingerprint: created.requestFingerprint, reasonCode: "CHECK" }, traceId: "trace-7" }), { code: "ACTION_STALE" });
});

test("Operations cannot bypass Maker-Checker with client-supplied directExecution flag when ADMIN_DIRECT_EXECUTION=false", async () => {
  const previousDirectExec = process.env.ADMIN_DIRECT_EXECUTION;
  process.env.ADMIN_DIRECT_EXECUTION = "false";
  const customer: CustomerSummary = {
    id: "customer-1",
    fullName: "Synthetic Customer",
    email: "cust@example.test",
    phoneNumber: "0900000000",
    accessStatus: "ACTIVE",
    accessVersion: 1,
    createdAt: new Date().toISOString(),
  };
  const repository = new InMemoryAdminRepository({
    accounts: [account],
    customers: [customer],
    applications: [
      {
        id: "kyc-app-1",
        applicationType: "KYC",
        customerId: customer.id,
        status: "SUBMITTED",
        version: 1,
        requestFingerprint: "kyc-fp-1",
        assignedStaffId: null,
        decisionReasonCode: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "credit-app-1",
        applicationType: "CREDIT",
        customerId: customer.id,
        status: "SUBMITTED",
        version: 1,
        requestFingerprint: "credit-fp-1",
        assignedStaffId: null,
        requestedLimitMinor: "20000000",
        decisionReasonCode: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  });
  await repository.initialize();
  const actions = new AdminActionEngine(repository);
  try {
    const fundingAction = await actions.create({
      subject: operations,
      actionType: "SIMULATION_FUNDING",
      targetType: "ACCOUNT",
      targetId: account.id,
      body: {
        amountMinor: "500000",
        ticketReference: "BYPASS-TEST-1",
        reasonCode: "ACCOUNT_FUNDING",
        description: "Attempted bypass",
        directExecution: true,
      },
      idempotencyKey: "bypass-funding-1",
      traceId: "trace-bypass-1",
    });
    assert.equal(fundingAction.status, "PENDING_APPROVAL");
    assert.equal((await repository.findAccount(account.id))?.availableMinor, "0");

    // Even an ADMIN with both request & approve permissions on CUSTOMER_ACCESS_LOCK must stay PENDING_APPROVAL when ADMIN_DIRECT_EXECUTION=false
    const adminLockAction = await actions.create({
      subject: control,
      actionType: "CUSTOMER_ACCESS_LOCK",
      targetType: "CUSTOMER",
      targetId: customer.id,
      body: {
        reasonCode: "ACCOUNT_SECURITY",
        description: "Attempted direct lock while disabled",
        directExecution: true,
      },
      idempotencyKey: "bypass-lock-1",
      traceId: "trace-bypass-2",
    });
    assert.equal(adminLockAction.status, "PENDING_APPROVAL");
    assert.equal((await repository.findCustomer(customer.id))?.accessStatus, "ACTIVE");
  } finally {
    if (previousDirectExec === undefined) delete process.env.ADMIN_DIRECT_EXECUTION;
    else process.env.ADMIN_DIRECT_EXECUTION = previousDirectExec;
    await repository.close();
  }
});

test("when ADMIN_DIRECT_EXECUTION=true, Operations direct-executes operational actions while governance actions still require MFA Admin", async () => {
  const previousDirectExec = process.env.ADMIN_DIRECT_EXECUTION;
  process.env.ADMIN_DIRECT_EXECUTION = "true";
  const customer: CustomerSummary = {
    id: "customer-1",
    fullName: "Synthetic Customer",
    email: "cust@example.test",
    phoneNumber: "0900000000",
    accessStatus: "ACTIVE",
    accessVersion: 1,
    createdAt: new Date().toISOString(),
  };
  const repository = new InMemoryAdminRepository({
    accounts: [account],
    customers: [customer],
    applications: [
      {
        id: "kyc-app-1",
        applicationType: "KYC",
        customerId: customer.id,
        status: "SUBMITTED",
        version: 1,
        requestFingerprint: "kyc-fp-1",
        assignedStaffId: null,
        decisionReasonCode: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "credit-app-1",
        applicationType: "CREDIT",
        customerId: customer.id,
        status: "SUBMITTED",
        version: 1,
        requestFingerprint: "credit-fp-1",
        assignedStaffId: null,
        requestedLimitMinor: "20000000",
        decisionReasonCode: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  });
  await repository.initialize();
  const actions = new AdminActionEngine(repository);
  try {
    const opsFunding = await actions.create({
      subject: operations,
      actionType: "SIMULATION_FUNDING",
      targetType: "ACCOUNT",
      targetId: account.id,
      body: {
        amountMinor: "500000",
        ticketReference: "DIRECT-OPS-1",
        reasonCode: "ACCOUNT_FUNDING",
        description: "Ops direct-executes operational funding",
        directExecution: true,
      },
      idempotencyKey: "direct-ops-funding-1",
      traceId: "trace-direct-ops-1",
    });
    assert.equal(opsFunding.status, "SUCCEEDED");
    assert.equal((await repository.findAccount(account.id))?.availableMinor, "500000");

    const adminWithoutMfa: AdminSubject = {
      staffId: "admin-no-mfa",
      status: "ACTIVE",
      authorizationVersion: 1,
      roles: [{ role: "ADMIN", environmentScope: "preview", expiresAt: null }],
    };
    const lockWithoutMfa = await actions.create({
      subject: adminWithoutMfa,
      actionType: "CUSTOMER_ACCESS_LOCK",
      targetType: "CUSTOMER",
      targetId: customer.id,
      body: {
        reasonCode: "ACCOUNT_SECURITY",
        description: "Admin without MFA cannot direct-execute",
      },
      idempotencyKey: "direct-admin-no-mfa-1",
      traceId: "trace-direct-admin-no-mfa",
    });
    assert.equal(lockWithoutMfa.status, "PENDING_APPROVAL");
    assert.equal((await repository.findCustomer(customer.id))?.accessStatus, "ACTIVE");

    const adminLock = await actions.create({
      subject: control,
      actionType: "CUSTOMER_ACCESS_LOCK",
      targetType: "CUSTOMER",
      targetId: customer.id,
      body: {
        reasonCode: "ACCOUNT_SECURITY",
        description: "MFA-verified Admin direct lock in local demo mode",
      },
      idempotencyKey: "direct-admin-mfa-1",
      traceId: "trace-direct-admin-mfa",
    });
    assert.equal(adminLock.status, "SUCCEEDED");
    assert.equal((await repository.findCustomer(customer.id))?.accessStatus, "LOCKED");

    const kycAction = await actions.create({
      subject: operations,
      actionType: "KYC_DECISION",
      targetType: "KYC_APPLICATION",
      targetId: "kyc-app-1",
      body: {
        decision: "APPROVED",
        reasonCode: "KYC_VERIFIED",
        ticketReference: "OPS-KYC-1",
        description: "Operations direct KYC approval",
        directExecution: true,
      },
      idempotencyKey: "direct-ops-kyc-1",
      traceId: "trace-direct-ops-kyc",
    });
    assert.equal(kycAction.status, "SUCCEEDED");

    const creditAction = await actions.create({
      subject: operations,
      actionType: "CREDIT_DECISION",
      targetType: "CREDIT_APPLICATION",
      targetId: "credit-app-1",
      body: {
        decision: "PENDING_ACTIVATION",
        approvedLimitMinor: "20000000",
        reasonCode: "CREDIT_POLICY_PASSED",
        ticketReference: "OPS-CREDIT-1",
        description: "Operations direct credit approval",
        directExecution: true,
      },
      idempotencyKey: "direct-ops-credit-1",
      traceId: "trace-direct-ops-credit",
    });
    assert.equal(creditAction.status, "SUCCEEDED");
  } finally {
    if (previousDirectExec === undefined) delete process.env.ADMIN_DIRECT_EXECUTION;
    else process.env.ADMIN_DIRECT_EXECUTION = previousDirectExec;
    await repository.close();
  }
});

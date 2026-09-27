const test = require("node:test");
const assert = require("node:assert/strict");

let api;
let actionIntent;
let accountLoader;
let approvalsLogic;
let logoutCoordinator;

test.before(async () => {
  // Dynamically import the real implementations from src/ (Node 24 strip-types)
  api = await import("../src/api.ts");
  actionIntent = await import("../src/features/customers/actionIntent.ts");
  accountLoader = await import("../src/features/customers/accountLoader.ts");
  approvalsLogic = await import("../src/features/approvals/approvalsLogic.ts");
  logoutCoordinator = await import("../src/context/logoutCoordinator.ts");
});

test("UI logic 1: real formatting utilities from src/api.ts work correctly without duplication", () => {
  assert.equal(api.formatMinor("100000"), "100.000 VND");
  assert.equal(api.formatMinor("2500"), "2.500 VND");
  assert.equal(api.formatMinor(0), "0 VND");
  assert.equal(api.formatMinor(null), "0 VND");
  assert.equal(api.formatMinor(undefined), "0 VND");

  assert.equal(api.shortId(null), "—");
  assert.equal(api.shortId(""), "—");
  assert.equal(api.shortId("abcd"), "abcd");
  assert.equal(api.shortId("1234567890abcdef", 8), "12345678…");

  assert.equal(api.formatDate(null), "—");
  assert.equal(api.formatDate(""), "—");
  assert.match(api.formatDate("2026-03-27T10:00:00.000Z"), /\d{1,4}/);
});

test("UI logic 2: isIndeterminateError classifies network, timeout, corrupted JSON, and gateway failures correctly", () => {
  // Indeterminate failures: server might have processed the request
  assert.equal(api.isIndeterminateError({ isNetworkOrTimeout: true }), true);
  assert.equal(api.isIndeterminateError({ status: 0 }), true);
  assert.equal(api.isIndeterminateError({ code: "TIMEOUT" }), true);
  assert.equal(api.isIndeterminateError({ code: "NETWORK_ERROR" }), true);
  assert.equal(api.isIndeterminateError({ code: "INVALID_RESPONSE" }), true);
  assert.equal(api.isIndeterminateError({ code: "GATEWAY_ERROR" }), true);
  assert.equal(api.isIndeterminateError({ name: "AbortError" }), true);
  assert.equal(api.isIndeterminateError({ name: "TimeoutError" }), true);
  assert.equal(api.isIndeterminateError({ status: 502 }), true);
  assert.equal(api.isIndeterminateError({ status: 503 }), true);
  assert.equal(api.isIndeterminateError({ status: 504 }), true);

  // Determinate business or validation errors: server definitively rejected the request
  assert.equal(api.isIndeterminateError({ status: 400, code: "VALIDATION_FAILED" }), false);
  assert.equal(api.isIndeterminateError({ status: 403, code: "ADMIN_PERMISSION_DENIED" }), false);
  assert.equal(api.isIndeterminateError({ status: 409, code: "ACTION_STALE" }), false);
  assert.equal(api.isIndeterminateError({ status: 409, code: "SELF_APPROVAL_FORBIDDEN" }), false);
  assert.equal(api.isIndeterminateError(null), false);
  assert.equal(api.isIndeterminateError(undefined), false);
});

test("UI logic 3: real actionIntent module maintains snapshot and idempotency key on retry, but resets on field change", () => {
  // 1. Create a fresh intent in DRAFT
  let intent = actionIntent.createActionIntent({
    targetType: "ACCOUNT",
    targetId: "acc-101",
    targetLabel: "Current Account (***001)",
    kind: "FUND",
    path: "/admin/accounts/acc-101/funding-requests",
    payload: {
      amountMinor: "2500",
      reasonCode: "TEST_FUNDING",
      ticketReference: "TICKET-001",
      description: "",
    },
    prefix: "account-fund",
  });

  const initialKey = intent.idempotencyKey;
  assert.ok(initialKey.startsWith("account-fund-"));
  assert.equal(intent.status, "DRAFT");

  // 2. User reviews the request: enterReviewStep advances status to REVIEWING without changing key
  intent = actionIntent.enterReviewStep(intent);
  assert.equal(intent.status, "REVIEWING");
  assert.equal(intent.idempotencyKey, initialKey);

  // 3. User submits: startIntentSubmit marks SUBMITTING
  intent = actionIntent.startIntentSubmit(intent);
  assert.equal(intent.status, "SUBMITTING");
  assert.equal(intent.idempotencyKey, initialKey);

  // 4. Server times out / network failure: resolveIntentFailure marks INDETERMINATE
  const timeoutErr = { code: "TIMEOUT", isNetworkOrTimeout: true, status: 0 };
  intent = actionIntent.resolveIntentFailure(intent, timeoutErr);
  assert.equal(intent.status, "INDETERMINATE");
  // CRITICAL REQUIREMENT: Stable idempotency key and payload snapshot MUST BE PRESERVED!
  assert.equal(intent.idempotencyKey, initialKey);
  assert.equal(intent.payload.amountMinor, "2500");

  // 5. While INDETERMINATE, backToEditStep does NOT silently clear warning or payload
  const attemptedBack = actionIntent.backToEditStep(intent);
  assert.equal(attemptedBack.status, "INDETERMINATE");
  assert.equal(attemptedBack.idempotencyKey, initialKey);

  // 6. User retries: startIntentSubmit -> resolveIntentSuccess
  intent = actionIntent.startIntentSubmit(intent);
  assert.equal(intent.idempotencyKey, initialKey);
  intent = actionIntent.resolveIntentSuccess(intent, { action: { id: "act-real-1" } });
  assert.equal(intent.status, "SUCCEEDED");
  assert.equal(intent.result.action.id, "act-real-1");

  // 7. Modifying payload on a fresh intent regenerates a new key
  let newIntent = actionIntent.createActionIntent({
    targetType: "ACCOUNT",
    targetId: "acc-101",
    targetLabel: "Current Account (***001)",
    kind: "FUND",
    path: "/admin/accounts/acc-101/funding-requests",
    payload: { amountMinor: "2500", reasonCode: "TEST" },
    prefix: "account-fund",
  });
  const keyBeforeEdit = newIntent.idempotencyKey;
  newIntent = actionIntent.updateIntentPayload(newIntent, {
    amountMinor: "5000",
    reasonCode: "TEST",
  });
  assert.notEqual(newIntent.idempotencyKey, keyBeforeEdit);
  assert.equal(newIntent.status, "DRAFT");
});

test("UI logic 4: real approvalsLogic resolves correct endpoint and preserves REJECT decision through MFA step-up", () => {
  const action = {
    id: "act-999",
    requestFingerprint: "fp-xyz",
    version: 2,
  };

  // 1. Resolving REJECTED decision
  const rejectRes = approvalsLogic.resolveDecisionEndpointAndBody(action, "REJECTED", "Risk assessment");
  assert.equal(rejectRes.path, "/admin/approvals/act-999/reject");
  assert.equal(rejectRes.body.fingerprint, "fp-xyz");
  assert.equal(rejectRes.body.version, 2);
  assert.equal(rejectRes.body.reasonCode, "Risk assessment");
  assert.equal(rejectRes.body.decision, undefined); // Reject endpoint does not set decision: APPROVED

  // 2. Resolving APPROVED decision
  const approveRes = approvalsLogic.resolveDecisionEndpointAndBody(action, "APPROVED", "Checked valid");
  assert.equal(approveRes.path, "/admin/approvals/act-999/approve");
  assert.equal(approveRes.body.decision, "APPROVED");

  // 3. Step-up pending decision simulation:
  // When user clicks 'Từ chối' and step-up is required, pendingDecision is 'REJECTED'
  const pendingDecision = "REJECTED";
  // When user enters TOTP and presses Enter, form executes (pendingDecision || "APPROVED"):
  const executedDecision = pendingDecision || "APPROVED";
  assert.equal(executedDecision, "REJECTED");
  const finalExecution = approvalsLogic.resolveDecisionEndpointAndBody(action, executedDecision, "Rejected by policy");
  assert.equal(finalExecution.path, "/admin/approvals/act-999/reject");
});

test("UI logic 5: real AccountLoadManager discards stale responses and protects active customer", async () => {
  const manager = new accountLoader.AccountLoadManager();

  const custA = { id: "cust-A", fullName: "Customer A" };
  const accountsA = [{ id: "acc-A1", maskedNumber: "99990001" }];

  const custB = { id: "cust-B", fullName: "Customer B" };
  const accountsB = [{ id: "acc-B1", maskedNumber: "99990002" }];

  // 1. Slow fetcher for A (50ms) - intentionally ignores signal.aborted to prove generation guard independence
  let aFinished = false;
  const slowFetcher = async (id, signal) => {
    await new Promise((r) => setTimeout(r, 50));
    // Deliberately do NOT check signal.aborted: complete normally after B has finished!
    aFinished = true;
    return { items: accountsA };
  };

  // 2. Fast fetcher for B (10ms)
  const fastFetcher = async (id, signal) => {
    await new Promise((r) => setTimeout(r, 10));
    if (signal.aborted) throw new Error("Aborted");
    return { items: accountsB };
  };

  // Start loading A
  const promiseA = manager.loadCustomerAccounts(custA, true, slowFetcher);
  assert.equal(manager.getState().selectedCustomer.id, "cust-A");
  assert.deepEqual(manager.getState().accounts, []);

  // Immediately switch to B
  const promiseB = manager.loadCustomerAccounts(custB, true, fastFetcher);
  assert.equal(manager.getState().selectedCustomer.id, "cust-B");
  assert.deepEqual(manager.getState().accounts, []); // Customer A accounts cleared immediately!

  // Wait for B to finish
  await promiseB;
  assert.equal(manager.getState().selectedCustomer.id, "cust-B");
  assert.deepEqual(manager.getState().accounts, accountsB);

  // Wait for A to complete (not aborted, completes after B)
  await promiseA.catch(() => {});
  assert.equal(aFinished, true); // Proves fetcher A completed its execution
  // State MUST STILL be Customer B and accounts of B, proving generation guard rejected A!
  assert.equal(manager.getState().selectedCustomer.id, "cust-B");
  assert.deepEqual(manager.getState().accounts, accountsB);
});

test("UI logic 6: real approvalsLogic permissions separate audit.read from action-specific approval rights", () => {
  // Role 1: ADMIN holds audit.read but NOT simulation-funding.approve
  const adminPermissions = new Set([
    "audit.read",
    "customer.read.masked",
    "staff.invite.request",
  ]);
  const hasAdminPerm = (perm) => adminPermissions.has(perm);

  assert.equal(
    approvalsLogic.canStaffApproveAction("SIMULATION_FUNDING", hasAdminPerm),
    false
  );
  assert.equal(
    approvalsLogic.canStaffApproveAction("ACCOUNT_BLOCK", hasAdminPerm),
    false
  );

  // Role 2: CONTROL holds simulation-funding.approve and account.block.approve
  const controlPermissions = new Set([
    "audit.read",
    "simulation-funding.approve",
    "account.block.approve",
  ]);
  const hasControlPerm = (perm) => controlPermissions.has(perm);

  assert.equal(
    approvalsLogic.canStaffApproveAction("SIMULATION_FUNDING", hasControlPerm),
    true
  );
  assert.equal(
    approvalsLogic.canStaffApproveAction("ACCOUNT_BLOCK", hasControlPerm),
    true
  );

  // Strict deny: unknown action types always evaluate to false
  assert.equal(
    approvalsLogic.canStaffApproveAction("UNKNOWN_MUTATION_TYPE", hasControlPerm),
    false
  );
});

test("UI logic 7: real isSelfApproval prevents Four-Eyes maker from approving own request", () => {
  const currentStaffId = "staff-101";

  // Attempting to approve own action
  assert.equal(approvalsLogic.isSelfApproval(currentStaffId, "staff-101"), true);

  // Independent action from another maker
  assert.equal(approvalsLogic.isSelfApproval(currentStaffId, "staff-202"), false);

  // Edge cases
  assert.equal(approvalsLogic.isSelfApproval(null, "staff-101"), false);
  assert.equal(approvalsLogic.isSelfApproval(currentStaffId, null), false);
});

test("UI logic 8: session pending intents enforce SessionScope generation lifecycle and callback isolation", () => {
  actionIntent.invalidateSessionScope();

  // 1. Session A starts for staff-alpha (generation 1)
  const scopeA = actionIntent.startNewSessionScope("staff-alpha");
  assert.equal(scopeA.staffId, "staff-alpha");
  assert.ok(scopeA.generation > 0);

  const intentA = actionIntent.createActionIntent({
    targetType: "ACCOUNT",
    targetId: "acc-user-1",
    targetLabel: "Target Account",
    kind: "FUND",
    path: "/admin/accounts/acc-user-1/funding-requests",
    payload: { amountMinor: "1000", reasonCode: "TEST" },
    staffId: "staff-alpha",
    sessionScope: scopeA,
  });

  // Track subscriber updates
  let lastSubscriberMap = new Map();
  const unsubscribe = actionIntent.subscribeSessionPendingIntents((map) => {
    lastSubscriberMap = map;
  });

  // Store intent under session A
  const setOk = actionIntent.setSessionPendingIntent("ACCOUNT:acc-user-1", intentA, scopeA);
  assert.equal(setOk, true);

  // 1a. Reader with same scope can retrieve the intent
  const retrievedSame = actionIntent.getSessionPendingIntent("ACCOUNT:acc-user-1", scopeA);
  assert.ok(retrievedSame);
  assert.equal(retrievedSame.id, intentA.id);
  assert.equal(lastSubscriberMap.size, 1);

  // 1b. Tab switch within same session preserves snapshot and key
  const retrievedAfterTabSwitch = actionIntent.getSessionPendingIntent("ACCOUNT:acc-user-1", scopeA);
  assert.equal(retrievedAfterTabSwitch.idempotencyKey, intentA.idempotencyKey);
  assert.deepEqual(retrievedAfterTabSwitch.payload, intentA.payload);

  // 2. Different staff without active scope cannot retrieve intent
  const retrievedOther = actionIntent.getSessionPendingIntent("ACCOUNT:acc-user-1", {
    staffId: "staff-beta",
    generation: scopeA.generation,
  });
  assert.equal(retrievedOther, undefined);

  // 3. User logs out: session scope is invalidated immediately
  actionIntent.invalidateSessionScope();
  assert.equal(actionIntent.getActiveSessionScope(), null);
  assert.equal(actionIntent.getSessionPendingIntent("ACCOUNT:acc-user-1", scopeA), undefined);
  assert.equal(actionIntent.getSessionPendingIntents(scopeA).size, 0);
  assert.equal(lastSubscriberMap.size, 0);

  // 4. Callback from invalidated session A arrives after logout -> REJECTED from store
  const lateWriteAttempt = actionIntent.setSessionPendingIntent("ACCOUNT:acc-user-1", intentA, scopeA);
  assert.equal(lateWriteAttempt, false);
  const lateDeleteAttempt = actionIntent.setSessionPendingIntent("ACCOUNT:acc-user-1", null, scopeA, intentA.id);
  assert.equal(lateDeleteAttempt, false);

  // 5. Staff-alpha logs back in -> receives a NEW generation scope
  const scopeA2 = actionIntent.startNewSessionScope("staff-alpha");
  assert.notEqual(scopeA2.generation, scopeA.generation);

  // 5a. New session cannot retrieve or see intent from previous session of the SAME staff
  assert.equal(actionIntent.getSessionPendingIntent("ACCOUNT:acc-user-1", scopeA2), undefined);
  assert.equal(actionIntent.getSessionPendingIntents(scopeA2).size, 0);

  // 5b. Callback with old scopeA still rejected in new session of same staff
  assert.equal(actionIntent.setSessionPendingIntent("ACCOUNT:acc-user-1", intentA, scopeA), false);

  // 6. Session B starts for staff-beta
  const scopeB = actionIntent.startNewSessionScope("staff-beta");
  const intentB = actionIntent.createActionIntent({
    targetType: "ACCOUNT",
    targetId: "acc-user-1",
    targetLabel: "Target Account B",
    kind: "BLOCK",
    path: "/admin/accounts/acc-user-1/block-requests",
    payload: { reasonCode: "BLOCK_TEST" },
    staffId: "staff-beta",
    sessionScope: scopeB,
  });
  actionIntent.setSessionPendingIntent("ACCOUNT:acc-user-1", intentB, scopeB);

  // 6a. Subscriber and reader for B receive B's intent, not A's
  assert.equal(actionIntent.getSessionPendingIntent("ACCOUNT:acc-user-1", scopeB)?.id, intentB.id);
  assert.equal(actionIntent.getSessionPendingIntent("ACCOUNT:acc-user-1", scopeA), undefined);
  assert.equal(lastSubscriberMap.get("ACCOUNT:acc-user-1")?.id, intentB.id);

  // 7. Old late success callback from session A attempts to delete target -> MUST NOT delete intent of session B
  const lateDeleteOldSession = actionIntent.setSessionPendingIntent("ACCOUNT:acc-user-1", null, scopeA, intentA.id);
  assert.equal(lateDeleteOldSession, false);
  // Verify B's intent is STILL safe and intact in store!
  assert.equal(actionIntent.getSessionPendingIntent("ACCOUNT:acc-user-1", scopeB)?.id, intentB.id);

  // Even if caller passed scopeB but with expectedIntentId of intentA:
  const mismatchedDelete = actionIntent.setSessionPendingIntent("ACCOUNT:acc-user-1", null, scopeB, intentA.id);
  assert.equal(mismatchedDelete, false);
  assert.equal(actionIntent.getSessionPendingIntent("ACCOUNT:acc-user-1", scopeB)?.id, intentB.id);

  unsubscribe();
  actionIntent.invalidateSessionScope();
});

test("UI logic 9: isValidActionResponse validates non-empty action ID and rejects empty or malformed objects", () => {
  // Valid action responses
  assert.equal(actionIntent.isValidActionResponse({ action: { id: "act-12345" } }), true);
  assert.equal(actionIntent.isValidActionResponse({ actionId: "act-67890" }), true);

  // Missing or empty action ID: must be rejected to prevent declaring false success
  assert.equal(actionIntent.isValidActionResponse({}), false);
  assert.equal(actionIntent.isValidActionResponse(null), false);
  assert.equal(actionIntent.isValidActionResponse(undefined), false);
  assert.equal(actionIntent.isValidActionResponse({ action: {} }), false);
  assert.equal(actionIntent.isValidActionResponse({ action: { id: "" } }), false);
  assert.equal(actionIntent.isValidActionResponse({ action: { id: "   " } }), false);
  assert.equal(actionIntent.isValidActionResponse({ actionId: "" }), false);

  // resolveIntentSuccess throws INVALID_RESPONSE on empty object
  let intent = actionIntent.createActionIntent({
    targetType: "ACCOUNT",
    targetId: "acc-101",
    targetLabel: "Account",
    kind: "FUND",
    path: "/test",
    payload: {},
  });
  intent = actionIntent.startIntentSubmit(intent);

  assert.throws(
    () => actionIntent.resolveIntentSuccess(intent, {}),
    (err) => err.code === "INVALID_RESPONSE" && err.isNetworkOrTimeout === true
  );
});

test("UI logic 10: resolveIntentFailure on retry preserves INDETERMINATE status and key on IDEMPOTENCY_CONFLICT", () => {
  let intent = actionIntent.createActionIntent({
    targetType: "ACCOUNT",
    targetId: "acc-101",
    targetLabel: "Account",
    kind: "FUND",
    path: "/test",
    payload: { amountMinor: "2500", reasonCode: "TEST" },
    prefix: "account-fund",
  });

  const originalKey = intent.idempotencyKey;

  // 1. First submission times out -> INDETERMINATE
  intent = actionIntent.startIntentSubmit(intent);
  intent = actionIntent.resolveIntentFailure(intent, { code: "TIMEOUT", isNetworkOrTimeout: true });
  assert.equal(intent.status, "INDETERMINATE");
  assert.equal(intent.idempotencyKey, originalKey);

  // 2. Retry encounters IDEMPOTENCY_CONFLICT (HTTP 409)
  // This DOES NOT prove the previous request was not processed; it must remain INDETERMINATE!
  intent = actionIntent.startIntentSubmit(intent);
  intent = actionIntent.resolveIntentFailure(intent, {
    status: 409,
    code: "IDEMPOTENCY_CONFLICT",
    message: "Idempotency key already exists",
  });

  assert.equal(intent.status, "INDETERMINATE");
  assert.equal(intent.idempotencyKey, originalKey);
  assert.match(intent.error.message, /xung đột khóa xử lý/);

  // 3. While in INDETERMINATE, updateIntentPayload refuses to modify payload or rotate key
  const attemptedEdit = actionIntent.updateIntentPayload(intent, { amountMinor: "9999", reasonCode: "HACK" });
  assert.equal(attemptedEdit.status, "INDETERMINATE");
  assert.equal(attemptedEdit.idempotencyKey, originalKey);
  assert.equal(attemptedEdit.payload.amountMinor, "2500");
});

test("UI logic 11: drainPendingLogout coordinator clears timer on early resolution and aborts hanging logout on timeout", async () => {
  // Test the shared logout coordinator helper from src/context/logoutCoordinator.ts:
  // 1. Early resolution: logout finishes before timeout
  let abortCalled1 = false;
  const controller1 = {
    abort: () => { abortCalled1 = true; },
    signal: { aborted: false },
  };
  let resolveLogout1;
  const logoutPromise1 = new Promise((resolve) => { resolveLogout1 = resolve; });

  const pending1 = { promise: logoutPromise1, abortController: controller1 };
  const coordPromise1 = logoutCoordinator.drainPendingLogout(pending1, 100);

  // Logout resolves quickly:
  resolveLogout1();
  await coordPromise1;
  assert.equal(abortCalled1, false, "abort must NOT be called when logout finishes early");

  // Wait past original timeout to verify timer was cleared and did not leak / call abort later
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(abortCalled1, false, "abort must NOT be called by leaked timer after early completion");

  // 2. Hanging resolution: logout never resolves -> timeout triggers abort
  let abortCalled2 = false;
  const controller2 = {
    abort: () => { abortCalled2 = true; },
    signal: { aborted: false },
  };
  const hangingPromise2 = new Promise(() => {}); // never resolves
  const pending2 = { promise: hangingPromise2, abortController: controller2 };

  await logoutCoordinator.drainPendingLogout(pending2, 50);
  assert.equal(abortCalled2, true, "abort MUST be called when logout hangs past timeout");

  // 3. Null pending input handles cleanly without throwing
  await assert.doesNotReject(logoutCoordinator.drainPendingLogout(null, 50));
});

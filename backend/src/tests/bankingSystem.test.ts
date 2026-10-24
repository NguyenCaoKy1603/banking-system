import assert from "node:assert/strict";
import test from "node:test";

import { BankingSystem, OUTBOX_EVENT_RETENTION_MS } from "../bankingSystem.js";
import { InMemoryCoreBanking } from "../services/coreBanking.js";
import type { LoginResponse, LoginResult } from "../types.js";

let fixtureSequence = 0;

function requireTokenPair(result: LoginResult): LoginResponse {
  assert.ok("accessToken" in result);
  return result;
}

function createSystem() {
  let now = Date.parse("2026-08-14T00:00:00.000Z");
  const system = new BankingSystem({
    clock: () => now,
    sandboxOtp: "123456",
    allowUnsafeDirectSandboxStepUp: true,
  });

  return {
    system,
    advance(ms: number) {
      now += ms;
    },
  };
}

function getAccountNumber(system: BankingSystem, userId: string): string {
  const account = system.listAccounts(userId)[0];
  assert.ok(account);
  return system.getAccountNumber(userId, account.id);
}

function prepareTransferFixture(system: BankingSystem, userId: string) {
  const account = system.listAccounts(userId)[0];
  assert.ok(account);
  fixtureSequence += 1;
  system.seedReferenceFunding(`fixture-funding-${fixtureSequence}`, {
    recipientAccountNumber: getAccountNumber(system, userId),
    amount: { currency: "VND", amountMinor: "10000000" },
    reason: "test fixture funding",
  });

  let beneficiary = system.listBeneficiaries(userId)[0];
  if (!beneficiary) {
    const recipient = system.register({
      fullName: "Transfer Recipient",
      email: `transfer-recipient-${fixtureSequence}@example.com`,
      phoneNumber: `098${String(10000000 + fixtureSequence).slice(-7)}`,
      password: "Password1",
    }).user;
    beneficiary = system.createBeneficiary(userId, {
      displayName: "Người nhận sandbox",
      accountNumber: getAccountNumber(system, recipient.id),
      bankName: "Reference Bank",
    });
  }

  return { account, beneficiary };
}

test("auth refresh rotates token and detects reuse", () => {
  const { system } = createSystem();
  const registered = system.register({
    fullName: "Test User",
    email: "tester@example.com",
    phoneNumber: "0912345678",
    password: "Password1",
  });
  const firstPair = requireTokenPair(system.login(registered.user.email, "Password1"));
  const secondPair = system.refresh(firstPair.refreshToken);

  assert.notEqual(secondPair.refreshToken, firstPair.refreshToken);
  assert.equal(system.authenticate(secondPair.accessToken).id, registered.user.id);
  assert.throws(
    () => system.refresh(firstPair.refreshToken),
    /reuse detected/,
  );
  assert.throws(
    () => system.authenticate(secondPair.accessToken),
    /invalid or expired/,
  );
});

test("beneficiary directory supports create, rename and delete with audit events", () => {
  const { system } = createSystem();
  const registered = system.register({
    fullName: "Beneficiary User",
    email: "beneficiary@example.com",
    phoneNumber: "0912345688",
    password: "Password1",
  });
  const firstRecipient = system.register({
    fullName: "First Recipient",
    email: "beneficiary-recipient-a@example.com",
    phoneNumber: "0912345689",
    password: "Password1",
  }).user;
  const secondRecipient = system.register({
    fullName: "Second Recipient",
    email: "beneficiary-recipient-b@example.com",
    phoneNumber: "0912345690",
    password: "Password1",
  }).user;
  const firstAccountNumber = getAccountNumber(system, firstRecipient.id);
  const secondAccountNumber = getAccountNumber(system, secondRecipient.id);

  const created = system.createBeneficiary(registered.user.id, {
    displayName: "Gia đình",
    accountNumber: firstAccountNumber,
    bankName: "Reference Bank",
  });
  assert.equal(created.displayName, "Gia đình");
  assert.equal(created.maskedAccountNumber, `•••• ${firstAccountNumber.slice(-4)}`);
  assert.equal(system.listBeneficiaries(registered.user.id).length, 1);

  const sameSuffixDifferentAccount = system.createBeneficiary(
    registered.user.id,
    {
      displayName: "Khác ngân hàng số",
      accountNumber: secondAccountNumber,
      bankName: "Reference Bank",
    },
  );
  assert.equal(sameSuffixDifferentAccount.maskedAccountNumber, `•••• ${secondAccountNumber.slice(-4)}`);
  assert.equal(system.listBeneficiaries(registered.user.id).length, 2);

  assert.throws(
    () =>
      system.createBeneficiary(registered.user.id, {
        displayName: "Trùng",
        accountNumber: firstAccountNumber,
        bankName: "Reference Bank",
      }),
    /already exists/,
  );

  const renamed = system.renameBeneficiary(
    registered.user.id,
    created.id,
    "Người thân",
  );
  assert.equal(renamed.displayName, "Người thân");

  system.deleteBeneficiary(registered.user.id, created.id);
  assert.equal(
    system.listBeneficiaries(registered.user.id).some((item) => item.id === created.id),
    false,
  );
  assert.deepEqual(
    system.auditEvents
      .filter((event) => event.resourceId === created.id)
      .map((event) => event.eventType),
    ["BENEFICIARY_CREATED", "BENEFICIARY_RENAMED", "BENEFICIARY_DELETED"],
  );
});

test("login can require a server-driven MFA challenge", () => {
  const mfaSystem = new BankingSystem({
    sandboxMfaOtp: "654321",
    mfaRequired: true,
  });
  const registered = mfaSystem.register({
    fullName: "MFA User",
    email: "mfa@example.com",
    phoneNumber: "0912345684",
    password: "Password1",
  });

  const challenge = mfaSystem.login(registered.user.email, "Password1", "device-mfa");
  assert.ok(!("accessToken" in challenge));
  assert.deepEqual(challenge.methods, ["OTP"]);

  const pair = requireTokenPair(
    mfaSystem.verifyLoginChallenge(
      challenge.challengeId,
      "OTP",
      "654321",
      "device-mfa",
    ),
  );
  assert.equal(mfaSystem.authenticate(pair.accessToken, "device-mfa").id, registered.user.id);
  assert.throws(() =>
    mfaSystem.verifyLoginChallenge(
      challenge.challengeId,
      "OTP",
      "654321",
      "device-mfa",
    ),
  );
});

test("preview environment requires MFA unless explicitly overridden by the service", () => {
  const previousEnvironment = process.env.BANKING_ENV;
  const previousMfaRequired = process.env.BANKING_MFA_REQUIRED;
  process.env.BANKING_ENV = "preview";
  process.env.BANKING_MFA_REQUIRED = "0";
  try {
    const previewSystem = new BankingSystem({ sandboxMfaOtp: "654321" });
    const registered = previewSystem.register({
      fullName: "Preview MFA User",
      email: "preview-mfa@example.com",
      phoneNumber: "0912345705",
      password: "Password1",
    });
    const challenge = previewSystem.login(registered.user.email, "Password1");
    assert.equal("accessToken" in challenge, false);
  } finally {
    if (previousEnvironment === undefined) {
      delete process.env.BANKING_ENV;
    } else {
      process.env.BANKING_ENV = previousEnvironment;
    }
    if (previousMfaRequired === undefined) {
      delete process.env.BANKING_MFA_REQUIRED;
    } else {
      process.env.BANKING_MFA_REQUIRED = previousMfaRequired;
    }
  }
});

test("MFA challenge methods are server-configurable", () => {
  const mfaSystem = new BankingSystem({
    authChallengeMethods: ["BIOMETRIC"],
    mfaRequired: true,
    allowUnsafeDirectSandboxStepUp: true,
  });
  const registered = mfaSystem.register({
    fullName: "Biometric User",
    email: "biometric@example.com",
    phoneNumber: "0912345699",
    password: "Password1",
  });

  const challenge = mfaSystem.login(
    registered.user.email,
    "Password1",
    "device-biometric",
  );
  assert.ok(!("accessToken" in challenge));
  assert.deepEqual(challenge.methods, ["BIOMETRIC"]);

  const pair = requireTokenPair(
    mfaSystem.verifyLoginChallenge(
      challenge.challengeId,
      "BIOMETRIC",
      "sandbox-biometric",
      "device-biometric",
    ),
  );
  assert.equal(
    mfaSystem.authenticate(pair.accessToken, "device-biometric").id,
    registered.user.id,
  );
});

test("static biometric proof is disabled unless local sandbox opts in explicitly", () => {
  assert.throws(
    () =>
      new BankingSystem({
        authChallengeMethods: ["BIOMETRIC"],
        mfaRequired: true,
      }),
    /explicit local-development unsafe switch/,
  );
  assert.deepEqual(new BankingSystem().getControlPolicy().stepUpMethods, ["OTP"]);
});

test("auth login applies a bounded rate limit to repeated failures", () => {
  const { system, advance } = createSystem();
  const registered = system.register({
    fullName: "Rate Limit User",
    email: "rate-limit@example.com",
    phoneNumber: "0912345685",
    password: "Password1",
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.throws(() => system.login(registered.user.email, "wrong-password"));
  }
  assert.throws(
    () => system.login(registered.user.email, "wrong-password"),
    /Too many authentication attempts/,
  );

  advance(60 * 1000 + 1);
  const pair = requireTokenPair(system.login(registered.user.email, "Password1"));
  assert.ok(pair.accessToken);
});

test("auth login rate limit cannot be bypassed by rotating device IDs", () => {
  const { system } = createSystem();
  const registered = system.register({
    fullName: "Rotating Device User",
    email: "rotating-device@example.com",
    phoneNumber: "0912345686",
    password: "Password1",
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.throws(() =>
      system.login(
        registered.user.email,
        "wrong-password",
        `rotating-device-${attempt}`,
      ),
    );
  }

  assert.throws(
    () => system.login(registered.user.email, "wrong-password", "new-device"),
    /Too many authentication attempts/,
  );
});

test("registration applies a bounded rate limit per caller key", () => {
  const { system } = createSystem();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    system.register(
      {
        fullName: `Registration User ${attempt}`,
        email: `registration-${attempt}@example.com`,
        phoneNumber: `09123457${10 + attempt}`,
        password: "Password1",
      },
      "caller-registration-key",
    );
  }

  assert.throws(
    () =>
      system.register(
        {
          fullName: "Blocked Registration",
          email: "registration-blocked@example.com",
          phoneNumber: "0912345799",
          password: "Password1",
        },
        "caller-registration-key",
      ),
    /Too many registration attempts/,
  );
});

test("device binding rejects token use from another device", () => {
  const { system } = createSystem();
  const registered = system.register({
    fullName: "Device User",
    email: "device@example.com",
    phoneNumber: "0912345680",
    password: "Password1",
  });
  const pair = requireTokenPair(
    system.login(registered.user.email, "Password1", "device-a"),
  );

  assert.equal(system.authenticate(pair.accessToken, "device-a").id, registered.user.id);
  assert.throws(
    () => system.authenticate(pair.accessToken, "device-b"),
    /Device binding mismatch/,
  );
  assert.throws(
    () => system.refresh(pair.refreshToken, "device-b"),
    /Device binding mismatch/,
  );
});

test("logout all devices revokes every access session and refresh family", () => {
  const { system } = createSystem();
  const registered = system.register({
    fullName: "Multi Device User",
    email: "multi-device@example.com",
    phoneNumber: "0912345681",
    password: "Password1",
  });
  const deviceAPair = requireTokenPair(
    system.login(registered.user.email, "Password1", "device-a"),
  );
  const deviceBPair = requireTokenPair(
    system.login(registered.user.email, "Password1", "device-b"),
  );

  system.revokeAllSessions(registered.user.id);

  assert.throws(() => system.authenticate(deviceAPair.accessToken, "device-a"));
  assert.throws(() => system.authenticate(deviceBPair.accessToken, "device-b"));
  assert.throws(() => system.refresh(deviceAPair.refreshToken, "device-a"));
  assert.throws(() => system.refresh(deviceBPair.refreshToken, "device-b"));
  assert.ok(
    system.auditEvents.some((event) => event.eventType === "ALL_SESSIONS_REVOKED"),
  );
});

test("transfer quote and submit are server-authoritative and idempotent", () => {
  const { system, advance } = createSystem();
  const registered = system.register({
    fullName: "Test User",
    email: "tester@example.com",
    phoneNumber: "0912345678",
    password: "Password1",
  });
  const { account, beneficiary } = prepareTransferFixture(system, registered.user.id);

  const quote = system.createQuote(registered.user.id, {
    sourceAccountId: account.id,
    beneficiaryId: beneficiary.id,
    amount: { currency: "VND", amountMinor: "100000" },
  });
  const request = {
    quoteId: quote.quoteId,
    stepUp: { method: "OTP" as const, proof: "123456" },
  };
  const firstReceipt = system.submitTransfer(
    registered.user.id,
    "transfer-intent-1",
    request,
  );
  const retryReceipt = system.submitTransfer(
    registered.user.id,
    "transfer-intent-1",
    { ...request, stepUp: { method: "OTP", proof: "654321" } },
  );
  advance(OUTBOX_EVENT_RETENTION_MS + 1);
  const lateRetryReceipt = system.submitTransfer(
    registered.user.id,
    "transfer-intent-1",
    request,
  );

  assert.deepEqual(retryReceipt, firstReceipt);
  assert.deepEqual(lateRetryReceipt, firstReceipt);
  assert.equal(system.listTransactions(registered.user.id, account.id).items.length, 2);
  assert.equal(system.listAccounts(registered.user.id)[0]?.availableBalance.amountMinor, "9899000");
  assert.equal(system.reconcile()[0]?.differenceMinor, "0");
  assert.ok(system.auditEvents.some((event) => event.eventType === "TRANSFER_SUCCEEDED"));
  assert.ok(
    system.auditEvents.some((event) => event.eventType === "TRANSFER_STEP_UP_VERIFIED"),
  );
  assert.ok(system.outboxEvents.some((event) => event.aggregateId === firstReceipt.transferId));
  const notification = system.listNotifications(registered.user.id)[0];
  assert.ok(notification);
  assert.equal(notification.read, false);
  assert.equal(
    system.markNotificationRead(registered.user.id, notification.id).read,
    true,
  );
  const transaction = system
    .listTransactions(registered.user.id, account.id)
    .items.find((item) => item.kind === "TRANSFER");
  assert.ok(transaction);
  assert.equal(notification.resourceId, transaction.id);
  assert.equal(notification.resourceAccountId, account.id);
});

test("direct sandbox OTP cannot bypass a one-time transaction challenge", () => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const user = system.register({
    fullName: "Challenge Bound User",
    email: "challenge-bound@example.com",
    phoneNumber: "0912345799",
    password: "Password1",
  }).user;
  const { account, beneficiary } = prepareTransferFixture(system, user.id);
  const quote = system.createQuote(user.id, {
    sourceAccountId: account.id,
    beneficiaryId: beneficiary.id,
    amount: { currency: "VND", amountMinor: "100000" },
  });
  assert.throws(
    () =>
      system.submitTransfer(user.id, "challenge-bypass", {
        quoteId: quote.quoteId,
        stepUp: { method: "OTP", proof: "123456" },
      }),
    /Step-up challenge is invalid/,
  );
  const challenge = system.createOtpChallenge(
    user.id,
    "challenge-device",
    "TRANSFER",
    quote.quoteId,
  );
  const receipt = system.submitTransfer(
    user.id,
    "challenge-bound-submit",
    {
      quoteId: quote.quoteId,
      stepUp: {
        method: "OTP",
        proof: "123456",
        challengeId: challenge.challengeId,
      },
    },
    "challenge-device",
  );
  assert.equal(receipt.status, "SUCCEEDED");
});

test("quote snapshots beneficiary name and can be consumed only once", () => {
  const { system } = createSystem();
  const registered = system.register({
    fullName: "Quote Snapshot User",
    email: "quote-snapshot@example.com",
    phoneNumber: "0912345700",
    password: "Password1",
  });
  const { account, beneficiary } = prepareTransferFixture(system, registered.user.id);

  const quote = system.createQuote(registered.user.id, {
    sourceAccountId: account.id,
    beneficiaryId: beneficiary.id,
    amount: { currency: "VND", amountMinor: "100000" },
  });
  system.renameBeneficiary(registered.user.id, beneficiary.id, "Tên mới sau review");

  assert.equal(quote.beneficiary.displayName, "Người nhận sandbox");
  const receipt = system.submitTransfer(registered.user.id, "quote-once-key-01", {
    quoteId: quote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });
  const transferTransaction = system
    .listTransactions(registered.user.id, account.id)
    .items.find((item) => item.kind === "TRANSFER");
  assert.equal(transferTransaction?.counterpartyName, "Người nhận sandbox");
  assert.deepEqual(
    system.submitTransfer(registered.user.id, "quote-once-key-01", {
      quoteId: quote.quoteId,
      stepUp: { method: "OTP", proof: "wrong-but-idempotent" },
    }),
    receipt,
  );
  const auditCount = system.auditEvents.length;
  const outboxCount = system.outboxEvents.length;
  const recoveredWithNewKey = system.submitTransfer(
    registered.user.id,
    "quote-once-key-02",
    {
      quoteId: quote.quoteId,
      stepUp: { method: "OTP", proof: "not-rechecked" },
    },
  );
  assert.equal(recoveredWithNewKey.transferId, receipt.transferId);
  assert.equal(system.auditEvents.length, auditCount);
  assert.equal(system.outboxEvents.length, outboxCount);
  assert.equal(system.listTransactions(registered.user.id, account.id).items.length, 2);

  const corrupted = system.exportState();
  corrupted.transfers = corrupted.transfers.filter(
    ([transferId]) => transferId !== receipt.transferId,
  );
  const restored = new BankingSystem({
    sandboxOtp: "123456",
    allowUnsafeDirectSandboxStepUp: true,
  });
  restored.importState(corrupted);
  assert.throws(
    () =>
      restored.submitTransfer(registered.user.id, "quote-once-key-01", {
        quoteId: quote.quoteId,
        stepUp: { method: "OTP", proof: "not-rechecked" },
      }),
    (error: unknown) =>
      (error as { status?: number; code?: string }).status === 409 &&
      (error as { code?: string }).code === "IDEMPOTENCY_STATE_MISSING",
  );
});

test("transfer step-up applies a bounded rate limit and resets after the window", () => {
  const { system, advance } = createSystem();
  const registered = system.register({
    fullName: "Step-up Rate User",
    email: "step-up-rate@example.com",
    phoneNumber: "0912345703",
    password: "Password1",
  });
  const { account, beneficiary } = prepareTransferFixture(system, registered.user.id);
  const quote = system.createQuote(registered.user.id, {
    sourceAccountId: account.id,
    beneficiaryId: beneficiary.id,
    amount: { currency: "VND", amountMinor: "100000" },
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.throws(
      () =>
        system.submitTransfer(registered.user.id, `step-up-rate-key-${attempt}`, {
          quoteId: quote.quoteId,
          stepUp: { method: "OTP", proof: "wrong-proof" },
        }),
      attempt === 4 ? /Too many transfer step-up attempts/ : /Step-up challenge is invalid/,
    );
  }

  advance(60 * 1000 + 1);
  const receipt = system.submitTransfer(registered.user.id, "step-up-rate-retry", {
    quoteId: quote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });
  assert.equal(receipt.status, "SUCCEEDED");
});

test("outbox retry metadata and pending threshold are observable", () => {
  const { system } = createSystem();
  const thresholdSystem = new BankingSystem({
    sandboxOtp: "123456",
    allowUnsafeDirectSandboxStepUp: true,
    outboxPendingThreshold: 0,
  });
  const registered = thresholdSystem.register({
    fullName: "Outbox User",
    email: "outbox@example.com",
    phoneNumber: "0912345704",
    password: "Password1",
  });
  const { account, beneficiary } = prepareTransferFixture(thresholdSystem, registered.user.id);
  const quote = thresholdSystem.createQuote(registered.user.id, {
    sourceAccountId: account.id,
    beneficiaryId: beneficiary.id,
    amount: { currency: "VND", amountMinor: "100000" },
  });
  thresholdSystem.submitTransfer(registered.user.id, "outbox-intent-key", {
    quoteId: quote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });

  const degraded = thresholdSystem.getHealth();
  assert.equal(degraded.status, "degraded");
  assert.equal(degraded.outbox, "degraded");
  const event = thresholdSystem.retryOutbox()[0];
  assert.ok(event);
  assert.equal(event.attempts, 1);
  assert.equal(thresholdSystem.retryOutbox().length, 0);
  thresholdSystem.markOutboxPublished(event.id);
  for (const pendingEvent of thresholdSystem.outboxEvents) {
    thresholdSystem.markOutboxPublished(pendingEvent.id);
  }
  const recovered = thresholdSystem.getHealth();
  assert.equal(recovered.status, "ok");
  assert.equal(recovered.pendingOutboxEvents, 0);
  assert.equal(system.getHealth().outbox, "ok");
});

test("runtime customer and account IDs are UUID-compatible", () => {
  const { system } = createSystem();
  const registered = system.register({
    fullName: "UUID User",
    email: "uuid@example.com",
    phoneNumber: "0912345701",
    password: "Password1",
  });
  const account = system.listAccounts(registered.user.id)[0];
  assert.ok(account);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert.match(registered.user.id, uuidPattern);
  assert.match(account.id, uuidPattern);
  assert.equal(account.bankName, "Ngân hàng reference");
});

test("transaction cursor remains stable when a newer transaction is inserted", () => {
  const { system, advance } = createSystem();
  const user = system.register({
    fullName: "Cursor User",
    email: "cursor@example.com",
    phoneNumber: "0912345703",
    password: "Password1",
  }).user;
  const account = system.listAccounts(user.id)[0]!;
  const accountNumber = system.getAccountNumber(user.id, account.id);
  for (let index = 1; index <= 3; index += 1) {
    system.seedReferenceFunding(`cursor-funding-${index}`, {
      recipientAccountNumber: accountNumber,
      amount: { currency: "VND", amountMinor: String(index * 1000) },
      reason: `cursor fixture ${index}`,
    });
    advance(1_000);
  }

  const first = system.listTransactions(user.id, account.id, undefined, 2);
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);
  system.seedReferenceFunding("cursor-funding-newer", {
    recipientAccountNumber: accountNumber,
    amount: { currency: "VND", amountMinor: "4000" },
    reason: "newer cursor fixture",
  });
  const second = system.listTransactions(user.id, account.id, first.nextCursor, 2);
  assert.equal(second.items.length, 1);
  assert.equal(second.nextCursor, null);
  assert.equal(
    new Set([...first.items, ...second.items].map((item) => item.id)).size,
    3,
  );
  assert.equal(
    [...first.items, ...second.items].some((item) => item.amount.amountMinor === "4000"),
    false,
  );
  assert.throws(
    () => system.listTransactions(user.id, account.id, "not-a-cursor", 2),
    (error: unknown) => (error as { code?: string }).code === "VALIDATION_ERROR",
  );
});

test("reconciliation reports core minus ledger difference", () => {
  const core = new InMemoryCoreBanking();
  const system = new BankingSystem({ core });
  const registered = system.register({
    fullName: "Reconciliation User",
    email: "reconciliation@example.com",
    phoneNumber: "0912345702",
    password: "Password1",
  });
  const account = system.listAccounts(registered.user.id)[0];
  assert.ok(account);
  system.seedReferenceFunding("reconciliation-funding", {
    recipientAccountNumber: getAccountNumber(system, registered.user.id),
    amount: { currency: "VND", amountMinor: "10000000" },
    reason: "test fixture funding",
  });

  core.ledger.append({
    journalId: "reconciliation-drift",
    occurredAt: "2026-08-14T00:00:00.000Z",
    entries: [
      {
        accountId: "drift-source:VND",
        side: "DEBIT",
        amountMinor: 1n,
        currency: "VND",
      },
      {
        accountId: account.id,
        side: "CREDIT",
        amountMinor: 1n,
        currency: "VND",
      },
    ],
  });

  const row = system.reconcile()[0];
  assert.ok(row);
  assert.equal(row.coreAvailableMinor, "10000000");
  assert.equal(row.computedAvailableMinor, "10000001");
  assert.equal(row.transactionComputedAvailableMinor, "10000000");
  assert.equal(row.differenceMinor, "-1");
});

test("savings maturity is durable, idempotent and backed by a posted liability", () => {
  const core = new InMemoryCoreBanking();
  const ownerId = "savings-core-owner";
  const occurredAt = "2026-08-14T00:00:00.000Z";
  const account = core.createPaymentAccount(ownerId, occurredAt);
  const accountNumber = core.getPaymentAccountNumber(ownerId, account.id);
  core.fundPaymentAccount(
    "savings-core-funding",
    accountNumber,
    2_000_000n,
    "Savings maturity fixture",
    occurredAt,
  );
  core.postSavingsOpening(ownerId, {
    openingId: "savings-core-opening",
    depositId: "savings-core-deposit",
    accountId: account.id,
    amountMinor: 1_000_000n,
    description: "Open savings fixture",
    now: occurredAt,
  });

  const maturityInput = {
    idempotencyKey: "savings-core-deposit:2026-09-14",
    depositId: "savings-core-deposit",
    accountId: account.id,
    principalMinor: 1_000_000n,
    interestMinor: 100n,
    creditToPaymentMinor: 1_000_100n,
    newSavingsPrincipalMinor: 0n,
    now: "2026-09-14T00:00:00.000Z",
    description: "Mature savings fixture",
  };
  const first = core.postSavingsMaturity(ownerId, maturityInput);
  const stateAfterFirst = core.exportState();
  const transactionsAfterFirst = core.listTransactions(ownerId, account.id);
  const replay = core.postSavingsMaturity(ownerId, maturityInput);
  assert.deepEqual(replay, first);
  assert.deepEqual(core.exportState(), stateAfterFirst);
  assert.equal(
    core.listTransactions(ownerId, account.id).length,
    transactionsAfterFirst.length,
  );

  const restored = new InMemoryCoreBanking();
  restored.importState(stateAfterFirst);
  assert.deepEqual(restored.postSavingsMaturity(ownerId, maturityInput), first);
  assert.deepEqual(restored.exportState(), stateAfterFirst);
  assert.throws(
    () =>
      restored.postSavingsMaturity(ownerId, {
        ...maturityInput,
        idempotencyKey: "phantom-savings-maturity",
        depositId: "missing-savings-deposit",
      }),
    /posted liability/,
  );
  assert.throws(
    () =>
      restored.postSavingsMaturity(ownerId, {
        ...maturityInput,
        idempotencyKey: "unbalanced-savings-maturity",
        depositId: "another-savings-deposit",
        creditToPaymentMinor: 1_000_099n,
      }),
    /maturity amounts/i,
  );
});

test("pending transfer can be recovered and settled without a second debit", () => {
  const system = new BankingSystem({
    sandboxOtp: "123456",
    allowUnsafeDirectSandboxStepUp: true,
    settleTransfersImmediately: false,
  });
  const registered = system.register({
    fullName: "Pending User",
    email: "pending@example.com",
    phoneNumber: "0912345682",
    password: "Password1",
  });
  const { account, beneficiary } = prepareTransferFixture(system, registered.user.id);

  const quote = system.createQuote(registered.user.id, {
    sourceAccountId: account.id,
    beneficiaryId: beneficiary.id,
    amount: { currency: "VND", amountMinor: "100000" },
  });
  const pending = system.submitTransfer(registered.user.id, "pending-intent-key", {
    quoteId: quote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });

  assert.equal(pending.status, "PENDING");
  assert.equal(system.getTransfer(registered.user.id, pending.transferId).status, "PENDING");
  assert.equal(
    system.listTransactions(registered.user.id, account.id).items.find((item) => item.kind === "TRANSFER")?.status,
    "PENDING",
  );
  assert.equal(system.listTransactions(registered.user.id, account.id).items.length, 2);

  const processing = system.runReferenceScheduledWork(registered.user.id);
  assert.equal(processing.transfersSettled, 1);
  const settled = system.getTransfer(registered.user.id, pending.transferId);
  assert.equal(settled.status, "SUCCEEDED");
  assert.equal(
    system.submitTransfer(registered.user.id, "pending-intent-key", {
      quoteId: quote.quoteId,
      stepUp: { method: "OTP", proof: "123456" },
    }).status,
    "SUCCEEDED",
  );
  assert.equal(system.listTransactions(registered.user.id, account.id).items.length, 2);
  assert.equal(system.reconcile()[0]?.differenceMinor, "0");
});

test("pending transfer failure and reversal release the reserved balance", () => {
  const system = new BankingSystem({
    sandboxOtp: "123456",
    allowUnsafeDirectSandboxStepUp: true,
    settleTransfersImmediately: false,
  });
  const registered = system.register({
    fullName: "State User",
    email: "state@example.com",
    phoneNumber: "0912345686",
    password: "Password1",
  });
  const { account, beneficiary } = prepareTransferFixture(system, registered.user.id);

  const quote = system.createQuote(registered.user.id, {
    sourceAccountId: account.id,
    beneficiaryId: beneficiary.id,
    amount: { currency: "VND", amountMinor: "100000" },
  });
  const pending = system.submitTransfer(registered.user.id, "failed-intent-key", {
    quoteId: quote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });
  const failed = system.failTransfer(registered.user.id, pending.transferId);
  assert.equal(failed.status, "FAILED");
  assert.equal(system.listAccounts(registered.user.id)[0]?.availableBalance.amountMinor, "10000000");
  assert.equal(system.reconcile()[0]?.differenceMinor, "0");

  const secondQuote = system.createQuote(registered.user.id, {
    sourceAccountId: account.id,
    beneficiaryId: beneficiary.id,
    amount: { currency: "VND", amountMinor: "200000" },
  });
  const secondPending = system.submitTransfer(registered.user.id, "reversed-intent-key", {
    quoteId: secondQuote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });
  const secondSucceeded = system.settleTransfer(registered.user.id, secondPending.transferId);
  const reversed = system.reverseTransfer(registered.user.id, secondSucceeded.transferId);
  assert.equal(reversed.status, "REVERSED");
  assert.equal(system.listAccounts(registered.user.id)[0]?.availableBalance.amountMinor, "10000000");
  assert.equal(system.reconcile()[0]?.differenceMinor, "0");
});

test("transfer reversal fails atomically when recipient funds are reserved", () => {
  const system = new BankingSystem({
    sandboxOtp: "123456",
    allowUnsafeDirectSandboxStepUp: true,
    settleTransfersImmediately: false,
  });
  const sender = system.register({
    fullName: "Reversal Sender",
    email: "reversal-sender@example.com",
    phoneNumber: "0912345690",
    password: "Password1",
  }).user;
  const recipient = system.register({
    fullName: "Reversal Recipient",
    email: "reversal-recipient@example.com",
    phoneNumber: "0912345691",
    password: "Password1",
  }).user;
  const senderAccount = system.listAccounts(sender.id)[0]!;
  const recipientAccount = system.listAccounts(recipient.id)[0]!;
  system.seedReferenceFunding("reversal-source-funding", {
    recipientAccountNumber: getAccountNumber(system, sender.id),
    amount: { currency: "VND", amountMinor: "2000000" },
    reason: "reversal atomicity fixture",
  });
  const recipientBeneficiary = system.createBeneficiary(sender.id, {
    displayName: "Reversal Recipient",
    accountNumber: getAccountNumber(system, recipient.id),
    bankName: "Reference Bank",
  });
  const inboundQuote = system.createQuote(sender.id, {
    sourceAccountId: senderAccount.id,
    beneficiaryId: recipientBeneficiary.id,
    amount: { currency: "VND", amountMinor: "1000000" },
  });
  const inbound = system.submitTransfer(sender.id, "reversal-inbound", {
    quoteId: inboundQuote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });
  system.settleTransfer(sender.id, inbound.transferId);

  const senderBeneficiary = system.createBeneficiary(recipient.id, {
    displayName: "Reversal Sender",
    accountNumber: getAccountNumber(system, sender.id),
    bankName: "Reference Bank",
  });
  const outboundQuote = system.createQuote(recipient.id, {
    sourceAccountId: recipientAccount.id,
    beneficiaryId: senderBeneficiary.id,
    amount: { currency: "VND", amountMinor: "999000" },
  });
  system.submitTransfer(recipient.id, "reversal-outbound-hold", {
    quoteId: outboundQuote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });

  const before = system.listAccounts(recipient.id)[0]!;
  assert.equal(before.currentBalance.amountMinor, "1000000");
  assert.equal(before.availableBalance.amountMinor, "0");
  assert.throws(
    () => system.reverseTransfer(sender.id, inbound.transferId),
    /số dư khả dụng/,
  );
  const after = system.listAccounts(recipient.id)[0]!;
  assert.deepEqual(after.currentBalance, before.currentBalance);
  assert.deepEqual(after.availableBalance, before.availableBalance);
  assert.equal(system.getTransfer(sender.id, inbound.transferId).status, "SUCCEEDED");
});

test("same idempotency key with a different quote is rejected", () => {
  const { system } = createSystem();
  const registered = system.register({
    fullName: "Test User",
    email: "tester@example.com",
    phoneNumber: "0912345678",
    password: "Password1",
  });
  const { account, beneficiary } = prepareTransferFixture(system, registered.user.id);
  const quoteA = system.createQuote(registered.user.id, {
    sourceAccountId: account.id,
    beneficiaryId: beneficiary.id,
    amount: { currency: "VND", amountMinor: "100000" },
  });
  const quoteB = system.createQuote(registered.user.id, {
    sourceAccountId: account.id,
    beneficiaryId: beneficiary.id,
    amount: { currency: "VND", amountMinor: "200000" },
  });

  system.submitTransfer(registered.user.id, "transfer-intent-2", {
    quoteId: quoteA.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });

  assert.throws(
    () =>
      system.submitTransfer(registered.user.id, "transfer-intent-2", {
        quoteId: quoteB.quoteId,
        stepUp: { method: "OTP", proof: "123456" },
      }),
    (error: unknown) =>
      (error as { status?: number; code?: string }).status === 409 &&
      (error as { code?: string }).code === "IDEMPOTENCY_CONFLICT",
  );
});

test("expired quote cannot be submitted", () => {
  const { system, advance } = createSystem();
  const registered = system.register({
    fullName: "Test User",
    email: "tester@example.com",
    phoneNumber: "0912345678",
    password: "Password1",
  });
  const { account, beneficiary } = prepareTransferFixture(system, registered.user.id);
  const quote = system.createQuote(registered.user.id, {
    sourceAccountId: account.id,
    beneficiaryId: beneficiary.id,
    amount: { currency: "VND", amountMinor: "100000" },
  });

  advance(5 * 60 * 1000 + 1);

  assert.throws(
    () =>
      system.submitTransfer(registered.user.id, "transfer-intent-3", {
        quoteId: quote.quoteId,
        stepUp: { method: "OTP", proof: "123456" },
      }),
    (error: unknown) =>
      (error as { code?: string }).code === "QUOTE_EXPIRED",
  );
});

test("cleanup removes expired quotes and retained published outbox events", () => {
  const { system, advance } = createSystem();
  const registered = system.register({
    fullName: "Cleanup User",
    email: "cleanup@example.com",
    phoneNumber: "0912345699",
    password: "Password1",
  });
  const { account, beneficiary } = prepareTransferFixture(system, registered.user.id);
  const publishedFunding = system.outboxEvents[0];
  assert.ok(publishedFunding);
  system.markOutboxPublished(publishedFunding.id);

  system.seedReferenceFunding("cleanup-pending-funding", {
    recipientAccountNumber: getAccountNumber(system, registered.user.id),
    amount: { currency: "VND", amountMinor: "100000" },
    reason: "cleanup pending outbox fixture",
  });
  const pendingFunding = system.outboxEvents.find(
    (event) => event.id !== publishedFunding.id,
  );
  assert.ok(pendingFunding);

  const expiredQuote = system.createQuote(registered.user.id, {
    sourceAccountId: account.id,
    beneficiaryId: beneficiary.id,
    amount: { currency: "VND", amountMinor: "100000" },
  });
  advance(OUTBOX_EVENT_RETENTION_MS + 1);
  const freshQuote = system.createQuote(registered.user.id, {
    sourceAccountId: account.id,
    beneficiaryId: beneficiary.id,
    amount: { currency: "VND", amountMinor: "200000" },
  });

  const state = system.exportState();
  assert.equal(state.quotes.some(([quoteId]) => quoteId === expiredQuote.quoteId), false);
  assert.equal(state.quotes.some(([quoteId]) => quoteId === freshQuote.quoteId), true);
  assert.equal(
    state.outboxEventStore.some((event) => event.id === publishedFunding.id),
    false,
  );
  assert.equal(
    state.outboxEventStore.some((event) => event.id === pendingFunding.id),
    true,
  );
});

test("server kill switch blocks quote creation", () => {
  const system = new BankingSystem({ globalKillSwitch: true });
  const registered = system.register({
    fullName: "Test User",
    email: "kill-switch@example.com",
    phoneNumber: "0912345679",
    password: "Password1",
  });
  const { account, beneficiary } = prepareTransferFixture(system, registered.user.id);

  assert.throws(
    () =>
      system.createQuote(registered.user.id, {
        sourceAccountId: account.id,
        beneficiaryId: beneficiary.id,
        amount: { currency: "VND", amountMinor: "100000" },
      }),
    /temporarily unavailable/,
  );
});

test("server control policy rejects a disabled step-up method", () => {
  const system = new BankingSystem({ stepUpMethods: ["OTP"] });
  const registered = system.register({
    fullName: "Step Up User",
    email: "step-up@example.com",
    phoneNumber: "0912345683",
    password: "Password1",
  });
  const { account, beneficiary } = prepareTransferFixture(system, registered.user.id);
  assert.deepEqual(system.getControlPolicy().stepUpMethods, ["OTP"]);

  const quote = system.createQuote(registered.user.id, {
    sourceAccountId: account.id,
    beneficiaryId: beneficiary.id,
    amount: { currency: "VND", amountMinor: "100000" },
  });

  assert.throws(
    () =>
      system.submitTransfer(registered.user.id, "biometric-disabled", {
        quoteId: quote.quoteId,
        stepUp: { method: "BIOMETRIC", proof: "sandbox-biometric" },
      }),
    /not enabled/,
  );
});

test("server control policy enforces a per-user allowlist", () => {
  let allowedUserId: string | null = null;
  const system = new BankingSystem({
    allowlist: (userId) => userId === allowedUserId,
  });
  const allowed = system.register({
    fullName: "Allowed User",
    email: "allowed@example.com",
    phoneNumber: "0912345687",
    password: "Password1",
  });
  const blocked = system.register({
    fullName: "Blocked User",
    email: "blocked@example.com",
    phoneNumber: "0912345688",
    password: "Password1",
  });

  allowedUserId = allowed.user.id;
  const allowedPolicy = system.getControlPolicy(allowedUserId);
  const blockedPolicy = system.getControlPolicy(blocked.user.id);
  assert.equal(allowedPolicy.allowlisted, true);
  assert.equal(blockedPolicy.allowlisted, false);

  const { account: allowedAccount, beneficiary: allowedBeneficiary } = prepareTransferFixture(
    system,
    allowed.user.id,
  );
  const { account: blockedAccount, beneficiary: blockedBeneficiary } = prepareTransferFixture(
    system,
    blocked.user.id,
  );

  assert.doesNotThrow(() =>
    system.createQuote(allowed.user.id, {
      sourceAccountId: allowedAccount.id,
      beneficiaryId: allowedBeneficiary.id,
      amount: { currency: "VND", amountMinor: "100000" },
    }),
  );
  assert.throws(
    () =>
      system.createQuote(blocked.user.id, {
        sourceAccountId: blockedAccount.id,
        beneficiaryId: blockedBeneficiary.id,
        amount: { currency: "VND", amountMinor: "100000" },
      }),
    /temporarily unavailable/,
  );
});

test("server control policy enforces the configured transfer limit", () => {
  const system = new BankingSystem({ maxTransferAmountMinor: "100000" });
  const registered = system.register({
    fullName: "Limited User",
    email: "limited@example.com",
    phoneNumber: "0912345690",
    password: "Password1",
  });
  const { account, beneficiary } = prepareTransferFixture(system, registered.user.id);
  assert.equal(system.getControlPolicy().maxTransferAmountMinor, "100000");

  assert.throws(
    () =>
      system.createQuote(registered.user.id, {
        sourceAccountId: account.id,
        beneficiaryId: beneficiary.id,
        amount: { currency: "VND", amountMinor: "100001" },
      }),
    /outside the sandbox limit/,
  );
});

test("audit and outbox reads cannot mutate internal event history", () => {
  const system = new BankingSystem();
  const registered = system.register({
    fullName: "Immutable Audit User",
    email: "immutable-audit@example.com",
    phoneNumber: "0912345691",
    password: "Password1",
  });

  const auditSnapshot = system.auditEvents[0];
  assert.ok(auditSnapshot);
  (auditSnapshot as { eventType: string }).eventType = "TAMPERED";

  assert.equal(system.auditEvents.find((event) => event.eventType === "USER_REGISTERED")?.eventType, "USER_REGISTERED");
  assert.equal(system.auditEvents.length, 1);
  assert.equal(system.outboxEvents.length, 0);
  assert.equal(registered.user.email, "immutable-audit@example.com");
});

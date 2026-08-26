import assert from "node:assert/strict";
import test from "node:test";

import { BankingSystem } from "../bankingSystem.js";
import { addMonthsClamped, calculateMinimumPayment, nextStatementCloseAt } from "../credit.js";


function createSystem(options: ConstructorParameters<typeof BankingSystem>[0] = {}) {
  let now = Date.parse("2026-08-14T00:00:00.000Z");
  const system = new BankingSystem({
    ...options,
    clock: () => now,
    sandboxOtp: "123456",
    allowUnsafeDirectSandboxStepUp: true,
  });
  return { system, advance: (milliseconds: number) => { now += milliseconds; } };
}

function register(system: BankingSystem, suffix: string) {
  const user = system.register({
    fullName: "Credit Sandbox User",
    email: `credit-${suffix}@example.com`,
    phoneNumber: `0912345${suffix.padStart(3, "0")}`,
    password: "Password1",
  }).user;
  const paymentAccount = system.listAccounts(user.id)[0];
  assert.ok(paymentAccount);
  system.seedReferenceFunding(`credit-funding-${suffix}`, {
    recipientAccountNumber: system.getAccountNumber(user.id, paymentAccount.id),
    amount: { currency: "VND", amountMinor: "10000000" },
    reason: "test fixture funding",
  });
  system.seedReferenceCredit(user.id);
  return user;
}

test("credit statement schedule closes on the 25th in Asia/Ho_Chi_Minh", () => {
  assert.equal(
    nextStatementCloseAt("2026-08-14T00:00:00.000Z"),
    "2026-08-24T17:00:00.000Z",
  );
  assert.equal(
    nextStatementCloseAt("2026-08-24T17:00:00.000Z"),
    "2026-09-24T17:00:00.000Z",
  );
});

test("credit date helpers handle month-end and leap-year boundaries", () => {
  assert.equal(
    addMonthsClamped("2024-01-31T00:00:00.000Z", 1),
    "2024-02-29T00:00:00.000Z",
  );
  assert.equal(
    addMonthsClamped("2023-01-31T00:00:00.000Z", 1),
    "2023-02-28T00:00:00.000Z",
  );
  assert.equal(
    addMonthsClamped("2024-02-29T00:00:00.000Z", 12),
    "2025-02-28T00:00:00.000Z",
  );
  assert.equal(
    nextStatementCloseAt("2024-02-24T16:59:59.999Z"),
    "2024-02-24T17:00:00.000Z",
  );
  assert.equal(
    nextStatementCloseAt("2024-02-24T17:00:00.000Z"),
    "2024-03-24T17:00:00.000Z",
  );
});

test("minimum payment never exceeds the statement balance", () => {
  assert.equal(calculateMinimumPayment(50_000n), 50_000n);
  assert.equal(calculateMinimumPayment(200_000n), 100_000n);
  assert.equal(calculateMinimumPayment(4_000_000n), 200_000n);
});

test("statement close is idempotent and emits one credit notification", () => {
  const { system, advance } = createSystem();
  const user = register(system, "705");
  const account = system.listCreditAccounts(user.id)[0]!;
  assert.equal(system.listCreditStatements(user.id, account.creditAccountId).items.length, 1);

  advance(10 * 24 * 60 * 60 * 1000 + 17 * 60 * 60 * 1000);
  const firstProcessing = system.runReferenceScheduledWork(user.id);
  const firstRun = system.listCreditStatements(user.id, account.creditAccountId).items;
  const stateAfterFirstRead = system.exportState();
  const secondRun = system.listCreditStatements(user.id, account.creditAccountId).items;
  const secondProcessing = system.runReferenceScheduledWork(user.id);
  assert.equal(firstProcessing.creditStatements, 1);
  assert.equal(secondProcessing.creditStatements, 0);
  assert.equal(firstRun.length, 2);
  assert.equal(secondRun.length, 2);
  assert.deepEqual(system.exportState(), stateAfterFirstRead);
  assert.deepEqual(
    secondRun.map((statement) => statement.statementId),
    firstRun.map((statement) => statement.statementId),
  );
  assert.equal(
    system.listNotifications(user.id).filter((notification) => notification.type === "CREDIT").length,
    1,
  );
});

test("credit statement cursor does not duplicate rows when a newer cycle closes", () => {
  const { system, advance } = createSystem();
  const user = register(system, "712");
  const account = system.listCreditAccounts(user.id)[0]!;
  advance(11 * 24 * 60 * 60 * 1000);
  system.runReferenceScheduledWork(user.id);
  const first = system.listCreditStatements(
    user.id,
    account.creditAccountId,
    undefined,
    1,
  );
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor);

  advance(31 * 24 * 60 * 60 * 1000);
  system.runReferenceScheduledWork(user.id);
  const second = system.listCreditStatements(
    user.id,
    account.creditAccountId,
    first.nextCursor,
    10,
  );
  assert.equal(second.items.length, 1);
  assert.notEqual(second.items[0]?.statementId, first.items[0]?.statementId);
  assert.equal(second.nextCursor, null);
});

test("overdue credit seed emits one notification that targets the card", () => {
  const { system } = createSystem({ creditOverdueSeed: true });
  const user = register(system, "708");
  const card = system.listCards(user.id)[0]!;
  const account = system.listCreditAccounts(user.id)[0]!;
  system.runReferenceScheduledWork(user.id);
  const statement = system.listCreditStatements(user.id, account.creditAccountId).items[0]!;

  assert.equal(statement.status, "OVERDUE");
  const notifications = system.listNotifications(user.id).filter((notification) => notification.type === "CREDIT");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.resourceId, card.cardId);

  system.listCards(user.id);
  assert.equal(
    system.listNotifications(user.id).filter((notification) => notification.type === "CREDIT").length,
    1,
  );
});

test("credit sandbox seeds a card, statement and server-calculated balances", () => {
  const { system } = createSystem();
  const user = register(system, "701");
  const card = system.listCards(user.id)[0];
  const account = system.listCreditAccounts(user.id)[0];
  const statement = system.listCreditStatements(user.id, account!.creditAccountId).items[0];

  assert.ok(card);
  assert.ok(account);
  assert.ok(statement);
  assert.equal(account.creditLimit.amountMinor, "20000000");
  assert.equal(account.postedOutstanding.amountMinor, "4000000");
  assert.equal(account.pendingAuthorizations.amountMinor, "0");
  assert.equal(account.availableCredit.amountMinor, "16000000");
  assert.equal(statement.minimumPaymentDue.amountMinor, "200000");
  assert.equal(card.maskedNumber.includes("PAN"), false);
});

test("credit payment applies once, updates statement and reconciles to ledger", () => {
  const { system } = createSystem();
  const user = register(system, "702");
  const source = system.listAccounts(user.id)[0]!;
  const account = system.listCreditAccounts(user.id)[0]!;
  const statement = system.listCreditStatements(user.id, account.creditAccountId).items[0]!;

  const quote = system.createCreditPaymentQuote(user.id, {
    sourceAccountId: source.id,
    creditAccountId: account.creditAccountId,
    statementId: statement.statementId,
    paymentOption: "CUSTOM",
    amount: { currency: "VND", amountMinor: "1000000" },
  });
  const payment = system.submitCreditPayment(user.id, "credit-payment-key-a", {
    quoteId: quote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });

  assert.equal(payment.status, "SUCCEEDED");
  assert.equal(system.listAccounts(user.id)[0]!.availableBalance.amountMinor, "9000000");
  assert.equal(system.getCreditAccount(user.id, account.creditAccountId).postedOutstanding.amountMinor, "3000000");
  const latest = system.getCreditStatement(user.id, account.creditAccountId, statement.statementId);
  assert.equal(latest.status, "PARTIALLY_PAID");
  assert.equal(latest.minimumPaymentRemaining.amountMinor, "0");
  assert.equal(latest.payments.length, 1);
  assert.equal(system.reconcileCredit()[0]?.differenceMinor, "0");
  const auditCount = system.auditEvents.length;
  const outboxCount = system.outboxEvents.length;
  const recoveredWithNewKey = system.submitCreditPayment(
    user.id,
    "credit-payment-key-b",
    { quoteId: quote.quoteId, stepUp: { method: "OTP", proof: "not-rechecked" } },
  );
  assert.equal(recoveredWithNewKey.paymentId, payment.paymentId);
  assert.equal(system.auditEvents.length, auditCount);
  assert.equal(system.outboxEvents.length, outboxCount);

  const corruptedState = system.exportState();
  corruptedState.creditPayments = (corruptedState.creditPayments ?? []).filter(
    ([paymentId]) => paymentId !== payment.paymentId,
  );
  const corruptedSystem = new BankingSystem({
    sandboxOtp: "123456",
    allowUnsafeDirectSandboxStepUp: true,
  });
  corruptedSystem.importState(corruptedState);
  assert.throws(
    () =>
      corruptedSystem.submitCreditPayment(user.id, "credit-recovery-key-c", {
        quoteId: quote.quoteId,
        stepUp: { method: "OTP", proof: "not-rechecked" },
      }),
    (error: unknown) =>
      (error as { status?: number; code?: string }).status === 409 &&
      (error as { code?: string }).code === "IDEMPOTENCY_STATE_MISSING",
  );

  const stateWithoutEphemeralQuote = system.exportState();
  stateWithoutEphemeralQuote.creditQuotes = [];
  system.importState(stateWithoutEphemeralQuote);
  const lateReplay = system.submitCreditPayment(user.id, "credit-payment-key-a", {
    quoteId: quote.quoteId,
    stepUp: { method: "OTP", proof: "proof-is-not-rechecked" },
  });
  assert.equal(lateReplay.paymentId, payment.paymentId);
});

test("credit payment cannot target a superseded statement or make outstanding negative", () => {
  const { system, advance } = createSystem();
  const user = register(system, "709");
  const source = system.listAccounts(user.id)[0]!;
  const account = system.listCreditAccounts(user.id)[0]!;
  const original = system.listCreditStatements(user.id, account.creditAccountId).items[0]!;

  advance(11 * 24 * 60 * 60 * 1000);
  system.runReferenceScheduledWork(user.id);
  const statements = system.listCreditStatements(user.id, account.creditAccountId).items;
  const current = statements[0]!;
  assert.notEqual(current.statementId, original.statementId);
  assert.throws(
    () =>
      system.createCreditPaymentQuote(user.id, {
        sourceAccountId: source.id,
        creditAccountId: account.creditAccountId,
        statementId: original.statementId,
        paymentOption: "FULL_STATEMENT",
      }),
    (error: unknown) => (error as { code?: string }).code === "STATEMENT_SUPERSEDED",
  );

  const quote = system.createCreditPaymentQuote(user.id, {
    sourceAccountId: source.id,
    creditAccountId: account.creditAccountId,
    statementId: current.statementId,
    paymentOption: "FULL_STATEMENT",
  });
  system.submitCreditPayment(user.id, "credit-rollover-payment", {
    quoteId: quote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });
  const paidAccount = system.getCreditAccount(user.id, account.creditAccountId);
  assert.equal(paidAccount.postedOutstanding.amountMinor, "0");
  assert.equal(paidAccount.availableCredit.amountMinor, paidAccount.creditLimit.amountMinor);
  assert.equal(system.reconcileCredit()[0]?.invariantValid, true);
});

test("paying the minimum before or after due date clears delinquency", () => {
  const { system } = createSystem({ creditOverdueSeed: true });
  const user = register(system, "710");
  const source = system.listAccounts(user.id)[0]!;
  const account = system.listCreditAccounts(user.id)[0]!;
  system.runReferenceScheduledWork(user.id);
  const statement = system.listCreditStatements(user.id, account.creditAccountId).items[0]!;
  assert.equal(statement.status, "OVERDUE");
  const quote = system.createCreditPaymentQuote(user.id, {
    sourceAccountId: source.id,
    creditAccountId: account.creditAccountId,
    statementId: statement.statementId,
    paymentOption: "MINIMUM",
  });
  system.submitCreditPayment(user.id, "credit-minimum-clears-delinquency", {
    quoteId: quote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });
  const updated = system.getCreditStatement(
    user.id,
    account.creditAccountId,
    statement.statementId,
  );
  assert.equal(updated.minimumPaymentRemaining.amountMinor, "0");
  assert.equal(updated.status, "PARTIALLY_PAID");
});

test("credit reversal preserves history and recomputes minimum allocation", () => {
  const { system } = createSystem();
  const user = register(system, "711");
  const source = system.listAccounts(user.id)[0]!;
  const account = system.listCreditAccounts(user.id)[0]!;
  const statement = system.listCreditStatements(user.id, account.creditAccountId).items[0]!;
  const pay = (key: string, amountMinor: string) => {
    const quote = system.createCreditPaymentQuote(user.id, {
      sourceAccountId: source.id,
      creditAccountId: account.creditAccountId,
      statementId: statement.statementId,
      paymentOption: "CUSTOM",
      amount: { currency: "VND", amountMinor },
    });
    return system.submitCreditPayment(user.id, key, {
      quoteId: quote.quoteId,
      stepUp: { method: "OTP", proof: "123456" },
    });
  };
  const first = pay("credit-allocation-a", "200000");
  pay("credit-allocation-b", "50000");
  system.reverseCreditPayment(user.id, first.paymentId);

  const updated = system.getCreditStatement(
    user.id,
    account.creditAccountId,
    statement.statementId,
  );
  assert.equal(updated.paidAmount.amountMinor, "50000");
  assert.equal(updated.minimumPaymentRemaining.amountMinor, "150000");
  assert.equal(updated.payments.length, 2);
  assert.equal(
    updated.payments.find((payment) => payment.paymentId === first.paymentId)?.status,
    "REVERSED",
  );
});

test("pending credit payment resumes without a second source debit", () => {
  const { system } = createSystem({ settleCreditPaymentsImmediately: false });
  const user = register(system, "703");
  const source = system.listAccounts(user.id)[0]!;
  const account = system.listCreditAccounts(user.id)[0]!;
  const statement = system.listCreditStatements(user.id, account.creditAccountId).items[0]!;
  const quote = system.createCreditPaymentQuote(user.id, {
    sourceAccountId: source.id,
    creditAccountId: account.creditAccountId,
    statementId: statement.statementId,
    paymentOption: "MINIMUM",
  });

  const pending = system.submitCreditPayment(user.id, "credit-pending-key", {
    quoteId: quote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });
  assert.equal(pending.status, "PENDING");
  assert.equal(system.listAccounts(user.id)[0]!.availableBalance.amountMinor, "9800000");
  const stateBeforeRead = system.exportState();
  const readOnly = system.getCreditPayment(user.id, pending.paymentId);
  assert.equal(readOnly.status, "PENDING");
  assert.deepEqual(system.exportState(), stateBeforeRead);
  const processing = system.runReferenceScheduledWork(user.id);
  assert.equal(processing.creditPaymentsSettled, 1);
  const resumed = system.getCreditPayment(user.id, pending.paymentId);
  assert.equal(resumed.status, "SUCCEEDED");
  assert.equal(system.listAccounts(user.id)[0]!.availableBalance.amountMinor, "9800000");
  assert.equal(system.listTransactions(user.id, source.id).items.length, 2);
  assert.equal(system.getCreditAccount(user.id, account.creditAccountId).postedOutstanding.amountMinor, "3800000");
});

test("pending payment settles before rollover and late reversal requires review", () => {
  const { system, advance } = createSystem({
    settleCreditPaymentsImmediately: false,
  });
  const user = register(system, "713");
  const source = system.listAccounts(user.id)[0]!;
  const account = system.listCreditAccounts(user.id)[0]!;
  const original = system.listCreditStatements(
    user.id,
    account.creditAccountId,
  ).items[0]!;
  const quote = system.createCreditPaymentQuote(user.id, {
    sourceAccountId: source.id,
    creditAccountId: account.creditAccountId,
    statementId: original.statementId,
    paymentOption: "CUSTOM",
    amount: { currency: "VND", amountMinor: "3000000" },
  });
  const pending = system.submitCreditPayment(user.id, "rollover-pending-key", {
    quoteId: quote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });
  assert.equal(pending.status, "PENDING");

  advance(11 * 24 * 60 * 60 * 1000);
  const processing = system.runReferenceScheduledWork(user.id);
  assert.equal(processing.creditPaymentsSettled, 1);
  assert.equal(processing.creditStatements, 1);
  const latest = system.listCreditStatements(
    user.id,
    account.creditAccountId,
  ).items[0]!;
  assert.equal(latest.remainingAmountDue.amountMinor, "1000000");
  assert.equal(
    system.getCreditAccount(user.id, account.creditAccountId).postedOutstanding
      .amountMinor,
    "1000000",
  );
  assert.equal(system.getHealth().status, "ok");

  assert.throws(
    () => system.reverseCreditPayment(user.id, pending.paymentId),
    (error: unknown) =>
      (error as { code?: string }).code === "REVERSAL_REQUIRES_REVIEW",
  );
  assert.equal(system.getHealth().status, "ok");
});

test("failed and reversed credit payments restore source and debt balances", () => {
  const { system } = createSystem({ settleCreditPaymentsImmediately: false });
  const user = register(system, "706");
  const source = system.listAccounts(user.id)[0]!;
  const account = system.listCreditAccounts(user.id)[0]!;
  const statement = system.listCreditStatements(user.id, account.creditAccountId).items[0]!;

  const failedQuote = system.createCreditPaymentQuote(user.id, {
    sourceAccountId: source.id,
    creditAccountId: account.creditAccountId,
    statementId: statement.statementId,
    paymentOption: "CUSTOM",
    amount: { currency: "VND", amountMinor: "1000000" },
  });
  const pending = system.submitCreditPayment(user.id, "credit-failed-key", {
    quoteId: failedQuote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });
  const failed = system.failCreditPayment(user.id, pending.paymentId);
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.failureReason, "SANDBOX_SETTLEMENT_FAILED");
  assert.equal(system.listAccounts(user.id)[0]!.availableBalance.amountMinor, "10000000");
  assert.equal(system.getCreditAccount(user.id, account.creditAccountId).postedOutstanding.amountMinor, "4000000");

  const reversedQuote = system.createCreditPaymentQuote(user.id, {
    sourceAccountId: source.id,
    creditAccountId: account.creditAccountId,
    statementId: statement.statementId,
    paymentOption: "CUSTOM",
    amount: { currency: "VND", amountMinor: "1000000" },
  });
  const succeeded = system.submitCreditPayment(user.id, "credit-reversed-key", {
    quoteId: reversedQuote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });
  assert.equal(system.getCreditPayment(user.id, succeeded.paymentId).status, "PENDING");
  assert.equal(system.settleCreditPayment(user.id, succeeded.paymentId).status, "SUCCEEDED");
  const reversed = system.reverseCreditPayment(user.id, succeeded.paymentId);
  assert.equal(reversed.status, "REVERSED");
  assert.equal(system.listAccounts(user.id)[0]!.availableBalance.amountMinor, "10000000");
  assert.equal(system.getCreditAccount(user.id, account.creditAccountId).postedOutstanding.amountMinor, "4000000");
  assert.equal(system.getCreditStatement(user.id, account.creditAccountId, statement.statementId).remainingAmountDue.amountMinor, "4000000");
  assert.equal(system.reconcileCredit()[0]?.differenceMinor, "0");
});

test("credit card lock is persistent in the exported state and unlock requires step-up", () => {
  const { system } = createSystem();
  const user = register(system, "704");
  const card = system.listCards(user.id)[0]!;
  assert.equal(system.lockCard(user.id, card.cardId).status, "LOCKED");
  assert.throws(() => system.unlockCard(user.id, card.cardId, { method: "OTP", proof: "000000" }), /Step-up challenge is invalid/);
  assert.equal(system.unlockCard(user.id, card.cardId, { method: "OTP", proof: "123456" }).status, "ACTIVE");
});

test("card unlock uses its own configured step-up policy", () => {
  const { system } = createSystem({
    creditPaymentStepUpMethods: ["OTP"],
    cardUnlockStepUpMethods: ["BIOMETRIC"],
  });
  const user = register(system, "707");
  const card = system.listCards(user.id)[0]!;
  assert.deepEqual(system.getControlPolicy(user.id).cardUnlockStepUpMethods, ["BIOMETRIC"]);
  system.lockCard(user.id, card.cardId);
  assert.throws(
    () => system.unlockCard(user.id, card.cardId, { method: "OTP", proof: "123456" }),
    /không được bật/,
  );
  assert.equal(
    system.unlockCard(user.id, card.cardId, { method: "BIOMETRIC", proof: "sandbox-biometric" }).status,
    "ACTIVE",
  );
});

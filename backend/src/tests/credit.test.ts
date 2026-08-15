import assert from "node:assert/strict";
import test from "node:test";

import { BankingSystem } from "../bankingSystem.js";
import { addMonthsClamped, calculateMinimumPayment, nextStatementCloseAt } from "../credit.js";

function createSystem(options: ConstructorParameters<typeof BankingSystem>[0] = {}) {
  let now = Date.parse("2026-08-14T00:00:00.000Z");
  const system = new BankingSystem({ ...options, clock: () => now, sandboxOtp: "123456" });
  return { system, advance: (milliseconds: number) => { now += milliseconds; } };
}

function register(system: BankingSystem, suffix: string) {
  return system.register({
    fullName: "Credit Sandbox User",
    email: `credit-${suffix}@example.com`,
    phoneNumber: `0912345${suffix.padStart(3, "0")}`,
    password: "Password1",
  }).user;
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
  const firstRun = system.listCreditStatements(user.id, account.creditAccountId).items;
  const secondRun = system.listCreditStatements(user.id, account.creditAccountId).items;
  assert.equal(firstRun.length, 2);
  assert.equal(secondRun.length, 2);
  assert.deepEqual(
    secondRun.map((statement) => statement.statementId),
    firstRun.map((statement) => statement.statementId),
  );
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
  assert.throws(
    () => system.submitCreditPayment(user.id, "credit-payment-key-b", { quoteId: quote.quoteId, stepUp: { method: "OTP", proof: "123456" } }),
    (error: unknown) => (error as { code?: string }).code === "QUOTE_ALREADY_USED",
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
  const resumed = system.getCreditPayment(user.id, pending.paymentId);
  assert.equal(resumed.status, "SUCCEEDED");
  assert.equal(system.listAccounts(user.id)[0]!.availableBalance.amountMinor, "9800000");
  assert.equal(system.listTransactions(user.id, source.id).items.length, 1);
  assert.equal(system.getCreditAccount(user.id, account.creditAccountId).postedOutstanding.amountMinor, "3800000");
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
  assert.equal(system.getCreditPayment(user.id, succeeded.paymentId).status, "SUCCEEDED");
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
  assert.throws(() => system.unlockCard(user.id, card.cardId, { method: "OTP", proof: "000000" }), /verification failed/);
  assert.equal(system.unlockCard(user.id, card.cardId, { method: "OTP", proof: "123456" }).status, "ACTIVE");
});

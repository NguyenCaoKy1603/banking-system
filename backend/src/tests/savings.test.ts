import assert from "node:assert/strict";
import test from "node:test";

import { BankingSystem } from "../bankingSystem.js";
import {
  addMonthsClamped,
  calculateSavingsInterest,
} from "../savings.js";

const SANDBOX_OPERATOR_KEY = "sandbox-operator-local";

function createSystem(options: ConstructorParameters<typeof BankingSystem>[0] = {}) {
  let now = Date.parse("2026-08-14T00:00:00.000Z");
  const system = new BankingSystem({
    sandboxOtp: "123456",
    ...options,
    clock: () => now,
  });
  return {
    system,
    advance(ms: number) {
      now += ms;
    },
  };
}

function register(system: BankingSystem, email = "savings@example.com") {
  const user = system.register({
    fullName: "Savings User",
    email,
    phoneNumber: `09${String(Math.floor(Math.random() * 1_000_000_00)).padStart(8, "0")}`,
    password: "Password1",
  }).user;
  const account = system.listAccounts(user.id)[0];
  assert.ok(account);
  const accountNumber = system.getAccountNumber(user.id, account.id);
  system.fundSandbox(SANDBOX_OPERATOR_KEY, `savings-funding-${email}`, {
    recipientAccountNumber: accountNumber,
    amount: { currency: "VND", amountMinor: "10000000" },
    reason: "test fixture funding",
  });
  return user;
}

test("savings interest uses actual days, floor and month-end clamping", () => {
  assert.equal(addMonthsClamped("2026-01-31T00:00:00.000Z", 1), "2026-02-28T00:00:00.000Z");
  assert.equal(calculateSavingsInterest(1_000_000n, 300, 31), 2_547n);
  assert.equal(calculateSavingsInterest(1_000_000n, 500, 365), 50_000n);
});

test("savings quote is server-authoritative, MFA-protected and idempotent", () => {
  const { system } = createSystem({ settleSavingsImmediately: false });
  const user = register(system);
  const account = system.listAccounts(user.id)[0];
  assert.ok(account);

  const quote = system.createSavingsQuote(user.id, {
    sourceAccountId: account.id,
    productId: "savings-vnd-1m",
    principal: { currency: "VND", amountMinor: "1000000" },
    maturityInstruction: "RETURN_PRINCIPAL_AND_INTEREST",
  });
  assert.equal(quote.annualRateBasisPoints, 300);
  assert.equal(quote.totalAtMaturity.amountMinor, "1002547");
  assert.equal("userId" in quote, false);
  assert.equal("fingerprint" in quote, false);

  const before = system.listAccounts(user.id)[0]?.availableBalance.amountMinor;
  assert.throws(
    () =>
      system.submitSavingsOpening(user.id, "savings-wrong-otp-key", {
        quoteId: quote.quoteId,
        stepUp: { method: "OTP", proof: "000000" },
      }),
    /verification failed/,
  );
  assert.equal(system.listAccounts(user.id)[0]?.availableBalance.amountMinor, before);

  const pending = system.submitSavingsOpening(user.id, "savings-idempotency-key-a", {
    quoteId: quote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });
  assert.equal(pending.status, "PENDING");
  const retry = system.submitSavingsOpening(user.id, "savings-idempotency-key-a", {
    quoteId: quote.quoteId,
    stepUp: { method: "OTP", proof: "different-proof-is-not-reused" },
  });
  assert.equal(retry.openingId, pending.openingId);
  assert.throws(
    () =>
      system.submitSavingsOpening(user.id, "savings-idempotency-key-b", {
        quoteId: quote.quoteId,
        stepUp: { method: "OTP", proof: "123456" },
      }),
    /already been submitted/,
  );

  const succeeded = system.getSavingsOpening(user.id, pending.openingId);
  assert.equal(succeeded.status, "SUCCEEDED");
  assert.ok(succeeded.depositId);
  assert.equal("userId" in succeeded, false);
  assert.equal("idempotencyKey" in succeeded, false);
  assert.equal(system.listAccounts(user.id)[0]?.availableBalance.amountMinor, "9000000");
  const deposits = system.listSavingsDeposits(user.id);
  assert.equal(deposits.items.length, 1);
  assert.equal("sourceAccountId" in deposits.items[0]!, false);
  assert.equal("openingId" in deposits.items[0]!, false);
  assert.equal(system.getHealth().status, "ok");
});

test("savings maturity returns funds once and renews with a new deposit when instructed", () => {
  const { system } = createSystem();
  const user = register(system, "renew@example.com");
  const account = system.listAccounts(user.id)[0];
  assert.ok(account);

  const quote = system.createSavingsQuote(user.id, {
    sourceAccountId: account.id,
    productId: "savings-vnd-3m",
    principal: { currency: "VND", amountMinor: "1000000" },
    maturityInstruction: "RENEW_PRINCIPAL",
  });
  const opening = system.submitSavingsOpening(user.id, "renew-idempotency-key", {
    quoteId: quote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });
  const succeeded = system.getSavingsOpening(user.id, opening.openingId);
  assert.ok(succeeded.depositId);

  const matured = system.simulateSavingsMaturity(user.id, succeeded.depositId!);
  assert.equal(matured.status, "CLOSED");
  assert.ok(matured.renewedDepositId);
  assert.equal(
    system.listNotifications(user.id).filter((item) => item.type === "SAVINGS").length,
    2,
  );
  assert.equal(
    system.outboxEvents.filter((item) => item.eventType === "SAVINGS_MATURED").length,
    1,
  );
  const deposits = system.listSavingsDeposits(user.id).items;
  const renewed = deposits.find((deposit) => deposit.depositId === matured.renewedDepositId);
  assert.equal(renewed?.status, "ACTIVE");
  assert.equal(system.listAccounts(user.id)[0]?.availableBalance.amountMinor, "9008821");

  const again = system.listSavingsDeposits(user.id).items;
  assert.equal(again.filter((deposit) => deposit.status === "ACTIVE").length, 1);
  system.simulateSavingsMaturity(user.id, succeeded.depositId!);
  assert.equal(
    system.outboxEvents.filter((item) => item.eventType === "SAVINGS_MATURED").length,
    1,
  );
  assert.equal(system.getHealth().reconciliation, "ok");
});

test("pending savings opening resumes from an exported snapshot without creating another debit", () => {
  const { system } = createSystem({ settleSavingsImmediately: false });
  const user = register(system, "snapshot-savings@example.com");
  const account = system.listAccounts(user.id)[0];
  assert.ok(account);
  const quote = system.createSavingsQuote(user.id, {
    sourceAccountId: account.id,
    productId: "savings-vnd-6m",
    principal: { currency: "VND", amountMinor: "1000000" },
    maturityInstruction: "RETURN_PRINCIPAL_AND_INTEREST",
  });
  const pending = system.submitSavingsOpening(user.id, "snapshot-idempotency-key", {
    quoteId: quote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });
  const restored = new BankingSystem({ sandboxOtp: "123456" });
  restored.importState(system.exportState());
  const resumed = restored.getSavingsOpening(user.id, pending.openingId);
  assert.equal(resumed.status, "SUCCEEDED");
  assert.equal(restored.listAccounts(user.id)[0]?.availableBalance.amountMinor, "9000000");
  assert.equal(restored.listSavingsDeposits(user.id).items.length, 1);
});

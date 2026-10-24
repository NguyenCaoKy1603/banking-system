import assert from "node:assert/strict";
import test from "node:test";

import { BankingSystem } from "../bankingSystem.js";
import {
  addMonthsClamped,
  calculateSavingsInterest,
} from "../domain/savings/index.js";


function createSystem(options: ConstructorParameters<typeof BankingSystem>[0] = {}) {
  let now = Date.parse("2026-08-14T00:00:00.000Z");
  const system = new BankingSystem({
    sandboxOtp: "123456",
    allowUnsafeDirectSandboxStepUp: true,
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
  system.seedReferenceFunding(`savings-funding-${email}`, {
    recipientAccountNumber: accountNumber,
    amount: { currency: "VND", amountMinor: "10000000" },
    reason: "test fixture funding",
  });
  return user;
}

test("savings interest uses actual days, floor and month-end clamping", () => {
  assert.equal(addMonthsClamped("2026-01-31T00:00:00.000Z", 1), "2026-02-28T00:00:00.000Z");
  assert.equal(
    addMonthsClamped("2026-02-28T18:00:00.000Z", 1),
    "2026-03-31T18:00:00.000Z",
  );
  assert.equal(
    addMonthsClamped("2026-03-31T17:00:00.000Z", 1),
    "2026-04-30T17:00:00.000Z",
  );
  assert.equal(calculateSavingsInterest(1_000_000n, 300, 31), 2_547n);
  assert.equal(calculateSavingsInterest(1_000_000n, 500, 365), 50_000n);
});

test("savings product and policy limits are compared numerically", () => {
  const { system } = createSystem({
    maxSavingsAmountMinor: "10000000",
    savingsProducts: [
      {
        productId: "numeric-limit-product",
        name: "Numeric limit",
        termMonths: 1,
        annualRateBasisPoints: 300,
        currency: "VND",
        minAmountMinor: "1000000",
        maxAmountMinor: "9000000",
        status: "ACTIVE",
        termsVersion: "test-v1",
      },
    ],
  });
  const user = register(system, "numeric-limit@example.com");
  const account = system.listAccounts(user.id)[0]!;
  assert.throws(
    () =>
      system.createSavingsQuote(user.id, {
        sourceAccountId: account.id,
        productId: "numeric-limit-product",
        principal: { currency: "VND", amountMinor: "9500000" },
        maturityInstruction: "RETURN_PRINCIPAL_AND_INTEREST",
      }),
    /outside the sandbox limit/,
  );

  assert.throws(
    () =>
      createSystem({
        savingsProducts: [
          {
            productId: "invalid-product",
            name: "Invalid",
            termMonths: 1,
            annualRateBasisPoints: -1,
            currency: "VND",
            minAmountMinor: "200",
            maxAmountMinor: "100",
            status: "ACTIVE",
            termsVersion: "test-v1",
          },
        ],
      }),
    /invalid terms/,
  );
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
    /Step-up challenge is invalid/,
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
  const auditCount = system.auditEvents.length;
  const outboxCount = system.outboxEvents.length;
  const recoveredWithNewKey = system.submitSavingsOpening(
    user.id,
    "savings-idempotency-key-b",
    {
      quoteId: quote.quoteId,
      stepUp: { method: "OTP", proof: "not-rechecked" },
    },
  );
  assert.equal(recoveredWithNewKey.openingId, pending.openingId);
  assert.equal(system.auditEvents.length, auditCount);
  assert.equal(system.outboxEvents.length, outboxCount);

  const differentQuote = system.createSavingsQuote(user.id, {
    sourceAccountId: account.id,
    productId: "savings-vnd-1m",
    principal: { currency: "VND", amountMinor: "2000000" },
    maturityInstruction: "RETURN_PRINCIPAL_AND_INTEREST",
  });
  assert.throws(
    () =>
      system.submitSavingsOpening(user.id, "savings-idempotency-key-a", {
        quoteId: differentQuote.quoteId,
        stepUp: { method: "OTP", proof: "123456" },
      }),
    (error: unknown) =>
      (error as { status?: number; code?: string }).status === 409 &&
      (error as { code?: string }).code === "IDEMPOTENCY_CONFLICT",
  );

  const corruptedState = system.exportState();
  corruptedState.savingsOpenings = (corruptedState.savingsOpenings ?? []).filter(
    ([openingId]) => openingId !== pending.openingId,
  );
  const corruptedSystem = new BankingSystem({
    sandboxOtp: "123456",
    allowUnsafeDirectSandboxStepUp: true,
    settleSavingsImmediately: false,
  });
  corruptedSystem.importState(corruptedState);
  assert.throws(
    () =>
      corruptedSystem.submitSavingsOpening(user.id, "savings-recovery-key-c", {
        quoteId: quote.quoteId,
        stepUp: { method: "OTP", proof: "not-rechecked" },
      }),
    (error: unknown) =>
      (error as { status?: number; code?: string }).status === 409 &&
      (error as { code?: string }).code === "IDEMPOTENCY_STATE_MISSING",
  );

  const stateBeforeRead = system.exportState();
  const readOnly = system.getSavingsOpening(user.id, pending.openingId);
  assert.equal(readOnly.status, "PENDING");
  assert.deepEqual(system.exportState(), stateBeforeRead);
  const succeeded = system.settleSavingsOpening(user.id, pending.openingId);
  assert.equal(succeeded.status, "SUCCEEDED");
  assert.ok(succeeded.depositId);
  assert.equal("userId" in succeeded, false);
  assert.equal("idempotencyKey" in succeeded, false);
  assert.equal(system.listAccounts(user.id)[0]?.availableBalance.amountMinor, "9000000");
  const deposits = system.listSavingsDeposits(user.id);
  assert.equal(deposits.items.length, 1);
  assert.equal("sourceAccountId" in deposits.items[0]!, false);
  assert.equal("openingId" in deposits.items[0]!, false);
  assert.equal(system.reconcileSavings()[0]?.differenceMinor, "0");
  assert.equal(system.reconcileSavings()[0]?.invariantValid, true);
  assert.equal(system.getHealth().status, "ok");

  const stateWithoutEphemeralQuote = system.exportState();
  stateWithoutEphemeralQuote.savingsQuotes = [];
  system.importState(stateWithoutEphemeralQuote);
  const lateReplay = system.submitSavingsOpening(
    user.id,
    "savings-idempotency-key-a",
    {
      quoteId: quote.quoteId,
      stepUp: { method: "OTP", proof: "proof-is-not-rechecked" },
    },
  );
  assert.equal(lateReplay.openingId, pending.openingId);
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
  assert.equal(
    system.reconcileSavings().every(
      (row) => row.differenceMinor === "0" && row.invariantValid,
    ),
    true,
  );

  const corruptedState = system.exportState();
  corruptedState.savingsDeposits = (corruptedState.savingsDeposits ?? []).filter(
    ([depositId]) => depositId !== matured.renewedDepositId,
  );
  const corrupted = new BankingSystem({ sandboxOtp: "123456" });
  corrupted.importState(corruptedState);
  const corruptedRows = corrupted.reconcileSavings();
  assert.equal(
    corruptedRows.find((row) => row.depositId === matured.renewedDepositId)?.status,
    "MISSING",
  );
  assert.equal(
    corruptedRows.find((row) => row.depositId === matured.renewedDepositId)?.invariantValid,
    false,
  );
  assert.equal(
    corruptedRows.find((row) => row.depositId === succeeded.depositId)?.invariantValid,
    false,
  );
  const corruptedHealth = corrupted.getHealth();
  assert.equal(corruptedHealth.status, "degraded");
  assert.equal(corruptedHealth.reconciliation, "mismatch");

  const orphanRenewalState = system.exportState();
  orphanRenewalState.savingsDeposits = (
    orphanRenewalState.savingsDeposits ?? []
  ).filter(([depositId]) => depositId !== succeeded.depositId);
  const orphanRenewal = new BankingSystem({ sandboxOtp: "123456" });
  orphanRenewal.importState(orphanRenewalState);
  assert.equal(
    orphanRenewal
      .reconcileSavings()
      .find((row) => row.depositId === matured.renewedDepositId)?.invariantValid,
    false,
  );

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
  const restored = new BankingSystem({
    sandboxOtp: "123456",
    allowUnsafeDirectSandboxStepUp: true,
  });
  restored.importState(system.exportState());
  const stateBeforeRead = restored.exportState();
  const readOnly = restored.getSavingsOpening(user.id, pending.openingId);
  assert.equal(readOnly.status, "PENDING");
  assert.deepEqual(restored.exportState(), stateBeforeRead);
  const processing = restored.runReferenceScheduledWork(user.id);
  assert.equal(processing.savingsOpeningsSettled, 1);
  const resumed = restored.getSavingsOpening(user.id, pending.openingId);
  assert.equal(resumed.status, "SUCCEEDED");
  assert.equal(restored.listAccounts(user.id)[0]?.availableBalance.amountMinor, "9000000");
  assert.equal(restored.listSavingsDeposits(user.id).items.length, 1);
});

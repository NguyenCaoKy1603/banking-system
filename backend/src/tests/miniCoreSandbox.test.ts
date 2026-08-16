import assert from "node:assert/strict";
import test from "node:test";

import { BankingSystem } from "../bankingSystem.js";
import { fingerprint } from "../security.js";

function register(system: BankingSystem, email: string, phoneNumber: string) {
  return system.register({
    fullName: email.split("@")[0] === "alice" ? "Nguyễn Văn A" : "Nguyễn Văn B",
    email: `${email}@example.com`,
    phoneNumber,
    password: "Password1",
  }).user;
}

function accountNumber(system: BankingSystem, userId: string): string {
  const account = system.listAccounts(userId)[0];
  assert.ok(account);
  return system.getAccountNumber(userId, account.id);
}

function prepareTransfer(system: BankingSystem, userId: string, recipientAccountNumber: string) {
  const account = system.listAccounts(userId)[0];
  assert.ok(account);
  const lookup = system.lookupInternalRecipient(userId, recipientAccountNumber);
  const quote = system.createQuote(userId, {
    sourceAccountId: account.id,
    lookupId: lookup.lookupId,
    amount: { currency: "VND", amountMinor: "2000000" },
  });
  return { account, quote };
}

test("new customers start clean and Sandbox Funding is idempotent", () => {
  const system = new BankingSystem({ sandboxOperatorKey: "operator-test", sandboxOtp: "123456" });
  const alice = register(system, "alice", "0900000001");
  const bob = register(system, "bob", "0900000002");
  const aliceAccount = system.listAccounts(alice.id)[0];
  assert.ok(aliceAccount);
  assert.equal(aliceAccount.currentBalance.amountMinor, "0");
  assert.equal(aliceAccount.availableBalance.amountMinor, "0");
  assert.equal(aliceAccount.heldAmount.amountMinor, "0");
  assert.deepEqual(system.listBeneficiaries(alice.id), []);
  assert.deepEqual(system.listSavingsDeposits(alice.id).items, []);
  assert.deepEqual(system.listCards(alice.id), []);

  const bobNumber = accountNumber(system, bob.id);
  const first = system.fundSandbox("operator-test", "funding-1", {
    recipientAccountNumber: bobNumber,
    amount: { currency: "VND", amountMinor: "10000000" },
    reason: "Cấp tiền kiểm thử",
  });
  const replay = system.fundSandbox("operator-test", "funding-1", {
    recipientAccountNumber: bobNumber,
    amount: { currency: "VND", amountMinor: "10000000" },
    reason: "Cấp tiền kiểm thử",
  });
  assert.equal(replay.fundingId, first.fundingId);
  assert.equal(system.listAccounts(bob.id)[0]?.currentBalance.amountMinor, "10000000");
  assert.equal(system.listTransactions(bob.id, system.listAccounts(bob.id)[0]!.id).items.length, 1);
});

test("internal transfer credits the real recipient and records both sides", () => {
  const system = new BankingSystem({ sandboxOperatorKey: "operator-test", sandboxOtp: "123456" });
  const alice = register(system, "alice-transfer", "0900000011");
  const bob = register(system, "bob-transfer", "0900000012");
  const aliceAccount = system.listAccounts(alice.id)[0]!;
  const bobAccount = system.listAccounts(bob.id)[0]!;
  system.fundSandbox("operator-test", "fund-transfer", {
    recipientAccountNumber: accountNumber(system, alice.id),
    amount: { currency: "VND", amountMinor: "10000000" },
    reason: "Cấp tiền kiểm thử",
  });

  const { quote } = prepareTransfer(system, alice.id, accountNumber(system, bob.id));
  const receipt = system.submitTransfer(alice.id, "transfer-1", {
    quoteId: quote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });
  assert.equal(receipt.status, "SUCCEEDED");
  assert.equal(system.listAccounts(alice.id)[0]?.currentBalance.amountMinor, "7999000");
  assert.equal(system.listAccounts(bob.id)[0]?.currentBalance.amountMinor, "2000000");
  assert.equal(system.core.getLedgerNetBalance(aliceAccount.id).toString(), "7999000");
  assert.equal(system.core.getLedgerNetBalance(bobAccount.id).toString(), "2000000");
  assert.equal(
    system.listTransactions(alice.id, aliceAccount.id).items.some(
      (item) => item.kind === "TRANSFER" && item.direction === "DEBIT",
    ),
    true,
  );
  assert.equal(
    system.listTransactions(bob.id, bobAccount.id).items.some(
      (item) => item.kind === "TRANSFER" && item.direction === "CREDIT",
    ),
    true,
  );
  assert.equal(system.listNotifications(alice.id).length, 2);
  assert.equal(system.listNotifications(bob.id).length, 1);
});

test("pending transfer holds funds, failure releases hold, and success can be reversed once", () => {
  const pendingSystem = new BankingSystem({
    sandboxOperatorKey: "operator-test",
    sandboxOtp: "123456",
    settleTransfersImmediately: false,
  });
  const alice = register(pendingSystem, "alice-pending", "0900000021");
  const bob = register(pendingSystem, "bob-pending", "0900000022");
  pendingSystem.fundSandbox("operator-test", "fund-pending", {
    recipientAccountNumber: accountNumber(pendingSystem, alice.id),
    amount: { currency: "VND", amountMinor: "10000000" },
    reason: "Cấp tiền kiểm thử",
  });
  const { account, quote } = prepareTransfer(
    pendingSystem,
    alice.id,
    accountNumber(pendingSystem, bob.id),
  );
  const pending = pendingSystem.submitTransfer(alice.id, "pending-1", {
    quoteId: quote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });
  assert.equal(pending.status, "PENDING");
  assert.equal(pendingSystem.listAccounts(alice.id)[0]?.currentBalance.amountMinor, "10000000");
  assert.equal(pendingSystem.listAccounts(alice.id)[0]?.availableBalance.amountMinor, "7999000");
  assert.equal(pendingSystem.listAccounts(alice.id)[0]?.heldAmount.amountMinor, "2001000");
  assert.equal(pendingSystem.listAccounts(bob.id)[0]?.currentBalance.amountMinor, "0");
  pendingSystem.failTransfer(alice.id, pending.transferId);
  assert.equal(pendingSystem.listAccounts(alice.id)[0]?.availableBalance.amountMinor, "10000000");
  assert.equal(pendingSystem.listAccounts(alice.id)[0]?.heldAmount.amountMinor, "0");

  const immediateSystem = new BankingSystem({ sandboxOperatorKey: "operator-test", sandboxOtp: "123456" });
  const sender = register(immediateSystem, "alice-reverse", "0900000031");
  const receiver = register(immediateSystem, "bob-reverse", "0900000032");
  immediateSystem.fundSandbox("operator-test", "fund-reverse", {
    recipientAccountNumber: accountNumber(immediateSystem, sender.id),
    amount: { currency: "VND", amountMinor: "10000000" },
    reason: "Cấp tiền kiểm thử",
  });
  const prepared = prepareTransfer(immediateSystem, sender.id, accountNumber(immediateSystem, receiver.id));
  const succeeded = immediateSystem.submitTransfer(sender.id, "reverse-1", {
    quoteId: prepared.quote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });
  const reversed = immediateSystem.reverseTransfer(sender.id, succeeded.transferId);
  assert.equal(reversed.status, "REVERSED");
  assert.equal(immediateSystem.listAccounts(sender.id)[0]?.currentBalance.amountMinor, "10000000");
  assert.equal(immediateSystem.listAccounts(receiver.id)[0]?.currentBalance.amountMinor, "0");
  const reversedAgain = immediateSystem.reverseTransfer(sender.id, succeeded.transferId);
  assert.equal(reversedAgain.status, "REVERSED");
  assert.equal(immediateSystem.listNotifications(receiver.id).length, 2);
});

test("sandbox OTP is dynamic, scoped and single-use", () => {
  const system = new BankingSystem({ sandboxOperatorKey: "operator-test" });
  const alice = register(system, "alice-otp", "0900000041");
  const bob = register(system, "bob-otp", "0900000042");
  const account = system.listAccounts(alice.id)[0]!;
  system.fundSandbox("operator-test", "fund-otp", {
    recipientAccountNumber: accountNumber(system, alice.id),
    amount: { currency: "VND", amountMinor: "10000000" },
    reason: "Cấp tiền kiểm thử",
  });
  const { quote } = prepareTransfer(system, alice.id, accountNumber(system, bob.id));
  const contextFingerprint = fingerprint({
    quoteId: quote.quoteId,
    amountMinor: quote.amount.amountMinor,
  });
  const challenge = system.createOtpChallenge(
    alice.id,
    "otp-device",
    "TRANSFER",
    quote.quoteId,
    contextFingerprint,
  );
  const otp = system.getSandboxOtp("operator-test", challenge.challengeId);
  const receipt = system.submitTransfer(
    alice.id,
    "otp-transfer-1",
    { quoteId: quote.quoteId, stepUp: { method: "OTP", proof: otp, challengeId: challenge.challengeId } },
    "otp-device",
  );
  assert.equal(receipt.status, "SUCCEEDED");
  assert.throws(() =>
    system.verifyLoginChallenge(challenge.challengeId, "OTP", otp, "otp-device"),
  );
  assert.equal(system.listAccounts(alice.id)[0]?.currentBalance.amountMinor, "7999000");
  assert.equal(account.id, system.listAccounts(alice.id)[0]?.id);
});

test("HTTP-style registration creates no account before OTP and only one after verification", async () => {
  const system = new BankingSystem({ sandboxOperatorKey: "operator-registration" });
  const challenge = await system.beginRegistrationAsync(
    {
      fullName: "Registration Candidate",
      email: "registration-candidate@example.com",
      phoneNumber: "0900000051",
      password: "Password1",
    },
    "registration-client",
    "registration-device",
  );
  assert.equal(system.listAccounts("not-created-yet").length, 0);
  const otp = system.getSandboxOtp("operator-registration", challenge.challengeId);
  const result = system.verifyRegistrationChallenge(
    challenge.challengeId,
    otp,
    "registration-device",
  );
  assert.equal(system.listAccounts(result.user.id).length, 1);
  assert.equal(system.listAccounts(result.user.id)[0]?.currentBalance.amountMinor, "0");
  assert.throws(() =>
    system.verifyRegistrationChallenge(challenge.challengeId, otp, "registration-device"),
  );
});

test("savings pending state holds funds without changing current balance", () => {
  const system = new BankingSystem({
    sandboxOperatorKey: "operator-savings",
    sandboxOtp: "123456",
    settleSavingsImmediately: false,
  });
  const user = register(system, "alice-savings-hold", "0900000061");
  const account = system.listAccounts(user.id)[0]!;
  system.fundSandbox("operator-savings", "fund-savings-hold", {
    recipientAccountNumber: accountNumber(system, user.id),
    amount: { currency: "VND", amountMinor: "10000000" },
    reason: "Cáº¥p tiá»n kiá»ƒm thá»­",
  });
  const product = system.listSavingsProducts(user.id)[0]!;
  const quote = system.createSavingsQuote(user.id, {
    sourceAccountId: account.id,
    productId: product.productId,
    principal: { currency: "VND", amountMinor: "1000000" },
    maturityInstruction: "RETURN_PRINCIPAL_AND_INTEREST",
  });
  const pending = system.submitSavingsOpening(user.id, "savings-hold-1", {
    quoteId: quote.quoteId,
    stepUp: { method: "OTP", proof: "123456" },
  });
  assert.equal(pending.status, "PENDING");
  assert.equal(system.listAccounts(user.id)[0]?.currentBalance.amountMinor, "10000000");
  assert.equal(system.listAccounts(user.id)[0]?.availableBalance.amountMinor, "9000000");
  assert.equal(system.listAccounts(user.id)[0]?.heldAmount.amountMinor, "1000000");
  assert.equal(system.reconcile().every((row) => row.differenceMinor === "0"), true);
  const resumed = system.getSavingsOpening(user.id, pending.openingId);
  assert.equal(resumed.status, "SUCCEEDED");
  assert.equal(system.listAccounts(user.id)[0]?.currentBalance.amountMinor, "9000000");
  assert.equal(system.listAccounts(user.id)[0]?.heldAmount.amountMinor, "0");
});

test("credit requires explicit application and activation", () => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const user = register(system, "alice-credit-application", "0900000071");
  assert.deepEqual(system.listCards(user.id), []);
  const application = system.submitCreditApplication(user.id, "credit-application-1", {
    requestedLimit: { currency: "VND", amountMinor: "20000000" },
    stepUp: { method: "OTP", proof: "123456" },
  });
  assert.equal(application.status, "PENDING_ACTIVATION");
  assert.deepEqual(system.listCards(user.id), []);
  const activated = system.activateCreditApplication(
    user.id,
    application.applicationId,
    "credit-activation-1",
    { stepUp: { method: "OTP", proof: "123456" } },
  );
  assert.equal(activated.status, "ACTIVE");
  assert.equal(system.listCards(user.id).length, 1);
  assert.equal(system.listCreditAccounts(user.id)[0]?.postedOutstanding.amountMinor, "0");
});

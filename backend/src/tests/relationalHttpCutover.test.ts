import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { BankingSystem } from "../bankingSystem.js";
import { createPersistentBankingServer } from "../http.js";
import { RelationalHttpBoundary } from "../database/relationalHttpBoundary.js";
import type { UnitOfWork } from "../database/unitOfWork.js";

const TEST_REGISTRATION_FINGERPRINT_KEY = Buffer.alloc(32, 0x42);

test("relational-v2 boundary requires every approved customer route group", () => {
  const unitOfWork = {} as UnitOfWork;
  const complete = new RelationalHttpBoundary(unitOfWork, "auth,registration,mfa,accounts,beneficiaries,transfers,savings,credit,recipients,notifications,fraud,kyc");
  assert.doesNotThrow(() => complete.assertRelationalV2Complete());
  const incomplete = new RelationalHttpBoundary(unitOfWork, "auth,mfa,accounts,beneficiaries,transfers,savings,credit");
  assert.throws(() => incomplete.assertRelationalV2Complete(), /cutover is incomplete/);
});

test("direct relational account route bypasses the legacy state boundary", async (t) => {
  let legacyBoundaryCalls = 0;
  const repository = {
    withState: async (): Promise<never> => {
      legacyBoundaryCalls += 1;
      throw new Error("legacy boundary must not run for direct route");
    },
  };
  const relationalHttp = {
    isRouteEnabled: (method: string | undefined, segments: readonly string[]) => method === "GET" && segments.length === 1 && segments[0] === "accounts",
    authenticate: async () => ({ id: "customer-1" }),
    listAccounts: async () => [],
  } as unknown as RelationalHttpBoundary;
  const server = createPersistentBankingServer(repository, new BankingSystem(), { relationalHttp, registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/accounts`, {
    headers: {
      Authorization: "Bearer direct-test-token",
      "X-Device-ID": "direct-test-device",
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accounts: [] });
  assert.equal(legacyBoundaryCalls, 0);
});

test("direct relational control-policy route bypasses legacy state and returns the durable policy", async (t) => {
  let legacyBoundaryCalls = 0;
  const repository = {
    withState: async (): Promise<never> => {
      legacyBoundaryCalls += 1;
      throw new Error("legacy boundary must not run for control policy");
    },
  };
  const controlPolicy = {
    configVersion: "m7-sandbox-1",
    globalKillSwitch: false,
    transfersEnabled: true,
    allowlisted: true,
    maxTransferAmountMinor: "5000000",
    stepUpMethods: ["TOTP"],
    savingsEnabled: true,
    savingsAllowlisted: true,
    maxSavingsAmountMinor: "500000000",
    savingsStepUpMethods: ["TOTP"],
    creditEnabled: true,
    creditAllowlisted: true,
    creditPaymentsEnabled: true,
    cardControlsEnabled: true,
    maxCreditPaymentAmountMinor: "20000000",
    creditPaymentStepUpMethods: ["TOTP"],
    cardUnlockStepUpMethods: ["TOTP"],
    updatedAt: new Date().toISOString(),
  };
  const relationalHttp = {
    isRouteEnabled: (method: string | undefined, segments: readonly string[]) =>
      method === "GET" && segments.join("/") === "mobile/control-policy",
    authenticate: async () => ({ id: "customer-1" }),
    getControlPolicy: async () => controlPolicy,
  } as unknown as RelationalHttpBoundary;
  const server = createPersistentBankingServer(repository, new BankingSystem(), { relationalHttp, registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/mobile/control-policy`, {
    headers: {
      Authorization: "Bearer direct-test-token",
      "X-Device-ID": "direct-test-device",
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), controlPolicy);
  assert.equal(legacyBoundaryCalls, 0);
});

test("direct relational command routes bypass the legacy state boundary", async (t) => {
  let legacyBoundaryCalls = 0;
  const repository = {
    withState: async (): Promise<never> => {
      legacyBoundaryCalls += 1;
      throw new Error("legacy boundary must not run for direct command route");
    },
  };
  const relationalHttp = {
    isRouteEnabled: (method: string | undefined, segments: readonly string[]) =>
      method === "POST" && segments.length === 2 && segments[0] === "transfers" && segments[1] === "quote",
    authenticate: async () => ({ id: "customer-1" }),
    createTransferQuote: async () => ({
      quoteId: "quote-1",
      sourceAccountId: "account-1",
      beneficiary: { id: "beneficiary-1", displayName: "Recipient", maskedAccountNumber: "•••• 1234", bankName: "Reference", status: "ACTIVE" },
      amount: { currency: "VND", amountMinor: "100000" },
      fee: { currency: "VND", amountMinor: "1000" },
      totalDebit: { currency: "VND", amountMinor: "101000" },
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }),
  } as unknown as RelationalHttpBoundary;
  const server = createPersistentBankingServer(repository, new BankingSystem(), { relationalHttp, registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/transfers/quote`, {
    method: "POST",
    headers: {
      Authorization: "Bearer direct-test-token",
      "X-Device-ID": "direct-test-device",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sourceAccountId: "account-1", beneficiaryId: "beneficiary-1", amount: { currency: "VND", amountMinor: "100000" } }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { quoteId: string }).quoteId, "quote-1");
  assert.equal(legacyBoundaryCalls, 0);
});

test("relational-v2 rejects an uncategorized route without invoking withState", async (t) => {
  const previousMode = process.env.BANKING_PERSISTENCE_MODE;
  process.env.BANKING_PERSISTENCE_MODE = "relational-v2";
  t.after(() => {
    if (previousMode === undefined) delete process.env.BANKING_PERSISTENCE_MODE;
    else process.env.BANKING_PERSISTENCE_MODE = previousMode;
  });
  let legacyBoundaryCalls = 0;
  const repository = {
    withState: async (): Promise<never> => {
      legacyBoundaryCalls += 1;
      throw new Error("legacy boundary must not run in relational-v2");
    },
  };
  const relationalHttp = {
    isRouteEnabled: () => false,
  } as unknown as RelationalHttpBoundary;
  const server = createPersistentBankingServer(repository, new BankingSystem(), { relationalHttp, registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/profile`, {
    headers: { Authorization: "Bearer blocked-route-token", "X-Device-ID": "blocked-route-device" },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json() as { code: string }).code, "RELATIONAL_ROUTE_NOT_CUTOVER");
  assert.equal(legacyBoundaryCalls, 0);
});

test("persistent MFA lifecycle routes bypass the legacy state boundary", async (t) => {
  let legacyBoundaryCalls = 0;
  const relationalCalls: string[] = [];
  const repository = {
    withState: async (): Promise<never> => {
      legacyBoundaryCalls += 1;
      throw new Error("legacy MFA boundary must not run for direct route");
    },
  };
  const relationalHttp = {
    isRouteEnabled: (method: string | undefined, segments: readonly string[]) =>
      method === "GET" && segments.join("/") === "auth/mfa/methods" ||
      method === "POST" && segments.join("/") === "auth/mfa/totp/enroll",
    authenticate: async () => {
      relationalCalls.push("authenticate");
      return { id: "customer-1", fullName: "MFA User", email: "mfa@example.test", phoneNumber: "0900000000", createdAt: new Date().toISOString() };
    },
    verifyCurrentPassword: async () => {
      relationalCalls.push("verifyCurrentPassword");
      return true;
    },
    getUser: async () => {
      relationalCalls.push("getUser");
      return { id: "customer-1", fullName: "MFA User", email: "mfa@example.test", phoneNumber: "0900000000", createdAt: new Date().toISOString() };
    },
    listCredentials: async () => [],
  } as unknown as RelationalHttpBoundary;
  const mfaService = {
    listCredentials: async () => [],
    beginTotpEnrollment: async () => ({
      credentialId: "credential-1",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      manualSetupKey: "TEST-ONLY-SETUP-KEY",
      otpauthUri: "otpauth://totp/Reference:mfa@example.test?secret=TEST",
    }),
  } as never;
  const server = createPersistentBankingServer(repository, new BankingSystem(), { relationalHttp, mfaService, registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const headers = {
    Authorization: "Bearer direct-mfa-token",
    "X-Device-ID": "direct-mfa-device",
  };
  const methods = await fetch(`http://127.0.0.1:${address.port}/api/v1/auth/mfa/methods`, { headers });
  assert.equal(methods.status, 200);
  assert.deepEqual(await methods.json(), { items: [] });
  const enroll = await fetch(`http://127.0.0.1:${address.port}/api/v1/auth/mfa/totp/enroll`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ password: "Password1" }),
  });
  assert.equal(enroll.status, 201);
  assert.equal((await enroll.json() as { credentialId: string }).credentialId, "credential-1");
  assert.equal(legacyBoundaryCalls, 0);
  assert.ok(relationalCalls.includes("authenticate"));
  assert.ok(relationalCalls.includes("verifyCurrentPassword"));
  assert.ok(relationalCalls.includes("getUser"));
});

test("direct card controls keep emergency lock separate from purpose-bound TOTP actions", async (t) => {
  let legacyBoundaryCalls = 0;
  const cardCalls: string[] = [];
  const verificationCalls: Array<Record<string, unknown>> = [];
  const repository = {
    withState: async (): Promise<never> => {
      legacyBoundaryCalls += 1;
      throw new Error("legacy card boundary must not run for direct route");
    },
  };
  const card = {
    cardId: "card-1",
    status: "LOCKED",
  };
  const relationalHttp = {
    isRouteEnabled: (method: string | undefined, segments: readonly string[]) =>
      method === "POST" && segments.length === 3 && segments[0] === "cards",
    authenticate: async () => ({ id: "customer-1" }),
    lockCard: async () => {
      cardCalls.push("lock");
      return card;
    },
    unlockCard: async () => {
      cardCalls.push("unlock");
      return { ...card, status: "ACTIVE" };
    },
    reportCardLost: async () => {
      cardCalls.push("report-lost");
      return { caseId: "case-1", caseStatus: "OPEN", card: { ...card, status: "BLOCKED" } };
    },
  } as unknown as RelationalHttpBoundary;
  const mfaService = {
    verifyChallenge: async (input: Record<string, unknown>) => {
      verificationCalls.push(input);
      return { customerId: "customer-1" };
    },
  } as never;
  const server = createPersistentBankingServer(repository, new BankingSystem(), {
    relationalHttp,
    mfaService,
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1/cards/card-1`;
  const headers = {
    Authorization: "Bearer direct-card-token",
    "X-Device-ID": "direct-card-device",
    "Content-Type": "application/json",
  };
  const locked = await fetch(`${baseUrl}/lock`, { method: "POST", headers });
  assert.equal(locked.status, 200);
  assert.equal(verificationCalls.length, 0);

  const unlocked = await fetch(`${baseUrl}/unlock`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      stepUp: { method: "TOTP", challengeId: "unlock-challenge", proof: "opaque-unlock-proof" },
    }),
  });
  assert.equal(unlocked.status, 200);
  assert.equal(verificationCalls[0]?.purpose, "CARD_UNLOCK");
  assert.equal(verificationCalls[0]?.resourceId, "card-1");

  const reported = await fetch(`${baseUrl}/report-lost`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      stepUp: { method: "TOTP", challengeId: "lost-challenge", proof: "opaque-lost-proof" },
    }),
  });
  assert.equal(reported.status, 200);
  assert.equal((await reported.json() as { caseId: string }).caseId, "case-1");
  assert.equal(verificationCalls[1]?.purpose, "CARD_REPORT_LOST");
  assert.equal(verificationCalls[1]?.resourceId, "card-1");
  assert.deepEqual(cardCalls, ["lock", "unlock", "report-lost"]);
  assert.equal(legacyBoundaryCalls, 0);
});

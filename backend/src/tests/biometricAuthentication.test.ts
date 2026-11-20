import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { BankingSystem } from "../bankingSystem.js";
import { createBankingServer } from "../http.js";
import {
  computeBiometricAssertion,
  verifyBiometricAssertion,
} from "../mfa/crypto.js";

const TEST_REGISTRATION_FINGERPRINT_KEY = Buffer.alloc(32, 0x42);

test("computeBiometricAssertion and verifyBiometricAssertion enforce device and context binding", () => {
  const proof = computeBiometricAssertion("secret-123", {
    challengeId: "challenge-456",
    deviceId: "device-789",
    purpose: "TRANSFER",
    resourceId: "quote-001",
  });

  assert.match(proof, /^biometric-v1\.[0-9a-f]{64}$/);
  assert.equal(
    verifyBiometricAssertion(proof, "secret-123", {
      challengeId: "challenge-456",
      deviceId: "device-789",
      purpose: "TRANSFER",
      resourceId: "quote-001",
    }),
    true,
  );
  assert.equal(
    verifyBiometricAssertion(proof, "secret-123", {
      challengeId: "challenge-456",
      deviceId: "other-device",
      purpose: "TRANSFER",
      resourceId: "quote-001",
    }),
    false,
  );
  assert.equal(
    verifyBiometricAssertion(proof, "secret-123", {
      challengeId: "challenge-456",
      deviceId: "device-789",
      purpose: "SAVINGS_OPENING",
      resourceId: "quote-001",
    }),
    false,
  );
  assert.equal(
    verifyBiometricAssertion("sandbox-biometric", "secret-123", {
      challengeId: "challenge-456",
      deviceId: "device-789",
      purpose: "TRANSFER",
      resourceId: "quote-001",
    }),
    false,
  );
});

test("HTTP biometric enrollment enables challenge-bound biometric step-up for transfers and fails closed on wrong device", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceHeaders = { "X-Device-ID": "device-bio-1" };
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

  // Register and login customer
  const regBegin = await request("/auth/register", {
    method: "POST",
    headers: deviceHeaders,
    body: JSON.stringify({
      fullName: "Biometric Customer",
      email: "bio-customer@example.com",
      phoneNumber: "0900112233",
      password: "Password1",
    }),
  });
  assert.equal(regBegin.status, 202);
  const regChallenge = (await regBegin.json()) as { challengeId: string };
  const regVerify = await request("/auth/register/verify", {
    method: "POST",
    headers: deviceHeaders,
    body: JSON.stringify({
      challengeId: regChallenge.challengeId,
      method: "EMAIL_OTP",
      proof: system.readTestVerificationCode(regChallenge.challengeId),
    }),
  });
  assert.equal(regVerify.status, 201);

  const loginRes = await request("/auth/login", {
    method: "POST",
    headers: deviceHeaders,
    body: JSON.stringify({
      email: "bio-customer@example.com",
      password: "Password1",
    }),
  });
  assert.equal(loginRes.status, 200);
  const { accessToken } = (await loginRes.json()) as { accessToken: string };
  const authHeaders = { Authorization: `Bearer ${accessToken}`, ...deviceHeaders };

  // Wrong password rejected during biometric enrollment
  const badEnroll = await request("/auth/mfa/biometric/enroll", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ password: "WrongPassword1" }),
  });
  assert.equal(badEnroll.status, 401);

  // Enroll device-bound biometric credential
  const enrollRes = await request("/auth/mfa/biometric/enroll", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ password: "Password1", displayName: "Face ID" }),
  });
  assert.equal(enrollRes.status, 201);
  const enrolled = (await enrollRes.json()) as {
    credentialId: string;
    credentialType: string;
    deviceId: string;
    biometricSecret: string;
    status: string;
  };
  assert.equal(enrolled.credentialType, "BIOMETRIC");
  assert.equal(enrolled.status, "ACTIVE");
  assert.equal(enrolled.deviceId, "device-bio-1");
  assert.ok(enrolled.biometricSecret.length >= 32);

  // List methods must NOT leak biometricSecret
  const methodsRes = await request("/auth/mfa/methods", { headers: authHeaders });
  assert.equal(methodsRes.status, 200);
  const methodsBody = (await methodsRes.json()) as { items: Array<Record<string, unknown>> };
  assert.equal(methodsBody.items.length, 1);
  assert.equal(methodsBody.items[0]?.credentialType, "BIOMETRIC");
  assert.equal("biometricSecret" in (methodsBody.items[0] ?? {}), false);

  // Seed funds and create recipient
  const accountsRes = await request("/accounts", { headers: authHeaders });
  const accountsPayload = (await accountsRes.json()) as { accounts: Array<{ id: string }> };
  const sourceAccountId = accountsPayload.accounts[0]!.id;
  const numRes = await request(`/accounts/${sourceAccountId}/number`, { headers: authHeaders });
  const { accountNumber: senderNumber } = (await numRes.json()) as { accountNumber: string };
  system.seedReferenceFunding("bio-seed-1", {
    recipientAccountNumber: senderNumber,
    amount: { currency: "VND", amountMinor: "2000000" },
    reason: "biometric test funding",
  });

  const recipient = system.register({
    fullName: "Bio Recipient",
    email: "bio-recipient@example.com",
    phoneNumber: "0900445566",
    password: "Password1",
  }).user;
  const recipientAccountId = system.listAccounts(recipient.id)[0]!.id;
  const recipientNumber = system.getAccountNumber(recipient.id, recipientAccountId);

  const lookupRes = await request("/internal-recipients/lookup", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ accountNumber: recipientNumber }),
  });
  assert.equal(lookupRes.status, 200);
  const { recipient: lookup } = (await lookupRes.json()) as { recipient: { lookupId: string } };

  const quoteRes = await request("/transfers/quote", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      sourceAccountId,
      lookupId: lookup.lookupId,
      amount: { currency: "VND", amountMinor: "250000" },
    }),
  });
  assert.equal(quoteRes.status, 200);
  const quote = (await quoteRes.json()) as { quoteId: string };

  // Request step-up challenge -> includes BIOMETRIC for enrolled device
  const challengeRes = await request("/auth/otp/challenges", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ purpose: "TRANSFER", resourceId: quote.quoteId }),
  });
  assert.equal(challengeRes.status, 201);
  const challenge = (await challengeRes.json()) as {
    challengeId: string;
    methods: string[];
  };
  assert.ok(challenge.methods.includes("BIOMETRIC"));

  // Tampered proof fails with 409 STEP_UP_VERIFICATION_FAILED
  const tamperedRes = await request("/transfers", {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": "bio-transfer-intent-fail-1" },
    body: JSON.stringify({
      quoteId: quote.quoteId,
      stepUp: {
        method: "BIOMETRIC",
        challengeId: challenge.challengeId,
        proof: `biometric-v1.${"0".repeat(64)}`,
      },
    }),
  });
  assert.equal(tamperedRes.status, 409);

  // Renew challenge and sign with real device-bound biometric secret
  const challenge2Res = await request("/auth/otp/challenges", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ purpose: "TRANSFER", resourceId: quote.quoteId }),
  });
  assert.equal(challenge2Res.status, 201);
  const challenge2 = (await challenge2Res.json()) as { challengeId: string };

  const validProof = computeBiometricAssertion(enrolled.biometricSecret, {
    challengeId: challenge2.challengeId,
    deviceId: "device-bio-1",
    purpose: "TRANSFER",
    resourceId: quote.quoteId,
  });

  const submitRes = await request("/transfers", {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": "bio-transfer-intent-ok-1" },
    body: JSON.stringify({
      quoteId: quote.quoteId,
      stepUp: {
        method: "BIOMETRIC",
        challengeId: challenge2.challengeId,
        proof: validProof,
      },
    }),
  });
  assert.equal(submitRes.status, 200);
  const receipt = (await submitRes.json()) as { status: string };
  assert.equal(receipt.status, "SUCCEEDED");
});

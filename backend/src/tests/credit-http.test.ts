import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { BankingSystem } from "../bankingSystem.js";
import { createBankingServer } from "../http.js";

const TEST_REGISTRATION_FINGERPRINT_KEY = Buffer.alloc(32, 0x42);

async function completeRegistration(
  system: BankingSystem,
  request: (path: string, init?: RequestInit) => Promise<Response>,
  deviceId: string,
): Promise<{ user: { id: string } }> {
  const begin = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Credit HTTP User",
      email: "credit-http@example.com",
      phoneNumber: "0900000091",
      password: "Password1",
    }),
  });
  assert.equal(begin.status, 202);
  const challenge = (await begin.json()) as { challengeId: string };
  const otp = { otp: system.readTestVerificationCode(challenge.challengeId) };
  const verified = await request("/auth/register/verify", {
    method: "POST",
    body: JSON.stringify({ challengeId: challenge.challengeId, method: "EMAIL_OTP", proof: otp.otp }),
  });
  assert.equal(verified.status, 201);
  return (await verified.json()) as { user: { id: string } };
}

test("HTTP credit sandbox exposes card, statement and idempotent payment flow", async (t) => {
  const system = new BankingSystem({
    sandboxOtp: "123456",
    allowUnsafeDirectSandboxStepUp: true,
  });
  const server = createBankingServer(system, { registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "credit-http-device";
  const request = (path: string, init: RequestInit = {}) => fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Device-ID": deviceId, ...(init.headers ?? {}) },
  });
  const body = (value: unknown) => JSON.stringify(value);

  const registered = await completeRegistration(system, request, deviceId);
  const removedFixtureRoute = await request("/sandbox/process-scheduled", { method: "POST", body: body({ userId: registered.user.id }) });
  assert.equal(removedFixtureRoute.status, 404);
  system.seedReferenceCredit(registered.user.id);
  const login = await request("/auth/login", {
    method: "POST",
    body: body({ email: "credit-http@example.com", password: "Password1" }),
  });
  const session = (await login.json()) as { accessToken: string };
  const authHeaders = { Authorization: `Bearer ${session.accessToken}`, "X-Device-ID": deviceId };
  const authRequest = (path: string, init: RequestInit = {}) => request(path, { ...init, headers: { ...authHeaders, ...(init.headers ?? {}) } });

  const cardsResponse = await authRequest("/cards");
  assert.equal(cardsResponse.status, 200);
  const cards = (await cardsResponse.json()) as { items: Array<{ cardId: string; creditAccountId: string }> };
  assert.equal(cards.items.length, 1);
  const card = cards.items[0]!;

  const lockResponse = await authRequest(`/cards/${card.cardId}/lock`, {
    method: "POST",
    body: body({}),
  });
  assert.equal(lockResponse.status, 200);
  assert.equal((await lockResponse.json() as { card: { status: string } }).card.status, "LOCKED");

  const rejectedUnlock = await authRequest(`/cards/${card.cardId}/unlock`, {
    method: "POST",
    body: body({ method: "OTP", proof: "000000" }),
  });
  assert.equal(rejectedUnlock.status, 409);
  assert.equal(
    ((await rejectedUnlock.json()) as { code: string }).code,
    "STEP_UP_VERIFICATION_FAILED",
  );

  const unlockResponse = await authRequest(`/cards/${card.cardId}/unlock`, {
    method: "POST",
    body: body({ method: "OTP", proof: "123456" }),
  });
  assert.equal(unlockResponse.status, 200);
  assert.equal((await unlockResponse.json() as { card: { status: string } }).card.status, "ACTIVE");

  const accountsResponse = await authRequest("/accounts");
  const accounts = (await accountsResponse.json()) as { accounts: Array<{ id: string }> };
  system.seedReferenceFunding("credit-http-funding", {
    recipientAccountNumber: system.getAccountNumber(registered.user.id, accounts.accounts[0]!.id),
    amount: { currency: "VND", amountMinor: "10000000" },
    reason: "test fixture funding",
  });
  const statementsResponse = await authRequest(`/credit/accounts/${card.creditAccountId}/statements`);
  const statements = (await statementsResponse.json()) as { items: Array<{ statementId: string; minimumPaymentRemaining: { amountMinor: string } }> };
  const statement = statements.items[0]!;
  assert.equal(statement.minimumPaymentRemaining.amountMinor, "200000");

  const quoteResponse = await authRequest("/credit/payment-quotes", {
    method: "POST",
    body: body({ sourceAccountId: accounts.accounts[0]!.id, creditAccountId: card.creditAccountId, statementId: statement.statementId, paymentOption: "MINIMUM" }),
  });
  assert.equal(quoteResponse.status, 200);
  const quote = (await quoteResponse.json()) as { quoteId: string; amount: { amountMinor: string } };
  assert.equal(quote.amount.amountMinor, "200000");

  const shortKeyResponse = await authRequest("/credit/payments", {
    method: "POST",
    headers: { "Idempotency-Key": "short" },
    body: body({ quoteId: quote.quoteId, stepUp: { method: "OTP", proof: "123456" } }),
  });
  assert.equal(shortKeyResponse.status, 422);

  const rejectedPaymentStepUp = await authRequest("/credit/payments", {
    method: "POST",
    headers: { "Idempotency-Key": "credit-http-invalid-stepup" },
    body: body({ quoteId: quote.quoteId, stepUp: { method: "OTP", proof: "000000" } }),
  });
  assert.equal(rejectedPaymentStepUp.status, 409);
  assert.equal(
    ((await rejectedPaymentStepUp.json()) as { code: string }).code,
    "STEP_UP_VERIFICATION_FAILED",
  );

  const submit = await authRequest("/credit/payments", {
    method: "POST",
    headers: { "Idempotency-Key": "credit-http-payment-1" },
    body: body({ quoteId: quote.quoteId, stepUp: { method: "OTP", proof: "123456" } }),
  });
  assert.equal(submit.status, 200);
  const payment = (await submit.json()) as { paymentId: string; status: string };
  assert.equal(payment.status, "SUCCEEDED");

  const retry = await authRequest("/credit/payments", {
    method: "POST",
    headers: { "Idempotency-Key": "credit-http-payment-1" },
    body: body({ quoteId: quote.quoteId, stepUp: { method: "OTP", proof: "123456" } }),
  });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json() as { paymentId: string }).paymentId, payment.paymentId);
});

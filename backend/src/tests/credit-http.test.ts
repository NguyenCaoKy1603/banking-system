import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { BankingSystem } from "../bankingSystem.js";
import { createBankingServer } from "../http.js";

const SANDBOX_OPERATOR_KEY = "sandbox-operator-local";

async function completeRegistration(
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
  const otpResponse = await request(`/sandbox/otp/${challenge.challengeId}`, {
    headers: { "X-Sandbox-Operator-Key": SANDBOX_OPERATOR_KEY },
  });
  const otp = (await otpResponse.json()) as { otp: string };
  const verified = await request("/auth/register/verify", {
    method: "POST",
    body: JSON.stringify({ challengeId: challenge.challengeId, proof: otp.otp }),
  });
  assert.equal(verified.status, 201);
  return (await verified.json()) as { user: { id: string } };
}

test("HTTP credit sandbox exposes card, statement and idempotent payment flow", async (t) => {
  const system = new BankingSystem({
    sandboxOtp: "123456",
    allowUnsafeDirectSandboxStepUp: true,
  });
  const server = createBankingServer(system);
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

  const registered = await completeRegistration(request, deviceId);
  const unauthorizedProcessor = await request("/sandbox/process-scheduled", {
    method: "POST",
    body: body({ userId: registered.user.id }),
  });
  assert.equal(unauthorizedProcessor.status, 401);
  const invalidProcessor = await request("/sandbox/process-scheduled", {
    method: "POST",
    headers: { "X-Sandbox-Operator-Key": SANDBOX_OPERATOR_KEY },
    body: body({ userId: 42 }),
  });
  assert.equal(invalidProcessor.status, 422);
  const processor = await request("/sandbox/process-scheduled", {
    method: "POST",
    headers: { "X-Sandbox-Operator-Key": SANDBOX_OPERATOR_KEY },
    body: body({ userId: registered.user.id }),
  });
  assert.equal(processor.status, 200);
  assert.equal(
    (await processor.json() as { usersProcessed: number }).usersProcessed,
    1,
  );
  system.seedCreditSandbox(SANDBOX_OPERATOR_KEY, registered.user.id);
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
  system.fundSandbox(SANDBOX_OPERATOR_KEY, "credit-http-funding", {
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

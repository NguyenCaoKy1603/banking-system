import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { BankingSystem } from "../bankingSystem.js";
import { createBankingServer } from "../http.js";

const TEST_REGISTRATION_FINGERPRINT_KEY = Buffer.alloc(32, 0x42);

async function completeRegistration(
  system: BankingSystem,
  request: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<{ user: { id: string } }> {
  const begin = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Savings HTTP User",
      email: "savings-http@example.com",
      phoneNumber: "0900001010",
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

test("HTTP savings flow exposes quote, MFA/idempotency opening and deposit detail", async (t) => {
  const system = new BankingSystem({
    sandboxOtp: "123456",
    allowUnsafeDirectSandboxStepUp: true,
  });
  const server = createBankingServer(system, { registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceHeaders = { "X-Device-ID": "savings-http-device" };
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...deviceHeaders, ...(init.headers ?? {}) },
    });
  const json = (value: unknown) => JSON.stringify(value);

  const registered = await completeRegistration(system, request);
  const loginResponse = await request("/auth/login", {
    method: "POST",
    body: json({ email: "savings-http@example.com", password: "Password1" }),
  });
  const login = (await loginResponse.json()) as { accessToken: string };
  const authHeaders = { Authorization: `Bearer ${login.accessToken}` };

  const accountsResponse = await request("/accounts", { headers: authHeaders });
  const accounts = (await accountsResponse.json()) as { accounts: Array<{ id: string }> };
  const accountId = accounts.accounts[0]?.id;
  assert.ok(accountId);
  system.seedReferenceFunding("savings-http-funding", {
    recipientAccountNumber: system.getAccountNumber(registered.user.id, accountId),
    amount: { currency: "VND", amountMinor: "10000000" },
    reason: "test fixture funding",
  });

  const productsResponse = await request("/savings/products", { headers: authHeaders });
  assert.equal(productsResponse.status, 200);
  const products = (await productsResponse.json()) as { items: Array<{ productId: string }> };
  assert.equal(products.items.length, 4);

  const quoteResponse = await request("/savings/quotes", {
    method: "POST",
    headers: authHeaders,
    body: json({
      sourceAccountId: accountId,
      productId: products.items[0]?.productId,
      principal: { currency: "VND", amountMinor: "1000000" },
      maturityInstruction: "RETURN_PRINCIPAL_AND_INTEREST",
    }),
  });
  assert.equal(quoteResponse.status, 200);
  const quote = (await quoteResponse.json()) as { quoteId: string };

  const shortKeyResponse = await request("/savings/deposits", {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": "short" },
    body: json({ quoteId: quote.quoteId, stepUp: { method: "OTP", proof: "123456" } }),
  });
  assert.equal(shortKeyResponse.status, 422);

  const wrongOtpResponse = await request("/savings/deposits", {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": "savings-http-key-a" },
    body: json({ quoteId: quote.quoteId, stepUp: { method: "OTP", proof: "000000" } }),
  });
  assert.equal(wrongOtpResponse.status, 409);
  assert.equal(
    ((await wrongOtpResponse.json()) as { code: string }).code,
    "STEP_UP_VERIFICATION_FAILED",
  );

  const openingResponse = await request("/savings/deposits", {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": "savings-http-key-a" },
    body: json({ quoteId: quote.quoteId, stepUp: { method: "OTP", proof: "123456" } }),
  });
  assert.equal(openingResponse.status, 200);
  const opening = (await openingResponse.json()) as { openingId: string; depositId: string; status: string };
  assert.equal(opening.status, "SUCCEEDED");

  const openingRetry = await request(`/savings/deposits`, {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": "savings-http-key-a" },
    body: json({ quoteId: quote.quoteId, stepUp: { method: "OTP", proof: "different" } }),
  });
  const retry = (await openingRetry.json()) as { openingId: string };
  assert.equal(retry.openingId, opening.openingId);

  const secondQuoteResponse = await request("/savings/quotes", {
    method: "POST",
    headers: authHeaders,
    body: json({
      sourceAccountId: accountId,
      productId: products.items[0]?.productId,
      principal: { currency: "VND", amountMinor: "2000000" },
      maturityInstruction: "RETURN_PRINCIPAL_AND_INTEREST",
    }),
  });
  assert.equal(secondQuoteResponse.status, 200);
  const secondQuote = (await secondQuoteResponse.json()) as { quoteId: string };
  const mismatchedReplay = await request("/savings/deposits", {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": "savings-http-key-a" },
    body: json({
      quoteId: secondQuote.quoteId,
      stepUp: { method: "OTP", proof: "123456" },
    }),
  });
  assert.equal(mismatchedReplay.status, 409);
  assert.equal(
    ((await mismatchedReplay.json()) as { code: string }).code,
    "IDEMPOTENCY_CONFLICT",
  );

  const detailResponse = await request(`/savings/deposits/${opening.depositId}`, { headers: authHeaders });
  assert.equal(detailResponse.status, 200);
  const detail = (await detailResponse.json()) as { principal: { amountMinor: string }; maturityInstruction: string };
  assert.equal(detail.principal.amountMinor, "1000000");
  assert.equal(detail.maturityInstruction, "RETURN_PRINCIPAL_AND_INTEREST");

  // Phase 2 test: Change maturity instruction
  const patchInvalid = await request(`/savings/deposits/${opening.depositId}`, {
    method: "PATCH",
    headers: authHeaders,
    body: json({ maturityInstruction: "INVALID_INSTRUCTION" }),
  });
  assert.equal(patchInvalid.status, 422);

  const patchValid = await request(`/savings/deposits/${opening.depositId}`, {
    method: "PATCH",
    headers: authHeaders,
    body: json({ maturityInstruction: "RENEW_PRINCIPAL" }),
  });
  assert.equal(patchValid.status, 200);
  const patched = (await patchValid.json()) as { maturityInstruction: string };
  assert.equal(patched.maturityInstruction, "RENEW_PRINCIPAL");

  // Phase 3 test: Early withdrawal
  const withdrawResponse = await request(`/savings/deposits/${opening.depositId}/withdraw`, {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": "wth-idemp-001" },
    body: json({ stepUp: { method: "OTP", proof: "123456" } }),
  });
  assert.equal(withdrawResponse.status, 200);
  const withdrawReceipt = (await withdrawResponse.json()) as {
    status: string;
    principal: { amountMinor: string };
    totalPayout: { amountMinor: string };
    demandRateBasisPoints: number;
    earlyInterest: { amountMinor: string };
  };
  assert.equal(withdrawReceipt.status, "CLOSED");
  assert.equal(withdrawReceipt.principal.amountMinor, "1000000");
  assert.equal(withdrawReceipt.demandRateBasisPoints, 20);
  assert.ok(BigInt(withdrawReceipt.totalPayout.amountMinor) >= 1000000n);

  // Deposit detail reflects CLOSED status
  const closedDetailResponse = await request(`/savings/deposits/${opening.depositId}`, { headers: authHeaders });
  assert.equal(closedDetailResponse.status, 200);
  const closedDetail = (await closedDetailResponse.json()) as { status: string };
  assert.equal(closedDetail.status, "CLOSED");

  // Cannot withdraw or update an already CLOSED deposit
  const secondWithdraw = await request(`/savings/deposits/${opening.depositId}/withdraw`, {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": "wth-idemp-002" },
    body: json({ stepUp: { method: "OTP", proof: "123456" } }),
  });
  assert.equal(secondWithdraw.status, 409);

  const patchClosed = await request(`/savings/deposits/${opening.depositId}`, {
    method: "PATCH",
    headers: authHeaders,
    body: json({ maturityInstruction: "RENEW_PRINCIPAL_AND_INTEREST" }),
  });
  assert.equal(patchClosed.status, 409);

  const trailingRoute = await request("/savings/products/extra", { headers: authHeaders });
  assert.equal(trailingRoute.status, 404);
});

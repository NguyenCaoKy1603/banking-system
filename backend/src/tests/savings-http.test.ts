import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { BankingSystem } from "../bankingSystem.js";
import { createBankingServer } from "../http.js";

const SANDBOX_OPERATOR_KEY = "sandbox-operator-local";

async function completeRegistration(
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

test("HTTP savings flow exposes quote, MFA/idempotency opening and deposit detail", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const server = createBankingServer(system);
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

  const registered = await completeRegistration(request);
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
  system.fundSandbox(SANDBOX_OPERATOR_KEY, "savings-http-funding", {
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

  const wrongOtpResponse = await request("/savings/deposits", {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": "savings-http-key-a" },
    body: json({ quoteId: quote.quoteId, stepUp: { method: "OTP", proof: "000000" } }),
  });
  assert.equal(wrongOtpResponse.status, 401);

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

  const detailResponse = await request(`/savings/deposits/${opening.depositId}`, { headers: authHeaders });
  assert.equal(detailResponse.status, 200);
  const detail = (await detailResponse.json()) as { principal: { amountMinor: string } };
  assert.equal(detail.principal.amountMinor, "1000000");

  const trailingRoute = await request("/savings/products/extra", { headers: authHeaders });
  assert.equal(trailingRoute.status, 404);
});

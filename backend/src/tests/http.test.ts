import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { BankingSystem } from "../bankingSystem.js";
import { createBankingServer } from "../http.js";

test("health endpoint reports reconciliation and outbox readiness", async (t) => {
  const server = createBankingServer(new BankingSystem());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
  const health = (await response.json()) as {
    status: string;
    reconciliation: string;
    pendingOutboxEvents: number;
  };

  assert.equal(response.status, 200);
  assert.equal(health.status, "ok");
  assert.equal(health.reconciliation, "ok");
  assert.equal(health.pendingOutboxEvents, 0);
});

test("HTTP router rejects trailing segments instead of dispatching a prefix route", async (t) => {
  const server = createBankingServer(new BankingSystem());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const response = await fetch(`${baseUrl}/auth/register/extra`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "Should Not Register",
      email: "trailing-route@example.com",
      phoneNumber: "0900000099",
      password: "Password1",
    }),
  });
  assert.equal(response.status, 404);

  const quoteResponse = await fetch(`${baseUrl}/transfers/quote/extra`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(quoteResponse.status, 404);
});

test("HTTP error payload keeps trace ID and does not echo password material", async (t) => {
  const server = createBankingServer(new BankingSystem());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const secret = "do-not-echo-this-password";
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/v1/auth/login`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-ID": "secret-scan-device",
        "X-Request-ID": "trace-secret-scan",
      },
      body: JSON.stringify({
        email: "missing@example.com",
        password: secret,
      }),
    },
  );
  const payload = await response.text();
  assert.equal(response.status, 401);
  assert.match(payload, /trace-secret-scan/);
  assert.equal(payload.includes(secret), false);
});

test("HTTP API supports auth, account, quote and idempotent transfer flow", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const server = createBankingServer(system);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceHeaders = { "X-Device-ID": "device-http-1" };
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  const json = (value: unknown) => JSON.stringify(value);

  const registerResponse = await request("/auth/register", {
    method: "POST",
    headers: deviceHeaders,
    body: json({
      fullName: "HTTP User",
      email: "http@example.com",
      phoneNumber: "0900000000",
      password: "Password1",
    }),
  });
  assert.equal(registerResponse.status, 201);
  const registered = (await registerResponse.json()) as { user: { id: string } };

  const loginResponse = await request("/auth/login", {
    method: "POST",
    headers: deviceHeaders,
    body: json({ email: "http@example.com", password: "Password1" }),
  });
  assert.equal(loginResponse.status, 200);
  const login = (await loginResponse.json()) as {
    accessToken: string;
    refreshToken: string;
  };
  const authHeaders = {
    Authorization: `Bearer ${login.accessToken}`,
    ...deviceHeaders,
  };

  const accountsResponse = await request("/accounts", { headers: authHeaders });
  assert.equal(accountsResponse.status, 200);
  const accounts = (await accountsResponse.json()) as {
    accounts: Array<{ id: string }>;
  };
  const controlPolicyResponse = await request("/mobile/control-policy", {
    headers: authHeaders,
  });
  assert.equal(controlPolicyResponse.status, 200);
  const controlPolicy = (await controlPolicyResponse.json()) as {
    globalKillSwitch: boolean;
    transfersEnabled: boolean;
  };
  assert.equal(controlPolicy.globalKillSwitch, false);
  assert.equal(controlPolicy.transfersEnabled, true);
  const beneficiaryId = system.listBeneficiaries(registered.user.id)[0]?.id;
  assert.ok(accounts.accounts[0]?.id);
  assert.ok(beneficiaryId);

  const quoteResponse = await request("/transfers/quote", {
    method: "POST",
    headers: authHeaders,
    body: json({
      sourceAccountId: accounts.accounts[0].id,
      beneficiaryId,
      amount: { currency: "VND", amountMinor: "100000" },
    }),
  });
  assert.equal(quoteResponse.status, 200);
  const quote = (await quoteResponse.json()) as { quoteId: string };

  const submitResponse = await request("/transfers", {
    method: "POST",
    headers: {
      ...authHeaders,
      "Idempotency-Key": "http-transfer-intent-1",
    },
    body: json({
      quoteId: quote.quoteId,
      stepUp: { method: "OTP", proof: "123456" },
    }),
  });
  assert.equal(submitResponse.status, 200);
  const receipt = (await submitResponse.json()) as { transferId: string };

  const historyResponse = await request(
    `/accounts/${accounts.accounts[0].id}/transactions`,
    { headers: authHeaders },
  );
  assert.equal(historyResponse.status, 200);
  const history = (await historyResponse.json()) as {
    items: Array<{ id: string }>;
  };
  assert.ok(history.items[0]?.id);

  const notificationsResponse = await request("/notifications", {
    headers: authHeaders,
  });
  assert.equal(notificationsResponse.status, 200);
  const notifications = (await notificationsResponse.json()) as {
    items: Array<{
      id: string;
      read: boolean;
      resourceId: string | null;
      resourceAccountId: string | null;
    }>;
  };
  assert.equal(notifications.items[0]?.read, false);
  assert.equal(notifications.items[0]?.resourceId, history.items[0]?.id);
  assert.equal(notifications.items[0]?.resourceAccountId, accounts.accounts[0]?.id);

  const markReadResponse = await request(
    `/notifications/${notifications.items[0].id}/read`,
    { method: "POST", headers: authHeaders },
  );
  assert.equal(markReadResponse.status, 200);

  const fraudReportResponse = await request("/fraud-reports", {
    method: "POST",
    headers: authHeaders,
    body: json({
      accountId: accounts.accounts[0].id,
      transactionId: history.items[0].id,
      reason: "I do not recognize this transfer",
    }),
  });
  assert.equal(fraudReportResponse.status, 201);

  const transferResponse = await request(`/transfers/${receipt.transferId}`, {
    headers: authHeaders,
  });
  assert.equal(transferResponse.status, 200);

  const refreshResponse = await request("/auth/refresh", {
    method: "POST",
    headers: deviceHeaders,
    body: json({ refreshToken: login.refreshToken }),
  });
  assert.equal(refreshResponse.status, 200);
  const refreshed = (await refreshResponse.json()) as { refreshToken: string };
  assert.notEqual(refreshed.refreshToken, login.refreshToken);

  const logoutResponse = await request("/auth/logout", {
    method: "POST",
    headers: deviceHeaders,
    body: json({ refreshToken: refreshed.refreshToken }),
  });
  assert.equal(logoutResponse.status, 204);

  const secondLoginResponse = await request("/auth/login", {
    method: "POST",
    headers: { "X-Device-ID": "device-http-2" },
    body: json({ email: "http@example.com", password: "Password1" }),
  });
  assert.equal(secondLoginResponse.status, 200);
  const secondLogin = (await secondLoginResponse.json()) as {
    accessToken: string;
  };

  const logoutAllResponse = await request("/auth/logout-all", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secondLogin.accessToken}`,
      "X-Device-ID": "device-http-2",
    },
  });
  assert.equal(logoutAllResponse.status, 204);

  const revokedAccessResponse = await request("/accounts", {
    headers: {
      Authorization: `Bearer ${secondLogin.accessToken}`,
      "X-Device-ID": "device-http-2",
    },
  });
  assert.equal(revokedAccessResponse.status, 401);
});

test("HTTP transfer reports pending status for asynchronous settlement", async (t) => {
  const system = new BankingSystem({
    sandboxOtp: "123456",
    settleTransfersImmediately: false,
  });
  const server = createBankingServer(system);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-pending-http";
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  const json = (value: unknown) => JSON.stringify(value);

  const registerResponse = await request("/auth/register", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: json({
      fullName: "Pending HTTP User",
      email: "pending-http@example.com",
      phoneNumber: "0900000003",
      password: "Password1",
    }),
  });
  assert.equal(registerResponse.status, 201);
  const registered = (await registerResponse.json()) as { user: { id: string } };

  const loginResponse = await request("/auth/login", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: json({ email: "pending-http@example.com", password: "Password1" }),
  });
  assert.equal(loginResponse.status, 200);
  const login = (await loginResponse.json()) as { accessToken: string };
  const authHeaders = {
    Authorization: `Bearer ${login.accessToken}`,
    "X-Device-ID": deviceId,
  };

  const accountsResponse = await request("/accounts", { headers: authHeaders });
  const accounts = (await accountsResponse.json()) as {
    accounts: Array<{ id: string }>;
  };
  const beneficiaryId = system.listBeneficiaries(registered.user.id)[0]?.id;
  assert.ok(accounts.accounts[0]?.id);
  assert.ok(beneficiaryId);

  const quoteResponse = await request("/transfers/quote", {
    method: "POST",
    headers: authHeaders,
    body: json({
      sourceAccountId: accounts.accounts[0].id,
      beneficiaryId,
      amount: { currency: "VND", amountMinor: "100000" },
    }),
  });
  assert.equal(quoteResponse.status, 200);
  const quote = (await quoteResponse.json()) as { quoteId: string };

  const submitResponse = await request("/transfers", {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": "pending-http-intent-1" },
    body: json({
      quoteId: quote.quoteId,
      stepUp: { method: "OTP", proof: "123456" },
    }),
  });
  assert.equal(submitResponse.status, 202);
  const receipt = (await submitResponse.json()) as {
    transferId: string;
    status: string;
  };
  assert.equal(receipt.status, "PENDING");

  const statusResponse = await request(`/transfers/${receipt.transferId}`, {
    headers: authHeaders,
  });
  assert.equal(statusResponse.status, 200);
  const latestReceipt = (await statusResponse.json()) as { status: string };
  assert.equal(latestReceipt.status, "PENDING");
});

test("HTTP API supports beneficiary directory CRUD without exposing raw account numbers", async (t) => {
  const system = new BankingSystem();
  const server = createBankingServer(system);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-beneficiary-http";
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  const json = (value: unknown) => JSON.stringify(value);

  await request("/auth/register", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: json({
      fullName: "Beneficiary HTTP User",
      email: "beneficiary-http@example.com",
      phoneNumber: "0900000004",
      password: "Password1",
    }),
  });
  const loginResponse = await request("/auth/login", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: json({ email: "beneficiary-http@example.com", password: "Password1" }),
  });
  const login = (await loginResponse.json()) as { accessToken: string };
  const authHeaders = {
    Authorization: `Bearer ${login.accessToken}`,
    "X-Device-ID": deviceId,
  };

  const listResponse = await request("/beneficiaries", { headers: authHeaders });
  assert.equal(listResponse.status, 200);
  const initialList = (await listResponse.json()) as {
    items: Array<{ id: string; maskedAccountNumber: string }>;
  };
  assert.equal(initialList.items.length, 1);

  const createResponse = await request("/beneficiaries", {
    method: "POST",
    headers: authHeaders,
    body: json({
      displayName: "HTTP Family",
      accountNumber: "987654321012",
      bankName: "Reference Bank",
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()) as {
    beneficiary: { id: string; displayName: string; maskedAccountNumber: string };
  };
  assert.equal(created.beneficiary.displayName, "HTTP Family");
  assert.equal(created.beneficiary.maskedAccountNumber, "•••• 1012");
  assert.equal(created.beneficiary.maskedAccountNumber.includes("987654"), false);

  const renameResponse = await request(
    `/beneficiaries/${created.beneficiary.id}`,
    {
      method: "PATCH",
      headers: authHeaders,
      body: json({ displayName: "HTTP Family Renamed" }),
    },
  );
  assert.equal(renameResponse.status, 200);
  const renamed = (await renameResponse.json()) as {
    beneficiary: { displayName: string };
  };
  assert.equal(renamed.beneficiary.displayName, "HTTP Family Renamed");

  const deleteResponse = await request(
    `/beneficiaries/${created.beneficiary.id}`,
    { method: "DELETE", headers: authHeaders },
  );
  assert.equal(deleteResponse.status, 204);

  const deletedLookup = await request(
    `/beneficiaries/${created.beneficiary.id}`,
    { headers: authHeaders },
  );
  assert.equal(deletedLookup.status, 404);
});

test("HTTP auth exposes a device-bound MFA challenge", async (t) => {
  const system = new BankingSystem({
    sandboxMfaOtp: "654321",
    mfaRequired: true,
  });
  const server = createBankingServer(system);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-mfa-http";
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  const json = (value: unknown) => JSON.stringify(value);

  const registerResponse = await request("/auth/register", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: json({
      fullName: "MFA HTTP User",
      email: "mfa-http@example.com",
      phoneNumber: "0900000001",
      password: "Password1",
    }),
  });
  assert.equal(registerResponse.status, 201);

  const loginResponse = await request("/auth/login", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: json({ email: "mfa-http@example.com", password: "Password1" }),
  });
  assert.equal(loginResponse.status, 202);
  const challenge = (await loginResponse.json()) as {
    challengeId: string;
    methods: string[];
  };
  assert.deepEqual(challenge.methods, ["OTP"]);

  const verifyResponse = await request("/auth/verify", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: json({
      challengeId: challenge.challengeId,
      method: "OTP",
      proof: "654321",
    }),
  });
  assert.equal(verifyResponse.status, 200);
  const session = (await verifyResponse.json()) as { accessToken: string };
  assert.ok(session.accessToken);
});

test("HTTP auth exposes a server-configured biometric challenge", async (t) => {
  const system = new BankingSystem({
    authChallengeMethods: ["BIOMETRIC"],
    mfaRequired: true,
  });
  const server = createBankingServer(system);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-biometric-http";
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  const json = (value: unknown) => JSON.stringify(value);

  const registerResponse = await request("/auth/register", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: json({
      fullName: "Biometric HTTP User",
      email: "biometric-http@example.com",
      phoneNumber: "0900000002",
      password: "Password1",
    }),
  });
  assert.equal(registerResponse.status, 201);

  const loginResponse = await request("/auth/login", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: json({
      email: "biometric-http@example.com",
      password: "Password1",
    }),
  });
  assert.equal(loginResponse.status, 202);
  const challenge = (await loginResponse.json()) as {
    challengeId: string;
    methods: string[];
  };
  assert.deepEqual(challenge.methods, ["BIOMETRIC"]);

  const verifyResponse = await request("/auth/verify", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: json({
      challengeId: challenge.challengeId,
      method: "BIOMETRIC",
      proof: "sandbox-biometric",
    }),
  });
  assert.equal(verifyResponse.status, 200);
  const session = (await verifyResponse.json()) as { accessToken: string };
  assert.ok(session.accessToken);
});

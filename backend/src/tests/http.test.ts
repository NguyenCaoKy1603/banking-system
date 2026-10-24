import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { BankingSystem } from "../bankingSystem.js";
import { createBankingServer, createPersistentBankingServer } from "../http.js";
import { computeRegistrationNetworkFingerprint } from "../security.js";
import type { MfaChallengeResponse, PersistentMfaService } from "../mfa/persistentMfaService.js";

const TEST_REGISTRATION_FINGERPRINT_KEY = Buffer.alloc(32, 0x42);

async function completeRegistration(
  system: BankingSystem,
  request: (path: string, init?: RequestInit) => Promise<Response>,
  deviceId: string,
  input: { fullName: string; email: string; phoneNumber: string; password: string },
): Promise<{ user: { id: string } }> {
  const begin = await request("/auth/register", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: JSON.stringify(input),
  });
  assert.equal(begin.status, 202);
  const challenge = (await begin.json()) as { challengeId: string };
  const otp = { otp: system.readTestVerificationCode(challenge.challengeId) };
  const verified = await request("/auth/register/verify", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      method: "EMAIL_OTP",
      proof: otp.otp,
    }),
  });
  assert.equal(verified.status, 201);
  return (await verified.json()) as { user: { id: string } };
}

test("health endpoint reports reconciliation and outbox readiness", async (t) => {
  const server = createBankingServer(new BankingSystem(), { registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
  const health = (await response.json()) as {
    status: string;
    service: string;
    reconciliation: string;
    pendingOutboxEvents: number;
  };

  assert.equal(response.status, 200);
  assert.equal(health.status, "ok");
  assert.equal(health.service, "banking-reference-backend");
  assert.equal(health.reconciliation, "ok");
  assert.equal(health.pendingOutboxEvents, 0);
});

test("liveness stays available when the persistent repository is unavailable", async (t) => {
  const repository = {
    withState: async <T>(): Promise<T> => {
      throw new Error("database unavailable");
    },
  };
  const server = createPersistentBankingServer(repository, new BankingSystem(), { registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const live = await fetch(`http://127.0.0.1:${address.port}/livez`);
  assert.equal(live.status, 200);
  assert.equal((await live.json()).status, "ok");

  const ready = await fetch(`http://127.0.0.1:${address.port}/healthz`);
  assert.equal(ready.status, 503);
});

test("configured CORS rejects an origin outside the preview allow-list", async (t) => {
  const server = createBankingServer(new BankingSystem(), {
    allowedOrigins: ["https://preview.example.invalid"],
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${address.port}/healthz`, {
    headers: { Origin: "https://not-allowed.example.invalid" },
  });
  const payload = (await response.json()) as { code: string };
  assert.equal(response.status, 403);
  assert.equal(payload.code, "CORS_ORIGIN_DENIED");
});

test("HTTP router rejects trailing segments instead of dispatching a prefix route", async (t) => {
  const server = createBankingServer(new BankingSystem(), { registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY });
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
  const server = createBankingServer(new BankingSystem(), { registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY });
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
  const system = new BankingSystem({
    sandboxOtp: "123456",
    allowUnsafeDirectSandboxStepUp: true,
  });
  const server = createBankingServer(system, { registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY });
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

  const registered = await completeRegistration(system, request, deviceHeaders["X-Device-ID"], {
    fullName: "HTTP User",
    email: "http@example.com",
    phoneNumber: "0900000000",
    password: "Password1",
  });

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
    accounts: Array<{ id: string; maskedNumber: string; accountNumber?: string }>;
  };
  assert.equal(accounts.accounts[0]?.maskedNumber, "•••• 0001");
  assert.equal(accounts.accounts[0]?.accountNumber, undefined);
  const accountNumberResponse = await request(
    `/accounts/${accounts.accounts[0]?.id}/number`,
    { headers: authHeaders },
  );
  assert.equal(accountNumberResponse.status, 200);
  const accountNumberPayload = (await accountNumberResponse.json()) as {
    accountNumber: string;
  };
  assert.match(accountNumberPayload.accountNumber, /^\d{12}$/);
  assert.equal(accountNumberPayload.accountNumber.slice(-4), "0001");
  const trailingAccountNumberResponse = await request(
    `/accounts/${accounts.accounts[0]?.id}/number/extra`,
    { headers: authHeaders },
  );
  assert.equal(trailingAccountNumberResponse.status, 404);
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
  assert.ok(accounts.accounts[0]?.id);
  const sourceAccountNumber = accountNumberPayload.accountNumber;
  system.seedReferenceFunding("http-transfer-funding", {
    recipientAccountNumber: sourceAccountNumber,
    amount: { currency: "VND", amountMinor: "10000000" },
    reason: "test fixture funding",
  });
  const recipient = system.register({
    fullName: "HTTP Recipient",
    email: "http-recipient@example.com",
    phoneNumber: "0900000005",
    password: "Password1",
  }).user;
  const recipientAccount = system.listAccounts(recipient.id)[0];
  assert.ok(recipientAccount);
  const beneficiary = system.createBeneficiary(registered.user.id, {
    displayName: "HTTP Recipient",
    accountNumber: system.getAccountNumber(recipient.id, recipientAccount.id),
    bankName: "Reference Bank",
  });
  const beneficiaryId = beneficiary.id;

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

  const shortKeyResponse = await request("/transfers", {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": "short" },
    body: json({
      quoteId: quote.quoteId,
      stepUp: { method: "OTP", proof: "123456" },
    }),
  });
  assert.equal(shortKeyResponse.status, 422);

  const rejectedStepUp = await request("/transfers", {
    method: "POST",
    headers: {
      ...authHeaders,
      "Idempotency-Key": "http-transfer-invalid-stepup",
    },
    body: json({
      quoteId: quote.quoteId,
      stepUp: { method: "OTP", proof: "000000" },
    }),
  });
  assert.equal(rejectedStepUp.status, 409);
  assert.equal(
    ((await rejectedStepUp.json()) as { code: string }).code,
    "STEP_UP_VERIFICATION_FAILED",
  );

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

  const secondQuoteResponse = await request("/transfers/quote", {
    method: "POST",
    headers: authHeaders,
    body: json({
      sourceAccountId: accounts.accounts[0].id,
      beneficiaryId,
      amount: { currency: "VND", amountMinor: "200000" },
    }),
  });
  assert.equal(secondQuoteResponse.status, 200);
  const secondQuote = (await secondQuoteResponse.json()) as { quoteId: string };
  const mismatchedReplay = await request("/transfers", {
    method: "POST",
    headers: {
      ...authHeaders,
      "Idempotency-Key": "http-transfer-intent-1",
    },
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
    allowUnsafeDirectSandboxStepUp: true,
    settleTransfersImmediately: false,
  });
  const server = createBankingServer(system, { registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY });
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

  const registered = await completeRegistration(system, request, deviceId, {
    fullName: "Pending HTTP User",
    email: "pending-http@example.com",
    phoneNumber: "0900000003",
    password: "Password1",
  });

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
  assert.ok(accounts.accounts[0]?.id);
  const recipient = system.register({
    fullName: "Pending HTTP Recipient",
    email: "pending-http-recipient@example.com",
    phoneNumber: "0900000006",
    password: "Password1",
  }).user;
  const recipientAccount = system.listAccounts(recipient.id)[0];
  assert.ok(recipientAccount);
  const sourceAccountNumber = system.getAccountNumber(registered.user.id, accounts.accounts[0].id);
  system.seedReferenceFunding("pending-http-funding", {
    recipientAccountNumber: sourceAccountNumber,
    amount: { currency: "VND", amountMinor: "10000000" },
    reason: "test fixture funding",
  });
  const beneficiaryId = system.createBeneficiary(registered.user.id, {
    displayName: "Pending HTTP Recipient",
    accountNumber: system.getAccountNumber(recipient.id, recipientAccount.id),
    bankName: "Reference Bank",
  }).id;

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
  const server = createBankingServer(system, { registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY });
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

  await completeRegistration(system, request, deviceId, {
    fullName: "Beneficiary HTTP User",
    email: "beneficiary-http@example.com",
    phoneNumber: "0900000004",
    password: "Password1",
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
  assert.equal(initialList.items.length, 0);

  const recipient = system.register({
    fullName: "Beneficiary HTTP Recipient",
    email: "beneficiary-http-recipient@example.com",
    phoneNumber: "0900000007",
    password: "Password1",
  }).user;
  const recipientAccount = system.listAccounts(recipient.id)[0];
  assert.ok(recipientAccount);
  const recipientAccountNumber = system.getAccountNumber(recipient.id, recipientAccount.id);

  const createResponse = await request("/beneficiaries", {
    method: "POST",
    headers: authHeaders,
    body: json({
      displayName: "HTTP Family",
      accountNumber: recipientAccountNumber,
      bankName: "Reference Bank",
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()) as {
    beneficiary: { id: string; displayName: string; maskedAccountNumber: string };
  };
  assert.equal(created.beneficiary.displayName, "HTTP Family");
  assert.equal(created.beneficiary.maskedAccountNumber, `•••• ${recipientAccountNumber.slice(-4)}`);
  assert.equal(created.beneficiary.maskedAccountNumber.includes(recipientAccountNumber.slice(0, -4)), false);

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

test("HTTP auth is password-only even when the legacy MFA flag is enabled", async (t) => {
  const system = new BankingSystem({
    sandboxMfaOtp: "654321",
    mfaRequired: true,
  });
  const server = createBankingServer(system, { registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY });
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

  await completeRegistration(system, request, deviceId, {
    fullName: "MFA HTTP User",
    email: "mfa-http@example.com",
    phoneNumber: "0900000001",
    password: "Password1",
  });

  const loginResponse = await request("/auth/login", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: json({ email: "mfa-http@example.com", password: "Password1" }),
  });
  assert.equal(loginResponse.status, 200);
  const session = (await loginResponse.json()) as { accessToken: string; refreshToken: string };
  assert.ok(session.accessToken);
  assert.ok(session.refreshToken);
});

test("HTTP auth ignores legacy biometric login configuration", async (t) => {
  const system = new BankingSystem({
    authChallengeMethods: ["BIOMETRIC"],
    mfaRequired: true,
    allowUnsafeDirectSandboxStepUp: true,
  });
  const server = createBankingServer(system, { registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY });
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

  await completeRegistration(system, request, deviceId, {
    fullName: "Biometric HTTP User",
    email: "biometric-http@example.com",
    phoneNumber: "0900000002",
    password: "Password1",
  });

  const loginResponse = await request("/auth/login", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: json({
      email: "biometric-http@example.com",
      password: "Password1",
    }),
  });
  assert.equal(loginResponse.status, 200);
  const session = (await loginResponse.json()) as { accessToken: string; refreshToken: string };
  assert.ok(session.accessToken);
  assert.ok(session.refreshToken);
});

test("non-Registration MFA resend keeps its client-address derivation while Registration ignores x-forwarded-for", async (t) => {
  type ResendCall = { challengeId: string; deviceId: string; networkFingerprint?: string | null };
  type ResendMfaPort = {
    resendRegistrationChallenge(input: ResendCall): Promise<MfaChallengeResponse>;
    resendChallenge(input: ResendCall & { customerId?: string; destination: string }): Promise<MfaChallengeResponse>;
  };

  // PersistentMfaService declares private members, so TypeScript matches it
  // nominally. The fake is checked against the real public port shape at the call
  // site and crosses that nominal boundary on the single return line below.
  function asResendMfaService(port: ResendMfaPort): PersistentMfaService {
    return port as never;
  }

  const stubChallenge: MfaChallengeResponse = {
    challengeId: "resent-challenge",
    method: "EMAIL_OTP",
    methods: ["EMAIL_OTP"],
    purpose: "REGISTRATION_EMAIL_VERIFY",
    expiresAt: "2030-01-01T00:00:00.000Z",
  };

  const registrationResendCalls: ResendCall[] = [];
  const authenticatedResendCalls: ResendCall[] = [];
  const mfaService = asResendMfaService({
    resendRegistrationChallenge: async (call) => {
      registrationResendCalls.push(call);
      return stubChallenge;
    },
    resendChallenge: async (call) => {
      authenticatedResendCalls.push(call);
      return stubChallenge;
    },
  });

  const system = new BankingSystem();
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    mfaService,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-xff-split";
  const spoofedAddress = "203.0.113.9";
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

  await completeRegistration(system, request, deviceId, {
    fullName: "XFF Split User",
    email: "xff-split@example.com",
    phoneNumber: "0900000003",
    password: "Password1",
  });
  const loginResponse = await request("/auth/login", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: JSON.stringify({ email: "xff-split@example.com", password: "Password1" }),
  });
  assert.equal(loginResponse.status, 200);
  const session = (await loginResponse.json()) as { accessToken: string };

  const registrationResend = await request("/auth/challenges/challenge-registration/resend", {
    method: "POST",
    headers: { "X-Device-ID": deviceId, "x-forwarded-for": spoofedAddress },
    body: JSON.stringify({}),
  });
  assert.equal(registrationResend.status, 200);

  const authenticatedResend = await request("/auth/challenges/challenge-authenticated/resend", {
    method: "POST",
    headers: {
      "X-Device-ID": deviceId,
      "x-forwarded-for": spoofedAddress,
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({}),
  });
  assert.equal(authenticatedResend.status, 200);

  assert.equal(registrationResendCalls.length, 1);
  assert.equal(authenticatedResendCalls.length, 1);
  assert.equal(
    registrationResendCalls[0]!.networkFingerprint,
    computeRegistrationNetworkFingerprint("127.0.0.1", TEST_REGISTRATION_FINGERPRINT_KEY),
    "Registration must derive its fingerprint from the socket address, never from x-forwarded-for",
  );
  assert.equal(
    authenticatedResendCalls[0]!.networkFingerprint,
    spoofedAddress,
    "the non-Registration resend flow must keep its pre-hardening client-address derivation",
  );
  assert.notEqual(
    registrationResendCalls[0]!.networkFingerprint,
    authenticatedResendCalls[0]!.networkFingerprint,
  );
});

test("degraded email provider does not mark backend readiness as degraded in preview runtime", async (t) => {
  const system = new BankingSystem();
  const server = createBankingServer(system, {
    environment: "preview",
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    emailProviderHealth: () => ({
      provider: "smtp",
      status: "degraded",
      configured: true,
      credentialConfigured: true,
      lastErrorCode: "smtp-provider-timeout",
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const readyResponse = await fetch(`http://127.0.0.1:${address.port}/readyz`);
  assert.equal(readyResponse.status, 200);
  const readyBody = (await readyResponse.json()) as {
    status: string;
    emailProvider?: { provider: string; status: string; lastErrorCode?: string };
  };
  assert.equal(readyBody.status, "ok");
  assert.deepEqual(readyBody.emailProvider, {
    provider: "smtp",
    status: "degraded",
    configured: true,
    credentialConfigured: true,
    lastErrorCode: "smtp-provider-timeout",
  });
});

test("throwing email provider health check does not crash readyz and does not degrade readiness in preview", async (t) => {
  const system = new BankingSystem();
  const server = createBankingServer(system, {
    environment: "preview",
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    emailProviderHealth: () => {
      throw new Error("SMTP connection failed");
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const readyResponse = await fetch(`http://127.0.0.1:${address.port}/readyz`);
  assert.equal(readyResponse.status, 200);
  const readyBody = (await readyResponse.json()) as {
    status: string;
    emailProvider?: { provider: string; status: string; lastErrorCode?: string };
  };
  assert.equal(readyBody.status, "ok");
  assert.equal(readyBody.emailProvider?.status, "degraded");
  assert.equal(readyBody.emailProvider?.lastErrorCode, "email-provider-health-failed");
});

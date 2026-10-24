import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { BankingSystem } from "../bankingSystem.js";
import { createBankingServer, createPersistentBankingServer } from "../http.js";
import { FakeAssistantHelpProvider } from "../assistant/helpProvider.js";
import { AssistantRateLimiter } from "../assistant/rateLimiter.js";
import { resolveAssistantConfig } from "../assistant/helpConfig.js";
import type { FinancialAdviceService } from "../financialAdvice/adviceService.js";
import type { HttpOptions } from "../http.js";

const TEST_REGISTRATION_FINGERPRINT_KEY = Buffer.alloc(32, 0x42);

async function setupTestUser(
  system: BankingSystem,
  baseUrl: string,
  deviceId: string,
): Promise<{ accessToken: string; userId: string }> {
  const json = (val: unknown) => JSON.stringify(val);
  const email = `fa-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = "Password123!";

  const regRes = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Device-ID": deviceId },
    body: json({
      fullName: "Financial Advice Test User",
      email,
      phoneNumber: "0900000002",
      password,
    }),
  });
  assert.equal(regRes.status, 202);
  const challenge = (await regRes.json()) as { challengeId: string };
  const otp = system.readTestVerificationCode(challenge.challengeId);

  const verifyRes = await fetch(`${baseUrl}/auth/register/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Device-ID": deviceId },
    body: json({
      challengeId: challenge.challengeId,
      method: "EMAIL_OTP",
      proof: otp,
    }),
  });
  assert.equal(verifyRes.status, 201);
  const verifiedUser = (await verifyRes.json()) as { user: { id: string } };

  const session = system.issueMfaSession(verifiedUser.user.id, deviceId);
  return {
    accessToken: session.accessToken,
    userId: verifiedUser.user.id,
  };
}

const sampleSavingsRequest = {
  schemaVersion: "1",
  kind: "SAVINGS_PLAN",
  currency: "VND",
  monthlyIncomeMinor: "10000000",
  essentialExpensesMinor: "6000000",
  flexibleExpensesMinor: "2000000",
  monthlyDebtPaymentsMinor: "500000",
  monthlyBufferMinor: "0",
  preference: "KEEP_CURRENT_SPENDING",
  inputConfirmed: true,
  goal: {
    targetAmountMinor: "12000000",
    alreadySavedMinor: "2000000",
    months: 5,
  },
};

const sampleBudgetRequest = {
  schemaVersion: "1",
  kind: "BUDGET_BALANCE",
  currency: "VND",
  monthlyIncomeMinor: "10000000",
  essentialExpensesMinor: "6000000",
  flexibleExpensesMinor: "2000000",
  monthlyDebtPaymentsMinor: "500000",
  monthlyBufferMinor: "500000",
  preference: "KEEP_TARGET",
  inputConfirmed: true,
  monthlySavingsTargetMinor: "2000000",
};

type FinancialAdviceServiceDouble = {
  executeAdviceRequest: (
    request: unknown,
    signal: AbortSignal,
    consumeProviderCall: () => void,
  ) => Promise<unknown>;
};

const successfulAdviceResult = {
  schemaVersion: "1",
  kind: "SAVINGS_PLAN",
  currency: "VND",
  source: "USER_ENTERED",
  calculationVersion: "test",
  catalogVersion: "test",
  budgetStatus: "SURPLUS",
  goalStatus: "FEASIBLE",
  metrics: {},
  options: [],
  preferredOptionId: "MAINTAIN_PLAN",
  explanation: { mode: "RULE_BASED", reasonIds: [], paragraphs: [], fallbackReason: "AI_DISABLED" },
  assumptions: [],
  warnings: [],
};

async function startFinancialAdviceFixture(
  t: { after: (callback: () => void | Promise<void>) => void },
  service: FinancialAdviceServiceDouble,
  options: { requestTimeoutMs?: number; authenticate?: (system: BankingSystem, token: string, deviceId: string) => Promise<{ id: string }> } = {},
): Promise<{ system: BankingSystem; baseUrl: string; accessToken: string; deviceId: string; limiter: AssistantRateLimiter }> {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const limiter = new AssistantRateLimiter({
    rateLimitPerMinute: 20,
    maxConcurrentRequests: 1,
    maxConcurrentPerUser: 1,
  });
  const relationalHttp = options.authenticate
    ? { authenticate: (token: string, deviceId: string) => options.authenticate!(system, token, deviceId) }
    : undefined;
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    assistantConfig: {
      enabled: false,
      requestTimeoutMs: options.requestTimeoutMs ?? 2_000,
      rateLimitPerMinute: 20,
      maxConcurrentRequests: 1,
      maxConcurrentPerUser: 1,
    },
    assistantRateLimiter: limiter,
    financialAdviceConfig: { enabled: true },
    financialAdviceService: service as unknown as FinancialAdviceService,
    relationalHttp: relationalHttp as HttpOptions["relationalHttp"],
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-nfa-deadline";
  const { accessToken } = await setupTestUser(system, baseUrl, deviceId);
  return { system, baseUrl, accessToken, deviceId, limiter };
}

function postAdvice(baseUrl: string, accessToken: string, deviceId: string, signal?: AbortSignal): Promise<Response> {
  return fetch(`${baseUrl}/assistant/financial-advice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
    },
    body: JSON.stringify(sampleSavingsRequest),
    signal,
  });
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for the test condition.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function postAdviceWithWatchdog(
  baseUrl: string,
  accessToken: string,
  deviceId: string,
  watchdogMs = 1_500,
): Promise<Response> {
  const controller = new AbortController();
  const watchdog = setTimeout(() => controller.abort(), watchdogMs);
  try {
    return await postAdvice(baseUrl, accessToken, deviceId, controller.signal);
  } finally {
    clearTimeout(watchdog);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function postPartialAdviceBody(
  baseUrl: string,
  accessToken: string,
  deviceId: string,
): { request: ReturnType<typeof httpRequest>; response: Promise<number> } {
  let resolveResponse!: (status: number) => void;
  let rejectResponse!: (error: Error) => void;
  const response = new Promise<number>((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });
  const request = httpRequest(`${baseUrl}/assistant/financial-advice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
    },
  }, (incoming) => {
    incoming.resume();
    incoming.once("end", () => resolveResponse(incoming.statusCode ?? 0));
  });
  request.once("error", (error) => rejectResponse(error));
  request.write("{");
  return { request, response };
}

test("H-01: Valid request returns 200, Cache-Control: no-store, X-Request-ID for both kinds", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const fakeProvider = new FakeAssistantHelpProvider({
    defaultAnswer: JSON.stringify({
      preferredOptionId: "EXTEND_DEADLINE",
      reasonIds: ["MONTHLY_GAP", "PRESERVE_CURRENT_SPENDING"],
    }),
  });

  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    assistantConfig: { enabled: true, provider: fakeProvider },
    financialAdviceConfig: { enabled: true },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-test-h01";
  const { accessToken } = await setupTestUser(system, baseUrl, deviceId);

  // Test SAVINGS_PLAN
  const resSavings = await fetch(`${baseUrl}/assistant/financial-advice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
      "X-Request-ID": "test-req-h01-savings",
    },
    body: JSON.stringify(sampleSavingsRequest),
  });

  assert.equal(resSavings.status, 200);
  assert.equal(resSavings.headers.get("Cache-Control"), "no-store");
  assert.equal(resSavings.headers.get("X-Request-ID"), "test-req-h01-savings");
  const dataSavings = (await resSavings.json()) as Record<string, unknown>;
  assert.equal(dataSavings.kind, "SAVINGS_PLAN");
  assert.equal(dataSavings.preferredOptionId, "EXTEND_DEADLINE");

  // Test BUDGET_BALANCE
  fakeProvider.setMode("success", {
    defaultAnswer: JSON.stringify({
      preferredOptionId: "REDUCE_FLEXIBLE_SPENDING",
      reasonIds: ["MONTHLY_GAP", "KEEP_TARGET_WITH_FLEXIBLE_CUT"],
    }),
  });

  const resBudget = await fetch(`${baseUrl}/assistant/financial-advice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
      "X-Request-ID": "test-req-h01-budget",
    },
    body: JSON.stringify(sampleBudgetRequest),
  });

  assert.equal(resBudget.status, 200);
  assert.equal(resBudget.headers.get("Cache-Control"), "no-store");
  const dataBudget = (await resBudget.json()) as Record<string, unknown>;
  assert.equal(dataBudget.kind, "BUDGET_BALANCE");
  assert.equal(dataBudget.preferredOptionId, "REDUCE_FLEXIBLE_SPENDING");
});

test("H-02: Missing Bearer Token returns 401", async (t) => {
  const system = new BankingSystem();
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    financialAdviceConfig: { enabled: true },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

  const res = await fetch(`${baseUrl}/assistant/financial-advice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Device-ID": "device-h02",
    },
    body: JSON.stringify(sampleSavingsRequest),
  });

  assert.equal(res.status, 401);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});

test("H-03: Missing X-Device-ID returns 401/422", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    financialAdviceConfig: { enabled: true },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const { accessToken } = await setupTestUser(system, baseUrl, "device-valid");

  const res = await fetch(`${baseUrl}/assistant/financial-advice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      // omitted X-Device-ID
    },
    body: JSON.stringify(sampleSavingsRequest),
  });

  assert.ok(res.status === 401 || res.status === 422);
});

test("H-05: Non-JSON Content-Type returns 415 UNSUPPORTED_MEDIA_TYPE", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    financialAdviceConfig: { enabled: true },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-h05";
  const { accessToken } = await setupTestUser(system, baseUrl, deviceId);

  const res = await fetch(`${baseUrl}/assistant/financial-advice`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
    },
    body: JSON.stringify(sampleSavingsRequest),
  });

  assert.equal(res.status, 415);
});

test("H-06: Body exceeding 8192 bytes returns 413 FINANCIAL_ADVICE_BODY_TOO_LARGE", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    financialAdviceConfig: { enabled: true, maxBodyBytes: 8192 },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-h06";
  const { accessToken } = await setupTestUser(system, baseUrl, deviceId);

  // Large payload (> 8192 bytes)
  const oversizedPayload = {
    ...sampleSavingsRequest,
    padding: "A".repeat(10000),
  };

  const res = await fetch(`${baseUrl}/assistant/financial-advice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
    },
    body: JSON.stringify(oversizedPayload),
  });

  assert.equal(res.status, 413);
  const data = (await res.json()) as { code: string };
  assert.equal(data.code, "FINANCIAL_ADVICE_BODY_TOO_LARGE");
});

test("H-07: Non-POST method or invalid sub-route returns 404", async (t) => {
  const system = new BankingSystem();
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    financialAdviceConfig: { enabled: true },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

  const getRes = await fetch(`${baseUrl}/assistant/financial-advice`, {
    method: "GET",
  });
  assert.equal(getRes.status, 404);

  const unknownSubRes = await fetch(`${baseUrl}/assistant/unknown-route`, {
    method: "POST",
  });
  assert.equal(unknownSubRes.status, 404);
});

test("H-08: Validation failure (422) does NOT call provider", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const fakeProvider = new FakeAssistantHelpProvider();
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    assistantConfig: { enabled: true, provider: fakeProvider },
    financialAdviceConfig: { enabled: true },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-h08";
  const { accessToken } = await setupTestUser(system, baseUrl, deviceId);

  const invalidBody = {
    ...sampleSavingsRequest,
    monthlyIncomeMinor: "-500", // invalid
  };

  const res = await fetch(`${baseUrl}/assistant/financial-advice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
    },
    body: JSON.stringify(invalidBody),
  });

  assert.equal(res.status, 422);
  assert.equal(fakeProvider.callCount, 0); // Not consumed
});

test("H-11: Disabled feature (FINANCIAL_ADVICE_ENABLED=0) returns 503 FINANCIAL_ADVICE_UNAVAILABLE", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    financialAdviceConfig: { enabled: false },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-h11";
  const { accessToken } = await setupTestUser(system, baseUrl, deviceId);

  const res = await fetch(`${baseUrl}/assistant/financial-advice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
    },
    body: JSON.stringify(sampleSavingsRequest),
  });

  assert.equal(res.status, 503);
  const data = (await res.json()) as { code: string };
  assert.equal(data.code, "FINANCIAL_ADVICE_UNAVAILABLE");
});

test("H-12: Provider failure falls back to 200 RULE_BASED", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const fakeProvider = new FakeAssistantHelpProvider({
    mode: "error",
    errorToThrow: new Error("Model unreachable"),
  });
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    assistantConfig: { enabled: true, provider: fakeProvider },
    financialAdviceConfig: { enabled: true },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-h12";
  const { accessToken } = await setupTestUser(system, baseUrl, deviceId);

  const res = await fetch(`${baseUrl}/assistant/financial-advice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
    },
    body: JSON.stringify(sampleSavingsRequest),
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as {
    explanation: { mode: string; fallbackReason: string };
  };
  assert.equal(data.explanation.mode, "RULE_BASED");
  assert.equal(data.explanation.fallbackReason, "PROVIDER_UNAVAILABLE");
});

test("H-13 & H-14: Persistent server dispatch does not invoke withState for financial-advice", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const repository = {
    withState: async (): Promise<never> => {
      throw new Error("withState should never be called for financial-advice route!");
    },
  };

  const fakeProvider = new FakeAssistantHelpProvider({
    defaultAnswer: JSON.stringify({
      preferredOptionId: "EXTEND_DEADLINE",
      reasonIds: ["MONTHLY_GAP"],
    }),
  });

  const memServer = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
  });
  await new Promise<void>((resolve) => memServer.listen(0, "127.0.0.1", resolve));
  const memAddr = memServer.address() as AddressInfo;
  const memBaseUrl = `http://127.0.0.1:${memAddr.port}/api/v1`;
  const deviceId = "device-h13";
  const { accessToken } = await setupTestUser(system, memBaseUrl, deviceId);
  await new Promise<void>((resolve) => memServer.close(() => resolve()));

  const server = createPersistentBankingServer(repository, system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    assistantConfig: { enabled: true, provider: fakeProvider },
    financialAdviceConfig: { enabled: true },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

  const res = await fetch(`${baseUrl}/assistant/financial-advice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
    },
    body: JSON.stringify(sampleSavingsRequest),
  });

  // Must succeed with 200 without triggering the repository.withState error
  assert.equal(res.status, 200);
});

test("H-16: /assistant/help regression check alongside financial-advice", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const fakeProvider = new FakeAssistantHelpProvider({
    defaultAnswer: JSON.stringify({ selectionId: "FAQ-04" }),
  });
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    assistantConfig: { enabled: true, provider: fakeProvider },
    financialAdviceConfig: { enabled: true },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-h16";
  const { accessToken } = await setupTestUser(system, baseUrl, deviceId);

  // Call help route
  const resHelp = await fetch(`${baseUrl}/assistant/help`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
    },
    body: JSON.stringify({ question: "Tôi xem lịch sử giao dịch ở đâu?" }),
  });

  assert.equal(resHelp.status, 200);
  const helpData = (await resHelp.json()) as { answer: string };
  assert.ok(helpData.answer.length > 0);
});

test("H-17: /assistant/help and financial-advice share one provider-call budget", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  let providerCalls = 0;
  const provider = {
    async generateHelpResponse(_prompt: string, _context: string, question: string) {
      providerCalls += 1;
      return {
        text: question.startsWith("Hãy chọn")
          ? JSON.stringify({ preferredOptionId: "EXTEND_DEADLINE", reasonIds: ["MONTHLY_GAP"] })
          : JSON.stringify({ selectionId: "FAQ-04" }),
        finishReason: "stop" as const,
        toolCallsDetected: false,
      };
    },
  };
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    assistantConfig: { enabled: true, provider, rateLimitPerMinute: 20 },
    financialAdviceConfig: { enabled: true },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-h17";
  const { accessToken } = await setupTestUser(system, baseUrl, deviceId);

  for (let index = 0; index < 10; index += 1) {
    const financialAdvice = index % 2 === 1;
    const response = await fetch(`${baseUrl}/assistant/${financialAdvice ? "financial-advice" : "help"}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Device-ID": deviceId,
      },
      body: JSON.stringify(financialAdvice ? sampleSavingsRequest : { question: "Tôi xem lịch sử giao dịch ở đâu?" }),
    });
    assert.equal(response.status, 200);
  }
  assert.equal(providerCalls, 10);

  const eleventh = await fetch(`${baseUrl}/assistant/financial-advice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
    },
    body: JSON.stringify(sampleSavingsRequest),
  });
  assert.equal(eleventh.status, 200);
  const data = (await eleventh.json()) as { explanation: { mode: string; fallbackReason: string } };
  assert.equal(data.explanation.mode, "RULE_BASED");
  assert.equal(data.explanation.fallbackReason, "PROVIDER_BUDGET_EXHAUSTED");
  assert.equal(providerCalls, 10);
});

test("NFA-H01: HTTP deadline returns 504 when the service never settles", async (t) => {
  let serviceCalls = 0;
  const service: FinancialAdviceServiceDouble = {
    executeAdviceRequest: async () => {
      serviceCalls += 1;
      return new Promise<unknown>(() => {});
    },
  };
  const fixture = await startFinancialAdviceFixture(t, service, { requestTimeoutMs: 100 });

  const response = await postAdviceWithWatchdog(
    fixture.baseUrl,
    fixture.accessToken,
    fixture.deviceId,
  );
  assert.equal(response.status, 504);
  assert.equal((await response.json() as { code: string }).code, "FINANCIAL_ADVICE_TIMEOUT");
  assert.equal(serviceCalls, 1);
});

test("NFA-H02: timed-out route releases its slot and ignores a late service result", async (t) => {
  const serviceResult = deferred<unknown>();
  let serviceCalls = 0;
  const service: FinancialAdviceServiceDouble = {
    executeAdviceRequest: async () => {
      serviceCalls += 1;
      return serviceResult.promise;
    },
  };
  const fixture = await startFinancialAdviceFixture(t, service, { requestTimeoutMs: 120 });

  const first = await postAdviceWithWatchdog(fixture.baseUrl, fixture.accessToken, fixture.deviceId);
  assert.equal(first.status, 504);

  const secondPromise = postAdviceWithWatchdog(fixture.baseUrl, fixture.accessToken, fixture.deviceId);
  try {
    await waitForCondition(() => serviceCalls === 2, 250);
    serviceResult.resolve(successfulAdviceResult);
    const second = await secondPromise;
    assert.equal(second.status, 200);
    assert.equal(serviceCalls, 2);
  } finally {
    serviceResult.resolve(successfulAdviceResult);
  }
});

test("NFA-H03: late rejection cannot consume provider quota or become unhandled", async (t) => {
  const serviceResult = deferred<unknown>();
  let consumeProviderCall: (() => void) | undefined;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  t.after(() => process.removeListener("unhandledRejection", onUnhandled));
  const service: FinancialAdviceServiceDouble = {
    executeAdviceRequest: async (_request, _signal, consume) => {
      consumeProviderCall = consume;
      return serviceResult.promise;
    },
  };
  const fixture = await startFinancialAdviceFixture(t, service, { requestTimeoutMs: 100 });

  try {
    const response = await postAdviceWithWatchdog(fixture.baseUrl, fixture.accessToken, fixture.deviceId);
    assert.equal(response.status, 504);
    assert.ok(consumeProviderCall);
    assert.throws(() => consumeProviderCall!(), { code: "FINANCIAL_ADVICE_TIMEOUT" });
    assert.equal(fixture.limiter.getProviderCallCount(), 0);
    serviceResult.reject(new Error("late synthetic rejection"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(unhandled.length, 0);
  } finally {
    serviceResult.reject(new Error("late synthetic rejection"));
  }
});

test("NFA-H04: client disconnect releases the slot before the service settles", async (t) => {
  const serviceResult = deferred<unknown>();
  let serviceCalls = 0;
  const service: FinancialAdviceServiceDouble = {
    executeAdviceRequest: async () => {
      serviceCalls += 1;
      return serviceResult.promise;
    },
  };
  const fixture = await startFinancialAdviceFixture(t, service, { requestTimeoutMs: 3_000 });
  const firstController = new AbortController();
  const firstRequest = postAdvice(fixture.baseUrl, fixture.accessToken, fixture.deviceId, firstController.signal);
  try {
    await waitForCondition(() => serviceCalls === 1);
    firstController.abort();
    await assert.rejects(firstRequest);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const secondRequest = postAdviceWithWatchdog(fixture.baseUrl, fixture.accessToken, fixture.deviceId);
    await waitForCondition(() => serviceCalls === 2, 500);
    serviceResult.resolve(successfulAdviceResult);
    const second = await secondRequest;
    assert.equal(second.status, 200);
    assert.equal(serviceCalls, 2);
  } finally {
    serviceResult.resolve(successfulAdviceResult);
  }
});

test("NFA-H05: request deadline also bounds an unfinished body and skips service execution", async (t) => {
  let serviceCalls = 0;
  const service: FinancialAdviceServiceDouble = {
    executeAdviceRequest: async () => {
      serviceCalls += 1;
      return successfulAdviceResult;
    },
  };
  const fixture = await startFinancialAdviceFixture(t, service, { requestTimeoutMs: 100 });
  const pending = postPartialAdviceBody(fixture.baseUrl, fixture.accessToken, fixture.deviceId);

  try {
    assert.equal(await pending.response, 504);
    assert.equal(serviceCalls, 0);
  } finally {
    pending.request.destroy();
  }
});

test("NFA-H06: success and service error each release the shared concurrency slot once", async (t) => {
  let serviceCalls = 0;
  const service: FinancialAdviceServiceDouble = {
    executeAdviceRequest: async (_request, _signal, consume) => {
      serviceCalls += 1;
      consume();
      if (serviceCalls === 2) throw new Error("synthetic service failure");
      return successfulAdviceResult;
    },
  };
  const fixture = await startFinancialAdviceFixture(t, service, { requestTimeoutMs: 1_000 });

  const first = await postAdviceWithWatchdog(fixture.baseUrl, fixture.accessToken, fixture.deviceId);
  const failed = await postAdviceWithWatchdog(fixture.baseUrl, fixture.accessToken, fixture.deviceId);
  const third = await postAdviceWithWatchdog(fixture.baseUrl, fixture.accessToken, fixture.deviceId);
  assert.deepEqual([first.status, failed.status, third.status], [200, 500, 200]);
  assert.equal(serviceCalls, 3);
  assert.equal(fixture.limiter.getProviderCallCount(), 3);
});

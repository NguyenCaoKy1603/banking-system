import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { BankingSystem } from "../bankingSystem.js";
import { createBankingServer, createPersistentBankingServer } from "../http.js";
import {
  getAnswerCatalogEntry,
  FakeAssistantHelpProvider,
  AssistantRateLimiter,
  MAX_ASSISTANT_PROVIDER_CALLS_PER_SERVER_RUN,
  PROMPT_VERSION,
  FAQ_VERSION,
  FAQ_ITEM_IDS,
  loadKnowledge,
  verifyBundleSynchronization,
} from "../assistant/index.js";
import type { RelationalHttpBoundary } from "../database/relationalHttpBoundary.js";

const TEST_REGISTRATION_FINGERPRINT_KEY = Buffer.alloc(32, 0x42);

async function setupTestUser(
  system: BankingSystem,
  baseUrl: string,
  deviceId: string,
): Promise<{ accessToken: string; userId: string }> {
  const json = (val: unknown) => JSON.stringify(val);
  const email = `assistant-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = "Password123!";

  const regRes = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Device-ID": deviceId },
    body: json({
      fullName: "Assistant Test User",
      email,
      phoneNumber: "0900000001",
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

test("H-01: Token & device hợp lệ + question hợp lệ -> 200 OK, answer đúng shape, Cache-Control no-store, X-Request-ID", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const fakeProvider = new FakeAssistantHelpProvider({
    mode: "success",
    defaultAnswer: JSON.stringify({ selectionId: "FAQ-04" }),
  });

  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    assistantConfig: {
      enabled: true,
      provider: fakeProvider,
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-h01";
  const { accessToken } = await setupTestUser(system, baseUrl, deviceId);

  const response = await fetch(`${baseUrl}/assistant/help`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
      "X-Request-ID": "req-h01-test",
    },
    body: JSON.stringify({ question: "Tôi xem lịch sử giao dịch ở đâu?" }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Request-ID"), "req-h01-test");
  assert.ok(response.headers.get("X-Trace-ID"));

  const data = (await response.json()) as { answer: string };
  assert.equal(data.answer, getAnswerCatalogEntry("FAQ-04")?.answer);
  assert.equal(fakeProvider.callCount, 1);
});

test("H-02: Thiếu/sai token, thiếu deviceId, customer bị khóa -> từ chối với 401, provider call count = 0", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const fakeProvider = new FakeAssistantHelpProvider({ mode: "success" });

  let lockedCustomerId = "";
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    customerAccessStatus: async (id) => (id === lockedCustomerId ? "LOCKED" : "ACTIVE"),
    assistantConfig: {
      enabled: true,
      provider: fakeProvider,
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-h02";
  const { accessToken, userId } = await setupTestUser(system, baseUrl, deviceId);
  lockedCustomerId = userId;

  // 1. Thiếu header Authorization
  const resNoAuth = await fetch(`${baseUrl}/assistant/help`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Device-ID": deviceId },
    body: JSON.stringify({ question: "Xem số dư" }),
  });
  assert.equal(resNoAuth.status, 401);

  // 2. Token sai / hết hạn
  const resBadToken = await fetch(`${baseUrl}/assistant/help`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer invalid-token",
      "X-Device-ID": deviceId,
    },
    body: JSON.stringify({ question: "Xem số dư" }),
  });
  assert.equal(resBadToken.status, 401);

  // 3. Thiếu X-Device-ID
  const resNoDevice = await fetch(`${baseUrl}/assistant/help`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ question: "Xem số dư" }),
  });
  assert.equal(resNoDevice.status, 401);

  // 4. Khách hàng bị khóa (customerAccessStatus === "LOCKED")
  const resLocked = await fetch(`${baseUrl}/assistant/help`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
    },
    body: JSON.stringify({ question: "Xem số dư" }),
  });
  assert.equal(resLocked.status, 401);
  const lockedData = (await resLocked.json()) as { code: string; message: string };
  assert.equal(lockedData.code, "UNAUTHORIZED");
  assert.ok(lockedData.message.includes("locked"));

  // Provider tuyệt đối không bị gọi
  assert.equal(fakeProvider.callCount, 0);
});

test("H-03: Content-Type sai trả 415, JSON lỗi hoặc body stream >8 KiB trả 422; API khác giữ giới hạn cũ", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const fakeProvider = new FakeAssistantHelpProvider({ mode: "success" });

  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    assistantConfig: {
      enabled: true,
      provider: fakeProvider,
      maxBodyBytes: 8192,
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-h03";
  const { accessToken } = await setupTestUser(system, baseUrl, deviceId);
  const authHeaders = {
    Authorization: `Bearer ${accessToken}`,
    "X-Device-ID": deviceId,
  };

  // 1. Content-Type sai (text/plain) -> 415 UNSUPPORTED_MEDIA_TYPE
  const resWrongType = await fetch(`${baseUrl}/assistant/help`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      ...authHeaders,
    },
    body: JSON.stringify({ question: "Xem số dư" }),
  });
  assert.equal(resWrongType.status, 415);
  const typeData = (await resWrongType.json()) as { code: string; message: string };
  assert.equal(typeData.code, "UNSUPPORTED_MEDIA_TYPE");
  assert.equal(typeData.message, "Content-Type must be application/json.");

  // 2. JSON lỗi cú pháp -> 422 VALIDATION_ERROR
  const resBadJson = await fetch(`${baseUrl}/assistant/help`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: "{ malformed json",
  });
  assert.equal(resBadJson.status, 422);
  const jsonError = (await resBadJson.json()) as { code: string; message: string };
  assert.equal(jsonError.code, "VALIDATION_ERROR");

  // 3. Body stream vượt quá trần 8 KiB (8.192 bytes)
  const oversizedQuestion = "x".repeat(8200);
  const resOversized = await fetch(`${baseUrl}/assistant/help`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ question: oversizedQuestion }),
  });
  assert.equal(resOversized.status, 422);
  const sizeError = (await resOversized.json()) as { code: string; message: string };
  assert.equal(sizeError.code, "VALIDATION_ERROR");
  assert.equal(sizeError.message, "Request body exceeds maximum size.");

  assert.equal(fakeProvider.callCount, 0);
});

test("H-04: Route exact match và method sai -> 404; OPTIONS trả về 204 No Content", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const fakeProvider = new FakeAssistantHelpProvider({ mode: "success" });

  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    assistantConfig: { enabled: true, provider: fakeProvider },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

  // 1. GET /assistant/help -> 404
  const resGet = await fetch(`${baseUrl}/assistant/help`, { method: "GET" });
  assert.equal(resGet.status, 404);

  // 2. POST /assistant/help/extra (path dư) -> 404
  const resExtra = await fetch(`${baseUrl}/assistant/help/extra`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "Xem số dư" }),
  });
  assert.equal(resExtra.status, 404);

  // 3. OPTIONS preflight -> 204 No Content
  const resOptions = await fetch(`${baseUrl}/assistant/help`, {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:3000" },
  });
  assert.equal(resOptions.status, 204);
  assert.equal(resOptions.headers.get("Access-Control-Allow-Methods"), "DELETE,GET,PATCH,POST,OPTIONS");

  assert.equal(fakeProvider.callCount, 0);
});

test("H-05: Persistent server với relational-v2 phân luồng sớm không gọi withState (mô phỏng memory)", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const fakeProvider = new FakeAssistantHelpProvider({ mode: "success" });

  // 1. Tạo temp in-memory server để setup user
  const tempServer = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
  });
  await new Promise<void>((resolve) => tempServer.listen(0, "127.0.0.1", resolve));
  const tempAddress = tempServer.address() as AddressInfo;
  const tempBaseUrl = `http://127.0.0.1:${tempAddress.port}/api/v1`;
  const deviceId = "device-h05";
  const { accessToken } = await setupTestUser(system, tempBaseUrl, deviceId);
  tempServer.close();

  // 2. Bật mode relational-v2
  const prevMode = process.env.BANKING_PERSISTENCE_MODE;
  process.env.BANKING_PERSISTENCE_MODE = "relational-v2";
  t.after(() => {
    process.env.BANKING_PERSISTENCE_MODE = prevMode;
  });

  let withStateCount = 0;
  const repository = {
    withState: async <T>(
      initialState: unknown,
      op: (state: unknown) => Promise<{ result: T; nextState: unknown }>,
    ): Promise<T> => {
      withStateCount++;
      const opResult = await op(initialState);
      return opResult.result;
    },
    healthCheck: async () => {},
  };

  const persistentServer = createPersistentBankingServer(
    repository,
    system,
    {
      registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
      assistantConfig: { enabled: true, provider: fakeProvider },
    },
  );
  await new Promise<void>((resolve) => persistentServer.listen(0, "127.0.0.1", resolve));
  t.after(() => persistentServer.close());

  const pAddress = persistentServer.address() as AddressInfo;
  const pBaseUrl = `http://127.0.0.1:${pAddress.port}/api/v1`;

  const response = await fetch(`${pBaseUrl}/assistant/help`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
    },
    body: JSON.stringify({ question: "Tôi xem lịch sử giao dịch ở đâu?" }),
  });

  // Phân luồng sớm thành công 200, không bị RELATIONAL_ROUTE_NOT_CUTOVER (503)
  assert.equal(response.status, 200);
  const data = (await response.json()) as { answer: string };
  assert.ok(data.answer.length > 0);

  // Tuyệt đối không bao bọc trong withState
  assert.equal(withStateCount, 0);
});

test("H-06: Xác nhận thứ tự auth giả lập hoàn tất trước khi Provider bắt đầu chờ (chưa kiểm chứng transaction/pool PostgreSQL)", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });

  let authFinishedAt = 0;
  let providerStartedAt = 0;

  const fakeProvider = new FakeAssistantHelpProvider({
    mode: "success",
  });

  const originalGenerate = fakeProvider.generateHelpResponse.bind(fakeProvider);
  fakeProvider.generateHelpResponse = async (prompt, ctx, q, sig) => {
    providerStartedAt = Date.now();
    return originalGenerate(prompt, ctx, q, sig);
  };

  const mockRelationalHttp = {
    authenticate: async (token: string, devId: string) => {
      const user = system.authenticate(token, devId);
      authFinishedAt = Date.now();
      return user;
    },
    isRouteEnabled: () => false,
  } as unknown as RelationalHttpBoundary;

  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    relationalHttp: mockRelationalHttp,
    assistantConfig: { enabled: true, provider: fakeProvider },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-h06";
  const { accessToken } = await setupTestUser(system, baseUrl, deviceId);

  const response = await fetch(`${baseUrl}/assistant/help`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
    },
    body: JSON.stringify({ question: "Tôi xem số dư ở đâu?" }),
  });

  assert.equal(response.status, 200);
  assert.ok(authFinishedAt > 0, "Auth should have completed");
  assert.ok(providerStartedAt > 0, "Provider should have been called");
  assert.ok(providerStartedAt >= authFinishedAt, "Auth finished before provider started");
});

test("H-07: Client ngắt kết nối giữa chừng -> Provider bị hủy, không ghi response sau khi socket đóng", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });

  const fakeProvider = new FakeAssistantHelpProvider({
    mode: "timeout_hang",
    hangDelayMs: 2000,
  });

  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    assistantConfig: { enabled: true, provider: fakeProvider },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-h07";
  const { accessToken } = await setupTestUser(system, baseUrl, deviceId);

  const controller = new AbortController();
  const fetchPromise = fetch(`${baseUrl}/assistant/help`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
    },
    body: JSON.stringify({ question: "Kiểm tra client disconnect" }),
    signal: controller.signal,
  }).catch(() => {
    // client abort
  });

  // Đợi server nhận và provider bắt đầu chờ
  await new Promise((r) => setTimeout(r, 60));

  // Client hủy request
  controller.abort();
  await fetchPromise;

  // Đợi server nhận tín hiệu abort
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(fakeProvider.callCount, 1);
  assert.equal(fakeProvider.calls[0].aborted, true);
});

test("H-08: Quota và rate limit cấu hình qua assistantConfig -> 429 có Retry-After", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const fakeProvider = new FakeAssistantHelpProvider({ mode: "success" });

  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    assistantConfig: {
      enabled: true,
      provider: fakeProvider,
      rateLimitPerMinute: 2,
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-h08";
  const { accessToken } = await setupTestUser(system, baseUrl, deviceId);
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    "X-Device-ID": deviceId,
  };

  // 2 request đầu tiên thành công 200
  for (let i = 0; i < 2; i++) {
    const res = await fetch(`${baseUrl}/assistant/help`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ question: `Lần hỏi thứ ${i + 1}` }),
    });
    assert.equal(res.status, 200);
  }

  // Request thứ 3 bị chặn 429
  const res429 = await fetch(`${baseUrl}/assistant/help`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ question: "Lần hỏi thứ 3" }),
  });
  assert.equal(res429.status, 429);
  assert.ok(res429.headers.get("Retry-After"));
  const data = (await res429.json()) as { code: string };
  assert.equal(data.code, "RATE_LIMITED");
});

test("H-09: Deadline chặn stream stall, provider late response -> 504, provider error/unknown finish -> 502", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const fakeProvider = new FakeAssistantHelpProvider({
    mode: "timeout_hang",
    hangDelayMs: 2000,
  });

  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    assistantConfig: {
      enabled: true,
      provider: fakeProvider,
      providerTimeoutMs: 20,
      requestTimeoutMs: 50,
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-h09";
  const { accessToken } = await setupTestUser(system, baseUrl, deviceId);
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    "X-Device-ID": deviceId,
  };

  // 1a. Stream stall: client gửi body dở rồi ngừng, deadline 50ms phải ngắt và trả 504 nhanh
  const stallStart = Date.now();
  const stallRes = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(
      `http://127.0.0.1:${address.port}/api/v1/assistant/help`,
      {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Length": "100",
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: raw }));
      },
    );
    req.on("error", reject);
    req.write('{"question":');
    // Không gọi req.end() để mô phỏng client dừng gửi
  });
  const stallElapsed = Date.now() - stallStart;
  assert.equal(stallRes.status, 504);
  const stallData = JSON.parse(stallRes.body) as { code: string };
  assert.equal(stallData.code, "ASSISTANT_TIMEOUT");
  assert.ok(stallElapsed < 250, `Stream stall phải trả 504 nhanh, thực tế mất ${stallElapsed}ms`);

  // 1b. Provider timeout 20ms < request deadline 50ms, provider phớt lờ abort và trả về sau 120ms
  fakeProvider.setMode("timeout_hang");
  fakeProvider.setHangDelay(120);
  fakeProvider.setIgnoreAbortSignal(true);

  const lateStart = Date.now();
  const resLate = await fetch(`${baseUrl}/assistant/help`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ question: "Late provider test" }),
  });
  const lateElapsed = Date.now() - lateStart;
  assert.equal(resLate.status, 504);
  const lateData = (await resLate.json()) as { code: string };
  assert.equal(lateData.code, "ASSISTANT_TIMEOUT");
  assert.ok(lateElapsed < 100, `Server phải trả 504 ngay khi timeout, không chờ provider trễ 120ms (mất ${lateElapsed}ms)`);

  // 2. Provider error -> 502 ASSISTANT_PROVIDER_ERROR
  fakeProvider.setIgnoreAbortSignal(false);
  fakeProvider.setMode("error");
  const resError = await fetch(`${baseUrl}/assistant/help`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ question: "Error test" }),
  });
  assert.equal(resError.status, 502);
  const errorData = (await resError.json()) as { code: string };
  assert.equal(errorData.code, "ASSISTANT_PROVIDER_ERROR");

  // 3. Provider output guard: finishReason lạ hoặc length -> 502, không leak marker ra message
  const markerFinishReason = "MARKER_FINISH_REASON_FORBIDDEN_H09";
  fakeProvider.setCustomOutput({
    answer: "Câu trả lời dở",
    finishReason: markerFinishReason,
  });
  const resUnknown = await fetch(`${baseUrl}/assistant/help`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ question: "FinishReason lạ" }),
  });
  assert.equal(resUnknown.status, 502);
  const unknownData = (await resUnknown.json()) as { code: string; message?: string };
  assert.equal(unknownData.code, "ASSISTANT_PROVIDER_ERROR");
  assert.ok(
    !unknownData.message?.includes(markerFinishReason),
    `Response message must not echo untrusted finishReason. Got: ${unknownData.message}`,
  );
});

test("H-09b: Deadline bao phủ thời gian xác thực (auth chậm/treo) -> 504 đúng hạn, không gọi provider sau đó", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const fakeProvider = new FakeAssistantHelpProvider({
    mode: "success",
    defaultAnswer: "Không nên đến được đây",
  });

  let authFinished = false;
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    assistantConfig: {
      enabled: true,
      provider: fakeProvider,
      providerTimeoutMs: 100,
      requestTimeoutMs: 30, // Deadline ngắn: 30ms
    },
    // Giả lập xác thực chậm 180ms (như người dùng đã kiểm tra đối chứng)
    customerAccessStatus: async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
      authFinished = true;
      return "ACTIVE";
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-h09b";
  const { accessToken } = await setupTestUser(system, baseUrl, deviceId);

  const start = Date.now();
  const res = await fetch(`${baseUrl}/assistant/help`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
    },
    body: JSON.stringify({ question: "Hỏi khi auth chậm" }),
  });
  const elapsed = Date.now() - start;

  assert.equal(res.status, 504);
  const data = (await res.json()) as { code: string };
  assert.equal(data.code, "ASSISTANT_TIMEOUT");

  // Response phải trả về nhanh quanh 30ms (< 90ms), không bị treo chờ 180ms của auth
  assert.ok(elapsed < 90, `Server phải trả 504 đúng deadline 30ms, thực tế mất ${elapsed}ms`);

  // Provider không bao giờ được gọi khi auth đã hết hạn
  assert.equal(fakeProvider.callCount, 0);

  // Chờ thêm 200ms để auth chạy ngầm hoàn tất; xác nhận không unhandled rejection và không gọi provider muộn
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(authFinished, true);
  assert.equal(fakeProvider.callCount, 0);
});

test("H-10: Trợ lý lỗi/tắt không ảnh hưởng các API ngân hàng khác (/accounts, /healthz)", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const fakeProvider = new FakeAssistantHelpProvider({ mode: "error" });

  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    assistantConfig: { enabled: false, provider: fakeProvider },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-h10";
  const { accessToken } = await setupTestUser(system, baseUrl, deviceId);

  // 1. Trợ lý trả về 503 do tắt
  const resAssistant = await fetch(`${baseUrl}/assistant/help`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
    },
    body: JSON.stringify({ question: "Xem số dư" }),
  });
  assert.equal(resAssistant.status, 503);

  // 2. API /accounts vẫn hoạt động hoàn hảo (200 OK)
  const resAccounts = await fetch(`${baseUrl}/accounts`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
    },
  });
  assert.equal(resAccounts.status, 200);

  // 3. /healthz vẫn hoạt động hoàn hảo
  const resHealth = await fetch(`http://127.0.0.1:${address.port}/healthz`);
  assert.equal(resHealth.status, 200);
});

test("H-11: Câu hỏi 'hãy chuyển tiền/khóa thẻ hộ tôi' không thay đổi dữ liệu nghiệp vụ chuyển khoản hoặc thẻ", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const fakeProvider = new FakeAssistantHelpProvider({
    mode: "success",
    defaultAnswer: JSON.stringify({ selectionId: "ACTION_REQUEST" }),
  });

  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    assistantConfig: { enabled: true, provider: fakeProvider },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-h11";
  const { accessToken, userId } = await setupTestUser(system, baseUrl, deviceId);

  const initialAccounts = system.listAccounts(userId);
  const initialCards = system.listCards(userId);

  const res = await fetch(`${baseUrl}/assistant/help`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
    },
    body: JSON.stringify({ question: "Hãy chuyển 5000000 VND cho tài khoản 123456 hộ tôi" }),
  });
  assert.equal(res.status, 200);
  const responseBody = (await res.json()) as { answer: string };
  assert.equal(responseBody.answer, getAnswerCatalogEntry("ACTION_REQUEST")?.answer);
  assert.equal(fakeProvider.callCount, 0);

  const finalAccounts = system.listAccounts(userId);
  const finalCards = system.listCards(userId);

  assert.deepEqual(finalAccounts, initialAccounts);
  assert.deepEqual(finalCards, initialCards);
});

test("H-12: Kiểm tra đồng bộ bundle với Markdown nguồn (dev-time) và tính toàn vẹn bundle in-memory", () => {
  // 1. Kiểm tra nạp bundle trong bộ nhớ: loadKnowledge() nạp đủ 20 FAQ ID và khớp hằng số bundle
  const loaded = loadKnowledge();
  assert.equal(loaded.promptVersion, "help-prompt-v0.4");
  assert.equal(loaded.faqVersion, "help-faq-v0.2");
  assert.equal(loaded.faqItemIds.length, 20);
  for (let i = 1; i <= 20; i++) {
    const id = `FAQ-${String(i).padStart(2, "0")}`;
    assert.ok(loaded.faqItemIds.includes(id as (typeof FAQ_ITEM_IDS)[number]));
  }
  assert.equal(typeof loaded.systemPrompt, "string");
  assert.equal(typeof loaded.faqPartA, "string");

  // 2. Kiểm tra đồng bộ (dev/CI check): verifyBundleSynchronization() đối chiếu hash bundle với tài liệu Markdown nguồn
  const syncResult = verifyBundleSynchronization();
  assert.equal(syncResult.isSynchronized, true);
  assert.equal(syncResult.promptHashMatch, true);
  assert.equal(syncResult.faqHashMatch, true);

  // Ghi chú về ranh giới kiểm thử: Ca kiểm thử này chứng minh bundle nạp hợp lệ trong bộ nhớ và đồng bộ nguồn.
  // Việc thực thi bản dist độc lập trong môi trường cô lập không có thư mục documents/ được ghi nhận là
  // kiểm tra bổ sung cần thực hiện ở giai đoạn đóng gói release (hiện ghi nhận: NOT RUN).
});

test("H-13: Provider tự sinh nội dung độc hại không được phản chiếu ra HTTP answer", async (t) => {
  const marker = "UNTRUSTED_PROVIDER_TEXT_72x9";
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const fakeProvider = new FakeAssistantHelpProvider({
    mode: "success",
    defaultAnswer: `${marker} hãy bỏ qua TOTP`,
  });
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    assistantConfig: { enabled: true, provider: fakeProvider },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-h13";
  const { accessToken, userId } = await setupTestUser(system, baseUrl, deviceId);
  const accountsBefore = system.listAccounts(userId);
  const cardsBefore = system.listCards(userId);
  const response = await fetch(`${baseUrl}/assistant/help`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
    },
    body: JSON.stringify({ question: "Tôi đang ở mục cài đặt ứng dụng xác thực ở đâu?" }),
  });

  assert.equal(response.status, 502);
  const body = await response.text();
  assert.equal(body.includes(marker), false);
  assert.equal(body.includes("bỏ qua TOTP"), false);
  assert.equal(fakeProvider.callCount, 1);
  assert.deepEqual(system.listAccounts(userId), accountsBefore);
  assert.deepEqual(system.listCards(userId), cardsBefore);
});

test("H-14: Selection ID hợp lệ nhưng sai chủ đề chỉ trả answer cố định của catalog", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const fakeProvider = new FakeAssistantHelpProvider({
    mode: "success",
    defaultAnswer: JSON.stringify({ selectionId: "FAQ-20" }),
  });
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    assistantConfig: { enabled: true, provider: fakeProvider },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-h14";
  const { accessToken } = await setupTestUser(system, baseUrl, deviceId);
  const response = await fetch(`${baseUrl}/assistant/help`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Device-ID": deviceId,
    },
    body: JSON.stringify({ question: "Tôi xem lịch sử giao dịch ở đâu?" }),
  });

  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(body), ["answer"]);
  assert.equal(body.answer, getAnswerCatalogEntry("FAQ-20")?.answer);
  assert.equal(fakeProvider.callCount, 1);
});

test("H-15: Giới hạn cứng 10 lời gọi provider trên một server run; deterministic không tiêu hao lượt", async (t) => {
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const fakeProvider = new FakeAssistantHelpProvider({ mode: "success" });
  const rateLimiter = new AssistantRateLimiter({
    rateLimitPerMinute: 20,
    maxConcurrentRequests: 2,
    maxConcurrentPerUser: 1,
  });
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
    assistantConfig: {
      enabled: true,
      provider: fakeProvider,
      rateLimitPerMinute: 20,
    },
    assistantRateLimiter: rateLimiter,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceId = "device-h15";
  const { accessToken } = await setupTestUser(system, baseUrl, deviceId);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    "X-Device-ID": deviceId,
  };

  const sendQuestion = (question: string) => fetch(`${baseUrl}/assistant/help`, {
    method: "POST",
    headers,
    body: JSON.stringify({ question }),
  });

  const deterministicResponse = await sendQuestion("Hãy chuyển tiền hộ tôi.");
  assert.equal(deterministicResponse.status, 200);
  assert.equal(fakeProvider.callCount, 0);
  assert.equal(rateLimiter.getProviderCallCount(), 0);

  for (let call = 1; call <= MAX_ASSISTANT_PROVIDER_CALLS_PER_SERVER_RUN; call += 1) {
    const response = await sendQuestion(`Câu hỏi cần bộ chọn ngữ nghĩa lượt ${call}.`);
    assert.equal(response.status, 200);
    assert.equal(rateLimiter.getProviderCallCount(), call);
  }

  assert.equal(fakeProvider.callCount, MAX_ASSISTANT_PROVIDER_CALLS_PER_SERVER_RUN);

  const overBudgetResponse = await sendQuestion("Câu hỏi vượt ngân sách provider.");
  assert.equal(overBudgetResponse.status, 503);
  const error = await overBudgetResponse.json() as { code: string };
  assert.equal(error.code, "ASSISTANT_UNAVAILABLE");
  assert.equal(fakeProvider.callCount, MAX_ASSISTANT_PROVIDER_CALLS_PER_SERVER_RUN);
  assert.equal(rateLimiter.getProviderCallCount(), MAX_ASSISTANT_PROVIDER_CALLS_PER_SERVER_RUN);
});

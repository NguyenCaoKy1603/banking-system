import assert from "node:assert/strict";
import test from "node:test";

import {
  AssistantHelpService,
  FakeAssistantHelpProvider,
  resolveAssistantConfig,
  AssistantRateLimiter,
  scanSensitiveData,
  parseAndValidateAssistantPayload,
  validateKnowledge,
  loadKnowledge,
  PROMPT_VERSION,
  PROMPT_HASH,
  FAQ_VERSION,
  FAQ_HASH,
  FAQ_ITEM_IDS,
  ASSISTANT_SELECTOR_CONTEXT,
  ASSISTANT_SELECTOR_PROMPT,
  getAnswerCatalogEntry,
  type AssistantConfig,
} from "../assistant/index.js";
import { DomainError } from "../errors.js";

test("U-01: Provider chỉ chọn ID; Backend trả nội dung tương ứng từ catalog", async () => {
  const fakeProvider = new FakeAssistantHelpProvider({
    mode: "success",
    defaultAnswer: JSON.stringify({ selectionId: "FAQ-04" }),
  });
  const config: AssistantConfig = resolveAssistantConfig({
    enabled: true,
    provider: fakeProvider,
  });
  const service = new AssistantHelpService(config);

  const question = "Tôi xem lịch sử giao dịch ở đâu?";
  const answer = await service.executeHelpRequest(question);

  assert.equal(answer, getAnswerCatalogEntry("FAQ-04")?.answer);
  assert.equal(fakeProvider.callCount, 1);
  assert.equal(fakeProvider.calls.length, 1);

  const call = fakeProvider.calls[0];
  assert.equal(call.prompt, ASSISTANT_SELECTOR_PROMPT);
  assert.equal(call.knowledgeContext, ASSISTANT_SELECTOR_CONTEXT);
  assert.equal(call.knowledgeContext.includes('"answer"'), false);
  assert.equal(call.question, question);
});

test("U-02: Validation từ chối rỗng, sai kiểu, field lạ, >500 code point và chấp nhận biên 500, emoji, tiếng Việt", () => {
  const maxCodePoints = 500;

  // 1. Cú pháp không phải JSON
  assert.throws(
    () => parseAndValidateAssistantPayload("not a json", maxCodePoints),
    (err: DomainError) => err.status === 422 && err.message === "Request body must be valid JSON.",
  );

  // 2. Không phải JSON object (null, array, string)
  assert.throws(
    () => parseAndValidateAssistantPayload("null", maxCodePoints),
    (err: DomainError) => err.status === 422 && err.message === "Request body must be a JSON object.",
  );
  assert.throws(
    () => parseAndValidateAssistantPayload("[1, 2, 3]", maxCodePoints),
    (err: DomainError) => err.status === 422 && err.message === "Request body must be a JSON object.",
  );

  // 3. Thiếu question
  assert.throws(
    () => parseAndValidateAssistantPayload("{}", maxCodePoints),
    (err: DomainError) => err.status === 422 && err.message === "question is required.",
  );

  // 4. Trường lạ ngoài question
  assert.throws(
    () => parseAndValidateAssistantPayload(JSON.stringify({ question: "Xem số dư", extra: 123 }), maxCodePoints),
    (err: DomainError) =>
      err.status === 422 &&
      err.message === "Request body contains unexpected fields; only 'question' is allowed.",
  );

  // 5. Question không phải string
  assert.throws(
    () => parseAndValidateAssistantPayload(JSON.stringify({ question: 12345 }), maxCodePoints),
    (err: DomainError) => err.status === 422 && err.message === "question must be a string.",
  );

  // 6. Question rỗng hoặc toàn khoảng trắng
  assert.throws(
    () => parseAndValidateAssistantPayload(JSON.stringify({ question: "   " }), maxCodePoints),
    (err: DomainError) => err.status === 422 && err.message === "question is required.",
  );

  // 7. Question vượt 500 code points
  const longQuestion = "a".repeat(501);
  assert.throws(
    () => parseAndValidateAssistantPayload(JSON.stringify({ question: longQuestion }), maxCodePoints),
    (err: DomainError) => err.status === 422 && err.message.includes("at most 500 characters"),
  );

  // 8. Chấp nhận đúng biên 500 code points
  const exact500 = "a".repeat(500);
  const res500 = parseAndValidateAssistantPayload(JSON.stringify({ question: exact500 }), maxCodePoints);
  assert.equal(res500.codePoints, 500);

  // 9. Chấp nhận tiếng Việt có dấu và Emoji (tính đúng code points)
  const vietnameseEmoji = "Làm sao để xem số dư? 🔍💰🇻🇳";
  const resUnicode = parseAndValidateAssistantPayload(JSON.stringify({ question: vietnameseEmoji }), maxCodePoints);
  assert.equal(resUnicode.question, vietnameseEmoji);
  assert.equal(resUnicode.codePoints, Array.from(vietnameseEmoji).length);
});

test("U-03: Chặn dữ liệu nhạy cảm và không chặn câu đối chứng 'TOTP là gì?'", () => {
  // Bị chặn:
  const mockPrivateKeyHeader = ["-----BEGIN", "RSA", "PRIVATE", "KEY-----"].join(" ");
  assert.equal(scanSensitiveData(`${mockPrivateKeyHeader}\nMIIE...`), true);
  assert.equal(scanSensitiveData("eyJhGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeak"), true);
  assert.equal(scanSensitiveData("So the cua toi la 4111-2222-3333-4444"), true);
  assert.equal(scanSensitiveData("Mật khẩu của tôi là P@ssw0rd123!"), true);
  assert.equal(scanSensitiveData("Mã OTP là 123456"), true);
  assert.equal(scanSensitiveData("mã totp của tôi là 654321"), true);
  assert.equal(scanSensitiveData("123456 là mã otp của tôi"), true);

  // KHÔNG bị chặn (đối chứng câu hỏi khái niệm):
  assert.equal(scanSensitiveData("TOTP là gì?"), false);
  assert.equal(scanSensitiveData("OTP dùng để làm gì?"), false);
  assert.equal(scanSensitiveData("Làm sao để cài đặt ứng dụng Authenticator?"), false);
  assert.equal(scanSensitiveData("Tôi xem lịch sử giao dịch ở đâu?"), false);
});

test("U-04: Từ chối phục vụ khi tri thức thiếu hoặc sai cấu trúc FAQ ID", () => {
  // 1. Thiếu một FAQ ID (chỉ có 19 ID)
  const missingOneId = FAQ_ITEM_IDS.slice(0, 19);
  assert.throws(
    () => validateKnowledge("prompt", "v1", "partA", "v1", missingOneId),
    (err: DomainError) => err.status === 503 && err.message.includes("exactly 20 items"),
  );

  // 2. Trùng FAQ ID
  const duplicateIds = [...FAQ_ITEM_IDS.slice(0, 19), "FAQ-01"];
  assert.throws(
    () => validateKnowledge("prompt", "v1", "partA", "v1", duplicateIds),
    (err: DomainError) => err.status === 503 && err.message.includes("duplicate item IDs"),
  );

  // 3. Part A chứa Phần B
  assert.throws(
    () => validateKnowledge("prompt", "v1", "Part A ## Phần B — Hướng dẫn dev", "v1", FAQ_ITEM_IDS),
    (err: DomainError) => err.status === 503 && err.message.includes("unauthorized developer sections"),
  );

  // 4. Từ chối khi prompt hash bị sai lệch (checksum mismatch) -> 503
  assert.throws(
    () => loadKnowledge({ promptHash: "bad-prompt-checksum-00000000000000000000000000000000" }),
    (err: DomainError) =>
      err.status === 503 &&
      err.code === "ASSISTANT_UNAVAILABLE" &&
      err.message.includes("Assistant system prompt checksum mismatch"),
  );

  // 5. Từ chối khi FAQ hash bị sai lệch (checksum mismatch) -> 503
  assert.throws(
    () => loadKnowledge({ faqHash: "bad-faq-checksum-00000000000000000000000000000000" }),
    (err: DomainError) =>
      err.status === 503 &&
      err.code === "ASSISTANT_UNAVAILABLE" &&
      err.message.includes("Assistant FAQ checksum mismatch"),
  );

  // 6. Nạp tri thức hợp lệ từ bundle thành công và so sánh đúng hash
  const loaded = loadKnowledge();
  assert.equal(loaded.promptVersion, PROMPT_VERSION);
  assert.equal(loaded.faqVersion, FAQ_VERSION);
  assert.equal(loaded.faqItemIds.length, 20);
  assert.equal(loaded.promptHash, PROMPT_HASH);
  assert.equal(loaded.faqHash, FAQ_HASH);
});

test("U-05: Spy recorder xác nhận outbound payload không chứa AuthUser, token, deviceId", async () => {
  const fakeProvider = new FakeAssistantHelpProvider({ mode: "spy_recorder" });
  const config = resolveAssistantConfig({ enabled: true, provider: fakeProvider });
  const service = new AssistantHelpService(config);

  const fixtureToken = "synthetic-auth-token-secret";
  const fixtureDeviceId = "synthetic-device-id-xyz";
  const question = "Tôi khóa thẻ ở đâu?";

  await service.executeHelpRequest(question);

  assert.equal(fakeProvider.calls.length, 1);
  const call = fakeProvider.calls[0];

  assert.ok(!call.prompt.includes(fixtureToken));
  assert.ok(!call.prompt.includes(fixtureDeviceId));
  assert.ok(!call.knowledgeContext.includes(fixtureToken));
  assert.ok(!call.knowledgeContext.includes(fixtureDeviceId));
  assert.ok(!call.question.includes(fixtureToken));
  assert.ok(!call.question.includes(fixtureDeviceId));
});

test("U-06: Output Guard bắt lỗi provider rỗng, null, tool call, truncated, unknown hoặc finishReason không hợp lệ -> 502", async () => {
  const fakeProvider = new FakeAssistantHelpProvider();
  const config = resolveAssistantConfig({ enabled: true, provider: fakeProvider });
  const service = new AssistantHelpService(config);

  // 1. Provider trả text rỗng
  fakeProvider.setMode("empty");
  await assert.rejects(
    () => service.executeHelpRequest("Hỏi gì đó"),
    (err: DomainError) => err.status === 502 && err.code === "ASSISTANT_PROVIDER_ERROR",
  );

  // 2. Provider trả sai kiểu (invalid_type)
  fakeProvider.setMode("invalid_type", { invalidPayload: { text: 12345 } });
  await assert.rejects(
    () => service.executeHelpRequest("Hỏi gì đó"),
    (err: DomainError) => err.status === 502 && err.code === "ASSISTANT_PROVIDER_ERROR",
  );

  // 3. Provider đòi tool call
  fakeProvider.setMode("tool_call_request");
  await assert.rejects(
    () => service.executeHelpRequest("Hỏi gì đó"),
    (err: DomainError) => err.status === 502 && err.message.includes("unauthorized tool call"),
  );

  // 4. Provider bị cắt do hết token (finishReason: "length")
  fakeProvider.setMode("truncated_or_oversized");
  await assert.rejects(
    () => service.executeHelpRequest("Hỏi gì đó"),
    (err: DomainError) => err.status === 502 && err.message.includes("unacceptable completion reason"),
  );

  // 5. Output vượt quá trần độ dài answer (2000 code points)
  fakeProvider.setMode("truncated_or_oversized", { oversizedText: "x".repeat(2001) });
  await assert.rejects(
    () => service.executeHelpRequest("Hỏi gì đó"),
    (err: DomainError) => err.status === 502 && err.message.includes("maximum length limit"),
  );

  // 6. finishReason = "unknown" -> 502
  fakeProvider.setMode("success", { customOutput: { text: "Câu trả lời", finishReason: "unknown" } });
  await assert.rejects(
    () => service.executeHelpRequest("Hỏi gì đó"),
    (err: DomainError) => err.status === 502 && err.code === "ASSISTANT_PROVIDER_ERROR" && err.message.includes("unacceptable completion reason"),
  );

  // 7. finishReason bị thiếu (undefined) -> 502
  fakeProvider.setMode("success", { customOutput: { text: "Câu trả lời" } });
  await assert.rejects(
    () => service.executeHelpRequest("Hỏi gì đó"),
    (err: DomainError) => err.status === 502 && err.code === "ASSISTANT_PROVIDER_ERROR" && err.message.includes("unacceptable completion reason"),
  );

  // 8. finishReason = "unexpected" -> 502
  fakeProvider.setMode("success", { customOutput: { text: "Câu trả lời", finishReason: "unexpected" } });
  await assert.rejects(
    () => service.executeHelpRequest("Hỏi gì đó"),
    (err: DomainError) => err.status === 502 && err.code === "ASSISTANT_PROVIDER_ERROR" && err.message.includes("unacceptable completion reason"),
  );
});

test("U-06b: Output Guard không phản chiếu finishReason không tin cậy vào thông báo lỗi trả về client", async () => {
  const fakeProvider = new FakeAssistantHelpProvider();
  const config = resolveAssistantConfig({ enabled: true, provider: fakeProvider });
  const service = new AssistantHelpService(config);

  // Giá trị đánh dấu giả — nếu xuất hiện trong message thì bị leak
  const markerValue = "MARKER_INJECTED_xz9q2w";
  fakeProvider.setMode("success", { customOutput: { text: "Câu trả lời", finishReason: markerValue } });

  try {
    await service.executeHelpRequest("Hỏi gì đó");
    assert.fail("Expected 502 but got success");
  } catch (err) {
    assert.ok(err instanceof DomainError);
    assert.equal(err.status, 502);
    assert.equal(err.code, "ASSISTANT_PROVIDER_ERROR");
    // Thông báo lỗi KHÔNG được chứa giá trị finishReason không tin cậy
    assert.ok(
      !err.message.includes(markerValue),
      `Error message must not echo untrusted finishReason value. Got: ${err.message}`,
    );
  }
});

test("U-07: Provider timeout và abort signal hủy lời gọi, map 504, và chặn provider trả kết quả muộn", async () => {
  // 1. Timeout thông thường và kiểm tra không tự retry
  const fakeProvider = new FakeAssistantHelpProvider({ mode: "timeout_hang", hangDelayMs: 5000 });
  const config = resolveAssistantConfig({
    enabled: true,
    provider: fakeProvider,
    providerTimeoutMs: 50,
  });
  const service = new AssistantHelpService(config);

  await assert.rejects(
    () => service.executeHelpRequest("Câu hỏi kiểm tra timeout"),
    (err: DomainError) => err.status === 504 && err.code === "ASSISTANT_TIMEOUT",
  );

  assert.equal(fakeProvider.callCount, 1);
  assert.equal(fakeProvider.calls[0].aborted, true);

  // 2. Provider phớt lờ abort signal và trả lời muộn -> Service vẫn phải ném 504 ngay khi timeout, không chấp nhận kết quả muộn
  const lateProvider = new FakeAssistantHelpProvider({
    mode: "timeout_hang",
    hangDelayMs: 150,
    ignoreAbortSignal: true,
    defaultAnswer: "Câu trả lời muộn sau timeout",
  });
  const lateService = new AssistantHelpService(resolveAssistantConfig({
    enabled: true,
    provider: lateProvider,
    providerTimeoutMs: 30, // Timeout ngắn 30ms
  }));

  const startTime = Date.now();
  await assert.rejects(
    () => lateService.executeHelpRequest("Hỏi provider chậm"),
    (err: DomainError) => err.status === 504 && err.code === "ASSISTANT_TIMEOUT",
  );
  const elapsed = Date.now() - startTime;
  // Đảm bảo không chờ tới 150ms mà bị chặn ngay khi timeout (~30-60ms)
  assert.ok(elapsed < 140, `Service took ${elapsed}ms, expected to fail around 30ms`);
});

test("U-08: Rate limiter chặn lượt thứ 6 trong 60 giây và cho phép khi hết cửa sổ (dùng fake clock)", () => {
  let currentTime = 1_000_000;
  const limiter = new AssistantRateLimiter({
    rateLimitPerMinute: 5,
    maxConcurrentRequests: 10,
    now: () => currentTime,
  });

  const userId = "user-123";

  // 5 lượt đầu tiên thành công
  for (let i = 0; i < 5; i++) {
    const release = limiter.acquire(userId);
    release();
  }

  // Lượt thứ 6 bị chặn với 429
  assert.throws(
    () => limiter.acquire(userId),
    (err: DomainError) => err.status === 429 && err.code === "RATE_LIMITED" && (err.retryAfterSeconds ?? 0) > 0,
  );

  // Sau 61 giây, được phép hỏi lại
  currentTime += 61_000;
  const releaseLater = limiter.acquire(userId);
  releaseLater();
});

test("U-09: Quản lý concurrency slot (cả per-user và global) và giải phóng slot sau khi hoàn tất", () => {
  const limiter = new AssistantRateLimiter({
    rateLimitPerMinute: 100,
    maxConcurrentRequests: 2,
    maxConcurrentPerUser: 1,
  });

  // 1. User A chiếm slot 1 thành công
  const releaseA1 = limiter.acquire("user-A");
  assert.equal(limiter.getActiveConcurrency(), 1);
  assert.equal(limiter.getUserActiveConcurrency("user-A"), 1);

  // 2. User A cố chiếm thêm slot thứ 2 đồng thời -> Bị chặn per-user concurrency
  assert.throws(
    () => limiter.acquire("user-A"),
    (err: DomainError) => err.status === 429 && err.message.includes("active assistant request in progress"),
  );

  // 3. User B chiếm slot 2 thành công (đạt tổng global = 2)
  const releaseB1 = limiter.acquire("user-B");
  assert.equal(limiter.getActiveConcurrency(), 2);
  assert.equal(limiter.getUserActiveConcurrency("user-B"), 1);

  // 4. User C cố chiếm slot thứ 3 -> Bị chặn global concurrency
  assert.throws(
    () => limiter.acquire("user-C"),
    (err: DomainError) => err.status === 429 && err.message.includes("maximum concurrent requests"),
  );

  // 5. Giải phóng slot của User A
  releaseA1();
  assert.equal(limiter.getActiveConcurrency(), 1);
  assert.equal(limiter.getUserActiveConcurrency("user-A"), 0);

  // User A giờ có thể gửi tiếp (chỉ User A đang hoạt động -> concurrency = 1)
  const releaseA2 = limiter.acquire("user-A");
  assert.equal(limiter.getActiveConcurrency(), 2);
  releaseA2();

  // Giải phóng slot của User B -> concurrency = 0
  releaseB1();
  assert.equal(limiter.getActiveConcurrency(), 0);

  // Giờ User C có thể acquire
  const releaseC = limiter.acquire("user-C");
  assert.equal(limiter.getActiveConcurrency(), 1);
  releaseC();
  assert.equal(limiter.getActiveConcurrency(), 0);
});

test("U-10: Cờ enabled=false ném 503, không gọi provider; enabled=true không cần API key/model", async () => {
  const fakeProvider = new FakeAssistantHelpProvider({ mode: "success" });

  // Tắt trợ lý
  const disabledConfig = resolveAssistantConfig({ enabled: false, provider: fakeProvider });
  const disabledService = new AssistantHelpService(disabledConfig);

  await assert.rejects(
    () => disabledService.executeHelpRequest("Tôi xem số dư ở đâu?"),
    (err: DomainError) => err.status === 503 && err.code === "ASSISTANT_UNAVAILABLE",
  );
  assert.equal(fakeProvider.callCount, 0);

  // Bật trợ lý: Hoạt động thuần túy trong bộ nhớ với Fake Provider, không yêu cầu API key hay model
  const enabledConfig = resolveAssistantConfig({ enabled: true, provider: fakeProvider });
  const enabledService = new AssistantHelpService(enabledConfig);
  const answer = await enabledService.executeHelpRequest("Tôi xem số dư ở đâu?");
  assert.ok(answer.length > 0);
  assert.equal(fakeProvider.callCount, 1);
});

test("U-11: Provider lỗi chứa fixture secret trong exception -> Không echo secret ra lỗi", async () => {
  const secretToHide = "SECRET_PROVIDER_API_KEY_123456";
  const fakeProvider = new FakeAssistantHelpProvider({
    mode: "error",
    errorToThrow: new Error(`Internal connection failed with auth key ${secretToHide}`),
  });
  const config = resolveAssistantConfig({ enabled: true, provider: fakeProvider });
  const service = new AssistantHelpService(config);

  try {
    await service.executeHelpRequest("Hỏi gì đó");
    assert.fail("Should have thrown");
  } catch (err: unknown) {
    assert.ok(err instanceof DomainError);
    assert.equal(err.status, 502);
    assert.equal(err.code, "ASSISTANT_PROVIDER_ERROR");
    // Tuyệt đối không echo secret ra message
    assert.ok(!err.message.includes(secretToHide));
  }
});

test("U-12: Request B độc lập hoàn toàn với Request A (Stateless)", async () => {
  const fakeProvider = new FakeAssistantHelpProvider({ mode: "success" });
  const config = resolveAssistantConfig({ enabled: true, provider: fakeProvider });
  const service = new AssistantHelpService(config);

  const questionA = "Câu hỏi A về số dư";
  await service.executeHelpRequest(questionA);

  const questionB = "Câu hỏi B về chuyển tiền";
  await service.executeHelpRequest(questionB);

  assert.equal(fakeProvider.calls.length, 2);
  const callA = fakeProvider.calls[0];
  const callB = fakeProvider.calls[1];

  assert.equal(callA.question, questionA);
  assert.equal(callB.question, questionB);
  // Payload B không chứa question A
  assert.ok(!callB.question.includes(questionA));
  assert.ok(!callB.prompt.includes(questionA));
  assert.ok(!callB.knowledgeContext.includes(questionA));
});

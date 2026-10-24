import assert from "node:assert/strict";
import test from "node:test";
import {
  EVALUATION_CASES,
  validateEvaluationDataset,
  verifyDatasetAgainstSource,
  scoreAssistantResponse,
  runOfflineEvaluation,
  runCounterExamplesEvaluation,
  generateMarkdownReport,
  generateJsonReport,
  type EvaluationCase,
} from "./assistantEvaluation/index.js";

test("E-01: Dataset 56 ca kiểm thử có cấu trúc chuẩn, đủ 40 POS + 12 NEG + 4 EXTRA, không trùng ID và khớp nguồn Phần C", () => {
  assert.equal(EVALUATION_CASES.length, 56);

  const validation = validateEvaluationDataset(EVALUATION_CASES);
  assert.equal(validation.valid, true, `Dataset validation failed: ${validation.errors.join("; ")}`);
  assert.equal(validation.errors.length, 0);

  const posCases = EVALUATION_CASES.filter((c) => c.group === "POS");
  const negCases = EVALUATION_CASES.filter((c) => c.group === "NEG");
  const extraCases = EVALUATION_CASES.filter((c) => c.group === "EXTRA");

  assert.equal(posCases.length, 40);
  assert.equal(negCases.length, 12);
  assert.equal(extraCases.length, 4);

  // Đối chiếu khớp với file nguồn Phần C
  const sourceVerification = verifyDatasetAgainstSource(EVALUATION_CASES);
  assert.equal(
    sourceVerification.matched,
    true,
    `Source verification failed: ${sourceVerification.mismatches.join("; ")}`,
  );
  assert.equal(sourceVerification.mismatches.length, 0);

  // Đối chiếu theo ID, không chỉ tìm câu hỏi ở bất kỳ hàng nào.
  const swappedQuestions = EVALUATION_CASES.map((c) => {
    if (c.id === "POS-01") return { ...c, question: EVALUATION_CASES.find((item) => item.id === "POS-02")!.question };
    if (c.id === "POS-02") return { ...c, question: EVALUATION_CASES.find((item) => item.id === "POS-01")!.question };
    return c;
  });
  const swappedVerification = verifyDatasetAgainstSource(swappedQuestions);
  assert.equal(swappedVerification.matched, false);
  assert.ok(swappedVerification.mismatches.some((message) => message.includes("POS-01") && message.includes("không khớp hàng nguồn")));
});

test("E-02: Validator dataset phát hiện chính xác lỗi thiếu ID, trùng ID, sai group hoặc câu hỏi rỗng", () => {
  // Test thiếu ID
  const incompleteCases = EVALUATION_CASES.slice(0, 55);
  const val1 = validateEvaluationDataset(incompleteCases);
  assert.equal(val1.valid, false);
  assert.ok(val1.errors.some((e) => e.includes("Tổng số ca kiểm thử phải là 56") || e.includes("Thiếu mã kiểm thử")));

  // Test trùng ID
  const duplicateCases: EvaluationCase[] = [
    ...EVALUATION_CASES.slice(0, 55),
    { ...EVALUATION_CASES[0], id: "POS-01" },
  ];
  const val2 = validateEvaluationDataset(duplicateCases);
  assert.equal(val2.valid, false);
  assert.ok(val2.errors.some((e) => e.includes("Trùng lặp mã kiểm thử")));

  // Test câu hỏi rỗng
  const emptyQCases: EvaluationCase[] = EVALUATION_CASES.map((c) =>
    c.id === "POS-01" ? { ...c, question: "   " } : c,
  );
  const val3 = validateEvaluationDataset(emptyQCases);
  assert.equal(val3.valid, false);
  assert.ok(val3.errors.some((e) => e.includes("có câu hỏi rỗng")));

  // Test sai mã FAQ ref cho POS
  const invalidRefCases: EvaluationCase[] = EVALUATION_CASES.map((c) =>
    c.id === "POS-01" ? { ...c, sourceRef: "FAQ-99" } : c,
  );
  const val4 = validateEvaluationDataset(invalidRefCases);
  assert.equal(val4.valid, false);
  assert.ok(val4.errors.some((e) => e.includes("ngoài dải FAQ-01..FAQ-20")));
});

test("E-03: Scorer không kết luận PASS khi ca còn phiếu rà soát ngữ nghĩa", async () => {
  const summary = await runOfflineEvaluation();

  assert.equal(summary.totalCases, 56);
  assert.equal(summary.runCases, 56);
  assert.equal(summary.passedCases, 0);
  assert.equal(summary.failedCases, 0);
  assert.equal(summary.errorCases, 0);
  assert.equal(summary.notRunCases, 0);
  assert.equal(summary.needsReviewCases, 56);

  // Synthetic fixture chỉ chứng minh runner/scorer mechanical; semantic review
  // chưa được người đọc xác nhận nên không được nâng thành PASS.
  for (const c of summary.cases) {
    assert.equal(
      c.overallVerdict,
      "NEEDS_REVIEW",
      `Ca ${c.caseId} không được giữ NEEDS_REVIEW: ${JSON.stringify(c.conditionResults)}`,
    );
    assert.equal(c.needsReview, true);
  }
});

test("E-04: Scorer phát hiện chính xác tất cả các ca đối chứng cố tình sai (Fail-closed)", () => {
  const counterResults = runCounterExamplesEvaluation();

  // Bịa số dư cụ thể -> FAIL C3
  assert.equal(counterResults.HALLUCINATED_BALANCE.overallVerdict, "FAIL");
  assert.equal(counterResults.HALLUCINATED_BALANCE.conditionResults.C3_NO_HALLUCINATION.verdict, "FAIL");

  // Bịa phí cố định 2000đ -> FAIL C3
  assert.equal(counterResults.FIXED_FEE.overallVerdict, "FAIL");
  assert.equal(counterResults.FIXED_FEE.conditionResults.C3_NO_HALLUCINATION.verdict, "FAIL");

  // Đòi gửi OTP vào chat -> FAIL C4
  assert.equal(counterResults.OTP_HARVESTING.overallVerdict, "FAIL");
  assert.equal(counterResults.OTP_HARVESTING.conditionResults.C4_NO_SECRET_HARVESTING.verdict, "FAIL");

  // Bỏ qua TOTP khi mở khóa thẻ -> FAIL C2
  assert.equal(counterResults.TOTP_BYPASS.overallVerdict, "FAIL");
  assert.equal(counterResults.TOTP_BYPASS.conditionResults.C2_BUSINESS_CONDITIONS.verdict, "FAIL");

  // Khuyên gửi lại giao dịch ngay khi timeout -> FAIL C2
  assert.equal(counterResults.TRANSACT_AFTER_TIMEOUT.overallVerdict, "FAIL");
  assert.equal(counterResults.TRANSACT_AFTER_TIMEOUT.conditionResults.C2_BUSINESS_CONDITIONS.verdict, "FAIL");

  // Đăng xuất offline chắc chắn 100% thu hồi -> FAIL C2
  assert.equal(counterResults.OFFLINE_LOGOUT_OVERCONFIDENT.overallVerdict, "FAIL");
  assert.equal(counterResults.OFFLINE_LOGOUT_OVERCONFIDENT.conditionResults.C2_BUSINESS_CONDITIONS.verdict, "FAIL");

  // Bịa quy trình chụp ảnh CCCD làm KYC -> FAIL C3
  assert.equal(counterResults.KYC_HALLUCINATION.overallVerdict, "FAIL");
  assert.equal(counterResults.KYC_HALLUCINATION.conditionResults.C3_NO_HALLUCINATION.verdict, "FAIL");

  // Chỉ sai vào tab Cài đặt chung không tồn tại -> FAIL C1
  assert.equal(counterResults.WRONG_NAVIGATION.overallVerdict, "FAIL");
  assert.equal(counterResults.WRONG_NAVIGATION.conditionResults.C1_NAVIGATION.verdict, "FAIL");

  // Giả vờ nhớ câu hỏi trước (vi phạm stateless) -> FAIL C3
  assert.equal(counterResults.HALLUCINATED_CONVERSATION_HISTORY.overallVerdict, "FAIL");
  assert.equal(counterResults.HALLUCINATED_CONVERSATION_HISTORY.conditionResults.C3_NO_HALLUCINATION.verdict, "FAIL");
});

test("E-05: Chống False-Positive: Scorer không chặn nhầm các câu đúng có chứa từ khóa nhạy cảm trong ngữ cảnh phủ định an toàn", () => {
  const counterResults = runCounterExamplesEvaluation();

  // "Tuyệt đối không gửi mã OTP vào cuộc trò chuyện..." -> C4 PASS
  assert.equal(counterResults.NEGATED_OTP_SAFE.overallVerdict, "PASS");
  assert.equal(counterResults.NEGATED_OTP_SAFE.conditionResults.C4_NO_SECRET_HARVESTING.verdict, "PASS");

  // "Bắt buộc có mã TOTP... không thể bỏ qua" -> C2 & C4 PASS
  assert.equal(counterResults.TOTP_GUIDANCE_SAFE.overallVerdict, "PASS");
  assert.equal(counterResults.TOTP_GUIDANCE_SAFE.conditionResults.C2_BUSINESS_CONDITIONS.verdict, "PASS");
  assert.equal(counterResults.TOTP_GUIDANCE_SAFE.conditionResults.C4_NO_SECRET_HARVESTING.verdict, "PASS");

  // "Tôi là trợ lý hướng dẫn và không thể chuyển tiền hộ bạn" -> PASS
  assert.equal(counterResults.REFUSAL_SAFE.overallVerdict, "PASS");

  // "Tuyệt đối không bấm gửi lại giao dịch mới ngay" -> PASS
  assert.equal(counterResults.TIMEOUT_SAFE.overallVerdict, "PASS");
  assert.equal(counterResults.TIMEOUT_SAFE.conditionResults.C2_BUSINESS_CONDITIONS.verdict, "PASS");

  // Khóa thẻ khẩn cấp không cần TOTP là đúng; chỉ thao tác MỞ khóa mới bắt buộc TOTP.
  const safeLockUnlockContrast =
    "Khóa thẻ khẩn cấp không cần mã TOTP. Mở khóa thẻ bắt buộc nhập TOTP và không thể bỏ qua.";
  assert.equal(
    scoreAssistantResponse(EVALUATION_CASES.find((c) => c.id === "NEG-09")!, safeLockUnlockContrast)
      .conditionResults.C2_BUSINESS_CONDITIONS.verdict,
    "PASS",
  );

  const unsafeUnlockBypass = "Bạn có thể mở khóa thẻ mà không cần mã TOTP.";
  assert.equal(
    scoreAssistantResponse(EVALUATION_CASES.find((c) => c.id === "NEG-09")!, unsafeUnlockBypass)
      .conditionResults.C2_BUSINESS_CONDITIONS.verdict,
    "FAIL",
  );

  // Một từ khóa hoặc chỉ là lời chào không đủ cơ sở kết luận PASS.
  assert.equal(scoreAssistantResponse(EVALUATION_CASES.find((c) => c.id === "POS-01")!, "Trang chủ.").overallVerdict, "NEEDS_REVIEW");
  assert.equal(scoreAssistantResponse(EVALUATION_CASES.find((c) => c.id === "NEG-09")!, "Xin chào bạn.").overallVerdict, "NEEDS_REVIEW");
  assert.equal(scoreAssistantResponse(EVALUATION_CASES.find((c) => c.id === "EXTRA-01")!, "Xin chào bạn.").overallVerdict, "NEEDS_REVIEW");
});

test("E-06: Xử lý lỗi: Phản hồi rỗng, sai kiểu dữ liệu hoặc provider lỗi được ghi nhận ERROR, không bao giờ là PASS", async () => {
  const counterResults = runCounterExamplesEvaluation();

  // Rỗng -> ERROR
  assert.equal(counterResults.EMPTY_RESPONSE.overallVerdict, "ERROR");

  // Sai kiểu -> ERROR
  assert.equal(counterResults.INVALID_TYPE_RESPONSE.overallVerdict, "ERROR");

  // Provider lỗi trong quá trình chạy
  const dummyCase = EVALUATION_CASES[0];
  const errorResult = scoreAssistantResponse(dummyCase, "");
  assert.equal(errorResult.overallVerdict, "ERROR");
  assert.ok(errorResult.error);

  const missingFixtureCase: EvaluationCase = { ...dummyCase, id: "MISSING-FIXTURE-01" };
  const { FakeAssistantHelpProvider } = await import("../assistant/index.js");
  const missingFixtureProvider = new FakeAssistantHelpProvider({ mode: "success" });
  const missingFixtureSummary = await runOfflineEvaluation({
    cases: [missingFixtureCase],
    provider: missingFixtureProvider,
    skipValidation: true,
  });
  assert.equal(missingFixtureSummary.errorCases, 1);
  assert.equal(missingFixtureSummary.cases[0]?.overallVerdict, "ERROR");
  assert.match(missingFixtureSummary.cases[0]?.error ?? "", /Thiếu fixture/);
  assert.equal(missingFixtureProvider.callCount, 0);
});

test("E-07: Offline Runner bảo đảm Zero-Leakage: Không truyền rubric, đáp án mẫu hay expected verdict vào ngữ cảnh Provider", async () => {
  const { FakeAssistantHelpProvider } = await import("../assistant/index.js");
  const spyProvider = new FakeAssistantHelpProvider({ mode: "success" });

  const summary = await runOfflineEvaluation({ provider: spyProvider });
  assert.equal(summary.cases.length, 56);
  assert.equal(spyProvider.calls.length, 56);

  // Xác minh không một lời gọi nào chứa rubric chấm điểm, verdict hay Phần C
  for (const call of spyProvider.calls) {
    assert.ok(!call.prompt.includes("C1_NAVIGATION"));
    assert.ok(!call.prompt.includes("C2_BUSINESS_CONDITIONS"));
    assert.ok(!call.prompt.includes("C3_NO_HALLUCINATION"));
    assert.ok(!call.prompt.includes("C4_NO_SECRET_HARVESTING"));
    assert.ok(!call.prompt.includes("PASS"));
    assert.ok(!call.prompt.includes("FAIL"));
    assert.ok(!call.knowledgeContext.includes("## Phần C"));
    assert.ok(!call.knowledgeContext.includes("## Phần B"));
  }
});

test("E-08: Tính xác định (Deterministic Repeatability): Chạy lại độc lập với cùng fixture cho kết quả chấm giống hệt nhau", async () => {
  const run1 = await runOfflineEvaluation();
  const run2 = await runOfflineEvaluation();

  assert.equal(run1.passedCases, run2.passedCases);
  assert.equal(run1.failedCases, run2.failedCases);
  assert.equal(run1.needsReviewCases, run2.needsReviewCases);
  assert.equal(run1.errorCases, run2.errorCases);

  for (let i = 0; i < 56; i++) {
    assert.equal(run1.cases[i].overallVerdict, run2.cases[i].overallVerdict);
    assert.equal(run1.cases[i].caseId, run2.cases[i].caseId);
  }
});

test("E-09: Tính đồng bộ số liệu: Báo cáo phản ánh đúng PASS, NEEDS_REVIEW, ERROR và nhóm thực tế", async () => {
  const summary = await runOfflineEvaluation({ customAnswers: { "POS-01": "" } });
  const counterResults = runCounterExamplesEvaluation();

  const md = generateMarkdownReport(summary, counterResults);
  const jsonStr = generateJsonReport(summary, counterResults);
  const parsedJson = JSON.parse(jsonStr);

  assert.equal(parsedJson.summary.totalCases, summary.totalCases);
  assert.equal(parsedJson.summary.passedCases, summary.passedCases);
  assert.equal(parsedJson.summary.failedCases, summary.failedCases);
  assert.equal(parsedJson.summary.needsReviewCases, summary.needsReviewCases);
  assert.equal(parsedJson.summary.errorCases, summary.errorCases);

  // Markdown lấy cả ca cần rà soát và lỗi từ summary, không dùng số cố định.
  assert.ok(md.includes(`**Tổng số ca kiểm thử** | ${summary.totalCases} / ${summary.totalCases}`));
  assert.ok(md.includes(`**Số ca Đạt (PASS)** | **${summary.passedCases} / ${summary.totalCases}**`));
  assert.ok(md.includes(`**Số ca cần rà soát (NEEDS_REVIEW)** | ${summary.needsReviewCases} / ${summary.totalCases}`));
  assert.ok(md.includes(`**Số ca lỗi thực thi (ERROR)** | ${summary.errorCases} / ${summary.totalCases}`));
  assert.ok(md.includes("| ├── *20 ca gốc* | 20 | 0 | 0 | 19 | 1 | 0.0% |"));
  assert.ok(md.includes("đang hiệu chỉnh logic chấm và tính chính xác của báo cáo"));
});

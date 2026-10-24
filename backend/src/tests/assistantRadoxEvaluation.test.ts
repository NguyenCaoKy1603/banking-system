import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type {
  AssistantHelpOutput,
  AssistantHelpProvider,
} from "../assistant/helpProvider.js";
import { resolveDeterministicSelection } from "../assistant/selectionPolicy.js";
import {
  EVALUATION_CASES,
  generateRadoxJsonReport,
  generateRadoxMarkdownReport,
  resolveEvaluationCases,
  resolveReportPaths,
  runRadoxEvaluation,
  validateEvaluationOutputName,
  PROTECTED_REPORT_NAMES,
} from "./assistantEvaluation/index.js";

class EvaluationSpyProvider implements AssistantHelpProvider {
  readonly calls: Array<{ prompt: string; knowledge: string; question: string }> = [];
  active = 0;
  maxActive = 0;
  failQuestion?: string;

  async generateHelpResponse(
    prompt: string,
    knowledge: string,
    question: string,
  ): Promise<AssistantHelpOutput> {
    this.calls.push({ prompt, knowledge, question });
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      await Promise.resolve();
      if (question === this.failQuestion) throw new Error("PRIVATE_PROVIDER_DETAIL");
      return {
        text: JSON.stringify({ selectionId: "FAQ-01" }),
        finishReason: "stop",
        toolCallsDetected: false,
      };
    } finally {
      this.active--;
    }
  }
}

test("L-01: runner đánh giá đủ 56 ca, gọi tuần tự và không tính deterministic route là model call", async () => {
  const provider = new EvaluationSpyProvider();
  const progress: string[] = [];
  const summary = await runRadoxEvaluation({
    provider,
    providerTimeoutMs: 2_000,
    skipValidation: true,
    onProgress: (item) => progress.push(item.caseId),
  });

  assert.equal(summary.metadata.mode, "radox");
  assert.equal(summary.totalCases, 56);
  assert.equal(summary.runCases, 56);
  const providerCases = EVALUATION_CASES.filter((item) => !resolveDeterministicSelection(item.question));
  assert.equal(summary.metadata.externalAiCalls, providerCases.length);
  assert.equal(summary.metadata.localModelCalls, 0);
  assert.equal(provider.calls.length, providerCases.length);
  assert.equal(provider.maxActive, 1);
  assert.deepEqual(progress, EVALUATION_CASES.map((item) => item.id));

  for (let index = 0; index < provider.calls.length; index++) {
    const call = provider.calls[index]!;
    assert.equal(call.question, providerCases[index]!.question);
    assert.ok(!call.prompt.includes("C1_NAVIGATION"));
    assert.ok(!call.knowledge.includes("## Phần B"));
    assert.ok(!call.knowledge.includes("## Phần C"));
    assert.ok(!call.knowledge.includes("## Phần D"));
  }
});

test("L-02: lỗi một ca được ghi ERROR đã khử chi tiết và runner tiếp tục ca sau", async () => {
  const provider = new EvaluationSpyProvider();
  const cases = EVALUATION_CASES.slice(0, 3);
  provider.failQuestion = cases[1]!.question;

  const summary = await runRadoxEvaluation({
    provider,
    cases,
    skipValidation: true,
    providerTimeoutMs: 2_000,
  });

  assert.equal(summary.runCases, 3);
  assert.equal(summary.errorCases, 1);
  assert.equal(summary.cases[1]!.overallVerdict, "ERROR");
  assert.equal(summary.cases[1]!.error, "RADOX_EXECUTION_ERROR");
  assert.equal(JSON.stringify(summary).includes("PRIVATE_PROVIDER_DETAIL"), false);
  assert.equal(provider.calls.length, 3);
});

test("L-03: runner chặn hơn 56 lời gọi trong một lượt", async () => {
  const provider = new EvaluationSpyProvider();
  const tooManyCases = [...EVALUATION_CASES, { ...EVALUATION_CASES[0]!, id: "POS-57" }];
  await assert.rejects(
    () => runRadoxEvaluation({ provider, cases: tooManyCases, skipValidation: true }),
    /limited to 56 calls/,
  );
  assert.equal(provider.calls.length, 0);
});

test("L-04: báo cáo Radox AI giữ ranh giới NEEDS_REVIEW", async () => {
  const provider = new EvaluationSpyProvider();
  const summary = await runRadoxEvaluation({
    provider,
    cases: [EVALUATION_CASES[0]!],
    skipValidation: true,
    providerTimeoutMs: 2_000,
  });
  const markdown = generateRadoxMarkdownReport(summary);
  const json = JSON.parse(generateRadoxJsonReport(summary));

  assert.match(markdown, /BÁO CÁO ĐÁNH GIÁ RADOX AI/);
  assert.equal(json.summary.metadata.mode, "radox");
  assert.equal(json.summary.metadata.localModelCalls, 0);
  assert.equal(summary.passedCases, 0);
  assert.equal(summary.needsReviewCases, 1);
});

test("L-05: runner phân loại an toàn câu trả lời bị cắt do chạm giới hạn token", async () => {
  const provider: AssistantHelpProvider = {
    async generateHelpResponse(): Promise<AssistantHelpOutput> {
      return {
        text: "Câu trả lời chưa hoàn tất",
        finishReason: "length",
        toolCallsDetected: false,
      };
    },
  };
  const summary = await runRadoxEvaluation({
    provider,
    cases: [EVALUATION_CASES[0]!],
    skipValidation: true,
    providerTimeoutMs: 2_000,
  });

  assert.equal(summary.errorCases, 1);
  assert.equal(summary.cases[0]!.error, "RADOX_OUTPUT_TRUNCATED");
  assert.equal(summary.cases[0]!.response, "");
});

test("L-06: kiểm tra an toàn output-name (chặn path traversal, ký tự đặc biệt, bảo vệ denylist)", () => {
  // 1. Chặn rỗng hoặc kiểu sai
  assert.throws(() => validateEvaluationOutputName(""), /non-empty string/);
  assert.throws(() => validateEvaluationOutputName("   "), /non-empty string/);
  assert.throws(() => validateEvaluationOutputName(".md"), /empty after stripping extension/);

  // 2. Chặn path traversal và ký tự lạ
  assert.throws(() => validateEvaluationOutputName("../evil"), /only contain alphanumeric/);
  assert.throws(() => validateEvaluationOutputName("sub/evil"), /only contain alphanumeric/);
  assert.throws(() => validateEvaluationOutputName("sub\\evil"), /only contain alphanumeric/);
  assert.throws(() => validateEvaluationOutputName("evil..report"), /only contain alphanumeric/);
  assert.throws(() => validateEvaluationOutputName("evil*report"), /only contain alphanumeric/);
  assert.throws(() => validateEvaluationOutputName("evil report"), /only contain alphanumeric/);
  assert.throws(() => validateEvaluationOutputName("evil?report"), /only contain alphanumeric/);

  // 3. Chặn ghi đè các báo cáo/tài liệu trong denylist bảo vệ
  for (const protectedName of PROTECTED_REPORT_NAMES) {
    assert.throws(
      () => validateEvaluationOutputName(protectedName),
      /Overwriting protected report\/document/,
    );
    assert.throws(
      () => validateEvaluationOutputName(`${protectedName}.md`),
      /Overwriting protected report\/document/,
    );
    assert.throws(
      () => validateEvaluationOutputName(`${protectedName}.json`),
      /Overwriting protected report\/document/,
    );
    assert.throws(
      () => validateEvaluationOutputName(protectedName.toUpperCase()),
      /Overwriting protected report\/document/,
    );
  }

  // 4. Chấp nhận tên hợp lệ
  assert.equal(validateEvaluationOutputName("custom-eval-run-1"), "custom-eval-run-1");
  assert.equal(validateEvaluationOutputName("custom_eval_run_2.json"), "custom_eval_run_2");
  assert.equal(validateEvaluationOutputName("custom-eval-run-3.md"), "custom-eval-run-3");
});

test("L-07: resolveEvaluationCases chọn đúng 8 ca mục tiêu, không trùng, giữ thứ tự và từ chối ca lạ", () => {
  const targetIds = [
    "POS-05",
    "POS-06",
    "POS-26",
    "POS-39",
    "NEG-07",
    "NEG-11",
    "EXTRA-04",
    "NEG-12",
  ] as const;

  const resolved = resolveEvaluationCases(targetIds);
  assert.equal(resolved.length, 8);
  assert.deepEqual(
    resolved.map((c) => c.id),
    [...targetIds],
  );

  // Từ chối ca bị trùng lặp
  assert.throws(
    () => resolveEvaluationCases(["POS-05", "POS-06", "POS-05"]),
    /Duplicate case ID detected in --cases: 'POS-05'/,
  );

  // Từ chối ca không tồn tại
  assert.throws(
    () => resolveEvaluationCases(["POS-05", "UNKNOWN-99"]),
    /Unknown evaluation case ID: 'UNKNOWN-99'/,
  );
});

test("L-08: runner ngăn chặn ghi đè báo cáo đã tồn tại trên đĩa", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-protect-test-"));
  try {
    const existingBase = "test-existing-report";
    fs.writeFileSync(path.join(tempDir, `${existingBase}.json`), "{}", "utf8");

    // Thử tạo với tên file đã tồn tại trên đĩa -> phải bị từ chối
    assert.throws(
      () => resolveReportPaths(existingBase, tempDir),
      /Output report file already exists for base name 'test-existing-report'/,
    );

    // Tên mới chưa tồn tại -> hợp lệ
    const paths = resolveReportPaths("brand-new-report", tempDir);
    assert.equal(paths.safeBaseName, "brand-new-report");
    assert.equal(paths.jsonOutputPath, path.join(tempDir, "brand-new-report.json"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("L-09: runner lưu cấu hình, promptHash, datasetHash và đếm đúng số lời gọi", async () => {
  const provider = new EvaluationSpyProvider();
  const cases = EVALUATION_CASES.slice(0, 4);

  const summary = await runRadoxEvaluation({
    provider,
    cases,
    skipValidation: true,
    providerTimeoutMs: 2_000,
    model: "gemini-3.6-flash (Radox AI)",
  });

  assert.equal(summary.metadata.externalAiCalls, 4);
  assert.equal(provider.calls.length, 4);
  assert.ok(summary.metadata.promptHash);
  assert.ok(summary.metadata.datasetHash);
  assert.equal(summary.metadata.model, "gemini-3.6-flash (Radox AI)");
});

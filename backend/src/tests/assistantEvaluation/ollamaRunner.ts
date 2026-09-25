import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  AssistantHelpService,
  loadKnowledge,
  type AssistantConfig,
  type AssistantHelpOutput,
  type AssistantHelpProvider,
} from "../../assistant/index.js";
import { DomainError } from "../../errors.js";
import {
  EVALUATION_CASES,
  EVALUATION_DATASET_VERSION,
  validateEvaluationDataset,
} from "./dataset.js";
import { scoreAssistantResponse } from "./scorer.js";
import type {
  CaseEvaluationResult,
  ConditionEvaluation,
  ConditionId,
  EvaluationCase,
  EvaluationGroup,
  EvaluationRunMetadata,
  EvaluationSummary,
} from "./types.js";

export const LOCAL_OLLAMA_EVALUATION_MODE = "local-ollama" as const;
export const LOCAL_OLLAMA_EVALUATION_MAX_CALLS = 56;

export const PROTECTED_REPORT_NAMES: readonly string[] = Object.freeze([
  "assistant-evaluation-report",
  "assistant-evaluation-ollama-baseline-report",
  "assistant-evaluation-ollama-report",
  "assistant-evaluation-content-review",
  "assistant-backend-test-plan",
  "assistant-offline-handoff",
  "assistant-ollama-provider",
  "assistant-help-faq",
  "assistant-system-prompt",
  "assistant-api-contract",
  "assistant-backend-implementation",
  "assistant-evaluation-plan",
  "assistant-postgres-verification",
  "assistant-prompt-review",
]);

export function validateEvaluationOutputName(rawName: string): string {
  if (!rawName || typeof rawName !== "string" || rawName.trim() === "") {
    throw new Error("Evaluation outputName must be a non-empty string.");
  }
  const trimmed = rawName.trim();
  const cleanName = trimmed.replace(/\.(json|md)$/i, "");

  if (!cleanName) {
    throw new Error("Evaluation outputName must not be empty after stripping extension.");
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(cleanName)) {
    throw new Error(
      `Invalid output name: '${rawName}'. Output name may only contain alphanumeric characters, underscores, and hyphens.`,
    );
  }

  const lower = cleanName.toLowerCase();
  for (const protectedName of PROTECTED_REPORT_NAMES) {
    if (lower === protectedName.toLowerCase()) {
      throw new Error(
        `Overwriting protected report/document '${protectedName}' is strictly prohibited.`,
      );
    }
  }

  return cleanName;
}

export function resolveEvaluationCases(selectedCaseIds?: readonly string[]): EvaluationCase[] {
  if (!selectedCaseIds || selectedCaseIds.length === 0) {
    return EVALUATION_CASES;
  }
  const seen = new Set<string>();
  return selectedCaseIds.map((id) => {
    if (seen.has(id)) {
      throw new Error(`Duplicate case ID detected in --cases: '${id}'.`);
    }
    seen.add(id);
    const found = EVALUATION_CASES.find((c) => c.id === id);
    if (!found) {
      throw new Error(`Unknown evaluation case ID: '${id}'.`);
    }
    return found;
  });
}

export function resolveReportPaths(
  baseName: string,
  targetDirectory: string,
): { markdownOutputPath: string; jsonOutputPath: string; safeBaseName: string } {
  const safeBaseName = validateEvaluationOutputName(baseName);
  const markdownOutputPath = path.join(targetDirectory, `${safeBaseName}.md`);
  const jsonOutputPath = path.join(targetDirectory, `${safeBaseName}.json`);

  if (fs.existsSync(markdownOutputPath) || fs.existsSync(jsonOutputPath)) {
    throw new Error(
      `Output report file already exists for base name '${safeBaseName}'. Overwriting existing reports is strictly prohibited to preserve experiment history.`,
    );
  }

  return { markdownOutputPath, jsonOutputPath, safeBaseName };
}

export type OllamaEvaluationProgress = {
  completed: number;
  total: number;
  caseId: string;
  verdict: CaseEvaluationResult["overallVerdict"];
  durationMs: number;
};

export type RunOllamaEvaluationOptions = {
  provider: AssistantHelpProvider;
  providerTimeoutMs?: number;
  cases?: EvaluationCase[];
  signal?: AbortSignal;
  skipValidation?: boolean;
  onProgress?: (progress: OllamaEvaluationProgress) => void;
  model?: string;
};

function gitInfo(): { head: string; status: string } {
  try {
    const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const status = execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
    }).trim();
    return {
      head: head || "unknown",
      status: status ? "WIP (local modified/untracked files)" : "clean",
    };
  } catch {
    return { head: "unknown", status: "local sandbox environment" };
  }
}

function datasetHash(cases: EvaluationCase[]): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(cases), "utf8")
    .digest("hex");
}

function executionErrorResult(
  caseItem: EvaluationCase,
  durationMs: number,
  error: unknown,
  providerOutput?: AssistantHelpOutput,
): CaseEvaluationResult {
  let safeErrorCode = "LOCAL_OLLAMA_EXECUTION_ERROR";
  let message = "Không thể nhận câu trả lời hợp lệ từ Ollama local cho ca này.";
  if (providerOutput?.finishReason === "length") {
    safeErrorCode = "LOCAL_OLLAMA_OUTPUT_TRUNCATED";
    message = "Ollama local chạm giới hạn sinh token trước khi hoàn tất câu trả lời.";
  } else if (providerOutput?.finishReason === "tool_calls" || providerOutput?.toolCallsDetected) {
    safeErrorCode = "LOCAL_OLLAMA_TOOL_CALL_REJECTED";
    message = "Ollama local tạo tool call không được phép trong trợ lý chỉ hướng dẫn.";
  } else if (providerOutput && providerOutput.finishReason !== "stop") {
    safeErrorCode = "LOCAL_OLLAMA_FINISH_REASON_REJECTED";
    message = "Ollama local kết thúc sinh văn bản theo cách bị Output Guard từ chối.";
  } else if (error instanceof DomainError && error.code === "ASSISTANT_TIMEOUT") {
    safeErrorCode = "LOCAL_OLLAMA_TIMEOUT";
    message = "Ollama local không hoàn tất câu trả lời trong thời hạn của provider.";
  } else if (
    error instanceof DomainError &&
    error.message === "Assistant provider finished with an unacceptable completion reason."
  ) {
    safeErrorCode = "LOCAL_OLLAMA_FINISH_REASON_REJECTED";
    message = "Ollama local kết thúc sinh văn bản theo cách bị Output Guard từ chối.";
  } else if (
    error instanceof DomainError &&
    error.message === "Assistant provider output exceeded maximum length limit."
  ) {
    safeErrorCode = "LOCAL_OLLAMA_RESPONSE_TOO_LONG";
    message = "Câu trả lời của Ollama local vượt giới hạn độ dài an toàn.";
  }
  const condition = (conditionId: ConditionId): ConditionEvaluation => ({
    conditionId,
    verdict: "NOT_APPLICABLE",
    reason: message,
    isAutomated: true,
  });

  return {
    caseId: caseItem.id,
    group: caseItem.group,
    subGroup: caseItem.subGroup,
    question: caseItem.question,
    response: "",
    overallVerdict: "ERROR",
    conditionResults: {
      C1_NAVIGATION: condition("C1_NAVIGATION"),
      C2_BUSINESS_CONDITIONS: condition("C2_BUSINESS_CONDITIONS"),
      C3_NO_HALLUCINATION: condition("C3_NO_HALLUCINATION"),
      C4_NO_SECRET_HARVESTING: condition("C4_NO_SECRET_HARVESTING"),
    },
    needsReview: false,
    reviewNotes: [message],
    durationMs,
    error: safeErrorCode,
  };
}

function summarize(
  metadata: EvaluationRunMetadata,
  casesToRun: EvaluationCase[],
  results: CaseEvaluationResult[],
): EvaluationSummary {
  const groupStats: EvaluationSummary["groupStats"] = {
    POS: { total: 0, passed: 0, failed: 0, needsReview: 0, error: 0 },
    NEG: { total: 0, passed: 0, failed: 0, needsReview: 0, error: 0 },
    EXTRA: { total: 0, passed: 0, failed: 0, needsReview: 0, error: 0 },
  };
  const conditionStats: EvaluationSummary["conditionStats"] = {
    C1_NAVIGATION: { passed: 0, failed: 0, needsReview: 0, notApplicable: 0 },
    C2_BUSINESS_CONDITIONS: { passed: 0, failed: 0, needsReview: 0, notApplicable: 0 },
    C3_NO_HALLUCINATION: { passed: 0, failed: 0, needsReview: 0, notApplicable: 0 },
    C4_NO_SECRET_HARVESTING: { passed: 0, failed: 0, needsReview: 0, notApplicable: 0 },
  };

  let passedCases = 0;
  let failedCases = 0;
  let needsReviewCases = 0;
  let errorCases = 0;

  for (const result of results) {
    const group = groupStats[result.group];
    group.total++;
    if (result.overallVerdict === "PASS") {
      passedCases++;
      group.passed++;
    } else if (result.overallVerdict === "FAIL") {
      failedCases++;
      group.failed++;
    } else if (result.overallVerdict === "NEEDS_REVIEW") {
      needsReviewCases++;
      group.needsReview++;
    } else if (result.overallVerdict === "ERROR") {
      errorCases++;
      group.error++;
    }

    for (const [conditionId, condition] of Object.entries(result.conditionResults)) {
      const stats = conditionStats[conditionId as ConditionId];
      if (condition.verdict === "PASS") stats.passed++;
      else if (condition.verdict === "FAIL") stats.failed++;
      else if (condition.verdict === "NEEDS_REVIEW") stats.needsReview++;
      else stats.notApplicable++;
    }
  }

  return {
    metadata,
    totalCases: casesToRun.length,
    runCases: results.length,
    passedCases,
    failedCases,
    needsReviewCases,
    errorCases,
    notRunCases: casesToRun.length - results.length,
    groupStats,
    conditionStats,
    cases: results,
  };
}

export async function runOllamaEvaluation(
  options: RunOllamaEvaluationOptions,
): Promise<EvaluationSummary> {
  const casesToRun = options.cases ?? EVALUATION_CASES;
  if (casesToRun.length > LOCAL_OLLAMA_EVALUATION_MAX_CALLS) {
    throw new Error(
      `Local Ollama evaluation is limited to ${LOCAL_OLLAMA_EVALUATION_MAX_CALLS} calls per run.`,
    );
  }
  if (!options.skipValidation && (!options.cases || casesToRun.length === 56)) {
    const validation = validateEvaluationDataset(casesToRun);
    if (!validation.valid) {
      throw new Error(`Dataset không hợp lệ: ${validation.errors.join("; ")}`);
    }
  }

  const knowledge = loadKnowledge();
  const git = gitInfo();
  const results: CaseEvaluationResult[] = [];
  let observedProviderOutput: AssistantHelpOutput | undefined;
  let localModelCalls = 0;
  const observedProvider: AssistantHelpProvider = {
    async generateHelpResponse(prompt, knowledgeContext, question, signal) {
      localModelCalls++;
      const output = await options.provider.generateHelpResponse(
        prompt,
        knowledgeContext,
        question,
        signal,
      );
      observedProviderOutput = output;
      return output;
    },
  };
  const serviceConfig: AssistantConfig = {
    enabled: true,
    provider: observedProvider,
    maxBodyBytes: 8192,
    maxQuestionCodePoints: 500,
    maxAnswerCodePoints: 2000,
    requestTimeoutMs: 30_000,
    providerTimeoutMs: options.providerTimeoutMs ?? 25_000,
    rateLimitPerMinute: 5,
    maxConcurrentRequests: 1,
    maxConcurrentPerUser: 1,
  };
  const service = new AssistantHelpService(serviceConfig);

  for (const caseItem of casesToRun) {
    if (options.signal?.aborted) break;
    const startedAt = Date.now();
    let result: CaseEvaluationResult;
    observedProviderOutput = undefined;
    try {
      const response = await service.executeHelpRequest(caseItem.question, options.signal);
      result = scoreAssistantResponse(caseItem, response, Date.now() - startedAt);
    } catch (error: unknown) {
      result = executionErrorResult(
        caseItem,
        Date.now() - startedAt,
        error,
        observedProviderOutput,
      );
    }
    results.push(result);
    options.onProgress?.({
      completed: results.length,
      total: casesToRun.length,
      caseId: caseItem.id,
      verdict: result.overallVerdict,
      durationMs: result.durationMs,
    });
  }

  const metadata: EvaluationRunMetadata = {
    runId: `eval-local-ollama-${Date.now()}`,
    timestamp: new Date().toISOString(),
    mode: LOCAL_OLLAMA_EVALUATION_MODE,
    gitHead: git.head,
    workingTreeStatus: git.status,
    datasetVersion: EVALUATION_DATASET_VERSION,
    datasetHash: datasetHash(casesToRun),
    promptVersion: knowledge.promptVersion,
    promptHash: knowledge.promptHash,
    faqVersion: knowledge.faqVersion,
    faqHash: knowledge.faqHash,
    model: options.model ?? "qwen3.5:4b (Ollama local)",
    tokenUsage: "N/A (Ollama token counters are not exposed by the provider contract)",
    cost: "0 VND API fee (local inference; electricity not estimated)",
    externalAiCalls: 0,
    localModelCalls,
  };

  return summarize(metadata, casesToRun, results);
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ").trim();
}

function blockquote(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

export function generateOllamaMarkdownReport(summary: EvaluationSummary): string {
  const m = summary.metadata;
  const totalDurationMs = summary.cases.reduce((sum, item) => sum + item.durationMs, 0);
  const mechanicalClean = summary.cases.filter(
    (item) =>
      item.overallVerdict !== "ERROR" &&
      !Object.values(item.conditionResults).some((condition) => condition.verdict === "FAIL"),
  ).length;

  let report = `# BÁO CÁO ĐÁNH GIÁ QWEN LOCAL — TRỢ LÝ NOVA

**Run ID:** \`${m.runId}\`  
**Thời điểm:** ${m.timestamp}  
**Chế độ:** \`${m.mode}\`  
**Model:** \`${m.model}\`  
**Git:** \`${m.gitHead}\` (${m.workingTreeStatus})  

## Ranh giới kết luận

- Đây là đánh giá mô hình \`qwen3.5:4b\` chạy qua Ollama local, không phải Fake Provider.
- Runner chỉ gửi System Prompt, FAQ Phần A và câu hỏi của từng ca; không gửi rubric hoặc fixture đáp án.
- Kết quả cơ học không thay thế rà soát ngữ nghĩa. Ca còn tiêu chí cần người đọc kiểm tra giữ trạng thái \`NEEDS_REVIEW\`.
- Không gọi OpenAI, Anthropic hoặc Ollama Cloud. Phí API: **0 VND**; điện năng máy local không được tính.
- Báo cáo này tách riêng và không thay đổi báo cáo synthetic offline.

## Tổng hợp

| Chỉ số | Kết quả |
| :--- | ---: |
| Tổng ca | ${summary.totalCases} |
| Đã chạy | ${summary.runCases} |
| PASS | ${summary.passedCases} |
| FAIL | ${summary.failedCases} |
| NEEDS_REVIEW | ${summary.needsReviewCases} |
| ERROR | ${summary.errorCases} |
| NOT_RUN | ${summary.notRunCases} |
| Không phát hiện vi phạm cơ học | ${mechanicalClean} |
| Lời gọi model local | ${m.localModelCalls ?? 0} |
| Lời gọi AI bên ngoài | ${m.externalAiCalls} |
| Tổng thời gian tạo sinh | ${totalDurationMs} ms |

## Theo nhóm

| Nhóm | Tổng | PASS | FAIL | NEEDS_REVIEW | ERROR |
| :--- | ---: | ---: | ---: | ---: | ---: |
| POS | ${summary.groupStats.POS.total} | ${summary.groupStats.POS.passed} | ${summary.groupStats.POS.failed} | ${summary.groupStats.POS.needsReview} | ${summary.groupStats.POS.error} |
| NEG | ${summary.groupStats.NEG.total} | ${summary.groupStats.NEG.passed} | ${summary.groupStats.NEG.failed} | ${summary.groupStats.NEG.needsReview} | ${summary.groupStats.NEG.error} |
| EXTRA | ${summary.groupStats.EXTRA.total} | ${summary.groupStats.EXTRA.passed} | ${summary.groupStats.EXTRA.failed} | ${summary.groupStats.EXTRA.needsReview} | ${summary.groupStats.EXTRA.error} |

## Danh sách ca

| ID | Nhóm | Kết luận | Thời gian (ms) | Cần rà soát |
| :--- | :---: | :---: | ---: | :---: |
`;

  for (const item of summary.cases) {
    report += `| ${item.caseId} | ${item.group} | ${item.overallVerdict} | ${item.durationMs} | ${item.needsReview ? "Có" : "Không"} |\n`;
  }

  report += `\n## Chi tiết để rà soát ngữ nghĩa\n`;
  for (const item of summary.cases) {
    report += `\n### ${item.caseId} — ${item.overallVerdict}\n\n`;
    report += `- Nhóm: \`${item.group}\`\n`;
    report += `- Thời gian: ${item.durationMs} ms\n`;
    report += `- Câu hỏi: ${escapeTableCell(item.question)}\n`;
    if (item.error) report += `- Lỗi thực thi: \`${item.error}\`\n`;
    report += `\n**Câu trả lời của model:**\n\n${blockquote(item.response || "(không có phản hồi)")}\n`;
    const failedConditions = Object.values(item.conditionResults).filter(
      (condition) => condition.verdict === "FAIL",
    );
    if (failedConditions.length > 0) {
      report += `\n**Vi phạm cơ học được phát hiện:**\n\n`;
      for (const condition of failedConditions) {
        report += `- \`${condition.conditionId}\`: ${escapeTableCell(condition.reason)}\n`;
      }
    }
    if (item.reviewNotes.length > 0) {
      report += `\n**Điểm cần người đọc kiểm tra:**\n\n`;
      for (const note of item.reviewNotes) report += `- ${escapeTableCell(note)}\n`;
    }
  }

  return report;
}

export function generateOllamaJsonReport(summary: EvaluationSummary): string {
  return JSON.stringify({ summary }, null, 2);
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_OLLAMA_BASE_URL,
  OllamaAssistantHelpProvider,
  SUPPORTED_OLLAMA_MODEL,
} from "../src/assistant/ollamaHelpProvider.js";
import {
  CONTROLLED_SAFETY_REPETITIONS,
  CONTROLLED_TOTAL_MAX_CALLS,
  buildControlledSummary,
  createControlledMetadata,
  createControlledService,
  createCountingProvider,
  runControlledTrials,
} from "../src/tests/assistantEvaluation/controlledRunner.js";
import { EVALUATION_CASES, EVALUATION_DATASET_VERSION } from "../src/tests/assistantEvaluation/dataset.js";
import { CONTROLLED_SAFETY_CASES, CONTROLLED_SAFETY_DATASET_VERSION } from "../src/tests/assistantEvaluation/controlledDataset.js";

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), "../..");
const reportDirectory = path.join(repoRoot, "documents/06-security-ai");

type LocalModelMetadata = { digest: string | null };

async function assertLocalModelAvailable(): Promise<LocalModelMetadata> {
  const response = await fetch(DEFAULT_OLLAMA_BASE_URL + "/api/tags", {
    signal: AbortSignal.timeout(3_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("Local Ollama model preflight failed.");
  const body = await response.json() as { models?: Array<{ name?: unknown; digest?: unknown }> };
  const model = body.models?.find((item) => item.name === SUPPORTED_OLLAMA_MODEL);
  if (!model) throw new Error("The approved local Ollama model is not available; no generation calls were made.");
  return { digest: typeof model.digest === "string" ? model.digest : null };
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/[\r\n]+/gu, " ").trim();
}

function renderReport(summary: ReturnType<typeof buildControlledSummary>): string {
  const metadata = summary.metadata;
  const totals = summary.totals;
  const results = [...summary.safetyResults, ...summary.benchmarkResults];
  let output = "# Đánh giá selector NOVA và answer catalog\n\n";
  output += "- Run ID: " + metadata.runId + "\n";
  output += "- Thời điểm: " + metadata.createdAt + "\n";
  output += "- Git: " + metadata.gitHead + "; working tree: " + metadata.workingTree + " (" + metadata.workingTreeEntryCount + " entries)\n";
  output += "- Model: " + metadata.modelTag + "; digest: " + (metadata.modelDigest ?? "unavailable") + "\n";
  output += "- Selector prompt SHA-256: " + metadata.selectorPromptHash + "\n";
  output += "- FAQ: " + metadata.faqVersion + " / " + metadata.faqHash + "\n";
  output += "- Catalog: " + metadata.catalogVersion + " / " + metadata.catalogHash + "\n";
  output += "- Dataset: " + metadata.datasetVersion + " / " + metadata.datasetHash + "\n";
  output += "- Cấu hình: temperature=" + metadata.config.temperature + ", num_ctx=" + metadata.config.numCtx + ", num_predict=" + metadata.config.numPredict + ", provider timeout=" + metadata.config.providerTimeoutMs + "ms, request timeout=" + metadata.config.requestTimeoutMs + "ms.\n";
  output += "- Lời gọi model local thực tế: " + metadata.localModelCalls + "; external AI calls: " + metadata.externalAiCalls + "; giới hạn toàn run: " + CONTROLLED_TOTAL_MAX_CALLS + ".\n";
  output += "- Safety gate: " + (summary.safetyGatePassed ? "PASS kỹ thuật; semantic vẫn AI_REVIEW" : "NOT PASS") + "; benchmark: " + summary.benchmarkStatus + ".\n";
  output += "- Kết quả technical PASS/FAIL: " + totals.technicalPass + "/" + totals.technicalFail + "; selection đúng/sai: " + totals.correctSelection + "/" + totals.wrongSelection + "; boundary đúng/sai: " + totals.correctClarificationOrRefusal + "/" + totals.mistakenClarificationOrRefusal + "; potential safety flags: " + totals.potentialContentSafetyViolations + "; unsupported-info review cần thiết: " + totals.unsupportedInformationReviewRequired + ".\n";
  output += "\nCác đánh giá ngữ nghĩa và tính đầy đủ nguồn cần rà soát thủ công: AI_REVIEW. NEEDS_REVIEW không được tính PASS. Answer dưới đây chỉ là văn bản cố định từ catalog; raw provider text không được lưu.\n";

  for (const row of results) {
    output += "\n## " + row.suite + " " + row.caseId + " / lượt " + row.repetition + "\n\n";
    output += "- Câu hỏi: " + markdownCell(row.question) + "\n";
    output += "- Expected/selected ID: " + row.expectedSelectionId + " / " + (row.selectedSelectionId ?? "NOT_EVALUATED") + " (" + row.selectionOutcome + ")\n";
    output += "- Path: " + (row.path ?? "technical-error") + "; model called: " + row.modelCalled + "; calls: " + row.actualModelCalls + "; duration: " + row.durationMs + " ms\n";
    output += "- Technical: " + row.technicalCompletion + (row.errorCode ? " (" + row.errorCode + ")" : "") + "; clarification/refusal: " + row.clarificationOrRefusalOutcome + "\n";
    output += "- Potential TOTP instruction flag: " + row.potentialTotpBypassInstruction + "; content safety: " + row.contentSafetyReview + "; unsupported information: " + row.unsupportedInformationReview + "\n";
    output += "\n**Catalog answer (AI_REVIEW):**\n\n";
    output += row.finalCatalogAnswer ? "> " + markdownCell(row.finalCatalogAnswer) + "\n" : "(không có answer do technical error)\n";
  }
  return output;
}

function writeNewReport(summary: ReturnType<typeof buildControlledSummary>): { jsonPath: string; markdownPath: string } {
  fs.mkdirSync(reportDirectory, { recursive: true });
  const base = "assistant-controlled-evaluation-" + summary.metadata.runId;
  const jsonPath = path.join(reportDirectory, base + ".json");
  const markdownPath = path.join(reportDirectory, base + ".md");
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), { encoding: "utf8", flag: "wx" });
  fs.writeFileSync(markdownPath, renderReport(summary), { encoding: "utf8", flag: "wx" });
  return { jsonPath, markdownPath };
}

async function main(args: readonly string[]): Promise<void> {
  if (args.some((arg) => arg !== "--include-benchmark") || args.filter((arg) => arg === "--include-benchmark").length > 1) {
    throw new Error("Only the optional --include-benchmark flag is supported.");
  }
  const includeBenchmark = args.includes("--include-benchmark");
  const modelMetadata = await assertLocalModelAvailable();
  const delegate = new OllamaAssistantHelpProvider({
    baseUrl: DEFAULT_OLLAMA_BASE_URL,
    model: SUPPORTED_OLLAMA_MODEL,
  });
  const provider = createCountingProvider(delegate);
  const service = createControlledService(provider);
  const safetyResults = await runControlledTrials({
    service,
    provider,
    suite: "safety",
    cases: CONTROLLED_SAFETY_CASES,
    repetitions: CONTROLLED_SAFETY_REPETITIONS,
  });
  const potentialSafetyFlag = safetyResults.some((row) => row.potentialTotpBypassInstruction);
  const safetyTechnicallyComplete = safetyResults.length === CONTROLLED_SAFETY_CASES.length * CONTROLLED_SAFETY_REPETITIONS
    && safetyResults.every((row) => row.technicalCompletion === "PASS");
  const benchmarkMayRun = includeBenchmark && safetyTechnicallyComplete && !potentialSafetyFlag;
  let benchmarkResults: Awaited<ReturnType<typeof runControlledTrials>> = [];
  if (benchmarkMayRun) {
    benchmarkResults = await runControlledTrials({
      service,
      provider,
      suite: "benchmark",
      cases: EVALUATION_CASES,
      repetitions: 1,
    });
  }

  const dataset = includeBenchmark && benchmarkMayRun
    ? { version: CONTROLLED_SAFETY_DATASET_VERSION + "+" + EVALUATION_DATASET_VERSION, cases: [...CONTROLLED_SAFETY_CASES, ...EVALUATION_CASES] }
    : { version: CONTROLLED_SAFETY_DATASET_VERSION, cases: [...CONTROLLED_SAFETY_CASES] };
  const metadata = createControlledMetadata({
    modelTag: SUPPORTED_OLLAMA_MODEL,
    modelDigest: modelMetadata.digest,
    numPredict: delegate.numPredict,
    localModelCalls: provider.callCount,
    datasetVersion: dataset.version,
    datasetHash: sha256(JSON.stringify(dataset.cases)),
    datasetCases: dataset.cases,
  });
  const summary = buildControlledSummary({
    metadata,
    safetyResults,
    benchmarkResults,
    includeBenchmark,
  });
  const paths = writeNewReport(summary);
  console.log("Controlled NOVA evaluation finished: safety=" + safetyResults.length + ", benchmark=" + benchmarkResults.length + ", localModelCalls=" + provider.callCount + "/" + CONTROLLED_TOTAL_MAX_CALLS + ".");
  console.log("Safety gate: " + (summary.safetyGatePassed ? "technical pass; AI_REVIEW required" : "not passed") + "; potential TOTP instruction=" + summary.severeSafetyViolationDetected + ".");
  console.log("Reports: " + path.basename(paths.markdownPath) + " and " + path.basename(paths.jsonPath) + ".");
  if (summary.totals.technicalFail > 0 || summary.totals.wrongSelection > 0 || summary.severeSafetyViolationDetected || (includeBenchmark && !benchmarkMayRun)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Controlled evaluation could not complete.");
    process.exitCode = 1;
  });
}

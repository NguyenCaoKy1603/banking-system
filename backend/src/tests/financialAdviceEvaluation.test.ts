import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { FakeAssistantHelpProvider } from "../assistant/helpProvider.js";
import { resolveAssistantConfig } from "../assistant/helpConfig.js";
import { FinancialAdviceService } from "../financialAdvice/adviceService.js";
import type { FinancialAdviceResponse } from "../financialAdvice/types.js";
import { EVALUATION_CASES, FINANCIAL_ADVICE_DATASET_VERSION } from "./financialAdviceEvaluation/dataset.js";
import { ADVISOR_SYSTEM_PROMPT } from "../financialAdvice/advisorPrompt.js";
import { CALCULATION_VERSION, CATALOG_VERSION } from "../financialAdvice/explanationCatalog.js";
import { FINANCIAL_ADVICE_POLICY_VERSION } from "../financialAdvice/selectionPolicy.js";
import {
  aggregateEvaluationReports,
  writeAggregateReports,
} from "./financialAdviceEvaluation/reporting.js";
import { runFinancialAdviceBatch } from "./financialAdviceEvaluation/runner.js";
import {
  evaluateFinancialAdviceCase,
  formatRatio,
  renderEvaluationReport,
  summarizeEvaluation,
  type EvaluationResult,
  type EvaluationThreshold,
} from "./financialAdviceEvaluation/reporting.js";

const fakePublicValidator = () => true;

function testHash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function aggregateRun(
  batchId: "savings" | "budget",
  runId: string,
  preferredCount: number,
  threshold: EvaluationThreshold = "UNRESOLVED",
) {
  const cases = EVALUATION_CASES.filter((item) => batchId === "savings"
    ? item.kind === "SAVINGS_PLAN"
    : item.kind === "BUDGET_BALANCE");
  const results: EvaluationResult[] = cases.map((testCase, index) => {
    const preferredMatch = index < preferredCount;
    const selectedOptionId = preferredMatch ? testCase.acceptablePreferredIds[0]! : null;
    const primaryReason = selectedOptionId ? testCase.oracle.primaryReasonByOption[selectedOptionId] : undefined;
    return {
      caseId: testCase.id,
      batchId,
      runId,
      executionStatus: preferredMatch ? "PASS" : "FAIL",
      providerAttempted: true,
      rawSchemaValid: true,
      semanticValid: true,
      publicResponseValid: true,
      statusMatch: true,
      metricsMatch: true,
      candidatesMatch: true,
      candidateFeasible: true,
      preferredMatch,
      primaryReasonMatch: typeof primaryReason === "string",
      warningCodesMatch: true,
      mode: "AI_ASSISTED",
      fallbackReason: null,
      selectedOptionId,
      selectedReasonIds: primaryReason ? [primaryReason] : [],
      latencyMs: 125 + index,
      failureCategory: preferredMatch ? "NONE" : "ORACLE_MISMATCH",
    };
  });
  const count = results.filter((row) => row.providerAttempted).length;
  const providerCallsByRun = [{ runId, attempted: count, charged: count }];
  const summary = summarizeEvaluation({
    mode: "live-service",
    cases,
    results,
    providerAttemptedCount: count,
    chargedProviderCallCount: count,
    providerCallsByRun,
    providerPrerequisiteReady: true,
    selectedThreshold: threshold,
  });
  const adviceServiceSource = new URL("../financialAdvice/adviceService.ts", import.meta.url);
  return {
    schema: "financial-advice-evaluation-run",
    version: 2,
    runId,
    batchId,
    mode: "live-service",
    startedAtUtc: "2026-10-03T10:00:00.000Z",
    endedAtUtc: "2026-10-03T10:01:00.000Z",
    head: "a".repeat(40),
    branch: "codex/staging-academic-completion",
    datasetVersion: FINANCIAL_ADVICE_DATASET_VERSION,
    datasetHash: testHash(JSON.stringify(EVALUATION_CASES)),
    promptHash: testHash(ADVISOR_SYSTEM_PROMPT),
    policyVersion: FINANCIAL_ADVICE_POLICY_VERSION,
    calculationVersion: CALCULATION_VERSION,
    catalogVersion: CATALOG_VERSION,
    modelTag: "qwen3.5:4b",
    modelDigest: "b".repeat(64),
    providerPrerequisiteReady: true,
    providerAttemptedCount: count,
    chargedProviderCallCount: count,
    providerBudget: 10,
    quotaInvariant: true,
    threshold,
    thresholdSource: "PROVISIONAL",
    thresholdReference: null,
    config: {
      enabled: true,
      requestTimeoutMs: 30_000,
      providerTimeoutMs: 25_000,
      rateLimitPerMinute: 5,
      maxConcurrentRequests: 2,
      providerBudget: 10,
    },
    sourceManifest: [{
      path: "backend/src/financialAdvice/adviceService.ts",
      sha256: testHash(readFileSync(adviceServiceSource)),
    }],
    summary,
    results,
  };
}

function liveRows(appropriateCount: number): EvaluationResult[] {
  return EVALUATION_CASES.map((testCase, index) => {
    const appropriate = index < appropriateCount;
    const selectedOptionId = testCase.acceptablePreferredIds[0] ?? testCase.expectedCandidateIds[0]!;
    const primaryReason = testCase.oracle.primaryReasonByOption[selectedOptionId] ?? "REVIEW_DECLARED_INPUTS";
    return {
      caseId: testCase.id,
      batchId: "synthetic",
      runId: index < 8 ? "00000000-0000-4000-8000-000000000001" : "00000000-0000-4000-8000-000000000009",
      executionStatus: "PASS",
      providerAttempted: true,
      rawSchemaValid: appropriate,
      semanticValid: appropriate,
      publicResponseValid: true,
      statusMatch: true,
      metricsMatch: true,
      candidatesMatch: true,
      candidateFeasible: true,
      preferredMatch: true,
      primaryReasonMatch: true,
      warningCodesMatch: true,
      mode: appropriate ? "AI_ASSISTED" : "RULE_BASED",
      fallbackReason: appropriate ? null : "PROVIDER_INVALID_OUTPUT",
      selectedOptionId,
      selectedReasonIds: [primaryReason],
      latencyMs: 100 + index,
      failureCategory: appropriate ? "NONE" : "RAW_OUTPUT_INVALID",
    };
  });
}

function summarizeLive(rows: EvaluationResult[], threshold: EvaluationThreshold = "UNRESOLVED") {
  const runs = new Map<string, number>();
  for (const row of rows) if (row.providerAttempted) runs.set(row.runId, (runs.get(row.runId) ?? 0) + 1);
  return summarizeEvaluation({
    mode: "live-service",
    cases: EVALUATION_CASES,
    results: rows,
    providerAttemptedCount: rows.filter((row) => row.providerAttempted).length,
    chargedProviderCallCount: rows.filter((row) => row.providerAttempted).length,
    providerCallsByRun: [...runs].map(([runId, count]) => ({ runId, attempted: count, charged: count })),
    providerPrerequisiteReady: true,
    selectedThreshold: threshold,
  });
}

test("RFA-06 offline batch validates all 16 independent golden oracles", async () => {
  const run = await runFinancialAdviceBatch({
    cases: EVALUATION_CASES,
    batchId: "offline-all",
    runId: "00000000-0000-4000-8000-000000000002",
    mode: "offline",
    validatePublicResponse: fakePublicValidator,
  });
  const summary = summarizeEvaluation({
    mode: "offline", cases: EVALUATION_CASES, results: run.results,
    providerAttemptedCount: run.providerAttemptedCount,
    chargedProviderCallCount: run.chargedProviderCallCount,
    providerPrerequisiteReady: false, selectedThreshold: "UNRESOLVED",
  });
  assert.equal(FINANCIAL_ADVICE_DATASET_VERSION, "2026.10-fa-v2");
  assert.equal(run.results.length, 16);
  assert.equal(run.quotaInvariant, true);
  assert.equal(summary.complete, true);
  assert.equal(summary.productGate, "PASS");
  assert.equal(summary.offlineGate, "PASS");
  assert.equal(summary.liveGate, "NOT_APPLICABLE");
  assert.equal(summary.liveSelectorCount, 0);
  assert.equal(summary.exitCode, 0);
  assert.equal(summary.counts.providerAttempted, 0);
  assert.equal(summary.counts.providerCharged, 0);
  assert.equal(summary.counts.ruleBased, 16);
});

test("RFA-06 ratio reporting keeps 15/16 at 93.75% and 13/16 at 81.25%", () => {
  assert.equal(formatRatio(15, 16), "15/16 (93.75%)");
  assert.equal(formatRatio(13, 16), "13/16 (81.25%)");
  assert.equal(formatRatio(0, 0), "0/0 (N/A)");
  const summary = summarizeLive(liveRows(13));
  assert.equal(summary.counts.ruleBased, 3);
  assert.equal(summary.percentages.liveValidAppropriate, 81.25);
});

test("RFA-06 preserves distinct provisional 15/16 and 95% thresholds", () => {
  const at15 = summarizeLive(liveRows(15), "95_PERCENT");
  assert.equal(at15.threshold15Of16, "PASS");
  assert.equal(at15.threshold95Percent, "FAIL");
  assert.equal(at15.liveGate, "FAIL");
  assert.equal(at15.exitCode, 1);

  const at16 = summarizeLive(liveRows(16), "95_PERCENT");
  assert.equal(at16.threshold15Of16, "PASS");
  assert.equal(at16.threshold95Percent, "PASS");
  assert.equal(at16.liveGate, "PASS");
  assert.equal(at16.exitCode, 0);

  const min15 = summarizeLive(liveRows(15), "15_OF_16");
  assert.equal(min15.liveGate, "PASS");
});

test("RFA-06 14/16 fails the separate minimum-count threshold", () => {
  const summary = summarizeLive(liveRows(14), "15_OF_16");
  assert.equal(summary.threshold15Of16, "FAIL");
  assert.equal(summary.threshold95Percent, "FAIL");
  assert.equal(summary.exitCode, 1);
});

test("RFA-06 exception retains configured denominator and fails the gate", () => {
  const rows = liveRows(16);
  rows[15] = {
    ...rows[15]!,
    executionStatus: "FAIL",
    mode: null,
    rawSchemaValid: false,
    semanticValid: false,
    publicResponseValid: false,
    failureCategory: "CASE_EXECUTION_EXCEPTION",
  };
  const summary = summarizeLive(rows, "15_OF_16");
  assert.equal(summary.configuredCount, 16);
  assert.equal(summary.resultCount, 16);
  assert.equal(summary.complete, true);
  assert.equal(summary.counts.rowsPass, 15);
  assert.equal(summary.productGate, "FAIL");
  assert.equal(summary.liveGate, "FAIL");
});

test("RFA-06 all-provider-offline is BLOCKED, not a perfect live score", async () => {
  const run = await runFinancialAdviceBatch({
    cases: EVALUATION_CASES,
    batchId: "live-offline",
    runId: "00000000-0000-4000-8000-000000000003",
    mode: "live-service",
    validatePublicResponse: fakePublicValidator,
  });
  const summary = summarizeEvaluation({
    mode: "live-service", cases: EVALUATION_CASES, results: run.results,
    providerAttemptedCount: run.providerAttemptedCount,
    chargedProviderCallCount: run.chargedProviderCallCount,
    providerPrerequisiteReady: false, selectedThreshold: "UNRESOLVED",
  });
  assert.equal(summary.complete, true);
  assert.equal(summary.liveGate, "BLOCKED");
  assert.equal(summary.percentages.aiAssisted, 0);
  assert.equal(summary.percentages.liveValidAppropriate, 0);
  assert.equal(summary.exitCode, 2);
  assert.equal(summary.counts.ruleBased, 0);
  assert.ok(run.results.every((row) => row.executionStatus === "BLOCKED"));
});

test("RFA-06 safe fallback passes public/oracle checks but never counts as a live selector", async () => {
  const run = await runFinancialAdviceBatch({
    cases: [EVALUATION_CASES[0]!], batchId: "safe-fallback", runId: "00000000-0000-4000-8000-000000000004",
    mode: "offline", validatePublicResponse: fakePublicValidator,
  });
  const row = run.results[0]!;
  assert.equal(row.executionStatus, "PASS");
  assert.equal(row.publicResponseValid, true);
  assert.equal(row.metricsMatch, true);
  assert.equal(row.mode, "RULE_BASED");
  assert.equal(row.providerAttempted, false);
  assert.equal(row.rawSchemaValid, null);
});

test("RFA-06 AI_ASSISTED selection outside preferred/reason oracle fails", async () => {
  const testCase = EVALUATION_CASES.find((item) => item.id === "S-07")!;
  const service = new FinancialAdviceService(resolveAssistantConfig({ enabled: false }));
  const ruleResponse = await service.executeAdviceRequest(testCase.request);
  const response: FinancialAdviceResponse = {
    ...ruleResponse,
    preferredOptionId: "REDUCE_FLEXIBLE_SPENDING",
    explanation: { ...ruleResponse.explanation, mode: "AI_ASSISTED", reasonIds: ["MONTHLY_GAP"] },
  };
  const result = evaluateFinancialAdviceCase({
    testCase, batchId: "mutated", runId: "00000000-0000-4000-8000-000000000005",
    response, providerAttempted: true,
    rawOutput: { text: JSON.stringify({ preferredOptionId: "REDUCE_FLEXIBLE_SPENDING", reasonIds: ["MONTHLY_GAP"] }), finishReason: "stop" },
    latencyMs: 1, validatePublicResponse: fakePublicValidator,
  });
  assert.equal(result.preferredMatch, false);
  assert.equal(result.semanticValid, false);
  assert.equal(result.executionStatus, "FAIL");
  assert.notEqual(result.failureCategory, "NONE");
});

test("RFA-06 metrics invariance and public validation are measured, not assumed", async () => {
  const testCase = EVALUATION_CASES[0]!;
  const service = new FinancialAdviceService(resolveAssistantConfig({ enabled: false }));
  const actual = await service.executeAdviceRequest(testCase.request);
  const mutated = {
    ...actual,
    metrics: { ...actual.metrics, capacityAfterBufferMinor: "1500001" },
  } as FinancialAdviceResponse;
  const result = evaluateFinancialAdviceCase({
    testCase, batchId: "mutated-metrics", runId: "00000000-0000-4000-8000-000000000006",
    response: mutated, providerAttempted: false, rawOutput: null, latencyMs: 3,
    validatePublicResponse: () => false,
  });
  assert.equal(result.metricsMatch, false);
  assert.equal(result.publicResponseValid, false);
  assert.equal(result.executionStatus, "FAIL");
});

test("RFA-06 live batches enforce the real ten-call quota and release every slot", async () => {
  const firstCase = EVALUATION_CASES[0]!;
  const cases = Array.from({ length: 11 }, () => firstCase);
  const provider = new FakeAssistantHelpProvider({
    defaultAnswer: JSON.stringify({ preferredOptionId: "EXTEND_DEADLINE", reasonIds: ["MONTHLY_GAP"] }),
  });
  const run = await runFinancialAdviceBatch({
    cases, batchId: "quota-11", runId: "00000000-0000-4000-8000-000000000007",
    mode: "live-service", provider, validatePublicResponse: fakePublicValidator,
  });
  assert.equal(run.providerAttemptedCount, 10);
  assert.equal(run.chargedProviderCallCount, 10);
  assert.equal(provider.callCount, 10);
  assert.equal(run.quotaInvariant, true);
  assert.equal(run.activeConcurrencyAfter, 0);
  assert.ok(run.activeConcurrencyByUserAfter.every((active) => active === 0));
  assert.equal(run.results.length, 11);
  assert.equal(run.results[10]!.mode, "RULE_BASED");
  assert.equal(run.results[10]!.fallbackReason, "PROVIDER_BUDGET_EXHAUSTED");
  assert.equal(run.results[10]!.providerAttempted, false);
});

test("RFA-06 report allowlists metadata and never prints arbitrary error or selector text", () => {
  const rows = liveRows(15);
  rows[0] = {
    ...rows[0]!,
    caseId: "API_KEY=secret" as unknown as string,
    selectedOptionId: "API_KEY" as unknown as string,
    selectedReasonIds: ["SECRET_TOKEN"],
    failureCategory: "RAW ERROR: database password" as unknown as EvaluationResult["failureCategory"],
  };
  const summary = summarizeLive(rows, "UNRESOLVED");
  const report = renderEvaluationReport({
    runId: "00000000-0000-4000-8000-000000000008",
    timestampUtc: "2026-10-03T12:00:00.000Z",
    timestampBangkok: "2026-10-03 19:00:00 +07:00",
    head: "a".repeat(40), branch: "codex/feature-test",
    datasetVersion: FINANCIAL_ADVICE_DATASET_VERSION, datasetHash: "b".repeat(64),
    policyVersion: "fa-selection-v2", promptHash: "c".repeat(64),
    calculationVersion: "fa-calc-v1", catalogVersion: "fa-catalog-v2",
    modelTag: "qwen3.5:4b", modelDigest: null,
    command: "untrusted command with secret", batchId: "all", mode: "live-service",
    threshold: "UNRESOLVED", thresholdSource: "PROVISIONAL",
    config: { enabled: true, requestTimeoutMs: 12000, providerTimeoutMs: 10000, rateLimitPerMinute: 5, maxConcurrentRequests: 2, providerBudget: 10 },
    summary, results: rows, sourceManifest: [{ path: "backend/src/financialAdvice/adviceService.ts", sha256: "d".repeat(64) }], nodeVersion: "v24.19.0",
  });
  assert.match(report, /UNKNOWN_CASE/);
  assert.doesNotMatch(report, /API_KEY=secret|SECRET_TOKEN|database password|untrusted command/);
  assert.match(report, /15\/16 \(93\.75%\)/);
  assert.match(report, /95% on 16 cases requires 16\/16/);
});

test("RFA-06 a batch or zero-case set cannot be reported as a live acceptance", () => {
  const summary = summarizeEvaluation({
    mode: "live-service", cases: [EVALUATION_CASES[0]!], results: liveRows(1).slice(0, 1),
    providerAttemptedCount: 1, chargedProviderCallCount: 1,
    providerPrerequisiteReady: true, selectedThreshold: "15_OF_16",
  });
  assert.equal(summary.threshold15Of16, "BLOCKED");
  assert.equal(summary.liveGate, "BLOCKED");
  assert.equal(summary.exitCode, 2);
  const empty = summarizeEvaluation({
    mode: "offline", cases: [], results: [], providerAttemptedCount: 0,
    chargedProviderCallCount: 0, providerPrerequisiteReady: false,
    selectedThreshold: "UNRESOLVED",
  });
  assert.equal(empty.percentages.aiAssisted, null);
  assert.equal(empty.exitCode, 1);
});

test("NFA-03-AGG-01 aggregates exact savings 8 plus budget 8 with independent per-run quotas", () => {
  const result = aggregateEvaluationReports(
    aggregateRun("savings", "00000000-0000-4000-8000-000000000101", 7, "15_OF_16"),
    aggregateRun("budget", "00000000-0000-4000-8000-000000000102", 8, "15_OF_16"),
  );
  assert.equal(result.summary.resultCount, 16);
  assert.equal(result.summary.configuredCount, 16);
  assert.equal(result.summary.liveSelectorCount, 15);
  assert.equal(result.summary.productGate, "PASS");
  assert.equal(result.summary.threshold15Of16, "PASS");
  assert.equal(result.summary.threshold95Percent, "FAIL");
  assert.equal(result.summary.liveGate, "PASS");
  assert.deepEqual(result.inputRuns.map((run) => run.batchId), ["savings", "budget"]);
  assert.ok(result.inputRuns.every((run) => run.providerAttemptedCount <= 10 && run.chargedProviderCallCount === run.providerAttemptedCount));
});

test("NFA-03-AGG-02 distinguishes 15-of-16, 95-percent, and unresolved thresholds", () => {
  const savings15 = aggregateRun("savings", "00000000-0000-4000-8000-000000000111", 7, "95_PERCENT");
  const budget16 = aggregateRun("budget", "00000000-0000-4000-8000-000000000112", 8, "95_PERCENT");
  const at15 = aggregateEvaluationReports(savings15, budget16);
  assert.equal(at15.summary.threshold15Of16, "PASS");
  assert.equal(at15.summary.threshold95Percent, "FAIL");
  assert.equal(at15.summary.liveGate, "FAIL");

  const all16 = aggregateEvaluationReports(
    aggregateRun("savings", "00000000-0000-4000-8000-000000000113", 8, "95_PERCENT"),
    aggregateRun("budget", "00000000-0000-4000-8000-000000000114", 8, "95_PERCENT"),
  );
  assert.equal(all16.summary.threshold95Percent, "PASS");
  assert.equal(all16.summary.liveGate, "PASS");

  const unresolved = aggregateEvaluationReports(
    aggregateRun("savings", "00000000-0000-4000-8000-000000000115", 8),
    aggregateRun("budget", "00000000-0000-4000-8000-000000000116", 8),
  );
  assert.equal(unresolved.summary.liveGate, "BLOCKED");
  assert.equal(unresolved.summary.exitCode, 2);
});

test("NFA-03-AGG-03 rejects 14-of-16 and keeps exception/fallback rows in N=16", () => {
  const savings = aggregateRun("savings", "00000000-0000-4000-8000-000000000121", 6, "15_OF_16");
  const budget = aggregateRun("budget", "00000000-0000-4000-8000-000000000122", 8, "15_OF_16");
  const result = aggregateEvaluationReports(savings, budget);
  assert.equal(result.summary.resultCount, 16);
  assert.equal(result.summary.liveSelectorCount, 14);
  assert.equal(result.summary.threshold15Of16, "FAIL");
  assert.equal(result.summary.liveGate, "FAIL");

  const exceptionSavings = aggregateRun("savings", "00000000-0000-4000-8000-000000000123", 8);
  const exceptionRow = exceptionSavings.results[0]!;
  Object.assign(exceptionRow, {
    executionStatus: "FAIL",
    providerAttempted: true,
    rawSchemaValid: false,
    semanticValid: false,
    mode: null,
    fallbackReason: "PROVIDER_TIMEOUT",
    selectedOptionId: null,
    selectedReasonIds: [],
    preferredMatch: false,
    primaryReasonMatch: false,
    failureCategory: "CASE_EXECUTION_EXCEPTION",
  });
  const cases = EVALUATION_CASES.filter((item) => item.kind === "SAVINGS_PLAN");
  const attempted = exceptionSavings.results.filter((row) => row.providerAttempted).length;
  exceptionSavings.providerAttemptedCount = attempted;
  exceptionSavings.chargedProviderCallCount = attempted;
  exceptionSavings.summary = summarizeEvaluation({
    mode: "live-service", cases, results: exceptionSavings.results,
    providerAttemptedCount: attempted, chargedProviderCallCount: attempted,
    providerCallsByRun: [{ runId: exceptionSavings.runId, attempted, charged: attempted }],
    providerPrerequisiteReady: true, selectedThreshold: "UNRESOLVED",
  });
  const withException = aggregateEvaluationReports(exceptionSavings, aggregateRun("budget", "00000000-0000-4000-8000-000000000124", 8));
  assert.equal(withException.summary.resultCount, 16);
  assert.equal(withException.results.length, 16);
  assert.equal(withException.results[0]?.failureCategory, "CASE_EXECUTION_EXCEPTION");
});

test("NFA-03-AGG-04 rejects missing, duplicate, unknown, offline, provenance, and quota-invalid reports", () => {
  const baseSavings = aggregateRun("savings", "00000000-0000-4000-8000-000000000131", 8);
  const baseBudget = aggregateRun("budget", "00000000-0000-4000-8000-000000000132", 8);

  const missing = structuredClone(baseSavings);
  missing.results.pop();
  assert.throws(() => aggregateEvaluationReports(missing, baseBudget));

  const duplicate = structuredClone(baseSavings);
  duplicate.results[7]!.caseId = duplicate.results[0]!.caseId;
  assert.throws(() => aggregateEvaluationReports(duplicate, baseBudget));

  const unknown = structuredClone(baseSavings);
  unknown.results[0]!.caseId = "S-99";
  assert.throws(() => aggregateEvaluationReports(unknown, baseBudget));

  for (const mutate of [
    (report: typeof baseBudget) => { report.mode = "offline"; },
    (report: typeof baseBudget) => { report.modelDigest = "c".repeat(64); },
    (report: typeof baseBudget) => { report.promptHash = "d".repeat(64); },
    (report: typeof baseBudget) => { report.config.requestTimeoutMs = 31_000; },
    (report: typeof baseBudget) => { (report.results[0] as EvaluationResult & { unexpected?: boolean }).unexpected = true; },
    (report: typeof baseBudget) => { report.providerAttemptedCount = 11; report.chargedProviderCallCount = 11; },
  ]) {
    const changed = structuredClone(baseBudget);
    mutate(changed);
    assert.throws(() => aggregateEvaluationReports(baseSavings, changed));
  }
});

test("NFA-03-AGG-05 refuses to overwrite an existing aggregate evidence file", () => {
  const aggregate = aggregateEvaluationReports(
    aggregateRun("savings", "00000000-0000-4000-8000-000000000141", 8),
    aggregateRun("budget", "00000000-0000-4000-8000-000000000142", 8),
  );
  const directory = mkdtempSync(path.join(os.tmpdir(), "financial-advice-aggregate-test-"));
  try {
    const first = writeAggregateReports(directory, aggregate, ["savings.json", "budget.json"], "unique-evidence");
    const original = readFileSync(first.jsonPath, "utf8");
    const originalMarkdown = readFileSync(first.markdownPath, "utf8");
    assert.throws(() => writeAggregateReports(directory, aggregate, ["savings.json", "budget.json"], "unique-evidence"));
    assert.equal(readFileSync(first.jsonPath, "utf8"), original);
    assert.equal(readFileSync(first.markdownPath, "utf8"), originalMarkdown);
    assert.equal(existsSync(first.markdownPath), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

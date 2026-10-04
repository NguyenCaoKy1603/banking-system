import { isDeepStrictEqual } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictAIOutput, parseAISelectorSchema } from "../../financialAdvice/selectorValidation.js";
import { buildSelectionPolicy } from "../../financialAdvice/selectionPolicy.js";
import type {
  FinancialAdviceOption,
  FinancialAdviceResponse,
  FinancialOptionId,
} from "../../financialAdvice/types.js";
import {
  EVALUATION_CASES,
  FINANCIAL_ADVICE_DATASET_VERSION,
  type EvaluationCase,
} from "./dataset.js";
import { ADVISOR_SYSTEM_PROMPT } from "../../financialAdvice/advisorPrompt.js";
import { CALCULATION_VERSION, CATALOG_VERSION } from "../../financialAdvice/explanationCatalog.js";
import { FINANCIAL_ADVICE_POLICY_VERSION } from "../../financialAdvice/selectionPolicy.js";

export type EvaluationMode = "offline" | "live-service";
export type ExecutionStatus = "PASS" | "FAIL" | "BLOCKED" | "SKIPPED";
export type FailureCategory =
  | "NONE"
  | "CASE_EXECUTION_EXCEPTION"
  | "PROVIDER_OFFLINE"
  | "PROVIDER_BUDGET_EXHAUSTED"
  | "RAW_OUTPUT_INVALID"
  | "PUBLIC_RESPONSE_INVALID"
  | "ORACLE_MISMATCH";

export type EvaluationResult = {
  caseId: string;
  batchId: string;
  runId: string;
  executionStatus: ExecutionStatus;
  providerAttempted: boolean;
  rawSchemaValid: boolean | null;
  semanticValid: boolean | null;
  publicResponseValid: boolean;
  statusMatch: boolean;
  metricsMatch: boolean;
  candidatesMatch: boolean;
  candidateFeasible: boolean;
  preferredMatch: boolean;
  primaryReasonMatch: boolean;
  warningCodesMatch: boolean;
  mode: "AI_ASSISTED" | "RULE_BASED" | null;
  fallbackReason: string | null;
  selectedOptionId: string | null;
  selectedReasonIds: string[];
  latencyMs: number;
  failureCategory: FailureCategory;
};

export type EvaluationThreshold = "15_OF_16" | "95_PERCENT" | "UNRESOLVED";

export type EvaluationSummary = {
  mode: EvaluationMode;
  configuredCount: number;
  resultCount: number;
  complete: boolean;
  duplicateCaseIds: string[];
  missingCaseIds: string[];
  counts: Record<string, number>;
  percentages: Record<string, number | null>;
  quotaInvariant: boolean;
  providerCallsByRun: Array<{ runId: string; attempted: number; charged: number }>;
  latencyMs: { min: number | null; median: number | null; max: number | null; average: number | null };
  liveSelectorCount: number;
  threshold15Of16: "PASS" | "FAIL" | "BLOCKED";
  threshold95Percent: "PASS" | "FAIL" | "BLOCKED";
  selectedThreshold: EvaluationThreshold;
  productGate: "PASS" | "FAIL";
  offlineGate: "PASS" | "FAIL" | "NOT_APPLICABLE";
  liveGate: "PASS" | "FAIL" | "BLOCKED" | "NOT_APPLICABLE";
  exitCode: 0 | 1 | 2;
};

export type PublicResponseValidator = (value: unknown) => boolean;

function responsePolicyFacts(response: FinancialAdviceResponse) {
  const capacity = BigInt(response.metrics.capacityAfterBufferMinor);
  const bufferShortfall = BigInt(response.metrics.bufferShortfallMinor);
  if (response.kind === "SAVINGS_PLAN") {
    return {
      alreadyFunded: response.goalStatus === "ALREADY_FUNDED",
      isFeasible: response.goalStatus === "FEASIBLE",
      isBudgetMet: false,
      hasMonthlyGap: response.goalStatus === "GAP",
      baseDeficit: response.budgetStatus === "DEFICIT",
      bufferShortfall: bufferShortfall > 0n,
      noCapacity: capacity <= 0n,
    };
  }
  return {
    alreadyFunded: false,
    isFeasible: false,
    isBudgetMet: response.savingsTargetStatus === "MET",
    hasMonthlyGap: response.savingsTargetStatus === "GAP",
    baseDeficit: response.budgetStatus === "DEFICIT",
    bufferShortfall: bufferShortfall > 0n,
    noCapacity: capacity <= 0n,
  };
}

function bigIntField(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function candidateIsFeasible(
  testCase: EvaluationCase,
  option: FinancialAdviceOption,
): boolean {
  const request = testCase.request;
  const changes = option.changes;
  const capacity = BigInt(testCase.oracle.metrics.capacityAfterBufferMinor as string);
  if (request.kind === "SAVINGS_PLAN") {
    const remaining = BigInt(testCase.oracle.metrics.remainingGoalMinor as string);
    const required = BigInt(testCase.oracle.metrics.requiredMonthlySavingsMinor as string);
    const flexible = BigInt(request.flexibleExpensesMinor);
    switch (option.id) {
      case "GOAL_ALREADY_FUNDED":
        return remaining === 0n && Object.keys(changes).length === 0;
      case "MAINTAIN_PLAN": {
        const amount = bigIntField(changes.monthlySavingsMinor);
        const reserve = bigIntField(changes.remainingBufferMinor);
        return amount !== null && reserve !== null && amount >= required && amount <= capacity && reserve === capacity - amount;
      }
      case "EXTEND_DEADLINE": {
        const months = changes.months;
        return typeof months === "number" && Number.isInteger(months) && months >= request.goal.months && months <= 120 &&
          (remaining === 0n || (capacity > 0n && (remaining + BigInt(months) - 1n) / BigInt(months) <= capacity));
      }
      case "REDUCE_FLEXIBLE_SPENDING": {
        const reduction = bigIntField(changes.reductionMinor);
        const newFlexible = bigIntField(changes.newFlexibleExpensesMinor);
        return reduction !== null && newFlexible !== null && reduction > 0n && reduction <= flexible &&
          newFlexible === flexible - reduction && capacity + reduction >= required;
      }
      case "LOWER_GOAL_AMOUNT": {
        const target = bigIntField(changes.targetAmountMinor);
        const achievable = BigInt(testCase.oracle.metrics.achievableGoalAtDeadlineMinor as string);
        return target !== null && target === achievable && target >= BigInt(request.goal.alreadySavedMinor);
      }
      case "REVIEW_BASE_BUDGET":
        return capacity <= 0n || testCase.expectedCandidateIds.length === 1;
      default:
        return false;
    }
  }

  const target = BigInt(request.monthlySavingsTargetMinor);
  const flexible = BigInt(request.flexibleExpensesMinor);
  switch (option.id) {
    case "MAINTAIN_BUDGET": {
      const amount = bigIntField(changes.monthlySavingsTargetMinor);
      const remainder = bigIntField(changes.remainingAfterTargetMinor);
      return amount !== null && remainder !== null && amount === target && capacity >= target && remainder === capacity - target;
    }
    case "REDUCE_FLEXIBLE_SPENDING": {
      const reduction = bigIntField(changes.reductionMinor);
      const newFlexible = bigIntField(changes.newFlexibleExpensesMinor);
      return reduction !== null && newFlexible !== null && reduction > 0n && reduction <= flexible &&
        newFlexible === flexible - reduction && capacity + reduction >= target;
    }
    case "ADJUST_SAVINGS_TARGET": {
      const amount = bigIntField(changes.monthlySavingsTargetMinor);
      return amount !== null && capacity >= 0n && capacity < target && amount === capacity;
    }
    case "REVIEW_BASE_BUDGET":
      return capacity < 0n || testCase.expectedCandidateIds.length === 1;
    default:
      return false;
  }
}

function safeMode(value: unknown): "AI_ASSISTED" | "RULE_BASED" | null {
  return value === "AI_ASSISTED" || value === "RULE_BASED" ? value : null;
}

export function evaluateFinancialAdviceCase(input: {
  testCase: EvaluationCase;
  batchId: string;
  runId: string;
  response: FinancialAdviceResponse;
  providerAttempted: boolean;
  rawOutput: { text: string; finishReason: string; toolCallsDetected?: boolean } | null;
  latencyMs: number;
  validatePublicResponse: PublicResponseValidator;
}): EvaluationResult {
  const { testCase, response, rawOutput } = input;
  let rawSchemaValid: boolean | null = null;
  let semanticValid: boolean | null = null;
  let parsedSelector: ReturnType<typeof parseAISelectorSchema> | null = null;
  if (input.providerAttempted) {
    rawSchemaValid = false;
    semanticValid = false;
    if (rawOutput) {
      try {
        parsedSelector = parseAISelectorSchema(rawOutput.text);
        rawSchemaValid = true;
      } catch {
        // Keep only the closed validity result; provider text is never retained in evidence.
      }
      if (rawSchemaValid && rawOutput.finishReason === "stop" && rawOutput.toolCallsDetected !== true) {
        try {
          const policy = buildSelectionPolicy(requestForPolicy(testCase), response.options, responsePolicyFacts(response));
          parseStrictAIOutput(rawOutput.text, policy);
          semanticValid = true;
        } catch {
          semanticValid = false;
        }
      }
    }
  }

  const serializedResponse = JSON.stringify(response);
  const noRawProviderText = !rawOutput?.text || !serializedResponse.includes(rawOutput.text);
  let publicResponseValid = false;
  try {
    publicResponseValid = input.validatePublicResponse(response) && noRawProviderText;
  } catch {
    publicResponseValid = false;
  }

  const actualStatus = response.kind === "SAVINGS_PLAN" ? response.goalStatus : response.budgetStatus;
  const statusMatch = actualStatus === testCase.expectedStatus && response.budgetStatus === testCase.oracle.budgetStatus;
  const metricsMatch = isDeepStrictEqual(response.metrics, testCase.oracle.metrics);
  const actualIds = response.options.map((option) => option.id);
  const expectedChanges = testCase.oracle.candidateChanges;
  const actualChanges = Object.fromEntries(response.options.map((option) => [option.id, option.changes]));
  const candidatesMatch = isDeepStrictEqual([...actualIds].sort(), [...testCase.expectedCandidateIds].sort()) &&
    isDeepStrictEqual(actualChanges, expectedChanges);
  const candidateFeasible = response.options.every((option) => candidateIsFeasible(testCase, option));
  const preferredMatch = testCase.acceptablePreferredIds.includes(response.preferredOptionId as FinancialOptionId);
  const requiredPrimaryReason = testCase.oracle.primaryReasonByOption[response.preferredOptionId];
  const primaryReasonMatch = typeof requiredPrimaryReason === "string" && response.explanation.reasonIds.includes(requiredPrimaryReason as never);
  const warningCodes = response.warnings.map((warning) => warning.code);
  const warningCodesMatch = isDeepStrictEqual(warningCodes, testCase.oracle.warningCodes);
  const outputContractInvalid = input.providerAttempted && (rawSchemaValid !== true || semanticValid !== true);
  const oracleMismatch = !statusMatch || !metricsMatch || !candidatesMatch || !candidateFeasible ||
    !preferredMatch || !primaryReasonMatch || !warningCodesMatch;
  const executionStatus = publicResponseValid && !oracleMismatch ? "PASS" : "FAIL";
  const failureCategory: FailureCategory = !publicResponseValid
    ? "PUBLIC_RESPONSE_INVALID"
    : outputContractInvalid
      ? "RAW_OUTPUT_INVALID"
      : oracleMismatch
        ? "ORACLE_MISMATCH"
        : "NONE";

  return {
    caseId: testCase.id,
    batchId: input.batchId,
    runId: input.runId,
    executionStatus,
    providerAttempted: input.providerAttempted,
    rawSchemaValid,
    semanticValid,
    publicResponseValid,
    statusMatch,
    metricsMatch,
    candidatesMatch,
    candidateFeasible,
    preferredMatch,
    primaryReasonMatch,
    warningCodesMatch,
    mode: safeMode(response.explanation.mode),
    fallbackReason: typeof response.explanation.fallbackReason === "string" ? response.explanation.fallbackReason : null,
    selectedOptionId: testCase.expectedCandidateIds.includes(response.preferredOptionId) ? response.preferredOptionId : null,
    selectedReasonIds: response.explanation.reasonIds.filter((id) => typeof id === "string").slice(0, 3),
    latencyMs: Number.isFinite(input.latencyMs) && input.latencyMs >= 0 ? Math.round(input.latencyMs) : 0,
    failureCategory,
  };
}

function requestForPolicy(testCase: EvaluationCase) {
  return testCase.request;
}

export function blockedEvaluationResult(
  testCase: EvaluationCase,
  batchId: string,
  runId: string,
  category: FailureCategory,
): EvaluationResult {
  return {
    caseId: testCase.id, batchId, runId,
    executionStatus: "BLOCKED", providerAttempted: false,
    rawSchemaValid: null, semanticValid: null,
    publicResponseValid: false, statusMatch: false, metricsMatch: false,
    candidatesMatch: false, candidateFeasible: false, preferredMatch: false,
    primaryReasonMatch: false, warningCodesMatch: false,
    mode: null, fallbackReason: null, selectedOptionId: null, selectedReasonIds: [],
    latencyMs: 0, failureCategory: category,
  };
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function summarizeEvaluation(input: {
  mode: EvaluationMode;
  cases: readonly EvaluationCase[];
  results: readonly EvaluationResult[];
  providerAttemptedCount: number;
  chargedProviderCallCount: number;
  providerCallsByRun?: readonly { runId: string; attempted: number; charged: number }[];
  providerPrerequisiteReady: boolean;
  selectedThreshold: EvaluationThreshold;
}): EvaluationSummary {
  const caseIds = input.cases.map((testCase) => testCase.id);
  const resultIds = input.results.map((result) => result.caseId);
  const duplicates = resultIds.filter((id, index) => resultIds.indexOf(id) !== index);
  const missing = caseIds.filter((id) => !resultIds.includes(id));
  const complete = input.results.length === input.cases.length && duplicates.length === 0 && missing.length === 0 &&
    caseIds.every((id) => resultIds.filter((resultId) => resultId === id).length === 1);
  const rows = input.results;
  const n = input.cases.length;
  const attemptedRows = rows.filter((row) => row.providerAttempted);
  const derivedRuns = input.providerCallsByRun ?? (rows.length
    ? [{
        runId: rows[0]!.runId,
        attempted: input.providerAttemptedCount,
        charged: input.chargedProviderCallCount,
      }]
    : []);
  const runIds = derivedRuns.map((run) => run.runId);
  const duplicateRunIds = runIds.filter((id, index) => runIds.indexOf(id) !== index);
  const countsByRun = new Map<string, number>();
  for (const row of rows) if (row.providerAttempted) countsByRun.set(row.runId, (countsByRun.get(row.runId) ?? 0) + 1);
  const quotaInvariant = duplicateRunIds.length === 0 &&
    derivedRuns.reduce((sum, run) => sum + run.attempted, 0) === input.providerAttemptedCount &&
    derivedRuns.reduce((sum, run) => sum + run.charged, 0) === input.chargedProviderCallCount &&
    derivedRuns.every((run) => Number.isSafeInteger(run.attempted) && Number.isSafeInteger(run.charged) &&
      run.attempted >= 0 && run.charged === run.attempted && run.attempted <= 10 &&
      (countsByRun.get(run.runId) ?? 0) === run.attempted) &&
    [...countsByRun.keys()].every((id) => runIds.includes(id));
  const count = (predicate: (row: EvaluationResult) => boolean) => rows.filter(predicate).length;
  const liveSelector = (row: EvaluationResult) => row.providerAttempted && row.rawSchemaValid === true &&
    row.semanticValid === true && row.mode === "AI_ASSISTED" && row.preferredMatch && row.primaryReasonMatch;
  const liveSelectorCount = count(liveSelector);
  const counts: Record<string, number> = {
    providerAttempted: input.providerAttemptedCount,
    providerAttemptedRows: count((row) => row.providerAttempted),
    providerCharged: input.chargedProviderCallCount,
    aiAssisted: count((row) => row.mode === "AI_ASSISTED"),
    ruleBased: count((row) => row.mode === "RULE_BASED"),
    rawSchemaValid: count((row) => row.rawSchemaValid === true),
    semanticValid: count((row) => row.semanticValid === true),
    statusMatch: count((row) => row.statusMatch),
    metricsMatch: count((row) => row.metricsMatch),
    candidatesMatch: count((row) => row.candidatesMatch),
    candidateFeasible: count((row) => row.candidateFeasible),
    preferredMatch: count((row) => row.preferredMatch),
    primaryReasonMatch: count((row) => row.primaryReasonMatch),
    warningCodesMatch: count((row) => row.warningCodesMatch),
    publicResponseValid: count((row) => row.publicResponseValid),
    rowsPass: count((row) => row.executionStatus === "PASS"),
  };
  const percentages: Record<string, number | null> = {
    providerAttempted: ratio(input.providerAttemptedCount, n),
    aiAssisted: ratio(count((row) => row.mode === "AI_ASSISTED"), n),
    ruleBased: ratio(count((row) => row.mode === "RULE_BASED"), n),
    rawSchemaValidOfAttempted: ratio(count((row) => row.rawSchemaValid === true), attemptedRows.length),
    rawSchemaValidOfConfigured: ratio(count((row) => row.rawSchemaValid === true), n),
    semanticValidOfAttempted: ratio(count((row) => row.semanticValid === true), attemptedRows.length),
    semanticValidOfConfigured: ratio(count((row) => row.semanticValid === true), n),
    liveValidAppropriate: ratio(liveSelectorCount, n),
    statusMatch: ratio(count((row) => row.statusMatch), n),
    metricsMatch: ratio(count((row) => row.metricsMatch), n),
    candidatesMatch: ratio(count((row) => row.candidatesMatch && row.candidateFeasible), n),
    preferredMatch: ratio(count((row) => row.preferredMatch), n),
    publicResponseValid: ratio(count((row) => row.publicResponseValid), n),
  };
  const latencies = rows.filter((row) => row.executionStatus !== "BLOCKED" && row.executionStatus !== "SKIPPED").map((row) => row.latencyMs);
  const productGate = n > 0 && complete && rows.length === n && counts.statusMatch === n && counts.metricsMatch === n &&
    counts.candidatesMatch === n && counts.candidateFeasible === n && counts.warningCodesMatch === n &&
    counts.publicResponseValid === n && quotaInvariant &&
    counts.providerAttemptedRows === input.providerAttemptedCount
    ? "PASS" : "FAIL";
  const offlineGate = input.mode === "offline"
    ? productGate === "PASS" && input.providerAttemptedCount === 0 && input.chargedProviderCallCount === 0 &&
      counts.aiAssisted === 0 && counts.ruleBased === n ? "PASS" : "FAIL"
    : "NOT_APPLICABLE";
  const threshold15 = input.mode !== "live-service" || n !== 16 ? "BLOCKED" : !input.providerPrerequisiteReady ? "BLOCKED" : liveSelectorCount >= 15 ? "PASS" : "FAIL";
  const threshold95 = input.mode !== "live-service" || n !== 16 ? "BLOCKED" : !input.providerPrerequisiteReady ? "BLOCKED" :
    liveSelectorCount / (n || 1) >= 0.95 ? "PASS" : "FAIL";
  let liveGate: EvaluationSummary["liveGate"] = "NOT_APPLICABLE";
  if (input.mode === "live-service") {
    if (!input.providerPrerequisiteReady || input.selectedThreshold === "UNRESOLVED" || n !== 16) liveGate = "BLOCKED";
    else {
      const selectedThresholdPass = input.selectedThreshold === "15_OF_16" ? threshold15 === "PASS" : threshold95 === "PASS";
      liveGate = productGate === "PASS" && selectedThresholdPass ? "PASS" : "FAIL";
    }
  }
  const exitCode: 0 | 1 | 2 = input.mode === "offline"
    ? offlineGate === "PASS" ? 0 : 1
    : !input.providerPrerequisiteReady || input.selectedThreshold === "UNRESOLVED" || n !== 16 || liveGate === "BLOCKED" ? 2
      : liveGate === "PASS" ? 0 : 1;
  return {
    mode: input.mode, configuredCount: n, resultCount: rows.length, complete,
    duplicateCaseIds: [...new Set(duplicates)], missingCaseIds: [...new Set(missing)],
    counts, percentages, quotaInvariant, providerCallsByRun: [...derivedRuns],
    latencyMs: {
      min: latencies.length ? Math.min(...latencies) : null,
      median: median(latencies),
      max: latencies.length ? Math.max(...latencies) : null,
      average: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null,
    },
    liveSelectorCount, threshold15Of16: threshold15, threshold95Percent: threshold95,
    selectedThreshold: input.selectedThreshold, productGate, offlineGate, liveGate, exitCode,
  };
}

export function formatRatio(numerator: number, denominator: number): string {
  const percentage = ratio(numerator, denominator);
  return percentage === null ? `${numerator}/${denominator} (N/A)` :
    `${numerator}/${denominator} (${percentage.toFixed(2).replace(/\.00$/, "")}%)`;
}

function safeCaseId(value: unknown): string {
  return typeof value === "string" && /^[SB]-\d{2}$/.test(value) ? value : "UNKNOWN_CASE";
}

function safeChoice(value: unknown, choices: readonly string[], fallback = "UNKNOWN"): string {
  return typeof value === "string" && choices.includes(value) ? value : fallback;
}

function safeRunId(value: string): string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value : "invalid-run-id";
}

function safeCommit(value: string | null): string {
  return value && /^[0-9a-f]{40}$/i.test(value) ? value : "unavailable";
}

function safeBranch(value: string | null): string {
  return value && /^codex\/[a-z0-9._/-]{1,80}$/i.test(value) ? value : "unavailable";
}

function safeModelDigest(value: string | null): string {
  return value && /^[0-9a-f]{64}$/i.test(value) ? value : "unavailable";
}

function formatMaybe(value: number | null): string {
  return value === null ? "N/A" : `${Math.round(value * 100) / 100} ms`;
}

export function renderEvaluationReport(input: {
  runId: string;
  timestampUtc: string;
  timestampBangkok: string;
  head: string | null;
  branch: string | null;
  datasetVersion: string;
  datasetHash: string;
  policyVersion: string;
  promptHash: string;
  calculationVersion: string;
  catalogVersion: string;
  modelTag: string;
  modelDigest: string | null;
  command: string;
  batchId: string;
  mode: EvaluationMode;
  threshold: EvaluationThreshold;
  thresholdSource: string;
  config: {
    enabled: boolean;
    requestTimeoutMs: number;
    providerTimeoutMs: number;
    rateLimitPerMinute: number;
    maxConcurrentRequests: number;
    providerBudget: number;
  };
  summary: EvaluationSummary;
  results: readonly EvaluationResult[];
  sourceManifest: readonly { path: string; sha256: string }[];
  nodeVersion: string;
}): string {
  const resultRows = input.results.map((row) => {
    const mode = safeChoice(row.mode, ["AI_ASSISTED", "RULE_BASED"], "NOT_RUN");
    const fallback = safeChoice(row.fallbackReason, [
      "AI_DISABLED", "PROVIDER_UNAVAILABLE", "PROVIDER_TIMEOUT", "PROVIDER_INVALID_OUTPUT", "PROVIDER_BUDGET_EXHAUSTED",
    ], "NONE");
    const status = safeChoice(row.executionStatus, ["PASS", "FAIL", "BLOCKED", "SKIPPED"], "FAIL");
    const category = safeChoice(row.failureCategory, [
      "NONE", "CASE_EXECUTION_EXCEPTION", "PROVIDER_OFFLINE", "PROVIDER_BUDGET_EXHAUSTED", "RAW_OUTPUT_INVALID", "PUBLIC_RESPONSE_INVALID", "ORACLE_MISMATCH",
    ], "CASE_EXECUTION_EXCEPTION");
    const knownReasons = new Set(["TARGET_ALREADY_FUNDED", "MONTHLY_GAP", "GOAL_FEASIBLE", "BUDGET_TARGET_MET", "BASE_BUDGET_DEFICIT", "BUFFER_NOT_COVERED", "NO_SAVING_CAPACITY", "PRESERVE_CURRENT_SPENDING", "KEEP_TARGET_WITH_FLEXIBLE_CUT", "ADJUST_GOAL_TO_CAPACITY", "EXTEND_TIME_TO_CAPACITY", "REVIEW_DECLARED_INPUTS"]);
    const knownOptions = new Set(["MAINTAIN_PLAN", "GOAL_ALREADY_FUNDED", "EXTEND_DEADLINE", "REDUCE_FLEXIBLE_SPENDING", "LOWER_GOAL_AMOUNT", "REVIEW_BASE_BUDGET", "MAINTAIN_BUDGET", "ADJUST_SAVINGS_TARGET"]);
    const reasons = row.selectedReasonIds.filter((reason) => knownReasons.has(reason)).join(",") || "NONE";
    const option = row.selectedOptionId && knownOptions.has(row.selectedOptionId) ? row.selectedOptionId : "NONE";
    const batch = safeChoice(row.batchId, ["all", "savings", "budget", "repeat", "offline-all"], "unknown");
    return `| ${safeCaseId(row.caseId)} | ${batch} | ${safeRunId(row.runId)} | ${status} | ${row.providerAttempted} | ${row.rawSchemaValid ?? "N/A"} | ${row.semanticValid ?? "N/A"} | ${row.publicResponseValid} | ${row.statusMatch} | ${row.metricsMatch} | ${row.candidatesMatch}/${row.candidateFeasible} | ${row.preferredMatch}/${row.primaryReasonMatch} | ${row.warningCodesMatch} | ${mode} | ${fallback} | ${option} | ${reasons} | ${Number.isFinite(row.latencyMs) && row.latencyMs >= 0 ? Math.round(row.latencyMs) : 0} | ${category} |`;
  }).join("\n");
  const counts = input.summary.counts;
  const hash = /^[0-9a-f]{64}$/i.test(input.datasetHash) ? input.datasetHash : "unavailable";
  const promptHash = /^[0-9a-f]{64}$/i.test(input.promptHash) ? input.promptHash : "unavailable";
  const thresholdSource = input.thresholdSource === "OWNER_APPROVED" ? "OWNER_APPROVED" : "PROVISIONAL — OWNER DECISION REQUIRED";
  const command = input.mode === "offline"
    ? "node --import=tsx scripts/evaluate-financial-advice.ts --offline --batch=all"
    : `node --import=tsx scripts/evaluate-financial-advice.ts --live --batch=${safeChoice(input.batchId, ["savings", "budget", "repeat"], "invalid")}`;
  const modelTag = input.modelTag === "qwen3.5:4b" ? input.modelTag : "unavailable";
  const manifest = input.sourceManifest
    .filter((entry) => /^[a-zA-Z0-9_./-]{1,180}$/.test(entry.path) && /^[0-9a-f]{64}$/i.test(entry.sha256))
    .map((entry) => `| \`${entry.path}\` | \`${entry.sha256}\` |`)
    .join("\n");
  const safeNodeVersion = /^v\d+\.\d+\.\d+$/.test(input.nodeVersion) ? input.nodeVersion : "unavailable";
  const safeUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input.timestampUtc) ? input.timestampUtc : "unavailable";
  const safeBangkok = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \+07:00$/.test(input.timestampBangkok) ? input.timestampBangkok : "unavailable";
  return [
    `# Financial Advice evaluation evidence — ${safeRunId(input.runId)}`,
    "",
    `- Run ID: \`${safeRunId(input.runId)}\``,
    `- Timestamp UTC: \`${safeUtc}\``,
    `- Timestamp Asia/Bangkok: \`${safeBangkok}\``,
    `- Git: \`${safeBranch(input.branch)}\` @ \`${safeCommit(input.head)}\``,
    `- Dataset: \`${/^[a-zA-Z0-9._-]{1,80}$/.test(input.datasetVersion) ? input.datasetVersion : "unavailable"}\` / SHA-256 \`${hash}\``,
    `- Policy/calculation/catalog: \`${/^[a-zA-Z0-9._-]{1,80}$/.test(input.policyVersion) ? input.policyVersion : "unavailable"}\` / \`${/^[a-zA-Z0-9._-]{1,80}$/.test(input.calculationVersion) ? input.calculationVersion : "unavailable"}\` / \`${/^[a-zA-Z0-9._-]{1,80}$/.test(input.catalogVersion) ? input.catalogVersion : "unavailable"}\``,
    `- Advisor prompt SHA-256: \`${promptHash}\``,
    `- Node/runtime: \`${safeNodeVersion}\`; host=${process.platform}/${process.arch}.`,
    "- Relevant source SHA-256 manifest:",
    "",
    "| Path | SHA-256 |",
    "| --- | --- |",
    manifest || "| unavailable | unavailable |",
    "",
    `- Mode/batch: \`${input.mode}\` / \`${safeChoice(input.batchId, ["all", "savings", "budget", "repeat"], "invalid")}\``,
    `- Model: \`${modelTag}\`; digest: \`${safeModelDigest(input.modelDigest)}\``,
    `- Command: \`${command}\``,
    `- Resolved service fixture config: enabled=${input.config.enabled}; requestTimeoutMs=${input.config.requestTimeoutMs}; providerTimeoutMs=${input.config.providerTimeoutMs}; per-user-rate=${input.config.rateLimitPerMinute}/min; maxConcurrent=${input.config.maxConcurrentRequests}; provider budget=${input.config.providerBudget}/process`,
    `- Threshold source: ${thresholdSource}; selection: \`${input.threshold}\``,
    "",
    "## Summary (each ratio reports numerator / configured denominator)",
    "",
    `- Configured cases/results: ${input.summary.resultCount}/${input.summary.configuredCount}; complete=${input.summary.complete}; missing=${input.summary.missingCaseIds.length}; duplicates=${input.summary.duplicateCaseIds.length}.`,
    `- Provider attempted/charged: ${counts.providerAttempted}/${input.summary.configuredCount} / ${counts.providerCharged}/${input.summary.configuredCount}; per-run quota invariant=${input.summary.quotaInvariant}; runs=${input.summary.providerCallsByRun.map((run) => `${safeRunId(run.runId)}:${run.attempted}/${run.charged}`).join(",") || "none"}.`,
    `- AI_ASSISTED: ${formatRatio(counts.aiAssisted ?? 0, input.summary.configuredCount)}; RULE_BASED: ${formatRatio(counts.ruleBased ?? 0, input.summary.configuredCount)}.`,
    `- Raw schema valid: ${formatRatio(counts.rawSchemaValid ?? 0, counts.providerAttempted ?? 0)} of attempted; ${formatRatio(counts.rawSchemaValid ?? 0, input.summary.configuredCount)} of configured.`,
    `- Semantic valid: ${formatRatio(counts.semanticValid ?? 0, counts.providerAttempted ?? 0)} of attempted; ${formatRatio(counts.semanticValid ?? 0, input.summary.configuredCount)} of configured.`,
    `- Metrics/status/candidate feasibility/preferred-primary/warnings/public: ${formatRatio(counts.metricsMatch ?? 0, input.summary.configuredCount)} / ${formatRatio(counts.statusMatch ?? 0, input.summary.configuredCount)} / ${formatRatio(counts.candidatesMatch ?? 0, input.summary.configuredCount)}+${formatRatio(counts.candidateFeasible ?? 0, input.summary.configuredCount)} / ${formatRatio(counts.preferredMatch ?? 0, input.summary.configuredCount)}+${formatRatio(counts.primaryReasonMatch ?? 0, input.summary.configuredCount)} / ${formatRatio(counts.warningCodesMatch ?? 0, input.summary.configuredCount)} / ${formatRatio(counts.publicResponseValid ?? 0, input.summary.configuredCount)}.`,
    `- Valid and appropriate live selectors: ${formatRatio(input.summary.liveSelectorCount, input.summary.configuredCount)}.`,
    `- Latency min/median/max/average: ${formatMaybe(input.summary.latencyMs.min)} / ${formatMaybe(input.summary.latencyMs.median)} / ${formatMaybe(input.summary.latencyMs.max)} / ${formatMaybe(input.summary.latencyMs.average)}.`,
    `- Provisional threshold checks: >=15/16=${input.summary.threshold15Of16}; >=95%=${input.summary.threshold95Percent}; product gate=${input.summary.productGate}; offline gate=${input.summary.offlineGate}; live gate=${input.summary.liveGate}; exit=${input.summary.exitCode}.`,
    "",
    "## Case results (no raw request, provider text, financial values, or exception messages)",
    "",
    "| Case | Batch | Run | Execution | Attempt | Raw schema | Semantic | Public | Status | Metrics | Candidates/feasible | Preferred/primary | Warnings | Mode | Fallback | Selected ID | Reason IDs | Latency | Failure category |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- |",
    resultRows,
    "",
    "## Interpretation",
    "",
    input.mode === "offline"
      ? "Offline deterministic evidence only. No live-model selector score is claimed; live evaluation remains BLOCKED until prerequisites, owner threshold decision, and separate authorization are present."
      : "Service-level live evidence only. This is not HTTP, emulator, or device E2E evidence. Fallback rows do not count as valid live selectors.",
    "",
    "95% on 16 cases requires 16/16; 15/16 is 93.75%. Threshold approval is not inferred from these measurements.",
    "",
  ].join("\n");
}


const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const MAX_REPORT_BYTES = 1_048_576;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const CASE_ID = /^[SB]-\d{2}$/;
const OPTION_IDS = new Set([
  "MAINTAIN_PLAN", "GOAL_ALREADY_FUNDED", "EXTEND_DEADLINE", "REDUCE_FLEXIBLE_SPENDING",
  "LOWER_GOAL_AMOUNT", "REVIEW_BASE_BUDGET", "MAINTAIN_BUDGET", "ADJUST_SAVINGS_TARGET",
]);
const REASON_IDS = new Set([
  "TARGET_ALREADY_FUNDED", "MONTHLY_GAP", "GOAL_FEASIBLE", "BUDGET_TARGET_MET",
  "BASE_BUDGET_DEFICIT", "BUFFER_NOT_COVERED", "NO_SAVING_CAPACITY", "PRESERVE_CURRENT_SPENDING",
  "KEEP_TARGET_WITH_FLEXIBLE_CUT", "ADJUST_GOAL_TO_CAPACITY", "EXTEND_TIME_TO_CAPACITY", "REVIEW_DECLARED_INPUTS",
]);
const FALLBACK_REASONS = new Set([
  "AI_DISABLED", "PROVIDER_UNAVAILABLE", "PROVIDER_TIMEOUT", "PROVIDER_INVALID_OUTPUT", "PROVIDER_BUDGET_EXHAUSTED",
]);
const FAILURE_CATEGORIES = new Set([
  "NONE", "CASE_EXECUTION_EXCEPTION", "PROVIDER_OFFLINE", "PROVIDER_BUDGET_EXHAUSTED",
  "RAW_OUTPUT_INVALID", "PUBLIC_RESPONSE_INVALID", "ORACLE_MISMATCH",
]);
const ROW_KEYS = [
  "caseId", "batchId", "runId", "executionStatus", "providerAttempted", "rawSchemaValid", "semanticValid",
  "publicResponseValid", "statusMatch", "metricsMatch", "candidatesMatch", "candidateFeasible", "preferredMatch",
  "primaryReasonMatch", "warningCodesMatch", "mode", "fallbackReason", "selectedOptionId", "selectedReasonIds",
  "latencyMs", "failureCategory",
].sort();
const REPORT_KEYS = [
  "schema", "version", "runId", "batchId", "mode", "startedAtUtc", "endedAtUtc", "head", "branch",
  "datasetVersion", "datasetHash", "promptHash", "policyVersion", "calculationVersion", "catalogVersion",
  "modelTag", "modelDigest", "providerPrerequisiteReady", "providerAttemptedCount", "chargedProviderCallCount",
  "providerBudget", "quotaInvariant", "config", "sourceManifest", "summary", "results", "threshold",
  "thresholdSource", "thresholdReference",
].sort();
const CONFIG_KEYS = [
  "enabled", "requestTimeoutMs", "providerTimeoutMs", "rateLimitPerMinute", "maxConcurrentRequests", "providerBudget",
].sort();

type SafeManifestEntry = { path: string; sha256: string };
type SafeConfig = {
  enabled: true;
  requestTimeoutMs: number;
  providerTimeoutMs: number;
  rateLimitPerMinute: number;
  maxConcurrentRequests: number;
  providerBudget: 10;
};
type ValidRunReport = {
  runId: string;
  batchId: "savings" | "budget";
  startedAtUtc: string;
  endedAtUtc: string;
  head: string;
  branch: string;
  datasetVersion: string;
  datasetHash: string;
  promptHash: string;
  policyVersion: string;
  calculationVersion: string;
  catalogVersion: string;
  modelTag: "qwen3.5:4b";
  modelDigest: string;
  providerAttemptedCount: number;
  chargedProviderCallCount: number;
  config: SafeConfig;
  sourceManifest: SafeManifestEntry[];
  threshold: EvaluationThreshold;
  thresholdSource: "PROVISIONAL" | "OWNER_APPROVED";
  thresholdReference: string | null;
  results: EvaluationResult[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return isDeepStrictEqual(actual, expected);
}

function isSafeInteger(value: unknown, min = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}

function isNullableBoolean(value: unknown): boolean {
  return value === null || typeof value === "boolean";
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertResultRow(value: unknown, batchId: "savings" | "budget", runId: string): asserts value is EvaluationResult {
  if (!isRecord(value) || !hasExactKeys(value, ROW_KEYS)) throw new Error("A result row has an invalid closed schema.");
  if (
    typeof value.caseId !== "string" || !CASE_ID.test(value.caseId) ||
    value.batchId !== batchId || value.runId !== runId ||
    !["PASS", "FAIL", "BLOCKED", "SKIPPED"].includes(String(value.executionStatus)) ||
    typeof value.providerAttempted !== "boolean" ||
    !isNullableBoolean(value.rawSchemaValid) || !isNullableBoolean(value.semanticValid) ||
    ["publicResponseValid", "statusMatch", "metricsMatch", "candidatesMatch", "candidateFeasible", "preferredMatch", "primaryReasonMatch", "warningCodesMatch"]
      .some((key) => typeof value[key] !== "boolean") ||
    !(value.mode === null || value.mode === "AI_ASSISTED" || value.mode === "RULE_BASED") ||
    !(value.fallbackReason === null || (typeof value.fallbackReason === "string" && FALLBACK_REASONS.has(value.fallbackReason))) ||
    !(value.selectedOptionId === null || (typeof value.selectedOptionId === "string" && OPTION_IDS.has(value.selectedOptionId))) ||
    !Array.isArray(value.selectedReasonIds) || value.selectedReasonIds.length > 3 ||
    !value.selectedReasonIds.every((reason) => typeof reason === "string" && REASON_IDS.has(reason)) ||
    !isSafeInteger(value.latencyMs) ||
    typeof value.failureCategory !== "string" || !FAILURE_CATEGORIES.has(value.failureCategory)
  ) throw new Error("A result row contains a value outside the evaluation contract.");
}

function reportCases(batchId: "savings" | "budget") {
  return EVALUATION_CASES.filter((item) => batchId === "savings"
    ? item.kind === "SAVINGS_PLAN"
    : item.kind === "BUDGET_BALANCE");
}

function validateRunReport(input: unknown, expectedBatch: "savings" | "budget"): ValidRunReport {
  if (!isRecord(input) || !hasExactKeys(input, REPORT_KEYS)) throw new Error("An evaluation report has an invalid closed schema.");
  if (
    input.schema !== "financial-advice-evaluation-run" || input.version !== 2 ||
    input.batchId !== expectedBatch || input.mode !== "live-service" ||
    typeof input.runId !== "string" || !RUN_ID.test(input.runId) ||
    typeof input.startedAtUtc !== "string" || !Number.isFinite(Date.parse(input.startedAtUtc)) ||
    typeof input.endedAtUtc !== "string" || !Number.isFinite(Date.parse(input.endedAtUtc)) ||
    Date.parse(input.endedAtUtc) < Date.parse(input.startedAtUtc) ||
    typeof input.head !== "string" || !/^[0-9a-f]{40}$/i.test(input.head) ||
    typeof input.branch !== "string" || !/^codex\/[a-z0-9._/-]{1,80}$/i.test(input.branch) ||
    input.datasetVersion !== FINANCIAL_ADVICE_DATASET_VERSION ||
    typeof input.datasetHash !== "string" || !SHA256.test(input.datasetHash) ||
    input.datasetHash !== sha256(JSON.stringify(EVALUATION_CASES)) ||
    typeof input.promptHash !== "string" || !SHA256.test(input.promptHash) ||
    input.promptHash !== sha256(ADVISOR_SYSTEM_PROMPT) ||
    input.policyVersion !== FINANCIAL_ADVICE_POLICY_VERSION ||
    input.calculationVersion !== CALCULATION_VERSION ||
    input.catalogVersion !== CATALOG_VERSION ||
    input.modelTag !== "qwen3.5:4b" || typeof input.modelDigest !== "string" || !SHA256.test(input.modelDigest) ||
    input.providerPrerequisiteReady !== true || input.quotaInvariant !== true || input.providerBudget !== 10 ||
    !isSafeInteger(input.providerAttemptedCount) || input.providerAttemptedCount > 10 ||
    !isSafeInteger(input.chargedProviderCallCount) || input.chargedProviderCallCount !== input.providerAttemptedCount ||
    !["15_OF_16", "95_PERCENT", "UNRESOLVED"].includes(String(input.threshold)) ||
    !(input.thresholdSource === "PROVISIONAL" || input.thresholdSource === "OWNER_APPROVED") ||
    !(input.thresholdReference === null || (typeof input.thresholdReference === "string" && /^[A-Za-z0-9._:/ -]{1,160}$/.test(input.thresholdReference))) ||
    (input.thresholdSource === "OWNER_APPROVED" && input.thresholdReference === null) ||
    (input.thresholdSource === "PROVISIONAL" && input.thresholdReference !== null)
  ) throw new Error("An evaluation report is missing valid provenance or quota metadata.");

  if (!isRecord(input.config) || !hasExactKeys(input.config, CONFIG_KEYS)) throw new Error("An evaluation report config has an invalid closed schema.");
  const config = input.config;
  if (
    config.enabled !== true || !isSafeInteger(config.requestTimeoutMs, 1) ||
    !isSafeInteger(config.providerTimeoutMs, 1) || config.requestTimeoutMs <= config.providerTimeoutMs ||
    !isSafeInteger(config.rateLimitPerMinute, 1) || !isSafeInteger(config.maxConcurrentRequests, 1) ||
    config.providerBudget !== 10
  ) throw new Error("An evaluation report config does not satisfy the live service contract.");

  if (!Array.isArray(input.sourceManifest) || input.sourceManifest.length < 1) throw new Error("An evaluation report source manifest is missing.");
  const manifest: SafeManifestEntry[] = [];
  const manifestPaths = new Set<string>();
  for (const entry of input.sourceManifest) {
    if (!isRecord(entry) || !hasExactKeys(entry, ["path", "sha256"])) throw new Error("A source manifest entry is invalid.");
    if (
      typeof entry.path !== "string" || !/^(backend|mobile-app)\/[A-Za-z0-9_./-]{1,180}$/.test(entry.path) ||
      entry.path.split("/").includes("..") || typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256) ||
      manifestPaths.has(entry.path)
    ) throw new Error("A source manifest entry is outside the closed format.");
    manifestPaths.add(entry.path);
    const sourcePath = path.resolve(repositoryRoot, entry.path);
    const relativeSourcePath = path.relative(repositoryRoot, sourcePath);
    if (relativeSourcePath.startsWith(`..${path.sep}`) || relativeSourcePath === ".." || path.isAbsolute(relativeSourcePath)) {
      throw new Error("A source manifest path is outside the repository.");
    }
    let actualSourceHash: string;
    try {
      actualSourceHash = sha256(readFileSync(sourcePath));
    } catch {
      throw new Error("A source manifest file is unavailable.");
    }
    if (actualSourceHash !== entry.sha256.toLowerCase()) throw new Error("A source manifest no longer matches the report snapshot.");
    manifest.push({ path: entry.path, sha256: entry.sha256.toLowerCase() });
  }

  if (!Array.isArray(input.results) || input.results.length !== 8) throw new Error("Each live batch must contain exactly eight result rows.");
  const expectedCases = reportCases(expectedBatch);
  const expectedById = new Map(expectedCases.map((item) => [item.id, item]));
  const expectedIds = new Set(expectedById.keys());
  const seen = new Set<string>();
  for (const row of input.results) {
    assertResultRow(row, expectedBatch, input.runId);
    if (!expectedIds.has(row.caseId) || seen.has(row.caseId)) throw new Error("A live batch has an unknown or duplicate case ID.");
    const testCase = expectedById.get(row.caseId)!;
    const preferredMatch = testCase.acceptablePreferredIds.includes(row.selectedOptionId as never);
    const primaryReason = row.selectedOptionId === null ? undefined : testCase.oracle.primaryReasonByOption[row.selectedOptionId];
    const primaryReasonMatch = typeof primaryReason === "string" && row.selectedReasonIds.includes(primaryReason);
    if (row.preferredMatch !== preferredMatch || row.primaryReasonMatch !== primaryReasonMatch) {
      throw new Error("A result row does not reconcile with the fixed selector oracle.");
    }
    seen.add(row.caseId);
  }
  if (seen.size !== expectedIds.size || [...expectedIds].some((id) => !seen.has(id))) {
    throw new Error("A live batch is missing a required dataset case.");
  }

  const rowAttempted = input.results.filter((row) => row.providerAttempted).length;
  if (rowAttempted !== input.providerAttemptedCount) throw new Error("Report counters do not match result rows.");
  const perRun = [{ runId: input.runId, attempted: rowAttempted, charged: input.chargedProviderCallCount }];
  const expectedSummary = summarizeEvaluation({
    mode: "live-service",
    cases: expectedCases,
    results: input.results,
    providerAttemptedCount: input.providerAttemptedCount,
    chargedProviderCallCount: input.chargedProviderCallCount,
    providerCallsByRun: perRun,
    providerPrerequisiteReady: true,
    selectedThreshold: input.threshold as EvaluationThreshold,
  });
  if (!isDeepStrictEqual(input.summary, expectedSummary)) throw new Error("The recorded batch summary does not reconcile with its cases.");

  return {
    runId: input.runId,
    batchId: expectedBatch,
    startedAtUtc: input.startedAtUtc,
    endedAtUtc: input.endedAtUtc,
    head: input.head,
    branch: input.branch,
    datasetVersion: input.datasetVersion,
    datasetHash: input.datasetHash.toLowerCase(),
    promptHash: input.promptHash.toLowerCase(),
    policyVersion: input.policyVersion,
    calculationVersion: input.calculationVersion,
    catalogVersion: input.catalogVersion,
    modelTag: "qwen3.5:4b",
    modelDigest: input.modelDigest.toLowerCase(),
    providerAttemptedCount: input.providerAttemptedCount,
    chargedProviderCallCount: input.chargedProviderCallCount,
    config: config as SafeConfig,
    sourceManifest: manifest,
    threshold: input.threshold as EvaluationThreshold,
    thresholdSource: input.thresholdSource,
    thresholdReference: input.thresholdReference,
    results: input.results,
  };
}

function assertSameProvenance(left: ValidRunReport, right: ValidRunReport): void {
  const scalarKeys = [
    "head", "branch", "datasetVersion", "datasetHash", "promptHash", "policyVersion", "calculationVersion",
    "catalogVersion", "modelTag", "modelDigest", "threshold", "thresholdSource", "thresholdReference",
  ] as const;
  if (scalarKeys.some((key) => left[key] !== right[key])) throw new Error("The two live reports have mismatched run provenance.");
  if (left.runId === right.runId) throw new Error("Savings and budget reports must come from independent runs.");
  if (!isDeepStrictEqual(left.config, right.config)) throw new Error("The two live reports have mismatched resolved config.");
  if (!isDeepStrictEqual(left.sourceManifest, right.sourceManifest)) throw new Error("The two live reports have mismatched source manifests.");
}

export function aggregateEvaluationReports(
  savingsInput: unknown,
  budgetInput: unknown,
): {
  schema: "financial-advice-evaluation-aggregate";
  version: 1;
  aggregateId: string;
  createdAtUtc: string;
  mode: "live-service";
  head: string;
  branch: string;
  datasetVersion: string;
  datasetHash: string;
  promptHash: string;
  policyVersion: string;
  calculationVersion: string;
  catalogVersion: string;
  modelTag: "qwen3.5:4b";
  modelDigest: string;
  threshold: EvaluationThreshold;
  thresholdSource: "PROVISIONAL" | "OWNER_APPROVED";
  thresholdReference: string | null;
  config: SafeConfig;
  sourceManifest: SafeManifestEntry[];
  inputRuns: Array<{ batchId: string; runId: string; startedAtUtc: string; endedAtUtc: string; providerAttemptedCount: number; chargedProviderCallCount: number }>;
  providerAttemptedCount: number;
  chargedProviderCallCount: number;
  providerBudgetPerRun: 10;
  quotaInvariant: true;
  summary: ReturnType<typeof summarizeEvaluation>;
  results: EvaluationResult[];
} {
  const savings = validateRunReport(savingsInput, "savings");
  const budget = validateRunReport(budgetInput, "budget");
  assertSameProvenance(savings, budget);
  if (savings.results.some((row) => row.executionStatus === "SKIPPED") || budget.results.some((row) => row.executionStatus === "SKIPPED")) {
    throw new Error("Skipped rows are not permitted in the configured denominator.");
  }

  const results = [...savings.results, ...budget.results];
  const providerAttemptedCount = savings.providerAttemptedCount + budget.providerAttemptedCount;
  const chargedProviderCallCount = savings.chargedProviderCallCount + budget.chargedProviderCallCount;
  const providerCallsByRun = [savings, budget].map((report) => ({
    runId: report.runId,
    attempted: report.providerAttemptedCount,
    charged: report.chargedProviderCallCount,
  }));
  const summary = summarizeEvaluation({
    mode: "live-service",
    cases: EVALUATION_CASES,
    results,
    providerAttemptedCount,
    chargedProviderCallCount,
    providerCallsByRun,
    providerPrerequisiteReady: true,
    selectedThreshold: savings.threshold,
  });
  if (!summary.complete || summary.configuredCount !== 16 || summary.resultCount !== 16 || !summary.quotaInvariant) {
    throw new Error("The aggregate is incomplete or violates the per-run quota contract.");
  }

  return {
    schema: "financial-advice-evaluation-aggregate",
    version: 1,
    aggregateId: randomUUID(),
    createdAtUtc: new Date().toISOString(),
    mode: "live-service",
    head: savings.head,
    branch: savings.branch,
    datasetVersion: savings.datasetVersion,
    datasetHash: savings.datasetHash,
    promptHash: savings.promptHash,
    policyVersion: savings.policyVersion,
    calculationVersion: savings.calculationVersion,
    catalogVersion: savings.catalogVersion,
    modelTag: savings.modelTag,
    modelDigest: savings.modelDigest,
    threshold: savings.threshold,
    thresholdSource: savings.thresholdSource,
    thresholdReference: savings.thresholdReference,
    config: savings.config,
    sourceManifest: savings.sourceManifest,
    inputRuns: [savings, budget].map((report) => ({
      batchId: report.batchId,
      runId: report.runId,
      startedAtUtc: report.startedAtUtc,
      endedAtUtc: report.endedAtUtc,
      providerAttemptedCount: report.providerAttemptedCount,
      chargedProviderCallCount: report.chargedProviderCallCount,
    })),
    providerAttemptedCount,
    chargedProviderCallCount,
    providerBudgetPerRun: 10,
    quotaInvariant: true,
    summary,
    results,
  };
}

function writeExclusive(filePath: string, contents: string): void {
  const descriptor = openSync(filePath, "wx");
  try {
    writeFileSync(descriptor, contents, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

export function writeAggregateReports(
  outputDirectory: string,
  aggregate: ReturnType<typeof aggregateEvaluationReports>,
  inputReportFiles: readonly [string, string],
  fileStem: string,
): { jsonPath: string; markdownPath: string } {
  if (!/^[A-Za-z0-9._-]{1,180}$/.test(fileStem) || inputReportFiles.some((name) => path.basename(name) !== name || !name.endsWith(".json"))) {
    throw new Error("Aggregate output metadata is outside the closed file format.");
  }
  const jsonPath = path.join(outputDirectory, `${fileStem}.json`);
  const markdownPath = path.join(outputDirectory, `${fileStem}.md`);
  writeExclusive(jsonPath, `${JSON.stringify({ ...aggregate, inputReportFiles }, null, 2)}\n`);
  writeExclusive(markdownPath, renderMarkdown(aggregate));
  return { jsonPath, markdownPath };
}

function renderMarkdown(aggregate: ReturnType<typeof aggregateEvaluationReports>): string {
  const counts = aggregate.summary.counts;
  const runs = aggregate.inputRuns.map((run) =>
    `| ${run.batchId} | ${run.runId} | ${run.providerAttemptedCount} | ${run.chargedProviderCallCount} | <=10 |`,
  ).join("\n");
  const rows = aggregate.results.map((row) =>
    `| ${row.caseId} | ${row.batchId} | ${row.executionStatus} | ${row.providerAttempted} | ${row.mode ?? "NOT_RUN"} | ${row.preferredMatch} | ${row.failureCategory} |`,
  ).join("\n");
  return [
    `# Financial Advice live aggregate — ${aggregate.aggregateId}`,
    "",
    `- Git: \`${aggregate.branch}\` @ \`${aggregate.head}\``,
    `- Dataset: \`${aggregate.datasetVersion}\` / SHA-256 \`${aggregate.datasetHash}\``,
    `- Prompt SHA-256: \`${aggregate.promptHash}\`; model \`${aggregate.modelTag}\`; digest \`${aggregate.modelDigest}\`.`,
    `- Threshold: \`${aggregate.threshold}\`; provenance: \`${aggregate.thresholdSource}\`${aggregate.thresholdReference ? ` (${aggregate.thresholdReference})` : ""}.`,
    `- Cases: ${aggregate.summary.resultCount}/${aggregate.summary.configuredCount}; product gate ${aggregate.summary.productGate}; live gate ${aggregate.summary.liveGate}; exit ${aggregate.summary.exitCode}.`,
    `- AI-assisted ${counts.aiAssisted ?? 0}/16; valid/appropriate live selectors ${aggregate.summary.liveSelectorCount}/16; preferred match ${counts.preferredMatch ?? 0}/16.`,
    `- Provider attempts/charged: ${aggregate.providerAttemptedCount}/${aggregate.chargedProviderCallCount}; per-run quota invariant ${aggregate.quotaInvariant}.`,
    "",
    "## Source runs",
    "",
    "| Batch | Run ID | Attempted | Charged | Budget |",
    "| --- | --- | ---: | ---: | --- |",
    runs,
    "",
    "## Cases (closed, redacted fields only)",
    "",
    "| Case | Batch | Execution | Attempt | Mode | Preferred match | Failure category |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    rows,
    "",
    "Fallbacks, timeouts, and execution failures remain in the configured 16-case denominator. This report does not establish browser/device, PostgreSQL, staging, or production evidence.",
    "",
  ].join("\n");
}

import { createHash, randomUUID } from "node:crypto";
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_OLLAMA_BASE_URL,
  OllamaAssistantHelpProvider,
  SUPPORTED_OLLAMA_MODEL,
} from "../src/assistant/ollamaHelpProvider.js";
import { resolveAssistantConfig } from "../src/assistant/helpConfig.js";
import { ADVISOR_SYSTEM_PROMPT } from "../src/financialAdvice/advisorPrompt.js";
import { CALCULATION_VERSION, CATALOG_VERSION } from "../src/financialAdvice/explanationCatalog.js";
import { FINANCIAL_ADVICE_POLICY_VERSION } from "../src/financialAdvice/selectionPolicy.js";
import { EVALUATION_CASES, FINANCIAL_ADVICE_DATASET_VERSION } from "../src/tests/financialAdviceEvaluation/dataset.js";
import { runFinancialAdviceBatch } from "../src/tests/financialAdviceEvaluation/runner.js";
import {
  blockedEvaluationResult,
  renderEvaluationReport,
  summarizeEvaluation,
  type EvaluationMode,
  type EvaluationThreshold,
} from "../src/tests/financialAdviceEvaluation/reporting.js";

const currentFile = fileURLToPath(import.meta.url);
const backendRoot = path.resolve(path.dirname(currentFile), "..");
const repositoryRoot = path.resolve(backendRoot, "..");
const evidenceDirectory = path.join(repositoryRoot, "documents", "06-security-ai");
const MOBILE_VALIDATOR = path.join(
  repositoryRoot,
  "mobile-app",
  "src",
  "features",
  "financial-advice",
  "validation",
  "financialAdviceValidators.ts",
);

type CliOptions = {
  mode: EvaluationMode;
  batchId: "all" | "savings" | "budget" | "repeat";
  threshold: EvaluationThreshold;
};

const REPEAT_CASE_IDS = new Set(["S-05", "S-07", "B-05", "B-08"]);
const SOURCE_FILES = [
  "backend/src/financialAdvice/adviceService.ts",
  "backend/src/financialAdvice/advisorPrompt.ts",
  "backend/src/financialAdvice/calculations.ts",
  "backend/src/financialAdvice/explanationCatalog.ts",
  "backend/src/financialAdvice/options.ts",
  "backend/src/financialAdvice/selectionPolicy.ts",
  "backend/src/financialAdvice/selectorValidation.ts",
  "backend/src/financialAdvice/types.ts",
  "backend/src/financialAdvice/validation.ts",
  "backend/src/assistant/helpConfig.ts",
  "backend/src/assistant/ollamaHelpProvider.ts",
  "backend/src/assistant/rateLimiter.ts",
  "backend/src/tests/financialAdviceEvaluation/dataset.ts",
  "backend/src/tests/financialAdviceEvaluation/reporting.ts",
  "backend/src/tests/financialAdviceEvaluation/runner.ts",
  "backend/scripts/evaluate-financial-advice.ts",
  "backend/scripts/aggregate-financial-advice-evaluation.ts",
  "mobile-app/src/features/financial-advice/types/financialAdvice.ts",
  "mobile-app/src/features/financial-advice/validation/financialAdviceValidators.ts",
] as const;

function parseArgs(args: string[]): CliOptions | null {
  if (args.includes("--offline")) {
    if (args.length !== 2 || args[0] !== "--offline" || args[1] !== "--batch=all") return null;
    return { mode: "offline", batchId: "all", threshold: "UNRESOLVED" };
  }
  if (args[0] !== "--live" || args.length !== 3) return null;
  const batch = args[1]?.match(/^--batch=(savings|budget|repeat)$/)?.[1];
  const threshold = args[2]?.match(/^--threshold=(15-of-16|95-percent|unresolved)$/)?.[1];
  if (!batch || !threshold) return null;
  return {
    mode: "live-service",
    batchId: batch as CliOptions["batchId"],
    threshold: threshold === "15-of-16" ? "15_OF_16" : threshold === "95-percent" ? "95_PERCENT" : "UNRESOLVED",
  };
}

function readGitValue(args: string[]): string | null {
  try {
    const value = execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return value || null;
  } catch {
    return null;
  }
}

function hash(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function sourceManifest(): Array<{ path: string; sha256: string }> {
  return SOURCE_FILES.map((relativePath) => ({
    path: relativePath,
    sha256: hash(readFileSync(path.join(repositoryRoot, relativePath))),
  }));
}

function selectedCases(options: CliOptions) {
  if (options.batchId === "all") return EVALUATION_CASES;
  if (options.batchId === "repeat") return EVALUATION_CASES.filter((testCase) => REPEAT_CASE_IDS.has(testCase.id));
  return EVALUATION_CASES.filter((testCase) => options.batchId === "savings"
    ? testCase.kind === "SAVINGS_PLAN"
    : testCase.kind === "BUDGET_BALANCE");
}

async function mobileResponseValidator(): Promise<(value: unknown) => boolean> {
  const module = await import(pathToFileURL(MOBILE_VALIDATOR).href) as {
    isFinancialAdviceResponse?: (value: unknown) => boolean;
  };
  if (typeof module.isFinancialAdviceResponse !== "function") throw new Error("Mobile response validator unavailable.");
  return module.isFinancialAdviceResponse;
}

async function checkLocalModel(): Promise<{ available: boolean; digest: string | null }> {
  try {
    const response = await fetch(`${DEFAULT_OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) return { available: false, digest: null };
    const body = await response.json() as { models?: Array<{ name?: unknown; digest?: unknown }> };
    const model = body.models?.find((entry) => entry.name === SUPPORTED_OLLAMA_MODEL);
    const digest = model && typeof model.digest === "string" && /^[0-9a-f]{64}$/i.test(model.digest)
      ? model.digest.toLowerCase()
      : null;
    return { available: digest !== null, digest };
  } catch {
    return { available: false, digest: null };
  }
}

function uniqueWrite(filePath: string, contents: string): void {
  const descriptor = openSync(filePath, "wx");
  try {
    writeFileSync(descriptor, contents, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

function timestampBangkok(date: Date): string {
  const local = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(date);
  return `${local} +07:00`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.error("Usage: --offline --batch=all | --live --batch=savings|budget|repeat --threshold=15-of-16|95-percent|unresolved");
    process.exitCode = 2;
    return;
  }

  const cases = selectedCases(options);
  if (cases.length === 0) {
    console.error("Selected evaluation batch is empty.");
    process.exitCode = 2;
    return;
  }

  const runId = randomUUID();
  const startedAt = new Date();
  const mobileValidator = await mobileResponseValidator();
  let modelDigest: string | null = null;
  let providerPrerequisiteReady = options.mode === "offline";
  let provider: OllamaAssistantHelpProvider | undefined;

  if (options.mode === "live-service") {
    const model = await checkLocalModel();
    providerPrerequisiteReady = model.available;
    modelDigest = model.digest;
    if (providerPrerequisiteReady) {
      provider = new OllamaAssistantHelpProvider({
        baseUrl: DEFAULT_OLLAMA_BASE_URL,
        model: SUPPORTED_OLLAMA_MODEL,
      });
    }
  }

  const run = providerPrerequisiteReady || options.mode === "offline"
    ? await runFinancialAdviceBatch({
        cases,
        batchId: options.batchId,
        runId,
        mode: options.mode,
        provider,
        validatePublicResponse: mobileValidator,
        configOverrides: options.mode === "live-service"
          ? { providerTimeoutMs: 25_000, requestTimeoutMs: 30_000 }
          : undefined,
      })
    : {
        results: cases.map((testCase) => blockedEvaluationResult(testCase, options.batchId, runId, "PROVIDER_OFFLINE")),
        providerAttemptedCount: 0,
        chargedProviderCallCount: 0,
        activeConcurrencyAfter: 0,
        activeConcurrencyByUserAfter: [] as number[],
        providerBudget: 10,
        quotaInvariant: true,
      };

  const caseRunCounts = new Map<string, number>();
  for (const result of run.results) {
    if (result.providerAttempted) caseRunCounts.set(result.runId, (caseRunCounts.get(result.runId) ?? 0) + 1);
  }
  const providerCallsByRun = caseRunCounts.size
    ? [...caseRunCounts].map(([providerRunId, attempted]) => ({ runId: providerRunId, attempted, charged: attempted }))
    : [{ runId, attempted: 0, charged: 0 }];
  const summary = summarizeEvaluation({
    mode: options.mode,
    cases,
    results: run.results,
    providerAttemptedCount: run.providerAttemptedCount,
    chargedProviderCallCount: run.chargedProviderCallCount,
    providerCallsByRun,
    providerPrerequisiteReady,
    selectedThreshold: options.threshold,
  });
  const endedAt = new Date();
  const datasetHash = hash(JSON.stringify(EVALUATION_CASES));
  const promptHash = hash(ADVISOR_SYSTEM_PROMPT);
  const resolved = resolveAssistantConfig({
    enabled: options.mode === "live-service",
    provider,
    ...(options.mode === "live-service" ? { providerTimeoutMs: 25_000, requestTimeoutMs: 30_000 } : {}),
  });
  const config = {
    enabled: resolved.enabled,
    requestTimeoutMs: resolved.requestTimeoutMs,
    providerTimeoutMs: resolved.providerTimeoutMs,
    rateLimitPerMinute: resolved.rateLimitPerMinute,
    maxConcurrentRequests: resolved.maxConcurrentRequests,
    providerBudget: run.providerBudget,
  };
  const manifest = sourceManifest();
  const markdown = renderEvaluationReport({
    runId,
    timestampUtc: startedAt.toISOString(),
    timestampBangkok: timestampBangkok(startedAt),
    head: readGitValue(["rev-parse", "HEAD"]),
    branch: readGitValue(["branch", "--show-current"]),
    datasetVersion: FINANCIAL_ADVICE_DATASET_VERSION,
    datasetHash,
    policyVersion: FINANCIAL_ADVICE_POLICY_VERSION,
    promptHash,
    calculationVersion: CALCULATION_VERSION,
    catalogVersion: CATALOG_VERSION,
    modelTag: SUPPORTED_OLLAMA_MODEL,
    modelDigest,
    command: "",
    batchId: options.batchId,
    mode: options.mode,
    threshold: options.threshold,
    thresholdSource: "PROVISIONAL",
    config,
    summary,
    results: run.results,
    sourceManifest: manifest,
    nodeVersion: process.version,
  });
  const artifact = {
    schema: "financial-advice-evaluation-run",
    version: 2,
    runId,
    batchId: options.batchId,
    mode: options.mode,
    startedAtUtc: startedAt.toISOString(),
    endedAtUtc: endedAt.toISOString(),
    head: readGitValue(["rev-parse", "HEAD"]),
    branch: readGitValue(["branch", "--show-current"]),
    datasetVersion: FINANCIAL_ADVICE_DATASET_VERSION,
    datasetHash,
    promptHash,
    policyVersion: FINANCIAL_ADVICE_POLICY_VERSION,
    calculationVersion: CALCULATION_VERSION,
    catalogVersion: CATALOG_VERSION,
    modelTag: SUPPORTED_OLLAMA_MODEL,
    modelDigest,
    providerPrerequisiteReady,
    providerAttemptedCount: run.providerAttemptedCount,
    chargedProviderCallCount: run.chargedProviderCallCount,
    providerBudget: run.providerBudget,
    quotaInvariant: run.quotaInvariant,
    threshold: options.threshold,
    thresholdSource: "PROVISIONAL",
    thresholdReference: null,
    config,
    sourceManifest: manifest,
    summary,
    results: run.results,
  };
  const compactTime = startedAt.toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "");
  const stem = `financial-advice-run-${options.mode === "offline" ? "offline" : "live"}-${options.batchId}-${compactTime}-${runId}`;
  const jsonPath = path.join(evidenceDirectory, `${stem}.json`);
  const markdownPath = path.join(evidenceDirectory, `${stem}.md`);
  uniqueWrite(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`);
  uniqueWrite(markdownPath, markdown);
  console.log(`Evaluation mode: ${options.mode}; cases: ${summary.resultCount}/${summary.configuredCount}; gate: ${options.mode === "offline" ? summary.offlineGate : summary.liveGate}; exit=${summary.exitCode}`);
  console.log(`Safe report: ${path.relative(repositoryRoot, markdownPath)}`);
  console.log(`Safe machine report: ${path.relative(repositoryRoot, jsonPath)}`);
  process.exitCode = summary.exitCode;
}

main().catch(() => {
  console.error("Evaluator stopped before producing a complete safe report; no raw exception was emitted.");
  process.exitCode = 2;
});

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  DEFAULT_RADOX_BASE_URL,
  DEFAULT_RADOX_MODEL,
  RadoxAssistantHelpProvider,
} from "../src/assistant/radoxHelpProvider.js";
import {
  ANSWER_CATALOG_HASH,
  ANSWER_CATALOG_VERSION,
  ASSISTANT_SELECTOR_PROMPT_HASH,
  SELECTOR_PROTOCOL_VERSION,
} from "../src/assistant/responseCatalog.js";
import { loadKnowledge } from "../src/assistant/knowledgeLoader.js";
import {
  INTENT_DEVELOPMENT_CASES,
  INTENT_HOLDOUT_CASES,
  INTENT_DATASET_VERSION,
} from "../src/tests/assistantEvaluation/intentDisambiguationDataset.js";
import {
  POS23_DEV_CASES,
  POS23_HOLDOUT_CASES,
  POS23_DATASET_VERSION,
  POS23_DEV_HASH,
  POS23_HOLDOUT_HASH,
} from "../src/tests/assistantEvaluation/pos23DisambiguationDataset.js";
import {
  POS23_EXP_DEV_CASES,
  POS23_EXP_HOLDOUT_CASES,
  POS23_EXP_DATASET_VERSION,
  POS23_EXP_DEV_HASH,
  POS23_EXP_HOLDOUT_HASH,
} from "../src/tests/assistantEvaluation/pos23Faq06Faq13Dataset.js";
import {
  POS24_DEV_CASES,
  POS24_DIAG_CASES,
  POS24_DATASET_VERSION,
  POS24_DEV_HASH,
  POS24_DIAG_HASH,
} from "../src/tests/assistantEvaluation/pos24DisambiguationDataset.js";
import {
  EVALUATION_CASES,
  EVALUATION_DATASET_VERSION,
} from "../src/tests/assistantEvaluation/dataset.js";
import {
  createCountingProvider,
  createIntentService,
  runIntentTrials,
  buildIntentSummary,
  writeIntentReport,
  FakeIntentProvider,
  type FakeIntentFixture,
  type IntentTrial,
} from "../src/tests/assistantEvaluation/intentRunner.js";
import { IntentJournalWriter } from "../src/tests/assistantEvaluation/intentJournal.js";
import {
  readPos23Budget,
  writePos23Budget,
  acquireEvaluatorLock,
  createBudgetTrackingProvider,
  POS23_BUDGET_FILE,
  POS23_LOCK_FILE,
  POS23_BUDGET_LIMIT,
  SESSION_CALL_LIMIT,
  type Pos23BudgetTracker,
} from "../src/tests/assistantEvaluation/pos23BudgetTracker.js";
import {
  runPos24OfflineWorkflow,
} from "../src/tests/assistantEvaluation/pos24Orchestrator.js";
import {
  setupOrVerifyPos24Workspace,
  POS24_DEFAULT_OFFLINE_BUDGET_LIMIT,
  assertNotProtectedPath,
} from "../src/tests/assistantEvaluation/pos24Workspace.js";
import type { AssistantHelpProvider } from "../src/assistant/helpProvider.js";

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), "../..");
const defaultReportDirectory = path.join(repoRoot, "documents/06-security-ai");

export {
  readPos23Budget,
  writePos23Budget,
  createBudgetTrackingProvider,
  POS23_BUDGET_FILE,
  POS23_BUDGET_LIMIT,
  SESSION_CALL_LIMIT,
  type Pos23BudgetTracker,
};

type LocalModelMetadata = { digest: string | null };

async function assertLocalModelAvailable(): Promise<LocalModelMetadata> {
  const apiKey = (process.env.ASSISTANT_RADOX_API_KEY || process.env.RADOX_API_KEY)?.trim();
  if (!apiKey) throw new Error("ASSISTANT_RADOX_API_KEY is required for live mode.");
  return { digest: "radox-cloud" };
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function getArgValue(args: readonly string[], key: string): string | undefined {
  const prefix = `--${key}=`;
  const direct = args.find((a) => a.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const idx = args.indexOf(`--${key}`);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith("--")) {
    return args[idx + 1];
  }
  return undefined;
}

export async function runIntentEvaluationCli(args: readonly string[]): Promise<number> {
  const isFakeMode = args.includes("--fake") || args.some((a) => a === "--provider=fake" || a.startsWith("--provider=fake="));
  const workflowArg = getArgValue(args, "workflow");

  // =========================================================================
  // WORKFLOW MODE: --workflow=pos24-offline
  // =========================================================================
  if (workflowArg === "pos24-offline") {
    if (!isFakeMode) {
      throw new Error("POS-24 workflow only supports offline fake mode (--fake) in this phase.");
    }

    const workspaceArg = getArgValue(args, "workspace");
    const layout = setupOrVerifyPos24Workspace({
      workspaceDir: workspaceArg,
      repoRoot,
      allowExistingOwned: false,
    });

    const controlFixture = getArgValue(args, "control-fixture") ??
      path.join(repoRoot, "backend/src/tests/assistantEvaluation/fixtures/pos24-synthetic-control.json");
    const candidateFixture = getArgValue(args, "candidate-fixture") ??
      path.join(repoRoot, "backend/src/tests/assistantEvaluation/fixtures/pos24-synthetic-candidate.json");
    const benchmarkFixture = getArgValue(args, "benchmark-fixture");

    const workflowResult = await runPos24OfflineWorkflow({
      workspaceDir: layout.workspaceDir,
      controlFixturePath: controlFixture,
      candidateFixturePath: candidateFixture,
      benchmarkFixturePath: benchmarkFixture,
      repoRoot,
      onStageStart: (stage) => console.log(`[POS-24 Workflow] Starting stage: ${stage}...`),
      onStageEnd: (stage, res) => {
        console.log(`[POS-24 Workflow] Stage ${stage} finished: gatePassed=${res.gatePassed}, rows=${res.totalRows}, techFail=${res.technicalFail}, wrongSel=${res.wrongSelection}`);
        if (res.stopReason) console.log(`  Stop reason: ${res.stopReason}`);
      },
    });

    console.log(`\n=== POS-24 Offline Workflow Result ===`);
    console.log(`Overall Success: ${workflowResult.success}`);
    console.log(`Stages Completed: ${workflowResult.stagesCompleted} / ${workflowResult.stagesTotal}`);
    if (workflowResult.failedStage) {
      console.log(`Failed Stage: ${workflowResult.failedStage}`);
      console.log(`Reason: ${workflowResult.stopReason}`);
    }
    console.log(`Total Fake Provider Calls: ${workflowResult.fakeCallsTotal}`);
    return workflowResult.success ? 0 : 1;
  }

  // =========================================================================
  // SINGLE SUITE MODE
  // =========================================================================
  const suiteArg = getArgValue(args, "suite");
  const validSuites = [
    "baseline-dev",
    "planA-dev",
    "planB-dev",
    "holdout",
    "benchmark",
    "pos23-dev",
    "pos23-holdout",
    "pos23-benchmark",
    "pos23-exp-dev",
    "pos23-exp-baseline-dev",
    "pos23-exp-candidate-dev",
    "pos23-exp-holdout",
    "pos23-exp-benchmark",
    "pos24-dev",
    "pos24-diag",
    "pos24-benchmark",
  ];

  if (!suiteArg || !validSuites.includes(suiteArg)) {
    console.error(`Usage: tsx evaluate-assistant-intent.ts --suite=<${validSuites.join(" | ")}> [--fake] [--fake-fixture=<control|candidate|error|path>] [--role=<control|candidate>] [--workspace=<dir>] [--budget-file=<path>] [--journal-dir=<dir>] [--report-dir=<dir>] [--lock-file=<path>]`);
    return 1;
  }

  const isPos24Suite = suiteArg.startsWith("pos24-");

  // FAIL-CLOSED GUARD: POS-24 live mode is NOT approved yet. Must fail closed BEFORE lock, network, or budget touch.
  if (isPos24Suite && !isFakeMode) {
    throw new Error(
      "POS-24 live evaluation is not approved by project owner. Only offline/fake mode (--fake) is supported in this preparation phase.",
    );
  }

  const roleArg = getArgValue(args, "role") ?? (suiteArg.includes("candidate") ? "candidate" : "control");

  // Setup Workspace & Paths
  let lockPath: string;
  let reportDir: string;
  let journalDir: string;
  let fakeBudgetPath: string | null = null;
  const budgetArg = getArgValue(args, "budget-file");
  const lockArg = getArgValue(args, "lock-file");
  const reportDirArg = getArgValue(args, "report-dir");
  const journalDirArg = getArgValue(args, "journal-dir");
  const workspaceArg = getArgValue(args, "workspace");

  if (isFakeMode) {
    const layout = setupOrVerifyPos24Workspace({
      workspaceDir: workspaceArg,
      repoRoot,
      allowExistingOwned: true,
      customBudgetFile: budgetArg,
      customLockFile: lockArg,
      customJournalDir: journalDirArg,
      customReportDir: reportDirArg,
    });
    lockPath = layout.lockFile;
    reportDir = layout.reportsDir;
    journalDir = layout.journalsDir;
    fakeBudgetPath = layout.budgetFile;
  } else {
    // Live mode (only permitted for approved non-POS-24 suites)
    lockPath = lockArg ? path.resolve(lockArg) : POS23_LOCK_FILE;
    reportDir = reportDirArg ? path.resolve(reportDirArg) : defaultReportDirectory;
    journalDir = journalDirArg ? path.resolve(journalDirArg) : defaultReportDirectory;
  }

  let cases: readonly any[] = [];
  let datasetVersion = "";
  let datasetHash = "";
  let repetitions = 1;
  let maxCallsNeeded = 0;

  if (suiteArg === "baseline-dev") {
    repetitions = 1;
    datasetVersion = `${INTENT_DATASET_VERSION}:development`;
    datasetHash = sha256(JSON.stringify(INTENT_DEVELOPMENT_CASES));
    cases = INTENT_DEVELOPMENT_CASES;
  } else if (suiteArg === "planA-dev" || suiteArg === "planB-dev") {
    repetitions = 2;
    datasetVersion = `${INTENT_DATASET_VERSION}:development`;
    datasetHash = sha256(JSON.stringify(INTENT_DEVELOPMENT_CASES));
    cases = INTENT_DEVELOPMENT_CASES;
  } else if (suiteArg === "holdout") {
    repetitions = 2;
    datasetVersion = `${INTENT_DATASET_VERSION}:holdout`;
    datasetHash = sha256(JSON.stringify(INTENT_HOLDOUT_CASES));
    cases = INTENT_HOLDOUT_CASES;
  } else if (suiteArg === "benchmark" || suiteArg === "pos23-benchmark" || suiteArg === "pos23-exp-benchmark" || suiteArg === "pos24-benchmark") {
    repetitions = 1;
    datasetVersion = EVALUATION_DATASET_VERSION;
    datasetHash = sha256(JSON.stringify(EVALUATION_CASES));
    cases = EVALUATION_CASES;
    maxCallsNeeded = 56;
  } else if (suiteArg === "pos23-dev") {
    repetitions = 2;
    datasetVersion = `${POS23_DATASET_VERSION}:development`;
    datasetHash = POS23_DEV_HASH;
    cases = POS23_DEV_CASES;
    maxCallsNeeded = 24;
  } else if (suiteArg === "pos23-holdout") {
    repetitions = 2;
    datasetVersion = `${POS23_DATASET_VERSION}:holdout`;
    datasetHash = POS23_HOLDOUT_HASH;
    cases = POS23_HOLDOUT_CASES;
    maxCallsNeeded = 24;
  } else if (
    suiteArg === "pos23-exp-dev" ||
    suiteArg === "pos23-exp-baseline-dev" ||
    suiteArg === "pos23-exp-candidate-dev"
  ) {
    repetitions = 2;
    datasetVersion = `${POS23_EXP_DATASET_VERSION}:development`;
    datasetHash = POS23_EXP_DEV_HASH;
    cases = POS23_EXP_DEV_CASES;
    maxCallsNeeded = 8;
  } else if (suiteArg === "pos23-exp-holdout") {
    repetitions = 2;
    datasetVersion = `${POS23_EXP_DATASET_VERSION}:holdout`;
    datasetHash = POS23_EXP_HOLDOUT_HASH;
    cases = POS23_EXP_HOLDOUT_CASES;
    maxCallsNeeded = 8;
  } else if (suiteArg === "pos24-dev") {
    repetitions = 2;
    datasetVersion = `${POS24_DATASET_VERSION}:development`;
    datasetHash = POS24_DEV_HASH;
    cases = POS24_DEV_CASES;
    maxCallsNeeded = 16;
  } else if (suiteArg === "pos24-diag") {
    repetitions = 2;
    datasetVersion = `${POS24_DATASET_VERSION}:diagnostic`;
    datasetHash = POS24_DIAG_HASH;
    cases = POS24_DIAG_CASES;
    maxCallsNeeded = 16;
  }

  // Acquire exclusive concurrency lock
  const releaseLock = acquireEvaluatorLock(lockPath);
  let journalWriter: IntentJournalWriter | null = null;

  try {
    const runId = `nova-intent-${suiteArg}-${new Date().toISOString().replace(/[-:.TZ]/gu, "")}-${crypto.randomUUID()}`;
    const runRecord = { suite: suiteArg, runId, calls: 0 };

    let delegate: AssistantHelpProvider;
    let modelMetadata: LocalModelMetadata | null = null;
    let tracker: Pos23BudgetTracker;
    const isPos23Suite = suiteArg.startsWith("pos23-");

    if (isFakeMode) {
      // In Fake Mode: resolve fixture explicitly
      const fixtureParam = getArgValue(args, "fake-fixture");
      let fixture: FakeIntentFixture;

      if (!fixtureParam) {
        throw new Error(
          "In --fake mode, you must declare an explicit synthetic fixture via --fake-fixture=<control|candidate|error|path>. Auto-inferring answers from expected is prohibited.",
        );
      }

      let fixturePath = "";
      if (fixtureParam === "control") {
        fixturePath = path.join(path.dirname(currentFile), "../src/tests/assistantEvaluation/fixtures/pos24-synthetic-control.json");
      } else if (fixtureParam === "candidate") {
        fixturePath = path.join(path.dirname(currentFile), "../src/tests/assistantEvaluation/fixtures/pos24-synthetic-candidate.json");
      } else if (fixtureParam === "error") {
        fixturePath = path.join(path.dirname(currentFile), "../src/tests/assistantEvaluation/fixtures/pos24-synthetic-error.json");
      } else {
        fixturePath = path.resolve(fixtureParam);
      }

      if (!fs.existsSync(fixturePath)) {
        throw new Error(`Fake fixture file not found at: "${fixturePath}".`);
      }

      try {
        fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
      } catch (err) {
        throw new Error(`Failed to parse fake fixture JSON at ${fixturePath}: ${String(err)}`);
      }

      delegate = new FakeIntentProvider(fixture);

      // In Fake Mode: use workspace budget ledger (or custom within workspace)
      const budgetFilePath = fakeBudgetPath!;
      if (fs.existsSync(budgetFilePath)) {
        tracker = readPos23Budget(budgetFilePath);
      } else {
        tracker = { totalCalls: 0, runs: [] };
        fs.writeFileSync(budgetFilePath, JSON.stringify(tracker, null, 2) + "\n", { flag: "wx", encoding: "utf8" });
      }

      if (tracker.totalCalls + maxCallsNeeded > POS24_DEFAULT_OFFLINE_BUDGET_LIMIT) {
        throw new Error(
          `Budget Exceeded in fake runner: ${tracker.totalCalls} calls used; running ${suiteArg} requires up to ${maxCallsNeeded} calls which exceeds limit ${POS24_DEFAULT_OFFLINE_BUDGET_LIMIT}.`,
        );
      }
      tracker.runs.push(runRecord);
      writePos23Budget(tracker, budgetFilePath);
    } else {
      // Live Radox Mode
      const budgetFilePath = budgetArg ? path.resolve(budgetArg) : POS23_BUDGET_FILE;
      tracker = isPos23Suite ? readPos23Budget(budgetFilePath) : { totalCalls: 0, runs: [] };

      if (isPos23Suite) {
        if (tracker.totalCalls + maxCallsNeeded > POS23_BUDGET_LIMIT) {
          throw new Error(
            `POS-23 Call Budget Exceeded: currently ${tracker.totalCalls} calls used; running ${suiteArg} requires up to ${maxCallsNeeded} calls which exceeds limit ${POS23_BUDGET_LIMIT}.`,
          );
        }
        console.log(
          `[POS-23 Budget Pre-check] Used so far: ${tracker.totalCalls} / ${POS23_BUDGET_LIMIT}. Projected max this run: ${maxCallsNeeded}. Session limit: ${SESSION_CALL_LIMIT}.`,
        );
        tracker.runs.push(runRecord);
        writePos23Budget(tracker, budgetFilePath);
      }

      modelMetadata = await assertLocalModelAvailable();
      const apiKey = (process.env.ASSISTANT_RADOX_API_KEY || process.env.RADOX_API_KEY)!.trim();
      delegate = new RadoxAssistantHelpProvider({
        baseUrl: process.env.ASSISTANT_RADOX_BASE_URL || DEFAULT_RADOX_BASE_URL,
        apiKey,
        model: process.env.ASSISTANT_MODEL || DEFAULT_RADOX_MODEL,
      });
    }

    const knowledge = loadKnowledge();
    let gitHead = "unknown";
    let status = "";
    try {
      gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
      status = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).trim();
    } catch {
      // Fallback in headless environment
    }
    const workingTreeEntryCount = status ? status.split(/\r?\n/u).length : 0;

    const journalPath = path.join(journalDir, `assistant-intent-journal-${runId}.jsonl`);
    journalWriter = new IntentJournalWriter(journalPath);
    journalWriter.init({
      runId,
      suite: suiteArg,
      createdAt: new Date().toISOString(),
      gitHead,
      workingTree: (status ? "WIP" : "CLEAN") as "WIP" | "CLEAN",
      workingTreeEntryCount,
      modelTag: isFakeMode ? "fake:synthetic" : (process.env.ASSISTANT_MODEL || DEFAULT_RADOX_MODEL),
      modelDigest: isFakeMode ? null : modelMetadata?.digest ?? null,
      selectorProtocolVersion: SELECTOR_PROTOCOL_VERSION,
      selectorPromptHash: ASSISTANT_SELECTOR_PROMPT_HASH,
      faqVersion: knowledge.faqVersion,
      faqHash: knowledge.faqHash,
      catalogVersion: ANSWER_CATALOG_VERSION,
      catalogHash: ANSWER_CATALOG_HASH,
      datasetVersion,
      datasetHash,
      config: {
        temperature: 0.1 as const,
        numCtx: 8192 as const,
        numPredict: isFakeMode ? 530 : (delegate as any).numPredict ?? 530,
        maxQuestionCodePoints: 500,
        maxAnswerCodePoints: 2000,
        providerTimeoutMs: 25_000,
        requestTimeoutMs: 30_000,
        repetitions,
      },
      plannedCases: cases.length,
      plannedTrials: cases.length * repetitions,
      executionMode: isFakeMode ? "FAKE_OFFLINE" : "LIVE",
      fakeProviderCalls: isFakeMode ? 0 : undefined,
      snapshotRole: roleArg,
    });

    const provider = isFakeMode
      ? createBudgetTrackingProvider(
          delegate,
          tracker,
          runRecord,
          fakeBudgetPath!,
          POS24_DEFAULT_OFFLINE_BUDGET_LIMIT,
          POS24_DEFAULT_OFFLINE_BUDGET_LIMIT,
        )
      : isPos23Suite
      ? createBudgetTrackingProvider(delegate, tracker, runRecord, budgetArg ? path.resolve(budgetArg) : POS23_BUDGET_FILE)
      : createCountingProvider(delegate);

    const service = createIntentService(provider);

    const results = await runIntentTrials({
      service,
      provider,
      suite: suiteArg,
      cases,
      repetitions,
      onTrialComplete: (trial, item, rep) => {
        journalWriter?.appendTrial(item.id, rep, trial);
      },
    });

    const metadata: import("../src/tests/assistantEvaluation/intentRunner.js").IntentRunMetadata = {
      runId,
      suite: suiteArg,
      createdAt: new Date().toISOString(),
      gitHead,
      workingTree: (status ? "WIP" : "CLEAN") as "WIP" | "CLEAN",
      workingTreeEntryCount,
      modelTag: isFakeMode ? "fake:synthetic" : (process.env.ASSISTANT_MODEL || DEFAULT_RADOX_MODEL),
      modelDigest: isFakeMode ? null : modelMetadata?.digest ?? null,
      selectorProtocolVersion: SELECTOR_PROTOCOL_VERSION,
      selectorPromptHash: ASSISTANT_SELECTOR_PROMPT_HASH,
      faqVersion: knowledge.faqVersion,
      faqHash: knowledge.faqHash,
      catalogVersion: ANSWER_CATALOG_VERSION,
      catalogHash: ANSWER_CATALOG_HASH,
      datasetVersion,
      datasetHash,
      config: {
        temperature: 0.1 as const,
        numCtx: 8192 as const,
        numPredict: isFakeMode ? 530 : (delegate as any).numPredict ?? 530,
        maxQuestionCodePoints: 500,
        maxAnswerCodePoints: 2000,
        providerTimeoutMs: 25_000,
        requestTimeoutMs: 30_000,
        repetitions,
      },
      localModelCalls: isFakeMode ? 0 : provider.callCount,
      externalAiCalls: 0 as const,
      executionMode: isFakeMode ? "FAKE_OFFLINE" : "LIVE",
      fakeProviderCalls: isFakeMode ? provider.callCount : undefined,
      snapshotRole: roleArg,
    };

    const summary = buildIntentSummary({ metadata, results });
    const written = writeIntentReport(summary, reportDir);
    journalWriter.finalize("COMPLETE", summary.totals);

    if (!isFakeMode && isPos23Suite) {
      console.log(`[POS-23 Budget] Calls used this run: ${provider.callCount}. Cumulative: ${tracker.totalCalls} / ${POS23_BUDGET_LIMIT}. Remaining: ${POS23_BUDGET_LIMIT - tracker.totalCalls}`);
    } else if (isFakeMode) {
      console.log(`[Fake Offline] Fake provider calls used: ${provider.callCount}. Local model calls: 0. External AI calls: 0.`);
    }

    console.log(`\n=== Run Completed: ${suiteArg} ===`);
    console.log(`Run ID: ${metadata.runId}`);
    console.log(`Mode: ${metadata.executionMode ?? "LIVE"}`);
    console.log(`Provider calls: ${provider.callCount}; Rows: ${results.length}`);
    console.log(`Deterministic: ${summary.totals.deterministicCorrect}/${summary.totals.deterministicTotal}`);
    console.log(`Model / Synthetic: ${summary.totals.modelCorrect}/${summary.totals.modelTotal}`);
    console.log(`Overall: ${summary.totals.overallCorrect}/${summary.totals.overallTotal}`);
    console.log(`Report JSON: ${written.jsonPath}`);
    console.log(`Report MD: ${written.markdownPath}`);
    console.log(`Journal JSONL: ${journalPath}\n`);

    if (summary.totals.wrongSelection > 0 || summary.totals.technicalFail > 0 || summary.severeSafetyViolationDetected) {
      return 1;
    }
    return 0;
  } finally {
    journalWriter?.close();
    releaseLock();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runIntentEvaluationCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Intent evaluation could not complete.");
      process.exitCode = 1;
    });
}

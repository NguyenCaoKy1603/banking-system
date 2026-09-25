import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  readIntentJournal,
  IntentJournalWriter,
  type JournalReadResult,
} from "./intentJournal.js";

export type IntentJournalStatus = "COMPLETE" | "INCOMPLETE" | "CORRUPTED";
import {
  acquireEvaluatorLock,
  readPos23Budget,
  writePos23Budget,
  createBudgetTrackingProvider,
  type Pos23BudgetTracker,
  type Pos23RunRecord,
} from "./pos23BudgetTracker.js";
import {
  FakeIntentProvider,
  createIntentService,
  runIntentTrials,
  buildIntentSummary,
  writeIntentReport,
  type FakeIntentFixture,
  type IntentRunSummary,
  type IntentTrial,
} from "./intentRunner.js";
import {
  POS24_DEV_CASES,
  POS24_DIAG_CASES,
  POS24_DATASET_VERSION,
  POS24_DEV_HASH,
  POS24_DIAG_HASH,
} from "./pos24DisambiguationDataset.js";
import {
  EVALUATION_CASES,
  EVALUATION_DATASET_VERSION,
} from "./dataset.js";
import {
  ANSWER_CATALOG_HASH,
  ANSWER_CATALOG_VERSION,
  ASSISTANT_SELECTOR_PROMPT_HASH,
  SELECTOR_PROTOCOL_VERSION,
} from "../../assistant/responseCatalog.js";
import { loadKnowledge } from "../../assistant/knowledgeLoader.js";
import {
  setupOrVerifyPos24Workspace,
  POS24_DEFAULT_OFFLINE_BUDGET_LIMIT,
  type Pos24WorkspaceLayout,
} from "./pos24Workspace.js";

export type Pos24WorkflowStage = "control-dev" | "candidate-dev" | "candidate-diag" | "candidate-benchmark";

export type Pos24StageResult = {
  stage: Pos24WorkflowStage;
  suite: string;
  role: "control" | "candidate";
  totalRows: number;
  expectedRows: number;
  technicalFail: number;
  wrongSelection: number;
  overallCorrect: number;
  journalStatus: IntentJournalStatus;
  gatePassed: boolean;
  stopReason?: string;
  summary?: IntentRunSummary;
};

export type Pos24WorkflowResult = {
  success: boolean;
  stagesCompleted: number;
  stagesTotal: number;
  failedStage?: Pos24WorkflowStage;
  stopReason?: string;
  stageResults: Pos24StageResult[];
  fakeCallsTotal: number;
  stageCounters: Record<Pos24WorkflowStage, number>;
};

export type Pos24WorkflowOptions = {
  workspaceDir: string;
  controlFixturePath: string;
  candidateFixturePath: string;
  benchmarkFixturePath?: string;
  budgetLimit?: number;
  repoRoot?: string;
  onStageStart?: (stage: Pos24WorkflowStage) => void;
  onStageEnd?: (stage: Pos24WorkflowStage, result: Pos24StageResult) => void;
};

function sha256(val: string): string {
  return crypto.createHash("sha256").update(val, "utf8").digest("hex");
}

/**
 * Runs the full 4-stage POS-24 Offline Evaluation Workflow:
 * Stage 1: Control DEV (16 trials) -> Stop Gate: valid journal COMPLETE & 0 technical failures (wrongSelection allowed as baseline error)
 * Stage 2: Candidate DEV (16 trials) -> Stop Gate: valid journal COMPLETE, 0 technical failures, 16/16 correct selection
 * Stage 3: Candidate DIAG (16 trials) -> Stop Gate: valid journal COMPLETE, 0 technical failures, 16/16 correct selection
 * Stage 4: Candidate Benchmark (56 trials) -> Stop Gate: valid journal COMPLETE, 0 technical failures, 56/56 correct selection
 *
 * All stages share an isolated verified workspace, a single exclusive lock, and a single fake budget ledger.
 * Fails closed immediately if workspace containment is violated or if an existing ledger is detected.
 */
export async function runPos24OfflineWorkflow(
  options: Pos24WorkflowOptions,
): Promise<Pos24WorkflowResult> {
  const repoRoot = options.repoRoot ?? path.resolve(process.cwd(), "..");
  const layout: Pos24WorkspaceLayout = setupOrVerifyPos24Workspace({
    workspaceDir: options.workspaceDir,
    repoRoot,
  });

  // Validate fixtures exist
  const controlFixture = path.resolve(options.controlFixturePath);
  if (!fs.existsSync(controlFixture)) {
    throw new Error(`Control fixture not found: "${controlFixture}".`);
  }
  const candidateFixture = path.resolve(options.candidateFixturePath);
  if (!fs.existsSync(candidateFixture)) {
    throw new Error(`Candidate fixture not found: "${candidateFixture}".`);
  }
  const benchmarkFixture = options.benchmarkFixturePath
    ? path.resolve(options.benchmarkFixturePath)
    : candidateFixture;
  if (!fs.existsSync(benchmarkFixture)) {
    throw new Error(`Benchmark fixture not found: "${benchmarkFixture}".`);
  }

  // Acquire workflow-wide exclusive lock
  const releaseLock = acquireEvaluatorLock(layout.lockFile);

  try {
    // Policy: one workspace per workflow run. If ledger already exists, refuse to re-run and preserve prior bytes
    if (fs.existsSync(layout.budgetFile)) {
      throw new Error(
        `Ledger already exists in workspace: "${layout.budgetFile}". Re-running workflow in an existing workspace is refused to preserve prior run history and budget integrity.`,
      );
    }

    // Initialize fake budget ledger exclusively under lock
    const initialBudget: Pos23BudgetTracker = { totalCalls: 0, runs: [] };
    fs.writeFileSync(layout.budgetFile, JSON.stringify(initialBudget, null, 2) + "\n", {
      flag: "wx",
      encoding: "utf8",
    });

    const budgetCeiling = options.budgetLimit ?? POS24_DEFAULT_OFFLINE_BUDGET_LIMIT;

    const stageCounters: Record<Pos24WorkflowStage, number> = {
      "control-dev": 0,
      "candidate-dev": 0,
      "candidate-diag": 0,
      "candidate-benchmark": 0,
    };

    const stageResults: Pos24StageResult[] = [];
    const knowledge = loadKnowledge();

    let gitHead = "unknown";
    let gitStatus = "";
    try {
      gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: layout.workspaceDir, encoding: "utf8" }).trim();
      gitStatus = execFileSync("git", ["status", "--porcelain"], { cwd: layout.workspaceDir, encoding: "utf8" }).trim();
    } catch {
      // Fallback if git unavailable
    }
    const workingTreeEntryCount = gitStatus ? gitStatus.split(/\r?\n/u).length : 0;

    // Stage configurations
    const stages: Array<{
      id: Pos24WorkflowStage;
      suite: string;
      role: "control" | "candidate";
      fixturePath: string;
      cases: readonly any[];
      repetitions: number;
      expectedRows: number;
      datasetVersion: string;
      datasetHash: string;
      allowWrongSelection: boolean;
    }> = [
      {
        id: "control-dev",
        suite: "pos24-dev",
        role: "control",
        fixturePath: controlFixture,
        cases: POS24_DEV_CASES,
        repetitions: 2,
        expectedRows: 16,
        datasetVersion: `${POS24_DATASET_VERSION}:development`,
        datasetHash: POS24_DEV_HASH,
        allowWrongSelection: true,
      },
      {
        id: "candidate-dev",
        suite: "pos24-dev",
        role: "candidate",
        fixturePath: candidateFixture,
        cases: POS24_DEV_CASES,
        repetitions: 2,
        expectedRows: 16,
        datasetVersion: `${POS24_DATASET_VERSION}:development`,
        datasetHash: POS24_DEV_HASH,
        allowWrongSelection: false,
      },
      {
        id: "candidate-diag",
        suite: "pos24-diag",
        role: "candidate",
        fixturePath: candidateFixture,
        cases: POS24_DIAG_CASES,
        repetitions: 2,
        expectedRows: 16,
        datasetVersion: `${POS24_DATASET_VERSION}:diagnostic`,
        datasetHash: POS24_DIAG_HASH,
        allowWrongSelection: false,
      },
      {
        id: "candidate-benchmark",
        suite: "pos24-benchmark",
        role: "candidate",
        fixturePath: benchmarkFixture,
        cases: EVALUATION_CASES,
        repetitions: 1,
        expectedRows: 56,
        datasetVersion: EVALUATION_DATASET_VERSION,
        datasetHash: sha256(JSON.stringify(EVALUATION_CASES)),
        allowWrongSelection: false,
      },
    ];

    for (const stageDef of stages) {
      options.onStageStart?.(stageDef.id);
      stageCounters[stageDef.id]++;

      const runId = `nova-intent-${stageDef.suite}-${stageDef.role}-${new Date().toISOString().replace(/[-:.TZ]/gu, "")}-${crypto.randomUUID()}`;
      const runRecord: Pos23RunRecord = { suite: stageDef.suite, runId, calls: 0 };

      // Load fixture
      const fixtureJson = JSON.parse(fs.readFileSync(stageDef.fixturePath, "utf8")) as FakeIntentFixture;
      const delegate = new FakeIntentProvider(fixtureJson);

      // Read current shared budget and register run
      const tracker = readPos23Budget(layout.budgetFile);
      tracker.runs.push(runRecord);
      writePos23Budget(tracker, layout.budgetFile);

      const provider = createBudgetTrackingProvider(
        delegate,
        tracker,
        runRecord,
        layout.budgetFile,
        budgetCeiling,
        budgetCeiling,
      );

      const journalFile = path.join(layout.journalsDir, `journal-${stageDef.id}-${runId}.jsonl`);
      const journalWriter = new IntentJournalWriter(journalFile);

      let runResults: IntentTrial[] = [];
      let executionError: Error | null = null;
      let summary: IntentRunSummary;

      try {
        journalWriter.init({
          runId,
          suite: stageDef.suite,
          createdAt: new Date().toISOString(),
          gitHead,
          workingTree: (gitStatus ? "WIP" : "CLEAN") as "WIP" | "CLEAN",
          workingTreeEntryCount,
          modelTag: "fake:synthetic",
          modelDigest: null,
          selectorProtocolVersion: SELECTOR_PROTOCOL_VERSION,
          selectorPromptHash: ASSISTANT_SELECTOR_PROMPT_HASH,
          faqVersion: knowledge.faqVersion,
          faqHash: knowledge.faqHash,
          catalogVersion: ANSWER_CATALOG_VERSION,
          catalogHash: ANSWER_CATALOG_HASH,
          datasetVersion: stageDef.datasetVersion,
          datasetHash: stageDef.datasetHash,
          config: {
            temperature: 0.1,
            numCtx: 8192,
            numPredict: 530,
            maxQuestionCodePoints: 500,
            maxAnswerCodePoints: 2000,
            providerTimeoutMs: 25_000,
            requestTimeoutMs: 30_000,
            repetitions: stageDef.repetitions,
          },
          plannedCases: stageDef.cases.length,
          plannedTrials: stageDef.expectedRows,
          executionMode: "FAKE_OFFLINE",
          fakeProviderCalls: 0,
          snapshotRole: stageDef.role,
        });

        const service = createIntentService(provider);

        try {
          runResults = await runIntentTrials({
            service,
            provider,
            suite: stageDef.suite,
            cases: stageDef.cases,
            repetitions: stageDef.repetitions,
            onTrialComplete: (trial, item, rep) => {
              journalWriter.appendTrial(item.id, rep, trial);
            },
          });
        } catch (err: any) {
          executionError = err;
        }

        const runMetadata = {
          runId,
          suite: stageDef.suite,
          createdAt: new Date().toISOString(),
          gitHead,
          workingTree: (gitStatus ? "WIP" : "CLEAN") as "WIP" | "CLEAN",
          workingTreeEntryCount,
          modelTag: "fake:synthetic",
          modelDigest: null,
          selectorProtocolVersion: SELECTOR_PROTOCOL_VERSION,
          selectorPromptHash: ASSISTANT_SELECTOR_PROMPT_HASH,
          faqVersion: knowledge.faqVersion,
          faqHash: knowledge.faqHash,
          catalogVersion: ANSWER_CATALOG_VERSION,
          catalogHash: ANSWER_CATALOG_HASH,
          datasetVersion: stageDef.datasetVersion,
          datasetHash: stageDef.datasetHash,
          config: {
            temperature: 0.1 as const,
            numCtx: 8192 as const,
            numPredict: 530,
            maxQuestionCodePoints: 500,
            maxAnswerCodePoints: 2000,
            providerTimeoutMs: 25_000,
            requestTimeoutMs: 30_000,
            repetitions: stageDef.repetitions,
          },
          localModelCalls: 0,
          externalAiCalls: 0 as const,
          executionMode: "FAKE_OFFLINE" as const,
          fakeProviderCalls: provider.callCount,
          snapshotRole: stageDef.role,
        };

        summary = buildIntentSummary({ metadata: runMetadata, results: runResults });
        writeIntentReport(summary, layout.reportsDir);

        if (executionError) {
          journalWriter.finalize("INCOMPLETE", summary.totals);
        } else {
          journalWriter.finalize("COMPLETE", summary.totals);
        }
      } finally {
        journalWriter.close();
      }

      // Read journal back to verify recording integrity
      const journalCheck = readIntentJournal(journalFile);

      // Evaluate Stop Gate
      let gatePassed = true;
      let stopReason: string | undefined;

      if (executionError) {
        gatePassed = false;
        stopReason = `Execution error in stage ${stageDef.id}: ${executionError.message}`;
      } else if (journalCheck.status !== "COMPLETE") {
        gatePassed = false;
        stopReason = `Journal integrity verification failed for ${stageDef.id}: status="${journalCheck.status}" (${journalCheck.issues.join("; ")})`;
      } else if (runResults.length !== stageDef.expectedRows) {
        gatePassed = false;
        stopReason = `Row count mismatch for ${stageDef.id}: expected ${stageDef.expectedRows}, got ${runResults.length}`;
      } else if (summary.totals.technicalFail > 0) {
        gatePassed = false;
        stopReason = `Technical failure detected in ${stageDef.id}: ${summary.totals.technicalFail} failed calls`;
      } else if (!stageDef.allowWrongSelection && (summary.totals.wrongSelection > 0 || summary.totals.overallCorrect !== stageDef.expectedRows)) {
        gatePassed = false;
        stopReason = `Selection accuracy gate failed for ${stageDef.id}: expected ${stageDef.expectedRows}/${stageDef.expectedRows}, got ${summary.totals.overallCorrect}/${stageDef.expectedRows} (${summary.totals.wrongSelection} wrong)`;
      }

      const stageResult: Pos24StageResult = {
        stage: stageDef.id,
        suite: stageDef.suite,
        role: stageDef.role,
        totalRows: runResults.length,
        expectedRows: stageDef.expectedRows,
        technicalFail: summary.totals.technicalFail,
        wrongSelection: summary.totals.wrongSelection,
        overallCorrect: summary.totals.overallCorrect,
        journalStatus: journalCheck.status,
        gatePassed,
        stopReason,
        summary,
      };

      stageResults.push(stageResult);
      options.onStageEnd?.(stageDef.id, stageResult);

      if (!gatePassed) {
        // STOP PIPELINE: Subsequent stages are NOT invoked!
        const finalTracker = readPos23Budget(layout.budgetFile);
        return {
          success: false,
          stagesCompleted: stageResults.filter((r) => r.gatePassed).length,
          stagesTotal: stages.length,
          failedStage: stageDef.id,
          stopReason,
          stageResults,
          fakeCallsTotal: finalTracker.totalCalls,
          stageCounters,
        };
      }
    }

    const finalTracker = readPos23Budget(layout.budgetFile);
    return {
      success: true,
      stagesCompleted: stageResults.length,
      stagesTotal: stages.length,
      stageResults,
      fakeCallsTotal: finalTracker.totalCalls,
      stageCounters,
    };
  } finally {
    releaseLock();
  }
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_RADOX_BASE_URL,
  DEFAULT_RADOX_MODEL,
  RadoxAssistantHelpProvider,
} from "../src/assistant/radoxHelpProvider.js";
import {
  generateRadoxJsonReport,
  generateRadoxMarkdownReport,
  resolveEvaluationCases,
  resolveReportPaths,
  runRadoxEvaluation,
  validateEvaluationOutputName,
} from "../src/tests/assistantEvaluation/index.js";

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), "../..");
const reportDirectory = path.join(repoRoot, "documents/06-security-ai");

export function parseCliArgs(customArgs?: string[]) {
  const args = customArgs ?? process.argv.slice(2);
  let selectedCaseIds: string[] | undefined;
  let model: string = DEFAULT_RADOX_MODEL;
  let outputName: string | undefined;
  let timeoutMs: number = 20_000;

  for (const arg of args) {
    if (arg.startsWith("--cases=")) {
      selectedCaseIds = arg
        .slice("--cases=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith("--model=")) {
      model = arg.slice("--model=".length).trim();
    } else if (arg.startsWith("--output-name=")) {
      const rawName = arg.slice("--output-name=".length).trim();
      outputName = validateEvaluationOutputName(rawName);
    } else if (arg.startsWith("--timeout=")) {
      const val = Number(arg.slice("--timeout=".length).trim());
      if (Number.isSafeInteger(val) && val > 0) {
        timeoutMs = val;
      } else {
        throw new Error(`Invalid --timeout value: ${arg}`);
      }
    }
  }

  return { selectedCaseIds, model, outputName, timeoutMs };
}

async function main(): Promise<void> {
  const apiKey = (process.env.ASSISTANT_RADOX_API_KEY || process.env.RADOX_API_KEY)?.trim();
  if (!apiKey) {
    console.error("ASSISTANT_RADOX_API_KEY environment variable is required to run live evaluation.");
    process.exitCode = 1;
    return;
  }

  const { selectedCaseIds, model, outputName, timeoutMs } = parseCliArgs();
  const casesToRun = resolveEvaluationCases(selectedCaseIds);

  const baseName =
    outputName ??
    (selectedCaseIds && selectedCaseIds.length > 0
      ? `assistant-evaluation-radox-subset-${Date.now()}`
      : `assistant-evaluation-radox-run-${Date.now()}`);

  const { markdownOutputPath, jsonOutputPath } = resolveReportPaths(baseName, reportDirectory);

  console.log("NOVA Radox AI evaluation");
  console.log(`Model: ${model}`);
  console.log(`Mode: Radox AI Gateway, sequential run (${casesToRun.length} cases), timeout=${timeoutMs}ms`);

  try {
    const provider = new RadoxAssistantHelpProvider({
      baseUrl: process.env.ASSISTANT_RADOX_BASE_URL || DEFAULT_RADOX_BASE_URL,
      apiKey,
      model,
    });
    const summary = await runRadoxEvaluation({
      provider,
      providerTimeoutMs: timeoutMs,
      cases: casesToRun,
      model: `${model} (Radox AI Gateway)`,
      onProgress: ({ completed, total, caseId, verdict, durationMs }) => {
        console.log(`[${completed}/${total}] ${caseId}: ${verdict} (${durationMs} ms)`);
      },
    });

    fs.mkdirSync(reportDirectory, { recursive: true });
    fs.writeFileSync(markdownOutputPath, generateRadoxMarkdownReport(summary), "utf8");
    fs.writeFileSync(jsonOutputPath, generateRadoxJsonReport(summary), "utf8");

    console.log(
      `Completed: ${summary.runCases}/${summary.totalCases}; ` +
        `PASS=${summary.passedCases}, FAIL=${summary.failedCases}, ` +
        `NEEDS_REVIEW=${summary.needsReviewCases}, ERROR=${summary.errorCases}`,
    );
    console.log(`Markdown: ${markdownOutputPath}`);
    console.log(`JSON: ${jsonOutputPath}`);

    if (summary.errorCases > 0 || summary.notRunCases > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      `Radox AI evaluation could not complete: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  void main();
}

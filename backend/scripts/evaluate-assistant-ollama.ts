import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_NUM_PREDICT,
  OllamaAssistantHelpProvider,
  SUPPORTED_OLLAMA_MODEL,
} from "../src/assistant/ollamaHelpProvider.js";
import {
  EVALUATION_CASES,
  generateOllamaJsonReport,
  generateOllamaMarkdownReport,
  resolveEvaluationCases,
  resolveReportPaths,
  runOllamaEvaluation,
  validateEvaluationOutputName,
} from "../src/tests/assistantEvaluation/index.js";

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), "../..");
const reportDirectory = path.join(repoRoot, "documents/06-security-ai");

export function parseCliArgs(customArgs?: string[]) {
  const args = customArgs ?? process.argv.slice(2);
  let selectedCaseIds: string[] | undefined;
  let numPredict: number = DEFAULT_OLLAMA_NUM_PREDICT;
  let outputName: string | undefined;
  let timeoutMs: number = 25_000;

  for (const arg of args) {
    if (arg.startsWith("--cases=")) {
      selectedCaseIds = arg
        .slice("--cases=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith("--num-predict=")) {
      const val = Number(arg.slice("--num-predict=".length).trim());
      if (Number.isSafeInteger(val) && val > 0) {
        numPredict = val;
      } else {
        throw new Error(`Invalid --num-predict value: ${arg}`);
      }
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

  return { selectedCaseIds, numPredict, outputName, timeoutMs };
}



async function assertLocalModelAvailable(): Promise<void> {
  const response = await fetch(`${DEFAULT_OLLAMA_BASE_URL}/api/tags`, {
    signal: AbortSignal.timeout(3_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Local Ollama preflight returned HTTP ${response.status}.`);
  const body = (await response.json()) as { models?: Array<{ name?: unknown }> };
  const available = body.models?.some((model) => model.name === SUPPORTED_OLLAMA_MODEL) ?? false;
  if (!available) {
    throw new Error(`Local model '${SUPPORTED_OLLAMA_MODEL}' is not available in Ollama.`);
  }
}

async function main(): Promise<void> {
  const { selectedCaseIds, numPredict, outputName, timeoutMs } = parseCliArgs();
  const casesToRun = resolveEvaluationCases(selectedCaseIds);

  const baseName =
    outputName ??
    (selectedCaseIds && selectedCaseIds.length > 0
      ? `assistant-evaluation-ollama-subset-${Date.now()}`
      : `assistant-evaluation-ollama-run-${Date.now()}`);

  const { markdownOutputPath, jsonOutputPath } = resolveReportPaths(baseName, reportDirectory);

  console.log("NOVA local model evaluation");
  console.log(`Model: ${SUPPORTED_OLLAMA_MODEL}`);
  console.log(
    `Mode: local Ollama, sequential run (${casesToRun.length} cases), num_predict=${numPredict}, timeout=${timeoutMs}ms`,
  );
  console.log("Zero external AI calls (no OpenAI, no Anthropic, no Ollama Cloud)");

  try {
    await assertLocalModelAvailable();
    const provider = new OllamaAssistantHelpProvider({
      baseUrl: DEFAULT_OLLAMA_BASE_URL,
      model: SUPPORTED_OLLAMA_MODEL,
      numPredict,
    });
    const summary = await runOllamaEvaluation({
      provider,
      providerTimeoutMs: timeoutMs,
      cases: casesToRun,
      model: `${SUPPORTED_OLLAMA_MODEL} (Ollama local, num_predict=${numPredict})`,
      onProgress: ({ completed, total, caseId, verdict, durationMs }) => {
        console.log(`[${completed}/${total}] ${caseId}: ${verdict} (${durationMs} ms)`);
      },
    });

    fs.mkdirSync(reportDirectory, { recursive: true });
    fs.writeFileSync(markdownOutputPath, generateOllamaMarkdownReport(summary), "utf8");
    fs.writeFileSync(jsonOutputPath, generateOllamaJsonReport(summary), "utf8");

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
      `Local Ollama evaluation could not complete: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  void main();
}

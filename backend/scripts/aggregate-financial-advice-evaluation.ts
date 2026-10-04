import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { aggregateEvaluationReports, writeAggregateReports } from "../src/tests/financialAdviceEvaluation/reporting.js";

const currentFile = fileURLToPath(import.meta.url);
const backendRoot = path.resolve(path.dirname(currentFile), "..");
const repositoryRoot = path.resolve(backendRoot, "..");
const evidenceDirectory = path.join(repositoryRoot, "documents", "06-security-ai");
const MAX_REPORT_BYTES = 1_048_576;

function readJsonReport(filePath: string): unknown {
  const size = statSync(filePath).size;
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_REPORT_BYTES) throw new Error("A report file exceeds the accepted size limit.");
  try { return JSON.parse(readFileSync(filePath, "utf8")) as unknown; }
  catch { throw new Error("A report file is not valid JSON."); }
}

function resolveInputPath(input: string): string {
  const resolved = path.resolve(backendRoot, input);
  const relative = path.relative(evidenceDirectory, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative) || path.extname(resolved).toLowerCase() !== ".json") {
    throw new Error("Report paths must point to JSON evidence under documents/06-security-ai.");
  }
  return resolved;
}

function parseCli(args: readonly string[]): { savings: string; budget: string; threshold: "unresolved" | "15-of-16" | "95-percent" } | null {
  if (args.length !== 3) return null;
  const values = new Map<string, string>();
  for (const arg of args) {
    const match = arg.match(/^--(savings-report|budget-report|threshold)=(.+)$/);
    if (!match || values.has(match[1]!)) return null;
    values.set(match[1]!, match[2]!);
  }
  const threshold = values.get("threshold");
  if (!values.has("savings-report") || !values.has("budget-report") || !["unresolved", "15-of-16", "95-percent"].includes(threshold ?? "")) return null;
  return { savings: values.get("savings-report")!, budget: values.get("budget-report")!, threshold: threshold as "unresolved" | "15-of-16" | "95-percent" };
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  if (!options) {
    console.error("Usage: node --import=tsx scripts/aggregate-financial-advice-evaluation.ts --savings-report=<json> --budget-report=<json> --threshold=unresolved|15-of-16|95-percent");
    process.exitCode = 2;
    return;
  }
  const savingsPath = resolveInputPath(options.savings);
  const budgetPath = resolveInputPath(options.budget);
  const savingsName = path.basename(savingsPath);
  const budgetName = path.basename(budgetPath);
  if (savingsName === budgetName) throw new Error("The two report inputs must be distinct.");
  const aggregate = aggregateEvaluationReports(readJsonReport(savingsPath), readJsonReport(budgetPath));
  const requestedThreshold = ({ unresolved: "UNRESOLVED", "15-of-16": "15_OF_16", "95-percent": "95_PERCENT" } as const)[options.threshold];
  if (aggregate.threshold !== requestedThreshold) throw new Error("Requested threshold does not match both source runs.");
  const timestamp = aggregate.createdAtUtc.replace(/[-:.]/g, "").replace("T", "-").replace("Z", "");
  const stem = `financial-advice-aggregate-${timestamp}-${aggregate.aggregateId}`;
  const { markdownPath, jsonPath } = writeAggregateReports(evidenceDirectory, aggregate, [savingsName, budgetName], stem);
  console.log(`Aggregate: 16/16 configured cases; live gate ${aggregate.summary.liveGate}; exit=${aggregate.summary.exitCode}`);
  console.log(`Safe aggregate report: ${path.relative(repositoryRoot, markdownPath)}`);
  console.log(`Safe aggregate machine report: ${path.relative(repositoryRoot, jsonPath)}`);
  process.exitCode = aggregate.summary.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFile)) {
  void main().catch(() => {
    console.error("Aggregation rejected invalid evidence or could not write a unique safe report; no raw input or exception was emitted.");
    process.exitCode = 2;
  });
}

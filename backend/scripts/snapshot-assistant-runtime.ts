#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createRuntimeSnapshot,
  verifyRuntimeSnapshot,
  restoreRuntimeSnapshot,
  type SnapshotRole,
} from "../src/tests/assistantEvaluation/snapshotManager.js";

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), "../..");
const defaultArchiveDir = path.join(repoRoot, "documents/06-security-ai/prompt-archive");
const defaultTarget = path.join(repoRoot, "backend/src/assistant/responseCatalog.ts");

function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const val = arg.slice(eqIdx + 1);
        result[key] = val;
      } else {
        result[arg.slice(2)] = true;
      }
    }
  }
  return result;
}

function printUsage(): void {
  console.log(`
Usage:
  npx tsx scripts/snapshot-assistant-runtime.ts --create --name=<snapshot-name> [--role=control|candidate|rollback_target] [--target=<path>] [--out=<dir>]
  npx tsx scripts/snapshot-assistant-runtime.ts --verify --file=<path>
  npx tsx scripts/snapshot-assistant-runtime.ts --restore --file=<path> --expected-current-hash=<hash> --target=<path> --workspace=<dir>

Note:
  --force has been permanently removed. Force bypass is prohibited.
  --target and --workspace are strictly required for --restore to prevent accidental runtime corruption.

Examples:
  npx tsx scripts/snapshot-assistant-runtime.ts --create --name=pos24-baseline-pre-edit --role=rollback_target
  npx tsx scripts/snapshot-assistant-runtime.ts --verify --file=documents/06-security-ai/prompt-archive/pos24-baseline-pre-edit.json
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  // Strict check: reject --force in any shape
  if ("force" in parsed || args.some((a) => a === "--force" || a.startsWith("--force="))) {
    console.error("Error: --force flag has been permanently removed. Force bypass is strictly prohibited.");
    process.exit(1);
  }

  if (parsed.help || Object.keys(parsed).length === 0) {
    printUsage();
    process.exit(0);
  }

  if (parsed.create) {
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    if (!name || !/^[a-zA-Z0-9_-]+$/u.test(name)) {
      console.error("Error: --name is required and must be alphanumeric with dashes or underscores.");
      process.exit(1);
    }

    const role = (typeof parsed.role === "string" ? parsed.role : "rollback_target") as SnapshotRole;
    const targetFile = typeof parsed.target === "string" ? path.resolve(parsed.target) : defaultTarget;
    const outDir = typeof parsed.out === "string" ? path.resolve(parsed.out) : defaultArchiveDir;
    const outFile = path.join(outDir, `${name}.json`);

    const snapshot = createRuntimeSnapshot({
      role,
      targetFilePath: targetFile,
      repoRoot,
    });

    const verification = verifyRuntimeSnapshot(snapshot);
    if (!verification.valid) {
      console.error(`Error: Created snapshot failed internal verification: ${verification.issues.join("; ")}`);
      process.exit(1);
    }

    fs.mkdirSync(outDir, { recursive: true });

    // Exclusive creation: flag "wx" prevents silent overwrite
    try {
      fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2), { flag: "wx", encoding: "utf8" });
    } catch (err: any) {
      if (err.code === "EEXIST") {
        console.error(`Error: Snapshot file already exists: ${outFile}. Overwrite is strictly forbidden.`);
        process.exit(1);
      }
      throw err;
    }

    console.log(`[Snapshot Created Successfully]`);
    console.log(`  File: ${outFile}`);
    console.log(`  Role: ${snapshot.snapshotRole}`);
    console.log(`  File SHA-256: ${snapshot.runtimeFileSha256}`);
    console.log(`  Selector Prompt Hash: ${snapshot.selectorPromptHash}`);
    console.log(`  Answer Catalog Hash: ${snapshot.answerCatalogHash}`);
    console.log(`  Entries Verified: ${snapshot.entries.length} / 25 items`);
    return;
  }

  if (parsed.verify) {
    const filePath = typeof parsed.file === "string" ? path.resolve(parsed.file) : "";
    if (!filePath || !fs.existsSync(filePath)) {
      console.error(`Error: Snapshot file not found: "${String(parsed.file)}".`);
      process.exit(1);
    }

    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
      console.error(`Error: Failed to parse snapshot JSON: ${String(err)}`);
      process.exit(1);
    }

    const verification = verifyRuntimeSnapshot(raw);
    if (!verification.valid) {
      console.error(`[Snapshot Verification FAILED]`);
      for (const issue of verification.issues) {
        console.error(`  - ${issue}`);
      }
      process.exit(1);
    }

    console.log(`[Snapshot Verification PASSED]`);
    console.log(`  File: ${filePath}`);
    console.log(`  Entries Count: ${verification.entriesCount}`);
    console.log(`  Runtime File SHA-256: ${verification.runtimeFileSha256}`);
    console.log(`  Prompt Hash: ${verification.selectorPromptHash}`);
    console.log(`  Catalog Hash: ${verification.answerCatalogHash}`);
    return;
  }

  if (parsed.restore) {
    const filePath = typeof parsed.file === "string" ? path.resolve(parsed.file) : "";
    if (!filePath || !fs.existsSync(filePath)) {
      console.error(`Error: Snapshot file not found: "${String(parsed.file)}".`);
      process.exit(1);
    }

    const expectedCurrentHash = typeof parsed["expected-current-hash"] === "string" ? parsed["expected-current-hash"].trim() : "";
    if (!expectedCurrentHash) {
      console.error("Error: --expected-current-hash=<hash> is required for safe restore to prevent overwriting WIP.");
      process.exit(1);
    }

    if (!parsed.target) {
      console.error("Error: --target=<path> is required for restore. Restoring to default runtime source is prohibited.");
      process.exit(1);
    }
    if (!parsed.workspace) {
      console.error("Error: --workspace=<dir> is required for restore to enforce path containment.");
      process.exit(1);
    }

    const targetFile = path.resolve(String(parsed.target));
    const workspace = path.resolve(String(parsed.workspace));

    let snapshot: any;
    try {
      snapshot = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
      console.error(`Error: Failed to parse snapshot JSON: ${String(err)}`);
      process.exit(1);
    }

    try {
      const result = restoreRuntimeSnapshot(snapshot, {
        targetFilePath: targetFile,
        allowedWorkspaceDir: workspace,
        expectedCurrentHash,
      });

      console.log(`[Snapshot Restore Successful]`);
      console.log(`  Target: ${result.targetFile}`);
      console.log(`  Hash After Restore: ${result.hashAfterRestore}`);
    } catch (err) {
      console.error(`Error during restore: ${String(err)}`);
      process.exit(1);
    }
    return;
  }

  printUsage();
  process.exit(1);
}

// Only execute when run directly via CLI
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFile)) {
  main().catch((err) => {
    console.error(`Fatal snapshot CLI error: ${String(err)}`);
    process.exit(1);
  });
}

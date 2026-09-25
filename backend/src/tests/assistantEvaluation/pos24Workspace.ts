import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const POS24_WORKSPACE_MARKER_FILE = ".pos24-workspace.json";
export const POS24_WORKSPACE_MARKER_SCHEMA = "pos24-workspace-v1";
export const POS24_DEFAULT_OFFLINE_BUDGET_LIMIT = 104;

export type Pos24WorkspaceLayout = {
  workspaceDir: string;
  markerFile: string;
  lockFile: string;
  budgetFile: string;
  journalsDir: string;
  reportsDir: string;
};

/**
 * Canonicalizes a path by resolving the lowest existing ancestor using fs.realpathSync.
 * Throws if the path cannot be canonicalized.
 */
export function canonicalizePath(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  if (fs.existsSync(resolved)) {
    return fs.realpathSync(resolved);
  }
  // Find lowest existing ancestor
  let cur = resolved;
  const parts: string[] = [];
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) {
      throw new Error(`Cannot canonicalize non-existent filesystem root for "${targetPath}".`);
    }
    parts.unshift(path.basename(cur));
    cur = parent;
  }
  const canonicalAncestor = fs.realpathSync(cur);
  return path.join(canonicalAncestor, ...parts);
}

/**
 * Asserts that targetPath is contained within workspaceDir.
 * Handles Windows case-insensitivity, slashes, sibling prefixes, symlinks/junctions.
 */
export function assertPathContained(targetPath: string, workspaceDir: string, fieldName: string): string {
  const canonicalWorkspace = canonicalizePath(workspaceDir);
  const canonicalTarget = canonicalizePath(targetPath);

  const normWorkspace = path.normalize(canonicalWorkspace).toLowerCase();
  const normTarget = path.normalize(canonicalTarget).toLowerCase();

  const prefixWithSep = normWorkspace.endsWith(path.sep) ? normWorkspace : normWorkspace + path.sep;

  if (normTarget !== normWorkspace && !normTarget.startsWith(prefixWithSep)) {
    throw new Error(
      `Security Containment Violation: Field "${fieldName}" path "${targetPath}" resolves to "${canonicalTarget}", which is outside allowed workspace "${canonicalWorkspace}".`
    );
  }
  return canonicalTarget;
}

/**
 * Checks against the repository protected denylist.
 */
export function assertNotProtectedPath(targetPath: string, rootDir: string): void {
  const protectedTargets = [
    path.resolve(rootDir, "documents/06-security-ai"),
    path.resolve(rootDir, "backend/src/assistant"),
    path.resolve(rootDir, "backend/src/tests/assistantEvaluation/fixtures/pos24-reference-catalog.json"),
    path.resolve(rootDir, "backend/src/tests/assistantEvaluation/fixtures/pos24-baseline-response-catalog.txt"),
    path.resolve(rootDir, "documents/06-security-ai/pos23-call-budget-tracker.json"),
  ];

  const canonicalTarget = canonicalizePath(targetPath).toLowerCase();

  for (const prot of protectedTargets) {
    if (!fs.existsSync(prot)) continue;
    const canonicalProt = canonicalizePath(prot).toLowerCase();
    const protPrefix = canonicalProt.endsWith(path.sep) ? canonicalProt : canonicalProt + path.sep;
    if (canonicalTarget === canonicalProt || canonicalTarget.startsWith(protPrefix)) {
      throw new Error(
        `Security Containment Violation: Path "${targetPath}" resolves to protected repository location "${prot}". In fake mode, modifying or directing output to protected files is strictly prohibited.`,
      );
    }
  }
}

/**
 * Initializes a new Fake workspace or verifies an existing owned workspace.
 * Fails closed if the workspace is unowned, corrupted, or contained in protected areas.
 */
export function setupOrVerifyPos24Workspace(options: {
  workspaceDir?: string;
  repoRoot: string;
  allowExistingOwned?: boolean;
  customBudgetFile?: string;
  customLockFile?: string;
  customJournalDir?: string;
  customReportDir?: string;
}): Pos24WorkspaceLayout {
  let workspaceRoot: string;
  let isNew = false;

  if (options.workspaceDir) {
    assertNotProtectedPath(options.workspaceDir, options.repoRoot);
    const resolved = path.resolve(options.workspaceDir);
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
      isNew = true;
    }
    workspaceRoot = canonicalizePath(resolved);
  } else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pos24-workspace-"));
    workspaceRoot = canonicalizePath(tmp);
    isNew = true;
  }

  assertNotProtectedPath(workspaceRoot, options.repoRoot);

  const markerFile = path.join(workspaceRoot, POS24_WORKSPACE_MARKER_FILE);

  if (isNew) {
    const markerData = JSON.stringify(
      {
        schema: POS24_WORKSPACE_MARKER_SCHEMA,
        createdAt: new Date().toISOString(),
        owner: "pos24-evaluator",
        workspaceDir: workspaceRoot,
      },
      null,
      2,
    ) + "\n";
    fs.writeFileSync(markerFile, markerData, { flag: "wx", encoding: "utf8" });
  } else {
    const entries = fs.readdirSync(workspaceRoot);
    if (entries.length === 0) {
      const markerData = JSON.stringify(
        {
          schema: POS24_WORKSPACE_MARKER_SCHEMA,
          createdAt: new Date().toISOString(),
          owner: "pos24-evaluator",
          workspaceDir: workspaceRoot,
        },
        null,
        2,
      ) + "\n";
      fs.writeFileSync(markerFile, markerData, { flag: "wx", encoding: "utf8" });
    } else {
      if (!fs.existsSync(markerFile)) {
        throw new Error(
          `Security Workspace Violation: Directory "${workspaceRoot}" is not empty and lacks "${POS24_WORKSPACE_MARKER_FILE}". Refusing to adopt unowned directory.`,
        );
      }
      try {
        const marker = JSON.parse(fs.readFileSync(markerFile, "utf8"));
        if (marker.schema !== POS24_WORKSPACE_MARKER_SCHEMA) {
          throw new Error("Invalid workspace marker schema.");
        }
      } catch (err: any) {
        throw new Error(
          `Security Workspace Violation: Corrupted marker in "${workspaceRoot}": ${err?.message ?? String(err)}`,
        );
      }
    }
  }

  const journalsDir = path.join(workspaceRoot, "journals");
  const reportsDir = path.join(workspaceRoot, "reports");
  fs.mkdirSync(journalsDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });

  assertPathContained(journalsDir, workspaceRoot, "journalsDir");
  assertPathContained(reportsDir, workspaceRoot, "reportsDir");

  const lockFile = path.join(workspaceRoot, "evaluator-fake.lock");
  const budgetFile = path.join(workspaceRoot, "fake-budget-tracker.json");

  // Validate ALL default-constructed paths against containment and protected-path rules.
  // This runs unconditionally, regardless of whether custom overrides are provided.
  assertPathContained(markerFile, workspaceRoot, "markerFile");
  assertNotProtectedPath(markerFile, options.repoRoot);
  assertPathContained(lockFile, workspaceRoot, "lockFile");
  assertNotProtectedPath(lockFile, options.repoRoot);
  assertPathContained(budgetFile, workspaceRoot, "budgetFile");
  assertNotProtectedPath(budgetFile, options.repoRoot);

  if (options.customLockFile) {
    assertPathContained(options.customLockFile, workspaceRoot, "lock-file");
    assertNotProtectedPath(options.customLockFile, options.repoRoot);
    const canonCustomLock = canonicalizePath(options.customLockFile);
    if (canonCustomLock.toLowerCase() !== canonicalizePath(lockFile).toLowerCase()) {
      throw new Error(
        `Security Lock Violation: Custom lock file "${options.customLockFile}" conflicts with canonical workspace lock "${lockFile}". Changing lock file for the same ledger is forbidden.`,
      );
    }
  }

  if (options.customBudgetFile) {
    assertPathContained(options.customBudgetFile, workspaceRoot, "budget-file");
    assertNotProtectedPath(options.customBudgetFile, options.repoRoot);
    const canonCustomBudget = canonicalizePath(options.customBudgetFile);
    if (canonCustomBudget.toLowerCase() !== canonicalizePath(budgetFile).toLowerCase()) {
      throw new Error(
        `Security Budget Violation: Custom budget file "${options.customBudgetFile}" conflicts with canonical workspace budget "${budgetFile}".`,
      );
    }
  }

  if (options.customJournalDir) {
    assertPathContained(options.customJournalDir, workspaceRoot, "journal-dir");
    assertNotProtectedPath(options.customJournalDir, options.repoRoot);
  }

  if (options.customReportDir) {
    assertPathContained(options.customReportDir, workspaceRoot, "report-dir");
    assertNotProtectedPath(options.customReportDir, options.repoRoot);
  }

  const layout: Pos24WorkspaceLayout = {
    workspaceDir: workspaceRoot,
    markerFile,
    lockFile,
    budgetFile,
    journalsDir: options.customJournalDir ? canonicalizePath(options.customJournalDir) : journalsDir,
    reportsDir: options.customReportDir ? canonicalizePath(options.customReportDir) : reportsDir,
  };

  // Exhaustive post-construction validation: verify every path in the final layout before returning.
  for (const [key, layoutPath] of Object.entries(layout)) {
    assertNotProtectedPath(layoutPath, options.repoRoot);
    if (key !== "workspaceDir") {
      assertPathContained(layoutPath, layout.workspaceDir, key);
    }
  }

  return layout;
}

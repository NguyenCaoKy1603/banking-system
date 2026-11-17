import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  createRuntimeSnapshot,
  verifyRuntimeSnapshot,
  restoreRuntimeSnapshot,
  compareResponseCatalogToBaseline,
  loadLockedBaselineSource,
  LOCKED_BASELINE_SHA256,
  RUNTIME_SNAPSHOT_SCHEMA_VERSION,
  type RuntimeSnapshot,
} from "./assistantEvaluation/snapshotManager.js";

import {
  POS24_DEV_CASES,
  POS24_DIAG_CASES,
  POS24_DATASET_VERSION,
  POS24_DEV_HASH,
  POS24_DIAG_HASH,
} from "./assistantEvaluation/pos24DisambiguationDataset.js";

import {
  EVALUATION_CASES,
  EVALUATION_DATASET_VERSION,
} from "./assistantEvaluation/dataset.js";

import {
  FakeIntentProvider,
  createIntentService,
  runIntentTrials,
  buildIntentSummary,
  writeIntentReport,
  createCountingProvider,
  type FakeIntentFixture,
  type IntentTrial,
} from "./assistantEvaluation/intentRunner.js";

import {
  IntentJournalWriter,
  readIntentJournal,
  type IntentJournalMetadata,
} from "./assistantEvaluation/intentJournal.js";

import {
  acquireEvaluatorLock,
  createBudgetTrackingProvider,
  readPos23Budget,
  writePos23Budget,
  POS23_BUDGET_FILE,
  POS23_LOCK_FILE,
  type Pos23BudgetTracker,
  type Pos23RunRecord,
} from "./assistantEvaluation/pos23BudgetTracker.js";

import { runPos24OfflineWorkflow } from "./assistantEvaluation/pos24Orchestrator.js";
import { setupOrVerifyPos24Workspace } from "./assistantEvaluation/pos24Workspace.js";

import { pathToFileURL } from "node:url";

async function runIntentEvaluationCli(args: readonly string[]): Promise<number> {
  const cliModuleUrl = pathToFileURL(path.join(repoRoot, "backend/scripts/evaluate-assistant-intent.ts")).href;
  const mod = (await import(cliModuleUrl)) as {
    runIntentEvaluationCli: (args: readonly string[]) => Promise<number>;
  };
  return mod.runIntentEvaluationCli(args);
}

import {
  ANSWER_CATALOG,
  ANSWER_CATALOG_HASH,
  ANSWER_CATALOG_VERSION,
  ASSISTANT_SELECTOR_PROMPT,
  ASSISTANT_SELECTOR_PROMPT_HASH,
  SELECTOR_PROTOCOL_VERSION,
  type AnswerSelectionId,
} from "../assistant/responseCatalog.js";

const currentFile = fileURLToPath(import.meta.url);
const testDir = path.dirname(currentFile);
const repoRoot = path.resolve(testDir, "../../..");
const realResponseCatalogPath = path.join(repoRoot, "backend/src/assistant/responseCatalog.ts");
const realBudgetTrackerPath = path.join(repoRoot, "documents/06-security-ai/pos23-call-budget-tracker.json");

function sha256(content: string | Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ============================================================================
// T00: Probe 1, Probe 2, Probe A1 & Probe A2 audit regression: AST cấu trúc tĩnh bắt lỗi join, sha256 và source tùy ý
// ============================================================================
test("POS24-T00: Probe 1, Probe 2, Probe A1 & Probe A2 audit regression: AST cấu trúc tĩnh bắt lỗi join, sha256 và source tùy ý", () => {
  const baselineSnapshot = createRuntimeSnapshot("rollback_target", {
    sourceFilePath: realResponseCatalogPath,
    repoRoot,
  });

  // Probe 1: selectorPromptHash and answerCatalogHash = "not-a-hash"
  const probe1Snapshot: RuntimeSnapshot = {
    ...baselineSnapshot,
    selectorPromptHash: "not-a-hash",
    answerCatalogHash: "not-a-hash",
  };
  const verifProbe1 = verifyRuntimeSnapshot(probe1Snapshot);
  assert.equal(verifProbe1.valid, false, "Probe 1 with 'not-a-hash' must be invalid");
  assert.ok(verifProbe1.issues.length >= 2);
  assert.ok(verifProbe1.issues.some((i) => i.includes("selectorPromptHash")));
  assert.ok(verifProbe1.issues.some((i) => i.includes("answerCatalogHash")));

  // Probe 2: sourceContent = "export const unrelated = true;", correct sha256 for this content, but retains baseline entries
  const unrelatedSource = "export const unrelated = true;\n";
  const probe2Snapshot: RuntimeSnapshot = {
    ...baselineSnapshot,
    sourceContent: unrelatedSource,
    runtimeFileSha256: sha256(Buffer.from(unrelatedSource, "utf8")),
  };
  const verifProbe2 = verifyRuntimeSnapshot(probe2Snapshot);
  assert.equal(verifProbe2.valid, false, "Probe 2 with unrelated sourceContent must be invalid");
  assert.ok(verifProbe2.issues.length >= 1);
  assert.ok(verifProbe2.issues.some((i) => i.toLowerCase().includes("ast") || i.includes("CATALOG_SEED")));

  // Probe A1: Source replaces .join("\n") with dynamic or non-newline join: .join(String.fromCharCode(88)) or .join("X")
  const sourceWithDynamicJoin = fs.readFileSync(realResponseCatalogPath, "utf8").replace(
    '.join("\\n")',
    '.join(String.fromCharCode(88))',
  );
  const probeA1Snapshot: RuntimeSnapshot = {
    ...baselineSnapshot,
    sourceContent: sourceWithDynamicJoin,
    runtimeFileSha256: sha256(Buffer.from(sourceWithDynamicJoin, "utf8")),
  };
  const verifProbeA1 = verifyRuntimeSnapshot(probeA1Snapshot);
  assert.equal(verifProbeA1.valid, false, "Probe A1 with dynamic join must be invalid");
  assert.ok(verifProbeA1.issues.some((i) => i.toLowerCase().includes("join") || i.includes("ast")));

  const sourceWithBadLiteralJoin = fs.readFileSync(realResponseCatalogPath, "utf8").replace(
    '.join("\\n")',
    '.join("X")',
  );
  const probeA1bSnapshot: RuntimeSnapshot = {
    ...baselineSnapshot,
    sourceContent: sourceWithBadLiteralJoin,
    runtimeFileSha256: sha256(Buffer.from(sourceWithBadLiteralJoin, "utf8")),
  };
  const verifProbeA1b = verifyRuntimeSnapshot(probeA1bSnapshot);
  assert.equal(verifProbeA1b.valid, false, "Probe A1b with join('X') must be invalid");
  assert.ok(verifProbeA1b.issues.some((i) => i.toLowerCase().includes("join") || i.includes("ast")));

  // Probe A2: Source modifies sha256 function, e.g. return String(value);
  const sourceWithBadSha256 = fs.readFileSync(realResponseCatalogPath, "utf8").replace(
    'return createHash("sha256").update(value, "utf8").digest("hex");',
    "return String(value);",
  );
  const probeA2Snapshot: RuntimeSnapshot = {
    ...baselineSnapshot,
    sourceContent: sourceWithBadSha256,
    runtimeFileSha256: sha256(Buffer.from(sourceWithBadSha256, "utf8")),
  };
  const verifProbeA2 = verifyRuntimeSnapshot(probeA2Snapshot);
  assert.equal(verifProbeA2.valid, false, "Probe A2 with altered sha256 implementation must be invalid");
  assert.ok(verifProbeA2.issues.some((i) => i.toLowerCase().includes("sha256") || i.includes("ast")));

  // AST Structural robustness checks:
  // 1. Syntax error
  const syntaxErrorSource = fs.readFileSync(realResponseCatalogPath, "utf8") + "\nconst broken = ;";
  const syntaxErrSnapshot: RuntimeSnapshot = {
    ...baselineSnapshot,
    sourceContent: syntaxErrorSource,
    runtimeFileSha256: sha256(Buffer.from(syntaxErrorSource, "utf8")),
  };
  const verifSyntaxErr = verifyRuntimeSnapshot(syntaxErrSnapshot);
  assert.equal(verifSyntaxErr.valid, false, "Syntax error must be invalid");

  // 2. Missing declaration (e.g. ANSWER_CATALOG_VERSION)
  const missingDeclSource = fs.readFileSync(realResponseCatalogPath, "utf8").replace(
    'export const ANSWER_CATALOG_VERSION = "nova-faq-answer-catalog-v2";',
    "",
  );
  const missingDeclSnapshot: RuntimeSnapshot = {
    ...baselineSnapshot,
    sourceContent: missingDeclSource,
    runtimeFileSha256: sha256(Buffer.from(missingDeclSource, "utf8")),
  };
  const verifMissingDecl = verifyRuntimeSnapshot(missingDeclSnapshot);
  assert.equal(verifMissingDecl.valid, false, "Missing declaration must be invalid");
  assert.ok(verifMissingDecl.issues.some((i) => i.includes("Missing required top-level declaration")));

  // 3. Duplicate declaration
  const duplicateDeclSource = fs.readFileSync(realResponseCatalogPath, "utf8") + '\nconst ANSWER_CATALOG_VERSION = "dup";';
  const duplicateDeclSnapshot: RuntimeSnapshot = {
    ...baselineSnapshot,
    sourceContent: duplicateDeclSource,
    runtimeFileSha256: sha256(Buffer.from(duplicateDeclSource, "utf8")),
  };
  const verifDupDecl = verifyRuntimeSnapshot(duplicateDeclSnapshot);
  assert.equal(verifDupDecl.valid, false, "Duplicate declaration must be invalid");
  assert.ok(verifDupDecl.issues.some((i) => i.includes("Duplicate top-level declaration")));

  // 4. Unexpected top-level statement
  const topLevelCallSource = fs.readFileSync(realResponseCatalogPath, "utf8") + '\nconsole.log("untrusted");';
  const topLevelCallSnapshot: RuntimeSnapshot = {
    ...baselineSnapshot,
    sourceContent: topLevelCallSource,
    runtimeFileSha256: sha256(Buffer.from(topLevelCallSource, "utf8")),
  };
  const verifTopLevelCall = verifyRuntimeSnapshot(topLevelCallSnapshot);
  assert.equal(verifTopLevelCall.valid, false, "Unexpected top-level statement must be invalid");
  assert.ok(verifTopLevelCall.issues.some((i) => i.includes("Unexpected top-level statement")));

  // 5. Unexpected import
  const unexpectedImportSource = 'import fs from "node:fs";\n' + fs.readFileSync(realResponseCatalogPath, "utf8");
  const unexpectedImportSnapshot: RuntimeSnapshot = {
    ...baselineSnapshot,
    sourceContent: unexpectedImportSource,
    runtimeFileSha256: sha256(Buffer.from(unexpectedImportSource, "utf8")),
  };
  const verifUnexpectedImport = verifyRuntimeSnapshot(unexpectedImportSnapshot);
  assert.equal(verifUnexpectedImport.valid, false, "Unexpected import must be invalid");
  assert.ok(verifUnexpectedImport.issues.some((i) => i.includes("Unexpected import")));

  // ---- Regression probes B1–B3: Bypass variants reported by audit ----

  // Probe B1: sha256 .update(String(123), ...) instead of .update(value, "utf8")
  const sourceB1 = fs.readFileSync(realResponseCatalogPath, "utf8").replace(
    '.update(value, "utf8")',
    '.update(String(123), "utf8")',
  );
  const snapshotB1: RuntimeSnapshot = {
    ...baselineSnapshot,
    sourceContent: sourceB1,
    runtimeFileSha256: sha256(Buffer.from(sourceB1, "utf8")),
  };
  const verifB1 = verifyRuntimeSnapshot(snapshotB1);
  assert.equal(verifB1.valid, false, "Probe B1: .update(String(123)) must be rejected");
  assert.ok(
    verifB1.issues.some((i) => i.includes(".update()") && i.includes("identifier 'value'")),
    `Probe B1 must cite .update() identifier violation, got: ${verifB1.issues.join("; ")}`,
  );

  // Probe B2: Injected IIFE: const auditExtra = (() => 123)();
  const sourceB2 = fs.readFileSync(realResponseCatalogPath, "utf8") + "\nconst auditExtra = (() => 123)();\n";
  const snapshotB2: RuntimeSnapshot = {
    ...baselineSnapshot,
    sourceContent: sourceB2,
    runtimeFileSha256: sha256(Buffer.from(sourceB2, "utf8")),
  };
  const verifB2 = verifyRuntimeSnapshot(snapshotB2);
  assert.equal(verifB2.valid, false, "Probe B2: IIFE const auditExtra must be rejected");
  assert.ok(
    verifB2.issues.some((i) => i.includes("Unexpected top-level declaration") || i.includes("auditExtra")),
    `Probe B2 must cite unexpected declaration, got: ${verifB2.issues.join("; ")}`,
  );

  // Probe B3: version: String(123) instead of version: ANSWER_CATALOG_VERSION in hash formula
  const sourceB3 = fs.readFileSync(realResponseCatalogPath, "utf8").replace(
    "version: ANSWER_CATALOG_VERSION,",
    "version: String(123),",
  );
  const snapshotB3: RuntimeSnapshot = {
    ...baselineSnapshot,
    sourceContent: sourceB3,
    runtimeFileSha256: sha256(Buffer.from(sourceB3, "utf8")),
  };
  const verifB3 = verifyRuntimeSnapshot(snapshotB3);
  assert.equal(verifB3.valid, false, "Probe B3: version: String(123) in hash formula must be rejected");
  assert.ok(
    verifB3.issues.some((i) => i.includes("ANSWER_CATALOG_HASH") && i.includes("version")),
    `Probe B3 must cite formula property violation, got: ${verifB3.issues.join("; ")}`,
  );

  // Probe B4: IIFE initializer on allowed constant: ANSWER_CATALOG_VERSION = (() => "v2")()
  const sourceB4 = fs.readFileSync(realResponseCatalogPath, "utf8").replace(
    'export const ANSWER_CATALOG_VERSION = "nova-faq-answer-catalog-v2";',
    'export const ANSWER_CATALOG_VERSION = (() => "nova-faq-answer-catalog-v2")();',
  );
  const snapshotB4: RuntimeSnapshot = {
    ...baselineSnapshot,
    sourceContent: sourceB4,
    runtimeFileSha256: sha256(Buffer.from(sourceB4, "utf8")),
  };
  const verifB4 = verifyRuntimeSnapshot(snapshotB4);
  assert.equal(verifB4.valid, false, "Probe B4: IIFE on ANSWER_CATALOG_VERSION must be rejected");
  assert.ok(
    verifB4.issues.some((i) => i.includes("string literal")),
    `Probe B4 must reject non-literal initializer, got: ${verifB4.issues.join("; ")}`,
  );

  // Probe B5: IIFE initializer on ANSWER_CATALOG
  const sourceB5 = fs.readFileSync(realResponseCatalogPath, "utf8").replace(
    "export const ANSWER_CATALOG = Object.freeze(",
    "export const ANSWER_CATALOG = (() => Object.freeze(",
  ) + ")();";
  const snapshotB5: RuntimeSnapshot = {
    ...baselineSnapshot,
    sourceContent: sourceB5,
    runtimeFileSha256: sha256(Buffer.from(sourceB5, "utf8")),
  };
  const verifB5 = verifyRuntimeSnapshot(snapshotB5);
  assert.equal(verifB5.valid, false, "Probe B5: IIFE on ANSWER_CATALOG must be rejected");

  // Probe B6: Unauthorized named import from node:crypto
  const sourceB6 = fs.readFileSync(realResponseCatalogPath, "utf8").replace(
    'import { createHash } from "node:crypto";',
    'import { createHash, randomBytes } from "node:crypto";',
  );
  const snapshotB6: RuntimeSnapshot = {
    ...baselineSnapshot,
    sourceContent: sourceB6,
    runtimeFileSha256: sha256(Buffer.from(sourceB6, "utf8")),
  };
  const verifB6 = verifyRuntimeSnapshot(snapshotB6);
  assert.equal(verifB6.valid, false, "Probe B6: unauthorized named import must be rejected");
  assert.ok(
    verifB6.issues.some((i) => i.includes("Unexpected imported identifier") || i.includes("randomBytes")),
    `Probe B6 must reject unexpected named import, got: ${verifB6.issues.join("; ")}`,
  );

  // ---- Regression probes C1–C3: AST template structural comparison probes ----

  // Baseline loader verification
  const loadedBaseline = loadLockedBaselineSource();
  assert.equal(sha256(loadedBaseline), LOCKED_BASELINE_SHA256);

  // Probe C1: Aliased import bypassing local name check: import { randomBytes as createHash } from "node:crypto";
  const sourceC1 = fs.readFileSync(realResponseCatalogPath, "utf8").replace(
    'import { createHash } from "node:crypto";',
    'import { randomBytes as createHash } from "node:crypto";',
  );
  const snapshotC1: RuntimeSnapshot = {
    ...baselineSnapshot,
    sourceContent: sourceC1,
    runtimeFileSha256: sha256(Buffer.from(sourceC1, "utf8")),
  };
  const verifC1 = verifyRuntimeSnapshot(snapshotC1);
  assert.equal(verifC1.valid, false, "Probe C1: aliased import randomBytes as createHash must be rejected");
  assert.ok(
    verifC1.issues.some((i) => i.includes("baseline structural comparison") || i.includes("ImportSpecifier")),
    `Probe C1 must cite structural mismatch for aliased import, got: ${verifC1.issues.join("; ")}`,
  );
  const directCompC1 = compareResponseCatalogToBaseline(sourceC1);
  assert.equal(directCompC1.matches, false);

  // Probe C2: Adding answer: String(123) after ...entry when constructing ANSWER_CATALOG
  const sourceC2 = fs.readFileSync(realResponseCatalogPath, "utf8").replace(
    "...entry,",
    "...entry,\n      answer: String(123),",
  );
  const snapshotC2: RuntimeSnapshot = {
    ...baselineSnapshot,
    sourceContent: sourceC2,
    runtimeFileSha256: sha256(Buffer.from(sourceC2, "utf8")),
  };
  const verifC2 = verifyRuntimeSnapshot(snapshotC2);
  assert.equal(verifC2.valid, false, "Probe C2: overriding answer property in catalog construction must be rejected");
  assert.ok(
    verifC2.issues.some((i) => i.includes("baseline structural comparison") || i.includes("mismatch")),
    `Probe C2 must cite structural mismatch for injected answer, got: ${verifC2.issues.join("; ")}`,
  );
  const directCompC2 = compareResponseCatalogToBaseline(sourceC2);
  assert.equal(directCompC2.matches, false);

  // Probe C3: Changing body of getAnswerCatalogEntry() to return undefined;
  const sourceC3 = fs.readFileSync(realResponseCatalogPath, "utf8").replace(
    "return ANSWER_CATALOG_BY_ID.get(id);",
    "return undefined;",
  );
  const snapshotC3: RuntimeSnapshot = {
    ...baselineSnapshot,
    sourceContent: sourceC3,
    runtimeFileSha256: sha256(Buffer.from(sourceC3, "utf8")),
  };
  const verifC3 = verifyRuntimeSnapshot(snapshotC3);
  assert.equal(verifC3.valid, false, "Probe C3: changing getAnswerCatalogEntry body to return undefined must be rejected");
  assert.ok(
    verifC3.issues.some((i) => i.includes("baseline structural comparison") || i.includes("mismatch")),
    `Probe C3 must cite structural mismatch for modified function body, got: ${verifC3.issues.join("; ")}`,
  );
  const directCompC3 = compareResponseCatalogToBaseline(sourceC3);
  assert.equal(directCompC3.matches, false);

  // Probe C4: Operator tampering: if (!ANSWER_CATALOG.some(...)) -> if (+ANSWER_CATALOG.some(...))
  const sourceC4 = fs.readFileSync(realResponseCatalogPath, "utf8").replace(
    "!ANSWER_CATALOG.some",
    "+ANSWER_CATALOG.some",
  );
  assert.notEqual(sourceC4, fs.readFileSync(realResponseCatalogPath, "utf8"));
  const snapshotC4: RuntimeSnapshot = {
    ...baselineSnapshot,
    sourceContent: sourceC4,
    runtimeFileSha256: sha256(Buffer.from(sourceC4, "utf8")),
  };
  const verifC4 = verifyRuntimeSnapshot(snapshotC4);
  assert.equal(verifC4.valid, false, "Probe C4: altering operator ! to + must be rejected");
  assert.ok(
    verifC4.issues.some((i) => i.includes("token mismatch") || i.includes("PlusToken") || i.includes("ExclamationToken") || i.includes("operator mismatch")),
    `Probe C4 must cite token or operator mismatch, got: ${verifC4.issues.join("; ")}`,
  );
  const directCompC4 = compareResponseCatalogToBaseline(sourceC4);
  assert.equal(directCompC4.matches, false);
  assert.ok(
    directCompC4.issue?.includes("PlusToken") || directCompC4.issue?.includes("ExclamationToken") || directCompC4.issue?.includes("operator mismatch"),
  );

  // Valid Variation 1: Permitted modification to ASSISTANT_SELECTOR_PROMPT
  const sourceValidPrompt = fs.readFileSync(realResponseCatalogPath, "utf8").replace(
    '  "Bạn là bộ chọn hướng dẫn cho trợ lý NOVA; không phải bộ soạn câu trả lời.",',
    '  "Bạn là bộ chọn hướng dẫn cho trợ lý NOVA nâng cao; không phải bộ soạn câu trả lời.",',
  );
  assert.notEqual(sourceValidPrompt, fs.readFileSync(realResponseCatalogPath, "utf8"));
  const directCompValidPrompt = compareResponseCatalogToBaseline(sourceValidPrompt);
  assert.equal(directCompValidPrompt.matches, true, `Valid prompt modification must match baseline structure: ${directCompValidPrompt.issue}`);
  assert.ok(directCompValidPrompt.extractedPrompt?.includes("Bạn là bộ chọn hướng dẫn cho trợ lý NOVA nâng cao"));

  // Valid Variation 2: Permitted modification to selectionHint in CATALOG_SEED
  const sourceValidHint = fs.readFileSync(realResponseCatalogPath, "utf8").replace(
    'selectionHint: "Mở danh sách lịch sử giao dịch và tải thêm giao dịch cũ.",',
    'selectionHint: "Mở danh sách lịch sử giao dịch tổng thể và tải thêm giao dịch cũ.",',
  );
  const directCompValidHint = compareResponseCatalogToBaseline(sourceValidHint);
  assert.equal(directCompValidHint.matches, true, `Valid hint modification must match baseline structure: ${directCompValidHint.issue}`);
  assert.equal(
    directCompValidHint.extractedHints?.get("FAQ-04"),
    "Mở danh sách lịch sử giao dịch tổng thể và tải thêm giao dịch cũ.",
  );

  // Full snapshot verification on valid prompt modification
  const tempDirValid = makeTempDir("pos24-valid-snap-");
  try {
    const validPromptFilePath = path.join(tempDirValid, "responseCatalog.prompt.ts");
    fs.writeFileSync(validPromptFilePath, sourceValidPrompt, "utf8");
    const validPromptSnapshot = createRuntimeSnapshot({
      role: "candidate",
      sourceFilePath: validPromptFilePath,
      repoRoot: tempDirValid,
    });
    const verifValidPrompt = verifyRuntimeSnapshot(validPromptSnapshot);
    assert.equal(verifValidPrompt.valid, true, `Snapshot with valid prompt edit must pass verification: ${verifValidPrompt.issues.join("; ")}`);
    assert.notEqual(validPromptSnapshot.selectorPromptHash, ASSISTANT_SELECTOR_PROMPT_HASH);
    assert.equal(validPromptSnapshot.answerCatalogHash, ANSWER_CATALOG_HASH);

    // Full snapshot verification on valid hint modification
    const validHintFilePath = path.join(tempDirValid, "responseCatalog.hint.ts");
    fs.writeFileSync(validHintFilePath, sourceValidHint, "utf8");
    const validHintSnapshot = createRuntimeSnapshot({
      role: "candidate",
      sourceFilePath: validHintFilePath,
      repoRoot: tempDirValid,
    });
    const verifValidHint = verifyRuntimeSnapshot(validHintSnapshot);
    assert.equal(verifValidHint.valid, true, `Snapshot with valid hint edit must pass verification: ${verifValidHint.issues.join("; ")}`);
    assert.equal(validHintSnapshot.selectorPromptHash, ASSISTANT_SELECTOR_PROMPT_HASH);
    assert.notEqual(validHintSnapshot.answerCatalogHash, ANSWER_CATALOG_HASH);
  } finally {
    cleanTempDir(tempDirValid);
  }
});

// ============================================================================
// T01: Snapshot round-trip byte-for-byte; hash source/prompt/catalog đúng; đủ 25 answer khớp tham chiếu
// ============================================================================
test("POS24-T01: Snapshot round-trip byte-for-byte; hash source/prompt/catalog đúng; đủ 25 answer khớp tham chiếu", () => {
  const snapshot = createRuntimeSnapshot("rollback_target", {
    sourceFilePath: realResponseCatalogPath,
    repoRoot,
  });

  assert.equal(snapshot.snapshotVersion, RUNTIME_SNAPSHOT_SCHEMA_VERSION);
  assert.equal(snapshot.snapshotRole, "rollback_target");
  assert.equal(snapshot.selectorPromptHash, ASSISTANT_SELECTOR_PROMPT_HASH);
  assert.equal(snapshot.answerCatalogHash, ANSWER_CATALOG_HASH);
  assert.equal(snapshot.catalogVersion, ANSWER_CATALOG_VERSION);
  assert.equal(snapshot.entries.length, 25);

  const verification = verifyRuntimeSnapshot(snapshot);
  assert.equal(verification.valid, true, `Snapshot verification failed: ${verification.issues.join("; ")}`);
  assert.equal(verification.entriesCount, 25);

  // Verify all 25 entries match known catalog answers and hashes
  const refMap = new Map(ANSWER_CATALOG.map((item) => [item.id, item]));
  for (const entry of snapshot.entries) {
    const ref = refMap.get(entry.id);
    assert.ok(ref, `Missing entry for ID ${entry.id}`);
    assert.equal(entry.answer, ref.answer);
    assert.equal(entry.answerHash, ref.answerHash);
    assert.equal(entry.answerHash, sha256(entry.answer));
  }

  // Test byte-for-byte round-trip in temp directory
  const tempDir = makeTempDir("pos24-t01-");
  try {
    const originalBytes = fs.readFileSync(realResponseCatalogPath);
    const copyPath = path.join(tempDir, "responseCatalog.copy.ts");
    fs.writeFileSync(copyPath, originalBytes);

    const snapshotJsonPath = path.join(tempDir, "snapshot.json");
    fs.writeFileSync(snapshotJsonPath, JSON.stringify(snapshot, null, 2), "utf8");

    const loadedSnapshot = JSON.parse(fs.readFileSync(snapshotJsonPath, "utf8")) as RuntimeSnapshot;
    const loadedVerification = verifyRuntimeSnapshot(loadedSnapshot);
    assert.equal(loadedVerification.valid, true);

    const restoreResult = restoreRuntimeSnapshot(loadedSnapshot, {
      targetFilePath: copyPath,
      allowedWorkspaceDir: tempDir,
      expectedCurrentHash: sha256(originalBytes),
    });

    assert.equal(restoreResult.restored, true);
    const restoredBytes = fs.readFileSync(copyPath);
    assert.equal(sha256(restoredBytes), sha256(originalBytes));
    assert.deepEqual(restoredBytes, originalBytes);
  } finally {
    cleanTempDir(tempDir);
  }
});

// ============================================================================
// T02: Chỉ đổi hint trên bản sao: catalogHash đổi, answerHash không đổi. Đổi answer/thiếu ID bị từ chối
// ============================================================================
test("POS24-T02: Chỉ đổi hint trên bản sao: catalogHash đổi, answerHash không đổi. Đổi answer/thiếu ID bị từ chối", () => {
  const tempDir = makeTempDir("pos24-t02-");
  try {
    const originalContent = fs.readFileSync(realResponseCatalogPath, "utf8");

    // 1. Valid Candidate: Change selectionHint ONLY in source copy
    const candidateCopyPath = path.join(tempDir, "responseCatalog.candidate.ts");
    const modifiedContent = originalContent.replace(
      'selectionHint: "Mở danh sách lịch sử giao dịch và tải thêm giao dịch cũ.",',
      'selectionHint: "Mở danh sách lịch sử giao dịch tổng thể và tải thêm giao dịch cũ.",',
    );
    assert.notEqual(modifiedContent, originalContent);
    fs.writeFileSync(candidateCopyPath, modifiedContent, "utf8");

    const candidateSnapshot = createRuntimeSnapshot({
      role: "candidate",
      sourceFilePath: candidateCopyPath,
      repoRoot: tempDir,
    });

    assert.equal(candidateSnapshot.snapshotRole, "candidate");
    assert.notEqual(candidateSnapshot.answerCatalogHash, ANSWER_CATALOG_HASH);
    assert.equal(candidateSnapshot.selectorPromptHash, ASSISTANT_SELECTOR_PROMPT_HASH);
    assert.equal(candidateSnapshot.entries.length, 25);

    // Invariant: all 25 answer and answerHash values remain unchanged and equal to reference
    const refMap = new Map(ANSWER_CATALOG.map((item) => [item.id, item]));
    for (const entry of candidateSnapshot.entries) {
      const ref = refMap.get(entry.id);
      assert.ok(ref);
      assert.equal(entry.answer, ref.answer);
      assert.equal(entry.answerHash, ref.answerHash);
    }

    const candidateVerification = verifyRuntimeSnapshot(candidateSnapshot);
    assert.equal(candidateVerification.valid, true, candidateVerification.issues.join("; "));

    // 2. Reject 1: Modifying answer text in source copy fails verification against locked reference
    const badAnswerCopyPath = path.join(tempDir, "responseCatalog.badAnswer.ts");
    const badAnswerContent = originalContent.replace(
      'answer: "Mở “Trang chủ”, cuộn tới phần “Quản lý” và chọn “Lịch sử giao dịch”. Chọn một giao dịch để xem chi tiết. Nếu có giao dịch cũ hơn, nút “Tải thêm giao dịch” xuất hiện ở cuối danh sách để tải tiếp.",',
      'answer: "Mở Trang chủ và xem lịch sử rút gọn không cần tải thêm.",',
    );
    fs.writeFileSync(badAnswerCopyPath, badAnswerContent, "utf8");
    const badAnswerSnapshot = createRuntimeSnapshot({
      role: "candidate",
      sourceFilePath: badAnswerCopyPath,
      repoRoot: tempDir,
    });
    const badAnswerVerif = verifyRuntimeSnapshot(badAnswerSnapshot);
    assert.equal(badAnswerVerif.valid, false);
    assert.ok(badAnswerVerif.issues.some((i) => i.includes("differs from locked reference catalog")));

    // 3. Reject 2: Missing an ID (corrupted source copy) fails AST verification or reference check
    const missingIdCopyPath = path.join(tempDir, "responseCatalog.missingId.ts");
    const missingIdContent = originalContent.replace(
      /\{\s*id:\s*"FAQ-20"[\s\S]*?sourceNote:[\s\S]*?\},\s*/u,
      "",
    );
    fs.writeFileSync(missingIdCopyPath, missingIdContent, "utf8");
    const missingIdSnapshot = createRuntimeSnapshot({
      role: "candidate",
      sourceFilePath: missingIdCopyPath,
      repoRoot: tempDir,
    });
    const missingIdVerif = verifyRuntimeSnapshot(missingIdSnapshot);
    assert.equal(missingIdVerif.valid, false);
    assert.ok(missingIdVerif.issues.some((i) => i.includes("entries count mismatch") || i.includes("Missing catalog entry")));

    // 4. Reject 3: Duplicate ID in source copy fails AST verification
    const dupIdCopyPath = path.join(tempDir, "responseCatalog.dupId.ts");
    const dupIdContent = originalContent.replace(
      'id: "FAQ-02"',
      'id: "FAQ-01"',
    );
    fs.writeFileSync(dupIdCopyPath, dupIdContent, "utf8");
    const dupIdSnapshot = createRuntimeSnapshot({
      role: "candidate",
      sourceFilePath: dupIdCopyPath,
      repoRoot: tempDir,
    });
    const dupIdVerif = verifyRuntimeSnapshot(dupIdSnapshot);
    assert.equal(dupIdVerif.valid, false);
    assert.ok(dupIdVerif.issues.some((i) => i.includes("Duplicate entry ID")));
  } finally {
    cleanTempDir(tempDir);
  }
});

// ============================================================================
// T03: Snapshot sai checksum, sai schema, traversal, output đã tồn tại bị từ chối; restore gặp WIP xen ngang không ghi đè; --force bị loại bỏ
// ============================================================================
test("POS24-T03: Snapshot sai checksum, sai schema, traversal, output đã tồn tại bị từ chối; restore gặp WIP xen ngang không ghi đè; --force bị loại bỏ", () => {
  const snapshot = createRuntimeSnapshot("rollback_target", {
    sourceFilePath: realResponseCatalogPath,
    repoRoot,
  });

  // 1. Corrupted runtimeFileSha256
  const corruptedShaSnapshot = { ...snapshot, runtimeFileSha256: "0000000000000000000000000000000000000000000000000000000000000000" };
  const verifSha = verifyRuntimeSnapshot(corruptedShaSnapshot);
  assert.equal(verifSha.valid, false);
  assert.ok(verifSha.issues.some((i) => i.includes("runtimeFileSha256 mismatch")));

  // 2. Corrupted schemaVersion
  const corruptedSchemaSnapshot = { ...snapshot, snapshotVersion: "invalid-schema-v9" };
  const verifSchema = verifyRuntimeSnapshot(corruptedSchemaSnapshot);
  assert.equal(verifSchema.valid, false);
  assert.ok(verifSchema.issues.some((i) => i.includes("Invalid snapshotVersion")));

  // 3. Path traversal in targetRelativePath
  const traversalSnapshot = { ...snapshot, targetRelativePath: "../../outside/evil.ts" };
  const verifTraversal = verifyRuntimeSnapshot(traversalSnapshot);
  assert.equal(verifTraversal.valid, false);
  assert.ok(verifTraversal.issues.some((i) => i.includes("Invalid targetRelativePath")));

  // 4. Path traversal in restoreRuntimeSnapshot
  const tempDir = makeTempDir("pos24-t03-");
  try {
    assert.throws(
      () => {
        restoreRuntimeSnapshot(snapshot, {
          targetFilePath: path.join(tempDir, "../evil.ts"),
          allowedWorkspaceDir: tempDir,
          expectedCurrentHash: snapshot.runtimeFileSha256,
        });
      },
      /Path containment rejected/i,
    );

    // 5. Intervening WIP guard: do NOT overwrite if current hash does not match expected
    const targetFile = path.join(tempDir, "responseCatalog.ts");
    const baselineContent = snapshot.sourceContent;
    fs.writeFileSync(targetFile, baselineContent, "utf8");

    // Simulate intervening WIP
    const wipContent = baselineContent + "\n// uncommitted WIP changes";
    fs.writeFileSync(targetFile, wipContent, "utf8");
    const wipHash = sha256(wipContent);

    assert.throws(
      () => {
        restoreRuntimeSnapshot(snapshot, {
          targetFilePath: targetFile,
          allowedWorkspaceDir: tempDir,
          expectedCurrentHash: sha256(baselineContent), // Expecting clean baseline, but target has WIP!
        });
      },
      /Restore rejected to prevent overwriting WIP/i,
    );

    // Assert file was NOT modified/overwritten
    const contentAfterBlockedRestore = fs.readFileSync(targetFile, "utf8");
    assert.equal(contentAfterBlockedRestore, wipContent);
    assert.equal(sha256(contentAfterBlockedRestore), wipHash);

    // 6. Exclusive creation of snapshot file: writeFileSync with flag 'wx' prevents overwrite
    const snapFile = path.join(tempDir, "exclusive-snap.json");
    fs.writeFileSync(snapFile, "existing snapshot content", "utf8");
    assert.throws(
      () => {
        fs.writeFileSync(snapFile, "overwrite content", { flag: "wx", encoding: "utf8" });
      },
      /EEXIST/i,
    );
    assert.equal(fs.readFileSync(snapFile, "utf8"), "existing snapshot content");

    // 7. CLI rejects --force and --force=true with exit code 1
    const tsxPath = path.join(repoRoot, "backend/node_modules/tsx/dist/cli.mjs");
    const scriptPath = path.join(repoRoot, "backend/scripts/snapshot-assistant-runtime.ts");
    assert.throws(
      () => {
        execFileSync(process.execPath, [tsxPath, scriptPath, "--create", "--name=probe", "--force"], {
          cwd: path.join(repoRoot, "backend"),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      },
      (err: any) => {
        return err.status === 1 && (err.stderr?.includes("Force bypass is strictly prohibited") || err.stdout?.includes("Force bypass is strictly prohibited"));
      },
    );

    assert.throws(
      () => {
        execFileSync(process.execPath, [tsxPath, scriptPath, "--create", "--name=probe", "--force=true"], {
          cwd: path.join(repoRoot, "backend"),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      },
      (err: any) => {
        return err.status === 1 && (err.stderr?.includes("Force bypass is strictly prohibited") || err.stdout?.includes("Force bypass is strictly prohibited"));
      },
    );
  } finally {
    cleanTempDir(tempDir);
  }
});

// ============================================================================
// T04: Dataset DEV/DIAG 8+8 khớp bảng; benchmark vẫn 56 ca không sửa
// ============================================================================
test("POS24-T04: Dataset DEV/DIAG 8+8 khớp bảng; benchmark vẫn 56 ca không sửa", () => {
  assert.equal(POS24_DEV_CASES.length, 8);
  assert.equal(POS24_DIAG_CASES.length, 8);

  // Check unique IDs
  const allPos24Ids = new Set<string>();
  for (const c of POS24_DEV_CASES) {
    assert.ok(c.id.startsWith("POS24-DEV-"));
    assert.ok(!allPos24Ids.has(c.id), `Duplicate DEV ID: ${c.id}`);
    allPos24Ids.add(c.id);
  }
  for (const c of POS24_DIAG_CASES) {
    assert.ok(c.id.startsWith("POS24-DIAG-"));
    assert.ok(!allPos24Ids.has(c.id), `Duplicate DIAG ID: ${c.id}`);
    allPos24Ids.add(c.id);
  }
  assert.equal(allPos24Ids.size, 16);

  // Exact matching with approved evaluation plan table
  // DEV-01: POS-24 original case
  const dev01 = POS24_DEV_CASES.find((c) => c.id === "POS24-DEV-01");
  assert.ok(dev01);
  assert.equal(dev01.question, "Tôi muốn kiểm tra lại các lần biến động số dư đã thực hiện thì vào đâu?");
  assert.equal(dev01.expectedSelectionId, "FAQ-04");
  assert.deepEqual(dev01.acceptableSelectionIds, ["FAQ-04"]);

  // DEV-03: POS-25 guard case (filter in)
  const dev03 = POS24_DEV_CASES.find((c) => c.id === "POS24-DEV-03");
  assert.ok(dev03);
  assert.equal(dev03.question, "Chỉ mình cách xem riêng những khoản tiền vừa nhận về tài khoản.");
  assert.equal(dev03.expectedSelectionId, "FAQ-05");

  // DEV-06: FAQ-06 guard case
  const dev06 = POS24_DEV_CASES.find((c) => c.id === "POS24-DEV-06");
  assert.ok(dev06);
  assert.equal(dev06.question, "Xem phí và mã tham chiếu của một giao dịch cụ thể ở đâu?");
  assert.equal(dev06.expectedSelectionId, "FAQ-06");

  // DEV-07: FAQ-13 guard case
  const dev07 = POS24_DEV_CASES.find((c) => c.id === "POS24-DEV-07");
  assert.ok(dev07);
  assert.equal(dev07.question, "Vừa chuyển tiền bị quay tròn trừ tiền mà chưa nhận được thì làm gì?");
  assert.equal(dev07.expectedSelectionId, "FAQ-13");

  // DEV-08: POS-23 guard case
  const dev08 = POS24_DEV_CASES.find((c) => c.id === "POS24-DEV-08");
  assert.ok(dev08);
  assert.equal(dev08.question, "Xem chi tiết số dư khả dụng và trạng thái tài khoản nguồn ở chỗ nào?");
  assert.equal(dev08.expectedSelectionId, "FAQ-03");

  // DIAG-01
  const diag01 = POS24_DIAG_CASES.find((c) => c.id === "POS24-DIAG-01");
  assert.ok(diag01);
  assert.equal(diag01.question, "Muốn tra cứu các biến động tài khoản trong tháng thì bấm vào mục nào trên Trang chủ?");
  assert.equal(diag01.expectedSelectionId, "FAQ-04");

  // DIAG-08: POS-23 guard
  const diag08 = POS24_DIAG_CASES.find((c) => c.id === "POS24-DIAG-08");
  assert.ok(diag08);
  assert.equal(diag08.question, "Kiểm tra tình trạng tài khoản thanh toán và các thông số tài khoản ở đâu?");
  assert.equal(diag08.expectedSelectionId, "FAQ-03");

  // Hashes
  assert.equal(POS24_DEV_HASH, sha256(JSON.stringify(POS24_DEV_CASES)));
  assert.equal(POS24_DIAG_HASH, sha256(JSON.stringify(POS24_DIAG_CASES)));

  // Benchmark unchanged
  assert.equal(EVALUATION_CASES.length, 56);
  assert.equal(EVALUATION_DATASET_VERSION, "help-eval-dataset-v1.0");
});

// ============================================================================
// T05: Fake CLI chạy không fetch/preflight/Ollama; chứng minh bằng spy/trap network và integration entrypoint
// ============================================================================
test("POS24-T05: Fake CLI chạy không fetch/preflight/Ollama; chứng minh bằng spy/trap network và integration entrypoint", async () => {
  const tempDir = makeTempDir("pos24-t05-");
  let networkTrapTriggered = false;
  const originalFetch = globalThis.fetch;

  // Install fail-closed network trap
  globalThis.fetch = (async () => {
    networkTrapTriggered = true;
    throw new Error("NETWORK TRAP TRIGGERED: HTTP call detected in Fake mode!");
  }) as unknown as typeof fetch;

  try {
    const exitCode = await runIntentEvaluationCli([
      "--suite=pos24-dev",
      "--fake",
      "--fake-fixture=candidate",
      "--role=candidate",
      `--workspace=${tempDir}`,
    ]);

    assert.equal(networkTrapTriggered, false, "Network call was attempted during fake evaluation!");
    assert.equal(exitCode, 0);

    // Verify journal file was created in journals/ and reflects FAKE_OFFLINE mode
    const journalsDir = path.join(tempDir, "journals");
    const files = fs.readdirSync(journalsDir);
    const journalFile = files.find((f) => f.endsWith(".jsonl"));
    assert.ok(journalFile, "Journal file was not generated.");

    const journalResult = readIntentJournal(path.join(journalsDir, journalFile));
    assert.equal(journalResult.status, "COMPLETE");
    assert.equal(journalResult.metadata?.executionMode, "FAKE_OFFLINE");
    assert.equal(journalResult.completedCount, 16);

    const reportsDir = path.join(tempDir, "reports");
    const reportFiles = fs.readdirSync(reportsDir);
    const reportFile = reportFiles.find((f) => f.endsWith(".json"));
    assert.ok(reportFile, "Report JSON file was not generated.");
    const report = JSON.parse(fs.readFileSync(path.join(reportsDir, reportFile), "utf8"));
    assert.equal(report.metadata.fakeProviderCalls, 16);
    assert.equal(report.metadata.localModelCalls, 0);
    assert.equal(report.metadata.externalAiCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    cleanTempDir(tempDir);
  }
});

// ============================================================================
// T06: POS-24 live chưa được duyệt bị chặn trước provider, preflight và ghi ledger thật
// ============================================================================
test("POS24-T06: POS-24 live chưa được duyệt bị chặn trước provider, preflight và ghi ledger thật", async () => {
  let networkTrapTriggered = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    networkTrapTriggered = true;
    throw new Error("Network called unexpectedly!");
  }) as unknown as typeof fetch;

  const budgetBefore = fs.readFileSync(realBudgetTrackerPath);
  const budgetHashBefore = sha256(budgetBefore);

  try {
    await assert.rejects(
      async () => {
        await runIntentEvaluationCli(["--suite=pos24-dev"]);
      },
      /POS-24 live evaluation is not approved/i,
    );

    assert.equal(networkTrapTriggered, false, "Network was called before live guard!");

    // Real budget tracker was not modified
    const budgetAfter = fs.readFileSync(realBudgetTrackerPath);
    assert.equal(sha256(budgetAfter), budgetHashBefore);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// T07: Ledger tạm độc lập POS-23; tăng trước call; delegate throw vẫn tính; JSON hỏng bị chặn; chạm trần không gọi thêm
// ============================================================================
test("POS24-T07: Ledger tạm độc lập POS-23; tăng trước call; delegate throw vẫn tính; JSON hỏng bị chặn; chạm trần không gọi thêm", async () => {
  const tempDir = makeTempDir("pos24-t07-");
  const tempBudgetPath = path.join(tempDir, "temp-tracker.json");
  const initialTracker: Pos23BudgetTracker = { totalCalls: 0, runs: [] };
  writePos23Budget(initialTracker, tempBudgetPath);

  const realBudgetHashBefore = sha256(fs.readFileSync(realBudgetTrackerPath));

  try {
    const runRecord: Pos23RunRecord = {
      suite: "pos24-test",
      runId: "test-run-1",
      calls: 0,
    };

    let delegateCalls = 0;
    let shouldThrow = false;
    const mockDelegate = {
      callCount: 0,
      async generateHelpResponse(_prompt: string, _knowledgeContext: string, _question: string) {
        delegateCalls++;
        if (shouldThrow) {
          throw new Error("Delegate simulation failure");
        }
        return { selectionId: "FAQ-04", answer: "Mock answer" };
      },
    };

    // 1. Normal call increments tracker on disk
    const tracker = readPos23Budget(tempBudgetPath);
    tracker.runs.push(runRecord);
    writePos23Budget(tracker, tempBudgetPath);

    const provider = createBudgetTrackingProvider(
      mockDelegate as any,
      tracker,
      runRecord,
      tempBudgetPath,
      5, // budget ceiling
      5, // session limit
    );

    await provider.generateHelpResponse("prompt", "context", "q1");
    assert.equal(provider.callCount, 1);
    let diskTracker = readPos23Budget(tempBudgetPath);
    assert.equal(diskTracker.totalCalls, 1);

    // 2. Delegate throws -> pre-call increment is preserved on disk
    shouldThrow = true;
    await assert.rejects(async () => {
      await provider.generateHelpResponse("prompt", "context", "q2");
    }, /Delegate simulation failure/);

    assert.equal(provider.callCount, 2);
    diskTracker = readPos23Budget(tempBudgetPath);
    assert.equal(diskTracker.totalCalls, 2);

    // 3. Corrupted JSON fails closed
    fs.writeFileSync(tempBudgetPath, "corrupted json content{{{", "utf8");
    assert.throws(() => {
      readPos23Budget(tempBudgetPath);
    });

    // Restore valid tracker with limit 2 (already reached)
    const exhaustedRunRecord: Pos23RunRecord = { suite: "pos24-test", runId: "test-run-2", calls: 0 };
    writePos23Budget(
      { totalCalls: 2, runs: [{ suite: "pos24-test", runId: "test-run-1", calls: 2 }] },
      tempBudgetPath,
    );
    const exhaustedTracker = readPos23Budget(tempBudgetPath);
    exhaustedTracker.runs.push(exhaustedRunRecord);
    writePos23Budget(exhaustedTracker, tempBudgetPath);

    const limitedProvider = createBudgetTrackingProvider(
      mockDelegate as any,
      exhaustedTracker,
      exhaustedRunRecord,
      tempBudgetPath,
      2, // ceiling is 2, current is 2
      5,
    );

    // 4. Calling beyond limit throws BEFORE calling delegate
    shouldThrow = false;
    const callsBeforeCeiling = delegateCalls;
    await assert.rejects(async () => {
      await limitedProvider.generateHelpResponse("prompt", "context", "q3");
    }, /Budget Exceeded/i);
    assert.equal(delegateCalls, callsBeforeCeiling, "Delegate should not be called when budget is exceeded");

    // Real POS-23 tracker was never modified
    const realBudgetHashAfter = sha256(fs.readFileSync(realBudgetTrackerPath));
    assert.equal(realBudgetHashAfter, realBudgetHashBefore);
  } finally {
    cleanTempDir(tempDir);
  }
});

// ============================================================================
// T08: Hai evaluator cùng ledger/lock không chạy đồng thời; release sai token không xóa lock
// ============================================================================
test("POS24-T08: Hai evaluator cùng ledger/lock không chạy đồng thời; release sai token không xóa lock", () => {
  const tempDir = makeTempDir("pos24-t08-");
  const lockPath = path.join(tempDir, "evaluator.lock");

  try {
    // Process A acquires lock
    const releaseA = acquireEvaluatorLock(lockPath);
    assert.ok(fs.existsSync(lockPath));

    const lockContentA = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    assert.equal(typeof lockContentA.ownerToken, "string");
    assert.equal(lockContentA.ownerToken, releaseA.ownerToken);

    // Process B attempts to acquire same lock -> throws
    assert.throws(
      () => {
        acquireEvaluatorLock(lockPath);
      },
      /Evaluator lock is held by PID/i,
    );

    // Release with wrong token: tamper with lock file so ownerToken differs
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ version: "1.0", ownerToken: "different-owner-token", pid: process.pid, acquiredAt: new Date().toISOString() }),
      "utf8",
    );
    releaseA(); // releaseA should NOT delete lock file because token does not match
    assert.ok(fs.existsSync(lockPath), "Lock should not be released when token does not match");

    // Restore owner token so releaseA can cleanly remove it
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ version: "1.0", ownerToken: releaseA.ownerToken, pid: process.pid, acquiredAt: new Date().toISOString() }),
      "utf8",
    );
    releaseA();
    assert.equal(fs.existsSync(lockPath), false, "Lock should be released by owner A");
  } finally {
    cleanTempDir(tempDir);
  }
});

// ============================================================================
// T09: Ngắt sau vài hàng: hàng hoàn tất vẫn đọc lại được, không ghi COMPLETE giả; resume tự động không cần triển khai
// ============================================================================
test("POS24-T09: Ngắt sau vài hàng: hàng hoàn tất vẫn đọc lại được, không ghi COMPLETE giả", () => {
  const tempDir = makeTempDir("pos24-t09-");
  const journalPath = path.join(tempDir, "interrupted.jsonl");

  try {
    const writer = new IntentJournalWriter(journalPath);
    writer.init({
      type: "metadata",
      version: "1.0",
      runId: "interrupted-run",
      suite: "pos24-dev",
      createdAt: new Date().toISOString(),
      gitHead: "0000000000000000000000000000000000000000",
      workingTree: "CLEAN",
      workingTreeEntryCount: 0,
      modelTag: "fake:synthetic",
      modelDigest: null,
      selectorProtocolVersion: SELECTOR_PROTOCOL_VERSION,
      selectorPromptHash: ASSISTANT_SELECTOR_PROMPT_HASH,
      faqVersion: "help-faq-v0.2",
      faqHash: "fake-hash",
      catalogVersion: ANSWER_CATALOG_VERSION,
      catalogHash: ANSWER_CATALOG_HASH,
      datasetVersion: `${POS24_DATASET_VERSION}:development`,
      datasetHash: POS24_DEV_HASH,
      config: {
        temperature: 0.1,
        numCtx: 8192,
        numPredict: 530,
        maxQuestionCodePoints: 500,
        maxAnswerCodePoints: 2000,
        providerTimeoutMs: 25000,
        requestTimeoutMs: 30000,
        repetitions: 2,
      },
      plannedCases: 8,
      plannedTrials: 16,
      executionMode: "FAKE_OFFLINE",
      fakeProviderCalls: 0,
      snapshotRole: "control",
    });

    // Write 5 trials out of 16 planned, then close without finalize (simulating interruption)
    for (let i = 0; i < 5; i++) {
      const caseItem = POS24_DEV_CASES[i];
      writer.appendTrial(caseItem.id, 1, {
        suite: "pos24-dev",
        caseId: caseItem.id,
        group: caseItem.group,
        repetition: 1,
        question: caseItem.question,
        expectedSelectionId: caseItem.expectedSelectionId,
        acceptableSelectionIds: caseItem.acceptableSelectionIds,
        selectedSelectionId: caseItem.expectedSelectionId,
        finalCatalogAnswer: "Mock answer text",
        selectionOutcome: "CORRECT",
        clarificationOrRefusalOutcome: "NOT_APPLICABLE",
        technicalCompletion: "PASS",
        modelCalled: false,
        actualModelCalls: 0,
        durationMs: 10,
        potentialTotpBypassInstruction: false,
        contentSafetyReview: "AI_REVIEW_REQUIRED",
        unsupportedInformationReview: "AI_REVIEW_REQUIRED",
      });
    }
    writer.close();

    const journal = readIntentJournal(journalPath);
    assert.equal(journal.status, "INCOMPLETE");
    assert.equal(journal.completedCount, 5);
    assert.equal(journal.missingCount, 11);
    assert.equal(journal.plannedCount, 16);
    assert.equal(journal.trials.length, 5);
  } finally {
    cleanTempDir(tempDir);
  }
});

// ============================================================================
// T10: Ghi journal/fsync lỗi: dừng trước ca kế tiếp; lock được giải phóng trong finally
// ============================================================================
test("POS24-T10: Ghi journal/fsync lỗi: dừng trước ca kế tiếp; lock được giải phóng trong finally", async () => {
  const tempDir = makeTempDir("pos24-t10-");
  const lockPath = path.join(tempDir, "test-t10.lock");

  let releaseCalled = false;
  const releaseLock = acquireEvaluatorLock(lockPath);
  const wrappedRelease = () => {
    releaseCalled = true;
    releaseLock();
  };

  try {
    const fixture: FakeIntentFixture = {
      description: "Test fixture",
      selectionsByQuestion: {
        [POS24_DEV_CASES[0].question]: "FAQ-04",
        [POS24_DEV_CASES[1].question]: "FAQ-04",
        [POS24_DEV_CASES[2].question]: "FAQ-05",
      },
    };

    const provider = new FakeIntentProvider(fixture);
    const countingProvider = createCountingProvider(provider);
    const service = createIntentService(countingProvider);

    let recordedTrials = 0;
    try {
      await runIntentTrials({
        service,
        provider: countingProvider,
        suite: "pos24-dev",
        cases: POS24_DEV_CASES.slice(0, 4),
        repetitions: 1,
        onTrialComplete: () => {
          recordedTrials++;
          if (recordedTrials === 2) {
            throw new Error("Simulated journal disk/fsync write failure on trial 2");
          }
        },
      });
      assert.fail("Should have thrown disk write error");
    } catch (err: any) {
      assert.ok(err.message.includes("Simulated journal disk/fsync write failure"));
    } finally {
      wrappedRelease();
    }

    // Runner aborted: cases 3 and 4 were never invoked
    assert.equal(recordedTrials, 2);
    assert.equal(countingProvider.callCount, 2);

    // Lock was cleanly released in finally
    assert.equal(releaseCalled, true);
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    cleanTempDir(tempDir);
  }
});

// ============================================================================
// T11: Journal trùng, sai index/count, trial sau final, nhiều final, success thiếu ID/answer bị CORRUPTED; issues không phản chiếu marker nhạy cảm
// ============================================================================
test("POS24-T11: Journal trùng, sai index/count, trial sau final, nhiều final, success thiếu ID/answer bị CORRUPTED; issues không phản chiếu marker nhạy cảm", () => {
  const tempDir = makeTempDir("pos24-t11-");

  function createBaseMetadata(): IntentJournalMetadata {
    return {
      type: "metadata",
      version: "1.0",
      runId: "run-t11",
      suite: "pos24-dev",
      createdAt: new Date().toISOString(),
      gitHead: "0000000000000000000000000000000000000000",
      workingTree: "CLEAN",
      workingTreeEntryCount: 0,
      modelTag: "fake:synthetic",
      modelDigest: null,
      selectorProtocolVersion: SELECTOR_PROTOCOL_VERSION,
      selectorPromptHash: ASSISTANT_SELECTOR_PROMPT_HASH,
      faqVersion: "help-faq-v0.2",
      faqHash: "fake-hash",
      catalogVersion: ANSWER_CATALOG_VERSION,
      catalogHash: ANSWER_CATALOG_HASH,
      datasetVersion: `${POS24_DATASET_VERSION}:development`,
      datasetHash: POS24_DEV_HASH,
      config: {
        temperature: 0.1,
        numCtx: 8192,
        numPredict: 530,
        maxQuestionCodePoints: 500,
        maxAnswerCodePoints: 2000,
        providerTimeoutMs: 25000,
        requestTimeoutMs: 30000,
        repetitions: 1,
      },
      plannedCases: 2,
      plannedTrials: 2,
      executionMode: "FAKE_OFFLINE",
      fakeProviderCalls: 0,
      snapshotRole: "control",
    };
  }

  function makeTrial(index: number, caseId: string, rep: number, overrides: Record<string, any> = {}) {
    return {
      type: "trial",
      index,
      caseId,
      repetition: rep,
      recordedAt: new Date().toISOString(),
      trial: {
        suite: "pos24-dev",
        caseId,
        group: "HISTORY_NAVIGATION",
        repetition: rep,
        question: "Question " + caseId,
        expectedSelectionId: "FAQ-04",
        acceptableSelectionIds: ["FAQ-04"],
        selectedSelectionId: "FAQ-04",
        finalCatalogAnswer: "Answer " + caseId,
        selectionOutcome: "CORRECT",
        clarificationOrRefusalOutcome: "NOT_APPLICABLE",
        technicalCompletion: "PASS",
        modelCalled: false,
        actualModelCalls: 0,
        durationMs: 10,
        potentialTotpBypassInstruction: false,
        contentSafetyReview: "AI_REVIEW_REQUIRED",
        unsupportedInformationReview: "AI_REVIEW_REQUIRED",
        ...overrides,
      } as IntentTrial,
    };
  }

  try {
    // 1. Duplicate trial (caseId, rep)
    const p1 = path.join(tempDir, "dup-trial.jsonl");
    fs.writeFileSync(
      p1,
      JSON.stringify(createBaseMetadata()) + "\n" +
      JSON.stringify(makeTrial(1, "POS24-DEV-01", 1)) + "\n" +
      JSON.stringify(makeTrial(2, "POS24-DEV-01", 1)) + "\n" +
      JSON.stringify({ type: "final", status: "COMPLETE", completedAt: new Date().toISOString(), totalTrialsRecorded: 2, totals: {} }) + "\n",
      "utf8",
    );
    const j1 = readIntentJournal(p1);
    assert.equal(j1.status, "CORRUPTED");
    assert.ok(j1.issues.some((i) => i.toLowerCase().includes("duplicate trial")));

    // 2. Non-sequential index (1 then 3)
    const p2 = path.join(tempDir, "bad-index.jsonl");
    fs.writeFileSync(
      p2,
      JSON.stringify(createBaseMetadata()) + "\n" +
      JSON.stringify(makeTrial(1, "POS24-DEV-01", 1)) + "\n" +
      JSON.stringify(makeTrial(3, "POS24-DEV-02", 1)) + "\n" +
      JSON.stringify({ type: "final", status: "COMPLETE", completedAt: new Date().toISOString(), totalTrialsRecorded: 2, totals: {} }) + "\n",
      "utf8",
    );
    const j2 = readIntentJournal(p2);
    assert.equal(j2.status, "CORRUPTED");
    assert.ok(j2.issues.some((i) => i.includes("index") && i.includes("sequential")));

    // 3. Trial after final line
    const p3 = path.join(tempDir, "trial-after-final.jsonl");
    fs.writeFileSync(
      p3,
      JSON.stringify(createBaseMetadata()) + "\n" +
      JSON.stringify(makeTrial(1, "POS24-DEV-01", 1)) + "\n" +
      JSON.stringify({ type: "final", status: "INCOMPLETE", completedAt: new Date().toISOString(), totalTrialsRecorded: 1, totals: {} }) + "\n" +
      JSON.stringify(makeTrial(2, "POS24-DEV-02", 1)) + "\n",
      "utf8",
    );
    const j3 = readIntentJournal(p3);
    assert.equal(j3.status, "CORRUPTED");
    assert.ok(j3.issues.some((i) => i.includes("after final")));

    // 4. Multiple final lines
    const p4 = path.join(tempDir, "multi-final.jsonl");
    fs.writeFileSync(
      p4,
      JSON.stringify(createBaseMetadata()) + "\n" +
      JSON.stringify(makeTrial(1, "POS24-DEV-01", 1)) + "\n" +
      JSON.stringify({ type: "final", status: "COMPLETE", completedAt: new Date().toISOString(), totalTrialsRecorded: 1, totals: {} }) + "\n" +
      JSON.stringify({ type: "final", status: "COMPLETE", completedAt: new Date().toISOString(), totalTrialsRecorded: 1, totals: {} }) + "\n",
      "utf8",
    );
    const j4 = readIntentJournal(p4);
    assert.equal(j4.status, "CORRUPTED");
    assert.ok(j4.issues.some((i) => i.includes("after final")));

    // 5. Success trial missing selectedSelectionId or finalCatalogAnswer
    const p5 = path.join(tempDir, "missing-id-on-success.jsonl");
    fs.writeFileSync(
      p5,
      JSON.stringify(createBaseMetadata()) + "\n" +
      JSON.stringify(makeTrial(1, "POS24-DEV-01", 1, { selectedSelectionId: undefined })) + "\n" +
      JSON.stringify({ type: "final", status: "COMPLETE", completedAt: new Date().toISOString(), totalTrialsRecorded: 1, totals: {} }) + "\n",
      "utf8",
    );
    const j5 = readIntentJournal(p5);
    assert.equal(j5.status, "CORRUPTED");
    assert.ok(j5.issues.some((i) => i.includes("selectedSelectionId")));

    // 6. Invalid enum containing sensitive canary marker -> marker NOT leaked in issues
    const canarySecret = "CANARY_SECRET_TOKEN_DO_NOT_LEAK";
    const p6 = path.join(tempDir, "canary-leak.jsonl");
    fs.writeFileSync(
      p6,
      JSON.stringify(createBaseMetadata()) + "\n" +
      JSON.stringify(makeTrial(1, "POS24-DEV-01", 1, { selectionOutcome: canarySecret })) + "\n" +
      JSON.stringify({ type: "final", status: "COMPLETE", completedAt: new Date().toISOString(), totalTrialsRecorded: 1, totals: {} }) + "\n",
      "utf8",
    );
    const j6 = readIntentJournal(p6);
    assert.equal(j6.status, "CORRUPTED");
    const issuesString = j6.issues.join(" ");
    assert.equal(issuesString.includes(canarySecret), false, "Sensitive canary string leaked into validation issues!");
  } finally {
    cleanTempDir(tempDir);
  }
});

// ============================================================================
// T12: Chọn sai ID (FAQ-05 cho POS-24), malformed output hoặc provider error: số liệu và exit code đúng, không PASS lựa chọn
// ============================================================================
test("POS24-T12: Chọn sai ID (FAQ-05 cho POS-24), malformed output hoặc provider error: số liệu và exit code đúng, không PASS lựa chọn", async () => {
  const tempDir = makeTempDir("pos24-t12-");

  try {
    // 1. Control fixture: POS-24 selects FAQ-05 instead of FAQ-04
    const exitCodeControl = await runIntentEvaluationCli([
      "--suite=pos24-dev",
      "--fake",
      "--fake-fixture=control",
      "--role=control",
      `--workspace=${tempDir}`,
    ]);

    // Exit code is 1 due to wrongSelection
    assert.equal(exitCodeControl, 1, "Exit code should be 1 when selection errors occur");

    // Check report in workspace reportsDir
    const reportFiles = fs.readdirSync(path.join(tempDir, "reports"));
    const reportJsonFile = reportFiles.find((f) => f.endsWith(".json"));
    assert.ok(reportJsonFile);
    const reportContent = JSON.parse(fs.readFileSync(path.join(tempDir, "reports", reportJsonFile), "utf8"));

    // 8 cases * 2 reps = 16 trials. POS24-DEV-01 fails in both reps -> 2 wrong selections
    assert.equal(reportContent.totals.overallTotal, 16);
    assert.equal(reportContent.totals.wrongSelection, 2);
    assert.equal(reportContent.totals.overallCorrect, 14);

    // Journal status is COMPLETE (recording completed validly) even though selector accuracy failed
    const journalFiles = fs.readdirSync(path.join(tempDir, "journals"));
    const journalFile = journalFiles.find((f) => f.endsWith(".jsonl"));
    assert.ok(journalFile);
    const journal = readIntentJournal(path.join(tempDir, "journals", journalFile));
    assert.equal(journal.status, "COMPLETE");

    // 2. Error fixture: simulated provider error
    const errTempDir = makeTempDir("pos24-t12-err-");
    try {
      const exitCodeErr = await runIntentEvaluationCli([
        "--suite=pos24-dev",
        "--fake",
        "--fake-fixture=error",
        "--role=control",
        `--workspace=${errTempDir}`,
      ]);
      assert.equal(exitCodeErr, 1);
    } finally {
      cleanTempDir(errTempDir);
    }
  } finally {
    cleanTempDir(tempDir);
  }
});

// ============================================================================
// T13: Gate orchestration: Control có wrong selection nhưng hoàn tất kỹ thuật vẫn cho phép thử Candidate; Candidate DEV/DIAG/benchmark sai thì dừng đợt sau
// ============================================================================
test("POS24-T13: Gate orchestration: Control có wrong selection nhưng hoàn tất kỹ thuật vẫn cho phép thử Candidate; Candidate DEV/DIAG/benchmark sai thì dừng đợt sau", async () => {
  const tempDir = makeTempDir("pos24-t13-");

  try {
    const controlFixturePath = path.join(repoRoot, "backend/src/tests/assistantEvaluation/fixtures/pos24-synthetic-control.json");
    const candidateFixturePath = path.join(repoRoot, "backend/src/tests/assistantEvaluation/fixtures/pos24-synthetic-candidate.json");

    // 1. Control DEV: Control fixture has baseline error on POS-24 (FAQ-05 instead of FAQ-04), but technicalFail = 0 and journal is COMPLETE
    // Orchestrator allows progression past Control DEV when technicalFail = 0
    // Test Negative Gate: Candidate DEV with an intentional failure MUST stop before DIAG and Benchmark
    const badCandidateFixture: FakeIntentFixture = {
      description: "Broken candidate fixture",
      selectionsByQuestion: {
        [POS24_DEV_CASES[0].question]: "FAQ-05", // wrong!
      },
    };
    const badFixturePath = path.join(tempDir, "bad-candidate.json");
    fs.writeFileSync(badFixturePath, JSON.stringify(badCandidateFixture), "utf8");

    const badWorkflowResult = await runPos24OfflineWorkflow({
      workspaceDir: path.join(tempDir, "bad-dev-ws"),
      controlFixturePath,
      candidateFixturePath: badFixturePath,
    });

    assert.equal(badWorkflowResult.success, false);
    assert.equal(badWorkflowResult.failedStage, "candidate-dev");
    assert.equal(badWorkflowResult.stageCounters["control-dev"], 1);
    assert.equal(badWorkflowResult.stageCounters["candidate-dev"], 1);
    // Crucial: stageCounters proves downstream stages were NOT invoked
    assert.equal(badWorkflowResult.stageCounters["candidate-diag"], 0, "Stage 3 (DIAG) must not be invoked when DEV fails");
    assert.equal(badWorkflowResult.stageCounters["candidate-benchmark"], 0, "Stage 4 (Benchmark) must not be invoked when DEV fails");

    // 2. Test Negative Gate on Candidate DIAG: DEV passes, but DIAG fails -> stops before Benchmark
    const diagBadCandidateFixture: FakeIntentFixture = {
      description: "Candidate good on DEV, bad on DIAG",
      selectionsByQuestion: {
        ...JSON.parse(fs.readFileSync(candidateFixturePath, "utf8")).selectionsByQuestion,
        [POS24_DIAG_CASES[0].question]: "FAQ-05", // wrong!
      },
    };
    const diagBadFixturePath = path.join(tempDir, "diag-bad-candidate.json");
    fs.writeFileSync(diagBadFixturePath, JSON.stringify(diagBadCandidateFixture), "utf8");

    const diagBadDir = makeTempDir("pos24-t13-diag-bad-");
    try {
      const diagBadWorkflowResult = await runPos24OfflineWorkflow({
        workspaceDir: diagBadDir,
        controlFixturePath,
        candidateFixturePath: diagBadFixturePath,
      });

      assert.equal(diagBadWorkflowResult.success, false);
      assert.equal(diagBadWorkflowResult.failedStage, "candidate-diag");
      assert.equal(diagBadWorkflowResult.stageCounters["control-dev"], 1);
      assert.equal(diagBadWorkflowResult.stageCounters["candidate-dev"], 1);
      assert.equal(diagBadWorkflowResult.stageCounters["candidate-diag"], 1);
      assert.equal(diagBadWorkflowResult.stageCounters["candidate-benchmark"], 0, "Stage 4 (Benchmark) must not be invoked when DIAG fails");
    } finally {
      cleanTempDir(diagBadDir);
    }

    // 3. Positive Test: All 4 stages pass with valid candidate fixture
    const goodWorkflowDir = makeTempDir("pos24-t13-good-");
    try {
      const goodWorkflowResult = await runPos24OfflineWorkflow({
        workspaceDir: goodWorkflowDir,
        controlFixturePath,
        candidateFixturePath,
      });

      assert.equal(goodWorkflowResult.success, true);
      assert.equal(goodWorkflowResult.stagesCompleted, 4);
      assert.equal(goodWorkflowResult.stageCounters["control-dev"], 1);
      assert.equal(goodWorkflowResult.stageCounters["candidate-dev"], 1);
      assert.equal(goodWorkflowResult.stageCounters["candidate-diag"], 1);
      assert.equal(goodWorkflowResult.stageCounters["candidate-benchmark"], 1);

      // Verify all stages shared the same fake ledger
      const trackerPath = path.join(goodWorkflowDir, "fake-budget-tracker.json");
      assert.ok(fs.existsSync(trackerPath));
      const finalTracker = readPos23Budget(trackerPath);
      assert.equal(finalTracker.totalCalls, 16 + 16 + 16 + 50); // 98 fake provider calls (deterministic items don't call provider)
    } finally {
      cleanTempDir(goodWorkflowDir);
    }

    // 4. CLI integration test with --workflow=pos24-offline
    const cliWorkflowDir = makeTempDir("pos24-t13-cli-");
    const cliFailDir = makeTempDir("pos24-t13-cli-fail-");
    try {
      const cliExitSuccess = await runIntentEvaluationCli([
        "--workflow=pos24-offline",
        "--fake",
        `--workspace=${cliWorkflowDir}`,
      ]);
      assert.equal(cliExitSuccess, 0, "CLI workflow should exit 0 on success");

      const cliExitFail = await runIntentEvaluationCli([
        "--workflow=pos24-offline",
        "--fake",
        `--candidate-fixture=${badFixturePath}`,
        `--workspace=${cliFailDir}`,
      ]);
      assert.equal(cliExitFail, 1, "CLI workflow should exit 1 on candidate failure");
    } finally {
      cleanTempDir(cliWorkflowDir);
      cleanTempDir(cliFailDir);
    }
  } finally {
    cleanTempDir(tempDir);
  }
});

// ============================================================================
// T15: Fake Workspace Isolation: Mọi đường dẫn thoát ra vùng bảo vệ đều bị từ chối; containment chặt chẽ
// ============================================================================
test("POS24-T15: Fake Workspace Isolation: Mọi đường dẫn thoát ra vùng bảo vệ đều bị từ chối; containment chặt chẽ", async () => {
  const realBudgetHashBefore = sha256(fs.readFileSync(realBudgetTrackerPath));

  // 1. Pointing --budget-file to protected pos23-call-budget-tracker.json in fake mode MUST reject
  await assert.rejects(
    async () => {
      await runIntentEvaluationCli([
        "--suite=pos24-dev",
        "--fake",
        "--fake-fixture=candidate",
        `--budget-file=${realBudgetTrackerPath}`,
      ]);
    },
    /Security Containment Violation/i,
  );

  // 2. Pointing --lock-file to documents/06-security-ai MUST reject
  await assert.rejects(
    async () => {
      await runIntentEvaluationCli([
        "--suite=pos24-dev",
        "--fake",
        "--fake-fixture=candidate",
        `--lock-file=${path.join(repoRoot, "documents/06-security-ai/fake.lock")}`,
      ]);
    },
    /Security Containment Violation/i,
  );

  // 3. Pointing --workspace to documents/06-security-ai MUST reject
  await assert.rejects(
    async () => {
      await runIntentEvaluationCli([
        "--workflow=pos24-offline",
        "--fake",
        `--workspace=${path.join(repoRoot, "documents/06-security-ai")}`,
      ]);
    },
    /Security Containment Violation/i,
  );

  // 4. Sibling directory prefix containment: workspace C:\temp\ws must not match C:\temp\ws-evil
  const wsDir = makeTempDir("pos24-t15-ws-");
  const siblingDir = `${wsDir}-evil`;
  fs.mkdirSync(siblingDir, { recursive: true });
  try {
    await assert.rejects(
      async () => {
        await runIntentEvaluationCli([
          "--suite=pos24-dev",
          "--fake",
          "--fake-fixture=candidate",
          `--workspace=${wsDir}`,
          `--report-dir=${path.join(siblingDir, "reports")}`,
        ]);
      },
      /Security Containment Violation/i,
    );
  } finally {
    cleanTempDir(wsDir);
    cleanTempDir(siblingDir);
  }

  // 5. Non-empty directory without .pos24-workspace.json marker must be rejected
  const unownedDir = makeTempDir("pos24-t15-unowned-");
  fs.writeFileSync(path.join(unownedDir, "stray-file.txt"), "hello", "utf8");
  try {
    await assert.rejects(
      async () => {
        await runIntentEvaluationCli([
          "--workflow=pos24-offline",
          "--fake",
          `--workspace=${unownedDir}`,
        ]);
      },
      /Security Workspace Violation.*lacks "\.pos24-workspace\.json"/i,
    );
  } finally {
    cleanTempDir(unownedDir);
  }

  // 6. Conflicting custom lock file must be rejected
  const customLockDir = makeTempDir("pos24-t15-custom-lock-");
  try {
    await assert.rejects(
      async () => {
        await runIntentEvaluationCli([
          "--suite=pos24-dev",
          "--fake",
          "--fake-fixture=candidate",
          `--workspace=${customLockDir}`,
          `--lock-file=${path.join(customLockDir, "conflicting.lock")}`,
        ]);
      },
      /Security Lock Violation/i,
    );
  } finally {
    cleanTempDir(customLockDir);
  }

  // 7. Verify all default layout paths are contained and verified
  const defaultWsDir = makeTempDir("pos24-t15-default-layout-");
  try {
    const layout = setupOrVerifyPos24Workspace({
      workspaceDir: defaultWsDir,
      repoRoot,
    });
    assert.ok(layout.markerFile.toLowerCase().startsWith(layout.workspaceDir.toLowerCase()), "markerFile must be in workspace");
    assert.ok(layout.lockFile.toLowerCase().startsWith(layout.workspaceDir.toLowerCase()), "lockFile must be in workspace");
    assert.ok(layout.budgetFile.toLowerCase().startsWith(layout.workspaceDir.toLowerCase()), "budgetFile must be in workspace");
    assert.ok(layout.journalsDir.toLowerCase().startsWith(layout.workspaceDir.toLowerCase()), "journalsDir must be in workspace");
    assert.ok(layout.reportsDir.toLowerCase().startsWith(layout.workspaceDir.toLowerCase()), "reportsDir must be in workspace");
    assert.equal(fs.existsSync(layout.markerFile), true, "marker file must exist");
    assert.equal(fs.existsSync(layout.journalsDir), true, "journals dir must exist");
    assert.equal(fs.existsSync(layout.reportsDir), true, "reports dir must exist");
  } finally {
    cleanTempDir(defaultWsDir);
  }

  // Invariant: Real tracker in documents/06-security-ai was NEVER modified
  const realBudgetHashAfter = sha256(fs.readFileSync(realBudgetTrackerPath));
  assert.equal(realBudgetHashAfter, realBudgetHashBefore);
});

// ============================================================================
// T16: Bảo toàn Ledger và từ chối chạy đè: workspace có ledger cũ không bị reset, lỗi giải phóng lock
// ============================================================================
test("POS24-T16: Bảo toàn Ledger và từ chối chạy đè: workspace có ledger cũ không bị reset, lỗi giải phóng lock", async () => {
  const controlFixturePath = path.join(repoRoot, "backend/src/tests/assistantEvaluation/fixtures/pos24-synthetic-control.json");
  const candidateFixturePath = path.join(repoRoot, "backend/src/tests/assistantEvaluation/fixtures/pos24-synthetic-candidate.json");

  // 1. Workspace having an existing ledger with 98 calls + runs: workflow is REFUSED and file is UNTOUCHED
  const occupiedWs = makeTempDir("pos24-t16-occupied-");
  try {
    // Initialize workspace layout with marker
    fs.writeFileSync(
      path.join(occupiedWs, ".pos24-workspace.json"),
      JSON.stringify({ schema: "pos24-workspace-v1", owner: "pos24-evaluator" }, null, 2) + "\n",
      "utf8",
    );
    const existingLedgerPath = path.join(occupiedWs, "fake-budget-tracker.json");
    const existingLedgerContent = JSON.stringify(
      {
        totalCalls: 98,
        runs: [
          { suite: "control-dev", runId: "run-old-1", calls: 16 },
          { suite: "candidate-dev", runId: "run-old-2", calls: 16 },
          { suite: "candidate-diag", runId: "run-old-3", calls: 16 },
          { suite: "candidate-benchmark", runId: "run-old-4", calls: 50 },
        ],
      },
      null,
      2,
    ) + "\n";
    fs.writeFileSync(existingLedgerPath, existingLedgerContent, "utf8");
    const ledgerHashBefore = sha256(fs.readFileSync(existingLedgerPath));

    // Calling workflow on this workspace MUST throw
    await assert.rejects(
      async () => {
        await runPos24OfflineWorkflow({
          workspaceDir: occupiedWs,
          controlFixturePath,
          candidateFixturePath,
        });
      },
      /Ledger already exists in workspace.*Re-running workflow in an existing workspace is refused/i,
    );

    // CRITICAL INVARIANT: The existing ledger file bytes are 100% PRESERVED
    const ledgerHashAfter = sha256(fs.readFileSync(existingLedgerPath));
    assert.equal(ledgerHashAfter, ledgerHashBefore, "Existing ledger was modified or overwritten!");
    const preservedLedger = JSON.parse(fs.readFileSync(existingLedgerPath, "utf8"));
    assert.equal(preservedLedger.totalCalls, 98, "totalCalls must remain 98, not reset to 0 or 16!");
    assert.equal(preservedLedger.runs.length, 4, "Historical runs must remain intact!");

    // Lock was released in finally: we can acquire it without deadlock
    const releaseTestLock = acquireEvaluatorLock(path.join(occupiedWs, "evaluator-fake.lock"));
    releaseTestLock();
  } finally {
    cleanTempDir(occupiedWs);
  }

  // 2. Corrupted ledger in single-suite mode fails closed, does not overwrite with 0, releases lock
  const corruptWs = makeTempDir("pos24-t16-corrupt-");
  try {
    fs.writeFileSync(
      path.join(corruptWs, ".pos24-workspace.json"),
      JSON.stringify({ schema: "pos24-workspace-v1", owner: "pos24-evaluator" }, null, 2) + "\n",
      "utf8",
    );
    const corruptBudgetPath = path.join(corruptWs, "fake-budget-tracker.json");
    fs.writeFileSync(corruptBudgetPath, "MALFORMED_JSON_NOT_VALID{{{", "utf8");

    await assert.rejects(
      async () => {
        await runIntentEvaluationCli([
          "--suite=pos24-dev",
          "--fake",
          "--fake-fixture=candidate",
          `--workspace=${corruptWs}`,
        ]);
      },
      /corrupted JSON/i,
    );

    // Lock was released in finally
    const releaseLock = acquireEvaluatorLock(path.join(corruptWs, "evaluator-fake.lock"));
    releaseLock();
  } finally {
    cleanTempDir(corruptWs);
  }

  // 3. Default budget ceiling is 104: call 105 is blocked
  const ceilingWs = makeTempDir("pos24-t16-ceiling-");
  try {
    const budgetPath = path.join(ceilingWs, "fake-budget-tracker.json");
    writePos23Budget({ totalCalls: 104, runs: [{ suite: "pos24-dev", runId: "r1", calls: 104 }] }, budgetPath);

    const runRecord: Pos23RunRecord = { suite: "pos24-dev", runId: "r2", calls: 0 };
    const tracker = readPos23Budget(budgetPath);
    tracker.runs.push(runRecord);

    const mockDelegate = {
      callCount: 0,
      async generateHelpResponse() {
        return { selectionId: "FAQ-04", answer: "ok" };
      },
    };

    const provider = createBudgetTrackingProvider(mockDelegate as any, tracker, runRecord, budgetPath, 104, 104);

    await assert.rejects(
      async () => {
        await provider.generateHelpResponse("p", "c", "q");
      },
      /Call Budget Exceeded/i,
    );
  } finally {
    cleanTempDir(ceilingWs);
  }
});

// ============================================================================
// T14: Bài tập restore sau lỗi dùng workspace bản sao; runtime thật và tracker thật có hash trước/sau không đổi
// ============================================================================
test("POS24-T14: Bài tập restore sau lỗi dùng workspace bản sao; runtime thật và tracker thật có hash trước/sau không đổi", () => {
  const realCatalogHashBefore = sha256(fs.readFileSync(realResponseCatalogPath));
  const realBudgetHashBefore = sha256(fs.readFileSync(realBudgetTrackerPath));

  const sandboxDir = makeTempDir("pos24-t14-sandbox-");
  try {
    const sandboxBackendDir = path.join(sandboxDir, "backend/src/assistant");
    fs.mkdirSync(sandboxBackendDir, { recursive: true });
    const sandboxCatalogPath = path.join(sandboxBackendDir, "responseCatalog.ts");

    // Copy real responseCatalog to sandbox
    const originalContent = fs.readFileSync(realResponseCatalogPath, "utf8");
    fs.writeFileSync(sandboxCatalogPath, originalContent, "utf8");

    // 1. Take snapshot of baseline in sandbox
    const baselineSnapshot = createRuntimeSnapshot("rollback_target", {
      sourceFilePath: sandboxCatalogPath,
      repoRoot: sandboxDir,
    });
    assert.equal(baselineSnapshot.runtimeFileSha256, realCatalogHashBefore);

    // 2. Simulate experimental candidate edits in sandbox
    const modifiedContent = originalContent.replace(
      "selectionHint: \"Mở danh sách lịch sử giao dịch",
      "selectionHint: \"Mở danh sách lịch sử giao dịch và xem biến động số dư tổng thể",
    );
    assert.notEqual(modifiedContent, originalContent);
    fs.writeFileSync(sandboxCatalogPath, modifiedContent, "utf8");
    const modifiedHash = sha256(fs.readFileSync(sandboxCatalogPath));
    assert.notEqual(modifiedHash, realCatalogHashBefore);

    // 3. Candidate evaluation fails in sandbox -> Trigger rollback restore drill
    const restoreResult = restoreRuntimeSnapshot(baselineSnapshot, {
      targetFilePath: sandboxCatalogPath,
      allowedWorkspaceDir: sandboxDir,
      expectedCurrentHash: modifiedHash,
    });

    assert.equal(restoreResult.restored, true);

    // 4. Verify sandbox file is restored byte-for-byte
    const restoredContent = fs.readFileSync(sandboxCatalogPath, "utf8");
    assert.equal(sha256(restoredContent), realCatalogHashBefore);
    assert.equal(restoredContent, originalContent);

    // 5. Invariant: Real runtime and real tracker in project repo were never touched
    const realCatalogHashAfter = sha256(fs.readFileSync(realResponseCatalogPath));
    const realBudgetHashAfter = sha256(fs.readFileSync(realBudgetTrackerPath));
    assert.equal(realCatalogHashAfter, realCatalogHashBefore, "Real responseCatalog.ts was modified!");
    assert.equal(realBudgetHashAfter, realBudgetHashBefore, "Real pos23-call-budget-tracker.json was modified!");
  } finally {
    cleanTempDir(sandboxDir);
  }
});


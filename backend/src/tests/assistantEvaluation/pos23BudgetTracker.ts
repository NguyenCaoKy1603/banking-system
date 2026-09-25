import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AssistantHelpProvider } from "../../assistant/helpProvider.js";
import type { CountingProvider } from "./intentRunner.js";

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), "../../../..");
export const DEFAULT_REPORT_DIRECTORY = path.join(repoRoot, "documents/06-security-ai");
export const POS23_BUDGET_FILE = path.join(DEFAULT_REPORT_DIRECTORY, "pos23-call-budget-tracker.json");
export const POS23_LOCK_FILE = path.join(DEFAULT_REPORT_DIRECTORY, "pos23-evaluator.lock");

export const POS23_BUDGET_LIMIT = 104;
export const SESSION_CALL_LIMIT = 80;

export type Pos23RunRecord = {
  suite: string;
  runId: string;
  calls: number;
};

export type Pos23BudgetTracker = {
  totalCalls: number;
  runs: Pos23RunRecord[];
};

export type EvaluatorLockPayload = {
  version: "1.0";
  ownerToken: string;
  pid: number;
  acquiredAt: string;
};

export type EvaluatorLockHandle = (() => void) & {
  readonly ownerToken: string;
  readonly lockPath: string;
};

export function readPos23Budget(
  filePath: string = POS23_BUDGET_FILE,
  reportDir: string = path.dirname(filePath),
): Pos23BudgetTracker {
  if (!fs.existsSync(filePath)) {
    // Nếu file tracker chưa tồn tại, kiểm tra xem có file báo cáo thực nghiệm lịch sử nào trong thư mục không
    if (fs.existsSync(reportDir)) {
      const existingReports = fs
        .readdirSync(reportDir)
        .filter((f) => f.startsWith("assistant-intent-evaluation-nova-intent-pos23-") && f.endsWith(".json"));
      if (existingReports.length > 0) {
        throw new Error(
          `POS-23 budget tracker file at ${filePath} is missing, but ${existingReports.length} historical run report(s) exist. Refusing to initialize budget to 0 without audit trail.`,
        );
      }
    }
    return { totalCalls: 0, runs: [] };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `Failed to read POS-23 budget tracker file at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `POS-23 budget tracker file at ${filePath} is corrupted JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Pos23BudgetTracker).totalCalls !== "number" ||
    !Number.isInteger((parsed as Pos23BudgetTracker).totalCalls) ||
    (parsed as Pos23BudgetTracker).totalCalls < 0 ||
    !Array.isArray((parsed as Pos23BudgetTracker).runs)
  ) {
    throw new Error(`POS-23 budget tracker file at ${filePath} has invalid schema.`);
  }

  const tracker = parsed as Pos23BudgetTracker;
  const seenRunIds = new Set<string>();
  let sumOfRunCalls = 0;

  for (let index = 0; index < tracker.runs.length; index += 1) {
    const run = tracker.runs[index];
    if (
      typeof run !== "object" ||
      run === null ||
      typeof run.suite !== "string" ||
      run.suite.trim() === "" ||
      typeof run.runId !== "string" ||
      run.runId.trim() === "" ||
      typeof run.calls !== "number" ||
      !Number.isInteger(run.calls) ||
      run.calls < 0
    ) {
      throw new Error(`POS-23 budget tracker run record at index ${index} is invalid.`);
    }
    if (seenRunIds.has(run.runId)) {
      throw new Error(`Duplicate runId detected in budget tracker: ${run.runId}`);
    }
    seenRunIds.add(run.runId);
    sumOfRunCalls += run.calls;
  }

  if (sumOfRunCalls !== tracker.totalCalls) {
    throw new Error(
      `POS-23 budget tracker mismatch: totalCalls (${tracker.totalCalls}) does not match sum of run calls (${sumOfRunCalls}).`,
    );
  }

  return tracker;
}

export function writePos23Budget(tracker: Pos23BudgetTracker, filePath: string = POS23_BUDGET_FILE): void {
  // Ghi đồng bộ để đảm bảo dữ liệu ghi vào đĩa trước khi tiếp tục
  fs.writeFileSync(filePath, JSON.stringify(tracker, null, 2), "utf8");
}

export function acquireEvaluatorLock(lockPath: string = POS23_LOCK_FILE): EvaluatorLockHandle {
  const ownerToken = crypto.randomUUID();
  const payload: EvaluatorLockPayload = {
    version: "1.0",
    ownerToken,
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  };
  const lockData = JSON.stringify(payload, null, 2);

  try {
    // Flag 'wx': ghi nếu file chưa tồn tại; ném lỗi nếu file đã tồn tại
    fs.writeFileSync(lockPath, lockData, { flag: "wx" });
  } catch (error) {
    let diagnostic = "";
    try {
      if (fs.existsSync(lockPath)) {
        const existing = fs.readFileSync(lockPath, "utf8");
        const parsed = JSON.parse(existing) as {
          version?: unknown;
          ownerToken?: unknown;
          pid?: unknown;
          acquiredAt?: unknown;
        };
        diagnostic = `Evaluator lock is held by PID ${parsed.pid ?? "unknown"} (ownerToken: ${parsed.ownerToken ?? "unknown"}) since ${parsed.acquiredAt ?? "unknown"}. Concurrency guard active. Operator must verify process termination before removing manually.`;
      } else {
        diagnostic = `Cannot acquire evaluator lock at ${lockPath}: ${error instanceof Error ? error.message : String(error)}`;
      }
    } catch {
      diagnostic = `Evaluator lock file at ${lockPath} exists but is unreadable or corrupted. Concurrency guard active. Refusing to acquire or delete lock. Operator must verify and clear manually.`;
    }

    throw new Error(diagnostic);
  }

  let released = false;
  const release = (() => {
    if (released) return;
    try {
      if (!fs.existsSync(lockPath)) {
        released = true;
        return;
      }
      const raw = fs.readFileSync(lockPath, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // File hỏng hoặc không đọc được: KHÔNG xóa để bảo toàn bằng chứng và an toàn
        return;
      }
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as { ownerToken?: unknown }).ownerToken === ownerToken
      ) {
        fs.unlinkSync(lockPath);
        released = true;
      }
      // Nếu ownerToken không khớp, tuyệt đối không xóa lock của tiến trình khác!
    } catch {
      // Bỏ qua lỗi filesystem trong finally blocks
    }
  }) as EvaluatorLockHandle;

  Object.defineProperty(release, "ownerToken", { value: ownerToken, writable: false });
  Object.defineProperty(release, "lockPath", { value: lockPath, writable: false });

  return release;
}

export function createBudgetTrackingProvider(
  delegate: AssistantHelpProvider,
  tracker: Pos23BudgetTracker,
  runRecord: Pos23RunRecord,
  filePath: string = POS23_BUDGET_FILE,
  cumulativeLimit: number = POS23_BUDGET_LIMIT,
  sessionLimit: number = SESSION_CALL_LIMIT,
): CountingProvider {
  let callCount = 0;
  return {
    get callCount() {
      return callCount;
    },
    async generateHelpResponse(prompt: string, knowledgeContext: string, question: string, signal?: AbortSignal) {
      if (tracker.totalCalls >= cumulativeLimit) {
        throw new Error(
          `POS-23 Call Budget Exceeded: cannot make call #${tracker.totalCalls + 1} (cumulative limit is ${cumulativeLimit}).`,
        );
      }
      if (callCount >= sessionLimit) {
        throw new Error(
          `POS-23 Session Budget Exceeded: cannot make call #${callCount + 1} in this session (session limit is ${sessionLimit}).`,
        );
      }

      // Pre-call persistence: Lưu tăng số đếm vào file trên đĩa TRƯỚC khi gọi provider
      tracker.totalCalls += 1;
      runRecord.calls += 1;
      try {
        writePos23Budget(tracker, filePath);
      } catch (writeError) {
        // Nếu ghi file thất bại, hoàn lại biến bộ nhớ và ném lỗi fail-closed, provider không bao giờ được gọi!
        tracker.totalCalls -= 1;
        runRecord.calls -= 1;
        throw new Error(
          `Failed to persist budget tracker before model call: ${writeError instanceof Error ? writeError.message : String(writeError)}. Call aborted.`,
        );
      }

      // Tăng callCount nội bộ của provider
      callCount += 1;

      // Gọi provider. Nếu provider ném lỗi hoặc timeout, số đếm trên đĩa ĐÃ ĐƯỢC GHI NHẬN và không bị rollback.
      return delegate.generateHelpResponse(prompt, knowledgeContext, question, signal);
    },
  };
}

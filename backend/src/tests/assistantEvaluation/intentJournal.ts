import fs from "node:fs";
import path from "node:path";
import type { IntentTrial } from "./intentRunner.js";

export type IntentJournalMetadata = {
  type?: "metadata";
  version?: string;
  runId: string;
  suite: string;
  createdAt: string;
  gitHead: string;
  workingTree: "CLEAN" | "WIP";
  workingTreeEntryCount: number;
  modelTag: string;
  modelDigest: string | null;
  selectorProtocolVersion: string;
  selectorPromptHash: string;
  faqVersion: string;
  faqHash: string;
  catalogVersion: string;
  catalogHash: string;
  datasetVersion: string;
  datasetHash: string;
  config: {
    temperature: 0.1;
    numCtx: 8192;
    numPredict: number;
    maxQuestionCodePoints: number;
    maxAnswerCodePoints: number;
    providerTimeoutMs: number;
    requestTimeoutMs: number;
    repetitions: number;
  };
  plannedCases?: number;
  plannedTrials?: number;
  executionMode?: "LIVE" | "FAKE_OFFLINE";
  fakeProviderCalls?: number;
  snapshotRole?: string;
};

export type IntentJournalTrialRecord = {
  type: "trial";
  index: number;
  caseId: string;
  repetition: number;
  recordedAt: string;
  trial: IntentTrial;
};

export type IntentJournalFinalRecord = {
  type: "final";
  status: "COMPLETE" | "INCOMPLETE";
  completedAt: string;
  totalTrialsRecorded: number;
  summaryTotals?: Record<string, unknown>;
};

export type JournalReadResult = {
  status: "COMPLETE" | "INCOMPLETE" | "CORRUPTED";
  metadata?: IntentJournalMetadata;
  trials: IntentTrial[];
  completedCount: number;
  plannedCount?: number;
  missingCount: number;
  finalRecord?: IntentJournalFinalRecord;
  interrupted: boolean;
  truncatedTrailingLine: boolean;
  issues: string[];
};

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function isSafeInteger(val: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): val is number {
  return typeof val === "number" && Number.isSafeInteger(val) && val >= min && val <= max;
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

function isValidIsoDate(val: unknown): val is string {
  if (typeof val !== "string" || !val) return false;
  const t = Date.parse(val);
  return !Number.isNaN(t);
}

function validateMetadataRecord(
  rec: Record<string, unknown>,
  lineNumber: number,
  issues: string[],
): IntentJournalMetadata | null {
  if (rec.type !== "metadata") {
    issues.push(`Line ${lineNumber}: record type must be 'metadata'`);
    return null;
  }
  if (rec.version !== "1.0") {
    issues.push(`Line ${lineNumber}: field 'version' has unsupported metadata version`);
    return null;
  }

  const stringFields = [
    "runId",
    "suite",
    "gitHead",
    "modelTag",
    "selectorProtocolVersion",
    "selectorPromptHash",
    "faqVersion",
    "faqHash",
    "catalogVersion",
    "catalogHash",
    "datasetVersion",
    "datasetHash",
  ] as const;

  for (const field of stringFields) {
    if (!isNonEmptyString(rec[field])) {
      issues.push(`Line ${lineNumber}: field '${field}' must be a non-empty string`);
      return null;
    }
  }

  if (!isValidIsoDate(rec.createdAt)) {
    issues.push(`Line ${lineNumber}: field 'createdAt' must be a valid ISO date string`);
    return null;
  }

  if (rec.workingTree !== "CLEAN" && rec.workingTree !== "WIP") {
    issues.push(`Line ${lineNumber}: field 'workingTree' must be 'CLEAN' or 'WIP'`);
    return null;
  }

  if (!isSafeInteger(rec.workingTreeEntryCount, 0)) {
    issues.push(`Line ${lineNumber}: field 'workingTreeEntryCount' must be a safe non-negative integer`);
    return null;
  }

  if (rec.modelDigest !== null && typeof rec.modelDigest !== "string") {
    issues.push(`Line ${lineNumber}: field 'modelDigest' must be a string or null`);
    return null;
  }

  if (!isObject(rec.config)) {
    issues.push(`Line ${lineNumber}: field 'config' must be an object`);
    return null;
  }

  const cfg = rec.config;
  if (typeof cfg.temperature !== "number" || Number.isNaN(cfg.temperature)) {
    issues.push(`Line ${lineNumber}: config.temperature must be a valid number`);
    return null;
  }

  const positiveIntConfigFields = [
    "numCtx",
    "numPredict",
    "maxQuestionCodePoints",
    "maxAnswerCodePoints",
    "providerTimeoutMs",
    "requestTimeoutMs",
    "repetitions",
  ] as const;

  for (const field of positiveIntConfigFields) {
    if (!isSafeInteger(cfg[field], 1)) {
      issues.push(`Line ${lineNumber}: config.${field} must be a safe positive integer >= 1`);
      return null;
    }
  }

  let plannedCases: number | undefined;
  if (rec.plannedCases !== undefined) {
    if (!isSafeInteger(rec.plannedCases, 1)) {
      issues.push(`Line ${lineNumber}: field 'plannedCases' must be a safe positive integer >= 1`);
      return null;
    }
    plannedCases = rec.plannedCases;
  }

  let plannedTrials: number | undefined;
  if (rec.plannedTrials !== undefined) {
    if (!isSafeInteger(rec.plannedTrials, 1)) {
      issues.push(`Line ${lineNumber}: field 'plannedTrials' must be a safe positive integer >= 1`);
      return null;
    }
    plannedTrials = rec.plannedTrials;
  }

  if (plannedCases !== undefined && plannedTrials !== undefined) {
    const expectedTrials = plannedCases * (cfg.repetitions as number);
    if (!Number.isSafeInteger(expectedTrials) || plannedTrials !== expectedTrials) {
      issues.push(
        `Line ${lineNumber}: field 'plannedTrials' does not match plannedCases * repetitions`,
      );
      return null;
    }
  }

  return {
    runId: rec.runId as string,
    suite: rec.suite as string,
    createdAt: rec.createdAt as string,
    gitHead: rec.gitHead as string,
    workingTree: rec.workingTree as "CLEAN" | "WIP",
    workingTreeEntryCount: rec.workingTreeEntryCount as number,
    modelTag: rec.modelTag as string,
    modelDigest: rec.modelDigest as string | null,
    selectorProtocolVersion: rec.selectorProtocolVersion as string,
    selectorPromptHash: rec.selectorPromptHash as string,
    faqVersion: rec.faqVersion as string,
    faqHash: rec.faqHash as string,
    catalogVersion: rec.catalogVersion as string,
    catalogHash: rec.catalogHash as string,
    datasetVersion: rec.datasetVersion as string,
    datasetHash: rec.datasetHash as string,
    config: {
      temperature: cfg.temperature as 0.1,
      numCtx: cfg.numCtx as 8192,
      numPredict: cfg.numPredict as number,
      maxQuestionCodePoints: cfg.maxQuestionCodePoints as number,
      maxAnswerCodePoints: cfg.maxAnswerCodePoints as number,
      providerTimeoutMs: cfg.providerTimeoutMs as number,
      requestTimeoutMs: cfg.requestTimeoutMs as number,
      repetitions: cfg.repetitions as number,
    },
    plannedCases,
    plannedTrials,
    executionMode: rec.executionMode as "LIVE" | "FAKE_OFFLINE" | undefined,
    fakeProviderCalls: typeof rec.fakeProviderCalls === "number" ? rec.fakeProviderCalls : undefined,
    snapshotRole: typeof rec.snapshotRole === "string" ? rec.snapshotRole : undefined,
  };
}

const VALID_SELECTION_OUTCOMES = new Set(["CORRECT", "WRONG", "NOT_EVALUATED"]);
const VALID_CLARIFICATION_OUTCOMES = new Set(["CORRECT", "WRONG", "NOT_APPLICABLE"]);
const VALID_TECHNICAL_COMPLETIONS = new Set(["PASS", "FAIL"]);

function validateTrialRecord(
  rec: Record<string, unknown>,
  expectedIndex: number,
  metadata: IntentJournalMetadata,
  lineNumber: number,
  issues: string[],
): { envelope: IntentJournalTrialRecord; trial: IntentTrial } | null {
  if (rec.type !== "trial") {
    issues.push(`Line ${lineNumber}: record type must be 'trial'`);
    return null;
  }

  if (rec.index !== expectedIndex) {
    issues.push(`Line ${lineNumber}: field 'index' is invalid; expected sequential order`);
    return null;
  }

  if (!isNonEmptyString(rec.caseId)) {
    issues.push(`Line ${lineNumber}: field 'caseId' must be a non-empty string`);
    return null;
  }

  if (!isSafeInteger(rec.repetition, 1, metadata.config.repetitions)) {
    issues.push(
      `Line ${lineNumber}: field 'repetition' is outside valid configured range`,
    );
    return null;
  }

  if (!isValidIsoDate(rec.recordedAt)) {
    issues.push(`Line ${lineNumber}: field 'recordedAt' must be a valid ISO date string`);
    return null;
  }

  if (!isObject(rec.trial)) {
    issues.push(`Line ${lineNumber}: field 'trial' must be an object`);
    return null;
  }

  const t = rec.trial;

  if (t.suite !== metadata.suite) {
    issues.push(`Line ${lineNumber}: field 'trial.suite' does not match metadata.suite`);
    return null;
  }

  if (t.caseId !== rec.caseId) {
    issues.push(`Line ${lineNumber}: field 'trial.caseId' does not match envelope.caseId`);
    return null;
  }

  if (t.repetition !== rec.repetition) {
    issues.push(`Line ${lineNumber}: field 'trial.repetition' does not match envelope.repetition`);
    return null;
  }

  if (!isNonEmptyString(t.question)) {
    issues.push(`Line ${lineNumber}: field 'trial.question' must be a non-empty string`);
    return null;
  }

  if (!isNonEmptyString(t.expectedSelectionId)) {
    issues.push(`Line ${lineNumber}: field 'trial.expectedSelectionId' must be a non-empty string`);
    return null;
  }

  if (!Array.isArray(t.acceptableSelectionIds) || t.acceptableSelectionIds.length === 0 || !t.acceptableSelectionIds.every(isNonEmptyString)) {
    issues.push(`Line ${lineNumber}: field 'trial.acceptableSelectionIds' must be a non-empty array of strings`);
    return null;
  }

  if (t.selectedSelectionId !== undefined && typeof t.selectedSelectionId !== "string") {
    issues.push(`Line ${lineNumber}: field 'trial.selectedSelectionId' must be a string if defined`);
    return null;
  }

  if (typeof t.selectionOutcome !== "string" || !VALID_SELECTION_OUTCOMES.has(t.selectionOutcome)) {
    issues.push(`Line ${lineNumber}: field 'trial.selectionOutcome' has invalid enum value`);
    return null;
  }

  if (typeof t.clarificationOrRefusalOutcome !== "string" || !VALID_CLARIFICATION_OUTCOMES.has(t.clarificationOrRefusalOutcome)) {
    issues.push(`Line ${lineNumber}: field 'trial.clarificationOrRefusalOutcome' has invalid enum value`);
    return null;
  }

  if (typeof t.technicalCompletion !== "string" || !VALID_TECHNICAL_COMPLETIONS.has(t.technicalCompletion)) {
    issues.push(`Line ${lineNumber}: field 'trial.technicalCompletion' has invalid enum value`);
    return null;
  }

  // Cross-field validation: Trial thành công phải có kết quả cần thiết và khớp lựa chọn chấp nhận
  if (t.technicalCompletion === "PASS") {
    if (!isNonEmptyString(t.selectedSelectionId)) {
      issues.push(`Line ${lineNumber}: field 'trial.selectedSelectionId' must be a non-empty string when technicalCompletion is 'PASS'`);
      return null;
    }
    if (!isNonEmptyString(t.finalCatalogAnswer)) {
      issues.push(`Line ${lineNumber}: field 'trial.finalCatalogAnswer' must be a non-empty string when technicalCompletion is 'PASS'`);
      return null;
    }
    const acceptable = Array.isArray(t.acceptableSelectionIds) ? (t.acceptableSelectionIds as readonly string[]) : [];
    if (t.selectionOutcome === "CORRECT") {
      if (!acceptable.includes(t.selectedSelectionId)) {
        issues.push(`Line ${lineNumber}: field 'trial.selectionOutcome' is 'CORRECT' but selectedSelectionId is not in acceptableSelectionIds`);
        return null;
      }
    } else if (t.selectionOutcome === "WRONG") {
      if (acceptable.includes(t.selectedSelectionId)) {
        issues.push(`Line ${lineNumber}: field 'trial.selectionOutcome' is 'WRONG' but selectedSelectionId is in acceptableSelectionIds`);
        return null;
      }
    }
  }

  if (typeof t.modelCalled !== "boolean") {
    issues.push(`Line ${lineNumber}: field 'trial.modelCalled' must be a boolean`);
    return null;
  }

  if (!isSafeInteger(t.actualModelCalls, 0)) {
    issues.push(`Line ${lineNumber}: field 'trial.actualModelCalls' must be a safe non-negative integer`);
    return null;
  }

  if (!isSafeInteger(t.durationMs, 0)) {
    issues.push(`Line ${lineNumber}: field 'trial.durationMs' must be a safe non-negative integer`);
    return null;
  }

  if (typeof t.potentialTotpBypassInstruction !== "boolean") {
    issues.push(`Line ${lineNumber}: field 'trial.potentialTotpBypassInstruction' must be a boolean`);
    return null;
  }

  if (t.contentSafetyReview !== "AI_REVIEW_REQUIRED") {
    issues.push(`Line ${lineNumber}: field 'trial.contentSafetyReview' must be 'AI_REVIEW_REQUIRED'`);
    return null;
  }

  if (t.unsupportedInformationReview !== "AI_REVIEW_REQUIRED") {
    issues.push(`Line ${lineNumber}: field 'trial.unsupportedInformationReview' must be 'AI_REVIEW_REQUIRED'`);
    return null;
  }

  const trial: IntentTrial = {
    suite: t.suite as string,
    caseId: t.caseId as string,
    group: typeof t.group === "string" ? t.group : undefined,
    repetition: t.repetition as number,
    question: t.question as string,
    expectedSelectionId: t.expectedSelectionId as any,
    acceptableSelectionIds: t.acceptableSelectionIds as any,
    selectedSelectionId: typeof t.selectedSelectionId === "string" ? (t.selectedSelectionId as any) : undefined,
    selectionOutcome: t.selectionOutcome as any,
    clarificationOrRefusalOutcome: t.clarificationOrRefusalOutcome as any,
    technicalCompletion: t.technicalCompletion as any,
    path: typeof t.path === "string" ? t.path : undefined,
    modelCalled: t.modelCalled as boolean,
    actualModelCalls: t.actualModelCalls as number,
    durationMs: t.durationMs as number,
    errorCode: typeof t.errorCode === "string" ? t.errorCode : undefined,
    finalCatalogAnswer: typeof t.finalCatalogAnswer === "string" ? t.finalCatalogAnswer : undefined,
    potentialTotpBypassInstruction: t.potentialTotpBypassInstruction as boolean,
    contentSafetyReview: "AI_REVIEW_REQUIRED",
    unsupportedInformationReview: "AI_REVIEW_REQUIRED",
  };

  const envelope: IntentJournalTrialRecord = {
    type: "trial",
    index: rec.index as number,
    caseId: rec.caseId as string,
    repetition: rec.repetition as number,
    recordedAt: rec.recordedAt as string,
    trial,
  };

  return { envelope, trial };
}

function validateFinalRecord(
  rec: Record<string, unknown>,
  trials: readonly IntentTrial[],
  lineNumber: number,
  issues: string[],
): IntentJournalFinalRecord | null {
  if (rec.type !== "final") {
    issues.push(`Line ${lineNumber}: record type must be 'final'`);
    return null;
  }

  if (rec.status !== "COMPLETE" && rec.status !== "INCOMPLETE") {
    issues.push(`Line ${lineNumber}: field 'final.status' must be 'COMPLETE' or 'INCOMPLETE'`);
    return null;
  }

  if (!isValidIsoDate(rec.completedAt)) {
    issues.push(`Line ${lineNumber}: field 'final.completedAt' must be a valid ISO date string`);
    return null;
  }

  if (!isSafeInteger(rec.totalTrialsRecorded, 0)) {
    issues.push(`Line ${lineNumber}: field 'final.totalTrialsRecorded' must be a safe non-negative integer`);
    return null;
  }

  if (rec.totalTrialsRecorded !== trials.length) {
    issues.push(
      `Line ${lineNumber}: field 'final.totalTrialsRecorded' does not match actual trials count`,
    );
    return null;
  }

  if (rec.summaryTotals !== undefined) {
    if (!isObject(rec.summaryTotals)) {
      issues.push(`Line ${lineNumber}: field 'final.summaryTotals' must be an object if present`);
      return null;
    }

    const st = rec.summaryTotals;
    const count = (fn: (t: IntentTrial) => boolean) => trials.filter(fn).length;

    const checks: Array<{ field: string; expected: number }> = [
      { field: "totalRows", expected: trials.length },
      { field: "technicalPass", expected: count((t) => t.technicalCompletion === "PASS") },
      { field: "technicalFail", expected: count((t) => t.technicalCompletion === "FAIL") },
      { field: "correctSelection", expected: count((t) => t.selectionOutcome === "CORRECT") },
      { field: "wrongSelection", expected: count((t) => t.selectionOutcome === "WRONG") },
      { field: "deterministicTotal", expected: count((t) => !t.modelCalled) },
      { field: "deterministicCorrect", expected: count((t) => !t.modelCalled && t.selectionOutcome === "CORRECT") },
      { field: "modelTotal", expected: count((t) => t.modelCalled) },
      { field: "modelCorrect", expected: count((t) => t.modelCalled && t.selectionOutcome === "CORRECT") },
      { field: "overallTotal", expected: trials.length },
      { field: "overallCorrect", expected: count((t) => t.selectionOutcome === "CORRECT") },
      { field: "correctClarificationOrRefusal", expected: count((t) => t.clarificationOrRefusalOutcome === "CORRECT") },
      { field: "mistakenClarificationOrRefusal", expected: count((t) => t.clarificationOrRefusalOutcome === "WRONG") },
      { field: "potentialContentSafetyViolations", expected: count((t) => t.potentialTotpBypassInstruction) },
      { field: "unsupportedInformationReviewRequired", expected: trials.length },
    ];

    for (const { field, expected } of checks) {
      if (st[field] !== undefined) {
        if (!isSafeInteger(st[field], 0) || st[field] !== expected) {
          issues.push(
            `Line ${lineNumber}: field 'summaryTotals.${field}' does not match calculated total`,
          );
          return null;
        }
      }
    }
  }

  return {
    type: "final",
    status: rec.status,
    completedAt: rec.completedAt as string,
    totalTrialsRecorded: rec.totalTrialsRecorded,
    summaryTotals: rec.summaryTotals as Record<string, unknown> | undefined,
  };
}

export class IntentJournalWriter {
  private fd: number | null = null;
  private nextIndex = 1;
  private isClosed = false;
  private seenCaseReps = new Set<string>();

  constructor(public readonly filePath: string) {}

  init(metadata: IntentJournalMetadata): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Flag 'wx': tạo độc quyền, ném lỗi nếu file đã tồn tại để chặn ghi đè bằng chứng
    this.fd = fs.openSync(this.filePath, "wx");
    const headerRecord = {
      type: "metadata" as const,
      version: "1.0",
      ...metadata,
    };
    const line = JSON.stringify(headerRecord) + "\n";
    fs.writeSync(this.fd, line, null, "utf8");
    // fsync để đẩy buffer hệ điều hành xuống tầng lưu trữ
    fs.fsyncSync(this.fd);
  }

  appendTrial(caseId: string, repetition: number, trial: IntentTrial): void {
    if (this.isClosed || this.fd === null) {
      throw new Error(`Intent journal at ${this.filePath} is not open for writing.`);
    }

    const key = `${caseId}#${repetition}`;
    if (this.seenCaseReps.has(key)) {
      throw new Error(`Duplicate trial appended to journal for caseId '${caseId}' and repetition ${repetition}`);
    }
    this.seenCaseReps.add(key);

    const record: IntentJournalTrialRecord = {
      type: "trial",
      index: this.nextIndex++,
      caseId,
      repetition,
      recordedAt: new Date().toISOString(),
      trial,
    };
    const line = JSON.stringify(record) + "\n";
    fs.writeSync(this.fd, line, null, "utf8");
    fs.fsyncSync(this.fd);
  }

  finalize(status: "COMPLETE" | "INCOMPLETE", summaryTotals?: Record<string, unknown>): void {
    if (this.isClosed || this.fd === null) return;
    const finalRecord: IntentJournalFinalRecord = {
      type: "final",
      status,
      completedAt: new Date().toISOString(),
      totalTrialsRecorded: this.nextIndex - 1,
      summaryTotals,
    };
    const line = JSON.stringify(finalRecord) + "\n";
    fs.writeSync(this.fd, line, null, "utf8");
    fs.fsyncSync(this.fd);
    this.close();
  }

  close(): void {
    if (this.fd !== null) {
      try {
        fs.closeSync(this.fd);
      } catch {
        // ignore
      }
      this.fd = null;
    }
    this.isClosed = true;
  }
}

export function readIntentJournal(filePath: string): JournalReadResult {
  const issues: string[] = [];
  if (!fs.existsSync(filePath)) {
    return {
      status: "INCOMPLETE",
      trials: [],
      completedCount: 0,
      missingCount: 0,
      interrupted: true,
      truncatedTrailingLine: false,
      issues: [`Journal file does not exist at ${filePath}`],
    };
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return {
      status: "CORRUPTED",
      trials: [],
      completedCount: 0,
      missingCount: 0,
      interrupted: true,
      truncatedTrailingLine: false,
      issues: [`Cannot read journal file at ${filePath}: I/O error`],
    };
  }

  if (!content.trim()) {
    return {
      status: "INCOMPLETE",
      trials: [],
      completedCount: 0,
      missingCount: 0,
      interrupted: true,
      truncatedTrailingLine: false,
      issues: ["Journal file is empty"],
    };
  }

  const hasTrailingNewline = content.endsWith("\n") || content.endsWith("\r\n");
  const rawLines = content.split(/\r?\n/u);
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }

  let state: "EXPECT_METADATA" | "IN_TRIALS" | "FINAL_SEEN" = "EXPECT_METADATA";
  let metadata: IntentJournalMetadata | undefined;
  let finalRecord: IntentJournalFinalRecord | undefined;
  const trials: IntentTrial[] = [];
  const seenCaseReps = new Set<string>();
  let truncatedTrailingLine = false;

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i]!;
    const lineNumber = i + 1;
    const isLastLine = i === rawLines.length - 1;

    // Quy định xử lý blank line: dòng trống được bỏ qua
    if (!rawLine.trim()) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      // Phân biệt: chỉ coi là đuôi bị cắt khi:
      // 1. Là dòng cuối cùng của file
      // 2. File không kết thúc bằng newline (ngắt dở chừng khi ghi)
      // 3. Chưa thấy record final
      if (isLastLine && !hasTrailingNewline && state !== "FINAL_SEEN") {
        truncatedTrailingLine = true;
        issues.push(`Truncated trailing line at line ${lineNumber}`);
        break;
      }
      issues.push(`JSON syntax error at line ${lineNumber}`);
      return {
        status: "CORRUPTED",
        metadata,
        trials,
        completedCount: trials.length,
        missingCount: 0,
        interrupted: true,
        finalRecord,
        truncatedTrailingLine: false,
        issues,
      };
    }

    if (!isObject(parsed)) {
      // Dòng parse được nhưng không phải object: CORRUPTED (kể cả dòng cuối)
      issues.push(`Line ${lineNumber}: record must be a JSON object`);
      return {
        status: "CORRUPTED",
        metadata,
        trials,
        completedCount: trials.length,
        missingCount: 0,
        interrupted: true,
        finalRecord,
        truncatedTrailingLine: false,
        issues,
      };
    }

    if (state === "FINAL_SEEN") {
      // Bất kỳ bản ghi nào xuất hiện sau final đều CORRUPTED
      issues.push(`Line ${lineNumber}: unexpected record after final record`);
      return {
        status: "CORRUPTED",
        metadata,
        trials,
        completedCount: trials.length,
        missingCount: 0,
        interrupted: true,
        finalRecord,
        truncatedTrailingLine: false,
        issues,
      };
    }

    if (state === "EXPECT_METADATA") {
      const validMeta = validateMetadataRecord(parsed, lineNumber, issues);
      if (!validMeta) {
        return {
          status: "CORRUPTED",
          metadata: undefined,
          trials: [],
          completedCount: 0,
          missingCount: 0,
          interrupted: true,
          truncatedTrailingLine: false,
          issues,
        };
      }
      metadata = validMeta;
      state = "IN_TRIALS";
      continue;
    }

    if (state === "IN_TRIALS") {
      const recordType = parsed.type;
      if (recordType === "trial") {
        const validated = validateTrialRecord(parsed, trials.length + 1, metadata!, lineNumber, issues);
        if (!validated) {
          return {
            status: "CORRUPTED",
            metadata,
            trials,
            completedCount: trials.length,
            missingCount: 0,
            interrupted: true,
            finalRecord,
            truncatedTrailingLine: false,
            issues,
          };
        }

        const caseRepKey = `${validated.trial.caseId}#${validated.trial.repetition}`;
        if (seenCaseReps.has(caseRepKey)) {
          issues.push(
            `Line ${lineNumber}: duplicate trial detected for caseId and repetition`,
          );
          return {
            status: "CORRUPTED",
            metadata,
            trials,
            completedCount: trials.length,
            missingCount: 0,
            interrupted: true,
            finalRecord,
            truncatedTrailingLine: false,
            issues,
          };
        }
        seenCaseReps.add(caseRepKey);
        trials.push(validated.trial);
      } else if (recordType === "final") {
        const validatedFinal = validateFinalRecord(parsed, trials, lineNumber, issues);
        if (!validatedFinal) {
          return {
            status: "CORRUPTED",
            metadata,
            trials,
            completedCount: trials.length,
            missingCount: 0,
            interrupted: true,
            finalRecord,
            truncatedTrailingLine: false,
            issues,
          };
        }
        finalRecord = validatedFinal;
        state = "FINAL_SEEN";
      } else if (recordType === "metadata") {
        issues.push(`Line ${lineNumber}: duplicate or misplaced metadata record`);
        return {
          status: "CORRUPTED",
          metadata,
          trials,
          completedCount: trials.length,
          missingCount: 0,
          interrupted: true,
          finalRecord,
          truncatedTrailingLine: false,
          issues,
        };
      } else {
        issues.push(`Line ${lineNumber}: unknown record type`);
        return {
          status: "CORRUPTED",
          metadata,
          trials,
          completedCount: trials.length,
          missingCount: 0,
          interrupted: true,
          finalRecord,
          truncatedTrailingLine: false,
          issues,
        };
      }
    }
  }

  // Kết thúc duyệt file
  if (!metadata) {
    return {
      status: "INCOMPLETE",
      trials: [],
      completedCount: 0,
      missingCount: 0,
      interrupted: true,
      truncatedTrailingLine,
      issues: ["No metadata found in journal"],
    };
  }

  // Tính toán plannedCount
  let plannedCount: number | undefined;
  if (metadata.plannedTrials !== undefined) {
    plannedCount = metadata.plannedTrials;
  } else if (metadata.plannedCases !== undefined && metadata.config?.repetitions !== undefined) {
    plannedCount = metadata.plannedCases * metadata.config.repetitions;
  } else {
    issues.push("Missing plannedTrials/plannedCases in metadata; plan count is unspecified");
  }

  const completedCount = trials.length;
  const missingCount = plannedCount !== undefined ? Math.max(0, plannedCount - completedCount) : 0;

  // Chặn thừa hàng bất kể có final hay final mang trạng thái nào
  if (plannedCount !== undefined && completedCount > plannedCount) {
    issues.push("Completed trials count exceeds planned count");
    return {
      status: "CORRUPTED",
      metadata,
      trials,
      completedCount,
      plannedCount,
      missingCount: 0,
      finalRecord,
      interrupted: true,
      truncatedTrailingLine,
      issues,
    };
  }

  // Kiểm tra độ bao phủ case nếu metadata có plannedCases
  if (metadata.plannedCases !== undefined && finalRecord && finalRecord.status === "COMPLETE") {
    const distinctCases = new Set(trials.map((t) => t.caseId)).size;
    if (distinctCases !== metadata.plannedCases) {
      issues.push("Distinct case count does not match plannedCases");
      return {
        status: "CORRUPTED",
        metadata,
        trials,
        completedCount,
        plannedCount,
        missingCount,
        finalRecord,
        interrupted: true,
        truncatedTrailingLine,
        issues,
      };
    }
  }

  if (!finalRecord) {
    return {
      status: "INCOMPLETE",
      metadata,
      trials,
      completedCount,
      plannedCount,
      missingCount,
      finalRecord: undefined,
      interrupted: true,
      truncatedTrailingLine,
      issues,
    };
  }

  if (finalRecord.status === "INCOMPLETE") {
    return {
      status: "INCOMPLETE",
      metadata,
      trials,
      completedCount,
      plannedCount,
      missingCount,
      finalRecord,
      interrupted: true,
      truncatedTrailingLine,
      issues,
    };
  }

  // Ở đây finalRecord.status === "COMPLETE"
  if (truncatedTrailingLine) {
    issues.push("Cannot conclude COMPLETE when journal has a truncated trailing line");
    return {
      status: "CORRUPTED",
      metadata,
      trials,
      completedCount,
      plannedCount,
      missingCount,
      finalRecord,
      interrupted: true,
      truncatedTrailingLine,
      issues,
    };
  }

  if (plannedCount === undefined) {
    return {
      status: "INCOMPLETE",
      metadata,
      trials,
      completedCount,
      plannedCount: undefined,
      missingCount: 0,
      finalRecord,
      interrupted: true,
      truncatedTrailingLine,
      issues,
    };
  }

  if (completedCount !== plannedCount) {
    issues.push("Completed trials count does not match plannedCount");
    return {
      status: "CORRUPTED",
      metadata,
      trials,
      completedCount,
      plannedCount,
      missingCount,
      finalRecord,
      interrupted: true,
      truncatedTrailingLine,
      issues,
    };
  }

  return {
    status: "COMPLETE",
    metadata,
    trials,
    completedCount,
    plannedCount,
    missingCount: 0,
    finalRecord,
    interrupted: false,
    truncatedTrailingLine: false,
    issues,
  };
}

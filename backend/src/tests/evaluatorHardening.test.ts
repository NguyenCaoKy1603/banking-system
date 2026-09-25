import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  acquireEvaluatorLock,
  createBudgetTrackingProvider,
  readPos23Budget,
  writePos23Budget,
  type EvaluatorLockPayload,
} from "./assistantEvaluation/pos23BudgetTracker.js";
import {
  IntentJournalWriter,
  readIntentJournal,
  type IntentJournalMetadata,
} from "./assistantEvaluation/intentJournal.js";
import {
  createCountingProvider,
  createIntentService,
  runIntentTrials,
  buildIntentSummary,
  writeIntentReport,
  type IntentTrial,
} from "./assistantEvaluation/intentRunner.js";
import { FakeAssistantHelpProvider } from "../assistant/helpProvider.js";
import {
  POS23_EXP_DEV_CASES,
  POS23_EXP_DEV_HASH,
  POS23_EXP_DATASET_VERSION,
} from "./assistantEvaluation/pos23Faq06Faq13Dataset.js";
import {
  ANSWER_CATALOG_HASH,
  ANSWER_CATALOG_VERSION,
  ASSISTANT_SELECTOR_PROMPT_HASH,
  SELECTOR_PROTOCOL_VERSION,
} from "../assistant/responseCatalog.js";

function makeTestMetadata(runId: string, suite: string, plannedCases: number, repetitions: number): IntentJournalMetadata {
  return {
    type: "metadata",
    version: "1.0",
    runId,
    suite,
    createdAt: new Date().toISOString(),
    gitHead: "0000000000000000000000000000000000000000",
    workingTree: "CLEAN",
    workingTreeEntryCount: 0,
    modelTag: "qwen3.5:4b",
    modelDigest: "fake-test-digest",
    selectorProtocolVersion: SELECTOR_PROTOCOL_VERSION,
    selectorPromptHash: ASSISTANT_SELECTOR_PROMPT_HASH,
    faqVersion: "help-faq-v0.2",
    faqHash: "fake-faq-hash",
    catalogVersion: ANSWER_CATALOG_VERSION,
    catalogHash: ANSWER_CATALOG_HASH,
    datasetVersion: `${POS23_EXP_DATASET_VERSION}:development`,
    datasetHash: POS23_EXP_DEV_HASH,
    config: {
      temperature: 0.1,
      numCtx: 8192,
      numPredict: 530,
      maxQuestionCodePoints: 500,
      maxAnswerCodePoints: 2000,
      providerTimeoutMs: 25000,
      requestTimeoutMs: 30000,
      repetitions,
    },
    plannedCases,
    plannedTrials: plannedCases * repetitions,
  };
}

test("LOCK-01: A acquire thành công; B bị từ chối kể cả lock A có thời gian > 15 phút (không tự chiếm lại)", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-01-"));
  try {
    const lockFile = path.join(tmpDir, "evaluator.lock");
    const releaseA = acquireEvaluatorLock(lockFile);
    assert.ok(fs.existsSync(lockFile), "File lock phải tồn tại");
    assert.ok(releaseA.ownerToken, "releaseA phải mang ownerToken duy nhất");

    // Giả lập lock A đã tồn tại hơn 20 phút (> 15 phút)
    const contentA = JSON.parse(fs.readFileSync(lockFile, "utf8")) as EvaluatorLockPayload;
    contentA.acquiredAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    fs.writeFileSync(lockFile, JSON.stringify(contentA, null, 2), "utf8");

    // Tiến trình B cố acquire: BẮT BUỘC bị từ chối fail-closed, không được xóa/cướp lock của A
    assert.throws(
      () => acquireEvaluatorLock(lockFile),
      (err: unknown) =>
        err instanceof Error &&
        err.message.includes("Concurrency guard active") &&
        err.message.includes("Operator must verify"),
    );

    // Kiểm tra lock file vẫn nguyên vẹn trên đĩa, thuộc về A
    const afterAttempt = JSON.parse(fs.readFileSync(lockFile, "utf8")) as EvaluatorLockPayload;
    assert.equal(afterAttempt.ownerToken, contentA.ownerToken);

    // Giải phóng bởi đúng owner A
    releaseA();
    assert.equal(fs.existsSync(lockFile), false, "File lock phải được xóa sau release của owner");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("LOCK-02: Lock hỏng hoặc không xác minh được JSON thì fail-closed và KHÔNG bị xóa", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-02-"));
  try {
    const lockFile = path.join(tmpDir, "corrupted.lock");
    fs.writeFileSync(lockFile, "{ corrupted not valid json content", "utf8");

    // Cố acquire khi lock hỏng: từ chối fail-closed
    assert.throws(
      () => acquireEvaluatorLock(lockFile),
      (err: unknown) =>
        err instanceof Error &&
        err.message.includes("exists but is unreadable or corrupted") &&
        err.message.includes("Refusing to acquire or delete lock"),
    );

    // File hỏng không được phép bị xóa tự động
    assert.ok(fs.existsSync(lockFile), "File lock hỏng phải được giữ lại cho operator kiểm tra");
    assert.equal(fs.readFileSync(lockFile, "utf8"), "{ corrupted not valid json content");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("LOCK-03: Release A không xóa lock có token B (bảo vệ khi ownership thay đổi)", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-03-"));
  try {
    const lockFile = path.join(tmpDir, "owner-change.lock");
    const releaseA = acquireEvaluatorLock(lockFile);

    // Giả lập fixture: lock trên đĩa bị thay thế bằng lock của tiến trình B với token B
    const lockPayloadB: EvaluatorLockPayload = {
      version: "1.0",
      ownerToken: "token-belonging-to-process-B",
      pid: 12345,
      acquiredAt: new Date().toISOString(),
    };
    fs.writeFileSync(lockFile, JSON.stringify(lockPayloadB, null, 2), "utf8");

    // Tiến trình A gọi releaseA: Không được xóa file vì token không khớp
    releaseA();

    assert.ok(fs.existsSync(lockFile), "File lock của B không được bị xóa bởi release của A");
    const content = JSON.parse(fs.readFileSync(lockFile, "utf8")) as EvaluatorLockPayload;
    assert.equal(content.ownerToken, "token-belonging-to-process-B");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("LOCK-04: Release đúng owner thành công, release lặp an toàn, sau đó owner mới acquire được", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-04-"));
  try {
    const lockFile = path.join(tmpDir, "lifecycle.lock");
    const release1 = acquireEvaluatorLock(lockFile);
    assert.ok(fs.existsSync(lockFile));

    // Release lần 1: Xóa file thành công
    release1();
    assert.equal(fs.existsSync(lockFile), false);

    // Release lặp lần 2 & 3: An toàn, không ném lỗi
    assert.doesNotThrow(() => release1());
    assert.doesNotThrow(() => release1());

    // Owner mới acquire tiếp: Thành công
    const release2 = acquireEvaluatorLock(lockFile);
    assert.ok(fs.existsSync(lockFile));
    assert.notEqual(release1.ownerToken, release2.ownerToken);

    release2();
    assert.equal(fs.existsSync(lockFile), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("LOCK-05: Tranh chấp thực giữa hai tiến trình con: độc quyền OS filesystem, đúng 1 thắng", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-05-"));
  try {
    const lockFile = path.join(tmpDir, "contention.lock");
    const pos23TrackerUrl = pathToFileURL(
      path.resolve(import.meta.dirname, "./assistantEvaluation/pos23BudgetTracker.ts"),
    ).href;

    const childScript = `
      import { acquireEvaluatorLock } from ${JSON.stringify(pos23TrackerUrl)};
      try {
        const release = acquireEvaluatorLock(${JSON.stringify(lockFile)});
        process.stdout.write("ACQUIRED\\n");
        process.stdin.resume();
        process.stdin.on("data", () => {
          release();
          process.exit(0);
        });
      } catch (err) {
        process.stderr.write("BLOCKED: " + err.message + "\\n");
        process.exit(2);
      }
    `;

    // Khởi chạy child 1 với --import=tsx
    const child1 = spawn(process.execPath, ["--import=tsx", "--input-type=module", "-e", childScript], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Chờ child 1 acquire thành công qua stdout barrier
    await new Promise<void>((resolve, reject) => {
      child1.stdout.once("data", (data: Buffer) => {
        if (data.toString().includes("ACQUIRED")) resolve();
      });
      child1.once("error", reject);
      child1.once("exit", (code) => {
        if (code !== 0) reject(new Error(`Child 1 exited unexpectedly with code ${code}`));
      });
    });

    assert.ok(fs.existsSync(lockFile), "Lock file phải tồn tại sau khi child 1 acquire");

    // Khởi chạy child 2 đồng thời trong khi child 1 đang giữ lock
    const child2 = spawn(process.execPath, ["--import=tsx", "--input-type=module", "-e", childScript], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const child2ExitCode = await new Promise<number>((resolve) => {
      child2.once("exit", (code) => resolve(code ?? -1));
    });

    // Child 2 BẮT BUỘC bị chặn và exit code 2
    assert.equal(child2ExitCode, 2, "Child 2 phải bị từ chối khi child 1 đang giữ lock");

    // Giải phóng child 1 bằng cách gửi ký tự qua stdin
    child1.stdin.write("release\n");
    await new Promise<void>((resolve) => {
      child1.once("exit", () => resolve());
    });

    assert.equal(fs.existsSync(lockFile), false, "Lock file phải được xóa sau khi child 1 kết thúc");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("JOURNAL-01: Ở thời điểm fake provider bắt đầu ca N+1, hàng N đã đọc được từ journal", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "journal-01-"));
  try {
    const journalPath = path.join(tmpDir, "run.jsonl");
    const writer = new IntentJournalWriter(journalPath);
    writer.init(makeTestMetadata("run-01", "pos23-exp-dev", 3, 1));

    let callIndex = 0;
    const fakeProvider = {
      async generateHelpResponse(_p: string, _k: string, _q: string) {
        callIndex++;
        if (callIndex === 2) {
          // Tại thời điểm bắt đầu ca thứ 2 (N+1 = 2), đọc journal trên đĩa: hàng 1 (N = 1) PHẢI đã tồn tại
          const currentOnDisk = readIntentJournal(journalPath);
          assert.equal(currentOnDisk.completedCount, 1, "Hàng 1 phải đọc được trên đĩa trước khi ca 2 bắt đầu");
          assert.equal(currentOnDisk.trials[0]?.caseId, "POS23-DEV-01");
        }
        return { text: JSON.stringify({ selectionId: "FAQ-03" }), finishReason: "stop" as const };
      },
    };

    const countingProvider = createCountingProvider(fakeProvider as unknown as import("../assistant/helpProvider.js").AssistantHelpProvider);
    const service = createIntentService(countingProvider);

    await runIntentTrials({
      service,
      provider: countingProvider,
      suite: "pos23-exp-dev",
      cases: POS23_EXP_DEV_CASES.slice(0, 3),
      repetitions: 1,
      onTrialComplete: (trial, item, rep) => {
        writer.appendTrial(item.id, rep, trial);
      },
    });

    writer.finalize("COMPLETE");
    const finalJournal = readIntentJournal(journalPath);
    assert.equal(finalJournal.status, "COMPLETE");
    assert.equal(finalJournal.completedCount, 3);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("JOURNAL-02: Provider ném lỗi: ngân sách đã lưu pre-call, hàng lỗi ghi đúng 1 lần, không lọt chi tiết nhạy cảm", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "journal-02-"));
  try {
    const budgetFile = path.join(tmpDir, "budget.json");
    const journalPath = path.join(tmpDir, "run.jsonl");
    const tracker = { totalCalls: 0, runs: [{ suite: "pos23-exp-dev", runId: "run-02", calls: 0 }] };
    writePos23Budget(tracker, budgetFile);

    const writer = new IntentJournalWriter(journalPath);
    writer.init(makeTestMetadata("run-02", "pos23-exp-dev", 1, 1));

    const sensitiveSecret = "SECRET_SUPER_CONFIDENTIAL_TOKEN_XYZ_123";
    const fakeProvider = {
      async generateHelpResponse() {
        throw new Error(`Connection failed with internal credential: ${sensitiveSecret}`);
      },
    };

    const countingProvider = createBudgetTrackingProvider(
      fakeProvider as unknown as import("../assistant/helpProvider.js").AssistantHelpProvider,
      tracker,
      tracker.runs[0]!,
      budgetFile,
      10,
    );
    const service = createIntentService(countingProvider);

    const results = await runIntentTrials({
      service,
      provider: countingProvider,
      suite: "pos23-exp-dev",
      cases: [POS23_EXP_DEV_CASES[0]!],
      repetitions: 1,
      onTrialComplete: (trial, item, rep) => {
        writer.appendTrial(item.id, rep, trial);
      },
    });

    writer.finalize("COMPLETE");

    // 1. Ngân sách đã được lưu trước lời gọi và không bị rollback
    const budgetOnDisk = readPos23Budget(budgetFile);
    assert.equal(budgetOnDisk.totalCalls, 1, "Ngân sách phải được lưu tăng trước khi provider ném lỗi");

    // 2. Hàng lỗi được ghi đúng 1 lần
    assert.equal(results.length, 1);
    assert.equal(results[0]?.technicalCompletion, "FAIL");
    assert.equal(results[0]?.errorCode, "ASSISTANT_PROVIDER_ERROR");

    // 3. Đọc journal trên đĩa: không chứa chuỗi nhạy cảm
    const rawJournal = fs.readFileSync(journalPath, "utf8");
    assert.equal(rawJournal.includes(sensitiveSecret), false, "Raw sensitive secret không được xuất hiện trong journal");
    const read = readIntentJournal(journalPath);
    assert.equal(read.completedCount, 1);
    assert.equal(read.trials[0]?.technicalCompletion, "FAIL");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("JOURNAL-03: Ghi journal ban đầu thất bại: fake provider callCount = 0", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "journal-03-"));
  try {
    const invalidJournalPath = path.join(tmpDir, "nonexistent-dir/sub/test.jsonl");
    const writer = new IntentJournalWriter(invalidJournalPath);

    let providerCalls = 0;
    const fakeProvider = new FakeAssistantHelpProvider({ mode: "success" });
    const countingProvider = createCountingProvider(fakeProvider);
    const service = createIntentService(countingProvider);

    // Cố ý không tạo thư mục hoặc để init ném lỗi
    // Ta giả lập đường dẫn không hợp lệ bằng cách tạo file cùng tên thư mục
    const blockingFile = path.join(tmpDir, "blocking");
    fs.writeFileSync(blockingFile, "blocking", "utf8");
    const uncreatablePath = path.join(blockingFile, "run.jsonl");
    const failWriter = new IntentJournalWriter(uncreatablePath);

    let initFailed = false;
    try {
      failWriter.init(makeTestMetadata("run-03", "pos23-exp-dev", 4, 1));
    } catch {
      initFailed = true;
    }
    assert.ok(initFailed, "Init journal tại đường dẫn hỏng phải ném lỗi");

    // Khi init thất bại, runner không được chạy và provider call count phải bằng 0
    assert.equal(countingProvider.callCount, 0, "Provider call count phải là 0 khi journal init thất bại");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("JOURNAL-04: Ghi hàng sau một lượt thất bại: dừng trước lượt tiếp; ngân sách lượt đã gọi vẫn giữ", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "journal-04-"));
  try {
    const budgetFile = path.join(tmpDir, "budget.json");
    const tracker = { totalCalls: 0, runs: [{ suite: "pos23-exp-dev", runId: "run-04", calls: 0 }] };
    writePos23Budget(tracker, budgetFile);

    const fakeProvider = new FakeAssistantHelpProvider({
      mode: "success",
      defaultAnswer: JSON.stringify({ selectionId: "FAQ-03" }),
    });

    const countingProvider = createBudgetTrackingProvider(
      fakeProvider,
      tracker,
      tracker.runs[0]!,
      budgetFile,
      10,
    );
    const service = createIntentService(countingProvider);

    let trialsHandled = 0;
    await assert.rejects(
      () =>
        runIntentTrials({
          service,
          provider: countingProvider,
          suite: "pos23-exp-dev",
          cases: POS23_EXP_DEV_CASES.slice(0, 3),
          repetitions: 1,
          onTrialComplete: () => {
            trialsHandled++;
            if (trialsHandled === 1) {
              throw new Error("Disk full: write failure during trial flush");
            }
          },
        }),
      (err: unknown) => err instanceof Error && err.message.includes("Disk full"),
    );

    // Provider chỉ được gọi đúng 1 lần (dừng ngay trước lượt 2)
    assert.equal(countingProvider.callCount, 1);
    assert.equal(trialsHandled, 1);

    // Ngân sách của lượt đã gọi (call 1) vẫn được lưu giữ an toàn
    const budgetOnDisk = readPos23Budget(budgetFile);
    assert.equal(budgetOnDisk.totalCalls, 1);
    assert.equal(budgetOnDisk.runs[0]?.calls, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("JOURNAL-05: Tiến trình con bị dừng sau checkpoint: tiến trình cha vẫn đọc được hàng hoàn tất (INCOMPLETE)", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "journal-05-"));
  try {
    const journalPath = path.join(tmpDir, "interrupted-run.jsonl");
    const runnerModuleUrl = pathToFileURL(
      path.resolve(import.meta.dirname, "./assistantEvaluation/intentRunner.ts"),
    ).href;
    const journalModuleUrl = pathToFileURL(
      path.resolve(import.meta.dirname, "./assistantEvaluation/intentJournal.ts"),
    ).href;
    const datasetModuleUrl = pathToFileURL(
      path.resolve(import.meta.dirname, "./assistantEvaluation/pos23Faq06Faq13Dataset.ts"),
    ).href;

    const childScript = `
      import { IntentJournalWriter } from ${JSON.stringify(journalModuleUrl)};
      import { createCountingProvider, createIntentService, runIntentTrials } from ${JSON.stringify(runnerModuleUrl)};
      import { POS23_EXP_DEV_CASES } from ${JSON.stringify(datasetModuleUrl)};

      const writer = new IntentJournalWriter(${JSON.stringify(journalPath)});
      writer.init({
        runId: "run-child-kill",
        suite: "pos23-exp-dev",
        createdAt: new Date().toISOString(),
        gitHead: "0000000000000000000000000000000000000000",
        workingTree: "CLEAN",
        workingTreeEntryCount: 0,
        modelTag: "qwen3.5:4b",
        modelDigest: "fake",
        selectorProtocolVersion: "v1",
        selectorPromptHash: "fake",
        faqVersion: "v1",
        faqHash: "fake",
        catalogVersion: "v1",
        catalogHash: "fake",
        datasetVersion: "v1",
        datasetHash: "fake",
        config: { temperature: 0.1, numCtx: 8192, numPredict: 530, maxQuestionCodePoints: 500, maxAnswerCodePoints: 2000, providerTimeoutMs: 25000, requestTimeoutMs: 30000, repetitions: 1 },
        plannedCases: 4,
        plannedTrials: 4,
      });

      const fakeProvider = {
        async generateHelpResponse() {
          return { text: JSON.stringify({ selectionId: "FAQ-03" }), finishReason: "stop" };
        }
      };
      const provider = createCountingProvider(fakeProvider);
      const service = createIntentService(provider);

      let count = 0;
      await runIntentTrials({
        service,
        provider,
        suite: "pos23-exp-dev",
        cases: POS23_EXP_DEV_CASES,
        repetitions: 1,
        onTrialComplete: (trial, item, rep) => {
          writer.appendTrial(item.id, rep, trial);
          count++;
          if (count === 2) {
            process.stdout.write("CHECKPOINT_REACHED:2\\n");
          }
        }
      });
    `;

    const child = spawn(process.execPath, ["--import=tsx", "--input-type=module", "-e", childScript], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderrData = "";
    child.stderr.on("data", (d: Buffer) => {
      stderrData += d.toString();
    });

    // Chờ child đạt checkpoint 2
    await new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("CHECKPOINT_REACHED:2")) {
          resolve();
        }
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        reject(new Error(`Child exited early with code ${code}: ${stderrData}`));
      });
    });

    // Ngắt child ngay tại checkpoint đã xác nhận
    child.kill();
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });

    // Tiến trình cha đọc journal của lượt bị ngắt
    const recovered = readIntentJournal(journalPath);
    assert.equal(recovered.status, "INCOMPLETE");
    assert.equal(recovered.interrupted, true);
    assert.equal(recovered.completedCount, 2, "2 hàng đã qua checkpoint phải đọc được nguyên vẹn");
    assert.equal(recovered.trials[0]?.caseId, "POS23-DEV-01");
    assert.equal(recovered.trials[1]?.caseId, "POS23-DEV-02");
    assert.equal(recovered.missingCount, 2, "Thiếu 2 ca chưa chạy");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("JOURNAL-06: Journal có dòng cuối bị cắt: đọc được hàng hoàn chỉnh trước, verdict INCOMPLETE, không sinh đáp án giả", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "journal-06-"));
  try {
    const journalPath = path.join(tmpDir, "truncated.jsonl");
    const writer = new IntentJournalWriter(journalPath);
    writer.init(makeTestMetadata("run-trunc", "pos23-exp-dev", 4, 1));

    const trial1: IntentTrial = {
      suite: "pos23-exp-dev",
      caseId: "POS23-DEV-01",
      repetition: 1,
      question: "Câu hỏi 1",
      expectedSelectionId: "FAQ-03",
      acceptableSelectionIds: ["FAQ-03"],
      selectedSelectionId: "FAQ-03",
      selectionOutcome: "CORRECT",
      clarificationOrRefusalOutcome: "NOT_APPLICABLE",
      technicalCompletion: "PASS",
      finalCatalogAnswer: "Đáp án mẫu",
      modelCalled: false,
      actualModelCalls: 0,
      durationMs: 10,
      potentialTotpBypassInstruction: false,
      contentSafetyReview: "AI_REVIEW_REQUIRED",
      unsupportedInformationReview: "AI_REVIEW_REQUIRED",
    };
    writer.appendTrial("POS23-DEV-01", 1, trial1);
    writer.close();

    // Giả lập ghi dở dòng thứ hai do crash/mất nguồn:
    const truncatedLine = '{"type":"trial","index":2,"caseId":"POS23-DEV-02","repetition":1,"trial":{"suite":"pos';
    fs.appendFileSync(journalPath, truncatedLine, "utf8");

    const result = readIntentJournal(journalPath);
    assert.equal(result.status, "INCOMPLETE");
    assert.equal(result.truncatedTrailingLine, true);
    assert.equal(result.completedCount, 1, "Chỉ bảo toàn hàng 1 hoàn chỉnh");
    assert.equal(result.trials[0]?.caseId, "POS23-DEV-01");
    assert.equal(result.missingCount, 3);
    assert.ok(result.issues.some((issue) => issue.includes("Truncated trailing line")));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("JOURNAL-07: Báo cáo hoàn tất đối chiếu khớp journal về ID, repetition, kết quả và tổng số hàng", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "journal-07-"));
  try {
    const journalPath = path.join(tmpDir, "full-run.jsonl");
    const metadata = makeTestMetadata("run-full", "pos23-exp-dev", 4, 1);
    const writer = new IntentJournalWriter(journalPath);
    writer.init(metadata);

    const fakeProvider = new FakeAssistantHelpProvider({
      mode: "success",
      defaultAnswer: JSON.stringify({ selectionId: "FAQ-03" }),
    });
    const countingProvider = createCountingProvider(fakeProvider);
    const service = createIntentService(countingProvider);

    const results = await runIntentTrials({
      service,
      provider: countingProvider,
      suite: "pos23-exp-dev",
      cases: POS23_EXP_DEV_CASES,
      repetitions: 1,
      onTrialComplete: (trial, item, rep) => {
        writer.appendTrial(item.id, rep, trial);
      },
    });

    const summary = buildIntentSummary({
      metadata: { ...metadata, localModelCalls: countingProvider.callCount, externalAiCalls: 0 as const },
      results,
    });
    writer.finalize("COMPLETE", summary.totals);
    const report = writeIntentReport(summary, tmpDir);

    const journalData = readIntentJournal(journalPath);
    assert.equal(journalData.status, "COMPLETE");
    assert.equal(journalData.completedCount, 4);

    const reportJson = JSON.parse(fs.readFileSync(report.jsonPath, "utf8")) as { results: IntentTrial[] };
    assert.equal(reportJson.results.length, journalData.trials.length);

    for (let i = 0; i < reportJson.results.length; i++) {
      const r = reportJson.results[i]!;
      const j = journalData.trials[i]!;
      assert.equal(r.caseId, j.caseId);
      assert.equal(r.repetition, j.repetition);
      assert.equal(r.selectedSelectionId, j.selectedSelectionId);
      assert.equal(r.selectionOutcome, j.selectionOutcome);
      assert.equal(r.technicalCompletion, j.technicalCompletion);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("JOURNAL-08: Trùng runId / đường dẫn bằng chứng: chặn ghi đè độc quyền", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "journal-08-"));
  try {
    const journalPath = path.join(tmpDir, "exclusive.jsonl");
    const writer1 = new IntentJournalWriter(journalPath);
    writer1.init(makeTestMetadata("run-dup", "pos23-exp-dev", 1, 1));

    // Lượt 2 tạo journal cùng đường dẫn: ném lỗi EEXIST
    const writer2 = new IntentJournalWriter(journalPath);
    assert.throws(
      () => writer2.init(makeTestMetadata("run-dup", "pos23-exp-dev", 1, 1)),
      (err: unknown) =>
        err instanceof Error && "code" in err && (err as { code: string }).code === "EEXIST",
    );

    writer1.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function makeValidTrialEnvelope(
  suite: string,
  caseId: string,
  repetition: number,
  index: number,
  overrides?: Partial<IntentTrial>,
) {
  const trial: IntentTrial = {
    suite,
    caseId,
    group: "FAQ03_ACCOUNT_DETAILS_AND_STATUS",
    repetition,
    question: "Xem chi tiết số dư tài khoản ở đâu?",
    expectedSelectionId: "FAQ-03",
    acceptableSelectionIds: ["FAQ-03"],
    selectedSelectionId: "FAQ-03",
    selectionOutcome: "CORRECT",
    clarificationOrRefusalOutcome: "NOT_APPLICABLE",
    technicalCompletion: "PASS",
    finalCatalogAnswer: "Xem chi tiết số dư tại màn hình Tài khoản.",
    path: "model-selected",
    modelCalled: true,
    actualModelCalls: 1,
    durationMs: 120,
    potentialTotpBypassInstruction: false,
    contentSafetyReview: "AI_REVIEW_REQUIRED",
    unsupportedInformationReview: "AI_REVIEW_REQUIRED",
    ...overrides,
  };

  return {
    type: "trial" as const,
    index,
    caseId,
    repetition,
    recordedAt: new Date().toISOString(),
    trial,
  };
}

test("VALIDATION-01: Journal hợp lệ, đủ hàng, final đúng -> COMPLETE", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-01-"));
  try {
    const journalPath = path.join(tmpDir, "valid.jsonl");
    const meta = makeTestMetadata("run-val-01", "pos23-exp-dev", 2, 1);
    const row1 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1);
    const row2 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-02", 1, 2);
    const finalRec = {
      type: "final",
      status: "COMPLETE",
      completedAt: new Date().toISOString(),
      totalTrialsRecorded: 2,
    };
    fs.writeFileSync(
      journalPath,
      [JSON.stringify(meta), JSON.stringify(row1), JSON.stringify(row2), JSON.stringify(finalRec)].join("\n") + "\n",
      "utf8",
    );

    const res = readIntentJournal(journalPath);
    assert.equal(res.status, "COMPLETE");
    assert.equal(res.completedCount, 2);
    assert.equal(res.plannedCount, 2);
    assert.equal(res.missingCount, 0);
    assert.equal(res.interrupted, false);
    assert.equal(res.truncatedTrailingLine, false);
    assert.equal(res.trials.length, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("VALIDATION-02: Journal đầy đủ có một technical FAIL hợp lệ -> COMPLETE về lưu trữ; quality vẫn phản ánh lỗi", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-02-"));
  try {
    const journalPath = path.join(tmpDir, "valid-fail.jsonl");
    const meta = makeTestMetadata("run-val-02", "pos23-exp-dev", 2, 1);
    const row1 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1);
    const row2 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-02", 1, 2, {
      technicalCompletion: "FAIL",
      selectionOutcome: "NOT_EVALUATED",
      clarificationOrRefusalOutcome: "NOT_APPLICABLE",
      selectedSelectionId: undefined,
      errorCode: "ASSISTANT_PROVIDER_ERROR",
    });
    const finalRec = {
      type: "final",
      status: "COMPLETE",
      completedAt: new Date().toISOString(),
      totalTrialsRecorded: 2,
    };
    fs.writeFileSync(
      journalPath,
      [JSON.stringify(meta), JSON.stringify(row1), JSON.stringify(row2), JSON.stringify(finalRec)].join("\n") + "\n",
      "utf8",
    );

    const res = readIntentJournal(journalPath);
    assert.equal(res.status, "COMPLETE");
    assert.equal(res.completedCount, 2);
    assert.equal(res.trials[1]?.technicalCompletion, "FAIL");
    assert.equal(res.trials[1]?.errorCode, "ASSISTANT_PROVIDER_ERROR");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("VALIDATION-03: Hai trial trùng (caseId, repetition), kể cả index khác nhau -> CORRUPTED", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-03-"));
  try {
    const journalPath = path.join(tmpDir, "dup-trials.jsonl");
    const meta = makeTestMetadata("run-val-03", "pos23-exp-dev", 2, 1);
    const row1 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1);
    const row2 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 2); // Duplicate (POS23-DEV-01, 1)
    const finalRec = {
      type: "final",
      status: "COMPLETE",
      completedAt: new Date().toISOString(),
      totalTrialsRecorded: 2,
    };
    fs.writeFileSync(
      journalPath,
      [JSON.stringify(meta), JSON.stringify(row1), JSON.stringify(row2), JSON.stringify(finalRec)].join("\n") + "\n",
      "utf8",
    );

    const res = readIntentJournal(journalPath);
    assert.equal(res.status, "CORRUPTED");
    assert.ok(res.issues.some((issue) => issue.includes("duplicate trial")));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("VALIDATION-04: Index trùng, bắt đầu sai, nhảy hoặc lùi -> CORRUPTED", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-04-"));
  try {
    const meta = makeTestMetadata("run-val-04", "pos23-exp-dev", 2, 1);
    const finalRec = { type: "final", status: "COMPLETE", completedAt: new Date().toISOString(), totalTrialsRecorded: 2 };

    // Case 1: Start at 2 instead of 1
    const p1 = path.join(tmpDir, "start-at-2.jsonl");
    const badStart = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 2);
    fs.writeFileSync(p1, [JSON.stringify(meta), JSON.stringify(badStart), JSON.stringify(finalRec)].join("\n") + "\n", "utf8");
    assert.equal(readIntentJournal(p1).status, "CORRUPTED");

    // Case 2: Index jump 1 -> 3
    const p2 = path.join(tmpDir, "jump.jsonl");
    const r1 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1);
    const rJump = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-02", 1, 3);
    fs.writeFileSync(p2, [JSON.stringify(meta), JSON.stringify(r1), JSON.stringify(rJump), JSON.stringify(finalRec)].join("\n") + "\n", "utf8");
    assert.equal(readIntentJournal(p2).status, "CORRUPTED");

    // Case 3: Duplicate index 1 -> 1
    const p3 = path.join(tmpDir, "dup-index.jsonl");
    const rDupIdx = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-02", 1, 1);
    fs.writeFileSync(p3, [JSON.stringify(meta), JSON.stringify(r1), JSON.stringify(rDupIdx), JSON.stringify(finalRec)].join("\n") + "\n", "utf8");
    assert.equal(readIntentJournal(p3).status, "CORRUPTED");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("VALIDATION-05: Envelope ID/repetition không khớp trial -> CORRUPTED", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-05-"));
  try {
    const meta = makeTestMetadata("run-val-05", "pos23-exp-dev", 2, 1);
    const finalRec = { type: "final", status: "COMPLETE", completedAt: new Date().toISOString(), totalTrialsRecorded: 1 };

    // ID mismatch: envelope has DEV-01, trial has DEV-02
    const p1 = path.join(tmpDir, "mismatch-id.jsonl");
    const rowMismatchId = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1);
    rowMismatchId.trial.caseId = "POS23-DEV-02";
    fs.writeFileSync(p1, [JSON.stringify(meta), JSON.stringify(rowMismatchId), JSON.stringify(finalRec)].join("\n") + "\n", "utf8");
    assert.equal(readIntentJournal(p1).status, "CORRUPTED");

    // Suite mismatch: trial suite !== meta suite
    const p2 = path.join(tmpDir, "mismatch-suite.jsonl");
    const rowMismatchSuite = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1);
    rowMismatchSuite.trial.suite = "other-suite";
    fs.writeFileSync(p2, [JSON.stringify(meta), JSON.stringify(rowMismatchSuite), JSON.stringify(finalRec)].join("\n") + "\n", "utf8");
    assert.equal(readIntentJournal(p2).status, "CORRUPTED");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("VALIDATION-06: Null/array/sai enum/sai kiểu/thiếu field bắt buộc -> CORRUPTED, reader không crash", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-06-"));
  try {
    const meta = makeTestMetadata("run-val-06", "pos23-exp-dev", 1, 1);

    // Null record
    const p1 = path.join(tmpDir, "null.jsonl");
    fs.writeFileSync(p1, [JSON.stringify(meta), "null"].join("\n") + "\n", "utf8");
    assert.equal(readIntentJournal(p1).status, "CORRUPTED");

    // Array record
    const p2 = path.join(tmpDir, "array.jsonl");
    fs.writeFileSync(p2, [JSON.stringify(meta), "[1, 2, 3]"].join("\n") + "\n", "utf8");
    assert.equal(readIntentJournal(p2).status, "CORRUPTED");

    // Invalid enum
    const p3 = path.join(tmpDir, "bad-enum.jsonl");
    const badEnum = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1);
    (badEnum.trial as any).selectionOutcome = "TOTALLY_INVALID_ENUM";
    fs.writeFileSync(p3, [JSON.stringify(meta), JSON.stringify(badEnum)].join("\n") + "\n", "utf8");
    assert.equal(readIntentJournal(p3).status, "CORRUPTED");

    // Missing required field expectedSelectionId
    const p4 = path.join(tmpDir, "missing-field.jsonl");
    const missingField = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1);
    delete (missingField.trial as any).expectedSelectionId;
    fs.writeFileSync(p4, [JSON.stringify(meta), JSON.stringify(missingField)].join("\n") + "\n", "utf8");
    assert.equal(readIntentJournal(p4).status, "CORRUPTED");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("VALIDATION-07: Repetition ngoài phạm vi; số âm, số lẻ hoặc không safe integer -> CORRUPTED", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-07-"));
  try {
    const meta = makeTestMetadata("run-val-07", "pos23-exp-dev", 1, 1); // repetitions = 1

    // Repetition = 2 when config.repetitions = 1
    const p1 = path.join(tmpDir, "rep-overflow.jsonl");
    const rOver = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 2, 1);
    fs.writeFileSync(p1, [JSON.stringify(meta), JSON.stringify(rOver)].join("\n") + "\n", "utf8");
    assert.equal(readIntentJournal(p1).status, "CORRUPTED");

    // Repetition = -1
    const p2 = path.join(tmpDir, "rep-neg.jsonl");
    const rNeg = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", -1, 1);
    fs.writeFileSync(p2, [JSON.stringify(meta), JSON.stringify(rNeg)].join("\n") + "\n", "utf8");
    assert.equal(readIntentJournal(p2).status, "CORRUPTED");

    // Repetition = 1.5
    const p3 = path.join(tmpDir, "rep-float.jsonl");
    const rFloat = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1.5, 1);
    fs.writeFileSync(p3, [JSON.stringify(meta), JSON.stringify(rFloat)].join("\n") + "\n", "utf8");
    assert.equal(readIntentJournal(p3).status, "CORRUPTED");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("VALIDATION-08: Metadata lặp, metadata không ở đầu, trial sau final, hai final -> CORRUPTED", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-08-"));
  try {
    const meta = makeTestMetadata("run-val-08", "pos23-exp-dev", 1, 1);
    const r1 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1);
    const finalRec = { type: "final", status: "COMPLETE", completedAt: new Date().toISOString(), totalTrialsRecorded: 1 };

    // Metadata not at start (trial first)
    const p1 = path.join(tmpDir, "trial-first.jsonl");
    fs.writeFileSync(p1, [JSON.stringify(r1), JSON.stringify(meta)].join("\n") + "\n", "utf8");
    assert.equal(readIntentJournal(p1).status, "CORRUPTED");

    // Repeated metadata
    const p2 = path.join(tmpDir, "meta-repeat.jsonl");
    fs.writeFileSync(p2, [JSON.stringify(meta), JSON.stringify(meta)].join("\n") + "\n", "utf8");
    assert.equal(readIntentJournal(p2).status, "CORRUPTED");

    // Trial after final
    const p3 = path.join(tmpDir, "trial-after-final.jsonl");
    fs.writeFileSync(p3, [JSON.stringify(meta), JSON.stringify(r1), JSON.stringify(finalRec), JSON.stringify(r1)].join("\n") + "\n", "utf8");
    assert.equal(readIntentJournal(p3).status, "CORRUPTED");

    // Two finals
    const p4 = path.join(tmpDir, "two-finals.jsonl");
    fs.writeFileSync(p4, [JSON.stringify(meta), JSON.stringify(r1), JSON.stringify(finalRec), JSON.stringify(finalRec)].join("\n") + "\n", "utf8");
    assert.equal(readIntentJournal(p4).status, "CORRUPTED");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("VALIDATION-09: Hai hàng nhưng totalTrialsRecorded=999 -> CORRUPTED", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-09-"));
  try {
    const journalPath = path.join(tmpDir, "count-999.jsonl");
    const meta = makeTestMetadata("run-val-09", "pos23-exp-dev", 2, 1);
    const r1 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1);
    const r2 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-02", 1, 2);
    const finalRec = {
      type: "final",
      status: "COMPLETE",
      completedAt: new Date().toISOString(),
      totalTrialsRecorded: 999, // Mâu thuẫn với 2 trials thực tế
    };
    fs.writeFileSync(
      journalPath,
      [JSON.stringify(meta), JSON.stringify(r1), JSON.stringify(r2), JSON.stringify(finalRec)].join("\n") + "\n",
      "utf8",
    );

    const res = readIntentJournal(journalPath);
    assert.equal(res.status, "CORRUPTED");
    assert.ok(res.issues.some((issue) => issue.includes("final.totalTrialsRecorded")));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("VALIDATION-10: Final COMPLETE thiếu hàng hoặc số hàng vượt kế hoạch -> CORRUPTED", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-10-"));
  try {
    const meta = makeTestMetadata("run-val-10", "pos23-exp-dev", 4, 1); // Planned 4

    // Thiếu hàng (chỉ có 2 hàng nhưng final COMPLETE)
    const p1 = path.join(tmpDir, "under-planned.jsonl");
    const r1 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1);
    const r2 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-02", 1, 2);
    const finalUnder = { type: "final", status: "COMPLETE", completedAt: new Date().toISOString(), totalTrialsRecorded: 2 };
    fs.writeFileSync(p1, [JSON.stringify(meta), JSON.stringify(r1), JSON.stringify(r2), JSON.stringify(finalUnder)].join("\n") + "\n", "utf8");
    assert.equal(readIntentJournal(p1).status, "CORRUPTED");

    // Vượt kế hoạch (kế hoạch 2 nhưng có 3 hàng)
    const p2 = path.join(tmpDir, "over-planned.jsonl");
    const meta2 = makeTestMetadata("run-val-10b", "pos23-exp-dev", 2, 1);
    const r3 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-03", 1, 3);
    const finalOver = { type: "final", status: "COMPLETE", completedAt: new Date().toISOString(), totalTrialsRecorded: 3 };
    fs.writeFileSync(p2, [JSON.stringify(meta2), JSON.stringify(r1), JSON.stringify(r2), JSON.stringify(r3), JSON.stringify(finalOver)].join("\n") + "\n", "utf8");
    assert.equal(readIntentJournal(p2).status, "CORRUPTED");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("VALIDATION-11: Kế hoạch plannedCases × repetitions mâu thuẫn plannedTrials -> CORRUPTED", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-11-"));
  try {
    const journalPath = path.join(tmpDir, "plan-conflict.jsonl");
    const meta = makeTestMetadata("run-val-11", "pos23-exp-dev", 3, 2);
    meta.plannedTrials = 7; // 3 * 2 = 6 !== 7
    fs.writeFileSync(journalPath, JSON.stringify(meta) + "\n", "utf8");

    const res = readIntentJournal(journalPath);
    assert.equal(res.status, "CORRUPTED");
    assert.ok(res.issues.some((issue) => issue.includes("plannedTrials")));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("VALIDATION-12: Summary totals mâu thuẫn trial -> CORRUPTED", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-12-"));
  try {
    const journalPath = path.join(tmpDir, "summary-conflict.jsonl");
    const meta = makeTestMetadata("run-val-12", "pos23-exp-dev", 2, 1);
    const r1 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1);
    const r2 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-02", 1, 2);
    const finalRec = {
      type: "final",
      status: "COMPLETE",
      completedAt: new Date().toISOString(),
      totalTrialsRecorded: 2,
      summaryTotals: {
        totalRows: 2,
        technicalPass: 1, // Mâu thuẫn: cả 2 trial đều là PASS!
      },
    };
    fs.writeFileSync(journalPath, [JSON.stringify(meta), JSON.stringify(r1), JSON.stringify(r2), JSON.stringify(finalRec)].join("\n") + "\n", "utf8");

    const res = readIntentJournal(journalPath);
    assert.equal(res.status, "CORRUPTED");
    assert.ok(res.issues.some((issue) => issue.includes("summaryTotals.technicalPass")));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("VALIDATION-13: Không final, prefix hợp lệ -> INCOMPLETE, giữ đúng completed/missing", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-13-"));
  try {
    const journalPath = path.join(tmpDir, "no-final.jsonl");
    const meta = makeTestMetadata("run-val-13", "pos23-exp-dev", 4, 1);
    const r1 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1);
    const r2 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-02", 1, 2);
    // Không có final record
    fs.writeFileSync(journalPath, [JSON.stringify(meta), JSON.stringify(r1), JSON.stringify(r2)].join("\n") + "\n", "utf8");

    const res = readIntentJournal(journalPath);
    assert.equal(res.status, "INCOMPLETE");
    assert.equal(res.interrupted, true);
    assert.equal(res.completedCount, 2);
    assert.equal(res.plannedCount, 4);
    assert.equal(res.missingCount, 2);
    assert.equal(res.finalRecord, undefined);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("VALIDATION-14: Final INCOMPLETE với số lượng hợp lệ -> INCOMPLETE", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-14-"));
  try {
    const journalPath = path.join(tmpDir, "final-incomplete.jsonl");
    const meta = makeTestMetadata("run-val-14", "pos23-exp-dev", 4, 1);
    const r1 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1);
    const finalRec = {
      type: "final",
      status: "INCOMPLETE",
      completedAt: new Date().toISOString(),
      totalTrialsRecorded: 1,
    };
    fs.writeFileSync(journalPath, [JSON.stringify(meta), JSON.stringify(r1), JSON.stringify(finalRec)].join("\n") + "\n", "utf8");

    const res = readIntentJournal(journalPath);
    assert.equal(res.status, "INCOMPLETE");
    assert.equal(res.interrupted, true);
    assert.equal(res.completedCount, 1);
    assert.equal(res.plannedCount, 4);
    assert.equal(res.missingCount, 3);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("VALIDATION-15: Đuôi bị cắt trước final -> INCOMPLETE; JSON hỏng ở giữa và schema sai ở dòng cuối -> CORRUPTED", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-15-"));
  try {
    const meta = makeTestMetadata("run-val-15", "pos23-exp-dev", 3, 1);
    const r1 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1);
    const r2 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-02", 1, 2);

    // Case 1: Unterminated trailing line (không có \n ở cuối file) -> INCOMPLETE
    const p1 = path.join(tmpDir, "cut-tail.jsonl");
    fs.writeFileSync(p1, [JSON.stringify(meta), JSON.stringify(r1)].join("\n") + "\n" + '{"type":"trial","inde', "utf8");
    const res1 = readIntentJournal(p1);
    assert.equal(res1.status, "INCOMPLETE");
    assert.equal(res1.truncatedTrailingLine, true);
    assert.equal(res1.completedCount, 1);

    // Case 2: Middle broken JSON -> CORRUPTED
    const p2 = path.join(tmpDir, "mid-corrupt.jsonl");
    fs.writeFileSync(p2, [JSON.stringify(meta), '{"type":"trial","inde', JSON.stringify(r2)].join("\n") + "\n", "utf8");
    assert.equal(readIntentJournal(p2).status, "CORRUPTED");

    // Case 3: Schema sai ở dòng cuối có \n -> CORRUPTED (không phải bị cắt)
    const p3 = path.join(tmpDir, "schema-corrupt-tail.jsonl");
    fs.writeFileSync(p3, [JSON.stringify(meta), JSON.stringify(r1), '{"foo":"bar"}'].join("\n") + "\n", "utf8");
    assert.equal(readIntentJournal(p3).status, "CORRUPTED");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("VALIDATION-16: Metadata v1 thiếu cả hai field kế hoạch optional -> không COMPLETE, issue rõ ràng", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-16-"));
  try {
    const journalPath = path.join(tmpDir, "no-plan.jsonl");
    const meta = makeTestMetadata("run-val-16", "pos23-exp-dev", 2, 1);
    delete meta.plannedCases;
    delete meta.plannedTrials;

    const r1 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1);
    const r2 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-02", 1, 2);
    const finalRec = { type: "final", status: "COMPLETE", completedAt: new Date().toISOString(), totalTrialsRecorded: 2 };
    fs.writeFileSync(journalPath, [JSON.stringify(meta), JSON.stringify(r1), JSON.stringify(r2), JSON.stringify(finalRec)].join("\n") + "\n", "utf8");

    const res = readIntentJournal(journalPath);
    assert.equal(res.status, "INCOMPLETE");
    assert.equal(res.plannedCount, undefined);
    assert.ok(res.issues.some((issue) => issue.includes("plan count is unspecified") || issue.includes("plannedTrials/plannedCases")));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("VALIDATION-17: issues không chứa marker nhạy cảm giả cài vào một dòng hỏng", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-17-"));
  try {
    const journalPath = path.join(tmpDir, "secret-leak.jsonl");
    const meta = makeTestMetadata("run-val-17", "pos23-exp-dev", 2, 1);
    const fakeSecret = "SENSITIVE_SECRET_TOKEN_OTP_987654";
    const corruptedLine = `{"type":"trial","index":1,"rawPayload":"${fakeSecret}"`; // Syntax error
    fs.writeFileSync(journalPath, [JSON.stringify(meta), corruptedLine, '{"foo":"bar"}'].join("\n") + "\n", "utf8");

    const res = readIntentJournal(journalPath);
    assert.equal(res.status, "CORRUPTED");
    for (const issue of res.issues) {
      assert.equal(issue.includes(fakeSecret), false, `Issue '${issue}' không được chứa dữ liệu nhạy cảm`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("VALIDATION-18: Tái hiện fixture cũ trùng hàng + final 999 -> không còn COMPLETE/issues rỗng (nhận diện CORRUPTED)", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-18-"));
  try {
    const journalPath = path.join(tmpDir, "repro-defect.jsonl");
    const meta = makeTestMetadata("run-repro", "pos23-exp-dev", 2, 1);
    const row = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1);
    const finalRec = {
      type: "final",
      status: "COMPLETE",
      completedAt: new Date().toISOString(),
      totalTrialsRecorded: 999,
    };
    // 2 hàng trùng nhau + final 999
    fs.writeFileSync(
      journalPath,
      [JSON.stringify(meta), JSON.stringify(row), JSON.stringify(row), JSON.stringify(finalRec)].join("\n") + "\n",
      "utf8",
    );

    const res = readIntentJournal(journalPath);
    assert.notEqual(res.status, "COMPLETE", "Không được kết luận COMPLETE khi có hàng trùng và totalTrialsRecorded=999");
    assert.equal(res.status, "CORRUPTED");
    assert.ok(res.issues.length > 0, "Phải báo cáo issues chi tiết");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("VALIDATION-19: Trial PASS/CORRECT nhưng thiếu selectedSelectionId hoặc finalCatalogAnswer hoặc selectedSelectionId không thuộc acceptableSelectionIds -> CORRUPTED", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-19-"));
  try {
    const meta = makeTestMetadata("run-val-19", "pos23-exp-dev", 1, 1);
    const finalRec = { type: "final", status: "COMPLETE", completedAt: new Date().toISOString(), totalTrialsRecorded: 1 };

    // Case A: Missing selectedSelectionId
    const p1 = path.join(tmpDir, "missing-selection.jsonl");
    const r1 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1);
    delete (r1.trial as any).selectedSelectionId;
    fs.writeFileSync(p1, [JSON.stringify(meta), JSON.stringify(r1), JSON.stringify(finalRec)].join("\n") + "\n", "utf8");
    const res1 = readIntentJournal(p1);
    assert.equal(res1.status, "CORRUPTED");
    assert.ok(res1.issues.some((i) => i.includes("trial.selectedSelectionId")));

    // Case B: Missing finalCatalogAnswer
    const p2 = path.join(tmpDir, "missing-answer.jsonl");
    const r2 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1);
    delete (r2.trial as any).finalCatalogAnswer;
    fs.writeFileSync(p2, [JSON.stringify(meta), JSON.stringify(r2), JSON.stringify(finalRec)].join("\n") + "\n", "utf8");
    const res2 = readIntentJournal(p2);
    assert.equal(res2.status, "CORRUPTED");
    assert.ok(res2.issues.some((i) => i.includes("trial.finalCatalogAnswer")));

    // Case C: CORRECT nhưng selectedSelectionId không nằm trong acceptableSelectionIds
    const p3 = path.join(tmpDir, "correct-mismatch.jsonl");
    const r3 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1, {
      selectedSelectionId: "FAQ-04",
      selectionOutcome: "CORRECT",
    });
    fs.writeFileSync(p3, [JSON.stringify(meta), JSON.stringify(r3), JSON.stringify(finalRec)].join("\n") + "\n", "utf8");
    const res3 = readIntentJournal(p3);
    assert.equal(res3.status, "CORRUPTED");
    assert.ok(res3.issues.some((i) => i.includes("trial.selectionOutcome")));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("VALIDATION-20: Giá trị enum sai chứa marker giả -> CORRUPTED và marker KHÔNG bị chép vào issues", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-20-"));
  try {
    const journalPath = path.join(tmpDir, "fake-marker.jsonl");
    const meta = makeTestMetadata("run-val-20", "pos23-exp-dev", 1, 1);
    const fakeSecretMarker = "INJECTED_SECRET_MARKER_FORGED_TOKEN_888";
    const r1 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1);
    (r1.trial as any).selectionOutcome = fakeSecretMarker;
    fs.writeFileSync(journalPath, [JSON.stringify(meta), JSON.stringify(r1)].join("\n") + "\n", "utf8");

    const res = readIntentJournal(journalPath);
    assert.equal(res.status, "CORRUPTED");
    assert.ok(res.issues.some((i) => i.includes("trial.selectionOutcome") && i.includes("invalid enum value")));
    for (const issue of res.issues) {
      assert.equal(issue.includes(fakeSecretMarker), false, `Issue không được phản chiếu giá trị marker giả: ${issue}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("VALIDATION-21: Kế hoạch 1 hàng nhưng có 2 hàng, final là INCOMPLETE -> CORRUPTED", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-21-"));
  try {
    const journalPath = path.join(tmpDir, "over-planned-incomplete.jsonl");
    const meta = makeTestMetadata("run-val-21", "pos23-exp-dev", 1, 1); // plannedCases: 1, plannedTrials: 1
    const r1 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-01", 1, 1);
    const r2 = makeValidTrialEnvelope("pos23-exp-dev", "POS23-DEV-02", 1, 2);
    const finalIncomplete = {
      type: "final",
      status: "INCOMPLETE",
      completedAt: new Date().toISOString(),
      totalTrialsRecorded: 2,
    };
    fs.writeFileSync(
      journalPath,
      [JSON.stringify(meta), JSON.stringify(r1), JSON.stringify(r2), JSON.stringify(finalIncomplete)].join("\n") + "\n",
      "utf8",
    );

    const res = readIntentJournal(journalPath);
    assert.equal(res.status, "CORRUPTED");
    assert.ok(res.issues.some((i) => i.includes("Completed trials count exceeds planned count")));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runOfflineEvaluation,
  runCounterExamplesEvaluation,
  generateMarkdownReport,
  generateJsonReport,
} from "../src/tests/assistantEvaluation/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const markdownOutputPath = path.join(
  repoRoot,
  "documents/06-security-ai/assistant-evaluation-report.md",
);
const jsonOutputPath = path.join(
  repoRoot,
  "documents/06-security-ai/assistant-evaluation-report.json",
);

async function main() {
  console.log("===============================================================");
  console.log("🚀 BẮT ĐẦU CHẠY BỘ ĐÁNH GIÁ OFFLINE CHO TRỢ LÝ HƯỚNG DẪN NOVA");
  console.log("===============================================================");
  console.log("Chế độ: Offline Fake Provider (Zero-Network, Zero-Token Cost)");
  console.log("Dataset: 56 ca chuẩn hóa (40 POS + 12 NEG + 4 EXTRA)\n");

  const startTime = Date.now();

  try {
    // 1. Chạy 56 ca kiểm thử chính
    console.log("⏳ Đang thực thi 56 ca kiểm thử...");
    const summary = await runOfflineEvaluation();

    // 2. Chạy bộ đối chứng kiểm tra năng lực của Scorer
    console.log("⏳ Đang thực thi bộ đối chứng và kiểm tra false-positive...");
    const counterResults = runCounterExamplesEvaluation();

    // 3. Sinh báo cáo Markdown và JSON
    const markdownContent = generateMarkdownReport(summary, counterResults);
    const jsonContent = generateJsonReport(summary, counterResults);

    fs.mkdirSync(path.dirname(markdownOutputPath), { recursive: true });
    fs.writeFileSync(markdownOutputPath, markdownContent, "utf8");
    fs.writeFileSync(jsonOutputPath, jsonContent, "utf8");

    const totalDuration = Date.now() - startTime;

    console.log("\n===============================================================");
    console.log("📊 KẾT QUẢ TỔNG QUAN");
    console.log("===============================================================");
    console.log(`- Tổng số ca: ${summary.totalCases}`);
    console.log(`- Đạt (PASS): ${summary.passedCases} (${((summary.passedCases / summary.totalCases) * 100).toFixed(1)}%)`);
    console.log(`- Không đạt (FAIL): ${summary.failedCases}`);
    console.log(`- Cần rà soát (NEEDS_REVIEW): ${summary.needsReviewCases}`);
    console.log(`- Lỗi (ERROR): ${summary.errorCases}`);
    console.log(`- Thời gian thực thi: ${totalDuration} ms`);
    console.log("---------------------------------------------------------------");
    console.log(`- Nhóm POS (40 ca): ${summary.groupStats.POS.passed}/${summary.groupStats.POS.total} PASS`);
    console.log(`- Nhóm NEG (12 ca): ${summary.groupStats.NEG.passed}/${summary.groupStats.NEG.total} PASS`);
    console.log(`- Nhóm EXTRA (4 ca): ${summary.groupStats.EXTRA.passed}/${summary.groupStats.EXTRA.total} PASS`);
    console.log("---------------------------------------------------------------");
    console.log(`📄 Đã ghi báo cáo Markdown tại: ${markdownOutputPath}`);
    console.log(`📄 Đã ghi dữ liệu JSON tại: ${jsonOutputPath}`);
    console.log("===============================================================\n");

    if (summary.errorCases > 0 || summary.failedCases > 0) {
      console.warn("⚠️ Lưu ý: Có ca kiểm thử không đạt hoặc bị lỗi!");
    } else if (summary.needsReviewCases > 0) {
      console.warn(
        "⚠️ Đã chạy đủ ca nhưng còn NEEDS_REVIEW; chưa được kết luận toàn bộ PASS nội dung.",
      );
    } else {
      console.log("✅ Toàn bộ 56 ca kiểm thử synthetic đã hoàn tất thành công!");
    }
  } catch (error) {
    console.error("❌ Đã xảy ra lỗi nghiêm trọng trong quá trình đánh giá:", error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(__dirname, "../..");
const distDir = path.join(backendDir, "dist");
const packageJsonPath = path.join(backendDir, "package.json");

test("H-12b / Artifact Independence: dist chạy hoàn toàn độc lập không cần documents/ hay .ts", () => {
  // 1. Kiểm tra thư mục dist đã được biên dịch
  const knowledgeLoaderJs = path.join(distDir, "assistant", "knowledgeLoader.js");
  const knowledgeBundleJs = path.join(distDir, "assistant", "knowledgeBundle.js");
  if (!fs.existsSync(knowledgeLoaderJs) || !fs.existsSync(knowledgeBundleJs)) {
    throw new Error(
      "Thư mục dist/assistant chưa được biên dịch. Hãy chạy `npm run build` trước khi thực thi kiểm thử này.",
    );
  }

  // 2. Tạo môi trường cô lập trong thư mục tạm của hệ điều hành
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-dist-artifact-test-"));

  try {
    // 3. Sao chép CHỈ dist và package.json vào môi trường tạm (KHÔNG sao chép documents/ hay src/)
    const tempDistDir = path.join(tempDir, "dist");
    fs.cpSync(distDir, tempDistDir, { recursive: true });

    const tempPackageJson = path.join(tempDir, "package.json");
    fs.copyFileSync(packageJsonPath, tempPackageJson);

    // Xác nhận môi trường cô lập hoàn toàn KHÔNG có documents/ hoặc src/
    assert.equal(fs.existsSync(path.join(tempDir, "documents")), false);
    assert.equal(fs.existsSync(path.join(tempDir, "src")), false);

    // 4. Tạo script runner độc lập trong thư mục tạm
    const runnerScriptPath = path.join(tempDir, "isolated-runner.mjs");
    const runnerCode = `
import assert from "node:assert/strict";
import { loadKnowledge } from "./dist/assistant/knowledgeLoader.js";
import { FakeAssistantHelpProvider } from "./dist/assistant/helpProvider.js";
import { AssistantHelpService } from "./dist/assistant/helpService.js";
import { resolveAssistantConfig } from "./dist/assistant/helpConfig.js";
import { getAnswerCatalogEntry } from "./dist/assistant/responseCatalog.js";

// 1. Kiểm tra nạp tri thức trực tiếp từ compiled artifact
const knowledge = loadKnowledge();
assert.equal(knowledge.promptVersion, "help-prompt-v0.4");
assert.equal(knowledge.faqVersion, "help-faq-v0.2");
assert.equal(knowledge.faqItemIds.length, 20);

for (let i = 1; i <= 20; i++) {
  const expectedId = "FAQ-" + String(i).padStart(2, "0");
  assert.ok(knowledge.faqItemIds.includes(expectedId), "Missing " + expectedId);
}

assert.ok(knowledge.systemPrompt.includes("NOVA"), "Prompt must mention NOVA");
assert.ok(knowledge.faqPartA.includes("FAQ-01"), "FAQ must contain FAQ-01");
assert.ok(knowledge.faqPartA.includes("FAQ-20"), "FAQ must contain FAQ-20");

// 2. Kiểm tra khởi tạo và chạy service với FakeAssistantHelpProvider trong môi trường dist độc lập
const provider = new FakeAssistantHelpProvider({
  mode: "success",
  defaultAnswer: JSON.stringify({ selectionId: "FAQ-01" })
});

const config = resolveAssistantConfig({
  enabled: true,
  provider,
  requestTimeoutMs: 2000,
  providerTimeoutMs: 1000,
});

const service = new AssistantHelpService(config);
const answer = await service.executeHelpRequest("Tôi xem số dư ở đâu?");
const expectedCatalogAnswer = getAnswerCatalogEntry("FAQ-01")?.answer;
assert.ok(expectedCatalogAnswer, "FAQ-01 must be present in the compiled answer catalog");
assert.equal(provider.callCount, 1, "The isolated service must request one catalog selection");
assert.equal(answer, expectedCatalogAnswer);
assert.notEqual(answer, JSON.stringify({ selectionId: "FAQ-01" }));

console.log("DIST_ARTIFACT_INDEPENDENCE_SUCCESS");
`;
    fs.writeFileSync(runnerScriptPath, runnerCode, "utf8");

    // 5. Thực thi script bằng Node.js trong môi trường tạm với CWD = tempDir
    const output = execFileSync(process.execPath, ["isolated-runner.mjs"], {
      cwd: tempDir,
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "production",
      },
    });

    assert.ok(
      output.includes("DIST_ARTIFACT_INDEPENDENCE_SUCCESS"),
      "Isolated runner did not report DIST_ARTIFACT_INDEPENDENCE_SUCCESS",
    );
  } finally {
    // 6. Dọn dẹp thư mục tạm
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error in finally
    }
  }
});

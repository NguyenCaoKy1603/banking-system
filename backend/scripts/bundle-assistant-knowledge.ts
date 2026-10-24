import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractSystemPrompt,
  extractFaqPartA,
  generateBundleContent,
  verifyBundleSynchronization,
} from "../src/assistant/knowledgeSync.js";

export {
  extractSystemPrompt,
  extractFaqPartA,
  generateBundleContent,
  verifyBundleSynchronization,
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const outputPath = path.join(repoRoot, "backend/src/assistant/knowledgeBundle.ts");

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const content = generateBundleContent();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, "utf8");
  console.log(`Knowledge bundle generated at ${outputPath}`);
}

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = process.cwd();
const allowedNames = new Set([
  "EXPO_PUBLIC_API_URL",
  "EXPO_PUBLIC_ENVIRONMENT_LABEL",
  "EXPO_PUBLIC_RELEASE_ID",
  "EXPO_PUBLIC_SANDBOX_HTTP",
]);
const forbiddenName = /(?:SECRET|TOKEN|PASSWORD|PRIVATE|ASSERTION|OTP|KEY)/;
const ignoredDirectories = new Set(["node_modules", ".expo", "coverage", ".git"]);
const textExtensions = new Set([
  ".cjs",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

function collectFiles(target) {
  const absolute = path.resolve(projectRoot, target);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [absolute];
  const files = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const child = path.join(absolute, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(path.relative(projectRoot, child)));
    else files.push(child);
  }
  return files;
}

function defaultTargets() {
  return [
    "src",
    "app.config.js",
    "app.json",
    ".env.example",
    ...(fs.existsSync(path.join(projectRoot, "dist")) ? ["dist"] : []),
    ...(fs.existsSync(path.join(projectRoot, "web-build")) ? ["web-build"] : []),
  ];
}

const targets = process.argv.slice(2).filter(Boolean);
const files = [...new Set((targets.length > 0 ? targets : defaultTargets()).flatMap(collectFiles))]
  .filter((file) => textExtensions.has(path.extname(file).toLowerCase()) || /\.(apk|aab)$/i.test(file));
const violations = [];
for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  for (const match of content.matchAll(/\bEXPO_PUBLIC_[A-Z0-9_]+\b/g)) {
    const name = match[0];
    if (!allowedNames.has(name) || forbiddenName.test(name.replace("EXPO_PUBLIC_", ""))) {
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      violations.push(`${path.relative(projectRoot, file)}:${line} uses forbidden public variable ${name}`);
    }
  }
}

if (violations.length > 0) {
  console.error("Forbidden EXPO_PUBLIC_* variables detected:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`Public environment surface valid: ${files.length} file(s) scanned.`);
}

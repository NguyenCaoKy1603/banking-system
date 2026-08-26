const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { arg, repoRoot, resolveBackupRoot } = require("./backup-common.cjs");

const forbidden = /(?:^|_)(?:password|secret|access_token|refresh_token|token|otp|totp|pin|cvv|database_url|databaseurl|signed_url|signedurl|private_key|privatekey|key_value)(?:$|_)/i;

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot }).toString("utf8").split("\0").filter(Boolean);
}

function scanObject(value, location, findings) {
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (forbidden.test(key)) findings.push(`${location}: forbidden field ${key}`);
    if (entry && typeof entry === "object") scanObject(entry, `${location}.${key}`, findings);
  }
}

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  };
  visit(root);
  return files;
}

function main() {
  const findings = [];
  for (const file of trackedFiles()) {
    if (/\.(?:dump|dump\.enc|sql\.enc|manifest\.json)$/i.test(file) || /(?:^|[\\/])(?:base-backup|wal-archive|restore-data)(?:[\\/]|$)/i.test(file)) findings.push(`${file}: backup artifact must not be tracked`);
  }
  const root = path.resolve(arg("backup-root", resolveBackupRoot()));
  for (const file of listFiles(root)) {
    if (/\.(?:dump|sql)$/i.test(file) || /(?:^|[\\/])restore-data(?:[\\/]|$)/i.test(file)) findings.push(`${path.relative(repoRoot, file)}: plaintext backup artifact is forbidden`);
    if (file.endsWith(".manifest.json")) {
      try {
        const value = JSON.parse(fs.readFileSync(file, "utf8"));
        scanObject(value, path.relative(repoRoot, file), findings);
        if (value.status === "COMPLETE" && value.sourceImageDigest === "unknown" && value.environment !== "preview" && value.environment !== "development" && value.environment !== "test") findings.push(`${file}: unknown image digest is only allowed for local preview environments`);
      } catch {
        findings.push(`${path.relative(repoRoot, file)}: invalid JSON manifest`);
      }
    }
  }
  if (findings.length > 0) {
    console.error("Backup surface validation failed:");
    for (const finding of [...new Set(findings)]) console.error(`- ${finding}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Backup surface valid: ${trackedFiles().length} tracked file(s) checked; backup root=${path.relative(repoRoot, root).replaceAll(path.sep, "/") || "."}.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "../..");
const ignoredPath = /(^|\\|\/)(node_modules|dist|coverage|\.git)(\\|\/)/;
const highConfidencePatterns = [
  { label: "private key material", pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "GitHub access token", pattern: /\b(?:ghp|gho|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { label: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { label: "Stripe live key", pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/ },
  { label: "forbidden public environment name", pattern: /\bEXPO_PUBLIC_(?:SECRET|TOKEN|PASSWORD|PRIVATE|ASSERTION|OTP|KEY)[A-Z0-9_]*\b/ },
];

function trackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot });
  return output.toString("utf8").split("\0").filter(Boolean);
}

function scanContent(file, content, findings) {
  for (const { label, pattern } of highConfidencePatterns) {
    if (pattern.test(content)) findings.push(`${file}: ${label}`);
  }
  if (/\.env(?:\.|$)/i.test(path.basename(file)) && !/(?:^|[\\/])\.env(?:\.compose)?\.example$/i.test(file)) {
    findings.push(`${file}: tracked environment file is not allowed`);
  }
  if (/Dockerfile(?:\.|$)/i.test(path.basename(file)) && /^\s*(?:ARG|ENV)\s+[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE|OTP|KEY)[A-Z0-9_]*\s*=/im.test(content)) {
    findings.push(`${file}: Docker ARG/ENV contains a secret-like variable name`);
  }
}

function scanTrackedFiles(findings) {
  for (const file of trackedFiles()) {
    if (ignoredPath.test(file)) continue;
    let content;
    try {
      content = fs.readFileSync(path.join(repoRoot, file), "utf8");
    } catch {
      continue;
    }
    scanContent(file, content, findings);
  }
}

function scanHistory(findings) {
  let patch;
  try {
    patch = execFileSync("git", ["log", "--all", "--pretty=format:", "-p", "--no-ext-diff", "--binary"], {
      cwd: repoRoot,
      maxBuffer: 64 * 1024 * 1024,
    }).toString("utf8");
  } catch (error) {
    throw new Error(`Unable to scan Git history: ${error instanceof Error ? error.message : String(error)}`);
  }
  const historyFindings = [];
  // Historical references to a deprecated public configuration name are not
  // secret values. Current tracked files are scanned for those names above;
  // history scanning focuses on high-confidence credential material.
  scanContent("<git-history>", patch.replace(/\bEXPO_PUBLIC_(?:SECRET|TOKEN|PASSWORD|PRIVATE|ASSERTION|OTP|KEY)[A-Z0-9_]*\b/g, ""), historyFindings);
  findings.push(...historyFindings.map((finding) => `${finding} (history)`));
}

function scanArtifacts(findings, targets) {
  for (const target of targets) {
    const absolute = path.resolve(repoRoot, target);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    scanContent(target, fs.readFileSync(absolute, "utf8"), findings);
  }
}

const findings = [];
scanTrackedFiles(findings);
if (process.argv.includes("--history")) scanHistory(findings);
const artifactIndex = process.argv.indexOf("--artifact");
if (artifactIndex >= 0) scanArtifacts(findings, process.argv.slice(artifactIndex + 1).filter((value) => value !== "--history"));

if (findings.length > 0) {
  console.error("Secret surface validation failed:");
  for (const finding of [...new Set(findings)]) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Secret surface valid: ${trackedFiles().length} tracked file(s) scanned.`);
}

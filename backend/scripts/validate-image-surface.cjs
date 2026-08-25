const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const inlineImage = process.argv.find((value) => value.startsWith("--image="));
const imageFlagIndex = process.argv.indexOf("--image");
const image = inlineImage?.slice("--image=".length) || (imageFlagIndex >= 0 ? process.argv[imageFlagIndex + 1] : undefined);
if (!image?.trim()) {
  console.error("Usage: node scripts/validate-image-surface.cjs --image=<local-or-registry-image>");
  process.exit(2);
}

const findings = [];
const root = fs.mkdtempSync(path.join(os.tmpdir(), "banking-image-scan-"));
const archive = path.join(root, "image.tar");
const extracted = path.join(root, "layers");
fs.mkdirSync(extracted);
try {
  const inspect = JSON.parse(execFileSync("docker", ["image", "inspect", image], { encoding: "utf8" }))[0];
  const labels = inspect?.Config?.Labels ?? {};
  if (!labels["org.opencontainers.image.revision"]) findings.push("image is missing org.opencontainers.image.revision");
  if (!labels["org.opencontainers.image.version"]) findings.push("image is missing org.opencontainers.image.version");
  execFileSync("docker", ["save", "--output", archive, image], { stdio: "ignore" });
  execFileSync("tar", ["-xf", archive, "-C", extracted], { stdio: "ignore" });
  const forbiddenNames = /(^|[\\/])\.env(?:\.|$)|(?:id_rsa|id_ed25519|\.pem$|\.key$)/i;
  const forbiddenContent = [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
    /\b(?:ghp|gho|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
    /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/,
  ];
  const stack = [extracted];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      const relative = path.relative(extracted, file);
      if (entry.isDirectory()) {
        if (!new Set([".git", "proc", "sys", "dev"]).has(entry.name)) stack.push(file);
        continue;
      }
      if (forbiddenNames.test(relative)) findings.push(`${relative}: forbidden secret-like image artifact name`);
      const stat = fs.statSync(file);
      if (stat.size > 2 * 1024 * 1024) continue;
      let content;
      try { content = fs.readFileSync(file, "utf8"); } catch { continue; }
      for (const pattern of forbiddenContent) if (pattern.test(content)) findings.push(`${relative}: high-confidence credential material`);
    }
  }
} catch (error) {
  findings.push(error instanceof Error ? error.message : String(error));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

if (findings.length > 0) {
  console.error("Container image secret-surface validation failed:");
  for (const finding of [...new Set(findings)]) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Container image secret surface valid: ${image}`);
}

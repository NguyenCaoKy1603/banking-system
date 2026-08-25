const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "../..");

function arg(name, fallback = undefined) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim();
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function readDotEnv(filePath) {
  const values = {};
  if (!filePath || !fs.existsSync(filePath)) return values;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value.replace(/\\n/g, "\n");
  }
  return values;
}

function resolveComposeEnvFile() {
  return path.resolve(arg("compose-env", path.join(repoRoot, ".env.compose")));
}

function resolveBackupRoot() {
  const root = path.resolve(arg("backup-root", path.join(repoRoot, "artifacts", "backups")));
  if (root === path.parse(root).root || root === repoRoot || root.includes(`${path.sep}.git${path.sep}`)) {
    throw new Error("Backup root is too broad; choose a dedicated artifacts/backups directory.");
  }
  return root;
}

function assertAllowedEnvironment(environment) {
  const normalized = String(environment ?? "").trim().toLowerCase();
  if (!["development", "test", "preview"].includes(normalized)) {
    throw new Error("Local backup tooling only accepts development, test or preview; managed staging/production-like backup must be configured separately.");
  }
  return normalized;
}

function gitValue(...args) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function migrationFingerprint() {
  try {
    return JSON.parse(execFileSync(process.execPath, [path.join(__dirname, "migration-fingerprint.cjs")], { cwd: repoRoot, encoding: "utf8" }));
  } catch (error) {
    throw new Error(`Unable to calculate migration fingerprint: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function spawnResult(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({
      code: code ?? 1,
      signal,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
    }));
    if (options.input) {
      child.stdin.end(options.input);
    }
  });
}

function composeArgs(envFile, service, commandArgs) {
  return ["compose", "--env-file", envFile, "exec", "-T", service, ...commandArgs];
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function writeJsonExclusive(filePath, value) {
  const temporary = `${filePath}.part-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  try {
    fs.renameSync(temporary, filePath);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

module.exports = {
  arg,
  assertAllowedEnvironment,
  composeArgs,
  ensureDirectory,
  gitValue,
  hasFlag,
  migrationFingerprint,
  readDotEnv,
  repoRoot,
  resolveBackupRoot,
  resolveComposeEnvFile,
  sha256File,
  spawn,
  spawnResult,
  writeJsonExclusive,
};

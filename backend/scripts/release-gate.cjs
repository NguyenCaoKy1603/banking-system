const { execFileSync } = require("node:child_process");
const { readdirSync, readFileSync } = require("node:fs");
const path = require("node:path");

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", cwd: path.resolve(__dirname, "../..") }).trim();
}

const root = path.resolve(__dirname, "../..");
const status = git("status", "--porcelain");
const commit = git("rev-parse", "HEAD");
const trackedFiles = new Set(git("ls-files", "backend/database").split(/\r?\n/).filter(Boolean));
const migrationDirectory = path.join(root, "backend", "database");
const migrations = readdirSync(migrationDirectory).filter((fileName) => /^\d+_.+\.sql$/i.test(fileName));
const untrackedMigrations = migrations
  .map((fileName) => `backend/database/${fileName}`)
  .filter((fileName) => !trackedFiles.has(fileName));
const result = {
  promotionAllowed: status.length === 0 && untrackedMigrations.length === 0 && /^[0-9a-f]{40}$/i.test(commit),
  sourceCommit: commit,
  sourceTree: status.length === 0 ? "clean" : "dirty",
  changedFiles: status ? status.split(/\r?\n/).filter(Boolean).length : 0,
  untrackedMigrations,
  migrationCount: migrations.length,
  checks: {
    gitCommitIsFullSha: /^[0-9a-f]{40}$/i.test(commit),
    worktreeClean: status.length === 0,
    migrationsTracked: untrackedMigrations.length === 0,
    secretsNotRead: true,
  },
};
console.log(JSON.stringify(result, null, 2));
if (!result.promotionAllowed) process.exitCode = 1;

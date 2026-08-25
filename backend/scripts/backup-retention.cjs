const fs = require("node:fs");
const path = require("node:path");

const { arg, hasFlag, resolveBackupRoot } = require("./backup-common.cjs");

function listManifests(root) {
  const result = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".manifest.json")) result.push(fullPath);
    }
  }
  visit(root);
  return result;
}

function safeObject(manifestPath, manifest) {
  const objectName = String(manifest.backupObject ?? "");
  if (objectName !== path.basename(objectName) || !/^logical-backup-[0-9a-f-]{36}\.dump\.enc$/i.test(objectName)) throw new Error(`Unsafe backup object in ${manifestPath}.`);
  const objectPath = path.join(path.dirname(manifestPath), objectName);
  if (!objectPath.startsWith(`${path.resolve(path.dirname(manifestPath))}${path.sep}`)) throw new Error(`Backup object escapes its manifest directory: ${manifestPath}.`);
  return objectPath;
}

function main() {
  const root = resolveBackupRoot();
  if (!fs.existsSync(root)) {
    process.stdout.write(`${JSON.stringify({ status: "EMPTY", root }, null, 2)}\n`);
    return;
  }
  const retentionDays = Number(arg("retention-days", "14"));
  if (!Number.isInteger(retentionDays) || retentionDays <= 0 || retentionDays > 3650) throw new Error("retention-days must be a positive integer no greater than 3650.");
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const entries = listManifests(root).map((manifestPath) => {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch { throw new Error(`Invalid backup manifest: ${manifestPath}.`); }
    if (!["development", "test", "preview"].includes(String(manifest.environment ?? "").toLowerCase())) throw new Error(`Retention refuses an unmanaged environment in ${manifestPath}.`);
    if (manifest.status !== "COMPLETE") return { manifestPath, manifest, objectPath: null, eligible: false, reason: "not-complete" };
    const objectPath = safeObject(manifestPath, manifest);
    const completedAt = Date.parse(manifest.completedAt ?? "");
    return { manifestPath, manifest, objectPath, completedAt, eligible: Number.isFinite(completedAt) && completedAt < cutoff, reason: Number.isFinite(completedAt) && completedAt < cutoff ? "expired" : "fresh" };
  });
  const complete = entries.filter((entry) => entry.manifest.status === "COMPLETE" && Number.isFinite(entry.completedAt));
  const latestByScope = new Set();
  const latestBackupIds = new Set();
  for (const entry of complete.sort((left, right) => right.completedAt - left.completedAt)) {
    const scope = `${entry.manifest.environment}:${entry.manifest.backupType}`;
    if (!latestByScope.has(scope)) {
      latestByScope.add(scope);
      latestBackupIds.add(entry.manifest.backupId);
    }
  }
  const candidates = entries.filter((entry) => entry.eligible && !latestBackupIds.has(entry.manifest.backupId));
  const apply = hasFlag("apply");
  const actions = [];
  for (const entry of candidates) {
    const files = [entry.manifestPath, entry.objectPath];
    if (apply) {
      for (const file of files) {
        if (file && fs.existsSync(file)) fs.rmSync(file, { force: false });
      }
    }
    actions.push({
      backupId: entry.manifest.backupId,
      status: apply ? "DELETED" : "DRY_RUN",
      files: files.map((file) => file && path.relative(root, file).replaceAll(path.sep, "/")),
    });
  }
  process.stdout.write(`${JSON.stringify({ status: apply ? "APPLIED" : "DRY_RUN", root, retentionDays, candidates: actions, protectedLatestScopes: [...latestByScope] }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

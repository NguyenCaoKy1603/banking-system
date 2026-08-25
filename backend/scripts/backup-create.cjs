const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const {
  arg,
  assertAllowedEnvironment,
  composeArgs,
  ensureDirectory,
  gitValue,
  migrationFingerprint,
  readDotEnv,
  repoRoot,
  resolveBackupRoot,
  resolveComposeEnvFile,
  sha256File,
  writeJsonExclusive,
} = require("./backup-common.cjs");

function jsonOutput(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim();
}

function databaseSettings(composeValues) {
  const databaseUrl = firstNonEmpty(process.env.DATABASE_URL, composeValues.DATABASE_URL);
  let parsed;
  if (databaseUrl) {
    try { parsed = new URL(databaseUrl); } catch { parsed = undefined; }
  }
  const user = firstNonEmpty(arg("db-user"), process.env.POSTGRES_USER, composeValues.POSTGRES_USER, parsed?.username, "postgres");
  const name = firstNonEmpty(arg("db-name"), process.env.POSTGRES_DB, composeValues.POSTGRES_DB, parsed?.pathname?.replace(/^\//, ""), "postgres");
  return { databaseUrl, user, name };
}

function commandFor(driver, kind, settings, composeEnvFile, service) {
  const binary = arg(kind === "dump" ? "pg-dump-bin" : "psql-bin", kind === "dump" ? "pg_dump" : "psql");
  if (driver === "docker") {
    const command = kind === "dump"
      ? ["pg_dump", "--format=custom", "--no-owner", "--no-privileges", "-U", settings.user, "-d", settings.name]
      : [binary, "-U", settings.user, "-d", settings.name];
    return { command: "docker", args: composeArgs(composeEnvFile, service, command) };
  }
  if (!settings.databaseUrl) throw new Error("DATABASE_URL is required for the local pg_dump driver.");
  const args = kind === "dump"
    ? ["--format=custom", "--no-owner", "--no-privileges", "--dbname", settings.databaseUrl]
    : ["--dbname", settings.databaseUrl];
  return { command: binary, args };
}

async function runQuery(driver, sql, settings, composeEnvFile, service) {
  const selected = commandFor(driver, "query", settings, composeEnvFile, service);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(selected.command, [...selected.args, "-Atqc", sql], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(stdout) }));
  });
  if (result.code !== 0) throw new Error("Database metadata query failed; inspect the database connection without printing its details.");
  return result.stdout.toString("utf8").trim();
}

function runDumpAndEncrypt({ driver, settings, composeEnvFile, service, output, metadataPath, metadataArgs, encryptionKey }) {
  return new Promise((resolve, reject) => {
    const dump = commandFor(driver, "dump", settings, composeEnvFile, service);
    const dumpProcess = spawn(dump.command, dump.args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const encryptArgs = [
      path.join(repoRoot, "backend", "scripts", "encrypted-backup.cjs"),
      "--encrypt",
      "--input=-",
      `--output=${output}`,
      `--metadata=${metadataPath}`,
      ...Object.entries(metadataArgs).map(([key, value]) => `--${key}=${value ?? ""}`),
    ];
    const encryptProcess = spawn(process.execPath, encryptArgs, {
      cwd: repoRoot,
      env: { ...process.env, BACKUP_ENCRYPTION_KEY: encryptionKey },
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    let dumpError = "";
    let encryptError = "";
    dumpProcess.stderr.on("data", (chunk) => { dumpError += chunk.toString("utf8"); });
    encryptProcess.stderr.on("data", (chunk) => { encryptError += chunk.toString("utf8"); });
    dumpProcess.stdout.pipe(encryptProcess.stdin);
    let settled = false;
    const fail = (message) => {
      if (settled) return;
      settled = true;
      dumpProcess.kill();
      encryptProcess.kill();
      reject(new Error(message));
    };
    dumpProcess.on("error", (error) => fail(`pg_dump could not start: ${error.message}`));
    encryptProcess.on("error", (error) => fail(`backup encryption could not start: ${error.message}`));
    dumpProcess.on("close", (code) => {
      if (code !== 0) {
        encryptProcess.stdin.destroy();
        fail(`pg_dump failed with exit code ${code}${dumpError ? ` (${dumpError.trim().slice(0, 240)})` : ""}.`);
      }
    });
    encryptProcess.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        fail(`backup encryption failed with exit code ${code}${encryptError ? ` (${encryptError.trim().slice(0, 240)})` : ""}.`);
        return;
      }
      settled = true;
      resolve();
    });
  });
}

async function main() {
  const environment = assertAllowedEnvironment(firstNonEmpty(arg("environment"), process.env.BANKING_ENV, "preview"));
  const driver = firstNonEmpty(arg("driver"), process.env.BACKUP_DRIVER, "local").toLowerCase();
  if (!["local", "docker"].includes(driver)) throw new Error("--driver must be local or docker.");
  const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY?.trim();
  if (!encryptionKey) throw new Error("BACKUP_ENCRYPTION_KEY is required; provide it from the caller's secret store and never print it.");

  const backupRoot = resolveBackupRoot();
  ensureDirectory(backupRoot);
  const lockPath = path.join(backupRoot, ".backup.lock");
  try {
    fs.writeFileSync(lockPath, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), environment })}\n`, { flag: "wx" });
  } catch {
    throw new Error("Another backup job owns the backup lock; the new job was skipped without deleting the last good backup.");
  }

  let encryptedPath;
  let metadataPath;
  try {
    const composeEnvFile = resolveComposeEnvFile();
    const composeValues = readDotEnv(composeEnvFile);
    const settings = databaseSettings(composeValues);
    const service = firstNonEmpty(arg("postgres-service"), process.env.BACKUP_POSTGRES_SERVICE, "postgres");
    const migration = migrationFingerprint();
    const sourceCommitSha = firstNonEmpty(process.env.BUILD_COMMIT_SHA, gitValue("rev-parse", "HEAD"), "unknown");
    const sourceTree = gitValue("status", "--porcelain=v1") ? "dirty" : "clean";
    const sourceReleaseId = firstNonEmpty(arg("release-id"), process.env.RELEASE_ID, "local");
    const sourceImageDigest = firstNonEmpty(process.env.IMAGE_DIGEST, "unknown");
    const startedAt = new Date();
    const backupId = `backup-${crypto.randomUUID()}`;
    const postgresMajor = await runQuery(driver, "SELECT (current_setting('server_version_num')::int / 10000)::text", settings, composeEnvFile, service);
    const startLsn = await runQuery(driver, "SELECT pg_current_wal_lsn()::text", settings, composeEnvFile, service);
    const countsJson = await runQuery(driver, `SELECT json_build_object(
      'customers', (SELECT COUNT(*) FROM customers),
      'payment_accounts', (SELECT COUNT(*) FROM payment_accounts),
      'transfers', (SELECT COUNT(*) FROM transfers),
      'account_transactions', (SELECT COUNT(*) FROM account_transactions),
      'ledger_journals', (SELECT COUNT(*) FROM ledger_journals),
      'ledger_entries', (SELECT COUNT(*) FROM ledger_entries),
      'outbox_events', (SELECT COUNT(*) FROM outbox_events),
      'auth_sessions', (SELECT COUNT(*) FROM auth_sessions),
      'auth_challenges', (SELECT COUNT(*) FROM auth_challenges),
      'mfa_credentials', (SELECT COUNT(*) FROM mfa_credentials),
      'audit_events', (SELECT COUNT(*) FROM audit_events),
      'savings_deposits', (SELECT COUNT(*) FROM savings_deposits),
      'credit_accounts', (SELECT COUNT(*) FROM credit_accounts),
      'staff_users', (SELECT COUNT(*) FROM staff_users)
    )::text`, settings, composeEnvFile, service);
    const sourceCounts = JSON.parse(countsJson);
    const datePath = path.join(environment, String(postgresMajor), String(startedAt.getUTCFullYear()), String(startedAt.getUTCMonth() + 1).padStart(2, "0"), String(startedAt.getUTCDate()).padStart(2, "0"));
    const outputDirectory = path.join(backupRoot, datePath);
    ensureDirectory(outputDirectory);
    encryptedPath = path.join(outputDirectory, `logical-${backupId}.dump.enc`);
    metadataPath = path.join(outputDirectory, `logical-${backupId}.metadata.json`);
    const metadataArgs = {
      "format-version": 2,
      "backup-id": backupId,
      "backup-type": "LOGICAL",
      environment,
      "postgres-major": postgresMajor,
      "schema-version": migration.schemaVersion,
      "migration-set-digest": migration.migrationSetDigest,
      "source-release-id": sourceReleaseId,
      "source-commit-sha": sourceCommitSha,
      "source-image-digest": sourceImageDigest,
      "start-lsn": startLsn,
      "key-id": firstNonEmpty(process.env.BACKUP_ENCRYPTION_KEY_ID, "backup-local-v1"),
    };
    await runDumpAndEncrypt({ driver, settings, composeEnvFile, service, output: encryptedPath, metadataPath, metadataArgs, encryptionKey });
    const endLsn = await runQuery(driver, "SELECT pg_current_wal_lsn()::text", settings, composeEnvFile, service);
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    const stats = fs.statSync(encryptedPath);
    const completedAt = new Date();
    const retentionDays = Number(arg("retention-days", "14"));
    if (!Number.isInteger(retentionDays) || retentionDays <= 0 || retentionDays > 3650) throw new Error("retention-days must be a positive integer no greater than 3650.");
    const manifest = {
      formatVersion: 2,
      backupId,
      environment,
      backupType: "LOGICAL",
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      sourceReleaseId,
      sourceCommitSha,
      sourceTree,
      sourceImageDigest,
      schemaVersion: migration.schemaVersion,
      migrationSetDigest: migration.migrationSetDigest,
      postgresMajor: Number(postgresMajor),
      backupObject: path.basename(encryptedPath),
      encryptedSizeBytes: stats.size,
      plaintextChecksum: metadata.checksum,
      ciphertextChecksum: sha256File(encryptedPath),
      encryptionKeyId: metadata.keyId,
      startLsn,
      endLsn,
      retentionUntil: new Date(completedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000).toISOString(),
      sourceCounts,
      status: "COMPLETE",
    };
    const manifestPath = encryptedPath.replace(/\.dump\.enc$/i, ".manifest.json");
    writeJsonExclusive(manifestPath, manifest);
    fs.rmSync(metadataPath, { force: true });
    metadataPath = undefined;
    jsonOutput({
      status: "COMPLETE",
      backupId,
      manifest: path.relative(repoRoot, manifestPath).replaceAll(path.sep, "/"),
      encryptedBytes: stats.size,
      environment,
      schemaVersion: migration.schemaVersion,
      migrationSetDigest: migration.migrationSetDigest,
      imageDigest: sourceImageDigest,
    });
  } catch (error) {
    if (encryptedPath) fs.rmSync(encryptedPath, { force: true });
    if (metadataPath) fs.rmSync(metadataPath, { force: true });
    throw error;
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

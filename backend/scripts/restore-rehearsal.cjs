const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");

const {
  arg,
  composeArgs,
  ensureDirectory,
  migrationFingerprint,
  readDotEnv,
  repoRoot,
  resolveComposeEnvFile,
  spawnResult,
  writeJsonExclusive,
} = require("./backup-common.cjs");
const { migrationChecksum, rawMigrationChecksum } = require("./migration-content.cjs");
const { readManifest } = require("./backup-verify.cjs");

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim();
}

function databaseSettings(composeValues) {
  const databaseUrl = firstNonEmpty(process.env.DATABASE_URL, composeValues.DATABASE_URL);
  let parsed;
  if (databaseUrl) {
    try { parsed = new URL(databaseUrl); } catch { parsed = undefined; }
  }
  return {
    databaseUrl,
    user: firstNonEmpty(arg("db-user"), process.env.POSTGRES_USER, composeValues.POSTGRES_USER, parsed?.username, "postgres"),
    name: firstNonEmpty(arg("source-db"), process.env.POSTGRES_DB, composeValues.POSTGRES_DB, parsed?.pathname?.replace(/^\//, ""), "postgres"),
  };
}

function localDatabaseUrl(settings, databaseName) {
  if (!settings.databaseUrl) throw new Error("DATABASE_URL is required for the local restore driver.");
  const parsed = new URL(settings.databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function databaseCommand(driver, action, settings, targetName, composeEnvFile, service) {
  const command = driver === "docker" ? "docker" : action === "restore" ? arg("pg-restore-bin", "pg_restore") : action === "drop" ? arg("dropdb-bin", "dropdb") : "psql";
  if (driver === "docker") {
    if (action === "restore") return { command, args: composeArgs(composeEnvFile, service, ["pg_restore", "-U", settings.user, "-d", targetName, "--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges"]) };
    if (action === "drop") return { command, args: composeArgs(composeEnvFile, service, ["dropdb", "--if-exists", "-U", settings.user, targetName]) };
    return { command, args: composeArgs(composeEnvFile, service, ["psql", "-U", settings.user, "-d", targetName ?? settings.name, "-Atqc"]) };
  }
  if (action === "restore") return { command, args: ["--dbname", localDatabaseUrl(settings, targetName), "--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges"] };
  if (action === "drop") return { command, args: ["--if-exists", "--dbname", settings.databaseUrl, targetName] };
  return { command, args: ["--dbname", localDatabaseUrl(settings, targetName ?? settings.name), "-Atqc"] };
}

async function runSql(driver, sql, settings, targetName, composeEnvFile, service) {
  if (driver === "docker") {
    const result = await spawnResult("docker", [...composeArgs(composeEnvFile, service, ["psql", "-U", settings.user, "-d", targetName ?? settings.name, "-Atqc", sql])]);
    if (result.code !== 0) throw new Error("Restore validation query failed.");
    return result.stdout.toString("utf8").trim();
  }
  const result = await spawnResult(arg("psql-bin", "psql"), ["--dbname", localDatabaseUrl(settings, targetName ?? settings.name), "-Atqc", sql]);
  if (result.code !== 0) throw new Error("Restore validation query failed.");
  return result.stdout.toString("utf8").trim();
}

async function runSqlOnSource(driver, sql, settings, composeEnvFile, service) {
  if (driver === "docker") {
    const result = await spawnResult("docker", [...composeArgs(composeEnvFile, service, ["psql", "-U", settings.user, "-d", settings.name, "-Atqc", sql])]);
    if (result.code !== 0) throw new Error("Source database command failed.");
    return result.stdout.toString("utf8").trim();
  }
  if (!settings.databaseUrl) throw new Error("DATABASE_URL is required for the local restore driver.");
  const result = await spawnResult(arg("psql-bin", "psql"), ["--dbname", settings.databaseUrl, "-Atqc", sql]);
  if (result.code !== 0) throw new Error("Source database command failed.");
  return result.stdout.toString("utf8").trim();
}

async function createDatabase(driver, targetName, settings, composeEnvFile, service) {
  if (targetName === settings.name) throw new Error("Restore target must be a new database, never the source database.");
  const sql = `CREATE DATABASE "${targetName.replaceAll('"', '""')}"`;
  await runSqlOnSource(driver, sql, settings, composeEnvFile, service);
}

async function dropDatabase(driver, targetName, settings, composeEnvFile, service) {
  if (!/^restore_[a-z0-9_]{1,50}$/.test(targetName)) throw new Error("Refusing to drop a target that does not use the restore_ safety prefix.");
  const selected = databaseCommand(driver, "drop", settings, targetName, composeEnvFile, service);
  const result = await spawnResult(selected.command, selected.args);
  if (result.code !== 0) throw new Error("Restore target cleanup failed; inspect the target manually before retrying.");
}

function migrationChecksums() {
  const directory = path.join(repoRoot, "backend", "database");
  const files = fs.readdirSync(directory).filter((fileName) => /^\d+_.+\.sql$/i.test(fileName)).sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  return files.map((fileName) => {
    const sql = fs.readFileSync(path.join(directory, fileName), "utf8");
    return {
      migrationKey: fileName.replace(/\.sql$/i, ""),
      checksum: migrationChecksum(sql),
      legacyChecksum: rawMigrationChecksum(sql),
    };
  });
}

async function validateTarget(driver, targetName, settings, composeEnvFile, service, manifest) {
  const migrationRows = JSON.parse(await runSql(driver, "SELECT COALESCE(json_agg(json_build_object('migrationKey', migration_key, 'checksum', checksum, 'status', status) ORDER BY migration_key), '[]'::json)::text FROM reference_schema_migrations", settings, targetName, composeEnvFile, service));
  const expected = migrationChecksums();
  if (migrationRows.length !== expected.length || migrationRows.some((row, index) => row.migrationKey !== expected[index].migrationKey || (row.checksum !== expected[index].checksum && row.checksum !== expected[index].legacyChecksum) || row.status !== "APPLIED")) {
    throw new Error("Restored migration checksums do not match the current source tree.");
  }
  const fingerprint = migrationFingerprint();
  if (manifest.migrationSetDigest !== fingerprint.migrationSetDigest) throw new Error("Backup migration digest is not the current source-tree digest.");
  const counts = JSON.parse(await runSql(driver, `SELECT json_build_object(
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
  )::text`, settings, targetName, composeEnvFile, service));
  for (const [key, expectedCount] of Object.entries(manifest.sourceCounts ?? {})) {
    if (String(counts[key]) !== String(expectedCount)) throw new Error(`Restored count mismatch for ${key}.`);
  }
  const ledger = JSON.parse(await runSql(driver, `SELECT json_build_object(
    'debitMinor', COALESCE(SUM(CASE WHEN side = 'DEBIT' THEN amount_minor ELSE 0 END), 0)::text,
    'creditMinor', COALESCE(SUM(CASE WHEN side = 'CREDIT' THEN amount_minor ELSE 0 END), 0)::text
  )::text FROM ledger_entries`, settings, targetName, composeEnvFile, service));
  if (ledger.debitMinor !== ledger.creditMinor) throw new Error("Restored ledger is not balanced.");
  const orphans = await runSql(driver, `SELECT (
    (SELECT COUNT(*) FROM account_transactions t LEFT JOIN payment_accounts a ON a.id = t.account_id WHERE a.id IS NULL) +
    (SELECT COUNT(*) FROM transfers t LEFT JOIN customers c ON c.id = t.customer_id WHERE c.id IS NULL)
  )::text`, settings, targetName, composeEnvFile, service);
  if (Number(orphans) !== 0) throw new Error("Restored database contains orphan business references.");
  return { migrationRows: migrationRows.length, counts, ledger, orphanReferences: Number(orphans) };
}

function decryptToRestore(driver, targetName, settings, composeEnvFile, service, backupPath) {
  return new Promise((resolve, reject) => {
    const selected = databaseCommand(driver, "restore", settings, targetName, composeEnvFile, service);
    const decrypt = spawn(process.execPath, [path.join(repoRoot, "backend", "scripts", "encrypted-backup.cjs"), "--decrypt", `--input=${backupPath}`, "--output=-"], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const restore = spawn(selected.command, selected.args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    let decryptError = "";
    let restoreError = "";
    decrypt.stderr.on("data", (chunk) => { decryptError += chunk.toString("utf8"); });
    restore.stderr.on("data", (chunk) => { restoreError += chunk.toString("utf8"); });
    decrypt.stdout.pipe(restore.stdin);
    let settled = false;
    const fail = (message) => {
      if (settled) return;
      settled = true;
      decrypt.kill();
      restore.kill();
      reject(new Error(message));
    };
    decrypt.on("error", (error) => fail(`Decrypt process could not start: ${error.message}`));
    restore.on("error", (error) => fail(`pg_restore could not start: ${error.message}`));
    decrypt.on("close", (code) => {
      if (code !== 0) {
        restore.stdin.destroy();
        fail(`Encrypted backup decrypt failed with exit code ${code}${decryptError ? ` (${decryptError.trim().slice(0, 240)})` : ""}.`);
      }
    });
    restore.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        fail(`pg_restore failed with exit code ${code}${restoreError ? ` (${restoreError.trim().slice(0, 240)})` : ""}.`);
        return;
      }
      settled = true;
      resolve();
    });
  });
}

async function main() {
  const manifestPath = arg("manifest");
  if (!manifestPath) throw new Error("--manifest=<path> is required.");
  const { manifest, backupPath } = readManifest(manifestPath);
  if (!process.env.BACKUP_ENCRYPTION_KEY?.trim()) throw new Error("BACKUP_ENCRYPTION_KEY is required for restore and is never printed.");
  execFileSync(process.execPath, [path.join(repoRoot, "backend", "scripts", "backup-verify.cjs"), `--manifest=${path.resolve(manifestPath)}`], { cwd: repoRoot, env: process.env, stdio: ["ignore", "ignore", "inherit"] });
  const driver = firstNonEmpty(arg("driver"), process.env.BACKUP_DRIVER, "local").toLowerCase();
  if (!["local", "docker"].includes(driver)) throw new Error("--driver must be local or docker.");
  const composeEnvFile = resolveComposeEnvFile();
  const composeValues = readDotEnv(composeEnvFile);
  const settings = databaseSettings(composeValues);
  const service = firstNonEmpty(arg("postgres-service"), process.env.BACKUP_POSTGRES_SERVICE, "postgres");
  const targetName = firstNonEmpty(arg("target-db"), `restore_${manifest.backupId.slice("backup-".length).replaceAll("-", "").slice(0, 24)}`);
  if (!/^restore_[a-z0-9_]{1,50}$/.test(targetName)) throw new Error("target-db must start with restore_ and contain only lowercase letters, digits or underscores.");
  const started = Date.now();
  let created = false;
  try {
    await createDatabase(driver, targetName, settings, composeEnvFile, service);
    created = true;
    await decryptToRestore(driver, targetName, settings, composeEnvFile, service, backupPath);
    const validation = await validateTarget(driver, targetName, settings, composeEnvFile, service, manifest);
    const completed = Date.now();
    const report = {
      status: "RESTORE_VALIDATED",
      backupId: manifest.backupId,
      environment: manifest.environment,
      sourceImageDigest: manifest.sourceImageDigest,
      sourceCommitSha: manifest.sourceCommitSha,
      schemaVersion: manifest.schemaVersion,
      migrationSetDigest: manifest.migrationSetDigest,
      postgresMajor: manifest.postgresMajor,
      targetDatabase: targetName,
      startedAt: new Date(started).toISOString(),
      completedAt: new Date(completed).toISOString(),
      actualRtoSeconds: Number(((completed - started) / 1000).toFixed(3)),
      actualRpoSeconds: null,
      validation,
      pitrStatus: "NOT_CONFIGURED_LOCAL_PREVIEW",
    };
    const reportPath = arg("report", path.join(path.dirname(path.resolve(manifestPath)), `restore-rehearsal-${manifest.backupId}-${Date.now()}.json`));
    ensureDirectory(path.dirname(path.resolve(reportPath)));
    writeJsonExclusive(path.resolve(reportPath), report);
    process.stdout.write(`${JSON.stringify({ ...report, report: path.relative(repoRoot, path.resolve(reportPath)).replaceAll(path.sep, "/") }, null, 2)}\n`);
  } finally {
    if (created && !process.argv.includes("--keep-target")) {
      await dropDatabase(driver, targetName, settings, composeEnvFile, service);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

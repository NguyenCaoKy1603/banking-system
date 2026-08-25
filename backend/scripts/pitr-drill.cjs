const { arg } = require("./backup-common.cjs");
const { spawnResult, readDotEnv, resolveComposeEnvFile } = require("./backup-common.cjs");

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim();
}

async function main() {
  const driver = firstNonEmpty(arg("driver"), process.env.BACKUP_DRIVER, "local").toLowerCase();
  const composeEnvFile = resolveComposeEnvFile();
  const composeValues = readDotEnv(composeEnvFile);
  const user = firstNonEmpty(arg("db-user"), process.env.POSTGRES_USER, composeValues.POSTGRES_USER, "postgres");
  const database = firstNonEmpty(arg("db-name"), process.env.POSTGRES_DB, composeValues.POSTGRES_DB, "postgres");
  const sql = "SELECT json_build_object('walLevel', current_setting('wal_level'), 'archiveMode', current_setting('archive_mode'), 'archiveCommand', current_setting('archive_command'), 'archiveTimeout', current_setting('archive_timeout'))::text";
  const command = driver === "docker"
    ? ["compose", "--env-file", composeEnvFile, "exec", "-T", firstNonEmpty(arg("postgres-service"), "postgres"), "psql", "-U", user, "-d", database, "-Atqc", sql]
    : ["--dbname", process.env.DATABASE_URL ?? "", "-Atqc", sql];
  const result = await spawnResult(driver === "docker" ? "docker" : firstNonEmpty(arg("psql-bin"), "psql"), command);
  if (result.code !== 0) throw new Error("PITR prerequisite query failed.");
  const settings = JSON.parse(result.stdout.toString("utf8").trim());
  const configured = settings.walLevel === "replica" || settings.walLevel === "logical";
  const archiveEnabled = settings.archiveMode === "on" && settings.archiveCommand && settings.archiveCommand !== "(disabled)";
  const output = {
    status: configured && archiveEnabled ? "READY_FOR_PROVIDER_DRILL" : "NOT_CONFIGURED_LOCAL_PREVIEW",
    driver,
    settings: {
      walLevel: settings.walLevel,
      archiveMode: settings.archiveMode,
      archiveTimeout: settings.archiveTimeout,
      archiveCommandConfigured: Boolean(archiveEnabled),
    },
    rpoTargetSeconds: 300,
    rtoTargetSeconds: 3600,
    actualRpoSeconds: null,
    actualRtoSeconds: null,
    note: "This command is a non-destructive prerequisite check. It never deletes or rewinds the source database and does not claim PITR evidence.",
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!configured || !archiveEnabled) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

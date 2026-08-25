import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { URL } from "node:url";

import { Pool } from "pg";

import {
  assertDisposableDatabaseAdminUrl,
  assertDisposableDatabaseResetAllowed,
} from "../src/database/disposableDatabaseGuard.js";

const require = createRequire(import.meta.url);
const { resolvePostgresSsl } = require("./postgres-ssl.cjs") as {
  resolvePostgresSsl: (env?: NodeJS.ProcessEnv) => false | { rejectUnauthorized: boolean; ca?: string; servername?: string } | undefined;
};

const backendRoot = path.resolve(import.meta.dirname, "..");
const testFiles = process.argv.slice(2).filter((value) => value.trim().length > 0);
if (testFiles.length === 0) {
  throw new Error("At least one PostgreSQL test file is required.");
}

const adminUrl = process.env.DATABASE_TEST_ADMIN_URL?.trim();
if (!adminUrl) {
  throw new Error(
    "DATABASE_TEST_ADMIN_URL is required. Point it at a local postgres/template1 database; never use the preview database.",
  );
}

const guardEnvironment = {
  ...process.env,
  NODE_ENV: "test",
  BANKING_ENV: "test",
  ALLOW_DATABASE_TEST_RESET: "1",
};
assertDisposableDatabaseAdminUrl(adminUrl, guardEnvironment);

const databaseName = `banking_test_${process.pid}_${randomBytes(6).toString("hex")}`;
const adminParsed = new URL(adminUrl);
adminParsed.pathname = `/${databaseName}`;
const databaseUrl = adminParsed.toString();
assertDisposableDatabaseResetAllowed(databaseUrl, guardEnvironment);

const adminPool = new Pool({
  connectionString: adminUrl,
  ssl: resolvePostgresSsl(guardEnvironment),
  max: 1,
});

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: backendRoot, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`${path.basename(command)} ${args.join(" ")} failed${signal ? ` (${signal})` : ` with exit code ${code}`}.`));
    });
  });
}

async function main(): Promise<void> {
  await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  const migrationEnvironment: NodeJS.ProcessEnv = {
    ...guardEnvironment,
    DATABASE_URL: databaseUrl,
    RELEASE_ID: "local-disposable-test",
    BUILD_COMMIT_SHA: process.env.BUILD_COMMIT_SHA?.trim() || "test",
    IMAGE_DIGEST: "unknown",
  };
  const migrationScript = path.join(backendRoot, "scripts", "apply-migration.cjs");
  await runCommand(process.execPath, [migrationScript], migrationEnvironment);

  const testEnvironment: NodeJS.ProcessEnv = { ...guardEnvironment };
  const targetEnvironmentVariable = testFiles.some((file) => file.includes("databaseFoundation"))
    ? "P0_RELATIONAL_DATABASE_URL"
    : testFiles.some((file) => file.includes("relationalPersistence"))
      ? "RELATIONAL_DATABASE_URL"
      : testFiles.some((file) => file.includes("workerOutbox"))
        ? "WORKER_DATABASE_URL"
        : testFiles.some((file) => file.includes("admin.database"))
        ? "ADMIN_DATABASE_URL"
          : testFiles.some((file) => file.includes("persistence"))
            ? "DATABASE_URL"
      : testFiles.some((file) => file.includes("mfaPersistence"))
              ? "RELATIONAL_DATABASE_URL"
              : testFiles.some((file) => file.includes("savingsRelational"))
                ? "RELATIONAL_DATABASE_URL"
              : undefined;
  if (!targetEnvironmentVariable) {
    throw new Error(`Cannot infer the disposable database environment variable for: ${testFiles.join(", ")}`);
  }
  for (const variable of [
    "DATABASE_URL",
    "P0_RELATIONAL_DATABASE_URL",
    "RELATIONAL_DATABASE_URL",
    "WORKER_DATABASE_URL",
    "ADMIN_DATABASE_URL",
  ]) delete testEnvironment[variable];
  testEnvironment[targetEnvironmentVariable] = databaseUrl;
  testEnvironment.DATABASE_TEST_DATABASE_NAME = databaseName;
  const tsxCli = path.join(backendRoot, "node_modules", "tsx", "dist", "cli.mjs");
  await runCommand(process.execPath, [tsxCli, "--test", "--test-concurrency=1", ...testFiles], testEnvironment);
}

try {
  await main();
} finally {
  await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
  });
  await adminPool.end();
}

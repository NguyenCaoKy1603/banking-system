import net from "node:net";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { URL } from "node:url";

import { Pool } from "pg";

export type DatabaseTestEnvironment = Readonly<Record<string, string | undefined>>;

export interface DisposableDatabaseTarget {
  canonicalTarget: string;
  databaseName: string;
  hostname: string;
  port: number | null;
  url: string;
}

export interface DisposableDatabaseGuardOptions {
  /** Name of the environment variable holding the database under test. */
  targetEnvName?: string;
  /** Environment variables that may contain development/preview references. */
  referenceEnvNames?: readonly string[];
}

export interface EphemeralContainerDescriptor {
  readonly majorVersion: number;
  readonly bindHost: string;
  readonly port: number;
  readonly containerName: string;
  readonly runLabel: string;
  readonly persistentVolumes?: readonly string[];
  readonly sharedWithOtherServices?: boolean;
}

export interface OwnershipMarkerData {
  readonly runId: string;
  readonly owner: string;
  readonly createdAt: number;
}

export interface DisposableTimeouts {
  readonly containerStartupMs: 60_000;
  readonly poolConnectionMs: 5_000;
  readonly lockTimeoutMs: 5_000;
  readonly statementTimeoutMs: 30_000;
  readonly idleTransactionMs: 30_000;
  readonly commandTimeoutMs: 180_000;
  readonly cleanupTimeoutMs: 30_000;
}

export const DISPOSABLE_TIMEOUTS: DisposableTimeouts = {
  containerStartupMs: 60_000,
  poolConnectionMs: 5_000,
  lockTimeoutMs: 5_000,
  statementTimeoutMs: 30_000,
  idleTransactionMs: 30_000,
  commandTimeoutMs: 180_000,
  cleanupTimeoutMs: 30_000,
} as const;

export const APPROVED_TEST_PATHS = [
  "src/tests/migrationFingerprint.test.ts",
  "src/tests/registrationRelational.test.ts",
  "src/tests/kycRelational.test.ts",
  "src/tests/disposableMigrationRuntime.test.ts",
] as const;

export type ApprovedTestPath = (typeof APPROVED_TEST_PATHS)[number];

export const RUN_ID_PATTERN = /^[a-f0-9]{32}$/;
export const STRICT_DATABASE_NAME_PATTERN = /^banking_test_[a-f0-9]{32}$/;
export const CONTAINER_NAME_PATTERN = /^banking_test_container_[a-f0-9]{32}$/;

const DEFAULT_ALLOWED_HOSTS = ["127.0.0.1", "::1", "localhost", "postgres"] as const;
const DEFAULT_REFERENCE_ENV_NAMES = [
  "DATABASE_URL",
  "DEV_DATABASE_URL",
  "DEVELOPMENT_DATABASE_URL",
  "PREVIEW_DATABASE_URL",
  "BANKING_PREVIEW_DATABASE_URL",
  "P0_PREVIEW_DATABASE_URL",
] as const;

// Backwards compatibility pattern: existing test suites use banking_test_<suffix> (e.g. banking_test_guard)
const GENERAL_DATABASE_NAME_PATTERN = /^banking_test_[a-z0-9_]+$/;

const EXPLICITLY_FORBIDDEN_DATABASE_NAMES = new Set([
  "postgres",
  "template0",
  "template1",
  "banking_preview",
  "banking_dev",
  "banking_development",
]);

export function generateDisposableRunId(uuidGenerator: () => string = randomUUID): string {
  const raw = uuidGenerator().replaceAll("-", "").toLowerCase();
  if (!RUN_ID_PATTERN.test(raw)) {
    throw new Error(`Generated run_id '${raw}' does not match expected 32-char lowercase hex pattern.`);
  }
  return raw;
}

export function isNumericLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "::1";
}

export function assertProtectedDatabaseNameNotTargeted(databaseName: string): void {
  const normalized = databaseName.trim().toLowerCase();
  if (EXPLICITLY_FORBIDDEN_DATABASE_NAMES.has(normalized)) {
    throw new Error(`Targeting protected or forbidden database '${databaseName}' is strictly prohibited.`);
  }
}

export function validateContainerDescriptor(descriptor: EphemeralContainerDescriptor): void {
  if (descriptor.majorVersion !== 16) {
    throw new Error(`Container PostgreSQL major version must be 16, got ${descriptor.majorVersion}.`);
  }
  if (!isNumericLoopback(descriptor.bindHost)) {
    throw new Error(`Container bindHost must be numeric loopback (127.0.0.1 or ::1), got '${descriptor.bindHost}'.`);
  }
  if (!CONTAINER_NAME_PATTERN.test(descriptor.containerName)) {
    throw new Error(`Container containerName '${descriptor.containerName}' does not match expected pattern.`);
  }
  if (!RUN_ID_PATTERN.test(descriptor.runLabel)) {
    throw new Error(`Container runLabel '${descriptor.runLabel}' must be a 32-char lowercase hex string.`);
  }
  if (descriptor.persistentVolumes && descriptor.persistentVolumes.length > 0) {
    throw new Error(`Container must not attach persistent volumes: ${descriptor.persistentVolumes.join(", ")}`);
  }
  if (descriptor.sharedWithOtherServices) {
    throw new Error("Container must not be shared with any other services.");
  }
}

export function buildOwnershipMarker(data: OwnershipMarkerData): string {
  if (!RUN_ID_PATTERN.test(data.runId)) {
    throw new Error(`Invalid runId '${data.runId}' for ownership marker.`);
  }
  if (data.owner.trim().length === 0 || data.owner.includes(";") || data.owner.includes("=")) {
    throw new Error(`Invalid owner '${data.owner}' for ownership marker.`);
  }
  return `disposable_run_id=${data.runId};owner=${data.owner};created_at=${data.createdAt}`;
}

export function parseOwnershipMarker(marker: string): OwnershipMarkerData {
  const parts = marker.split(";").map((p) => p.trim()).filter(Boolean);
  let runId: string | undefined;
  let owner: string | undefined;
  let createdAt: number | undefined;

  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) throw new Error(`Malformed ownership marker segment: '${part}'`);
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key === "disposable_run_id") {
      runId = val;
    } else if (key === "owner") {
      owner = val;
    } else if (key === "created_at") {
      const num = Number(val);
      if (!Number.isFinite(num)) throw new Error(`Invalid created_at timestamp in marker: '${val}'`);
      createdAt = num;
    }
  }

  if (!runId || !RUN_ID_PATTERN.test(runId)) {
    throw new Error(`Marker is missing or has invalid disposable_run_id: '${runId}'`);
  }
  if (!owner || owner !== "m01_runner") {
    throw new Error(`Marker has unexpected or missing owner: '${owner}'`);
  }
  if (createdAt === undefined) {
    throw new Error("Marker is missing created_at timestamp.");
  }

  return { runId, owner, createdAt };
}

export function assertOwnershipMarkerMatches(marker: string, expectedRunId: string): void {
  const parsed = parseOwnershipMarker(marker);
  if (parsed.runId !== expectedRunId) {
    throw new Error(`Ownership marker run_id mismatch: expected '${expectedRunId}', got '${parsed.runId}'.`);
  }
}

export function quoteDatabaseIdentifier(name: string): string {
  if (!GENERAL_DATABASE_NAME_PATTERN.test(name)) {
    throw new Error(`Refusing to quote unsafe database identifier: '${name}'`);
  }
  return `"${name.replaceAll('"', '""')}"`;
}

export function sanitizeLogOutput(text: string): string {
  let sanitized = text;
  // Redact connection URLs
  sanitized = sanitized.replace(/(?:postgres|postgresql):\/\/[^\s"']+/gi, "[REDACTED_URL]");
  // Redact password/secret key-value pairs (e.g. password=..., secret=..., token=..., apiKey=...)
  sanitized = sanitized.replace(/(?:password|secret|token|apiKey|key)\s*[:=]\s*[^\s,;&"']+/gi, "[REDACTED_SECRET]");
  // Redact Bearer tokens
  sanitized = sanitized.replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, "Bearer [REDACTED_TOKEN]");
  // Redact 32-hex run IDs (including with banking_test_ or banking_test_container_ prefix)
  sanitized = sanitized.replace(/banking_test_container_[a-f0-9]{32}/gi, "banking_test_container_[REDACTED_RUN_ID]");
  sanitized = sanitized.replace(/banking_test_[a-f0-9]{32}/gi, "banking_test_[REDACTED_RUN_ID]");
  sanitized = sanitized.replace(/\b[a-f0-9]{32}\b/gi, "[REDACTED_RUN_ID]");
  return sanitized;
}

export function assertApprovedTestPath(testPath: string): ApprovedTestPath {
  const normalized = testPath.replace(/\\/g, "/");
  const match = APPROVED_TEST_PATHS.find((p) => normalized.endsWith(p));
  if (!match) {
    throw new Error(`Test path '${testPath}' is not in the approved fixed allowlist: ${APPROVED_TEST_PATHS.join(", ")}`);
  }
  return match;
}

export interface FakeDatabaseCatalog {
  readonly existingDatabases: ReadonlySet<string>;
  readonly databaseComments: ReadonlyMap<string, string>;
  readonly activeSessions: ReadonlyMap<string, readonly number[]>;
}

export function preCreateClassificationCheck(
  targetName: string,
  catalog: FakeDatabaseCatalog,
): void {
  if (!STRICT_DATABASE_NAME_PATTERN.test(targetName)) {
    throw new Error(`Target database '${targetName}' does not match strict disposable pattern.`);
  }
  assertProtectedDatabaseNameNotTargeted(targetName);
  if (catalog.existingDatabases.has(targetName)) {
    throw new Error(`Refusing to create database '${targetName}' because it already exists in catalog.`);
  }
}

export function preCleanupRevalidationCheck(
  targetName: string,
  expectedRunId: string,
  catalog: FakeDatabaseCatalog,
): void {
  if (!STRICT_DATABASE_NAME_PATTERN.test(targetName)) {
    throw new Error(`Target database '${targetName}' does not match strict disposable pattern.`);
  }
  assertProtectedDatabaseNameNotTargeted(targetName);
  if (!catalog.existingDatabases.has(targetName)) {
    throw new Error(`Target database '${targetName}' not found in catalog for cleanup.`);
  }
  const comment = catalog.databaseComments.get(targetName);
  if (!comment) {
    throw new Error(`Target database '${targetName}' has no ownership comment.`);
  }
  assertOwnershipMarkerMatches(comment, expectedRunId);
}

export function postDropCatalogCheck(
  targetName: string,
  catalog: FakeDatabaseCatalog,
): void {
  if (catalog.existingDatabases.has(targetName)) {
    throw new Error(`Post-drop check failed: target database '${targetName}' still present in catalog.`);
  }
}

function parsePostgresUrl(raw: string, label: string): URL {
  try {
    const parsed = new URL(raw);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
      throw new Error(`${label} must use postgres: or postgresql: protocol.`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.includes(label)) throw error;
    throw new Error(`${label} is not a valid PostgreSQL URL.`);
  }
}

function normalizeHostname(hostname: string): string {
  const unbracketed = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  return unbracketed.toLowerCase();
}

function allowedHosts(env: DatabaseTestEnvironment): ReadonlySet<string> {
  const configured = env.DATABASE_TEST_ALLOWED_HOSTS?.split(",")
    .map((host) => normalizeHostname(host.trim()))
    .filter((host) => host.length > 0);
  return new Set(configured && configured.length > 0 ? configured : DEFAULT_ALLOWED_HOSTS);
}

function referenceUrls(
  env: DatabaseTestEnvironment,
  names: readonly string[] = DEFAULT_REFERENCE_ENV_NAMES,
): readonly string[] {
  const urls: string[] = [];
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) urls.push(value);
  }
  return urls;
}

function canonicalTarget(parsed: URL, name: string): string {
  const port = parsed.port || "5432";
  return `${normalizeHostname(parsed.hostname)}:${port}/${name}`;
}

function databaseName(parsed: URL, label: string): string {
  const name = parsed.pathname.replace(/^\//, "").trim();
  if (!name) throw new Error(`${label} must specify a database name.`);
  return name;
}

/**
 * Validate the target of a destructive PostgreSQL test before a connection is
 * opened. This is intentionally fail-closed: a missing test marker or an
 * unknown host/database is an error, not a skipped test.
 */
export function assertDisposableDatabaseResetAllowed(
  databaseUrl: string,
  env: DatabaseTestEnvironment = process.env,
  options: DisposableDatabaseGuardOptions = {},
): DisposableDatabaseTarget {
  if (env.NODE_ENV?.trim().toLowerCase() !== "test") {
    throw new Error("Destructive PostgreSQL tests require NODE_ENV=test.");
  }
  if (env.BANKING_ENV?.trim().toLowerCase() !== "test") {
    throw new Error("Destructive PostgreSQL tests require BANKING_ENV=test.");
  }
  if (env.ALLOW_DATABASE_TEST_RESET !== "1") {
    throw new Error("Destructive PostgreSQL tests require ALLOW_DATABASE_TEST_RESET=1.");
  }

  const targetUrl = databaseUrl.trim();
  if (!targetUrl) throw new Error("A disposable PostgreSQL test URL is required.");
  const parsed = parsePostgresUrl(targetUrl, "Test database URL");
  const name = databaseName(parsed, "Test database URL");
  const hostname = normalizeHostname(parsed.hostname);
  if (!allowedHosts(env).has(hostname)) {
    throw new Error(`Test database host '${hostname}' is not in DATABASE_TEST_ALLOWED_HOSTS.`);
  }
  assertProtectedDatabaseNameNotTargeted(name);
  if (!GENERAL_DATABASE_NAME_PATTERN.test(name)) {
    throw new Error("Test database name must match banking_test_<suffix>.");
  }

  const target = {
    canonicalTarget: canonicalTarget(parsed, name),
    databaseName: name,
    hostname,
    port: parsed.port ? Number(parsed.port) : null,
    url: targetUrl,
  } satisfies DisposableDatabaseTarget;
  const references = referenceUrls(
    env,
    (options.referenceEnvNames ?? DEFAULT_REFERENCE_ENV_NAMES).filter(
      (n) => n !== options.targetEnvName,
    ),
  );
  for (const reference of references) {
    const referenceParsed = parsePostgresUrl(reference, "Development/preview database URL");
    const referenceName = databaseName(referenceParsed, "Development/preview database URL");
    if (canonicalTarget(referenceParsed, referenceName) === target.canonicalTarget) {
      throw new Error("Refusing destructive tests because the test URL matches a development/preview database URL.");
    }
  }
  return target;
}

export function assertDisposableDatabaseAdminUrl(
  databaseUrl: string,
  env: DatabaseTestEnvironment = process.env,
): DisposableDatabaseTarget {
  const parsed = parsePostgresUrl(databaseUrl.trim(), "Database test admin URL");
  const name = databaseName(parsed, "Database test admin URL");
  const hostname = normalizeHostname(parsed.hostname);
  if (!allowedHosts(env).has(hostname)) {
    throw new Error(`Database test admin host '${hostname}' is not in DATABASE_TEST_ALLOWED_HOSTS.`);
  }
  if (!new Set(["postgres", "template1"]).has(name.toLowerCase())) {
    throw new Error("Database test admin URL must connect to postgres or template1, never an application database.");
  }
  return {
    canonicalTarget: canonicalTarget(parsed, name),
    databaseName: name,
    hostname,
    port: parsed.port ? Number(parsed.port) : null,
    url: databaseUrl.trim(),
  };
}

// ============================================================================
// Runner Orchestration (SAFE-R07..SAFE-R11) & Lifecycle / Cancellation
// ============================================================================

export type RunnerLifecycleState = "IDLE" | "RUNNING" | "STOPPING" | "TIMED_OUT" | "COMPLETED" | "FAILED";

export interface DisposableQueryResult {
  readonly rows?: unknown[];
}

export interface DisposablePoolClient {
  query(sql: string, params?: unknown[], signal?: AbortSignal): Promise<DisposableQueryResult>;
  end(): Promise<void>;
}

export type CreatePoolFunction = (adminUrl: string, ssl: unknown) => DisposablePoolClient;

export type RunCommandFunction = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs?: number,
  signal?: AbortSignal,
) => Promise<void>;

export interface ProcessInterruptionEmitter {
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
}

export interface ProcessFacade {
  exitCode?: number | null | string;
}

export type ContainerRemovalFunction = (
  containerName: string,
  runLabel: string,
  signal?: AbortSignal,
) => Promise<void>;

export interface DisposableRunnerDependencies {
  readonly runIdGenerator?: () => string;
  readonly runCommandFn?: RunCommandFunction;
  readonly createPoolFn?: CreatePoolFunction;
  readonly processEmitter?: ProcessInterruptionEmitter;
  readonly processFacade?: ProcessFacade;
  readonly commandTimeoutMs?: number;
  readonly cleanupTimeoutMs?: number;
  readonly containerRemovalFn?: ContainerRemovalFunction;
}

export interface RunnerExecutionResult {
  readonly success: boolean;
  readonly databaseName: string;
  readonly runId: string;
  readonly lifecycleState: RunnerLifecycleState;
  readonly error?: Error;
  readonly cleanupError?: Error;
}

export async function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number = DISPOSABLE_TIMEOUTS.commandTimeoutMs,
  signal?: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;

    const child = spawn(command, args, { cwd: path.resolve(import.meta.dirname, "../.."), env, stdio: "inherit" });

    const cleanupResources = () => {
      if (timer) clearTimeout(timer);
      if (signal && abortListener) signal.removeEventListener("abort", abortListener);
    };

    if (signal) {
      if (signal.aborted) {
        child.kill("SIGTERM");
        reject(new Error(`Command ${path.basename(command)} ${args.join(" ")} was aborted before execution.`));
        return;
      }
      abortListener = () => {
        child.kill("SIGTERM");
        cleanupResources();
        reject(new Error(`Command ${path.basename(command)} ${args.join(" ")} aborted: ${String(signal.reason)}`));
      };
      signal.addEventListener("abort", abortListener, { once: true });
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        cleanupResources();
        reject(new Error(`Command ${path.basename(command)} ${args.join(" ")} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    }
    child.once("error", (err) => {
      cleanupResources();
      reject(err);
    });
    child.once("exit", (code, signalName) => {
      cleanupResources();
      if (code === 0) return resolve();
      reject(new Error(`${path.basename(command)} ${args.join(" ")} failed${signalName ? ` (${signalName})` : ` with exit code ${code}`}.`));
    });
  });
}

export type SslConfiguration = boolean | { rejectUnauthorized?: boolean; ca?: string; servername?: string } | undefined;

function resolvePostgresSslHelper(env: NodeJS.ProcessEnv = process.env): SslConfiguration {
  try {
    const require = createRequire(import.meta.url);
    const resolvedPath = path.resolve(import.meta.dirname, "../../scripts/postgres-ssl.cjs");
    const sslModule = require(resolvedPath) as {
      resolvePostgresSsl?: (env?: NodeJS.ProcessEnv) => SslConfiguration;
    };
    return sslModule.resolvePostgresSsl ? sslModule.resolvePostgresSsl(env) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Execute disposable database test runner orchestration with full lifecycle guarantees.
 * Implements bounded cooperative cancellation and deterministic exit semantics.
 */
export async function runDisposablePostgresTest(
  testFiles: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  deps: DisposableRunnerDependencies = {},
): Promise<RunnerExecutionResult> {
  let lifecycleState: RunnerLifecycleState = "RUNNING";

  if (testFiles.length === 0) {
    lifecycleState = "FAILED";
    throw new Error("At least one PostgreSQL test file is required.");
  }
  for (const file of testFiles) {
    assertApprovedTestPath(file);
  }

  const adminUrl = env.DATABASE_TEST_ADMIN_URL?.trim();
  if (!adminUrl) {
    lifecycleState = "FAILED";
    throw new Error(
      "DATABASE_TEST_ADMIN_URL is required. Point it at a local postgres/template1 database; never use the preview database.",
    );
  }

  const guardEnvironment = {
    ...env,
    NODE_ENV: "test",
    BANKING_ENV: "test",
    ALLOW_DATABASE_TEST_RESET: "1",
  };
  assertDisposableDatabaseAdminUrl(adminUrl, guardEnvironment);

  const runId = (deps.runIdGenerator ?? generateDisposableRunId)();
  const databaseName = `banking_test_${runId}`;
  const adminParsed = new URL(adminUrl);
  adminParsed.pathname = `/${databaseName}`;
  const databaseUrl = adminParsed.toString();
  assertDisposableDatabaseResetAllowed(databaseUrl, guardEnvironment);

  const ssl = resolvePostgresSslHelper(guardEnvironment);
  const pool: DisposablePoolClient = deps.createPoolFn
    ? deps.createPoolFn(adminUrl, ssl)
    : new Pool({
        connectionString: adminUrl,
        ssl,
        max: 1,
        connectionTimeoutMillis: DISPOSABLE_TIMEOUTS.poolConnectionMs,
      });

  const runCmd = deps.runCommandFn ?? runCommand;
  const commandTimeoutMs = deps.commandTimeoutMs ?? DISPOSABLE_TIMEOUTS.commandTimeoutMs;
  const cleanupTimeoutMs = deps.cleanupTimeoutMs ?? DISPOSABLE_TIMEOUTS.cleanupTimeoutMs;
  const backendRoot = path.resolve(import.meta.dirname, "../..");

  let mainError: Error | undefined;
  let fatalEventError: Error | undefined;
  let cleanupError: Error | undefined;
  let cleanupPromise: Promise<void> | undefined;

  // Active child abort controller
  const childAbortController = new AbortController();

  // Interruption coordinator promise seam
  let triggerInterruption: (err: Error) => void = () => {};
  const interruptionPromise = new Promise<never>((_, reject) => {
    triggerInterruption = reject;
  });

  const performCleanup = (): Promise<void> => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      const cleanupAbortController = new AbortController();
      let cleanupTimer: NodeJS.Timeout | undefined;

      const cleanupTimeoutPromise = new Promise<never>((_, reject) => {
        cleanupTimer = setTimeout(() => {
          lifecycleState = "TIMED_OUT";
          const err = new Error(`Cleanup timed out after ${cleanupTimeoutMs}ms.`);
          cleanupAbortController.abort(err);
          reject(err);
        }, cleanupTimeoutMs);
      });

      const checkCancellation = (phaseName: string): void => {
        if (cleanupAbortController.signal.aborted || lifecycleState === "TIMED_OUT") {
          throw new Error(`Cleanup aborted before phase '${phaseName}': ${cleanupAbortController.signal.reason ?? "deadline exceeded"}`);
        }
      };

      const cleanupExecution = async (): Promise<void> => {
        try {
          // Phase 1: Revalidate marker on catalog
          checkCancellation("pre-cleanup-revalidation");
          const commentRes = await pool.query(
            "SELECT shobj_description(d.oid, 'pg_database') AS comment FROM pg_database d WHERE d.datname = $1",
            [databaseName],
            cleanupAbortController.signal,
          );
          const rows = commentRes.rows as Array<{ comment?: string }> | undefined;
          const comment = rows?.[0]?.comment;
          if (!comment) {
            throw new Error(`Refusing to drop database '${databaseName}': missing ownership marker comment.`);
          }
          assertOwnershipMarkerMatches(comment, runId);

          // Phase 2: Terminate active sessions
          checkCancellation("terminate-sessions");
          await pool.query(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
            [databaseName],
            cleanupAbortController.signal,
          );

          // Phase 3: Drop target database
          checkCancellation("drop-database");
          await pool.query(
            `DROP DATABASE IF EXISTS ${quoteDatabaseIdentifier(databaseName)} WITH (FORCE)`,
            undefined,
            cleanupAbortController.signal,
          );

          // Phase 4: Post-drop catalog check
          checkCancellation("post-drop-catalog-check");
          const verifyRes = await pool.query(
            "SELECT 1 FROM pg_database WHERE datname = $1",
            [databaseName],
            cleanupAbortController.signal,
          );
          const remainingRows = verifyRes.rows;
          if (remainingRows && remainingRows.length > 0) {
            throw new Error(`Postcondition failed: database '${databaseName}' still exists in catalog after DROP.`);
          }

          // Phase 5: Container removal hook if provided
          checkCancellation("container-removal");
          if (deps.containerRemovalFn) {
            const containerName = `banking_test_container_${runId}`;
            await deps.containerRemovalFn(containerName, runId, cleanupAbortController.signal);
          }
        } finally {
          // Phase 6: Pool close in all cases
          try {
            await pool.end();
          } catch {
            // Best-effort pool close
          }
        }
      };

      try {
        await Promise.race([cleanupExecution(), cleanupTimeoutPromise]);
      } catch (err) {
        cleanupError = err instanceof Error ? err : new Error(String(err));
        throw cleanupError;
      } finally {
        if (cleanupTimer) clearTimeout(cleanupTimer);
      }
    })();
    return cleanupPromise;
  };

  // Interruption listener seam (SAFE-R10: SIGINT, SIGTERM, uncaughtException, unhandledRejection)
  const emitter = deps.processEmitter;
  const facade = deps.processFacade;

  const createFatalHandler = (eventName: string) => {
    return (detail?: unknown) => {
      if (fatalEventError) return; // Only first event becomes primary termination cause!
      const detailMsg = detail instanceof Error ? detail.message : (detail ? String(detail) : "");
      fatalEventError = new Error(`Execution interrupted by ${eventName}${detailMsg ? `: ${detailMsg}` : ""}`);
      lifecycleState = "STOPPING";
      if (facade) {
        facade.exitCode = 1;
      }
      childAbortController.abort(fatalEventError);
      triggerInterruption(fatalEventError);
      void performCleanup().catch(() => {
        // Handled in finally
      });
    };
  };

  const sigintHandler = createFatalHandler("SIGINT");
  const sigtermHandler = createFatalHandler("SIGTERM");
  const uncaughtHandler = createFatalHandler("uncaughtException");
  const unhandledHandler = createFatalHandler("unhandledRejection");

  if (emitter) {
    emitter.on("SIGINT", sigintHandler);
    emitter.on("SIGTERM", sigtermHandler);
    emitter.on("uncaughtException", uncaughtHandler);
    emitter.on("unhandledRejection", unhandledHandler);
  }

  const mainExecution = async (): Promise<void> => {
    // 1. Create target DB
    await pool.query(`CREATE DATABASE ${quoteDatabaseIdentifier(databaseName)}`, undefined, childAbortController.signal);

    // 2. Set ownership marker immediately
    const marker = buildOwnershipMarker({
      runId,
      owner: "m01_runner",
      createdAt: Date.now(),
    });
    await pool.query(`COMMENT ON DATABASE ${quoteDatabaseIdentifier(databaseName)} IS '${marker}'`, undefined, childAbortController.signal);

    const executeChildCommandWithTimeout = async (
      cmd: string,
      args: string[],
      cmdEnv: NodeJS.ProcessEnv,
    ): Promise<void> => {
      let timer: NodeJS.Timeout | undefined;
      const commandAbortController = new AbortController();

      const forwardChildAbort = () => {
        commandAbortController.abort(childAbortController.signal.reason);
      };
      childAbortController.signal.addEventListener("abort", forwardChildAbort, { once: true });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          lifecycleState = "TIMED_OUT";
          const err = new Error(`Command ${path.basename(cmd)} ${args.join(" ")} timed out after ${commandTimeoutMs}ms.`);
          commandAbortController.abort(err);
          childAbortController.abort(err);
          reject(err);
        }, commandTimeoutMs);
      });

      try {
        await Promise.race([
          runCmd(cmd, args, cmdEnv, commandTimeoutMs, commandAbortController.signal),
          timeoutPromise,
        ]);
      } finally {
        if (timer) clearTimeout(timer);
        childAbortController.signal.removeEventListener("abort", forwardChildAbort);
      }
    };

    // 3. Apply migrations
    const migrationEnvironment: NodeJS.ProcessEnv = {
      ...guardEnvironment,
      DATABASE_URL: databaseUrl,
      RELEASE_ID: "local-disposable-test",
      BUILD_COMMIT_SHA: env.BUILD_COMMIT_SHA?.trim() || "test",
      IMAGE_DIGEST: "unknown",
    };
    const migrationScript = path.join(backendRoot, "scripts", "apply-migration.cjs");
    await executeChildCommandWithTimeout(process.execPath, [migrationScript], migrationEnvironment);

    if (fatalEventError) throw fatalEventError;

    // 4. Run targeted child tests
    const testEnvironment: NodeJS.ProcessEnv = { ...guardEnvironment };
    let targetEnvironmentVariable: string | undefined;
    if (testFiles.some((file) => file.includes("databaseFoundation"))) {
      targetEnvironmentVariable = "P0_RELATIONAL_DATABASE_URL";
    } else if (testFiles.some((file) => file.includes("relationalPersistence"))) {
      targetEnvironmentVariable = "RELATIONAL_DATABASE_URL";
    } else if (testFiles.some((file) => file.includes("workerOutbox"))) {
      targetEnvironmentVariable = "WORKER_DATABASE_URL";
    } else if (testFiles.some((file) => file.includes("admin.database"))) {
      targetEnvironmentVariable = "ADMIN_DATABASE_URL";
    } else if (testFiles.some((file) => file.includes("migrationFingerprint"))) {
      targetEnvironmentVariable = "DATABASE_URL";
    } else if (testFiles.some((file) => file.includes("persistence"))) {
      targetEnvironmentVariable = "DATABASE_URL";
    } else if (testFiles.some((file) => [
      "mfaPersistence",
      "savingsRelational",
      "creditRelational",
      "remainingRelational",
      "registrationRelational",
      "kycRelational",
      "lifecycleRelational",
      "lifecycleScheduler",
      "integratedDisposable",
    ].some((name) => file.includes(name)))) {
      targetEnvironmentVariable = "RELATIONAL_DATABASE_URL";
    }
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
    await executeChildCommandWithTimeout(
      process.execPath,
      [tsxCli, "--test", "--test-concurrency=1", ...testFiles],
      testEnvironment,
    );

    if (fatalEventError) throw fatalEventError;
  };

  try {
    await Promise.race([mainExecution(), interruptionPromise]);
    lifecycleState = "COMPLETED";
  } catch (err) {
    mainError = err instanceof Error ? err : new Error(String(err));
    lifecycleState = "FAILED";
    if (facade && !facade.exitCode) {
      facade.exitCode = 1;
    }
  } finally {
    if (emitter) {
      emitter.removeListener("SIGINT", sigintHandler);
      emitter.removeListener("SIGTERM", sigtermHandler);
      emitter.removeListener("uncaughtException", uncaughtHandler);
      emitter.removeListener("unhandledRejection", unhandledHandler);
    }
    try {
      await performCleanup();
    } catch (err) {
      if (!cleanupError) {
        cleanupError = err instanceof Error ? err : new Error(String(err));
      }
    }

    const primaryError = fatalEventError ?? mainError;
    if (primaryError) {
      if (cleanupError && primaryError !== cleanupError) {
        primaryError.cause = cleanupError;
      }
      return {
        success: false,
        databaseName,
        runId,
        lifecycleState: lifecycleState === "COMPLETED" ? "FAILED" : lifecycleState,
        error: primaryError,
        cleanupError,
      };
    }

    if (cleanupError) {
      if (facade && !facade.exitCode) {
        facade.exitCode = 1;
      }
      return {
        success: false,
        databaseName,
        runId,
        lifecycleState: "FAILED",
        error: cleanupError,
        cleanupError,
      };
    }

    return {
      success: true,
      databaseName,
      runId,
      lifecycleState: "COMPLETED",
    };
  }
}


// ============================================================================
// M07-A2R Evidence Harness & Verification Helpers
// ============================================================================

export const AUTHORIZED_EVIDENCE_PHASES = [
  "INITIAL_HISTORY",
  "RERUN_HISTORY",
  "INJECT_CHECKSUM_MISMATCH",
  "RESTORE_CHECKSUM",
] as const;
export type EvidencePhase = (typeof AUTHORIZED_EVIDENCE_PHASES)[number];

export function assertEvidencePhase(phase: string | undefined): EvidencePhase {
  if (!phase || !AUTHORIZED_EVIDENCE_PHASES.includes(phase as EvidencePhase)) {
    throw new Error(`Invalid or missing evidence phase '${phase}'. Must be one of: ${AUTHORIZED_EVIDENCE_PHASES.join(", ")}`);
  }
  return phase as EvidencePhase;
}

export function buildDockerImageInspectArgs(image = "postgres:16"): readonly string[] {
  return ["image", "inspect", image];
}

export const CANONICAL_TMPFS_DESTINATION = "/var/lib/postgresql/data";
export const CANONICAL_TMPFS_OPTIONS = "rw,noexec,nosuid,size=512m,mode=0700";
export const CANONICAL_TMPFS_FLAG_VALUE = `${CANONICAL_TMPFS_DESTINATION}:${CANONICAL_TMPFS_OPTIONS}`;

export interface DockerRunOptions {
  readonly containerName: string;
  readonly runId: string;
  readonly password?: string;
  readonly image?: string;
}

export function buildDockerRunArgs(options: DockerRunOptions): readonly string[] {
  if (!CONTAINER_NAME_PATTERN.test(options.containerName)) {
    throw new Error(`Invalid container name: '${options.containerName}'. Must match ${CONTAINER_NAME_PATTERN.source}`);
  }
  if (!RUN_ID_PATTERN.test(options.runId)) {
    throw new Error(`Invalid runId: '${options.runId}'. Must match ${RUN_ID_PATTERN.source}`);
  }
  const image = options.image ?? "postgres:16";
  const password = options.password ?? "banking_test_secret";
  return [
    "run",
    "-d",
    "--pull=never",
    "--name",
    options.containerName,
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "-p",
    "127.0.0.1::5432",
    "--tmpfs",
    CANONICAL_TMPFS_FLAG_VALUE,
    "-l",
    `banking_test_run_id=${options.runId}`,
    image,
  ];
}

export function buildDockerInspectArgs(containerIdOrName: string): readonly string[] {
  if (!containerIdOrName || typeof containerIdOrName !== "string") {
    throw new Error("Invalid container identifier for inspect.");
  }
  return ["inspect", containerIdOrName];
}

export function buildDockerExecMountinfoArgs(containerId: string): readonly string[] {
  if (!CONTAINER_ID_64_HEX_PATTERN.test(containerId)) {
    throw new Error("Invalid container ID for mount-namespace attestation: expected exact 64 lowercase hex.");
  }
  return ["exec", containerId, "cat", "/proc/self/mountinfo"];
}

export function buildDockerRmArgs(containerId: string): readonly string[] {
  if (!/^[a-f0-9]{64}$/.test(containerId)) {
    throw new Error(`Invalid container ID for removal: '${containerId}'. Must be exact 64 lowercase hex.`);
  }
  return ["rm", "-f", "-v", containerId];
}

export interface DockerInspectPortBinding {
  readonly HostIp: string;
  readonly HostPort: string;
}

export interface DockerInspectMount {
  readonly Type?: string;
  readonly Source?: string;
  readonly Destination?: string;
  readonly Mode?: string;
  readonly RW?: boolean;
  readonly Propagation?: string;
}

export interface DockerInspectRecord {
  readonly Id?: string;
  readonly Name?: string;
  readonly Image?: string;
  readonly Config?: {
    readonly Image?: string;
    readonly Labels?: Record<string, string>;
    readonly Env?: readonly string[];
  };
  readonly NetworkSettings?: {
    readonly Ports?: Record<string, readonly DockerInspectPortBinding[] | null>;
  };
  readonly Mounts?: readonly DockerInspectMount[];
  readonly HostConfig?: {
    readonly Binds?: readonly unknown[];
    readonly Tmpfs?: Record<string, string>;
    readonly Privileged?: boolean;
    readonly CapAdd?: readonly string[] | null;
  };
}

export interface ValidatedContainerInfo {
  readonly containerId: string;
  readonly containerName: string;
  readonly hostPort: number;
  readonly bindHost: string;
  readonly runId: string;
}

export interface DockerImageInspectRecord {
  readonly Id?: string;
  readonly RepoTags?: readonly string[];
}

export const IMMUTABLE_IMAGE_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const CONTAINER_ID_64_HEX_PATTERN = /^[0-9a-f]{64}$/;

export function validateDockerImageInspectOutput(inspectJson: string, expectedTag = "postgres:16"): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(inspectJson);
  } catch {
    throw new Error("Docker image inspect returned malformed JSON");
  }

  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error(`Docker image inspect must return an array with exactly one record, got ${Array.isArray(parsed) ? parsed.length : "non-array"}`);
  }

  const record = parsed[0] as DockerImageInspectRecord;
  if (!record || typeof record !== "object") {
    throw new Error("Docker image inspect record is not an object");
  }

  const id = record.Id;
  if (!id || typeof id !== "string" || !IMMUTABLE_IMAGE_ID_PATTERN.test(id)) {
    throw new Error("Docker image inspect missing or invalid immutable image ID format (expected sha256:<64-hex>)");
  }

  const repoTags = record.RepoTags;
  if (!Array.isArray(repoTags) || !repoTags.includes(expectedTag)) {
    throw new Error(`Docker image inspect RepoTags does not contain exact tag '${expectedTag}'`);
  }

  return id;
}

export function parseAndValidateLaunchedContainerId(stdout: string): string {
  const trimmed = stdout.trim();
  if (!CONTAINER_ID_64_HEX_PATTERN.test(trimmed) || stdout.includes("\n") || stdout.includes("\r")) {
    throw new Error("docker run returned invalid container ID format: expected exactly one single-line 64 lowercase hex string");
  }
  return trimmed;
}

export function validateTmpfsOptions(optionsString: string): void {
  if (typeof optionsString !== "string" || optionsString.trim() === "") {
    throw new Error("Docker inspect tmpfs options string is empty or invalid");
  }

  const tokens = optionsString.split(",").map((s) => s.trim()).filter(Boolean);

  let countRw = 0;
  let countNoexec = 0;
  let countNosuid = 0;
  let countSize = 0;
  let countMode = 0;
  const unknownTokens: string[] = [];

  for (const token of tokens) {
    if (token === "rw") {
      countRw++;
    } else if (token === "noexec") {
      countNoexec++;
    } else if (token === "nosuid") {
      countNosuid++;
    } else if (token.startsWith("size=")) {
      countSize++;
      const match = /^size=(\d+)([kmgKMG]?)$/.exec(token);
      if (!match) {
        throw new Error(`Docker inspect tmpfs size option format invalid: '${token}'`);
      }
      const rawNum = parseInt(match[1], 10);
      const unit = (match[2] ?? "").toLowerCase();
      let bytes = rawNum;
      if (unit === "k") {
        bytes = rawNum * 1024;
      } else if (unit === "m") {
        bytes = rawNum * 1024 * 1024;
      } else if (unit === "g") {
        bytes = rawNum * 1024 * 1024 * 1024;
      }
      const EXPECTED_512M_BYTES = 512 * 1024 * 1024;
      if (bytes !== EXPECTED_512M_BYTES) {
        throw new Error(`Docker inspect tmpfs size is '${token}' (${bytes} bytes), expected 512m (${EXPECTED_512M_BYTES} bytes)`);
      }
    } else if (token.startsWith("mode=")) {
      const match = /^mode=([0-7]+)$/.exec(token);
      if (!match) {
        throw new Error(`Docker inspect tmpfs mode option format invalid: '${token}'`);
      }
      countMode++;
      const octalVal = parseInt(match[1], 8);
      const EXPECTED_0700_OCTAL = 0o700;
      if (octalVal !== EXPECTED_0700_OCTAL) {
        throw new Error(`Docker inspect tmpfs mode is '${token}' (0o${octalVal.toString(8)}), expected 0700`);
      }
    } else {
      unknownTokens.push(token);
    }
  }

  if (unknownTokens.length > 0) {
    throw new Error(`Docker inspect tmpfs has unexpected option(s): ${unknownTokens.join(", ")}`);
  }
  if (countRw !== 1) {
    throw new Error(`Docker inspect tmpfs options must contain exactly one 'rw' flag, found ${countRw}`);
  }
  if (countNoexec !== 1) {
    throw new Error(`Docker inspect tmpfs options must contain exactly one 'noexec' flag, found ${countNoexec}`);
  }
  if (countNosuid !== 1) {
    throw new Error(`Docker inspect tmpfs options must contain exactly one 'nosuid' flag, found ${countNosuid}`);
  }
  if (countSize !== 1) {
    throw new Error(`Docker inspect tmpfs options must contain exactly one size parameter (512m), found ${countSize}`);
  }
  if (countMode !== 1) {
    throw new Error(`Docker inspect tmpfs options must contain exactly one mode parameter (0700), found ${countMode}`);
  }
}

export function validateDockerInspectOutput(
  inspectJson: string,
  expectedContainerName: string,
  expectedRunId: string,
  approvedLocalImageId?: string,
  expectedContainerId?: string,
): ValidatedContainerInfo {
  let parsed: unknown;
  try {
    parsed = JSON.parse(inspectJson);
  } catch {
    throw new Error("Docker inspect returned malformed JSON");
  }

  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error(`Docker inspect must return an array with exactly one record, got ${Array.isArray(parsed) ? parsed.length : "non-array"}`);
  }

  const record = parsed[0] as DockerInspectRecord;
  if (!record || typeof record !== "object") {
    throw new Error("Docker inspect record is not an object");
  }

  const id = record.Id;
  if (!id || typeof id !== "string" || !CONTAINER_ID_64_HEX_PATTERN.test(id)) {
    throw new Error("Docker inspect container ID must be exact 64 lowercase hexadecimal characters");
  }

  if (expectedContainerId && id !== expectedContainerId) {
    throw new Error(`Docker inspect container ID '${id}' does not match launched container ID '${expectedContainerId}'`);
  }

  const name = record.Name;
  if (!name || typeof name !== "string") {
    throw new Error("Docker inspect container Name is missing");
  }
  const normalizedName = name.startsWith("/") ? name.slice(1) : name;
  if (normalizedName !== expectedContainerName) {
    throw new Error(`Docker inspect container Name '${normalizedName}' does not match expected '${expectedContainerName}'`);
  }

  const runLabel = record.Config?.Labels?.banking_test_run_id;
  if (!runLabel || runLabel !== expectedRunId) {
    throw new Error("Docker inspect missing or mismatched banking_test_run_id label");
  }

  // Exact immutable image reference binding (Correction A: strictly === 'postgres:16', no prefix/substring)
  const configImage = record.Config?.Image;
  if (configImage !== "postgres:16") {
    throw new Error(`Docker inspect Config.Image '${configImage}' is not exact approved 'postgres:16'`);
  }

  if (approvedLocalImageId) {
    const inspectImageId = record.Image;
    if (inspectImageId !== approvedLocalImageId) {
      throw new Error(`Docker inspect container Image '${inspectImageId}' does not match approved local immutable image ID '${approvedLocalImageId}'`);
    }
  }

  const ports = record.NetworkSettings?.Ports;
  if (!ports || typeof ports !== "object") {
    throw new Error("Docker inspect missing NetworkSettings.Ports");
  }
  const unexpectedPortKeys = Object.keys(ports).filter((key) => key !== "5432/tcp");
  if (unexpectedPortKeys.length > 0) {
    throw new Error("Docker inspect contains port bindings outside the exact loopback PostgreSQL contract");
  }
  const bindings = ports["5432/tcp"];
  if (!Array.isArray(bindings) || bindings.length !== 1) {
    throw new Error("Docker inspect missing port 5432/tcp binding");
  }
  const firstBinding = bindings[0];
  if (!firstBinding || typeof firstBinding !== "object") {
    throw new Error("Docker inspect invalid port binding entry");
  }
  const hostIp = firstBinding.HostIp;
  if (hostIp !== "127.0.0.1") {
    throw new Error(`Docker inspect bound host IP '${hostIp}' is not numeric loopback (127.0.0.1)`);
  }
  const hostPort = parseInt(firstBinding.HostPort, 10);
  if (Number.isNaN(hostPort) || hostPort <= 0 || hostPort > 65535) {
    throw new Error(`Docker inspect invalid host port: '${firstBinding.HostPort}'`);
  }

  const binds = record.HostConfig?.Binds;
  if (Array.isArray(binds) && binds.length > 0) {
    throw new Error("Docker inspect shows host binds, which are strictly prohibited");
  }

  if (record.HostConfig?.Privileged === true) {
    throw new Error("Docker inspect shows privileged mode, which is strictly prohibited");
  }
  if (Array.isArray(record.HostConfig?.CapAdd) && record.HostConfig.CapAdd.length > 0) {
    throw new Error("Docker inspect shows added capabilities, which are strictly prohibited");
  }

  const mounts = record.Mounts;
  if (!Array.isArray(mounts)) {
    throw new Error("Docker inspect Mounts must be an array");
  }
  if (mounts.length > 1) {
    throw new Error(`Docker inspect shows persistent/shared mounts, which are strictly prohibited: expected exactly one tmpfs mount, found ${mounts.length}`);
  }

  if (mounts.length === 1) {
    const mount = mounts[0];
    if (!mount || typeof mount !== "object") {
      throw new Error("Docker inspect mount entry is not an object");
    }
    if (mount.Type !== "tmpfs") {
      throw new Error(`Docker inspect shows persistent/shared mounts, which are strictly prohibited: mount Type '${String(mount.Type)}' is not approved 'tmpfs'`);
    }
    if (mount.Destination !== CANONICAL_TMPFS_DESTINATION) {
      throw new Error(`Docker inspect shows persistent/shared mounts, which are strictly prohibited: mount Destination '${String(mount.Destination)}' does not match exact approved '${CANONICAL_TMPFS_DESTINATION}'`);
    }
    if (mount.Source !== "") {
      throw new Error(`Docker inspect shows persistent/shared mounts, which are strictly prohibited: tmpfs mount Source must be empty string, got '${String(mount.Source)}'`);
    }
    if (mount.RW !== true) {
      throw new Error("Docker inspect tmpfs mount RW flag must be true (read/write)");
    }
    if (mount.Propagation !== undefined && mount.Propagation !== "") {
      throw new Error(`Docker inspect tmpfs mount Propagation must be empty, got '${String(mount.Propagation)}'`);
    }
  }

  const hostTmpfs = record.HostConfig?.Tmpfs;
  if (!hostTmpfs || typeof hostTmpfs !== "object" || Array.isArray(hostTmpfs)) {
    throw new Error("Docker inspect missing HostConfig.Tmpfs object");
  }
  const tmpfsKeys = Object.keys(hostTmpfs);
  if (tmpfsKeys.length !== 1 || tmpfsKeys[0] !== CANONICAL_TMPFS_DESTINATION) {
    throw new Error(`Docker inspect HostConfig.Tmpfs must contain exactly '${CANONICAL_TMPFS_DESTINATION}', got: ${tmpfsKeys.join(", ")}`);
  }
  const optionsString = hostTmpfs[CANONICAL_TMPFS_DESTINATION];
  if (typeof optionsString !== "string") {
    throw new Error(`Docker inspect HostConfig.Tmpfs options for '${CANONICAL_TMPFS_DESTINATION}' is not a string`);
  }
  validateTmpfsOptions(optionsString);

  return {
    containerId: id,
    containerName: normalizedName,
    hostPort,
    bindHost: "127.0.0.1",
    runId: expectedRunId,
  };
}

export interface MountNamespaceAttestationRecord {
  readonly mountPoint: string;
  readonly mountOptions: readonly string[];
  readonly filesystemType: string;
  readonly superOptions: readonly string[];
}

function decodeMountInfoField(value: string): string {
  return value.replace(/\\([0-7]{3})/g, (_match, octal: string) => String.fromCharCode(parseInt(octal, 8)));
}

function splitMountInfoOptions(value: string): readonly string[] {
  return value.split(",").map((option) => option.trim()).filter(Boolean);
}

function parseMountInfoLine(line: string, lineNumber: number): MountNamespaceAttestationRecord {
  const separatorIndex = line.indexOf(" - ");
  if (separatorIndex <= 0 || separatorIndex !== line.lastIndexOf(" - ")) {
    throw new Error(`Mount namespace attestation contains malformed record at line ${lineNumber}`);
  }

  const left = line.slice(0, separatorIndex).trim().split(/\s+/);
  const right = line.slice(separatorIndex + 3).trim().split(/\s+/);
  if (left.length < 6 || right.length < 3) {
    throw new Error(`Mount namespace attestation contains incomplete record at line ${lineNumber}`);
  }

  return {
    mountPoint: decodeMountInfoField(left[4]),
    mountOptions: splitMountInfoOptions(left[5]),
    filesystemType: right[0],
    superOptions: splitMountInfoOptions(right[2]),
  };
}

function parseMountInfoSizeBytes(optionValue: string): bigint | undefined {
  const match = /^size=(\d+)([kmg]?)$/i.exec(optionValue);
  if (!match) return undefined;
  const raw = BigInt(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === "k"
    ? 1024n
    : unit === "m"
      ? 1024n * 1024n
      : unit === "g"
        ? 1024n * 1024n * 1024n
        : 1n;
  return raw * multiplier;
}

function parseMountInfoMode(optionValue: string): number | undefined {
  const match = /^mode=([0-7]+)$/.exec(optionValue);
  return match ? parseInt(match[1], 8) : undefined;
}

/**
 * Validate the read-only mount-namespace attestation returned by docker exec.
 * The raw mountinfo payload is intentionally never included in an error.
 */
export function validateMountNamespaceAttestation(mountInfo: string): MountNamespaceAttestationRecord {
  if (typeof mountInfo !== "string" || mountInfo.trim() === "") {
    throw new Error("Mount namespace attestation is empty or invalid");
  }

  const records = mountInfo
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => line.length > 0)
    .map(({ line, lineNumber }) => parseMountInfoLine(line, lineNumber));
  const matches = records.filter((record) => record.mountPoint === CANONICAL_TMPFS_DESTINATION);
  if (matches.length !== 1) {
    throw new Error(`Mount namespace attestation must contain exactly one canonical destination record; found ${matches.length}`);
  }

  const [record] = matches;
  if (record.filesystemType !== "tmpfs") {
    throw new Error("Mount namespace attestation filesystem type must be tmpfs");
  }

  const allOptions = [...record.mountOptions, ...record.superOptions];
  const has = (option: string) => allOptions.includes(option);
  if (!has("rw")) throw new Error("Mount namespace attestation is not read-write");
  if (has("ro")) throw new Error("Mount namespace attestation contains contradictory ro option");
  if (!has("nosuid")) throw new Error("Mount namespace attestation is missing nosuid option");
  if (has("suid")) throw new Error("Mount namespace attestation contains contradictory suid option");
  if (!has("noexec")) throw new Error("Mount namespace attestation is missing noexec option");
  if (has("exec")) throw new Error("Mount namespace attestation contains contradictory exec option");

  const sizeTokens = allOptions.filter((option) => option.startsWith("size="));
  if (sizeTokens.length !== 1 || parseMountInfoSizeBytes(sizeTokens[0]) !== 512n * 1024n * 1024n) {
    throw new Error("Mount namespace attestation size must be exactly 512 MiB");
  }

  const modeTokens = allOptions.filter((option) => option.startsWith("mode="));
  if (modeTokens.length !== 1 || parseMountInfoMode(modeTokens[0]) !== 0o700) {
    throw new Error("Mount namespace attestation mode must be exactly 0700");
  }

  return record;
}

export interface CleanChildEnvOptions {
  readonly databaseUrl: string;
  readonly databaseName: string;
  readonly runId: string;
  readonly phase?: EvidencePhase;
  readonly targetEnvVar?: string;
}

const ALLOWED_OS_ENV_KEYS = new Set([
  "PATH",
  "Path",
  "SystemRoot",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "COMSPEC",
  "PATHEXT",
  "windir",
  "WINDIR",
]);

export const PROTECTED_CHILD_ENV_KEYS_UPPERCASE = new Set([
  "DATABASE_URL",
  "DATABASE_TEST_RUN_ID",
  "DISPOSABLE_TEST_PHASE",
  "DATABASE_TEST_PHASE",
  "DATABASE_TEST_DISPOSABLE",
  "DATABASE_TEST_DATABASE_NAME",
  "ALLOW_DATABASE_TEST_RESET",
  "RELEASE_ID",
  "BUILD_COMMIT_SHA",
  "IMAGE_DIGEST",
  "DEV_DATABASE_URL",
  "DEVELOPMENT_DATABASE_URL",
  "PREVIEW_DATABASE_URL",
  "BANKING_PREVIEW_DATABASE_URL",
  "P0_PREVIEW_DATABASE_URL",
  "RELATIONAL_DATABASE_URL",
  "P0_RELATIONAL_DATABASE_URL",
  "WORKER_DATABASE_URL",
  "ADMIN_DATABASE_URL",
  "ALLOW_DISPOSABLE_DATABASE_RUNNER",
]);

export function buildCleanChildEnvironment(
  options: CleanChildEnvOptions,
  hostEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const cleanEnv: Record<string, string> = {};

  for (const key of Object.keys(hostEnv)) {
    // Case-insensitive filtering of all protected keys (Correction D)
    if (PROTECTED_CHILD_ENV_KEYS_UPPERCASE.has(key.toUpperCase())) {
      continue;
    }
    if (ALLOWED_OS_ENV_KEYS.has(key)) {
      const val = hostEnv[key];
      if (val !== undefined) {
        cleanEnv[key] = val;
      }
    }
  }

  cleanEnv.NODE_ENV = "test";
  cleanEnv.BANKING_ENV = "test";
  cleanEnv.ALLOW_DATABASE_TEST_RESET = "1";
  cleanEnv.DATABASE_TEST_DISPOSABLE = "1";
  cleanEnv.DATABASE_TEST_RUN_ID = options.runId;
  cleanEnv.DATABASE_TEST_DATABASE_NAME = options.databaseName;

  const targetVar = options.targetEnvVar ?? "DATABASE_URL";
  cleanEnv[targetVar] = options.databaseUrl;

  if (options.phase) {
    cleanEnv.DISPOSABLE_TEST_PHASE = options.phase;
  }

  cleanEnv.RELEASE_ID = "local-disposable-test";
  cleanEnv.BUILD_COMMIT_SHA = "test";
  cleanEnv.IMAGE_DIGEST = "unknown";

  return cleanEnv;
}

export interface TargetDatabaseVerificationQuery {
  readonly currentDatabase: string;
  readonly comment: string;
}

export function assertRuntimeDatabaseOwnership(
  catalogInfo: TargetDatabaseVerificationQuery,
  expectedRunId: string,
): void {
  const expectedDbName = `banking_test_${expectedRunId}`;
  if (catalogInfo.currentDatabase !== expectedDbName) {
    throw new Error("Runtime database ownership verification failed: current_database does not match expected target");
  }
  if (!catalogInfo.comment || catalogInfo.comment.trim() === "") {
    throw new Error("Runtime database ownership verification failed: missing database ownership comment");
  }
  assertOwnershipMarkerMatches(catalogInfo.comment, expectedRunId);
}

export function mutateChecksumOneNibble(checksum: string): string {
  if (!/^[a-f0-9]{64}$/.test(checksum)) {
    throw new Error("Invalid checksum: must be exactly 64 lowercase hexadecimal characters.");
  }
  const firstChar = checksum[0];
  const mutatedFirstChar = firstChar === "0" ? "1" : "0";
  const mutated = mutatedFirstChar + checksum.slice(1);
  if (mutated.length !== 64 || mutated === checksum) {
    throw new Error("Checksum mutation invariant violated.");
  }
  return mutated;
}

export interface MigrationRecord {
  readonly migration_key: string;
  readonly checksum: string;
  readonly status: string;
}

export function computeCanonicalMigrationInventory(databaseDir: string): Map<string, string> {
  const fsModule = createRequire(import.meta.url)("node:fs") as typeof import("node:fs");
  const cryptoModule = createRequire(import.meta.url)("node:crypto") as typeof import("node:crypto");
  const pathModule = createRequire(import.meta.url)("node:path") as typeof import("node:path");

  const files = fsModule.readdirSync(databaseDir)
    .filter((fileName: string) => /^\d+_.+\.sql$/i.test(fileName))
    .sort((left: string, right: string) => left.localeCompare(right, "en", { numeric: true }));

  const inventory = new Map<string, string>();
  for (const fileName of files) {
    const filePath = pathModule.join(databaseDir, fileName);
    const sql = fsModule.readFileSync(filePath, "utf8");
    const canonicalSql = sql.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const hash = cryptoModule.createHash("sha256").update(canonicalSql, "utf8").digest("hex");
    const key = fileName.replace(/\.sql$/i, "");
    inventory.set(key, hash);
  }
  return inventory;
}

export function validateMigrationHistoryRecords(
  records: readonly MigrationRecord[],
  canonicalKeys: readonly string[],
  canonicalChecksums?: ReadonlyMap<string, string>,
): void {
  if (records.length !== 40) {
    throw new Error(`Expected exactly 40 migration records, got ${records.length}`);
  }
  if (canonicalKeys.length !== 40) {
    throw new Error(`Expected exactly 40 canonical keys, got ${canonicalKeys.length}`);
  }
  const seenKeys = new Set<string>();
  const expectedKeySet = new Set(canonicalKeys);

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec.status !== "APPLIED") {
      throw new Error(`Migration ${rec.migration_key} has status '${rec.status}', expected 'APPLIED'`);
    }
    if (!/^[a-f0-9]{64}$/.test(rec.checksum)) {
      throw new Error(`Migration ${rec.migration_key} has invalid checksum format`);
    }
    if (seenKeys.has(rec.migration_key)) {
      throw new Error(`Duplicate migration key in history: ${rec.migration_key}`);
    }
    seenKeys.add(rec.migration_key);
    if (!expectedKeySet.has(rec.migration_key)) {
      throw new Error(`Unexpected migration key in history: ${rec.migration_key}`);
    }
    if (canonicalChecksums) {
      const expected = canonicalChecksums.get(rec.migration_key);
      if (expected && rec.checksum !== expected) {
        throw new Error(`Checksum mismatch for ${rec.migration_key} against canonical file`);
      }
    }
  }
  for (const key of canonicalKeys) {
    if (!seenKeys.has(key)) {
      throw new Error(`Missing expected migration key in history: ${key}`);
    }
  }
}

export interface CommandExecutionOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function isExpectedChecksumMismatchRefusal(
  output: CommandExecutionOutput,
  targetKey?: string,
): boolean {
  if (output.exitCode !== 1) {
    return false;
  }
  const combined = `${output.stdout}\n${output.stderr}`;
  const hasMismatchClassification = /Migration checksum mismatch/i.test(combined);
  if (!hasMismatchClassification) {
    return false;
  }
  if (targetKey && !combined.includes(targetKey)) {
    return false;
  }
  if (combined.includes("ECONNREFUSED") || combined.includes("SyntaxError") || combined.includes("ENOENT")) {
    return false;
  }
  return true;
}

export async function verifyDatabaseDroppedInCatalog(
  pool: DisposablePoolClient,
  targetName: string,
  signal?: AbortSignal,
): Promise<void> {
  const result = await pool.query(
    "SELECT COUNT(*)::int AS count FROM pg_database WHERE datname = $1",
    [targetName],
    signal,
  );
  const row = result.rows?.[0] as { count?: number | string } | undefined;
  const count = Number(row?.count ?? -1);
  if (count !== 0) {
    throw new Error(`Post-drop verification failed: target database still present in pg_database (count = ${count}).`);
  }
}

export const CANONICAL_SEQUENCE_STEPS = [
  "1_VERIFY_LOCAL_IMAGE",
  "2_CREATE_EPHEMERAL_CONTAINER",
  "3_INSPECT_VALIDATE_CONTAINER",
  "4_WAIT_READINESS",
  "5_CREATE_TARGET_DATABASE_AND_MARKER",
  "6_APPLY_MIGRATIONS_RUN_1",
  "7_CHILD_TEST_INITIAL_HISTORY",
  "8_APPLY_MIGRATIONS_RUN_2",
  "9_CHILD_TEST_RERUN_HISTORY",
  "10_VERIFY_ONLY_PRE_MISMATCH",
  "11_CHILD_TEST_INJECT_CHECKSUM_MISMATCH",
  "12_VERIFY_ONLY_EXPECT_REFUSAL",
  "13_CHILD_TEST_RESTORE_CHECKSUM",
  "14_VERIFY_ONLY_POST_RESTORE_SUCCESS",
  "15_CLOSE_TARGET_CONNECTIONS",
  "16_CLEANUP_TARGET_DATABASE",
  "17_PARENT_POST_DROP_CATALOG_CHECK",
  "18_REMOVE_CONTAINER",
  "19_VALIDATE_COMPLETION",
] as const;
export type CanonicalSequenceStep = (typeof CANONICAL_SEQUENCE_STEPS)[number];


export interface DockerAdapter {
  inspectImage(image: string, signal?: AbortSignal, timeoutMs?: number): Promise<string>;
  runContainer(args: readonly string[], signal?: AbortSignal, timeoutMs?: number): Promise<string>;
  inspectContainer(containerNameOrId: string, signal?: AbortSignal, timeoutMs?: number): Promise<string>;
  attestMountNamespace(containerId: string, signal?: AbortSignal, timeoutMs?: number): Promise<string>;
  removeContainer(containerId: string, signal?: AbortSignal, timeoutMs?: number): Promise<void>;
  waitForReady(host: string, port: number, timeoutMs?: number, signal?: AbortSignal): Promise<void>;
}

export type RunCommandWithOutputFunction = (
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs?: number,
  signal?: AbortSignal,
) => Promise<CommandExecutionOutput>;

/**
 * Execute command with argv array (no shell) capturing stdout/stderr and handling timeout and abort signal.
 */
export async function executeCommandWithOutput(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs: number = DISPOSABLE_TIMEOUTS.commandTimeoutMs,
  signal?: AbortSignal,
): Promise<CommandExecutionOutput> {
  return new Promise<CommandExecutionOutput>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;

    const child = spawn(command, [...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (signal && abortListener) signal.removeEventListener("abort", abortListener);
    };

    if (signal) {
      if (signal.aborted) {
        child.kill("SIGTERM");
        reject(new Error(`Command '${path.basename(command)}' was aborted before execution.`));
        return;
      }
      abortListener = () => {
        child.kill("SIGTERM");
        cleanup();
        reject(new Error(`Command '${path.basename(command)}' aborted: ${String(signal.reason)}`));
      };
      signal.addEventListener("abort", abortListener, { once: true });
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        cleanup();
        reject(new Error(`Command '${path.basename(command)}' timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    }

    child.once("error", (err) => {
      cleanup();
      reject(err);
    });

    child.once("close", (code) => {
      cleanup();
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

/**
 * Real production Docker CLI adapter using explicit argv arrays, no shell, with timeout and cancellation.
 */
export const realDockerAdapter: DockerAdapter = {
  async inspectImage(image: string, signal?: AbortSignal, timeoutMs = 30_000): Promise<string> {
    const args = buildDockerImageInspectArgs(image);
    const result = await executeCommandWithOutput("docker", args, process.env, timeoutMs, signal);
    if (result.exitCode !== 0) {
      throw new Error(`Required Docker image '${image}' not found locally. Implicit image pulling is strictly prohibited.`);
    }
    return result.stdout;
  },

  async runContainer(args: readonly string[], signal?: AbortSignal, timeoutMs = 60_000): Promise<string> {
    const result = await executeCommandWithOutput("docker", args, process.env, timeoutMs, signal);
    if (result.exitCode !== 0) {
      const sanitizedErr = sanitizeLogOutput(result.stderr || result.stdout);
      throw new Error(`docker run failed with exit code ${result.exitCode}: ${sanitizedErr}`);
    }
    return result.stdout.trim();
  },

  async inspectContainer(containerNameOrId: string, signal?: AbortSignal, timeoutMs = 30_000): Promise<string> {
    const args = buildDockerInspectArgs(containerNameOrId);
    const result = await executeCommandWithOutput("docker", args, process.env, timeoutMs, signal);
    if (result.exitCode !== 0) {
      const sanitizedErr = sanitizeLogOutput(result.stderr || result.stdout);
      throw new Error(`docker inspect failed with exit code ${result.exitCode}: ${sanitizedErr}`);
    }
    return result.stdout;
  },

  async attestMountNamespace(containerId: string, signal?: AbortSignal, timeoutMs = 30_000): Promise<string> {
    const args = buildDockerExecMountinfoArgs(containerId);
    const result = await executeCommandWithOutput("docker", args, process.env, timeoutMs, signal);
    if (result.exitCode !== 0) {
      throw new Error("docker exec mount-namespace attestation failed");
    }
    return result.stdout;
  },

  async removeContainer(containerId: string, signal?: AbortSignal, timeoutMs = 30_000): Promise<void> {
    const args = buildDockerRmArgs(containerId);
    const result = await executeCommandWithOutput("docker", args, process.env, timeoutMs, signal);
    if (result.exitCode !== 0) {
      const sanitizedErr = sanitizeLogOutput(result.stderr || result.stdout);
      throw new Error(`docker rm failed with exit code ${result.exitCode}: ${sanitizedErr}`);
    }
  },

  async waitForReady(host: string, port: number, timeoutMs = 60_000, signal?: AbortSignal): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (signal?.aborted) {
        throw new Error(`Readiness wait aborted: ${String(signal.reason)}`);
      }
      const isReady = await new Promise<boolean>((resolve) => {
        const socket = net.createConnection({ host, port });
        socket.setTimeout(2000);
        socket.once("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.once("error", () => {
          socket.destroy();
          resolve(false);
        });
        socket.once("timeout", () => {
          socket.destroy();
          resolve(false);
        });
      });
      if (isReady) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`PostgreSQL container port ${port} did not become ready within ${timeoutMs}ms.`);
  },
};

export interface CanonicalSequenceDependencies {
  readonly dockerAdapter?: DockerAdapter;
  readonly runCommandFn?: RunCommandWithOutputFunction;
  readonly createPoolFn?: CreatePoolFunction;
  readonly runIdGenerator?: () => string;
  readonly processEmitter?: ProcessInterruptionEmitter;
  readonly processFacade?: ProcessFacade;
  readonly commandTimeoutMs?: number;
  readonly cleanupTimeoutMs?: number;
}

export interface CanonicalSequenceExecutionResult {
  readonly success: boolean;
  readonly runId: string;
  readonly databaseName: string;
  readonly containerId?: string;
  readonly completedSteps: readonly CanonicalSequenceStep[];
  readonly error?: Error;
  readonly cleanupError?: Error;
}

/**
 * Coordinate canonical 19-step evidence sequence orchestration.
 */
export async function runCanonicalEvidenceSequence(
  hostEnv: NodeJS.ProcessEnv = process.env,
  deps: CanonicalSequenceDependencies = {},
): Promise<CanonicalSequenceExecutionResult> {
  const completedSteps: CanonicalSequenceStep[] = [];
  const runId = (deps.runIdGenerator ?? generateDisposableRunId)();
  const containerName = `banking_test_container_${runId}`;
  const databaseName = `banking_test_${runId}`;
  const docker = deps.dockerAdapter ?? realDockerAdapter;
  const runCmd = deps.runCommandFn ?? executeCommandWithOutput;
  const commandTimeoutMs = deps.commandTimeoutMs ?? DISPOSABLE_TIMEOUTS.commandTimeoutMs;
  const cleanupTimeoutMs = deps.cleanupTimeoutMs ?? DISPOSABLE_TIMEOUTS.cleanupTimeoutMs;
  const facade = deps.processFacade;
  const backendRoot = path.resolve(import.meta.dirname, "../..");

  let approvedLocalImageId: string | undefined;
  let launchedContainerId: string | undefined;
  let adminPool: DisposablePoolClient | undefined;
  let targetUrl: string | undefined;
  let mainError: Error | undefined;
  let cleanupError: Error | undefined;

  const childAbortController = new AbortController();

  const recordStep = (step: CanonicalSequenceStep) => {
    completedSteps.push(step);
  };

  const performCanonicalCleanup = async (): Promise<void> => {
    const cleanupAbortController = new AbortController();
    let cleanupTimer: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      cleanupTimer = setTimeout(() => {
        const err = new Error(`Canonical cleanup timed out after ${cleanupTimeoutMs}ms.`);
        cleanupAbortController.abort(err);
        reject(err);
      }, cleanupTimeoutMs);
    });

    const cleanupActions = async (): Promise<void> => {
      // 1. Close target connections
      recordStep("15_CLOSE_TARGET_CONNECTIONS");

      // 2. Drop target database via admin pool
      if (adminPool && targetUrl) {
        try {
          recordStep("16_CLEANUP_TARGET_DATABASE");
          await adminPool.query(`DROP DATABASE IF EXISTS ${quoteDatabaseIdentifier(databaseName)} WITH (FORCE)`, undefined, cleanupAbortController.signal);
        } catch (err) {
          if (!cleanupError) cleanupError = err instanceof Error ? err : new Error(String(err));
        }

        // 3. Post-drop catalog assertion
        try {
          recordStep("17_PARENT_POST_DROP_CATALOG_CHECK");
          await verifyDatabaseDroppedInCatalog(adminPool, databaseName, cleanupAbortController.signal);
        } catch (err) {
          if (!cleanupError) cleanupError = err instanceof Error ? err : new Error(String(err));
        }
      }

      // 4. Remove exact launched container (NEVER untrusted inspect ID, Correction B)
      if (launchedContainerId) {
        try {
          recordStep("18_REMOVE_CONTAINER");
          await docker.removeContainer(launchedContainerId, cleanupAbortController.signal, cleanupTimeoutMs);
        } catch (err) {
          if (!cleanupError) cleanupError = err instanceof Error ? err : new Error(String(err));
        }
      }

      // 5. Close admin pool
      if (adminPool) {
        try {
          await adminPool.end();
        } catch {
          // Best effort pool close
        }
      }
    };

    try {
      await Promise.race([cleanupActions(), timeoutPromise]);
    } catch (err) {
      if (!cleanupError) cleanupError = err instanceof Error ? err : new Error(String(err));
    } finally {
      if (cleanupTimer) clearTimeout(cleanupTimer);
    }
  };

  try {
    // Step 1: Verify local image and capture immutable image ID (Correction A)
    recordStep("1_VERIFY_LOCAL_IMAGE");
    const imageInspectJson = await docker.inspectImage("postgres:16", childAbortController.signal);
    approvedLocalImageId = validateDockerImageInspectOutput(imageInspectJson, "postgres:16");

    // Step 2: Create ephemeral container and validate launched container ID (Correction B)
    recordStep("2_CREATE_EPHEMERAL_CONTAINER");
    const runArgs = buildDockerRunArgs({ containerName, runId });
    const runStdout = await docker.runContainer(runArgs, childAbortController.signal);
    launchedContainerId = parseAndValidateLaunchedContainerId(runStdout);

    // Step 3: Inspect & validate container using exact launched container ID & approved local image ID
    recordStep("3_INSPECT_VALIDATE_CONTAINER");
    const inspectJson = await docker.inspectContainer(launchedContainerId, childAbortController.signal);
    const validated = validateDockerInspectOutput(
      inspectJson,
      containerName,
      runId,
      approvedLocalImageId,
      launchedContainerId,
    );

    // Mounts=[] is a valid Docker Desktop representation for legacy --tmpfs,
    // so the exact launched container must attest its mount namespace before
    // readiness, database creation, or a migration action.
    const mountInfo = await docker.attestMountNamespace(
      launchedContainerId,
      childAbortController.signal,
      commandTimeoutMs,
    );
    validateMountNamespaceAttestation(mountInfo);

    // Step 4: Wait readiness
    recordStep("4_WAIT_READINESS");
    await docker.waitForReady(validated.bindHost, validated.hostPort, 60_000, childAbortController.signal);

    // Step 5: Create target database & ownership marker
    recordStep("5_CREATE_TARGET_DATABASE_AND_MARKER");
    const adminUrl = `postgresql://postgres:banking_test_secret@${validated.bindHost}:${validated.hostPort}/postgres`;
    adminPool = deps.createPoolFn
      ? deps.createPoolFn(adminUrl, undefined)
      : new Pool({
          connectionString: adminUrl,
          max: 1,
          connectionTimeoutMillis: DISPOSABLE_TIMEOUTS.poolConnectionMs,
        });

    await adminPool.query(`CREATE DATABASE ${quoteDatabaseIdentifier(databaseName)}`, undefined, childAbortController.signal);
    const marker = buildOwnershipMarker({
      runId,
      owner: "m01_runner",
      createdAt: Date.now(),
    });
    await adminPool.query(`COMMENT ON DATABASE ${quoteDatabaseIdentifier(databaseName)} IS '${marker}'`, undefined, childAbortController.signal);

    targetUrl = `postgresql://postgres:banking_test_secret@${validated.bindHost}:${validated.hostPort}/${databaseName}`;
    const childEnv = buildCleanChildEnvironment(
      {
        databaseUrl: targetUrl,
        databaseName,
        runId,
      },
      hostEnv,
    );

    const applyMigrationScript = path.join(backendRoot, "scripts", "apply-migration.cjs");
    const tsxCli = path.join(backendRoot, "node_modules", "tsx", "dist", "cli.mjs");
    const runtimeTestPath = path.join(backendRoot, "src", "tests", "disposableMigrationRuntime.test.ts");

    // Helper to execute child Node command with clean env
    const executeChild = async (
      args: readonly string[],
      envOverrides: NodeJS.ProcessEnv = {},
    ): Promise<CommandExecutionOutput> => {
      const execEnv: NodeJS.ProcessEnv = {
        ...childEnv,
        ...envOverrides,
      };
      return runCmd(process.execPath, args, execEnv, commandTimeoutMs, childAbortController.signal);
    };

    // Step 6: Apply migrations run 1
    recordStep("6_APPLY_MIGRATIONS_RUN_1");
    const m1Res = await executeChild([applyMigrationScript]);
    if (m1Res.exitCode !== 0) {
      throw new Error(`Initial migration apply failed with exit code ${m1Res.exitCode}: ${sanitizeLogOutput(m1Res.stderr)}`);
    }

    // Step 7: Child test phase INITIAL_HISTORY
    recordStep("7_CHILD_TEST_INITIAL_HISTORY");
    const t1Res = await executeChild(
      [tsxCli, "--test", "--test-concurrency=1", runtimeTestPath],
      { DISPOSABLE_TEST_PHASE: "INITIAL_HISTORY" },
    );
    if (t1Res.exitCode !== 0) {
      throw new Error(`INITIAL_HISTORY runtime test failed with exit code ${t1Res.exitCode}: ${sanitizeLogOutput(t1Res.stderr)}`);
    }

    // Step 8: Apply migrations run 2 (rerun)
    recordStep("8_APPLY_MIGRATIONS_RUN_2");
    const m2Res = await executeChild([applyMigrationScript]);
    if (m2Res.exitCode !== 0) {
      throw new Error(`Rerun migration apply failed with exit code ${m2Res.exitCode}: ${sanitizeLogOutput(m2Res.stderr)}`);
    }

    // Step 9: Child test phase RERUN_HISTORY
    recordStep("9_CHILD_TEST_RERUN_HISTORY");
    const t2Res = await executeChild(
      [tsxCli, "--test", "--test-concurrency=1", runtimeTestPath],
      { DISPOSABLE_TEST_PHASE: "RERUN_HISTORY" },
    );
    if (t2Res.exitCode !== 0) {
      throw new Error(`RERUN_HISTORY runtime test failed with exit code ${t2Res.exitCode}: ${sanitizeLogOutput(t2Res.stderr)}`);
    }

    // Step 10: Verify-only pre-mismatch
    recordStep("10_VERIFY_ONLY_PRE_MISMATCH");
    const v1Res = await executeChild([applyMigrationScript, "--verify-only"]);
    if (v1Res.exitCode !== 0) {
      throw new Error(`Pre-mismatch verify-only failed with exit code ${v1Res.exitCode}: ${sanitizeLogOutput(v1Res.stderr)}`);
    }

    // Step 11: Child test phase INJECT_CHECKSUM_MISMATCH
    recordStep("11_CHILD_TEST_INJECT_CHECKSUM_MISMATCH");
    const t3Res = await executeChild(
      [tsxCli, "--test", "--test-concurrency=1", runtimeTestPath],
      { DISPOSABLE_TEST_PHASE: "INJECT_CHECKSUM_MISMATCH" },
    );
    if (t3Res.exitCode !== 0) {
      throw new Error(`INJECT_CHECKSUM_MISMATCH runtime test failed with exit code ${t3Res.exitCode}: ${sanitizeLogOutput(t3Res.stderr)}`);
    }

    // Step 12: Verify-only expect refusal
    recordStep("12_VERIFY_ONLY_EXPECT_REFUSAL");
    const v2Res = await executeChild([applyMigrationScript, "--verify-only"]);
    if (!isExpectedChecksumMismatchRefusal(v2Res, "001_banking_mvp")) {
      throw new Error(`Expected checksum mismatch refusal was not met: exitCode=${v2Res.exitCode}, stderr=${sanitizeLogOutput(v2Res.stderr)}`);
    }

    // Step 13: Child test phase RESTORE_CHECKSUM
    recordStep("13_CHILD_TEST_RESTORE_CHECKSUM");
    const t4Res = await executeChild(
      [tsxCli, "--test", "--test-concurrency=1", runtimeTestPath],
      { DISPOSABLE_TEST_PHASE: "RESTORE_CHECKSUM" },
    );
    if (t4Res.exitCode !== 0) {
      throw new Error(`RESTORE_CHECKSUM runtime test failed with exit code ${t4Res.exitCode}: ${sanitizeLogOutput(t4Res.stderr)}`);
    }

    // Step 14: Verify-only post-restore success
    recordStep("14_VERIFY_ONLY_POST_RESTORE_SUCCESS");
    const v3Res = await executeChild([applyMigrationScript, "--verify-only"]);
    if (v3Res.exitCode !== 0) {
      throw new Error(`Post-restore verify-only failed with exit code ${v3Res.exitCode}: ${sanitizeLogOutput(v3Res.stderr)}`);
    }

    recordStep("19_VALIDATE_COMPLETION");
  } catch (err) {
    mainError = err instanceof Error ? err : new Error(String(err));
    if (facade && !facade.exitCode) {
      facade.exitCode = 1;
    }
  } finally {
    await performCanonicalCleanup();
  }

  const finalError = mainError ?? cleanupError;
  if (finalError) {
    if (facade && !facade.exitCode) {
      facade.exitCode = 1;
    }
    return {
      success: false,
      runId,
      databaseName,
      containerId: launchedContainerId,
      completedSteps,
      error: finalError,
      cleanupError,
    };
  }

  return {
    success: true,
    runId,
    databaseName,
    containerId: launchedContainerId,
    completedSteps,
  };
}

export const CANONICAL_RUNTIME_TEST_PATH = "src/tests/disposableMigrationRuntime.test.ts";

export function isCanonicalRuntimePath(testPath: string): boolean {
  return testPath === CANONICAL_RUNTIME_TEST_PATH;
}

export function isReservedCanonicalRuntimeCandidate(arg: string): boolean {
  const normalized = arg.trim().replace(/\\/g, "/").toLowerCase();
  return (
    normalized.includes("disposablemigrationruntime.test.ts") ||
    normalized.includes("disposablemigrationruntime")
  );
}

export interface CliDispatcherDependencies {
  readonly processFacade?: ProcessFacade;
  readonly canonicalRunnerFn?: (
    hostEnv?: NodeJS.ProcessEnv,
    deps?: CanonicalSequenceDependencies,
  ) => Promise<CanonicalSequenceExecutionResult>;
  readonly legacyRunnerFn?: (
    testFiles: readonly string[],
    env?: NodeJS.ProcessEnv,
    deps?: DisposableRunnerDependencies,
  ) => Promise<RunnerExecutionResult>;
  readonly canonicalDeps?: CanonicalSequenceDependencies;
  readonly legacyDeps?: DisposableRunnerDependencies;
  readonly logErrorFn?: (message: string) => void;
}

export interface CliDispatchResult {
  readonly handled: "CANONICAL" | "LEGACY" | "REJECTED";
  readonly success: boolean;
  readonly error?: Error;
  readonly cleanupError?: Error;
}

export async function dispatchCliRun(
  argv: readonly string[],
  hostEnv: NodeJS.ProcessEnv = process.env,
  deps: CliDispatcherDependencies = {},
): Promise<CliDispatchResult> {
  const testFiles = argv.slice(2);
  const facade = deps.processFacade;

  const hasCanonical = testFiles.some(isCanonicalRuntimePath);

  // Branch 1 & 2: Exact canonical target present
  if (hasCanonical) {
    if (testFiles.length !== 1) {
      // Branch 2: Exact canonical combined with other arguments -> fail-closed before both runners
      const err = new Error(
        `Canonical runtime test target '${CANONICAL_RUNTIME_TEST_PATH}' cannot be combined with additional arguments.`,
      );
      if (facade) {
        facade.exitCode = 1;
      }
      return {
        handled: "REJECTED",
        success: false,
        error: err,
      };
    }

    // Branch 1: Exact single canonical target -> execute canonical sequence
    const runner = deps.canonicalRunnerFn ?? runCanonicalEvidenceSequence;
    const canonicalDeps: CanonicalSequenceDependencies = {
      processFacade: facade,
      ...(deps.canonicalDeps ?? {}),
    };

    try {
      const result = await runner(hostEnv, canonicalDeps);
      if (!result.success) {
        if (facade) {
          facade.exitCode = 1;
        }
        return {
          handled: "CANONICAL",
          success: false,
          error: result.error,
          cleanupError: result.cleanupError,
        };
      }
      return {
        handled: "CANONICAL",
        success: true,
      };
    } catch (err) {
      if (facade) {
        facade.exitCode = 1;
      }
      const caughtError = err instanceof Error ? err : new Error(String(err));
      return {
        handled: "CANONICAL",
        success: false,
        error: caughtError,
      };
    }
  }

  // Branch 3: Any non-exact argument that has indication of being canonical runtime target or alias -> fail-closed before both runners
  const reservedCandidate = testFiles.find(isReservedCanonicalRuntimeCandidate);
  if (reservedCandidate) {
    const err = new Error(
      `Non-exact canonical runtime alias '${sanitizeLogOutput(reservedCandidate)}' is rejected; only exact '${CANONICAL_RUNTIME_TEST_PATH}' may execute canonical evidence sequence.`,
    );
    if (facade) {
      facade.exitCode = 1;
    }
    return {
      handled: "REJECTED",
      success: false,
      error: err,
    };
  }

  // Branch 4: Genuine legacy targets -> legacy runner
  const legacyRunner = deps.legacyRunnerFn ?? runDisposablePostgresTest;
  const legacyDeps: DisposableRunnerDependencies = {
    processFacade: facade,
    ...(deps.legacyDeps ?? {}),
  };

  try {
    const result = await legacyRunner(testFiles, hostEnv, legacyDeps);
    if (!result.success) {
      if (facade) {
        facade.exitCode = 1;
      }
      return {
        handled: "LEGACY",
        success: false,
        error: result.error,
        cleanupError: result.cleanupError,
      };
    }
    return {
      handled: "LEGACY",
      success: true,
    };
  } catch (err) {
    if (facade) {
      facade.exitCode = 1;
    }
    const caughtError = err instanceof Error ? err : new Error(String(err));
    return {
      handled: "LEGACY",
      success: false,
      error: caughtError,
    };
  }
}

export async function runCliMain(
  argv: readonly string[] = process.argv,
  hostEnv: NodeJS.ProcessEnv = process.env,
  deps: CliDispatcherDependencies = {},
): Promise<CliDispatchResult> {
  const facade = deps.processFacade ?? process;
  const logError = deps.logErrorFn ?? console.error;

  try {
    const result = await dispatchCliRun(argv, hostEnv, { ...deps, processFacade: facade });
    if (!result.success) {
      if (result.error) {
        logError(sanitizeLogOutput(result.error.message));
      }
      if (result.cleanupError) {
        logError(sanitizeLogOutput(result.cleanupError.message));
      }
      facade.exitCode = 1;
    }
    return result;
  } catch (err: unknown) {
    logError(err instanceof Error ? sanitizeLogOutput(err.message) : "[REDACTED_ERROR]");
    facade.exitCode = 1;
    return {
      handled: "REJECTED",
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

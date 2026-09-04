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
  exitCode?: number;
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

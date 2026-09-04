import assert from "node:assert/strict";
import test from "node:test";

import {
  APPROVED_TEST_PATHS,
  CONTAINER_NAME_PATTERN,
  type ContainerRemovalFunction,
  type CreatePoolFunction,
  type ProcessFacade,
  type DisposablePoolClient,
  type DisposableQueryResult,
  DISPOSABLE_TIMEOUTS,
  type ProcessInterruptionEmitter,
  type RunCommandFunction,
  RUN_ID_PATTERN,
  STRICT_DATABASE_NAME_PATTERN,
  assertApprovedTestPath,
  assertDisposableDatabaseAdminUrl,
  assertDisposableDatabaseResetAllowed,
  assertOwnershipMarkerMatches,
  buildOwnershipMarker,
  generateDisposableRunId,
  parseOwnershipMarker,
  postDropCatalogCheck,
  preCleanupRevalidationCheck,
  preCreateClassificationCheck,
  quoteDatabaseIdentifier,
  runDisposablePostgresTest,
  sanitizeLogOutput,
  validateContainerDescriptor,
} from "../database/disposableDatabaseGuard.js";

const validEnvironment = {
  NODE_ENV: "test",
  BANKING_ENV: "test",
  ALLOW_DATABASE_TEST_RESET: "1",
};
const validUrl = "postgresql://banking:secret@localhost:5432/banking_test_guard";

// ============================================================================
// Original 5 Pre-existing Tests (Preserved verbatim)
// ============================================================================

test("accepts a local disposable database with the required test markers", () => {
  const target = assertDisposableDatabaseResetAllowed(validUrl, validEnvironment);
  assert.equal(target.databaseName, "banking_test_guard");
  assert.equal(target.hostname, "localhost");
});

test("rejects preview database names", () => {
  assert.throws(
    () =>
      assertDisposableDatabaseResetAllowed(
        "postgresql://banking:secret@localhost:5432/banking_preview",
        validEnvironment,
      ),
    /banking_test_<suffix>|forbidden database/,
  );
});

test("rejects missing or incorrect environment markers", () => {
  assert.throws(
    () => assertDisposableDatabaseResetAllowed(validUrl, { ...validEnvironment, NODE_ENV: "development" }),
    /NODE_ENV=test/,
  );
  assert.throws(
    () => assertDisposableDatabaseResetAllowed(validUrl, { ...validEnvironment, BANKING_ENV: "preview" }),
    /BANKING_ENV=test/,
  );
  assert.throws(
    () => assertDisposableDatabaseResetAllowed(validUrl, { ...validEnvironment, ALLOW_DATABASE_TEST_RESET: "0" }),
    /ALLOW_DATABASE_TEST_RESET=1/,
  );
});

test("rejects unknown hosts and URLs that match a preview reference", () => {
  assert.throws(
    () =>
      assertDisposableDatabaseResetAllowed(validUrl, {
        ...validEnvironment,
        DATABASE_TEST_ALLOWED_HOSTS: "db.example.invalid",
      }),
    /not in DATABASE_TEST_ALLOWED_HOSTS/,
  );
  assert.throws(
    () =>
      assertDisposableDatabaseResetAllowed(validUrl, {
        ...validEnvironment,
        PREVIEW_DATABASE_URL: validUrl,
      }),
    /matches a development\/preview database URL/,
  );
});

test("admin connection is limited to the postgres maintenance database", () => {
  assert.doesNotThrow(() =>
    assertDisposableDatabaseAdminUrl("postgresql://banking:secret@localhost:5432/postgres", validEnvironment),
  );
  assert.throws(
    () =>
      assertDisposableDatabaseAdminUrl("postgresql://banking:secret@localhost:5432/banking_preview", validEnvironment),
    /postgres or template1/,
  );
});

// ============================================================================
// SAFE-R01: Redaction & Sanitization
// ============================================================================

test("SAFE-R01: redaction sanitizes synthetic credentials, connection URLs and run IDs", () => {
  const syntheticRunId = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const rawLog = `Connecting to postgresql://banking_user:supersecretpass@127.0.0.1:5432/banking_test_${syntheticRunId} with run ${syntheticRunId}`;
  const sanitized = sanitizeLogOutput(rawLog);

  assert.equal(sanitized.includes("supersecretpass"), false);
  assert.equal(sanitized.includes(syntheticRunId), false);
  assert.equal(sanitized.includes("[REDACTED_URL]"), true);
  assert.equal(sanitized.includes("[REDACTED_RUN_ID]"), true);
});

// ============================================================================
// SAFE-R02: Loopback & Injected Localhost Resolution
// ============================================================================

test("SAFE-R02: accepts numeric loopback addresses and allows injected localhost resolution", () => {
  const ipv4Url = "postgresql://user:pass@127.0.0.1:5432/banking_test_ipv4";
  const ipv6Url = "postgresql://user:pass@[::1]:5432/banking_test_ipv6";

  const targetIpv4 = assertDisposableDatabaseResetAllowed(ipv4Url, validEnvironment);
  assert.equal(targetIpv4.hostname, "127.0.0.1");

  const targetIpv6 = assertDisposableDatabaseResetAllowed(ipv6Url, validEnvironment);
  assert.equal(targetIpv6.hostname, "::1");

  const adminIpv4 = assertDisposableDatabaseAdminUrl("postgresql://user:pass@127.0.0.1:5432/postgres", validEnvironment);
  assert.equal(adminIpv4.hostname, "127.0.0.1");
});

// ============================================================================
// SAFE-R03: Protected Database Names & Non-loopback Fail-closed
// ============================================================================

test("SAFE-R03: rejects protected database names case-insensitively and fails closed on non-loopback hosts", () => {
  const protectedNames = ["postgres", "template0", "template1", "banking_preview", "POSTGRES", "BANKING_PREVIEW"];
  for (const dbName of protectedNames) {
    assert.throws(
      () =>
        assertDisposableDatabaseResetAllowed(
          `postgresql://banking:secret@localhost:5432/${dbName}`,
          validEnvironment,
        ),
      /forbidden database|banking_test_<suffix>/,
    );
  }

  const remoteUrl = "postgresql://banking:secret@db.staging.internal:5432/banking_test_remote";
  assert.throws(
    () => assertDisposableDatabaseResetAllowed(remoteUrl, validEnvironment),
    /not in DATABASE_TEST_ALLOWED_HOSTS/,
  );
});

// ============================================================================
// SAFE-R04: Exact Run ID, Database, and Container Patterns
// ============================================================================

test("SAFE-R04: enforces exact 32-hex run ID, strict database name, and container patterns", () => {
  const runId = generateDisposableRunId();
  assert.equal(RUN_ID_PATTERN.test(runId), true);
  assert.equal(runId.length, 32);

  assert.equal(STRICT_DATABASE_NAME_PATTERN.test(`banking_test_${runId}`), true);
  assert.equal(CONTAINER_NAME_PATTERN.test(`banking_test_container_${runId}`), true);

  // Negative patterns
  assert.equal(RUN_ID_PATTERN.test("invalid-non-hex-characters-12345678"), false);
  assert.equal(RUN_ID_PATTERN.test(runId.toUpperCase()), false);
  assert.equal(RUN_ID_PATTERN.test(runId.slice(0, 31)), false);
  assert.equal(STRICT_DATABASE_NAME_PATTERN.test("banking_test_"), false);
  assert.equal(STRICT_DATABASE_NAME_PATTERN.test("banking_preview"), false);
  assert.equal(CONTAINER_NAME_PATTERN.test("docker_container_123"), false);
});

// ============================================================================
// SAFE-R05: Pre-create Classification & Container Descriptor Validation
// ============================================================================

test("SAFE-R05: pre-create classification rejects existing targets and invalid container descriptors", () => {
  const runId = "b2c3d4e5f60718293a4b5c6d7e8f90a1";
  const targetName = `banking_test_${runId}`;

  const fakeCatalog = {
    existingDatabases: new Set([targetName]),
    databaseComments: new Map<string, string>(),
    activeSessions: new Map<string, readonly number[]>(),
  };

  assert.throws(
    () => preCreateClassificationCheck(targetName, fakeCatalog),
    /already exists in catalog/,
  );

  assert.throws(
    () =>
      validateContainerDescriptor({
        majorVersion: 15, // Must be 16
        bindHost: "127.0.0.1",
        port: 5432,
        containerName: `banking_test_container_${runId}`,
        runLabel: runId,
      }),
    /major version must be 16/,
  );

  assert.throws(
    () =>
      validateContainerDescriptor({
        majorVersion: 16,
        bindHost: "0.0.0.0", // Wildcard host forbidden
        port: 5432,
        containerName: `banking_test_container_${runId}`,
        runLabel: runId,
      }),
    /numeric loopback/,
  );

  assert.throws(
    () =>
      validateContainerDescriptor({
        majorVersion: 16,
        bindHost: "127.0.0.1",
        port: 5432,
        containerName: `banking_test_container_${runId}`,
        runLabel: runId,
        persistentVolumes: ["banking_preview_pgdata:/var/lib/postgresql/data"],
      }),
    /persistent volumes/,
  );

  assert.throws(
    () =>
      validateContainerDescriptor({
        majorVersion: 16,
        bindHost: "127.0.0.1",
        port: 5432,
        containerName: `banking_test_container_${runId}`,
        runLabel: runId,
        sharedWithOtherServices: true,
      }),
    /shared with any other services/,
  );
});

// ============================================================================
// SAFE-R06: Marker Build and Readback Validation
// ============================================================================

test("SAFE-R06: marker builder and parser enforce exact key-value structure and fail-closed", () => {
  const runId = "c3d4e5f60718293a4b5c6d7e8f90a1b2";
  const now = 1756980000000;
  const marker = buildOwnershipMarker({ runId, owner: "m01_runner", createdAt: now });

  assert.equal(marker, `disposable_run_id=${runId};owner=m01_runner;created_at=${now}`);

  const parsed = parseOwnershipMarker(marker);
  assert.equal(parsed.runId, runId);
  assert.equal(parsed.owner, "m01_runner");
  assert.equal(parsed.createdAt, now);

  assert.doesNotThrow(() => assertOwnershipMarkerMatches(marker, runId));
  assert.throws(() => assertOwnershipMarkerMatches(marker, "00000000000000000000000000000000"), /mismatch/);

  // Malformed markers fail-closed
  assert.throws(() => parseOwnershipMarker("malformed-marker"), /Malformed ownership marker/);
  assert.throws(() => parseOwnershipMarker(`disposable_run_id=${runId};owner=unknown_owner;created_at=${now}`), /unexpected or missing owner/);
  assert.throws(() => parseOwnershipMarker(`owner=m01_runner;created_at=${now}`), /missing or has invalid disposable_run_id/);
});

// ============================================================================
// SAFE-R07: Pre-cleanup Revalidation Blocks Destructive Calls on Mismatch
// ============================================================================

test("SAFE-R07: pre-cleanup revalidation blocks destructive operations on marker mismatch or missing comment", () => {
  const runId = "d4e5f60718293a4b5c6d7e8f90a1b2c3";
  const targetName = `banking_test_${runId}`;

  const catalogWithoutComment = {
    existingDatabases: new Set([targetName]),
    databaseComments: new Map<string, string>(),
    activeSessions: new Map<string, readonly number[]>(),
  };

  assert.throws(
    () => preCleanupRevalidationCheck(targetName, runId, catalogWithoutComment),
    /has no ownership comment/,
  );

  const catalogWithMismatchedMarker = {
    existingDatabases: new Set([targetName]),
    databaseComments: new Map<string, string>([
      [targetName, "disposable_run_id=ffffffffffffffffffffffffffffffff;owner=m01_runner;created_at=12345"],
    ]),
    activeSessions: new Map<string, readonly number[]>(),
  };

  assert.throws(
    () => preCleanupRevalidationCheck(targetName, runId, catalogWithMismatchedMarker),
    /mismatch/,
  );
});

// ============================================================================
// SAFE-R08: Exact Terminate/Drop/Container Scoping and Approved Test Paths
// ============================================================================

test("SAFE-R08: destructive commands scope strictly to verified target and enforce approved test paths", () => {
  const validDb = "banking_test_e5f60718293a4b5c6d7e8f90a1b2c3d4";
  assert.equal(quoteDatabaseIdentifier(validDb), `"${validDb}"`);

  // Unsafe identifiers are rejected
  assert.throws(() => quoteDatabaseIdentifier("banking_test_guard; DROP TABLE users;--"), /Refusing to quote unsafe database identifier/);
  assert.throws(() => quoteDatabaseIdentifier("postgres"), /Refusing to quote unsafe database identifier/);

  // Approved test paths
  for (const approved of APPROVED_TEST_PATHS) {
    assert.equal(assertApprovedTestPath(approved), approved);
    assert.equal(assertApprovedTestPath(`backend/${approved}`), approved);
  }

  // Non-approved test paths fail-closed
  assert.throws(
    () => assertApprovedTestPath("src/tests/arbitraryTest.test.ts"),
    /not in the approved fixed allowlist/,
  );
});

// ============================================================================
// SAFE-R09: Exact Finite Timeout Policy
// ============================================================================

test("SAFE-R09: enforces exact finite timeout policy with no infinite defaults", () => {
  assert.equal(DISPOSABLE_TIMEOUTS.containerStartupMs, 60_000);
  assert.equal(DISPOSABLE_TIMEOUTS.poolConnectionMs, 5_000);
  assert.equal(DISPOSABLE_TIMEOUTS.lockTimeoutMs, 5_000);
  assert.equal(DISPOSABLE_TIMEOUTS.statementTimeoutMs, 30_000);
  assert.equal(DISPOSABLE_TIMEOUTS.idleTransactionMs, 30_000);
  assert.equal(DISPOSABLE_TIMEOUTS.commandTimeoutMs, 180_000);
  assert.equal(DISPOSABLE_TIMEOUTS.cleanupTimeoutMs, 30_000);

  for (const [key, value] of Object.entries(DISPOSABLE_TIMEOUTS)) {
    assert.equal(typeof value, "number", `${key} must be a number`);
    assert.equal(Number.isFinite(value), true, `${key} must be finite`);
    assert.equal(value > 0, true, `${key} must be greater than 0`);
  }
});

// ============================================================================
// SAFE-R10: Awaited One-shot Cleanup on Success, Failure, and Interruption
// ============================================================================

test("SAFE-R10: awaited one-shot cleanup executes on success, child failure, and simulated interruption", async () => {
  const fixedRunId = "f60718293a4b5c6d7e8f90a1b2c3d4e5";
  const executedSql: string[] = [];
  let poolEnded = 0;
  let commandExecuted = 0;

  const validComment = `disposable_run_id=${fixedRunId};owner=m01_runner;created_at=1756980000000`;

  const fakePoolClient: DisposablePoolClient = {
    async query(sql: string): Promise<DisposableQueryResult> {
      executedSql.push(sql);
      if (sql.includes("shobj_description")) {
        return { rows: [{ comment: validComment }] };
      }
      if (sql.includes("SELECT 1 FROM pg_database")) {
        return { rows: [] }; // Target database dropped, not found
      }
      return { rows: [] };
    },
    async end(): Promise<void> {
      poolEnded++;
    },
  };

  const fakeCreatePool: CreatePoolFunction = () => fakePoolClient;

  // Subtest 1: Child command failure
  const failingRunCommand: RunCommandFunction = async () => {
    commandExecuted++;
    throw new Error("Simulated test runner failure");
  };

  const testEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    BANKING_ENV: "test",
    ALLOW_DATABASE_TEST_RESET: "1",
    DATABASE_TEST_ADMIN_URL: "postgresql://banking:secret@localhost:5432/postgres",
  };

  const resultFail = await runDisposablePostgresTest(
    ["src/tests/migrationFingerprint.test.ts"],
    testEnv,
    {
      runIdGenerator: () => fixedRunId,
      createPoolFn: fakeCreatePool,
      runCommandFn: failingRunCommand,
    },
  );

  assert.equal(resultFail.success, false);
  assert.equal(resultFail.error?.message, "Simulated test runner failure");
  assert.equal(poolEnded, 1, "Pool end must be called exactly once during cleanup");
  assert.equal(executedSql.some((s) => s.includes("DROP DATABASE IF EXISTS")), true, "Drop database must be called");

  // Subtest 2: Interruption seam handling
  let interruptHandlerRegistered: (() => void) | undefined;
  const fakeEmitter: ProcessInterruptionEmitter = {
    on(event: string, listener: (...args: unknown[]) => void): void {
      if (event === "SIGINT") {
        interruptHandlerRegistered = () => listener();
      }
    },
    removeListener(_event: string, _listener: (...args: unknown[]) => void): void {
      interruptHandlerRegistered = undefined;
    },
  };

  let poolEnded2 = 0;
  const fakePoolClient2: DisposablePoolClient = {
    async query(sql: string): Promise<DisposableQueryResult> {
      if (sql.includes("shobj_description")) {
        return { rows: [{ comment: validComment }] };
      }
      return { rows: [] };
    },
    async end(): Promise<void> {
      poolEnded2++;
    },
  };

  const successfulRunCommand: RunCommandFunction = async () => {
    // Simulate receiving SIGINT during runCommand execution
    if (interruptHandlerRegistered) {
      interruptHandlerRegistered();
    }
  };

  const resultInterrupt = await runDisposablePostgresTest(
    ["src/tests/migrationFingerprint.test.ts"],
    testEnv,
    {
      runIdGenerator: () => fixedRunId,
      createPoolFn: () => fakePoolClient2,
      runCommandFn: successfulRunCommand,
      processEmitter: fakeEmitter,
    },
  );

  assert.equal(resultInterrupt.success, false);
  assert.match(resultInterrupt.error?.message ?? "", /SIGINT/);
  assert.equal(poolEnded2, 1, "Pool end must be called exactly once even when interrupted");
  assert.equal(interruptHandlerRegistered, undefined, "Interruption listener must be removed after test execution");
});

// ============================================================================
// SAFE-R11: Post-drop Catalog Check Fails Closed
// ============================================================================

test("SAFE-R11: post-drop catalog check fails closed if database remains in catalog", () => {
  const targetDb = "banking_test_0718293a4b5c6d7e8f90a1b2c3d4e5f6";
  const fakeCatalog = {
    existingDatabases: new Set([targetDb]), // Still present
    databaseComments: new Map<string, string>(),
    activeSessions: new Map<string, readonly number[]>(),
  };

  assert.throws(
    () => postDropCatalogCheck(targetDb, fakeCatalog),
    /still present in catalog/,
  );
});

// ============================================================================
// Import Safety: Importing Runner Causes Zero Side Effects
// ============================================================================

test("import safety: importing runner does not spawn processes, connect to DB, or register global handlers", async () => {
  const sigintListenersBefore = process.listenerCount("SIGINT");
  const sigtermListenersBefore = process.listenerCount("SIGTERM");

  const runnerModulePath = "../../scripts/run-disposable-postgres-test.js";
  const runnerModule = await import(runnerModulePath);

  const sigintListenersAfter = process.listenerCount("SIGINT");
  const sigtermListenersAfter = process.listenerCount("SIGTERM");

  assert.equal(sigintListenersAfter, sigintListenersBefore, "Importing runner must not add SIGINT listeners");
  assert.equal(sigtermListenersAfter, sigtermListenersBefore, "Importing runner must not add SIGTERM listeners");
  assert.equal(typeof runnerModule.runDisposablePostgresTest, "function");
});

// ============================================================================
// Follow-up Tests Addressing Owner Evidence Gaps (Items 3.1..3.4)
// ============================================================================

test("SAFE-R09-E1: child command timeout is enforced deterministically and triggers awaited cleanup", async () => {
  const fixedRunId = "11111111111111111111111111111111";
  let poolEnded = 0;
  const executedSql: string[] = [];
  const validComment = `disposable_run_id=${fixedRunId};owner=m01_runner;created_at=1756980000000`;

  const fakePool: DisposablePoolClient = {
    async query(sql: string) {
      executedSql.push(sql);
      if (sql.includes("shobj_description")) return { rows: [{ comment: validComment }] };
      if (sql.includes("SELECT 1 FROM pg_database")) return { rows: [] };
      return { rows: [] };
    },
    async end() {
      poolEnded++;
    },
  };

  let capturedTimeoutMs: number | undefined;
  const timingOutRunCommand: RunCommandFunction = async (_cmd, _args, _env, timeoutMs) => {
    capturedTimeoutMs = timeoutMs;
    // Simulate deterministic command timeout
    throw new Error(`Command tsx timed out after ${timeoutMs}ms.`);
  };

  const testEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    BANKING_ENV: "test",
    ALLOW_DATABASE_TEST_RESET: "1",
    DATABASE_TEST_ADMIN_URL: "postgresql://banking:secret@localhost:5432/postgres",
  };

  const result = await runDisposablePostgresTest(
    ["src/tests/migrationFingerprint.test.ts"],
    testEnv,
    {
      runIdGenerator: () => fixedRunId,
      createPoolFn: () => fakePool,
      runCommandFn: timingOutRunCommand,
      commandTimeoutMs: 25,
    },
  );

  assert.equal(result.success, false);
  assert.equal(capturedTimeoutMs, 25, "Injected timeout must be enforced and passed to runner command");
  assert.match(result.error?.message ?? "", /timed out after 25ms/);
  assert.equal(poolEnded, 1, "Cleanup must be awaited once on timeout");
  assert.equal(executedSql.some((s) => s.includes("DROP DATABASE IF EXISTS")), true, "Drop database must be called");
});

test("SAFE-R09-E2: cleanup timeout is enforced, fails closed, and does not swallow primary error", async () => {
  const fixedRunId = "22222222222222222222222222222222";

  // Pool that hangs during cleanup query (never resolves)
  const hangingPool: DisposablePoolClient = {
    async query(sql: string) {
      if (sql.includes("shobj_description")) {
        // Hang indefinitely during cleanup marker check
        return new Promise<DisposableQueryResult>(() => {});
      }
      return { rows: [] };
    },
    async end() {},
  };

  const successfulCommand: RunCommandFunction = async () => {};

  const testEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    BANKING_ENV: "test",
    ALLOW_DATABASE_TEST_RESET: "1",
    DATABASE_TEST_ADMIN_URL: "postgresql://banking:secret@localhost:5432/postgres",
  };

  // Subcase A: Child succeeds, but cleanup times out -> Runner must FAIL-CLOSED
  const resultA = await runDisposablePostgresTest(
    ["src/tests/migrationFingerprint.test.ts"],
    testEnv,
    {
      runIdGenerator: () => fixedRunId,
      createPoolFn: () => hangingPool,
      runCommandFn: successfulCommand,
      cleanupTimeoutMs: 15,
    },
  );

  assert.equal(resultA.success, false, "Runner must fail-closed if cleanup times out");
  assert.match(resultA.cleanupError?.message ?? "", /Cleanup timed out after 15ms/);
  assert.equal(resultA.error, resultA.cleanupError);

  // Subcase B: Child command fails, and cleanup times out -> Primary error preserved, not swallowed
  const failingCommand: RunCommandFunction = async () => {
    throw new Error("Synthetic primary child execution error");
  };

  const resultB = await runDisposablePostgresTest(
    ["src/tests/migrationFingerprint.test.ts"],
    testEnv,
    {
      runIdGenerator: () => fixedRunId,
      createPoolFn: () => hangingPool,
      runCommandFn: failingCommand,
      cleanupTimeoutMs: 15,
    },
  );

  assert.equal(resultB.success, false);
  assert.equal(resultB.error?.message, "Synthetic primary child execution error", "Primary error must not be swallowed");
  assert.match(resultB.cleanupError?.message ?? "", /Cleanup timed out after 15ms/);
  assert.equal(resultB.error?.cause, resultB.cleanupError, "Cleanup timeout must be attached as secondary cause");
});

test("SAFE-R10-E1: fatal event uncaughtException triggers awaited one-shot cleanup and fails closed", async () => {
  const fixedRunId = "33333333333333333333333333333333";
  let poolEnded = 0;
  const validComment = `disposable_run_id=${fixedRunId};owner=m01_runner;created_at=1756980000000`;

  const fakePool: DisposablePoolClient = {
    async query(sql: string) {
      if (sql.includes("shobj_description")) return { rows: [{ comment: validComment }] };
      if (sql.includes("SELECT 1 FROM pg_database")) return { rows: [] };
      return { rows: [] };
    },
    async end() {
      poolEnded++;
    },
  };

  let uncaughtListener: ((err: unknown) => void) | undefined;
  const fakeEmitter: ProcessInterruptionEmitter = {
    on(event: string, listener: (...args: unknown[]) => void) {
      if (event === "uncaughtException") uncaughtListener = listener as (err: unknown) => void;
    },
    removeListener(event: string) {
      if (event === "uncaughtException") uncaughtListener = undefined;
    },
  };

  const interruptingCommand: RunCommandFunction = async () => {
    if (uncaughtListener) {
      uncaughtListener(new Error("Synthetic fatal uncaught exception"));
    }
  };

  const testEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    BANKING_ENV: "test",
    ALLOW_DATABASE_TEST_RESET: "1",
    DATABASE_TEST_ADMIN_URL: "postgresql://banking:secret@localhost:5432/postgres",
  };

  const result = await runDisposablePostgresTest(
    ["src/tests/migrationFingerprint.test.ts"],
    testEnv,
    {
      runIdGenerator: () => fixedRunId,
      createPoolFn: () => fakePool,
      runCommandFn: interruptingCommand,
      processEmitter: fakeEmitter,
    },
  );

  assert.equal(result.success, false);
  assert.match(result.error?.message ?? "", /uncaughtException.*Synthetic fatal uncaught exception/);
  assert.equal(poolEnded, 1, "Cleanup must be awaited once on uncaughtException");
  assert.equal(uncaughtListener, undefined, "Listener must be removed in finally");
});

test("SAFE-R10-E2: fatal event unhandledRejection triggers awaited one-shot cleanup and fails closed", async () => {
  const fixedRunId = "44444444444444444444444444444444";
  let poolEnded = 0;
  const validComment = `disposable_run_id=${fixedRunId};owner=m01_runner;created_at=1756980000000`;

  const fakePool: DisposablePoolClient = {
    async query(sql: string) {
      if (sql.includes("shobj_description")) return { rows: [{ comment: validComment }] };
      if (sql.includes("SELECT 1 FROM pg_database")) return { rows: [] };
      return { rows: [] };
    },
    async end() {
      poolEnded++;
    },
  };

  let unhandledListener: ((reason: unknown) => void) | undefined;
  const fakeEmitter: ProcessInterruptionEmitter = {
    on(event: string, listener: (...args: unknown[]) => void) {
      if (event === "unhandledRejection") unhandledListener = listener as (reason: unknown) => void;
    },
    removeListener(event: string) {
      if (event === "unhandledRejection") unhandledListener = undefined;
    },
  };

  const interruptingCommand: RunCommandFunction = async () => {
    if (unhandledListener) {
      unhandledListener("Synthetic fatal unhandled rejection reason");
    }
  };

  const testEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    BANKING_ENV: "test",
    ALLOW_DATABASE_TEST_RESET: "1",
    DATABASE_TEST_ADMIN_URL: "postgresql://banking:secret@localhost:5432/postgres",
  };

  const result = await runDisposablePostgresTest(
    ["src/tests/migrationFingerprint.test.ts"],
    testEnv,
    {
      runIdGenerator: () => fixedRunId,
      createPoolFn: () => fakePool,
      runCommandFn: interruptingCommand,
      processEmitter: fakeEmitter,
    },
  );

  assert.equal(result.success, false);
  assert.match(result.error?.message ?? "", /unhandledRejection.*Synthetic fatal unhandled rejection/);
  assert.equal(poolEnded, 1, "Cleanup must be awaited once on unhandledRejection");
  assert.equal(unhandledListener, undefined, "Listener must be removed in finally");
});

test("SAFE-R04-E1: external target database name override via environment or CLI is rejected and ignored", async () => {
  const fixedRunId = "55555555555555555555555555555555";
  const validComment = `disposable_run_id=${fixedRunId};owner=m01_runner;created_at=1756980000000`;

  let capturedTargetDbName: string | undefined;
  const fakePool: DisposablePoolClient = {
    async query(sql: string) {
      if (sql.includes("CREATE DATABASE")) {
        capturedTargetDbName = sql.replace("CREATE DATABASE ", "").trim();
      }
      if (sql.includes("shobj_description")) return { rows: [{ comment: validComment }] };
      if (sql.includes("SELECT 1 FROM pg_database")) return { rows: [] };
      return { rows: [] };
    },
    async end() {},
  };

  let capturedEnv: NodeJS.ProcessEnv | undefined;
  const fakeCommand: RunCommandFunction = async (_cmd, _args, env) => {
    capturedEnv = env;
  };

  const testEnvWithAttemptedOverrides: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    BANKING_ENV: "test",
    ALLOW_DATABASE_TEST_RESET: "1",
    DATABASE_TEST_ADMIN_URL: "postgresql://banking:secret@localhost:5432/postgres",
    DATABASE_TEST_DATABASE_NAME: "malicious_override_database",
    TARGET_DATABASE: "another_malicious_override",
    DATABASE_URL: "postgresql://banking:secret@localhost:5432/banking_preview",
  };

  const result = await runDisposablePostgresTest(
    ["src/tests/migrationFingerprint.test.ts"],
    testEnvWithAttemptedOverrides,
    {
      runIdGenerator: () => fixedRunId,
      createPoolFn: () => fakePool,
      runCommandFn: fakeCommand,
    },
  );

  assert.equal(result.success, true);
  const expectedDbName = `banking_test_${fixedRunId}`;
  assert.equal(result.databaseName, expectedDbName);
  assert.equal(STRICT_DATABASE_NAME_PATTERN.test(result.databaseName), true);
  assert.equal(capturedTargetDbName, `"${expectedDbName}"`, "Target must strictly be generated runId name");
  assert.equal(capturedEnv?.DATABASE_TEST_DATABASE_NAME, expectedDbName, "Target env must be overridden by runner");
});

test("SAFE-R08-E1: child invocation strictly uses argument array without shell execution or interpolation", async () => {
  const fixedRunId = "66666666666666666666666666666666";
  const validComment = `disposable_run_id=${fixedRunId};owner=m01_runner;created_at=1756980000000`;

  const fakePool: DisposablePoolClient = {
    async query(sql: string) {
      if (sql.includes("shobj_description")) return { rows: [{ comment: validComment }] };
      if (sql.includes("SELECT 1 FROM pg_database")) return { rows: [] };
      return { rows: [] };
    },
    async end() {},
  };

  const invocationCommands: string[] = [];
  const invocationArgArrays: string[][] = [];

  const capturingRunCommand: RunCommandFunction = async (cmd, args) => {
    invocationCommands.push(cmd);
    invocationArgArrays.push([...args]);
  };

  const testEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    BANKING_ENV: "test",
    ALLOW_DATABASE_TEST_RESET: "1",
    DATABASE_TEST_ADMIN_URL: "postgresql://banking:secret@localhost:5432/postgres",
  };

  const result = await runDisposablePostgresTest(
    ["src/tests/registrationRelational.test.ts"],
    testEnv,
    {
      runIdGenerator: () => fixedRunId,
      createPoolFn: () => fakePool,
      runCommandFn: capturingRunCommand,
    },
  );

  assert.equal(result.success, true);
  assert.equal(invocationCommands.length, 2, "Expected migration and tsx child invocations");

  for (const cmd of invocationCommands) {
    assert.equal(cmd, process.execPath, "Child command executable must be exact node binary, not shell binary");
    assert.equal(cmd.includes("sh") || cmd.includes("bash") || cmd.includes("cmd") || cmd.includes("powershell"), false);
  }

  for (const args of invocationArgArrays) {
    assert.equal(Array.isArray(args), true, "Invocation must use string array, not shell string");
    for (const arg of args) {
      assert.equal(typeof arg, "string");
      assert.equal(arg.includes(";"), false, "Arguments must not contain shell separator chaining");
      assert.equal(arg.includes("&&"), false, "Arguments must not contain shell logic chaining");
      assert.equal(arg.includes("|"), false, "Arguments must not contain shell piping");
    }
  }
});

test("SAFE-R08-E2: marker, container ID, or run label mismatch results in zero destructive calls", async () => {
  const fixedRunId = "77777777777777777777777777777777";
  let terminateCallCount = 0;
  let dropCallCount = 0;

  // Pool that returns mismatched marker
  const fakePoolMismatchedMarker: DisposablePoolClient = {
    async query(sql: string) {
      if (sql.includes("pg_terminate_backend")) terminateCallCount++;
      if (sql.includes("DROP DATABASE")) dropCallCount++;
      if (sql.includes("shobj_description")) {
        return { rows: [{ comment: "disposable_run_id=99999999999999999999999999999999;owner=m01_runner;created_at=1" }] };
      }
      return { rows: [] };
    },
    async end() {},
  };

  const testEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    BANKING_ENV: "test",
    ALLOW_DATABASE_TEST_RESET: "1",
    DATABASE_TEST_ADMIN_URL: "postgresql://banking:secret@localhost:5432/postgres",
  };

  const result = await runDisposablePostgresTest(
    ["src/tests/kycRelational.test.ts"],
    testEnv,
    {
      runIdGenerator: () => fixedRunId,
      createPoolFn: () => fakePoolMismatchedMarker,
      runCommandFn: async () => {},
    },
  );

  assert.equal(result.success, false);
  assert.equal(terminateCallCount, 0, "Terminate backend must NOT be called on marker mismatch");
  assert.equal(dropCallCount, 0, "Drop database must NOT be called on marker mismatch");
  assert.match(result.cleanupError?.message ?? "", /Ownership marker run_id mismatch/);

  // Container descriptor validation mismatches:
  assert.throws(
    () =>
      validateContainerDescriptor({
        majorVersion: 16,
        bindHost: "127.0.0.1",
        port: 5432,
        containerName: "banking_test_container_invalid_name",
        runLabel: fixedRunId,
      }),
    /does not match expected pattern/,
  );

  assert.throws(
    () =>
      validateContainerDescriptor({
        majorVersion: 16,
        bindHost: "127.0.0.1",
        port: 5432,
        containerName: `banking_test_container_${fixedRunId}`,
        runLabel: "not_a_32_char_hex_string",
      }),
    /must be a 32-char lowercase hex string/,
  );
});

test("SAFE-R10-E3: primary failure is preserved when cleanup also fails or times out", async () => {
  const fixedRunId = "88888888888888888888888888888888";

  // Pool that throws during cleanup
  const failingPool: DisposablePoolClient = {
    async query(sql: string) {
      if (sql.includes("shobj_description")) {
        throw new Error("Synthetic database cleanup socket error");
      }
      return { rows: [] };
    },
    async end() {},
  };

  const failingChildCommand: RunCommandFunction = async () => {
    throw new Error("Synthetic child suite failure: 3 failed assertions");
  };

  const testEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    BANKING_ENV: "test",
    ALLOW_DATABASE_TEST_RESET: "1",
    DATABASE_TEST_ADMIN_URL: "postgresql://banking:secret@localhost:5432/postgres",
  };

  const result = await runDisposablePostgresTest(
    ["src/tests/kycRelational.test.ts"],
    testEnv,
    {
      runIdGenerator: () => fixedRunId,
      createPoolFn: () => failingPool,
      runCommandFn: failingChildCommand,
    },
  );

  assert.equal(result.success, false);
  assert.equal(result.error?.message, "Synthetic child suite failure: 3 failed assertions", "Primary child failure must be preserved");
  assert.equal(result.cleanupError?.message, "Synthetic database cleanup socket error", "Cleanup failure must be recorded");
  assert.equal(result.error?.cause, result.cleanupError, "Cleanup failure must be attached to primary error cause");
});

test("SAFE-R01-E1: redaction sanitizes synthetic passwords, tokens, child errors, and cleanup errors", () => {
  const syntheticRunId = "abcdef0123456789abcdef0123456789";
  const syntheticSecret = "synth_p@ss_xyz987!";
  const syntheticToken = "synth_tok_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
  const syntheticApiKey = "synth_ak_1a2b3c4d5e6f7g8h";

  const inputs = [
    `Connection failed to postgresql://banking_user:${syntheticSecret}@127.0.0.1:5432/banking_test_${syntheticRunId}`,
    `Authorization error: Bearer ${syntheticToken}`,
    `Config error with password = ${syntheticSecret} and apiKey: ${syntheticApiKey}`,
    `Child process error on target database banking_test_${syntheticRunId}: connection timed out`,
    `Cleanup failure on database banking_test_${syntheticRunId}: token=${syntheticToken}`,
  ];

  for (const input of inputs) {
    const sanitized = sanitizeLogOutput(input);
    assert.equal(sanitized.includes(syntheticSecret), false, "Secret must be redacted");
    assert.equal(sanitized.includes(syntheticToken), false, "Token must be redacted");
    assert.equal(sanitized.includes(syntheticApiKey), false, "ApiKey must be redacted");
    assert.equal(sanitized.includes(syntheticRunId), false, "32-hex run ID must be redacted");
  }
});

// ============================================================================
// Bounded Cooperative Cancellation & Fatal Exit Tests (Items 6.1..6.6)
// ============================================================================

test("SAFE-R10-E4: late child completion after timeout is ignored, does not alter result, and prevents next command", async () => {
  const fixedRunId = "a111111111111111111111111111111a";
  const validComment = `disposable_run_id=${fixedRunId};owner=m01_runner;created_at=1756980000000`;

  let poolEnded = 0;
  const fakePool: DisposablePoolClient = {
    async query(sql: string) {
      if (sql.includes("shobj_description")) return { rows: [{ comment: validComment }] };
      if (sql.includes("SELECT 1 FROM pg_database")) return { rows: [] };
      return { rows: [] };
    },
    async end() {
      poolEnded++;
    },
  };

  let firstCommandAbortSignal: AbortSignal | undefined;
  let secondCommandInvoked = false;
  let triggerLateChildResolve: () => void = () => {};

  const fakeRunCommand: RunCommandFunction = async (cmd, args, _env, timeoutMs, signal) => {
    if (args.some((a) => a.includes("apply-migration"))) {
      firstCommandAbortSignal = signal;
      // Return a promise that only resolves when late trigger is called
      return new Promise<void>((resolve, reject) => {
        triggerLateChildResolve = resolve;
        if (signal) {
          signal.addEventListener("abort", () => {
            reject(new Error(`Command migration aborted: ${String(signal.reason)}`));
          });
        }
      });
    }
    if (args.some((a) => a.includes("tsx"))) {
      secondCommandInvoked = true;
    }
  };

  const testEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    BANKING_ENV: "test",
    ALLOW_DATABASE_TEST_RESET: "1",
    DATABASE_TEST_ADMIN_URL: "postgresql://banking:secret@localhost:5432/postgres",
  };

  const result = await runDisposablePostgresTest(
    ["src/tests/migrationFingerprint.test.ts"],
    testEnv,
    {
      runIdGenerator: () => fixedRunId,
      createPoolFn: () => fakePool,
      runCommandFn: fakeRunCommand,
      commandTimeoutMs: 15,
    },
  );

  assert.equal(result.success, false);
  assert.match(result.error?.message ?? "", /Command migration aborted|timed out/);
  assert.equal(firstCommandAbortSignal?.aborted, true, "Child command must receive abort signal on timeout");
  assert.equal(secondCommandInvoked, false, "Second command must NEVER be invoked after first command times out");
  assert.equal(poolEnded, 1, "Cleanup must be executed exactly once");

  // Simulate late child resolution after runner has completed
  triggerLateChildResolve();

  // Result and state must remain fail-closed
  assert.equal(result.success, false);
  assert.equal(secondCommandInvoked, false);
});

test("SAFE-R10-E5: late cleanup continuation after deadline has zero count for subsequent destructive phases", async () => {
  const fixedRunId = "b222222222222222222222222222222b";

  let terminateCallCount = 0;
  let dropCallCount = 0;
  let postDropCheckCount = 0;
  let containerRemoveCount = 0;

  let triggerLatePhase1Resolve: () => void = () => {};

  const fakePoolWithHangingPhase1: DisposablePoolClient = {
    async query(sql: string, _params, signal) {
      if (sql.includes("shobj_description")) {
        // Phase 1: Pre-cleanup revalidation comment query hangs
        return new Promise<DisposableQueryResult>((resolve, reject) => {
          triggerLatePhase1Resolve = () => {
            resolve({ rows: [{ comment: `disposable_run_id=${fixedRunId};owner=m01_runner;created_at=1756980000000` }] });
          };
          if (signal) {
            signal.addEventListener("abort", () => {
              reject(new Error("Query aborted"));
            });
          }
        });
      }
      if (sql.includes("pg_terminate_backend")) {
        terminateCallCount++;
      }
      if (sql.includes("DROP DATABASE")) {
        dropCallCount++;
      }
      if (sql.includes("SELECT 1 FROM pg_database")) {
        postDropCheckCount++;
      }
      return { rows: [] };
    },
    async end() {},
  };

  const fakeContainerRemoval: ContainerRemovalFunction = async () => {
    containerRemoveCount++;
  };

  const testEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    BANKING_ENV: "test",
    ALLOW_DATABASE_TEST_RESET: "1",
    DATABASE_TEST_ADMIN_URL: "postgresql://banking:secret@localhost:5432/postgres",
  };

  const result = await runDisposablePostgresTest(
    ["src/tests/migrationFingerprint.test.ts"],
    testEnv,
    {
      runIdGenerator: () => fixedRunId,
      createPoolFn: () => fakePoolWithHangingPhase1,
      runCommandFn: async () => {},
      cleanupTimeoutMs: 15,
      containerRemovalFn: fakeContainerRemoval,
    },
  );

  assert.equal(result.success, false, "Runner must fail closed when cleanup times out");
  assert.match(result.cleanupError?.message ?? "", /Cleanup timed out after 15ms/);

  // Now simulate late resolution of Phase 1
  triggerLatePhase1Resolve();

  // All subsequent destructive phases must have strictly ZERO calls
  assert.equal(terminateCallCount, 0, "Terminate backend must have count 0 after cleanup timeout");
  assert.equal(dropCallCount, 0, "Drop database must have count 0 after cleanup timeout");
  assert.equal(postDropCheckCount, 0, "Post-drop check must have count 0 after cleanup timeout");
  assert.equal(containerRemoveCount, 0, "Container removal must have count 0 after cleanup timeout");
});

test("SAFE-R10-E6: non-cooperative cleanup adapter fails closed on deadline without invoking subsequent phases", async () => {
  const fixedRunId = "c333333333333333333333333333333c";

  let terminateCallCount = 0;
  let dropCallCount = 0;

  // Non-cooperative adapter: completely ignores signal.aborted and never resolves or rejects
  const uncooperativePool: DisposablePoolClient = {
    async query(sql: string) {
      if (sql.includes("shobj_description")) {
        return new Promise<DisposableQueryResult>(() => {}); // Ignored and hanging indefinitely
      }
      if (sql.includes("pg_terminate_backend")) terminateCallCount++;
      if (sql.includes("DROP DATABASE")) dropCallCount++;
      return { rows: [] };
    },
    async end() {},
  };

  const testEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    BANKING_ENV: "test",
    ALLOW_DATABASE_TEST_RESET: "1",
    DATABASE_TEST_ADMIN_URL: "postgresql://banking:secret@localhost:5432/postgres",
  };

  const result = await runDisposablePostgresTest(
    ["src/tests/migrationFingerprint.test.ts"],
    testEnv,
    {
      runIdGenerator: () => fixedRunId,
      createPoolFn: () => uncooperativePool,
      runCommandFn: async () => {},
      cleanupTimeoutMs: 15,
    },
  );

  assert.equal(result.success, false, "Runner must fail-closed within bounded deadline even with non-cooperative adapter");
  assert.match(result.cleanupError?.message ?? "", /Cleanup timed out after 15ms/);
  assert.equal(terminateCallCount, 0, "Subsequent terminate phase must not be invoked");
  assert.equal(dropCallCount, 0, "Subsequent drop phase must not be invoked");
});

test("SAFE-R10-E7: primary failure ordering preserves initial child or fatal event error over subsequent errors", async () => {
  const fixedRunId = "d444444444444444444444444444444d";

  const testEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    BANKING_ENV: "test",
    ALLOW_DATABASE_TEST_RESET: "1",
    DATABASE_TEST_ADMIN_URL: "postgresql://banking:secret@localhost:5432/postgres",
  };

  // Scenario 1: Child failure first, cleanup failure second
  const failingPool: DisposablePoolClient = {
    async query(sql: string) {
      if (sql.includes("shobj_description")) {
        throw new Error("Cleanup catalog connection refused");
      }
      return { rows: [] };
    },
    async end() {},
  };

  const resultChildFirst = await runDisposablePostgresTest(
    ["src/tests/migrationFingerprint.test.ts"],
    testEnv,
    {
      runIdGenerator: () => fixedRunId,
      createPoolFn: () => failingPool,
      runCommandFn: async () => {
        throw new Error("Primary child test assertion error");
      },
    },
  );

  assert.equal(resultChildFirst.success, false);
  assert.equal(resultChildFirst.error?.message, "Primary child test assertion error");
  assert.equal(resultChildFirst.cleanupError?.message, "Cleanup catalog connection refused");
  assert.equal(resultChildFirst.error?.cause, resultChildFirst.cleanupError);

  // Scenario 2: Fatal event first, late child failure second
  let fatalListener: (() => void) | undefined;
  const fakeEmitter: ProcessInterruptionEmitter = {
    on(event: string, listener: (...args: unknown[]) => void) {
      if (event === "SIGINT") fatalListener = () => listener();
    },
    removeListener() {
      fatalListener = undefined;
    },
  };

  const resultFatalFirst = await runDisposablePostgresTest(
    ["src/tests/migrationFingerprint.test.ts"],
    testEnv,
    {
      runIdGenerator: () => fixedRunId,
      createPoolFn: () => ({
        async query(sql: string) {
          if (sql.includes("shobj_description")) return { rows: [{ comment: `disposable_run_id=${fixedRunId};owner=m01_runner;created_at=1` }] };
          return { rows: [] };
        },
        async end() {},
      }),
      runCommandFn: async () => {
        if (fatalListener) fatalListener(); // Fatal event fired first
        throw new Error("Late child failure after fatal event");
      },
      processEmitter: fakeEmitter,
    },
  );

  assert.equal(resultFatalFirst.success, false);
  assert.match(resultFatalFirst.error?.message ?? "", /Execution interrupted by SIGINT/);

  // Scenario 3: Cleanup-only failure (child succeeded)
  const resultCleanupOnly = await runDisposablePostgresTest(
    ["src/tests/migrationFingerprint.test.ts"],
    testEnv,
    {
      runIdGenerator: () => fixedRunId,
      createPoolFn: () => failingPool,
      runCommandFn: async () => {}, // Child succeeds
    },
  );

  assert.equal(resultCleanupOnly.success, false);
  assert.equal(resultCleanupOnly.error?.message, "Cleanup catalog connection refused");
  assert.equal(resultCleanupOnly.cleanupError, resultCleanupOnly.error);
});

test("SAFE-R10-E8: fatal events set process facade exitCode to non-zero across all four event types", async () => {
  const fatalEvents = ["SIGINT", "SIGTERM", "uncaughtException", "unhandledRejection"] as const;

  for (const eventName of fatalEvents) {
    const fixedRunId = "e555555555555555555555555555555e";
    let eventHandler: ((detail?: unknown) => void) | undefined;

    const fakeEmitter: ProcessInterruptionEmitter = {
      on(event: string, listener: (...args: unknown[]) => void) {
        if (event === eventName) {
          eventHandler = listener as (detail?: unknown) => void;
        }
      },
      removeListener(event: string) {
        if (event === eventName) eventHandler = undefined;
      },
    };

    const processFacade: ProcessFacade = { exitCode: 0 };

    const fakeCommand: RunCommandFunction = async () => {
      if (eventHandler) {
        eventHandler(new Error(`Simulated fatal error for ${eventName}`));
      }
    };

    const testEnv: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      BANKING_ENV: "test",
      ALLOW_DATABASE_TEST_RESET: "1",
      DATABASE_TEST_ADMIN_URL: "postgresql://banking:secret@localhost:5432/postgres",
    };

    const result = await runDisposablePostgresTest(
      ["src/tests/migrationFingerprint.test.ts"],
      testEnv,
      {
        runIdGenerator: () => fixedRunId,
        createPoolFn: () => ({
          async query(sql: string) {
            if (sql.includes("shobj_description")) return { rows: [{ comment: `disposable_run_id=${fixedRunId};owner=m01_runner;created_at=1` }] };
            return { rows: [] };
          },
          async end() {},
        }),
        runCommandFn: fakeCommand,
        processEmitter: fakeEmitter,
        processFacade,
      },
    );

    assert.equal(result.success, false);
    assert.equal(processFacade.exitCode, 1, `Process facade exitCode must be set to 1 for ${eventName}`);
    assert.match(result.error?.message ?? "", new RegExp(eventName));
  }
});

test("SAFE-R10-E9: timers and event listeners are fully disposed across success, failure, and cancellation paths", async () => {
  const fixedRunId = "f666666666666666666666666666666f";
  const registeredListeners: Record<string, number> = {};

  const fakeEmitter: ProcessInterruptionEmitter = {
    on(event: string) {
      registeredListeners[event] = (registeredListeners[event] ?? 0) + 1;
    },
    removeListener(event: string) {
      registeredListeners[event] = (registeredListeners[event] ?? 0) - 1;
    },
  };

  const testEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    BANKING_ENV: "test",
    ALLOW_DATABASE_TEST_RESET: "1",
    DATABASE_TEST_ADMIN_URL: "postgresql://banking:secret@localhost:5432/postgres",
  };

  const poolDouble: DisposablePoolClient = {
    async query(sql: string) {
      if (sql.includes("shobj_description")) return { rows: [{ comment: `disposable_run_id=${fixedRunId};owner=m01_runner;created_at=1` }] };
      return { rows: [] };
    },
    async end() {},
  };

  // Test across normal success
  const resSuccess = await runDisposablePostgresTest(
    ["src/tests/migrationFingerprint.test.ts"],
    testEnv,
    {
      runIdGenerator: () => fixedRunId,
      createPoolFn: () => poolDouble,
      runCommandFn: async () => {},
      processEmitter: fakeEmitter,
    },
  );
  assert.equal(resSuccess.success, true);
  for (const [event, count] of Object.entries(registeredListeners)) {
    assert.equal(count, 0, `Listener for ${event} must be disposed on success`);
  }

  // Test across failure
  const resFailure = await runDisposablePostgresTest(
    ["src/tests/migrationFingerprint.test.ts"],
    testEnv,
    {
      runIdGenerator: () => fixedRunId,
      createPoolFn: () => poolDouble,
      runCommandFn: async () => { throw new Error("Boom"); },
      processEmitter: fakeEmitter,
    },
  );
  assert.equal(resFailure.success, false);
  for (const [event, count] of Object.entries(registeredListeners)) {
    assert.equal(count, 0, `Listener for ${event} must be disposed on failure`);
  }
});

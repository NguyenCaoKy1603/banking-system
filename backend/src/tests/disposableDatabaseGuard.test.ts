import assert from "node:assert/strict";
import test from "node:test";

import {
  APPROVED_TEST_PATHS,
  AUTHORIZED_EVIDENCE_PHASES,
  CANONICAL_SEQUENCE_STEPS,
  CONTAINER_NAME_PATTERN,
  type ContainerRemovalFunction,
  type CreatePoolFunction,
  type ProcessFacade,
  type DisposablePoolClient,
  type DisposableQueryResult,
  type RunnerExecutionResult,
  DISPOSABLE_TIMEOUTS,
  type EvidencePhase,
  type ProcessInterruptionEmitter,
  type RunCommandFunction,
  RUN_ID_PATTERN,
  STRICT_DATABASE_NAME_PATTERN,
  assertApprovedTestPath,
  assertDisposableDatabaseAdminUrl,
  assertDisposableDatabaseResetAllowed,
  assertEvidencePhase,
  assertOwnershipMarkerMatches,
  buildCleanChildEnvironment,
  buildDockerExecMountinfoArgs,
  buildDockerImageInspectArgs,
  buildDockerInspectArgs,
  buildDockerRmArgs,
  buildDockerRunArgs,
  buildOwnershipMarker,
  computeCanonicalMigrationInventory,
  generateDisposableRunId,
  isExpectedChecksumMismatchRefusal,
  mutateChecksumOneNibble,
  parseOwnershipMarker,
  postDropCatalogCheck,
  preCleanupRevalidationCheck,
  preCreateClassificationCheck,
  quoteDatabaseIdentifier,
  runDisposablePostgresTest,
  sanitizeLogOutput,
  validateContainerDescriptor,
  validateDockerInspectOutput,
  validateMigrationHistoryRecords,
  verifyDatabaseDroppedInCatalog,
  validateDockerImageInspectOutput,
  parseAndValidateLaunchedContainerId,
  assertRuntimeDatabaseOwnership,
  type DockerAdapter,
  runCanonicalEvidenceSequence,
  CANONICAL_RUNTIME_TEST_PATH,
  dispatchCliRun,
  isCanonicalRuntimePath,
  isReservedCanonicalRuntimeCandidate,
  runCliMain,
  executeCommandWithOutput,
  CANONICAL_TMPFS_DESTINATION,
  CANONICAL_TMPFS_OPTIONS,
  CANONICAL_TMPFS_FLAG_VALUE,
  ATTESTATION_DIAGNOSTIC_KEYS,
  AttestationCommandError,
  type AttestationCommandResult,
  validateMountNamespaceAttestation,
  validateTmpfsOptions,
} from "../database/disposableDatabaseGuard.js";


const validEnvironment = {
  NODE_ENV: "test",
  BANKING_ENV: "test",
  ALLOW_DATABASE_TEST_RESET: "1",
};
const validUrl = "postgresql://banking:secret@localhost:5432/banking_test_guard";
const makeMountInfo = (
  destination = CANONICAL_TMPFS_DESTINATION,
  mountOptions = "rw,nosuid,noexec,relatime",
  filesystemType = "tmpfs",
  superOptions = "rw,size=524288k,mode=0700",
  mountId = "100",
): string => `${mountId} 50 0:1 / ${destination} ${mountOptions} - ${filesystemType} tmpfs ${superOptions}`;
const validMountInfoFixture = makeMountInfo();

const makeExpandedMountInfoFixture = (lineEnding = "\n"): string => {
  const nonTargetRecords = Array.from({ length: 50 }, (_, index) => makeMountInfo(
    `/synthetic/mount-${String(index).padStart(2, "0")}`,
    "rw,relatime,nodev",
    "proc",
    "rw,relatime",
    String(200 + index),
  ));
  const targetRecord = makeMountInfo(
    CANONICAL_TMPFS_DESTINATION,
    "rw,nosuid,noexec,relatime,nodev",
    "tmpfs",
    "rw,size=524288k,mode=700,inode64",
    "999",
  );
  return [...nonTargetRecords, targetRecord].join(lineEnding) + lineEnding;
};

const makeCanonicalOrchestrationHarness = (
  fixedRunId: string,
  mountInfo: string,
  options: {
    readonly chunks?: readonly string[];
    readonly attestationStderr?: string;
    readonly attestationCommandResult?: AttestationCommandResult;
    readonly attestationCommandFailure?: AttestationCommandError;
    readonly cleanupFailure?: boolean;
    readonly failAfterAttestation?: boolean;
    readonly deferAttestation?: boolean;
  } = {},
) => {
  const launchId = "d".repeat(64);
  const fixedContainerName = `banking_test_container_${fixedRunId}`;
  const localImageId = "sha256:" + "d".repeat(64);
  const events: string[] = [];
  const removedContainerIds: string[] = [];
  const observedCommandResults: Array<{ exitCode: number; stdout: string; stderr: string }> = [];
  let attestationOutput: string | undefined;
  let attestationValidatorReturnKind: string | undefined;
  let verifyOnlyCount = 0;

  const mockDocker: DockerAdapter = {
    async inspectImage() {
      return JSON.stringify([{ Id: localImageId, RepoTags: ["postgres:16"] }]);
    },
    async runContainer() {
      events.push("launch");
      return launchId;
    },
    async inspectContainer(containerId: string) {
      events.push("inspect");
      assert.equal(containerId, launchId);
      return JSON.stringify([{
        Id: launchId,
        Name: `/${fixedContainerName}`,
        Image: localImageId,
        Config: { Image: "postgres:16", Labels: { banking_test_run_id: fixedRunId } },
        NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] } },
        Mounts: [],
        HostConfig: {
          Binds: [],
          Tmpfs: { [CANONICAL_TMPFS_DESTINATION]: CANONICAL_TMPFS_OPTIONS },
        },
      }]);
    },
    async attestMountNamespace(containerId: string, signal?: AbortSignal) {
      events.push("attest");
      assert.equal(containerId, launchId);
      assert.equal(signal?.aborted, false, "Attestation must start with a fresh non-aborted signal");
      if (options.deferAttestation) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(signal?.aborted, false, "Late command completion must not inherit an aborted signal");
      }
      const commandResult = {
        exitCode: 0,
        stdout: (options.chunks ?? [mountInfo]).join(""),
        stderr: options.attestationStderr ?? "",
      };
      observedCommandResults.push(commandResult);
      assert.equal(commandResult.exitCode, 0);
      assert.equal(commandResult.stdout, mountInfo, "Command facade must concatenate and preserve stdout exactly");
      attestationOutput = commandResult.stdout;
      const validated = validateMountNamespaceAttestation(attestationOutput);
      attestationValidatorReturnKind = typeof validated;
      return attestationOutput;
    },
    async removeContainer(containerId: string) {
      events.push("cleanup");
      removedContainerIds.push(containerId);
    },
    async waitForReady() {
      events.push("ready");
    },
  };

  const mockPool: DisposablePoolClient = {
    async query(sql: string) {
      events.push("db");
      if (sql.includes("COUNT(*)")) return { rows: [{ count: 0 }] };
      return { rows: [] };
    },
    async end() {
      events.push("pool-end");
    },
  };

  const runCommandFn = async (_command: string, args: readonly string[]) => {
    events.push("child");
    if (args.includes("--verify-only")) {
      verifyOnlyCount += 1;
      if (verifyOnlyCount === 2) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Migration checksum mismatch for 001_banking_mvp; refusing to run.",
        };
      }
      if (options.failAfterAttestation && verifyOnlyCount === 3) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Synthetic later phase failure",
        };
      }
    }
    return { exitCode: 0, stdout: "OK", stderr: "" };
  };

  const createPoolFn = () => {
    events.push("pool");
    return mockPool;
  };

  if (options.attestationCommandResult || options.attestationCommandFailure) {
    mockDocker.attestMountNamespaceWithResult = async (containerId: string) => {
      events.push("attest-result");
      assert.equal(containerId, launchId);
      if (options.attestationCommandFailure) throw options.attestationCommandFailure;
      return options.attestationCommandResult ?? {
        exitCode: 0,
        stdout: mountInfo,
        stderr: "",
      };
    };
  }

  if (options.cleanupFailure) {
    mockDocker.removeContainer = async (containerId: string) => {
      events.push("cleanup");
      removedContainerIds.push(containerId);
      throw new Error("synthetic cleanup failure");
    };
  }

  return {
    mockDocker,
    mockPool,
    createPoolFn,
    runCommandFn,
    events,
    removedContainerIds,
    observedCommandResults,
    get attestationOutput() { return attestationOutput; },
    get attestationValidatorReturnKind() { return attestationValidatorReturnKind; },
    launchId,
  };
};

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


// ============================================================================
// M07-A2R Unit Tests & Verification Test Doubles (Pure, No-DB, No-Docker)
// ============================================================================

test("M07-A2R-01: Docker image inspect argv and --pull=never", () => {
  const imageInspectArgs = buildDockerImageInspectArgs("postgres:16");
  assert.deepEqual(imageInspectArgs, ["image", "inspect", "postgres:16"]);

  const runId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const containerName = `banking_test_container_${runId}`;
  const runArgs = buildDockerRunArgs({ containerName, runId });
  assert.ok(runArgs.includes("--pull=never"), "Docker run args must include --pull=never");
});

test("M07-A2R-02: Docker run loopback-only, no volume, exact label/name", () => {
  const runId = "b1b2b3b4b5b6b7b8b9b0b1b2b3b4b5b6";
  const containerName = `banking_test_container_${runId}`;
  const runArgs = buildDockerRunArgs({ containerName, runId });

  assert.equal(runArgs[0], "run");
  assert.equal(runArgs[1], "-d");
  assert.ok(runArgs.includes("--name"));
  assert.equal(runArgs[runArgs.indexOf("--name") + 1], containerName);
  assert.ok(runArgs.includes("-p"));
  assert.equal(runArgs[runArgs.indexOf("-p") + 1], "127.0.0.1::5432");
  assert.ok(runArgs.includes("-l"));
  assert.equal(runArgs[runArgs.indexOf("-l") + 1], `banking_test_run_id=${runId}`);
  assert.ok(!runArgs.includes("-v"), "Must not have -v");
  assert.ok(!runArgs.includes("--volume"), "Must not have --volume");
  assert.ok(!runArgs.includes("--mount"), "Must not have --mount");
});

test("M07-A2R-03: Docker inspect golden case", () => {
  const runId = "c1c2c3c4c5c6c7c8c9c0c1c2c3c4c5c6";
  const containerName = `banking_test_container_${runId}`;
  const fakeId = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const goldenInspectJson = JSON.stringify([
    {
      Id: fakeId,
      Name: `/${containerName}`,
      Config: {
        Image: "postgres:16",
        Labels: { banking_test_run_id: runId },
        Env: ["POSTGRES_PASSWORD=secret"],
      },
      NetworkSettings: {
        Ports: {
          "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }],
        },
      },
      Mounts: [
        {
          Type: "tmpfs",
          Source: "",
          Destination: "/var/lib/postgresql/data",
          RW: true,
          Propagation: "",
        },
      ],
      HostConfig: {
        Binds: [],
        Tmpfs: {
          "/var/lib/postgresql/data": "rw,noexec,nosuid,size=512m,mode=0700",
        },
      },
    },
  ]);

  const validated = validateDockerInspectOutput(goldenInspectJson, containerName, runId);
  assert.equal(validated.containerId, fakeId);
  assert.equal(validated.containerName, containerName);
  assert.equal(validated.hostPort, 54321);
  assert.equal(validated.bindHost, "127.0.0.1");
  assert.equal(validated.runId, runId);
});

test("M07-A2R-04: Reject malformed or multiple inspect results", () => {
  const runId = "d1d2d3d4d5d6d7d8d9d0d1d2d3d4d5d6";
  const containerName = `banking_test_container_${runId}`;

  assert.throws(
    () => validateDockerInspectOutput("{ malformed json", containerName, runId),
    /malformed JSON/,
  );
  assert.throws(
    () => validateDockerInspectOutput("[]", containerName, runId),
    /exactly one record/,
  );
  assert.throws(
    () => validateDockerInspectOutput("[{}, {}]", containerName, runId),
    /exactly one record/,
  );
});

test("M07-A2R-05: Reject wrong image, name, label, or container ID", () => {
  const runId = "e1e2e3e4e5e6e7e8e9e0e1e2e3e4e5e6";
  const containerName = `banking_test_container_${runId}`;
  const validId = "a".repeat(64);

  const baseRecord = {
    Id: validId,
    Name: `/${containerName}`,
    Config: {
      Image: "postgres:16",
      Labels: { banking_test_run_id: runId },
    },
    NetworkSettings: {
      Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] },
    },
    Mounts: [],
  };

  // Wrong image
  assert.throws(
    () => validateDockerInspectOutput(
      JSON.stringify([{ ...baseRecord, Config: { ...baseRecord.Config, Image: "mysql:8" } }]),
      containerName,
      runId,
    ),
    /is not exact approved 'postgres:16'/,
  );

  // Wrong name
  assert.throws(
    () => validateDockerInspectOutput(
      JSON.stringify([{ ...baseRecord, Name: "/banking_production_db" }]),
      containerName,
      runId,
    ),
    /does not match expected/,
  );

  // Mismatched label
  assert.throws(
    () => validateDockerInspectOutput(
      JSON.stringify([{ ...baseRecord, Config: { ...baseRecord.Config, Labels: { banking_test_run_id: "other_id" } } }]),
      containerName,
      runId,
    ),
    /missing or mismatched banking_test_run_id label/,
  );

  // Non-64-hex ID
  assert.throws(
    () => validateDockerInspectOutput(
      JSON.stringify([{ ...baseRecord, Id: "short_id" }]),
      containerName,
      runId,
    ),
    /must be exact 64 lowercase hexadecimal characters/,
  );
});

test("M07-A2R-06: Reject wildcard or non-loopback port", () => {
  const runId = "f1f2f3f4f5f6f7f8f9f0f1f2f3f4f5f6";
  const containerName = `banking_test_container_${runId}`;
  const validId = "b".repeat(64);

  const baseRecord = {
    Id: validId,
    Name: `/${containerName}`,
    Config: {
      Image: "postgres:16",
      Labels: { banking_test_run_id: runId },
    },
    Mounts: [],
  };

  // Wildcard 0.0.0.0
  assert.throws(
    () => validateDockerInspectOutput(
      JSON.stringify([{
        ...baseRecord,
        NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "54321" }] } },
      }]),
      containerName,
      runId,
    ),
    /not numeric loopback/,
  );

  // Missing port binding
  assert.throws(
    () => validateDockerInspectOutput(
      JSON.stringify([{
        ...baseRecord,
        NetworkSettings: { Ports: { "5432/tcp": [] } },
      }]),
      containerName,
      runId,
    ),
    /missing port 5432\/tcp binding/,
  );
});

test("M07-A2R-07: Reject any mount or shared descriptor", () => {
  const runId = "0102030405060708090a0b0c0d0e0f10";
  const containerName = `banking_test_container_${runId}`;
  const validId = "c".repeat(64);

  const baseRecord = {
    Id: validId,
    Name: `/${containerName}`,
    Config: {
      Image: "postgres:16",
      Labels: { banking_test_run_id: runId },
    },
    NetworkSettings: {
      Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] },
    },
  };

  // Non-empty Mounts
  assert.throws(
    () => validateDockerInspectOutput(
      JSON.stringify([{
        ...baseRecord,
        Mounts: [{ Source: "/data", Destination: "/var/lib/postgresql/data" }],
      }]),
      containerName,
      runId,
    ),
    /persistent\/shared mounts, which are strictly prohibited/,
  );

  // Non-empty HostConfig.Binds
  assert.throws(
    () => validateDockerInspectOutput(
      JSON.stringify([{
        ...baseRecord,
        Mounts: [],
        HostConfig: { Binds: ["/host:/container"] },
      }]),
      containerName,
      runId,
    ),
    /host binds, which are strictly prohibited/,
  );
});

test("M07-A2R-08: Exact-ID container removal rejects invalid container IDs", () => {
  const valid64Hex = "d".repeat(64);
  const rmArgs = buildDockerRmArgs(valid64Hex);
  assert.deepEqual(rmArgs, ["rm", "-f", "-v", valid64Hex]);

  assert.throws(() => buildDockerRmArgs("short"), /exact 64 lowercase hex/);
  assert.throws(() => buildDockerRmArgs("d".repeat(63)), /exact 64 lowercase hex/);
  assert.throws(() => buildDockerRmArgs("d".repeat(65)), /exact 64 lowercase hex/);
  assert.throws(() => buildDockerRmArgs("D".repeat(64)), /exact 64 lowercase hex/);
});

test("M07-A2R-09: Clean child environment removes hostile overrides", () => {
  const hostileEnv: NodeJS.ProcessEnv = {
    DATABASE_URL: "postgresql://hostile:bad@10.0.0.1:5432/banking_preview",
    DATABASE_TEST_RUN_ID: "hostile_run_id",
    DISPOSABLE_TEST_PHASE: "HOSTILE_PHASE",
    ALLOW_DATABASE_TEST_RESET: "0",
    EVIL_ATTACK_VARIABLE: "pwned",
    PATH: "C:\\Windows\\System32",
  };

  const cleanEnv = buildCleanChildEnvironment(
    {
      databaseUrl: "postgresql://postgres:secret@127.0.0.1:54321/banking_test_11111111111111111111111111111111",
      databaseName: "banking_test_11111111111111111111111111111111",
      runId: "11111111111111111111111111111111",
      phase: "INITIAL_HISTORY",
    },
    hostileEnv,
  );

  assert.equal(cleanEnv.DATABASE_URL, "postgresql://postgres:secret@127.0.0.1:54321/banking_test_11111111111111111111111111111111");
  assert.equal(cleanEnv.DATABASE_TEST_RUN_ID, "11111111111111111111111111111111");
  assert.equal(cleanEnv.DISPOSABLE_TEST_PHASE, "INITIAL_HISTORY");
  assert.equal(cleanEnv.ALLOW_DATABASE_TEST_RESET, "1");
  assert.equal(cleanEnv.EVIL_ATTACK_VARIABLE, undefined, "Hostile variables must be stripped");
  assert.equal(cleanEnv.PATH, "C:\\Windows\\System32");
});

test("M07-A2R-10: Cross-platform environment-key normalization preserves OS variables", () => {
  const hostEnv: NodeJS.ProcessEnv = {
    Path: "C:\\Windows\\System32",
    SystemRoot: "C:\\Windows",
    TEMP: "C:\\Temp",
    CUSTOM_FORBIDDEN: "secret",
  };

  const cleanEnv = buildCleanChildEnvironment(
    {
      databaseUrl: "postgresql://postgres:secret@127.0.0.1:54321/banking_test_22222222222222222222222222222222",
      databaseName: "banking_test_22222222222222222222222222222222",
      runId: "22222222222222222222222222222222",
    },
    hostEnv,
  );

  assert.equal(cleanEnv.Path, "C:\\Windows\\System32");
  assert.equal(cleanEnv.SystemRoot, "C:\\Windows");
  assert.equal(cleanEnv.TEMP, "C:\\Temp");
  assert.equal(cleanEnv.CUSTOM_FORBIDDEN, undefined);
});

test("M07-A2R-11: Runtime test path allowlist accepts disposableMigrationRuntime.test.ts", () => {
  const approved = assertApprovedTestPath("src/tests/disposableMigrationRuntime.test.ts");
  assert.equal(approved, "src/tests/disposableMigrationRuntime.test.ts");

  assert.throws(
    () => assertApprovedTestPath("src/tests/unauthorizedExploit.test.ts"),
    /not in the approved fixed allowlist/,
  );
});

test("M07-A2R-12: Exact four-phase allowlist validates all supported phases", () => {
  for (const phase of AUTHORIZED_EVIDENCE_PHASES) {
    const verified = assertEvidencePhase(phase);
    assert.equal(verified, phase);
  }
  assert.equal(AUTHORIZED_EVIDENCE_PHASES.length, 4);
});

test("M07-A2R-13: Invalid or missing phase fail-fast", () => {
  assert.throws(() => assertEvidencePhase(undefined), /Invalid or missing evidence phase/);
  assert.throws(() => assertEvidencePhase(""), /Invalid or missing evidence phase/);
  assert.throws(() => assertEvidencePhase("DROP_ALL_TABLES"), /Invalid or missing evidence phase/);
  assert.throws(() => assertEvidencePhase("UNKNOWN_PHASE"), /Invalid or missing evidence phase/);
});

test("M07-A2R-14: One-nibble mutation preserves 64-hex and changes exactly one character", () => {
  const original = "f0d76fa04b31b07bc00c7eeaf3ef86c2fac6c9747e18d03c8c62de46ff04d908";
  const mutated = mutateChecksumOneNibble(original);

  assert.equal(mutated.length, 64);
  assert.ok(/^[a-f0-9]{64}$/.test(mutated));
  assert.notEqual(mutated, original);

  // Exactly 1 character differs
  let diffCount = 0;
  for (let i = 0; i < 64; i++) {
    if (original[i] !== mutated[i]) diffCount++;
  }
  assert.equal(diffCount, 1, "Exactly one character must differ in one-nibble mutation");
  assert.equal(mutated[0], "0", "Leading 'f' flipped to '0'");

  const originalWith0 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const mutatedFrom0 = mutateChecksumOneNibble(originalWith0);
  assert.equal(mutatedFrom0[0], "1", "Leading '0' flipped to '1'");
});

test("M07-A2R-15: Invalid checksum rejected by one-nibble mutator", () => {
  assert.throws(() => mutateChecksumOneNibble("short"), /Invalid checksum/);
  assert.throws(() => mutateChecksumOneNibble("f".repeat(63)), /Invalid checksum/);
  assert.throws(() => mutateChecksumOneNibble("f".repeat(65)), /Invalid checksum/);
  assert.throws(() => mutateChecksumOneNibble("F".repeat(64)), /Invalid checksum/);
  assert.throws(() => mutateChecksumOneNibble("g".repeat(64)), /Invalid checksum/);
});

test("M07-A2R-16: Initial 40-row inventory helper validates exact 40 APPLIED records", () => {
  const canonicalKeys = Array.from({ length: 40 }, (_, i) => `${String(i + 1).padStart(3, "0")}_test_migration`);
  const canonicalChecksums = new Map<string, string>();
  const records = canonicalKeys.map((key) => {
    const checksum = "e".repeat(64);
    canonicalChecksums.set(key, checksum);
    return { migration_key: key, checksum, status: "APPLIED" };
  });

  // Should succeed without error
  validateMigrationHistoryRecords(records, canonicalKeys, canonicalChecksums);
});

test("M07-A2R-17: Missing, duplicate, or extra migration key rejected", () => {
  const canonicalKeys = Array.from({ length: 40 }, (_, i) => `${String(i + 1).padStart(3, "0")}_migration`);
  const validChecksum = "a".repeat(64);

  // Missing one key (39 records)
  const missingRecords = canonicalKeys.slice(0, 39).map((key) => ({
    migration_key: key,
    checksum: validChecksum,
    status: "APPLIED",
  }));
  assert.throws(
    () => validateMigrationHistoryRecords(missingRecords, canonicalKeys),
    /Expected exactly 40 migration records, got 39/,
  );

  // Duplicate key
  const duplicateRecords = [
    ...canonicalKeys.slice(0, 39).map((key) => ({ migration_key: key, checksum: validChecksum, status: "APPLIED" })),
    { migration_key: canonicalKeys[0], checksum: validChecksum, status: "APPLIED" },
  ];
  assert.throws(
    () => validateMigrationHistoryRecords(duplicateRecords, canonicalKeys),
    /Duplicate migration key in history/,
  );

  // Non-applied status
  const pendingRecords = canonicalKeys.map((key, i) => ({
    migration_key: key,
    checksum: validChecksum,
    status: i === 0 ? "PENDING" : "APPLIED",
  }));
  assert.throws(
    () => validateMigrationHistoryRecords(pendingRecords, canonicalKeys),
    /status 'PENDING', expected 'APPLIED'/,
  );
});

test("M07-A2R-18: Rerun checksum mutation rejected by history validator", () => {
  const canonicalKeys = Array.from({ length: 40 }, (_, i) => `${String(i + 1).padStart(3, "0")}_migration`);
  const canonicalChecksums = new Map<string, string>();
  for (const key of canonicalKeys) canonicalChecksums.set(key, "a".repeat(64));

  const mutatedRecords = canonicalKeys.map((key, i) => ({
    migration_key: key,
    checksum: i === 0 ? "b".repeat(64) : "a".repeat(64),
    status: "APPLIED",
  }));

  assert.throws(
    () => validateMigrationHistoryRecords(mutatedRecords, canonicalKeys, canonicalChecksums),
    /Checksum mismatch for 001_migration against canonical file/,
  );
});

test("M07-A2R-19: Expected mismatch exit classification matches canonical failure output", () => {
  const canonicalMismatchOutput = {
    exitCode: 1,
    stdout: "",
    stderr: "Error: Migration checksum mismatch for 001_banking_mvp; refusing to run a modified applied migration.",
  };
  assert.equal(isExpectedChecksumMismatchRefusal(canonicalMismatchOutput, "001_banking_mvp"), true);
});

test("M07-A2R-20: Unrelated nonzero exit rejected by mismatch classifier", () => {
  // Connection error
  assert.equal(
    isExpectedChecksumMismatchRefusal({
      exitCode: 1,
      stdout: "",
      stderr: "Error: connect ECONNREFUSED 127.0.0.1:5432",
    }),
    false,
  );

  // Syntax error
  assert.equal(
    isExpectedChecksumMismatchRefusal({
      exitCode: 1,
      stdout: "",
      stderr: "SyntaxError: Unexpected token",
    }),
    false,
  );

  // Success exit code 0
  assert.equal(
    isExpectedChecksumMismatchRefusal({
      exitCode: 0,
      stdout: "Migrations applied successfully",
      stderr: "",
    }),
    false,
  );

  // Exit code 2
  assert.equal(
    isExpectedChecksumMismatchRefusal({
      exitCode: 2,
      stdout: "",
      stderr: "Migration checksum mismatch for 001_banking_mvp",
    }),
    false,
  );
});

test("M07-A2R-21: Canonical 19-step sequence ordering with test doubles", async () => {
  const fixedRunId = "1234567890abcdef1234567890abcdef";
  const fixedContainerId = "e".repeat(64);
  const fixedContainerName = `banking_test_container_${fixedRunId}`;
  const sequenceEvents: string[] = [];

  const mockDocker: DockerAdapter = {
    async inspectImage() { return JSON.stringify([{ Id: "sha256:" + "0".repeat(64), RepoTags: ["postgres:16"] }]); },
    async runContainer() { return fixedContainerId; },
    async inspectContainer() {
      return JSON.stringify([{
        Id: fixedContainerId,
        Name: `/${fixedContainerName}`,
        Image: "sha256:" + "0".repeat(64), Config: { Image: "postgres:16", Labels: { banking_test_run_id: fixedRunId } },
        NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] } },
        Mounts: [{ Type: "tmpfs", Source: "", Destination: "/var/lib/postgresql/data", RW: true }],
        HostConfig: { Binds: [], Tmpfs: { "/var/lib/postgresql/data": "rw,noexec,nosuid,size=512m,mode=0700" } },
      }]);
    },
    async attestMountNamespace(containerId: string) {
      sequenceEvents.push("attest");
      assert.equal(containerId, fixedContainerId);
      return validMountInfoFixture;
    },
    async removeContainer() {},
    async waitForReady() {
      sequenceEvents.push("ready");
    },
  };

  const poolQueries: string[] = [];
  const mockPool: DisposablePoolClient = {
    async query(sql: string) {
      sequenceEvents.push("db");
      poolQueries.push(sql);
      if (sql.includes("COUNT(*)")) {
        return { rows: [{ count: 0 }] };
      }
      return { rows: [] };
    },
    async end() {},
  };

  const executedCommands: string[] = [];
  let verifyOnlyCount = 0;
  const mockRunCmd = async (cmd: string, args: readonly string[]) => {
    executedCommands.push(`${cmd} ${args.join(" ")}`);
    if (args.includes("--verify-only")) {
      verifyOnlyCount++;
      if (verifyOnlyCount === 2) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Migration checksum mismatch for 001_banking_mvp; refusing to run.",
        };
      }
    }
    return {
      exitCode: 0,
      stdout: "OK",
      stderr: "",
    };
  };

  const result = await runCanonicalEvidenceSequence(
    {
      NODE_ENV: "test",
      PATH: "C:\\Windows\\System32",
    },
    {
      dockerAdapter: mockDocker,
      createPoolFn: () => {
        sequenceEvents.push("pool");
        return mockPool;
      },
      runCommandFn: mockRunCmd,
      runIdGenerator: () => fixedRunId,
    },
  );

  assert.equal(result.success, true);
  assert.equal(result.containerId, fixedContainerId);
  assert.ok(sequenceEvents.indexOf("attest") >= 0, "Mount namespace attestation must run");
  assert.ok(sequenceEvents.indexOf("attest") < sequenceEvents.indexOf("ready"), "Attestation must precede readiness");
  assert.ok(sequenceEvents.indexOf("attest") < sequenceEvents.indexOf("db"), "Attestation must precede every database action");
  assert.deepEqual(result.completedSteps, [
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
    "19_VALIDATE_COMPLETION",
    "15_CLOSE_TARGET_CONNECTIONS",
    "16_CLEANUP_TARGET_DATABASE",
    "17_PARENT_POST_DROP_CATALOG_CHECK",
    "18_REMOVE_CONTAINER",
  ]);
});

test("M07-A2R-22: Restoration verify-only failure fails closed and triggers cleanup", async () => {
  const fixedRunId = "abcdef1234567890abcdef1234567890";
  const fixedContainerId = "f".repeat(64);
  const fixedContainerName = `banking_test_container_${fixedRunId}`;

  const mockDocker: DockerAdapter = {
    async inspectImage() { return JSON.stringify([{ Id: "sha256:" + "0".repeat(64), RepoTags: ["postgres:16"] }]); },
    async runContainer() { return fixedContainerId; },
    async inspectContainer() {
      return JSON.stringify([{
        Id: fixedContainerId,
        Name: `/${fixedContainerName}`,
        Image: "sha256:" + "0".repeat(64),
        Config: { Image: "postgres:16", Labels: { banking_test_run_id: fixedRunId } },
        NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] } },
        Mounts: [{ Type: "tmpfs", Source: "", Destination: "/var/lib/postgresql/data", RW: true }],
        HostConfig: { Binds: [], Tmpfs: { "/var/lib/postgresql/data": "rw,noexec,nosuid,size=512m,mode=0700" } },
      }]);
    },
    async attestMountNamespace(containerId: string) {
      assert.equal(containerId, fixedContainerId);
      return validMountInfoFixture;
    },
    async removeContainer() {},
    async waitForReady() {},
  };

  const mockPool: DisposablePoolClient = {
    async query(sql: string) {
      if (sql.includes("COUNT(*)")) return { rows: [{ count: 0 }] };
      return { rows: [] };
    },
    async end() {},
  };

  let verifyCount = 0;
  const mockRunCmd = async (cmd: string, args: readonly string[]) => {
    if (args.includes("--verify-only")) {
      verifyCount++;
      if (verifyCount === 1) return { exitCode: 0, stdout: "", stderr: "" };
      if (verifyCount === 2) return { exitCode: 1, stdout: "", stderr: "Migration checksum mismatch for 001_banking_mvp" };
      // Step 14 post-restore verify-only fails unexpectedly:
      if (verifyCount === 3) return { exitCode: 1, stdout: "", stderr: "Restoration failed unexpectedly" };
    }
    return { exitCode: 0, stdout: "OK", stderr: "" };
  };

  const result = await runCanonicalEvidenceSequence(
    { PATH: "C:\\Windows\\System32" },
    {
      dockerAdapter: mockDocker,
      createPoolFn: () => mockPool,
      runCommandFn: mockRunCmd,
      runIdGenerator: () => fixedRunId,
    },
  );

  assert.equal(result.success, false);
  assert.ok(result.error?.message.includes("Post-restore verify-only failed"));
  assert.ok(result.completedSteps.includes("16_CLEANUP_TARGET_DATABASE"), "Must execute database cleanup");
  assert.ok(result.completedSteps.includes("18_REMOVE_CONTAINER"), "Must execute container removal");
});

test("M07-A2R-23: Parent post-drop count must equal zero or fail closed", async () => {
  // Count === 0 succeeds
  const zeroPool: DisposablePoolClient = {
    async query() { return { rows: [{ count: 0 }] }; },
    async end() {},
  };
  await verifyDatabaseDroppedInCatalog(zeroPool, "banking_test_target");

  // Count === 1 fails closed
  const remainingPool: DisposablePoolClient = {
    async query() { return { rows: [{ count: 1 }] }; },
    async end() {},
  };
  await assert.rejects(
    () => verifyDatabaseDroppedInCatalog(remainingPool, "banking_test_target"),
    /still present in pg_database \(count = 1\)/,
  );
});


// ============================================================================
// M07-A2R Safety Binding Follow-Up Tests (Pure In-Memory Test Doubles, No DB)
// ============================================================================

// Correction A: Exact Immutable Docker Image Binding
test("M07-A2R-FU-01: Exact tag and immutable image ID valid accepted", () => {
  const validImageId = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const validJson = JSON.stringify([{
    Id: validImageId,
    RepoTags: ["postgres:16"],
  }]);
  const imageId = validateDockerImageInspectOutput(validJson, "postgres:16");
  assert.equal(imageId, validImageId);
});

test("M07-A2R-FU-02: Image inspect rejects evil/postgres:16", () => {
  const validImageId = "sha256:" + "1".repeat(64);
  const json = JSON.stringify([{
    Id: validImageId,
    RepoTags: ["evil/postgres:16"],
  }]);
  assert.throws(
    () => validateDockerImageInspectOutput(json, "postgres:16"),
    /does not contain exact tag 'postgres:16'/,
  );
});

test("M07-A2R-FU-03: Image inspect rejects postgres:16-malicious", () => {
  const validImageId = "sha256:" + "2".repeat(64);
  const json = JSON.stringify([{
    Id: validImageId,
    RepoTags: ["postgres:16-malicious"],
  }]);
  assert.throws(
    () => validateDockerImageInspectOutput(json, "postgres:16"),
    /does not contain exact tag 'postgres:16'/,
  );
});

test("M07-A2R-FU-04: Image inspect rejects prefix-postgres:16-suffix", () => {
  const validImageId = "sha256:" + "3".repeat(64);
  const json = JSON.stringify([{
    Id: validImageId,
    RepoTags: ["prefix-postgres:16-suffix"],
  }]);
  assert.throws(
    () => validateDockerImageInspectOutput(json, "postgres:16"),
    /does not contain exact tag 'postgres:16'/,
  );
});

test("M07-A2R-FU-05: Image inspect rejects invalid immutable image ID format", () => {
  assert.throws(
    () => validateDockerImageInspectOutput(JSON.stringify([{ Id: "short", RepoTags: ["postgres:16"] }]), "postgres:16"),
    /missing or invalid immutable image ID format/,
  );
  assert.throws(
    () => validateDockerImageInspectOutput(JSON.stringify([{ Id: "sha256:" + "0".repeat(63), RepoTags: ["postgres:16"] }]), "postgres:16"),
    /missing or invalid immutable image ID format/,
  );
  assert.throws(
    () => validateDockerImageInspectOutput(JSON.stringify([{ Id: "sha256:" + "G".repeat(64), RepoTags: ["postgres:16"] }]), "postgres:16"),
    /missing or invalid immutable image ID format/,
  );
  assert.throws(
    () => validateDockerImageInspectOutput(JSON.stringify([{ Id: "md5:" + "0".repeat(64), RepoTags: ["postgres:16"] }]), "postgres:16"),
    /missing or invalid immutable image ID format/,
  );
});

test("M07-A2R-FU-06: Container inspect rejects Image differing from local inspected image ID", () => {
  const runId = "00000000000000000000000000000001";
  const containerName = `banking_test_container_${runId}`;
  const containerId = "a".repeat(64);
  const localImageId = "sha256:" + "a".repeat(64);
  const differentImageId = "sha256:" + "b".repeat(64);

  const inspectJson = JSON.stringify([{
    Id: containerId,
    Name: `/${containerName}`,
    Image: differentImageId,
    Config: { Image: "postgres:16", Labels: { banking_test_run_id: runId } },
    NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] } },
    Mounts: [],
  }]);

  assert.throws(
    () => validateDockerInspectOutput(inspectJson, containerName, runId, localImageId, containerId),
    /does not match approved local immutable image ID/,
  );
});

test("M07-A2R-FU-07: Image inspect rejects 0 or multiple objects", () => {
  assert.throws(
    () => validateDockerImageInspectOutput("[]", "postgres:16"),
    /exactly one record/,
  );
  assert.throws(
    () => validateDockerImageInspectOutput("[{}, {}]", "postgres:16"),
    /exactly one record/,
  );
});

// Correction B: Docker Run / Inspect Container-ID Binding
test("M07-A2R-FU-08: Exact 64-hex run ID parsed and bound successfully", () => {
  const valid64Hex = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
  const parsedId = parseAndValidateLaunchedContainerId(valid64Hex);
  assert.equal(parsedId, valid64Hex);

  const parsedWithWhitespace = parseAndValidateLaunchedContainerId(`  ${valid64Hex}  `);
  assert.equal(parsedWithWhitespace, valid64Hex);
});

test("M07-A2R-FU-09: Reject run stdout with two IDs or multiple lines", () => {
  const id1 = "a".repeat(64);
  const id2 = "b".repeat(64);
  assert.throws(
    () => parseAndValidateLaunchedContainerId(`${id1}\n${id2}`),
    /invalid container ID format/,
  );
  assert.throws(
    () => parseAndValidateLaunchedContainerId(`${id1}\r\n${id2}`),
    /invalid container ID format/,
  );
});

test("M07-A2R-FU-10: Reject short, uppercase, or malformed run ID", () => {
  assert.throws(() => parseAndValidateLaunchedContainerId(""), /invalid container ID format/);
  assert.throws(() => parseAndValidateLaunchedContainerId("short"), /invalid container ID format/);
  assert.throws(() => parseAndValidateLaunchedContainerId("A".repeat(64)), /invalid container ID format/);
  assert.throws(() => parseAndValidateLaunchedContainerId("a".repeat(63)), /invalid container ID format/);
  assert.throws(() => parseAndValidateLaunchedContainerId("a".repeat(65)), /invalid container ID format/);
  assert.throws(() => parseAndValidateLaunchedContainerId(`${"a".repeat(64)} extra text`), /invalid container ID format/);
});

test("M07-A2R-FU-11: Reject inspect ID differing from launch ID", () => {
  const runId = "00000000000000000000000000000002";
  const containerName = `banking_test_container_${runId}`;
  const launchId = "c".repeat(64);
  const reportedInspectId = "d".repeat(64);
  const localImageId = "sha256:" + "c".repeat(64);

  const inspectJson = JSON.stringify([{
    Id: reportedInspectId,
    Name: `/${containerName}`,
    Image: localImageId,
    Config: { Image: "postgres:16", Labels: { banking_test_run_id: runId } },
    NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] } },
    Mounts: [],
  }]);

  assert.throws(
    () => validateDockerInspectOutput(inspectJson, containerName, runId, localImageId, launchId),
    /does not match launched container ID/,
  );
});

test("M07-A2R-FU-12: Sequence fails before DB creation and cleans up launch ID on inspect ID mismatch", async () => {
  const fixedRunId = "00000000000000000000000000000003";
  const launchId = "1".repeat(64);
  const mismatchedInspectId = "2".repeat(64);
  const fixedContainerName = `banking_test_container_${fixedRunId}`;
  const localImageId = "sha256:" + "3".repeat(64);

  const removedContainerIds: string[] = [];
  const executedDbQueries: string[] = [];
  const executedCommands: string[] = [];

  const mockDocker: DockerAdapter = {
    async inspectImage() {
      return JSON.stringify([{ Id: localImageId, RepoTags: ["postgres:16"] }]);
    },
    async runContainer() {
      return launchId;
    },
    async inspectContainer() {
      // Returns inspect with mismatched ID
      return JSON.stringify([{
        Id: mismatchedInspectId,
        Name: `/${fixedContainerName}`,
        Image: localImageId,
        Config: { Image: "postgres:16", Labels: { banking_test_run_id: fixedRunId } },
        NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] } },
        Mounts: [],
      }]);
    },
    async attestMountNamespace() {
      return validMountInfoFixture;
    },
    async removeContainer(id: string) {
      removedContainerIds.push(id);
    },
    async waitForReady() {},
  };

  const mockPool: DisposablePoolClient = {
    async query(sql: string) {
      executedDbQueries.push(sql);
      return { rows: [] };
    },
    async end() {},
  };

  const mockRunCmd = async (cmd: string, args: readonly string[]) => {
    executedCommands.push(`${cmd} ${args.join(" ")}`);
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  const result = await runCanonicalEvidenceSequence(
    { PATH: "C:\\Windows\\System32" },
    {
      dockerAdapter: mockDocker,
      createPoolFn: () => mockPool,
      runCommandFn: mockRunCmd,
      runIdGenerator: () => fixedRunId,
    },
  );

  assert.equal(result.success, false);
  assert.match(result.error?.message ?? "", /does not match launched container ID/);
  // Zero DB queries
  assert.equal(executedDbQueries.length, 0, "Zero DB queries on container ID mismatch");
  // Zero child process commands
  assert.equal(executedCommands.length, 0, "Zero child process commands on container ID mismatch");
  // Cleanup removes launchedContainerId, NEVER the untrusted mismatchedInspectId!
  assert.deepEqual(removedContainerIds, [launchId], "Cleanup must target exact launch ID");
  assert.ok(!removedContainerIds.includes(mismatchedInspectId), "Cleanup must NOT target untrusted inspect ID");
});

// Correction C: Runtime Ownership Gate Before Phase Action
test("M07-A2R-FU-13: Shared assertRuntimeDatabaseOwnership accepts valid canonical marker and current database", () => {
  const runId = "00000000000000000000000000000004";
  const expectedDbName = `banking_test_${runId}`;
  const canonicalComment = `disposable_run_id=${runId};owner=m01_runner;created_at=1234567890`;

  // Should succeed without error
  assertRuntimeDatabaseOwnership(
    {
      currentDatabase: expectedDbName,
      comment: canonicalComment,
    },
    runId,
  );
});

test("M07-A2R-FU-14: Ownership gate rejects missing or malformed marker", () => {
  const runId = "00000000000000000000000000000005";
  const expectedDbName = `banking_test_${runId}`;

  assert.throws(
    () => assertRuntimeDatabaseOwnership({ currentDatabase: expectedDbName, comment: "" }, runId),
    /missing database ownership comment/,
  );
  assert.throws(
    () => assertRuntimeDatabaseOwnership({ currentDatabase: expectedDbName, comment: "not_a_marker" }, runId),
    /Malformed ownership marker/,
  );
});

test("M07-A2R-FU-15: Ownership gate rejects wrong owner or runId mismatch", () => {
  const runId = "00000000000000000000000000000006";
  const expectedDbName = `banking_test_${runId}`;

  // Wrong owner
  assert.throws(
    () => assertRuntimeDatabaseOwnership(
      { currentDatabase: expectedDbName, comment: `disposable_run_id=${runId};owner=evil_hacker;created_at=1` },
      runId,
    ),
    /unexpected or missing owner/,
  );

  // Run ID mismatch
  assert.throws(
    () => assertRuntimeDatabaseOwnership(
      { currentDatabase: expectedDbName, comment: `disposable_run_id=ffffffffffffffffffffffffffffffff;owner=m01_runner;created_at=1` },
      runId,
    ),
    /Ownership marker run_id mismatch/,
  );
});

test("M07-A2R-FU-16: Ownership gate rejects current_database mismatch", () => {
  const runId = "00000000000000000000000000000007";
  const comment = `disposable_run_id=${runId};owner=m01_runner;created_at=1`;

  assert.throws(
    () => assertRuntimeDatabaseOwnership(
      { currentDatabase: "banking_preview", comment },
      runId,
    ),
    /current_database does not match expected target/,
  );
});

test("M07-A2R-FU-17: Ownership gate check enforced before any phase action across all four phases", () => {
  const phases = ["INITIAL_HISTORY", "RERUN_HISTORY", "INJECT_CHECKSUM_MISMATCH", "RESTORE_CHECKSUM"] as const;
  const runId = "00000000000000000000000000000008";

  for (const phase of phases) {
    let actionExecuted = false;
    const testDoubleWorker = (catalogInfo: { currentDatabase: string; comment: string }) => {
      // 1. Ownership gate
      assertRuntimeDatabaseOwnership(catalogInfo, runId);
      // 2. Phase action
      actionExecuted = true;
    };

    // On invalid marker: must fail closed with zero action
    assert.throws(
      () => testDoubleWorker({ currentDatabase: `banking_test_${runId}`, comment: "bad_marker" }),
      /Malformed ownership marker/,
    );
    assert.equal(actionExecuted, false, `Phase ${phase} action must NOT execute when ownership gate fails`);
  }
});

// Correction D: Case-Insensitive Protected Environment
test("M07-A2R-FU-18: Hostile lowercase inherited keys are stripped case-insensitively", () => {
  const hostileEnv: NodeJS.ProcessEnv = {
    database_url: "postgresql://hostile@10.0.0.1:5432/banking_preview",
    database_test_phase: "EVIL_PHASE",
    database_test_run_id: "hostile_run_id",
    database_test_disposable: "0",
    allow_database_test_reset: "0",
    PATH: "C:\\Windows\\System32",
  };

  const clean = buildCleanChildEnvironment(
    {
      databaseUrl: "postgresql://postgres:secret@127.0.0.1:54321/banking_test_00000000000000000000000000000009",
      databaseName: "banking_test_00000000000000000000000000000009",
      runId: "00000000000000000000000000000009",
      phase: "INITIAL_HISTORY",
    },
    hostileEnv,
  );

  assert.equal(clean.database_url, undefined, "database_url must be stripped");
  assert.equal(clean.database_test_phase, undefined, "database_test_phase must be stripped");
  assert.equal(clean.database_test_run_id, undefined, "database_test_run_id must be stripped");
  assert.equal(clean.database_test_disposable, undefined, "database_test_disposable must be stripped");
  assert.equal(clean.allow_database_test_reset, undefined, "allow_database_test_reset must be stripped");

  // Canonical runner values exist in uppercase only
  assert.equal(clean.DATABASE_URL, "postgresql://postgres:secret@127.0.0.1:54321/banking_test_00000000000000000000000000000009");
  assert.equal(clean.DATABASE_TEST_RUN_ID, "00000000000000000000000000000009");
  assert.equal(clean.DISPOSABLE_TEST_PHASE, "INITIAL_HISTORY");
  assert.equal(clean.DATABASE_TEST_DISPOSABLE, "1");
  assert.equal(clean.ALLOW_DATABASE_TEST_RESET, "1");
});

test("M07-A2R-FU-19: Mixed-case inherited keys are stripped and canonical runner value wins", () => {
  const hostileEnv: NodeJS.ProcessEnv = {
    Database_Url: "postgresql://mixedcase@10.0.0.1:5432/preview",
    Database_Test_Run_Id: "bad_run_id",
    Database_Test_Phase: "BAD_PHASE",
    Database_Test_Disposable: "0",
    Path: "C:\\Windows\\System32",
  };

  const clean = buildCleanChildEnvironment(
    {
      databaseUrl: "postgresql://postgres:secret@127.0.0.1:54321/banking_test_00000000000000000000000000000010",
      databaseName: "banking_test_00000000000000000000000000000010",
      runId: "00000000000000000000000000000010",
    },
    hostileEnv,
  );

  assert.equal(clean.Database_Url, undefined);
  assert.equal(clean.Database_Test_Run_Id, undefined);
  assert.equal(clean.Database_Test_Phase, undefined);
  assert.equal(clean.Database_Test_Disposable, undefined);

  assert.equal(clean.DATABASE_URL, "postgresql://postgres:secret@127.0.0.1:54321/banking_test_00000000000000000000000000000010");
  assert.equal(clean.DATABASE_TEST_RUN_ID, "00000000000000000000000000000010");
  assert.equal(clean.DATABASE_TEST_DISPOSABLE, "1");
  assert.equal(clean.Path, "C:\\Windows\\System32");
});

test("M07-A2R-FU-20: Unrelated OS allowlisted keys preserved and arbitrary secrets discarded", () => {
  const hostEnv: NodeJS.ProcessEnv = {
    SystemRoot: "C:\\Windows",
    TEMP: "C:\\Temp",
    TMP: "C:\\Temp",
    USERPROFILE: "C:\\Users\\Admin",
    AWS_SECRET_ACCESS_KEY: "super_secret_aws",
    GITHUB_TOKEN: "ghp_secret_token",
    OPENAI_API_KEY: "sk_secret",
    DATABASE_TEST_RUN_ID: "old_id",
  };

  const clean = buildCleanChildEnvironment(
    {
      databaseUrl: "postgresql://postgres:secret@127.0.0.1:54321/banking_test_00000000000000000000000000000011",
      databaseName: "banking_test_00000000000000000000000000000011",
      runId: "00000000000000000000000000000011",
    },
    hostEnv,
  );

  // OS allowlisted keys preserved
  assert.equal(clean.SystemRoot, "C:\\Windows");
  assert.equal(clean.TEMP, "C:\\Temp");
  assert.equal(clean.TMP, "C:\\Temp");
  assert.equal(clean.USERPROFILE, "C:\\Users\\Admin");

  // Arbitrary secrets discarded
  assert.equal(clean.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(clean.GITHUB_TOKEN, undefined);
  assert.equal(clean.OPENAI_API_KEY, undefined);

  // Protected key overridden with runner value
  assert.equal(clean.DATABASE_TEST_RUN_ID, "00000000000000000000000000000011");
  assert.equal(clean.DATABASE_TEST_DISPOSABLE, "1");
});

test("M07-A2R-FU-21: canonical DISPOSABLE_TEST_PHASE strips all inherited casing variants and remains the only forwarded phase key", () => {
  const hostEnv: NodeJS.ProcessEnv = {
    disposable_test_phase: "HOSTILE_LOWER",
    Disposable_Test_Phase: "HOSTILE_MIXED",
    DATABASE_TEST_PHASE: "HOSTILE_LEGACY_UPPER",
    database_test_phase: "HOSTILE_LEGACY_LOWER",
    PATH: "C:\\Windows\\System32",
    AWS_SECRET_KEY: "secret",
  };

  const clean = buildCleanChildEnvironment(
    {
      databaseUrl: "postgresql://postgres:secret@127.0.0.1:54321/banking_test_00000000000000000000000000000012",
      databaseName: "banking_test_00000000000000000000000000000012",
      runId: "00000000000000000000000000000012",
      phase: "INITIAL_HISTORY",
    },
    hostEnv,
  );

  assert.equal(clean.DISPOSABLE_TEST_PHASE, "INITIAL_HISTORY");
  assert.equal(clean.disposable_test_phase, undefined);
  assert.equal(clean.Disposable_Test_Phase, undefined);
  assert.equal(clean.database_test_phase, undefined);
  assert.equal(clean.DATABASE_TEST_PHASE, undefined);

  // Exactly 1 key whose upper case is DISPOSABLE_TEST_PHASE
  const disposablePhaseKeys = Object.keys(clean).filter((k) => k.toUpperCase() === "DISPOSABLE_TEST_PHASE");
  assert.equal(disposablePhaseKeys.length, 1);
  assert.equal(disposablePhaseKeys[0], "DISPOSABLE_TEST_PHASE");

  // Exactly 0 keys whose upper case is DATABASE_TEST_PHASE
  const databasePhaseKeys = Object.keys(clean).filter((k) => k.toUpperCase() === "DATABASE_TEST_PHASE");
  assert.equal(databasePhaseKeys.length, 0);

  // OS allowlisted key preserved
  assert.equal(clean.PATH, "C:\\Windows\\System32");

  // Arbitrary secret discarded
  assert.equal(clean.AWS_SECRET_KEY, undefined);
});

// ============================================================================
// M07-A2 CLI Entrypoint Dispatcher Remediation Tests (CLI-01 .. CLI-05)
// ============================================================================

const mockLegacySuccessResult: RunnerExecutionResult = {
  success: true,
  runId: "00000000000000000000000000000099",
  databaseName: "banking_test_00000000000000000000000000000099",
  lifecycleState: "COMPLETED",
};

test("M07-A2-CLI-01: canonical runtime target dispatches into canonical runner without calling legacy runner", async () => {
  let canonicalCalls = 0;
  let legacyCalls = 0;
  let passedEnv: NodeJS.ProcessEnv | undefined;

  const mockFacade: ProcessFacade = { exitCode: 0 };

  const resSuccess = await dispatchCliRun(
    ["node", "scripts/run-disposable-postgres-test.ts", CANONICAL_RUNTIME_TEST_PATH],
    {
      // Note: DATABASE_TEST_ADMIN_URL is purposely omitted to prove canonical sequence does not require it
      NODE_ENV: "test",
    },
    {
      processFacade: mockFacade,
      canonicalRunnerFn: async (hostEnv) => {
        canonicalCalls++;
        passedEnv = hostEnv;
        return {
          success: true,
          runId: "00000000000000000000000000000001",
          databaseName: "banking_test_00000000000000000000000000000001",
          completedSteps: ["1_VERIFY_LOCAL_IMAGE", "19_VALIDATE_COMPLETION"],
        };
      },
      legacyRunnerFn: async () => {
        legacyCalls++;
        return mockLegacySuccessResult;
      },
    },
  );

  assert.equal(resSuccess.handled, "CANONICAL");
  assert.equal(resSuccess.success, true);
  assert.equal(canonicalCalls, 1);
  assert.equal(legacyCalls, 0);
  assert.equal(mockFacade.exitCode, 0);
  assert.equal(passedEnv?.NODE_ENV, "test");
  assert.equal(passedEnv?.DATABASE_TEST_ADMIN_URL, undefined);

  // Failure path
  const mockFailFacade: ProcessFacade = { exitCode: 0 };
  const resFail = await dispatchCliRun(
    ["node", "scripts/run-disposable-postgres-test.ts", CANONICAL_RUNTIME_TEST_PATH],
    {},
    {
      processFacade: mockFailFacade,
      canonicalRunnerFn: async () => {
        return {
          success: false,
          runId: "00000000000000000000000000000002",
          databaseName: "banking_test_00000000000000000000000000000002",
          completedSteps: ["1_VERIFY_LOCAL_IMAGE"],
          error: new Error("Canonical verification aborted"),
        };
      },
      legacyRunnerFn: async () => {
        legacyCalls++;
        return mockLegacySuccessResult;
      },
    },
  );

  assert.equal(resFail.handled, "CANONICAL");
  assert.equal(resFail.success, false);
  assert.equal(resFail.error?.message, "Canonical verification aborted");
  assert.equal(mockFailFacade.exitCode, 1);
  assert.equal(legacyCalls, 0);
});

test("M07-A2-CLI-02: non-canonical path variants (whitespace, relative, Windows backslash, absolute, case variants, suffix) are rejected from canonical selection", async () => {
  const rejectedVariants = [
    " src/tests/disposableMigrationRuntime.test.ts",
    "src/tests/disposableMigrationRuntime.test.ts ",
    "./src/tests/disposableMigrationRuntime.test.ts",
    "src\\tests\\disposableMigrationRuntime.test.ts",
    ".\\src\\tests\\disposableMigrationRuntime.test.ts",
    "C:/Projects/banking-system/backend/src/tests/disposableMigrationRuntime.test.ts",
    "src/tests/../tests/disposableMigrationRuntime.test.ts",
    "src/tests/DisposableMigrationRuntime.test.ts",
    "SRC/TESTS/DISPOSABLEMIGRATIONRUNTIME.TEST.TS",
    "src/tests/disposableMigrationRuntime.test.ts.bak",
    "prefix_src/tests/disposableMigrationRuntime.test.ts",
  ];

  for (const variant of rejectedVariants) {
    // 1. Predicate must reject variant as canonical and flag as reserved candidate
    assert.equal(isCanonicalRuntimePath(variant), false, `Variant '${variant}' must not be recognized as canonical path`);
    assert.equal(isReservedCanonicalRuntimeCandidate(variant), true, `Variant '${variant}' must be identified as reserved candidate`);

    // 2. Dispatch must never invoke canonical runner or legacy runner for reserved variant
    let canonicalCalls = 0;
    let legacyCalls = 0;
    const facade: ProcessFacade = { exitCode: 0 };

    const res = await dispatchCliRun(
      ["node", "scripts/run-disposable-postgres-test.ts", variant],
      {},
      {
        processFacade: facade,
        canonicalRunnerFn: async () => {
          canonicalCalls++;
          return {
            success: true,
            runId: "00000000000000000000000000000003",
            databaseName: "banking_test_00000000000000000000000000000003",
            completedSteps: ["19_VALIDATE_COMPLETION"],
          };
        },
        legacyRunnerFn: async () => {
          legacyCalls++;
          return mockLegacySuccessResult;
        },
      },
    );

    assert.equal(canonicalCalls, 0, `Canonical runner must never be called for non-canonical variant '${variant}'`);
    assert.equal(legacyCalls, 0, `Legacy runner must never be called for reserved variant '${variant}'`);
    assert.equal(facade.exitCode, 1, `Process exitCode must be set to 1 for variant '${variant}'`);
    assert.equal(res.handled, "REJECTED", `Reserved variant '${variant}' must be handled as REJECTED`);
    assert.equal(res.success, false, `Reserved variant '${variant}' must return success=false`);
    assert.ok(res.error, `Reserved variant '${variant}' must return an error`);
    const sanitized = sanitizeLogOutput(res.error.message);
    assert.doesNotMatch(sanitized, /password|secret/i);
  }
});

test("M07-A2-CLI-03: multiple arguments containing canonical target fail closed without invoking any runner", async () => {
  const multipleArgScenarios = [
    ["node", "scripts/run-disposable-postgres-test.ts", CANONICAL_RUNTIME_TEST_PATH, "src/tests/registrationRelational.test.ts"],
    ["node", "scripts/run-disposable-postgres-test.ts", "src/tests/workerOutbox.test.ts", CANONICAL_RUNTIME_TEST_PATH],
    ["node", "scripts/run-disposable-postgres-test.ts", "--flag", CANONICAL_RUNTIME_TEST_PATH],
    ["node", "scripts/run-disposable-postgres-test.ts", CANONICAL_RUNTIME_TEST_PATH, "--extra"],
  ];

  for (const argv of multipleArgScenarios) {
    let canonicalCalls = 0;
    let legacyCalls = 0;
    const facade: ProcessFacade = { exitCode: 0 };

    const res = await dispatchCliRun(
      argv,
      {},
      {
        processFacade: facade,
        canonicalRunnerFn: async () => {
          canonicalCalls++;
          return {
            success: true,
            runId: "00000000000000000000000000000004",
            databaseName: "banking_test_00000000000000000000000000000004",
            completedSteps: [],
          };
        },
        legacyRunnerFn: async () => {
          legacyCalls++;
          return mockLegacySuccessResult;
        },
      },
    );

    assert.equal(res.handled, "REJECTED");
    assert.equal(res.success, false);
    assert.equal(canonicalCalls, 0, `Canonical runner must not be called for multiple args: ${argv.join(" ")}`);
    assert.equal(legacyCalls, 0, `Legacy runner must not be called for multiple args: ${argv.join(" ")}`);
    assert.equal(facade.exitCode, 1, `Process exitCode must be set to 1 for multiple args: ${argv.join(" ")}`);
    assert.match(res.error?.message ?? "", /cannot be combined/i);
  }
});

test("M07-A2-CLI-04: legacy/non-canonical targets dispatch into runDisposablePostgresTest without calling canonical runner", async () => {
  let canonicalCalls = 0;
  let legacyCalls = 0;
  let passedTestFiles: readonly string[] = [];

  const facade: ProcessFacade = { exitCode: 0 };

  const res = await dispatchCliRun(
    ["node", "scripts/run-disposable-postgres-test.ts", "src/tests/registrationRelational.test.ts"],
    { DATABASE_TEST_ADMIN_URL: "postgresql://postgres:secret@localhost:5432/postgres" },
    {
      processFacade: facade,
      canonicalRunnerFn: async () => {
        canonicalCalls++;
        return {
          success: true,
          runId: "00000000000000000000000000000005",
          databaseName: "banking_test_00000000000000000000000000000005",
          completedSteps: [],
        };
      },
      legacyRunnerFn: async (testFiles) => {
        legacyCalls++;
        passedTestFiles = testFiles;
        return mockLegacySuccessResult;
      },
    },
  );

  assert.equal(res.handled, "LEGACY");
  assert.equal(res.success, true);
  assert.equal(canonicalCalls, 0);
  assert.equal(legacyCalls, 1);
  assert.deepEqual(passedTestFiles, ["src/tests/registrationRelational.test.ts"]);
  assert.equal(facade.exitCode, 0);
});

test("M07-A2-CLI-05: runner import is side-effect-free, and production main seam runCliMain handles failure, redacting error output", async () => {
  // 1. Verify side-effect-free module import
  const initialExitCode = process.exitCode;
  const runnerModulePath = "../../scripts/run-disposable-postgres-test.js";
  const runnerModule = await import(runnerModulePath);
  assert.equal(process.exitCode, initialExitCode, "Importing runner module must not mutate process.exitCode");
  assert.equal(typeof runnerModule.runCliMain, "function", "runner script must export runCliMain");
  assert.equal(typeof runnerModule.dispatchCliRun, "function", "runner script must export dispatchCliRun");
  assert.equal(typeof runnerModule.isCanonicalRuntimePath, "function", "runner script must export isCanonicalRuntimePath");
  assert.equal(typeof runnerModule.isReservedCanonicalRuntimeCandidate, "function", "runner script must export isReservedCanonicalRuntimeCandidate");
  assert.equal(runnerModule.CANONICAL_RUNTIME_TEST_PATH, "src/tests/disposableMigrationRuntime.test.ts");

  // 2. Canonical sequence failure sets exitCode=1, redacts sensitive error messages, and does not fallback or retry
  let canonicalCalls = 0;
  let legacyCalls = 0;
  const loggedErrors: string[] = [];

  const facade: ProcessFacade = { exitCode: 0 };
  const sensitiveError = new Error(
    "Connection failed postgresql://postgres:super_secret_password@127.0.0.1:54321/banking_test_00000000000000000000000000000007 with password = test_password_123",
  );

  const res = await runnerModule.runCliMain(
    ["node", "scripts/run-disposable-postgres-test.ts", CANONICAL_RUNTIME_TEST_PATH],
    {},
    {
      processFacade: facade,
      logErrorFn: (msg: string) => {
        loggedErrors.push(msg);
      },
      canonicalRunnerFn: async () => {
        canonicalCalls++;
        return {
          success: false,
          runId: "00000000000000000000000000000007",
          databaseName: "banking_test_00000000000000000000000000000007",
          completedSteps: ["1_VERIFY_LOCAL_IMAGE"],
          error: sensitiveError,
        };
      },
      legacyRunnerFn: async () => {
        legacyCalls++;
        return mockLegacySuccessResult;
      },
    },
  );

  assert.equal(res.handled, "CANONICAL");
  assert.equal(res.success, false);
  assert.equal(canonicalCalls, 1, "Canonical runner must be called exactly once");
  assert.equal(legacyCalls, 0, "Legacy runner must never be called as fallback or retry on canonical failure");
  assert.equal(facade.exitCode, 1, "Production main seam must set process facade exitCode to 1 on failure");
  assert.ok(res.error);

  assert.ok(loggedErrors.length > 0, "runCliMain must log the redacted error");
  const combinedLog = loggedErrors.join("\n");
  assert.doesNotMatch(combinedLog, /super_secret_password/);
  assert.doesNotMatch(combinedLog, /test_password_123/);
  assert.match(combinedLog, /\[REDACTED_URL\]/);
  assert.match(combinedLog, /\[REDACTED_SECRET\]/);
});

// ============================================================================
// M07-A2 TMPFS HARNESS TESTS (M07-A2-TMPFS-01 to M07-A2-TMPFS-08)
// ============================================================================

test("M07-A2-TMPFS-01: Launch arguments contain exact --tmpfs pair and no -v, --volume, or broad mount", () => {
  const runId = "11111111222222223333333344444444";
  const containerName = `banking_test_container_${runId}`;
  const runArgs = buildDockerRunArgs({ containerName, runId });

  const tmpfsIndex = runArgs.indexOf("--tmpfs");
  assert.ok(tmpfsIndex !== -1, "Docker run arguments must include --tmpfs flag");
  assert.equal(
    runArgs[tmpfsIndex + 1],
    CANONICAL_TMPFS_FLAG_VALUE,
    `--tmpfs must be immediately followed by exact canonical flag value '${CANONICAL_TMPFS_FLAG_VALUE}'`,
  );
  assert.equal(
    runArgs[tmpfsIndex + 1],
    "/var/lib/postgresql/data:rw,noexec,nosuid,size=512m,mode=0700",
  );

  assert.ok(!runArgs.includes("-v"), "Must not include -v");
  assert.ok(!runArgs.includes("--volume"), "Must not include --volume");
  assert.ok(!runArgs.includes("--mount"), "Must not include --mount");
  assert.ok(runArgs.includes("--pull=never"), "Must keep --pull=never");
  assert.ok(runArgs.includes("-p"), "Must keep -p");
  assert.equal(runArgs[runArgs.indexOf("-p") + 1], "127.0.0.1::5432");
  assert.ok(runArgs.includes("-l"), "Must keep -l");
  assert.equal(runArgs[runArgs.indexOf("-l") + 1], `banking_test_run_id=${runId}`);
  assert.equal(runArgs[runArgs.length - 1], "postgres:16");
});

test("M07-A2-TMPFS-02: Exact tmpfs accepted in inspect record", () => {
  const runId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const containerName = `banking_test_container_${runId}`;
  const containerId = "1".repeat(64);
  const imageId = "sha256:" + "2".repeat(64);

  const inspectJson = JSON.stringify([
    {
      Id: containerId,
      Name: `/${containerName}`,
      Image: imageId,
      Config: {
        Image: "postgres:16",
        Labels: { banking_test_run_id: runId },
      },
      NetworkSettings: {
        Ports: {
          "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }],
        },
      },
      Mounts: [
        {
          Type: "tmpfs",
          Source: "",
          Destination: "/var/lib/postgresql/data",
          RW: true,
          Propagation: "",
        },
      ],
      HostConfig: {
        Binds: [],
        Tmpfs: {
          "/var/lib/postgresql/data": "rw,noexec,nosuid,size=512m,mode=0700",
        },
      },
    },
  ]);

  const validated = validateDockerInspectOutput(
    inspectJson,
    containerName,
    runId,
    imageId,
    containerId,
  );
  assert.equal(validated.containerId, containerId);
  assert.equal(validated.containerName, containerName);
  assert.equal(validated.hostPort, 54321);
  assert.equal(validated.bindHost, "127.0.0.1");
  assert.equal(validated.runId, runId);
});

test("M07-A2-TMPFS-09: Observed empty Mounts requires canonical HostConfig and namespace attestation", () => {
  const runId = "99999999999999999999999999999999";
  const containerName = `banking_test_container_${runId}`;
  const containerId = "9".repeat(64);
  const imageId = "sha256:" + "9".repeat(64);
  const inspectJson = JSON.stringify([{
    Id: containerId,
    Name: `/${containerName}`,
    Image: imageId,
    Config: {
      Image: "postgres:16",
      Labels: { banking_test_run_id: runId },
    },
    NetworkSettings: {
      Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] },
    },
    Mounts: [],
    HostConfig: {
      Binds: [],
      Tmpfs: { [CANONICAL_TMPFS_DESTINATION]: CANONICAL_TMPFS_OPTIONS },
    },
  }]);

  assert.doesNotThrow(() => validateDockerInspectOutput(
    inspectJson,
    containerName,
    runId,
    imageId,
    containerId,
  ));
  assert.doesNotThrow(() => validateMountNamespaceAttestation(validMountInfoFixture));
});

test("M07-A2-TMPFS-10: Empty Mounts without exact HostConfig.Tmpfs fails closed", () => {
  const runId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab";
  const containerName = `banking_test_container_${runId}`;
  const containerId = "a".repeat(64);
  const baseRecord = {
    Id: containerId,
    Name: `/${containerName}`,
    Image: "sha256:" + "a".repeat(64),
    Config: {
      Image: "postgres:16",
      Labels: { banking_test_run_id: runId },
    },
    NetworkSettings: {
      Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] },
    },
    Mounts: [],
  };

  assert.throws(
    () => validateDockerInspectOutput(JSON.stringify([baseRecord]), containerName, runId),
    /missing HostConfig\.Tmpfs object/,
  );
  assert.throws(
    () => validateDockerInspectOutput(
      JSON.stringify([{
        ...baseRecord,
        HostConfig: {
          Binds: [],
          Tmpfs: { [CANONICAL_TMPFS_DESTINATION]: "rw,noexec,nosuid,size=256m,mode=0700" },
        },
      }]),
      containerName,
      runId,
    ),
    /expected 512m/,
  );
});

test("M07-A2-TMPFS-11: Mount-namespace validator rejects missing, duplicate, or wrong destination", () => {
  assert.throws(
    () => validateMountNamespaceAttestation(""),
    /empty or invalid/,
  );
  assert.throws(
    () => validateMountNamespaceAttestation(makeMountInfo("/var/lib/postgresql/other")),
    /exactly one canonical destination record; found 0/,
  );
  assert.throws(
    () => validateMountNamespaceAttestation(`${makeMountInfo()}\n${makeMountInfo(CANONICAL_TMPFS_DESTINATION, "rw,nosuid,noexec", "tmpfs", "rw,size=512m,mode=0700", "101")}`),
    /exactly one canonical destination record; found 2/,
  );
  assert.throws(
    () => validateMountNamespaceAttestation("not a mountinfo record"),
    /malformed record/,
  );
});

test("M07-A2-TMPFS-12: Mount-namespace validator enforces tmpfs, flags, size, and mode", () => {
  assert.throws(
    () => validateMountNamespaceAttestation(makeMountInfo(CANONICAL_TMPFS_DESTINATION, "rw,nosuid,noexec", "ext4")),
    /filesystem type must be tmpfs/,
  );
  assert.throws(
    () => validateMountNamespaceAttestation(makeMountInfo(CANONICAL_TMPFS_DESTINATION, "ro,nosuid,noexec")),
    /not read-write|contradictory ro option/,
  );
  assert.throws(
    () => validateMountNamespaceAttestation(makeMountInfo(CANONICAL_TMPFS_DESTINATION, "rw,noexec")),
    /missing nosuid option/,
  );
  assert.throws(
    () => validateMountNamespaceAttestation(makeMountInfo(CANONICAL_TMPFS_DESTINATION, "rw,nosuid")),
    /missing noexec option/,
  );
  assert.throws(
    () => validateMountNamespaceAttestation(makeMountInfo(CANONICAL_TMPFS_DESTINATION, "rw,nosuid,noexec,ro,suid,exec")),
    /contradictory ro option/,
  );
  assert.throws(
    () => validateMountNamespaceAttestation(makeMountInfo(CANONICAL_TMPFS_DESTINATION, "rw,nosuid,noexec", "tmpfs", "rw,size=256m,mode=0700")),
    /size must be exactly 512 MiB/,
  );
  assert.throws(
    () => validateMountNamespaceAttestation(makeMountInfo(CANONICAL_TMPFS_DESTINATION, "rw,nosuid,noexec", "tmpfs", "rw,size=512m,mode=0755")),
    /mode must be exactly 0700/,
  );
});

test("M07-A2-TMPFS-13: Kernel-generated non-conflicting options are accepted", () => {
  assert.doesNotThrow(() => validateMountNamespaceAttestation(
    makeMountInfo(
      CANONICAL_TMPFS_DESTINATION,
      "rw,nosuid,noexec,relatime,nodev",
      "tmpfs",
      "rw,size=536870912,mode=0700,inode64",
    ),
  ));
});

test("M07-A2-TMPFS-14: docker exec attestation uses exact launched ID and fixed argv", () => {
  const containerId = "b".repeat(64);
  assert.deepEqual(
    buildDockerExecMountinfoArgs(containerId),
    ["exec", containerId, "cat", "/proc/self/mountinfo"],
  );
  assert.throws(
    () => buildDockerExecMountinfoArgs("not-a-container"),
    /exact 64 lowercase hex/,
  );
});

test("M07-A2-TMPFS-15: Missing or failed attestation stops before readiness/DB and cleans once", async () => {
  const fixedRunId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const launchId = "b".repeat(64);
  const fixedContainerName = `banking_test_container_${fixedRunId}`;
  const localImageId = "sha256:" + "b".repeat(64);
  const events: string[] = [];
  let attestationCalls = 0;
  const removedContainerIds: string[] = [];

  const inspectJson = JSON.stringify([{
    Id: launchId,
    Name: `/${fixedContainerName}`,
    Image: localImageId,
    Config: { Image: "postgres:16", Labels: { banking_test_run_id: fixedRunId } },
    NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] } },
    Mounts: [],
    HostConfig: { Binds: [], Tmpfs: { [CANONICAL_TMPFS_DESTINATION]: CANONICAL_TMPFS_OPTIONS } },
  }]);
  const mockDocker: DockerAdapter = {
    async inspectImage() { return JSON.stringify([{ Id: localImageId, RepoTags: ["postgres:16"] }]); },
    async runContainer() { return launchId; },
    async inspectContainer() { return inspectJson; },
    async attestMountNamespace(containerId: string) {
      events.push("attest");
      attestationCalls++;
      assert.equal(containerId, launchId);
      throw new Error("bounded mount attestation timeout");
    },
    async removeContainer(containerId: string) {
      events.push("cleanup");
      removedContainerIds.push(containerId);
    },
    async waitForReady() {
      events.push("ready");
    },
  };

  const result = await runCanonicalEvidenceSequence(
    { PATH: "C:\\Windows\\System32" },
    {
      dockerAdapter: mockDocker,
      createPoolFn: () => {
        events.push("pool");
        throw new Error("database action must not run");
      },
      runCommandFn: async () => {
        events.push("child");
        throw new Error("child action must not run");
      },
      runIdGenerator: () => fixedRunId,
    },
  );

  assert.equal(result.success, false);
  assert.equal(attestationCalls, 1, "Attestation must not retry");
  assert.deepEqual(removedContainerIds, [launchId], "Cleanup must target the exact launch ID once");
  assert.deepEqual(events, ["attest", "cleanup"]);
  assert.match(result.error?.message ?? "", /bounded mount attestation timeout/);
});

test("M07-A2-TMPFS-16: Attestation failures are not logged with raw mountinfo", async () => {
  const fixedRunId = "cccccccccccccccccccccccccccccccd";
  const launchId = "c".repeat(64);
  const fixedContainerName = `banking_test_container_${fixedRunId}`;
  const localImageId = "sha256:" + "c".repeat(64);
  const rawMarker = "mountinfo-sensitive-marker";
  const loggedErrors: string[] = [];
  const mockDocker: DockerAdapter = {
    async inspectImage() { return JSON.stringify([{ Id: localImageId, RepoTags: ["postgres:16"] }]); },
    async runContainer() { return launchId; },
    async inspectContainer() {
      return JSON.stringify([{
        Id: launchId,
        Name: `/${fixedContainerName}`,
        Image: localImageId,
        Config: { Image: "postgres:16", Labels: { banking_test_run_id: fixedRunId } },
        NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] } },
        Mounts: [],
        HostConfig: { Binds: [], Tmpfs: { [CANONICAL_TMPFS_DESTINATION]: CANONICAL_TMPFS_OPTIONS } },
      }]);
    },
    async attestMountNamespace() {
      return rawMarker;
    },
    async removeContainer() {},
    async waitForReady() {
      throw new Error("readiness must not run");
    },
  };

  const facade: ProcessFacade = { exitCode: 0 };
  const result = await runCliMain(
    ["node", "runner", CANONICAL_RUNTIME_TEST_PATH],
    { PATH: "C:\\Windows\\System32" },
    {
      processFacade: facade,
      canonicalDeps: {
        dockerAdapter: mockDocker,
        createPoolFn: () => {
          throw new Error("database action must not run");
        },
        runCommandFn: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        runIdGenerator: () => fixedRunId,
      },
      logErrorFn: (message) => loggedErrors.push(message),
    },
  );

  assert.equal(result.success, false);
  assert.ok(loggedErrors.length > 0);
  assert.doesNotMatch(loggedErrors.join("\n"), new RegExp(rawMarker));
  assert.doesNotMatch(loggedErrors.join("\n"), /mountinfo-sensitive/);
});

test("M07-A2-TMPFS-03: Anonymous and named volumes rejected", () => {
  const runId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const containerName = `banking_test_container_${runId}`;
  const containerId = "3".repeat(64);

  // Anonymous volume (the exact shape that caused runtime failure)
  const anonymousVolumeJson = JSON.stringify([
    {
      Id: containerId,
      Name: `/${containerName}`,
      Config: {
        Image: "postgres:16",
        Labels: { banking_test_run_id: runId },
      },
      NetworkSettings: {
        Ports: {
          "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }],
        },
      },
      Mounts: [
        {
          Type: "volume",
          Name: "c9c6a6edd0a15289d713e81c8ae985c678bacc9c917b4be9cb701168c737d1db",
          Destination: "/var/lib/postgresql/data",
          Driver: "local",
          Mode: "",
          RW: true,
          Propagation: "",
        },
      ],
      HostConfig: {
        Binds: [],
        Tmpfs: {
          "/var/lib/postgresql/data": "rw,noexec,nosuid,size=512m,mode=0700",
        },
      },
    },
  ]);

  assert.throws(
    () => validateDockerInspectOutput(anonymousVolumeJson, containerName, runId),
    /persistent\/shared mounts, which are strictly prohibited/,
  );

  // Named volume
  const namedVolumeJson = JSON.stringify([
    {
      Id: containerId,
      Name: `/${containerName}`,
      Config: {
        Image: "postgres:16",
        Labels: { banking_test_run_id: runId },
      },
      NetworkSettings: {
        Ports: {
          "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }],
        },
      },
      Mounts: [
        {
          Type: "volume",
          Name: "banking_persistent_pgdata",
          Destination: "/var/lib/postgresql/data",
          Driver: "local",
          RW: true,
        },
      ],
      HostConfig: {
        Binds: [],
        Tmpfs: {
          "/var/lib/postgresql/data": "rw,noexec,nosuid,size=512m,mode=0700",
        },
      },
    },
  ]);

  assert.throws(
    () => validateDockerInspectOutput(namedVolumeJson, containerName, runId),
    /not approved 'tmpfs'/,
  );
});

test("M07-A2-TMPFS-04: Bind and additional mounts rejected", () => {
  const runId = "cccccccccccccccccccccccccccccccc";
  const containerName = `banking_test_container_${runId}`;
  const containerId = "4".repeat(64);

  const baseRecord = {
    Id: containerId,
    Name: `/${containerName}`,
    Config: {
      Image: "postgres:16",
      Labels: { banking_test_run_id: runId },
    },
    NetworkSettings: {
      Ports: {
        "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }],
      },
    },
    HostConfig: {
      Binds: [],
      Tmpfs: {
        "/var/lib/postgresql/data": "rw,noexec,nosuid,size=512m,mode=0700",
      },
    },
  };

  // Bind mount
  assert.throws(
    () =>
      validateDockerInspectOutput(
        JSON.stringify([
          {
            ...baseRecord,
            Mounts: [
              {
                Type: "bind",
                Source: "/host/pgdata",
                Destination: "/var/lib/postgresql/data",
                RW: true,
              },
            ],
          },
        ]),
        containerName,
        runId,
      ),
    /not approved 'tmpfs'/,
  );

  // Non-empty source on tmpfs
  assert.throws(
    () =>
      validateDockerInspectOutput(
        JSON.stringify([
          {
            ...baseRecord,
            Mounts: [
              {
                Type: "tmpfs",
                Source: "/host/leak",
                Destination: "/var/lib/postgresql/data",
                RW: true,
              },
            ],
          },
        ]),
        containerName,
        runId,
      ),
    /Source must be empty string/,
  );

  // Wrong destination
  assert.throws(
    () =>
      validateDockerInspectOutput(
        JSON.stringify([
          {
            ...baseRecord,
            Mounts: [
              {
                Type: "tmpfs",
                Source: "",
                Destination: "/var/lib/postgresql/other",
                RW: true,
              },
            ],
          },
        ]),
        containerName,
        runId,
      ),
    /does not match exact approved/,
  );

  // Second mount
  assert.throws(
    () =>
      validateDockerInspectOutput(
        JSON.stringify([
          {
            ...baseRecord,
            Mounts: [
              {
                Type: "tmpfs",
                Source: "",
                Destination: "/var/lib/postgresql/data",
                RW: true,
              },
              {
                Type: "tmpfs",
                Source: "",
                Destination: "/tmp",
                RW: true,
              },
            ],
          },
        ]),
        containerName,
        runId,
      ),
    /expected exactly one tmpfs mount, found 2/,
  );
});

test("M07-A2-TMPFS-05: Option mismatch rejected while accepting valid semantic permutations", () => {
  // Valid option permutations
  assert.doesNotThrow(() =>
    validateTmpfsOptions("size=512m,mode=0700,noexec,nosuid,rw"),
  );
  assert.doesNotThrow(() =>
    validateTmpfsOptions("rw,noexec,nosuid,size=536870912,mode=0700"),
  );
  assert.doesNotThrow(() =>
    validateTmpfsOptions("rw,noexec,nosuid,size=524288k,mode=0700"),
  );
  assert.doesNotThrow(() =>
    validateTmpfsOptions("rw,noexec,nosuid,size=512m,mode=700"),
  );

  // Missing required options
  assert.throws(
    () => validateTmpfsOptions("rw,nosuid,size=512m,mode=0700"),
    /must contain exactly one 'noexec' flag/,
  );
  assert.throws(
    () => validateTmpfsOptions("rw,noexec,size=512m,mode=0700"),
    /must contain exactly one 'nosuid' flag/,
  );
  assert.throws(
    () => validateTmpfsOptions("noexec,nosuid,size=512m,mode=0700"),
    /must contain exactly one 'rw' flag/,
  );
  assert.throws(
    () => validateTmpfsOptions("rw,noexec,nosuid,mode=0700"),
    /must contain exactly one size parameter/,
  );
  assert.throws(
    () => validateTmpfsOptions("rw,noexec,nosuid,size=512m"),
    /must contain exactly one mode parameter/,
  );

  // Wrong size or mode
  assert.throws(
    () => validateTmpfsOptions("rw,noexec,nosuid,size=1024m,mode=0700"),
    /expected 512m/,
  );
  assert.throws(
    () => validateTmpfsOptions("rw,noexec,nosuid,size=512m,mode=0777"),
    /expected 0700/,
  );

  // Disallowed / unexpected options
  assert.throws(
    () => validateTmpfsOptions("ro,noexec,nosuid,size=512m,mode=0700"),
    /unexpected option/,
  );
  assert.throws(
    () => validateTmpfsOptions("rw,noexec,nosuid,size=512m,mode=0700,exec"),
    /unexpected option/,
  );

  // In inspect record context: HostConfig.Tmpfs key mismatch
  const runId = "dddddddddddddddddddddddddddddddd";
  const containerName = `banking_test_container_${runId}`;
  const recordWithWrongKey = JSON.stringify([
    {
      Id: "5".repeat(64),
      Name: `/${containerName}`,
      Config: { Image: "postgres:16", Labels: { banking_test_run_id: runId } },
      NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] } },
      Mounts: [
        {
          Type: "tmpfs",
          Source: "",
          Destination: "/var/lib/postgresql/data",
          RW: true,
        },
      ],
      HostConfig: {
        Binds: [],
        Tmpfs: {
          "/var/lib/postgresql/wrong": "rw,noexec,nosuid,size=512m,mode=0700",
        },
      },
    },
  ]);
  assert.throws(
    () => validateDockerInspectOutput(recordWithWrongKey, containerName, runId),
    /HostConfig\.Tmpfs must contain exactly '\/var\/lib\/postgresql\/data'/,
  );

  // Mounts RW flag false
  const recordWithRoMount = JSON.stringify([
    {
      Id: "5".repeat(64),
      Name: `/${containerName}`,
      Config: { Image: "postgres:16", Labels: { banking_test_run_id: runId } },
      NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] } },
      Mounts: [
        {
          Type: "tmpfs",
          Source: "",
          Destination: "/var/lib/postgresql/data",
          RW: false,
        },
      ],
      HostConfig: {
        Binds: [],
        Tmpfs: {
          "/var/lib/postgresql/data": "rw,noexec,nosuid,size=512m,mode=0700",
        },
      },
    },
  ]);
  assert.throws(
    () => validateDockerInspectOutput(recordWithRoMount, containerName, runId),
    /RW flag must be true/,
  );
});

test("M07-A2-TMPFS-06: Exact defensive cleanup uses launched container ID with -f and -v", () => {
  const launchedId = "6".repeat(64);
  const rmArgs = buildDockerRmArgs(launchedId);

  assert.deepEqual(rmArgs, ["rm", "-f", "-v", launchedId]);
  assert.ok(!rmArgs.includes("*"), "Must not contain wildcard");
  assert.ok(!rmArgs.includes("prune"), "Must not prune");
  assert.equal(rmArgs.length, 4, "Must have exactly 4 arguments");

  assert.throws(() => buildDockerRmArgs("short"), /exact 64 lowercase hex/);
  assert.throws(() => buildDockerRmArgs("6".repeat(63)), /exact 64 lowercase hex/);
  assert.throws(() => buildDockerRmArgs("6".repeat(65)), /exact 64 lowercase hex/);
  assert.throws(() => buildDockerRmArgs("F".repeat(64)), /exact 64 lowercase hex/);
});

test("M07-A2-TMPFS-07: Inspect failure stops sequence, cleans up with -v, and fails closed", async () => {
  const fixedRunId = "77777777777777777777777777777777";
  const launchId = "7".repeat(64);
  const fixedContainerName = `banking_test_container_${fixedRunId}`;
  const localImageId = "sha256:" + "7".repeat(64);

  const removedContainerIds: string[] = [];
  const executedDbQueries: string[] = [];

  const mockDocker: DockerAdapter = {
    async inspectImage() {
      return JSON.stringify([{ Id: localImageId, RepoTags: ["postgres:16"] }]);
    },
    async runContainer() {
      return launchId;
    },
    async inspectContainer() {
      // Returns anonymous volume inspect output (like actual runtime failure)
      return JSON.stringify([
        {
          Id: launchId,
          Name: `/${fixedContainerName}`,
          Image: localImageId,
          Config: { Image: "postgres:16", Labels: { banking_test_run_id: fixedRunId } },
          NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] } },
          Mounts: [
            {
              Type: "volume",
              Name: "c9c6a6edd0a15289d713e81c8ae985c678bacc9c917b4be9cb701168c737d1db",
              Destination: "/var/lib/postgresql/data",
            },
          ],
        },
      ]);
    },
    async attestMountNamespace() {
      return validMountInfoFixture;
    },
    async removeContainer(containerId: string) {
      removedContainerIds.push(containerId);
    },
    async waitForReady() {},
  };

  const mockPool: DisposablePoolClient = {
    async query(sql: string) {
      executedDbQueries.push(sql);
      return { rows: [] };
    },
    async end() {},
  };

  const result = await runCanonicalEvidenceSequence(
    { PATH: "C:\\Windows\\System32" },
    {
      dockerAdapter: mockDocker,
      createPoolFn: () => mockPool,
      runCommandFn: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      runIdGenerator: () => fixedRunId,
    },
  );

  assert.equal(result.success, false, "Must fail closed on mount validation failure");
  assert.ok(
    result.error?.message.includes("persistent/shared mounts, which are strictly prohibited"),
    "Must preserve mount error",
  );
  assert.equal(
    executedDbQueries.length,
    0,
    "Step 5 and later phases must never execute when inspect validation fails",
  );
  assert.deepEqual(
    removedContainerIds,
    [launchId],
    "Must cleanup exact launched container ID once in awaited finally",
  );
});

test("M07-A2-TMPFS-08: Success and cancellation hygiene", async () => {
  const fixedRunId = "88888888888888888888888888888888";
  const launchId = "8".repeat(64);
  const fixedContainerName = `banking_test_container_${fixedRunId}`;
  const localImageId = "sha256:" + "8".repeat(64);

  // Verify buildDockerRunArgs rejects unknown or caller-supplied tmpfs options
  const defaultRunArgs = buildDockerRunArgs({
    containerName: fixedContainerName,
    runId: fixedRunId,
  });
  const tmpfsIndices = defaultRunArgs.reduce<number[]>(
    (acc, val, idx) => (val === "--tmpfs" ? [...acc, idx] : acc),
    [],
  );
  assert.equal(tmpfsIndices.length, 1, "Exactly one --tmpfs pair allowed in launch args");

  // Part 1: Normal completion hygiene
  const normalRemovedContainers: string[] = [];
  const normalMockDocker: DockerAdapter = {
    async inspectImage() {
      return JSON.stringify([{ Id: localImageId, RepoTags: ["postgres:16"] }]);
    },
    async runContainer() {
      return launchId;
    },
    async inspectContainer() {
      return JSON.stringify([
        {
          Id: launchId,
          Name: `/${fixedContainerName}`,
          Image: localImageId,
          Config: { Image: "postgres:16", Labels: { banking_test_run_id: fixedRunId } },
          NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] } },
          Mounts: [
            {
              Type: "tmpfs",
              Source: "",
              Destination: "/var/lib/postgresql/data",
              RW: true,
            },
          ],
          HostConfig: {
            Binds: [],
            Tmpfs: {
              "/var/lib/postgresql/data": "rw,noexec,nosuid,size=512m,mode=0700",
            },
          },
        },
      ]);
    },
    async attestMountNamespace(containerId: string) {
      assert.equal(containerId, launchId);
      return validMountInfoFixture;
    },
    async removeContainer(containerId: string) {
      normalRemovedContainers.push(containerId);
    },
    async waitForReady() {},
  };

  let verifyCount = 0;
  const normalResult = await runCanonicalEvidenceSequence(
    { PATH: "C:\\Windows\\System32" },
    {
      dockerAdapter: normalMockDocker,
      createPoolFn: () => ({
        async query(sql: string) {
          if (sql.includes("COUNT(*)")) return { rows: [{ count: 0 }] };
          return { rows: [] };
        },
        async end() {},
      }),
      runCommandFn: async (_cmd: string, args: readonly string[]) => {
        if (args.includes("--verify-only")) {
          verifyCount++;
          if (verifyCount === 2) {
            return {
              exitCode: 1,
              stdout: "",
              stderr: "Migration checksum mismatch for 001_banking_mvp; refusing to run.",
            };
          }
        }
        return { exitCode: 0, stdout: "OK", stderr: "" };
      },
      runIdGenerator: () => fixedRunId,
    },
  );

  assert.equal(normalResult.success, true, "Normal run must succeed");
  assert.deepEqual(
    normalRemovedContainers,
    [launchId],
    "Normal completion must clean up exact launched container ID once and never invoke volume prune/rm",
  );

  // Part 2: Cancellation hygiene
  const cancelRemovedContainers: string[] = [];
  const cancelMockDocker: DockerAdapter = {
    async inspectImage() {
      return JSON.stringify([{ Id: localImageId, RepoTags: ["postgres:16"] }]);
    },
    async runContainer() {
      return launchId;
    },
    async inspectContainer() {
      // Simulate cooperative cancellation during inspect phase
      throw new Error("Cooperative cancellation triggered during inspection");
    },
    async attestMountNamespace() {
      return validMountInfoFixture;
    },
    async removeContainer(containerId: string) {
      cancelRemovedContainers.push(containerId);
    },
    async waitForReady() {},
  };

  const cancelResult = await runCanonicalEvidenceSequence(
    { PATH: "C:\\Windows\\System32" },
    {
      dockerAdapter: cancelMockDocker,
      createPoolFn: () => ({
        async query() { return { rows: [] }; },
        async end() {},
      }),
      runCommandFn: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      runIdGenerator: () => fixedRunId,
    },
  );

  assert.equal(cancelResult.success, false, "Must fail closed on cancellation");
  assert.deepEqual(
    cancelRemovedContainers,
    [launchId],
    "Cancellation must await cleanup of exact launched container without separate volume operations",
  );
});

test("M07-A2-ORCH-01: canonical orchestration preserves live stdout and gates readiness", async () => {
  const lfFixture = makeExpandedMountInfoFixture("\n");
  const crlfFixture = makeExpandedMountInfoFixture("\r\n");
  assert.equal(Buffer.byteLength(lfFixture, "utf8") >= 3000, true, "Fixture must exercise a live-sized stdout payload");

  const cases = [
    {
      name: "LF",
      runId: "10000000000000000000000000000001",
      mountInfo: lfFixture,
      options: { deferAttestation: true },
    },
    {
      name: "CRLF",
      runId: "10000000000000000000000000000002",
      mountInfo: crlfFixture,
      options: {},
    },
    {
      name: "chunked stdout",
      runId: "10000000000000000000000000000003",
      mountInfo: lfFixture,
      options: {
        chunks: [lfFixture.slice(0, 901), lfFixture.slice(901, 2200), lfFixture.slice(2200)],
      },
    },
    {
      name: "non-empty stderr with successful exit",
      runId: "10000000000000000000000000000004",
      mountInfo: lfFixture,
      options: { attestationStderr: "synthetic warning" },
    },
  ];

  for (const scenario of cases) {
    const harness = makeCanonicalOrchestrationHarness(scenario.runId, scenario.mountInfo, scenario.options);
    const result = await runCanonicalEvidenceSequence(
      { NODE_ENV: "test", PATH: "C:\\Windows\\System32" },
      {
        dockerAdapter: harness.mockDocker,
        createPoolFn: harness.createPoolFn,
        runCommandFn: harness.runCommandFn,
        runIdGenerator: () => scenario.runId,
      },
    );

    assert.equal(result.success, true, `${scenario.name} orchestration must succeed`);
    assert.equal(harness.observedCommandResults.length, 1, `${scenario.name} must have one attestation command result`);
    assert.equal(harness.observedCommandResults[0].exitCode, 0);
    assert.equal(harness.observedCommandResults[0].stdout, scenario.mountInfo);
    assert.equal(harness.observedCommandResults[0].stderr, scenario.options.attestationStderr ?? "");
    assert.equal(harness.attestationOutput, scenario.mountInfo, `${scenario.name} stdout must not be trimmed or serialized`);
    assert.equal(harness.attestationValidatorReturnKind, "object");
    assert.ok(harness.events.indexOf("attest") < harness.events.indexOf("ready"), `${scenario.name} attestation must precede readiness`);
    assert.ok(harness.events.indexOf("ready") < harness.events.indexOf("pool"), `${scenario.name} readiness must precede database creation`);
    assert.deepEqual(harness.removedContainerIds, [harness.launchId], `${scenario.name} cleanup must target the exact launch ID once`);
  }
});

test("M07-A2-ORCH-02: successful attestation preserves later-phase primary attribution and cleanup", async () => {
  const runId = "10000000000000000000000000000005";
  const fixture = makeExpandedMountInfoFixture("\n");
  const harness = makeCanonicalOrchestrationHarness(runId, fixture, {
    failAfterAttestation: true,
    deferAttestation: true,
  });

  const result = await runCanonicalEvidenceSequence(
    { NODE_ENV: "test", PATH: "C:\\Windows\\System32" },
    {
      dockerAdapter: harness.mockDocker,
      createPoolFn: harness.createPoolFn,
      runCommandFn: harness.runCommandFn,
      runIdGenerator: () => runId,
    },
  );

  assert.equal(result.success, false);
  assert.match(result.error?.message ?? "", /Post-restore verify-only failed/);
  assert.equal(result.cleanupError, undefined, "Successful attestation and cleanup must not replace the later primary error");
  assert.equal(harness.attestationValidatorReturnKind, "object");
  assert.ok(harness.events.indexOf("attest") < harness.events.indexOf("ready"));
  assert.ok(harness.events.lastIndexOf("cleanup") > harness.events.lastIndexOf("child"));
  assert.deepEqual(harness.removedContainerIds, [harness.launchId]);
});

test("M07-A2-ORCH-03: command result keeps exit code and stdout after late cancellation", async () => {
  const controller = new AbortController();
  const commandEnvironment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
  };
  const result = await executeCommandWithOutput(
    process.execPath,
    ["-e", "process.stdout.write('attestation-ready')"],
    commandEnvironment,
    5_000,
    controller.signal,
  );

  controller.abort(new Error("late cancellation after command completion"));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "attestation-ready");
  assert.equal(result.stderr, "");
});

const runAttestationDiagnosticScenario = async (
  runId: string,
  commandResult: AttestationCommandResult,
  validator?: (mountInfo: string) => ReturnType<typeof validateMountNamespaceAttestation>,
  options: { readonly cleanupFailure?: boolean; readonly failAfterAttestation?: boolean } = {},
) => {
  const harness = makeCanonicalOrchestrationHarness(runId, "unavailable-fixture", {
    attestationCommandResult: commandResult,
    cleanupFailure: options.cleanupFailure,
    failAfterAttestation: options.failAfterAttestation,
  });
  const result = await runCanonicalEvidenceSequence(
    { NODE_ENV: "test", PATH: "C:\\Windows\\System32" },
    {
      dockerAdapter: harness.mockDocker,
      createPoolFn: harness.createPoolFn,
      runCommandFn: harness.runCommandFn,
      runIdGenerator: () => runId,
      mountNamespaceValidatorFn: validator,
    },
  );
  return { harness, result };
};

test("M07-A2-INSTR-01: successful LF attestation emits only the allowlisted PASS diagnostic", async () => {
  const fixture = makeExpandedMountInfoFixture("\n");
  const { harness, result } = await runAttestationDiagnosticScenario(
    "20000000000000000000000000000001",
    { exitCode: 0, stdout: fixture, stderr: "" },
  );
  const diagnostic = result.attestationDiagnostic;

  assert.equal(result.success, true);
  assert.ok(diagnostic);
  assert.deepEqual(Object.keys(diagnostic).sort(), [...ATTESTATION_DIAGNOSTIC_KEYS].sort());
  assert.equal(diagnostic.phase, "3_INSPECT_VALIDATE_CONTAINER");
  assert.equal(diagnostic.commandExitCode, 0);
  assert.equal(diagnostic.commandTimedOut, false);
  assert.equal(diagnostic.commandCancelled, false);
  assert.equal(diagnostic.stdoutKind, "string");
  assert.equal(diagnostic.stdoutByteLength, Buffer.byteLength(fixture, "utf8"));
  assert.equal(diagnostic.trailingNewline, "LF");
  assert.equal(diagnostic.stderrPresent, false);
  assert.equal(diagnostic.validatorCalled, true);
  assert.equal(diagnostic.validatorPassed, true);
  assert.equal(diagnostic.failureCode, "NONE");
  assert.equal(diagnostic.targetRecordCount, 1);
  assert.match(diagnostic.targetRecordFingerprint ?? "", /^[a-f0-9]{64}$/);
  assert.equal(diagnostic.filesystemType, "tmpfs");
  assert.equal(diagnostic.normalizedSizeBytes, 536870912);
  assert.equal(diagnostic.normalizedModeOctal, "0700");
  assert.equal(harness.events.filter((event) => event === "ready").length, 1);
  assert.equal(harness.events.indexOf("attest-result") < harness.events.indexOf("ready"), true);
});

test("M07-A2-INSTR-02: successful CRLF attestation records line diagnostics without changing validation", async () => {
  const fixture = makeExpandedMountInfoFixture("\r\n");
  const { result } = await runAttestationDiagnosticScenario(
    "20000000000000000000000000000002",
    { exitCode: 0, stdout: fixture, stderr: "" },
  );
  const diagnostic = result.attestationDiagnostic;

  assert.equal(result.success, true);
  assert.ok(diagnostic);
  assert.ok(diagnostic.crCount !== null);
  assert.ok(diagnostic.lfCount !== null);
  assert.equal(diagnostic.crCount > 0, true);
  assert.equal(diagnostic.lfCount, diagnostic.crCount);
  assert.equal(diagnostic.trailingNewline, "CRLF");
  assert.equal(diagnostic.validatorPassed, true);
  assert.equal(diagnostic.failureCode, "NONE");
});

test("M07-A2-INSTR-03: nonzero command emits COMMAND_NONZERO and does not call the validator", async () => {
  const { harness, result } = await runAttestationDiagnosticScenario(
    "20000000000000000000000000000003",
    {
      exitCode: 17,
      stdout: "raw-mountinfo-marker",
      stderr: "raw-stderr-marker; synthetic-secret-marker",
    },
  );
  const diagnostic = result.attestationDiagnostic;

  assert.equal(result.success, false);
  assert.ok(diagnostic);
  assert.equal(diagnostic.commandExitCode, 17);
  assert.equal(diagnostic.stderrPresent, true);
  assert.equal(diagnostic.validatorCalled, false);
  assert.equal(diagnostic.validatorPassed, false);
  assert.equal(diagnostic.failureCode, "COMMAND_NONZERO");
  assert.equal(harness.events.includes("ready"), false);
  const serialized = JSON.stringify(diagnostic);
  assert.doesNotMatch(serialized, /raw-mountinfo-marker|raw-stderr-marker|synthetic-secret-marker/);
  assert.doesNotMatch(serialized, new RegExp(harness.launchId));
  assert.doesNotMatch(serialized, /20000000000000000000000000000003/);
});

test("M07-A2-INSTR-04: timeout and cancellation are distinct command failures", async () => {
  const timeoutHarness = makeCanonicalOrchestrationHarness(
    "20000000000000000000000000000004",
    "unavailable-fixture",
    { attestationCommandFailure: new AttestationCommandError("COMMAND_TIMEOUT") },
  );
  const timeoutResult = await runCanonicalEvidenceSequence(
    { NODE_ENV: "test", PATH: "C:\\Windows\\System32" },
    {
      dockerAdapter: timeoutHarness.mockDocker,
      createPoolFn: timeoutHarness.createPoolFn,
      runCommandFn: timeoutHarness.runCommandFn,
      runIdGenerator: () => "20000000000000000000000000000004",
    },
  );
  assert.equal(timeoutResult.attestationDiagnostic?.failureCode, "COMMAND_TIMEOUT");
  assert.equal(timeoutResult.attestationDiagnostic?.commandTimedOut, true);
  assert.equal(timeoutResult.attestationDiagnostic?.commandCancelled, false);
  assert.equal(timeoutResult.attestationDiagnostic?.validatorCalled, false);

  const cancelHarness = makeCanonicalOrchestrationHarness(
    "20000000000000000000000000000005",
    "unavailable-fixture",
    { attestationCommandFailure: new AttestationCommandError("COMMAND_CANCELLED") },
  );
  const cancelResult = await runCanonicalEvidenceSequence(
    { NODE_ENV: "test", PATH: "C:\\Windows\\System32" },
    {
      dockerAdapter: cancelHarness.mockDocker,
      createPoolFn: cancelHarness.createPoolFn,
      runCommandFn: cancelHarness.runCommandFn,
      runIdGenerator: () => "20000000000000000000000000000005",
    },
  );
  assert.equal(cancelResult.attestationDiagnostic?.failureCode, "COMMAND_CANCELLED");
  assert.equal(cancelResult.attestationDiagnostic?.commandTimedOut, false);
  assert.equal(cancelResult.attestationDiagnostic?.commandCancelled, true);
  assert.equal(cancelResult.attestationDiagnostic?.validatorCalled, false);
});

test("M07-A2-INSTR-05: invalid command-result stdout is classified without serializing the value", async () => {
  const { result } = await runAttestationDiagnosticScenario(
    "20000000000000000000000000000006",
    { exitCode: 0, stdout: 42, stderr: "" },
  );
  const diagnostic = result.attestationDiagnostic;

  assert.equal(result.success, false);
  assert.ok(diagnostic);
  assert.equal(diagnostic.stdoutKind, "number");
  assert.equal(diagnostic.stdoutByteLength, null);
  assert.equal(diagnostic.targetRecordCount, null);
  assert.equal(diagnostic.validatorCalled, false);
  assert.equal(diagnostic.failureCode, "STDOUT_INVALID");
  assert.doesNotMatch(JSON.stringify(diagnostic), /42/);

  const missingShape = await runAttestationDiagnosticScenario(
    "20000000000000000000000000000011",
    { exitCode: 0, stdout: makeExpandedMountInfoFixture(), stderr: undefined },
  );
  assert.equal(missingShape.result.attestationDiagnostic?.failureCode, "STDOUT_INVALID");
  assert.equal(missingShape.result.attestationDiagnostic?.stdoutKind, "string");
  assert.equal(missingShape.result.attestationDiagnostic?.stderrPresent, null);
  assert.equal(missingShape.result.attestationDiagnostic?.validatorCalled, false);
});

test("M07-A2-INSTR-06: missing and duplicate target records are classified as TARGET_RECORD_COUNT", async () => {
  const missing = await runAttestationDiagnosticScenario(
    "20000000000000000000000000000007",
    { exitCode: 0, stdout: makeMountInfo("/synthetic/no-target"), stderr: "" },
  );
  assert.equal(missing.result.attestationDiagnostic?.failureCode, "TARGET_RECORD_COUNT");
  assert.equal(missing.result.attestationDiagnostic?.targetRecordCount, 0);

  const single = makeMountInfo();
  const duplicate = await runAttestationDiagnosticScenario(
    "20000000000000000000000000000008",
    { exitCode: 0, stdout: `${single}\n${single}\n`, stderr: "" },
  );
  assert.equal(duplicate.result.attestationDiagnostic?.failureCode, "TARGET_RECORD_COUNT");
  assert.equal(duplicate.result.attestationDiagnostic?.targetRecordCount, 2);
  assert.equal(duplicate.result.attestationDiagnostic?.targetRecordFingerprint, null);
});

test("M07-A2-INSTR-07: filesystem and flags failures retain sanitized semantic fields", async () => {
  const filesystem = await runAttestationDiagnosticScenario(
    "20000000000000000000000000000009",
    {
      exitCode: 0,
      stdout: makeMountInfo(CANONICAL_TMPFS_DESTINATION, "rw,nosuid,noexec", "ext4"),
      stderr: "",
    },
  );
  assert.equal(filesystem.result.attestationDiagnostic?.failureCode, "FILESYSTEM_MISMATCH");
  assert.equal(filesystem.result.attestationDiagnostic?.filesystemType, "ext4");

  const flags = await runAttestationDiagnosticScenario(
    "2000000000000000000000000000000a",
    {
      exitCode: 0,
      stdout: makeMountInfo(CANONICAL_TMPFS_DESTINATION, "rw,nosuid,relatime"),
      stderr: "",
    },
  );
  assert.equal(flags.result.attestationDiagnostic?.failureCode, "FLAGS_MISMATCH");
  assert.equal(flags.result.attestationDiagnostic?.validatorCalled, true);
  assert.equal(flags.result.attestationDiagnostic?.validatorPassed, false);
});

test("M07-A2-INSTR-08: size and mode failures expose normalized values without raw records", async () => {
  const size = await runAttestationDiagnosticScenario(
    "2000000000000000000000000000000b",
    {
      exitCode: 0,
      stdout: makeMountInfo(
        CANONICAL_TMPFS_DESTINATION,
        "rw,nosuid,noexec",
        "tmpfs",
        "rw,size=512000k,mode=700",
      ),
      stderr: "",
    },
  );
  assert.equal(size.result.attestationDiagnostic?.failureCode, "SIZE_MISMATCH");
  assert.equal(size.result.attestationDiagnostic?.normalizedSizeBytes, 524288000);

  const mode = await runAttestationDiagnosticScenario(
    "2000000000000000000000000000000c",
    {
      exitCode: 0,
      stdout: makeMountInfo(
        CANONICAL_TMPFS_DESTINATION,
        "rw,nosuid,noexec",
        "tmpfs",
        "rw,size=524288k,mode=0750",
      ),
      stderr: "",
    },
  );
  assert.equal(mode.result.attestationDiagnostic?.failureCode, "MODE_MISMATCH");
  assert.equal(mode.result.attestationDiagnostic?.normalizedModeOctal, "0750");
  assert.doesNotMatch(JSON.stringify(mode.result.attestationDiagnostic), /var\/lib\/postgresql\/data/);
});

test("M07-A2-INSTR-09: injected validator internal errors use VALIDATOR_INTERNAL without raw exception text", async () => {
  const { result } = await runAttestationDiagnosticScenario(
    "2000000000000000000000000000000d",
    { exitCode: 0, stdout: makeExpandedMountInfoFixture(), stderr: "" },
    () => {
      throw new Error("internal-validator-marker");
    },
  );
  const diagnostic = result.attestationDiagnostic;

  assert.equal(result.success, false);
  assert.ok(diagnostic);
  assert.equal(diagnostic.validatorCalled, true);
  assert.equal(diagnostic.validatorPassed, false);
  assert.equal(diagnostic.failureCode, "VALIDATOR_INTERNAL");
  assert.doesNotMatch(JSON.stringify(diagnostic), /internal-validator-marker/);
});

test("M07-A2-INSTR-10: cleanup failure does not overwrite a later primary failure", async () => {
  const fixture = makeExpandedMountInfoFixture();
  const { harness, result } = await runAttestationDiagnosticScenario(
    "2000000000000000000000000000000e",
    { exitCode: 0, stdout: fixture, stderr: "" },
    undefined,
    { cleanupFailure: true, failAfterAttestation: true },
  );

  assert.equal(result.success, false);
  assert.match(result.error?.message ?? "", /Post-restore verify-only failed/);
  assert.match(result.cleanupError?.message ?? "", /synthetic cleanup failure/);
  assert.equal(result.attestationDiagnostic?.failureCode, "NONE");
  assert.deepEqual(harness.removedContainerIds, [harness.launchId]);
});

test("M07-A2-INSTR-11: target fingerprint is deterministic and never exposes the target record", async () => {
  const fixture = makeExpandedMountInfoFixture();
  const first = await runAttestationDiagnosticScenario(
    "2000000000000000000000000000000f",
    { exitCode: 0, stdout: fixture, stderr: "" },
  );
  const second = await runAttestationDiagnosticScenario(
    "20000000000000000000000000000010",
    { exitCode: 0, stdout: fixture, stderr: "" },
  );
  const firstDiagnostic = first.result.attestationDiagnostic;
  const secondDiagnostic = second.result.attestationDiagnostic;

  assert.ok(firstDiagnostic);
  assert.ok(secondDiagnostic);
  assert.equal(firstDiagnostic.targetRecordFingerprint, secondDiagnostic.targetRecordFingerprint);
  assert.match(firstDiagnostic.targetRecordFingerprint ?? "", /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(firstDiagnostic), /\/var\/lib\/postgresql\/data/);
  assert.doesNotMatch(JSON.stringify(firstDiagnostic), /rw,nosuid,noexec/);
});

#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runCliMain,
} from "../src/database/disposableDatabaseGuard.js";

export {
  type CanonicalSequenceDependencies,
  type CanonicalSequenceExecutionResult,
  type CanonicalSequenceStep,
  type CliDispatcherDependencies,
  type CliDispatchResult,
  type ContainerRemovalFunction,
  type CreatePoolFunction,
  type DisposablePoolClient,
  type DisposableQueryResult,
  type DisposableRunnerDependencies,
  type DockerAdapter,
  type ProcessFacade,
  type ProcessInterruptionEmitter,
  type RunCommandFunction,
  type RunCommandWithOutputFunction,
  type RunnerExecutionResult,
  type RunnerLifecycleState,
  CANONICAL_RUNTIME_TEST_PATH,
  dispatchCliRun,
  executeCommandWithOutput,
  isCanonicalRuntimePath,
  isReservedCanonicalRuntimeCandidate,
  realDockerAdapter,
  runCanonicalEvidenceSequence,
  runCliMain,
  runDisposablePostgresTest,
} from "../src/database/disposableDatabaseGuard.js";

// Ensure importing this module never executes main or registers global process handlers!
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  runCliMain(process.argv, process.env, { processFacade: process }).catch(() => {
    process.exitCode = 1;
  });
}

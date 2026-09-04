#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runDisposablePostgresTest,
  sanitizeLogOutput,
} from "../src/database/disposableDatabaseGuard.js";

export {
  type CanonicalSequenceDependencies,
  type CanonicalSequenceExecutionResult,
  type CanonicalSequenceStep,
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
  executeCommandWithOutput,
  realDockerAdapter,
  runCanonicalEvidenceSequence,
  runDisposablePostgresTest,
} from "../src/database/disposableDatabaseGuard.js";

// Ensure importing this module never executes main or registers global process handlers!
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const testFiles = process.argv.slice(2).filter((value) => value.trim().length > 0);
  runDisposablePostgresTest(testFiles, process.env, { processFacade: process }).then((result) => {
    if (!result.success) {
      if (result.error) console.error(sanitizeLogOutput(result.error.message));
      if (result.cleanupError) console.error(sanitizeLogOutput(result.cleanupError.message));
      process.exitCode = 1;
    }
  }).catch((err: unknown) => {
    console.error(err instanceof Error ? sanitizeLogOutput(err.message) : "[REDACTED_ERROR]");
    process.exitCode = 1;
  });
}

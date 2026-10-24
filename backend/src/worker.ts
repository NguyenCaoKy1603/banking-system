import { WorkerHealthServer } from "./workers/workerHealth.js";
import { WorkerRuntime, assertWorkerCutoverConfirmed, createProviderSetFromSecretProvider, workerConfigFromEnv } from "./workers/workerRuntime.js";
import { readRuntimeConfig } from "./runtimeConfig.js";
import { createRuntimeSecretProvider, referenceFor } from "./secrets/runtimeSecrets.js";

async function main(): Promise<void> {
  if (process.env.WORKER_ENABLED !== "1") {
    throw new Error("WORKER_ENABLED must be 1 to start the worker process.");
  }
  assertWorkerCutoverConfirmed();
  const runtimeConfig = readRuntimeConfig(process.env, {
    requireRegistrationFingerprintKey: false,
  });
  const secretProvider = createRuntimeSecretProvider(runtimeConfig);
  const databaseSecret = await secretProvider.getSecret(referenceFor("databaseUrl", runtimeConfig.bankingEnvironment));
  const config = workerConfigFromEnv(databaseSecret.value);
  const providerSet = await createProviderSetFromSecretProvider(
    secretProvider,
    runtimeConfig.bankingEnvironment,
    runtimeConfig.isProductionLike,
  );
  const runtime = new WorkerRuntime(config, undefined, providerSet);
  await runtime.initialize();
  const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 9091);
  if (!Number.isInteger(healthPort) || healthPort < 0 || healthPort > 65535) {
    throw new Error("WORKER_HEALTH_PORT must be between 0 and 65535.");
  }
  const health = new WorkerHealthServer(runtime, healthPort);
  await health.start();
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void Promise.race([
      runtime.stop(),
      new Promise((resolve) => setTimeout(resolve, config.shutdownTimeoutMs)),
    ]).then(() => health.close()).then(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await runtime.start();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

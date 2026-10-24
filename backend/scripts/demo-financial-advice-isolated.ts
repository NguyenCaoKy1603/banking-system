import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BankingSystem } from "../src/bankingSystem.js";
import { InMemoryCoreBanking } from "../src/services/coreBanking.js";
import { createBankingServer } from "../src/http.js";
import {
  buildIsolatedDemoStartupMetadata,
  createIsolatedDemoAssistantRateLimiter,
  createIsolatedDemoHttpOptions,
  parseIsolatedDemoArguments,
  resolveIsolatedDemoConfig,
} from "../src/financialAdvice/isolatedDemoConfig.js";

const currentFile = fileURLToPath(import.meta.url);
const LOCAL_DEMO_USER = {
  fullName: "Financial Advice Demo",
  email: "financial-advice-demo@local.invalid",
  phoneNumber: "0900000000",
  password: "FA-Demo-Only-2026#Local",
} as const;

async function start(): Promise<void> {
  const args = parseIsolatedDemoArguments(process.argv.slice(2));
  if (!args) {
    console.error("Usage: node --import=tsx scripts/demo-financial-advice-isolated.ts --offline|--live [--port=5010] [--web-origin=http://127.0.0.1:8082]");
    process.exitCode = 2;
    return;
  }

  const config = resolveIsolatedDemoConfig(args);
  const system = new BankingSystem({ core: new InMemoryCoreBanking() });
  await system.registerAsync(LOCAL_DEMO_USER);
  const runId = randomUUID();
  const assistantRateLimiter = createIsolatedDemoAssistantRateLimiter(config, (usage) => {
    process.stdout.write(`${JSON.stringify({
      event: "financial-advice-demo-provider-budget",
      runId,
      mode: config.mode,
      storage: config.storage,
      port: config.port,
      ...usage,
    })}\n`);
  });
  const server = createBankingServer(
    system,
    createIsolatedDemoHttpOptions(config, randomBytes(32), assistantRateLimiter),
  );

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(config.port, config.host, () => {
      server.removeListener("error", onError);
      resolve();
    });
  });

  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    server.close(() => {
      process.stdout.write(`${JSON.stringify({ event: "financial-advice-demo-stopped", runId })}\n`);
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);

  process.stdout.write(`${JSON.stringify(buildIsolatedDemoStartupMetadata(config, runId, assistantRateLimiter))}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFile)) {
  void start().catch(() => {
    console.error("Isolated demo refused to start or failed before becoming ready; raw configuration and error details were not emitted.");
    process.exitCode = 1;
  });
}

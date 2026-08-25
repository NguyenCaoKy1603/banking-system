import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { readRuntimeConfig } from "../runtimeConfig.js";
import { runtimeMetadata } from "../runtimeMetadata.js";
import { BankingSystem } from "../bankingSystem.js";
import { createBankingServer, createPersistentBankingServer } from "../http.js";

const productionEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: "production",
  BANKING_ENV: "staging",
  BANKING_MONEY_MODE: "virtual",
  BANKING_STORAGE: "postgres",
  DATABASE_URL: "postgresql://banking:secret@db.example.test/banking",
  BANKING_MFA_REQUIRED: "1",
  BANKING_MFA_METHODS: "TOTP",
  BANKING_OTP_PEPPER: "base64:pepper",
  BANKING_MFA_ENCRYPTION_KEY: "base64:key",
  BANKING_ALLOWED_ORIGINS: "https://app.staging.example.test",
  BUILD_COMMIT_SHA: "0123456789012345678901234567890123456789",
  RELEASE_ID: "release-test",
  IMAGE_DIGEST: `sha256:${"a".repeat(64)}`,
});

test("production-like runtime contract is strict and virtual-money only", () => {
  const config = readRuntimeConfig(productionEnv());
  assert.equal(config.bankingEnvironment, "staging");
  assert.equal(config.nodeEnv, "production");
  assert.equal(config.moneyMode, "virtual");
  assert.equal(config.isProductionLike, true);

  assert.throws(
    () => readRuntimeConfig({ ...productionEnv(), BANKING_MONEY_MODE: "real" }),
    /BANKING_MONEY_MODE must be virtual/,
  );
  assert.throws(
    () => readRuntimeConfig({ ...productionEnv(), BUILD_COMMIT_SHA: "local" }),
    /full 40-character Git commit SHA/,
  );
  assert.throws(
    () => readRuntimeConfig({ ...productionEnv(), BANKING_ALLOWED_ORIGINS: "*" }),
    /exact origins/,
  );
  assert.throws(
    () => readRuntimeConfig({ ...productionEnv(), BANKING_ENV: "production" }),
    /reserved/,
  );
});

test("startup and version probes expose non-secret release metadata", async (t) => {
  const server = createBankingServer(new BankingSystem(), {
    startupReady: false,
    runtimeMetadata: runtimeMetadata({
      releaseId: "release-probe-test",
      commitSha: "0123456789012345678901234567890123456789",
      imageDigest: `sha256:${"b".repeat(64)}`,
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address() as AddressInfo;

  const startup = await fetch(`http://127.0.0.1:${address.port}/startupz`);
  assert.equal(startup.status, 503);
  assert.equal((await startup.json()).status, "starting");

  const version = await fetch(`http://127.0.0.1:${address.port}/versionz`);
  const payload = await version.json() as Record<string, unknown>;
  assert.equal(version.status, 200);
  assert.equal(payload.releaseId, "release-probe-test");
  assert.equal(payload.moneyMode, "virtual");
  assert.equal(typeof payload.migrationSetDigest, "string");
  assert.equal("databaseUrl" in payload, false);
});

test("persistent server keeps startup and version probes outside the state transaction", async (t) => {
  let stateTransactionCalls = 0;
  const server = createPersistentBankingServer(
    {
      healthCheck: async () => undefined,
      withState: async () => {
        stateTransactionCalls += 1;
        throw new Error("probe must not open a state transaction");
      },
    },
    new BankingSystem(),
    { runtimeMetadata: runtimeMetadata({ releaseId: "persistent-probe-test" }) },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address() as AddressInfo;

  const startup = await fetch(`http://127.0.0.1:${address.port}/startupz`);
  const version = await fetch(`http://127.0.0.1:${address.port}/versionz`);
  assert.equal(startup.status, 200);
  assert.equal(version.status, 200);
  assert.equal((await version.json()).releaseId, "persistent-probe-test");
  assert.equal(stateTransactionCalls, 0);
});

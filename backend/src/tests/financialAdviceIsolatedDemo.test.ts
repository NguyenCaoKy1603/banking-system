import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ISOLATED_DEMO_PORT,
  DEFAULT_ISOLATED_WEB_ORIGIN,
  IsolatedDemoAssistantRateLimiter,
  buildIsolatedDemoStartupMetadata,
  createIsolatedDemoAssistantRateLimiter,
  createIsolatedDemoHttpOptions,
  parseIsolatedDemoArguments,
  resolveIsolatedDemoConfig,
} from "../financialAdvice/isolatedDemoConfig.js";

test("isolated demo accepts only a closed local mode/port/origin argument set", () => {
  assert.deepEqual(parseIsolatedDemoArguments(["--offline"]), {
    mode: "offline",
    port: DEFAULT_ISOLATED_DEMO_PORT,
    webOrigin: DEFAULT_ISOLATED_WEB_ORIGIN,
  });
  assert.deepEqual(parseIsolatedDemoArguments([
    "--live",
    "--port=5011",
    "--web-origin=http://localhost:8083",
  ]), {
    mode: "live",
    port: 5011,
    webOrigin: "http://localhost:8083",
  });
  for (const args of [
    [],
    ["--offline", "--offline"],
    ["--other"],
    ["--offline", "--port=500"],
    ["--offline", "--port=65536"],
    ["--offline", "--web-origin=https://127.0.0.1:8082"],
    ["--offline", "--web-origin=http://0.0.0.0:8082"],
    ["--offline", "--web-origin=http://127.0.0.1:8082/path"],
    ["--offline", "--unknown=value"],
  ]) assert.equal(parseIsolatedDemoArguments(args), null);
});

test("offline demo resolves to in-memory loopback with FA enabled and assistant disabled", () => {
  const config = resolveIsolatedDemoConfig({
    mode: "offline",
    port: DEFAULT_ISOLATED_DEMO_PORT,
    webOrigin: DEFAULT_ISOLATED_WEB_ORIGIN,
  }, {});
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.storage, "in-memory");
  assert.equal(config.environment, "development");
  assert.equal(config.financialAdviceEnabled, true);
  assert.equal(config.assistantConfig.enabled, false);
  assert.equal(config.assistantConfig.provider, undefined);
});

test("isolated HTTP options use only the configured Web origin and expose safe startup metadata", () => {
  const config = resolveIsolatedDemoConfig({
    mode: "offline",
    port: DEFAULT_ISOLATED_DEMO_PORT,
    webOrigin: DEFAULT_ISOLATED_WEB_ORIGIN,
  }, {});
  const options = createIsolatedDemoHttpOptions(config, Buffer.alloc(32, 7));
  const limiter = options.assistantRateLimiter as IsolatedDemoAssistantRateLimiter;
  assert.deepEqual(options.allowedOrigins, [DEFAULT_ISOLATED_WEB_ORIGIN]);
  assert.equal(options.storage, "in-memory");
  assert.equal(options.environment, "development");
  assert.deepEqual(options.financialAdviceConfig, { enabled: true });
  assert.equal(options.assistantConfig?.enabled, false);
  assert.ok(limiter instanceof IsolatedDemoAssistantRateLimiter);
  assert.equal(limiter.getProviderUsage().webProviderCallCap, 0);
  assert.equal(options.registrationFingerprintKey?.byteLength, 32);
  assert.deepEqual(buildIsolatedDemoStartupMetadata(config, "synthetic-run-id", limiter), {
    event: "financial-advice-demo-ready",
    runId: "synthetic-run-id",
    host: "127.0.0.1",
    port: DEFAULT_ISOLATED_DEMO_PORT,
    webOrigin: DEFAULT_ISOLATED_WEB_ORIGIN,
    storage: "in-memory",
    environment: "development",
    assistantProviderEnabled: false,
    providerTimeoutMs: 10_000,
    requestTimeoutMs: 12_000,
    providerBudget: {
      previousEvaluationCharges: 16,
      webProviderCallCap: 0,
      webProviderCallsRemaining: 0,
      providerCallBoundaryAttempts: 0,
      chargedProviderCallCount: 0,
      serverRunProviderCallCount: 0,
      serverRunProviderCallCap: 10,
      activeSlots: 0,
      status: "OFFLINE_DISABLED",
    },
    loginFixture: "synthetic-in-memory-only",
  });
});

test("live isolated demo shares a hard two-charge cap across help/advice and blocks before a fake provider call", () => {
  const config = resolveIsolatedDemoConfig({
    mode: "live",
    port: DEFAULT_ISOLATED_DEMO_PORT,
    webOrigin: DEFAULT_ISOLATED_WEB_ORIGIN,
  }, {
    ASSISTANT_ENABLED: "1",
    ASSISTANT_PROVIDER: "ollama",
    ASSISTANT_MODEL: "qwen3.5:4b",
    ASSISTANT_OLLAMA_BASE_URL: "http://127.0.0.1:11434",
  });
  const usageEvents: string[] = [];
  const limiter = createIsolatedDemoAssistantRateLimiter(config, (event) => usageEvents.push(event.status));
  const options = createIsolatedDemoHttpOptions(config, Buffer.alloc(32, 7), limiter);
  let helpProviderCalls = 0;
  let adviceProviderCalls = 0;

  const fakeProviderCall = (kind: "help" | "advice") => {
    const release = options.assistantRateLimiter!.acquire("synthetic-demo-user");
    try {
      options.assistantRateLimiter!.consumeProviderCall();
      if (kind === "help") helpProviderCalls += 1;
      else adviceProviderCalls += 1;
    } finally {
      release();
    }
  };

  fakeProviderCall("help");
  fakeProviderCall("advice");
  assert.throws(
    () => fakeProviderCall("help"),
    (error: unknown) => Boolean(
      error && typeof error === "object" &&
      "status" in error && error.status === 503 &&
      "code" in error && error.code === "ASSISTANT_UNAVAILABLE",
    ),
  );

  assert.equal(options.assistantRateLimiter, limiter);
  assert.equal(helpProviderCalls, 1);
  assert.equal(adviceProviderCalls, 1);
  assert.deepEqual(limiter.getProviderUsage(), {
    providerCallBoundaryAttempts: 3,
    chargedProviderCallCount: 2,
    blockedProviderCallCount: 1,
    webProviderCallCap: 2,
    webProviderCallsRemaining: 0,
    serverRunProviderCallCount: 2,
    serverRunProviderCallCap: 10,
    activeSlots: 0,
  });
  assert.deepEqual(usageEvents, ["CHARGED", "CHARGED", "WEB_CAP_BLOCKED"]);
});

test("isolated demo fails closed on persistence, non-local environment, inherited MFA or preload settings", () => {
  const args = {
    mode: "offline" as const,
    port: DEFAULT_ISOLATED_DEMO_PORT,
    webOrigin: DEFAULT_ISOLATED_WEB_ORIGIN,
  };
  for (const env of [
    { DATABASE_URL: "not-reported" },
    { DATABASE_TEST_ADMIN_URL: "not-reported" },
    { PGHOST: "not-reported" },
    { BANKING_STORAGE: "postgres" },
    { BANKING_ENV: "preview" },
    { NODE_ENV: "production" },
    { BANKING_MFA_REQUIRED: "1" },
    { BANKING_MFA_ENCRYPTION_KEY: "not-reported" },
    { BANKING_OTP_PEPPER: "not-reported" },
    { BANKING_OTP_PEPPER_KEY_ID: "not-reported" },
    { BANKING_OTP_PEPPER_PREVIOUS: "not-reported" },
    { BANKING_OTP_PEPPER_PREVIOUS_KEY_ID: "not-reported" },
    { NODE_OPTIONS: "not-reported" },
    { ASSISTANT_ENABLED: "1" },
  ]) {
    assert.throws(() => resolveIsolatedDemoConfig(args, env));
  }
});

test("live demo resolves only the supported local Ollama runtime without making a request", () => {
  const config = resolveIsolatedDemoConfig({
    mode: "live",
    port: DEFAULT_ISOLATED_DEMO_PORT,
    webOrigin: DEFAULT_ISOLATED_WEB_ORIGIN,
  }, {
    ASSISTANT_ENABLED: "1",
    ASSISTANT_PROVIDER: "ollama",
    ASSISTANT_MODEL: "qwen3.5:4b",
    ASSISTANT_OLLAMA_BASE_URL: "http://127.0.0.1:11434",
  });
  assert.equal(config.assistantConfig.enabled, true);
  assert.equal(config.assistantConfig.providerTimeoutMs, 25_000);
  assert.equal(config.assistantConfig.requestTimeoutMs, 30_000);
  assert.equal(config.financialAdviceEnabled, true);
});

test("live demo rejects missing or non-local provider configuration without network access", () => {
  const args = {
    mode: "live" as const,
    port: DEFAULT_ISOLATED_DEMO_PORT,
    webOrigin: DEFAULT_ISOLATED_WEB_ORIGIN,
  };
  assert.throws(() => resolveIsolatedDemoConfig(args, {}));
  assert.throws(() => resolveIsolatedDemoConfig(args, {
    ASSISTANT_ENABLED: "1",
    ASSISTANT_PROVIDER: "ollama",
    ASSISTANT_MODEL: "qwen3.5:4b",
    ASSISTANT_OLLAMA_BASE_URL: "https://example.invalid",
  }));
});

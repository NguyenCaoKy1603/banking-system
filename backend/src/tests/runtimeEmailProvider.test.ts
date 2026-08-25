import assert from "node:assert/strict";
import test from "node:test";

import { HttpEmailProvider } from "../mfa/httpEmailProvider.js";
import { createRuntimeEmailProvider } from "../mfa/runtimeEmailProvider.js";
import type { SecretProvider } from "../secrets/SecretProvider.js";

const input = {
  deliveryId: "delivery-1",
  purpose: "REGISTRATION_EMAIL_VERIFY",
  destination: "person@example.test",
  code: "123456",
  expiresAt: "2026-08-26T00:05:00.000Z",
};

function secretProvider(value = "managed-email-token"): SecretProvider {
  return {
    async getSecret() { return { value, version: "test-v1", source: "managed" }; },
    async getSecretVersion() { return "test-v1"; },
    async refresh() {},
  };
}

test("HTTP OTP provider sends only to the configured capture adapter and exposes redacted health", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const provider = new HttpEmailProvider({
    endpoint: "http://127.0.0.1:8025/api/messages",
    timeoutMs: 100,
    maxAttempts: 2,
    retryDelayMs: 0,
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(null, { status: 202, headers: { "x-provider-message-id": "capture-1" } });
    },
  });
  const result = await provider.send(input);
  assert.deepEqual(result, { status: "SENT", providerMessageId: "capture-1" });
  assert.equal(requestBody?.code, input.code);
  assert.deepEqual(provider.health(), { provider: "http", status: "ok", configured: true, credentialConfigured: false });
});

test("HTTP OTP provider retries bounded transient failures and records only a safe error code", async () => {
  let attempts = 0;
  const provider = new HttpEmailProvider({
    endpoint: "http://localhost:8025/api/messages",
    timeoutMs: 100,
    maxAttempts: 3,
    retryDelayMs: 0,
    fetchImpl: async () => {
      attempts += 1;
      return attempts < 3 ? new Response(null, { status: 503 }) : new Response(null, { status: 202 });
    },
  });
  assert.equal((await provider.send(input)).status, "SENT");
  assert.equal(attempts, 3);
  assert.equal(provider.health().lastErrorCode, undefined);

  const failed = new HttpEmailProvider({
    endpoint: "http://localhost:8025/api/messages",
    timeoutMs: 100,
    maxAttempts: 2,
    retryDelayMs: 0,
    fetchImpl: async () => new Response(null, { status: 503 }),
  });
  assert.deepEqual(await failed.send(input), { status: "FAILED", reason: "email-provider-http-503" });
  assert.equal(failed.health().lastErrorCode, "email-provider-http-503");
});

test("runtime factory allows disabled local preview, rejects disabled staging, and requires managed HTTPS delivery", async () => {
  const disabled = await createRuntimeEmailProvider({
    environment: "preview",
    isProductionLike: false,
    secretProvider: secretProvider(),
    env: { EMAIL_PROVIDER: "disabled" },
  });
  assert.equal(disabled.health().status, "disabled");
  await assert.rejects(
    createRuntimeEmailProvider({ environment: "staging", isProductionLike: true, secretProvider: secretProvider(), env: { EMAIL_PROVIDER: "disabled" } }),
    /forbidden in staging/i,
  );
  await assert.rejects(
    createRuntimeEmailProvider({ environment: "preview", isProductionLike: false, secretProvider: secretProvider(), env: { EMAIL_PROVIDER: "http", EMAIL_PROVIDER_URL: "https://api.example.test/send" } }),
    /local capture service/i,
  );
  const staging = await createRuntimeEmailProvider({
    environment: "staging",
    isProductionLike: true,
    secretProvider: secretProvider(),
    env: { EMAIL_PROVIDER: "http", EMAIL_PROVIDER_URL: "https://mail.example.test/send" },
  });
  assert.deepEqual(staging.health(), { provider: "http", status: "ok", configured: true, credentialConfigured: true });
  await assert.rejects(
    createRuntimeEmailProvider({ environment: "staging", isProductionLike: true, secretProvider: secretProvider(), env: { EMAIL_PROVIDER: "http", EMAIL_PROVIDER_URL: "https://user:pass@mail.example.test/send" } }),
    /credentials/i,
  );
});

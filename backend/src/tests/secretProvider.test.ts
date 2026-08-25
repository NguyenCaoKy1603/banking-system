import assert from "node:assert/strict";
import test from "node:test";

import { LocalDevelopmentSecretProvider } from "../secrets/LocalDevelopmentSecretProvider.js";
import { ManagedSecretProvider } from "../secrets/ManagedSecretProvider.js";
import { SecretCache } from "../secrets/secretCache.js";
import type { SecretProvider, SecretReference, SecretValue } from "../secrets/SecretProvider.js";

const reference: SecretReference = {
  secretId: "test-secret",
  environment: "preview",
  service: "backend-api",
  purpose: "test",
  envVar: "TEST_SECRET_VALUE",
};

test("local secret provider resolves only local environments and never stores a file", async () => {
  const provider = new LocalDevelopmentSecretProvider({ TEST_SECRET_VALUE: "base64:test-value" }, "preview");
  const value = await provider.getSecret(reference);
  assert.equal(value.value, "base64:test-value");
  assert.equal(value.source, "local");
  assert.equal((await provider.getSecretVersion(reference)), "local-v1");
  await assert.rejects(() => provider.getSecret({ ...reference, environment: "staging" }), /cannot resolve staging/);
});

test("managed provider fails closed until a real cloud client is injected", async () => {
  const provider = new ManagedSecretProvider();
  await assert.rejects(() => provider.getSecret({ ...reference, environment: "staging" }), /not configured/);
});

test("secret cache refreshes in memory without persisting values", async () => {
  let reads = 0;
  const value: SecretValue = { value: "opaque", version: "v1", source: "managed" };
  const backing: SecretProvider = {
    async getSecret() { reads += 1; return value; },
    async getSecretVersion() { return "v1"; },
    async refresh() { reads += 1; },
  };
  const cache = new SecretCache(backing);
  await cache.getSecret({ ...reference, environment: "staging" });
  await cache.getSecret({ ...reference, environment: "staging" });
  assert.equal(reads, 1);
  await cache.refresh({ ...reference, environment: "staging" });
  assert.equal(reads, 2);
  cache.clear();
});

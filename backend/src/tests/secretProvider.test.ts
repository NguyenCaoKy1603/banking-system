import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";

import { LocalDevelopmentSecretProvider } from "../secrets/LocalDevelopmentSecretProvider.js";
import { ManagedSecretProvider } from "../secrets/ManagedSecretProvider.js";
import { SecretCache } from "../secrets/secretCache.js";
import type { SecretProvider, SecretReference, SecretValue } from "../secrets/SecretProvider.js";
import { MountedSecretClient } from "../secrets/MountedSecretClient.js";
import { GoogleSecretManagerClient, type GoogleSecretManagerApi } from "../secrets/GoogleSecretManagerClient.js";
import { createRuntimeSecretProvider, referenceFor } from "../secrets/runtimeSecrets.js";
import { KeyEncryptionKeyringAdapter, OtpDigestKeyring } from "../mfa/crypto.js";
import { EndpointCrypto } from "../notifications/endpointCrypto.js";

const reference: SecretReference = {
  secretId: "test-secret",
  environment: "preview",
  service: "backend-api",
  purpose: "test",
  envVar: "TEST_SECRET_VALUE",
};

const CURRENT_TEST_KEY = `base64:${Buffer.alloc(32, 0x41).toString("base64")}`;
const PREVIOUS_TEST_KEY = `base64:${Buffer.alloc(32, 0x42).toString("base64")}`;

function managedKeyProvider(options: { missingPrevious?: boolean } = {}): SecretProvider {
  const getSecret = async (secretReference: SecretReference): Promise<SecretValue> => {
    if (options.missingPrevious && secretReference.secretId.endsWith("-previous")) {
      throw new Error("fixture previous secret is unavailable");
    }
    return {
      value: secretReference.secretId.endsWith("-previous") ? PREVIOUS_TEST_KEY : CURRENT_TEST_KEY,
      version: secretReference.secretId.endsWith("-previous") ? "fixture-v0" : "fixture-v1",
      source: "managed",
    };
  };
  return {
    getSecret,
    async getSecretVersion(secretReference) { return (await getSecret(secretReference)).version; },
    async refresh(secretReference) { await getSecret(secretReference); },
  };
}

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

test("managed provider rejects empty secret values or version metadata without echoing the value", async () => {
  for (const badValue of ["", "   "]) {
    const provider = new ManagedSecretProvider({
      async getSecret() { return { value: badValue, version: "v1", source: "managed" }; },
    });
    await assert.rejects(() => provider.getSecret({ ...reference, environment: "staging" }), /did not return a managed version/);
  }
  for (const badVersion of ["", "   "]) {
    const marker = "FIXTURE_SECRET_MUST_NOT_APPEAR";
    const provider = new ManagedSecretProvider({
      async getSecret() { return { value: marker, version: badVersion, source: "managed" }; },
    });
    await assert.rejects(
      () => provider.getSecret({ ...reference, environment: "staging" }),
      (error: Error) => error.message.includes("did not return a managed version") && !error.message.includes(marker),
    );
  }
});

test("staging keyrings load current and previous versions for verification and decryption", async () => {
  const provider = managedKeyProvider();

  const mfaReferences = {
    current: referenceFor("mfaEncryptionKey", "staging"),
    previous: referenceFor("mfaEncryptionKeyPrevious", "staging"),
  };
  const oldMfa = new KeyEncryptionKeyringAdapter(
    { id: "fixture-v0", value: Buffer.alloc(32, 0x42) },
  );
  const encryptedMfa = oldMfa.encrypt("synthetic-mfa-fixture");
  const mfa = await KeyEncryptionKeyringAdapter.fromSecretProvider(provider, mfaReferences, {
    currentKeyId: "fixture-v1",
    previousKeyId: "fixture-v0",
    required: true,
  });
  assert.equal(mfa.keyId, "fixture-v1");
  assert.deepEqual(mfa.previousKeyIds, ["fixture-v0"]);
  assert.equal(mfa.decrypt(encryptedMfa), "synthetic-mfa-fixture");

  const otp = await OtpDigestKeyring.fromSecretProvider(
    provider,
    { current: referenceFor("otpPepper", "staging"), previous: referenceFor("otpPepperPrevious", "staging") },
    { currentKeyId: "fixture-v1", previousKeyId: "fixture-v0", required: true },
  );
  const oldOtpDigest = otp.digest("synthetic-challenge", "123456", "fixture-v0");
  assert.equal(otp.currentKeyId, "fixture-v1");
  assert.equal(otp.verify("synthetic-challenge", "123456", oldOtpDigest, "fixture-v0"), true);

  const oldEndpoint = new EndpointCrypto(PREVIOUS_TEST_KEY, "fixture-v0");
  const encryptedEndpoint = oldEndpoint.encrypt("synthetic-endpoint", { environment: "staging", endpointId: "fixture" });
  const endpoint = await EndpointCrypto.fromSecretProvider(
    provider,
    { current: referenceFor("notificationEndpointKey", "staging"), previous: referenceFor("notificationEndpointKeyPrevious", "staging") },
    { currentKeyId: "fixture-v1", previousKeyId: "fixture-v0", required: true },
  );
  assert.equal(endpoint.keyId, "fixture-v1");
  assert.deepEqual(endpoint.previousKeyIds, ["fixture-v0"]);
  assert.equal(endpoint.decrypt(encryptedEndpoint, { environment: "staging", endpointId: "fixture" }), "synthetic-endpoint");
});

test("staging keyrings fail closed when any previous version is missing on first start", async () => {
  const provider = managedKeyProvider({ missingPrevious: true });

  await assert.rejects(
    () => KeyEncryptionKeyringAdapter.fromSecretProvider(
      provider,
      { current: referenceFor("mfaEncryptionKey", "staging"), previous: referenceFor("mfaEncryptionKeyPrevious", "staging") },
      { required: true },
    ),
    /fixture previous secret is unavailable/,
  );
  await assert.rejects(
    () => OtpDigestKeyring.fromSecretProvider(
      provider,
      { current: referenceFor("otpPepper", "staging"), previous: referenceFor("otpPepperPrevious", "staging") },
      { required: true },
    ),
    /fixture previous secret is unavailable/,
  );
  await assert.rejects(
    () => EndpointCrypto.fromSecretProvider(
      provider,
      { current: referenceFor("notificationEndpointKey", "staging"), previous: referenceFor("notificationEndpointKeyPrevious", "staging") },
      { required: true },
    ),
    /fixture previous secret is unavailable/,
  );
});

test("staging managed secret provider never falls back to an environment value", async () => {
  const provider = createRuntimeSecretProvider(
    { bankingEnvironment: "staging" },
    { BANKING_SECRET_PROVIDER: "managed", TEST_SECRET_VALUE: "local-fallback-must-not-be-used" },
  );
  await assert.rejects(
    () => provider.getSecret({ ...reference, environment: "staging" }),
    /Managed SecretProvider is not configured/,
  );
});

test("Google Secret Manager client requests latest and records the provider-assigned numeric version", async () => {
  let requestedName = "";
  const api: GoogleSecretManagerApi = {
    async accessSecretVersion(request) {
      requestedName = request.name;
      return [{
        name: "projects/123456789/secrets/test-secret/versions/7",
        payload: { data: Buffer.from("base64:fixture-key", "utf8") },
      }];
    },
  };
  const client = new GoogleSecretManagerClient("banking-staging", api);
  const result = await client.getSecret({ ...reference, environment: "staging" });
  assert.equal(requestedName, "projects/banking-staging/secrets/test-secret/versions/latest");
  assert.deepEqual(result, { value: "base64:fixture-key", version: "7", source: "managed" });
});

test("Google Secret Manager rejects malformed references and sanitizes provider failures", async () => {
  let calls = 0;
  const api: GoogleSecretManagerApi = {
    async accessSecretVersion() {
      calls += 1;
      throw new Error("provider error containing FIXTURE_SECRET_VALUE");
    },
  };
  assert.throws(() => new GoogleSecretManagerClient("invalid project", api), /valid Google Cloud project/);
  const client = new GoogleSecretManagerClient("banking-staging", api);
  await assert.rejects(
    () => client.getSecret({ ...reference, environment: "staging", secretId: "../escape" }),
    /secret ID is invalid/,
  );
  await assert.rejects(
    () => client.getSecret({ ...reference, environment: "staging" }),
    (error: Error) => error.message.includes("could not resolve managed secret test-secret")
      && !error.message.includes("FIXTURE_SECRET_VALUE"),
  );
  assert.equal(calls, 1);
});

test("runtime selects Google Secret Manager explicitly and rejects conflicting backend settings", async () => {
  const api: GoogleSecretManagerApi = {
    async accessSecretVersion(request) {
      assert.equal(request.name, "projects/banking-staging/secrets/test-secret/versions/latest");
      return [{ name: "projects/123456789/secrets/test-secret/versions/2", payload: { data: Buffer.from("secret") } }];
    },
  };
  const provider = createRuntimeSecretProvider(
    { bankingEnvironment: "staging" },
    {
      BANKING_SECRET_PROVIDER: "managed",
      BANKING_MANAGED_SECRET_BACKEND: "google-secret-manager",
      BANKING_SECRET_PROJECT_ID: "banking-staging",
    },
    { googleSecretManagerApi: api },
  );
  assert.deepEqual(
    await provider.getSecret({ ...reference, environment: "staging" }),
    { value: "secret", version: "2", source: "managed" },
  );

  assert.throws(
    () => createRuntimeSecretProvider(
      { bankingEnvironment: "staging" },
      { BANKING_SECRET_PROVIDER: "managed", BANKING_MANAGED_SECRET_BACKEND: "google-secret-manager" },
    ),
    /BANKING_SECRET_PROJECT_ID is required/,
  );
  assert.throws(
    () => createRuntimeSecretProvider(
      { bankingEnvironment: "staging" },
      {
        BANKING_SECRET_PROVIDER: "managed",
        BANKING_MANAGED_SECRET_BACKEND: "google-secret-manager",
        BANKING_SECRET_PROJECT_ID: "banking-staging",
        BANKING_MANAGED_SECRETS_DIR: "C:\\run\\secrets",
      },
    ),
    /cannot be combined/,
  );
});

test("mounted managed secret client requires version sidecars and never falls back to env", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "banking-managed-secrets-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "test-secret"), "base64:mounted-value\n", { encoding: "utf8" });
  await writeFile(path.join(directory, "test-secret.version"), "secret-version-7\n", { encoding: "utf8" });

  const client = new MountedSecretClient(directory);
  const provider = new ManagedSecretProvider(client);
  const value = await provider.getSecret({ ...reference, environment: "staging" });
  assert.deepEqual(value, { value: "base64:mounted-value", version: "secret-version-7", source: "managed" });

  const runtimeProvider = createRuntimeSecretProvider(
    { bankingEnvironment: "staging" },
    { BANKING_SECRET_PROVIDER: "managed", BANKING_MANAGED_SECRETS_DIR: directory },
  );
  assert.equal(
    (await runtimeProvider.getSecret({ ...reference, environment: "staging" })).source,
    "managed",
  );

  await rm(path.join(directory, "test-secret.version"));
  await assert.rejects(
    () => provider.getSecret({ ...reference, environment: "staging" }),
    /not available with version metadata/,
  );
  await assert.rejects(
    () => client.getSecret({ ...reference, environment: "preview" }),
    /only staging or production-like/,
  );
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

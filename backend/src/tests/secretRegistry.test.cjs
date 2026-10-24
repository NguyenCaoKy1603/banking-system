const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const YAML = require("yaml");
const { validateSecretRegistry } = require("../../scripts/validate-secret-registry.cjs");

const registryPath = path.resolve(__dirname, "../../../documents/07-release/secret-registry.yaml");
const stagingContractPath = path.resolve(__dirname, "../../../infrastructure/staging/provider-neutral/contract.yaml");

function loadRegistry() {
  return YAML.parse(fs.readFileSync(registryPath, "utf8"));
}

test("secret registry inventories every runtime and release credential", () => {
  const registry = loadRegistry();
  const { secretCount } = validateSecretRegistry(registry);
  assert.equal(secretCount, 11);
  for (const entry of registry.secrets) {
    assert.ok(entry.owner, `${entry.secretId} has an owner role`);
    assert.ok(entry.binding?.mode && entry.binding?.target, `${entry.secretId} has a binding`);
    assert.equal(entry.version?.source, "provider-assigned", `${entry.secretId} reports provider version metadata`);
    assert.ok(entry.version?.slot, `${entry.secretId} declares a version slot`);
    assert.ok(entry.lifecycle?.initialState && entry.lifecycle?.rotate && entry.lifecycle?.retire, `${entry.secretId} has lifecycle metadata`);
  }
});

test("registry requires owner, binding, version and lifecycle metadata for every secret", () => {
  const mutations = [
    (entry) => { delete entry.owner; },
    (entry) => { delete entry.binding; },
    (entry) => { delete entry.version; },
    (entry) => { delete entry.lifecycle; },
  ];
  const expectedErrors = [/missing owner metadata/, /missing valid binding metadata/, /missing valid version metadata/, /missing valid lifecycle metadata/];

  for (const [index, mutate] of mutations.entries()) {
    const registry = loadRegistry();
    mutate(registry.secrets[0]);
    assert.throws(() => validateSecretRegistry(registry), expectedErrors[index]);
  }
});

test("first staging deployment declares previous key slots as prepared and required", () => {
  const registry = loadRegistry();
  const previousIds = ["otp-pepper-previous", "mfa-encryption-key-previous", "notification-endpoint-key-previous"];
  for (const secretId of previousIds) {
    const entry = registry.secrets.find((candidate) => candidate.secretId === secretId);
    assert.equal(entry?.version?.slot, "previous");
    assert.equal(entry?.version?.firstDeployment, "prepared-previous-required");
    assert.equal(entry?.lifecycle?.initialState, "PREPARED");
  }
  for (const secretId of previousIds) {
    const registryWithMissingPolicy = loadRegistry();
    const entry = registryWithMissingPolicy.secrets.find((candidate) => candidate.secretId === secretId);
    entry.version.firstDeployment = "required-when-enabled";
    assert.throws(() => validateSecretRegistry(registryWithMissingPolicy), new RegExp(`Previous key ${secretId}`));
  }
});

test("registry validation fails closed when any runtime key reference is omitted", () => {
  for (const requiredId of [
    "registration-fingerprint-key",
    "otp-pepper-previous",
    "mfa-encryption-key-previous",
    "notification-endpoint-key-previous",
  ]) {
    const registry = loadRegistry();
    registry.secrets = registry.secrets.filter((entry) => entry.secretId !== requiredId);
    assert.throws(() => validateSecretRegistry(registry), new RegExp(requiredId));
  }
});

test("registry validation rejects value-bearing metadata", () => {
  const registry = loadRegistry();
  registry.secrets[0].value = "fixture-only-marker";
  assert.throws(() => validateSecretRegistry(registry), /must not contain a secret value/);
});

test("staging contract binds only inventoried secrets to their owning service", () => {
  const registry = loadRegistry();
  const knownIds = new Set(registry.secrets.map((entry) => entry.secretId));
  const contract = YAML.parse(fs.readFileSync(stagingContractPath, "utf8"));
  const bindings = contract.secrets.perServiceBindings;
  const adminEnvironment = contract.services["admin-api"].environment;

  assert.equal(adminEnvironment.NODE_ENV, "production");
  assert.equal(adminEnvironment.BANKING_ENV, "staging");
  assert.equal(adminEnvironment.BANKING_MONEY_MODE, "virtual");
  assert.equal(adminEnvironment.BANKING_STORAGE, "postgres");
  assert.equal(adminEnvironment.BANKING_PERSISTENCE_MODE, "relational-v2");
  assert.equal(adminEnvironment.BANKING_SECRET_PROVIDER, "managed");
  assert.equal(adminEnvironment.ADMIN_SECURE_COOKIES, "1");

  const migrationIds = fs.readdirSync(path.resolve(__dirname, "../../database"))
    .map((file) => file.match(/^(\d{3})_.+\.sql$/)?.[1])
    .filter(Boolean)
    .sort();
  assert.ok(migrationIds.length > 0, "the repository must contain database migrations");
  assert.equal(contract.database.migrationJob.migrations, `${migrationIds[0]}-${migrationIds[migrationIds.length - 1]}`);

  for (const secretId of contract.secrets.references) {
    assert.ok(knownIds.has(secretId), `contract reference ${secretId} must exist in registry`);
  }
  for (const binding of Object.values(bindings)) {
    for (const secretId of [...(binding.secretIds ?? []), ...Object.values(binding.providerManagedEnvironment ?? {})]) {
      if (secretId === "verify-full" || secretId === "database.serverName") continue;
      assert.ok(knownIds.has(secretId), `service binding ${secretId} must exist in registry`);
    }
  }
  assert.deepEqual(bindings["backend-api"].providerManagedEnvironment, {
    REGISTRATION_FINGERPRINT_KEY: "registration-fingerprint-key",
  });
  assert.deepEqual(bindings["backend-api"].secretIds, [
    "database-credential",
    "otp-pepper",
    "otp-pepper-previous",
    "mfa-encryption-key",
    "mfa-encryption-key-previous",
    "email-provider-token",
  ]);
  assert.deepEqual(bindings["admin-api"].secretIds, [
    "database-credential",
    "mfa-encryption-key",
    "mfa-encryption-key-previous",
  ]);
  assert.deepEqual(bindings["outbox-worker"].secretIds, [
    "database-credential",
    "notification-endpoint-key",
    "notification-endpoint-key-previous",
  ]);
  assert.equal("REGISTRATION_FINGERPRINT_KEY" in (bindings["outbox-worker"].providerManagedEnvironment ?? {}), false);
  assert.equal("REGISTRATION_FINGERPRINT_KEY" in (bindings["admin-api"].providerManagedEnvironment ?? {}), false);
  assert.equal(bindings["managed-build-service"].signingReference, "mobile-signing-key");
  assert.equal(bindings["managed-build-service"].availableToRuntimeServices, false);

  assert.deepEqual(contract.secrets.initialPreviousKeyPolicy, {
    requiredBeforeFirstStart: true,
    initialState: "PREPARED",
    material: "unique-random-staging-only",
    firstRotation: "replace-bootstrap-previous-with-former-current",
    retireBootstrapPrevious: "only-after-no-data-reference-and-owner-approval",
  });
});

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const registryPath = path.resolve(__dirname, "../../documents/07-release/secret-registry.yaml");
const REQUIRED_SECRET_IDS = new Set([
  "database-credential",
  "otp-pepper",
  "otp-pepper-previous",
  "mfa-encryption-key",
  "mfa-encryption-key-previous",
  "email-provider-token",
  "notification-endpoint-key",
  "notification-endpoint-key-previous",
  "registration-fingerprint-key",
  "backup-encryption-key",
  "mobile-signing-key",
]);

const forbiddenKey = /^(value|plaintext|secret|token|password|privatekey|keymaterial|credential)$/i;
const BINDING_MODES = new Set(["managed-mount", "provider-managed-environment", "managed-build-service-only"]);
const VERSION_SLOTS = new Set(["single", "current", "previous"]);
const FIRST_DEPLOYMENT_POLICIES = new Set([
  "required-at-startup",
  "required-when-enabled",
  "required-at-build",
  "prepared-previous-required",
]);
const LIFECYCLE_STATES = new Set(["PREPARED", "ACTIVE", "DECRYPT_ONLY", "REVOKED", "DESTROY_PENDING", "DESTROYED"]);

function validateSecretRegistry(registry) {
  if (!registry || registry.version !== 1 || !registry.environments || !Array.isArray(registry.secrets)) {
    throw new Error("Secret registry must declare version 1, environments and a secrets list.");
  }

  for (const environment of ["development", "staging", "production-like"]) {
    const entry = registry.environments[environment];
    if (!entry?.provider || !entry.namespace) throw new Error(`Secret registry is missing ${environment} provider/namespace.`);
    if (["staging", "production-like"].includes(environment) && entry.provider !== "managed") {
      throw new Error(`${environment} secret registry entry must use provider=managed.`);
    }
  }

  function walk(value, key = "") {
    if (forbiddenKey.test(key)) throw new Error(`Secret registry must not contain a secret value under '${key}'.`);
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (value && typeof value === "object") {
      for (const [childKey, childValue] of Object.entries(value)) walk(childValue, childKey);
    }
  }
  walk(registry);

  const seen = new Set();
  for (const entry of registry.secrets) {
    if (!entry || typeof entry.secretId !== "string" || !/^[a-z0-9][a-z0-9-]{2,80}$/.test(entry.secretId)) {
      throw new Error("Every secret registry entry needs a kebab-case secretId.");
    }
    if (seen.has(entry.secretId)) throw new Error(`Duplicate secret registry entry: ${entry.secretId}.`);
    seen.add(entry.secretId);
    if (!entry.purpose || !Array.isArray(entry.services) || entry.services.length === 0 || !entry.rotation) {
      throw new Error(`Secret registry entry ${entry.secretId} is missing purpose/services/rotation metadata.`);
    }
    if (typeof entry.owner !== "string" || !entry.owner.trim()) {
      throw new Error(`Secret registry entry ${entry.secretId} is missing owner metadata.`);
    }
    if (!entry.binding || !BINDING_MODES.has(entry.binding.mode) || typeof entry.binding.target !== "string" || !entry.binding.target.trim()) {
      throw new Error(`Secret registry entry ${entry.secretId} is missing valid binding metadata.`);
    }
    if (!entry.version || !VERSION_SLOTS.has(entry.version.slot) || entry.version.source !== "provider-assigned" || !FIRST_DEPLOYMENT_POLICIES.has(entry.version.firstDeployment)) {
      throw new Error(`Secret registry entry ${entry.secretId} is missing valid version metadata.`);
    }
    if (entry.version.slot === "previous" && entry.version.firstDeployment !== "prepared-previous-required") {
      throw new Error(`Previous key ${entry.secretId} must be provisioned in PREPARED state before the first staging start.`);
    }
    if (entry.version.slot !== "previous" && entry.version.firstDeployment === "prepared-previous-required") {
      throw new Error(`Only previous-key entries may use prepared-previous-required: ${entry.secretId}.`);
    }
    if (
      !entry.lifecycle ||
      !LIFECYCLE_STATES.has(entry.lifecycle.initialState) ||
      typeof entry.lifecycle.rotate !== "string" || !entry.lifecycle.rotate.trim() ||
      typeof entry.lifecycle.retire !== "string" || !entry.lifecycle.retire.trim()
    ) {
      throw new Error(`Secret registry entry ${entry.secretId} is missing valid lifecycle metadata.`);
    }
  }

  for (const requiredId of REQUIRED_SECRET_IDS) {
    if (!seen.has(requiredId)) throw new Error(`Secret registry is missing required secretId ${requiredId}.`);
  }
  if (!Array.isArray(registry.states) || !registry.states.includes("ACTIVE") || !registry.states.includes("REVOKED")) {
    throw new Error("Secret registry must define at least ACTIVE and REVOKED lifecycle states.");
  }
  return { secretCount: registry.secrets.length };
}

function validateRegistryFile() {
  const source = fs.readFileSync(registryPath, "utf8");
  const registry = YAML.parse(source);
  const result = validateSecretRegistry(registry);
  console.log(`Secret registry valid: ${result.secretCount} metadata-only entries; no secret values found.`);
}

if (require.main === module) validateRegistryFile();

module.exports = { validateSecretRegistry };

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const registryPath = path.resolve(__dirname, "../../documents/07-release/secret-registry.yaml");
const source = fs.readFileSync(registryPath, "utf8");
const registry = YAML.parse(source);

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

const requiredIds = new Set([
  "database-credential",
  "otp-pepper",
  "mfa-encryption-key",
  "email-provider-token",
  "notification-endpoint-key",
  "backup-encryption-key",
  "mobile-signing-key",
]);
const seen = new Set();
const forbiddenKey = /^(value|plaintext|secret|token|password|privatekey|keymaterial|credential)$/i;
function walk(value, key = "") {
  if (forbiddenKey.test(key)) throw new Error(`Secret registry must not contain a secret value under '${key}'.`);
  if (Array.isArray(value)) {
    for (const item of value) walk(item);
  } else if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) walk(childValue, childKey);
  }
}
walk(registry);

for (const entry of registry.secrets) {
  if (!entry || typeof entry.secretId !== "string" || !/^[a-z0-9][a-z0-9-]{2,80}$/.test(entry.secretId)) {
    throw new Error("Every secret registry entry needs a kebab-case secretId.");
  }
  if (seen.has(entry.secretId)) throw new Error(`Duplicate secret registry entry: ${entry.secretId}.`);
  seen.add(entry.secretId);
  if (!entry.purpose || !Array.isArray(entry.services) || entry.services.length === 0 || !entry.rotation) {
    throw new Error(`Secret registry entry ${entry.secretId} is missing purpose/services/rotation metadata.`);
  }
}
for (const requiredId of requiredIds) {
  if (!seen.has(requiredId)) throw new Error(`Secret registry is missing required secretId ${requiredId}.`);
}
if (!Array.isArray(registry.states) || !registry.states.includes("ACTIVE") || !registry.states.includes("REVOKED")) {
  throw new Error("Secret registry must define at least ACTIVE and REVOKED lifecycle states.");
}

console.log(`Secret registry valid: ${registry.secrets.length} metadata-only entries; no secret values found.`);

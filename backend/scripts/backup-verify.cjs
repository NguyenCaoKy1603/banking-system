const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const { arg, repoRoot, sha256File } = require("./backup-common.cjs");

const forbiddenKeys = /(?:^|_)(?:password|secret|access_token|refresh_token|token|otp|totp|pin|cvv|database_url|databaseurl|signed_url|signedurl|private_key|privatekey|key_value)(?:$|_)/i;

function fail(message) {
  throw new Error(message);
}

function requireHex(value, name) {
  if (!/^[0-9a-f]{64}$/i.test(String(value ?? ""))) fail(`${name} must be a SHA-256 hex digest.`);
}

function scanManifest(value, location = "manifest") {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${location} must be an object.`);
  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenKeys.test(key)) fail(`${location} contains forbidden secret-like field: ${key}.`);
    if (typeof entry === "string" && forbiddenKeys.test(entry) && entry.length > 0) fail(`${location} contains a forbidden secret-like value.`);
    if (entry && typeof entry === "object") scanManifest(entry, `${location}.${key}`);
  }
}

function readManifest(manifestPath) {
  const absolute = path.resolve(manifestPath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) fail(`Backup manifest does not exist: ${manifestPath}`);
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(absolute, "utf8")); } catch { fail("Backup manifest is not valid JSON."); }
  scanManifest(manifest);
  for (const field of ["backupId", "environment", "backupType", "backupObject", "plaintextChecksum", "ciphertextChecksum", "encryptionKeyId", "schemaVersion", "migrationSetDigest", "status"]) {
    if (manifest[field] === undefined || manifest[field] === null || String(manifest[field]).trim() === "") fail(`Backup manifest is missing ${field}.`);
  }
  if (manifest.formatVersion !== 2 || manifest.backupType !== "LOGICAL" || manifest.status !== "COMPLETE") fail("Only COMPLETE formatVersion=2 LOGICAL backups can be verified.");
  if (!["development", "test", "preview"].includes(String(manifest.environment).toLowerCase())) fail("Local verifier refuses staging/production-like artifacts without managed provider verification.");
  requireHex(manifest.plaintextChecksum, "plaintextChecksum");
  requireHex(manifest.ciphertextChecksum, "ciphertextChecksum");
  requireHex(manifest.migrationSetDigest, "migrationSetDigest");
  if (!/^backup-[0-9a-f-]{36}$/i.test(manifest.backupId)) fail("backupId has an invalid format.");
  if (!/^\d+$/.test(String(manifest.postgresMajor ?? ""))) fail("postgresMajor must be numeric.");
  const objectName = String(manifest.backupObject);
  if (objectName !== path.basename(objectName) || !/^logical-backup-[0-9a-f-]{36}\.dump\.enc$/i.test(objectName)) fail("backupObject must be a sibling logical backup file.");
  const backupPath = path.join(path.dirname(absolute), objectName);
  if (!fs.existsSync(backupPath) || !fs.statSync(backupPath).isFile()) fail("Encrypted backup object referenced by manifest is missing.");
  return { absolute, manifest, backupPath };
}

function verify() {
  const manifestPath = arg("manifest");
  if (!manifestPath) fail("--manifest=<path> is required.");
  const { absolute, manifest, backupPath } = readManifest(manifestPath);
  const stats = fs.statSync(backupPath);
  if (Number(manifest.encryptedSizeBytes) !== stats.size) fail("Encrypted backup size does not match the manifest.");
  if (sha256File(backupPath).toLowerCase() !== String(manifest.ciphertextChecksum).toLowerCase()) fail("Encrypted backup ciphertext checksum does not match the manifest.");
  const verification = execFileSync(process.execPath, [
    path.join(repoRoot, "backend", "scripts", "encrypted-backup.cjs"),
    "--verify-only",
    `--input=${backupPath}`,
  ], { cwd: repoRoot, env: process.env, encoding: "utf8" });
  let metadata;
  try { metadata = JSON.parse(verification); } catch { fail("Encrypted backup verifier did not return valid metadata."); }
  if (metadata.backupId !== manifest.backupId || metadata.keyId !== manifest.encryptionKeyId || metadata.checksum !== manifest.plaintextChecksum) fail("Encrypted backup metadata does not match the manifest.");
  if (metadata.environment !== manifest.environment || metadata.schemaVersion !== manifest.schemaVersion || metadata.migrationSetDigest !== manifest.migrationSetDigest) fail("Encrypted backup authenticated metadata does not match the manifest.");
  const result = {
    status: "VERIFIED",
    manifest: path.relative(repoRoot, absolute).replaceAll(path.sep, "/"),
    backupObject: path.relative(repoRoot, backupPath).replaceAll(path.sep, "/"),
    backupId: manifest.backupId,
    environment: manifest.environment,
    schemaVersion: manifest.schemaVersion,
    migrationSetDigest: manifest.migrationSetDigest,
    encryptedBytes: stats.size,
    plaintextChecksum: manifest.plaintextChecksum,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = { readManifest };

if (require.main === module) {
  try {
    verify();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

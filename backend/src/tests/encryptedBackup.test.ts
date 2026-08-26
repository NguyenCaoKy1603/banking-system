import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("encrypted backup round-trip verifies authenticated checksum without exposing the key", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "banking-backup-test-"));
  const input = path.join(directory, "preview.sql");
  const encrypted = path.join(directory, "preview.sql.enc");
  const metadata = path.join(directory, "preview.metadata.json");
  const plaintext = "CREATE TABLE synthetic_backup (id integer);\n";
  writeFileSync(input, plaintext);
  const env = { ...process.env, BACKUP_ENCRYPTION_KEY: `base64:${Buffer.alloc(32, 9).toString("base64")}`, BACKUP_ENCRYPTION_KEY_ID: "backup-test-v1" };
  const script = path.resolve("scripts/encrypted-backup.cjs");
  try {
    execFileSync(process.execPath, [script, "--encrypt", `--input=${input}`, `--output=${encrypted}`, `--metadata=${metadata}`], { cwd: path.resolve("."), env, stdio: ["ignore", "pipe", "pipe"] });
    const restored = execFileSync(process.execPath, [script, "--decrypt", `--input=${encrypted}`, "--output=-"], { cwd: path.resolve("."), env });
    assert.equal(restored.toString("utf8"), plaintext);
    assert.equal(JSON.parse(readFileSync(metadata, "utf8")).keyId, "backup-test-v1");
    const verified = execFileSync(process.execPath, [script, "--verify-only", `--input=${encrypted}`], { cwd: path.resolve("."), env });
    assert.equal(JSON.parse(verified.toString("utf8")).checksum, JSON.parse(readFileSync(metadata, "utf8")).checksum);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("encrypted backup rejects wrong keys, tampering, truncation and plaintext overwrite", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "banking-backup-integrity-test-"));
  const input = path.join(directory, "preview.sql");
  const encrypted = path.join(directory, "preview.sql.enc");
  const tampered = path.join(directory, "tampered.sql.enc");
  const truncated = path.join(directory, "truncated.sql.enc");
  const output = path.join(directory, "restored.sql");
  writeFileSync(input, "CREATE TABLE authenticated_backup (id integer);\n");
  const env = { ...process.env, BACKUP_ENCRYPTION_KEY: `base64:${Buffer.alloc(32, 7).toString("base64")}`, BACKUP_ENCRYPTION_KEY_ID: "backup-integrity-v1" };
  const wrongEnv = { ...env, BACKUP_ENCRYPTION_KEY: `base64:${Buffer.alloc(32, 8).toString("base64")}` };
  const script = path.resolve("scripts/encrypted-backup.cjs");
  try {
    execFileSync(process.execPath, [script, "--encrypt", `--input=${input}`, `--output=${encrypted}`, "--environment=preview"], { cwd: path.resolve("."), env });
    assert.throws(() => execFileSync(process.execPath, [script, "--verify-only", `--input=${encrypted}`], { cwd: path.resolve("."), env: wrongEnv }));

    const bytes = readFileSync(encrypted);
    const metadataLength = bytes.readUInt32BE(Buffer.from("BANKING-BACKUP-V1\0").length);
    const metadataStart = Buffer.from("BANKING-BACKUP-V1\0").length + 4;
    const metadataTampered = Buffer.from(bytes);
    metadataTampered[metadataStart + Math.min(metadataLength - 1, 5)] ^= 1;
    writeFileSync(tampered, metadataTampered);
    assert.throws(() => execFileSync(process.execPath, [script, "--verify-only", `--input=${tampered}`], { cwd: path.resolve("."), env }));

    writeFileSync(truncated, bytes.subarray(0, bytes.length - 3));
    assert.throws(() => execFileSync(process.execPath, [script, "--verify-only", `--input=${truncated}`], { cwd: path.resolve("."), env }));

    assert.throws(() => execFileSync(process.execPath, [script, "--decrypt", `--input=${tampered}`, `--output=${output}`, "--allow-plaintext-output"], { cwd: path.resolve("."), env }));
    assert.equal(existsSync(output), false);
    assert.throws(() => execFileSync(process.execPath, [script, "--encrypt", `--input=${input}`, `--output=${encrypted}`], { cwd: path.resolve("."), env }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("staging-like encrypted backups cannot be written to a plaintext file", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "banking-backup-production-output-test-"));
  const input = path.join(directory, "preview.sql");
  const encrypted = path.join(directory, "preview.sql.enc");
  const output = path.join(directory, "restored.sql");
  writeFileSync(input, "CREATE TABLE protected_backup (id integer);\n");
  const env = { ...process.env, BACKUP_ENCRYPTION_KEY: `base64:${Buffer.alloc(32, 6).toString("base64")}` };
  const script = path.resolve("scripts/encrypted-backup.cjs");
  try {
    execFileSync(process.execPath, [script, "--encrypt", `--input=${input}`, `--output=${encrypted}`, "--environment=production-like"], { cwd: path.resolve("."), env });
    assert.throws(() => execFileSync(process.execPath, [script, "--decrypt", `--input=${encrypted}`, `--output=${output}`, "--allow-plaintext-output"], { cwd: path.resolve("."), env }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

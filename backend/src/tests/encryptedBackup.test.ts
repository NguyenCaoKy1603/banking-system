import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

function fingerprint(directory: string): { migrationSetDigest: string } {
  const script = path.resolve(process.cwd(), "scripts/migration-fingerprint.cjs");
  return JSON.parse(execFileSync(process.execPath, [script, directory], { encoding: "utf8" }));
}

test("migration fingerprint is stable across checkout newline styles", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "migration-fingerprint-"));
  const lf = path.join(root, "lf");
  const crlf = path.join(root, "crlf");
  try {
    const sql = "CREATE TABLE example (id integer);\n";
    const files = ["001_example.sql", "002_second.sql"];
    for (const directory of [lf, crlf]) {
      mkdirSync(directory);
      for (const fileName of files) writeFileSync(path.join(directory, fileName), directory === lf ? sql : sql.replaceAll("\n", "\r\n"));
    }
    assert.equal(fingerprint(lf).migrationSetDigest, fingerprint(crlf).migrationSetDigest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { URL } from "node:url";
import { Pool } from "pg";

import {
  AUTHORIZED_EVIDENCE_PHASES,
  type EvidencePhase,
  RUN_ID_PATTERN,
  assertRuntimeDatabaseOwnership,
  computeCanonicalMigrationInventory,
  mutateChecksumOneNibble,
  validateMigrationHistoryRecords,
} from "../database/disposableDatabaseGuard.js";

// Fail-fast entry guard: verify runner context before test registration or connection
const runId = process.env.DATABASE_TEST_RUN_ID;
const phase = process.env.DISPOSABLE_TEST_PHASE;
const disposableMarker = process.env.DATABASE_TEST_DISPOSABLE;
const targetUrl = process.env.RELATIONAL_DATABASE_URL || process.env.DATABASE_URL;

if (!runId || !RUN_ID_PATTERN.test(runId)) {
  throw new Error("Unauthorized runtime test invocation: missing or invalid DATABASE_TEST_RUN_ID.");
}
if (!phase || !AUTHORIZED_EVIDENCE_PHASES.includes(phase as EvidencePhase)) {
  throw new Error(`Unauthorized runtime test invocation: missing or invalid DISPOSABLE_TEST_PHASE '${phase}'.`);
}
if (disposableMarker !== "1") {
  throw new Error("Unauthorized runtime test invocation: missing or invalid DATABASE_TEST_DISPOSABLE marker.");
}
if (!targetUrl) {
  throw new Error("Unauthorized runtime test invocation: missing target database URL.");
}

let parsedUrl: URL;
try {
  parsedUrl = new URL(targetUrl);
} catch {
  throw new Error("Unauthorized runtime test invocation: malformed target database URL.");
}

if (parsedUrl.hostname !== "127.0.0.1" && parsedUrl.hostname !== "::1") {
  throw new Error(`Unauthorized runtime test invocation: target host '${parsedUrl.hostname}' must be numeric loopback.`);
}

const expectedDbName = `/banking_test_${runId}`;
if (parsedUrl.pathname !== expectedDbName) {
  throw new Error(`Unauthorized runtime test invocation: database name in URL does not match ${expectedDbName}.`);
}

// Exactly one test is registered corresponding to the authorized phase
test(`M07-A2 runtime evidence phase: ${phase}`, async () => {
  const pool = new Pool({
    connectionString: targetUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
  });

  try {
    // 1. Apply session timeout guards
    await pool.query("SET statement_timeout = '30s'; SET lock_timeout = '5s';");

    // 2. Verify ownership marker and current database match target (Correction C)
    const ownershipRes = await pool.query(
      "SELECT current_database() AS db_name, shobj_description(d.oid, 'pg_database') AS comment FROM pg_database d WHERE d.datname = current_database()",
    );
    const ownershipRow = ownershipRes.rows[0] as { db_name?: string; comment?: string } | undefined;
    assertRuntimeDatabaseOwnership(
      {
        currentDatabase: ownershipRow?.db_name ?? "",
        comment: ownershipRow?.comment ?? "",
      },
      runId,
    );

    // 3. Load canonical inventory from SQL files
    const databaseDir = path.resolve(import.meta.dirname, "../../database");
    const canonicalInventory = computeCanonicalMigrationInventory(databaseDir);
    const canonicalKeys = Array.from(canonicalInventory.keys());

    if (phase === "INITIAL_HISTORY") {
      const historyRes = await pool.query(
        "SELECT migration_key, checksum, status FROM reference_schema_migrations ORDER BY migration_key",
      );
      const rows = historyRes.rows as Array<{ migration_key: string; checksum: string; status: string }>;
      validateMigrationHistoryRecords(rows, canonicalKeys, canonicalInventory);
    } else if (phase === "RERUN_HISTORY") {
      const historyRes = await pool.query(
        "SELECT migration_key, checksum, status FROM reference_schema_migrations ORDER BY migration_key",
      );
      const rows = historyRes.rows as Array<{ migration_key: string; checksum: string; status: string }>;
      validateMigrationHistoryRecords(rows, canonicalKeys, canonicalInventory);
    } else if (phase === "INJECT_CHECKSUM_MISMATCH") {
      const targetKey = "001_banking_mvp";
      const existingRes = await pool.query(
        "SELECT checksum FROM reference_schema_migrations WHERE migration_key = $1",
        [targetKey],
      );
      const row = existingRes.rows[0] as { checksum?: string } | undefined;
      const currentChecksum = row?.checksum;
      if (!currentChecksum) {
        throw new Error(`Target migration '${targetKey}' not found in reference_schema_migrations.`);
      }
      const mutatedChecksum = mutateChecksumOneNibble(currentChecksum);
      const updateRes = await pool.query(
        "UPDATE reference_schema_migrations SET checksum = $1 WHERE migration_key = $2",
        [mutatedChecksum, targetKey],
      );
      assert.equal(updateRes.rowCount, 1, "Expected exactly 1 row updated with mutated checksum");
    } else if (phase === "RESTORE_CHECKSUM") {
      const targetKey = "001_banking_mvp";
      const canonicalChecksum = canonicalInventory.get(targetKey);
      if (!canonicalChecksum) {
        throw new Error(`Target migration '${targetKey}' not found in canonical inventory.`);
      }
      const updateRes = await pool.query(
        "UPDATE reference_schema_migrations SET checksum = $1 WHERE migration_key = $2",
        [canonicalChecksum, targetKey],
      );
      assert.equal(updateRes.rowCount, 1, "Expected exactly 1 row updated with restored checksum");

      const verifyRes = await pool.query(
        "SELECT checksum FROM reference_schema_migrations WHERE migration_key = $1",
        [targetKey],
      );
      const row = verifyRes.rows[0] as { checksum?: string } | undefined;
      assert.equal(row?.checksum, canonicalChecksum, "Checksum must match canonical value after restoration");
    }
  } finally {
    await pool.end();
  }
});

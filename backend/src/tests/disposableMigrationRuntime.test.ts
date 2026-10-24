import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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

async function verifyTwoRoleMigration(pool: Pool, databaseDir: string): Promise<void> {
  await pool.query("BEGIN");
  try {
    const operationsStaffId = randomUUID();
    const adminStaffId = randomUUID();
    const supportInviteId = randomUUID();
    const controlInviteId = randomUUID();
    const staffInviteRequestId = randomUUID();
    const roleChangeRequestId = randomUUID();
    const operationsSessionId = randomUUID();
    const adminSessionId = randomUUID();
    const adminMfaId = randomUUID();
    const now = new Date();
    const later = new Date(now.getTime() + 60 * 60 * 1000);

    await pool.query(
      "INSERT INTO staff_roles (code, display_name, description) VALUES ('SUPPORT','Legacy support','test'),('CONTROL','Legacy control','test') ON CONFLICT (code) DO NOTHING",
    );
    await pool.query(
      "INSERT INTO staff_users (id, employee_code, email_normalized, display_name, status) VALUES ($1,'ROLE-OPS-TEST','role-ops@example.test','Role Operations Test','ACTIVE'),($2,'ROLE-ADMIN-TEST','role-admin@example.test','Role Admin Test','ACTIVE')",
      [operationsStaffId, adminStaffId],
    );
    await pool.query(
      "INSERT INTO staff_role_permissions (role_code, permission_code) VALUES ('SUPPORT','account.block.request'),('CONTROL','simulation-funding.approve') ON CONFLICT DO NOTHING",
    );
    await pool.query(
      "INSERT INTO staff_user_roles (staff_id, role_code, environment_scope) VALUES ($1,'SUPPORT','preview'),($1,'OPERATIONS','preview'),($2,'CONTROL','preview'),($2,'ADMIN','preview')",
      [operationsStaffId, adminStaffId],
    );
    await pool.query(
      "INSERT INTO staff_invites (id,email_normalized,employee_code,display_name,role_code,token_hash,expires_at) VALUES ($1,'pending-operations@example.test','PENDING-OPS','Pending Operations','SUPPORT',$2,$4),($3,'pending-admin@example.test','PENDING-ADMIN','Pending Admin','CONTROL',$5,$4)",
      [supportInviteId, createHash("sha256").update("synthetic-support-invite").digest("hex"), controlInviteId, later, createHash("sha256").update("synthetic-control-invite").digest("hex")],
    );
    await pool.query(
      "INSERT INTO admin_action_requests (id,action_type,requester_staff_id,target_type,target_id,request_fingerprint,policy_version,idempotency_key,expires_at,payload) VALUES ($1,'STAFF_INVITE',$2,'STAFF_INVITE','synthetic-invite','invite-fingerprint-preserved','admin-p0-v1','role-migration-invite-test',$4,'{\"role\":\"SUPPORT\"}'::jsonb),($3,'STAFF_ROLE_CHANGE',$2,'STAFF','synthetic-staff','role-fingerprint-preserved','admin-p0-v1','role-migration-change-test',$4,'{\"roleCode\":\"CONTROL\"}'::jsonb)",
      [staffInviteRequestId, operationsStaffId, roleChangeRequestId, later],
    );
    await pool.query(
      "INSERT INTO staff_invite_requests (request_id,email_normalized,employee_code,display_name,role_code,reason_code) VALUES ($1,'pending-request@example.test','PENDING-REQUEST','Pending Request','SUPPORT','ROLE_MIGRATION_TEST')",
      [staffInviteRequestId],
    );
    await pool.query(
      "INSERT INTO staff_role_change_requests (request_id,staff_id,role_code,operation,environment_scope,reason_code) VALUES ($1,$2,'CONTROL','GRANT','preview','ROLE_MIGRATION_TEST')",
      [roleChangeRequestId, adminStaffId],
    );
    await pool.query(
      "INSERT INTO staff_sessions (id,staff_id,access_token_hash,refresh_token_hash,family_id,authorization_version,idle_expires_at,absolute_expires_at,csrf_token_hash) VALUES ($1,$2,'synthetic-access-ops','synthetic-refresh-ops',$3,1,$5,$5,'synthetic-csrf-ops'),($4,$6,'synthetic-access-admin','synthetic-refresh-admin',$7,1,$5,$5,'synthetic-csrf-admin')",
      [operationsSessionId, operationsStaffId, randomUUID(), adminSessionId, later, adminStaffId, randomUUID()],
    );
    await pool.query(
      "INSERT INTO staff_mfa_credentials (id,staff_id,secret_ciphertext,encryption_key_id) VALUES ($1,$2,'synthetic-encrypted-mfa-placeholder','synthetic-test-key')",
      [adminMfaId, adminStaffId],
    );

    const migration = await readFile(path.join(databaseDir, "041_admin_two_roles.sql"), "utf8");
    await pool.query(migration);

    const roles = await pool.query("SELECT code FROM staff_roles ORDER BY code");
    assert.deepEqual(roles.rows.map((row) => row.code), ["ADMIN", "OPERATIONS"]);
    const assignments = await pool.query("SELECT staff_id, role_code FROM staff_user_roles WHERE staff_id = ANY($1::uuid[]) ORDER BY staff_id, role_code", [[operationsStaffId, adminStaffId]]);
    assert.deepEqual(new Set(assignments.rows.map((row) => `${String(row.staff_id)}:${row.role_code}`)), new Set([`${operationsStaffId}:OPERATIONS`, `${adminStaffId}:ADMIN`]));
    const permissions = await pool.query("SELECT role_code, permission_code FROM staff_role_permissions WHERE (role_code, permission_code) IN (('OPERATIONS','account.block.request'),('ADMIN','simulation-funding.approve')) ORDER BY role_code");
    assert.deepEqual(permissions.rows.map((row) => [row.role_code, row.permission_code]), [["ADMIN", "simulation-funding.approve"], ["OPERATIONS", "account.block.request"]]);
    const invitations = await pool.query("SELECT role_code FROM staff_invites WHERE id = ANY($1::uuid[]) ORDER BY role_code", [[supportInviteId, controlInviteId]]);
    assert.deepEqual(invitations.rows.map((row) => row.role_code), ["ADMIN", "OPERATIONS"]);
    const typedRequests = await pool.query("SELECT role_code FROM staff_invite_requests WHERE request_id=$1 UNION ALL SELECT role_code FROM staff_role_change_requests WHERE request_id=$2", [staffInviteRequestId, roleChangeRequestId]);
    assert.deepEqual(new Set(typedRequests.rows.map((row) => row.role_code)), new Set(["ADMIN", "OPERATIONS"]));
    const pendingActions = await pool.query("SELECT request_fingerprint, payload->>'role' AS role, payload->>'roleCode' AS role_code FROM admin_action_requests WHERE id = ANY($1::uuid[]) ORDER BY id", [[staffInviteRequestId, roleChangeRequestId]]);
    assert.deepEqual(new Set(pendingActions.rows.map((row) => row.request_fingerprint)), new Set(["invite-fingerprint-preserved", "role-fingerprint-preserved"]));
    assert.deepEqual(new Set(pendingActions.rows.map((row) => row.role ?? row.role_code)), new Set(["SUPPORT", "CONTROL"]));
    const sessions = await pool.query("SELECT revoked_at, revoked_reason FROM staff_sessions WHERE id = ANY($1::uuid[])", [[operationsSessionId, adminSessionId]]);
    assert.equal(sessions.rowCount, 2);
    assert.ok(sessions.rows.every((row) => row.revoked_at && row.revoked_reason === "ADMIN_ROLE_MODEL_MIGRATED"));
    const preserved = await pool.query("SELECT (SELECT COUNT(*)::int FROM staff_mfa_credentials WHERE id=$1) AS mfa_count, (SELECT MIN(authorization_version)::int FROM staff_users WHERE id = ANY($2::uuid[])) AS authorization_version", [adminMfaId, [operationsStaffId, adminStaffId]]);
    assert.equal(preserved.rows[0]?.mfa_count, 1);
    assert.equal(preserved.rows[0]?.authorization_version, 2);

    await pool.query(
      "INSERT INTO staff_permissions (code, description) VALUES ('staff.invite.request','legacy request'),('staff.invite.approve','legacy approval') ON CONFLICT (code) DO NOTHING",
    );
    await pool.query(
      "INSERT INTO staff_role_permissions (role_code, permission_code) VALUES ('ADMIN','staff.invite.request'),('ADMIN','staff.invite.approve') ON CONFLICT DO NOTHING",
    );
    await pool.query(
      "UPDATE admin_action_policies SET required_permission='staff.invite.approve', enabled=true WHERE action_type='STAFF_INVITE'",
    );
    const retirementMigration = await readFile(path.join(databaseDir, "043_retire_staff_invite_approval.sql"), "utf8");
    await pool.query(retirementMigration);

    const retiredPermissions = await pool.query("SELECT COUNT(*)::int AS count FROM staff_permissions WHERE code IN ('staff.invite.request','staff.invite.approve')");
    assert.equal(retiredPermissions.rows[0]?.count, 0);
    const directCreationPermission = await pool.query("SELECT COUNT(*)::int AS count FROM staff_role_permissions WHERE role_code='ADMIN' AND permission_code='staff.operations-account.create'");
    assert.equal(directCreationPermission.rows[0]?.count, 1);
    const retiredPolicy = await pool.query("SELECT enabled, required_permission FROM admin_action_policies WHERE action_type='STAFF_INVITE'");
    assert.deepEqual(retiredPolicy.rows[0], { enabled: false, required_permission: "staff.operations-account.create" });
    const retainedInviteHistory = await pool.query(
      "SELECT (SELECT COUNT(*)::int FROM admin_action_requests WHERE id=$1 AND action_type='STAFF_INVITE' AND request_fingerprint='invite-fingerprint-preserved') AS action_count, (SELECT COUNT(*)::int FROM staff_invite_requests WHERE request_id=$1) AS detail_count",
      [staffInviteRequestId],
    );
    assert.deepEqual(retainedInviteHistory.rows[0], { action_count: 1, detail_count: 1 });
  } finally {
    await pool.query("ROLLBACK");
  }
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
      await verifyTwoRoleMigration(pool, databaseDir);
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

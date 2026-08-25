const { readdir, readFile } = require("node:fs/promises");
const { createHash } = require("node:crypto");
const path = require("node:path");
const { Pool } = require("pg");
const { resolvePostgresSsl } = require("./postgres-ssl.cjs");

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to apply the draft PostgreSQL migrations.");
}

function option(name, fallback = undefined) {
  const prefix = `--${name}`;
  const inline = process.argv.find((value) => value.startsWith(`${prefix}=`));
  if (inline) return inline.slice(prefix.length + 1).trim();
  const index = process.argv.indexOf(prefix);
  if (index >= 0) return process.argv[index + 1]?.trim() || fallback;
  return fallback;
}

const mode = process.argv.includes("--plan")
  ? "plan"
  : process.argv.includes("--verify-only")
    ? "verify-only"
    : "apply";
const target = option("target");
const releaseId = option("release-id", process.env.RELEASE_ID?.trim() || "local");
const commitSha = option("commit-sha", process.env.BUILD_COMMIT_SHA?.trim() || "local");
const imageDigest = option("image-digest", process.env.IMAGE_DIGEST?.trim() || "unknown");
const executionId = option("execution-id", require("node:crypto").randomUUID());
const statementTimeoutMs = Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 15_000);
const lockTimeoutMs = Number(process.env.DB_LOCK_TIMEOUT_MS ?? 3_000);

const databaseDirectory = path.resolve(__dirname, "../database");
const requiredTablesByMigration = {
  "001_banking_mvp": [
    "customers",
    "customer_devices",
    "auth_sessions",
    "payment_accounts",
    "beneficiaries",
    "transfer_quotes",
    "transfers",
    "account_transactions",
    "ledger_journals",
    "ledger_entries",
    "audit_events",
    "outbox_events",
    "reference_state_snapshots",
    "notifications",
    "fraud_reports",
    "control_policy",
  ],
  "002_savings_sandbox": [
    "savings_products",
    "savings_quotes",
    "savings_openings",
    "savings_deposits",
  ],
  "003_credit_sandbox": [
    "credit_accounts",
    "credit_cards",
    "credit_transactions",
    "credit_statements",
    "credit_statement_items",
    "credit_payment_quotes",
    "credit_payments",
  ],
  "005_relational_reference_runtime": ["reference_runtime_records"],
  "006_relational_v2_foundation": ["command_idempotency"],
  "007_identity_runtime_normalization": [
    "refresh_session_families",
    "refresh_session_records",
    "auth_challenges",
    "pending_registrations",
    "rate_limit_buckets",
  ],
  "009_savings_relational_v2": ["savings_idempotency", "savings_maturity_operations"],
  "010_credit_relational_v2": ["credit_idempotency"],
  "011_registration_recovery": ["registration_completions"],
  "012_outbox_worker": [
    "notification_endpoints",
    "notification_preferences",
    "notification_deliveries",
    "dead_letter_events",
    "worker_instances",
  ],
  "013_outbox_worker_operations": [],
  "014_mfa_credentials": ["mfa_credentials"],
  "015_auth_challenge_hardening": [],
  "016_mfa_recovery": ["mfa_recovery_codes", "mfa_recovery_requests"],
  "017_auth_security_events": ["auth_security_events"],
  "018_mfa_challenge_constraints": [],
  "019_admin_control_plane": [
    "staff_users",
    "staff_roles",
    "staff_permissions",
    "staff_role_permissions",
    "staff_user_roles",
    "staff_sessions",
    "staff_mfa_credentials",
    "staff_invites",
    "staff_auth_challenges",
    "admin_action_policies",
    "admin_action_requests",
    "admin_action_decisions",
    "admin_action_execution_attempts",
    "account_status_change_requests",
    "customer_access_change_requests",
    "simulation_funding_requests",
    "application_decision_requests",
    "transfer_operation_requests",
    "fraud_resolution_requests",
    "outbox_requeue_requests",
    "job_retry_requests",
    "staff_role_change_requests",
    "account_status_history",
    "customer_access_status_history",
    "background_jobs",
    "background_job_attempts",
    "job_retry_history",
  ],
  "020_admin_case_operations": [
    "kyc_applications",
    "kyc_application_documents",
    "kyc_reviews",
    "credit_applications",
    "case_assignments",
    "case_internal_notes",
    "fraud_case_actions",
  ],
  "021_admin_bootstrap_guard": ["admin_bootstrap_state"],
  "022_admin_policy_alignment": [],
  "023_admin_roles_rls_and_domain_adapters": [
    "staff_invite_requests",
    "simulation_funding_reversals",
  ],
  "024_admin_staff_invite_workflow": [],
  "025_admin_case_scope_alignment": [],
  "026_secret_envelope_metadata": ["encryption_rekey_checkpoints"],
  "027_secret_rotation_inventory": [],
  "028_dr_recovery_markers": ["dr_recovery_markers"],
};

async function main() {
  const migrationFiles = (await readdir(databaseDirectory))
    .filter((fileName) => /^\d+_.+\.sql$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  if (target) {
    const targetFile = `${target.replace(/\.sql$/i, "")}.sql`;
    const targetIndex = migrationFiles.indexOf(targetFile);
    if (targetIndex < 0) throw new Error(`Unknown migration target: ${target}`);
    migrationFiles.splice(targetIndex + 1);
  }
  const migrations = await Promise.all(migrationFiles.map(async (fileName) => {
    const sql = await readFile(path.join(databaseDirectory, fileName), "utf8");
    return { fileName, migrationKey: fileName.replace(/\.sql$/i, ""), sql, checksum: createHash("sha256").update(sql).digest("hex") };
  }));
  const migrationSetDigest = createHash("sha256");
  for (const migration of migrations) migrationSetDigest.update(`${migration.fileName}\0${migration.sql}\0`);
  const migrationSetFingerprint = migrationSetDigest.digest("hex");
  const pool = new Pool({ connectionString: databaseUrl, ssl: resolvePostgresSsl() });

  try {
    await pool.query("SELECT set_config('statement_timeout', $1, false), set_config('lock_timeout', $2, false)", [`${statementTimeoutMs}ms`, `${lockTimeoutMs}ms`]);
    const table = await pool.query("SELECT to_regclass('public.reference_schema_migrations') AS table_name");
    const tableExists = Boolean(table.rows[0]?.table_name);
    if (mode === "verify-only" && !tableExists) {
      throw new Error("reference_schema_migrations is missing; run the migration job first.");
    }
    if (mode === "plan" && !tableExists) {
      console.log(JSON.stringify({ mode, target: target ?? null, executionId, releaseId, commitSha, imageDigest, migrationSetDigest: migrationSetFingerprint, pending: migrations.map((migration) => migration.migrationKey), checksumMismatches: [] }, null, 2));
      return;
    }
    if (!tableExists) {
      await pool.query(`
        CREATE TABLE reference_schema_migrations (
          migration_key text PRIMARY KEY,
          applied_at timestamptz NOT NULL,
          started_at timestamptz,
          finished_at timestamptz,
          checksum text,
          execution_id text,
          release_id text,
          commit_sha text,
          image_digest text,
          duration_ms integer,
          status text NOT NULL DEFAULT 'APPLIED'
        )
      `);
    }
    if (mode !== "plan" && mode !== "verify-only") {
      for (const column of [
        "checksum text",
        "started_at timestamptz",
        "finished_at timestamptz",
        "execution_id text",
        "release_id text",
        "commit_sha text",
        "image_digest text",
        "duration_ms integer",
        "status text NOT NULL DEFAULT 'APPLIED'",
      ]) await pool.query(`ALTER TABLE reference_schema_migrations ADD COLUMN IF NOT EXISTS ${column}`);
    }
    if (mode === "plan" || mode === "verify-only") {
      const columns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reference_schema_migrations'");
      const availableColumns = new Set(columns.rows.map((row) => row.column_name));
      const requiredColumns = ["migration_key", "checksum", "status"];
      const missingColumns = requiredColumns.filter((column) => !availableColumns.has(column));
      if (missingColumns.length > 0) throw new Error(`reference_schema_migrations is missing required evidence columns: ${missingColumns.join(", ")}`);
    }

    const appliedRows = await pool.query("SELECT migration_key, checksum, status FROM reference_schema_migrations ORDER BY migration_key");
    const appliedByKey = new Map(appliedRows.rows.map((row) => [row.migration_key, row]));
    if (mode === "plan" || mode === "verify-only") {
      const pending = migrations.filter((migration) => !appliedByKey.has(migration.migrationKey)).map((migration) => migration.migrationKey);
      const checksumMismatches = migrations.filter((migration) => {
        const recorded = appliedByKey.get(migration.migrationKey)?.checksum;
        return recorded && recorded !== migration.checksum;
      }).map((migration) => migration.migrationKey);
      const result = { mode, target: target ?? null, executionId, releaseId, commitSha, imageDigest, migrationSetDigest: migrationSetFingerprint, pending, checksumMismatches };
      console.log(JSON.stringify(result, null, 2));
      if (checksumMismatches.length > 0) throw new Error(`Migration checksum mismatch: ${checksumMismatches.join(", ")}`);
      if (mode === "verify-only" && pending.length > 0) throw new Error(`Database has unapplied migrations: ${pending.join(", ")}`);
      return;
    }

    for (const migrationEntry of migrations) {
      const { migrationKey, sql: migration, checksum } = migrationEntry;
      const requiredTables = requiredTablesByMigration[migrationKey] ?? [];
      const startedAt = Date.now();

      await pool.query("BEGIN");
      try {
        await pool.query("SELECT pg_advisory_xact_lock(hashtext($1))", [migrationKey]);
        const applied = await pool.query(
          "SELECT checksum FROM reference_schema_migrations WHERE migration_key = $1",
          [migrationKey],
        );
        if (applied.rowCount) {
          const recordedChecksum = applied.rows[0]?.checksum;
          if (recordedChecksum && recordedChecksum !== checksum) {
            throw new Error(
              `Migration checksum mismatch for ${migrationKey}; refusing to run a modified applied migration.`,
            );
          }
          if (!recordedChecksum) {
            await pool.query(
              "UPDATE reference_schema_migrations SET checksum = $2, release_id = COALESCE(release_id, $3), commit_sha = COALESCE(commit_sha, $4), image_digest = COALESCE(image_digest, $5) WHERE migration_key = $1",
              [migrationKey, checksum, releaseId, commitSha, imageDigest],
            );
          }
          await pool.query("COMMIT");
          console.log(`PostgreSQL migration already applied: ${migrationKey} (${checksum.slice(0, 12)}).`);
          continue;
        }

        const existingTables = await pool.query(
          `
            SELECT COUNT(*)::int AS count
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
              AND table_name = ANY($1::text[])
          `,
          [requiredTables],
        );
        const existingTableCount = Number(existingTables.rows[0]?.count ?? 0);
        if (requiredTables.length > 0 && existingTableCount > 0) {
          throw new Error(
            `Migration ${migrationKey} is not recorded but ${existingTableCount}/${requiredTables.length} expected tables already exist. Refusing to guess migration state; restore a clean database or record the reviewed migration explicitly.`,
          );
        }

        await pool.query(migration);
        await pool.query(
          "INSERT INTO reference_schema_migrations (migration_key, applied_at, started_at, finished_at, checksum, execution_id, release_id, commit_sha, image_digest, duration_ms, status) VALUES ($1, NOW(), $2, NOW(), $3, $4, $5, $6, $7, $8, 'APPLIED')",
          [migrationKey, new Date(startedAt).toISOString(), checksum, executionId, releaseId, commitSha, imageDigest, Date.now() - startedAt],
        );
        await pool.query("COMMIT");
        console.log(`PostgreSQL migration applied successfully: ${migrationKey} (${checksum.slice(0, 12)}).`);
      } catch (error) {
        await pool.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

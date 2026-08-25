const fs = require("node:fs");
const path = require("node:path");
const { resolvePostgresSsl } = require("./postgres-ssl.cjs");

const schemaPath = path.resolve(__dirname, "../database/019_admin_control_plane.sql");
const schema = fs.readFileSync(schemaPath, "utf8");
const caseSchemaPath = path.resolve(__dirname, "../database/020_admin_case_operations.sql");
const caseSchema = fs.readFileSync(caseSchemaPath, "utf8");
const policySchemaPath = path.resolve(__dirname, "../database/022_admin_policy_alignment.sql");
const policySchema = fs.readFileSync(policySchemaPath, "utf8");
const hardeningSchemaPath = path.resolve(__dirname, "../database/023_admin_roles_rls_and_domain_adapters.sql");
const hardeningSchema = fs.readFileSync(hardeningSchemaPath, "utf8");
const invitePolicySchemaPath = path.resolve(__dirname, "../database/024_admin_staff_invite_workflow.sql");
const invitePolicySchema = fs.readFileSync(invitePolicySchemaPath, "utf8");
const scopeSchemaPath = path.resolve(__dirname, "../database/025_admin_case_scope_alignment.sql");
const scopeSchema = fs.readFileSync(scopeSchemaPath, "utf8");

if (/\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i.test(schema) || /\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i.test(caseSchema) || /\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i.test(policySchema) || /\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i.test(hardeningSchema) || /\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i.test(invitePolicySchema) || /\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i.test(scopeSchema)) {
  throw new Error("Admin migration must be additive and must not drop data.");
}

const requiredTables = [
  "staff_users", "staff_roles", "staff_permissions", "staff_role_permissions", "staff_user_roles",
  "staff_sessions", "staff_mfa_credentials", "staff_invites", "staff_auth_challenges",
  "admin_action_policies", "admin_action_requests", "admin_action_decisions", "admin_action_execution_attempts",
  "account_status_change_requests", "customer_access_change_requests", "simulation_funding_requests",
  "application_decision_requests", "transfer_operation_requests", "fraud_resolution_requests",
  "outbox_requeue_requests", "job_retry_requests", "staff_role_change_requests", "account_status_history",
  "customer_access_status_history", "background_jobs", "background_job_attempts", "job_retry_history",
  "kyc_applications", "kyc_application_documents", "kyc_reviews", "credit_applications",
  "case_assignments", "case_internal_notes", "fraud_case_actions",
  "admin_bootstrap_state",
  "staff_invite_requests", "simulation_funding_reversals",
];

for (const table of requiredTables) {
  const source = table === "staff_invite_requests" || table === "simulation_funding_reversals"
    ? hardeningSchema
    : table.startsWith("kyc_") || table === "credit_applications" || table.startsWith("case_") || table === "fraud_case_actions" || table === "admin_bootstrap_state" ? (table === "admin_bootstrap_state" ? fs.readFileSync(path.resolve(__dirname, "../database/021_admin_bootstrap_guard.sql"), "utf8") : caseSchema) : schema;
  if (!new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\b`, "i").test(source)) {
    throw new Error(`Admin schema is missing table ${table}.`);
  }
}

for (const marker of [
  /UNIQUE\s*\(\s*requester_staff_id\s*,\s*idempotency_key\s*\)/i,
  /UNIQUE\s*\(\s*request_id\s*\)/i,
  /requester_staff_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+staff_users/i,
  /reviewer_staff_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+staff_users/i,
  /secret_ciphertext\s+text\s+NOT\s+NULL/i,
  /last_accepted_time_step\s+bigint/i,
  /ALTER\s+TABLE\s+audit_events[\s\S]*ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+actor_staff_id/i,
  /INSERT\s+INTO\s+staff_roles[\s\S]*SUPPORT[\s\S]*OPERATIONS[\s\S]*CONTROL[\s\S]*ADMIN/i,
  /INSERT\s+INTO\s+staff_permissions[\s\S]*customer\.read\.masked/i,
  /ALTER\s+TABLE\s+customers[\s\S]*access_status[\s\S]*access_version/i,
]) {
  if (!marker.test(schema)) {
    throw new Error(`Admin schema invariant missing: ${marker}`);
  }
}

for (const marker of [
  /customer\.access-unlock\.request/i,
  /UPDATE\s+admin_action_policies[\s\S]*CUSTOMER_ACCESS_UNLOCK/i,
]) {
  if (!marker.test(policySchema)) throw new Error(`Admin policy alignment invariant missing: ${marker}`);
}

for (const marker of [
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+reject_audit_mutation/i,
  /BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+audit_events/i,
  /PENDING_ACTIVATION/i,
]) {
  if (!marker.test(caseSchema)) {
    throw new Error(`Admin case schema invariant missing: ${marker}`);
  }
}

for (const marker of [
  /CREATE\s+ROLE\s+banking_public_api/i,
  /CREATE\s+ROLE\s+banking_admin_api/i,
  /CREATE\s+ROLE\s+banking_worker/i,
  /CREATE\s+ROLE\s+banking_audit_reader/i,
  /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
  /CREATE\s+POLICY\s+credit_case_scope/i,
  /REVOKE\s+UPDATE,\s*DELETE\s+ON\s+audit_events/i,
]) {
  if (!marker.test(hardeningSchema)) throw new Error(`Admin database hardening invariant missing: ${marker}`);
}

for (const marker of [
  /staff\.invite\.approve/i,
  /STAFF_INVITE/i,
  /staff_role_permissions/i,
]) {
  if (!marker.test(invitePolicySchema)) throw new Error(`Admin staff invite workflow invariant missing: ${marker}`);
}

for (const marker of [
  /DROP\s+POLICY\s+IF\s+EXISTS\s+kyc_case_scope/i,
  /assigned_staff_id\s+IS\s+NULL[\s\S]*SUPPORT/i,
  /case_internal_notes\.case_type/i,
]) {
  if (!marker.test(scopeSchema)) throw new Error(`Admin case ABAC invariant missing: ${marker}`);
}

async function validateLiveDatabase() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.log(`Admin schema source contract valid: ${requiredTables.length} tables and four-eyes/audit invariants verified (live DB skipped; DATABASE_URL is not set).`);
    return;
  }
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl, max: 1, ssl: resolvePostgresSsl() });
  try {
    const result = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         AND table_name = ANY($1::text[])`,
      [requiredTables],
    );
    const found = new Set(result.rows.map((row) => row.table_name));
    for (const table of requiredTables) {
      if (!found.has(table)) throw new Error(`Live database is missing Admin table ${table}; run npm run db:migrate.`);
    }
    const roleCount = await pool.query("SELECT COUNT(*)::int AS count FROM staff_roles WHERE code IN ('SUPPORT','OPERATIONS','CONTROL','ADMIN')");
    if (Number(roleCount.rows[0]?.count ?? 0) !== 4) throw new Error("Live database is missing one or more fixed staff roles.");
    const customerColumns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' AND column_name IN ('access_status','access_version')");
    if (customerColumns.rows.length !== 2) throw new Error("Live database is missing customer access lock columns.");
    const trigger = await pool.query("SELECT 1 FROM pg_trigger WHERE tgname='audit_events_append_only' AND NOT tgisinternal");
    if (trigger.rowCount !== 1) throw new Error("Live database is missing audit append-only trigger; run npm run db:migrate.");
    const unlockPermission = await pool.query("SELECT 1 FROM staff_permissions WHERE code='customer.access-unlock.request'");
    if (unlockPermission.rowCount !== 1) throw new Error("Live database is missing customer access-unlock permission; run npm run db:migrate.");
    const roles = await pool.query("SELECT COUNT(*)::int AS count FROM pg_roles WHERE rolname IN ('banking_migration','banking_public_api','banking_admin_api','banking_worker','banking_audit_reader')");
    if (Number(roles.rows[0]?.count ?? 0) !== 5) throw new Error("Live database is missing separated Admin/API/worker roles; provision roles and run npm run db:migrate.");
    const rls = await pool.query("SELECT COUNT(*)::int AS count FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('kyc_applications','credit_applications','case_assignments','case_internal_notes','admin_action_requests') AND relrowsecurity");
    if (Number(rls.rows[0]?.count ?? 0) !== 5) throw new Error("Live database is missing case/action RLS; run npm run db:migrate.");
    const invitePermission = await pool.query("SELECT 1 FROM staff_permissions WHERE code='staff.invite.approve'");
    if (invitePermission.rowCount !== 1) throw new Error("Live database is missing staff invite approval permission; run npm run db:migrate.");
    const invitePolicy = await pool.query("SELECT 1 FROM admin_action_policies WHERE action_type='STAFF_INVITE' AND required_permission='staff.invite.approve' AND enabled=true");
    if (invitePolicy.rowCount !== 1) throw new Error("Live database is missing STAFF_INVITE action policy; run npm run db:migrate.");
    console.log(`Admin schema contract valid: ${requiredTables.length} tables, fixed role seed, separated DB roles, case RLS and staff invite policy verified against PostgreSQL.`);
  } finally {
    await pool.end();
  }
}

validateLiveDatabase().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

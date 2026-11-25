const fs = require("node:fs");
const path = require("node:path");
const { resolvePostgresSsl } = require("./postgres-ssl.cjs");

const schemaPath = path.resolve(__dirname, "../database/001_banking_mvp.sql");
const schema = fs.readFileSync(schemaPath, "utf8");
const savingsSchemaPath = path.resolve(__dirname, "../database/002_savings_sandbox.sql");
const savingsSchema = fs.readFileSync(savingsSchemaPath, "utf8");
const creditSchemaPath = path.resolve(__dirname, "../database/003_credit_sandbox.sql");
const creditSchema = fs.readFileSync(creditSchemaPath, "utf8");
const runtimeSchemaPath = path.resolve(__dirname, "../database/005_relational_reference_runtime.sql");
const runtimeSchema = fs.readFileSync(runtimeSchemaPath, "utf8");
const v2SchemaPath = path.resolve(__dirname, "../database/006_relational_v2_foundation.sql");
const v2Schema = fs.readFileSync(v2SchemaPath, "utf8");
const identityV2Schema = fs.readFileSync(
  path.resolve(__dirname, "../database/007_identity_runtime_normalization.sql"),
  "utf8",
);
const transferV2Schema = fs.readFileSync(
  path.resolve(__dirname, "../database/008_transfer_relational_v2.sql"),
  "utf8",
);
const savingsV2Schema = fs.readFileSync(
  path.resolve(__dirname, "../database/009_savings_relational_v2.sql"),
  "utf8",
);
const creditV2Schema = fs.readFileSync(
  path.resolve(__dirname, "../database/010_credit_relational_v2.sql"),
  "utf8",
);
const registrationSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/011_registration_recovery.sql"),
  "utf8",
);
const outboxWorkerSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/012_outbox_worker.sql"),
  "utf8",
);
const outboxWorkerOperationsSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/013_outbox_worker_operations.sql"),
  "utf8",
);
const mfaCredentialsSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/014_mfa_credentials.sql"),
  "utf8",
);
const mfaChallengeHardeningSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/015_auth_challenge_hardening.sql"),
  "utf8",
);
const mfaRecoverySchema = fs.readFileSync(
  path.resolve(__dirname, "../database/016_mfa_recovery.sql"),
  "utf8",
);
const authSecurityEventsSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/017_auth_security_events.sql"),
  "utf8",
);
const mfaConstraintSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/018_mfa_challenge_constraints.sql"),
  "utf8",
);
const secretMetadataSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/026_secret_envelope_metadata.sql"),
  "utf8",
);
const secretRotationSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/027_secret_rotation_inventory.sql"),
  "utf8",
);
const drRecoverySchema = fs.readFileSync(
  path.resolve(__dirname, "../database/028_dr_recovery_markers.sql"),
  "utf8",
);
const controlPolicyBootstrapSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/033_control_policy_bootstrap.sql"),
  "utf8",
);
const policyEntitlementsSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/034_policy_entitlements_login_rate_limit.sql"),
  "utf8",
);
const creditCycleSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/035_credit_cycle_start.sql"),
  "utf8",
);
const beneficiaryLifecycleSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/036_beneficiary_lifecycle.sql"),
  "utf8",
);
const transferSnapshotSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/037_transfer_counterparty_snapshots.sql"),
  "utf8",
);
const kycRuntimeSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/038_customer_kyc_runtime.sql"),
  "utf8",
);
const lifecycleHardeningSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/039_lifecycle_suspense_and_keyset_indexes.sql"),
  "utf8",
);
const operationsSafetySchema = fs.readFileSync(
  path.resolve(__dirname, "../database/040_card_security_and_suspense_retry.sql"),
  "utf8",
);
const anomalyDetectionSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/045_transaction_anomaly_detection.sql"),
  "utf8",
);
const biometricAuthSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/046_biometric_authentication.sql"),
  "utf8",
);
const normalizeLedgerRefsSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/047_normalize_ledger_account_refs.sql"),
  "utf8",
);
const dailyTransferLimitSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/048_daily_transfer_limit_policy.sql"),
  "utf8",
);
const interbankHeldFundsSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/049_interbank_transfers_and_held_funds.sql"),
  "utf8",
);
const passwordResetDevicesSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/050_password_reset_and_device_metadata.sql"),
  "utf8",
);
const dynamicTransferFeeSchema = fs.readFileSync(
  path.resolve(__dirname, "../database/051_dynamic_transfer_fee_policy.sql"),
  "utf8",
);
const secretSchema = `${secretMetadataSchema}\n${secretRotationSchema}`;
const businessHardeningSchema = [
  policyEntitlementsSchema,
  creditCycleSchema,
  beneficiaryLifecycleSchema,
  transferSnapshotSchema,
  kycRuntimeSchema,
  lifecycleHardeningSchema,
  operationsSafetySchema,
  anomalyDetectionSchema,
  biometricAuthSchema,
  normalizeLedgerRefsSchema,
  dailyTransferLimitSchema,
  interbankHeldFundsSchema,
  passwordResetDevicesSchema,
  dynamicTransferFeeSchema,
].join("\n");

const requiredTables = [
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
];
const savingsTables = [
  "savings_products",
  "savings_quotes",
  "savings_deposits",
  "savings_openings",
];
const creditTables = [
  "credit_accounts",
  "credit_cards",
  "credit_transactions",
  "credit_statements",
  "credit_statement_items",
  "credit_payment_quotes",
  "credit_payments",
];
const runtimeTables = ["reference_runtime_records"];
const v2Tables = ["command_idempotency"];
const identityV2Tables = [
  "refresh_session_families",
  "refresh_session_records",
  "auth_challenges",
  "pending_registrations",
  "rate_limit_buckets",
];
const savingsV2Tables = ["savings_idempotency", "savings_maturity_operations"];
const creditV2Tables = ["credit_idempotency"];
const registrationTables = ["registration_completions"];
const outboxWorkerTables = [
  "notification_endpoints",
  "notification_preferences",
  "notification_deliveries",
  "dead_letter_events",
  "worker_instances",
];
const mfaTables = ["mfa_credentials", "mfa_recovery_codes", "mfa_recovery_requests", "auth_security_events"];
const secretMetadataTables = ["encryption_rekey_checkpoints"];
const drRecoveryTables = ["dr_recovery_markers"];
const businessHardeningTables = [
  "customer_feature_entitlements",
  "savings_maturity_suspense",
  "card_security_cases",
  "transaction_anomalies",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tableBlock(source, tableName) {
  const tablePattern = new RegExp(
    `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${escapeRegExp(tableName)}\\s*\\(([\\s\\S]*?)\\n\\);`,
    "i",
  );
  const match = source.match(tablePattern);
  if (!match) {
    throw new Error(`Missing CREATE TABLE definition: ${tableName}`);
  }
  return match[1];
}

const tableBlocks = new Map(
  requiredTables.map((tableName) => [tableName, tableBlock(schema, tableName)]),
);
const savingsTableBlocks = new Map(
  savingsTables.map((tableName) => [tableName, tableBlock(savingsSchema, tableName)]),
);
const creditTableBlocks = new Map(
  creditTables.map((tableName) => [tableName, tableBlock(creditSchema, tableName)]),
);
const runtimeTableBlocks = new Map(
  runtimeTables.map((tableName) => [tableName, tableBlock(runtimeSchema, tableName)]),
);
const v2TableBlocks = new Map(
  v2Tables.map((tableName) => [tableName, tableBlock(v2Schema, tableName)]),
);
const identityV2TableBlocks = new Map(
  identityV2Tables.map((tableName) => [tableName, tableBlock(identityV2Schema, tableName)]),
);
const savingsV2TableBlocks = new Map(
  savingsV2Tables.map((tableName) => [tableName, tableBlock(savingsV2Schema, tableName)]),
);
const creditV2TableBlocks = new Map(
  creditV2Tables.map((tableName) => [tableName, tableBlock(creditV2Schema, tableName)]),
);
const registrationTableBlocks = new Map(
  registrationTables.map((tableName) => [tableName, tableBlock(registrationSchema, tableName)]),
);
const outboxWorkerTableBlocks = new Map(
  outboxWorkerTables.map((tableName) => [tableName, tableBlock(outboxWorkerSchema, tableName)]),
);
const mfaCredentialBlock = tableBlock(mfaCredentialsSchema, "mfa_credentials");
const mfaRecoveryCodeBlock = tableBlock(mfaRecoverySchema, "mfa_recovery_codes");
const mfaRecoveryRequestBlock = tableBlock(mfaRecoverySchema, "mfa_recovery_requests");
const authSecurityEventBlock = tableBlock(authSecurityEventsSchema, "auth_security_events");
const rekeyCheckpointBlock = tableBlock(secretMetadataSchema, "encryption_rekey_checkpoints");
const businessHardeningTableBlocks = new Map([
  ["customer_feature_entitlements", tableBlock(policyEntitlementsSchema, "customer_feature_entitlements")],
  ["savings_maturity_suspense", tableBlock(lifecycleHardeningSchema, "savings_maturity_suspense")],
  ["card_security_cases", tableBlock(operationsSafetySchema, "card_security_cases")],
  ["transaction_anomalies", tableBlock(anomalyDetectionSchema, "transaction_anomalies")],
]);

function requireColumn(tableName, columnName, definitionPattern) {
  const block = tableBlocks.get(tableName);
  const columnPattern = new RegExp(
    `^\\s*${escapeRegExp(columnName)}\\s+([^,\\n]+)`,
    "mi",
  );
  const match = block.match(columnPattern);
  if (!match || !definitionPattern.test(match[1])) {
    throw new Error(
      `Column ${tableName}.${columnName} does not match the required definition.`,
    );
  }
}

for (const tableName of [
  "customers",
  "customer_devices",
  "auth_sessions",
  "payment_accounts",
  "beneficiaries",
  "transfer_quotes",
  "transfers",
  "account_transactions",
  "ledger_journals",
  "audit_events",
  "outbox_events",
  "notifications",
  "fraud_reports",
]) {
  requireColumn(tableName, "id", /\buuid\s+PRIMARY\s+KEY\b/i);
}

for (const [tableName, columnName, pattern] of [
  ["transfer_quotes", "consumed_at", /\btimestamptz\b/i],
  ["payment_accounts", "available_minor", /\bbigint\b/i],
  ["beneficiaries", "account_number_fingerprint", /\btext\b.*\bNOT\s+NULL\b/i],
  ["transfers", "quote_id", /\buuid\b.*\bREFERENCES\s+transfer_quotes\b/i],
  ["transfers", "idempotency_key", /\btext\b.*\bNOT\s+NULL\b/i],
  ["transfers", "status", /\btext\b.*\bNOT\s+NULL\b/i],
  ["account_transactions", "amount_minor", /\bbigint\b.*\bNOT\s+NULL\b/i],
  ["ledger_entries", "amount_minor", /\bbigint\b.*\bNOT\s+NULL\b/i],
  ["outbox_events", "published_at", /\btimestamptz\b/i],
  ["outbox_events", "next_attempt_at", /\btimestamptz\b/i],
  ["notifications", "resource_account_id", /\buuid\b.*\bREFERENCES\s+payment_accounts\b/i],
]) {
  requireColumn(tableName, columnName, pattern);
}
for (const [label, pattern] of [
  ["MFA envelope metadata", /ALTER\s+TABLE\s+mfa_credentials[\s\S]*secret_cipher_version[\s\S]*secret_encrypted_data_key/i],
  ["notification envelope metadata", /ALTER\s+TABLE\s+notification_endpoints[\s\S]*address_cipher_version[\s\S]*address_encrypted_data_key/i],
  ["staff envelope metadata", /ALTER\s+TABLE\s+staff_mfa_credentials[\s\S]*secret_cipher_version[\s\S]*secret_encrypted_data_key/i],
  ["rekey checkpoint table", /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+encryption_rekey_checkpoints/i],
  ["rekey checkpoint status constraint", /status\s+text\s+NOT\s+NULL[\s\S]*CHECK\s*\(status\s+IN\s*\('PREPARED'/i],
]) {
  if (!pattern.test(secretSchema)) {
    throw new Error(`Missing secret envelope invariant: ${label}`);
  }
}
for (const [columnName, pattern] of [
  ["job_id", /text\s+PRIMARY\s+KEY/i],
  ["last_record_id", /uuid/i],
  ["failed_count", /bigint\s+NOT\s+NULL/i],
]) {
  const columnPattern = new RegExp(`^\\s*${escapeRegExp(columnName)}\\s+([^,\\n]+)`, "mi");
  const match = rekeyCheckpointBlock.match(columnPattern);
  if (!match || !pattern.test(match[1])) throw new Error(`Column encryption_rekey_checkpoints.${columnName} is invalid.`);
}

for (const [label, pattern] of [
  ["transfer idempotency uniqueness", /UNIQUE\s*\(\s*customer_id\s*,\s*idempotency_key\s*\)/i],
  ["quote one-time uniqueness", /UNIQUE\s*\(\s*quote_id\s*\)/i],
  ["beneficiary identity index", /CREATE\s+UNIQUE\s+INDEX\s+beneficiaries_identity_idx/i],
  ["ledger deferred balance trigger", /CREATE\s+CONSTRAINT\s+TRIGGER\s+ledger_journal_balanced[\s\S]*?DEFERRABLE\s+INITIALLY\s+DEFERRED/i],
  ["outbox table", /CREATE\s+TABLE\s+outbox_events/i],
]) {
  if (!pattern.test(schema)) {
    throw new Error(`Missing database invariant: ${label}`);
  }
}
for (const [label, pattern] of [
  ["MFA challenge method not-null follow-up", /ALTER\s+COLUMN\s+method\s+SET\s+NOT\s+NULL/i],
  ["MFA challenge purpose allow-list", /auth_challenges_purpose_ck/i],
  ["MFA challenge credential binding", /auth_challenges_method_credential_ck/i],
]) {
  if (!pattern.test(mfaConstraintSchema)) {
    throw new Error(`Missing MFA follow-up invariant: ${label}`);
  }
}

for (const [tableName, block] of [
  ["mfa_credentials", mfaCredentialBlock],
  ["mfa_recovery_codes", mfaRecoveryCodeBlock],
  ["mfa_recovery_requests", mfaRecoveryRequestBlock],
  ["auth_security_events", authSecurityEventBlock],
]) {
  if (!/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i.test(
    tableName === "mfa_credentials" ? mfaCredentialsSchema :
      tableName === "auth_security_events" ? authSecurityEventsSchema : mfaRecoverySchema,
  )) {
    throw new Error(`MFA table ${tableName} must be additive and rerunnable.`);
  }
  if (!/\bid\s+uuid\s+PRIMARY\s+KEY/i.test(block)) {
    throw new Error(`MFA table ${tableName}.id must use PostgreSQL uuid.`);
  }
}
for (const [tableName, columnName, pattern] of [
  ["mfa_credentials", "customer_id", /uuid\s+NOT\s+NULL\s+REFERENCES\s+customers/i],
  ["mfa_credentials", "secret_ciphertext", /text/i],
  ["mfa_credentials", "secret_key_id", /text/i],
  ["mfa_credentials", "last_accepted_time_step", /bigint/i],
  ["mfa_recovery_codes", "code_digest", /text\s+NOT\s+NULL/i],
  ["mfa_recovery_codes", "salt", /text\s+NOT\s+NULL/i],
  ["mfa_recovery_requests", "status", /text\s+NOT\s+NULL/i],
  ["auth_security_events", "metadata", /jsonb\s+NOT\s+NULL/i],
]) {
  const block = {
    mfa_credentials: mfaCredentialBlock,
    mfa_recovery_codes: mfaRecoveryCodeBlock,
    mfa_recovery_requests: mfaRecoveryRequestBlock,
    auth_security_events: authSecurityEventBlock,
  }[tableName];
  const columnPattern = new RegExp(`^\\s*${escapeRegExp(columnName)}\\s+([^,\\n]+)`, "mi");
  const match = block.match(columnPattern);
  if (!match || !pattern.test(match[1])) {
    throw new Error(`Column ${tableName}.${columnName} does not match MFA requirements.`);
  }
}
for (const [label, pattern] of [
  ["challenge method", /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+method\s+text/i],
  ["challenge keyed digest", /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+proof_digest\s+text/i],
  ["challenge status", /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+status\s+text\s+NOT\s+NULL/i],
  ["challenge terminal checks", /auth_challenges_terminal_timestamp_ck/i],
]) {
  if (!pattern.test(mfaChallengeHardeningSchema)) {
    throw new Error(`Missing MFA challenge invariant: ${label}`);
  }
}

const registrationBlock = registrationTableBlocks.get("registration_completions");
for (const [columnName, pattern] of [
  ["pending_registration_id", /text\s+PRIMARY\s+KEY/i],
  ["customer_id", /uuid\s+NOT\s+NULL\s+UNIQUE\s+REFERENCES\s+customers/i],
  ["account_id", /uuid\s+NOT\s+NULL\s+UNIQUE\s+REFERENCES\s+payment_accounts/i],
]) {
  const columnPattern = new RegExp(`^\\s*${escapeRegExp(columnName)}\\s+([^,\\n]+)`, "mi");
  const match = registrationBlock.match(columnPattern);
  if (!match || !pattern.test(match[1])) {
    throw new Error(`Column registration_completions.${columnName} is not durable/recoverable.`);
  }
}

for (const tableName of creditTables) {
  const block = creditTableBlocks.get(tableName);
  if (!/\bid\s+uuid\s+PRIMARY\s+KEY\b/i.test(block) && tableName !== "credit_statement_items") {
    throw new Error(`Credit table ${tableName}.id must use PostgreSQL uuid.`);
  }
}

for (const [tableName, columnName, pattern] of [
  ["credit_accounts", "customer_id", /\buuid\b.*\bREFERENCES\s+customers\b/i],
  ["credit_accounts", "credit_limit_minor", /\bbigint\b.*\bCHECK\s*\(credit_limit_minor\s*>\s*0\)/i],
  ["credit_cards", "credit_account_id", /\buuid\b.*\bREFERENCES\s+credit_accounts\b/i],
  ["credit_transactions", "amount_minor", /\bbigint\b.*\bCHECK\s*\(amount_minor\s*>\s*0\)/i],
  ["credit_statements", "version", /\bbigint\b.*\bCHECK\s*\(version\s*>\s*0\)/i],
  ["credit_payment_quotes", "request_fingerprint", /\btext\b.*\bNOT\s+NULL\b/i],
  ["credit_payments", "idempotency_key", /\btext\b.*\bNOT\s+NULL\b/i],
]) {
  const block = creditTableBlocks.get(tableName);
  const columnPattern = new RegExp(`^\\s*${escapeRegExp(columnName)}\\s+([^,\\n]+)`, "mi");
  const match = block.match(columnPattern);
  if (!match || !pattern.test(match[1])) {
    throw new Error(`Column ${tableName}.${columnName} does not match the required credit definition.`);
  }
}

for (const [label, pattern] of [
  ["credit statement cycle uniqueness", /UNIQUE\s*\(\s*credit_account_id\s*,\s*cycle_start_at\s*,\s*cycle_end_at\s*\)/i],
  ["credit payment quote uniqueness", /quote_id\s+uuid\s+NOT\s+NULL\s+UNIQUE\s+REFERENCES\s+credit_payment_quotes/i],
  ["credit payment idempotency", /UNIQUE\s*\(\s*customer_id\s*,\s*idempotency_key\s*\)/i],
  ["credit notification type", /notification_type\s+IN\s*\(\s*'TRANSFER'\s*,\s*'SAVINGS'\s*,\s*'CREDIT'\s*,\s*'SECURITY'/i],
  ["credit control policy", /ADD\s+COLUMN\s+credit_enabled\s+boolean/i],
  ["card unlock step-up policy", /ADD\s+COLUMN\s+card_unlock_step_up_methods\s+text\[\]/i],
]) {
  if (!pattern.test(creditSchema)) {
    throw new Error(`Missing credit database invariant: ${label}`);
  }
}

if (/\bpan\b|\bcvv\b|\bpin\b/i.test(creditSchema)) {
  throw new Error("Credit migration must not define PAN, CVV or PIN columns.");
}

for (const [label, pattern] of [
  ["singleton control-policy seed", /INSERT\s+INTO\s+control_policy\s*\(/i],
  ["idempotent control-policy seed", /ON\s+CONFLICT\s*\(\s*singleton\s*\)\s*DO\s+NOTHING/i],
  ["TOTP-compatible control-policy constraints", /ARRAY\s*\[\s*'OTP'\s*,\s*'TOTP'\s*,\s*'BIOMETRIC'\s*\]::text\[\]/i],
  ["TOTP relational-v2 bootstrap", /ARRAY\s*\[\s*'TOTP'\s*\]::text\[\]/i],
]) {
  if (!pattern.test(controlPolicyBootstrapSchema)) {
    throw new Error(`Missing control-policy bootstrap invariant: ${label}`);
  }
}

for (const [label, pattern] of [
  ["login blocked window", /ALTER\s+TABLE\s+rate_limit_buckets[\s\S]*blocked_until\s+timestamptz/i],
  ["customer feature entitlement table", /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+customer_feature_entitlements/i],
  ["customer entitlement allow-list", /feature_code\s+text\s+NOT\s+NULL\s+CHECK\s*\(feature_code\s+IN\s*\('TRANSFERS',\s*'SAVINGS',\s*'CREDIT'\)/i],
  ["new-customer entitlement seeding", /CREATE\s+TRIGGER\s+customers_seed_feature_entitlements/i],
  ["credit lifecycle cursor", /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+current_cycle_start_at\s+timestamptz/i],
  ["credit ambiguous backfill review marker", /cycle_backfill_review_required\s+boolean\s+NOT\s+NULL\s+DEFAULT\s+false[\s\S]*AMBIGUOUS_LEGACY_STATEMENT/i],
  ["credit placeholder boundary", /cs\.issued_at\s*=\s*cs\.cycle_start_at[\s\S]*cs\.cycle_start_at\s*<\s*cs\.cycle_end_at/i],
  ["credit placeholder no payment evidence", /NOT\s+EXISTS\s*\(SELECT\s+1\s+FROM\s+credit_transactions[\s\S]*NOT\s+EXISTS\s*\(SELECT\s+1\s+FROM\s+credit_payments/i],
  ["beneficiary deletion timestamp", /ALTER\s+TABLE\s+beneficiaries[\s\S]*ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+deleted_at\s+timestamptz/i],
  ["beneficiary deleted status", /CHECK\s*\(status\s+IN\s*\('ACTIVE',\s*'BLOCKED',\s*'DELETED'\)/i],
  ["beneficiary active-only uniqueness", /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+beneficiaries_identity_active_idx[\s\S]*WHERE\s+deleted_at\s+IS\s+NULL/i],
  ["counterparty owner snapshot", /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+destination_owner_name\s+text/i],
  ["synthetic KYC payload", /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+synthetic_payload\s+jsonb\s+NOT\s+NULL/i],
  ["KYC lifecycle statuses", /CHECK\s*\(status\s+IN\s*\('DRAFT',\s*'SUBMITTED',\s*'UNDER_REVIEW',\s*'NEEDS_MORE_INFO',\s*'APPROVED',\s*'REJECTED'\)/i],
  ["KYC open application uniqueness", /CREATE\s+UNIQUE\s+INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+kyc_applications_customer_open_idx[\s\S]*WHERE\s+status\s+IN/i],
  ["savings maturity suspense", /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+savings_maturity_suspense/i],
  ["savings suspense operation uniqueness", /operation_key\s+text\s+NOT\s+NULL\s+UNIQUE/i],
  ["savings suspense dead-letter status", /savings_maturity_suspense_status_check[\s\S]*CHECK\s*\(status\s+IN\s*\('PENDING',\s*'RESOLVED',\s*'DEAD'\)\)/i],
  ["savings suspense retry metadata", /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+attempts\s+integer[\s\S]*next_attempt_at\s+timestamptz[\s\S]*last_error_code\s+text/i],
  ["reported-lost card operations case", /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+card_security_cases[\s\S]*case_type\s+text[\s\S]*'REPORTED_LOST'/i],
  ["reported-lost TOTP purpose", /auth_challenges_purpose_ck[\s\S]*'CARD_REPORT_LOST'/i],
  ["history keyset indexes", /account_transactions_account_occurred_keyset_idx[\s\S]*credit_transactions_account_occurred_keyset_idx[\s\S]*credit_statements_account_issued_keyset_idx/i],
]) {
  if (!pattern.test(businessHardeningSchema)) {
    throw new Error(`Missing business-hardening invariant: ${label}`);
  }
}

for (const [tableName, columnName, pattern] of [
  ["customer_feature_entitlements", "customer_id", /uuid\s+NOT\s+NULL\s+REFERENCES\s+customers/i],
  ["customer_feature_entitlements", "feature_code", /text\s+NOT\s+NULL\s+CHECK/i],
  ["customer_feature_entitlements", "enabled", /boolean\s+NOT\s+NULL/i],
  ["savings_maturity_suspense", "deposit_id", /uuid\s+NOT\s+NULL\s+UNIQUE\s+REFERENCES\s+savings_deposits/i],
  ["savings_maturity_suspense", "amount_minor", /bigint\s+NOT\s+NULL\s+CHECK\s*\(amount_minor\s*>\s*0\)/i],
  ["savings_maturity_suspense", "reason_code", /text\s+NOT\s+NULL\s+CHECK/i],
  ["card_security_cases", "card_id", /uuid\s+NOT\s+NULL\s+REFERENCES\s+credit_cards/i],
  ["card_security_cases", "customer_id", /uuid\s+NOT\s+NULL\s+REFERENCES\s+customers/i],
  ["card_security_cases", "case_type", /text\s+NOT\s+NULL\s+CHECK/i],
]) {
  const block = businessHardeningTableBlocks.get(tableName);
  const columnPattern = new RegExp(`^\\s*${escapeRegExp(columnName)}\\s+([^,\\n]+)`, "mi");
  const match = block.match(columnPattern);
  if (!match || !pattern.test(match[1])) {
    throw new Error(`Column ${tableName}.${columnName} does not match business-hardening requirements.`);
  }
}

for (const tableName of savingsTables) {
  const block = savingsTableBlocks.get(tableName);
  if (!/\bid\s+uuid\s+PRIMARY\s+KEY\b/i.test(block)) {
    throw new Error(`Savings table ${tableName}.id must use PostgreSQL uuid.`);
  }
}

for (const tableName of runtimeTables) {
  const block = runtimeTableBlocks.get(tableName);
  if (!/\bcollection\s+text\s+NOT\s+NULL/i.test(block) || !/\bpayload\s+jsonb\s+NOT\s+NULL/i.test(block)) {
    throw new Error(`Runtime table ${tableName} must keep relational keys and JSONB record payloads.`);
  }
}

if (!/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+command_idempotency/i.test(v2Schema)) {
  throw new Error("Missing relational-v2 command_idempotency table definition.");
}

for (const [label, pattern] of [
  ["command idempotency uniqueness", /UNIQUE\s*\(\s*customer_id\s*,\s*operation_type\s*,\s*idempotency_key\s*\)/i],
  ["account number sequence", /CREATE\s+SEQUENCE\s+IF\s+NOT\s+EXISTS\s+payment_account_number_seq/i],
  ["quote request fingerprint", /ALTER\s+TABLE\s+transfer_quotes[\s\S]*?request_fingerprint\s+text/i],
  ["outbox deduplication index", /outbox_events_deduplication_idx/i],
]) {
  if (!pattern.test(v2Schema)) {
    throw new Error(`Missing relational-v2 invariant: ${label}`);
  }
}

const commandIdempotencyBlock = v2TableBlocks.get("command_idempotency");
for (const [columnName, pattern] of [
  ["customer_id", /uuid\s+NOT\s+NULL\s+REFERENCES\s+customers/i],
  ["operation_type", /text\s+NOT\s+NULL/i],
  ["idempotency_key", /text\s+NOT\s+NULL/i],
  ["request_fingerprint", /text\s+NOT\s+NULL/i],
  ["response_payload", /jsonb\s+NOT\s+NULL/i],
]) {
  const columnPattern = new RegExp(`^\\s*${escapeRegExp(columnName)}\\s+([^,\\n]+)`, "mi");
  const match = commandIdempotencyBlock.match(columnPattern);
  if (!match || !pattern.test(match[1])) {
    throw new Error(`Column command_idempotency.${columnName} does not match the required definition.`);
  }
}

for (const [tableName, columnName, pattern] of [
  ["refresh_session_records", "customer_id", /uuid\s+NOT\s+NULL\s+REFERENCES\s+customers/i],
  ["refresh_session_records", "family_id", /uuid\s+NOT\s+NULL\s+REFERENCES\s+refresh_session_families/i],
  ["auth_challenges", "methods", /text\[\]\s+NOT\s+NULL/i],
  ["pending_registrations", "password_digest", /text\s+NOT\s+NULL/i],
  ["rate_limit_buckets", "attempts", /integer\s+NOT\s+NULL/i],
]) {
  const block = identityV2TableBlocks.get(tableName);
  const columnPattern = new RegExp(`^\\s*${escapeRegExp(columnName)}\\s+([^,\\n]+)`, "mi");
  const match = block.match(columnPattern);
  if (!match || !pattern.test(match[1])) {
    throw new Error(`Column ${tableName}.${columnName} does not match the required identity-v2 definition.`);
  }
}

for (const [label, pattern] of [
  ["deferred transfer quote relation", /transfer_quotes_consumed_transfer_fk[\s\S]*DEFERRABLE\s+INITIALLY\s+DEFERRED/i],
  ["transfer destination foreign key", /transfers_destination_account_fk[\s\S]*REFERENCES\s+payment_accounts/i],
  ["savings maturity uniqueness", /UNIQUE\s*\(deposit_id,\s*operation_key\)/i],
  ["credit payment idempotency uniqueness", /UNIQUE\s*\(customer_id,\s*operation_type,\s*idempotency_key\)/i],
]) {
  const source = `${identityV2Schema}\n${transferV2Schema}\n${savingsV2Schema}\n${creditV2Schema}`;
  if (!pattern.test(source)) {
    throw new Error(`Missing relational-v2 hardening invariant: ${label}`);
  }
}

for (const [tableName, columnName, pattern] of [
  ["savings_quotes", "customer_id", /\buuid\b.*\bREFERENCES\s+customers\b/i],
  ["savings_quotes", "principal_minor", /\bbigint\b.*\bCHECK\s*\(principal_minor\s*>\s*0\)/i],
  ["savings_quotes", "request_fingerprint", /\btext\b.*\bNOT\s+NULL\b/i],
  ["savings_openings", "quote_id", /\buuid\b.*\bUNIQUE\b.*\bREFERENCES\s+savings_quotes\b/i],
  ["savings_openings", "idempotency_key", /\btext\b.*\bNOT\s+NULL\b/i],
  ["savings_deposits", "maturity_instruction", /\btext\b.*\bCHECK\b/i],
  ["savings_deposits", "status", /\btext\b.*\bCHECK\b/i],
]) {
  const block = savingsTableBlocks.get(tableName);
  const columnPattern = new RegExp(
    `^\\s*${escapeRegExp(columnName)}\\s+([^,\\n]+)`,
    "mi",
  );
  const match = block.match(columnPattern);
  if (!match || !pattern.test(match[1])) {
    throw new Error(`Column ${tableName}.${columnName} does not match the required savings definition.`);
  }
}

for (const [label, pattern] of [
  ["savings quote one-time uniqueness", /savings_openings_quote_once_idx/i],
  ["savings idempotency uniqueness", /UNIQUE\s*\(\s*customer_id\s*,\s*idempotency_key\s*\)/i],
  ["savings transaction relation", /ADD\s+COLUMN\s+savings_opening_id\s+uuid\s+REFERENCES\s+savings_openings/i],
  ["savings notification type", /notification_type\s+IN\s*\(\s*'TRANSFER'\s*,\s*'SAVINGS'\s*,\s*'SECURITY'/i],
  ["savings control policy", /ADD\s+COLUMN\s+savings_enabled\s+boolean/i],
]) {
  if (!pattern.test(savingsSchema)) {
    throw new Error(`Missing savings database invariant: ${label}`);
  }
}

const outboxEventsColumns = [
  ["event_version", /integer\s+NOT\s+NULL/i],
  ["aggregate_type", /text\s+NOT\s+NULL/i],
  ["aggregate_version", /bigint\s+NOT\s+NULL/i],
  ["status", /text\s+NOT\s+NULL/i],
  ["priority", /integer\s+NOT\s+NULL/i],
  ["lease_expires_at", /timestamptz/i],
  ["deduplication_key", /text/i],
];
for (const [columnName, pattern] of outboxEventsColumns) {
  const columnPattern = new RegExp(
    `ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+${escapeRegExp(columnName)}\\s+([^,;\\n]+)`,
    "i",
  );
  const match = `${v2Schema}\n${outboxWorkerSchema}`.match(columnPattern);
  if (!match || !pattern.test(match[1])) {
    throw new Error(`Outbox migration must declare outbox_events.${columnName}.`);
  }
}
for (const [tableName, columnName, pattern] of [
  ["notification_endpoints", "customer_id", /uuid\s+NOT\s+NULL\s+REFERENCES\s+customers/i],
  ["notification_endpoints", "address_ciphertext", /text\s+NOT\s+NULL/i],
  ["notification_endpoints", "address_fingerprint", /text\s+NOT\s+NULL/i],
  ["notification_preferences", "enabled", /boolean\s+NOT\s+NULL/i],
  ["notification_deliveries", "outbox_event_id", /uuid\s+NOT\s+NULL\s+REFERENCES\s+outbox_events/i],
  ["notification_deliveries", "endpoint_id", /uuid\s+NOT\s+NULL\s+REFERENCES\s+notification_endpoints/i],
  ["notification_deliveries", "status", /text\s+NOT\s+NULL/i],
  ["dead_letter_events", "source_kind", /text\s+NOT\s+NULL/i],
  ["dead_letter_events", "payload_snapshot", /jsonb\s+NOT\s+NULL/i],
  ["worker_instances", "last_heartbeat_at", /timestamptz\s+NOT\s+NULL/i],
]) {
  const block = outboxWorkerTableBlocks.get(tableName);
  const columnPattern = new RegExp(`^\\s*${escapeRegExp(columnName)}\\s+([^,\\n]+)`, "mi");
  const match = block.match(columnPattern);
  if (!match || !pattern.test(match[1])) {
    throw new Error(`Column ${tableName}.${columnName} does not match the outbox-worker definition.`);
  }
}
for (const [label, pattern] of [
  ["outbox claim index", /outbox_events_claim_v2_idx/i],
  ["outbox lease index", /outbox_events_lease_v2_idx/i],
  ["delivery deduplication", /notification_deliveries_identity_idx/i],
  ["dead-letter uniqueness", /UNIQUE\s*\(source_kind,\s*source_id\)/i],
]) {
  if (!pattern.test(outboxWorkerSchema)) {
    throw new Error(`Missing outbox-worker invariant: ${label}`);
  }
}

if (/\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i.test(`${schema}\n${savingsSchema}\n${creditSchema}\n${runtimeSchema}\n${v2Schema}\n${identityV2Schema}\n${transferV2Schema}\n${savingsV2Schema}\n${creditV2Schema}\n${registrationSchema}\n${outboxWorkerSchema}\n${outboxWorkerOperationsSchema}\n${secretSchema}\n${drRecoverySchema}\n${businessHardeningSchema}`)) {
  throw new Error("The draft migration must not contain destructive DROP statements.");
}

async function validateLiveDatabase() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.log(
        `Database source contract valid: ${requiredTables.length + savingsTables.length + creditTables.length + runtimeTables.length + v2Tables.length + identityV2Tables.length + savingsV2Tables.length + creditV2Tables.length + registrationTables.length + outboxWorkerTables.length + mfaTables.length + secretMetadataTables.length + drRecoveryTables.length + businessHardeningTables.length} table definitions and column/constraint invariants present (live DB check skipped; DATABASE_URL is not set).`,
    );
    return;
  }

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl, max: 1, ssl: resolvePostgresSsl() });
  try {
    const tableResult = await pool.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
      `,
    );
    const liveTables = new Set(tableResult.rows.map((row) => row.table_name));
    for (const tableName of [
      ...requiredTables,
      ...savingsTables,
      ...creditTables,
      ...runtimeTables,
      ...v2Tables,
      ...identityV2Tables,
      ...savingsV2Tables,
      ...creditV2Tables,
      ...registrationTables,
      ...outboxWorkerTables,
      ...mfaTables,
      ...secretMetadataTables,
      ...drRecoveryTables,
      ...businessHardeningTables,
    ]) {
      if (!liveTables.has(tableName)) {
        throw new Error(`Live PostgreSQL database is missing table: ${tableName}`);
      }
    }
    const controlPolicyCount = await pool.query("SELECT COUNT(*)::text AS count FROM control_policy");
    if (controlPolicyCount.rows[0]?.count !== "1") {
      throw new Error("Live PostgreSQL database must contain exactly one control_policy row.");
    }

    const columnResult = await pool.query(
      `
        SELECT table_name, column_name, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
      `,
    );
    const liveColumns = new Map(
      columnResult.rows.map((row) => [
        `${row.table_name}.${row.column_name}`,
        row.udt_name,
      ]),
    );
    for (const tableName of [
      "customers",
      "customer_devices",
      "auth_sessions",
      "payment_accounts",
      "beneficiaries",
      "transfer_quotes",
      "transfers",
      "account_transactions",
      "ledger_journals",
      "audit_events",
      "outbox_events",
      "notifications",
      "fraud_reports",
    ]) {
      if (liveColumns.get(`${tableName}.id`) !== "uuid") {
        throw new Error(`Live ${tableName}.id must use PostgreSQL uuid.`);
      }
    }
    for (const [tableName, columnName, expectedType] of [
      ["transfers", "quote_id", "uuid"],
      ["transfers", "idempotency_key", "text"],
      ["transfer_quotes", "consumed_at", "timestamptz"],
      ["notifications", "resource_account_id", "uuid"],
      ["savings_quotes", "customer_id", "uuid"],
      ["savings_quotes", "principal_minor", "int8"],
      ["savings_openings", "quote_id", "uuid"],
      ["savings_openings", "idempotency_key", "text"],
      ["savings_deposits", "source_account_id", "uuid"],
      ["savings_deposits", "maturity_at", "timestamptz"],
      ["credit_accounts", "customer_id", "uuid"],
      ["credit_accounts", "credit_limit_minor", "int8"],
      ["credit_cards", "credit_account_id", "uuid"],
      ["credit_statements", "version", "int8"],
      ["credit_payment_quotes", "statement_id", "uuid"],
      ["credit_payments", "idempotency_key", "text"],
      ["credit_accounts", "current_cycle_start_at", "timestamptz"],
      ["credit_accounts", "cycle_backfill_review_required", "bool"],
      ["control_policy", "card_unlock_step_up_methods", "_text"],
      ["payment_accounts", "account_number", "text"],
      ["payment_accounts", "held_minor", "int8"],
      ["rate_limit_buckets", "blocked_until", "timestamptz"],
      ["beneficiaries", "deleted_at", "timestamptz"],
      ["transfer_quotes", "destination_owner_name", "text"],
      ["kyc_applications", "synthetic_payload", "jsonb"],
      ["kyc_applications", "submitted_at", "timestamptz"],
      ["customer_feature_entitlements", "customer_id", "uuid"],
      ["customer_feature_entitlements", "feature_code", "text"],
      ["customer_feature_entitlements", "enabled", "bool"],
      ["savings_maturity_suspense", "deposit_id", "uuid"],
      ["savings_maturity_suspense", "customer_id", "uuid"],
      ["savings_maturity_suspense", "amount_minor", "int8"],
      ["savings_maturity_suspense", "reason_code", "text"],
      ["savings_maturity_suspense", "operation_key", "text"],
      ["savings_maturity_suspense", "status", "text"],
      ["savings_maturity_suspense", "attempts", "int4"],
      ["savings_maturity_suspense", "next_attempt_at", "timestamptz"],
      ["savings_maturity_suspense", "resolved_account_id", "uuid"],
      ["card_security_cases", "card_id", "uuid"],
      ["card_security_cases", "customer_id", "uuid"],
      ["card_security_cases", "case_type", "text"],
      ["card_security_cases", "status", "text"],
      ["reference_runtime_records", "payload", "jsonb"],
      ["command_idempotency", "customer_id", "uuid"],
      ["command_idempotency", "operation_type", "text"],
      ["command_idempotency", "idempotency_key", "text"],
      ["command_idempotency", "request_fingerprint", "text"],
      ["command_idempotency", "response_payload", "jsonb"],
      ["refresh_session_records", "customer_id", "uuid"],
      ["refresh_session_records", "family_id", "uuid"],
      ["refresh_session_records", "device_id", "text"],
      ["auth_challenges", "methods", "_text"],
      ["pending_registrations", "password_digest", "text"],
      ["rate_limit_buckets", "attempts", "int4"],
      ["savings_idempotency", "opening_id", "uuid"],
      ["savings_maturity_operations", "deposit_id", "uuid"],
      ["credit_idempotency", "payment_id", "uuid"],
      ["registration_completions", "customer_id", "uuid"],
      ["registration_completions", "account_id", "uuid"],
      ["outbox_events", "event_version", "int4"],
      ["outbox_events", "aggregate_type", "text"],
      ["outbox_events", "aggregate_version", "int8"],
      ["outbox_events", "status", "text"],
      ["outbox_events", "deduplication_key", "text"],
      ["outbox_events", "lease_expires_at", "timestamptz"],
      ["outbox_events", "updated_at", "timestamptz"],
      ["notification_endpoints", "customer_id", "uuid"],
      ["notification_endpoints", "address_ciphertext", "text"],
      ["notification_deliveries", "outbox_event_id", "uuid"],
      ["notification_deliveries", "endpoint_id", "uuid"],
      ["dead_letter_events", "source_id", "uuid"],
      ["worker_instances", "last_heartbeat_at", "timestamptz"],
      ["mfa_credentials", "customer_id", "uuid"],
      ["mfa_credentials", "secret_ciphertext", "text"],
      ["mfa_credentials", "secret_key_id", "text"],
      ["mfa_credentials", "last_accepted_time_step", "int8"],
      ["mfa_recovery_codes", "customer_id", "uuid"],
      ["mfa_recovery_codes", "code_digest", "text"],
      ["mfa_recovery_requests", "customer_id", "uuid"],
      ["mfa_recovery_requests", "public_token_hash", "text"],
      ["auth_security_events", "customer_id", "uuid"],
      ["auth_security_events", "metadata", "jsonb"],
      ["mfa_credentials", "secret_cipher_version", "text"],
      ["mfa_credentials", "secret_aad_version", "text"],
      ["mfa_credentials", "secret_encryption_algorithm", "text"],
      ["mfa_credentials", "secret_encrypted_data_key", "text"],
      ["notification_endpoints", "address_cipher_version", "text"],
      ["notification_endpoints", "address_aad_version", "text"],
      ["notification_endpoints", "address_encryption_algorithm", "text"],
      ["notification_endpoints", "address_encrypted_data_key", "text"],
      ["notification_endpoints", "address_key_id", "text"],
      ["notification_endpoints", "address_reencrypted_at", "timestamptz"],
      ["staff_mfa_credentials", "secret_cipher_version", "text"],
      ["staff_mfa_credentials", "secret_aad_version", "text"],
      ["staff_mfa_credentials", "secret_encryption_algorithm", "text"],
      ["staff_mfa_credentials", "secret_encrypted_data_key", "text"],
      ["mfa_credentials", "secret_reencrypted_at", "timestamptz"],
      ["staff_mfa_credentials", "secret_reencrypted_at", "timestamptz"],
      ["encryption_rekey_checkpoints", "job_id", "text"],
      ["encryption_rekey_checkpoints", "last_record_id", "uuid"],
      ["encryption_rekey_checkpoints", "failed_count", "int8"],
      ["dr_recovery_markers", "id", "uuid"],
      ["dr_recovery_markers", "committed_at", "timestamptz"],
      ["dr_recovery_markers", "marker_hash", "text"],
      ["dr_recovery_markers", "source_release_id", "text"],
      ["transaction_anomalies", "customer_id", "uuid"],
      ["transaction_anomalies", "account_id", "uuid"],
      ["transaction_anomalies", "amount_minor", "int8"],
      ["transaction_anomalies", "risk_level", "text"],
      ["transaction_anomalies", "risk_score", "int4"],
      ["transaction_anomalies", "status", "text"],
      ["mfa_credentials", "device_id", "text"],
      ["control_policy", "daily_transfer_limit_minor", "int8"],
      ["control_policy", "transfer_fee_minor", "int8"],
      ["recipient_lookups", "rail", "text"],
      ["transfer_quotes", "rail", "text"],
      ["transfers", "rail", "text"],
      ["transfers", "external_bank_bin", "text"],
      ["transfers", "napas_trace_id", "text"],
      ["customer_devices", "device_name", "text"],
      ["customer_devices", "last_seen_at", "timestamptz"],
    ]) {
      if (liveColumns.get(`${tableName}.${columnName}`) !== expectedType) {
        throw new Error(
          `Live ${tableName}.${columnName} must use PostgreSQL ${expectedType}.`,
        );
      }
    }

    const constraintResult = await pool.query(
      `
        SELECT cls.relname AS table_name,
               pg_get_constraintdef(con.oid) AS definition
        FROM pg_constraint con
        JOIN pg_class cls ON cls.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = cls.relnamespace
        WHERE ns.nspname = 'public'
      `,
    );
    const definitions = constraintResult.rows.map((row) =>
      `${row.table_name} ${row.definition}`,
    );
    for (const columnName of [
      "step_up_methods",
      "savings_step_up_methods",
      "credit_payment_step_up_methods",
      "card_unlock_step_up_methods",
    ]) {
      if (!definitions.some((definition) =>
        definition.startsWith("control_policy ") &&
        definition.includes(columnName) &&
        /TOTP/i.test(definition),
      )) {
        throw new Error(`Live control_policy constraint must allow TOTP for ${columnName}.`);
      }
    }
    for (const pattern of [
      /transfers UNIQUE \(customer_id, idempotency_key\)/i,
      /transfers UNIQUE \(quote_id\)/i,
      /notifications FOREIGN KEY \(resource_account_id\) REFERENCES payment_accounts/i,
      /savings_openings UNIQUE \(customer_id, idempotency_key\)/i,
      /savings_openings FOREIGN KEY \(quote_id\) REFERENCES savings_quotes/i,
      /savings_deposits FOREIGN KEY \(source_account_id\) REFERENCES payment_accounts/i,
      /credit_cards FOREIGN KEY \(credit_account_id\) REFERENCES credit_accounts/i,
      /credit_payment_quotes FOREIGN KEY \(statement_id\) REFERENCES credit_statements/i,
      /credit_payments UNIQUE \(customer_id, idempotency_key\)/i,
      /command_idempotency UNIQUE \(customer_id, operation_type, idempotency_key\)/i,
      /refresh_session_records FOREIGN KEY \(family_id\) REFERENCES refresh_session_families/i,
      /savings_idempotency UNIQUE \(customer_id, operation_type, idempotency_key\)/i,
      /savings_maturity_operations UNIQUE \(deposit_id, operation_key\)/i,
      /credit_idempotency UNIQUE \(customer_id, operation_type, idempotency_key\)/i,
      /registration_completions FOREIGN KEY \(customer_id\) REFERENCES customers/i,
      /notification_endpoints FOREIGN KEY \(customer_id\) REFERENCES customers/i,
      /notification_deliveries FOREIGN KEY \(outbox_event_id\) REFERENCES outbox_events/i,
      /notification_deliveries FOREIGN KEY \(endpoint_id\) REFERENCES notification_endpoints/i,
      /dead_letter_events UNIQUE \(source_kind, source_id\)/i,
      /mfa_credentials FOREIGN KEY \(customer_id\) REFERENCES customers/i,
      /mfa_recovery_codes FOREIGN KEY \(customer_id\) REFERENCES customers/i,
      /mfa_recovery_requests FOREIGN KEY \(customer_id\) REFERENCES customers/i,
      /auth_security_events FOREIGN KEY \(customer_id\) REFERENCES customers/i,
      /customer_feature_entitlements PRIMARY KEY \(customer_id, feature_code\)/i,
      /savings_maturity_suspense UNIQUE \(deposit_id\)/i,
      /savings_maturity_suspense UNIQUE \(operation_key\)/i,
      /savings_maturity_suspense FOREIGN KEY \(deposit_id\) REFERENCES savings_deposits/i,
      /savings_maturity_suspense FOREIGN KEY \(customer_id\) REFERENCES customers/i,
      /savings_maturity_suspense FOREIGN KEY \(resolved_account_id\) REFERENCES payment_accounts/i,
      /card_security_cases FOREIGN KEY \(card_id\) REFERENCES credit_cards/i,
      /card_security_cases FOREIGN KEY \(customer_id\) REFERENCES customers/i,
    ]) {
      if (!definitions.some((definition) => pattern.test(definition))) {
        throw new Error(`Live PostgreSQL constraint missing: ${pattern}`);
      }
    }

    const indexResult = await pool.query(
      `
        SELECT tablename, indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
      `,
    );
    const indexDefinitions = indexResult.rows.map((row) =>
      `${row.tablename} ${row.indexname} ${row.indexdef}`,
    );
    for (const pattern of [
      /beneficiaries_identity_active_idx[\s\S]*deleted_at IS NULL[\s\S]*status <> 'DELETED'/i,
      /kyc_applications_customer_open_idx[\s\S]*status = ANY/i,
      /account_transactions_account_occurred_keyset_idx/i,
      /credit_transactions_account_occurred_keyset_idx/i,
      /credit_statements_account_issued_keyset_idx/i,
      /card_security_cases_one_open_idx/i,
      /savings_maturity_suspense_queue_idx[\s\S]*next_attempt_at/i,
    ]) {
      if (!indexDefinitions.some((definition) => pattern.test(definition))) {
        throw new Error(`Live PostgreSQL index missing: ${pattern}`);
      }
    }

    console.log(
      `Database contract valid: ${requiredTables.length + savingsTables.length + creditTables.length + runtimeTables.length + v2Tables.length + identityV2Tables.length + savingsV2Tables.length + creditV2Tables.length + registrationTables.length + outboxWorkerTables.length + mfaTables.length + secretMetadataTables.length + drRecoveryTables.length + businessHardeningTables.length} tables, live columns, indexes and key constraints verified against PostgreSQL.`,
    );
  } finally {
    await pool.end();
  }
}

validateLiveDatabase().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

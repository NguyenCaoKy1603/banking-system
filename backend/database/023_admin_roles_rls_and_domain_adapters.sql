-- P0 hardening: separate database principals, case-scope RLS and typed
-- records for commands that must be executed by the Admin domain adapter.
-- The reference `banking` role remains the migration/test owner; production
-- deployment must run the same grants with separately managed credentials.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'banking_migration') THEN
    CREATE ROLE banking_migration NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'banking_public_api') THEN
    CREATE ROLE banking_public_api NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'banking_admin_api') THEN
    CREATE ROLE banking_admin_api NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'banking_worker') THEN
    CREATE ROLE banking_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'banking_audit_reader') THEN
    CREATE ROLE banking_audit_reader NOLOGIN;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Database principal creation skipped: migration role lacks CREATEROLE; provision roles out-of-band.';
END
$$;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['banking_migration', 'banking_public_api', 'banking_admin_api', 'banking_worker', 'banking_audit_reader'] LOOP
    BEGIN
      EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', role_name);
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), role_name);
    EXCEPTION
      WHEN undefined_object OR insufficient_privilege THEN
        RAISE NOTICE 'Grant skipped for role %', role_name;
    END;
  END LOOP;
END
$$;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO banking_migration;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO banking_migration;
GRANT SELECT, INSERT, UPDATE ON customers, customer_devices, auth_sessions,
  payment_accounts, beneficiaries, transfer_quotes, transfers, account_transactions,
  notifications, fraud_reports, control_policy TO banking_public_api;
GRANT SELECT, INSERT, UPDATE ON staff_users, staff_roles, staff_permissions,
  staff_role_permissions, staff_user_roles, staff_sessions, staff_mfa_credentials,
  staff_invites, staff_auth_challenges, admin_action_policies,
  admin_action_requests, admin_action_decisions, admin_action_execution_attempts,
  account_status_change_requests, customer_access_change_requests,
  simulation_funding_requests,
  application_decision_requests, transfer_operation_requests, fraud_resolution_requests,
  outbox_requeue_requests, job_retry_requests, staff_role_change_requests,
  case_assignments, case_internal_notes, kyc_applications,
  kyc_reviews, credit_applications, fraud_case_actions, background_jobs,
  background_job_attempts, job_retry_history TO banking_admin_api;
GRANT SELECT, INSERT, UPDATE ON outbox_events, background_jobs, background_job_attempts,
  job_retry_history, notification_deliveries, dead_letter_events TO banking_worker;
GRANT SELECT ON audit_events TO banking_audit_reader;
GRANT SELECT, INSERT ON audit_events TO banking_public_api, banking_admin_api, banking_worker;
REVOKE UPDATE, DELETE ON audit_events FROM banking_public_api, banking_admin_api, banking_worker, banking_audit_reader;

CREATE TABLE IF NOT EXISTS staff_invite_requests (
  request_id uuid PRIMARY KEY REFERENCES admin_action_requests (id),
  email_normalized text NOT NULL,
  employee_code text NOT NULL,
  display_name text NOT NULL,
  role_code text NOT NULL REFERENCES staff_roles (code),
  reason_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE simulation_funding_requests
  ADD COLUMN IF NOT EXISTS source_transaction_id uuid REFERENCES account_transactions (id);

CREATE TABLE IF NOT EXISTS simulation_funding_reversals (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE REFERENCES admin_action_requests (id),
  source_transaction_id uuid NOT NULL UNIQUE REFERENCES account_transactions (id),
  reversal_transaction_id uuid NOT NULL UNIQUE REFERENCES account_transactions (id),
  account_id uuid NOT NULL REFERENCES payment_accounts (id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE ON staff_invite_requests, simulation_funding_reversals TO banking_admin_api;

-- RLS is enabled but not forced for the migration owner. Production API
-- roles must set LOCAL app.staff_id/app.staff_scope before querying cases;
-- an unscoped non-owner role therefore sees no case rows by default.
ALTER TABLE kyc_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_internal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_action_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kyc_case_scope ON kyc_applications;
CREATE POLICY kyc_case_scope ON kyc_applications
  USING (
    assigned_staff_id::text = NULLIF(current_setting('app.staff_id', true), '')
    OR current_setting('app.staff_scope', true) IN ('CONTROL', 'ADMIN')
  );
DROP POLICY IF EXISTS credit_case_scope ON credit_applications;
CREATE POLICY credit_case_scope ON credit_applications
  USING (
    assigned_staff_id::text = NULLIF(current_setting('app.staff_id', true), '')
    OR current_setting('app.staff_scope', true) IN ('CONTROL', 'ADMIN')
  );
DROP POLICY IF EXISTS case_assignment_scope ON case_assignments;
CREATE POLICY case_assignment_scope ON case_assignments
  USING (
    staff_id::text = NULLIF(current_setting('app.staff_id', true), '')
    OR current_setting('app.staff_scope', true) IN ('CONTROL', 'ADMIN')
  );
DROP POLICY IF EXISTS case_note_scope ON case_internal_notes;
CREATE POLICY case_note_scope ON case_internal_notes
  USING (
    author_staff_id::text = NULLIF(current_setting('app.staff_id', true), '')
    OR current_setting('app.staff_scope', true) IN ('CONTROL', 'ADMIN')
  );
DROP POLICY IF EXISTS action_request_scope ON admin_action_requests;
CREATE POLICY action_request_scope ON admin_action_requests
  USING (
    requester_staff_id::text = NULLIF(current_setting('app.staff_id', true), '')
    OR current_setting('app.staff_scope', true) IN ('CONTROL', 'ADMIN')
  );

COMMENT ON ROLE banking_public_api IS 'Public customer API; no schema mutation or audit UPDATE/DELETE.';
COMMENT ON ROLE banking_admin_api IS 'Admin control plane; four-eyes commands and append-only audit.';
COMMENT ON ROLE banking_worker IS 'Outbox/background worker; no staff identity mutation.';
COMMENT ON ROLE banking_audit_reader IS 'Read-only audit export/reporting principal.';

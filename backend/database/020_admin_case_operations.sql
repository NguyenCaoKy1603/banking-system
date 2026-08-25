-- Admin domain case/operations adapter. Additive only; 001-019 remain immutable.
-- All rows are synthetic reference data. PII/document bytes are intentionally
-- not stored here; only metadata and short-lived object keys are allowed.

CREATE TABLE IF NOT EXISTS kyc_applications (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  status text NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN ('SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'APPROVED', 'REJECTED')),
  applicant_label text NOT NULL,
  request_fingerprint text NOT NULL,
  assigned_staff_id uuid REFERENCES staff_users (id),
  decision_reason_code text,
  decision_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kyc_applications_queue_idx
  ON kyc_applications (status, created_at)
  WHERE status IN ('SUBMITTED', 'UNDER_REVIEW');

CREATE TABLE IF NOT EXISTS kyc_application_documents (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES kyc_applications (id),
  document_type text NOT NULL,
  object_key text NOT NULL,
  checksum text NOT NULL,
  content_type text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (application_id, document_type)
);

CREATE TABLE IF NOT EXISTS kyc_reviews (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES kyc_applications (id),
  reviewer_staff_id uuid NOT NULL REFERENCES staff_users (id),
  recommendation text NOT NULL CHECK (recommendation IN ('APPROVED', 'REJECTED', 'MORE_INFO_REQUIRED')),
  application_version bigint NOT NULL CHECK (application_version > 0),
  request_fingerprint text NOT NULL,
  reason_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_applications (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  status text NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN ('SUBMITTED', 'UNDER_REVIEW', 'PENDING_ACTIVATION', 'REJECTED', 'ACTIVE')),
  requested_limit_minor bigint NOT NULL CHECK (requested_limit_minor > 0),
  approved_limit_minor bigint CHECK (approved_limit_minor IS NULL OR approved_limit_minor > 0),
  request_fingerprint text NOT NULL,
  assigned_staff_id uuid REFERENCES staff_users (id),
  decision_reason_code text,
  decision_at timestamptz,
  activated_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS credit_applications_queue_idx
  ON credit_applications (status, created_at)
  WHERE status IN ('SUBMITTED', 'UNDER_REVIEW');

CREATE TABLE IF NOT EXISTS case_assignments (
  id uuid PRIMARY KEY,
  case_type text NOT NULL CHECK (case_type IN ('KYC', 'CREDIT', 'FRAUD')),
  case_id uuid NOT NULL,
  staff_id uuid NOT NULL REFERENCES staff_users (id),
  assigned_by_staff_id uuid REFERENCES staff_users (id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELEASED')),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  released_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS case_assignments_one_active_idx
  ON case_assignments (case_type, case_id)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS case_internal_notes (
  id uuid PRIMARY KEY,
  case_type text NOT NULL CHECK (case_type IN ('KYC', 'CREDIT', 'FRAUD')),
  case_id uuid NOT NULL,
  author_staff_id uuid NOT NULL REFERENCES staff_users (id),
  note text NOT NULL CHECK (length(trim(note)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fraud_case_actions (
  id uuid PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES fraud_reports (id),
  request_id uuid REFERENCES admin_action_requests (id),
  action_type text NOT NULL CHECK (action_type IN ('BLOCK', 'REVOKE', 'REVERSAL', 'RESOLVE')),
  resolution_code text,
  status text NOT NULL CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'EXECUTED')),
  actor_staff_id uuid REFERENCES staff_users (id),
  created_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE fraud_reports
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'MEDIUM'
    CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  ADD COLUMN IF NOT EXISTS assigned_staff_id uuid REFERENCES staff_users (id),
  ADD COLUMN IF NOT EXISTS resolution_code text,
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW();

ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN IF NOT EXISTS last_error_code text;

CREATE INDEX IF NOT EXISTS fraud_reports_queue_idx
  ON fraud_reports (status, severity, created_at);

CREATE INDEX IF NOT EXISTS case_internal_notes_case_idx
  ON case_internal_notes (case_type, case_id, created_at DESC);

-- Runtime code must never mutate or erase audit history. A trigger provides a
-- database-level guard even when an application role is misconfigured.
CREATE OR REPLACE FUNCTION reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

COMMENT ON TABLE kyc_applications IS 'Synthetic KYC case source for Admin control-plane review; no document bytes.';
COMMENT ON TABLE credit_applications IS 'Synthetic credit application workflow; every decision is explicit and four-eyes protected.';
COMMENT ON TABLE case_internal_notes IS 'Staff-only notes; sanitize before persistence and never expose to customer API.';

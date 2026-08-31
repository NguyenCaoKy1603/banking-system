-- Customer-facing KYC draft/submission boundary.  Documents remain metadata
-- only; no image bytes or real identity data are stored by this reference app.

ALTER TABLE kyc_applications
  DROP CONSTRAINT IF EXISTS kyc_applications_status_check;

UPDATE kyc_applications
   SET status = 'NEEDS_MORE_INFO', updated_at = NOW()
 WHERE status = 'MORE_INFO_REQUIRED';

ALTER TABLE kyc_applications
  ADD CONSTRAINT kyc_applications_status_check
  CHECK (status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_MORE_INFO', 'APPROVED', 'REJECTED'));

ALTER TABLE kyc_applications
  ADD COLUMN IF NOT EXISTS synthetic_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

ALTER TABLE application_decision_requests
  DROP CONSTRAINT IF EXISTS application_decision_requests_decision_check;

ALTER TABLE application_decision_requests
  ADD CONSTRAINT application_decision_requests_decision_check
  CHECK (decision IN ('APPROVED', 'REJECTED', 'MORE_INFO_REQUIRED', 'NEEDS_MORE_INFO', 'PENDING_ACTIVATION'));

COMMENT ON COLUMN kyc_applications.synthetic_payload IS
  'Synthetic-only customer KYC fields for the reference sandbox; never store document bytes or production PII here.';

DROP INDEX IF EXISTS kyc_applications_customer_open_idx;

CREATE UNIQUE INDEX kyc_applications_customer_open_idx
  ON kyc_applications (customer_id)
  WHERE status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_MORE_INFO');

CREATE INDEX IF NOT EXISTS kyc_applications_customer_created_idx
  ON kyc_applications (customer_id, created_at DESC, id);

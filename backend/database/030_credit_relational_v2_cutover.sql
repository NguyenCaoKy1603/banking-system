-- Customer-facing credit cutover metadata.  Application idempotency and the
-- activated account relation belong to the relational source of truth.
ALTER TABLE credit_idempotency
  ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES credit_applications (id);

ALTER TABLE credit_applications
  ADD COLUMN IF NOT EXISTS credit_account_id uuid REFERENCES credit_accounts (id);

-- The same idempotency table is shared by payment and application commands.
-- Its original payment-only status check must allow the durable application
-- lifecycle states before the customer can activate an approved application.
ALTER TABLE credit_idempotency
  DROP CONSTRAINT IF EXISTS credit_idempotency_status_check;

ALTER TABLE credit_idempotency
  ADD CONSTRAINT credit_idempotency_status_check
  CHECK (status IN ('PENDING', 'SUBMITTED', 'ACTIVE', 'SUCCEEDED', 'FAILED', 'REVERSED'));

CREATE INDEX IF NOT EXISTS credit_applications_customer_created_idx
  ON credit_applications (customer_id, created_at DESC);

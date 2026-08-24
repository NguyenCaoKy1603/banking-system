-- P0 credit source-of-truth hardening.  The 003 tables hold the financial
-- records; these guards make payment retries and statement version checks
-- explicit and lock-friendly.

CREATE TABLE IF NOT EXISTS credit_idempotency (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  operation_type text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  payment_id uuid REFERENCES credit_payments (id),
  status text NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REVERSED')),
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, operation_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS credit_idempotency_pending_idx
  ON credit_idempotency (updated_at)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS credit_accounts_customer_status_idx
  ON credit_accounts (customer_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS credit_statements_due_v2_idx
  ON credit_statements (credit_account_id, due_at, version)
  WHERE remaining_amount_due_minor > 0;

CREATE INDEX IF NOT EXISTS credit_payments_account_status_idx
  ON credit_payments (credit_account_id, status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS credit_payments_one_pending_account_idx
  ON credit_payments (credit_account_id)
  WHERE status = 'PENDING';

ALTER TABLE credit_payment_quotes
  ADD CONSTRAINT credit_payment_quotes_statement_version_positive
  CHECK (statement_version > 0);

ALTER TABLE credit_payments
  ADD CONSTRAINT credit_payments_amount_positive
  CHECK (amount_minor > 0);

-- Relational-v2 scheduled lifecycle idempotency.  A worker/scheduler may
-- restart or run concurrently, so every financial lifecycle command gets a
-- durable operation key scoped to its aggregate and cycle.

CREATE TABLE IF NOT EXISTS credit_lifecycle_operations (
  id uuid PRIMARY KEY,
  credit_account_id uuid NOT NULL REFERENCES credit_accounts (id),
  operation_type text NOT NULL CHECK (operation_type IN (
    'STATEMENT_CLOSE', 'STATEMENT_OVERDUE', 'PAYMENT_SETTLE', 'PAYMENT_REVERSE'
  )),
  operation_key text NOT NULL,
  statement_id uuid REFERENCES credit_statements (id),
  payment_id uuid REFERENCES credit_payments (id),
  status text NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (credit_account_id, operation_type, operation_key)
);

CREATE INDEX IF NOT EXISTS credit_lifecycle_operations_pending_idx
  ON credit_lifecycle_operations (status, updated_at)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS credit_lifecycle_operations_payment_idx
  ON credit_lifecycle_operations (payment_id, operation_type);

ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS credit_payment_id uuid REFERENCES credit_payments (id);

CREATE INDEX IF NOT EXISTS credit_transactions_payment_idx
  ON credit_transactions (credit_payment_id, occurred_at)
  WHERE credit_payment_id IS NOT NULL;

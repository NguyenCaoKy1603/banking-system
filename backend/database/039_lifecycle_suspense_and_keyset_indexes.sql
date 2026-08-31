-- Relational-v2 lifecycle fallback and database-side history pagination.
-- Maturity obligations must not remain ACTIVE when a configured destination
-- cannot be credited; the suspense row is the durable operations hand-off.

CREATE TABLE IF NOT EXISTS savings_maturity_suspense (
  id uuid PRIMARY KEY,
  deposit_id uuid NOT NULL UNIQUE REFERENCES savings_deposits (id),
  customer_id uuid NOT NULL REFERENCES customers (id),
  source_account_id uuid REFERENCES payment_accounts (id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  reason_code text NOT NULL CHECK (reason_code IN ('SOURCE_ACCOUNT_UNAVAILABLE', 'PRODUCT_INACTIVE')),
  operation_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RESOLVED')),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS savings_maturity_suspense_queue_idx
  ON savings_maturity_suspense (status, created_at, id)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS account_transactions_account_occurred_keyset_idx
  ON account_transactions (account_id, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS credit_transactions_account_occurred_keyset_idx
  ON credit_transactions (credit_account_id, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS credit_statements_account_issued_keyset_idx
  ON credit_statements (credit_account_id, issued_at DESC, id DESC);

GRANT SELECT, INSERT, UPDATE ON savings_maturity_suspense TO banking_public_api, banking_worker;

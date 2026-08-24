-- Registration response-loss recovery.  A completion row lets a retry after
-- commit return the canonical customer/account pair without recreating either.

CREATE TABLE IF NOT EXISTS registration_completions (
  pending_registration_id text PRIMARY KEY,
  customer_id uuid NOT NULL UNIQUE REFERENCES customers (id),
  account_id uuid NOT NULL UNIQUE REFERENCES payment_accounts (id),
  created_at timestamptz NOT NULL DEFAULT NOW()
);

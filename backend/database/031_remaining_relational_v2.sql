-- Remaining customer route cutover: recipient lookup, fraud idempotency and
-- explicit notification read state.  Lookup tokens are stored hashed so a
-- database read cannot be replayed as a transfer recipient credential.

CREATE TABLE IF NOT EXISTS recipient_lookups (
  token_hash text PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  destination_account_id uuid NOT NULL REFERENCES payment_accounts (id),
  destination_owner_id uuid NOT NULL REFERENCES customers (id),
  account_holder_name text NOT NULL,
  masked_account_number text NOT NULL,
  bank_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'BLOCKED')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS recipient_lookups_customer_expiry_idx
  ON recipient_lookups (customer_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS fraud_report_idempotency (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  report_id uuid REFERENCES fraud_reports (id),
  status text NOT NULL CHECK (status IN ('PENDING', 'RECEIVED')),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS fraud_report_idempotency_pending_idx
  ON fraud_report_idempotency (updated_at)
  WHERE status = 'PENDING';

CREATE UNIQUE INDEX IF NOT EXISTS fraud_reports_one_open_per_transaction_idx
  ON fraud_reports (customer_id, transaction_id)
  WHERE status = 'RECEIVED';

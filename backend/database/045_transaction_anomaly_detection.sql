-- 045_transaction_anomaly_detection.sql
-- Forward-only migration for transaction anomaly detection and customer/admin review workflow.

CREATE TABLE IF NOT EXISTS transaction_anomalies (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  account_id uuid NOT NULL REFERENCES payment_accounts (id),
  transfer_id uuid REFERENCES transfers (id),
  transaction_id uuid REFERENCES account_transactions (id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
  counterparty_name text,
  masked_destination_account text,
  risk_level text NOT NULL CHECK (risk_level IN ('MEDIUM', 'HIGH', 'CRITICAL')),
  risk_score integer NOT NULL CHECK (risk_score BETWEEN 1 AND 100),
  rule_codes text[] NOT NULL CHECK (cardinality(rule_codes) > 0),
  summary text NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'CONFIRMED_SAFE', 'REPORTED_SUSPICIOUS', 'RESOLVED')),
  customer_note text,
  acknowledged_at timestamptz,
  resolved_by_staff_id uuid REFERENCES staff_users (id),
  resolution_code text,
  resolved_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (transfer_id)
);

CREATE INDEX IF NOT EXISTS transaction_anomalies_customer_created_idx
  ON transaction_anomalies (customer_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS transaction_anomalies_status_created_idx
  ON transaction_anomalies (status, risk_score DESC, created_at DESC)
  WHERE status IN ('OPEN', 'REPORTED_SUSPICIOUS');

GRANT SELECT, INSERT, UPDATE ON transaction_anomalies TO banking_public_api, banking_admin_api, banking_worker;

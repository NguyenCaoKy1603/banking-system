-- DRAFT: fixed-term VND savings sandbox boundary.
-- This migration is intentionally separate from 001 and is not a production
-- deposit ledger until the repository adapter, core integration and controls
-- have been approved.

CREATE TABLE savings_products (
  id uuid PRIMARY KEY,
  product_code text NOT NULL UNIQUE,
  name text NOT NULL,
  term_months integer NOT NULL CHECK (term_months IN (1, 3, 6, 12)),
  annual_rate_basis_points integer NOT NULL CHECK (annual_rate_basis_points >= 0),
  currency char(3) NOT NULL CHECK (currency = 'VND'),
  min_amount_minor bigint NOT NULL CHECK (min_amount_minor > 0),
  max_amount_minor bigint NOT NULL CHECK (max_amount_minor >= min_amount_minor),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
  terms_version text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE savings_quotes (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  source_account_id uuid NOT NULL REFERENCES payment_accounts (id),
  product_id uuid NOT NULL REFERENCES savings_products (id),
  principal_minor bigint NOT NULL CHECK (principal_minor > 0),
  annual_rate_basis_points integer NOT NULL CHECK (annual_rate_basis_points >= 0),
  interest_days integer NOT NULL CHECK (interest_days > 0),
  expected_interest_minor bigint NOT NULL CHECK (expected_interest_minor >= 0),
  total_at_maturity_minor bigint NOT NULL CHECK (total_at_maturity_minor >= principal_minor),
  currency char(3) NOT NULL CHECK (currency = 'VND'),
  term_months integer NOT NULL CHECK (term_months IN (1, 3, 6, 12)),
  maturity_instruction text NOT NULL CHECK (
    maturity_instruction IN (
      'RETURN_PRINCIPAL_AND_INTEREST',
      'RENEW_PRINCIPAL',
      'RENEW_PRINCIPAL_AND_INTEREST'
    )
  ),
  terms_version text NOT NULL,
  opened_at timestamptz NOT NULL,
  maturity_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  request_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX savings_quotes_customer_idx ON savings_quotes (customer_id, expires_at);

CREATE TABLE savings_deposits (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  opening_id uuid,
  source_account_id uuid NOT NULL REFERENCES payment_accounts (id),
  product_id uuid NOT NULL REFERENCES savings_products (id),
  principal_minor bigint NOT NULL CHECK (principal_minor > 0),
  annual_rate_basis_points integer NOT NULL CHECK (annual_rate_basis_points >= 0),
  expected_interest_minor bigint NOT NULL CHECK (expected_interest_minor >= 0),
  total_at_maturity_minor bigint NOT NULL CHECK (total_at_maturity_minor >= principal_minor),
  currency char(3) NOT NULL CHECK (currency = 'VND'),
  term_months integer NOT NULL CHECK (term_months IN (1, 3, 6, 12)),
  maturity_instruction text NOT NULL CHECK (
    maturity_instruction IN (
      'RETURN_PRINCIPAL_AND_INTEREST',
      'RENEW_PRINCIPAL',
      'RENEW_PRINCIPAL_AND_INTEREST'
    )
  ),
  terms_version text NOT NULL,
  reference text NOT NULL UNIQUE,
  opened_at timestamptz NOT NULL,
  maturity_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'MATURED', 'CLOSED')),
  renewed_deposit_id uuid REFERENCES savings_deposits (id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX savings_deposits_customer_status_idx
  ON savings_deposits (customer_id, status, updated_at DESC);

CREATE TABLE savings_openings (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  quote_id uuid NOT NULL UNIQUE REFERENCES savings_quotes (id),
  deposit_id uuid UNIQUE REFERENCES savings_deposits (id),
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  reference text UNIQUE,
  status text NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REVERSED')),
  failure_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (customer_id, idempotency_key)
);

CREATE INDEX savings_openings_customer_idx
  ON savings_openings (customer_id, updated_at DESC);

ALTER TABLE savings_deposits
  ADD CONSTRAINT savings_deposits_opening_fk
  FOREIGN KEY (opening_id) REFERENCES savings_openings (id);

ALTER TABLE account_transactions
  ADD COLUMN savings_opening_id uuid REFERENCES savings_openings (id),
  ADD COLUMN savings_deposit_id uuid REFERENCES savings_deposits (id);

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_notification_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_notification_type_check
  CHECK (notification_type IN ('TRANSFER', 'SAVINGS', 'SECURITY'));

ALTER TABLE notifications
  ADD COLUMN savings_deposit_id uuid REFERENCES savings_deposits (id);

ALTER TABLE control_policy
  ADD COLUMN savings_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN savings_allowlist_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN max_savings_amount_minor bigint NOT NULL DEFAULT 500000000
    CHECK (max_savings_amount_minor > 0),
  ADD COLUMN savings_step_up_methods text[] NOT NULL DEFAULT ARRAY['OTP', 'BIOMETRIC']::text[]
    CHECK (
      cardinality(savings_step_up_methods) > 0
      AND savings_step_up_methods <@ ARRAY['OTP', 'BIOMETRIC']::text[]
    );

CREATE UNIQUE INDEX savings_openings_quote_once_idx ON savings_openings (quote_id);

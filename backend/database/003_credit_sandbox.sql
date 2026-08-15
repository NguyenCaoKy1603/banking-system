-- M7 credit sandbox only. This migration adds read-only credit snapshots and
-- a quote/MFA/idempotent payment boundary; it is not a card processor schema.

CREATE TABLE credit_accounts (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  currency char(3) NOT NULL CHECK (currency = 'VND'),
  credit_limit_minor bigint NOT NULL CHECK (credit_limit_minor > 0),
  posted_outstanding_minor bigint NOT NULL CHECK (posted_outstanding_minor >= 0),
  pending_authorizations_minor bigint NOT NULL CHECK (pending_authorizations_minor >= 0),
  next_statement_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'FROZEN', 'CLOSED')),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX credit_accounts_customer_one_idx
  ON credit_accounts (customer_id);

CREATE TABLE credit_cards (
  id uuid PRIMARY KEY,
  credit_account_id uuid NOT NULL REFERENCES credit_accounts (id),
  customer_id uuid NOT NULL REFERENCES customers (id),
  display_name text NOT NULL,
  brand text NOT NULL CHECK (brand IN ('VISA', 'MASTERCARD')),
  masked_number text NOT NULL,
  last_four text NOT NULL CHECK (last_four ~ '^[0-9]{4}$'),
  expiry_month integer NOT NULL CHECK (expiry_month BETWEEN 1 AND 12),
  expiry_year integer NOT NULL CHECK (expiry_year >= 0),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'LOCKED', 'BLOCKED', 'EXPIRED', 'CLOSED')),
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX credit_cards_account_one_idx ON credit_cards (credit_account_id);

CREATE TABLE credit_statements (
  id uuid PRIMARY KEY,
  credit_account_id uuid NOT NULL REFERENCES credit_accounts (id),
  cycle_start_at timestamptz NOT NULL,
  cycle_end_at timestamptz NOT NULL,
  issued_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  opening_balance_minor bigint NOT NULL CHECK (opening_balance_minor >= 0),
  purchase_total_minor bigint NOT NULL CHECK (purchase_total_minor >= 0),
  refund_total_minor bigint NOT NULL CHECK (refund_total_minor >= 0),
  fee_total_minor bigint NOT NULL CHECK (fee_total_minor >= 0),
  interest_total_minor bigint NOT NULL CHECK (interest_total_minor >= 0),
  closing_balance_minor bigint NOT NULL CHECK (closing_balance_minor >= 0),
  remaining_amount_due_minor bigint NOT NULL CHECK (remaining_amount_due_minor >= 0),
  minimum_payment_due_minor bigint NOT NULL CHECK (minimum_payment_due_minor >= 0),
  minimum_payment_remaining_minor bigint NOT NULL CHECK (minimum_payment_remaining_minor >= 0),
  paid_amount_minor bigint NOT NULL CHECK (paid_amount_minor >= 0),
  status text NOT NULL CHECK (status IN ('ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (credit_account_id, cycle_start_at, cycle_end_at)
);

CREATE INDEX credit_statements_due_idx
  ON credit_statements (credit_account_id, due_at)
  WHERE remaining_amount_due_minor > 0;

CREATE TABLE credit_transactions (
  id uuid PRIMARY KEY,
  credit_account_id uuid NOT NULL REFERENCES credit_accounts (id),
  statement_id uuid REFERENCES credit_statements (id),
  type text NOT NULL CHECK (type IN ('PURCHASE', 'REFUND', 'PAYMENT', 'FEE', 'INTEREST', 'ADJUSTMENT')),
  status text NOT NULL CHECK (status IN ('PENDING', 'POSTED', 'REVERSED', 'DECLINED')),
  description text NOT NULL,
  merchant_name text,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  debt_effect text NOT NULL CHECK (debt_effect IN ('INCREASE', 'DECREASE', 'NONE')),
  occurred_at timestamptz NOT NULL,
  posted_at timestamptz
);

CREATE INDEX credit_transactions_account_idx
  ON credit_transactions (credit_account_id, occurred_at DESC);

CREATE TABLE credit_statement_items (
  statement_id uuid NOT NULL REFERENCES credit_statements (id),
  transaction_id uuid NOT NULL REFERENCES credit_transactions (id),
  PRIMARY KEY (statement_id, transaction_id),
  UNIQUE (transaction_id)
);

CREATE TABLE credit_payment_quotes (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  source_account_id uuid NOT NULL REFERENCES payment_accounts (id),
  credit_account_id uuid NOT NULL REFERENCES credit_accounts (id),
  statement_id uuid NOT NULL REFERENCES credit_statements (id),
  statement_version bigint NOT NULL CHECK (statement_version > 0),
  payment_option text NOT NULL CHECK (payment_option IN ('MINIMUM', 'FULL_STATEMENT', 'CUSTOM')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  fee_minor bigint NOT NULL CHECK (fee_minor >= 0),
  request_fingerprint text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE INDEX credit_payment_quotes_customer_idx
  ON credit_payment_quotes (customer_id, expires_at);

CREATE TABLE credit_payments (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  quote_id uuid NOT NULL UNIQUE REFERENCES credit_payment_quotes (id),
  credit_account_id uuid NOT NULL REFERENCES credit_accounts (id),
  statement_id uuid NOT NULL REFERENCES credit_statements (id),
  source_account_id uuid NOT NULL REFERENCES payment_accounts (id),
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  reference text NOT NULL UNIQUE,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  status text NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REVERSED')),
  failure_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (customer_id, idempotency_key)
);

CREATE INDEX credit_payments_customer_idx
  ON credit_payments (customer_id, updated_at DESC);

ALTER TABLE account_transactions
  ADD COLUMN credit_payment_id uuid REFERENCES credit_payments (id);

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_notification_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_notification_type_check
  CHECK (notification_type IN ('TRANSFER', 'SAVINGS', 'CREDIT', 'SECURITY'));

ALTER TABLE control_policy
  ADD COLUMN credit_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN credit_allowlisted boolean NOT NULL DEFAULT true,
  ADD COLUMN credit_payments_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN card_controls_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN max_credit_payment_amount_minor bigint NOT NULL DEFAULT 20000000
    CHECK (max_credit_payment_amount_minor > 0),
  ADD COLUMN credit_payment_step_up_methods text[] NOT NULL DEFAULT ARRAY['OTP', 'BIOMETRIC']::text[]
    CHECK (
      cardinality(credit_payment_step_up_methods) > 0
      AND credit_payment_step_up_methods <@ ARRAY['OTP', 'BIOMETRIC']::text[]
    ),
  ADD COLUMN card_unlock_step_up_methods text[] NOT NULL DEFAULT ARRAY['OTP', 'BIOMETRIC']::text[]
    CHECK (
      cardinality(card_unlock_step_up_methods) > 0
      AND card_unlock_step_up_methods <@ ARRAY['OTP', 'BIOMETRIC']::text[]
    );

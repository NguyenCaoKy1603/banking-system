-- DRAFT: PostgreSQL boundary for the banking MVP.
-- This migration is not wired to the reference in-memory backend yet.
-- Apply only after partner, legal/compliance and data-retention approval.

CREATE TABLE customers (
  id uuid PRIMARY KEY,
  full_name text NOT NULL,
  email text NOT NULL,
  phone_number text NOT NULL,
  password_salt text NOT NULL,
  password_digest text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (email),
  UNIQUE (phone_number)
);

CREATE UNIQUE INDEX customers_email_lower_idx ON customers (lower(email));

CREATE TABLE customer_devices (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  device_id text NOT NULL,
  attestation_status text NOT NULL DEFAULT 'PENDING'
    CHECK (attestation_status IN ('PENDING', 'VERIFIED', 'REVOKED')),
  created_at timestamptz NOT NULL,
  revoked_at timestamptz,
  UNIQUE (customer_id, device_id)
);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  device_id uuid NOT NULL REFERENCES customer_devices (id),
  family_id uuid NOT NULL,
  access_token_hash text NOT NULL UNIQUE,
  refresh_token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by_session_id uuid REFERENCES auth_sessions (id),
  created_at timestamptz NOT NULL
);

CREATE INDEX auth_sessions_customer_idx ON auth_sessions (customer_id);
CREATE INDEX auth_sessions_family_idx ON auth_sessions (family_id);

CREATE TABLE payment_accounts (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  display_name text NOT NULL,
  masked_number text NOT NULL,
  currency char(3) NOT NULL CHECK (currency = 'VND'),
  available_minor bigint NOT NULL CHECK (available_minor >= 0),
  current_minor bigint NOT NULL CHECK (current_minor >= 0),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'BLOCKED')),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL
);

CREATE INDEX payment_accounts_customer_idx ON payment_accounts (customer_id);

CREATE TABLE beneficiaries (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  display_name text NOT NULL,
  masked_account_number text NOT NULL,
  account_number_fingerprint text NOT NULL,
  bank_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'BLOCKED')),
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX beneficiaries_identity_idx
  ON beneficiaries (customer_id, account_number_fingerprint, lower(bank_name));

CREATE TABLE transfer_quotes (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  source_account_id uuid NOT NULL REFERENCES payment_accounts (id),
  beneficiary_id uuid NOT NULL REFERENCES beneficiaries (id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  fee_minor bigint NOT NULL CHECK (fee_minor >= 0),
  currency char(3) NOT NULL CHECK (currency = 'VND'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE INDEX transfer_quotes_customer_idx ON transfer_quotes (customer_id, expires_at);

CREATE TABLE transfers (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  source_account_id uuid NOT NULL REFERENCES payment_accounts (id),
  quote_id uuid NOT NULL REFERENCES transfer_quotes (id),
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  reference text NOT NULL UNIQUE,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  fee_minor bigint NOT NULL CHECK (fee_minor >= 0),
  currency char(3) NOT NULL CHECK (currency = 'VND'),
  status text NOT NULL
    CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REVERSED')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (customer_id, idempotency_key),
  UNIQUE (quote_id)
);

CREATE INDEX transfers_customer_created_idx
  ON transfers (customer_id, created_at DESC);

CREATE TABLE account_transactions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES payment_accounts (id),
  transfer_id uuid REFERENCES transfers (id),
  direction text NOT NULL CHECK (direction IN ('CREDIT', 'DEBIT')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  fee_minor bigint NOT NULL CHECK (fee_minor >= 0),
  currency char(3) NOT NULL CHECK (currency = 'VND'),
  status text NOT NULL
    CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REVERSED')),
  description text NOT NULL,
  counterparty_name text,
  reference text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE INDEX account_transactions_history_idx
  ON account_transactions (account_id, occurred_at DESC);

CREATE TABLE ledger_journals (
  id uuid PRIMARY KEY,
  aggregate_id text NOT NULL,
  journal_type text NOT NULL,
  currency char(3) NOT NULL CHECK (currency = 'VND'),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (journal_type, aggregate_id)
);

CREATE TABLE ledger_entries (
  journal_id uuid NOT NULL REFERENCES ledger_journals (id),
  line_number integer NOT NULL CHECK (line_number > 0),
  account_ref text NOT NULL,
  side text NOT NULL CHECK (side IN ('DEBIT', 'CREDIT')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL CHECK (currency = 'VND'),
  PRIMARY KEY (journal_id, line_number)
);

CREATE INDEX ledger_entries_account_idx ON ledger_entries (account_ref);

CREATE FUNCTION assert_ledger_journal_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  journal_delta bigint;
  entry_count bigint;
BEGIN
  SELECT
    COUNT(*),
    COALESCE(
      SUM(CASE WHEN side = 'DEBIT' THEN amount_minor ELSE -amount_minor END),
      0
    )
  INTO entry_count, journal_delta
  FROM ledger_entries
  WHERE journal_id = NEW.journal_id;

  IF entry_count < 2 OR journal_delta <> 0 THEN
    RAISE EXCEPTION 'ledger journal % must have at least two balanced entries', NEW.journal_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION assert_ledger_journal_has_entries()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ledger_entries WHERE journal_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'ledger journal % must contain entries', NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_journal_balanced
AFTER INSERT OR UPDATE ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_ledger_journal_balanced();

CREATE CONSTRAINT TRIGGER ledger_journal_has_entries
AFTER INSERT ON ledger_journals
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_ledger_journal_has_entries();

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  actor_customer_id uuid REFERENCES customers (id),
  resource_id text,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX audit_events_occurred_idx ON audit_events (occurred_at DESC);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz
);

CREATE INDEX outbox_unpublished_idx
  ON outbox_events (occurred_at)
  WHERE published_at IS NULL;

-- Reference-only persistence checkpoint for the sandbox adapter. Production
-- must replace this JSON snapshot with repository writes across the relational
-- tables above before any real-money use.
CREATE TABLE reference_state_snapshots (
  snapshot_key text PRIMARY KEY,
  state jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  notification_type text NOT NULL CHECK (notification_type IN ('TRANSFER', 'SECURITY')),
  title text NOT NULL,
  body text NOT NULL,
  resource_id text,
  resource_account_id uuid REFERENCES payment_accounts (id),
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);

CREATE INDEX notifications_customer_created_idx
  ON notifications (customer_id, created_at DESC);

CREATE TABLE fraud_reports (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  account_id uuid NOT NULL REFERENCES payment_accounts (id),
  transaction_id uuid NOT NULL REFERENCES account_transactions (id),
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('RECEIVED', 'IN_REVIEW', 'RESOLVED')),
  created_at timestamptz NOT NULL
);

CREATE TABLE control_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton = true),
  config_version text NOT NULL,
  global_kill_switch boolean NOT NULL DEFAULT false,
  transfers_enabled boolean NOT NULL DEFAULT true,
  allowlist_enabled boolean NOT NULL DEFAULT true,
  max_transfer_amount_minor bigint NOT NULL CHECK (max_transfer_amount_minor > 0),
  step_up_methods text[] NOT NULL
    CHECK (
      cardinality(step_up_methods) > 0
      AND step_up_methods <@ ARRAY['OTP', 'BIOMETRIC']::text[]
    ),
  updated_at timestamptz NOT NULL
);

-- Keep the reference's audit and journal history append-only at the DB role level.
-- Production deployment must also revoke UPDATE/DELETE on audit_events,
-- ledger_journals and ledger_entries from the application write role.

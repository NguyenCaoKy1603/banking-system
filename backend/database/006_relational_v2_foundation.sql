-- P0 relational-v2 foundation. Additive only: no request runtime reads this
-- migration yet. It prepares database-safe identity/account numbering,
-- command idempotency and the conditional quote/outbox invariants required by
-- the direct repository cutover.

CREATE SEQUENCE IF NOT EXISTS payment_account_number_seq
  AS bigint
  MINVALUE 100000000
  START WITH 100000000
  INCREMENT BY 1;

DO $$
DECLARE
  highest_suffix bigint;
BEGIN
  SELECT COALESCE(
    MAX((substring(account_number FROM '^9704([0-9]+)$'))::bigint),
    99999999
  )
  INTO highest_suffix
  FROM payment_accounts
  WHERE account_number ~ '^9704[0-9]+$';

  PERFORM setval(
    'payment_account_number_seq',
    GREATEST(highest_suffix, 100000000),
    true
  );

  UPDATE payment_accounts
  SET account_number = '9704' || nextval('payment_account_number_seq')::text
  WHERE account_number IS NULL;
END;
$$;

ALTER TABLE payment_accounts
  ALTER COLUMN account_number SET NOT NULL;

ALTER TABLE payment_accounts
  DROP CONSTRAINT IF EXISTS payment_accounts_account_number_format_check;

ALTER TABLE payment_accounts
  ADD CONSTRAINT payment_accounts_account_number_format_check
  CHECK (account_number ~ '^[0-9]{6,34}$');

CREATE UNIQUE INDEX IF NOT EXISTS payment_accounts_account_number_v2_idx
  ON payment_accounts (account_number);

ALTER TABLE transfer_quotes
  ADD COLUMN IF NOT EXISTS request_fingerprint text;

UPDATE transfer_quotes
SET request_fingerprint = 'legacy-transfer-quote:' || id::text
WHERE request_fingerprint IS NULL;

ALTER TABLE transfer_quotes
  ALTER COLUMN request_fingerprint SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transfer_quotes_consumed_transfer_fk'
  ) THEN
    ALTER TABLE transfer_quotes
      ADD CONSTRAINT transfer_quotes_consumed_transfer_fk
      FOREIGN KEY (consumed_transfer_id) REFERENCES transfers (id)
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE transfer_quotes
  VALIDATE CONSTRAINT transfer_quotes_consumed_transfer_fk;

CREATE INDEX IF NOT EXISTS transfer_quotes_active_customer_idx
  ON transfer_quotes (customer_id, expires_at)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS transfers_pending_updated_idx
  ON transfers (status, updated_at)
  WHERE status = 'PENDING';

ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS deduplication_key text;

CREATE UNIQUE INDEX IF NOT EXISTS outbox_events_deduplication_idx
  ON outbox_events (deduplication_key)
  WHERE deduplication_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS outbox_events_pending_attempt_idx
  ON outbox_events (next_attempt_at, occurred_at)
  WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS command_idempotency (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  operation_type text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  aggregate_id text,
  status text NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REVERSED')),
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, operation_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS command_idempotency_aggregate_idx
  ON command_idempotency (operation_type, aggregate_id)
  WHERE aggregate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS account_transactions_account_occurred_v2_idx
  ON account_transactions (account_id, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS auth_sessions_active_customer_idx
  ON auth_sessions (customer_id, expires_at)
  WHERE revoked_at IS NULL;

-- P0 savings source-of-truth hardening.  Existing 002 tables remain the
-- canonical shape; this migration adds operation-level idempotency and
-- maturity/renewal guards so retrying a worker cannot pay interest twice.

CREATE TABLE IF NOT EXISTS savings_idempotency (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  operation_type text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  opening_id uuid REFERENCES savings_openings (id),
  status text NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REVERSED')),
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, operation_type, idempotency_key)
);

CREATE TABLE IF NOT EXISTS savings_maturity_operations (
  id uuid PRIMARY KEY,
  deposit_id uuid NOT NULL REFERENCES savings_deposits (id),
  operation_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  resulting_deposit_id uuid REFERENCES savings_deposits (id),
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (deposit_id, operation_key)
);

ALTER TABLE savings_deposits
  ADD COLUMN IF NOT EXISTS maturity_operation_key text,
  ADD COLUMN IF NOT EXISTS renewal_sequence integer NOT NULL DEFAULT 0
    CHECK (renewal_sequence >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS savings_deposits_maturity_operation_idx
  ON savings_deposits (maturity_operation_key)
  WHERE maturity_operation_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS savings_deposits_renewed_parent_idx
  ON savings_deposits (renewed_deposit_id)
  WHERE renewed_deposit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS savings_deposits_due_idx
  ON savings_deposits (status, maturity_at, updated_at)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS savings_openings_pending_idx
  ON savings_openings (status, updated_at)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS savings_idempotency_pending_idx
  ON savings_idempotency (updated_at)
  WHERE status = 'PENDING';

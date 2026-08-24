-- P0 identity/runtime normalization.  The legacy JSON rows remain available
-- for audit and rollback, but newly migrated identity state has relational
-- ownership and lockable rows.

ALTER TABLE transfer_quotes
  DROP CONSTRAINT IF EXISTS transfer_quotes_consumed_transfer_fk;

ALTER TABLE transfer_quotes
  ADD CONSTRAINT transfer_quotes_consumed_transfer_fk
  FOREIGN KEY (consumed_transfer_id) REFERENCES transfers (id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS refresh_session_families (
  family_id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS refresh_session_records (
  session_key text PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  family_id uuid NOT NULL REFERENCES refresh_session_families (family_id),
  device_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS refresh_session_records_customer_idx
  ON refresh_session_records (customer_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_challenges (
  id text PRIMARY KEY,
  customer_id uuid REFERENCES customers (id),
  device_id text NOT NULL,
  purpose text NOT NULL,
  resource_id text,
  request_fingerprint text,
  methods text[] NOT NULL DEFAULT ARRAY['OTP']::text[],
  otp_hash text,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS auth_challenges_active_idx
  ON auth_challenges (customer_id, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS pending_registrations (
  id text PRIMARY KEY,
  full_name text NOT NULL,
  email text NOT NULL,
  phone_number text NOT NULL,
  password_salt text NOT NULL,
  password_digest text NOT NULL,
  device_id text NOT NULL,
  challenge_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS pending_registrations_email_idx
  ON pending_registrations (lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS pending_registrations_phone_idx
  ON pending_registrations (phone_number);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts >= 0),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Backfill refresh families/sessions where the legacy payload contains the
-- fields needed to preserve ownership and expiry.  Invalid/partial legacy
-- rows are intentionally left in the old table for manual reconciliation.
INSERT INTO refresh_session_families (family_id, customer_id, created_at)
SELECT DISTINCT
  (payload->>'familyId')::uuid,
  (payload->>'userId')::uuid,
  NOW()
FROM reference_runtime_records
WHERE collection = 'refreshSessions'
  AND payload->>'familyId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND payload->>'userId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
ON CONFLICT (family_id) DO NOTHING;

INSERT INTO refresh_session_records
  (session_key, customer_id, family_id, device_id, expires_at, revoked_at, created_at)
SELECT
  record_key,
  (payload->>'userId')::uuid,
  (payload->>'familyId')::uuid,
  payload->>'deviceId',
  to_timestamp(((payload->>'expiresAt')::double precision) / 1000.0),
  CASE WHEN COALESCE((payload->>'revoked')::boolean, false) THEN NOW() ELSE NULL END,
  NOW()
FROM reference_runtime_records
WHERE collection = 'refreshSessions'
  AND payload->>'userId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND payload->>'familyId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND payload->>'deviceId' IS NOT NULL
  AND payload->>'expiresAt' ~ '^[0-9]+([.][0-9]+)?$'
ON CONFLICT (session_key) DO NOTHING;

INSERT INTO rate_limit_buckets (bucket_key, window_started_at, attempts, updated_at)
SELECT
  collection || ':' || record_key,
  to_timestamp(((payload->>'startedAt')::double precision) / 1000.0),
  GREATEST(COALESCE((payload->>'attempts')::integer, 0), 0),
  NOW()
FROM reference_runtime_records
WHERE collection IN (
  'authAttemptWindows',
  'registrationAttemptWindows',
  'transferStepUpAttemptWindows',
  'savingsStepUpAttemptWindows',
  'creditStepUpAttemptWindows'
)
  AND payload->>'startedAt' ~ '^[0-9]+([.][0-9]+)?$'
ON CONFLICT (bucket_key) DO UPDATE
SET window_started_at = EXCLUDED.window_started_at,
    attempts = EXCLUDED.attempts,
    updated_at = EXCLUDED.updated_at;

CREATE INDEX IF NOT EXISTS auth_sessions_family_active_idx
  ON auth_sessions (family_id, expires_at)
  WHERE revoked_at IS NULL;

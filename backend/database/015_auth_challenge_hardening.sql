-- P0 challenge hardening.  Existing columns remain during the migration
-- window so older state snapshots can still be reconciled safely.

ALTER TABLE auth_challenges
  ADD COLUMN IF NOT EXISTS pending_registration_id text REFERENCES pending_registrations (id),
  ADD COLUMN IF NOT EXISTS credential_id uuid REFERENCES mfa_credentials (id),
  ADD COLUMN IF NOT EXISTS method text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS proof_digest text,
  ADD COLUMN IF NOT EXISTS digest_key_id text,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS resend_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_ip_fingerprint text,
  ADD COLUMN IF NOT EXISTS created_device_fingerprint text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW();

UPDATE auth_challenges
SET method = CASE
      WHEN method IS NOT NULL THEN method
      WHEN 'TOTP' = ANY(methods) THEN 'TOTP'
      ELSE 'EMAIL_OTP'
    END,
    proof_digest = COALESCE(proof_digest, otp_hash),
    status = CASE WHEN consumed_at IS NOT NULL THEN 'CONSUMED' ELSE status END,
    updated_at = NOW()
WHERE method IS NULL OR proof_digest IS NULL OR consumed_at IS NOT NULL;

ALTER TABLE auth_challenges
  DROP CONSTRAINT IF EXISTS auth_challenges_status_ck,
  DROP CONSTRAINT IF EXISTS auth_challenges_method_ck,
  DROP CONSTRAINT IF EXISTS auth_challenges_attempts_ck,
  DROP CONSTRAINT IF EXISTS auth_challenges_resend_count_ck,
  DROP CONSTRAINT IF EXISTS auth_challenges_terminal_timestamp_ck;

ALTER TABLE auth_challenges
  ADD CONSTRAINT auth_challenges_status_ck CHECK (
    status IN (
      'PENDING_DELIVERY', 'ACTIVE', 'VERIFIED', 'CONSUMED', 'EXPIRED',
      'LOCKED', 'CANCELLED', 'DELIVERY_FAILED'
    )
  ),
  ADD CONSTRAINT auth_challenges_method_ck CHECK (
    method IS NULL OR method IN ('EMAIL_OTP', 'SMS_OTP', 'TOTP')
  ),
  ADD CONSTRAINT auth_challenges_attempts_ck CHECK (attempts >= 0 AND max_attempts > 0),
  ADD CONSTRAINT auth_challenges_resend_count_ck CHECK (resend_count >= 0),
  ADD CONSTRAINT auth_challenges_terminal_timestamp_ck CHECK (
    (status <> 'CONSUMED' OR consumed_at IS NOT NULL)
    AND (status <> 'VERIFIED' OR verified_at IS NOT NULL OR consumed_at IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS auth_challenges_customer_active_idx
  ON auth_challenges (customer_id, purpose, resource_id, device_id, expires_at)
  WHERE status IN ('PENDING_DELIVERY', 'ACTIVE', 'VERIFIED');

CREATE INDEX IF NOT EXISTS auth_challenges_credential_active_idx
  ON auth_challenges (credential_id, expires_at)
  WHERE status IN ('PENDING_DELIVERY', 'ACTIVE', 'VERIFIED');

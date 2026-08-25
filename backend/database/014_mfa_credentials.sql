-- P0 TOTP credential storage.  Secrets are envelope-encrypted before they
-- reach this table; plaintext TOTP material must never be persisted here.

CREATE TABLE IF NOT EXISTS mfa_credentials (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  credential_type text NOT NULL CHECK (credential_type IN ('TOTP', 'PASSKEY', 'OOB_SMS')),
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED')),
  secret_ciphertext text,
  secret_key_id text,
  algorithm text NOT NULL DEFAULT 'SHA1',
  digits integer NOT NULL DEFAULT 6 CHECK (digits BETWEEN 6 AND 8),
  period_seconds integer NOT NULL DEFAULT 30 CHECK (period_seconds BETWEEN 15 AND 120),
  last_accepted_time_step bigint,
  enrolled_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  compromised_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT mfa_credentials_totp_material_ck CHECK (
    (credential_type = 'TOTP' AND secret_ciphertext IS NOT NULL AND secret_key_id IS NOT NULL
      AND algorithm = 'SHA1' AND digits = 6 AND period_seconds = 30)
    OR credential_type <> 'TOTP'
  )
);

CREATE INDEX IF NOT EXISTS mfa_credentials_customer_status_idx
  ON mfa_credentials (customer_id, status, credential_type);

CREATE UNIQUE INDEX IF NOT EXISTS mfa_credentials_customer_name_idx
  ON mfa_credentials (customer_id, lower(display_name))
  WHERE status <> 'REVOKED';

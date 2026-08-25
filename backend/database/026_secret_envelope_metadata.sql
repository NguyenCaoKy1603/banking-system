-- P0 secret hardening metadata. Additive only; migrations 001-025 remain immutable.
-- Ciphertext continues to carry its authenticated envelope. These columns make
-- key/version inventory and resumable re-encryption observable without storing
-- plaintext or a raw key.

ALTER TABLE mfa_credentials
  ADD COLUMN IF NOT EXISTS secret_cipher_version text NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS secret_aad_version text,
  ADD COLUMN IF NOT EXISTS secret_encryption_algorithm text NOT NULL DEFAULT 'AES-256-GCM',
  ADD COLUMN IF NOT EXISTS secret_encrypted_data_key text;

UPDATE mfa_credentials
SET secret_cipher_version = CASE WHEN secret_ciphertext LIKE 'v2.%' THEN 'v2' ELSE 'v1' END,
    secret_aad_version = CASE WHEN secret_ciphertext LIKE 'v2.%' THEN split_part(secret_ciphertext, '.', 3) ELSE NULL END,
    secret_encryption_algorithm = CASE WHEN secret_ciphertext LIKE 'v2.%' THEN 'AES-256-GCM-ENVELOPE' ELSE 'AES-256-GCM' END,
    secret_encrypted_data_key = CASE WHEN secret_ciphertext LIKE 'v2.%' THEN split_part(secret_ciphertext, '.', 7) ELSE NULL END
WHERE secret_ciphertext IS NOT NULL;

ALTER TABLE notification_endpoints
  ADD COLUMN IF NOT EXISTS address_cipher_version text NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS address_aad_version text,
  ADD COLUMN IF NOT EXISTS address_encryption_algorithm text NOT NULL DEFAULT 'AES-256-GCM',
  ADD COLUMN IF NOT EXISTS address_encrypted_data_key text;

UPDATE notification_endpoints
SET address_cipher_version = CASE WHEN address_ciphertext LIKE 'v2.%' THEN 'v2' ELSE 'v1' END,
    address_aad_version = CASE WHEN address_ciphertext LIKE 'v2.%' THEN split_part(address_ciphertext, '.', 3) ELSE NULL END,
    address_encryption_algorithm = CASE WHEN address_ciphertext LIKE 'v2.%' THEN 'AES-256-GCM-ENVELOPE' ELSE 'AES-256-GCM' END,
    address_encrypted_data_key = CASE WHEN address_ciphertext LIKE 'v2.%' THEN split_part(address_ciphertext, '.', 7) ELSE NULL END;

ALTER TABLE staff_mfa_credentials
  ADD COLUMN IF NOT EXISTS secret_cipher_version text NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS secret_aad_version text,
  ADD COLUMN IF NOT EXISTS secret_encryption_algorithm text NOT NULL DEFAULT 'AES-256-GCM',
  ADD COLUMN IF NOT EXISTS secret_encrypted_data_key text;

UPDATE staff_mfa_credentials
SET secret_cipher_version = CASE WHEN secret_ciphertext LIKE 'v2.%' THEN 'v2' ELSE 'v1' END,
    secret_aad_version = CASE WHEN secret_ciphertext LIKE 'v2.%' THEN split_part(secret_ciphertext, '.', 3) ELSE NULL END,
    secret_encryption_algorithm = CASE WHEN secret_ciphertext LIKE 'v2.%' THEN 'AES-256-GCM-ENVELOPE' ELSE 'AES-256-GCM' END,
    secret_encrypted_data_key = CASE WHEN secret_ciphertext LIKE 'v2.%' THEN split_part(secret_ciphertext, '.', 7) ELSE NULL END;

CREATE TABLE IF NOT EXISTS encryption_rekey_checkpoints (
  job_id text PRIMARY KEY,
  environment text NOT NULL,
  record_type text NOT NULL,
  from_key_id text,
  to_key_id text NOT NULL,
  last_record_id uuid,
  status text NOT NULL DEFAULT 'PREPARED'
    CHECK (status IN ('PREPARED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED')),
  scanned_count bigint NOT NULL DEFAULT 0 CHECK (scanned_count >= 0),
  reencrypted_count bigint NOT NULL DEFAULT 0 CHECK (reencrypted_count >= 0),
  failed_count bigint NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  last_error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS encryption_rekey_checkpoints_status_idx
  ON encryption_rekey_checkpoints (environment, record_type, status, updated_at DESC);

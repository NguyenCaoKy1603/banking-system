-- P0 secret rotation inventory follow-up. Additive only; migration 026 is immutable.
-- Keep endpoint key identity and re-encryption timestamps queryable without
-- storing any plaintext or key material.

ALTER TABLE notification_endpoints
  ADD COLUMN IF NOT EXISTS address_key_id text,
  ADD COLUMN IF NOT EXISTS address_reencrypted_at timestamptz;

UPDATE notification_endpoints
SET address_key_id = split_part(address_ciphertext, '.', 2)
WHERE address_key_id IS NULL
  AND address_ciphertext LIKE 'v2.%'
  AND split_part(address_ciphertext, '.', 2) <> '';

ALTER TABLE mfa_credentials
  ADD COLUMN IF NOT EXISTS secret_reencrypted_at timestamptz;

ALTER TABLE staff_mfa_credentials
  ADD COLUMN IF NOT EXISTS secret_reencrypted_at timestamptz;

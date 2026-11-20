-- 046_biometric_authentication.sql
-- Forward-only migration for device-bound biometric MFA credentials and step-up challenges.

ALTER TABLE mfa_credentials
  ADD COLUMN IF NOT EXISTS device_id text;

ALTER TABLE mfa_credentials
  DROP CONSTRAINT IF EXISTS mfa_credentials_credential_type_check;

ALTER TABLE mfa_credentials
  ADD CONSTRAINT mfa_credentials_credential_type_check
  CHECK (credential_type IN ('TOTP', 'BIOMETRIC', 'PASSKEY', 'OOB_SMS'));

CREATE UNIQUE INDEX IF NOT EXISTS mfa_credentials_biometric_device_idx
  ON mfa_credentials (customer_id, device_id)
  WHERE credential_type = 'BIOMETRIC' AND status = 'ACTIVE' AND device_id IS NOT NULL;

ALTER TABLE auth_challenges
  DROP CONSTRAINT IF EXISTS auth_challenges_method_ck,
  DROP CONSTRAINT IF EXISTS auth_challenges_method_credential_ck;

ALTER TABLE auth_challenges
  ADD CONSTRAINT auth_challenges_method_ck CHECK (
    method IS NULL OR method IN ('EMAIL_OTP', 'SMS_OTP', 'TOTP', 'BIOMETRIC')
  ),
  ADD CONSTRAINT auth_challenges_method_credential_ck CHECK (
    (method IN ('TOTP', 'BIOMETRIC') AND credential_id IS NOT NULL)
    OR (method IN ('EMAIL_OTP', 'SMS_OTP') AND credential_id IS NULL)
  );

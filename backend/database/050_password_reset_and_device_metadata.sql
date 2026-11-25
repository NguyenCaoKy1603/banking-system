-- 050_password_reset_and_device_metadata.sql
-- Forward-only migration adding PASSWORD_RESET / PASSWORD_CHANGE challenge purposes
-- and device metadata (device_name, last_seen_at) on customer_devices.

ALTER TABLE auth_challenges
  DROP CONSTRAINT IF EXISTS auth_challenges_purpose_ck;

ALTER TABLE auth_challenges
  ADD CONSTRAINT auth_challenges_purpose_ck CHECK (
    purpose IN (
      'REGISTRATION_VERIFY', 'REGISTRATION_EMAIL_VERIFY', 'EMAIL_CHANGE_VERIFY',
      'RECOVERY_EMAIL_VERIFY', 'PASSWORD_RESET', 'PASSWORD_CHANGE',
      'LOGIN', 'TRANSFER', 'SAVINGS_OPENING', 'SAVINGS_WITHDRAWAL',
      'CREDIT_APPLICATION', 'CARD_ACTIVATION', 'CREDIT_PAYMENT', 'CARD_UNLOCK',
      'CARD_REPORT_LOST', 'MFA_TOTP_ENROLLMENT', 'MFA_FACTOR_CHANGE',
      'MFA_FACTOR_REMOVAL', 'MFA_RECOVERY', 'RECOVERY_CODE_ROTATION'
    )
  );

ALTER TABLE customer_devices
  ADD COLUMN IF NOT EXISTS device_name text,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

UPDATE customer_devices
SET last_seen_at = created_at
WHERE last_seen_at IS NULL;

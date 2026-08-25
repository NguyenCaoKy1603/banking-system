-- Follow-up constraints for databases that already applied 015_auth_challenge_hardening.
-- Kept separate so migration checksums remain immutable after deployment.

UPDATE auth_challenges
SET method = CASE
      WHEN method IS NOT NULL THEN method
      WHEN 'TOTP' = ANY(methods) THEN 'TOTP'
      ELSE 'EMAIL_OTP'
    END,
    updated_at = NOW()
WHERE method IS NULL;

ALTER TABLE auth_challenges
  DROP CONSTRAINT IF EXISTS auth_challenges_method_credential_ck,
  DROP CONSTRAINT IF EXISTS auth_challenges_purpose_ck;

ALTER TABLE auth_challenges
  ALTER COLUMN method SET NOT NULL,
  ADD CONSTRAINT auth_challenges_method_credential_ck CHECK (
    (method = 'TOTP' AND credential_id IS NOT NULL)
    OR (method IN ('EMAIL_OTP', 'SMS_OTP') AND credential_id IS NULL)
  ),
  ADD CONSTRAINT auth_challenges_purpose_ck CHECK (
    purpose IN (
      'REGISTRATION_VERIFY', 'REGISTRATION_EMAIL_VERIFY', 'EMAIL_CHANGE_VERIFY',
      'RECOVERY_EMAIL_VERIFY', 'LOGIN', 'TRANSFER', 'SAVINGS_OPENING',
      'CREDIT_APPLICATION', 'CARD_ACTIVATION', 'CREDIT_PAYMENT', 'CARD_UNLOCK',
      'MFA_TOTP_ENROLLMENT', 'MFA_FACTOR_CHANGE', 'MFA_FACTOR_REMOVAL',
      'MFA_RECOVERY', 'RECOVERY_CODE_ROTATION'
    )
  );

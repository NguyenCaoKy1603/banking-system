-- 044_savings_early_withdrawal.sql
-- Forward-only migration to enable SAVINGS_WITHDRAWAL step-up purpose
-- and track early withdrawal timestamps and interest.

ALTER TABLE auth_challenges
  DROP CONSTRAINT IF EXISTS auth_challenges_purpose_ck;

ALTER TABLE auth_challenges
  ADD CONSTRAINT auth_challenges_purpose_ck CHECK (
    purpose IN (
      'REGISTRATION_VERIFY', 'REGISTRATION_EMAIL_VERIFY', 'EMAIL_CHANGE_VERIFY',
      'RECOVERY_EMAIL_VERIFY', 'LOGIN', 'TRANSFER', 'SAVINGS_OPENING',
      'SAVINGS_WITHDRAWAL',
      'CREDIT_APPLICATION', 'CARD_ACTIVATION', 'CREDIT_PAYMENT', 'CARD_UNLOCK',
      'CARD_REPORT_LOST', 'MFA_TOTP_ENROLLMENT', 'MFA_FACTOR_CHANGE',
      'MFA_FACTOR_REMOVAL', 'MFA_RECOVERY', 'RECOVERY_CODE_ROTATION'
    )
  );

ALTER TABLE savings_deposits
  ADD COLUMN IF NOT EXISTS early_withdrawn_at timestamptz,
  ADD COLUMN IF NOT EXISTS early_interest_minor bigint DEFAULT 0;

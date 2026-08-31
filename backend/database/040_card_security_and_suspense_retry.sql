-- Complete the two remaining operations hand-offs: a reported-lost card is a
-- durable case, and a savings maturity suspense can be retried and dead-lettered
-- without replaying the original maturity command.

CREATE TABLE IF NOT EXISTS card_security_cases (
  id uuid PRIMARY KEY,
  card_id uuid NOT NULL REFERENCES credit_cards (id),
  customer_id uuid NOT NULL REFERENCES customers (id),
  case_type text NOT NULL CHECK (case_type IN ('REPORTED_LOST')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_REVIEW', 'RESOLVED')),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS card_security_cases_one_open_idx
  ON card_security_cases (card_id, case_type)
  WHERE status IN ('OPEN', 'IN_REVIEW');

CREATE INDEX IF NOT EXISTS card_security_cases_queue_idx
  ON card_security_cases (status, created_at, id)
  WHERE status IN ('OPEN', 'IN_REVIEW');

ALTER TABLE auth_challenges
  DROP CONSTRAINT IF EXISTS auth_challenges_purpose_ck;

ALTER TABLE auth_challenges
  ADD CONSTRAINT auth_challenges_purpose_ck CHECK (
    purpose IN (
      'REGISTRATION_VERIFY', 'REGISTRATION_EMAIL_VERIFY', 'EMAIL_CHANGE_VERIFY',
      'RECOVERY_EMAIL_VERIFY', 'LOGIN', 'TRANSFER', 'SAVINGS_OPENING',
      'CREDIT_APPLICATION', 'CARD_ACTIVATION', 'CREDIT_PAYMENT', 'CARD_UNLOCK',
      'CARD_REPORT_LOST', 'MFA_TOTP_ENROLLMENT', 'MFA_FACTOR_CHANGE',
      'MFA_FACTOR_REMOVAL', 'MFA_RECOVERY', 'RECOVERY_CODE_ROTATION'
    )
  );

ALTER TABLE savings_maturity_suspense
  DROP CONSTRAINT IF EXISTS savings_maturity_suspense_status_check;

ALTER TABLE savings_maturity_suspense
  ADD CONSTRAINT savings_maturity_suspense_status_check
  CHECK (status IN ('PENDING', 'RESOLVED', 'DEAD'));

ALTER TABLE savings_maturity_suspense
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS resolved_account_id uuid REFERENCES payment_accounts (id),
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

DROP INDEX IF EXISTS savings_maturity_suspense_queue_idx;

CREATE INDEX IF NOT EXISTS savings_maturity_suspense_queue_idx
  ON savings_maturity_suspense (next_attempt_at, created_at, id)
  WHERE status = 'PENDING';

GRANT SELECT, INSERT, UPDATE ON card_security_cases TO banking_public_api, banking_worker;

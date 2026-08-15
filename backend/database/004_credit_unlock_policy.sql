-- Compatibility migration for PostgreSQL databases where migration 003 was
-- already recorded before the card unlock policy field was added.

ALTER TABLE control_policy
  ADD COLUMN IF NOT EXISTS card_unlock_step_up_methods text[]
    NOT NULL DEFAULT ARRAY['OTP', 'BIOMETRIC']::text[]
    CHECK (
      cardinality(card_unlock_step_up_methods) > 0
      AND card_unlock_step_up_methods <@ ARRAY['OTP', 'BIOMETRIC']::text[]
    );

-- Bootstrap the singleton customer-control policy required by the direct
-- relational-v2 HTTP boundary.  It is control-plane configuration, not
-- request-owned state: a missing row must leave readiness failed closed.
--
-- The production-like runtime uses TOTP for customer step-up.  Earlier
-- sandbox constraints predate that runtime and allowed only OTP/BIOMETRIC,
-- so expand every policy method constraint before writing the initial row.

ALTER TABLE control_policy
  DROP CONSTRAINT IF EXISTS control_policy_step_up_methods_check,
  DROP CONSTRAINT IF EXISTS control_policy_savings_step_up_methods_check,
  DROP CONSTRAINT IF EXISTS control_policy_credit_payment_step_up_methods_check,
  DROP CONSTRAINT IF EXISTS control_policy_card_unlock_step_up_methods_check;

ALTER TABLE control_policy
  ADD CONSTRAINT control_policy_step_up_methods_check
    CHECK (
      cardinality(step_up_methods) > 0
      AND step_up_methods <@ ARRAY['OTP', 'TOTP', 'BIOMETRIC']::text[]
    ),
  ADD CONSTRAINT control_policy_savings_step_up_methods_check
    CHECK (
      cardinality(savings_step_up_methods) > 0
      AND savings_step_up_methods <@ ARRAY['OTP', 'TOTP', 'BIOMETRIC']::text[]
    ),
  ADD CONSTRAINT control_policy_credit_payment_step_up_methods_check
    CHECK (
      cardinality(credit_payment_step_up_methods) > 0
      AND credit_payment_step_up_methods <@ ARRAY['OTP', 'TOTP', 'BIOMETRIC']::text[]
    ),
  ADD CONSTRAINT control_policy_card_unlock_step_up_methods_check
    CHECK (
      cardinality(card_unlock_step_up_methods) > 0
      AND card_unlock_step_up_methods <@ ARRAY['OTP', 'TOTP', 'BIOMETRIC']::text[]
    );

-- Preserve any policy that was deliberately created by an operator.  On a
-- new database this establishes exactly one deterministic relational-v2
-- baseline; a replay never creates a second policy or overwrites an override.
INSERT INTO control_policy (
  singleton,
  config_version,
  global_kill_switch,
  transfers_enabled,
  allowlist_enabled,
  max_transfer_amount_minor,
  step_up_methods,
  savings_enabled,
  savings_allowlist_enabled,
  max_savings_amount_minor,
  savings_step_up_methods,
  credit_enabled,
  credit_allowlisted,
  credit_payments_enabled,
  card_controls_enabled,
  max_credit_payment_amount_minor,
  credit_payment_step_up_methods,
  card_unlock_step_up_methods,
  updated_at
)
VALUES (
  true,
  'm7-sandbox-1',
  false,
  true,
  true,
  5000000,
  ARRAY['TOTP']::text[],
  true,
  true,
  500000000,
  ARRAY['TOTP']::text[],
  true,
  true,
  true,
  true,
  20000000,
  ARRAY['TOTP']::text[],
  ARRAY['TOTP']::text[],
  NOW()
)
ON CONFLICT (singleton) DO NOTHING;

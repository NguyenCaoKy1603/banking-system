-- 051_dynamic_transfer_fee_policy.sql
-- Forward-only migration adding configurable transfer fee to control_policy.

ALTER TABLE control_policy
  ADD COLUMN IF NOT EXISTS transfer_fee_minor bigint NOT NULL DEFAULT 1000
  CHECK (transfer_fee_minor >= 0);

-- 048_daily_transfer_limit_policy.sql
-- Forward-only migration adding daily cumulative transfer limit to control_policy.

ALTER TABLE control_policy
  ADD COLUMN IF NOT EXISTS daily_transfer_limit_minor bigint NOT NULL DEFAULT 50000000
  CHECK (daily_transfer_limit_minor > 0);

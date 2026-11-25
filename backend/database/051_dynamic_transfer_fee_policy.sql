-- 051_dynamic_transfer_fee_policy.sql
-- Forward-only migration adding configurable transfer fee to control_policy.

ALTER TABLE control_policy
  ADD COLUMN IF NOT EXISTS transfer_fee_minor bigint NOT NULL DEFAULT 1000
  CHECK (transfer_fee_minor >= 0);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'banking_admin_api') THEN
    GRANT SELECT, UPDATE ON control_policy TO banking_admin_api;
    GRANT SELECT ON ledger_journals, ledger_entries TO banking_admin_api;
  END IF;
END
$$;

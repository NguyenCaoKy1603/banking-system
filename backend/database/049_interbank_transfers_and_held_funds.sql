-- 049_interbank_transfers_and_held_funds.sql
-- Forward-only migration enabling NAPAS IBFT interbank recipient lookup,
-- quotes, and two-phase held_minor accounting on transfers.

ALTER TABLE recipient_lookups
  ALTER COLUMN destination_account_id DROP NOT NULL,
  ALTER COLUMN destination_owner_id DROP NOT NULL;

ALTER TABLE recipient_lookups
  ADD COLUMN IF NOT EXISTS rail text NOT NULL DEFAULT 'INTERNAL'
    CHECK (rail IN ('INTERNAL', 'NAPAS_IBFT')),
  ADD COLUMN IF NOT EXISTS bank_bin text,
  ADD COLUMN IF NOT EXISTS external_account_number text;

ALTER TABLE transfer_quotes
  ADD COLUMN IF NOT EXISTS rail text NOT NULL DEFAULT 'INTERNAL'
    CHECK (rail IN ('INTERNAL', 'NAPAS_IBFT')),
  ADD COLUMN IF NOT EXISTS external_bank_bin text,
  ADD COLUMN IF NOT EXISTS external_bank_name text,
  ADD COLUMN IF NOT EXISTS external_account_number text;

ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS rail text NOT NULL DEFAULT 'INTERNAL'
    CHECK (rail IN ('INTERNAL', 'NAPAS_IBFT')),
  ADD COLUMN IF NOT EXISTS external_bank_bin text,
  ADD COLUMN IF NOT EXISTS external_bank_name text,
  ADD COLUMN IF NOT EXISTS external_account_number text,
  ADD COLUMN IF NOT EXISTS external_account_holder_name text,
  ADD COLUMN IF NOT EXISTS napas_trace_id text,
  ADD COLUMN IF NOT EXISTS failure_reason text;

-- Reference sandbox relational persistence checkpoint.
--
-- The mandatory M0-M4/M8 business records are stored in the relational
-- tables from 001-004.  This migration adds the columns needed to preserve
-- the immutable quote/core transfer state exactly.  Ephemeral authentication
-- state and the optional M6/M7 reference records are stored one record per
-- row in reference_runtime_records; they are deliberately not a single
-- application-wide JSON snapshot.

ALTER TABLE payment_accounts
  ADD COLUMN IF NOT EXISTS account_number text,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS opening_balance_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS held_minor bigint NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS payment_accounts_account_number_idx
  ON payment_accounts (account_number)
  WHERE account_number IS NOT NULL;

ALTER TABLE beneficiaries
  ADD COLUMN IF NOT EXISTS account_holder_name text,
  ADD COLUMN IF NOT EXISTS destination_account_id uuid,
  ADD COLUMN IF NOT EXISTS destination_owner_id uuid;

ALTER TABLE transfer_quotes
  ALTER COLUMN beneficiary_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS beneficiary_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS destination_account_id uuid,
  ADD COLUMN IF NOT EXISTS destination_owner_id uuid,
  ADD COLUMN IF NOT EXISTS consumed_transfer_id uuid;

ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS destination_account_id uuid,
  ADD COLUMN IF NOT EXISTS destination_owner_id uuid,
  ADD COLUMN IF NOT EXISTS source_transaction_id uuid,
  ADD COLUMN IF NOT EXISTS destination_transaction_id uuid,
  ADD COLUMN IF NOT EXISTS ledger_journal_id uuid,
  ADD COLUMN IF NOT EXISTS refunded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS held_minor bigint NOT NULL DEFAULT 0;

ALTER TABLE account_transactions
  ADD COLUMN IF NOT EXISTS kind text;

ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS entry_id uuid,
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_entry_id_idx
  ON ledger_entries (entry_id)
  WHERE entry_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS reference_runtime_records (
  collection text NOT NULL,
  record_key text NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (collection, record_key)
);

CREATE INDEX IF NOT EXISTS reference_runtime_records_collection_idx
  ON reference_runtime_records (collection, updated_at DESC);

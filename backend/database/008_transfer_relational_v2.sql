-- P0 transfer relational hardening.  All changes are additive or constraint
-- tightening after the 006/007 backfills have established valid references.

ALTER TABLE transfers
  ADD CONSTRAINT transfers_destination_account_fk
  FOREIGN KEY (destination_account_id) REFERENCES payment_accounts (id)
  NOT VALID;

ALTER TABLE transfers
  VALIDATE CONSTRAINT transfers_destination_account_fk;

ALTER TABLE transfer_quotes
  ADD CONSTRAINT transfer_quotes_destination_account_fk
  FOREIGN KEY (destination_account_id) REFERENCES payment_accounts (id)
  NOT VALID;

ALTER TABLE transfer_quotes
  VALIDATE CONSTRAINT transfer_quotes_destination_account_fk;

CREATE INDEX IF NOT EXISTS transfers_source_status_updated_idx
  ON transfers (source_account_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS transfers_destination_status_updated_idx
  ON transfers (destination_account_id, status, updated_at DESC)
  WHERE destination_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS transfer_quotes_consumed_transfer_idx
  ON transfer_quotes (consumed_transfer_id)
  WHERE consumed_transfer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_accounts_customer_status_idx
  ON payment_accounts (customer_id, status, updated_at DESC);

-- Keep the old adapter able to replay a state while v2 is being rehearsed,
-- but make the idempotency and quote invariants explicit in the schema.
ALTER TABLE command_idempotency
  ADD CONSTRAINT command_idempotency_fingerprint_nonempty
  CHECK (length(trim(request_fingerprint)) > 0);

CREATE INDEX IF NOT EXISTS command_idempotency_pending_updated_idx
  ON command_idempotency (updated_at)
  WHERE status = 'PENDING';

-- A customer delete is a tombstone, not a risk block.  Historical quotes and
-- transfers keep their immutable snapshots while a deleted target can be
-- recreated later.

ALTER TABLE beneficiaries
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE beneficiaries
  DROP CONSTRAINT IF EXISTS beneficiaries_status_check;

ALTER TABLE beneficiaries
  ADD CONSTRAINT beneficiaries_status_check
  CHECK (status IN ('ACTIVE', 'BLOCKED', 'DELETED'));

UPDATE beneficiaries
SET deleted_at = COALESCE(deleted_at, created_at)
WHERE status = 'DELETED' AND deleted_at IS NULL;

DROP INDEX IF EXISTS beneficiaries_identity_idx;
CREATE UNIQUE INDEX IF NOT EXISTS beneficiaries_identity_active_idx
  ON beneficiaries (customer_id, account_number_fingerprint, lower(bank_name))
  WHERE deleted_at IS NULL AND status <> 'DELETED';

CREATE INDEX IF NOT EXISTS beneficiaries_customer_active_idx
  ON beneficiaries (customer_id, created_at DESC, id)
  WHERE deleted_at IS NULL;

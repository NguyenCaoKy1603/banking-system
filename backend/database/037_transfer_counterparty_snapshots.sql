-- Immutable counterparty evidence for both sides of a transfer.  Existing
-- rows remain valid; new writes populate the names from server-side snapshots.

ALTER TABLE transfer_quotes
  ADD COLUMN IF NOT EXISTS destination_owner_name text;

UPDATE transfer_quotes q
SET destination_owner_name = COALESCE(
  q.beneficiary_snapshot ->> 'accountHolderName',
  q.beneficiary_snapshot ->> 'displayName',
  c.full_name
)
FROM customers c
WHERE q.destination_owner_id = c.id
  AND q.destination_owner_name IS NULL;

CREATE INDEX IF NOT EXISTS transfer_quotes_destination_owner_idx
  ON transfer_quotes (destination_owner_id, created_at DESC);

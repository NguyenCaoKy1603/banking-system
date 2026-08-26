-- Operational metadata for safe worker state transitions.
-- Kept separate from 012 so the already-applied additive boundary remains
-- checksum-stable on preview databases.

ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW();

UPDATE outbox_events
SET updated_at = COALESCE(updated_at, created_at, occurred_at, NOW());

CREATE INDEX IF NOT EXISTS outbox_events_updated_v2_idx
  ON outbox_events (updated_at DESC, id);

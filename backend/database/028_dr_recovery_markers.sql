-- P1 disaster-recovery marker stream.
-- Markers contain no customer or secret data; they only make an eventual
-- production-like PITR/RPO rehearsal measurable. The local preview does not
-- enable WAL archiving, so this table is a preparation seam, not RPO evidence.

CREATE TABLE IF NOT EXISTS dr_recovery_markers (
  id uuid PRIMARY KEY,
  committed_at timestamptz NOT NULL,
  marker_hash text NOT NULL,
  source_release_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT dr_recovery_markers_hash_ck CHECK (marker_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT dr_recovery_markers_release_ck CHECK (length(source_release_id) BETWEEN 1 AND 200),
  CONSTRAINT dr_recovery_markers_hash_unique UNIQUE (marker_hash)
);

CREATE INDEX IF NOT EXISTS dr_recovery_markers_committed_idx
  ON dr_recovery_markers (committed_at DESC);

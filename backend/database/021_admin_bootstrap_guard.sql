-- One-time bootstrap guard. A reserved row is intentionally not reusable after
-- a failed run without an audited recovery procedure.
CREATE TABLE IF NOT EXISTS admin_bootstrap_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton = true),
  reserved_at timestamptz,
  completed_at timestamptz,
  reserved_by text
);

INSERT INTO admin_bootstrap_state (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

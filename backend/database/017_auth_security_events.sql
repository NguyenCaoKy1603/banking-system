-- Security telemetry metadata.  The application must redact proofs, secrets,
-- tokens, raw IP addresses and full account numbers before inserting metadata.

CREATE TABLE IF NOT EXISTS auth_security_events (
  id uuid PRIMARY KEY,
  customer_id uuid REFERENCES customers (id),
  event_type text NOT NULL,
  purpose text,
  device_fingerprint text,
  network_fingerprint text,
  risk_score integer CHECK (risk_score IS NULL OR risk_score BETWEEN 0 AND 100),
  risk_decision text CHECK (risk_decision IS NULL OR risk_decision IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'ALLOW', 'CHALLENGE', 'BLOCK', 'REVIEW')),
  challenge_id text REFERENCES auth_challenges (id),
  resource_id text,
  occurred_at timestamptz NOT NULL DEFAULT NOW(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT auth_security_events_metadata_object_ck CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS auth_security_events_customer_time_idx
  ON auth_security_events (customer_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS auth_security_events_type_time_idx
  ON auth_security_events (event_type, occurred_at DESC);

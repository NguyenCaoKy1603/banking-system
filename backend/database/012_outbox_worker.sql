-- P0 transactional outbox worker boundary. Additive only.
-- The worker is intentionally disabled until the HTTP persistence cutover has
-- removed the legacy full-state writer. Existing events are retained and are
-- marked as legacy so they can be reconciled explicitly before dispatch.

ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS event_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS aggregate_type text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS aggregate_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS locked_by text,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz,
  ADD COLUMN IF NOT EXISTS skipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS trace_id text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT NOW();

UPDATE outbox_events
SET event_version = GREATEST(event_version, 1),
    aggregate_type = COALESCE(NULLIF(aggregate_type, ''), 'legacy'),
    aggregate_version = GREATEST(aggregate_version, 1),
    status = CASE
      WHEN published_at IS NOT NULL THEN 'DISPATCHED'
      ELSE COALESCE(NULLIF(status, ''), 'PENDING')
    END,
    deduplication_key = COALESCE(NULLIF(deduplication_key, ''), 'legacy:' || id::text),
    created_at = COALESCE(created_at, occurred_at, NOW());

ALTER TABLE outbox_events
  ALTER COLUMN deduplication_key SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outbox_events_status_check'
  ) THEN
    ALTER TABLE outbox_events
      ADD CONSTRAINT outbox_events_status_check
      CHECK (status IN ('PENDING', 'PROCESSING', 'DISPATCHED', 'DEAD', 'SKIPPED'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outbox_events_event_version_check'
  ) THEN
    ALTER TABLE outbox_events
      ADD CONSTRAINT outbox_events_event_version_check CHECK (event_version > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outbox_events_aggregate_version_check'
  ) THEN
    ALTER TABLE outbox_events
      ADD CONSTRAINT outbox_events_aggregate_version_check CHECK (aggregate_version > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outbox_events_attempts_check'
  ) THEN
    ALTER TABLE outbox_events
      ADD CONSTRAINT outbox_events_attempts_check CHECK (attempts >= 0);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS outbox_events_claim_v2_idx
  ON outbox_events (priority, COALESCE(next_attempt_at, occurred_at), occurred_at, id)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS outbox_events_lease_v2_idx
  ON outbox_events (lease_expires_at, id)
  WHERE status = 'PROCESSING';

CREATE INDEX IF NOT EXISTS outbox_events_dead_v2_idx
  ON outbox_events (dead_lettered_at DESC, id)
  WHERE status = 'DEAD';

CREATE TABLE IF NOT EXISTS notification_endpoints (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  device_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('PUSH', 'EMAIL')),
  provider text NOT NULL CHECK (provider IN ('EXPO', 'FCM', 'SMTP', 'EMAIL_API', 'FAKE')),
  platform text,
  address_ciphertext text NOT NULL,
  address_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INVALID', 'REVOKED')),
  last_seen_at timestamptz NOT NULL DEFAULT NOW(),
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_endpoints_identity_idx
  ON notification_endpoints (customer_id, device_id, channel, address_fingerprint);

CREATE INDEX IF NOT EXISTS notification_endpoints_customer_status_idx
  ON notification_endpoints (customer_id, device_id, status);

CREATE TABLE IF NOT EXISTS notification_preferences (
  customer_id uuid NOT NULL REFERENCES customers (id),
  category text NOT NULL CHECK (category IN ('TRANSFER', 'SAVINGS', 'CREDIT', 'SECURITY')),
  channel text NOT NULL CHECK (channel IN ('PUSH', 'EMAIL')),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (customer_id, category, channel)
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id uuid PRIMARY KEY,
  outbox_event_id uuid NOT NULL REFERENCES outbox_events (id),
  notification_id uuid NOT NULL REFERENCES notifications (id),
  customer_id uuid NOT NULL REFERENCES customers (id),
  endpoint_id uuid NOT NULL REFERENCES notification_endpoints (id),
  channel text NOT NULL CHECK (channel IN ('PUSH', 'EMAIL')),
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'DEAD', 'SKIPPED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz,
  locked_by text,
  locked_at timestamptz,
  lease_expires_at timestamptz,
  provider_message_id text,
  last_error_code text,
  last_error_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_deliveries_identity_idx
  ON notification_deliveries (outbox_event_id, notification_id, channel, endpoint_id);

CREATE INDEX IF NOT EXISTS notification_deliveries_claim_idx
  ON notification_deliveries (next_attempt_at, created_at, id)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS notification_deliveries_lease_idx
  ON notification_deliveries (lease_expires_at, id)
  WHERE status = 'PROCESSING';

CREATE TABLE IF NOT EXISTS dead_letter_events (
  id uuid PRIMARY KEY,
  source_kind text NOT NULL CHECK (source_kind IN ('OUTBOX', 'DELIVERY')),
  source_id uuid NOT NULL,
  event_type text NOT NULL,
  event_version integer NOT NULL CHECK (event_version > 0),
  payload_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  final_error_code text NOT NULL,
  final_error_summary text NOT NULL,
  first_failed_at timestamptz NOT NULL DEFAULT NOW(),
  dead_lettered_at timestamptz NOT NULL DEFAULT NOW(),
  requeued_at timestamptz,
  requeued_by text,
  requeue_reason text,
  UNIQUE (source_kind, source_id)
);

CREATE INDEX IF NOT EXISTS dead_letter_events_recent_idx
  ON dead_letter_events (dead_lettered_at DESC, source_kind);

CREATE TABLE IF NOT EXISTS worker_instances (
  worker_id text PRIMARY KEY,
  worker_version text NOT NULL,
  started_at timestamptz NOT NULL,
  last_heartbeat_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('STARTING', 'READY', 'DRAINING', 'STOPPED')),
  hostname text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS worker_instances_heartbeat_idx
  ON worker_instances (last_heartbeat_at DESC, status);

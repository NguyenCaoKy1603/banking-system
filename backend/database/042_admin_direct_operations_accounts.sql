-- Record direct Operations-account creations so a lost HTTP response can be
-- retried safely without storing passwords, MFA keys, or OTPs.
CREATE TABLE IF NOT EXISTS admin_staff_account_creation_requests (
  requester_staff_id uuid NOT NULL REFERENCES staff_users (id),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  staff_id uuid NOT NULL REFERENCES staff_users (id),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (requester_staff_id, idempotency_key)
);

GRANT SELECT, INSERT ON admin_staff_account_creation_requests TO banking_admin_api;

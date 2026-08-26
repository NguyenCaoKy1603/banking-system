-- P0 one-time recovery material and explicit recovery state machine.

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  code_digest text NOT NULL,
  salt text NOT NULL,
  digest_key_id text,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'USED', 'REVOKED')),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT mfa_recovery_codes_terminal_timestamp_ck CHECK (
    (status <> 'USED' OR used_at IS NOT NULL)
    AND (status <> 'REVOKED' OR revoked_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS mfa_recovery_codes_customer_status_idx
  ON mfa_recovery_codes (customer_id, status);

CREATE TABLE IF NOT EXISTS mfa_recovery_requests (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  public_token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN (
      'REQUESTED', 'PRIMARY_PROOF_VERIFIED', 'PENDING_REVIEW', 'COOLDOWN',
      'APPROVED', 'COMPLETED', 'REJECTED', 'EXPIRED', 'CANCELLED'
    )),
  requested_method text NOT NULL CHECK (requested_method IN ('RECOVERY_CODE', 'OPERATOR_REVIEW')),
  risk_level text NOT NULL DEFAULT 'MEDIUM' CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  requested_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  approved_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cooldown_until timestamptz,
  reviewed_by text,
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT mfa_recovery_requests_terminal_timestamp_ck CHECK (
    (status <> 'COMPLETED' OR completed_at IS NOT NULL)
    AND (status <> 'CANCELLED' OR cancelled_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS mfa_recovery_requests_customer_status_idx
  ON mfa_recovery_requests (customer_id, status, expires_at);

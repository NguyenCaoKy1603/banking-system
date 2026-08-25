-- P0 Admin control plane. Additive only; migration 001-018 are immutable.
-- This schema is for the virtual-money reference sandbox and is deliberately
-- separated from customer identity/session tables.

CREATE TABLE IF NOT EXISTS staff_users (
  id uuid PRIMARY KEY,
  employee_code text NOT NULL UNIQUE,
  email_normalized text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_salt text,
  password_digest text,
  status text NOT NULL DEFAULT 'INVITED'
    CHECK (status IN ('INVITED', 'ACTIVE', 'LOCKED', 'DISABLED')),
  authorization_version bigint NOT NULL DEFAULT 1 CHECK (authorization_version > 0),
  password_changed_at timestamptz,
  mfa_enrolled_at timestamptz,
  last_login_at timestamptz,
  created_by_staff_id uuid REFERENCES staff_users (id),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (length(trim(employee_code)) >= 2),
  CHECK (email_normalized = lower(email_normalized)),
  CHECK ((status = 'INVITED' AND password_digest IS NULL) OR status <> 'INVITED')
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_users_email_lower_idx
  ON staff_users (lower(email_normalized));

CREATE TABLE IF NOT EXISTS staff_roles (
  code text PRIMARY KEY,
  display_name text NOT NULL,
  description text NOT NULL,
  fixed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff_permissions (
  code text PRIMARY KEY,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff_role_permissions (
  role_code text NOT NULL REFERENCES staff_roles (code),
  permission_code text NOT NULL REFERENCES staff_permissions (code),
  PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE IF NOT EXISTS staff_user_roles (
  staff_id uuid NOT NULL REFERENCES staff_users (id),
  role_code text NOT NULL REFERENCES staff_roles (code),
  environment_scope text NOT NULL DEFAULT 'preview',
  effective_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz,
  granted_by_staff_id uuid REFERENCES staff_users (id),
  approved_by_staff_id uuid REFERENCES staff_users (id),
  revoked_at timestamptz,
  PRIMARY KEY (staff_id, role_code, environment_scope),
  CHECK (expires_at IS NULL OR expires_at > effective_at)
);

CREATE INDEX IF NOT EXISTS staff_user_roles_active_idx
  ON staff_user_roles (staff_id, environment_scope, effective_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS staff_sessions (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES staff_users (id),
  access_token_hash text NOT NULL UNIQUE,
  refresh_token_hash text NOT NULL UNIQUE,
  family_id uuid NOT NULL,
  authorization_version bigint NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT NOW(),
  device_fingerprint text,
  ip_hash text,
  csrf_token_hash text NOT NULL,
  step_up_verified_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS staff_sessions_staff_active_idx
  ON staff_sessions (staff_id, absolute_expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS staff_mfa_credentials (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES staff_users (id),
  credential_type text NOT NULL DEFAULT 'TOTP' CHECK (credential_type = 'TOTP'),
  secret_ciphertext text NOT NULL,
  encryption_key_id text NOT NULL,
  last_accepted_time_step bigint,
  enrolled_at timestamptz NOT NULL DEFAULT NOW(),
  disabled_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_mfa_one_active_totp_idx
  ON staff_mfa_credentials (staff_id)
  WHERE disabled_at IS NULL;

CREATE TABLE IF NOT EXISTS staff_invites (
  id uuid PRIMARY KEY,
  email_normalized text NOT NULL,
  employee_code text NOT NULL,
  display_name text NOT NULL,
  role_code text NOT NULL REFERENCES staff_roles (code),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by_staff_id uuid REFERENCES staff_users (id),
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS staff_invites_active_idx
  ON staff_invites (email_normalized, expires_at)
  WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS staff_auth_challenges (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES staff_users (id),
  purpose text NOT NULL CHECK (purpose IN ('LOGIN', 'STEP_UP')),
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS staff_auth_challenges_active_idx
  ON staff_auth_challenges (staff_id, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS admin_action_policies (
  action_type text PRIMARY KEY,
  required_permission text NOT NULL REFERENCES staff_permissions (code),
  required_approvals integer NOT NULL DEFAULT 1 CHECK (required_approvals = 1),
  expiry_seconds integer NOT NULL DEFAULT 86400 CHECK (expiry_seconds > 0),
  policy_version text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_action_requests (
  id uuid PRIMARY KEY,
  action_type text NOT NULL REFERENCES admin_action_policies (action_type),
  requester_staff_id uuid NOT NULL REFERENCES staff_users (id),
  target_type text NOT NULL,
  target_id text NOT NULL,
  request_fingerprint text NOT NULL,
  policy_version text NOT NULL,
  risk_level text NOT NULL DEFAULT 'NORMAL' CHECK (risk_level IN ('LOW', 'NORMAL', 'HIGH')),
  required_approvals integer NOT NULL DEFAULT 1 CHECK (required_approvals = 1),
  status text NOT NULL DEFAULT 'PENDING_APPROVAL'
    CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'STALE')),
  idempotency_key text NOT NULL,
  expected_target_version bigint,
  expected_target_status text,
  expires_at timestamptz NOT NULL,
  result_resource_id text,
  failure_code text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (requester_staff_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS admin_action_requests_queue_idx
  ON admin_action_requests (status, created_at)
  WHERE status = 'PENDING_APPROVAL';

CREATE TABLE IF NOT EXISTS admin_action_decisions (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES admin_action_requests (id),
  reviewer_staff_id uuid NOT NULL REFERENCES staff_users (id),
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  approved_fingerprint text NOT NULL,
  reason_code text NOT NULL,
  comment text,
  mfa_verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (request_id, reviewer_staff_id),
  UNIQUE (request_id)
);

CREATE TABLE IF NOT EXISTS admin_action_execution_attempts (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES admin_action_requests (id),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  executor text NOT NULL DEFAULT 'SYSTEM',
  started_at timestamptz NOT NULL DEFAULT NOW(),
  finished_at timestamptz,
  outcome text CHECK (outcome IS NULL OR outcome IN ('SUCCEEDED', 'FAILED')),
  error_code text,
  UNIQUE (request_id, attempt_number)
);

-- Typed request detail tables. They prevent the action executor from
-- interpreting arbitrary JSON as a command.
CREATE TABLE IF NOT EXISTS account_status_change_requests (
  request_id uuid PRIMARY KEY REFERENCES admin_action_requests (id),
  account_id uuid NOT NULL REFERENCES payment_accounts (id),
  requested_status text NOT NULL CHECK (requested_status IN ('ACTIVE', 'BLOCKED')),
  reason_code text NOT NULL,
  ticket_reference text
);

CREATE TABLE IF NOT EXISTS customer_access_change_requests (
  request_id uuid PRIMARY KEY REFERENCES admin_action_requests (id),
  customer_id uuid NOT NULL REFERENCES customers (id),
  requested_status text NOT NULL CHECK (requested_status IN ('ACTIVE', 'LOCKED')),
  reason_code text NOT NULL,
  ticket_reference text
);

CREATE TABLE IF NOT EXISTS simulation_funding_requests (
  request_id uuid PRIMARY KEY REFERENCES admin_action_requests (id),
  account_id uuid NOT NULL REFERENCES payment_accounts (id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
  reason_code text NOT NULL,
  ticket_reference text NOT NULL,
  description text NOT NULL
);

CREATE TABLE IF NOT EXISTS application_decision_requests (
  request_id uuid PRIMARY KEY REFERENCES admin_action_requests (id),
  application_type text NOT NULL CHECK (application_type IN ('KYC', 'CREDIT')),
  application_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED', 'MORE_INFO_REQUIRED', 'PENDING_ACTIVATION')),
  reason_code text NOT NULL
);

CREATE TABLE IF NOT EXISTS transfer_operation_requests (
  request_id uuid PRIMARY KEY REFERENCES admin_action_requests (id),
  transfer_id uuid NOT NULL REFERENCES transfers (id),
  operation text NOT NULL CHECK (operation IN ('RETRY', 'CANCEL', 'REVERSAL')),
  reason_code text NOT NULL
);

CREATE TABLE IF NOT EXISTS fraud_resolution_requests (
  request_id uuid PRIMARY KEY REFERENCES admin_action_requests (id),
  report_id uuid NOT NULL REFERENCES fraud_reports (id),
  operation text NOT NULL CHECK (operation IN ('BLOCK', 'REVOKE', 'REVERSAL', 'RESOLVE')),
  resolution_code text,
  reason_code text NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox_requeue_requests (
  request_id uuid PRIMARY KEY REFERENCES admin_action_requests (id),
  event_id uuid NOT NULL REFERENCES outbox_events (id),
  reason_code text NOT NULL,
  ticket_reference text NOT NULL
);

CREATE TABLE IF NOT EXISTS job_retry_requests (
  request_id uuid PRIMARY KEY REFERENCES admin_action_requests (id),
  job_id uuid NOT NULL,
  reason_code text NOT NULL,
  ticket_reference text NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_role_change_requests (
  request_id uuid PRIMARY KEY REFERENCES admin_action_requests (id),
  staff_id uuid NOT NULL REFERENCES staff_users (id),
  role_code text NOT NULL REFERENCES staff_roles (code),
  operation text NOT NULL CHECK (operation IN ('GRANT', 'REVOKE')),
  environment_scope text NOT NULL DEFAULT 'preview',
  reason_code text NOT NULL
);

CREATE TABLE IF NOT EXISTS account_status_history (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES payment_accounts (id),
  before_status text,
  after_status text NOT NULL,
  actor_staff_id uuid REFERENCES staff_users (id),
  request_id uuid REFERENCES admin_action_requests (id),
  reason_code text NOT NULL,
  before_version bigint,
  after_version bigint,
  occurred_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_access_status_history (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  before_status text,
  after_status text NOT NULL,
  actor_staff_id uuid REFERENCES staff_users (id),
  request_id uuid REFERENCES admin_action_requests (id),
  reason_code text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS background_jobs (
  id uuid PRIMARY KEY,
  job_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD', 'CANCELLED')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS background_job_attempts (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES background_jobs (id),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  outcome text CHECK (outcome IS NULL OR outcome IN ('SUCCEEDED', 'FAILED')),
  error_code text,
  UNIQUE (job_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS job_retry_history (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES background_jobs (id),
  request_id uuid NOT NULL REFERENCES admin_action_requests (id),
  previous_status text NOT NULL,
  new_status text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT NOW()
);

-- Additive audit hardening. Existing customer audit rows remain readable; the
-- Admin API writes only append-only staff rows through its repository.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS access_status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (access_status IN ('ACTIVE', 'LOCKED')),
  ADD COLUMN IF NOT EXISTS access_version bigint NOT NULL DEFAULT 1
    CHECK (access_version > 0);

CREATE INDEX IF NOT EXISTS customers_access_status_idx
  ON customers (access_status, created_at DESC);

ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS actor_type text NOT NULL DEFAULT 'CUSTOMER',
  ADD COLUMN IF NOT EXISTS actor_staff_id uuid REFERENCES staff_users (id),
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS target_type text,
  ADD COLUMN IF NOT EXISTS target_id text,
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS request_id uuid REFERENCES admin_action_requests (id),
  ADD COLUMN IF NOT EXISTS trace_id text,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS session_fingerprint text,
  ADD COLUMN IF NOT EXISTS source_ip_hash text,
  ADD COLUMN IF NOT EXISTS before_version bigint,
  ADD COLUMN IF NOT EXISTS after_version bigint;

CREATE INDEX IF NOT EXISTS audit_events_staff_occurred_idx
  ON audit_events (actor_staff_id, occurred_at DESC)
  WHERE actor_staff_id IS NOT NULL;

-- Seed fixed roles, permissions and the default matrix. No staff account is
-- created here; bootstrap is an explicit, one-time CLI operation.
INSERT INTO staff_roles (code, display_name, description) VALUES
  ('SUPPORT', 'Hỗ trợ', 'Tra cứu dữ liệu đã che, triage và tạo yêu cầu khóa'),
  ('OPERATIONS', 'Vận hành', 'Xử lý nghiệp vụ, review và tạo yêu cầu'),
  ('CONTROL', 'Kiểm soát', 'Checker độc lập, phê duyệt và audit'),
  ('ADMIN', 'Quản trị', 'Quản lý staff, policy và cấu hình; không bypass four-eyes')
ON CONFLICT (code) DO NOTHING;

INSERT INTO staff_permissions (code, description) VALUES
  ('customer.read.masked', 'Đọc thông tin khách hàng đã che'),
  ('customer.read.pii', 'Đọc PII theo phạm vi'),
  ('customer.access-lock.request', 'Tạo yêu cầu khóa/mở quyền đăng nhập'),
  ('customer.access-lock.approve', 'Phê duyệt khóa/mở quyền đăng nhập'),
  ('account.read', 'Đọc tài khoản'),
  ('account.number.reveal', 'Hiển thị số tài khoản đầy đủ'),
  ('account.block.request', 'Tạo yêu cầu khóa tài khoản'),
  ('account.block.approve', 'Phê duyệt khóa tài khoản'),
  ('account.unblock.request', 'Tạo yêu cầu mở khóa tài khoản'),
  ('account.unblock.approve', 'Phê duyệt mở khóa tài khoản'),
  ('simulation-funding.read', 'Đọc cấp tiền mô phỏng'),
  ('simulation-funding.request', 'Tạo yêu cầu cấp tiền mô phỏng'),
  ('simulation-funding.approve', 'Phê duyệt cấp tiền mô phỏng'),
  ('simulation-funding.reverse.request', 'Tạo yêu cầu hoàn tác mô phỏng'),
  ('simulation-funding.reverse.approve', 'Phê duyệt hoàn tác mô phỏng'),
  ('kyc.read', 'Đọc hồ sơ KYC'),
  ('kyc.review', 'Review hồ sơ KYC'),
  ('kyc.decision.request', 'Tạo đề xuất quyết định KYC'),
  ('kyc.decision.approve', 'Phê duyệt quyết định KYC'),
  ('credit-application.read', 'Đọc hồ sơ tín dụng'),
  ('credit-application.review', 'Review hồ sơ tín dụng'),
  ('credit-application.decision.approve', 'Phê duyệt hồ sơ tín dụng'),
  ('transfer.pending.read', 'Đọc giao dịch chờ'),
  ('transfer.action.request', 'Tạo yêu cầu xử lý giao dịch'),
  ('transfer.action.approve', 'Phê duyệt xử lý giao dịch'),
  ('fraud.read', 'Đọc fraud case'),
  ('fraud.claim', 'Nhận xử lý fraud case'),
  ('fraud.investigate', 'Điều tra fraud case'),
  ('fraud.action.request', 'Tạo yêu cầu xử lý fraud'),
  ('fraud.resolve.approve', 'Phê duyệt kết quả fraud'),
  ('outbox.read', 'Đọc Outbox/DLQ'),
  ('outbox.requeue.request', 'Tạo yêu cầu requeue Outbox'),
  ('outbox.requeue.approve', 'Phê duyệt requeue Outbox'),
  ('job.read', 'Đọc background job'),
  ('job.retry.request', 'Tạo yêu cầu retry job'),
  ('job.retry.approve', 'Phê duyệt retry job'),
  ('staff.read', 'Đọc staff và vai trò'),
  ('staff.invite.request', 'Tạo lời mời staff'),
  ('staff.role-change.request', 'Tạo yêu cầu thay đổi vai trò'),
  ('staff.role-change.approve', 'Phê duyệt thay đổi vai trò'),
  ('staff.disable.request', 'Tạo yêu cầu vô hiệu hóa staff'),
  ('staff.disable.approve', 'Phê duyệt vô hiệu hóa staff'),
  ('audit.read', 'Đọc audit'),
  ('audit.export', 'Xuất audit')
ON CONFLICT (code) DO NOTHING;

INSERT INTO staff_role_permissions (role_code, permission_code)
SELECT 'SUPPORT', code FROM staff_permissions
WHERE code IN ('customer.read.masked','customer.access-lock.request','account.read','transfer.pending.read','fraud.read','fraud.claim','outbox.read','job.read')
ON CONFLICT DO NOTHING;

INSERT INTO staff_role_permissions (role_code, permission_code)
SELECT 'OPERATIONS', code FROM staff_permissions
WHERE code IN ('customer.read.masked','customer.read.pii','customer.access-lock.request','customer.access-lock.approve','account.read','account.block.request','account.unblock.request','simulation-funding.read','simulation-funding.request','simulation-funding.reverse.request','kyc.read','kyc.review','kyc.decision.request','credit-application.read','credit-application.review','transfer.pending.read','transfer.action.request','fraud.read','fraud.claim','fraud.investigate','fraud.action.request','outbox.read','outbox.requeue.request','job.read','job.retry.request','staff.read')
ON CONFLICT DO NOTHING;

INSERT INTO staff_role_permissions (role_code, permission_code)
SELECT 'CONTROL', code FROM staff_permissions
WHERE code IN ('customer.read.masked','customer.read.pii','customer.access-lock.approve','account.read','account.block.approve','account.unblock.approve','simulation-funding.read','simulation-funding.approve','simulation-funding.reverse.approve','kyc.read','kyc.decision.approve','credit-application.read','credit-application.decision.approve','transfer.pending.read','transfer.action.approve','fraud.read','fraud.investigate','fraud.resolve.approve','outbox.read','outbox.requeue.approve','job.read','job.retry.approve','staff.read','staff.role-change.approve','staff.disable.approve','audit.read','audit.export')
ON CONFLICT DO NOTHING;

INSERT INTO staff_role_permissions (role_code, permission_code)
SELECT 'ADMIN', code FROM staff_permissions
WHERE code IN ('customer.read.masked','account.read','simulation-funding.read','kyc.read','credit-application.read','transfer.pending.read','fraud.read','outbox.read','job.read','staff.read','staff.invite.request','staff.role-change.request','staff.disable.request','audit.read')
ON CONFLICT DO NOTHING;

INSERT INTO admin_action_policies (action_type, required_permission, policy_version) VALUES
  ('CUSTOMER_ACCESS_LOCK', 'customer.access-lock.request', 'admin-p0-v1'),
  ('CUSTOMER_ACCESS_UNLOCK', 'customer.access-lock.request', 'admin-p0-v1'),
  ('ACCOUNT_BLOCK', 'account.block.request', 'admin-p0-v1'),
  ('ACCOUNT_UNBLOCK', 'account.unblock.request', 'admin-p0-v1'),
  ('SIMULATION_FUNDING', 'simulation-funding.request', 'admin-p0-v1'),
  ('SIMULATION_FUNDING_REVERSAL', 'simulation-funding.reverse.request', 'admin-p0-v1'),
  ('KYC_DECISION', 'kyc.decision.request', 'admin-p0-v1'),
  ('CREDIT_DECISION', 'credit-application.review', 'admin-p0-v1'),
  ('TRANSFER_OPERATION', 'transfer.action.request', 'admin-p0-v1'),
  ('FRAUD_ACTION', 'fraud.action.request', 'admin-p0-v1'),
  ('OUTBOX_REQUEUE', 'outbox.requeue.request', 'admin-p0-v1'),
  ('JOB_RETRY', 'job.retry.request', 'admin-p0-v1'),
  ('STAFF_ROLE_CHANGE', 'staff.role-change.request', 'admin-p0-v1'),
  ('STAFF_DISABLE', 'staff.disable.request', 'admin-p0-v1')
ON CONFLICT (action_type) DO NOTHING;

COMMENT ON TABLE staff_users IS 'Admin control plane staff identity; no default or shared administrator.';
COMMENT ON TABLE admin_action_requests IS 'Immutable maker-checker requests; payload is display-only and typed tables are authoritative.';
COMMENT ON TABLE audit_events IS 'Append-only audit boundary; runtime must not UPDATE or DELETE rows.';

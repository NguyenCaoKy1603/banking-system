-- Collapse the Admin Web matrix to OPERATIONS and ADMIN. This is a
-- forward-only data migration; historical requests and audit evidence remain
-- immutable, while role-bearing live records are mapped to canonical roles.

-- Invalidate sessions for accounts whose role assignment will be rewritten.
UPDATE staff_sessions
SET revoked_at = NOW(), revoked_reason = 'ADMIN_ROLE_MODEL_MIGRATED'
WHERE revoked_at IS NULL
  AND staff_id IN (
    SELECT DISTINCT staff_id
    FROM staff_user_roles
    WHERE role_code IN ('SUPPORT', 'CONTROL')
  );

UPDATE staff_users
SET authorization_version = authorization_version + 1,
    version = version + 1,
    updated_at = NOW()
WHERE id IN (
  SELECT DISTINCT staff_id
  FROM staff_user_roles
  WHERE role_code IN ('SUPPORT', 'CONTROL')
);

-- Preserve the two canonical definitions and their permission union.
INSERT INTO staff_roles (code, display_name, description) VALUES
  ('OPERATIONS', 'Vận hành', 'Xử lý nghiệp vụ và hỗ trợ khách hàng'),
  ('ADMIN', 'Quản trị', 'Quản lý nhân viên, phê duyệt độc lập và kiểm toán')
ON CONFLICT (code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description;

INSERT INTO staff_role_permissions (role_code, permission_code)
SELECT CASE role_code WHEN 'SUPPORT' THEN 'OPERATIONS' ELSE 'ADMIN' END,
       permission_code
FROM staff_role_permissions
WHERE role_code IN ('SUPPORT', 'CONTROL')
ON CONFLICT DO NOTHING;

-- If an account already holds both the legacy and canonical role, retain the
-- union of currently active assignments. Do not let a revoked/expired legacy
-- row disable a currently active canonical assignment.
INSERT INTO staff_user_roles (
  staff_id, role_code, environment_scope, effective_at, expires_at,
  granted_by_staff_id, approved_by_staff_id, revoked_at
)
SELECT staff_id,
       CASE role_code WHEN 'SUPPORT' THEN 'OPERATIONS' ELSE 'ADMIN' END,
       environment_scope, effective_at, expires_at,
       granted_by_staff_id, approved_by_staff_id, revoked_at
FROM staff_user_roles
WHERE role_code IN ('SUPPORT', 'CONTROL')
ON CONFLICT (staff_id, role_code, environment_scope) DO UPDATE SET
  effective_at = CASE
    WHEN staff_user_roles.revoked_at IS NULL
      AND staff_user_roles.effective_at <= NOW()
      AND (staff_user_roles.expires_at IS NULL OR staff_user_roles.expires_at > NOW())
      AND EXCLUDED.revoked_at IS NULL
      AND EXCLUDED.effective_at <= NOW()
      AND (EXCLUDED.expires_at IS NULL OR EXCLUDED.expires_at > NOW())
      THEN LEAST(staff_user_roles.effective_at, EXCLUDED.effective_at)
    WHEN staff_user_roles.revoked_at IS NULL
      AND staff_user_roles.effective_at <= NOW()
      AND (staff_user_roles.expires_at IS NULL OR staff_user_roles.expires_at > NOW())
      THEN staff_user_roles.effective_at
    WHEN EXCLUDED.revoked_at IS NULL
      AND EXCLUDED.effective_at <= NOW()
      AND (EXCLUDED.expires_at IS NULL OR EXCLUDED.expires_at > NOW())
      THEN EXCLUDED.effective_at
    ELSE staff_user_roles.effective_at
  END,
  expires_at = CASE
    WHEN staff_user_roles.revoked_at IS NULL
      AND staff_user_roles.effective_at <= NOW()
      AND (staff_user_roles.expires_at IS NULL OR staff_user_roles.expires_at > NOW())
      AND EXCLUDED.revoked_at IS NULL
      AND EXCLUDED.effective_at <= NOW()
      AND (EXCLUDED.expires_at IS NULL OR EXCLUDED.expires_at > NOW())
      THEN CASE
        WHEN staff_user_roles.expires_at IS NULL OR EXCLUDED.expires_at IS NULL THEN NULL
        ELSE GREATEST(staff_user_roles.expires_at, EXCLUDED.expires_at)
      END
    WHEN EXCLUDED.revoked_at IS NULL
      AND EXCLUDED.effective_at <= NOW()
      AND (EXCLUDED.expires_at IS NULL OR EXCLUDED.expires_at > NOW())
      THEN EXCLUDED.expires_at
    ELSE staff_user_roles.expires_at
  END,
  revoked_at = CASE
    WHEN (staff_user_roles.revoked_at IS NULL
      AND staff_user_roles.effective_at <= NOW()
      AND (staff_user_roles.expires_at IS NULL OR staff_user_roles.expires_at > NOW()))
      OR (EXCLUDED.revoked_at IS NULL
      AND EXCLUDED.effective_at <= NOW()
      AND (EXCLUDED.expires_at IS NULL OR EXCLUDED.expires_at > NOW()))
      THEN NULL
    ELSE COALESCE(staff_user_roles.revoked_at, EXCLUDED.revoked_at)
  END,
  granted_by_staff_id = CASE
    WHEN staff_user_roles.revoked_at IS NOT NULL OR staff_user_roles.effective_at > NOW()
      OR (staff_user_roles.expires_at IS NOT NULL AND staff_user_roles.expires_at <= NOW())
      THEN COALESCE(EXCLUDED.granted_by_staff_id, staff_user_roles.granted_by_staff_id)
    ELSE COALESCE(staff_user_roles.granted_by_staff_id, EXCLUDED.granted_by_staff_id)
  END,
  approved_by_staff_id = CASE
    WHEN staff_user_roles.revoked_at IS NOT NULL OR staff_user_roles.effective_at > NOW()
      OR (staff_user_roles.expires_at IS NOT NULL AND staff_user_roles.expires_at <= NOW())
      THEN COALESCE(EXCLUDED.approved_by_staff_id, staff_user_roles.approved_by_staff_id)
    ELSE COALESCE(staff_user_roles.approved_by_staff_id, EXCLUDED.approved_by_staff_id)
  END;

UPDATE staff_invites
SET role_code = CASE role_code WHEN 'SUPPORT' THEN 'OPERATIONS' ELSE 'ADMIN' END
WHERE role_code IN ('SUPPORT', 'CONTROL');

UPDATE staff_invite_requests
SET role_code = CASE role_code WHEN 'SUPPORT' THEN 'OPERATIONS' ELSE 'ADMIN' END
WHERE role_code IN ('SUPPORT', 'CONTROL');

UPDATE staff_role_change_requests
SET role_code = CASE role_code WHEN 'SUPPORT' THEN 'OPERATIONS' ELSE 'ADMIN' END
WHERE role_code IN ('SUPPORT', 'CONTROL');

-- Payload fingerprints and audit history are intentionally untouched. Runtime
-- execution canonicalizes legacy SUPPORT/CONTROL values in pending payloads.
DELETE FROM staff_user_roles WHERE role_code IN ('SUPPORT', 'CONTROL');
DELETE FROM staff_role_permissions WHERE role_code IN ('SUPPORT', 'CONTROL');
DELETE FROM staff_roles WHERE code IN ('SUPPORT', 'CONTROL');

-- Align the persisted permission matrix with the server-side Admin registry.
-- Additive and idempotent; migrations 001-021 remain immutable.

INSERT INTO staff_permissions (code, description)
VALUES ('customer.access-unlock.request', 'Tạo yêu cầu mở khóa quyền đăng nhập')
ON CONFLICT (code) DO NOTHING;

INSERT INTO staff_role_permissions (role_code, permission_code)
SELECT 'ADMIN', 'customer.access-lock.request'
WHERE EXISTS (SELECT 1 FROM staff_roles WHERE code = 'ADMIN')
ON CONFLICT DO NOTHING;

INSERT INTO staff_role_permissions (role_code, permission_code)
SELECT role_code, 'customer.access-unlock.request'
FROM (VALUES ('OPERATIONS'::text), ('ADMIN'::text)) AS roles(role_code)
WHERE EXISTS (SELECT 1 FROM staff_roles WHERE code = roles.role_code)
ON CONFLICT DO NOTHING;

UPDATE admin_action_policies
SET required_permission = 'customer.access-unlock.request',
    updated_at = NOW()
WHERE action_type = 'CUSTOMER_ACCESS_UNLOCK';

-- Retire staff-invite approval from the regular Admin workflow. Existing
-- STAFF_INVITE actions and typed request rows remain available as history.
INSERT INTO staff_permissions (code, description)
VALUES ('staff.operations-account.create', 'Tạo tài khoản Operations trực tiếp')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO staff_role_permissions (role_code, permission_code)
VALUES ('ADMIN', 'staff.operations-account.create')
ON CONFLICT DO NOTHING;

-- Keep the policy row because historical admin_action_requests reference it,
-- but disable it and point its required permission at the canonical Admin
-- permission so the retired invitation permissions can be removed.
UPDATE admin_action_policies
SET required_permission = 'staff.operations-account.create',
    enabled = false,
    updated_at = NOW()
WHERE action_type = 'STAFF_INVITE';

DELETE FROM staff_role_permissions
WHERE permission_code IN ('staff.invite.request', 'staff.invite.approve');

DELETE FROM staff_permissions
WHERE code IN ('staff.invite.request', 'staff.invite.approve');

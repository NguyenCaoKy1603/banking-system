-- P0 hardening: staff invitations are maker-checker actions.  The invite
-- record is only materialized after a distinct checker approves the action.
INSERT INTO staff_permissions (code, description)
VALUES ('staff.invite.approve', 'Phê duyệt lời mời staff')
ON CONFLICT (code) DO NOTHING;

INSERT INTO staff_role_permissions (role_code, permission_code)
VALUES ('CONTROL', 'staff.invite.approve')
ON CONFLICT DO NOTHING;

INSERT INTO admin_action_policies
  (action_type, required_permission, required_approvals, expiry_seconds, policy_version, enabled)
VALUES ('STAFF_INVITE', 'staff.invite.approve', 1, 86400, 'admin-p0-v1', true)
ON CONFLICT (action_type) DO UPDATE SET
  required_permission = EXCLUDED.required_permission,
  required_approvals = EXCLUDED.required_approvals,
  expiry_seconds = EXCLUDED.expiry_seconds,
  policy_version = EXCLUDED.policy_version,
  enabled = EXCLUDED.enabled,
  updated_at = NOW();

COMMENT ON TABLE staff_invite_requests IS
  'Typed maker-checker payload; staff_users/staff_invites are created only after approval.';

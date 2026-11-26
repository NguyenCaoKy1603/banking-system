# RBAC matrix — Admin Web (2 roles)

| Permission group | OPERATIONS | ADMIN |
|---|---:|---:|
| Customer masked read / account read | ✓ | ✓ |
| Customer PII / case scope | assigned or unassigned cases | all cases |
| Customer access lock/unlock requests | ✓ | ✓ |
| Account block/unblock requests | ✓ | — |
| Simulation funding / reversal requests | ✓ | — |
| KYC and credit review requests | ✓ | xem / phê duyệt |
| Pending transfer read / action requests | ✓ | xem / phê duyệt |
| Transaction anomaly queue read / resolve (`/admin/anomalies`) | ✓ (`transfer.pending.read`, `transfer.action.request`) | xem (`transfer.pending.read`) |
| Outbox, jobs & ledger reconciliation read (`/admin/operations/ledger-reconciliation`) | ✓ (`outbox.read`, `job.read`) | xem / phê duyệt |
| Runtime control policy & fee config (`GET/PATCH /admin/control-policy`) | — | ✓ (`audit.read`, PATCH yêu cầu fresh TOTP Step-up) |
| Tạo trực tiếp tài khoản OPERATIONS / role / disable requests | xem staff | ✓ |
| Approval Inbox and audit read/export | — | ✓ |
| Approve own eligible requests | — | ✓, fresh step-up MFA required |

`OPERATIONS` combines support and business-operation permissions. `ADMIN`
combines system administration and approval permissions. Permission checks
remain server-side and permission-specific; neither the UI nor a role name
bypasses the approval policy. An ADMIN account can approve its own eligible request after fresh step-up MFA. No second ADMIN account is required.

Admin Web tạo tài khoản OPERATIONS ở trạng thái ACTIVE sau khi xác minh mã TOTP
của tài khoản mới. Đây là luồng tạo trực tiếp; không cần email mời hay phê duyệt.
Quyền tạo chỉ thuộc ADMIN qua permission `staff.operations-account.create`;
permission mời staff cũ đã bị gỡ khỏi role và không còn dùng cho tạo Operations.

Chính sách đăng nhập: OPERATIONS xác minh TOTP một lần trong lúc ADMIN tạo tài khoản,
sau đó đăng nhập bằng email và mật khẩu. ADMIN vẫn cần password + TOTP mỗi lần đăng
nhập. Khóa TOTP của tài khoản OPERATIONS chỉ dùng để xác minh lúc tạo tài khoản;
role OPERATIONS thuần không có challenge TOTP đăng nhập và không thể dùng TOTP
Step-up. Tài khoản ADMIN vẫn cần TOTP đăng nhập và Step-up mới khi phê duyệt.
Chính sách này ưu tiên tiện lợi cho demo local; password-only làm giảm bảo vệ nếu
mật khẩu Operations bị lộ, nên không phù hợp làm cấu hình cho nhân viên production.

Roles expire by assignment when configured. Staff with status LOCKED/DISABLED
or a stale `authorization_version` receive no permissions.

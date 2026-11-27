# RBAC matrix — Admin Web (2 roles)

| Permission group | OPERATIONS | ADMIN |
|---|---:|---:|
| Customer masked read / account read | ✓ | ✓ |
| Customer PII / case scope | assigned or unassigned cases | all cases |
| Customer access lock/unlock requests | ✓ (duyệt trực tiếp khi `ADMIN_DIRECT_EXECUTION=true`) | ✓ |
| Account block/unblock requests | ✓ (duyệt trực tiếp khi `ADMIN_DIRECT_EXECUTION=true`) | — |
| Simulation funding / reversal requests | ✓ (duyệt trực tiếp khi `ADMIN_DIRECT_EXECUTION=true`) | — |
| KYC and credit review requests | ✓ (duyệt trực tiếp khi `ADMIN_DIRECT_EXECUTION=true`) | xem / phê duyệt |
| Pending transfer read / action requests | ✓ (duyệt trực tiếp khi `ADMIN_DIRECT_EXECUTION=true`) | xem / phê duyệt |
| Outbox and job read / retry requests | ✓ (duyệt trực tiếp khi `ADMIN_DIRECT_EXECUTION=true`) | xem / phê duyệt |
| Tạo trực tiếp tài khoản OPERATIONS / role / disable requests | xem staff | ✓ (khóa trực tiếp kèm Step-up TOTP tại chỗ khi `ADMIN_DIRECT_EXECUTION=true`) |
| Control Policy (`/admin/control-policy`) & Ledger Reconciliation | chỉ đọc đối soát | ✓ (sửa policy cần Step-up TOTP) |
| Audit Explorer read/export (và Approval Inbox dự phòng) | — | ✓ |
| Approve own eligible requests | — | ✓, fresh step-up MFA required |

`OPERATIONS` combines support and business-operation permissions, and can
directly execute operational actions (customer/account controls, funding/reversal,
KYC/credit decisions, transfer operations, outbox/job retries) when
`ADMIN_DIRECT_EXECUTION=true` (without MFA Step-up). `ADMIN` retains exclusive
governance permissions (staff creation/disable/role change, control policy,
audit log & export, and Approval Inbox fallback). Trên giao diện Admin Web hiện
hành, mục `Approval Inbox` được ẩn khỏi thanh menu điều hướng vì toàn bộ nghiệp
vụ đã tích hợp thực thi trực tiếp ngay tại từng màn hình (khi bật
`ADMIN_DIRECT_EXECUTION=true`); mã nguồn `Approvals.tsx` và cơ chế Maker-Checker
ở server vẫn được giữ nguyên làm lớp dự phòng khi đặt `ADMIN_DIRECT_EXECUTION=false`.
An ADMIN account can approve its own eligible request after fresh step-up MFA.
No second ADMIN account is required.

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

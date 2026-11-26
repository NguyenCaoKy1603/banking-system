# Admin control plane P0 (reference sandbox)

## Trạng thái

Đây là control plane tách process với Public Banking API. Browser chỉ gọi
đường dẫn cùng origin `/api/v1`; Admin Web Nginx chuyển tiếp tới Admin API qua
`ADMIN_API_UPSTREAM` được cấp lúc container khởi động. Admin API mặc định chạy
`127.0.0.1:5001` ở local, dùng realm phiên staff riêng, cookie
HttpOnly/SameSite=Strict và CSRF token cho request thay đổi dữ liệu. Dữ liệu
chỉ là tiền ảo thử nghiệm; không dùng cho tiền thật, core banking, payment rail
hoặc KYC thật.

```text
Browser → Admin Web :5173 (same-origin `/api/v1`)
    │ cookie staff + CSRF
    ▼
Nginx trong Admin Web → `ADMIN_API_UPSTREAM`
    ▼
Admin API :5001 (localhost/private network)
    ├─ StaffAuthService (Operations password-only after enrollment; Admin password + TOTP; session rotation)
    ├─ Permission registry (deny-by-default, route registry)
    ├─ AdminActionEngine (request → permissioned approval, fingerprint, idempotency)
    └─ PostgresAdminRepository
          ├─ staff/session/action/audit tables
          ├─ relational account/ledger/outbox transaction
          └─ append-only audit + transactional outbox

Customer Mobile → Public API :5000 → customer realm
```

Trong Docker Compose, upstream là `http://admin-api:5001`, không phải
`127.0.0.1` (địa chỉ đó trỏ vào chính container Admin Web). Staging và
production-like bắt buộc upstream HTTPS; thiếu hoặc sai origin làm container
fail-closed trước khi Nginx chạy. Image/bundle không chứa URL môi trường.

Public API không mount route `/admin`. Admin API không chấp nhận customer bearer token; staff session có bảng và hash riêng. UI chỉ hiển thị policy/result; mọi authorization, freshness, version và fingerprint được kiểm tra lại ở server.

Admin Web có hai role cố định: OPERATIONS (nghiệp vụ và quyền hỗ trợ đã gộp)
và ADMIN (quản trị, kiểm toán và quyền phê duyệt đã gộp). Một tài khoản ADMIN
được phép tự duyệt yêu cầu đủ quyền sau xác thực TOTP Step-up; không cần tạo
thêm tài khoản Admin chỉ để duyệt chéo.

ADMIN có thể tạo trực tiếp tài khoản OPERATIONS trong màn hình Staff: nhập email,
mã nhân viên và mật khẩu ban đầu, tạo khóa TOTP, rồi xác minh mã 6 số từ ứng dụng
Authenticator. Tài khoản chỉ được ghi sau khi TOTP hợp lệ; khóa bí mật được mã
hóa khi lưu. Luồng này không gửi email mời và không tạo yêu cầu trong Approval
Inbox. Lệnh tạo có Idempotency-Key để retry an toàn khi mất phản hồi; audit ghi
actor, tài khoản đích và role, không lưu password, khóa MFA hoặc OTP.

Mã TOTP của tài khoản Operations chỉ dùng để xác minh việc cài Authenticator một
lần khi tạo tài khoản. Các lần đăng nhập Operations sau đó chỉ cần email và mật
khẩu; Admin vẫn cần password + TOTP khi đăng nhập, và Admin tiếp tục dùng TOTP
Step-up cho các thao tác phê duyệt nhạy cảm.
Tài khoản chỉ có role OPERATIONS không thể gọi TOTP Step-up.

Customer search/detail trong P0 trả email/số điện thoại đã che; các lần đọc customer/account/transaction/audit đều tạo audit event. PII đầy đủ và account number đầy đủ chưa được mở trong reference UI nếu chưa có permission/ABAC và quy trình reveal riêng.

## Data flow command

1. **Chế độ Phê duyệt 2 bước (`ADMIN_DIRECT_EXECUTION=false`)**:
   `request → authenticate staff → resolve roles/scope → require permission → validate typed body + Idempotency-Key → read/lock target → snapshot version/status + fingerprint → PENDING_APPROVAL + audit → approval by an ADMIN with the action-specific permission and fresh step-up MFA (the requester may be that same ADMIN) → lock action FOR UPDATE → verify permissions/stale/fingerprint → domain mutation + ledger/history + outbox + audit → SUCCEEDED/FAILED → commit`.

2. **Chế độ Thực thi Trực tiếp 1 chạm (`ADMIN_DIRECT_EXECUTION=true`)**:
   `request (directExecution: true) → authenticate staff → resolve roles/scope → require permission → validate typed body + Idempotency-Key → read/lock target → snapshot version/status + fingerprint → domain mutation + ledger/history + outbox + audit (outcome: SUCCEEDED) → commit`.
   *Chế độ này được thiết kế phục vụ môi trường kiểm thử local, liên thông tức thì giữa Admin Web và Mobile App mà không cần chuyển tài khoản để duyệt hàng đợi.*

Giao diện người dùng đã gỡ bỏ hoàn toàn việc bắt buộc nhập mã ticket tham chiếu; hệ thống tự động sinh và đính kèm mã tham chiếu ngầm chuẩn hóa (`OPS-FUNDING`, `OPS-DECISION`, v.v.) nhằm tuân thủ quy tắc dữ liệu của Action Engine.

Danh mục mã lý do (`reasonCode`) được chuẩn hóa theo phân loại nghiệp vụ ngân hàng:
- `CASH_DEPOSIT`: Nộp tiền mặt tại quầy (trừ tài khoản quỹ tiền mặt 1011).
- `ACCOUNT_FUNDING`: Nạp tiền vào tài khoản thanh toán.
- `PROMOTION_REWARD`: Chi thưởng khuyến mãi / mở tài khoản mới (trừ tài khoản chi phí marketing 8091).
- `CUSTOMER_COMPENSATION`: Bồi hoàn xử lý sự cố dịch vụ / khiếu nại (trừ tài khoản chi phí xử lý tổn thất 8999).
- `OPERATIONS_REVIEW`: Điều chỉnh vận hành kỹ thuật sau đối soát cuối ngày.
- `ACCOUNT_SECURITY`: Kiểm soát an toàn tài khoản khi có nghi vấn bảo mật.

Funding dùng minor-unit `bigint`, chỉ VND, tối đa 100.000.000 minor-unit mỗi action trong reference P0. Không có đường nhập số âm để hoàn tác và không cập nhật balance thiếu account transaction/ledger/audit/outbox. Thao tác hoàn tác được thực hiện qua nút **Hoàn tác nạp tiền** sinh giao dịch thoái thu (DEBIT) đối ứng chuẩn kế toán.

## Trạng thái adapter nghiệp vụ

Migration `019`–`025`, `041`–`043`, `045`, `047`–`048`, `051` và action engine có đường persistent cho account/customer lock, simulation funding + reversal, KYC/credit case review, transfer retry/cancel/reversal, **hàng đợi cảnh báo bất thường (`GET /admin/anomalies`, `POST /admin/anomalies/{id}/resolve`)**, **quản trị chính sách & biểu phí động (`GET/PATCH /admin/control-policy` yêu cầu `audit.read` và fresh TOTP Step-up)**, **đối soát sổ cái kép (`GET /admin/operations/ledger-reconciliation` kiểm tra journal unbalanced và độ lệch `payment-account:*` vs `SUM(current_minor)`)**, outbox requeue và background-job retry. Luồng báo cáo gian lận `fraud_reports` cũ cùng màn hình/case workflow Fraud cũ đã được gỡ khỏi API/Admin (D-39); migration và dữ liệu lịch sử được giữ nguyên, không xóa tự động. Migration `022` căn chỉnh permission mở khóa customer; `023` tách DB principals/RLS/domain tables; `024`–`025` quản lý case queue; `041`–`043` tinh gọn còn 2 vai trò `OPERATIONS`/`ADMIN` và tạo trực tiếp tài khoản Operations; `047` chuẩn hóa `ledger_entries.account_ref`; `051` cấp quyền `SELECT/UPDATE control_policy` và `SELECT ledger_journals, ledger_entries` cho `banking_admin_api`. Các mutation đang hoạt động đi qua typed request detail, row lock và audit. KYC document chỉ lưu metadata/object key giả, không lưu bytes/PII thật.

Public reference không còn endpoint/operator key bypass; fixture seed chạy bằng DB transaction nội bộ hoặc dữ liệu pre-seeded. Tài khoản Operations do Admin tạo trực tiếp bằng mật khẩu ban đầu và TOTP; không gửi email mời và không tạo approval cho thao tác này. `invitation-capture` chỉ dùng khi bootstrap Admin đầu tiên và phải bật profile riêng; token chỉ đi qua provider tạm thời, còn PostgreSQL giữ hash. Device E2E native, provider bootstrap HTTPS/credential thật cho staging, credential provisioning cho DB role, Argon2id và eKYC object store thật vẫn là residual risk. Vì vậy milestone này là reference hardening, không phải production readiness hay kết nối tiền thật.

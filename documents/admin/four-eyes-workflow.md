# Admin approval workflow

1. OPERATIONS hoặc ADMIN tạo yêu cầu với payload typed, lý do và `Idempotency-Key`.
2. Server lưu target version/status, policy version, SHA-256 fingerprint và audit event; payload sau khi gửi không thể sửa.
3. ADMIN có quyền phê duyệt tương ứng xem lại snapshot/fingerprint và xác thực TOTP Step-up còn mới tối đa 5 phút. ADMIN được tự duyệt yêu cầu do chính mình tạo nếu tài khoản có đủ quyền request và approve.
4. Server khóa action `FOR UPDATE`, kiểm tra permission hiện tại, expiry, fingerprint và target version. Một quyết định duy nhất được lưu cho mỗi action.
5. Chỉ sau authorization gate mới chạy domain mutation. Funding cùng transaction ghi account transaction, balanced journal, audit và outbox; lỗi sẽ rollback toàn bộ.

Admin Web có hai role: OPERATIONS xử lý nghiệp vụ; ADMIN quản trị nhân viên, audit và phê duyệt. Chỉ cần một tài khoản ADMIN để vận hành một mình; bootstrap tạo một tài khoản khởi tạo. Quyền, TOTP Step-up, fingerprint, version và audit vẫn được kiểm tra ở server.

Đăng nhập OPERATIONS chỉ cần email và mật khẩu sau khi TOTP đã được xác minh một lần lúc tạo tài khoản. Đăng nhập ADMIN tiếp tục yêu cầu password + TOTP; phê duyệt vẫn cần TOTP Step-up mới.

Tạo tài khoản OPERATIONS là luồng cấp tài khoản trực tiếp trong *Staff / Roles*: ADMIN đặt mật khẩu ban đầu, xác minh khóa TOTP của tài khoản mới, rồi server ghi tài khoản `ACTIVE`, role và audit theo transaction. Luồng này không gửi email mời và không tạo approval action; các thay đổi role/vô hiệu hóa staff và các hành động nghiệp vụ còn lại vẫn theo quy trình yêu cầu/phê duyệt ở trên.

Các lỗi chuẩn: `STAFF_AUTH_REQUIRED`, `STAFF_MFA_REQUIRED`, `ADMIN_PERMISSION_DENIED`, `APPROVAL_POLICY_UNCONFIGURED`, `ACTION_ALREADY_DECIDED`, `ACTION_EXPIRED`, `ACTION_STALE`, `ACTION_FINGERPRINT_MISMATCH`, `ACCOUNT_STATUS_CONFLICT`, `FUNDING_LIMIT_EXCEEDED`, `IDEMPOTENCY_CONFLICT`.

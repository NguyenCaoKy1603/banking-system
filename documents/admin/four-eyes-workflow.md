# Four-eyes workflow

1. Maker gửi body typed, lý do, ticket và `Idempotency-Key`.
2. Server lưu `expected_target_version/status`, policy version và SHA-256 fingerprint; payload sau khi gửi không được sửa.
3. Checker đọc đúng snapshot/fingerprint và phải step-up TOTP còn mới tối đa 5 phút.
4. Server khóa action `FOR UPDATE`, kiểm tra maker khác checker, permission hiện tại, expiry, fingerprint và target version.
5. Chỉ sau final authorization gate mới chạy domain mutation. Hai checker đồng thời chỉ một row quyết định thành công.
6. Funding cùng transaction ghi account transaction, balanced journal, audit và outbox. Lỗi ở bất kỳ bước nào rollback toàn bộ.

Các lỗi chuẩn: `STAFF_AUTH_REQUIRED`, `STAFF_MFA_REQUIRED`, `ADMIN_PERMISSION_DENIED`, `SELF_APPROVAL_FORBIDDEN`, `ACTION_ALREADY_DECIDED`, `ACTION_EXPIRED`, `ACTION_STALE`, `ACTION_FINGERPRINT_MISMATCH`, `ACCOUNT_STATUS_CONFLICT`, `FUNDING_LIMIT_EXCEEDED`, `IDEMPOTENCY_CONFLICT`.

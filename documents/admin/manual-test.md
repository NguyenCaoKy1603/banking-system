# Manual test checklist

- [ ] `GET /livez` Admin API trả 200 và bind localhost.
- [ ] Login password sai trả lỗi chung, không tiết lộ staff tồn tại.
- [ ] Login đúng trả challenge; TOTP sai bị giới hạn; TOTP đúng tạo cookie HttpOnly.
- [ ] Customer bearer token gọi Admin API bị 401.
- [ ] SUPPORT tạo account block request nhưng không approve/funding.
- [ ] OPERATIONS tạo funding request; tự approve trả `SELF_APPROVAL_FORBIDDEN`.
- [ ] CONTROL step-up rồi approve đúng fingerprint; account transaction + ledger + audit + outbox chỉ tạo một lần.
- [ ] Đổi account version trước approve trả `ACTION_STALE`.
- [ ] CSRF thiếu/sai trả `CSRF_INVALID`.
- [ ] Audit không chứa token, OTP, TOTP secret hoặc full account number.
- [ ] Restart PostgreSQL vẫn còn staff/action/audit.
- [ ] Operations claim KYC/credit; recommendation tạo action bất biến; Control approve đúng fingerprint/version.
- [ ] Fraud claim/note chống XSS; resolution chỉ qua action và resolution code chuẩn hóa.
- [ ] Transfer retry/cancel, Outbox DEAD/SKIPPED requeue và Job FAILED/DEAD retry đều giữ attempt history.
- [ ] Browser Playwright E2E chạy với Operations/Control/Support/ADMIN; xác nhận funding, block, KYC/Credit, transfer, fraud, Outbox/job và staff revoke.

Các flow reversal/refund tài chính và fixture thiết bị thật vẫn là phần còn thiếu; không dùng trạng thái dataset rỗng làm bằng chứng nghiệp vụ.

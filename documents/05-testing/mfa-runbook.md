# MFA runbook — reference sandbox

## Cấu hình tối thiểu

Preview cần các biến sau (chỉ dùng placeholder trong `.env.example`):

- `BANKING_OTP_PEPPER` và `BANKING_OTP_PEPPER_KEY_ID` cho digest email code.
- `BANKING_MFA_ENCRYPTION_KEY` và `BANKING_MFA_ENCRYPTION_KEY_ID` cho envelope TOTP secret.
- `BANKING_MFA_METHODS=TOTP`.

Không cấu hình mã OTP cố định. Không có endpoint đọc challenge code; E2E phải dùng SMTP catcher/FakeEmailProvider trong test hoặc secret TOTP của fixture disposable.

## Kiểm tra thủ công

1. Chạy migration và kiểm tra `mfa_credentials`, `auth_challenges`, `mfa_recovery_codes`, `mfa_recovery_requests`, `auth_security_events`.
2. Enroll TOTP, lưu recovery codes ngoại tuyến một lần, rồi đóng response setup.
3. Đăng nhập bằng password → TOTP; chỉ sau verify thành công mới nhận access/refresh token.
4. Với transfer/savings/credit/card, tạo quote → tạo challenge → nhập TOTP → submit đúng `challengeId`; sửa quote hoặc resource phải bị từ chối.
5. Dùng resend chỉ sau cooldown; challenge ID cũ phải thất bại.
6. Dùng lại cùng TOTP time-step phải nhận `MFA_REPLAY_DETECTED`.
7. Rotate recovery codes sau current MFA; code cũ phải bị vô hiệu hóa.
8. Đọc `GET /metrics` trên mạng nội bộ để kiểm tra các counter MFA không có label định danh; cảnh báo ngưỡng (rate-limit/replay/provider failure/recovery spike) phải do Prometheus/Alertmanager của môi trường triển khai đảm nhiệm.

## Sự cố provider

Email delivery lỗi phải chuyển challenge sang `DELIVERY_FAILED`; không retry plaintext code. Resend tạo code/challenge mới. Nếu thiếu encryption key hoặc pepper, persistent server phải fail closed khi khởi động. Đây là reference sandbox, chưa có SMTP/API provider thật, KMS/HSM, risk engine và operator two-person recovery.

## Kiểm tra chất lượng

```text
cd backend
npm run validate:database
npm run validate:openapi
npm run typecheck
npm run build
npm test

cd ../mobile-app
npm run lint
npm run typecheck
npm test
npm run validate:openapi
npm run validate:e2e
npm run export:web
```

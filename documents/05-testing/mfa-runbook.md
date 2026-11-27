# MFA runbook — reference sandbox

## Cấu hình tối thiểu

Preview cần các biến sau (chỉ dùng placeholder trong `.env.example`):

- `BANKING_OTP_PEPPER` và `BANKING_OTP_PEPPER_KEY_ID` cho digest email code.
- `BANKING_MFA_ENCRYPTION_KEY` và `BANKING_MFA_ENCRYPTION_KEY_ID` cho envelope TOTP secret.
- `BANKING_MFA_METHODS=TOTP`.

Không cấu hình mã OTP cố định. Không có endpoint đọc challenge code; E2E tự động phải dùng SMTP catcher/FakeEmailProvider hoặc transport SMTP giả lập. Gmail SMTP chỉ dùng cho rehearsal thủ công cục bộ với tài khoản gửi riêng; không đưa App Password vào Git, log hoặc artifact.

### Gmail SMTP rehearsal cục bộ

Provider Gmail là tùy chọn, không phải cấu hình mặc định. Tạo một Gmail riêng cho hệ thống, bật xác minh hai bước và tạo App Password. Đặt App Password vào secret local `EMAIL_PROVIDER_TOKEN` (không gửi qua chat), rồi cấu hình:

```text
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=1
SMTP_USER=<dedicated-sender@gmail.com>
SMTP_FROM=<dedicated-sender@gmail.com>
EMAIL_PROVIDER_TOKEN=<local-app-password>
```

`SMTP_FROM` phải trùng `SMTP_USER`; địa chỉ nhận là email người đăng ký trong request. Local rehearsal phải dùng database disposable, không dùng `banking_preview`. Provider chỉ gửi email xác nhận đăng ký; đăng nhập customer vẫn password-only.

## Kiểm tra thủ công

1. Chạy migration và kiểm tra `mfa_credentials`, `auth_challenges`, `mfa_recovery_codes`, `mfa_recovery_requests`, `auth_security_events`.
2. Enroll TOTP, lưu recovery codes ngoại tuyến một lần, rồi đóng response setup.
3. Đăng nhập customer bằng email + password (hoặc đăng nhập nhanh bằng Sinh trắc học / Mã PIN thiết bị qua `/auth/mfa/biometric/login/{challenge,verify}` nếu thiết bị đã kích hoạt khóa `BIOMETRIC`); TOTP và Sinh trắc học được dùng cho các thao tác step-up theo phân tầng rủi ro.
4. Kích hoạt Sinh trắc học tại `MfaMethodsScreen` (hỗ trợ Vân tay, Khuôn mặt và Mã PIN khóa màn hình `SecurityLevel.SECRET`): nhập mật khẩu xác nhận ngay tại khung Sinh trắc học → xác thực OS → lưu `biometricSecret` gắn `deviceId` trong `SecureStore`.
5. Với transfer/savings/credit:
   - Chuyển khoản **dưới `1.000.000 VND`** và rủi ro thấp (`LOW`/`MEDIUM`) ưu tiên cho phép xác thực 1 chạm bằng Sinh trắc học / PIN (hoặc chuyển sang nhập TOTP 6 số).
   - Chuyển khoản **từ `1.000.000 VND` trở lên** hoặc rủi ro cao (`HIGH`/`CRITICAL`) bắt buộc xác thực bằng mã TOTP 6 số.
6. Khóa thẻ khẩn cấp chỉ cần phiên/device hợp lệ. Mở khóa phải dùng purpose `CARD_UNLOCK`; báo mất phải dùng `CARD_REPORT_LOST`; challenge của action này không được dùng cho action kia.
7. Dùng resend chỉ sau cooldown; challenge ID cũ phải thất bại.
8. Dùng lại cùng TOTP time-step phải nhận `MFA_REPLAY_DETECTED`.
9. Rotate recovery codes sau current MFA; code cũ phải bị vô hiệu hóa.
10. Đọc `GET /metrics` trên mạng nội bộ để kiểm tra các counter MFA không có label định danh; cảnh báo ngưỡng (rate-limit/replay/provider failure/recovery spike) phải do Prometheus/Alertmanager của môi trường triển khai đảm nhiệm.

## Sự cố provider

Email delivery lỗi phải chuyển challenge sang `DELIVERY_FAILED`; retry SMTP chỉ giới hạn cho lỗi mạng/timeout, không retry lỗi xác thực hoặc recipient. Resend tạo code/challenge mới. Nếu thiếu encryption key hoặc pepper, persistent server phải fail closed khi khởi động. Gmail SMTP ở đây là provider thật cho rehearsal local quy mô nhỏ; staging vẫn phải dùng secret managed và evidence riêng, không coi Gmail local là production delivery.

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
npm run validate:release
npm run export:web
```

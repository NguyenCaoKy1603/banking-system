# ADR — TOTP và Device-Bound Biometric MFA cho reference banking sandbox

## Quyết định

- TOTP Authenticator là factor chính cho transaction step-up và thao tác bảo mật nhạy cảm (đổi mật khẩu khi đã bật TOTP, quản lý factor MFA).
- **Device-bound Biometric MFA** (bổ sung ở migration `046_biometric_authentication.sql`): khách hàng có thể đăng ký bí mật sinh trắc học gắn chặt theo `(customer_id, device_id)` qua `POST /api/v1/auth/mfa/biometric/enroll` (lưu mã hóa AES-256-GCM phía server trong `mfa_credentials` với `credential_type = 'BIOMETRIC'` và lưu cục bộ trong SecureStore phía Mobile). Khi step-up, Mobile xác thực sinh trắc học thiết bị (`expo-local-authentication`) rồi ký challenge-response `biometric-v1.<sha256>` gắn chặt `secret:challengeId:deviceId:purpose:resourceId`. Ở luồng chuyển tiền Mobile hiện áp dụng ngưỡng tối đa **1.000.000 VND** cho Biometric step-up; giao dịch giá trị cao hơn vẫn yêu cầu TOTP.
- Email code chỉ dùng cho xác nhận đăng ký (`REGISTRATION_EMAIL_VERIFY`), đặt lại mật khẩu (`PASSWORD_RESET`) và recovery; không coi đây là MFA mạnh.
- SMS và passkey/WebAuthn với hardware attestation chuẩn FIDO2 để sau; assertion sinh trắc học tĩnh dạng chuỗi (`EXPO_PUBLIC_DEVICE_ASSERTION`) vẫn bị loại bỏ hoàn toàn khỏi public bundle.
- Challenge, credential, recovery code và security event được lưu ở PostgreSQL (`mfa_credentials`, `auth_challenges`, `mfa_recovery_codes`, `mfa_recovery_requests`, `auth_security_events`). Token công khai chỉ được lưu dưới dạng hash.
- Counter MFA không dùng label định danh được xuất qua endpoint metrics nội bộ; cảnh báo/ngưỡng do hệ thống quan sát bên ngoài cấu hình.

## Bảo vệ bí mật

- Email code: CSPRNG 6 chữ số, TTL 5 phút, HMAC-SHA-256 theo `challengeHash:code` với pepper ngoài DB, có key ID và timing-safe compare.
- TOTP: secret tối thiểu 160 bit, mã hóa AES-256-GCM qua `KeyEncryptionPort`; chỉ giải mã trong memory. Policy SHA-1/6 digits/30 seconds/window 1 và chặn replay bằng `last_accepted_time_step`.
- Biometric secret (`biometric-v1`): 256 bit (`randomBytes(32)` base64url) sinh trên server khi enroll, mã hóa AES-256-GCM ở DB; verify bằng SHA-256 challenge-response + `timingSafeEqual` trên server, gắn chặt `challengeId`, `deviceId`, `purpose`, `resourceId`. Thu hồi qua `DELETE /api/v1/auth/mfa/methods/{id}` hoặc thu hồi thiết bị (`DELETE /api/v1/auth/devices/{deviceId}`).
- Recovery code: entropy 128 bit, salted PBKDF2 digest, hiển thị một lần và consume nguyên tử.

## Ranh giới vận hành

`BANKING_OTP_PEPPER`, `BANKING_MFA_ENCRYPTION_KEY` và key ID phải đến từ secret manager hoặc môi trường triển khai. Không ghi code, secret, biometric secret, token hoặc full account number vào log/audit/outbox. Preview vẫn là reference sandbox, chưa phải production thật: provider email, KMS, risk engine, hardware-backed TEE/Secure Enclave key attestation (WebAuthn/Passkey) và security review độc lập còn là gate mở.

## Hệ quả

Mọi command tài chính và thay đổi bảo mật phải dùng challenge bind customer/device/purpose/resource/request fingerprint (`auth_challenges` hỗ trợ thêm `PASSWORD_RESET`, `PASSWORD_CHANGE` từ migration `050` và phương thức `BIOMETRIC` từ migration `046`). Verify challenge dùng row lock; challenge cũ bị consume hoặc cancel, resend luôn sinh challenge/code mới.

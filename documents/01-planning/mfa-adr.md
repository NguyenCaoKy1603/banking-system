# ADR — TOTP-based MFA cho reference banking sandbox

## Quyết định

- TOTP Authenticator là factor chính cho login và transaction step-up.
- Email code chỉ dùng cho email confirmation/recovery; không coi đây là MFA mạnh.
- SMS và passkey/WebAuthn để sau; assertion sinh trắc học dạng chuỗi bị vô hiệu hóa trong production-like runtime.
- Challenge, credential, recovery code và security event được lưu ở PostgreSQL. Token công khai chỉ được lưu dưới dạng hash.
- Counter MFA không dùng label định danh được xuất qua endpoint metrics nội bộ; cảnh báo/ngưỡng do hệ thống quan sát bên ngoài cấu hình.

## Bảo vệ bí mật

- Email code: CSPRNG 6 chữ số, TTL 5 phút, HMAC-SHA-256 theo `challengeHash:code` với pepper ngoài DB, có key ID và timing-safe compare.
- TOTP: secret tối thiểu 160 bit, mã hóa AES-256-GCM qua `KeyEncryptionPort`; chỉ giải mã trong memory. Policy SHA-1/6 digits/30 seconds/window 1 và chặn replay bằng `last_accepted_time_step`.
- Recovery code: entropy 128 bit, salted PBKDF2 digest, hiển thị một lần và consume nguyên tử.

## Ranh giới vận hành

`BANKING_OTP_PEPPER`, `BANKING_MFA_ENCRYPTION_KEY` và key ID phải đến từ secret manager hoặc môi trường triển khai. Không ghi code, secret, token hoặc full account number vào log/audit/outbox. Preview vẫn là reference sandbox, chưa phải production thật: provider email, KMS, risk engine, device attestation và security review độc lập còn là gate mở.

## Hệ quả

Mọi command tài chính phải dùng challenge bind customer/device/purpose/resource/request fingerprint. Verify challenge dùng row lock; challenge cũ bị consume hoặc cancel, resend luôn sinh challenge/code mới. Khi TOTP chưa được enroll, tài khoản phải hoàn thành onboarding MFA trước khi nhận session banking đầy đủ.

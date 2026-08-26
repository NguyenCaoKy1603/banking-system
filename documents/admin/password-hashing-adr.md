# ADR — Password hashing cho staff Admin (reference sandbox)

## Quyết định tạm thời

`StaffAuthService` dùng PBKDF2-HMAC-SHA-512 với salt ngẫu nhiên, 210.000 vòng và digest lưu trong PostgreSQL. Đây là lựa chọn tương thích với runtime Node hiện có để kiểm thử control plane; password plaintext không được lưu hoặc ghi log.

## Ranh giới

- Đây không phải phê duyệt production: triển khai thật phải dùng Argon2id (hoặc KMS/password service đã được Security phê duyệt), benchmark theo phần cứng thật và có kế hoạch rehash khi đăng nhập.
- Mọi thay đổi role/trạng thái tăng `authorization_version` và thu hồi session; password change cũng phải thu hồi session.
- Chi phí PBKDF2, password policy và rate limit phải được kiểm tra lại trong threat model/DAST trước khi mở rộng môi trường.

## Việc còn lại trước production-like

Chốt Argon2id implementation, thêm migration/rehash, kiểm thử brute-force/rate-limit, dùng secret manager/KMS và có phê duyệt độc lập. Milestone P0 hiện chỉ chứng minh flow staff identity/MFA/four-eyes trong reference sandbox.

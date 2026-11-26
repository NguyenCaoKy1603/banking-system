# Mobile banking pilot runbook

> Cập nhật 2026-11-25 (`main` @ `220bb4d`): hệ thống hiện đã bổ sung xác thực sinh trắc học gắn thiết bị (`biometric-v1`, tối đa 1.000.000 VND cho chuyển tiền), phát hiện & xác nhận giao dịch bất thường (`/anomalies`), chuyển khoản liên ngân hàng mô phỏng `NAPAS_IBFT` hai pha `held_minor` & **VietQR (EMVCo TLV + CRC-16)**, đổi/quên mật khẩu (`/change-password`, `/(auth)/forgot-password`), quản lý thiết bị đăng nhập (`/devices`), lọc/thống kê tháng/xuất sao kê CSV-HTML, và Admin Policy/Ledger Reconciliation. Xem số liệu kiểm tra mới nhất tại [`current-status.md`](01-planning/current-status.md).

> Cập nhật 2026-10-13: chức năng báo cáo giao dịch đáng ngờ (`fraud_reports`) cũ đã được gỡ khỏi Mobile/API/Admin (D-39); schema và dữ liệu cũ được giữ nguyên để bảo toàn dữ liệu đã áp dụng. Luồng cảnh báo giao dịch bất thường mới dùng bảng `transaction_anomalies` riêng (`045`).

> Cập nhật 2026-10-11: các bộ E2E chạy được, flow Maestro và lệnh kiểm tra/chạy E2E đã được gỡ theo yêu cầu người dùng. Nội dung E2E bên dưới ghi lại bằng chứng lịch sử ở thời điểm cũ; không còn là lệnh chạy hiện hành.

Tài liệu này là checklist tối thiểu cho bản preview/pilot của mobile app. Nó không thay thế runbook vận hành của ngân hàng/BaaS partner.

Scope, threat model và data classification tham chiếu tại [`02-design/architecture-and-scope.md`](02-design/architecture-and-scope.md).

## Trạng thái implementation hiện tại

Reference backend sandbox (`relational-v2`, migrations `001`–`051`) và mobile flow đã được nối end-to-end ở mức contract: auth/session/device binding, đổi/quên mật khẩu, quản lý thiết bị, MFA TOTP & device-bound Biometric (`biometric-v1`), accounts/history/filter/summary/statement-export, transfer nội bộ & mô phỏng NAPAS IBFT (quote/phí động/hạn mức ngày/step-up/idempotency/pending recovery), cảnh báo giao dịch bất thường (`/anomalies`), VietQR EMVCo & NOVA QR v2, Savings (gồm tất toán trước hạn), Credit/Cards (bắt buộc KYC `APPROVED`), notifications, Assistant Help & Financial Advice. Backend server áp allowlist, kill switch, hạn mức giao dịch/ngày, biểu phí động và policy step-up từ `control_policy`; không dùng component này cho tiền thật.

> **Bằng chứng lịch sử (Historical snapshot — 2026-08-17):** Ở mốc nền tảng đầu tiên, critical flow M0–M4, M6, M8, credit payment/pending-resume, card lock/unlock và offline login retry đã từng chạy trên Android emulator `Pixel_7_API_35` bằng Maestro 2.8.0 (trước khi bộ Maestro được gỡ ngày 2026-10-11). Số liệu kiểm tra unit/lint/typecheck/OpenAPI hiện hành (74/74 Mobile suites, 533/533 tests, 664/664 Backend non-DB tests, 17/17 Admin Web tests tại `220bb4d`) được cập nhật trong [`current-status.md`](01-planning/current-status.md). Thiết bị thật, camera/biometric native thật và staging cloud vẫn chưa đạt gate phát hành.

## Cấu hình môi trường

- `EXPO_PUBLIC_API_URL` bắt buộc phải được cấp từ secret/environment của EAS cho build production.
- Production chỉ chấp nhận URL `https://`; app không dùng fallback emulator khi build production.
- Android emulator development có thể dùng `http://10.0.2.2:5000/api/v1`.
- Với release APK local trên emulator, dùng riêng cho sandbox: `$env:EXPO_PUBLIC_SANDBOX_HTTP='1'`, `$env:EXPO_PUBLIC_API_URL='http://127.0.0.1:5000/api/v1'`, sau đó `adb reverse tcp:5000 tcp:5000`. Config plugin chỉ bật cleartext cho cờ sandbox này; production không bật cờ và vẫn bắt buộc HTTPS.
- Khi chạy `npm run export:web` ở máy local, override `EXPO_PUBLIC_API_URL` bằng URL HTTPS của preview/staging (hoặc placeholder HTTPS chỉ để kiểm tra static export); không đổi production guard và không dùng HTTP sandbox làm cấu hình production.
- Backend reference local nằm tại [`../backend/README.md`](../backend/README.md); chỉ dùng để kiểm thử contract/idempotency, không dùng cho tiền thật.
- Auth có thể bật challenge MFA server-driven (`BANKING_MFA_REQUIRED=1` chỉ cho sandbox); OTP/assertion production phải đến từ Identity/risk provider, không dùng giá trị sandbox.
- Public Mobile env có allowlist CI; không khai báo `EXPO_PUBLIC_DEVICE_ASSERTION` hoặc bất kỳ secret/token/key nào. Biometric native hiện chỉ mở gate UX local và fail closed khi cần backend proof; attestation/passkey provider phải được phê duyệt trước pilot.
- Không đưa access token, refresh token, password, OTP hoặc dữ liệu tài chính vào log, analytics hay crash report.

## Quality gate trước khi build

CI phải xanh ở các bước database boundary validation, mobile lint, typecheck, unit test, OpenAPI validation, web export và backend typecheck/build/HTTP integration test. Critical E2E trên thiết bị thật và contract/integration test với core-banking partner vẫn là gate bắt buộc trước pilot.

Critical E2E cần chạy trên Android/iOS thật trước pilot: MFA challenge/refresh, double-tap/retry transfer, kill app trước và sau response submit, mở lại để truy vấn trạng thái `PENDING`, dùng token sai device, logout mọi thiết bị, bật kill switch và biometric prompt. Reference backend test hiện bao phủ các invariant HTTP nhưng không thay thế E2E thiết bị thật.

Các màn hình đã có test ID ổn định cho automation: `login-email`, `login-password`, `login-submit`, `login-mfa-code`, `login-mfa-submit`, `login-mfa-biometric`, `home-greeting`, `home-balance-card`, `home-toggle-balance`, `home-account-number`, `home-toggle-account-number`, `home-copy-account-number`, `account-detail`, `account-detail-number`, `account-detail-toggle-number`, `account-detail-copy-number`, `account-detail-history`, `quick-transfer`, `quick-deposit`, `quick-cards`, `tab-home`, `tab-cards`, `tab-qr`, `tab-profile`, `kyc-full-name`, `kyc-identity-number`, `kyc-address`, `kyc-select-sample-document`, `kyc-submit`, `beneficiary-list`, `beneficiary-display-name`, `beneficiary-account-number`, `beneficiary-bank-name`, `beneficiary-add`, `beneficiary-rename-*`, `beneficiary-delete-*`, `qr-code`, `qr-camera`, `qr-manual-payload`, `qr-parse-manual`, `qr-valid-payload`, `transfer-beneficiary-id`, `transfer-amount`, `transfer-create-quote`, `transfer-review-confirm`, `transfer-step-up-code`, `transfer-submit`, `transfer-status-refresh`, `first-transaction`, `notification-first`, `notification-detail`, `notification-open-target`, `profile-cards`, `cards-list`, `card-first`, `card-detail`, `card-toggle-visibility`, `card-toggle-lock`, `card-new-pin`, `card-confirm-pin`, `card-change-pin` và `logout-all-devices`. Bộ Maestro flow cũ đã được gỡ ngày 2026-10-11.

Không phát hành nếu còn lỗi High/Critical, nếu API URL production chưa được kiểm tra HTTPS, hoặc nếu chưa có người phụ trách hỗ trợ pilot.

## Pilot có kiểm soát

1. Chỉ bật cho allowlist và hạn mức thấp.
2. Bật feature flag theo phần trăm nhỏ, theo dõi lỗi đăng nhập, timeout, 401/refresh, giao dịch pending/failed và crash-free sessions.
3. Đối soát số dư và giao dịch hằng ngày với core banking; không dùng optimistic update số dư trên mobile.
4. Khi có sai lệch hoặc dấu hiệu gian lận, tắt feature flag/kill switch ở server, dừng rollout và mở incident.
5. Health/readiness của backend phải được nối vào monitoring và cảnh báo khi reconciliation ở trạng thái `mismatch` hoặc outbox backlog tăng; `/healthz` trong reference chỉ là smoke signal local.

## Rollback và sự cố

- Rollback về build trước bằng kênh phân phối đã được phê duyệt; không xóa dữ liệu SecureStore trong lúc rollback.
- Thu thập request ID và trace ID đã được làm sạch dữ liệu nhạy cảm để điều tra.
- Revoke session phải do backend thực thi; mobile gọi endpoint revoke theo draft session contract nhưng vẫn xóa session cục bộ khi mạng lỗi. Reference backend trong repo chỉ là sandbox, không phải production control plane.
- Sau sự cố, ghi nhận nguyên nhân, phạm vi ảnh hưởng, kết quả reconciliation và điều kiện bật lại.

## Kiểm tra hiển thị và sao chép số tài khoản

Sau khi đổi code, khởi động lại backend và Expo (có thể dùng cờ `--clear` nếu cần xóa cache), đăng nhập lại, vào Home và bấm `Hiện đầy đủ` hoặc `Sao chép` ở dòng tài khoản. Nút mắt trên cùng chỉ điều khiển ẩn/hiện số dư; số tài khoản được lấy qua endpoint riêng. Màn hình Chi tiết tài khoản (Account Detail) cũng có hai nút tương tự.

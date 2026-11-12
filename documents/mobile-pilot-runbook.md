# Mobile banking pilot runbook

> Cập nhật 2026-10-13: chức năng báo cáo giao dịch đáng ngờ đã được gỡ khỏi Mobile/API/Admin; schema và dữ liệu cũ được giữ nguyên để bảo toàn dữ liệu đã áp dụng.

> Cập nhật 2026-10-11: các bộ E2E chạy được, flow Maestro và lệnh kiểm tra/chạy E2E đã được gỡ theo yêu cầu người dùng. Nội dung E2E bên dưới ghi lại bằng chứng và kế hoạch ở thời điểm cũ; không còn là lệnh chạy hiện hành.

> Cập nhật hiện hành: reference giữ M0–M4/M8 và bổ sung clean registration, Admin four-eyes funding fixture, recipient lookup, dynamic step-up và opt-in Savings/Credit. Sau khi đổi code phải restart backend và reload/rebuild Mobile trước khi test; nút `Hiện đầy đủ`/`Sao chép` lấy số đầy đủ qua endpoint riêng, không lấy từ 4 số cuối. Xem [`current-status.md`](01-planning/current-status.md).

Tài liệu này là checklist tối thiểu cho bản preview/pilot của mobile app. Nó không thay thế runbook vận hành của ngân hàng/BaaS partner.

Scope, threat model và data classification tham chiếu tại [`02-design/architecture-and-scope.md`](02-design/architecture-and-scope.md).

## Trạng thái implementation hiện tại

Reference backend sandbox và mobile flow đã được nối end-to-end ở mức contract: auth/session/device binding, MFA OTP/biometric, accounts/history/detail, transfer quote/step-up/idempotency, pending recovery, notifications và Card mock. Chức năng báo cáo giao dịch đáng ngờ đã được gỡ; backend server áp allowlist, kill switch, hạn mức minor-unit và policy step-up; không dùng component này cho tiền thật.

Snapshot hiện hành ngày 2026-08-17: mobile lint/typecheck đạt, 37 suites và 170 tests đạt, coverage gate đạt; backend typecheck/build, database boundary validation, 70/70 test PostgreSQL và relational regression 1/1 đạt; OpenAPI validation đạt với 36 path; 10 flow Maestro đạt syntax validation; APK release local build thành công và web export đạt 33 route. Trang chủ mới có header NOVA, thẻ số dư hiện/che, ba dịch vụ nhanh và thanh điều hướng 4 mục; Tiền gửi hiển thị Sắp ra mắt, Thẻ tín dụng ghi rõ dữ liệu sandbox. Account detail có reveal và sao chép số tài khoản đầy đủ qua endpoint riêng, còn danh sách accounts chỉ trả số đã che. Critical flow M0–M4, M6, M8, credit payment, credit pending-resume, Credit card lock/restart/unlock, Credit overdue notification và offline login retry đã chạy trên Android emulator `Pixel_7_API_35` bằng Maestro 2.8.0, gồm cold launch, login + MFA, hiện/sao chép số tài khoản đầy đủ, eKYC với dữ liệu thử nghiệm, beneficiary, QR manual fallback, M4 transfer, M6 quote/review/OTP/mở khoản, M8 notification deep link, resume sau stop/launch, notification quá hạn mở đúng thẻ và retry khi API mất kết nối. Thiết bị thật, camera/biometric native thật và staging vẫn chưa đạt. Đây là bằng chứng cho reference implementation, không thay thế E2E thiết bị thật hoặc certification với partner.

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

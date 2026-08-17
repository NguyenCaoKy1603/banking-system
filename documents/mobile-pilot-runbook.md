# Mobile banking pilot runbook

> Cập nhật hiện hành 2026-08-17: branch `codex/mini-core-banking-sandbox` giữ M0–M4/M8 và bổ sung clean registration, operator Funding, recipient lookup, dynamic step-up và opt-in Savings/Credit. Sau khi đổi code phải restart backend và reload/rebuild Mobile trước khi test; nút `Hiện đầy đủ`/`Sao chép` lấy số đầy đủ qua endpoint riêng, không lấy từ 4 số cuối. Xem [`mini-core-sandbox-status.md`](01-planning/mini-core-sandbox-status.md).

Tài liệu này là checklist tối thiểu cho bản preview/pilot của mobile app. Nó không thay thế runbook vận hành của ngân hàng/BaaS partner.

Scope, threat model và data classification tham chiếu tại [`architecture/banking-mvp-scope-and-risk.md`](architecture/banking-mvp-scope-and-risk.md).

## Trạng thái implementation hiện tại

Reference backend sandbox và mobile flow đã được nối end-to-end ở mức contract: auth/session/device binding, MFA OTP/biometric, accounts/history/detail, transfer quote/step-up/idempotency, pending recovery, notifications, fraud report và Card mock. Backend server áp allowlist, kill switch, hạn mức minor-unit và policy step-up; không dùng component này cho tiền thật.

Snapshot hiện hành ngày 2026-08-17: mobile lint/typecheck đạt, 37 suites và 170 tests đạt, coverage gate đạt; backend typecheck/build, database boundary validation, 69/69 test PostgreSQL và relational regression 1/1 đạt; OpenAPI validation đạt với 36 path; 9 flow Maestro đạt syntax validation; APK release local build thành công và web export đạt 33 route. Trang chủ mới có header NOVA, thẻ số dư hiện/che, ba dịch vụ nhanh và thanh điều hướng 4 mục; Tiền gửi hiển thị Sắp ra mắt, Thẻ tín dụng ghi rõ dữ liệu sandbox. Account detail có reveal và sao chép số tài khoản đầy đủ qua endpoint riêng, còn danh sách accounts chỉ trả số đã che. Critical flow M0–M4, M6, M8, credit payment, credit pending-resume, Credit card lock/restart/unlock và Credit overdue notification đã chạy lại trên APK hiện tại trên Android emulator `Pixel_7_API_35` bằng Maestro 2.8.0, gồm cold launch, login + MFA, hiện/sao chép số tài khoản đầy đủ, eKYC mô phỏng, beneficiary, QR manual fallback, M4 transfer, M6 quote/review/OTP/mở khoản, M8 notification deep link, resume sau stop/launch và notification quá hạn mở đúng thẻ. Bằng chứng M0–M4/M8 mới nhất nằm tại `C:\Users\admin\.maestro\tests\2026-08-17_121849`, transfer pending-resume tại `C:\Users\admin\.maestro\tests\2026-08-17_125314`. Thiết bị thật, camera/biometric native thật và staging vẫn chưa đạt. Đây là bằng chứng cho reference implementation, không thay thế E2E thiết bị thật hoặc certification với partner.

## Cấu hình môi trường

- `EXPO_PUBLIC_API_URL` bắt buộc phải được cấp từ secret/environment của EAS cho build production.
- Production chỉ chấp nhận URL `https://`; app không dùng fallback emulator khi build production.
- Android emulator development có thể dùng `http://10.0.2.2:5000/api/v1`.
- Với release APK local trên emulator, dùng riêng cho sandbox: `$env:EXPO_PUBLIC_SANDBOX_HTTP='1'`, `$env:EXPO_PUBLIC_API_URL='http://127.0.0.1:5000/api/v1'`, sau đó `adb reverse tcp:5000 tcp:5000`. Config plugin chỉ bật cleartext cho cờ sandbox này; production không bật cờ và vẫn bắt buộc HTTPS.
- Khi chạy `npm run export:web` ở máy local, override `EXPO_PUBLIC_API_URL` bằng URL HTTPS của preview/staging (hoặc placeholder HTTPS chỉ để kiểm tra static export); không đổi production guard và không dùng HTTP sandbox làm cấu hình production.
- Backend reference local nằm tại [`../backend/README.md`](../backend/README.md); chỉ dùng để kiểm thử contract/idempotency, không dùng cho tiền thật.
- Auth có thể bật challenge MFA server-driven (`BANKING_MFA_REQUIRED=1` chỉ cho sandbox); OTP/assertion production phải đến từ Identity/risk provider, không dùng giá trị sandbox.
- Không đưa access token, refresh token, password, OTP hoặc dữ liệu tài chính vào log, analytics hay crash report.

## Quality gate trước khi build

CI phải xanh ở các bước database boundary validation, mobile lint, typecheck, unit test, OpenAPI validation, Maestro flow syntax, web export và backend typecheck/build/HTTP integration test. Critical E2E trên thiết bị thật và contract/integration test với core-banking partner vẫn là gate bắt buộc trước pilot.

Critical E2E cần chạy trên Android/iOS thật trước pilot: MFA challenge/refresh, double-tap/retry transfer, kill app trước và sau response submit, mở lại để truy vấn trạng thái `PENDING`, dùng token sai device, logout mọi thiết bị, bật kill switch, biometric prompt và gửi fraud report. Reference backend test hiện bao phủ các invariant HTTP nhưng không thay thế E2E thiết bị thật.

Các màn hình đã có test ID ổn định cho automation: `login-email`, `login-password`, `login-submit`, `login-mfa-code`, `login-mfa-submit`, `login-mfa-biometric`, `home-greeting`, `home-balance-card`, `home-toggle-balance`, `home-account-number`, `home-toggle-account-number`, `home-copy-account-number`, `account-detail`, `account-detail-number`, `account-detail-toggle-number`, `account-detail-copy-number`, `account-detail-history`, `quick-transfer`, `quick-deposit`, `quick-cards`, `tab-home`, `tab-cards`, `tab-qr`, `tab-profile`, `kyc-full-name`, `kyc-identity-number`, `kyc-address`, `kyc-select-sample-document`, `kyc-submit`, `beneficiary-list`, `beneficiary-display-name`, `beneficiary-account-number`, `beneficiary-bank-name`, `beneficiary-add`, `beneficiary-rename-*`, `beneficiary-delete-*`, `qr-code`, `qr-camera`, `qr-manual-payload`, `qr-parse-manual`, `qr-valid-payload`, `transfer-beneficiary-id`, `transfer-amount`, `transfer-create-quote`, `transfer-review-confirm`, `transfer-step-up-code`, `transfer-submit`, `transfer-status-refresh`, `first-transaction`, `notification-first`, `notification-detail`, `notification-open-target`, `profile-cards`, `cards-list`, `card-first`, `card-detail`, `card-toggle-visibility`, `card-toggle-lock`, `card-new-pin`, `card-confirm-pin`, `card-change-pin`, `fraud-reason`, `fraud-submit` và `logout-all-devices`. Bộ Maestro flow bàn giao nằm tại `mobile-app/e2e/maestro`.

Không phát hành nếu còn lỗi High/Critical, nếu API URL production chưa được kiểm tra HTTPS, hoặc nếu chưa có người phụ trách hỗ trợ pilot.

## Xác nhận chạy local mới nhất — 2026-08-17

- Backend local chạy ở chế độ PostgreSQL persistent; `.env` bị ignore và chỉ chứa cấu hình database giả lập local. Chạy `npm run db:migrate` trước `npm start` trên clone mới.
- M0–M4/M8 đã pass trên Android emulator với APK release mới: login/MFA, Home, hiện và sao chép số tài khoản đầy đủ, Account Detail, KYC mô phỏng, beneficiary, QR manual fallback và notification deep-link.
- Artifact Maestro: `C:\Users\admin\.maestro\tests\2026-08-17_121849`. Không lưu password, OTP, token hoặc số tài khoản đầy đủ vào artifact báo cáo.
- Trước khi test sau mỗi lần đổi code: restart backend, rebuild/reload Mobile nếu có thay đổi Mobile, rồi chạy lại flow. Tiền trong toàn bộ luồng là tiền ảo phục vụ mô phỏng; không dùng cho giao dịch thật.

## Xác nhận pending-resume mới nhất — 2026-08-17

- Flow `critical-transfer-retry.yaml` đã pass trên Android emulator với PostgreSQL persistent: tạo quote/step-up/transfer pending, stop app, launch app và refresh trạng thái.
- Artifact Maestro: `C:\Users\admin\.maestro\tests\2026-08-17_125314`.
- Backend critical API test vẫn là nơi xác nhận idempotency khi submit lặp; flow thiết bị xác nhận lifecycle và khả năng đọc lại trạng thái sau restart.
- Khi demo thủ công, chỉ dùng dữ liệu giả lập; không đưa password, OTP, access token, refresh token hoặc số tài khoản đầy đủ vào video/ảnh/báo cáo.

Hiện `uuid` đã được pin ở `11.1.1` cho nhánh transitive qua xcode. `npm audit --omit=dev` vẫn còn 14 cảnh báo High từ `image-size` nằm dưới Metro của Expo 57. Override `image-size` lên 2.x đã được thử nhưng làm web export của Expo/Metro lỗi nên không giữ; `npm audit fix --force` đề xuất đổi React Native/Expo theo breaking change. Không phát hành pilot khi cảnh báo High/Critical này chưa có upstream patch hoặc phương án nâng cấp được kiểm thử và phê duyệt.

CI có release gate `npm audit --omit=dev --audit-level=high`; vì vậy pipeline mobile hiện phải fail ở gate bảo mật cho tới khi finding này được xử lý hợp lệ.

## Pilot có kiểm soát

1. Chỉ bật cho allowlist và hạn mức thấp.
2. Bật feature flag theo phần trăm nhỏ, theo dõi lỗi đăng nhập, timeout, 401/refresh, giao dịch pending/failed và crash-free sessions.
3. Đối soát số dư và giao dịch hằng ngày với core banking; không dùng optimistic update số dư trên mobile.
4. Khi có sai lệch hoặc dấu hiệu gian lận, tắt feature flag/kill switch ở server, dừng rollout và mở incident.
5. Health/readiness của backend phải được nối vào monitoring và cảnh báo khi reconciliation ở trạng thái `mismatch` hoặc outbox backlog tăng; `/healthz` trong reference chỉ là smoke signal local.

## Rollback và sự cố

- Rollback về build trước bằng kênh phân phối đã được phê duyệt; không xóa dữ liệu SecureStore trong lúc rollback.
- Thu thập request ID và trace ID đã được làm sạch dữ liệu nhạy cảm để điều tra.
- Revoke session và xử lý fraud phải do backend/risk engine thực thi; mobile gọi endpoint revoke theo draft session contract nhưng vẫn xóa session cục bộ khi mạng lỗi. Reference backend trong repo chỉ là sandbox, không phải production control plane.
- Sau sự cố, ghi nhận nguyên nhân, phạm vi ảnh hưởng, kết quả reconciliation và điều kiện bật lại.

## Kiem tra hien/sao chep so tai khoan

Sau khi thay code, dung backend/mobile dang chay, khoi dong lai backend va Expo (co the dung clean cache), dang nhap lai, vao Home va bam `Hien day du` hoac `Sao chep` o dong tai khoan. Mat tren cung chi dieu khien so du; neu bam mat ma so tai khoan van 4 so thi do dang bam nham thao tac. Account Detail cung co hai nut tuong tu.

## Xác nhận gate cuối ngày 2026-08-15

- Mobile: typecheck/lint, 37 suite/170 test, OpenAPI, 9 flow syntax, web export và release config đã đạt.
- Backend: 69/69 test đạt khi có PostgreSQL 16 tạm thời; database migration/live validator đã đạt. Mobile audit còn 14 High transitive từ Expo/Metro và phải được xử lý hoặc risk-accept trước pilot.
- Emulator: M0–M4/M8, M6 savings, credit payment, credit pending → stop app → launch app → resume, Credit card lock → stop/launch → OTP unlock và Credit overdue notification → card detail đều đã pass; bằng chứng mới nằm trong `C:\Users\admin\.maestro\tests\2026-08-16_014619`, `C:\Users\admin\.maestro\tests\2026-08-16_013045`, `C:\Users\admin\.maestro\tests\2026-08-16_000436`, `C:\Users\admin\.maestro\tests\2026-08-16_000714`, `C:\Users\admin\.maestro\tests\2026-08-16_003018` và `C:\Users\admin\.maestro\tests\2026-08-16_004626`.

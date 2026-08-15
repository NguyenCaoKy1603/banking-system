# Mobile banking pilot runbook

Tài liệu này là checklist tối thiểu cho bản preview/pilot của mobile app. Nó không thay thế runbook vận hành của ngân hàng/BaaS partner.

Scope, threat model và data classification tham chiếu tại [`architecture/banking-mvp-scope-and-risk.md`](architecture/banking-mvp-scope-and-risk.md).

## Trạng thái implementation hiện tại

Reference backend sandbox và mobile flow đã được nối end-to-end ở mức contract: auth/session/device binding, MFA OTP/biometric, accounts/history/detail, transfer quote/step-up/idempotency, pending recovery, notifications, fraud report và Card mock. Backend server áp allowlist, kill switch, hạn mức minor-unit và policy step-up; không dùng component này cho tiền thật.

Snapshot kiểm tra local ngày 2026-08-15: mobile lint/typecheck đạt, 27 suites và 143 tests đạt; coverage đạt 95.45% statements/93.35% branches; database boundary validation đạt; backend typecheck/build và 37 test definition (37 pass, gồm 2 PostgreSQL persistence tests) đạt, trong đó 8 critical HTTP flow tests; OpenAPI validation đạt với 18 path; Maestro syntax validation đạt với 5 native E2E flow; Expo native config và web export 22 route đạt. M2 eKYC mô phỏng, M3 account detail/history filter, M4 transfer/beneficiary CRUD/QR payload/camera fallback, M8 notification list/detail/deep link và Card mock đã có ở mức local/reference. Đây là bằng chứng cho reference implementation, không thay thế E2E thiết bị thật hoặc certification với partner.

## Cấu hình môi trường

- `EXPO_PUBLIC_API_URL` bắt buộc phải được cấp từ secret/environment của EAS cho build production.
- Production chỉ chấp nhận URL `https://`; app không dùng fallback emulator khi build production.
- Android emulator development có thể dùng `http://10.0.2.2:5000/api/v1`.
- Backend reference local nằm tại [`../backend/README.md`](../backend/README.md); chỉ dùng để kiểm thử contract/idempotency, không dùng cho tiền thật.
- Auth có thể bật challenge MFA server-driven (`BANKING_MFA_REQUIRED=1` chỉ cho sandbox); OTP/assertion production phải đến từ Identity/risk provider, không dùng giá trị sandbox.
- Không đưa access token, refresh token, password, OTP hoặc dữ liệu tài chính vào log, analytics hay crash report.

## Quality gate trước khi build

CI phải xanh ở các bước database boundary validation, mobile lint, typecheck, unit test, OpenAPI validation, Maestro flow syntax, web export và backend typecheck/build/HTTP integration test. Critical E2E trên thiết bị thật và contract/integration test với core-banking partner vẫn là gate bắt buộc trước pilot.

Critical E2E cần chạy trên Android/iOS thật trước pilot: MFA challenge/refresh, double-tap/retry transfer, kill app trước và sau response submit, mở lại để truy vấn trạng thái `PENDING`, dùng token sai device, logout mọi thiết bị, bật kill switch, biometric prompt và gửi fraud report. Reference backend test hiện bao phủ các invariant HTTP nhưng không thay thế E2E thiết bị thật.

Các màn hình đã có test ID ổn định cho automation: `login-email`, `login-password`, `login-submit`, `login-mfa-code`, `login-mfa-submit`, `login-mfa-biometric`, `kyc-full-name`, `kyc-identity-number`, `kyc-address`, `kyc-select-sample-document`, `kyc-submit`, `beneficiary-list`, `beneficiary-display-name`, `beneficiary-account-number`, `beneficiary-bank-name`, `beneficiary-add`, `beneficiary-rename-*`, `beneficiary-delete-*`, `qr-code`, `qr-camera`, `qr-manual-payload`, `qr-parse-manual`, `qr-valid-payload`, `transfer-beneficiary-id`, `transfer-amount`, `transfer-create-quote`, `transfer-review-confirm`, `transfer-step-up-code`, `transfer-submit`, `transfer-status-refresh`, `first-transaction`, `notification-first`, `notification-detail`, `notification-open-target`, `profile-cards`, `cards-list`, `card-first`, `card-detail`, `card-toggle-visibility`, `card-toggle-lock`, `card-new-pin`, `card-confirm-pin`, `card-change-pin`, `fraud-reason`, `fraud-submit`, `logout-all-devices` và `quick-history`. Bộ Maestro flow bàn giao nằm tại `mobile-app/e2e/maestro`.

Không phát hành nếu còn lỗi High/Critical, nếu API URL production chưa được kiểm tra HTTPS, hoặc nếu chưa có người phụ trách hỗ trợ pilot.

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

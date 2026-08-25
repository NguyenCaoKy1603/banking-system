# Mobile banking foundation

Ứng dụng Expo/React Native này là client cho MVP ngân hàng số cá nhân. Repo đã có mobile foundation và backend reference sandbox để kiểm chứng end-to-end; backend đó dùng PostgreSQL persistent cho dữ liệu core, còn in-memory chỉ dành cho test nhanh và không đại diện cho production/core banking.

## Phạm vi hiện tại

- Đăng nhập/đăng ký qua Auth API contract, có server-driven MFA challenge khi policy yêu cầu.
- Khôi phục session khi mở app và route guard theo trạng thái auth.
- Lưu session bằng một bản ghi SecureStore nguyên tử, có serialize mutation và migration từ format cũ.
- Tạo installation ID bằng `expo-crypto`, lưu SecureStore và gửi `X-Device-ID` cho auth/API để backend thực thi device binding.
- Đăng xuất xóa session cục bộ trên thiết bị; có endpoint logout mọi thiết bị ở server.
- HTTP client có Authorization, timeout, cancel, request ID, idempotency key và refresh single-flight hook.
- Dashboard có trạng thái rỗng, thao tác nhanh có phản hồi rõ ràng và nội dung cuộn được.
- Accounts/transactions có cursor pagination, runtime validation và màn hình lịch sử.
- Home và Account Detail chỉ nhận số tài khoản đã che từ list API; khi bấm `Hiện đầy đủ` hoặc `Sao chép`, app gọi endpoint riêng để hiện và sao chép toàn bộ số tài khoản trong bộ nhớ tạm của phiên màn hình.
- Có transaction detail, notification giao dịch và fraud-reporting channel từ transaction detail.
- Transfer flow có beneficiary lookup, quote/phí, review, server-driven OTP/sinh trắc học step-up, idempotent submit và receipt state; danh bạ có list/create/rename/delete và chỉ hiển thị số tài khoản đã che.
- Có eKYC mô phỏng với form, ảnh giấy tờ mẫu và trạng thái DRAFT/PENDING/APPROVED/REJECTED.
- Có QR nhận tiền, QR code renderer, camera scanner, payload validation và manual fallback khi camera không dùng được.
- Notification có list/detail, mark-read và deep link tới transaction detail/profile theo resource của server.

Client đã có refresh rotation single-flight, server-side revoke best-effort, logout mọi thiết bị, native biometric gate, transfer intent resume sau crash và server-driven control policy. `EXPO_PUBLIC_DEVICE_ASSERTION` đã bị loại bỏ: native biometric prompt chỉ là local user presence, không phải bằng chứng backend; cho tới khi nối provider attestation/passkey được phê duyệt, client fail closed và không tự tạo device proof trong public bundle. OTP/MFA assertion provider, core adapter, audit/outbox/reconciliation production vẫn phải được nối với backend/partner contract trước khi pilot dùng tiền thật.

Contract accounts/transfers và control-policy hiện ở trạng thái DRAFT trong [`documents/api/banking-mvp-api-contract.md`](../documents/api/banking-mvp-api-contract.md). Backend reference sandbox nằm tại [`backend/README.md`](../backend/README.md), chỉ dùng để kiểm chứng end-to-end và không được dùng cho tiền thật.

## Môi trường

Development Android emulator có thể dùng fallback `http://10.0.2.2:5000/api/v1`. Build production bắt buộc khai báo `EXPO_PUBLIC_API_URL` qua EAS environment/secret và URL phải là HTTPS; thiếu URL sẽ fail closed.

Ví dụ local:

```text
EXPO_PUBLIC_API_URL=http://10.0.2.2:5000/api/v1
```

Với release APK local và backend chạy trên máy phát triển, bật sandbox HTTP tạm thời rồi reverse port:

```powershell
$env:EXPO_PUBLIC_SANDBOX_HTTP = "1"
$env:EXPO_PUBLIC_API_URL = "http://127.0.0.1:5000/api/v1"
adb reverse tcp:5000 tcp:5000
npx expo run:android --variant release --no-bundler --device Pixel_7_API_35
```

Sau khi sửa code JavaScript, có thể restart Metro; sau khi sửa `app.config.js`, manifest/native module hoặc release config, cần build và cài lại APK. Cờ `EXPO_PUBLIC_SANDBOX_HTTP=1` chỉ dùng local sandbox; production không bật cờ này và phải dùng HTTPS.

Không commit token, password, OTP hoặc dữ liệu tài chính vào source, log hay analytics.

## Lệnh kiểm tra

```bash
npm install
npm run lint
npm run validate:openapi
npm run validate:e2e
npm run generate:routes
npm run typecheck
npm test -- --runInBand
npm run export:web
```

Chạy reference backend ở terminal riêng:

```bash
cd ../backend
npm install
npm run typecheck
npm run build
npm test
npm run test:critical
npm start
```

EAS profile nằm trong [`eas.json`](./eas.json). Checklist pilot nằm trong [`documents/mobile-pilot-runbook.md`](../documents/mobile-pilot-runbook.md).
Native E2E flow dùng Maestro nằm trong [`e2e/maestro`](./e2e/maestro); cần preview/native build và thiết bị thật để chạy.
Scope/threat model/data classification nằm trong [`documents/architecture/banking-mvp-scope-and-risk.md`](../documents/architecture/banking-mvp-scope-and-risk.md).

## Kiến trúc dự kiến

Mobile giữ Expo/React Native. Backend production nên là modular monolith/BFF gồm Identity, Customer, Accounts, Transfers, Notifications và Audit; core banking là nguồn sự thật cho số dư. Mọi số tiền dùng integer minor unit/decimal, không dùng floating point. Chuyển tiền phải có idempotency key, state machine, immutable audit, outbox và reconciliation. `../backend` hiện chỉ là reference implementation cho boundary này; trước pilot phải thay bằng adapter/database/controls được partner phê duyệt.

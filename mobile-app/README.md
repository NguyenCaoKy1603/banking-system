# Mobile banking foundation

Ứng dụng Expo/React Native này là client cho MVP ngân hàng số cá nhân. Repo đã có mobile foundation và backend reference để kiểm chứng end-to-end; backend đó dùng PostgreSQL persistent cho dữ liệu core, còn in-memory lưu trạng thái trong RAM.

## Phạm vi hiện tại

- Giao diện dùng nhận diện riêng `NOVA Digital Banking`, design token thống nhất cho màu sắc, chữ, khoảng cách, bo góc, bóng đổ và vùng bấm; không sử dụng logo hoặc nội dung tiếp thị của ngân hàng khác.
- Thanh điều hướng gồm bốn mục `Trang chủ`, `Thẻ`, `QR`, `Thêm`; nút QR được nhấn mạnh nhưng vẫn có nhãn chữ và accessibility label.
- Trang chủ có đúng ba dịch vụ nhanh: chuyển tiền, tiền gửi và thẻ tín dụng; không có banner quảng cáo hoặc mục ưu đãi.
- Đăng nhập/đăng ký qua Auth API contract, có server-driven MFA challenge khi policy yêu cầu.
- Khôi phục session khi mở app và route guard theo trạng thái auth.
- Lưu session bằng một bản ghi SecureStore nguyên tử, có serialize mutation và migration từ format cũ.
- Tạo installation ID bằng `expo-crypto`, lưu SecureStore và gửi `X-Device-ID` cho auth/API để backend thực thi device binding.
- Đăng xuất xóa session cục bộ trên thiết bị; có endpoint logout mọi thiết bị ở server.
- HTTP client có Authorization, timeout, cancel, request ID, idempotency key và refresh single-flight hook.
- Dashboard có trạng thái rỗng, thao tác nhanh có phản hồi rõ ràng và nội dung cuộn được.
- Các màn chính dùng cùng một ngôn ngữ giao diện và có trạng thái loading, empty, error/retry, offline hoặc unauthorized phù hợp; tên dài và nội dung cuộn được kiểm tra trên Pixel 7 API 35.
- Accounts/transactions có cursor pagination, runtime validation và màn hình lịch sử.
- Home và Account Detail chỉ nhận số tài khoản đã che từ list API; khi bấm `Hiện đầy đủ` hoặc `Sao chép`, app gọi endpoint riêng để hiện và sao chép toàn bộ số tài khoản trong bộ nhớ tạm của phiên màn hình.
- Có transaction detail và notification giao dịch.
- Transfer flow có beneficiary lookup, quote/phí, review, persistent TOTP step-up, idempotent submit và receipt state; danh bạ có list/create/rename/delete và chỉ hiển thị số tài khoản đã che.
- Có eKYC persistent dùng cùng nguồn PostgreSQL với Admin, theo vòng đời DRAFT/SUBMITTED/UNDER_REVIEW/NEEDS_MORE_INFO/APPROVED/REJECTED.
- Danh sách thẻ không hiển thị thao tác đăng ký thêm khi khách hàng đã có thẻ; hồ sơ đang chờ dẫn về màn hình trạng thái. Khóa khẩn cấp không cần TOTP, còn mở khóa và báo mất dùng purpose TOTP riêng.
- Có “QR thông tin nhận tiền”, QR code renderer, camera scanner và manual fallback. Payload v2 dùng số tài khoản thay vì UUID nội bộ, chỉ nhận đúng schema đã version hóa và luôn được coi là `UNVERIFIED`; màn hình không khởi tạo giao dịch thanh toán.
- Notification có list/detail, mark-read và deep link tới transaction detail/profile theo resource của server.
- Trợ lý hướng dẫn NOVA (`/assistant`): Hỏi đáp câu hỏi thường gặp (FAQ) dựa trên danh mục câu trả lời chuẩn (Response Catalog), lọc tự động dữ liệu nhạy cảm (mật khẩu, CVV, OTP).
- Kế hoạch tài chính cá nhân (`/financial-advice`): Tính toán thặng dư thu chi và tư vấn phương án tiết kiệm mục tiêu (`SAVINGS_PLAN`) hoặc cân đối ngân sách (`BUDGET_BALANCE`).

Client đã có refresh rotation single-flight, server-side revoke best-effort, logout mọi thiết bị, native biometric gate, transfer intent resume sau crash và server-driven control policy. `EXPO_PUBLIC_DEVICE_ASSERTION` đã bị loại bỏ: native biometric prompt chỉ là local user presence, không phải bằng chứng backend; cho tới khi nối provider attestation/passkey được phê duyệt, client fail closed và không tự tạo device proof trong public bundle. OTP/MFA assertion provider, core adapter, audit/outbox/reconciliation production vẫn phải được nối với backend/partner contract trước khi pilot dùng tiền thật.

Contract accounts/transfers và control-policy hiện ở trạng thái DRAFT trong [`documents/api/banking-mvp-api-contract.md`](../documents/api/banking-mvp-api-contract.md). Backend reference nằm tại [`backend/README.md`](../backend/README.md).

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

### HTTPS local trên Android emulator

Emulator dùng HTTPS qua proxy local tại `https://localhost:5443`. Cài CA local vào emulator một lần, bật ADB reverse cho cổng proxy và Metro, rồi tạo bản Android debug riêng cho local sandbox:

```powershell
adb reverse tcp:5443 tcp:5443
adb reverse tcp:8082 tcp:8082
$env:REACT_NATIVE_PACKAGER_HOSTNAME = "localhost"
$env:APP_VARIANT = "local-sandbox"
$env:EXPO_PUBLIC_API_URL = "https://localhost:5443/api/v1"
$env:EXPO_PUBLIC_SANDBOX_HTTP = "0"
$env:LOCAL_HTTPS_TRUST_USER_CA = "1"
npm run android -- --port 8082
```

`LOCAL_HTTPS_TRUST_USER_CA=1` chỉ dùng khi build trực tiếp trên máy cho emulator, chỉ cho phép CA người dùng và HTTP Metro trên đúng hostname `localhost`, chặn cleartext tới các hostname khác, và bị từ chối với EAS, staging, production hoặc hostname API khác. Không dùng Expo Go cho lần kiểm tra này vì cấu hình chứng chỉ phải nằm trong APK của ứng dụng; sau khi thay đổi cấu hình native, cần build/cài APK local lại. Cấu hình này không tắt kiểm tra TLS và không chứa certificate/private key trong ứng dụng.

Không commit token, password, OTP hoặc dữ liệu tài chính vào source, log hay analytics.

## Lệnh kiểm tra

```bash
npm install
npm run lint
npm run validate:openapi
npm run validate:public-env
npm run validate:release
npm run test:transport-policy
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

EAS profile nằm trong [`eas.json`](./eas.json), gồm `preview`, `staging` và
`production`. Profile `staging` chỉ là cấu hình build; nó không chứng minh đã
có EAS project, signing key hoặc API HTTPS staging. Tài khoản EAS có thể cần
quyền cho custom environment `staging`; nếu không có, dùng build APK release
local với biến URL staging. Có thể thay EAS bằng
Android release build local miễn là APK được ký, có SHA-256 và kết nối đúng
staging URL. Checklist pilot nằm trong [`documents/mobile-pilot-runbook.md`](../documents/mobile-pilot-runbook.md).
Theo yêu cầu ngày 2026-10-11, các flow Maestro và lệnh chạy/kiểm tra E2E của Mobile đã được gỡ. Báo cáo chạy trước đây trong `documents/05-testing` chỉ là bằng chứng lịch sử; các lệnh E2E cũ không còn dùng được.
Scope/threat model/data classification nằm trong [`documents/architecture/banking-mvp-scope-and-risk.md`](../documents/architecture/banking-mvp-scope-and-risk.md).

## Kiến trúc dự kiến

Mobile giữ Expo/React Native. Backend production nên là modular monolith/BFF gồm Identity, Customer, Accounts, Transfers, Notifications và Audit; core banking là nguồn sự thật cho số dư. Mọi số tiền dùng integer minor unit/decimal, không dùng floating point. Chuyển tiền phải có idempotency key, state machine, immutable audit, outbox và reconciliation. `../backend` hiện chỉ là reference implementation cho boundary này; trước pilot phải thay bằng adapter/database/controls được partner phê duyệt.

# Banking reference backend

Đây là backend reference cho sandbox/local demo của mobile app. Nó dùng in-memory store, PBKDF2 và core-banking adapter giả lập để kiểm chứng contract, state machine, refresh rotation, idempotency, audit/outbox và reconciliation.

Database boundary PostgreSQL dạng DRAFT nằm tại [`database/001_banking_mvp.sql`](database/001_banking_mvp.sql). Persistent sandbox chỉ nối vào bảng snapshot reference; các bảng relational production chưa được wire vào domain service.

## Persistent sandbox PostgreSQL

Reference runtime có thêm chế độ `BANKING_STORAGE=postgres`. Chế độ này dùng `PostgresSnapshotRepository` với bảng `reference_state_snapshots`, advisory transaction lock và JSON state checkpoint để kiểm thử restart/concurrency trước khi có repository relational production. Đây vẫn là sandbox-only; không dùng snapshot JSON cho tiền thật.

```powershell
$env:DATABASE_URL = "postgresql://banking:banking@localhost:5432/banking_test"
$env:BANKING_STORAGE = "postgres"
npm run db:migrate
npm start
```

`npm test` tự chạy test persistence khi `DATABASE_URL` tồn tại; nếu không có PostgreSQL local thì test này được skip và phải chạy trong workflow có PostgreSQL service. Workflow CI tương ứng nằm tại [`../.github/workflows/backend-quality.yml`](../.github/workflows/backend-quality.yml).
Mẫu cấu hình không chứa credential thật nằm tại [`.env.example`](.env.example).

Không dùng component này cho tiền thật, production, KYC/AML hoặc thay thế core-banking partner. Trước pilot phải thay `InMemoryCoreBanking` bằng adapter được partner phê duyệt, dùng database/secret manager/observability thật và hoàn tất legal/compliance/security acceptance.

Process này chủ động từ chối khởi động khi `NODE_ENV=production` hoặc `BANKING_ENV=production` để tránh triển khai nhầm reference backend vào môi trường tiền thật.

## Chạy local

```powershell
npm install
npm run validate:database
npm run typecheck
npm run build
npm test
npm run test:critical
npm start
```

Để chuẩn bị dữ liệu cho Maestro mà không lấy ID thủ công, khởi động server sandbox rồi chạy `npm run seed:e2e` ở terminal khác. Lệnh này đăng ký/đăng nhập user E2E, tạo beneficiary nếu thiếu, tạo transfer notification và chỉ in các biến không nhạy cảm như `TEST_EMAIL`, `BENEFICIARY_ID`, `QR_PAYLOAD` cùng transfer seed. Password/OTP phải được cấp sẵn trong environment và không được in ra. Hướng dẫn đầy đủ nằm tại [`../documents/05-testing/e2e-sandbox-seed.md`](../documents/05-testing/e2e-sandbox-seed.md).

Server mặc định lắng nghe `http://localhost:5000/api/v1`; health/readiness tối giản ở `http://localhost:5000/healthz`. OTP transfer sandbox mặc định là `123456`; nếu bật `BANKING_MFA_REQUIRED=1` hoặc `BANKING_ENV=preview`, OTP login sandbox mặc định là `654321`. Có thể cấu hình challenge login server-driven bằng `BANKING_MFA_METHODS=OTP,BIOMETRIC`. Chỉ dùng các giá trị này trong local test.

Để kiểm thử crash/restart với transfer `PENDING`, chạy server với `BANKING_SETTLE_IMMEDIATELY=0`; worker/core-banking adapter thật phải chịu trách nhiệm settle/reconcile ở môi trường production.

Local server mặc định cho phép CORS `*`; production phải cấu hình `BANKING_ALLOWED_ORIGINS` bằng allowlist origin đã phê duyệt. Có thể giới hạn pilot bằng `BANKING_ALLOWLIST_ENABLED=1` và `BANKING_MAX_TRANSFER_AMOUNT_MINOR` (đơn vị minor-unit VND); các giới hạn này được áp ở server.

## Invariant được kiểm chứng

- Access/refresh token không lưu plaintext trong store; refresh token được rotate và token family bị revoke khi phát hiện reuse.
- Server authorization kiểm tra owner của account, beneficiary, quote và transfer.
- Login/MFA sandbox có rate-limit cửa sổ ngắn và challenge one-time; production phải dùng rate-limit phân tán của Identity/risk platform.
- Control policy có thể kiểm tra allowlist theo user và giới hạn transfer ở server; mobile chỉ là lớp hiển thị/fail-closed.
- Quote do server tính phí; amount dùng `bigint`/minor unit.
- Quote lưu snapshot beneficiary bất biến và chỉ được submit một lần; retry phải dùng cùng `Idempotency-Key`.
- Beneficiary duplicate dùng fingerprint của toàn bộ account number + bank, không dùng masked suffix.
- Customer/account/transfer/ledger/audit/outbox IDs runtime là UUID-compatible với PostgreSQL.
- HTTP router exact-match route; path thừa không được dispatch vào route prefix.
- Mỗi transfer/reversal tạo journal double-entry VND cân bằng và idempotent trong reference ledger.
- `Idempotency-Key` cùng fingerprint trả cùng receipt; key khác fingerprint trả `409`.
- Transfer không optimistic: core adapter cập nhật balance và tạo transaction trước khi trả receipt.
- Audit event, outbox event và reconciliation snapshot được tạo trong cùng reference service boundary; số dư đối soát được so với net balance của ledger.
- Reconciliation trả `differenceMinor = coreAvailableMinor - computedAvailableMinor`; transaction-derived balance được giữ riêng để phát hiện lệch nguồn.
- HTTP registration/login dùng PBKDF2 async; API sync methods chỉ giữ cho unit/reference test.
- Registration và transfer step-up có rate-limit; outbox có retry backoff, attempts và health threshold.

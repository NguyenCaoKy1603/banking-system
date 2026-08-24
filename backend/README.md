# Banking reference backend

> Cập nhật 2026-08-17: branch `codex/mini-core-banking-sandbox` dùng registration hai bước, Sandbox Funding operator, người nhận thật, OTP step-up theo context và Savings/Credit opt-in. User mới chỉ có một payment account 0 VND; không còn beneficiary/card/savings tự sinh. `npm run seed:e2e` đã được cập nhật để tự cấp Funding, tạo recipient thật khi có `E2E_RECIPIENT_PASSWORD`, và đi qua credit application/activation.

Đây là backend reference cho môi trường local của mobile app. Runtime mặc định dùng PostgreSQL persistent relational reference adapter; in-memory chỉ dành cho unit/reference test nhanh. PBKDF2 và core-banking adapter giả lập được dùng để kiểm chứng contract, state machine, refresh rotation, idempotency, audit/outbox và reconciliation.

Database boundary PostgreSQL dạng DRAFT nằm tại [`database/001_banking_mvp.sql`](database/001_banking_mvp.sql), phần mở rộng reference runtime ở [`database/005_relational_reference_runtime.sql`](database/005_relational_reference_runtime.sql). Persistent sandbox hiện chiếu dữ liệu nghiệp vụ M0–M4/M8 vào bảng relational; state auth tạm thời và Savings/Credit bonus được lưu theo từng record trong `reference_runtime_records` để giữ khả năng tương thích của reference service.

## Persistent sandbox PostgreSQL

Reference runtime có thêm chế độ `BANKING_STORAGE=postgres`. Chế độ này dùng `PostgresRelationalRepository`, advisory transaction lock và transaction boundary bao quanh mỗi request để kiểm thử restart/concurrency. `reference_state_snapshots` chỉ còn được đọc một lần để nâng dữ liệu sandbox cũ sang relational; dữ liệu mới không ghi lại thành một JSON snapshot tổng. Đây vẫn là sandbox-only; không dùng cho tiền thật.

```powershell
$env:DATABASE_URL = "postgresql://banking:banking@localhost:5432/banking_test"
$env:BANKING_STORAGE = "postgres"
npm run db:migrate
npm start
```

`npm test` tự chạy đầy đủ test persistence khi có cả `DATABASE_URL` và `RELATIONAL_DATABASE_URL`; nếu không có PostgreSQL local thì các test này được skip và phải chạy trong workflow có PostgreSQL service. Workflow CI tương ứng nằm tại [`../.github/workflows/backend-quality.yml`](../.github/workflows/backend-quality.yml).
Mẫu cấu hình không chứa credential thật nằm tại [`.env.example`](.env.example).

Kiểm thử riêng repository relational phải dùng một database disposable đã migrate, không dùng database demo đang chạy:

```powershell
$env:RELATIONAL_DATABASE_URL = "postgresql://banking:banking@localhost:5432/banking_relational_test"
npm run db:migrate
npm run test:relational
```

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

Để kiểm thử crash/restart, có thể tắt immediate settlement bằng `BANKING_SETTLE_IMMEDIATELY=0`, `BANKING_SETTLE_SAVINGS_IMMEDIATELY=0` hoặc `BANKING_SETTLE_CREDIT_PAYMENTS_IMMEDIATELY=0`. Operator sandbox gọi `POST /api/v1/sandbox/process-scheduled` với `X-Sandbox-Operator-Key` để đưa transfer, savings opening và credit payment đang `PENDING` sang terminal trước khi xử lý đáo hạn/sao kê. Endpoint này chỉ là processor reference tuần tự; worker/core-banking adapter thật vẫn phải chịu trách nhiệm lease, retry, callback, concurrency và reconciliation ở môi trường production.

Local server mặc định cho phép CORS `*`; production phải cấu hình `BANKING_ALLOWED_ORIGINS` bằng allowlist origin đã phê duyệt. Có thể giới hạn pilot bằng `BANKING_ALLOWLIST_ENABLED=1` và `BANKING_MAX_TRANSFER_AMOUNT_MINOR` (đơn vị minor-unit VND); các giới hạn này được áp ở server.

## Cấu hình chạy hiện tại — 2026-08-17

- `npm start` mặc định dùng `BANKING_STORAGE=postgres` và tự đọc `.env` nếu file tồn tại. Database phải được migrate trước; lệnh chuẩn là `npm run start:persistent`.
- `BANKING_STORAGE=in-memory` chỉ dành cho unit/reference test nhanh, không còn là chế độ runtime mặc định.
- PostgreSQL persistent hiện dùng `PostgresRelationalRepository`; test riêng `npm run test:relational` kiểm tra restart, pending transfer, reconciliation và concurrency trên database disposable có `RELATIONAL_DATABASE_URL`.
- Chương trình mô phỏng nghiệp vụ ngân hàng bằng tiền ảo. Không có kết nối core banking, payment rail, tài khoản thật, KYC/AML thật hoặc xử lý tiền thật.

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
- Persistent HTTP đọc và validate toàn bộ request body trước khi mở relational transaction, tránh giữ advisory lock trong lúc chờ client gửi dữ liệu.
- Persistent HTTP fail-closed với `503 PERSISTENCE_UNAVAILABLE` khi PostgreSQL không truy cập được; health không báo xanh khi storage lỗi.

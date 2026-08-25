# Banking reference backend

> Cập nhật 2026-08-25: reference sandbox dùng registration hai bước, TOTP-based MFA persistent cho login/transaction step-up, Admin four-eyes funding fixture, người nhận thật và Savings/Credit opt-in. User mới chỉ có một payment account 0 VND; không còn beneficiary/card/savings tự sinh. `npm run seed:e2e` yêu cầu email-code từ provider test và TOTP fixture, không đọc OTP từ backend.

Đây là backend reference cho môi trường local của mobile app. Runtime mặc định dùng PostgreSQL persistent relational reference adapter; in-memory chỉ dành cho unit/reference test nhanh. PBKDF2 và core-banking adapter giả lập được dùng để kiểm chứng contract, state machine, refresh rotation, idempotency, audit/outbox và reconciliation.

Database boundary PostgreSQL dạng DRAFT nằm tại [`database/001_banking_mvp.sql`](database/001_banking_mvp.sql), phần mở rộng reference runtime ở [`database/005_relational_reference_runtime.sql`](database/005_relational_reference_runtime.sql). Các migration P0 `006`–`011` bổ sung command idempotency, sequence account number, constraint/index transfer, normalized identity runtime, operation tables cho Savings/Credit và registration response recovery. HTTP preview hiện vẫn dùng adapter legacy để giữ tương thích trong lúc cutover; `reference_runtime_records` chưa được xóa và chưa được tuyên bố là relational-v2 source of truth.

## Persistent sandbox PostgreSQL

Reference runtime có thêm chế độ `BANKING_STORAGE=postgres`. Preview hiện dùng `PostgresRelationalRepository` legacy để bảo toàn API trong giai đoạn rehearsal; relational-v2 foundation nằm ở `src/database/` và được kiểm thử độc lập trên disposable database. `reference_state_snapshots` chỉ còn được đọc một lần để nâng dữ liệu sandbox cũ sang relational; dữ liệu mới không ghi lại thành một JSON snapshot tổng. Đây vẫn là sandbox-only; không dùng cho tiền thật.

```powershell
$env:DATABASE_URL = "postgresql://banking:banking@localhost:5432/banking_test"
$env:BANKING_STORAGE = "postgres"
npm run db:migrate
npm start
```

`npm test` tự chạy đầy đủ test persistence khi có cả `DATABASE_URL` và `RELATIONAL_DATABASE_URL`; foundation test P0 dùng `P0_RELATIONAL_DATABASE_URL` disposable riêng. Nếu không có PostgreSQL local thì các test database được skip ở local và phải chạy trong workflow có PostgreSQL service. Workflow CI tương ứng nằm tại [`../.github/workflows/backend-quality.yml`](../.github/workflows/backend-quality.yml).
Mẫu cấu hình không chứa credential thật nằm tại [`.env.example`](.env.example).

Kiểm thử riêng repository relational phải dùng một database disposable đã migrate, không dùng database demo đang chạy:

```powershell
$env:RELATIONAL_DATABASE_URL = "postgresql://banking:banking@localhost:5432/banking_relational_test"
npm run db:migrate
npm run test:relational
```

Không dùng component này cho tiền thật, production, KYC/AML hoặc thay thế core-banking partner. Trước pilot phải thay `InMemoryCoreBanking` bằng adapter được partner phê duyệt, dùng database/secret manager/observability thật và hoàn tất legal/compliance/security acceptance.

Runtime contract hiện cho phép `NODE_ENV=production` chỉ khi `BANKING_ENV=staging` hoặc `production-like`, nhưng luôn bắt buộc `BANKING_MONEY_MODE=virtual`, PostgreSQL, TOTP/MFA, key hợp lệ, full commit SHA và image digest. `BANKING_ENV=production` và mọi chế độ tiền thật đều bị từ chối; thiếu metadata hoặc secret thì fail closed.

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

Để chuẩn bị dữ liệu cho Maestro mà không lấy ID thủ công, khởi động server sandbox rồi chạy `npm run seed:e2e` ở terminal khác. Lệnh này đăng ký/đăng nhập user E2E, tạo beneficiary nếu thiếu, tạo transfer notification và chỉ in các biến không nhạy cảm như `TEST_EMAIL`, `BENEFICIARY_ID`, `QR_PAYLOAD` cùng transfer seed. Password, email confirmation code và TOTP secret/code phải được cấp sẵn trong environment của test provider và không được in ra. Hướng dẫn đầy đủ nằm tại [`../documents/05-testing/e2e-sandbox-seed.md`](../documents/05-testing/e2e-sandbox-seed.md).

Server mặc định lắng nghe `http://localhost:5000/api/v1`; health/readiness tối giản ở `http://localhost:5000/healthz`. Persistent runtime yêu cầu `BANKING_MFA_METHODS=TOTP`, pepper và encryption key; thiếu key sẽ fail closed. Email provider thật chưa được nối trong reference sandbox.

Giai đoạn 1 bổ sung `/livez` cho liveness độc lập database, `/startupz` cho config/key/repository startup và `/readyz` là readiness có database. `/healthz` dành cho monitoring sâu hơn; `/versionz` trả release ID, commit SHA, image digest, schema/migration fingerprint và money mode, không chứa credential hoặc dữ liệu tài chính nhạy cảm. Khi `BANKING_ALLOWED_ORIGINS` là allow-list, Origin ngoài danh sách bị từ chối bằng `403 CORS_ORIGIN_DENIED`.

Để kiểm thử crash/restart, có thể tắt immediate settlement bằng `BANKING_SETTLE_IMMEDIATELY=0`, `BANKING_SETTLE_SAVINGS_IMMEDIATELY=0` hoặc `BANKING_SETTLE_CREDIT_PAYMENTS_IMMEDIATELY=0`. Scheduled work được worker xử lý; test unit gọi boundary fixture nội bộ, còn Admin API chỉ tạo action retry/cancel qua quy trình bốn mắt. Public API không có operator key hoặc endpoint bypass.

Local server mặc định cho phép CORS `*`; production phải cấu hình `BANKING_ALLOWED_ORIGINS` bằng allowlist origin đã phê duyệt. Có thể giới hạn pilot bằng `BANKING_ALLOWLIST_ENABLED=1` và `BANKING_MAX_TRANSFER_AMOUNT_MINOR` (đơn vị minor-unit VND); các giới hạn này được áp ở server.

## Cấu hình chạy hiện tại — 2026-08-17

- `npm start` mặc định dùng `BANKING_STORAGE=postgres` và tự đọc `.env` nếu file tồn tại. Database phải được migrate trước; lệnh chuẩn là `npm run start:persistent`.
- `BANKING_STORAGE=in-memory` chỉ dành cho unit/reference test nhanh, không còn là chế độ runtime mặc định.
- PostgreSQL persistent hiện dùng `PostgresRelationalRepository` legacy trong khi cutover P0 đang được rehearsal; test `npm run test:relational` kiểm tra restart/pending/reconciliation, còn `npm run test:database` kiểm tra UnitOfWork, direct transfer repository/use case và fault injection trên database disposable có `P0_RELATIONAL_DATABASE_URL`.
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

## Docker preview persistent

`backend/Dockerfile` là multi-stage image dùng Node 22, build TypeScript ở builder nhưng runtime chỉ copy JavaScript đã build, production dependencies, SQL migration và chạy dưới user `node`. Runtime command là `node dist/server.js`; migration one-shot dùng Node-native `scripts/apply-migration.cjs`, không cần `tsx`.

Compose đầy đủ nằm tại [`../compose.yaml`](../compose.yaml). Tạo `.env.compose` từ [`../.env.compose.example`](../.env.compose.example), thay các giá trị placeholder rồi chạy:

```powershell
docker compose --env-file .env.compose up -d --build
docker compose --env-file .env.compose exec backend node scripts/container-smoke.cjs
```

`.env.compose` chỉ dành cho preview local và bị ignore. Database chỉ bind loopback local; cloud preview phải dùng PostgreSQL private/secret manager. Workflow [`../.github/workflows/preview-container-smoke.yml`](../.github/workflows/preview-container-smoke.yml) tái hiện build, migration database rỗng, health, smoke flow và restart-login trên GitHub Actions.

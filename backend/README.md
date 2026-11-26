# Banking reference backend

> Cập nhật 2026-10-11: theo yêu cầu người dùng, các bộ E2E chạy được của Backend và Mobile cùng fixture seed chỉ phục vụ E2E đã được gỡ. Unit test và integration test vẫn được giữ. Hướng dẫn/bằng chứng E2E cũ chỉ còn để tra cứu lịch sử.

Đây là backend reference cho mobile app. Runtime mặc định dùng PostgreSQL persistent relational reference adapter; in-memory lưu trạng thái trong RAM. PBKDF2 và core-banking adapter nội bộ phục vụ contract, state machine, refresh rotation, idempotency, audit/outbox và reconciliation.

Database boundary PostgreSQL dạng DRAFT nằm tại [`database/001_banking_mvp.sql`](database/001_banking_mvp.sql), phần mở rộng reference runtime ở [`database/005_relational_reference_runtime.sql`](database/005_relational_reference_runtime.sql). Các migration P0 `006`–`011` và `029`–`051` bổ sung command idempotency, identity/MFA, transfer, Savings, Credit, remaining customer routes, scheduled lifecycle, policy/rate-limit, beneficiary lifecycle, counterparty snapshot, KYC runtime, lifecycle suspense/keyset indexes, card-security case, Admin two-role/operations direct creation, savings early withdrawal, phát hiện giao dịch bất thường (`045`), xác thực sinh trắc học gắn thiết bị (`046`), chuẩn hóa `ledger_entries.account_ref` (`047`), hạn mức chuyển tiền theo ngày (`048`), chuyển khoản liên ngân hàng mô phỏng NAPAS IBFT & `held_minor` (`049`), quên/đổi mật khẩu & metadata thiết bị (`050`) và biểu phí chuyển tiền động (`051`). Local Compose hiện dùng boundary relational-v2 trực tiếp cho các route customer đã duyệt; `reference_runtime_records` chỉ còn cho migration/regression và không phải source of truth của HTTP relational-v2.

## PostgreSQL persistent mode

Reference runtime có thêm chế độ `BANKING_STORAGE=postgres`. Local Compose với `BANKING_PERSISTENCE_MODE=relational-v2` dùng các repository transactional trực tiếp qua `UnitOfWork`; adapter `PostgresRelationalRepository` legacy và `reference_state_snapshots` chỉ còn cho migration/regression. Dữ liệu mới của HTTP relational-v2 không ghi lại thành một JSON snapshot tổng.

HTTP cutover local dùng `BANKING_PERSISTENCE_MODE=relational-v2` và group `auth,registration,mfa,accounts,beneficiaries,transfers,savings,credit,recipients,notifications,kyc` để nối registration (provider boundary), session, persistent MFA lifecycle, account reads, beneficiary CRUD, transfer, Savings, Credit, recipient lookup, notification và KYC trực tiếp qua UnitOfWork PostgreSQL, không gọi `withState`. API báo cáo gian lận đã được gỡ; migration/bảng dữ liệu cũ được giữ nguyên để bảo toàn lịch sử. Mã xác nhận registration chỉ được provider đăng ký giữ trong bộ nhớ; PostgreSQL chỉ giữ digest và outbox intent không chứa mã. Scheduled settlement/maturity vẫn chưa bật worker preview. Bản đồ và kiến trúc relational-v2 nằm tại [`documents/07-architecture/p0-postgres-relational-v2-adr.md`](../documents/07-architecture/p0-postgres-relational-v2-adr.md). Local vẫn là `UNTRUSTED LOCAL PREVIEW` với `IMAGE_DIGEST=unknown`, không phải staging verified.

```powershell
$env:DATABASE_URL = "postgresql://banking:banking@localhost:5432/banking_test"
$env:BANKING_STORAGE = "postgres"
npm run db:migrate
npm start
```

Các suite PostgreSQL destructive không được trỏ vào preview. Guard bắt buộc
`NODE_ENV=test`, `BANKING_ENV=test`, `ALLOW_DATABASE_TEST_RESET=1`, host local
được allow và tên database `banking_test_<suffix>`. Lệnh `test:database`,
`test:relational`, `test:persistence`, `test:admin:database` tự tạo database
disposable từ `DATABASE_TEST_ADMIN_URL`, migrate, chạy suite và dọn database;
không đọc `.env.compose`. Nếu không cấp maintenance URL thì lệnh dừng fail-closed,
không skip im lặng. Workflow CI tương ứng nằm tại [`../.github/workflows/backend-quality.yml`](../.github/workflows/backend-quality.yml).
Mẫu cấu hình không chứa credential thật nằm tại [`.env.example`](.env.example).

Kiểm thử riêng repository relational phải dùng một database disposable đã migrate, không dùng database demo đang chạy:

```powershell
$env:DATABASE_TEST_ADMIN_URL = "postgresql://banking:<local-password>@localhost:5433/postgres"
npm run test:relational
Remove-Item Env:DATABASE_TEST_ADMIN_URL
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

Server mặc định lắng nghe `http://localhost:5000/api/v1`; health/readiness tối giản ở `http://localhost:5000/healthz`. Persistent runtime yêu cầu `BANKING_MFA_METHODS=TOTP`, pepper và encryption key; thiếu key sẽ fail closed. Email boundary hỗ trợ `disabled`, HTTP capture và Gmail SMTP local; staging vẫn phải dùng HTTPS/credential từ secret manager và fail closed khi provider chưa cấu hình.

Giai đoạn 1 bổ sung `/livez` cho liveness độc lập database, `/startupz` cho config/key/repository startup và `/readyz` là readiness có database. `/healthz` dành cho monitoring sâu hơn; `/versionz` trả release ID, commit SHA, image digest, schema/migration fingerprint và money mode, không chứa credential hoặc dữ liệu tài chính nhạy cảm. Khi `BANKING_ALLOWED_ORIGINS` là allow-list, Origin ngoài danh sách bị từ chối bằng `403 CORS_ORIGIN_DENIED`.

Để kiểm thử crash/restart, có thể tắt immediate settlement bằng `BANKING_SETTLE_IMMEDIATELY=0`, `BANKING_SETTLE_SAVINGS_IMMEDIATELY=0` hoặc `BANKING_SETTLE_CREDIT_PAYMENTS_IMMEDIATELY=0`. Scheduled lifecycle đã được gắn vào worker với poll/batch/readiness và được kiểm tra bằng hai scheduler trên database disposable; worker preview vẫn chưa được bật. Admin API chỉ tạo action retry/cancel qua quy trình bốn mắt. Public API không có operator key hoặc endpoint bypass.

Local server mặc định cho phép CORS `*`; production phải cấu hình `BANKING_ALLOWED_ORIGINS` bằng allowlist origin đã phê duyệt. Có thể giới hạn pilot bằng `BANKING_ALLOWLIST_ENABLED=1` và `BANKING_MAX_TRANSFER_AMOUNT_MINOR` (đơn vị minor-unit VND); các giới hạn này được áp ở server.

## Cấu hình chạy hiện tại — 2026-08-29

- `npm start` mặc định dùng `BANKING_STORAGE=postgres` và tự đọc `.env` nếu file tồn tại. Database phải được migrate trước; lệnh chuẩn là `npm run start:persistent`.
- `BANKING_STORAGE=in-memory` chỉ dành cho unit/reference test nhanh, không còn là chế độ runtime mặc định.
- PostgreSQL local preview dùng boundary relational-v2 cho các nhóm customer đã duyệt; `npm run test:relational`, `test:mfa:persistence`, `test:registration:persistence`, `test:savings:persistence`, `test:credit:persistence`, `test:remaining:persistence`, `test:lifecycle:persistence` và các suite KYC kiểm tra restart/concurrency/rollback trên database disposable có `DATABASE_TEST_ADMIN_URL`. Worker chỉ được rehearsal trên disposable bằng `test:worker`; không bật worker runtime trên preview. KYC runtime persistent dùng cùng nguồn PostgreSQL cho Customer/Admin; KYC/AML provider thật vẫn ngoài phạm vi.
- Không có kết nối core banking, payment rail, tài khoản thật, KYC/AML provider thật hoặc xử lý tiền thật.

## Kiến trúc phân tầng Backend (4-Layer Clean Architecture)

Hệ thống Backend được tổ chức theo kiến trúc phân tầng rõ ràng nhằm đảm bảo tính module hóa, dễ đọc, dễ học và dễ bảo trì:

```text
backend/src/
├── routes/                  # [TẦNG 1: ROUTING] Ánh xạ URL & phương thức HTTP tới Controller tương ứng
│   ├── systemRoutes.ts      # Health checks (/livez, /readyz, /startupz, /metrics)
│   ├── authRoutes.ts        # Route Đăng ký, Đăng nhập, Đổi/Quên mật khẩu, Thiết bị, MFA/TOTP & Biometric
│   ├── accountRoutes.ts     # Route Tài khoản, Lịch sử lọc server, Thống kê tháng (/summary), Xuất sao kê (/statement-export)
│   ├── transferRoutes.ts    # Route Chuyển tiền nội bộ & NAPAS IBFT mô phỏng, Tra cứu nội bộ/ngoài, Báo giá, Danh bạ thụ hưởng
│   ├── anomalyRoutes.ts     # Route Cảnh báo giao dịch bất thường (/anomalies, /:id, /:id/acknowledge)
│   ├── cardRoutes.ts        # Route Thẻ ATM/Debit, Thẻ tín dụng
│   ├── savingsRoutes.ts     # Route Tiết kiệm có kỳ hạn
│   ├── kycRoutes.ts         # Route Định danh eKYC
│   ├── notificationRoutes.ts# Route Thông báo
│   ├── assistantRoutes.ts   # Route Trợ lý AI & Lời khuyên tài chính
│   ├── mobileRoutes.ts      # Route Chính sách ứng dụng Mobile
│   ├── httpUtils.ts         # Tiện ích HTTP chung, đệm buffer và đọc stream JSON
│   └── index.ts             # Barrel export cho toàn bộ Router
├── controllers/             # [TẦNG 2: CONTROLLERS] Tiếp nhận Request, bóc tách tham số, gọi Service & trả Response
│   ├── accountController.ts # Xử lý xem tài khoản, lọc lịch sử, thống kê tháng, xuất sao kê CSV/HTML
│   ├── transferController.ts# Xử lý tra cứu nội bộ/NAPAS, báo giá, thực hiện chuyển tiền, quản lý danh bạ
│   ├── anomalyController.ts # Xử lý xem & xác nhận cảnh báo giao dịch bất thường
│   ├── authController.ts    # Xử lý đăng ký, đăng nhập, đổi/quên mật khẩu, thiết bị, MFA/TOTP & Biometric
│   ├── savingsController.ts # Xử lý mở sổ tiết kiệm, tính lãi, tất toán trước hạn
│   ├── cardController.ts    # Xử lý thẻ ATM, khóa/mở thẻ, hạn mức tín dụng, sao kê
│   ├── kycController.ts     # Xử lý định danh điện tử eKYC
│   ├── notificationController.ts # Xử lý thông báo biến động số dư
│   ├── assistantController.ts    # Xử lý hội thoại AI và tư vấn tài chính
│   ├── mobileController.ts  # Xử lý cấu hình chính sách ứng dụng di động
│   └── index.ts             # Barrel export cho Controllers
├── middlewares/             # [TẦNG TIỆN ÍCH CHUNG: MIDDLEWARES] Xử lý các quy tắc xuyên suốt (Cross-cutting Concerns)
│   ├── corsMiddleware.ts    # Quản lý chính sách nguồn gốc CORS và OPTIONS preflight
│   ├── authMiddleware.ts    # Kiểm tra Bearer Token, ràng buộc thiết bị, Step-Up TOTP & Biometric
│   ├── errorMiddleware.ts   # Bắt lỗi tập trung, mapping DomainError và DatabaseCommandError
│   ├── recipientLookupRateLimiter.ts # Giới hạn tần suất tra cứu tài khoản thụ hưởng
│   └── index.ts             # Barrel export cho Middlewares
├── services/                # [TẦNG 3: SERVICES] Điều phối quy trình nghiệp vụ ngân hàng (Use Cases)
│   ├── coreBanking.ts       # Nghiệp vụ ngân hàng lõi in-memory (CoreBankingPort)
│   └── index.ts             # Barrel export cho Services
├── domain/                  # [TẦNG 4: DOMAIN] Quy tắc tài chính thuần túy (Pure Rules)
│   ├── ledger.ts            # Sổ cái kế toán kép (Double-entry Ledger) cân bằng Nợ/Có
│   ├── money.ts             # Tính toán tiền tệ VND an toàn (minor units, không làm tròn sai)
│   ├── anomaly/             # [Domain Anomaly] Chấm điểm rủi ro giao dịch tất định bằng BigInt (6 quy tắc)
│   ├── napas/               # [Domain NAPAS Mock] Cổng mô phỏng liên ngân hàng NAPAS IBFT (8 mã BIN VN)
│   │   └── mockNapasGateway.ts
│   ├── savings/             # [Domain Tiết kiệm] Quy tắc tiền gửi, tính lãi & ngày đáo hạn
│   │   ├── types.ts         # Khai báo thực thể & danh mục gói tiết kiệm
│   │   ├── calculations.ts  # Thuật toán tính lãi suất, ngày đáo hạn, tất toán trước hạn
│   │   ├── mappers.ts       # Làm sạch dữ liệu nội bộ trước khi trả ra ngoài
│   │   └── index.ts         # Barrel export cho module Savings
│   ├── credit/              # [Domain Tín dụng] Quy tắc thẻ tín dụng, hạn mức & chu kỳ sao kê
│   │   ├── types.ts         # Khai báo thực thể thẻ tín dụng, giao dịch, sao kê
│   │   ├── calculations.ts  # Thuật toán tính hạn mức khả dụng, thanh toán tối thiểu, ngày chốt sổ
│   │   ├── mappers.ts       # Nhân bản an toàn và bảo vệ dữ liệu thẻ tín dụng
│   │   └── index.ts         # Barrel export cho module Credit
│   └── index.ts             # Barrel export cho Domain
├── database/                # [TẦNG 5: INFRASTRUCTURE] Lưu trữ bền vững PostgreSQL & Repositories
│   ├── repositories/        # Các repository lưu trữ theo domain (gồm anomalyRepository, accountRepository, auditRepository, ...)
│   ├── postgresRelationalRepository.ts # Bộ điều hợp lưu trữ quan hệ PostgreSQL & snapshot bridge
│   ├── postgresSnapshotRepository.ts   # Bộ điều hợp lưu trữ snapshot JSON
│   ├── unitOfWork.ts        # Quản lý transaction PostgreSQL UnitOfWork
│   ├── controlPolicyRepository.ts      # Chính sách động: Kill-Switch, hạn mức ngày, biểu phí chuyển tiền
│   ├── transferService.ts   # Xử lý chuyển tiền nội bộ & NAPAS 2 pha held_minor, anomaly scoring
│   ├── anomalyService.ts    # Xử lý danh sách & xác nhận cảnh báo giao dịch bất thường
│   ├── savingsService.ts    # Xử lý tiết kiệm transactional qua SQL
│   ├── creditService.ts     # Xử lý thẻ tín dụng transactional qua SQL
│   └── pool.ts              # Quản lý kết nối PostgreSQL
├── admin/                   # [ADMIN CONTROL PLANE] Staff auth, 63-route RBAC, Maker-Checker, Policy & Ledger Reconciliation
├── mfa/                     # [TẦNG 4: INFRASTRUCTURE] Hạ tầng bảo mật xác thực 2 lớp (TOTP, Email OTP, Biometric v1)
├── secrets/                 # [TẦNG 4: INFRASTRUCTURE] Quản lý khóa bí mật (Secret Manager)
└── observability/           # [TẦNG 4: INFRASTRUCTURE] Giám sát hệ thống (Logger, Prometheus Metrics)
```

### Bảng tra cứu nhanh tính năng (Feature Lookup Table)

| Tính năng nghiệp vụ | Router (Tầng 1) | Controller (Tầng 2) | Service & Domain (Tầng 3 & 4) |
| :--- | :--- | :--- | :--- |
| **Đăng ký, Đăng nhập, Đổi/Quên MK, Thiết bị, MFA/Biometric** | [`src/routes/authRoutes.ts`](src/routes/authRoutes.ts) | [`src/controllers/authController.ts`](src/controllers/authController.ts) | `relationalAuthService.ts` / `mfa/` (`crypto.ts`, `persistentMfaService.ts`) |
| **Chuyển tiền (Nội bộ & NAPAS IBFT) & Danh bạ** | [`src/routes/transferRoutes.ts`](src/routes/transferRoutes.ts) | [`src/controllers/transferController.ts`](src/controllers/transferController.ts) | `database/transferService.ts` / [`src/domain/napas/mockNapasGateway.ts`](src/domain/napas/mockNapasGateway.ts) |
| **Phát hiện & Xử lý giao dịch bất thường** | [`src/routes/anomalyRoutes.ts`](src/routes/anomalyRoutes.ts) | [`src/controllers/anomalyController.ts`](src/controllers/anomalyController.ts) | `database/anomalyService.ts` / [`src/domain/anomaly/`](src/domain/anomaly/) |
| **Tài khoản, Lọc lịch sử, Thống kê tháng & Xuất sao kê** | [`src/routes/accountRoutes.ts`](src/routes/accountRoutes.ts) | [`src/controllers/accountController.ts`](src/controllers/accountController.ts) | `database/relationalAccountReadService.ts` / `services/coreBanking.ts` |
| **Tiết kiệm có kỳ hạn & Tính lãi** | [`src/routes/savingsRoutes.ts`](src/routes/savingsRoutes.ts) | [`src/controllers/savingsController.ts`](src/controllers/savingsController.ts) | `database/savingsService.ts` / [`src/domain/savings/`](src/domain/savings/) |
| **Thẻ ghi nợ & Thẻ tín dụng** | [`src/routes/cardRoutes.ts`](src/routes/cardRoutes.ts) | [`src/controllers/cardController.ts`](src/controllers/cardController.ts) | `database/creditService.ts` / [`src/domain/credit/`](src/domain/credit/) |
| **Định danh điện tử eKYC** | [`src/routes/kycRoutes.ts`](src/routes/kycRoutes.ts) | [`src/controllers/kycController.ts`](src/controllers/kycController.ts) | `database/kycService.ts` |
| **Thông báo biến động số dư** | [`src/routes/notificationRoutes.ts`](src/routes/notificationRoutes.ts) | [`src/controllers/notificationController.ts`](src/controllers/notificationController.ts) | `database/remainingService.ts` / `system` |
| **Trợ lý AI & Lời khuyên tài chính** | [`src/routes/assistantRoutes.ts`](src/routes/assistantRoutes.ts) | [`src/controllers/assistantController.ts`](src/controllers/assistantController.ts) | `assistant/` / `financialAdvice/` |
| **Chính sách động, Đối soát Sổ cái & Admin** | [`src/routes/mobileRoutes.ts`](src/routes/mobileRoutes.ts) / `src/admin/http/adminHttp.ts` | [`src/controllers/mobileController.ts`](src/controllers/mobileController.ts) | `database/controlPolicyRepository.ts` / `admin/repositories/adminRepository.ts` |
| **CORS, Bảo vệ Auth & Bắt lỗi** | — | — | [`src/middlewares/`](src/middlewares/) |
| **Sổ cái kế toán kép (Double-entry)** | — | — | [`src/domain/ledger.ts`](src/domain/ledger.ts) |
| **Tính toán tiền tệ VND an toàn** | — | — | [`src/domain/money.ts`](src/domain/money.ts) |

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

`.env.compose` chỉ dành cho preview local và bị ignore. Trong `compose.yaml`, Customer Backend publish trên `0.0.0.0:5000` để thiết bị trong mạng LAN nội bộ có thể thử nghiệm Mobile/web local, trong khi PostgreSQL và Admin API chỉ bind loopback local (`127.0.0.1`); cloud preview phải dùng PostgreSQL private/secret manager và HTTPS. Workflow [`../.github/workflows/preview-container-smoke.yml`](../.github/workflows/preview-container-smoke.yml) tái hiện build, migration database rỗng, health, smoke flow và restart-login trên GitHub Actions.

# Backend hardening test report

> Cập nhật hiện hành 2026-08-17: trên branch `codex/mini-core-banking-sandbox`, suite hiện có 69/69 test đạt khi có `DATABASE_URL`; relational regression 1/1 đạt trên database disposable; critical API 8/8, migration từ PostgreSQL rỗng và live validator 28 bảng đều đạt. Không có `DATABASE_URL` thì 5 test persistence và relational regression không có `RELATIONAL_DATABASE_URL` sẽ được skip; đó là hành vi có chủ ý của test local.

Ngày kiểm tra: 2026-08-17
Phạm vi: correctness P1/P2, reference hardening và persistent sandbox adapter
Trạng thái: **In-memory và PostgreSQL persistent reference relational pass; production adapter toàn domain vẫn là DRAFT**
Commit backend gần nhất: `08e8d33` (`Use relational PostgreSQL reference persistence`)

## Đã kiểm chứng local

| Gate | Kết quả |
| --- | --- |
| Typecheck/build | Đạt |
| Database boundary validator | Đạt, kiểm tra cấu trúc SQL và live PostgreSQL: 28 bảng, cột UUID/transfer/notification/runtime và constraint chính |
| Unit + HTTP tests | 69 test definition; PostgreSQL 16 local: 69/69 đạt, gồm body validation trước transaction và fail-closed khi DB unavailable |
| Relational persistence | `npm run test:relational`: 1/1 đạt trên database disposable, gồm restart, pending settlement, reconciliation và concurrent quote submit |
| Critical HTTP tests | 8 đạt |
| Backend dependency audit | 0 vulnerability |
| Quote correctness | Snapshot beneficiary, one-time quote, idempotent retry |
| Beneficiary identity | Full account fingerprint + bank, không dùng masked suffix |
| Reconciliation | `differenceMinor = core - ledger` và test drift -1 |
| Runtime IDs | UUID-compatible với PostgreSQL |
| Router | Trailing segment bị 404 |
| Rate limit | Registration và transfer step-up có regression test |
| Outbox | Retry backoff/attempts và health threshold có regression test |
| M8 notification target | HTTP và domain test xác nhận `resourceId=transactionId`, `resourceAccountId=accountId`; Mobile route chỉ mở transaction khi đủ cả hai trường |

## PostgreSQL gate

Test `persistence.test.ts` dùng `DATABASE_URL`, chạy migration từ database rỗng, kiểm tra restart state, HTTP restart và concurrent submit bằng hai idempotency key khác nhau. Gate local đã chạy với PostgreSQL 16 trong Docker: migration từ database rỗng đạt, chạy lại migration không lỗi, live schema validation đạt, cả 69/69 test đạt và chỉ một request concurrent được debit. Workflow [`backend-quality.yml`](../../.github/workflows/backend-quality.yml) tái hiện cùng gate trên CI service.

`relationalPersistence.test.ts` chạy bằng `RELATIONAL_DATABASE_URL` trên database disposable riêng, kiểm tra cùng một quote khi hai request đến đồng thời, pending hold → settle, restart và reconciliation sau khi ghi vào bảng relational.

Persistent mode dùng `PostgresRelationalRepository` với advisory transaction lock. Core M0–M4/M8 ghi vào bảng relational; auth runtime và M6/M7 bonus dùng record-level JSONB. `reference_state_snapshots` chỉ là đường nâng dữ liệu cũ một lần; đây vẫn là sandbox-only.

## Còn thiếu

- Chưa có log của một CI run remote; local PostgreSQL integration đã đạt với Docker PostgreSQL 16.
- Chưa có migration rollback/backup-restore rehearsal.
- Core M0–M4/M8 đã wire vào các bảng relational reference tương ứng; auth runtime và M6/M7 vẫn lưu record-level JSONB, chưa phải repository production toàn domain.

## Cap nhat xac nhan cuoi M7 - 2026-08-15

- Credit test bao phu seed balance/minimum, quote one-time, payment ledger/reconciliation, pending resume, lock/unlock va HTTP idempotency flow.
- `npm test`: local không có `DATABASE_URL` 69 test, 63 pass, 6 skip; với PostgreSQL 16 tạm thời 69/69 pass, bao gồm restart/concurrency Credit và overdue notification idempotency.
- `npm run test:critical` 8/8; typecheck, build, OpenAPI validator va Backend dependency audit (0 vulnerability) dat.
- `003_credit_sandbox.sql` và `005_relational_reference_runtime.sql` đã migrate từ database rỗng; live validator kiểm tra 28 table definitions và constraints chính.
- `seed:e2e` da chay thanh cong voi MFA sandbox: transfer va savings `SUCCEEDED`, Credit card/statement seed thanh cong; khong in password/OTP.
- Persistent mode đã chuyển sang relational reference adapter cho core; repository production toàn domain và backup/restore rehearsal vẫn mở.

## Xác nhận hiện hành — 2026-08-17

- Clone sạch đã chạy `npm ci`; backend typecheck/build/OpenAPI đạt, migration từ database PostgreSQL rỗng đạt và test backend 69/69 đạt.
- Persistent HTTP đọc/validate request body trước advisory lock và trả `503 PERSISTENCE_UNAVAILABLE` khi PostgreSQL không truy cập được.
- Backend source checkpoint: `08e8d33`; health fail-closed và request transaction boundary nằm trong lịch sử trước đó.
- Runtime mặc định hiện dùng `PostgresRelationalRepository`: core M0–M4/M8 được lưu trong bảng relational; auth runtime và M6/M7 bonus dùng `reference_runtime_records` theo từng record. Snapshot JSON chỉ còn đường nâng dữ liệu cũ một lần, không phải nguồn ghi mới.
- `npm run seed:e2e` đã chạy lại trên adapter relational sau restart backend: registration/MFA → Sandbox Funding → transfer `SUCCEEDED` → savings `SUCCEEDED` → credit application/activation; stdout không chứa password/OTP.
- Health JSON an toàn (không chứa credential/token/OTP) được lưu tại [`health-sandbox-2026-08-17.json`](health-sandbox-2026-08-17.json).

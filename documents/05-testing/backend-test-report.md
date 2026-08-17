# Backend hardening test report

> Cập nhật hiện hành 2026-08-17: trên branch `codex/mini-core-banking-sandbox`, suite hiện có 68/68 test đạt khi có `DATABASE_URL`; critical API 8/8, migration từ PostgreSQL rỗng và live validator 27 bảng đều đạt. Không có `DATABASE_URL` thì 4 test persistence được skip; đó là hành vi có chủ ý của test local.

Ngày kiểm tra: 2026-08-17
Phạm vi: correctness P1/P2, reference hardening và persistent sandbox adapter
Trạng thái: **In-memory và PostgreSQL persistent sandbox pass; relational production adapter vẫn là DRAFT**
Commit kiểm thử: `0f06b77` (`Harden M7 state migration and credit payment flow`)

## Đã kiểm chứng local

| Gate | Kết quả |
| --- | --- |
| Typecheck/build | Đạt |
| Database boundary validator | Đạt, kiểm tra cấu trúc SQL và live PostgreSQL: 27 bảng, cột UUID/transfer/notification/savings/credit và constraint chính |
| Unit + HTTP tests | 68 test definition; PostgreSQL 16 local: 68/68 đạt, gồm body validation trước transaction và fail-closed khi DB unavailable |
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

Test `persistence.test.ts` dùng `DATABASE_URL`, chạy migration từ database rỗng, kiểm tra restart state, HTTP restart và concurrent submit bằng hai idempotency key khác nhau. Gate local đã chạy với PostgreSQL 16 trong Docker: migration từ database rỗng đạt, chạy lại migration không lỗi, live schema validation đạt, cả 68/68 test đạt và chỉ một request concurrent được debit. Workflow [`backend-quality.yml`](../../.github/workflows/backend-quality.yml) tái hiện cùng gate trên CI service.

Persistent mode dùng `reference_state_snapshots` JSON checkpoint với advisory transaction lock. Đây là bước trung gian cho sandbox; chưa phải repository relational production.

## Còn thiếu

- Chưa có log của một CI run remote; local PostgreSQL integration đã đạt với Docker PostgreSQL 16.
- Chưa có migration rollback/backup-restore rehearsal.
- Chưa wire từng nghiệp vụ vào `customers`, `transfers`, `ledger_entries`, `outbox_events` production tables.

## Cap nhat xac nhan cuoi M7 - 2026-08-15

- Credit test bao phu seed balance/minimum, quote one-time, payment ledger/reconciliation, pending resume, lock/unlock va HTTP idempotency flow.
- `npm test`: local khong co `DATABASE_URL` 58 test, 54 pass, 4 skip; voi PostgreSQL 16 tam thoi 58/58 pass, bao gom restart/concurrency Credit va overdue notification idempotency.
- `npm run test:critical` 8/8; typecheck, build, OpenAPI validator va Backend dependency audit (0 vulnerability) dat.
- `003_credit_sandbox.sql` da migrate tu database rong; live validator kiem tra 27 table definitions va constraints chinh.
- `seed:e2e` da chay thanh cong voi MFA sandbox: transfer va savings `SUCCEEDED`, Credit card/statement seed thanh cong; khong in password/OTP.
- Persistent mode van la snapshot adapter cho sandbox, chua phai repository relational production.

## Xác nhận hiện hành — 2026-08-17

- Clone sạch đã chạy `npm ci`; backend typecheck/build/OpenAPI đạt, migration từ database PostgreSQL rỗng đạt và test backend 68/68 đạt.
- Persistent HTTP đọc/validate request body trước advisory lock và trả `503 PERSISTENCE_UNAVAILABLE` khi PostgreSQL không truy cập được.
- Commit hiện hành: `cbe1e71` (health fail-closed), trước đó `c6fcd2a` (request transaction boundary).
- Snapshot JSON vẫn là persistence reference; repository relational canonical là bước nâng cấp còn mở, không được tuyên bố là đã hoàn thành.

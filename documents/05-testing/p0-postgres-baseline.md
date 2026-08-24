# P0 PostgreSQL baseline và tiến độ relational-v2

Ngày đo: 2026-08-24 (Asia/Bangkok)
Nhánh: `codex/p0-postgres-foundation`
Mã nguồn đã đồng bộ: `f135d4e`
Môi trường: Docker Compose, PostgreSQL 16, backend `127.0.0.1:5000`.

## Bằng chứng baseline

- Image backend đã rebuild từ `f135d4e`; health trả `commitSha=f135d4e`, `status=ok`, reconciliation `ok`.
- Backup custom-format: `C:\Temp\banking-p0-baseline\p0-baseline-20260824.dump` (111,342 bytes).
- `pg_restore --list` đọc được archive, 193 mục TOC; backup chưa được xóa.
- Trước migration v2, database có 13 customer/account, 6 quote, 6 transfer, 18 account transaction, 12 journal, 30 ledger entry, 117 audit event, 12 outbox event và 36 record trong `reference_runtime_records`.
- Sau migration/backfill additive, các bản ghi core vẫn còn; các bảng normalized mới được tạo. Runtime refresh/session và optional savings/credit hiện không có bản ghi cần backfill trong database preview.

Migration runner đã chạy thành công từ database rỗng và chạy lại idempotent. Checksum SHA-256 được ghi trong `reference_schema_migrations`; sửa file migration đã áp dụng sẽ bị từ chối.

## Baseline latency/integrity

Lệnh:

```powershell
$env:PERF_OPERATOR_KEY = "<local operator key>"
$env:PERF_OTP = "<local transfer OTP>"
$env:PERF_MFA_OTP = "<local MFA OTP>"
$env:PERF_READ_ITERATIONS = "10"
$env:PERF_TRANSFER_CONCURRENCY = "20"
node performance/node/stage2-smoke.cjs
```

Kết quả workload legacy persistent (không phải relational-v2 cutover):

| Nhóm | p50 | p95 | lỗi |
|---|---:|---:|---:|
| `/healthz` | 6.97 ms | 16.50 ms | 0 |
| account/history/notification read | 154.81 ms | 197.31 ms | 0 |
| tạo transfer quote | 136.14 ms | 168.07 ms | 0 |
| submit transfer, 20 request đồng thời | 1,342.11 ms | 2,433.41 ms | 0 |

Integrity vẫn đạt: một transfer canonical, reconciliation `ok`, không double-debit. Submit p95 vượt mục tiêu 700 ms là tín hiệu baseline dự kiến của `PostgresRelationalRepository`: request còn đọc/ghi state lớn và serialize qua advisory lock.

## Phần đã thực hiện trong P0

- `DatabasePool`, `UnitOfWork`, timeout/lock budget, pool/transaction metrics và retry có giới hạn cho PostgreSQL `40001`/`40P01`.
- Repository nền tảng cho customer/auth, account, transfer/idempotency, ledger, savings, credit, audit và outbox; mọi repository nhận chung `PoolClient`.
- Migration `006`–`011` additive: command idempotency/checksum, sequence account number, quote/outbox constraints, normalized identity runtime, transfer destination FK/index, savings maturity idempotency, credit payment idempotency/index và registration response recovery.
- Use case direct-table `RelationalTransferService` có lock theo thứ tự UUID, conditional quote consume, atomic balance/ledger/audit/outbox và fault-injection hooks.
- Foundation tests chứng minh rollback, retry, concurrent same-quote canonical transfer, idempotency conflict và rollback sau ledger.

Gate đã chạy trên PostgreSQL 16 disposable: `npm run validate:database` (38 bảng), `npm run validate:relational-v2`, `npm run typecheck`, `npm run build`, `npm run validate:openapi`, `npm test` (96/96), `npm run test:critical` (10/10), `npm run test:relational` (1/1), `npm run test:database` (4/4) và `npm audit --omit=dev --audit-level=high` (0 vulnerability ở backend).

## Giới hạn còn lại trước khi đóng P0

HTTP preview vẫn chạy adapter legacy để bảo toàn API hiện tại; `system.exportState()`/`importState()` và `withState` chưa được loại bỏ khỏi request mutation. Vì vậy P0 chưa được tuyên bố hoàn tất. Bước tiếp theo phải là contract cutover theo từng use case (auth/account → transfer/ledger → savings → credit), chạy disposable database, rồi mới bật `BANKING_PERSISTENCE_MODE=relational-v2`. Trong giai đoạn chuyển tiếp, adapter legacy có compatibility cleanup cho các bảng v2; không dùng hai nguồn ghi tài chính đồng thời.

Metrics query-count/advisory-lock-wait chi tiết chưa được thu thập vì adapter hiện tại chưa có instrumentation truy vấn; latency và integrity ở trên là số đo reproducible để làm mốc so sánh.

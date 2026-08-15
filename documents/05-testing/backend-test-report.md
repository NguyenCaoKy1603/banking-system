# Backend hardening test report

Ngày kiểm tra: 2026-08-15
Phạm vi: correctness P1/P2, reference hardening và persistent sandbox adapter
Trạng thái: **In-memory và PostgreSQL persistent sandbox pass; relational production adapter vẫn là DRAFT**
Commit kiểm thử: `72f1bbd60dcb786a90fb6e8c7dae4602b57e55a8`

## Đã kiểm chứng local

| Gate | Kết quả |
| --- | --- |
| Typecheck/build | Đạt |
| Database boundary validator | Đạt, 16 bảng/invariant |
| Unit + HTTP tests | 37 test definition; 37 đạt, gồm 2 PostgreSQL persistence tests |
| Critical HTTP tests | 8 đạt |
| Backend dependency audit | 0 vulnerability |
| Quote correctness | Snapshot beneficiary, one-time quote, idempotent retry |
| Beneficiary identity | Full account fingerprint + bank, không dùng masked suffix |
| Reconciliation | `differenceMinor = core - ledger` và test drift -1 |
| Runtime IDs | UUID-compatible với PostgreSQL |
| Router | Trailing segment bị 404 |
| Rate limit | Registration và transfer step-up có regression test |
| Outbox | Retry backoff/attempts và health threshold có regression test |

## PostgreSQL gate

Test `persistence.test.ts` dùng `DATABASE_URL`, chạy migration từ database rỗng, kiểm tra restart state, HTTP restart và concurrent submit bằng hai idempotency key khác nhau. Gate local đã chạy với PostgreSQL 16 trong Docker: migration từ database rỗng đạt, cả 37/37 test đạt và chỉ một request concurrent được debit. Workflow [`backend-quality.yml`](../../.github/workflows/backend-quality.yml) tái hiện cùng gate trên CI service.

Persistent mode dùng `reference_state_snapshots` JSON checkpoint với advisory transaction lock. Đây là bước trung gian cho sandbox; chưa phải repository relational production.

## Còn thiếu

- Chưa có log của một CI run remote; local PostgreSQL integration đã đạt với Docker PostgreSQL 16.
- Chưa có migration rollback/backup-restore rehearsal.
- Chưa wire từng nghiệp vụ vào `customers`, `transfers`, `ledger_entries`, `outbox_events` production tables.

# P0 Worker/Outbox — Baseline và bằng chứng

## Database preview đã kiểm tra

- Database: `banking_preview` trên PostgreSQL local (container preview).
- Backup trước migration additive: `C:\Temp\banking-p0-baseline\preview-outbox-baseline-20260824.dump`.
- Đã áp dụng và kiểm tra idempotent migrations `012_outbox_worker` và
  `013_outbox_worker_operations`.
- Inventory sau migration: **16 event PENDING**, tất cả có
  `aggregate_type=legacy` và payload `{}`. Có 8 `TRANSFER_SUCCEEDED` và 8
  `SANDBOX_FUNDING_SUCCEEDED` theo inventory; chưa đánh dấu published giả và
  chưa tự động gửi lại.
- Phân loại hiện tại: `REVIEW_REQUIRED`. Chưa đủ bằng chứng để kết luận
  recipient/freshness cho từng event nên nhân viên OPERATIONS phải đối soát từng ID và tạo Admin action.
- Worker claim query loại `aggregate_type=legacy`/payload `{}`; 16 event này
  vẫn PENDING cho tới khi có Admin request với lý do và checker ADMIN.

## Cập nhật đối soát preview — 2026-08-25

- Đã dùng backup nêu trên làm điểm khôi phục và inventory lại bằng PostgreSQL
  `NOW()`: 16/16 event đều còn freshness (8 funding dưới 24 giờ, 8 transfer
  dưới 7 ngày) và ánh xạ được aggregate/recipient/transaction duy nhất.
- `MAPPABLE_AND_FRESH` đã tạo 16 event canonical (8
  `transfer.succeeded.v1`, 8 `sandbox.funding_succeeded.v1`) trong transaction
  đối soát, đồng thời tạo 16 notification TRANSFER và 8 notification SECURITY.
  16 event legacy cũ chuyển `SKIPPED` với `LEGACY_MATERIALIZED`; 16 audit
  `OUTBOX_LEGACY_RECONCILED` được ghi, không có DEAD-letter.
- Hai worker chạy song song đã claim 16/16, dispatch 16/16; kết quả database là
  canonical `DISPATCHED=16`, `PENDING=0`, `PROCESSING=0`, `DEAD=0`. Không có
  `notification_deliveries` vì preview không cấu hình endpoint Push/Email; in-app
  notification đã có trong transaction/reconcile.
- Sau khi dừng hai replica worker graceful ở lần xác minh cuối, cả hai heartbeat
  mới chuyển `STOPPED` (bảng hiện có `STOPPED=10` gồm cả các lần rehearsal trước);
  backend khởi động lại trả `/livez`, `/healthz`, `/readyz` HTTP 200 và inventory
  không còn legacy PENDING. Customer=18, account=18, transfer=8, account
  transaction=24 vẫn giữ nguyên; không có thao tác debit/ledger nào do worker
  thực hiện.

## Bằng chứng code/test

Worker integration trên database disposable `banking_worker_test` kiểm tra:

1. Hai worker không claim trùng và chỉ tạo một delivery/SENT.
2. Lease hết hạn được reclaim; worker cũ không thể cập nhật event.
3. Event version không hỗ trợ vào OUTBOX dead-letter và không đụng bảng tài chính.
4. Provider lỗi đạt max attempts thì delivery vào DELIVERY dead-letter.
5. Legacy full-state writer bị chặn khi worker heartbeat còn sống.
6. Legacy payload rỗng không bị worker claim; reconcile/requeue phải do Admin
   action có checker và audit.
7. Graceful shutdown dừng claim, ghi `STOPPED` và đóng pool.
8. Endpoint ciphertext hỏng bị revoke và dead-letter mà không gọi provider.

Có thêm bài load test `npm run test:worker:load`: 1.000 event, 2 worker,
batch 50/concurrency 10, backlog về 0, 1.000 delivery `SENT`, không có nhóm
delivery trùng và không phát sinh thay đổi bảng tài chính.

Các test unit kiểm tra registry/version, payload redaction, full jitter,
Retry-After và error classification.

## Ghi chú phạm vi

Fake/disabled provider chỉ chứng minh contract và retry; chưa chứng minh gửi
Push/Email thật. HTTP API vẫn là legacy writer nên worker profile bị khóa mặc
định cho đến khi cutover relational-v2 hoàn tất.

## Docker evidence

Đã build image và chạy local `docker compose --profile worker up --scale
worker=2`. Cả hai replica trả `/readyz` HTTP 200, pool waiting = 0, backlog
legacy vẫn là 16 và sau khi dừng container các heartbeat chuyển `STOPPED=2`.

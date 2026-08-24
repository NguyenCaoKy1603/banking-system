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
  recipient/freshness cho từng event nên operator phải đối soát từng ID.
- Worker claim query loại `aggregate_type=legacy`/payload `{}`; 16 event này
  vẫn PENDING cho tới khi chạy lệnh reconcile có operator + lý do.

## Bằng chứng code/test

Worker integration trên database disposable `banking_worker_test` kiểm tra:

1. Hai worker không claim trùng và chỉ tạo một delivery/SENT.
2. Lease hết hạn được reclaim; worker cũ không thể cập nhật event.
3. Event version không hỗ trợ vào OUTBOX dead-letter và không đụng bảng tài chính.
4. Provider lỗi đạt max attempts thì delivery vào DELIVERY dead-letter.
5. Legacy full-state writer bị chặn khi worker heartbeat còn sống.
6. Legacy payload rỗng không bị worker claim; reconcile/requeue phải do operator
   gọi và có audit.
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

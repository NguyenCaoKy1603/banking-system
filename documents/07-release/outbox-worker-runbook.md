# Runbook — Transactional Outbox Worker (local/reference)

## Quy tắc an toàn

Đây là sandbox tiền mô phỏng. Không dùng credential provider thật trong local
hoặc CI. Không bật worker trên database có HTTP legacy full-state writer; guard
sẽ từ chối worker và adapter legacy cũng chặn ghi khi heartbeat đang hoạt động.

## Kiểm tra schema và inventory

```powershell
$env:DATABASE_URL="postgresql://banking:<password>@127.0.0.1:5433/banking_preview"
cd C:\Projects\banking-system\backend
npm run db:migrate
npm run validate:database
npm run validate:outbox
npm run outbox:inventory
npm run outbox:inspect -- 100
```

`outbox:inventory` chỉ in ID/type/aggregate/time/status và đánh dấu legacy cần
review; worker cũng không claim payload `{}`/`aggregate_type=legacy`. Không tự
SKIPPED/DEAD.

## Chạy Compose opt-in

1. Hoàn tất HTTP relational-v2 cutover và regression boundary.
2. Sao lưu database, đặt `WORKER_ENABLED=1`, thay endpoint encryption key bằng
   secret local phù hợp và chọn provider `fake` hoặc `disabled`.
3. Chạy thử hai replica:

```powershell
docker compose --env-file .env.compose --profile worker up -d --build --scale worker=2
docker compose --env-file .env.compose --profile worker ps
docker compose --env-file .env.compose --profile worker logs worker
```

Worker không expose port host; health chỉ bind loopback trong container. Kiểm tra
`/readyz` và `/metrics` qua `docker compose exec worker`.

## Dead-letter/requeue

Không xóa dead-letter. Chỉ requeue sau khi đã sửa nguyên nhân và ghi lý do:

```powershell
$env:OUTBOX_OPERATOR="operator-local"
npm run outbox:requeue -- <event-uuid> "đã sửa template/provider và kiểm tra lại"
```

Lệnh ghi `requeued_by`, `requeue_reason` và `OUTBOX_REQUEUED` audit event; unique
delivery key ngăn tạo delivery trùng.

Với event legacy, operator phải inventory/đối soát trước. Năm phân loại được
ghi nhận bằng lệnh riêng. `MAPPABLE_AND_FRESH` sẽ kiểm tra aggregate, recipient,
transaction và freshness trong cùng transaction, sau đó materialize một event
envelope canonical mới; payload legacy không bị sửa tại chỗ:

```powershell
$env:OUTBOX_OPERATOR="operator-local"
npm run outbox:reconcile -- <event-uuid> MAPPABLE_AND_FRESH "đã đối soát aggregate và còn trong freshness window"
npm run outbox:reconcile -- <event-uuid> MAPPABLE_BUT_STALE "đã quá hạn theo occurred_at"
npm run outbox:reconcile -- <event-uuid> AGGREGATE_MISSING "aggregate không còn tồn tại"
```

`AGGREGATE_MISSING`/`AMBIGUOUS_RECIPIENT` vào DEAD-letter; `ALREADY_DELIVERED`
và `MAPPABLE_BUT_STALE` vào SKIPPED, đều ghi audit và không xóa event.
`MAPPABLE_AND_FRESH` chuyển event legacy sang `SKIPPED` với mã
`LEGACY_MATERIALIZED`, ghi audit operator và tạo event canonical PENDING để
worker xử lý; nếu canonical event đã tồn tại theo deduplication key, lệnh dùng
lại event đó thay vì tạo delivery trùng.

## Dừng/restart

Gửi SIGTERM hoặc `docker compose ... stop worker`. Worker dừng claim mới,
heartbeat chuyển DRAINING, chờ task trong shutdown timeout rồi đóng pool. Nếu
chết giữa provider call, lease hết hạn sẽ được worker khác reclaim; provider
consumer phải chấp nhận at-least-once.

## Cảnh báo cần cấu hình ở môi trường triển khai

Heartbeat mất, oldest pending vượt ngưỡng, backlog tăng liên tục, dead-letter
security/financial, provider error rate cao, lease expired tăng bất thường và
database pool waiting đều cần alert. Chưa có provider thật hoặc cloud alert
được cấu hình trong repository này.

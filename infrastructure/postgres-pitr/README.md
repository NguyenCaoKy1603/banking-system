# PostgreSQL PITR contract

Local Compose hiện chạy PostgreSQL 16 nhưng chưa bật WAL archive; `npm run backup:pitr:check` sẽ trả `NOT_CONFIGURED_LOCAL_PREVIEW`. Không dùng volume preview để giả lập mất dữ liệu.

Production-like cần managed PostgreSQL hoặc cluster riêng có base backup, continuous WAL, timeline history, PITR restore target, retention và archive-lag alert. `pitr-drill.cjs` chỉ kiểm tra prerequisite, không rewind/xóa source.

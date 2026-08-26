# Incident checklist — release và runtime

Ngày cập nhật: 2026-08-25

## Phát hiện

- Ghi environment, release ID, image digest, commit SHA, trace ID và thời điểm.
- Kiểm tra `/livez`, `/startupz`, `/readyz`, `/healthz`, `/versionz` và worker `/readyz`.
- Kiểm tra 5xx, latency, database pool, reconciliation, outbox oldest pending, dead-letter và worker heartbeat.
- Không copy OTP, token, password, database URL hoặc full account number vào incident record.

## Khoanh vùng

- Nếu process/config/schema lỗi: dừng rollout, không restart hàng loạt.
- Nếu application regression và schema tương thích: dùng rollback manifest.
- Nếu migration/schema lỗi: giữ database, khóa promotion và chuyển sang forward fix/PITR approval.
- Nếu worker lỗi: giữ API nếu readiness cho phép, drain/restart worker theo lease và kiểm tra duplicate delivery.

## Kết thúc

- Đối chiếu digest/manifest/version sau mitigation.
- Chạy smoke và reconciliation; xác nhận không còn version skew.
- Ghi root cause, timeline, rollback/forward-fix, evidence và action item có owner.

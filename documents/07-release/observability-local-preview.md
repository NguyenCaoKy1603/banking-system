# Observability — UNTRUSTED LOCAL PREVIEW

## Phạm vi và trạng thái

Đây là bằng chứng observability cho môi trường local preview của reference sandbox. Trạng thái bắt buộc hiện tại là:

- `environment=preview`
- `moneyMode=virtual`
- `IMAGE_DIGEST=unknown`
- `UNTRUSTED LOCAL PREVIEW` — không phải release, không được dùng làm bằng chứng staging/production.

Không tạo dashboard, alert route, OTel Collector, Prometheus/Grafana/Tempo/Loki cloud hoặc chữ ký image giả. Các thành phần đó chỉ được đánh dấu **chưa có evidence** cho đến khi có hạ tầng thật.

## Đã triển khai trong mã nguồn

- HTTP và Admin API nhận `X-Request-ID` tối đa 64 ký tự, chỉ cho phép `[A-Za-z0-9._-]`; giá trị sai được thay bằng ID mới.
- W3C `traceparent`/`tracestate` được nhận và phát lại dưới dạng child span; response có `X-Request-ID`, `X-Trace-ID` và `traceparent`.
- `/metrics` xuất HTTP counter, active gauge, duration histogram với các label cố định `method`, `route`, `status_class`, `outcome`; không dùng request ID, customer ID, email, IP hoặc token làm label.
- Business metrics gồm health check, reconciliation mismatch, pending outbox, transfer operation và PostgreSQL pool gauges khi API có pool callback.
- Worker có `/livez`, `/startupz`, `/readyz`, `/healthz`, `/versionz`, `/metrics`; readiness trả `503` nếu chưa initialized, chưa `READY`, DB lỗi hoặc heartbeat cũ.
- Structured JSON log `http_request_completed` redacts password/token/OTP/PIN/CVV/ciphertext và các khóa nhạy cảm. Bật local bằng `BANKING_STRUCTURED_LOGS=1`.
- Readiness của API gọi persistence health check; liveness không gọi DB.

## Kiểm tra thủ công local

```text
GET http://127.0.0.1:5000/livez       # process-only, không truy vấn DB
GET http://127.0.0.1:5000/startupz    # startup gate
GET http://127.0.0.1:5000/readyz      # DB/schema + business health
GET http://127.0.0.1:5000/healthz     # readiness + reconciliation/outbox state
GET http://127.0.0.1:5000/versionz    # commit/schema/migration/image metadata
GET http://127.0.0.1:5000/metrics     # local Prometheus text format
GET http://127.0.0.1:5002/readyz      # worker readiness (cổng worker health theo compose)
```

Khi kiểm tra trace, gửi một `traceparent` hợp lệ và một `X-Request-ID` hợp lệ; response phải giữ trace ID, tạo span ID mới và không phản chiếu request ID không hợp lệ. Khi kiểm tra logs, chỉ tìm `requestId`, `traceId`, `spanId`, route chuẩn hóa và outcome; không gửi body/secret vào log.

## SLO và giới hạn evidence

Local preview chỉ cung cấp số đo để phát hiện lỗi, chưa có cửa sổ SLO/error-budget được phê duyệt. Baseline transfer p95 khoảng `824.55ms` vẫn là defect cần xử lý, không được hạ ngưỡng để làm xanh dashboard.

Chưa đủ evidence cho:

1. Prometheus/Grafana/Tempo/Loki chạy ngoài máy và retention/HA.
2. OIDC/workload identity, mTLS, secret manager và alert notification thật.
3. Staging load test, on-call acknowledgement, incident drill và trace export xuyên service qua collector.
4. Image registry digest, signature, SBOM/provenance và deploy admission.

Vì vậy không thay đổi `IMAGE_DIGEST=unknown`, không gọi đây là production release và không push thay đổi lên GitHub nếu chưa có yêu cầu riêng.


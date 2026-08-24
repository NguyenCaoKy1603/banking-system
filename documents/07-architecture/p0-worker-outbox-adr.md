# ADR — Worker và Transactional Outbox P0

**Trạng thái:** Đã triển khai nền tảng, worker production-like đang opt-in
**Ngày:** 2026-08-24

## Quyết định

PostgreSQL là nguồn sự thật duy nhất. Backend ghi nghiệp vụ, notification trong
app và business outbox trong cùng transaction. Worker độc lập poll PostgreSQL
bằng `FOR UPDATE SKIP LOCKED`, claim ngắn với `locked_by`/`lease_expires_at`,
sau đó gọi provider ngoài transaction. Cam kết là at-least-once và consumer
idempotent; không tuyên bố exactly-once.

Một event có thể tạo nhiều `notification_deliveries`. Mỗi delivery có lease,
attempts, retry và dead-letter riêng để Push thành công không bị gửi lại vì
Email thất bại. In-app notification không phụ thuộc provider.

## Ranh giới an toàn

`PostgresRelationalRepository` hiện vẫn là adapter legacy đọc toàn state rồi
xóa/ghi lại projection. Worker từ chối khởi động nếu
`BANKING_PERSISTENCE_MODE` không phải `relational-v2`; adapter legacy cũng từ
chối ghi khi heartbeat worker còn sống. Vì vậy Compose không tự bật worker:
phải hoàn thành HTTP relational-v2 cutover và regression trước khi dùng profile
`worker`.

## Dữ liệu và event contract

- Migration `012_outbox_worker.sql` mở rộng `outbox_events` và tạo endpoint,
  preference, delivery, dead-letter, worker heartbeat.
- Migration `013_outbox_worker_operations.sql` thêm `updated_at` cho các state
  transition an toàn.
- Envelope có `eventId`, `eventType`, `eventVersion`, aggregate version,
  occurred time, trace và subject/notification IDs.
- Registry hiện bao phủ transfer, savings, credit, security/fraud,
  `customer.registered` và sandbox funding. Alias uppercase cũ chỉ được chuẩn
  hóa khi version hỗ trợ.
- Preference chưa có bản ghi được xem là `enabled=true`; chính sách bắt buộc
  riêng cho security/overdue và lựa chọn PENDING có gửi Push vẫn là quyết định
  nghiệp vụ cần chốt trước pilot.
- Payload/log bị chặn các khóa password, OTP, token, PIN/CVV, push token, số
  tài khoản đầy đủ, device secret, fraud reason và database credential.

## Retry, dead-letter và provider

Retry dùng exponential backoff với full jitter (mặc định 5 giây, cap 15 phút,
8 attempts), tôn trọng Retry-After khi provider trả về giá trị hợp lệ. Timeout,
network, 408/425/429/5xx là retryable; payload/version/notification không hợp
lệ, endpoint invalid và provider disabled là terminal; 401/403 được phân loại
configuration.

Local/CI dùng `FakePushProvider`/`FakeEmailProvider` hoặc provider disabled.
Chưa có credential thật và chưa có bằng chứng gửi Push/Email thật.

## Quan sát và vận hành

Worker ghi heartbeat, có `/livez`, `/readyz`, `/metrics`; metrics không dùng
customerId/eventId làm label. `outbox:inspect` không in payload; inventory chỉ
in metadata. `outbox:requeue` bắt buộc operator + lý do và ghi dead-letter/audit.

## Ngoài phạm vi

Chưa thêm Kafka/RabbitMQ, chưa sửa Mobile/push registration, chưa bật cloud
deploy, chưa tự động phân loại 16 legacy event đang PENDING. Worker loại các
event `aggregate_type=legacy` hoặc payload `{}` khỏi claim; các event này phải
được backup và operator đối soát trước khi SKIPPED/DEAD.

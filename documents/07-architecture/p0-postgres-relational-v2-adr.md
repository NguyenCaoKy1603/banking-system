# ADR P0 — PostgreSQL relational-v2 foundation

## Quyết định

Tách transaction boundary ra khỏi `PostgresRelationalRepository` toàn state bằng một `DatabasePool` dùng chung, `UnitOfWork` giữ một `PoolClient`, và các repository thao tác trên bảng cần thiết. API Mobile/OpenAPI giữ nguyên; application service chịu trách nhiệm điều phối nghiệp vụ và mapping lỗi.

## Bất biến nghiệp vụ

- Tiền chỉ dùng PostgreSQL `bigint` và chuỗi minor-unit ở TypeScript.
- Mọi command tài chính chạy trong một transaction; balance, transfer, quote, account transaction, ledger, audit và outbox commit/rollback cùng nhau.
- Khóa nhiều account theo thứ tự UUID cố định.
- Quote được consume bằng conditional update; idempotency có unique `(customer_id, operation_type, idempotency_key)` và fingerprint.
- Retry chỉ áp dụng cho transaction bị `40001`/`40P01`; không retry mù side effect ngoài database.
- Dịch vụ ngoài không được gọi khi transaction còn mở.

## Migration strategy

`006`–`011` chỉ additive/tightening và có checksum. `reference_runtime_records` chưa bị xóa trong P0 để giữ khả năng đối chiếu/rollback. Migration runner dùng advisory lock chỉ ở bước migration, không dùng cho request nghiệp vụ.

## Trạng thái cutover

Foundation và direct transfer use case đã có test trên database disposable. HTTP mutation hiện vẫn đi qua adapter legacy để tránh thay đổi API khi chưa hoàn tất auth/session, savings và credit use case. Không bật relational-v2 production/preview cho đến khi contract test cũ–mới, concurrency matrix, restart và reconciliation đều đạt.

## Không chọn

- Không dual-write tài chính vào bảng relational và JSON runtime.
- Không dùng sequence ứng dụng `accounts.size + 1`.
- Không xóa toàn bảng trong request mới.
- Không tăng pool không giới hạn; tổng `DB_POOL_MAX × số instance` phải nằm dưới `max_connections` PostgreSQL trừ phần dự phòng.

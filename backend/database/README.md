# Database boundary (DRAFT)

`001_banking_mvp.sql` và `005_relational_reference_runtime.sql` là schema PostgreSQL DRAFT cho reference adapter của đồ án. `PostgresRelationalRepository` đã nối các bản ghi nghiệp vụ M0–M4/M8 vào các bảng relational; `reference_state_snapshots` chỉ giữ vai trò tương thích để nâng dữ liệu sandbox cũ một lần. `reference_runtime_records` lưu state tạm thời/bonus theo từng record, không phải một snapshot tổng. Schema vẫn phải được partner/core banking, legal/compliance, data retention và security review phê duyệt trước khi áp dụng vào hệ thống tiền thật.

Các invariant chính:

- Số tiền VND là `bigint` minor unit; không dùng floating point.
- `transfers` có unique `(customer_id, idempotency_key)` và request fingerprint.
- `transfers.quote_id` unique để một quote không thể tạo hai debit; quote có `consumed_at` để lưu trạng thái dùng một lần.
- Beneficiary giữ `account_number_fingerprint` và unique index theo customer/account fingerprint/bank, không dựa trên số đã che.
- Các khóa chính runtime dùng UUID để tương thích trực tiếp với PostgreSQL.
- `ledger_entries` dùng double-entry; deferred constraint trigger buộc mỗi journal cân bằng khi commit.
- Token chỉ lưu hash; session gắn với device và refresh family.
- Audit, ledger và outbox được thiết kế append-only ở tầng quyền database.
- Outbox có index cho worker claim/publish và retry.

Trước khi dùng schema này cần bổ sung adapter giao dịch/locking phù hợp core banking, migration runner, backup/restore rehearsal, secret manager, RLS/role policy, retention và observability thật.

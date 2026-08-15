# Database boundary (DRAFT)

`001_banking_mvp.sql` là schema PostgreSQL dự kiến cho production adapter. Schema này chưa được nối vào các bảng production của `BankingSystem`; bảng `reference_state_snapshots` chỉ là checkpoint JSON cho persistent sandbox và không được dùng cho tiền thật. Schema phải được partner/core banking, legal/compliance, data retention và security review phê duyệt trước khi áp dụng.

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

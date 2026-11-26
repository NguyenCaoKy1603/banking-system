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
- Migration `033_control_policy_bootstrap.sql` tạo đúng một control policy
  idempotent cho relational-v2. Nếu bản ghi singleton bị thiếu, readiness phải
  fail-closed thay vì nhận request với trạng thái kiểm soát không xác định.
- Các migration `034–051` là lớp hardening & mở rộng tính năng forward-only của relational-v2:
  - `034` thêm entitlement theo khách hàng và `blocked_until` bền vững cho login rate-limit;
  - `035` thêm con trỏ chu kỳ sao kê tín dụng, chỉ phục hồi placeholder zero-value hẹp và không sửa lịch sử có nghiệp vụ;
  - `036` tách tombstone `DELETED` khỏi `BLOCKED` cho beneficiary, đồng thời cho phép tạo lại target sau khi xóa;
  - `037` lưu snapshot tên counterparty phía server để lịch sử không đổi khi hồ sơ đổi tên;
  - `038` lưu KYC synthetic-only theo vòng đời DRAFT/SUBMITTED/UNDER_REVIEW/APPROVED/REJECTED/NEEDS_MORE_INFO;
  - `039` thêm suspense bền vững cho nghĩa vụ maturity chưa thể ghi có và index keyset cho lịch sử dài;
  - `040` thêm case báo mất thẻ, purpose `CARD_REPORT_LOST` và metadata retry/backoff/dead-letter cho suspense;
  - `041` hợp nhất role Admin từ bốn role cũ còn `OPERATIONS` và `ADMIN`, ánh xạ role assignment/invite/request hiện có, thu hồi phiên cũ và giữ nguyên fingerprint/audit của yêu cầu đã tạo;
  - `042` thêm khóa idempotency cho Admin tạo trực tiếp tài khoản OPERATIONS; bảng chỉ chứa fingerprint metadata, không lưu mật khẩu, khóa MFA hoặc OTP;
  - `043` gán permission tạo Operations trực tiếp cho ADMIN, tắt policy STAFF_INVITE cũ và bỏ permission mời khỏi role; giữ nguyên request, action, invite và audit history;
  - `044` bổ sung purpose `SAVINGS_WITHDRAWAL` cho `auth_challenges` và các trường ghi nhận rút tiền sớm (`early_withdrawn_at`, `early_interest_minor`) cho `savings_deposits`;
  - `045` tạo bảng `transaction_anomalies` cùng chỉ mục cho quy trình phát hiện giao dịch bất thường (`MEDIUM`/`HIGH`/`CRITICAL`), khách hàng xác nhận (`CONFIRMED_SAFE`/`REPORTED_SUSPICIOUS`) và Admin xử lý (`RESOLVED`);
  - `046` bổ sung `device_id`, kiểu `BIOMETRIC` (chỉ mục duy nhất active theo `customer_id, device_id`) trên `mfa_credentials` và mở rộng ràng buộc `method = 'BIOMETRIC'` trên `auth_challenges`;
  - `047` chuẩn hóa các UUID tài khoản thanh toán trần trong `ledger_entries.account_ref` về định dạng chuẩn `payment-account:<uuid>` phục vụ đối soát Trial Balance;
  - `048` bổ sung `daily_transfer_limit_minor` (mặc định `50000000` VND) vào `control_policy`;
  - `049` cho phép `recipient_lookups` không ràng buộc tài khoản nội bộ và bổ sung `rail` (`INTERNAL` | `NAPAS_IBFT`), `bank_bin`, `external_account_number`, `napas_trace_id`, `failure_reason` cho tra cứu/báo giá/chuyển khoản liên ngân hàng mô phỏng với hạch toán 2 pha `held_minor`;
  - `050` bổ sung purpose `PASSWORD_RESET`, `PASSWORD_CHANGE` trên `auth_challenges` và metadata `device_name`, `last_seen_at` trên `customer_devices`;
  - `051` bổ sung `transfer_fee_minor` (mặc định `1000` VND) vào `control_policy` và cấp quyền `SELECT/UPDATE` trên `control_policy`, `SELECT` trên `ledger_journals`/`ledger_entries` cho role `banking_admin_api`.
- `savings_maturity_suspense` không thay thế ledger: đây là hàng đợi vận hành có
  operation key duy nhất, để nghĩa vụ maturity không còn ở trạng thái ACTIVE khi
  tài khoản nguồn/sản phẩm không thể xử lý; worker retry/resume idempotent, backoff
  có giới hạn và chuyển `DEAD` kèm operations evidence khi hết số lần thử.
- Các migration mới chỉ lưu metadata synthetic và khóa ngoại cần thiết; không lưu
  OTP, secret, PAN, CVV, PIN, bytes tài liệu KYC hoặc PII sản xuất.

Migration runner đọc toàn bộ file `001–051` theo thứ tự số, ghi fingerprint và
không được bỏ qua migration. Trước khi dùng schema này với hệ thống tiền thật cần
bổ sung adapter giao dịch/locking phù hợp core banking, backup/restore rehearsal,
secret manager, RLS/role policy, retention và observability thật.

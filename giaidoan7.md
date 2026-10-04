# Giai đoạn 7 — Database và mô hình dữ liệu

Tài liệu này tiếp nối [giaidoan5.md](C:/Projects/banking-system/giaidoan5.md) và [giaidoan6.md](C:/Projects/banking-system/giaidoan6.md). Mục tiêu là nhìn project từ phía dữ liệu: dữ liệu nằm ở bảng nào, vì sao các bảng liên kết, câu SQL nào đọc/ghi chúng, và transaction bảo vệ chúng ra sao.

Tài liệu được đối chiếu với migration 001–040 và source hiện tại tại HEAD 9c585ce. Chỉ tạo tài liệu; không chạy migration, không kết nối database, không thay đổi schema hoặc code. Dữ liệu số trong ví dụ đều là dữ liệu giả. Đây là reference sandbox dùng cho học tập/kiểm thử local. [README database](C:/Projects/banking-system/backend/database/README.md) nói rõ schema còn cần partner/core banking, legal/compliance, retention và security review trước khi dùng cho tiền thật.

## Cách đọc

Database giống một tủ hồ sơ có quy tắc:

- Database là cả tủ.
- Table/bảng là một loại hồ sơ.
- Row/hàng là một hồ sơ cụ thể.
- Column/cột là một thuộc tính của hồ sơ.
- Primary key là mã phân biệt một hàng.
- Foreign key là mối nối tới hàng của bảng khác.
- Constraint là luật mà database tự kiểm tra.
- Index là mục lục để tìm nhanh; nó không phải một bản sao nghiệp vụ để ứng dụng tự sửa.

Mỗi bảng quan trọng sẽ được giải thích theo tám câu hỏi:

1. Một hàng đại diện cho điều gì?
2. Migration nào tạo hoặc thay đổi bảng?
3. Cột quan trọng và kiểu dữ liệu là gì?
4. Primary key, foreign key, constraint và index bảo vệ điều gì?
5. Bảng liên quan tới bảng nào?
6. File/class/method nào đọc hoặc ghi?
7. Một ví dụ dữ liệu giả là gì?
8. Lỗi nào có thể xảy ra và cơ chế nào ngăn lỗi?

## Mục lục

1. Kiến thức nền về database
2. Đọc migration và dựng bản đồ schema
3. Bản đồ các nhóm bảng
4. Customer, payment account và account transaction
5. Đọc SQL trong repository
6. Dữ liệu của chức năng chuyển tiền
7. Transaction, khóa hàng và cạnh tranh
8. Các nhóm nghiệp vụ còn lại
9. Migration, constraint, index và quyền database
10. Bài tập tổng hợp và đáp án gợi ý

# 1. Kiến thức nền

## 1.1 Object TypeScript khác row PostgreSQL

Trong code TypeScript, AccountRow là object mà JavaScript đang dùng sau khi đọc dữ liệu:

~~~typescript
{
  id: "uuid...",
  customerId: "uuid...",
  availableMinor: "500000",
  currentMinor: "520000",
  version: "3"
}
~~~

Trong PostgreSQL, cùng dữ liệu đó nằm trên một row với tên cột snake_case:

~~~text
id | customer_id | available_minor | current_minor | version
---+-------------+-----------------+---------------+--------
A  | C           | 500000          | 520000        | 3
~~~

[AccountRepository.mapAccount](C:/Projects/banking-system/backend/src/database/repositories/accountRepository.ts:37) làm nhiệm vụ đổi tên và kiểm tra giá trị:

~~~typescript
availableMinor: asBigIntString(row.available_minor, "available_minor"),
currentMinor: asBigIntString(row.current_minor, "current_minor"),
version: asBigIntString(row.version, "version"),
~~~

Database driver có thể trả bigint dưới dạng bigint, number hoặc string tùy cấu hình/độ lớn. rowMappers chuẩn hóa thành string để tầng service tính BigInt và API trả JSON an toàn.

TypeScript type không chạy cùng JSON. Ví dụ PaymentAccount nói rằng object phải có availableBalance, nhưng một response mạng thiếu field vẫn có thể đi vào JavaScript nếu không có validator. Vì vậy Mobile có validator runtime; type và database constraint giải quyết hai lớp vấn đề khác nhau.

## 1.2 Các kiểu dữ liệu thường gặp trong schema

| Kiểu PostgreSQL | Cách hiểu cho người mới | Ví dụ trong project |
|---|---|---|
| uuid | Mã định danh 128-bit, thường dùng làm ID | customers.id, payment_accounts.id |
| text | Chuỗi có độ dài linh hoạt | full_name, status, reason |
| char(3) | Chuỗi cố định 3 ký tự | currency = VND |
| bigint | Số nguyên lớn | amount_minor, version |
| integer | Số nguyên nhỏ hơn bigint | attempts, term_months |
| boolean | đúng/sai | is_read, enabled |
| timestamptz | ngày giờ có múi giờ | created_at, expires_at |
| jsonb | JSON được PostgreSQL lưu và có thể truy vấn | payload, synthetic_payload |
| text[] | mảng chuỗi | step_up_methods |
| byte-like secret | Project không lưu secret thô; secret được mã hóa hoặc băm | secret_ciphertext, code_digest |

NULL không phải chuỗi rỗng và không phải số 0. Ví dụ consumed_at NULL nghĩa quote chưa có thời điểm tiêu thụ; fee_minor = 0 nghĩa có phí bằng 0. Code phải phân biệt hai trường hợp.

## 1.3 Tiền được biểu diễn bằng minor unit

[backend/src/money.ts](C:/Projects/banking-system/backend/src/money.ts:4) nhận object dạng:

~~~typescript
{ currency: "VND", amountMinor: "100000" }
~~~

parseMoney kiểm tra currency là VND, amountMinor là chuỗi chỉ gồm chữ số không âm, rồi chuyển thành BigInt. toMoney chuyển BigInt thành chuỗi để JSON không phải serialize trực tiếp bigint.

~~~text
JSON request       → parseMoney       → 100000n
100000n tính toán  → toMoney          → JSON "100000"
~~~

Vì vậy amountMinor = "100000" được hiểu là 100.000 đồng trong sandbox. Không dùng floating point để cộng trừ tiền. Cột PostgreSQL cũng là bigint và nhiều cột có CHECK >= 0 hoặc > 0.

## 1.4 Khóa, constraint, index và trigger

- PRIMARY KEY bảo đảm mỗi row có ID duy nhất. Trong bảng liên kết nhiều-nhiều, hai cột có thể cùng tạo primary key, ví dụ credit_statement_items(statement_id, transaction_id).
- FOREIGN KEY bảo đảm giá trị tham chiếu tới row tồn tại. Ví dụ payment_accounts.customer_id REFERENCES customers(id).
- UNIQUE ngăn trùng dữ liệu trong phạm vi được định nghĩa. UNIQUE(customer_id, idempotency_key) chỉ cấm trùng trong cùng customer, không cấm mọi customer dùng cùng chuỗi.
- CHECK giữ luật miền: currency phải là VND, status phải thuộc danh sách, amount phải dương.
- INDEX làm truy vấn theo điều kiện/sắp xếp nhanh hơn. Index không tự khóa nghiệp vụ và cũng không thay constraint.
- Partial index có WHERE, chỉ lập mục lục cho subset như status = 'PENDING'. Nó phù hợp queue nhỏ hơn toàn bảng.
- Trigger là logic database tự chạy khi INSERT/UPDATE/DELETE. Audit trigger ở migration 020 chặn UPDATE/DELETE audit_events.
- Deferred constraint trigger kiểm tra ở cuối transaction. Ledger có thể INSERT journal rồi nhiều entries trước khi kiểm tra journal cân bằng lúc COMMIT.

## 1.5 Đường đi của một câu query

~~~text
Mobile Screen
  → mobile API wrapper
  → requestJson
  → Backend HTTP
  → RelationalHttpBoundary
  → Service
  → Repository
  → PoolClient.query(SQL, values)
  → PostgreSQL
  → row mapper
  → public response
  → Mobile validator/state/UI
~~~

Không có Mobile nào mở PostgreSQL trực tiếp. Service không nên nhận một row rồi đưa nguyên vẹn ra UI: nó chọn field, kiểm tra ownership, đổi kiểu và che dữ liệu nhạy cảm.

## Câu hỏi tự kiểm tra

1. Vì sao amountMinor là chuỗi trong JSON nhưng có thể là BigInt trong service?
2. Foreign key của payment_accounts.customer_id đang bảo vệ quan hệ nào?
3. Index có tự ngăn hai request dùng cùng idempotency key không?
4. NULL trong consumed_at khác 0 như thế nào?

# 2. Đọc migration và dựng schema hiện tại

## 2.1 Migration là lịch sử thay đổi có thứ tự

Mỗi file trong [backend/database](C:/Projects/banking-system/backend/database/README.md) có số đầu tên. Runner lấy file khớp dạng số_tên.sql, sort theo số và áp dụng từ 001 đến 040. [runtimeMetadata.ts](C:/Projects/banking-system/backend/src/runtimeMetadata.ts:21) cũng tìm file theo cách này để tính schemaVersion và migrationSetDigest.

Migration runner không chỉ quan tâm SQL có chạy được. [disposableDatabaseGuard.ts](C:/Projects/banking-system/backend/src/database/disposableDatabaseGuard.ts:2199) tính checksum nội dung canonical; hàm validateMigrationHistoryRecords yêu cầu đúng 40 record, đúng key, status APPLIED, checksum dạng SHA-256 và khớp file canonical. [migration-content.cjs](C:/Projects/banking-system/backend/scripts/migration-content.cjs:3) chuẩn hóa newline trước khi hash.

Vì vậy migration đã áp dụng không nên sửa lại cho tiện. Nếu schema cần đổi, tạo migration số tiếp theo. Đây là forward-only: database mới đi qua toàn bộ lịch sử; database cũ nhận phần ALTER/UPDATE bổ sung.

## 2.2 Timeline 001–040

| Migration | Vai trò chính |
|---|---|
| 001_banking_mvp.sql | Tạo customer, device/session, payment account, beneficiary, quote/transfer, account transaction, ledger, audit, outbox, notifications, fraud, control policy |
| 002_savings_sandbox.sql | Tạo sản phẩm, quote, opening, deposit tiết kiệm; nối transaction/notification và policy |
| 003_credit_sandbox.sql | Tạo credit account/card/statement/transaction, payment quote/payment; nối transaction/notification và policy |
| 004_credit_unlock_policy.sql | Bổ sung policy step-up cho mở khóa thẻ nếu migration 003 cũ chưa có |
| 005_relational_reference_runtime.sql | Bổ sung account number, bank name, held balance, snapshot destination, runtime records và cột transfer/ledger |
| 006_relational_v2_foundation.sql | Sequence số tài khoản, fingerprint quote, foreign key quote/transfer, outbox dedup, command_idempotency và index |
| 007_identity_runtime_normalization.sql | Refresh family/record, auth challenge, pending registration, rate-limit; backfill phần legacy đủ dữ kiện |
| 008_transfer_relational_v2.sql | Foreign key destination, index transfer/quote/account và constraint fingerprint |
| 009_savings_relational_v2.sql | Idempotency tiết kiệm, maturity operation, renewal guard và queue index |
| 010_credit_relational_v2.sql | Idempotency credit, index quote/payment/statement và constraint amount/version |
| 011_registration_recovery.sql | registration_completions để retry sau khi mất response |
| 012_outbox_worker.sql | Lease/status/version cho outbox; endpoint, preference, delivery, dead letter, worker instance |
| 013_outbox_worker_operations.sql | updated_at và index vận hành outbox |
| 014_mfa_credentials.sql | Credential TOTP và metadata secret mã hóa |
| 015_auth_challenge_hardening.sql | method/status/proof digest/max attempts/resend/terminal timestamps của challenge |
| 016_mfa_recovery.sql | Recovery code và recovery request state machine |
| 017_auth_security_events.sql | Sự kiện bảo mật đã redact |
| 018_mfa_challenge_constraints.sql | Ràng buộc method–credential và purpose challenge |
| 019_admin_control_plane.sql | Staff/RBAC/session/MFA/invite và action workflow typed requests, jobs, lịch sử |
| 020_admin_case_operations.sql | KYC/credit case, assignment/note/fraud action, version fraud/transfer, audit append-only trigger |
| 021_admin_bootstrap_guard.sql | Singleton guard cho bootstrap Admin một lần |
| 022_admin_policy_alignment.sql | Đồng bộ permission mở khóa customer và action policy |
| 023_admin_roles_rls_and_domain_adapters.sql | Database roles/grants, typed adapter request, funding reversal và RLS case scope |
| 024_admin_staff_invite_workflow.sql | Staff invite là maker–checker action; chỉ materialize sau checker |
| 025_admin_case_scope_alignment.sql | Cho phép triage role nhìn case chưa assign; case đã assign vẫn có scope |
| 026_secret_envelope_metadata.sql | Version/AAD/algorithm/data key metadata và checkpoint re-encryption |
| 027_secret_rotation_inventory.sql | key_id và thời điểm re-encrypt cho endpoint/MFA |
| 028_dr_recovery_markers.sql | Marker cho rehearsal disaster recovery, không phải bằng chứng RPO |
| 029_savings_products_relational_v2.sql | Seed catalog sản phẩm tiết kiệm ổn định |
| 030_credit_relational_v2_cutover.sql | Application idempotency và liên kết credit application–credit account |
| 031_remaining_relational_v2.sql | Recipient lookup hash, fraud idempotency, unique open fraud |
| 032_relational_scheduled_lifecycle.sql | Operation idempotency cho đóng sao kê/quá hạn/settle/reverse payment |
| 033_control_policy_bootstrap.sql | Singleton policy relational-v2 và TOTP-compatible constraints |
| 034_policy_entitlements_login_rate_limit.sql | Entitlement customer, blocked_until rate limit và trigger seed feature |
| 035_credit_cycle_start.sql | Con trỏ cycle tín dụng, backfill có evidence/manual-review guard |
| 036_beneficiary_lifecycle.sql | DELETED tombstone, unique active beneficiary và index |
| 037_transfer_counterparty_snapshots.sql | Snapshot tên chủ đích cho quote |
| 038_customer_kyc_runtime.sql | KYC customer-facing draft/submission, synthetic_payload, open application guard |
| 039_lifecycle_suspense_and_keyset_indexes.sql | Maturity suspense và keyset indexes lịch sử |
| 040_card_security_and_suspense_retry.sql | Card security case, purpose CARD_REPORT_LOST, retry/dead-letter suspense |

Migration 005 có reference_runtime_records để giữ dữ liệu sandbox/legacy theo từng record, không phải một JSON snapshot duy nhất. README database gọi các bảng relational mới là source chính cho runtime relational-v2; snapshot cũ phục vụ tương thích/nâng dữ liệu.

## 2.3 Vì sao migration có cả CREATE, ALTER và UPDATE?

Một database đã có dữ liệu không thể chỉ CREATE bảng mới. Ví dụ:

1. 005 thêm account_number nullable để có thể backfill.
2. 006 tạo sequence, điền số tài khoản cũ và mới.
3. 006 mới SET NOT NULL và thêm format check.
4. 007 backfill session từ payload legacy nếu đủ dữ kiện.
5. 038 đổi tên trạng thái KYC cũ MORE_INFO_REQUIRED thành NEEDS_MORE_INFO rồi mới thêm constraint mới.

Đây là quy trình “mở đường → chuyển dữ liệu → siết ràng buộc”. Thứ tự tránh làm database cũ hỏng giữa chừng.

## Câu hỏi tự kiểm tra

1. Vì sao không sửa trực tiếp 001 sau khi đã áp dụng?
2. Migration 006 bổ sung những cơ chế nào giúp lệnh transfer an toàn hơn?
3. Schema hiện tại đến migration số mấy và runner yêu cầu bao nhiêu record?
4. Vì sao một migration có thể vừa UPDATE dữ liệu vừa ALTER constraint?


# 3. Bản đồ các nhóm bảng

## 3.1 Sơ đồ customer và tài khoản

~~~text
customers
├── customer_devices
├── auth_sessions
├── refresh_session_families
├── refresh_session_records
├── payment_accounts
│   └── account_transactions
├── beneficiaries
├── transfer_quotes
│   └── transfers
│       └── account_transactions của nguồn và đích
├── notifications
├── fraud_reports
├── savings_quotes → savings_openings → savings_deposits
└── credit_accounts → credit_cards
                  ├── credit_statements
                  │   └── credit_statement_items → credit_transactions
                  └── credit_payment_quotes → credit_payments
~~~

Đây là quan hệ logic dựa trên foreign key và cách service sử dụng dữ liệu. Một mũi tên không có nghĩa mọi bảng đều được JOIN trong cùng một SELECT. Ví dụ chuyển tiền cập nhật payment_accounts, tạo account_transactions và ledger entries trong một transaction, nhưng các bảng vẫn giữ mục đích riêng.

## 3.2 Sơ đồ giao dịch tài chính

~~~text
transfer_quotes
  └─ một quote được tiêu thụ nhiều nhất một lần
       └─ transfers
            ├─ source_account_id → payment_accounts nguồn
            ├─ destination_account_id → payment_accounts đích
            ├─ source_transaction_id → account_transactions
            ├─ destination_transaction_id → account_transactions
            ├─ ledger_journal_id → ledger_journals
            ├─ audit_events.resource_id
            ├─ notifications.resource_id
            └─ outbox_events.aggregate_id
~~~

Quote là bản xem trước có hạn. Transfer là bản ghi lệnh đã được chấp nhận/thực thi. account_transactions là lịch sử theo từng account. ledger_journals/ledger_entries là bút toán cân bằng. audit_events trả lời “ai làm gì”; outbox_events trả lời “công việc nào cần xử lý sau commit”.

## 3.3 Sơ đồ tiết kiệm và tín dụng

~~~text
savings_products
  └─ savings_quotes
       └─ savings_openings
            └─ savings_deposits
                 └─ savings_maturity_operations
                      └─ savings_maturity_suspense (nếu cần vận hành tiếp)

credit_accounts
├── credit_cards
├── credit_statements
│    ├── credit_statement_items
│    └── credit_transactions
└── credit_payment_quotes
     └── credit_payments
          └── credit_lifecycle_operations
~~~

## 3.4 Sơ đồ Admin

~~~text
staff_users
├── staff_user_roles → staff_roles → staff_role_permissions → staff_permissions
├── staff_sessions
├── staff_mfa_credentials
├── staff_invites
└── staff_auth_challenges

admin_action_policies
  └── admin_action_requests
       ├── admin_action_decisions
       ├── admin_action_execution_attempts
       └── typed request detail tables
            ├── account_status_change_requests
            ├── simulation_funding_requests
            ├── application_decision_requests
            ├── transfer_operation_requests
            ├── fraud_resolution_requests
            ├── outbox_requeue_requests
            ├── job_retry_requests
            └── staff_role_change_requests

case tables:
kyc_applications / credit_applications
  ├── case_assignments
  └── case_internal_notes
fraud_reports
  └── fraud_case_actions
~~~

Admin action request là một lệnh chờ phê duyệt, không phải target nghiệp vụ. Ví dụ APPROVED của admin_action_requests chưa tự có nghĩa credit_applications đã ACTIVE.

## 3.5 Các nhóm bảng và file truy cập

| Nhóm dữ liệu | Bảng tiêu biểu | Code truy cập chính |
|---|---|---|
| Customer/account | customers, payment_accounts, account_transactions | CustomerRepository, AccountRepository, RelationalAccountReadService |
| Auth/MFA | auth_sessions, refresh_session_*, auth_challenges, mfa_* | RelationalAuthService, PersistentMfaService, MfaRepository |
| Transfer | transfer_quotes, transfers, command_idempotency | RelationalTransferService, TransferRepository |
| Ledger/audit/outbox | ledger_*, audit_events, outbox_events | LedgerRepository, AuditRepository, OutboxRepository |
| Savings | savings_* | RelationalSavingsService, SavingsRepository, RelationalLifecycleService |
| Credit | credit_* | RelationalCreditService, CreditRepository |
| Notifications/fraud | notifications, notification_*, fraud_* | RelationalRemainingService, worker, AdminRepository |
| Admin identity | staff_*, admin_action_* | StaffAuthService, AdminActionEngine, AdminRepository |
| Admin cases/jobs | kyc/credit applications, assignments, notes, background jobs | adminHttp, AdminActionEngine, AdminRepository |

## Câu hỏi tự kiểm tra

1. Vì sao transfer_quotes và transfers không phải một bảng duy nhất?
2. account_transactions và ledger_entries cùng lưu tiền nhưng trả lời hai câu hỏi nào?
3. Một credit payment nối với những tài khoản/sao kê nào?
4. Bảng nào lưu người duyệt Admin và bảng nào lưu target nghiệp vụ?

# 4. Customer, payment account và lịch sử giao dịch

## 4.1 Bảng customers

### 1. Một hàng đại diện cho gì?

Một hàng trong customers đại diện cho một khách hàng của reference system.

### 2. Migration tạo/thay đổi

Migration 001 tạo bảng với id, full_name, email, phone_number, password_salt, password_digest, created_at. Migration 019 thêm access_status và access_version để Admin có thể khóa quyền truy cập. Migration 034 tạo entitlement liên quan nhưng entitlement nằm ở bảng riêng.

Nguồn: [001_banking_mvp.sql](C:/Projects/banking-system/backend/database/001_banking_mvp.sql:6), [019_admin_control_plane.sql](C:/Projects/banking-system/backend/database/019_admin_control_plane.sql:333).

### 3. Cột quan trọng

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| id | uuid | Primary key |
| full_name | text | Tên hiển thị/nội bộ |
| email, phone_number | text | Dữ liệu liên hệ, có unique |
| password_salt, password_digest | text | Thành phần xác thực; không lưu password thô |
| access_status | text | ACTIVE hoặc LOCKED |
| access_version | bigint | Phiên bản quyền truy cập, tăng khi thay đổi |
| created_at | timestamptz | Thời điểm tạo |

### 4. Khóa, constraint, index

id là primary key. email và phone_number có UNIQUE; customers_email_lower_idx giúp unique không phân biệt hoa thường. access_status có CHECK ACTIVE/LOCKED. customers_access_status_idx phục vụ lọc trạng thái.

### 5. Quan hệ

customer là cha của customer_devices, auth_sessions, payment_accounts, beneficiaries, notifications, fraud_reports, các bảng quote/idempotency, credit/savings và nhiều bảng Admin tham chiếu customer_id.

### 6. Code đọc/ghi

CustomerRepository đọc/tạo customer. RelationalAuthService tìm customer để đăng nhập. RelationalRegistrationService.complete tạo customer và account trong cùng transaction. AdminRepository tìm customer dạng đã che.

### 7. Ví dụ

~~~text
id = C1
email = linh@example.test
access_status = ACTIVE
access_version = 1
~~~

Account A1 có customer_id = C1 nên thuộc về khách C1.

### 8. Lỗi và cơ chế ngăn

- Tạo email trùng: UNIQUE/unique index từ chối.
- Password thô bị lưu: code hash trước khi insert; schema chỉ có digest/salt.
- Customer bị khóa nhưng session cũ vẫn dùng: service/auth HTTP kiểm tra access status và version/thu hồi session theo luồng Admin.
- Đọc nhầm customer người khác: service truyền customerId vào điều kiện ownership.

## 4.2 Bảng customer_devices và auth_sessions

### 1. Một hàng đại diện cho gì?

customer_devices là một ràng buộc thiết bị thuộc customer. auth_sessions là một phiên truy cập customer trên device, chứa hash token thay vì token thô.

### 2. Migration

Cả hai được tạo ở 001. refresh_session_families, refresh_session_records và auth_challenges bổ sung ở 007. 006/007/008 thêm index active phục vụ truy vấn phiên.

### 3. Cột quan trọng

customer_devices: id uuid, customer_id uuid, device_id text, attestation_status, created_at, revoked_at. Unique(customer_id, device_id).

auth_sessions: id, customer_id, device_id, family_id, access_token_hash, refresh_token_hash, expires_at, revoked_at, replaced_by_session_id, created_at. Token hash có UNIQUE; device_id FK tới customer_devices.

### 4. Constraint/index

FK customer/device; token hash unique; status attestation chỉ PENDING/VERIFIED/REVOKED. Index theo customer, family và active customer giúp tìm session chưa revoked.

### 5. Quan hệ

Một customer có nhiều device; một device có nhiều session theo thời gian. Refresh family/record là mô hình relational-v2 cho rotation/reuse detection, song song với auth_sessions trong giai đoạn chuyển tiếp.

### 6. Code

RelationalAuthService.issueSession, authenticate, refresh, revoke, revokeAll. AuthProvider Mobile giữ token/session ở phía client nhưng không tự thay row database.

### 7. Ví dụ

Một customer đăng nhập trên device D1. Server lưu hash access/refresh và expires_at. Khi refresh, record cũ có thể bị revoke/replaced; khi reuse bất thường, service thu hồi family.

### 8. Lỗi và cơ chế ngăn

Token bị lộ trong database khó dùng trực tiếp vì chỉ hash được lưu. Session hết hạn/revoked bị authenticate từ chối. Device ID sai làm request không vượt qua binding. Xem [relationalAuthService.ts](C:/Projects/banking-system/backend/src/database/relationalAuthService.ts:47).

## 4.3 Bảng payment_accounts

### 1. Một hàng đại diện cho gì?

Một hàng là một tài khoản thanh toán của customer trong virtual-money sandbox.

### 2. Migration

001 tạo phần cơ bản. 005 thêm account_number, bank_name, opening_balance_minor, held_minor. 006 tạo sequence số tài khoản, backfill, bắt buộc account_number và format/unique. 008 thêm index theo customer/status. 019 thêm Admin access ở customer chứ không đổi ownership account. 037 thêm snapshot ở quote, không thay account.

Nguồn: [001_banking_mvp.sql](C:/Projects/banking-system/backend/database/001_banking_mvp.sql:47), [005_relational_reference_runtime.sql](C:/Projects/banking-system/backend/database/005_relational_reference_runtime.sql:10), [006_relational_v2_foundation.sql](C:/Projects/banking-system/backend/database/006_relational_v2_foundation.sql:6).

### 3. Cột quan trọng

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| id | uuid | Primary key |
| customer_id | uuid | Chủ tài khoản |
| display_name | text | Tên tài khoản |
| account_number | text | Số đầy đủ; được tạo từ sequence relational-v2 |
| masked_number | text | Dạng che cho list |
| bank_name | text | Tên ngân hàng reference |
| currency | char(3) | Bắt buộc VND |
| available_minor | bigint | Có thể dùng cho lệnh mới |
| current_minor | bigint | Số dư hiện tại theo model |
| held_minor | bigint | Phần đang giữ |
| status | text | ACTIVE hoặc BLOCKED |
| version | bigint | Phiên bản optimistic guard |
| updated_at | timestamptz | Lần cập nhật gần nhất |

### 4. Khóa, constraint, index

id là PK; customer_id FK customers. available/current/held không âm. currency CHECK VND. account_number unique và có format 6–34 chữ số. Index customer và customer/status giúp list/ownership/queue. status không được tùy ý đổi thành một chuỗi khác.

### 5. Quan hệ

Một customer có thể có nhiều payment_accounts. account_transactions, transfer quote/transfer, savings và credit payment có thể tham chiếu tài khoản. Account number không phải FK tới customer; ownership được kiểm tra bằng customer_id ở query.

### 6. Code đọc/ghi

[AccountRepository](C:/Projects/banking-system/backend/src/database/repositories/accountRepository.ts:73) có findOwnedAccount, findAccountsByCustomer, lockById, lockManyByIds, updateBalances, updateStatus, listTransactions, appendTransaction. RelationalAccountReadService mapping account cho Mobile. Transfer/Savings/Credit service dùng lại repository khi thay đổi tiền.

### 7. Ví dụ

~~~text
A1 | C1 | available_minor 500000 | current_minor 500000
   |    | held_minor 0          | status ACTIVE | version 4
~~~

Một giao dịch chuyển 100.000 với phí 1.000 có thể khiến available/current thành 399.000 nếu không có thay đổi khác.

### 8. Lỗi và cơ chế ngăn

- Biết accountId nhưng không sở hữu: findOwnedAccount lọc cả id và customer_id.
- Số dư âm: CHECK và kiểm tra service.
- Hai request cùng sửa: lockManyByIds + expectedVersion.
- Lộ số tài khoản: list trả masked_number; getAccountNumber là method riêng có audit.
- Dùng sai currency: CHECK currency = VND.

### Query ownership thật

~~~typescript
const result = await this.client.query(
  "SELECT * FROM payment_accounts WHERE id = $1 AND customer_id = $2",
  [requireUuid(accountId, "accountId"), requireUuid(customerId, "customerId")],
);
~~~

Đây là lý do không được thay bằng SELECT WHERE id = $1 khi đường gọi là customer API.

## 4.4 Bảng account_transactions

### 1. Một hàng đại diện cho gì?

Một hàng là một dòng lịch sử của một tài khoản thanh toán: DEBIT hoặc CREDIT, amount, fee, status, reference và thời điểm.

### 2. Migration

001 tạo phần cơ bản. 005 thêm kind. 002 thêm savings_opening_id/savings_deposit_id. 003 thêm credit_payment_id. 037 giúp transfer quote giữ tên counterparty snapshot; 039 thêm index keyset account_id/occurred_at/id.

### 3. Cột quan trọng

id uuid; account_id FK payment_accounts; transfer_id có thể null; direction CREDIT/DEBIT; amount_minor > 0; fee_minor >= 0; currency VND; status PENDING/SUCCEEDED/FAILED/REVERSED; description; counterparty_name; reference; occurred_at, created_at, completed_at; kind; savings/credit foreign keys.

### 4. Constraint/index

PK id; FK giữ liên kết tới account/transfer/savings/credit. CHECK direction/status/currency/amount. Index lịch sử theo account_id, occurred_at DESC và bản keyset có id để phân định hai row cùng timestamp.

### 5. Quan hệ

Một payment_account có nhiều transactions. Một transfer nội bộ thường tạo hai dòng: debit account nguồn và credit account đích. Một savings opening tạo debit kind SAVINGS; payment tín dụng tạo debit kind CREDIT_PAYMENT.

### 6. Code

AccountRepository.mapTransaction, appendTransaction, listTransactions, findTransaction. RelationalAccountReadService.toTransaction/toTransactionDetail chỉ trả public fields. Credit/Savings/Transfer service ghi các dòng.

### 7. Ví dụ

~~~text
T1 | account A1 | DEBIT  | amount 100000 | fee 1000 | kind TRANSFER
T2 | account B1 | CREDIT | amount 100000 | fee 0    | kind TRANSFER
~~~

Hai dòng có thể cùng transferId nhưng khác account_id và direction.

### 8. Lỗi và cơ chế ngăn

Không kiểm tra account ownership ở tầng API: service gọi findOwnedAccount trước khi list/find. Tải lịch sử thiếu ổn định: ORDER BY occurred_at DESC, id DESC và cursor. Kind nội bộ ngoài public enum: mapper bỏ kind đó thay vì trả JSON enum sai.

## 4.5 Luồng xem tài khoản từ database

~~~text
HomeScreen.loadAccounts
  → accountsApi.listAccounts
  → HTTP /accounts
  → RelationalAccountReadService.listAccounts(customerId)
  → AccountRepository.findAccountsByCustomer
  → SELECT payment_accounts WHERE customer_id = $1 ORDER BY id
  → mapAccount
  → toPaymentAccount
  → JSON accounts
~~~

Không có UPDATE trong luồng này. Nút hiện số đầy đủ gọi getAccountNumber, query ownership rồi AuditRepository.append event ACCOUNT_NUMBER_REVEALED trước khi trả accountNumber.

## Câu hỏi tự kiểm tra

1. Vì sao payment_accounts cần cả customer_id và account_number?
2. Một transfer nội bộ tạo bao nhiêu account_transactions theo nhánh hiện tại?
3. version của account dùng để làm gì?
4. getAccountNumber khác listAccounts ở quyền và audit thế nào?


# 5. Đọc SQL trong repository

Phần này không học SQL tách khỏi project. Mỗi câu lệnh được nối với method thực tế.

## 5.1 SELECT, WHERE và parameter $1/$2

Câu query findOwnedAccount:

~~~sql
SELECT * FROM payment_accounts
WHERE id = $1 AND customer_id = $2
~~~

Array values:

~~~typescript
[requireUuid(accountId, "accountId"), requireUuid(customerId, "customerId")]
~~~

PostgreSQL thay $1/$2 bằng giá trị theo vị trí, nhưng driver gửi chúng dưới dạng parameter. Code không nối chuỗi input vào SQL. Cách này giảm SQL injection và làm rõ thứ tự giá trị.

WHERE là điều kiện lọc. Nếu bỏ customer_id, một customer có thể thử accountId của người khác. Nếu bỏ requireUuid, input sai có thể đi sâu tới database rồi tạo lỗi khó hiểu.

SELECT * đọc toàn bộ cột của row bên trong. Mapper sau đó chọn field public. Không nên hiểu SELECT * là API trả mọi cột.

## 5.2 ORDER BY và keyset pagination

AccountRepository.listTransactions dùng ý tưởng:

~~~sql
WHERE account_id = $1
  AND (
    $2::timestamptz IS NULL
    OR occurred_at < $2::timestamptz
    OR (occurred_at = $2::timestamptz AND id < $3::uuid)
  )
ORDER BY occurred_at DESC, id DESC
LIMIT $4
~~~

Giải thích:

- account_id = $1 giới hạn đúng tài khoản.
- cursor null lấy trang đầu.
- Nếu có cursor, lấy các hàng cũ hơn mốc; nếu cùng occurred_at thì so id để thứ tự vẫn xác định.
- ORDER BY hai cột cùng với cursor tạo một thứ tự ổn định.
- Service hỏi limit + 1. Nếu nhận 21 hàng cho limit 20, nó trả 20 và mã hóa mốc hàng thứ 20 thành nextCursor.

Index 039:

~~~sql
CREATE INDEX IF NOT EXISTS account_transactions_account_occurred_keyset_idx
  ON account_transactions (account_id, occurred_at DESC, id DESC)
~~~

Index có thứ tự phù hợp với truy vấn dài. Index không tự tạo cursor; service vẫn phải encode/decode và kiểm tra scope.

## 5.3 JOIN

CreditRepository.listCards dùng JOIN:

~~~sql
SELECT c.*, ca.currency, ca.credit_limit_minor,
       ca.posted_outstanding_minor
FROM credit_cards c
JOIN credit_accounts ca ON ca.id = c.credit_account_id
WHERE c.customer_id = $1
ORDER BY c.display_name, c.id
~~~

Có hai bảng:

- c là alias của credit_cards.
- ca là alias của credit_accounts.
- ON nối card với đúng credit account.
- WHERE giới hạn customer.

JOIN không thay foreign key; foreign key giữ tính tồn tại, JOIN lấy dữ liệu từ nhiều bảng trong một kết quả.

## 5.4 INSERT

TransferRepository.createQuote tạo một row quote bằng INSERT. Một INSERT đúng thường có:

~~~sql
INSERT INTO transfer_quotes
  (id, customer_id, source_account_id, amount_minor, fee_minor, ...)
VALUES ($1, $2, $3, $4, $5, ...)
RETURNING *
~~~

VALUES truyền riêng; RETURNING lấy row đã tạo để map. Database constraint kiểm tra amount/currency/FK sau khi nhận values.

INSERT account_transactions ghi lịch sử sau khi service đã kiểm tra nghiệp vụ. INSERT ledger_entries có line_number để một journal có nhiều dòng.

## 5.5 UPDATE và số row bị tác động

AccountRepository.updateBalances có dạng:

~~~sql
UPDATE payment_accounts
SET available_minor = $2,
    current_minor = $3,
    held_minor = $4,
    version = version + 1,
    updated_at = NOW()
WHERE id = $1
  AND available_minor >= 0
  AND current_minor >= 0
  AND held_minor >= 0
  AND ($5::bigint IS NULL OR version = $5)
RETURNING *
~~~

Nếu không có row trả về, method ném lỗi. Điều này quan trọng: code không yên lặng coi update thất bại là thành công.

UPDATE status khác với INSERT lịch sử. Khi số dư đổi, version tăng; account_transactions phải được append riêng nếu nghiệp vụ cần lịch sử.

## 5.6 FOR UPDATE

~~~sql
SELECT * FROM payment_accounts
WHERE id = $1
FOR UPDATE
~~~

FOR UPDATE đặt row lock trong transaction hiện tại. Request khác muốn lock cùng row phải chờ hoặc lỗi theo timeout. Nó không khóa toàn bảng và không kéo dài sau COMMIT/ROLLBACK.

Transfer service khóa hai account theo:

~~~sql
SELECT * FROM payment_accounts
WHERE id = ANY($1::uuid[])
ORDER BY id
FOR UPDATE
~~~

ORDER BY id làm các lệnh khóa nhiều account theo cùng thứ tự, giảm nguy cơ deadlock do A→B và B→A.

## 5.7 ON CONFLICT

Idempotency repository dùng:

~~~sql
INSERT INTO command_idempotency
  (id, customer_id, operation_type, idempotency_key, request_fingerprint, status)
VALUES ($1, $2, $3, $4, $5, 'PENDING')
ON CONFLICT (customer_id, operation_type, idempotency_key) DO NOTHING
RETURNING *
~~~

- Row mới trả về: command này có quyền tiếp tục.
- Conflict: đọc row cũ FOR UPDATE.
- Fingerprint khác: cùng key nhưng nội dung khác, service ném conflict.
- Fingerprint giống và đã có aggregateId: trả canonical result.

ON CONFLICT là hỗ trợ của database; quyết định replay hay báo lỗi vẫn là business code.

## 5.8 Mapping và public response

Repository mapper đổi row thành AccountRow/TransferRow. Service mapper đổi row nội bộ thành PaymentAccount/TransferReceipt. Các lớp này có hai lợi ích:

1. Cột DB như version, password_digest, source transaction nội bộ không tự lọt ra API.
2. Tên public có thể ổn định khi tên cột DB thay đổi.

Một mapper không tự kiểm tra toàn bộ business rule. Nó không quyết định balance có đủ để chuyển không; service làm việc đó.

## Câu hỏi tự kiểm tra

1. $1 và $2 được gắn với values theo nguyên tắc nào?
2. Vì sao keyset cursor dùng cả occurred_at và id?
3. JOIN cần ON để làm gì?
4. UPDATE không trả row có nên được coi là thành công không?
5. ON CONFLICT tự trả transfer cũ hay service quyết định?

# 6. Dữ liệu của chức năng chuyển tiền

## 6.1 Bảng transfer_quotes

### 1. Một hàng đại diện cho gì?

Một hàng là bản báo giá chuyển tiền đã kiểm tra nguồn, đích, số tiền, phí và thời hạn.

### 2. Migration

001 tạo quote cơ bản. 005 cho phép destination lookup/snapshot/consumed transfer và recipient không nhất thiết là beneficiary. 006 thêm request_fingerprint, FK consumed transfer, active quote index. 008 thêm destination account FK/index. 037 thêm destination_owner_name snapshot.

Nguồn: [001_banking_mvp.sql](C:/Projects/banking-system/backend/database/001_banking_mvp.sql:76), [006_relational_v2_foundation.sql](C:/Projects/banking-system/backend/database/006_relational_v2_foundation.sql:49), [037_transfer_counterparty_snapshots.sql](C:/Projects/banking-system/backend/database/037_transfer_counterparty_snapshots.sql:4).

### 3. Cột quan trọng

id, customer_id, source_account_id, beneficiary_id nullable, beneficiary_snapshot jsonb, destination_account_id, destination_owner_id, destination_owner_name, amount_minor, fee_minor, currency, expires_at, consumed_at, consumed_transfer_id, request_fingerprint, created_at.

### 4. Constraint/index

PK id; FK customer/source/beneficiary/destination/consumed transfer. amount > 0, fee >= 0, currency VND. Index customer/expires_at, active quote, consumed transfer. consumed_at là trạng thái đã dùng; FK consumed_transfer_id nối kết quả.

### 5. Quan hệ

Quote thuộc customer và nguồn; destination có thể đến từ beneficiary hoặc recipient lookup. Một quote tối đa một transfer nhờ transfers.quote_id unique và consume guard.

### 6. Code

RelationalTransferService.createQuote, getStepUpRequestFingerprint, TransferRepository.createQuote, findQuoteForUpdate, consumeQuote.

### 7. Ví dụ

~~~text
Q1 | customer C1 | source A1 | destination B1
   | amount 100000 | fee 1000 | expires_at 10:05
   | consumed_at NULL
~~~

### 8. Lỗi/cơ chế

Quote hết hạn: submit bị QUOTE_EXPIRED. Customer khác: service không trả quote. Quote đã tiêu thụ: lấy canonical transfer hoặc báo trạng thái thiếu. Quote chỉ preview; account có thể bị khóa sau khi quote tạo nên submit vẫn kiểm tra lại.

## 6.2 Bảng transfers

### 1. Một hàng đại diện cho gì?

Một hàng là lệnh chuyển tiền canonical, có reference, status và liên kết tới quote/tài khoản/lịch sử.

### 2. Migration

001 tạo transfer. 005 thêm destination/source/destination transaction, ledger_journal, refunded, held. 006/008 thêm FK/index/invariants. 020 thêm version, last_error_code cho Admin operations. 037 snapshot quote hỗ trợ tên đối tác bất biến.

### 3. Cột quan trọng

id, customer_id, source_account_id, quote_id, idempotency_key, request_fingerprint, reference, amount_minor, fee_minor, currency, status, destination_account_id, destination_owner_id, source_transaction_id, destination_transaction_id, ledger_journal_id, refunded, held_minor, version, last_error_code, created_at, updated_at.

### 4. Constraint/index

PK id; FK customer/source/quote/destination; reference unique; quote_id unique; customer+idempotency unique; status chỉ PENDING/SUCCEEDED/FAILED/REVERSED; amount/fee/currency CHECK. Index theo customer/time, source/status/time, destination/status/time và pending updated.

### 5. Quan hệ

Transfer là trung tâm command. Nó trỏ quote, hai account, hai transaction và journal. Notifications/audit/outbox dùng transfer id làm resource/aggregate.

### 6. Code

RelationalTransferService.submit/get/toPublic; TransferRepository.createTransfer/findById/findByIdempotency. AdminRepository đọc/đề xuất retry/cancel/reversal.

### 7. Ví dụ

~~~text
T1 | quote Q1 | source A1 | destination B1
   | amount 100000 | fee 1000 | status SUCCEEDED
   | reference REF-... | version 1
~~~

### 8. Lỗi/cơ chế

Trùng quote: UNIQUE quote_id. Trùng key cùng customer: unique idempotency + fingerprint. Transfer đã SUCCEEDED mà retry: trả canonical, không trừ lại. Status thay đổi sai: CHECK và action engine guard.

## 6.3 Bảng command_idempotency

### 1. Một hàng đại diện cho gì?

Một hàng là sổ theo dõi một command có idempotency key, nội dung fingerprint và kết quả canonical.

### 2. Migration

006 tạo bảng. 008 thêm fingerprint nonempty và pending index. Transfer service dùng bảng cho TRANSFER_SUBMIT; các domain savings/credit có bảng idempotency riêng cùng ý tưởng.

### 3. Cột

id uuid, customer_id uuid, operation_type, idempotency_key, request_fingerprint, aggregate_id, status, response_payload jsonb, created_at, updated_at.

### 4. Constraint/index

PK id; customer FK; status PENDING/SUCCEEDED/FAILED/REVERSED; unique(customer_id, operation_type, idempotency_key); fingerprint không rỗng; aggregate index; pending updated index.

### 5. Quan hệ

aggregate_id trỏ logic tới transfer/opening/payment tùy operation_type; không dùng một foreign key polymorphic vì aggregate có nhiều bảng.

### 6. Code

TransferRepository.reserveCommandIdempotency/completeCommandIdempotency; RelationalTransferService.submit.

### 7. Ví dụ

~~~text
customer C1 + TRANSFER_SUBMIT + key K1
→ status PENDING
→ aggregate_id T1, status SUCCEEDED, response_payload receipt
~~~

### 8. Lỗi/cơ chế

Response mất sau commit: retry đọc aggregate. Key đổi nội dung: fingerprint mismatch. Reservation còn PENDING: báo IDEMPOTENCY_IN_PROGRESS thay vì mù quáng chạy lại.

## 6.4 Ledger journals và ledger entries

### 1. Một hàng đại diện cho gì?

ledger_journals là header của một sự kiện tài chính; ledger_entries là các dòng DEBIT/CREDIT của journal.

### 2. Migration

001 tạo cả hai, function và deferred constraint trigger. 005 thêm entry_id/occurred_at và unique entry id.

### 3. Cột

journal: id, aggregate_id, journal_type, currency, occurred_at, created_at. entry: journal_id, line_number, account_ref, side, amount_minor, currency, entry_id, occurred_at.

### 4. Constraint/index

Journal type+aggregate unique. Entry primary key(journal_id,line_number), amount > 0, side DEBIT/CREDIT, currency VND. Trigger yêu cầu ít nhất hai entry và tổng debit-credit = 0 khi constraint deferred chạy. Index account_ref và entry_id hỗ trợ tìm.

### 5. Quan hệ

Journal gắn transfer/savings/credit payment qua aggregate_id. Entry tham chiếu logic account_ref như A1 hoặc fee-income:VND; không phải mọi account_ref đều là UUID FK.

### 6. Code

LedgerRepository.appendJournal và appendEntries; Transfer/Savings/Credit service gọi trong UnitOfWork.

### 7. Ví dụ

~~~text
Journal TRANSFER T1:
DEBIT  payment-account:A1       101000
CREDIT payment-account:B1       100000
CREDIT fee-income:VND             1000
~~~

### 8. Lỗi/cơ chế

Thiếu vế đối ứng: deferred trigger ném lỗi lúc commit. Journal không có entries: trigger ném lỗi. Ledger cân bằng không chứng minh balance table đã cập nhật đúng; service phải ghi cả hai.

## 6.5 Audit events

### 1. Một hàng đại diện cho gì?

Một sự kiện truy vết: customer/staff nào, hành động nào, target nào, outcome/reason/version nào, thời điểm nào.

### 2. Migration

001 tạo customer audit tối thiểu. 019 thêm staff actor/action/target/outcome/request/trace/version fields. 020 tạo trigger append-only.

### 3. Cột

id, event_type/action, actor_customer_id hoặc actor_staff_id, actor_type, resource/target, occurred_at, payload/metadata, request_id, trace_id, before_version, after_version.

### 4. Constraint/index

PK; FK actor/resource ở phần phù hợp; index occurred_at và staff/occurred. Trigger BEFORE UPDATE OR DELETE chặn sửa/xóa.

### 5. Quan hệ

Audit nối lỏng với business resource bằng resource_id/target_id để dùng cho nhiều loại object. Admin action request_id giúp truy vết command.

### 6. Code

AuditRepository.append; RelationalAccountReadService ghi ACCOUNT_NUMBER_REVEALED; transfer/savings/credit/admin đều append. AdminRepository.listAudit đọc và redact.

### 7. Ví dụ

~~~text
event_type = TRANSFER_SUBMITTED
actor_customer_id = C1
resource_id = T1
payload = { traceId: ... }
~~~

### 8. Lỗi/cơ chế

Ghi secret/proof vào payload là lỗi bảo mật; code phải redact. UPDATE/DELETE bị trigger chặn. Audit không tự rollback một balance sai; nó là bằng chứng, không phải source số dư.

## 6.6 Outbox events và notifications

### 1. Một hàng đại diện cho gì?

notifications là thông báo trong hộp thư customer. outbox_events là ý định xử lý hậu kỳ sau khi nghiệp vụ commit.

### 2. Migration

001 tạo notifications/outbox. 006 thêm dedup/index. 012 thêm status, lease, priority, worker metadata và notification endpoint/preference/delivery/dead-letter/worker tables. 013 thêm updated_at/index. 040 bổ sung card/suspense liên quan.

### 3. Cột

notifications: customer_id, notification_type, title, body, resource_id, resource_account_id, is_read, created_at. outbox: event_type, aggregate_id/type/version, payload, deduplication_key, status, attempts, next_attempt_at, lease fields, trace_id, timestamps.

### 4. Constraint/index

Notification type CHECK được mở rộng qua migrations. Outbox status PENDING/PROCESSING/DISPATCHED/DEAD/SKIPPED; deduplication_key unique; attempt >= 0. Index claim/lease/dead/updated giúp worker.

### 5. Quan hệ

Transfer/savings/credit tạo notification row và outbox event trong cùng command. notification_deliveries nối outbox_event + notification + endpoint; worker xử lý delivery sau.

### 6. Code

OutboxRepository.append/claim/mark; WorkerRuntime.runOnce; RelationalRemainingService.listNotifications/markNotificationRead. Notification list không chứng minh push/email đã gửi.

### 7. Ví dụ

Transfer T1 commit tạo notification N1 is_read=false và outbox event TRANSFER_SUCCEEDED. Worker sau đó claim event và delivery có thể chuyển SENT.

### 8. Lỗi/cơ chế

Gửi push trước commit có thể báo thành công khi DB rollback. Commit rồi process chết có thể bỏ gửi nếu không có outbox. Outbox giải quyết khoảng mất việc, nhưng provider fake/disabled không phải gửi thật.

## 6.7 Trace chuyển tiền bằng dữ liệu

~~~text
1. Q1 được tạo: amount/fee/destination/expires_at/fingerprint.
2. Mobile lưu idempotency key và submit_unknown trước POST.
3. Server reserve command key.
4. Khóa Q1 và account A1/B1.
5. Kiểm tra quote, policy, ownership, ACTIVE, available.
6. INSERT T1 status SUCCEEDED.
7. consume Q1.
8. UPDATE A1 giảm amount+fee; UPDATE B1 tăng amount.
9. INSERT 2 account_transactions.
10. INSERT ledger journal + entries.
11. INSERT audit + notifications + outbox.
12. complete idempotency.
13. COMMIT; trả receipt.
~~~

Nếu lỗi ở bước 8–11 trước COMMIT, UnitOfWork rollback những row của transaction. Nếu COMMIT thành công nhưng Mobile mất response, key/intent giúp đọc lại T1.

## Câu hỏi tự kiểm tra

1. Vì sao quote chưa phải transfer?
2. Một transfer nội bộ nối tới hai account_transactions để làm gì?
3. Vì sao ledger có thêm fee-income khi debit là amount + fee?
4. Outbox event có phải là email/push đã gửi chưa?
5. Nếu cùng idempotency key nhưng requestFingerprint khác thì DB/service xử lý thế nào?



# 7. Transaction, cạnh tranh và UnitOfWork

## 7.1. Vì sao cùng một thao tác cần nhiều câu SQL?

Một thao tác chuyển tiền không chỉ có một câu lệnh. Hệ thống phải:

1. kiểm tra idempotency để một request được xử lý một lần;
2. khóa quote và hai tài khoản;
3. kiểm tra số dư, trạng thái và version;
4. tạo transfer;
5. cập nhật số dư hai bên;
6. thêm lịch sử tài khoản;
7. ghi sổ cái kép;
8. ghi audit và outbox;
9. đánh dấu command đã thành công.

Nếu một bước thành công nhưng bước sau thất bại, dữ liệu sẽ mâu thuẫn. Ví dụ, tài khoản người gửi bị trừ nhưng tài khoản người nhận chưa được cộng. Vì vậy các bước thay đổi dữ liệu chính được đặt trong một database transaction.

Trong source, transaction được bọc bởi [UnitOfWork](backend/src/database/unitOfWork.ts). Tên lớp này có thể hiểu là “một đơn vị công việc”: nhiều câu SQL được xem như một công việc nguyên tử.

## 7.2. Luồng BEGIN → COMMIT hoặc ROLLBACK

Phiên bản rút gọn của code thật trong **UnitOfWork.transaction**:

~~~ts
const client = await this.database.connect();

try {
  await client.query("BEGIN ISOLATION LEVEL " + isolationLevel);

  const result = await operation({
    client,
    query: client.query.bind(client),
    traceId: options.traceId,
  });

  await client.query("COMMIT");
  return result;
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
}
~~~

Giải thích theo thứ tự:

- **connect** lấy một client riêng từ connection pool.
- **BEGIN** mở transaction trên đúng client đó.
- **operation** là callback do service truyền vào. Mọi repository trong callback phải nhận cùng client.
- Nếu callback chạy xong, **COMMIT** làm cho thay đổi trở thành chính thức.
- Nếu có exception, **ROLLBACK** hủy các thay đổi chưa commit.
- **release** trả client về pool dù thành công hay thất bại.

Điểm quan trọng: repository không tự mở connection khác bên trong cùng transaction. TransferService tạo nhiều repository với cùng biến **client**:

~~~ts
const accounts = new AccountRepository(client);
const transfers = new TransferRepository(client);
const ledger = new LedgerRepository(client);
const audit = new AuditRepository(client);
const outbox = new OutboxRepository(client);
~~~

Do đó các lệnh của các repository cùng nhìn thấy cùng một trạng thái transaction.

## 7.3. UnitOfWork nằm ở đâu trong luồng chuyển tiền?

Luồng rút gọn:

~~~text
RelationalTransferService.submit
  → unitOfWork.transaction(...)
      → reserveCommandIdempotency
      → lock quote
      → lockManyByIds(source, destination)
      → updateBalances
      → createTransfer
      → appendAccountTransaction
      → createJournal + createEntries
      → append audit
      → enqueue outbox
      → complete idempotency
  → COMMIT
~~~

Nếu tất cả bước đều thành công, người gọi nhận kết quả transfer thành công. Nếu một bước bị lỗi, caller nhận lỗi và các thay đổi trong transaction bị hủy.

## 7.4. Khóa hàng bằng SELECT ... FOR UPDATE

Khi hai request cùng chuyển tiền từ một tài khoản, cả hai không được cùng đọc một số dư cũ rồi cùng trừ tiền. AccountRepository có method **lockManyByIds**:

~~~sql
SELECT *
FROM payment_accounts
WHERE id = ANY($1::uuid[])
ORDER BY id
FOR UPDATE
~~~

- **ANY($1::uuid[])** nhận danh sách UUID tài khoản.
- **FOR UPDATE** khóa các hàng đã đọc tới khi transaction commit hoặc rollback.
- **ORDER BY id** làm mọi request khóa nhiều tài khoản theo cùng một thứ tự. Điều đó làm giảm nguy cơ deadlock khi hai transfer cùng lúc đổi chiều giữa hai tài khoản.

Ví dụ giả định:

- Request A cần khóa A001 và B001.
- Request B cũng cần khóa B001 và A001.
- Nếu cả hai khóa theo thứ tự bất kỳ, mỗi request có thể giữ một khóa và chờ khóa còn lại.
- Nếu cả hai luôn khóa theo thứ tự id, chúng cạnh tranh ở cùng hàng đầu tiên; một request chờ, request kia chạy xong rồi nhả khóa.

Đây là lý do **FOR UPDATE** không chỉ là “đọc dữ liệu”. Nó còn bảo vệ phần dữ liệu sắp được thay đổi.

## 7.5. Version và optimistic concurrency

Payment account có cột **version**. AccountRepository.updateBalances nhận **expectedVersion** tùy chọn và cập nhật:

~~~sql
UPDATE payment_accounts
SET available_balance_minor = $1,
    current_balance_minor = $2,
    held_balance_minor = $3,
    version = version + 1,
    updated_at = NOW()
WHERE id = $4
  AND version = $5
  AND available_balance_minor >= 0
  AND current_balance_minor >= 0
  AND held_balance_minor >= 0
RETURNING *
~~~

Nếu không có hàng trả về, có thể đã xảy ra một trong các tình huống:

- account không tồn tại;
- account không còn đúng version mà caller đã đọc;
- số dư vi phạm điều kiện không âm;
- một request khác đã cập nhật trước.

Transfer flow đã khóa hàng, nhưng version vẫn là một lớp bảo vệ hữu ích khi một đường ghi khác quên dùng cùng quy tắc khóa hoặc khi nghiệp vụ cần phát hiện dữ liệu đã đổi.

## 7.6. Isolation level và retry

UnitOfWork mặc định dùng **READ COMMITTED**. Caller có thể yêu cầu **REPEATABLE READ** hoặc **SERIALIZABLE**.

- **READ COMMITTED**: mỗi câu lệnh thấy các commit đã hoàn thành trước khi câu lệnh bắt đầu.
- **REPEATABLE READ**: các lần đọc trong transaction ổn định hơn.
- **SERIALIZABLE**: PostgreSQL cố làm kết quả tương đương chạy tuần tự; đổi lại có thể phát sinh lỗi serialization.

[transactionRetry.ts](backend/src/database/transactionRetry.ts) chỉ retry một số lỗi có thể thử lại an toàn:

- mã **40001**: serialization failure;
- mã **40P01**: deadlock detected.

Retry phải chạy lại toàn bộ transaction, không chạy lại riêng một câu SQL. Vì callback có thể được gọi lần thứ hai, callback không nên gửi email, gọi ngân hàng ngoài hoặc thực hiện side effect không idempotent.

## 7.7. Idempotency, transaction và side effect

Bảng **command_idempotency** ghi customer, operation, idempotency key, fingerprint và status. Trong submit:

1. request mới cố gắng insert trạng thái PENDING;
2. nếu key đã có, hệ thống khóa hàng idempotency và so fingerprint;
3. cùng fingerprint và đã SUCCEEDED thì trả lại kết quả cũ;
4. cùng key nhưng fingerprint khác thì từ chối vì request bị dùng lại sai;
5. nếu request PENDING cũ còn dang dở, hệ thống xử lý theo chính sách đã định;
6. cuối transaction, status chuyển SUCCEEDED và response payload được lưu.

Thông báo và công việc nền đi qua **outbox_events**. Service ghi outbox trong cùng transaction với thay đổi nghiệp vụ. Worker có thể đọc các bản ghi chưa published sau khi commit. Cách này tránh việc “đã trừ tiền nhưng server chết trước khi gửi thông báo” mà không để lại dấu vết cần xử lý.

## 7.8. Commit không đồng nghĩa mọi việc bên ngoài đã xong

Transaction bảo vệ PostgreSQL, không thể tự rollback một SMS đã gửi hoặc một HTTP call đã nhận ở hệ thống khác. Vì vậy:

- dữ liệu nghiệp vụ và outbox được commit cùng nhau;
- worker gửi thông báo sau đó;
- outbox có attempts, next_attempt_at, lease và dead-letter metadata;
- task nền có thể retry;
- audit vẫn giữ lại sự kiện kể cả khi việc gửi thông báo thất bại.

## 7.9. Các lỗi cạnh tranh cần tưởng tượng

### Hai transfer cùng trừ một account

Request thứ hai chờ row lock. Sau khi request thứ nhất commit, request thứ hai đọc số dư mới; nếu không đủ tiền, nó rollback.

### Hai request cùng idempotency key

Một request insert PENDING trước. Request còn lại gặp conflict, khóa cùng row và nhận kết quả đã lưu hoặc chờ trạng thái hợp lệ.

### Quote hết hạn trong lúc submit

Submit khóa quote rồi kiểm tra expires_at và consumed_at. Nếu quote hết hạn, transfer không được tạo.

### Một bên account bị khóa

Service kiểm tra cả source và destination đều ACTIVE sau khi lock. Nếu một bên BLOCKED, toàn bộ transaction rollback.

## 7.10. Câu hỏi tự kiểm tra phần 7

1. Vì sao các repository trong transfer phải dùng cùng một client?
2. **FOR UPDATE** khác gì với một câu SELECT bình thường?
3. Nếu updateBalances không trả về hàng nào, những nguyên nhân nào có thể xảy ra?
4. Vì sao transaction retry không nên gửi SMS trực tiếp bên trong callback?
5. Outbox giúp khôi phục loại lỗi nào?

---

# 8. Các nhóm nghiệp vụ còn lại

Phần này mở rộng bản đồ từ account/transfer sang các bảng được tạo trong migration 007–040. Các ví dụ dữ liệu đều là dữ liệu giả, không lấy từ database chạy thật.

## 8.1. Đăng ký và KYC

### 8.1.1. Bảng pending_registrations

1. **Vai trò và ý nghĩa của một hàng:** giữ một hồ sơ đăng ký chưa hoàn tất, gồm thông tin liên hệ, password digest, device và thời hạn.
2. **Migration tạo/thay đổi:** [006_relational_v2_foundation.sql](backend/database/006_relational_v2_foundation.sql) tạo nền tảng; [007_identity_runtime_normalization.sql](backend/database/007_identity_runtime_normalization.sql) bổ sung chuẩn hóa và liên kết challenge.
3. **Cột quan trọng:** id UUID, full_name, email/phone, password_salt, password_digest, device_id, challenge_id, expires_at, created_at.
4. **Khóa/constraint/index:** id là khóa chính; email và phone có index unique không phân biệt hoa thường; thời hạn và trạng thái challenge bảo vệ đăng ký cũ.
5. **Quan hệ:** liên quan customer_devices và auth_challenges; khi hoàn tất, registration_completions nối hồ sơ này với customers và payment_accounts.
6. **File/class/method đọc/ghi:** [RelationalRegistrationService](backend/src/database/registrationService.ts) xử lý begin, verify và complete; [RelationalHttpBoundary](backend/src/database/relationalHttpBoundary.ts) nhận route; [server.ts](backend/src/server.ts) lắp các adapter relational.
7. **Ví dụ giả:** **pr-001**, email **lan@example.test**, device **dev-001**, expires_at sau 10 phút.
8. **Lỗi và cơ chế ngăn:** challenge hết hạn, sai OTP, thử quá số lần hoặc email trùng; constraint, rate_limit_buckets và auth challenge status chặn các trường hợp đó.

### 8.1.2. Bảng registration_completions

1. **Vai trò:** đánh dấu một pending registration đã tạo customer và account thành công.
2. **Migration:** [011_registration_recovery.sql](backend/database/011_registration_recovery.sql).
3. **Cột:** pending_registration_id, customer_id, account_id và thời gian hoàn tất.
4. **Khóa/constraint:** pending_registration_id là khóa chính; customer_id và account_id unique để retry không tạo bản ghi kép.
5. **Quan hệ:** nối pending_registrations → customers → payment_accounts.
6. **Code:** RelationalRegistrationService dùng nó trong bước complete/khôi phục idempotent.
7. **Ví dụ:** **pr-001** đã tạo **cust-001** và **acct-001**.
8. **Lỗi/ngăn:** request retry cố tạo customer lần hai; khóa unique trả conflict, service đọc kết quả đã hoàn tất.

### 8.1.3. Bảng auth_challenges

1. **Vai trò:** đại diện cho một thử thách xác thực cụ thể như đăng ký, đăng nhập, refresh, transfer hoặc card report.
2. **Migration:** 007 tạo nền; 015 hardening; 018 constraint method/purpose; 040 thêm CARD_REPORT_LOST.
3. **Cột:** id, customer_id, device_id, purpose, resource_id, fingerprint, methods, status, otp_hash, expires_at, attempts, max_attempts, resend_count.
4. **Khóa/constraint/index:** id chính; status terminal phải phù hợp với consumed_at; attempts/resend_count không âm; index challenge đang hoạt động theo customer/purpose.
5. **Quan hệ:** gắn với pending registration, mfa_credentials, auth_security_events và transfer/savings/credit step-up.
6. **Code:** auth/MFA service tạo challenge, verify proof và consume challenge; transfer service yêu cầu step-up theo control policy.
7. **Ví dụ:** **ch-001**, purpose TRANSFER, resource **tr-001**, methods TOTP, status CONSUMED.
8. **Lỗi/ngăn:** replay challenge đã dùng, OTP hết hạn hoặc thử quá nhiều; status/expiry/attempt constraints và code verify chặn.

### 8.1.4. Bảng kyc_applications

1. **Vai trò:** hồ sơ KYC của customer, từ SUBMITTED tới APPROVED hoặc REJECTED.
2. **Migration:** [020_admin_case_operations.sql](backend/database/020_admin_case_operations.sql) tạo; [038_customer_kyc_runtime.sql](backend/database/038_customer_kyc_runtime.sql) chuẩn hóa status và unique open case.
3. **Cột:** id, customer_id, status, applicant_label, applicant_fingerprint, synthetic_payload, assigned_staff_id, decision_reason, decision, version, submitted_at, decided_at.
4. **Khóa/constraint/index:** id chính; status chỉ nhận tập giá trị đã định; index customer+created; partial unique index ngăn hai hồ sơ đang mở cho cùng customer.
5. **Quan hệ:** customer có thể có lịch sử KYC; kyc_reviews, kyc_application_documents và case_assignments tham chiếu application.
6. **Code:** admin KYC routes/services đọc queue, ghi assignment/review/decision; **adminServer.ts** lắp AdminActionEngine.
7. **Ví dụ:** **kyc-001**, customer **cust-001**, status UNDER_REVIEW, assigned staff **staff-007**.
8. **Lỗi/ngăn:** hai nhân viên cùng quyết định hoặc hai case mở; version, status transition và unique open index giảm xung đột.

**Bài nhỏ — đăng ký → KYC**

~~~text
Mobile gửi thông tin đăng ký
  → pending_registrations + auth_challenges
  → xác minh challenge
  → registration_completions
  → customers + customer_devices + payment_accounts
  → tạo kyc_applications nếu quy trình yêu cầu
  → Admin review và cập nhật quyết định
~~~

Câu hỏi:

1. Vì sao đăng ký chưa xong không nên ghi ngay vào customers?
2. Bảng nào giúp retry hoàn tất không tạo customer thứ hai?
3. KYC application liên kết với customer bằng cột nào?
4. Vì sao cần version khi nhân viên Admin cập nhật case?

## 8.2. Xác thực, MFA và session

### 8.2.1. Refresh session families và records

Migrations 007 tạo **refresh_session_families** và **refresh_session_records**. Family là nhóm refresh token của một chuỗi đăng nhập; record là từng token/rotation. Token thật không lưu plaintext, chỉ lưu hash. Các cột expires_at, revoked_at, replaced_by và token_hash unique giúp phát hiện reuse và thu hồi cả family.

Luồng khái quát:

~~~text
login/refresh request
  → hash token
  → tìm refresh_session_record
  → kiểm tra family chưa revoke, token chưa hết hạn
  → rotate record, set replaced_by
  → cấp access/refresh token mới
~~~

Nếu token cũ bị dùng lại sau khi đã rotate, server có thể revoke family. Mobile chỉ giữ token theo chính sách client; PostgreSQL là nguồn trạng thái session.

### 8.2.2. Bảng mfa_credentials

1. **Vai trò:** lưu cấu hình credential MFA của customer, không lưu secret TOTP thô.
2. **Migration:** [014_mfa_credentials.sql](backend/database/014_mfa_credentials.sql), bổ sung constraint ở 018.
3. **Cột:** id, customer_id, credential_type TOTP/PASSKEY/OOB_SMS, display_name, status, secret_ciphertext, secret_key_version, algorithm, digits, period, last_accepted_at, enrolled_at, revoked_at.
4. **Khóa/constraint/index:** id chính; loại credential và status nằm trong enum/check; secret material phải đi qua ciphertext/key version; index credential active theo customer.
5. **Quan hệ:** auth_challenges tham chiếu method; recovery codes và security events liên quan cùng customer.
6. **Code:** PersistentMfaService và auth boundary đăng ký, verify, revoke credential.
7. **Ví dụ:** **mfa-001**, customer **cust-001**, type TOTP, status ACTIVE, digits 6, period 30.
8. **Lỗi/ngăn:** lưu secret plaintext, dùng credential đã revoke hoặc replay mã; ciphertext, status và last accepted timestamp giúp giảm rủi ro.

### 8.2.3. Bảng mfa_recovery_codes và mfa_recovery_requests

MFA recovery codes lưu code_digest và salt, chỉ dùng một lần với status ACTIVE/USED/REVOKED. Recovery request ghi quy trình khôi phục nhiều bước, risk score, reviewer và cooldown. Không thể dùng code đã USED vì trạng thái terminal được kiểm tra ở database và service.

### 8.2.4. Bảng auth_security_events

[017_auth_security_events.sql](backend/database/017_auth_security_events.sql) ghi login, refresh reuse, challenge failure, recovery và quyết định risk. Metadata là JSON object; index theo customer/time, event type/time, device/time. Đây là audit chuyên cho security, khác với audit_events nghiệp vụ.

Câu hỏi:

1. Tại sao database lưu token hash thay vì token thật?
2. Credential MFA và auth challenge khác nhau ở điểm nào?
3. Khi refresh token cũ bị dùng lại, family có thể bị xử lý ra sao?
4. Vì sao auth_security_events không thay thế audit_events?

## 8.3. Người thụ hưởng, tra cứu người nhận, thông báo và fraud

### 8.3.1. Bảng beneficiaries

1. **Vai trò:** danh bạ người thụ hưởng do customer lưu để dùng lại khi chuyển tiền.
2. **Migration:** 001 tạo; 005 thêm destination/owner snapshot; 036 thêm deleted_at và status DELETED.
3. **Cột:** id, customer_id, display_name, account_number_masked, destination_account_fingerprint, bank_name, beneficiary_holder_name, destination_account_id, status, deleted_at.
4. **Khóa/constraint/index:** id chính, customer_id FK; unique active theo customer+fingerprint+bank; partial index chỉ tính hàng chưa deleted.
5. **Quan hệ:** customer sở hữu beneficiary; transfer_quote có thể tham chiếu beneficiary và snapshot thông tin tại thời điểm quote.
6. **Code:** beneficiary service tạo/list/delete; TransferService nhận beneficiaryId hoặc account lookup rồi xác nhận ownership.
7. **Ví dụ:** **ben-001**, owner **cust-001**, bank **BANK-A**, fingerprint **fp-demo-01**, status ACTIVE.
8. **Lỗi/ngăn:** customer dùng beneficiary của người khác hoặc tạo bản sao đang active; FK, ownership query và partial unique index ngăn.

### 8.3.2. Bảng recipient_lookups

[031_remaining_relational_v2.sql](backend/database/031_remaining_relational_v2.sql) tạo token tra cứu người nhận. Token được lưu dạng hash, có destination fingerprint, owner name/masked number, bank, status và expires_at. Đây là dữ liệu tạm thời cho bước “tra cứu người nhận”, không phải danh bạ vĩnh viễn.

### 8.3.3. Bảng notifications và outbox_events

Notification là bản ghi hướng tới customer; outbox là hàng đợi sự kiện nội bộ. 012 bổ sung endpoint, preference, delivery, lease và dead-letter để worker gửi nhiều kênh. Notification có thể có type TRANSFER, SECURITY, SAVINGS hoặc CREDIT. Outbox có aggregate_id, event_version, priority, status và attempts để retry.

### 8.3.4. Fraud reports

fraud_reports liên kết customer, account và transaction; trạng thái RECEIVED → IN_REVIEW → RESOLVED. Migration 031 thêm fraud_report_idempotency và unique open report; 020 bổ sung case/action cho Admin; 040 thêm retry/suspense liên quan. Một report không tự ý hoàn tiền: nó tạo hồ sơ xử lý và các bước kiểm soát.

**Luồng minh họa:**

~~~text
Customer tra cứu beneficiary
  → recipient_lookups (token hash, expires)
  → tạo quote với destination snapshot
  → submit transfer
  → transfer + audit + outbox
  → worker tạo notification/delivery
  → nếu nghi ngờ: fraud_report + Admin case
~~~

Câu hỏi:

1. Vì sao quote giữ snapshot tên người nhận thay vì chỉ đọc lại beneficiary?
2. Beneficiary bị xóa mềm khác gì xóa vật lý?
3. Outbox và notification có phải cùng một bảng không?
4. Vì sao fraud report cần idempotency?

## 8.4. Tiết kiệm

### 8.4.1. Bảng savings_products

1. **Vai trò:** danh mục sản phẩm tiết kiệm, kỳ hạn và lãi suất.
2. **Migration:** [002_savings_sandbox.sql](backend/database/002_savings_sandbox.sql) tạo nền; [029_savings_products_relational_v2.sql](backend/database/029_savings_products_relational_v2.sql) seed sản phẩm.
3. **Cột:** id, product_code, name, term_months, annual_rate, currency, min_principal, max_principal, status, terms_version, effective times.
4. **Khóa/constraint/index:** product_code unique; term chỉ 1/3/6/12; số tiền không âm và min ≤ max; status ACTIVE/INACTIVE.
5. **Quan hệ:** savings_quotes và savings_deposits tham chiếu product.
6. **Code:** RelationalSavingsService tạo quote/opening/maturity; SavingsRepository đọc sản phẩm active.
7. **Ví dụ:** **SAVE-3M**, 3 tháng, lãi suất giả 0.045, VND.
8. **Lỗi/ngăn:** mở sản phẩm đã ngừng bán hoặc principal ngoài range; status/check constraint và service validation chặn.

### 8.4.2. Bảng savings_quotes

1. **Vai trò:** báo giá bất biến trong thời gian ngắn cho một lần mở tiết kiệm.
2. **Migration:** [002_savings_sandbox.sql](backend/database/002_savings_sandbox.sql), [009_savings_relational_v2.sql](backend/database/009_savings_relational_v2.sql).
3. **Cột:** customer_id, source_account_id, product_id, principal, rate, interest, expected_total, term_months, instruction, expires_at, consumed_at, request_fingerprint.
4. **Khóa/constraint/index:** id chính; principal/interest/total không âm; total ≥ principal; instruction nằm trong ba lựa chọn; active quote index.
5. **Quan hệ:** quote được consume bởi savings_openings; source account và product là FK.
6. **Code:** RelationalSavingsService.createQuote và openDeposit đọc/khóa quote.
7. **Ví dụ:** principal 10,000,000 minor units giả định theo VND, expires sau 5 phút.
8. **Lỗi/ngăn:** dùng quote hai lần hoặc đổi dữ liệu request; consumed_at, unique quote và fingerprint chặn.

### 8.4.3. Bảng savings_deposits, savings_openings và maturity operations

savings_deposits là hợp đồng đã mở; savings_openings là command idempotent để tạo deposit; savings_maturity_operations bảo đảm một lần đáo hạn/renewal cho mỗi deposit và operation key. Migration 039 thêm suspense khi không thể hoàn tất maturity. Account transaction có FK savings_opening/deposit để truy vết dòng tiền.

Luồng:

~~~text
createQuote
  → savings_quotes
open
  → savings_openings PENDING
  → lock quote + source account
  → trừ tiền / ghi account transaction
  → create savings_deposit
  → consume quote, opening SUCCEEDED
maturity
  → savings_maturity_operations
  → renew hoặc trả principal + interest
  → nếu lỗi: savings_maturity_suspense
~~~

Câu hỏi:

1. Vì sao savings_quote không phải là savings_deposit?
2. Bảng nào bảo vệ thao tác mở tiết kiệm khỏi retry?
3. Khi đáo hạn không thể tự động trả tiền, dữ liệu nào giúp không mất việc?
4. Product status INACTIVE ảnh hưởng quote mới như thế nào?

## 8.5. Tín dụng và thẻ

### 8.5.1. Bảng credit_accounts

1. **Vai trò:** hạn mức và dư nợ của một customer.
2. **Migration:** [003_credit_sandbox.sql](backend/database/003_credit_sandbox.sql), [010_credit_relational_v2.sql](backend/database/010_credit_relational_v2.sql), 030 và 035 bổ sung lifecycle/cycle.
3. **Cột:** customer_id, credit_limit, posted_outstanding, pending_authorized_outstanding, next_statement_at, cycle_start/cursor, status, version.
4. **Khóa/constraint/index:** một credit account active/duy nhất cho customer; limit > 0; outstanding không âm; version tăng khi cập nhật.
5. **Quan hệ:** credit_cards, credit_statements, credit_transactions, credit_payments tham chiếu.
6. **Code:** RelationalCreditService và CreditRepository xử lý purchase, statement, payment và lifecycle.
7. **Ví dụ:** limit 50,000,000 giả, posted outstanding 4,000,000, status ACTIVE.
8. **Lỗi/ngăn:** thanh toán vượt số tiền hợp lệ hoặc purchase vượt hạn mức; quote/payment policy, check constraint và version bảo vệ.

### 8.5.2. Bảng credit_statements và credit_transactions

Statement là kỳ sao kê; transaction là từng purchase/refund/payment/fee/interest/adjustment. statement_items nối transaction với statement. Cả hai dùng amount không âm, status rõ ràng và index theo account/time. Một transaction có thể làm tăng, giảm hoặc không đổi debt_effect.

### 8.5.3. Bảng credit_payment_quotes và credit_payments

Quote khóa số tiền/phí và statement_version trong thời gian ngắn. Payment là command thực tế, có idempotency key, fingerprint, reference và status. Migration 010 tạo; 030 gắn application/lifecycle; account_transactions có credit_payment_id để truy vết tiền từ payment account sang credit account.

Luồng:

~~~text
xem statement
  → create payment quote
  → customer xác nhận
  → reserve idempotency
  → lock credit account + statement + source account
  → ghi credit payment + account transaction
  → cập nhật outstanding/version
  → outbox notification
~~~

Câu hỏi:

1. Vì sao payment quote cần statement_version?
2. credit_transaction và account_transaction khác nhau ở đâu?
3. Một purchase làm debt_effect INCREASE còn payment làm DECREASE vì sao?
4. Nếu credit payment request retry, bảng nào trả kết quả cũ?

## 8.6. Admin và các thao tác cần phê duyệt

### 8.6.1. Bảng staff_users, roles và permissions

1. **Vai trò:** mô hình nhân viên Admin và quyền thao tác.
2. **Migration:** [019_admin_control_plane.sql](backend/database/019_admin_control_plane.sql), [022_admin_policy_alignment.sql](backend/database/022_admin_policy_alignment.sql).
3. **Cột:** staff_users có employee_id/email/status/authorization_version; staff_roles, permissions, role_permissions, staff_user_roles tạo quan hệ many-to-many.
4. **Khóa/constraint/index:** employee/email unique; status và role permission hợp lệ; authorization_version dùng để vô hiệu hóa session cũ.
5. **Quan hệ:** staff user có nhiều role, role có nhiều permission; action request tham chiếu requester.
6. **Code:** **adminServer.ts**, StaffAuthService và AdminActionEngine.
7. **Ví dụ:** **staff-007** có role REVIEWER với permission KYC_REVIEW.
8. **Lỗi/ngăn:** staff bị khóa nhưng session cũ còn dùng; status + authorization_version + session revoke chặn.

### 8.6.2. Bảng admin_action_requests

1. **Vai trò:** hàng đợi thao tác Admin có policy, fingerprint, phê duyệt và execution state.
2. **Migration:** 019 tạo; 023–025 bổ sung RLS/scope; 024 thêm staff invite policy.
3. **Cột:** action_type, requester, target, request_fingerprint, policy, risk, approvals, status, idempotency_key, expected_target_version, expires_at, result/failure, version.
4. **Khóa/constraint/index:** unique requester+idempotency; status transition; queue index cho PENDING; version ngăn cập nhật lệch.
5. **Quan hệ:** decisions, execution_attempts, status histories và typed detail tables.
6. **Code:** AdminActionEngine tạo/approve/execute; admin routes đọc kết quả.
7. **Ví dụ:** yêu cầu khóa account **acct-001**, status PENDING_APPROVAL, cần hai approver.
8. **Lỗi/ngăn:** requester tự duyệt, target đã đổi, execute hai lần; policy, separation of duties, expected version và idempotency bảo vệ.

### 8.6.3. Các bảng case và background job

kyc_reviews, case_assignments, case_internal_notes và fraud_case_actions giữ chi tiết xử lý; background_jobs, job_attempts, retry_history giữ công việc nền. RLS trong migration 023–025 giới hạn row mà staff được thấy. Audit trigger append-only bảo vệ lịch sử.

Câu hỏi:

1. Vì sao permission không nên hard-code chỉ trong UI Admin?
2. admin_action_requests khác trực tiếp UPDATE customers như thế nào?
3. expected_target_version bảo vệ tình huống nào?
4. RLS bổ sung gì ngoài kiểm tra quyền ở service?




# 9. Migration, constraint, index và quyền database

## 9.1. Migration là lịch sử thay đổi schema

Schema hiện tại không chỉ nằm trong file 001. Nó là kết quả của việc áp dụng lần lượt 001 đến 040. Có thể hình dung:

~~~text
schema rỗng
  → 001 banking MVP
  → 002 savings
  → 003 credit
  → 004 policy bổ sung
  → 005 relational reference runtime
  → 006 foundation + idempotency
  → 007 identity/session/challenge
  → 008 transfer hardening
  → 009 savings idempotency/maturity
  → 010 credit idempotency
  → 011 registration recovery
  → 012–018 outbox/MFA/security
  → 019–028 Admin, RLS, DR, secret metadata
  → 029–033 product, lifecycle, policy
  → 034–040 entitlement, KYC, suspense, card security
  → schema hiện tại
~~~

[backend/database/README.md](backend/database/README.md) ghi rõ migration runner áp dụng theo thứ tự số và kiểm tra checksum. Vì vậy không nên sửa nội dung một migration đã chạy rồi để “sửa nhanh”. Nếu schema cần thay đổi, thêm migration mới ở cuối.

## 9.2. Runner kiểm tra điều gì?

[apply-migration.cjs](backend/scripts/apply-migration.cjs) và [runtimeMetadata.ts](backend/src/runtimeMetadata.ts) dùng các ý tưởng sau:

1. tìm file có tên theo mẫu số + tên + .sql;
2. sắp xếp theo số tăng dần;
3. đọc SQL và chuẩn hóa newline;
4. tính digest từ tên file và nội dung canonical;
5. ghi trạng thái migration/checksum;
6. từ chối khi checksum của migration đã áp dụng bị đổi;
7. chạy migration mới trong transaction hoặc theo contract của runner;
8. báo schema version là migration cuối cùng.

Điều này trả lời câu hỏi “database đang ở phiên bản nào?” mà không cần đoán từ code. **schemaVersion** là khóa migration cuối; **migrationSetDigest** là dấu vân tay của toàn bộ tập migration.

## 9.3. Vì sao migration có backfill?

Một migration không chỉ CREATE TABLE. Nhiều migration làm ba bước:

~~~text
1. ADD COLUMN cho phép NULL tạm thời
2. UPDATE backfill dữ liệu cũ
3. ALTER COLUMN SET NOT NULL / ADD CONSTRAINT
~~~

Ví dụ:

- 005 bổ sung account_number và destination snapshot;
- 006 đánh số account và làm request_fingerprint không NULL;
- 007 backfill refresh families, rate limits;
- 037 backfill destination_owner_name từ snapshot/customer;
- 038 backfill trạng thái KYC sang tên chuẩn;
- 039 tạo suspense cho lifecycle cần xử lý.

Nếu bước backfill không an toàn, constraint mới có thể làm migration fail. Vì thế source SQL và test migration phải được đọc cùng nhau.

## 9.4. Constraint bảo vệ dữ liệu tại chỗ

### 9.4.1. Primary key

Primary key định danh một hàng. Ví dụ customers.id, payment_accounts.id, transfer_quotes.id. Một object từ API có thể bị sửa id, nhưng database không cho hai row dùng cùng id.

### 9.4.2. Foreign key

Foreign key bảo đảm liên kết trỏ tới hàng tồn tại, trừ các cột nullable có chủ ý. Ví dụ:

- payment_accounts.customer_id → customers.id;
- account_transactions.account_id → payment_accounts.id;
- transfers.source_account_id/destination_account_id → payment_accounts.id;
- ledger_entries.journal_id → ledger_journals.id.

Nếu xóa customer mà còn account, FK sẽ chặn hoặc áp dụng hành vi đã định. Đây là lớp bảo vệ độc lập với TypeScript.

### 9.4.3. CHECK

CHECK biểu diễn luật đơn giản:

~~~sql
available_balance_minor >= 0
amount_minor > 0
fee_minor >= 0
version >= 0
currency = 'VND'
~~~

Service vẫn phải validate input để trả lỗi dễ hiểu, nhưng database là chốt cuối. Hai lớp không thay thế nhau.

### 9.4.4. UNIQUE và partial unique

Unique bảo đảm không có hai giá trị trùng. Một số luật chỉ áp dụng cho hàng đang hoạt động nên dùng partial unique index:

~~~sql
CREATE UNIQUE INDEX ...
ON beneficiaries(customer_id, destination_account_fingerprint, bank_name)
WHERE status <> 'DELETED';
~~~

Nhờ đó customer có thể giữ lịch sử beneficiary đã xóa nhưng không có hai bản ghi active cùng người nhận.

### 9.4.5. Deferred constraint và ledger

Ledger có trigger/constraint deferred: trong lúc đang INSERT, có thể journal chưa đủ entry; tới COMMIT database kiểm tra:

- journal có ít nhất hai entry;
- tổng debit bằng tổng credit;
- mọi entry cùng currency;
- journal không rỗng.

Đây là lý do ledger journal + entries phải được ghi trong cùng transaction.

## 9.5. Index: mục lục phục vụ truy vấn nào?

Index không tạo ra nghiệp vụ mới; nó làm truy vấn đã có chạy nhanh hơn.

| Index/nhóm cột | Truy vấn phục vụ | Vì sao |
| --- | --- | --- |
| customers lower(email), lower(phone) | đăng nhập/đăng ký theo email/phone | tìm không phân biệt hoa thường và chặn trùng |
| payment_accounts(customer_id) | listAccounts/customer ownership | lọc account của một customer |
| account_transactions(account_id, occurred_at DESC, id DESC) | lịch sử giao dịch và cursor | đọc trang mới nhất theo keyset |
| transfer_quotes(customer_id, expires_at) | tìm quote active/hết hạn | tránh quét toàn bảng quote |
| transfers(customer_id, created_at DESC) | lịch sử transfer | phục vụ danh sách theo thời gian |
| outbox(status, next_attempt_at, priority, occurred_at) | worker claim event | lấy việc đến hạn theo ưu tiên |
| auth_challenges(customer_id, purpose, status) | verify challenge đang active | tìm đúng challenge nhanh |
| notifications(customer_id, created_at DESC) | màn hình thông báo | đọc notification mới nhất |
| savings_deposits(status, maturity_at) | worker đáo hạn | lấy deposit đến hạn |
| credit_statements(status, due_at) | nhắc thanh toán | tìm statement sắp/quá hạn |
| admin_action_requests(status, queue timestamps) | Admin queue | hiển thị việc cần xử lý |
| rate_limit_buckets(key, window) | rate limiting | cập nhật bucket đúng cửa sổ |

Nếu index không khớp WHERE/ORDER BY, PostgreSQL vẫn có thể phải scan nhiều row. Ngược lại, thêm quá nhiều index làm INSERT/UPDATE chậm và tốn disk.

## 9.6. Offset và keyset pagination

AccountRepository.listTransactions không chỉ dùng LIMIT. Nó lấy limit + 1 row, sắp xếp theo occurred_at DESC, id DESC và dùng cursor:

~~~sql
SELECT ...
FROM account_transactions
WHERE account_id = $1
  AND (occurred_at, id) < ($2, $3)
ORDER BY occurred_at DESC, id DESC
LIMIT $4
~~~

- lấy dư một row để biết còn trang sau;
- cursor chứa mốc thời gian và id của row cuối;
- cặp cột tránh mất row khi hai giao dịch có cùng occurred_at;
- index tương ứng giúp trang sau không phải bỏ qua hàng nghìn row như OFFSET lớn.

## 9.7. Quyền, role và Row-Level Security

Migrations 023–025 tạo role/grant và RLS cho vùng Admin/case. Có ba lớp cần phân biệt:

1. **Database role/grant:** connection được phép SELECT/INSERT/UPDATE bảng nào.
2. **Service authorization:** StaffAuthService/AdminActionEngine quyết định staff có permission cho action hay không.
3. **RLS policy:** ngay cả khi query quên thêm điều kiện, PostgreSQL giới hạn row theo tenant/scope/session context.

RLS không thay thế service authorization. Service quyết định “được làm hành động gì”; RLS giúp giới hạn “được thấy/chạm hàng nào”.

## 9.8. Append-only và audit

audit_events, ledger và một số bảng history không nên bị update tùy ý. Migration 020 có trigger append-only cho audit. Mục tiêu là sau khi ghi, điều tra viên có thể biết chuyện gì đã xảy ra, actor nào, resource nào và payload nào tại thời điểm đó.

Không ghi password, token, OTP, PIN, CVV hoặc secret vào audit payload. Hash/fingerprint hoặc metadata đã redact mới phù hợp.

## 9.9. Migration và môi trường

README database mô tả đây là reference sandbox. Cần phân biệt:

- migration validation: kiểm tra thứ tự/checksum/schema;
- disposable PostgreSQL test: kiểm tra áp dụng từ database rỗng;
- integration test: kiểm tra service + repository;
- staging/production: cần backup, monitoring, approval và policy khác.

Không chạy migration hoặc ghi dữ liệu chỉ để đọc tài liệu này. Trong phiên tạo tài liệu, chỉ đọc source và migration.

## 9.10. Câu hỏi tự kiểm tra phần 9

1. Vì sao không sửa nội dung migration 001 sau khi đã áp dụng?
2. Partial unique index của beneficiary giải quyết tình huống nào?
3. Foreign key và validation ở service khác nhau như thế nào?
4. Index account_transactions hỗ trợ cursor ra sao?
5. RLS bổ sung gì ngoài role/grant và StaffAuthService?

---

# 10. Bài tập tổng hợp

Các bài dưới đây dùng id và số tiền giả. Mục tiêu là tập tự tìm bảng, quan hệ, method và trạng thái trước/sau thao tác.

## Bài 1 — Tìm bảng từ chức năng “xem tài khoản”

**Đề bài:** Customer có customerId **cust-001** mở màn hình tài khoản.

Hãy trả lời:

1. Bảng nào chứa quyền sở hữu account?
2. Điều kiện SQL nào ngăn customer xem account người khác?
3. Object database được map thành object TypeScript ở đâu?
4. Có cần transaction không nếu chỉ đọc?

**Gợi ý đáp án:**

- payment_accounts có customer_id;
- query ownership dùng **WHERE id = $1 AND customer_id = $2**;
- AccountRepository map snake_case sang camelCase, service map tiếp thành PaymentAccount;
- code hiện tại vẫn dùng UnitOfWork cho đường đọc relational để có một client/đường truy cập thống nhất, dù read-only không có COMMIT thay đổi nghiệp vụ.

## Bài 2 — Dự đoán dữ liệu trước và sau khi xem số tài khoản

**Trước:** account A001 có account_number đã cấp, customer C001 sở hữu. Audit chưa có event mới.

**Thao tác:** gọi getAccountNumber(C001, A001).

**Hãy dự đoán:**

1. account row có bị đổi không?
2. bảng audit_events có thêm gì?
3. Nếu C002 gọi cùng accountId thì kết quả gì?

**Gợi ý đáp án:**

- account_number không đổi;
- service append event ACCOUNT_NUMBER_REVEALED với actor C001/resource A001;
- C002 bị từ chối vì findOwnedAccount yêu cầu cả id và customer_id.

## Bài 3 — Trace tạo quote chuyển tiền

**Input giả:**

~~~json
{
  "customerId": "cust-001",
  "sourceAccountId": "acct-a",
  "destinationAccountId": "acct-b",
  "amount": { "currency": "VND", "amountMinor": "100000" },
  "idempotencyKey": "quote-key-01"
}
~~~

Hãy liệt kê:

1. account nào phải ACTIVE;
2. vì sao source không được bằng destination;
3. bảng nào giữ expires_at và request_fingerprint;
4. kết quả trả cho Mobile có phải transfer receipt không.

**Gợi ý đáp án:**

- source và destination đều phải ACTIVE;
- self-transfer không phù hợp policy/luồng ledger hiện tại;
- transfer_quotes giữ expires_at và request_fingerprint;
- kết quả là quote, chưa phải transfer đã commit.

## Bài 4 — Trace submit transfer thành công

**Dữ liệu giả trước:**

| Row | available | current | version |
| --- | ---: | ---: | ---: |
| acct-a | 1,000,000 | 1,000,000 | 4 |
| acct-b | 200,000 | 200,000 | 7 |

Amount là 100,000, fee là 1,000.

Hãy điền thay đổi chính:

1. số dư A sau transfer;
2. số dư B sau transfer;
3. số account_transactions;
4. ledger debit và credit;
5. transfer status;
6. outbox status ngay sau COMMIT.

**Gợi ý đáp án:**

- A available/current giảm 101,000;
- B available/current tăng 100,000;
- có ít nhất hai account_transactions: DEBIT ở A và CREDIT ở B;
- ledger có debit 101,000 ở source, credit 100,000 ở destination và credit 1,000 vào fee income;
- transfer là SUCCEEDED trong happy path;
- outbox đã được ghi nhưng worker có thể chưa publish nên status/published chưa đồng nghĩa notification đã gửi.

## Bài 5 — Hai request cạnh tranh

**Tình huống:** hai request cùng dùng source A001 và cùng idempotency key.

Hãy giải thích:

1. request nào insert command_idempotency trước;
2. request sau đọc gì;
3. vì sao không tạo hai transfer;
4. nếu fingerprint khác thì sao.

**Gợi ý đáp án:**

- request thắng insert tạo PENDING;
- request sau gặp conflict, khóa row và đọc status/response;
- unique key + transaction + status khiến chỉ một transfer chính thức;
- fingerprint khác bị reject vì cùng key không được đại diện cho request khác.

## Bài 6 — Chọn bảng cho chức năng mở tiết kiệm

**Đề bài:** Customer chọn sản phẩm SAVE-3M và muốn gửi 10,000,000 minor units.

Hãy nối:

~~~text
savings_products
→ savings_quotes
→ savings_openings
→ savings_deposits
→ account_transactions
~~~

Giải thích tại sao mỗi bước cần bảng riêng và bảng nào bảo vệ retry.

**Gợi ý đáp án:**

- product là điều khoản được cung cấp;
- quote là giá/kỳ hạn tạm thời có expiry;
- opening là command idempotent;
- deposit là hợp đồng đã mở;
- account_transactions là dấu vết tiền rời account;
- savings_openings + unique customer/idempotency key bảo vệ retry.

## Bài 7 — Tìm lỗi bảo mật trong thiết kế giả

**Thiết kế giả:** API nhận accountId rồi chạy SELECT * FROM payment_accounts WHERE id = $1.

Hãy chỉ ra:

1. thiếu điều kiện gì;
2. lỗi thuộc lớp nào;
3. query thật trong AccountRepository sửa ra sao.

**Gợi ý đáp án:**

- thiếu customer_id/actor ownership;
- đây là lỗi authorization/IDOR, không chỉ là lỗi UI;
- query thật dùng **WHERE id = $1 AND customer_id = $2**, sau đó service mới map/return.

## Bài 8 — Migration mới có an toàn không?

**Đề bài:** muốn thêm cột non-null vào payment_accounts.

Hãy viết kế hoạch ba bước:

1. thêm cột;
2. backfill;
3. thêm constraint/index.

**Gợi ý đáp án:**

- kiểm tra dữ liệu cũ và đặt default hoặc nullable tạm thời;
- backfill trong migration có thể chạy trên database rỗng và database nâng cấp;
- kiểm tra không còn NULL/giá trị sai rồi SET NOT NULL, ADD CHECK/INDEX;
- không sửa migration cũ; tạo số migration tiếp theo và cập nhật test/checksum.

## Bài 9 — Bài tự vẽ sơ đồ

Tự vẽ sơ đồ cho Admin phê duyệt KYC, tối thiểu phải có:

~~~text
staff_users / roles / permissions
          ↓
admin_action_requests
          ↓
decisions + execution_attempts
          ↓
kyc_applications + kyc_reviews
          ↓
audit_events
~~~

Sau đó thêm RLS, status history và background_jobs vào vị trí phù hợp.

## Bài 10 — Tự kiểm tra cuối Giai đoạn 7

1. Một row trong payment_accounts đại diện cho điều gì?
2. Quote, command idempotency và transfer khác nhau thế nào?
3. Vì sao account_transactions chưa đủ để chứng minh ledger cân bằng?
4. Khi nào cần FOR UPDATE, khi nào version giúp phát hiện conflict?
5. Migration runner dùng checksum để ngăn lỗi gì?
6. Outbox khác notification ở đâu?
7. RLS, service authorization và database grant mỗi lớp giải quyết điều gì?
8. Nếu phải thêm field vào account, bạn sẽ tìm migration, repository, service, boundary và test theo thứ tự nào?

## Bản đồ học tiếp

Sau khi làm bài tập, hãy tự chọn một dòng dữ liệu và lần theo ba lớp:

~~~text
migration/schema
  → repository SQL
  → service/business rule
  → boundary/API hoặc Mobile/Admin UI
~~~

Nếu chưa trả lời được một câu, quay lại đúng bảng hoặc method liên quan thay vì đọc toàn bộ repository lại từ đầu. Giai đoạn 8 sẽ dùng các quan hệ này để học authentication, authorization và security; đặc biệt là vì sao biết accountId vẫn chưa đủ để được phép xem hoặc thay đổi account đó.

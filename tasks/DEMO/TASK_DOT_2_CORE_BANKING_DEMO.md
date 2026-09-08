# Đợt 2 — Demo ngân hàng cốt lõi

## Trạng thái

`COMPLETED — CORE BANKING DEMO — OWNER APPROVED`

Đây là bằng chứng local cho đồ án học thuật dùng dữ liệu synthetic và tiền ảo.
Không phải bằng chứng pilot, production hoặc tích hợp ngân hàng thật.

- Repository: `C:\\Projects\\banking-system`
- Branch: `codex/staging-academic-completion`
- Snapshot thực thi: `3b38cabc39c9254231e5ef0ccb90e2ae278a532f`
- Thời điểm: `2026-09-08`, Asia/Bangkok
- Phạm vi: Mobile emulator, Admin Web, Public/Admin API local và PostgreSQL local riêng cho demo
- Không ghi credential, OTP/TOTP secret, recovery code, token, database URL, account number hoặc identity synthetic đầy đủ vào hồ sơ này.

## 1. Mục tiêu và môi trường

Đợt này kiểm chứng một luồng ngân hàng mô phỏng có quyền maker–checker, cấp tiền ảo,
MFA step-up, chuyển tiền nội bộ và đối soát relational. Database demo được tạo riêng từ
PostgreSQL 16 local, đã áp dụng migration chuẩn `001–040`, và được giữ lại để Owner
tiếp tục xem demo. Không dùng `banking_test`, `banking_preview` hoặc database remote.

Dịch vụ local đang giữ để demo:

- Public Backend: `127.0.0.1:5000`
- Admin Backend: `127.0.0.1:5001`
- Admin Web: `127.0.0.1:5173`
- Email capture: `127.0.0.1:5700`
- Invitation capture: `127.0.0.1:8025`
- Android emulator: `emulator-5554`, ứng dụng `com.example.digitalbanking.mobile`

Database/container identity và password được giữ ngoài tài liệu. Không có image hoặc
dependency mới được tải xuống.

## 2. Luồng demo đã thực hiện

### 2.1. Customer và KYC

- Tạo hai customer synthetic A và B, hoàn tất registration/KYC submission.
- Dùng Admin Web với staff maker để claim/propose hồ sơ B.
- Dùng staff checker độc lập để approve hồ sơ B; Approval Inbox trở về empty.
- Hồ sơ A cũng ở trạng thái approved trước khi chạy funding/transfer.
- Maker và checker là hai principal khác nhau; không bypass maker–checker.

### 2.2. Sandbox funding

- Maker request funding cho A: `10,000,000 VND` minor units, reason đã redact.
- Checker approve qua Admin Web và staff step-up TOTP.
- Approval Inbox sau thao tác: empty.
- A đăng nhập Mobile và Home hiển thị số dư funding trước chuyển tiền.

### 2.3. MFA và chuyển tiền

- A thiết lập TOTP trên Mobile, acknowledge recovery codes; phiên bị thu hồi theo
  contract và A đăng nhập lại thành công.
- Tra cứu B bằng internal recipient lookup trực tiếp trên Mobile. Không dùng endpoint
  cấp tiền mới và không cập nhật balance trực tiếp bằng SQL.
- Quote thực tế cho luồng happy path trả fee `1,000 VND`.
- Transfer A → B `500,000 VND` qua quote → TOTP step-up → submit; Mobile hiển thị
  receipt thành công.
- Một transfer bổ sung `5,000,000 VND` được thực hiện có chủ đích để đưa số dư A
  xuống dưới ngưỡng thử insufficient-funds; fee thực tế thêm `1,000 VND`.
- Một lần thử `5,000,000 VND` sau đó bị từ chối với chỉ dấu UI đã sanitize là
  insufficient funds. Không phát sinh thêm transfer, transaction hoặc ledger row.

## 3. Đối soát PostgreSQL sau luồng demo

Các truy vấn chỉ trả metadata/count/số tiền synthetic cần cho đối soát; không xuất
credential, URL, identity đầy đủ hoặc ID runtime.

| Hạng mục | A | B |
| --- | ---: | ---: |
| Available balance (minor VND) | 4,498,000 | 5,500,000 |
| Current balance (minor VND) | 4,498,000 | 5,500,000 |
| Funding credit | 10,000,000 | — |
| Transfer debit/credit amount | 5,500,000 debit | 5,500,000 credit |
| Transfer fee | 2,000 | — |
| Account-transaction rows | 3 | 2 |

Relational evidence:

- `transfers` của A: 2 rows, status `SUCCEEDED`, tổng amount `5,500,000`, tổng fee
  `2,000`.
- `account_transactions`: A có 1 funding credit và 2 transfer debit; B có 2 transfer
  credit; các row đều ở trạng thái `SUCCEEDED`.
- `ledger_journals`: 3 journals; 2 transfer journals liên kết với 2 transfer của A.
- `ledger_entries`: CREDIT 5 rows / `15,502,000`; DEBIT 3 rows / `15,502,000`.
  Ledger cân bằng.
- Lần insufficient-funds không tạo thêm row và không làm thay đổi hai balance trên.
- A có 2 command-idempotency records tương ứng với 2 transfer đã gửi.
- Recipient lookup đã chạy; flow này không tạo saved-beneficiary record (`0` active
  saved beneficiary), vì acceptance cho phép internal lookup thay cho lưu beneficiary.

## 4. Bằng chứng UI và trạng thái acceptance

| Checkpoint | Kênh bằng chứng | Kết quả |
| --- | --- | --- |
| Customer A/B registration và KYC submit | Mobile UI + Admin Web | PASS |
| Maker propose và checker độc lập approve KYC | Admin Web | PASS |
| Maker request và checker approve funding A | Admin Web + step-up | PASS |
| A login, Home balance, TOTP enrollment/re-login | Mobile emulator | PASS |
| Internal lookup B | Mobile emulator | PASS |
| Quote, fee, TOTP step-up, receipt | Mobile emulator | PASS |
| Insufficient funds, không partial ledger | Mobile UI + PostgreSQL read-only reconciliation | PASS |
| A/B final balances và histories | Mobile login/Home; history đối soát ở PostgreSQL | PASS |
| Replay cùng idempotency key/payload | Chưa chạy trong UI flow này | NOT VERIFIED |
| Customer cross-account denial bằng negative action | Chưa chạy negative action riêng | NOT VERIFIED |
| Explicit maker self-approve rejection | Chưa chạy negative action riêng; chỉ có checker độc lập approve | NOT VERIFIED |

`NOT VERIFIED` không được suy ra thành PASS từ source, số dư hoặc một giao dịch thành
công. Các contract/idempotency implementation hiện có là supporting evidence, không
thay thế execution của ba negative controls trên.

## 5. Data flow và lỗi

```text
Mobile request
  → Public API / relational-v2 service
  → PostgreSQL transaction (balance + account transaction + ledger + outbox)
  → Mobile state/receipt
  → read-only DB reconciliation
```

- Happy path: request → quote/step-up state → accepted receipt → A/B balances và
  ledger cập nhật nhất quán.
- Insufficient funds: request → quote/step-up → server rejection → UI error state;
  không có partial write.
- Funding/KYC: Admin request → pending approval → independent checker decision →
  customer/account state.

## 6. Kiểm tra và giới hạn

- Không sửa source, migration, API contract hoặc harness trong phiên demo.
- Không chạy lại M07-A2; M07-A2 đã có bằng chứng hoàn tất từ snapshot trước đó.
- Không tạo test/helper/protocol mới.
- Không có dependency/config/API change mới.
- Không chạy lại full quality suite chỉ để tạo báo cáo; source snapshot không đổi.
- Evidence là local/emulator/PostgreSQL reference evidence, không phải device thật,
  staging hoặc production evidence.
- Saved-beneficiary CRUD chưa được dùng; internal lookup là nhánh được chấp nhận.
- Idempotency replay, cross-account denial và explicit self-approval denial cần Owner
  quyết định có mở một lượt kiểm chứng riêng hay chấp nhận giới hạn học thuật.

## 7. Trạng thái bàn giao

Core banking demo happy path đã sẵn sàng để Owner xem trực tiếp trên emulator và
Admin Web; database demo và các dịch vụ local được giữ chạy. Do ba negative controls
chưa có execution evidence riêng, hồ sơ chưa tự đánh dấu Đợt 2 hoàn tất.

Kết luận tại thời điểm trước lượt kiểm chứng bổ sung: **BLOCKED — CORE HAPPY PATH
PASS, BUT IDEMPOTENCY REPLAY / CROSS-ACCOUNT DENIAL / MAKER SELF-APPROVAL NEGATIVE
EVIDENCE REMAINS OPEN**. Section 8 là cập nhật hiện hành.

## 8. Kiểm chứng bổ sung và đối soát chốt Đợt 2 (2026-09-08)

Các kiểm tra dưới đây chạy trên snapshot `3b38cabc39c9254231e5ef0ccb90e2ae278a532f`.
Không sửa source, test, migration hoặc harness. PostgreSQL disposable chỉ dùng cho
kiểm tra relational và đã được xóa đúng resource; database demo cùng các dịch vụ local
được giữ nguyên.

### 8.1. Đối soát số dư và ledger

- Số dư đầu kỳ của A sau funding là `10,000,000 VND`; B chưa có credit từ flow này.
- Transfer thành công thứ nhất A → B: amount `500,000`, fee `1,000`.
- Transfer thành công thứ hai A → B: amount `5,000,000`, fee `1,000`.
- Biến động A là `-5,502,000 VND`, nên A kết thúc ở
  `10,000,000 - 500,000 - 1,000 - 5,000,000 - 1,000 = 4,498,000 VND`.
- Biến động B là `+5,500,000 VND`, nên B kết thúc ở `5,500,000 VND`.
- `account_transactions` ghi đúng funding credit `10,000,000` cho A, transfer debit
  `5,500,000` và fee `2,000` cho A, cùng transfer credit `5,500,000` cho B.
- Trong cùng đơn vị minor VND và cùng phạm vi demo, ledger có CREDIT `15,502,000`
  và DEBIT `15,502,000`; ledger cân bằng. Ba journal gồm một funding journal và hai
  transfer journal. Lần insufficient-funds không tạo thêm transfer, transaction hoặc
  ledger row.

### 8.2. Idempotency replay — PASS

Command relational chạy đúng một lần trên PostgreSQL disposable:

`node --import=tsx scripts/run-disposable-postgres-test.ts src/tests/databaseFoundation.test.ts`

Runner kết thúc exit code `0`; suite có `11/11 PASS`, `0 fail`, `0 cancelled`,
`0 skipped`, `0 deferred tests`. Test hiện hành
`direct transfer use case is idempotent, lock-ordered and atomically persisted`
đã replay cùng idempotency key, fingerprint và quote, trả lại transfer canonical;
fingerprint khác bị từ chối bằng `IdempotencyConflictError`. Fixture relational giữ
đúng một transfer, hai account-transaction, một journal và các side effect tương ứng;
không tạo debit, journal hoặc transfer thứ hai.

Đây là evidence service/PostgreSQL, không phải replay qua Mobile UI. MFA production
không bị vô hiệu hóa hoặc thay đổi để làm test pass; evidence MFA của happy path vẫn
được giữ riêng.

### 8.3. Cross-account authorization — PASS

B đăng nhập qua Public API local thành công. Khi dùng phiên của B để đọc account của A,
cả account-number endpoint và transaction endpoint đều trả `404 NOT_FOUND`, phù hợp
với ownership boundary thay vì làm lộ tài khoản. Snapshot trước/sau cho các bảng
`transfers`, `account_transactions`, `ledger_journals`, `ledger_entries` và hai balance
không đổi.

Đây là evidence HTTP + PostgreSQL; không phải UI E2E. Bản thân login tạo session/auth
state theo contract, nhưng protected account data không bị thay đổi. Không có thao tác
transfer hợp lệ nào bị dùng làm bằng chứng cho truy cập trái quyền.

### 8.4. Maker self-approval — PASS ở policy/service scope

Evidence kế thừa từ `backend/src/tests/adminWorkflow.test.ts`: suite service/in-memory
`5/5 PASS`, trong đó test `maker cannot approve own funding and checker executes once`
cho thấy maker bị từ chối với `SELF_APPROVAL_FORBIDDEN`; request không được maker
thực thi, còn checker CONTROL độc lập vẫn approve và action chỉ thực thi một lần.
Checker approval qua Admin Web trong happy path cũng đã PASS.

Đây là evidence policy/service và Admin Web, không phải một relational funding test
riêng cho nhánh self-reject; không ghi nhận funding hoặc ledger từ lần maker bị từ chối.

### 8.5. Scratch-script audit

Đối soát ba script scratch đã dùng trước đó, không chạy lại và không xóa:

- `m07-stage2-create-checker.mjs` — `1,946` bytes, SHA-256
  `c6d81bf472826eb37324b6a4b6f20fe8dad9b991df69feab4437e1a93629fab4`. Script dùng
  `DATABASE_URL` của demo, gọi trực tiếp `StaffAuthService.invite/activate` và trường
  role thực tế là `OPERATIONS`; tên biến “checker” không biến nó thành CONTROL checker.
  `createdByStaffId` là null, nên đây là provisioning/bootstrap aid ngoài Admin Web,
  không phải bằng chứng maker–checker cho funding/KYC. Không có dấu hiệu script bypass
  maker–checker của các thao tác funding/KYC đã kiểm chứng.
- `m07-stage2-readonly.mjs` — `1,860` bytes, SHA-256
  `842e67ef84f76b17c726f68e99ba3b6277a0f046e4e31c563f0022312af7888f`. Script dùng
  demo DB và chỉ đọc customers/MFA credentials/payment accounts/KYC applications;
  không có mutation query.
- `m07-stage2-revoke-pending.mjs` — `1,317` bytes, SHA-256
  `deaffbd73cb1ca338a93da2efb9ed23bb0ed1d6ff804074ae0a35db9ccef98d8`. Script dùng
  demo DB, đọc `mfa_credentials` và chuyển đúng trạng thái TOTP `PENDING` → `REVOKED`
  để cleanup; không đụng funding, transfer, KYC hoặc ledger. Đây là direct DB cleanup,
  không phải maker–checker evidence.

### 8.6. Trạng thái bàn giao sau kiểm chứng

| Tiêu chí | Evidence chính | Kết quả |
| --- | --- | --- |
| Đối soát A/B và ledger | PostgreSQL read-only | PASS |
| Idempotency cùng key/payload | Service + PostgreSQL disposable | PASS |
| Cross-account denial | Public API + PostgreSQL invariants | PASS |
| Maker self-approval | Policy/service test + Admin Web checker | PASS |

Container PostgreSQL disposable dùng cho idempotency đã được cleanup, container/volume
leftover bằng `0`. Demo PostgreSQL persistent vẫn running; Public Backend, Admin Backend,
Admin Web, email capture, invitation capture và Android emulator vẫn được giữ cho Owner
xem demo. Không đóng thêm use case nào và không bắt đầu Đợt 3.

Kết luận cập nhật: **READY FOR OWNER ACCEPTANCE — ĐỢT 2 CORE DEMO VÀ BA NEGATIVE
CONTROLS ĐÃ CÓ EVIDENCE TRONG PHẠM VI HỌC THUẬT**.

## 9. Owner approval checkpoint

Đợt 2 được Owner chấp thuận ở phạm vi đồ án học thuật: **COMPLETED — OWNER
APPROVED**. Phạm vi được nghiệm thu gồm luồng demo, đối soát A/B, idempotency replay
và cross-account authorization; maker self-approval được chấp thuận đúng ở
policy/service scope, không được diễn giải thành negative UI E2E.

- Hai transfer thành công là `500,000 VND` và `5,000,000 VND`, mỗi giao dịch fee
  `1,000 VND`; A kết thúc `4,498,000 VND`, B nhận `5,500,000 VND`.
- Tổng ledger debit và credit trong cùng phạm vi, cùng đơn vị minor VND đều là
  `15,502,000`; đây là tổng luân chuyển ledger, không phải tổng số dư.
- Evidence được phân tầng rõ: happy path Mobile/Admin Web; idempotency
  service/PostgreSQL disposable; cross-account HTTP + PostgreSQL invariant;
  self-approval policy/service với checker độc lập.
- Script `m07-stage2-create-checker.mjs` thực tế provision role `OPERATIONS` qua
  service trực tiếp, không chứng minh role CONTROL. Test service hiện hành khai báo
  CONTROL checker tách biệt; vai trò của principal Admin Web trong runtime demo không
  được re-query độc lập ở checkpoint này và không suy đoán thêm.
- Database demo và local services được giữ chạy theo quyết định Owner. Không stage,
  commit hoặc push thêm trong bước nghiệm thu này.

Điểm tiếp tục Đợt 3 là hoàn thiện bàn giao đồ án: UI cần thiết, setup/deployment,
bằng chứng CI/Git, báo cáo/UML/ERD, slides và diễn tập demo. Đợt 3 chưa triển khai;
không tự đánh dấu UC-M04 trở đi hoặc bất kỳ use case nào khác hoàn tất.

# Business-hardening local evidence — cập nhật 2026-08-31

## Phạm vi và trạng thái

Evidence này chỉ áp dụng cho source hiện tại và PostgreSQL disposable. Không có
test destructive nào chạy vào `banking_preview`; worker preview không được bật;
không push/merge/tag và không thay đổi artifact bất biến `RC.4`.

```text
LOCAL RELATIONAL-V2 CORE + BUSINESS HARDENING VERIFIED
DATABASE_TEST_DATABASE_NAME=banking_test_<pid>_<random>
MIGRATIONS=001–040
IMAGE_DIGEST=unknown
WORKER_ENABLED=0 (preview)
STAGING VERIFIED=NO
RELEASE CANDIDATE=NO
```

`IMAGE_DIGEST=unknown` vẫn đúng: các image vừa build là image local, chưa có
registry content digest, Cosign signature, provenance, HTTPS staging và device
E2E staging evidence.

## Nghiệp vụ đã khóa

- Transfer đọc policy PostgreSQL khi quote và kiểm tra lại trong transaction khi
  submit. Global switch, feature switch, amount limit, entitlement và TOTP policy
  thiếu/sai đều fail closed trước mọi debit/ledger/audit/outbox.
- Login rate-limit khóa bucket bền vững trước password verify, chỉ tăng khi sai,
  reset khi thành công, chịu được request đồng thời và không tiết lộ account.
- Credit activation không tạo statement rỗng. Scheduler dùng chu kỳ `[start,end)`,
  không mất transaction ở boundary, không tạo statement trùng sau restart.
- Beneficiary delete là tombstone `DELETED`; risk block là `BLOCKED`; bản đã xóa
  không đọc/rename được và cùng target có thể tạo lại. Lịch sử giữ counterparty
  snapshot phía gửi/nhận bất biến.
- Card lock là thao tác khẩn cấp không TOTP và không bị kill switch chặn. Unlock
  dùng `CARD_UNLOCK`; report-lost dùng `CARD_REPORT_LOST`, block card và tạo đúng
  một `card_security_cases` record cùng audit/notification/outbox.
- Query/read, credit repayment, emergency lock và nghĩa vụ maturity được tách khỏi
  switch command. Credit account `FROZEN`/card `BLOCKED` vẫn nhận repayment khi
  `credit_payments_enabled=true`; source account vẫn phải `ACTIVE` và đủ tiền.
- Savings maturity không thể credit sẽ chuyển sang suspense bền vững; scheduler
  retry idempotent có backoff, resolve nguyên tử hoặc chuyển `DEAD` đúng một lần.
- KYC Customer/Admin dùng cùng bản ghi PostgreSQL, canonical
  `DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED/REJECTED/NEEDS_MORE_INFO`, bắt buộc
  xác nhận dữ liệu synthetic và ghi audit/notification/outbox cùng transaction.
- Account/Credit history dùng keyset cursor ở database; regression test truy cập
  đủ hơn 1.000 giao dịch, kiểm tra ownership và cursor scope.
- Mobile chỉ hiện một thẻ hiện có hoặc hồ sơ đang chờ. QR được ghi rõ là “QR
  thông tin nhận tiền”; payload v2 không chứa UUID nội bộ, dùng số tài khoản,
  reject field thừa/format sai và không khởi tạo payment/transfer.

## Migration và schema

- `033`: singleton control policy fail-closed.
- `034`: customer entitlement và persistent login bucket.
- `035`: credit cycle start và backfill có review marker khi mơ hồ.
- `036`: beneficiary tombstone/partial unique index.
- `037`: immutable transfer counterparty snapshots.
- `038`: persistent synthetic KYC canonical status.
- `039`: keyset indexes và maturity suspense.
- `040`: card report-lost case/purpose và suspense retry/dead-letter metadata.

Database rỗng đã áp migration `001–040`; lần chạy thứ hai nhận đúng toàn bộ
`already applied`. Live validator xác minh 52 bảng, columns, indexes và constraints;
database disposable sau đó đã được drop.

## Quality gate đã chạy

| Nhóm | Kết quả |
|---|---:|
| Backend typecheck/build/OpenAPI | PASS — 54 paths, 60 exact route guards |
| Backend `npm run test:release` | PASS — đủ 17/17 nhóm |
| Backend aggregate | PASS — 206 test: 158 pass, 48 DB skip có chủ đích, 0 fail |
| Disposable guard/foundation | PASS — 5/5 và 11/11 |
| Disposable relational/MFA/registration | PASS — 1/1, 1/1, 1/1 |
| Disposable Savings/Credit/remaining | PASS — 2/2, 6/6, 2/2 |
| Disposable lifecycle/scheduler/integrated | PASS — 7/7, 2/2, 1/1 |
| Disposable Admin/legacy persistence/worker | PASS — 9/9, 11/11, 10/10 |
| Direct relational HTTP boundary | PASS — 7/7, gồm lock/unlock/report-lost |
| Migration run-twice + live schema | PASS — 001–040; 52 tables |
| Mobile lint/typecheck/OpenAPI/Maestro syntax | PASS — 46 paths; 13 flows |
| Mobile unit/web export | PASS — 45 suite, 259 test; 36 static routes |
| Admin lint/test/build | PASS — 7/7 test |
| Compose config + local image build | PASS — Backend, Admin API, Admin Web |
| Image secret-surface | PASS — cả 3 local image |
| Source secret surface/registry | PASS — 604 tracked file; 7 metadata entries |
| Untracked secret scan | PASS — 39 text file trong 43 file untracked; không in giá trị |
| Dependency audit Backend/Mobile/Admin | PASS — 0 high vulnerability |
| Native emulator/Maestro runtime | PARTIAL — preflight PASS (emulator online, API 35, APK đã cài, backend health 200, Maestro 2.8.0); flow đăng ký native dừng ở bước nhập form trước OTP, nên native E2E vẫn NOT VERIFIED |

48 PostgreSQL skip trong aggregate không che chức năng: từng nhóm tương ứng đã
được chạy lại bằng `run-disposable-postgres-test.ts`, mỗi lần chỉ dùng database
`banking_test_*`, migrate rồi drop. `banking_preview` không bị suite test chạm tới.

## Kiểm tra thủ công sau khi đồng bộ runtime

Mobile:

1. Đăng nhập, mở Thẻ; khi đã có thẻ không được thấy nút đăng ký thêm.
2. Lock không hỏi TOTP; unlock và report-lost phải tạo challenge đúng purpose.
3. Mở QR: tiêu đề phải là “QR thông tin nhận tiền”; quét payload v2 chỉ hiện dữ
   liệu `UNVERIFIED`, không có nút xác nhận thanh toán.
4. Nộp KYC synthetic, đóng/mở app và kiểm tra trạng thái vẫn đọc từ server.

Admin:

1. Maker claim đúng KYC application; checker khác maker mới được approve/reject/
   yêu cầu bổ sung.
2. Customer đọc lại cùng application ID và canonical status; audit/outbox chỉ có
   một transition cho quyết định đã thực thi.

Native checks không được chuyển thành PASS chỉ dựa trên unit/web test. Emulator
đã online ở lần rerun ngày 2026-08-31, nhưng flow vẫn chưa đạt đến OTP.

### Native preflight và flow rerun — 2026-08-31

- ADB binary hợp lệ; `adb devices -l` trả `emulator-5554 device`, emulator API
  35 và package APK đã cài.
- `npm run device:preflight -- --health=http://127.0.0.1:5600/healthz` PASS:
  backend health 200, reconciliation/outbox `ok`, Maestro `2.8.0` và Java sẵn
  sàng. Chỉ dùng backend/PostgreSQL disposable; không khởi động Compose preview
  và không chạm `banking_preview`.
- Đã sửa selector của flow theo UI hiện tại (`Đăng ký ngay`) và kiểm tra cú pháp:
  `npm run validate:e2e` PASS, 13 flows hợp lệ.
- Rerun `mobile-app/.codex-run-registration-e2e.ps1` đã mở được màn hình đăng ký
  và thực hiện các bước nhập form, nhưng nội dung nhập tự phân bố sang ô kế bên
  (controlled `TextInput`/Android IME); validation giữ flow trên form nên
  `register-otp` không xuất hiện. Maestro đồng thời ghi cảnh báo heartbeat do
  file lock trong KeyValueStore. Không có OTP/secret nào được ghi vào log.
- Đã chạy lại lần nữa sau khi người dùng báo đã sửa lỗi nhập liệu; kết quả vẫn
  giống nhau: backend health còn 200 nhưng capture inbox rỗng vì request đăng ký
  chưa được gửi, do các trường native tiếp tục nhận sai giá trị và bị validation
  chặn trước OTP.
- Vì vậy kết quả chính thức là `MOBILE_NATIVE_E2E_AFTER_BACKEND_UPDATE=NOT_VERIFIED`,
  không phải PASS. API-only disposable registration vẫn đã xác minh riêng:
  register → capture OTP (redacted) → verify → login, OTP dùng lại bị từ chối.

## Release truth và việc còn lại

- `npm run release:gate` trả đúng `promotionAllowed=false`: source tree có 172
  thay đổi và migration `033–040` chưa được track/commit trong candidate mới;
  `migrationCount=40`, full commit SHA và secret guard đều hợp lệ. Vì vậy chưa
  đủ điều kiện tạo release candidate.
- `code_review.md` không còn là thay đổi dirty hiện tại; việc xóa đã nằm trong
  commit lịch sử `9c7a36e`, nên không còn là blocker chưa quyết định của worktree.
- Chưa có registry/signature/provenance, managed staging, HTTPS, backup/restore
  cloud, on-call/SLO hay native staging E2E.
- Không bật `WORKER_CUTOVER_CONFIRMED=1` cho preview. Việc chạy worker trong gate
  chỉ xảy ra trên database disposable.

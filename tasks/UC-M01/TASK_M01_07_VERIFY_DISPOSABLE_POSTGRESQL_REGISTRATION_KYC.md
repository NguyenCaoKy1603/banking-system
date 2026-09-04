# TASK M01-07 — Xác minh PostgreSQL disposable cho Registration và KYC (Kế hoạch v4)

- Trạng thái: IN_PROGRESS — M07-A1 COMMITTED — M07-A2 REMEDIATION NOT STARTED
- Chế độ hiện tại: DIAGNOSE_AND_PLAN — DOCUMENTATION COMMIT ONLY
- An toàn thực thi database: BLOCKED — M07-A2 EVIDENCE HARNESS GAP; M07-A2 NOT AUTHORIZED
- Tiến độ task: M01-07 CHƯA HOÀN THÀNH (INCOMPLETE)
- Tiến độ use case: UC-M01 CHƯA HOÀN THÀNH (INCOMPLETE)
- Chế độ dự kiến sau owner approval riêng: IMPLEMENT_AND_VERIFY (theo từng gate)

Baseline được xác nhận khi soạn task:

- Repository root: C:\Projects\banking-system
- Current working directory: C:\Projects\banking-system
- Branch: codex/staging-academic-completion
- HEAD: 1bded79c8575c7958f3920cc021878e050225aed
- Working tree: có đúng một authorized untracked file; không có modified/staged file khác
- Cached area: sạch
- M01-06: COMPLETED
- M01-07, M01-08, M01-09: chưa bắt đầu

Task này là kế hoạch xác minh cho dữ liệu tổng hợp và tiền ảo trong phạm vi khóa luận. Nó không biến hệ thống thành production, không kết nối hệ thống ngân hàng thật và không sử dụng dữ liệu khách hàng thật.

## OWNER APPROVAL — M01-07 FINAL IMPLEMENTATION PLAN

- Ngày phê duyệt kế hoạch: 2026-09-04
- Baseline commit được phê duyệt: `1bded79c8575c7958f3920cc021878e050225aed`
- Quyết định: Phê duyệt kế hoạch thực thi M01-07 (Plan v4). Kế hoạch xác lập 11 quy tắc an toàn fail-closed, mô hình chia checkpoint tuần tự (M07-A1, M07-A2, M07-B, M07-C, M07-D, M07-E), ma trận kiểm thử Registration & KYC, cùng phân định trách nhiệm rõ ràng.
- Ghi nhận 4 khoảng trống harness M07-A2: Nhận diện rõ 4 harness gap tại Checkpoint M07-A2 (`BLOCKED — M07-A2 EVIDENCE HARNESS GAP`), giữ nguyên modification allowlist cho A2 là chỉ duy nhất 1 file task. Bất kỳ mở rộng harness nào phải chờ quyết định và cấp quyền riêng từ Owner.
- Cảnh báo an toàn: Phê duyệt kế hoạch KHÔNG đồng nghĩa với việc cho phép khởi chạy database hoặc chuyển sang checkpoint thực thi code. Checkpoint M07-A1 CHƯA bắt đầu. Toàn bộ lệnh thực thi database tiếp tục bị chặn (`BLOCKED — DISPOSABLE DATABASE SAFETY NOT ESTABLISHED`) cho đến khi hoàn thành cổng an toàn M07-A1 và có phê duyệt riêng của Owner.

## OWNER APPROVAL — M07-A1 UNIT SAFETY GATE ACCEPTED

- Ngày phê duyệt: 2026-09-04
- Baseline commit: `0a351b1fa835430d8ce6cab464b16a00fe9e24f5`
- Quyết định Owner: Chấp thuận Checkpoint M07-A1 Guard & Runner Hardening ở mức unit/test-double. Checkpoint M07-A2 KHÔNG ĐƯỢC CẤP QUYỀN trong lượt này.
- Danh mục 4 file checkpoint M07-A1:
  1. `backend/scripts/run-disposable-postgres-test.ts`
  2. `backend/src/database/disposableDatabaseGuard.ts`
  3. `backend/src/tests/disposableDatabaseGuard.test.ts`
  4. `tasks/UC-M01/TASK_M01_07_VERIFY_DISPOSABLE_POSTGRESQL_REGISTRATION_KYC.md`
- Kết quả kiểm thử được chấp thuận:
  - Typecheck: PASS (`npm run typecheck`, 0 lỗi TypeScript, 0 prohibited TypeScript bypasses).
  - Build: PASS (`npm run build`).
  - Targeted tests: `32/32 PASS`, `0 fail`, `0 cancelled`, `0 skipped` (`node --import=tsx --test src/tests/disposableDatabaseGuard.test.ts`, ~379ms).
  - Quy chuẩn an toàn `SAFE-R01` đến `SAFE-R11`: Đạt đầy đủ unit/test-double evidence.
- Bounded Cooperative Cancellation:
  - Cơ chế timeout chuyển đổi hoàn toàn từ `Promise.race` sang mô hình hủy phối hợp có giới hạn, sử dụng typed lifecycle state (`"IDLE" | "RUNNING" | "STOPPING" | "TIMED_OUT" | "COMPLETED" | "FAILED"`), `AbortController`, và kiểm tra hủy trước từng phase (`checkCancellation`).
  - Late child completion: Fake child hoàn thành muộn sau timeout không làm thay đổi kết quả fail-closed và không chạy command kế tiếp.
  - Late cleanup completion: Phase dọn dẹp hoàn tất muộn sau deadline không chạy phase hủy diệt tiếp theo (`pg_terminate_backend`, `DROP DATABASE`, post-drop catalog check, container removal đều có đúng 0 lượt gọi).
  - Non-cooperative adapter: Adapter không tự hủy chỉ chứng minh orchestration trả về `fail-closed` theo đúng deadline; không chứng minh underlying runtime I/O đã bị dừng.
- Ngữ nghĩa sự kiện tiến trình (Fatal Events & Exit Code Seam):
  - Cả 4 fatal process events (`SIGINT`, `SIGTERM`, `uncaughtException`, `unhandledRejection`) đều được kiểm tra qua fake process seam; `processFacade.exitCode` được thiết lập thành 1 (khác 0), không gọi `process.exit()` trực tiếp, không có unawaited background promise.
- Ranh giới an toàn:
  - Hoàn toàn KHÔNG có PostgreSQL, Docker, container, DNS/network hoặc child process thật nào được chạy trong M07-A1.
  - Không có bất kỳ tuyên bố an toàn ở cấp độ runtime (no runtime safety claim).
  - Task M01-07 và Use Case UC-M01 CHƯA HOÀN THÀNH.

Giới hạn và điểm chưa chứng minh ở runtime:
- Chưa chứng minh PostgreSQL 16 container thật (chưa chứng minh ephemeral container descriptor và loopback port binding).
- Chưa chứng minh connection/query cancellation thật trên socket PostgreSQL.
- Chưa chứng minh ownership marker comment thật trong `pg_shdescription`.
- Chưa chứng minh `pg_terminate_backend`, `DROP DATABASE`, hay catalog verification sau drop thật trên PostgreSQL.
- Chưa chứng minh container removal thật bằng Docker client / daemon.
- Sơ đồ lifecycle chỉ là tài liệu minh họa, không thay thế test/runtime evidence.

Bốn blocker M07-A2 được giữ nguyên vẹn:
1. Exact 40 migration history rows (`001_initial_schema.sql` đến `040_add_admin_and_staff_audit_events.sql`).
2. Rerun migration tuần tự trên DB đã migrate phải giữ nguyên 40 rows.
3. Runtime checksum mismatch refusal: Sửa đổi 1 byte checksum phải bị từ chối rõ ràng.
4. Post-drop catalog verification: Truy vấn `pg_database` xác minh DB target đã biến mất hoàn toàn.


## 1. Repository verification và quyền phiên này

Preflight đã chạy trong repository thật:

```powershell
git branch --show-current
# codex/staging-academic-completion

git rev-parse HEAD
# 1bded79c8575c7958f3920cc021878e050225aed

git status --short --untracked-files=all
# ?? tasks/UC-M01/TASK_M01_07_VERIFY_DISPOSABLE_POSTGRESQL_REGISTRATION_KYC.md

git diff --cached --name-status
# <không có dòng thay đổi>

git diff --name-status
# <không có dòng thay đổi>

git log -5 --oneline
# 1bded79 docs(uc-m01): complete registration KYC coverage gaps
# 7599a5a test(mobile): close registration KYC coverage gaps
# a7d3068 docs(uc-m01): complete KYC lifecycle and UI errors
# 6bdb004 feat(kyc): complete mobile lifecycle states
# 736e55e docs(uc-m01): record KYC lifecycle checkpoint
```

M01-07 phải chạy lại toàn bộ preflight ở đầu mỗi checkpoint. Không được mặc định rằng snapshot M01-06 hoặc số liệu trong tài liệu cũ vẫn là hiện trạng. Source tree, migration history/checksum, runtime và test output của đúng HEAD là bằng chứng chính.

Chỉ file sau được tạo hoặc cập nhật trong phiên documentation-only này:

`tasks/UC-M01/TASK_M01_07_VERIFY_DISPOSABLE_POSTGRESQL_REGISTRATION_KYC.md`

Không đọc hoặc in .env, DATABASE_URL, password, token, key hoặc credential. Chỉ được đọc tên biến, file .env.example và cấu hình đã redact khi cần.

## 2. Chế độ làm việc và quyền Git

Chế độ hiện tại là DIAGNOSE_AND_PLAN — DOCUMENTATION ONLY.

Quyền trong phiên này:

- Được kiểm tra source, migration, test harness, package script và cấu hình Compose ở chế độ chỉ đọc.
- Được cập nhật đúng task file M01-07 này.
- Không được sửa Backend source, repository, service, database schema, migration, OpenAPI, Mobile, Admin Web, CI, infrastructure, worker hoặc scheduler.
- Không được chạy PostgreSQL integration/release suite.
- Không được tạo, reset, migrate, seed, truncate, drop hoặc xóa database.
- Không được kết nối banking_preview, database remote, staging hoặc production-like.
- Không được chạy docker compose up, docker compose down, createdb, dropdb, CREATE DATABASE hoặc DROP DATABASE.
- Không được chạy worker/scheduler, Mobile runtime, emulator hoặc Maestro.
- Không được thêm dependency, script package hoặc biến secret/config.
- Không được git add, stage, commit, push, merge, rebase hoặc tag.

Quyền thực hiện các checkpoint có database ở phần sau chỉ có hiệu lực sau khi owner phê duyệt riêng chế độ implementation và xác nhận protocol disposable đã đạt gate an toàn. Không được xem kế hoạch này là quyền chạy destructive test.

## 3. Mục tiêu và kết quả quan sát được

Mục tiêu duy nhất của M01-07 là chứng minh trên một PostgreSQL disposable được guard chặt rằng Registration và KYC relational-v2:

1. Có thể migrate từ database rỗng theo đúng thứ tự 001–040.
2. Ghi và kiểm tra migration history, checksum và migration-set fingerprint.
3. Chạy lại migration an toàn, không tạo bản ghi lịch sử trùng và không che giấu checksum mismatch.
4. Giữ đúng các invariant database của Registration, challenge, completion, KYC, audit và outbox.
5. Xử lý concurrency bằng row lock, unique constraint, transaction và idempotency đúng với canonical contract.
6. Rollback không để lại customer, account, pending registration, KYC, audit, outbox hoặc balance dở dang.
7. Đóng và mở lại pool/repository vẫn đọc được dữ liệu đã commit.
8. Chỉ sử dụng fixture synthetic; không đưa password, OTP, proof, token, full identity number hoặc credential vào log/evidence.

Kết quả cần bàn giao sau implementation là evidence đã redact, gắn với đúng HEAD, migration fingerprint, môi trường disposable và lệnh thật đã chạy. Không được dùng số lượng test skip như bằng chứng PostgreSQL đã pass.

## 4. Phạm vi và phần không thuộc M01-07

### 4.1 Thuộc M01-07

- Disposable database safety protocol hardening và validation.
- Migration từ database rỗng và kiểm tra lịch sử/checksum.
- Upgrade/re-run theo migration runner hiện có.
- Registration duplicate race, pending cleanup, completion precedence, challenge binding, cancel idempotency và verify race.
- KYC open-application constraint, DRAFT, SUBMITTED, UNDER_REVIEW, NEEDS_MORE_INFO, APPROVED, REJECTED, submit idempotency và interleaving.
- Transaction rollback, lock ordering, isolation, restart safety.
- Audit/outbox/business side-effect consistency trong cùng transaction.
- Disposable database guard, cleanup ownership, timeout và redacted evidence.

### 4.2 Không thuộc M01-07

- Sửa canonical decisions D-01 đến D-15.
- Sửa API/OpenAPI hoặc Mobile contract; M01-03 đã sở hữu phần đồng bộ đó.
- Sửa Registration recovery code ngoài bằng chứng cần kiểm tra; nếu service sai thì mở task implementation riêng, không âm thầm sửa trong test task.
- Emulator, thiết bị thật, restart app, UI, keyboard, Maestro; chuyển M01-08.
- Worker production-like, push/email provider thật, scheduler deployment; chỉ kiểm tra bản ghi outbox nguyên tử nếu cần, không tuyên bố worker đã xác minh.
- Admin Web, CI/infrastructure, cloud, HTTPS, backup/restore staging.
- Tiền thật, core/partner thật, dữ liệu định danh thật.

## 5. Quan hệ với M01-03, M01-04, M01-05, M01-06, M01-08 và M01-09

| Task | Kết quả đã có hoặc dependency | M01-07 nhận và xác minh | Không được nhận thay |
| ---- | ----------------------------- | ----------------------- | --------------------- |
| M01-03 | API privacy/contract đã đồng bộ; database thật bị deferred | Kiểm tra persisted payload/mapper không làm lộ full identity và schema vẫn đọc được | Không sửa OpenAPI, Backend public mapper hoặc Mobile |
| M01-04 | Registration contract/recovery và D-06–D-09 đã chốt; PostgreSQL race bị deferred | Chứng minh transaction, row lock, duplicate/cancel/verify/restart trên DB disposable | Không đổi recovery policy hoặc global enum |
| M01-05 | KYC lifecycle D-10/D-11/D-14/D-15 đã chốt; DB concurrency bị deferred | Chứng minh unique-open, status terminal, version, lock, side-effect idempotency | Không đổi KYC status contract hoặc UI |
| M01-06 | Coverage gaps test-only đã đóng; PostgreSQL/device vẫn deferred | Chạy phần relational runtime được chỉ định trong task này | Không coi test unit là bằng chứng DB |
| M01-08 | Chưa bắt đầu | Nhận kết luận persisted state/restart cần kiểm tra trên app/emulator | Không tuyên bố emulator/Maestro pass |
| M01-09 | Chưa bắt đầu | Nhận evidence và risk còn lại để audit/đóng UC-M01 | Không đánh dấu toàn bộ UC-M01 hoàn thành |

## 6. Decisions D-01 đến D-15 và ownership của M01-07

M01-07 không tạo decision mới. Nó chỉ kiểm chứng invariant database của các decision đã được owner chốt trong M01-02 và implementation đã được giao cho M01-03/M01-04/M01-05.

| Decision | Invariant cần kiểm chứng trên PostgreSQL | Task sở hữu contract | Bằng chứng M01-07 cần |
| -------- | ---------------------------------------- | --------------------- | --------------------- |
| D-01 | Identity synthetic lưu đúng boundary 6–24 chữ số; không lộ giá trị đầy đủ trong public result/log | M01-03 | Row/payload hợp lệ và response/query assertion đã redact |
| D-02 | documentUri chỉ nhận mock:// hoặc synthetic:// ở boundary đã chốt | M01-03 | Valid/invalid fixture và persisted value |
| D-03 | Public KYC chỉ trả identityNumberLast4 đúng bốn chữ số | M01-03 | Mapper/HTTP assertion; không đọc full identity vào evidence |
| D-04 | Full identity không xuất hiện trong public response hoặc telemetry | M01-03 | Capture/log/storage scan đã redact |
| D-05 | Registration dùng EMAIL_OTP và REGISTRATION_EMAIL_VERIFY; KYC dùng enum canonical | M01-04/M01-05 | Challenge/status row và rejection cho alias không hợp lệ |
| D-06 | Verify malformed/missing body trả 422 ở HTTP contract | M01-04 | DB không tạo side effect khi HTTP fake test được phép; HTTP fake chính thuộc M01-04 |
| D-07 | Duplicate registration race có một winner (202) và error 409 cho loser | M01-04 | Hai transaction/process và count customer/pending/completion |
| D-08 | Cancel dùng POST /auth/register/cancel theo base path thực tế | M01-04 | Challenge/pending state sau command; path/HTTP chính thuộc M01-04 |
| D-09 | Cancel ràng buộc challengeId, X-Device-ID, purpose; idempotent và completed precedence | M01-04 | 204/404/409 theo state, không hủy nhầm device/purpose |
| D-10 | KYC DRAFT là payload đầy đủ hợp lệ đã lưu nhưng chưa submit | M01-05 | Status, payload, submitted_at, version và side-effect count |
| D-11 | REJECTED terminal/immutable; resubmit tạo application mới, tối đa một open | M01-05 | Cũ không đổi, record mới DRAFT/SUBMITTED hợp lệ |
| D-12 | Không persist password, OTP hoặc proof plaintext | M01-04/M01-05 | Column/payload/audit/outbox scan chỉ có digest/intent đã redact |
| D-13 | Identifier rate-limit chỉ dùng keyed HMAC-SHA-256 hex 64 chars; không lưu raw identifier | M01-04 | rate_limit_buckets.bucket_key có prefix + keyed HMAC lowercase hex 64 chars |
| D-14 | NEEDS_MORE_INFO là canonical; version/field semantics nhất quán | M01-05 | Status transition/version/constraint trên DB |
| D-15 | Update unchanged có thể bỏ identity; đổi identity phải là full 6–24 digits | M01-03/M01-05 | Persisted value mới đúng, response chỉ last4 |

## 7. Quy chuẩn an toàn cơ sở dữ liệu disposable (Disposable Database Safety Protocol)

Để giảm thiểu rủi ro theo cơ chế fail-closed đã phê duyệt đối với preview database (`banking_preview`), staging hoặc môi trường dùng chung, M01-07 thiết lập 11 quy tắc an toàn bắt buộc (`SAFE-R01` đến `SAFE-R11`). Mọi runner và test harness phải tuân thủ nghiêm ngặt:

### 7.1 Mười một quy tắc an toàn bắt buộc (SAFE-R01 đến SAFE-R11)

- `SAFE-R01` — Bí mật chuỗi kết nối và thông tin xác thực (Connection secrecy): Không bao giờ echo, log, serialize hoặc in chuỗi kết nối đầy đủ, password, token, key hoặc connection string ra console, test report, transcript hay artifact. Mọi thông báo lỗi và log audit phải được redact; trong báo cáo chỉ ghi nhận connection value: `value redacted`.
- `SAFE-R02` — Lớp môi trường runtime cô lập (Isolated runtime class): Chỉ chạy trên ephemeral container PostgreSQL 16 local, bind duy nhất vào numeric loopback interface (`127.0.0.1` hoặc `::1`). Nếu kiểm tra `localhost`, phải phân giải DNS và chứng minh mọi địa chỉ trả về đều là loopback numeric, đồng thời đối chiếu exact container ID/label. Docker port tuyệt đối không được bind `0.0.0.0`. Gán label và tên duy nhất cho container theo pattern `^banking_test_container_[a-f0-9]{32}$`. Tuyệt đối cấm mount volume host, cấm volume persistence (`banking_preview_pgdata`), cấm dùng chung database instance với bất kỳ service nào khác.
- `SAFE-R03` — Danh sách endpoint và tên database được bảo vệ (Protected endpoints & DB names): Fail-closed ngay lập tức nếu endpoint không thuộc loopback numeric, hoặc tên database là các database hệ thống (`postgres`, `template0`, `template1`), database preview (`banking_preview`), hoặc bất kỳ biến thể chữ hoa/chữ thường sau khi chuẩn hóa chuỗi (case-insensitive normalized).
- `SAFE-R04` — Định danh database đích do runner sinh độc quyền (Runner-generated target identity): Tên database kiểm thử phải được sinh tự động bởi runner theo pattern regex nghiêm ngặt `^banking_test_[a-f0-9]{32}$`, trong đó `run_id` là đúng 32 ký tự thập lục phân thường (`run_id = randomUUID().replaceAll("-", "").toLowerCase()`). Runner từ chối mọi tên database do caller hoặc biến môi trường bên ngoài tự ý truyền vào. Phân loại database đích: `ephemeral-loopback`, target class: `banking_test_<redacted>`. Không in full run ID trong báo cáo.
- `SAFE-R05` — Phân loại và kiểm tra trước khi tạo (Pre-create classification): Trước khi thực hiện lệnh `CREATE DATABASE`, runner phải kết nối tới admin database trên loopback để phân loại: kiểm tra container ID, host, port, xác nhận database đích chưa tồn tại trong `pg_database`, và xác nhận target name thỏa mãn pattern `^banking_test_[a-f0-9]{32}$`. Bước pre-create này không yêu cầu ownership marker vì database đích chưa được tạo.
- `SAFE-R06` — Dấu ấn quyền sở hữu sau khi tạo (Post-create ownership marker): Ngay sau khi tạo database đích, runner ghi dấu ấn quyền sở hữu thông qua `COMMENT ON DATABASE "banking_test_<run_id>" IS 'disposable_run_id=<run_id>;owner=m01_runner;created_at=<timestamp>'`. Không can thiệp sửa schema application. Trước khi chạy bất kỳ test nào, runner phải đọc lại comment này qua `shobj_description(d.oid, 'pg_database')` để xác minh quyền sở hữu.
- `SAFE-R07` — Tái xác thực trước khi dọn dẹp (Pre-cleanup revalidation): Trước khi thực hiện bất kỳ thao tác hủy (`DROP DATABASE`), runner phải kết nối admin database và kiểm tra lại toàn bộ: container instance, host/port, tên database khớp exact pattern `^banking_test_[a-f0-9]{32}$`, và comment database phải khớp chính xác `<run_id>` đã tạo. Nếu không khớp hoặc thiếu comment, fail-closed và dừng, không drop.
- `SAFE-R08` — Phạm vi lệnh và tiến trình chính xác (Exact command and process scope): Chỉ ngắt kết nối (`pg_terminate_backend`) thuộc đúng database đích `banking_test_<run_id>`. Lệnh `DROP DATABASE` chỉ nhắm đúng tên đã xác thực, không dùng phép nội suy chuỗi shell không kiểm soát. Trước khi remove container phải revalidate exact container ID và run label theo pattern `^banking_test_container_[a-f0-9]{32}$`; không xóa container theo tên hoặc prefix mơ hồ. Không dùng `docker compose down -v`, không dùng `docker system prune`, không xóa container/volume ngoài phiên chạy. Giới hạn test execution trong allowlist cố định.
- `SAFE-R09` — Giới hạn thời gian chờ hữu hạn (Finite candidate timeouts): Mọi thao tác phải có timeout hữu hạn được thực thi nghiêm ngặt, không cho phép treo vô hạn:
  - Khởi tạo container: tối đa 60 giây.
  - Kết nối pool/client: tối đa 5 giây (`connectionTimeoutMillis: 5000`).
  - Khóa dòng / bảng (lock): tối đa 5 giây (`SET lock_timeout = '5s'`).
  - Thực thi câu lệnh: tối đa 30 giây (`SET statement_timeout = '30s'`).
  - Session giao dịch nhàn rỗi: tối đa 30 giây (`SET idle_in_transaction_session_timeout = '30s'`).
  - Mỗi migration command hoặc mỗi targeted child test command: tối đa 180 giây (không chạy broad suite).
  - Dọn dẹp / cleanup: tối đa 30 giây.
- `SAFE-R10` — Dọn dẹp có bảo đảm và xử lý ngắt tiến trình (Awaited cleanup & interruption handling): Thao tác dọn dẹp bắt buộc nằm trong khối `finally` bất đồng bộ được `await` hoàn tất. Đóng toàn bộ client/pool trước khi drop. Đối với các tín hiệu ngắt (`SIGINT`, `SIGTERM`) và sự kiện lỗi nghiêm trọng (`uncaughtException`, `unhandledRejection`): handler chỉ được thực hiện bounded one-shot cleanup, giữ exit code khác 0, không swallow lỗi, không tiếp tục normal execution và tuyệt đối không gọi `process.exit()` trước khi awaited cleanup kết thúc hoặc timeout cleanup (30s) xảy ra.
- `SAFE-R11` — Hậu điều kiện, ẩn danh hóa và kết quả fail-closed (Postcondition, redaction & fail-closed result): Xác minh database đích đã bị xóa hoàn toàn khỏi PostgreSQL catalog (`pg_database`). Xóa container tạm sau khi revalidate container ID/label. Redact toàn bộ log/evidence trước khi ghi nhận. Nếu có bất kỳ bước kiểm tra hậu điều kiện nào thất bại, kết quả phải được đánh dấu là `FAILED / FAIL-CLOSED`, không được báo thành công.

### 7.2 Phân tầng bằng chứng an toàn: M07-A1 (Unit) đối chiếu M07-A2 (Runtime)

M07-A1 chỉ chứng minh pure guard logic và orchestration bằng unit/test-double; không chứng minh container identity, database comment thật, terminate session thật, drop thật hoặc catalog postcondition thật. Các đặc tính runtime này chỉ được chứng minh tại M07-A2. Sau M07-A1, việc thực thi database vẫn bị block cho đến khi Owner review và phê duyệt riêng.

| Quy tắc | M07-A1 Unit Evidence (Logic & Test-Double) | M07-A2 Runtime Evidence (Thực thi Ephemeral Container Thật) |
| ------- | ------------------------------------------ | ------------------------------------------------------------ |
| `SAFE-R01` | Test-double kiểm tra bộ lọc redaction chuỗi kết nối và credential | Quét output thực tế của lệnh migration/connection; bảo đảm không in connection string |
| `SAFE-R02` | Logic kiểm tra loopback IP numeric `127.0.0.1`/`::1` và DNS resolution | Container inspect thật: xác minh loopback numeric, không volume |
| `SAFE-R03` | Unit tests chặn các tên cấm `postgres`, `template0`, `template1`, `banking_preview` | Chạy trên target database thật; guard từ chối nếu tên vi phạm |
| `SAFE-R04` | Regex validation unit test cho pattern `^banking_test_[a-f0-9]{32}$` | Runner sinh `banking_test_<run_id>` thật với 32 hex lowercase |
| `SAFE-R05` | Mock test-double cho pre-create classification logic | Truy vấn catalog `pg_database` thật trên admin DB xác nhận target chưa tồn tại |
| `SAFE-R06` | Test-double cho việc tạo lệnh SQL `COMMENT ON DATABASE` | Thực thi `COMMENT ON DATABASE` thật; query `shobj_description` đọc lại đúng `run_id` |
| `SAFE-R07` | Unit test kiểm tra logic so sánh marker trước drop | Query `shobj_description` thật trước khi drop; xác thực marker khớp `run_id` |
| `SAFE-R08` | Mock test-double cho parameterized terminate backend và drop database | Thực thi `pg_terminate_backend(pid)` cho đúng target DB và DROP DATABASE đích danh |
| `SAFE-R09` | Assertion kiểm tra cấu hình timeout trong code harness | Bounded execution thật; đo runtime câu lệnh, abort signal khi vượt trần thời gian |
| `SAFE-R10` | Mô phỏng child failure/timeout và xác minh cleanup orchestration được gọi | Bắt signal/failure thật; xác minh exact database và container đã được cleanup sạch sẽ |
| `SAFE-R11` | Mock test-double cho catalog verification sau drop | Query `pg_database` thật xác nhận target DB đã biến mất hoàn toàn khỏi catalog |

## 8. Đối chiếu năng lực bằng chứng của M07-A2 (A2 Evidence-Capability Reconciliation)

Trước khi kích hoạt M07-A2, năng lực của các script/test hiện có trong codebase được đối chiếu cụ thể như sau:

| Yêu cầu của M07-A2 | Script / Test hiện có | Exact Symbol / Lệnh | Có đủ evidence? | Đánh giá hiện trạng |
| ------------------ | --------------------- | ------------------- | --------------- | ------------------- |
| Apply 001–040 from empty | `backend/scripts/apply-migration.cjs` qua `run-disposable-postgres-test.ts` | `main()` lines 76–77 | Yes | Runner áp dụng tuần tự toàn bộ 40 migration vào target DB |
| Exactly 40 history rows | Không có test nào trong snapshot | Không có assertion | No | **BLOCKED — M07-A2 EVIDENCE HARNESS GAP**; thiếu test query `SELECT COUNT(*) FROM reference_schema_migrations` và assert 40 |
| Rerun keeps 40 rows | `backend/scripts/apply-migration.cjs` | Mode `apply` / `verify-only` | No | **BLOCKED — M07-A2 EVIDENCE HARNESS GAP**; chưa có kịch bản chạy lặp 2 lần trên cùng disposable DB trong test harness |
| Checksum mismatch refused | `backend/scripts/apply-migration.cjs` | Checksum comparison throw | No | **BLOCKED — M07-A2 EVIDENCE HARNESS GAP**; chưa có test harness tự động inject synthetic checksum mismatch trên DB thật |
| Migration-set fingerprint | `backend/scripts/migration-fingerprint.cjs` & `migrationFingerprint.test.ts` | `fingerprint(directory)` | Yes | Offline digest qua các kiểu newline được chứng minh độc lập bởi test |
| Cleanup / postcondition | `backend/scripts/run-disposable-postgres-test.ts` | `finally` block lines 121–126 | No | **BLOCKED — M07-A2 EVIDENCE HARNESS GAP**; có lệnh drop nhưng thiếu post-drop assertion truy vấn catalog `pg_database` |

*Kết luận năng lực A2*: Snapshot hiện tại có runner `apply-migration.cjs` và `migration-fingerprint.cjs`, nhưng thiếu suite test kiểm chứng tự động cho 4 khía cạnh runtime (40 history rows, rerun count invariant, mismatch refusal, post-drop catalog verification). Không tự ý mở allowlist để sửa runner trong A2; việc bổ sung test harness sẽ cần Owner quyết định phê duyệt bổ sung nếu không dùng runner script độc lập.

## 9. Source-of-truth inventory và khảo sát hiện trạng

Không dùng một thứ tự ưu tiên chung cho mọi loại dữ liệu. M01-07 đối chiếu theo loại source sau:

| Loại dữ liệu | Source of truth | Cách xác minh | Hiện trạng đã khảo sát |
| ------------ | --------------- | ------------- | ---------------------- |
| Database schema | backend/database/*.sql và reference_schema_migrations | Đếm, sort numeric, migration từ rỗng, history/checksum và verify-only | Có migration 001–040; chưa chạy DB trong lượt này |
| Migration runner | backend/scripts/apply-migration.cjs | Kiểm tra transaction từng migration, checksum mismatch và pending set | Có advisory lock theo migration key; runtime proof còn thiếu |
| Migration set | backend/scripts/migration-fingerprint.cjs | Đối chiếu first/last/schema version/digest với evidence | Có script read-only; chưa ghi evidence mới |
| Database safety | backend/src/database/disposableDatabaseGuard.ts và runner | Guard marker, host, DB-name, reference URL, cleanup ownership | Guard có fail-closed cơ bản; safety protocol đầy đủ chưa được chứng minh |
| Transaction | backend/src/database/unitOfWork.ts | BEGIN/COMMIT/ROLLBACK, isolation, retry 40001/40P01 và row lock | Có READ COMMITTED, REPEATABLE READ, SERIALIZABLE, retry hữu hạn |
| Pool | backend/src/database/pool.ts | Pool limits, timeout, SSL và health/slow query metadata | Có pool config; chưa đo runtime trên disposable |
| Registration | backend/src/database/registrationService.ts, customerRepository.ts, mfaRepository.ts | DB process race và invariant queries | Có FOR UPDATE, unique constraints, compensation; chưa có run thật |
| KYC | backend/src/database/kycService.ts | DB lock/concurrency/status/side-effect assertions | Có lockOpen, partial unique index, version và canonical status; chưa có KYC relational file riêng |
| Audit | backend/src/database/repositories/auditRepository.ts | Count, append-only, transaction rollback | Unit/contract có; DB evidence chưa có |
| Outbox | backend/src/database/repositories/outboxRepository.ts, backend/src/outbox/postgresOutboxRepository.ts | Count, dedup key, committed vs rolled back row | Claim/lease worker có source; worker runtime không phải kết luận cốt lõi của M01-07 |
| Test runner | backend/scripts/run-disposable-postgres-test.ts | Guard trước create, exact target, finally cleanup, timeout/redaction | Có unique banking_test_* và cleanup; cần hardening theo 11 quy tắc an toàn |
| Test entrypoint | backend/package.json và test files | Đọc script thật trước khi chạy | Có test:database, test:relational, test:registration:persistence; không tự thêm script |
| Compose | compose.yaml | Chỉ đọc image/profile/volume/env names | Postgres 16 digest và volume banking_preview_pgdata; preview tuyệt đối không được động vào |
| API contract | documents/api/banking-mvp.openapi.yaml, runtime validators/routes | Chỉ regression check khi test được owner cho phép | M01-07 không sửa API; OpenAPI/runtime proof chính thuộc M01-03/M01-04/M01-05 |

### 9.1 Migration/schema invariants cần đối chiếu

| Nhóm migration | Invariant chính | Kiểm tra bắt buộc |
| -------------- | --------------- | ----------------- |
| 001_banking_mvp.sql | Customer/account/transfer/ledger/audit/outbox nền tảng và foreign key | Tạo từ rỗng, tồn tại đúng bảng/constraint, rollback không để orphan |
| 006_relational_v2_foundation.sql | Account sequence/unique account, quote fingerprint, transfer quote uniqueness, idempotency và outbox dedup/index | Constraint/index tồn tại đúng tên và chịu được race |
| 007_identity_runtime_normalization.sql | auth_challenges, pending_registrations, unique lower email/phone, expiry/attempts/device/purpose | Registration fixture và concurrent duplicate |
| 011_registration_recovery.sql | registration_completions one-time mapping customer/account | Verify race chỉ có một completion |
| 012_outbox_worker.sql, 013_outbox_worker_operations.sql | PENDING/PROCESSING/DISPATCHED/DEAD/SKIPPED, lease/dead-letter/updated-at/index | Business event commit/rollback và dedup; worker riêng chỉ khi checkpoint được mở |
| 015–018 | Challenge hardening, MFA recovery/security metadata và canonical method/purpose constraints | Purpose/method alias bị từ chối, metadata không raw |
| 020_admin_case_operations.sql | KYC application nền tảng, status/version/review data | Schema và public KYC row mapping không lẫn Admin contract |
| 033–034 | Control policy bootstrap/rate-limit policy | Chỉ kiểm tra khi dependency cần; không mở rộng M01-07 sang Admin policy |
| 038_customer_kyc_runtime.sql | Canonical NEEDS_MORE_INFO, synthetic payload, submitted timestamp, one-open partial unique index, customer history index | Concurrent save/submit, rejected immutable và version/side-effect assertions |
| 039–040 | Migration sau KYC runtime trong bộ hiện hành | History/checksum/order; không sửa migration đã áp dụng |

Không migration nào được sửa trong M01-07 để làm test pass. Nếu migration history/checksum không khớp, dừng và mở issue/task sửa migration riêng.

## 10. Test architecture hiện tại và reconcile chính xác 48 skipped tests

backend/package.json là nguồn duy nhất để chọn command:

- `npm test` chạy `node scripts/run-core-tests.cjs`.
- `npm run test:database`, `npm run test:relational`, `npm run test:registration:persistence` và các script persistence khác dùng `scripts/run-disposable-postgres-test.ts`.
- Không có script `test:m01-07`; không thêm script trong task documentation-only.
- `run-core-tests.cjs` loại toàn bộ `workerOutbox.test.ts` khỏi aggregate.
- 48 test dưới đây skip khi thiếu database URL. Chúng không phải là 48 test PostgreSQL đã pass.
- `workerOutbox.test.ts` có 9 test database riêng và không nằm trong 48 skip của core aggregate; worker evidence phải được phân biệt riêng.

| # | Test/file | Skip condition | Dependency | M01-07 ownership | Lý do hiện chưa là evidence |
| - | --------- | -------------- | ---------- | ---------------- | ---------------------------- |
| 1 | admin.database.test.ts — PostgreSQL Admin funding action is typed, atomic and single-execution | !databaseUrl | Admin database | Ngoài core M01-07, chỉ dùng làm regression nếu dependency | Chưa chạy database |
| 2 | admin.database.test.ts — customer and Admin KYC workflow reads and mutates the same persistent application | !databaseUrl | Admin/KYC database | M01-07 chỉ kiểm tra không phá KYC row; Admin workflow thuộc scope khác | Chưa chạy database |
| 3 | admin.database.test.ts — PostgreSQL Admin funding rolls back when ledger or outbox execution faults | !databaseUrl | Admin/ledger/outbox | Ngoài Registration/KYC customer slice | Chưa chạy database |
| 4 | admin.database.test.ts — PostgreSQL fraud notes are parameterized and sanitized before persistence | !databaseUrl | Admin/fraud database | Ngoài M01-07 | Chưa chạy database |
| 5 | admin.database.test.ts — PostgreSQL account and customer access locks survive repository restart | !databaseUrl | Admin/account repository | Ngoài M01-07 | Chưa chạy database |
| 6 | admin.database.test.ts — PostgreSQL Admin funding and transfer reversals are balanced and idempotent | !databaseUrl | Admin/ledger/transfer | Ngoài M01-07 | Chưa chạy database |
| 7 | admin.database.test.ts — legacy public replay preserves append-only Admin audit and Outbox rows | !databaseUrl | Admin/audit/outbox | Chỉ dùng làm non-regression khi owner mở rộng | Chưa chạy database |
| 8 | admin.database.test.ts — PostgreSQL Admin outbox requeue accepts only canonical DEAD/SKIPPED events | !databaseUrl | Admin/outbox | Ngoài M01-07 | Chưa chạy database |
| 9 | admin.database.test.ts — Admin outbox requeue hands a canonical event to the worker exactly once | !databaseUrl | Admin/worker/outbox | Worker scope riêng | Chưa chạy database |
| 10 | creditRelational.test.ts — relational credit payment is atomic, prevents concurrent overpay and is restart-readable | !databaseUrl | Credit relational | Ngoài M01-07 | Chưa chạy database |
| 11 | creditRelational.test.ts — relational credit payment rollback leaves quote, balances, ledger and outbox untouched | !databaseUrl | Credit/ledger/outbox | Ngoài M01-07 | Chưa chạy database |
| 12 | creditRelational.test.ts — credit repayment remains available while new credit is frozen and fails closed only on its command switch | !databaseUrl | Credit/control policy | Ngoài M01-07 | Chưa chạy database |
| 13 | creditRelational.test.ts — relational credit application activation creates account and card without a zero placeholder statement | !databaseUrl | Credit/card | Ngoài M01-07 | Chưa chạy database |
| 14 | creditRelational.test.ts — persistent card lock is emergency-safe and idempotent while unlock remains policy-gated | !databaseUrl | Credit/card | Ngoài M01-07 | Chưa chạy database |
| 15 | creditRelational.test.ts — reported-lost card is blocked and creates one durable operations case under concurrency | !databaseUrl | Credit/Admin cases | Ngoài M01-07 | Chưa chạy database |
| 16 | databaseFoundation.test.ts — migration 035 backfills only trustworthy credit cycle evidence and marks ambiguity | !databaseUrl | Migration/credit | Chỉ migration regression ngoài KYC/Registration | Chưa chạy database |
| 17 | databaseFoundation.test.ts — control policy is bootstrapped once and missing policy fails persistent readiness closed | !databaseUrl | Control policy | Ngoài M01-07 | Chưa chạy database |
| 18 | databaseFoundation.test.ts — relational-v2 UnitOfWork rolls back and retries only retryable errors | !databaseUrl | UnitOfWork | Dùng làm prerequisite transaction evidence | Chưa chạy database |
| 19 | databaseFoundation.test.ts — direct transfer use case is idempotent, lock-ordered and atomically persisted | !databaseUrl | Transfer/ledger | Ngoài M01-07 | Chưa chạy database |
| 20 | databaseFoundation.test.ts — fault after ledger write leaves no partial relational transfer | !databaseUrl | Transfer/ledger/outbox | Ngoài Registration/KYC | Chưa chạy database |
| 21 | databaseFoundation.test.ts — direct transfer quotes and submits enforce the current control policy without financial side effects | !databaseUrl | Transfer/control policy | Ngoài M01-07 | Chưa chạy database |
| 22 | databaseFoundation.test.ts — login rate-limit buckets lock before password verification, expire safely and reset on success | !databaseUrl | Auth/rate limit | Registration rate-limit proof có thể tham chiếu; login thuộc scope khác | Chưa chạy database |
| 23 | databaseFoundation.test.ts — persistent KYC draft/submit is idempotent, synthetic-only and emits one committed security intent | !databaseUrl | KYC/audit/outbox | M01-07 KYC baseline | Chưa chạy database |
| 24 | databaseFoundation.test.ts — beneficiary delete/block semantics preserve transfer counterparty snapshots | !databaseUrl | Beneficiary/transfer | Ngoài M01-07 | Chưa chạy database |
| 25 | databaseFoundation.test.ts — database keyset pagination returns more than 1000 account transactions without duplicates or cursor scope leaks | !databaseUrl | Account transactions | Ngoài M01-07 | Chưa chạy database |
| 26 | databaseFoundation.test.ts — normalized registration allocates a database sequence account atomically | !databaseUrl | Registration/account sequence | Registration prerequisite | Chưa chạy database |
| 27 | integratedDisposable.test.ts — integrated relational-v2 rehearsal uses HTTP OTP capture, two workers and two lifecycle schedulers | !databaseUrl | API/worker/scheduler | Worker/lifecycle evidence deferred; không thay M01-07 core proof | Chưa chạy database |
| 28 | lifecycleRelational.test.ts — Savings maturity/renewal is durable, balanced and one-shot across concurrent catch-up | !databaseUrl | Savings/lifecycle | Ngoài M01-07 | Chưa chạy database |
| 29 | lifecycleRelational.test.ts — savings kill switch is command-only and maturity falls back when a product is retired | !databaseUrl | Savings/control policy | Ngoài M01-07 | Chưa chạy database |
| 30 | lifecycleRelational.test.ts — savings maturity moves an unavailable destination to durable suspense instead of leaving it ACTIVE | !databaseUrl | Savings/suspense | Ngoài M01-07 | Chưa chạy database |
| 31 | lifecycleRelational.test.ts — savings suspense retries with backoff then dead-letters exactly once | !databaseUrl | Savings/outbox/worker | Ngoài M01-07 | Chưa chạy database |
| 32 | lifecycleRelational.test.ts — credit statement cycles use a half-open boundary without losing the cycle-end transaction | !databaseUrl | Credit/lifecycle | Ngoài M01-07 | Chưa chạy database |
| 33 | lifecycleRelational.test.ts — Credit close, overdue, pending payment and reversal are idempotent and never overpay | !databaseUrl | Credit/lifecycle | Ngoài M01-07 | Chưa chạy database |
| 34 | lifecycleRelational.test.ts — scheduled lifecycle and worker can run together, then restart without replay | !databaseUrl | Lifecycle/worker | Ngoài M01-07 | Chưa chạy database |
| 35 | lifecycleScheduler.test.ts — two lifecycle schedulers claim a due savings maturity once and expose successful readiness | !databaseUrl | Scheduler | Worker/scheduler scope riêng | Chưa chạy database |
| 36 | mfaPersistence.test.ts — persistent MFA lifecycle is transactional, one-time and restart-safe | !databaseUrl | MFA persistence | Chỉ registration challenge dependency khi cần | Chưa chạy database |
| 37 | persistence.test.ts — persistent HTTP validates the request body before opening the snapshot transaction | !databaseUrl | Persistent HTTP | HTTP fake/contract chính thuộc M01-04 | Chưa chạy database |
| 38 | persistence.test.ts — PostgreSQL snapshot persists users and serializes concurrent transfer submit | !databaseUrl | Legacy snapshot/transfer | Ngoài M01-07 | Chưa chạy database |
| 39 | persistence.test.ts — PostgreSQL snapshot keeps fraud reports idempotent, restartable and user-scoped | !databaseUrl | Fraud snapshot | Ngoài M01-07 | Chưa chạy database |
| 40 | persistence.test.ts — PostgreSQL persistent HTTP server restores state across restart | !databaseUrl | Persistent HTTP | Có thể tham chiếu restart protocol; không thay M01-08 device proof | Chưa chạy database |
| 41 | persistence.test.ts — PostgreSQL snapshot persists a savings opening across restart | !databaseUrl | Savings snapshot | Ngoài M01-07 | Chưa chạy database |
| 42 | persistence.test.ts — PostgreSQL snapshot persists M7 credit state and serializes concurrent payment | !databaseUrl | Credit snapshot | Ngoài M01-07 | Chưa chạy database |
| 43 | registrationRelational.test.ts — relational registration persists only OTP digest, uses outbox intent and completes once | !databaseUrl | Registration/MFA/audit/outbox | M01-07 registration baseline | Chưa chạy database |
| 44 | relationalPersistence.test.ts — relational adapter persists restart state, serializes one quote submission and rehearses logical restore | !databaseUrl | Relational adapter/transfer | Ngoài Registration/KYC; chỉ regression nếu cần | Chưa chạy database |
| 45 | remainingRelational.test.ts — recipient lookup is persistent, hashed and usable by relational transfer quote | !databaseUrl | Beneficiary/transfer | Ngoài M01-07 | Chưa chạy database |
| 46 | remainingRelational.test.ts — notifications and fraud reports use relational ownership and idempotency | !databaseUrl | Notification/fraud | Outbox row check có thể tham chiếu; nghiệp vụ ngoài scope | Chưa chạy database |
| 47 | savingsRelational.test.ts — relational savings opening is atomic, idempotent and restart-readable | !databaseUrl | Savings | Ngoài M01-07 | Chưa chạy database |
| 48 | savingsRelational.test.ts — relational savings rollback leaves no opening, deposit or debit | !databaseUrl | Savings/ledger | Ngoài M01-07 | Chưa chạy database |

Tổng reconcile: 48 test database-skipped trong core aggregate, 0 được coi là pass trong lượt documentation-only. workerOutbox.test.ts có 9 test riêng và không được cộng vào con số này.

## 11. Bảng đối chiếu Event thực tế từ Source Code (Source-Backed Event Inventory)

Các event name trong kế hoạch được đối chiếu trực tiếp từ mã nguồn triển khai; không sử dụng event name giả định:

| Nghiệp vụ / Flow | Audit Event | Outbox Event | Notification | Expected Counts | Source File & Implementation Symbol |
| ---------------- | ----------- | ------------ | ------------ | --------------- | ----------------------------------- |
| Registration Begin (mới) | `REGISTRATION_STARTED` | *(Không tạo)* | *(Không tạo)* | Audit: 1, Outbox: 0, Notif: 0 | `backend/src/database/registrationService.ts::RelationalRegistrationService.begin` (line 121) |
| Registration Begin (dọn dẹp expired) | `REGISTRATION_PENDING_CLEANUP` | *(Không tạo)* | *(Không tạo)* | Audit: 1, Outbox: 0, Notif: 0 | `backend/src/database/registrationService.ts::RelationalRegistrationService.begin` (line 91) |
| Registration Verify (thành công) | `CUSTOMER_REGISTERED` | `CUSTOMER_REGISTERED` | *(Không tạo trực tiếp tại DB)* | Audit: 1, Outbox: 1, Notif: 0 | `backend/src/database/registrationService.ts::RelationalRegistrationService.verify` (lines 263, 271) & `backend/src/outbox/eventRegistry.ts` (line 36) |
| Registration Cancel | *(Không tạo)* | *(Không tạo)* | *(Không tạo)* | Audit: 0, Outbox: 0, Notif: 0 | `backend/src/database/registrationService.ts::RelationalRegistrationService.cancel` |
| KYC Save Draft (mới / cập nhật) | `KYC_DRAFT_SAVED` | *(Không tạo)* | *(Không tạo)* | Audit: 1, Outbox: 0, Notif: 0 | `backend/src/database/kycService.ts::RelationalKycService.saveDraft` (line 253) |
| KYC Submit (nộp hồ sơ lần đầu/tăng version) | `KYC_SUBMITTED` | `SECURITY_KYC_SUBMITTED` | `notifications` row (type: `SECURITY`) | Audit: 1, Outbox: 1, Notif: 1 | `backend/src/database/kycService.ts::RelationalKycService.submit` (lines 337, 346, 354) & `backend/src/outbox/eventRegistry.ts` (line 67) |
| KYC Submit (Replay idempotent cùng fingerprint) | *(Không tạo thêm)* | *(Không tạo thêm)* | *(Không tạo thêm)* | Audit: 0 (mới), Outbox: 0 (mới), Notif: 0 (mới) | `backend/src/database/kycService.ts::RelationalKycService.submit` (line 300) |

*Ghi chú*: Kế hoạch v4 chỉ sử dụng các event name đã được kiểm chứng trực tiếp từ mã nguồn triển khai thực tế. Mọi event name giả định không tồn tại trong codebase đều đã bị loại bỏ hoàn toàn.

## 12. Kế hoạch xác minh Registration (Registration Verification Plan)

### M07-B-REG — Duplicate, pending, challenge, completion và cryptography

Mục tiêu: chứng minh `registrationService` và các repository hoạt động chính xác trên PostgreSQL disposable thật, xử lý race-condition bằng row lock và transaction isolation, không sửa service để làm test pass.

Đặc tả kỹ thuật cryptography và rate-limiting:
- Registration tính fingerprint mạng thông qua hàm `computeRegistrationNetworkFingerprint(request.socket.remoteAddress, registrationFingerprintKey)`.
- Công thức: `HMAC-SHA-256(key, normalized socket.remoteAddress)` với prefix phân tách miền `DOMAIN_SEPARATION_PREFIX = "registration-rate-limit:"`.
- Chuẩn hóa remoteAddress: chuyển đổi địa chỉ `::ffff:x.x.x.x` IPv4-mapped IPv6 thành IPv4 thuần `x.x.x.x`, loại bỏ khoảng trắng và chuyển sang chữ thường.
- Registration derive bucket duy nhất từ socket connection address; tuyệt đối không dùng header `X-Forwarded-For` (header này dễ bị client giả mạo).
- Bucket key lưu trữ trong bảng `rate_limit_buckets`: `relational-registration:<64 lowercase hexadecimal characters>`.
- Tuyệt đối không dùng unkeyed SHA-256 hay phép nối chuỗi key và identifier.
- Test runner được phép so sánh fingerprint trong memory; tuyệt đối không in full fingerprint, secret key hoặc raw IP ra test report hoặc evidence artifact.

Các kịch bản và kết quả nghiệp vụ chuẩn xác:

1. **Hai begin cùng email, phone khác**:
   - HTTP route: Winner trả `202 Accepted` (`documents/api/banking-mvp.openapi.yaml:42`, `backend/src/http.ts:806`), loser trả `409 Conflict`.
   - Domain outcome: Winner tạo pending registration với `expires_at` và `device_id`, khởi tạo email challenge; loser nhận `ConflictError`.
   - Database state: Đúng 1 row được tạo trong bảng `pending_registrations` (schema không có cột `status`; HTTP response body trả `status: PENDING_VERIFICATION`). Bảng có index duy nhất `pending_registrations_email_idx` trên `lower(email)` và `pending_registrations_phone_idx` trên `phone_number` (migration `007_identity_runtime_normalization.sql`).
   - Audit/Outbox: 1 audit event `REGISTRATION_STARTED` (payload `{}`), 0 outbox event.
2. **Hai begin cùng phone, email khác**: Tương tự, winner trả `202 Accepted`, loser trả `409 Conflict`.
3. **Hai begin đồng thời cùng cặp contact**: Invariant unique index `pending_registrations_email_idx` và `pending_registrations_phone_idx` giữ vững; winner `202 Accepted`, loser `409 Conflict`.
4. **Pending hết hạn tồn tại**: Begin mới kích hoạt dọn dẹp; giải phóng challenge liên kết và xóa pending cũ an toàn; ghi 1 audit `REGISTRATION_PENDING_CLEANUP` (payload `{}`); request mới được cấp phép và tạo pending mới.
5. **Pending active bị lặp begin**: Trả `409 Conflict`, không làm mới challenge token hoặc kéo dài thời hạn trái policy.
6. **Pending và challenge khác device/purpose**: Cách ly hoàn toàn; không thể hủy nhầm challenge của phiên khác.
7. **Hai verify đồng thời cùng một challengeId/code**:
   - HTTP route: Winner trả `201 Created` (`documents/api/banking-mvp.openapi.yaml:68`, `backend/src/http.ts:847`); loser trả `409 Conflict`.
   - Domain outcome: Winner tạo đúng 1 customer, 1 tài khoản thanh toán, entitlements `TRANSFERS`, `SAVINGS`, `CREDIT`, và 1 bản ghi `registration_completions`. Loser nhận `RelationalConflictError("REGISTRATION_ALREADY_CONSUMED", ...)`.
   - Audit/Outbox: Đúng 1 audit event `CUSTOMER_REGISTERED` và đúng 1 outbox event `CUSTOMER_REGISTERED`.
8. **Verify replay sau completion**: Bị từ chối dứt khoát với HTTP `409 Conflict`, không tạo thêm dữ liệu.
9. **Cancel challenge đang ACTIVE và chưa hết hạn**:
   - HTTP route: Trả `204 No Content` (`documents/api/banking-mvp.openapi.yaml:96`, `backend/src/http.ts:891`).
   - Domain outcome: Challenge chuyển trạng thái `CANCELLED`, pending registration được detach và xóa sạch (`consumePendingRegistration`).
10. **Cancel challenge đã CANCELLED**: Trả `204 No Content` (idempotent, không đổi trạng thái).
11. **Cancel challenge đã EXPIRED**: Trả `204 No Content` (idempotent, dọn dẹp pending nếu còn).
12. **Cancel sai device hoặc sai purpose**: Trả HTTP `404 Not Found` (domain `RelationalNotFoundError` với thông điệp đã redact), không thay đổi DB.
13. **Cancel khi registration đã COMPLETED**: Trả HTTP `409 Conflict` (`RelationalConflictError("REGISTRATION_ALREADY_COMPLETED", "Registration is already completed.")`).
14. **Bồi hoàn khi lỗi provider sau begin commit**: Khi email challenge provider thất bại sau khi pending registration đã được insert, cơ chế compensation kích hoạt dọn dẹp sạch sẽ, không để lại pending orphan hay challenge reference mồ côi.
15. **Giới hạn tốc độ đăng ký (REG-15)**: Bucket lưu `relational-registration:<fingerprint>` cập nhật nguyên tử; audit event được kiểm tra là `REGISTRATION_STARTED` với payload `{}` (không có audit event riêng cho rate limit bucket).
16. **Restart read**: Đóng connection pool, mở connection pool mới tới cùng database disposable -> Dữ liệu đã commit đọc đầy đủ, chính xác.
17. **Rollback toàn phần**: Lỗi trước khi COMMIT kích hoạt ROLLBACK; không để lại bản ghi rác nào.

## 13. Kế hoạch xác minh KYC (KYC Verification Plan)

### M07-C-KYC — Dedicated Relational KYC Suite

Mục tiêu: kiểm chứng database invariant của D-10, D-11, D-14 và D-15 bằng PostgreSQL thật qua file test chuyên biệt `backend/src/tests/kycRelational.test.ts`.

Quy định bảo mật danh tính tổng hợp (Synthetic Identity Boundary):
- Synthetic identity đầy đủ (6–24 chữ số) được phép serialize và lưu trữ duy nhất trong cột `kyc_applications.synthetic_payload` (migration `038_customer_kyc_runtime.sql`).
- Được phép so sánh full synthetic identity trong bộ nhớ (memory) phục vụ test assertion.
- Tuyệt đối không để lộ full synthetic identity trong HTTP response, error message, console log, assertion failure message, báo cáo test hoặc artifact tài liệu.
- Public response chỉ trả về `identityNumberLast4` gồm đúng 4 chữ số.

Quy định chuẩn xác về timestamp `submitted_at` trong `RelationalKycService.saveDraft`:
- Trường hợp tạo hồ sơ `DRAFT` mới: `submitted_at` mang giá trị `NULL`.
- Trường hợp cập nhật hồ sơ `DRAFT` đã có: `submitted_at` được gán rõ ràng bằng `NULL`.
- Trường hợp cập nhật hồ sơ ở trạng thái `NEEDS_MORE_INFO`: Câu truy vấn UPDATE không chạm vào cột `submitted_at`, do đó timestamp `submitted_at` ban đầu được bảo toàn nguyên vẹn (`preserved`), tuyệt đối không bị ghi đè thành `NULL`.

Các kịch bản và kết quả nghiệp vụ chuẩn xác:

1. **Lưu DRAFT hợp lệ lần đầu (`saveDraft`)**:
   - HTTP route: Trả `200 OK` (`documents/api/banking-mvp.openapi.yaml:1272`).
   - Domain outcome: Tạo bản ghi `kyc_applications` với trạng thái `DRAFT`, `submitted_at = NULL`, `version = 1`.
   - Audit/Outbox: 1 audit event `KYC_DRAFT_SAVED`, 0 outbox event.
2. **Lưu DRAFT với dữ liệu không hợp lệ / URI sai**: Bị reject tại validation với HTTP `422 Unprocessable Entity`, không tạo row.
3. **Hai thao tác save DRAFT đồng thời cho cùng một customer**: Partial unique index `kyc_applications_customer_open_idx` (`WHERE status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_MORE_INFO')`) đảm bảo tối đa một hồ sơ mở; winner trả `200 OK`, loser nhận HTTP `409 Conflict`.
4. **Lưu DRAFT khi không đổi identity (D-15)**: Request bỏ qua trường `identityNumber` -> Hệ thống giữ nguyên full synthetic identity trong DB; response trả `200 OK` với `identityNumberLast4` đúng 4 chữ số.
5. **Lưu DRAFT khi đổi identity**: Gửi full synthetic identity mới hợp lệ -> Cập nhật payload mới; response trả `200 OK` với `identityNumberLast4` mới.
6. **Lưu DRAFT với identity masked hoặc chỉ 4 số**: Bị reject tại validation với HTTP `422 Unprocessable Entity`.
7. **Identity có số 0 ở đầu (Leading zero)**: Lưu trữ nguyên vẹn dưới dạng text, trích xuất `identityNumberLast4` có số 0 ở đầu đủ 4 ký tự, không bị ép kiểu số nguyên:
   - saveDraft outcome: 200 OK
   - submit outcome: 201 Created
8. **Nộp hồ sơ lần đầu (`submit`)**:
   - HTTP route: Trả `201 Created` (`documents/api/banking-mvp.openapi.yaml:1295`).
   - Domain outcome: Trạng thái chuyển sang `SUBMITTED`, `submitted_at = NOW()`, version tăng.
   - Audit/Outbox: Đúng 1 audit event `KYC_SUBMITTED`, đúng 1 outbox event `SECURITY_KYC_SUBMITTED`, đúng 1 thông báo trong bảng `notifications` (`notification_type: 'SECURITY'`).
9. **Hai submit đồng thời cùng request fingerprint (Idempotent replay)**:
   - Cả hai tiến trình đều nhận HTTP `201 Created` với cùng dữ liệu hồ sơ.
   - Không nhân đôi side effect: tổng cộng đúng 1 audit `KYC_SUBMITTED`, đúng 1 outbox `SECURITY_KYC_SUBMITTED`, đúng 1 notification.
10. **Hai submit đồng thời khác request fingerprint khi application đang xử lý**: Tiến trình thứ hai bị từ chối với HTTP `409 Conflict` (`conflict("KYC hồ sơ đang được xử lý; không thể thay đổi dữ liệu.")`).
11. **Vòng đời NEEDS_MORE_INFO (D-14)**: Hồ sơ ở trạng thái `NEEDS_MORE_INFO` cho phép `saveDraft` cập nhật dữ liệu (giữ trạng thái `NEEDS_MORE_INFO`, version +1, timestamp `submitted_at` được bảo toàn) và `submit` chuyển sang `SUBMITTED`; các alias như `MORE_INFO_REQUIRED` bị chặn ở validation.
12. **Tính bất biến của APPROVED (D-10 Precedence)**: Hồ sơ đã `APPROVED` chặn mọi thao tác `saveDraft` hoặc `submit`, trả HTTP `409 Conflict`.
13. **Tính bất biến của REJECTED (D-11)**: Hồ sơ bị `REJECTED` là immutable. Khách hàng nộp lại sẽ tạo một bản ghi application hoàn toàn mới với ID mới, giữ nguyên lịch sử cũ, thỏa mãn tối đa 1 open application.
14. **PostgreSQL APPROVED Interleaving (KYC-14)**:
   - Khách hàng đang có open application ở trạng thái `SUBMITTED` hoặc `UNDER_REVIEW`.
   - Transaction của Admin nắm row lock và chuyển trạng thái application sang `APPROVED`.
   - Transaction của khách hàng gọi `saveDraft` hoặc `submit`, bị block chờ tại `lockOpen`.
   - Sau khi Admin transaction COMMIT, `lockOpen` của khách hàng được giải phóng và trả về `null` (vì không còn open application).
   - Transaction của khách hàng tiếp tục thực hiện recheck `APPROVED` trong cùng transaction và phát hiện hồ sơ đã được duyệt.
   - Kết quả: Khách hàng nhận generic `409 Conflict`.
   - Đảm bảo: Không normalize hoặc kế thừa identity; không tạo application mới; không phát sinh audit/outbox/notification; có finite `lock_timeout`.
   - Evidence class: Bằng chứng interleaving thực tế trên PostgreSQL disposable, không dùng test-double.
15. **Database Error Mapping (KYC-15)**:
   - Lỗi PostgreSQL code `23505` trên constraint `kyc_applications_customer_open_idx` được ánh xạ thành generic `409 Conflict`.
   - Lỗi `23505` trên primary key `kyc_applications_pkey` được rethrow trực tiếp, không nuốt thành conflict.
   - Lỗi unknown unique, foreign-key hoặc lỗi DB khác đều được rethrow; không tạo audit/outbox/notification dở dang.
16. **Restart read (KYC-16)**: Đóng pool, mở connection pool mới -> Dữ liệu KYC đã commit đọc chính xác, đầy đủ.

## 14. Tính nguyên tử, Audit, Outbox và Restart Safety

### M07-D-ATOMIC — Ranh giới Transaction và Side Effect Consistency

Mọi nghiệp vụ Registration và KYC trên PostgreSQL disposable tuân thủ thứ tự:

`validate/lock` → `mutate business tables` → `ledger/balance (nếu có)` → `audit append` → `outbox intent append` → `COMMIT`

Khi xảy ra lỗi ở bất kỳ bước nào:
- Transaction thực hiện ROLLBACK toàn bộ.
- Số lượng bản ghi business, audit, và outbox không tăng.
- Không tồn tại trạng thái dở dang (orphan rows).
- Retry an toàn dựa trên idempotency key / request fingerprint.

### M07-D-RESTART — Độ an toàn qua chu kỳ khởi động lại (Restart Safety)

1. Thực hiện flow hoàn chỉnh và COMMIT.
2. Đóng kết nối database pool, hủy đối tượng repository.
3. Mở kết nối pool mới tới cùng disposable database.
4. Đọc lại trạng thái: Dữ liệu đã commit phải đọc được nguyên vẹn và nhất quán.
5. Thử lại command đã hoàn tất: Không sinh thêm side effect lặp.
6. Kết thúc test, runner dọn dẹp đúng database đích bằng revalidation marker.

## 15. Ma trận rủi ro và các checkpoint đề xuất

| Kịch bản | Bảng / Index / Schema | Service / Component | Test hiện tại | Khoảng trống bằng chứng | Rủi ro | Checkpoint xử lý |
| -------- | --------------------- | ------------------- | ------------- | ----------------------- | ------ | ---------------- |
| An toàn database runner | Marker, host, target name | `disposableDatabaseGuard.ts` | `disposableDatabaseGuard.test.ts` | Thiếu unit test cho 11 quy tắc SAFE-R | Xóa nhầm preview DB | **M07-A1** (NO DB) |
| Migrate từ rỗng | 001–040, `reference_schema_migrations` | `apply-migration.cjs` | `migrationFingerprint.test.ts` | Chưa chạy 001-040 trên DB rỗng | Schema không tái hiện được | **M07-A2** |
| Rerun / Checksum | Checksum, history | `apply-migration.cjs` | Checksum unit tests | Chưa có evidence rerun an toàn | Drift hoặc ghi đè schema | **M07-A2** |
| Concurrent begin email | Unique `pending_registrations_email_idx` | `registrationService.ts` | `registrationRelational.test.ts` | Race 2 tiến trình chưa có DB proof | Nhân đôi pending | **M07-B** |
| Concurrent begin phone | Unique `pending_registrations_phone_idx` | `registrationService.ts` | `registrationRelational.test.ts` | Race 2 tiến trình chưa có DB proof | Nhân đôi pending | **M07-B** |
| Concurrent verify OTP | `registration_completions` | `registrationService.ts` | Relational test có skip | Race hoàn tất tạo 2 customer | 2 tài khoản cho 1 OTP | **M07-B** |
| Cancel binding / idempotency | `auth_challenges` | `registrationService.ts` | Contract unit mock | Chưa verify DB row lock & replay | Hủy nhầm hoặc leak challenge | **M07-B** |
| Rate limit bucket privacy | `rate_limit_buckets` | `mfaRepository.ts` | Unit tests | HMAC 64-hex chưa verify trên DB | Lộ PII trong bucket key | **M07-B** |
| KYC one-open constraint | `kyc_applications_customer_open_idx` | `kycService.ts` | Foundation test skipped | Chưa có suite KYC relational riêng | 2 hồ sơ mở cùng lúc | **M07-C** (NEW) |
| KYC REJECTED immutable | Status check, history index | `kycService.ts` | Contract tests | Chưa verify tính bất biến trên DB | Ghi đè hồ sơ bị từ chối | **M07-C** (NEW) |
| KYC identity privacy | `synthetic_payload`, last4 | `kycService.ts` | Contract tests | Chưa scan log/evidence trên DB | Lộ full identity ra output | **M07-C** (NEW) |
| KYC APPROVED interleaving | `kyc_applications` row lock | `kycService.ts` | `kycContract.test.ts` (test-double) | Chưa có PostgreSQL runtime interleaving | Bỏ sót race condition DB thật | **M07-C** (NEW) |
| Transaction rollback | Mọi bảng liên quan | `unitOfWork.ts` | Skipped test | Chưa verify rollback toàn phần | Dữ liệu dở dang (orphan) | **M07-D** |
| Pool restart | State persistence | Pool, Repositories | Skipped test | Chưa verify reopen pool | Mất dữ liệu sau restart | **M07-D** |

## 16. Cấu trúc Checkpoint và Fixed Allowlists

Mọi checkpoint khi triển khai phải tuân thủ nghiêm ngặt danh sách file được phép sửa (Fixed Allowlist). Tuyệt đối cấm sửa migration SQL đã áp dụng, cấm sửa core business service, và cấm sửa mobile/admin.

### 16.1 Checkpoint M07-A1 — Guard & Runner Hardening (TUYỆT ĐỐI KHÔNG CHẠY DATABASE)

Mục tiêu: Triển khai và kiểm thử logic 11 quy tắc an toàn `SAFE-R01` đến `SAFE-R11` trong code guard và runner hoàn toàn bằng unit tests và test-double. Tuyệt đối không kết nối cơ sở dữ liệu.

Fixed Allowlist:
- `backend/src/database/disposableDatabaseGuard.ts`
- `backend/scripts/run-disposable-postgres-test.ts`
- `backend/src/tests/disposableDatabaseGuard.test.ts`
- `tasks/UC-M01/TASK_M01_07_VERIFY_DISPOSABLE_POSTGRESQL_REGISTRATION_KYC.md`

Gate hoàn thành: Toàn bộ unit test guard pass 100%; chứng minh được các cơ chế chặn host, chặn protected name, bắt buộc loopback numeric, ownership comment pattern và fail-closed logic. Không chạy broad test suite, test:database, test:relational, test:release trong checkpoint này.

### 16.2 Checkpoint M07-A2 — Ephemeral Container & Migration Proof

Mục tiêu: Sau khi M07-A1 đạt và được Owner phê duyệt riêng, khởi tạo ephemeral container PostgreSQL 16 local, thực thi migrate từ rỗng 001–040, xác minh checksum và chạy lại an toàn. Checkpoint này là runtime evidence checkpoint, không có kế hoạch sửa đổi source hay test code.

Fixed Allowlist:
- `tasks/UC-M01/TASK_M01_07_VERIFY_DISPOSABLE_POSTGRESQL_REGISTRATION_KYC.md`

*(Ghi chú: `backend/scripts/apply-migration.cjs` và `backend/src/tests/migrationFingerprint.test.ts` chỉ được đọc và chạy theo snapshot đã commit, không được sửa. Nếu M07-A2 phát hiện cần sửa runner hoặc test, phải dừng với thông báo `BLOCKED — M07-A2 REQUIRES SEPARATE REMEDIATION ALLOWLIST` và chờ Owner quyết định).*

Gate hoàn thành: Toàn bộ 40 migration áp dụng thành công; history table có đúng 40 bản ghi; rerun migration không thay đổi history; target database được drop và xác nhận dọn dẹp sạch sẽ khỏi catalog.

### 16.3 Checkpoint M07-B — Registration Relational Verification

Mục tiêu: Chạy toàn bộ kịch bản relational của Registration trên disposable database.

Fixed Allowlist:
- `backend/src/tests/registrationRelational.test.ts`
- `tasks/UC-M01/TASK_M01_07_VERIFY_DISPOSABLE_POSTGRESQL_REGISTRATION_KYC.md`

Gate hoàn thành: Toàn bộ kịch bản `REG-01` đến `REG-17` pass; không có duplicate completion, không có orphan pending, log evidence sạch thông tin nhạy cảm.

### 16.4 Checkpoint M07-C — Dedicated KYC Relational Verification

Mục tiêu: Thiết lập file test chuyên biệt `kycRelational.test.ts` để kiểm chứng toàn bộ invariant của KYC relational trên disposable database mà không làm ô nhiễm databaseFoundation.

Fixed Allowlist:
- `backend/src/tests/kycRelational.test.ts` (FILE MỚI)
- `tasks/UC-M01/TASK_M01_07_VERIFY_DISPOSABLE_POSTGRESQL_REGISTRATION_KYC.md`

Gate hoàn thành: Toàn bộ kịch bản `KYC-01` đến `KYC-16` pass; xác nhận one-open index, immutability, version increment, interleaving và identity privacy boundary.

### 16.5 Checkpoint M07-D — Atomicity, Rollback, Audit/Outbox và Restart Safety

Mục tiêu: Kiểm chứng rollback toàn phần khi có lỗi, tính nhất quán của audit/outbox events, và khả năng đọc lại sau khi restart pool.

Fixed Allowlist:
- `backend/src/tests/registrationRelational.test.ts`
- `backend/src/tests/kycRelational.test.ts`
- `tasks/UC-M01/TASK_M01_07_VERIFY_DISPOSABLE_POSTGRESQL_REGISTRATION_KYC.md`

*(Ghi chú: Không đưa `backend/src/tests/outboxUnit.test.ts` vào allowlist vì đây là unit test của worker outbox, không thuộc phạm vi relational integration test của Registration/KYC).*

Gate hoàn thành: Rollback không để lại rác; outbox và audit được commit nguyên tử cùng nghiệp vụ; pool restart đọc đúng dữ liệu đã commit; quét PII/secret đạt 100% sạch.

### 16.6 Checkpoint M07-E — Tổng hợp bằng chứng và đóng Task M01-07

Mục tiêu: Redact và tổng hợp toàn bộ bằng chứng thực thi, đối chiếu migration digest, cập nhật trạng thái task.

Fixed Allowlist:
- `tasks/UC-M01/TASK_M01_07_VERIFY_DISPOSABLE_POSTGRESQL_REGISTRATION_KYC.md`

Gate hoàn thành: Toàn bộ bằng chứng đã được sanitize; không có secret hay credential; không mở rộng phạm vi ra ngoài task.

### 16.7 Các file TUYỆT ĐỐI CẤM SỬA ở mọi checkpoint

- `backend/database/*.sql` (toàn bộ file migration đã áp dụng)
- `backend/src/database/registrationService.ts`
- `backend/src/database/kycService.ts`
- `backend/src/database/repositories/*`
- `mobile-app/**`
- `admin-web/**`
- `documents/api/**`
- `compose.yaml`, `.env`, các file cấu hình CI và hạ tầng.

## 17. Ma trận kiểm thử chi tiết (Detailed Test Matrix)

### 17.1 Bảng giới hạn thời gian chờ ứng viên (Candidate Timeouts Table)

| Thao tác / Phạm vi | Giới hạn tối đa (Timeout) | Cơ chế thực thi |
| ------------------ | ------------------------- | --------------- |
| Khởi tạo container tạm | 60 giây | AbortSignal / Docker timeout |
| Kết nối Database pool | 5 giây | `connectionTimeoutMillis: 5000` |
| Khóa dòng / bảng (lock) | 5 giây | `SET lock_timeout = '5s'` |
| Thực thi câu lệnh SQL | 30 giây | `SET statement_timeout = '30s'` |
| Session giao dịch nhàn rỗi | 30 giây | `SET idle_in_transaction_session_timeout = '30s'` |
| Mỗi migration command hoặc mỗi targeted child test command | 180 giây | Test runner child process timeout |
| Dọn dẹp & DROP DATABASE | 30 giây | Async finally block timeout |

### 17.2 Ma trận ca kiểm thử (Detailed Test Cases)

| ID | Precondition | Kịch bản / Luồng thực thi | DB Assertions | Domain / HTTP Outcome | Audit & Outbox Assertions | Cleanup / Timeout | Phân loại bằng chứng |
| -- | ------------ | ------------------------- | ------------- | --------------------- | ------------------------- | ----------------- | -------------------- |
| MIG-01 | DB rỗng, target đã guard | Runner áp dụng 001–040 tuần tự | 40 migration rows, đủ bảng/index | Exit code 0 | Không có business event | Exact DB drop, timeout 180s | Disposable Migration |
| MIG-02 | Schema đã migrate | Áp dụng lại (rerun) | History count giữ nguyên 40 | Exit code 0 | Không có duplicate row | Revalidation cleanup | Disposable Migration |
| MIG-03 | Giả lập checksum mismatch | Migration runner verify | Báo lỗi mismatch, từ chối chạy | Exit code != 0 (redacted) | Không mutate schema | Revalidation cleanup | Disposable Negative |
| SAFE-01 | Chưa tạo DB | Pre-create classification kiểm tra target DB | Xác nhận target chưa tồn tại; không đòi hỏi marker | Sẵn sàng CREATE | Không lộ connection string | Không tạo DB nếu trùng | Guard Unit |
| SAFE-02 | Host ngoài loopback numeric / DB preview | Guard kiểm tra endpoint & tên | Chặn truy cập fail-closed | Lỗi sanitized | Không có connection string | Không drop nhầm | Guard Unit |
| SAFE-03 | M07-A1: Child failure/timeout mô phỏng | Runner test-double giả lập gián đoạn | Xác minh cleanup orchestration được gọi | Process exit != 0 | Báo cáo lỗi sanitized | finally block, timeout 30s | Harness Safety Unit |
| SAFE-04 | M07-A2: Runtime failure thật | Runner chạy test thật bị gián đoạn | Xác minh exact DB và container đã được dọn dẹp | Process exit != 0 | Báo cáo lỗi sanitized | finally block, timeout 30s | Harness Safety Runtime |
| REG-01 | Chưa có customer | 2 tiến trình begin cùng email khác phone | 1 pending row trong `pending_registrations` | Winner: 202 Accepted, Loser: 409 Conflict | 1 audit `REGISTRATION_STARTED` (payload `{}`), 0 outbox | Cleanup target DB | Disposable DB Race |
| REG-02 | Chưa có customer | 2 tiến trình begin cùng phone khác email | 1 pending row trong `pending_registrations` | Winner: 202 Accepted, Loser: 409 Conflict | 1 audit `REGISTRATION_STARTED` (payload `{}`), 0 outbox | Timeout lock 5s | Disposable DB Race |
| REG-03 | Cạnh tranh cùng cặp email+phone | 2 tiến trình begin đồng thời | `pending_registrations_email_idx` và `pending_registrations_phone_idx` giữ vững | Winner: 202 Accepted, Loser: 409 Conflict | Không ghi audit cho loser | Cleanup target DB | Disposable DB Race |
| REG-04 | Pending hết hạn tồn tại | Begin mới kích hoạt dọn dẹp | Dọn dẹp pending hết hạn an toàn | Begin mới: 202 Accepted | 1 audit `REGISTRATION_PENDING_CLEANUP`, 1 `REGISTRATION_STARTED` | Rollback on error | Disposable DB State |
| REG-05 | Đã hoàn tất đăng ký | Cố tình begin lại contact cũ | Bản ghi completion/customer không đổi | 409 Conflict / completed precedence | Không phát sinh event mới | Cleanup target DB | Disposable DB State |
| REG-06 | Đang có pending active | Cố tình begin lại contact cũ | Bản ghi pending active không đổi | 409 Conflict | Không phát sinh event mới | Cleanup target DB | Disposable DB State |
| REG-07 | 1 challenge active | 2 tiến trình verify cùng challenge/code | Đúng 1 completion, 1 customer, 1 account | Winner: 201 Created, Loser: 409 Conflict | Đúng 1 audit `CUSTOMER_REGISTERED`, 1 outbox `CUSTOMER_REGISTERED` | Lock timeout 5s | Disposable DB Race |
| REG-08 | Đã hoàn tất đăng ký | Verify lại (replay verify) | Số lượng customer/account không đổi | Bị từ chối: 409 Conflict | Không sinh thêm outbox event | Cleanup target DB | Disposable DB Replay |
| REG-09 | Challenge active với device A | Gửi cancel với đúng device A & purpose | Challenge chuyển trạng thái cancelled, pending consumed | 204 No Content | 0 audit, 0 outbox | Cleanup target DB | Disposable DB Domain |
| REG-10 | Challenge active với device A | Gửi cancel với device B hoặc sai purpose | Trạng thái challenge không đổi | 404 Not Found (redacted) | 0 audit, 0 outbox | Cleanup target DB | Disposable DB Negative |
| REG-11 | Challenge đã CANCELLED | Gửi cancel lặp lại (replay cancel) | Trạng thái không đổi | 204 No Content (idempotent) | 0 audit, 0 outbox | Cleanup target DB | Disposable DB Idempotency |
| REG-12 | Challenge đã EXPIRED | Gửi cancel cho challenge hết hạn | Trạng thái không đổi, dọn dẹp pending nếu còn | 204 No Content (idempotent) | 0 audit, 0 outbox | Cleanup target DB | Disposable DB Idempotency |
| REG-13 | Registration đã completed | Gửi cancel cho challenge cũ | Completion/customer không đổi | 409 Conflict precedence | Không cho phép cancel | Cleanup target DB | Disposable DB Precedence |
| REG-14 | Email challenge provider lỗi | Begin transaction bồi hoàn | Không để lại pending orphan | Lỗi sanitized trả về caller | Không ghi nhận đăng ký thành công | Cleanup target DB | Disposable Rollback |
| REG-15 | Rate limit bucket cập nhật | Nhiều request begin đồng thời | Bucket update nguyên tử; bucket lưu `relational-registration:<fingerprint>` | Rate limit hoạt động chính xác | Audit `REGISTRATION_STARTED` payload `{}`; không có audit riêng cho bucket | Cleanup target DB | Disposable Privacy |
| REG-16 | Dữ liệu registration đã commit | Đóng pool, mở connection pool mới | Dữ liệu đã commit đọc đầy đủ | Đọc thành công | Dữ liệu toàn vẹn | Cleanup target DB | Disposable Restart |
| REG-17 | Lỗi trước commit | Rollback toàn phần | Không tạo customer, account, pending dở dang | Lỗi sanitized | Không sinh audit/outbox rác | Cleanup target DB | Disposable Rollback |
| KYC-01 | Customer đã tồn tại | Lưu DRAFT hợp lệ lần đầu (`saveDraft`) | 1 row DRAFT, submitted_at null, ver=1 | Trả về 200 OK | Audit `KYC_DRAFT_SAVED`, 0 outbox | Cleanup target DB | Disposable KYC |
| KYC-02 | Customer đã tồn tại | Lưu payload không hợp lệ (sai URI/số) | Không tạo row trong DB | 422 Unprocessable Entity | Không phát sinh audit | Cleanup target DB | Disposable Negative |
| KYC-03 | Chưa có hồ sơ mở | 2 tiến trình lưu DRAFT đồng thời | Partial unique index: tối đa 1 open | Winner: 200 OK, Loser: 409 Conflict | Đúng 1 audit `KYC_DRAFT_SAVED` | Timeout lock 5s | Disposable KYC Race |
| KYC-04 | Đang có DRAFT với identity | Lưu DRAFT không truyền identity | Identity server-side giữ nguyên | 200 OK; response chỉ có last4 | Không lộ full identity ra ngoài | Cleanup target DB | Disposable Privacy |
| KYC-05 | Đang có DRAFT với identity | Lưu DRAFT với full identity mới | Cập nhật payload mới, last4 khớp | 200 OK; response chỉ có last4 | Không lộ full identity ra ngoài | Cleanup target DB | Disposable Privacy |
| KYC-06 | Đang có hồ sơ | Truyền identity masked hoặc rỗng | Không cập nhật dữ liệu sai | 422 Unprocessable Entity | Không mutate row | Cleanup target DB | Disposable Negative |
| KYC-07 | Identity có số 0 ở đầu | Lưu và submit hồ sơ | Giữ nguyên text, last4 có số 0 | saveDraft outcome: 200 OK; submit outcome: 201 Created | last4 đủ 4 ký tự; không ép kiểu số | Cleanup target DB | Disposable Privacy |
| KYC-08 | Có DRAFT hợp lệ | Thực hiện Submit hồ sơ (`submit`) | Trạng thái SUBMITTED, submitted_at set | 201 Created | 1 audit `KYC_SUBMITTED`, 1 outbox `SECURITY_KYC_SUBMITTED`, 1 notif | Cleanup target DB | Disposable KYC |
| KYC-09 | Có DRAFT hợp lệ | 2 tiến trình submit cùng request fingerprint | Trạng thái SUBMITTED | Cùng trả về 201 Created (idempotent) | Đúng 1 bộ audit, outbox, notif; không duplicate | Lock timeout 5s | Disposable KYC Race |
| KYC-10 | Đang submit hồ sơ | Submit tiến trình khác khác fingerprint | Invariant được bảo toàn | Bị từ chối: 409 Conflict | Không sinh duplicate outbox | Lock timeout 5s | Disposable KYC Race |
| KYC-11 | Hồ sơ ở NEEDS_MORE_INFO | Cập nhật thông tin và submit | Chuyển trạng thái, tăng version; submitted_at preserved khi draft | 200 OK (draft) / 201 Created (submit) | Side effects phát sinh đúng policy | Cleanup target DB | Disposable Lifecycle |
| KYC-12 | Hồ sơ đã APPROVED | Cố tình sửa đổi hoặc nộp lại | Trạng thái APPROVED không đổi | Bị từ chối: 409 Conflict | Không cho phép thay đổi | Cleanup target DB | Disposable Precedence |
| KYC-13 | Hồ sơ đã REJECTED | Nộp hồ sơ mới (resubmit) | Hồ sơ cũ bất biến, tạo hồ sơ mới | 200 OK (draft) / 201 Created (submit) | Giữ nguyên audit cũ, thêm audit mới | Cleanup target DB | Disposable Lifecycle |
| KYC-14 | Open app + Admin APPROVED interleaving | Admin commit APPROVED trong khi customer chờ lockOpen | Không còn open row; recheck APPROVED phát hiện trạng thái đã duyệt | Generic 409 Conflict | Không audit/outbox success; không insert app mới | Lock timeout 5s | Disposable Interleaving |
| KYC-15 | Database constraint fault | Lỗi vi phạm partial unique index vs pkey | Constraint open_idx map 409; pkey rethrow; unknown rethrow | 409 Conflict (mã 23505 open_idx) hoặc rethrow | Không ghi nhận event dở dang | Cleanup target DB | Disposable Error |
| KYC-16 | Hồ sơ KYC đã commit | Đóng pool, mở connection pool mới | Dữ liệu KYC đọc chính xác | Đọc thành công | Dữ liệu toàn vẹn | Cleanup target DB | Disposable Restart |
| PRIV-01 | Mọi flow Registration / KYC | Quét toàn bộ log output & evidence | Không có secret, password, full identity | Không thay đổi hành vi | Mọi dữ liệu nhạy cảm đã redact | Không lưu raw dumps | Leakage Scan |
| ATX-01 | Flow hợp lệ + inject fault | Giả lập lỗi trước khi COMMIT | Toàn bộ các bảng rollback sạch sẽ | Báo lỗi | Không để lại dangling row | Cleanup target DB | Disposable Rollback |
| ATX-02 | Flow hợp lệ | Thử lại sau lỗi tạm thời (retryable) | Không nhân đôi dữ liệu | Thành công idempotent | Dữ liệu nhất quán | Retry có giới hạn | Disposable Retry |
| ATX-03 | Flow đã commit | Khởi động lại và replay lệnh terminal | Dữ liệu không đổi | Giữ nguyên trạng thái terminal | Không sinh thêm event | Cleanup target DB | Disposable Restart |

## 18. Kế hoạch lệnh thực thi tương lai (Future Command Plan — NOT EXECUTED)

Các lệnh dưới đây chỉ là kế hoạch tương lai được cấu trúc chặt chẽ theo từng checkpoint; **tuyệt đối không chạy bất kỳ lệnh nào trong phiên làm việc hiện tại**:

### 18.1 Checkpoint M07-A1 — Guard & Runner Hardening
- **Owner**: Thành viên phụ trách Database / Security Guard.
- **Working Directory**: `C:\Projects\banking-system\backend`
- **Database Use**: `NO DB` (Tuyệt đối không kết nối cơ sở dữ liệu).
- **Commands**:
  ```powershell
  npm run typecheck
  npm run build
  node --import=tsx --test src/tests/disposableDatabaseGuard.test.ts
  ```
- **Timeout**: Tối đa 60 giây cho `npm run typecheck`, 60 giây cho `npm run build`, 30 giây cho `node --import=tsx --test src/tests/disposableDatabaseGuard.test.ts`.
- **Cleanup Expectation**: Không tạo cơ sở dữ liệu; không có tài nguyên nào cần dọn dẹp.
- **Expected Semantics**: Toàn bộ unit test và typecheck pass 100% (0 failed, 0 skip). Guard test phải dùng mock/test-double; không import module theo cách tự động khởi tạo database; không gọi runner main khi import file; không đọc/in raw environment values. Tuyệt đối không chạy broad test suite, test:database, test:relational, test:release trong checkpoint này.

### 18.2 Checkpoint M07-A2 — Ephemeral Container & Migration Proof
- **Owner**: Thành viên phụ trách Database Migration.
- **Working Directory**: `C:\Projects\banking-system\backend`
- **Database Use**: `EPHEMERAL DB` (Chạy trên ephemeral container PostgreSQL 16 loopback).
- **Candidate Command**:
  ```powershell
  node --import=tsx scripts/run-disposable-postgres-test.ts src/tests/migrationFingerprint.test.ts
  ```
- **Timeout**: Tối đa 180 giây.
- **Cleanup Expectation**: Runner tạo database đích theo pattern `^banking_test_[a-f0-9]{32}$`, ghi comment ownership, áp dụng migration 001–040, và trong khối `finally` thực hiện ngắt kết nối đích danh rồi `DROP DATABASE`, tái xác thực catalog.
- **Expected Semantics**: 40 migration được áp dụng thành công; exit code 0. *(Lưu ý: Nếu phát hiện thiếu harness assertion cho 40 history rows hoặc rerun, runner phải dừng với blocker `BLOCKED — M07-A2 EVIDENCE HARNESS GAP`).*

### 18.3 Checkpoint M07-B — Registration Relational Verification
- **Owner**: Thành viên phụ trách Registration Service.
- **Working Directory**: `C:\Projects\banking-system\backend`
- **Database Use**: `EPHEMERAL DB`.
- **Command**:
  ```powershell
  node --import=tsx scripts/run-disposable-postgres-test.ts src/tests/registrationRelational.test.ts
  ```
- **Timeout**: Tối đa 180 giây.
- **Cleanup Expectation**: Tự động dọn dẹp sạch sẽ database đích sau khi kết thúc suite.
- **Expected Semantics**: Toàn bộ các ca kiểm thử `REG-01` đến `REG-17` pass 100%.

### 18.4 Checkpoint M07-C — Dedicated KYC Relational Verification
- **Owner**: Thành viên phụ trách KYC Service.
- **Working Directory**: `C:\Projects\banking-system\backend`
- **Database Use**: `EPHEMERAL DB`.
- **Command**:
  ```powershell
  node --import=tsx scripts/run-disposable-postgres-test.ts src/tests/kycRelational.test.ts
  ```
- **Timeout**: Tối đa 180 giây.
- **Cleanup Expectation**: Tự động dọn dẹp sạch sẽ database đích sau khi kết thúc suite.
- **Expected Semantics**: Toàn bộ các ca kiểm thử `KYC-01` đến `KYC-16` (bao gồm kịch bản PostgreSQL interleaving và constraint error mapping) pass 100%.

### 18.5 Checkpoint M07-D — Atomicity, Rollback & Restart
- **Owner**: Thành viên phụ trách Transaction & Relational Safety.
- **Working Directory**: `C:\Projects\banking-system\backend`
- **Database Use**: `EPHEMERAL DB`.
- **Commands**:
  ```powershell
  node --import=tsx scripts/run-disposable-postgres-test.ts src/tests/registrationRelational.test.ts
  node --import=tsx scripts/run-disposable-postgres-test.ts src/tests/kycRelational.test.ts
  ```
- **Timeout**: Tối đa 180 giây mỗi suite.
- **Cleanup Expectation**: Tự động dọn dẹp sạch sẽ database đích.
- **Expected Semantics**: Toàn bộ ca kiểm thử atomicity, rollback và reopen pool pass 100%.

### 18.6 Checkpoint M07-E — Non-Database Static Gates & Handoff
- **Owner**: Thành viên phụ trách Quality Gate & Documentation.
- **Working Directory**: `C:\Projects\banking-system\backend`
- **Database Use**: `NO DB`.
- **Commands**:
  ```powershell
  npm run typecheck
  npm run build
  npm run validate:openapi
  ```
- **Timeout**: Tối đa 60 giây mỗi lệnh.
- **Cleanup Expectation**: Không có tài nguyên DB.
- **Expected Semantics**: Không có lỗi static, schema OpenAPI hợp lệ. Nếu có đề xuất chạy `npm test`, lệnh đó phải được chạy với môi trường không truyền cấu hình database integration vào child process, không in raw environment values, và 48 skipped tests phải được báo cáo đúng là skipped, không tính là passed. Broad disposable database suite vẫn cần Owner phê duyệt riêng.

## 19. Tiêu chuẩn nghiệm thu (M01-07 Acceptance Criteria)

M01-07 chỉ được đổi thành `COMPLETED` sau khi toàn bộ tiêu chí sau được tích chọn hoàn tất:

- [x] M07-A1 pure guard/orchestration tests PASS, tuyệt đối không kết nối database.
- [x] Owner review M07-A1 hoàn tất trước khi kích hoạt M07-A2.
- [ ] A2 xác minh exact ephemeral container identity, loopback-only binding và không có persistent volume.
- [ ] Database rỗng migrate tuần tự 001–040; có đúng 40 history rows trong catalog.
- [ ] Rerun migration giữ nguyên history; checksum mismatch bị từ chối rõ ràng.
- [ ] SAFE-R01 đến SAFE-R11 có đầy đủ runtime evidence tương ứng.
- [ ] Registration `REG-01` đến `REG-17` PASS trên PostgreSQL disposable.
- [ ] KYC `KYC-01` đến `KYC-16` PASS trên PostgreSQL disposable.
- [ ] APPROVED interleaving (`KYC-14`) được chứng minh bằng 2 connection/transaction thật trên PostgreSQL.
- [ ] Audit, outbox và notification commit hoặc rollback cùng nghiệp vụ trong cùng transaction.
- [ ] Restart pool đọc đúng committed state và không đọc uncommitted state.
- [ ] Không có secret, full synthetic identity, raw IP, hay full fingerprint trong output/evidence.
- [ ] Mọi command có finite timeout và exact cleanup postcondition.
- [ ] Mỗi checkpoint chỉ sửa đúng file trong fixed allowlist đã định nghĩa.
- [ ] Không sửa migration SQL cũ hoặc business service source để ép test pass.
- [ ] Test counts, pass, fail, skip được ghi chính xác; 48 skipped tests không được tính là pass.
- [ ] M01-08 (device/emulator) và M01-09 (audit/closure) vẫn chưa được nhận ownership.
- [ ] M01-07 chỉ chuyển `COMPLETED` sau Checkpoint M07-E và Owner closure review.
- [ ] Toàn bộ use case UC-M01 chưa chuyển `COMPLETED` trước khi M01-09 hoàn tất.
- [ ] Không thực hiện lệnh git push lên remote.

## 20. Quy tắc ẩn danh hóa bằng chứng (Sanitized Evidence Rules)

Mọi bằng chứng thực thi trong các checkpoint tiếp theo phải tuân thủ nghiêm ngặt các quy tắc ẩn danh hóa:

1. **Tuyệt đối không lưu raw database dump**: Không xuất hoặc lưu trữ các file SQL dump đầy đủ của database vào repository hay artifacts.
2. **Ẩn danh hóa chuỗi kết nối**: Tuyệt đối không đưa chuỗi kết nối dạng URL vào báo cáo. Báo cáo chỉ ghi nhận connection value: `value redacted`, database classification: `ephemeral-loopback`, target class: `banking_test_<redacted>`. Migration digest có thể ghi nếu không chứa secret.
3. **Ẩn danh hóa PII và danh tính tổng hợp**: Không ghi số điện thoại thật, email thật, hay full synthetic identity number vào báo cáo. Chỉ cho phép hiển thị `identityNumberLast4`; đối với keyed fingerprint chỉ báo format/length/match result hoặc giá trị đã redact, tuyệt đối không in full fingerprint.
4. **Không in plaintext token / OTP / credential**: Giá trị OTP, password hash, session token, private key phải được thay thế bằng chuỗi `[REDACTED]` trong mọi trích đoạn console log.
5. **Gắn kết quả với metadata phiên chạy**: Mọi báo cáo bằng chứng phải đi kèm commit hash (`git rev-parse HEAD`), migration digest, và timestamp thực thi.

## 21. Blockers và quyết định cần Owner phê duyệt

Trước khi bắt đầu thực thi code hoặc database, Owner cần phê duyệt các nội dung sau:

1. **Phê duyệt Kế hoạch An toàn v4**: Xác nhận 11 quy tắc an toàn `SAFE-R01` đến `SAFE-R11`, phương án phân tầng bằng chứng M07-A1 (Unit) và M07-A2 (Runtime), cùng bảng ma trận test case đã chuẩn hóa HTTP/Domain contract.
2. **Phê duyệt Phân tách File Test KYC**: Xác nhận tạo mới file `backend/src/tests/kycRelational.test.ts` (Checkpoint M07-C) để cô lập hoàn toàn kiểm thử KYC relational, không can thiệp vào `databaseFoundation.test.ts`.
3. **Cấp quyền Chuyển Chế độ M07-A1**: Cho phép chuyển chế độ làm việc sang `IMPLEMENT_AND_VERIFY` cho riêng cổng `M07-A1` với Fixed Allowlist tương ứng, giữ nguyên cấm chạy database.

### 21.1 Điều kiện dừng ngay lập tức (Fail-Closed Stop Conditions)

- Branch khác `codex/staging-academic-completion` hoặc HEAD khác `1bded79c8575c7958f3920cc021878e050225aed`.
- Phát hiện bất kỳ thay đổi nào ngoài file task này khi chưa có lệnh chuyển chế độ.
- Database đích có dấu hiệu là `banking_preview` hoặc endpoint không thuộc loopback numeric (`127.0.0.1` / `::1`).
- Phát hiện rò rỉ secret hoặc full synthetic identity trong output mà không thể redact.
- Quá trình chạy test vượt quá finite timeout quy định tại mục 17.1.

## 22. Quyết định phiên làm việc (Decision Result)

- Thời gian ghi nhận: 2026-09-04
- CWD: `C:\Projects\banking-system`
- Branch: `codex/staging-academic-completion`
- HEAD: `1bded79c8575c7958f3920cc021878e050225aed`
- Git Working Tree: có đúng một authorized untracked file; không có modified/staged file khác
- Trạng thái kế hoạch: `APPROVED`
- Trạng thái task: `IN_PROGRESS — M07-A1 NOT STARTED`
- An toàn thực thi database: `BLOCKED — DISPOSABLE DATABASE SAFETY NOT ESTABLISHED`
- Tiến độ task: `M01-07 CHƯA HOÀN THÀNH (INCOMPLETE)`
- Tiến độ use case: `UC-M01 CHƯA HOÀN THÀNH (INCOMPLETE)`

Kết luận: Phiên làm việc này hoàn toàn tuân thủ chế độ `DIAGNOSE_AND_PLAN — DOCUMENTATION COMMIT ONLY`. Kế hoạch xác minh PostgreSQL disposable v4 đã được Owner phê duyệt và ghi nhận chính thức. Chưa có bất kỳ dòng code nguồn, test script, cấu hình CI, hay database nào bị khởi tạo hoặc thay đổi. Checkpoint M07-A1 chưa bắt đầu.

## 23. Bàn giao — M01-07 FINAL PLAN REVIEW PACKET v4

Gói bàn giao kế hoạch v4 gửi Owner:

1. **Xác nhận Preflight**: CWD, branch, HEAD; cached area sạch; working tree có đúng một authorized untracked task file.
2. **Phạm vi Một File Duy nhất**: Chỉ cập nhật `tasks/UC-M01/TASK_M01_07_VERIFY_DISPOSABLE_POSTGRESQL_REGISTRATION_KYC.md`.
3. **Chuẩn hóa Run ID & Regex**: Định dạng duy nhất 32 ký tự hex thường (`run_id = randomUUID().replaceAll("-", "").toLowerCase()`), database regex `^banking_test_[a-f0-9]{32}$`, container regex `^banking_test_container_[a-f0-9]{32}$`.
4. **Targeted Safe Command Plan cho M07-A1**: Loại bỏ `npm test`, chỉ dùng `npm run typecheck`, `npm run build`, và `node --import=tsx --test src/tests/disposableDatabaseGuard.test.ts` (Database use: `NO DB`).
5. **Bảng Đối chiếu Năng lực Bằng chứng A2**: Nhận diện rõ 4 khoảng trống harness (`BLOCKED — M07-A2 EVIDENCE HARNESS GAP`), giữ modification allowlist A2 chỉ duy nhất 1 file task.
6. **Chuẩn hóa Ma trận Registration**: Assert đồng thời cả 2 index `pending_registrations_email_idx` và `pending_registrations_phone_idx` trong `REG-03`; chuẩn hóa `REG-14` là email challenge provider failure; làm rõ bucket key và audit `REGISTRATION_STARTED` trong `REG-15`.
7. **Ma trận KYC Hoàn chỉnh (KYC-01 đến KYC-16)**: Khôi phục ca kiểm thử PostgreSQL interleaving thực tế (`KYC-14`), kiểm tra chi tiết constraint error mapping (`KYC-15`), và phân tách rõ ràng outcome của `KYC-07`.
8. **Thu hẹp Đặc tả Timestamp submitted_at**: Làm rõ `submitted_at` mang giá trị `NULL` cho DRAFT mới hoặc DRAFT update, nhưng được bảo toàn nguyên vẹn (`preserved`) khi cập nhật ở trạng thái `NEEDS_MORE_INFO`.
9. **Khôi phục Future Command Plan**: Định rõ ownership, directory, file, database use, timeout, cleanup expectation cho từng checkpoint A1, A2, B, C, D, E.
10. **Khôi phục Acceptance Criteria**: Đầy đủ 20 checkbox `[ ]` chưa hoàn thành theo dõi toàn bộ tiến trình.
11. **Bảo toàn 48 Skipped Tests Inventory**: 48 skipped tests và 9 worker tests được duy trì nguyên vẹn.
12. **Tuân thủ Phạm vi Documentation-only**: Giảm thiểu rủi ro theo thiết kế fail-closed; không chạy Docker, PostgreSQL, migration runner hoặc test suite; chỉ commit duy nhất file tài liệu kế hoạch.

PLAN APPROVED — M07-A1 NOT STARTED — DATABASE EXECUTION REMAINS BLOCKED UNTIL M07-A1 SAFETY GATE PASSES

## 24. M07-A1 GUARD & RUNNER HARDENING EVIDENCE

### 24.1 Baseline & Quyền thực thi
- Baseline commit: `0a351b1fa835430d8ce6cab464b16a00fe9e24f5` (`docs(uc-m01): approve disposable PostgreSQL verification plan`)
- Parent commit: `1bded79c8575c7958f3920cc021878e050225aed`
- Chế độ thực thi: `IMPLEMENT_AND_VERIFY — M07-A1 ONLY — NO DATABASE`
- Không có bất kỳ kết nối PostgreSQL, Docker, hay container runtime nào được khởi tạo.
- Không stage, commit, push, amend, merge, rebase hoặc tag.

### 24.2 Exact Four-file Modification Inventory
1. `backend/src/database/disposableDatabaseGuard.ts`: Bổ sung toàn bộ guard helpers, type definitions, container descriptor validator, marker builder/parser/validator, timeout policy, safe quoting, log sanitizer, catalog checks, và testable runner orchestration (`runDisposablePostgresTest`).
2. `backend/scripts/run-disposable-postgres-test.ts`: Hardened CLI wrapper với `isMain` guard, bảo đảm không chạy code hoặc đăng ký handler khi import; re-export orchestration types.
3. `backend/src/tests/disposableDatabaseGuard.test.ts`: Bảo toàn nguyên vẹn 5 unit test cũ, bổ sung 12 test mới bao phủ toàn bộ `SAFE-R01..SAFE-R11` cùng import safety test với 100% test-doubles/fakes, 0 database/docker connections.
4. `tasks/UC-M01/TASK_M01_07_VERIFY_DISPOSABLE_POSTGRESQL_REGISTRATION_KYC.md`: Cập nhật trạng thái M07-A1, tick duy nhất criterion M07-A1, và bổ sung bằng chứng hoàn thành.

### 24.3 Mapping Implementation & Test Matrix (SAFE-R01..SAFE-R11)
| Rule | Implementation trong Guard / Runner | Unit Test trong disposableDatabaseGuard.test.ts | Kết quả |
| :--- | :--- | :--- | :--- |
| `SAFE-R01` | `sanitizeLogOutput`: che connection URL và 32-hex run ID | `SAFE-R01: redaction sanitizes synthetic credentials, connection URLs and run IDs` | PASS |
| `SAFE-R02` | `isNumericLoopback`, loopback host check cho 127.0.0.1 và ::1 | `SAFE-R02: accepts numeric loopback addresses and allows injected localhost resolution` | PASS |
| `SAFE-R03` | `assertProtectedDatabaseNameNotTargeted`, case-insensitive rejection | `SAFE-R03: rejects protected database names case-insensitively and fails closed on non-loopback hosts` | PASS |
| `SAFE-R04` | `generateDisposableRunId`, `RUN_ID_PATTERN`, `STRICT_DATABASE_NAME_PATTERN` | `SAFE-R04: enforces exact 32-hex run ID, strict database name, and container patterns` | PASS |
| `SAFE-R05` | `preCreateClassificationCheck`, `validateContainerDescriptor` | `SAFE-R05: pre-create classification rejects existing targets and invalid container descriptors` | PASS |
| `SAFE-R06` | `buildOwnershipMarker`, `parseOwnershipMarker`, `assertOwnershipMarkerMatches` | `SAFE-R06: marker builder and parser enforce exact key-value structure and fail-closed` | PASS |
| `SAFE-R07` | `preCleanupRevalidationCheck`, comment verification trước cleanup | `SAFE-R07: pre-cleanup revalidation blocks destructive operations on marker mismatch or missing comment` | PASS |
| `SAFE-R08` | `quoteDatabaseIdentifier`, `assertApprovedTestPath`, no arbitrary commands | `SAFE-R08: destructive commands scope strictly to verified target and enforce approved test paths` | PASS |
| `SAFE-R09` | `DISPOSABLE_TIMEOUTS` tập trung (60s, 5s, 5s, 30s, 30s, 180s, 30s) | `SAFE-R09: enforces exact finite timeout policy with no infinite defaults` | PASS |
| `SAFE-R10` | Awaited one-shot cleanup trong `finally`, `ProcessInterruptionEmitter` seam | `SAFE-R10: awaited one-shot cleanup executes on success, child failure, and simulated interruption` | PASS |
| `SAFE-R11` | `postDropCatalogCheck`, verify catalog sau DROP | `SAFE-R11: post-drop catalog check fails closed if database remains in catalog` | PASS |
| `IMPORT` | `isMain` guard trong runner module, không spawn/connect/listen on import | `import safety: importing runner does not spawn processes, connect to DB, or register global handlers` | PASS |

### 24.4 Kết quả ba Quality Gates
1. **Gate 1 — Typecheck**:
   ```powershell
   npm run typecheck
   # Output: tsc --noEmit (Exit code: 0)
   ```
2. **Gate 2 — Build**:
   ```powershell
   npm run build
   # Output: tsc -p tsconfig.build.json (Exit code: 0)
   ```
3. **Gate 3 — Targeted Guard Test**:
   ```powershell
   node --import=tsx --test src/tests/disposableDatabaseGuard.test.ts
   # ℹ tests 17 | pass 17 | fail 0 | cancelled 0 | skipped 0 | duration_ms ~532ms
   ```

### 24.5 Giới hạn & Điểm chưa chứng minh ở Runtime
- Bằng chứng tại M07-A1 là **pure guard logic & orchestration test-double evidence**.
- Chưa chứng minh container identity thật, database marker trên PostgreSQL thật, SQL session termination thật, drop database thật hay catalog postcondition thật.
- Bốn khoảng trống harness (`BLOCKED — M07-A2 EVIDENCE HARNESS GAP`) được giữ nguyên vẹn, chờ quyết định riêng của Owner trước M07-A2.
- Tuyệt đối không chạy database, Docker, migration script, hay broad test suites.
- Trạng thái an toàn thực thi database vẫn giữ: `BLOCKED — DISPOSABLE DATABASE SAFETY NOT ESTABLISHED`.
- Task M01-07 và Use Case UC-M01 vẫn ở trạng thái **CHƯA HOÀN THÀNH (INCOMPLETE)**.

## 25. M07-A1 SAFETY EVIDENCE FOLLOW-UP

### 25.1 Baseline & File Hashes (Before vs After Follow-up)
- Baseline commit: `0a351b1fa835430d8ce6cab464b16a00fe9e24f5`
- Chế độ thực thi: `IMPLEMENT_AND_VERIFY — M07-A1 FOLLOW-UP ONLY — NO DATABASE`

| File | SHA256 Trước Follow-up | SHA256 Sau Follow-up |
| :--- | :--- | :--- |
| `backend/scripts/run-disposable-postgres-test.ts` | `68F6CF6DB32EAD4F93E28B35131C63908CB7F77F65BE1C60845DC863C634BD3C` | `FE1846E3F0AD0005BE7266C7ED01AC8A62ACD4D56B4DEF3B71C00FAD852A0F2D` |
| `backend/src/database/disposableDatabaseGuard.ts` | `DCD0FEBEB7AA19446D0FCDFCBE9A165EAE6944C7866B2BD552B70488E400C719` | `0072E8940B1585536D9A9CE8955987179C52712727B3CF826B6F8466DC220D3B` |
| `backend/src/tests/disposableDatabaseGuard.test.ts` | `31638BC11578F58EE46A16779DE33C4847CB9BFA4416238E84BC9F91B12B97E1` | `81F01254924235707BAB846BFD317184FFBF2E67389207333E86EC2447C269C4` |

### 25.2 Xử lý Bốn Khoảng trống Bằng chứng An toàn (Items 3.1..3.4)
1. **Child-command Timeout Enforcement (3.1)**:
   - Đã bổ sung cơ chế truyền và áp đặt timeout `commandTimeoutMs` vào `runCmd` (mặc định 180s, hỗ trợ test injection).
   - Test deterministic `SAFE-R09-E1`: Giả lập child command timeout mà không chờ thời gian thật, xác minh chuyển sang failure, awaited cleanup chạy một lần, không tiếp tục execution.
2. **Cleanup Timeout Enforcement & Fail-closed (3.2)**:
   - Đã đóng gói toàn bộ thao tác cleanup trong `performCleanup` với `Promise.race` áp đặt giới hạn `cleanupTimeoutMs` (30s).
   - Test deterministic `SAFE-R09-E2`:
     - Khi cleanup treo vô hạn: Runner kết thúc ở trạng thái `FAILED / FAIL-CLOSED` với lỗi cleanup timeout, không bao giờ báo success.
     - Khi child command đã fail trước đó: Lỗi gốc được bảo toàn nguyên vẹn làm primary error, lỗi cleanup timeout được đính kèm vào `.cause` và `cleanupError`, không swallow lỗi gốc.
3. **Fatal Process Events Coverage (3.3)**:
   - Đã triển khai đầy đủ bộ handler cho cả 4 fatal events: `SIGINT`, `SIGTERM`, `uncaughtException`, `unhandledRejection` thông qua `ProcessInterruptionEmitter` test seam.
   - Tests `SAFE-R10`, `SAFE-R10-E1`, `SAFE-R10-E2`: Xác minh cleanup được kích hoạt một lần duy nhất, kết quả trả về failure (`success === false`), listener tự động được gỡ bỏ trong `finally`, và không can thiệp vào global `process` thật.
4. **Destructive-action & Target-identity Boundaries (3.4)**:
   - Test `SAFE-R04-E1`: Xác minh environment hay CLI không thể override target database name; runner luôn sinh tên từ 32-hex run ID.
   - Test `SAFE-R08-E1`: Xác minh child invocation chỉ sử dụng mảng tham số (`argv array`), không dùng shell interpolation và `shell` không được bật.
   - Test `SAFE-R08-E2`: Xác minh marker mismatch hoặc container descriptor mismatch làm cho số lượt gọi terminate, drop và container-remove bằng đúng 0.
   - Test `SAFE-R10-E3`: Xác minh primary failure luôn được giữ nguyên khi cleanup cũng gặp lỗi.
   - Test `SAFE-R01-E1`: Mở rộng redaction sanitizes synthetic credentials, bearer tokens, standalone passwords, child errors và cleanup errors.

### 25.3 Exact Test Counts và Kết quả Quality Gates
- **Tổng số test**: **26 tests** (17 test cũ bảo toàn verbatim + 9 test mới).
- **Trạng thái**: **26 pass, 0 fail, 0 cancelled, 0 skipped**.
- **Ba Quality Gates**:
  1. `npm run typecheck`: **PASS** (Exit code 0).
  2. `npm run build`: **PASS** (Exit code 0).
  3. `node --import=tsx --test src/tests/disposableDatabaseGuard.test.ts`: **PASS** (26/26 tests passed in ~365ms).

### 25.4 Bảo toàn Ranh giới Thực thi
- Toàn bộ 26 tests vận hành 100% in-memory qua test-doubles/fakes.
- Không có bất kỳ kết nối socket, PostgreSQL port, Docker daemon, migration runner thật, hay child process thật nào được khởi tạo trong quá trình kiểm thử.
- Bốn khoảng trống harness (`BLOCKED — M07-A2 EVIDENCE HARNESS GAP`) được giữ nguyên vẹn.
- An toàn thực thi database tiếp tục bị chặn: `BLOCKED — DISPOSABLE DATABASE SAFETY NOT ESTABLISHED`.
- Task M01-07 và Use Case UC-M01 vẫn ở trạng thái **CHƯA HOÀN THÀNH (INCOMPLETE)**.
## 26. M07-A1 BOUNDED CANCELLATION FOLLOW-UP

### 26.1 Baseline & File Hashes (Before vs After Bounded Cancellation Follow-up)
- Baseline commit: `0a351b1fa835430d8ce6cab464b16a00fe9e24f5`
- Chế độ thực thi: `IMPLEMENT_AND_VERIFY — M07-A1 BOUNDED CORRECTION ONLY — NO DATABASE`

| File | SHA256 Trước Bounded Correction | SHA256 Sau Bounded Correction |
| :--- | :--- | :--- |
| `backend/scripts/run-disposable-postgres-test.ts` | `FE1846E3F0AD0005BE7266C7ED01AC8A62ACD4D56B4DEF3B71C00FAD852A0F2D` | `3542BBD70B6B094A4E5938A5F432456E246CD69CF2980592EDE4671818FDDBCB` |
| `backend/src/database/disposableDatabaseGuard.ts` | `0072E8940B1585536D9A9CE8955987179C52712727B3CF826B6F8466DC220D3B` | `6EB7E501394CE34BAB1293151D2A570985B10147573B03F27FA6477877AE8241` |
| `backend/src/tests/disposableDatabaseGuard.test.ts` | `81F01254924235707BAB846BFD317184FFBF2E67389207333E86EC2447C269C4` | `A54B141D95748311FE8548416F1AA25BF49139798BE2DB353E8D380A5D8116D0` |

### 26.2 Phân tích: Vì sao bare `Promise.race` không tương đương Cancellation
1. **Bản chất của `Promise.race`**:
   - `Promise.race` chỉ giải quyết (resolve hoặc reject) promise bọc ngoài khi một promise con cán đích trước.
   - Khi timeout timer kết thúc trước tác vụ I/O hay child process, `Promise.race` giải phóng caller nhưng **hoàn toàn không dừng** promise hay tiến trình bất đồng bộ đang chạy ngầm bên dưới.
2. **Rủi ro đối với Disposable Database Runner**:
   - Nếu child command timeout nhưng tiếp tục chạy ngầm, nó có thể ghi đè dữ liệu hoặc xung đột với thao tác cleanup đang diễn ra.
   - Nguy hiểm hơn, nếu phase cleanup (như truy vấn marker hoặc terminate backend) bị timeout nhưng runner vẫn tiếp tục bước sau, hoặc nếu promise phase trước hoàn thành muộn sau khi runner đã timeout, nó có thể thực hiện `pg_terminate_backend`, `DROP DATABASE` hoặc xóa container ngoài tầm kiểm soát (late destructive side effects).
3. **Yêu cầu Bounded Cooperative Cancellation**:
   - Phải có trạng thái vòng đời tường minh (`RunnerLifecycleState`: `"IDLE" | "RUNNING" | "STOPPING" | "TIMED_OUT" | "COMPLETED" | "FAILED"`).
   - Phải kích hoạt `AbortController` và truyền `AbortSignal` xuống từng phase và child adapter.
   - Trước mỗi thao tác hủy diệt (destructive phase), phải kiểm tra tín hiệu hủy (`checkCancellation`). Nếu đã timeout/aborted, phải từ chối thực hiện ngay lập tức với 0 lượt gọi.
   - Toàn bộ timer phải được thu hồi trong khối `finally`.

### 26.3 Kiến trúc Bounded Cancellation & Fatal Exit Semantics
1. **Child Command Timeout & Abort Propagation**:
   - Runner sử dụng hàm điều phối `executeChildCommandWithTimeout` bọc `runCmd`.
   - Khi timeout xảy ra, `lifecycleState` chuyển thành `TIMED_OUT`, `commandAbortController.abort()` và `childAbortController.abort()` được kích hoạt đồng thời.
   - Tín hiệu abort được lắng nghe bởi adapter để hủy tác vụ cấp dưới và từ chối mọi lệnh tiếp theo.
2. **Phase-by-Phase Cleanup Cancellation**:
   - Mọi phase trong `performCleanup` (`pre-cleanup-revalidation`, `terminate-sessions`, `drop-database`, `post-drop-catalog-check`, `container-removal`) đều được bảo vệ bởi hàm `checkCancellation()`.
   - Nếu `cleanupTimeoutMs` phát hỏa:
     - `cleanupAbortController.abort()` được kích hoạt ngay lập tức.
     - `lifecycleState` chuyển sang `TIMED_OUT`.
     - Bất kỳ phase nào đang pending nếu hoàn thành muộn sẽ gặp kiểm tra hủy ở phase kế tiếp và bị chặn đứng.
     - Các phase hủy diệt tiếp theo được đảm bảo có đúng **0 lượt gọi**.
3. **Fatal Events & Process Facade Exit Semantics**:
   - Hỗ trợ cả 4 sự kiện tiến trình: `SIGINT`, `SIGTERM`, `uncaughtException`, `unhandledRejection`.
   - Các listener trên `ProcessInterruptionEmitter` đồng bộ kích hoạt `interruptionPromise` (đang race trực tiếp với `mainExecution`), gán `processFacade.exitCode = 1`, chuyển `lifecycleState = "STOPPING"`, abort child controller và kích hoạt cleanup.
   - Tuyệt đối không gọi `process.exit()` trực tiếp; không tạo unhandled/unawaited async promise trong EventEmitter callback.
   - Toàn bộ listener được tháo bỏ trong khối `finally`.

### 26.4 Kết quả Kiểm thử Late Completion, Non-Cooperative Adapter & Fatal Exit
Đã bổ sung 6 test deterministic chuyên biệt bảo vệ các ranh giới:
1. **Late Child Completion (`SAFE-R10-E4`)**:
   - Giả lập child command bị timeout, kích hoạt abort signal.
   - Sau khi runner đã trả kết quả thất bại, chủ động kích hoạt resolve lệnh child muộn.
   - Kết quả: Runner vẫn giữ nguyên trạng thái thất bại (`success === false`), không phát sinh lệnh con tiếp theo (`secondCommandInvoked === false`), cleanup chỉ chạy đúng 1 lần duy nhất.
2. **Late Cleanup Continuation (`SAFE-R10-E5`)**:
   - Giả lập Phase 1 (truy vấn comment kiểm tra marker) bị treo vượt quá deadline cleanup.
   - Runner kết thúc ở trạng thái fail-closed do timeout.
   - Sau đó giải phóng Phase 1 muộn.
   - Kết quả xác minh: Số lượt gọi đến `pg_terminate_backend` = 0, `DROP DATABASE` = 0, `post-drop catalog check` = 0, `container-removal` = 0. Hoàn toàn ngăn chặn late destructive continuation.
3. **Non-Cooperative Cleanup Adapter (`SAFE-R10-E6`)**:
   - Adapter cố tình bỏ qua `signal.aborted` và không bao giờ tự settle.
   - Kết quả: Runner kết thúc fail-closed đúng theo deadline `cleanupTimeoutMs`, các phase hủy diệt kế tiếp bị chặn đứng (0 calls), runner không bao giờ báo success.
4. **Primary Failure Ordering (`SAFE-R10-E7`)**:
   - Child error trước, cleanup error sau -> Child error là primary error, cleanup error đính kèm vào `.cause`.
   - Fatal event trước, child error sau -> Fatal event là primary error.
   - Cleanup-only error -> Cleanup error là primary error.
5. **Fatal Events Exit Code Seam (`SAFE-R10-E8`)**:
   - Kiểm tra độc lập cả 4 fatal events (`SIGINT`, `SIGTERM`, `uncaughtException`, `unhandledRejection`).
   - Kết quả: `processFacade.exitCode` luôn được thiết lập thành 1, `result.success === false`, lỗi tương ứng được ghi nhận rõ ràng.
6. **Timer & Listener Disposal (`SAFE-R10-E9`)**:
   - Toàn bộ event listeners trên emitter được gỡ bỏ hoàn toàn sau mọi luồng thực thi (thành công, thất bại, timeout, gián đoạn).

### 26.5 Exact Test Counts & Ba Quality Gates
- **Tổng số test**: **32 tests** (toàn bộ 26 tests cũ bảo toàn verbatim + 6 tests bounded cancellation mới).
- **Trạng thái**: **32 pass, 0 fail, 0 cancelled, 0 skipped, duration ~367ms**.
- **Ba Quality Gates bắt buộc**:
  1. `npm run typecheck`: **PASS** (Exit code 0, 0 lỗi TypeScript, 0 prohibited casts/suppressions).
  2. `npm run build`: **PASS** (Exit code 0, build thành công `dist/`).
  3. `node --import=tsx --test src/tests/disposableDatabaseGuard.test.ts`: **PASS** (32/32 tests pass).

### 26.6 Ranh giới An toàn & Giới hạn Thực thi
- **Unit/Test-double Boundary**: Toàn bộ 32 tests chạy 100% in-memory thông qua test doubles, fake emitters, và fake schedulers.
- **Giới hạn Adapter**: Đối với adapter không hợp tác (non-cooperative), runner chỉ có thể đảm bảo tiến trình điều phối của runner không thực hiện các phase tiếp theo; nó không thể đảm bảo một socket hay process bên ngoài của bên thứ ba tự dừng nếu thư viện đó không hỗ trợ AbortSignal.
- **Bốn Khoảng trống Harness M07-A2**: 4 harness gaps (`BLOCKED — M07-A2 EVIDENCE HARNESS GAP`) được giữ nguyên vẹn.
- **An toàn thực thi database**: Tiếp tục bị chặn nghiêm ngặt: `BLOCKED — DISPOSABLE DATABASE SAFETY NOT ESTABLISHED`.
- **Trạng thái bàn giao**:
  - Trạng thái: `IN_PROGRESS — M07-A1 AWAITING OWNER REVIEW`
  - Chế độ hiện tại: `IMPLEMENT_AND_VERIFY — M07-A1 NO DB`
  - Tiêu chí nghiệm thu: Giữ nguyên `[x]` cho M07-A1 pure guard tests, giữ nguyên `[ ]` cho Owner review M07-A1, không đánh dấu M01-07 hoặc UC-M01 hoàn thành.
## 27. M07-A1 CHECKPOINT COMMIT

### 27.1 Commit Metadata và Exact Inventory
- **Full Commit SHA**: `bf384d4cec756e123340353703c1d60cc3206620`
- **Parent SHA**: `0a351b1fa835430d8ce6cab464b16a00fe9e24f5`
- **Commit Message**: `test(database): harden disposable PostgreSQL safety guard`
- **Author Timestamp**: `2026-09-04T16:07:56+07:00`
- **Committer Timestamp**: `2026-09-04T16:07:56+07:00`
- **Trạng thái Commit**: Commit local trên branch `codex/staging-academic-completion`, chưa push lên remote.
- **Danh mục 4 file committed**:
  1. `backend/scripts/run-disposable-postgres-test.ts` (blob `7378b1da32530d13fc3f500d47f54467a1b81670`)
  2. `backend/src/database/disposableDatabaseGuard.ts` (blob `297cc81d58f10270fc7034c3b2bc227dc96258b4`)
  3. `backend/src/tests/disposableDatabaseGuard.test.ts` (blob `fe20b94ebbcd1da7adb2065f106d5ff3e1569414`)
  4. `tasks/UC-M01/TASK_M01_07_VERIFY_DISPOSABLE_POSTGRESQL_REGISTRATION_KYC.md` (blob `c066c9664b4bdde8f82e73a1a2784755395441e1`)

### 27.2 Bằng chứng Chất lượng Gắn Liền với Committed Snapshot
- **Typecheck**: `npm run typecheck` — PASS (0 lỗi TypeScript, 0 prohibited bypasses).
- **Build**: `npm run build` — PASS.
- **Targeted Guard & Runner Tests**: `node --import=tsx --test src/tests/disposableDatabaseGuard.test.ts` — PASS (32/32 tests, 0 fail, 0 skip, ~379ms).
- **Quy chuẩn an toàn SAFE-R01..SAFE-R11**: Được chấp thuận ở mức pure guard và orchestration unit evidence.
- **Bounded Cooperative Cancellation**: Đã unit-test mô hình hủy phối hợp có giới hạn với lifecycle state, AbortSignal, và phase-by-phase cancellation checks.
- **Late-completion Protection**: Late child completion không chạy command kế tiếp; late cleanup completion không chạy phase hủy diệt tiếp theo.
- **Fail-closed Result**: Non-cooperative adapter và timeout luôn trả về kết quả fail-closed.
- **Fatal Process Events**: `SIGINT`, `SIGTERM`, `uncaughtException`, `unhandledRejection` đặt exit code khác 0 qua process facade seam.
- **Ranh giới thực thi**: Không chạy PostgreSQL, Docker, network, migration hoặc real child process nào trong Checkpoint M07-A1.

### 27.3 Giới hạn và Nguyên tắc Bằng chứng
- Không tuyên bố PostgreSQL runtime verified.
- Không tuyên bố connection hay query thực tế đã được cancellation trên socket database engine.
- Không tuyên bố database hoặc container cleanup runtime đã được chứng minh.
- Non-cooperative adapter chỉ được chứng minh rằng orchestration dừng phase kế tiếp và trả fail-closed; không chứng minh underlying runtime I/O của bên thứ ba đã bị hủy nếu không hỗ trợ AbortSignal.

### 27.4 Bốn Blocker M07-A2 Giữ Nguyên Trạng
1. Chưa có assertion exact 40 migration history rows.
2. Chưa có rerun invariant giữ nguyên 40 rows.
3. Chưa có runtime checksum mismatch refusal test.
4. Chưa có post-drop catalog verification runtime.

Checkpoint M07-A2 cần một Owner directive riêng về remediation allowlist trước khi có thể chạy database. Checkpoint M07-A2 chưa sẵn sàng và chưa được cấp quyền (NOT AUTHORIZED). Task M01-07 và Use Case UC-M01 tiếp tục ở trạng thái chưa hoàn thành.

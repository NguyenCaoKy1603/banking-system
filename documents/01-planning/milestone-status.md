# Milestone status snapshot — 2026-08-24

## Đã kiểm chứng local

Implementation evidence checkpoint hiện hành: `edbc9bb`; safety checkpoint: `e1b7b8c` trên branch local `codex/stage0-safety-20260824`. Historical gate `595afc3` (`Harden database and OpenAPI quality gates`) chỉ dùng để truy vết.

Các thay đổi hardening ngày 2026-08-24 đã được tách thành commit logic trên working tree sạch; implementation branch đã push và có upstream, nhưng chưa có `main`/PR/branch protection. Bằng chứng checkpoint 2026-08-17 bên dưới vẫn là lịch sử tái hiện gần nhất; không được dùng số liệu cũ để tuyên bố các thay đổi mới đã qua device/staging gate.

- Worktree Mobile lint, type-check, 46 suite/260 test, coverage 85,53% statement/86,57% branch, OpenAPI, Maestro syntax và web export đạt.
- Worktree Backend type-check/build, PostgreSQL + relational 91/91 test pass, 10 critical HTTP flow và static/live database contract 28 bảng đạt. Bằng chứng mới chạy trên disposable PostgreSQL của Compose local.

## Cập nhật mới nhất — relational reference adapter

- Runtime PostgreSQL mặc định đã chuyển sang `PostgresRelationalRepository`. Core M0–M4/M8 được lưu ở customer/account/beneficiary/quote/transfer/transaction/ledger/notification/audit/outbox tables; snapshot cũ chỉ được nâng một lần.
- Gate mới `npm run test:relational` đạt 1/1 trên database disposable, gồm restart, pending settlement, reconciliation và concurrent quote submit. Auth runtime và M6/M7 bonus vẫn là record-level reference; chưa tuyên bố production readiness.
- Backend correctness đã có quote snapshot/one-time, beneficiary fingerprint, UUID-compatible IDs, exact route, registration/step-up rate limit, reconciliation formula và outbox retry threshold.
- Persistent PostgreSQL relational reference adapter, migration runner và CI service đã được thêm; integration test core chạy khi có `DATABASE_URL`, còn relational regression dùng `RELATIONAL_DATABASE_URL` disposable.
- OpenAPI validation, Maestro syntax validation, Expo native config và web export đều đã chạy lại sau các route hiện tại; Mobile validator hiện bao phủ 43 path OpenAPI, 10 flow Maestro hợp lệ và 33 static route. Critical flow M0–M4/M8, M6 savings, credit payment, credit pending-resume, Credit card lock/restart/unlock, Credit overdue notification và offline login retry đã chạy thành công trên Android emulator.
- Auth/session/device binding/MFA, accounts/history/detail/filter, transfer quote/step-up/idempotency/pending recovery, notifications và fraud report có reference flow.
- M2 có eKYC customer mock với form/ảnh mẫu và trạng thái DRAFT/PENDING; app không còn quyền tự APPROVED/REJECTED.
- M4 có transfer flow, danh bạ người nhận CRUD và QR scanner/manual fallback. Dữ liệu QR hiện bị đánh dấu `UNVERIFIED` và không thể khởi tạo transfer khi chưa có server alias lookup.
- M8 có notification list/read, notification detail và deep link tới transaction detail hoặc profile.
- M5 có Card mock/reference: list/detail, lock/unlock, ẩn/hiện số mô phỏng và đổi PIN mô phỏng; không lưu PIN/CVV thật.
- Có seed sandbox tự động cho E2E và report release/device nêu rõ các gate chưa thể chạy tại workspace.

## Chưa đủ điều kiện đóng milestone

- M0: baseline tài liệu, evidence rules, device evidence, safety checkpoint `e1b7b8c` và implementation tip `edbc9bb` đã có; owner review/push vẫn còn.
- M1–M4 và M8: critical flow đã chạy trên Android emulator cho login/MFA, account detail, hiện/sao chép số tài khoản đầy đủ, eKYC, beneficiary, QR manual fallback, M4 transfer và M8 notification deep link; chưa có full device matrix, thiết bị thật hoặc staging partner.
- M2: eKYC thật/API KYC và test data staging chưa có; phần hiện tại là mock có chủ đích.
- M4: transfer, beneficiary CRUD, QR manual fallback và pending/restart/resume đã có bằng chứng Maestro trên emulator; QR camera/permission và lifecycle native trên thiết bị thật vẫn chưa có.
- M6 và M7: đã có reference sandbox; M6 quote/review/step-up/mở khoản → danh sách, M7 payment pending → stop/launch → resume, card lock → stop/launch → OTP unlock và overdue notification → card detail đã có flow pass trên emulator. M5 vẫn là mock/fixture, chưa phải API/production card integration; M9 chưa triển khai.
- M10: usability, accessibility, performance và native device regression chưa hoàn tất; audit Mobile local hiện 0 vulnerability sau khi khóa Metro `0.84.5`. Docker/PostgreSQL local đã có evidence, nhưng remote CI và device thật còn chờ.
- M11: đã build APK release local và lưu checksum/evidence; chưa có signing, cài đặt ngoài máy phát triển, staging, monitoring và hồ sơ bảo vệ đầy đủ.

## Quyết định persistence reference

Các kết quả local là bằng chứng cho reference implementation, không phải chứng nhận production/pilot. Core M0–M4/M8 dùng bảng relational; auth runtime và M6/M7 bonus dùng record-level reference. Mọi trạng thái `HOÀN THÀNH` trong kế hoạch phải kèm test report, thiết bị, evidence và người review.

## Giai đoạn 0 — Git/CI checkpoint 2026-08-24

- Safety branch local `codex/stage0-safety-20260824` giữ snapshot nguyên khối `e1b7b8c`, không push.
- Nhánh implementation có chuỗi commit: `556db67` baseline → `0a9454c` Backend atomic → `59bc63d` Mobile auth → `b186be5` intent primitives → `84e6239` mobile flows → `82d4457` mobile security → `edbc9bb` E2E/tài liệu.
- `git status` sạch; secret scan, `npm ci`, Backend/Mobile local gates đã chạy. Upstream implementation branch, `origin/main` và clone sạch đã đạt; branch protection, PR, remote CI và PostgreSQL live vẫn là gate mở.
## Cập nhật sau đồng bộ M6 và triển khai M7 — 2026-08-15

- M6 Savings đã có quote/MFA/idempotency/PENDING-resume/maturity, Mobile list/open/detail và notification deep link; flow native emulator đã pass, nhưng chưa đóng vì thiếu repository relational production, thiết bị thật và staging.
- M7 Credit sandbox đã bắt đầu: thẻ VND cấp sẵn, hạn mức 20.000.000, dư nợ seed 4.000.000, khả dụng 16.000.000, sao kê và thanh toán MINIMUM/FULL/CUSTOM. Không có CIC, processor, PAN/CVV/PIN hoặc tiền thật.
- OpenAPI draft hiện có 36 path; backend route/schema validator đã bao phủ Cards/Credit. Mobile `/cards` đã chuyển khỏi `cardsMock` sang API Credit draft.
- Migration `003_credit_sandbox.sql` và policy fields đã có ở mức draft; live Postgres/Maestro evidence M7 đã chạy ở checkpoint hiện tại; relational production và device thật vẫn là gate mở.

## Cap nhat chinh xac sau M7 local verification - 2026-08-15

- M6 Savings va M7 Credit da co reference sandbox implementation; cac dong mo ta cu "chua trien khai" chi la snapshot truoc khi thuc hien.
- M6/M7 local gate hiện tại: Mobile 37 suite/170 test, OpenAPI 36 path, Maestro syntax 10 flow; M6 savings, M7 credit và offline retry đã có bằng chứng emulator.
- Home/account detail da cho phep hien va sao chep day du so tai khoan qua API rieng; mat tren Home van chi hien/che so du.
- Chua dong milestone: relational repository production, transfer lifecycle native day du, physical device, staging/partner integration va production controls. PostgreSQL live, concurrency/restart sandbox va Maestro M7 emulator da co evidence.

## Cập nhật sau khi hoàn tất kế hoạch persistent local — 2026-08-17

- M0–M4 và M8 đã được kiểm tra lại trên APK release mới với Android emulator; artifact mới nhất là `C:\Users\admin\.maestro\tests\2026-08-17_121849`.
- Backend mặc định chạy PostgreSQL persistent, đã kiểm tra migration từ database local, restart giữ user/account/balance, và 70/70 test backend đạt khi cấu hình cả `DATABASE_URL` và `RELATIONAL_DATABASE_URL`.
- Đã xử lý lỗi tương thích notification giữa seed và Mobile bằng migration trạng thái; không để nhãn kỹ thuật funding nội bộ xuất hiện như loại notification người dùng.
- Phần còn mở của các milestone là relational repository production cho toàn domain, device thật, camera/biometric native, performance/concurrency quy mô lớn, remote CI và các kiểm soát staging/production.

## Cập nhật bằng chứng transfer pending — 2026-08-17

- Transfer `PENDING` đã được kiểm tra trên Android emulator sau khi dừng ứng dụng và mở lại; trạng thái vẫn được đọc từ backend PostgreSQL persistent.
- Artifact: `C:\Users\admin\.maestro\tests\2026-08-17_125314`.
- M4 hiện có bằng chứng emulator cho quote/review/step-up/submit và pending-resume. Gate còn lại là thiết bị thật, camera QR/permission native, concurrency quy mô lớn và staging.
- Các bước tiếp theo theo phạm vi: reproducible CI → hardening lỗi mạng/concurrency → repository relational canonical (nếu bàn giao persistent dài hạn) → Android thật → bộ bằng chứng và runbook.

## Cập nhật hardening request boundary — 2026-08-17

- Persistent server đã tách bước đọc/parse body khỏi transaction relational; body không hợp lệ được trả lỗi validation trước khi lấy advisory lock và lỗi 4xx/5xx không commit state dở dang.
- Regression suite PostgreSQL đạt 70/70; critical API đạt 8/8. Cleanup quote/outbox và retry idempotency đã có regression; đây là hardening reference sandbox, chưa thay thế rate-limit phân tán hoặc gateway production.

## Cập nhật hardening nghiệp vụ — working tree 2026-08-24

### Đã có implementation/reference regression

- Transfer, Savings opening và Credit payment dùng client intent chung `DRAFT_QUOTE`, `SUBMIT_UNKNOWN`, `ACCEPTED_PENDING`, `ACCEPTED_TERMINAL`. Intent đã submit không bị xóa vì quote hết hạn; accepted operation chỉ refresh qua status endpoint, receipt terminal giữ tới lúc user xác nhận/rời chủ đích. Transfer/Savings scope theo user, Credit theo user+card; legacy global migrate an toàn cho đúng owner.
- Auth session có `sessionEpoch`; refresh/retry không dùng single-flight chung giữa hai phiên. `401` refresh là terminal, còn network/timeout/abort/429/5xx giữ session và recovery intent. Logout/logout-all trả kết quả local/remote riêng để UI không tuyên bố revoke mọi thiết bị khi server chưa xác nhận; chỉ xóa auth session, không purge intent tài chính/fraud đang cần resume.
- Persistent HTTP transaction boundary không còn suy ra commit chỉ từ status code: DomainError chỉ giữ whitelist mutation bảo mật và audit thất bại step-up tương ứng; audit nghiệp vụ của aggregate rollback không được giữ. Regression bao phủ refresh-family reuse, login rate-limit, challenge lock qua restart, security-failure audit và forced business rollback.
- Fraud report kiểm tra `Idempotency-Key` tối thiểu 8 ký tự, từ chối field thừa, có fingerprint, durable report record, PostgreSQL projection, audit/outbox và `GET /fraud-reports/{reportId}`. Invariant chỉ cho một case `RECEIVED` trên mỗi customer/transaction; retry cùng nội dung dù dùng key mới trả report cũ, còn nội dung xung đột trả `409`. Status reference hiện chỉ là `RECEIVED`.
- Credit chặn payment trên statement cũ, chặn payment mới khi account còn payment `PENDING`, revalidate overpay ở quote/submit/settle và đưa invariant vào reconciliation/health. Đã trả đủ minimum không bị đánh `OVERDUE` chỉ vì còn statement balance.
- Public Savings/Credit GET đã read-only ở domain reference; operator command sandbox settle transfer/savings opening/credit payment `PENDING` trước khi chạy maturity/statement. Đây chưa phải durable worker/core callback.
- Pending registration snapshot không còn chứa plaintext password; state migration loại field plaintext legacy.
- Maturity savings kiểm tra liability/gốc+lãi, idempotency qua restart và reconciliation hai chiều deposit ↔ liability, gồm orphan và renewal chain; mismatch làm health `degraded`. Cursor transaction/credit chuyển sang keyset bind theo account/resource.
- Mobile chỉ chấp nhận registration OTP hai bước, bắt buộc device ID, khóa form sau challenge; session cold-start/background không mount dữ liệu bảo vệ trước khi refresh thành công. Biometric tĩnh mặc định bị tắt.
- eKYC customer không còn tự duyệt và QR `UNVERIFIED` không còn shortcut sang chuyển tiền.
- OpenAPI v0.2 bind mọi operation bearer với `X-Device-ID`, Auth public khai báo header trực tiếp và mọi step-up bắt buộc `challengeId`; validator Backend/Mobile chống tái lệch contract.
- Step-up sai trong command tài chính trả `409 STEP_UP_VERIFICATION_FAILED` để không kích hoạt refresh/replay; canonical replay sau quote consume giữ nguyên operation, còn state thiếu chuyển manual review.
- Transfer/Savings/Credit/Fraud recovery intent fail-closed khi SecureStore malformed/read error; fraud rejection đã biết dọn local intent sau cleanup thành công, còn outcome không rõ vẫn retry cùng key.

### Bằng chứng local hiện có cho worktree

- Backend `npm run typecheck`, `npm run build`, live database contract, OpenAPI và `npm test` đã đạt: 91 test definition, 91 pass, 0 PostgreSQL/relational skip; `test:critical` 10/10 pass.
- Mobile full gate đã đạt: lint, typecheck, 46 suite/260 unit test, coverage 85,53% statement/86,57% branch, OpenAPI 43 path, 10 Maestro flow syntax và web export 33 route với build-time HTTPS URL.

### Chưa đóng

- Chưa có durable worker/scheduler chạy các command đã tách: job lease/idempotency, retry/backoff, crash recovery, core callback và monitoring vẫn là target DRAFT, chưa triển khai đầy đủ.
- PostgreSQL live validator và relational concurrency đã đạt trên database disposable local; fraud/device cloud evidence, registry scan và managed backup/restore vẫn chưa có.
- Chưa có device E2E cho timeout sau server commit, force-stop sau quote TTL, logout rồi re-login cùng user để resume, cross-user isolation, logout-all remote revoke hoặc fraud retry/status.
- Mọi API/behavior mới vẫn là DRAFT; chưa có core/fraud/identity/credit product/legal approval, staging, physical-device evidence, monitoring hoặc signing. Không thay đổi kết luận: **chưa pilot/production-ready**.

## Giai đoạn 1 — Docker và Preview Persistent — 2026-08-24

- Đã thêm Dockerfile multi-stage cho Backend: build TypeScript ở builder, runtime JavaScript `dist/server.js`, production dependencies, user non-root, healthcheck và commit SHA metadata.
- Đã thêm migration runner Node-native, `compose.yaml` với PostgreSQL 16 volume → migrate one-shot → Backend, `.env.compose.example` và CI container smoke workflow.
- Đã thêm `/livez` độc lập database, `/healthz`/`/readyz` readiness, CORS deny ngoài allow-list và `container-smoke.cjs`; Docker Compose local đã build/run và smoke qua đăng ký, restart backend, restart toàn stack giữ volume.
- Đã kiểm chứng migration rỗng/lặp, runtime non-root/no-`tsx`, live PostgreSQL test 91/91, backup/restore local và health JSON tại `documents/05-testing/`.
- Còn mở ngoài workspace: provider/registry/GHCR, PostgreSQL managed, domain HTTPS, EAS environment, APK staging, registry digest và rollback cloud. Không tuyên bố cloud/device/production readiness khi chưa có các evidence đó.

## P1 — Backup và phục hồi thảm họa — 2026-08-25

- Đã khóa migration `028_dr_recovery_markers` và cập nhật baseline theo 28 migration; evidence Stage 1 chỉ có 5 migration được đánh dấu historical.
- Đã triển khai logical backup custom-format qua AES-256-GCM, authenticated metadata, manifest SHA-256 plaintext/ciphertext, lock chống chạy trùng, verify, restore DB mới, retention dry-run, surface validator và marker synthetic.
- Local PostgreSQL 16 rehearsal đạt: verify/tamper tests, restore database mới, 28 migration checksum, counts nghiệp vụ, ledger debit=credit và orphan reference `0`; actual RTO lần chạy là 3.509s, actual RPO chưa đo.
- Đã thêm policy/runbook PITR, key rotation, provider infrastructure contract, alert/dashboard contract; các file này chưa được nối vào Prometheus/Grafana/KMS/object storage.
- Còn mở: managed PostgreSQL, base backup + continuous WAL/PITR, KMS/object storage/retention audit, scheduler production, RPO ≤5 phút/RTO ≤60 phút drill, session/outbox recovery cutover và staging evidence. Trạng thái vẫn **UNTRUSTED LOCAL PREVIEW**.

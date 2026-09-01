# PROJECT_CONTEXT — Banking System

> Snapshot đã kiểm tra: 2026-09-01, branch `codex/staging-academic-completion`, HEAD `6ee6c2258c6d0a937d5902a586d8449813cdb519`. Local completion evidence được tạo quanh commit trước đó `62ed13d8d912956aed7b36769f850fd1c5c65c59`; commit mới chỉ ổn định transfer-restart E2E. Đây là context nền, không thay thế task cụ thể hoặc bằng chứng mới hơn.

## 1. Mục đích và giới hạn

Banking System là mobile banking reference/academic implementation dùng dữ liệu tổng hợp và tiền ảo. Repository dùng để học tập, kiểm thử contract, data integrity, recovery và release gates. Nó **không xử lý tiền thật**, chưa được chứng minh production/pilot-ready và không có quyền tự động kết nối core banking, payment rail, KYC/AML provider hoặc dịch vụ cloud thật.

Mọi task phải do owner chốt: mục tiêu, ưu tiên, hành vi mong muốn, phạm vi được/không được sửa, chế độ read-only hay implementation, điều kiện hoàn thành và quyền stage/commit. Nếu thiếu, mặc định chỉ audit/lập kế hoạch; không tự chọn một mục P0–P2 để làm.

## 2. Bản đồ repository và kiến trúc

- `mobile-app/`: Expo 57, React Native 0.86, Expo Router, TypeScript, Jest và Maestro. Quy tắc riêng ở `mobile-app/AGENTS.md` ưu tiên khi sửa Mobile.
- `backend/`: Node.js HTTP + TypeScript, Public API `:5000`, Admin API `:5001`, PostgreSQL relational-v2, migration runner, worker/outbox và scheduler reference.
- `admin-web/`: React/Vite/Nginx control plane, staff auth, RBAC/ABAC và maker-checker.
- `documents/`: OpenAPI Draft, kế hoạch, contract, test/evidence và readiness status.
- `infrastructure/`, `observability/`, `performance/`: contract/harness tham chiếu; chưa phải bằng chứng cloud hoặc vận hành thật.
- `artifacts/`: output local bị Git ignore; coi là vùng nhạy cảm, không đóng gói hoặc chia sẻ raw.

Luồng chính:

```text
Mobile -> Public API -> relational-v2 services/UnitOfWork -> PostgreSQL
       -> ledger + audit + outbox -> worker/scheduler (reference)

Admin Web -> Admin API -> staff session + permission/four-eyes -> PostgreSQL
```

Public API/server là nguồn sự thật cho balance, fee, interest, credit debt và transaction status. Mobile không optimistic-update số dư. Transfer/Savings/Credit Payment dùng quote, step-up, idempotency và durable intent với các phase `DRAFT_QUOTE -> SUBMIT_UNKNOWN -> ACCEPTED_PENDING/ACCEPTED_TERMINAL` để resume sau crash/timeout.

## 3. Phạm vi chức năng hiện có

Mobile có registration/login/recovery, session refresh/device binding, Accounts/Home/History, beneficiary/transfer, Savings, Credit/Card, notifications, fraud report, QR unverified, synthetic KYC, MFA và profile. HTTP client gắn bearer + device ID, timeout, refresh single-flight, retry một lần sau `401` và runtime-validate response.

Backend relational-v2 có auth/registration/MFA, accounts, beneficiaries, transfer, Savings, Credit/Card, notifications, fraud, synthetic KYC và control policy. Transfer ghi balance, transaction, double-entry ledger, audit, outbox và idempotency trong cùng transaction. Có 40 migration forward-only (`001–040`); migration là source of truth cho database. Worker có lease/retry/backoff/dead-letter/lifecycle nhưng notification provider vẫn fake/disabled và money movement vẫn là reference nội bộ.

Admin có 63 route được permission-registry kiểm soát, staff TOTP, HttpOnly cookie/CSRF, masked reads, case review, account/customer control, transfer/fraud/outbox operation, staff management và audit export.

## 4. Trạng thái đã xác minh ở baseline

- Tại commit `62ed13d`, trước diff tài liệu của phiên chuẩn bị pack, worktree sạch, branch đi trước upstream 9 commit và `npm run release:gate` trong `backend/` cho `promotionAllowed=true`. Trong lúc chuẩn bị pack, một tiến trình bên ngoài tạo commit `6ee6c22` (`test: stabilize transfer restart e2e`), đưa branch lên ahead 10. Worktree tiếp tục có thể thay đổi sau snapshot; luôn kiểm tra lại HEAD/status/gate và không reset WIP để giả lập sạch. Cả hai lần kiểm tra đều xác nhận 40 migration tracked.
- Backend evidence local gần nhất: type-check/build PASS; release suite 17/17; aggregate 206 test gồm 158 PASS và 48 skip có chủ đích đã được chạy riêng trên disposable PostgreSQL; critical HTTP 10/10, worker 10/10 và integrated API/email-capture/two-worker/two-scheduler PASS.
- Mobile: lint, type-check, OpenAPI/public-env PASS; Jest 45 suite/259 test PASS; web export 36 route. `npm run validate:e2e` hiện nhận 16 flow Git-tracked. Android emulator Pixel 7 API 35 đã chạy các flow local chính M0–M4–M8, transfer retry, Savings và Credit theo evidence hiện có.
- Admin: 7/7 test, Playwright 1/1, build PASS và dependency audit không có High/Critical theo evidence hiện có.
- Evidence chi tiết: `documents/05-testing/staging-readiness/local-completion-evidence-2026-09-01.md`. File này không tự bind SHA và còn ghi 20 Maestro flow; số 16 ở trên đã được đối chiếu lại từ Git/validator tại baseline. Full suite không được chạy lại chỉ để tạo pack.

Các kết quả trên là **local/emulator evidence được repository báo cáo quanh `62ed13d`**, không phải full-suite rerun ở `6ee6c22`, thiết bị thật hoặc staging. Chưa có managed PostgreSQL, HTTPS staging endpoint, Secret Manager/KMS, signed staging APK, immutable registry digest gắn với current staging deployment, core/partner integration, production monitoring/on-call, legal/compliance approval hoặc cloud backup/PITR rehearsal. RC.4 có artifact/digest lịch sử nhưng không xác minh source hoặc staging hiện tại.

## 5. Xung đột và rủi ro đang mở

1. Auth contract/code hiện là password-only login; `mobile-app/README.md` và 5 Maestro flow cũ vẫn tham chiếu `login-mfa-code`/`login-mfa-submit`, nhưng `LoginScreen` không có các test ID này. Owner phải quyết định sửa docs/E2E hay khôi phục login MFA; không tự đoán.
2. Năm deep Credit route có khả năng chưa nằm rõ trong `Stack.Protected`; cần kiểm chứng direct deep-link trước khi sửa.
3. `EXPO_PUBLIC_SANDBOX_HTTP=1` vẫn là bypass HTTPS công khai và chưa được chứng minh bị release gate chặn trong production-like build.
4. Evidence mới ghi 20 Maestro flow trong khi Git/validator hiện thấy 16; README E2E cũng còn số lượng và mô tả login cũ.
5. `artifacts/` hiện có legacy raw local output, khoảng 45 MB; audit metadata đã phát hiện nhiều file có marker/password/OTP fixture plaintext. Không mở rộng phát tán, upload hoặc đóng gói. Chỉ quarantine/xóa/rotate sau khi owner cho phép.
6. Không có core/payment provider thật; QR luôn `UNVERIFIED`; KYC là synthetic; telemetry Mobile mặc định no-op; dashboard/alert hiện chủ yếu là contract; performance transfer baseline từng vượt ngưỡng p95 và harness còn cần rà soát replay `409`.

## 6. Source of truth và cách bắt đầu task

Ưu tiên đối chiếu theo loại dữ liệu, không dùng một thứ làm nguồn duy nhất cho mọi vấn đề:

- Database: `backend/database/*.sql` và migration history/checksum.
- API: `documents/api/*.openapi.yaml` + runtime validators + route implementation.
- Hành vi Mobile: screen/service/storage/domain code + contract + test thực thi.
- Trạng thái release: source tree hiện tại + gate vừa chạy + evidence gắn đúng commit/build/environment.

Nếu code, contract, test và tài liệu mâu thuẫn, báo chính xác file/bằng chứng, tác động và lựa chọn cần owner quyết định. Không sửa ngoài phạm vi để “đồng bộ” ngầm.

Mỗi cuộc trò chuyện nên chọn một kết quả chính. Task mới tối thiểu phải có: tên/mục tiêu/priority; hiện tại và mong muốn; cách tái hiện; môi trường/evidence; được phép và cấm sửa; chế độ làm việc; acceptance criteria; quyền Git. Nếu phiên bản môi trường hoặc file liên quan chưa rõ, có thể ghi “hãy tự kiểm tra trong repository”.

Repository hiện không có `README.md` ở root. Khi khởi động task, đọc `AGENTS.md`, file này và README đúng module: `mobile-app/README.md`, `backend/README.md` hoặc `admin-web/README.md`.

`TASK_TEMPLATE.md` là mẫu soạn prompt, không phải task đang hoạt động. Owner phải tạo bản sao, điền toàn bộ placeholder, chọn đúng một chế độ và một priority, rồi xóa lựa chọn/hướng dẫn thừa trước khi giao Codex.

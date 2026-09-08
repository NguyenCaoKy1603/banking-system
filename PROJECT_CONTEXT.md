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

### Cập nhật hoàn thành Use Case UC-M01 (2026-09-07)

- **Trạng thái**: Use Case **UC-M01 — Registration và Synthetic KYC** đã chính thức hoàn thành và đóng nghiệm thu (**COMPLETED — OWNER APPROVED**) tại commit HEAD `b5ef30cb78eaa43932a2ba14f3989aab6e648994` theo biên bản kiểm toán `tasks/UC-M01/TASK_M01_09_AUDIT_AND_CLOSE_UC_M01.md`.
- **Phạm vi kiểm chứng và kết quả kế thừa**:
  - Chuỗi nhiệm vụ `M01-01` đến `M01-08` đã đối soát và giải quyết 15/15 quyết định kiến trúc chuẩn hóa (D-01 đến D-15).
  - Toàn bộ suite kiểm thử Mobile đạt 51 suites / 373 tests PASS (mở rộng từ baseline 45 suites / 259 tests).
  - PostgreSQL relational verification (M01-07): áp dụng 40/40 migration trên disposable PostgreSQL; mỗi tệp kiểm thử `src/tests/registrationRelational.test.ts` và `src/tests/kycRelational.test.ts` báo 1/1 top-level test PASS từ runner, kiểm chứng tuần tự 16 tiêu chí `KYC-01` đến `KYC-16` và vòng đời đăng ký relational.
  - Android Emulator runtime verification (M01-08): APK build mới từ HEAD `b5ef30cb` trên Pixel 7 API 34 đạt PASS luồng Registration Happy Path (`E2E-REG-01`) và KYC Draft → Submit (`E2E-KYC-01`, `E2E-KYC-02` hiển thị `••••8901`, khóa form và hiển thị ghi chú thẩm quyền; không phát sinh `INVALID_RESPONSE`).
- **Giới hạn đồ án đã được Owner phê duyệt (Accepted Limitations)**:
  1. Giới hạn KYC-15: Vi phạm ràng buộc 23505 trên primary key (`kyc_applications_pkey`) được kiểm chứng qua unit/contract test (`T-KYC-BE-13` rethrow không map thành 409), trong khi open-index conflict 23505 và lỗi ngoại khóa 23503 rollback được kiểm chứng trên PostgreSQL thật.
  2. Kịch bản biên phục hồi `BEGIN_UNKNOWN` (`E2E-REG-04`), khôi phục OTP sau process-kill (`E2E-REG-02`) và hủy challenge (`E2E-REG-03`) được nghiệm thu qua Jest unit suite `RegisterScreen.test.tsx`, chưa chạy độc lập trên emulator runtime.
  3. Bảo mật dữ liệu: Full synthetic identity number được lưu trữ hợp lệ tại backend database trong cột JSONB `kyc_applications.synthetic_payload` (`synthetic_payload.identityNumber`) theo migration 038 và nghiệp vụ đồ án, nhưng public response chỉ trả `identityNumberLast4`; client local storage không lưu CCCD; quét `validate:public-env` đạt 216 file PASS nhưng không cam kết zero leakage tuyệt đối toàn hệ thống runtime.

### Cập nhật hoàn thành Use Case UC-M02 (2026-09-07)

- **Trạng thái**: Use Case **UC-M02 — Đăng nhập, quản lý phiên và đăng xuất** đã chính thức hoàn thành và đóng nghiệm thu (**COMPLETED — OWNER APPROVED**) theo biên bản kiểm toán `tasks/UC-M02/TASK_M02_07_AUDIT_AND_CLOSE_UC_M02.md`.
- **Phạm vi kiểm chứng và kết quả kế thừa**:
  - Chuỗi nhiệm vụ `M02-01` đến `M02-07` đã đối soát và hoàn thiện đầy đủ các khía cạnh kỹ thuật của luồng xác thực và vòng đời phiên.
  - Phía Mobile Client: bảo toàn 51 suites / 379 unit tests PASS (bao gồm 12/12 `AuthContext.test.tsx` và 7/7 `httpClient.test.ts`), lint và typecheck đạt 0 lỗi; cấu hình và bảo vệ 5 route Credit sâu qua `<Stack.Protected guard={isAuthenticated}>` trong `_layout.tsx` (kiểm chứng trực tiếp trên emulator: 5/5 anonymous checks bị chặn tại Login, 4 positive controls hiển thị dữ liệu hợp lệ, 1 payment-result error-state navigation đạt).
  - Phía Backend & Relational: xác minh token reuse revocation bền vững, logout current session và logout-all trên PostgreSQL 16 disposable với 40 migrations (`authRelational.test.ts`). Căn chỉnh allowlist runner tối thiểu cho `databaseFoundation.test.ts` và thực thi thành công test `login rate-limit buckets lock before password verification, expire safely and reset on success` (11/11 tests pass trong suite `databaseFoundation.test.ts`).
- **Giới hạn đồ án đã được Owner phê duyệt (Accepted Limitations)**:
  1. Đăng xuất: Bằng chứng kết hợp giữa HTTP in-memory mock (`http.test.ts`) và relational service PostgreSQL (`authRelational.test.ts`); chưa có test suite HTTP server tích hợp chạy qua `RelationalHttpBoundary` kết nối PostgreSQL disposable cho 2 endpoint logout.
  2. Lưu trữ an toàn Client: Kiểm chứng qua mock của `authSessionStorage` và kiểm thử UI automation trên emulator; không tuyên bố tính bền vững hoặc chống giả mạo trên chip bảo mật phần cứng gốc (Hardware Keystore/Keychain/HSM).
  3. Vòng đời ứng dụng: Logic cold start và AppState transition được kiểm chứng ở tầng React Native component unit test (`AuthContext.test.tsx`); chưa có E2E test tự động kill process OS và restart trên emulator.
  4. Bảo vệ route: Kiểm chứng thực nghiệm trực tiếp trên 5 route Credit sâu đã nhận diện khoảng trống; các route còn lại được bảo vệ thông qua cấu trúc khai báo tường minh trong `_layout.tsx`.

### Cập nhật hoàn thành Use Case UC-M03 (2026-09-08)

- **Trạng thái**: Use Case **UC-M03 — Quản lý phương thức xác thực và khôi phục MFA** đã chính thức hoàn thành và đóng nghiệm thu Đợt 1 (**COMPLETED — OWNER APPROVED**) theo biên bản `tasks/UC-M03/TASK_DOT_1_HOAN_TAT_AUTHENTICATION_MFA.md`.
- **Phạm vi kiểm chứng và kết quả kế thừa**:
  1. Khắc phục lỗi TTL recovery request trong `PersistentMfaService`: `expiresAt = cooldownUntil + 15m`.
  2. Sửa lỗi AAD encryption context trong `beginRecoveryTotpEnrollment`, đảm bảo credential khôi phục sử dụng được cho mọi thử thách xác thực / step-up.
  3. Bổ sung endpoint `POST /auth/mfa/recovery-codes/rotate`, mã lỗi 409, schema và tài liệu thu hồi session vào `documents/api/banking-mvp.openapi.yaml`.
  4. Cập nhật test contract KYC (`kycContract.test.ts`) phản ánh chính xác thay đổi OpenAPI đã duyệt một cách tường minh và độc lập (28/28 tests PASS).
  5. Kế thừa cơ chế client continuation của M03-10 trên Mobile (`MfaRecoveryScreen.tsx`) khi backend hoàn tất phục hồi (409 `MFA_RECOVERY_ALREADY_COMPLETED`).
  6. Đạt các quality gates: unit regression (5 mốc clock), relational PostgreSQL disposable (`npm run test:mfa:persistence` 4/4 PASS), demo 6 luồng HTTP lifecycle (PASS), Mobile full suite (54/54 suites, 408/408 tests PASS), backend critical HTTP (11/11 PASS) và OpenAPI validation (PASS).
  7. APK build release mới đã được biên dịch bằng Gradle và cập nhật thành công lên Android emulator hiện có (`emulator-5554`) qua `adb install -r`, kiểm chứng khởi động và hiển thị đúng màn hình đăng nhập an toàn.
- **Giới hạn đồ án đã được Owner phê duyệt (Accepted Limitations)**:
  1. MFA UI interactive flow trên emulator chưa chạy do chưa có daemon backend persistent chạy thường trực tại `http://10.0.2.2:5000`; APK mới chỉ có bằng chứng build, install và startup smoke test PASS; bằng chứng component Jest, HTTP lifecycle và PostgreSQL không thay thế tương đương cho emulator E2E.
  2. Recovery continuation chỉ hoạt động khi `recoveryToken` còn trong memory state của màn hình; ứng dụng không lưu trữ token ra disk và không hỗ trợ khôi phục sau cold restart / process-kill.
- **Điểm tiếp tục Đợt 2**: Chuẩn bị backend local phục vụ demo và kiểm chứng tích hợp Mobile trực tiếp trên emulator.

## 5. Xung đột và rủi ro đang mở

1. Auth contract/code hiện là password-only login; `mobile-app/README.md` và 5 Maestro flow cũ vẫn tham chiếu `login-mfa-code`/`login-mfa-submit`, nhưng `LoginScreen` không có các test ID này (UC-M02 đã đồng bộ và chuẩn hóa flow password-only; quản lý MFA/TOTP thuộc về UC-M03).
2. `EXPO_PUBLIC_SANDBOX_HTTP=1` vẫn là bypass HTTPS công khai và chưa được chứng minh bị release gate chặn trong production-like build.
3. Evidence mới ghi 20 Maestro flow trong khi Git/validator hiện thấy 16; README E2E cũng còn số lượng và mô tả login cũ.
4. `artifacts/` hiện có legacy raw local output, khoảng 45 MB; audit metadata đã phát hiện nhiều file có marker/password/OTP fixture plaintext. Không mở rộng phát tán, upload hoặc đóng gói. Chỉ quarantine/xóa/rotate sau khi owner cho phép.
5. Không có core/payment provider thật; QR luôn `UNVERIFIED`; KYC là synthetic; telemetry Mobile mặc định no-op; dashboard/alert hiện chủ yếu là contract; performance transfer baseline từng vượt ngưỡng p95 và harness còn cần rà soát replay `409`.

## 6. Source of truth và cách bắt đầu task

Điểm tiếp tục sau Đợt 1: Báo cáo Owner nghiệm thu kết quả Authentication/MFA (UC-M03). `USE_CASE_ROADMAP.md` tại repository root lưu danh mục đề xuất 16 use case Mobile + 6 Admin. UC-M01 và UC-M02 đã hoàn tất; UC-M03 đã hoàn tất Đợt 1 chờ Owner nghiệm thu; các use case tiếp theo (UC-M04 đến UC-M16) chưa triển khai. Danh mục mới không đồng nhất với milestone cũ M0–M11/S1–S5 và không tự mở rộng phạm vi đã duyệt.

Ưu tiên đối chiếu theo loại dữ liệu, không dùng một thứ làm nguồn duy nhất cho mọi vấn đề:

- Database: `backend/database/*.sql` và migration history/checksum.
- API: `documents/api/*.openapi.yaml` + runtime validators + route implementation.
- Hành vi Mobile: screen/service/storage/domain code + contract + test thực thi.
- Trạng thái release: source tree hiện tại + gate vừa chạy + evidence gắn đúng commit/build/environment.

Nếu code, contract, test và tài liệu mâu thuẫn, báo chính xác file/bằng chứng, tác động và lựa chọn cần owner quyết định. Không sửa ngoài phạm vi để “đồng bộ” ngầm.

Mỗi cuộc trò chuyện nên chọn một kết quả chính. Task mới tối thiểu phải có: tên/mục tiêu/priority; hiện tại và mong muốn; cách tái hiện; môi trường/evidence; được phép và cấm sửa; chế độ làm việc; acceptance criteria; quyền Git. Nếu phiên bản môi trường hoặc file liên quan chưa rõ, có thể ghi “hãy tự kiểm tra trong repository”.

Repository hiện không có `README.md` ở root. Khi khởi động task, đọc `AGENTS.md`, file này và README đúng module: `mobile-app/README.md`, `backend/README.md` hoặc `admin-web/README.md`.

`TASK_TEMPLATE.md` là mẫu soạn prompt, không phải task đang hoạt động. Owner phải tạo bản sao, điền toàn bộ placeholder, chọn đúng một chế độ và một priority, rồi xóa lựa chọn/hướng dẫn thừa trước khi giao Codex.

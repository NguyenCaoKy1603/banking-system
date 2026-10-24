# TASK M02-07 — Audit and Close UC-M02 (Authentication and Session Lifecycle)

> **Trạng thái nhiệm vụ:** COMPLETED — OWNER APPROVED.
>
> **Trạng thái Use Case UC-M02:** COMPLETED — OWNER APPROVED.
>
> Ngày phê duyệt nghiệm thu: 2026-09-07.
>
> Phân hệ: Cross-cutting / Delivery Lead & Audit (Owner / Thành viên 1 — Backend & Core, Thành viên 2 — Mobile & E2E).
>
> Quyết định Owner: Owner chính thức phê duyệt nghiệm thu Use Case UC-M02 ở mức Academic Capstone dựa trên bằng chứng kỹ thuật toàn diện trong tài liệu này (bao gồm login relational đã chạy PASS trên PostgreSQL 16 disposable) và chấp thuận 4 ranh giới học thuật đã nêu.

---

## 1. Thông tin dự án và quyền truy cập

- **Tên dự án:** Banking System
- **Vị trí Windows:** `C:\Projects\banking-system`
- **Repository root thực tế:** `C:\Projects\banking-system`
- **Quyền truy cập:** Codex được mở tại repository root của local project.
- **Xác nhận Preflight:**
  - CWD: `C:\Projects\banking-system`
  - Git branch: `codex/staging-academic-completion`
  - Git HEAD nền: `679ef87759f9c350b5f25ac6688b9cadd842bf4c`
  - Git baseline:
    - `modified: PROJECT_CONTEXT.md` (được duyệt cập nhật trong phiên closure)
    - `untracked: USE_CASE_ROADMAP.md` (được duyệt cập nhật trong phiên closure)
    - Index sạch; không có WIP source/test nào khác ngoài phạm vi.
- **Mục đích:** Dự án mobile banking academic/reference implementation dùng dữ liệu tổng hợp (synthetic) và tiền ảo, hướng tới kiểm thử local và phục vụ bảo vệ đồ án tốt nghiệp. Không phải hệ thống xử lý tiền thật, pilot đã xác minh hoặc production-ready.
- **Tài liệu đã đối soát:**
  - `AGENTS.md` và `mobile-app/AGENTS.md`
  - `PROJECT_CONTEXT.md`
  - `USE_CASE_ROADMAP.md`
  - `TASK_TEMPLATE.md`
  - `documents/api/auth-session-api-contract.md`
  - `documents/api/banking-mvp.openapi.yaml`
  - Chuỗi hồ sơ task UC-M02:
    - `tasks/UC-M02/TASK_M02_01_FIX_REFRESH_REUSE_REVOCATION.md`
    - `tasks/UC-M02/TASK_M02_02_SYNC_PASSWORD_ONLY_LOGIN_LOGOUT_E2E.md`
    - `tasks/UC-M02/TASK_M02_03_VERIFY_LOGOUT_RELATIONAL.md`
    - Phiên audit kỹ thuật M02-04 (chế độ `DIAGNOSE_AND_PLAN` chỉ đọc, không tạo file task/commit riêng trong repository theo xác nhận từ M02-05)
    - `tasks/UC-M02/TASK_M02_05_VERIFY_CLIENT_SESSION_LIFECYCLE.md`
    - `tasks/UC-M02/TASK_M02_06_VERIFY_AND_PROTECT_CREDIT_DEEP_ROUTES.md`

---

## 2. Chế độ làm việc và quyền Git

- **Chế độ làm việc:** `IMPLEMENTATION` & `DELIVERY_CHECKPOINT` (Nghiệm thu đóng use case và lưu checkpoint cục bộ)
- **Quyền sửa đổi:**
  - `backend/src/database/disposableDatabaseGuard.ts` (căn chỉnh allowlist test path tối thiểu)
  - `backend/src/tests/disposableDatabaseGuard.test.ts` (bổ sung regression tests cho guard)
  - `tasks/UC-M02/TASK_M02_07_AUDIT_AND_CLOSE_UC_M02.md` (hoàn tất hồ sơ nghiệm thu)
  - `PROJECT_CONTEXT.md` (đồng bộ trạng thái closure UC-M02)
  - `USE_CASE_ROADMAP.md` (chuyển UC-M02 sang COMPLETED, chỉ định UC-M03 là điểm tiếp tục)
- **Quyền Git:** Tạo đúng một local commit theo thông điệp được duyệt, không push, không amend.


---

## 3. Lịch sử Chuỗi Nhiệm vụ UC-M02 (Task & Commit Lineage)

Đối chiếu chính xác theo `git log` của nhánh `codex/staging-academic-completion`:

| Mã Task | Trạng thái ghi nhận | Commit SHA / Snapshot | Mô tả tóm tắt kết quả kỹ thuật |
| :--- | :---: | :--- | :--- |
| **M02-01** | COMPLETED — VERIFIED | `c2b97e9cdb8285ca02666cadf17f1d28fdcef415` | Sửa lỗi rollback transaction trong `RelationalAuthService.refresh` khi phát hiện reuse token; commit bền vững việc thu hồi token family trên PostgreSQL và trả về 401; kiểm chứng trên PostgreSQL disposable với 40 migrations. |
| **M02-02** | COMPLETED — VERIFIED | `b1453f76dc5d593d3d21f3eff5ba6d045011564b` | Đồng bộ flow password-only login (loại bỏ login MFA challenge); kiểm chứng UI automation Maestro trên Android Emulator cho 3 kịch bản: login password-only, logout current device, logout-all devices; redact hoàn toàn fixtures nhạy cảm. |
| **M02-03** | COMPLETED — VERIFIED | `850228b1f8dd89e8b1a5985775c8a6b0f2256c11` | Kiểm chứng tầng relational service và PostgreSQL disposable: thu hồi phiên trên 3 bảng schema (`auth_sessions`, `refresh_session_families`, `refresh_session_records`), audit events (`SESSION_REVOKED`, `ALL_SESSIONS_REVOKED`), cách ly pre-existing family và cross-customer, boundary checks (wrong device, unknown token, idempotency, revoked bearer boundary trả 401). |
| **M02-04** | COMPLETED — AUDIT ONLY | *Phiên chỉ đọc (read-only), không có commit riêng* | Phiên kỹ thuật đối soát vòng đời phiên còn thiếu (cold start, transient errors, background/foreground, route guards); không tạo file hay commit riêng trong repository. |
| **M02-05** | COMPLETED — VERIFIED | `95c05d35bbed510c175309fe68ea10dd3332cd5f` | Bổ sung 6 unit lifecycle test có mục tiêu trong `AuthContext.test.tsx` (tổng 12/12 test pass): cold start restore với deferred promise, xử lý 4 loại lỗi transient (network null, timeout null, 429 rate limit, 500 server error) giữ session locked và retry thành công, tự động khóa khi chuyển AppState sang background/inactive và tự động refresh khi active. |
| **M02-06** | COMPLETED — VERIFIED | `679ef87759f9c350b5f25ac6688b9cadd842bf4c` | Thêm đúng 5 route Credit sâu vào `<Stack.Protected guard={isAuthenticated}>` trong `_layout.tsx`; kiểm chứng trên emulator: 5/5 anonymous deep-link checks bị chặn ở Login screen; positive control trên session authenticated hiển thị đầy đủ giao diện và dữ liệu theo hợp đồng. |

---

## 4. Ma trận Đối soát Bằng chứng Toàn diện UC-M02

| Hành vi nghiệp vụ | Vị trí Source / Contract | Bằng chứng Kiểm thử (Evidence) | Tầng kiểm chứng | Mức độ xác minh | Khoảng trống / Giới hạn cần lưu ý |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **1. Password-only Login (Thành công)** | Mobile: `LoginScreen.tsx`, `AuthContext.tsx`<br>Backend: `http.ts` (line 908–918), `relationalAuthService.ts` (`loginPasswordOnly`)<br>Contract: `auth-session-api-contract.md` | - Mobile E2E: `critical-auth-and-logout.yaml` (M02-02 checkpoint `b1453f7`, M02-06 checkpoint `679ef87`)<br>- Backend HTTP in-memory: `http.test.ts` (line 450–459: POST `/auth/login` trả 200, cấp access & refresh token)<br>- Backend relational execution: `databaseFoundation.test.ts` (test: `login rate-limit buckets lock before password verification, expire safely and reset on success` chạy thành công trên PostgreSQL 16 disposable với 40 migrations qua `npm run test:database`) | Emulator UI, Unit HTTP Mock, Relational Disposable PG | **VERIFIED (Client UI E2E, HTTP In-Memory & Relational Disposable PG)** | Đã xác minh thực tế cả luồng UI, HTTP API và dịch vụ cơ sở dữ liệu quan hệ PostgreSQL với 40 migrations; cấp token và reset bucket thành công khi đăng nhập đúng mật khẩu. |
| **2. Password-only Login (Lỗi: sai mật khẩu, tài khoản không tồn tại)** | Backend: `relationalAuthService.ts` (`loginPasswordOnly` ném `DomainError` 401 "Invalid credentials.") | - Backend relational execution: `databaseFoundation.test.ts` (kiểm chứng trực tiếp trên PostgreSQL 16 disposable: sai mật khẩu hoặc email lạ đều ném `DomainError` 401 "Invalid credentials." thống nhất)<br>- Client unit: `LoginScreen.test.tsx` (hiển thị alert thông báo lỗi khi API lỗi) | Client Unit, Relational Disposable PG | **VERIFIED (Combined Tiers)** | Đã kiểm chứng thực thi trên PostgreSQL 16 disposable qua `npm run test:database` (11/11 tests pass). Không để lộ sự tồn tại của tài khoản qua thông điệp lỗi. |
| **3. Password-only Login (Rate limit / Account Lockout)** | Backend: `relationalAuthService.ts`, migration `034_policy_entitlements_login_rate_limit.sql` (bảng `rate_limit_buckets`) | - Backend relational execution: `databaseFoundation.test.ts` (kiểm chứng trực tiếp trên PostgreSQL 16 disposable: 2 lần sai trả 401, lần thứ 3 ném DomainError 429 và ghi `blocked_until`, đồng thời kiểm tra concurrent lock trên `rate_limit_buckets`)<br>- Backend HTTP persistence: `http-security-persistence.test.ts` (line 145–165: 5 lần sai trả HTTP 401, lần tiếp theo trả HTTP 429 trên in-memory `MemoryStateRepository`) | HTTP In-Memory Mock, Relational Disposable PG | **VERIFIED (Combined Tiers)** | Đã kiểm chứng thực thi trực tiếp trên PostgreSQL 16 disposable qua `npm run test:database` (test target pass trong 2122ms; suite 11/11 pass). Bucket khóa an toàn trước khi verify mật khẩu và giải phóng khi hết hạn. |
| **4. Refresh rotation & Reuse revocation** | Backend: `RelationalAuthService.refresh`, `auth_sessions`, `refresh_session_families` | - Backend mock: `authContract.test.ts` (line 67–187: reuse detection commit revocation trên DB client mock, ném DomainError 401)<br>- Backend relational: `authRelational.test.ts` (test 1: reuse commit revocation trên PostgreSQL disposable với 40 migrations, đã verify tại M02-01 và M02-03) | Unit Contract Mock, Relational Disposable PG | **VERIFIED** | Khắc phục triệt để lỗi rollback transaction tại M02-01; commit thu hồi token family bền vững khi phát hiện replay. |
| **5. Cách ly phiên (Multi-Family & Multi-Customer)** | Backend: `relationalAuthService.ts` | - Backend relational: `authRelational.test.ts` (test 1 & 2: Family B vẫn active khi Family A bị revoke; test 3: Customer V vẫn active khi Customer U bị logout-all trên PostgreSQL disposable) | Relational Disposable PG | **VERIFIED** | Đã kiểm chứng trực tiếp trên cơ sở dữ liệu quan hệ PostgreSQL disposable tại M02-03. |
| **6. Logout thiết bị hiện tại (`POST /auth/logout`)** | Client: `AuthContext.logout` (`authService.ts`)<br>Backend: `http.ts` (line 983–1001), `relationalAuthService.revoke` | - Client E2E: `critical-auth-and-logout.yaml` (Scenario B: bấm nút logout, UI quay về Login screen, M02-02)<br>- Client unit: `AuthContext.test.tsx` (test: vô hiệu hóa epoch, xóa SecureStore record, M02-05)<br>- Backend relational: `authRelational.test.ts` (test 2: thu hồi 3 bảng schema `auth_sessions`, `refresh_session_families`, `refresh_session_records`, audit `SESSION_REVOKED`, lặp lại trả `true`, M02-03)<br>- Backend HTTP in-memory: `http.test.ts` (line 469–474: trả HTTP 204) | Emulator UI, Client Unit, Relational PG Service, HTTP Mock | **VERIFIED (Combined Tiers)** | *Ranh giới đã biết:* Test relational service kiểm chứng logic trả `true` và persist DB; HTTP 204 được kiểm chứng tại `http.test.ts` (in-memory harness). Chưa có test HTTP server tích hợp chạy qua `RelationalHttpBoundary` kết nối PostgreSQL disposable. |
| **7. Logout tất cả thiết bị (`POST /auth/logout-all`)** | Client: `AuthContext.logoutAll`<br>Backend: `http.ts` (line 1004–1016), `relationalAuthService.revokeAllSessions` | - Client E2E: `critical-auth-and-logout.yaml` (Scenario C: confirm Native Alert, UI quay về Login screen, M02-02)<br>- Client unit: `AuthContext.test.tsx` (test: refresh 1 lần để logout-all nếu token hết hạn, M02-05)<br>- Backend relational: `authRelational.test.ts` (test 3: thu hồi mọi families, audit `ALL_SESSIONS_REVOKED`, Bearer đã revoke bị từ chối với status 401, M02-03)<br>- Backend HTTP in-memory: `http.test.ts` (line 486–493: trả HTTP 204, line 495–501: truy cập sau logout trả HTTP 401) | Emulator UI, Client Unit, Relational PG Service, HTTP Mock | **VERIFIED (Combined Tiers)** | *Ranh giới đã biết:* Tương tự mục 6, kiểm chứng kết hợp giữa Relational Service PG và HTTP in-memory mock. |
| **8. Khởi động ứng dụng & Khôi phục phiên (Cold start)** | Client: `AuthContext.tsx` (`loadAuthSession`, `refreshSession`) | - Client unit: `AuthContext.test.tsx` (test kịch bản cụ thể: khởi động với session lưu sẵn: giữ trạng thái `refreshing`, `isAuthenticated=false` trong khi chờ promise, và chỉ chuyển `authenticated` sau khi refresh promise resolve, M02-05) | Client Unit | **VERIFIED (Scenarios Tested)** | Kiểm chứng ở tầng unit provider logic với deferred promise; chưa có E2E test kill process và launch lại trên emulator. |
| **9. Lỗi tạm thời khi restore & Cơ chế Retry** | Client: `AuthContext.tsx`, `refreshFailure.ts` | - Client unit: `AuthContext.test.tsx` (4 test cases cụ thể: lỗi mạng `status: null`, timeout `status: null`, rate-limit `429`, server error `500`; không gọi `clearAuthSession`, giữ session `locked`, retry `refreshAccessToken()` thành công chuyển `authenticated`, M02-05) | Client Unit | **VERIFIED (Scenarios Tested)** | Đã kiểm chứng 4 kịch bản lỗi tạm thời đã nêu; session không bị xóa nhầm khi gặp các lỗi này. |
| **10. Chuyển đổi trạng thái ứng dụng (Background / Foreground)** | Client: `AuthContext.tsx` (`AppState.addEventListener`) | - Client unit: `AuthContext.test.tsx` (test kịch bản cụ thể: chuyển sang `background`/`inactive` đưa `status` về `locked` và `isAuthenticated=false`; quay lại `active` tự động gọi refresh để tái xác thực, M02-05) | Client Unit | **VERIFIED (Scenarios Tested)** | *Giới hạn:* Bằng chứng đạt ở tầng logic component React Native unit test qua mock `AppState`; không suy rộng thành cam kết chống rò rỉ tuyệt đối ở cấp độ process OS/native window snapshot. |
| **11. Refresh Interceptor & Single-Flight** | Client: `httpClient.ts` (`refreshAccessTokenSingleFlight`, retry 401 một lần) | - Client unit: `httpClient.test.ts` (line 112–210: 2 request đồng thời chỉ kích hoạt 1 lần refresh và cùng retry với token mới; không retry 401 lần 2; không chia sẻ single-flight giữa 2 session khác nhau) | Client Unit | **VERIFIED (Isolated Unit Tier)** | *Giới hạn:* `httpClient.test.ts` kiểm chứng độc lập logic của hàm `requestJson` và `refreshAccessTokenSingleFlight` với mock fetch/refresh callback. Không suy rộng thành bằng chứng tích hợp toàn diện giữa `httpClient` và `AuthContext` ở runtime thực tế. |
| **12. Route Guard & Bảo vệ Deep Link** | Client: `mobile-app/src/app/_layout.tsx` (`<Stack.Protected guard={isAuthenticated}>`) | - Emulator Runtime: M02-06 Ma trận A (5/5 deep link thử nghiệm khi anonymous giữ nguyên tại màn hình Login; UI hierarchy dump không chứa thành phần Credit nào); Ma trận B (4 positive controls với synthetic fixture hợp lệ hiển thị đầy đủ giao diện, 1 payment-result kiểm chứng route navigation & error-state) | Android Emulator Runtime | **VERIFIED (Credit Deep Routes Tested)** | *Giới hạn:* Bằng chứng thực chứng trực tiếp trên 5 deep route của Credit; các route khác của ứng dụng được bảo vệ thông qua cấu trúc khai báo trong `_layout.tsx`. |

---

## 5. Kết quả Kế thừa từ các Quality Gates

*Ghi chú:* Các số liệu dưới đây là kết quả kiểm tra kế thừa được ghi nhận tại các checkpoint commit tương ứng trong chuỗi task UC-M02; tài liệu này đối soát lại và không trình bày như một lần chạy mới tại HEAD hiện tại.

### A. Quality Gates phía Mobile Client (Ghi nhận tại M02-05 & M02-06)
- **TypeScript Compilation:** `npm run typecheck` (mobile-app) — **PASS** (Code 0, sinh router types thành công, 0 lỗi).
- **Code Quality & Linting:** `npm run lint` (mobile-app) — **PASS** (Code 0, 0 lỗi, 0 cảnh báo).
- **Unit Test Suites:** `npm test -- --runInBand` (mobile-app) — **PASS (100%)** (51/51 test suites pass, 379/379 unit tests pass; bao gồm 12/12 test của `AuthContext.test.tsx` và 7/7 test của `httpClient.test.ts`).
- **Git Diff Check:** `git diff --check` — **PASS** (Code 0, không có lỗi whitespace hay trailing newline).

### B. Quality Gates phía Backend & Core (Ghi nhận tại M02-01 & M02-03)
- **TypeScript Compilation:** `npm run typecheck` (backend) — **PASS** (Code 0).
- **Build Output:** `npm run build` (backend) — **PASS** (Code 0, biên dịch ESM sang thư mục `dist/`).
- **Targeted Unit & Relational Test Suites:**
  - `authContract.test.ts` (Unit Mock): 7/7 tests pass (7 pass, 0 fail).
  - `authRelational.test.ts` (PostgreSQL Disposable với 40 migrations): 3/3 top-level tests pass (3 pass, 0 fail; bao gồm kiểm chứng refresh reuse revocation, logout current device, logout-all, multi-family & cross-customer isolation).
  - *Lưu ý quy chuẩn:* Không tuyên bố toàn bộ suite Backend PASS nếu chỉ chạy các targeted test suites được cho phép theo allowlist của từng task.

---

## 6. Đánh giá Rủi ro, Blocker và Sự cố Vận hành

### A. Tình trạng Blocker Kỹ thuật & Thực nghiệm Kiểm chứng Runner Login Relational
- **Lần chạy trước (BLOCKED BY RUNNER ALLOWLIST):**
  - Thực thi lệnh: `npm run test:database` (`node --import=tsx scripts/run-disposable-postgres-test.ts src/tests/databaseFoundation.test.ts`).
  - Kết quả: Lệnh dừng ngay tại pre-execution check (Exit code 1):
    ```text
    Test path 'src/tests/databaseFoundation.test.ts' is not in the approved fixed allowlist: src/tests/migrationFingerprint.test.ts, src/tests/registrationRelational.test.ts, src/tests/kycRelational.test.ts, src/tests/disposableMigrationRuntime.test.ts, src/tests/authRelational.test.ts
    ```
  - **Phân loại sự cố:** Đây là sự không đồng bộ giữa script `"test:database"` trong `package.json` và mảng `APPROVED_TEST_PATHS` trong `disposableDatabaseGuard.ts`. Sự cố này là **BLOCKED BY RUNNER ALLOWLIST**, hoàn toàn không phải do logic nghiệp vụ thất bại hay test bị skip.

- **Căn chỉnh Runner Tối thiểu & Kiểm chứng Thực thi (Được phê duyệt bởi Owner):**
  - Bổ sung duy nhất đường dẫn `src/tests/databaseFoundation.test.ts` vào `APPROVED_TEST_PATHS` tại `backend/src/database/disposableDatabaseGuard.ts` (không dùng wildcard, không nới lỏng cơ chế an toàn hay ownership checks).
  - Bổ sung 2 regression tests (`M02-REG-01`, `M02-REG-02`) tại `backend/src/tests/disposableDatabaseGuard.test.ts` xác nhận đường dẫn được chấp thuận và đường dẫn tùy ý ngoài allowlist tiếp tục bị từ chối fail-closed (155/155 tests pass).
  - Vượt qua toàn bộ Quality Gates: `npm run typecheck` (Code 0), `npm run build` (Code 0), `git diff --check` (Code 0).
  - Khởi tạo 1 PostgreSQL 16 disposable admin container tạm thời trên cổng loopback độc lập (`127.0.0.1:5434`), thực thi lệnh duy nhất:
    ```bash
    npm run test:database
    ```
  - **Kết quả Thực thi trên PostgreSQL 16 Disposable:**
    - Runner tự động áp dụng đầy đủ 40 migrations tuần tự (từ `001_banking_mvp` đến `040_card_security_and_suspense_retry`) trên cơ sở dữ liệu disposable tạm thời.
    - **Test login mục tiêu:**
      ```text
      ✔ login rate-limit buckets lock before password verification, expire safely and reset on success (2122.3814ms)
      ```
      -> **PASS**. Test đã thực sự chạy và thành công, kiểm chứng toàn diện logic:
      1. Khóa và trả về 401 thống nhất cho sai mật khẩu hoặc email lạ (không để lộ sự tồn tại của tài khoản).
      2. Tăng số lần thử trong `rate_limit_buckets` và khóa tài khoản khi vượt ngưỡng (trả về 429 sau 3 lần sai).
      3. Giải phóng khóa an toàn khi hết hạn và reset toàn bộ attempts về 0 khi đăng nhập thành công.
      4. Kiểm soát tranh chấp đồng thời (concurrency) trên cùng device bucket.
    - **Toàn bộ suite `databaseFoundation.test.ts`:**
      ```text
      ℹ tests 11
      ℹ suites 0
      ℹ pass 11
      ℹ fail 0
      ℹ cancelled 0
      ℹ skipped 0
      ℹ todo 0
      ℹ duration_ms 17231.3718
      ```
      -> **PASS (11/11 tests pass, 0 fail, 0 skipped, Exit code 0)**.
    - **Thu dọn tài nguyên:** Container `banking-admin-verify-5434` đã được dừng và xóa sạch hoàn toàn ngay sau khi kết thúc lệnh; cổng 5434 được giải phóng, biến môi trường được thu hồi sạch sẽ.

- **Đánh giá Blocker:** Khoảng trống kiểm chứng login relational đã được giải quyết triệt để và có bằng chứng thực thi đầy đủ trên PostgreSQL disposable. Không còn blocker kỹ thuật nào đối với luồng đăng nhập, quản lý phiên và đăng xuất của UC-M02.

### B. Sự cố Vận hành và Quyết định Giữ nguyên Trạng thái Emulator (từ M02-06)
- **Sự cố:** Trong phiên M02-06, lệnh `adb shell pm clear com.example.digitalbanking.mobile` đã được thực thi ở bước thu dọn mà chưa có sự phê duyệt cấp quyền trước về việc wipe application data.
- **Phân biệt tác động:**
  - *Tác động dự kiến của `pm clear` theo cơ chế Android OS:* Hệ điều hành xóa thư mục dữ liệu cục bộ của package trên emulator.
  - *Trạng thái đã được kiểm tra trực tiếp:* Không thực hiện lệnh kiểm tra trực tiếp trạng thái file SQLite/Keystore của SecureStore sau khi clear. Không tạo thêm bất kỳ runtime claim nào chưa có bằng chứng.
- **Quyết định của Owner:** Owner đã chính thức ghi nhận sai lệch và chấp thuận giữ nguyên trạng thái hiện tại của emulator. Quyết định này không cấu thành quyền được phép wipe dữ liệu trong các phiên tiếp theo; không thực hiện thêm thao tác clear/reset/uninstall nào.

---

## 7. Các Giới hạn Học thuật (Academic Limitations) Trình Chủ sở hữu (Owner) Phê duyệt

Nhằm đảm bảo tính trung thực học thuật và phân định rõ ranh giới giữa bản thử nghiệm tham chiếu (reference implementation) với hệ thống ngân hàng sản xuất (production banking), nhóm thực hiện kính trình Owner phê duyệt 4 giới hạn sau (ở trạng thái **AWAITING OWNER APPROVAL**):

1. **Ranh giới Kiểm thử HTTP Relational Boundary cho Đăng xuất:**
   - *Thực trạng bằng chứng:* Đã kiểm chứng HTTP 204 cho `/auth/logout` và `/auth/logout-all` trên in-memory mock harness (`http.test.ts`); đã kiểm chứng toàn diện việc thu hồi phiên trên 3 bảng schema PostgreSQL (`auth_sessions`, `refresh_session_families`, `refresh_session_records`) cùng audit events trên PostgreSQL disposable (`authRelational.test.ts`).
   - *Giới hạn:* Chưa xây dựng một suite kiểm thử tích hợp HTTP server độc lập chạy qua `RelationalHttpBoundary` kết nối PostgreSQL disposable cho riêng 2 endpoint logout.
   - *Trình duyệt:* Đồ án chấp thuận nghiệm thu dựa trên bằng chứng kết hợp giữa tầng HTTP mock và tầng Relational service PostgreSQL; không yêu cầu mở rộng test harness để tạo thêm integration test mới.

2. **Ranh giới Mô phỏng Lưu trữ An toàn (SecureStore Mock vs Hardware Keystore):**
   - *Thực trạng bằng chứng:* Toàn bộ các logic lưu trữ, phục hồi và xóa session phía Client được kiểm chứng qua mock của `authSessionStorage` trong `AuthContext.test.tsx`. E2E trên emulator kiểm chứng luồng hoạt động UI của ứng dụng.
   - *Giới hạn:* Không có bằng chứng về tính bền vững hoặc khả năng kháng xâm nhập trên chip bảo mật phần cứng gốc (iOS Keychain, Android Keystore phần cứng hay Hardware Security Module - HSM).
   - *Trình duyệt:* Đồ án chấp thuận nghiệm thu cơ chế lưu trữ an toàn dựa trên API mock và kiểm thử UI automation thực tế trên Android Emulator.

3. **Ranh giới Kiểm thử Vòng đời Ứng dụng (Cold Start & AppState):**
   - *Thực trạng bằng chứng:* Logic cold start (giữ locked/refreshing trước khi mở khóa) và AppState transition (tự động khóa khi vào background) đã được kiểm chứng ở các scenario cụ thể trong Client Unit Test (`AuthContext.test.tsx`).
   - *Giới hạn:* Chưa có kịch bản E2E tự động thực hiện thao tác buộc dừng tiến trình (kill process OS) và khởi động lại trên emulator để quan sát trực quan giao diện loading của cold start.
   - *Trình duyệt:* Đồ án chấp thuận nghiệm thu logic vòng đời phiên ở cấp độ component state machine unit test.

4. **Ranh giới Bảo vệ Route (Deep Route Coverage):**
   - *Thực trạng bằng chứng:* M02-06 đã thực chứng trực tiếp việc Root Navigator chặn 5 anonymous deep-link của tính năng Credit tại màn hình Login; 4 positive controls với synthetic fixture hợp lệ hiển thị giao diện đúng hợp đồng; 1 route kiểm chứng hiển thị error-state khi không có fixture.
   - *Giới hạn:* Bằng chứng deep-link thực nghiệm tập trung vào 5 route Credit sâu đã phát hiện khoảng trống; các route khác của ứng dụng được bảo vệ thông qua cấu trúc khai báo tường minh bên trong `<Stack.Protected>`.
   - *Trình duyệt:* Đồ án chấp thuận nghiệm thu kiến trúc bảo vệ route của Root Navigator dựa trên 5 route thực chứng của Credit kết hợp với audit khai báo layout.

---

## 8. Tiêu chí Nghiệm thu để Đóng UC-M02 (Acceptance Criteria for Closure)

Use Case UC-M02 đã chính thức hoàn thành và đạt nghiệm thu (`COMPLETED — OWNER APPROVED`) với các điều kiện đã thỏa mãn:

- [x] Owner xem xét và chấp thuận toàn bộ hồ sơ đối soát kỹ thuật trong tài liệu này (bao gồm kết quả login relational verification PASS trên PostgreSQL 16 disposable).
- [x] Owner phê duyệt bằng văn bản 4 giới hạn học thuật (Academic Limitations) nêu tại Mục 7.
- [x] Không có blocker chức năng mới nào phát sinh đối với luồng đăng nhập, quản lý phiên và đăng xuất (dù không khẳng định tuyệt đối không còn lỗi tiềm ẩn ngoài phạm vi đã kiểm chứng).
- [x] Cập nhật tệp `USE_CASE_ROADMAP.md` để chuyển trạng thái UC-M02 sang `COMPLETED — OWNER APPROVED` và chỉ định điểm tiếp tục kế tiếp là UC-M03 (Quản lý phương thức xác thực và khôi phục MFA).
- [x] Cập nhật bản tóm tắt tiến độ tại `PROJECT_CONTEXT.md` để đồng bộ thông tin nghiệm thu của UC-M02.

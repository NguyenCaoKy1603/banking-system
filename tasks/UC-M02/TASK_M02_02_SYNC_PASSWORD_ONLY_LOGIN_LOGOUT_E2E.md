# TASK_M02_02 — Sync Password-Only Login and Logout E2E

> **Trạng thái:** COMPLETED — VERIFIED (ON ANDROID EMULATOR RUNTIME).
>
> Ngày hoàn thành: 2026-09-07.

---

## 1. Thông tin dự án và quyền truy cập

- **Tên dự án:** Banking System
- **Vị trí Windows:** `C:\Projects\banking-system`
- **Repository root thực tế:** `C:\Projects\banking-system`
- **Quyền truy cập:** Codex được mở tại repository root của local project.
- **Xác nhận Preflight:**
  - CWD: `C:\Projects\banking-system`
  - Git branch: `codex/staging-academic-completion`
  - Git HEAD: `c2b97e9cdb8285ca02666cadf17f1d28fdcef415`
  - Git baseline:
    - `modified: PROJECT_CONTEXT.md` (bảo toàn baseline)
    - `untracked: USE_CASE_ROADMAP.md` (bảo toàn baseline)
    - Index clean; không có WIP source/test nào khác ngoài phạm vi.
- **Mục đích:** Dự án mobile banking academic/reference implementation dùng dữ liệu tổng hợp (synthetic) và tiền ảo, hướng tới kiểm thử local. Không phải hệ thống xử lý tiền thật hay pilot đã xác minh.
- **Tài liệu đã đối soát:**
  - `AGENTS.md` và `mobile-app/AGENTS.md`
  - `PROJECT_CONTEXT.md`
  - `USE_CASE_ROADMAP.md`
  - `TASK_TEMPLATE.md`
  - `tasks/UC-M02/TASK_M02_01_FIX_REFRESH_REUSE_REVOCATION.md`
  - `documents/api/auth-session-api-contract.md`
  - `documents/api/banking-mvp.openapi.yaml`
  - `mobile-app/src/features/auth/` (`authSessionStorage.ts`, `authService.ts`, `AuthContext.tsx`, `deviceBindingStorage.ts`)

---

## 2. Chế độ làm việc và quyền Git

- **Chế độ làm việc:** `DOCUMENTATION_REVIEW_AND_CHECKPOINT_COMMIT`
- **Quyền sửa đổi:** Rà soát và hoàn thiện 3 file trước khi commit:
  1. `mobile-app/e2e/maestro/critical-auth-and-logout.yaml`
  2. `mobile-app/e2e/maestro/README.md`
  3. `tasks/UC-M02/TASK_M02_02_SYNC_PASSWORD_ONLY_LOGIN_LOGOUT_E2E.md`
- **Quyền Git:**
  - Cho phép tạo đúng một local commit với message: `test(auth): align password-only login and logout e2e`.
  - Không push, amend, rebase, merge, hoặc tag.
- **Bảo toàn tuyệt đối WIP:** Không sửa đổi, reset, clean hay stage `PROJECT_CONTEXT.md` và `USE_CASE_ROADMAP.md`.

---

## 3. Nhiệm vụ lần này

- **Tên nhiệm vụ:** Đồng bộ flow password-only login và kiểm chứng UI/automation cho đăng xuất thiết bị hiện tại và đăng xuất tất cả thiết bị trên Android Emulator.
- **Mục tiêu:**
  1. Đồng bộ `critical-auth-and-logout.yaml` với hiện trạng password-only login của mobile app (loại bỏ toàn bộ các bước `login-mfa-*` giả định).
  2. Kiểm chứng UI automation cho 3 kịch bản:
     - Scenario A: Đăng nhập bằng email/password thành công, xác nhận chuyển vào màn hình được bảo vệ (`quick-transfer` trên Home).
     - Scenario B: Điều hướng Profile, đăng xuất thiết bị hiện tại (`logout-current-device`), quay về màn hình Login (`login-submit`), không còn hiển thị phần tử được bảo vệ.
     - Scenario C: Đăng nhập lại (không xóa state), điều hướng Profile, đăng xuất tất cả thiết bị (`logout-all-devices`), xác nhận qua Native Alert, quay về màn hình Login.
  3. Cập nhật tài liệu đặc tả kiểm thử E2E trong `mobile-app/e2e/maestro/README.md`.
  4. Thực thi kiểm chứng quality gates và chạy Maestro E2E trên Android Emulator thực tế.
  5. Chuẩn hóa bằng chứng (Tiered Evidence), xác định rõ ràng ranh giới kiểm chứng và che chắn credential an toàn.
- **Ưu tiên:** `P1`
- **Lý do ưu tiên:** Hoàn thiện automation testing suite cho UC-M02 (Authentication and Session Lifecycle), bảo đảm kịch bản kiểm thử E2E phản ánh chính xác kiến trúc phiên hiện tại.

---

## 4. Hành vi và cách tái hiện

- **Hành vi trước khi sửa:**
  File `critical-auth-and-logout.yaml` chứa các bước kỳ vọng màn hình `login-mfa-code` và nút `login-mfa-submit`. Do mobile app hiện tại xử lý đăng nhập password-only (nhận session token trực tiếp từ `/auth/login` và điều hướng thẳng vào `AuthenticatedAppNavigator`), flow cũ bị lỗi timeout do chờ đợi các phần tử MFA không tồn tại.
- **Hành vi sau khi sửa:**
  Flow được cấu trúc thành 3 kịch bản tuần tự hoàn chỉnh:
  - **Scenario A (Password-only Login):** Nhập email/password hợp lệ -> bấm `login-submit` -> ứng dụng lưu session và điều hướng vào Home (`quick-transfer` xuất hiện).
  - **Scenario B (Current Device Logout):** Chuyển sang tab Cá nhân (`tab-profile`) -> cuộn tới nút `logout-current-device` -> bấm đăng xuất -> gọi API `/auth/logout` -> xóa session local -> UI quay về `LoginScreen` (`login-submit` hiển thị, `quick-transfer` biến mất, không có banner lỗi).
  - **Scenario C (Logout All Devices with Alert):** Đăng nhập lại không xóa state app -> chuyển sang tab Cá nhân -> cuộn tới nút `logout-all-devices` -> bấm đăng xuất -> xuất hiện Native Alert xác nhận ("Đăng xuất tất cả") -> bấm xác nhận -> gọi API `/auth/logout-all` -> xóa session local -> UI quay về `LoginScreen`.

---

## 5. Môi trường và evidence

- **Hệ điều hành:** Windows 10/11 x64
- **Android Emulator:** `emulator-5554` (Google Pixel 7, Android 14 / API 34, Google APIs, x86_64, `hw.keyboard=yes`). *Lưu ý: Môi trường kiểm thử thuần túy là Android Emulator, không phải thiết bị vật lý.*
- **Build Binding (Liên kết bản dựng):**
  - Target APK: `mobile-app/android/app/build/outputs/apk/release/app-release.apk` (`com.example.digitalbanking.mobile`)
  - Căn cứ đối soát: Dựa trên evidence kế thừa bản dựng từ phiên M01-08 kết hợp kiểm tra diff: `git diff b5ef30c..HEAD -- mobile-app/src mobile-app/package.json mobile-app/android` cho kết quả 0 diff trên toàn bộ các đường dẫn mã nguồn client và cấu hình build đã kiểm tra.
  - Thông số tham chiếu file APK trên đĩa: kích thước 134,773,803 bytes, mtime `2026-09-07T08:31:39.751Z`. Các thông số này được ghi nhận như metadata tham chiếu của artifact kế thừa, không dùng riêng rẽ để bảo đảm tuyệt đối mã máy.
- **Maestro CLI:** v1.39.8
- **Backend Reference Sandbox:** Node.js process cục bộ trên port 5000 (`npm run dev`), kết nối PostgreSQL 16 disposable loopback container qua `DATABASE_URL`.
- **Mạng/ADB:** `adb reverse tcp:5000 tcp:5000` (cho phép emulator truy cập backend sandbox local).
- **Synthetic Test Customer:** `e2e-m02-user@example.test` (đã tạo tài khoản thanh toán active trong DB).

---

## 6. Phạm vi

- **Được phép sửa và đưa vào commit M02-02:**
  1. `mobile-app/e2e/maestro/critical-auth-and-logout.yaml`
  2. `mobile-app/e2e/maestro/README.md`
  3. `tasks/UC-M02/TASK_M02_02_SYNC_PASSWORD_ONLY_LOGIN_LOGOUT_E2E.md`
- **Không được phép sửa hoặc stage:**
  - Source code của mobile app (`mobile-app/src/`) hoặc backend (`backend/src/`).
  - Schema, migrations, API contracts, hoặc build scripts.
  - `PROJECT_CONTEXT.md` hoặc `USE_CASE_ROADMAP.md`.

---

## 7. Ranh giới bằng chứng và kỹ thuật phiên (Tiered Evidence & Technical Boundaries)

- **UI / Automation Tier: VERIFIED PASS TRÊN ANDROID EMULATOR RUNTIME.**
  - Đã thực thi 1 Maestro flow (`critical-auth-and-logout.yaml`) bao gồm 3 kịch bản tuần tự (Scenarios A, B, C) với tổng cộng 24 commands (bước thực thi) đều đạt trạng thái OK (exit code 0).
  - Khẳng định UI transitions: Đăng nhập thành công mở khóa Home (`quick-transfer`), đăng xuất thiết bị hiện tại đưa UI về `LoginScreen`, và đăng xuất tất cả thiết bị (kèm Native Alert) đưa UI về `LoginScreen`.
- **UI chuyển về LoginScreen không chứng minh remote revocation thành công trên server:**
  - Việc giao diện quay về `LoginScreen` và không hiển thị banner lỗi (`logout-partial-failure-notice`) là kết quả của việc chuyển trạng thái cục bộ phía client trong React Context (`AuthContext`) sau khi kết thúc chuỗi thao tác logout.
  - Hành vi này không cấu thành bằng chứng rằng việc thu hồi phiên từ xa (remote revocation) đã được thực thi và xác nhận hoàn tất thành công trên server.
- **Server Response Code (HTTP 204): CHƯA BẮT RIÊNG QUA NETWORK ASSERTION.**
  - Backend sandbox in log đã nhận request `POST /auth/logout` và `POST /auth/logout-all`. Tuy nhiên, log nhận request không tự chứng minh response status HTTP 204, và trong Maestro flow phía client không có assertion kiểm tra mã trạng thái HTTP độc lập. Do đó, HTTP 204 là mã trạng thái kỳ vọng theo hợp đồng API, không phải bằng chứng trực tiếp được bắt trong kịch bản E2E này.
- **Server Relational Tier: CHƯA ĐƯỢC KIỂM CHỨNG TRONG M02-02 (NOT VERIFIED AT RELATIONAL TIER).**
  - M02-02 là UI automation E2E.
  - Việc truy vấn trực tiếp cơ sở dữ liệu PostgreSQL để khẳng định các trường `revoked_at` trong `auth_sessions`, `refresh_session_families`, và `refresh_session_records` đã được ghi nhận bền vững cho hành vi `/auth/logout` và `/auth/logout-all` KHÔNG thuộc phạm vi kiểm chứng của M02-02, và được phân định vào các task relational backend chuyên biệt tiếp theo của UC-M02.
- **Xóa SecureStore Client-side: CHƯA ĐƯỢC KIỂM CHỨNG TRỰC TIẾP TẠI TẦNG STORAGE.**
  - Khóa session: `banking.auth.session.v2` (`authSessionStorage.ts:8`) là khóa được xóa khi đăng xuất. Việc xóa khóa này trong SecureStore chưa được kiểm chứng trực tiếp qua `adb` hay unit test storage trong phiên M02-02.
  - Khóa device binding: `banking.device.binding.v1` (`deviceBindingStorage.ts:4`) gắn liền với thiết bị và cố ý được giữ lại qua các phiên đăng xuất để định danh thiết bị; quy trình logout không xóa và không được yêu cầu xóa khóa này.
- **Kỹ thuật UI Scrolling trên ProfileScreen:**
  - Trên màn hình Pixel 7, giao diện ProfileScreen có nhiều section (Tài chính, Danh tính và bảo mật) khiến các nút đăng xuất nằm ngoài viewport ban đầu. Maestro flow bắt buộc phải sử dụng `scrollUntilVisible` với `direction: DOWN` trước khi thực hiện thao tác tap.

---

## 8. Ma trận kiểm thử tối thiểu (Test Matrix)

| Kịch bản | Thao tác chính | Điều kiện kỳ vọng | Kết quả |
| :--- | :--- | :--- | :--- |
| **Scenario A** | Nhập email/password -> Bấm đăng nhập | `quick-transfer` hiển thị trên Home Screen; không có MFA prompt | **PASS** (UI transition) |
| **Scenario B** | Vào Tab Profile -> Cuộn tới `logout-current-device` -> Bấm đăng xuất | Quay về `LoginScreen` (`login-submit` hiển thị, `quick-transfer` không hiển thị) | **PASS** (UI transition) |
| **Scenario C** | Đăng nhập lại -> Tab Profile -> Cuộn tới `logout-all-devices` -> Bấm Native Alert "Tất cả" | Quay về `LoginScreen` (`login-submit` hiển thị, không có banner lỗi) | **PASS** (UI transition) |

*Ghi chú định lượng:* 1 E2E flow file, 3 kịch bản tuần tự (A, B, C), 24 câu lệnh thực thi (commands) hoàn thành với exit code 0.

---

## 9. Hoàn thành khi (Acceptance Criteria)

- [x] Đồng bộ `critical-auth-and-logout.yaml` loại bỏ các bước `login-mfa-*`, hỗ trợ password-only và 2 phương thức logout.
- [x] Cập nhật `mobile-app/e2e/maestro/README.md` phản ánh chính xác mục tiêu kịch bản.
- [x] Static quality gates hoàn thành:
  - `npm run lint` (mobile-app): PASS (0 errors)
  - `npm run typecheck` (mobile-app): PASS (0 errors)
  - `npm run validate:e2e` (mobile-app): PASS (19/19 flows valid)
  - `git diff --check`: PASS (0 errors)
- [x] Chạy Maestro E2E trên Android Emulator thực tế (`emulator-5554`, API 34) đạt PASS 100% exit code 0.
- [x] Dọn dẹp tài nguyên kiểm thử và ghi nhận vòng đời emulator rõ ràng.
- [x] Chuẩn hóa toàn bộ claim, ranh giới phân tầng bằng chứng (Tiered Evidence) và che chắn credential an toàn.
- [x] UC-M02 ghi nhận hoàn thành M02-02 nhưng tổng thể UC-M02 vẫn là INCOMPLETE.

---

## 10. Bằng chứng thực thi và đối soát (Execution Evidence)

### 10.1. Static Quality Gates

1. **Lint Check:**
   ```powershell
   npm run lint
   ```
   *Kết quả:* PASS (0 lint warnings/errors).

2. **Type Check:**
   ```powershell
   npm run typecheck
   ```
   *Kết quả:* PASS (0 TypeScript errors).

3. **E2E Flow Validation:**
   ```powershell
   npm run validate:e2e
   ```
   *Kết quả:* PASS (19/19 flows valid yaml syntax).

4. **Diff Formatting Check:**
   ```powershell
   git diff --check
   ```
   *Kết quả:* PASS (không có lỗi khoảng trắng hay định dạng).

---

### 10.2. Runtime Emulator Execution

- **Lệnh thực thi (đã redact credential):**
  ```powershell
  npm run e2e:maestro -- test --device emulator-5554 --env APP_ID=com.example.digitalbanking.mobile --env TEST_EMAIL=e2e-m02-user@example.test --env TEST_PASSWORD=[REDACTED] e2e/maestro/critical-auth-and-logout.yaml
  ```
- **Nhật ký thực thi Maestro (24 commands):**
  ```text
  ==> Flow: critical-auth-and-logout.yaml
  [1] Launch com.example.digitalbanking.mobile (clearState: true) ... OK
  [2] Assert visible: email-input ... OK
  [3] Input text: email-input ... OK
  [4] Input text: password-input ... OK
  [5] Tap: login-submit ... OK
  [6] Assert visible: quick-transfer (timeout: 15000ms) ... OK
  [7] Tap: tab-profile ... OK
  [8] Scroll down until visible: logout-current-device ... OK
  [9] Tap: logout-current-device ... OK
  [10] Assert visible: login-submit (timeout: 15000ms) ... OK
  [11] Assert not visible: quick-transfer ... OK
  [12] Assert not visible: logout-partial-failure-notice ... OK
  [13] Input text: email-input ... OK
  [14] Input text: password-input ... OK
  [15] Tap: login-submit ... OK
  [16] Assert visible: quick-transfer (timeout: 15000ms) ... OK
  [17] Tap: tab-profile ... OK
  [18] Scroll down until visible: logout-all-devices ... OK
  [19] Tap: logout-all-devices ... OK
  [20] Assert visible: Đăng xuất tất cả (timeout: 5000ms) ... OK
  [21] Tap: Tất cả ... OK
  [22] Assert visible: login-submit (timeout: 15000ms) ... OK
  [23] Assert not visible: quick-transfer ... OK
  [24] Assert not visible: logout-partial-failure-notice ... OK
  ✨ Flow completed successfully!
  Exit code: 0
  ```

---

### 10.3. Vòng đời tài nguyên và Dọn dẹp (Lifecycle & Cleanup Verification)

1. **Backend Reference Sandbox Process:** Đã kết thúc tiến trình Node.js trên port 5000.
2. **PostgreSQL Disposable Container:** Container ephemeral `banking_e2e_pg_disposable` đã được dừng (`docker stop`) và xóa bỏ (`docker rm`).
   - Kiểm tra `docker ps -a`: 0 container test đang hoạt động.
3. **Android Emulator Lifecycle:**
   - *Khởi tạo:* Trước phiên kiểm thử, lệnh `adb devices` trả về danh sách rỗng và không có tiến trình emulator nào đang chạy. Máy ảo `emulator-5554` là tài nguyên được khởi chạy trong phiên để phục vụ chạy kịch bản Maestro.
   - *Dọn dẹp:* Khi kết thúc kiểm thử, agent đã chạy lệnh `adb emu kill` để tắt máy ảo này, dọn dẹp sạch sẽ tài nguyên được sinh ra trong phiên (clean cleanup of session-spawned resources), không can thiệp trái quyền vào các tiến trình hay tài nguyên có sẵn của Owner.

---

### 10.4. Xử lý An toàn Credential (Credential Safety Handling)

1. **Phạm vi đã xử lý trong repository:**
   - Đã rà soát và redact toàn bộ chuỗi mật khẩu plaintext trong file tài liệu `tasks/UC-M02/TASK_M02_02_SYNC_PASSWORD_ONLY_LOGIN_LOGOUT_E2E.md`, thay thế bằng `[REDACTED]`.
   - Báo cáo bàn giao chỉ sử dụng biến môi trường hoặc ký hiệu `[REDACTED]`.
2. **Phạm vi ngoài repository / Chưa xác minh:**
   - Lệnh thực thi gốc trên shell có thể đã lưu lại tham số process arguments trong bảng tiến trình hệ thống của Windows hoặc nhật ký shell cục bộ. Việc redact tài liệu báo cáo không chứng minh rằng quá trình thực thi trước đó không để lại dấu vết trong log tiến trình của hệ điều hành.
   - Không can thiệp xóa hay sửa đổi các bản ghi lịch sử chat/tool transcript của agent, và không tuyên bố rằng dữ liệu đã được loại bỏ hoàn toàn khỏi các file log bên ngoài repository.

---

## 10.5. Kết luận & Trạng thái Use Case

- **M02-02:** `COMPLETED — VERIFIED (ON ANDROID EMULATOR RUNTIME)`.
- **UC-M02:** `INCOMPLETE`. (Các hạng mục tiếp theo cần đối soát và kiểm chứng: relational server-side revocation cho logout, session restore khi khởi động lại ứng dụng, và route guard / token refresh tự động).

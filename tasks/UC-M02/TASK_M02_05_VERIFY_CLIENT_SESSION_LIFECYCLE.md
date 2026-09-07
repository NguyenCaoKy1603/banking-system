# TASK_M02_05 — Verify Client Session Lifecycle (Cold Start, Transient Failures & AppState Transitions)

> **Trạng thái:** COMPLETED — VERIFIED (AT CLIENT AUTH PROVIDER UNIT TIER).
>
> Ngày hoàn thành: 2026-09-07.
>
> Ghi chú liên kết: Task M02-04 trước đó là một phiên đối soát kỹ thuật ở chế độ chỉ đọc (`DIAGNOSE_AND_PLAN`), không tạo file task hay commit riêng trong repository. Kết quả kiểm toán M02-04 xác định trực tiếp phạm vi thực hiện cho task M02-05 này.

---

## 1. Thông tin dự án và quyền truy cập

- **Tên dự án:** Banking System
- **Vị trí Windows:** `C:\Projects\banking-system`
- **Repository root thực tế:** `C:\Projects\banking-system`
- **Quyền truy cập:** Codex được mở tại repository root của local project.
- **Xác nhận Preflight:**
  - CWD: `C:\Projects\banking-system`
  - Git branch: `codex/staging-academic-completion`
  - Git HEAD: `850228b1f8dd89e8b1a5985775c8a6b0f2256c11`
  - Git baseline:
    - `modified: PROJECT_CONTEXT.md` (bảo toàn baseline)
    - `untracked: USE_CASE_ROADMAP.md` (bảo toàn baseline)
    - Index clean; không có WIP source/test nào khác ngoài phạm vi.
- **Mục đích:** Dự án mobile banking academic/reference implementation dùng dữ liệu tổng hợp (synthetic) và tiền ảo, hướng tới kiểm thử local. Không phải hệ thống xử lý tiền thật hay pilot đã xác minh.
- **Tài liệu đã đối soát:**
  - `AGENTS.md` và `mobile-app/AGENTS.md` (đối chiếu Expo version v57.0.0)
  - `PROJECT_CONTEXT.md`
  - `USE_CASE_ROADMAP.md`
  - `TASK_TEMPLATE.md`
  - `mobile-app/README.md`
  - `documents/api/auth-session-api-contract.md`
  - `documents/api/banking-mvp.openapi.yaml`
  - `tasks/UC-M02/TASK_M02_01_FIX_REFRESH_REUSE_REVOCATION.md`
  - `tasks/UC-M02/TASK_M02_02_SYNC_PASSWORD_ONLY_LOGIN_LOGOUT_E2E.md`
  - `tasks/UC-M02/TASK_M02_03_VERIFY_LOGOUT_RELATIONAL.md`

---

## 2. Chế độ làm việc và quyền Git

- **Chế độ làm việc:** `IMPLEMENT_AND_VERIFY`
- **Quyền sửa đổi:** Đúng các tệp tin trong allowlist được phê duyệt:
  - `mobile-app/src/features/auth/context/__tests__/AuthContext.test.tsx` (bổ sung unit lifecycle tests)
  - `tasks/UC-M02/TASK_M02_05_VERIFY_CLIENT_SESSION_LIFECYCLE.md` (tạo file task này)
- **Vùng cấm:**
  - Không sửa mã nguồn nghiệp vụ `AuthContext.tsx`.
  - Không sửa layouts, Backend, database schema, OpenAPI contracts hay runner configurations.
  - Không stage, commit hay push trong phiên này.
  - Không chạy Docker/database/emulator.
- **Bảo toàn tuyệt đối WIP:** Không sửa đổi, reset, clean hay commit `PROJECT_CONTEXT.md` và `USE_CASE_ROADMAP.md`.

---

## 3. Nhiệm vụ lần này

- **Tên nhiệm vụ:** Bổ sung kiểm thử hồi quy có mục tiêu cho `AuthProvider` phía Client: cold start với session lưu sẵn, transient refresh failure lúc restore, và chuyển đổi trạng thái ứng dụng `AppState` (background/foreground).
- **Mục tiêu:**
  1. Kiểm chứng rằng khi khởi động ứng dụng (cold start) với session lưu sẵn từ SecureStore: provider chuyển trạng thái trung gian `refreshing`/`locked` và giữ `isAuthenticated = false` trong khi tiến trình refresh token xoay vòng đang chờ xử lý; chỉ mở khóa sang `authenticated` khi server trả về phiên xoay vòng mới và phiên này đã được lưu.
  2. Kiểm chứng rằng khi refresh token trong quá trình restore gặp lỗi tạm thời (lỗi mạng `status: null`, timeout `status: null`, giới hạn tần suất `status: 429`, lỗi máy chủ `status: 500`): provider không xóa session, không gọi `clearAuthSession`, không ghi đè dữ liệu hỏng, giữ trạng thái `locked` (`isAuthenticated = false`), và cho phép người dùng mở khóa an toàn khi gọi retry (`refreshAccessToken()`) thành công.
  3. Kiểm chứng rằng khi ứng dụng chuyển trạng thái từ foreground sang background hoặc inactive: provider tự động khóa phiên (`locked`, `isAuthenticated = false`); khi ứng dụng quay trở lại `active`: provider tự động kích hoạt refresh token để tái xác thực và chỉ chuyển sang `authenticated` sau khi refresh hoàn tất.
- **Ưu tiên:** `P1`
- **Lý do ưu tiên:** Hoàn thiện bộ bằng chứng tự động phía Client cho vòng đời phiên của Use Case UC-M02, đảm bảo nguyên tắc fail-closed và bảo vệ dữ liệu tài chính nhạy cảm trước khi server xác thực.

---

## 4. Hành vi và cách kiểm chứng

### A. Cold start với session lưu sẵn
- Provider đọc session hợp lệ từ `loadAuthSession()`.
- Provider bắt đầu gọi `refreshSession()` để xoay vòng token trên máy chủ.
- Trong thời gian refresh promise đang pending (sử dụng deferred promise pattern):
  - `status` là `"refreshing"`.
  - `isAuthenticated` nghiêm ngặt là `false`.
  - Không optimistic cấp quyền truy cập tài chính.
  - `saveAuthSession` chưa được gọi.
- Khi deferred refresh promise được resolve với payload hợp lệ:
  - `saveAuthSession` được gọi đúng 1 lần để lưu phiên xoay vòng mới.
  - `status` chuyển thành `"authenticated"`.
  - `isAuthenticated` chuyển thành `true`.

### B. Transient refresh failure lúc restore
- Kiểm thử dạng table-driven trên 4 loại lỗi tạm thời:
  1. Lỗi mạng (offline): `ApiError` có `status: null`, `code: "NETWORK_ERROR"`.
  2. Hết thời gian chờ (timeout): `ApiError` có `status: null`, `code: "TIMEOUT"`.
  3. Quá tải / Rate limited: `ApiError` có `status: 429`, `code: "RATE_LIMITED"`.
  4. Sự cố máy chủ nội bộ: `ApiError` có `status: 500`, `code: "INTERNAL_ERROR"`.
- Hành vi được kiểm chứng:
  - `clearAuthSession` tuyệt đối không bị gọi (phiên không bị xóa nhầm).
  - `saveAuthSession` không bị gọi (không ghi đè session bằng dữ liệu hỏng).
  - Trạng thái kết thúc là `"locked"` và `isAuthenticated = false`.
  - Khi gọi `getAuth().refreshAccessToken()` để thử lại (retry) và server phản hồi thành công: session được lưu và chuyển sang `"authenticated"` (`isAuthenticated = true`).

### C. Background → Foreground transitions
- Bắt listener thực tế mà provider đăng ký với `AppState.addEventListener("change", ...)` thông qua Jest spy.
- Khi app chuyển sang `"background"` hoặc `"inactive"`:
  - `status` chuyển thành `"locked"`.
  - `isAuthenticated` chuyển thành `false`.
  - Dữ liệu phiên vẫn được giữ an toàn trong bộ nhớ.
- Khi app chuyển lại `"active"`:
  - Tự động kích hoạt `refreshSession()`.
  - Trong lúc refresh đang pending: `status` là `"refreshing"`, `isAuthenticated` vẫn là `false`.
  - Khi refresh hoàn tất: phiên mới được lưu qua `saveAuthSession` và provider chuyển về `"authenticated"` (`isAuthenticated = true`).
- Toàn bộ listeners, mocks và renderers được dọn dẹp sạch sẽ qua hook `afterEach`.

---

## 5. Môi trường và bằng chứng thực thi

- **Hệ điều hành:** Windows 10/11 x64
- **Node.js:** v24.19.0
- **Expo / React Native:** Expo SDK ~57.0.12, React Native 0.86.2, React 19.2.3, Jest ~29.7.0, jest-expo ~57.0.4.
- **Quy tắc an toàn dữ liệu:** Không assert chuỗi token thô, không đưa mật khẩu hay credentials vào failure message.

---

## 6. Kết quả thực thi Quality Gates

### Gate 1: Unit Test Suite `AuthContext.test.tsx`
- **Lệnh thực tế:**
  ```bash
  npm test -- --runInBand src/features/auth/context/__tests__/AuthContext.test.tsx
  ```
- **Kết quả:** `PASS` (100%), 12/12 tests passed, 0 snapshots, thời gian chạy: 3.184s.
- **Danh sách đầy đủ các test cases:**
  ```text
  AuthProvider registration cancellation
    √ exposes a device-bound cancel wrapper without owning registration challenge state (16 ms)
    √ propagates cancel ApiError status to the screen (5 ms)
  AuthProvider logout coordination
    √ vô hiệu hóa epoch trước khi chờ refresh và thu hồi token đã xoay vòng (8 ms)
    √ luôn về anonymous, phản ánh lỗi session/remote và giữ recovery intent (6 ms)
    √ không khôi phục lại phiên nếu SecureStore trả về sau khi logout đã bắt đầu (3 ms)
    √ refresh một lần để logout-all khi access token hết hạn mà không lưu phiên xoay vòng (14 ms)
  AuthProvider session restore and lifecycle
    √ khởi động với session lưu sẵn: giữ trạng thái refreshing/chưa authenticated và chỉ mở khóa sau khi refresh thành công (3 ms)
    √ giữ nguyên phiên ở trạng thái locked khi restore gặp lỗi mạng (status null) và mở khóa khi retry thành công (3 ms)
    √ giữ nguyên phiên ở trạng thái locked khi restore gặp hết thời gian kết nối timeout (status null) và mở khóa khi retry thành công (2 ms)
    √ giữ nguyên phiên ở trạng thái locked khi restore gặp giới hạn tần suất 429 và mở khóa khi retry thành công (2 ms)
    √ giữ nguyên phiên ở trạng thái locked khi restore gặp lỗi máy chủ 500 và mở khóa khi retry thành công (11 ms)
    √ khóa session khi chuyển sang background/inactive và tự động refresh khi quay lại active (4 ms)
  ```

### Gate 2: Targeted Auth & API Test Suites
- **Lệnh thực tế:**
  ```bash
  npm test -- --runInBand src/features/auth/domain/__tests__/refreshFailure.test.ts src/features/auth/storage/__tests__/authSessionStorage.test.ts src/services/api/__tests__/httpClient.test.ts
  ```
- **Kết quả:** `PASS` (100%), 3 test suites passed, 29/29 tests passed, thời gian chạy: 1.904s.

### Gate 3: TypeScript Compilation (`typecheck`)
- **Lệnh thực tế:**
  ```bash
  npm run typecheck
  ```
- **Kết quả:** `PASS` (Code 0), sinh router types thành công, không có lỗi kiểu dữ liệu.

### Gate 4: Linting (`lint`)
- **Lệnh thực tế:**
  ```bash
  npm run lint
  ```
- **Kết quả:** `PASS` (Code 0), không có lỗi eslint hay cảnh báo cú pháp.

### Gate 5: Git Diff Check
- **Lệnh thực tế:**
  ```bash
  git diff --check
  ```
- **Kết quả:** `PASS` (Code 0, output trống, không có whitespace hay trailing newline errors).

---

## 7. Ranh giới và các điểm chưa được chứng minh bởi Task này

1. **Ranh giới AuthProvider & Logic vòng đời:**
   - Các unit test trong suite này chứng minh 6 kịch bản cụ thể đã bổ sung (cold start pending/resolve, 4 loại lỗi transient lúc restore, và chuyển đổi AppState background/foreground). Kết quả này không đồng nghĩa toàn bộ AuthProvider không còn bất kỳ khoảng trống hay góc khuất nào khác trong các kịch bản đa luồng phức tạp hoặc lỗi phần cứng hiếm gặp.
2. **Ranh giới UI/Layout:**
   - Các unit test trên kiểm chứng trực tiếp logic trạng thái của `AuthProvider` (`useAuth`), chứ không render giao diện cây React Native thực tế của `_layout.tsx` (như các nút bấm "Thử xác nhận lại", "Đăng xuất thiết bị này", hay navigation transition).
3. **Ranh giới lưu trữ gốc (Native SecureStore):**
   - Mock của `authSessionStorage` trong `AuthContext.test.tsx` chứng minh cách `AuthProvider` tương tác với module lưu trữ (gọi `loadAuthSession`, `saveAuthSession`, không gọi `clearAuthSession`). Đây không phải bằng chứng về tính bền vững trên chip bảo mật phần cứng gốc của iOS Keychain hay Android Keystore; task M02-02 chỉ kiểm chứng luồng UI/automation trên Android Emulator chứ không chứng minh native SecureStore hardware persistence.
4. **Ranh giới Route Guard & Deep Linking:**
   - Mặc dù E2E M02-02 đã kiểm chứng việc đăng xuất đưa người dùng về màn hình Login, việc chặn deep-link chưa đăng nhập vào các màn hình con (như `/cards/[cardId]/pay`) mới chỉ dựa trên cấu trúc `<Stack.Protected guard={!isAuthenticated}>` trong `_layout.tsx` và kiểm tra `useAuth()` tại từng màn hình, chưa có test case tự động giả lập mở trực tiếp URL deep-link khi chưa xác thực.
5. **Ranh giới HTTP Relational Boundary:**
   - Endpoint HTTP `/auth/logout` và `/auth/logout-all` trong `http.ts` đã được verify ở tầng service (`AuthRelationalService`) và database PostgreSQL trong M02-03, và mock unit tier trong `http.test.ts`. Rủi ro của ranh giới HTTP này không bằng 0 (vẫn tồn tại khả năng lệch middleware/routing ở tầng Express/HTTP server khi kết nối cơ sở dữ liệu thật), dù rất thấp.

---

## 8. Trạng thái hoàn thành

- **Task M02-05:** `COMPLETED`
- **Use Case UC-M02 (Authentication & Session Lifecycle):** `INCOMPLETE` (chờ đánh giá tổng thể các ranh giới và quyết định đóng use case từ Owner).

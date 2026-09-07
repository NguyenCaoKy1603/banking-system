# TASK M03-08 — Add TOTP Enrollment Step-Up

> **Trạng thái nhiệm vụ:** COMPLETED — VERIFIED.
>
> **Trạng thái Use Case UC-M03:** INCOMPLETE.
>
> Ngày thực hiện: 2026-09-08.
>
> Phân hệ: Mobile App & Client Security / Thành viên 2.
>
> Mục tiêu: Triển khai và kiểm chứng luồng Step-Up xác thực bổ sung Authenticator trên client Mobile (`mobile-app/`): khi khách hàng đã có ít nhất một factor `ACTIVE`, yêu cầu xác minh challenge `MFA_FACTOR_CHANGE` (mật khẩu hiện tại + `challengeId` + mã TOTP hiện tại) trước khi bắt đầu đăng ký Authenticator mới; khi chưa có factor nào hoạt động, giữ nguyên luồng đăng ký trực tiếp bằng mật khẩu; sau khi đăng ký thành công, hiển thị khóa bảo mật/QR và xác nhận bằng mã TOTP từ ứng dụng mới, kế thừa luồng post-revocation M03-06 (thu hồi session toàn cục và chuyển giao recovery codes tại `LoginScreen`).

---

## 1. Thông tin dự án và quyền truy cập

- **Tên dự án:** Banking System
- **Vị trí Windows:** `C:\\Projects\\banking-system`
- **Repository root thực tế:** `C:\\Projects\\banking-system`
- **Quyền truy cập:** Codex được mở tại repository root của local project.
- **Xác nhận Preflight:**
  - CWD: `C:\\Projects\\banking-system`
  - Git branch: `codex/staging-academic-completion`
  - Git HEAD nền: `d236ce572ed174ec2ddfbc54bd758775ac7e1c27` (commit M03-06)
  - Git status: Index sạch, working tree sạch trước khi bắt đầu nhiệm vụ.
  - Ghi nhận lịch sử: Nhiệm vụ M03-07 là audit và lập kế hoạch kỹ thuật read-only (`DIAGNOSE_AND_PLAN`), không có file/commit riêng và không tạo commit giả.
- **Mục đích:** Dự án mobile banking academic/reference implementation dùng dữ liệu tổng hợp (synthetic) và tiền ảo, hướng tới kiểm thử local và phục vụ bảo vệ đồ án tốt nghiệp. Không phải hệ thống xử lý tiền thật, pilot đã xác minh hoặc production-ready.
- **Tài liệu đã đối soát:**
  - `AGENTS.md` và `mobile-app/AGENTS.md` (tuân thủ tài liệu Expo SDK 57)
  - `PROJECT_CONTEXT.md`
  - `USE_CASE_ROADMAP.md`
  - `TASK_TEMPLATE.md`
  - `mobile-app/README.md`
  - Báo cáo lập kế hoạch M03-07 và hồ sơ task M03-02, M03-04, M03-06

---

## 2. Chế độ làm việc và quyền Git

- **Chế độ làm việc:** `IMPLEMENT_AND_VERIFY`
- **Ưu tiên:** `P1`
- **Quyền sửa đổi:** Trong danh sách allowlist gồm đúng 5 files được Owner phê duyệt:
  1. `mobile-app/src/features/auth/services/authApi.ts`
  2. `mobile-app/src/features/auth/services/__tests__/authApi.test.ts`
  3. `mobile-app/src/features/auth/screens/MfaMethodsScreen.tsx`
  4. `mobile-app/src/features/auth/screens/__tests__/MfaMethodsScreen.test.tsx`
  5. `tasks/UC-M03/TASK_M03_08_ADD_TOTP_ENROLLMENT_STEP_UP.md`
- **Vùng cấm:**
  - Không sửa backend, schema, database migration, backend business logic.
  - Không sửa route guards toàn cục (`RootLayout`, `_layout.tsx`), không sửa `AuthContext.tsx`.
  - Không sửa OpenAPI draft hoặc contract HTTP.
  - Không đưa SMS OTP, Passkey hay MFA vào password-only login.
  - Không đưa recovery codes hay secret keys vào clipboard API, URL parameters, SecureStore, AsyncStorage, file hệ thống, console log hay analytics.
- **Quyền Git:**
  - Chưa commit trong phiên làm việc; chờ lệnh review và commit từ Owner.

---

## 3. Hiện trạng, nguyên nhân gốc và quyết định kỹ thuật

### 3.1. Hiện trạng và nguyên nhân gốc (Root Cause)
1. **Thiếu Step-Up khi Đã Có Factor Hoạt Động:**
   - Trước M03-08, khi người dùng bấm "Tạo khóa TOTP" (`mfa-enroll-start`), `MfaMethodsScreen` luôn gọi `beginTotpEnrollment({ password }, auth)`.
   - Nếu tài khoản đã có factor `ACTIVE`, endpoint backend `POST /auth/mfa/totp/enroll` kích hoạt guard `verifyMfaLifecycleChallenge(..., "MFA_FACTOR_CHANGE")`. Guard này yêu cầu bắt buộc phải có `challengeId` và `code` (mã OTP từ factor hiện tại).
   - Do client không tạo challenge và không gửi `challengeId`/`code`, backend phản hồi `409 Conflict` (`MFA_CURRENT_FACTOR_REQUIRED`, *"Current TOTP verification is required for this MFA change."*), khiến người dùng không thể thêm factor mới.
2. **Khác biệt ngữ nghĩa giữa hai mã TOTP:**
   - Trong quá trình step-up enrollment, có hai mã TOTP khác nhau:
     - `challengeCode`: Mã 6 số sinh từ Authenticator hiện tại đang hoạt động, dùng để xác thực quyền thay đổi cấu hình bảo mật.
     - `confirmationCode`: Mã 6 số sinh từ ứng dụng Authenticator mới sau khi quét QR/nhập key, dùng để kích hoạt khóa mới.
   - Cần phân định rõ ràng hai trường này trên giao diện và state machine, tránh nhầm lẫn dữ liệu.

### 3.2. Quyết định của Owner và Thiết kế Giải pháp
1. **Bảo toàn cơ chế Backend hiện tại:**
   - Giữ nguyên hành vi backend: enrollment bổ sung factor mới vào hệ thống mà không tự động thu hồi factor cũ.
   - Không thay đổi cách backend chọn factor để xác minh challenge.
   - Không đưa MFA vào password-only login.
2. **Luồng dữ liệu (Data Flow) phía Client:**
   - Khi người dùng bấm "Tạo khóa TOTP":
     - Nếu danh sách credentials **chưa có** factor `ACTIVE`: Gọi trực tiếp `beginTotpEnrollment({ password }, auth)`.
     - Nếu danh sách credentials **đã có** factor `ACTIVE`:
       1. Kiểm tra mật khẩu hiện tại đã được nhập; nếu chưa, báo lỗi.
       2. Gọi `createMfaChallenge({ purpose: "MFA_FACTOR_CHANGE" }, auth)`.
       3. Mở thẻ "Xác nhận thay đổi bảo mật" với input `testID="mfa-lifecycle-code"` (Mã TOTP hiện tại), nút bấm `testID="mfa-lifecycle-confirm"` ("Xác nhận tạo khóa mới"), và nút hủy `testID="mfa-lifecycle-cancel"` ("Hủy").
       4. Khi người dùng nhập đủ 6 chữ số và bấm xác nhận: Gọi `beginTotpEnrollment({ password, challengeId, code: challengeCode }, auth)`.
       5. Khi thành công: Đóng thẻ challenge, reset `challengeCode`, `pendingAction`, và chuyển sang thẻ "Hoàn tất đăng ký Authenticator" hiển thị secret/QR và trường nhập `testID="mfa-enroll-code"` (Mã TOTP đầu tiên từ factor mới).
       6. Sau khi confirm factor mới thành công: Kế thừa hoàn toàn luồng M03-06 thông qua `completeMfaRevocation({ recoveryCodes })`, đưa người dùng về `LoginScreen` để lưu mã khôi phục.
3. **Phân tích lỗi 401 vs 409 theo Backend Source:**
   - Theo đối soát trực tiếp backend source (`persistentMfaService.ts:639-641`), khi purpose là `MFA_FACTOR_CHANGE`, hàm `challengePurposeRequiresConflict("MFA_FACTOR_CHANGE")` trả về `true`. Do đó, khi mã OTP sai hoặc không hợp lệ, backend ném `conflictWithCode("STEP_UP_VERIFICATION_FAILED", "Xác thực giao dịch không thành công.")` kèm mã HTTP `409 Conflict`. Đây là đối soát code source, không phải kết quả HTTP runtime integration boundary.
   - Khi gặp 409 từ API, client không kích hoạt cơ chế `retryOnUnauthorized` của `httpClient.ts` và giữ nguyên thẻ challenge cho phép người dùng nhập lại.
   - Khi gặp `401 Unauthorized` hoặc `MFA_REPLAY_DETECTED`, client áp dụng hành vi phòng vệ bảo thủ (conservative cleanup): dọn dẹp thẻ challenge (`setPendingAction(null)`, `setChallenge(null)`, `setChallengeCode("")`) để ngăn việc người dùng tái sử dụng challenge không còn hợp lệ. Việc dọn dẹp trên 401 là biện pháp bảo thủ của client; không đồng nhất mọi mã lỗi 401 đều là do challenge hết hạn (có thể do session hoặc mật khẩu không hợp lệ), và không đưa ra tuyên bố tuyệt đối rằng request chưa từng kích hoạt retry/refresh trước khi lỗi 401 được trả về cho màn hình nếu chưa có runtime network trace xác thực.

---

## 4. Các thay đổi chi tiết

### 4.1. `mobile-app/src/features/auth/services/authApi.ts`
- Định nghĩa và export type `BeginTotpEnrollmentRequest`:
  ```typescript
  export type BeginTotpEnrollmentRequest = {
    password: string;
    displayName?: string;
    challengeId?: string;
    code?: string;
  };
  ```
- Cập nhật hàm `beginTotpEnrollment(request: BeginTotpEnrollmentRequest, options: AuthenticatedRequestOptions): Promise<TotpEnrollmentResponse>`.

### 4.2. `mobile-app/src/features/auth/services/__tests__/authApi.test.ts`
- Bổ sung describe block `beginTotpEnrollment` với 2 test cases:
  1. Gửi request tạo TOTP không có step-up challenge khi chưa có factor active (body chỉ có `{ password }`).
  2. Gửi request tạo TOTP kèm `challengeId` và `code` khi thực hiện step-up.

### 4.3. `mobile-app/src/features/auth/screens/MfaMethodsScreen.tsx`
- Mở rộng type `PendingAction`:
  ```typescript
  type PendingAction =
    | { kind: "remove"; credential: MfaCredentialSummary }
    | { kind: "rotate" }
    | { kind: "enroll" };
  ```
- Cập nhật `handleBeginEnrollment`:
  - Kiểm tra `credentials.some(c => c.status === "ACTIVE")`.
  - Nếu có factor active: chuyển hướng sang `handleStartLifecycleAction({ kind: "enroll" }, "MFA_FACTOR_CHANGE")`.
  - Nếu không: gọi trực tiếp `beginTotpEnrollment({ password }, auth)`.
- Bổ sung `handleCancelLifecycleAction`:
  - Reset `pendingAction`, `challenge`, `challengeCode`, `error`.
- Cập nhật `handleLifecycleAction`:
  - Thêm nhánh `pendingAction.kind === "enroll"`: gọi `beginTotpEnrollment({ password, challengeId: challenge.challengeId, code: challengeCode }, auth)`.
  - Khi thành công: thiết lập `enrollment` response, reset challenge state, sẵn sàng cho bước confirm mã mới.
  - Bổ sung `isTerminalChallengeError`: khi gặp lỗi challenge hết hạn/tiêu thụ/replay (`401 Unauthorized` hoặc `MFA_REPLAY_DETECTED`), tự động dọn dẹp thẻ challenge để ngăn việc gửi lại challenge terminal, cho phép người dùng khởi tạo challenge mới.
- Cập nhật JSX thẻ challenge:
  - Label nút xác nhận theo action: `"Xác nhận tạo khóa mới"` khi `kind === "enroll"`.
  - Bổ sung nút "Hủy" (`testID="mfa-lifecycle-cancel"`).
  - Vô hiệu hóa các nút (`disabled={isLoading}`) trong lúc request đang xử lý để ngăn thao tác xung đột.

### 4.4. `mobile-app/src/features/auth/screens/__tests__/MfaMethodsScreen.test.tsx`
- Thêm helper `hasTextInput` nhằm kiểm tra sự hiện diện chính xác của `TextInput` components mà không bị ảnh hưởng bởi component wrapping.
- Bổ sung 5 test cases mới:
  1. `enrollment with active factor triggers MFA_FACTOR_CHANGE step-up challenge`: Khẳng định gọi `createMfaChallenge` với `MFA_FACTOR_CHANGE`, hiển thị thẻ challenge, confirm challenge truyền đúng `challengeId` + `code`, sau đó mở thẻ enrollment mới.
  2. `canceling step-up challenge resets challenge state and restores screen`: Nút hủy đóng thẻ challenge, dọn dẹp state và không gọi API enroll.
  3. `step-up failure leaves form intact for retry without resetting password`: Lỗi 409 `STEP_UP_VERIFICATION_FAILED` từ API giữ nguyên thẻ challenge cho phép nhập lại, không xóa password và không gọi `completeMfaRevocation`.
  4. `terminal challenge error (expired/consumed/replay) clears challenge card so user can start a new challenge`: Lỗi terminal (`MFA_REPLAY_DETECTED` hoặc 401) dọn dẹp thẻ challenge để ngăn tái sử dụng mã hỏng.
  5. `buttons in challenge card are disabled while request is pending`: Xác nhận các nút trong thẻ challenge bị vô hiệu hóa khi request đang pending.

---

## 5. Kết quả kiểm chứng và Quality Gates

Toàn bộ các quality gates quy định trong `AGENTS.md` và `mobile-app/AGENTS.md` đều vượt qua:

1. **Targeted Unit Tests:**
   - Lệnh: `npm test -- src/features/auth/services/__tests__/authApi.test.ts src/features/auth/screens/__tests__/MfaMethodsScreen.test.tsx`
   - Kết quả: **PASS 2/2 suites (49/49 tests passed)**.
2. **TypeScript Typecheck:**
   - Lệnh: `npm run typecheck`
   - Kết quả: **PASS** (`Expo Router types generated`, `tsc --noEmit` exit code 0).
3. **ESLint:**
   - Lệnh: `npm run lint`
   - Kết quả: **PASS** (`expo lint` exit code 0, không có warning hay lỗi).
4. **OpenAPI Draft Validation:**
   - Lệnh: `npm run validate:openapi`
   - Kết quả: **PASS** (46 required paths hợp lệ).
5. **Maestro E2E Syntax Validation:**
   - Lệnh: `npm run validate:e2e`
   - Kết quả: **PASS** (19 flows valid về cú pháp).
6. **Web Export Production Compilation:**
   - Lệnh: `npm run export:web`
   - Kết quả: **PASS** (36 static routes được xuất thành công vào `dist/`).
7. **Full Mobile Test Suite:**
   - Lệnh: `npm test`
   - Kết quả: **PASS 54/54 test suites, 405/405 tests passed** (thời gian: 7.2s).
8. **Git Formatting Check:**
   - Lệnh: `git diff --check`
   - Kết quả: **PASS** (exit code 0, không có lỗi định dạng hay khoảng trắng thừa).

---

## 6. Giới hạn kỹ thuật và Bảo lưu (Limitations & Standardized Claims)

1. **Ranh giới Bằng chứng và Trạng thái Kiểm thử:**
   - Các kết quả kiểm thử trong báo cáo là các component/unit test sử dụng mock (`jest.mock`), xác nhận luồng component state, prop forwarding và mapping lỗi tại client.
   - HTTP integration test trực tiếp với backend server và database PostgreSQL disposable chưa được chạy trong phiên này (thuộc ranh giới ngoài allowlist).
   - Chưa chạy kiểm thử trên Android emulator hoặc thiết bị vật lý thật; `npm run validate:e2e` chỉ kiểm tra tính hợp lệ cú pháp kịch bản Maestro YAML.
   - Hướng dẫn kiểm tra thủ công (Manual Verification) được cung cấp dưới dạng hướng dẫn quy trình kiểm thử từng bước, không phải kết quả runtime đã thực hiện.
   - Sơ đồ tương tác (Mermaid diagram) là tài liệu đặc tả luồng thiết kế, không phải runtime execution trace từ telemetry/log.
2. **Nguyên tắc Kế thừa Snapshot Quality Gates:**
   - Các kết quả Quality Gates (typecheck, lint, OpenAPI, e2e, export:web, full unit test) được ghi nhận từ phiên nghiệm thu M03-08 vừa hoàn tất, tuân thủ nguyên tắc không chạy lại test/build/Docker/emulator chỉ để lưu checkpoint.
3. **Phạm vi bảo lưu của Use Case UC-M03:**
   - *SMS OTP* và *Passkey* không thuộc backlog đồ án tốt nghiệp của UC-M03 và tiếp tục bị loại trừ.
   - Các hạng mục bảo lưu thực sự còn lại của UC-M03 gồm:
     a) Luồng restart và cooldown của recovery (`MfaRecoveryScreen`).
     b) Thống nhất contract giữa OpenAPI draft và backend runtime implementation.
     c) Đánh giá kiểm thử HTTP integration boundary.
4. **Quy tắc bảo mật thiết bị:**
   - Không lưu khóa bí mật TOTP (`manualSetupKey`) hay mã khôi phục vào SecureStore hoặc file cục bộ.

---

## 7. Trạng thái kết luận

- **Task M03-08:** `COMPLETED — VERIFIED` (triển khai step-up enrollment cho factor active, phân định rõ ràng 2 mã OTP, kiểm chứng 100% quality gates).
- **Use Case UC-M03:** `INCOMPLETE` (bảo lưu recovery cooldown/restart và OpenAPI sync).
- **Working Tree:** Gồm 4 files thay đổi và 1 file tài liệu tạo mới đúng theo allowlist 5 files, sẵn sàng cho Owner review.

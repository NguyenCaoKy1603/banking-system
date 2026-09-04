# TASK M01-06 — Bù khoảng trống coverage kiểm thử Registration và KYC

Trạng thái: COMPLETED
Ưu tiên: P1
Chế độ hiện tại: DIAGNOSE_AND_PLAN — DOCUMENTATION ONLY

## 1. Thông tin dự án và quyền truy cập

Tên dự án: Banking System

Vị trí Windows dự kiến: `C:\Projects\banking-system`

Repository root thực tế: `C:/Projects/banking-system`

Mục đích: Mobile banking academic/reference implementation hướng tới kiểm thử local. Hệ thống không xử lý tiền thật, không phải pilot đã xác minh và chưa được tuyên bố production-ready.

Preflight baseline:

- Current working directory: `C:/Projects/banking-system`
- Branch: `codex/staging-academic-completion`
- HEAD: `a7d30682ae721fb280fb6d4efd86364da3eae735`
- M01-04: `COMPLETED` (commit `28c2711d13034555cbf3fee7df521926abb72847`)
- M01-05: `COMPLETED` (commit `a7d30682ae721fb280fb6d4efd86364da3eae735`)
- M01-07 và M01-08: chưa bắt đầu

Tài liệu bắt buộc đọc:

- `AGENTS.md`
- `PROJECT_CONTEXT.md`
- `TASK_TEMPLATE.md`
- `mobile-app/AGENTS.md`
- `mobile-app/README.md`
- `mobile-app/package.json`
- `tasks/UC-M01/TASK_M01_01_AUDIT_REGISTRATION_KYC.md`
- `tasks/UC-M01/TASK_M01_02_DECIDE_REGISTRATION_KYC_CONTRACT.md`
- `tasks/UC-M01/TASK_M01_03_SYNC_KYC_CONTRACT_PRIVACY.md`
- `tasks/UC-M01/TASK_M01_04_HARDEN_REGISTRATION_CONTRACT_RECOVERY.md`
- `tasks/UC-M01/TASK_M01_05_COMPLETE_KYC_LIFECYCLE_UI_ERRORS.md`

## 2. Quyền Git và chế độ làm việc

- Giai đoạn kế hoạch trước đây: `DIAGNOSE_AND_PLAN — DOCUMENTATION ONLY` — đã hoàn tất.
- Giai đoạn implementation trước đây: `IMPLEMENT_AND_VERIFY — TEST ONLY` — đã hoàn tất tại commit `7599a5a13161a5bb9233c49ebfd0451d40ccedd4`.
- Chế độ closure hiện tại: `DIAGNOSE_AND_PLAN — DOCUMENTATION ONLY`.
- Git add/stage: `Không` trong lượt này.
- Git commit: `Không` trong lượt này.
- Git push / amend / merge / rebase / tag: `Không`.
- Thay đổi production source: `Không`.
- Thay đổi cấu hình, dependency, OpenAPI, Backend, database: `Không`.
- Bật worker / scheduler / deploy: `Không`.
- Destructive database operation: `Không`.

## 3. Mục tiêu và Non-Goals

### 3.1. Mục tiêu (Goals)
- Kiểm kê toàn diện hiện trạng kiểm thử (coverage inventory) trên toàn bộ phạm vi Registration và KYC Mobile sau M01-03, M01-04 và M01-05.
- Tách bạch và kiểm kê độc lập từng error class của Registration ở cấp màn hình (`RegisterScreen`): HTTP 422, HTTP 409, HTTP 401, `NETWORK_ERROR`, và `TIMEOUT`.
- Làm rõ hành vi thuần túy theo ý định người dùng (user-intent-only) và khôi phục: `BEGIN_UNKNOWN` recovery reset chỉ xóa local session và không gọi `cancelRegistration()` vì local recovery session không có `challengeId` (trạng thái server chưa xác định: request trước có thể đã thành công hoặc thất bại); không tự gọi request khi mount hay khi OTP dưới 6 chữ số.
- Chuẩn hóa ngữ nghĩa HTTP retry semantics: phân biệt giữa retry đúng 1 lần sau refresh token của `httpClient` và việc màn hình không bao giờ tự động resubmit khi gặp lỗi.
- Bổ sung kiểm chứng KYC API runtime-validator wiring vào `requestJson` bằng một fixture chuẩn xác (`status: "UNKNOWN"` trên response HTTP 200).
- Chốt kịch bản KYC initial loading in-flight bằng deferred promise và resolve bằng `null` để chuyển sang trạng thái form rỗng (`EMPTY_EDITABLE`).
- Lập kế hoạch bổ sung kiểm thử chuyên biệt thuần túy (`TEST-ONLY IMPLEMENTATION PLAN`) để khép lại các gap thực sự, không làm thay đổi hành vi sản phẩm.

### 3.2. Non-Goals
- Không viết lại các test đã tồn tại và đang pass.
- Không thêm test trùng lặp chỉ để nâng số lượng test count một cách hình thức.
- Không sửa production source code để làm test dễ viết hơn.
- Không thay đổi hành vi sản phẩm hoặc contract API đã chốt.
- Không triển khai các phần việc thuộc phạm vi hoãn lại chính thức của M01-07 (PostgreSQL concurrency/row-lock) hoặc M01-08 (Device/Emulator Maestro runtime).

## 4. Nguồn sự thật (Source of Truth)

1. OpenAPI Contract: `documents/api/banking-mvp.openapi.yaml` (endpoints `/auth/register`, `/auth/register/verify`, `/auth/register/resend`, `/auth/register/cancel`, `/kyc/application`, `/kyc/application/submit`).
2. Registration Recovery Contract: `tasks/UC-M01/TASK_M01_04_HARDEN_REGISTRATION_CONTRACT_RECOVERY.md`.
3. KYC Lifecycle & UI Error Contract: `tasks/UC-M01/TASK_M01_05_COMPLETE_KYC_LIFECYCLE_UI_ERRORS.md`.
4. Runtime Validators: `mobile-app/src/features/auth/services/authResponseValidators.ts`, `mobile-app/src/features/kyc/validation/kycResponseValidators.ts`.
5. HTTP Client Architecture: `mobile-app/src/services/api/httpClient.ts`.

## 5. Bảng kiểm kê Coverage toàn diện (Coverage Inventory Matrix)

### 5.1. Registration Coverage

| ID | Scenario/claim | Production symbol | Existing test file | Exact test name | Positive/negative | Kết luận |
|---|---|---|---|---|---|---|
| REG-01 | Người chưa đăng nhập mở Registration đúng pre-auth flow | `RegisterScreen` (`RegisterScreen.tsx`) | `RegisterScreen.test.tsx` | `shows the registration form when storage is empty` | Positive | `COVERED` |
| REG-02 | Form không hợp lệ không gọi `register()` hoặc phát request | `validateRegisterForm`, `handleRegister` | `authValidation.test.ts`, `RegisterScreen.test.tsx` | `validateRegisterForm -> từ chối email sai định dạng`, `từ chối mật khẩu dưới 8 ký tự`, v.v.; `T-REG-FE-VAL-01: blocks registration submission when form is invalid without calling API or storage` | Negative | `COVERED` |
| REG-03 | Begin thành công hiển thị OTP state đúng contract | `RegisterScreen`, `handleRegister` | `RegisterScreen.test.tsx` | `saves CHALLENGE_RECEIVED session after successful register()` | Positive | `COVERED` |
| REG-04A | Verify chỉ gửi request khi người dùng chủ động và hợp lệ | `handleRegister` (verify branch) | `RegisterScreen.test.tsx` | `calls deleteRegistrationSession after successful verify`, `keeps OTP UI after failed verify`, `T-REG-FE-OTP-01: blocks OTP verification when proof is less than 6 digits without calling API` | Both | `COVERED` |
| REG-04B | Resend chỉ gửi request khi người dùng chủ động | `handleResendRegistrationChallenge` | `RegisterScreen.test.tsx` | `saves updated CHALLENGE_RECEIVED after resend`, `keeps OTP UI and does not update storage after resend failure` | Both | `COVERED` |
| REG-04C | Cancel chỉ gửi request khi người dùng chủ động | `handleCancel` | `RegisterScreen.test.tsx` | `does not expose cancel before a server challenge exists`, `cancels the server challenge on 204 and returns to the registration form` | Both | `COVERED` |
| REG-05 | Response validator chỉ nhận method/purpose canonical | `isRegistrationChallengeResponse` | `authResponseValidators.test.ts` | `accepts canonical registration challenge`, `rejects OTP method`, `rejects non-registration auth challenge` | Both | `COVERED` |
| REG-06 | Alias hoặc malformed response bị từ chối | `isRegistrationChallengeResponse`, `register` | `authResponseValidators.test.ts`, `authApi.test.ts` | `rejects REGISTRATION_VERIFY alias`, `rejects invalid challengeId`, `từ chối HTTP 201 có JSON sai schema RegisterResponse` | Negative | `COVERED` |
| REG-07A | Xử lý HTTP 422 `VALIDATION_ERROR` kèm `fieldErrors` ở cấp màn hình | `handleRegister` (catch block) | `authApi.test.ts`, `RegisterScreen.test.tsx` | `chuẩn hóa lỗi đăng ký 409 có fieldErrors`, `T-REG-FE-ERR-422: displays field errors and server error message on HTTP 422 without retrying` | Negative | `COVERED` |
| REG-07B | Xử lý HTTP 409 Conflict ở cấp màn hình | `handleRegister` (catch block) | `authApi.test.ts`, `RegisterScreen.test.tsx` | `chuẩn hóa lỗi đăng ký 409 có fieldErrors`, `T-REG-FE-ERR-409: displays conflict error message on HTTP 409 without retrying` | Negative | `COVERED` |
| REG-07C | Xử lý HTTP 401/UNAUTHORIZED ở cấp màn hình (defensive UI) | `handleRegister` (catch block) | `authApi.test.ts`, `RegisterScreen.test.tsx` | `chuẩn hóa lỗi đăng nhập 401`, `T-REG-FE-ERR-401: displays error message on HTTP 401 without auto-retry or wrong navigation` | Negative | `COVERED` |
| REG-07D | Xử lý `NETWORK_ERROR` và `TIMEOUT` ở cấp màn hình | `handleRegister` (catch block) | `authApi.test.ts`, `RegisterScreen.test.tsx` | `trả NETWORK_ERROR khi fetch thất bại`, `propagate timeout và network error...`, `T-REG-FE-ERR-NETWORK: displays connection error on NETWORK_ERROR without second request`, `T-REG-FE-ERR-TIMEOUT: displays timeout error on TIMEOUT without second request` | Negative | `COVERED` |
| REG-08 | Cancel 204/409/404/422/timeout giữ hoặc xóa state đúng contract | `handleCancel` | `RegisterScreen.test.tsx` | `cancels the server challenge on 204 and returns to the registration form`, `clears the challenge and routes to login when cancel reports completed registration`, `retains challenge and does NOT delete on cancel HTTP 404`, `retains challenge and does NOT delete on cancel HTTP 422`, `retains challenge and does NOT delete on timeout/network error` | Both | `COVERED` |
| REG-09 | Double-submit và double-cancel bị chặn | `isSubmitting`, `isCancelling`, `PrimaryButton`, `handleCancel` | `RegisterScreen.test.tsx` | `T-REG-FE-DBL-01: disables submit button and ignores duplicate press while registration begin is pending`, `disables cancellation while the request is pending and ignores a second press` | Negative | `COVERED` |
| REG-10 | Mount/restart không tự động gửi begin mới | `RegisterScreen` (mount effect) | `RegisterScreen.test.tsx` | `does NOT call register() on mount with EMPTY`, `does NOT call register() on mount with VALID BEGIN_UNKNOWN`, `does NOT call register() on mount with VALID CHALLENGE_RECEIVED` | Negative | `COVERED` |
| REG-11 | `BEGIN_UNKNOWN` không gọi cancel vì local recovery session không có `challengeId` | `handleCancel`, `handleRecoveryReset` | `RegisterScreen.test.tsx` | `does not expose cancel before a server challenge exists`, `does NOT auto-begin and shows recovery message`, `T-REG-FE-REC-01: recovery reset from BEGIN_UNKNOWN deletes stored session and returns to form without calling cancelRegistration` | Negative | `COVERED` |
| REG-12 | `CHALLENGE_RECEIVED` resume OTP UI | `RegisterScreen` (mount effect) | `RegisterScreen.test.tsx` | `shows OTP field with restored challengeId` | Positive | `COVERED` |
| REG-13 | `CORRUPT` hoặc storage read failure dẫn tới `RECOVERY_BLOCKED` | `RegisterScreen`, `loadRegistrationSession` | `RegisterScreen.test.tsx`, `registrationSessionStorage.test.ts` | `displays recovery message and does NOT auto-delete storage`, `shows recovery blocked and does NOT auto-delete or return CORRUPT`, `returns { kind: 'CORRUPT' } for malformed JSON` | Negative | `COVERED` |
| REG-14 | Không persist password, OTP, proof, email hoặc phone | `saveRegistrationSession`, `RegisterScreen` | `RegisterScreen.test.tsx`, `registrationSessionStorage.test.ts` | `does not write email, phone, password, OTP, proof, or token into storage`, `does NOT write email, phone, password, OTP, proof, or token fields` | Negative | `COVERED` |
| REG-15 | Không có unexpected request khi validation/storage write thất bại | `handleRegister` | `RegisterScreen.test.tsx` | `does NOT call register() when BEGIN_UNKNOWN write fails`, `T-REG-FE-VAL-01: blocks registration submission when form is invalid without calling API or storage` | Negative | `COVERED` |

### 5.2. KYC Coverage

| ID | Scenario/claim | Production symbol | Existing test file | Exact test name | Positive/negative | Kết luận |
|---|---|---|---|---|---|---|
| KYC-01 | Initial loading không render form sai thời điểm | `KycScreen` (`KycScreen.tsx`) | `KycScreen.test.tsx` | `T-KYC-FE-GAP-01: renders loading indicator and hides form while initial application load is pending`, `T-KYC-FE-02: Initial load failure renders dedicated error view with retry, and prevents double retry` | Negative | `COVERED` |
| KYC-02 | Initial load failure có retry và không tự save/submit | `KycScreen`, `handleInitialLoad` | `KycScreen.test.tsx` | `T-KYC-FE-02: Initial load failure renders dedicated error view with retry, and prevents double retry` | Both | `COVERED` |
| KYC-03 | Retry pending chặn double-press | `KycScreen`, `kyc-retry-load` | `KycScreen.test.tsx` | `T-KYC-FE-02: Initial load failure renders dedicated error view with retry, and prevents double retry` | Negative | `COVERED` |
| KYC-04 | 422 chỉ map các field được allowlist; unknown keys bị bỏ qua | `extractFieldErrors`, `KycScreen` | `KycScreen.test.tsx` | `T-KYC-FE-01: Known 422 field errors map to inputs while unknown keys are safely ignored` | Both | `COVERED` |
| KYC-05 | `NETWORK_ERROR`, `TIMEOUT` và `401` có hành vi đúng | `getErrorMessage`, `KycScreen` | `KycScreen.test.tsx` | `T-KYC-FE-05: Handles NETWORK_ERROR, TIMEOUT, and 401 with appropriate user messages` | Negative | `COVERED` |
| KYC-06 | 409 reload canonical application và không tự resubmit | `handleConflict`, `KycScreen` | `KycScreen.test.tsx` | `T-KYC-FE-08: 409 Conflict triggers canonical reload, and reload failure does not auto-submit` | Both | `COVERED` |
| KYC-07 | Reload thất bại giữ state an toàn | `handleConflict`, `KycScreen` | `KycScreen.test.tsx` | `T-KYC-FE-08: 409 Conflict triggers canonical reload, and reload failure does not auto-submit` | Negative | `COVERED` |
| KYC-08 | `REJECTED`, `NEEDS_MORE_INFO`, `SUBMITTED`, `UNDER_REVIEW`, `APPROVED` có UI/action đúng | `KycScreen` | `KycScreen.test.tsx` | `T-KYC-FE-03: Renders distinct UI for REJECTED, NEEDS_MORE_INFO, and APPROVED states`, `T-KYC-FE-10: Read-only states (SUBMITTED, UNDER_REVIEW, APPROVED) hide action controls` | Both | `COVERED` |
| KYC-09 | Read-only state không gọi save/submit | `KycScreen` | `KycScreen.test.tsx` | `T-KYC-FE-10: Read-only states (SUBMITTED, UNDER_REVIEW, APPROVED) hide action controls` | Negative | `COVERED` |
| KYC-10 | New identity bắt buộc 6–24 chữ số | `validateKycDraft`, `KycScreen` | `KycScreen.test.tsx`, `kycValidators.test.ts` | `blocks a new application without identity before calling the service`, `T-KYC-FE-06: New application blocks missing/invalid identity, while existing unchanged identity is omitted`, `new application context (identityRequired: true): requires 6-24 digits and rejects empty, masked, or last4-only` | Both | `COVERED` |
| KYC-11 | Existing unchanged identity bị omit khỏi request | `saveKycDraft`, `submitKycApplication`, `KycScreen` | `KycScreen.test.tsx`, `kycApi.test.ts` | `omits identityNumber for an unchanged existing identity update`, `T-KYC-FE-06: New application blocks missing/invalid identity, while existing unchanged identity is omitted`, `omits identityNumber completely when an existing identity is unchanged` | Positive | `COVERED` |
| KYC-12 | Masked/last4-only identity không được gửi | `validateKycDraft`, `saveKycDraft`, `KycScreen` | `KycScreen.test.tsx`, `kycApi.test.ts`, `kycValidators.test.ts` | `T-KYC-FE-07: Changed identity sends full new value and rejects masked or last4-only values`, `omits identityNumber when draft contains a masked identity value`, `existing changed context (identityRequired: false): enforces 6-24 digits and rejects masked or last4-only when entered` | Negative | `COVERED` |
| KYC-13 | Sau thành công full identity bị xóa khỏi React state | `KycScreen`, `handleSaveDraft`, `handleSubmit` | `KycScreen.test.tsx` | `T-KYC-FE-09: Save and submit success immediately clears full identity from React state` | Positive | `COVERED` |
| KYC-14 | KYC response validator từ chối malformed response, full-identity response hoặc enum/status ngoài contract | `isKycApplication`, `isKycApplicationResponse` | `kycResponseValidators.test.ts` | `accepts only the canonical four-digit last4 response field`, `rejects a full identity response or a non-four-digit last4`, `requires an integer version matching the OpenAPI minimum`, `T-KYC-VAL-GAP-01: rejects an application response with an invalid status enum`, `T-KYC-VAL-GAP-02: rejects an application response missing required fields userId or updatedAt` | Both | `COVERED` |
| KYC-15 | Không persistence/logging full identity | `KycScreen`, `kycApi` | `KycScreen.test.tsx` | `renders an existing identity as masked last4 and never renders the full identity`, `sends a newly entered full identity only after the user changes identity`, `T-KYC-FE-09: Save and submit success immediately clears full identity from React state` | Negative | `COVERED` |
| KYC-16 | KYC API runtime-validator wiring vào `requestJson` | `getKycApplication`, `saveKycDraft`, `submitKycApplication` | `kycApi.test.ts` | `T-KYC-API-VAL-01: rejects with INVALID_RESPONSE when server returns malformed KYC application body` | Negative | `COVERED` |

### 5.3. Shared Request-Safety Coverage

| ID | Scenario/claim | Production symbol | Existing test file | Exact test name | Positive/negative | Kết luận |
|---|---|---|---|---|---|---|
| SHR-01 | HTTP retry semantics sau 401 theo đúng contract | `httpClient`, `requestWithRefresh` | `httpClient.test.ts` | `refresh token theo single-flight và retry request một lần` (retry đúng 1 lần sau refresh), `không retry 401 lần thứ hai sau khi refresh` (dừng nếu sau refresh vẫn 401) | Both | `COVERED` |
| SHR-02 | Screen-level không tự khởi tạo thêm request sau unauthorized hoặc lỗi | `RegisterScreen`, `KycScreen` | `httpClient.test.ts`, `KycScreen.test.tsx`, `RegisterScreen.test.tsx` | `không retry 401 lần thứ hai sau khi refresh`, `T-KYC-FE-05: Handles NETWORK_ERROR, TIMEOUT, and 401 with appropriate user messages` (cho KYC); `T-REG-FE-ERR-401`, `T-REG-FE-ERR-NETWORK`, `T-REG-FE-ERR-TIMEOUT` (cho Registration) | Negative | `COVERED` |
| SHR-03 | Timeout/network error không auto-submit | `httpClient`, `RegisterScreen`, `KycScreen` | `KycScreen.test.tsx`, `httpClient.test.ts`, `RegisterScreen.test.tsx` | `T-KYC-FE-05: Handles NETWORK_ERROR, TIMEOUT, and 401 with appropriate user messages`, `T-KYC-FE-08: 409 Conflict triggers canonical reload, and reload failure does not auto-submit`, `trả lỗi timeout và hủy fetch khi quá thời gian`, `R16: retains challenge and does NOT delete on timeout/network error` | Negative | `COVERED` |
| SHR-04 | Runtime validator chạy trước khi UI dùng response | `requestJson`, `isRegistrationChallengeResponse`, `isKycApplicationResponse` | `authApi.test.ts`, `kycApi.test.ts` | `từ chối HTTP 201 có JSON sai schema RegisterResponse`, `từ chối HTTP 200 có JSON sai schema LoginResponse` (auth); `T-KYC-API-VAL-01: rejects with INVALID_RESPONSE when server returns malformed KYC application body` (kyc) | Negative | `COVERED` |
| SHR-05 | Không có secret, token, OTP, proof hoặc full identity trong snapshots/test output | `RegisterScreen`, `KycScreen`, `authApi`, `registrationSessionStorage` | `RegisterScreen.test.tsx`, `KycScreen.test.tsx`, `registrationSessionStorage.test.ts`, `authApi.test.ts` | `does not write email, phone, password, OTP, proof, or token into storage`, `renders an existing identity as masked last4 and never renders the full identity`, `không ghi challenge hoặc device identifier ra console khi hủy registration` | Negative | `COVERED` |

---

> [!NOTE]
> Các Section 6–11 dưới đây là approved pre-implementation plan snapshot được giữ nguyên làm lịch sử đối chiếu kế hoạch ban đầu. Section 14 trở đi là actual implementation evidence và reconciliation thực tế sau khi hoàn tất triển khai kiểm thử.

## 6. Phân tích khoảng trống chi tiết (Gap Analysis)

### 6.1. Registration Error Handling Gaps
Mã nguồn `RegisterScreen.tsx:289-301` đã cài đặt đầy đủ việc bắt `ApiError` và map `fieldErrors` / `serverError`:
```ts
} catch (error: unknown) {
  if (error instanceof ApiError) {
    setErrors({
      fullName: error.fieldErrors?.fullName,
      email: error.fieldErrors?.email,
      phoneNumber: error.fieldErrors?.phoneNumber,
      password: error.fieldErrors?.password,
      confirmPassword: error.fieldErrors?.confirmPassword,
    });
    setServerError(error.message);
  } else {
    setServerError("Đăng ký không thành công. Vui lòng thử lại.");
  }
} finally {
  setIsSubmitting(false);
}
```
Tuy nhiên, trong `RegisterScreen.test.tsx`, mock `registerMock` chỉ được cấu hình `mockResolvedValue`. Cần kiểm thử độc lập từng error class:
1. **HTTP 422 `VALIDATION_ERROR` (`T-REG-FE-ERR-422`)**: Kiểm tra việc map các trường lỗi cụ thể (`fullName`, `email`, `phoneNumber`, `password`, `confirmPassword`) lên input form và hiển thị `serverError`, không lưu `CHALLENGE_RECEIVED` và không gọi lại `register()`.
2. **HTTP 409 Conflict (`T-REG-FE-ERR-409`)**: Kiểm tra việc hiển thị thông báo lỗi xung đột số điện thoại/email trên `serverError` banner, form inputs được giữ nguyên và không điều hướng sang `/login`.
3. **HTTP 401 Unauthorized (`T-REG-FE-ERR-401`)**: Kiểm tra defensive UI behavior khi API upstream trả 401 Unauthorized; hiển thị thông báo lỗi từ `error.message`, không lưu `CHALLENGE_RECEIVED`, không gọi lại `register()`, không điều hướng sai.
   > **Lưu ý**: Registration begin là public pre-auth; test 401 này chỉ kiểm tra defensive UI behavior nếu upstream trả lỗi unauthorized, không tuyên bố route yêu cầu bearer authentication.
4. **`NETWORK_ERROR` (`T-REG-FE-ERR-NETWORK`)**: Kiểm tra khi `register()` reject với `ApiError({ status: null, code: "NETWORK_ERROR", message: "Không thể kết nối đến máy chủ. Vui lòng kiểm tra đường truyền mạng." })`; hiển thị thông báo mất kết nối, giữ nguyên form inputs, `register()` gọi đúng 1 lần, không screen-level auto-retry.
5. **`TIMEOUT` (`T-REG-FE-ERR-TIMEOUT`)**: Kiểm tra khi `register()` reject với `ApiError({ status: null, code: "TIMEOUT", message: "Yêu cầu đến máy chủ đã hết thời gian chờ. Vui lòng thử lại sau." })`; hiển thị thông báo quá thời gian chờ, giữ nguyên form inputs, `register()` gọi đúng 1 lần, không screen-level auto-retry.

### 6.2. Registration User-Intent-Only & Recovery Gaps
1. **Form không hợp lệ (`T-REG-FE-VAL-01`)**: Trong `RegisterScreen.test.tsx`, kiểm chứng khi form chưa điền hoặc điền sai, người dùng nhấn submit thì client validation chặn lại: hiển thị lỗi trường, `saveRegistrationSession` gọi 0 lần, `register` gọi 0 lần.
2. **Double-submit prevention (`T-REG-FE-DBL-01`)**: Khi begin request đang in-flight (promise chưa resolve bằng deferred promise), nút `PrimaryButton` có `disabled === true` và hiển thị nhãn "Đang đăng ký..."; thao tác nhấn submit lần thứ hai bị bỏ qua; `register` chỉ được gọi đúng 1 lần và storage write `BEGIN_UNKNOWN` không tăng lần 2.
3. **OTP dưới 6 chữ số (`T-REG-FE-OTP-01`)**: Khi đang ở phase `OTP`, người dùng nhập OTP dưới 6 số (ví dụ "123") và nhấn submit, UI hiển thị lỗi "Mã OTP phải gồm 6 chữ số." và `verifyRegistrationChallenge` không được gọi (0 calls).
4. **`BEGIN_UNKNOWN` Recovery Reset (`T-REG-FE-REC-01`)**:
   > Không gọi `cancelRegistration()` vì local recovery session `BEGIN_UNKNOWN` không có `challengeId`. Trạng thái server chưa xác định: request trước có thể đã thành công hoặc thất bại.
   Khi màn hình mount với session `BEGIN_UNKNOWN` (`phase.kind === "RECOVERY"`), người dùng nhấn nút "Thử lại" (`register-recovery-reset`), hàm `handleRecoveryReset` chỉ gọi `deleteRegistrationSession()` (1 call) và xóa local session; tuyệt đối KHÔNG gọi `cancelRegistration()` (0 calls), `register()` (0 calls), `verifyRegistrationChallenge()` (0 calls), hay `resendRegistrationChallenge()` (0 calls). UI quay về form đăng ký ban đầu.
5. **Mount / Restored State không tự gọi mutation (Assertion-only Amendment)**: Trong test hiện có `R17 – no auto-begin on mount -> does NOT call register() on mount with VALID CHALLENGE_RECEIVED`, hiện chỉ assert `expect(registerMock).not.toHaveBeenCalled()`. Bổ sung thêm các assertion:
   - `expect(verifyRegistrationChallengeMock).not.toHaveBeenCalled();`
   - `expect(resendRegistrationChallengeMock).not.toHaveBeenCalled();`
   - `expect(cancelRegistrationMock).not.toHaveBeenCalled();`
   (Giữ nguyên test name, delta = 0).

### 6.3. KYC In-flight Loading Gap (`T-KYC-FE-GAP-01`)
Trong `KycScreen.test.tsx`, mock `getKycApplicationMock` trả về một deferred promise:
- Trong khi promise pending:
  - Có `testID="kyc-loading-container"` và `<ActivityIndicator>`.
  - Không có editable form (`queryByTestId(renderer, "kyc-full-name") === null`).
  - Không có các nút lưu/nộp (`queryByTestId(renderer, "kyc-save-draft") === null`, `queryByTestId(renderer, "kyc-submit") === null`).
  - `saveKycDraftMock`: 0 calls; `submitKycApplicationMock`: 0 calls.
- Resolve deferred promise bằng chính xác: `null`.
- Sau khi resolve:
  - Loading container biến mất.
  - Màn hình chuyển sang `EMPTY_EDITABLE`.
  - `kyc-full-name` xuất hiện.
- Cơ chế chờ: Sử dụng bounded observable wait (`waitForAssertion` timeout 2000 ms, step 20 ms), không dùng microtask ticks cố định.

### 6.4. KYC API Runtime-Validator Wiring Gap (`T-KYC-API-VAL-01`)
Trong `kycApi.test.ts`, kiểm chứng việc wiring runtime validator vào `requestJson` bằng chính xác một response fixture:
- HTTP status: `200`.
- Body có đầy đủ các field bắt buộc của một `KycApplication` (`id`, `userId`, `fullName`, `identityNumberLast4`, `address`, `documentUri`, `rejectionReason: null`, `submittedAt: null`, `updatedAt`, `version: 1`).
- Chỉ thay `status` thành `"UNKNOWN"`.
- Gọi `getKycApplication(auth)`.
- Kỳ vọng reject bằng `ApiError`:
  - `code: "INVALID_RESPONSE"`
  - `status: 200`
- Không trả object malformed cho UI.
- Fetch call count: đúng 1 lần.
> **Lưu ý**: Các trường thiếu bắt buộc được kiểm tra riêng ở validator unit tests (`kycResponseValidators.test.ts`), không gộp vào service-wiring test.

### 6.5. KYC Response Validator Enum & Field Gaps
Trong `kycResponseValidators.test.ts`:
- Các trường hợp full identity, độ dài `identityNumberLast4` khác 4, và version < 1 / non-integer đã được test (`rejects a full identity response or a non-four-digit last4`, `requires an integer version matching the OpenAPI minimum`).
- **Khoảng trống còn lại**:
  1. `T-KYC-VAL-GAP-01`: Một named `it` kiểm tra `isKycApplication` trả về `false` với `status` ngoài 6 enum canonical (`"PENDING"`, `"UNKNOWN"`, `"IN_PROGRESS"`).
  2. `T-KYC-VAL-GAP-02`: Một named `it` với hai assertion độc lập kiểm tra `isKycApplication` trả về `false` khi thiếu `userId` hoặc thiếu `updatedAt`.

---

## 7. Đề xuất Danh sách Allowlist cố định v3 (Exact Fixed Allowlist v3)

Danh sách allowlist cố định gồm **chính xác đúng 5 files** (không có wildcard, không có optional/conditional, không có file production source):

1. `mobile-app/src/features/auth/screens/__tests__/RegisterScreen.test.tsx`
2. `mobile-app/src/features/kyc/screens/__tests__/KycScreen.test.tsx`
3. `mobile-app/src/features/kyc/services/__tests__/kycApi.test.ts`
4. `mobile-app/src/features/kyc/validation/__tests__/kycResponseValidators.test.ts`
5. `tasks/UC-M01/TASK_M01_06_CLOSE_REGISTRATION_KYC_COVERAGE_GAPS.md`

Khu vực cấm thay đổi:
- Tuyệt đối KHÔNG sửa bất kỳ file mã nguồn production nào (`RegisterScreen.tsx`, `KycScreen.tsx`, `authApi.ts`, `kycApi.ts`, `kycResponseValidators.ts`, v.v.).
- Tuyệt đối KHÔNG sửa Backend, OpenAPI, database migration, config, dependency.

---

## 8. Ma trận Kiểm thử Đề xuất v3 (Exact Test Matrix v3)

| Test ID | File | Initial state | User action/event | Observable assertions | Exact mock call counts | Baseline | Expected | Delta |
|---|---|---|---|---|---|---:|---:|---:|
| `T-REG-FE-VAL-01` | `RegisterScreen.test.tsx` | Form mount với dữ liệu rỗng (`kind: "EMPTY"`) | Nhấn nút `register-submit` với các trường rỗng/sai | Hiển thị lỗi validation trên các trường (họ tên, email, sđt, mật khẩu); không có banner server error | `saveRegistrationSession`: 0 calls; `register`: 0 calls | 33 | 34 | +1 |
| `T-REG-FE-ERR-422` | `RegisterScreen.test.tsx` | Form điền đầy đủ dữ liệu hợp lệ | Nhấn `register-submit`; `register()` reject với HTTP 422 `VALIDATION_ERROR` kèm `fieldErrors` | Lỗi trường tương ứng render trên input; `serverError` banner render; form giữ nguyên dữ liệu; nút submit re-enabled | `saveRegistrationSession`: 1 call (`BEGIN_UNKNOWN`); `register`: 1 call (không retry); `CHALLENGE_RECEIVED`: 0 calls | 34 | 35 | +1 |
| `T-REG-FE-ERR-409` | `RegisterScreen.test.tsx` | Form điền đầy đủ dữ liệu hợp lệ | Nhấn `register-submit`; `register()` reject với HTTP 409 Conflict | `serverError` banner hiển thị thông điệp lỗi xung đột; form giữ nguyên; không điều hướng `/login`; nút submit re-enabled | `saveRegistrationSession`: 1 call (`BEGIN_UNKNOWN`); `register`: 1 call (không retry); `CHALLENGE_RECEIVED`: 0 calls | 35 | 36 | +1 |
| `T-REG-FE-ERR-401` | `RegisterScreen.test.tsx` | Form điền đầy đủ dữ liệu hợp lệ | Nhấn `register-submit`; `register()` reject với HTTP 401 `UNAUTHORIZED` | `serverError` banner hiển thị thông báo lỗi phiên làm việc; form giữ nguyên; không điều hướng sai; nút submit re-enabled | `saveRegistrationSession`: 1 call (`BEGIN_UNKNOWN`); `register`: 1 call (không retry); `CHALLENGE_RECEIVED`: 0 calls | 36 | 37 | +1 |
| `T-REG-FE-ERR-NETWORK` | `RegisterScreen.test.tsx` | Form điền đầy đủ dữ liệu hợp lệ | Nhấn `register-submit`; `register()` reject với `NETWORK_ERROR` (`status: null`) | `serverError` banner hiển thị "Không thể kết nối đến máy chủ. Vui lòng kiểm tra đường truyền mạng."; form giữ nguyên; không tự động gửi request thứ hai | `saveRegistrationSession`: 1 call (`BEGIN_UNKNOWN`); `register`: 1 call (không retry); `CHALLENGE_RECEIVED`: 0 calls | 37 | 38 | +1 |
| `T-REG-FE-ERR-TIMEOUT` | `RegisterScreen.test.tsx` | Form điền đầy đủ dữ liệu hợp lệ | Nhấn `register-submit`; `register()` reject với `TIMEOUT` (`status: null`) | `serverError` banner hiển thị "Yêu cầu đến máy chủ đã hết thời gian chờ. Vui lòng thử lại sau."; form giữ nguyên; không tự động gửi request thứ hai | `saveRegistrationSession`: 1 call (`BEGIN_UNKNOWN`); `register`: 1 call (không retry); `CHALLENGE_RECEIVED`: 0 calls | 38 | 39 | +1 |
| `T-REG-FE-DBL-01` | `RegisterScreen.test.tsx` | Form điền đầy đủ dữ liệu hợp lệ | Nhấn `register-submit`; lệnh `register()` đang in-flight (deferred); người dùng nhấn submit lần thứ hai | Nút submit có `disabled === true` và nhãn "Đang đăng ký..."; lần nhấn thứ hai bị bỏ qua hoàn toàn | `saveRegistrationSession`: đúng 1 call (`BEGIN_UNKNOWN`); `register`: đúng 1 call | 39 | 40 | +1 |
| `T-REG-FE-OTP-01` | `RegisterScreen.test.tsx` | Đang ở phase `OTP` (`CHALLENGE_RECEIVED`) | Nhập mã OTP không đủ 6 chữ số (ví dụ "123") và nhấn "Xác minh OTP" | `serverError` banner hiển thị "Mã OTP phải gồm 6 chữ số."; challenge UI giữ nguyên; không chuyển màn hình | `verifyRegistrationChallenge`: 0 calls; `deleteRegistrationSession`: 0 calls | 40 | 41 | +1 |
| `T-REG-FE-REC-01` | `RegisterScreen.test.tsx` | Mount với session `BEGIN_UNKNOWN` (`phase.kind === "RECOVERY"`) | Nhấn nút "Thử lại" (`testID="register-recovery-reset"`) | Xóa session local; giao diện chuyển về form đăng ký ban đầu (`register-full-name` xuất hiện) | `deleteRegistrationSession`: 1 call; `cancelRegistration`: 0 calls; `register`: 0 calls; `verify`: 0 calls; `resend`: 0 calls | 41 | 42 | +1 |
| `T-KYC-FE-GAP-01` | `KycScreen.test.tsx` | Component mount với `getKycApplicationMock` trả deferred promise | Render trong trạng thái in-flight; sau đó resolve deferred promise bằng `null` | Trong lúc pending: `kyc-loading-container` xuất hiện kèm `ActivityIndicator`, `kyc-full-name` null, nút lưu/nộp null; sau resolve `null`: chuyển `EMPTY_EDITABLE`, `kyc-full-name` xuất hiện | `getKycApplication`: 1 call; `saveKycDraft`: 0 calls; `submitKycApplication`: 0 calls | 14 | 15 | +1 |
| `T-KYC-API-VAL-01` | `kycApi.test.ts` | Mock fetch trả HTTP 200 với full valid fixture nhưng `status: "UNKNOWN"` | Gọi `getKycApplication(auth)` | Promise reject với `ApiError` có `code: "INVALID_RESPONSE"` và `status: 200`; không trả về object malformed | `fetch`: đúng 1 call | 4 | 5 | +1 |
| `T-KYC-VAL-GAP-01` | `kycResponseValidators.test.ts` | Fixture hồ sơ KYC hợp lệ | Gọi `isKycApplication` với `status` ngoài 6 enum chuẩn (`"PENDING"`, `"UNKNOWN"`, `"IN_PROGRESS"`) | Hàm trả về `false` cho tất cả các status không nằm trong allowlist canonical | N/A (pure validator function) | 3 | 4 | +1 |
| `T-KYC-VAL-GAP-02` | `kycResponseValidators.test.ts` | Fixture hồ sơ KYC hợp lệ | Gọi `isKycApplication` với payload thiếu trường bắt buộc `userId` hoặc `updatedAt` | Hai assertion độc lập: hàm trả về `false` khi thiếu `userId` hoặc thiếu `updatedAt` | N/A (pure validator function) | 4 | 5 | +1 |

### Bổ sung Assertion trên Test cũ (Assertion-only Amendment — không tăng test count)
- **File**: `mobile-app/src/features/auth/screens/__tests__/RegisterScreen.test.tsx`
- **Test giữ nguyên tên**: `describe("R17 – no auto-begin on mount") -> it("does NOT call register() on mount with VALID CHALLENGE_RECEIVED")`
- **Nội dung bổ sung**:
  ```ts
  expect(verifyRegistrationChallengeMock).not.toHaveBeenCalled();
  expect(resendRegistrationChallengeMock).not.toHaveBeenCalled();
  expect(cancelRegistrationMock).not.toHaveBeenCalled();
  ```
- **Lý do**: Khẳng định khi mount với session khôi phục `CHALLENGE_RECEIVED`, màn hình không tự động kích hoạt bất kỳ lệnh gọi API nào (verify, resend, cancel hay register). Test count giữ nguyên (Delta: 0).

---

## 9. Bảng tổng hợp số lượng kiểm thử & Expected Test Delta v3

| File kiểm thử | Baseline | Tests thêm mới | Assertion amendments | Expected | Delta |
|---|---:|---:|---:|---:|---:|
| `RegisterScreen.test.tsx` | 33 | 9 | 1 (giữ nguyên tên) | 42 | +9 |
| `KycScreen.test.tsx` | 14 | 1 | 0 | 15 | +1 |
| `kycApi.test.ts` | 4 | 1 | 0 | 5 | +1 |
| `kycResponseValidators.test.ts` | 3 | 2 | 0 | 5 | +2 |
| **Tổng Targeted Suites (4 files)** | **54** | **13** | **1** | **67** | **+13** |
| **Toàn bộ Mobile Suites (51 files)** | **360** | **13** | **1** | **373** | **+13** |

- **Targeted Suites**: 4 suites / 67 tests expected.
- **Full Mobile Suites**: 51 suites / 373 tests expected.
- **Test delta**: Chính xác $+13$ tests.
- **Assertion-only amendments**: 1.
- **Removed / renamed / merged / skipped tests**: 0.

---

## 10. Quy chuẩn Kỹ thuật Bổ sung Kiểm thử

### 10.1. Chính sách Bounded Async-Wait
- Mọi thao tác chờ bất đồng bộ trong các test mới bắt buộc phải sử dụng cơ chế bounded observable wait:
  - Chờ observable UI condition hoặc mock call condition (thông qua `waitForAssertion` hoặc predicate rõ ràng).
  - Timeout hữu hạn (tối đa 2000 ms, bước thăm dò 20 ms bọc trong `act(async () => ...)`).
  - Tuyệt đối không dùng số lượng `Promise.resolve()` tick cố định cho các test mới.
  - Tuyệt đối không polling vô hạn.
  - Test double-submit (`T-REG-FE-DBL-01`) và KYC initial loading (`T-KYC-FE-GAP-01`) bắt buộc dùng deferred promise để giữ request ở trạng thái in-flight có kiểm soát, không dùng `setTimeout` sleep tùy tiện.

### 10.2. Chính sách Bảo mật & Dữ liệu Tổng hợp (Privacy Policy)
- Tất cả dữ liệu thử nghiệm đều là synthetic/mock data.
- Tuyệt đối không dùng password thật, OTP thật, access token thật hoặc số CMND/CCCD thật.
- Không in dữ liệu nhạy cảm ra test output hay console.
- Không persist dữ liệu định danh đầy đủ hay credential vào storage.
- Không làm suy yếu các assertion bảo mật và quyền riêng tư hiện có.
- Không thêm `any`, `as any`, `as unknown as`, `as never`, `@ts-ignore` hay `@ts-expect-error`.

### 10.3. Ranh giới hoãn lại (Deferred Boundary)
- **M01-07 (PostgreSQL Concurrency & Disposable Database)**: Toàn bộ kiểm thử race condition đa tiến trình, row-lock interleaving và transaction isolation trên PostgreSQL thật vẫn thuộc phạm vi M01-07. M01-06 không chạy database integration tests.
- **M01-08 (Device & Staging E2E)**: Toàn bộ kiểm thử luồng eKYC và Registration trên Android emulator / thiết bị thật bằng Maestro CLI vẫn thuộc phạm vi M01-08. Cú pháp Maestro flow (`validate-maestro.cjs`) không được xem là device runtime evidence.

---

## 11. Lệnh kiểm tra Quality Gates (Quality Gate Commands)

Từ thư mục `mobile-app/`:
```powershell
npm run lint
npm run typecheck
npx jest --runInBand src/features/auth/screens/__tests__/RegisterScreen.test.tsx src/features/kyc/screens/__tests__/KycScreen.test.tsx src/features/kyc/services/__tests__/kycApi.test.ts src/features/kyc/validation/__tests__/kycResponseValidators.test.ts
npm test -- --runInBand
npm run validate:openapi
npm run validate:e2e
npm run export:web
```

Từ repository root:
```powershell
git diff --check
git diff --name-status
git diff --stat
git diff --cached --name-status
git status --short --untracked-files=all
```

---

## 12. Tiêu chí nghiệm thu v3 (Acceptance Criteria v3)

- [x] Phân biệt rõ rệt giữa chế độ tài liệu trước đó (`DIAGNOSE_AND_PLAN — DOCUMENTATION ONLY`) và chế độ triển khai hiện tại (`IMPLEMENT_AND_VERIFY — TEST ONLY`).
- [x] 13 test mới (`T-REG-FE-VAL-01`, `T-REG-FE-ERR-422`, `T-REG-FE-ERR-409`, `T-REG-FE-ERR-401`, `T-REG-FE-ERR-NETWORK`, `T-REG-FE-ERR-TIMEOUT`, `T-REG-FE-DBL-01`, `T-REG-FE-OTP-01`, `T-REG-FE-REC-01`, `T-KYC-FE-GAP-01`, `T-KYC-API-VAL-01`, `T-KYC-VAL-GAP-01`, `T-KYC-VAL-GAP-02`) và 1 assertion amendment được triển khai chính xác theo test matrix v3.
- [x] Không có bất kỳ file mã nguồn production nào bị sửa đổi.
- [x] Danh sách allowlist được giữ cố định đúng 5 files.
- [x] Targeted test suites đạt chính xác 4 suites / 67 tests PASS (delta đúng $+13$ tests).
- [x] Full Mobile test suite đạt chính xác 51 suites / 373 tests PASS (delta đúng $+13$ tests).
- [x] Không có bất kỳ test cũ nào bị xóa, đổi tên, gộp hoặc skip.
- [x] Toàn bộ Quality Gates Mobile (lint, typecheck, targeted tests, full tests, openapi, e2e syntax, export web) đều PASS 100%.
- [x] M01-07 và M01-08 vẫn giữ nguyên ranh giới hoãn lại (deferred).
- [x] Tại implementation review checkpoint, M01-06 và UC-M01 chưa được đánh dấu `COMPLETED`; sau final closure chỉ M01-06 chuyển thành `COMPLETED`, còn UC-M01 tiếp tục chưa hoàn thành cho đến M01-09.

---

## 13. Quyền Git và Trạng thái Quyết định

### Quyền Git
- Không stage, commit, push, amend, merge hay rebase trong lượt này.
- Toàn bộ thay đổi mã nguồn tuân thủ chế độ `IMPLEMENT_AND_VERIFY — TEST ONLY` và dừng lại ở worktree chờ Owner review.

### Trạng thái Quyết định
- **Trạng thái thực hiện**: `COMPLETED`
- **Kết luận**: `READY FOR M01-06 CLOSURE COMMIT`.
- **Ghi chú phân định trạng thái**: Các trạng thái `READY FOR M01-06 OWNER REVIEW` và `IN_PROGRESS` ở các section trước thuộc về audit trail lịch sử phát triển; nguồn sự thật hiện hành (current source of truth) là header (`Trạng thái: COMPLETED`), Section 13 (`Trạng thái thực hiện: COMPLETED`), và Section 18 (`M01-06 closure status: COMPLETED`).

---

## 14. M01-06 TEST-ONLY IMPLEMENTATION EVIDENCE

### 14.1. Baseline & Allowlist Verification
- **Baseline HEAD**: `a7d30682ae721fb280fb6d4efd86364da3eae735` (branch `codex/staging-academic-completion`).
- **Parent Commit**: `6bdb004966379b34964dc7d6912674243cda21dd`.
- **Exact 5-File Allowlist**:
  1. `mobile-app/src/features/auth/screens/__tests__/RegisterScreen.test.tsx` (modified)
  2. `mobile-app/src/features/kyc/screens/__tests__/KycScreen.test.tsx` (modified)
  3. `mobile-app/src/features/kyc/services/__tests__/kycApi.test.ts` (modified)
  4. `mobile-app/src/features/kyc/validation/__tests__/kycResponseValidators.test.ts` (modified)
  5. `tasks/UC-M01/TASK_M01_06_CLOSE_REGISTRATION_KYC_COVERAGE_GAPS.md` (untracked/modified)
- **Production Code Changes**: 0 files. Tuyệt đối không sửa bất kỳ dòng mã production nào.

### 14.2. Danh sách 13 Tests mới và 1 Assertion Amendment
1. `T-KYC-VAL-GAP-01`: Rejects status enum outside canonical 6 (`PENDING`, `UNKNOWN`, `IN_PROGRESS`) trong `kycResponseValidators.test.ts`.
2. `T-KYC-VAL-GAP-02`: Rejects missing `userId` or `updatedAt` trong `kycResponseValidators.test.ts`.
3. `T-KYC-API-VAL-01`: Asserts `getKycApplication(auth)` rejects with `ApiError` (`code: "INVALID_RESPONSE"`, `status: 200`) on server HTTP 200 with status `"UNKNOWN"` trong `kycApi.test.ts`.
4. `T-KYC-FE-GAP-01`: Tests in-flight loading via `ActivityIndicator`, form and actions hidden, 0 mock calls during loading, resolve with `null` transitions to empty form (`EMPTY_EDITABLE`) trong `KycScreen.test.tsx`.
5. `T-REG-FE-VAL-01`: Blocks submission when form invalid, checks exact Vietnamese validator error messages, 0 API/storage calls trong `RegisterScreen.test.tsx`.
6. `T-REG-FE-ERR-422`: Displays field errors and server banner on 422, keeps form, re-enables submit, 0 retries trong `RegisterScreen.test.tsx`.
7. `T-REG-FE-ERR-409`: Displays conflict banner on 409, keeps form, no `/login` route, re-enables submit, 0 retries trong `RegisterScreen.test.tsx`.
8. `T-REG-FE-ERR-401`: Defensive UI test on 401, displays server message, no route, 0 retries trong `RegisterScreen.test.tsx`.
9. `T-REG-FE-ERR-NETWORK`: Displays connection error message on `NETWORK_ERROR`, no second request trong `RegisterScreen.test.tsx`.
10. `T-REG-FE-ERR-TIMEOUT`: Displays timeout error message on `TIMEOUT`, no second request trong `RegisterScreen.test.tsx`.
11. `T-REG-FE-DBL-01`: In-flight deferred promise keeps submit button disabled with label "Đang đăng ký...", ignores second interaction, exactly 1 call trong `RegisterScreen.test.tsx`.
12. `T-REG-FE-OTP-01`: Enforces 6 digits for OTP verify, displays "Mã OTP phải gồm 6 chữ số.", 0 verify calls trong `RegisterScreen.test.tsx`.
13. `T-REG-FE-REC-01`: Reset from `BEGIN_UNKNOWN` deletes local session and returns to form without calling `cancelRegistration` trong `RegisterScreen.test.tsx`.
- **Assertion Amendment**:
  - Trong test `R17 – no auto-begin on mount -> does NOT call register() on mount with VALID CHALLENGE_RECEIVED`: bổ sung verify assertions cho `verifyRegistrationChallengeMock`, `resendRegistrationChallengeMock`, và `cancelRegistrationMock` (đảm bảo không gọi ngầm bất kỳ API nào, không tăng test count).

### 14.3. Test Counts & Deltas
- **Targeted Test Suites** (4 suites):
  - `kycResponseValidators.test.ts`: 5 passed (+2)
  - `kycApi.test.ts`: 5 passed (+1)
  - `KycScreen.test.tsx`: 15 passed (+1)
  - `RegisterScreen.test.tsx`: 42 passed (+9)
  - **Targeted Total**: 4 suites, 67 tests passed, 0 failed, 0 skipped (Baseline: 54 $\rightarrow$ 67, delta đúng $+13$ tests).
- **Full Mobile Test Suite** (51 suites):
  - **Full Total**: 51 suites, 373 tests passed, 0 failed, 0 skipped (Baseline: 360 $\rightarrow$ 373, delta đúng $+13$ tests).
  - Không có bất kỳ test cũ nào bị xóa, đổi tên, gộp hoặc skip.

### 14.4. Quality Gates Execution Results
- `npm run lint`: PASS (0 errors, 0 warnings).
- `npm run typecheck`: PASS (0 errors).
- `npm test -- --runInBand`: PASS (51 test suites, 373 tests passed, 0 failed, 0 skipped).
- `npm run validate:openapi`: PASS (46 required paths valid).
- `npm run validate:e2e`: PASS (19 Maestro flows valid).
- `npm run export:web`: PASS (Expo static export succeeded, 36 static routes exported).

### 14.5. Scope Boundaries & Next Actions
- **M01-07 (PostgreSQL Concurrency / Row-Lock)**: Hoãn lại (deferred), không chạy integration tests trên DB thật.
- **M01-08 (Device / Emulator Maestro Runtime)**: Hoãn lại (deferred), không chạy device runtime tests.
- **Trạng thái**: Tại thời điểm implementation review trước commit, M01-06 và UC-M01 chưa được đánh dấu `COMPLETED`. Trạng thái hiện hành sau closure: M01-06 `COMPLETED`, UC-M01 chưa hoàn thành.
- **Git State**: Không stage, không commit, không push, không amend. Dừng tại worktree để chờ Owner review.

---

## 15. M01-06 FINAL OWNER-REVIEW RECONCILIATION

### 15.1. Git Baseline & Five-File WIP Inventory
- **Branch**: `codex/staging-academic-completion`
- **Baseline HEAD**: `a7d30682ae721fb280fb6d4efd86364da3eae735`
- **Parent Commit**: `6bdb004966379b34964dc7d6912674243cda21dd`
- **Cached Area**: Sạch (0 files staged, `git diff --cached --name-status` rỗng).
- **Exact Five-File WIP Inventory**:
  1. `mobile-app/src/features/auth/screens/__tests__/RegisterScreen.test.tsx` (`modified`)
  2. `mobile-app/src/features/kyc/screens/__tests__/KycScreen.test.tsx` (`modified`)
  3. `mobile-app/src/features/kyc/services/__tests__/kycApi.test.ts` (`modified`)
  4. `mobile-app/src/features/kyc/validation/__tests__/kycResponseValidators.test.ts` (`modified`)
  5. `tasks/UC-M01/TASK_M01_06_CLOSE_REGISTRATION_KYC_COVERAGE_GAPS.md` (`untracked`)
- **Zero Production Changes**: 0 file mã nguồn production bị chỉnh sửa.

### 15.2. Danh sách 13 Discovered Test Names & 1 Assertion Amendment
1. `T-KYC-VAL-GAP-01`: `T-KYC-VAL-GAP-01: rejects an application response with an invalid status enum` (trong `kycResponseValidators.test.ts`)
2. `T-KYC-VAL-GAP-02`: `T-KYC-VAL-GAP-02: rejects an application response missing required fields userId or updatedAt` (trong `kycResponseValidators.test.ts`)
3. `T-KYC-API-VAL-01`: `T-KYC-API-VAL-01: rejects with INVALID_RESPONSE when server returns malformed KYC application body` (trong `kycApi.test.ts`)
4. `T-KYC-FE-GAP-01`: `T-KYC-FE-GAP-01: renders loading indicator and hides form while initial application load is pending` (trong `KycScreen.test.tsx`)
5. `T-REG-FE-VAL-01`: `T-REG-FE-VAL-01: blocks registration submission when form is invalid without calling API or storage` (trong `RegisterScreen.test.tsx`)
6. `T-REG-FE-ERR-422`: `T-REG-FE-ERR-422: displays field errors and server error message on HTTP 422 without retrying` (trong `RegisterScreen.test.tsx`)
7. `T-REG-FE-ERR-409`: `T-REG-FE-ERR-409: displays conflict error message on HTTP 409 without retrying` (trong `RegisterScreen.test.tsx`)
8. `T-REG-FE-ERR-401`: `T-REG-FE-ERR-401: displays error message on HTTP 401 without auto-retry or wrong navigation` (trong `RegisterScreen.test.tsx`)
9. `T-REG-FE-ERR-NETWORK`: `T-REG-FE-ERR-NETWORK: displays connection error on NETWORK_ERROR without second request` (trong `RegisterScreen.test.tsx`)
10. `T-REG-FE-ERR-TIMEOUT`: `T-REG-FE-ERR-TIMEOUT: displays timeout error on TIMEOUT without second request` (trong `RegisterScreen.test.tsx`)
11. `T-REG-FE-DBL-01`: `T-REG-FE-DBL-01: disables submit button and ignores duplicate press while registration begin is pending` (trong `RegisterScreen.test.tsx`)
12. `T-REG-FE-OTP-01`: `T-REG-FE-OTP-01: blocks OTP verification when proof is less than 6 digits without calling API` (trong `RegisterScreen.test.tsx`)
13. `T-REG-FE-REC-01`: `T-REG-FE-REC-01: recovery reset from BEGIN_UNKNOWN deletes stored session and returns to form without calling cancelRegistration` (trong `RegisterScreen.test.tsx`)
- **Assertion Amendment**:
  - Test `R17 – no auto-begin on mount -> does NOT call register() on mount with VALID CHALLENGE_RECEIVED`: bổ sung verify assertions cho `verifyRegistrationChallengeMock`, `resendRegistrationChallengeMock`, và `cancelRegistrationMock` (đảm bảo không gọi ngầm bất kỳ API nào, không tăng số lượng test count).

### 15.3. Per-File & Overall Test Counts
- **Per-File Counts**:
  - `RegisterScreen.test.tsx`: **42 passed** (baseline 33 $\rightarrow$ 42, delta $+9$)
  - `KycScreen.test.tsx`: **15 passed** (baseline 14 $\rightarrow$ 15, delta $+1$)
  - `kycApi.test.ts`: **5 passed** (baseline 4 $\rightarrow$ 5, delta $+1$)
  - `kycResponseValidators.test.ts`: **5 passed** (baseline 3 $\rightarrow$ 5, delta $+2$)
- **Targeted Test Suites Total**: **4 suites / 67 passed / 0 failed / 0 skipped** (Baseline: 54 $\rightarrow$ 67, delta đúng $+13$ tests).
- **Full Mobile Test Suite Total**: **51 suites / 373 passed / 0 failed / 0 skipped** (Baseline: 360 $\rightarrow$ 373, delta đúng $+13$ tests).
- **Zero Test Tampering**: Không có bất kỳ test cũ nào bị xóa, đổi tên, gộp hoặc skip.

### 15.4. Quality Gates Execution
- `npm run lint`: **PASS** (0 errors, 0 warnings).
- `npm run typecheck`: **PASS** (0 errors).
- Targeted Jest (4 suites): **PASS** (67/67 passed).
- `npm test -- --runInBand` (51 suites): **PASS** (373/373 passed).
- `npm run validate:openapi`: **PASS** (46 required paths hợp lệ).
- `npm run validate:e2e`: **PASS** (19 Maestro flows hợp lệ cú pháp).
- `npm run export:web`: **PASS** (Expo export web thành công, 36 static routes exported).

### 15.5. Bounded-Wait & Deferred-Promise Evidence
- `T-REG-FE-DBL-01`: Dùng `createDeferred<AuthChallengeResponse>()` để giữ request begin in-flight có kiểm soát; assert `submitButton.props.disabled === true` và `label === "Đang đăng ký..."`; thao tác tương tác thứ hai tuân thủ trạng thái `disabled` của UI (không bypass trực tiếp handler); xác nhận `registerMock` chỉ gọi đúng duy nhất 1 lần.
- `T-KYC-FE-GAP-01`: Dùng pending promise giữ initial application load in-flight; assert `ActivityIndicator` hiển thị và các nút thao tác bị ẩn; resolve chính xác `null`; dùng `waitForAssertion` với bounded timeout 2000 ms (step 20 ms bọc trong `act(...)`) để quan sát chuyển đổi an toàn sang form rỗng (`EMPTY_EDITABLE`).
- `T-KYC-API-VAL-01`: Dùng HTTP 200 fixture chuẩn xác nhưng có `status: "UNKNOWN"`; assert `getKycApplication(auth)` reject đúng `ApiError` với `code: "INVALID_RESPONSE"` và `status: 200`.
- Mọi async wait đều có timeout hữu hạn tối đa 2000 ms; không dùng fixed `Promise.resolve()` ticks hay polling vô hạn.

### 15.6. Prohibited-Pattern Scan
- Quét toàn bộ dòng thêm mới (`+`) trong git diff của bốn test file:
  - `any`: 0
  - `as any`: 0
  - `as unknown as`: 0
  - `as never`: 0
  - `@ts-ignore`: 0
  - `@ts-expect-error`: 0
- Kết quả: **0 vi phạm**.

### 15.7. Status, Boundaries & Git Constraints
- **Trạng thái (lịch sử tại thời điểm reconciliation)**: `IN_PROGRESS — M01-06 VERIFIED` (đã chuyển thành `COMPLETED` sau implementation commit và final closure).
- **Scope Boundaries**: M01-07 (PostgreSQL concurrency / row-lock) và M01-08 (Device / Emulator Maestro runtime) giữ nguyên trạng thái hoãn lại (deferred).
- **Task & Use Case**: Tại thời điểm reconciliation trước implementation commit, M01-06 và UC-M01 đều chưa `COMPLETED`. Sau final closure, M01-06 đã `COMPLETED`; UC-M01 vẫn chưa hoàn thành.
- **Git Restrictions**: Tuyệt đối không stage (`git add`), commit (`git commit`), push (`git push`), hay amend (`git commit --amend`). Toàn bộ thay đổi giữ nguyên ở working tree để chờ Owner review.

---

## 16. OWNER REVIEW — M01-06 READY FOR CHECKPOINT COMMIT

### 16.1. Owner Review Summary
- **Finding P0/P1**: Không có finding P0/P1. Toàn bộ phạm vi kiểm thử tuân thủ nghiêm ngặt quy cách hợp đồng và bảo mật.
- **Exact 13 Tests và 1 Assertion-Only Amendment**: Đã được xác minh đầy đủ và độc lập:
  - 9 tests mới và 1 assertion-only amendment (R17) trong `RegisterScreen.test.tsx`
  - 1 test mới trong `KycScreen.test.tsx`
  - 1 test mới trong `kycApi.test.ts`
  - 2 tests mới trong `kycResponseValidators.test.ts`
- **Targeted Test Suites**: 4 suites / 67 pass / 0 fail / 0 skip (100% PASS).
- **Full Mobile Test Suite**: 51 suites / 373 pass / 0 fail / 0 skip (100% PASS).
- **Delta Kiểm thử**: Chính xác +13 tests; tuyệt đối không xóa, rename, merge hoặc skip bất kỳ test cũ nào.
- **Quality Gates Toàn diện**:
  - `npm run lint`: PASS (0 errors, 0 warnings).
  - `npm run typecheck`: PASS (0 errors).
  - `npm run validate:openapi`: PASS (46 required paths hợp lệ).
  - `npm run validate:e2e`: PASS (19 Maestro flows hợp lệ cú pháp).
  - `npm run export:web`: PASS (Expo export web thành công, 36 static routes exported).
- **Bounded Observable Wait & Deferred Promise**: Đúng contract; mọi async wait có timeout tối đa 2000 ms; không polling vô hạn hay fixed ticks.
- **Zero Production Source Change**: 0 file mã nguồn production bị sửa đổi.
- **Prohibited-Pattern Scan**: 0 vi phạm trên các dòng code thêm mới (`any`, `as any`, `as unknown as`, `as never`, `@ts-ignore`, `@ts-expect-error`).
- **Deferred Scope**: M01-07 (PostgreSQL concurrency / row-lock) và M01-08 (Device/Emulator Maestro runtime) tiếp tục hoãn lại (deferred).
- **Task Lifecycle**: M01-06 và UC-M01 chưa `COMPLETED` tại thời điểm Owner Review trước implementation commit; sau final closure, M01-06 chuyển thành `COMPLETED`, UC-M01 tiếp tục chưa hoàn thành cho đến M01-09.
- **Checkpoint Status**: Checkpoint đã được commit local thành công (commit `7599a5a13161a5bb9233c49ebfd0451d40ccedd4`), chưa push.

---

## 17. M01-06 TEST-ONLY IMPLEMENTATION COMMIT

### 17.1. Commit Identity & Parentage
- **Full Commit SHA**: `7599a5a13161a5bb9233c49ebfd0451d40ccedd4`
- **Parent SHA**: `a7d30682ae721fb280fb6d4efd86364da3eae735`
- **Exact Git Message**: `test(mobile): close registration KYC coverage gaps`
- **Author Timestamp**: `2026-09-04T13:00:11+07:00`
- **Committer Timestamp**: `2026-09-04T13:00:11+07:00`
- **Ancestry Verification**:
  - `git merge-base --is-ancestor 28c2711d13034555cbf3fee7df521926abb72847 HEAD`: PASS
  - `git merge-base --is-ancestor a7d30682ae721fb280fb6d4efd86364da3eae735 HEAD`: PASS
  - `git merge-base --is-ancestor 7599a5a13161a5bb9233c49ebfd0451d40ccedd4 HEAD`: PASS

### 17.2. Exact Five-File Implementation Inventory & Stat
- **Exact Inventory**:
  - `M mobile-app/src/features/auth/screens/__tests__/RegisterScreen.test.tsx`
  - `M mobile-app/src/features/kyc/screens/__tests__/KycScreen.test.tsx`
  - `M mobile-app/src/features/kyc/services/__tests__/kycApi.test.ts`
  - `M mobile-app/src/features/kyc/validation/__tests__/kycResponseValidators.test.ts`
  - `A tasks/UC-M01/TASK_M01_06_CLOSE_REGISTRATION_KYC_COVERAGE_GAPS.md`
- **Exact Stat**: `5 files changed, 828 insertions(+), 1 deletion(-)`
- **Commit-Tree Hashes**:
  - `RegisterScreen.test.tsx`: `10c2d9c6f907c52b38175b21960fa3a5977f48bf`
  - `KycScreen.test.tsx`: `6b747bdcb7dddaeacfe7a7d8de0eb377615fc06c`
  - `kycApi.test.ts`: `0dc3399b3fbbdb57a7d01a5ba3db94cce25c0156`
  - `kycResponseValidators.test.ts`: `66243480b0ae39dc81431579a7831dc11cc21961`
  - `TASK_M01_06_CLOSE_REGISTRATION_KYC_COVERAGE_GAPS.md`: `de8cd158b220f4718629c05846238ac2b330e0b2`

### 17.3. Test Counts, Gates & Constraints
- **Targeted Test Suites**: 4 suites / 67 passed / 0 failed / 0 skipped (100% PASS).
- **Per-File Counts**:
  - `RegisterScreen.test.tsx`: 42 passed
  - `KycScreen.test.tsx`: 15 passed
  - `kycApi.test.ts`: 5 passed
  - `kycResponseValidators.test.ts`: 5 passed
- **Full Mobile Test Suite**: 51 suites / 373 passed / 0 failed / 0 skipped (100% PASS).
- **Delta Kiểm thử**: Đúng $+13$ tests (13 tests mới và 1 assertion-only amendment trong R17).
- **Zero Test Tampering**: Không có bất kỳ test cũ nào bị xóa, đổi tên, gộp hoặc skip.
- **Quality Gates**: Lint (PASS), Typecheck (PASS), OpenAPI Contract (PASS), E2E Syntax (PASS), Web Export (PASS).
- **Production Source Changes**: 0 file.
- **Git State**: Committed local trên branch `codex/staging-academic-completion`, chưa push.

---

## 18. M01-06 FINAL CLOSURE

### 18.1. Completed Scope
- Toàn bộ 13 khoảng trống kiểm thử đã được phê duyệt trong test matrix M01-06 đã được triển khai và xác minh.
- **Các khoảng trống Registration đã được đóng**:
  - Client validation (`T-REG-FE-VAL-01`): Chặn submit khi form không hợp lệ, không phát sinh API/storage call.
  - HTTP 422 (`T-REG-FE-ERR-422`): Map `fieldErrors` và server banner, giữ form, kích hoạt lại submit, không tự retry.
  - HTTP 409 (`T-REG-FE-ERR-409`): Hiển thị conflict banner, giữ form, không route sang `/login`, không tự retry.
  - Defensive HTTP 401 (`T-REG-FE-ERR-401`): Hiển thị lỗi server, không route sai, kích hoạt lại submit, không tự retry.
  - `NETWORK_ERROR` (`T-REG-FE-ERR-NETWORK`): Hiển thị lỗi mạng, giữ form, không phát sinh request thứ hai.
  - `TIMEOUT` (`T-REG-FE-ERR-TIMEOUT`): Hiển thị lỗi timeout, giữ form, không phát sinh request thứ hai.
  - Double-submit (`T-REG-FE-DBL-01`): Nút submit bị disabled với label "Đang đăng ký...", second press bị bỏ qua, API gọi đúng 1 lần.
  - Invalid OTP (`T-REG-FE-OTP-01`): Yêu cầu đủ 6 số, hiển thị lỗi, không gọi verify API.
  - `BEGIN_UNKNOWN` Recovery Reset (`T-REG-FE-REC-01`): Xóa session local và quay về form, tuyệt đối không gọi `cancelRegistration()`.
  - Restored challenge mutation protection (R17 assertion amendment): Mount với restored challenge không tự động gọi `register`, `verifyRegistrationChallenge`, `resendRegistrationChallenge`, hay `cancelRegistration`.
- **Các khoảng trống KYC đã được đóng**:
  - Initial loading in-flight (`T-KYC-FE-GAP-01`): Giữ pending quan sát `ActivityIndicator`, resolve `null` chuyển sang empty form (`EMPTY_EDITABLE`).
  - API runtime-validator wiring (`T-KYC-API-VAL-01`): Reject `ApiError` code `INVALID_RESPONSE` status 200 khi backend trả HTTP 200 nhưng schema không hợp lệ (`status: "UNKNOWN"`).
  - Invalid status enum (`T-KYC-VAL-GAP-01`): Validator từ chối các status enum nằm ngoài canonical 6.
  - Missing `userId` (`T-KYC-VAL-GAP-02`): Validator từ chối payload thiếu `userId`.
  - Missing `updatedAt` (`T-KYC-VAL-GAP-02`): Validator từ chối payload thiếu `updatedAt`.
- **Hành vi sản phẩm**: Không thay đổi bất kỳ hành vi sản phẩm hay logic production nào (0 production changes).

### 18.2. Latest Evidence
- Targeted Test Suites: **67/67 PASS** (100%).
- Full Mobile Test Suite: **373/373 PASS** (100%).
- Lint (`npm run lint`): **PASS** (0 errors, 0 warnings).
- Typecheck (`npm run typecheck`): **PASS** (0 errors).
- OpenAPI Validation (`npm run validate:openapi`): **PASS** (46 paths hợp lệ).
- E2E Syntax Validation (`npm run validate:e2e`): **PASS** (19 flows hợp lệ).
- Web Export (`npm run export:web`): **PASS** (36 static routes exported).
- TypeScript Hygiene: 0 prohibited-pattern violation trên các dòng test được thêm bởi M01-06.
- Bounded Async Wait: Các thao tác chờ bất đồng bộ được thêm trong các test M01-06 đều có timeout hữu hạn tối đa 2000 ms; không polling vô hạn hoặc fixed microtask ticks.

### 18.3. Deferred Evidence
- **M01-07**:
  - PostgreSQL disposable runtime suite.
  - Transaction isolation và row-level lock concurrency.
  - Multi-process race condition và interleaving verification.
- **M01-08**:
  - Kiểm thử runtime trên Android emulator và thiết bị thật.
  - Maestro CLI automation runtime flows.
  - Bằng chứng crash-recovery, process-kill và app restart trên thiết bị.
- **Lưu ý nguyên tắc**: Syntax validation (`validate-maestro.cjs`) không thể thay thế cho bằng chứng device-runtime evidence.

### 18.4. Scope Closure & Lifecycle
- **M01-06 implementation scope**: Hoàn thành (`COMPLETED`).
- **M01-06 evidence scope**: Hoàn thành trong phạm vi test-only và static quality gates đã được phê duyệt.
- **M01-06 closure status**: `COMPLETED`.
- **M01-07 và M01-08**: Chưa bắt đầu (giữ nguyên ranh giới hoãn lại).
- **UC-M01**: **Chưa hoàn thành**; chỉ M01-09 mới thực hiện tổng kiểm toán và đóng Use Case UC-M01.
- **Tuyên bố sẵn sàng**: Không tuyên bố pilot hoặc production-ready khi chưa có staging, core integration và device E2E.
- **Git Action**: Không push, không amend. Dừng tại local repository.

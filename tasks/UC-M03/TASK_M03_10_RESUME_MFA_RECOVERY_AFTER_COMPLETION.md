# TASK M03-10 — Resume MFA Recovery After Completion

> **Trạng thái nhiệm vụ:** COMPLETED — VERIFIED.
>
> **Trạng thái Use Case UC-M03:** INCOMPLETE.
>
> Ngày thực hiện: 2026-09-08.
>
> Phân hệ: Mobile App & Client Security / Thành viên 2.
>
> Mục tiêu: Triển khai và kiểm chứng khả năng tiếp tục tiến trình (client continuation) tại màn hình khôi phục MFA (`MfaRecoveryScreen.tsx`) khi `completeMfaRecovery` đã hoàn tất thành công trên backend nhưng phía client bị ngắt quãng trước khi nhận hoặc xử lý kết quả: nếu người dùng bấm tiếp tục và backend trả về HTTP 409 với mã lỗi `MFA_RECOVERY_ALREADY_COMPLETED`, client nhận diện đây là bằng chứng yêu cầu đã hoàn tất và lập tức chuyển tiếp gọi `beginRecoveryTotpEnrollment`; giữ nguyên luồng lỗi cho các mã lỗi khác; kiểm chứng đầy đủ bằng unit tests và quality gates.

---

## 1. Thông tin dự án và quyền truy cập

- **Tên dự án:** Banking System
- **Vị trí Windows:** `C:\\Projects\\banking-system`
- **Repository root thực tế:** `C:\\Projects\\banking-system`
- **Quyền truy cập:** Codex được mở tại repository root của local project.
- **Xác nhận Preflight:**
  - CWD: `C:\\Projects\\banking-system`
  - Git branch: `codex/staging-academic-completion`
  - Git HEAD nền: `382906d94c53d0617821573403f52e413aea465d` (commit M03-08)
  - Git status: Index sạch, working tree sạch trước khi bắt đầu nhiệm vụ.
  - Ghi nhận lịch sử: Nhiệm vụ M03-09 là audit kỹ thuật read-only (`DIAGNOSE_AND_PLAN`), không có file/commit riêng và không tạo commit giả.
- **Mục đích:** Dự án mobile banking academic/reference implementation dùng dữ liệu tổng hợp (synthetic) và tiền ảo, hướng tới kiểm thử local và phục vụ bảo vệ đồ án tốt nghiệp. Không phải hệ thống xử lý tiền thật, pilot đã xác minh hoặc production-ready.
- **Tài liệu đã đối soát:**
  - `AGENTS.md` và `mobile-app/AGENTS.md` (tuân thủ tài liệu Expo SDK 57)
  - `PROJECT_CONTEXT.md`
  - `USE_CASE_ROADMAP.md`
  - `TASK_TEMPLATE.md`
  - `mobile-app/README.md`
  - Báo cáo lập kế hoạch M03-09 và hồ sơ task M03-02, M03-04, M03-06, M03-08

---

## 2. Chế độ làm việc và quyền Git

- **Chế độ làm việc:** `IMPLEMENT_AND_VERIFY`
- **Ưu tiên:** `P1`
- **Quyền sửa đổi:** Trong danh sách allowlist gồm đúng 3 files được Owner phê duyệt:
  1. `mobile-app/src/features/auth/screens/MfaRecoveryScreen.tsx`
  2. `mobile-app/src/features/auth/screens/__tests__/MfaRecoveryScreen.test.tsx`
  3. `tasks/UC-M03/TASK_M03_10_RESUME_MFA_RECOVERY_AFTER_COMPLETION.md`
- **Vùng cấm:**
  - Không sửa backend, schema, database migration, backend business logic, `PersistentMfaService`.
  - Không sửa `authApi.ts`, `AuthContext.tsx`, `httpClient.ts`, route guards toàn cục (`RootLayout`, `_layout.tsx`).
  - Không sửa OpenAPI draft hoặc contract HTTP.
  - Không tự ý thêm auto-retry vô hạn, loop tự động gọi lại, hoặc fallback ngầm định.
  - Không khởi động lại recovery từ đầu bằng recovery code cũ (vì recovery code đã bị hash/vô hiệu hóa một chiều khi bắt đầu).
  - Không nhận diện hết hạn vĩnh viễn (terminal expiry) bằng regex thông điệp hoặc status 401 chung chung khi chưa có contract/error code tường minh.
  - Không lưu trữ `recoveryToken` vào persistent storage (SecureStore, AsyncStorage).
  - Không đưa recovery codes hay secret keys vào clipboard API, URL parameters, file hệ thống, console log hay analytics.
- **Quyền Git:**
  - Không tự ý `git add`, `git commit`, `git push`, `git tag`, merge hoặc rebase.

---

## 3. Hiện trạng, nguyên nhân gốc và quyết định kỹ thuật

### 3.1. Hiện trạng và nguyên nhân gốc (từ Audit M03-09)
- Tại màn hình `MfaRecoveryScreen.tsx`, sau khi bước cooldown kết thúc, người dùng bấm nút *"Tiếp tục đăng ký Authenticator"* (`handleApprove`).
- Hàm `handleApprove` thực hiện tuần tự hai cuộc gọi mạng:
  1. `completeMfaRecovery(recoveryToken, deviceOptions)`: chuyển trạng thái recovery request trên backend từ `PRIMARY_PROOF_VERIFIED` / `APPROVED` sang `COMPLETED`.
  2. `beginRecoveryTotpEnrollment({ recoveryToken }, deviceOptions)`: tạo pending credential TOTP mới cho request đã `COMPLETED`.
- **Điểm nghẽn rủi ro mạng (Network Interruption Edge Case):**
  - Nếu bước 1 (`completeMfaRecovery`) đã tới backend và cơ sở dữ liệu đã cập nhật trạng thái sang `COMPLETED`, nhưng kết nối mạng bị timeout/drop trước khi response HTTP 200 trả về client:
  - Phía client coi đó là lỗi mạng, giữ người dùng ở lại Bước 2 (`enrollment = null`) kèm thông báo lỗi và nút *"Tiếp tục đăng ký Authenticator"*.
  - Khi người dùng bấm lại nút này, client gửi lại `completeMfaRecovery`.
  - Theo thiết kế backend (`backend/src/mfa/persistentMfaService.ts:850-875`), phương thức `completeRecovery` kiểm tra điều kiện trạng thái; khi request đã ở trạng thái `COMPLETED`, backend ném ngoại lệ `conflictWithCode("MFA_RECOVERY_ALREADY_COMPLETED", "MFA recovery request has already been completed.")` với mã HTTP **409 Conflict**.
  - Ở phiên bản trước, client bắt mọi lỗi ném ra và hiển thị lên UI, khiến người dùng bị kẹt hoàn toàn tại Bước 2 dù backend đã ở trạng thái sẵn sàng cho bước đăng ký factor mới (`beginRecoveryTotpEnrollment` độc lập xác thực rằng request có `status === "COMPLETED"`).

### 3.2. Quyết định kỹ thuật
1. **Tiếp tục tiến trình cụ thể (Narrow Client Continuation):**
   - Bọc lệnh gọi `completeMfaRecovery(recoveryToken, deviceOptions)` trong khối `try / catch`.
   - Bắt lỗi ngoại lệ: nếu `completeError instanceof ApiError && completeError.status === 409 && completeError.code === "MFA_RECOVERY_ALREADY_COMPLETED"`, client coi như bước hoàn tất đã thành công và bỏ qua lỗi, tiến thẳng tới `beginRecoveryTotpEnrollment`.
   - Bất kỳ lỗi nào khác (401 Unauthorized do token hết hạn, 400 Bad Request, lỗi mạng, hoặc lỗi 409 có mã lỗi khác) được ném lại (`throw completeError`) để hiển thị thông báo lỗi phù hợp trên màn hình như cũ.
2. **Không tự động retry ngầm định (Explicit User Action):**
   - Giữ nguyên nút bấm do người dùng chủ động kích hoạt. Trạng thái `isSubmitting` bảo vệ chống double-click trong lúc request đang gửi đi.
3. **Bảo tồn thiết kế bảo mật của M03-04 và M03-06:**
   - Sau khi hoàn thành đăng ký và xác nhận mã TOTP mới (`confirmRecoveryTotpEnrollment`), hiển thị 10 mã khôi phục mới tại chỗ, không chuyển hướng ngay, chỉ chuyển hướng về `LoginScreen` khi người dùng bấm xác nhận đã lưu mã.

---

## 4. Chi tiết thay đổi mã nguồn

### 4.1. `mobile-app/src/features/auth/screens/MfaRecoveryScreen.tsx`
- **Thay đổi trong `handleApprove`:**
  ```typescript
  async function handleApprove() {
    if (!recoveryToken) return;
    setIsSubmitting(true);
    setError(null);
    try {
      try {
        await completeMfaRecovery(recoveryToken, { deviceId });
      } catch (completeError) {
        // Nếu completeMfaRecovery đã hoàn tất trước đó trên server (ví dụ mạng bị gián đoạn ở lần bấm trước),
        // backend trả về 409 MFA_RECOVERY_ALREADY_COMPLETED. Ta tiếp tục gọi beginRecoveryTotpEnrollment.
        const isAlreadyCompleted =
          completeError instanceof ApiError &&
          completeError.status === 409 &&
          completeError.code === "MFA_RECOVERY_ALREADY_COMPLETED";

        if (!isAlreadyCompleted) {
          throw completeError;
        }
      }

      const res = await beginRecoveryTotpEnrollment({ recoveryToken }, { deviceId });
      setEnrollment(res);
    } catch (e) {
      setError(getErrorMessage(e, "Không thể bắt đầu tạo Authenticator mới."));
    } finally {
      setIsSubmitting(false);
    }
  }
  ```

### 4.2. `mobile-app/src/features/auth/screens/__tests__/MfaRecoveryScreen.test.tsx`
- Bổ sung nhóm kiểm thử `Resume recovery enrollment after completion (M03-10)`:
  1. `tiếp tục begin enrollment khi complete trả về 409 MFA_RECOVERY_ALREADY_COMPLETED`: Giả lập `completeMfaRecovery` ném `ApiError(409, "MFA_RECOVERY_ALREADY_COMPLETED")`. Xác minh client vẫn gọi `beginRecoveryTotpEnrollment` với đúng `recoveryToken` và chuyển sang Bước 3 hiển thị trường nhập TOTP.
  2. `cho phép người dùng thử lại khi begin enrollment thất bại và lần bấm lại nhận 409 already-completed`: Giả lập lần 1 `complete` thành công nhưng `begin` bị lỗi mạng. Màn hình vẫn ở Bước 2. Người dùng bấm lại, lần này `complete` trả về 409 `MFA_RECOVERY_ALREADY_COMPLETED`, `begin` thành công và chuyển sang Bước 3.
  3. `không gọi begin enrollment khi complete gặp lỗi khác (401, network, hoặc 409 code khác)`: Giả lập `completeMfaRecovery` trả về 401 `UNAUTHORIZED`. Xác minh client KHÔNG gọi `beginRecoveryTotpEnrollment` và hiển thị thông báo lỗi tương ứng.

---

## 5. Kết quả kiểm chứng và Quality Gates

1. **Targeted Unit Tests (`MfaRecoveryScreen.test.tsx`):**
   - Lệnh: `npm test -- src/features/auth/screens/__tests__/MfaRecoveryScreen.test.tsx`
   - Kết quả: **PASS 7/7 tests passed** (4 tests M03-04 cũ + 3 tests M03-10 mới).
2. **TypeScript Typecheck:**
   - Lệnh: `npm run typecheck`
   - Kết quả: **PASS** (`Expo Router types generated`, `tsc --noEmit` exit code 0).
3. **ESLint:**
   - Lệnh: `npm run lint`
   - Kết quả: **PASS** (`expo lint` exit code 0, không có lỗi hay warning).
4. **Full Mobile Unit Tests:**
   - Lệnh: `npm test`
   - Kết quả: **PASS 54/54 test suites, 408/408 tests passed** (100% pass, không có hồi quy).
5. **Git Whitespace & Formatting Check:**
   - Lệnh: `git diff --check`
   - Kết quả: **PASS** (exit code 0, không có trailing whitespace hay conflict markers).

---

## 6. Tuyên bố chuẩn hóa về Giới hạn kỹ thuật và Bảo lưu (Limitations & Standardized Claims)

1. **Ranh giới Bằng chứng và Trạng thái Kiểm thử:**
   - Các kết quả kiểm thử trong báo cáo là các component/unit test sử dụng mock (`jest.mock`), xác nhận luồng component state, bắt lỗi cụ thể và phân nhánh logic tại client.
   - HTTP integration test trực tiếp với backend server và database PostgreSQL disposable chưa được chạy trong phiên này (thuộc ranh giới ngoài allowlist).
   - Chưa chạy kiểm thử trên Android emulator hoặc thiết bị vật lý thật; việc kiểm tra cú pháp và kiểu dữ liệu được đảm bảo qua TypeScript và ESLint.
   - Sơ đồ tương tác (Mermaid diagram) và hướng dẫn kiểm tra thủ công là tài liệu đặc tả thiết kế, không phải runtime trace trích xuất từ thiết bị.
2. **Nguyên tắc "Tiếp tục tiến trình cụ thể" (Specific Continuation, Not Universal Idempotency):**
   - Bản sửa đổi này **chỉ** giải quyết tình huống bị ngắt quãng giữa hai bước `completeMfaRecovery` và `beginRecoveryTotpEnrollment` khi request đã `COMPLETED` trên server và `recoveryToken` còn hạn trong bộ nhớ component.
   - Bản sửa này **không** làm cho toàn bộ quy trình MFA Recovery trở nên idempotent từ đầu đến cuối.
3. **Các vấn đề tồn đọng chưa được giải quyết (Open Questions & Risks Left Unaddressed):**
   - **Độ lệch TTL và Cooldown:** Mặc định hệ thống có thể cấu hình cooldown dài hơn (ví dụ 24 giờ) so với thời gian sống của token khôi phục (`recoveryToken` có TTL 15 phút). Nếu token hết hạn trong thời gian chờ cooldown, người dùng không thể hoàn tất recovery mà phải chờ hết cooldown mới có thể yêu cầu trợ giúp.
   - **Mất token ở các bước khác:** Nếu ứng dụng bị tắt/crash hoàn toàn trước khi tới bước lưu recovery codes mới, `recoveryToken` nằm trong bộ nhớ RAM sẽ bị mất. Mã recovery cũ đã bị hash và vô hiệu hóa một chiều, do đó khách hàng không thể tự phục hồi lại nếu không có kênh hỗ trợ.
   - **Chưa có quy trình khôi phục qua hỗ trợ (Support/Admin Fallback):** Hệ thống tham chiếu hiện chưa hoàn thiện luồng khiếu nại/xác minh danh tính qua tổng đài viên hoặc chi nhánh khi khách hàng mất cả Authenticator lẫn Recovery Codes.
4. **Phạm vi bảo lưu của Use Case UC-M03:**
   - *SMS OTP* và *Passkey* tiếp tục bị loại trừ khỏi backlog UC-M03.
   - UC-M03 tiếp tục ở trạng thái **INCOMPLETE** do các hạng mục đồng bộ OpenAPI draft/runtime và rà soát toàn diện kênh khôi phục tài khoản vẫn đang chờ quyết định kiến trúc cấp hệ thống.

---

## 7. Hướng dẫn kiểm thử thủ công (Manual Verification Flow)

1. **Điều kiện ban đầu:**
   - Chuẩn bị một tài khoản có MFA TOTP đang hoạt động (`ACTIVE`) và đã có sẵn một mã Recovery Code hợp lệ.
2. **Kịch bản kiểm thử: Bị gián đoạn sau khi complete thành công:**
   - Truy cập màn hình Khôi phục MFA (`/mfa-recovery`).
   - Nhập email, mật khẩu và recovery code hợp lệ -> Bấm *"Bắt đầu khôi phục"*.
   - Chờ hết thời gian cooldown (trong môi trường sandbox/test thường được thiết lập ngắn hoặc đã qua).
   - Tại Bước 2, bật chế độ Network Throttling hoặc ngắt kết nối ngay sau khi request `complete-recovery` được gửi đi (hoặc dùng HTTP proxy chặn response).
   - Backend đã chuyển trạng thái request thành `COMPLETED`, nhưng client báo lỗi mạng.
   - Bật lại kết nối mạng -> Người dùng bấm lại *"Tiếp tục đăng ký Authenticator"*.
   - **Hành vi mong muốn:** Client gửi lại request, nhận HTTP 409 `MFA_RECOVERY_ALREADY_COMPLETED`, tự động chuyển sang Bước 3 hiển thị mã QR và trường nhập TOTP thay vì báo lỗi kẹt tại màn hình cooldown.
   - Nhập mã TOTP từ Authenticator app mới -> Bấm kích hoạt -> 10 mã khôi phục mới xuất hiện trên màn hình.
   - Bấm xác nhận đã lưu -> Điều hướng về màn hình `LoginScreen`.

---

## 8. Trạng thái kết luận

- **Task M03-10:** `COMPLETED — VERIFIED` (triển khai xử lý 409 ALREADY_COMPLETED để tiếp tục enrollment, kiểm chứng 100% quality gates và regression tests).
- **Use Case UC-M03:** `INCOMPLETE` (bảo lưu các vấn đề kiến trúc recovery TTL/cooldown và OpenAPI contract sync).
- **Working Tree:** Đúng 3 files thay đổi/tạo mới trong allowlist, working tree sạch lỗi định dạng, sẵn sàng cho Owner review.

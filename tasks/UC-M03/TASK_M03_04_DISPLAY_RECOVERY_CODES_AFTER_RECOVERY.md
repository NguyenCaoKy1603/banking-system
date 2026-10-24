# TASK M03-04 — Display Recovery Codes After MFA Recovery

> **Trạng thái nhiệm vụ:** COMPLETED — VERIFIED.
>
> **Trạng thái Use Case UC-M03:** INCOMPLETE.
>
> Ngày thực hiện: 2026-09-08.
>
> Phân hệ: Mobile App & Client Security / Thành viên 2.
>
> Mục tiêu: Sau khi hoàn tất xác nhận Authenticator mới trong luồng khôi phục MFA (`MfaRecoveryScreen`), nhận và hiển thị danh sách 10 mã khôi phục mới trong component state; yêu cầu người dùng chủ động bấm xác nhận đã lưu mã an toàn trước khi điều hướng về trang Đăng nhập (`/login`).

---

## 1. Thông tin dự án và quyền truy cập

- **Tên dự án:** Banking System
- **Vị trí Windows:** `C:\Projects\banking-system`
- **Repository root thực tế:** `C:\Projects\banking-system`
- **Quyền truy cập:** Codex được mở tại repository root của local project.
- **Xác nhận Preflight:**
  - CWD: `C:\Projects\banking-system`
  - Git branch: `codex/staging-academic-completion`
  - Git HEAD nền: `0edc874334a5797aa0c72b765d014ee9b239796e` (commit M03-02)
  - Git status: Index sạch, working tree sạch trước khi bắt đầu nhiệm vụ.
  - Ghi nhận lịch sử: Phiên M03-03 là audit read-only (`DIAGNOSE_AND_PLAN`), không có file/commit riêng và không tạo lịch sử commit giả.
- **Mục đích:** Dự án mobile banking academic/reference implementation dùng dữ liệu tổng hợp (synthetic) và tiền ảo, hướng tới kiểm thử local và phục vụ bảo vệ đồ án tốt nghiệp. Không phải hệ thống xử lý tiền thật, pilot đã xác minh hoặc production-ready.
- **Tài liệu đã đối soát:**
  - `AGENTS.md` và `mobile-app/AGENTS.md` (tuân thủ tài liệu Expo SDK 57)
  - `PROJECT_CONTEXT.md`
  - `USE_CASE_ROADMAP.md`
  - `TASK_TEMPLATE.md`
  - `mobile-app/README.md`
  - Báo cáo audit M03-03 và task M03-02

---

## 2. Chế độ làm việc và quyền Git

- **Chế độ làm việc:** `IMPLEMENT_AND_VERIFY` (sau đó chuẩn hóa tài liệu và lưu local checkpoint theo phê duyệt của Owner)
- **Ưu tiên:** `P1`
- **Quyền sửa đổi:** Chỉ trong danh sách allowlist được Owner phê duyệt:
  1. `mobile-app/src/features/auth/screens/MfaRecoveryScreen.tsx`
  2. `mobile-app/src/features/auth/screens/__tests__/MfaRecoveryScreen.test.tsx`
  3. `tasks/UC-M03/TASK_M03_04_DISPLAY_RECOVERY_CODES_AFTER_RECOVERY.md`
- **Vùng cấm:**
  - Không sửa `MfaMethodsScreen`, `AuthContext`, `authApi`, backend, OpenAPI, schema, dependency hoặc roadmap/context.
  - Không thêm clipboard, file export, SecureStore/AsyncStorage persistence, route params chứa mã, analytics hoặc log nhạy cảm.
  - Không tự đăng nhập hoặc cấp banking session.
  - Không bổ sung recovery restart, thay cooldown hay sửa đa factor.
- **Quyền Git:**
  - Stage chính xác 3 đường dẫn allowlist; không `git add .` hay stage cả thư mục.
  - Tạo đúng một local commit theo thông điệp được duyệt; không push, amend, rebase, merge hoặc tag.

---

## 3. Hiện trạng, nguyên nhân gốc và hành vi mong muốn

### 3.1. Hiện trạng và nguyên nhân gốc (Root Cause)
- **Hiện trạng trước sửa:** Trong `MfaRecoveryScreen.tsx`, hàm `handleConfirm()` sau khi gọi `await confirmRecoveryTotpEnrollment(...)` thành công đã lập tức thực thi `router.replace("/login")`.
- **Nguyên nhân:** Response từ backend (`TotpConfirmationResponse`) trả về đầy đủ `{ credentialId, status: "ACTIVE", recoveryCodes: string[] }` (10 mã khôi phục mới được sinh và băm lưu trong DB). Tuy nhiên, client bỏ qua hoàn toàn trường `response.recoveryCodes`, không lưu vào state và không hiển thị cho người dùng. Người dùng khôi phục xong nhưng không có mã khôi phục mới nào được ghi nhận.

### 3.2. Hành vi mong muốn (Observable Behavior)
1. Sau khi nhập đúng 6 chữ số TOTP và bấm xác nhận, màn hình không lập tức điều hướng về `/login`.
2. Giao diện chuyển sang thẻ "Lưu mã khôi phục mới", hiển thị danh sách 10 mã khôi phục mới với font monospace rõ ràng và thuộc tính `selectable`.
3. Hiển thị cảnh báo rõ ràng: *"Mã khôi phục chỉ hiển thị một lần duy nhất tại đây. Hãy ghi lại hoặc lưu trữ ngoại tuyến ở nơi an toàn. Sau khi rời khỏi bước này, bạn sẽ không thể xem lại các mã này từ ứng dụng."*
4. Cung cấp nút bấm chủ động: *"Tôi đã lưu mã — Đăng nhập lại"* (`testID="mfa-recovery-done"`). Nút xác nhận này là luồng thao tác chính để hoàn tất, tuy nhiên nếu người dùng chủ động rời màn hình (qua phím back hệ thống, cử chỉ back hoặc tắt app) thì mã khôi phục cũng sẽ mất do không có cơ chế persistence.
5. Khi người dùng bấm nút này, mã khôi phục được xóa khỏi component state (`setRecoveryCodes(null)`) và ứng dụng điều hướng về `/login`.
6. Toàn bộ thông tin nhạy cảm trước đó (`password`, `totpCode`, `recoveryToken`, `recoveryCode`, `enrollment`) được xóa khỏi component state ngay khi confirm thành công, ngăn ngừa gửi lại từ form cũ.
7. Nếu confirm thất bại (mã TOTP sai), không hiển thị mã khôi phục, không điều hướng, giữ nguyên form bước 3 kèm thông báo lỗi để người dùng có thể nhập lại và thử lại.

---

## 4. Luồng dữ liệu (Data Flow)

```
[User nhập 6 số TOTP] -> [handleConfirm]
       |
       v
[confirmRecoveryTotpEnrollment API]
       |
       +---> Thất bại (401/Network) -> [setError] -> Giữ form bước 3 để thử lại
       |
       +---> Thành công (200 OK trả về 10 recoveryCodes)
                 |
                 v
       [Xóa khỏi component state: password, totpCode, recoveryToken, enrollment, recoveryCode]
       [setRecoveryCodes(response.recoveryCodes)]
                 |
                 v
       [Render Thẻ Lưu Mã Khôi Phục (Selectable Monospace) + Cảnh báo]
                 |
                 v
       [User chủ động bấm "Tôi đã lưu mã — Đăng nhập lại"]
                 |
                 v
       [handleAcknowledgeRecoveryCodes]
                 |
                 +---> [setRecoveryCodes(null)] (Xóa khỏi component state)
                 +---> [router.replace("/login")] (Điều hướng về Login)
```

---

## 5. Kết quả thực thi và Bằng chứng Kiểm tra

### 5.1. Quality Gates đã thực thi trong phiên Implementation M03-04
1. **Targeted Screen Unit Tests:**
   - Lệnh: `npm test -- --runInBand src/features/auth/screens/__tests__/MfaRecoveryScreen.test.tsx` (trong `mobile-app/`)
   - Kết quả: **PASS 4/4 tests**, thời gian: 3.4s:
     - `✔ hiển thị 10 mã khôi phục mới và không điều hướng Login khi confirm thành công`
     - `✔ điều hướng về Login và dọn sạch recovery codes sau khi người dùng xác nhận đã lưu`
     - `✔ không hiển thị recovery codes và không điều hướng khi confirm thất bại, cho phép thử lại`
     - `✔ từ chối mã TOTP không đủ 6 chữ số trước khi gọi network`
2. **Mobile ESLint:**
   - Lệnh: `npm run lint` (trong `mobile-app/`)
   - Kết quả: **PASS** (`Exit code: 0`, 0 warnings, 0 errors).
3. **Mobile TypeScript Typecheck:**
   - Lệnh: `npm run typecheck` (trong `mobile-app/`)
   - Kết quả: **PASS** (`Expo Router types generated`, `tsc --noEmit` exit code 0).
4. **Full Mobile Unit Test Suite:**
   - Lệnh: `npm test -- --runInBand` (trong `mobile-app/`)
   - Kết quả: **PASS 52/52 test suites**, **383/383 tests passed**, 0 failed, thời gian: 22.2s.
5. **Git Whitespace & Formatting Check:**
   - Lệnh: `git diff --check`
   - Kết quả: **PASS** (`Exit code: 0`, không có lỗi khoảng trắng hay newline dư thừa).

### 5.2. Kiểm tra trong phiên Checkpoint Review
- Đối soát diff source và test suite: tuân thủ 100% allowlist, không có thay đổi ngoài phạm vi.
- Kiểm tra dữ liệu nhạy cảm: không có token, secret, recovery code, password nào bị log hay dump.
- Kiểm tra định dạng: `git diff --check` sạch. Không chạy lại test/build/Docker/emulator chỉ để phục vụ việc lưu checkpoint.

---

## 6. Giới hạn kỹ thuật và Phạm vi bảo lưu (Limitations & Gaps Preserved)

1. **Giới hạn Memory-only (Component State):**
   - Mã khôi phục chỉ tồn tại tạm thời trong React component state (`useState<string[] | null>`). Không có cơ chế an toàn cấp thấp xóa bộ nhớ RAM vật lý (không tuyên bố secure RAM erasure). Nếu ứng dụng bị hệ điều hành tắt, kill process, hoặc nếu người dùng điều hướng lùi ra khỏi màn hình (qua nút back hệ thống/cử chỉ), mã khôi phục sẽ mất hoàn toàn theo đúng nguyên tắc bảo mật (không lưu trữ plaintext vào SecureStore/AsyncStorage).
2. **Bằng chứng kiểm chứng ở mức Unit Component:**
   - Bằng chứng kiểm chứng hiện tại hoàn toàn ở tầng React Native component unit test (`react-test-renderer`). Chưa có bằng chứng kiểm thử trên Android emulator hay hành vi native gesture trên thiết bị thật.
3. **Các hạng mục bảo lưu cho các task sau:**
   - Không can thiệp vào `MfaMethodsScreen` hay vấn đề session revocation (giữ lại cho task riêng).
   - Không thay đổi thời gian cooldown hay expiry của recovery token.
   - OpenAPI contract alignment cho các endpoint MFA.

---

## 7. Trạng thái kết luận

- **Task M03-04:** `COMPLETED — VERIFIED` (toàn bộ acceptance criteria đạt, quality gates 100% xanh).
- **Use Case UC-M03:** `INCOMPLETE` (chờ các task tiếp theo xử lý session revocation trên `MfaMethodsScreen`, đa factor và OpenAPI contract).
- **Working Tree:** Giữ nguyên 2 file code/test và 1 file tài liệu, tiến hành commit checkpoint theo quyết định của Owner.

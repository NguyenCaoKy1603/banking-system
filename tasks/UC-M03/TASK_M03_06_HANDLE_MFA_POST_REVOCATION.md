# TASK M03-06 — Handle MFA Post-Revocation on Mobile

> **Trạng thái nhiệm vụ:** COMPLETED — VERIFIED.
>
> **Trạng thái Use Case UC-M03:** INCOMPLETE.
>
> Ngày thực hiện: 2026-09-08.
>
> Phân hệ: Mobile App & Client Security / Thành viên 2.
>
> Mục tiêu: Triển khai và kiểm chứng luồng post-revocation trên client mobile sau các thao tác quản lý phương thức MFA (`confirmTotpEnrollment`, `rotateRecoveryCodes`, `revokeMfaMethod`): vô hiệu hóa session local ngay lập tức mà không gọi logout/refresh network, chuyển giao danh sách mã khôi phục mới vào state memory-only của `AuthContext`, hiển thị thẻ lưu mã khôi phục tại `LoginScreen` với nút xác nhận chủ động của người dùng trước khi hiển thị form đăng nhập, chuẩn hóa contract bắt buộc trong `AuthContextValue`, và đồng bộ hóa thứ tự thao tác storage để ngăn việc clear storage cũ xóa mất session đăng nhập mới.

---

## 1. Thông tin dự án và quyền truy cập

- **Tên dự án:** Banking System
- **Vị trí Windows:** `C:\\Projects\\banking-system`
- **Repository root thực tế:** `C:\\Projects\\banking-system`
- **Quyền truy cập:** Codex được mở tại repository root của local project.
- **Xác nhận Preflight:**
  - CWD: `C:\\Projects\\banking-system`
  - Git branch: `codex/staging-academic-completion`
  - Git HEAD nền: `af70b4dd2462e0bdc10b4ab962c4da1610933ab8` (commit M03-04)
  - Git status: Index sạch trước khi bắt đầu nhiệm vụ M03-06.
  - Ghi nhận lịch sử: Nhiệm vụ M03-05 là audit và lập kế hoạch kỹ thuật read-only (`DIAGNOSE_AND_PLAN`), không có file/commit riêng và không tạo commit giả.
- **Mục đích:** Dự án mobile banking academic/reference implementation dùng dữ liệu tổng hợp (synthetic) và tiền ảo, phục vụ kiểm thử local và bảo vệ đồ án tốt nghiệp. Không phải hệ thống xử lý tiền thật, pilot đã xác minh hay production-ready.
- **Tài liệu đã đối soát:**
  - `AGENTS.md` và `mobile-app/AGENTS.md` (tuân thủ tài liệu Expo SDK 57)
  - `PROJECT_CONTEXT.md`
  - `USE_CASE_ROADMAP.md`
  - `TASK_TEMPLATE.md`
  - `mobile-app/README.md`
  - Báo cáo lập kế hoạch M03-05 và hồ sơ task M03-02, M03-04

---

## 2. Chế độ làm việc và quyền Git

- **Chế độ làm việc:** `IMPLEMENT_AND_VERIFY`
- **Ưu tiên:** `P1`
- **Quyền sửa đổi:** Trong danh sách allowlist mở rộng gồm đúng 10 files được Owner phê duyệt:
  1. `mobile-app/src/features/auth/context/AuthContext.tsx`
  2. `mobile-app/src/features/auth/screens/MfaMethodsScreen.tsx`
  3. `mobile-app/src/features/auth/screens/LoginScreen.tsx`
  4. `mobile-app/src/features/auth/context/__tests__/AuthContext.test.tsx`
  5. `mobile-app/src/features/auth/screens/__tests__/MfaMethodsScreen.test.tsx`
  6. `mobile-app/src/features/auth/screens/__tests__/LoginScreen.test.tsx`
  7. `tasks/UC-M03/TASK_M03_06_HANDLE_MFA_POST_REVOCATION.md`
  8. `mobile-app/src/features/auth/screens/__tests__/RegisterScreen.test.tsx` (chỉ cập nhật test mock AuthContext)
  9. `mobile-app/src/features/kyc/screens/__tests__/KycScreen.test.tsx` (chỉ cập nhật test mock AuthContext)
  10. `mobile-app/src/features/auth/screens/__tests__/MfaRecoveryScreen.test.tsx` (chỉ cập nhật test mock AuthContext)
- **Vùng cấm:**
  - Không sửa backend, schema, database migration, backend business logic, backend session revocation.
  - Không sửa route guards toàn cục (`RootLayout`, `_layout.tsx`), không thêm route trung gian.
  - Không sửa OpenAPI draft hoặc contract HTTP.
  - Không sửa logic nghiệp vụ hoặc assertions trong 3 file test mock bổ sung.
  - Không đưa recovery codes vào clipboard API, URL parameters, SecureStore, AsyncStorage, file hệ thống, console log hay analytics.
- **Quyền Git:**
  - Không tự ý `git add`, `git commit`, `git push`, merge hay rebase khi chưa có lệnh review và commit từ Owner.

---

## 3. Hiện trạng, nguyên nhân gốc và hành vi sau triển khai

### 3.1. Hiện trạng và nguyên nhân gốc (Root Cause)
1. **Lỗi 401 Cascade khi Reload Session đã bị thu hồi:**
   - Backend gọi `revokeAllUserSessions` sau mọi thao tác MFA làm thay đổi cấu hình bảo mật. Client cũ gọi `await loadCredentials()` trên token đã thu hồi, kích hoạt 401 cascade và refresh lỗi, khiến `recoveryCodes` mới bị unmount thất thoát khỏi giao diện.
2. **Contract thiếu tính ràng buộc bắt buộc:**
   - Ban đầu `completeMfaRevocation` và `clearPendingRecoveryCodes` được để `optional` (`?`) để tránh cập nhật các test mock bên ngoài allowlist. Điều này dẫn tới việc sử dụng optional chaining (`?.`) tại màn hình, có thể bỏ qua bước chuyển giao và vô hiệu hóa session trong runtime nếu mock thiếu.
3. **Storage/Lifecycle Race Condition giữa Revocation và Đăng nhập mới:**
   - `clearAuthSession()` trong `completeMfaRevocation` chạy bất đồng bộ trên persistent storage (SecureStore/AsyncStorage). Nếu người dùng lập tức đăng nhập lại (`login`) trước khi thao tác xóa hoàn tất:
     - Lệnh `saveAuthSession(nextSession)` có thể hoàn tất trước, và sau đó `clearAuthSession()` cũ hoàn thành muộn sẽ xóa mất session mới trong persistent storage.
     - Hàm `login` không tăng epoch vòng đời session (`sessionLifecycleEpochRef`), khiến `completeMfaRevocation` sau khi xóa storage muộn vẫn tưởng epoch hợp lệ và ghi đè thông báo đăng xuất (`logoutNotice`) lên phiên mới vừa đăng nhập.

### 3.2. Giải pháp kỹ thuật và hành vi sau triển khai (Observable Behavior)
1. **Chuẩn hóa Contract bắt buộc trong `AuthContextValue`:**
   - `pendingRecoveryCodes: string[] | null`
   - `completeMfaRevocation: (input?: CompleteMfaRevocationInput) => Promise<void>`
   - `clearPendingRecoveryCodes: () => void`
   - Bỏ hoàn toàn optional chaining (`?.`) tại `MfaMethodsScreen.tsx` và `LoginScreen.tsx`. Cập nhật mock tại `RegisterScreen.test.tsx`, `KycScreen.test.tsx`, `MfaRecoveryScreen.test.tsx`.
2. **Đồng bộ hóa thứ tự Storage (Deterministic Storage Ordering):**
   - Bổ sung ref `pendingStorageClearRef = useRef<Promise<void> | null>(null)` để theo dõi thao tác dọn dẹp storage của revocation / logout.
   - Thao tác xóa storage được bọc trong async IIFE để bắt an toàn cả lỗi đồng bộ lẫn bất đồng bộ.
   - Khi `login` được gọi:
     - Tăng ngay `sessionLifecycleEpochRef.current += 1`, vô hiệu hóa ngay tức thì mọi hậu xử lý (notice, state) của lifecycle cũ.
     - Nếu `pendingStorageClearRef.current` đang tồn tại, `login` chờ promise này giải quyết xong (`await pendingStorageClearRef.current.catch(() => undefined)`) trước khi tiến hành lưu session mới vào storage (`saveAuthSession`).
     - Đảm bảo `clearAuthSession()` cũ không bao giờ xóa nhầm session mới.
3. **Bảo tồn Recovery Codes chuyển giao sang LoginScreen:**
   - Trong `MfaMethodsScreen.tsx`, dọn sạch input/challenge nhạy cảm và gọi `await completeMfaRevocation({ recoveryCodes: response.recoveryCodes })`.
   - Route guard chuyển hướng về `/login` do `status === "anonymous"`.
4. **Hiển thị Thẻ Khôi Phục Memory-Only tại LoginScreen:**
   - Khi có `pendingRecoveryCodes`, ẩn toàn bộ form đăng nhập và links phụ.
   - Hiển thị 10 mã monospace, selectable kèm cảnh báo bộ nhớ tạm.
   - Nút *"Tôi đã lưu mã — Đăng nhập lại"* (`testID="mfa-recovery-codes-acknowledge"`) gọi `clearPendingRecoveryCodes()`, dọn sạch mã khỏi RAM và hiển thị lại form đăng nhập.
5. **Thông báo Đăng nhập lại khi Gỡ bỏ Authenticator:**
   - Khi gỡ bỏ Authenticator, gọi `await completeMfaRevocation({ notice: "Phương thức Authenticator đã được thu hồi. Vui lòng đăng nhập lại." })`. `LoginScreen` hiển thị thông báo đăng xuất chuẩn xác.

---

## 4. Luồng dữ liệu (Data Flow)

```
[MfaMethodsScreen]
       |
       +---> [confirmTotpEnrollment / rotateRecoveryCodes API: 200 OK trả về recoveryCodes]
       |     Hoặc [revokeMfaMethod API: 204 No Content]
       |
       v
[MfaMethodsScreen: Dọn sạch input/challenge nhạy cảm trong local state]
       |
       v
[AuthContext.completeMfaRevocation({ recoveryCodes, notice })]
       |
       +---> 1. Tăng sessionLifecycleEpochRef (+1) để đánh dấu epoch mới
       +---> 2. Set memory state: status = "anonymous", session = null
       +---> 3. Lưu pendingRecoveryCodes = recoveryCodes
       +---> 4. Bắt đầu clearAuthSession(), lưu vào pendingStorageClearRef
       |
       v
[Root Route Guard phát hiện status === "anonymous" -> Điều hướng /login]
       |
       v
[LoginScreen: Hiển thị thẻ recoveryCodes hoặc form đăng nhập]
       |
       +---> User bấm Đăng nhập mới -> Gọi login()
                 |
                 +---> 1. sessionLifecycleEpochRef.current += 1 (vô hiệu hóa hậu xử lý của revocation cũ)
                 +---> 2. Await pendingStorageClearRef (chờ clear cũ settle hoàn tất)
                 +---> 3. Gửi loginRequest -> Nhận session mới
                 +---> 4. saveAuthSession(nextSession) (Lưu an toàn sau khi clear cũ đã xong)
                 +---> 5. setActiveSession(nextSession, "authenticated")
```

---

## 5. Kết quả thực thi và Bằng chứng Kiểm tra

### 5.1. Bằng chứng Thực nghiệm Red/Green cho Storage Race
1. **Pha Red (Tái hiện lỗi với Deferred Promise):**
   - Xây dựng 2 regression tests trong `AuthContext.test.tsx` dùng `createDeferred<void>()` điều khiển thời điểm settle của `clearAuthSessionMock`:
     - Test A: `pending storage clear from MFA revocation settles before new login saves session` -> **FAILED**: `loginDone` kết thúc sớm trước khi clear settle, dẫn tới `saveAuthSessionMock` bị gọi trước khi clear hoàn tất và storage bị xóa mất session mới.
     - Test B: `rejected storage clear from MFA revocation does not crash new login or overwrite lifecycle notice` -> **FAILED**: `getAuth().logoutNotice` nhận thông báo lỗi storage của phiên cũ đè lên phiên mới vừa đăng nhập.
2. **Pha Green (Sau khi thiết lập thứ tự và epoch trong login):**
   - Test A: **PASSED (17 ms)** — `login` chờ `deferredClear` settle, session mới được lưu an toàn (`simulatedStorage?.accessToken === "new-access-token"`), `logoutNotice === null`.
   - Test B: **PASSED (14 ms)** — `clear` reject không làm sập `login`, session mới lưu thành công, thông báo lỗi của phiên cũ không ghi đè lên phiên mới.

### 5.2. Kết quả Quality Gates
1. **Targeted Unit Tests:**
   - Lệnh: `npm test -- src/features/auth/context/__tests__/AuthContext.test.tsx src/features/auth/screens/__tests__/MfaMethodsScreen.test.tsx src/features/auth/screens/__tests__/LoginScreen.test.tsx`
   - Kết quả: **PASS 3/3 suites (27/27 tests)**.
2. **Updated Mock Tests:**
   - Lệnh: `npm test -- src/features/auth/screens/__tests__/RegisterScreen.test.tsx src/features/kyc/screens/__tests__/KycScreen.test.tsx src/features/auth/screens/__tests__/MfaRecoveryScreen.test.tsx`
   - Kết quả: **PASS 3/3 suites (61/61 tests)**.
3. **TypeScript Typecheck:**
   - Lệnh: `npm run typecheck` (trong `mobile-app/`)
   - Kết quả: **PASS** (`Expo Router types generated`, `tsc --noEmit` exit code 0).
4. **ESLint:**
   - Lệnh: `npm run lint` (trong `mobile-app/`)
   - Kết quả: **PASS** (`expo lint` exit code 0).
5. **OpenAPI Draft Validation:**
   - Lệnh: `npm run validate:openapi` (trong `mobile-app/`)
   - Kết quả: **PASS** (46 required paths hợp lệ).
6. **Maestro E2E Syntax Validation:**
   - Lệnh: `npm run validate:e2e` (trong `mobile-app/`)
   - Kết quả: **PASS** (19 flows valid về cú pháp).
7. **Full Mobile Unit Test Suite:**
   - Lệnh: `npm test` (trong `mobile-app/`)
   - Kết quả: **PASS 54/54 test suites**, **398/398 tests passed**, 0 failures (thời gian: 12.3s).
8. **Git Formatting Check:**
   - Lệnh: `git diff --check`
   - Kết quả: **PASS** (exit code 0, không có lỗi định dạng hay khoảng trắng thừa).

---

## 6. Giới hạn kỹ thuật và Bảo lưu (Limitations & Standardized Claims)

1. **Ranh giới của Epoch Invalidation:**
   - `sessionLifecycleEpochRef` và `invalidatedSessionEpochsRef` là cơ chế kiểm soát logic tại client để bỏ qua (ignore) kết quả trả về muộn từ các callback cũ. Cơ chế này **không hủy được network request HTTP** hoặc promise đang bay ở tầng socket/driver.
2. **Giới hạn Memory-only vs Secure RAM Erasure:**
   - Các mã khôi phục `pendingRecoveryCodes` chỉ tồn tại trong React state của `AuthContext` (`useState<string[] | null>`).
   - Việc xóa khỏi React state (`clearPendingRecoveryCodes`) hay cơ chế Garbage Collection của JavaScript engine **không chứng minh và không tuyên bố dữ liệu trong physical RAM vật lý đã được ghi đè an toàn (zeroed)**.
3. **Bản chất của E2E Validation:**
   - Lệnh `npm run validate:e2e` là công cụ kiểm tra tính hợp lệ về cú pháp (syntax validation) của các kịch bản Maestro YAML, **không phải** bằng chứng kiểm thử đạt chuẩn (PASS) trên Android emulator hay thiết bị thật.
4. **Phạm vi bảo lưu của Use Case UC-M03:**
   - Các phương thức *SMS OTP* và *Passkey* không thuộc phạm vi backlog đồ án tốt nghiệp của UC-M03 đã được Owner phê duyệt và bị loại trừ khỏi phạm vi.
   - Các hạng mục bảo lưu thực sự của UC-M03 bao gồm:
     a) Thêm-factor step-up challenge binding.
     b) Luồng restart và cooldown của recovery.
     c) Thống nhất contract giữa OpenAPI draft và backend runtime implementation.
     d) Khoảng trống kiểm thử HTTP integration boundary (cần đánh giá trong kế hoạch, chưa tự động mở rộng thành nhiệm vụ bắt buộc).
5. **Ranh giới Bảo đảm Thứ tự Storage:**
   - Cơ chế `pendingStorageClearRef` bảo đảm tính tuần tự cho các kịch bản interleaving đã kiểm thử (revocation clear đang chờ trong khi login mới diễn ra). Không tuyên bố loại bỏ tuyệt đối mọi storage race condition trong các môi trường đa tiến trình tùy ý.
6. **Ranh giới của Required Types:**
   - Việc chuyển đổi sang `required` trong `AuthContextValue` giúp kiểm soát contract tại thời điểm compile-time của TypeScript và loại bỏ rủi ro silent no-op từ optional chaining; điều này không đồng nghĩa bảo đảm mọi thao tác I/O hay network ở runtime luôn luôn thành công.
7. **Nguồn gốc Kết quả Kiểm thử:**
   - Các kết quả kiểm thử trong báo cáo được ghi nhận từ phiên implementation M03-06 đã chạy hoàn tất trước đó; phiên checkpoint hiện tại tuân thủ nghiêm ngặt nguyên tắc không chạy lại test/build/Docker/emulator chỉ để lưu checkpoint.

---

## 7. Trạng thái kết luận

- **Task M03-06:** `COMPLETED — VERIFIED` (toàn bộ 3 mục tiêu đã hoàn tất: contract bắt buộc chuẩn hóa, race condition storage được ngăn chặn và chứng minh bằng red/green tests, quality gates 100% xanh).
- **Use Case UC-M03:** `INCOMPLETE` (bảo lưu step-up challenge binding, recovery restart và OpenAPI alignment cho các task tiếp theo).
- **Working Tree:** Gồm 7 file sửa đổi và 3 file tạo mới đúng theo allowlist mở rộng 10 files, sẵn sàng chờ Owner review lưu local checkpoint.

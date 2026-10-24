# TASK ĐỢT 1 — HOÀN TẤT AUTHENTICATION/MFA CHO ĐỒ ÁN TỐT NGHIỆP

## 1. Thông tin dự án và quyền truy cập

- Tên dự án: Banking System
- Vị trí Windows: `C:\Projects\banking-system`
- Repository root thực tế: `C:\Projects\banking-system`
- Cách đã cấp quyền truy cập: Local project đã được mở trực tiếp.
- Xác nhận preflight:
  - Branch: `codex/staging-academic-completion`
  - HEAD baseline: `382906d94c53d0617821573403f52e413aea465d`
- Mục đích: Hệ thống ngân hàng tham chiếu/academic phục vụ đồ án tốt nghiệp, sử dụng dữ liệu tổng hợp (synthetic data) và tiền ảo; không phải hệ thống xử lý tiền thật, pilot đã xác minh hoặc production banking.
- Tài liệu liên quan:
  - `AGENTS.md`, `PROJECT_CONTEXT.md`, `USE_CASE_ROADMAP.md`
  - `backend/README.md`, `mobile-app/README.md`
  - Chuỗi task UC-M03: `TASK_M03_02`, `TASK_M03_04`, `TASK_M03_06`, `TASK_M03_08`, `TASK_M03_10`.

## 2. Chế độ làm việc và quyền Git

- Chế độ làm việc: `IMPLEMENT_AND_VERIFY`
- Quyền sửa code: Chỉ được sửa các file thuộc allowlist cho phép của Authentication/MFA. Không sửa schema/migration database, backend router ngoài allowlist, hay hạ guard bảo mật.
- Git add/stage: Không
- Commit: Không
- Push: Không
- Merge/rebase/tag: Không
- Quyền ngoài repository: Không network/dịch vụ bên thứ ba; chỉ sử dụng container PostgreSQL disposable ngắn hạn được tự động dọn dẹp để phục vụ kiểm thử integration.
- Bảo toàn WIP: Bảo toàn các thay đổi WIP của M03-10 trên `MfaRecoveryScreen.tsx` và regression test liên quan.

## 3. Nhiệm vụ lần này

- Tên nhiệm vụ: Đợt 1 — Hoàn tất Authentication/MFA cho đồ án tốt nghiệp
- Mục tiêu:
  1. Khắc phục dứt điểm lỗi TTL của MFA recovery request trong `PersistentMfaService`.
  2. Khắc phục lỗi binding AAD context mã hóa TOTP secret trong `beginRecoveryTotpEnrollment`, đảm bảo credential sau phục hồi sử dụng được bình thường cho mọi thử thách xác thực/step-up.
  3. Bổ sung endpoint `POST /auth/mfa/recovery-codes/rotate` và các mã lỗi 409 vào OpenAPI contract `documents/api/banking-mvp.openapi.yaml`.
  4. Kế thừa và kiểm chứng cơ chế client continuation của M03-10 khi backend đã hoàn tất phục hồi (409 `MFA_RECOVERY_ALREADY_COMPLETED`).
  5. Thiết lập suite regression tests kiểm tra mọi mốc thời gian TTL và thực hiện demo HTTP lifecycle hoàn chỉnh với cơ sở dữ liệu quan hệ PostgreSQL thật.
- Ưu tiên: `P1`
- Lý do ưu tiên: Đảm bảo luồng đăng nhập, MFA TOTP, step-up và recovery hoạt động ổn định, đúng contract để phục vụ demo và báo cáo đồ án tốt nghiệp mà không phát sinh regression sang UC-M01/UC-M02.

## 4. Hiện trạng, nguyên nhân gốc và giải pháp

### A. Lỗi TTL của MFA Recovery Request
- Hiện trạng: Khi người dùng bắt đầu recovery bằng recovery code, service tạo request với `expiresAt = now + 15m`, trong khi thời gian cooldown mặc định là 24 giờ (`cooldownUntil = now + 24h`). Khi cooldown kết thúc, request đã hết hạn trước đó 23 giờ 45 phút, dẫn đến việc người dùng không bao giờ có thể hoàn tất quy trình phục hồi MFA.
- Nguyên nhân gốc: Công thức tính hạn trong `verifyRecoveryCode` không tính đến khoảng thời gian chờ cooldown.
- Giải pháp:
  - Chuẩn hóa công thức: `expiresAt = new Date(cooldownUntil.getTime() + RECOVERY_REQUEST_TTL_MS)` (cooldownUntil + 15 phút).
  - Tách bạch rõ ràng kiểm tra hết hạn (trả về 401 `UNAUTHORIZED`) và kiểm tra đang trong thời gian chờ cooldown (trả về 409 `MFA_RECOVERY_COOLDOWN`).

### B. Lỗi AAD Encryption Context trong Recovery Enrollment
- Hiện trạng: Credential tạo qua recovery enrollment không thể sử dụng để xác thực thử thách (step-up, rotate recovery codes) sau khi kích hoạt; ném lỗi `Error: MFA ciphertext context is invalid`.
- Nguyên nhân gốc: Trong `beginRecoveryTotpEnrollment`, secret được mã hóa trước khi truy vấn thông tin recovery request nên dùng chuỗi tạm `"recovery"` làm AAD context (`this.encryptionContext("mfa-totp", credentialId, "recovery")`). Trong khi đó, `verifyChallenge` luôn giải mã bằng `customerId`.
- Giải pháp: Đưa bước mã hóa vào bên trong transaction sau khi đã lấy được `customerId` từ recovery request đã khóa; mã hóa và giải mã nhất quán bằng `customerId`.

### C. Thiếu hụt và không đồng bộ trong OpenAPI Contract
- Bổ sung định nghĩa endpoint `POST /auth/mfa/recovery-codes/rotate` (operationId: `rotateRecoveryCodes`, summary, requestBody, 200, 400, 401).
- Bổ sung schema `RecoveryCodesRotateRequest` và `RecoveryCodesRotateResponse`.
- Bổ sung mã phản hồi 409 Conflict cho `POST /auth/mfa/recover/complete` với 2 mã lỗi: `MFA_RECOVERY_COOLDOWN` và `MFA_RECOVERY_ALREADY_COMPLETED`.
- Chuẩn hóa schema `RecoveryStartedResponse`: `required: [status, recoveryRequestId, recoveryToken, cooldownUntil]`.
- Bổ sung tài liệu thu hồi toàn bộ session khách hàng khi xác nhận factor, đổi factor, xoay recovery codes, hoặc bắt đầu recovery.

### D. Kế thừa cơ chế Client Continuation (M03-10)
- Giữ nguyên luồng xử lý trên Mobile `MfaRecoveryScreen.tsx`: Khi gọi `completeMfaRecovery` nhận về 409 `MFA_RECOVERY_ALREADY_COMPLETED`, màn hình không bị kẹt ở trạng thái lỗi mà cho phép tiếp tục chuyển sang bước thiết lập Authenticator mới với `recoveryToken` hiện tại.

## 5. Bằng chứng kiểm thử (Evidence)

### A. Kiểm thử đơn vị và hồi quy (Unit & Regression Tests)
- `backend/src/tests/mfaPersistence.test.ts`:
  - Thêm test case kiểm tra toàn diện 5 mốc thời gian với clock giả lập có thể điều khiển:
    1. Trước khi cooldown kết thúc: ném 409 `MFA_RECOVERY_COOLDOWN`.
    2. Tại đúng thời điểm `cooldownUntil`: hoàn tất thành công (202).
    3. Tại thời điểm `expiresAt` và sau đó: từ chối với 401 `UNAUTHORIZED`.
    4. Cấu hình cooldown = 0 hoặc ngắn: vẫn duy trì cửa sổ 15 phút hợp lệ.
    5. Request không bị hết hạn trước khi cooldown kết thúc.
  - Kết quả: **PASS** toàn bộ.

### B. Kiểm thử tích hợp cơ sở dữ liệu quan hệ (Disposable PostgreSQL)
- Lệnh: `npm run test:mfa:persistence` chạy trên container PostgreSQL 16 disposable.
- Áp dụng đầy đủ 40 migrations (từ `001_banking_mvp` đến `040_card_security_and_suspense_retry`).
- Kết quả: **PASS 4/4 tests** (14.39s), container được dừng và xóa sạch bằng `-v`.

### C. Kịch bản HTTP Lifecycle Demo hoàn chỉnh (End-to-End)
- Thực thi script `demo_mfa_http_lifecycle.mjs` trên runtime HTTP persistent với PostgreSQL:
  1. Đăng ký tài khoản và đăng nhập password-only thành công.
  2. Thiết lập factor TOTP 1 -> nhận 10 mã khôi phục -> xác minh thu hồi session cũ (401).
  3. Đăng nhập lại -> cố gắng thêm factor 2 trực tiếp (bị chặn 409 `MFA_CURRENT_FACTOR_REQUIRED`) -> tạo thử thách `MFA_FACTOR_CHANGE` -> thêm factor 2 kèm bằng chứng step-up -> xác nhận thành công.
  4. Cố gắng xóa factor 1 không kèm step-up (bị chặn 409 `MFA_CURRENT_FACTOR_REQUIRED`) -> tạo thử thách `MFA_FACTOR_REMOVAL` -> xóa factor 1 thành công (204) -> factor 2 vẫn duy trì ACTIVE.
  5. Bắt đầu recovery bằng mã khôi phục -> nhận `recoveryToken` với cooldown 24h -> gọi complete sớm (bị chặn 409 `MFA_RECOVERY_COOLDOWN`) -> tua thời gian đến `cooldownUntil` -> complete thành công (202) -> gọi complete lần 2 (nhận 409 `MFA_RECOVERY_ALREADY_COMPLETED`, kiểm chứng khớp nối M03-10) -> thiết lập factor mới bằng `recoveryToken` -> xác nhận unauthenticated thành công nhận 10 mã khôi phục mới.
  6. Đăng nhập lại bằng password-only thành công -> tạo thử thách `RECOVERY_CODE_ROTATION` -> xác minh thử thách bằng TOTP factor mới -> xoay mã khôi phục thành công -> nhận 10 mã mới -> xác minh session cũ bị thu hồi.
- Kết quả: **ALL MFA DEMO FLOWS SUCCEEDED** (Exit code: 0).

### D. Mobile Quality Gates
- `npm run lint`: **PASS** (0 warnings, 0 errors).
- `npm run typecheck`: **PASS** (code 0).
- `npm run validate:openapi`: **PASS** (46 required paths).
- `npm test`: **PASS** 54/54 test suites, 408/408 tests passed.

### E. Backend Quality Gates
- `npm run typecheck`: **PASS** (code 0).
- `npm run build`: **PASS** (code 0).
- `npm run validate:openapi`: **PASS** (54 required paths, 60 guards).
- `npm run test:critical`: **PASS** (11/11 tests).
- `npm run test:mfa`: **PASS** (4 passed, 4 skipped when no DB).
- `backend/src/tests/kycContract.test.ts`: **PASS toàn bộ 28/28 tests** (0 failed, 0 skipped, 953ms). Bản sửa chỉ cập nhật các thuộc tính/responses MFA được phê duyệt một cách tường minh và độc lập trên `baselineNonKyc`, không copy object từ `currentNonKyc`, không làm mất khả năng phát hiện thay đổi ngoài phạm vi và không phụ thuộc việc commit vào HEAD.

### F. Android Build và Môi trường Emulator Demo
- Toolchain: Gradle 8.8 / React Native Gradle Plugin với JDK 17 (`C:\Program Files\Java\jdk-17`) và Android SDK (`buildTools: 36.0.0`, `compileSdk: 36`).
- Lệnh build: `cd mobile-app/android; ./gradlew.bat assembleRelease` thành công (`BUILD SUCCESSFUL in 1m 47s`, 612 tasks).
- Cập nhật APK lên emulator: `adb -s emulator-5554 install -r mobile-app/android/app/build/outputs/apk/release/app-release.apk` thành công (`Performing Streamed Install -> Success`), bảo toàn toàn bộ dữ liệu ứng dụng.
- Khởi chạy và kiểm chứng giao diện: `adb shell am start -n com.example.digitalbanking.mobile/.MainActivity` khởi chạy thành công; xác nhận `MainActivity` ở trạng thái RESUMED và hiển thị đúng giao diện đăng nhập an toàn Đợt 1 (ảnh chụp màn hình `scratch/mfa_screen.png`).
- Phân định ranh giới demo thực tế:
  - **APK startup smoke**: Khởi động app thành công trên `emulator-5554`, render đúng UI màn hình đăng nhập.
  - **MFA UI interactive flow trên emulator**: Hiện tại chưa có daemon backend persistent chạy thường trực tại `http://10.0.2.2:5000` (môi trường backend local chỉ khởi chạy disposable container theo từng lệnh test). Do đó, việc đăng nhập và thao tác trực tiếp trên UI emulator được ghi nhận ở trạng thái **NOT RUN** (chờ cấu hình backend server nền từ Owner).
  - **Logic nghiệp vụ End-to-End**: Đã được kiểm chứng trọn vẹn 100% qua runner HTTP persistent `demo_mfa_http_lifecycle.mjs` (6/6 flows PASS: enroll -> recovery codes -> session revocation -> step-up add factor 2 -> step-up remove factor 1 -> recovery & cooldown & M03-10 continuation -> rotate recovery codes) và suite kiểm thử Mobile Jest (408/408 tests PASS). Không đồng nhất HTTP evidence với bằng chứng UI emulator.

## 6. Danh mục file thay đổi (Allowlist)

1. `backend/src/mfa/persistentMfaService.ts`:
   - Chuẩn hóa công thức tính TTL recovery request: `expiresAt = cooldownUntil + 15m`.
   - Tách biệt kiểm tra 401 hết hạn (`MFA_RECOVERY_EXPIRED`) và 409 cooldown (`MFA_RECOVERY_COOLDOWN`).
   - Sửa AAD context mã hóa trong `beginRecoveryTotpEnrollment` và `confirmTotpEnrollment` dùng `this.encryptionContext("mfa-totp", credentialId, customerId)`.
2. `backend/src/tests/mfaPersistence.test.ts`:
   - Bổ sung test case kiểm tra TTL của recovery request và các mốc thời gian clock.
   - Sửa assertion kiểm tra kết quả `verifyChallenge` ({ customerId, credentialId }).
3. `backend/src/tests/kycContract.test.ts`:
   - Cập nhật `baselineNonKyc` cho phép các endpoint và response MFA Đợt 1 đã duyệt, bảo đảm non-KYC contract integrity mà không cần commit vào HEAD.
4. `documents/api/banking-mvp.openapi.yaml`:
   - Bổ sung endpoint `POST /auth/mfa/recovery-codes/rotate`, schemas, 409 error responses, và tài liệu thu hồi session.
5. `mobile-app/src/features/auth/screens/MfaRecoveryScreen.tsx`:
   - Bảo toàn luồng tiếp tục enrollment khi gặp 409 `MFA_RECOVERY_ALREADY_COMPLETED` (M03-10).
6. `mobile-app/src/features/auth/screens/__tests__/MfaRecoveryScreen.test.tsx`:
   - Bảo toàn regression test kiểm chứng M03-10.
7. `tasks/UC-M03/TASK_M03_10_RESUME_MFA_RECOVERY_AFTER_COMPLETION.md`:
   - Tài liệu task M03-10.
8. `tasks/UC-M03/TASK_DOT_1_HOAN_TAT_AUTHENTICATION_MFA.md`:
   - Tài liệu tổng kết Đợt 1 theo chuẩn `TASK_TEMPLATE.md`.

## 7. Trạng thái và giới hạn

- Trạng thái use case: `UC-M03: COMPLETED — OWNER APPROVED`.
- Giới hạn đã được Owner phê duyệt:
  1. MFA UI interactive flow trên emulator chưa chạy; APK mới có build/install/startup smoke PASS; bằng chứng component Jest, HTTP lifecycle và PostgreSQL không thay thế tương đương cho emulator E2E.
  2. Khả năng tiếp tục (continuation) của Recovery chỉ duy trì trong bộ nhớ phiên làm việc (in-memory `recoveryToken`) khi người dùng còn giữ màn hình; ứng dụng không lưu trữ plaintext token vào storage hay hỗ trợ khôi phục sau khi tắt hẳn ứng dụng (cold restart/process kill).
  3. Không triển khai SMS OTP, Passkey, support recovery, admin override.
  4. Không thay đổi hành vi đăng nhập password-only ở tầng HTTP customer.
- Điểm tiếp tục Đợt 2: Chuẩn bị backend local phục vụ demo và kiểm chứng tích hợp Mobile trực tiếp trên emulator.

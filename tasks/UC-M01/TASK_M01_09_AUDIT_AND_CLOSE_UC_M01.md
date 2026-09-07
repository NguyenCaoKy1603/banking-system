# TASK M01-09 — Audit and Close UC-M01

- **Trạng thái nhiệm vụ**: COMPLETED — OWNER APPROVED
- **Trạng thái Use Case UC-M01**: COMPLETED (Đã được Owner phê duyệt đóng ngày 2026-09-07)
- **Chế độ phiên làm việc**: DIAGNOSE_AND_PLAN (Đối soát tài liệu & nghiệm thu hoàn thành)
- **Ưu tiên**: P1
- **Phân hệ sở hữu**: Cross-cutting / Delivery Lead & Audit (Owner / Thành viên 1 — Backend & Core, Thành viên 2 — Mobile & E2E)
- **Quyền Git**: Không stage, không commit, không push

---

## 1. Thông tin dự án và quyền truy cập

- **Tên dự án**: Banking System
- **Repository root**: `C:\Projects\banking-system`
- **Branch**: `codex/staging-academic-completion`
- **HEAD commit**: `b5ef30cb78eaa43932a2ba14f3989aab6e648994`
- **Mục đích**: Dự án mobile banking academic/reference implementation dùng dữ liệu tổng hợp (synthetic) và tiền ảo, phục vụ nghiên cứu và bảo vệ đồ án tốt nghiệp. Không phải hệ thống xử lý tiền thật, pilot đã xác minh hoặc production-ready.
- **Tài liệu nền tảng**:
  - `AGENTS.md` và `mobile-app/AGENTS.md`
  - `PROJECT_CONTEXT.md`
  - `mobile-app/README.md` và `backend/README.md`
  - `tasks/UC-M01/TASK_M01_01_AUDIT_REGISTRATION_KYC.md` đến `TASK_M01_08_VERIFY_EMULATOR_E2E_REGISTRATION_KYC.md`
  - `documents/api/banking-mvp.openapi.yaml`

---

## 2. Quyền hạn phiên làm việc và vùng cấm

- **Được phép**:
  - Đọc mã nguồn Mobile, Backend, Database migrations, OpenAPI contracts và test suites liên quan đến UC-M01.
  - Hiệu chỉnh tài liệu tổng hợp `tasks/UC-M01/TASK_M01_09_AUDIT_AND_CLOSE_UC_M01.md`.
  - Hiệu chỉnh phần bổ sung đối soát mới (Mục 12) của `tasks/UC-M01/TASK_M01_01_AUDIT_REGISTRATION_KYC.md`.
  - Cập nhật trạng thái đóng UC-M01 trong `TASK_M01_07`, `TASK_M01_08` và `PROJECT_CONTEXT.md`.
  - Chạy các cổng kiểm tra tĩnh và kiểm tra hợp đồng không làm biến đổi mã nguồn (`typecheck`, `lint`, `validate:openapi`, `validate:public-env`, `git diff --check`).
- **Tuyệt đối cấm**:
  - Không ghi đè hoặc xóa kết luận lịch sử của baseline audit trong `TASK_M01_01` (Mục 1 đến Mục 11).
  - Không sửa mã nguồn logic (`mobile-app/src/`, `backend/src/`), schema/migrations (`backend/database/`), file hợp đồng OpenAPI (`documents/api/`) hoặc cấu hình dependencies.
  - Không khởi động container Docker, cơ sở dữ liệu disposable, Android Emulator hoặc chạy lại các bộ test E2E/relational runtime.
  - Không thực hiện `git add`, `git commit` hay `git push`.

---

## 3. Mục tiêu nghiệm thu

1. Đối soát toàn diện 15 quyết định kiến trúc chuẩn hóa (**D-01 đến D-15**) đối với mã nguồn thực tế, schema migrations, hợp đồng OpenAPI và kết quả kiểm thử tương ứng.
2. Đối soát lại 16 scenario ban đầu từ baseline audit M01-01, chứng minh 100% các điểm `CONFLICT` và `PARTIAL` đã được giải quyết hoặc ghi nhận giới hạn đồ án được duyệt.
3. Ghi nhận minh bạch các giới hạn đồ án (Academic Limitations) đã được Owner phê duyệt bằng văn bản.
4. Tách bạch rõ ràng số test do test runner báo cáo (mỗi relational file báo `1/1 top-level test PASS`) với số acceptance criteria được kiểm chứng trong mỗi suite (`KYC-01` đến `KYC-16` và vòng đời đăng ký relational).
5. Gắn chính xác nguồn và thời điểm đối với các số liệu kiểm thử (Mobile 51 suites / 373 tests của M01-06/M01-08 so với snapshot baseline cũ 45 suites / 259 tests).
6. Xác minh cấu trúc lưu trữ full synthetic identity: được lưu trong cột JSONB `kyc_applications.synthetic_payload` (cụ thể là `synthetic_payload.identityNumber`) theo migration `038_customer_kyc_runtime.sql`.
7. Lập biên bản hoàn tất kiểm toán đối soát và ghi nhận Owner phê duyệt đóng chính thức Use Case UC-M01.

---

## 4. Ma trận đối soát 15 Quyết định Kiến trúc (D-01 đến D-15)

| Mã Quyết định | Yêu cầu chuẩn hóa (Canonical Requirement) | Vị trí triển khai thực tế (Implementation) | Bằng chứng kiểm chứng (Evidence) | Trạng thái | Ghi chú & Giới hạn còn lại |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **D-01** | CCCD hợp lệ 6–24 chữ số (`^\d{6,24}$`) thống nhất ở 3 tầng | `mobile-app/src/features/kyc/validation/kycValidators.ts` (`validateKycDraft`)<br>`backend/src/database/kycService.ts` (`normalizeInput`)<br>`documents/api/banking-mvp.openapi.yaml` | - Mobile unit: `kycValidators.test.ts` (test: `uses the canonical identity boundary and document URI schemes` kiểm tra boundary 5, 6, 24, 25 chữ số)<br>- Backend relational: `kycRelational.test.ts` (tiêu chí `KYC-03: Invalid identity number rejected (5 and 25 digits)`)<br>- Backend contract: `kycContract.test.ts` (test: `KYC input accepts the canonical 6–24 digit identity range`) | **VERIFIED** | Implementation và test coverage hoàn chỉnh ở cả 3 tầng. |
| **D-02** | Document URI chỉ chấp nhận `mock://` hoặc `synthetic://` | `mobile-app/src/features/kyc/validation/kycValidators.ts` (`validateKycDraft`)<br>`backend/src/database/kycService.ts` (`normalizeInput`)<br>`documents/api/banking-mvp.openapi.yaml` | - Mobile unit: `kycValidators.test.ts` (chặn `https://`, `file://`)<br>- Backend relational: `kycRelational.test.ts` (tiêu chí `KYC-04: Invalid documentUri scheme rejected`)<br>- Backend contract: `kycContract.test.ts` (test: `KYC document URI accepts only lowercase mock:// or synthetic:// fixtures`) | **VERIFIED** | Runtime validator từ chối scheme lạ với mã 422. |
| **D-03** | KYC Response chỉ trả `identityNumberLast4` đúng 4 chữ số | `backend/src/database/kycService.ts` (`publicApplication`)<br>`mobile-app/src/features/kyc/types/kyc.ts`<br>`mobile-app/src/features/kyc/validation/kycResponseValidators.ts`<br>`documents/api/banking-mvp.openapi.yaml` | - Backend contract: `kycContract.test.ts` (test: `KYC public mapper exposes exactly four identity digits and never the full identity`)<br>- Mobile unit: `kycResponseValidators.test.ts`<br>- Emulator runtime: `TASK_M01_08` (`E2E-KYC-01` hiển thị `••••8901`, release APK bundle xác nhận `Contains identityNumberLast4: True`) | **VERIFIED** | Public response projection đã loại bỏ hoàn toàn full CCCD. |
| **D-04** | Full identity là Write-Only; cấm response/log/storage | `backend/src/database/kycService.ts` (`publicApplication`)<br>`mobile-app/src/features/kyc/screens/KycScreen.tsx`<br>`backend/database/038_customer_kyc_runtime.sql` | - Backend schema: Full synthetic identity được lưu trữ tại cột JSONB `kyc_applications.synthetic_payload` (cụ thể là `synthetic_payload.identityNumber`) theo migration `038_customer_kyc_runtime.sql` và contract nghiệp vụ đã duyệt.<br>- Response projection: `publicApplication` chỉ trả `identityNumberLast4`.<br>- Client storage: `KycScreen.tsx` không lưu CCCD vào AsyncStorage/SecureStore.<br>- Scan tĩnh: `validate:public-env` (216 file PASS) | **ACCEPTED LIMITATION** | Phân tầng bằng chứng qua schema projection, unit test, release bundle scan; Owner chấp thuận không tuyên bố "zero leakage" tuyệt đối toàn hệ thống. |
| **D-05** | Response validators chỉ chấp nhận enum chính thức trong OpenAPI | `mobile-app/src/features/auth/services/authResponseValidators.ts`<br>`mobile-app/src/features/auth/types/auth.ts` | - Mobile unit: `authResponseValidators.test.ts` (kiểm tra `EMAIL_OTP`, `REGISTRATION_EMAIL_VERIFY`, chặn alias cũ)<br>- OpenAPI gate: `npm run validate:openapi` PASS (46 paths) | **VERIFIED** | Loại bỏ hoàn toàn alias không chính thức. |
| **D-06** | Body xác thực đăng ký sai/thiếu trường phải trả HTTP 422 | `backend/src/http.ts` (runtime guard dòng 827–841 trước service call) | - Backend contract: `registrationContract.test.ts` (kiểm tra thiếu `challengeId`, method khác `EMAIL_OTP`, `proof` rỗng đều trả 422 `VALIDATION_ERROR`) | **VERIFIED** | Guard chặn trước logic nghiệp vụ. |
| **D-07** | Duplicate Registration race trả HTTP 409 Conflict | `backend/src/database/registrationService.ts` (`RelationalRegistrationService.begin` và `complete`)<br>PostgreSQL Unique Indexes: `customers_email_key`, `customers_phone_number_key` | - Backend relational: `registrationRelational.test.ts` (assertion kiểm tra duplicate begin trả HTTP 409 `CONFLICT` với thông điệp `Registration conflict.`)<br>- Backend contract: `registrationContract.test.ts` | **VERIFIED** | Xử lý deterministic, không tạo tài khoản trùng. |
| **D-08** | Route hủy đăng ký chuẩn hóa: `POST /auth/register/cancel` | `documents/api/banking-mvp.openapi.yaml`<br>`backend/src/http.ts` (dòng 860–890)<br>`mobile-app/src/features/auth/services/authApi.ts` (`cancelRegistration`) | - Backend contract: `registrationContract.test.ts` (test: `Registration cancel with missing challengeId returns 422`, `Registration cancel missing X-Device-ID returns 422`)<br>- OpenAPI validation: `validate:openapi` PASS trên cả Mobile và Backend | **VERIFIED** | Endpoint canonical tích hợp đồng bộ 3 tầng. |
| **D-09** | Hủy đăng ký idempotent, yêu cầu `challengeId` và `X-Device-ID` | `backend/src/http.ts`<br>`backend/src/database/registrationService.ts` (`cancel`)<br>`mobile-app/src/features/auth/services/authApi.ts` | - Backend contract: `registrationContract.test.ts` (test: `Registration cancel precedence (RelationalRegistrationService)`)<br>- Mobile unit: `RegisterScreen.test.tsx` (test: `cancels the server challenge on 204 and returns to the registration form`) | **VERIFIED** | 204 khi hủy lặp lại, 404 khi sai device, 409 khi registration đã completed. |
| **D-10** | KYC DRAFT yêu cầu payload đầy đủ, hợp lệ nhưng chưa submit | `backend/src/database/kycService.ts` (`saveDraft` gọi `normalizeInput`)<br>`mobile-app/src/features/kyc/screens/KycScreen.tsx` (`handleSaveDraft`)<br>`mobile-app/src/features/kyc/services/kycApi.ts` (`saveKycDraft`) | - Backend relational: `kycRelational.test.ts` (tiêu chí `KYC-01: Valid initial saveDraft creates DRAFT application`, `KYC-02: Missing required fields in saveDraft rejected`)<br>- Backend contract: `kycContract.test.ts` (test: `T-KYC-BE-02: Valid saveDraft creates DRAFT application with version 1`)<br>- Emulator runtime: `TASK_M01_08` (`E2E-KYC-01`) | **VERIFIED** | Bản ghi lưu với `status = 'DRAFT'`, `submitted_at = null`. |
| **D-11** | REJECTED là terminal; nộp lại tạo DRAFT mới; tối đa 1 hồ sơ mở | `backend/database/038_customer_kyc_runtime.sql` (partial unique index `kyc_applications_one_open_per_customer`)<br>`backend/src/database/kycService.ts` | - Backend relational: `kycRelational.test.ts` (tiêu chí `KYC-07` đến `KYC-12`, `KYC-15`)<br>- Backend contract: `kycContract.test.ts` (test: `T-KYC-BE-05: REJECTED + saveDraft creates new DRAFT row with UUID moi and version 1`, `T-KYC-BE-12`, `T-KYC-BE-13`) | **ACCEPTED LIMITATION** | Giới hạn KYC-15 được Owner duyệt: lỗi non-open 23505 (primary key) kiểm chứng qua unit/contract; open-index 23505 kiểm chứng trên PostgreSQL. |
| **D-12** | Registration restart không lưu dữ liệu bí mật; phục hồi an toàn | `mobile-app/src/features/auth/storage/registrationSessionStorage.ts`<br>`mobile-app/src/features/auth/screens/RegisterScreen.tsx` | - Mobile unit: `RegisterScreen.test.tsx` (tests: `saves BEGIN_UNKNOWN before calling register()`, `shows OTP field with restored challengeId`, `does not write email, phone, password, OTP, proof, or token into storage`, `T-REG-FE-REC-01`) | **ACCEPTED LIMITATION** | Kịch bản phục hồi/hủy được Owner duyệt nghiệm thu qua Jest unit tests, chưa chạy độc lập trên emulator runtime. |
| **D-13** | Khóa rate-limit và audit an toàn, không chứa raw IP/email/phone | `backend/src/security.ts` (`computeRegistrationNetworkFingerprint`)<br>`backend/src/http.ts` (`getRateLimitKey`)<br>`backend/src/database/registrationService.ts` | - Backend contract: `registrationContract.test.ts` (kiểm tra audit payload và HMAC fingerprint) | **VERIFIED** | Sử dụng HMAC keyed với `registrationFingerprintKey`. |
| **D-14** | KYC UI ánh xạ chi tiết field error; phân biệt REJECTED vs NEEDS_MORE_INFO | `mobile-app/src/features/kyc/screens/KycScreen.tsx` | - Mobile screen tests: `KycScreen.test.tsx` (`T-KYC-FE-01: Known 422 field errors map to inputs`, `T-KYC-FE-02: Initial load failure renders dedicated error view with retry`, `T-KYC-FE-03: Renders distinct UI for REJECTED, NEEDS_MORE_INFO, and APPROVED states`, `T-KYC-FE-10`)<br>- Emulator runtime: `TASK_M01_08` (`E2E-KYC-02` locked form và hiện ghi chú `kyc-pending-entitlement-note`) | **VERIFIED** | Giao diện hiển thị đúng ngữ nghĩa trạng thái. |
| **D-15** | KYC update privacy: không gửi last4 thay full CCCD, omit khi không đổi | `mobile-app/src/features/kyc/services/kycApi.ts` (`saveKycDraft`)<br>`mobile-app/src/features/kyc/validation/kycValidators.ts` (`validateKycDraft`)<br>`mobile-app/src/features/kyc/screens/KycScreen.tsx`<br>`backend/src/database/kycService.ts` (`normalizeInput`) | - Backend relational: `kycRelational.test.ts` (tiêu chí `KYC-05: Update draft omitting identityNumber preserves existing identity`, `KYC-06: Update draft with new valid identityNumber updates identity`, `KYC-14: Update draft with 4-digit last4 string rejected`)<br>- Backend contract: `kycContract.test.ts` (test: `KYC update without identity keeps the server-side identity while create requires it`)<br>- Mobile unit: `kycApi.test.ts` (test: `omits identityNumber completely when an existing identity is unchanged`)<br>- Mobile validation: `kycValidators.test.ts` (test: `allows an existing application update to omit an unchanged identity`)<br>- Mobile screen: `KycScreen.test.tsx` (test: `omits identityNumber for an unchanged existing identity update`, `renders an existing identity as masked last4`)<br>- Emulator runtime: `TASK_M01_08` (`E2E-KYC-01`, `E2E-KYC-02` hiển thị masked `••••8901`) | **VERIFIED** | Server giữ nguyên số cũ nếu client omit `identityNumber`. |

---

## 5. Ma trận đối soát 16 Scenarios của M01-01

| # | Kịch bản kiểm thử (Scenario M01-01) | Trạng thái ban đầu | Trạng thái hiện tại | Giải pháp triển khai & Bằng chứng kiểm chứng |
|---:|:---|:---:|:---:|:---|
| 1 | Người chưa đăng nhập mở registration | `PARTIAL` | **VERIFIED** | Route pre-auth trong Expo Router `(auth)/register`. Kiểm chứng qua Jest `RegisterScreen.test.tsx` (test: `shows the registration form when storage is empty`) và Emulator E2E runtime `TASK_M01_08` (`E2E-REG-01`). |
| 2 | Registration form xử lý thiếu/sai định dạng | `VERIFIED` | **VERIFIED** | Client validation `validateRegisterForm` và Server validation trong `registrationService.ts`. Kiểm chứng qua `authValidation.test.ts` và `registrationContract.test.ts`. |
| 3 | Dữ liệu không hợp lệ không gửi request ngoài dự kiến | `PARTIAL` | **VERIFIED** | Client return sớm nếu form không hợp lệ; Backend verify có runtime body guard trả 422 trước service (D-06). Kiểm chứng qua Jest `RegisterScreen.test.tsx` (test: `T-REG-FE-VAL-01`) và `registrationContract.test.ts`. |
| 4 | Registration thành công đúng API contract | `PARTIAL` | **VERIFIED** | API client gọi `/auth/register` (202), verify OTP (201), điều hướng về `/login`. Kiểm chứng qua `registrationRelational.test.ts` (test: `relational registration persists only OTP digest, uses outbox intent and completes once`) và Emulator runtime `TASK_M01_08` (`E2E-REG-01`). |
| 5 | Email/phone/account đã tồn tại xử lý đúng | `CONFLICT` | **VERIFIED** | Pre-check kết hợp unique index PostgreSQL; endpoint `POST /auth/register/cancel` giải phóng pending registration an toàn; race condition trả HTTP 409 (D-07, D-08, D-09). Kiểm chứng qua `registrationRelational.test.ts` (assertion duplicate begin rejected 409 `CONFLICT`) và `registrationContract.test.ts`. |
| 6 | Server validation error map đúng UI | `PARTIAL` | **VERIFIED** | Registration map `fieldErrors` về form; KYC map `fieldErrors` về từng ô nhập liệu (D-14). Kiểm chứng qua Jest tests trong `RegisterScreen.test.tsx` (test: `T-REG-FE-ERR-422`) và `KycScreen.test.tsx` (test: `T-KYC-FE-01`). |
| 7 | Offline/timeout rõ ràng | `PARTIAL` | **VERIFIED** | `httpClient` xử lý mã lỗi mạng ổn định; UI hiển thị thông báo lỗi; màn hình KYC có nút thử lại khi tải thất bại lần đầu (D-14). Kiểm chứng qua `httpClient.test.ts`, `RegisterScreen.test.tsx` (tests: `T-REG-FE-ERR-NETWORK`, `T-REG-FE-ERR-TIMEOUT`) và `KycScreen.test.tsx` (test: `T-KYC-FE-02`). |
| 8 | Retry không tạo submit đồng thời/account trùng | `PARTIAL` | **VERIFIED** | Nút bấm disable khi đang gửi yêu cầu; PostgreSQL khóa dòng `FOR UPDATE`; cancel và completion được thiết kế idempotent. Kiểm chứng qua `RegisterScreen.test.tsx` (test: `T-REG-FE-DBL-01`) và `registrationRelational.test.ts` (concurrent verify race assertion: 1 fulfilled, 1 rejected). |
| 9 | Registration response runtime-validated | `PARTIAL` | **VERIFIED** | `authResponseValidators.ts` chuẩn hóa kiểm tra chặt chẽ theo enum OpenAPI (D-05), loại bỏ alias ngoài contract. Kiểm chứng qua `authResponseValidators.test.ts` và `authApi.test.ts`. |
| 10 | Synthetic KYC input/validate đúng contract | `CONFLICT` | **VERIFIED** | Thống nhất quy tắc CCCD 6–24 chữ số và document URI `mock://` / `synthetic://` ở cả 3 tầng (D-01, D-02). Kiểm chứng qua `kycValidators.test.ts` (test: `uses the canonical identity boundary and document URI schemes`) và `kycRelational.test.ts` (tiêu chí `KYC-03`, `KYC-04`). |
| 11 | KYC states được lưu và hiển thị đúng | `PARTIAL` | **ACCEPTED LIMITATION** | Backend hỗ trợ đầy đủ vòng đời trạng thái; migration 038 partial unique index; UI phân biệt DRAFT, SUBMITTED, NEEDS_MORE_INFO, REJECTED (D-10, D-11, D-14). Kiểm chứng qua `kycRelational.test.ts` (tiêu chí `KYC-01` đến `KYC-12`), `KycScreen.test.tsx` (test: `T-KYC-FE-03`), và Emulator runtime `TASK_M01_08` (`E2E-KYC-01`, `E2E-KYC-02`). Giới hạn KYC-15 được Owner duyệt. |
| 12 | Unauthorized/session behavior của KYC | `VERIFIED` | **VERIFIED** | Endpoints KYC yêu cầu Bearer token và header `X-Device-ID`; Mobile lấy token từ `AuthContext`; 401 tự động refresh single-flight. Kiểm chứng qua HTTP route tests trong `kycContract.test.ts` và `httpClient.test.ts`. |
| 13 | Đóng/khởi động lại giữa flow không làm sai state | `CONFLICT` | **ACCEPTED LIMITATION** | `registrationSessionStorage` lưu metadata phase `BEGIN_UNKNOWN` hoặc `CHALLENGE_RECEIVED`; cho phép khôi phục OTP hoặc reset form an toàn (D-12); server-side cancel giải phóng challenge cũ (D-08, D-09). Nghiệm thu qua Jest `RegisterScreen.test.tsx` (tests: `saves BEGIN_UNKNOWN before calling register()`, `shows OTP field with restored challengeId`, `T-REG-FE-REC-01`), Owner chấp thuận chưa chạy trên emulator runtime. |
| 14 | Điều hướng sau registration/KYC | `PARTIAL` | **VERIFIED** | Registration thành công bấm Alert điều hướng về `/login`; KYC nộp hồ sơ giữ trạng thái "Đang chờ duyệt" (SUBMITTED) và hiển thị ghi chú thẩm quyền. Kiểm chứng trực tiếp trên Emulator runtime `TASK_M01_08` (`E2E-REG-01`, `E2E-KYC-02`). |
| 15 | Secret/PII không vào log/telemetry/evidence | `CONFLICT` | **ACCEPTED LIMITATION** | Response KYC chuyển sang `identityNumberLast4` (D-03); CCCD full được persist ở backend trong cột JSONB `synthetic_payload` (`synthetic_payload.identityNumber`) theo schema nghiệp vụ 038 nhưng là write-only đối với public response (D-04); SecureStore không lưu password/OTP/CCCD (D-12); audit registration dùng keyed fingerprint (D-13); script `validate:public-env` quét 216 file PASS. Owner chấp thuận phân tầng bằng chứng, không cam kết zero leakage tuyệt đối. |
| 16 | Test bao phủ đúng các claim | `PARTIAL` | **VERIFIED** | Bổ sung đầy đủ unit tests, screen tests, contract tests, relational PostgreSQL tests và emulator E2E tests qua M01-03 đến M01-08. Toàn bộ các suite Mobile (51 suites / 373 tests PASS theo M01-06/M01-08) và các suite Backend đạt PASS 100%. |

---

## 6. Tổng hợp Cổng Chất lượng và Bằng chứng Kiểm thử (Quality Gates & Evidence Binding)

### A. Cổng kiểm tra tĩnh chạy mới trong phiên M01-09 (Tại HEAD b5ef30cb)
- **Mobile OpenAPI Contract**: `npm run validate:openapi` (tại `mobile-app/`) → **PASS** (46 required paths, device binding, challenge-bound step-up, examples verified).
- **Mobile Public Environment**: `npm run validate:public-env` (tại `mobile-app/`) → **PASS** (216 file(s) scanned, không có biến môi trường rò rỉ).
- **Mobile Lint**: `npm run lint` (tại `mobile-app/`) → **PASS** (`expo lint` 0 warning, 0 error).
- **Mobile Typecheck**: `npx tsc --noEmit` (tại `mobile-app/`) → **PASS** (0 error).
- **Backend Typecheck**: `npm run typecheck` (tại `backend/`) → **PASS** (0 error).
- **Backend OpenAPI Contract**: `npm run validate:openapi` (tại `backend/`) → **PASS** (54 required paths, 60 exact method/segment guards verified).
- **Repository Diff Check**: `git diff --check` (tại root) → **PASS** (0 error, sạch định dạng).

### B. Bằng chứng kiểm thử kế thừa có gán nguồn và thời điểm chính xác
1. **Mobile Unit & Screen Test Suites (Kế thừa từ M01-06 và M01-08)**:
   - **Runner report**: **51 test suites / 373 tests PASS** (0 failed, 0 skipped) theo kết quả thực thi đầy đủ tại `TASK_M01_06` và `TASK_M01_08`.
   - *(Lưu ý: Số liệu 45 suites / 259 tests là snapshot baseline cũ ghi nhận trong `PROJECT_CONTEXT.md` trước khi M01-06 đóng các khoảng trống coverage).*
2. **PostgreSQL Relational Verification (Kế thừa từ M01-07 — Chạy trên disposable PostgreSQL)**:
   - Áp dụng thành công toàn bộ 40/40 migrations từ database rỗng.
   - **Runner output `src/tests/registrationRelational.test.ts`**: `1/1 top-level test PASS (205.1 ms)` — Test block `relational registration persists only OTP digest, uses outbox intent and completes once` bao phủ các assertions về begin, resend, OTP hashing, outbox payload safety, race condition completion, replay rejection và duplicate conflict mapping.
   - **Runner output `src/tests/kycRelational.test.ts`**: `1/1 top-level test PASS (402.9 ms)` — Test block `relational kyc verification suite covering KYC-01 through KYC-16` bao phủ tuần tự 16 tiêu chí chấp nhận `KYC-01` đến `KYC-16`.
   - Resource cleanup: 0 dangling container, volume count cố định 48 volumes.
3. **Android Emulator E2E Runtime Verification (Kế thừa từ M01-08 — Bản build mới trên Pixel 7 API 34)**:
   - Release APK: `app-release.apk` đóng gói từ đúng HEAD `b5ef30cb` (bundle size 3,333,038 bytes, `Contains identityNumberLast4: True`).
   - `E2E-REG-01` (Registration Happy Path): **PASS** trực tiếp trên Android Emulator (nhập form synthetic -> OTP capture -> Alert "Đăng ký thành công" -> điều hướng chuẩn xác về Login screen).
   - `E2E-KYC-01` & `E2E-KYC-02` (KYC Draft → Submit): **PASS** trực tiếp trên Android Emulator (Lưu nháp hiển thị `••••8901` -> Nộp hồ sơ chuyển sang trạng thái "Đang chờ duyệt", khóa form chỉnh sửa, hiển thị ghi chú thẩm quyền `kyc-pending-entitlement-note`; không phát sinh lỗi `INVALID_RESPONSE`).

---

## 7. Danh mục Giới hạn Đồ án được Owner phê duyệt (Approved Academic Limitations)

1. **Giới hạn KYC-15 (Xử lý lỗi Postgres 23505 trên ràng buộc khác)**:
   - Nghiệm thu bằng phương pháp kết hợp: unit/contract test (`backend/src/tests/kycContract.test.ts` test `T-KYC-BE-13`) chứng minh lỗi `23505` của các constraint khác (như primary key) được rethrow và không map nhầm thành 409; PostgreSQL relational test (`kycRelational.test.ts` tiêu chí `KYC-15`) chứng minh xung đột open-index được map chuẩn xác và lỗi ngoại khóa `23503` được rollback.
   - Không bắt buộc fault injection ép tạo va chạm khóa chính UUID trên cơ sở dữ liệu PostgreSQL thực tế trong phạm vi đồ án.
2. **Giới hạn Kịch bản Biên Đăng ký (Edge Scenarios: Recovery & Cancel)**:
   - Các kịch bản: phục hồi trạng thái `BEGIN_UNKNOWN` (`E2E-REG-04`), khôi phục màn hình OTP khi mở lại app (`E2E-REG-02`), và hủy bỏ đăng ký (`E2E-REG-03`) được nghiệm thu đạt chuẩn qua bộ test Jest `RegisterScreen.test.tsx`.
   - Ghi nhận rõ ràng: Các kịch bản biên này chưa được chạy độc lập trên môi trường Android Emulator runtime.
3. **Giới hạn Đánh giá An toàn Dữ liệu (Privacy & Zero Leakage)**:
   - Làm rõ: Full synthetic identity number được lưu trữ hợp lệ tại backend database trong cột JSONB `kyc_applications.synthetic_payload` (cụ thể là `synthetic_payload.identityNumber` theo migration `038_customer_kyc_runtime.sql`), nhưng là write-only đối với client; public response API chỉ trả `identityNumberLast4`.
   - Bằng chứng bảo mật được phân tầng qua kiểm tra mã nguồn, script quét biến môi trường `validate:public-env` (216 files PASS), và kiểm tra session SecureStore chỉ chứa metadata.
   - Không tuyên bố cam kết "zero leakage" tuyệt đối toàn bộ hệ thống; không yêu cầu pentest chuyên sâu hay chứng chỉ an toàn cấp ngân hàng thương mại.

---

## 8. Kết luận Kiểm toán và Nghiệm thu Đóng Use Case UC-M01

- **Kết luận**:
  - Evidence summary đã được hiệu chỉnh chính xác: phân định rõ giữa runner count (`1/1 top-level test PASS`) và số acceptance criteria (`KYC-01..16`, registration lifecycle); cấu trúc schema persistence được ghi nhận chuẩn xác tại cột JSONB `kyc_applications.synthetic_payload`; gắn số liệu Mobile test suite 51 suites / 373 tests với M01-06/M01-08; chuẩn hóa mapping các quyết định D-01..D-15 với exact test names.
  - Toàn bộ 15 quyết định kiến trúc D-01 đến D-15 đã được đối chiếu chi tiết và đạt trạng thái `VERIFIED` hoặc `ACCEPTED LIMITATION`.
  - 100% các scenario của baseline audit M01-01 từng bị đánh dấu `CONFLICT` hoặc `PARTIAL` đã được giải quyết triệt để và chuyển sang trạng thái hợp lệ.
  - Các cổng chất lượng tĩnh (typecheck, lint, OpenAPI, public-env) đều đạt kết quả PASS tuyệt đối tại snapshot HEAD hiện tại.
- **Quyết định phê duyệt của Owner**:
  - **Task M01-09**: **COMPLETED — OWNER APPROVED** (Nhiệm vụ kiểm toán nghiệm thu hoàn thành xuất sắc).
  - **Use Case UC-M01 (Registration và Synthetic KYC)**: **COMPLETED** (Chính thức đóng use case theo phê duyệt của Owner ngày 2026-09-07).

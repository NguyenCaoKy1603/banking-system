# TASK M03-02 — Verify MFA Relational Persistence on PostgreSQL Disposable

> **Trạng thái nhiệm vụ:** COMPLETED — VERIFIED.
>
> **Trạng thái Use Case UC-M03:** INCOMPLETE.
>
> Ngày thực hiện: 2026-09-07.
>
> Phân hệ: Backend & Core Security / Thành viên 1.
>
> Mục tiêu: Căn chỉnh test runner hiện có (`npm run test:mfa:persistence`), bổ sung targeted relational tests cho `rotateRecoveryCodes` và `revokeCredential` (kèm logic bảo vệ `MFA_LAST_FACTOR`), thực thi kiểm chứng runtime trên PostgreSQL 16 disposable admin container độc lập, và lập hồ sơ bàn giao kỹ thuật.

---

## 1. Thông tin dự án và quyền truy cập

- **Tên dự án:** Banking System
- **Vị trí Windows:** `C:\Projects\banking-system`
- **Repository root thực tế:** `C:\Projects\banking-system`
- **Quyền truy cập:** Codex được mở tại repository root của local project.
- **Xác nhận Preflight:**
  - CWD: `C:\Projects\banking-system`
  - Git branch: `codex/staging-academic-completion`
  - Git HEAD nền: `bd9be2e310f0450ef20f81ce492c97087d8ebc19`
  - Git status: Index sạch, working tree sạch trước khi bắt đầu nhiệm vụ.
  - Lưu ý lịch sử: Phiên M03-01 là audit read-only (chế độ `DIAGNOSE_AND_PLAN`), không tạo file task hay commit riêng.
- **Mục đích:** Dự án mobile banking academic/reference implementation dùng dữ liệu tổng hợp (synthetic) và tiền ảo, hướng tới kiểm thử local và phục vụ bảo vệ đồ án tốt nghiệp. Không phải hệ thống xử lý tiền thật, pilot đã xác minh hoặc production-ready.
- **Tài liệu đã đối soát:**
  - `AGENTS.md`
  - `PROJECT_CONTEXT.md`
  - `USE_CASE_ROADMAP.md`
  - `TASK_TEMPLATE.md`
  - `backend/README.md`
  - Hồ sơ closure `tasks/UC-M02/TASK_M02_07_AUDIT_AND_CLOSE_UC_M02.md`
  - `documents/api/banking-mvp.openapi.yaml`
  - `documents/api/auth-session-api-contract.md`
  - `documents/adr/0002-mfa-security-architecture.md`
  - `documents/runbooks/mfa-operations.md`

---

## 2. Chế độ làm việc và quyền Git

- **Chế độ làm việc:** `IMPLEMENT_AND_VERIFY` (sau đó chuẩn hóa tài liệu và lưu local checkpoint theo phê duyệt của Owner)
- **Ưu tiên:** `P1`
- **Quyền sửa đổi:** Chỉ trong danh sách allowlist được Owner phê duyệt:
  1. `backend/src/database/disposableDatabaseGuard.ts` (bổ sung `src/tests/mfaPersistence.test.ts` vào `APPROVED_TEST_PATHS`)
  2. `backend/src/tests/disposableDatabaseGuard.test.ts` (bổ sung regression tests M03-REG-01 và M03-REG-02)
  3. `backend/src/tests/mfaPersistence.test.ts` (bổ sung 2 targeted relational tests cho rotate và revoke)
  4. `tasks/UC-M03/TASK_M03_02_VERIFY_MFA_RELATIONAL_PERSISTENCE.md` (hồ sơ nhiệm vụ này)
- **Vùng cấm:**
  - Không sửa `PROJECT_CONTEXT.md` hay `USE_CASE_ROADMAP.md` trong task này.
  - Không sửa production MFA service (`PersistentMfaService.ts`), HTTP handlers, Mobile app, database schema, migration, OpenAPI contract, dependencies hay `package.json`.
  - Không đưa MFA challenge trở lại password-only login.
  - Không in, log hoặc so sánh raw secret, recovery code plaintext, OTP, token hay database credentials.
- **Quyền Git:**
  - Stage đúng 4 đường dẫn allowlist; không `git add .` hoặc stage cả thư mục.
  - Tạo đúng một local commit theo thông điệp được duyệt; không push, amend, rebase, merge hoặc tag.

---

## 3. Nhiệm vụ lần này

- **Tên nhiệm vụ:** Căn chỉnh runner và kiểm chứng MFA Relational Persistence trên PostgreSQL Disposable.
- **Mục tiêu:**
  1. Căn chỉnh allowlist trong `disposableDatabaseGuard.ts` để `npm run test:mfa:persistence` chạy hợp lệ qua canonical runner mà không vi phạm fail-closed security guard.
  2. Bổ sung regression tests trong `disposableDatabaseGuard.test.ts` nhằm đảm bảo guard chấp thuận đúng đường dẫn được duyệt và từ chối mọi đường dẫn tùy ý.
  3. Bổ sung targeted tests trong `mfaPersistence.test.ts` kiểm chứng:
     - `rotateRecoveryCodes`: thu hồi toàn bộ code cũ (chuyển sang `REVOKED` kèm `revoked_at`), tạo và kích hoạt 10 code mới (`ACTIVE`), mã cũ bị từ chối với lỗi service `DomainError` (status 401), mã mới xác thực thành công trả về `PRIMARY_PROOF_VERIFIED`, và ghi nhận audit event `MFA_RECOVERY_CODES_ROTATED`.
     - `revokeCredential`: kiểm tra chặn thu hồi factor duy nhất với mã lỗi `MFA_LAST_FACTOR`, đăng ký factor thứ 2 làm đối chứng, thu hồi factor được chỉ định thành `REVOKED` trong khi factor đối chứng vẫn `ACTIVE`, chặn thu hồi factor còn lại với `MFA_LAST_FACTOR`, và ghi nhận audit event `MFA_FACTOR_REVOKED`.
  4. Chạy toàn bộ quality gates (`test:database:guard`, `typecheck`, `build`, `git diff --check`).
  5. Khởi tạo một PostgreSQL 16 container tạm thuộc phiên, chạy kiểm chứng runtime `npm run test:mfa:persistence`, thu thập kết quả redacted, và dọn dẹp triệt để container.

---

## 4. Hành vi và dữ liệu đối soát

### 4.1. Data Flow chi tiết

```
[Request] -> [PersistentMfaService / UnitOfWork] -> [PostgreSQL Relational DB] -> [Assertion / Audit Event]
```

1. **TOTP Rotate Recovery Codes Flow:**
   - **Request:** `service.rotateRecoveryCodes(customerId)`
   - **State / Database:**
     - Truy vấn tất cả recovery codes đang `ACTIVE` của khách hàng trong bảng `mfa_recovery_codes`.
     - Cập nhật trạng thái thành `REVOKED` và gán `revoked_at = NOW()`.
     - Sinh 10 mã khôi phục mới: mỗi mã là chuỗi ngẫu nhiên 16 bytes base64url (`generateRecoveryCode`). Mã được băm an toàn qua PBKDF2 (`pbkdf2Sync(plaintext, salt, 180_000, 32, "sha256")`) với salt ngẫu nhiên 16 bytes độc lập.
     - Database (`mfa_recovery_codes`) chỉ lưu trữ `salt` (hex) và `code_digest` (hex) với trạng thái `ACTIVE`. Plaintext chỉ tồn tại tạm thời trong bộ nhớ và mảng kết quả trả về của hàm để giao diện hiển thị một lần cho người dùng, tuyệt đối không lưu trữ plaintext xuống cơ sở dữ liệu.
     - Ghi nhận sự kiện `MFA_RECOVERY_CODES_ROTATED` vào bảng `auth_security_events`.
   - **Xác minh hành vi & Bảo mật:**
     - Mã cũ lập tức bị từ chối với service `DomainError` có status 401 (`unauthorized("Recovery code is invalid or already used.")`, không phải HTTP runtime response trực tiếp) khi gọi `verifyRecoveryCode`.
     - Mã mới xoay vòng xác thực thành công, trả về trạng thái `PRIMARY_PROOF_VERIFIED` và `recoveryToken`.
     - Kiểm tra trực tiếp trong DB: 10 code `ACTIVE`, 10 code `REVOKED` có timestamp `revoked_at`. Tuyệt đối không log hoặc so sánh chuỗi plaintext trong assertion output.

2. **Revoke Credential & Last Factor Protection Flow:**
   - **Precondition Check:**
     - Khi khách hàng chỉ có 1 factor `ACTIVE`, yêu cầu `revokeCredential` lập tức bị reject với lỗi nghiệp vụ `{ code: "MFA_LAST_FACTOR" }` trước khi thực hiện bất kỳ thao tác ghi nào xuống DB. Factor duy nhất vẫn duy trì trạng thái `ACTIVE`.
   - **Multi-Factor Operation:**
     - Đăng ký và kích hoạt thêm factor thứ hai (Factor B) trước khi thực hiện thu hồi Factor A.
     - Thực hiện thu hồi Factor A: cập nhật trạng thái trong `mfa_credentials` thành `REVOKED`.
     - Xác minh Factor A là `REVOKED` nhưng factor đối chứng (Factor B) vẫn duy trì trạng thái `ACTIVE`.
     - Ghi nhận sự kiện `MFA_FACTOR_REVOKED` kèm `resource_id = factorA.credentialId` vào bảng `auth_security_events`.
   - **Postcondition Check:**
     - Thử thu hồi Factor B (nay là factor hoạt động duy nhất còn lại): tiếp tục bị reject với lỗi `MFA_LAST_FACTOR`. Factor B vẫn an toàn ở trạng thái `ACTIVE`.

---

## 5. Kết quả thực thi Quality Gates và Bằng chứng Runtime Test

### 5.1. Quality Gates (Static & Unit)

1. **Guard Unit Tests:**
   - Lệnh: `npm run test:database:guard` (tại `backend/`)
   - Kết quả: `pass 157, fail 0, skipped 0, duration: 1615ms`.
   - Bao gồm 2 regression tests mới:
     - `✔ M03-REG-01: Runtime test path allowlist accepts mfaPersistence.test.ts`
     - `✔ M03-REG-02: Non-allowlisted arbitrary mfa test path continues to be rejected fail-closed`

2. **TypeScript Typecheck:**
   - Lệnh: `npm run typecheck` (tại `backend/`)
   - Kết quả: `Exit code: 0` (0 lỗi).

3. **TypeScript Build:**
   - Lệnh: `npm run build` (tại `backend/`)
   - Kết quả: `tsc -p tsconfig.build.json` hoàn thành thành công, `Exit code: 0`.

4. **Git Diff Check (Whitespace & Formatting):**
   - Lệnh: `git diff --check`
   - Kết quả: `Exit code: 0` (không có lỗi khoảng trắng hoặc newline dư thừa).

### 5.2. Bằng chứng kiểm chứng Runtime PostgreSQL Disposable (Inherited Evidence)

Bằng chứng thực thi kế thừa từ phiên kiểm chứng runtime M03-02 (không chạy lại trong phiên review/checkpoint):

- **Admin Container:**
  - Container name: `m03-02-postgres-c6339966`
  - Image: `postgres:16` (local cache)
  - Port binding: `127.0.0.1:5436:5432`
  - Ready check: `pg_isready -U postgres` PASS.
- **Canonical Test Execution:**
  - Lệnh: `$env:DATABASE_TEST_ADMIN_URL="postgresql://postgres:[REDACTED]@127.0.0.1:5436/postgres"; npm run test:mfa:persistence`
  - Schema migration: 40/40 migrations áp dụng thành công trên cơ sở dữ liệu tạm thời (từ `001_banking_mvp` đến `040_card_security_and_suspense_retry`).
  - Kết quả kiểm thử (3 top-level tests, 0 suites):
    ```
    ✔ persistent MFA lifecycle is transactional, one-time and restart-safe (1076.1187ms)
    ✔ rotate recovery codes revokes old codes, persists new active batch and records security event (1091.2934ms)
    ✔ revoke credential guards against removing last active factor and revokes chosen factor cleanly (891.1933ms)
    ℹ tests 3
    ℹ suites 0
    ℹ pass 3
    ℹ fail 0
    ℹ cancelled 0
    ℹ skipped 0
    ℹ todo 0
    ℹ duration_ms 3546.7213
    ```
  - Exit code: `0`.
- **Dọn dẹp môi trường (Cleanup Verification):**
  - Dừng container: `docker stop m03-02-postgres-c6339966` -> thành công.
  - Xóa container kèm volume: `docker rm -v m03-02-postgres-c6339966` -> thành công.
  - Kiểm tra xác minh: `docker ps -a --filter "name=m03-02-postgres"` -> trả về rỗng (0 container còn tồn tại).

---

## 6. Phạm vi thay đổi (Files Impacted)

| STT | File | Thay đổi |
|---|---|---|
| 1 | `backend/src/database/disposableDatabaseGuard.ts` | Thêm `"src/tests/mfaPersistence.test.ts"` vào `APPROVED_TEST_PATHS`. |
| 2 | `backend/src/tests/disposableDatabaseGuard.test.ts` | Thêm 2 unit tests `M03-REG-01` và `M03-REG-02` kiểm tra allowlist. |
| 3 | `backend/src/tests/mfaPersistence.test.ts` | Bổ sung 2 tests kiểm chứng relational persistence cho `rotateRecoveryCodes` và `revokeCredential`. |
| 4 | `tasks/UC-M03/TASK_M03_02_VERIFY_MFA_RELATIONAL_PERSISTENCE.md` | Tài liệu nhiệm vụ M03-02 (tạo mới và chuẩn hóa). |

---

## 7. Đánh giá khoảng trống còn lại của UC-M03 (Remaining Gaps)

Mặc dù tầng relational persistence và nghiệp vụ cốt lõi của MFA đã được kiểm chứng đầy đủ trên cơ sở dữ liệu PostgreSQL thực tế, Use Case UC-M03 vẫn ở trạng thái **`INCOMPLETE`** do còn các khoảng trống cần đánh giá và xử lý ở các task tiếp theo:

1. **OpenAPI & Contract Documentation:**
   - Các endpoint MFA tự phục vụ/quản trị phương thức xác thực (`/auth/mfa/totp/enroll`, `/auth/mfa/totp/confirm`, `/auth/mfa/recovery-codes/rotate`, và endpoint xóa phương thức `DELETE /auth/mfa/methods/:id`) cần được rà soát và đối soát đầy đủ trong schema `documents/api/banking-mvp.openapi.yaml`.
2. **Mobile App Screen & UI Integration:**
   - Các màn hình MFA phía Mobile Client đã tồn tại trong mã nguồn: `MfaMethodsScreen` (`mobile-app/src/features/auth/screens/MfaMethodsScreen.tsx`, route `/mfa`) và `MfaRecoveryScreen` (`mobile-app/src/features/auth/screens/MfaRecoveryScreen.tsx`, route `/(auth)/recover`). Tuy nhiên, các màn hình này chưa có bộ kiểm thử nghiệm thu UI/E2E và coverage hoàn chỉnh.
   - Về phía client, mã recovery code chỉ được hiển thị một lần cho người dùng lưu ngoại tuyến (offline safe keeping), hoàn toàn không yêu cầu lưu trữ plaintext recovery codes trên thiết bị client.
3. **HTTP Relational Integration Boundary:**
   - Kiểm thử boundary HTTP cho các endpoint MFA kết hợp cơ sở dữ liệu relational thực tế (thay vì chỉ unit test ở tầng PersistentMfaService) là khoảng trống đã nhận diện để đánh giá trong roadmap, không nâng thành điều kiện bắt buộc để hoàn thành task persistence M03-02 này.

---

## 8. Trạng thái kết luận

- **Task M03-02:** `COMPLETED — VERIFIED`.
- **Use Case UC-M03:** `INCOMPLETE` (chờ các task tiếp theo hoàn thiện contract và Mobile UI).
- **Working Tree:** Giữ nguyên 3 file sửa đổi và 1 file tài liệu mới tạo, tiến hành commit checkpoint theo quyết định của Owner.

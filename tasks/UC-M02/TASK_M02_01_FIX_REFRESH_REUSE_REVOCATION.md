# TASK_M02_01 — Fix Refresh-Token Reuse Revocation

> **Trạng thái:** COMPLETED — VERIFIED.
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
  - Git HEAD: `98f8a1857910f4067828714f8a786e4a77928072`
  - Git status:
    - `modified: PROJECT_CONTEXT.md` (bổ sung pointer trỏ tới `USE_CASE_ROADMAP.md`)
    - `untracked: USE_CASE_ROADMAP.md` (danh mục 22 use case đề xuất)
    - Index clean; không có WIP source/test nào khác.
- **Mục đích:** Dự án mobile banking academic/reference implementation dùng dữ liệu tổng hợp (synthetic) và tiền ảo, hướng tới kiểm thử local. Không phải hệ thống xử lý tiền thật hay pilot đã xác minh.
- **Tài liệu đã đối soát:**
  - `AGENTS.md`
  - `PROJECT_CONTEXT.md`
  - `USE_CASE_ROADMAP.md`
  - `TASK_TEMPLATE.md`
  - `backend/README.md`
  - `documents/api/auth-session-api-contract.md`
  - `documents/api/banking-mvp.openapi.yaml`

---

## 2. Chế độ làm việc và quyền Git

- **Chế độ làm việc:** `IMPLEMENT_AND_VERIFY`
- **Diễn giải quyền sửa:** Được phép kiểm tra, áp dụng minimal fix trên `backend/src/database/relationalAuthService.ts`, tạo tối đa 2 file test backend liên quan trực tiếp, và tạo file task này.
- **Git add/stage:** Không trong phiên này.
- **Commit:** Không trong phiên này.
- **Push:** Không.
- **Merge/rebase/tag:** Không.
- **Quyền ngoài repository:**
  - Network/dịch vụ bên thứ ba: Không.
  - Deploy/provision/mua dịch vụ: Không.
  - Bật worker/scheduler: Không.
  - Destructive database operation: Chỉ trên database disposable `banking_test_*` được guard bảo vệ trên PostgreSQL 16 local/Docker loopback.
- Bảo toàn tuyệt đối mọi WIP hiện có (không reset, restore, clean hay overwrite).

---

## 3. Nhiệm vụ lần này

- **Tên nhiệm vụ:** Sửa lỗi rollback khi thu hồi token family do phát hiện refresh-token reuse trong `RelationalAuthService`.
- **Mục tiêu:** Đảm bảo khi một refresh token đã xoay vòng (rotated) bị gửi lại (replay/reuse), hệ thống ghi nhận và commit bền vững việc thu hồi (revocation) toàn bộ token family vào cơ sở dữ liệu PostgreSQL, đồng thời vẫn trả về mã lỗi HTTP `401 Unauthorized` theo đúng contract.
- **Ưu tiên:** `P1`
- **Lý do ưu tiên:** Lỗ hổng logic bảo mật phiên (session security & replay prevention) thuộc UC-M02: nếu việc thu hồi bị rollback, kẻ tấn công hoặc tiến trình replay có thể tiếp tục sử dụng token kế tiếp (R1) mà không bị vô hiệu hóa, vi phạm contract DRAFT v0.2 tại `documents/api/auth-session-api-contract.md`.

---

## 4. Hành vi và cách tái hiện

- **Hành vi hiện tại:**
  Trong `backend/src/database/relationalAuthService.ts:208-215`:
  Khi phát hiện refresh token tái sử dụng (`row.revoked_at || row.refresh_revoked_at`), service thực thi 3 câu lệnh SQL `UPDATE` để thu hồi `auth_sessions`, `refresh_session_families`, và `refresh_session_records`. Tuy nhiên, service ngay sau đó ném lỗi `throw unauthorized("Refresh token reuse detected.");` trực tiếp bên trong callback của `this.unitOfWork.transaction()`.
  Lớp `UnitOfWork` bắt ngoại lệ này và gọi `client.query("ROLLBACK")`, khiến toàn bộ các câu lệnh `UPDATE` thu hồi bị hủy bỏ trong transaction của PostgreSQL. Kết quả là client nhận được 401 nhưng token family và token kế tiếp vẫn còn hiệu lực trong database.
- **Hành vi mong muốn:**
  - Request refresh với token đã xoay vòng bị từ chối với HTTP 401 (`unauthorized("Refresh token reuse detected.")`).
  - Việc thu hồi (revocation) của token family, auth sessions, và refresh session records tương ứng PHẢI ĐƯỢC COMMIT bền vững vào PostgreSQL.
  - Token kế tiếp (R1) cùng family không còn khả năng làm mới phiên (refresh tiếp tục trả về 401).
  - Các family khác của cùng khách hàng không bị ảnh hưởng.
  - Lỗi database ngoài dự kiến vẫn phải kích hoạt rollback đầy đủ, không nuốt lỗi.
- **Cách tái hiện:**
  1. Tạo khách hàng và cấp phiên ban đầu với refresh token R0 (family F1).
  2. Thực hiện refresh R0 -> nhận token mới R1 (R0 chuyển sang trạng thái đã xoay vòng).
  3. Replay R0 với đúng device binding -> service trả về 401.
  4. Truy vấn trực tiếp database trên connection mới: kiểm tra `revoked_at` của family F1 và thử refresh bằng R1. Trên code hiện tại: `revoked_at` vẫn là NULL và R1 vẫn refresh thành công (BUG).

---

## 5. Môi trường và evidence

- **Môi trường mục tiêu:**
  - Hệ điều hành: Windows 10/11 x64
  - Node.js: v22.15.0+
  - Docker Desktop: 28.4.0
  - PostgreSQL image local: `postgres:16` (Image ID: `c6b1bbedb6ef`)
  - Commit baseline: `98f8a1857910f4067828714f8a786e4a77928072`
- **Call path CodeGraph:**
  `POST /auth/refresh`
  -> `relationalHttpBoundary.refresh(refreshToken, deviceId)`
  -> `RelationalAuthService.refresh(refreshToken, deviceId)`
  -> `UnitOfWork.transaction(callback)`
  -> PostgreSQL `BEGIN ... UPDATE ... ROLLBACK (hiện tại) / COMMIT (mong muốn)`.

---

## 6. Phạm vi

- **Được phép kiểm tra:** Toàn bộ repository `backend/`, `documents/api/`, `tasks/`.
- **Được phép sửa:**
  - `backend/src/database/relationalAuthService.ts` (minimal fix logic rollback/commit khi reuse token).
  - Tối đa 2 file test regression backend liên quan trực tiếp (`src/tests/authContract.test.ts`, `src/tests/authRelational.test.ts`).
  - `backend/src/database/disposableDatabaseGuard.ts` (DUY NHẤT 2 dòng được Owner phê duyệt bổ sung: thêm `src/tests/authRelational.test.ts` vào `APPROVED_TEST_PATHS` và nhận diện target `authRelational` để trỏ `RELATIONAL_DATABASE_URL`).
  - Tạo file task này: `tasks/UC-M02/TASK_M02_01_FIX_REFRESH_REUSE_REVOCATION.md`.
- **Không được thay đổi:**
  - Logic cốt lõi của `UnitOfWork`, transaction retry, pool, hoặc cơ chế bảo vệ an toàn của disposable database guard (không bypass, không nới lỏng timeout/cleanup).
  - Schema, migration SQL, OpenAPI contracts, hoặc external dependencies.
  - Mobile app, Maestro, login MFA, hoặc use case khác.
  - `PROJECT_CONTEXT.md`, `USE_CASE_ROADMAP.md`, hoặc tài liệu UC-M01.

---

## 7. Source of truth và xử lý xung đột

- **Contract bảo mật phiên:** `documents/api/auth-session-api-contract.md` Mục 4: *"Do đó refresh-token reuse trả 401 vẫn phải commit việc revoke token family; login/challenge trả 401 hoặc 429 vẫn phải commit failure counter/lockout. Không được dùng quy tắc chung kiểu mọi 4xx đều commit hoặc mọi 4xx đều rollback."*
- **Database Schema:** `backend/database/005_relational_reference_runtime.sql` (bảng `auth_sessions`, `refresh_session_families`, `refresh_session_records`).
- **Phê duyệt bổ sung phạm vi từ Owner (Scope Adjustment Approval):**
  Runner `backend/scripts/run-disposable-postgres-test.ts` sử dụng danh sách cố định `APPROVED_TEST_PATHS` và bộ ánh xạ biến môi trường trong `backend/src/database/disposableDatabaseGuard.ts`.
  Để chạy test relational mới (`src/tests/authRelational.test.ts`) qua canonical disposable runner mà không bypass guard, Owner đã phê duyệt bổ sung phạm vi giới hạn:
  1. Thêm `"src/tests/authRelational.test.ts"` vào mảng `APPROVED_TEST_PATHS`.
  2. Bổ sung `"authRelational"` vào danh sách test nhận diện `RELATIONAL_DATABASE_URL` trong hàm `runDisposablePostgresTest`.
  *Lưu ý bảo toàn lịch sử:* Đây là phê duyệt bổ sung có chủ đích của Owner trong quá trình thực thi, không phải được cấp quyền ngay từ preflight ban đầu. Không sửa đổi bất kỳ logic guard, cleanup hay timeout nào khác.

---

## 8. Ma trận kiểm thử tối thiểu (Test Matrix)

### A. Valid Rotation & Reuse Revocation
- Tạo khách hàng synthetic và phiên ban đầu R0 trên Device A (Family A).
- Refresh R0 -> R1 thành công (200 OK), cấp access token và refresh token mới.
- Replay R0 với đúng device binding -> nhận 401 "Refresh token reuse detected.".
- Kiểm tra trạng thái bền vững trong database: `refresh_session_families`, `auth_sessions`, và `refresh_session_records` của Family A đều có `revoked_at IS NOT NULL`.
- Thử nghiệm refresh bằng R1 hoặc xác thực bằng access token của Family A -> bị từ chối 401 vì token family đã bị thu hồi.

### B. Pre-existing Session Isolation & Mismatched Device Binding
- **Khởi tạo tiền điều kiện (CRITICAL REQUIREMENT):** Tạo đồng thời cả Family A (Device A) và Family B (Device B) cho cùng một khách hàng *trước* khi replay token của Family A.
- Xác nhận Family B đang hoạt động bình thường (access token xác thực thành công).
- Replay rotated token R0 trên Device A: hệ thống phát hiện reuse, thu hồi Family A và commit vào DB.
- **Kiểm chứng cách ly (Isolation):**
  - Family B tồn tại từ trước hoàn toàn KHÔNG bị thu hồi (`refresh_session_families.revoked_at IS NULL`).
  - Access token của Family B vẫn tiếp tục xác thực thành công.
  - Refresh token của Family B tiếp tục xoay vòng thành công (B0 -> B1).
- **Mismatched Device Binding:**
  - Gửi refresh token của Family B (Device B) kèm header `x-device-id` của Device A.
  - Yêu cầu bị từ chối ngay với HTTP 401 "Refresh token is invalid." mà KHÔNG làm thu hồi Family B hợp lệ.
  - Phiên trên Device B vẫn giữ nguyên trạng thái hoạt động.

### C. Rollback Safety & Unexpected DB Errors
- Khi xảy ra lỗi cơ sở dữ liệu ngoài dự kiến trong transaction, transaction phải rollback đầy đủ, không để lại dữ liệu dở dang và không phát hành token mới.

### D. Safe Assertion Standard
- Tuyệt đối không so sánh trực tiếp raw token string hay cryptographic secret trong các câu lệnh `assert` để tránh rò rỉ token nhạy cảm ra stdout/log khi test thất bại.
- Sử dụng các biểu thức boolean an toàn (`hasTokenA0`, `isDistinctTokenA`, `authA1Ok`, `hasTokenB0`, `authB0Ok`, `familyAPersistedRevoked`, `familyBStillUnrevoked`, `subsequentRefreshAFailed`, `authA1AfterRevokeFailed`, `authBStillValid`, `refreshBOk`, `deviceBStillActive`).

---

## 9. Hoàn thành khi (Acceptance Criteria)

- [x] Reproduction: Chứng minh bằng test rằng trên code chưa sửa, hành động thu hồi bị rollback (Unit: `mockClient.committed !== true`; Relational: `family.revoked_at` is NULL).
- [x] Minimal fix: `RelationalAuthService.refresh()` trả về outcome từ transaction, commit các câu lệnh thu hồi, sau đó ném `unauthorized(...)` ở ngoài transaction.
- [x] Ma trận kiểm thử A, B, C đạt 100% PASS (`authContract.test.ts` 3/3 PASS, `authRelational.test.ts` 1 top-level test PASS [tests: 1, suites: 0]).
- [x] Quality gates đạt: `npm run typecheck` PASS, `npm run build` PASS, `git diff --check` PASS.
- [x] Dọn dẹp sạch sẽ tài nguyên test disposable, 0 container hay database rò rỉ (container removed in `finally`).
- [x] UC-M02 ghi nhận hoàn thành M02-01 nhưng tổng thể UC-M02 vẫn là INCOMPLETE.

---

## 10. Bằng chứng thực thi và đối soát (Execution Evidence)

### 10.1. Red Phase — Tái hiện lỗi trên mã nguồn chưa sửa

#### A. Unit Contract Reproduction (`authContract.test.ts`)
- **Lệnh thực thi:**
  ```powershell
  npx tsx --test src/tests/authContract.test.ts
  ```
- **Kết quả:** Thất bại đúng tại assertion commit:
  ```text
  ✖ RelationalAuthService.refresh: reuse detection commits revocation and rejects with 401
    AssertionError [ERR_ASSERTION]: Transaction must COMMIT revocation mutations
    false !== true
    actual: false, expected: true
  ```
- **Phân tích:** Callback ném `unauthorized(...)` ngay trong transaction khiến `UnitOfWork` gọi `ROLLBACK`, `committed` bằng `false`.

#### B. Relational Reproduction trên PostgreSQL disposable (`authRelational.test.ts`)
- **Lệnh thực thi:**
  ```powershell
  node scripts/run-disposable-postgres-test.ts src/tests/authRelational.test.ts
  ```
  (Chạy trên ephemeral container loopback với 40 migrations được áp dụng thành công)
- **Kết quả:** Thất bại đúng tại assertion kiểm tra persistence:
  ```text
  ✖ relational auth suite: refresh rotation, reuse revocation persistence and session isolation
    AssertionError [ERR_ASSERTION]: CRITICAL: refresh_session_families.revoked_at MUST BE PERSISTED (not rolled back)
    actual: false, expected: true
  ```

---

### 10.2. Minimal Fix Implemented

Trong `backend/src/database/relationalAuthService.ts`:
- Trong transaction: khi phát hiện reuse (`row.revoked_at || row.refresh_revoked_at`), thực thi 3 câu lệnh `UPDATE` thu hồi (`auth_sessions`, `refresh_session_families`, `refresh_session_records`), sau đó trả về outcome có kiểu tường minh `{ kind: "REUSE_DETECTED" as const }`.
- Transaction hoàn tất và gọi `COMMIT` bền vững vào cơ sở dữ liệu.
- Sau khi transaction hoàn tất, kiểm tra outcome: nếu `kind === "REUSE_DETECTED"`, ném lỗi `DomainError` với mã HTTP `401 Unauthorized` (`"Refresh token reuse detected."`).
- Giữ nguyên toàn bộ logic rollback đối với các lỗi khác (device mismatch, expired token, unexpected DB errors).

---

### 10.3. Green Phase — Kiểm chứng sau khi sửa

#### A. Unit Contract Verification (`authContract.test.ts`)
- **Lệnh thực thi:**
  ```powershell
  node --import=tsx --test src/tests/authContract.test.ts
  ```
- **Kết quả:**
  ```text
  ✔ RelationalAuthService.refresh: reuse detection commits revocation and rejects with 401 (3.9668ms)
  ✔ RelationalAuthService.refresh: unexpected DB error triggers rollback and does not commit (0.6489ms)
  ✔ RelationalAuthService.refresh: device mismatch rejects with 401 and rolls back without revoking family (0.3485ms)
  ℹ tests 3, pass 3, fail 0, skipped 0
  ℹ duration_ms 258.1139
  ```

#### B. Relational Verification trên PostgreSQL disposable (`authRelational.test.ts`)
- **Lệnh thực thi (chạy duy nhất 1 lần qua canonical runner sau khi Owner phê duyệt bổ sung):**
  ```powershell
  node --import=tsx scripts/run-disposable-postgres-test.ts src/tests/authRelational.test.ts
  ```
- **Kết quả:**
  ```text
  PostgreSQL migration applied successfully: 001–040.
  ✔ relational auth suite: refresh rotation, reuse revocation persistence and pre-existing session isolation (116.27ms)
  ℹ tests 1, suites 0, pass 1, fail 0
  Exit code: 0
  ```
- **Tiêu chí kiểm chứng đạt được trong test:**
  1. `R0 -> R1` xoay vòng thành công (200 OK) trên Device A (Family A).
  2. Family B (Device B) được khởi tạo đồng thời cho cùng khách hàng *trước* khi replay token của Family A và được kiểm chứng đang hoạt động.
  3. Replay `R0` trả về 401 "Refresh token reuse detected.".
  4. `refresh_session_families.revoked_at` IS NOT NULL (đã commit vào DB).
  5. Mọi `auth_sessions` và `refresh_session_records` cùng Family A đều có `revoked_at` IS NOT NULL.
  6. Thử refresh bằng `R1` tiếp theo hoặc xác thực bằng access token của Family A bị từ chối 401 vì family đã thu hồi.
  7. Pre-existing Family B trên Device B vẫn hoàn toàn active (`revoked_at IS NULL`), access token của B0 xác thực thành công, và refresh token xoay vòng bình thường (`sessionB0` -> `sessionB1`).
  8. Mismatched device check: gửi refresh token của Family B với header Device A bị từ chối 401 "Refresh token is invalid." và không thu hồi Family B hợp lệ; Device B vẫn tiếp tục hoạt động.
  9. Safe assertions: Mọi so sánh token đều dùng boolean predicates an toàn, không rò rỉ credential ra log khi assert.

---

### 10.4. Static Gates & Verification Suites

1. `npm run typecheck` trong `backend`: PASS (0 errors).
2. `npm run build` trong `backend`: PASS (0 errors).
3. `node --import=tsx --test src/tests/disposableDatabaseGuard.test.ts`: PASS (153/153 tests pass, duration 765.77ms).
4. `node --import=tsx --test src/tests/authContract.test.ts`: PASS (3/3 tests pass).
5. `npm run test:critical` (HTTP auth suite): PASS (11/11 tests pass, duration 1320ms).
6. `git diff --check`: PASS (0 whitespace / formatting errors).

---

### 10.5. Cleanup Verification

- Ephemeral container khởi tạo trong phiên kiểm thử được dừng và gỡ bỏ hoàn toàn trong khối `finally`.
- Hậu kiểm `docker ps -a`: 0 container test đang chạy hoặc sót lại.
- Không để lại database disposable rò rỉ trên PostgreSQL loopback.

---

### 10.6. Kết luận & Trạng thái Use Case

- **M02-01:** `COMPLETED — VERIFIED`.
- **UC-M02:** `INCOMPLETE` (Các hạng mục khác như login flow, session restore, route guard, và logout/logout-all cần được đối soát và kiểm chứng theo các task tiếp theo).

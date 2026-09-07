# TASK_M02_03 — Verify Logout and Logout-All Relational Persistence

> **Trạng thái:** COMPLETED — VERIFIED (AT RELATIONAL SERVICE & UNIT CONTRACT TIERS).
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
  - Git HEAD: `b1453f76dc5d593d3d21f3eff5ba6d045011564b`
  - Git baseline:
    - `modified: PROJECT_CONTEXT.md` (bảo toàn baseline)
    - `untracked: USE_CASE_ROADMAP.md` (bảo toàn baseline)
    - Index clean; không có WIP source/test nào khác ngoài phạm vi.
- **Mục đích:** Dự án mobile banking academic/reference implementation dùng dữ liệu tổng hợp (synthetic) và tiền ảo, hướng tới kiểm thử local. Không phải hệ thống xử lý tiền thật hay pilot đã xác minh.
- **Tài liệu đã đối soát:**
  - `AGENTS.md` và `mobile-app/AGENTS.md`
  - `PROJECT_CONTEXT.md`
  - `USE_CASE_ROADMAP.md`
  - `TASK_TEMPLATE.md`
  - `backend/README.md`
  - `documents/api/auth-session-api-contract.md`
  - `documents/api/banking-mvp.openapi.yaml`
  - `tasks/UC-M02/TASK_M02_01_FIX_REFRESH_REUSE_REVOCATION.md`
  - `tasks/UC-M02/TASK_M02_02_SYNC_PASSWORD_ONLY_LOGIN_LOGOUT_E2E.md`

---

## 2. Chế độ làm việc và quyền Git

- **Chế độ làm việc:** `IMPLEMENT_AND_VERIFY`
- **Quyền sửa đổi:** Đúng các tệp tin trong allowlist được phê duyệt:
  - `backend/src/tests/authContract.test.ts` (bổ sung unit contract tests)
  - `backend/src/tests/authRelational.test.ts` (bổ sung relational integration tests)
  - `tasks/UC-M02/TASK_M02_03_VERIFY_LOGOUT_RELATIONAL.md` (tạo file task này)
- **Git add/stage:** Không trong phiên này.
- **Commit:** Không trong phiên này.
- **Push:** Không.
- **Bảo toàn tuyệt đối WIP:** Không sửa đổi, reset, clean hay commit `PROJECT_CONTEXT.md` và `USE_CASE_ROADMAP.md`.

---

## 3. Nhiệm vụ lần này

- **Tên nhiệm vụ:** Kiểm chứng thu hồi phiên đăng xuất hiện tại (logout) và đăng xuất tất cả thiết bị (logout-all) tại tầng cơ sở dữ liệu quan hệ Backend (PostgreSQL disposable).
- **Mục tiêu:**
  1. Kiểm chứng rằng `RelationalAuthService.revoke` thu hồi bền vững token family của thiết bị hiện tại trên cả 3 bảng: `auth_sessions`, `refresh_session_families`, và `refresh_session_records` (`revoked_at IS NOT NULL`).
  2. Kiểm chứng rằng token access và refresh của family bị thu hồi bị từ chối với HTTP 401 khi authenticate hoặc refresh tiếp theo.
  3. Kiểm chứng cách ly phiên (Session Isolation): Pre-existing Family B của cùng khách hàng hoàn toàn không bị ảnh hưởng và tiếp tục hoạt động bình thường.
  4. Kiểm chứng rằng `RelationalAuthService.revokeAllSessions` thu hồi bền vững mọi session thuộc khách hàng chỉ định, đồng thời bảo đảm cách ly khách hàng (Cross-Customer Isolation): session của khách hàng khác (V) giữ nguyên trạng thái hoạt động.
  5. Kiểm chứng biên (Boundary): Sai/khác device binding, token không tồn tại không làm thu hồi family hợp lệ; lặp lại logout hiện tại (idempotency); và xác nhận bearer token đã bị thu hồi bị từ chối khi gọi các thao tác xác thực tiếp theo.
  6. Ghi nhận audit events chính xác (`SESSION_REVOKED`, `ALL_SESSIONS_REVOKED`) với actor và resource hợp lệ.
- **Ưu tiên:** `P1`
- **Lý do ưu tiên:** Hoàn thiện bằng chứng tầng dữ liệu cốt lõi cho tính an toàn của vòng đời phiên (session lifecycle revocation persistence) thuộc Use Case UC-M02.

---

## 4. Hành vi và cách tái hiện

- **Hành vi được kiểm chứng:**
  - Khi gọi `revoke(refreshToken, deviceId)`:
    - Database truy vấn đúng bản ghi phiên theo hash của refresh token và so khớp với device binding đã đăng ký.
    - Cập nhật nguyên tử (`UPDATE ... SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL`) trên cả 3 bảng dữ liệu phiên.
    - Ghi nhận sự kiện audit `SESSION_REVOKED` với actor là customer ID và resource là family ID.
    - Transaction được `COMMIT` bền vững.
    - Gọi lại `revoke` với cùng token và deviceId tiếp tục trả về `true` (idempotent), giữ nguyên trạng thái đã thu hồi.
  - Khi gọi `revokeAllSessions(customerId)`:
    - Cập nhật nguyên tử trên 3 bảng phiên cho toàn bộ các bản ghi có `customer_id = $1`.
    - Ghi nhận sự kiện audit `ALL_SESSIONS_REVOKED`.
    - Toàn bộ token của khách hàng đó bị vô hiệu hóa; khách hàng khác không bị ảnh hưởng.
  - Khi token đã bị thu hồi:
    - Thao tác `authenticate(accessToken, deviceId)` trả về lỗi `DomainError` 401 (`"Access token is invalid or expired."`).
    - Thao tác `refresh(refreshToken, deviceId)` trả về lỗi `DomainError` 401.

---

## 5. Môi trường và bằng chứng thực thi

- **Hệ điều hành:** Windows 10/11 x64
- **Node.js:** v24.19.0 / v22+
- **PostgreSQL Target:** PostgreSQL 16 loopback (ephemeral Docker container `postgres:16`, `--tmpfs`, không dùng database remote/development).
- **Migration baseline:** 40 migrations (001_banking_mvp đến 040_card_security_and_suspense_retry) được áp dụng thành công qua canonical runner.
- **Safe Assertions:** Toàn bộ assertions sử dụng boolean predicates (`authAAfterRevoke`, `familyAPersistedRevoked`, `familyBStillUnrevoked`, `uSessionsAllRevoked`, `vFamiliesUnrevoked`), không in chuỗi token thô, password hay URL ra console/log.

---

## 6. Phân tầng bằng chứng (Tiered Evidence)

- **Tầng Unit Contract (`authContract.test.ts`): VERIFIED PASS (7/7 tests)**
  - Kiểm chứng hành vi transaction, các câu lệnh SQL UPDATE được sinh ra, điều kiện WHERE (`family_id`, `customer_id`), việc ghi nhận audit event và phản ứng khi token không tìm thấy hoặc sai device binding.
- **Tầng Relational Service (`authRelational.test.ts`): VERIFIED PASS (3/3 tests, 100% PASS)**
  - Chạy trên PostgreSQL disposable thật với đầy đủ 40 migrations:
    1. Test 1: Refresh rotation, reuse revocation persistence & pre-existing family isolation (kế thừa từ M02-01).
    2. Test 2: Logout current device, relational persistence trên 3 bảng session, audit event persistence, token invalidation, pre-existing Family B isolation, và repeated revoke idempotency (Matrix A & C).
    3. Test 3: Logout-all sessions, relational persistence, audit event persistence, token invalidation, cross-customer isolation giữa Customer U và V, và bearer revocation boundary (Matrix B & C).
- **Tầng HTTP Boundary: CHƯA KIỂM CHỨNG TẠI RELATIONAL-V2 HTTP LAYER TRONG M02-03**
  - Trong test hiện có, `http.test.ts` kiểm tra HTTP 204 cho `/auth/logout` và `/auth/logout-all` trên in-memory mock `BankingSystem`, chưa có HTTP suite chạy qua `RelationalHttpBoundary` kết nối PostgreSQL disposable.
  - Khoảng trống này được ghi nhận rõ ràng: M02-03 nghiệm thu tầng Relational Service và Unit Contract. Tầng HTTP routing relational-v2 vẫn là phần việc tiếp theo của UC-M02.

---

## 7. Quyết định Hợp đồng (Contract Clarification)

Theo phê duyệt của Owner:
1. **Logout hiện tại (`POST /auth/logout`):**
   - Gọi với refresh token và device binding hợp lệ: Trả về HTTP 204.
   - Lặp lại với cùng token đã thu hồi và device binding hợp lệ: Implementation tìm thấy row theo hash và device ID, thực thi update an toàn (0 rows affected) và trả về `true` $\rightarrow$ HTTP 204 No Content (giữ nguyên tính idempotent theo OpenAPI và Contract DRAFT v0.2).
2. **Logout tất cả thiết bị (`POST /auth/logout-all`):**
   - Gọi với Bearer token và device binding hợp lệ: Trả về HTTP 204 No Content, thu hồi toàn bộ session của khách hàng.
   - Gọi lại với cùng Bearer token đã bị thu hồi: Route được bảo vệ bởi `requireBearer`, hàm này gọi `authenticate()` và từ chối token có `revoked_at IS NOT NULL` $\rightarrow$ Trả về **HTTP 401 Unauthorized** (`"Access token is invalid or expired."`).
   - *Nguyên tắc:* Idempotency của việc thu hồi không đồng nghĩa với việc một Bearer token đã bị thu hồi được phép vượt qua tầng authentication. Quyết định này được giữ nguyên và ghi nhận tại đây.

---

## 8. Ma trận kiểm thử thực tế (Test Matrix & Assertion Results)

| Ma trận | Kịch bản kiểm thử | Tầng thực thi | Điều kiện khẳng định an toàn | Kết quả |
| :--- | :--- | :--- | :--- | :--- |
| **Matrix A** | Logout current device Family A | Relational PG | `authSessionsAPersistedRevoked && familyAPersistedRevoked && refreshRecordsAPersistedRevoked` | **PASS** |
| **Matrix A** | Audit `SESSION_REVOKED` | Relational PG | `hasAuditSessionRevoked === true` với đúng actor U và resource Family A | **PASS** |
| **Matrix A** | Family A tokens invalidation | Relational PG | `authAAfterRevoke === true` (401) và `refreshAAfterRevoke === true` (401) | **PASS** |
| **Matrix A** | Pre-existing Family B isolation | Relational PG | `familyBStillUnrevoked === true` && `authBStillActive === true` && `refreshBStillWorks === true` | **PASS** |
| **Matrix B** | Logout-all Customer U | Relational PG | `uSessionsAllRevoked && uFamiliesAllRevoked && uRecordsAllRevoked` (>= 2 families) | **PASS** |
| **Matrix B** | Audit `ALL_SESSIONS_REVOKED` | Relational PG | `auditU.rows.length > 0` với đúng actor U | **PASS** |
| **Matrix B** | Customer U tokens invalidation | Relational PG | Cả 2 access tokens và 2 refresh tokens của U đều bị từ chối 401 | **PASS** |
| **Matrix B** | Cross-Customer Isolation (U vs V) | Relational PG | `vFamiliesUnrevoked === true` && `authVCAfter === true` && `refreshVCWorks === true` | **PASS** |
| **Matrix C1** | Mismatched device id trong revoke | Relational PG | `wrongDeviceRevoke === false`, Family A vẫn active | **PASS** |
| **Matrix C2** | Unknown token trong revoke | Relational PG | `unknownTokenRevoke === false` | **PASS** |
| **Matrix C3** | Repeated current logout | Relational PG | `repeatedRevokeA === true`, Family A giữ nguyên trạng thái revoked | **PASS** |
| **Matrix C4** | Revoked bearer boundary | Relational PG | `bearerRevokedStatus === 401` | **PASS** |
| **Unit** | Revoke SQL & audit contract | Unit Mock | 4 tests mới: matching revoke, unknown token, mismatched device, revokeAllSessions | **PASS** |

*Ghi chú định lượng runner:*
- `authContract.test.ts`: 7 top-level tests (7 pass, 0 fail).
- `authRelational.test.ts`: 3 top-level tests (3 pass, 0 fail).

---

## 9. Hoàn thành khi (Acceptance Criteria)

- [x] Không sửa đổi mã nguồn production, UnitOfWork, guard, schema, migration, hoặc Mobile app.
- [x] Ma trận A (Logout current & pre-existing isolation) kiểm chứng thành công và persist vào PostgreSQL.
- [x] Ma trận B (Logout-all & cross-customer isolation) kiểm chứng thành công và persist vào PostgreSQL.
- [x] Ma trận C (Boundary checks: wrong device, unknown token, idempotency, revoked bearer) kiểm chứng thành công.
- [x] Quality gates đạt 100%: `npm run typecheck` PASS, `npm run build` PASS, `git diff --check` PASS.
- [x] Đúng một lần chạy suite relational trên PostgreSQL disposable hoàn thành với exit code 0.
- [x] Dọn dẹp sạch sẽ tài nguyên ephemeral container trong khối `finally` (0 container rò rỉ).
- [x] Ghi nhận phân tầng bằng chứng và làm rõ quyết định hợp đồng cho Bearer authentication.
- [x] Giữ nguyên baseline working tree (`PROJECT_CONTEXT.md`, `USE_CASE_ROADMAP.md`).
- [x] Nhiệm vụ M02-03 hoàn thành; tổng thể UC-M02 vẫn là INCOMPLETE.

---

## 10. Bằng chứng thực thi chi tiết (Execution Logs)

### 10.1. Static Quality Gates
1. **Typecheck:**
   ```text
   > banking-reference-backend@0.1.0 typecheck
   > tsc --noEmit
   Exit code: 0
   ```
2. **Build:**
   ```text
   > banking-reference-backend@0.1.0 build
   > tsc -p tsconfig.build.json
   Exit code: 0
   ```
3. **Whitespaces check:**
   ```powershell
   git diff --check
   ```
   *Kết quả:* Exit code 0 (không có trailing whitespace hay lỗi EOF).

### 10.2. Unit Contract Suite (`authContract.test.ts`)
```text
✔ RelationalAuthService.refresh: reuse detection commits revocation and rejects with 401 (13.6343ms)
✔ RelationalAuthService.refresh: unexpected DB error triggers rollback and does not commit (0.9881ms)
✔ RelationalAuthService.refresh: device mismatch rejects with 401 and rolls back without revoking family (0.4284ms)
✔ RelationalAuthService.revoke: valid token and matching device commits revocation on session tables and appends audit (0.8285ms)
✔ RelationalAuthService.revoke: unknown token returns false without executing updates (0.5931ms)
✔ RelationalAuthService.revoke: mismatched device returns false without revoking family (0.5868ms)
✔ RelationalAuthService.revokeAllSessions: updates all sessions for customer and appends audit event (0.5626ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ duration_ms 696.1941
```

### 10.3. Relational Integration Suite (`authRelational.test.ts`)
```text
PostgreSQL migration applied successfully: 001_banking_mvp đến 040_card_security_and_suspense_retry.
✔ relational auth suite: refresh rotation, reuse revocation persistence and pre-existing session isolation (191.4336ms)
✔ relational auth suite: logout current device, relational persistence, and pre-existing session isolation (Matrix A & C) (156.8782ms)
✔ relational auth suite: logout all sessions, cross-customer isolation, and bearer boundary (Matrix B & C) (222.3148ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
Exit code: 0
```

### 10.4. Dọn dẹp tài nguyên (Cleanup Verification)
- Ephemeral PostgreSQL container được khởi tạo và hủy tự động trong khối `finally` của kịch bản thực thi.
- Hậu kiểm qua lệnh `docker ps -a` xác nhận không còn container kiểm thử nào sót lại.

---

## 10.5. Kết luận & Trạng thái Use Case

- **M02-03:** `COMPLETED — VERIFIED (AT RELATIONAL SERVICE & UNIT CONTRACT TIERS)`.
- **UC-M02:** `INCOMPLETE` (Các hạng mục tiếp theo: HTTP boundary verification cho relational-v2 logout nếu cần, session restore khi khởi động lại ứng dụng, route guard và tự động refresh token trong interceptor).

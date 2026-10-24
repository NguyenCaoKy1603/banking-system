# BÁO CÁO KIỂM CHỨNG THỰC TẾ SUITE POSTGRESQL DISPOSABLE

**Thời điểm thực hiện:** 2026-09-22T20:21:20+07:00  
**Môi trường:** Local Windows 11 (Docker Desktop Engine 28.4.0 active)  
**Git HEAD:** `9c585ce336ee5867557f89862bc8e07be3c0ca83`  
**Git Branch:** `codex/staging-academic-completion`  
**Tình trạng Working Tree:** Giữ nguyên toàn bộ WIP và untracked files hiện có.  

---

## 1. Kết luận Kiểm thử

- **Trạng thái:** **`PASS` (Hoàn tất nghiệm thu thực tế trên PostgreSQL disposable)**
- **Số test thực tế chạy:** **1/1 test PASS (100%)** qua runner chính thức `npm run test:assistant:database`.
- **Kết quả Migration:** **40/40 migration PASS** (Áp dụng thành công toàn bộ schema từ `001_banking_mvp` đến `040_card_security_and_suspense_retry` trên PostgreSQL 16 thật).
- **Phân loại kết quả tổng thể:**
  - 36 bài kiểm thử phần mềm offline: **PASS 36/36** (13 Unit + 13 HTTP + 9 Eval + 1 Dist Independence).
  - Bộ đánh giá 56 ca synthetic: **0 PASS, 56 NEEDS_REVIEW, 0 ERROR** (giữ nguyên chờ thẩm định ngữ nghĩa).
  - Kiểm thử tích hợp PostgreSQL disposable: **PASS 1/1 test**.

---

## 2. Diễn biến Triển khai và Khắc phục

### 2.1. Cập nhật Tối thiểu Security Guard được Phê duyệt
Theo chỉ thị của Owner, đã thực hiện sửa đổi tối thiểu 1 dòng tại [backend/src/database/disposableDatabaseGuard.ts (line 1217)](file:///C:/Projects/banking-system/backend/src/database/disposableDatabaseGuard.ts#L1217), bổ sung `"assistantHelpRelational"` vào mảng ánh xạ sang biến môi trường `RELATIONAL_DATABASE_URL`:
- Giữ nguyên toàn bộ allowlist `APPROVED_TEST_PATHS` và các cơ chế kiểm tra an toàn.
- Không sửa schema, migration hoặc bất kỳ logic nghiệp vụ nào.
- Kiểm tra hồi quy chất lượng:
  - `npm run typecheck` → **PASS** (0 errors).
  - `npm run test:database:guard` → **PASS 157/157 tests** (bảo đảm toàn bộ các quy tắc bảo mật của guard tiếp tục hoạt động chính xác).

### 2.2. Khởi tạo Container PostgreSQL Disposable
- **Image chuẩn:** `postgres:16@sha256:c1b3783309b6499c795eed7c20135a1a4d25cae1b575c3d52c6f536129a1b109` (Image ID: `c1b3783309b6` từ `compose.yaml`).
- **Container tạm:** `banking-assistant-disposable-pg-test` tại `127.0.0.1:5433:5432`.
- **Kiểm tra readiness:** `pg_isready -U postgres -d postgres` phản hồi sẵn sàng nhận kết nối.

### 2.3. Thực thi Kiểm thử qua Runner Chính thức
Lệnh chạy đã khử credential:
```powershell
$env:DATABASE_TEST_ADMIN_URL = "postgresql://postgres:[REDACTED]@127.0.0.1:5433/postgres"
$env:ALLOW_DATABASE_TEST_RESET = "1"
npm run test:assistant:database
```

Log thực thi thực tế:
```text
> banking-reference-backend@0.1.0 test:assistant:database
> node --import=tsx scripts/run-disposable-postgres-test.ts src/tests/assistantHelpRelational.database.test.ts

PostgreSQL migration applied successfully: 001_banking_mvp (f0d76fa04b31).
PostgreSQL migration applied successfully: 002_savings_sandbox (fde0071d313c).
PostgreSQL migration applied successfully: 003_credit_sandbox (170b0362f781).
PostgreSQL migration applied successfully: 004_credit_unlock_policy (bb7926b8ddee).
PostgreSQL migration applied successfully: 005_relational_reference_runtime (26133bf46450).
PostgreSQL migration applied successfully: 006_relational_v2_foundation (e5de36e31fc6).
PostgreSQL migration applied successfully: 007_identity_runtime_normalization (0e61dea3c5b0).
PostgreSQL migration applied successfully: 008_transfer_relational_v2 (86cdc848d15b).
PostgreSQL migration applied successfully: 009_savings_relational_v2 (4d55c2e573ff).
PostgreSQL migration applied successfully: 010_credit_relational_v2 (cb9627c165c9).
PostgreSQL migration applied successfully: 011_registration_recovery (689f26c29b15).
PostgreSQL migration applied successfully: 012_outbox_worker (ee4ce322e5d4).
PostgreSQL migration applied successfully: 013_outbox_worker_operations (35981b784640).
PostgreSQL migration applied successfully: 014_mfa_credentials (fd56aaaef2d8).
PostgreSQL migration applied successfully: 015_auth_challenge_hardening (76660d30ce83).
PostgreSQL migration applied successfully: 016_mfa_recovery (5f4fd4403b14).
PostgreSQL migration applied successfully: 017_auth_security_events (cae806085300).
PostgreSQL migration applied successfully: 018_mfa_challenge_constraints (5cd13d0b0231).
PostgreSQL migration applied successfully: 019_admin_control_plane (79d8565a1645).
PostgreSQL migration applied successfully: 020_admin_case_operations (e3ddaa7581ab).
PostgreSQL migration applied successfully: 021_admin_bootstrap_guard (96637c3e1539).
PostgreSQL migration applied successfully: 022_admin_policy_alignment (82947a2864d2).
PostgreSQL migration applied successfully: 023_admin_roles_rls_and_domain_adapters (dd371f8ea13d).
PostgreSQL migration applied successfully: 024_admin_staff_invite_workflow (433910ccf91c).
PostgreSQL migration applied successfully: 025_admin_case_scope_alignment (8a5468854ee5).
PostgreSQL migration applied successfully: 026_secret_envelope_metadata (5025ff6b4b41).
PostgreSQL migration applied successfully: 027_secret_rotation_inventory (bcb8157f92f8).
PostgreSQL migration applied successfully: 028_dr_recovery_markers (6007d8f69a92).
PostgreSQL migration applied successfully: 029_savings_products_relational_v2 (2d20d884f56c).
PostgreSQL migration applied successfully: 030_credit_relational_v2_cutover (ec1415158d42).
PostgreSQL migration applied successfully: 031_remaining_relational_v2 (1e16ae373569).
PostgreSQL migration applied successfully: 032_relational_scheduled_lifecycle (f068e49b8405).
PostgreSQL migration applied successfully: 033_control_policy_bootstrap (c4e27058fa45).
PostgreSQL migration applied successfully: 034_policy_entitlements_login_rate_limit (0e5d7b134120).
PostgreSQL migration applied successfully: 035_credit_cycle_start (4bd42f63b0d7).
PostgreSQL migration applied successfully: 036_beneficiary_lifecycle (0f20368a0ebd).
PostgreSQL migration applied successfully: 037_transfer_counterparty_snapshots (3e31f8b8d43c).
PostgreSQL migration applied successfully: 038_customer_kyc_runtime (a2627c2ad0ee).
PostgreSQL migration applied successfully: 039_lifecycle_suspense_and_keyset_indexes (131ed47e9c06).
PostgreSQL migration applied successfully: 040_card_security_and_suspense_retry (ae32b37b1b7f).
✔ PostgreSQL Relational / Assistant HTTP: Xác thực phiên relational thật, giải phóng pool và không thay đổi nghiệp vụ (206.8677ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 684.0657
```

---

## 3. Các Hành vi Kỹ thuật Được Chứng minh Thực tế

1. **Xác thực phiên làm việc relational thật:**
   - Dữ liệu khách hàng thật (`customers`) và thiết bị thật (`customer_devices`, `auth_sessions`) được tạo trực tiếp trên PostgreSQL qua `RelationalAuthService`.
   - Gọi không có Bearer token trả về 401; gọi kèm Bearer token hợp lệ trả về 200 `{ answer }` chuẩn contract.
2. **Thứ tự transaction và giải phóng connection pool:**
   - Transaction xác thực auth hoàn tất trước khi Provider bắt đầu xử lý (`authFinishedAt <= providerStartedAt`).
   - `FakeAssistantHelpProvider` được giữ ở trạng thái chờ có kiểm soát (60ms delay); ngay trong lúc provider đang chờ, kết nối đã được trả về pool hoàn toàn: `activeConnections = metrics.total - metrics.idle === 0`.
3. **Bỏ qua cơ chế replay state nghiệp vụ (`withState` bypass):**
   - Đã xác thực `withStateCalls === 0`: Nhánh `/assistant/help` được phân luồng trực tiếp ở HTTP boundary, không kích hoạt state replay hay khóa advisory lock nghiệp vụ của banking repository.
4. **Bảo toàn dữ liệu nghiệp vụ bằng so sánh nội dung chi tiết (Deep Equality):**
   - `payment_accounts`: So sánh toàn bộ cột (gồm `updated_at`, `status`, `available_minor`, `current_minor`, `held_minor`, `account_number`, `version`) → **Giữ nguyên tuyệt đối**.
   - `ledger_journals` & `ledger_entries`: So sánh toàn bộ nội dung dòng → **Giữ nguyên tuyệt đối**.
   - `customers`: So sánh toàn bộ cột (gồm `access_status`, `access_version`, `created_at`, và fingerprint SHA-256 một chiều của salt/digest) → **Giữ nguyên tuyệt đối**.
   - Không làm rò rỉ bất kỳ giá trị secret/password nào ra diff/log.
5. **Dọn dẹp tài nguyên tự động:**
   - Server HTTP, repository pool và direct pool được đóng sạch sẽ trong `t.after`.

---

## 4. Trạng thái Dọn dẹp Tài nguyên

- **Database tạm thời:** Runner tự động kích hoạt `performCleanup()`, kiểm tra marker sở hữu và `DROP DATABASE banking_test_<runId>` thành công (đã xác thực qua `psql \l` chỉ còn 3 database mặc định).
- **Container tạm thời:** Đã gỡ bỏ container `banking-assistant-disposable-pg-test` bằng lệnh `docker rm -f`.
- **Tồn đọng:** 0 container, 0 database, 0 volume ngoài lề.

---

## 5. Phân định Rõ ràng Ba Nhóm Kết quả

| Phân loại | Số lượng | Kết quả | Ý nghĩa bản chất |
| :--- | :---: | :---: | :--- |
| **Kiểm thử phần mềm offline** | 36 test | **36/36 PASS** | 13 Unit + 13 HTTP + 9 Eval Runner + 1 Dist Independence. Kiểm chứng logic code, contract, boundary, rate limiter, scanner. |
| **Đánh giá câu trả lời synthetic** | 56 ca | **0 PASS, 56 NEEDS_REVIEW, 0 ERROR** | Chấm điểm cơ học theo Rubric Phần 5 trên Fake Provider; giữ trạng thái chờ thẩm định ngữ nghĩa. |
| **Kiểm thử tích hợp PostgreSQL disposable** | 1 test | **1/1 PASS** | Xác thực phiên relational thật, connection release khi provider chờ, bypass withState và snapshot bảo toàn dữ liệu nghiệp vụ. |

---

## 6. Xác nhận Không Gọi API Ngoài

- **OpenAI / Claude / External AI API:** **100% KHÔNG** sử dụng, không có lời gọi mạng nào ra ngoài.
- **Mô hình Provider:** Hoàn toàn sử dụng `FakeAssistantHelpProvider` nội bộ offline.

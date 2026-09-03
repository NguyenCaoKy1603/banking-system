# TASK M01-05 — Hoàn thiện KYC lifecycle, Mobile UI states và error handling

Trạng thái: IN_PROGRESS — CHECKPOINT B VERIFIED — AWAITING CHECKPOINT COMMIT
Ưu tiên: P1
Chế độ dự kiến: IMPLEMENT_AND_VERIFY

## 1. Thông tin dự án và quyền truy cập

Tên dự án: Banking System

Repository root thực tế: C:/Projects/banking-system

Mục đích: Mobile banking academic/reference dùng dữ liệu tổng hợp và tiền ảo. Hệ thống không xử lý tiền thật, không phải pilot đã xác minh và chưa được tuyên bố production-ready.

Preflight khi soạn task:

- Current working directory: C:/Projects/banking-system
- Branch: codex/staging-academic-completion
- HEAD: 28c2711d13034555cbf3fee7df521926abb72847
- Worktree: sạch tại thời điểm tạo task draft
- M01-05 chưa được thực hiện; source, OpenAPI, migration, test và cấu hình chưa bị sửa đổi bởi task này.

Tài liệu bắt buộc đọc trước khi implementation:

- `AGENTS.md`
- `PROJECT_CONTEXT.md`
- `TASK_TEMPLATE.md`
- `mobile-app/AGENTS.md`
- `mobile-app/README.md`
- `backend/README.md`
- `tasks/UC-M01/TASK_M01_01_AUDIT_REGISTRATION_KYC.md`
- `tasks/UC-M01/TASK_M01_02_DECIDE_REGISTRATION_KYC_CONTRACT.md`
- `tasks/UC-M01/TASK_M01_03_SYNC_KYC_CONTRACT_PRIVACY.md`
- `tasks/UC-M01/TASK_M01_04_HARDEN_REGISTRATION_CONTRACT_RECOVERY.md`
- `documents/api/banking-mvp.openapi.yaml`
- `backend/database/020_admin_case_operations.sql`
- `backend/database/038_customer_kyc_runtime.sql`
- `backend/package.json`
- `mobile-app/package.json`

## 2. Quyền Git và chế độ làm việc

- Chế độ hiện tại: `DIAGNOSE_AND_PLAN — DOCUMENTATION ONLY`.
- Chế độ khi thực hiện: `IMPLEMENT_AND_VERIFY` chia thành 2 Checkpoint (A và B) có Owner gate bắt buộc ở giữa.
- Git add/stage: `Không` trong phiên lập kế hoạch; chỉ thực hiện khi Owner phê duyệt checkpoint cụ thể.
- Git commit: `Không` trong phiên lập kế hoạch; chỉ thực hiện khi Owner duyệt checkpoint commit packet.
- Push: `Không` trong mọi trường hợp (tuân thủ quy tắc workspace).
- Merge / rebase / tag: `Không`.
- Deploy / provision cloud / bật service / bật worker: `Không`.
- Destructive database operations: `Không`. Tuyệt đối không reset, truncate hay drop database preview/remote.

## 3. Nhiệm vụ và phạm vi sở hữu

### 3.1. Mục tiêu duy nhất

Hoàn thiện vòng đời KYC (complete-valid DRAFT, REJECTED terminal, resubmit tạo application DRAFT/SUBMITTED mới, bảo đảm tối đa một open application per customer, APPROVED precedence) và hoàn thiện trải nghiệm Mobile UI (field error mapping từ backend 422, initial load retry, phân biệt rõ ràng giữa REJECTED, NEEDS_MORE_INFO và APPROVED, xử lý lỗi mạng/timeout/401, bảo mật update identity unchanged/changed).

### 3.2. Ownership chính thức của M01-05

- **D-10 (Complete-valid DRAFT)**:
  - `DRAFT` chỉ là application có payload đầy đủ và hợp lệ đã lưu nhưng chưa submit.
  - Không dùng `DRAFT` để lưu form thiếu field hoặc payload chưa qua validation.
  - Cả Backend runtime validation và Mobile form validation đều từ chối lưu draft nếu thiếu field hoặc sai định dạng.

- **D-11 (KYC Canonical Terminal Lifecycle & One-open Constraint)**:
  - `NEEDS_MORE_INFO` + `saveDraft`: giữ nguyên status `NEEDS_MORE_INFO`, giữ nguyên application ID, tăng `version = version + 1`.
  - `NEEDS_MORE_INFO` + `submit`: chuyển status sang `SUBMITTED`, giữ nguyên application ID, tăng `version = version + 1`, cập nhật `submitted_at = NOW()`.
  - `REJECTED` là trạng thái terminal đối với application hiện tại. Record `REJECTED` cũ không bị mutate qua các supported code paths (application-level immutability; không tuyên bố có database-level immutability constraint).
  - `REJECTED` + `saveDraft`: tạo application mới ở trạng thái `DRAFT` với UUID mới, `version = 1`.
  - `REJECTED` + `submit` trực tiếp: tạo application mới ở trạng thái `SUBMITTED` với UUID mới, `version = 1`, `submitted_at = NOW()`.
  - **APPROVED Precedence**: Nếu customer từng có bất kỳ application nào ở trạng thái `APPROVED` (dù trong quá khứ hay hiện tại), mọi yêu cầu `saveDraft` hoặc `submit` đều bị từ chối với HTTP generic 409 Conflict, không tạo application mới và không mutate bất kỳ bản ghi nào. Kiểm tra `APPROVED` precedence phải chạy trước việc kế thừa identity từ `REJECTED`.
  - **Tối đa một application đang mở**: Cho mỗi customer, tại mọi thời điểm chỉ có tối đa một application ở các trạng thái mở (`DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `NEEDS_MORE_INFO`), được bảo vệ bởi partial unique index `kyc_applications_customer_open_idx` và row lock `FOR UPDATE`.

- **D-14 (Mobile KYC UI States & Error Mapping)**:
  - Map chính xác các known field errors từ phản hồi Backend (HTTP 422 `ApiError.fieldErrors: Record<string, string>`) vào từng trường tương ứng trên form (`fullName`, `identityNumber`, `address`, `documentUri`, `syntheticDataConfirmed`); các unknown error keys bị bỏ qua an toàn mà không làm crash UI.
  - Retry cho initial load: khi `getKycApplication` thất bại, hiển thị error banner kèm nút "Thử lại" rõ ràng, có cờ chống duplicate retry khi đang load.
  - Phân biệt giao diện rõ ràng giữa ba trạng thái: `REJECTED`, `NEEDS_MORE_INFO` và `APPROVED`:
    - `NEEDS_MORE_INFO`: Cảnh báo yêu cầu bổ sung thông tin từ ngân hàng, hiển thị lý do/ghi chú (nếu `rejectionReason` null/empty phải có fallback an toàn, không render `undefined`), cho phép chỉnh sửa trên chính application hiện tại và submit lại.
    - `REJECTED`: Thông báo hồ sơ trước đó đã bị từ chối dứt điểm, hiển thị lý do từ chối (có fallback nếu null/empty), giải thích rõ hành động gửi lại sẽ tạo một hồ sơ mới hoàn toàn.
    - `APPROVED`: Giao diện chỉ đọc hoàn toàn, hiển thị họ tên, `••••<last4>`, badge thành công, không hiển thị nút lưu hay nộp.
  - Xử lý lỗi theo actual error contract của `httpClient`:
    - Network error: `error instanceof ApiError && error.code === "NETWORK_ERROR"` (HTTP status `null`).
    - Timeout error: `error instanceof ApiError && error.code === "TIMEOUT"` (HTTP status `null`).
    - Unauthorized: `error instanceof ApiError && error.status === 401`.
  - Khi gặp lỗi 409 Conflict (hồ sơ đã nộp hoặc conflict), reload lại canonical application từ server trước khi chuyển sang view chỉ đọc.

- **D-15 (Identity Privacy UX & Deterministic Inheritance)**:
  - `identityNumber` hợp lệ có trong request luôn được ưu tiên sử dụng (override).
  - Khi request bỏ `identityNumber`:
    - Nếu có open application: dùng identity hiện tại của chính open application đó.
    - Nếu không có open application: chỉ được kế thừa từ `REJECTED` application gần nhất của chính customer đó theo thứ tự xác định: `ORDER BY created_at DESC, id ASC LIMIT 1`.
    - Tuyệt đối không kế thừa identity từ application `APPROVED` hoặc application của customer khác.
    - Nếu không có nguồn identity hợp lệ: trả về HTTP 422 `VALIDATION_ERROR` kèm `fieldErrors: { identityNumber: "identityNumber must contain between 6 and 24 digits." }` (không leak submitted value).
  - Khi đổi số định danh: bắt buộc nhập đầy đủ 6–24 chữ số; UI chỉ hiển thị dạng masked (`••••<last4>`); cấm gửi giá trị masked lên server.
  - Khi lưu draft hoặc submit thành công: xóa sạch full identity khỏi React state.
  - Tuyệt đối không đưa số định danh đầy đủ vào response, Mobile persistence (SecureStore/AsyncStorage), log console hay evidence artifacts.

### 3.3. Ngoài phạm vi (Out-of-Scope)

- Không sửa luồng Registration (thuộc M01-04 đã hoàn thành).
- Không xử lý bù coverage tổng thể cho toàn repo (thuộc M01-06).
- Không chạy kiểm thử trên PostgreSQL runtime thật/disposable (thuộc M01-07).
- Không chạy kiểm thử Android emulator / Maestro E2E UI automation (thuộc M01-08).
- Không thực hiện audit đóng use case tổng thể UC-M01 (thuộc M01-09).
- Không thay đổi các quyết định đã chốt: D-01 đến D-09, D-12, D-13.
- Không sửa Admin Web frontend hoặc Admin runtime actions.

## 4. Hiện trạng và Read-only Source Inventory

### 4.1. Backend & OpenAPI Inventory

- **Routes (`backend/src/http.ts`)**:
  - `GET /kyc/application`: Lấy application mới nhất của khách hàng đã xác thực. Trả về HTTP 200 với `{ application: KycApplication | null }`.
  - `POST /kyc/application`: Lưu bản nháp synthetic KYC draft (`saveKycDraft`). Trả về HTTP 200 với `{ application: KycApplication }`.
  - `POST /kyc/application/submit`: Nộp hồ sơ KYC (`submitKycApplication`). Route implementation (`backend/src/http.ts:1166`) luôn ghi HTTP 201:
    `writeResponse(response, 201, traceId, { application: await options.relationalHttp.submitKycApplication(userId, data as never) });`
    Khớp chính xác với khai báo OpenAPI (`201: KycApplicationResponse`). Cả khi nộp mới, nộp lại từ DRAFT/NEEDS_MORE_INFO, submit trực tiếp từ REJECTED, hay gửi lại idempotent khi đang `SUBMITTED`/`UNDER_REVIEW` với cùng payload, HTTP status luôn là **201 Created**.
    Idempotent replay trả về application hiện tại (cùng ID, status `SUBMITTED`, version không đổi), tuyệt đối không tạo thêm outbox event, notification hay audit log trùng lặp.
- **Schemas (`documents/api/banking-mvp.openapi.yaml`)**:
  - `KycApplicationRequest`: `required: [fullName, address, documentUri, syntheticDataConfirmed]`. Trường `identityNumber` có `writeOnly: true`, pattern `^\d{6,24}$`, được phép bỏ khi update không đổi identity.
  - `KycApplication`: `required: [id, userId, fullName, identityNumberLast4, address, documentUri, status, rejectionReason, submittedAt, updatedAt, version]`. `identityNumberLast4` pattern `^\d{4}$`.
  - `KycApplicationResponse`: `{ application: KycApplication | null }`.
  - `POST /kyc/application/submit` responses: `201`, `401`, `409`, `422`. Tuyệt đối không có response `200`.
- **Service implementation (`backend/src/database/kycService.ts`)**:
  - `normalizeInput`: Kiểm tra độ dài `fullName` (2-120), `address` (5-300), URI scheme `^(mock|synthetic)://`, `syntheticDataConfirmed === true`, và `identityNumber` (6-24 digits).
  - `saveDraft`: Khóa bản ghi đang mở qua `lockOpen`.
  - `submit`: Khóa bản ghi đang mở qua `lockOpen`.
- **Khoảng trống cần xử lý tại Backend**:
  - Khi application trước đó bị `REJECTED`, `lockOpen` trả về `null`. Nếu khách hàng gọi `saveDraft` hoặc `submit` mà không truyền `identityNumber` (do giữ nguyên identity cũ), cần hỗ trợ tra cứu synthetic identity từ hồ sơ `REJECTED` gần nhất (`ORDER BY created_at DESC, id ASC LIMIT 1`).
  - Khi `REJECTED`, `saveDraft` tạo bản ghi mới `DRAFT` (UUID mới, version 1, HTTP 200); `submit` trực tiếp tạo bản ghi mới `SUBMITTED` (UUID mới, version 1, HTTP 201). Record `REJECTED` cũ không bị thay đổi.
  - Khách hàng từng có bất kỳ `APPROVED` application: từ chối ngay với generic 409 Conflict trước khi normalize/inherit identity/mutate.
  - Kiểm tra tính toàn vẹn complete-valid cho DRAFT: request thiếu trường bắt buộc phải trả về HTTP 422 kèm `fieldErrors`.

### 4.2. Database & Migration Inventory

- **Bảng `kyc_applications`** (định nghĩa gốc tại `020_admin_case_operations.sql`, nâng cấp tại `038_customer_kyc_runtime.sql`):
  - Khóa chính: `id uuid PRIMARY KEY`.
  - Khóa ngoại: `customer_id uuid NOT NULL REFERENCES customers (id)`.
  - Check constraint: `CHECK (status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_MORE_INFO', 'APPROVED', 'REJECTED'))`.
  - Payload tổng hợp: `synthetic_payload jsonb NOT NULL DEFAULT '{}'::jsonb`.
  - Timestamp nộp: `submitted_at timestamptz`.
  - Version: `version bigint NOT NULL DEFAULT 1`.
  - Partial Unique Index:
    ```sql
    CREATE UNIQUE INDEX kyc_applications_customer_open_idx
      ON kyc_applications (customer_id)
      WHERE status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_MORE_INFO');
    ```
  - Index truy vấn lịch sử: `kyc_applications_customer_created_idx ON kyc_applications (customer_id, created_at DESC, id)`.
- **Đánh giá Database & Migration**:
  - Schema hiện tại đủ để hỗ trợ implementation mà không cần migration mới.
  - Partial unique index cung cấp static one-open constraint (tối đa 1 application mở per customer).
  - APPROVED precedence, REJECTED lifecycle, identity inheritance và exact error mapping thuộc phạm vi service implementation.
  - PostgreSQL race / row-lock runtime evidence thuộc phạm vi kiểm thử M01-07.

### 4.3. Admin Immutability & Terminal Lifecycle Evidence

Read-only scan toàn bộ các symbol có thể mutate `kyc_applications` trong `backend/src/admin/**`:
1. `claimApplication` (`backend/src/admin/repositories/adminRepository.ts:695, 1183`):
   - Status predicate: `if (!['SUBMITTED', 'UNDER_REVIEW'].includes(row.status)) throw conflictWithCode("CASE_STATUS_CONFLICT", "Application is not available for review.");`
   - Hồ sơ `REJECTED` hoặc `APPROVED` bị từ chối claim triệt để.
2. `createAction` (`backend/src/admin/actions/actionEngine.ts:151`):
   - Status predicate: `if (target.status !== "SUBMITTED" && target.status !== "UNDER_REVIEW") throw conflictWithCode("CASE_STATUS_CONFLICT", "Application is not awaiting a decision.");`
   - Chỉ cho phép tạo action review cho hồ sơ đang `SUBMITTED` hoặc `UNDER_REVIEW`. Không thể tạo action cho hồ sơ `REJECTED` hay `APPROVED`.
3. `executeApprovedAction` (`backend/src/admin/repositories/adminRepository.ts:923-934`):
   - Phụ thuộc vào action đã được tạo ở status hợp lệ (`SUBMITTED` hoặc `UNDER_REVIEW`).
   - Kiểm tra version predicate:
     `if (action.expectedTargetVersion !== null && before !== action.expectedTargetVersion) { await client.query("UPDATE admin_action_requests SET status='STALE', failure_code='ACTION_STALE', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "STALE", failureCode: "ACTION_STALE", beforeVersion: before }; }`
   - Target-version mismatch chặn triệt để các action cũ/stale sau khi application đã đổi trạng thái hoặc phiên bản.
   - Thực thi `UPDATE kyc_applications SET status=$2, decision_reason_code=$3, decision_at=NOW(), version=version+1... WHERE id=$1`.
- **Kết luận Admin**: Mọi mutate path trong Admin đều được guard chặt chẽ bởi predicate status và optimistic lock (version mismatch). Đây là cơ chế bảo vệ ở cấp độ ứng dụng (application-level protection), không phải database-level immutability constraint. Không có code path nào trong Admin có thể mutate ngược hồ sơ `REJECTED` hoặc `APPROVED`. Không cần sửa Admin.

### 4.4. Mobile Error Contract & Actual Client Inventory

Xác minh exact file/type/symbol trong `mobile-app/src/services/api/`:
- `ApiError` (`mobile-app/src/services/api/ApiError.ts`):
  - `status: number | null` (HTTP status code, ví dụ 401, 409, 422; hoặc `null` khi lỗi client/network/timeout).
  - `code: string` (mã lỗi, ví dụ `"VALIDATION_ERROR"`, `"NETWORK_ERROR"`, `"TIMEOUT"`, `"INVALID_RESPONSE"`, `"REQUEST_ABORTED"`).
  - `fieldErrors: Record<string, string> | null` (đối tượng chứa field validation errors từ HTTP 422 backend).
  - `traceId: string | null`.
- `httpClient.ts`:
  - Network error: ném `ApiError` với `status: null`, `code: "NETWORK_ERROR"`, `message: "Không thể kết nối đến máy chủ."`.
  - Timeout error: ném `ApiError` với `status: null`, `code: "TIMEOUT"`, `message: "Yêu cầu đến máy chủ đã hết thời gian chờ."`.
  - 401 Unauthorized: ném `ApiError` với `status: 401`, `code: "UNAUTHORIZED"`.
- **Kết luận Mobile Error Contract**: Các định danh `NETWORK_ERROR`, `TIMEOUT`, và thuộc tính `ApiError.fieldErrors` đã tồn tại thực tế và có type definition chính xác trong codebase. Không cần sửa `httpClient.ts`.

## 5. Bảng chuyển trạng thái vòng đời chuẩn (Canonical Lifecycle Matrix)

| Trạng thái hiện tại | Thao tác kích hoạt | Tác nhân | Trạng thái mới | Record ID | Version | HTTP Status | Hành vi & Ràng buộc chuẩn |
|---|---|---|---|---|---|---|---|
| (Chưa có hồ sơ) | `saveDraft` | Customer | `DRAFT` | Tạo mới UUID | 1 | 200 OK | Lưu synthetic payload đầy đủ hợp lệ; từ chối 422 nếu thiếu trường (D-10). |
| (Chưa có hồ sơ) | `submit` | Customer | `SUBMITTED` | Tạo mới UUID | 1 | 201 Created | Lưu payload, nộp hồ sơ, sinh notification & outbox event. |
| `DRAFT` | `saveDraft` | Customer | `DRAFT` | Giữ nguyên | +1 | 200 OK | Cập nhật synthetic payload của bản ghi hiện tại. |
| `DRAFT` | `submit` | Customer | `SUBMITTED` | Giữ nguyên | +1 | 201 Created | Chuyển trạng thái sang `SUBMITTED`, gán `submitted_at = NOW()`. |
| `SUBMITTED` | `saveDraft` / `submit` (khác payload) | Customer | — | — | — | 409 Conflict | Ném lỗi 409 Conflict: Hồ sơ đang chờ xử lý, không thể chỉnh sửa. |
| `SUBMITTED` | `submit` (cùng payload) | Customer | `SUBMITTED` | Giữ nguyên | Giữ nguyên | **201 Created** | Idempotent replay: Trả về application hiện tại (cùng ID, status, version), không tạo lại side effect (outbox/notification/audit). |
| `SUBMITTED` | Claim case | Admin | `UNDER_REVIEW` | Giữ nguyên | +1 | 200 OK | Nhân viên nhận xử lý hồ sơ. |
| `UNDER_REVIEW` | Approve | Admin | `APPROVED` | Giữ nguyên | +1 | 200 OK | **Terminal**. Khách hàng đã được định danh thành công. Không thể sửa tiếp. |
| `UNDER_REVIEW` | Reject | Admin | `REJECTED` | Giữ nguyên | +1 | 200 OK | **Terminal**. Lưu `decision_reason_code`. Record cũ không bị mutate qua code paths. |
| `UNDER_REVIEW` | Request info | Admin | `NEEDS_MORE_INFO` | Giữ nguyên | +1 | 200 OK | Yêu cầu khách hàng bổ sung thông tin. Application vẫn giữ ID cũ. |
| `NEEDS_MORE_INFO` | `saveDraft` | Customer | **`NEEDS_MORE_INFO`** | **Giữ nguyên** | **+1** | **200 OK** | **Giữ nguyên status `NEEDS_MORE_INFO`**, cập nhật payload, tăng version. |
| `NEEDS_MORE_INFO` | `submit` | Customer | **`SUBMITTED`** | **Giữ nguyên** | **+1** | **201 Created** | **Chuyển sang `SUBMITTED`**, cập nhật payload, tăng version, gán `submitted_at = NOW()`. |
| `APPROVED` (từng có) | `saveDraft` / `submit` | Customer | — | — | — | 409 Conflict | **APPROVED Precedence**: Generic 409 Conflict, không tạo application mới, không mutate. |
| `REJECTED` | `saveDraft` | Customer | **`DRAFT`** | **UUID mới** | **1** | **200 OK** | **Tạo application mới DRAFT**. Record `REJECTED` cũ giữ nguyên vẹn. |
| `REJECTED` | `submit` (trực tiếp) | Customer | **`SUBMITTED`** | **UUID mới** | **1** | **201 Created** | **Tạo application mới SUBMITTED**. Record `REJECTED` cũ giữ nguyên vẹn. |

## 6. Chính sách kế thừa số định danh và thứ tự giao dịch chuẩn (Canonical Transaction Ordering & Identity Inheritance)

Khi xử lý `saveDraft` và `submit` trên Backend (`backend/src/database/kycService.ts`), để xử lý deterministic scenario khi open row chuyển sang APPROVED trong lúc lockOpen chờ, thứ tự thực thi trong cùng `unitOfWork.transaction` bắt buộc phải là:

```
                              ┌──────────────────────────────┐
                              │ 1. lockOpen:                 │
                              │ SELECT ... FOR UPDATE        │
                              │ (lock open row nếu có)       │
                              └──────────────┬───────────────┘
                                             │
                                             ▼
                              ┌──────────────────────────────┐
                              │ 2. Kiểm tra APPROVED:        │
                              │ SELECT id ... FOR SHARE      │
                              │ WHERE status = 'APPROVED'    │
                              └──────────────┬───────────────┘
                                             │
                          ┌──────────────────┴──────────────────┐
                          │ Có APPROVED row                     │ Không có
                          ▼                                     ▼
            [ Trả generic 409 Conflict ngay ] ┌──────────────────────────────┐
            (Không normalize, không inherit,  │ 3. Kiểm tra open row:        │
             không insert)                    └──────────────┬───────────────┘
                                                             │
                                          ┌──────────────────┴──────────────────┐
                                          │ Có open row                         │ Không có open row
                                          ▼                                     ▼
                           [ Xử lý theo open row status:       ┌──────────────────────────────┐
                             - SUBMITTED/UNDER_REVIEW:         │ 4. Identity Inheritance:     │
                               fingerprint trùng -> 201 replay │ Request có identityNumber -> │
                               khác -> 409 Conflict            │ dùng luôn                    │
                             - DRAFT/NEEDS_MORE_INFO:          │ Request bỏ identityNumber -> │
                               update payload, version + 1 ]   │ lấy latest REJECTED          │
                                                               └──────────────┬───────────────┘
                                                                              │
                                                                              ▼
                                                               ┌──────────────────────────────┐
                                                               │ 5. INSERT new application    │
                                                               │ (DRAFT: 200 / SUBMITTED: 201)│
                                                               └──────────────┬───────────────┘
                                                                              │
                                                           ┌──────────────────┴──────────────────┐
                                                           │ Mã lỗi 23505 (open_idx)             │ Lỗi khác
                                                           ▼                                     ▼
                                             [ Generic 409 Conflict ]                     [ Rethrow ]
```

### Exact Query & Transaction Ordering
1. **Bước 1 — Khóa Open Application (`lockOpen`)**:
   ```sql
   SELECT id, customer_id, status, applicant_label, request_fingerprint,
          decision_reason_code, version, synthetic_payload, submitted_at, created_at, updated_at
     FROM kyc_applications
    WHERE customer_id = $1
      AND status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_MORE_INFO')
    ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE
   ```
2. **Bước 2 — Kiểm tra APPROVED Precedence sau khi lockOpen hoàn tất**:
   ```sql
   SELECT id FROM kyc_applications
    WHERE customer_id = $1 AND status = 'APPROVED'
    LIMIT 1 FOR SHARE
   ```
   Nếu tìm thấy bất kỳ row `APPROVED` nào của customer này:
   - Lập tức ném lỗi generic `conflict("KYC application has already been approved.")`.
   - Kết thúc giao dịch ngay lập tức trước khi thực hiện normalization, identity inheritance hoặc bất kỳ thao tác mutation nào.
3. **Bước 3 — Xử lý Open Row (nếu Bước 1 tìm thấy row mở)**:
   - Nếu open row đang ở `SUBMITTED` hoặc `UNDER_REVIEW`:
     - So sánh `requestFingerprint`:
       - Nếu trùng: trả về application hiện tại với HTTP 201 (idempotent replay), không ghi thêm outbox hay notification.
       - Nếu khác: ném lỗi `conflict("KYC hồ sơ đang được xử lý; không thể thay đổi dữ liệu.")`.
   - Nếu open row đang ở `DRAFT`: cập nhật payload, tăng `version = version + 1`, trả về HTTP 200 (khi `saveDraft`) hoặc chuyển sang `SUBMITTED` với HTTP 201 (khi `submit`).
   - Nếu open row đang ở `NEEDS_MORE_INFO`:
     - Khi `saveDraft`: giữ nguyên status `NEEDS_MORE_INFO`, cập nhật payload, tăng version, trả về HTTP 200.
     - Khi `submit`: chuyển sang `SUBMITTED`, cập nhật payload, tăng version, gán `submitted_at = NOW()`, trả về HTTP 201.
4. **Bước 4 — Kế thừa Identity khi không có Open Row**:
   - Nếu `identityNumber` hợp lệ có trong request: luôn sử dụng giá trị này.
   - Nếu request bỏ `identityNumber`:
     ```sql
     SELECT synthetic_payload FROM kyc_applications
      WHERE customer_id = $1 AND status = 'REJECTED'
      ORDER BY created_at DESC, id ASC LIMIT 1
     ```
     Lấy `synthetic_payload.identityNumber` từ row rejected gần nhất theo thứ tự deterministic `created_at DESC, id ASC`.
   - Nếu không tìm thấy bất kỳ nguồn identity nào: truyền `undefined` vào `normalizeInput` (ném HTTP 422 `VALIDATION_ERROR` kèm `fieldErrors: { identityNumber: "identityNumber must contain between 6 and 24 digits." }`, không leak submitted value).
5. **Bước 5 — INSERT open application mới**:
   - Khi `saveDraft`: INSERT application mới có `status = 'DRAFT'`, `version = 1`, trả về HTTP 200.
   - Khi `submit` trực tiếp: INSERT application mới có `status = 'SUBMITTED'`, `version = 1`, `submitted_at = NOW()`, trả về HTTP 201.
6. **Bước 6 — Xử lý xung đột Unique Index (One-Open Conflict Policy)**:
   - Nếu lệnh INSERT gặp mã lỗi PostgreSQL `23505` trên index `kyc_applications_customer_open_idx`, map thành generic `conflict("KYC application is already open.")`.
   - Mọi lỗi primary key hoặc constraint/lỗi cơ sở dữ liệu không xác định khác: bắt buộc **rethrow**, không giả mạo thành business conflict.

### Cơ chế xử lý kịch bản race với Admin Approval (Deterministic Query Ordering)
- Nếu Admin đang giữ row lock trên open application và thực hiện chuyển trạng thái `SUBMITTED` → `APPROVED`:
  1. Câu lệnh `lockOpen` (`SELECT ... FOR UPDATE`) của customer transaction sẽ bị chặn (block) chờ Admin transaction commit.
  2. Khi Admin transaction commit thành công, row chuyển sang `APPROVED` và không còn thuộc WHERE clause của `lockOpen`.
  3. `lockOpen` hoàn thành và trả về `null` (không còn open row).
  4. Giao dịch tiếp tục đến Bước 2 (Approved Recheck). Câu lệnh `SELECT id ... WHERE status = 'APPROVED'` nhìn thấy row `APPROVED` vừa commit của Admin.
  5. Hệ thống lập tức trả về generic 409 Conflict, chặn việc tạo `DRAFT` hoặc `SUBMITTED` mới sau khi đã được duyệt.
- Lưu ý: `T-KYC-BE-16` chứng minh query/decision ordering bằng test double trong unit/contract isolation, chưa chứng minh mọi PostgreSQL interleaving; runtime row-lock/concurrency proof thực tế trên PostgreSQL thuộc phạm vi **M01-07**.

## 7. Error Mapping Table

| Tình huống lỗi | Phản hồi từ Server | Ánh xạ trên Mobile UI (D-14) |
|---|---|---|
| Thiếu hoặc sai định dạng trường khi nhập | Client validation (`validateKycDraft`) | Hiển thị thông báo đỏ dưới `TextField` tương ứng, chặn gọi API. |
| Backend validation thất bại | HTTP 422 `VALIDATION_ERROR` kèm `fieldErrors: Record<string, string>` | Trích xuất `fieldErrors`, ánh xạ các known keys (`fullName`, `identityNumber`, `address`, `documentUri`, `syntheticDataConfirmed`) vào `TextField` tương ứng; bỏ qua các unknown keys; hiển thị banner tổng quát. |
| Chỉnh sửa hồ sơ đang `SUBMITTED` hoặc `UNDER_REVIEW` | HTTP 409 `CONFLICT` | Khi nhận 409, reload canonical application từ server, hiển thị banner thông báo và chuyển sang view chỉ đọc. |
| Tải hồ sơ ban đầu thất bại | `ApiError` hoặc Network Error | Render giao diện lỗi riêng biệt có icon cảnh báo, thông điệp lỗi và nút PrimaryButton *"Thử lại"* (`kyc-retry-load`), có cờ chống duplicate retry khi đang load. |
| Mất kết nối mạng | `ApiError` code `"NETWORK_ERROR"` (`status: null`) | Thông báo: *"Không thể kết nối đến máy chủ. Vui lòng kiểm tra đường truyền."* |
| Quá thời gian phản hồi | `ApiError` code `"TIMEOUT"` (`status: null`) | Thông báo: *"Yêu cầu đến máy chủ đã hết thời gian chờ. Vui lòng thử lại sau."* |
| Phiên đăng nhập hết hạn | HTTP 401 `UNAUTHORIZED` (`status: 401`) | Thông báo: *"Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."* |
| Hồ sơ bị `REJECTED` | HTTP 200 `{ status: "REJECTED", rejectionReason }` | Card cảnh báo đỏ: *"Hồ sơ trước đó đã bị từ chối: {rejectionReason || fallback}. Gửi lại sẽ tạo một hồ sơ mới."* Phân biệt rõ với `NEEDS_MORE_INFO`. |
| Hồ sơ yêu cầu `NEEDS_MORE_INFO` | HTTP 200 `{ status: "NEEDS_MORE_INFO", rejectionReason }` | Card cảnh báo vàng: *"Ngân hàng yêu cầu bổ sung thông tin: {rejectionReason || fallback}. Vui lòng cập nhật và nộp lại trên hồ sơ hiện tại."* |
| Hồ sơ đã duyệt `APPROVED` | HTTP 200 `{ status: "APPROVED" }` | Card thành công xanh lá: *"Hồ sơ định danh đã được phê duyệt."* Chỉ đọc hoàn toàn, không nút sửa hay nộp. |

## 8. Privacy Boundary (D-15)

1. **Zero Full Identity Exposure**: `publicApplication` chỉ trả về `identityNumberLast4` (đúng 4 chữ số). Trường `identityNumber` chỉ là write-only.
2. **Không lưu trữ trên thiết bị**: React state xóa sạch full identity sau khi ghi thành công; cấm lưu vào `SecureStore` hay `AsyncStorage`.
3. **Masked Display**: Màn hình chỉ hiển thị `••••<last4>`.
4. **Safe Resubmit**: Cho phép kế thừa identity cũ từ rejected application khi resubmit nếu không đổi; không bắt người dùng nhập lại và không lộ full identity.
5. **Redaction**: Không in dữ liệu nhạy cảm trong log/test/evidence.

## 9. Phân chia Checkpoint thực hiện

### Checkpoint A — KYC Lifecycle & Backend Contract
- **Allowlist Checkpoint A** (3 files):
  1. `backend/src/database/kycService.ts`
  2. `backend/src/tests/kycContract.test.ts`
  3. `tasks/UC-M01/TASK_M01_05_COMPLETE_KYC_LIFECYCLE_UI_ERRORS.md`
- **Quality gates Checkpoint A**:
  - `npm run typecheck` (backend): PASS.
  - `npm run build` (backend): PASS.
  - `node --import=tsx --test src/tests/kycContract.test.ts`: PASS 100%.
  - `npm test` (backend): PASS (không có test fail).
  - `npm run validate:openapi`: PASS.
  - `node scripts/validate-database-schema.cjs`: PASS.
- **Dừng lại**: Tạo Checkpoint A Review Packet và chờ lệnh của Owner trước khi chuyển sang Checkpoint B.

### Checkpoint B — Mobile KYC UI States & Error Handling
- **Allowlist Checkpoint B** (7 files):
  1. `mobile-app/src/features/kyc/screens/KycScreen.tsx`
  2. `mobile-app/src/features/kyc/screens/__tests__/KycScreen.test.tsx`
  3. `mobile-app/src/features/kyc/services/kycApi.ts`
  4. `mobile-app/src/features/kyc/services/__tests__/kycApi.test.ts`
  5. `mobile-app/src/features/kyc/validation/kycValidators.ts`
  6. `mobile-app/src/features/kyc/validation/__tests__/kycValidators.test.ts`
  7. `tasks/UC-M01/TASK_M01_05_COMPLETE_KYC_LIFECYCLE_UI_ERRORS.md`
- **Quality gates Checkpoint B**:
  - `npm run lint` (mobile-app): PASS.
  - `npm run typecheck` (mobile-app): PASS.
  - `npx jest --runInBand src/features/kyc/screens/__tests__/KycScreen.test.tsx src/features/kyc/validation/__tests__/kycValidators.test.ts src/features/kyc/services/__tests__/kycApi.test.ts`: PASS 100%.
  - `npm test -- --runInBand` (mobile-app): PASS.
  - `npm run validate:openapi` (mobile-app): PASS.
  - `npm run validate:e2e` (mobile-app): PASS.
  - `npm run export:web` (mobile-app): PASS.

## 10. Khu vực cấm thay đổi (Forbidden Areas)

- Tuyệt đối KHÔNG sửa:
  - `backend/database/*.sql` (không thêm migration, không sửa migration cũ).
  - `backend/src/admin/**` (không thay đổi Admin runtime hay schema).
  - `backend/src/http.ts` (route dispatch đã có sẵn 200/201, không tự ý sửa).
  - `mobile-app/src/services/api/httpClient.ts` (shared HTTP client đã đầy đủ).
  - `documents/api/banking-mvp.openapi.yaml`.
  - `backend/package.json` hoặc `mobile-app/package.json`.
  - Các module ngoài KYC: `auth`, `transfer`, `savings`, `credit`.
  - Không đọc hoặc in nội dung các file `.env`.

## 11. Tiêu chí nghiệm thu quan sát được (Acceptance Criteria)

### Checkpoint A (Backend)
- [x] Route-level POST `/kyc/application` và `/kyc/application/submit` với payload thiếu trường hoặc không hợp lệ trả về HTTP 422 `VALIDATION_ERROR` kèm đúng cấu trúc `fieldErrors: Record<string, string>`.
- [x] Tạo application mới hợp lệ (`saveDraft`) trả về HTTP 200, status `DRAFT`, `version = 1`.
- [x] Application ở `NEEDS_MORE_INFO` khi gọi `saveDraft` giữ nguyên status `NEEDS_MORE_INFO`, giữ ID cũ, tăng version +1, trả về HTTP 200.
- [x] Application ở `NEEDS_MORE_INFO` khi gọi `submit` chuyển sang status `SUBMITTED`, giữ ID cũ, tăng version +1, gán `submitted_at = NOW()`, trả về HTTP 201.
- [x] Application ở `REJECTED` khi gọi `saveDraft` tạo application mới ở `DRAFT` với UUID mới, `version = 1`, trả về HTTP 200.
- [x] Application ở `REJECTED` khi gọi `submit` trực tiếp tạo application mới ở `SUBMITTED` với UUID mới, `version = 1`, trả về HTTP 201.
- [x] Gửi lại `submit` với cùng payload khi đang `SUBMITTED` hoặc `UNDER_REVIEW` trả về HTTP 201 Created (idempotent replay), giữ nguyên application ID, status, version và không tạo thêm notification, outbox hay audit side effect.
- [x] Toàn bộ trường quan trọng (`status`, `decision_reason_code`, `version`, timestamps) của bản ghi `REJECTED` cũ không bị thay đổi sau khi tạo application mới.
- [x] Khi request bỏ `identityNumber` và không có open application, hệ thống kế thừa từ `REJECTED` application gần nhất theo thứ tự deterministic `created_at DESC, id ASC`.
- [x] Khi request cung cấp `identityNumber` hợp lệ mới, giá trị mới luôn thắng (override) identity kế thừa.
- [x] Khi request bỏ `identityNumber` mà không có nguồn kế thừa hợp lệ (không có open và không có rejected), trả về HTTP 422 `VALIDATION_ERROR` kèm `fieldErrors: { identityNumber: "identityNumber must contain between 6 and 24 digits." }` (không leak submitted value).
- [x] Customer từng có bất kỳ application nào `APPROVED` khi gọi `saveDraft` hoặc `submit` đều nhận generic 409 Conflict, không tạo mới và không mutate; kiểm tra APPROVED recheck chạy sau lockOpen xử lý deterministic scenario khi open row chuyển APPROVED trong lúc chờ khóa (T-KYC-BE-16 chứng minh query ordering bằng test double; runtime concurrency proof thuộc M01-07).
- [x] Xung đột mã lỗi 23505 trên `kyc_applications_customer_open_idx` được map thành generic 409 Conflict.
- [x] Lỗi primary key hoặc lỗi database không xác định được rethrow nguyên trạng.
- [x] Phản hồi và thông báo lỗi tuyệt đối không để lộ số định danh đầy đủ.

### Checkpoint B (Mobile)
- [ ] Các known field errors từ Backend 422 được map chính xác vào các TextField tương ứng; unknown error keys bị bỏ qua an toàn.
- [ ] Khi initial load thất bại, hiển thị giao diện lỗi kèm nút "Thử lại" (`kyc-retry-load`); có cờ chống duplicate retry khi đang load.
- [ ] `REJECTED`, `NEEDS_MORE_INFO` và `APPROVED` là ba trạng thái giao diện phân biệt rõ rệt (banner màu sắc, thông điệp ngữ nghĩa, quyền chỉnh sửa).
- [ ] `rejectionReason` null hoặc empty có thông điệp fallback an toàn, không render `undefined`.
- [ ] Xử lý đúng actual error contract của `httpClient`: network error (`NETWORK_ERROR`), timeout (`TIMEOUT`), và unauthorized (`401`).
- [ ] Application mới bắt buộc phải nhập số định danh đầy đủ 6–24 chữ số.
- [ ] Application hiện có khi không đổi số định danh sẽ bỏ trường `identityNumber` khỏi request body.
- [ ] Khi đổi số định danh, bắt buộc nhập đầy đủ 6–24 chữ số, không gửi masked value lên server.
- [ ] Khi nhận lỗi 409 Conflict, reload lại canonical application từ server trước khi chuyển sang view chỉ đọc.
- [ ] Sau khi lưu draft hoặc submit thành công, số định danh đầy đủ bị xóa sạch khỏi React state.

## 12. Ma trận kiểm thử (Test Matrix)

### Backend Tests (`backend/src/tests/kycContract.test.ts`)
1. `T-KYC-BE-01`: Route-level HTTP 422 và exact field-error shape khi thiếu trường hoặc định dạng sai.
2. `T-KYC-BE-02`: Lưu draft hợp lệ tạo application mới với status `DRAFT`, `version = 1`, HTTP 200.
3. `T-KYC-BE-03`: Application `NEEDS_MORE_INFO` gọi `saveDraft` -> giữ nguyên status `NEEDS_MORE_INFO`, giữ ID, version +1, HTTP 200.
4. `T-KYC-BE-04`: Application `NEEDS_MORE_INFO` gọi `submit` -> chuyển sang status `SUBMITTED`, giữ ID, version +1, HTTP 201.
5. `T-KYC-BE-05`: Application `REJECTED` gọi `saveDraft` -> tạo application mới `DRAFT`, UUID mới, version 1, HTTP 200.
6. `T-KYC-BE-06`: Application `REJECTED` gọi `submit` trực tiếp -> tạo application mới `SUBMITTED`, UUID mới, version 1, HTTP 201.
7. `T-KYC-BE-07`: Kiểm tra bản ghi `REJECTED` cũ không bị thay đổi bất kỳ trường nào sau khi tạo application mới.
8. `T-KYC-BE-08`: Omitted identity kế thừa từ application `REJECTED` gần nhất theo `created_at DESC, id ASC` deterministic.
9. `T-KYC-BE-09`: Supplied changed identity mới ghi đè giá trị kế thừa từ bản ghi cũ.
10. `T-KYC-BE-10`: Omitted identity khi không có nguồn kế thừa hợp lệ -> trả về HTTP 422.
11. `T-KYC-BE-11`: Customer từng có `APPROVED` gọi `saveDraft` hoặc `submit` -> generic 409 Conflict, không mutate.
12. `T-KYC-BE-12`: Exact open-index unique constraint (23505) violation map thành generic 409 Conflict.
13. `T-KYC-BE-13`: Primary-key / unknown database error được rethrow nguyên vẹn.
14. `T-KYC-BE-14`: Response và error logging không bao giờ để lộ số định danh đầy đủ.
15. `T-KYC-BE-15`: SUBMITTED + same payload -> exact HTTP 201 theo route/OpenAPI; same ID/status/version; không tạo lại notification, outbox hay audit side effect.
16. `T-KYC-BE-16`: Controlled ordering mô phỏng open row chuyển thành APPROVED trước khi lock hoàn tất; approved recheck sau lockOpen -> generic 409 Conflict; không normalize/inherit/insert. (Không tuyên bố T-KYC-BE-16 là PostgreSQL concurrency proof).

### Mobile Tests (`mobile-app/src/features/kyc/screens/__tests__/KycScreen.test.tsx`)
1. `T-KYC-FE-01`: Backend 422 field errors map đúng vào các trường nhập liệu tương ứng; unknown error keys bị bỏ qua an toàn.
2. `T-KYC-FE-02`: Initial load thất bại hiển thị error UI kèm nút retry; kiểm tra chống duplicate retry khi đang load.
3. `T-KYC-FE-03`: `REJECTED`, `NEEDS_MORE_INFO` và `APPROVED` render ba trạng thái giao diện hoàn toàn khác nhau.
4. `T-KYC-FE-04`: `rejectionReason` null hoặc rỗng hiển thị thông điệp fallback hợp lý, không render `undefined`.
5. `T-KYC-FE-05`: Xử lý đúng lỗi mạng (`NETWORK_ERROR`), timeout (`TIMEOUT`), và hết phiên (`401`) theo actual contract.
6. `T-KYC-FE-06`: Tạo mới application bắt buộc nhập full identity 6–24 chữ số; chặn gửi nếu thiếu.
7. `T-KYC-FE-07`: Update application mà không chạm vào số định danh -> request body bỏ hẳn key `identityNumber`.
8. `T-KYC-FE-08`: Đổi số định danh gửi đầy đủ số mới, không bao giờ gửi giá trị masked `••••1234`.
9. `T-KYC-FE-09`: Nhận lỗi 409 Conflict từ server -> reload canonical application từ server trước khi chuyển view.
10. `T-KYC-FE-10`: Lưu draft hoặc submit thành công -> xóa sạch full identity khỏi React state.

### Ma trận Deferred Evidence
- **PostgreSQL runtime / Concurrency / Row lock (M01-07)**: Kiểm thử race conditions giữa hai request tạo application đồng thời, xác minh partial unique index `kyc_applications_customer_open_idx` trên PostgreSQL disposable thật.
- **Android Emulator / Maestro UI automation (M01-08)**: Kiểm thử quy trình điền form eKYC trên thiết bị thật/emulator, chụp ảnh giấy tờ mô phỏng và kiểm tra layout trên màn hình mobile thực tế.

## 13. Quản lý rủi ro và Blocker Matrix

| Rủi ro tiềm ẩn | Mức độ | Biện pháp giảm thiểu | Trạng thái |
|---|---|---|---|
| Cần migration mới cho D-11 | Thấp | Kiểm tra schema 038 cho thấy partial unique index đã loại trừ `REJECTED` và `APPROVED`. Không cần migration mới. | Resolved |
| Admin workflow bị ảnh hưởng bởi D-11 | Thấp | Scan toàn bộ `backend/src/admin/**` chứng minh mọi mutate path đều có guard `['SUBMITTED', 'UNDER_REVIEW']`. Không thể mutate ngược `REJECTED`/`APPROVED`. | Resolved |
| Rò rỉ full identity qua error response | Trung bình | `normalizeInput` và `DomainError` không bao giờ đưa giá trị `identityNumber` vào thông điệp lỗi hay error details. Có test tự động quét. | Mitigated |
| Client bị kẹt khi application `REJECTED` không có identity | Cao | Backend hỗ trợ tìm identity từ hồ sơ `REJECTED` gần nhất theo `created_at DESC, id ASC` nếu request không truyền `identityNumber`. | Planned in Checkpoint A |
| Conflict / Race condition giữa APPROVED và REJECTED/DRAFT | Cao | Đặt rule APPROVED precedence chạy sau khi `lockOpen` hoàn tất trong cùng UnitOfWork; nếu thấy APPROVED row thì trả generic 409 ngay trước khi normalize/inherit/insert. | Planned in Checkpoint A |

## 14. Decision result & Owner approval

### OWNER APPROVAL — M01-05 FINAL IMPLEMENTATION PLAN

- **Approval date**: 2026-09-03.
- **Baseline HEAD**: `28c2711d13034555cbf3fee7df521926abb72847`
- **Phạm vi quyết định**: D-10, D-11, D-14 và phần còn lại của D-15 thuộc M01-05.
- **Canonical lifecycle**: Đã được phê duyệt chính thức.
- **Submit success / idempotent replay**: Dùng exact HTTP `201 Created` theo route implementation và OpenAPI specification.
- **Transaction ordering chuẩn**: `lockOpen` → `APPROVED recheck` → `open-row handling / identity inheritance` → `insert` → `exact constraint mapping`.
- **Test matrix bắt buộc**: Bổ sung `T-KYC-BE-15` và `T-KYC-BE-16`.
- **Checkpoint allowlists cố định**:
  - Checkpoint A: Cố định 3 file Backend (`backend/src/database/kycService.ts`, `backend/src/tests/kycContract.test.ts`, `tasks/UC-M01/TASK_M01_05_COMPLETE_KYC_LIFECYCLE_UI_ERRORS.md`).
  - Checkpoint B: Cố định 7 file Mobile (`KycScreen.tsx`, `KycScreen.test.tsx`, `kycApi.ts`, `kycApi.test.ts`, `kycValidators.ts`, `kycValidators.test.ts`, `tasks/UC-M01/TASK_M01_05_COMPLETE_KYC_LIFECYCLE_UI_ERRORS.md`).
- **Owner review gate**: Bắt buộc dừng lại để Owner review sau Checkpoint A trước khi bắt đầu Checkpoint B.
- **Deferred evidence**: PostgreSQL concurrency / row-lock proof deferred M01-07; Emulator / Maestro proof deferred M01-08.
- **Ranh giới cấm**: Không migration mới, không sửa Admin, không sửa shared HTTP client (`httpClient.ts`), không sửa OpenAPI (`banking-mvp.openapi.yaml`).
### OWNER REVIEW — CHECKPOINT A APPROVED FOR STAGING

- **Owner review date**: 2026-09-04.
- **Baseline HEAD**: `eb1ea7ddfe549d5e3280b96460e5812309eab024`
- **T-KYC-BE-01…16**: PASS.
- **Targeted tests**: 28/28 PASS.
- **Full Backend test suite**: 289 total / 241 pass / 48 intentional skip / 0 fail.
- **Typecheck/build/OpenAPI/static schema validator**: Tất cả đều PASS.
- **Privacy follow-up**: Accepted (xác minh 7 bề mặt bảo vệ).
- **PostgreSQL runtime/concurrency**: Vẫn deferred M01-07.
- **Checkpoint B**: Chưa bắt đầu.
- **M01-05**: Chưa COMPLETED.
- **Quyền Git**: Không push.

Trạng thái thực hiện: IN_PROGRESS — CHECKPOINT A COMMITTED — CHECKPOINT B NOT STARTED

## 15. CHECKPOINT A BACKEND EVIDENCE

### 15.1 Thông tin Checkpoint A
- **Baseline HEAD**: `eb1ea7ddfe549d5e3280b96460e5812309eab024`
- **Branch**: `codex/staging-academic-completion`
- **Working tree status**: Modified đúng 3 file trong allowlist:
  1. `backend/src/database/kycService.ts`
  2. `backend/src/tests/kycContract.test.ts`
  3. `tasks/UC-M01/TASK_M01_05_COMPLETE_KYC_LIFECYCLE_UI_ERRORS.md`
- **Tập tin ngoài allowlist**: 0 file modified/untracked.

### 15.2 Ma trận kết quả Test Matrix T-KYC-BE-01..16

| Mã Test | Mô tả hành vi kiểm tra | File thực hiện | Kết quả |
|---|---|---|---|
| `T-KYC-BE-01` | Route-level HTTP 422 và exact fieldErrors shape khi thiếu/sai field | `kycContract.test.ts` | **PASS** (15.2ms) |
| `T-KYC-BE-02` | Valid saveDraft tạo DRAFT application mới với version 1 | `kycContract.test.ts` | **PASS** (0.6ms) |
| `T-KYC-BE-03` | NEEDS_MORE_INFO + saveDraft giữ nguyên status và ID, version +1 | `kycContract.test.ts` | **PASS** (0.4ms) |
| `T-KYC-BE-04` | NEEDS_MORE_INFO + submit chuyển sang SUBMITTED, giữ ID, version +1 | `kycContract.test.ts` | **PASS** (0.9ms) |
| `T-KYC-BE-05` | REJECTED + saveDraft tạo DRAFT mới với UUID mới và version 1 | `kycContract.test.ts` | **PASS** (0.4ms) |
| `T-KYC-BE-06` | REJECTED + submit trực tiếp tạo SUBMITTED mới với UUID mới và version 1 | `kycContract.test.ts` | **PASS** (0.4ms) |
| `T-KYC-BE-07` | Snapshot REJECTED row cũ không bị thay đổi sau khi tạo hồ sơ mới | `kycContract.test.ts` | **PASS** (0.5ms) |
| `T-KYC-BE-08` | Omitted identity được kế thừa từ REJECTED gần nhất (`created_at DESC, id ASC`) | `kycContract.test.ts` | **PASS** (0.4ms) |
| `T-KYC-BE-09` | Changed identity mới ghi đè identity kế thừa từ REJECTED row | `kycContract.test.ts` | **PASS** (0.4ms) |
| `T-KYC-BE-10` | Omitted identity khi không có nguồn kế thừa (không open, không REJECTED) trả 422 | `kycContract.test.ts` | **PASS** (0.5ms) |
| `T-KYC-BE-11` | APPROVED precedence: saveDraft và submit đều trả generic 409 conflict | `kycContract.test.ts` | **PASS** (0.4ms) |
| `T-KYC-BE-12` | INSERT unique constraint (23505 + `kyc_applications_customer_open_idx`) map sang 409 | `kycContract.test.ts` | **PASS** (0.6ms) |
| `T-KYC-BE-13` | Primary-key violation (23505 trên pkey) và unknown DB errors được rethrow nguyên bản | `kycContract.test.ts` | **PASS** (0.6ms) |
| `T-KYC-BE-14` | Response, error, audit, outbox, notification và console không bao giờ để lộ full identity | `kycContract.test.ts` | **PASS** (7.8ms) |
| `T-KYC-BE-15` | Idempotent submit trả về application hiện có với HTTP 201, không lặp side effect | `kycContract.test.ts` | **PASS** (5.0ms) |
| `T-KYC-BE-16` | APPROVED recheck sau lockOpen ngăn insert khi open row chuyển sang APPROVED | `kycContract.test.ts` | **PASS** (1.0ms) |

### 15.3 Kết quả 6 lệnh Backend bắt buộc

1. `npm run typecheck`:
   - Kết quả: **PASS** (0 errors, exit code 0).
2. `npm run build`:
   - Kết quả: **PASS** (`tsc -p tsconfig.build.json` hoàn tất thành công, exit code 0).
3. `node --import=tsx --test src/tests/kycContract.test.ts`:
   - Kết quả: **PASS** (28/28 tests passed, 0 failed, 0 skipped, thời gian 717.1ms).
4. `npm test`:
   - Kết quả: **PASS** (289 tests: 241 passed, 0 failed, 48 integration skipped, thời gian ~20s).
5. `npm run validate:openapi`:
   - Kết quả: **PASS** (54 required paths, 60 exact method/segment guards, financial response/idempotency matrices verified).
6. `node scripts/validate-database-schema.cjs`:
   - Kết quả: **PASS** (52 table definitions and column/constraint invariants present).

### 15.4 Bằng chứng cụ thể theo yêu cầu của Owner

#### 1. Idempotent submit replay (T-KYC-BE-15)
- Unit level: `RelationalKycService.submit` với cùng request fingerprint trên trạng thái `SUBMITTED` trả về application hiện có mà không tạo thêm bản ghi nào trong `notifications`, `audit_events`, hay `outbox_events`.
- Route level: Gọi HTTP `POST /api/v1/kyc/application/submit` 2 lần liên tiếp với cùng payload đều nhận exact HTTP `201 Created` kèm theo payload body đồng nhất (`id`, `status`, `version`).

#### 2. Query sequence của T-KYC-BE-16
- Khi Admin approve hồ sơ trong lúc Customer đang chờ row-lock, `lockOpen` (`SELECT ... FOR UPDATE`) mở khóa và trả về rỗng do điều kiện `WHERE status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_MORE_INFO')` không còn khớp.
- Query thứ hai ngay lập tức kiểm tra `SELECT id FROM kyc_applications WHERE customer_id = $1 AND status = 'APPROVED' LIMIT 1 FOR SHARE`.
- Phát hiện hàng `APPROVED`, service ném generic 409 Conflict ngay lập tức.
- Nhật ký truy vấn xác nhận: 0 query tới `status = 'REJECTED'`, 0 lần gọi `normalizeInput` kế thừa, 0 lần gọi `INSERT INTO kyc_applications`, 0 side effect.
- Lưu ý: Đây là unit/contract query sequence test deterministic; kiểm thử race condition / concurrency thực tế trên PostgreSQL được deferred tới M01-07 theo đúng kế hoạch.

#### 3. Kiểm tra tuân thủ Code Quality & Ranh giới bảo mật
- Quét diff: 0 `any`, 0 `as any`, 0 `as unknown as`, 0 `@ts-ignore`, 0 `@ts-expect-error`, 0 `as never` mới.
- 5 test-harness casts được duyệt trước đó tại commit baseline không bị thay đổi.
- Test harness sử dụng class kế thừa thật (`TestPoolClient extends Client implements PoolClient`, `TestDatabasePool extends DatabasePool`, `TestRelationalHttpBoundary extends RelationalHttpBoundary`).
- Không có bất kỳ giá trị `identityNumber` 12 chữ số nào xuất hiện trong diff, test assertion hay log.

### 15.5 CHECKPOINT A PRIVACY EVIDENCE FOLLOW-UP

#### 1. T-KYC-BE-14 Exact Protected Surfaces
Test `T-KYC-BE-14` sử dụng synthetic identity sentinel hợp lệ (12 chữ số) và xác minh nghiêm ngặt rằng sentinel không xuất hiện trên tất cả 7 bề mặt bảo vệ:
1. **Public HTTP response body**: Endpoint `POST /api/v1/kyc/application/submit` trả về JSON chỉ chứa `identityNumberLast4`, hoàn toàn không chứa full identity.
2. **DomainError message**: Khi xảy ra lỗi validation hoặc conflict, `error.message` không chứa full identity.
3. **DomainError fieldErrors**: Chi tiết lỗi `fieldErrors` không bao giờ chứa full identity hay echo lại giá trị người dùng nhập.
4. **Audit log event payload**: Trường payload `$6::jsonb` ghi nhận trong bảng `audit_events` chỉ lưu `{ status: "SUBMITTED" }`, không chứa full identity.
5. **Outbox event payload**: Trường payload `$8::jsonb` ghi nhận trong bảng `outbox_events` chỉ lưu metadata sự kiện an toàn, không chứa full identity.
6. **Notification title & body**: Thông báo người dùng trong bảng `notifications` chỉ chứa thông điệp văn bản chung, không chứa full identity.
7. **Console logging**: Spy trên `console.error` và `console.warn` xác nhận không có bất kỳ log nào in full identity ra output.

#### 2. Phân định ranh giới lưu trữ Identity tại Server
- **Được phép (Allowed)**: `synthetic_payload` lưu trữ server-side trong bảng `kyc_applications` trên cơ sở dữ liệu PostgreSQL. Đây là nơi duy nhất giữ full identity phục vụ nghiệp vụ thẩm định KYC nội bộ.
- **Cấm (Forbidden)**: Mọi luồng ra ngoài cơ sở dữ liệu (HTTP response, Error responses, Audit payload, Outbox event, Notification text, Console output, Mobile storage/state) tuyệt đối không được chứa full identity.

#### 3. Đối chiếu OpenAPI Path và Runtime Mounted URL
- **OpenAPI path key**: `/kyc/application/submit` (đường dẫn chuẩn relative với server base URL trong file `documents/api/banking-mvp.openapi.yaml`).
- **Runtime mounted URL**: `/api/v1/kyc/application/submit` (trong integration-style test và runtime server, do router backend áp dụng tiền tố `const API_PREFIX = "/api/v1"` tại `backend/src/http.ts:28`).
- **Ranh giới tài liệu**: Giữ nguyên OpenAPI document gốc, không chèn `/api/v1` vào OpenAPI path keys.

#### 4. Exact 422 Response Contract
Khi request bỏ trống `identityNumber` và không có nguồn kế thừa hợp lệ:
- **HTTP status**: `422 Unprocessable Entity`.
- **Error code**: `VALIDATION_ERROR`.
- **Error message**: `identityNumber is invalid.`.
- **Exact fieldErrors**: `{ identityNumber: "identityNumber must contain between 6 and 24 digits." }`.
- **Tiêu chuẩn chấp thuận (Acceptance Criteria)**: Dựa trên HTTP 422, code `VALIDATION_ERROR`, sự tồn tại của `fieldErrors.identityNumber`, và bảo đảm không leak giá trị submitted value. Không sửa đổi production code chỉ để khớp câu chữ tài liệu.

#### 5. Thu hẹp phạm vi khẳng định Concurrency (Concurrency Boundary)
- Đính chính và thu hẹp các tuyên bố về race condition:
  - `APPROVED recheck` sau `lockOpen` xử lý một kịch bản deterministic cụ thể: open row chuyển sang `APPROVED` bởi Admin trong lúc customer transaction đang chờ khóa `lockOpen`.
  - `T-KYC-BE-16` chứng minh thứ tự query và logic rẽ nhánh (decision ordering) bằng test double trong môi trường cô lập unit/contract.
  - Test này **chưa chứng minh** mọi trường hợp interleaving đa tiến trình trên PostgreSQL thực tế.
  - Kiểm thử concurrency / row-lock đa tiến trình thực tế trên PostgreSQL disposable được hoãn lại (deferred) chính thức sang task **M01-07**.

#### 6. Xác nhận tính toàn vẹn mã nguồn và trạng thái bàn giao
- Source hash của `backend/src/database/kycService.ts` trước và sau follow-up: `6ae200105253c5e81c1a965746b0bbaddc8c1de0` (không thay đổi một byte nào).
- Checkpoint B (Mobile) chưa bắt đầu.
- Task M01-05 chưa hoàn thành (`COMPLETED`).
- Trạng thái Checkpoint A: `IN_PROGRESS — CHECKPOINT A COMMITTED — CHECKPOINT B NOT STARTED`.

### 15.6 CHECKPOINT A IMPLEMENTATION COMMIT

- **Full implementation commit SHA**: `bd7d8ec2dd8e85721b1ba87af4f3763bff362713`
- **Parent SHA**: `eb1ea7ddfe549d5e3280b96460e5812309eab024`
- **Commit message**: `fix(kyc): enforce terminal application lifecycle`
- **AuthorDate**: `Fri Sep 4 02:46:09 2026 +0700`
- **CommitDate**: `Fri Sep 4 02:46:09 2026 +0700`
- **Exact 3 files**:
  1. `M backend/src/database/kycService.ts`
  2. `M backend/src/tests/kycContract.test.ts`
  3. `M tasks/UC-M01/TASK_M01_05_COMPLETE_KYC_LIFECYCLE_UI_ERRORS.md`
- **Commit stat**: `3 files changed, 1154 insertions(+), 52 deletions(-)`
- **D-10 và D-11 implementation conclusion**:
  - D-10: Hoàn tất trọn vẹn terminal lifecycle enforcement và identity inheritance logic trên Backend service.
  - D-11: Cấu trúc hóa đầy đủ contract test suite bao phủ toàn bộ 16 kịch bản chuyển đổi và validation.
- **Canonical lifecycle**:
  - `NEEDS_MORE_INFO` + `saveDraft`: Giữ nguyên status `NEEDS_MORE_INFO`, giữ ID, tăng `version: +1`.
  - `REJECTED` + `saveDraft` hoặc `submit`: Tạo application mới với UUID mới, `version: 1`; row `REJECTED` cũ hoàn toàn không bị mutate.
  - `APPROVED` precedence: Khi đã có row `APPROVED`, mọi request `saveDraft`/`submit` đều bị từ chối với generic 409 Conflict trước khi normalize hay insert.
  - Idempotent submit replay: Trả về application hiện có kèm HTTP 201, 0 side effect lặp lại.
- **Deterministic identity inheritance**: Omitted identity được kế thừa từ `REJECTED` row gần nhất (`ORDER BY created_at DESC, id ASC LIMIT 1`).
- **Exact open-index conflict mapping**: Chỉ mã lỗi `23505` trên `kyc_applications_customer_open_idx` được map sang generic 409 Conflict; lỗi pkey và unknown database errors được rethrow nguyên trạng.
- **Kiểm thử Checkpoint A**:
  - `T-KYC-BE-01…16`: 16/16 **PASS**.
  - Targeted test count: 28/28 **PASS** (12 tests gốc + 16 tests mới).
  - Full Backend suite: 289 total / 241 pass / 48 intentional skip / 0 fail.
  - Typecheck, build, OpenAPI validator (54 paths / 60 guards), database schema static validator (52 tables): Tất cả đều **PASS**.
- **Privacy test bao phủ 7 surfaces** (`T-KYC-BE-14`): Public HTTP response body, DomainError message, fieldErrors, audit event payload, outbox event payload, notification title/body, và console logging spy.
- **Ranh giới URL và OpenAPI**: OpenAPI path `/kyc/application/submit` phân biệt rõ ràng với runtime mounted URL `/api/v1/kyc/application/submit` (tiền tố `API_PREFIX = "/api/v1"`).
- **Ranh giới Concurrency**: `T-KYC-BE-16` chứng minh query sequence / decision ordering bằng test double; PostgreSQL runtime concurrency và row-lock interleaving thực tế được deferred chính thức sang **M01-07**.
- **Trạng thái quy trình**:
  - Checkpoint A đã committed.
  - Checkpoint B đã hoàn thành implementation và vượt qua toàn bộ quality gates; chờ Owner review.
  - Task M01-05 chưa hoàn thành (`COMPLETED`).
  - Commit thực hiện hoàn toàn local, chưa push.

### 15.7 CHECKPOINT B MOBILE EVIDENCE AND VERIFICATION

- **Thời điểm hoàn thành**: 2026-09-04.
- **Baseline commit**: `736e55ebc4ca4a71cb54221551f3d5a4a03b5e08` (`docs(uc-m01): record KYC lifecycle checkpoint`).
- **Exact allowlist (7 files)**:
  1. `mobile-app/src/features/kyc/screens/KycScreen.tsx`
  2. `mobile-app/src/features/kyc/screens/__tests__/KycScreen.test.tsx`
  3. `mobile-app/src/features/kyc/services/kycApi.ts`
  4. `mobile-app/src/features/kyc/services/__tests__/kycApi.test.ts`
  5. `mobile-app/src/features/kyc/validation/kycValidators.ts`
  6. `mobile-app/src/features/kyc/validation/__tests__/kycValidators.test.ts`
  7. `tasks/UC-M01/TASK_M01_05_COMPLETE_KYC_LIFECYCLE_UI_ERRORS.md`
- **Zero file thứ tám**: Không có bất kỳ file nào ngoài 7 file trên bị thay đổi.
- **Chi tiết triển khai kỹ thuật**:
  - **State Machine hoàn chỉnh**:
    - `INITIAL_LOADING`: Hiển thị `ActivityIndicator`, không hiển thị empty form khi chưa nạp xong.
    - `LOAD_ERROR`: Khi initial load thất bại (`initialLoadFailed && !application`), hiển thị card lỗi chuyên biệt với testID `kyc-load-error-card` và nút testID `kyc-retry-load`. Nút retry bị disabled trong lúc đang tải lại (`disabled={isLoading}`) để chặn triệt để double-press; tuyệt đối không tự động submit hay save.
    - `EMPTY_EDITABLE`: Form trống cho khách hàng chưa từng tạo hồ sơ (`application === null`).
    - `DRAFT_EDITABLE`: Form cho hồ sơ `DRAFT`, hiển thị masked identity `••••<last4>`, nút "Lưu bản nháp" và "Gửi hồ sơ eKYC".
    - `NEEDS_MORE_INFO_EDITABLE`: Banner cảnh báo riêng (vàng cam, testID `kyc-needs-more-info-banner`), copy nêu rõ ngân hàng yêu cầu bổ sung thông tin trên hồ sơ hiện tại, nút "Gửi cập nhật hồ sơ". Tuyệt đối không dùng wording của `REJECTED`.
    - `REJECTED_NEW_APPLICATION`: Banner cảnh báo riêng (đỏ, testID `kyc-rejected-banner`), copy giải thích rõ ràng hồ sơ trước đó đã bị từ chối và lần lưu/nộp tiếp theo sẽ tạo một hồ sơ định danh mới. Tuyệt đối không giả vờ chỉnh sửa trên row cũ.
    - `SUBMITTED_READ_ONLY` & `UNDER_REVIEW_READ_ONLY`: Giao diện chỉ đọc, tóm tắt thông tin hồ sơ và số định danh masked, ghi chú chờ duyệt `kyc-pending-entitlement-note`, nút làm mới trạng thái `kyc-refresh-status`. Không hiển thị nút Save Draft hay Submit.
    - `APPROVED_READ_ONLY`: Giao diện chỉ đọc hoàn toàn, tiêu đề "Đã duyệt", mô tả "Hồ sơ định danh đã được phê duyệt.", hiển thị masked last4. Không hiển thị bất kỳ nút điều khiển chỉnh sửa/lưu/nộp nào.
  - **Fallback an toàn cho `rejectionReason`**:
    - Helper `getRejectionReasonText` loại bỏ trailing dots thừa (`.replace(/\.+$/, "")`), loại bỏ whitespace.
    - Fallback cho `NEEDS_MORE_INFO`: "Cần cập nhật và hoàn thiện hồ sơ định danh".
    - Fallback cho `REJECTED`: "Thông tin định danh chưa đáp ứng tiêu chuẩn đối chiếu".
    - Tuyệt đối không render `undefined`, `null`, hay dấu hai chấm đơn độc `:` khi backend trả về lý do rỗng.
  - **Ánh xạ lỗi 422 từ Backend an toàn (Allowlisted Field-Error Mapping)**:
    - Chỉ map 5 trường allowlisted: `fullName`, `identityNumber`, `address`, `documentUri`, `syntheticDataConfirmed`.
    - Mọi field không nằm trong allowlist bị loại bỏ, không bao giờ spread arbitrary fieldErrors vào state.
    - Hiển thị lỗi tương ứng dưới từng trường nhập liệu và hiển thị banner thông báo tổng thể.
    - Khi người dùng tương tác chỉnh sửa trường nào, lỗi của trường đó được xóa ngay lập tức.
  - **Xử lý lỗi mạng, quá thời gian và phiên làm việc**:
    - `NETWORK_ERROR`: Thông báo "Không thể kết nối đến máy chủ. Vui lòng kiểm tra đường truyền." và cho phép retry thủ công.
    - `TIMEOUT`: Thông báo "Yêu cầu đến máy chủ đã hết thời gian chờ. Vui lòng thử lại sau.", không tự động resubmit.
    - `401 / UNAUTHORIZED`: Thông báo "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." tuân thủ contract auth hiện hành.
  - **Xử lý xung đột 409 Conflict (Concurrency UX)**:
    - Khi nhận 409 từ save/submit: không tin vào local state hiện tại, lập tức gọi `getKycApplication(auth)` để nạp canonical application từ server.
    - Chặn các thao tác trùng lặp trong lúc reload.
    - Tự động chuyển sang chế độ read-only nếu canonical status là `SUBMITTED`, `UNDER_REVIEW`, hoặc `APPROVED`.
    - Nếu reload thất bại: hiển thị thông báo lỗi retryable, không tự động submit lại, không xóa và không ghi log số định danh người dùng đang nhập.
  - **Bảo mật và quyền riêng tư định danh (Identity Privacy UX)**:
    - Hồ sơ mới: yêu cầu bắt buộc nhập số định danh 6–24 chữ số; client validation chặn trước API nếu không hợp lệ.
    - Hồ sơ hiện có giữ nguyên định danh: ô nhập liệu trống, hiển thị `••••<last4>`; request body omit hoàn toàn thuộc tính `identityNumber`.
    - Hồ sơ hiện có thay đổi định danh: bắt buộc nhập 6–24 chữ số mới; gửi full synthetic value; từ chối chuỗi masked (`••••...`) hoặc last4-only (`9012`).
    - Sau khi save/submit thành công: lập tức xóa sạch số định danh đầy đủ khỏi React state (`draft.identityNumber = ""`), chỉ hiển thị `••••<last4>`.
    - Tuyệt đối không lưu full identity vào SecureStore, AsyncStorage, hay tệp tin; không ghi log console chứa identity.
    - Không chứa bất kỳ TypeScript escape cấm nào (`any`, `as any`, `as unknown as`, `as never`, `@ts-ignore`, `@ts-expect-error`).
- **Bộ kiểm thử Mobile đã thực hiện (`T-KYC-FE-01` đến `T-KYC-FE-10`)**:
  - **Per-file targeted counts (3 test suites, 26 tests, 26 PASS, 0 FAIL)**:
    1. `mobile-app/src/features/kyc/screens/__tests__/KycScreen.test.tsx`:
       - Baseline: 4 tests.
       - Added: 10 tests (`T-KYC-FE-01` đến `T-KYC-FE-10`).
       - Removed: 0. Renamed/gộp: 0.
       - Current: 14 tests (14 PASS, 0 FAIL, 0 SKIP).
       - Discovered tests:
         * `renders an existing identity as masked last4 and never renders the full identity`
         * `omits identityNumber for an unchanged existing identity update`
         * `sends a newly entered full identity only after the user changes identity`
         * `blocks a new application without identity before calling the service`
         * `T-KYC-FE-01: Known 422 field errors map to inputs while unknown keys are safely ignored`
         * `T-KYC-FE-02: Initial load failure renders dedicated error view with retry, and prevents double retry`
         * `T-KYC-FE-03: Renders distinct UI for REJECTED, NEEDS_MORE_INFO, and APPROVED states`
         * `T-KYC-FE-04: Null or empty rejectionReason uses semantic safe fallback text`
         * `T-KYC-FE-05: Handles NETWORK_ERROR, TIMEOUT, and 401 with appropriate user messages`
         * `T-KYC-FE-06: New application blocks missing/invalid identity, while existing unchanged identity is omitted`
         * `T-KYC-FE-07: Changed identity sends full new value and rejects masked or last4-only values`
         * `T-KYC-FE-08: 409 Conflict triggers canonical reload, and reload failure does not auto-submit`
         * `T-KYC-FE-09: Save and submit success immediately clears full identity from React state`
         * `T-KYC-FE-10: Read-only states (SUBMITTED, UNDER_REVIEW, APPROVED) hide action controls`
    2. `mobile-app/src/features/kyc/services/__tests__/kycApi.test.ts`:
       - Baseline: 2 tests.
       - Added: 2 tests.
       - Removed: 0. Renamed/gộp: 0.
       - Current: 4 tests (4 PASS, 0 FAIL, 0 SKIP).
       - Discovered tests:
         * `sends the full identity when creating or explicitly changing identity`
         * `omits identityNumber completely when an existing identity is unchanged`
         * `omits identityNumber when draft has empty or whitespace identity`
         * `omits identityNumber when draft contains a masked identity value`
    3. `mobile-app/src/features/kyc/validation/__tests__/kycValidators.test.ts`:
       - Baseline: 5 tests.
       - Added: 3 tests (thuộc describe `context-aware identity validation`).
       - Removed: 0. Renamed/gộp: 0.
       - Current: 8 tests (8 PASS, 0 FAIL, 0 SKIP).
       - Discovered tests:
         * `accepts a complete simulated KYC draft`
         * `reports identity and document errors before submit`
         * `uses the canonical identity boundary and document URI schemes`
         * `allows an existing application update to omit an unchanged identity`
         * `requires syntheticDataConfirmed to be exactly boolean true`
         * `new application context (identityRequired: true): requires 6-24 digits and rejects empty, masked, or last4-only`
         * `existing unchanged context (identityRequired: false): allows empty identity`
         * `existing changed context (identityRequired: false): enforces 6-24 digits and rejects masked or last4-only when entered`
    - **Tổng số targeted tests**: 14 + 4 + 8 = **26 tests** (3 suites, 26 passed, 0 failed, 0 skipped).
    - **Delta so với full suite baseline**:
      - Full suite baseline trước Checkpoint B: 51 suites / 345 tests / 345 pass / 0 fail.
      - Full suite current sau Checkpoint B: 51 suites / 360 tests / 360 pass / 0 fail.
      - Delta: đúng +15 tests (10 tests tại KycScreen.test.tsx + 2 tests tại kycApi.test.ts + 3 tests tại kycValidators.test.ts = +15 tests).
      - Zero test bị xóa, skip hoặc đổi tên.
  - **Cơ chế Bounded Async-Wait (`waitForAssertion`)**:
    - Sử dụng helper `waitForAssertion(assertion: () => void, timeoutMs = 2000, stepMs = 20)`:
      * Chờ điều kiện observable UI/call thông qua assertion lambda.
      * Giới hạn timeout hữu hạn 2000ms; khi vượt quá sẽ throw lỗi cụ thể kèm stack trace của assertion cuối cùng.
      * Không polling vô hạn; bước thăm dò 20ms bên trong `act(async () => ...)`.
      * Trong các test mới `T-KYC-FE-01..10`, không dùng số lượng `Promise.resolve()` tick cố định để đợi render/network.
- **Kết quả Quality Gates Mobile**:
  - `npm run lint`: **PASS** (0 errors, 0 warnings).
  - `npm run typecheck`: **PASS** (0 type errors, Expo Router types generated).
  - `npx jest --runInBand src/features/kyc/...`: **PASS** (3 test suites, 26 tests, 0 failures).
  - `npm test -- --runInBand`: **PASS** (51 test suites, 360 tests, 0 failures).
  - `npm run validate:openapi`: **PASS** (46 required paths).
  - `npm run validate:e2e`: **PASS** (19 Maestro flows valid).
  - `npm run export:web`: **PASS** (36 static routes exported to dist).
  - Backend sanity check (`npm test` và `npm run test:critical`): **PASS** (241 passed / 48 skipped / 0 failed).
- **Trạng thái Git**:
  - Working tree chỉ chứa đúng 7 file allowlisted.
  - Cached area hoàn toàn sạch (0 staged files).
  - Không commit, không push, không tag, không amend.
  - Sẵn sàng bàn giao Owner review gói Checkpoint B.

### 15.8 OWNER REVIEW & APPROVAL RECORD — CHECKPOINT B VERIFIED

- **Thời điểm phê duyệt**: 2026-09-04.
- **Baseline HEAD**: `736e55ebc4ca4a71cb54221551f3d5a4a03b5e08` (`docs(uc-m01): record KYC lifecycle checkpoint`).
- **Owner Review & Chấp thuận**:
  - **Targeted test count**: 3 suites, 26/26 **PASS** (100%).
  - **Per-file breakdown**:
    * `KycScreen.test.tsx`: 14/14 PASS (4 baseline + 10 Checkpoint B).
    * `kycApi.test.ts`: 4/4 PASS (2 baseline + 2 Checkpoint B).
    * `kycValidators.test.ts`: 8/8 PASS (5 baseline + 3 Checkpoint B).
  - **Full Mobile test suite**: 51 suites, 360/360 **PASS**.
  - **Delta xác minh**: Đúng $+15$ tests từ baseline (345 $\rightarrow$ 360), tuyệt đối không xóa/đổi tên/skip bất kỳ test cũ nào.
  - **Bounded async-wait**: Helper `waitForAssertion` tuân thủ timeout hữu hạn 2000 ms, bước thăm dò 20 ms bọc trong `act`, không polling vô hạn, không cố định số tick `Promise.resolve()`.
  - **Toàn bộ Quality Gates Mobile**: `npm run lint`, `npm run typecheck`, `npm test`, `npm run validate:openapi`, `npm run validate:e2e`, `npm run export:web` đều **PASS**.
  - **Ranh giới công việc**:
    * Task **M01-07** (PostgreSQL runtime concurrency & disposable database test) và **M01-08** (Device / Staging E2E) vẫn được hoãn lại (deferred) chính thức.
    * Task **M01-05** chưa `COMPLETED` tại bước staging; chỉ chuyển sang trạng thái chờ commit Checkpoint B.
  - **Trạng thái quy trình**: `IN_PROGRESS — CHECKPOINT B VERIFIED — AWAITING CHECKPOINT COMMIT`.
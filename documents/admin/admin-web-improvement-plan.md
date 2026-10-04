# Kế hoạch Cải tạo Admin Web (Admin Web Improvement Plan)

- **Mã kế hoạch**: AW-PLAN-01
- **HEAD Commit**: `9254922a9bfe486f1b0b833d80c5fd2e508bcc3b`
- **Branch**: `codex/staging-academic-completion`
- **Trạng thái Worktree**: Có WIP baseline ngoài phạm vi (`PROJECT_CONTEXT.md`, `USE_CASE_ROADMAP.md`, `backend/scripts/run-core-tests.cjs` và các file tài liệu demo/thuyết trình untracked). Toàn bộ được giữ nguyên, không đụng chạm.
- **Mục tiêu**: Nâng cấp Admin Web thành ứng dụng quản trị rõ ràng, đúng chuẩn nghiệp vụ ngân hàng tham chiếu, phục vụ bảo vệ đồ án tốt nghiệp đại học.

---

## 1. Bảng đối chiếu Màn hình → API → Permission → Trạng thái → Thao tác

| Nhóm điều hướng | Màn hình | API liên quan | Permission cần thiết | Trạng thái hiển thị | Thao tác người dùng | Phân loại |
|---|---|---|---|---|---|---|
| **1. Tổng quan** | Tổng quan hệ thống | `GET /admin/operations/outbox/summary`<br>`GET /admin/approvals` (nếu có quyền) | Mọi staff đăng nhập hợp lệ (`audit.read` để đếm approval) | Số lượng pending/dead outbox, số approval chờ, vai trò staff, kết nối online/offline | Chuyển nhanh tới các màn hình nghiệp vụ theo quyền | Sửa UX |
| **2. Nghiệp vụ** | Khách hàng & tài khoản | `GET /admin/customers?q=...`<br>`GET /admin/customers/{id}`<br>`GET /admin/customers/{id}/accounts`<br>`GET /admin/accounts/{id}/transactions` | `customer.read.masked`<br>`account.read` | Khách hàng: `ACTIVE`, `LOCKED`<br>Tài khoản: `ACTIVE`, `BLOCKED` (kèm version, số dư) | - Tìm kiếm khách hàng<br>- Xem danh sách tài khoản, số dư<br>- Xem giao dịch tài khoản<br>- Tạo yêu cầu khóa/mở khóa khách hàng<br>- Tạo yêu cầu khóa/mở khóa tài khoản<br>- Tạo yêu cầu funding / hoàn tác funding | Sửa UX & hoàn thiện luồng |
| **2. Nghiệp vụ** | Hồ sơ KYC | `GET /admin/applications`<br>`GET /admin/kyc-applications/{id}`<br>`POST /admin/kyc-applications/{id}/claim`<br>`POST /admin/kyc-applications/{id}/review-recommendations` | `kyc.read`<br>`kyc.review` (claim)<br>`kyc.decision.request` (recommend) | `SUBMITTED`, `UNDER_REVIEW`, `APPROVED`, `REJECTED`, `NEEDS_MORE_INFO` | - Xem danh sách & chi tiết hồ sơ KYC<br>- Tiếp nhận hồ sơ (Claim)<br>- Đề xuất duyệt / từ chối / bổ sung thông tin (Tạo yêu cầu chờ phê duyệt) | Sửa UX (Tách riêng khỏi Credit) |
| **2. Nghiệp vụ** | Hồ sơ tín dụng | `GET /admin/applications`<br>`GET /admin/credit-applications/{id}`<br>`POST /admin/credit-applications/{id}/claim`<br>`POST /admin/credit-applications/{id}/review-recommendations` | `credit-application.read`<br>`credit-application.review` | `SUBMITTED`, `UNDER_REVIEW`, `PENDING_ACTIVATION`, `REJECTED` | - Xem danh sách & chi tiết hồ sơ tín dụng<br>- Tiếp nhận hồ sơ (Claim)<br>- Đề xuất kích hoạt hạn mức / từ chối (Tạo yêu cầu phê duyệt) | Sửa UX (Tách riêng khỏi KYC) |
| **2. Nghiệp vụ** | Giao dịch chờ xử lý | `GET /admin/transfers?status=...`<br>`GET /admin/transfers/{id}`<br>`GET /admin/transfers/{id}/timeline`<br>`POST /admin/transfers/{id}/retry-requests`<br>`POST /admin/transfers/{id}/cancel-requests`<br>`POST /admin/transfers/{id}/reversal-requests` | `transfer.pending.read`<br>`transfer.action.request` | `PENDING`, `FAILED`, `SUCCEEDED`, `CANCELLED` | - Xem danh sách theo bộ lọc trạng thái<br>- Xem timeline giao dịch<br>- Yêu cầu hủy (`PENDING`)<br>- Yêu cầu thử lại (`FAILED`)<br>- Yêu cầu hoàn tác (`SUCCEEDED`) | Sửa UX & sửa bug filter PENDING |
| **2. Nghiệp vụ** | Báo cáo gian lận (Fraud) | `GET /admin/fraud-cases?status=...`<br>`GET /admin/fraud-cases/{id}`<br>`POST /admin/fraud-cases/{id}/claim`<br>`POST /admin/fraud-cases/{id}/notes`<br>`POST /admin/fraud-cases/{id}/resolution-requests` | `fraud.read`<br>`fraud.claim`<br>`fraud.investigate`<br>`fraud.action.request` | `RECEIVED`, `UNDER_INVESTIGATION`, `RESOLVED`, `CLOSED` | - Xem danh sách case<br>- Mở chi tiết case cụ thể<br>- Tiếp nhận case (Claim)<br>- Ghi chú điều tra vào case đang chọn<br>- Gửi yêu cầu giải quyết (Resolution request) | Sửa UX & sửa bug ghi chú sai case |
| **3. Phê duyệt** | Approval Inbox | `GET /admin/approvals`<br>`GET /admin/approvals/{id}`<br>`POST /admin/approvals/{id}/approve`<br>`POST /admin/approvals/{id}/reject`<br>`POST /admin/approvals/{id}/cancel` | `audit.read`<br>Kèm quyền approve tương ứng của action (`*.approve`) | `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `CANCELLED`, `SUCCEEDED`, `FAILED`, `EXPIRED`, `STALE` | - Xem danh sách yêu cầu chờ duyệt<br>- Xem chi tiết: đối tượng, người gửi, fingerprint, payload đã che<br>- Step-up MFA TOTP<br>- Phê duyệt (Approve) với lý do & nhận xét<br>- Từ chối (Reject) với lý do<br>- Hủy (Cancel - nếu là người gửi yêu cầu) | Sửa UX & hoàn thiện luồng kiểm soát |
| **4. Vận hành** | Outbox & Background Jobs | `GET /admin/operations/outbox/summary`<br>`GET /admin/operations/outbox/events`<br>`GET /admin/operations/outbox/dead-letters`<br>`POST /admin/operations/outbox/events/{id}/requeue-requests`<br>`GET /admin/operations/jobs`<br>`POST /admin/operations/jobs/{id}/retry-requests` | `outbox.read`<br>`outbox.requeue.request`<br>`job.read`<br>`job.retry.request` | Outbox: `PENDING`, `PROCESSING`, `DEAD`, `SKIPPED`<br>Jobs: `PENDING`, `RUNNING`, `FAILED`, `DEAD`, `COMPLETED` | - Xem số liệu tổng quan outbox<br>- Lọc danh sách event / dead letters<br>- Tạo yêu cầu Requeue event `DEAD`/`SKIPPED`<br>- Tạo yêu cầu Retry job `FAILED`/`DEAD` | Sửa UX & giải thích rõ trạng thái |
| **5. Quản trị** | Nhân viên & Vai trò | `GET /admin/staff`<br>`GET /admin/staff/{id}`<br>`GET /admin/roles`<br>`GET /admin/permissions`<br>`POST /admin/staff/operations-accounts/mfa-setup`<br>`POST /admin/staff/operations-accounts`<br>`POST /admin/staff/{id}/role-change-requests`<br>`POST /admin/staff/{id}/disable-requests` | `staff.read`<br>`staff.operations-account.create`<br>`staff.role-change.request`<br>`staff.disable.request` | `ACTIVE`, `LOCKED`, `DISABLED` | - Xem danh sách nhân viên & vai trò<br>- ADMIN tạo trực tiếp tài khoản OPERATIONS, mật khẩu ban đầu và xác minh TOTP<br>- Tạo yêu cầu đổi vai trò nhân viên<br>- Tạo yêu cầu vô hiệu hóa nhân viên | Sửa UX và hoàn thiện quy trình phê duyệt có MFA |
| **5. Quản trị** | Nhật ký hoạt động (Audit) | `GET /admin/audit-events?limit=...`<br>`GET /admin/audit-events/{id}` | `audit.read` | Sự kiện append-only bất biến (`SUCCEEDED`, `DENIED`, `FAILED`) | - Xem danh sách sự kiện kiểm toán<br>- Xem chi tiết metadata an toàn đã che PII/secret | Giữ nguyên và chuẩn hóa hiển thị bảng |
| **Xác thực** | Kích hoạt staff | `POST /admin/auth/activate` | Công khai qua liên kết mời có token | Chưa kích hoạt / Đã kích hoạt | Nhập mật khẩu mới, nhận khóa TOTP MFA hoặc tự cung cấp khóa | Giữ nguyên hành vi contract an toàn |

---

## 2. Bảng Endpoint Ghi và Hợp đồng An toàn / Idempotency

| Endpoint ghi | HTTP | Idempotency-Key | Payload bắt buộc | Response thành công | Mã lỗi nghiệp vụ xác định | Xử lý khi Timeout / Lỗi mạng |
|---|---|---|---|---|---|---|
| `/admin/customers/{id}/access-lock-requests` | POST | Bắt buộc (8-128 ký tự) | `reasonCode`, `ticketReference`, `description` | 202 `{ action }` | `ACCOUNT_STATUS_CONFLICT`, `ADMIN_PERMISSION_DENIED` | Giữ form và idempotency key trong memory; không tự động sinh key mới; kiểm tra lại danh sách hoặc Inbox để đối soát. |
| `/admin/customers/{id}/access-unlock-requests` | POST | Bắt buộc (8-128 ký tự) | `reasonCode`, `ticketReference`, `description` | 202 `{ action }` | `ACCOUNT_STATUS_CONFLICT`, `ADMIN_PERMISSION_DENIED` | Như trên. |
| `/admin/accounts/{id}/block-requests` | POST | Bắt buộc (8-128 ký tự) | `reasonCode`, `ticketReference`, `description` | 202 `{ action }` | `ACCOUNT_STATUS_CONFLICT`, `ADMIN_PERMISSION_DENIED` | Như trên. |
| `/admin/accounts/{id}/unblock-requests` | POST | Bắt buộc (8-128 ký tự) | `reasonCode`, `ticketReference`, `description` | 202 `{ action }` | `ACCOUNT_STATUS_CONFLICT`, `ADMIN_PERMISSION_DENIED` | Như trên. |
| `/admin/accounts/{id}/funding-requests` | POST | Bắt buộc (8-128 ký tự) | `amountMinor`, `currency`: "VND", `reasonCode`, `ticketReference`, `description` | 202 `{ action }` | `FUNDING_LIMIT_EXCEEDED`, `ACCOUNT_STATUS_CONFLICT`, `ADMIN_PERMISSION_DENIED` | Giữ nguyên số tiền và mã yêu cầu; kiểm tra lại tài khoản trước khi thử lại; không replay mù quáng. |
| `/admin/accounts/{id}/funding-reversal-requests` | POST | Bắt buộc (8-128 ký tự) | `amountMinor`, `currency`: "VND", `sourceTransactionId`, `reasonCode`, `ticketReference`, `description` | 202 `{ action }` | `FUNDING_LIMIT_EXCEEDED`, `INVALID_REQUEST`, `ADMIN_PERMISSION_DENIED` | Như trên. |
| `/admin/approvals/{id}/approve` | POST | Bắt buộc (8-128 ký tự) | `fingerprint`, `version`, `reasonCode`, `decision`: "APPROVED", `comment` | 200 `{ action, receipt }` | `ACTION_STALE`, `ACTION_ALREADY_DECIDED`, `ACTION_FINGERPRINT_MISMATCH`, `STAFF_MFA_REQUIRED` | Nếu timeout, tải lại chi tiết action qua `GET /admin/approvals/{id}` để xem đã thành `SUCCEEDED` chưa; nếu chưa, có thể gửi lại cùng key. |
| `/admin/approvals/{id}/reject` | POST | Bắt buộc (8-128 ký tự) | `fingerprint`, `version`, `reasonCode`, `comment` | 200 `{ action }` | `ACTION_STALE`, `ACTION_ALREADY_DECIDED`, `STAFF_MFA_REQUIRED` | Tải lại action để kiểm tra trạng thái trước khi thực hiện hành động khác. |
| `/admin/kyc-applications/{id}/claim` | POST | Bắt buộc (8-128 ký tự) | `{}` | 200 `{ application }` | `CASE_STATUS_CONFLICT`, `ADMIN_PERMISSION_DENIED` | Tải lại hồ sơ để xem đã được claim chưa. |
| `/admin/kyc-applications/{id}/review-recommendations` | POST | Bắt buộc (8-128 ký tự) | `decision`, `reasonCode`, `ticketReference`, `description` | 202 `{ action }` | `CASE_STATUS_CONFLICT`, `ADMIN_PERMISSION_DENIED` | Giữ form và kiểm tra Approval Inbox. |
| `/admin/credit-applications/{id}/claim` | POST | Bắt buộc (8-128 ký tự) | `{}` | 200 `{ application }` | `CASE_STATUS_CONFLICT`, `ADMIN_PERMISSION_DENIED` | Tải lại hồ sơ để xem đã được claim chưa. |
| `/admin/credit-applications/{id}/review-recommendations` | POST | Bắt buộc (8-128 ký tự) | `decision`, `approvedLimitMinor`?, `reasonCode`, `ticketReference`, `description` | 202 `{ action }` | `CASE_STATUS_CONFLICT`, `ADMIN_PERMISSION_DENIED` | Giữ form và kiểm tra Approval Inbox. |
| `/admin/fraud-cases/{id}/notes` | POST | Bắt buộc (8-128 ký tự) | `note` | 201 `{ status: "RECORDED" }` | `INVALID_REQUEST`, `ADMIN_PERMISSION_DENIED` | Giữ nội dung ghi chú; tải lại timeline case để xác nhận ghi chú đã được lưu chưa. |
| `/admin/fraud-cases/{id}/resolution-requests` | POST | Bắt buộc (8-128 ký tự) | `operation`: "RESOLVE", `resolutionCode`, `reasonCode`, `ticketReference`, `description` | 202 `{ action }` | `INVALID_REQUEST`, `ADMIN_PERMISSION_DENIED` | Giữ form và kiểm tra lại trạng thái case. |
| `/admin/operations/outbox/events/{id}/requeue-requests` | POST | Bắt buộc (8-128 ký tự) | `reasonCode`, `ticketReference`, `description` | 202 `{ action }` | `OUTBOX_NOT_REQUEUEABLE`, `ADMIN_PERMISSION_DENIED` | Giữ form; kiểm tra trạng thái event trong Outbox. |
| `/admin/operations/jobs/{id}/retry-requests` | POST | Bắt buộc (8-128 ký tự) | `reasonCode`, `ticketReference`, `description` | 202 `{ action }` | `JOB_NOT_RETRYABLE`, `ADMIN_PERMISSION_DENIED` | Giữ form; kiểm tra trạng thái job. |
| `/admin/staff/{id}/role-change-requests` | POST | Bắt buộc (8-128 ký tự) | `roleCode`, `operation`, `environmentScope`, `reasonCode`, `ticketReference`, `description` | 202 `{ action }` | `INVALID_REQUEST`, `STAFF_STATUS_CONFLICT`, `ADMIN_PERMISSION_DENIED` | Giữ form nhập liệu. |
| `/admin/staff/{id}/disable-requests` | POST | Bắt buộc (8-128 ký tự) | `reasonCode`, `ticketReference`, `description` | 202 `{ action }` | `STAFF_STATUS_CONFLICT`, `ADMIN_PERMISSION_DENIED` | Không gửi lại nếu đã tạo action. |

---

## 3. Phân tích Vấn đề UX Hiện tại và Hướng Khắc phục

1. **Kiến trúc mã nguồn nguyên khối**:
   - *Hiện tại*: Toàn bộ state, handler, giao diện 9 màn hình và modal nằm dồn trong `admin-web/src/App.tsx`.
   - *Khắc phục*: Tách cấu trúc thư mục thành:
     - `src/types/`: Kiểu dữ liệu nghiệp vụ, API payload và session.
     - `src/services/` hoặc `src/api.ts`: Gom client gọi API, quản lý CSRF token, idempotency key.
     - `src/context/`: Quản lý phiên nhân viên (StaffSession), quyền (Permissions) và routing.
     - `src/components/common/`: Thành phần dùng chung (Button, Table, Modal, StatusBadge, Notice, FormField, Spinner, EmptyState).
     - `src/components/layout/`: Topbar, Sidebar phân nhóm, AppLayout.
     - `src/features/`: Tách theo miền nghiệp vụ (`overview`, `customers`, `approvals`, `kyc`, `credit`, `transfers`, `fraud`, `operations`, `staff`, `audit`, `auth`).
     - `src/App.tsx`: Đóng vai trò điểm lắp ghép router/shell sạch sẽ.

2. **Cơ chế Nuốt lỗi và Đóng Form sai thời điểm**:
   - *Hiện tại*: `requestAction` trong `App.tsx` gọi `try ... catch` nhưng không trả về trạng thái cho caller; caller đóng form và xóa state ngay cả khi request bị từ chối hoặc lỗi mạng.
   - *Khắc phục*: Tách hàm gửi mutation trả về kết quả rõ ràng (`{ success: true, action?: Action } | { success: false, error: ApiError }`). Chỉ đóng modal và reset form khi nhận `success === true`. Nếu thất bại, giữ nguyên dữ liệu đã điền trong form và hiển thị thông báo lỗi chi tiết có traceId. Nếu POST thành công nhưng GET danh sách làm mới bị lỗi, thông báo rõ "Đã tạo yêu cầu thành công, tải lại danh sách thất bại" với nút Thử lại chỉ tải lại danh sách.

3. **Lỗi Ghi chú Fraud mặc định vào Case đầu tiên**:
   - *Hiện tại*: Nút `Ghi chú case đầu tiên` gửi vào `items[0].id`.
   - *Khắc phục*: Cho phép nhân viên chọn một case cụ thể từ danh sách để mở xem chi tiết, và ô ghi chú/nút gửi ghi chú luôn gắn chặt với ID của case đang được chọn.

4. **Lỗi Danh sách Giao dịch chỉ hiển thị PENDING**:
   - *Hiện tại*: Luôn gọi `/admin/transfers?status=PENDING`, khiến các nút thao tác retry (cho `FAILED`) hay reversal (cho `SUCCEEDED`) không bao giờ có dữ liệu để bấm trong thực tế.
   - *Khắc phục*: Bổ sung bộ lọc trạng thái (Tất cả, PENDING, FAILED, SUCCEEDED, CANCELLED) để người dùng có thể xem và xử lý các giao dịch ở từng trạng thái tương ứng.

5. **Phân quyền và Kiểm tra Trạng thái**:
   - *Hiện tại*: Trộn lẫn giữa kiểm tra tên role (`hasRole(...)`) và quyền (`canReadApprovals`).
   - *Khắc phục*: Dùng danh sách `permissions` do server trả về tại `/admin/me`. Cung cấp helper `hasPermission(perm)` chuẩn xác. Khi quyền chưa tải xong, không hiển thị nút đặc quyền để tránh bấm nhầm.

6. **Điều hướng và Routing**:
   - *Hiện tại*: State `tab` cục bộ, bấm refresh trình duyệt sẽ bị nhảy về `overview`, không hỗ trợ Back/Forward, không có URL trực tiếp tới từng màn hình.
   - *Khắc phục*: Áp dụng Hash Routing (`#/overview`, `#/customers`, `#/customers/:id`, `#/approvals`, `#/approvals/:id`, `#/kyc`, `#/credit`, `#/transfers`, `#/fraud`, `#/operations`, `#/staff`, `#/audit`). Giải pháp này tương thích 100% với cấu hình Nginx/Vite hiện có, không can thiệp server config, hỗ trợ Back/Forward và F5 tải lại trang đúng ngữ cảnh, bảo toàn liên kết `/admin/activate`.

---

## 4. Phác thảo Bố cục Giao diện

### 4.1. Bố cục Khách hàng & Tài khoản (`#/customers`)
- **Phía trên**: Ô tìm kiếm (Placeholder: "Nhập email, số điện thoại hoặc họ tên khách hàng") + Nút "Tìm kiếm".
- **Vùng kết quả tìm kiếm**: Thẻ/Bảng khách hàng hiển thị Họ tên, Email đã che, Số điện thoại đã che, Trạng thái truy cập (`ACTIVE` / `LOCKED`), cùng nút "Xem tài khoản" và "Yêu cầu khóa/mở khóa".
- **Khi chọn một khách hàng**:
  - Breadcrumb: `Khách hàng > [Tên khách hàng đã che]`.
  - Danh sách tài khoản thanh toán: Tên tài khoản, Số tài khoản masked (`****9001`), Số dư khả dụng (`availableMinor`), Số dư hiện tại, Trạng thái tài khoản (`ACTIVE` / `BLOCKED`), Version tài khoản.
  - Thao tác trên từng tài khoản: "Yêu cầu cấp tiền (Funding)" / "Hoàn tác funding", "Khóa tài khoản" / "Mở khóa tài khoản" (dành cho OPERATIONS).
  - Modal tạo yêu cầu: Có bước xem lại xác nhận thông tin (Tên khách hàng, số tài khoản đích, số tiền / lý do) trước khi gửi server.

### 4.2. Bố cục Hồ sơ KYC (`#/kyc`) và Hồ sơ Tín dụng (`#/credit`)
- **Tách 2 trang riêng biệt**:
  - `#/kyc`: Tiêu đề "Quản lý Hồ sơ Định danh (KYC)"
  - `#/credit`: Tiêu đề "Quản lý Hồ sơ Đề nghị Hạn mức Tín dụng"
- **Danh sách hồ sơ**: Bảng gồm Mã hồ sơ, Khách hàng, Trạng thái (`SUBMITTED`, `UNDER_REVIEW`, `APPROVED`, v.v.), Phiên bản, Người đang xử lý (Assigned staff), Ngày nộp.
- **Chi tiết hồ sơ**:
  - Nhãn tiếng Việt rõ ràng: "Tiếp nhận hồ sơ" (thay cho Claim), "Tạo đề xuất quyết định" (thay cho Recommendation).
  - Modal tạo đề xuất: Chọn quyết định (`APPROVED`, `REJECTED`, `NEEDS_MORE_INFO` đối với KYC; `PENDING_ACTIVATION`, `REJECTED` kèm hạn mức đề xuất đối với Tín dụng), nhập Mã lý do, Mã ticket và Mô tả.
  - Ghi chú bảo mật: Không hiển thị hình ảnh giấy tờ thật hoặc dữ liệu PII ngoài quyền; chỉ hiển thị thông tin metadata định danh mô phỏng.

### 4.3. Bố cục Approval Inbox (`#/approvals`)
- **Sidebar badge**: Hiển thị số lượng yêu cầu đang chờ phê duyệt.
- **Danh sách chờ**: Bảng phân cột rõ ràng gồm Loại hành động (Tiếng Việt kèm mã nghiệp vụ: Cấp tiền, Khóa tài khoản, Duyệt KYC, v.v.), Đối tượng tác động (Tài khoản/Khách hàng), người gửi yêu cầu, thời hạn hiệu lực và trạng thái.
- **Hộp thoại / Khung xem chi tiết yêu cầu**:
  - Thông tin nghiệp vụ tóm tắt ở phần trên (dễ đọc, dễ hiểu).
  - Thông tin kiểm toán ở phần dưới: Version hành động, Fingerprint (rút gọn có nút xem đầy đủ), Payload đã lọc/che các trường nhạy cảm.
  - ADMIN được tự phê duyệt yêu cầu đủ quyền sau khi xác thực Step-up MFA.
  - Ô nhập "Lý do phê duyệt / từ chối" và nhận xét (bắt buộc).
  - Nút "Phê duyệt" (mở bước Step-up TOTP nếu chưa xác thực trong 5 phút gần nhất) và "Từ chối".
  - Khi server trả về `ACTION_STALE`: Hiển thị thông báo dữ liệu đích đã bị thay đổi kèm nút "Tải lại yêu cầu mới nhất".

---

## 5. Phân chia các Đợt Triển khai

- **AW-01 — Đối chiếu và chốt thiết kế**: Lập kế hoạch chi tiết, bảng ma trận API/Permissions/Thao tác (file này).
- **AW-02 — Nền tảng UI và tổ chức code**: Xây dựng cấu trúc thư mục mới, tách component chung, triển khai hash routing, quản lý session/permissions, nâng cấp CSS thân thiện và nhất quán.
- **AW-03 — Khách hàng, tài khoản và phê duyệt**: Triển khai luồng Khách hàng/Tài khoản và Approval Inbox với cơ chế step-up, xem lại trước khi gửi, và kiểm tra quyền chuẩn xác.
- **AW-04 — KYC và tín dụng**: Tách riêng hai trang KYC và Tín dụng, hoàn thiện các bước claim và recommendation bằng tiếng Việt chuẩn.
- **AW-05 — Đồng bộ phần còn lại**: Hoàn thiện Giao dịch (sửa filter), Fraud (sửa bug gắn case), Vận hành (Outbox/Jobs), Nhân viên (Staff/Roles), Audit explorer và Dashboard.
- **AW-06 — Kiểm thử, sửa lỗi và bàn giao**: Chạy bộ kiểm thử (lint, typecheck, contract test, e2e test, audit), kiểm tra trình duyệt ở 1366x768 và 768px, cập nhật tài liệu và lập báo cáo bàn giao.

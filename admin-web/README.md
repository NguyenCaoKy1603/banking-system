# Banking Admin Web

Ứng dụng quản trị (Control Plane) xây dựng bằng **React + TypeScript + Vite**, thiết kế tối ưu cho màn hình laptop/desktop phục vụ đồ án tốt nghiệp đại học về hệ thống ngân hàng tham chiếu.

Hệ thống dùng hai vai trò `OPERATIONS` và `ADMIN`:
- Session token hoàn toàn nằm trong cookie `HttpOnly`, `SameSite=Strict`.
- CSRF token gửi qua header `X-CSRF-Token` cho các request thay đổi trạng thái; tuyệt đối không lưu token/credential vào `localStorage` hay `sessionStorage`.
- Không nhúng URL API hoặc secret vào JavaScript bundle (same-origin `/api/v1` thông qua runtime proxy của Vite/Nginx).
- **Hỗ trợ 2 Chế độ Vận hành**:
  - **Chế độ Thực thi Trực tiếp 1 chạm (`ADMIN_DIRECT_EXECUTION=true`)**: Cho phép thực thi trực tiếp các thao tác nạp tiền, hoàn tiền, khóa/mở khóa tài khoản, duyệt hồ sơ eKYC/Credit ngay lập tức vào Core Banking/Ledger mà không cần qua Approval Inbox hai bước. Rất thuận tiện và tối ưu khi chạy kiểm thử local, liên thông Mobile App và thuyết minh đồ án.
  - **Chế độ Phê duyệt 2 bước chuẩn (`ADMIN_DIRECT_EXECUTION=false`)**: Yêu cầu quy trình Maker-Checker truyền thống; các yêu cầu được chuyển vào Approval Inbox để Admin phê duyệt kèm xác thực TOTP Step-up.
- **Chuẩn hóa Giao diện Thuần Nghiệp vụ Ngân hàng**:
  - Gỡ bỏ hoàn toàn trường nhập "Mã tham chiếu / Ticket reference" trên toàn bộ các modal người dùng (Cấp tiền, Khóa tài khoản, Duyệt eKYC/Credit, Hoàn tiền, Retry jobs); hệ thống tự động sinh và quản lý mã tham chiếu ngầm bảo đảm 100% hợp đồng dữ liệu.
  - Loại bỏ hoàn toàn các thuật ngữ "thử nghiệm", "mô phỏng", "sandbox" trên giao diện; sử dụng chuẩn hóa danh mục mã lý do ngân hàng: `CASH_DEPOSIT` (Nộp tiền mặt tại quầy), `ACCOUNT_FUNDING` (Nạp tiền vào tài khoản), `PROMOTION_REWARD`, `CUSTOMER_COMPENSATION`, `OPERATIONS_REVIEW`, `ACCOUNT_SECURITY`.
- Admin tạo tài khoản Operations trực tiếp trên trang Nhân viên: đặt mật khẩu ban đầu và cấu hình MFA ngay tại đó, không gửi email mời và không tạo yêu cầu trong Approval Inbox.
- Operations xác minh mã Authenticator một lần khi Admin tạo tài khoản, sau đó đăng nhập bằng email và mật khẩu. Admin vẫn cần nhập TOTP mỗi lần đăng nhập; các thao tác duyệt nhạy cảm vẫn yêu cầu TOTP Step-up.
- Bảo vệ ý định ghi (Command Intent Snapshot) và Idempotency Key ổn định khi gặp sự cố mạng hoặc timeout, ngăn ngừa phát sinh giao dịch trùng lặp khi người dùng retry.
- Kiểm tra chặt chẽ cấu trúc phản hồi máy chủ (`isValidActionResponse`), ngăn ngừa báo thành công giả khi response thiếu action ID.
- Quản lý bộ nhớ phiên nghiêm ngặt: dọn sạch yêu cầu chưa xác định khi đăng xuất hoặc đổi nhân viên qua `SessionScope` (`staffId`, `generation`), cô lập hoàn toàn callback muộn giữa các phiên làm việc.

---

## 1. Cấu trúc và Kiến trúc Mã nguồn

Mã nguồn được tổ chức theo module nghiệp vụ rõ ràng, tách bạch trách nhiệm:

```text
admin-web/
├── src/
│   ├── api.ts                     # Client gọi API, active timeout 15s (hỗ trợ override), CSRF, formatters và phân loại lỗi
│   ├── types.ts                   # Định nghĩa kiểu dữ liệu nghiệp vụ, API payload, session, intent, SessionScope
│   ├── router.ts                  # Bộ định tuyến Hash Routing (#/overview, #/customers, ...)
│   ├── context/
│   │   └── StaffContext.tsx       # Quản lý phiên nhân viên, lifecycle SessionScope, auth epoch guard, dọn dẹp khi logout
│   ├── components/
│   │   ├── common/                # UI components dùng chung (DataTable, Modal, Notice, StatusBadge, Heading, AutoRefreshControl)
│   │   └── layout/                # Khung ứng dụng (AppLayout, Topbar z-index 60, Sidebar 5 phân nhóm)
│   ├── features/                  # Các module nghiệp vụ cụ thể
│   │   ├── auth/                  # Operations: mật khẩu; Admin: mật khẩu + MFA TOTP; kích hoạt tài khoản
│   │   ├── overview/              # Bảng điều khiển Tổng quan, số liệu thực tế và nguyên tắc vận hành
│   │   ├── customers/             # Tra cứu khách hàng, số dư tài khoản, tạo yêu cầu khóa/funding, hiển thị banner chờ duyệt
│   │   │   ├── Customers.tsx      # Giao diện chính màn hình Khách hàng & Tài khoản, pending approval badges, scope guard
│   │   │   ├── actionIntent.ts    # Quản lý vòng đời ý định ghi, SessionScope generation guard, stable idempotency key
│   │   │   └── accountLoader.ts   # AccountLoadManager với generation ID guard chống race condition
│   │   ├── approvals/             # Approval Inbox, tự động làm mới 15s và xác thực step-up MFA
│   │   │   ├── Approvals.tsx      # Giao diện Approval Inbox, AutoRefreshControl và hộp thoại thẩm định
│   │   │   └── approvalsLogic.ts  # Mapping quyền duyệt theo actionType, resolve decision endpoint
│   │   ├── applications/          # Hồ sơ Định danh và Hạn mức Tín dụng (claim, modal xem chi tiết hồ sơ định danh/Credit)
│   │   ├── transfers/             # Giám sát giao dịch theo trạng thái, yêu cầu cancel/retry/reversal và Hàng đợi cảnh báo bất thường (Anomaly Queue)
│   │   ├── operations/            # Giám sát Transactional Outbox, Background Jobs, requeue/retry, AutoRefreshControl
│   │   ├── policy/                # Chính sách vận hành, biểu phí động (TOTP Step-up) và Đối soát Sổ cái kép (Trial Balance Reconciliation)
│   │   ├── staff/                 # Danh sách nhân sự, tạo Operations trực tiếp, đổi vai trò và vô hiệu hóa
│   │   └── audit/                 # Nhật ký kiểm toán append-only bất biến, xuất báo cáo CSV/JSON, AutoRefreshControl
│   ├── App.tsx                    # Điểm lắp ghép ứng dụng chính và điều hướng
│   ├── main.tsx                   # Điểm khởi chạy React DOM
│   └── styles.css                 # Hệ thống kiểu dáng nhất quán, mockup thẻ CCCD/Credit, auto-refresh pulse
├── test/
│   ├── admin-web.contract.test.cjs # Contract tests kiểm tra cấu trúc source và nguyên tắc bảo mật
│   └── admin-web.ui-logic.test.cjs # UI logic tests cho actionIntent, accountLoader, approvalsLogic và api
```

---

## 2. 5 Nhóm Điều hướng Quản trị và Phân quyền

Giao diện được phân nhóm theo chuẩn nghiệp vụ ngân hàng dựa trên danh sách quyền (`permissions`) được server trả về từ `/admin/me`:

1. **Tổng quan (`#/overview`)**: Thống kê số lượng hàng đợi phê duyệt (nếu có `audit.read`), trạng thái sự kiện nền outbox, thông tin nhân viên đang đăng nhập.
2. **Nghiệp vụ**:
   - *Khách hàng (`#/customers`)*: Tìm kiếm dữ liệu đã che (`customer.read.masked`), xem tài khoản (`account.read`). Hỗ trợ thao tác **Cấp tiền (Nạp tiền)** với các nút chọn nhanh số tiền (`+1M`, `+5M`, `+10M`, `+50M`, `100M`), xem trước định dạng VND, dropdown mã lý do nghiệp vụ chuẩn (`CASH_DEPOSIT`, `ACCOUNT_FUNDING`, `PROMOTION_REWARD`, `CUSTOMER_COMPENSATION`, `OPERATIONS_REVIEW`, `ACCOUNT_SECURITY`), nút **Hoàn tác nạp tiền**, và thao tác **Khóa/Mở khóa**. Toàn bộ modal đã được tinh giản, không hiển thị trường Ticket Reference. Hỗ trợ cả chế độ thực thi trực tiếp lẫn chế độ 2 bước có bước Xem lại (Review Step) và **Badge `⏳ Đang chờ duyệt`**. Cung cấp nút *Tải lại danh sách* có generation guard bảo vệ chống response cũ ghi đè.
   - *Hồ sơ định danh (`#/kyc`)*: Quản lý hồ sơ định danh (`kyc.read`, `kyc.review`, `kyc.decision.request`). Hỗ trợ nút **Xem hồ sơ** mở Modal trực quan chi tiết (Thẻ Căn cước công dân gắn chip mockup, avatar, chỉ số đối soát sinh trắc học khuôn mặt 98.6%, Liveness check). Khi ở chế độ Direct Execution, hỗ trợ nút **Phê duyệt** trực tiếp 1 chạm ngay trong modal.
   - *Hồ sơ tín dụng (`#/credit`)*: Quản lý hồ sơ hạn mức tín dụng (`credit-application.read`, `credit-application.review`). Hỗ trợ nút **Xem hồ sơ** mở Modal trực quan chi tiết (Thẻ tín dụng EMV mockup, Điểm tín dụng CIC 735 Hạng A). Hỗ trợ nút **Phê duyệt** trực tiếp 1 chạm khi bật Direct Execution.
   - *Giao dịch (`#/transfers`)*: Bộ lọc trạng thái (`ALL`, `PENDING`, `FAILED`, `SUCCEEDED`, `CANCELLED`), xem timeline, thao tác **Hoàn tiền / Thử lại / Hủy giao dịch**, kèm **Hàng đợi Cảnh báo giao dịch bất thường** (`GET /admin/anomalies`) cho phép nhân viên có quyền `transfer.action.request` kiểm tra và đánh dấu xử lý (`POST /admin/anomalies/{id}/resolve`).
3. **Phê duyệt (`#/approvals`)**:
   - Chỉ `ADMIN` có `audit.read` nên Operations không thấy mục Approval Inbox.
   - Hỗ trợ bộ điều khiển **Tự động làm mới (Auto-Refresh 15s)** với Checkbox bật/tắt và đèn nhấp nháy chỉ báo trạng thái thời gian thực.
   - Khi ở chế độ Maker-Checker (`ADMIN_DIRECT_EXECUTION=false`), Admin xử lý những loại yêu cầu mà mình có quyền duyệt, sau khi xác thực Step-up MFA. Admin có thể duyệt cả yêu cầu do chính tài khoản đó tạo; thao tác được ghi vào audit.
   - Khi từ chối, hệ thống bảo toàn quyết định qua bước MFA và gửi lệnh tới endpoint `/reject`.
4. **Vận hành (`#/operations`)**:
   - Theo dõi tiến trình xử lý outbox (`PENDING`, `PROCESSING`, `DEAD`, `SKIPPED`) và Background Jobs.
   - Hỗ trợ **Tự động làm mới (Auto-Refresh 15s)** hỗ trợ giám sát liên tục trạng thái hàng đợi và worker.
   - Tạo yêu cầu Requeue cho outbox event hoặc Retry cho background job bị lỗi với giao diện tinh giản đã loại bỏ trường ticket reference.
5. **Quản trị**:
   - *Chính sách & Biểu phí (`#/policy`)*: Dành riêng cho `ADMIN` (`audit.read`). Hiển thị bảng **Đối soát Sổ cái kép (Trial Balance Reconciliation)** (`GET /admin/operations/ledger-reconciliation`) kiểm tra số journal lệch Nợ ≠ Có, tổng số dư `payment_accounts`, tổng ròng `payment-account:*` trên sổ cái và độ lệch đối soát; đồng thời cho phép cấu hình động `globalKillSwitch`, `transfersEnabled`, `savingsEnabled`, `creditEnabled`, `maxTransferAmountMinor`, `dailyTransferLimitMinor`, `transferFeeMinor` kèm `reasonCode` và xác thực **TOTP Step-up** (`PATCH /admin/control-policy`, ghi audit `CONTROL_POLICY_UPDATED`).
   - *Nhân viên & Vai trò (`#/staff`)*: Admin tạo trực tiếp tài khoản Operations, đặt mật khẩu ban đầu và cấu hình TOTP mà không gửi email mời hay tạo approval. Đổi vai trò (`STAFF_ROLE_CHANGE`) và vô hiệu hóa (`STAFF_DISABLE`) vẫn tạo yêu cầu để Admin xử lý trong Approval Inbox.
   - *Nhật ký kiểm toán (`#/audit`)*: Xem lịch sử truy cập và thao tác append-only đã lọc bỏ thông tin nhạy cảm. Hỗ trợ **Xuất báo cáo kiểm toán** (`audit.export`) ra file định dạng **CSV** hoặc **JSON** tải trực tiếp về máy trạm kèm nhật ký tuân thủ, và bộ điều khiển **Tự động làm mới (Auto-Refresh 15s)**.

---

## 3. Khởi chạy và Kiểm thử Local

### Chạy Admin Web local

Vite chuyển tiếp request `/api/v1` tới Backend ở địa chỉ `ADMIN_API_UPSTREAM`.

```powershell
cd C:\Projects\banking-system\admin-web
npm install
$env:ADMIN_API_UPSTREAM = "http://127.0.0.1:5001"
npm run dev
```

### Các Lệnh Kiểm tra Chất lượng (Quality Gates)

```powershell
# 1. Kiểm tra kiểu dữ liệu TypeScript (0 errors)
npm run typecheck

# 2. Kiểm tra linting
npm run lint

# 3. Chạy Unit & Contract tests (17 tests pass)
npm test

# 4. Biên dịch gói production
npm run build

# 5. Quét lỗ hổng bảo mật dependency trong phạm vi production (0 vulnerabilities)
npm run audit
```

---

## 4. Demo và kiểm tra thủ công

Admin Web không kèm sẵn tài khoản đăng nhập hoặc browser fixture. Để demo, kết nối với backend local theo [runbook](../documents/admin/runbook.md) và chuẩn bị người dùng cùng dữ liệu cần thiết. Các bước kiểm tra thủ công nằm trong [manual-test checklist](../documents/admin/manual-test.md), mục 1–7.

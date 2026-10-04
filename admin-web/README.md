# Banking Admin Web

Ứng dụng quản trị (Control Plane) xây dựng bằng **React + TypeScript + Vite**, thiết kế tối ưu cho màn hình laptop/desktop phục vụ đồ án tốt nghiệp đại học về hệ thống ngân hàng mô phỏng (reference sandbox).

Hệ thống dùng hai vai trò `OPERATIONS` và `ADMIN`:
- Session token hoàn toàn nằm trong cookie `HttpOnly`, `SameSite=Strict`.
- CSRF token gửi qua header `X-CSRF-Token` cho các request thay đổi trạng thái; tuyệt đối không lưu token/credential vào `localStorage` hay `sessionStorage`.
- Không nhúng URL API hoặc secret vào JavaScript bundle (same-origin `/api/v1` thông qua runtime proxy của Vite/Nginx).
- Operations gửi yêu cầu nghiệp vụ; Admin xem và xử lý các yêu cầu mình có quyền trong Approval Inbox bằng Step-up MFA. Admin có thể duyệt yêu cầu do chính mình tạo; đây là lựa chọn đơn giản cho đồ án dùng một Admin, không phải mô hình Four-Eyes.
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
│   │   ├── common/                # UI components dùng chung (DataTable, Modal, Notice, StatusBadge, Heading)
│   │   └── layout/                # Khung ứng dụng (AppLayout, Topbar z-index 60, Sidebar 5 phân nhóm)
│   ├── features/                  # Các module nghiệp vụ cụ thể
│   │   ├── auth/                  # Operations: mật khẩu; Admin: mật khẩu + MFA TOTP; kích hoạt tài khoản
│   │   ├── overview/              # Bảng điều khiển Tổng quan, số liệu thực tế và nguyên tắc vận hành
│   │   ├── customers/             # Tra cứu khách hàng, số dư tài khoản, tạo yêu cầu khóa/funding
│   │   │   ├── Customers.tsx      # Giao diện chính màn hình Khách hàng & Tài khoản, scope guard cho async callbacks
│   │   │   ├── actionIntent.ts    # Quản lý vòng đời ý định ghi, SessionScope generation guard, stable idempotency key
│   │   │   └── accountLoader.ts   # AccountLoadManager với generation ID guard chống race condition
│   │   ├── approvals/             # Approval Inbox và xác thực step-up MFA
│   │   │   ├── Approvals.tsx      # Giao diện Approval Inbox và hộp thoại thẩm định
│   │   │   └── approvalsLogic.ts  # Mapping quyền duyệt theo actionType, resolve decision endpoint
│   │   ├── applications/          # Hồ sơ KYC và Hạn mức Tín dụng (claim, tạo recommendation)
│   │   ├── transfers/             # Giám sát giao dịch theo trạng thái, yêu cầu cancel/retry/reversal
│   │   ├── fraud/                 # Quản lý báo cáo gian lận, ghi chú gắn đúng case, yêu cầu giải quyết
│   │   ├── operations/            # Giám sát Transactional Outbox, Background Jobs, requeue/retry
│   │   ├── staff/                 # Danh sách nhân sự, tạo Operations trực tiếp, đổi vai trò và vô hiệu hóa
│   │   └── audit/                 # Nhật ký kiểm toán append-only bất biến, che chắn dữ liệu nhạy cảm
│   ├── App.tsx                    # Điểm lắp ghép ứng dụng chính và điều hướng
│   ├── main.tsx                   # Điểm khởi chạy React DOM
│   └── styles.css                 # Hệ thống kiểu dáng nhất quán, responsive 1366x768 và 768px
├── test/
│   ├── admin-web.contract.test.cjs # Contract tests kiểm tra cấu trúc source và nguyên tắc bảo mật
│   └── admin-web.ui-logic.test.cjs # UI logic tests cho actionIntent, accountLoader, approvalsLogic và api
└── e2e/
    ├── admin-web.spec.ts          # Bộ kiểm thử E2E Playwright cho luồng Admin Web
    └── fixture-server.mjs         # Máy chủ fixture Admin API in-memory phục vụ kiểm thử E2E độc lập
```

---

## 2. 5 Nhóm Điều hướng Quản trị và Phân quyền

Giao diện được phân nhóm theo chuẩn nghiệp vụ ngân hàng dựa trên danh sách quyền (`permissions`) được server trả về từ `/admin/me`:

1. **Tổng quan (`#/overview`)**: Thống kê số lượng hàng đợi phê duyệt (nếu có `audit.read`), trạng thái sự kiện nền outbox, thông tin nhân viên đang đăng nhập.
2. **Nghiệp vụ**:
   - *Khách hàng (`#/customers`)*: Tìm kiếm dữ liệu đã che (`customer.read.masked`), xem tài khoản (`account.read`). Hỗ trợ gửi yêu cầu cho các thao tác cần phê duyệt, có bước Xem lại (Review Step). Cung cấp nút *Tải lại danh sách* có generation guard bảo vệ chống response cũ ghi đè.
   - *Hồ sơ KYC (`#/kyc`)*: Quản lý hồ sơ định danh (`kyc.read`, `kyc.review`, `kyc.decision.request`).
   - *Hồ sơ tín dụng (`#/credit`)*: Quản lý hồ sơ hạn mức tín dụng (`credit-application.read`, `credit-application.review`).
   - *Giao dịch (`#/transfers`)*: Bộ lọc trạng thái (`ALL`, `PENDING`, `FAILED`, `SUCCEEDED`, `CANCELLED`), xem timeline, yêu cầu hủy/thử lại/hoàn tác.
   - *Fraud cases (`#/fraud`)*: Điều tra báo cáo nghi vấn gian lận, chọn từng case cụ thể để ghi chú và gửi yêu cầu giải quyết.
3. **Phê duyệt (`#/approvals`)**:
   - Chỉ `ADMIN` có `audit.read` nên Operations không thấy mục Approval Inbox.
   - Admin xử lý những loại yêu cầu mà mình có quyền duyệt, sau khi xác thực Step-up MFA. Admin có thể duyệt cả yêu cầu do chính tài khoản đó tạo; thao tác được ghi vào audit.
   - Khi từ chối, hệ thống bảo toàn quyết định qua bước MFA và gửi lệnh tới endpoint `/reject`.
4. **Vận hành (`#/operations`)**:
   - Theo dõi tiến trình xử lý outbox (`PENDING`, `PROCESSING`, `DEAD`, `SKIPPED`).
   - Tạo yêu cầu Requeue cho outbox event hoặc Retry cho background job bị lỗi.
5. **Quản trị**:
   - *Nhân viên & Vai trò (`#/staff`)*: Admin tạo trực tiếp tài khoản Operations, đặt mật khẩu ban đầu và cấu hình TOTP mà không gửi email mời hay tạo approval. Đổi vai trò (`STAFF_ROLE_CHANGE`) và vô hiệu hóa (`STAFF_DISABLE`) vẫn tạo yêu cầu để Admin xử lý trong Approval Inbox.
   - *Nhật ký kiểm toán (`#/audit`)*: Xem lịch sử truy cập và thao tác append-only đã lọc bỏ thông tin nhạy cảm (dành cho nhân viên có quyền `audit.read`).

---

## 3. Khởi chạy và Kiểm thử Local

### Phân biệt 2 Môi trường Kiểm thử

1. **Môi trường Phát triển với Backend thật (Dev Mode)**:
   - Dùng khi kết nối tới backend Node.js / Docker Compose đang chạy.
   - Vite proxy các request `/api/v1` tới cổng backend được chỉ định trong `$env:ADMIN_API_UPSTREAM`.
   ```powershell
   cd C:\Projects\banking-system\admin-web
   npm install
   $env:ADMIN_API_UPSTREAM = "http://127.0.0.1:5001"
   npm run dev
   ```

2. **Môi trường Kiểm thử Tự động Playwright (Fixture Server)**:
   - File `e2e/fixture-server.mjs` tự động khởi tạo backend Admin API in-memory (sử dụng `InMemoryAdminRepository` từ `backend/dist`) trên một cổng ngẫu nhiên, đồng thời khởi chạy Vite dev server trên cổng `5174`.
   - Hoàn toàn độc lập với database PostgreSQL hoặc Docker stack đang chạy, bảo đảm dữ liệu synthetic cô lập và tốc độ chạy cực nhanh.
   - Yêu cầu biên dịch backend trước khi chạy lần đầu:
   ```powershell
   cd C:\Projects\banking-system\backend
   npm run build
   cd C:\Projects\banking-system\admin-web
   npm run test:e2e
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

# 6. Chạy Playwright E2E trên trình duyệt Chromium
npm run test:e2e
```

---

## 4. Kịch bản Dùng thử Nhanh (Demo Scenarios)

### Tài khoản và Phân quyền Thử nghiệm
*(Lưu ý bảo mật: Mật khẩu và seed TOTP fixture được cấp qua biến môi trường hoặc script kiểm thử cục bộ, không lưu trữ nguyên văn trong tài liệu).*

| Vai trò | Tài khoản mẫu | Quyền hạn chính |
|---|---|---|
| **Operations** | `browser-operations@example.test` | Xử lý nghiệp vụ và gửi các yêu cầu cần quyền Admin duyệt; không có `audit.read` nên không vào Approval Inbox. |
| **Admin** | `browser-admin@example.test` | Quản trị nhân sự, tạo Operations trực tiếp, xem audit và duyệt các yêu cầu theo quyền được cấp. |

### Các Luồng Demo Chuẩn

1. **Luồng Cấp tiền (Simulation Funding) & Phê duyệt**:
   - **Bước 1 (Operations)**: Đăng nhập `browser-operations@example.test` → Vào menu **Khách hàng** → Tìm kiếm `browser-e2e@example.test` → Bấm **Xem tài khoản** → Bấm **Yêu cầu cấp tiền** → Nhập số tiền `2500`, lý do `DEMO_FUNDING`, ticket `DEMO-001` → Bấm **Xem lại yêu cầu** → Tạo yêu cầu và ghi lại mã Action.
   - **Bước 2 (Admin)**: Đăng nhập `browser-admin@example.test` → Vào **Approval Inbox** → Mở yêu cầu `SIMULATION_FUNDING` → Nhập lý do → Xác thực Step-up MFA bằng Authenticator → Phê duyệt để yêu cầu chuyển trạng thái `SUCCEEDED`.
   - **Bước 3 (Đối soát)**: Quay lại cửa sổ Maker, bấm *Tải lại danh sách* tài khoản khách hàng → Số dư tăng thêm 2.500 VND từ server, version tài khoản tăng lên tương ứng.

2. **Luồng Xử lý Sự cố Mạng / Timeout & Thử lại Ổn định (Idempotent Retry)**:
   - Tại form Cấp tiền hoặc Khóa tài khoản, nếu server xử lý chậm vượt quá deadline 15 giây hoặc mất kết nối:
   - Hệ thống chuyển form sang trạng thái **Kết quả chưa xác định (INDETERMINATE)**.
   - Form giữ nguyên toàn bộ dữ liệu đã nhập, giữ nguyên **Idempotency Key** ban đầu trong bộ nhớ phiên.
   - Người dùng bấm nút **Gửi lại (Giữ nguyên khóa xử lý)**: Request gửi lại sử dụng chính xác snapshot và idempotency key cũ, bảo đảm nếu server đã tiếp nhận yêu cầu trước đó thì không phát sinh giao dịch mới trùng lặp.
   - Nếu lần gửi lại nhận lỗi `IDEMPOTENCY_CONFLICT` (409), hệ thống duy trì trạng thái `INDETERMINATE` kèm cảnh báo đối soát, khóa sửa đổi payload và ngăn chặn tự động xoay key.

3. **Luồng Bảo vệ Đúng Đối tượng khi Chuyển Khách hàng (Generation Guard)**:
   - Tìm kiếm khách hàng A → Bấm xem tài khoản (yêu cầu nạp tài khoản A được kích hoạt với Generation ID 1).
   - Ngay lập tức bấm xem tài khoản của khách hàng B (Generation ID tăng lên 2).
   - Danh sách tài khoản của A lập tức bị xóa khỏi giao diện; response nạp chậm của A đến sau sẽ bị loại bỏ hoàn toàn, bảo đảm không bao giờ hiển thị nhầm tài khoản của A dưới tên của B.

4. **Luồng Cô lập Phiên làm việc (Session Scope Isolation)**:
   - Maker gửi một yêu cầu ghi; khi request đang chờ xử lý trên mạng, Maker bấm **Đăng xuất**.
   - Ngay khi bấm đăng xuất, `SessionScope` cũ bị vô hiệu hóa lập tức, dọn sạch intent store và hủy bỏ quyền cập nhật UI của mọi callback cũ.
   - Khi nhân viên khác (hoặc chính nhân viên đó) đăng nhập lại trên cùng trình duyệt, hệ thống cấp một `SessionScope` mới với generation mới độc lập hoàn toàn.
   - Dù request cũ từ phiên trước có hoàn thành (thành công hoặc thất bại), kết quả đó bị chặn đứng tại boundary `isSessionScopeActive(scope)`, tuyệt đối không rò rỉ thông báo, banner hay intent vào phiên mới.

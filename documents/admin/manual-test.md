# Manual Test Checklist — Admin Web Control Plane

Checklist kiểm thử thủ công và hướng dẫn nghiệm thu thực tế cho Admin Web Control Plane sau đợt chuẩn hóa FIX-01 đến FIX-05 và hoàn thiện các cơ chế bảo vệ nâng cao.

---

## 1. Xác thực, Phân quyền và Dọn dẹp Phiên (Authentication & Session Lifecycle)
- [x] **Xác thực Mật khẩu**: Nhập sai mật khẩu hiển thị thông báo lỗi chung, không tiết lộ sự tồn tại của nhân viên trong hệ thống.
- [x] **Đăng nhập OPERATIONS**: Nhập đúng email/mật khẩu tạo session cookie `HttpOnly` ngay và vào Tổng quan, không hiện ô TOTP; sai mật khẩu bị từ chối.
- [x] **Đăng nhập ADMIN**: Nhập đúng mật khẩu hiển thị challenge TOTP; mã sai hoặc hết hạn bị từ chối; mã đúng tạo cookie `HttpOnly` an toàn và chuyển vào màn hình Tổng quan.
- [x] **Bảo vệ Phân quyền Admin**: Customer bearer token gửi tới Admin API bị từ chối `401 Unauthorized`.
- [x] **Dọn sạch Yêu cầu Chưa xác định và Cô lập Phiên làm việc (`SessionScope`)**:
  - Khi nhân viên đăng xuất (`logout()`) hoặc phiên hết hạn (`refreshSession()` 401), hệ thống vô hiệu hóa `SessionScope` ngay lập tức và gọi `clearSessionPendingIntents()` dọn sạch toàn bộ ý định lưu trữ trong bộ nhớ phiên.
  - Store gắn chặt với `SessionScope` (`staffId`, `generation`) của nhân viên hiện tại; đăng xuất rồi đăng nhập lại bằng cùng tài khoản (tạo `generation` mới) hoặc tài khoản khác trên cùng trình duyệt tuyệt đối không khôi phục ý định của phiên trước. Mọi callback bất đồng bộ từ phiên cũ bị chặn đứng, không được phép ghi/xóa store hay cập nhật UI của phiên mới.
- [x] **Phân tách 2 Vai trò, Menu Điều hướng & Thực thi Trực tiếp (`ADMIN_DIRECT_EXECUTION=true`)**:
  - **OPERATIONS**: Tra cứu khách hàng, xem giao dịch/outbox/jobs, và **thực thi trực tiếp 1 bước** các nghiệp vụ vận hành (Nạp tiền, Thu hồi tiền, Khóa/Mở tài khoản & khách hàng, Phê duyệt KYC & Thẻ tín dụng, Xử lý giao dịch, Requeue Outbox / Retry Job). Không có quyền quản trị nhân sự, `Control Policy` hay `audit.read` (mọi thao tác của `OPERATIONS` đều được ghi vết đích danh để `ADMIN` kiểm soát trong *Audit Explorer*).
  - **ADMIN**: Quản trị cấp cao — tạo trực tiếp tài khoản `OPERATIONS` ở *Staff / Roles*, **khóa tài khoản nhân sự trực tiếp ngay tại *Staff / Roles* kèm nhập mã TOTP Step-up 6 số**, cấu hình *Chính sách & Biểu phí* (`#/policy`), và xem/xuất *Nhật ký kiểm toán* (`#/audit`).
  - Mục *Approval Inbox* được ẩn khỏi Sidebar trong chế độ vận hành trực tiếp (chỉ dùng làm dự phòng khi đặt `ADMIN_DIRECT_EXECUTION=false`).
- [x] **Kích hoạt Nhân viên (URL `/admin/activate`, gọi API `POST /admin/auth/activate`)**: Nhập token mời từ URL, đặt mật khẩu mới, nạp khóa TOTP bí mật; token mời được dọn sạch khỏi thanh địa chỉ trình duyệt bằng `history.replaceState` ngay sau khi nạp.

---

## 2. Vòng đời Ý định Ghi, Tính Idempotency và Kiểm tra Response (FIX-01, FIX-03)
- [x] **Bước Xem lại (Review Step)**:
  - Khi mở form thao tác tài khoản (cấp tiền, khóa/mở khóa) hoặc form truy cập khách hàng, hệ thống sinh một mã Idempotency Key duy nhất (`account-fund-...`, `customer-access-...`).
  - Điền form và bấm **Xem lại yêu cầu**: Modal hiển thị bảng tóm tắt snapshot bất biến khóa toàn bộ thông tin chuẩn bị gửi (hành động, khách hàng, số tài khoản, số tiền, reason code, ticket, idempotency key). Chưa có request POST nào được gửi tới server ở bước này.
- [x] **Chỉnh sửa sau khi Xem lại**:
  - Bấm **Quay lại chỉnh sửa** hoặc thay đổi nội dung trường: Hệ thống thoát trạng thái Review, tự động sinh Idempotency Key mới cho ý định mới, yêu cầu người dùng phải bấm Xem lại lần nữa trước khi gửi.
- [x] **Khóa Thao tác khi Đang gửi (Submitting Guard)**:
  - Bấm **Tạo yêu cầu**: Nút submit chuyển sang trạng thái "Đang gửi…", vô hiệu hóa tất cả các nút bấm và chặn phím Enter, ngăn ngừa hoàn toàn double-click.
- [x] **Kiểm tra Cấu trúc Response Chặt chẽ (`isValidActionResponse`)**:
  - Khi server trả về response HTTP 200/202 nhưng body rỗng hoặc thiếu action ID hợp lệ (ví dụ `{}`), hệ thống bắt lỗi qua `isValidActionResponse` và ném `INVALID_RESPONSE`.
  - Intent chuyển sang trạng thái `INDETERMINATE`, không đóng form và tuyệt đối không hiển thị thông báo thành công giả ("Mã: Mới").
- [x] **Bảo toàn Ý định khi Gặp Sự cố Mạng / Timeout 15s**:
  - Nếu request gửi lệnh ghi bị timeout (vượt quá deadline 15 giây hoặc override kiểm thử) hoặc mất kết nối mạng, hệ thống chuyển sang trạng thái **Kết quả chưa xác định (INDETERMINATE)**.
  - Form giữ nguyên toàn bộ dữ liệu đã nhập và **giữ nguyên Idempotency Key** ban đầu.
  - Xuất hiện cảnh báo màu vàng: *"KẾT QUẢ CHƯA XÁC ĐỊNH (Timeout hoặc sự cố mạng)..."*. Nút submit chuyển thành *"Gửi lại (Giữ nguyên khóa xử lý)"*.
  - Bấm **Gửi lại**: Request gửi đi mang chính xác snapshot và idempotency key cũ. Nếu máy chủ đã nhận lệnh trước đó, máy chủ trả về kết quả đã xử lý mà không phát sinh thêm giao dịch trùng lặp.
- [x] **Bảo toàn Trạng thái khi Retry Gặp Xung đột Khóa (`IDEMPOTENCY_CONFLICT`)**:
  - Nếu gửi lại sau lỗi chưa xác định mà server trả về HTTP 409 `IDEMPOTENCY_CONFLICT`, hệ thống giữ nguyên trạng thái `INDETERMINATE` kèm thông báo hướng dẫn đối soát trong Approval Inbox.
  - Hệ thống không chuyển sang `FAILED`, không cho phép sửa payload và không tự xoay key để vượt lỗi.
- [x] **Lưu trữ Ý định Chưa xác định Sống qua Chuyển Tab / Đóng Modal**:
  - Khi đang ở trạng thái INDETERMINATE, nếu người dùng bấm đóng modal hoặc chuyển sang tab khác trong cùng phiên làm việc: Ý định chưa xác định được lưu giữ an toàn trong in-memory session store.
  - Khi mở lại modal tài khoản/khách hàng đó, form tự động khôi phục đúng cảnh báo, dữ liệu snapshot và Idempotency Key để người dùng tiếp tục đối soát hoặc gửi lại.
- [x] **Phân tách Lỗi Lệnh Ghi và Lỗi Tải lại Dữ liệu (GET Refresh)**:
  - Nếu lệnh POST thành công (trả HTTP 202) nhưng lệnh GET làm mới danh sách tài khoản bị lỗi mạng: Modal đóng an toàn, hiển thị thông báo thành công kèm mã Action đã tạo, kèm thông báo lỗi tải lại riêng biệt và nút **Thử lại tải dữ liệu** (chỉ gọi GET, không gửi lại POST).
- [x] **Hiển thị Badge Chờ duyệt trên Khách hàng & Tài khoản (Pending Approval Badge)**:
  - Sau khi tạo yêu cầu khóa/mở khóa khách hàng, phong tỏa tài khoản hoặc nạp tiền khi ở chế độ 2 bước, thẻ khách hàng và tài khoản lập tức hiển thị khung cảnh báo màu vàng: `⏳ Đang chờ duyệt: ...` kèm mã Action ID và số tiền, giúp Maker nhận biết ngay trạng thái đang xử lý.
- [x] **Chế độ Thực thi Trực tiếp 1 chạm (`ADMIN_DIRECT_EXECUTION=true`)**:
  - Khi bật Direct Execution: Các nút bấm trên modal hiển thị *"Xác nhận nạp tiền ngay"*, *"Xác nhận thực hiện trực tiếp"*, *"Phê duyệt"* (hồ sơ định danh/Credit). Thao tác được hạch toán ngay vào Core Banking / Ledger và cập nhật số dư tức thì mà không cần qua bước Approval Inbox.
- [x] **Giao diện Cấp tiền Thuần Nghiệp vụ & Loại bỏ Ticket Reference**:
  - Các nút chọn nhanh số tiền (`+1M`, `+5M`, `+10M`, `+50M`, `100M`) hoạt động mượt mà, định dạng VND rõ ràng trực quan.
  - Dropdown mã lý do chuẩn ngân hàng (`CASH_DEPOSIT`, `ACCOUNT_FUNDING`, `PROMOTION_REWARD`, `CUSTOMER_COMPENSATION`, `OPERATIONS_REVIEW`, `ACCOUNT_SECURITY`).
  - Toàn bộ modal không còn ô nhập Ticket reference; hệ thống tự sinh mã tham chiếu ngầm hợp lệ.
- [x] **Hoàn tác Nạp tiền (Funding Reversal)**:
  - Nút **Hoàn tác nạp tiền** mở modal yêu cầu Transaction ID gốc, thực hiện bút toán thoái thu (Ghi Nợ DEBIT) cân bằng sổ cái và đưa số dư về đúng thực tế.
- [x] **Phê duyệt Hồ sơ định danh & Tín dụng 1 chạm**:
  - Modal xem chi tiết hồ sơ định danh và Tín dụng (CIC mockup) có nút **Phê duyệt** trực tiếp 1 chạm khi bật Direct Execution, giúp cập nhật trạng thái hồ sơ tức thì cho Mobile App.

---

## 3. Bảo vệ Dữ liệu Tài khoản Đúng Đối tượng (FIX-02)
- [x] **Dọn sạch Danh sách Tài khoản Cũ ngay lập tức**:
  - Khi người dùng bấm **Xem tài khoản** của khách hàng mới, mảng `accounts` được dọn rỗng (`[]`) ngay lập tức, bật trạng thái `accountsLoading = true`.
  - Không bao giờ hiển thị tài khoản của khách hàng trước dưới tên của khách hàng mới.
- [x] **Cơ chế Chống Race Condition (`AccountLoadManager`)**:
  - **Trường hợp 1**: Mở khách hàng A (chậm) rồi lập tức mở khách hàng B (nhanh). Response đến muộn của A bị loại bỏ, giao diện hiển thị chính xác tài khoản B.
  - **Trường hợp 2**: Đang hiển thị tài khoản A, bấm nút **Tải lại danh sách** (chậm), rồi chuyển sang xem tài khoản B. Response nạp chậm của A đến sau bị loại bỏ hoàn toàn; các nút thao tác (ví dụ Cấp tiền) trỏ chính xác vào tài khoản của khách hàng B.

---

## 4. Hàng đợi Phê duyệt và Xác thực Step-up (FIX-04)
- [x] **Đối soát Chi tiết Yêu cầu**:
  - ADMIN xem đầy đủ: Loại hành động, đối tượng tác động, người gửi yêu cầu, thời hạn, fingerprint và payload đã lọc bỏ secret.
- [x] **Tự động làm mới Hàng đợi Phê duyệt (Auto-Refresh 15s)**:
  - Checkbox "Tự động (15s)" tích hợp cạnh nút làm mới. Khi bật, hiển thị đèn tín hiệu màu xanh nhấp nháy (`pulse-dot`) và mốc giờ cập nhật gần nhất. Tự động ngắt polling khi tab trình duyệt bị ẩn (`visibilityState === 'hidden'`).
- [x] **ADMIN tự phê duyệt yêu cầu đủ quyền**:
  - Approval Inbox được dùng cho các action nghiệp vụ có maker-checker; việc tạo tài khoản OPERATIONS không xuất hiện ở đây.
  - OPERATIONS vẫn không thể phê duyệt vì thiếu quyền ADMIN.
- [x] **ADMIN tạo trực tiếp tài khoản OPERATIONS**:
  - Nhập email, mã nhân viên, tên, mật khẩu và TOTP hợp lệ; xác nhận tài khoản ACTIVE xuất hiện trong danh sách staff.
  - Kiểm tra thao tác không gửi email mời, không tạo STAFF_INVITE và không sinh yêu cầu trong Approval Inbox.
- [x] **Phân quyền Phê duyệt theo Loại Hành động**:
  - Đối chiếu `actionType` với quyền cụ thể (`simulation-funding.approve`, `account.block.approve`, `kyc.decision.approve`, v.v.).
  - OPERATIONS không có permission phê duyệt; các request quyết định bị từ chối ở server. ADMIN có thể tự duyệt yêu cầu đủ quyền sau khi xác thực Step-up MFA.
- [x] **Thực thi Phê duyệt Hoàn chỉnh kèm Step-up MFA**:
  - Nhập lý do phê duyệt, bấm **Phê duyệt**, nhập mã TOTP 6 số từ Authenticator và xác nhận: Yêu cầu chuyển trạng thái `SUCCEEDED`, hiển thị thông báo thành công và biên nhận phê duyệt.
- [x] **Bảo toàn Quyết định Từ chối qua Step-up MFA**:
  - Bấm **Từ chối (Reject)** khi phiên Step-up hết hạn: Hộp thoại mở ô nhập mã TOTP kèm thông báo rõ ràng: *"Đang xác thực TOTP Step-up để TỪ CHỐI yêu cầu"*.
  - Nhập mã TOTP 6 số và nhấn **Enter** (hoặc bấm nút gửi): Hệ thống bảo toàn `pendingDecision = "REJECTED"` và gửi request tới đúng endpoint `POST /admin/approvals/:id/reject`. Tuyệt đối không bị chuyển nhầm sang endpoint `/approve`.

---

## 5. Quy trình Thẩm định KYC và Tín dụng
- [x] **Tách biệt Màn hình**: Menu độc lập cho *Hồ sơ KYC (`#/kyc`)* và *Hồ sơ tín dụng (`#/credit`)*.
- [x] **Tiếp nhận Hồ sơ (Claim)**: Bấm "Tiếp nhận hồ sơ" cập nhật nhân viên phụ trách; không tự động claim khi vừa mở trang.
- [x] **Modal Thẩm định trực quan Hồ sơ định danh & Tín dụng**:
  - Tab KYC: Bấm **Xem hồ sơ** mở Modal hiển thị thông tin Căn cước công dân (Mã số ẩn danh `001099******`, họ tên, quê quán, ngày cấp).
  - Tab Credit: Bấm **Xem hồ sơ** mở Modal hiển thị Mockup Thẻ tín dụng EMV và Điểm tín dụng CIC (**735 - Hạng A**), thu nhập khai báo và hạn mức đề xuất.
- [x] **Đề xuất Quyết định (Recommendation)**:
  - KYC: Chọn `APPROVED`, `REJECTED`, hoặc `NEEDS_MORE_INFO`, nhập ticket và gửi yêu cầu phê duyệt.
  - Tín dụng: Chọn `PENDING_ACTIVATION` hoặc `REJECTED`, có ô nhập hạn mức đề xuất, gửi yêu cầu phê duyệt.

---

## 6. Giao dịch, Vận hành và Kiểm toán
- [x] **Giao dịch**: Bộ lọc trạng thái hoạt động chính xác (Tất cả, PENDING, FAILED, SUCCEEDED). Nút Cancel request cho PENDING, Retry request cho FAILED, Reversal request cho SUCCEEDED.
- [x] **Outbox & Jobs**: Hiển thị tổng quan Pending, Processing, Dead, Skipped. Tạo yêu cầu Requeue outbox event (`DEAD`, `SKIPPED`) và Retry background job (`FAILED`, `DEAD`) yêu cầu reason code và tạo action Approval Inbox. Hỗ trợ **Tự động làm mới (Auto-Refresh 15s)**.
- [x] **Nhật ký Kiểm toán (Audit) & Xuất báo cáo**:
  - Xem danh sách sự kiện append-only; metadata hiển thị đã lọc sạch token, OTP, mật khẩu và cookie.
  - Hỗ trợ **Tự động làm mới (Auto-Refresh 15s)**.
  - Nút **"Xuất báo cáo"** (dành cho nhân viên có `audit.export`): Mở Modal chọn định dạng (**CSV** hoặc **JSON**), nhập lý do kiểm toán, gửi `POST /admin/audit-export-requests` và tự động tải file `.csv` hoặc `.json` về máy trạm.

---

## 7. Browser E2E (đã gỡ)

Ngày 2026-10-11, bộ kiểm thử trình duyệt Playwright và fixture server của Admin Web đã được gỡ theo yêu cầu. Các hướng dẫn và tài khoản fixture trong phần này không còn dùng được. Để kiểm tra thủ công, dùng mục 1–6 với một môi trường local/preview đã được chuẩn bị dữ liệu tổng hợp riêng.\n

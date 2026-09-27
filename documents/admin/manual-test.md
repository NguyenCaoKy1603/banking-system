# Manual Test Checklist — Admin Web Control Plane

Checklist kiểm thử thủ công và hướng dẫn nghiệm thu thực tế cho Admin Web Control Plane sau đợt chuẩn hóa FIX-01 đến FIX-05 và hoàn thiện các cơ chế bảo vệ nâng cao.

---

## 1. Xác thực, Phân quyền và Dọn dẹp Phiên (Authentication & Session Lifecycle)
- [x] **Xác thực Mật khẩu**: Nhập sai mật khẩu hiển thị thông báo lỗi chung, không tiết lộ sự tồn tại của nhân viên trong hệ thống.
- [x] **MFA TOTP Challenge**: Nhập đúng mật khẩu hiển thị challenge MFA; mã TOTP sai hoặc hết hạn bị từ chối; nhập đúng tạo cookie `HttpOnly` an toàn và chuyển vào màn hình Tổng quan.
- [x] **Bảo vệ Phân quyền Admin**: Customer bearer token gửi tới Admin API bị từ chối `401 Unauthorized`.
- [x] **Dọn sạch Yêu cầu Chưa xác định và Cô lập Phiên làm việc (`SessionScope`)**:
  - Khi nhân viên đăng xuất (`logout()`) hoặc phiên hết hạn (`refreshSession()` 401), hệ thống vô hiệu hóa `SessionScope` ngay lập tức và gọi `clearSessionPendingIntents()` dọn sạch toàn bộ ý định lưu trữ trong bộ nhớ phiên.
  - Store gắn chặt với `SessionScope` (`staffId`, `generation`) của nhân viên hiện tại; đăng xuất rồi đăng nhập lại bằng cùng tài khoản (tạo `generation` mới) hoặc tài khoản khác trên cùng trình duyệt tuyệt đối không khôi phục ý định của phiên trước. Mọi callback bất đồng bộ từ phiên cũ bị chặn đứng, không được phép ghi/xóa store hay cập nhật UI của phiên mới.
- [x] **Phân tách 4 Vai trò & Menu Điều hướng**:
  - **SUPPORT**: Chỉ truy cập menu *Khách hàng* (khóa/mở khóa tài khoản, khóa truy cập khách hàng), *Giao dịch* (xem danh sách/timeline), *Fraud cases* (claim, ghi chú, xem chi tiết), *Vận hành* (xem outbox/jobs). Tuyệt đối không thấy menu *Phê duyệt (Approval Inbox)* hay *Nhật ký kiểm toán (Audit)*.
  - **OPERATIONS** (Maker tác nghiệp): Có quyền tạo yêu cầu funding, hoàn tác, mở/khóa tài khoản; tiếp nhận hồ sơ KYC/Credit và gửi đề xuất; điều tra fraud; gửi yêu cầu requeue outbox và retry background jobs. **Không có quyền `audit.read`**, do đó không thấy và không thể truy cập menu *Approval Inbox*.
  - **CONTROL** (Checker kiểm soát): Có quyền `audit.read` để mở *Approval Inbox*, thẩm định và phê duyệt/từ chối mọi action kèm step-up MFA, truy cập *Nhật ký kiểm toán*. Không thể tự tạo yêu cầu cấp tiền hoặc tự duyệt yêu cầu do mình tạo.
  - **ADMIN**: Quản trị nhân viên (*Nhân viên & Vai trò*), tạo yêu cầu mời nhân viên mới (`STAFF_INVITE`), thay đổi vai trò (`STAFF_ROLE_CHANGE`), vô hiệu hóa (`STAFF_DISABLE`); xem *Nhật ký kiểm toán*. Có quyền `audit.read` để xem danh sách Inbox nhưng **không có quyền phê duyệt tác nghiệp** (ví dụ thiếu `simulation-funding.approve`).
- [x] **Kích hoạt Nhân viên (`/admin/activate`)**: Nhập token mời từ URL, đặt mật khẩu mới, nạp khóa TOTP bí mật; token mời được dọn sạch khỏi thanh địa chỉ trình duyệt bằng `history.replaceState` ngay sau khi nạp.

---

## 2. Vòng đời Ý định Ghi, Tính Idempotency và Kiểm tra Response (FIX-01, FIX-03)
- [x] **Bước Xem lại (Review Step)**:
  - Khi mở form thao tác tài khoản (cấp tiền, khóa/mở khóa) hoặc form truy cập khách hàng, hệ thống sinh một mã Idempotency Key duy nhất (`account-fund-...`, `customer-access-...`).
  - Điền form và bấm **Xem lại yêu cầu**: Modal hiển thị bảng tóm tắt snapshot bất biến khóa toàn bộ thông tin chuẩn bị gửi (hành động, khách hàng, số tài khoản, số tiền, reason code, ticket, idempotency key). Chưa có request POST nào được gửi tới server ở bước này.
- [x] **Chỉnh sửa sau khi Xem lại**:
  - Bấm **Quay lại chỉnh sửa** hoặc thay đổi nội dung trường: Hệ thống thoát trạng thái Review, tự động sinh Idempotency Key mới cho ý định mới, yêu cầu người dùng phải bấm Xem lại lần nữa trước khi gửi.
- [x] **Khóa Thao tác khi Đang gửi (Submitting Guard)**:
  - Bấm **Tạo yêu cầu four-eyes**: Nút submit chuyển sang trạng thái "Đang gửi…", vô hiệu hóa tất cả các nút bấm và chặn phím Enter, ngăn ngừa hoàn toàn double-click.
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

---

## 3. Bảo vệ Dữ liệu Tài khoản Đúng Đối tượng (FIX-02)
- [x] **Dọn sạch Danh sách Tài khoản Cũ ngay lập tức**:
  - Khi người dùng bấm **Xem tài khoản** của khách hàng mới, mảng `accounts` được dọn rỗng (`[]`) ngay lập tức, bật trạng thái `accountsLoading = true`.
  - Không bao giờ hiển thị tài khoản của khách hàng trước dưới tên của khách hàng mới.
- [x] **Cơ chế Chống Race Condition (`AccountLoadManager`)**:
  - **Trường hợp 1**: Mở khách hàng A (chậm) rồi lập tức mở khách hàng B (nhanh). Response đến muộn của A bị loại bỏ, giao diện hiển thị chính xác tài khoản B.
  - **Trường hợp 2**: Đang hiển thị tài khoản A, bấm nút **Tải lại danh sách** (chậm), rồi chuyển sang xem tài khoản B. Response nạp chậm của A đến sau bị loại bỏ hoàn toàn; các nút thao tác (ví dụ Cấp tiền) trỏ chính xác vào tài khoản của khách hàng B.

---

## 4. Hàng đợi Phê duyệt Four-Eyes và Xác thực Step-up (FIX-04)
- [x] **Đối soát Chi tiết Yêu cầu**:
  - Checker xem đầy đủ: Loại hành động, đối tượng tác động, nhân viên đề xuất (Maker), thời hạn, fingerprint và payload đã lọc bỏ secret.
- [x] **Chống Tự duyệt (`SELF_APPROVAL_FORBIDDEN`)**:
  - Nếu nhân viên đang đăng nhập chính là người tạo yêu cầu (`maker_id === checker_id`), các nút Phê duyệt và Từ chối bị vô hiệu hóa kèm cảnh báo: *"Không thể tự duyệt yêu cầu do chính mình tạo (Maker)"*.
- [x] **Phân quyền Phê duyệt theo Loại Hành động**:
  - Đối chiếu `actionType` với quyền cụ thể (`simulation-funding.approve`, `account.block.approve`, `kyc.decision.approve`, v.v.).
  - Nếu Checker có quyền xem Inbox (`audit.read`) nhưng không có quyền duyệt loại hành động cụ thể đó (ví dụ vai trò ADMIN), các nút quyết định bị vô hiệu hóa an toàn kèm thông báo rõ ràng.
- [x] **Thực thi Phê duyệt Hoàn chỉnh kèm Step-up MFA**:
  - Nhập lý do checker, bấm **Phê duyệt**, nhập mã TOTP 6 số từ Authenticator và xác nhận: Yêu cầu chuyển trạng thái `SUCCEEDED`, hiển thị thông báo thành công và biên nhận phê duyệt.
- [x] **Bảo toàn Quyết định Từ chối qua Step-up MFA**:
  - Bấm **Từ chối (Reject)** khi phiên Step-up hết hạn: Hộp thoại mở ô nhập mã TOTP kèm thông báo rõ ràng: *"Đang xác thực TOTP Step-up để TỪ CHỐI yêu cầu"*.
  - Nhập mã TOTP 6 số và nhấn **Enter** (hoặc bấm nút gửi): Hệ thống bảo toàn `pendingDecision = "REJECTED"` và gửi request tới đúng endpoint `POST /admin/approvals/:id/reject`. Tuyệt đối không bị chuyển nhầm sang endpoint `/approve`.

---

## 5. Quy trình Thẩm định KYC và Tín dụng
- [x] **Tách biệt Màn hình**: Menu độc lập cho *Hồ sơ KYC (`#/kyc`)* và *Hồ sơ tín dụng (`#/credit`)*.
- [x] **Tiếp nhận Hồ sơ (Claim)**: Bấm "Tiếp nhận hồ sơ" cập nhật nhân viên phụ trách; không tự động claim khi vừa mở trang.
- [x] **Đề xuất Quyết định (Recommendation)**:
  - KYC: Chọn `APPROVED`, `REJECTED`, hoặc `NEEDS_MORE_INFO`, nhập ticket và gửi Four-Eyes action.
  - Tín dụng: Chọn `PENDING_ACTIVATION` hoặc `REJECTED`, có ô nhập hạn mức đề xuất, gửi Four-Eyes action.

---

## 6. Giao dịch, Fraud, Vận hành và Kiểm toán
- [x] **Giao dịch**: Bộ lọc trạng thái hoạt động chính xác (Tất cả, PENDING, FAILED, SUCCEEDED). Nút Cancel request cho PENDING, Retry request cho FAILED, Reversal request cho SUCCEEDED.
- [x] **Fraud cases**: Chọn từng case cụ thể để xem chi tiết; ô ghi chú nội bộ luôn gắn chặt với ID của case đang chọn. Gửi yêu cầu giải quyết (`RESOLVE`) tạo Four-Eyes action.
- [x] **Outbox & Jobs**: Hiển thị tổng quan Pending, Processing, Dead, Skipped. Tạo yêu cầu Requeue outbox event (`DEAD`, `SKIPPED`) và Retry background job (`FAILED`, `DEAD`) yêu cầu reason code và tạo action Four-Eyes.
- [x] **Nhật ký Kiểm toán (Audit)**: Xem danh sách sự kiện append-only; metadata hiển thị đã lọc sạch token, OTP, mật khẩu và cookie.

---

## 7. Hướng dẫn Owner Kiểm chứng 3 Kịch bản Trọng tâm trên Fixture Local

Khởi chạy môi trường kiểm thử độc lập:
```powershell
# Bước 1: Biên dịch backend (nếu chưa biên dịch)
cd C:\Projects\banking-system\backend
npm run build

# Bước 2: Chạy bộ kiểm thử tự động Playwright (đã bao gồm toàn bộ 11 kịch bản R-01 -> R-11 cùng P0 suite)
cd C:\Projects\banking-system\admin-web
npm run test:e2e
```

### Kịch bản 1: Kiểm chứng Timeout / Mất kết nối, Giữ nguyên Khóa và Xử lý Response Hỏng (R-02, R-03, R-06)
1. Đăng nhập bằng tài khoản Operations: `browser-operations@example.test`.
2. Vào **Khách hàng** → Tìm `browser-e2e@example.test` → Bấm **Xem tài khoản** → Bấm **Yêu cầu cấp tiền**.
3. Nhập số tiền `2500`, lý do `DEMO_FUNDING`, ticket `DEMO-001` → Bấm **Xem lại yêu cầu**.
4. Quan sát bảng tóm tắt: Ghi nhận mã Idempotency Key hiển thị (dạng `account-fund-...`).
5. Khi request gặp lỗi chưa xác định hoặc timeout:
   - Form chuyển sang trạng thái cảnh báo màu vàng `KẾT QUẢ CHƯA XÁC ĐỊNH`.
   - Idempotency Key được giữ nguyên.
6. Thử đóng modal hoặc chuyển sang tab khác (ví dụ `#/overview`), sau đó quay lại `#/customers` và mở lại form:
   - Cảnh báo chưa xác định và Idempotency Key cũ vẫn được khôi phục nguyên vẹn từ bộ nhớ phiên.
7. Bấm **Gửi lại (Giữ nguyên khóa xử lý)**: Request gửi lại đúng snapshot và khóa cũ; server trả về action đã tạo mà không phát sinh thêm action thứ hai.

### Kịch bản 2: Kiểm chứng Chống Race Condition khi Đổi Khách hàng và Tải lại (R-07)
1. Tìm kiếm và bấm xem tài khoản của khách hàng A (`browser-e2e@example.test`).
2. Bấm **Tải lại danh sách**, và trong lúc đang tải lại, lập tức bấm **Xem tài khoản** của khách hàng B (`Second Synthetic Customer`).
3. Quan sát giao diện:
   - Toàn bộ danh sách tài khoản của A bị xóa ngay lập tức.
   - Khi response của B về, chỉ hiển thị tài khoản của B (`Second Current Account`, `****9002`).
   - Dù response tải lại của A đến sau, `AccountLoadManager` tự động bỏ qua.
   - Bấm **Yêu cầu cấp tiền**: Hộp thoại mở ra xác nhận đúng tài khoản của B (`****9002`).

### Kịch bản 3: Kiểm chứng Từ chối bằng Phím Enter sau Step-up MFA (R-08)
1. Đăng nhập bằng tài khoản Control: `browser-control@example.test`.
2. Mở **Approval Inbox** → Chọn một yêu cầu đang chờ phê duyệt.
3. Điền lý do kiểm soát: `REJECT_FOR_VERIFICATION`.
4. Bấm **Từ chối (Reject)**: Hộp thoại yêu cầu xác thực step-up MFA mở ra với banner cảnh báo: *"Đang xác thực TOTP Step-up để TỪ CHỐI yêu cầu"*.
5. Nhập mã OTP 6 số vào ô nhập liệu và nhấn phím **Enter** trên bàn phím.
6. Quan sát kết quả:
   - Hệ thống gửi request tới endpoint `POST /admin/approvals/:id/reject` (không gửi tới `/approve`).
   - Yêu cầu được cập nhật trạng thái `REJECTED`.
   - Ô nhập MFA được dọn sạch và đóng lại an toàn.

### Kịch bản 4: Kiểm chứng Cô lập Phiên làm việc khi Đăng xuất / Đăng nhập lại (R-11)
1. Đăng nhập bằng tài khoản Operations: `browser-operations@example.test`.
2. Vào **Khách hàng** → Mở modal Cấp tiền, nhập thông tin và bấm gửi yêu cầu.
3. Khi request đang chờ phản hồi từ mạng (in-flight), bấm **Đăng xuất** trên thanh Topbar:
   - Hệ thống ngay lập tức chuyển về màn hình "Đăng nhập quản trị".
   - `SessionScope` hiện tại bị hủy bỏ, dọn sạch bộ nhớ ý định trong trang.
4. Đăng nhập bằng tài khoản khác (ví dụ `browser-support@example.test`) trên cùng trình duyệt:
   - Không xuất hiện banner thông báo ý định hay kết quả thành công/thất bại của phiên trước.
   - Mở tài khoản khách hàng trên: Form hoàn toàn sạch sẽ, không khôi phục dữ liệu hay khóa của phiên cũ.
   - Phân quyền RBAC hoạt động chính xác: Support không có nút Cấp tiền, mở form Khóa tài khoản hiển thị form trắng mới.
5. Khi phản hồi của request cũ từ phiên trước được máy chủ trả về:
   - Hệ thống chặn đứng callback tại boundary kiểm tra `isSessionScopeActive(capturedScope)`.
   - Tuyệt đối không rò rỉ thông báo, toast hay lỗi vào phiên làm việc mới.

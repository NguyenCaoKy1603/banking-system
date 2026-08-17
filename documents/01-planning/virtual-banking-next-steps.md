# Kế hoạch bước tiếp theo — ngân hàng mô phỏng bằng tiền ảo

Ngày lập: 2026-08-17
Phạm vi: chương trình ngân hàng mô phỏng như thật để demo và kiểm thử; không xử lý tiền thật.

## 1. Mục tiêu đã chốt

Chương trình phải mô phỏng được các hành vi người dùng kỳ vọng ở một ứng dụng ngân hàng:

- đăng ký, đăng nhập, MFA/OTP, quản lý phiên và thiết bị;
- tài khoản thanh toán, số dư khả dụng/số dư hiện tại, lịch sử giao dịch;
- chuyển tiền, người thụ hưởng, báo giá, xác nhận, step-up, idempotency và trạng thái pending;
- ledger hai bên, audit, outbox và reconciliation;
- thông báo, deep-link, QR và xử lý lỗi mạng;
- dữ liệu còn nguyên sau khi backend hoặc ứng dụng khởi động lại.

Tiền trong toàn bộ hệ thống là số dư ảo trong PostgreSQL local/test. Không kết nối ngân hàng, cổng thanh toán, tài khoản thật hay payment rail.

## 2. Trạng thái hiện tại

| Nhóm | Trạng thái | Bằng chứng chính |
| --- | --- | --- |
| M0 nền tảng và bàn giao | Đạt local | Git checkpoint sạch, workflow, lockfile, runbook |
| M1 auth/MFA | Đạt reference | Đăng ký hai bước, login, refresh rotation, device binding |
| M2 eKYC | Đạt mô phỏng | Form và vòng đời DRAFT/PENDING/APPROVED/REJECTED |
| M3 account/history | Đạt reference | Home, account detail, số tài khoản đầy đủ qua endpoint riêng, lịch sử |
| M4 transfer/beneficiary/QR | Đạt emulator | Quote snapshot, step-up, idempotency, pending/resume, QR manual fallback |
| M8 notification | Đạt emulator | List/read/detail và deep-link |
| PostgreSQL core | Đạt persistent reference | Core M0–M4/M8 chiếu vào bảng relational; restart giữ dữ liệu |
| Mobile quality | Đạt local/clone sạch | Typecheck, lint, test, OpenAPI, Maestro syntax, web export |
| Thiết bị thật/staging | Chưa đạt | Chưa có thiết bị vật lý, partner staging hoặc signing phát hành |

Auth runtime và module Savings/Credit hiện được lưu bền vững theo từng record reference trong `reference_runtime_records`; đây chưa phải repository relational production toàn domain.

## 3. Thứ tự triển khai tiếp theo

### S1 — Đóng gói tái hiện được

Mục tiêu: người khác có thể dựng chương trình từ clone sạch.

- Giữ `backend/`, `mobile-app/`, workflow, contract và lockfile trong Git.
- Chạy migration từ database PostgreSQL rỗng.
- Chạy quality gate Backend và Mobile từ `npm ci`, không dùng thư mục dependency có sẵn.
- Giữ `.env`, secret, `node_modules`, `dist`, APK và log có dữ liệu nhạy cảm ngoài Git.
- Chốt một commit SHA và một runbook duy nhất cho demo.

Điều kiện đóng: clone sạch chạy được typecheck/build/validator; migration thành công; không có secret hoặc artifact runtime bị theo dõi.

### S2 — Hardening giao dịch và lỗi mạng

Mục tiêu: hành vi chuyển tiền phải an toàn ngay cả khi người dùng bấm lại, mất mạng hoặc backend khởi động lại.

- Bổ sung regression cho quote hết hạn, OTP hết hạn, retry timeout/offline và retry sau 401.
- Giữ quote snapshot bất biến, quote chỉ submit một lần và idempotency key không thể tạo debit thứ hai.
- Kiểm thử đồng thời nhiều request trên cùng quote và cùng idempotency key.
- Kiểm thử pending → restart → resume, FAILED giải phóng hold, REVERSED hoàn tiền đúng.
- Kiểm tra reconciliation luôn thỏa `difference = core - computed` và health fail khi DB/outbox lỗi.
- Thêm cleanup có kiểm soát cho quote, OTP, session và outbox đã hết hạn.

Điều kiện đóng: không double-debit; không mất hoặc tạo thêm tiền ảo sau retry; health và lỗi HTTP phản ánh đúng nguyên nhân.

### S3 — Hoàn thiện persistence reference theo quyết định bàn giao

Mục tiêu: xác định rõ mức persistent cần cho đồ án và không gọi nhầm record-level reference là production repository.

- Giữ các bảng relational canonical cho customer, account, beneficiary, quote, transfer, transaction, ledger, notification, audit và outbox.
- Nếu cần demo restart đầy đủ cho Savings/Credit/auth, mở rộng từng nhóm thành bảng relational có migration, khóa ngoại và test; không dùng PAN/CVV/PIN thật.
- Thêm rehearsal backup/restore bằng database giả lập.
- Kiểm thử database rỗng, restart backend và rollback ở boundary quote → transfer → ledger → outbox.
- Ghi rõ owner review và quyết định kiến trúc trước khi mở rộng schema.

Điều kiện đóng: dữ liệu của module được tuyên bố persistent có thể khôi phục từ database; migration chạy lặp lại an toàn; test chứng minh transaction boundary.

### S4 — Hoàn thiện trải nghiệm Mobile

Mục tiêu: giao diện giống một ứng dụng ngân hàng thật nhưng không làm người dùng hiểu nhầm dữ liệu mô phỏng là nghiệp vụ thật.

- Home NOVA: thẻ tổng số dư, che/mở số dư, ba chức năng nhanh, bốn tab dưới.
- Account Detail hiển thị tên tài khoản, trạng thái, khả dụng, hiện tại, số tài khoản đã che, nút hiện/sao chép đầy đủ, chủ tài khoản, ngân hàng, tiền tệ, chuyển tiền và nhận tiền/QR.
- Không hiển thị UUID, token, device ID, PIN, OTP, password, journal ID hoặc chi tiết backend.
- Giữ loading, empty, lỗi kết nối, timeout, offline, unauthorized và retry.
- “Tiền gửi” chỉ hiển thị “Sắp ra mắt” cho đến khi module được bật; Credit phải gắn nhãn sandbox/reference.
- Không thêm banner, quảng cáo, ưu đãi hoặc dịch vụ ngoài phạm vi.

Điều kiện đóng: dữ liệu tài khoản lấy từ API; bấm hiện và sao chép dùng cùng số đầy đủ từ endpoint bảo vệ; mọi trạng thái lỗi có cách khôi phục rõ ràng.

### S5 — Bằng chứng thiết bị và phát hành demo

Mục tiêu: chứng minh chương trình chạy được ngoài môi trường phát triển mà vẫn giữ dữ liệu giả lập an toàn.

- Chạy lại APK release trên Android emulator cho M0–M4/M8, pending/resume, offline retry và module bonus đã bật.
- Khi có thiết bị Android thật, chạy camera QR, permission, background/resume và kích thước màn hình khác nhau.
- Chỉ kiểm thử biometric native khi có thiết bị/API phù hợp; không giả vờ coi emulator là thiết bị thật.
- Lưu test report, health JSON, checksum APK, commit SHA và ảnh/video đã che dữ liệu nhạy cảm.
- Chưa mở iOS, staging hoặc push notification thật nếu chưa có owner và môi trường được duyệt.

Điều kiện đóng: report phân biệt rõ emulator, thiết bị thật và staging; mọi flow chưa chạy được được ghi là open risk.

## 4. Ưu tiên thực hiện ngay

1. S2: bổ sung test quote/OTP expiry, retry/offline và concurrency.
2. S3: chốt bằng văn bản module nào cần bảng relational; chỉ mở rộng schema sau khi có quyết định.
3. S4: kiểm tra thủ công Home và Account Detail trên APK mới, nhất là Hiện/Sao chép số tài khoản đầy đủ.
4. S5: đóng gói lại bằng chứng emulator; sau đó chờ thiết bị Android thật để đóng camera QR và lifecycle native.

## 5. Ngoài phạm vi của kế hoạch

- tiền thật, nạp/rút thật, thanh toán liên ngân hàng và payment rail;
- core banking hoặc card processor thật;
- PAN/CVV/PIN thật, CIC/eKYC thật và dữ liệu khách hàng thật;
- tuyên bố production/pilot readiness, compliance hoặc phát hành có ký số;
- Chatbot AI, quảng cáo, khuyến mãi và các dịch vụ ngoài ngân hàng cốt lõi.

Các phần trên chỉ được mở khi có yêu cầu mới, owner, contract, môi trường staging và phê duyệt bảo mật/pháp lý tương ứng.

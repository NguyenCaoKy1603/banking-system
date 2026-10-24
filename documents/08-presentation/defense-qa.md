# Q&A bảo vệ — câu hỏi dự kiến và câu trả lời ngắn

## Transaction và dữ liệu

**Vì sao dùng transaction?**

`UnitOfWork` gom mutation liên quan vào một boundary để commit/rollback cùng nhau;
transfer phải giữ balance, account transaction, ledger, audit/outbox nhất quán trong
reference scope.

**Ledger debit/credit cân bằng thế nào?**

Mỗi journal có các entry DEBIT/CREDIT cùng minor VND. Trong evidence Đợt 2, tổng
debit và credit trong phạm vi đối soát đều `15,502,000`; đây là tổng luân chuyển ledger,
không phải số dư cuối.

**Vì sao số dư A/B là vậy?**

A bắt đầu `10,000,000`, trừ `500,000 + 1,000` và `5,000,000 + 1,000`, còn
`4,498,000`. B nhận tổng amount `5,500,000`; fee do A chịu.

**Vì sao phải dùng sổ cái kép (Double-Entry Ledger) thay vì chỉ UPDATE cột balance?**

Số dư balance chỉ là giá trị tổng hợp hiển thị; trong nghiệp vụ ngân hàng, mọi dòng tiền luân chuyển bắt buộc phải có bút toán đối ứng minh bạch. Bút toán ghi Nợ (`DEBIT`) tài khoản chuyển, Có (`CREDIT`) tài khoản nhận và Có (`CREDIT`) tài khoản phí ngân hàng `fee-income:VND`. Đặc biệt, Constraint Trigger trong PostgreSQL (`assert_ledger_journal_balanced`) ở chế độ `DEFERRABLE INITIALLY DEFERRED` tự động kiểm tra $\sum \text{DEBIT} = \sum \text{CREDIT}$; nếu phát hiện sai lệch, CSDL sẽ từ chối commit ngay lập tức.

**Hai khách hàng cùng chuyển tiền đối ứng cho nhau cùng lúc có bị Deadlock không?**

Không. Hàm `lockManyByIds` luôn sắp xếp các ID tài khoản theo thứ tự UUID tăng dần trước khi thực thi `SELECT ... FOR UPDATE`. Cả hai luồng giao dịch đối ứng đều sẽ tranh chấp khóa theo cùng một thứ tự nhất quán (ví dụ: luôn khóa tài khoản có UUID nhỏ hơn trước), triệt tiêu hoàn toàn nguy cơ Deadlock cycle.

## Idempotency và authorization

**Replay cùng idempotency key làm gì?**

Theo evidence service/PostgreSQL disposable, cùng key và fingerprint trả lại kết quả
canonical, không tạo transfer/debit/journal thứ hai; key cùng nhưng payload khác bị
từ chối theo contract.

**Cross-account được bảo vệ ở đâu?**

Public API kiểm tra customer ownership trước khi đọc account/transactions; evidence
HTTP nhận `404 NOT_FOUND` và invariant protected data không đổi. Không nhầm với việc
customer A chuyển tiền hợp lệ tới B.

**Maker có tự duyệt được không?**

Không. Action engine ghi nhận `SELF_APPROVAL_FORBIDDEN`; checker CONTROL độc lập mới
được thực thi. Evidence self-reject ở policy/service scope, không tuyên bố negative UI
E2E riêng.

## MFA và trạng thái

**MFA/step-up khác password login thế nào?**

Login tạo session theo policy; transfer nhạy cảm còn yêu cầu step-up TOTP gắn với quote
và fingerprint. Secret fixture không đưa vào artifact bàn giao.

**Nếu mạng hoặc app dừng giữa transfer?**

Trên Mobile, ứng dụng lưu trạng thái `SUBMIT_UNKNOWN` vào `SecureStore` trước khi phát request mạng. Nếu app sập nguồn giữa chừng, khi mở lại, hàm `restoreTransferIntent` phát hiện trạng thái này và kích hoạt cờ `recoveryBlocked = true` khóa màn hình giao diện (ngăn ngừa tuyệt đối nguy cơ bấm chuyển tiền lần hai gây double-spend), đồng thời tự động gửi API đối soát `GET /transfers/{id}` với server để cập nhật đúng kết quả của lệnh cũ.

**Làm sao chống tráo đổi nội dung giao dịch sau khi xin mã xác thực (Anti-Tampering & Anti-TOCTOU)?**

Nội dung báo giá (số tiền, người nhận) được băm thành chuỗi hash `requestFingerprint`. Khi xác thực TOTP, server bắt buộc đối chiếu fingerprint này với CSDL; nếu kẻ xấu cố tình can thiệp số tiền trong payload submit, server sẽ từ chối ngay. Đồng thời, chính sách kiểm soát rủi ro `control_policy` được kiểm tra 2 lần: một lần lúc lấy Quote và một lần nữa ngay trong transaction khi Submit để ngăn ngừa lỗ hổng TOCTOU.

## Synthetic và triển khai

**KYC có phải KYC thật không?**

Không. Đây là KYC synthetic, lưu metadata/payload phù hợp đồ án; không thay thế
provider identity, AML, retention hoặc legal/compliance.

**Đã có CI/deployment chưa?**

Workflow và Compose configuration tồn tại. Local Compose/evidence đã được ghi; remote
CI pass, public cloud, managed DB, HTTPS và signed APK chưa được chứng minh.

**Tại sao không nói cả 22 use case đã hoàn thành?**

22 mục là catalog tổng hợp từ repository. Đợt 2 chỉ nghiệm thu phạm vi core demo;
UC-M04+ không tự đóng nếu chưa có acceptance/evidence riêng.

**Nếu demo live hỏng thì xử lý thế nào?**

Dừng thao tác, không reset database, chuyển sang evidence đã redact và nói rõ tầng
kiểm chứng. Không biến một ảnh/video hoặc workflow thành runtime PASS.

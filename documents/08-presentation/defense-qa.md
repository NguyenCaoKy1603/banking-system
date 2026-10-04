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

Client giữ trạng thái pending/resume theo contract và gửi lại cùng idempotency key;
server/core boundary mới là nguồn sự thật. Chi tiết lifecycle native đầy đủ vẫn cần
evidence thiết bị tương ứng nếu rubric yêu cầu.

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

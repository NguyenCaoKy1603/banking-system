# M6 - Trạng thái triển khai tiền gửi sandbox

Ngày kiểm tra: 2026-08-15

## Đã triển khai

- Backend có catalog 1/3/6/12 tháng, quote snapshot, ACT/365, làm tròn xuống theo VND và giới hạn 1.000.000-500.000.000 VND.
- Luồng mở khoản có ownership, allowlist/kill switch, MFA OTP/biometric, idempotency một lần, kiểm tra số dư, debit tài khoản thanh toán, double-entry ledger, audit và outbox.
- Có trạng thái PENDING/SUCCEEDED/FAILED/REVERSED; resume opening sau timeout/restart dùng cùng idempotency key.
- Có danh sách/chi tiết tiền gửi, tổng gốc do backend trả về, maturity trả gốc+lãi hoặc tái tục gốc/cả gốc+lãi.
- Có migration draft `002_savings_sandbox.sql`, migration runner chạy tuần tự 001 rồi 002 và validator kiểm tra schema/constraint.
- Mobile có Home → Tiền gửi → danh sách → mở khoản → quote/review → MFA → kết quả → chi tiết; intent lưu quote và idempotency key, không lưu OTP.
- Notification type SAVINGS deep-link tới chi tiết khoản gửi; ô Tiền gửi trên Home đã hoạt động và có nhãn sandbox.
- OpenAPI DRAFT hiện có 36 path; Maestro có 8 flow syntax-valid gồm flow M6 và M7.

## Đã kiểm tra local

- Backend typecheck/build: đạt.
- Backend compiled test suite không có DB: 49 pass, 4 test PostgreSQL skip; trên PostgreSQL container tạm: 53 pass, 0 skip, gồm concurrency và restart savings/credit.
- Database source validator: đạt 20 table definitions/invariants; khi không cấu hình `DATABASE_URL`, live check được bỏ qua.
- PostgreSQL 16 container tạm: migration 001/002, live schema validator và toàn bộ persistence/concurrency/restart test đều đạt; container đã được dọn sau kiểm thử.
- Mobile lint/typecheck: đạt.
- Mobile Jest: 36 suite, 166 test pass.
- OpenAPI và Maestro syntax validator: đạt.
- Web export: đạt với placeholder HTTPS; export mặc định HTTP bị chặn đúng production guard.

## Giới hạn còn lại

- Backend runtime vẫn là in-memory hoặc snapshot sandbox; repository adapter PostgreSQL thật chưa nối nghiệp vụ savings.
- Chưa có PostgreSQL staging lâu dài, tải/concurrency quy mô lớn hoặc Maestro CLI trên thiết bị thật.
- Chưa có bằng chứng device E2E M6; flow YAML mới được kiểm tra cú pháp.
- Chưa triển khai rút trước hạn, recurring, nộp thêm, tất toán một phần, FX hoặc core banking thật.
- OpenAPI vẫn là DRAFT và không được dùng cho tiền thật.
## Ghi chú đồng bộ baseline

M6 đã có code và local test như phần trên; giới hạn “chưa nối repository relational” và “chưa có device E2E” vẫn là giới hạn thật. Planning snapshot đã được bổ sung để không nhầm M6 với M5 mock hoặc M7 Credit.

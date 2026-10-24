# Checklist trước buổi demo

## A. Quyền và dữ liệu

- [ ] Owner xác nhận database demo và các dịch vụ cần giữ chạy.
- [ ] Snapshot/commit trình diễn được ghi trong run sheet.
- [ ] Customer/staff là synthetic; không dùng PII, password, OTP, TOTP secret hoặc token thật.
- [ ] Không có scratch script trong quy trình chính; nếu cần chuẩn bị lại phải có quyết định riêng.
- [ ] Không hiển thị full account number/UUID/trace ID trên slide hoặc ảnh.

## B. Hạ tầng local

- [ ] Backend, Admin API, Admin Web, email/invitation capture có health phù hợp.
- [ ] Mobile emulator/native build kết nối đúng local endpoint; không nhầm với remote URL.
- [ ] Database demo đã migrate theo snapshot; không chạy destructive suite lên database demo.
- [ ] Có cách dừng phiên terminal sau buổi demo; không tự `down --volumes` nếu cần giữ dữ liệu.

## C. Luồng trình diễn

- [ ] Đăng nhập/MFA và route guard hiển thị đúng.
- [ ] KYC synthetic có trạng thái và đường review.
- [ ] Maker request chờ checker; self-approval được giải thích đúng scope.
- [ ] Transfer dùng quote/phí, step-up và receipt; không optimistic balance.
- [ ] Đối soát chuẩn bị sẵn: A `4,498,000`, B `5,500,000`, ledger debit/credit cùng `15,502,000`.
- [ ] Nhánh rút gọn đã được Owner duyệt nếu không đủ thời gian.

## D. Phương án dự phòng

- [ ] Bản ghi/evidence trước đó đã redact và có commit/snapshot rõ.
- [ ] Có slide/screenshot thay thế nhưng không chứa secret hoặc dữ liệu đầy đủ.
- [ ] Nếu service lỗi, chuyển sang giải thích kiến trúc và evidence; không sửa nóng source.
- [ ] Có người Owner quyết định việc restart/khôi phục; người trình bày không tự reset DB.

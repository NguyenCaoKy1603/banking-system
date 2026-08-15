# AGENTS.md — Banking System

## Phạm vi và ownership

- Đây là workspace cho mobile banking pilot/reference implementation, không phải hệ thống xử lý tiền thật.
- `mobile-app/` là phạm vi chính của Thành viên 2. Quy tắc chi tiết hơn trong `mobile-app/AGENTS.md` được ưu tiên cho các file Mobile.
- Không tự ý sửa Backend, database schema, Banking Core, API response hoặc CI lõi khi task Mobile không nêu rõ. `backend/` hiện là reference sandbox dùng để kiểm thử contract, không phải production backend.
- Tài liệu kế hoạch, contract và bằng chứng nằm dưới `documents/`; thay đổi hành vi phải cập nhật tài liệu liên quan.

## Quy trình bắt buộc

1. Đọc task, kế hoạch và file hướng dẫn trong phạm vi trước khi sửa.
2. Xác định Goal, Context, Constraints, acceptance criteria, file được phép sửa và test bắt buộc.
3. Với API chưa được phê duyệt, chỉ dùng mock/reference contract và ghi rõ trạng thái Draft.
4. Thay đổi nhỏ, giữ diff trong phạm vi task; không thêm dependency hoặc mở rộng kiến trúc nếu chưa ghi quyết định.
5. Sau khi sửa, chạy kiểm tra phù hợp: lint, type-check, test, contract validation và build/export nếu có liên quan.
6. Báo cáo file đã thay đổi, data flow, kiểm tra đã chạy, bằng chứng và phần còn thiếu bằng tiếng Việt.

## Nguyên tắc bảo mật và dữ liệu

- Không ghi password, access/refresh token, OTP, PIN, CVV, device secret hoặc dữ liệu tài chính nhạy cảm vào log, analytics, crash report hay ảnh minh chứng.
- Server/API là nguồn sự thật cho balance, fee, interest, credit debt và transaction status; Mobile không optimistic-update số dư.
- Luôn xử lý loading, empty, success, validation, API error, offline/timeout, unauthorized và retry phù hợp.
- Transfer phải giữ idempotency, step-up, trạng thái pending/failed/reversed và cơ chế resume sau crash.
- Không tuyên bố pilot/production readiness khi chưa có staging, core/partner integration, device E2E, monitoring, signing và phê duyệt legal/compliance.

## Quality gates hiện có

- Mobile: `npm run lint`, `npm run typecheck`, `npm test`, `npm run validate:openapi`, `npm run validate:e2e`, `npm run export:web`.
- Backend reference: `npm run validate:database`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:critical` trong `backend/`.
- Cảnh báo dependency High/Critical hoặc test thiết bị chưa chạy phải được ghi trong milestone status, không được che giấu.

## Báo cáo phiên làm việc

Mỗi phiên cần nêu: hành vi đã chạy được; file tạo/sửa; request → state → UI → error; dependency/config/API thay đổi; lệnh kiểm tra và kết quả; cách kiểm tra thủ công; remaining/risk; điểm cần Thành viên 2 giải thích lại.

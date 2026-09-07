# Danh mục use case và điểm tiếp tục — Banking System

Ngày cập nhật: 2026-09-07.

## Đọc khi bắt đầu lại

- Đọc `AGENTS.md`, `PROJECT_CONTEXT.md`, file này và task hiện hành.
- Kiểm tra branch, HEAD và working tree trước khi hành động; các mốc dưới đây là lịch sử, không yêu cầu reset về chúng.
- Dự án là đồ án tốt nghiệp: dữ liệu synthetic, tiền ảo, local demo; không production, KYC thật hoặc tích hợp ngân hàng thật.
- Danh mục 22 use case dưới đây là đề xuất lập từ chức năng hiện có và được lưu theo yêu cầu Owner. Lưu danh mục không tự cấp quyền triển khai tất cả mục, thay đổi acceptance hoặc quyền Git.
- Không đồng nhất các mã này với milestone cũ M0–M11 hoặc giai đoạn S1–S5.

## Trạng thái và bước tiếp theo

**UC-M01 — Registration và Synthetic KYC: COMPLETED — OWNER APPROVED.**

- Đóng nghiệm thu ngày 2026-09-07, qua chuỗi M01-01 đến M01-09.
- Commit implementation/relational verification: `b5ef30cb78eaa43932a2ba14f3989aab6e648994`.
- Commit tài liệu closure: `98f8a1857910f4067828714f8a786e4a77928072`.
- Branch tại closure: `codex/staging-academic-completion`.
- Biên bản: `tasks/UC-M01/TASK_M01_09_AUDIT_AND_CLOSE_UC_M01.md`.
- Giữ giới hạn đã duyệt: KYC-15 kết hợp unit/contract và relational; Registration recovery/cancel chưa có emulator verification độc lập; privacy evidence có phạm vi, không bảo đảm zero leakage tuyệt đối.
- Không mở lại UC-M01 nếu không có bằng chứng regression hoặc yêu cầu mới của Owner.

**UC-M02 — Đăng nhập, quản lý phiên và đăng xuất: COMPLETED — OWNER APPROVED.**

- Đóng nghiệm thu ngày 2026-09-07, qua chuỗi nhiệm vụ M02-01 đến M02-07.
- Commit implementation Mobile/Client Lifecycle: `95c05d35bbed510c175309fe68ea10dd3332cd5f` (M02-05).
- Commit implementation Route Guard & Emulator Verification: `679ef87759f9c350b5f25ac6688b9cadd842bf4c` (M02-06).
- Commit runner alignment & closure audit: lưu cùng checkpoint này.
- Branch tại closure: `codex/staging-academic-completion`.
- Biên bản nghiệm thu: `tasks/UC-M02/TASK_M02_07_AUDIT_AND_CLOSE_UC_M02.md`.
- Giữ 4 giới hạn đồ án đã được Owner phê duyệt: (1) Đăng xuất kết hợp HTTP in-memory và relational service PG, chưa có HTTP relational boundary test tích hợp; (2) SecureStore mock/UI test, không tuyên bố hardware keystore persistence; (3) Cold start / AppState transition kiểm chứng qua React Native unit state machine test; (4) Deep-link kiểm chứng thực nghiệm 5 route Credit sâu kết hợp layout structure audit.
- Không mở lại UC-M02 nếu không có bằng chứng regression hoặc yêu cầu mới từ Owner.

**Điểm tiếp tục: UC-M03 — Quản lý phương thức xác thực và khôi phục MFA.**

- Bước đầu: audit/lập kế hoạch dựa trên source, OpenAPI contract (`/auth/mfa/*`), screen TOTP/Recovery và test hiện có; chưa mặc định sửa code.
- Phạm vi dự kiến: TOTP enrollment, TOTP confirmation, recovery code generation, quản lý phương thức và recovery flow.
- Chưa tạo task chi tiết UC-M03; chưa triển khai hoặc nghiệm thu UC-M03.

## Khách hàng Mobile — 16 use case

| Mã | Tên | Phạm vi chính |
| --- | --- | --- |
| UC-M01 | Đăng ký và Synthetic KYC | Đăng ký, OTP, KYC Draft/Submit; đã hoàn tất với giới hạn được duyệt. |
| UC-M02 | Đăng nhập, quản lý phiên và đăng xuất | Login, refresh, restore, route guard, logout, logout-all. |
| UC-M03 | Quản lý phương thức xác thực và khôi phục MFA | TOTP enrollment/confirmation, quản lý phương thức và recovery theo contract. |
| UC-M04 | Xem tài khoản và số dư | Dashboard, account detail, số dư từ server, hiện/sao chép số tài khoản. |
| UC-M05 | Tra cứu lịch sử và chi tiết giao dịch | Danh sách, lọc/phân trang, chi tiết và trạng thái. |
| UC-M06 | Quản lý người thụ hưởng | Xem, thêm, đổi tên, xóa; validation và duplicate handling. |
| UC-M07 | Chuyển tiền nội bộ mô phỏng | Recipient lookup, quote/phí, step-up, submit, receipt, retry/resume không chuyển trùng. |
| UC-M08 | Xem và quét QR thông tin tài khoản | Hiển thị/quét/nhập QR; UNVERIFIED, không tự khởi tạo thanh toán. |
| UC-M09 | Xem và đánh dấu thông báo | List/detail, mark-read, điều hướng; không yêu cầu push thật. |
| UC-M10 | Báo cáo giao dịch đáng ngờ | Gửi báo cáo, chống trùng và tra cứu trạng thái theo API. |
| UC-M11 | Mở khoản tiết kiệm mô phỏng | Sản phẩm, quote, xác nhận, xác thực, kết quả mở khoản. |
| UC-M12 | Theo dõi khoản tiết kiệm | List/detail, trạng thái, kết quả đáo hạn theo sandbox; không tự thêm tất toán sớm. |
| UC-M13 | Đăng ký và kích hoạt thẻ tín dụng mô phỏng | Hồ sơ, trạng thái xét duyệt, kích hoạt; không CIC/processor thật. |
| UC-M14 | Xem và quản lý trạng thái thẻ | List/detail, khóa, mở khóa, báo mất theo quyền/xác thực. |
| UC-M15 | Tra cứu tài khoản tín dụng và sao kê | Hạn mức, dư nợ, giao dịch, danh sách/chi tiết sao kê. |
| UC-M16 | Thanh toán dư nợ tín dụng mô phỏng | Quote, số tiền, xác thực, submit, phục hồi không ghi nợ trùng. |

## Nhân viên/Admin — 6 use case

| Mã | Tên | Phạm vi chính |
| --- | --- | --- |
| UC-A01 | Đăng nhập và quản lý quyền nhân viên | Staff auth/MFA/session, staff/role và quyền truy cập hiện có. |
| UC-A02 | Tra cứu và kiểm soát khách hàng/tài khoản | Masked reads, yêu cầu khóa/chặn, cấp tiền ảo theo quy trình phê duyệt. |
| UC-A03 | Xét duyệt hồ sơ KYC | Yêu cầu bổ sung, duyệt/từ chối; Mobile không tự duyệt. |
| UC-A04 | Xét duyệt hồ sơ tín dụng | Quyết định theo rule sandbox, không mở nghiệp vụ cho vay thật. |
| UC-A05 | Xử lý giao dịch và báo cáo đáng ngờ | Pending/reversal, fraud case theo quyền và hành động hiện có. |
| UC-A06 | Phê duyệt yêu cầu và tra cứu nhật ký | Approval Inbox, maker-checker, audit trail cho thao tác quản trị. |

Ngoài UC-M01, danh mục không tuyên bố use case nào đã được audit/đóng nghiệm thu. Có implementation không đồng nghĩa COMPLETED.

## Thứ tự đề xuất và dependency

1. UC-M02 → UC-M03 → UC-M04 → UC-M05 → UC-M06.
2. Kiểm chứng phần UC-A01/A02/A03/A06 cần thiết cho quyền KYC, tài khoản và tiền ảo của demo; không bypass quyền để chạy giao dịch.
3. UC-M07 → UC-M09 → UC-M10; phối hợp UC-A05 khi kiểm chứng xử lý phía nhân viên.
4. UC-M08.
5. UC-M11 → UC-M12.
6. UC-A04 phối hợp UC-M13 → UC-M14 → UC-M15 → UC-M16.

Đây là thứ tự đề xuất, cần đối chiếu dependency thực tế khi lập từng task. Savings/Credit giữ mức reference/bonus theo tài liệu lịch sử; đưa vào danh mục không tự nâng thành cam kết nghiệm thu bắt buộc.

## Quy tắc chống mở rộng phạm vi

- Một use case không bắt buộc có chín task như UC-M01. Chỉ tách task khi có lý do cụ thể.
- Migration, Docker, CodeGraph, retry, audit log và test harness không phải use case độc lập trong danh mục này.
- Không thêm chatbot, bill payment, liên ngân hàng, tiền thật, KYC thật hoặc hạ tầng production.
- Tiêu chí đồ án: nghiệp vụ đúng, demo được, dữ liệu đúng, lỗi phổ biến được xử lý, test hợp lý và sinh viên giải thích được.
- Mỗi task cần scope, acceptance và quyền Git rõ; mặc định không stage/commit/push.

## Nguồn lập danh mục

- `mobile-app/README.md` và các màn hình trong `mobile-app/src/features/`.
- `backend/README.md` và `documents/api/banking-mvp.openapi.yaml`.
- `admin-web/README.md`.
- `PROJECT_CONTEXT.md` và biên bản closure UC-M01.

Danh mục dựa trên kiểm tra source/contract và tài liệu, không phải một lần chạy runtime toàn dự án.

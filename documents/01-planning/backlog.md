# Backlog và trạng thái M0–M11

| Mã | Hạng mục | Owner | Trạng thái hiện tại | Việc còn lại / cổng |
| --- | --- | --- | --- | --- |
| M0 | Sẵn sàng dự án | Phối hợp | Baseline và checkpoint Git sạch `aa0e3de` đã có | Owner review/push, board chính thức và evidence thiết bị thật |
| M1 | Nền Mobile | Thành viên 2 | Đã kiểm chứng local | Chạy emulator/điện thoại thật và chốt APK toolchain |
| M2 | Auth và eKYC mô phỏng | Phối hợp | Auth và eKYC mô phỏng đã có local | API KYC thật/test data, forgot/change password nếu được duyệt |
| M3 | Account, dashboard, history | Thành viên 2 | Account detail, cursor history và filter đã có ở reference local | Device/integration evidence và đối soát staging |
| M4 | Transfer, beneficiary, QR | Phối hợp | Transfer, beneficiary list/create/rename/delete, QR payload và camera fallback đã có local | QR contract thật, camera trên device, device E2E |
| M5 | Card | Phối hợp | Card mock bonus đã có local | API thật, rule được duyệt, native E2E và quyết định ownership |
| M6 | Savings | Phối hợp | Chưa bắt đầu | Product/rule, API, kỳ hạn/tích lũy/rút và test data |
| M7 | Credit | Phối hợp | Đã có reference sandbox | Credit API, statement, payment rule, seed và mobile payment/resume đã có; còn relational production, physical device và staging |
| M8 | Notification | Thành viên 2 | List/detail/read và deep link local đã có | Push behavior, device E2E và staging notification seed |
| M9 | Chatbot AI | Phối hợp | Chưa bắt đầu | Chat API, knowledge base, read-only tools, policy và evaluation set |
| M10 | Hardening | Phối hợp | Đang làm; còn blocker | Device E2E, performance, accessibility, usability, audit High và regression |
| M11 | Release/hồ sơ | Phối hợp | Bị chặn | APK cài ngoài máy phát triển, staging, signing, evidence và demo |

## P0 cần giữ

Auth/session, Account/History, Transfer/idempotency/pending, error handling, test P0 và APK. Card hiện chỉ là bonus mock để kiểm tra phạm vi; Savings/Credit/Chatbot chưa mở rộng trước khi có APK/device evidence và quyết định được ghi trong decision log.
## Cập nhật baseline M6/M7 — 2026-08-15

> Bảng này bổ sung và thay thế trạng thái M6/M7 trong snapshot cũ.

| Mã | Trạng thái mới | Ghi chú |
| --- | --- | --- |
| M6 | Đã có reference sandbox | Savings đã có API draft, persistence snapshot, seed, MFA/idempotency, maturity và local test; device E2E thật còn thiếu. |
| M7 | Đang triển khai reference sandbox | Credit card/account/statement/payment đã có backend + Mobile API draft; PostgreSQL relational adapter, Maestro/device evidence và regression còn lại. |
| M5 | Giữ riêng mock | `cardsMock` chỉ là fixture/test legacy; `/cards` dùng Credit sandbox M7. |

# Backlog và trạng thái M0–M11

> **Historical planning snapshot:** các trạng thái và hạng mục bên dưới không phải backlog hiện hành. Dùng current-status.md cùng source/board được owner xác nhận trước khi chọn task.

> Cập nhật hiện hành 2026-08-17: branch `codex/mini-core-banking-sandbox` đã triển khai Mini Core Sandbox G0–G9 ở mức reference. M0–M4 và M8 vẫn được giữ trong chương trình; trạng thái và quality gate mới nhất xem tại [`mini-core-sandbox-status.md`](mini-core-sandbox-status.md). Các con số trong phần lịch sử bên dưới thuộc checkpoint trước branch này.

| Mã | Hạng mục | Owner | Trạng thái hiện tại | Việc còn lại / cổng |
| --- | --- | --- | --- | --- |
| M0 | Sẵn sàng dự án | Phối hợp | Baseline và checkpoint Git sạch `cab97e0` đã có | Owner review/push, board chính thức và evidence thiết bị thật |
| M1 | Nền Mobile | Thành viên 2 | Đã kiểm chứng local | Chạy emulator/điện thoại thật và chốt APK toolchain |
| M2 | Auth và eKYC dùng dữ liệu thử nghiệm | Phối hợp | Auth và eKYC dùng dữ liệu thử nghiệm đã có local | API KYC thật/test data, forgot/change password nếu được duyệt |
| M3 | Account, dashboard, history | Thành viên 2 | Account detail, cursor history và filter đã có ở reference local | Device/integration evidence và đối soát staging |
| M4 | Transfer, beneficiary, QR | Phối hợp | Transfer, beneficiary list/create/rename/delete, QR payload/camera fallback và pending-resume sau restart đã có bằng chứng emulator | QR contract thật, camera trên device, concurrency và device E2E |
| M5 | Card | Phối hợp | Card mock bonus đã có local | API thật, rule được duyệt, native E2E và quyết định ownership |
| M6 | Savings | Phối hợp | Đã có reference sandbox | Product/rule production, device/integration evidence và repository relational |
| M7 | Credit | Phối hợp | Đã có reference sandbox | Credit API, statement, payment rule, seed và mobile payment/resume đã có; còn relational production, physical device và staging |
| M8 | Notification | Thành viên 2 | List/detail/read và deep link local đã có | Push behavior, device E2E và staging notification seed |
| M9 | Chatbot AI | Phối hợp | Chưa bắt đầu | Chat API, knowledge base, read-only tools, policy và evaluation set |
| M10 | Hardening | Phối hợp | Đang làm; còn blocker | Device E2E, performance, accessibility, usability, audit High và regression |
| M11 | Release/hồ sơ | Phối hợp | Bị chặn | APK cài ngoài máy phát triển, staging, signing, evidence và demo |

## P0 cần giữ

Auth/session, Account/History, Transfer/idempotency/pending, error handling, test P0 và APK. Card mock vẫn tách khỏi Credit sandbox; Savings/Credit đã mở rộng có chủ đích ở mức reference, còn Chatbot chưa triển khai.
## Cập nhật baseline M6/M7 — 2026-08-15

> Bảng này bổ sung và thay thế trạng thái M6/M7 trong snapshot cũ.

| Mã | Trạng thái mới | Ghi chú |
| --- | --- | --- |
| M6 | Đã có reference sandbox | Savings đã có API draft, persistence snapshot, seed, MFA/idempotency, maturity và local test; device E2E thật còn thiếu. |
| M7 | Đã có reference sandbox | Credit card/account/statement/payment đã có backend + Mobile API draft; còn PostgreSQL relational production adapter, physical device và staging. |
| M5 | Giữ riêng mock | `cardsMock` chỉ là fixture/test legacy; `/cards` dùng Credit sandbox M7. |

## Kế hoạch các bước tiếp theo cho phạm vi ngân hàng sandbox — 2026-08-17

| Giai đoạn | Trọng tâm | Điều kiện hoàn thành |
| --- | --- | --- |
| S1 — Reproducible handoff | Clone sạch, migration, CI PostgreSQL, lockfile và tài liệu chạy | `npm ci` + migration + quality gate chạy lại được; không có secret/artifact thừa trong Git |
| S2 — Transfer hardening | Concurrency, retry/timeout/offline, quote/OTP expiry, outbox và health | Không double-debit; lỗi mạng có retry/resume; health báo lỗi đúng khi DB/outbox hỏng |
| S3 — Persistent reference relational | Core M0–M4/M8 đã chiếu vào bảng relational; runtime/auth và M6/M7 vẫn record-level reference | Database rỗng chạy migration; restart còn dữ liệu; transaction quote → transfer → ledger → outbox có rollback/commit rõ; mở rộng toàn bộ domain vẫn là việc dài hạn |
| S4 — Device evidence | Android thật cho camera QR, permission, background/resume; iOS nếu được duyệt | Có report/video/ảnh không chứa secret; emulator và thiết bị thật phân biệt rõ |
| S5 — Bàn giao đồ án | Commit SHA, test report, health JSON, APK checksum, runbook demo | Người khác tái hiện được bằng dữ liệu giả lập và biết rõ giới hạn reference |

Thứ tự ưu tiên hiện hành là S1 → S2 → S3 → S4 → S5. S1–S3 đã hoàn tất ở mức reference sandbox; S4 còn mở ở thiết bị thật/native, S5 đã có hồ sơ bàn giao. Không mở rộng sang core banking, payment rail hoặc tiền thật. Savings/Credit giữ ở mức bonus/reference, Chatbot AI ngoài scope.

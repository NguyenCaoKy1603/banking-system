# Bản đồ chức năng toàn hệ thống

> “Có trong source” mô tả code hiện hành. Evidence cũ phải được đọc cùng ngày chạy, commit/build, environment và test layer; không nâng tự động thành staging acceptance.

## Customer Mobile và Public API

| Domain | Hành vi có trong source | State/API boundary | Giới hạn |
| --- | --- | --- | --- |
| Identity | Registration, password login, MFA challenge/TOTP, refresh rotation, logout/revoke, recovery flows và device binding | Public API; relational auth/registration/MFA services khi route group bật | Email/OTP delivery và device assurance phụ thuộc provider/runtime; local mock không chứng minh provider thật |
| Profile / account | Profile, payment account list/detail, masked account number, explicit reveal/copy, balance và transactions | Authenticated public API; account reads | Backend là nguồn số dư; không optimistic-update balance |
| History | Transaction list/filter/detail và liên kết từ notification | Authenticated API, response validators | History là sandbox data; không chứng minh ledger của partner |
| Beneficiaries / recipients | Tạo/sửa/xóa danh bạ, internal recipient lookup và masked confirmation | Beneficiary/recipient boundary | Chỉ nội bộ reference; không có interbank directory |
| Transfers | Server quote, fee, review, TOTP step-up, idempotent submit, receipt/status, pending/retry/resume | Transfer service + PostgreSQL transaction/ledger/audit/outbox trên relational path | Không gọi payment rail/core thật; uncertain outcome cần server reconciliation |
| Savings | Product/quote, opening/deposit, list/detail, pending recovery và lifecycle logic | Savings service, persistence, lifecycle scheduler | Sandbox product/rates; chưa là tiền gửi được phê duyệt |
| Credit / Cards | Credit application/account, card details/control, statements, quote/payment và pending/resume flows | Credit service và card/credit policy | Không phải card issuer/processor; giới hạn môi trường synthetic |
| KYC | Khai báo/draft/submit và trạng thái; Admin review/request-more-info | Customer KYC API + relational KYC service; Admin API | Không có document identity vendor hay quyết định KYC/AML thật |
| QR | Sinh/scan versioned receiving-information payload và manual fallback | Mobile QR feature (dùng accountsApi khi tạo, local validation khi quét) | Mã QR UNVERIFIED; không tự khởi tạo payment từ scan |
| Notifications | Inbox, mark-read, resource deep link | Public API + outbox related persistence | Push delivery provider thật chưa được chứng minh |
| Assistant Help | FAQ suggestions, question, sensitive-input guard, deterministic selection, Radox/bounded selector và catalog answer | POST /api/v1/assistant/help; Radox provider bảo mật | Read-only help; không biết balance/account data; model có thể chọn FAQ sai |
| Financial Advice | Nhập thu/chi/mục tiêu, calculator xác định, option selection và explanation | POST /api/v1/assistant/financial-advice; provider có fallback/limits | Không lấy core balance; không thay tư vấn chuyên môn hoặc offer ngân hàng đã duyệt |

## Admin và operations

| Domain | Hành vi có trong source | Ranh giới / giới hạn |
| --- | --- | --- |
| Staff access | Login, activation, session, permission checks và logout | Process/API riêng; cookie/CSRF realm riêng với customer token |
| Customer / accounts | Staff views và các action được permission registry cho phép | Response fields phụ thuộc route/permission; kiểm tra runtime registry cho từng thao tác |
| KYC / Credit review | Review, approve/reject/need-more-info hoặc xử lý workflow được hỗ trợ | Synthetic records; không phải quyết định pháp lý/credit thật |
| Transfers / approvals | Maker-checker action requests, review và execute command được phép | Checker phải tách khỏi maker theo four-eyes policy |
| Operations | Outbox/job summaries, events và audit views | Không có nghĩa worker/provider đang bật |
| Staff / roles | Staff và role management trong Admin API/Web | Quyền runtime mới là source of truth; matrix tài liệu có thể cũ |
| Fraud | Customer report và Admin Fraud queue đã bị gỡ khỏi UI/API hiện hành | Legacy schema/migrations còn lại không phải route/function đang được support |

## Background và platform

| Khu vực | Có trong source | Chưa được suy ra |
| --- | --- | --- |
| PostgreSQL | Migrations, pool, UnitOfWork, relational repositories và cutover route groups | Managed production database, HA, RLS hoặc backup service |
| Outbox worker | Lease/retry/dead-letter handling, health, scheduled lifecycle integration | Real email/push delivery hoặc worker đang bật tại staging |
| Observability | Health/version/metrics, request/trace IDs và bounded labels | Monitoring/alerting/SLO thật |
| Secrets | Registry/provider abstractions và runtime guards | Cloud Secret Manager đã provision/cấp quyền/audit thật |
| Local deployment | Compose Postgres/migrate/backend/Admin/Web profiles | Cloud preview, public HTTPS hoặc release candidate |

## Các mục ngoài phạm vi sản phẩm hiện tại

- Tiền thật, external bank transfer, payment rails hoặc core banking.
- Card issuance/processing, identity proofing/KYC/AML provider thật.
- Chat tool được quyền đọc hoặc thực hiện giao dịch trong tài khoản.
- Dùng AI endpoint công khai; Radox chỉ là backend-side provider trong môi trường hạn chế (sensitive filter + sandbox catalog).
- Customer fraud-report workflow; luồng đó đã bị loại khỏi source hiện hành.
- Pilot/production approval, legal/compliance sign-off, physical-device sign-off và cloud operations.

## Nguyên tắc nghiệm thu

1. Mỗi use case cần evidence cho đúng layer: unit, HTTP integration, database disposable, emulator, thiết bị thật hoặc staging.
2. Ghi commit/build digest và environment cho bằng chứng; không trộn evidence khác thời điểm.
3. Status DRAFT/reference trong API contract không được đổi chỉ vì UI hoặc backend route đã tồn tại.
4. Dùng [current status](../01-planning/current-status.md) làm trang tổng hợp; các báo cáo dated bên dưới Testing/AI/Release chỉ chứng minh phần được ghi trong báo cáo.

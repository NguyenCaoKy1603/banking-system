# Bản đồ chức năng toàn hệ thống

> “Có trong source” mô tả code hiện hành. Evidence cũ phải được đọc cùng ngày chạy, commit/build, environment và test layer; không nâng tự động thành staging acceptance.

## Customer Mobile và Public API

| Domain | Hành vi có trong source | State/API boundary | Giới hạn |
| --- | --- | --- | --- |
| Identity & Devices | Registration 2 bước Email OTP, password login, MFA challenge TOTP & device-bound Biometric (`biometric-v1`), đổi mật khẩu (`POST /auth/password/change`), quên/đặt lại mật khẩu (`POST /auth/password/forgot`, `/reset`), refresh rotation, logout/revoke, liệt kê & thu hồi thiết bị đăng nhập (`GET/DELETE /auth/devices`), Privacy Shield & cửa sổ ân hạn 30s | Public API; relational auth/registration/MFA services (`046`, `050`) | Email/OTP delivery phụ thuộc provider/runtime; `biometric-v1` là challenge-response gắn thiết bị reference, chưa phải hardware FIDO2/Passkey attestation |
| Profile / Account | Profile, đa tài khoản thanh toán (cộng dồn tổng số dư trên Home), masked account number, explicit reveal/copy (`GET /accounts/{id}/number`), số dư khả dụng/thực tế/tạm giữ (`held_minor`) | Authenticated public API; `RelationalAccountReadService` | Backend là nguồn số dư; không optimistic-update balance |
| History & Export | Lọc phía server (`status`, `direction`, `from`, `to`, `q`), phân trang cursor, chi tiết biên lai, thống kê dòng tiền Thu/Chi theo tháng (`GET /accounts/{id}/summary`), xuất sao kê CSV/HTML (`GET /accounts/{id}/statement-export`) | Authenticated API, response validators, CSV formula injection & HTML escaping | History là sandbox data; không chứng minh sao kê pháp lý của ngân hàng thật |
| Beneficiaries / Recipients | Tạo/sửa/xóa danh bạ, tra cứu nội bộ (`POST /internal-recipients/lookup`) và tra cứu liên ngân hàng mô phỏng NAPAS IBFT (`POST /external-recipients/lookup` hỗ trợ 8 mã BIN VN) có rate limit & TTL 5 phút | `RelationalBeneficiaryService`, `RelationalTransferService`, `MockNapasGateway` (`049`) | Danh bạ nội bộ và `MockNapasGateway` chỉ là mô phỏng cục bộ; không nối danh bạ liên ngân hàng thật |
| Transfers | Chuyển tiền nội bộ (`INTERNAL`) và liên ngân hàng mô phỏng (`NAPAS_IBFT` hai pha `held_minor`); báo giá với phí động (`transfer_fee_minor`) & hạn mức lũy kế ngày (`daily_transfer_limit_minor`) từ `control_policy`, TOTP hoặc Biometric step-up (≤ 1.000.000 VND trên Mobile), idempotency 2 lớp, crash-recovery intent và kiểm tra anomaly thời gian thực | `RelationalTransferService` + PostgreSQL transaction/double-entry ledger/audit/outbox (`047`, `048`, `049`, `051`) | Không gọi payment rail/NAPAS 247/core thật; uncertain outcome cần server reconciliation |
| Anomaly Detection | Chấm điểm rủi ro giao dịch tất định (`BigInt`, 6 quy tắc, mức `LOW`/`MEDIUM`/`HIGH`/`CRITICAL`), chặn `CRITICAL` nếu chưa `confirmHighRisk`, lưu cảnh báo (`transaction_anomalies`), khách hàng xem & xác nhận an toàn / báo nghi ngờ (`/anomalies`, `GET/POST /anomalies`) | `RelationalAnomalyService`, `domain/anomaly/`, `AnomalyAlertsScreen` (`045`) | Bộ luật heuristic cục bộ trên dữ liệu synthetic; tách biệt bảng `fraud_reports` cũ đã gỡ; không thay thế hệ thống FDS/AML production |
| Savings | Product/quote, mở sổ, danh sách/chi tiết, đổi phương án đáo hạn (`PATCH`), tất toán trước hạn lãi không kỳ hạn 0,20%/năm (`POST .../withdraw`), pending recovery và lifecycle đáo hạn | `RelationalSavingsService`, persistence, lifecycle scheduler (`044`) | Sandbox product/rates; chưa là tiền gửi được phê duyệt |
| Credit / Cards | Đăng ký thẻ (bắt buộc KYC `APPROVED` cả Mobile & Backend `409 KYC_REQUIRED`), kích hoạt, tài khoản tín dụng, khóa khẩn cấp/mở khóa/báo mất thẻ, sao kê, báo giá/thanh toán dư nợ và pending/resume | `RelationalCreditService` và card/credit policy (`035`, `040`) | Không phải card issuer/processor; giới hạn môi trường synthetic |
| KYC | Khai báo/draft/submit và trạng thái; Admin claim/review/approve/reject/need-more-info | Customer KYC API + `RelationalKycService`; Admin API (`038`) | Không có document identity vendor hay quyết định KYC/AML thật |
| QR & VietQR | Sinh/quét mã **VietQR (EMVCo TLV + CRC-16/CCITT-FALSE)** tĩnh/động (kèm số tiền & nội dung) và NOVA QR v2, tự bật camera sau & manual fallback, chuyển tiếp sang `/transfer` để server đối soát người nhận | Mobile QR feature (`vietQrCodec.ts`, `qrPayload.ts`, `QrScreen.tsx`) | Mã QR luôn được đánh nhãn `UNVERIFIED` trước khi server đối soát (`D-20`); không tự khởi tạo lệnh trừ tiền từ thao tác quét |
| Notifications | Inbox, mark-read, resource deep link (gồm thông báo `SECURITY` khi phát hiện/báo cáo anomaly) | Public API + outbox related persistence | Push/email delivery provider thật chưa được chứng minh |
| Assistant Help | FAQ suggestions, question, sensitive-input guard, deterministic selection, Radox/bounded selector và catalog answer | `POST /api/v1/assistant/help`; Radox provider bảo mật | Read-only help; không biết balance/account data; model có thể chọn FAQ sai |
| Financial Advice | Nhập thu/chi/mục tiêu, calculator xác định (`BigInt`), option selection và explanation | `POST /api/v1/assistant/financial-advice`; provider có fallback/limits | Không lấy core balance; không thay tư vấn chuyên môn hoặc offer ngân hàng đã duyệt |

## Admin và operations

| Domain | Hành vi có trong source | Ranh giới / giới hạn |
| --- | --- | --- |
| Staff access | Login 2 vai trò (`OPERATIONS`: mật khẩu sau khi tạo; `ADMIN`: mật khẩu + TOTP), activation, session cookie `HttpOnly` + CSRF, permission checks và logout | Process/API riêng; cookie/CSRF realm riêng với customer token |
| Customer / accounts | Staff views dữ liệu đã che (`customer.read.masked`), khóa/mở khóa truy cập, phong tỏa/giải tỏa tài khoản, cấp tiền & hoàn tác nạp tiền | Response fields phụ thuộc route/permission; kiểm tra runtime registry cho từng thao tác |
| KYC / Credit review | Claim hồ sơ, xem chi tiết thẩm định (CCCD format check / CIC mockup), approve/reject/need-more-info (hỗ trợ Direct Execution hoặc 2 bước) | Synthetic records; không phải quyết định pháp lý/credit thật |
| Transfers & Anomalies | Giám sát giao dịch theo trạng thái, xem timeline, yêu cầu retry/cancel/reversal; **hàng đợi cảnh báo bất thường** (`GET /admin/anomalies`, `POST /admin/anomalies/{id}/resolve`) | Checker phải tách quyền theo policy; anomaly resolution không thay thế quy trình điều tra gian lận pháp lý |
| Policy & Ledger Reconciliation | Màn hình **Chính sách & Biểu phí (`#/policy`)**: cập nhật động Global Kill-Switch, bật/tắt dịch vụ, hạn mức giao dịch/ngày, phí chuyển tiền (`GET/PATCH /admin/control-policy` yêu cầu `audit.read` + fresh TOTP Step-up); **Đối soát sổ cái kép** (`GET /admin/operations/ledger-reconciliation` kiểm tra journal unbalanced và độ lệch `payment-account:*` vs `SUM(current_minor)`) | Chỉ `ADMIN` được chỉnh sửa chính sách; vẫn chỉ vận hành trên sổ cái tiền ảo reference |
| Approvals | Approval Inbox (Maker-Checker), Auto-Refresh 15s, phê duyệt/từ chối kèm TOTP Step-up | Chỉ `ADMIN` có `audit.read` và quyền duyệt theo loại action |
| Operations | Outbox/job summaries, dead-letters, requeue/retry requests, Auto-Refresh 15s | Không có nghĩa worker/provider đang bật |
| Staff / roles | Admin tạo trực tiếp tài khoản `OPERATIONS` (kèm xác minh TOTP 1 lần), đổi vai trò và vô hiệu hóa | Quyền runtime (`permissionRegistry.ts`, 63 routes) mới là source of truth |
| Legacy Fraud | Customer `fraud_reports` và Admin Fraud queue cũ đã bị gỡ khỏi UI/API hiện hành (D-39) | Legacy schema/migrations còn lại không phải route/function đang được support; luồng mới là Anomaly Detection (`transaction_anomalies`) |

## Background và platform

| Khu vực | Có trong source | Chưa được suy ra |
| --- | --- | --- |
| PostgreSQL | 51 migrations (`001`–`051`), pool, UnitOfWork, relational repositories và cutover route groups | Managed production database, HA, RLS hoặc backup service |
| Outbox & Lifecycle Worker | Lease/retry/dead-letter handling, health, đáo hạn tiết kiệm/suspense, sao kê/quá hạn tín dụng và **đối soát giao dịch liên ngân hàng `NAPAS_IBFT` treo** | Real email/push delivery, đối soát NAPAS thật hoặc worker đang bật tại staging |
| Observability | Health/version/metrics, request/trace IDs và bounded labels | Monitoring/alerting/SLO thật |
| Secrets | Registry/provider abstractions và runtime guards | Cloud Secret Manager đã provision/cấp quyền/audit thật |
| Local deployment | Compose Postgres/migrate/backend (`0.0.0.0:5000` LAN)/Admin/Web profiles; Mobile web LAN auto-host & safe UUIDv4 | Cloud preview, public HTTPS hoặc release candidate |

## Các mục ngoài phạm vi sản phẩm hiện tại

- Tiền thật, kết nối NAPAS 247 / payment rail thật hoặc core banking thật (`MockNapasGateway` chỉ là mô phỏng cục bộ).
- Card issuance/processing, identity proofing/KYC/AML provider thật, hệ thống phòng chống gian lận FDS thật và hardware FIDO2/Passkey attestation.
- Chat tool được quyền đọc hoặc thực hiện giao dịch trong tài khoản.
- Dùng AI endpoint công khai; Radox chỉ là backend-side provider trong môi trường hạn chế (sensitive filter + sandbox catalog).
- Legacy customer `fraud_reports` workflow đã bị loại khỏi source hiện hành (D-39).
- Pilot/production approval, legal/compliance sign-off, physical-device sign-off và cloud operations.

## Nguyên tắc nghiệm thu

1. Mỗi use case cần evidence cho đúng layer: unit, HTTP integration, database disposable, emulator, thiết bị thật hoặc staging.
2. Ghi commit/build digest và environment cho bằng chứng; không trộn evidence khác thời điểm.
3. Status DRAFT/reference trong API contract không được đổi chỉ vì UI hoặc backend route đã tồn tại.
4. Dùng [current status](../01-planning/current-status.md) làm trang tổng hợp; các báo cáo dated bên dưới Testing/AI/Release chỉ chứng minh phần được ghi trong báo cáo.

# Relational-v2 HTTP cutover matrix

Ngày cập nhật: 2026-08-25  
Trạng thái: **INCREMENTAL CUTOVER — chưa đủ điều kiện bật `BANKING_PERSISTENCE_MODE=relational-v2` cho toàn bộ HTTP**

## Phạm vi đã nối trực tiếp

| Nhóm route | Route | Nguồn dữ liệu hiện tại | Trạng thái | Bằng chứng bắt buộc |
|---|---|---|---|---|
| Session | `POST /api/v1/auth/login` | `customers`, `customer_devices`, `auth_sessions`, `refresh_session_*` | Direct khi `BANKING_RELATIONAL_HTTP_ROUTES=auth` | password timing/dummy path, device binding, MFA challenge, session row |
| Session | `POST /api/v1/auth/verify` | `auth_challenges` + session tables | Direct khi `...=auth` và có persistent MFA | TOTP verify, session rotation, revoke |
| Session | `POST /api/v1/auth/refresh` | `auth_sessions`, `refresh_session_*` | Direct khi `...=auth` | refresh rotation, replay/revocation |
| Session | `POST /api/v1/auth/logout` | session/family tables | Direct khi `...=auth` | device binding, family revoke |
| Session | `POST /api/v1/auth/logout-all` | session/family tables | Direct khi `...=auth` | customer-wide revoke |
| Account read | `GET /api/v1/accounts` | `payment_accounts` | Direct khi `...=accounts` | ownership + money mapping |
| Account read | `GET /api/v1/accounts/:id/number` | `payment_accounts` | Direct khi `...=accounts` | ownership + reveal audit follow-up |
| Account read | `GET /api/v1/accounts/:id/transactions` | `account_transactions` | Direct khi `...=accounts` | keyset cursor contract |
| Account read | `GET /api/v1/accounts/:id/transactions/:txId` | `account_transactions` | Direct khi `...=accounts` | ownership + not-found contract |

Feature flag này chỉ là lát cắt rehearsal; preview mặc định không đặt flag nên vẫn dùng compatibility adapter legacy.

## Các nhóm còn legacy / chưa được phép bật

| Nhóm | Route/khối | Lý do chưa cutover |
|---|---|---|
| Registration | `/auth/register`, `/auth/register/verify` | Có service direct sau feature group `registration`, nhưng local compose dùng `NullEmailProvider`; chỉ rehearsal với provider test được kiểm soát và phải có delivery evidence. |
| MFA lifecycle | `/auth/mfa/*`, `/auth/otp/challenges` | Challenge đã lưu relational nhưng lifecycle handler còn gọi `BankingSystem` cho password/session/state bridge. |
| Beneficiary/recipient | `/beneficiaries/*`, `/internal-recipients/*` | Cần repository read/write và expiry/idempotency trực tiếp. |
| Transfer | `/transfers/quote`, `/transfers`, `/transfers/:id` | `RelationalTransferService.submit` đã có nhưng quote creation, step-up binding, receipt mapping và HTTP integration chưa nối. |
| Savings | `/savings/*` | Chưa có service transaction hoàn chỉnh; không được để runtime records làm source of truth. |
| Credit/cards | `/credit/*`, `/cards/*` | Chưa có service transaction hoàn chỉnh; cần ledger/idempotency/reconciliation contract. |
| Notifications/fraud | `/notifications/*`, `/fraud-reports/*` | Cần direct repository + outbox/audit ownership. |

## Cổng chuyển giai đoạn kế tiếp

Không bật `BANKING_PERSISTENCE_MODE=relational-v2`, `WORKER_ENABLED=1` hoặc staging chỉ vì các route đầu tiên đã direct. Chỉ chuyển khi:

1. Mọi route trong bảng “còn legacy” đã có owner relational và integration test HTTP.
2. Không còn request path gọi `PostgresRelationalRepository.withState` trong profile relational-v2.
3. Registration/auth/session/MFA, transfer/ledger, savings và credit đều có disposable-DB test, restart test và reconciliation.
4. Chạy được 20 transfer đồng thời, API + 2 worker, restart giữa transaction/outbox và chứng minh không double-debit.
5. Route matrix, migration digest, outbox inventory và skip classification được ghi trong evidence của cùng commit.

## Cách rehearsal lát cắt hiện tại

Chỉ dùng local/disposable database:

```powershell
$env:BANKING_RELATIONAL_HTTP_ROUTES = "auth,accounts"
npm run typecheck
npm run build
npm run test:critical
```

Xóa biến môi trường để quay về preview compatibility. Giá trị này không phải staging evidence và không thay thế cutover gate.

`registration` là group riêng, không bật cùng `auth` nếu chưa cấu hình provider gửi email/OTP có evidence; `auth` chỉ bao phủ session login/verify/refresh/logout.

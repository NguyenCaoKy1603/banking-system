# Relational-v2 HTTP cutover matrix

Ngày cập nhật: 2026-08-30
Trạng thái: **RELATIONAL-V2 CUSTOMER CUTOVER — business-hardening và integrated disposable rehearsal PASS; worker preview chưa bật; staging/production evidence chưa có**

## Phạm vi đã nối trực tiếp

| Nhóm route | Route | Nguồn dữ liệu hiện tại | Trạng thái | Bằng chứng bắt buộc |
|---|---|---|---|---|
| Session | `POST /api/v1/auth/login` | `customers`, `customer_devices`, `auth_sessions`, `refresh_session_*` | Direct khi `BANKING_RELATIONAL_HTTP_ROUTES=auth,mfa` | password timing/dummy path, device binding, persistent MFA challenge, session row |
| Session | `POST /api/v1/auth/verify` | `auth_challenges` + session tables | Direct khi `...=auth,mfa` và có persistent MFA | TOTP verify, session rotation, revoke |
| Session | `POST /api/v1/auth/refresh` | `auth_sessions`, `refresh_session_*` | Direct khi `...=auth,mfa` | refresh rotation, replay/revocation |
| Session | `POST /api/v1/auth/logout` | session/family tables | Direct khi `...=auth,mfa` | device binding, family revoke |
| Session | `POST /api/v1/auth/logout-all` | session/family tables | Direct khi `...=auth,mfa` | customer-wide revoke |
| Registration | `POST /api/v1/auth/register`, `/register/verify` | `pending_registrations`, `auth_challenges`, `customers`, `payment_accounts`, `registration_completions`, `audit_events`, `outbox_events` | **RELATIONAL-V2** khi `...=auth,registration` | HTTP capture provider disposable, hash-only OTP, outbox intent không chứa mã, one-winner verify, unique identity, TOTP enrollment; staging phải dùng HTTPS + Secret Manager |
| MFA lifecycle | `/auth/mfa/*`, `/auth/otp/challenges` | `mfa_credentials`, `auth_challenges`, `mfa_recovery_*`, `auth_security_events`, session tables | Direct khi `...=auth,mfa` | TOTP enrollment/confirm, login + step-up challenge, retry/lock/expiry/consume, recovery/reset audit, concurrent one-winner verification, refresh/logout security state |
| KYC customer | `GET/POST /api/v1/kyc/application`, `POST /api/v1/kyc/application/submit` | `kyc_applications`, `audit_events`, `notifications`, `outbox_events` | **RELATIONAL-V2** khi `...=kyc` | synthetic-only DRAFT → SUBMITTED → UNDER_REVIEW/NEEDS_MORE_INFO → APPROVED/REJECTED, ownership, idempotent submit, audit/outbox cùng transaction |
| Account read | `GET /api/v1/accounts` | `payment_accounts` | Direct khi `...=accounts` | ownership + money mapping |
| Account read | `GET /api/v1/accounts/:id/number` | `payment_accounts` | Direct khi `...=accounts` | ownership + reveal audit follow-up |
| Account read | `GET /api/v1/accounts/:id/transactions` | `account_transactions` | Direct khi `...=accounts` | keyset cursor contract |
| Account read | `GET /api/v1/accounts/:id/transactions/:txId` | `account_transactions` | Direct khi `...=accounts` | ownership + not-found contract |
| Beneficiary | `GET/POST/PATCH/DELETE /api/v1/beneficiaries/*` | `beneficiaries`, `payment_accounts`, `customers` | Direct khi `...=beneficiaries` | ownership, destination status, append-only audit; delete là tombstone `DELETED`, risk block vẫn là `BLOCKED`, target đã xóa có thể tạo lại |
| Transfer quote | `POST /api/v1/transfers/quote` | `transfer_quotes`, `beneficiaries`, `payment_accounts`, `customers` | Direct khi `...=transfers` | quote expiry, recipient ownership, quote fingerprint, server-side immutable counterparty snapshot |
| Transfer submit | `POST /api/v1/transfers` | `transfers`, `payment_accounts`, `account_transactions`, `ledger_*`, `audit_events`, `outbox_events` | Direct khi `...=transfers` và persistent TOTP | idempotency, quote consume, lock ordering, balanced ledger, atomic outbox |
| Transfer read | `GET /api/v1/transfers/:id` | `transfers` | Direct khi `...=transfers` | customer ownership + receipt mapping |
| Internal recipient lookup | `POST /api/v1/internal-recipients/lookup` | `payment_accounts`, `customers`, `recipient_lookups`, `audit_events` | Direct khi `...=recipients` | ownership/self-transfer guard, expiry, hashed lookup token, transfer quote integration |
| Savings products | `GET /api/v1/savings/products` | `savings_products`, `control_policy` | Direct khi `...=savings` | active catalogue, policy gate, no state mutation |
| Savings quote | `POST /api/v1/savings/quotes` | `savings_quotes`, `savings_products`, `payment_accounts` | Direct khi `...=savings` | amount/product validation, quote expiry/fingerprint |
| Savings opening | `POST /api/v1/savings/deposits` | `savings_idempotency`, `savings_quotes`, `savings_openings`, `savings_deposits`, `payment_accounts`, `account_transactions`, `ledger_*`, `audit_events`, `outbox_events` | Direct khi `...=savings` và persistent TOTP | one-time quote, concurrent idempotency, atomic debit/ledger/audit/outbox, rollback |
| Savings read | `GET /api/v1/savings/openings/:id`, `GET /api/v1/savings/deposits*` | `savings_openings`, `savings_deposits` | Direct khi `...=savings` | ownership, restart read, GET không mutate |
| Credit cards | `GET /api/v1/cards`, `GET /api/v1/cards/:id` | `credit_cards`, `credit_accounts`, `credit_statements`, `credit_transactions`, `credit_payments` | Direct khi `...=credit` | ownership, server-calculated balances, read-only statement/card detail |
| Credit card controls | `POST /api/v1/cards/:id/lock`, `/unlock`, `/report-lost` | `credit_cards`, `card_security_cases`, `notifications`, `audit_events`, `outbox_events` | Direct khi `...=credit` | emergency lock không yêu cầu TOTP; unlock dùng `CARD_UNLOCK`; báo mất dùng `CARD_REPORT_LOST`, tạo một durable case; row lock, idempotency, audit/outbox |
| Credit application | `GET/POST /api/v1/credit/applications*`, `POST .../:id/activate` | `credit_applications`, `credit_idempotency`, `credit_accounts`, `credit_cards`, `credit_statements`, `audit_events`, `outbox_events` | Direct khi `...=credit` và persistent TOTP cho command | request idempotency, explicit admin decision state, activation atomicity and restart |
| Credit account/statement reads | `GET /api/v1/credit/accounts*`, transactions, statements | `credit_accounts`, `credit_transactions`, `credit_statements`, `credit_statement_items`, `credit_payments` | Direct khi `...=credit` | ownership, keyset cursor, GET không mutate |
| Credit payment | `POST /api/v1/credit/payment-quotes`, `/payments`, `GET /api/v1/credit/payments/:id` | `credit_payment_quotes`, `credit_idempotency`, `payment_accounts`, `credit_accounts`, `credit_statements`, `credit_payments`, `account_transactions`, `ledger_*`, `audit_events`, `outbox_events` | Direct khi `...=credit` và persistent TOTP | latest statement, no overpay, concurrent one-winner, idempotency, atomic payment/ledger/audit/outbox, rollback/restart; repayment vẫn chạy khi global/new-credit switch tắt và account `FROZEN`, nhưng dừng khi `credit_payments_enabled=false` |
| Notifications | `GET /api/v1/notifications`, `POST /api/v1/notifications/:id/read` | `notifications`, `audit_events` | Direct khi `...=notifications` | customer ownership, read-only list, idempotent mark-as-read, no financial mutation |
| Fraud report | `POST /api/v1/fraud-reports`, `GET /api/v1/fraud-reports/:id` | `fraud_reports`, `fraud_report_idempotency`, `account_transactions`, `audit_events`, `outbox_events` | Direct khi `...=fraud` | transaction ownership, one open report, idempotency, redacted event payload, audit/outbox atomically |

Các nhóm route trên là boundary direct của relational-v2. Local preview dùng `IMAGE_DIGEST=unknown` và không được gọi là staging verified; worker/cloud vẫn chưa bật. Worker/lifecycle chỉ được rehearsal trên database disposable.

## Các nhóm còn lại và trạng thái cutover

| Nhóm | Route/khối | Bằng chứng/ghi chú |
|---|---|---|
| Registration | `/auth/register`, `/auth/register/verify` | **RELATIONAL-V2** — HTTP capture adapter, timeout/retry, redacted health và one-time digest verification đã PASS trên disposable; staging provider thật vẫn là gate riêng. |
| Savings maturity/renewal | scheduled command `RelationalLifecycleService` | **RELATIONAL-V2** — scheduler startup catch-up, poll/batch, row lock, operation key, ledger/audit/outbox, renewal/return và restart catch-up đã có disposable evidence; chưa tự chạy trên preview. |
| Credit settlement/maturity | statement close, overdue, pending/reversal settlement | **RELATIONAL-V2** — scheduler dùng cùng command/operation key, no-overpay, ledger/audit/outbox, overdue/reversal và restart catch-up đã có disposable evidence; chưa tự chạy trên preview. |
| Profile/KYC customer read | `GET/POST /api/v1/kyc/application*` | **RELATIONAL-V2** — customer KYC synthetic-only đã có contract và persistent service; profile fields ngoài KYC vẫn không tự mở thêm. |
| Legacy HTTP writer / route chưa phân loại | bất kỳ route mới nào ngoài boundary | **LEGACY — BLOCKS CUTOVER**; runtime relational-v2 trả `503` và regression test cấm gọi `withState`. |
| Admin read/action | `/admin/*` | **RELATIONAL-V2** qua `AdminRepository`/action engine; không đi qua public `withState`, vẫn cần admin evidence riêng. |

## Cổng chuyển giai đoạn kế tiếp

Không bật `WORKER_ENABLED=1` hoặc staging/cloud chỉ vì các route customer đã direct. Chỉ chuyển sang worker/staging khi:

1. Mọi route trong bảng “còn legacy” đã có owner relational và integration test HTTP.
2. Không còn request path gọi `PostgresRelationalRepository.withState` trong profile relational-v2.
3. Registration/auth/session/MFA, transfer/ledger, savings và credit đều có disposable-DB test, restart test và reconciliation.
4. Chạy được 20 transfer đồng thời, API + 2 worker, restart giữa transaction/outbox và chứng minh không double-debit.
5. Route matrix, migration digest, outbox inventory và skip classification được ghi trong evidence của cùng commit.

## Cách rehearsal lát cắt hiện tại

Chỉ dùng local/disposable database:

```powershell
$env:BANKING_PERSISTENCE_MODE = "relational-v2"
$env:BANKING_RELATIONAL_HTTP_ROUTES = "auth,registration,mfa,accounts,beneficiaries,transfers,savings,credit,recipients,notifications,fraud,kyc"
npm run typecheck
npm run build
npm run test:critical
```

Giá trị này chỉ dành cho local preview; `IMAGE_DIGEST=unknown`, không phải staging evidence và không thay thế worker/cloud cutover gate.

`registration` là group relational-v2; HTTP capture provider chỉ được dùng trong
disposable test. Preview vẫn để `EMAIL_PROVIDER=disabled` nếu chưa có provider
được phê duyệt, khi đó route không còn 503 boundary nhưng sẽ trả lỗi delivery rõ
ràng. Runtime HTTP provider + hai worker + hai scheduler đã chạy qua
`npm run test:integrated:disposable` với migration `001–040`; scheduled commands
không tự chạy trên `banking_preview`.

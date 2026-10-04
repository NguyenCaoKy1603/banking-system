# Sequence các luồng chính — Đợt 2 và phạm vi bàn giao

Các sequence dưới đây là mô hình giải thích dựa trên source/API và evidence Đợt 2.
Chúng không tuyên bố tích hợp ngân hàng thật, provider thanh toán thật hoặc KYC thật.

## 1. Registration và KYC synthetic

```mermaid
sequenceDiagram
  actor C as Customer Mobile
  participant P as Public API
  participant R as Registration/KYC service
  participant U as UnitOfWork
  participant D as PostgreSQL
  participant E as Local email capture
  participant A as Admin Web/API

  C->>P: POST /auth/register
  P->>R: begin registration
  R->>U: transaction
  U->>D: pending registration + challenge digest + outbox intent
  R->>E: synthetic email provider boundary
  E-->>C: OTP available to local test capture
  C->>P: POST /auth/register/verify
  P->>R: verify one-time challenge
  R->>U: complete atomically
  U->>D: customer + empty payment account + completion record
  R-->>C: user/session boundary
  C->>P: POST /kyc/application and /submit
  P->>R: save/submit synthetic KYC
  R->>U: persist lifecycle state
  U->>D: KYC application
  A->>P: claim/review through Admin boundary
```

## 2. Maker–checker và sandbox funding

```mermaid
sequenceDiagram
  actor M as Maker staff
  actor K as Independent checker
  participant W as Admin Web
  participant H as Admin API
  participant E as Action engine
  participant U as UnitOfWork
  participant D as PostgreSQL

  M->>W: Tạo funding request
  W->>H: POST /admin/accounts/{accountId}/funding-requests
  H->>E: authorize + fingerprint + idempotency
  E->>U: persist pending action
  U->>D: action request + audit event
  M->>W: Thử approve request của chính mình
  W->>H: POST /admin/approvals/{requestId}/approve
  H->>E: four-eyes policy
  E-->>M: SELF_APPROVAL_FORBIDDEN
  K->>W: Mở Approval Inbox
  W->>H: approve với session/MFA độc lập
  H->>E: authorize checker + execute once
  E->>U: funding transaction
  U->>D: balance + account transaction + ledger + audit/outbox
  E-->>K: receipt
```

## 3. Transfer nội bộ có quote và step-up

```mermaid
sequenceDiagram
  actor C as Customer Mobile
  participant P as Public API
  participant T as Transfer service
  participant U as UnitOfWork
  participant D as PostgreSQL

  C->>P: POST /internal-recipients/lookup
  P->>T: validate owner + recipient boundary
  T->>D: lookup masked confirmation data
  D-->>T: recipient snapshot
  T-->>C: safe lookup response
  C->>P: POST /transfers/quote
  P->>T: amount + recipient
  T->>U: quote transaction
  U->>D: server-calculated fee + expiry + fingerprint
  T-->>C: quote/review
  C->>P: TOTP step-up then POST /transfers
  P->>T: same payload + Idempotency-Key
  T->>U: one transfer transaction
  U->>D: debit/credit + account history + balanced ledger + audit/outbox
  T-->>C: server-authoritative receipt
  C->>P: GET /transfers/{transferId}
  P-->>C: current status
```

## 4. Evidence boundary

Đợt 2 chứng minh happy path Mobile/Admin Web và các negative controls ở các tầng khác
nhau: service/PostgreSQL disposable cho idempotency, HTTP/PostgreSQL invariant cho
cross-account, policy/service cho self-approval. Không gộp các tầng này thành một E2E
claim duy nhất.

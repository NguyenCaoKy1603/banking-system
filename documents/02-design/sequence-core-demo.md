# Luồng hệ thống hiện tại — request, state, UI và lỗi

> Các sequence mô tả đường đi ở source/reference. Mỗi luồng vẫn cần evidence riêng để kết luận đã chạy ở thiết bị hoặc môi trường nào.

## 1. Internal transfer

~~~mermaid
sequenceDiagram
  actor C as Customer
  participant M as Mobile
  participant API as Public API
  participant S as Transfer service
  participant DB as UnitOfWork/PostgreSQL

  C->>M: Nhập người nhận và số tiền
  M->>API: Lookup/quote với auth + device
  API->>S: Validate owner, recipient, amount
  S->>DB: Tạo quote có expiry/fingerprint
  DB-->>S: Persisted quote
  S-->>API: Quote, fee và dữ liệu review từ server
  API-->>M: Quote, fee và dữ liệu review
  C->>M: Xác nhận và hoàn tất TOTP step-up
  M->>API: Submit quote + Idempotency-Key
  API->>S: Revalidate quote, step-up, idempotency
  S->>DB: Atomic transfer + balance + ledger + audit + outbox
  DB-->>S: Committed status
  S-->>API: Status/receipt authoritative
  API-->>M: Status/receipt
  M-->>C: Success, pending hoặc error/retry state
~~~

Timeout sau submit không được hiểu là thất bại hoặc thành công chắc chắn. Mobile giữ idempotency intent và truy vấn/resume trạng thái từ server. Backend vẫn quyết định số dư, phí, status và reversal.

## 2. KYC và Admin review

~~~mermaid
sequenceDiagram
  actor C as Customer
  participant M as Mobile
  participant API as Public API
  participant K as KYC service
  participant DB as PostgreSQL
  participant A as Admin Web
  participant AA as Admin API
  participant AR as Admin repository

  C->>M: Nhập KYC thử nghiệm
  M->>API: Save draft / submit
  API->>K: Validate identity fields and owner
  K->>DB: Persist application state
  DB-->>K: Persisted state
  K-->>API: DRAFT hoặc SUBMITTED
  API-->>M: Current application state
  A->>AA: Load reviewable case with staff session
  AA->>AR: Read subject and required workflow state
  AR->>DB: Query current state
  A->>AA: Review action with staff session/permission
  AA->>AR: Validate permission and action policy
  AR->>DB: Persist reviewed status + audit
  DB-->>AR: Persisted review state
  AR-->>AA: Review result
  M->>API: Customer reloads current state
  API->>K: Read customer application
  K-->>API: Current review state
  API-->>M: Current application state
~~~

KYC ở đây là workflow synthetic; không có identity verification provider thật. Admin Web/API không dùng customer bearer token.

## 3. Assistant Help

~~~mermaid
sequenceDiagram
  actor C as Customer
  participant M as Mobile
  participant API as Public API
  participant H as AssistantHelpService
  participant O as Radox AI Provider
  participant CAT as Verified answer catalog

  C->>M: Nhập câu hỏi
  M->>API: POST assistant/help
  API->>H: Auth/device/body/deadline checks
  H->>H: Sensitive-input filter
  alt deterministic match
    H->>CAT: Resolve fixed selection ID
    CAT-->>H: Fixed answer
    H-->>API: { answer }
  else provider enabled and selection valid
    H->>O: Ask for one selection ID
    O-->>H: Selector output
    H->>CAT: Validate ID and load fixed answer
    CAT-->>H: Fixed answer
    H-->>API: { answer }
  else provider disabled, timeout, or invalid output
    H-->>API: Structured error
  end
  API-->>M: Answer or retryable error
  M-->>C: Render answer or retry action
~~~

Mô hình AI (Radox) không gửi câu trả lời tự do trực tiếp cho Mobile; Backend kiểm tra selection và lấy nội dung từ catalog. Model-call/evaluation evidence nằm ở [06-security-ai](../06-security-ai/README.md).

## 4. Worker và outbox

~~~mermaid
sequenceDiagram
  participant API as Business API
  participant DB as PostgreSQL
  participant W as Worker
  participant P as Configured provider

  API->>DB: Commit business state and outbox intent atomically
  W->>DB: Claim eligible event with lease
  W->>P: Dispatch using configured fake/disabled adapter
  alt acknowledged
    P-->>W: Result
    W->>DB: Mark delivered / update attempts
  else temporary or permanent failure
    P-->>W: Failure
    W->>DB: Retry schedule or dead-letter record
  end
~~~

Worker phải được bật tường minh và có cutover confirmation; production-like setup cần relational-v2. Không đánh đồng outbox plumbing với email/push thật đã được cấu hình.

## 5. Các trạng thái lỗi phải giữ riêng

| Lỗi | API/Domain | UI nên thể hiện |
| --- | --- | --- |
| Validation | 400/422 hoặc field error theo contract | Lỗi tại trường, giữ input hợp lệ |
| Unauthorized/session expired | 401 | Refresh theo auth policy hoặc yêu cầu đăng nhập lại |
| Step-up denied/expired | Domain conflict/security response | Không submit lại bằng proof cũ; hướng dẫn xác thực lại |
| Rate/concurrency limit | 429 | Chờ theo Retry-After hoặc thử lại thủ công |
| Backend/provider unavailable | 502/503 | Giữ dữ liệu cần thiết, không giả định mutation đã chạy |
| Timeout/network disconnect | 504 hoặc network error | Với mutation: query/resume cùng idempotency key |
| Unknown current transaction state | Pending/unknown | Truy vấn server, không optimistic-update số dư |

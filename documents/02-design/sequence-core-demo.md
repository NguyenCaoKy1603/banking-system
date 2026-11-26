# Luồng hệ thống hiện tại — request, state, UI và lỗi

> Các sequence mô tả đường đi ở source/reference. Mỗi luồng vẫn cần evidence riêng để kết luận đã chạy ở thiết bị hoặc môi trường nào.

## 1. Internal transfer & Anomaly assessment

~~~mermaid
sequenceDiagram
  actor C as Customer
  participant M as Mobile
  participant API as Public API
  participant S as Transfer service
  participant DB as UnitOfWork/PostgreSQL

  C->>M: Nhập người nhận và số tiền (hoặc quét QR/VietQR)
  M->>API: Lookup/quote với auth + device
  API->>S: Validate owner, recipient, amount, daily limit & dynamic fee
  S->>DB: Tạo quote có expiry/fingerprint
  DB-->>S: Persisted quote
  S-->>API: Quote, dynamic fee và dữ liệu review từ server
  API-->>M: Quote, fee và dữ liệu review
  C->>M: Xác nhận và hoàn tất TOTP hoặc Biometric step-up (<= 1M VND)
  M->>API: Submit quote + Idempotency-Key
  API->>S: Revalidate quote, policy (daily limit), step-up, idempotency & anomaly score
  alt Risk CRITICAL chưa confirmHighRisk
    S-->>API: 409 CRITICAL_ANOMALY_BLOCKED
    API-->>M: Cảnh báo chặn / yêu cầu xác nhận rủi ro cao
  else Hợp lệ
    S->>DB: Atomic transfer + balance + ledger + anomaly record (nếu flagged) + audit + outbox
    DB-->>S: Committed status
    S-->>API: Status/receipt + anomalyAssessment
    API-->>M: Status/receipt
    M-->>C: Success, pending hoặc error/retry state
  end
~~~

Timeout sau submit không được hiểu là thất bại hoặc thành công chắc chắn. Mobile giữ idempotency intent và truy vấn/resume trạng thái từ server. Backend vẫn quyết định số dư, phí động (`control_policy`), hạn mức ngày, anomaly score, status và reversal.

## 1.1 Mock NAPAS IBFT Two-Phase Interbank Transfer & Reconciliation

~~~mermaid
sequenceDiagram
  actor C as Customer
  participant M as Mobile
  participant API as Public API
  participant S as Transfer service
  participant N as MockNapasGateway
  participant DB as UnitOfWork/PostgreSQL
  participant W as LifecycleScheduler

  C->>M: Chọn ngân hàng BIN (8 NH VN) & STK đích
  M->>API: POST /external-recipients/lookup
  API->>N: inquireAccount(bankBin, accountNumber)
  N-->>API: Holder name + masked number
  API->>DB: Lưu recipient_lookups (rail=NAPAS_IBFT, TTL 5p)
  M->>API: POST /transfers/quote + POST /transfers (step-up + Idempotency-Key)
  S->>DB: Phase 1: giảm availableMinor, tăng heldMinor, lưu transfer PENDING
  S->>N: settleTransfer(...)
  alt SUCCEEDED
    S->>DB: Phase 2: trừ currentMinor & heldMinor, ghi ledger + SUCCEEDED
  else FAILED
    S->>DB: Phase 2: hoàn availableMinor, giải phóng heldMinor, trạng thái FAILED
  else PENDING (đuôi 8888/8899)
    S-->>API: Trả 202/200 PENDING giữ nguyên heldMinor
    W->>S: reconcilePendingInterbankTransfers()
    S->>N: inquirePendingSettlement(...)
    S->>DB: Hoàn tất SUCCEEDED hoặc hoàn tiền FAILED nguyên tử
  end
~~~

`MockNapasGateway` là cổng mô phỏng tất định phục vụ kiểm thử local; không kết nối mạng NAPAS 247 thật.

## 1.2 Transaction Anomaly Review (Customer ↔ Admin)

~~~mermaid
sequenceDiagram
  actor C as Customer
  participant M as Mobile (/anomalies)
  participant API as Public API
  participant DB as PostgreSQL (transaction_anomalies)
  participant A as Admin Web (Transfers)
  participant AA as Admin API

  M->>API: GET /anomalies
  API->>DB: Đọc cảnh báo thuộc customer
  C->>M: Xác nhận An toàn (CONFIRMED_SAFE) hoặc Báo nghi ngờ (REPORTED_SUSPICIOUS)
  M->>API: POST /anomalies/{id}/acknowledge
  API->>DB: Cập nhật trạng thái + audit (+ notification & outbox nếu nghi ngờ)
  A->>AA: GET /admin/anomalies (transfer.pending.read)
  AA->>DB: Trả hàng đợi cảnh báo bất thường
  A->>AA: POST /admin/anomalies/{id}/resolve (transfer.action.request + Idempotency-Key)
  AA->>DB: Đánh dấu RESOLVED + audit trail
~~~

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
  M->>API: POST /api/v1/assistant/help
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

Worker phải được bật tường minh và có cutover confirmation; production-like setup cần relational-v2. Ngoài outbox dispatch, `RelationalLifecycleScheduler` chạy định kỳ các tác vụ đáo hạn tiết kiệm/suspense, chốt sao kê/quá hạn tín dụng và đối soát giao dịch liên ngân hàng `NAPAS_IBFT` đang `PENDING`. Không đánh đồng outbox plumbing với email/push hay cổng NAPAS thật đã được cấu hình.

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

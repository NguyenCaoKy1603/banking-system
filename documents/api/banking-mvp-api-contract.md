# DRAFT v0.2 — Banking MVP Accounts, Transfers and Reference Products API

> **Trạng thái:** DRAFT, chưa được backend/core-banking partner phê duyệt.
>
> Tài liệu này chốt vocabulary và boundary để Mobile có thể triển khai service layer. Không dùng nó để kết nối tiền thật cho đến khi partner, legal/compliance, authorization policy và OpenAPI chính thức được phê duyệt.

## 1. Quy ước chung

- Base URL giữ theo Auth API contract.
- Mọi endpoint yêu cầu đăng nhập dùng `Authorization: Bearer <accessToken>`.
- Mọi endpoint yêu cầu đăng nhập dùng thêm `X-Device-ID`; server/risk engine dùng header này cho device binding. OpenAPI biểu diễn bearer và `deviceBinding` trong cùng security requirement để client sinh tự động không thể bỏ sót header. Các endpoint Auth chưa có bearer nhưng bind thiết bị khai báo `X-Device-ID` trực tiếp.
- Client gửi `Accept: application/json`; request có body gửi `Content-Type: application/json`.
- `X-Request-ID` do client gửi để trace; server trả `traceId` trong lỗi.
- Mọi số tiền dùng chuỗi số nguyên ở minor unit để tránh floating point. Với VND, `amountMinor` là số đồng không có phần thập phân.
- `cursor` là opaque string; client không tự giải mã hoặc tự tính trang tiếp theo.
- Cursor list tài chính dùng keyset ổn định theo `(occurredAt|issuedAt, id)` và được bind với loại resource/account. Chèn bản ghi mới ở đầu không được làm lặp/bỏ sót trang cũ; cursor khác scope hoặc sai định dạng phải bị từ chối.
- Server là nguồn sự thật cho số dư và trạng thái giao dịch. Mobile không optimistic-update số dư.

Lỗi dùng schema `ApiErrorPayload` trong [auth-api-contract.md](./auth-api-contract.md).

## 2. GET `/mobile/control-policy`

Endpoint yêu cầu bearer authentication và trả chính sách pilot do server/risk engine điều khiển:

```ts
type ControlPolicy = {
  configVersion: string;
  globalKillSwitch: boolean;
  transfersEnabled: boolean;
  allowlisted: boolean;
  maxTransferAmountMinor: string;
  stepUpMethods: Array<"OTP" | "BIOMETRIC">;
  savingsEnabled: boolean;
  savingsAllowlisted: boolean;
  maxSavingsAmountMinor: string;
  savingsStepUpMethods: Array<"OTP" | "BIOMETRIC">;
  creditEnabled: boolean;
  creditAllowlisted: boolean;
  creditPaymentsEnabled: boolean;
  cardControlsEnabled: boolean;
  maxCreditPaymentAmountMinor: string;
  creditPaymentStepUpMethods: Array<"OTP" | "BIOMETRIC">;
  cardUnlockStepUpMethods: Array<"OTP" | "BIOMETRIC">;
  updatedAt: string;
};
```

Mobile phải fail closed cho transfer khi policy không tải được, `globalKillSwitch` bật, customer không nằm trong allowlist hoặc `transfersEnabled` là `false`. Server vẫn là nơi thực thi authorization, limit và risk rule; policy trên mobile không phải security boundary.

## 3. Money và trạng thái

```ts
type Money = {
  currency: "VND";
  amountMinor: string; // digits only, >= 0
};
```

```ts
type TransferStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "REVERSED";
```

Server phải bảo đảm state machine:

```text
PENDING -> SUCCEEDED
PENDING -> FAILED
PENDING -> REVERSED
```

Không cho phép client tự chuyển trạng thái hoặc đánh dấu giao dịch thành công trước khi server/core banking xác nhận.

### 3.1 Client intent recovery — DRAFT

`PENDING` ở trên là trạng thái nghiệp vụ do server trả về. Mobile còn phải giữ một state machine cục bộ riêng để xử lý trường hợp không biết server đã nhận request hay chưa:

| Phase cục bộ | Ý nghĩa | Quy tắc lưu/khôi phục |
| --- | --- | --- |
| `DRAFT_QUOTE` | Có quote nhưng chưa bắt đầu submit | `submitAttempted=false`; được xóa khi quote hết hạn. |
| `SUBMIT_UNKNOWN` | Đã ghi intent trước network call nhưng chưa nhận response đáng tin cậy | Giữ nguyên request fingerprint và `Idempotency-Key` dù quote đã hết hạn; chỉ retry cùng request/key hoặc đối soát, không tạo key mới. |
| `ACCEPTED_PENDING` | Server đã trả operation ID/receipt, trạng thái có thể vẫn `PENDING` | Giữ operation ID; chỉ gọi status endpoint, không submit lệnh mới. |
| `ACCEPTED_TERMINAL` | Server đã trả receipt `SUCCEEDED`, `FAILED` hoặc `REVERSED` | Giữ receipt để crash/restart không làm mất kết quả vừa nhận; chỉ xóa khi người dùng xác nhận kết quả hoặc chủ đích rời luồng. |

Quote TTL chỉ quyết định draft còn được submit lần đầu hay không, không được dùng để xóa `SUBMIT_UNKNOWN`/`ACCEPTED_PENDING`/`ACCEPTED_TERMINAL`. Transfer và Savings intent phải được scope theo `userId`; Credit payment intent phải scope theo cả `userId` và `cardId`. Khóa global legacy chỉ được migrate khi ownership khớp, ghi khóa scoped thành công trước rồi mới xóa legacy. Receipt/opening/payment chỉ hợp lệ khi operation ID tồn tại và khớp; Credit quote còn phải khớp `creditAccountId`/`statementId` của intent. Intent lưu trong SecureStore, không chứa OTP/biometric proof và không được dùng hoặc xóa từ phiên của customer khác. Logout chỉ xóa session/token và không được purge recovery intent; đúng customer khi đăng nhập lại phải resume/reconcile bằng cùng key/operation ID trước khi tạo lệnh mới.

Mobile chỉ giữ `SUBMIT_UNKNOWN` khi outcome thực sự chưa chứng minh được: network/timeout/request abort/response không hợp lệ, lỗi không có HTTP status, HTTP `401`/`408`/`425`/`5xx`, một `429` không có payload chuẩn, hoặc nhóm manual/idempotency cần đối soát (`IDEMPOTENCY_CONFLICT`, `IDEMPOTENCY_STATE_MISSING`, `QUOTE_ALREADY_USED`, `MANUAL_REVIEW_REQUIRED`). Payload chuẩn `429 RATE_LIMITED` là rejection trước khi dispatch và phải quay về draft; các response domain `4xx` có cấu trúc khác cũng là rejection đã biết: Mobile bỏ challenge/proof cũ và quay về draft; lỗi quote/resource stale được reset về bước tạo quote mới.

Ở server, cùng key nhưng khác request fingerprint phải trả `409 IDEMPOTENCY_CONFLICT`, không dùng generic `CONFLICT`. Nếu quote đã được consume nhưng client mất key/response, submit lại cùng `quoteId` bằng key mới phải bind key đó vào operation canonical và trả đúng receipt/opening/payment cũ, kể cả quote đã hết TTL; không chạy lại step-up, ledger, audit hoặc outbox. Nếu idempotency/quote chỉ tới operation không còn tồn tại trong aggregate/core reference, server trả `409 IDEMPOTENCY_STATE_MISSING` để đối soát thay vì trả ghost receipt hay tạo operation mới.

Data flow chuẩn cho transfer, savings opening và credit payment:

```text
quote -> persist DRAFT_QUOTE
      -> persist SUBMIT_UNKNOWN với cùng Idempotency-Key
      -> network submit
         -> không rõ kết quả: giữ SUBMIT_UNKNOWN, retry cùng key
         -> rejection 4xx đã biết: persist DRAFT_QUOTE, bỏ challenge cũ
         -> nhận operation ID + PENDING: persist ACCEPTED_PENDING
         -> nhận receipt terminal: persist ACCEPTED_TERMINAL
      -> GET status chỉ đọc state server
      -> terminal: persist ACCEPTED_TERMINAL và hiển thị receipt
      -> người dùng xác nhận/rời chủ đích: xóa đúng intent scoped
```

## 4. GET `/accounts`

Trả các tài khoản thanh toán mà customer hiện tại được phép xem.

### Response `200 OK`

```ts
type PaymentAccount = {
  id: string;
  displayName: string;
  maskedNumber: string;
  bankName: string;
  currency: "VND";
  availableBalance: Money;
  currentBalance: Money;
  status: "ACTIVE" | "BLOCKED";
  updatedAt: string; // ISO 8601 UTC
};

type AccountsResponse = {
  accounts: PaymentAccount[];
};
```

Account detail trên Mobile chỉ hiển thị `displayName`, nhãn trạng thái nghiệp vụ, hai số dư, `maskedNumber`, tên chủ tài khoản từ phiên đăng nhập, `bankName` và `currency`. `id` chỉ dùng để gọi API/điều hướng nội bộ và không được render; access token, device ID, PIN, OTP, password, ledger journal ID và metadata backend không thuộc dữ liệu hiển thị.

## 5. GET `/accounts/{accountId}/number`

Endpoint reveal riêng cho chủ tài khoản đã xác thực. Số tài khoản đầy đủ không nằm trong response của `GET /accounts`; Mobile chỉ gọi endpoint này khi người dùng bấm `Hiện` hoặc `Sao chép`.

### Response `200 OK`

```ts
type AccountNumberResponse = {
  accountNumber: string; // digits only, 6-34 digits
};
```

Server phải kiểm tra bearer token, device binding và ownership trước khi trả số đầy đủ. Không ghi số tài khoản vào log, telemetry hoặc audit payload; audit chỉ lưu sự kiện reveal và `accountId`.

## 6. GET `/accounts/{accountId}/transactions`

Trả lịch sử giao dịch theo cursor.

Query:

- `cursor`: tùy chọn, opaque string.
- `limit`: tùy chọn, số nguyên từ 1 đến 100; mặc định 20.

### Response `200 OK`

```ts
type Transaction = {
  id: string;
  accountId: string;
  direction: "CREDIT" | "DEBIT";
  amount: Money;
  fee: Money;
  status: TransferStatus;
  description: string;
  counterpartyName: string | null;
  occurredAt: string;
};

type TransactionPage = {
  items: Transaction[];
  nextCursor: string | null;
};
```

`GET /accounts/{accountId}/transactions/{transactionId}` trả `Transaction` kèm:

```ts
type TransactionDetail = Transaction & {
  reference: string;
  createdAt: string;
  completedAt: string | null;
};
```

## 7. Beneficiary directory

`GET /beneficiaries` trả danh bạ người nhận của customer hiện tại:

```ts
type BeneficiariesResponse = {
  items: Beneficiary[];
};
```

`POST /beneficiaries` nhận `displayName`, `accountNumber` và `bankName`, nhưng response chỉ trả `Beneficiary` với `maskedAccountNumber`; raw account number không được lưu/hiển thị ở Mobile.

`PATCH /beneficiaries/{beneficiaryId}` nhận `{ displayName }` để đổi tên. `DELETE /beneficiaries/{beneficiaryId}` xoá người nhận khỏi danh bạ. Mọi thao tác phải kiểm tra ownership và ghi audit event.

### GET `/beneficiaries/{beneficiaryId}`

Tra cứu người nhận đã được customer lưu/được server cho phép dùng.

```ts
type Beneficiary = {
  id: string;
  displayName: string;
  maskedAccountNumber: string;
  bankName: string;
  status: "ACTIVE" | "BLOCKED";
};

type BeneficiaryResponse = {
  beneficiary: Beneficiary;
};
```

## 8. POST `/transfers/quote`

Tạo báo giá có thời hạn trước khi submit chuyển tiền.

### Request

```ts
type TransferQuoteRequest = {
  sourceAccountId: string;
  beneficiaryId: string;
  amount: Money;
};
```

### Response `200 OK`

```ts
type TransferQuote = {
  quoteId: string;
  sourceAccountId: string;
  beneficiary: Beneficiary;
  amount: Money;
  fee: Money;
  totalDebit: Money;
  expiresAt: string;
};
```

Quote hết hạn hoặc sai currency/amount phải bị server từ chối; client không tự tính phí để submit.

## 9. POST `/transfers`

Submit một quote sau step-up authentication.

### Headers bắt buộc

```text
Idempotency-Key: <opaque unique key per user intent>
```

Key của Transfer, Savings opening và Credit payment có tối thiểu 16 ký tự sau khi trim; các command dùng shared parameter (Sandbox Funding, Fraud report, Credit application/activation) có tối thiểu 8 ký tự. Cùng một key và cùng request fingerprint phải trả cùng kết quả cuối cùng; cùng key nhưng body khác phải trả `409 IDEMPOTENCY_CONFLICT`. Mọi map idempotency của customer được scope theo `userId`; hai customer có thể dùng cùng opaque key mà không xung đột. Retry/network timeout không được tạo giao dịch thứ hai.

### Request

```ts
type SubmitTransferRequest = {
  quoteId: string;
  stepUp: {
    method: "OTP" | "BIOMETRIC";
    proof: string; // opaque, không log
    challengeId: string; // one-time challenge bind đúng purpose/resource/fingerprint
  };
};
```

Transfer, Savings opening và mọi Credit command có step-up đều phải gửi `challengeId` do server cấp. Endpoint customer `POST /auth/otp/challenges` chỉ nhận sáu purpose tài chính/thẻ, không cấp `LOGIN` hoặc `REGISTRATION_VERIFY`; tối đa 10 challenge/user/device/phút và challenge mới cùng purpose/resource làm challenge cũ hết hiệu lực. Challenge phải bind đồng thời user, device, purpose, resource và request fingerprint; sai/hết hạn trả `409 STEP_UP_VERIFICATION_FAILED`, còn vượt ngưỡng thử/cấp challenge trả `429 RATE_LIMITED`. `401` chỉ biểu thị bearer/session không hợp lệ, vì client có thể refresh/replay khi gặp mã này và tuyệt đối không được làm vậy chỉ vì OTP/challenge giao dịch sai.

### Response `202 Accepted` hoặc `200 OK`

```ts
type TransferReceipt = {
  transferId: string;
  reference: string;
  status: TransferStatus;
  amount: Money;
  fee: Money;
  createdAt: string;
  updatedAt: string;
};
```

`PENDING` là kết quả hợp lệ. Mobile phải truy vấn trạng thái sau crash/restart thay vì hiển thị thành công.

## 10. GET `/transfers/{transferId}`

Trả `TransferReceipt` mới nhất. Endpoint là nguồn sự thật để resume giao dịch đang xử lý.

## 11. Notifications và fraud reporting

`GET /notifications` trả các notification đã được server ghi nhận cho customer. `POST /notifications/{notificationId}/read` đánh dấu notification đã đọc.

Với notification `TRANSFER`, `resourceId` là `transactionId` và `resourceAccountId` là `accountId` để Mobile mở đúng màn hình chi tiết giao dịch. Với notification không có đích điều hướng, cả hai trường này phải là `null`; Mobile không tự suy diễn hoặc dùng `transferId` làm `transactionId`.

### POST `/fraud-reports` — DRAFT

Endpoint chỉ nhận `accountId`, `transactionId` và `reason` dài 5–1.000 ký tự; field thừa bị từ chối `422`. Header `Idempotency-Key` là bắt buộc, tối thiểu 8 ký tự sau khi trim và được scope theo customer. Server phải kiểm tra ownership trước khi ghi report.

```ts
type FraudReportResponse = {
  reportId: string;
  status: "RECEIVED";
  createdAt: string;
};
```

Cùng key và fingerprint `{accountId, transactionId, normalizedReason}` phải trả cùng `reportId`; cùng key với fingerprint khác trả `409 IDEMPOTENCY_CONFLICT`. Mỗi cặp `{customer, transactionId}` chỉ có tối đa một case `RECEIVED`: request trùng account/transaction/reason với key mới phải bind key mới vào report cũ và không phát thêm audit/outbox; nếu reason khác khi case còn mở thì trả `409 FRAUD_REPORT_ALREADY_EXISTS`. Report, reason, idempotency record, audit event và outbox event phải được lưu bền vững trong cùng transaction. Reason không được đưa vào log, analytics hoặc nội dung notification.

### GET `/fraud-reports/{reportId}` — DRAFT

Trả trạng thái server-authoritative của report thuộc customer hiện tại. Reference hiện chỉ hỗ trợ `RECEIVED`, nghĩa là hệ thống đã lưu yêu cầu, không có nghĩa giao dịch đã bị chặn, hoàn tiền hay điều tra xong. Các trạng thái triage/resolution, SLA và integration với fraud/risk engine thật chưa được phê duyệt và không được Mobile tự suy diễn.

Mobile lưu cùng request, `Idempotency-Key` và receipt cục bộ trước/sau submit để retry cùng key khi timeout và refresh status sau restart. Với `FRAUD_REPORT_ALREADY_EXISTS`, `IDEMPOTENCY_CONFLICT` hoặc rejection `4xx` có cấu trúc, Mobile dọn intent cục bộ sau khi cleanup thành công và cho phép người dùng rời/nhập lại; lỗi không xác định kết quả vẫn giữ intent và retry đúng key. Dữ liệu intent hỏng hoặc SecureStore không đọc được phải fail-closed, không được coi là chưa từng gửi. Việc gửi hoặc đọc `RECEIVED` không phải bằng chứng đã xử lý gian lận.

## 11.1 Credit payment invariants — DRAFT

- Credit application idempotency được scope theo customer. Nếu customer đã có application `PENDING_ACTIVATION`/`ACTIVE` với cùng request fingerprint, key mới được alias vào application canonical và trả cùng `applicationId` mà không phát thêm audit/outbox; fingerprint khác vẫn bị từ chối `409`.
- Chỉ sao kê mới nhất của credit account là payable. Sao kê cũ đã carry-forward là historical; quote/submit trên đó trả `STATEMENT_SUPERSEDED`.
- Mỗi credit account chỉ có tối đa một payment `PENDING`; lệnh mới trả `PAYMENT_PENDING` cho tới khi lệnh cũ terminal.
- Quote và submit đều phải kiểm tra amount không vượt `latestStatement.remainingAmountDue` và `creditAccount.postedOutstanding`; overpay trả `OVERPAYMENT`.
- Settlement phải fail closed với `CREDIT_INVARIANT_VIOLATION` nếu có thể làm dư nợ âm.
- Bất biến sau mỗi transition: `0 <= postedOutstanding <= creditLimit`, `pendingAuthorizations >= 0` và `availableCredit = creditLimit - postedOutstanding - pendingAuthorizations`, đồng thời mọi giá trị không âm.
- `OVERDUE` chỉ áp dụng khi đã qua `dueAt` và `minimumPaymentRemaining > 0`. Đã trả đủ minimum nhưng chưa trả hết phải là `PARTIALLY_PAID`, không phải delinquent.
- Payment/reversal phải tính lại `paidAmount`, `remainingAmountDue` và `minimumPaymentRemaining` từ các payment `SUCCEEDED` đã apply, không cộng/trừ mù trên snapshot.

Đây là rule của Credit sandbox; interest, fee, allocation nhiều nghĩa vụ, dispute và regulatory treatment vẫn cần product/legal/partner phê duyệt.

## 11.2 GET read-only và worker lifecycle — DRAFT target

Public GET không được là tác nhân tạo hoặc settle nghĩa vụ tài chính. Contract đích:

```text
POST command -> persist PENDING + idempotency record
worker/core callback -> atomic terminal transition + ledger + audit + outbox
GET status/list/detail -> chỉ đọc state đã persist
```

Các job tối thiểu cần khóa/idempotency riêng theo aggregate và kỳ xử lý: transfer settlement, savings opening settlement, savings maturity/renewal, credit payment settlement, credit statement close và overdue evaluation. Retry worker không được post ledger lần hai; crash giữa core call và state update phải có reconciliation/resume. Savings reconciliation phải đối chiếu cả hai chiều deposit ↔ liability, phát hiện liability mồ côi/deposit thiếu liability và kiểm tra renewal chain một-một cùng số tiền chuyển tiếp. Bất kỳ sai lệch nào cũng làm health `degraded`. Clock, `Asia/Ho_Chi_Minh`, holiday/business-day rule và rate snapshot phải là input được version hóa.

Reference hiện tại đã tách mutation khỏi public Savings/Credit GET. Các fixture/scheduled command công khai cũ đã bị loại bỏ; worker và Admin action four-eyes là đường vận hành/recovery duy nhất trong phạm vi P0. Phần còn mở là durable scheduler cho toàn bộ lifecycle, job ownership/lease ở staging, core callback, retry/backoff quy mô lớn và monitoring. Vì vậy read-only boundary đã có ở domain reference nhưng worker lifecycle vẫn là target DRAFT; chưa được tuyên bố pilot/production-ready.

## 12. Quy tắc server bắt buộc trước pilot

- Authorization, hạn mức, velocity/risk rule và step-up policy phải thực thi ở server.
- Core banking là nguồn sự thật; transfer service dùng adapter, không tự làm ledger thứ hai.
- Ghi immutable audit event cho quote, step-up, submit, state transition và reversal.
- Dùng outbox để phát notification và reconciliation để đối soát với core banking.
- Không trả token, password, step-up proof hoặc dữ liệu nhạy cảm trong log/analytics.
- Contract chính thức phải được partner và legal/compliance review trước khi chuyển trạng thái từ DRAFT sang APPROVED.

## Account number reveal clarification - 2026-08-15

Danh sach tai khoan va Home mac dinh chi hien `maskedNumber`. Khi nguoi dung chu dong bam `Hien day du` hoac `Sao chep`, Mobile goi `GET /accounts/{accountId}/number` de nhan va dung full account number tam thoi; khong suy dien full number tu 4 so cuoi va khong luu vao session. Endpoint nay khong tra UUID/noi dung ky thuat.

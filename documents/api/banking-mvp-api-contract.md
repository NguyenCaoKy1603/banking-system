# DRAFT v0.1 — Banking MVP Accounts and Transfers API

> **Trạng thái:** DRAFT, chưa được backend/core-banking partner phê duyệt.
>
> Tài liệu này chốt vocabulary và boundary để Mobile có thể triển khai service layer. Không dùng nó để kết nối tiền thật cho đến khi partner, legal/compliance, authorization policy và OpenAPI chính thức được phê duyệt.

## 1. Quy ước chung

- Base URL giữ theo Auth API contract.
- Mọi endpoint yêu cầu đăng nhập dùng `Authorization: Bearer <accessToken>`.
- Mọi endpoint yêu cầu đăng nhập dùng thêm `X-Device-ID`; server/risk engine dùng header này cho device binding.
- Client gửi `Accept: application/json`; request có body gửi `Content-Type: application/json`.
- `X-Request-ID` do client gửi để trace; server trả `traceId` trong lỗi.
- Mọi số tiền dùng chuỗi số nguyên ở minor unit để tránh floating point. Với VND, `amountMinor` là số đồng không có phần thập phân.
- `cursor` là opaque string; client không tự giải mã hoặc tự tính trang tiếp theo.
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

## 4. GET `/accounts`

Trả các tài khoản thanh toán mà customer hiện tại được phép xem.

### Response `200 OK`

```ts
type PaymentAccount = {
  id: string;
  displayName: string;
  maskedNumber: string;
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

## 5. GET `/accounts/{accountId}/transactions`

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

## 6. Beneficiary directory

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

## 7. POST `/transfers/quote`

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

## 8. POST `/transfers`

Submit một quote sau step-up authentication.

### Headers bắt buộc

```text
Idempotency-Key: <opaque unique key per user intent>
```

Cùng một key và cùng request fingerprint phải trả cùng kết quả cuối cùng; cùng key nhưng body khác phải trả `409 Conflict`. Retry/network timeout không được tạo giao dịch thứ hai.

### Request

```ts
type SubmitTransferRequest = {
  quoteId: string;
  stepUp: {
    method: "OTP" | "BIOMETRIC";
    proof: string; // opaque, không log
  };
};
```

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

## 9. GET `/transfers/{transferId}`

Trả `TransferReceipt` mới nhất. Endpoint là nguồn sự thật để resume giao dịch đang xử lý.

## 10. Notifications và fraud reporting

`GET /notifications` trả các notification đã được server ghi nhận cho customer. `POST /notifications/{notificationId}/read` đánh dấu notification đã đọc.

Với notification `TRANSFER`, `resourceId` là `transactionId` và `resourceAccountId` là `accountId` để Mobile mở đúng màn hình chi tiết giao dịch. Với notification không có đích điều hướng, cả hai trường này phải là `null`; Mobile không tự suy diễn hoặc dùng `transferId` làm `transactionId`.

`POST /fraud-reports` nhận `accountId`, `transactionId` và `reason`; server phải kiểm tra ownership, ghi immutable audit event và đẩy sự kiện tới fraud/risk workflow. Mobile không coi việc gửi report là bằng chứng đã xử lý gian lận.

## 11. Quy tắc server bắt buộc trước pilot

- Authorization, hạn mức, velocity/risk rule và step-up policy phải thực thi ở server.
- Core banking là nguồn sự thật; transfer service dùng adapter, không tự làm ledger thứ hai.
- Ghi immutable audit event cho quote, step-up, submit, state transition và reversal.
- Dùng outbox để phát notification và reconciliation để đối soát với core banking.
- Không trả token, password, step-up proof hoặc dữ liệu nhạy cảm trong log/analytics.
- Contract chính thức phải được partner và legal/compliance review trước khi chuyển trạng thái từ DRAFT sang APPROVED.

# Contract API và Runtime Validation — Financial Advice

> API/contract hiện ở trạng thái Draft cho đồ án. Runtime source và OpenAPI được đối chiếu bằng targeted cross-contract tests; phiên bản catalog hiện tại là `fa-catalog-v2`. Điều này không phải xác nhận triển khai HTTP từ Mobile tới Backend trong môi trường chạy thật.

## 1. Thông số Endpoint

- **Path**: `POST /api/v1/assistant/financial-advice` (trong OpenAPI là `/assistant/financial-advice`)
- **Headers bắt buộc**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <accessToken>`
  - `X-Device-ID: <deviceId>`
  - `X-Request-ID: <requestId>`
- **Response Headers**:
  - `Cache-Control: no-store`
  - `Content-Type: application/json`
  - `X-Request-ID: <requestId>`
- **Body Limit**: Tối đa 8.192 bytes.
- **Mã tiền tệ**: `VND`.

---

## 2. Request Contract

### 2.1. Cấu trúc chung (Common fields)
- `schemaVersion`: `"1"` (bắt buộc)
- `kind`: `"SAVINGS_PLAN"` hoặc `"BUDGET_BALANCE"` (bắt buộc)
- `currency`: `"VND"` (bắt buộc)
- `monthlyIncomeMinor`: chuỗi chữ số nguyên không âm (`/^(?:0|[1-9]\d*)$/`, max 1.000.000.000.000)
- `essentialExpensesMinor`: chuỗi chữ số nguyên không âm
- `flexibleExpensesMinor`: chuỗi chữ số nguyên không âm
- `monthlyDebtPaymentsMinor`: chuỗi chữ số nguyên không âm (khoản trả nợ định kỳ tháng)
- `monthlyBufferMinor`: chuỗi chữ số nguyên không âm (khoản muốn giữ lại tháng)
- `preference`: `"KEEP_TARGET"` | `"KEEP_CURRENT_SPENDING"` | `"BALANCED"`
- `inputConfirmed`: `true` (người dùng xác nhận số liệu)

### 2.2. Nhánh riêng: `SAVINGS_PLAN`
- `goal`:
  - `targetAmountMinor`: chuỗi chữ số nguyên > 0
  - `alreadySavedMinor`: chuỗi chữ số nguyên >= 0
  - `months`: số nguyên 1 đến 120

### 2.3. Nhánh riêng: `BUDGET_BALANCE`
- `monthlySavingsTargetMinor`: chuỗi chữ số nguyên >= 0

---

## 3. Response Contract

### 3.1. Các trường chung (Root level)
- `schemaVersion`: `"1"`
- `kind`: `"SAVINGS_PLAN"` hoặc `"BUDGET_BALANCE"`
- `currency`: `"VND"`
- `source`: `"USER_ENTERED"`
- `calculationVersion`: `"fa-calc-v1"`
- `catalogVersion`: `"fa-catalog-v2"`
- `budgetStatus`: `"DEFICIT"` | `"BALANCED"` | `"SURPLUS"`
- `options`: mảng 1 đến 4 phần tử Candidate Option:
  - `id`: chuỗi OptionId
  - `title`: tiêu đề hiển thị
  - `description`: mô tả chi tiết
  - `changes`: chi tiết thay đổi (object)
- `preferredOptionId`: ID phương án được ưu tiên lựa chọn
- `explanation`:
  - `mode`: `"AI_ASSISTED"` | `"RULE_BASED"`
  - `reasonIds`: mảng 1 đến 3 ReasonId
  - `paragraphs`: mảng các đoạn văn giải thích do Backend render
  - `fallbackReason`: `null` (nếu AI_ASSISTED) hoặc enum (`"AI_DISABLED"` | `"PROVIDER_UNAVAILABLE"` | `"PROVIDER_TIMEOUT"` | `"PROVIDER_INVALID_OUTPUT"` | `"PROVIDER_BUDGET_EXHAUSTED"`)
- `assumptions`: mảng chuỗi giả định bắt buộc
- `warnings`: mảng đối tượng `{ code: string, message: string }`

### 3.2. Metrics riêng theo `kind`
- `SAVINGS_PLAN`:
  - `goalStatus`: `"ALREADY_FUNDED"` | `"FEASIBLE"` | `"GAP"` | `"NO_CAPACITY"`
  - `metrics`:
    - `declaredOutgoingsMinor`: chuỗi không âm
    - `unallocatedBeforeBufferMinor`: chuỗi có thể âm (`SignedMinor`)
    - `capacityAfterBufferMinor`: chuỗi có thể âm (`SignedMinor`)
    - `bufferShortfallMinor`: chuỗi không âm
    - `remainingGoalMinor`: chuỗi không âm
    - `requiredMonthlySavingsMinor`: chuỗi không âm
    - `monthlyGapMinor`: chuỗi không âm
    - `achievableGoalAtDeadlineMinor`: chuỗi không âm
    - `suggestedMonths`: number (0-120) hoặc null
    - `horizonExceeded`: boolean
- `BUDGET_BALANCE`:
  - `savingsTargetStatus`: `"MET"` | `"GAP"`
  - `metrics`:
    - `declaredOutgoingsMinor`: chuỗi không âm
    - `unallocatedBeforeBufferMinor`: chuỗi có thể âm (`SignedMinor`)
    - `capacityAfterBufferMinor`: chuỗi có thể âm (`SignedMinor`)
    - `maximumSavingsAtCurrentBudgetMinor`: chuỗi không âm
    - `targetGapMinor`: chuỗi không âm
    - `remainingAfterTargetMinor`: chuỗi có thể âm (`SignedMinor`)
    - `baseDeficitMinor`: chuỗi không âm
    - `bufferShortfallMinor`: chuỗi không âm

---

## 4. Bảng mã lỗi (Error Contract)

| HTTP Status | Code | Diễn giải |
| --- | --- | --- |
| 401 | UNAUTHORIZED | Access token không hợp lệ hoặc hết hạn |
| 413 | FINANCIAL_ADVICE_BODY_TOO_LARGE | Kích thước payload vượt quá 8.192 bytes |
| 415 | UNSUPPORTED_MEDIA_TYPE | Content-Type không phải application/json |
| 422 | VALIDATION_ERROR | Dữ liệu đầu vào sai định dạng, thiếu trường hoặc vi phạm giới hạn |
| 429 | RATE_LIMITED | Quá giới hạn tần suất gọi API (5 req/phút/user) |
| 503 | FINANCIAL_ADVICE_UNAVAILABLE | Tính năng chưa được kích hoạt (`FINANCIAL_ADVICE_ENABLED=0`) |
| 504 | FINANCIAL_ADVICE_TIMEOUT | Quá thời gian chờ xử lý request |
| 500 | INTERNAL_ERROR | Lỗi máy chủ không xác định |

# Kế hoạch và Ma trận Kiểm thử — Financial Advice

> **Execution/reconciliation NFA-05/NFA-06 (2026-10-04):** Đã đối chiếu lại ba report JSON và ba Markdown mà không gọi provider; cùng source manifest 19 file, mọi manifest hash khớp workspace. Live results vẫn là 16/16 schema/semantic/metrics/candidate/public passes, 15/16 strict preferred matches, Qwen 16/16 và charged 16/16. B-01 là runtime-valid nhưng lệch preferred oracle; threshold quyết định chưa có. Offline service-only exact B-01 cho `RULE_BASED/AI_DISABLED` và fallback `ADJUST_SAVINGS_TARGET`; không nâng thành Web evidence. Isolated fixture đã được bổ sung limiter dùng chung help/advice với cap hai charge và counter attempt-at-boundary/charged; typecheck, build và targeted isolated suite PASS 7/7. Fake-provider test chứng minh call thứ ba bị chặn trước provider. Listener task-owned đã được restart; startup báo cap hai lượt và 0 charge, nhưng chưa có route-level Web evidence. NFA-04 Web W01–W03/W04 chỉ giữ attribution của lần quan sát trước; S-01/B-01 live Web, W05–W08 và browser network trace vẫn thiếu. W05–W08 không được đánh dấu Web PASS từ unit/integration tests. Evidence local cũ (Backend 82/82, assistant 74/74, critical 13/13; Mobile targeted 38/38, Jest 470/470 và typecheck/lint/OpenAPI/export gates) không được tính là chạy lại phiên này. Web export không phải browser E2E; emulator/device/remote CI vẫn NOT_RUN. Build regression `TS6059` trước đó được sửa bằng module report thuần trong `src` và CLI mỏng.

> **W05–W08 offline regression run (2026-10-04):** Backend `financialAdviceHttp.test.ts` + `financialAdviceService.test.ts` + `financialAdviceIsolatedDemo.test.ts`: **41/41 PASS**. Mobile `FinancialAdviceScreen.test.tsx` + `financialAdviceApi.test.ts` + `FinancialAdviceReauthentication.integration.test.tsx`: **3 suites / 22/22 PASS**. W05: double-submit và stale response/session epoch; W06: 429 retry affordance + network-error mapping; W07: real AuthProvider/protected route composition with fake Fetch; W08: fake-provider invalid-selector fallback, shared quota và task cap. Các nhánh này là component/API/in-process HTTP/integration evidence; manual Web W05–W08 vẫn `NOT_RUN`, backend stopped browser flow chưa chạy. Không có Qwen/PostgreSQL.

> **Execution record NFA-01–03, 2026-10-03:** NFA-01 HTTP boundary suite `node --import=tsx --test src/tests/financialAdviceHttp.test.ts` PASS 18/18, gồm H-01..H-06; NFA-02 targeted Mobile reauthentication run PASS 4/4 trong 2 suites, với AuthProvider/Expo `Stack.Protected` thật và Fetch seam giả; NFA-03 Backend `npm run typecheck` PASS và `node --import=tsx --test src/tests/financialAdviceIsolatedDemo.test.ts src/tests/financialAdviceEvaluation.test.ts` PASS 23/23. Trong 23 có 5 test aggregate NFA-03-AGG-01..05 và 6 test cấu hình isolated launcher, các test còn lại là regression evaluation hiện có. Không có DB, socket, Ollama request hoặc provider call trong các kiểm tra này. Chưa chạy isolated launcher/Web qua HTTP, chưa gọi Qwen, chưa chạy emulator/device hoặc remote CI. Các kết quả NFA-01/02 là evidence đã có trong cùng execution task nhưng không được tính là lệnh vừa chạy ở lượt NFA-03.

## 1. Mục tiêu kiểm thử

Kiểm tra phép tính BigInt và tính bất biến của dữ liệu qua các tầng xử lý; kiểm tra ranh giới AI selector, semantic validation, fallback, vòng đời Mobile và tương thích OpenAPI Draft trong các ca đã định nghĩa. Kết quả test không phải bảo đảm tuyệt đối ngoài phạm vi được chạy.

---

## 2. Ma trận kiểm thử các tầng (Test Pyramid)

### 2.1. Tầng 1: Tính toán tài chính xác định (Backend Calculation Suite)
- **File**: `backend/src/tests/financialAdviceCalculation.test.ts`
- **Các ca kiểm thử**:
  - `S-01`: Ca tiêu chuẩn mục tiêu tiết kiệm có Gap (GAP).
  - `S-02`: Ca mục tiêu tiết kiệm khả thi (FEASIBLE), dư dả thặng dư.
  - `S-03`: Ca mục tiêu tiết kiệm vừa khít năng lực (C = Q).
  - `S-04`: Mục tiêu đã đủ tiền ngay từ đầu (ALREADY_FUNDED, A = T).
  - `S-05`: Tiền đã dành vượt mục tiêu (A > T, không âm remainingGoal).
  - `S-06`: Đã đủ mục tiêu nhưng ngân sách sinh hoạt thâm hụt (DEFICIT).
  - `S-07`: Không còn khả năng tiết kiệm (C = 0, NO_CAPACITY).
  - `S-08`: Ngân sách thâm hụt nặng (S < 0, C < 0).
  - `S-09`: Không có thu nhập và chi phí (Zero input).
  - `S-10`: Làm tròn ceilDiv đúng (R = 10, H = 3 => Q = 4).
  - `S-11`: Thời gian hoàn thành vượt trần 120 tháng (`suggestedMonths: null`, `horizonExceeded: true`).
  - `S-12`: Thời gian hoàn thành vừa đúng 120 tháng.
  - `S-13`: Phương án giảm chi phí linh hoạt vừa vặn (J <= F).
  - `S-14`: Thiếu lớn hơn chi phí linh hoạt (J > F => không tạo option giảm F ảo).
  - `S-15`: Thặng dư cơ bản nhưng không đủ tiền giữ lại (bufferShortfall > 0).
  - `S-16`: Số tiền chạm ngưỡng cận trên 1.000.000.000.000 VND không bị tràn số.
  - `S-17` - `S-19`: Fallback lựa chọn ưu tiên theo preference (KEEP_TARGET, KEEP_CURRENT_SPENDING, BALANCED).
  - `S-20`: Bất biến tính toán (Frozen input, deterministic output).
  - `B-01` - `B-14`: Các ca kiểm thử tương ứng cho nghiệp vụ cân đối ngân sách (BUDGET_BALANCE).

### 2.2. Tầng 2: Validation dữ liệu đầu vào (Backend Input Validation)
- Các ca kiểm tra V-01 đến V-18:
  - Missing field, unknown field, invalid types, negative numbers, decimal points, non-canonical format (như 0123), exceeding bounds, confirmation missing/false, currency khác VND, schemaVersion khác "1".
  - Chi tiêu vượt thu nhập: VALID (đây là tình huống tài chính cần tư vấn, không phải lỗi validation).

### 2.3. Tầng 3: AI Service, Selector & Fallback (Service Suite)
- **File**: `backend/src/tests/financialAdviceService.test.ts`
- **Các ca kiểm thử**:
  - `A-01`: Provider trả về JSON chuẩn, chọn option hợp lệ => `AI_ASSISTED`.
  - `A-02`: Provider trả về text/markdown fence ngoài JSON => fallback `RULE_BASED/PROVIDER_INVALID_OUTPUT`.
  - `A-03`: Provider trả về duplicate key hoặc unknown key => reject selector, fallback an toàn.
  - `A-04`: Model chọn option ID nằm ngoài candidate list => fallback an toàn.
  - `A-05`: Model chọn reason ID không thỏa mãn điều kiện logic => fallback an toàn.
  - `A-06`: Reason ID trùng lặp hoặc vượt quá 3 => fallback an toàn.
  - `A-07`: `finishReason !== "stop"` hoặc phát hiện `tool_calls` => reject, fallback an toàn.
  - `A-08`: Provider timeout / ném ngoại lệ => fallback `RULE_BASED/PROVIDER_TIMEOUT` hoặc `PROVIDER_UNAVAILABLE`.
  - `A-09`: Provider phớt lờ AbortSignal và resolve trễ => không ghi đè kết quả.
  - `A-10`: Hết quota 10 calls => fallback `RULE_BASED/PROVIDER_BUDGET_EXHAUSTED`.
  - `A-11`: Feature enabled nhưng Assistant AI disabled => `RULE_BASED/AI_DISABLED`.
  - `A-13`: Tính bất biến của Metrics: Cùng một input, metrics và options sinh ra giữa AI thành công và Fallback là hoàn toàn đồng nhất (`deepEqual`).
  - `A-16`: Prompt Context Inspector: Không gửi token, headers hay PII của người dùng sang cho AI.

### 2.4. Tầng 4: HTTP Route & Boundary (HTTP Suite)
- **File**: `backend/src/tests/financialAdviceHttp.test.ts`
- **Các ca kiểm thử**:
  - `H-01`: Request hợp lệ trả về HTTP 200, `Cache-Control: no-store`, `X-Request-ID`.
  - `H-02`: Thiếu Bearer Token => 401.
  - `H-03`: Thiếu hoặc sai Device ID => 401/422.
  - `H-04`: Token hết hạn / session thu hồi => 401.
  - `H-05`: Content-Type khác application/json => 415.
  - `H-06`: Payload lớn hơn 8.192 bytes => 413.
  - `H-07`: Method khác POST hoặc sai path segment => 404.
  - `H-08`: Request invalid 422 không tiêu tốn quota của Provider.
  - `H-09`: Rate limiter hoạt động đúng (429 khi vượt quá 5 req/phút).
  - `H-11`: Cờ `FINANCIAL_ADVICE_ENABLED=0` => 503 `FINANCIAL_ADVICE_UNAVAILABLE`.
  - `H-13` - `H-15`: Persistent sandbox không kích hoạt `withState` transaction và không gọi bất kỳ mutation tiền tệ nào.
  - `H-16`: Kiểm tra hồi quy `/assistant/help` hoạt động bình thường, không bị ảnh hưởng.

### 2.5. Tầng 5: Client / Mobile Feature (Component, API & Lifecycle)
- **Files hiện có**:
  - `mobile-app/src/features/financial-advice/__tests__/financialAdviceApi.test.ts`
  - `mobile-app/src/features/financial-advice/__tests__/financialAdviceValidators.test.ts`
  - `mobile-app/src/features/financial-advice/__tests__/FinancialAdviceScreen.test.tsx`
- **Các ca kiểm thử**:
  - Validation client, parsing canonical integer, phân biệt rõ ô rỗng với số 0.
  - Form state: EDITING -> SUBMITTING -> SUCCESS -> EDITING.
  - Chống double-submit (disable button khi đang gửi).
  - Hiển thị đầy đủ thẻ Metrics, trạng thái (Surplus/Deficit, Gap/Feasible), định dạng VND âm/dương.
  - Hiển thị nhãn minh bạch giữa AI_ASSISTED và RULE_BASED.
  - Race conditions & Session Epoch:
    - Khi logout/relogin, `sessionEpoch` thay đổi, kết quả cũ bị hủy bỏ hoàn toàn (`generation guard`).
    - Unmount màn hình khi request đang chạy kích hoạt `AbortController.abort()`.

Lưu ý evidence: suite hiện chạy trong Jest/component/API seams. Shared Expo `Stack.Protected` re-auth integration test hiện có là route regression ở module Trợ lý; riêng luồng 401 của Financial Advice mới có component test gọi `logout()`. Một integration-test attempt riêng cho Financial Advice gọi logout và các storage/revoke seams, nhưng không xác nhận được màn login vì harness gặp `Couldn't find a navigation context`; hiện chưa phân định được đó là giới hạn harness hay tích hợp route. Vì vậy không gộp hai evidence hiện có thành claim end-to-end, cũng không coi attempt này là product PASS/FAIL.

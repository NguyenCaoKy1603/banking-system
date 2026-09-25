# BÁO CÁO BÀN GIAO TOÀN DIỆN PHẦN OFFLINE: TRỢ LÝ HƯỚNG DẪN ỨNG DỤNG NOVA

**Mã tài liệu:** `documents/06-security-ai/assistant-offline-handoff.md`  
**Phiên bản:** v1.0.0  
**Ngày lập:** 2026-09-22  
**Trạng thái nghiệm thu:** Hoàn thành phần offline (Offline Scope Completed)  
**Phạm vi:** Trợ lý hướng dẫn sử dụng ứng dụng NOVA (Phần 4, Phần 5, Phần 6)  
**Môi trường:** Local Academic Sandbox (Node.js v24, TypeScript v5.8, Windows 11)  

---

## 1. Mục đích và Giới hạn Chức năng

Trợ lý NOVA là tính năng hỗ trợ người dùng tra cứu thao tác trên ứng dụng di động ngân hàng NOVA dựa trên tri thức đóng gói chuẩn hóa từ 20 mục FAQ (`documents/06-security-ai/assistant-help-faq.md` Phần A) và System Prompt (`documents/06-security-ai/assistant-system-prompt.md`).

### Giới hạn chức năng bắt buộc:
- **Chỉ hướng dẫn thao tác (Read-only Guidance)**: Trợ lý KHÔNG thực hiện thay bất kỳ giao dịch tài chính nào (chuyển tiền, khóa thẻ, mở sổ tiết kiệm).
- **Không truy cập dữ liệu cá nhân (Zero-PII Access)**: Trợ lý không biết số dư, số tài khoản, danh bạ hay lịch sử giao dịch của người dùng.
- **Không yêu cầu hay nhận thông tin bảo mật (Zero-Secret Harvesting)**: Tuyệt đối không yêu cầu người dùng gửi OTP, mã PIN, mật khẩu qua khung chat.
- **Hoạt động phi trạng thái (Stateless)**: Mỗi câu hỏi được xử lý độc lập, không lưu lịch sử hội thoại trước đó.
- **Phạm vi triển khai hiện tại: Hoàn toàn Offline**:
  - KHÔNG kết nối OpenAI API hoặc bất kỳ dịch vụ AI/LLM ngoài nào.
  - KHÔNG sử dụng vector database hay RAG trực tuyến.
  - Sử dụng `FakeAssistantHelpProvider` với các kịch bản synthetic để phục vụ kiểm thử đơn vị, kiểm thử tích hợp HTTP và bộ đánh giá benchmark offline.

---

## 2. Các Thành phần Đã Triển khai

Hệ thống trợ lý offline được xây dựng đồng bộ từ tầng tri thức, tầng logic dịch vụ, tầng HTTP endpoint đến bộ đánh giá benchmark 56 ca:

### 2.1. Tầng Tri thức & Đóng gói (`backend/src/assistant/`)
- `knowledgeBundle.ts`: Chứa tri thức nhúng tĩnh gồm System Prompt (phiên bản `help-prompt-v0.3`) và 20 mục FAQ Phần A (`help-faq-v0.2`), kèm mã băm SHA-256 đối chiếu và danh sách 20 FAQ ID duy nhất.
- `knowledgeLoader.ts`: Trình nạp tri thức an toàn (`loadKnowledge()`), thực hiện kiểm tra runtime tính toàn vẹn (đủ 20 FAQ ID, không trùng lặp, không chứa các phần developer B/C/D).
- `knowledgeSync.ts`: Tiện ích kiểm tra tính đồng bộ dev-time giữa Markdown nguồn trong `documents/06-security-ai/` và bundle nhúng tĩnh trong mã nguồn.
- `scripts/bundle-assistant-knowledge.ts`: Script trích xuất và sinh tự động `knowledgeBundle.ts` từ file Markdown gốc khi có cập nhật.

### 2.2. Tầng Logic & Bảo vệ Dịch vụ
- `helpConfig.ts`: Cấu hình dịch vụ (cờ `enabled`, quota rate limit, timeout provider, request deadline).
- `helpProvider.ts`: Interface `AssistantHelpProvider` và bộ giả lập `FakeAssistantHelpProvider` hỗ trợ 8 chế độ kiểm thử (`success`, `empty`, `invalid_type`, `error`, `timeout_hang`, `truncated_or_oversized`, `tool_call_request`, `spy_recorder`).
- `helpService.ts`: Điều phối thực thi nghiệp vụ, kiểm tra cờ tắt/bật (503), nạp tri thức, quản lý deadline & timeout qua `AbortController`, lọc dữ liệu trả về qua Output Guard (chỉ chấp nhận `finishReason === "stop"`).
- `rateLimiter.ts`: `AssistantRateLimiter` quản lý giới hạn tần suất gọi (sliding window per-user) và kiểm soát số luồng đồng thời (concurrency slot per-user và global).
- `sensitiveDataFilter.ts`: Bộ lọc phát hiện secret trong câu hỏi người dùng (mật khẩu, OTP 6 số, PIN) và từ chối fail-closed.
- `streamReader.ts`: Bộ đọc stream request an toàn với giới hạn byte trần (mặc định 8 KiB), dừng tích lũy và phản hồi 422 khi vượt ngưỡng.

### 2.3. Tầng HTTP Endpoint (`backend/src/http.ts`)
- Định tuyến `POST /api/v1/assistant/help`:
  - Phân luồng sớm trước bộ đọc body chung của backend.
  - Xác thực Bearer token và ràng buộc `X-Device-ID`.
  - Deadline toàn request tính từ thời điểm nhận kết nối socket, bao phủ cả quá trình xác thực auth.
  - Phản hồi chuẩn RFC: HTTP 200 `{ answer }` với `Cache-Control: no-store` và header tracking `X-Request-ID`, `X-Trace-ID`.
  - Mã lỗi chuẩn: 400 (Bad Request), 401 (Unauthorized), 404 (Not Found cho sub-path), 405 (Method Not Allowed), 415 (Unsupported Media Type), 422 (Unprocessable Content), 429 (Rate Limit Exceeded kèm `Retry-After`), 502 (Provider Error), 503 (Assistant Disabled/Unavailable), 504 (Request Timeout).

### 2.4. Bộ Đánh giá Benchmark Offline 56 Ca (`backend/src/tests/assistantEvaluation/`)
- `types.ts`: Định nghĩa kiểu dữ liệu cho Evaluation Case, Rubric, Scorer Condition, Evaluation Result và Báo cáo.
- `dataset.ts`: 56 ca kiểm thử chuẩn hóa từ `assistant-help-faq.md` Phần C (40 POS gồm 20 câu gốc + 20 câu diễn đạt lại, 12 NEG hiểu lầm & phủ định, 4 EXTRA tình huống biên).
- `fixtures.ts`: Bộ 56 câu trả lời synthetic chuẩn mực và các câu đối chứng vi phạm để kiểm thử fail-closed của scorer.
- `scorer.ts`: Engine chấm tự động 4 tiêu chuẩn cốt lõi:
  1. `C1_NAVIGATION`: Đúng tab, màn hình và nhãn nút bấm.
  2. `C2_BUSINESS_CONDITIONS`: Giữ vững 12 điều kiện nghiệp vụ cốt lõi.
  3. `C3_NO_HALLUCINATION`: Không bịa đặt số dư, phí cố định hay quy trình ngoài tài liệu.
  4. `C4_NO_SECRET_HARVESTING`: Không xin hay nhận secret của người dùng.
  - Có cơ chế chống false-positive đối với ngữ cảnh phủ định an toàn ("Tuyệt đối không gửi mã OTP").
- `runner.ts`: Trình chạy offline 56 ca, bảo đảm nguyên tắc Zero-Leakage (không đưa rubric vào context provider), tính xác định (deterministic) và tách biệt rõ ranh giới giữa kiểm tra máy (Mechanical Checks) và rà soát ngữ nghĩa (Semantic Review).
- `scripts/evaluate-assistant.ts`: CLI thực thi runner và xuất báo cáo Markdown / JSON.

---

## 3. Luồng Xử lý Dữ liệu Chi tiết

```
[Client App]
     │
     ▼ (POST /api/v1/assistant/help)
[HTTP Early Routing] ──(Kiểm tra path, method, Origin CORS, Content-Type 415)
     │
     ▼
[Request Deadline Timer] ──(Kích hoạt timer deadline toàn request)
     │
     ▼
[Stream Byte Guard] ──(Đọc body với giới hạn trần 8 KiB; vượt ngưỡng -> 422)
     │
     ▼
[Authentication & Access Check] ──(Xác thực Bearer token, deviceId, kiểm tra khóa tài khoản)
     │
     ▼
[Sensitive Data Filter] ──(Phát hiện mật khẩu/OTP thô trong question -> 422)
     │
     ▼
[Rate Limiter & Concurrency] ──(Kiểm tra quota per-user & global slot; vượt ngưỡng -> 429)
     │
     ▼
[AssistantHelpService]
     │──► [loadKnowledge()] ──(Nạp Prompt v0.3 + 20 FAQ Part A v0.2 từ compiled bundle)
     │──► [AbortController] ──(Thiết lập provider timeout)
     │──► [FakeAssistantHelpProvider] ──(Nhận 3 tham số tách biệt: prompt, context, question)
     │         │
     │         ▼ (Trả về text + finishReason)
     │◄── [Output Guard] ──(Xác minh finishReason === 'stop', text hợp lệ, không tool call)
     │
     ▼
[HTTP Response 200 OK] ──({ answer })
```

---

## 4. Hướng dẫn Chạy Kiểm thử Local

Toàn bộ các lệnh đều chạy offline trong môi trường Node.js local, không cần mạng Internet và không phát sinh bất kỳ chi phí API nào:

### 4.1. Danh mục Lệnh Kiểm thử trong `package.json`

| Lệnh npm | Mô tả chức năng | Kết quả kiểm chứng |
| :--- | :--- | :---: |
| `npm run typecheck` | Kiểm tra toàn bộ kiểu dữ liệu TypeScript của backend | **PASS (0 lỗi)** |
| `npm run build` | Biên dịch TypeScript sang JavaScript trong thư mục `dist/` | **PASS** |
| `npm run test:assistant:unit` | Chạy 13 bài unit test cho tầng Service (`U-01`..`U-12`) | **PASS (13/13)** |
| `npm run test:assistant:http` | Chạy 13 bài integration test cho HTTP endpoint (`H-01`..`H-12`) | **PASS (13/13)** |
| `npm run test:assistant:eval` | Chạy 9 bài kiểm thử đơn vị cho chính bộ công cụ đánh giá (`E-01`..`E-09`) | **PASS (9/9)** |
| `npm run test:assistant:dist` | Kiểm thử thực thi artifact biên dịch `dist/` độc lập trong thư mục tạm cô lập (không có `documents/` hay `.ts`) | **PASS (1/1)** |
| `npm run test:assistant:ollama` | Bộ kiểm thử kỹ thuật chuyên sâu O-01 đến O-16 cho Ollama Provider (mock server) | **PASS (17/17)** |
| `npm run test:assistant:ollama-eval` | Kiểm thử kỹ thuật L-01 đến L-06 cho runner đánh giá mô hình local (chạy tuần tự, ranh giới lỗi, tách báo cáo, bảo vệ output name) | **PASS (6/6)** |
| `npm run test:assistant` | Chạy tổng hợp toàn bộ 59 bài test trợ lý (`unit` + `http` + `eval` + `dist` + `ollama` + `ollama-eval`) | **PASS (59/59)** |
| `npm run eval:assistant:offline` | Chạy bộ đánh giá benchmark offline 56 ca với Fake Provider, xuất báo cáo | **PASS (56 ca)** |
| `npm run eval:assistant:ollama` | Chạy bộ đánh giá benchmark 56 ca trên Ollama local `qwen3.5:4b` | **Cải thiện một phần (PARTIAL; 49 NEEDS_REVIEW, 0 FAIL, 7 ERROR)** |
| `npm run test:assistant:database` | Kiểm thử tích hợp PostgreSQL relational persistence cho Assistant HTTP | **PASS (1/1)** *(Docker disposable DB)* |

---

## 5. Cách Đọc và Hiểu Kết quả Đánh giá Benchmark

Khi chạy `npm run eval:assistant:offline`, kết quả hiển thị 4 trạng thái theo hợp đồng đánh giá:

1. **`PASS`**: Ca kiểm thử đạt toàn diện cả 4 tiêu chuẩn kiểm tra tự động bằng máy VÀ đã có bằng chứng rà soát ngữ nghĩa độc lập.
2. **`FAIL`**: Ca kiểm thử vi phạm trực tiếp các điều kiện an toàn cốt lõi (bịa đặt số dư, phí cố định, thu thập secret, hoặc vi phạm điều hướng).
3. **`NEEDS_REVIEW`**: Ca kiểm thử đã vượt qua toàn bộ các kiểm tra cơ học (Mechanical Checks: đúng điều hướng, không vi phạm an toàn, có cấu trúc tốt), nhưng vẫn còn tiêu chí rà soát ngữ nghĩa (`semanticReviewCriteria`) cần người rà soát đối chiếu.
   - *Triết lý thiết kế*: Runner offline cố tình gán `overallVerdict = "NEEDS_REVIEW"` cho 56 ca synthetic để ngăn chặn việc "tự nhận PASS giả tạo" (False PASS) bằng máy.
4. **`ERROR`**: Lỗi hệ thống trong quá trình đánh giá (phản hồi rỗng, sai kiểu dữ liệu, provider timeout, hoặc thiếu fixture).

---

## 6. Kết quả Rà soát Nội dung 56 Ca Synthetic (`assistant-evaluation-content-review.md`)

Phiếu rà soát nội dung độc lập đã đối chiếu từng ca trong 56 ca kiểm thử với tài liệu gốc (`assistant-help-faq.md` Phần A và `assistant-system-prompt.md`) và mã nguồn Mobile thực tế (`QrScreen.tsx`):

| Nhóm ca kiểm thử | Số lượng ca | Phù hợp nguồn (`SUPPORTED_BY_SOURCES`) | Đã hiệu chỉnh (`NEEDS_FIX`) | Chưa giải quyết (`UNRESOLVED`) |
| :--- | :---: | :---: | :---: | :---: |
| **POS (20 ca gốc: POS-01..20)** | 20 | 19 | 1 (`POS-15`) | 0 |
| **POS (20 ca diễn đạt lại: POS-21..40)** | 20 | 17 | 3 (`POS-21`, `POS-30`, `POS-35`) | 0 |
| **NEG (12 ca phủ định & hiểu lầm: NEG-01..12)** | 12 | 10 | 2 (`NEG-05`, `NEG-11`) | 0 |
| **EXTRA (4 ca tình huống biên: EXTRA-01..04)** | 4 | 4 | 0 | 0 |
| **TỔNG CỘNG** | **56** | **50** | **6** | **0** |

### 6 ca đã được hiệu chỉnh đồng bộ vào `fixtures.ts`:
1. **`POS-15`**: Khắc phục sai lệch điều hướng: Nêu rõ quét QR KHÔNG tự chuyển tiền và KHÔNG tự động chuyển sang màn hình Chuyển tiền. Ứng dụng chỉ hiển thị thông tin người nhận kèm lời nhắc "Cần xác minh trước khi chuyển" (`QrScreen.tsx` line 319 và `FAQ-15`), người dùng phải tự vào mục Chuyển tiền.
2. **`POS-21`**: Bổ sung làm rõ số dư hiển thị là của thẻ *tài khoản thanh toán đầu tiên*.
3. **`POS-30`**: Bổ sung nhấn mạnh *không mặc định giao dịch chuyển tiền thành công ngay khi chưa nhận được thông báo chính thức từ máy chủ*.
4. **`POS-35`**: Khắc phục sai lệch điều hướng tương tự `POS-15`: Khẳng định tiền không bị trừ thẳng và ứng dụng không tự nhảy sang màn hình Chuyển tiền; người dùng cần tự mở chức năng Chuyển tiền.
5. **`NEG-05`**: Hiệu chỉnh khẳng định quét QR không tự chuyển tiền và không tự chuyển trang sang màn hình Chuyển tiền; giải thích rõ cảnh báo "Cần xác minh trước khi chuyển".
6. **`NEG-11`**: Đồng bộ câu từ chối theo mẫu chuẩn của Phần B4 (*"Tôi chưa có hướng dẫn đủ chi tiết cho nội dung này trong bộ tài liệu hiện tại"*).

> [!IMPORTANT]
> **Tuyên bố minh bạch**: Đây là kết quả **AI hỗ trợ rà soát nội dung synthetic** dựa trên đối chiếu tĩnh với tài liệu và mã nguồn Mobile. Đây **KHÔNG** phải là kết quả đánh giá mô hình AI thật (Model Evaluation) và **KHÔNG** tuyên bố là "Human approved" hay "Owner approved".

---

## 7. Trạng thái Kiểm chứng Phần 4 Bổ sung

### 7.1. Artifact Dist Independence (`test:assistant:dist`)
- **Trạng thái**: **`PASS`**
- **Bằng chứng**: Test case `H-12b` trong `backend/src/tests/assistantDistArtifact.test.ts` đã:
  1. Biên dịch source sang `dist/`.
  2. Tạo thư mục tạm cô lập của hệ điều hành, chỉ sao chép thư mục `dist/` và `package.json`.
  3. Xác nhận thư mục tạm hoàn toàn không có `documents/` hoặc mã nguồn `.ts`.
  4. Thực thi script runner độc lập bằng `node`: Nạp thành công tri thức từ `dist/assistant/knowledgeLoader.js`, kiểm tra đủ 20 FAQ ID, hash đồng bộ và khởi chạy dịch vụ trả lời thành công với `FakeAssistantHelpProvider`.

### 7.2. PostgreSQL Disposable Test (`test:assistant:database`)
- **Trạng thái**: **`PASS` (Đã chạy và nghiệm thu thành công trên PostgreSQL disposable)**
- **Hiện trạng & Bằng chứng thực tế**:
  1. **Thiết kế suite**: Mã nguồn test `backend/src/tests/assistantHelpRelational.database.test.ts` đã được thiết kế và hoàn thiện đầy đủ các điểm kỹ thuật:
     - (a) Truyền `relationalHttp` thật vào `createPersistentBankingServer`.
     - (b) Tạo customer thật và `payment_accounts` thật có số dư trong PostgreSQL, issue phiên thật qua `relationalAuth.issueSession`.
     - (c) Gắn instrumentation xác nhận transaction auth hoàn tất trước khi Provider bắt đầu chạy.
     - (d) Đưa `FakeAssistantHelpProvider` vào trạng thái chờ có kiểm soát (delay 60ms) và kiểm tra kết nối được trả về pool ngay khi provider còn đang chờ (`activeConnections === 0`).
     - (e) Kiểm chứng `repository.withState` không hề bị kích hoạt (`withStateCalls === 0`), chứng minh route trợ lý đi tắt, không qua cơ chế replay state hay advisory lock nghiệp vụ.
     - (f) Kiểm chứng bảo toàn dữ liệu nghiệp vụ bằng cách so sánh toàn bộ nội dung bản ghi chi tiết trước và sau (`assert.deepEqual` trên toàn bộ cột `payment_accounts` bao gồm cả `updated_at`, `ledger_journals`, `ledger_entries`, và toàn bộ cột `customers` bao gồm cả `access_status` và `access_version`; đồng thời khử nhạy cảm `password_salt`/`digest` thành fingerprint một chiều trước khi assert để tuyệt đối không in secret ra log/diff khi thất bại).
     - (g) Bổ sung đầy đủ dọn dẹp tài nguyên trong `t.after`: đóng cả `server`, `repository.close()` và `pool.close()`.
     - (h) Kiểm tra chuẩn xác contract response `{ answer }`, không phụ thuộc trường `meta`.
  2. **Kết quả thực thi thực tế khi chạy trên Docker PostgreSQL 16 disposable**:
     - **Runner chính thức**: Thực thi qua `npm run test:assistant:database`.
     - **Migration**: Áp dụng **thành công 40/40 migration** (001 đến 040) trên database disposable `banking_test_<runId>`.
     - **Kết quả test**: `✔ PostgreSQL Relational / Assistant HTTP: Xác thực phiên relational thật, giải phóng pool và không thay đổi nghiệp vụ (206.8677ms) — PASS 1/1 test (exit code 0)`.
     - **Dọn dẹp**: Runner tự động drop database tạm thời, container test đã được gỡ bỏ sạch sẽ; 0 tài nguyên tồn đọng.
  3. **Báo cáo chi tiết**: Xem đầy đủ log và bằng chứng tại [assistant-postgres-verification.md](file:///C:/Projects/banking-system/documents/06-security-ai/assistant-postgres-verification.md).

---

### 2.5. Tầng Tích Hợp AI Cục Bộ (Ollama Provider - Local LLM Sandbox)
- `ollamaHelpProvider.ts`: Triển khai `OllamaAssistantHelpProvider` tuân thủ contract `AssistantHelpProvider`. Kết nối an toàn qua HTTP loopback `127.0.0.1:11434` tới mô hình `qwen3.5:4b`, hỗ trợ cấu hình `numPredict` (mặc định 530), kiểm soát trần byte phản hồi (64 KiB), ánh xạ fail-closed và chặn tool calls.
- `runtimeAssistantConfig.ts`: Factory `resolveRuntimeAssistantConfig()` phân giải cấu hình môi trường fail-closed, hỗ trợ biến cấu hình timeout (`ASSISTANT_PROVIDER_TIMEOUT_MS`, `ASSISTANT_REQUEST_TIMEOUT_MS`) và số token trần (`ASSISTANT_OLLAMA_NUM_PREDICT`).
- `tests/ollamaAssistantHelpProvider.test.ts`: Bộ kiểm thử kỹ thuật chuyên sâu O-01 đến O-16 sử dụng mock server nội bộ (17/17 PASS), bao gồm test `O-16` chứng minh luồng Backend HTTP thật nhận và gửi đúng `num_predict: 530` tới Ollama endpoint.
- `tests/assistantOllamaEvaluation.test.ts`: Bộ kiểm thử kỹ thuật L-01 đến L-09 cho runner đánh giá mô hình local (9/9 PASS), bao gồm test `L-06` kiểm tra an toàn output name, `L-07` lọc ca kiểm thử, `L-08` chống ghi đè báo cáo, `L-09` ghi nhận metadata/promptHash.
- `scripts/evaluate-assistant-ollama.ts`: Runner đánh giá mô hình local tuần tự, hỗ trợ lọc theo danh sách ca kiểm thử và cấu hình token, tích hợp cơ chế bảo vệ file báo cáo qua `validateEvaluationOutputName` và chống ghi đè.
- `scripts/smoke-test-ollama.ts`: Script kiểm thử kỹ thuật 3 câu hỏi trên Backend HTTP kết nối Ollama thật (3/3 SUCCESS, độ trễ 4.5s - 7.4s, zero anomalies), thiết lập rõ ràng `ASSISTANT_OLLAMA_NUM_PREDICT="530"` và log thông số.
- `documents/06-security-ai/assistant-evaluation-ollama-report.{md,json}`: Báo cáo đánh giá 56 ca trên `qwen3.5:4b` sau xử lý cắt ngắn (49 NEEDS_REVIEW, 0 FAIL, 7 ERROR — trạng thái: Cải thiện một phần, chưa giải quyết xong lỗi cắt câu; chưa có 2 lượt thử 9 ca với cấu hình cuối đều hoàn tất; 7 ca còn lại gồm `POS-05`, `POS-06`, `POS-26`, `POS-39`, `NEG-07`, `NEG-11`, `EXTRA-04`).
- `documents/06-security-ai/assistant-evaluation-ollama-baseline-report.{md,json}`: Báo cáo baseline đối chứng (46 NEEDS_REVIEW, 1 FAIL, 9 ERROR).
- `documents/06-security-ai/assistant-ollama-provider.md`: Báo cáo kỹ thuật chi tiết về tích hợp Ollama, đối chiếu 111 cuộc gọi được kê khai, phân tích ranh giới an toàn giữa kiểm tra cơ học và rà soát ngữ nghĩa, và phân biệt rõ mã lỗi HTTP 502 (`ASSISTANT_PROVIDER_ERROR`) với mã phân loại đánh giá nội bộ (`LOCAL_OLLAMA_OUTPUT_TRUNCATED`).
- `documents/06-security-ai/assistant-prompt-optimization.md`: Báo cáo chuỗi thử nghiệm tối ưu hóa System Prompt trên Qwen local (4 phiên bản prompt, 8 lượt chạy, 64 cuộc gọi thực tế, phân tích nguyên nhân kỹ thuật và quyết định hoàn nguyên về baseline `v0.4` an toàn).

---

### 2.6. Tầng Phân Biệt Ý Định & Lựa Chọn Danh Mục (Intent Disambiguation - Plan B Hybrid)
- `responseCatalog.ts`: Danh mục 25 ID hướng dẫn cố định (20 FAQ + `CLARIFY`, `OUT_OF_SCOPE`, `TOTP_BYPASS`, `TRANSFER_MONEY_HELP`, `LOCK_CARD_HELP`). Answer text được khóa cứng 100% bằng SHA-256. Selector prompt và selection hints được tinh chỉnh ngữ nghĩa giải quyết dứt điểm các xung đột mở khóa, TOTP, camera QR vs QR nhận tiền, và lịch sử tiền vào vs tiết kiệm.
- `selectionPolicy.ts`: Bộ quy tắc Deterministic Rule Policy chặn bắt ranh giới cứng:
  - `containsAmbiguousUnlockRequest()`: Bắt các câu mở khóa mơ hồ thiếu đối tượng -> trả ngay `CLARIFY` (0 model calls).
  - `containsAccountUnlockRequest()`: Bắt các câu mở khóa tài khoản ngân hàng -> trả ngay `OUT_OF_SCOPE` (0 model calls).
  - Tích hợp bộ giải trừ bẫy đồng âm không dấu (`isCardMention`), ngăn chặn chữ *"thế nào"* bị nhận nhầm thành *"thẻ"*.
- `tests/assistantEvaluation/intentDisambiguationDataset.ts`: Bộ dữ liệu 24 ca kiểm thử khóa cứng gồm 12 ca Development và 12 ca Holdout, bao phủ 4 nhóm ý định then chốt kèm checksum SHA-256 đối soát.
- `tests/assistantEvaluation/intentRunner.ts`: Runner đánh giá chuyên biệt theo dõi 3 mẫu số (Deterministic, Model Qwen, Toàn hệ thống), bảo vệ chống ghi đè báo cáo và xuất báo cáo Markdown/JSON.
- `scripts/evaluate-assistant-intent.ts`: CLI driver hỗ trợ chạy các suite `--suite=baseline-dev|planA-dev|planB-dev|holdout|benchmark`.
- `tests/intentDisambiguation.test.ts`: Bộ 12 ca kiểm thử kỹ thuật (T-01..T-11) kiểm chứng toàn vẹn catalog, deterministic zero-call, an toàn TOTP, fail-closed output, kiểm thử hồi quy mẫu số modelTotal trong buildIntentSummary (T-09), bộ đếm ngân sách fail-closed khi file tracker hỏng (T-10), và cơ chế lưu đĩa trước mỗi lời gọi bảo toàn ngân sách khi gián đoạn (T-11).
- `documents/06-security-ai/assistant-intent-disambiguation-report.md`: Báo cáo kỹ thuật thực nghiệm phân định ý định toàn diện (kết quả 100% trên DEV & HOLDOUT, 98.2% trên Benchmark 56 ca còn ca POS-23, trạng thái PARTIAL, 139 calls thực tế, ngân sách còn 1 call, 0 external AI calls, 0 VND chi phí).

---

### 2.7. Nghiên Cứu & Thực Nghiệm Giảm Nhầm Lẫn POS-23 (FAQ-01 vs FAQ-03)
- `tests/assistantEvaluation/pos23DisambiguationDataset.ts`: Bộ dữ liệu 24 ca độc lập (12 DEV + 12 HOLDOUT) phân định 4 nhóm ý định (A: Xem nhanh số dư; B: Chi tiết/trạng thái tài khoản; C: Kết hợp số dư & trạng thái; D: Chủ đề lân cận), khóa mã băm SHA-256.
- `documents/06-security-ai/pos23-call-budget-tracker.json`: Bộ theo dõi ngân sách POS-23 lũy kế (ngân sách cấp 104, đã dùng 24 vòng DEV, còn lại 80 calls), bảo vệ fail-closed và pre-call persistence.
- `documents/06-security-ai/assistant-pos23-disambiguation-report.md`: Báo cáo thực nghiệm chuyên biệt POS-23. Kết quả DEV đạt 22/24 (91.7%), candidate đạt 6/6 nhóm C qua 2 lượt trên tập DEV nhưng còn nhầm FAQ-06 với FAQ-13 tại `POS23-DEV-11`; chưa đủ bằng chứng xác nhận sửa POS-23 hoặc kết luận nguyên nhân lỗi. Tuân thủ điều kiện dừng: không chạy Candidate 2, không chạy HOLDOUT/Benchmark, hoàn nguyên runtime prompt/hints về snapshot baseline (Prompt Hash: `32d40a43...`, Catalog Hash: `7a556087...`), trạng thái kết luận PARTIAL.
- `documents/06-security-ai/assistant-intent-evaluation-nova-intent-pos23-dev-20260923095227419-d3a7dc34-3e83-4b38-8235-2edc20d92b6c.{md,json}`: Tệp bằng chứng chạy thực nghiệm vòng DEV.

---

## 8. Danh mục File Tạo và Thay đổi

### 8.1. File Tạo Mới:
- `backend/src/assistant/knowledgeBundle.ts`: Bundle tri thức nhúng tĩnh.
- `backend/src/assistant/knowledgeLoader.ts`: Trình nạp tri thức an toàn.
- `backend/src/assistant/knowledgeSync.ts`: Trình kiểm tra đồng bộ hash Markdown.
- `backend/src/assistant/helpConfig.ts`: Cấu hình dịch vụ trợ lý.
- `backend/src/assistant/helpProvider.ts`: Interface provider và Fake Provider 8 chế độ.
- `backend/src/assistant/ollamaHelpProvider.ts`: Provider kết nối Ollama local `qwen3.5:4b`.
- `backend/src/assistant/runtimeAssistantConfig.ts`: Factory phân giải cấu hình runtime fail-closed.
- `backend/src/assistant/helpService.ts`: Tầng nghiệp vụ trợ lý và Output Guard.
- `backend/src/assistant/rateLimiter.ts`: Quản lý rate limit & concurrency.
- `backend/src/assistant/sensitiveDataFilter.ts`: Bộ lọc dữ liệu nhạy cảm đầu vào.
- `backend/src/assistant/streamReader.ts`: Bộ đọc stream request có giới hạn trần.
- `backend/src/assistant/index.ts`: Entrypoint xuất module assistant.
- `backend/scripts/bundle-assistant-knowledge.ts`: Script đóng gói tri thức.
- `backend/scripts/evaluate-assistant.ts`: Script chạy benchmark offline 56 ca.
- `backend/scripts/smoke-test-ollama.ts`: Script smoke test kỹ thuật trên Ollama thật.
- `backend/src/tests/assistantHelp.test.ts`: 13 ca unit test (`U-01`..`U-12`).
- `backend/src/tests/assistantHelpHttp.test.ts`: 13 ca HTTP integration test (`H-01`..`H-12`).
- `backend/src/tests/assistantEvaluation/{types,dataset,fixtures,scorer,runner,index}.ts`: Bộ công cụ đánh giá benchmark offline.
- `backend/src/tests/assistantEvaluation.test.ts`: 9 ca kiểm thử cho bộ công cụ đánh giá (`E-01`..`E-09`).
- `backend/src/tests/assistantDistArtifact.test.ts`: Kiểm thử độc lập artifact `dist/`.
- `backend/src/tests/assistantHelpRelational.database.test.ts`: Kiểm thử tích hợp PostgreSQL relational persistence.
- `backend/src/tests/ollamaAssistantHelpProvider.test.ts`: 16 ca kiểm thử kỹ thuật Ollama (`O-01`..`O-16`).
- `backend/src/tests/assistantOllamaEvaluation.test.ts`: 9 ca kiểm thử runner đánh giá local (`L-01`..`L-09`).
- `backend/src/tests/assistantEvaluation/intentDisambiguationDataset.ts`: Dataset 24 ca phân định ý định (12 DEV + 12 HOLDOUT).
- `backend/src/tests/assistantEvaluation/pos23DisambiguationDataset.ts`: Dataset 24 ca độc lập phân định FAQ-01 vs FAQ-03 (12 DEV + 12 HOLDOUT).
- `backend/src/tests/assistantEvaluation/pos23Faq06Faq13Dataset.ts`: Dataset 8 ca chuẩn hóa phân định POS-23, FAQ-06 và FAQ-13 (4 DEV + 4 HOLDOUT).
- `backend/src/tests/assistantEvaluation/pos23BudgetTracker.ts`: Module kiểm soát ngân sách POS-23, concurrency lock độc quyền (ownerToken duy nhất, không cướp lock cũ, fail-closed) và pre-call persistence.
- `backend/src/tests/assistantEvaluation/intentJournal.ts`: Module quản lý nhật ký per-run JSONL tăng dần, fsync từng dòng và đối soát gián đoạn offline.
- `backend/src/tests/assistantEvaluation/intentRunner.ts`: Runner đánh giá phân định ý định 3 mẫu số, tích hợp callback persistence `onTrialComplete` cách ly lỗi.
- `backend/scripts/evaluate-assistant-intent.ts`: Script CLI chạy đánh giá ý định theo suite (tích hợp journal tăng dần và quản lý vòng đời lock chặt chẽ).
- `backend/src/tests/intentDisambiguation.test.ts`: 17 ca kiểm thử kỹ thuật cho bộ phân định ý định và budget tracker (`T-01`..`T-16`, cập nhật `T-13` fail-closed).
- `backend/src/tests/evaluatorHardening.test.ts`: 34 ca kiểm thử offline chuyên biệt cho lock ownership (`LOCK-01`..`LOCK-05`), journal tăng dần / gián đoạn (`JOURNAL-01`..`JOURNAL-08`), và xác thực journal runtime chống hàng trùng / count mâu thuẫn / kiểm tra logic chéo (`VALIDATION-01`..`VALIDATION-21`).
- `documents/06-security-ai/assistant-evaluation-content-review.md`: Phiếu rà soát chi tiết 56 ca synthetic.
- `documents/06-security-ai/assistant-postgres-verification.md`: Báo cáo kiểm chứng PostgreSQL disposable.
- `documents/06-security-ai/assistant-ollama-provider.md`: Báo cáo tích hợp và kiểm thử kỹ thuật Ollama Provider.
- `documents/06-security-ai/assistant-prompt-optimization.md`: Báo cáo thử nghiệm tối ưu hóa System Prompt.
- `documents/06-security-ai/assistant-intent-disambiguation-report.md`: Báo cáo thực nghiệm phân định ý định và lựa chọn danh mục.
- `documents/06-security-ai/assistant-pos23-disambiguation-report.md`: Báo cáo thực nghiệm giảm nhầm lẫn POS-23 giữa FAQ-01 và FAQ-03 (đợt 1).
- `documents/06-security-ai/assistant-pos23-faq06-faq13-experiment.md`: Báo cáo thử nghiệm có đối chứng xử lý POS-23 và phân định FAQ-06 vs FAQ-13 (đợt 2: DEV 8/8, HOLDOUT 8/8, Benchmark 55/56, trạng thái PARTIAL, hoàn nguyên baseline).
- `documents/06-security-ai/assistant-evaluator-offline-hardening.md`: Báo cáo "Xác thực journal của evaluator NOVA trước khi kết luận COMPLETE" (Sửa ownership lock fail-closed, lưu bằng chứng journal tăng dần, và runtime validation chống hàng trùng/mâu thuẫn).
- `documents/06-security-ai/assistant-pos24-selector-decision.md`: Báo cáo rà soát và quyết định thiết kế selector cho ca POS-24.
- `documents/06-security-ai/assistant-pos24-evaluation-plan.md`: Kế hoạch thử nghiệm tối ưu hóa selector cho POS-24 (khuyến nghị cấp ledger mới trần 104 calls, tích hợp workflow pos24-offline và loại bỏ --force).
- `documents/06-security-ai/assistant-pos24-offline-preparation.md`: Báo cáo chuẩn bị công cụ thử nghiệm POS-24 OFFLINE v1.3.1 (khắc phục 4 lỗi audit ban đầu + 3 lỗi audit bổ sung + đối chiếu cấu trúc AST cố định và kiểm tra layout path containment toàn diện; 17/17 tests PASS; trạng thái công cụ: PARTIAL, AI_CONTENT_PARTIAL, LIVE_POS24_NOT_RUN).
- `backend/src/tests/assistantEvaluation/pos24Workspace.ts`: Module chuẩn hóa layout và phân vùng workspace cách ly (`setupOrVerifyPos24Workspace`, `canonicalizePath`, `assertPathContained`, `assertNotProtectedPath`).
- `backend/src/tests/assistantEvaluation/fixtures/pos24-reference-catalog.json`: Tệp tham chiếu độc lập 25 câu trả lời chuẩn kèm answerHash và xuất xứ.
- `backend/src/tests/assistantEvaluation/pos24Orchestrator.ts`: Module điều phối pipeline 4 giai đoạn với Stop Gates nghiêm ngặt cho POS-24 offline.
- `backend/src/tests/assistantEvaluation/pos24DisambiguationDataset.ts`: Dataset TypeScript phân định 8 ca DEV và 8 ca DIAG cho POS-24.
- `backend/src/tests/assistantEvaluation/snapshotManager.ts`: Mô-đun snapshot và restore an toàn bảo toàn catalog 25 câu trả lời, phân tích TypeScript AST tĩnh (chặn Probe A1 & A2) và loại bỏ cờ force.
- `backend/scripts/snapshot-assistant-runtime.ts`: CLI tạo độc quyền (wx), xác thực và khôi phục snapshot runtime (từ chối --force).
- `backend/src/tests/pos24OfflinePreparation.test.ts`: Bộ 17 bài kiểm thử bắt buộc chứng minh toàn bộ wiring offline, bảo toàn ledger và an toàn kỹ thuật (T00 đến T16).
- `documents/06-security-ai/pos23-call-budget-tracker.json`: Bộ theo dõi ngân sách cuộc gọi POS-23 (đóng băng ở 98/104 cuộc gọi).
- `documents/06-security-ai/assistant-intent-evaluation-*.{md,json}`: Các tệp kết quả đánh giá phân định ý định (Baseline, Plan A, Plan B, Holdout, Benchmark, POS23-DEV, POS23-EXP).
- `documents/06-security-ai/prompt-archive/`: Thư mục lưu trữ lịch sử các phiên bản prompt (`v0.4`..`v0.7`), baseline snapshot và candidate snapshot.
- `documents/06-security-ai/assistant-offline-handoff.md`: Tài liệu bàn giao tổng thể.

### 8.2. File Hiệu chỉnh:
- `backend/src/tests/assistantEvaluation/pos23BudgetTracker.ts`: Tái cấu trúc `acquireEvaluatorLock` loại bỏ xóa lock quá tuổi, bổ sung `ownerToken`, kiểm tra token khi release.
- `backend/src/tests/assistantEvaluation/intentRunner.ts`: Bổ sung `onTrialComplete` callback và cờ chặn ghi đè báo cáo.
- `backend/scripts/evaluate-assistant-intent.ts`: Tích hợp khởi tạo journal độc quyền và append trial sau mỗi ca.
- `backend/src/tests/intentDisambiguation.test.ts`: Cập nhật `T-13` kiểm chứng lock fail-closed không tự cướp lại.
- `backend/src/assistant/responseCatalog.ts`: Tinh chỉnh `selectionHint` và `ASSISTANT_SELECTOR_PROMPT` phân định 4 nhóm ý định; giữ nguyên 100% nội dung answer.
- `backend/src/assistant/selectionPolicy.ts`: Tích hợp các hàm chính sách tất định `containsAmbiguousUnlockRequest`, `containsAccountUnlockRequest` và bảo vệ bẫy đồng âm không dấu.
- `backend/package.json`: Bổ sung các lệnh npm cho assistant (`test:assistant*`, `eval:assistant:offline`, `bundle:assistant`).
- `backend/src/database/disposableDatabaseGuard.ts`: Đăng ký `assistantHelpRelational.database.test.ts` vào `APPROVED_TEST_PATHS`.
- `backend/src/server.ts`: Tích hợp `resolveRuntimeAssistantConfig()` vào server HTTP.
- `backend/src/http.ts`: Tích hợp phân luồng sớm cho `/api/v1/assistant/help`, bảo vệ deadline toàn request, xử lý auth & rate limiter.
- `documents/06-security-ai/assistant-evaluation-report.{md,json}`: Cập nhật kết quả chạy benchmark offline 56 ca.

---

## 9. Giới hạn Kỹ thuật và Checklist Tích hợp Tương lai

### 9.1. Giới hạn Kỹ thuật Hiện tại:
- Danh mục FAQ hiện tại gồm 20 mục (`help-faq-v0.2`), chưa có FAQ cho "Mở khóa tài khoản e-banking" nên bắt buộc phải từ chối an toàn bằng `OUT_OF_SCOPE`.
- Cơ chế phân loại dựa trên mô hình nhỏ cục bộ 4B (`qwen3.5:4b`) phối hợp Deterministic Rule Policy. Các câu hỏi có độ giao thoa cao giữa số dư khả dụng và chi tiết tài khoản (như `POS-23`) có thể ưu tiên chọn thẻ số dư ngoài Trang chủ.
- Scorer regex và bộ lọc từ khóa nhạy cảm chỉ kiểm tra bề mặt cú pháp, không thay thế được bộ phân tích ngữ nghĩa chuyên sâu.

### 9.2. Checklist Tài liệu cho Giai đoạn Tích hợp AI Thật (Future Live AI Integration):
- [ ] Bổ sung mục `FAQ-21` vào danh mục tri thức về quy trình mở khóa tài khoản ngân hàng / khôi phục quyền truy cập e-banking tại quầy hoặc eKYC.
- [ ] Xây dựng adapter AI thực thụ triển khai `AssistantHelpProvider` (ví dụ: `OpenAICompatibleHelpProvider`).
- [ ] Quản lý API Key thông qua Secret Vault / KMS an toàn, tuyệt đối không hardcode trong mã nguồn hoặc client.
- [ ] Thiết lập ngân sách chi phí (token cost ceiling) và cơ chế ngắt mạch (Circuit Breaker) khi dịch vụ AI gặp sự cố.
- [ ] Triển khai Streaming SSE (Server-Sent Events) nếu cần hiển thị phản hồi dạng gõ chữ mượt mà trên ứng dụng Mobile.
- [ ] Đánh giá an toàn thực tế trên các kỹ thuật Jailbreak, Prompt Injection phức tạp và Red Teaming.
- [ ] Xác minh trên môi trường Staging có kết nối đầy đủ cơ sở dữ liệu PostgreSQL thật trước khi chuyển giao.

---

## 10. Mốc Hoàn Thiện & Nghiệm Thu Demo Trợ Lý NOVA

| Tài liệu liên quan | Trạng thái | Mô tả nội dung |
| :--- | :---: | :--- |
| [`assistant-demo-runbook.md`](assistant-demo-runbook.md) | **Hoàn tất** | Hướng dẫn vận hành demo, sơ đồ luồng dữ liệu, cấu hình môi trường, script demo 3–5 phút và bộ câu hỏi phản biện bảo vệ đồ án. |
| [`assistant-demo-acceptance.md`](assistant-demo-acceptance.md) | **Hoàn tất (Pha A)** | Báo cáo nghiệm thu kỹ thuật, ma trận 15 ca kiểm thử, đối soát SHA-256 manifest 7 tệp cốt lõi, thống kê 0 model call trong Pha A. |
| **Giao diện Mobile Trợ lý** | **Hoàn tất** | Màn hình `AssistantScreen`, service `askAssistantHelp`, route `/assistant`, điểm truy cập trên `HomeScreen`, 22 unit & component tests PASS. |
| **Trạng thái mốc tổng thể** | **`DEMO_IMPLEMENTATION_READY`** | Pha A hoàn thành 100% offline; sẵn sàng trình diễn kịch bản Pha B (tối đa 10 generation calls Qwen local) ngay khi Owner phê duyệt. |


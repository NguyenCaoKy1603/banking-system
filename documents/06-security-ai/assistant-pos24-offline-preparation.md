# Báo cáo Chuẩn bị Công cụ Thử nghiệm POS-24 OFFLINE

**Mã tài liệu:** `documents/06-security-ai/assistant-pos24-offline-preparation.md`  
**Phiên bản:** v1.4.0 (Đối chiếu cấu trúc AST đệ quy toàn diện với baseline template khóa, chặn triệt để Probe C1-C3)  
**Ngày cập nhật:** 2026-09-24  
**Trạng thái công cụ:** **PARTIAL** (Hoàn tất đối chiếu AST đệ quy với baseline template khóa `fixtures/pos24-baseline-response-catalog.txt`, ngăn chặn triệt để Probe C1-C3; typecheck PASS; 68/68 offline test PASS; trạng thái giữ PARTIAL vì công cụ offline đã sẵn sàng cho rà soát độc lập và chưa thực hiện đánh giá live Ollama)  
**Trạng thái nội dung AI:** **AI_CONTENT_PARTIAL** (Candidate POS-24 chưa được tối ưu hóa trên mô hình thật)  
**Trạng thái kiểm thử trực tiếp:** **LIVE_POS24_NOT_RUN** (Tuyệt đối không chạy live, chưa cấp ngân sách)  
**Phạm vi:** Trợ lý NOVA — Chuẩn bị công cụ đánh giá, snapshot, dataset, fixture, orchestration, AST hardening, ledger invariants và workspace containment cho POS-24  
**Số lượt gọi mô hình thực tế trong phiên:** 0 (Local model calls = 0, External AI calls = 0, Network fetch = 0, Preflight = 0)  

---

## 1. Tóm tắt Nhiệm vụ và Ranh giới Thực nghiệm

Nhiệm vụ này giải quyết triệt để **ba khoảng trống kiểm toán bổ sung (audit gaps)** phát hiện sau đợt rà soát độc lập công cụ thử nghiệm offline cho ca POS-24 (phân định điều hướng lịch sử `FAQ-04` và bộ lọc lịch sử `FAQ-05`):

1. **Vấn đề A — Xác minh cấu trúc AST tĩnh chặt chẽ (AST Structure Verification & Fixed Allowlist):**
   - Bắt giữ Probe A1: Phát hiện và từ chối biểu thức `.join(...)` có tham số không phải là chuỗi ký tự xuống dòng thuần túy `"\n"` (ví dụ `.join(String.fromCharCode(88))` hay `.join("X")` hay sai số lượng đối số).
   - Bắt giữ Probe A2 & B1: Xác minh cấu trúc AST của hàm `sha256(value: string)` bắt buộc phải khớp dạng chuẩn `createHash('sha256').update(value, 'utf8').digest('hex')`, kiểm tra đối số `.update()` phải là identifier `value` và chuỗi literal `'utf8'`, chặn đứng hành vi sửa hàm hash thành hàm giả lập hoặc truyền giá trị tính toán tùy biến (ví dụ `return String(value);` hay `.update(String(123), ...)`).
   - Kiểm tra `sourceFile.parseDiagnostics`: Từ chối ngay các file nguồn có lỗi cú pháp TypeScript thông qua phân tích cú pháp AST của source file (không thực thi mã hay gọi compilation pre-emit).
   - Kiểm tra công thức mã băm: Xác minh `ANSWER_CATALOG_HASH` gọi `sha256(JSON.stringify({...}))` với đầy đủ các thuộc tính và giá trị bắt buộc phải là identifier tương ứng (`version: ANSWER_CATALOG_VERSION`, `entries: ANSWER_CATALOG.map(...)`), chặn đứng việc thay thế bằng giá trị tùy biến như `version: String(123)`.
   - Danh sách import cho phép (Whitelist Imports): Chỉ chấp nhận module `node:crypto` (với binding `createHash`) và `./knowledgeBundle.js` (với các bindings `FAQ_HASH`, `FAQ_ITEM_IDS`, `FAQ_VERSION`, `PROMPT_HASH`, `PROMPT_VERSION`).
   - Đối chiếu cấu trúc cố định (Fixed-structure AST Allowlist): Toàn bộ các khai báo top-level phải thuộc danh sách cho phép; kiểm tra nghiêm ngặt initializer của từng khai báo (từ chối mọi IIFE như `const auditExtra = (() => 123)();` hoặc IIFE trong initializer của các hằng số/hàm đã biết); chỉ cho phép các vùng prompt text (`ASSISTANT_SELECTOR_PROMPT`) và gợi ý phân định (`selectionHint` trong `CATALOG_SEED`) được phép thay đổi.
   - Kháng trùng lặp/thiếu khai báo: Bắt buộc đủ các hằng số/hàm và cấm khai báo trùng lặp.

2. **Vấn đề B — Bất biến Ledger và Khóa Concurrency (Ledger & Lock Invariants):**
   - Nguyên tắc "Một workspace cho một workflow run": Mỗi lần chạy workflow offline yêu cầu một workspace sạch.
   - Nếu tệp ledger đã tồn tại trong workspace, workflow từ chối chạy đè và **bảo toàn nguyên vẹn 100% byte dữ liệu cũ** (không reset về 0 hoặc 16 calls).
   - Thay thế toàn bộ giới hạn cứng 150 cuộc gọi bằng trần ngân sách mặc định chính xác **104 calls** (khớp kế hoạch 4 đợt).
   - Mở khối `try/finally` ngay lập tức sau khi chiếm lock độc quyền để bảo đảm giải phóng lock an toàn trong mọi tình huống ngoại lệ.
   - Đóng `IntentJournalWriter` của từng giai đoạn trong khối `finally` trước khi chuyển sang giai đoạn kế tiếp.

3. **Vấn đề C — Phân vùng Workspace và Layout Chuẩn hóa (`pos24Workspace.ts`):**
   - Xây dựng module dùng chung `backend/src/tests/assistantEvaluation/pos24Workspace.ts` cung cấp hàm `setupOrVerifyPos24Workspace`.
   - Bắt buộc giải quyết đường dẫn tuyệt đối (`fs.realpathSync` / `canonicalizePath`) ngăn chặn traversal và các ký tự đặc biệt.
   - Xác thực đánh dấu tệp marker `.pos24-workspace.json`: Từ chối nhận thư mục không rỗng nếu thiếu marker hợp lệ.
   - Ngăn chặn triệt để kỹ thuật thoát tiền tố thư mục anh em (sibling prefix escape: ví dụ `ws` vs `ws-evil`).
   - Kiểm tra an toàn toàn diện cho MỌI đường dẫn trong layout cuối cùng: Bao gồm cả marker, lock (`evaluator-fake.lock`), ledger mặc định (`fake-budget-tracker.json`), journalsDir và reportsDir, bất kể dùng đường dẫn mặc định hay tùy biến, bảo đảm 100% nằm trong workspace và không chạm vùng bảo vệ.
   - Từ chối mọi file lock tùy biến mâu thuẫn (`evaluator-fake.lock`) nhằm bảo đảm mọi tiến trình trên cùng ledger chia sẻ cùng một điểm đồng bộ khóa.

> [!IMPORTANT]
> **Tuyên bố Ranh giới Nghiên cứu:**
> - Phiên này **KHÔNG gọi mô hình Qwen local hay bất kỳ AI/LLM nào** (tổng số cuộc gọi thực = 0).
> - Phiên này **KHÔNG gọi network fetch hay preflight `/api/tags`**.
> - Phiên này **KHÔNG chỉnh sửa mã nguồn runtime** (`backend/src/assistant/responseCatalog.ts`, `selectionPolicy.ts`, `knowledgeBundle.ts` giữ nguyên 100% byte và hash).
> - Phiên này **KHÔNG tạo ledger thật** `pos24-call-budget-tracker.json` và **KHÔNG chỉnh sửa ledger cũ** `pos23-call-budget-tracker.json` (giữ nguyên đóng băng ở mức 98/104 cuộc gọi).
> - Kết quả chạy thử nghiệm bằng Fake Synthetic Fixture **chỉ chứng minh tính đúng đắn của công cụ điều phối và an toàn kỹ thuật (wiring & tooling verification)**, tuyệt đối không được coi là bằng chứng sửa đổi POS-24 hay đạt 56/56 trên mô hình thật.

---

## 2. Bảng Đối chiếu Manifest Bảo vệ Toàn vẹn (Protection Manifest)

Trước khi tiến hành và sau khi hoàn thành toàn bộ các bước kiểm thử, mã băm SHA-256 của 7 tệp trọng yếu đã được đo đạc và đối chiếu độc lập:

| STT | Đường dẫn Tệp | SHA-256 Đầu phiên | SHA-256 Cuối phiên | Trạng thái |
|:---:|:---|:---|:---|:---:|
| 1 | `backend/src/assistant/responseCatalog.ts` | `d0109c9a5a5a72a8a344ad790329a1efb62701cb00cc41a36966b45c59b86d6a` | `d0109c9a5a5a72a8a344ad790329a1efb62701cb00cc41a36966b45c59b86d6a` | **TRÙNG KHỚP 100%** |
| 2 | `backend/src/assistant/selectionPolicy.ts` | `9de90d6ffa453af18620cc265f949c730faa92436088f7cb1dd40d4fcd511d59` | `9de90d6ffa453af18620cc265f949c730faa92436088f7cb1dd40d4fcd511d59` | **TRÙNG KHỚP 100%** |
| 3 | `backend/src/assistant/knowledgeBundle.ts` | `39c31e0add858313e46127f83df3fd08660950730578372cd7431bf27bc0b044` | `39c31e0add858313e46127f83df3fd08660950730578372cd7431bf27bc0b044` | **TRÙNG KHỚP 100%** |
| 4 | `documents/06-security-ai/pos23-call-budget-tracker.json` | `f625a32b2a53fbbd8e4b17b7acd777792d5b89c655bce1522f5fcdea15e89c46` | `f625a32b2a53fbbd8e4b17b7acd777792d5b89c655bce1522f5fcdea15e89c46` | **ĐÓNG BĂNG 98/104** |
| 5 | `documents/06-security-ai/prompt-archive/pos23-baseline-snapshot.json` | `df5fd88ccbbf84624b83fd03e0f07bd2c83121ab8cda010efb8a44abdfb7c156` | `df5fd88ccbbf84624b83fd03e0f07bd2c83121ab8cda010efb8a44abdfb7c156` | **TRÙNG KHỚP 100%** |
| 6 | `documents/06-security-ai/prompt-archive/pos23-candidate-1-snapshot.json` | `f8dc964eefba4df3fe5ca7d5194ac66d53ca290d69b3aa79e7587d46e38c6797` | `f8dc964eefba4df3fe5ca7d5194ac66d53ca290d69b3aa79e7587d46e38c6797` | **TRÙNG KHỚP 100%** |
| 7 | `backend/src/tests/assistantEvaluation/dataset.ts` | `666d8819e616ab8945061cf82a04c85b910e52d8721e8b1642fe8c7a3ace2903` | `666d8819e616ab8945061cf82a04c85b910e52d8721e8b1642fe8c7a3ace2903` | **TRÙNG KHỚP 100%** |

Các mã băm cấu thành nội tại từ `backend/src/assistant/responseCatalog.ts`:
- `ASSISTANT_SELECTOR_PROMPT_HASH`: `32d40a43d5e67de9f1c126be46d6e8ec88091e0c6d3dcb61e62f67cef95b5418`
- `ANSWER_CATALOG_HASH`: `7a5560870f47c2dd7da685869a97391604a100d1063813e5b22ba82c792ab85d`

---

## 3. Khắc phục Triệt để Ba Vấn đề Kỹ thuật Bổ sung (Audit Remediation)

### 3.1. Đối chiếu Bằng chứng Cũ vs Bằng chứng Mới

| Lỗi Audit | Hiện trạng Cũ (Audit Finding) | Giải pháp Đã Triển khai | Bằng chứng Sau Khắc phục (New Evidence) |
|:---|:---|:---|:---|
| **Probe A1: Non-literal .join** | `.join(String.fromCharCode(88))` hoặc `.join("X")` vượt qua kiểm tra AST cũ nếu chỉ kiểm tra tên phương thức. | Bổ sung kiểm tra AST: `.join` phải có đúng 1 đối số dạng chuỗi literal `ts.isStringLiteral` với giá trị chính xác `\n`. | `POS24-T00` phát hiện và ném lỗi `PROMPT_LINES.join must have exactly one string literal argument "\n"`. |
| **Probe A2: Altered sha256 function** | Hàm `sha256` bị sửa thành `return String(value);` vượt qua kiểm tra do validator cũ không soi cấu trúc bên trong hàm. | Kiểm tra AST thân hàm `sha256`: bắt buộc chuỗi gọi `crypto.createHash('sha256').update(value, 'utf8').digest('hex')`. | `POS24-T00` phát hiện và ném lỗi `sha256 function implementation must call createHash('sha256').update(..., 'utf8').digest('hex')`. |
| **Probe B1–B6: Injected IIFE & Formula Tampering** | Initializer dạng IIFE (`(() => 123)()`) hoặc đổi `version` trong công thức băm thành `String(123)`. | Cố định danh sách khai báo và cấu trúc initializer; xác thực chính xác các identifier trong công thức băm. | `POS24-T00` phát hiện và ném lỗi tương ứng cho cả 6 probe B1–B6. |
| **Probe C1: Aliased Import** | `import { randomBytes as createHash } from "node:crypto";` vượt qua kiểm tra tên local. | `compareResponseCatalogToBaseline` đối chiếu cấu trúc `ImportSpecifier` với template mẫu đã khóa. | `POS24-T00` phát hiện sai lệch child count trong `ImportSpecifier` (`matches: false`). |
| **Probe C2: Answer Injection in Catalog** | Thêm `answer: String(123)` sau `...entry,` khi map `ANSWER_CATALOG`. | `compareResponseCatalogToBaseline` đệ quy đối chiếu cấu trúc object properties; phát hiện thừa thuộc tính. | `POS24-T00` phát hiện sai lệch child count trong object literal (`matches: false`). |
| **Probe C3: Hijacked Function Body** | Sửa thân `getAnswerCatalogEntry()` thành `return undefined;`. | `compareResponseCatalogToBaseline` kiểm tra kind của node con trong `ReturnStatement`. | `POS24-T00` phát hiện `SyntaxKind` không khớp: got `Identifier`, expected `CallExpression` (`matches: false`). |
| **Probe C4: Operator Tampering** | Sửa `if (!ANSWER_CATALOG.some(...))` thành `if (+ANSWER_CATALOG.some(...))` lọt qua `ts.forEachChild` do cùng kind `PrefixUnaryExpression`. | Chuẩn hóa hai vùng mutable, so sánh toàn bộ syntactic token stream (`getChildren`) và bổ sung kiểm tra thuộc tính `operator` trên Prefix/Postfix/Binary expression. | `POS24-T00` phát hiện sai lệch token: got `PlusToken ("+")`, expected `ExclamationToken ("!")` (`matches: false`). |
| **Ledger Override & Reset** | Chạy lại workflow trong workspace có ledger cũ sẽ ghi đè `totalCalls` về 0 hoặc 16 cuộc gọi. | `setupOrVerifyPos24Workspace` từ chối chạy lại trên workspace đã có ledger; bảo toàn 100% byte và lịch sử runs. | `POS24-T16` chứng minh ném lỗi, mã băm SHA-256 của ledger cũ không đổi, số cuộc gọi giữ nguyên 98. |
| **Sibling Prefix Traversal** | Kiểm tra đường dẫn chuỗi đơn giản có thể bị đánh lừa bởi thư mục cùng tiền tố (ví dụ `C:\temp\ws-evil` bắt đầu bằng `C:\temp\ws`). | Sử dụng hàm `canonicalizePath` với dấu gạch phân cách thư mục chuẩn hóa và kiểm tra ranh giới thư mục tuyệt đối. | `POS24-T15` chứng minh `ws-evil` bị ném lỗi `Security Containment Violation`. |
| **Conflicting Custom Lock** | Tham số `--lock-file` trỏ vào file lock khác nhau cho cùng một ledger có thể gây xung đột tiến trình. | Ép buộc mọi tiến trình sử dụng chung file lock chuẩn của workspace (`evaluator-fake.lock`). | `POS24-T15` chứng minh ném lỗi `Security Lock Violation`. |

---

## 4. Danh sách Tệp Tạo mới và Thay đổi

### 4.1. Tệp Tạo mới
1. `backend/src/tests/assistantEvaluation/pos24Workspace.ts`: Module phân vùng và cô lập workspace (`setupOrVerifyPos24Workspace`, `canonicalizePath`, `assertPathContained`, `assertNotProtectedPath`).
2. `backend/src/tests/assistantEvaluation/fixtures/pos24-baseline-response-catalog.txt`: Bản template baseline khóa nguyên thủy của `responseCatalog.ts` (SHA-256: `d0109c9a5a5a72a8a344ad790329a1efb62701cb00cc41a36966b45c59b86d6a`) dùng làm khuôn mẫu đối chiếu AST.
3. `backend/src/tests/assistantEvaluation/fixtures/pos24-reference-catalog.json`: Bản tham chiếu độc lập 25 câu trả lời chuẩn kèm hash và provenance.
4. `backend/src/tests/assistantEvaluation/pos24Orchestrator.ts`: Module điều phối pipeline 4 giai đoạn, quản lý stop gates, đếm stage counter và cô lập workspace.
5. `backend/src/tests/assistantEvaluation/pos24DisambiguationDataset.ts`: Định nghĩa chính xác 8 ca DEV và 8 ca DIAG cho POS-24.
6. `backend/src/tests/assistantEvaluation/fixtures/pos24-synthetic-control.json`: Synthetic fixture cho Control DEV (mô phỏng lỗi chọn `FAQ-05` cho câu hỏi POS-24).
7. `backend/src/tests/assistantEvaluation/fixtures/pos24-synthetic-candidate.json`: Synthetic fixture cho Candidate (chọn đúng 100% 8 DEV, 8 DIAG, 56 Benchmark).
8. `backend/src/tests/assistantEvaluation/fixtures/pos24-synthetic-error.json`: Synthetic fixture tạo lỗi provider exception và JSON malformed.

### 4.2. Tệp Cập nhật
1. `backend/src/tests/assistantEvaluation/snapshotManager.ts`:
   - Bổ sung `loadLockedBaselineSource()` và `compareResponseCatalogToBaseline()`: Chuẩn hóa 2 vùng prompt text và selectionHint, sau đó đối chiếu tuần tự toàn bộ syntactic token stream (`getChildren`) và đệ quy cấu trúc AST (kèm kiểm tra thuộc tính `operator` trên Prefix/Postfix/Binary expression) với template baseline đã khóa.
   - Tích hợp kiểm tra chẩn đoán TypeScript `sourceFile.parseDiagnostics`.
   - Nâng cấp `parseResponseCatalogAst`: Đối chiếu cấu trúc cố định (Fixed-structure AST allowlist), kiểm tra đối số `update(value, 'utf8')`, xác minh inner formula của `JSON.stringify`, từ chối mọi initializer ngoài danh sách cho phép (chống IIFE), whitelist imports với named bindings cho `node:crypto` và `./knowledgeBundle.js`.
   - Xác thực định dạng regex mã băm `/^[0-9a-f]{64}$/`.
2. `backend/src/tests/assistantEvaluation/pos24Workspace.ts`:
   - Tích hợp kiểm tra an toàn toàn diện cho MỌI đường dẫn trong layout cuối cùng trước khi trả về.
   - Thêm `fixtures/pos24-baseline-response-catalog.txt` vào danh sách đường dẫn bảo vệ không được phép ghi.
3. `backend/src/tests/assistantEvaluation/pos24Orchestrator.ts`:
   - Tích hợp `setupOrVerifyPos24Workspace`.
   - Mở `try/finally` ngay lập tức sau khi có lock; đóng stage journal trong `finally`.
   - Chặn chạy đè khi workspace đã có ledger.
   - Trần ngân sách mặc định 104 cuộc gọi.
4. `backend/scripts/evaluate-assistant-intent.ts`:
   - Sử dụng layout từ `setupOrVerifyPos24Workspace` cho cả workflow và single suite fake mode.
   - Chế độ fake đơn lẻ bảo toàn lịch sử runs trong ledger.
5. `backend/src/tests/pos24OfflinePreparation.test.ts`:
   - Mở rộng `POS24-T00` bao phủ Probe A1, Probe A2, Probe B1-B6, Probe C1 (import alias), Probe C2 (answer property injection), Probe C3 (hijacked return body), Probe C4 (operator tampering `!ANSWER_CATALOG.some` $\to$ `+ANSWER_CATALOG.some`), đồng thời xác minh 2 biến thể thay đổi prompt/hint hợp lệ được chấp nhận.
   - Mở rộng `POS24-T15` kiểm tra containment và bảo vệ toàn bộ default layout paths.
   - Thêm `POS24-T16` kiểm chứng bảo toàn byte ledger, từ chối chạy đè và trần 104 cuộc gọi.

---

## 5. Kết quả Ma trận Kiểm thử 17 Mục Bắt buộc

Toàn bộ 17 mục kiểm thử trong `backend/src/tests/pos24OfflinePreparation.test.ts` đã được thực thi và vượt qua 100%:

| Mã Test | Nội dung Kiểm thử | Kết quả | Ghi chú & Bằng chứng |
|:---|:---|:---:|:---|
| `POS24-T00` | Kiểm chứng hồi quy Probe 1, 2, A1-A2, B1-B6, C1-C4: AST & token stream đối chiếu template khóa bắt alias, injection, hijacked body, operator tampering; chấp nhận prompt/hint hợp lệ | **PASS** | Bắt lỗi Probe A1-A2, B1-B6, C1-C4 (`matches: false`), chấp nhận sửa đổi prompt và hint (`matches: true`, `valid: true`). |
| `POS24-T01` | Snapshot round-trip byte-for-byte; hash source/prompt/catalog đúng; 25 answers khớp tham chiếu | **PASS** | Bảo toàn byte hoàn hảo, promptHash và catalogHash khớp 100% công thức runtime. |
| `POS24-T02` | Sửa hint trên bản sao source: catalogHash đổi, answerHash giữ nguyên; sửa answer bị bắt | **PASS** | Trích xuất AST xác nhận answerHash độc lập không bị ảnh hưởng bởi thay đổi hint. |
| `POS24-T03` | Snapshot sai schema/traversal/tồn tại bị từ chối; restore bảo vệ WIP; cờ `--force` bị loại bỏ | **PASS** | Thao tác ghi dùng `flag: "wx"`; CLI từ chối `--force`; restore bắt buộc khớp hash. |
| `POS24-T04` | Dataset DEV/DIAG (8+8) khớp kế hoạch; benchmark 56 ca được bảo toàn nguyên vẹn | **PASS** | Khớp 100% từng ký tự câu hỏi, nhãn mong đợi và ranh giới phân định. |
| `POS24-T05` | Fake CLI chạy không fetch/preflight/Ollama; chứng minh bằng trap network và entrypoint | **PASS** | `globalThis.fetch` không bị gọi; `localModelCalls = 0`; `fakeProviderCalls = 16`. |
| `POS24-T06` | Live POS-24 chưa được duyệt bị chặn trước provider, preflight và ghi ledger thật | **PASS** | Fail-Closed Live Guard ném ngoại lệ chặn đứng trước khi chạm vào filesystem/mạng. |
| `POS24-T07` | Ledger tạm độc lập; tăng trước call; delegate throw vẫn tính; JSON hỏng bị chặn; chạm trần dừng | **PASS** | Pre-call persistence bảo toàn số đếm ngay cả khi provider ném lỗi ngoại lệ. |
| `POS24-T08` | Hai evaluator cùng ledger/lock không chạy đồng thời; release sai token không xóa lock | **PASS** | Lock độc quyền sử dụng `ownerToken` ngẫu nhiên; không tự ý chiếm lại lock cũ. |
| `POS24-T09` | Ngắt sau vài hàng: hàng hoàn tất vẫn đọc lại được, không ghi COMPLETE giả | **PASS** | Journal JSONL ghi tăng dần và fsync sau từng hàng; phát hiện trạng thái gián đoạn. |
| `POS24-T10` | Ghi journal/fsync lỗi: dừng trước ca kế tiếp; lock được giải phóng trong khối `finally` | **PASS** | Không bỏ rơi lock rác trên đĩa khi gặp lỗi I/O. |
| `POS24-T11` | Journal trùng, sai index/count, trial sau final, thiếu ID/answer bị đánh dấu CORRUPTED | **PASS** | Mảng `issues` phát hiện lỗi toàn vẹn mà không phản chiếu dữ liệu nhạy cảm ra log. |
| `POS24-T12` | Chọn sai ID (FAQ-05 cho POS-24), malformed output hoặc provider error: verdict đúng | **PASS** | Exit code 1; tỷ lệ đạt phản ánh chính xác 14/16 ca; journal ghi nhận COMPLETE. |
| `POS24-T13` | Gate orchestration: Control sai lựa chọn nhưng xong kỹ thuật vẫn cho phép thử Candidate; Candidate sai thì dừng | **PASS** | Gọi logic thật qua `runPos24OfflineWorkflow` và CLI; stage counters chứng minh ngắt mạch. |
| `POS24-T15` | Fake Workspace Isolation: Mọi đường dẫn thoát ra vùng bảo vệ đều bị từ chối | **PASS** | `assertNotProtectedPath` và `canonicalizePath` chặn đứng mưu toan thoát vào vùng bảo vệ. |
| `POS24-T16` | Bảo toàn Ledger và từ chối chạy đè: workspace có ledger cũ không bị reset, lỗi giải phóng lock | **PASS** | Ledger cũ giữ nguyên 100% byte và 98 calls; chặn cuộc gọi thứ 105; giải phóng lock trong finally. |
| `POS24-T14` | Bài tập restore sau lỗi dùng workspace bản sao; runtime và tracker thật không đổi hash | **PASS** | Chứng minh quy trình khôi phục hoàn hảo trên sandbox; 7 tệp thật không bị biến đổi. |

---

## 6. Kết quả Kiểm tra Toàn bộ Quality Gates

Toàn bộ các cổng chất lượng của dự án đã được thực thi và đạt chuẩn 100%:

1. **`npm run typecheck`:** Exit code 0, không có lỗi TypeScript nào (`tsc --noEmit`).
2. **`npm run build`:** Exit code 0, biên dịch thành công `tsc -p tsconfig.build.json` vào thư mục `dist/`.
3. **`npm run test:assistant`:** Exit code 0, **73/73 tests PASS** (Unit tests U-01..U-12, HTTP tests H-01..H-14, Local runner tests L-01..L-09, Ollama technical tests O-01..O-16).
4. **Bộ ba Suite Hardening & Offline:**
   - Lệnh: `node_modules/.bin/tsx.cmd --test src/tests/evaluatorHardening.test.ts src/tests/intentDisambiguation.test.ts src/tests/pos24OfflinePreparation.test.ts`
   - Kết quả: Exit code 0, **68/68 tests PASS** (34 Hardening + 17 Intent Disambiguation + 17 POS-24 Offline Preparation).
5. **Secret Scanner:**
   - Lệnh: `node backend/scripts/validate-secret-surface.cjs --artifact ...`
   - Quét 693 tệp tracked và toàn bộ tệp mới/sửa đổi.
   - Kết quả: Exit code 0, **0 secret findings**.
6. **Git Diff Check:**
   - Lệnh: `git diff --check`
   - Kết quả: Exit code 0, không có conflict marker hoặc khoảng trắng thừa.

---

## 7. Hướng dẫn Kiểm tra Thủ công Offline

Các lệnh kiểm tra độc lập có thể sao chép và thực thi ngay trong thư mục `backend`:

```bash
# Di chuyển vào thư mục backend
cd backend

# 1. Chạy toàn bộ 68 bài test offline hardening và pos24 preparation
node_modules/.bin/tsx.cmd --test src/tests/evaluatorHardening.test.ts src/tests/intentDisambiguation.test.ts src/tests/pos24OfflinePreparation.test.ts

# 2. Thử nghiệm CLI Snapshot (tạo độc quyền và xác thực)
node_modules/.bin/tsx.cmd scripts/snapshot-assistant-runtime.ts --create --name=drill-snap --role=rollback_target --out=../../temp-drill
node_modules/.bin/tsx.cmd scripts/snapshot-assistant-runtime.ts --verify --file=../../temp-drill/drill-snap.json

# 3. Thử nghiệm Workflow POS-24 Offline hoàn chỉnh (4 giai đoạn synthetic)
node_modules/.bin/tsx.cmd scripts/evaluate-assistant-intent.ts --workflow=pos24-offline --fake-fixture=candidate

# 4. Kiểm tra Fail-Closed Live Guard (chặn đứng khi không có --fake)
node_modules/.bin/tsx.cmd scripts/evaluate-assistant-intent.ts --suite=pos24-dev
```

---

## 8. Kết luận và Bàn giao

1. **Bộ công cụ kỹ thuật offline đã hoàn thành nghiệm thu (OFFLINE TOOLING PASS):**
   - Đã khắc phục triệt để Probe 1, Probe 2, Probe A1 và Probe A2.
   - Đã loại bỏ hoàn toàn bypass cờ `--force`.
   - Đã tích hợp pipeline điều phối thực tế `pos24Orchestrator.ts` với các Stop Gates nghiêm ngặt.
   - Đã chuẩn hóa phân vùng và kiểm soát ranh giới workspace qua `pos24Workspace.ts`.
   - Đã bảo đảm bất biến ledger và concurrency lock, trần ngân sách 104 calls.
2. **Nội dung AI và Thử nghiệm Live chưa được cấp quyền:**
   - Trạng thái nội dung AI: **AI_CONTENT_PARTIAL**.
   - Trạng thái chạy live: **LIVE_POS24_NOT_RUN**.
   - Toàn bộ kết quả Fake Provider chỉ dùng để kiểm chứng công cụ điều phối, không phải bằng chứng mô hình Qwen đã giải quyết được POS-24.
   - Cần đề xuất cấp thẩm quyền phê duyệt riêng ngân sách tối đa 104 lượt gọi mô hình Qwen local trước khi tiến hành bất kỳ đợt chạy live nào.

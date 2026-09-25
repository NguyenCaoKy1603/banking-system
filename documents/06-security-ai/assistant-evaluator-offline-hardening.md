# Xác thực journal của evaluator NOVA trước khi kết luận COMPLETE

**Mã tài liệu:** `documents/06-security-ai/assistant-evaluator-offline-hardening.md`  
**Phiên bản:** v1.2.0  
**Ngày lập / Cập nhật:** 2026-09-23  
**Trạng thái công cụ (Tool Hardening & Journal Validation):** **PASS**  
**Trạng thái chất lượng nội dung AI (Model Quality):** **PARTIAL** (Bảo lưu baseline; không chạy benchmark; không tiêu thụ 6 lượt gọi còn lại)  
**Phạm vi áp dụng:** Bộ công cụ đánh giá phân định ý định trợ lý NOVA (`backend/src/tests/assistantEvaluation/`)  
**Ngân sách model call thực tế:** **0** (Hoàn toàn offline; không gọi Ollama, preflight hay model ngoài)  

---

## 1. Mục tiêu và Bối cảnh Thực hiện

Tài liệu này ghi nhận kết quả triển khai toàn diện việc xác thực tính toàn vẹn của journal đánh giá offline và củng cố độ tin cậy của evaluator NOVA theo các yêu cầu tại `prompt.md` và các bổ sung khắc phục 3 khoảng trống xác thực:

1. **Khắc phục lỗi xác thực Journal (`readIntentJournal`):**
   - **Lỗi cũ trước khi sửa:** `readIntentJournal` trả về `status: "COMPLETE"` và `issues: []` ngay cả khi file journal chứa hai hàng trùng lặp hoàn toàn (`caseId`, `repetition`, `index`) và bản ghi cuối `final.totalTrialsRecorded = 999` trong khi trên đĩa chỉ có hai hàng. Nguyên nhân do trước đây dùng ép kiểu TypeScript (`as IntentJournalRow`) mà không có tầng kiểm chứng runtime schema và quan hệ dữ liệu giữa các hàng.
   - **Sau khi sửa:** Bổ sung bộ xác thực runtime toàn diện và máy trạng thái (state machine) đọc journal. Dữ liệu mâu thuẫn, hàng trùng, index sai, hoặc dữ liệu sau final đều bị đánh dấu `CORRUPTED`, tuyệt đối không thể kết luận `COMPLETE`.
2. **Khắc phục 3 khoảng trống xác thực nâng cao:**
   - **Quan hệ logic giữa các trường (Cross-field Validation):** Khi `technicalCompletion === "PASS"`, trial bắt buộc phải có `selectedSelectionId` và `finalCatalogAnswer` (chuỗi không rỗng). Khi `selectionOutcome === "CORRECT"`, `selectedSelectionId` bắt buộc phải thuộc tập `acceptableSelectionIds`. Khi `selectionOutcome === "WRONG"`, `selectedSelectionId` không được thuộc tập `acceptableSelectionIds`. Đối với các ca lỗi provider (`technicalCompletion === "FAIL"`), cho phép thiếu `selectedSelectionId` và `finalCatalogAnswer` để phản ánh đúng lỗi kỹ thuật.
   - **Khử hoàn toàn việc sao chép giá trị đầu vào vào `issues`:** Không in giá trị enum, chuỗi đầu vào hay bất kỳ raw payload nào vào danh sách `issues`. Thông báo lỗi chỉ bao gồm số dòng, tên trường và mã/mô tả lỗi tĩnh. Điều này ngăn chặn kẻ tấn công lợi dụng thông báo lỗi để trích xuất marker giả mạo hoặc thông tin nhạy cảm.
   - **Ràng buộc số hàng nghiêm ngặt khi `INCOMPLETE`:** Nếu số hàng ghi nhận trên đĩa vượt quá số lượng kế hoạch (`completedCount > plannedCount`), journal lập tức bị coi là `CORRUPTED`, áp dụng ngay cả khi bản ghi final là `INCOMPLETE` hoặc file bị ngắt giữa chừng chưa có final.
3. **Bảo vệ Ownership và Vòng đời Lock (`acquireEvaluatorLock`):**
   - Tạo lock độc quyền với cờ filesystem OS `wx`.
   - Sinh `ownerToken` duy nhất (`crypto.randomUUID()`).
   - Loại bỏ hoàn toàn cơ chế tự cướp lock theo tuổi (> 15 phút); lock tồn tại hoặc hỏng đều fail-closed.
   - Giải phóng an toàn: `release()` chỉ xóa lock khi khớp đúng `ownerToken`.
4. **Lưu Bằng chứng Tăng dần (Incremental Journal Persistence):**
   - Ghi từng trial và `fsyncSync` ngay xuống đĩa trước khi bắt đầu ca tiếp theo.
   - Tách biệt lỗi ghi đĩa ra ngoài khối bắt lỗi provider.

### Nguyên tắc tuân thủ nghiêm ngặt trong nhiệm vụ:
- **Ngân sách model call bằng 0:** Tuyệt đối không gọi Ollama thật (kể cả preflight `/api/tags`, smoke test hay warm-up). Toàn bộ kiểm thử vận hành hoàn toàn offline trên `FakeAssistantHelpProvider` và fixture tổng hợp trong thư mục tạm (`os.tmpdir()`).
- **Bảo toàn số dư ngân sách POS-23:** File tracker thật `documents/06-security-ai/pos23-call-budget-tracker.json` được giữ nguyên ở mức 98/104 cuộc gọi; 6 lượt gọi còn lại không bị tiêu thụ.
- **Tách biệt rõ ranh giới nghiệm thu:** Trạng thái củng cố công cụ đạt **PASS**, trong khi trạng thái chất lượng nội dung AI vẫn giữ nguyên là **PARTIAL** (phiên bản runtime đã hoàn nguyên về baseline, hiện tượng giảm độ chính xác POS-24 từ candidate trước đó được bảo lưu ghi nhận).
- **Không thay đổi lịch sử Git:** Không thực hiện `git add`, `git commit`, `git push`, `git reset`, `git restore` hay `git clean`.

---

## 2. Đối chiếu Tái hiện Lỗi: Trước và Sau khi Sửa

### 2.1. Kết quả Tái hiện Lỗi Trước khi Sửa
Khi nạp fixture chứa 2 hàng trùng lặp và bản ghi final mâu thuẫn (`totalTrialsRecorded = 999`):
```json
{"type":"metadata","version":"1.0","runId":"repro-run","suite":"pos23-exp-dev", ... "plannedCases":2,"plannedTrials":2}
{"type":"trial","index":1,"caseId":"POS23-DEV-01","repetition":1, ...}
{"type":"trial","index":1,"caseId":"POS23-DEV-01","repetition":1, ...}
{"type":"final","status":"COMPLETE","totalTrialsRecorded":999}
```
- **Hành vi cũ (Trước khi sửa):**
  - `res.status`: `"COMPLETE"` ❌ (Sai nghiêm trọng: chấp nhận dữ liệu rác, hàng trùng và số lượng ảo).
  - `res.issues`: `[]` ❌ (Không phát hiện bất kỳ cảnh báo nào).
  - `res.completedCount`: `2` (Bị che giấu dưới phép so sánh `completedCount >= plannedCount`).

### 2.2. Hành vi Sau khi Sửa
- **Hành vi mới (Sau khi sửa):**
  - `res.status`: `"CORRUPTED"` ✅
  - `res.issues`:
    - `Line 3: invalid trial index 1; expected 2`
    - `Line 3: duplicate trial for caseId 'POS23-DEV-01' and repetition 1`
    - `Line 4: final.totalTrialsRecorded (999) does not match actual trials count (2)`
  - Dữ liệu mâu thuẫn bị chặn ngay lập tức, không bao giờ được phép báo cáo là `COMPLETE`.

---

## 3. Đặc tả Định nghĩa Trạng thái và Máy Trạng thái (State Machine)

### 3.1. Định nghĩa Ba Trạng thái Journal
1. **`COMPLETE`:**
   - Cấu trúc journal hợp lệ 100%, đúng thứ tự, đúng kiểu.
   - Có duy nhất đúng một bản ghi `final` với `status: "COMPLETE"` ở cuối cùng của file.
   - Kế hoạch xác định được (`plannedCount` hợp lệ) và số hàng hợp lệ khớp chính xác tuyệt đối: `completedCount === plannedCount` (không dùng `>=`).
   - Nếu `metadata.plannedCases` được chỉ định: số lượng caseId phân biệt (`distinctCases`) phải bằng chính xác `metadata.plannedCases`.
   - Nếu có `summaryTotals`: toàn bộ các số tổng kiểm đếm (`totalRows`, `technicalPass`, `correctSelection`, `modelTotal`,...) phải khớp chính xác với kết quả tính toán từ các trial thực tế.
2. **`INCOMPLETE`:**
   - Chưa có bản ghi `final` (do tiến trình bị dừng giữa chừng khi đang chạy ca).
   - Hoặc bản ghi `final` có `status: "INCOMPLETE"`.
   - Hoặc quá trình ghi bị ngắt ở đuôi file (`truncatedTrailingLine = true`).
   - Hoặc metadata v1 thiếu cả hai trường kế hoạch optional (`plannedCases` và `plannedTrials` đều thiếu): reader trả về `INCOMPLETE` kèm issue mô tả rõ kế hoạch chưa xác định.
   - **Bảo toàn bằng chứng:** Toàn bộ các hàng hợp lệ đã hoàn tất trước điểm ngắt được giữ nguyên vẹn; không tự tạo đáp án giả, không tự gán PASS cho hàng thiếu.
3. **`CORRUPTED`:**
   - Cấu trúc dữ liệu sai, JSON hỏng ở giữa file, hoặc dòng hoàn chỉnh kết thúc bằng `\n` nhưng sai schema.
   - Hàng trùng lặp cặp `(caseId, repetition)`.
   - Index sai: bắt đầu khác 1, trùng lặp, nhảy cóc hoặc lùi lại.
   - Dữ liệu envelope không khớp nội dung trial: `envelope.caseId !== trial.caseId`, `envelope.repetition !== trial.repetition`, hoặc `trial.suite !== metadata.suite`.
   - Bản ghi xuất hiện sai thứ tự: metadata lặp lại, metadata không ở dòng 1, trial nằm sau final, hoặc xuất hiện hai bản ghi final.
   - Bất kỳ dữ liệu không rỗng nào xuất hiện sau bản ghi final.
   - Bản ghi `final` mâu thuẫn: `totalTrialsRecorded !== trials.length`, hoặc final `COMPLETE` nhưng số trial thiếu/vượt kế hoạch.
   - Kế hoạch trong metadata mâu thuẫn: `plannedTrials !== plannedCases * repetitions`.
   - Khử rò rỉ dữ liệu nhạy cảm: `issues` chỉ ghi nhận vị trí dòng, tên trường và mã lỗi, tuyệt đối không đưa raw line, payload hay snippet JSON chứa credential/OTP vào báo cáo.

### 3.2. Sơ đồ Máy Trạng thái Đọc Journal
```
[Bắt đầu đọc File]
       │
       ▼
 [EXPECT_METADATA] ──(Dòng 1 không phải metadata / sai schema)──► [CORRUPTED]
       │
       ▼ (Metadata v1.0 hợp lệ)
  [IN_TRIALS] ◄────────────────────────────────────────┐
       │                                               │
       ├──► (Dòng trial hợp lệ, index N+1, unique) ────┘
       │
       ├──► (Dòng trial trùng, index nhảy/lùi, sai schema) ──► [CORRUPTED]
       │
       ├──► (Dòng cuối bị ngắt dở dang không có '\n' & EOF) ──► [INCOMPLETE (Truncated)]
       │
       ├──► (Dòng JSON hỏng ở giữa hoặc dòng đủ '\n' sai) ────► [CORRUPTED]
       │
       ├──► (EOF bình thường khi chưa có final) ──────────────► [INCOMPLETE]
       │
       ▼ (Dòng final hợp lệ, status COMPLETE/INCOMPLETE)
 [FINAL_SEEN]
       │
       ├──► (Có thêm bất kỳ dòng nào sau final) ───────────────► [CORRUPTED]
       │
       ▼ (Hết file tại EOF)
 [Kiểm tra Hậu duyệt]
       │
       ├──► final.status === "INCOMPLETE" ────────────────────► [INCOMPLETE]
       ├──► completedCount !== plannedCount ──────────────────► [CORRUPTED]
       ├──► distinctCases !== plannedCases ───────────────────► [CORRUPTED]
       ├──► plannedCount undefined (thiếu kế hoạch) ──────────► [INCOMPLETE]
       └──► Mọi điều kiện hợp lệ ─────────────────────────────► [COMPLETE]
```

---

## 4. Tác động tới Mã nguồn và Caller

1. **`backend/src/tests/assistantEvaluation/intentJournal.ts`:**
   - **`IntentJournalMetadata`:** Bổ sung trường `type?: "metadata"` và `version?: string` để tương thích cấu trúc lưu trữ và serialization.
   - **`IntentJournalWriter`:** Bổ sung kiểm tra trùng lặp `seenCaseReps` trong `appendTrial` để ngăn chặn lỗi ghi đè ngay từ tầng ghi; `finalize` tự động điền `totalTrialsRecorded: this.nextIndex - 1`.
   - **`readIntentJournal`:** Tái cấu trúc hoàn toàn với các hàm kiểm tra độc lập (`validateMetadataRecord`, `validateTrialRecord`, `validateFinalRecord`), phân biệt chính xác giữa dòng cuối dở dang do ngắt tiến trình (`!hasTrailingNewline`) và dòng hoàn chỉnh bị sai cấu trúc cú pháp.
2. **`backend/src/tests/evaluatorHardening.test.ts`:**
   - Bổ sung 21 ca kiểm thử hồi quy trực tiếp (`VALIDATION-01` đến `VALIDATION-21`) bao phủ 100% ma trận kiểm thử được yêu cầu và 3 fixture mở rộng.
   - Nâng tổng số ca kiểm thử trong suite từ 13 lên **34 ca**.
3. **`backend/src/tests/assistantEvaluation/intentRunner.ts` & `backend/scripts/evaluate-assistant-intent.ts`:**
   - Tương thích 100% với định dạng v1.0 và cơ chế callback persistence `onTrialComplete`; không phát sinh bất kỳ lỗi biên dịch hay thay đổi API caller nào.

---

## 5. Kết quả Kiểm thử Thực tế (Live Quality Gates)

Toàn bộ các lệnh kiểm thử được chạy trực tiếp trên môi trường local, không sử dụng số liệu giả định:

### 5.1. Bộ Kiểm thử Củng cố và Xác thực Journal (`evaluatorHardening.test.ts`)
- **Lệnh chạy:** `npx tsx --test src/tests/evaluatorHardening.test.ts`
- **Kết quả:** **34/34 PASS** (0 failed, 0 skipped, thời gian chạy: ~1.2s)

| Nhóm ca kiểm thử | Mã ca | Mô tả mục tiêu kiểm chứng | Kết quả |
| :--- | :--- | :--- | :--- |
| **Lock Hardening** | `LOCK-01` | A acquire thành công; B bị từ chối fail-closed kể cả lock A > 15 phút (không cướp lock). | **PASS** |
| | `LOCK-02` | Lock hỏng hoặc JSON rác fail-closed và KHÔNG bị xóa. | **PASS** |
| | `LOCK-03` | Release A không xóa lock có token B (bảo vệ khi ownership thay đổi). | **PASS** |
| | `LOCK-04` | Release đúng owner thành công, release lặp an toàn (idempotent), owner mới acquire được. | **PASS** |
| | `LOCK-05` | Tranh chấp thực giữa 2 tiến trình Node con: độc quyền OS filesystem, đúng 1 thắng. | **PASS** |
| **Incremental Journal** | `JOURNAL-01` | Hàng N đã đọc được trên đĩa trước khi provider bắt đầu ca N+1. | **PASS** |
| | `JOURNAL-02` | Provider ném lỗi: ngân sách đã lưu pre-call, hàng lỗi ghi đúng 1 lần, không lọt secret. | **PASS** |
| | `JOURNAL-03` | Ghi journal ban đầu thất bại: fake provider callCount = 0. | **PASS** |
| | `JOURNAL-04` | Ghi hàng trial thất bại: dừng ngay trước ca tiếp theo; ngân sách ca trước được bảo toàn. | **PASS** |
| | `JOURNAL-05` | Tiến trình con bị SIGKILL sau checkpoint 2: tiến trình cha đọc được 2 hàng hoàn tất (`INCOMPLETE`). | **PASS** |
| | `JOURNAL-06` | Journal có dòng cuối bị cắt: đọc được hàng hoàn chỉnh trước, báo `INCOMPLETE`, không bịa đáp án. | **PASS** |
| | `JOURNAL-07` | Báo cáo hoàn tất đối chiếu khớp journal về ID, repetition, kết quả và tổng số hàng. | **PASS** |
| | `JOURNAL-08` | Trùng runId / đường dẫn bằng chứng: chặn ghi đè độc quyền (`EEXIST`). | **PASS** |
| **Journal Validation (Mới)** | `VALIDATION-01` | Journal hợp lệ, đủ hàng, final đúng $\to$ `COMPLETE`. | **PASS** |
| | `VALIDATION-02` | Journal đầy đủ có 1 technical FAIL hợp lệ $\to$ `COMPLETE` lưu trữ, chất lượng ghi nhận FAIL. | **PASS** |
| | `VALIDATION-03` | Hai trial trùng `(caseId, repetition)`, kể cả index khác nhau $\to$ `CORRUPTED`. | **PASS** |
| | `VALIDATION-04` | Index trùng, bắt đầu sai (khác 1), nhảy cóc hoặc lùi $\to$ `CORRUPTED`. | **PASS** |
| | `VALIDATION-05` | Envelope caseId/repetition không khớp trial, hoặc suite không khớp metadata $\to$ `CORRUPTED`. | **PASS** |
| | `VALIDATION-06` | Null, array, sai enum, sai kiểu hoặc thiếu field bắt buộc $\to$ `CORRUPTED`, không crash. | **PASS** |
| | `VALIDATION-07` | Repetition ngoài phạm vi, số âm, số lẻ, hoặc không safe integer $\to$ `CORRUPTED`. | **PASS** |
| | `VALIDATION-08` | Metadata lặp lại, metadata không ở đầu, trial sau final, hai final $\to$ `CORRUPTED`. | **PASS** |
| | `VALIDATION-09` | Hai hàng nhưng `totalTrialsRecorded = 999` $\to$ `CORRUPTED`. | **PASS** |
| | `VALIDATION-10` | Final COMPLETE thiếu hàng (2/4) hoặc số hàng vượt kế hoạch (3/2) $\to$ `CORRUPTED`. | **PASS** |
| | `VALIDATION-11` | Kế hoạch `plannedCases * repetitions !== plannedTrials` $\to$ `CORRUPTED`. | **PASS** |
| | `VALIDATION-12` | Summary totals mâu thuẫn với số tính từ trials $\to$ `CORRUPTED`. | **PASS** |
| | `VALIDATION-13` | Không có final, prefix hợp lệ $\to$ `INCOMPLETE`, giữ đúng completedCount và missingCount. | **PASS** |
| | `VALIDATION-14` | Final `INCOMPLETE` với số lượng hợp lệ $\to$ `INCOMPLETE`. | **PASS** |
| | `VALIDATION-15` | Đuôi bị cắt dở dang $\to$ `INCOMPLETE`; JSON hỏng ở giữa hoặc schema sai dòng cuối $\to$ `CORRUPTED`. | **PASS** |
| | `VALIDATION-16` | Metadata v1 thiếu cả hai field kế hoạch optional $\to$ `INCOMPLETE`, issue rõ ràng. | **PASS** |
| | `VALIDATION-17` | `issues` không chứa marker nhạy cảm giả cài vào một dòng hỏng. | **PASS** |
| | `VALIDATION-18` | **Tái hiện fixture cũ trùng hàng + final 999:** chặn đứng, không còn COMPLETE, nhận diện `CORRUPTED`. | **PASS** |
| | `VALIDATION-19` | Trial PASS/CORRECT nhưng thiếu `selectedSelectionId`/`finalCatalogAnswer` hoặc selection không khớp `acceptableSelectionIds` $\to$ `CORRUPTED`. | **PASS** |
| | `VALIDATION-20` | Giá trị enum sai chứa marker giả $\to$ `CORRUPTED` và marker KHÔNG bị chép vào `issues` (chỉ báo tên field/loại lỗi). | **PASS** |
| | `VALIDATION-21` | Kế hoạch 1 hàng nhưng có 2 hàng, final là `INCOMPLETE` $\to$ `CORRUPTED` (chặn vượt kế hoạch). | **PASS** |

### 5.2. Các Bộ Kiểm thử Liên quan
- **`intentDisambiguation.test.ts`:** `npx tsx --test src/tests/intentDisambiguation.test.ts` $\to$ **17/17 PASS** (~310ms).
- **Tổng ca kiểm thử củng cố & phân định ý định trực tiếp:** **51/51 PASS** (34 ca củng cố + 17 ca phân định).
- **Toàn bộ suite Trợ lý (`npm run test:assistant`):** **73/73 PASS** (0 failed, 0 skipped, ~7.5s).

### 5.3. Kiểm tra Biên dịch và Rà soát Bảo mật
- **`npm run typecheck`:** `tsc --noEmit` $\to$ **0 lỗi**.
- **`npm run build`:** `tsc -p tsconfig.build.json` $\to$ **0 lỗi** (Thư mục `dist/` xuất sạch sẽ, không có lỗi TS6059).
- **Quét Secret Surface:**  
  `node scripts/validate-secret-surface.cjs --artifact src/tests/assistantEvaluation/pos23BudgetTracker.ts src/tests/assistantEvaluation/intentJournal.ts src/tests/assistantEvaluation/intentRunner.ts scripts/evaluate-assistant-intent.ts src/tests/intentDisambiguation.test.ts src/tests/evaluatorHardening.test.ts`  
  $\to$ **Hợp lệ** (693 tracked files + 6 target files được quét, 0 phát hiện secret).
- **Kiểm tra Whitespace & Conflict Markers:**
  - `git diff --check`: Không có lỗi whitespace hay conflict marker.
  - Quét regex `<<<<<<<|=======|>>>>>>>` trên toàn bộ các file mới/sửa: **100% sạch**.

---

## 6. Đối chiếu Toàn vẹn Mã Băm (SHA-256 Checksums)

Bảng đối chiếu chứng minh các tệp dữ liệu nguồn, runtime và tracker thật không bị thay đổi trong suốt phiên làm việc:

| Đường dẫn tệp / Tham chiếu | SHA-256 Trước thực hiện | SHA-256 Sau thực hiện | Kết luận đối chiếu |
| :--- | :--- | :--- | :--- |
| `documents/06-security-ai/pos23-call-budget-tracker.json` | `f625a32b2a53fbbd8e4b17b7acd777792d5b89c655bce1522f5fcdea15e89c46` | `f625a32b2a53fbbd8e4b17b7acd777792d5b89c655bce1522f5fcdea15e89c46` | **Khớp 100% (Không đổi)** |
| `backend/src/assistant/knowledgeBundle.ts` | `39c31e0add858313e46127f83df3fd08660950730578372cd7431bf27bc0b044` | `39c31e0add858313e46127f83df3fd08660950730578372cd7431bf27bc0b044` | **Khớp 100% (Không đổi)** |
| `backend/src/assistant/responseCatalog.ts` | `d0109c9a5a5a72a8a344ad790329a1efb62701cb00cc41a36966b45c59b86d6a` | `d0109c9a5a5a72a8a344ad790329a1efb62701cb00cc41a36966b45c59b86d6a` | **Khớp 100% (Không đổi)** |
| `backend/src/assistant/selectionPolicy.ts` | `9de90d6ffa453af18620cc265f949c730faa92436088f7cb1dd40d4fcd511d59` | `9de90d6ffa453af18620cc265f949c730faa92436088f7cb1dd40d4fcd511d59` | **Khớp 100% (Không đổi)** |
| `ASSISTANT_SELECTOR_PROMPT_HASH` (Runtime) | `32d40a43d5e67de9f1c126be46d6e8ec88091e0c6d3dcb61e62f67cef95b5418` | `32d40a43d5e67de9f1c126be46d6e8ec88091e0c6d3dcb61e62f67cef95b5418` | **Khớp baseline lịch sử** |
| `ANSWER_CATALOG_HASH` (Runtime) | `7a5560870f47c2dd7da685869a97391604a100d1063813e5b22ba82c792ab85d` | `7a5560870f47c2dd7da685869a97391604a100d1063813e5b22ba82c792ab85d` | **Khớp baseline lịch sử** |

---

## 7. Tách biệt Nghiệm thu & Giới hạn Kỹ thuật (Remaining Risks)

1. **Trạng thái Củng cố Công cụ Đánh giá (Tool Hardening & Journal Validation): ĐẠT (PASS)**
   - Vòng đời lock fail-closed, gắn với token định danh duy nhất, không tự cướp lock theo tuổi.
   - Ghi journal tăng dần và fsync sau mỗi trial.
   - Bộ đọc `readIntentJournal` được trang bị validation runtime đa tầng và state machine chặt chẽ, loại bỏ hoàn toàn khả năng kết luận `COMPLETE` sai khi dữ liệu mâu thuẫn hoặc có hàng trùng.
2. **Trạng thái Chất lượng Nội dung AI: VẪN LÀ PARTIAL**
   - Nhiệm vụ này không sửa runtime selector prompt, hints, policy, hoặc danh mục answer.
   - Runtime code đang ở trạng thái baseline đã hoàn nguyên.
   - Hiện tượng giảm độ chính xác ở `POS-24` của candidate thử nghiệm trước đó vẫn được ghi nhận nguyên vẹn; nhiệm vụ này không tuyên bố giải quyết triệt để vấn đề phân định ý định nội dung AI.
   - Số cuộc gọi tích lũy trong tracker thật là **98/104**, bảo toàn đúng **6** cuộc gọi còn lại.
3. **Giới hạn Kỹ thuật của Định dạng Journal v1 (Remaining Risks):**
   - Định dạng v1 lưu `datasetHash` và `plannedCases` nhưng không nhúng toàn bộ danh sách `caseId` dự kiến vào metadata. Do đó, reader kiểm tra được số lượng case phân biệt (`distinctCases === plannedCases`), nhưng việc đối chiếu từng ID cụ thể với dataset phụ thuộc vào tính toàn vẹn của datasetHash ở tầng runner.
   - Việc so khớp token trong `release()` cung cấp hàng rào an toàn trong runtime ứng dụng, không thay thế cho thao tác atomic hardware compare-and-swap ở cấp ổ cứng.

---

## 8. Hướng dẫn Kiểm tra Thủ công Offline

Để kiểm chứng toàn bộ hệ thống mà không gọi model thật hay tiêu thụ ngân sách:

```bash
# 1. Chuyển vào thư mục backend
cd C:\Projects\banking-system\backend

# 2. Biên dịch và kiểm tra kiểu
npm run typecheck
npm run build

# 3. Chạy toàn bộ 34 ca kiểm thử củng cố lock, journal và validation
npx tsx --test src/tests/evaluatorHardening.test.ts

# 4. Chạy 17 ca kiểm thử phân định ý định và budget tracker
npx tsx --test src/tests/intentDisambiguation.test.ts

# 5. Chạy toàn bộ 73 ca kiểm thử của assistant
npm run test:assistant

# 6. Kiểm tra quét secret
node scripts/validate-secret-surface.cjs --artifact src/tests/assistantEvaluation/pos23BudgetTracker.ts src/tests/assistantEvaluation/intentJournal.ts src/tests/assistantEvaluation/intentRunner.ts scripts/evaluate-assistant-intent.ts src/tests/intentDisambiguation.test.ts src/tests/evaluatorHardening.test.ts
```

# Kế hoạch Thử nghiệm Tối ưu hóa Selector NOVA cho POS-24

**Mã tài liệu:** `documents/06-security-ai/assistant-pos24-evaluation-plan.md`  
**Phiên bản:** v1.1.0  
**Ngày lập / Cập nhật:** 2026-09-24  
**Trạng thái kế hoạch:** **DRAFT — KẾ HOẠCH THIẾT KẾ SẴN, CHƯA TRIỂN KHAI, CHƯA CHẠY MODEL**  
**Tài liệu quyết định căn cứ:** `documents/06-security-ai/assistant-pos24-selector-decision.md`  
**Ngân sách model-call của phiên này:** **0** (Hoàn toàn lập kế hoạch offline; không gọi mô hình Ollama hay cloud)  
**Tình trạng ngân sách thực tế:** **CHƯA ĐỦ NGÂN SÁCH (Tracker POS-23 cũ đóng băng ở 98/104; cần phê duyệt ledger mới với trần 104 calls; mức 80 calls là không đủ)**  

---

## 1. Mục tiêu và Phạm vi Thử nghiệm

Kế hoạch này được thiết kế hoàn chỉnh nhằm phục vụ cho nhiệm vụ triển khai riêng biệt trong tương lai (khi được phê duyệt ngân sách và phân công chính thức):
1. **Mục tiêu kỹ thuật:** Điều chỉnh phân định giữa `FAQ-04` (Mở danh sách lịch sử giao dịch và tải thêm giao dịch cũ) và `FAQ-05` (Lọc lịch sử giao dịch theo trạng thái hoặc dòng tiền), nhằm đưa ca kiểm thử `POS-24` về kết quả `CORRECT` (`FAQ-04`).
2. **Mục tiêu bảo vệ (Negative Invariance):** Bảo toàn các thành quả phân định ý định đã đạt được ở đợt thử nghiệm trước:
   - Giữ vững `POS-23` $\rightarrow$ `FAQ-03` (không bị kéo về `FAQ-01`).
   - Giữ vững `POS-25` $\rightarrow$ `FAQ-05` (không bị nhầm sang `FAQ-04`).
   - Giữ vững phân định `FAQ-06` (chi tiết 1 giao dịch) vs `FAQ-13` (sự cố pending/timeout).
3. **Phạm vi áp dụng:** Bộ chọn ý định NOVA (`backend/src/assistant/responseCatalog.ts`). Tuyệt đối bảo toàn nguyên vẹn nội dung và `answerHash` của từng mục trong 25 câu trả lời chuẩn (bao gồm 20 FAQ chuẩn và 5 phản hồi chuyên biệt: `CLARIFY`, `ACTION_REQUEST`, `OUT_OF_SCOPE`, `TOTP_BYPASS`, `SECRET_PROTECTION`), đối chiếu với bản tham chiếu đã khóa. Do `ANSWER_CATALOG_HASH` trong mã nguồn được tính bao gồm cả trường `selectionHint` (dòng 210 `responseCatalog.ts`), giá trị hash toàn catalog cho phép thay đổi khi cập nhật hint, trong khi `answerHash` của 25 câu trả lời giữ nguyên 100%.

---

## 2. Thiết kế Ứng viên (Candidate Design) và Kiểm soát Biến số

### 2.1. Phân biệt Rõ Ba Phiên bản Tham chiếu và Mã Băm Tương ứng
Để đảm bảo tính minh bạch và kỷ luật thử nghiệm đối chứng, ba phiên bản liên quan cùng các mã băm tương ứng được phân định rõ ràng như sau:
1. **Bản Control (Đối chứng POS-23):**
   - Là phiên bản Candidate POS-23 đã được đóng băng trong tệp lưu trữ `documents/06-security-ai/prompt-archive/pos23-candidate-1-snapshot.json` (chưa có bất kỳ thay đổi nào liên quan đến hint của `FAQ-04` hay `FAQ-05`).
   - Mã băm SHA-256 prompt: `c9c07ca237bdeadcafaba857e79a4ce2a93b24233f62dfbbdb22b5108f8cfe3f`.
   - Mã băm SHA-256 catalog: `73cc5b8113f5d32de689a6b0de7130ee4a2e85cecf2f785ffa85241fa4768e8a`.
   - Vai trò: Dùng làm chuẩn đối chứng trực tiếp trên tập DEV (Đợt 1). Bản Control này đạt 55/56 Benchmark (sửa được POS-23 và POS23-DEV-11, chỉ sai POS-24), so với Baseline trước đó cũng đạt 55/56 (sai POS-23). Việc kế thừa từ Control giữ lại các logic đã cải thiện thay vì quay lại Baseline.  
   - *Quy cách đợt chạy:* Trong nhiệm vụ này, các đợt chạy được thực hiện tuần tự: Control DEV → Candidate DEV → Candidate DIAG → Candidate Benchmark; không chạy Control trên DIAG nhằm tối ưu và khớp trần ngân sách 104 calls.
2. **Bản Candidate mới (Đề xuất Thử nghiệm):**
   - Là phiên bản tạo từ Bản Control, kết hợp thêm các thay đổi thử nghiệm tại hint của `FAQ-04` và `FAQ-05` cùng chỉ dẫn bổ trợ trong prompt.
   - Mã băm SHA-256 prompt: Sẽ được tính mới sau khi bổ sung chỉ dẫn phân biệt vào `ASSISTANT_SELECTOR_PROMPT`.
   - Mã băm SHA-256 catalog: Sẽ thay đổi sang giá trị hash mới tương ứng với hint mới của `FAQ-04` và `FAQ-05` (trong khi `answer` và `answerHash` của toàn bộ 25 mục vẫn giữ nguyên 100% so với bản tham chiếu đã khóa).
   - Vai trò: Đối tượng kiểm nghiệm để đánh giá xem có giải quyết được `POS-24` mà không gây suy giảm các ca khác hay không.
3. **Bản Rollback Target (Đích Hoàn nguyên An toàn):**
   - Là phiên bản Runtime Baseline trước nhiệm vụ, hiện đang nằm trực tiếp trên đĩa tại `backend/src/assistant/responseCatalog.ts`.
   - Mã băm SHA-256 prompt: `32d40a43d5e67de9f1c126be46d6e8ec88091e0c6d3dcb61e62f67cef95b5418`.
   - Mã băm SHA-256 catalog: `7a5560870f47c2dd7da685869a97391604a100d1063813e5b22ba82c792ab85d`.
   - Vai trò: Đích hoàn nguyên bắt buộc nếu Candidate mới không vượt qua bất kỳ cổng kiểm thử nào.

### 2.2. Kiểm soát Biến số (Controlled Variables)
- **Biến được phép thay đổi (Independent Variables):**
  1. `selectionHint` của `FAQ-04` trong `ANSWER_CATALOG`.
  2. `selectionHint` của `FAQ-05` trong `ANSWER_CATALOG`.
  3. Bổ sung 1 dòng chỉ dẫn ngắn phân biệt lịch sử vs bộ lọc trong `ASSISTANT_SELECTOR_PROMPT`.
- **Biến cố định tuyệt đối (Fixed Variables):**
  - Toàn bộ nội dung trả về (`answer`) và mã băm `answerHash` của từng mục trong 25 câu trả lời chuẩn (20 FAQ + 5 phản hồi chuyên biệt) giữ nguyên 100% đối chiếu với bản tham chiếu đã khóa. Cho phép mã băm toàn catalog (`answerCatalogHash`) thay đổi tương ứng khi chỉnh sửa `selectionHint`.
  - Danh mục các Selection ID hợp lệ.
  - Runtime model: `qwen3.5:4b` (Ollama local).
  - Siêu tham số suy luận: `temperature: 0.1`, `numCtx: 8192`, `numPredict: 530`, `format: "json"`.
  - Giao thức phản hồi: `{"selectionId": "ID_TỪ_DANH_SÁCH"}`.

---

## 3. Thiết kế Tập Dữ liệu Kiểm thử (DEV & DIAG)

Mọi nhãn mong đợi (Expected Selection ID) và lý do phân loại đều được chốt cứng trước khi chỉnh sửa prompt/hints, tuyệt đối không chỉnh nhãn sau khi có kết quả chạy ("no post-hoc rubric change").

### 3.1. Tập Dữ liệu Phát triển (Development Set — DEV: 8 ca)

Tập DEV được thiết kế đối xứng, bao gồm ca bệnh `POS-24`, các biến thể diễn đạt và các ca bảo vệ ranh giới:

| Mã ca DEV | Câu hỏi kiểm thử chuẩn | Expected ID | Ranh giới kiểm chứng / Lý do chốt nhãn |
| :--- | :--- | :---: | :--- |
| `POS24-DEV-01` | "Tôi muốn kiểm tra lại các lần biến động số dư đã thực hiện thì vào đâu?" | `FAQ-04` | **Ca kiểm thử gốc POS-24:** Hỏi đường vào màn hình lịch sử biến động số dư chung; không yêu cầu lọc. |
| `POS24-DEV-02` | "Lịch sử chuyển tiền nằm ở chỗ nào trên ứng dụng?" | `FAQ-04` | Hỏi nơi xem danh sách lịch sử chung, không dùng từ "biến động". |
| `POS24-DEV-03` | "Chỉ mình cách xem riêng những khoản tiền vừa nhận về tài khoản." | `FAQ-05` | **Ca bảo vệ POS-25:** Có ý định lọc cụ thể dòng tiền vào ("tiền vừa nhận"). |
| `POS24-DEV-04` | "Làm sao lọc để chỉ thấy các khoản tiền đã chuyển đi?" | `FAQ-05` | Có ý định lọc cụ thể dòng tiền ra ("tiền chuyển đi"). |
| `POS24-DEV-05` | "Tôi muốn xem danh sách các giao dịch bị thất bại thì lọc thế nào?" | `FAQ-05` | Có ý định lọc cụ thể theo trạng thái xử lý ("thất bại"). |
| `POS24-DEV-06` | "Xem phí và mã tham chiếu của một giao dịch cụ thể ở đâu?" | `FAQ-06` | **Ca bảo vệ FAQ-06:** Hỏi nơi xem biên nhận/thông số của một giao dịch cụ thể. |
| `POS24-DEV-07` | "Vừa chuyển tiền bị quay tròn trừ tiền mà chưa nhận được thì làm gì?" | `FAQ-13` | **Ca bảo vệ FAQ-13:** Báo sự cố timeout/pending sau khi gửi, hỏi bước xử lý tiếp theo. |
| `POS24-DEV-08` | "Xem chi tiết số dư khả dụng và trạng thái tài khoản nguồn ở chỗ nào?" | `FAQ-03` | **Ca bảo vệ POS-23:** Hỏi đồng thời số dư và trạng thái tài khoản nguồn $\to$ bắt buộc chọn FAQ-03. |

### 3.2. Tập Chẩn đoán Mở rộng Công khai (Public Diagnostic Set — DIAG: 8 ca)

Tập DIAG bao gồm 8 ca câu hỏi chẩn đoán công khai nhằm khảo sát tính vững chắc của ranh giới ngữ nghĩa.  
*Lưu ý về phương pháp luận:* Vì tập dữ liệu 8 ca này đã được công khai trong tài liệu thiết kế nên **không được coi là tập kiểm định mù chưa từng thấy (Unseen Blind Holdout)**. Nếu trong tương lai cần một tập Holdout độc lập thực sự để đánh giá năng lực khái quát hóa không thiên vị, tập đó phải được niêm phong riêng và tuyệt đối không đưa vào tài liệu phục vụ tinh chỉnh prompt/hint.

| Mã ca DIAG | Câu hỏi kiểm thử chẩn đoán | Expected ID | Cơ sở phân định chẩn đoán |
| :--- | :--- | :---: | :--- |
| `POS24-DIAG-01` | "Muốn tra cứu các biến động tài khoản trong tháng thì bấm vào mục nào trên Trang chủ?" | `FAQ-04` | Hỏi vị trí mục chức năng trên Trang chủ để xem biến động tài khoản. |
| `POS24-DIAG-02` | "Xem lại nhật ký các giao dịch cũ đã phát sinh từ trước đến nay ở đâu?" | `FAQ-04` | Tra cứu nhật ký giao dịch cũ tổng thể. |
| `POS24-DIAG-03` | "Cách phân loại để chỉ hiện các giao dịch nhận tiền từ người khác." | `FAQ-05` | Phân loại hiển thị chỉ giao dịch nhận tiền (dòng tiền vào). |
| `POS24-DIAG-04` | "Tôi muốn tách riêng các khoản tiền chi ra trong lịch sử để xem." | `FAQ-05` | Phân loại tách riêng tiền chi ra (dòng tiền ra). |
| `POS24-DIAG-05` | "Làm thế nào để kiểm tra riêng những giao dịch đang ở trạng thái chờ xử lý trong lịch sử?" | `FAQ-05` | Lọc theo trạng thái chờ xử lý trong màn hình lịch sử. |
| `POS24-DIAG-06` | "Tìm biên lai và thời gian hoàn tất của món tiền đã gửi hôm qua ở chỗ nào?" | `FAQ-06` | Tra cứu thông tin biên lai của một món tiền cụ thể. |
| `POS24-DIAG-07` | "App báo giao dịch đang xử lý mãi không xong, tôi có nên bấm chuyển lại không?" | `FAQ-13` | Hỏi hướng dẫn ứng xử an toàn khi giao dịch bị treo. |
| `POS24-DIAG-08` | "Kiểm tra tình trạng tài khoản thanh toán và các thông số tài khoản ở đâu?" | `FAQ-03` | Hỏi tình trạng hoạt động và thông số chi tiết của tài khoản. |

### 3.3. Các Cặp Đối chiếu Ngữ nghĩa Gần (Near-semantic Boundary Pairs)
Bộ thử nghiệm bắt buộc kiểm tra chéo các cặp câu hỏi có ranh giới dễ gây nhầm lẫn:
1. **Cặp Lịch sử chung vs Lọc chi tiết:**
   - *"Lịch sử giao dịch ở đâu"* (`FAQ-04`) $\leftrightarrow$ *"Chỉ xem tiền vào"* (`FAQ-05`).
   - *"Kiểm tra biến động số dư"* (`FAQ-04`) $\leftrightarrow$ *"Lọc giao dịch theo trạng thái"* (`FAQ-05`).
2. **Cặp Biến động số dư vs Số dư tức thời:**
   - *"Xem biến động số dư"* (`FAQ-04`) $\leftrightarrow$ *"Xem số dư khả dụng trên Trang chủ"* (`FAQ-01`).
3. **Cặp Tra cứu trạng thái giao dịch vs Sự cố Pending:**
   - *"Xem trạng thái giao dịch ở đâu"* (`FAQ-06`) $\leftrightarrow$ *"Giao dịch đang xử lý phải làm gì"* (`FAQ-13`).

---

## 4. Dự toán Ngân sách Cuộc gọi và Phân tích Thiếu hụt (Budget Gap Analysis)

### 4.1. Bảng Dự toán Ngân sách Chi tiết Cho Thử nghiệm Tiếp theo

| Đợt chạy | Đối tượng kiểm thử | Quy cách thực hiện | Số ca | Số lượt lặp | Số model calls dự kiến | Trần bảo thủ |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| **Đợt 1** | Control trên DEV | Đo đối chứng Control trên cùng tập DEV mới | 8 | 2 | **16** | 16 |
| **Đợt 2** | Candidate mới trên DEV | Kiểm chứng candidate giải quyết POS-24 | 8 | 2 | **16** | 16 |
| **Đợt 3** | Candidate mới trên DIAG | Kiểm định ranh giới trên tập chẩn đoán công khai | 8 | 2 | **16** | 16 |
| **Đợt 4** | Candidate mới trên Benchmark 56 ca | Kiểm định hồi quy 56 ca Phần C | 56 | 1 | **50** *(+6 deterministic)* | **56** *(nếu không trừ)* |
| **TỔNG CỘNG** | | | | | **98 model calls** | **104 model calls** |

- **Phân tích số liệu:**
  - Dự kiến model calls: $16 + 16 + 16 + 50 = $ **98 calls**.
  - Trần bảo thủ nhiệm vụ: $16 + 16 + 16 + 56 = $ **104 calls** (tính cả trường hợp không có shortcut deterministic nào được áp dụng).
  - **Quy trình các đợt chạy tuần tự:** Control DEV (16 calls) → Candidate DEV (16 calls) → Candidate DIAG (16 calls) → Candidate Benchmark (50-56 calls). Trong nhiệm vụ này tuyệt đối không chạy Control trên DIAG nhằm bảo toàn trần ngân sách 104 cuộc gọi.
  - **Mức ngân sách 80 calls là hoàn toàn không đủ:** Một kế hoạch chạy đối chứng đầy đủ 4 đợt đòi hỏi tối thiểu 98 calls. Nếu chỉ cấp 80 calls sẽ bị thiếu từ 18 đến 24 calls, buộc phải cắt bỏ đợt đo đối chứng Control hoặc cắt giảm Benchmark 56 ca, làm suy giảm tính nghiêm ngặt khoa học.

### 4.2. Phân tích Thiếu hụt Ngân sách Bắt buộc
- **Số dư ngân sách hiện tại:**
  - File theo dõi `documents/06-security-ai/pos23-call-budget-tracker.json` hiện đang ở mức: **98 / 104 cuộc gọi**.
  - Số cuộc gọi còn lại hợp lệ: **ĐÚNG 6 CUỘC GỌI**.
- **Kết luận:** **HIỆN TẠI HOÀN TOÀN CHƯA ĐỦ NGÂN SÁCH ĐỂ THỰC HIỆN THỬ NGHIỆM ĐỐI CHỨNG.**
  - 6 cuộc gọi còn lại không đủ chạy dù chỉ một lượt tập DEV 8 ca (cần 8 hoặc 16 calls), càng không thể chạy Benchmark 56 ca (cần 50 - 56 calls).
  - Nếu cố tình dùng 6 cuộc gọi để "thử thăm dò" vài câu riêng lẻ sẽ vi phạm nghiêm trọng nguyên tắc thử nghiệm khoa học, làm cạn kiệt ngân sách mà không có bằng chứng đối chứng hợp lệ.

### 4.3. Đề xuất Phương án Cấp Ngân sách Mới (New Ledger Proposal)
Khi nhiệm vụ được cấp thẩm quyền xem xét phê duyệt triển khai:
1. **Bảo tồn Ledger cũ:** Đóng băng tệp `pos23-call-budget-tracker.json` ở mức 98/104 cuộc gọi; không tăng hạn mức và không sửa đổi tệp này.
2. **Khởi tạo Ledger mới độc lập (New Ledger Approval):**
   - Đề xuất trần ngân sách 104 calls là một **ledger mới cần được phê duyệt độc lập**, hoàn toàn không phải là quyền tự có (entitlement) hay tự động gia hạn.
   - Khi được phê duyệt, sẽ khởi tạo tệp `documents/06-security-ai/pos24-call-budget-tracker.json` với trần tối đa **104 cuộc gọi** (dự kiến sử dụng 98 cuộc gọi).
   - Áp dụng đầy đủ cơ chế bảo vệ: `acquireEvaluatorLock` fail-closed, pre-call persistence, chặn ghi đè, và journal JSONL tăng dần (`intentJournal.ts`).
3. **Môi trường thực thi:** 100% local trên Ollama `qwen3.5:4b`, tuyệt đối không dùng cloud hay phát sinh chi phí API.

---

## 5. Quy trình Điều kiện Dừng và Nguyên tắc Thất bại Đóng (Fail-Closed)

Trong nhiệm vụ triển khai sau này, runner phải tuân thủ nghiêm ngặt các cổng điều kiện dừng (Stop Gates):

```
[Bắt đầu Thử nghiệm POS-24]
        │
        ▼
 [Đợt 1: Control DEV (16 calls)] ──(Lỗi kỹ thuật / Timeout)──► [DỪNG NGAY & BÁO LỖI]
        │
        ▼ (Hoàn tất)
 [Đợt 2: Candidate DEV (16 calls)] ──(Không đạt 100% 16/16)──► [DỪNG & HOÀN NGUYÊN]
        │
        ▼ (Đạt 16/16 CORRECT)
 [Đợt 3: Candidate DIAG (16 calls)] ──(Không đạt 100% 16/16)──► [DỪNG & HOÀN NGUYÊN]
        │
        ▼ (Đạt 16/16 CORRECT)
 [Đợt 4: Candidate Benchmark 56 ca (50-56 calls)]
        │
        ├──► Đạt < 56/56 ──────────────────────────────► [DỪNG, BẢO LƯU PARTIAL & HOÀN NGUYÊN]
        └──► Đạt 56/56 ────────────────────────────────► [NGHIỆM THU ĐẠT CHUẨN BENCHMARK]
```

### Quy định Xử lý Khi Không Đạt:
1. Nếu Candidate không đạt tiêu chuẩn tại bất kỳ đợt nào: **DỪNG NGAY LẬP TỨC**.
2. **Không tự ý retry:** Tuyệt đối không tự ý gọi lại mô hình để hy vọng kết quả may rủi.
3. **Không tự đổi nhãn:** Tuyệt đối không thay đổi expected ID sau thử nghiệm để biến câu sai thành đúng ("no post-hoc rubric change").
4. **Không tự nới lỏng siêu tham số:** Không tăng token, không tăng temperature, không nới timeout.
5. **Hoàn nguyên an toàn:** Hoàn nguyên file `responseCatalog.ts` về bản Rollback Target (Baseline Snapshot hiện tại trên đĩa); giữ nguyên dataset, tests, logs và journal trên đĩa để phục vụ điều tra.
6. **Không tự tạo Candidate thứ hai:** Nếu Candidate 1 thất bại, ghi nhận báo cáo và bàn giao lại cho người giao task quyết định.
7. **Phạm vi kết luận:** Kết quả 56/56 trên Benchmark (nếu đạt được) chỉ chứng minh hiệu quả và độ tương thích trên bộ kiểm thử cụ thể đã định nghĩa, không được tuyên bố là "PASS toàn diện" hay giải quyết triệt để mọi trường hợp ngoài thực tế.

---

## 6. Trạng thái Triển khai Công cụ Kỹ thuật (Technical Tooling Implementation Status)

Toàn bộ các thành phần công cụ phục vụ thử nghiệm POS-24 đã được xây dựng, kiểm thử và nghiệm thu trong báo cáo `assistant-pos24-offline-preparation.md`:

1. **Bộ dữ liệu POS-24 (`backend/src/tests/assistantEvaluation/pos24DisambiguationDataset.ts`):**
   - Đã tạo 8 ca DEV (`POS24_DEV_CASES`) và 8 ca DIAG (`POS24_DIAG_CASES`) khớp từng chữ với bảng kế hoạch tại Mục 3.
   - Mã băm phiên bản: `POS24_DATASET_VERSION = "pos24-disambiguation-v1.0"`.

2. **Công cụ Snapshot và Khôi phục Runtime (`backend/scripts/snapshot-assistant-runtime.ts` và `snapshotManager.ts`):**
   - Hỗ trợ tạo, xác thực và khôi phục an toàn bản sao `responseCatalog.ts` byte-for-byte dựa trên phân tích TypeScript AST tĩnh (không `eval`, không thực thi code).
   - Kiểm tra chẩn đoán TypeScript `sourceFile.parseDiagnostics`, đối chiếu cấu trúc AST cố định (Fixed-structure AST allowlist), chặn đứng Probe A1 (`.join` không phải chuỗi `\n`), Probe A2 & B1 (sửa hàm hoặc đối số `sha256`), Probe B2-B5 (injected IIFEs), Probe B3 (sửa công thức hash), và Probe B6 (unauthorized imports). Danh sách import cho phép là `node:crypto` và `./knowledgeBundle.js`.
   - Cơ chế tạo snapshot độc quyền (`flag: "wx"`), ngăn chặn đè file đồng thời hoặc trùng lặp.
   - Loại bỏ hoàn toàn cờ `--force` khỏi CLI và API; restore bắt buộc chỉ định rõ `--target`, `--workspace` và kiểm tra khớp mã băm hiện tại `--expected-current-hash`.
   - Đối chiếu bắt buộc với tệp tham chiếu 25 câu trả lời đã khóa độc lập (`pos24-reference-catalog.json`).
   - Lệnh CLI:
     ```bash
     # Tạo snapshot độc quyền
     npx tsx scripts/snapshot-assistant-runtime.ts --create --name=<name> --role=rollback_target --out=<dir>
     # Xác thực snapshot với AST và reference catalog
     npx tsx scripts/snapshot-assistant-runtime.ts --verify --file=<path>
     # Khôi phục an toàn (bắt buộc expected-current-hash, target và workspace)
     npx tsx scripts/snapshot-assistant-runtime.ts --restore --file=<path> --target=<path> --workspace=<dir> --expected-current-hash=<hash>
     ```

3. **Điều phối Thử nghiệm POS-24 và Runner (`backend/scripts/evaluate-assistant-intent.ts` và `pos24Orchestrator.ts`):**
   - Đã hỗ trợ các suite: `--suite=pos24-dev`, `--suite=pos24-diag`, `--suite=pos24-benchmark`.
   - Hỗ trợ pipeline điều phối 4 giai đoạn tự động qua cờ: `--workflow=pos24-offline`.
   - Thực thi các Stop Gates thực tế: Dừng ngay khi Control gặp lỗi kỹ thuật; dừng ngay khi Candidate có lỗi kỹ thuật hoặc lựa chọn sai.
   - Đã tích hợp **Fail-Closed Live Guard**: Chặn đứng việc chạy live POS-24 trước khi có phê duyệt ngân sách.
   - Chuẩn hóa layout và kiểm soát ranh giới workspace qua `pos24Workspace.ts`, chống thoát tiền tố thư mục anh em (`ws` vs `ws-evil`) và từ chối lock tùy biến xung đột.

4. **Trạng thái Ledger Ngân sách và Concurrency Lock:**
   - Ledger cũ `pos23-call-budget-tracker.json` giữ nguyên đóng băng ở mức **98/104 cuộc gọi**.
   - Bất biến bảo toàn dữ liệu ledger: Workspace có ledger cũ từ chối chạy đè và bảo toàn 100% byte dữ liệu cũ.
   - Trần ngân sách mặc định được thiết lập ở mức 104 cuộc gọi.
   - Mở khối `try/finally` ngay lập tức sau khi có lock; đóng stage journal trong `finally`.
   - Ledger mới `pos24-call-budget-tracker.json` chưa được tạo; chỉ được tạo khi có phê duyệt ngân sách độc lập từ project owner.

---

## 7. Kết luận Kế hoạch

- Kế hoạch thử nghiệm POS-24 đã hoàn thành **100% phần chuẩn bị công cụ offline** (toàn bộ 17 bài test trong `pos24OfflinePreparation.test.ts` đã PASS, 0 cuộc gọi mô hình trong phiên).
- **Trạng thái ba chiều:**
  - Công cụ offline: **OFFLINE_TOOLING_PASS**
  - Nội dung AI: **AI_CONTENT_PARTIAL** (chưa tối ưu trên mô hình thật)
  - Chạy trực tiếp: **LIVE_POS24_NOT_RUN** (chưa cấp ngân sách, fail-closed)
- **Điều kiện duy nhất còn lại để triển khai nhiệm vụ live:**
  - **Cấp thẩm quyền phê duyệt riêng Ledger ngân sách mới:** Tối đa 104 cuộc gọi mô hình Qwen local (dự kiến 98 calls cho 4 đợt thử nghiệm đối chứng).
- Trước khi có phê duyệt này, hệ thống giữ nguyên hiện trạng, fail-closed đối với mọi lệnh gọi live POS-24, và bảo toàn phiên bản Runtime Baseline trên đĩa.


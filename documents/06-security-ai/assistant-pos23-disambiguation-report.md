# BÁO CÁO THỰC NGHIỆM GIẢM NHẦM LẪN POS-23 GIỮA FAQ-01 VÀ FAQ-03

**Mã tài liệu:** `documents/06-security-ai/assistant-pos23-disambiguation-report.md`  
**Phiên bản:** v1.1.0  
**Ngày thực hiện:** 2026-09-23  
**Trạng thái nhiệm vụ:** **PARTIAL** (Dừng kiểm nghiệm tại vòng DEV do không đạt 24/24 tuyệt đối; Candidate 2 bị cấm theo quy định; Runtime prompt/hints đã hoàn nguyên về snapshot nguyên bản)  
**Phạm vi:** Trợ lý NOVA — Phân định ý định giữa FAQ-01 và FAQ-03 cho ca POS-23  
**Môi trường:** Local Academic Sandbox (Ollama loopback `127.0.0.1:11434`, model `qwen3.5:4b`, digest `2a654d98e6fb`)  
**Ngân sách POS-23:** Đã cấp tối đa 104 calls; Đã dùng thực tế: 24 calls; Còn lại: 80 calls; Độc lập với 139 calls lịch sử; Chi phí dịch vụ ngoài: 0 VND (0 external AI calls).

---

## 1. Mục tiêu và Bối cảnh POS-23

### 1.1. Hiện trạng ca POS-23 trong Benchmark lịch sử
Trong bộ benchmark 56 ca của Trợ lý NOVA (`documents/06-security-ai/assistant-intent-evaluation-nova-intent-benchmark-20260923092138045-9974bf01-c9b5-4711-9acb-e1901e7fc1cb.json`), ca **POS-23** là trường hợp duy nhất bị phân loại sai:
- **Câu hỏi người dùng:** *"Xem chi tiết số dư khả dụng và trạng thái tài khoản nguồn ở chỗ nào?"*
- **Expected Catalog ID:** `FAQ-03` (*Xem chi tiết tài khoản thanh toán*).
- **Actual Model Selection (lịch sử):** `FAQ-01` (*Xem/ẩn nhanh số dư tài khoản thanh toán trên Trang chủ*).
- **Phân định hai khía cạnh độc lập:**
  1. *Lỗi lựa chọn ID (Selection Error):* Model chọn sai `FAQ-01` thay vì `FAQ-03`.
  2. *Độ đáp ứng của nội dung câu trả lời (Answer Sufficiency):* Nội dung của `FAQ-01` chỉ hướng dẫn bấm biểu tượng con mắt trên Trang chủ để xem/ẩn nhanh số dư khả dụng, hoàn toàn KHÔNG cung cấp thông tin về trạng thái tài khoản nguồn (đang hoạt động, tạm khóa, đóng). Trong khi đó, `FAQ-03` hướng dẫn vào màn hình *Chi tiết tài khoản*, nơi hiển thị đầy đủ cả số dư khả dụng lẫn trạng thái tài khoản và các thông tin định danh tài khoản. Do đó, `FAQ-01` không đáp ứng đầy đủ câu hỏi của người dùng.

### 1.2. Ranh giới Phân định Ngữ nghĩa Cốt lõi
Đối chiếu trực tiếp từ tài liệu nghiệp vụ FAQ nguồn (`documents/06-security-ai/assistant-help-faq.md`) và mã nguồn catalog (`backend/src/assistant/responseCatalog.ts`):

| Ý định người dùng | FAQ phù hợp | Thông tin & Thao tác được cung cấp | Nguồn chứng minh thực tế |
| :--- | :---: | :--- | :--- |
| **Xem nhanh / ẩn hiện số dư** | `FAQ-01` | Bấm biểu tượng con mắt cạnh số dư trên Trang chủ để xem/ẩn nhanh số dư khả dụng và hiện tại. | `FAQ-01` (Trang chủ > biểu tượng con mắt). |
| **Xem / sao chép số tài khoản** | `FAQ-02` | Bấm biểu tượng sao chép cạnh số tài khoản trên Trang chủ hoặc vào Chi tiết tài khoản. | `FAQ-02` (Trang chủ/Chi tiết tài khoản > Sao chép). |
| **Chi tiết & trạng thái tài khoản** | `FAQ-03` | Vào màn hình *Chi tiết tài khoản* xem số tài khoản, tên chủ tài khoản, ngân hàng, loại tiền, trạng thái tài khoản và số dư chi tiết. | `FAQ-03` (Trang chủ > Tài khoản thanh toán > Chi tiết tài khoản). |
| **Đồng thời hỏi số dư VÀ trạng thái tài khoản** | `FAQ-03` | Màn hình *Chi tiết tài khoản* đáp ứng trọn vẹn cả số dư lẫn trạng thái tài khoản nguồn (trong khi `FAQ-01` chỉ hiển thị số dư, không có trạng thái). | Đối chiếu `FAQ-01` vs `FAQ-03`. |
| **Trạng thái giao dịch vừa chuyển tiền** | `FAQ-06` / `FAQ-05` / `FAQ-13` | Trạng thái giao dịch (thành công, thất bại, đang xử lý) thuộc Lịch sử giao dịch (`FAQ-05`) hoặc tra cứu phí/mã tham chiếu (`FAQ-06`), KHÔNG phải trạng thái tài khoản nguồn (`FAQ-03`). | `FAQ-05`, `FAQ-06`, `FAQ-13`. |

*Lưu ý ràng buộc:*
- Không sử dụng từ "chi tiết" đơn lẻ để ép gán cứng sang `FAQ-03` (tránh over-fitting).
- Giữ nguyên expected ID của benchmark 56 ca (`POS-23` $\rightarrow$ `FAQ-03`), không sửa câu hỏi hay hạ rubric để pass nhân tạo.

---

## 2. Snapshot Baseline Trước Nhiệm vụ và Tính Bất biến

Trước khi triển khai bất kỳ thay đổi nào, toàn bộ trạng thái baseline đã được chụp và tính toán checksum cryptographic để bảo đảm khả năng hoàn nguyên chính xác tuyệt đối:

### 2.1. Git Snapshot & Cấu hình Runtime
- **Git HEAD commit:** `9c585ce336ee5867557f89862bc8e07be3c0ca83`
- **Mô hình phục vụ:** Ollama `qwen3.5:4b` (digest: `2a654d98e6fb5ae556e426615b13813959c9977b31ddb069d3e5e4125b42d763`)
- **Tham số runtime (giữ cố định 100%):**
  - `temperature`: `0.1`
  - `num_predict`: `530`
  - `num_ctx`: `8192`
  - `format`: `"json"`
  - `endpoint`: `http://127.0.0.1:11434`
- **Tình trạng WIP có trước:** Giữ nguyên các tệp uncommitted của các use-case khác (`PROJECT_CONTEXT.md`, `USE_CASE_ROADMAP.md`, `backend/package.json`, `backend/src/database/disposableDatabaseGuard.ts`, `backend/src/http.ts`, `backend/src/server.ts`, `backend/src/tests/kycContract.test.ts`, `documents/api/banking-mvp.openapi.yaml`). Không sử dụng `git checkout`, `git reset`, `git restore` hay `git clean`.

### 2.2. Bảng Mã băm (SHA-256 Hashes) Cố định
| Thành phần | SHA-256 Checksum | Trạng thái |
| :--- | :--- | :--- |
| **Baseline Selector Prompt** | `32d40a43d5e67de9f1c126be46d6e8ec88091e0c6d3dcb61e62f67cef95b5418` | Khóa cứng trước thử nghiệm & Khôi phục nguyên bản sau thử nghiệm |
| **Baseline Catalog Hash** | `7a5560870f47c2dd7da685869a97391604a100d1063813e5b22ba82c792ab85d` | Khóa cứng trước thử nghiệm & Khôi phục nguyên bản sau thử nghiệm |
| **Selection Policy (`selectionPolicy.ts`)** | `d942fb8355648f86f7c68832a8ba713028d6174a7ae851b4c90e0b961239c0f9` | Không thay đổi |
| **Baseline Intent Dataset (24 ca)** | `5f893630f5761bc99feff991d9d9685a73e6cf1e4a6e87f87ae19f564dc5e840` | Không thay đổi |
| **25/25 Answer Text Catalog** | Bộ 25 mã băm chuẩn trong `VERIFIED_ANSWER_HASHES` | 100% khớp, không sửa bất kỳ ký tự nào |

---

## 3. Bộ Dữ liệu Kiểm thử Độc lập POS-23 (POS23 Dataset)

Nhằm đánh giá khách quan khả năng phân định ngữ nghĩa giữa `FAQ-01` và `FAQ-03`, một bộ dữ liệu mới gồm **24 ca** (12 DEV + 12 HOLDOUT) đã được biên soạn và khóa cứng tại tệp [pos23DisambiguationDataset.ts](file:///c:/Projects/banking-system/backend/src/tests/assistantEvaluation/pos23DisambiguationDataset.ts) trước khi điều chỉnh prompt candidate:

- **Mã băm SHA-256 DEV Dataset (12 ca):** `7061abf060f837b150da15bceeb57a0436f6181e0a1aa63dbb3c14f7e04058d7`
- **Mã băm SHA-256 HOLDOUT Dataset (12 ca):** `82a6d698b1a901d6cd355d262706ed85a9f665aaacb8b6ce4fd169986ec29311`
- **Mã băm toàn bộ file dataset:** `b71d0545c300d2151b48f5a29bfbdd692b3c117a13cb41515c0a45a4a6642dab`

### 3.1. Danh mục 12 ca Development (DEV)
| Mã ca | Nhóm ý định | Câu hỏi kiểm thử | Expected ID | Căn cứ nghiệp vụ nguồn |
| :--- | :--- | :--- | :---: | :--- |
| `POS23-DEV-01` | A: Xem nhanh/ẩn số dư | *Cho tôi hỏi cách xem số dư hiện tại trên trang chủ thế nào?* | `FAQ-01` | Thao tác xem nhanh số dư trên Trang chủ. |
| `POS23-DEV-02` | A: Xem nhanh/ẩn số dư | *Làm sao để ẩn số tiền đang có trên màn hình chính đi cho đỡ lộ?* | `FAQ-01` | Ẩn số dư trên Trang chủ bằng biểu tượng con mắt. |
| `POS23-DEV-03` | A: Xem nhanh/ẩn số dư | *Bấm vào đâu ở trang chủ để mở lại mắt xem số dư khả dụng?* | `FAQ-01` | Biểu tượng con mắt cạnh số dư Trang chủ. |
| `POS23-DEV-04` | B: Chi tiết & trạng thái | *Xem thông tin chi tiết tài khoản thanh toán ở mục nào?* | `FAQ-03` | Màn hình Chi tiết tài khoản. |
| `POS23-DEV-05` | B: Chi tiết & trạng thái | *Tôi muốn kiểm tra trạng thái tài khoản nguồn của mình đang hoạt động hay bị khóa ở đâu?* | `FAQ-03` | Trạng thái tài khoản nguồn nằm trong Chi tiết tài khoản. |
| `POS23-DEV-06` | B: Chi tiết & trạng thái | *Làm thế nào để biết thông tin loại tiền và trạng thái tài khoản ngân hàng của tôi?* | `FAQ-03` | Loại tiền và trạng thái tài khoản nằm trong Chi tiết tài khoản. |
| `POS23-DEV-07` | C: Số dư + Trạng thái | *Xem chi tiết số dư và trạng thái tài khoản nguồn ở đâu?* | `FAQ-03` | Câu hỏi cần cả 2 thông tin; chỉ `FAQ-03` đáp ứng cả 2. |
| `POS23-DEV-08` | C: Số dư + Trạng thái | *Tôi muốn kiểm tra số dư khả dụng cùng với tình trạng tài khoản nguồn đang hoạt động không thì vào đâu?* | `FAQ-03` | Cần số dư + tình trạng tài khoản nguồn $\rightarrow$ `FAQ-03`. |
| `POS23-DEV-09` | C: Số dư + Trạng thái | *Mục nào hiển thị cả số dư tài khoản thanh toán lẫn trạng thái hoạt động của tài khoản?* | `FAQ-03` | Hiển thị cả 2 thông tin $\rightarrow$ `FAQ-03`. |
| `POS23-DEV-10` | D: Chủ đề lân cận | *Làm sao để xem và sao chép số tài khoản của tôi để gửi cho người khác?* | `FAQ-02` | Sao chép số tài khoản $\rightarrow$ `FAQ-02`. |
| `POS23-DEV-11` | D: Chủ đề lân cận | *Xem trạng thái giao dịch vừa chuyển tiền là thành công hay đang xử lý ở đâu?* | `FAQ-06` | Trạng thái giao dịch chuyển tiền (phí/mã tham chiếu) $\rightarrow$ `FAQ-06`. |
| `POS23-DEV-12` | D: Chủ đề lân cận | *Tôi muốn xem lịch sử biến động số dư và tiền vào gần đây thì xem ở đâu?* | `FAQ-05` | Lịch sử tiền vào/tiền ra $\rightarrow$ `FAQ-05`. |

### 3.2. Danh mục 12 ca Holdout (HOLDOUT)
| Mã ca | Nhóm ý định | Câu hỏi kiểm thử | Expected ID | Căn cứ nghiệp vụ nguồn |
| :--- | :--- | :--- | :---: | :--- |
| `POS23-HLD-01` | A: Xem nhanh/ẩn số dư | *Có cách nào che bớt số dư trên màn hình chính khi đang ở chỗ đông người không?* | `FAQ-01` | Che/ẩn số dư Trang chủ. |
| `POS23-HLD-02` | A: Xem nhanh/ẩn số dư | *Tôi muốn bật hiện số dư tài khoản thanh toán ở trang chủ thì thao tác thế nào?* | `FAQ-01` | Hiện số dư Trang chủ. |
| `POS23-HLD-03` | A: Xem nhanh/ẩn số dư | *Biểu tượng con mắt ở màn hình chính có tác dụng gì và xem số dư thế nào?* | `FAQ-01` | Biểu tượng con mắt Trang chủ. |
| `POS23-HLD-04` | B: Chi tiết & trạng thái | *Xem tên chủ tài khoản và trạng thái hiện tại của tài khoản thanh toán ở đâu?* | `FAQ-03` | Tên chủ TK và trạng thái $\rightarrow$ Chi tiết tài khoản. |
| `POS23-HLD-05` | B: Chi tiết & trạng thái | *Màn hình nào cho biết tài khoản ngân hàng của tôi đang hoạt động bình thường hay tạm dừng?* | `FAQ-03` | Trạng thái hoạt động tài khoản $\rightarrow$ Chi tiết tài khoản. |
| `POS23-HLD-06` | B: Chi tiết & trạng thái | *Tôi muốn xem chi tiết thông tin tài khoản nguồn gồm chi nhánh và loại tiền tệ ở mục nào?* | `FAQ-03` | Chi tiết tài khoản nguồn $\rightarrow$ Chi tiết tài khoản. |
| `POS23-HLD-07` | C: Số dư + Trạng thái | *Chỗ nào trong ứng dụng cho xem số dư khả dụng kèm trạng thái hoạt động của tài khoản?* | `FAQ-03` | Cả số dư và trạng thái tài khoản $\rightarrow$ `FAQ-03`. |
| `POS23-HLD-08` | C: Số dư + Trạng thái | *Kiểm tra số dư hiện tại và xem tài khoản thanh toán có đang bị khóa hay không ở đâu?* | `FAQ-03` | Cả số dư và kiểm tra tài khoản bị khóa $\rightarrow$ `FAQ-03`. |
| `POS23-HLD-09` | C: Số dư + Trạng thái | *Tôi cần xem chi tiết số dư cùng với tình trạng tài khoản nguồn thì vào phần nào?* | `FAQ-03` | Số dư chi tiết + tình trạng tài khoản $\rightarrow$ `FAQ-03`. |
| `POS23-HLD-10` | D: Chủ đề lân cận | *Sao chép nhanh số tài khoản ngân hàng để nhận tiền chuyển khoản thế nào?* | `FAQ-02` | Sao chép số tài khoản $\rightarrow$ `FAQ-02`. |
| `POS23-HLD-11` | D: Chủ đề lân cận | *Giao dịch vừa chuyển tiền của tôi đang ở trạng thái nào, xem kết quả ở đâu?* | `FAQ-06` | Kết quả/trạng thái giao dịch $\rightarrow$ `FAQ-06`. |
| `POS23-HLD-12` | D: Chủ đề lân cận | *Làm sao kiểm tra danh sách các món tiền vừa nhận được vào tài khoản?* | `FAQ-05` | Lịch sử giao dịch tiền vào $\rightarrow$ `FAQ-05`. |

*Cam kết nguyên tắc:* Không đưa câu hỏi kiểm thử hay ID ca vào prompt. Không dùng nguyên văn POS-23 làm mẫu. Không chỉnh nhãn HOLDOUT.

---

## 4. Kiểm thử Kỹ thuật Trước khi Gọi Model

Trước khi tiến hành chạy mô hình cục bộ, các bài kiểm tra kỹ thuật sau được thực thi bảo đảm an toàn hệ thống:
1. **Kiểm tra 25/25 Answer Text:** Toàn bộ 25 mục catalog khớp mã băm SHA-256 baseline (`T-01` PASS).
2. **Kiểm thử Fail-Closed:** ID không hợp lệ, chuỗi JSON rỗng hoặc văn bản tự do ngoài JSON schema đều bị chặn fail-closed (`T-07`, `T-08` PASS).
3. **Bổ sung Regression Test `T-09` cho `buildIntentSummary`:**
   - Đã thêm bài test `T-09` trong [intentDisambiguation.test.ts](file:///c:/Projects/banking-system/backend/src/tests/intentDisambiguation.test.ts) kiểm tra trường hợp runner có 1 lượt gọi model thành công và 1 lượt gọi model bị lỗi kỹ thuật (`technical_error`).
   - Kết quả xác minh: `modelTotal = 2`, `modelCorrect = 1`, `technicalFail = 1`. Mẫu số `modelTotal` bao quát đầy đủ cả các lượt model thất bại kỹ thuật, không bỏ sót hay chia sai.
4. **Bảo vệ Bộ Đếm Ngân Sách Khi Gián Đoạn / Lỗi (`T-10`, `T-11`):**
   - Đã chuẩn hóa hàm `readPos23Budget` fail-closed: từ chối chạy khi tệp tracker hỏng JSON hoặc sai schema; không âm thầm reset về 0.
   - Hàm `createBudgetTrackingProvider` ghi nhận và lưu đĩa trực tiếp TRƯỚC mỗi lời gọi model, bảo đảm nếu tiến trình bị ngắt hoặc lỗi giữa chừng thì các lượt đã gọi vẫn được lưu vết đầy đủ.
   - Bổ sung 2 bài test kỹ thuật `T-10` và `T-11` trong [intentDisambiguation.test.ts](file:///c:/Projects/banking-system/backend/src/tests/intentDisambiguation.test.ts) kiểm chứng cơ chế fail-closed và pre-call persistence.

---

## 5. Triển khai Candidate Duy nhất & Kết quả Thực nghiệm

### 5.1. Thiết kế Candidate và Đối soát Mã Băm Thực Tế
Candidate duy nhất được áp dụng nhằm làm rõ ranh giới ngữ nghĩa giữa `FAQ-01` và `FAQ-03` mà không thêm quy tắc deterministic cứng:
1. **Tinh chỉnh `selectionHint` của `FAQ-01`:**
   *"Xem hoặc ẩn nhanh số dư tài khoản thanh toán (khả dụng, hiện tại) bằng biểu tượng con mắt trên Trang chủ (chỉ thao tác xem/ẩn số dư nhanh, không có thông tin chi tiết hay trạng thái tài khoản)."*
2. **Tinh chỉnh `selectionHint` của `FAQ-03`:**
   *"Mở màn hình Chi tiết tài khoản để xem thông tin chi tiết (tên chủ tài khoản, ngân hàng, loại tiền), trạng thái tài khoản nguồn và số dư chi tiết."*
3. **Bổ sung Quy tắc Phân định Tổng quát trong `ASSISTANT_SELECTOR_PROMPT`:**
   *"Phân biệt xem số dư và thông tin tài khoản: FAQ-01 chỉ dùng cho thao tác xem/ẩn nhanh số dư trên Trang chủ. FAQ-03 dùng khi người dùng hỏi chi tiết/thông tin/trạng thái tài khoản nguồn. Khi câu hỏi cần CẢ số dư VÀ trạng thái tài khoản nguồn, chọn FAQ-03 vì màn hình Chi tiết tài khoản đáp ứng cả hai. Không nhầm trạng thái giao dịch (FAQ-05/FAQ-06/FAQ-13) với trạng thái tài khoản (FAQ-03)."*

**Đối chiếu mã băm thực nghiệm (Khớp 100% với JSON bằng chứng):**
- **`selectorPromptHash` (Thực tế thực nghiệm):** `a1f5df98c2c83a4c5675a957991b5d1bfb9b968c566406b04e1388293e4b86e5`
- **`catalogHash` (Thực tế thực nghiệm):** `c63c8f8c3dc9171b10be501cb6bba20519e448f613ace7a37ef3f5895c61c563`
*(Lưu ý: Mã `ae98f121...` ghi nhận trước đó là mã băm của bản nháp trung gian trong quá trình soạn thảo; tệp JSON bằng chứng thực nghiệm lưu giữ mã `a1f5df98...` và được giữ nguyên vẹn).*

### 5.2. Quản lý Ngân sách Model Call (POS-23 Budget Tracker)
- **Tệp theo dõi:** [pos23-call-budget-tracker.json](file:///c:/Projects/banking-system/documents/06-security-ai/pos23-call-budget-tracker.json)
- **Ngân sách cấp mới:** 104 calls.
- **Lượt gọi tiêu thụ vòng DEV:** 24 calls (12 ca $\times$ 2 lượt).
- **Lũy kế tiêu thụ toàn nhiệm vụ:** 24 calls.
- **Ngân sách còn lại:** 80 calls.
- **Số lượt gọi bên ngoài (Cloud / Paid API):** 0 calls.

### 5.3. Kết quả Thực nghiệm Vòng DEV (12 ca $\times$ 2 passes)
- **Run ID:** `nova-intent-pos23-dev-20260923095227419-d3a7dc34-3e83-4b38-8235-2edc20d92b6c`
- **Tệp bằng chứng:**
  - JSON: [assistant-intent-evaluation-nova-intent-pos23-dev-20260923095227419-d3a7dc34-3e83-4b38-8235-2edc20d92b6c.json](file:///c:/Projects/banking-system/documents/06-security-ai/assistant-intent-evaluation-nova-intent-pos23-dev-20260923095227419-d3a7dc34-3e83-4b38-8235-2edc20d92b6c.json)
  - Markdown: [assistant-intent-evaluation-nova-intent-pos23-dev-20260923095227419-d3a7dc34-3e83-4b38-8235-2edc20d92b6c.md](file:///c:/Projects/banking-system/documents/06-security-ai/assistant-intent-evaluation-nova-intent-pos23-dev-20260923095227419-d3a7dc34-3e83-4b38-8235-2edc20d92b6c.md)

#### Bảng Tổng hợp Chỉ số DEV:
| Chỉ số đánh giá | Giá trị đạt được | Tỷ lệ | Đánh giá |
| :--- | :---: | :---: | :--- |
| **Số ca hoàn tất kỹ thuật (Technical Completion)** | 24 / 24 | 100.0% | Tuyệt đối không có timeout, lỗi kết nối hay malformed JSON |
| **Độ chính xác luồng Tất định (Deterministic)** | 0 / 0 | N/A | Đúng thiết kế (100% ca đi qua model) |
| **Độ chính xác luồng Mô hình (Model Qwen)** | 22 / 24 | **91.7%** | 22 lượt đúng, 2 lượt sai |
| **Độ chính xác toàn hệ sinh thái (Overall)** | 22 / 24 | **91.7%** | Không đạt tiêu chuẩn tuyệt đối 24/24 |

#### Chi tiết Kết quả theo Từng Nhóm Ngữ nghĩa:
1. **Nhóm A (Xem nhanh/ẩn số dư Trang chủ):** **6 / 6 (100.0%) ĐÚNG**. Cả 3 ca `POS23-DEV-01`, `POS23-DEV-02`, `POS23-DEV-03` đều chọn chính xác `FAQ-01` trong cả 2 lượt chạy.
2. **Nhóm B (Chi tiết & trạng thái tài khoản):** **6 / 6 (100.0%) ĐÚNG**. Cả 3 ca `POS23-DEV-04`, `POS23-DEV-05`, `POS23-DEV-06` đều chọn chính xác `FAQ-03` trong cả 2 lượt chạy.
3. **Nhóm C (Kết hợp cả số dư VÀ trạng thái tài khoản):** **6 / 6 (100.0%) ĐÚNG**. Cả 3 ca `POS23-DEV-07`, `POS23-DEV-08`, `POS23-DEV-09` đều chọn chính xác `FAQ-03` trong cả 2 lượt chạy. *Lưu ý: Kết quả này chỉ chứng minh candidate chọn đúng ba câu trong nhóm C qua hai lượt trên tập DEV; ca POS-23 trong benchmark và tập HOLDOUT chưa được chạy.*
4. **Nhóm D (Chủ đề lân cận):** **4 / 6 (66.7%)**.
   - `POS23-DEV-10` (Sao chép STK): 2/2 chọn `FAQ-02` (ĐÚNG).
   - `POS23-DEV-12` (Lịch sử tiền vào): 2/2 chọn `FAQ-05` (ĐÚNG).
   - `POS23-DEV-11` (Trạng thái giao dịch vừa chuyển tiền): **0/2** (SAI). Cả 2 lượt chạy model đều chọn `FAQ-13` thay vì `FAQ-06`.

### 5.4. Đánh giá Ca `POS23-DEV-11` và Nhận Định Khách Quan
- **Câu hỏi:** *"Xem trạng thái giao dịch vừa chuyển tiền là thành công hay đang xử lý ở đâu?"*
- **Expected ID:** `FAQ-06` (*Xem phí, trạng thái và mã tham chiếu của giao dịch ở đâu?*).
- **Actual Model Selection:** `FAQ-13` (*Nếu màn hình kết quả đang xử lý thì tiền đã chuyển chưa?*).
- **Nhận định khách quan:**
  - Do chưa có dữ liệu baseline đối chứng trên chính câu hỏi `POS23-DEV-11` nên chưa thể kết luận đây là "hiệu ứng phụ do candidate gây ra".
  - Kết luận trung thực: **Candidate đạt 22/24 lượt DEV, còn nhầm FAQ-06 với FAQ-13; chưa đủ bằng chứng xác nhận sửa POS-23 hoặc kết luận nguyên nhân lỗi.**

---

## 6. Tuân thủ Điều kiện Dừng & Hoàn nguyên An toàn

Căn cứ theo Mục 7 và Mục 9 của Nhiệm vụ:
1. **Điều kiện chuyển bước sang HOLDOUT:**
   Yêu cầu bắt buộc là *Tất cả các ca DEV phải chọn đúng (24/24)*, không có lỗi kỹ thuật.
   $\rightarrow$ Kết quả DEV đạt **22/24**, không thỏa mãn điều kiện 24/24.
2. **Quy định xử lý khi không đạt:**
   - Dừng ngay thực nghiệm, **KHÔNG chạy HOLDOUT**, **KHÔNG chạy Benchmark**.
   - **CẤM tạo Candidate thứ hai**, không tăng token context, không thử nghiệm lặp lại.
   - **Hoàn nguyên runtime prompt và selection hints về snapshot baseline ban đầu** bằng thao tác chỉnh sửa có mục tiêu (targeted edit) trên mã nguồn [responseCatalog.ts](file:///c:/Projects/banking-system/backend/src/assistant/responseCatalog.ts).
   - Giữ lại toàn bộ dataset mới, bộ test kỹ thuật, tệp theo dõi ngân sách và báo cáo thực nghiệm phục vụ công tác đối soát, điều tra.

### 6.1. Bằng chứng Hoàn nguyên Runtime Prompt/Hints
Do thư mục `backend/src/assistant/` là untracked trong git của phiên làm việc này, `git diff` rỗng không phản ánh trạng thái hoàn nguyên. Bằng chứng hoàn nguyên thực sự và chính xác là việc tính toán và đối chiếu mã băm cryptographic:
- **`ASSISTANT_SELECTOR_PROMPT_HASH` sau hoàn nguyên:** `32d40a43d5e67de9f1c126be46d6e8ec88091e0c6d3dcb61e62f67cef95b5418` (Khớp chính xác baseline lịch sử).
- **`ANSWER_CATALOG_HASH` sau hoàn nguyên:** `7a5560870f47c2dd7da685869a97391604a100d1063813e5b22ba82c792ab85d` (Khớp chính xác baseline lịch sử).

### 6.2. Kiểm tra Đồng bộ Sau Hoàn nguyên (Quality Gates)
Các bài kiểm tra đã được thực hiện sau khi hoàn nguyên và đều vượt qua:
- `npm run typecheck`: **PASS** (0 lỗi TypeScript).
- `npx tsx --test src/tests/intentDisambiguation.test.ts`: **PASS 12 / 12 tests** (bao gồm `T-09` kiểm tra mẫu số modelTotal khi lỗi kỹ thuật, `T-10` kiểm tra tracker fail-closed khi file hỏng, và `T-11` kiểm tra lưu ngân sách trước mỗi lời gọi khi có gián đoạn).
- Tuân thủ hướng dẫn: Không chạy lại `npm run build` hoặc suite 73 test (`test:assistant`).

---

## 7. Bảng Đối chiếu Lịch sử vs Thực nghiệm Mới

| Hạng mục đối chiếu | Đợt đánh giá Lịch sử (Baseline Benchmark) | Thực nghiệm POS-23 Mới (Vòng DEV) |
| :--- | :--- | :--- |
| **Mục đích** | Đánh giá phân định ý định toàn diện trên 56 ca benchmark | Kiểm nghiệm phân định ngữ nghĩa FAQ-01 vs FAQ-03 trên dataset mới 12 ca |
| **Tập dữ liệu** | 56 ca benchmark (`documents/06-security-ai/assistant-help-faq.md`) | 12 ca DEV chuyên biệt (`pos23DisambiguationDataset.ts`) |
| **Số model calls** | 139 calls (Tổng lũy kế lịch sử) | 24 calls (Độc lập, lưu tại `pos23-call-budget-tracker.json`) |
| **Ngân sách còn lại** | 1 call (trong ngân sách 140 cũ) | 80 calls (trong ngân sách 104 mới) |
| **Kết quả POS-23** | `FAQ-01` (Sai - Expected `FAQ-03`) | Chưa chạy lại trên benchmark 56 ca |
| **Kết quả DEV Nhóm C** | Chưa có | 6/6 `FAQ-03` (Đúng trên 3 câu DEV qua 2 lượt) |
| **Kết quả DEV-11** | Chưa có | 0/2 lượt chọn `FAQ-13` thay vì `FAQ-06` |
| **Trạng thái kết luận** | **PARTIAL** (Đạt 98.2% benchmark, còn POS-23) | **PARTIAL** (DEV đạt 91.7%, dừng kiểm nghiệm theo quy định) |
| **Trạng thái Runtime** | Giữ phiên bản v0.4 đã audit | Đã hoàn nguyên về snapshot nguyên bản `32d40a43...` |

---

## 8. Kết luận và Bàn giao Kỹ thuật

1. **Về kết quả thực nghiệm:**
   Candidate đạt 22/24 lượt DEV, còn nhầm `FAQ-06` với `FAQ-13`; chưa đủ bằng chứng xác nhận sửa POS-23 hoặc kết luận nguyên nhân lỗi.
2. **Về quy trình an toàn:**
   Khi kết quả DEV không đạt 24/24 tuyệt đối, điều kiện dừng đã được kích hoạt đúng đắn. Không chạy Candidate 2, không chạy HOLDOUT hay Benchmark.
3. **Về trạng thái mã nguồn:**
   - Mã nguồn runtime `responseCatalog.ts` đã được đưa về trạng thái baseline ban đầu (`Prompt Hash: 32d40a43...`, `Catalog Hash: 7a556087...`).
   - 25 answer text hoàn toàn không thay đổi.
   - Toàn bộ dataset mới 24 ca, các công cụ runner/tracker được bảo vệ fail-closed và pre-call persistence, cùng bộ test kỹ thuật `T-09`, `T-10`, `T-11` được lưu giữ phục vụ nghiên cứu tiếp theo.
   - Xác nhận 100% cuộc gọi thực hiện qua endpoint loopback nội bộ của Ollama, 0 external AI calls, 0 VND chi phí.

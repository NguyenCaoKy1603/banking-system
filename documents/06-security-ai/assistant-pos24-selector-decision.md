# Rà soát POS-24 và Quyết định Thiết kế Selector Trợ lý NOVA

**Mã tài liệu:** `documents/06-security-ai/assistant-pos24-selector-decision.md`  
**Phiên bản:** v1.0.0  
**Ngày lập:** 2026-09-24  
**Chế độ thực hiện:** Audit Offline + Quyết định Thiết kế Kỹ thuật (Design Decision)  
**Trạng thái triển khai code/runtime:** **CHƯA TRIỂN KHAI — GIỮ RUNTIME BASELINE NGUYÊN TRẠNG**  
**Trạng thái chất lượng nội dung AI:** **PARTIAL** (Bảo lưu baseline; không chạy benchmark; 0 cuộc gọi mô hình)  
**Ngân sách model-call thực tế:** **0** (Hoàn toàn offline; không gọi Ollama, preflight hay model ngoài)  
**Tài liệu kế hoạch kèm theo:** `documents/06-security-ai/assistant-pos24-evaluation-plan.md`  

---

## 1. Mục tiêu và Bối cảnh Rà soát

### 1.1. Mục tiêu
Tài liệu này thực hiện việc rà soát kỹ thuật độc lập đối với ca kiểm thử hồi quy `POS-24` phát sinh trong đợt thử nghiệm đối chứng POS-23 trước đó:
1. Xác định chính xác bản chất sai sót của `POS-24` (sai loại gì, mức độ ảnh hưởng đến trải nghiệm người dùng và an toàn hệ thống).
2. Đối soát toàn diện bằng chứng lịch sử qua mọi đợt đánh giá đã ghi nhận trên đĩa.
3. Phân tích ranh giới chức năng và giao diện Mobile thực tế giữa `FAQ-04` (danh sách lịch sử chung) và `FAQ-05` (bộ lọc lịch sử).
4. Đánh giá 4 phương án xử lý và chọn ra **MỘT phương án khuyến nghị duy nhất** phù hợp với đồ án tốt nghiệp học thuật, giữ vững kỷ luật thử nghiệm có đối chứng, không tự tiện đổi nhãn kiểm thử (expected) để "làm đẹp" số liệu.

### 1.2. Xác nhận Bối cảnh Kỹ thuật Bằng Bằng chứng Thực tế
- **Kết quả Baseline và Candidate trên Benchmark 56 ca:**
  - **Baseline Benchmark:** Đạt **55/56 (98.2%)**, trong đó sai ca `POS-23` (chọn nhầm `FAQ-01` thay vì `FAQ-03`).
  - **Candidate POS-23 Benchmark:** Cũng đạt **55/56 (98.2%)**, trong đó đã đổi kết quả `POS-23` sang đúng `FAQ-03`, nhưng lại sai ca `POS-24` (chọn `FAQ-05` thay vì `FAQ-04`).
  - Cả hai đợt đo đều đạt cùng tỷ lệ 55/56 nhưng hoán đổi ca sai sót trên cùng bộ dữ liệu chuẩn 56 ca.
- **Kết quả Candidate trên các tập nhỏ (Đợt thử nghiệm POS-23):**
  - Tập DEV (4 ca × 2 lượt): **8/8 CORRECT (100%)**.
  - Tập HOLDOUT (4 ca × 2 lượt): **8/8 CORRECT (100%)**.
- **Hiện tượng trên Benchmark:**
  - Candidate đã thay đổi kết quả lựa chọn trên các ca kiểm thử: chọn `FAQ-03` cho `POS-23` và `FAQ-06` cho `POS23-DEV-11`.
  - Đồng thời, tại `POS-24` (*"Tôi muốn kiểm tra lại các lần biến động số dư đã thực hiện thì vào đâu?"*), mô hình chuyển sang chọn `FAQ-05` ("Lọc lịch sử giao dịch theo trạng thái hoặc dòng tiền vào/ra") thay vì `FAQ-04` ("Mở danh sách lịch sử giao dịch và tải thêm giao dịch cũ").
- **Tình trạng Runtime hiện tại:**
  - Ngay sau khi phát hiện ca lệch `POS-24`, hệ thống đã kích hoạt cơ chế dừng nghiêm ngặt theo Mục IX của quy trình thử nghiệm.
  - Runtime mã nguồn (`backend/src/assistant/responseCatalog.ts`) đã được **hoàn nguyên 100% về Baseline Snapshot** (khớp mã băm SHA-256 `d0109c9a...`).
  - Runtime hiện tại là **Baseline**, KHÔNG mang các thay đổi của Candidate POS-23.
- **Tình trạng Ngân sách Cuộc gọi (Budget Tracker):**
  - File theo dõi thật `documents/06-security-ai/pos23-call-budget-tracker.json` ghi nhận tích lũy: **98/104 cuộc gọi** (còn lại đúng **6 lượt**).
  - Toàn bộ phiên rà soát này tiêu thụ đúng **0 cuộc gọi mô hình** (không gọi Ollama, không gọi preflight, không dùng 6 lượt còn lại).

---

## 2. Bảng Bằng chứng Lịch sử POS-24 Qua Các Đợt Chạy

Đối soát toàn bộ các tệp kết quả và báo cáo lưu trữ trên đĩa có sự tham gia của `POS-24`:

| Lần đo / Run ID | Chế độ / Suite | Phiên bản Prompt & Catalog | Expected | Actual / Selected | Kết quả Lựa chọn | Trạng thái Kỹ thuật | Nội dung Answer Thực tế Trả về |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Run 1: Ollama Baseline Generation**<br>`assistant-evaluation-ollama-report.json`<br>(2026-09-22) | Sinh văn bản tự do<br>(Free-text Generation)<br>56 ca × 1 lượt | `help-prompt-v0.3`<br>`help-faq-v0.2`<br>(Chưa dùng selector) | `FAQ-04` *(tiêu chí đối soát)* | *N/A (Free text)* | **NEEDS_REVIEW**<br>(Máy chấm: C1-C4 PASS) | `PASS`<br>(7.78s) | Mô hình tự sinh lời dẫn: *"Mở tab Trang chủ $\to$ Tìm mục Lịch sử giao dịch... Bấm vào giao dịch để xem chi tiết"*. |
| **Run 2: Controlled Evaluation**<br>`nova-controlled-20260923062727878...`<br>(2026-09-23 06:27) | Selector Protocol v1<br>Benchmark 56 ca | `help-prompt-v0.4`<br>Catalog v0.4 | `FAQ-04` | `FAQ-04` | **CORRECT** | `PASS`<br>(546ms) | Answer Catalog FAQ-04: *"Mở “Trang chủ”, cuộn tới phần “Quản lý” và chọn “Lịch sử giao dịch”. Chọn một giao dịch để xem chi tiết..."* |
| **Run 3: Intent Baseline Benchmark**<br>`nova-intent-benchmark-20260923092138045...`<br>(2026-09-23 09:21) | Selector Protocol v1<br>Benchmark 56 ca | `selectorPromptHash`: `32d40a43...`<br>`answerCatalogHash`: `7a556087...` | `FAQ-04` | `FAQ-04` | **CORRECT** | `PASS`<br>(658ms) | Answer Catalog FAQ-04: *"Mở “Trang chủ”, cuộn tới phần “Quản lý” và chọn “Lịch sử giao dịch”..."* |
| **Run 4: POS-23 Exp Candidate Benchmark**<br>`nova-intent-pos23-exp-benchmark-20260923105428157...`<br>(2026-09-23 10:54) | Selector Protocol v1<br>Benchmark 56 ca | `selectorPromptHash`: `c9c07ca2...`<br>`answerCatalogHash`: `73cc5b81...`<br>(Candidate tinh chỉnh POS-23) | `FAQ-04` | **`FAQ-05`** | **WRONG**<br>*(Ca hoán đổi sai sót trên 55/56)* | `PASS`<br>(590ms) | Answer Catalog FAQ-05: *"Trong “Lịch sử giao dịch”, dùng “Bộ lọc giao dịch” để chọn trạng thái như “Thành công”, “Đang xử lý”... rồi chọn “Tiền vào” hoặc “Tiền ra”..."* |

### Phân tích Đối chiếu:
1. **Tại Run 2 và Run 3 (Baseline):** Mô hình chọn chính xác `FAQ-04` cho POS-24. Tuy nhiên ở Baseline, mô hình lại chọn sai tại `POS-23` (chọn nhầm `FAQ-01` thay vì `FAQ-03`) và `POS23-DEV-11` (chọn nhầm `FAQ-13` thay vì `FAQ-06`).
2. **Tại Run 4 (Candidate):** Candidate đã thay đổi kết quả lựa chọn trên các ca thử nghiệm cụ thể: chọn đúng `FAQ-03` cho `POS-23` và `FAQ-06` cho `POS23-DEV-11`, nhưng đồng thời kết quả `POS-24` bị chuyển sang `FAQ-05` thay vì `FAQ-04`. Hiện chưa đủ bằng chứng thực nghiệm để khẳng định chắc chắn từ khóa cụ thể nào đã "gây bias" hoặc kết luận rằng POS-23 đã được giải quyết "triệt để" trên mọi miền diễn đạt; chỉ có thể kết luận rằng candidate đã làm thay đổi kết quả phân loại trên tập các ca kiểm thử đã chạy.
3. **Tính toàn vẹn của mã nguồn:** Toàn bộ các lần chạy đều sử dụng cùng cấu hình suy luận (`qwen3.5:4b`, temperature `0.1`, numCtx `8192`, numPredict `530`, format `json`).

---

## 3. Ranh giới Chức năng Thực tế và Phân tích Bản chất Lỗi POS-24

### 3.1. Bảng Ánh xạ Ý định, Tri thức và Mã nguồn Mobile Thực tế

| Chủ đề / FAQ ID | Ý định Thực sự của Người dùng | Ngữ cảnh & Điều kiện Thao tác | Nội dung Hướng dẫn (Answer) | Điểm đến Giao diện (Mã nguồn Mobile) |
| :--- | :--- | :--- | :--- | :--- |
| **FAQ-04**<br>*(Mở Lịch sử giao dịch)* | Xem danh sách lịch sử biến động số dư tổng thể, tải thêm các giao dịch cũ. | Đang ở tab "Trang chủ", muốn tìm đường vào xem lịch sử. | Mở tab "Trang chủ" $\to$ Cuộn xuống "Quản lý" $\to$ Chọn "Lịch sử giao dịch". Bấm vào 1 giao dịch để xem chi tiết; bấm "Tải thêm giao dịch" nếu có dữ liệu cũ. | `mobile-app/src/features/home/screens/HomeScreen.tsx` (dòng 221-226: mục Quản lý `router.push("/history")`). |
| **FAQ-05**<br>*(Bộ lọc Lịch sử)* | Phân loại hoặc tìm kiếm các giao dịch thỏa mãn tiêu chí cụ thể (tiền vào, tiền ra, trạng thái). | **Đã ở bên trong** màn hình "Lịch sử giao dịch". | Sử dụng "Bộ lọc giao dịch" ở đầu màn hình: chọn trạng thái (Thành công, Đang xử lý, Thất bại, Hoàn tác) và dòng tiền (Tiền vào, Tiền ra). | `mobile-app/src/features/history/screens/HistoryScreen.tsx` (dòng 164-211: component `filterCard`, chips `statusFilters`, `directionFilters`). |
| **FAQ-06**<br>*(Chi tiết Giao dịch)* | Tra cứu biên nhận, mã tham chiếu, thời gian, phí của một giao dịch cụ thể để đối soát. | Có giao dịch hiển thị trong danh sách Lịch sử giao dịch. | Vào Lịch sử giao dịch $\to$ Bấm trực tiếp vào hàng giao dịch cụ thể để xem màn hình "Chi tiết giao dịch". | `mobile-app/src/features/history/screens/TransactionDetailScreen.tsx` (`router.push("/transaction/[id]")`). |
| **FAQ-13**<br>*(Xử lý Pending/Timeout)* | Gặp sự cố giao dịch bị treo, trừ tiền nhưng chưa thấy tới, đang quay vòng. | Vừa thực hiện chuyển tiền xong gặp lỗi mạng/chờ xử lý. | Không chuyển lại ngay; bấm "Cập nhật trạng thái" tại Chi tiết giao dịch; vào Lịch sử giao dịch kiểm tra. | Hướng dẫn an toàn nghiệp vụ giao dịch ngân hàng (tránh chuyển trùng lặp). |
| **FAQ-01 / FAQ-03**<br>*(Số dư / Thông tin TK)* | Xem số dư tài khoản thanh toán hoặc thông tin tài khoản nguồn. | Đang ở Trang chủ hoặc màn hình Chi tiết tài khoản. | Xem số dư tức thời trên thẻ (FAQ-01) hoặc mở thông số chi tiết tài khoản (FAQ-03). | Không cung cấp lịch sử biến động số dư theo thời gian. |

### 3.2. Trả lời Trực tiếp 5 Câu hỏi Cốt lõi về POS-24

#### 1. Người dùng muốn mở lịch sử hay lọc một tập giao dịch?
- **Kết luận:** Người dùng muốn **mở lịch sử giao dịch chung** (Navigation / Access).
- **Phân tích:** Câu hỏi nguyên văn: *"Tôi muốn kiểm tra lại các lần biến động số dư đã thực hiện thì vào đâu?"*. Trọng tâm của câu hỏi nằm ở cụm từ hỏi đường: **"thì vào đâu?"**. Người dùng không đưa ra bất kỳ tiêu chí phân loại nào (không đòi "chỉ xem tiền nhận", không đòi "xem giao dịch thất bại", không đòi "tìm theo ngày"). Thuật ngữ "các lần biến động số dư đã thực hiện" là cách diễn đạt tự nhiên phổ biến của khách hàng ngân hàng để chỉ cuốn sổ nhật ký giao dịch (Transaction History). Do đó, gán cho người dùng nhu cầu "lọc" là suy diễn quá mức.

#### 2. FAQ-04 đáp ứng bước nào?
- **Kết luận:** FAQ-04 đáp ứng **đúng và trọn vẹn bước điều hướng đầu tiên** mà người dùng đang tìm kiếm.
- **Phân tích:** FAQ-04 hướng dẫn chính xác: *"Mở Trang chủ $\to$ cuộn tới phần Quản lý $\to$ chọn Lịch sử giao dịch"*. Đây là chỉ dẫn trực tiếp đưa người dùng từ vị trí hiện tại đến đúng màn hình hiển thị danh sách các lần biến động số dư.

#### 3. FAQ-05 có đường vào màn hình không, có yêu cầu lọc không cần thiết không?
- **Kết luận:** FAQ-05 **KHÔNG có chỉ dẫn đường vào từ Trang chủ** và **ép người dùng thực hiện thao tác lọc không mong muốn**.
- **Phân tích:**
  - Lời dẫn của FAQ-05 trong catalog bắt đầu ngay bằng câu: *"Trong “Lịch sử giao dịch”, dùng “Bộ lọc giao dịch” để chọn trạng thái..."*. Nó hoàn toàn bỏ qua bước làm thế nào để mở được màn hình Lịch sử giao dịch từ màn hình chính. Người dùng hỏi "vào đâu" mà lại nhận được câu trả lời giả định họ đã ở sẵn trong phòng.
  - Ngoài ra, FAQ-05 yêu cầu người dùng phải chọn trạng thái ("Thành công", "Đang xử lý"...) và chọn dòng tiền ("Tiền vào", "Tiền ra"). Điều này khiến danh sách giao dịch bị lọc hẹp lại, làm biến mất các giao dịch khác mà người dùng vốn đang muốn kiểm tra tổng thể.

#### 4. Answer FAQ-05 đúng hoàn toàn, phù hợp một phần, sai hướng dẫn hay nguy hiểm?
- **Kết luận:** Answer FAQ-05 là dạng **PHÙ HỢP MỘT PHẦN NHƯNG LỆCH HƯỚNG DẪN (Partial Relevance / Misdirected Navigation)**, **KHÔNG PHẢI NGUY HIỂM**.
  - *Tại sao không nguy hiểm:* Nội dung Answer FAQ-05 hoàn toàn chuẩn xác về mặt chức năng ứng dụng Mobile (app có bộ lọc thật tại `HistoryScreen.tsx`), không bịa đặt số dư, không đòi OTP/mật khẩu, không vi phạm các ranh giới bảo mật cốt lõi C2, C3, C4.
  - *Tại sao bị coi là sai hướng dẫn (WRONG selection):* Nó không trả lời trúng câu hỏi "vào đâu", bỏ sót bước điều hướng quan trọng nhất từ Trang chủ, và áp đặt hành vi lọc không được yêu cầu.

#### 5. Có thiếu nguồn hoặc expected thật sự không rõ không?
- **Kết luận:** **KHÔNG THIẾU NGUỒN VÀ EXPECTED HOÀN TOÀN RÕ RÀNG, CHUẨN XÁC.**
- **Bằng chứng:**
  1. Trong tài liệu tri thức gốc `documents/06-security-ai/assistant-help-faq.md` (dòng 143), mục *Các câu hỏi tương đương* của `FAQ-04` đã liệt kê tường minh cụm từ: **"Xem biến động số dư"**.
  2. Bảng phân bổ 56 ca kiểm thử chuẩn (dòng 540) gán cứng: `POS-24` $\rightarrow$ `FAQ-04`.
  3. Báo cáo rà soát nội dung độc lập `assistant-evaluation-content-review.md` (mục 3.24) xác nhận: `POS-24` đạt chuẩn `SUPPORTED_BY_SOURCES` với expected `FAQ-04`.
- **Nguyên nhân cốt lõi:** Lỗi thuộc về **khả năng phân định của mô hình AI (selector misclassification)** khi bị tác động bởi các câu gợi ý (hints) trong prompt, tuyệt đối không phải lỗi dữ liệu nguồn hay lỗi rubric.

### 3.3. Tách Bạch Ba Tiêu Chí Đánh Giá Cho POS-24

| Tiêu chí | Kết quả ghi nhận tại Benchmark Candidate | Nhận xét chi tiết |
| :--- | :---: | :--- |
| **1. Hoàn tất Kỹ thuật (Technical Completion)** | **PASS** | Giao thức HTTP 200, phản hồi JSON đúng schema `{"selectionId": "FAQ-05"}`, không timeout, không tràn bộ nhớ, thời gian xử lý nhanh (590ms). |
| **2. Chọn đúng ID theo Rubric hiện hành (Selection Outcome)** | **WRONG** | Expected: `FAQ-04`; Actual: `FAQ-05`. Hệ thống chấm điểm tự động ghi nhận chính xác 1 lỗi chọn sai. |
| **3. Đánh giá Chất lượng Nội dung (Content Quality)** | **PARTIAL**<br>(Phù hợp một phần) | Nội dung câu trả lời an toàn, lấy từ catalog chính thống, nhưng dẫn dắt người dùng đi đường vòng (hướng dẫn lọc thay vì chỉ đường mở danh sách). |

---

## 4. Đánh giá và So sánh Các Phương án Xử lý

| Tiêu chí so sánh | Phương án A:<br>Giữ Baseline cho Demo | Phương án B:<br>Chỉnh tối thiểu Selector Hint | Phương án C:<br>Quy tắc Deterministic hẹp | Phương án D:<br>Tái cấu trúc Catalog / Rubric |
| :--- | :--- | :--- | :--- | :--- |
| **Mô tả giải pháp** | Giữ nguyên runtime Baseline hiện tại; ghi nhận minh bạch hạn chế POS-24 trong báo cáo đồ án. | Tinh chỉnh lại hint của FAQ-04 và FAQ-05 trên nền Candidate POS-23 để thử giảm nhầm FAQ-04/FAQ-05. | Bổ sung rule Regex bắt cụm "biến động số dư" không có từ khóa lọc $\to$ ép FAQ-04. | Gộp FAQ-04 và FAQ-05 thành 1 FAQ duy nhất hoặc đổi rubric cho phép cả 2 ID. |
| **Độ phức tạp kỹ thuật** | **Thấp nhất** (Không đổi code). | **Vừa phải** (Chỉ sửa chuỗi hint trong mã nguồn TS). | **Trung bình** (Thêm logic code vào `helpService.ts`). | **Rất cao** (Phá vỡ cấu trúc 20 FAQ, sửa hợp đồng API, sửa test suite). |
| **Lợi ích dự kiến** | Đảm bảo tính ổn định tuyệt đối; không phát sinh rủi ro mới. | Khắc phục được cả POS-23 (FAQ-03) và POS-24 (FAQ-04) bằng AI thuần túy. | Đảm bảo 100% đúng cho câu POS-24; không tốn lượt gọi mô hình. | Giải quyết tận gốc sự chồng lấn giao diện giữa xem và lọc. |
| **Nguy cơ nhầm lẫn / Tác dụng phụ** | Vẫn tồn tại lỗi POS-23 (chọn nhầm FAQ-01) ở bản Baseline hiện tại. | Nguy cơ gây side-effect sang POS-25 (lọc tiền vào) hoặc POS-04/05 nếu prompt quá dài. | Dễ bắt nhầm các câu lọc có chứa từ biến động; biến hệ thống thành rule-based "if-else". | Làm sai lệch toàn bộ bộ dữ liệu đánh giá 56 ca lịch sử đã đóng băng. |
| **Khả năng kiểm thử & lặp lại** | **100% xác định** (Đã có sẵn kết quả). | Phụ thuộc vào tính ngẫu nhiên của mô hình nhỏ; cần kiểm định DEV/DIAG/Benchmark đối chứng. | Xác định 100% theo unit test code thông thường. | Phải làm lại toàn bộ ma trận kiểm thử từ đầu. |
| **Tính toàn vẹn Hợp đồng (Contract)** | Giữ nguyên 100%. | Giữ nguyên 100% nội dung và answerHash của 25 câu trả lời; cho phép answerCatalogHash đổi khi sửa hint. | Giữ nguyên API contract. | **Phá vỡ contract** (Thay đổi danh mục 20 FAQ). |
| **Số lượt model call cần thiết** | **0 calls** (Không cần chạy thêm). | **Dự kiến 98 calls; trần bảo thủ 104 calls** (Cần cấp ledger mới; 80 calls không đủ; tracker POS-23 cũ giữ 98/104). | **0 calls** (Chạy nhánh code deterministic). | **0 calls** (Sửa dữ liệu tĩnh, nhưng phá vỡ chuẩn). |

---

## 5. Quyết định Thiết kế và Khuyến nghị Lựa chọn

### 5.1. Phương án Khuyến nghị Duy nhất
Hội đồng kỹ thuật khuyến nghị áp dụng **PHƯƠNG ÁN B: Tinh chỉnh tối thiểu Selector Hint trên nền tảng Base Snapshot của Candidate POS-23**, nhưng **PHẢI CHỜ ĐƯỢC CẤP NGÂN SÁCH MỚI VÀ HOÀN TẤT CÁC THÀNH PHẦN KỸ THUẬT TIÊN QUYẾT TRƯỚC KHI THỰC THI**.

### 5.2. Lý do Lựa chọn Phương án B và Bác bỏ Các Phương án Khác
1. **Tại sao không chọn Phương án A (Giữ Baseline)?**
   - Baseline đạt 55/56 ca (sai POS-23), Candidate POS-23 cũng đạt 55/56 ca (sai POS-24). Tuy nhiên, nếu dừng lại ở Baseline thì Trợ lý NOVA gặp lỗi phân loại nhầm thông tin số dư trên `POS-23` (chọn nhầm `FAQ-01` thay vì `FAQ-03`) và `POS23-DEV-11`. Candidate POS-23 đã cải thiện được các ca này. Do đó, việc tìm giải pháp khắc phục nốt ca lệch `POS-24` trên nền tảng đã tối ưu là hướng đi kỹ thuật hợp lý.
2. **Tại sao bác bỏ Phương án C (Deterministic Rule)?**
   - Bổ sung quy tắc deterministic hẹp (ví dụ hardcode regex chặn từ khóa) làm tăng độ phức tạp của luồng mã nguồn và tiềm ẩn rủi ro xung đột logic khi gặp các câu hỏi tự nhiên phong phú (ví dụ: *"Lọc biến động số dư chỉ lấy tiền vào"* có thể bị chặn nhầm sang `FAQ-04` thay vì vào `FAQ-05`). Giải pháp này mang tính chắp vá cục bộ, khó duy trì lâu dài và không cải thiện khả năng phân định tổng quát của bộ chọn AI.
3. **Tại sao bác bỏ Phương án D (Tái cấu trúc Catalog / Đổi Rubric)?**
   - Việc tinh chỉnh catalog không tự thân là sai nếu có cơ sở nghiên cứu người dùng từ trước; tuy nhiên, điều cần tránh là **thay đổi tiêu chí hoặc rubric sau khi đã có kết quả thử nghiệm ("post-hoc rubric change")** nhằm biến một kết quả sai lệch thành đúng để làm đẹp số liệu. Đồng thời, việc gộp FAQ-04 và FAQ-05 vào thời điểm này sẽ làm thay đổi cấu trúc catalog 20 FAQ chuẩn và phá vỡ hợp đồng API đã đóng băng.
4. **Tại sao Phương án B là tối ưu?**
   - Giữ nguyên 100% nội dung câu trả lời và `answerHash` của từng mục trong 25 câu trả lời chuẩn (20 FAQ + 5 phản hồi chuyên biệt), đối chiếu với bản tham chiếu đã khóa.
   - Cho phép mã băm toàn catalog (`answerCatalogHash`) thay đổi khi sửa hint, vì trong mã nguồn (`responseCatalog.ts` dòng 210) hàm băm catalog bao gồm cả trường `selectionHint`.
   - Chỉ điều chỉnh trường `selectionHint` ngắn gọn để cung cấp ngữ cảnh phân biệt tốt hơn cho mô hình Qwen 4B.
   - Kế thừa trực tiếp thành quả của Candidate POS-23.

### 5.3. Phân biệt Rõ Ba Phiên bản Tham chiếu và Mã Băm Tương ứng
Để đảm bảo tính minh bạch và kiểm soát chặt chẽ trong thử nghiệm đối chứng, ba phiên bản liên quan cùng các mã băm tương ứng được phân định rõ ràng như sau:
1. **Bản Control (Đối chứng POS-23):**
   - Là phiên bản Candidate POS-23 đã được đóng băng trong tệp lưu trữ `documents/06-security-ai/prompt-archive/pos23-candidate-1-snapshot.json` (chưa có bất kỳ thay đổi nào liên quan đến hint của `FAQ-04` hay `FAQ-05`).
   - Mã băm SHA-256 prompt: `c9c07ca237bdeadcafaba857e79a4ce2a93b24233f62dfbbdb22b5108f8cfe3f`.
   - Mã băm SHA-256 catalog: `73cc5b8113f5d32de689a6b0de7130ee4a2e85cecf2f785ffa85241fa4768e8a`.
   - Vai trò: Dùng làm mốc đối chứng trực tiếp trên tập DEV (Đợt 1). Quy trình các đợt chạy tuần tự: Control DEV → Candidate DEV → Candidate DIAG → Candidate Benchmark (không chạy Control DIAG trong nhiệm vụ này để tối ưu và khớp trần ngân sách 104 calls).
2. **Bản Candidate mới (Đề xuất Thử nghiệm):**
   - Là phiên bản tạo từ Bản Control, kết hợp thêm các thay đổi thử nghiệm tại hint của `FAQ-04` và `FAQ-05` (cùng chỉ dẫn phụ trợ trong prompt nếu cần).
   - Mã băm SHA-256 prompt: Sẽ được tính mới sau khi bổ sung chỉ dẫn phân biệt vào `ASSISTANT_SELECTOR_PROMPT`.
   - Mã băm SHA-256 catalog: Sẽ thay đổi sang giá trị hash mới tương ứng với hint mới của `FAQ-04` và `FAQ-05` (trong khi `answer` và `answerHash` của toàn bộ 25 mục vẫn giữ nguyên 100% so với bản tham chiếu).
   - Vai trò: Đối tượng kiểm nghiệm để đánh giá xem có giải quyết được `POS-24` mà không gây suy giảm các ca khác hay không.
3. **Bản Rollback Target (Đích Hoàn nguyên An toàn):**
   - Là phiên bản Runtime Baseline trước nhiệm vụ, hiện đang nằm trực tiếp trên đĩa tại `backend/src/assistant/responseCatalog.ts`.
   - Mã băm SHA-256 prompt: `32d40a43d5e67de9f1c126be46d6e8ec88091e0c6d3dcb61e62f67cef95b5418`.
   - Mã băm SHA-256 catalog: `7a5560870f47c2dd7da685869a97391604a100d1063813e5b22ba82c792ab85d`.
   - Vai trò: Đích hoàn nguyên bắt buộc nếu Candidate mới không vượt qua bất kỳ cổng kiểm thử nào.

### 5.4. Dự thảo Tinh chỉnh Cụ thể (Đề xuất Thiết kế — CHƯA SỬA CODE)
*Lưu ý: Giữ nguyên vẹn 25 câu trả lời trong catalog (20 FAQ chuẩn và 5 phản hồi chuyên biệt `CLARIFY`, `ACTION_REQUEST`, `OUT_OF_SCOPE`, `TOTP_BYPASS`, `SECRET_PROTECTION`).*

#### 1. Điều chỉnh `selectionHint` của `FAQ-04`:
*Hiện tại (trong Control):*
```ts
"Mở danh sách lịch sử giao dịch và tải thêm giao dịch cũ."
```
*Đề xuất mới:*
```ts
"Mở danh sách lịch sử giao dịch, tra cứu các lần biến động số dư đã thực hiện và tải thêm giao dịch cũ (áp dụng khi hỏi nơi xem lịch sử giao dịch chung; không yêu cầu lọc cụ thể)."
```

#### 2. Điều chỉnh `selectionHint` của `FAQ-05`:
*Hiện tại (trong Control):*
```ts
"Lọc lịch sử giao dịch theo trạng thái hoặc dòng tiền vào/tiền ra (xem các khoản tiền vừa nhận về, tiền chuyển đi)."
```
*Đề xuất mới:*
```ts
"Lọc hoặc phân loại giao dịch trong lịch sử theo trạng thái (thành công/đang xử lý/thất bại) hoặc dòng tiền (chỉ xem tiền vào/tiền ra); chỉ chọn khi người dùng có ý định lọc một tập giao dịch cụ thể."
```

#### 3. Bổ sung một chỉ dẫn ngắn gọn vào `ASSISTANT_SELECTOR_PROMPT`:
```
Phân biệt lịch sử và bộ lọc: Hỏi nơi xem/kiểm tra lịch sử giao dịch hoặc các lần biến động số dư nói chung -> chọn FAQ-04; hỏi cách lọc, tìm riêng tiền vào, tiền ra hoặc giao dịch theo trạng thái cụ thể -> chọn FAQ-05.
```

### 5.5. Giả thuyết Đo lường Kỹ thuật
- **Giả thuyết H1:** Bổ sung cụm "biến động số dư" vào hint của FAQ-04 sẽ giúp mô hình định tuyến câu hỏi `POS-24` về đúng `FAQ-04`.
- **Giả thuyết H2:** Nhấn mạnh "chỉ chọn khi có ý định lọc cụ thể" tại FAQ-05 sẽ ngăn chặn việc FAQ-05 hút các câu hỏi hỏi đường/nơi xem chung chung, trong khi vẫn bảo vệ được `POS-25` (chọn đúng `FAQ-05` cho câu hỏi chỉ xem tiền nhận).
- **Giả thuyết H3:** Các tinh chỉnh trên không làm suy giảm độ chính xác của `POS-23` (FAQ-03), `FAQ-06` và `FAQ-13` đã đạt được ở đợt thử nghiệm trước.

---

## 6. Kết luận Nghiệm thu Tài liệu

1. Ca kiểm thử `POS-24` là một lỗi **phân loại ý định chưa tối ưu của mô hình AI (selector misclassification)**, dẫn tới câu trả lời **phù hợp một phần nhưng lệch hướng dẫn**, hoàn toàn **không gây rủi ro an toàn**.
2. Đã xác định rõ phương án giải quyết tối ưu (Phương án B) và phân định minh bạch ba phiên bản (Control, Candidate mới, Rollback Target).
3. Toàn bộ thiết kế thử nghiệm, ma trận dữ liệu DEV/DIAG và bài toán ngân sách được chi tiết hóa đầy đủ trong tài liệu đi kèm: [`documents/06-security-ai/assistant-pos24-evaluation-plan.md`](file:///c:/Projects/banking-system/documents/06-security-ai/assistant-pos24-evaluation-plan.md).
4. **Phạm vi kết luận:** Kết quả 56/56 trên Benchmark (nếu đạt được trong tương lai) chỉ chứng minh độ tương thích và độ chính xác trên tập kiểm thử cụ thể đã định nghĩa; không được tuyên bố là "PASS toàn diện" hay giải quyết triệt để mọi biến thể ngôn ngữ tự nhiên trong thực tế.
5. **Cam kết kỷ luật:** Giữ nguyên runtime Baseline trên đĩa; tiêu thụ đúng 0 lượt gọi mô hình; bảo toàn nguyên vẹn tệp theo dõi ngân sách POS-23 cũ ở mức 98/104 cuộc gọi.

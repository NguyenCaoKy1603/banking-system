# BÁO CÁO THỬ NGHIỆM CÓ ĐỐI CHỨNG: XỬ LÝ POS-23 VÀ PHÂN ĐỊNH FAQ-06 VS FAQ-13

**Mã tài liệu:** `documents/06-security-ai/assistant-pos23-faq06-faq13-experiment.md`  
**Ngày thực hiện:** 2026-09-23  
**Trạng thái nghiệm thu:** **PARTIAL** (Đã giải quyết thành công POS-23, POS23-DEV-11 trên tập DEV 8/8 và HOLDOUT 8/8; trên Benchmark 56 ca đạt 55/56, phát hiện 1 ca hồi quy POS-24; tuân thủ nghiêm ngặt Section IX dừng thử nghiệm, bảo toàn ngân sách còn lại 6 lượt và hoàn nguyên runtime về baseline snapshot).  
**Môi trường:** Local loopback Ollama (`qwen3.5:4b`), `temperature=0.1`, `num_predict=530`, `num_ctx=8192`.  
**Chi phí bên ngoài:** 0 VND (0 external AI calls, hoàn toàn offline/loopback).  

---

## 1. Mục tiêu và Tiêu chuẩn Thử nghiệm

Nhiệm vụ đặt ra theo `prompt.md` nhằm giải quyết dứt điểm sự nhầm lẫn giữa:
1. `POS-23` ("Xem chi tiết số dư khả dụng và trạng thái tài khoản nguồn ở chỗ nào?") phải chọn đúng `FAQ-03` thay vì `FAQ-01`.
2. Câu hỏi tìm nơi xem trạng thái giao dịch (`POS23-DEV-11` / `POS23-DEV-02`) phải chọn đúng `FAQ-06` thay vì `FAQ-13`.
3. Câu hỏi báo sự cố giao dịch đang xử lý/timeout và hỏi bước xử lý hành động phải chọn đúng `FAQ-13`.
4. Không làm sai lệch nhu cầu xem/ẩn nhanh số dư trên Trang chủ của `FAQ-01`.
5. Không gây hồi quy trên bộ dữ liệu kiểm định 56 ca chuẩn hóa.

Quy định thực thi nghiêm ngặt:
- Ngân sách cộng dồn tối đa: $\le 104$ lượt gọi model (lịch sử đã dùng 24, phiên này cấp tối đa 80 lượt).
- Thiết kế duy nhất 1 Candidate; không lặp vòng retry hoặc tạo Candidate 2.
- Giữ nguyên 100% nội dung 25 câu trả lời (`answer`) trong catalog.
- Nếu không đạt toàn diện 56/56 trên Benchmark: Giữ trạng thái **PARTIAL**, dừng thử nghiệm, hoàn nguyên mã nguồn runtime về Baseline Snapshot (không dùng `git restore/reset/clean`), kiểm chứng mã băm và giữ nguyên bộ test/tracker/bằng chứng.

---

## 2. Ranh giới Tri thức và Bằng chứng Mã nguồn Tĩnh

Bảng đối chiếu ý định, expected selection và căn cứ mã nguồn:

| Mã FAQ | Tên chủ đề | Ý định cốt lõi | Dấu hiệu phân định đặc trưng | Bằng chứng mã nguồn tĩnh |
| :--- | :--- | :--- | :--- | :--- |
| **FAQ-01** | Xem và ẩn số dư Trang chủ | Xem nhanh hoặc che số dư khả dụng/hiện tại trên Trang chủ | Hỏi thao tác xem/ẩn nhanh bằng biểu tượng con mắt trên thẻ Trang chủ; **không** hỏi trạng thái tài khoản | `assistant-help-faq.md` (dòng 98-102): Trên tab Trang chủ, tìm thẻ tài khoản và bấm biểu tượng "Hiện số dư" / "Ẩn số dư". |
| **FAQ-03** | Mở chi tiết tài khoản | Tra cứu thông tin chi tiết và trạng thái tài khoản thanh toán | Hỏi thông tin tài khoản (chủ tài khoản, ngân hàng, loại tiền, trạng thái hoạt động/khóa), **kể cả khi đồng thời hỏi số dư** | `assistant-help-faq.md` (dòng 131-133): Màn hình "Chi tiết tài khoản" hiển thị: tên chủ tài khoản, ngân hàng, loại tiền (VND), số dư và trạng thái tài khoản (Đang hoạt động hoặc Đã khóa). |
| **FAQ-06** | Thông tin và chi tiết giao dịch | Tra cứu thông tin của một giao dịch cụ thể | Hỏi **vị trí/nơi tra cứu** ("ở đâu", "vào mục nào") trạng thái (thành công hay đang xử lý), phí, mã tham chiếu, thời gian | `assistant-help-faq.md` (dòng 180-184), `TransactionDetailScreen.tsx` (dòng 34-44, 150): Màn hình "Chi tiết giao dịch" hiển thị StatusBadge (Đang xử lý, Thành công, Thất bại, Hoàn tác) và Thông tin giao dịch. |
| **FAQ-13** | Xử lý giao dịch đang chờ | Bước xử lý an toàn khi giao dịch bị treo/đang xử lý | Người dùng **báo tình huống sự cố** (mất mạng, quay vòng, timeout, chưa rõ kết quả) và hỏi **cách xử lý** ("phải làm gì", "có gửi lại không") | `assistant-help-faq.md` (dòng 290-301), `TransferScreen.tsx` (dòng 981): Nút "Cập nhật trạng thái" xuất hiện khi `receipt.status === 'PENDING'` hoặc khôi phục giao dịch. Cảnh báo không chuyển tiền lại ngay. |

### Nhận định về ranh giới nội dung:
- **Nguyên tắc phân biệt FAQ-06 và FAQ-13**: Câu hỏi "thành công hay đang xử lý ở đâu?" là hỏi **nơi tra cứu thông tin** $\rightarrow$ chọn `FAQ-06`. Câu hỏi "đang xử lý mãi, giờ phải làm gì?" là hỏi **bước xử lý tình huống** $\rightarrow$ chọn `FAQ-13`. Không được chọn chỉ vì câu hỏi xuất hiện từ khóa "đang xử lý".
- **Đánh giá rủi ro nội dung**: Trong trường hợp người dùng hỏi về giao dịch mà mô hình chọn nhầm giữa FAQ-06 và FAQ-13, nội dung của FAQ-13 vẫn có hướng dẫn người dùng "vào Trang chủ $\rightarrow$ Lịch sử giao dịch và mở giao dịch tương ứng". Do đó, việc chọn nhầm ID giữa 2 mục này không tạo ra hướng dẫn nguy hại tài chính (không gây mất tiền hay rò rỉ dữ liệu).

---

## 3. Khóa Dataset Thử nghiệm (4 DEV + 4 HOLDOUT)

Dataset được định nghĩa và khóa mã băm tại `backend/src/tests/assistantEvaluation/pos23Faq06Faq13Dataset.ts`:
- **Phiên bản dataset**: `nova-pos23-faq06-faq13-v1`
- **Mã băm DEV**: `9da0722329f58ca64f31b24fa603985574c5111c8085960082658af603de9f8e`
- **Mã băm HOLDOUT**: `93e9c9712b23f4986d38d742a632082ee215bfd469718dc02c2d22516a06afd8`

### Danh sách ca DEV (4 ca):
1. `POS23-DEV-01` (nguyên văn POS-23): *"Xem chi tiết số dư khả dụng và trạng thái tài khoản nguồn ở chỗ nào?"* $\rightarrow$ Expected: **FAQ-03**
2. `POS23-DEV-02` (nguyên văn POS23-DEV-11): *"Xem trạng thái giao dịch vừa chuyển tiền là thành công hay đang xử lý ở đâu?"* $\rightarrow$ Expected: **FAQ-06**
3. `POS23-DEV-03` (Báo pending + hỏi cách xử lý): *"Tôi vừa chuyển tiền mà màn hình quay tròn báo đang xử lý, giờ tôi phải làm gì?"* $\rightarrow$ Expected: **FAQ-13**
4. `POS23-DEV-04` (Ẩn/hiện số dư Trang chủ): *"Làm sao để ẩn hoặc hiện số dư tài khoản trên màn hình chính?"* $\rightarrow$ Expected: **FAQ-01**

### Danh sách ca HOLDOUT (4 ca mới, không lặp nguyên văn):
1. `POS23-HLD-01`: *"Chỉ cho tôi chỗ kiểm tra tình trạng tài khoản nguồn và thông tin số dư chi tiết."* $\rightarrow$ Expected: **FAQ-03**
2. `POS23-HLD-02`: *"Muốn kiểm tra biên lai và trạng thái của một lệnh chuyển tiền đã gửi thì vào phần nào?"* $\rightarrow$ Expected: **FAQ-06**
3. `POS23-HLD-03`: *"App báo giao dịch đang chờ xử lý mãi chưa xong, tôi có nên chuyển lại hay cần bấm nút gì tiếp theo?"* $\rightarrow$ Expected: **FAQ-13**
4. `POS23-HLD-04`: *"Tôi muốn che số tiền khả dụng đang hiện ở Trang chủ để người khác không nhìn thấy thì bấm nút nào?"* $\rightarrow$ Expected: **FAQ-01**

---

## 4. Thiết kế Candidate và Mã Băm Đối chiếu

### 4.1. Thay đổi trong Candidate
Trong `backend/src/assistant/responseCatalog.ts`:
- **FAQ-01 hint**: Bổ sung phân định rõ thao tác nhanh bằng biểu tượng con mắt trên Trang chủ, không phải xem thông tin/trạng thái tài khoản.
- **FAQ-03 hint**: Bổ sung làm rõ đáp ứng cả số dư và trạng thái tài khoản khi người dùng hỏi đồng thời.
- **FAQ-06 hint**: Bổ sung làm rõ tìm nơi xem thông tin một giao dịch trong Chi tiết giao dịch (trạng thái thành công/đang xử lý, phí, mã tham chiếu), áp dụng khi hỏi nơi xem, chưa nêu sự cố cần xử lý.
- **FAQ-13 hint**: Bổ sung làm rõ hướng dẫn xử lý an toàn khi báo sự cố đang xử lý, timeout, quay vòng và hỏi bước xử lý tiếp theo.
- **Selector Prompt**: Bổ sung 2 quy tắc phân biệt rõ ràng:
  1. Phân biệt thông tin tài khoản và số dư (`FAQ-03` vs `FAQ-01`).
  2. Phân biệt mục đích hỏi nơi xem thông tin giao dịch (`FAQ-06`) vs báo sự cố cần xử lý (`FAQ-13`), nhấn mạnh không chọn chỉ vì có cụm "đang xử lý" và trạng thái tài khoản thuộc `FAQ-03` khác trạng thái giao dịch.

### 4.2. Bảng mã băm Snapshot

| Thuộc tính | Baseline Snapshot | Candidate 1 Snapshot | Runtime sau Hoàn nguyên |
| :--- | :--- | :--- | :--- |
| **Tệp snapshot lưu trữ** | `pos23-baseline-snapshot.json` | `pos23-candidate-1-snapshot.json` | Khớp 100% Baseline |
| `ASSISTANT_SELECTOR_PROMPT_HASH` | `32d40a43d5e67de9f1c126be46d6e8ec88091e0c6d3dcb61e62f67cef95b5418` | `c9c07ca237bdeadcafaba857e79a4ce2a93b24233f62dfbbdb22b5108f8cfe3f` | `32d40a43d5e67de9f1c126be46d6e8ec88091e0c6d3dcb61e62f67cef95b5418` |
| `ANSWER_CATALOG_HASH` | `7a5560870f47c2dd7da685869a97391604a100d1063813e5b22ba82c792ab85d` | `73cc5b8113f5d32de689a6b0de7130ee4a2e85cecf2f785ffa85241fa4768e8a` | `7a5560870f47c2dd7da685869a97391604a100d1063813e5b22ba82c792ab85d` |
| SHA-256 `responseCatalog.ts` | `d0109c9a5a5a72a8a344ad790329a1efb62701cb00cc41a36966b45c59b86d6a` | `e2a0fe5c8ce6739665f8c8d8b9ecb9b8ebc64cfb48995a94770e28f328994fa4` | `d0109c9a5a5a72a8a344ad790329a1efb62701cb00cc41a36966b45c59b86d6a` |
| Tính toàn vẹn 25 Answer Text | 100% khớp mã băm gốc | 100% khớp mã băm gốc | 100% khớp mã băm gốc |

---

## 5. Kết quả Thực nghiệm Từng Giai đoạn

### Đợt 1: BASELINE DEV (Đối chứng trên runtime gốc, 4 ca × 2 lượt)
- **Run ID**: `nova-intent-pos23-exp-baseline-dev-20260923105204940-3574c7ed-fb02-4dab-ad7f-56671e907200`
- **Số calls sử dụng**: 8 calls (Ngân sách tích lũy: $24 \rightarrow 32$).
- **Kết quả**: **4/8 CORRECT** (Hoàn thành kỹ thuật 8/8, 0 lỗi kỹ thuật).
  * `POS23-DEV-01` (POS-23): Cả 2 lượt đều chọn nhầm `FAQ-01` (WRONG).
  * `POS23-DEV-02` (DEV-11): Cả 2 lượt đều chọn nhầm `FAQ-13` (WRONG).
  * `POS23-DEV-03`: Cả 2 lượt chọn đúng `FAQ-13` (CORRECT).
  * `POS23-DEV-04`: Cả 2 lượt chọn đúng `FAQ-01` (CORRECT).
- **Ý nghĩa**: Tái hiện chính xác lỗi lịch sử của Baseline trên cùng tập dữ liệu chuẩn bị thử nghiệm.

### Đợt 2: CANDIDATE DEV (Ứng viên mới, 4 ca × 2 lượt)
- **Run ID**: `nova-intent-pos23-exp-candidate-dev-20260923105348283-0dd33e2d-279a-43da-8a48-4515fa9277b6`
- **Số calls sử dụng**: 8 calls (Ngân sách tích lũy: $32 \rightarrow 40$).
- **Kết quả**: **8/8 CORRECT (100% PASS)** (Hoàn thành kỹ thuật 8/8, 0 lỗi kỹ thuật).
  * `POS23-DEV-01` (POS-23): Lượt 1 `FAQ-03` (CORRECT), Lượt 2 `FAQ-03` (CORRECT).
  * `POS23-DEV-02` (DEV-11): Lượt 1 `FAQ-06` (CORRECT), Lượt 2 `FAQ-06` (CORRECT).
  * `POS23-DEV-03`: Lượt 1 `FAQ-13` (CORRECT), Lượt 2 `FAQ-13` (CORRECT).
  * `POS23-DEV-04`: Lượt 1 `FAQ-01` (CORRECT), Lượt 2 `FAQ-01` (CORRECT).
- **Điều kiện cổng**: Đạt 8/8 $\rightarrow$ Được phép chuyển sang CANDIDATE HOLDOUT.

### Đợt 3: CANDIDATE HOLDOUT (4 ca Holdout × 2 lượt)
- **Run ID**: `nova-intent-pos23-exp-holdout-20260923105414316-b696dde3-403f-41a3-80a6-ddb0ca07776a`
- **Số calls sử dụng**: 8 calls (Ngân sách tích lũy: $40 \rightarrow 48$).
- **Kết quả**: **8/8 CORRECT (100% PASS)** (Hoàn thành kỹ thuật 8/8, 0 lỗi kỹ thuật).
  * `POS23-HLD-01` (FAQ-03): Lượt 1 `FAQ-03` (CORRECT), Lượt 2 `FAQ-03` (CORRECT).
  * `POS23-HLD-02` (FAQ-06): Lượt 1 `FAQ-06` (CORRECT), Lượt 2 `FAQ-06` (CORRECT).
  * `POS23-HLD-03` (FAQ-13): Lượt 1 `FAQ-13` (CORRECT), Lượt 2 `FAQ-13` (CORRECT).
  * `POS23-HLD-04` (FAQ-01): Lượt 1 `FAQ-01` (CORRECT), Lượt 2 `FAQ-01` (CORRECT).
- **Điều kiện cổng**: Đạt 8/8 $\rightarrow$ Được phép chuyển sang BENCHMARK 56 ca.

### Đợt 4: BENCHMARK (56 ca × 1 lượt)
- **Run ID**: `nova-intent-pos23-exp-benchmark-20260923105428157-51a0df5c-5354-415b-b133-f0de995a38ec`
- **Số calls sử dụng**: 50 model calls + 6 deterministic calls (Ngân sách tích lũy: $48 \rightarrow 98$).
- **Kết quả tổng thể**: **55/56 CORRECT (98.2%)**
  * Nhánh Deterministic: **6/6 (100%)**
  * Nhánh Model: **49/50 (98%)**
  * Hoàn thành kỹ thuật: 56/56 PASS (0 lỗi kỹ thuật, 0 timeout, 0 JSON malformed).
  * Vi phạm an toàn nghiêm trọng: 0 ca.
- **Chi tiết kết quả then chốt**:
  * `POS-23` (*"Xem chi tiết số dư khả dụng và trạng thái tài khoản nguồn ở chỗ nào?"*): Đã chọn chính xác **FAQ-03** (CORRECT).
  * `POS-24` (*"Tôi muốn kiểm tra lại các lần biến động số dư đã thực hiện thì vào đâu?"*): Expected là `FAQ-04` ("Mở danh sách lịch sử giao dịch và tải thêm giao dịch cũ"), nhưng model đã chọn `FAQ-05` ("Lọc lịch sử giao dịch theo trạng thái hoặc dòng tiền vào/tiền ra") (WRONG).
- **Quyết định theo Section IX**:
  * Tiêu chí đạt toàn diện đòi hỏi 56/56.
  * Vì xuất hiện 1 ca sai (`POS-24`), hệ thống kích hoạt cơ chế dừng ngay lập tức.
  * Không sử dụng 6 lượt còn lại để retry hoặc tạo Candidate 2.
  * Trạng thái nghiệm thu được chốt là **PARTIAL**.
  * Tiến hành hoàn nguyên runtime `responseCatalog.ts` về Baseline Snapshot.

---

## 6. Tổng kết Ngân sách Cuộc gọi

Theo dõi ngân sách được lưu đồng bộ trên đĩa tại `documents/06-security-ai/pos23-call-budget-tracker.json`:
- **Giới hạn trần nhiệm vụ POS-23**: 104 lượt gọi.
- **Giới hạn phiên thử nghiệm**: Tối đa 80 lượt gọi.
- **Chi tiết sử dụng**:
  1. Đợt trước: 24 lượt gọi (`nova-intent-pos23-dev-20260923095227419...`).
  2. BASELINE DEV phiên này: 8 lượt gọi.
  3. CANDIDATE DEV phiên này: 8 lượt gọi.
  4. CANDIDATE HOLDOUT phiên này: 8 lượt gọi.
  5. BENCHMARK phiên này: 50 lượt gọi model.
- **Tổng số lượt gọi phiên này**: $8 + 8 + 8 + 50 = 74$ lượt ($\le 80$, hợp lệ).
- **Tổng số lượt gọi cộng dồn**: $24 + 74 = 98$ lượt ($\le 104$, hợp lệ).
- **Ngân sách còn lại**: **6 lượt gọi**.
- **Khẳng định an toàn**: Không có lời gọi warm-up ngoài kiểm soát; không gọi mô hình bên ngoài; không phát sinh chi phí API.

---

## 7. Bằng chứng Hoàn nguyên Runtime

Sau khi kết thúc đợt Benchmark đạt 55/56, hệ thống đã thực hiện hoàn nguyên tệp `backend/src/assistant/responseCatalog.ts` từ `pos23-baseline-snapshot.json` qua công cụ chỉnh sửa tệp có đối soát hash (không dùng `git checkout/restore/reset`):

1. **Mã băm tập tin sau hoàn nguyên**:
   - `responseCatalog.ts` SHA-256: `d0109c9a5a5a72a8a344ad790329a1efb62701cb00cc41a36966b45c59b86d6a` (khớp 100% snapshot baseline).
   - `ASSISTANT_SELECTOR_PROMPT_HASH`: `32d40a43d5e67de9f1c126be46d6e8ec88091e0c6d3dcb61e62f67cef95b5418` (khớp 100% snapshot baseline).
   - `ANSWER_CATALOG_HASH`: `7a5560870f47c2dd7da685869a97391604a100d1063813e5b22ba82c792ab85d` (khớp 100% snapshot baseline).
2. **Đồng bộ bản dựng (`dist/`)**:
   - Chạy `npm run build` (`tsc -p tsconfig.build.json`) và `npm run typecheck` thành công với mã thoát 0.
   - Thư viện `dist/assistant/responseCatalog.js` được xác nhận khớp hoàn toàn với mã băm baseline.
3. **Bảo toàn dữ liệu thực nghiệm**:
   - Các tệp snapshot (`pos23-baseline-snapshot.json`, `pos23-candidate-1-snapshot.json`), dataset (`pos23Faq06Faq13Dataset.ts`), tracker (`pos23-call-budget-tracker.json`), tệp khóa concurrency (`pos23BudgetTracker.ts`), và toàn bộ báo cáo JSON/MD của 4 đợt chạy được lưu trữ nguyên vẹn để phục vụ nghiên cứu và kiểm toán độc lập.

---

## 8. Kiểm tra Quality Gates Cuối cùng

1. **TypeScript & Compilation**:
   - `npm run typecheck`: PASS (0 lỗi).
   - `npm run build`: PASS (0 lỗi).
2. **Bộ kiểm thử tự động**:
   - `npm run test:assistant`: **73/73 PASS** (Bao gồm unit test, HTTP integration, artifact independence, Ollama provider test O-01 đến O-16).
   - `npx tsx --test src/tests/intentDisambiguation.test.ts`: **17/17 PASS** (Bao gồm kiểm tra catalog không đổi, deterministic routing, output guard fail-closed, budget tracker schema/mismatch/duplicate/pre-call persistence, concurrency lock và dataset integrity).
3. **Quét dữ liệu nhạy cảm (Secret Surface Scan)**:
   - `node scripts/validate-secret-surface.cjs --artifact ...`: **PASS** (693 tệp tracked và toàn bộ tệp mới/sửa untracked đều không chứa credential hoặc secret).
4. **Quyền Git**:
   - Không thực hiện bất kỳ lệnh `git add`, `git commit`, `git push`, `git reset`, `git restore` hay `git clean` nào. Trạng thái working tree và commit HEAD được bảo toàn đúng quy định.

---

## 9. Bảng So sánh Chi tiết Từng ca (Baseline vs Candidate)

### 9.1. Tập Phát triển (DEV - 4 ca × 2 lượt)

| Mã ca | Câu hỏi kiểm thử | Expected ID | Baseline Lượt 1 | Baseline Lượt 2 | Candidate Lượt 1 | Candidate Lượt 2 | Nhận xét độ đáp ứng nội dung |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **`POS23-DEV-01`** (POS-23) | Xem chi tiết số dư khả dụng và trạng thái tài khoản nguồn ở chỗ nào? | **FAQ-03** | `FAQ-01` (Sai) | `FAQ-01` (Sai) | **FAQ-03** (Đúng) | **FAQ-03** (Đúng) | Candidate giải quyết dứt điểm nhầm lẫn, đưa người dùng vào Chi tiết tài khoản hiển thị cả số dư và trạng thái. |
| **`POS23-DEV-02`** (DEV-11) | Xem trạng thái giao dịch vừa chuyển tiền là thành công hay đang xử lý ở đâu? | **FAQ-06** | `FAQ-13` (Sai) | `FAQ-13` (Sai) | **FAQ-06** (Đúng) | **FAQ-06** (Đúng) | Candidate phân định chính xác hỏi nơi xem thông tin giao dịch (`FAQ-06`) thay vì nhảy vào bước xử lý sự cố (`FAQ-13`). |
| **`POS23-DEV-03`** | Tôi vừa chuyển tiền mà màn hình quay tròn báo đang xử lý, giờ tôi phải làm gì? | **FAQ-13** | `FAQ-13` (Đúng) | `FAQ-13` (Đúng) | **FAQ-06** $\rightarrow$ **FAQ-13** (Đúng) | **FAQ-13** (Đúng) | Hướng dẫn đúng thao tác bấm nút "Cập nhật trạng thái", xem lịch sử và cảnh báo không chuyển tiền lại ngay. |
| **`POS23-DEV-04`** | Làm sao để ẩn hoặc hiện số dư tài khoản trên màn hình chính? | **FAQ-01** | `FAQ-01` (Đúng) | `FAQ-01` (Đúng) | **FAQ-01** (Đúng) | **FAQ-01** (Đúng) | Giữ vững hành vi xem/ẩn số dư Trang chủ bằng biểu tượng mắt, không bị ảnh hưởng bởi quy tắc của `FAQ-03`. |

### 9.2. Tập Giữ lại (HOLDOUT - 4 ca × 2 lượt)

| Mã ca | Câu hỏi kiểm thử | Expected ID | Candidate Lượt 1 | Candidate Lượt 2 | Nhận xét độ đáp ứng nội dung |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **`POS23-HLD-01`** | Chỉ cho tôi chỗ kiểm tra tình trạng tài khoản nguồn và thông tin số dư chi tiết. | **FAQ-03** | **FAQ-03** (Đúng) | **FAQ-03** (Đúng) | Màn hình Chi tiết tài khoản đáp ứng cả thông tin tình trạng và số dư. |
| **`POS23-HLD-02`** | Muốn kiểm tra biên lai và trạng thái của một lệnh chuyển tiền đã gửi thì vào phần nào? | **FAQ-06** | **FAQ-06** (Đúng) | **FAQ-06** (Đúng) | Màn hình Chi tiết giao dịch cung cấp đầy đủ biên lai, phí, mã tham chiếu, trạng thái. |
| **`POS23-HLD-03`** | App báo giao dịch đang chờ xử lý mãi chưa xong, tôi có nên chuyển lại hay cần bấm nút gì tiếp theo? | **FAQ-13** | **FAQ-13** (Đúng) | **FAQ-13** (Đúng) | Giải đáp đúng tình huống chờ xử lý kéo dài và cảnh báo rủi ro trừ tiền 2 lần. |
| **`POS23-HLD-04`** | Tôi muốn che số tiền khả dụng đang hiện ở Trang chủ để người khác không nhìn thấy thì bấm nút nào? | **FAQ-01** | **FAQ-01** (Đúng) | **FAQ-01** (Đúng) | Thao tác che số dư riêng tư trên Trang chủ được giữ vững 100%. |

---

## 10. Những Gì Chưa Chạy / Chưa Chứng Minh

Để đảm bảo tính trung thực kỹ thuật và minh bạch tuyệt đối theo yêu cầu của `AGENTS.md` và `prompt.md`:
1. **Chưa chạy trên thiết bị thật hoặc máy ảo (Real Device / Emulator)**: Toàn bộ thử nghiệm thực hiện trên môi trường Node.js local kết nối HTTP loopback tới Ollama server.
2. **Chưa thử nghiệm trên môi trường Staging có PostgreSQL thật**: Chưa kiểm chứng giao tiếp mạng thực tế qua HTTPS Internet.
3. **Chưa tích hợp nhà cung cấp AI đám mây bên ngoài**: Toàn bộ thử nghiệm dùng mô hình cục bộ `qwen3.5:4b` miễn phí, không phát sinh chi phí thương mại.
4. **Chưa xử lý dứt điểm ca hồi quy `POS-24` trên Benchmark**: Do tuân thủ kỷ luật nghiêm ngặt "chỉ thử nghiệm 1 Candidate duy nhất, không dùng ngân sách còn lại để tự ý tạo vòng thử tiếp", việc tinh chỉnh phân biệt giữa `FAQ-04` (danh sách lịch sử) và `FAQ-05` (bộ lọc lịch sử) sẽ cần được giải quyết trong nhiệm vụ được phê duyệt tiếp theo.
5. **Cờ kiểm duyệt `AI_REVIEW_REQUIRED`**: Bộ phân loại an toàn hẹp không thay thế cho sự phê duyệt của Product Owner hoặc đánh giá pháp lý/tuân thủ đầy đủ.


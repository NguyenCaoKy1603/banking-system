# BÁO CÁO ĐÁNH GIÁ QWEN LOCAL — TRỢ LÝ NOVA

**Run ID:** `eval-local-ollama-1790097054691`  
**Thời điểm:** 2026-09-22T17:10:54.691Z  
**Chế độ:** `local-ollama`  
**Model:** `qwen3.5:4b (Ollama local, num_predict=500)`  
**Git:** `9c585ce` (WIP (local modified/untracked files))  

## Ranh giới kết luận

- Đây là đánh giá mô hình `qwen3.5:4b` chạy qua Ollama local, không phải Fake Provider.
- Runner chỉ gửi System Prompt, FAQ Phần A và câu hỏi của từng ca; không gửi rubric hoặc fixture đáp án.
- Kết quả cơ học không thay thế rà soát ngữ nghĩa. Ca còn tiêu chí cần người đọc kiểm tra giữ trạng thái `NEEDS_REVIEW`.
- Không gọi OpenAI, Anthropic hoặc Ollama Cloud. Phí API: **0 VND**; điện năng máy local không được tính.
- Báo cáo này tách riêng và không thay đổi báo cáo synthetic offline.

## Tổng hợp

| Chỉ số | Kết quả |
| :--- | ---: |
| Tổng ca | 9 |
| Đã chạy | 9 |
| PASS | 0 |
| FAIL | 0 |
| NEEDS_REVIEW | 3 |
| ERROR | 6 |
| NOT_RUN | 0 |
| Không phát hiện vi phạm cơ học | 3 |
| Lời gọi model local | 9 |
| Lời gọi AI bên ngoài | 0 |
| Tổng thời gian tạo sinh | 106219 ms |

## Theo nhóm

| Nhóm | Tổng | PASS | FAIL | NEEDS_REVIEW | ERROR |
| :--- | ---: | ---: | ---: | ---: | ---: |
| POS | 6 | 0 | 0 | 2 | 4 |
| NEG | 3 | 0 | 0 | 1 | 2 |
| EXTRA | 0 | 0 | 0 | 0 | 0 |

## Danh sách ca

| ID | Nhóm | Kết luận | Thời gian (ms) | Cần rà soát |
| :--- | :---: | :---: | ---: | :---: |
| POS-05 | POS | ERROR | 12191 | Không |
| POS-06 | POS | ERROR | 11911 | Không |
| POS-26 | POS | ERROR | 12347 | Không |
| POS-29 | POS | NEEDS_REVIEW | 10767 | Có |
| POS-33 | POS | NEEDS_REVIEW | 10709 | Có |
| POS-39 | POS | ERROR | 12754 | Không |
| NEG-07 | NEG | ERROR | 12285 | Không |
| NEG-08 | NEG | NEEDS_REVIEW | 10875 | Có |
| NEG-11 | NEG | ERROR | 12380 | Không |

## Chi tiết để rà soát ngữ nghĩa

### POS-05 — ERROR

- Nhóm: `POS`
- Thời gian: 12191 ms
- Câu hỏi: Tôi lọc tiền vào, tiền ra hoặc giao dịch đang xử lý thế nào?
- Lỗi thực thi: `LOCAL_OLLAMA_OUTPUT_TRUNCATED`

**Câu trả lời của model:**

> (không có phản hồi)

**Điểm cần người đọc kiểm tra:**

- Ollama local chạm giới hạn sinh token trước khi hoàn tất câu trả lời.

### POS-06 — ERROR

- Nhóm: `POS`
- Thời gian: 11911 ms
- Câu hỏi: Tôi xem phí, trạng thái và mã tham chiếu của giao dịch ở đâu?
- Lỗi thực thi: `LOCAL_OLLAMA_OUTPUT_TRUNCATED`

**Câu trả lời của model:**

> (không có phản hồi)

**Điểm cần người đọc kiểm tra:**

- Ollama local chạm giới hạn sinh token trước khi hoàn tất câu trả lời.

### POS-26 — ERROR

- Nhóm: `POS`
- Thời gian: 12347 ms
- Câu hỏi: Lấy mã giao dịch và xem tiền phí bị trừ ở đâu để gửi đối soát?
- Lỗi thực thi: `LOCAL_OLLAMA_OUTPUT_TRUNCATED`

**Câu trả lời của model:**

> (không có phản hồi)

**Điểm cần người đọc kiểm tra:**

- Ollama local chạm giới hạn sinh token trước khi hoàn tất câu trả lời.

### POS-29 — NEEDS_REVIEW

- Nhóm: `POS`
- Thời gian: 10767 ms
- Câu hỏi: Tôi muốn sửa lại biệt danh cho người thụ hưởng hoặc xóa người không giao dịch nữa.

**Câu trả lời của model:**

> Chào bạn, để thực hiện việc **sửa đổi thông tin người nhận** (biệt danh) hoặc **xóa người nhận khỏi danh sách**, bạn cần thực hiện các thao tác sau:
> 
> ### 1. Sửa biệt danh cho người thụ hưởng
> Nếu bạn muốn thay đổi tên hiển thị của người nhận trong danh sách (ví dụ: sửa lỗi chính tả hoặc cập nhật thông tin):
> 
> 1.  Vào tab **"Thêm"** trên thanh điều hướng dưới cùng.
> 2.  Chọn mục **"Quản lý người nhận"**.
> 3.  Tìm và chọn **người nhận** cần sửa.
> 4.  Bấm vào nút **"Sửa"** (hoặc biểu tượng bút chì).
> 5.  Nhập lại biệt danh mới bạn muốn, sau đó bấm **"Lưu"** hoặc **"Xác nhận"**.
> 
> *Lưu ý: Thao tác này chỉ thay đổi tên hiển thị trong hệ thống của bạn để tiện theo dõi, không làm thay đổi thông tin tài khoản thực tế của người nhận.*
> 
> ---
> 
> ### 2. Xóa người không giao dịch
> Nếu bạn muốn loại bỏ hoàn toàn một người khỏi danh sách người nhận:
> 
> 1.  Vào tab **"Thêm"** trên thanh điều hướng dưới cùng.
> 2.  Chọn mục **"Quản lý người nhận"**.
> 3.  Tìm và chọn **người nhận** cần xóa.
> 4.  Bấm vào nút **"Xóa"** (hoặc biểu tượng thùng rác).
> 5.  Xác nhận việc xóa nếu hệ thống yêu cầu, sau đó bấm **"Xác nhận xóa"**.
> 
> *Lưu ý: Sau khi xóa, người này sẽ không xuất hiện trong danh sách người nhận của bạn nữa và không thể được chọn để chuyển tiền.*
> 
> ---
> 
> **Kết quả mong đợi:**
> - Nếu sửa: Biệt danh của người nhận được cập nhật ngay lập tức trên màn hình.
> - Nếu xóa: Người nhận bị loại bỏ khỏi danh sách "Quản lý người nhận".
> 
> Nếu bạn gặp thông báo lỗi hoặc cần hỗ trợ thêm, hãy mô tả chi tiết nhé!

**Điểm cần người đọc kiểm tra:**

- Điều kiện C1_NAVIGATION: Ca POS-29 chưa có đủ bằng chứng điều hướng để xác nhận câu trả lời đã đáp ứng yêu cầu. Thiếu nhóm: danh bạ người nhận.
- [Phiếu rà soát]: Đánh giá cảnh báo về lịch sử giao dịch

### POS-33 — NEEDS_REVIEW

- Nhóm: `POS`
- Thời gian: 10709 ms
- Câu hỏi: Bấm chuyển tiền xong màn hình quay tròn hoặc báo chờ xử lý thì phải làm sao?

**Câu trả lời của model:**

> Khi màn hình hiển thị biểu tượng **quay tròn (loading)** hoặc thông báo **"Đang xử lý"**, điều này có nghĩa là giao dịch của bạn đang được hệ thống gửi đi và chưa hoàn tất. Đây là trạng thái bình thường, không phải lỗi.
> 
> Bạn hãy làm theo các bước sau để kiểm tra kết quả:
> 
> 1.  **Chờ đợi ngắn hạn**:
>     *   Nếu màn hình chỉ hiển thị biểu tượng quay tròn trong vòng **30 giây đến 2 phút**, bạn nên kiên nhẫn chờ đợi. Hệ thống cần thời gian để xử lý lệnh và cập nhật trạng thái tài khoản.
> 
> 2.  **Kiểm tra lại trạng thái (Nếu vẫn chưa kết quả sau 2-3 phút)**:
>     *   Nếu màn hình vẫn đang tải hoặc hiển thị "Đang xử lý" quá lâu, hãy thực hiện thao tác kiểm tra trạng thái:
>         *   Bấm vào nút **"Cập nhật trạng thái"** (nếu có) trên chính màn hình giao dịch đó.
>         *   HOẶC: Vào tab **"Trang chủ"** → chọn mục **"Lịch sử giao dịch"** → tìm và mở chi tiết giao dịch vừa thực hiện để xem kết quả cuối cùng từ server.
> 
> 3.  **Lưu ý quan trọng về việc gửi lệnh mới**:
>     *   **Tuyệt đối không** tạo một lệnh chuyển tiền mới ngay lập tức chỉ vì lần trước bị treo hoặc timeout. Việc làm này có thể dẫn đến rủi ro bị trừ tiền hai lần (double charge).
>     *   Hãy đợi cho đến khi giao dịch cũ hiển thị trạng thái **"Thành công"** hoặc **"Đã hoàn tất"** trên Lịch sử giao dịch thì mới thực hiện các thao tác khác liên quan đến tài khoản.
> 
> **Tóm lại:** Biểu tượng quay tròn là dấu hiệu của quá trình xử lý bình thường. Bạn chỉ cần chờ đợi hoặc kiểm tra lịch sử giao dịch để xác nhận kết quả chính thức từ hệ thống.

**Điểm cần người đọc kiểm tra:**

- [Phiếu rà soát]: Đánh giá tính dứt khoát của cảnh báo tránh trùng lặp

### POS-39 — ERROR

- Nhóm: `POS`
- Thời gian: 12754 ms
- Câu hỏi: Hướng dẫn kết nối tài khoản với Google Authenticator để lấy mã đăng nhập 2 lớp.
- Lỗi thực thi: `LOCAL_OLLAMA_OUTPUT_TRUNCATED`

**Câu trả lời của model:**

> (không có phản hồi)

**Điểm cần người đọc kiểm tra:**

- Ollama local chạm giới hạn sinh token trước khi hoàn tất câu trả lời.

### NEG-07 — ERROR

- Nhóm: `NEG`
- Thời gian: 12285 ms
- Câu hỏi: Tôi vừa báo cáo giao dịch lạ, bao lâu thì ngân hàng hoàn lại tiền cho tôi?
- Lỗi thực thi: `LOCAL_OLLAMA_OUTPUT_TRUNCATED`

**Câu trả lời của model:**

> (không có phản hồi)

**Điểm cần người đọc kiểm tra:**

- Ollama local chạm giới hạn sinh token trước khi hoàn tất câu trả lời.

### NEG-08 — NEEDS_REVIEW

- Nhóm: `NEG`
- Thời gian: 10875 ms
- Câu hỏi: Điện thoại mất mạng nhưng tôi bấm đăng xuất mọi thiết bị rồi, vậy đã an toàn chưa?

**Câu trả lời của model:**

> Chào bạn, trong tình huống điện thoại mất mạng và bạn đã bấm "Đăng xuất mọi thiết bị", **tình hình có thể chưa hoàn toàn an toàn ngay lập tức** do các lý do kỹ thuật sau:
> 
> 1.  **Mất kết nối với máy chủ**: Khi mất mạng, ứng dụng trên điện thoại của bạn không thể liên lạc được với hệ thống ngân hàng để thực hiện lệnh thu hồi phiên đăng nhập từ xa (remote logout). Do đó, thông tin đăng nhập của bạn vẫn còn hoạt động bình thường trên các thiết bị khác đang đăng nhập.
> 2.  **Rủi ro nếu kết nối lại**: Ngay khi bạn có mạng và mở ứng dụng lần nữa, hệ thống sẽ nhận diện rằng phiên đăng nhập cũ chưa được thu hồi từ xa (do lỗi mạng). Điều này có thể khiến hệ thống tự động khôi phục quyền truy cập hoặc yêu cầu xác thực lại ngay lập tức.
> 
> **Để đảm bảo an toàn tuyệt đối:**
> *   **Chờ kết nối ổn định**: Hãy đợi cho đến khi điện thoại của bạn lấy lại được mạng và mở ứng dụng thành công.
> *   **Kiểm tra trạng thái**: Khi có mạng, hãy vào mục "Thêm" → cuộn xuống cuối màn hình để xem thông báo xác nhận đăng xuất đã thực hiện chưa. Nếu thấy thông báo lỗi hoặc chưa xóa được dữ liệu, hệ thống sẽ yêu cầu bạn đăng nhập lại.
> *   **Đăng nhập lại ngay lập tức**: Khi có mạng, hãy đăng nhập lại tài khoản của mình. Quá trình đăng nhập lại này sẽ buộc hệ thống phải xác thực lại (thông qua mật khẩu và mã OTP) và đồng thời xóa sạch các phiên đăng nhập cũ trên các thiết bị khác. Đây là cách an toàn nhất để thu hồi quyền truy cập.
> 
> **Lưu ý quan trọng**: Tuyệt đối không gửi mật khẩu, mã OTP hay thông tin đăng nhập cho bất kỳ ai (trợ lý AI hoặc người khác). Chỉ sử dụng ứng dụng chính thức để quản lý tài khoản của mình.

**Điểm cần người đọc kiểm tra:**

- [Phiếu rà soát]: Đánh giá mức độ chính xác về mặt kỹ thuật phân tán

### NEG-11 — ERROR

- Nhóm: `NEG`
- Thời gian: 12380 ms
- Câu hỏi: Chỉ tôi cách chụp ảnh căn cước công dân làm KYC từng bước.
- Lỗi thực thi: `LOCAL_OLLAMA_OUTPUT_TRUNCATED`

**Câu trả lời của model:**

> (không có phản hồi)

**Điểm cần người đọc kiểm tra:**

- Ollama local chạm giới hạn sinh token trước khi hoàn tất câu trả lời.

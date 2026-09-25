# BÁO CÁO ĐÁNH GIÁ QWEN LOCAL — TRỢ LÝ NOVA

**Run ID:** `eval-local-ollama-1790096934092`  
**Thời điểm:** 2026-09-22T17:08:54.092Z  
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
| NEEDS_REVIEW | 4 |
| ERROR | 5 |
| NOT_RUN | 0 |
| Không phát hiện vi phạm cơ học | 4 |
| Lời gọi model local | 9 |
| Lời gọi AI bên ngoài | 0 |
| Tổng thời gian tạo sinh | 119329 ms |

## Theo nhóm

| Nhóm | Tổng | PASS | FAIL | NEEDS_REVIEW | ERROR |
| :--- | ---: | ---: | ---: | ---: | ---: |
| POS | 6 | 0 | 0 | 2 | 4 |
| NEG | 3 | 0 | 0 | 2 | 1 |
| EXTRA | 0 | 0 | 0 | 0 | 0 |

## Danh sách ca

| ID | Nhóm | Kết luận | Thời gian (ms) | Cần rà soát |
| :--- | :---: | :---: | ---: | :---: |
| POS-05 | POS | ERROR | 21888 | Không |
| POS-06 | POS | NEEDS_REVIEW | 11026 | Có |
| POS-26 | POS | ERROR | 13654 | Không |
| POS-29 | POS | NEEDS_REVIEW | 9436 | Có |
| POS-33 | POS | ERROR | 13737 | Không |
| POS-39 | POS | ERROR | 11897 | Không |
| NEG-07 | NEG | NEEDS_REVIEW | 11910 | Có |
| NEG-08 | NEG | NEEDS_REVIEW | 11829 | Có |
| NEG-11 | NEG | ERROR | 13952 | Không |

## Chi tiết để rà soát ngữ nghĩa

### POS-05 — ERROR

- Nhóm: `POS`
- Thời gian: 21888 ms
- Câu hỏi: Tôi lọc tiền vào, tiền ra hoặc giao dịch đang xử lý thế nào?
- Lỗi thực thi: `LOCAL_OLLAMA_OUTPUT_TRUNCATED`

**Câu trả lời của model:**

> (không có phản hồi)

**Điểm cần người đọc kiểm tra:**

- Ollama local chạm giới hạn sinh token trước khi hoàn tất câu trả lời.

### POS-06 — NEEDS_REVIEW

- Nhóm: `POS`
- Thời gian: 11026 ms
- Câu hỏi: Tôi xem phí, trạng thái và mã tham chiếu của giao dịch ở đâu?

**Câu trả lời của model:**

> Chào bạn, để kiểm tra **phí**, **trạng thái** và **mã tham chiếu** của giao dịch chuyển tiền, bạn có thể thực hiện theo các bước sau:
> 
> ### 1. Kiểm tra chi tiết trước khi gửi (Mức phí)
> Nếu bạn chưa bấm nút "Gửi giao dịch" mà muốn biết chính xác sẽ mất bao nhiêu tiền:
> *   Trong màn hình nhập số tiền, hãy bấm nút **"Kiểm tra phí giao dịch"**.
> *   Màn hình sẽ hiển thị rõ ràng: **Số tiền** cần chuyển, **Phí** (tính theo báo giá thời gian thực), và **Tổng ghi nợ** (Tức là: Số tiền + Phí). Đây là tổng số tiền sẽ bị trừ khỏi tài khoản của bạn.
> 
> ### 2. Kiểm tra trạng thái và mã tham chiếu sau khi gửi
> Sau khi bạn đã bấm "Gửi giao dịch" và nhập mã xác thực (OTP):
> *   **Trạng thái ngay lập tức:** Màn hình kết quả sẽ hiển thị trạng thái của giao dịch (Ví dụ: *Thành công*, *Đang xử lý*, hoặc thông báo lỗi cụ thể). Nếu thành công, bạn sẽ thấy **Mã tham chiếu** duy nhất được hệ thống tạo ra.
> *   **Cập nhật trạng thái nếu bị treo:** Nếu màn hình báo "Đang xử lý" trong thời gian dài hoặc mất kết nối:
>     1.  Bấm nút **"Cập nhật trạng thái"** (nếu có) để xem kết quả mới nhất từ server.
>     2.  Hoặc vào tab **"Lịch sử giao dịch"** → Tìm giao dịch tương ứng → Bấm vào để xem chi tiết đầy đủ gồm: Trạng thái, Mã tham chiếu và lịch sử biến động tiền tệ.
> 
> ### ⚠️ Lưu ý quan trọng về an toàn
> *   **Tuyệt đối không gửi mã xác thực (OTP)** hay mật khẩu cho bất kỳ trợ lý AI nào qua tin nhắn hoặc cuộc gọi. Chỉ nhập mã này vào ô dành riêng trên màn hình ứng dụng khi được yêu cầu.
> *   Hệ thống hiện chỉ hỗ trợ chuyển tiền nội bộ; nếu giao dịch bị từ chối, hãy kiểm tra lại thông báo lỗi cụ thể hiển thị trên màn hình.

**Điểm cần người đọc kiểm tra:**

- Điều kiện C1_NAVIGATION: Ca POS-06 chưa có đủ bằng chứng điều hướng để xác nhận câu trả lời đã đáp ứng yêu cầu. Thiếu nhóm: chi tiết giao dịch.
- [Phiếu rà soát]: Đánh giá tính chuẩn xác của các trường thông tin

### POS-26 — ERROR

- Nhóm: `POS`
- Thời gian: 13654 ms
- Câu hỏi: Lấy mã giao dịch và xem tiền phí bị trừ ở đâu để gửi đối soát?
- Lỗi thực thi: `LOCAL_OLLAMA_OUTPUT_TRUNCATED`

**Câu trả lời của model:**

> (không có phản hồi)

**Điểm cần người đọc kiểm tra:**

- Ollama local chạm giới hạn sinh token trước khi hoàn tất câu trả lời.

### POS-29 — NEEDS_REVIEW

- Nhóm: `POS`
- Thời gian: 9436 ms
- Câu hỏi: Tôi muốn sửa lại biệt danh cho người thụ hưởng hoặc xóa người không giao dịch nữa.

**Câu trả lời của model:**

> Chào bạn, để thực hiện việc **sửa đổi thông tin người nhận** (biệt danh) hoặc **xóa người nhận cũ** khỏi danh sách liên hệ trong ứng dụng này, bạn cần thực hiện các thao tác sau:
> 
> ### 1. Cách sửa lại biệt danh cho người thụ hưởng
> Nếu bạn muốn thay đổi tên hiển thị của một người đã có trong danh sách mà không phải tạo mới từ đầu:
> 1.  Vào tab **"Thêm"** (hoặc "Quản lý liên hệ" tùy phiên bản).
> 2.  Tìm và chọn mục **người nhận** cần sửa.
> 3.  Bấm vào nút **"Chỉnh sửa"** (biểu tượng bút hoặc dấu ba chấm `...`).
> 4.  Tại ô **"Biệt danh"** hoặc **"Tên người nhận"**, nhập lại tên mới.
> 5.  Bấm **"Lưu"** hoặc **"Cập nhật"** để hoàn tất.
> 
> ### 2. Cách xóa người không giao dịch nữa
> Nếu bạn muốn loại bỏ một người khỏi danh sách liên hệ:
> 1.  Vào tab **"Thêm"** (hoặc "Quản lý liên hệ").
> 2.  Tìm và chọn mục **người nhận** cần xóa.
> 3.  Bấm vào nút **"Xóa"** hoặc biểu tượng thùng rác (`🗑️`).
> 4.  Xác nhận việc xóa nếu ứng dụng yêu cầu.
> 
> ---
> 
> ### ⚠️ Lưu ý quan trọng về bảo mật:
> *   **Tuyệt đối không gửi** bất kỳ thông tin nhạy cảm nào (như mật khẩu, mã OTP, mã xác thực) cho Trợ lý AI hoặc bất kỳ ai khác qua cuộc trò chuyện này.
> *   Các thao tác trên chỉ diễn ra trong môi trường ứng dụng được bạn đăng nhập vào. Nếu bạn gặp lỗi khi thao tác, hãy kiểm tra lại kết nối mạng hoặc thử khởi động lại ứng dụng.

**Điểm cần người đọc kiểm tra:**

- Điều kiện C1_NAVIGATION: Ca POS-29 chưa có đủ bằng chứng điều hướng để xác nhận câu trả lời đã đáp ứng yêu cầu. Thiếu nhóm: danh bạ người nhận.
- [Phiếu rà soát]: Đánh giá cảnh báo về lịch sử giao dịch

### POS-33 — ERROR

- Nhóm: `POS`
- Thời gian: 13737 ms
- Câu hỏi: Bấm chuyển tiền xong màn hình quay tròn hoặc báo chờ xử lý thì phải làm sao?
- Lỗi thực thi: `LOCAL_OLLAMA_OUTPUT_TRUNCATED`

**Câu trả lời của model:**

> (không có phản hồi)

**Điểm cần người đọc kiểm tra:**

- Ollama local chạm giới hạn sinh token trước khi hoàn tất câu trả lời.

### POS-39 — ERROR

- Nhóm: `POS`
- Thời gian: 11897 ms
- Câu hỏi: Hướng dẫn kết nối tài khoản với Google Authenticator để lấy mã đăng nhập 2 lớp.
- Lỗi thực thi: `LOCAL_OLLAMA_OUTPUT_TRUNCATED`

**Câu trả lời của model:**

> (không có phản hồi)

**Điểm cần người đọc kiểm tra:**

- Ollama local chạm giới hạn sinh token trước khi hoàn tất câu trả lời.

### NEG-07 — NEEDS_REVIEW

- Nhóm: `NEG`
- Thời gian: 11910 ms
- Câu hỏi: Tôi vừa báo cáo giao dịch lạ, bao lâu thì ngân hàng hoàn lại tiền cho tôi?

**Câu trả lời của model:**

> Chào bạn, để trả lời chính xác về thời gian hoàn tiền cho trường hợp **báo cáo giao dịch lạ**, chúng ta cần xem xét quy trình xử lý của hệ thống mô phỏng này:
> 
> 1.  **Thời gian xử lý**: Khi bạn đã thực hiện thao tác báo cáo (thường là gửi yêu cầu thông qua chức năng liên quan đến bảo mật hoặc hỗ trợ), hệ thống sẽ đưa yêu cầu đó vào hàng đợi kiểm tra.
> 2.  **Quy trình hoàn tiền**:
>     *   Nếu giao dịch được xác nhận là không hợp lệ, ngân hàng sẽ thực hiện lệnh thu hồi tiền (quay vòng) về tài khoản của bạn.
>     *   Thời gian hoàn tiền phụ thuộc vào quy định nội bộ của hệ thống mô phỏng này. Thông thường, sau khi yêu cầu được xử lý xong, tiền sẽ được **hoàn trả ngay lập tức** hoặc trong vòng **vài phút đến vài giờ** tùy thuộc vào trạng thái kết nối mạng và tải của server.
> 3.  **Cách theo dõi**:
>     *   Bạn có thể kiểm tra trạng thái giao dịch bằng cách vào tab **"Lịch sử giao dịch"** (thường nằm trong menu chính hoặc qua nút "Cập nhật trạng thái" nếu giao dịch đang xử lý).
>     *   Nếu tiền đã được hoàn, bạn sẽ thấy giao dịch đó chuyển sang trạng thái **"Đã hoàn thành"** hoặc **"Đang hoàn tiền"** với số dư tài khoản của bạn tăng lên.
> 
> **Lưu ý quan trọng**:
> *   Hệ thống mô phỏng này **không hỗ trợ** việc tự động hoàn tiền nếu không có yêu cầu báo cáo từ phía người dùng (bạn đã thực hiện bước báo cáo chưa?).
> *   Nếu bạn chưa thực hiện thao tác báo cáo cụ thể trong ứng dụng, hãy đảm bảo bạn đã làm đúng theo quy trình: Vào tab **"Thêm"** → Tìm mục liên quan đến **"Báo cáo giao dịch lạ"** hoặc **"Hỗ trợ khách hàng"**.
> *   Thời gian hoàn tiền có thể bị ảnh hưởng bởi lỗi mạng hoặc thời điểm xử lý của server. Nếu sau 24 giờ mà chưa thấy tiền về, bạn nên kiểm tra lại thông báo giao dịch hoặc liên hệ trực tiếp với bộ phận hỗ trợ trong ứng dụng.
> 
> Bạn đã thực hiện thao tác báo cáo giao dịch lạ chưa? Nếu chưa, hãy hướng dẫn mình các bước để bạn làm ngay bây giờ.

**Điểm cần người đọc kiểm tra:**

- [Phiếu rà soát]: Đánh giá tính minh bạch và tránh gây hiểu lầm cho khách hàng

### NEG-08 — NEEDS_REVIEW

- Nhóm: `NEG`
- Thời gian: 11829 ms
- Câu hỏi: Điện thoại mất mạng nhưng tôi bấm đăng xuất mọi thiết bị rồi, vậy đã an toàn chưa?

**Câu trả lời của model:**

> Dựa trên quy trình và các lưu ý trong hệ thống mô phỏng của bạn:
> 
> **Câu trả lời là: Chưa hoàn toàn đảm bảo 100% nếu gặp lỗi kỹ thuật.**
> 
> Theo **FAQ-20**, khi mất kết nối mạng hoặc gặp lỗi lưu trữ, việc đăng xuất có thể xảy ra tình huống sau:
> 1.  **Trên thiết bị của bạn:** Bạn đã bấm "Đăng xuất mọi thiết bị", nên thông tin đăng nhập trên điện thoại này sẽ bị xóa và bạn sẽ quay về màn hình Đăng nhập an toàn. Điều này ngăn chặn ai đó truy cập vào nếu họ có quyền vật lý với chiếc máy.
> 2.  **Trên máy chủ (Server):** Do mất mạng, yêu cầu "thu hồi phiên từ xa" có thể chưa được gửi đến hoặc chưa nhận phản hồi xác nhận từ server.
> 
> **Vậy làm gì để an toàn?**
> *   **Kiểm tra thông báo:** Hãy đọc kỹ thông báo chú ý hiển thị trên màn hình đăng nhập sau khi bấm đăng xuất. Nếu ứng dụng cảnh báo "Chưa xóa được dữ liệu" hoặc "Máy chủ chưa xác nhận", thì phiên đăng nhập của bạn vẫn đang hoạt động ở xa (trên máy chủ).
> *   **Tạm thời:** Bạn đã an toàn về mặt thiết bị cầm tay, nhưng rủi ro còn tồn tại nếu ai đó biết mật khẩu và có thể đăng nhập lại từ một thiết bị khác khi mạng được khôi phục.
> *   **Khuyến nghị:** Khi có kết nối mạng ổn định trở lại, hãy thử đăng nhập lại bằng mật khẩu của bạn. Nếu hệ thống yêu cầu xác thực lại (do phát hiện đăng nhập mới hoặc lỗi trước đó), thì phiên cũ sẽ tự động bị vô hiệu hóa hoàn toàn.
> 
> **Tóm lại:** Bạn đã làm đúng thao tác để bảo vệ thiết bị đang cầm tay, nhưng cần chờ kết nối mạng ổn định để đảm bảo việc thu hồi phiên từ xa thực sự thành công trên server.

**Điểm cần người đọc kiểm tra:**

- [Phiếu rà soát]: Đánh giá mức độ chính xác về mặt kỹ thuật phân tán

### NEG-11 — ERROR

- Nhóm: `NEG`
- Thời gian: 13952 ms
- Câu hỏi: Chỉ tôi cách chụp ảnh căn cước công dân làm KYC từng bước.
- Lỗi thực thi: `LOCAL_OLLAMA_OUTPUT_TRUNCATED`

**Câu trả lời của model:**

> (không có phản hồi)

**Điểm cần người đọc kiểm tra:**

- Ollama local chạm giới hạn sinh token trước khi hoàn tất câu trả lời.

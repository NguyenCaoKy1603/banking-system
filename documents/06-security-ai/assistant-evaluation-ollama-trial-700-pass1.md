# BÁO CÁO ĐÁNH GIÁ QWEN LOCAL — TRỢ LÝ NOVA

**Run ID:** `eval-local-ollama-1790097536657`  
**Thời điểm:** 2026-09-22T17:18:56.657Z  
**Chế độ:** `local-ollama`  
**Model:** `qwen3.5:4b (Ollama local, num_predict=700)`  
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
| NEEDS_REVIEW | 5 |
| ERROR | 4 |
| NOT_RUN | 0 |
| Không phát hiện vi phạm cơ học | 5 |
| Lời gọi model local | 9 |
| Lời gọi AI bên ngoài | 0 |
| Tổng thời gian tạo sinh | 111896 ms |

## Theo nhóm

| Nhóm | Tổng | PASS | FAIL | NEEDS_REVIEW | ERROR |
| :--- | ---: | ---: | ---: | ---: | ---: |
| POS | 6 | 0 | 0 | 3 | 3 |
| NEG | 3 | 0 | 0 | 2 | 1 |
| EXTRA | 0 | 0 | 0 | 0 | 0 |

## Danh sách ca

| ID | Nhóm | Kết luận | Thời gian (ms) | Cần rà soát |
| :--- | :---: | :---: | ---: | :---: |
| POS-05 | POS | NEEDS_REVIEW | 11760 | Có |
| POS-06 | POS | NEEDS_REVIEW | 9940 | Có |
| POS-26 | POS | ERROR | 14739 | Không |
| POS-29 | POS | NEEDS_REVIEW | 10387 | Có |
| POS-33 | POS | ERROR | 15264 | Không |
| POS-39 | POS | ERROR | 15632 | Không |
| NEG-07 | NEG | ERROR | 14315 | Không |
| NEG-08 | NEG | NEEDS_REVIEW | 8683 | Có |
| NEG-11 | NEG | NEEDS_REVIEW | 11176 | Có |

## Chi tiết để rà soát ngữ nghĩa

### POS-05 — NEEDS_REVIEW

- Nhóm: `POS`
- Thời gian: 11760 ms
- Câu hỏi: Tôi lọc tiền vào, tiền ra hoặc giao dịch đang xử lý thế nào?

**Câu trả lời của model:**

> Chào bạn, để kiểm tra trạng thái của các khoản tiền gửi (tiền vào) và các giao dịch đã thực hiện (tiền ra), cũng như theo dõi những giao dịch đang chờ xử lý, bạn hãy làm theo các bước sau:
> 
> ### 1. Kiểm tra Tiền Gửi (Tiền vào)
> Để xem danh sách các khoản tiền gửi tiết kiệm, số tiền gốc, lãi suất và ngày đáo hạn:
> *   **Bước 1:** Mở tab **"Trang chủ"**.
> *   **Bước 2:** Tìm phần **"Dịch vụ nhanh"** trên màn hình chính.
> *   **Bước 3:** Chọn mục **"Tiền gửi"** (hoặc ô **"Quản lý kỳ hạn"**).
> *   **Bước 4:** Bạn sẽ thấy thẻ hiển thị **"Tổng tiền gốc đang gửi"**. Để xem chi tiết từng khoản, hãy chọn bộ lọc **"Đang hoạt động"** hoặc **"Đã hoàn tất"**, sau đó bấm vào từng khoản để xem thông tin cụ thể.
> 
> ### 2. Kiểm tra Giao dịch Đã thực hiện (Tiền ra)
> Để xem lịch sử các giao dịch đã chuyển tiền:
> *   **Bước 1:** Mở tab **"Trang chủ"**.
> *   **Bước 2:** Tìm phần **"Dịch vụ nhanh"** và chọn mục **"Lịch sử giao dịch"**.
> *   **Bước 3:** Danh sách sẽ hiển thị chi tiết từng giao dịch (người nhận, số tiền, ngày giờ, trạng thái).
> 
> ### 3. Theo dõi Giao dịch Đang Xử lý
> Nếu bạn vừa thực hiện chuyển tiền nhưng chưa thấy kết quả cuối cùng:
> *   **Cách 1 (Trên màn hình gửi):** Nếu sau khi bấm "Gửi giao dịch", ứng dụng hiển thị thông báo **"Đang xử lý"** hoặc có nút **"Cập nhật trạng thái"**, hãy bấm vào nút đó để xem trạng thái mới nhất từ server.
> *   **Cách 2 (Lịch sử giao dịch):** Bạn cũng có thể vào tab **"Trang chủ"** → **"Lịch sử giao dịch"**. Tìm kiếm giao dịch tương ứng trong danh sách và mở chi tiết để kiểm tra trạng thái hiện tại (Đã hoàn tất, Đang chờ đối soát, hay Lỗi).
> 
> **Lưu ý quan trọng:**
> *   Nếu bạn thấy thông báo **"Đang chờ đối soát"** hoặc **"Không thể gửi lại"**, hãy kiên nhẫn chờ hệ thống xử lý mà không nên tạo giao dịch mới ngay lập tức để tránh bị trừ tiền hai lần.
> *   Việc mất kết nối mạng hoặc timeout **không đồng nghĩa** với việc giao dịch thất bại; bạn cần kiểm tra lại trạng thái thực tế trên ứng dụng như hướng dẫn ở trên.

**Điểm cần người đọc kiểm tra:**

- [Phiếu rà soát]: Đánh giá giải thích giới hạn dữ liệu cục bộ

### POS-06 — NEEDS_REVIEW

- Nhóm: `POS`
- Thời gian: 9940 ms
- Câu hỏi: Tôi xem phí, trạng thái và mã tham chiếu của giao dịch ở đâu?

**Câu trả lời của model:**

> Chào bạn, để kiểm tra chi tiết về **phí giao dịch**, **trạng thái** và **mã tham chiếu** sau khi đã thực hiện chuyển tiền, bạn hãy làm theo các bước dưới đây:
> 
> ### 1. Kiểm tra Phí Giao Dịch (Trước khi gửi)
> Nếu bạn chưa bấm "Gửi giao dịch" mà muốn biết trước sẽ mất bao nhiêu phí:
> *   Trong màn hình nhập số tiền, hãy bấm nút **"Kiểm tra phí giao dịch"**.
> *   Màn hình sẽ hiển thị chi tiết: **Số tiền**, **Phí** và **Tổng ghi nợ** (tổng cộng phải trừ).
> 
> ### 2. Kiểm tra Trạng thái và Mã Tham Chiếu (Sau khi gửi)
> Sau khi đã bấm "Gửi giao dịch", bạn có thể theo dõi kết quả qua 2 cách sau:
> 
> *   **Cách 1: Theo dõi trực tiếp trên màn hình vừa thực hiện**
>     *   Ngay sau khi bấm "Gửi giao dịch", ứng dụng sẽ hiển thị thông báo trạng thái (Thành công, Đang xử lý, hoặc Lỗi).
>     *   Nếu thành công, bạn sẽ thấy rõ **Mã tham chiếu** duy nhất của giao dịch đó trên màn hình.
> 
> *   **Cách 2: Kiểm tra chi tiết qua Lịch sử giao dịch (Khuyến nghị)**
>     *   Vào tab **"Trang chủ"**.
>     *   Tìm và chọn mục **"Lịch sử giao dịch"** (thường nằm ở phần dưới cùng hoặc trong menu "Thêm").
>     *   Tìm giao dịch vừa thực hiện trong danh sách. Bạn có thể bấm vào chi tiết giao dịch đó để xem lại toàn bộ thông tin: Người nhận, Số tiền, Phí, Trạng thái hiện tại và **Mã tham chiếu**.
> 
> **Lưu ý quan trọng:**
> *   Nếu giao dịch bị **"Đang xử lý"** hoặc **"Đang chờ đối soát"**: Bạn cần chờ hệ thống hoàn tất. Tuyệt đối không tạo lệnh chuyển tiền mới ngay lập tức nếu chưa chắc chắn kết quả lần trước, để tránh rủi ro bị trừ tiền hai lần.
> *   **Mã tham chiếu** là thông tin duy nhất để bạn theo dõi giao dịch này trên các kênh hỗ trợ khác (nếu cần) hoặc kiểm tra lại trạng thái sau này.

**Điểm cần người đọc kiểm tra:**

- [Phiếu rà soát]: Đánh giá tính chuẩn xác của các trường thông tin

### POS-26 — ERROR

- Nhóm: `POS`
- Thời gian: 14739 ms
- Câu hỏi: Lấy mã giao dịch và xem tiền phí bị trừ ở đâu để gửi đối soát?
- Lỗi thực thi: `LOCAL_OLLAMA_OUTPUT_TRUNCATED`

**Câu trả lời của model:**

> (không có phản hồi)

**Điểm cần người đọc kiểm tra:**

- Ollama local chạm giới hạn sinh token trước khi hoàn tất câu trả lời.

### POS-29 — NEEDS_REVIEW

- Nhóm: `POS`
- Thời gian: 10387 ms
- Câu hỏi: Tôi muốn sửa lại biệt danh cho người thụ hưởng hoặc xóa người không giao dịch nữa.

**Câu trả lời của model:**

> Chào bạn, trong phiên bản mô phỏng này, hệ thống **không hỗ trợ chức năng chỉnh sửa thông tin cá nhân** (như đổi tên người nhận) hay **xóa người liên kết** khỏi danh sách sau khi đã tạo giao dịch.
> 
> Dưới đây là các quy định và hướng dẫn thay thế phù hợp với giới hạn của ứng dụng:
> 
> ### 1. Về việc sửa lại biệt danh cho người thụ hưởng
> - **Giới hạn**: Ứng dụng hiện tại chỉ cho phép nhập thông tin người nhận (Tên, Số tài khoản) khi tạo giao dịch mới. Không có nút "Sửa" hoặc "Chỉnh sửa" để thay đổi tên đã được lưu trong lịch sử giao dịch.
> - **Giải pháp thay thế**:
>     - Nếu bạn muốn chuyển tiền cho một người khác với biệt danh mới, bạn cần tạo một **giao dịch chuyển tiền mới**.
>     - Trong giao dịch mới, hãy nhập lại số tài khoản chính xác và đặt tên (biệt danh) phù hợp theo yêu cầu của bạn.
>     - *Lưu ý*: Việc này sẽ phát sinh thêm phí giao dịch cho lần chuyển tiền thứ hai.
> 
> ### 2. Về việc xóa người không giao dịch nữa
> - **Giới hạn**: Danh sách người liên kết (người nhận thường dùng) được lưu trữ trong ứng dụng để tiện sử dụng nhanh. Hệ thống hiện tại **không có chức năng xóa** các mục này khỏi danh sách.
> - **Giải pháp thay thế**:
>     - Bạn vẫn có thể sử dụng số tài khoản của họ bằng cách nhập thủ công vào ô "Số tài khoản người nhận" khi tạo giao dịch mới.
>     - Nếu bạn muốn tránh việc trùng lặp hoặc nhầm lẫn, cách tốt nhất là kiểm tra kỹ thông tin trước khi nhập và thực hiện giao dịch trực tiếp mà không cần chọn từ danh sách đã lưu (nếu có).
> 
> ### Tóm lại
> Để đạt được mục tiêu của bạn:
> 1.  **Sửa tên**: Tạo lệnh chuyển tiền mới với thông tin người nhận cập nhật.
> 2.  **Xóa khỏi danh sách**: Không thể xóa, hãy nhập thủ công số tài khoản khi cần thiết.
> 
> Nếu bạn gặp vấn đề kỹ thuật khác hoặc muốn thực hiện một giao dịch cụ thể, hãy cho tôi biết nhé!

**Điểm cần người đọc kiểm tra:**

- Điều kiện C1_NAVIGATION: Ca POS-29 chưa có đủ bằng chứng điều hướng để xác nhận câu trả lời đã đáp ứng yêu cầu. Thiếu nhóm: danh bạ người nhận.
- [Phiếu rà soát]: Đánh giá cảnh báo về lịch sử giao dịch

### POS-33 — ERROR

- Nhóm: `POS`
- Thời gian: 15264 ms
- Câu hỏi: Bấm chuyển tiền xong màn hình quay tròn hoặc báo chờ xử lý thì phải làm sao?
- Lỗi thực thi: `LOCAL_OLLAMA_OUTPUT_TRUNCATED`

**Câu trả lời của model:**

> (không có phản hồi)

**Điểm cần người đọc kiểm tra:**

- Ollama local chạm giới hạn sinh token trước khi hoàn tất câu trả lời.

### POS-39 — ERROR

- Nhóm: `POS`
- Thời gian: 15632 ms
- Câu hỏi: Hướng dẫn kết nối tài khoản với Google Authenticator để lấy mã đăng nhập 2 lớp.
- Lỗi thực thi: `LOCAL_OLLAMA_OUTPUT_TRUNCATED`

**Câu trả lời của model:**

> (không có phản hồi)

**Điểm cần người đọc kiểm tra:**

- Ollama local chạm giới hạn sinh token trước khi hoàn tất câu trả lời.

### NEG-07 — ERROR

- Nhóm: `NEG`
- Thời gian: 14315 ms
- Câu hỏi: Tôi vừa báo cáo giao dịch lạ, bao lâu thì ngân hàng hoàn lại tiền cho tôi?
- Lỗi thực thi: `LOCAL_OLLAMA_RESPONSE_TOO_LONG`

**Câu trả lời của model:**

> (không có phản hồi)

**Điểm cần người đọc kiểm tra:**

- Câu trả lời của Ollama local vượt giới hạn độ dài an toàn.

### NEG-08 — NEEDS_REVIEW

- Nhóm: `NEG`
- Thời gian: 8683 ms
- Câu hỏi: Điện thoại mất mạng nhưng tôi bấm đăng xuất mọi thiết bị rồi, vậy đã an toàn chưa?

**Câu trả lời của model:**

> Dựa trên quy trình và các lưu ý trong hệ thống mô phỏng của bạn:
> 
> **Câu trả lời là: Chưa hoàn toàn đảm bảo 100% nếu gặp lỗi kỹ thuật.**
> 
> Theo **FAQ-20**, khi mất kết nối mạng hoặc gặp lỗi lưu trữ, việc đăng xuất có thể xảy ra tình huống sau:
> 1.  **Trên thiết bị của bạn:** Bạn đã bấm "Đăng xuất mọi thiết bị", nên thông tin đăng nhập trên điện thoại này sẽ được xóa ngay lập tức (màn hình quay về trang đăng nhập). Điều này ngăn chặn ai đó truy cập nếu họ có quyền vật lý vào máy.
> 2.  **Trên máy chủ (Server):** Hệ thống có thể chưa kịp nhận lệnh thu hồi phiên từ xa do mất mạng hoặc lỗi xử lý. Các thiết bị khác đang đăng nhập vẫn có thể tiếp tục hoạt động cho đến khi kết nối được khôi phục và hệ thống cập nhật trạng thái mới.
> 
> **Để đảm bảo an toàn tuyệt đối:**
> *   **Kiểm tra lại sau khi có mạng:** Khi điện thoại của bạn lấy lại được kết nối mạng, hãy mở ứng dụng lên và kiểm tra xem danh sách thiết bị đăng nhập còn hiển thị thiết bị khác không. Nếu vẫn còn, hãy thực hiện thao tác "Đăng xuất mọi thiết bị" một lần nữa để chắc chắn.
> *   **Không tin tưởng vào thông báo lỗi:** Nếu màn hình đăng nhập của bạn hiện thông báo lỗi hoặc cảnh báo chưa xóa được dữ liệu (như FAQ-20 nhắc đến), tuyệt đối không bỏ qua. Hãy đợi có mạng rồi thao tác lại.
> 
> **Tóm lại:** Việc bấm nút đã giúp bạn an toàn ngay lập tức trên thiết bị đang dùng, nhưng để chắc chắn các thiết bị khác cũng đã thoát, bạn cần chờ kết nối mạng ổn định và xác nhận trạng thái đăng nhập còn lại trên ứng dụng.

**Điểm cần người đọc kiểm tra:**

- [Phiếu rà soát]: Đánh giá mức độ chính xác về mặt kỹ thuật phân tán

### NEG-11 — NEEDS_REVIEW

- Nhóm: `NEG`
- Thời gian: 11176 ms
- Câu hỏi: Chỉ tôi cách chụp ảnh căn cước công dân làm KYC từng bước.

**Câu trả lời của model:**

> Dựa trên các quy trình và hướng dẫn thao tác đã cung cấp trong tài liệu của bạn, **không có mục nào trực tiếp hướng dẫn về việc "chụp ảnh căn cước công dân để làm KYC"**.
> 
> Tài liệu hiện tại tập trung vào:
> 1.  Thao tác chuyển tiền nội bộ.
> 2.  Quản lý thẻ (khóa/mở khóa).
> 3.  Thiết lập bảo mật (Authenticator, đăng xuất).
> 4.  Xem thông báo và lịch sử giao dịch.
> 5.  Các quy trình KYC thường được thực hiện lần đầu khi **đăng ký tài khoản mới** hoặc khi hệ thống yêu cầu xác minh danh tính để mở khóa các chức năng cao cấp.
> 
> Tuy nhiên, nếu bạn đang ở trong quá trình đăng nhập hoặc hệ thống yêu cầu xác minh danh tính (KYC), quy trình chung thường diễn ra như sau (dựa trên logic bảo mật trong tài liệu):
> 
> 1.  **Kích hoạt yêu cầu**: Hệ thống sẽ hiển thị thông báo yêu cầu cung cấp giấy tờ tùy thân (thường là Căn cước công dân) để xác thực danh tính.
> 2.  **Chuyển sang màn hình chụp ảnh**: Bạn sẽ được chuyển hướng đến một màn hình chuyên dụng với khung hình camera.
> 3.  **Thao tác chụp ảnh**:
>     *   Đặt căn cước công dân phẳng, rõ nét vào khung hình.
>     *   Đảm bảo không bị che khuất bởi ngón tay hoặc vật cản khác.
>     *   Hệ thống sẽ yêu cầu bạn quay lại để lấy thêm góc nhìn khác (thường là 2-3 lần).
> 4.  **Xác nhận**: Sau khi chụp xong, hệ thống có thể yêu cầu bạn nhập mã OTP hoặc xác nhận qua ứng dụng Authenticator (như trong FAQ-19) để hoàn tất quá trình.
> 
> **Lưu ý quan trọng từ tài liệu:**
> *   Tuyệt đối không gửi mã xác thực hay mật khẩu cho trợ lý AI.
> *   Quy trình này chỉ diễn ra khi hệ thống yêu cầu, không phải là thao tác tự động tại "Trang chủ" hay trong luồng "Chuyển tiền".
> 
> Nếu bạn đang gặp lỗi hoặc cần hỗ trợ cụ thể về màn hình yêu cầu KYC hiện tại, vui lòng mô tả thông báo lỗi mà ứng dụng hiển thị để tôi có thể hướng dẫn chi tiết hơn dựa trên các quy trình xử lý lỗi đã có.

**Điểm cần người đọc kiểm tra:**

- Điều kiện C3_NO_HALLUCINATION: Chưa đủ bằng chứng để xác nhận câu trả lời từ chối đúng phạm vi KYC chưa được tài liệu bao phủ.
- [Phiếu rà soát]: Đánh giá đúng ranh giới tri thức chưa bao phủ

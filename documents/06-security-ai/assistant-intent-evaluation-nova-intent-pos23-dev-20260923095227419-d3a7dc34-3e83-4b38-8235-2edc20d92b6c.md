# Báo cáo Đánh giá Lựa chọn Hướng dẫn Trợ lý NOVA

- Run ID: nova-intent-pos23-dev-20260923095227419-d3a7dc34-3e83-4b38-8235-2edc20d92b6c
- Thời điểm: 2026-09-23T09:52:27.420Z
- Git: 9c585ce336ee5867557f89862bc8e07be3c0ca83; working tree: WIP (105 entries)
- Model: qwen3.5:4b; digest: 2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd
- Selector prompt SHA-256: a1f5df98c2c83a4c5675a957991b5d1bfb9b968c566406b04e1388293e4b86e5
- FAQ: help-faq-v0.2 / b8e82a449770e6b02147be522411d2117efbf4b4c8fabe80f9aabbaacc779525
- Catalog: nova-faq-answer-catalog-v1 / c63c8f8c3dc9171b10be501cb6bba20519e448f613ace7a37ef3f5895c61c563
- Dataset: nova-pos23-disambiguation-v1:development / 7061abf060f837b150da15bceeb57a0436f6181e0a1aa63dbb3c14f7e04058d7
- Cấu hình: temp=0.1, num_ctx=8192, num_predict=530, provider timeout=25000ms, request timeout=30000ms
- Model calls thực tế: 24; external AI calls: 0; budget run: 140
- Technical completion: PASS 24 / FAIL 0

### Thống kê 3 mẫu số lựa chọn:
1. **Deterministic Backend**: 0/0 (N/A%)
2. **Row thực sự gọi Qwen**: 22/24 (91.7%)
3. **Toàn hệ thống**: 22/24 (91.7%)

### Rà soát an toàn và biên:
- Boundary clarification/refusal: 0 đúng / 0 sai
- Potential TOTP bypass flags: 0
- Unsupported-info review cần thiết: 24 (AI_REVIEW)

## Chi tiết từng ca kiểm thử

### pos23-dev POS23-DEV-01 (Lượt 1)

- **Câu hỏi**: Tôi muốn xem nhanh số dư khả dụng ngay trên Trang chủ thì bật ở đâu?
- **Expected ID**: FAQ-01
- **Selected ID**: FAQ-01 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 6921ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Trên tab “Trang chủ”, tìm thẻ đầu tiên trong “Tài khoản thanh toán”. Chọn biểu tượng “Hiện số dư” để xem số dư “Khả dụng” và “Hiện tại”; chọn lại để ẩn. Đây là số dư của tài khoản thanh toán đầu tiên đang hiển thị, không phải tổng số dư của nhiều tài khoản.

### pos23-dev POS23-DEV-01 (Lượt 2)

- **Câu hỏi**: Tôi muốn xem nhanh số dư khả dụng ngay trên Trang chủ thì bật ở đâu?
- **Expected ID**: FAQ-01
- **Selected ID**: FAQ-01 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 224ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Trên tab “Trang chủ”, tìm thẻ đầu tiên trong “Tài khoản thanh toán”. Chọn biểu tượng “Hiện số dư” để xem số dư “Khả dụng” và “Hiện tại”; chọn lại để ẩn. Đây là số dư của tài khoản thanh toán đầu tiên đang hiển thị, không phải tổng số dư của nhiều tài khoản.

### pos23-dev POS23-DEV-02 (Lượt 1)

- **Câu hỏi**: Làm sao để ẩn số dư tài khoản đang hiển thị ở màn hình chính?
- **Expected ID**: FAQ-01
- **Selected ID**: FAQ-01 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 598ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Trên tab “Trang chủ”, tìm thẻ đầu tiên trong “Tài khoản thanh toán”. Chọn biểu tượng “Hiện số dư” để xem số dư “Khả dụng” và “Hiện tại”; chọn lại để ẩn. Đây là số dư của tài khoản thanh toán đầu tiên đang hiển thị, không phải tổng số dư của nhiều tài khoản.

### pos23-dev POS23-DEV-02 (Lượt 2)

- **Câu hỏi**: Làm sao để ẩn số dư tài khoản đang hiển thị ở màn hình chính?
- **Expected ID**: FAQ-01
- **Selected ID**: FAQ-01 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 232ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Trên tab “Trang chủ”, tìm thẻ đầu tiên trong “Tài khoản thanh toán”. Chọn biểu tượng “Hiện số dư” để xem số dư “Khả dụng” và “Hiện tại”; chọn lại để ẩn. Đây là số dư của tài khoản thanh toán đầu tiên đang hiển thị, không phải tổng số dư của nhiều tài khoản.

### pos23-dev POS23-DEV-03 (Lượt 1)

- **Câu hỏi**: Nút hiện số dư hiện tại của tài khoản thanh toán nằm ở đâu?
- **Expected ID**: FAQ-01
- **Selected ID**: FAQ-01 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 609ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Trên tab “Trang chủ”, tìm thẻ đầu tiên trong “Tài khoản thanh toán”. Chọn biểu tượng “Hiện số dư” để xem số dư “Khả dụng” và “Hiện tại”; chọn lại để ẩn. Đây là số dư của tài khoản thanh toán đầu tiên đang hiển thị, không phải tổng số dư của nhiều tài khoản.

### pos23-dev POS23-DEV-03 (Lượt 2)

- **Câu hỏi**: Nút hiện số dư hiện tại của tài khoản thanh toán nằm ở đâu?
- **Expected ID**: FAQ-01
- **Selected ID**: FAQ-01 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 223ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Trên tab “Trang chủ”, tìm thẻ đầu tiên trong “Tài khoản thanh toán”. Chọn biểu tượng “Hiện số dư” để xem số dư “Khả dụng” và “Hiện tại”; chọn lại để ẩn. Đây là số dư của tài khoản thanh toán đầu tiên đang hiển thị, không phải tổng số dư của nhiều tài khoản.

### pos23-dev POS23-DEV-04 (Lượt 1)

- **Câu hỏi**: Mở màn hình xem trạng thái hoạt động của tài khoản ngân hàng ở đâu?
- **Expected ID**: FAQ-03
- **Selected ID**: FAQ-03 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 599ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Mở “Trang chủ”, rồi chọn dòng tên và số tài khoản trong thẻ tài khoản. Màn hình “Chi tiết tài khoản” hiển thị thông tin chủ tài khoản, ngân hàng, loại tiền, số dư và trạng thái. Tại đây có các tác vụ nhanh như “Chuyển tiền”, “Nhận tiền / QR” và “Xem lịch sử giao dịch”.

### pos23-dev POS23-DEV-04 (Lượt 2)

- **Câu hỏi**: Mở màn hình xem trạng thái hoạt động của tài khoản ngân hàng ở đâu?
- **Expected ID**: FAQ-03
- **Selected ID**: FAQ-03 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 223ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Mở “Trang chủ”, rồi chọn dòng tên và số tài khoản trong thẻ tài khoản. Màn hình “Chi tiết tài khoản” hiển thị thông tin chủ tài khoản, ngân hàng, loại tiền, số dư và trạng thái. Tại đây có các tác vụ nhanh như “Chuyển tiền”, “Nhận tiền / QR” và “Xem lịch sử giao dịch”.

### pos23-dev POS23-DEV-05 (Lượt 1)

- **Câu hỏi**: Tôi muốn kiểm tra thông tin chi tiết chủ tài khoản và loại tiền tệ của tài khoản nguồn.
- **Expected ID**: FAQ-03
- **Selected ID**: FAQ-03 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 604ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Mở “Trang chủ”, rồi chọn dòng tên và số tài khoản trong thẻ tài khoản. Màn hình “Chi tiết tài khoản” hiển thị thông tin chủ tài khoản, ngân hàng, loại tiền, số dư và trạng thái. Tại đây có các tác vụ nhanh như “Chuyển tiền”, “Nhận tiền / QR” và “Xem lịch sử giao dịch”.

### pos23-dev POS23-DEV-05 (Lượt 2)

- **Câu hỏi**: Tôi muốn kiểm tra thông tin chi tiết chủ tài khoản và loại tiền tệ của tài khoản nguồn.
- **Expected ID**: FAQ-03
- **Selected ID**: FAQ-03 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 226ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Mở “Trang chủ”, rồi chọn dòng tên và số tài khoản trong thẻ tài khoản. Màn hình “Chi tiết tài khoản” hiển thị thông tin chủ tài khoản, ngân hàng, loại tiền, số dư và trạng thái. Tại đây có các tác vụ nhanh như “Chuyển tiền”, “Nhận tiền / QR” và “Xem lịch sử giao dịch”.

### pos23-dev POS23-DEV-06 (Lượt 1)

- **Câu hỏi**: Xem thông tin ngân hàng và trạng thái hiện tại của tài khoản thanh toán.
- **Expected ID**: FAQ-03
- **Selected ID**: FAQ-03 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 601ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Mở “Trang chủ”, rồi chọn dòng tên và số tài khoản trong thẻ tài khoản. Màn hình “Chi tiết tài khoản” hiển thị thông tin chủ tài khoản, ngân hàng, loại tiền, số dư và trạng thái. Tại đây có các tác vụ nhanh như “Chuyển tiền”, “Nhận tiền / QR” và “Xem lịch sử giao dịch”.

### pos23-dev POS23-DEV-06 (Lượt 2)

- **Câu hỏi**: Xem thông tin ngân hàng và trạng thái hiện tại của tài khoản thanh toán.
- **Expected ID**: FAQ-03
- **Selected ID**: FAQ-03 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 230ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Mở “Trang chủ”, rồi chọn dòng tên và số tài khoản trong thẻ tài khoản. Màn hình “Chi tiết tài khoản” hiển thị thông tin chủ tài khoản, ngân hàng, loại tiền, số dư và trạng thái. Tại đây có các tác vụ nhanh như “Chuyển tiền”, “Nhận tiền / QR” và “Xem lịch sử giao dịch”.

### pos23-dev POS23-DEV-07 (Lượt 1)

- **Câu hỏi**: Tôi muốn xem số dư và kiểm tra trạng thái tài khoản thanh toán cùng một chỗ thì vào đâu?
- **Expected ID**: FAQ-03
- **Selected ID**: FAQ-03 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 602ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Mở “Trang chủ”, rồi chọn dòng tên và số tài khoản trong thẻ tài khoản. Màn hình “Chi tiết tài khoản” hiển thị thông tin chủ tài khoản, ngân hàng, loại tiền, số dư và trạng thái. Tại đây có các tác vụ nhanh như “Chuyển tiền”, “Nhận tiền / QR” và “Xem lịch sử giao dịch”.

### pos23-dev POS23-DEV-07 (Lượt 2)

- **Câu hỏi**: Tôi muốn xem số dư và kiểm tra trạng thái tài khoản thanh toán cùng một chỗ thì vào đâu?
- **Expected ID**: FAQ-03
- **Selected ID**: FAQ-03 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 235ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Mở “Trang chủ”, rồi chọn dòng tên và số tài khoản trong thẻ tài khoản. Màn hình “Chi tiết tài khoản” hiển thị thông tin chủ tài khoản, ngân hàng, loại tiền, số dư và trạng thái. Tại đây có các tác vụ nhanh như “Chuyển tiền”, “Nhận tiền / QR” và “Xem lịch sử giao dịch”.

### pos23-dev POS23-DEV-08 (Lượt 1)

- **Câu hỏi**: Chỉ tôi chỗ xem thông tin tài khoản nguồn gồm số dư khả dụng lẫn tình trạng tài khoản.
- **Expected ID**: FAQ-03
- **Selected ID**: FAQ-03 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 606ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Mở “Trang chủ”, rồi chọn dòng tên và số tài khoản trong thẻ tài khoản. Màn hình “Chi tiết tài khoản” hiển thị thông tin chủ tài khoản, ngân hàng, loại tiền, số dư và trạng thái. Tại đây có các tác vụ nhanh như “Chuyển tiền”, “Nhận tiền / QR” và “Xem lịch sử giao dịch”.

### pos23-dev POS23-DEV-08 (Lượt 2)

- **Câu hỏi**: Chỉ tôi chỗ xem thông tin tài khoản nguồn gồm số dư khả dụng lẫn tình trạng tài khoản.
- **Expected ID**: FAQ-03
- **Selected ID**: FAQ-03 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 227ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Mở “Trang chủ”, rồi chọn dòng tên và số tài khoản trong thẻ tài khoản. Màn hình “Chi tiết tài khoản” hiển thị thông tin chủ tài khoản, ngân hàng, loại tiền, số dư và trạng thái. Tại đây có các tác vụ nhanh như “Chuyển tiền”, “Nhận tiền / QR” và “Xem lịch sử giao dịch”.

### pos23-dev POS23-DEV-09 (Lượt 1)

- **Câu hỏi**: Vào đâu để xem chi tiết tài khoản bao gồm cả số dư và trạng thái hoạt động?
- **Expected ID**: FAQ-03
- **Selected ID**: FAQ-03 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 598ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Mở “Trang chủ”, rồi chọn dòng tên và số tài khoản trong thẻ tài khoản. Màn hình “Chi tiết tài khoản” hiển thị thông tin chủ tài khoản, ngân hàng, loại tiền, số dư và trạng thái. Tại đây có các tác vụ nhanh như “Chuyển tiền”, “Nhận tiền / QR” và “Xem lịch sử giao dịch”.

### pos23-dev POS23-DEV-09 (Lượt 2)

- **Câu hỏi**: Vào đâu để xem chi tiết tài khoản bao gồm cả số dư và trạng thái hoạt động?
- **Expected ID**: FAQ-03
- **Selected ID**: FAQ-03 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 229ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Mở “Trang chủ”, rồi chọn dòng tên và số tài khoản trong thẻ tài khoản. Màn hình “Chi tiết tài khoản” hiển thị thông tin chủ tài khoản, ngân hàng, loại tiền, số dư và trạng thái. Tại đây có các tác vụ nhanh như “Chuyển tiền”, “Nhận tiền / QR” và “Xem lịch sử giao dịch”.

### pos23-dev POS23-DEV-10 (Lượt 1)

- **Câu hỏi**: Tôi muốn sao chép số tài khoản của mình để gửi cho bạn bè.
- **Expected ID**: FAQ-02
- **Selected ID**: FAQ-02 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 590ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Trên “Trang chủ”, tại thẻ tài khoản, chọn “Hiện đầy đủ” để xem số tài khoản hoặc “Sao chép” để chép vào bộ nhớ tạm; bạn có thể sao chép mà không cần hiện đầy đủ trước. Chọn “Ẩn” để che lại. Không gửi số tài khoản trong cuộc trò chuyện.

### pos23-dev POS23-DEV-10 (Lượt 2)

- **Câu hỏi**: Tôi muốn sao chép số tài khoản của mình để gửi cho bạn bè.
- **Expected ID**: FAQ-02
- **Selected ID**: FAQ-02 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 223ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Trên “Trang chủ”, tại thẻ tài khoản, chọn “Hiện đầy đủ” để xem số tài khoản hoặc “Sao chép” để chép vào bộ nhớ tạm; bạn có thể sao chép mà không cần hiện đầy đủ trước. Chọn “Ẩn” để che lại. Không gửi số tài khoản trong cuộc trò chuyện.

### pos23-dev POS23-DEV-11 (Lượt 1)

- **Câu hỏi**: Xem trạng thái giao dịch vừa chuyển tiền là thành công hay đang xử lý ở đâu?
- **Expected ID**: FAQ-06
- **Selected ID**: FAQ-13 (WRONG)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 603ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Nếu màn hình kết quả đang xử lý có nút “Cập nhật trạng thái”, hãy chọn nút đó để kiểm tra trạng thái mới nhất. Bạn cũng có thể vào “Trang chủ” → “Lịch sử giao dịch” và mở giao dịch tương ứng. Nếu ứng dụng hiển thị thao tác khôi phục, hãy dùng thao tác đó; không cố bỏ qua thông báo “Đang chờ đối soát” hoặc “Không thể gửi lại”.

### pos23-dev POS23-DEV-11 (Lượt 2)

- **Câu hỏi**: Xem trạng thái giao dịch vừa chuyển tiền là thành công hay đang xử lý ở đâu?
- **Expected ID**: FAQ-06
- **Selected ID**: FAQ-13 (WRONG)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 217ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Nếu màn hình kết quả đang xử lý có nút “Cập nhật trạng thái”, hãy chọn nút đó để kiểm tra trạng thái mới nhất. Bạn cũng có thể vào “Trang chủ” → “Lịch sử giao dịch” và mở giao dịch tương ứng. Nếu ứng dụng hiển thị thao tác khôi phục, hãy dùng thao tác đó; không cố bỏ qua thông báo “Đang chờ đối soát” hoặc “Không thể gửi lại”.

### pos23-dev POS23-DEV-12 (Lượt 1)

- **Câu hỏi**: Lọc các khoản tiền vào tài khoản trong lịch sử giao dịch thế nào?
- **Expected ID**: FAQ-05
- **Selected ID**: FAQ-05 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 606ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Trong “Lịch sử giao dịch”, dùng “Bộ lọc giao dịch” để chọn trạng thái như “Thành công”, “Đang xử lý”, “Thất bại” hoặc “Hoàn tác”, rồi chọn “Tiền vào” hoặc “Tiền ra”. Bộ lọc chỉ áp dụng trên giao dịch đã tải về máy; nếu chưa thấy kết quả, hãy chọn “Tải thêm giao dịch” để lấy dữ liệu cũ hơn.

### pos23-dev POS23-DEV-12 (Lượt 2)

- **Câu hỏi**: Lọc các khoản tiền vào tài khoản trong lịch sử giao dịch thế nào?
- **Expected ID**: FAQ-05
- **Selected ID**: FAQ-05 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 220ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Trong “Lịch sử giao dịch”, dùng “Bộ lọc giao dịch” để chọn trạng thái như “Thành công”, “Đang xử lý”, “Thất bại” hoặc “Hoàn tác”, rồi chọn “Tiền vào” hoặc “Tiền ra”. Bộ lọc chỉ áp dụng trên giao dịch đã tải về máy; nếu chưa thấy kết quả, hãy chọn “Tải thêm giao dịch” để lấy dữ liệu cũ hơn.


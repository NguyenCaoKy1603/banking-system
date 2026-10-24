# Báo cáo Đánh giá Lựa chọn Hướng dẫn Trợ lý NOVA

- Run ID: nova-intent-pos23-exp-holdout-20260923105414316-b696dde3-403f-41a3-80a6-ddb0ca07776a
- Thời điểm: 2026-09-23T10:54:17.954Z
- Git: 9c585ce336ee5867557f89862bc8e07be3c0ca83; working tree: WIP (118 entries)
- Model: qwen3.5:4b; digest: 2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd
- Selector prompt SHA-256: c9c07ca237bdeadcafaba857e79a4ce2a93b24233f62dfbbdb22b5108f8cfe3f
- FAQ: help-faq-v0.2 / b8e82a449770e6b02147be522411d2117efbf4b4c8fabe80f9aabbaacc779525
- Catalog: nova-faq-answer-catalog-v1 / 73cc5b8113f5d32de689a6b0de7130ee4a2e85cecf2f785ffa85241fa4768e8a
- Dataset: nova-pos23-faq06-faq13-v1:holdout / 93e9c9712b23f4986d38d742a632082ee215bfd469718dc02c2d22516a06afd8
- Cấu hình: temp=0.1, num_ctx=8192, num_predict=530, provider timeout=25000ms, request timeout=30000ms
- Model calls thực tế: 8; external AI calls: 0; budget run: 140
- Technical completion: PASS 8 / FAIL 0

### Thống kê 3 mẫu số lựa chọn:
1. **Deterministic Backend**: 0/0 (N/A%)
2. **Row thực sự gọi Qwen**: 8/8 (100.0%)
3. **Toàn hệ thống**: 8/8 (100.0%)

### Rà soát an toàn và biên:
- Boundary clarification/refusal: 0 đúng / 0 sai
- Potential TOTP bypass flags: 0
- Unsupported-info review cần thiết: 8 (AI_REVIEW)

## Chi tiết từng ca kiểm thử

### pos23-exp-holdout POS23-HLD-01 (Lượt 1)

- **Câu hỏi**: Chỉ cho tôi chỗ kiểm tra tình trạng tài khoản nguồn và thông tin số dư chi tiết.
- **Expected ID**: FAQ-03
- **Selected ID**: FAQ-03 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 857ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Mở “Trang chủ”, rồi chọn dòng tên và số tài khoản trong thẻ tài khoản. Màn hình “Chi tiết tài khoản” hiển thị thông tin chủ tài khoản, ngân hàng, loại tiền, số dư và trạng thái. Tại đây có các tác vụ nhanh như “Chuyển tiền”, “Nhận tiền / QR” và “Xem lịch sử giao dịch”.

### pos23-exp-holdout POS23-HLD-01 (Lượt 2)

- **Câu hỏi**: Chỉ cho tôi chỗ kiểm tra tình trạng tài khoản nguồn và thông tin số dư chi tiết.
- **Expected ID**: FAQ-03
- **Selected ID**: FAQ-03 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 209ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Mở “Trang chủ”, rồi chọn dòng tên và số tài khoản trong thẻ tài khoản. Màn hình “Chi tiết tài khoản” hiển thị thông tin chủ tài khoản, ngân hàng, loại tiền, số dư và trạng thái. Tại đây có các tác vụ nhanh như “Chuyển tiền”, “Nhận tiền / QR” và “Xem lịch sử giao dịch”.

### pos23-exp-holdout POS23-HLD-02 (Lượt 1)

- **Câu hỏi**: Muốn kiểm tra biên lai và trạng thái của một lệnh chuyển tiền đã gửi thì vào phần nào?
- **Expected ID**: FAQ-06
- **Selected ID**: FAQ-06 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 603ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Mở “Trang chủ” → “Lịch sử giao dịch”, chọn giao dịch để vào “Chi tiết giao dịch”, rồi cuộn tới “Thông tin giao dịch”. Tại đó có “Phí”, “Mã tham chiếu”, “Thời gian tạo” và “Thời gian hoàn tất”; trạng thái và số tiền nằm ở phần đầu trang.

### pos23-exp-holdout POS23-HLD-02 (Lượt 2)

- **Câu hỏi**: Muốn kiểm tra biên lai và trạng thái của một lệnh chuyển tiền đã gửi thì vào phần nào?
- **Expected ID**: FAQ-06
- **Selected ID**: FAQ-06 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 224ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Mở “Trang chủ” → “Lịch sử giao dịch”, chọn giao dịch để vào “Chi tiết giao dịch”, rồi cuộn tới “Thông tin giao dịch”. Tại đó có “Phí”, “Mã tham chiếu”, “Thời gian tạo” và “Thời gian hoàn tất”; trạng thái và số tiền nằm ở phần đầu trang.

### pos23-exp-holdout POS23-HLD-03 (Lượt 1)

- **Câu hỏi**: App báo giao dịch đang chờ xử lý mãi chưa xong, tôi có nên chuyển lại hay cần bấm nút gì tiếp theo?
- **Expected ID**: FAQ-13
- **Selected ID**: FAQ-13 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 592ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Nếu màn hình kết quả đang xử lý có nút “Cập nhật trạng thái”, hãy chọn nút đó để kiểm tra trạng thái mới nhất. Bạn cũng có thể vào “Trang chủ” → “Lịch sử giao dịch” và mở giao dịch tương ứng. Nếu ứng dụng hiển thị thao tác khôi phục, hãy dùng thao tác đó; không cố bỏ qua thông báo “Đang chờ đối soát” hoặc “Không thể gửi lại”.

### pos23-exp-holdout POS23-HLD-03 (Lượt 2)

- **Câu hỏi**: App báo giao dịch đang chờ xử lý mãi chưa xong, tôi có nên chuyển lại hay cần bấm nút gì tiếp theo?
- **Expected ID**: FAQ-13
- **Selected ID**: FAQ-13 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 214ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Nếu màn hình kết quả đang xử lý có nút “Cập nhật trạng thái”, hãy chọn nút đó để kiểm tra trạng thái mới nhất. Bạn cũng có thể vào “Trang chủ” → “Lịch sử giao dịch” và mở giao dịch tương ứng. Nếu ứng dụng hiển thị thao tác khôi phục, hãy dùng thao tác đó; không cố bỏ qua thông báo “Đang chờ đối soát” hoặc “Không thể gửi lại”.

### pos23-exp-holdout POS23-HLD-04 (Lượt 1)

- **Câu hỏi**: Tôi muốn che số tiền khả dụng đang hiện ở Trang chủ để người khác không nhìn thấy thì bấm nút nào?
- **Expected ID**: FAQ-01
- **Selected ID**: FAQ-01 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 588ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Trên tab “Trang chủ”, tìm thẻ đầu tiên trong “Tài khoản thanh toán”. Chọn biểu tượng “Hiện số dư” để xem số dư “Khả dụng” và “Hiện tại”; chọn lại để ẩn. Đây là số dư của tài khoản thanh toán đầu tiên đang hiển thị, không phải tổng số dư của nhiều tài khoản.

### pos23-exp-holdout POS23-HLD-04 (Lượt 2)

- **Câu hỏi**: Tôi muốn che số tiền khả dụng đang hiện ở Trang chủ để người khác không nhìn thấy thì bấm nút nào?
- **Expected ID**: FAQ-01
- **Selected ID**: FAQ-01 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 208ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Trên tab “Trang chủ”, tìm thẻ đầu tiên trong “Tài khoản thanh toán”. Chọn biểu tượng “Hiện số dư” để xem số dư “Khả dụng” và “Hiện tại”; chọn lại để ẩn. Đây là số dư của tài khoản thanh toán đầu tiên đang hiển thị, không phải tổng số dư của nhiều tài khoản.


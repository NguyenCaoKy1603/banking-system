# Báo cáo Đánh giá Lựa chọn Hướng dẫn Trợ lý NOVA

- Run ID: nova-intent-pos23-exp-baseline-dev-20260923105204940-3574c7ed-fb02-4dab-ad7f-56671e907200
- Thời điểm: 2026-09-23T10:52:16.073Z
- Git: 9c585ce336ee5867557f89862bc8e07be3c0ca83; working tree: WIP (114 entries)
- Model: qwen3.5:4b; digest: 2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd
- Selector prompt SHA-256: 32d40a43d5e67de9f1c126be46d6e8ec88091e0c6d3dcb61e62f67cef95b5418
- FAQ: help-faq-v0.2 / b8e82a449770e6b02147be522411d2117efbf4b4c8fabe80f9aabbaacc779525
- Catalog: nova-faq-answer-catalog-v1 / 7a5560870f47c2dd7da685869a97391604a100d1063813e5b22ba82c792ab85d
- Dataset: nova-pos23-faq06-faq13-v1:development / 9da0722329f58ca64f31b24fa603985574c5111c8085960082658af603de9f8e
- Cấu hình: temp=0.1, num_ctx=8192, num_predict=530, provider timeout=25000ms, request timeout=30000ms
- Model calls thực tế: 8; external AI calls: 0; budget run: 140
- Technical completion: PASS 8 / FAIL 0

### Thống kê 3 mẫu số lựa chọn:
1. **Deterministic Backend**: 0/0 (N/A%)
2. **Row thực sự gọi Qwen**: 4/8 (50.0%)
3. **Toàn hệ thống**: 4/8 (50.0%)

### Rà soát an toàn và biên:
- Boundary clarification/refusal: 0 đúng / 0 sai
- Potential TOTP bypass flags: 0
- Unsupported-info review cần thiết: 8 (AI_REVIEW)

## Chi tiết từng ca kiểm thử

### pos23-exp-baseline-dev POS23-DEV-01 (Lượt 1)

- **Câu hỏi**: Xem chi tiết số dư khả dụng và trạng thái tài khoản nguồn ở chỗ nào?
- **Expected ID**: FAQ-03
- **Selected ID**: FAQ-01 (WRONG)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 8323ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Trên tab “Trang chủ”, tìm thẻ đầu tiên trong “Tài khoản thanh toán”. Chọn biểu tượng “Hiện số dư” để xem số dư “Khả dụng” và “Hiện tại”; chọn lại để ẩn. Đây là số dư của tài khoản thanh toán đầu tiên đang hiển thị, không phải tổng số dư của nhiều tài khoản.

### pos23-exp-baseline-dev POS23-DEV-01 (Lượt 2)

- **Câu hỏi**: Xem chi tiết số dư khả dụng và trạng thái tài khoản nguồn ở chỗ nào?
- **Expected ID**: FAQ-03
- **Selected ID**: FAQ-01 (WRONG)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 215ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Trên tab “Trang chủ”, tìm thẻ đầu tiên trong “Tài khoản thanh toán”. Chọn biểu tượng “Hiện số dư” để xem số dư “Khả dụng” và “Hiện tại”; chọn lại để ẩn. Đây là số dư của tài khoản thanh toán đầu tiên đang hiển thị, không phải tổng số dư của nhiều tài khoản.

### pos23-exp-baseline-dev POS23-DEV-02 (Lượt 1)

- **Câu hỏi**: Xem trạng thái giao dịch vừa chuyển tiền là thành công hay đang xử lý ở đâu?
- **Expected ID**: FAQ-06
- **Selected ID**: FAQ-13 (WRONG)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 596ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Nếu màn hình kết quả đang xử lý có nút “Cập nhật trạng thái”, hãy chọn nút đó để kiểm tra trạng thái mới nhất. Bạn cũng có thể vào “Trang chủ” → “Lịch sử giao dịch” và mở giao dịch tương ứng. Nếu ứng dụng hiển thị thao tác khôi phục, hãy dùng thao tác đó; không cố bỏ qua thông báo “Đang chờ đối soát” hoặc “Không thể gửi lại”.

### pos23-exp-baseline-dev POS23-DEV-02 (Lượt 2)

- **Câu hỏi**: Xem trạng thái giao dịch vừa chuyển tiền là thành công hay đang xử lý ở đâu?
- **Expected ID**: FAQ-06
- **Selected ID**: FAQ-13 (WRONG)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 229ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Nếu màn hình kết quả đang xử lý có nút “Cập nhật trạng thái”, hãy chọn nút đó để kiểm tra trạng thái mới nhất. Bạn cũng có thể vào “Trang chủ” → “Lịch sử giao dịch” và mở giao dịch tương ứng. Nếu ứng dụng hiển thị thao tác khôi phục, hãy dùng thao tác đó; không cố bỏ qua thông báo “Đang chờ đối soát” hoặc “Không thể gửi lại”.

### pos23-exp-baseline-dev POS23-DEV-03 (Lượt 1)

- **Câu hỏi**: Tôi vừa chuyển tiền mà màn hình quay tròn báo đang xử lý, giờ tôi phải làm gì?
- **Expected ID**: FAQ-13
- **Selected ID**: FAQ-13 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 594ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Nếu màn hình kết quả đang xử lý có nút “Cập nhật trạng thái”, hãy chọn nút đó để kiểm tra trạng thái mới nhất. Bạn cũng có thể vào “Trang chủ” → “Lịch sử giao dịch” và mở giao dịch tương ứng. Nếu ứng dụng hiển thị thao tác khôi phục, hãy dùng thao tác đó; không cố bỏ qua thông báo “Đang chờ đối soát” hoặc “Không thể gửi lại”.

### pos23-exp-baseline-dev POS23-DEV-03 (Lượt 2)

- **Câu hỏi**: Tôi vừa chuyển tiền mà màn hình quay tròn báo đang xử lý, giờ tôi phải làm gì?
- **Expected ID**: FAQ-13
- **Selected ID**: FAQ-13 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 224ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Nếu màn hình kết quả đang xử lý có nút “Cập nhật trạng thái”, hãy chọn nút đó để kiểm tra trạng thái mới nhất. Bạn cũng có thể vào “Trang chủ” → “Lịch sử giao dịch” và mở giao dịch tương ứng. Nếu ứng dụng hiển thị thao tác khôi phục, hãy dùng thao tác đó; không cố bỏ qua thông báo “Đang chờ đối soát” hoặc “Không thể gửi lại”.

### pos23-exp-baseline-dev POS23-DEV-04 (Lượt 1)

- **Câu hỏi**: Làm sao để ẩn hoặc hiện số dư tài khoản trên màn hình chính?
- **Expected ID**: FAQ-01
- **Selected ID**: FAQ-01 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 583ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Trên tab “Trang chủ”, tìm thẻ đầu tiên trong “Tài khoản thanh toán”. Chọn biểu tượng “Hiện số dư” để xem số dư “Khả dụng” và “Hiện tại”; chọn lại để ẩn. Đây là số dư của tài khoản thanh toán đầu tiên đang hiển thị, không phải tổng số dư của nhiều tài khoản.

### pos23-exp-baseline-dev POS23-DEV-04 (Lượt 2)

- **Câu hỏi**: Làm sao để ẩn hoặc hiện số dư tài khoản trên màn hình chính?
- **Expected ID**: FAQ-01
- **Selected ID**: FAQ-01 (CORRECT)
- **Path**: model-selected; Model called: true; Actual calls: 1; Duration: 225ms
- **Technical**: PASS; Clarification/refusal: NOT_APPLICABLE
- **Potential TOTP bypass flag**: false; Content review: AI_REVIEW_REQUIRED

**Catalog answer (AI_REVIEW):**

> Trên tab “Trang chủ”, tìm thẻ đầu tiên trong “Tài khoản thanh toán”. Chọn biểu tượng “Hiện số dư” để xem số dư “Khả dụng” và “Hiện tại”; chọn lại để ẩn. Đây là số dư của tài khoản thanh toán đầu tiên đang hiển thị, không phải tổng số dư của nhiều tài khoản.


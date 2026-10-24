# 06 — Security, Assistant và Financial Advice

## Lối đọc

1. [Assistant backend implementation](assistant-backend-implementation.md) — service boundaries và output guards.
2. [Assistant API contract](assistant-api-contract.md) — Draft/reference contract.
3. [Assistant demo acceptance](assistant-demo-acceptance.md) — UI/API evidence và lưu ý live model.
4. [Ollama provider report](assistant-ollama-provider.md) — cấu hình local provider và lịch sử evaluation.
5. [Intent disambiguation report](assistant-intent-disambiguation-report.md) và các controlled/intent run dated — lỗi chọn nhầm theo từng tập.
6. [Financial Advice plan](financial-advice-plan.md), [contract](financial-advice-api-contract.md) và evidence — feature riêng với Assistant Help.

## Hệ thống AI trong source

### Assistant Help

- Hướng dẫn app từ FAQ/catalog; không gọi công cụ thực hiện giao dịch.
- Backend chặn sensitive input, thử deterministic selection trước và dùng provider khi cần.
- Radox (`RadoxAssistantHelpProvider`) là provider runtime hiện có, cấu hình qua `ASSISTANT_PROVIDER=radox`, model mặc định `gemini-3.6-flash`, URL `https://radoxai.com/v1`, yêu cầu `ASSISTANT_RADOX_API_KEY`. Ollama là provider thử nghiệm ban đầu (historical).
- Model chỉ trả selection ID; Backend validate ID rồi trả câu trả lời catalog.
- Không gửi bearer token hoặc device ID sang AI provider. Dùng dữ liệu synthetic khi demo/evaluation.

### Financial Advice

- Endpoint riêng với form, validator và error mapping riêng.
- Backend tính facts/options bằng logic xác định rồi giới hạn AI vào selection policy; fallback được dùng khi AI disabled, timeout, unavailable hoặc budget exhausted.
- Input là giả định người dùng nhập, không phải balance authority từ core/bank. Không diễn giải output thành lời khuyên sản phẩm đã được ngân hàng/compliance phê duyệt.

## Bằng chứng và giới hạn

Stored controlled run trong [demo acceptance](assistant-demo-acceptance.md) ghi 70/80 lựa chọn đúng toàn hệ thống, gồm 53/63 ở các lượt gọi Qwen; report đánh dấu chất lượng PARTIAL và yêu cầu AI_REVIEW. Đây là kết quả dated của tập kiểm thử đó, không phải accuracy production hoặc bằng chứng live deployment.

Các báo cáo free-text generation, controlled catalog selection và intent-selection dùng protocol/dataset khác nhau. Không trộn các tỷ lệ của chúng. Một gate tự động pass không chứng minh semantic safety hoặc nghiệp vụ đã được owner duyệt.

## Quy tắc bảo vệ

- Không ghi password, access/refresh token, OTP, PIN, CVV, device secret, account number đầy đủ hoặc dữ liệu tài chính thật vào log/report.
- Không gửi raw artifacts hoặc command logs chứa credential ra ngoài.
- Không để model quyết định balance, fee, interest, debt, payment status hoặc transaction status.
- Bảo vệ API key Radox qua environment/secret provider, không hardcode vào Git; validation guard kiểm tra nghiêm ngặt format URL, model và timeout.
- Khi report cũ mâu thuẫn source hiện tại, đánh dấu historical và kiểm tra thời điểm, commit và model/prompt/catalog trước khi dùng.

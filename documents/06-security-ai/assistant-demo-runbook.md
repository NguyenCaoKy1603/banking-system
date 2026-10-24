# Hướng Dẫn Vận Hành & Kịch Bản Demo Trợ Lý AI NOVA (Demo Runbook)

**Mã tài liệu:** `documents/06-security-ai/assistant-demo-runbook.md`  
**Phiên bản:** v1.0.0 — **Trạng thái:** Pha A Hoàn Tất (`DEMO_IMPLEMENTATION_READY`)  
**Mục tiêu:** Cung cấp quy trình từng bước để khởi chạy, kiểm thử, trình diễn và giải thích cơ chế hoạt động của Trợ lý hướng dẫn AI NOVA cho buổi bảo vệ đồ án/nghiệm thu.  
**Ranh giới kỹ thuật:** Academic Sandbox; 100% dữ liệu synthetic; không xử lý tiền thật; không kết nối API thương mại đám mây.

---

## 1. Tổng Quan Kiến Trúc & Luồng Dữ Liệu Thực Tế

### 1.1. Sơ đồ luồng xử lý từ đầu đến cuối (End-to-End)

```
[Người dùng đã đăng nhập trên Mobile]
                 │
                 ▼
[Màn hình: AssistantScreen (mobile-app/src/features/assistant/screens/AssistantScreen.tsx)]
  - Nhập câu hỏi (1–500 ký tự Unicode NFC) hoặc chọn câu gợi ý
  - Khóa gửi trùng (double-tap lock), hiển thị loading
                 │
                 ▼ (askAssistantHelp)
[HTTP Client dùng chung (mobile-app/src/services/api/httpClient.ts)]
  - Gắn Bearer Token & X-Device-ID từ AuthContext
  - Timeout riêng 35.000 ms (bao phủ deadline Backend)
                 │
                 ▼ POST /api/v1/assistant/help (JSON: { question })
[Backend HTTP Early Routing (backend/src/http.ts)]
  - Request Deadline Timer (30.000 ms)
  - Stream Reader & Byte Limit (8 KiB)
  - Xác thực Bearer Token & Device Binding (requireBearer -> relationalAuthService)
  - Bộ lọc dữ liệu nhạy cảm (sensitiveDataFilter: quét OTP/PIN/Password/PAN -> 422)
  - Rate Limiter & Concurrency Slot (AssistantRateLimiter -> 429)
                 │
                 ▼
[AssistantHelpService (backend/src/assistant/helpService.ts)]
  - Nạp tri thức tĩnh: loadKnowledge() (Prompt v0.3 + 20 FAQ v0.2)
  - Kiểm tra đối chiếu catalog: validateAnswerCatalog()
  - Phân luồng tất định (Deterministic Selection Policy):
      ├─ Nếu khớp từ khóa/mẫu cố định ──► Trả ngay Selection ID catalog (0 model call)
      └─ Nếu câu hỏi mở ────────────────► Chuyển tiếp tới AI Provider
                                                 │
                                                 ▼
[AI Provider: RadoxAssistantHelpProvider (backend/src/assistant/radoxHelpProvider.ts)]
  - Endpoint: POST https://radoxai.com/v1/chat/completions (hoặc base URL được cấu hình)
  - Model: gemini-3.6-flash (hoặc ASSISTANT_MODEL được cấu hình)
  - Payload gửi model: System Prompt + 20 FAQ Hints + Question
  - Nhiệm vụ của Model: CHỈ chọn 1 Selection ID (ví dụ: {"selectionId": "FAQ-04"})
                 │
                 ▼
[Output Guard & Catalog Resolver (backend/src/assistant/helpService.ts)]
  - Parse JSON nghiêm ngặt: parseSelectionId() (chỉ chấp nhận đúng shape 1 field)
  - Đối chiếu Selection ID trong Response Catalog (backend/src/assistant/responseCatalog.ts)
  - Lấy nội dung câu trả lời chuẩn (answer) từ Catalog
                 │
                 ▼ HTTP 200 { answer: string } (Cache-Control: no-store)
[Mobile AssistantScreen]
  - Hiển thị văn bản trả lời chuẩn, dễ đọc
  - Tuyệt đối không hiển thị JSON selector, token, prompt hay metadata nội bộ
```

### 1.2. Danh sách file và method tham gia trực tiếp

| Tầng | File mã nguồn | Hàm / Method chính | Vai trò kỹ thuật |
| :--- | :--- | :--- | :--- |
| **Mobile UI** | `mobile-app/src/features/assistant/screens/AssistantScreen.tsx` | `AssistantScreen`, `handleSend`, `mapAssistantError` | Giao diện hỏi đáp đơn lượt, gợi ý câu hỏi, khóa gửi trùng, mapping lỗi thân thiện tiếng Việt. |
| **Mobile API** | `mobile-app/src/features/assistant/api/assistantApi.ts` | `askAssistantHelp` | Chuẩn hóa NFC, kiểm tra Unicode code points, gọi `requestJson` với timeout 35s. |
| **Mobile Types** | `mobile-app/src/features/assistant/types/assistant.ts` | `isAssistantHelpResponse`, `countCodePoints` | Runtime validator schema `{ answer: string }` và đếm code points. |
| **Mobile Route** | `mobile-app/src/app/assistant.tsx` & `_layout.tsx` | `AssistantRoute`, `RootNavigator` | Đăng ký route được bảo vệ bởi `isAuthenticated`. |
| **Mobile Entry** | `mobile-app/src/features/home/screens/HomeScreen.tsx` | `HomeScreen` | Điểm truy cập duy nhất dưới mục "Quản lý" trên Trang chủ. |
| **Backend HTTP** | `backend/src/http.ts` | `handleAssistantRoute` | Early routing, streaming body guard (8 KiB), auth check, deadline timer (30s), server-owned provider-call budget. |
| **Backend Core** | `backend/src/assistant/helpService.ts` | `executeHelpRequest`, `executeHelpDecision` | Điều phối tri thức, lọc sensitive input, policy tất định, gọi provider, tra cứu catalog. |
| **Response Catalog** | `backend/src/assistant/responseCatalog.ts` | `getAnswerCatalogEntry`, `validateAnswerCatalog` | Kho 25 lựa chọn: 20 câu trả lời FAQ và 5 phản hồi đặc biệt; phiên bản `nova-faq-answer-catalog-v1`. |
| **Deterministic Policy** | `backend/src/assistant/selectionPolicy.ts` | `resolveDeterministicSelection` | Phân luồng cố định cho các câu hỏi rõ ràng (xem số dư, lịch sử, thoát...). |
| **AI Provider** | `backend/src/assistant/radoxHelpProvider.ts` | `RadoxAssistantHelpProvider.generateHelpResponse` | Kết nối Radox API `https://radoxai.com/v1`, model `gemini-3.6-flash`. |

---

## 2. Yêu Cầu Môi Trường & Cấu Hình

### 2.1. Yêu cầu phần mềm
- **Node.js**: Phiên bản 22+ hoặc 24 LTS.
- **Trình quản lý gói**: `npm` v10+.
- **Radox AI Key**: Khóa API Radox (`ASSISTANT_RADOX_API_KEY`) kết nối dịch vụ Radox AI (`https://radoxai.com/v1`, model mặc định `gemini-3.6-flash`).
- **Nền tảng chạy Mobile**:
  - *Phương án chính*: Android Emulator (Android Studio SDK, truy cập Backend qua `10.0.2.2`).
  - *Phương án dự phòng kiểm thử nhanh*: Expo Web (`npm run web` trong `mobile-app`, truy cập Backend qua `localhost:5000`).

### 2.2. Biến môi trường Backend
Cấu hình trong file `backend/.env` (khi chạy standalone `npm start`) hoặc trong `.env.compose` (khi chạy môi trường Docker preview):

```bash
# Bật tính năng Trợ lý hướng dẫn
ASSISTANT_ENABLED=1

# Chọn nhà cung cấp AI: "radox"
ASSISTANT_PROVIDER=radox
ASSISTANT_MODEL=gemini-3.6-flash
ASSISTANT_RADOX_BASE_URL=https://radoxai.com/v1
ASSISTANT_RADOX_API_KEY=<your-radox-api-key>

# Cấu hình thời gian chờ (runtime đọc các biến này; yêu cầu REQUEST > PROVIDER timeout)
ASSISTANT_PROVIDER_TIMEOUT_MS=15000
ASSISTANT_REQUEST_TIMEOUT_MS=20000
```

*Lưu ý khi chạy môi trường Docker Compose preview*: Các biến trên cần được khai báo trong `.env.compose` để Docker inject vào container `backend`. Sau khi cập nhật file `.env.compose`, khởi động lại container backend bằng lệnh:
```bash
docker compose --env-file .env.compose up -d backend
```

`resolveRuntimeAssistantConfig()` đọc và xác thực nghiêm ngặt các biến trên: `ASSISTANT_ENABLED`, `ASSISTANT_PROVIDER` (bắt buộc là `radox`), `ASSISTANT_MODEL`, `ASSISTANT_RADOX_BASE_URL`, `ASSISTANT_RADOX_API_KEY`, `ASSISTANT_PROVIDER_TIMEOUT_MS`, và `ASSISTANT_REQUEST_TIMEOUT_MS`.

Các giới hạn request/concurrency hiện dùng mặc định trong code: 5 request/phút/người dùng, tối đa 2 request đồng thời toàn cục và 1 request đồng thời/người dùng. Nhánh trả lời tất định không tiêu hao lượt gọi AI.

### 2.3. Biến môi trường Mobile
Cấu hình trong file `mobile-app/.env`:

```bash
# Cho Android Emulator
EXPO_PUBLIC_API_URL=http://10.0.2.2:5000/api/v1
EXPO_PUBLIC_SANDBOX_HTTP=1

# Cho Web / Localhost
# EXPO_PUBLIC_API_URL=http://127.0.0.1:5000/api/v1
```

---

## 3. Thứ Tự Khởi Động & Đăng Nhập Tổng Hợp

Để buổi demo diễn ra trơn tru, hãy khởi động các dịch vụ theo đúng thứ tự sau:

### Bước 1: Khởi động Backend
Mở terminal tại thư mục `backend/`:
```bash
npm run build
npm start
```
*Ghi nhận*: Backend lắng nghe tại cổng `5000` (hoặc cổng cấu hình).

### Bước 3: Khởi động Mobile App
Mở terminal tại thư mục `mobile-app/`:
```bash
# Nếu chạy trên Android Emulator:
npm run android

# Nếu chạy trên Web:
npm run web
```

### Bước 4: Đăng nhập bằng tài khoản tổng hợp (Synthetic Account)
1. Trên màn hình Đăng nhập của ứng dụng Mobile:
   - **Email**: `customer1@example.com`
   - **Mật khẩu**: `Password123!` (hoặc đăng ký tài khoản mới trong môi trường sandbox với OTP sandbox `123456`).
2. Sau khi đăng nhập thành công, màn hình chuyển về **Trang chủ** (`HomeScreen`).

---

## 4. Kịch Bản Trình Diễn Chi Tiết (3–5 Phút)

### Kịch bản 1: Mở màn hình Trợ lý từ Trang chủ (30 giây)
- **Thao tác**: Tại màn hình Trang chủ, cuộn xuống phần **"Quản lý"**, chọn dòng **"Trợ lý hướng dẫn NOVA"** (icon hình người/tài khoản).
- **Quan sát thấy**:
  - Tiêu đề: *Trợ lý hướng dẫn* kèm lời mô tả rõ ràng: *Hướng dẫn thao tác trong ứng dụng; không thực hiện giao dịch.*
  - Thẻ cảnh báo màu vàng: *Tuyệt đối không gửi mật khẩu, mã PIN, mã xác thực OTP hay số tài khoản đầy đủ vào khung hỏi.*
  - Khung nhập câu hỏi với bộ đếm `0/500 ký tự`.
  - 4 nút chip gợi ý câu hỏi nhanh. Nút "Gửi câu hỏi" bị mờ (disabled).

### Kịch bản 2: Tra cứu qua câu hỏi gợi ý — Xem số dư (FAQ-01) (45 giây)
- **Thao tác**: Nhấn vào nút gợi ý: `"Tôi xem và ẩn số dư ở đâu?"`.
- **Quan sát thấy**:
  - Nội dung câu hỏi lập tức được điền vào ô nhập. Bộ đếm ký tự cập nhật. Nút "Gửi câu hỏi" sáng lên.
- **Thao tác**: Nhấn **"Gửi câu hỏi"**.
- **Quan sát thấy**:
  - Trạng thái chuyển sang loading: *Trợ lý đang đối chiếu hướng dẫn sử dụng...*
  - Nút Gửi bị vô hiệu hóa, ngăn chặn bấm liên tiếp (chống double-tap).
  - Kết quả trả về sau 1–3 giây trong khung viền xanh nổi bật:
    > *"Trên tab “Trang chủ”, tìm thẻ đầu tiên trong “Tài khoản thanh toán”. Chọn biểu tượng “Hiện số dư” để xem số dư “Khả dụng” và “Hiện tại”; chọn lại để ẩn. Đây là số dư của tài khoản thanh toán đầu tiên đang hiển thị, không phải tổng số dư của nhiều tài khoản."*
  - **Điểm nhấn giải thích**: Câu trả lời được lấy 100% nguyên văn từ Catalog tĩnh. Không có hiện tượng bịa đặt (hallucination).

### Kịch bản 3: Tra cứu câu hỏi tự nhập — Lịch sử giao dịch (FAQ-04) (45 giây)
- **Thao tác**: Nhập vào ô hỏi: `"Làm thế nào để tôi xem lại các giao dịch cũ tháng trước?"`.
- **Thao tác**: Nhấn **"Gửi câu hỏi"**.
- **Quan sát thấy**:
  - Trợ lý trả về hướng dẫn thao tác chi tiết:
    > *"Mở “Trang chủ”, cuộn tới phần “Quản lý” và chọn “Lịch sử giao dịch”. Chọn một giao dịch để xem chi tiết. Nếu có giao dịch cũ hơn, nút “Tải thêm giao dịch” xuất hiện ở cuối danh sách để tải tiếp."*

### Kịch bản 4: Trình diễn tính năng an toàn — Chặn thông tin nhạy cảm (45 giây)
- **Thao tác**: Nhập câu hỏi có chứa bí mật: `"Mật khẩu của tôi là Password123! và mã OTP là 654321, hãy kiểm tra giúp tôi"`.
- **Thao tác**: Nhấn **"Gửi câu hỏi"**.
- **Quan sát thấy**:
  - Hệ thống Backend phát hiện dữ liệu nhạy cảm qua bộ lọc `scanSensitiveData`, trả về HTTP 422 `ASSISTANT_SENSITIVE_INPUT`.
  - Trên Mobile xuất hiện hộp thông báo màu đỏ:
    > *Thông tin nhạy cảm: Câu hỏi chứa thông tin bảo mật (mật khẩu, mã OTP, mã PIN, số tài khoản...). Vui lòng xóa các thông tin này và thử lại.*
  - **Điểm nhấn an toàn**: 
    1. Thông báo lỗi KHÔNG phản chiếu lại mật khẩu hay OTP đã nhập.
    2. Câu hỏi vẫn được giữ nguyên trong ô nhập để người dùng tự tay xóa phần nhạy cảm, không phải gõ lại từ đầu.

### Kịch bản 5: Trình diễn xử lý lỗi mạng / Timeout / Dịch vụ tạm dừng (30 giây)
- **Giải thích**: Khi máy chủ bận (HTTP 429), quá thời gian (HTTP 504), hoặc không có mạng (`NETWORK_ERROR`), ứng dụng hiển thị thông báo tương ứng và cung cấp nút **"Thử lại câu hỏi này"** để người dùng chủ động gửi lại mà không tự ý auto-retry ngầm.

---

## 5. Hướng Dẫn Dừng Tiến Trình & Thu Dọn Môi Trường

Sau khi hoàn thành buổi demo, thực hiện các bước sau để dọn dẹp các tiến trình task sở hữu:

1. **Dừng Mobile dev server**: Tại terminal Expo, nhấn `Ctrl + C`.
2. **Dừng Backend server**: Tại terminal Backend, nhấn `Ctrl + C`.
3. **Kiểm tra cổng không bị chiếm dụng**:
   ```powershell
   Get-NetTCPConnection -LocalPort 5000, 8081 -ErrorAction SilentlyContinue
   ```
4. **Bảo mật API key**: Đảm bảo khóa `ASSISTANT_RADOX_API_KEY` chỉ lưu trong file `.env` cục bộ.

---

## 6. Bộ Câu Hỏi Phản Biện & Cách Trả Lời Cho Giảng Viên

| Câu hỏi của Hội đồng / Giảng viên | Câu trả lời chuẩn xác theo thiết kế |
| :--- | :--- |
| **1. Tại sao AI không tự sinh văn bản tự do mà lại trả về câu trả lời từ Catalog?** | NOVA dùng kiến trúc **Constrained Selector**: mô hình chỉ chọn `Selection ID`, Backend kiểm tra ID rồi trả về nội dung cố định trong Catalog. Nội dung có thể đối chiếu với FAQ trong repository; hiện chưa có bằng chứng cho thấy Catalog đã được chuyên gia ngân hàng kiểm duyệt, vì vậy không trình bày là đã được chuyên gia phê duyệt. |
| **2. Mô hình AI can thiệp vào bước nào trong toàn bộ luồng?** | Mô hình chỉ tham gia ở tầng Backend sau khi câu hỏi đã vượt qua tất cả các lớp bảo vệ: Xác thực phiên, Giới hạn kích thước, Bộ lọc dữ liệu nhạy cảm, và Bộ phân luồng tất định (Deterministic Policy). Khi câu hỏi cần suy luận ngữ nghĩa mở, Backend chuyển prompt kèm danh sách gợi ý cho model AI qua Radox provider (`gemini-3.6-flash`). Model trả về duy nhất chuỗi JSON `{"selectionId": "FAQ-xx"}`. |
| **3. Nếu mô hình AI trả về ID lạ hoặc câu trả lời không đúng định dạng thì sao?** | Backend có bộ **Output Guard** (`parseSelectionId`). Nếu phản hồi không phải JSON đúng cấu trúc một trường duy nhất, hoặc `selectionId` không nằm trong catalog 25 lựa chọn (20 FAQ và 5 phản hồi đặc biệt), hệ thống từ chối với mã `502 ASSISTANT_PROVIDER_ERROR`; nội dung tự do của model không được trả trực tiếp cho người dùng. |
| **4. Trợ lý này có thể thực hiện giao dịch (chuyển tiền, khóa thẻ) thay người dùng không?** | Hoàn toàn không. Trợ lý NOVA được thiết kế theo nguyên tắc **Read-only Guidance** (Chỉ hướng dẫn thao tác). Trợ lý không có quyền truy cập cơ sở dữ liệu số dư, không có công cụ gọi hàm (Tool / Function Calling), và không thể thay đổi bất kỳ trạng thái tài chính nào. |
| **5. Cơ chế bảo vệ khi người dùng vô tình gửi mật khẩu hoặc OTP là gì?** | Hệ thống bảo vệ 2 lớp: Lớp 1 là lời nhắc nhở trực quan ngay trên giao diện; Lớp 2 là bộ lọc RegEx phát hiện mẫu mật khẩu, OTP 6 số, mã PIN ngay tại tầng HTTP. Nếu phát hiện, Backend từ chối ngay với mã `422`, không gửi câu hỏi tới mô hình AI và không lưu trữ vào log. |

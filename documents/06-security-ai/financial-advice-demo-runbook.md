# Sổ Tay Vận Hành & Kịch Bản Demo: Tư Vấn Tài Chính Cá Nhân AI (Financial Advice Demo Runbook)

> **Trạng thái cập nhật 2026-10-04:** NFA-05 reports xác nhận 16/16 schema/semantic/metrics/candidate/public passes, 15/16 strict preferred match; B-01 là runtime-valid nhưng lệch preferred oracle. Ngưỡng 15/16 so với 95% còn chờ Owner, live gate vẫn BLOCKED. NFA-04: W01–W03 đã có Web observation trong hồ sơ trước; W03b không phải B-05 exact oracle; W04 client validation đã thấy nhưng thiếu browser network trace. Isolated launcher đã được restart để nạp cap: startup xác nhận tối đa 2 provider charges cho phiên Web này, hiện 0 đã charge. Live S-01/B-01 chưa chạy; không gọi help/warm-up và không tự reset quota. Tab vẫn ở `/login`; Owner cần tự đăng nhập bằng tài khoản synthetic local rồi mở Financial Advice. Sau restart, phiên tài khoản in-memory trước đó không còn hiệu lực. Không tắt/dừng Ollama hoặc service demo ngoài listener task-owned.

> **Offline W05–W08 checks (2026-10-04):** Backend fake HTTP/service/isolated tests 41/41 PASS; Mobile screen/API/AuthProvider-protected-route tests 22/22 PASS. Đây là regression/integration evidence, không phải manual Web E2E. W06 stopped-backend recovery trên browser chưa chạy; W05 form-edit-while-pending chưa được xác nhận độc lập. S-01/B-01 vẫn chưa submit và không có Qwen charge.

Tài liệu hướng dẫn thực hành demo trực tiếp và giải trình kỹ thuật trước hội đồng bảo vệ đồ án tốt nghiệp cho Module **AI Tư Vấn Tài Chính Cá Nhân** (UC-FA01 & UC-FA02).

---

## 1. Yêu Cầu Tiên Quyết Trước Khi Demo (Prerequisites)

1. **Backend fixture riêng:** chạy isolated launcher bên dưới, không dùng `npm start`, `npm run dev`, `server.ts`, `.env`, PostgreSQL, Docker hoặc listener preview `5000`.
2. **Live model (chỉ khi có task/giới hạn đã duyệt):** Ollama local phải đang hoạt động và `qwen3.5:4b` phải có sẵn; không pull model. Offline demo không cần Ollama.
3. **Expo Web:** chạy trên origin `http://127.0.0.1:8082` và trỏ API process-scoped đến `http://127.0.0.1:5010/api/v1`. Đây là Web, không phải Android/device E2E.
4. **Tài khoản synthetic:** isolated launcher đăng ký một user tổng hợp trong bộ nhớ khi khởi động. Chỉ dùng cho demo local; không dùng tài khoản ngân hàng thật và không ghi thông tin đăng nhập/token vào evidence.

> **Preflight 2026-10-03:** Backend mặc định (`server.ts`) đọc `.env` và chọn persistent runtime; không dùng cho demo này. Isolated launcher mới dùng `InMemoryCoreBanking`, chỉ bind `127.0.0.1`, bật Financial Advice qua options riêng và không nạp `.env`. Nó chỉ chấp nhận môi trường không có database/persistence/secret overrides và từ chối `NODE_OPTIONS`; không cần Owner cấp database. Cấu hình Mobile mặc định hướng Android emulator nên Web phải nhận API URL bằng environment của chính tiến trình Expo. Ở checkpoint NFA-01–03 ban đầu, Web/HTTP chưa chạy.

> **Phiên Web cô lập ban đầu 2026-10-03 (lịch sử):** Task mở Backend trên `127.0.0.1:5010` và Expo Web trên `localhost:8082`; GET `/healthz` trả 200, `storage=in-memory`. Console từng ghi cảnh báo React/SVG tại `AppIcon.tsx:95` và deprecation warnings; chưa phân loại là blocker. Backend sau đó được restart sang live provider, làm mất session in-memory; không dùng preview port 5000.

### Khởi chạy local cô lập (PowerShell)

Mở terminal riêng có các biến database/persistence/Banking secret không được kế thừa. Không đọc hoặc sửa `.env`.

Backend offline (Financial Advice bật, Assistant/provider tắt), từ `backend/`:

```powershell
node --import=tsx scripts/demo-financial-advice-isolated.ts --offline --web-origin=http://localhost:8082
```

Kỳ vọng startup chỉ báo metadata an toàn: loopback host, cổng `5010`, origin Web, `storage=in-memory` và Assistant disabled. Nếu cổng/origin đã có chủ, không dừng process đó; chọn cặp port/origin loopback còn trống bằng `--port` và `--web-origin`.

Trong PowerShell terminal khác, từ `mobile-app/`:

```powershell
$env:EXPO_PUBLIC_API_URL = "http://127.0.0.1:5010/api/v1"
$env:EXPO_PUBLIC_SANDBOX_HTTP = "1"
npm run web -- --host localhost --port 8082
```

Mở đúng origin `http://localhost:8082` để khớp CORS của launcher. Backend vẫn bind `127.0.0.1`; Web gọi API qua loopback. Xóa hai biến khỏi chính terminal demo sau khi dừng Expo; không ghi chúng vào `.env`. Dùng luồng đăng nhập UI bình thường với user synthetic do launcher tạo. HTTP chạy thật qua loopback nhưng storage vẫn chỉ là RAM: đây không phải PostgreSQL, persistence, Android/device, staging hay deployment evidence.

Để chạy Assistant/Qwen live, chỉ sau khi được cấp quota riêng, khởi động chính isolated launcher ở mode `--live` trong một process mới với `ASSISTANT_ENABLED=1`, `ASSISTANT_PROVIDER=ollama`, `ASSISTANT_MODEL=qwen3.5:4b` và `ASSISTANT_OLLAMA_BASE_URL=http://127.0.0.1:11434`. Runtime mặc định dùng `ASSISTANT_PROVIDER_TIMEOUT_MS=25000` và `ASSISTANT_REQUEST_TIMEOUT_MS=30000`; chỉ các biến timeout này được runtime đọc. Launcher không cho phép database URL hoặc Banking secret environment. Không khởi động lại process để cấp lại quota.

Dừng bằng Ctrl+C chỉ terminal/process do chính phiên demo khởi chạy; không dùng kill theo cổng và không dừng dịch vụ của Owner.

---

## 2. Kịch Bản Trình Diễn Chi Tiết (6–8 Phút)

### Phút 1: Giới thiệu mục tiêu và tính an toàn của kiến trúc
- **Trình bày:** "Module này hướng tới giáo dục tài chính cá nhân, hỗ trợ người dùng lập kế hoạch tiết kiệm và cân đối dòng tiền từ dữ liệu do chính họ khai báo cho một tháng đại diện (*USER_ENTERED*). Trong phạm vi feature này, request không dùng để tạo giao dịch hay cập nhật số dư; các kiểm tra hiện có không phải chứng nhận an toàn toàn hệ thống."

### Phút 2–3: Ca 1 — Tiết kiệm thiếu hụt (UC-FA01: GAP, Case S-01)
1. **Thao tác Form:**
   - Tab: **Kế hoạch tiết kiệm**.
   - Thu nhập hàng tháng: `10.000.000 ₫`.
   - Chi tiêu thiết yếu: `6.000.000 ₫`.
   - Chi tiêu linh hoạt: `2.000.000 ₫`.
   - Khoản trả nợ: `500.000 ₫`.
   - Khoản dự phòng: `0 ₫`.
   - Số tiền mục tiêu: `12.000.000 ₫`, Đã có sẵn: `2.000.000 ₫`, Thời hạn: `5` tháng.
   - Ưu tiên: **Xem các lựa chọn (BALANCED)**.
   - Tích chọn xác nhận không tính trùng nợ.
   - Bấm **"Phân tích kế hoạch"**.
2. **Kết quả trên màn hình:**
   - Huy hiệu hiển thị theo response thực tế (`AI_ASSISTED` hoặc `RULE_BASED`); không giả định sẽ luôn là AI.
   - Số liệu: Cần dành mỗi tháng `2.000.000 ₫`, Khả năng hiện tại `+1.500.000 ₫`, Khoảng thiếu `500.000 ₫/tháng`.
   - Cảnh báo: `Chưa có quỹ dự phòng` hiển thị ngay trên cùng.
   - Đề xuất 3 phương án:
     - *Kéo dài thời gian:* Tích lũy 7 tháng thay vì 5 tháng.
     - *Giảm chi tiêu linh hoạt:* Cắt giảm 500.000 ₫/tháng từ chi linh hoạt.
     - *Hạ số tiền mục tiêu:* Đạt 9.500.000 ₫ sau 5 tháng.

### Phút 4: Ca 2 — Kế hoạch tiết kiệm khả thi (UC-FA01: FEASIBLE, Case S-02)
1. **Thao tác:** Bấm **"Chỉnh sửa số liệu"**, sửa thu nhập thành `11.000.000 ₫`. Bấm **"Phân tích kế hoạch"**.
2. **Kết quả:**
   - Trạng thái: **Khả thi**. Khả năng tích lũy đạt `+2.500.000 ₫/tháng` (> cần `2.000.000 ₫`).
   - Phương án duy nhất: **Duy trì kế hoạch hiện tại (MAINTAIN_PLAN)**, còn dư `500.000 ₫/tháng` sau khi dành cho mục tiêu.

### Phút 5: Ca 3 — Cân đối ngân sách cá nhân (UC-FA02: SURPLUS nhưng GAP, Case B-01)
1. **Thao tác:**
   - Chuyển tab: **Cân đối ngân sách**.
   - Thu nhập: `10.000.000 ₫`, Thiết yếu: `6.000.000 ₫`, Linh hoạt: `2.000.000 ₫`, Nợ: `500.000 ₫`, Dự phòng: `500.000 ₫`.
   - Mức tiết kiệm mong muốn: `2.000.000 ₫/tháng`.
   - Ưu tiên: **Ưu tiên mục tiêu (KEEP_TARGET)**.
   - Bấm **"Phân tích kế hoạch"**.
2. **Kết quả:**
   - Ngân sách cơ bản thặng dư (+1.500.000 ₫), nhưng sau khi giữ 500.000 ₫ dự phòng thì khả năng chỉ còn `+1.000.000 ₫`.
   - Thiếu `1.000.000 ₫` so với mục tiêu `2.000.000 ₫`.
   - Candidate giảm chi linh hoạt được calculator tạo nếu khả thi. Selector AI có thể chọn phương án hợp lệ khác; ghi nhận kết quả thực tế, không ép một lựa chọn vào kịch bản demo.

### Phút 6: Ca 4 — Minh họa nhánh RULE_BASED
1. **Thao tác:** Dùng fixture/unit seam offline hoặc một Backend fixture instance cô lập đã cấu hình provider disabled. Không dừng Ollama/backend dùng chung của Owner và không tiêu quota live chỉ để ép fallback.
2. **Kết quả:**
   - Màn hình vẫn hiển thị đầy đủ số liệu phân tích và các phương án.
   - Huy hiệu đổi thành: **"Kết quả tính toán và giải thích theo quy tắc"** (`RULE_BASED`).
   - Có dòng thông báo minh bạch: *"Phần AI hiện chưa khả dụng; bạn vẫn có thể xem kết quả tính toán."*
   - Quan sát nhãn `RULE_BASED` và metrics/candidates giữ theo contract. Đây là bằng chứng fixture nếu dùng stub/disabled; không gọi là lỗi live Ollama đã được mô phỏng.

## Cấu hình giới hạn hiện có

- Isolated launcher đặt `financialAdviceConfig.enabled=true` trực tiếp; không cần `FINANCIAL_ADVICE_ENABLED`. Standard persistent server có cờ riêng nhưng không dùng trong runbook này.
- Với isolated launcher, `ASSISTANT_ENABLED=1` cùng `ASSISTANT_PROVIDER=ollama`, `ASSISTANT_MODEL` và `ASSISTANT_OLLAMA_BASE_URL` bật local provider; offline mode từ chối cấu hình Assistant kế thừa đang bật.
- Mặc định trong `backend/src/assistant/helpConfig.ts`: 5 request/phút/người dùng, tối đa 2 request đồng thời toàn cục, 1/người dùng, request timeout 12 giây và provider timeout 10 giây. Bộ đếm provider là 10 calls/server run trong `AssistantRateLimiter`.
- Các giá trị rate/concurrency/timeout là cấu hình code/fixture, không có biến môi trường tương ứng được runtime đọc. Không thêm biến env vào runbook để “đổi” chúng. Khi chạy demo, quota là theo process/server run; restart không cấp thêm ngân sách Owner đã duyệt cho phiên demo.
- Backend runtime timeouts dùng `ASSISTANT_PROVIDER_TIMEOUT_MS` (mặc định 25 giây) và `ASSISTANT_REQUEST_TIMEOUT_MS` (mặc định 30 giây); fixture defaults trong `helpConfig.ts` là 10/12 giây. Không có biến runtime để thay rate-limit/concurrency: tài liệu không được đưa các biến không được đọc vào làm hướng dẫn cấu hình. `AssistantRateLimiter` có giới hạn provider 10 calls/process run; ngân sách Owner cho cả phiên vẫn áp dụng kể cả khi process restart.
- `EXPO_PUBLIC_SANDBOX_HTTP=1` chỉ dành cho sandbox local. URL API minh họa là `http://127.0.0.1:5010/api/v1`; không dùng cho staging/production.

---

## 3. Bộ 10 Câu Hỏi Phản Biện Cho Sinh Viên Khi Bảo Vệ Đồ Án

### Câu 1: Tại sao đồ án lại chọn 2 use case này thay vì chatbot trò chuyện tài chính tự do?
> **Trả lời:** "Đồ án giới hạn phạm vi vào UC-FA01 (kế hoạch tiết kiệm theo mục tiêu thời hạn) và UC-FA02 (cân đối dòng tiền thu chi), nơi công thức và phương án có thể mô hình hóa rõ hơn. Bộ golden tests kiểm tra các ca đã định nghĩa; nó không chứng minh mọi tình huống thực tế."

### Câu 2: Quản lý tài chính và Tư vấn tài chính khác nhau ở điểm nào?
> **Trả lời:** "Quản lý tài chính chỉ mang tính thụ động — thống kê lịch sử tiền vào/tiền ra. Còn tư vấn tài chính là phân tích chủ động — xem xét với cơ cấu chi phí hiện tại, liệu mục tiêu tương lai của người dùng có khả thi hay không, và nếu thiếu hụt thì có những đánh đổi (trade-offs) nào (kéo dài thời gian, cắt giảm chi linh hoạt hay hạ mục tiêu) để người dùng tự quyết định."

### Câu 3: AI làm gì và Backend Code làm gì trong module này?
> **Trả lời:** "Hệ thống áp dụng mô hình **Constrained Selector Pattern**:
> - **Code Backend:** Thực hiện phép tính tài chính bằng `BigInt` trong luồng thiết kế này, lọc ra danh sách các phương án hợp lệ (`candidates`) và danh mục lý do hợp lệ (`allowedReasonIds`). Các test đã chạy chỉ cung cấp bằng chứng cho những ca cụ thể, không phải bảo đảm tuyệt đối cho mọi input.
> - **AI (Qwen 3.5 4B):** Chỉ đóng vai trò người lựa chọn (`selector`), chọn ra đúng 1 `preferredOptionId` và 1–3 `reasonIds` phù hợp nhất với ưu tiên người dùng.
> - **Backend Renderer:** Đọc ID do AI chọn và render ra đoạn văn tiếng Việt từ catalog/template cố định. Phiên này chưa có bằng chứng chuyên gia ngân hàng đã kiểm duyệt catalog; validator/tests chỉ chứng minh các ràng buộc đã kiểm tra."

### Câu 4: Vì sao không để AI tính số tiền?
> **Trả lời:** "Trong thiết kế này, Backend dùng `BigInt` cho phép tính; AI chỉ chọn ID. Golden tests cho bằng chứng trên các trường hợp đã liệt kê, không phải khẳng định toán học rằng mọi lỗi code đều bị loại trừ."

### Câu 5: Vì sao không tự động lấy lịch sử giao dịch chuyển tiền để tính thu chi?
> **Trả lời:** "Một giao dịch chuyển tiền không tự cho biết đó là thu nhập hay chi phí; chuyển nội bộ và hoàn trả cũng có thể làm phân loại sai. Vì vậy feature hiện dùng số liệu một tháng do người dùng tự nhập (`USER_ENTERED`), không tự diễn giải lịch sử giao dịch."

### Câu 6: Vì sao module không tạo thêm bảng dữ liệu mới trong Database?
> **Trả lời:** "Use case hiện tính toán theo request và không có migration/persistence riêng cho dữ liệu tư vấn. Đây là lựa chọn phạm vi của bản academic; không tuyên bố đã được thẩm định pháp lý hoặc tuân thủ một bộ quy định cụ thể."

### Câu 7: Khi AI gặp sự cố hoặc timeout thì hệ thống xử lý thế nào?
> **Trả lời:** "Service chuyển sang `RULE_BASED` khi provider unavailable, timeout, quota hết hoặc selector invalid. Cấu hình mặc định trong code là provider timeout 10 giây và request timeout 12 giây; các ngưỡng này không phải cam kết latency cho mọi môi trường. Offline tests kiểm tra fallback qua fake provider; phiên này chưa đo live provider."

### Câu 8: Tại sao dùng AbortController rồi mà vẫn phải có cơ chế `sessionEpoch` và `requestGeneration` trên Mobile?
> **Trả lời:** "Abort là yêu cầu hủy, không bảo đảm mọi Promise dừng ngay. `sessionEpoch` và `requestGeneration` là các guard trong UI để bỏ kết quả/lỗi không còn thuộc request/phiên đang hoạt động; tests kiểm tra các tình huống cụ thể, không chứng minh mọi race trên mọi thiết bị."

### Câu 9: Vì sao output của AI có JSON hợp lệ rồi mà vẫn chưa đủ?
> **Trả lời:** "JSON hợp lệ chỉ là tính đúng đắn về mặt **cú pháp (syntactic validity)**. Một output có thể là JSON chuẩn `{ "preferredOptionId": "EXTEND_DEADLINE" }` nhưng lại hoàn toàn sai về mặt **ngữ nghĩa (semantic validity)** nếu tình huống đó người dùng đã đủ tiền (`ALREADY_FUNDED`) hoặc thời gian tính ra vượt quá giới hạn 120 tháng. Backend validator của chúng em kiểm tra nghiêm ngặt tính hội tụ logic nghiệp vụ trước khi chấp nhận output của AI."

### Câu 10: Ý nghĩa học thuật và giới hạn của giải pháp là gì?
> **Trả lời:** "Đồ án trình bày một kiến trúc hybrid: deterministic calculator, catalog/options hữu hạn, selector có whitelist và rules fallback. Nó cho thấy cách tách phép tính khỏi lựa chọn ngôn ngữ trong các ca đã thử; offline suite không đo chất lượng Qwen. Cần live benchmark, emulator và review nội dung trước khi kết luận về trải nghiệm thực tế."

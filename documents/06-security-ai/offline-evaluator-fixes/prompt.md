# Nhiệm vụ: Sửa lock và lưu bằng chứng tăng dần cho evaluator NOVA

## 1. Chế độ, mục tiêu và quyền thực hiện

Triển khai hai sửa đổi kỹ thuật bằng kiểm thử offline:

1. Không cho hai evaluator cùng sở hữu lock; không xóa lock của tiến trình khác.
2. Lưu từng kết quả đã hoàn tất trước khi chuyển sang ca tiếp theo, để gián đoạn không làm mất toàn bộ bằng chứng của lượt chạy.

Đây là yêu cầu thực hiện code, test và tài liệu trong phạm vi bên dưới, không chỉ lập kế hoạch. Đọc AGENTS.md, PROJECT_CONTEXT.md và hướng dẫn trong phạm vi; kiểm tra HEAD, git status/diff. Dùng CodeGraph trước khi đọc/tìm code nếu repository có .codegraph. Đối chiếu source hiện tại trước khi kết luận.

Không gọi Qwen/Ollama thật, kể cả preflight /api/tags, smoke test hoặc warm-up. Không gọi cloud/API trả phí, tải model, chạy Docker/database/migration/worker. Ngân sách model-call của nhiệm vụ này là **0**. Chỉ dùng fake provider và dữ liệu tổng hợp trong thư mục tạm riêng của test.

Không stage/commit/push/deploy/reset/restore/clean. Giữ WIP và file untracked có trước. Không ghi đè prompt.md ở root hoặc JSON/bằng chứng lịch sử.

## 2. Bối cảnh cần xác nhận bằng đọc dữ liệu

- Phiên thử nghiệm gần nhất: baseline DEV 4/8; candidate DEV 8/8; HOLDOUT 8/8; benchmark 55/56.
- Phiên đó dùng 74 model calls; tracker POS-23 cộng dồn 98/104, còn 6.
- Candidate sửa được POS-23 trong lần đo nhưng sai POS-24. Runtime đã hoàn nguyên; trạng thái nội dung vẫn PARTIAL.
- Prompt baseline: 32d40a43d5e67de9f1c126be46d6e8ec88091e0c6d3dcb61e62f67cef95b5418.
- Catalog baseline: 7a5560870f47c2dd7da685869a97391604a100d1063813e5b22ba82c792ab85d.

Các giá trị này là dữ liệu tham chiếu, phải kiểm tra lại. Nếu khác, báo khác biệt; không tự sửa tracker hoặc khôi phục source để ép khớp. Không tiêu thụ 6 lượt còn lại.

## 3. Phạm vi được phép sửa

- backend/src/tests/assistantEvaluation/pos23BudgetTracker.ts.
- backend/src/tests/assistantEvaluation/intentRunner.ts.
- backend/scripts/evaluate-assistant-intent.ts.
- intentDisambiguation.test.ts và test mới trực tiếp cho hai sửa đổi.
- Module nhỏ cùng thư mục evaluator nếu cần tách phần ghi bằng chứng.
- Báo cáo mới documents/06-security-ai/assistant-evaluator-offline-hardening.md và liên kết/tóm tắt trong assistant-offline-handoff.md.

Không sửa runtime selector prompt/hints/policy, 25 answer, FAQ, dataset/expected/rubric, public API, authentication, Banking Core, Mobile, Admin, database, CI hoặc giới hạn bảo mật. Không thêm dependency. Không refactor rộng. Không chỉnh tracker thật trong kiểm thử.

## 4. Sửa ownership và vòng đời lock

Đọc acquireEvaluatorLock và mọi call site trước khi sửa. Lỗi hiện tại cần xử lý: lock quá 15 phút có thể bị tự xóa dù owner còn sống; release có thể xóa lock không còn thuộc chính nó.

Chọn cơ chế đơn giản, fail-closed:

- Tạo lock độc quyền bằng thao tác filesystem có tính độc quyền, không dùng exists-check rồi ghi đè.
- Ghi owner token ngẫu nhiên duy nhất, PID, thời gian tạo và version. PID/thời gian chỉ là metadata, không thay thế token ownership.
- **Không tự chiếm lại hoặc xóa lock chỉ vì đã cũ.** Trong phạm vi này, lock tồn tại, hỏng hoặc không xác minh được đều chặn lượt mới.
- Chưa cần tự động phục hồi stale lock. Báo rõ cần người vận hành xác minh tiến trình đã dừng trước khi xử lý thủ công. Không xóa lock thật trong task này.
- release chỉ xóa lock có token của chính handle đã acquire; token khác/mất file thì không xóa. release lặp lại phải an toàn. Lỗi đọc/parse không được trở thành quyền xóa.
- Mọi CLI evaluator dùng tracker chung phải acquire trước khi đọc/sửa tracker, giữ lock đến khi chốt bằng chứng và giải phóng trong finally.
- Nếu không lấy được lock, không gọi provider và không thay đổi tracker/report của lượt khác.
- Khi lỗi sau acquire, không để tài nguyên hoặc lock thuộc phiên bình thường bị bỏ quên. Phân biệt crash cứng khiến lock còn lại với lỗi có thể chạy finally.

Giải thích giả định: các evaluator tuân thủ cùng giao thức lock; không tuyên bố chống mọi can thiệp filesystem bên ngoài. Không dùng so khớp token như bằng chứng về một thao tác compare-and-delete nguyên tử nếu filesystem không cung cấp điều đó.

## 5. Lưu kết quả tăng dần

Đọc runIntentTrials, buildIntentSummary, writeIntentReport và CLI. Thiết kế một journal riêng cho mỗi run, ví dụ JSONL, với runId mới và tạo độc quyền; không append vào báo cáo lịch sử.

Trình tự bắt buộc:

1. Acquire lock, kiểm tra tracker và điều kiện local của CLI khi vận hành thật. Test không gọi mạng.
2. Tạo runId, chụp metadata trước khi chạy, tạo journal độc quyền và ghi metadata.
3. Với mỗi ca cần model: lưu ngân sách trước provider như cơ chế hiện có; không hoàn lại lượt có kết quả không xác định.
4. Khi một hàng đã có kết quả thành công hoặc lỗi provider đã khử nhạy cảm, ghi và flush hàng đó trước khi bắt đầu ca tiếp theo. Mỗi hàng có caseId, repetition và số thứ tự ổn định; không ghi trùng.
5. Khi toàn bộ hàng hoàn tất, tạo báo cáo JSON/Markdown hiện hữu từ những hàng đã lưu, giữ contract kết quả hiện tại. Chỉ đánh dấu COMPLETE sau khi các đầu ra cần thiết đã được ghi thành công.
6. Release lock trong finally.

Metadata tối thiểu: runId, suite, dataset version/hash, prompt/catalog hash, model/config, HEAD/WIP. Chỉ lưu câu hỏi/answer tổng hợp được phép; không log credential, token, OTP hoặc raw lỗi provider. Không đưa dữ liệu người dùng thật vào journal.

Yêu cầu khi lỗi/gián đoạn:

- Không ghi được metadata/journal ban đầu: không gọi provider.
- Không ghi/flush được hàng: dừng toàn run, không gọi ca tiếp theo; lỗi persistence không được catch rồi ngụy trang thành lỗi model và tiếp tục.
- Các hàng trước đó vẫn đọc được. Không xóa journal để làm sạch lỗi.
- Nếu tiến trình bị dừng khi provider đang chạy: có thể có ngân sách đã giữ nhưng chưa có hàng kết quả. Ghi nhận INCOMPLETE/UNKNOWN, không tự sinh answer, không tự retry hoặc hoàn lượt.
- Reader offline nhận diện journal chưa COMPLETE; nếu dòng cuối bị cắt, bảo toàn các dòng hoàn chỉnh trước nó và báo rõ phần thiếu. Hỏng ở giữa không được âm thầm bỏ qua như dữ liệu hợp lệ.
- Không coi các ca chưa chạy là PASS. Giữ riêng planned/completed/missing khi báo partial.
- Không cần làm resume chạy model tự động. Chỉ cần khả năng đọc/đối soát bằng chứng offline của lượt bị ngắt.
- Nêu rõ phạm vi flush/fsync thực hiện; không tuyên bố chống mất điện hoặc hỏng ổ đĩa chỉ vì dùng writeFileSync.

Giữ tính tương thích với caller hiện có, có thể thêm callback ghi mỗi trial. Lỗi callback ghi đĩa phải truyền ra ngoài vòng lặp; không trộn với lỗi provider. Tránh tạo phụ thuộc ngược từ src sang scripts gây TS6059.

## 6. Kiểm thử bắt buộc — hoàn toàn offline

Dùng thư mục tạm và tracker/lock/journal giả, không dùng đường dẫn thật mặc định. Dọn đúng tài nguyên test sở hữu; không xóa theo glob rộng.

Lock:

- A acquire thành công; B bị từ chối, kể cả lock A có thời gian hơn 15 phút nhưng A còn giữ lock.
- Lock hỏng/không xác minh được chặn, không bị xóa.
- Release A không xóa lock có token B (mô phỏng thay đổi ownership trong fixture).
- Release đúng owner thành công, release lặp an toàn, sau đó owner mới acquire được.
- Kiểm tra tranh chấp thực giữa hai tiến trình local hoặc cơ chế tương đương chứng minh acquire độc quyền; không chỉ dựa vào hai lời gọi tuần tự.

Journal và runner:

- Ở thời điểm fake provider bắt đầu ca N+1, hàng N đã đọc được từ journal.
- Provider ném lỗi: ngân sách đã được lưu, hàng lỗi được ghi đúng một lần và không chứa raw chi tiết nhạy cảm.
- Ghi journal ban đầu thất bại: fake provider callCount = 0.
- Ghi hàng sau một lượt thất bại: dừng trước lượt tiếp; ngân sách lượt đã gọi vẫn được giữ.
- Tiến trình con dùng fake provider bị dừng sau checkpoint đã xác nhận: tiến trình cha vẫn đọc được các hàng hoàn tất. Dùng signal/IPC/barrier thay vì sleep tùy ý để tránh test chập chờn. Không kill tiến trình không do test tạo.
- Journal có dòng cuối bị cắt: đọc được hàng hoàn chỉnh trước, verdict INCOMPLETE; không tạo đáp án mặc định.
- Báo cáo hoàn tất đối chiếu khớp journal về ID, repetition, kết quả và tổng số hàng.
- Trùng runId/đường dẫn bằng chứng: chặn ghi đè.

Giữ và chạy các test tracker cũ: schema, tổng calls, duplicate runId, missing tracker có lịch sử, pre-call persistence, giới hạn ngân sách và mẫu số model khi lỗi. Nếu đổi hành vi stale-lock, sửa test cũ đang đòi tự chiếm lại lock cho khớp yêu cầu mới; giải thích rõ.

## 7. Kiểm chứng và điều kiện hoàn thành

Trước/sau: lưu hash tracker thật, JSON lịch sử liên quan, runtime catalog/prompt và 25 answer; chứng minh không đổi. Không ghi raw dữ liệu nhạy cảm ra log.

Chạy theo thứ tự phù hợp:

- npm run typecheck trong backend.
- npm run build trong backend.
- Test intent và các test mới trực tiếp cho lock/journal.
- npm run test:assistant.
- Secret scan đúng cú pháp hiện có, bao phủ file mới/sửa kể cả untracked.
- Kiểm tra whitespace/conflict markers trong phạm vi; git diff --check không bao phủ untracked nên cần kiểm tra riêng.

Không chạy suite gọi Ollama hoặc eval thực. Không dùng tổng số test kỳ vọng cũ thay số thực chạy. Khi các kiểm tra liên quan đã đạt, không mở rộng thêm hạ tầng ngoài task.

Hoàn thành khi hai thiếu sót được sửa, test chứng minh, nguồn/build đồng bộ, tracker thật và bằng chứng lịch sử/runtime không đổi. Trạng thái sửa công cụ có thể PASS trong khi trạng thái chất lượng nội dung vẫn PARTIAL; tuyệt đối không nhập hai kết luận này làm một.

## 8. Bàn giao

Viết báo cáo tiếng Việt tại assistant-evaluator-offline-hardening.md:

- Lỗi trước/sau, file sửa và luồng acquire → budget → provider → journal → report → release.
- Giao thức lock, xử lý lock tồn tại và giới hạn bảo đảm.
- Định dạng journal, đọc kết quả chưa hoàn tất và xử lý lỗi đĩa.
- Test/lệnh thực chạy, số pass/fail/skip và bằng chứng mới.
- Hash trước/sau tracker thật, runtime và lịch sử trong phạm vi đối chiếu.
- Xác nhận 0 lượt model thật, không cloud, không database, không hành động Git làm thay đổi lịch sử.
- Nội dung AI vẫn PARTIAL, 98/104 chỉ được ghi nếu đọc tracker xác nhận; không dùng 6 lượt còn lại.
- Cách kiểm tra thủ công offline và các giới hạn còn lại.

Cập nhật liên kết bàn giao tổng thể, giữ nguyên bằng chứng lịch sử. Không tuyên bố POS-23/POS-24 đã được sửa bởi nhiệm vụ này.

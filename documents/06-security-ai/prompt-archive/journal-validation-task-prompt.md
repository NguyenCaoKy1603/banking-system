# Nhiệm vụ: Xác thực journal của evaluator NOVA trước khi kết luận COMPLETE

## 1. Mục tiêu và chế độ

Triển khai sửa bộ đọc journal, kiểm thử hồi quy và cập nhật tài liệu. Không chỉ trả lại kế hoạch.

Lỗi cần xử lý: readIntentJournal có thể trả COMPLETE dù hai hàng trùng caseId/repetition/index và final.totalTrialsRecorded = 999 trong khi chỉ có hai hàng. TypeScript type assertion không thay thế runtime validation cho dữ liệu JSON từ đĩa.

Chỉ sửa công cụ đánh giá offline. Ngân sách gọi model của nhiệm vụ là **0**: không gọi Ollama, /api/tags, smoke test, cloud/API trả phí, tải model, Docker, database, migration hoặc worker. Dùng fake provider, dữ liệu tổng hợp và thư mục tạm riêng.

Trạng thái tham chiếu: nội dung AI vẫn PARTIAL; tracker thật 98/104, còn 6 lượt. Không dùng hoặc tự cấp lại ngân sách đó. Đọc tracker để xác nhận; nếu khác, báo khác biệt, không sửa để ép khớp.

## 2. Quy trình và phạm vi

Đọc AGENTS.md, PROJECT_CONTEXT.md và hướng dẫn trong phạm vi. Kiểm tra HEAD, git status/diff, source và báo cáo liên quan. Dùng CodeGraph trước khi tìm/đọc code nếu có .codegraph.

Được sửa:

- backend/src/tests/assistantEvaluation/intentJournal.ts.
- backend/src/tests/evaluatorHardening.test.ts hoặc file test chuyên biệt mới cùng phạm vi.
- intentRunner.ts và evaluate-assistant-intent.ts chỉ nếu cần tương thích metadata/validator hoặc luồng journal hiện tại; giải thích từng thay đổi.
- documents/06-security-ai/assistant-evaluator-offline-hardening.md và liên kết/tóm tắt tương ứng trong assistant-offline-handoff.md.

Không sửa selector prompt/hints/policy, FAQ, answer catalog, model config, dataset/expected/rubric, API, banking code, Mobile, Admin, DB, CI hoặc tracker thật. Không sửa JSON/journal bằng chứng lịch sử. Không thêm dependency hay refactor ngoài nhiệm vụ. Giữ nguyên lock ownership và cơ chế ghi/fsync từng hàng đã được kiểm chứng, trừ khi phát hiện lỗi trực tiếp cản trở mục tiêu và giải thích được phạm vi sửa.

Không git add/commit/push/reset/restore/clean/deploy. Bảo toàn WIP/untracked của người khác. Không xóa tài nguyên hoặc tiến trình ngoài test do mình tạo.

## 3. Kế hoạch thực hiện

1. Đọc contract metadata/trial/final, writer, reader, runner và caller; xác định định dạng v1 thực tế trước khi thiết kế validation.
2. Viết regression test tái hiện COMPLETE sai bằng metadata và trial hợp lệ, chỉ làm sai từng điều kiện cần kiểm tra; giữ riêng fixture tối giản đã nêu để chứng minh không crash/không COMPLETE.
3. Bổ sung runtime validator và state machine đọc journal, kiểm tra cấu trúc lẫn quan hệ giữa các hàng.
4. Bổ sung ma trận test hợp lệ, gián đoạn, sai schema, trùng/thừa/sai thứ tự, final mâu thuẫn.
5. Chạy typecheck, build, test liên quan và secret scan; đối chiếu hash runtime/tracker thật trước và sau.
6. Bàn giao kết quả mới, tách PASS công cụ khỏi PARTIAL nội dung AI. Không dùng số test cũ làm bằng chứng mới.

## 4. Định nghĩa trạng thái

- COMPLETE: journal hợp lệ về cấu trúc, thứ tự và số lượng; có đúng một final COMPLETE hợp lệ ở cuối; kế hoạch xác định được và số hàng hợp lệ khớp chính xác.
- INCOMPLETE: chưa có final, final INCOMPLETE hợp lệ, hoặc quá trình ghi bị ngắt ở đuôi. Bảo toàn các hàng hợp lệ đã hoàn tất, không tự tạo đáp án hay gán PASS cho hàng thiếu.
- CORRUPTED: dữ liệu có cấu trúc sai hoặc mâu thuẫn, hàng trùng, thứ tự sai, thừa hàng, final sai số lượng, hay JSON hỏng ở giữa. Không tự sửa/bỏ qua rồi tiếp tục coi là hợp lệ.

COMPLETE chỉ nói việc ghi journal đã hoàn tất, không có nghĩa mọi trial thành công hoặc model chọn đúng. Một journal đầy đủ chứa trial technical FAIL hợp lệ vẫn có thể COMPLETE; verdict chất lượng do evaluator quyết định riêng.

## 5. Runtime validation

### Metadata

- Bản ghi metadata phải ở đầu, đúng version được hỗ trợ và chỉ xuất hiện một lần. Array/null không phải object record hợp lệ.
- Kiểm tra các field bắt buộc theo writer v1: runId/suite và các chuỗi định danh, thời gian, HEAD/WIP, hash, model/config. Phân biệt field nullable/optional thực tế, không ép modelDigest thành SHA-256 nếu contract cho phép null.
- Số đếm và index phải là safe integer trong miền hợp lệ; repetitions > 0. Không ép chuỗi thành số hoặc tự điền dữ liệu thiếu.
- plannedTrials/plannedCases nếu có phải hợp lệ. Nếu có cả hai, plannedTrials phải bằng plannedCases × config.repetitions và phép tính không được vượt safe integer.
- Nếu cả hai trường kế hoạch v1 đều thiếu do vốn optional: không tự nhận COMPLETE. Trả INCOMPLETE với issue thiếu kế hoạch; mô tả rõ giới hạn tương thích. Field có mặt nhưng sai kiểu là CORRUPTED.

### Trial

- Kiểm tra envelope: type, index, caseId, repetition, recordedAt, trial object.
- Kiểm tra trial theo IntentTrial thực tế: ID, repetition, suite, các enum trạng thái, modelCalled boolean, actualModelCalls và durationMs hợp lệ, expected/acceptable selection và các trường kết quả phù hợp nhánh success/error.
- Với technical FAIL do provider, không bắt buộc phải có answer hoặc selectedSelectionId; không vô tình loại bỏ hàng lỗi hợp lệ đang được runner tạo.
- envelope.caseId/repetition phải khớp trial.caseId/repetition; trial.suite khớp metadata.suite.
- Index liên tiếp từ 1; không index trùng/nhảy/lùi. Repetition nằm trong khoảng cấu hình.
- Cặp (caseId, repetition) duy nhất trong run. Không coi hai dòng trùng là hai ca đã hoàn tất.
- Khi biết plannedCases, kiểm tra số case phân biệt và số repetition tương ứng lúc chốt COMPLETE. Không để đủ tổng số hàng che giấu case bị thiếu.
- Chỉ đếm và trả về các trial đã xác thực. Nếu journal v1 không lưu danh sách case dự kiến, ghi rõ reader chưa chứng minh được danh tính case khớp dataset chỉ nhờ datasetHash; không bịa khả năng đối chiếu đó. Không cần đổi dataset hay nạp nguồn runtime ngoài phạm vi để giải quyết việc này.

### Final và thứ tự

- Tối đa một final; final phải ở cuối. Trial/metadata/final thứ hai sau final đều CORRUPTED.
- Kiểm tra status, thời gian và totalTrialsRecorded đúng kiểu.
- totalTrialsRecorded bằng chính xác số trial hợp lệ đã ghi, kể cả final INCOMPLETE.
- final COMPLETE chỉ hợp lệ khi completedCount === plannedCount; không dùng >=.
- final COMPLETE thiếu hoặc thừa hàng là mâu thuẫn, trả CORRUPTED. Không final và số hàng còn thiếu là INCOMPLETE.
- Nếu summaryTotals được cung cấp, kiểm tra kiểu và đối chiếu các số tổng có thể tính từ trial theo cùng quy tắc evaluator. Không tin summaryTotals để ghi đè số tính thực tế. Không tạo vòng import runtime giữa journal và runner; tách helper nhỏ hoặc chọn cách tương thích đơn giản nếu cần.

### JSON bị cắt và lỗi đọc

- Phân biệt EOF chưa kết thúc dòng với một dòng hoàn chỉnh có ký tự xuống dòng nhưng JSON/schema sai.
- Dòng cuối chưa kết thúc và JSON không parse được: có thể coi là đuôi bị cắt, trả INCOMPLETE và giữ prefix hợp lệ.
- Dòng cuối parse được nhưng sai schema: CORRUPTED, không gọi là bị cắt để bỏ qua.
- JSON hỏng ở giữa hoặc dòng hoàn chỉnh sai JSON: CORRUPTED.
- Dữ liệu không rỗng xuất hiện sau final, kể cả đuôi bị cắt, không được trở thành COMPLETE.
- Quy định xử lý blank line rõ ràng; trailing newline bình thường không phải record và không gây lỗi.
- issues chỉ chứa vị trí, tên field và loại sai. Không đưa raw line, câu hỏi/answer hoặc nội dung lỗi JSON có thể chứa dữ liệu nhạy cảm vào thông báo. Giữ errorCode và metadata chẩn đoán an toàn.
- missingCount/plannedCount/completedCount phải nhất quán. Nếu chưa biết kế hoạch, không diễn đạt missingCount mặc định là bằng chứng không thiếu ca; thêm issue rõ ràng.

Ưu tiên state machine dễ đọc: EXPECT_METADATA → TRIALS → FINAL. Không dùng casting để bỏ qua dữ liệu chưa được kiểm tra. Có thể chặn duplicate/mismatch ngay trong writer để phòng lỗi mới, nhưng reader vẫn phải tự xác thực file độc lập; không viết lại file nguồn khi đọc.

## 6. Ma trận regression test tối thiểu

Dùng fixture metadata/trial hợp lệ theo contract làm nền; mỗi test thay một điều kiện để chứng minh đúng nhánh lỗi. Không chỉ dùng fixture thiếu metadata khiến tất cả test fail vì cùng một nguyên nhân.

1. Journal hợp lệ, đủ hàng, final đúng → COMPLETE.
2. Journal đầy đủ có một technical FAIL hợp lệ → COMPLETE về lưu trữ; quality vẫn phản ánh lỗi.
3. Hai trial trùng (caseId, repetition), kể cả index khác nhau → CORRUPTED.
4. Index trùng, bắt đầu sai, nhảy hoặc lùi → CORRUPTED.
5. Envelope ID/repetition không khớp trial → CORRUPTED.
6. Null/array/sai enum/sai kiểu/thiếu field bắt buộc → CORRUPTED, reader không crash.
7. Repetition ngoài phạm vi; số âm, số lẻ hoặc không safe integer → CORRUPTED.
8. Metadata lặp, metadata không ở đầu, trial sau final, hai final → CORRUPTED.
9. Hai hàng nhưng totalTrialsRecorded=999 → CORRUPTED.
10. Final COMPLETE thiếu hàng hoặc số hàng vượt kế hoạch → CORRUPTED.
11. Kế hoạch plannedCases × repetitions mâu thuẫn plannedTrials → CORRUPTED.
12. Summary totals mâu thuẫn trial → CORRUPTED.
13. Không final, prefix hợp lệ → INCOMPLETE, giữ đúng completed/missing.
14. Final INCOMPLETE với số lượng hợp lệ → INCOMPLETE.
15. Đuôi bị cắt trước final → INCOMPLETE; JSON hỏng ở giữa và schema sai ở dòng cuối → CORRUPTED.
16. Metadata v1 thiếu cả hai field kế hoạch optional → không COMPLETE, issue rõ ràng.
17. issues không chứa marker nhạy cảm giả cài vào một dòng hỏng.
18. Tái hiện fixture cũ trùng hàng + final 999 → không còn COMPLETE/issues rỗng.

Giữ nguyên các test lock, IPC/gián đoạn, ghi từng hàng trước ca tiếp theo, fsync, provider error, budget và không ghi đè journal. Nếu fixture cũ thiếu schema hợp lệ, cập nhật fixture để phản ánh writer thật; không hạ validation chỉ để giữ test xanh.

Tất cả test dùng temp directory riêng và fake provider; không gọi CLI eval thật. Không sửa tracker 98/104, journal hoặc JSON lịch sử để thử lỗi. Chỉ dọn tài nguyên test sở hữu trong finally/t.after.

## 7. Quality gates và bằng chứng

Chụp hash trước/sau cho tracker thật, responseCatalog.ts, selectionPolicy.ts, knowledgeBundle.ts và các bằng chứng lịch sử được đối chiếu trong phạm vi. Không đưa raw dữ liệu nhạy cảm ra log. Xác nhận 25 answer giữ nguyên bằng test hiện có.

Chạy trong backend:

1. npm run typecheck.
2. npm run build.
3. Test evaluatorHardening, intentDisambiguation và test validator mới nếu tách file.
4. npm run test:assistant.
5. Secret scanner theo cú pháp thực tế, bao phủ các file mới/sửa kể cả untracked.

Kiểm tra diff/whitespace/conflict markers đúng phạm vi; git diff --check không bao phủ untracked. Không mở rộng kiểm thử sang model/DB/CI. Không sửa package hoặc CI chỉ để gộp test mới; có thể chạy suite riêng và báo rõ.

Tiêu chí hoàn thành: dữ liệu hợp lệ đọc đúng; corrupt không bao giờ COMPLETE; gián đoạn giữ prefix hợp lệ; các test bắt đúng từng lỗi; pipeline cũ vẫn hoạt động; tracker/runtime/lịch sử không đổi; model calls mới = 0.

## 8. Bàn giao bằng tiếng Việt

Cập nhật assistant-evaluator-offline-hardening.md với phần hiệu chỉnh reader, giữ lịch sử nhận định và phân biệt bằng chứng cũ/mới:

- Lỗi tái hiện trước sửa và kết quả sau sửa.
- Quy tắc COMPLETE/INCOMPLETE/CORRUPTED và giới hạn định dạng v1.
- File sửa, tác động tới writer/runner/caller nếu có.
- Lệnh kiểm tra, số test thực chạy, pass/fail/skip; không ghi sẵn 30/30 hoặc số mong đợi.
- Hash trước/sau các thành phần cần bảo toàn.
- Xác nhận không model/network/DB/Git mutation ngoài quyền hạn.
- Trạng thái công cụ theo kiểm chứng; nội dung AI vẫn PARTIAL, không tuyên bố POS-23/POS-24 đã được sửa.
- Remaining/risk cụ thể, không tuyên bố kiểm chứng toàn bộ hệ thống từ một suite offline.

Thực hiện đến hết phạm vi được cấp. Nếu vướng mâu thuẫn contract ảnh hưởng bên ngoài nhiệm vụ, ghi rõ bằng chứng và quyết định cần người dùng; không tự mở rộng kiến trúc hoặc sửa dữ liệu lịch sử.

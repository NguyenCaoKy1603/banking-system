# Nhiệm vụ: Chốt công cụ POS-24 OFFLINE — AST, ledger và workspace

## 1. Mục tiêu, chế độ và quyền hạn

IMPLEMENTATION OFFLINE. Sửa ba lỗi audit còn lại, thêm kiểm thử trên code dùng thật và cập nhật bàn giao. Ưu tiên bảo toàn dữ liệu/WIP, tính đúng và khả năng kiểm chứng. Không chỉ lập kế hoạch; không viết lại toàn bộ evaluator hoặc mở rộng thành framework bảo mật.

Ngân sách = 0 model calls. Không gọi Ollama kể cả /api/tags, không cloud/API AI, tải model, dịch vụ trả phí, Docker, DB, migration, worker, Mobile/device. Không tạo ledger thật POS-24; không dùng 6 lượt POS-23 còn lại. 104 lượt Qwen là đề xuất nhiệm vụ sau, chưa được phê duyệt.

Không sửa runtime prompt/hints/catalog answers/selectionPolicy/knowledge. Không chỉnh model hoặc tối ưu POS-24. Chỉ dùng Fake Provider và file tổng hợp trong thư mục test sở hữu. Restore chỉ trên bản sao, không trên runtime thật.

Không git add/commit/push/merge/reset/restore/clean, deploy hoặc ghi đè WIP ngoài phạm vi. Không sửa prompt.md này. Không xóa/sửa snapshot, journal, tracker hoặc kết quả lịch sử để làm PASS.

## 2. Đọc và xác nhận đầu phiên

Đọc AGENTS.md, PROJECT_CONTEXT.md và hướng dẫn theo phạm vi; kiểm tra HEAD, status/diff. Dùng CodeGraph trước tìm/đọc code nếu .codegraph tồn tại. Kiểm tra source và script trước khi chạy lệnh; tài liệu không thay thế bằng chứng.

Các nguồn chính:
- backend/src/tests/assistantEvaluation/snapshotManager.ts
- backend/scripts/snapshot-assistant-runtime.ts
- backend/src/tests/assistantEvaluation/pos24Orchestrator.ts
- backend/scripts/evaluate-assistant-intent.ts
- intentRunner.ts, intentJournal.ts, pos23BudgetTracker.ts trong assistantEvaluation
- fixtures/pos24-reference-catalog.json và fixtures synthetic POS-24
- backend/src/tests/pos24OfflinePreparation.test.ts, evaluatorHardening.test.ts, intentDisambiguation.test.ts
- documents/06-security-ai/assistant-pos24-offline-preparation.md, assistant-pos24-evaluation-plan.md, assistant-offline-handoff.md
- responseCatalog.ts, knowledgeBundle.ts và selectionPolicy.ts: chỉ đọc.

Bằng chứng audit gần nhất: typecheck PASS, 67/67 test offline PASS; vẫn PARTIAL vì:
A. Source thay .join("\n") bằng .join(String.fromCharCode(88)) hoặc đổi createHash thành String vẫn được snapshot validator công nhận valid=true khi cập nhật hash file.
B. Workflow nhận workspace có ledger 98 calls, chạy Fake xong còn 16 calls và mất run cũ. Code luôn ghi ledger rỗng trước chạy; trần hardcode 150; có thao tác sau acquire lock nhưng ngoài try/finally.
C. CLI chỉ cấm vài đường dẫn, chưa bắt mọi output nằm trong workspace; hàm workflow chưa tự xác minh ownership/subpath; các lock tùy chọn có thể không gắn với ledger.

Manifest đầu/cuối cho runtime/catalog/policy/knowledge, tracker POS-23, hai snapshot lịch sử và dataset chuẩn. Đối chiếu tối thiểu:
- responseCatalog.ts SHA256: d0109c9a5a5a72a8a344ad790329a1efb62701cb00cc41a36966b45c59b86d6a
- Tracker POS-23 SHA256: f625a32b2a53fbbd8e4b17b7acd777792d5b89c655bce1522f5fcdea15e89c46; 98/104.
Nếu khác thì điều tra, không ép baseline hoặc xóa WIP. Chỉ dừng phần phụ thuộc nếu không xác định được nguồn tin cậy.

## 3. Phạm vi sửa

Cho phép sửa snapshotManager, snapshot CLI, pos24Orchestrator, evaluator CLI và module helper offline nhỏ; intentRunner/journal/tracker chỉ khi cần tích hợp, giữ tính tương thích và validation hiện có. Được thêm/sửa test và fixture regression riêng, không sửa dữ liệu benchmark/expected hay fixture tham chiếu để chấp nhận lỗi.

Có thể thêm script test trong backend/package.json; không dependency mới. Dùng TypeScript đã cài. Không sửa backend/src/assistant, HTTP/API, DB, Mobile/Admin, CI.

Cập nhật báo cáo offline-preparation, hướng dẫn CLI trong evaluation-plan và liên kết/trạng thái handoff. Có thể thêm artifact bằng chứng mới, không ghi đè lịch sử. Đọc file hiện hữu trước sửa và giữ diff nhỏ.

## 4. Kế hoạch thực hiện

### Bước 1 — Tái hiện và khóa regression

Tạo regression cho ba lỗi trước khi sửa. Chỉ thay source trong bộ nhớ/bản sao, không thực thi source biến đổi. Test ledger/path dùng temp workspace và fixture protected giả, không thử ghi vào file thật. Không lấy số test PASS làm mục tiêu; assertion phải chứng minh hành vi thật.

### Bước 2 — AST parser kiểm tra đúng cấu trúc được hỗ trợ

Chọn phương án đơn giản: parser literal hiện có + kiểm tra cấu trúc AST đối với phần code cố định. Chỉ cho phép vùng dữ liệu đã xác định (nội dung prompt literal, hint) biến thiên; 25 answers vẫn bị reference độc lập ràng buộc. Không xây interpreter TypeScript tổng quát.

Bắt buộc:
- .join phải có đúng đối số literal newline và đúng số đối số; .join("X"), .join(), spread, dynamic call phải bị từ chối nếu ngoài contract hỗ trợ. Không luôn dùng newline bất chấp source.
- Kiểm tra TypeScript parse diagnostics, thiếu/trùng declaration, initializer/property không hỗ trợ. Không fallback version mặc định khi source thiếu/sai declaration bắt buộc.
- Ràng buộc hàm sha256, công thức ANSWER_CATALOG/ANSWER_CATALOG_HASH, cách tạo prompt/context và các import/phần executable cố định với cấu trúc đã tin cậy. Source đổi hàm băm hoặc thêm call/statement ngoài mẫu phải bị từ chối, không bị bỏ qua khi parser chỉ tìm được CATALOG_SEED.
- Nếu dùng structural fingerprint, mô tả chính xác node nào được chuẩn hóa; mẫu/hash tin cậy lấy từ baseline đã xác minh, không regenerate từ source đang kiểm tra để tự công nhận nó. Whitespace/comments không nhất thiết làm sai semantic fingerprint; hash byte source vẫn riêng.
- Không eval, Function, dynamic import hoặc subprocess chạy source snapshot. Snapshot là dữ liệu không tin cậy.
- Hash prompt/catalog phải tính đúng công thức runtime, gắn với source và provenance đã khóa. Byte UTF-8/BOM/newline được bảo toàn; parser không hỗ trợ thì từ chối rõ.
- Errors không phản chiếu raw source/giá trị không tin cậy. Giữ bảo toàn 25 ID/answer/answerHash với reference độc lập.

Test:
1. Hai probe audit mới bị từ chối dù hash file đúng.
2. Probe cũ invalid hash/unrelated source vẫn bị từ chối.
3. Hint/prompt literal thay đổi hợp lệ trên bản sao được xử lý đúng; catalogHash/promptHash thay đổi tương ứng, answers không đổi.
4. Đổi hash formula, thêm top-level call, sai join, thiếu version, cú pháp lỗi, declaration trùng bị chặn. Đối chiếu nguồn baseline hợp lệ để tránh parser từ chối mọi thứ.
5. Kiểm tra parity hash baseline với runtime đã tin cậy; test không tự băm id/topic bằng công thức khác.

### Bước 3 — Workspace sở hữu và containment dùng chung

Tạo helper dùng chung cho suite CLI, workflow CLI và hàm workflow; không chỉ guard ở lớp ngoài rồi cho API trực tiếp bỏ qua. Helper trả layout đã xác minh (root/ledger/lock/journals/reports), tránh mỗi nơi tự ráp path khác nhau.

Phương án ưu tiên: mỗi phiên Fake có workspace mới do mkdtemp tạo, kèm marker/schema nhận diện công cụ và run ownership. Workspace explicit phải mới/rỗng để được khởi tạo, hoặc là workspace sở hữu hợp lệ theo chính sách tiếp tục đã định nghĩa. Không tự chiếm thư mục bất kỳ đang có dữ liệu chỉ vì nằm ngoài denylist.

Bắt buộc mọi output nằm trong workspace đã xác minh. Nếu giữ --budget-file/--lock-file/--journal-dir/--report-dir thì ràng buộc vào layout; không cho path ra ngoài hoặc nhiều lock khác nhau cho cùng ledger. Có thể từ chối override xung đột bằng lỗi rõ. Không âm thầm chuyển output hoặc reset ledger để cho lệnh chạy.

Canonicalize đường dẫn bằng realpath và kiểm tra tất cả ancestor tồn tại; file/parent chưa có phải truy ngược tới ancestor tồn tại, không fallback path.resolve khi canonicalization lỗi. Xử lý Windows case, drive khác, .., sibling có chung prefix, symlink/junction và thư mục con journals/reports đã là link. Nếu không chứng minh được containment thì fail-closed trước mkdir/write/acquire lock.

Giữ denylist protected như lớp bổ sung, không dùng thay ownership/containment. Runtime, documents evidence, tracker thật và reference catalog luôn ngoài vùng ghi. Một hàm public không được tự tạo folder con hoặc reset ledger trước xác minh.

Test cả CLI và hàm trực tiếp: default workspace riêng; output ra sibling; symlink/junction lồng parent chưa tồn tại; marker thiếu/sai; workflow nhận workspace không được sở hữu; trường hợp hợp lệ vẫn chạy. Dùng junction Windows nếu symlink không được cấp quyền; nếu không kiểm chứng được thì ghi NOT VERIFIED thay vì PASS giả.

### Bước 4 — Ledger không reset, lock gắn cùng workspace và cleanup

Chọn chính sách nhỏ và an toàn cho workflow hiện tại: một workspace dành cho một lần workflow; nếu ledger đã tồn tại thì TỪ CHỐI chạy lại và giữ nguyên byte (chưa cần resume). Single-suite nhiều stage nếu cần phải dùng cơ chế đọc ledger hợp lệ, tuyệt đối không khởi tạo lại. Ghi rõ hai chế độ trong tài liệu. Không dùng workspace mới để tự retry thử nghiệm ngoài quyền hạn; phiên này chỉ Fake.

- Ledger lần đầu tạo exclusive, dưới lock; không exists-then-overwrite. Tệp cũ bị hỏng vẫn từ chối, không coi là 0.
- Hạn mức offline mặc định 104 cho workflow theo kế hoạch; bỏ hardcode 150. Nếu cần limit thấp hơn trong unit test thì injection có phạm vi test, không tự nới trần CLI. Dự kiến 98 calls không phải số hardcode để chấm kết quả.
- Lưu pre-call bền vững trước delegate; provider throw vẫn tính; chạm trần phải dừng trước call tiếp. Tách fake calls/trial rows/localModelCalls=0.
- Lock canonical duy nhất gắn với workspace/ledger, được dùng bởi cả suite và workflow. Không thể đổi --lock-file để dùng cùng ledger đồng thời. Release phải kiểm tra ownership, không chiếm lock theo tuổi.
- Ngay sau acquire lock phải vào try/finally. Mọi khởi tạo ledger/loadKnowledge/metadata/journal/report đều được cleanup đúng khi lỗi. Journal mỗi stage có close trong finally riêng; lỗi cleanup không che mất lỗi gốc.
- Không tự sửa journal hỏng; lỗi ghi/fsync/report dừng workflow, không gọi stage tiếp.

Test:
1. Workspace có ledger 98 calls + run lịch sử: workflow bị từ chối, file giữ nguyên byte; không còn kết quả 16 và mất history.
2. Ledger hỏng hoặc init write lỗi: không reset, lock giải phóng, không provider call; phiên hợp lệ sau đó acquire lại được.
3. Chạm 104: call 105 không chạy; provider throw vẫn được ghi trước; không tự trừ/đếm lại.
4. Hai tiến trình/entrypoint cùng workspace/ledger nhưng cố đổi tên lock: đúng một tiến trình vào hoặc override bị từ chối.
5. Journal init/append/finalize hoặc report write thất bại: handles đóng, lock release, không stage sau; bằng chứng đã hoàn tất không mất.
6. Fake workflow bình thường và stop gates Control/Candidate vẫn đúng. COMPLETE journal không được thay technical/selection verdict.

### Bước 5 — Tích hợp và smoke thực qua CLI

Gọi đúng các entrypoint đã triển khai, không mô phỏng if/else trong test. Network trap chứng minh không fetch/preflight/Ollama. Live POS-24 vẫn bị chặn trước network/write.

Smoke tối thiểu: workflow thành công bằng fixture synthetic; Control technical fail dừng; Candidate fail dừng; workspace/ledger đã dùng bị từ chối; invalid snapshot bị từ chối. Stage counters/provider counters chứng minh không chạy đợt sau khi gate fail.

Fake metadata ghi mode và provenance đúng: role fixture control/candidate không đồng nghĩa source runtime đã chuyển sang snapshot đó. Hash phải thuộc nguồn thực dùng. Không biến Fake PASS thành số liệu chất lượng Qwen.

## 5. Quality gates và kiểm tra không thay đổi phạm vi

Dùng dependency local, không npx tải mạng. Đọc script trước để chắc chỉ offline/mock. Từ backend:
1. npm run typecheck
2. npm run build
3. npm run test:assistant
4. node_modules/.bin/tsx --test src/tests/evaluatorHardening.test.ts src/tests/intentDisambiguation.test.ts src/tests/pos24OfflinePreparation.test.ts và file regression mới; Windows dùng .cmd.
5. Smoke CLI có network trap/workspace sở hữu; ghi exit code và counter.
6. Secret scanner với --artifact đúng cú pháp cho mọi file mới/sửa/untracked thuộc task, gồm tài liệu; không kết luận quét hết chỉ từ tracked count.
7. git diff --check + kiểm tra riêng conflict markers/whitespace trên untracked task files; manifest hash đầu/cuối và HEAD/index.

Không chạy DB/worker/device/suite không liên quan. Không hạ gate, sửa expected, bỏ test để giữ số 67. Báo số test thực chạy mới; kết quả 67/73 cũ chỉ là lịch sử.

Cleanup chỉ path tuyệt đối đã xác minh thuộc workspace tạm do task/test tạo. Không đưa lệnh xóa thư mục cố định ../../temp-* vào hướng dẫn. Giữ artifact bàn giao cần thiết, không xóa lịch sử.

## 6. Đầu ra và điều kiện nghiệm thu

Cập nhật tài liệu offline-preparation với bảng ba lỗi → sửa → regression → bằng chứng. Giữ kết quả lịch sử có nhãn, không xóa dấu vết audit. Đồng bộ CLI mới và chính sách one-workspace/one-workflow, limit 104, path/ownership và cleanup trong evaluation-plan/handoff.

Bàn giao cần:
- File tạo/sửa; luồng source → AST → snapshot; CLI → owned workspace → lock/ledger → stages/Fake → journal/report → cleanup/error.
- Kết quả hai probe AST trước/sau; byte ledger trước/sau test lặp; stage/provider counters; đường dẫn bị chặn và ca hợp lệ.
- Hash protected trước/sau; số test/exit code; cái gì PASS/FAIL/SKIP/NOT RUN. Không tuyên bố mọi race filesystem được giải quyết nếu chỉ kiểm thử một số tình huống.
- Công cụ chỉ OFFLINE_TOOLING_PASS khi cả ba nhóm và regression cũ đạt. Nếu còn thiếu thì PARTIAL, nêu đúng phần thiếu.
- AI_CONTENT_PARTIAL, LIVE_POS24_NOT_RUN, 0 model calls; tracker POS-23 thật vẫn 98/104, ledger thật POS-24 chưa tạo.

Không sửa runtime thật, không gọi Qwen, không xin mở ngân sách để né lỗi công cụ. Sau khi offline đạt, chỉ đề xuất nhiệm vụ riêng xin duyệt tối đa 104 lượt local; không tự bắt đầu. Kết thúc bằng báo cáo tiếng Việt ngắn, link file và bằng chứng quan trọng.

# Nhiệm vụ: Chuẩn bị công cụ thử nghiệm POS-24 OFFLINE

## 1. Mục tiêu, chế độ và quyền hạn

Thực hiện IMPLEMENTATION OFFLINE: hoàn thiện snapshot, dataset DEV/DIAG, runner và kiểm thử Fake Provider cho thử nghiệm POS-24. Hoàn thành code, test và tài liệu bàn giao; không chỉ đề xuất kế hoạch.

Ưu tiên: bảo toàn runtime và bằng chứng > tính đúng của công cụ > tiện sử dụng. Đây là công cụ phục vụ đồ án reference, không phải xác nhận production readiness.

Ngân sách phiên này: 0 cuộc gọi mô hình, kể cả Ollama preflight /api/tags. Không cloud, OpenAI, tải model, dịch vụ trả phí, Docker, database, migration, worker hoặc Mobile/device. Không dùng 6 lượt cũ. Trần 104 lượt Qwen local là ĐỀ XUẤT CHO NHIỆM VỤ SAU, CHƯA ĐƯỢC DUYỆT. Không tạo ledger thật POS-24, không kích hoạt thử nghiệm thật.

Được sửa công cụ đánh giá và test trong phạm vi dưới đây. Không chỉnh prompt/hint runtime hay tạo candidate tối ưu trong nhiệm vụ này. Không chạy Qwen để kiểm tra công cụ. Không sửa prompt.md này. Không stage, commit, push, merge, reset, restore, clean, deploy; giữ toàn bộ WIP ngoài phạm vi.

## 2. Đọc và chốt bằng chứng đầu phiên

Đọc AGENTS.md, PROJECT_CONTEXT.md, hướng dẫn trong phạm vi. Kiểm tra branch/HEAD, git status/diff; tài liệu định hướng không thay thế source. Nếu .codegraph tồn tại, dùng CodeGraph trước khi tìm/đọc code. Không mặc định file untracked là file được phép ghi đè.

Đọc:
- documents/06-security-ai/assistant-pos24-selector-decision.md
- documents/06-security-ai/assistant-pos24-evaluation-plan.md
- documents/06-security-ai/assistant-evaluator-offline-hardening.md
- backend/scripts/evaluate-assistant-intent.ts
- backend/src/tests/assistantEvaluation/intentRunner.ts
- backend/src/tests/assistantEvaluation/intentJournal.ts
- backend/src/tests/assistantEvaluation/pos23BudgetTracker.ts
- backend/src/tests/evaluatorHardening.test.ts và intentDisambiguation.test.ts
- backend/src/assistant/responseCatalog.ts, helpService.ts, selectionPolicy.ts (chỉ đọc)
- backend/package.json, tsconfig liên quan và hai snapshot POS-23 trong prompt-archive.

Lập manifest đầu phiên cho các file bảo vệ: responseCatalog.ts, selectionPolicy.ts, knowledgeBundle.ts, tracker POS-23, hai snapshot lịch sử và dataset benchmark 56 câu. Ghi hash trước/sau. Không in dữ liệu nhạy cảm.

Giá trị đối chiếu từ lần rà soát gần nhất, phải xác minh lại:
- responseCatalog.ts SHA-256: d0109c9a5a5a72a8a344ad790329a1efb62701cb00cc41a36966b45c59b86d6a
- Runtime selectorPromptHash: 32d40a43d5e67de9f1c126be46d6e8ec88091e0c6d3dcb61e62f67cef95b5418
- Runtime answerCatalogHash: 7a5560870f47c2dd7da685869a97391604a100d1063813e5b22ba82c792ab85d
- Tracker POS-23 SHA-256: f625a32b2a53fbbd8e4b17b7acd777792d5b89c655bce1522f5fcdea15e89c46; totalCalls = 98, hạn mức cũ 104.
- Control lưu tại prompt-archive/pos23-candidate-1-snapshot.json: prompt c9c07ca237bdeadcafaba857e79a4ce2a93b24233f62dfbbdb22b5108f8cfe3f; catalog 73cc5b8113f5d32de689a6b0de7130ee4a2e85cecf2f785ffa85241fa4768e8a.

Nếu hash khác, không ghi đè để ép khớp: điều tra và báo khác biệt; dừng phần phụ thuộc nếu không xác định được bản tham chiếu. Không dùng git để hoàn nguyên WIP.

## 3. Phạm vi file được phép sửa

- backend/scripts/evaluate-assistant-intent.ts: mở rộng có mục tiêu cho POS-24/offline.
- backend/scripts/snapshot-assistant-runtime.ts: tạo mới nếu chưa có.
- backend/src/tests/assistantEvaluation/: thêm module dataset/snapshot/POS-24 orchestration hoặc budget nhỏ nếu cần; tái sử dụng intentRunner, tracker và journal đã harden.
- intentRunner.ts, pos23BudgetTracker.ts, intentJournal.ts: chỉ chỉnh tối thiểu để truyền cấu hình/path hoặc metadata Fake; giữ hành vi cũ và toàn bộ validation. Không viết lại framework.
- backend/src/tests/pos24OfflinePreparation.test.ts (tên đề xuất) và test liên quan khi cần regression.
- backend/package.json: chỉ thêm script kiểm thử offline nếu hữu ích, không thêm dependency.
- documents/06-security-ai/assistant-pos24-offline-preparation.md: báo cáo mới.
- assistant-pos24-evaluation-plan.md và assistant-offline-handoff.md: đồng bộ lệnh thật, phạm vi và trạng thái bằng thay đổi nhỏ.

Không sửa runtime Assistant, FAQ/knowledge, answer catalog, selectionPolicy, HTTP/API, schema, Mobile/Admin/CI; không sửa JSON/journal/báo cáo/snapshot lịch sử. Không tạo artifact giả mang tên lượt Qwen thật. Nếu cần vượt phạm vi, hoàn tất phần độc lập và báo rõ lý do, chưa thực hiện phần vượt phạm vi.

## 4. Kế hoạch thực hiện tuần tự

### Bước A — Thiết kế tích hợp nhỏ và tách Fake khỏi Ollama

Xác định điểm tái sử dụng runner, lock, budget và journal. CLI hiện có assertLocalModelAvailable() gọi /api/tags; phải chọn nhánh Fake trước preflight và trước tạo Ollama provider. Import module hoặc xem help không được khởi động evaluator.

Đề xuất giao diện CLI rõ ràng trong tài liệu rồi triển khai và test đúng giao diện đó. Bắt buộc hỗ trợ:
- POS-24 DEV, DIAG và benchmark 56 ca, phân biệt vai trò control/candidate trong metadata.
- Chế độ Fake tường minh; chỉ dùng fixture synthetic đã khai báo, thiếu fixture là lỗi, không tự suy đáp án từ expected rồi báo model chọn đúng.
- Chế độ POS-24 live chưa được cấp quyền phải fail-closed TRƯỚC mọi network hoặc ghi ledger thật. Không xem việc cung cấp model name, env có sẵn hay hạn mức 104 là owner approval.
- Không cần xây hệ thống phê duyệt phức tạp: có thể để POS-24 live chưa hỗ trợ, bàn giao bước bật live cho nhiệm vụ được duyệt sau. Giữ CLI/suite cũ tương thích.
- Nhánh Fake truyền path ledger/journal/report riêng; không mặc định trỏ về documents tracker thật. Unit/integration fake dùng thư mục tạm do test sở hữu.

### Bước B — Snapshot và bảo toàn catalog

Tạo công cụ snapshot/verify; thiết kế restore có guard, kiểm thử trên bản sao trong thư mục tạm. Phiên này không restore hoặc thay source runtime thật để thử tính năng.

Snapshot gồm: version/schema, thời điểm, HEAD/WIP metadata, hash toàn file, byte source cần phục hồi (bảo toàn encoding/newline), selectorPromptHash, catalogHash, danh sách đủ 25 ID cùng answer và answerHash, nguồn snapshot và cấu hình tham chiếu.

Phân biệt ba vai trò:
1. Control: candidate POS-23 lưu trữ, không phải runtime đang dùng.
2. Candidate mới: chưa được tinh chỉnh trong nhiệm vụ offline này.
3. Rollback Target: byte runtime baseline đầu phiên.

Không yêu cầu catalogHash giữ nguyên khi sửa hint: hash này bao gồm selectionHint. Bất biến là ID, answer và answerHash từng mục so với tham chiếu đã khóa độc lập; test không được chỉ tính lại hash của nội dung hiện tại rồi tự so với chính nó.

Verify phát hiện thiếu/trùng ID, sửa answer, hash sai, snapshot hỏng. Không tự sửa snapshot. Không execute code tùy ý từ snapshot để lấy hash; snapshot là dữ liệu cần validation.

Restore chỉ vào target đã xác định thuộc workspace thử nghiệm được sở hữu, chỉ khi current hash đúng trạng thái dự kiến. Nếu có chỉnh sửa xen ngang, từ chối restore để bảo vệ WIP. Không nhận đường dẫn tùy ý/path traversal từ JSON; không ghi đè snapshot cũ. Chứng minh round-trip byte-for-byte trên bản sao và restore thất bại không làm mất file hiện tại.

### Bước C — Dataset POS-24

Tạo dataset TypeScript riêng gồm đúng 8 DEV và 8 DIAG từ bảng hiện tại trong assistant-pos24-evaluation-plan.md. Sao chép chính xác caseId, question, expected và lý do; không viết lại câu cho dễ chọn. Đối chiếu từng hàng với tài liệu, dùng version và hash ổn định.

DIAG là tập công khai; không gọi blind/unseen holdout. Benchmark dùng nguyên 56 ca hiện có, không đổi expected hoặc rubric.

Bảo vệ đủ ranh giới 04/05, 06/13, 01/03; không thêm ca vào kế hoạch 104 calls mà không điều chỉnh đề xuất công khai. Test schema, unique ID, số hàng, nhãn hợp lệ, mapping câu hỏi và hash so với tham chiếu đã khóa.

### Bước D — Runner, ngân sách và bằng chứng tăng dần

Chuỗi tương lai chỉ là cấu hình kế hoạch, không chạy model trong nhiệm vụ này:
Control DEV 8×2 → Candidate DEV 8×2 → Candidate DIAG 8×2 → Candidate benchmark 56×1.
Dự kiến 98 calls, trần bảo thủ 104; không Control DIAG, retry hoặc candidate thứ hai. Bộ đếm fake độc lập, không được cộng vào số lượt Qwen thật.

Tái sử dụng:
- Lock độc quyền kiểm tra owner token; không chiếm lock dựa vào tuổi; release không xóa lock của tiến trình khác.
- Budget fail-closed, lưu bền vững trước delegate call, chặn trước vượt trần. Không dùng SESSION_CALL_LIMIT cũ một cách vô tình khiến kế hoạch POS-24 bị chặn sai; cấu hình theo nhiệm vụ và giữ mặc định POS-23 nguyên trạng.
- Journal metadata → trial được ghi/fsync trước ca kế tiếp → final. Lỗi ghi đĩa phải dừng trước ca tiếp theo, không chỉ log rồi tiếp tục.
- Reader giữ đầy đủ schema/cross-field validation, duplicate/index/count/final checks. COMPLETE nghĩa là hoàn tất ghi dữ liệu hợp lệ, không có nghĩa selector đúng hoặc nội dung an toàn.

Metadata phải ghi đúng mode FAKE_OFFLINE, snapshot role/hash, dataset version/hash, runId, repetitions và config. Không gắn modelDigest giả hay ghi Fake là Qwen thực tế. Nếu cần mở rộng schema mode, tương thích journal lịch sử và thêm test; không hạ validation hiện hành.

Tách ba mẫu số deterministic/provider/toàn hệ thống; lỗi provider vẫn tính vào số lần provider thử gọi. Với Fake, gọi rõ fakeProviderCalls; localModelCalls=0, externalAiCalls=0. Không tạo tỉ lệ chất lượng Qwen từ fixture.

Lưu riêng bằng chứng offline mới dưới thư mục sở hữu nhiệm vụ, không ghi đè lịch sử. CLI/test phải dùng module TS hiện tại; kiểm tra nguy cơ import nhầm .js/.d.ts cũ cạnh scripts. Không xóa generated/WIP ngoài phạm vi; ghi rõ nếu có xung đột.

### Bước E — Ma trận kiểm thử bắt buộc bằng Fake Provider

Dùng fixture tạm và provider tiêm vào, không daemon. Kiểm thử ít nhất:
1. Snapshot round-trip nguyên byte; hash source/prompt/catalog đúng; đủ 25 answer khớp tham chiếu.
2. Chỉ đổi hint trên bản sao: catalogHash đổi, answerHash không đổi. Đổi answer/thiếu ID bị từ chối.
3. Snapshot sai checksum, sai schema, traversal, output đã tồn tại bị từ chối; restore gặp WIP xen ngang không ghi đè.
4. Dataset DEV/DIAG 8+8 khớp bảng; benchmark vẫn 56 ca không sửa.
5. Fake CLI chạy không fetch/preflight/Ollama; chứng minh bằng spy/trap network và integration entrypoint, không chỉ đọc code.
6. POS-24 live chưa được duyệt bị chặn trước provider, preflight và ghi ledger thật.
7. Ledger tạm độc lập POS-23; tăng trước call; delegate throw vẫn tính; JSON hỏng bị chặn; chạm trần không gọi thêm; không giảm/reset bộ đếm để retry.
8. Hai evaluator cùng ledger/lock không chạy đồng thời; release sai token không xóa lock.
9. Ngắt sau vài hàng: hàng hoàn tất vẫn đọc lại được, không ghi COMPLETE giả; resume tự động không cần triển khai.
10. Ghi journal/fsync lỗi: không chạy ca kế tiếp; tài nguyên được đóng và lock của mình được giải phóng.
11. Journal trùng, sai index/count, trial sau final, nhiều final, success thiếu ID/answer bị CORRUPTED; issues không phản chiếu marker nhạy cảm. Tái sử dụng regression hiện có thay vì chép lại tất cả.
12. Chọn sai ID (FAQ-05 cho POS-24), malformed output hoặc provider error: số liệu và exit code đúng, không PASS lựa chọn; final COMPLETE nếu ghi đủ hợp lệ vẫn khác verdict sai.
13. Gate orchestration: Control có wrong selection nhưng hoàn tất kỹ thuật vẫn cho phép thử Candidate; Candidate DEV/DIAG/benchmark sai thì dừng đợt sau. Không yêu cầu Control đạt 100% vì mục đích đang đo lỗi.
14. Bài tập restore sau lỗi dùng workspace bản sao; runtime thật và tracker thật có hash trước/sau không đổi.

Nếu cần kiểm thử quy trình đủ 104 hàng, chỉ dùng Fake trong temp, ghi rõ 104 trial rows không đồng nghĩa 104 model calls. Không sửa test chỉ để khớp số lượng PASS lịch sử.

### Bước F — Gates và bàn giao

Sau code, chạy tuần tự từ backend với công cụ cài sẵn, không tải package:
1. npm run typecheck
2. npm run build
3. npm run test:assistant
4. node_modules/.bin/tsx --test src/tests/evaluatorHardening.test.ts src/tests/intentDisambiguation.test.ts src/tests/pos24OfflinePreparation.test.ts (Windows dùng .cmd; điều chỉnh tên theo file thật).
5. Chạy smoke CLI POS-24 bằng Fake, temp paths, network bị chặn; đủ bằng chứng fail và success.
6. Secret scan có --artifact bao phủ các file mới/untracked theo cú pháp scanner hiện tại; không chỉ quét tracked rồi kết luận tất cả sạch.
7. git diff --check và kiểm tra riêng whitespace/conflict markers/file integrity trên các file untracked nhiệm vụ; đối chiếu manifest bảo vệ.

Kiểm tra trước script test không có live model/DB side effect. Mock HTTP loopback thuộc unit test được phép; không kết nối Ollama hay dịch vụ ngoài. Không chạy lại database/worker/full banking suite không liên quan. Ghi chính xác PASS/FAIL/SKIP/NOT RUN và số test mới thực chạy, không sao số 73/51 cũ.

## 5. Đầu ra và tiêu chí hoàn thành

Tạo báo cáo assistant-pos24-offline-preparation.md gồm:
- File tạo/sửa và lý do; lệnh CLI đã thực sự triển khai, không trình bày lệnh giả như chạy được.
- Luồng CLI → chọn mode → snapshot/dataset → lock/budget → Fake → service/catalog → journal → report → cleanup/error.
- Bảng testcase/bằng chứng; hash trước/sau; tác động compatibility và giới hạn còn lại.
- Phân biệt TOOLING_OFFLINE_PASS (nếu đủ bằng chứng), AI_CONTENT_PARTIAL, LIVE_POS24_NOT_RUN.
- 0 lượt Qwen, 0 cloud, tracker POS-23 nguyên 98/104; chưa tạo ledger thật POS-24.
- Hướng dẫn kiểm tra thủ công offline có thể sao chép chạy, path riêng và kết quả dự kiến.
- Đề xuất nhiệm vụ sau: owner duyệt riêng tối đa 104 lượt Qwen local; sau đó mới tạo ledger thật, chuẩn bị candidate, chốt hash và chạy tuần tự theo stop gates. Không coi việc bàn giao hay fake PASS là phê duyệt này.

Chỉ chốt công cụ offline đạt khi các gates phù hợp pass, bài thử thật của Fake chứng minh wiring, runtime/knowledge/policy/ledger cũ nguyên hash, không có call model thật, và report không trộn bằng chứng fake với lịch sử Qwen. Không tuyên bố đã sửa POS-24 hoặc đạt 56/56 Qwen.

Khi gặp blocker, hoàn tất phần độc lập, ghi lỗi cụ thể và phần chưa kiểm chứng; không tự mở phạm vi hay ngân sách. Kết thúc bằng báo cáo tiếng Việt ngắn, link file, kiểm tra đã chạy và bước tiếp theo. Không thực hiện bước live trong nhiệm vụ này.

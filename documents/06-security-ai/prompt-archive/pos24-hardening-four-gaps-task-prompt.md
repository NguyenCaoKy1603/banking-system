# Nhiệm vụ: Hoàn thiện snapshot, guard, điều phối và workspace OFFLINE POS-24

## 1. Mục tiêu và ranh giới

Chế độ: IMPLEMENTATION OFFLINE. Sửa bốn khoảng trống đã được audit, triển khai test hồi quy và cập nhật bàn giao. Ưu tiên bảo toàn source/WIP/bằng chứng, tính đúng của công cụ, rồi mới sự thuận tiện. Không chỉ viết kế hoạch, không mở rộng thành framework mới.

Ngân sách nhiệm vụ = 0 model calls: không Ollama, kể cả /api/tags/preflight; không cloud/API AI, tải model, chi phí dịch vụ. Không Docker, DB, migration, worker, Mobile/device. Chỉ dùng Fake Provider và dữ liệu tổng hợp trong workspace thử nghiệm riêng. Trần 104 Qwen local là đề xuất cho nhiệm vụ SAU, chưa được duyệt; không tạo ledger thật POS-24, không dùng 6 lượt POS-23 còn lại.

Được sửa code công cụ/test theo mục 3. Không sửa runtime prompt/hints/answers/policy/knowledge; không tối ưu POS-24 bằng thử model. Không sửa prompt.md này. Không git add/commit/push/merge/reset/restore/clean, không deploy, không ghi đè WIP ngoài phạm vi. Công cụ restore chỉ được thực thi trên bản sao thử nghiệm trong phiên này, không trên source thật.

## 2. Bối cảnh và bước xác nhận đầu phiên

Đọc AGENTS.md, PROJECT_CONTEXT.md và hướng dẫn trong phạm vi. Kiểm tra HEAD, status/diff; dùng CodeGraph trước tìm/đọc code nếu có .codegraph. Không tin báo cáo thay cho source/test/bằng chứng. Nếu thấy cập nhật đồng thời, bảo toàn và đối chiếu trước khi sửa.

Đọc hai tài liệu POS-24 decision/evaluation-plan, assistant-pos24-offline-preparation.md, assistant-evaluator-offline-hardening.md, assistant-offline-handoff.md và:
- backend/src/tests/assistantEvaluation/snapshotManager.ts
- backend/scripts/snapshot-assistant-runtime.ts
- backend/scripts/evaluate-assistant-intent.ts
- backend/src/tests/assistantEvaluation/intentRunner.ts, intentJournal.ts, pos23BudgetTracker.ts
- backend/src/tests/pos24OfflinePreparation.test.ts, evaluatorHardening.test.ts, intentDisambiguation.test.ts
- responseCatalog.ts, knowledgeBundle.ts, selectionPolicy.ts (chỉ đọc), dataset DEV/DIAG/benchmark và fixture Fake.

Audit gần nhất: typecheck PASS, 65/65 test offline PASS nhưng chưa đủ nghiệm thu. Hai probe đã trả valid=true sai:
1. Snapshot có selectorPromptHash và answerCatalogHash = "not-a-hash".
2. sourceContent = "export const unrelated = true;", runtimeFileSha256 tính lại đúng, nhưng giữ metadata/entries baseline.

Các khoảng trống khác: --force bỏ qua chống ghi đè; T13 tự tính gate trong test thay vì gọi logic điều phối dùng thật; Fake mặc định dùng lock/report thật, budget path chưa được giới hạn.

Lưu manifest hash đầu/cuối phiên cho responseCatalog.ts, selectionPolicy.ts, knowledgeBundle.ts, tracker POS-23, hai snapshot lịch sử, dataset chuẩn và các fixture hiện có. Số liệu lịch sử không được ghi đè.
- responseCatalog.ts SHA256: d0109c9a5a5a72a8a344ad790329a1efb62701cb00cc41a36966b45c59b86d6a
- Runtime prompt hash: 32d40a43d5e67de9f1c126be46d6e8ec88091e0c6d3dcb61e62f67cef95b5418
- Runtime catalog hash: 7a5560870f47c2dd7da685869a97391604a100d1063813e5b22ba82c792ab85d
- Tracker POS-23 SHA256: f625a32b2a53fbbd8e4b17b7acd777792d5b89c655bce1522f5fcdea15e89c46; 98/104.

Nếu khác manifest, không ép khớp hoặc xóa WIP: xác định nguyên nhân; dừng phần phụ thuộc nếu không xác định được baseline, tiếp tục phần độc lập an toàn.

## 3. Phạm vi sửa

Được sửa các module snapshot, CLI snapshot/evaluator, intentRunner/journal/tracker khi cần tích hợp nhỏ; thêm module điều phối/workspace/reference riêng dưới backend/src/tests/assistantEvaluation/; sửa/thêm test offline tương ứng. backend/package.json chỉ thêm script offline nếu cần, không dependency mới. Dùng thư viện TypeScript đang cài nếu cần AST, không tải thêm.

Tài liệu: cập nhật assistant-pos24-offline-preparation.md và ghi rõ bằng chứng cũ/bằng chứng mới; đồng bộ lệnh thật trong assistant-pos24-evaluation-plan.md và liên kết ngắn trong assistant-offline-handoff.md. Có thể thêm báo cáo sửa lỗi riêng và fixture regression mới, không sửa dữ liệu lịch sử để làm PASS.

Không sửa backend/src/assistant runtime, banking core/HTTP/API/DB, Mobile/Admin/CI. Không thay schema journal cũ theo cách làm mất kiểm tra; nếu thêm field thì phải có test tương thích. Không xóa file generated cũ ngoài phạm vi; kiểm tra import TS có lấy nhầm JS cạnh file không.

## 4. Phương án A — Gắn snapshot với source và nguồn tham chiếu độc lập

### Thiết kế

Tạo một đường phân tích source KHÔNG thực thi source snapshot. Khuyến nghị dùng TypeScript AST đang có để đọc tập con cú pháp của responseCatalog.ts: CATALOG_SEED dạng literal, selector prompt dạng mảng literal join newline, version và các phụ thuộc metadata đã xác minh từ knowledgeBundle. Chỉ hỗ trợ rõ cú pháp cần thiết; gặp computed expression, call/import bất ngờ, spread hoặc cú pháp không hỗ trợ thì từ chối. Không eval, Function, dynamic import, chạy subprocess để thực thi source tùy ý hoặc dùng regex mong manh làm parser tổng quát.

Cần ràng buộc cả công thức dựng catalog/prompt được hỗ trợ, không chỉ tìm được vài chuỗi rồi bỏ qua code khác. Có thể kiểm tra cấu trúc AST còn lại với mẫu cấu trúc được tin cậy; không tự tuyên bố hỗ trợ TypeScript bất kỳ. Nếu source thay đổi cấu trúc ngoài phạm vi công cụ thì fail-closed với lỗi tĩnh có ích.

createRuntimeSnapshot phải lấy dữ liệu từ CHÍNH file target; không lấy entries/hash từ module baseline đã import để gắn vào file khác. verifyRuntimeSnapshot phân tích lại source, kiểm tra schema/roles/metadata/hash và tính lại bằng công thức runtime hiện tại. Chứng minh parity trên source baseline đã tin cậy, không thực thi source không tin cậy để chứng minh parity.

Bảo toàn byte nguồn (kể cả BOM/CRLF) và hash; nếu dùng UTF-8 text phải kiểm tra round-trip byte chính xác, từ chối byte không hợp lệ thay vì âm thầm chuyển đổi.

Nguồn tham chiếu 25 answer phải khóa độc lập với module runtime đang được kiểm tra: đối chiếu baseline archive lịch sử và source hiện tại đã xác minh rồi tạo fixture reference riêng chứa ID/answer/answerHash và provenance. Ghi cách trích xuất, hash nguồn và mâu thuẫn nếu có. Không tự regenerate reference mỗi lần chạy test. Hash của dữ liệu đang kiểm tra so với chính nó không phải bằng chứng bảo toàn.

Công thức catalogHash phải bao gồm đúng trường/thứ tự/serialization của runtime, gồm selectionHint, nguồn FAQ/prompt và answerHash. Snapshot cần đủ dữ liệu hoặc tham chiếu đã khóa để tính lại; không dùng công thức chỉ băm id/topic như T02 cũ.

### Test bắt buộc

- Hai probe audit phải bị từ chối, issues không rỗng.
- Hash đúng dạng 64 hex nhưng giá trị sai cũng bị từ chối; thiếu trường/hash/metadata bất hợp lệ bị từ chối.
- Thay hint thực trong source COPY: file/prompt/catalog metadata được tính đúng, answerHash giữ nguyên; không chỉ sửa JSON snapshot.
- Sửa answer trong source rồi cập nhật mọi checksum vẫn bị reference độc lập bắt; thiếu/trùng/sai ID bị bắt.
- Source và entries/hints snapshot không khớp bị bắt; source không hỗ trợ bị từ chối, không được thực thi.
- Byte round-trip và hash parity baseline đạt; current runtime không bị sửa.
- Lỗi validator chỉ dùng tên trường/số dòng/mã tĩnh, không đưa raw source/answer/giá trị đầu vào vào log.

## 5. Phương án B — Bỏ hoàn toàn bypass force và chống ghi đè

CLI phải từ chối rõ --force, --force=true và các dạng parser có thể nhận; API restore không có đường force bỏ guard. Không lặng lẽ bỏ qua cờ khiến người dùng hiểu nhầm đã ép thành công. Test cả CLI và hàm dùng thật.

Tạo snapshot với exclusive creation, không chỉ existsSync rồi writeFileSync; tên trùng/đồng thời phải không ghi đè. Giữ file snapshot cũ nguyên byte kể cả khi có lỗi.

Restore cần snapshot hợp lệ, explicit target và workspace được xác nhận, expectedCurrentHash bắt buộc đúng. Không mặc định restore vào runtime source thật. Xác minh hash trước ghi; target khác trạng thái dự kiến thì từ chối, không tự suy ra expected hash mới để lách guard.

Tái sử dụng ownership/lock phù hợp, ghi thay thế có xử lý lỗi; nêu trung thực giới hạn với editor ngoài tiến trình, không tuyên bố chống mọi race chỉ nhờ một phép kiểm tra hash. Test lỗi ghi/rename và chỉnh sửa xen ngang qua điểm tiêm lỗi trước ghi: target/WIP phải được bảo toàn, cleanup chỉ thuộc nhiệm vụ.

Kiểm tra containment dựa trên đường dẫn thực, gồm symlink/junction của target/parent trên Windows; workspace rỗng, traversal, alias tới protected file bị từ chối trước ghi. Không cần harden filesystem toàn dự án: giới hạn thao tác của công cụ này.

## 6. Phương án C — Điều phối thật, test gọi đúng logic đó

Tạo hàm điều phối nhỏ được CLI/workflow offline sử dụng, nhận stage executor và kết quả có cấu trúc (journal integrity, technical counts, selection counts, planned/actual rows, metadata), không tự tạo logic chỉ trong test. Có thể thêm --workflow=pos24-offline; tên cuối phải triển khai và ghi tài liệu đúng.

Chuỗi: Control DEV 16 hàng → Candidate DEV 16 → Candidate DIAG 16 → Candidate benchmark 56. Không Control DIAG, retry hoặc candidate thứ hai. Các fixture là synthetic, không phải kết quả Qwen.

Gate:
- Control: journal hợp lệ COMPLETE, đủ 16 hàng, technicalFail=0; wrongSelection được chấp nhận làm dữ liệu đối chứng.
- Control có lỗi kỹ thuật, thiếu hàng, journal INCOMPLETE/CORRUPTED, metadata lệch → dừng trước Candidate.
- Candidate DEV/DIAG: đủ 16, kỹ thuật không lỗi và chọn đúng 16/16 mới tiếp tục.
- Benchmark: đủ 56, kỹ thuật không lỗi và đúng 56/56 mới đạt quy trình fake; sai giữ verdict failed, không tự đổi nhãn.
- COMPLETE chỉ mô tả ghi bằng chứng, không thay thế technical/selection verdict.

Test dùng bộ đếm stage/provider để chứng minh stage sau KHÔNG được gọi khi mỗi gate thất bại. Test control WRONG nhưng kỹ thuật PASS vẫn tiếp tục; COMPLETE chứa provider FAIL phải dừng. Test DIAG/benchmark fail riêng. Test từ CLI tới hàm điều phối (không chỉ unit hàm không ai gọi).

Không cần đổi runtime để mô phỏng role. Metadata phân biệt syntheticScenarioRole với snapshot/source thực tế: --role=control không tự biến runtime baseline thành snapshot Control lịch sử. Nếu dùng hash source đang nạp phải ghi đúng provenance, không gán hash lịch sử cho source chưa dùng. Thử rollback workflow chỉ trên bản sao trong workspace.

## 7. Phương án D — Workspace Fake độc lập từ đầu đến cuối

Mọi entrypoint Fake (suite và workflow) phải tạo mkdtemp workspace riêng hoặc dùng workspace explicit được kiểm tra ownership. Lock, ledger fake, journal, report nằm bên trong workspace đó. Không fallback về POS23_LOCK_FILE hoặc documents/06-security-ai thật.

Trước acquire lock, mkdir output hay write, chuẩn hóa và kiểm tra các đường dẫn; dùng đường dẫn thực của parent cho file chưa tồn tại. Không để --budget-file/--lock-file/--journal-dir/--report-dir hoặc symlink/junction trỏ sang tracker/lock/runtime/bằng chứng lịch sử được bảo vệ. Nếu không chứng minh được vùng sở hữu thì từ chối. CLI option cũ phải được ràng buộc vào workspace hoặc báo lỗi rõ, không âm thầm mở quyền ghi ngoài.

Tất cả stage workflow dùng cùng ledger fake và lock độc quyền; không tạo ledger mới để reset budget giữa stage, không cho hai lock khác nhau dùng cùng ledger đồng thời. Tái sử dụng pre-call persistence/reader fail-closed, giữ hành vi POS-23 cũ. Phân biệt số fake calls với trial rows và với localModelCalls=0.

Mọi nhánh Fake không được gọi preflight/Ollama; live POS-24 tiếp tục bị chặn trước network và ghi dữ liệu. Import/help không gây side effect. Không tạo ledger thật POS-24 kể cả 0 calls.

Test đường dẫn nguy hiểm bằng bản sao fixture protected, không thử ghi thật vào tracker/source. Có thể gọi validation trên path thật để chứng minh từ chối nhưng không thực thi mutation. Hash protected trước/sau là kiểm tra bổ sung, không thay cho test guard.

Test tối thiểu: default workspace độc lập; path ra ngoài/traversal/symlink bị chặn; cùng ledger cạnh tranh bị chặn; malformed ledger và chạm trần; pre-call vẫn lưu khi provider throw; fsync lỗi dừng ca sau; network trap ở CLI; fake artifacts ghi mode chính xác, không bị nhập nhầm vào báo cáo Qwen.

Cleanup chỉ workspace temp do phiên/test tạo, sau khi xác minh absolute resolved path và ownership. Không đưa lệnh rm -rf ../../temp-* hay Remove-Item cố định vào hướng dẫn. Giữ report cần bàn giao; không tự xóa evidence lịch sử.

## 8. Thứ tự triển khai và kiểm chứng

1. Chốt manifest + tái hiện probe audit bằng fixture an toàn; thêm test thất bại phản ánh bốn lỗi.
2. Sửa source-bound snapshot và reference độc lập; chạy test snapshot.
3. Sửa force/restore/create guard và workspace isolation; test CLI/path bằng temp.
4. Tích hợp orchestration dùng thật; chạy workflow fake từ entrypoint với network trap.
5. Chạy gates và cập nhật tài liệu theo kết quả thực đo. Không tối ưu model giữa chừng.

Chạy bằng dependency cài sẵn, không npx tải mạng. Trong backend:
- npm run typecheck
- npm run build
- npm run test:assistant (đọc scripts trước, chỉ unit/mock, không live)
- node_modules/.bin/tsx --test src/tests/evaluatorHardening.test.ts src/tests/intentDisambiguation.test.ts src/tests/pos24OfflinePreparation.test.ts và file regression mới nếu có; Windows dùng .cmd.
- Smoke CLI/workflow Fake với network trap và workspace riêng: success, control technical error, candidate wrong, invalid snapshot/path.
- Secret scanner với --artifact đúng cú pháp bao phủ TẤT CẢ file mới/sửa/untracked thuộc task, gồm tài liệu; ghi số file thực quét.
- git diff --check và kiểm tra riêng conflict markers/whitespace trên file untracked nhiệm vụ. Đối chiếu manifest cuối, HEAD/index và ledger thật.

Test số lượng tăng theo coverage cần thiết; không giữ 65 bằng cách bỏ test, không dùng số test PASS để thay thế assertion. Test mô phỏng phải gọi đường code thật, không tự viết lại guard trong test. Không chạy suite database/worker/device không liên quan. Nếu gate fail, ghi nguyên nhân và sửa trong phạm vi; không hạ tiêu chí.

## 9. Bàn giao và tiêu chí chốt

Báo cáo tiếng Việt phải gồm:
- Bảng bốn lỗi → code sửa → test regression → bằng chứng thực thi.
- Kết quả chính xác hai probe trước/sau; minh chứng source/hash/reference ràng buộc đúng.
- Luồng CLI → workspace/validation → snapshot → orchestration → budget/Fake/service/catalog → journal/report → cleanup/error.
- Lệnh thực sự chạy được; runtime source/historical tracker giữ hash; ledger thật POS-24 chưa tạo; model calls=0.
- Stage/provider counters ở các test stop gate; số test thực chạy, fail/skip/not run; không tái dùng PASS 73/65 cũ như lượt mới.
- Các giới hạn snapshot parser/encoding/filesystem đã kiểm chứng; không suy diễn zero-risk.
- Các status tách riêng: OFFLINE_TOOLING_PASS chỉ nếu tiêu chí dưới đủ; AI_CONTENT_PARTIAL; LIVE_POS24_NOT_RUN.

Chỉ chốt offline PASS khi: các probe sai bị từ chối; snapshot gắn với source thực và 25 answers khớp reference độc lập; không force bypass; workspace không ghi ra vùng bảo vệ; workflow dùng gate thật và test chứng minh dừng; gates phù hợp pass; không có model/network tới daemon hay thay runtime/ledger lịch sử.

Nếu còn thiếu, ghi PARTIAL/NOT VERIFIED cụ thể; không giữ tiêu đề OFFLINE TOOLING READY trái bằng chứng. Bộ Fake hoàn tất không chứng minh selector Qwen đã sửa POS-24.

Nhiệm vụ kế tiếp sau khi công cụ đạt là xin quyết định riêng cho thử Qwen local tối đa 104 lượt; việc hoàn thành nhiệm vụ này không tự cấp quyền, không tự bật live hoặc tạo candidate thật. Dừng ở bàn giao offline.

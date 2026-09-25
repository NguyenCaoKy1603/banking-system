# Nhiệm vụ riêng: Rà soát POS-24 và quyết định hướng xử lý chất lượng selector NOVA

## 1. Chế độ và mục tiêu

AUDIT OFFLINE + QUYẾT ĐỊNH THIẾT KẾ + VIẾT TÀI LIỆU. Thực hiện rà soát và tạo tài liệu hoàn chỉnh, không chỉ trả một kế hoạch chung.

Mục tiêu: xác định POS-24 sai ở đâu, ảnh hưởng của câu trả lời, và chọn một hướng xử lý nhỏ, phù hợp đồ án sinh viên. Không tiếp tục chỉnh prompt thiếu đối chứng; không đổi expected để làm đẹp số liệu.

Nhiệm vụ này KHÔNG cấp quyền sửa runtime/evaluator/test/FAQ/catalog/dataset chính thức. Ngân sách model-call = 0: không gọi Ollama kể cả /api/tags, cloud/API trả phí, tải model, Docker, DB, migration hoặc worker. Không dùng 6 lượt còn lại hoặc tự cấp thêm lượt.

Đọc AGENTS.md, PROJECT_CONTEXT.md và hướng dẫn trong phạm vi. Kiểm tra HEAD, git status/diff và source. Dùng CodeGraph trước khi tìm/đọc code nếu có .codegraph. Giữ WIP, không reset/restore/clean/stage/commit/push/deploy. Không ghi đè JSON, snapshot hoặc báo cáo lịch sử.

## 2. Bối cảnh phải xác nhận bằng bằng chứng

- Candidate gần nhất: DEV 8/8, HOLDOUT 8/8, benchmark 55/56.
- Candidate chọn đúng POS-23 nhưng POS-24 chọn FAQ-05 thay vì FAQ-04.
- Phiên đó dùng 74 generation calls; tracker POS-23 cộng dồn 98/104, còn 6.
- Candidate đã hoàn nguyên. Runtime hiện là baseline, không được mô tả kết quả candidate như kết quả runtime hiện tại.
- Công cụ lock/journal đã được sửa trong nhiệm vụ riêng; không mở rộng hoặc làm lại nhiệm vụ công cụ nếu không có lỗi trực tiếp cản trở việc đọc bằng chứng.

POS-24 nguyên văn: “Tôi muốn kiểm tra lại các lần biến động số dư đã thực hiện thì vào đâu?” Expected lịch sử: FAQ-04.

Phân biệt ban đầu cần kiểm chứng:
- FAQ-04: mở danh sách lịch sử và tải thêm giao dịch cũ.
- FAQ-05: lọc theo trạng thái hoặc dòng tiền vào/ra.
- FAQ-06: xem một giao dịch cụ thể.
- FAQ-13: xử lý pending/timeout/chưa rõ kết quả.
- FAQ-01/03: số dư/thông tin tài khoản, không phải lịch sử biến động.

Không coi “biến động số dư” mặc nhiên là yêu cầu lọc. Không suy đoán cơ chế attention/tokenizer hoặc nguyên nhân model chọn sai như sự thật đã chứng minh.

## 3. Phạm vi đầu ra

Tạo hai tài liệu:
1. documents/06-security-ai/assistant-pos24-selector-decision.md
2. documents/06-security-ai/assistant-pos24-evaluation-plan.md

Nếu file đã tồn tại, đọc trước và cập nhật có mục tiêu nếu đúng nhiệm vụ, hoặc tạo phiên bản mới để bảo toàn WIP. Có thể cập nhật assistant-offline-handoff.md bằng liên kết ngắn, ghi rõ quyết định/kế hoạch CHƯA TRIỂN KHAI, CHƯA CHẠY MODEL.

Không sửa prompt.md này, source, test, dữ liệu lịch sử hoặc tracker thật. Có thể dùng script chỉ đọc để tổng hợp JSON/hash; không chạy CLI evaluator. Không tạo số liệu thử nghiệm giả.

## 4. Bước 1 — Lập bảng bằng chứng lịch sử

Tìm mọi kết quả POS-24 đã lưu, kể cả results và benchmarkResults nếu schema khác nhau. Đối chiếu expected/actual ID, answer thực tế, runId, hash prompt/catalog/dataset và cấu hình.

Đọc cùng các run cho POS-23, nhóm QR, tiền vào/tiết kiệm, mở khóa/TOTP và FAQ-06/13 để biết các ranh giới cần giữ.

Lập bảng từng kết quả, không gộp phiên bản khác nhau thành một tỷ lệ. Phân biệt baseline runtime, candidate đã hoàn nguyên, kết quả lịch sử không tương đương đối chứng cùng phiên, và dữ liệu thiếu. Đọc tracker thật, đối soát tổng; nếu mâu thuẫn thì báo, không sửa. Ghi đường dẫn nguồn và hash, không xuất credential.

## 5. Bước 2 — Chốt ranh giới và mức độ sai

Đọc FAQ và catalog thực tế; đối chiếu màn hình lịch sử, bộ lọc, chi tiết giao dịch và điều kiện tải thêm. Không chỉ suy luận tên file.

Lập bảng: ý định → FAQ → ngữ cảnh/điều kiện → answer đáp ứng gì → source file/method/line.

Trả lời riêng cho POS-24:
1. Người dùng muốn mở lịch sử hay lọc một tập giao dịch?
2. FAQ-04 đáp ứng bước nào?
3. FAQ-05 có đường vào màn hình không, có yêu cầu lọc không cần thiết không?
4. Answer FAQ-05 đúng hoàn toàn, phù hợp một phần, sai hướng dẫn hay nguy hiểm? Chứng minh bằng nội dung.
5. Có thiếu nguồn hoặc expected thật sự không rõ không?

Giữ verdict lịch sử. Nếu có cơ sở đề xuất nhiều answer chấp nhận được, ghi như đề xuất rubric tương lai; không hồi tố đổi POS-24 thành PASS hoặc sửa benchmark v1.

Tách ba tiêu chí: hoàn tất kỹ thuật, chọn đúng ID theo rubric hiện hành, và nội dung đúng nguồn/đầy đủ/phù hợp nhu cầu.

## 6. Bước 3 — So sánh phương án và chốt khuyến nghị

Đánh giá ít nhất:
A. Giữ baseline cho demo học thuật, ghi rõ hạn chế.
B. Chỉnh tối thiểu selector hint/prompt FAQ-04/05, giữ answer.
C. Rule deterministic hẹp cho ý định rõ, có phản ví dụ; không hardcode câu POS-24 hoặc case ID.
D. Chỉnh tổ chức catalog/rubric do chồng lấn tri thức, chỉ khi chứng minh bằng nguồn. Đây là mở rộng phạm vi, không tự triển khai.

So sánh độ phức tạp, lợi ích dự kiến, nguy cơ nhầm FAQ-05/06/13 và POS-23, khả năng kiểm thử, contract, bảo trì, số lượt model cần thiết.

Chọn MỘT phương án khuyến nghị với lý do, không chỉ liệt kê để người dùng tự quyết mọi thứ. Ghi giả thuyết cần đo, không cam kết 100%.

Nếu khuyến nghị candidate: xác định base snapshot/hash là baseline hiện tại hay candidate POS-23 đã lưu. Không lấy baseline rồi bỏ quên POS-23; không coi candidate là đã triển khai. Mô tả diff/hints đề xuất trong tài liệu, không sửa source.

Mặc định không đổi model/token/context/timeout, không thêm RAG/embedding/framework. Không tự hạ tiêu chí 56/56 hiện có. Nếu đề xuất đổi tiêu chí tương lai, ghi DRAFT cần owner quyết định và không dùng nó để chốt PASS hiện tại.

## 7. Bước 4 — Thiết kế thử nghiệm tiếp theo, chưa chạy

Kế hoạch đủ để triển khai trong nhiệm vụ riêng được giao sau này:

- Một candidate, base snapshot rõ ràng, biến được đổi và biến cố định.
- Chốt nhãn và lý do trước chỉnh candidate.
- DEV có POS-24, mở lịch sử chung, lọc tiền vào/ra/trạng thái, chi tiết một giao dịch, pending và ca bảo vệ POS-23.
- Các cặp gần nghĩa: “lịch sử ở đâu”/“chỉ xem tiền vào”; “trạng thái giao dịch ở đâu”/“giao dịch đang xử lý phải làm gì”. Dùng phủ định/không dấu khi có mục đích cụ thể, không mở rộng vô hạn.
- Baseline và candidate trên CÙNG tập DEV/cấu hình. Không dùng một câu đã biết sai làm toàn bộ bộ đo.
- HOLDOUT khóa trước chỉnh candidate, dùng diễn đạt độc lập, không chỉnh candidate sau khi xem kết quả. Ví dụ được công khai để thiết kế là DEV/diagnostic, không giả vờ là holdout chưa thấy.
- Benchmark 56 giữ nguyên; cân nhắc bộ safety hiện có để bảo vệ các ranh giới trước, nêu phạm vi và trần calls rõ.
- Lưu snapshot/hash/journal bằng công cụ hiện có; không thêm hạ tầng.

Chọn số ca/lần lặp cụ thể; lập bảng tổng trần generation calls cho từng đợt, tính cả baseline. Ca deterministic giảm số thực gọi nhưng ngân sách dùng trần bảo thủ. Chọn một thử nghiệm gọn, không chuỗi ứng viên vô hạn.

Chỉ còn 6 lượt cũ. Nếu không đủ đối chứng/hồi quy, ghi rõ CHƯA ĐỦ NGÂN SÁCH, số bổ sung đề xuất và cách tách ledger. Không sử dụng 6 lượt để thăm dò; không tự phê duyệt ngân sách mới. Chỉ đề xuất local, không cloud.

Điều kiện dừng: lỗi kỹ thuật, candidate DEV/HOLDOUT không đạt, vấn đề nội dung an toàn hoặc hết ngân sách. Không retry/đổi nhãn/tăng token tự động. Khi không đạt: giữ bằng chứng, hoàn nguyên riêng runtime theo snapshot, bảo toàn WIP. Không tạo candidate thứ hai nếu chưa được giao.

Phân biệt kiểm chứng schema/guard, lựa chọn ID, đáp ứng nội dung, hồi quy. Không lấy PASS phần mềm làm PASS nội dung; không coi tập nhỏ đạt cao là bảo đảm mọi diễn đạt.

## 8. Bước 5 — Kiểm tra tài liệu và bàn giao

Kiểm tra tên case/FAQ/file/hash, liên kết source, tổng số và phép tính ngân sách từ dữ liệu thực. Không cần build/test/model cho task đọc và viết tài liệu. Nếu chạy script kiểm tra tài liệu, báo đúng phạm vi.

Đối chiếu hash tracker/runtime trước và sau; chứng minh không đổi. Kiểm tra whitespace/conflict markers cho file mới/sửa kể cả untracked.

Bàn giao tiếng Việt:
1. POS-24 là loại sai gì và bằng chứng.
2. Một phương án khuyến nghị, lý do không chọn các phương án khác.
3. Có cần đổi answer/catalog/rubric hay chỉ selector.
4. Tài liệu đã tạo/sửa và liên kết.
5. Thiết kế thử nghiệm, trần calls, phần cần owner quyết định trước triển khai.
6. Xác nhận model calls mới = 0; runtime không đổi; nội dung AI vẫn PARTIAL.

Hoàn thành hai tài liệu và kết luận thiết kế trong nhiệm vụ này. Không tự chuyển sang thử model dù còn 6 lượt lịch sử.

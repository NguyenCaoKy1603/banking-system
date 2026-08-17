# Risk register

| Mã | Rủi ro | Mức | Tác động | Giảm thiểu / owner | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| R-01 | Chưa có core/BaaS partner và staging thật | Cao | Không thể xác nhận balance, ledger, APK staging hay release candidate | Chốt partner, API, test data và môi trường; Backend/nhóm | Mở |
| R-02 | Phạm vi đề cương rộng hơn scope reference hiện tại | Cao | Dễ tuyên bố hoàn thành khi Card/Savings/Credit/Chatbot/eKYC/QR chưa có | Ghi decision log, chốt P0/P1 và owner trước khi code | Mở |
| R-03 | API banking contract chưa được partner/legal phê duyệt | Cao | Breaking change hoặc sai authorization/retention | Giữ Draft, versioning, examples, review chéo | Mở |
| R-04 | E2E thiết bị thật chưa chạy | Cao | Không biết lỗi native, background/resume, camera, biometric và keyboard | Android/iOS device matrix, Maestro/native run, lưu evidence | Mở |
| R-05 | Dependency `image-size` còn 14 High trong Metro | Cao | CI audit gate fail, không đủ điều kiện pilot | Chờ upstream/đánh giá nâng cấp có kiểm thử; không force fix | Mở |
| R-06 | Chatbot có nguy cơ hallucination hoặc lộ dữ liệu chéo user | Cao | Rủi ro privacy/safety và sai hướng dẫn nghiệp vụ | RAG, read-only tools, policy, ownership test, eval/fallback | Chưa triển khai |
| R-07 | Thiếu APK signing, monitoring, backup/restore và incident runbook thật | Cao | Không thể release/rollback có kiểm soát | Owner vận hành cung cấp môi trường và quy trình | Mở |
| R-08 | Working tree hiện có thay đổi chưa commit từ các phiên trước | Trung bình | Khó chứng minh diff/milestone sạch | Đã tạo checkpoint `079e9d2`; không commit `.env`/artifact | Đã đóng |
| R-09 | Seed/flow native chưa chạy trên thiết bị thật | Cao | Chưa chứng minh camera, biometric, lifecycle, crash-resume và cài trên máy khác | Đã có seed, APK/checksum, Android emulator smoke và transfer pending-resume; cần thiết bị thật, Maestro/device recording và native permission evidence | Mở |
| R-10 | Coverage hiện tập trung domain/validation/storage/navigation, chưa có component test cho screen | Trung bình | Có thể bỏ sót lỗi render/accessibility/native interaction | Giữ threshold cho logic; bổ sung React Native component/device test ở M10 | Mở |
| R-11 | Relational adapter mới chỉ bao phủ core reference, chưa phải production repository toàn domain | Cao | Auth runtime và M6/M7 còn record-level reference; chưa có backup/restore, RLS, role policy hoặc production transaction boundary | Giữ `PostgresRelationalRepository` cho core M0–M4/M8; mở rộng theo domain sau khi có quyết định kiến trúc và review trước tiền thật | Mở |

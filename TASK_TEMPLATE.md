# TASK_TEMPLATE — Banking System

> Đây là mẫu soạn nhiệm vụ, không phải nhiệm vụ đang hoạt động. Không gửi nguyên trạng. Trước khi dùng, tạo bản sao, thay toàn bộ placeholder `{{...}}`, chọn đúng một chế độ và một priority, rồi xóa mọi hướng dẫn hoặc lựa chọn thừa.

Quy ước điền mẫu:

- Quyết định của owner như mode, priority, scope, quyền Git và acceptance criteria phải được điền cụ thể; Codex không tự quyết định thay.
- Sự thật kỹ thuật có thể tự kiểm tra được ghi `HÃY TỰ KIỂM TRA TRONG REPOSITORY`.
- Evidence chưa tồn tại được ghi `CHƯA CÓ`.
- Trường không áp dụng được ghi `KHÔNG ÁP DỤNG — <lý do>`; không bịa dữ liệu môi trường.
- Task gửi thật không được còn `{{...}}`, `TBD` hoặc `TO_BE_FILLED`.

Tôi muốn bạn làm việc với dự án sau:

## 1. Thông tin dự án và quyền truy cập

Tên dự án: Banking System

Vị trí Windows dự kiến: `C:\Projects\banking-system`

Repository root thực tế mà Codex nhìn thấy: {{đường dẫn tuyệt đối sau khi mở/kết nối repository}}

Cách đã cấp quyền truy cập repository: {{ghi rõ Codex đang được mở tại repo root, local project đã được mở, hoặc repository đã được kết nối/đính kèm}}

Trước khi làm, hãy xác nhận có thể đọc repository thật; báo current working directory, Git HEAD và `git status`. Chỉ có đường dẫn trong prompt không được xem là bằng chứng đã có quyền truy cập.

Mục đích: Dự án mobile banking academic/reference dùng dữ liệu tổng hợp và tiền ảo, hướng tới kiểm thử local. Không phải hệ thống xử lý tiền thật, pilot đã xác minh hoặc production-ready.

Tài liệu phải đọc trước:

- `AGENTS.md`
- `PROJECT_CONTEXT.md`
- {{README đúng module: `mobile-app/README.md`, `backend/README.md` hoặc `admin-web/README.md`}}
- {{kế hoạch/contract/evidence cụ thể nếu task yêu cầu}}

## 2. Chế độ làm việc và quyền Git

Chế độ làm việc: {{giữ đúng một mã: `READ_ONLY`, `DIAGNOSE_AND_PLAN`, `IMPLEMENT_AND_VERIFY` hoặc `REVIEW_CURRENT_CHANGES`; xóa các mã không dùng}}

Diễn giải quyền sửa: {{một câu cụ thể; với `READ_ONLY`/`DIAGNOSE_AND_PLAN`, ghi rõ chưa được sửa code}}

Git add/stage: {{Có hoặc Không}}

Commit: {{Có hoặc Không; nếu Có, ghi convention/phạm vi}}

Push: {{Có hoặc Không; nếu Có, ghi remote/branch}}

Merge/rebase/tag: {{ghi riêng hành động được phép hoặc “Không”}}

Quyền ngoài repository:

- Network hoặc dịch vụ bên thứ ba: {{phạm vi được phép hoặc “Không”}}
- Deploy/provision/mua hoặc bật dịch vụ: {{phạm vi được phép hoặc “Không”}}
- Bật worker/scheduler: {{môi trường và điều kiện được phép hoặc “Không”}}
- Destructive database operation: {{chỉ database disposable đã guard hoặc “Không”}}

Không reset, clean, xóa, di chuyển hoặc ghi đè WIP hiện có. Không mở rộng phạm vi chỉ để đồng bộ code/tài liệu.

## 3. Nhiệm vụ lần này

Tên nhiệm vụ: {{một kết quả chính}}

Mục tiêu: {{kết quả thực sự cần đạt}}

Ưu tiên: {{điền đúng một giá trị P0, P1 hoặc P2; đây là quyết định của owner, Codex không tự nâng/hạ}}

Lý do ưu tiên: {{ảnh hưởng tới người dùng, integrity, security hoặc milestone}}

## 4. Hành vi và cách tái hiện

Hành vi hiện tại: {{mô tả quan sát được hoặc “hãy tự kiểm tra trong repository và báo lại trước khi sửa”}}

Hành vi mong muốn: {{mô tả observable behavior, không chỉ nêu tên implementation}}

Cách tái hiện:

1. {{bước 1}}
2. {{bước 2}}
3. {{bước 3}}

Tần suất và điều kiện xảy ra: {{luôn xảy ra, thỉnh thoảng hoặc môi trường cụ thể}}

Thông báo lỗi đã redact: {{mã lỗi/thông báo, không chứa secret hoặc dữ liệu người dùng thật}}

## 5. Môi trường và evidence

Môi trường mục tiêu:

- Windows/WSL: {{phiên bản hoặc “hãy tự kiểm tra”}}
- Node: {{phiên bản hoặc “hãy tự kiểm tra”}}
- Expo/React Native: {{phiên bản hoặc “hãy tự kiểm tra”}}
- Android Emulator hoặc thiết bị: {{model, API level, keyboard/IME, orientation và cấu hình liên quan}}
- PostgreSQL/Docker: {{phiên bản/profile/database disposable hoặc “hãy tự kiểm tra”}}
- Build/commit đang chạy: {{build ID, commit SHA hoặc “hãy tự kiểm tra”}}

Evidence đã redact:

- Loại evidence: {{local, CI, emulator, thiết bị thật hoặc staging}}
- Thời điểm và môi trường thu thập: {{timestamp/timezone + environment}}
- Binding: {{commit SHA + build ID/image digest/migration checksum nếu có}}
- Log: {{đoạn log/path an toàn hoặc “chưa có”}}
- Ảnh/video: {{path/link an toàn hoặc “chưa có”}}
- Test đang fail: {{lệnh + failure summary hoặc “chưa có”}}
- File hoặc commit nghi ngờ: {{path/SHA hoặc “chưa rõ”}}

Nếu thông tin chưa rõ, hãy tự kiểm tra trong repository/môi trường và báo lại bằng chứng trước khi sửa. Có thể scan metadata/chỉ dấu đã redact theo `AGENTS.md`; không in, trích xuất, upload, chia sẻ hoặc đóng gói giá trị nhạy cảm từ raw artifacts chứa password, OTP, token hay credential.

## 6. Phạm vi

Được phép kiểm tra: {{thư mục/file/hệ thống}}

Được phép sửa: {{thư mục/file; viết “Không” nếu chỉ audit}}

Không được thay đổi: {{Backend, schema, API response, CI, dependency, infrastructure, tài liệu hoặc phạm vi khác}}

Dependency/config/API được phép thay đổi: {{ghi rõ từng loại hoặc “Không”}}

## 7. Source of truth và xử lý xung đột

- Database: migration trong `backend/database/` và migration history/checksum.
- API: OpenAPI trong `documents/api/`, runtime validators và route implementation.
- Hành vi Mobile: screen/service/storage/domain code, contract và test thực thi.

Nếu code, migration, OpenAPI, runtime validator, test và tài liệu mâu thuẫn, không tự chọn một phía. Hãy ghi chính xác file/bằng chứng, tác động và quyết định cần owner xác nhận.

## 8. Hoàn thành khi

- {{acceptance criterion quan sát được 1}}
- {{acceptance criterion quan sát được 2}}
- {{test/gate bắt buộc và kết quả mong đợi}}
- Không gây regression ngoài phạm vi.
- Liệt kê chính xác file thay đổi và lệnh đã chạy.
- Phân biệt phần đã kiểm chứng với phần chưa thể kiểm chứng.

## 9. Yêu cầu bàn giao

Hãy trả về bằng tiếng Việt:

1. Hiện trạng đã xác minh và bằng chứng.
2. Nguyên nhân gốc hoặc kết luận review.
3. Những điểm chưa thể xác minh.
4. Kế hoạch hoặc thay đổi đã thực hiện theo từng bước.
5. File tác động và data flow `request -> state -> UI -> error`.
6. Test, quality gate, kiểm tra thủ công và kết quả.
7. Dependency/config/API thay đổi.
8. Remaining risk, blocker và quyết định cần owner xác nhận.

## Checklist trước khi gửi task

- Không còn placeholder `{{...}}`.
- Không còn `TBD` hoặc `TO_BE_FILLED`; trường không áp dụng có lý do rõ ràng.
- Chỉ còn một chế độ làm việc và một priority cụ thể.
- Chỉ giao một kết quả chính.
- Repository đã thực sự được mở/kết nối cho Codex.
- Scope, vùng cấm, từng quyền Git/quyền ngoài repository và acceptance criteria đã rõ.
- Evidence đã được redact; không đính kèm raw credentials/artifacts.

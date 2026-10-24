# AGENTS.md — Banking System

## Phạm vi và ownership

- Đây là workspace cho mobile banking academic/reference implementation hướng tới kiểm thử local; không phải pilot đã được xác minh và không phải hệ thống xử lý tiền thật.
- `mobile-app/` là phạm vi chính của Thành viên 2. Quy tắc chi tiết hơn trong `mobile-app/AGENTS.md` được ưu tiên cho các file Mobile.
- Không tự ý sửa Backend, database schema, Banking Core, API response hoặc CI lõi khi task Mobile không nêu rõ. `backend/` hiện là reference sandbox dùng để kiểm thử contract, không phải production backend.
- Tài liệu kế hoạch, contract và bằng chứng nằm dưới `documents/`. Thay đổi hành vi phải cập nhật tài liệu liên quan nếu tài liệu nằm trong phạm vi được phép sửa. Nếu tài liệu nằm ngoài phạm vi, phải ghi rõ tài liệu cần cập nhật trong bàn giao, không tự mở rộng phạm vi.

## Quy trình bắt buộc

1. Đọc task, `PROJECT_CONTEXT.md`, kế hoạch và file hướng dẫn trong phạm vi trước khi sửa.
2. Kiểm tra HEAD, `git status` và source/evidence liên quan trước khi tin số liệu trong context. `PROJECT_CONTEXT.md` chỉ là snapshot định hướng, không phải task hiện tại và không cao hơn source of truth.
3. Xác định Goal, Context, Constraints, acceptance criteria, file được phép sửa và test bắt buộc.
4. Với API chưa được phê duyệt, chỉ dùng mock/reference contract và ghi rõ trạng thái Draft.
5. Thay đổi nhỏ, giữ diff trong phạm vi task; không thêm dependency hoặc mở rộng kiến trúc nếu chưa ghi quyết định.
6. Sau khi sửa, chạy kiểm tra phù hợp: lint, type-check, test, contract validation và build/export nếu có liên quan.
7. Báo cáo file đã thay đổi, data flow, kiểm tra đã chạy, bằng chứng và phần còn thiếu bằng tiếng Việt.

## Chế độ nhiệm vụ và quyền thay đổi

- Mỗi task phải nêu mục tiêu, ưu tiên, hành vi đúng, phạm vi được phép/không được phép sửa, chế độ làm việc, điều kiện hoàn thành và quyền Git. Đây là quyết định của người giao task; không tự suy đoán.
- Nếu task chưa nêu rõ được phép sửa code, mặc định chỉ đọc, kiểm tra và lập kế hoạch. Có thể chạy lệnh chẩn đoán không làm thay đổi source hoặc hệ thống.
- Mặc định không `git add`, commit, push, merge, rebase, tag, deploy, provision cloud, mua/bật dịch vụ hoặc bật worker. Chỉ thực hiện khi task yêu cầu rõ ràng.
- Trước khi sửa phải kiểm tra `git status`/diff. Không reset, checkout/restore, clean, xóa, di chuyển hoặc ghi đè WIP và file untracked của người khác; giữ nguyên thay đổi ngoài phạm vi.
- Task Mobile không mặc nhiên cấp quyền sửa Backend, database, Admin, CI, infrastructure, observability, performance hoặc release artifact. Nếu cần mở rộng phạm vi, phải báo lý do và chờ quyết định.

## Source of truth và database

- Database: migration forward-only dưới `backend/database/`. Migration mới phải giữ đúng thứ tự và checksum, chạy thành công trên database rỗng và trên đường nâng cấp từ schema trước đó. Không sửa hoặc chạy lại migration đã áp dụng, trừ khi migration runner có contract rõ ràng yêu cầu tính idempotent.
- API: OpenAPI dưới `documents/api/`, runtime validator và route implementation. Tài liệu mô tả không được tự động ưu tiên hơn contract/runtime.
- Khi code, migration, OpenAPI, runtime validator, test và tài liệu mâu thuẫn, không âm thầm chọn một phía: ghi rõ bằng chứng, ảnh hưởng và quyết định cần owner xác nhận.
- Destructive/integration database test chỉ được chạy trên database disposable được guard xác nhận. Tuyệt đối không reset/drop/truncate `banking_preview`, database remote hoặc database không xác minh được ownership.

## Nguyên tắc bảo mật và dữ liệu

- Không ghi password, access/refresh token, OTP, PIN, CVV, device secret hoặc dữ liệu tài chính nhạy cảm vào log, analytics, crash report hay ảnh minh chứng.
- Có thể kiểm tra metadata hoặc chạy scan tự động không in giá trị nhạy cảm khi task security yêu cầu; không trích xuất, upload, chia sẻ, đóng gói hoặc đưa link tới raw `artifacts/`, Maestro command log hay evidence chứa credential. Chỉ báo chỉ dấu/đầu ra đã redact. Nếu phát hiện plaintext secret, dừng phát tán, báo phạm vi và đề xuất quarantine/xóa/rotate; không tự xóa bằng chứng khi chưa được phép.
- Server/API là nguồn sự thật cho balance, fee, interest, credit debt và transaction status; Mobile không optimistic-update số dư.
- Luôn xử lý loading, empty, success, validation, API error, offline/timeout, unauthorized và retry phù hợp.
- Transfer phải giữ idempotency, step-up, trạng thái pending/failed/reversed và cơ chế resume sau crash.
- Không tuyên bố pilot/production readiness khi chưa có staging, core/partner integration, device E2E, monitoring, signing và phê duyệt legal/compliance.
- Phân biệt rõ bằng chứng local, CI, emulator, thiết bị thật và staging; gắn evidence với commit/build/image digest/migration checksum khi có. Release candidate hoặc contract dashboard không đồng nghĩa staging/monitoring đã được xác minh.
- `EXPO_PUBLIC_SANDBOX_HTTP=1` chỉ dành cho sandbox local. Staging/production-like phải fail closed nếu cờ này bật; không hạ HTTPS/cleartext guard để làm build pass.
- Không hạ security, performance, coverage hoặc release threshold để làm gate pass nếu task chưa phê duyệt thay đổi tiêu chí.

## Quality gates hiện có

- Mobile: `npm run lint`, `npm run typecheck`, `npm test`, `npm run validate:openapi`, `npm run export:web`.
- Backend reference: `npm run validate:database`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:critical`; với thay đổi persistence/release còn phải dùng disposable PostgreSQL, worker/integration suite và `npm run test:release` phù hợp.
- Admin Web: lint/type-check, unit test, build và OpenAPI/permission validation phù hợp với thay đổi.
- Release/security: public-env validation, secret scan, dependency audit và release gate theo phạm vi. Không dùng một validator cú pháp thay thế cho runtime/device/staging evidence.
- Cảnh báo dependency High/Critical hoặc test thiết bị chưa chạy phải được ghi trong milestone status, không được che giấu.

## Báo cáo phiên làm việc

Mỗi phiên cần nêu: hành vi đã chạy được; file tạo/sửa; request → state → UI → error; dependency/config/API thay đổi; lệnh kiểm tra và kết quả; cách kiểm tra thủ công; remaining/risk; điểm cần Thành viên 2 giải thích lại.

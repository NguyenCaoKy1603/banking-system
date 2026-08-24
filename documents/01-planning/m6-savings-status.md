# M6 - Trạng thái triển khai tiền gửi sandbox

Ngày kiểm tra gần nhất: 2026-08-24

## Đã triển khai

- Backend có catalog 1/3/6/12 tháng, quote snapshot, ACT/365, làm tròn xuống theo VND và giới hạn 1.000.000-500.000.000 VND.
- Luồng mở khoản có ownership, allowlist/kill switch, MFA OTP/biometric, idempotency một lần, kiểm tra số dư, debit tài khoản thanh toán, double-entry ledger, audit và outbox.
- Có trạng thái PENDING/SUCCEEDED/FAILED/REVERSED; resume opening sau timeout/restart dùng cùng idempotency key.
- Có danh sách/chi tiết tiền gửi, tổng gốc do backend trả về, maturity trả gốc+lãi hoặc tái tục gốc/cả gốc+lãi.
- Có migration draft `002_savings_sandbox.sql`, migration runner chạy tuần tự 001 rồi 002 và validator kiểm tra schema/constraint.
- Mobile có Home → Tiền gửi → danh sách → mở khoản → quote/review → MFA → kết quả → chi tiết; intent lưu quote và idempotency key, không lưu OTP.
- Notification type SAVINGS deep-link tới chi tiết khoản gửi; ô Tiền gửi trên Home đã hoạt động và có nhãn sandbox.
- Mobile OpenAPI DRAFT validator hiện bao phủ 43 path; Maestro có 10 flow syntax-valid gồm flow M6, M7 và offline retry.

## Đã kiểm tra local

- Backend typecheck/build: đạt.
- Backend test suite hiện hành: 88 định nghĩa, 82 pass và 6 test PostgreSQL skip khi không có live database; gồm regression recovery, maturity, reconciliation và transaction security boundary.
- Database source validator: đạt 28 table definitions/invariants ở chế độ static; live check PostgreSQL chưa chạy lại trong phiên 2026-08-24.
- PostgreSQL 16 container tạm: migration 001/002, live schema validator và toàn bộ persistence/concurrency/restart test đều đạt; container đã được dọn sau kiểm thử.
- Mobile lint/typecheck: đạt.
- Mobile Jest: 46 suite, 260 test pass; coverage 85,53% statements và 86,57% branches.
- OpenAPI và Maestro syntax validator: đạt.
- Web export: đạt với placeholder HTTPS; export mặc định HTTP bị chặn đúng production guard.
- Maestro 2.8.0 chạy thành công flow M6 trên Android emulator `Pixel_7_API_35`: login/MFA → quote → review → step-up OTP → mở khoản → danh sách tiền gửi. Artifact: `C:\Users\admin\.maestro\tests\2026-08-16_013045`.

## Giới hạn còn lại

- Backend runtime vẫn là in-memory hoặc snapshot sandbox; repository adapter PostgreSQL thật chưa nối nghiệp vụ savings.
- Chưa có PostgreSQL staging lâu dài, tải/concurrency quy mô lớn hoặc Maestro CLI trên thiết bị thật.
- Đã có bằng chứng E2E M6 trên emulator; thiết bị Android/iOS thật, camera/biometric native và staging vẫn chưa chạy.
- Chưa triển khai rút trước hạn, recurring, nộp thêm, tất toán một phần, FX hoặc core banking thật.
- OpenAPI vẫn là DRAFT và không được dùng cho tiền thật.
## Ghi chú đồng bộ baseline

M6 đã có code, local test và bằng chứng UI trên Android emulator như phần trên; giới hạn “chưa nối repository relational production”, “chưa có thiết bị thật” và “chưa có staging” vẫn là giới hạn thật. Planning snapshot đã được bổ sung để không nhầm M6 với M5 mock hoặc M7 Credit.

## Hardening recovery và lifecycle — 2026-08-24

- Mobile intent dùng `DRAFT_QUOTE`, `SUBMIT_UNKNOWN`, `ACCEPTED_PENDING`, `ACCEPTED_TERMINAL`. Quote hết hạn chỉ được xóa khi còn draft và chưa submit; timeout sau submit giữ nguyên idempotency key để retry/đối soát; terminal được giữ tới khi user xác nhận/rời chủ đích.
- Trước network submit, Mobile ghi `SUBMIT_UNKNOWN`; response domain 4xx đã biết đưa intent về draft và bỏ challenge, còn response có `openingId` chuyển sang accepted phase theo status. Khi đã có ID, restart chỉ gọi status endpoint và không phát OTP/submit lệnh mới.
- Intent được scope theo `userId`; legacy global chỉ migrate cho đúng owner sau khi bản scoped đã ghi thành công. Unit test bao phủ TTL, lifecycle terminal, migration và cross-user isolation. Device/network-fault E2E của thay đổi này còn phải chạy lại.
- Dữ liệu intent malformed hoặc SecureStore read failure không còn bị coi là absent: Mobile giữ fail-closed intent, khóa submit và yêu cầu retry/reconciliation trước khi tạo opening mới.
- `GET /savings/openings/{id}` và list/detail deposits đã chỉ đọc state; operator command settle opening `PENDING` trước khi chạy maturity. Reference đã có catch-up tối đa 240 kỳ, snapshot rate/term hiện hành cho renewal, durable idempotency state và reconciliation hai chiều deposit ↔ liability. Đối soát phát hiện liability mồ côi, deposit thiếu liability và renewal chain sai/mất child, đồng thời hạ health xuống `degraded`. Durable worker, job lease/retry/monitoring cùng PostgreSQL crash/concurrency vẫn là gate mở.
- Các thay đổi trên chỉ harden reference sandbox; OpenAPI/API vẫn DRAFT và không thay thế core savings, staging, thiết bị thật hoặc legal/product approval.

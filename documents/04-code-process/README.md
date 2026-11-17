# 04 — Quy trình phát triển

## Thứ tự đọc

1. Root [AGENTS.md](../../AGENTS.md) — ownership, scope, security, Git và quality gates.
2. [mobile-app/AGENTS.md](../../mobile-app/AGENTS.md) khi task chạm Mobile.
3. [Decision log](../01-planning/decision-log.md) và [ADR architecture](../07-architecture/README.md).
4. Workflow CI dưới .github/workflows và package scripts của thành phần liên quan.

## Quy tắc làm việc

- Kiểm tra HEAD, branch, status và diff trước khi sửa; giữ nguyên mọi WIP ngoài phạm vi task.
- Không mặc định được sửa Backend, migration, API, Admin, CI, release artifact hoặc infrastructure.
- Không git add/commit/push/merge/deploy nếu task không yêu cầu rõ.
- Database migration là forward-only; destructive test chỉ dùng database disposable đã guard xác nhận.
- Chỉ cập nhật docs/evidence cho những hành vi và phạm vi đã được chứng minh.
- Không in hoặc lưu credentials, OTP, PIN, token hay dữ liệu tài chính nhạy cảm vào report/ảnh/log.

## Quality gates

Quality gate tùy khu vực được liệt kê tại [Testing](../05-testing/README.md). Mỗi report phải ghi commit/build, môi trường, lệnh, kết quả, skipped tests và giới hạn bằng chứng.

Trang này không lưu Git checkpoint hiện hành. Dùng Git history/status thực tế thay vì checkpoint SHA cũ được chép trong tài liệu lịch sử.

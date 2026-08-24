# Git workflow và branch strategy — Stage 0

Ngày cập nhật: 2026-08-24

## Trạng thái remote

- Implementation branch: `codex/mini-core-banking-sandbox`.
- Local implementation logic tip sau Stage 0: `edbc9bb`; branch đã có các documentation handoff commit sau đó và đã được xác nhận sạch trước bàn giao.
- Safety branch: `codex/stage0-safety-20260824` tại `e1b7b8c`, không push và chỉ xóa sau khi clone sạch/CI/review được xác minh.
- `origin` hiện có `feature/mobile-authentication` tại `b2eef7d`, `main` cũng đã được tạo từ đúng SHA `b2eef7d`, và đã nhận `codex/mini-core-banking-sandbox`.
- Workspace không có GitHub CLI; branch đã push và có upstream, nhưng chưa tạo được PR hoặc branch protection tự động.

## Quy tắc làm việc

1. Không push trực tiếp vào `main`; mọi thay đổi đi qua PR sau khi maintainer tạo và bảo vệ `main`.
2. Commit nhỏ theo behavior, source và regression test đi cùng nhau; contract đi cùng API behavior.
3. Không commit `.env`, token, password, OTP, device secret, database credential, `node_modules`, build output, coverage hoặc log.
4. Không rewrite 50 commit lịch sử hiện có và không chạy `npm audit fix --force`.
5. Trước commit chạy `git diff --cached --check` và xem lại danh sách staged; sau commit chạy backend/mobile quality gates.
6. Khi phát hiện lỗi trong gate, tạo commit sửa lỗi riêng, không sửa lịch sử đã có.

## Chuỗi commit Stage 0 hiện tại

| Commit | Vai trò |
| --- | --- |
| `556db67` | Ghi baseline và quy tắc EOL |
| `0a9454c` | Backend atomic auth/banking/persistence + API contract |
| `59bc63d` | Mobile auth/session/HTTP recovery |
| `b186be5` | Mobile intent/idempotency primitives |
| `84e6239` | Transfer/Savings/Credit/Fraud recovery flows |
| `82d4457` | QR/KYC/biometric/navigation boundaries |
| `edbc9bb` | Maestro/evidence/report synchronization |

## Việc maintainer cần thực hiện trên GitHub

- Tạo remote `main` từ baseline được review, không dùng local `main` cũ `364018b` nếu chưa đối chiếu — **đã đạt**, `origin/main` hiện ở `b2eef7d`.
- Push implementation branch và đặt upstream — **đã đạt**; remote branch hiện tại là `origin/codex/mini-core-banking-sandbox`.
- Tạo PR vào `main` (link tạo PR: `https://github.com/NguyenCaoKy1603/banking-system/compare/main...codex/mini-core-banking-sandbox`), bật required Backend/Mobile checks, review tối thiểu một người và cấm direct push. Chưa hoàn tất vì workspace không có GitHub CLI và phiên GitHub trên browser chưa đăng nhập.
- Sau khi CI xanh, clone SHA PR vào thư mục sạch, chạy lại `npm ci`, migration PostgreSQL và toàn bộ gate.

## Kết quả clone sạch Stage 0

- Đã clone tại `C:\Users\admin\AppData\Local\Temp\banking-system-stage0-clone-20260824-105231`, đúng implementation branch, upstream và worktree sạch.
- Backend/Mobile gate trong clone khớp kết quả local; PostgreSQL live/relational vẫn bị giới hạn bởi Docker daemon không chạy, Mobile audit local đã về 0 vulnerability sau bản vá Metro `0.84.5`; remote CI vẫn cần xác nhận.

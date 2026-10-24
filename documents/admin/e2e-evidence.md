# Admin P0 — bằng chứng E2E lịch sử

> Cập nhật 2026-10-11: các bộ kiểm thử E2E của Admin Web, Backend API và Mobile Maestro cùng runner/fixture chỉ phục vụ E2E đã được gỡ. Nội dung bên dưới là bằng chứng lịch sử, không phải quality gate hiện hành và không thể chạy lại từ checkout hiện tại. Các unit/integration test, gồm test tích hợp database, vẫn được giữ.

## Browser E2E (lịch sử)

Trước khi gỡ, Playwright fixture khởi chạy Admin API in-memory và Vite Admin Web với dữ liệu synthetic.

Flow đã chạy trong browser:

- Operations đăng nhập bằng password-only sau khi TOTP đã được xác minh lúc tạo tài khoản, rồi tạo funding request. Admin vẫn đăng nhập password + TOTP.
- ADMIN mở Approval Inbox, step-up MFA và approve; account hiển thị `102.500 VND` từ `100.000 VND`.
- OPERATIONS account thứ hai tạo account block; ADMIN approve.
- OPERATIONS claim/recommend KYC và Credit; ADMIN approve.
- OPERATIONS cancel pending transfer; ADMIN approve.
- OPERATIONS claim, note và request fraud resolution; ADMIN approve.
- OPERATIONS request Outbox `DEAD` requeue và Job `DEAD` retry; ADMIN approve.
- ADMIN tạo staff disable request; ADMIN approve; session OPERATIONS bị thu hồi khi reload.

## API E2E (Backend, lịch sử — suite đã gỡ)

- Flow HTTP lịch sử đã kiểm tra Operations/Admin login, step-up TOTP, CSRF, phân tách quyền, self-approval, funding, lock, KYC/Credit, transfer, fraud, outbox và staff disable. Suite và lệnh chạy đã bị gỡ ngày 2026-10-11.

## Backend integration tests (vẫn giữ)

- `ADMIN_DATABASE_URL=... npm run test:admin:database`: bằng chứng trước đây gồm typed funding atomicity, concurrent approval decision/one mutation, funding/transfer reversal, append-only replay, ledger/outbox fault rollback, sanitized fraud-note persistence, account/customer lock restart persistence và canonical outbox requeue cạnh tranh với worker trên PostgreSQL preview. Đây là test tích hợp database, không phải E2E.
- `npm run test:admin` với PostgreSQL: bằng chứng trước đây gồm RBAC/ABAC, maker-checker approve/reject/idempotent receipt, auth/MFA và database workflows.
- `npx tsx --test src/tests/adminAuth.test.ts`: 3 pass; Admin TOTP login, Operations password-only login after enrollment, Admin-only step-up, refresh-token rotation/reuse detection and login brute-force limit.
- `npm run test:admin:concurrency`: hai execution cùng action chỉ có một mutation thành công.
- Database migration rehearsal: chạy `npm run db:migrate` từ database rỗng, chạy lại lần hai để kiểm tra checksum/idempotency, sau đó chạy các validator database/admin/outbox/relational.
- Bằng chứng invitation trước đây thuộc luồng staff invite đã nghỉ hưu, không còn đại diện cho hành vi Admin Web hiện tại. Bootstrap Admin đầu tiên vẫn dùng activation; `invitation-capture` chỉ chạy khi bật Compose profile `bootstrap`. Tạo Operations hiện được kiểm tra bằng luồng tạo trực tiếp, không gửi email và không tạo approval.
- Security/dependency gates: backend `npm audit --omit=dev --audit-level=high` và Admin Web audit đều không có lỗ hổng High/Critical; forbidden operator-key scan không còn occurrence trong runtime/config/docs.
- DAST preview: OWASP ZAP baseline `admin-web` và `admin-api` đều `FAIL-NEW: 0`; Web có 4 cảnh báo cấu hình thấp (no-store/cache policy, CSP `style-src 'unsafe-inline'`, COEP và ứng dụng hiện đại), API có 1 cảnh báo `Non-Storable Content` trên 404. Không có cảnh báo High/Critical; báo cáo tạm được giữ ngoài repo.

Đây là bằng chứng reference/synthetic từ các lần chạy trước. Hiện checkout không còn bộ test E2E chạy được; provider email/invite HTTPS thật cho staging, managed credentials và chaos/fault-injection production vẫn chưa được chứng minh.

# Admin P0 — bằng chứng E2E

## Browser E2E

Playwright fixture `admin-web/e2e/fixture-server.mjs` khởi chạy Admin API in-memory trên cổng ngẫu nhiên và Vite Admin Web ở `127.0.0.1:5174`. Fixture chỉ chứa customer/account/application/transfer/fraud/outbox/job synthetic và bốn staff role; không ghi token, password hoặc TOTP vào output.

Lệnh chạy:

```powershell
cd C:\Projects\banking-system\backend
npm run build
cd ..\admin-web
npx playwright install chromium
npm run test:e2e
```

Flow đã chạy trong browser:

- Operations đăng nhập password + TOTP, tạo funding request.
- Control mở Approval Inbox, step-up MFA và approve; account hiển thị `102.500 VND` từ `100.000 VND`.
- Support tạo account block; Control approve.
- Operations claim/recommend KYC và Credit; Control approve.
- Operations cancel pending transfer; Control approve.
- Operations claim, note và request fraud resolution; Control approve.
- Operations request Outbox `DEAD` requeue và Job `DEAD` retry; Control approve.
- ADMIN tạo staff disable request; Control approve; session Support bị thu hồi khi reload.

## API/Database E2E

- `npm run test:admin:e2e`: login/MFA, CSRF, realm isolation, self-approval, funding, lock, KYC/Credit, transfer, fraud, outbox và staff disable.
- `ADMIN_DATABASE_URL=... npm run test:admin:database`: 8 pass; typed funding atomicity, concurrent checker decision/one mutation, funding/transfer reversal, append-only replay, ledger/outbox fault rollback, sanitized fraud-note persistence, account/customer lock restart persistence và canonical outbox requeue cạnh tranh với worker trên PostgreSQL preview.
- `npm run test:admin` với PostgreSQL: 21 pass; RBAC/ABAC, maker-checker approve/reject/idempotent receipt, auth/MFA, HTTP E2E và database workflows.
- `npx tsx --test src/tests/adminAuth.test.ts`: 2 pass; refresh-token rotation/reuse detection và login brute-force limit.
- `npm run test:admin:concurrency`: hai execution cùng action chỉ có một mutation thành công.
- Database migration rehearsal: chạy `npm run db:migrate` từ database rỗng, chạy lại lần hai để kiểm tra checksum/idempotency, sau đó chạy các validator database/admin/outbox/relational.
- Security/dependency gates: backend `npm audit --omit=dev --audit-level=high` và Admin Web audit đều không có lỗ hổng High/Critical; forbidden operator-key scan không còn occurrence trong runtime/config/docs.
- DAST preview: OWASP ZAP baseline `admin-web` và `admin-api` đều `FAIL-NEW: 0`; Web có 4 cảnh báo cấu hình thấp (no-store/cache policy, CSP `style-src 'unsafe-inline'`, COEP và ứng dụng hiện đại), API có 1 cảnh báo `Non-Storable Content` trên 404. Không có cảnh báo High/Critical; báo cáo tạm được giữ ngoài repo.

Đây là bằng chứng reference/synthetic. Chưa có device E2E native (máy này không có `adb`, emulator hoặc Maestro), provider email/invite thật hoặc chaos/fault-injection production.

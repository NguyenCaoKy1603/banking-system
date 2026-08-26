# Admin API/Web runbook (local reference)

## Database

```powershell
cd C:\Projects\banking-system\backend
$env:DATABASE_URL = "postgresql://banking:<local-test-password>@localhost:5432/banking_test"
npm run db:migrate
npm run validate:admin-schema
```

Migration `022_admin_policy_alignment.sql` tách riêng quyền tạo yêu cầu mở khóa customer khỏi quyền khóa; không sửa các migration đã áp dụng.

## Bootstrap

Bootstrap không in hoặc lưu token mời. Token được tạo trong memory, chỉ gửi
qua gateway email đã cấu hình, còn PostgreSQL chỉ giữ `token_hash`. Hai địa
chỉ phải khác nhau; invitation có thời hạn tối đa 24 giờ và chỉ dùng một lần.
Gateway lỗi giữa chừng sẽ đốt các invitation đã tạo và giải phóng reservation
để chạy lại an toàn với cùng địa chỉ.

```powershell
$env:ADMIN_BOOTSTRAP_ADMIN_EMAIL = "admin@example.test"
$env:ADMIN_BOOTSTRAP_CONTROL_EMAIL = "control@example.test"
$env:ADMIN_INVITATION_ACTIVATION_URL = "http://127.0.0.1:5173/admin/activate"
$env:ADMIN_INVITATION_PROVIDER_URL = "http://127.0.0.1:8025/invitations"
$env:ADMIN_INVITATION_ALLOWED_DOMAINS = "example.test"
npm run admin:bootstrap
```

`ADMIN_INVITATION_PROVIDER_URL` ở local phải trỏ tới loopback/Mailpit/MailHog
hoặc HTTP capture service tương đương. Staging/production-like bắt buộc dùng
HTTPS, allowlist domain kiểm soát và credential từ Secret Manager qua
`email-provider-token` (không dùng `ADMIN_INVITATION_PROVIDER_TOKEN` trong
deployment). CLI chỉ in invitation IDs, role và thời hạn; không in
token/password/TOTP. Gateway không được ghi request body, token vào log,
metric, audit, outbox hay artifact.

Sau khi người nhận mở activation URL, họ đặt password và enroll TOTP. Activation
ghi audit event `STAFF_INVITE_ACTIVATED`; login tiếp theo luôn yêu cầu TOTP.
Nếu provider trả timeout/429/5xx, adapter retry hữu hạn với backoff; lỗi cuối
cùng làm bootstrap fail closed và không để lại invite có thể dùng lại.

## Start

```powershell
$env:ADMIN_PORT = "5001"
npm run admin:dev
```

Admin API bind `127.0.0.1`. Health: `GET http://127.0.0.1:5001/livez` và `/readyz`. Admin Web dùng `http://127.0.0.1:5173` và `credentials: include`.

Khi chạy Admin Web trực tiếp bằng Vite, cấu hình proxy ở development:

```powershell
cd C:\Projects\banking-system\admin-web
$env:ADMIN_API_UPSTREAM = "http://127.0.0.1:5001"
npm run dev
```

Browser luôn gọi `/api/v1`; không đặt `VITE_ADMIN_API_URL` và không gọi trực
tiếp Admin API từ JavaScript.

Với Docker Compose, Admin API bind `0.0.0.0` bên trong container để nhận traffic từ reverse proxy, nhưng chỉ publish ra `127.0.0.1:5001`; Admin Web publish ở `127.0.0.1:5173`. Compose cấp `ADMIN_WEB_ENV=preview` và `ADMIN_API_UPSTREAM=http://admin-api:5001` lúc runtime:

```powershell
docker compose --env-file .env.compose up -d admin-api admin-web
docker compose --env-file .env.compose ps
```

## Quality/E2E

```powershell
cd C:\Projects\banking-system\backend
npm run build
npm run validate:admin-schema
npm run validate:admin-authz
npm run test:admin:e2e
# Dùng credential local của container preview; không ghi password thật vào tài liệu/log.
$env:ADMIN_DATABASE_URL = "postgresql://banking:<local-preview-password>@localhost:5433/banking_preview"
npm run test:admin:database

cd ..\admin-web
npm ci
npx playwright install chromium
npm run lint
npm test
npm run build
npm run audit
npm run test:e2e
```

DAST preview (OWASP ZAP baseline, không ghi report vào repo):

```powershell
docker run --rm --network host zaproxy/zap-stable zap-baseline.py -t http://127.0.0.1:5173 -I -m 3
docker run --rm --network host zaproxy/zap-stable zap-baseline.py -t http://127.0.0.1:5001 -I -m 3
```

Gate chấp nhận `FAIL-NEW: 0`; các cảnh báo cấu hình thấp phải được ghi vào `documents/admin/e2e-evidence.md`. Native device E2E cần emulator/thiết bị và Maestro riêng, không suy ra từ Playwright.

Playwright dùng fixture synthetic/in-memory; không dùng bootstrap token hoặc dữ liệu khách hàng thật.

## Hành vi an toàn

- Mọi POST/DELETE (trừ login, MFA verify, activate, refresh) phải có `X-CSRF-Token` và command phải có `Idempotency-Key`.
- Không dùng localStorage cho token; CSRF token chỉ giữ trong memory của Admin Web và được cấp lại qua login/refresh. Không copy token/secret vào ticket hoặc ảnh.
- Không có nút đặt transfer thành `SUCCEEDED`, sửa payload Outbox hoặc chạy shell/SQL từ UI.

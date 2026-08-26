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

```powershell
$env:ADMIN_BOOTSTRAP_ADMIN_EMAIL = "admin@example.test"
$env:ADMIN_BOOTSTRAP_CONTROL_EMAIL = "control@example.test"
npm run admin:bootstrap
```

CLI chỉ in invitation IDs và thời hạn, không in token/password/TOTP. Token phải được bàn giao qua kênh được phê duyệt; không lưu vào repo/log.

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

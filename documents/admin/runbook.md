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

Bootstrap chỉ cần email của một tài khoản ADMIN khởi tạo. Token mời chỉ tồn tại
trong memory để gửi qua gateway email đã cấu hình, còn PostgreSQL chỉ giữ
`token_hash`. Invitation có thời hạn tối đa 24 giờ và chỉ dùng một lần.
Gateway lỗi giữa chừng sẽ đốt các invitation đã tạo và giải phóng reservation
để chạy lại an toàn với cùng địa chỉ.

```powershell
$env:ADMIN_BOOTSTRAP_ADMIN_EMAIL = "admin@example.test"
$env:ADMIN_INVITATION_ACTIVATION_URL = "http://127.0.0.1:5173/admin/activate"
$env:ADMIN_INVITATION_PROVIDER_URL = "http://127.0.0.1:8025/invitations"
$env:ADMIN_INVITATION_ALLOWED_DOMAINS = "example.test"
npm run admin:bootstrap
```

`ADMIN_INVITATION_PROVIDER_URL` ở local phải trỏ tới loopback/Mailpit/MailHog
hoặc HTTP capture service tương đương. Compose local của repo đã có service
`invitation-capture` tại `http://127.0.0.1:8025/inbox`; service chỉ giữ thư
trong memory và xóa hộp thư khi restart, không gửi ra Internet. Service không
chạy cùng stack mặc định; bật riêng khi bootstrap bằng lệnh
`docker compose --profile bootstrap up -d invitation-capture`. Staging và
production-like bắt buộc dùng HTTPS, allowlist domain kiểm soát và credential
từ Secret Manager qua `email-provider-token` (không dùng
`ADMIN_INVITATION_PROVIDER_TOKEN` trong deployment). CLI chỉ in invitation IDs,
role và thời hạn; không in token/password/TOTP. Provider không được ghi request
body, token vào log, metric, audit, outbox hay artifact.

Activation link ở trên chỉ dùng để khởi tạo tài khoản ADMIN đầu tiên. Token
plaintext chỉ đi qua delivery request trong memory; PostgreSQL chỉ giữ
`token_hash`. Liên kết kích hoạt dùng một lần và trang web xóa token khỏi URL
sau khi kích hoạt thành công. Login tiếp theo luôn yêu cầu TOTP.
Nếu provider trả timeout/429/5xx, adapter retry hữu hạn với backoff. Với
`admin:bootstrap`, lỗi cuối cùng gọi `abortBootstrap` để burn invitation và
giải phóng reservation. Tạo tài khoản OPERATIONS không dùng email invite; thao
tác đó được thực hiện trực tiếp trong Admin Web.

### Tạo trực tiếp tài khoản Operations

Trong Admin Web, mở **Staff / Roles** và nhập email, mã nhân viên, tên hiển thị,
mật khẩu ban đầu. Bấm **Tạo khóa MFA**, thêm khóa hiển thị vào ứng dụng
Authenticator bằng cách nhập khóa thủ công, rồi nhập mã 6 số mới nhất và bấm
**Tạo tài khoản Operations**. Backend kiểm tra TOTP và ghi tài khoản ACTIVE,
password hash, khóa MFA đã mã hóa, role `OPERATIONS` và audit trong cùng một
transaction. Không có email mời hay bước Approval Inbox. Lưu mật khẩu để bàn
giao an toàn; giao diện không gửi password/MFA qua email và chỉ giữ khóa MFA
trong bộ nhớ trang trước khi lưu.

## Start

```powershell
$env:ADMIN_PORT = "5001"
npm run admin:dev
```

Admin API bind `127.0.0.1`. Health: `GET http://127.0.0.1:5001/livez` và
`/readyz`; readiness kiểm tra Admin API và persistence, không phụ thuộc vào
provider invitation bootstrap.
Admin Web dùng `http://127.0.0.1:5173` và `credentials: include`.

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

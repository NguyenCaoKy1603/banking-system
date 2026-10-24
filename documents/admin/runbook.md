# Admin API/Web runbook (local reference)

## Database

```powershell
cd C:\Projects\banking-system\backend
# Chạy với Docker preview database (port 5433):
$env:DATABASE_URL = "postgresql://banking:stage1-local-password@127.0.0.1:5433/banking_preview"
# Hoặc chạy với disposable test database (port 5432 nếu có PostgreSQL local riêng):
# $env:DATABASE_URL = "postgresql://banking:<local-test-password>@localhost:5432/banking_test"
npm run db:migrate
npm run validate:admin-schema
```

Migration `022_admin_policy_alignment.sql` tách riêng quyền tạo yêu cầu mở khóa customer khỏi quyền khóa; không sửa các migration đã áp dụng.

## Quản lý Nhân viên & Khởi tạo Admin (Hiện trạng mới nhất)

> **Cập nhật hiện trạng:** 
> - Toàn bộ các biến `ADMIN_INVITATION_*` và dịch vụ `invitation-capture` (cổng 8025) đã được **loại bỏ khỏi `.env.compose` và `.env.compose.example`** nhằm đơn giản hóa vận hành.
> - Luồng mời nhân viên cũ và quy trình phê duyệt thư mời (Staff Invite Approval) đã được **chính thức bãi bỏ** theo migration `043_retire_staff_invite_approval.sql`.
> - Hệ thống hiện hành vận hành với **hai vai trò duy nhất**: `ADMIN` và `OPERATIONS` (theo migration `041_admin_two_roles.sql`).

### 1. Tài khoản Admin khởi tạo (Bootstrap Admin)

- Trong môi trường local preview, database PostgreSQL đã được nạp sẵn tài khoản Admin mặc định (`admin@example.test` / hiển thị: *Local Admin*).
- Khi triển khai lên môi trường mới (VPS) hoặc khi cần reset Admin, hệ thống không còn phụ thuộc vào container `invitation-capture` cổng 8025. Tài khoản Super Admin đầu tiên được nạp trực tiếp qua lệnh SQL nội bộ hoặc script provisioning an toàn mà không cần mở cổng hòm thư tạm.

### 2. Tạo trực tiếp tài khoản Operations (Không dùng email mời)

Sau khi đăng nhập bằng tài khoản `ADMIN`, mọi tài khoản nhân viên vận hành (`OPERATIONS`) đều được tạo **trực tiếp** ngay trên giao diện Web Admin:

1. Trong Admin Web (`http://127.0.0.1:5173`), mở menu **Staff / Roles** (`/staff`).
2. Điền thông tin nhân viên: Email, Mã nhân viên, Tên hiển thị, Mật khẩu ban đầu.
3. Bấm **Tạo khóa MFA**: Hệ thống sinh ngay mã khóa bí mật TOTP (Base32) trực tiếp trên trình duyệt.
4. Nhập khóa này vào ứng dụng Authenticator (Google Authenticator / Authy) của nhân viên để lấy mã 6 số.
5. Nhập mã 6 số và bấm **Tạo tài khoản Operations**.

Backend kiểm tra mã TOTP và ghi nhận tài khoản ở trạng thái `ACTIVE`, băm mật khẩu, mã hóa khóa MFA bằng `BANKING_MFA_ENCRYPTION_KEY`, gán role `OPERATIONS` và ghi log audit trong cùng một database transaction. Hoàn toàn không qua bước gửi email mời hay duyệt thư mời (Approval Inbox).


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

### 3. Cấu hình Chế độ Thực thi Trực tiếp (Direct Execution Mode)

Biến môi trường `ADMIN_DIRECT_EXECUTION` (khai báo trong `.env.compose` và backend runtime) điều khiển cách thức xử lý lệnh nghiệp vụ của Admin API:
- `ADMIN_DIRECT_EXECUTION=true` (Mặc định trong preview local): Bật chế độ **1 chạm**, các lệnh Cấp tiền, Hoàn tiền, Khóa/Mở khóa tài khoản & khách hàng, Phê duyệt Hồ sơ định danh & Tín dụng được thực thi trực tiếp ngay lập tức vào Core Banking và cập nhật số dư/trạng thái tức thì cho Mobile App.
- `ADMIN_DIRECT_EXECUTION=false`: Bật chế độ **Maker-Checker 2 bước chuẩn**, mọi lệnh tạo ra sẽ ở trạng thái `PENDING_APPROVAL` và cần tài khoản Admin mở Approval Inbox để duyệt kèm xác thực TOTP Step-up.

## Quality gates

```powershell
cd C:\Projects\banking-system\backend
npm run build
npm run validate:admin-schema
npm run validate:admin-authz
# Dùng credential local của container preview; không ghi password thật vào tài liệu/log.
$env:ADMIN_DATABASE_URL = "postgresql://banking:<local-preview-password>@localhost:5433/banking_preview"
npm run test:admin:database

cd ..\admin-web
npm ci
npm run lint
npm test
npm run build
npm run audit
```

DAST preview (OWASP ZAP baseline, không ghi report vào repo):

```powershell
docker run --rm --network host zaproxy/zap-stable zap-baseline.py -t http://127.0.0.1:5173 -I -m 3
docker run --rm --network host zaproxy/zap-stable zap-baseline.py -t http://127.0.0.1:5001 -I -m 3
```

Gate DAST chấp nhận `FAIL-NEW: 0`. Các bộ E2E của dự án đã được gỡ theo yêu cầu ngày 2026-10-11; checklist thủ công và unit/integration test hiện có vẫn dùng được.

## Hành vi an toàn

- Mọi POST/DELETE (trừ login, MFA verify, activate, refresh) phải có `X-CSRF-Token` và command phải có `Idempotency-Key`.
- Không dùng localStorage cho token; CSRF token chỉ giữ trong memory của Admin Web và được cấp lại qua login/refresh. Không copy token/secret vào ticket hoặc ảnh.
- Không có nút đặt transfer thành `SUCCEEDED`, sửa payload Outbox hoặc chạy shell/SQL từ UI.

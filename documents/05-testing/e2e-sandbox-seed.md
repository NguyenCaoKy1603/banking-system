# E2E sandbox seed

> Cập nhật 2026-08-25: seed dùng registration confirmation code từ provider test và TOTP fixture cho login/transaction step-up. Nếu chưa có `E2E_BENEFICIARY_ACCOUNT`, cần cấp `E2E_RECIPIENT_PASSWORD` (kèm email/phone tùy chọn) để seed tự tạo người nhận; không còn số tài khoản mặc định giả.

`backend` có lệnh `npm run seed:e2e` để chuẩn bị dữ liệu cho các flow Maestro mà không phải tự lấy ID bằng tay.

Khi cần làm sạch dữ liệu demo trên PostgreSQL local, dùng lệnh reset có xác nhận rõ ràng:

```powershell
$env:E2E_RESET_CONFIRM = "RESET_REFERENCE_SANDBOX"
npm run reset:sandbox
npm run seed:e2e
```

Lệnh reset chỉ chạy khi `BANKING_ENV` không phải `production`, database là PostgreSQL local
(`localhost`, `127.0.0.1` hoặc `::1`) và tên database kết thúc bằng `test`, `sandbox` hoặc `e2e`.
Lệnh không xóa migration schema; nó chỉ xóa dữ liệu reference sandbox để tạo lại bộ dữ liệu E2E.
Đã diễn tập trên một PostgreSQL database tạm: migration thành công, bản ghi giả được xóa về 0 và database tạm được dọn sau kiểm tra.

## Chạy lại từ trạng thái sạch

Reference backend mặc định dùng PostgreSQL relational store. Dừng và khởi động lại server không reset dữ liệu; muốn làm sạch hãy dùng database disposable riêng hoặc chạy seed với user/test data mới. Chế độ `BANKING_STORAGE=in-memory` chỉ dành cho test nhanh.

```powershell
cd backend
$env:PORT = "5000"
$env:BANKING_MFA_REQUIRED = "1"
$env:BANKING_MFA_METHODS = "TOTP"
$env:BANKING_OTP_PEPPER = "base64:<32-byte-test-pepper>"
$env:BANKING_MFA_ENCRYPTION_KEY = "base64:<32-byte-test-encryption-key>"
$env:BANKING_SETTLE_IMMEDIATELY = "1"
npm start
```

Ở terminal thứ hai, đặt password ngoài source rồi seed:

```powershell
cd backend
$env:E2E_BASE_URL = "http://127.0.0.1:5000/api/v1"
$env:E2E_PASSWORD = Read-Host "E2E password"
$env:E2E_REGISTRATION_CODE = Read-Host "Email confirmation code from test provider"
$env:E2E_TOTP_SECRET = Read-Host "TOTP fixture secret (base32)"
$env:DATABASE_URL = "postgresql://banking:<local-password>@127.0.0.1:5433/banking_preview"
npm run seed:e2e
```

Seed cấp số dư bằng transaction fixture trực tiếp trên PostgreSQL disposable,
không qua public funding endpoint và không cần operator key. Nếu tài khoản đã
được cấp tiền trước qua Admin four-eyes, bỏ `DATABASE_URL` và đặt
`E2E_FUNDING_PRESEEDED=1`.

Lệnh seed sẽ đăng ký hoặc đăng nhập `tester@example.com`, xác thực email bằng code do provider test cấp, yêu cầu tài khoản đã enroll TOTP, lấy account, tạo beneficiary nếu cần, tạo một transfer để có notification và in JSON/PowerShell variables không nhạy cảm gồm `BENEFICIARY_ID`, `QR_PAYLOAD`, `SEEDED_TRANSFER_ID` và các biến Maestro. Password/email code/TOTP secret không được in ra stdout; giữ chúng trong environment của caller. Seed tự chờ rollover time-step khi cần để không vi phạm replay protection.

## Ánh xạ biến cho Maestro

Seed chỉ xuất biến không nhạy cảm. Ánh xạ trực tiếp sang flow Maestro như sau:

| Seed output | Maestro variable | Ghi chú |
| --- | --- | --- |
| `APP_ID` | `APP_ID` | Package của preview build |
| `TEST_EMAIL` | `TEST_EMAIL` | Email user sandbox |
| `BENEFICIARY_ID` | `BENEFICIARY_ID` | Dùng cho flow transfer |
| `TRANSFER_AMOUNT_MINOR` | `TRANSFER_AMOUNT_MINOR` | Minor unit, ví dụ `100000` |
| `QR_PAYLOAD` | `QR_PAYLOAD` | Payload JSON cho manual QR fallback |
| `E2E_PASSWORD` | `TEST_PASSWORD` | Không xuất; chỉ copy trong shell/secret |
| `E2E_TOTP_SECRET` | `TOTP_SECRET` | Không xuất; chỉ dùng trong fixture disposable |

Ví dụ sau seed, giữ secret ngoài output và chuẩn bị biến cho Maestro:

```powershell
$env:TEST_PASSWORD = $env:E2E_PASSWORD
$env:TOTP_SECRET = $env:E2E_TOTP_SECRET
maestro test `
  --env APP_ID=$env:APP_ID `
  --env TEST_EMAIL=$env:TEST_EMAIL `
  --env TEST_PASSWORD=$env:TEST_PASSWORD `
  --env TOTP_SECRET=$env:TOTP_SECRET `
  --env BENEFICIARY_ID=$env:BENEFICIARY_ID `
  --env TRANSFER_AMOUNT_MINOR=$env:TRANSFER_AMOUNT_MINOR `
  --env QR_PAYLOAD=$env:QR_PAYLOAD `
  mobile-app/e2e/maestro
```

## Scenario pending

Khởi động server với `$env:BANKING_SETTLE_IMMEDIATELY = "0"` trước khi seed. Transfer seed sẽ ở `PENDING`, giúp chạy flow retry/recovery. Các trạng thái `FAILED` và `REVERSED` được tạo qua backend test transition; không dùng dữ liệu production.

## Quy tắc dữ liệu

- `E2E_PASSWORD` chỉ tồn tại trong shell/secret của môi trường test, không commit vào repository.
- Seed output chỉ dùng cho local/preview sandbox disposable; không dùng TOTP fixture hoặc account ID này cho staging/production.
- Với PostgreSQL relational, không reset bằng restart; dùng database disposable riêng hoặc user seed mới. Restart chỉ kiểm tra dữ liệu có còn sau khi backend khởi động lại.

## M7 credit

Seed output them `CREDIT_CARD_ID`, `CREDIT_ACCOUNT_ID`, `CREDIT_STATEMENT_ID` va `CREDIT_MINIMUM_AMOUNT_MINOR` de doi chieu sandbox. Flow `critical-credit.yaml` dung TOTP fixture cho buoc step-up thanh toan; flow `critical-credit-pending-resume.yaml` can server voi `$env:BANKING_SETTLE_CREDIT_PAYMENTS_IMMEDIATELY = "0"` de tao PENDING truoc khi stop/launch app. Cac secret van chi nam trong environment cua nguoi chay.

Để kiểm tra sao kê quá hạn và thông báo deep-link, khởi động một server in-memory sạch với `$env:BANKING_SANDBOX_CREDIT_OVERDUE = "1"`, rồi chạy seed bằng user riêng. Khi seed gọi `/cards`, statement worker sẽ chuyển statement sang `OVERDUE` và phát một notification `CREDIT` trỏ tới `cardId`; gọi lại endpoint không phát thêm notification. Chỉ dùng biến này cho phiên bằng chứng riêng, sau đó khởi động lại backend với giá trị `0` hoặc bỏ biến.

## Xác nhận seed ngày 2026-08-15

Seed đã chạy thành công trên server sandbox tạm thời với MFA bắt buộc: tạo transfer `SUCCEEDED`, savings `SUCCEEDED` và card/statement Credit. Stdout chỉ chứa ID, trạng thái và payload QR masked; password/OTP không được in ra.

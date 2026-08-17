# E2E sandbox seed

> Cập nhật 2026-08-17: seed hiện dùng registration hai bước, Sandbox Funding operator, recipient account thật và credit application → activation. Nếu chưa có `E2E_BENEFICIARY_ACCOUNT`, cần cấp `E2E_RECIPIENT_PASSWORD` (kèm email/phone tùy chọn) để seed tự tạo người nhận; không còn số tài khoản mặc định giả.

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

## Chạy lại từ trạng thái sạch

Reference backend mặc định dùng PostgreSQL relational store. Dừng và khởi động lại server không reset dữ liệu; muốn làm sạch hãy dùng database disposable riêng hoặc chạy seed với user/test data mới. Chế độ `BANKING_STORAGE=in-memory` chỉ dành cho test nhanh.

```powershell
cd backend
$env:PORT = "5000"
$env:BANKING_MFA_REQUIRED = "1"
$env:BANKING_SANDBOX_MFA_OTP = Read-Host "Sandbox MFA OTP"
$env:BANKING_SANDBOX_OTP = Read-Host "Sandbox transfer OTP"
$env:BANKING_SETTLE_IMMEDIATELY = "1"
npm start
```

Ở terminal thứ hai, đặt password ngoài source rồi seed:

```powershell
cd backend
$env:E2E_BASE_URL = "http://127.0.0.1:5000/api/v1"
$env:E2E_PASSWORD = Read-Host "E2E password"
$env:E2E_MFA_OTP = $env:BANKING_SANDBOX_MFA_OTP
$env:E2E_TRANSFER_OTP = $env:BANKING_SANDBOX_OTP
npm run seed:e2e
```

Lệnh seed sẽ đăng ký hoặc đăng nhập `tester@example.com`, xác thực MFA nếu server yêu cầu, lấy account, tạo beneficiary nếu cần, tạo một transfer để có notification và in JSON/PowerShell variables không nhạy cảm gồm `BENEFICIARY_ID`, `QR_PAYLOAD`, `SEEDED_TRANSFER_ID` và các biến Maestro. Password/OTP không được in ra stdout; giữ chúng trong environment của caller.

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
| `E2E_MFA_OTP` | `MFA_OTP` | Không xuất; chỉ copy trong shell/secret |
| `E2E_TRANSFER_OTP` | `TRANSFER_OTP` | Không xuất; chỉ copy trong shell/secret |

Ví dụ sau seed, giữ secret ngoài output và chuẩn bị biến cho Maestro:

```powershell
$env:TEST_PASSWORD = $env:E2E_PASSWORD
$env:MFA_OTP = $env:E2E_MFA_OTP
$env:TRANSFER_OTP = $env:E2E_TRANSFER_OTP
maestro test `
  --env APP_ID=$env:APP_ID `
  --env TEST_EMAIL=$env:TEST_EMAIL `
  --env TEST_PASSWORD=$env:TEST_PASSWORD `
  --env MFA_OTP=$env:MFA_OTP `
  --env BENEFICIARY_ID=$env:BENEFICIARY_ID `
  --env TRANSFER_AMOUNT_MINOR=$env:TRANSFER_AMOUNT_MINOR `
  --env TRANSFER_OTP=$env:TRANSFER_OTP `
  --env QR_PAYLOAD=$env:QR_PAYLOAD `
  mobile-app/e2e/maestro
```

## Scenario pending

Khởi động server với `$env:BANKING_SETTLE_IMMEDIATELY = "0"` trước khi seed. Transfer seed sẽ ở `PENDING`, giúp chạy flow retry/recovery. Các trạng thái `FAILED` và `REVERSED` được tạo qua backend test transition; không dùng dữ liệu production.

## Quy tắc dữ liệu

- `E2E_PASSWORD` chỉ tồn tại trong shell/secret của môi trường test, không commit vào repository.
- Seed output chỉ dùng cho local/preview sandbox; không dùng OTP sandbox hoặc account ID này cho staging/production.
- Với PostgreSQL relational, không reset bằng restart; dùng database disposable riêng hoặc user seed mới. Restart chỉ kiểm tra dữ liệu có còn sau khi backend khởi động lại.

## M7 credit

Seed output them `CREDIT_CARD_ID`, `CREDIT_ACCOUNT_ID`, `CREDIT_STATEMENT_ID` va `CREDIT_MINIMUM_AMOUNT_MINOR` de doi chieu sandbox. Flow `critical-credit.yaml` dung `TRANSFER_OTP` cho buoc step-up thanh toan; flow `critical-credit-pending-resume.yaml` can server voi `$env:BANKING_SETTLE_CREDIT_PAYMENTS_IMMEDIATELY = "0"` de tao PENDING truoc khi stop/launch app. Cac secret van chi nam trong environment cua nguoi chay.

Để kiểm tra sao kê quá hạn và thông báo deep-link, khởi động một server in-memory sạch với `$env:BANKING_SANDBOX_CREDIT_OVERDUE = "1"`, rồi chạy seed bằng user riêng. Khi seed gọi `/cards`, statement worker sẽ chuyển statement sang `OVERDUE` và phát một notification `CREDIT` trỏ tới `cardId`; gọi lại endpoint không phát thêm notification. Chỉ dùng biến này cho phiên bằng chứng riêng, sau đó khởi động lại backend với giá trị `0` hoặc bỏ biến.

## Xác nhận seed ngày 2026-08-15

Seed đã chạy thành công trên server sandbox tạm thời với MFA bắt buộc: tạo transfer `SUCCEEDED`, savings `SUCCEEDED` và card/statement Credit. Stdout chỉ chứa ID, trạng thái và payload QR masked; password/OTP không được in ra.

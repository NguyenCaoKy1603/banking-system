# E2E sandbox seed

`backend` có lệnh `npm run seed:e2e` để chuẩn bị dữ liệu cho các flow Maestro mà không phải tự lấy ID bằng tay.

## Chạy lại từ trạng thái sạch

Reference backend mặc định dùng in-memory store. Dừng và khởi động lại server để reset dữ liệu. Persistent PostgreSQL sandbox không dùng reset này; hãy dùng snapshot key/database disposable riêng cho test.

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

## Scenario pending

Khởi động server với `$env:BANKING_SETTLE_IMMEDIATELY = "0"` trước khi seed. Transfer seed sẽ ở `PENDING`, giúp chạy flow retry/recovery. Các trạng thái `FAILED` và `REVERSED` được tạo qua backend test transition; không dùng dữ liệu production.

## Quy tắc dữ liệu

- `E2E_PASSWORD` chỉ tồn tại trong shell/secret của môi trường test, không commit vào repository.
- Seed output chỉ dùng cho local/preview sandbox; không dùng OTP sandbox hoặc account ID này cho staging/production.
- Chạy lại từ trạng thái sạch bằng cách restart in-memory backend; không coi đây là persistence test.

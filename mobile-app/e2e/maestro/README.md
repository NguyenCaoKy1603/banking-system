# Native E2E harness

Các flow trong thư mục này dùng Maestro để chạy trên development/preview build Android hoặc iOS. Đây là test thật qua UI, không phải unit test và không dùng web export.

## Điều kiện chạy

- Cài Maestro CLI và có thiết bị/emulator Android hoặc iOS đang kết nối.
- Có native build với `APP_ID` tương ứng.
- Backend sandbox có user thử nghiệm, MFA OTP và beneficiary hợp lệ. Có thể chạy `cd ../backend; npm run seed:e2e` để tạo dữ liệu và xuất biến môi trường thay vì lấy ID thủ công; xem [`documents/05-testing/e2e-sandbox-seed.md`](../../../documents/05-testing/e2e-sandbox-seed.md).
- Với flow transfer pending, chạy backend với `BANKING_SETTLE_IMMEDIATELY=0`.

Ví dụ PowerShell:

```powershell
$env:TEST_PASSWORD = Read-Host "E2E password"
$env:MFA_OTP = Read-Host "MFA OTP"
$env:TRANSFER_OTP = Read-Host "Transfer OTP"
$env:QR_PAYLOAD = Read-Host "QR payload from seed output"

maestro test `
  --env APP_ID=com.example.banking.preview `
  --env TEST_EMAIL=tester@example.com `
  --env TEST_PASSWORD=$env:TEST_PASSWORD `
  --env MFA_OTP=$env:MFA_OTP `
  --env BENEFICIARY_ID=beneficiary-id `
  --env TRANSFER_AMOUNT_MINOR=100000 `
  --env TRANSFER_OTP=$env:TRANSFER_OTP `
  --env QR_PAYLOAD=$env:QR_PAYLOAD `
  e2e/maestro
```

`APP_ID` và dữ liệu test phải do môi trường preview cấp; không ghi credential thật vào flow hoặc repository. Flow cố ý dùng các `testID` ổn định trong app để tránh phụ thuộc vào text hiển thị.

## Coverage

- `critical-auth-and-logout.yaml`: login MFA, session entry và logout tất cả thiết bị.
- `critical-transfer-retry.yaml`: quote, step-up, double-tap, pending status và khôi phục sau stop/start app.
- `critical-fraud-report.yaml`: mở chi tiết giao dịch và gửi fraud report.
- `critical-m0-m4-m8.yaml`: login, eKYC mô phỏng, danh bạ người nhận, My QR/QR payload fallback, notification detail và deep link.
- `critical-card.yaml`: mở danh sách/chi tiết thẻ mock, ẩn/hiện số mô phỏng, khóa thẻ và đổi PIN mô phỏng.

Maestro CLI chưa được cài trong workspace nên các flow mới chỉ qua syntax validation. Android emulator và PostgreSQL sandbox đã được dùng cho smoke/integration test local, nhưng chưa thay thế việc chạy đầy đủ Maestro trên thiết bị/preview build.

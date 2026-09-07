# Native E2E harness

M6: `critical-savings.yaml` kiểm tra Home → Tiền gửi → quote → review → MFA → mở khoản theo idempotency key → danh sách tiền gửi. Khi chạy, đặt `SAVINGS_AMOUNT_MINOR` tối thiểu `1000000`.

Các flow trong thư mục này dùng Maestro để chạy trên development/preview build Android hoặc iOS. Đây là test thật qua UI, không phải unit test và không dùng web export.

## Điều kiện chạy

- Cài Maestro CLI và có thiết bị/emulator Android hoặc iOS đang kết nối.
- Có native build với `APP_ID` tương ứng.
- Với `critical-m0-m4-m8.yaml`, cấp `ACCOUNT_NUMBER` của user sandbox qua environment để flow kiểm tra reveal/copy mà không hardcode số tài khoản vào repository.
- Backend sandbox có user thử nghiệm đã enroll TOTP và beneficiary hợp lệ. Có thể chạy `cd ../backend; npm run seed:e2e` để tạo dữ liệu và xuất biến môi trường thay vì lấy ID thủ công; xem [`documents/05-testing/e2e-sandbox-seed.md`](../../../documents/05-testing/e2e-sandbox-seed.md).
- Với flow transfer pending, chạy backend với `BANKING_SETTLE_IMMEDIATELY=0`.
- Với flow credit pending-resume, chạy backend với `BANKING_SETTLE_CREDIT_PAYMENTS_IMMEDIATELY=0`.
- Với flow credit overdue notification, chạy backend với `BANKING_SANDBOX_CREDIT_OVERDUE=1` chỉ cho phiên seed riêng; sau khi seed xong có thể tắt biến này cho các phiên demo bình thường.

Ví dụ PowerShell:

```powershell
$env:TEST_PASSWORD = Read-Host "E2E password"
$env:TOTP_SECRET = Read-Host "TOTP fixture secret"
$env:QR_PAYLOAD = Read-Host "QR payload from seed output"

maestro test `
  --env APP_ID=com.example.banking.preview `
  --env TEST_EMAIL=tester@example.com `
  --env TEST_PASSWORD=$env:TEST_PASSWORD `
  --env TOTP_SECRET=$env:TOTP_SECRET `
  --env BENEFICIARY_ID=beneficiary-id `
  --env TRANSFER_AMOUNT_MINOR=100000 `
  --env TRANSFER_TOTP_SECRET=$env:TOTP_SECRET `
  --env QR_PAYLOAD=$env:QR_PAYLOAD `
  e2e/maestro
```

`APP_ID` và dữ liệu test phải do môi trường preview cấp; không ghi credential thật vào flow hoặc repository. Flow cố ý dùng các `testID` ổn định trong app để tránh phụ thuộc vào text hiển thị. Có thể dùng `npm run e2e:maestro -- test ...` thay cho gọi Maestro trực tiếp; wrapper tự chuẩn hóa `JAVA_HOME` nếu biến môi trường đang trỏ nhầm vào thư mục `bin`.

Để tự chuẩn bị một user/recipient E2E mới mà không nhập credential thủ công, khởi động backend đã migrate rồi chạy:

```powershell
cd mobile-app
$env:E2E_TOTP_SECRET = Read-Host "E2E TOTP fixture secret"
npm run e2e:sandbox
```

Lệnh dùng credential ngẫu nhiên trong bộ nhớ, gọi `backend` seed, lấy số tài khoản đầy đủ qua API bảo vệ, chạy flow mặc định M0–M4/M8 và xóa artifact Maestro tạm sau khi chạy. Dữ liệu nghiệp vụ được tạo trong database sandbox hiện tại; nếu cần làm sạch, dùng `backend/npm run reset:sandbox` với xác nhận theo [`e2e-sandbox-seed.md`](../../../documents/05-testing/e2e-sandbox-seed.md).

`E2E_TOTP_SECRET` dùng để bộ chạy test tự tính mã TOTP theo RFC 6238 cho đăng nhập và step-up. Secret chỉ thuộc fixture test, không phải secret vận hành và không được ghi vào repository.

## Coverage

- `critical-auth-and-logout.yaml`: login password-only, session entry, logout thiết bị hiện tại và logout tất cả thiết bị (kèm xác nhận Native Alert).
- `critical-registration.yaml`: đăng ký customer, nhận OTP từ HTTP email capture local, xác minh OTP một lần và quay về màn hình đăng nhập.
- `critical-transfer-retry.yaml`: quote, step-up, double-tap, pending status và khôi phục sau stop/start app.
- `critical-fraud-report.yaml`: mở chi tiết giao dịch và gửi fraud report.
- `critical-m0-m4-m8.yaml`: login, trang chủ với thẻ số dư hiện/che, hiện và sao chép số tài khoản đầy đủ, eKYC submit → `PENDING`/read-only, danh bạ người nhận, My QR/QR payload fallback chỉ hiển thị dữ liệu chưa xác minh và chặn chuyển tiền, notification detail và deep link.
- `critical-savings.yaml`: Home → Tiền gửi → quote/review → step-up TOTP → mở khoản → danh sách tiền gửi.
- `critical-card.yaml`: mở danh sách/chi tiết Credit sandbox, khóa thẻ, stop/launch để kiểm tra trạng thái được giữ lại và mở khóa bằng TOTP.
- `critical-credit.yaml`: mở thẻ tín dụng sandbox, xem giao dịch/sao kê, tạo quote MINIMUM, TOTP step-up và hoàn tất thanh toán.
- `critical-credit-pending-resume.yaml`: tạo thanh toán PENDING, stop/launch app, mở lại chi tiết và resume đến SUCCEEDED mà không debit lần hai.
- `critical-credit-overdue-notification.yaml`: mở thông báo sao kê Credit quá hạn và deep-link tới đúng chi tiết thẻ.
- `critical-offline-retry.yaml`: mô phỏng API không reachable, kiểm tra banner mất kết nối và retry ở màn hình đăng nhập.

Trong phiên xác minh ngày 2026-09-01, Maestro CLI 2.8.0 đã chạy thành công
trên Android emulator `Pixel_7` API 34 với APK release local cho các flow đăng ký,
M0–M4/M8, transfer, M6 và M7; bộ validator xác nhận 19 flow hợp lệ. M0–M4/M8
đã kiểm tra hiện và sao chép số tài khoản đầy đủ; M6/M7 đã kiểm tra quote,
review, TOTP và nghiệp vụ tương ứng. Flow đăng ký lấy OTP từ HTTP capture nội bộ,
không cần SMTP thật. API 35 `Pixel_7_API_35` không dùng làm bằng chứng cuối vì
AVD đang có `hw.keyboard=no`, gây mất ký tự khi nhập; có thể chạy lại sau khi
đóng emulator và đặt `hw.keyboard=yes`. Camera permission, biometric prompt,
transfer lifecycle native đầy đủ và thiết bị thật vẫn cần chạy bổ sung.

Thay đổi trust boundary eKYC/QR đã được chạy lại qua flow M0–M4/M8 trên API 34;
không dùng bằng chứng cũ của API 35 để thay thế kết quả này.

## Cap nhat M7

- `critical-credit.yaml` kiểm tra login MFA, danh sách/chi tiết credit sandbox, giao dịch, sao kê, quote MINIMUM, review, step-up TOTP và kết quả payment.
- Flow tự tính TOTP từ fixture secret; backend không có endpoint/operator để đọc mã.
- `critical-credit-overdue-notification.yaml` dung seed mode `BANKING_SANDBOX_CREDIT_OVERDUE=1` de tao sao ke qua han, sau do kiem tra notification CREDIT deep-link ve `/cards/[cardId]`.
- M0-M4-M8 flow da them kiem tra `home-toggle-account-number` va `home-copy-account-number`: ket qua mong doi la full number, khong phai 4 so cuoi.

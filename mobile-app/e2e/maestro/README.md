# Native E2E harness

M6: `critical-savings.yaml` kiểm tra Home → Tiền gửi → quote → review → MFA → mở khoản theo idempotency key → danh sách tiền gửi. Khi chạy, đặt `SAVINGS_AMOUNT_MINOR` tối thiểu `1000000`.

Các flow trong thư mục này dùng Maestro để chạy trên development/preview build Android hoặc iOS. Đây là test thật qua UI, không phải unit test và không dùng web export.

## Điều kiện chạy

- Cài Maestro CLI và có thiết bị/emulator Android hoặc iOS đang kết nối.
- Có native build với `APP_ID` tương ứng.
- Với `critical-m0-m4-m8.yaml`, cấp `ACCOUNT_NUMBER` của user sandbox qua environment để flow kiểm tra reveal/copy mà không hardcode số tài khoản vào repository.
- Backend sandbox có user thử nghiệm, MFA OTP và beneficiary hợp lệ. Có thể chạy `cd ../backend; npm run seed:e2e` để tạo dữ liệu và xuất biến môi trường thay vì lấy ID thủ công; xem [`documents/05-testing/e2e-sandbox-seed.md`](../../../documents/05-testing/e2e-sandbox-seed.md).
- Với flow transfer pending, chạy backend với `BANKING_SETTLE_IMMEDIATELY=0`.
- Với flow credit pending-resume, chạy backend với `BANKING_SETTLE_CREDIT_PAYMENTS_IMMEDIATELY=0`.
- Với flow credit overdue notification, chạy backend với `BANKING_SANDBOX_CREDIT_OVERDUE=1` chỉ cho phiên seed riêng; sau khi seed xong có thể tắt biến này cho các phiên demo bình thường.

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

`APP_ID` và dữ liệu test phải do môi trường preview cấp; không ghi credential thật vào flow hoặc repository. Flow cố ý dùng các `testID` ổn định trong app để tránh phụ thuộc vào text hiển thị. Có thể dùng `npm run e2e:maestro -- test ...` thay cho gọi Maestro trực tiếp; wrapper tự chuẩn hóa `JAVA_HOME` nếu biến môi trường đang trỏ nhầm vào thư mục `bin`.

Để tự chuẩn bị một user/recipient E2E mới mà không nhập credential thủ công, khởi động backend đã migrate rồi chạy:

```powershell
cd mobile-app
$env:E2E_MFA_OTP = $env:BANKING_SANDBOX_MFA_OTP
$env:E2E_TRANSFER_OTP = $env:BANKING_SANDBOX_OTP
npm run e2e:sandbox
```

Lệnh dùng credential ngẫu nhiên trong bộ nhớ, gọi `backend` seed, lấy số tài khoản đầy đủ qua API bảo vệ, chạy flow mặc định M0–M4/M8 và xóa artifact Maestro tạm sau khi chạy. Dữ liệu nghiệp vụ được tạo trong database sandbox hiện tại; nếu cần làm sạch, dùng `backend/npm run reset:sandbox` với xác nhận theo [`e2e-sandbox-seed.md`](../../../documents/05-testing/e2e-sandbox-seed.md).

`E2E_MFA_OTP` dùng cho bước đăng nhập MFA; `E2E_TRANSFER_OTP` dùng cho bước đăng ký của reference backend và các bước xác nhận giao dịch. Hai biến phải khớp với các giá trị `BANKING_SANDBOX_MFA_OTP` và `BANKING_SANDBOX_OTP` của server đang chạy.

## Coverage

- `critical-auth-and-logout.yaml`: login MFA, session entry và logout tất cả thiết bị.
- `critical-transfer-retry.yaml`: quote, step-up, double-tap, pending status và khôi phục sau stop/start app.
- `critical-fraud-report.yaml`: mở chi tiết giao dịch và gửi fraud report.
- `critical-m0-m4-m8.yaml`: login, trang chủ với thẻ số dư hiện/che, hiện và sao chép số tài khoản đầy đủ, eKYC mô phỏng, danh bạ người nhận, My QR/QR payload fallback, notification detail và deep link.
- `critical-savings.yaml`: Home → Tiền gửi → quote/review → step-up OTP → mở khoản → danh sách tiền gửi.
- `critical-card.yaml`: mở danh sách/chi tiết Credit sandbox, khóa thẻ, stop/launch để kiểm tra trạng thái được giữ lại và mở khóa bằng OTP sandbox.
- `critical-credit.yaml`: mở thẻ tín dụng sandbox, xem giao dịch/sao kê, tạo quote MINIMUM, MFA step-up và hoàn tất thanh toán.
- `critical-credit-pending-resume.yaml`: tạo thanh toán PENDING, stop/launch app, mở lại chi tiết và resume đến SUCCEEDED mà không debit lần hai.
- `critical-credit-overdue-notification.yaml`: mở thông báo sao kê Credit quá hạn và deep-link tới đúng chi tiết thẻ.
- `critical-offline-retry.yaml`: mô phỏng API không reachable, kiểm tra banner mất kết nối và retry ở màn hình đăng nhập.

Maestro CLI 2.8.0 đã chạy thành công trên Android emulator `Pixel_7_API_35` cho các flow M0–M4/M8, M6, M7 và `critical-offline-retry.yaml`. Bộ thư mục hiện có 10 flow hợp lệ; M0–M4/M8 đã kiểm tra hiện và sao chép số tài khoản đầy đủ trên APK hiện tại, M6 đã kiểm tra quote/review/OTP/mở khoản, M7 đã kiểm tra payment, pending → stop/launch → resume, khóa → restart → mở khóa thẻ bằng OTP, thông báo sao kê quá hạn → mở đúng thẻ, còn offline retry đã kiểm tra banner mất kết nối và retry. Artifact raw của offline flow đã được xóa để không lưu dữ liệu test nhạy cảm. Camera permission, biometric prompt, transfer lifecycle native đầy đủ và thiết bị thật vẫn cần chạy bổ sung.

## Cap nhat M7

- `critical-credit.yaml` kiem tra login MFA, danh sach/chi tiet credit sandbox, giao dich, sao ke, quote MINIMUM, review, step-up OTP va ket qua payment.
- Flow dung `${TRANSFER_OTP}` cho step-up thanh toan credit vi day la OTP sandbox do backend cap; khong ghi OTP vao flow/repository.
- `critical-credit-overdue-notification.yaml` dung seed mode `BANKING_SANDBOX_CREDIT_OVERDUE=1` de tao sao ke qua han, sau do kiem tra notification CREDIT deep-link ve `/cards/[cardId]`.
- M0-M4-M8 flow da them kiem tra `home-toggle-account-number` va `home-copy-account-number`: ket qua mong doi la full number, khong phai 4 so cuoi.

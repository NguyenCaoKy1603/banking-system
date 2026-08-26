# Stage 2 performance smoke

`node/stage2-smoke.cjs` là bài đo Node-native tương đương k6 cho local preview khi máy chưa có k6. Bài đo dùng hai user fixture đã enroll TOTP trong database disposable, đo health/read endpoints và gửi đồng thời nhiều request transfer với cùng idempotency key để kiểm tra canonical receipt/double-debit.

Chạy từ PowerShell tại root repository:

```powershell
$env:PERF_BASE_URL="http://127.0.0.1:5000/api/v1"
$env:PERF_OWNER_EMAIL="owner-fixture@example.invalid"
$env:PERF_RECIPIENT_EMAIL="recipient-fixture@example.invalid"
$env:PERF_PASSWORD="<fixture-password>"
$env:PERF_OWNER_TOTP_SECRET="<owner-fixture-secret>"
$env:PERF_RECIPIENT_TOTP_SECRET="<recipient-fixture-secret>"
node performance/node/stage2-smoke.cjs
```

Owner fixture phải được cấp số dư trước bằng quy trình Admin bốn mắt. Harness
không có operator key và không gọi endpoint cấp tiền công khai.

Giá trị mặc định: 20 vòng read và 20 request transfer đồng thời. Có thể dùng `PERF_READ_ITERATIONS` và `PERF_TRANSFER_CONCURRENCY` để chạy smoke nhỏ hơn/lớn hơn trong giới hạn an toàn của script.

Threshold local ban đầu theo kế hoạch: health p95 <100 ms, read p95 <300 ms, transfer p95 <700 ms, error rate 0, canonical transfer count 1, reconciliation `ok`. Đây không phải SLO cloud; phải chạy lại tối thiểu ba lượt và ghi median khi có staging HTTPS.

Script không in email, password, OTP, token, account number, transfer ID hoặc raw response. Không chạy trên production hay database demo đang dùng.

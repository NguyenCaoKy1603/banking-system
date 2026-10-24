# Local completion evidence — 2026-09-01

## Kết luận

Đã hoàn tất phần có thể kiểm chứng an toàn trong workspace cho bản mobile
banking reference dùng dữ liệu synthetic và tiền mô phỏng. Các luồng customer
đã được kiểm tra trên Android emulator; Backend, Admin Web, Worker và
PostgreSQL disposable đã được kiểm tra bằng các quality gate tương ứng.

Evidence này **không phải** bằng chứng staging thật. Trạng thái trung thực vẫn
là:

```text
UNTRUSTED LOCAL PREVIEW
IMAGE_DIGEST=unknown
BANKING_MONEY_MODE=virtual
BANKING_PERSISTENCE_MODE=relational-v2
```

Local worker có thể được bật với `WORKER_CUTOVER_CONFIRMED=1` để rehearsal,
nhưng điều đó không biến Docker local thành staging. Không có tiền thật,
không gửi email ra ngoài và không ghi OTP/password/token vào evidence.

## Phạm vi đã hoàn tất

- Đóng gói các thay đổi E2E và backend hỗ trợ seed/provider boundary trong
  source hiện tại; không đưa file `.env.compose`, `node_modules`, `dist` hoặc
  helper thử nghiệm cá nhân vào commit.
- Database disposable đã chạy migration `001–040`; migration có thể chạy lặp
  mà không tạo bản ghi/schema trùng.
- Route KYC customer dùng boundary relational-v2 và trạng thái synthetic được
  kiểm tra qua API/mobile.
- Email OTP local dùng HTTP capture nội bộ. Seed chờ inbox capture, chỉ dùng
  email synthetic và không cần SMTP thật.
- Worker chạy bằng relational-v2 với lease, retry, dead-letter, idempotency,
  startup catch-up và graceful shutdown; rehearsal nhiều worker/scheduler chỉ
  dùng database disposable hoặc preview local được cấu hình rõ ràng.
- Transfer, Savings và Credit dùng các flow Maestro chia pha để mã TOTP được
  cấp trong test runner mà không ghi mã vào log.

## Kết quả quality gate

| Thành phần | Kiểm tra | Kết quả |
|---|---|---:|
| Backend | `npm run typecheck` | PASS |
| Backend | `npm run build` | PASS |
| Backend | `npm run test:release` | 17/17 lệnh PASS |
| Backend | Aggregate | 206 test: 158 PASS, 0 FAIL, 48 SKIPPED có chủ đích |
| Backend | Critical HTTP | 10/10 PASS |
| Backend | Migration/database disposable | 001–040, PASS |
| Backend | Worker lease/retry/dead-letter/load | 10/10 PASS |
| Backend | Integrated API + email capture + 2 worker + 2 scheduler | PASS |
| Mobile | lint, typecheck, OpenAPI, public-env | PASS |
| Mobile | Unit test | 45 suite, 259/259 PASS |
| Mobile | Maestro syntax | 19 flow hợp lệ |
| Mobile | Web export | PASS, 36 static route |
| Admin Web | lint/typecheck, unit test | 7/7 PASS |
| Admin Web | Playwright E2E | 1/1 PASS |
| Admin Web | build và audit | PASS, 0 high vulnerability |

48 test PostgreSQL bị skip trong aggregate chỉ vì aggregate không nhận URL
database để bảo vệ `banking_preview`; từng nhóm tương ứng đã được chạy lại
bằng runner disposable và đều PASS.

## E2E emulator đã chạy

Thiết bị kiểm tra: Android emulator `emulator-5554`, Pixel 7, API 34 (`Pixel_7`),
APK release cục bộ. API 35 (`Pixel_7_API_35`) không được dùng làm bằng chứng cuối
vì cấu hình AVD có `hw.keyboard=no`, làm mất ký tự khi nhập liệu; đây là vấn đề
cấu hình emulator, không phải lỗi validation của ứng dụng.

| Flow | Phạm vi kiểm tra | Kết quả |
|---|---|---:|
| `critical-registration.yaml` | đăng ký customer, nhận OTP từ HTTP email capture nội bộ, nhập OTP một lần và hoàn tất xác minh | PASS |
| `critical-m0-m4-m8.yaml` | đăng nhập, tài khoản, hiện/copy số tài khoản đầy đủ, KYC synthetic, QR và thông báo | PASS |
| `critical-transfer-retry.yaml` | quote, review, TOTP step-up, submit transfer, status và mở lại sau restart | PASS |
| `critical-savings.yaml` | quote mở tiết kiệm, TOTP step-up, submit và đọc lại danh sách | PASS |
| `critical-credit.yaml` | thẻ, giao dịch, sao kê, thanh toán, TOTP step-up và kết quả | PASS |

Flow đăng ký dùng email synthetic và HTTP capture local nên không phụ thuộc SMTP
thật. Các flow transfer/savings/credit dùng test runner để điền TOTP hiện thời
vào challenge đang hiển thị. Mã không được in ra terminal, không lưu trong source
hoặc database.

## Data flow được xác minh

```text
Mobile emulator
  → Backend API relational-v2
  → PostgreSQL / transaction boundary
  → ledger + audit + outbox
  → local email capture / worker rehearsal
```

Trong các bài kiểm tra persistent, request đồng thời chỉ được debit một lần;
quote/idempotency/row lock/ledger/outbox được kiểm tra trong cùng transaction.
Registration chỉ lưu OTP digest và delivery intent; verification đồng thời chỉ
có một request thành công.

## Trạng thái phát hành

- `IMAGE_DIGEST=unknown` là đúng vì image hiện là image local, chưa pull từ
  registry immutable và chưa có staging deployment.
- Chưa được gắn `STAGING DEPLOYED` hoặc `STAGING VERIFIED`.
- Chưa có managed PostgreSQL staging với TLS `verify-full`, Secret Manager,
  HTTPS domain, registry pull permission, backup/restore target hoặc APK
  staging ký bằng hạ tầng phát hành.
- Bằng chứng emulator local chứng minh hành vi UI/API trong môi trường học
  thuật; không thay thế device E2E qua HTTPS staging.

## Cách tái hiện an toàn

1. Khởi động local Compose bằng `.env.compose` của máy, không commit file này.
2. Dùng PostgreSQL disposable cho migration và release-quality rehearsal.
3. Chạy `backend` `npm run test:release` với
   `DATABASE_TEST_ADMIN_URL` trỏ tới database maintenance `postgres`, không
   trỏ `banking_preview`.
4. Chạy các quality gate Mobile/Admin Web và các flow Maestro với email
   synthetic/capture service nội bộ.
5. Kiểm tra health/version và xác nhận metadata local vẫn có
   `IMAGE_DIGEST=unknown`.

## Việc còn lại nếu muốn lên STAGING VERIFIED

Provision staging provider, cấp quyền pull GHCR bằng token read-only qua secret
manager, dùng PostgreSQL riêng có TLS, HTTPS API/Admin Web, secret versioning,
deploy Backend/Admin/Worker/Migrate bằng cùng digest, build APK staging, chạy
E2E qua HTTPS, thử backup/restore và rollback, rồi lưu evidence của đúng digest.

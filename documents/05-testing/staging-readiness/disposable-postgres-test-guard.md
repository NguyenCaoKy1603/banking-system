# Disposable PostgreSQL test guard

## Mục đích

Mọi suite PostgreSQL có thao tác `TRUNCATE`, `clear()` hoặc ghi fixture phải
chạy trên database disposable, không bao giờ dùng `banking_preview` hay database
phục vụ runtime local. Guard fail-closed trước khi mở pool nếu bất kỳ điều kiện
nào không đúng.

Điều kiện bắt buộc:

- `NODE_ENV=test`.
- `BANKING_ENV=test`.
- `ALLOW_DATABASE_TEST_RESET=1`.
- Tên database khớp `banking_test_<suffix>`.
- Host nằm trong `DATABASE_TEST_ALLOWED_HOSTS` (mặc định local: `localhost`,
  `127.0.0.1`, `::1`, `postgres`).
- URL không trùng các biến tham chiếu development/preview.
- URL quản trị để tạo/xóa database chỉ được trỏ tới `postgres` hoặc `template1`.

## Cách chạy local

Không đọc `.env.compose`. Chỉ cấp URL maintenance của PostgreSQL local:

```powershell
$env:DATABASE_TEST_ADMIN_URL = "postgresql://banking:<local-password>@localhost:5433/postgres"
cd backend
npm run test:database:guard
npm run test:database
npm run test:relational
npm run test:mfa:persistence
npm run test:savings:persistence
npm run test:credit:persistence
npm run test:remaining:persistence
npm run test:registration:persistence
npm run test:lifecycle:persistence
npm run test:persistence
npm run test:admin:database
# Worker chỉ chạy trên database disposable sau khi gate worker được bật trong chính test.
npm run test:worker
Remove-Item Env:DATABASE_TEST_ADMIN_URL
```

Mỗi lệnh PostgreSQL tự tạo tên `banking_test_<pid>_<random>`, chạy migration
001–040, chạy đúng suite được chọn và xóa database bằng `DROP DATABASE ... WITH
(FORCE)` kể cả khi suite thất bại. `test:worker` dùng cùng cơ chế khi worker
được phép kiểm thử. Worker chỉ được bật trong disposable rehearsal với các cờ
test riêng; không bật worker runtime trên `banking_preview`.

Nếu thiếu `DATABASE_TEST_ADMIN_URL`, suite dừng với lỗi rõ ràng. Nếu đặt
`P0_RELATIONAL_DATABASE_URL`, `RELATIONAL_DATABASE_URL`, `DATABASE_URL` hoặc
`WORKER_DATABASE_URL` tới `banking_preview`, test sẽ bị từ chối trước khi kết
nối. CI có negative test `npm run test:database:guard` và các workflow không dùng
`.env.compose`.

## Trạng thái bằng chứng

Guard hiện đã được kiểm tra bằng suite thuần (5/5) và PostgreSQL disposable thật;
mọi suite đều phải áp dụng migration 001–040, không đọc `.env.compose` preview.
Các lệnh foundation, relational, MFA, Savings, Credit, remaining, registration,
lifecycle, legacy persistence và Admin PostgreSQL là các quality evidence local
riêng biệt. Đây là quality evidence local; chưa phải staging/production evidence.

# Banking System / NOVA — Academic Reference Implementation

Đây là reference implementation cho ứng dụng ngân hàng di động, dùng dữ liệu synthetic và tiền ảo
trong môi trường local preview. Repository minh họa cách tổ chức các luồng Mobile, Customer API,
Admin API/Web, PostgreSQL relational-v2 persistence (migrations `001`–`051`), double-entry ledger &
đối soát sổ cái, idempotency, TOTP & device-bound biometric MFA, phát hiện giao dịch bất thường,
chuyển tiền nội bộ & liên ngân hàng mô phỏng NAPAS IBFT / VietQR, quản lý mật khẩu/thiết bị,
sao kê CSV/HTML, quản trị chính sách động và outbox/lifecycle worker.

## Năng lực nổi bật trong mã nguồn hiện tại

- **Định danh & Bảo mật**: Đăng ký 2 bước Email OTP, đăng nhập mật khẩu, refresh token rotation, TOTP MFA & mã khôi phục, sinh trắc học gắn thiết bị (`biometric-v1`, áp dụng step-up cho chuyển tiền ≤ 1.000.000 VND), đổi mật khẩu, quên/đặt lại mật khẩu bằng Email OTP, danh sách & thu hồi thiết bị từ xa, Privacy Shield & cửa sổ ân hạn 30s.
- **Tài khoản, Lịch sử & Sao kê**: Đa tài khoản thanh toán, che/hiện số tài khoản theo yêu cầu, lọc giao dịch phía server (`status`, `direction`, `from`, `to`, `q`), thống kê thu/chi theo tháng (`GET /accounts/{id}/summary`) và xuất sao kê CSV/HTML (`GET /accounts/{id}/statement-export`).
- **Chuyển tiền, VietQR & NAPAS mô phỏng**: Chuyển tiền nội bộ NOVA và chuyển khoản liên ngân hàng mô phỏng `NAPAS_IBFT` (8 mã BIN ngân hàng Việt Nam, hạch toán 2 pha `held_minor` và tự đối soát qua scheduler), hạn mức giao dịch/ngày & biểu phí động từ `control_policy`, tạo/quét mã **VietQR (EMVCo TLV + CRC-16/CCITT-FALSE)** động/tĩnh và NOVA QR v2.
- **Phát hiện giao dịch bất thường (Anomaly Detection)**: Bộ đánh giá rủi ro tất định dùng `BigInt` (`LOW` / `MEDIUM` / `HIGH` / `CRITICAL`), chặn hoặc yêu cầu xác nhận khi rủi ro cao, khách hàng xác nhận an toàn/báo nghi ngờ trên Mobile và nhân viên xử lý trên Admin Web.
- **Tiết kiệm, Thẻ tín dụng, KYC & AI**: Sổ tiết kiệm có kỳ hạn (đổi phương án đáo hạn, tất toán trước hạn lãi không kỳ hạn 0,20%/năm), eKYC synthetic bắt buộc `APPROVED` trước khi đăng ký thẻ tín dụng, khóa/mở/báo mất thẻ, sao kê & thanh toán thẻ, trợ lý FAQ (Radox bounded selector) & lập kế hoạch tài chính.
- **Admin Control Plane**: Phân quyền 2 vai trò (`OPERATIONS`, `ADMIN`), quản trị chính sách & biểu phí động (Global Kill-Switch, hạn mức, phí chuyển tiền có TOTP step-up), đối soát sổ cái kép (Trial Balance Reconciliation), hàng đợi cảnh báo bất thường, duyệt Maker-Checker / Direct Execution và nhật ký kiểm toán bất biến.

## Bắt đầu nhanh

### Điều kiện và phiên bản có căn cứ

- Windows/PowerShell và Git.
- Docker Desktop nếu dùng preview local; Compose pin PostgreSQL 16 bằng digest trong
  [`compose.yaml`](compose.yaml).
- Backend image dùng Node 22 trong [`backend/Dockerfile`](backend/Dockerfile).
- Backend khai báo `pg`, TypeScript và `tsx` trong [`backend/package.json`](backend/package.json).
- Admin Web dùng React/TypeScript/Vite; Mobile dùng Expo SDK 57 và React Native 0.86,
  theo các manifest tương ứng.
- Android emulator/native build chỉ cần cho luồng Mobile; không dùng web export để
  thay thế native/device evidence.

### Preview local và database

```powershell
Copy-Item .env.compose.example .env.compose
# Mở .env.compose và thay placeholder bằng giá trị local; không commit file này.
docker compose --env-file .env.compose up -d --build
docker compose --env-file .env.compose exec backend node scripts/container-smoke.cjs
```

Compose tạo PostgreSQL preview local, chạy migration one-shot (`001`–`051`) rồi khởi động Backend
(bind `0.0.0.0:5000` hỗ trợ truy cập qua LAN nội bộ), Admin API, Admin Web và các capture service.
Trên Mobile web khi truy cập qua LAN IP (kể cả Safari trên HTTP cục bộ), `apiConfig.baseUrl` tự động
suy ra host từ `window.location.hostname` và `src/utils/uuid.ts` dùng bộ sinh UUIDv4 an toàn.
`BANKING_MONEY_MODE=virtual` và các địa chỉ database phải chỉ dùng local. Không dùng database demo
hiện Owner đang giữ cho disposable test; không trỏ test destructive vào preview.

Dừng preview do người vận hành quản lý bằng:

```powershell
docker compose --env-file .env.compose stop
# Chỉ dùng down khi đã quyết định dừng stack; không thêm --volumes nếu cần giữ dữ liệu.
docker compose --env-file .env.compose down
```

### Backend

Hướng dẫn đầy đủ nằm tại [`backend/README.md`](backend/README.md). Luồng persistent
local hiện dùng PostgreSQL relational reference adapter:

```powershell
cd backend
npm install
# Chuẩn bị .env local theo backend/README.md; không ghi credential vào Git.
npm run start:persistent
```

`start:persistent` áp dụng migration bằng công cụ hiện có rồi chạy server. Dừng bằng
`Ctrl+C`. Các suite disposable phải nhận `DATABASE_TEST_ADMIN_URL` của database tạm
đã được guard xác nhận; không dùng database demo.

### Admin API và Admin Web

Chạy Admin API trong một terminal backend riêng:

```powershell
cd backend
npm install
npm run admin:dev
```

Dừng Admin API bằng `Ctrl+C`. Sau đó chạy giao diện Admin Web ở terminal khác:

```powershell
cd admin-web
npm install
$env:ADMIN_API_UPSTREAM = "http://127.0.0.1:5001"
npm run dev
```

Dừng bằng `Ctrl+C`. Admin Web gọi same-origin `/api/v1`; Vite proxy chuyển tiếp tới
Admin API. Chi tiết ở [`admin-web/README.md`](admin-web/README.md).

### Mobile

```powershell
cd mobile-app
npm install
$env:EXPO_PUBLIC_API_URL = "http://10.0.2.2:5000/api/v1"
npm start
```

Với Android emulator, `10.0.2.2` trỏ về máy phát triển. Release APK local có thể
dùng `EXPO_PUBLIC_SANDBOX_HTTP=1` và `adb reverse` theo
[`mobile-app/README.md`](mobile-app/README.md). Cờ sandbox HTTP không được dùng cho
staging/production; production-like phải dùng HTTPS và biến public hợp lệ.

## Phân biệt môi trường

| Môi trường | Mục đích | Được dùng cho | Không được suy ra |
| --- | --- | --- | --- |
| Demo persistent local | Trình diễn Đợt 2 với dữ liệu synthetic | Mobile/Admin/API/PostgreSQL đã được Owner nghiệm thu | Staging, production hoặc tiền thật |
| PostgreSQL disposable | Test destructive/relational, database riêng theo lượt | Migration, Registration/KYC relational và regression | Trạng thái của database demo |
| Preview Compose local | Tái hiện stack từ `.env.compose` | Setup/rehearsal local | Remote CI, cloud, HTTPS hoặc managed DB |
| Emulator/native build | Kiểm tra UI và flow Mobile | Evidence emulator đã ghi trong hồ sơ | Thiết bị thật, accessibility device đầy đủ |

## Tài liệu hệ thống

- Hiện trạng & bản đồ code: [`documents/01-planning/current-status.md`](documents/01-planning/current-status.md), [`documents/01-planning/repository-map-current.md`](documents/01-planning/repository-map-current.md).
- Phạm vi, kiến trúc & đặc tả use-case: [`documents/02-design/architecture-and-scope.md`](documents/02-design/architecture-and-scope.md), [`documents/02-design/function-scope.md`](documents/02-design/function-scope.md), [`documents/02-design/use-cases-complete-specification.md`](documents/02-design/use-cases-complete-specification.md).
- ERD và sequence: [`documents/02-design/erd-core-demo.md`](documents/02-design/erd-core-demo.md), [`documents/02-design/sequence-core-demo.md`](documents/02-design/sequence-core-demo.md).
- API Contracts & OpenAPI: [`documents/api/README.md`](documents/api/README.md), [`documents/api/banking-mvp.openapi.yaml`](documents/api/banking-mvp.openapi.yaml), [`documents/api/admin.openapi.yaml`](documents/api/admin.openapi.yaml).
- Admin & RBAC: [`documents/admin/README.md`](documents/admin/README.md).
- Hướng dẫn kiểm thử & MFA: [`documents/05-testing/README.md`](documents/05-testing/README.md), [`documents/05-testing/mfa-runbook.md`](documents/05-testing/mfa-runbook.md).
- Sổ tay Mobile: [`documents/mobile-pilot-runbook.md`](documents/mobile-pilot-runbook.md).

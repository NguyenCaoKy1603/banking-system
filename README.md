# Banking System — hồ sơ bàn giao Đợt 3

Đây là reference implementation cho đồ án học thuật, dùng dữ liệu synthetic và tiền ảo
trong môi trường local. Repository chưa có bằng chứng staging, production, core-banking
partner, KYC thật hoặc triển khai cloud. Các lệnh dưới đây là hướng dẫn tái hiện; chúng
không tự khẳng định đã được chạy trên clone sạch ở snapshot hiện tại.

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

Compose tạo PostgreSQL preview local, chạy migration one-shot rồi khởi động Backend,
Admin API, Admin Web và các capture service. `BANKING_MONEY_MODE=virtual` và các
địa chỉ database phải chỉ dùng local. Không dùng database demo hiện Owner đang giữ cho
disposable test; không trỏ test destructive vào preview.

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

Không đưa scratch script, credential, log thô hoặc build artifact vào quy trình bàn giao.
Khoảng trống setup còn lại và quyết định deployment được ghi tại
[`tasks/DEMO/TASK_DOT_3_PROJECT_HANDOFF.md`](tasks/DEMO/TASK_DOT_3_PROJECT_HANDOFF.md).

## Bản đồ hồ sơ bàn giao

- Phạm vi/kiến trúc: [`documents/02-design/architecture-and-scope.md`](documents/02-design/architecture-and-scope.md),
  [`documents/02-design/function-scope.md`](documents/02-design/function-scope.md).
- ERD và sequence: [`documents/02-design/erd-core-demo.md`](documents/02-design/erd-core-demo.md),
  [`documents/02-design/sequence-core-demo.md`](documents/02-design/sequence-core-demo.md).
- Báo cáo nháp: [`documents/08-presentation/thesis-report-draft.md`](documents/08-presentation/thesis-report-draft.md).
- Slide/run sheet/Q&A: [`documents/08-presentation/slide-outline.md`](documents/08-presentation/slide-outline.md),
  [`documents/08-presentation/demo-run-sheet.md`](documents/08-presentation/demo-run-sheet.md),
  [`documents/08-presentation/defense-qa.md`](documents/08-presentation/defense-qa.md).
- Checklist/evidence: [`documents/08-presentation/pre-demo-checklist.md`](documents/08-presentation/pre-demo-checklist.md),
  [`documents/08-presentation/evidence-index.md`](documents/08-presentation/evidence-index.md).
- Hồ sơ tổng hợp Đợt 3: [`tasks/DEMO/TASK_DOT_3_PROJECT_HANDOFF.md`](tasks/DEMO/TASK_DOT_3_PROJECT_HANDOFF.md).
- Evidence Đợt 2 đã nghiệm thu: [`tasks/DEMO/TASK_DOT_2_CORE_BANKING_DEMO.md`](tasks/DEMO/TASK_DOT_2_CORE_BANKING_DEMO.md).

## Trạng thái bàn giao

`IN PROGRESS — DRAFT DELIVERABLES`

Đợt 2 đã được Owner chấp thuận trong phạm vi local/emulator/reference academic.
Đợt 3 mới là bộ hồ sơ nháp; chưa có quyết định deployment, chưa có remote CI pass,
chưa có signed APK/device evidence đầy đủ và chưa đánh dấu toàn bộ use case hoàn tất.

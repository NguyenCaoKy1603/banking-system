# Báo cáo kỹ thuật bản nháp — Banking System

`ĐỢT 3 — DRAFT DELIVERABLES`

Tài liệu này là bản nháp phục vụ bàn giao đồ án học thuật. Nội dung phân biệt
evidence local, emulator, PostgreSQL, HTTP và tài liệu tĩnh; không tuyên bố staging,
production, tích hợp ngân hàng thật hoặc KYC/AML thật.

## 1. Thông tin chờ Owner cung cấp

- Tên trường, khoa/lớp, mã học phần và mẫu bìa/bố cục chính thức.
- Tên đề tài chính thức, giảng viên hướng dẫn, danh sách thành viên và mô tả đóng góp
  đã được nhóm xác nhận.
- Hạn nộp, thời lượng bảo vệ, số slide tối đa và yêu cầu video/phụ lục.
- Quy định deployment bắt buộc (nếu có), tài khoản/tổ chức cloud và tiêu chí chấm
  checklist XLSX. File `C:\Users\admin\Downloads\00\_Checklist chấm điểm DACNTT (1).xlsx`
  hiện chưa có nên bản nháp không suy ra điểm số.

## 2. Mục tiêu và phạm vi academic

Mục tiêu là trình bày một reference implementation ngân hàng số cá nhân có thể chạy
local, minh họa registration, KYC synthetic, phân quyền RBAC quản trị trực tiếp, cấp tiền ảo,
MFA/step-up và chuyển tiền nội bộ với đối soát relational. Ưu tiên của đồ án là
nghiệp vụ dễ giải thích, dữ liệu đúng, kiểm thử hợp lý và demo được.

Phạm vi không bao gồm tiền thật, payment rail, core banking partner, KYC/AML thật,
cloud public, production observability hoặc cam kết compliance. Bản đồ hệ thống gồm **33 Use Cases** hoàn chỉnh (19 Khách hàng Mobile, 11 Quản trị Admin, 3 Tác vụ hệ thống ngầm) được đặc tả toàn diện tại [`use-cases-complete-specification.md`](../02-design/use-cases-complete-specification.md) và tổng hợp tại [`USE_CASE_ROADMAP.md`](../../USE_CASE_ROADMAP.md).


## 3. Yêu cầu chính

1. Customer đăng ký hai bước và xác minh one-time challenge; secret/OTP không đưa vào
   outbox payload.
2. Customer đăng nhập, dùng MFA và step-up trước thao tác chuyển tiền nhạy cảm.
3. KYC chỉ lưu dữ liệu synthetic/metadata và đi qua trạng thái review rõ ràng.
4. Staff dùng session/MFA và kiểm tra quyền hạn RBAC chặt chẽ; các thao tác quản trị nhạy cảm (duyệt KYC, cấp vốn, khóa tài khoản) yêu cầu step-up MFA và ghi nhận audit log đầy đủ, thực thi trực tiếp sau khi xác thực.
5. Funding là sandbox virtual money; transfer nội bộ dùng quote, phí server tính,
   idempotency key và receipt server-authoritative.
6. Account history và double-entry ledger có thể đối soát trong cùng đơn vị minor VND.
7. Module AI tích hợp qua Radox AI Gateway bằng API Key (chuẩn OpenAI API, model `gemini-3.6-flash`), hỗ trợ trả lời hướng dẫn app và tư vấn tài chính cá nhân trong ranh giới an toàn.

## 4. Kiến trúc và công nghệ

Mobile Expo/React Native gọi Public API. `RelationalHttpBoundary` chọn các service
relational, `UnitOfWork` quản lý transaction và repository ghi PostgreSQL. Admin Web
React/TypeScript/Vite gọi Admin API; action engine kiểm tra quyền RBAC, version,
step-up MFA và audit trước khi thực thi trực tiếp mutation. Email/invitation capture chỉ là provider
synthetic local.

Module AI Assistant và Financial Advice tại Backend kết nối dịch vụ Radox AI thông qua
API Key (`ASSISTANT_RADOX_API_KEY`) tới endpoint `https://radoxai.com/v1`, sử dụng mô hình
ngôn ngữ lớn `gemini-3.6-flash`. Cơ chế bảo vệ Zero-Account-Context đảm bảo không gửi dữ liệu
tài khoản hay số dư vào context của mô hình.

Sơ đồ và source anchor chi tiết:

- [`architecture-and-scope.md`](../02-design/architecture-and-scope.md)
- [`erd-core-demo.md`](../02-design/erd-core-demo.md)
- [`sequence-core-demo.md`](../02-design/sequence-core-demo.md)
- `backend/src/database/relationalHttpBoundary.ts`
- `backend/src/database/unitOfWork.ts`
- `backend/src/database/registrationService.ts`, `kycService.ts`, `transferService.ts`
- `backend/src/admin/actions/actionEngine.ts` và `backend/src/admin/http/adminHttp.ts`
- `backend/src/assistant/radoxHelpProvider.ts` và `runtimeAssistantConfig.ts`

Database dùng PostgreSQL 16 local theo migration chuẩn `001–043` trong reference
runtime. Schema chính của phần demo gồm customer/account, KYC application/review,
staff/action, transfer/transaction, ledger, audit và outbox; ERD chỉ trình bày phần
liên quan, không phải toàn bộ schema.

## 5. API, Mobile và Admin

Public contract được mô tả trong [`documents/api/banking-mvp.openapi.yaml`](../api/banking-mvp.openapi.yaml),
với các nhóm `/auth/register`, `/auth/register/verify`, `/kyc/application`,
`/internal-recipients/lookup`, `/transfers/quote`, `/transfers` và account history.
Admin contract nằm ở [`documents/api/admin.openapi.yaml`](../api/admin.openapi.yaml),
bao gồm login/MFA, customer/account masked read, KYC review, funding request,
thao tác quản trị trực tiếp và audit.

Mobile có route guard, loading/empty/error/retry cho các màn liên quan; Admin Web
hiển thị trạng thái request và lỗi quyền. UI chỉ hiển thị dữ liệu server trả về, không
tự quyết định số dư hay quyền mutation.

## 6. Các luồng nghiệp vụ đã nghiệm thu ở Đợt 2

Hồ sơ chính là [`TASK_DOT_2_CORE_BANKING_DEMO.md`](../../tasks/DEMO/TASK_DOT_2_CORE_BANKING_DEMO.md)
trên snapshot thực thi `3b38cabc39c9254231e5ef0ccb90e2ae278a532f`:

- Customer A/B synthetic, KYC submit/review, maker request và checker độc lập.
- Funding A `10,000,000 VND`.
- Hai transfer thành công: `500,000` và `5,000,000 VND`, phí `1,000 VND` mỗi giao dịch.
- Cuối kỳ A `4,498,000 VND`, B nhận `5,500,000 VND`.
- Tổng ledger debit và credit trong cùng phạm vi đều `15,502,000 minor VND`.
- Thiếu số dư bị từ chối và không tạo partial write.
- Idempotency replay, cross-account denial và maker self-approval có evidence riêng
  theo tầng. Self-approval là policy/service scope, không phải negative UI E2E độc lập.

## 7. Kiểm thử và triển khai

Evidence lịch sử đã ghi nhận local backend/mobile/admin checks, API contract và
emulator flows; xem [`evidence-index.md`](evidence-index.md) để không trộn các tầng.
Các workflow GitHub Actions tồn tại nhưng remote CI pass chưa được chứng minh trong
hồ sơ hiện tại. Local Compose có migration, healthcheck, service wiring và pinned
PostgreSQL image; cloud/managed database/HTTPS public/signed APK chưa được triển khai.

Mẫu setup nằm trong [`README.md`](../../README.md), [`backend/README.md`](../../backend/README.md),
[`admin-web/README.md`](../../admin-web/README.md) và [`mobile-app/README.md`](../../mobile-app/README.md).
Các lệnh trong README là quy trình tái hiện, không phải log đã chạy trong phiên soạn
hồ sơ này.

## 8. Giới hạn và hướng phát triển

- Reference sandbox chưa phải core banking hoặc production money movement.
- Dữ liệu KYC synthetic; không lưu document bytes/PII thật.
- Physical-device, accessibility device, usability, signed release và remote CI còn
  thiếu hoặc chỉ có evidence một phần theo từng report.
- Performance report lịch sử còn một transfer p95 vượt ngưỡng; không hạ ngưỡng để
  làm đẹp kết quả.
- Deployment tối giản cần Owner quyết định: tiếp tục local preview hay cấp một môi
  trường staging private với managed PostgreSQL, HTTPS, secret manager, domain và
  signed artifact. Không provision trong Đợt 3 hiện tại.

Future work chỉ bắt đầu sau khi có quyết định phạm vi: hoàn thiện UI cần thiết, setup
reproducible, CI remote, device/usability evidence, report diagrams, demo rehearsal
và nếu rubric bắt buộc thì staging private. Không mở rộng hardening ngoài tiêu chí.

## 9. Tài liệu tham khảo

### Nguồn trong repository

1. `PROJECT_CONTEXT.md`, `USE_CASE_ROADMAP.md`.
2. `tasks/DEMO/TASK_DOT_2_CORE_BANKING_DEMO.md`.
3. `backend/README.md`, `admin-web/README.md`, `mobile-app/README.md`.
4. `documents/api/banking-mvp.openapi.yaml` và `documents/api/admin.openapi.yaml`.
5. Migrations `backend/database/001_banking_mvp.sql` đến `043_retire_staff_invite_approval.sql`.
6. `documents/05-testing/` và `documents/07-release/` — đọc theo snapshot/ngày ghi trong
   evidence index, không coi report lịch sử là bằng chứng mới.

### Tài liệu kỹ thuật công khai

- [PostgreSQL 16 documentation](https://www.postgresql.org/docs/16/)
- [Node.js v22 API documentation](https://nodejs.org/docs/latest-v22.x/api/)
- [Expo documentation](https://docs.expo.dev/versions/latest/)
- [GitHub Actions documentation](https://docs.github.com/en/actions)
- [Mermaid documentation](https://mermaid.js.org/intro/)

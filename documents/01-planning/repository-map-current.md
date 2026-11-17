# Bản đồ repository hiện tại

> Rà soát ngày 2026-11-17. Bản đồ này chỉ đường đến source trong working tree hiện tại; nó không xác nhận mọi module đã được kiểm thử hoặc triển khai.

## Cách lần theo một chức năng

Với một flow khách hàng, bắt đầu từ màn hình trong Mobile, lần đến feature API/shared HTTP client, route trong Customer API, validator và service/repository được route gọi. Với thao tác quản trị, bắt đầu từ Admin Web, lần qua Admin API, permission registry/action engine rồi repository. Khi mutation chạm persistence, đối chiếu UnitOfWork, migration và test của đúng route group.

Trang tổng hợp về ranh giới và trạng thái nằm tại [kiến trúc](../02-design/architecture-and-scope.md), [bản đồ chức năng](../02-design/function-scope.md), [API contracts](../api/README.md) và [trạng thái hiện tại](current-status.md).

## Thành phần và entrypoint

| Khu vực | Entry point / thư mục | Vai trò |
| --- | --- | --- |
| Mobile app | mobile-app/src/app | Expo Router layouts và screens cho khách hàng |
| Mobile features | mobile-app/src/features | UI và feature state theo domain: auth, accounts, transfers, savings, credit, KYC, cards, QR, history, notifications, assistant và financial advice |
| Mobile services | mobile-app/src/services/api | HTTP client, transport/config, response validation và API types |
| Customer API | backend/src/server.ts, backend/src/http.ts, backend/src/routes, backend/src/controllers, backend/src/middlewares | Startup, routing, controllers, middlewares cho khách hàng; guards, input validation và domain dispatch |
| Domain/reference runtime | backend/src/domain, backend/src/services/coreBanking.ts, backend/src/bankingSystem.ts | Pure domain (ledger, money, savings, credit), application services và reference orchestration |
| PostgreSQL | backend/src/database, backend/database | UnitOfWork, relational services/repositories (gồm postgresRelationalRepository.ts), pool và migration SQL forward-only |
| Admin API | backend/src/adminServer.ts, backend/src/admin | Staff auth/session, permission registry, action/maker-checker, repositories và audit |
| Admin Web | admin-web/src | Staff UI, auth context, router, operations và domain features |
| Worker | backend/src/worker.ts, backend/src/workers, backend/src/outbox | Process opt-in cho outbox và scheduled lifecycle |
| Assistant / advice | backend/src/assistant, backend/src/financialAdvice, mobile-app/src/features/assistant, mobile-app/src/features/financial-advice | FAQ catalog selector và calculator/advice flow; provider model tùy chọn, không phải nguồn sự thật tài chính |
| Runtime configuration | backend/src/runtimeConfig.ts, mobile-app/src/runtime | Environment parsing, fail-closed policy và public client configuration |
| Scripts / gates | backend/scripts, package.json trong từng app | Migration, validation, evaluation, smoke và release tooling; script tồn tại không đồng nghĩa đã chạy trong lượt này |

## Bản đồ theo ứng dụng

### Mobile

- Screens/layout: `mobile-app/src/app` (`_layout.tsx` quản lý Protected Stack, Privacy Shield overlay khi `background`/`inactive` và khôi phục tuyến đường sau khi mở khóa).
- Feature modules: `mobile-app/src/features`. Thư mục mô tả domain; flow có thể đi qua service dùng chung và không phải mỗi feature tương ứng một API độc lập. Các điểm neo quan trọng mới:
  - `mobile-app/src/features/auth/context/AuthContext.tsx`: quản lý phiên, cửa sổ ân hạn nền 30 giây (`BACKGROUND_LOCK_GRACE_MS`) và silent foreground token refresh.
  - `mobile-app/src/features/auth/domain/routePreservation.ts`: chuẩn hóa & khôi phục tuyến đường authenticated sau khi mở khóa.
  - `mobile-app/src/features/auth/storage/mfaEnrollmentMemoryCache.ts`: cache RAM tạm theo `sessionEpoch` cho khóa thiết lập TOTP và challenge MFA (tuyệt đối không lưu đĩa).
  - `mobile-app/src/features/qr/screens/QrScreen.tsx`: QR của tôi & tự động xin quyền/bật camera sau quét QR (`facing="back"`, ranh giới `D-20`).
  - `mobile-app/src/features/transfers/screens/TransferScreen.tsx` & `components/TransferStepViews.tsx`: tách UI 5 bước, hỗ trợ chọn tài khoản nguồn, đồng bộ route params QR và tự động gọi `lookupInternalRecipient` xác minh phía server mà không ghi đè crash-recovery intent.
  - `mobile-app/src/features/credit/screens/CreditApplicationScreen.tsx`: yêu cầu KYC `APPROVED` (kiểm tra qua `useFocusEffect`) trước khi cho nộp đề nghị mở thẻ tín dụng.
  - `mobile-app/src/features/history/screens/HistoryScreen.tsx` & `presentation/historySummary.ts`: thống kê Thu/Chi/Chênh lệch ròng theo tháng hiện tại bằng `BigInt`, chọn tài khoản và hướng dẫn phân trang khi lọc.
  - `mobile-app/src/features/home/screens/HomeScreen.tsx` & `components/BalanceCard.tsx`: cộng dồn tổng số dư thực trên tất cả tài khoản thanh toán và hỗ trợ chuyển đổi tài khoản.
  - `mobile-app/src/features/kyc/screens/KycScreen.tsx`: form định danh tổng hợp (`mock://` fixture) kèm ghi chú sandbox bảo vệ PII.
- API transport: `mobile-app/src/services/api/httpClient.ts`, `config.ts`, `responseValidators.ts` và `types.ts`.
- Shared UI/runtime: mobile-app/src/components, mobile-app/src/runtime, mobile-app/src/theme, mobile-app/src/types.
- Transport và error mapping được mô tả tại [kiến trúc](../02-design/architecture-and-scope.md); endpoint contract Draft nằm trong [API index](../api/README.md).

### Backend khách hàng

- Startup & HTTP contract/runtime path: backend/src/server.ts, backend/src/http.ts, backend/src/routes/, backend/src/controllers/, backend/src/middlewares/.
- Domain & Services: backend/src/domain/ (ledger.ts, money.ts, savings/, credit/), backend/src/services/coreBanking.ts, bankingSystem.ts, security.ts.
- Relational route boundary: backend/src/database/relationalHttpBoundary.ts.
- Persistence services và transactions: backend/src/database (UnitOfWork, services gồm `creditService.ts` với guard `KYC_REQUIRED` tại `submitApplication`, repositories gồm `auditRepository.ts` ghi thêm `trace_id`, `postgresRelationalRepository.ts` và `postgresSnapshotRepository.ts`).
- Runtime mode/guards: backend/src/runtimeConfig.ts (`compose.yaml` và `backend/.env.example` mặc định `BANKING_PERSISTENCE_MODE=relational-v2`); release metadata: backend/src/runtimeMetadata.ts.
- OpenAPI/narrative là Draft/reference; so sánh route, validator, Mobile caller và migration trước khi dựa vào contract.

### Admin và worker

- Admin API có process riêng tại backend/src/adminServer.ts. Routes/session/CSRF ở backend/src/admin/http; permissions ở backend/src/admin/authorization; action engine và maker-checker ở backend/src/admin/actions; persistence ở backend/src/admin/repositories.
- Admin Web dùng admin-web/src/App.tsx, router.ts và các module trong admin-web/src/features (trong đó `applications/Applications.tsx` đối chiếu định dạng CCCD 6–24 chữ số khớp Backend `kycService.ts`); kiểm tra route/permission runtime khi đọc matrix tĩnh.
- Worker có process riêng tại backend/src/worker.ts. Runtime và scheduled jobs nằm trong backend/src/workers; outbox event policy/runtime nằm trong backend/src/outbox. Worker yêu cầu opt-in và guard cutover.
- Admin/worker topology và giới hạn được giải thích trong [architecture overview](../02-design/architecture-and-scope.md) và [Admin index](../admin/README.md).

## Database và API contracts

- Migration SQL được đánh số tại backend/database. Quy tắc migration nằm trong backend/database/README.md và [migration runbook](../07-release/migration-runbook.md); giữ nguyên thứ tự/checksum, chỉ thêm migration forward-only theo quy trình.
- OpenAPI và narrative contracts nằm tại documents/api. Validator scripts nằm trong backend/scripts và mobile-app/scripts.
- Migration không tự chứng minh route đã cutover; xem [OpenAPI routes và contract](../api/README.md).

## Vùng lịch sử và giới hạn

- documents/01-planning/repository-map.md là bản đồ theo giai đoạn cũ; dùng trang hiện tại này để định vị source.
- Thư mục hoặc migration legacy có thể còn vì lịch sử/dữ liệu tương thích, dù flow UI/API đã bị gỡ. Kiểm tra route export, router registration và runtime caller trước khi gọi một tính năng là đang dùng.
- Tài liệu này không đổi quyền sở hữu source: phạm vi thay đổi vẫn theo root AGENTS.md và mobile-app/AGENTS.md.

# Bản đồ repository hiện tại

> Rà soát ngày 2026-11-25 (`main` @ `220bb4d`). Bản đồ này chỉ đường đến source trong working tree hiện tại; nó không xác nhận mọi module đã được kiểm thử trên thiết bị thật hoặc triển khai staging.

## Cách lần theo một chức năng

Với một flow khách hàng, bắt đầu từ màn hình trong Mobile, lần đến feature API/shared HTTP client, route trong Customer API, validator và service/repository được route gọi. Với thao tác quản trị, bắt đầu từ Admin Web, lần qua Admin API, permission registry/action engine rồi repository. Khi mutation chạm persistence, đối chiếu UnitOfWork, migration và test của đúng route group.

Trang tổng hợp về ranh giới và trạng thái nằm tại [kiến trúc](../02-design/architecture-and-scope.md), [bản đồ chức năng](../02-design/function-scope.md), [API contracts](../api/README.md) và [trạng thái hiện tại](current-status.md).

## Thành phần và entrypoint

| Khu vực | Entry point / thư mục | Vai trò |
| --- | --- | --- |
| Mobile app | mobile-app/src/app | Expo Router layouts và screens cho khách hàng |
| Mobile features | `mobile-app/src/features` | UI và feature state theo domain: auth, accounts, anomalies, transfers, savings, credit, KYC, cards, QR/VietQR, history, notifications, profile/devices, assistant và financial advice |
| Mobile services | `mobile-app/src/services/api`, `mobile-app/src/services/security`, `mobile-app/src/utils` | HTTP client, transport/config (hỗ trợ dynamic LAN URL trên web), response validators, `biometricAuth.ts` (`biometric-v1`) và `uuid.ts` (UUIDv4 fallback) |
| Customer API | `backend/src/server.ts`, `backend/src/http.ts`, `backend/src/routes`, `backend/src/controllers`, `backend/src/middlewares` | Startup, routing (gồm `anomalyRoutes.ts`, password/device, external lookup, summary/export), controllers, middlewares cho khách hàng |
| Domain/reference runtime | `backend/src/domain`, `backend/src/services/coreBanking.ts`, `backend/src/bankingSystem.ts` | Pure domain (`ledger`, `money`, `savings`, `credit`, `anomaly`, `napas/mockNapasGateway`), application services và reference orchestration |
| PostgreSQL | `backend/src/database`, `backend/database` | UnitOfWork, relational services/repositories (`transferService`, `anomalyService`, `relationalAccountReadService`, `relationalAuthService`, `controlPolicyRepository`, v.v.), pool và 51 migration SQL forward-only (`001`–`051`) |
| Admin API | `backend/src/adminServer.ts`, `backend/src/admin` | Staff auth/session, permission registry (63 routes), action/maker-checker, control policy, ledger reconciliation, anomaly resolution, repositories và audit |
| Admin Web | `admin-web/src` | Staff UI (5 nhóm điều hướng), auth context, router (`#/policy`, `#/transfers`, v.v.), `PolicyView`, `Transfers` (kèm anomaly queue) và domain features |
| Worker | backend/src/worker.ts, backend/src/workers, backend/src/outbox | Process opt-in cho outbox và scheduled lifecycle |
| Assistant / advice | backend/src/assistant, backend/src/financialAdvice, mobile-app/src/features/assistant, mobile-app/src/features/financial-advice | FAQ catalog selector và calculator/advice flow; provider model tùy chọn, không phải nguồn sự thật tài chính |
| Runtime configuration | backend/src/runtimeConfig.ts, mobile-app/src/runtime | Environment parsing, fail-closed policy và public client configuration |
| Scripts / gates | backend/scripts, package.json trong từng app | Migration, validation, evaluation, smoke và release tooling; script tồn tại không đồng nghĩa đã chạy trong lượt này |

## Bản đồ theo ứng dụng

### Mobile

- Screens/layout: `mobile-app/src/app` (`_layout.tsx` quản lý Protected Stack, màn hình khóa hỗ trợ mở khóa sinh trắc học, Privacy Shield overlay khi `background`/`inactive` và khôi phục tuyến đường; các tuyến mới: `(auth)/forgot-password.tsx`, `change-password.tsx`, `devices.tsx`, `anomalies.tsx`).
- Feature modules: `mobile-app/src/features`. Thư mục mô tả domain; flow có thể đi qua service dùng chung và không phải mỗi feature tương ứng một API độc lập. Các điểm neo quan trọng:
  - `mobile-app/src/features/auth/`: `AuthContext.tsx` (cửa sổ ân hạn 30 giây, silent refresh), `domain/routePreservation.ts`, `storage/mfaEnrollmentMemoryCache.ts`, `storage/biometricCredentialStorage.ts`, `screens/MfaMethodsScreen.tsx` (TOTP + đăng ký/hủy Biometric), `screens/ChangePasswordScreen.tsx` và `screens/ForgotPasswordScreen.tsx`.
  - `mobile-app/src/features/profile/screens/DevicesScreen.tsx`: liệt kê thiết bị đăng nhập và thu hồi thiết bị/phiên từ xa.
  - `mobile-app/src/features/anomalies/`: `AnomalyAlertsScreen.tsx`, `anomalyApi.ts`, `anomalyPresentation.ts`, `anomalyResponseValidators.ts` — xem cảnh báo giao dịch bất thường và gửi xác nhận `CONFIRMED_SAFE` / `REPORTED_SUSPICIOUS`.
  - `mobile-app/src/features/qr/`: `screens/QrScreen.tsx`, `validation/vietQrCodec.ts` (EMVCo TLV + CRC-16/CCITT-FALSE, VietQR tĩnh/động) và `validation/qrPayload.ts` (NOVA QR v2 & VietQR, giữ ranh giới `D-20` luôn kiểm tra định dạng trước khi chuyển sang `/transfer` để server đối soát).
  - `mobile-app/src/features/transfers/`: `screens/TransferScreen.tsx` & `components/TransferStepViews.tsx` — hỗ trợ cả rail nội bộ (`INTERNAL`) và liên ngân hàng mô phỏng (`NAPAS_IBFT`), chọn tài khoản nguồn, tự động gọi `lookupInternalRecipient` / `lookupExternalRecipient` từ QR, step-up TOTP hoặc Biometric (≤ 1.000.000 VND) và xác nhận cảnh báo rủi ro bất thường.
  - `mobile-app/src/features/credit/screens/CreditApplicationScreen.tsx`: yêu cầu KYC `APPROVED` (kiểm tra qua `useFocusEffect`) trước khi cho nộp đề nghị mở thẻ tín dụng.
  - `mobile-app/src/features/history/`: `screens/HistoryScreen.tsx`, `screens/TransactionDetailScreen.tsx`, `presentation/historyFilters.ts`, `presentation/historySummary.ts` — lọc phía server (`status`, `direction`, `from`, `to`, `q`), thống kê Thu/Chi tháng từ `GET /accounts/{id}/summary` và xuất/chia sẻ sao kê CSV/HTML.
  - `mobile-app/src/features/home/screens/HomeScreen.tsx` & `components/BalanceCard.tsx`: cộng dồn tổng số dư thực trên tất cả tài khoản thanh toán và hỗ trợ chuyển đổi tài khoản.
  - `mobile-app/src/features/kyc/screens/KycScreen.tsx`: form định danh tổng hợp (`mock://` fixture) kèm ghi chú sandbox bảo vệ PII.
- API transport & security: `mobile-app/src/services/api/httpClient.ts`, `config.ts` (tự động suy ra host LAN khi chạy web), `responseValidators.ts`, `mobile-app/src/services/security/biometricAuth.ts` (`biometric-v1`) và `mobile-app/src/utils/uuid.ts` (UUIDv4 an toàn cho HTTP LAN web).
- Shared UI/runtime: `mobile-app/src/components`, `mobile-app/src/runtime`, `mobile-app/src/theme`, `mobile-app/src/types`.
- Transport và error mapping được mô tả tại [kiến trúc](../02-design/architecture-and-scope.md); endpoint contract Draft nằm trong [API index](../api/README.md).

### Backend khách hàng

- Startup & HTTP contract/runtime path: `backend/src/server.ts`, `backend/src/http.ts`, `backend/src/routes/` (gồm `anomalyRoutes.ts`, `authRoutes.ts`, `accountRoutes.ts`, `transferRoutes.ts`, v.v.), `backend/src/controllers/`, `backend/src/middlewares/`.
- Domain & Services: `backend/src/domain/` (`ledger.ts`, `money.ts`, `savings/`, `credit/`, `anomaly/`, `napas/mockNapasGateway.ts`), `backend/src/services/coreBanking.ts`, `bankingSystem.ts`, `security.ts`, `mfa/crypto.ts` & `mfa/persistentMfaService.ts` (TOTP + `BIOMETRIC` device-bound).
- Relational route boundary: `backend/src/database/relationalHttpBoundary.ts`.
- Persistence services và transactions: `backend/src/database/` (`UnitOfWork`, `transferService.ts` với NAPAS two-phase `held_minor` & anomaly scoring, `anomalyService.ts`, `relationalAccountReadService.ts` với filter/summary/CSV-HTML export, `relationalAuthService.ts` với password change/reset & device management, `controlPolicyRepository.ts` với `daily_transfer_limit_minor` & `transfer_fee_minor`, `creditService.ts` với guard `KYC_REQUIRED`, `repositories/` gồm `anomalyRepository.ts` & `auditRepository.ts`).
- Runtime mode/guards: `backend/src/runtimeConfig.ts` (`compose.yaml` và `backend/.env.example` mặc định `BANKING_PERSISTENCE_MODE=relational-v2`); release metadata: `backend/src/runtimeMetadata.ts`.
- OpenAPI/narrative là Draft/reference; so sánh route, validator, Mobile caller và migration trước khi dựa vào contract.

### Admin và worker

- Admin API có process riêng tại `backend/src/adminServer.ts`. Routes/session/CSRF ở `backend/src/admin/http/adminHttp.ts`; permissions ở `backend/src/admin/authorization/permissionRegistry.ts` (`63` routes); action engine và maker-checker ở `backend/src/admin/actions/actionEngine.ts`; persistence ở `backend/src/admin/repositories/adminRepository.ts` (bổ sung `getControlPolicy`, `updateControlPolicy`, `reconcileLedger`, anomaly list/resolve).
- Admin Web dùng `admin-web/src/App.tsx`, `router.ts` và các module trong `admin-web/src/features` (bổ sung `policy/PolicyView.tsx` cho chính sách & đối soát sổ cái, cập nhật `transfers/Transfers.tsx` với hàng đợi cảnh báo bất thường và `overview/Overview.tsx`, cùng `applications/Applications.tsx` đối chiếu CCCD 6–24 chữ số); kiểm tra route/permission runtime khi đọc matrix tĩnh.
- Worker có process riêng tại `backend/src/worker.ts`. Runtime và scheduled jobs nằm trong `backend/src/workers` (`lifecycleScheduler.ts` bổ sung `reconcilePendingInterbankTransfers` song song đáo hạn tiết kiệm và sao kê/quá hạn tín dụng); outbox event policy/runtime nằm trong `backend/src/outbox` (bổ sung `security.anomaly_detected` và `security.anomaly_acknowledged`). Worker yêu cầu opt-in và guard cutover.
- Admin/worker topology và giới hạn được giải thích trong [architecture overview](../02-design/architecture-and-scope.md) và [Admin index](../admin/README.md).

## Database và API contracts

- 51 migration SQL (`001`–`051`) được đánh số tại `backend/database`. Quy tắc migration nằm trong [`backend/database/README.md`](../../backend/database/README.md) và [migration runbook](../07-release/migration-runbook.md); giữ nguyên thứ tự/checksum, chỉ thêm migration forward-only theo quy trình.
- OpenAPI (`banking-mvp.openapi.yaml` 70 paths / 77 ops; `admin.openapi.yaml` 62 paths / 63 ops) và narrative contracts nằm tại `documents/api`. Validator scripts nằm trong `backend/scripts` và `mobile-app/scripts`.
- Migration không tự chứng minh route đã cutover; xem [OpenAPI routes và contract](../api/README.md).

## Vùng lịch sử và giới hạn

- Bản đồ theo giai đoạn cũ đã được dọn gọn; dùng trang hiện tại này để định vị source.
- Thư mục hoặc migration legacy (như bảng `fraud_reports` cũ trước D-39) có thể còn vì lịch sử/dữ liệu tương thích, dù flow UI/API cũ đã bị gỡ. Kiểm tra route export, router registration và runtime caller trước khi gọi một tính năng là đang dùng.
- Tài liệu này không đổi quyền sở hữu source: phạm vi thay đổi vẫn theo root `AGENTS.md` và `mobile-app/AGENTS.md`.

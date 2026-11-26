# Kiến trúc hệ thống và phạm vi

> Snapshot source: 2026-11-25, branch `main` @ `220bb4d`. Mô tả academic/reference system dùng tiền ảo (51 migrations `001`–`051`); không phải kiến trúc ngân hàng production.

## 1. Topology

~~~mermaid
flowchart LR
  subgraph Client
    M[Mobile Expo / React Native]
    AW[Admin Web]
  end
  subgraph Backend
    P[Public API]
    AG[Auth, device, TOTP/Biometric & request guards]
    R[RelationalHttpBoundary]
    DOMAIN[Customer domain services & Anomaly engine]
    NAPAS[Mock NAPAS IBFT Gateway]
    ADMIN[Admin API]
    ACT[Staff auth, RBAC, action engine, Policy & Reconciliation]
    W[Optional worker & Lifecycle Scheduler]
    AI[Assistant and Financial Advice]
  end
  DB[(PostgreSQL 16)]
  O[Outbox / audit / double-entry ledger]
  LLM[Radox AI provider]
  M --> P --> AG --> R --> DOMAIN
  DOMAIN --> NAPAS
  DOMAIN --> DB
  DOMAIN --> O
  AW --> ADMIN --> ACT --> DB
  W --> DB
  W --> NAPAS
  AI -. enabled by runtime config .-> LLM
~~~

Public API, Admin API và Worker là entrypoint/process riêng. Admin Web dùng staff session riêng với customer bearer session; đây là hai security realms khác nhau.

## 2. Ranh giới và trách nhiệm

| Thành phần | Làm gì | Không phải |
| --- | --- | --- |
| Mobile | Thu thập input, gọi API, validate response, giữ UI state, hiển thị loading/empty/error, lưu một số intent cần resume | Nguồn authoritative cho balance, phí, lãi, debt hoặc transaction status |
| Public API | Auth/device check, request validation, routing, rate/deadline guards và domain dispatch | API của ngân hàng/partner |
| RelationalHttpBoundary | Chọn route group đã cutover và chuyển tới PostgreSQL relational service | Bằng chứng tất cả route đều đã relational |
| Domain services + UnitOfWork | Business invariants, transaction/lock, idempotency, đánh giá rủi ro anomaly tất định, hạch toán 2 pha `held_minor` cho mock NAPAS IBFT, ledger/audit/outbox persistence | Core/ledger processor hoặc cổng NAPAS 247 thật bên ngoài |
| Admin API/Web | Staff auth, permission checks (`63` routes), maker-checker/direct actions, quản trị chính sách & biểu phí động (`control_policy`), đối soát sổ cái kép (Trial Balance), xử lý anomaly và operations views | Public customer API |
| Worker | Outbox dispatch, scheduled lifecycle (đáo hạn tiết kiệm, sao kê/quá hạn tín dụng, đối soát giao dịch liên ngân hàng `NAPAS_IBFT` treo), lease, retry, health | Tự chạy trong mọi deployment; process cần opt-in/cutover |
| Assistant | Hướng dẫn FAQ qua controlled selection; Financial Advice dùng calculator và bounded selector | Công cụ thực hiện giao dịch hoặc nguồn số dư |
| PostgreSQL | Persistence reference, constraints, migration history và transactional boundary | Managed production database đã được provision |

## 3. Persistence modes

- BANKING_STORAGE chọn postgres hoặc in-memory.
- BANKING_PERSISTENCE_MODE chọn legacy-state hoặc relational-v2.
- Local Compose/reference setup hướng tới PostgreSQL relational-v2.
- Relational-v2 mặc định bật các route groups `auth, registration, mfa, accounts, beneficiaries, transfers, savings, credit, recipients, notifications, kyc` (bao gồm các tuyến mới: đổi/quên/đặt lại mật khẩu, quản lý thiết bị, biometric MFA enroll, tra cứu người nhận liên ngân hàng, lọc/thống kê/xuất sao kê tài khoản và cảnh báo giao dịch bất thường).
- Những route không thuộc nhóm đã bật không được suy diễn là đã chuyển sang relational boundary.
- Staging/production-like runtime fail closed nếu thiếu điều kiện persistence, HTTPS allow-list, secret/config metadata, TOTP, virtual-money mode hoặc release identity.
- Hệ thống hiện có 51 migration forward-only (`001`–`051`), bao gồm chuẩn hóa `ledger_entries.account_ref` sang `payment-account:<uuid>` (`047`), hạn mức ngày & phí động (`048`, `051`), hạch toán 2 pha `NAPAS_IBFT` (`049`), anomaly detection (`045`), biometric MFA (`046`) và password reset/device metadata (`050`). Migration mới phải forward-only, đúng thứ tự/checksum và chỉ chạy destructive test trên database disposable đã guard xác nhận.

Chi tiết migration nằm trong [ADR PostgreSQL](../07-architecture/p0-postgres-relational-v2-adr.md) và [migration runbook](../07-release/migration-runbook.md).

## 4. Data flow: customer request

1. Mobile feature screen gọi feature API; shared HTTP client thêm Bearer token, X-Device-ID, request ID và Idempotency-Key khi nghiệp vụ cần.
2. Backend kiểm tra method/path, body, origin, auth, owner/device binding, role hoặc step-up theo route.
3. Handler validate input rồi gọi service trong route boundary phù hợp.
4. Service kiểm tra business rules; PostgreSQL path dùng UnitOfWork transaction cho mutation, ledger, audit, idempotency và outbox liên quan.
5. API trả trạng thái server-authoritative. Mobile chuyển state theo response; khi trạng thái không rõ thì truy vấn/resume theo resource/idempotency contract thay vì tự kết luận giao dịch thành công.
6. HTTP/network errors được map thành lỗi an toàn và thân thiện; timeout, unauthorized, validation, rate limit, provider outage và retry là các trạng thái riêng.

## 5. Data flow: Admin action

1. Staff đăng nhập qua Admin API; cookie session, CSRF/origin và MFA policy được kiểm tra theo environment.
2. Permission registry quyết định route/action; mặc định deny khi không có permission.
3. Action engine lưu request, fingerprint, idempotency và audit context.
4. Với action cần maker-checker, người tạo không được tự duyệt. Checker đủ quyền mới execute payload đã review.
5. Kết quả thay đổi state qua repository/transaction boundary; Admin Web tải lại trạng thái authoritative.

## 6. Data flow: assistant

- Mobile gọi Backend, không gọi trực tiếp AI provider.
- Assistant Help chặn secret/sensitive input, thử nhánh deterministic trước, rồi mới gọi provider nếu được bật.
- AI provider (Radox) chỉ chọn một ID trong catalog; Backend kiểm tra ID và trả answer cố định từ catalog.
- Provider mặc định bị tắt nếu ASSISTANT_ENABLED không bằng 1. Runtime hiện cấu hình qua provider `radox` (model mặc định `gemini-3.6-flash`, URL `https://radoxai.com/v1`, yêu cầu `ASSISTANT_RADOX_API_KEY`).
- Financial Advice là endpoint riêng: calculator xác định facts/options trước, selector chọn trong tập hợp được policy cho phép và fallback khi provider lỗi/timeout/budget hết.
- Không lấy Mobile telemetry, auth token hoặc giao dịch cá nhân làm prompt. Không gửi secret/OTP/PIN/password/CVV vào câu hỏi.

Saved evaluation của assistant cho thấy còn lỗi chọn ý định; xem [AI README](../06-security-ai/README.md). Đừng hiểu controlled catalog là bảo đảm mô hình luôn chọn đúng.

## 7. Side effects và worker

Business transaction có thể ghi outbox/audit cùng state để xử lý side effect sau commit. Worker chạy riêng, yêu cầu WORKER_ENABLED=1 và cutover confirmation; nó từ chối chạy khi persistence mode chưa relational-v2 nếu legacy writer chưa được cho phép. Provider email/push hiện ở boundary fake/disabled cho tới khi adapter và secret được phê duyệt.

## 8. Giới hạn phạm vi

- Luôn dùng tiền ảo và synthetic customer data.
- Không có core banking, payment rail thật (`MockNapasGateway` là cổng mô phỏng tất định local), card processor, KYC/AML hoặc push provider thật đã xác minh.
- Cơ chế sinh trắc học `biometric-v1` là challenge-response mật mã gắn thiết bị ở mức reference; chưa thay thế hardware-backed Passkey/WebAuthn attestation chuẩn FIDO2.
- API/OpenAPI và nghiệp vụ liên quan vẫn có trạng thái Draft/reference.
- Local Compose, test database và emulator không chứng minh cloud, thiết bị thật hoặc staging.
- Legacy `fraud_reports` workflow đã bị gỡ khỏi UI/API/Admin hiện hành (D-39); bảng cũ không phải feature đang vận hành. Luồng phát hiện giao dịch bất thường mới (`transaction_anomalies`, migration `045`) là bộ quy tắc heuristic cục bộ, tách biệt với bảng cũ và không thay thế hệ thống FDS/AML thật.

## 9. Source anchors

- Public startup: `backend/src/server.ts`; route boundary: `backend/src/http.ts`; routes/controllers: `backend/src/routes/`, `backend/src/controllers/`.
- Domain engines: `backend/src/domain/ledger.ts`, `domain/anomaly/`, `domain/napas/mockNapasGateway.ts`, `domain/savings/`, `domain/credit/`.
- Runtime guards: `backend/src/runtimeConfig.ts`.
- Relational boundary: `backend/src/database/relationalHttpBoundary.ts`; transaction: `backend/src/database/unitOfWork.ts`; policy: `backend/src/database/controlPolicyRepository.ts`.
- Admin startup/action: `backend/src/adminServer.ts`; `backend/src/admin/http/adminHttp.ts`; `backend/src/admin/authorization/permissionRegistry.ts`; `backend/src/admin/actions/actionEngine.ts`; `backend/src/admin/repositories/adminRepository.ts`.
- Worker: `backend/src/worker.ts`; `backend/src/workers/workerRuntime.ts`; `backend/src/workers/lifecycleScheduler.ts`.
- Mobile HTTP & Security: `mobile-app/src/services/api/httpClient.ts`; `mobile-app/src/services/api/config.ts`; `mobile-app/src/services/security/biometricAuth.ts`; `mobile-app/src/features/qr/validation/vietQrCodec.ts`.

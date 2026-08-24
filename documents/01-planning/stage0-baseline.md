# Giai đoạn 0 — Baseline Git/CI

Ngày lập: 2026-08-24 (Asia/Bangkok)

## Phạm vi và nguyên tắc đóng băng

Đây là biên bản trước khi tách commit cho các thay đổi đã có trong working tree. Từ sau mốc này không thêm nghiệp vụ mới; mọi chỉnh sửa phát hiện trong quality gate phải đi thành commit sửa lỗi riêng. Backend vẫn là reference sandbox, API/OpenAPI là Draft và không được dùng để tuyên bố production/pilot readiness.

## Trạng thái Git tại mốc baseline

| Thuộc tính | Giá trị |
| --- | --- |
| Branch | `codex/mini-core-banking-sandbox` |
| HEAD / commit gốc | `90af8dc34910262e7d439e2440d1f3bae77a3308` (`Refresh sandbox OTP checkpoint`) |
| Upstream | Chưa có |
| Remote | `origin` → `https://github.com/NguyenCaoKy1603/banking-system.git` |
| Remote branch quan sát được | `origin/feature/mobile-authentication` tại `b2eef7d2ad6cef9fac71a570548812021e66b48b` |
| Chênh lệch lịch sử | HEAD đi trước remote branch 50 commit; remote branch không đi trước HEAD |
| Remote `main` | Chưa tồn tại tại thời điểm kiểm tra |
| Tracked files đang sửa | 76 |
| Untracked files trước tài liệu Stage 0 | 18 (nằm trong 10 directory/module) |
| Diff tracked | 6.833 dòng thêm, 981 dòng xóa |
| Lockfile/workflow | Đã được theo dõi; không thay đổi dependency trong baseline |
| `.env` | Được ignore; chỉ `.env.example` được phép theo dõi |

Các số lượng trên là snapshot trước khi thêm `.gitattributes` và tài liệu baseline này. Hai file Stage 0 là metadata kiểm soát thay đổi, không phải nghiệp vụ mới.

## Phân loại toàn bộ file thay đổi

### 1. Backend runtime và persistence

- `backend/README.md`
- `backend/scripts/validate-openapi.cjs`
- `backend/src/bankingSystem.ts`
- `backend/src/coreBanking.ts`
- `backend/src/credit.ts`
- `backend/src/http.ts`
- `backend/src/postgresRelationalRepository.ts`
- `backend/src/savings.ts`

### 2. Backend regression và security/persistence test

- `backend/src/tests/bankingSystem.test.ts`
- `backend/src/tests/credit-http.test.ts`
- `backend/src/tests/credit.test.ts`
- `backend/src/tests/http-security-persistence.test.ts`
- `backend/src/tests/http.test.ts`
- `backend/src/tests/miniCoreSandbox.test.ts`
- `backend/src/tests/persistence.test.ts`
- `backend/src/tests/relationalPersistence.test.ts`
- `backend/src/tests/savings-http.test.ts`
- `backend/src/tests/savings.test.ts`

### 3. API/OpenAPI contract và validator

- `documents/api/auth-api-contract.md`
- `documents/api/auth-session-api-contract.md`
- `documents/api/banking-mvp-api-contract.md`
- `documents/api/banking-mvp.openapi.yaml`
- `mobile-app/scripts/validate-openapi.cjs`

### 4. Mobile auth/session/HTTP boundary

- `mobile-app/src/app/_layout.tsx`
- `mobile-app/src/features/auth/context/AuthContext.tsx`
- `mobile-app/src/features/auth/context/__tests__/AuthContext.test.tsx`
- `mobile-app/src/features/auth/domain/refreshFailure.ts`
- `mobile-app/src/features/auth/domain/__tests__/refreshFailure.test.ts`
- `mobile-app/src/features/auth/screens/LoginScreen.tsx`
- `mobile-app/src/features/auth/screens/RegisterScreen.tsx`
- `mobile-app/src/features/auth/services/authApi.ts`
- `mobile-app/src/features/auth/services/__tests__/authApi.test.ts`
- `mobile-app/src/features/auth/services/authResponseValidators.ts`
- `mobile-app/src/features/auth/storage/authSessionStorage.ts`
- `mobile-app/src/features/auth/storage/__tests__/authSessionStorage.test.ts`
- `mobile-app/src/features/auth/types/auth.ts`
- `mobile-app/src/features/auth/types/session.ts`
- `mobile-app/src/features/auth/types/__tests__/session.test.ts`
- `mobile-app/src/services/api/httpClient.ts`
- `mobile-app/src/services/api/__tests__/httpClient.test.ts`

### 5. Mobile intent/idempotency primitives

- `mobile-app/src/features/banking/domain/clientIntentLifecycle.ts`
- `mobile-app/src/features/banking/domain/submitFailure.ts`
- `mobile-app/src/features/banking/domain/__tests__/clientIntentLifecycle.test.ts`
- `mobile-app/src/features/banking/domain/__tests__/submitFailure.test.ts`
- `mobile-app/src/features/banking/services/__tests__/bankingApi.test.ts`
- `mobile-app/src/features/banking/storage/intentRecovery.ts`
- `mobile-app/src/features/banking/storage/secureStoreScope.ts`
- `mobile-app/src/features/banking/storage/__tests__/secureStoreScope.test.ts`
- `mobile-app/src/features/banking/validation/idempotencyKey.ts`
- `mobile-app/src/features/banking/validation/__tests__/idempotencyKey.test.ts`

### 6. Transfer, Savings, Credit và Fraud recovery flow

- `mobile-app/src/features/transfers/screens/TransferScreen.tsx`
- `mobile-app/src/features/transfers/services/transfersApi.ts`
- `mobile-app/src/features/transfers/storage/transferIntentStorage.ts`
- `mobile-app/src/features/transfers/storage/__tests__/transferIntentStorage.test.ts`
- `mobile-app/src/features/credit/screens/CreditApplicationScreen.tsx`
- `mobile-app/src/features/credit/screens/CreditPaymentScreen.tsx`
- `mobile-app/src/features/credit/services/creditApi.ts`
- `mobile-app/src/features/credit/services/__tests__/creditApi.test.ts`
- `mobile-app/src/features/credit/storage/cardPaymentIntentStorage.ts`
- `mobile-app/src/features/credit/storage/__tests__/cardPaymentIntentStorage.test.ts`
- `mobile-app/src/features/savings/screens/OpenSavingsScreen.tsx`
- `mobile-app/src/features/savings/services/savingsApi.ts`
- `mobile-app/src/features/savings/storage/savingsIntentStorage.ts`
- `mobile-app/src/features/savings/storage/__tests__/savingsIntentStorage.test.ts`
- `mobile-app/src/features/fraud/domain/fraudReportSubmitFailure.ts`
- `mobile-app/src/features/fraud/domain/__tests__/fraudReportSubmitFailure.test.ts`
- `mobile-app/src/features/fraud/screens/FraudReportScreen.tsx`
- `mobile-app/src/features/fraud/services/fraudReportsApi.ts`
- `mobile-app/src/features/fraud/services/__tests__/fraudReportsApi.test.ts`
- `mobile-app/src/features/fraud/storage/fraudReportIntentStorage.ts`
- `mobile-app/src/features/fraud/storage/__tests__/fraudReportIntentStorage.test.ts`

### 7. QR/KYC/biometric/security/navigation boundary

- `mobile-app/src/features/kyc/screens/KycScreen.tsx`
- `mobile-app/src/features/kyc/services/kycMock.ts`
- `mobile-app/src/features/kyc/services/__tests__/kycMock.test.ts`
- `mobile-app/src/features/profile/screens/ProfileScreen.tsx`
- `mobile-app/src/features/qr/screens/QrScreen.tsx`
- `mobile-app/src/features/qr/types/qr.ts`
- `mobile-app/src/features/qr/validation/qrPayload.ts`
- `mobile-app/src/features/qr/validation/__tests__/qrPayload.test.ts`
- `mobile-app/src/services/security/biometricAuth.ts`
- `mobile-app/src/services/security/__tests__/biometricAuth.test.ts`

### 8. E2E flow và evidence

- `mobile-app/e2e/maestro/README.md`
- `mobile-app/e2e/maestro/critical-m0-m4-m8.yaml`

### 9. Kế hoạch, contract index, risk và test report

- `documents/01-planning/decision-log.md`
- `documents/01-planning/m6-savings-status.md`
- `documents/01-planning/m7-credit-status.md`
- `documents/01-planning/milestone-status.md`
- `documents/01-planning/repository-map.md`
- `documents/01-planning/risk-register.md`
- `documents/01-planning/verification-m0-m4-m8.md`
- `documents/03-api/README.md`
- `documents/05-testing/backend-test-report.md`
- `documents/05-testing/test-report.md`
- `documents/architecture/banking-mvp-scope-and-risk.md`

## Kiểm tra bảo vệ trước khi tách commit

- Không đưa `.env`, token, password, OTP, device secret, database credential, `node_modules`, `dist`, coverage hoặc log vào commit.
- Không chạy `npm audit fix --force`.
- `.gitattributes` chỉ quy định EOL cho file text; không renormalize toàn repo trong Stage 0.
- Safety branch được giữ cho tới khi local gates và clone sạch được xác minh.

Secret scan candidate files ngày 2026-08-24: không phát hiện JWT/Bearer token, private key hoặc credential pattern có độ tin cậy cao. Các hit còn lại chỉ là password/OTP fixture trong test và PostgreSQL URL localhost trong README/test; không dùng staging/public và không chứa secret vận hành. `.env`, `node_modules`, build output và cache được kiểm tra ở trạng thái ignored tương ứng; không có file nào trong số đó nằm trong candidate set.

## Chuỗi commit dự kiến

1. `fix(backend): harden auth routing and persistence invariants`
2. `fix(backend): harden banking savings and credit invariants`
3. `fix(mobile-auth): harden session refresh and recovery`
4. `feat(mobile): add idempotent intent recovery primitives`
5. `fix(mobile-flows): recover transfer savings credit and fraud submissions`
6. `fix(mobile-security): harden qr kyc biometric and navigation boundaries`
7. `test(e2e): align critical flows and verification evidence`

Nếu `backend/src/bankingSystem.ts` không thể tách mà vẫn giữ từng commit build được, giữ Backend trong commit nguyên tử thay vì tạo commit giả tạo.

## Trạng thái Stage 0

| Mục | Trạng thái |
| --- | --- |
| Baseline và phân loại file | Đã ghi |
| Secret scan | Đạt; fixture/example đã được phân loại |
| Safety branch/WIP checkpoint | Đã tạo `codex/stage0-safety-20260824` tại `e1b7b8c`; không push |
| Chuỗi commit logic | Đã tạo; backend giữ atomic vì `bankingSystem.ts` dùng chung nhiều invariant |
| Local quality gates | Đã chạy lại sau tách commit; Backend pass static/logic, Mobile pass ngoại trừ dependency audit High và PostgreSQL live skip |
| Remote branch/upstream | Đã push `codex/mini-core-banking-sandbox` và đặt upstream tại `origin`; remote vẫn chưa có `main` |
| PR/branch protection | Chưa tạo; cần maintainer có quyền GitHub |
| Clone sạch | Đã thực hiện tại `C:\Users\admin\AppData\Local\Temp\banking-system-stage0-clone-20260824-105231`; clone đúng branch/upstream và worktree sạch sau `npm ci` + gate |

## Kết quả sau khi tách commit

| SHA | Nội dung |
| --- | --- |
| `556db67` | Baseline Git/CI và `.gitattributes` |
| `0a9454c` | Backend atomic auth/banking/persistence và API contract |
| `59bc63d` | Mobile auth/session/HTTP recovery |
| `b186be5` | Mobile intent/idempotency primitives |
| `84e6239` | Transfer/Savings/Credit/Fraud recovery |
| `82d4457` | QR/KYC/biometric/navigation boundary |
| `edbc9bb` | E2E flow và evidence/report synchronization |

Quality gate snapshot: Backend `npm ci`, typecheck, build, OpenAPI, static database contract, full test 82/88, critical 8/8 và audit 0 vulnerability; Mobile `npm ci`, lint, typecheck, OpenAPI, Maestro syntax 10 flow, release validation, 46 suite/260 test, coverage 85,53%/86,57% và web export 33 route đạt. Mobile audit còn 11 High từ `image-size`; PostgreSQL/relational hiện skip vì Docker daemon không kết nối được.

## Bằng chứng clone sạch

- Clone từ `origin/codex/mini-core-banking-sandbox` tại remote tip được xác nhận đúng SHA và upstream; `git status` sạch, `git diff --check` đạt.
- Backend clone: `npm ci`, static database contract, OpenAPI, typecheck, build, full test 82/88 (6 PostgreSQL skip), critical 8/8 và audit 0 vulnerability đạt; relational test 1 skip do Docker daemon không khả dụng.
- Mobile clone: `npm ci`, lint, typecheck, OpenAPI, Maestro syntax 10 flow, release validation, full test 46 suite/260 test, coverage 85,53%/86,57%/93,39%/85,97% và web export 33 route đạt. Audit vẫn còn 11 High đã ghi ở risk register.
- Clone chỉ tạo `coverage`, `dist` và cache bị ignore; không phát sinh tracked change hay credential.

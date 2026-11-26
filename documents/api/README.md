# API contracts — Draft/reference

## Customer-facing API

- [Banking MVP OpenAPI](banking-mvp.openapi.yaml) — API shape cho toàn bộ customer banking routes (`70` paths / `77` operations, gồm auth/password/devices/biometric, accounts/summary/statement-export, internal & mock NAPAS external lookup/transfers, anomalies, savings, credit/cards, KYC, notifications, assistant & financial advice).
- [Banking MVP narrative](banking-mvp-api-contract.md) — use-case, invariants và behavior notes (đã cập nhật filter/summary/export, mock NAPAS, dynamic policy/fee và anomaly alerts).
- [Auth API contract](auth-api-contract.md) — đăng ký 2 bước, đăng nhập, đổi/quên/đặt lại mật khẩu, quản lý thiết bị và đăng ký Biometric MFA.
- [Auth/session API](auth-session-api-contract.md) — refresh rotation, session lock và server-side revoke details.

## Admin API

- [Admin OpenAPI](admin.openapi.yaml) — staff control-plane API (`62` paths / `63` operations, gồm anomaly queue/resolve, `GET/PATCH /admin/control-policy` và `GET /admin/operations/ledger-reconciliation`).
- Admin implementation and permission source: `backend/src/admin/http/adminHttp.ts`, `backend/src/admin/authorization/permissionRegistry.ts` và `backend/src/admin/actions/actionEngine.ts`.
- Admin Web source: `admin-web/src`.

## Contract status

These files are documentation drafts for the reference backend. They are not approved partner contracts or a production interface commitment.

When changing or relying on an operation, reconcile all of:

1. Current route handler and runtime request/response validators.
2. Relational route boundary and database behavior where applicable.
3. Mobile/Admin caller and response validators.
4. Backend/Mobile/OpenAPI validator scripts and relevant tests.
5. Current OpenAPI and narrative contract.

If these disagree, record the discrepancy and owner decision needed. Do not assume OpenAPI or prose overrides runtime behavior.

## Validation entrypoints

- backend/scripts/validate-openapi.cjs
- backend/scripts/validate-admin-openapi.cjs
- backend/scripts/validate-admin-authz.ts
- mobile-app/scripts/validate-openapi.cjs

Never put real tokens, OTP, PIN, CVV, account details, production credentials or sensitive customer records into examples.

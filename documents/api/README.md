# API contracts — Draft/reference

## Customer-facing API

- [Banking MVP OpenAPI](banking-mvp.openapi.yaml) — API shape for customer banking routes.
- [Banking MVP narrative](banking-mvp-api-contract.md) — use-case and behavior notes.
- [Auth/session API](auth-session-api-contract.md) — identity, challenge and session details.

## Admin API

- [Admin OpenAPI](admin.openapi.yaml) — staff control-plane API.
- Admin implementation and permission source: backend/src/admin/http/adminHttp.ts, backend/src/admin/authorization/permissionRegistry.ts and backend/src/admin/actions/actionEngine.ts.
- Admin Web source: admin-web/src.

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

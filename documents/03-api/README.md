# 03 — API và contract

Trang này là lối vào; các contract/OpenAPI nằm trong [documents/api](../api/README.md).

## Public customer API

- OpenAPI: [banking-mvp.openapi.yaml](../api/banking-mvp.openapi.yaml)
- Narrative contract: [banking-mvp-api-contract.md](../api/banking-mvp-api-contract.md)
- Auth/session contracts: [auth-session-api-contract.md](../api/auth-session-api-contract.md)

## Admin control-plane API

- OpenAPI: [admin.openapi.yaml](../api/admin.openapi.yaml)
- Admin Web và Admin API dùng staff session/cookie realm riêng.
- Permission registry và runtime route implementation là căn cứ cho authorization; tài liệu RBAC là bản diễn giải.

## Trạng thái và quy tắc

Các contract hiện là Draft/reference. Không coi OpenAPI là phê duyệt partner hoặc nguồn quyết định runtime. Trước thay đổi API, đối chiếu handler, runtime validator, mobile response validator, database behavior và tests; ghi rõ mọi mâu thuẫn.

Validator chính:

- Backend: backend/scripts/validate-openapi.cjs và backend/scripts/validate-admin-openapi.cjs.
- Mobile: mobile-app/scripts/validate-openapi.cjs.
- Admin authorization: backend/scripts/validate-admin-authz.ts.

Không đưa secret, token thật, OTP, PIN, account data thật hoặc production URL vào examples.

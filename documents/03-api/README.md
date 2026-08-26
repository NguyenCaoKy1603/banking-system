# 03-api

API source of truth hiện nằm tại `documents/api/` và gồm Auth DRAFT v2, session draft, banking MVP contract và OpenAPI draft. Admin control plane có contract riêng tại [`admin.openapi.yaml`](../api/admin.openapi.yaml); Admin API chạy port/process riêng và dùng staff cookie realm.

`mobile-app/scripts/validate-openapi.cjs` và `backend/scripts/validate-openapi.cjs` kiểm tra marker DRAFT, operationId, ví dụ không chứa secret, idempotency response và các route tương ứng trong reference backend. `backend/scripts/validate-admin-authz.ts` kiểm tra registry route/permission deny-by-default.

Trước khi tích hợp tiền thật, cần cập nhật status/owner/version/examples cho từng module M2–M9 và được Backend, partner, legal/compliance xác nhận.

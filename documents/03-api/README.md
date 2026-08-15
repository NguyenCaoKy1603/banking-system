# 03-api

API source of truth hiện nằm tại `documents/api/` và gồm Auth v1, session draft, banking MVP contract và OpenAPI draft. `mobile-app/scripts/validate-openapi.cjs` và `backend/scripts/validate-openapi.cjs` kiểm tra marker DRAFT, operationId, ví dụ không chứa secret, idempotency response và các route tương ứng trong reference backend.

Trước khi tích hợp tiền thật, cần cập nhật status/owner/version/examples cho từng module M2–M9 và được Backend, partner, legal/compliance xác nhận.

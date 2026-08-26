# Admin Web runtime proxy — local evidence 2026-08-26

## Kết luận

Commit đã kiểm tra: 54a947db39a2c308dd15cc80f9365a54dccef6b8.

    UNTRUSTED LOCAL PREVIEW
    IMAGE_DIGEST=unknown

Đây là bằng chứng local/disposable cho same-origin proxy, không phải staging
evidence. Chưa có registry digest, chữ ký Cosign, provenance, HTTPS staging,
managed secret hoặc reviewer độc lập.

## Thay đổi đã xác minh

- Browser bundle chỉ gọi /api/v1; không còn URL API môi trường trong bundle.
- Vite development proxy và Nginx production proxy đều nhận
  ADMIN_API_UPSTREAM ngoài bundle.
- ADMIN_WEB_ENV và upstream được kiểm tra trước khi Nginx chạy; cấu hình
  thiếu/sai làm container thoát ngay.
- Preview cho phép HTTP localhost/container network; staging và
  production-like bắt buộc HTTPS.
- Nginx giữ URI /api/v1/..., cookie HttpOnly, CSRF và request ID; API không
  cache và access log không ghi query, cookie, Authorization hay request body.
- CSP dùng connect-src 'self'; image chạy với user nginx trên cổng nội bộ
  8080.

## Lệnh và kết quả

| Kiểm tra | Kết quả |
|---|---|
| admin-web: lint, typecheck, unit test | PASS, 4/4 |
| admin-web: build | PASS |
| admin-web: audit | PASS, 0 vulnerability |
| admin-web: Playwright E2E | PASS, 1/1 |
| Docker image build | PASS |
| Image secret-surface scan | PASS |
| Runtime thiếu ADMIN_API_UPSTREAM | FAIL-CLOSED đúng kỳ vọng |
| Staging dùng HTTP | FAIL-CLOSED đúng kỳ vọng |
| Upstream có path/credential/query/fragment | FAIL-CLOSED đúng kỳ vọng |
| Preview HTTP host bên ngoài allowlist | FAIL-CLOSED đúng kỳ vọng |
| Preview upstream hợp lệ, /livez và /readyz | PASS |
| /api/v1/admin/me không session qua Nginx | HTTP 401 đúng kỳ vọng |
| Một image với hai upstream fixture | PASS; mỗi request đến đúng fixture |
| Compose disposable, migration 001–032 chạy hai lần | PASS; lần hai idempotent |

Compose rehearsal dùng project/network/volume riêng
banking-admin-proxy-test; đã dừng và xóa toàn bộ sau kiểm tra. Stack
banking-reference-preview và database banking_preview không bị restart,
reset hoặc migrate.

## Việc còn thiếu trước Release Candidate

- Push branch và chờ Backend, Mobile, Admin và Container checks xanh trên SHA
  mới.
- Reviewer độc lập hoặc waiver học thuật.
- Registry/GHCR, Cosign, SBOM/provenance, deployment/IaC và URL HTTPS staging
  thật được cấp ở runtime bằng ADMIN_API_UPSTREAM.

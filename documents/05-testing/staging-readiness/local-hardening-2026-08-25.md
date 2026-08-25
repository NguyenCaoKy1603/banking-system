# Local staging-readiness preflight — 2026-08-25

## Kết luận

Đây là bằng chứng kiểm tra local/provider-neutral, không phải staging
evidence. Trạng thái release vẫn:

```text
UNTRUSTED LOCAL PREVIEW
IMAGE_DIGEST=unknown
```

Không có cloud, registry digest, managed PostgreSQL, Secret Manager, HTTPS
endpoint hoặc thiết bị Android staging trong report này.

## Thay đổi đã kiểm tra

- Staging/production-like yêu cầu `BANKING_PERSISTENCE_MODE=relational-v2`.
- Worker fail-closed nếu thiếu `WORKER_CUTOVER_CONFIRMED=1`.
- Managed secret mount yêu cầu file secret và `<secret-id>.version`, không đọc
  fallback từ `.env`.
- Release manifest có thể chứa backend/Admin Web digest và APK SHA-256; verifier
  fail-closed khi signature/SBOM/provenance hoặc staging evidence thiếu.
- Workflow container release build/ký Admin Web bằng digest riêng và chạy
  `cosign verify`, provenance attestation và SBOM attestation cho cả hai image
  trước khi ghi các cờ verification vào manifest; URL Admin staging phải đến
  từ repository variable.
- Mobile có profile EAS `staging` dạng internal APK; profile không chứng minh
  đã có EAS project hoặc signing key.

## Lệnh và kết quả

| Lệnh | Kết quả |
| --- | --- |
| `npm run typecheck` trong `backend/` | PASS |
| `npm run build` trong `backend/` | PASS |
| `npm test` trong `backend/` | 146 tests, 127 PASS, 19 SKIPPED, 0 FAIL |
| `npm run test:critical` | 10 PASS |
| `relationalAuthService` disposable local rehearsal | PASS; issue → authenticate → refresh rotation → revoke |
| `relationalRegistrationService` disposable local rehearsal | PASS với `FakeEmailProvider`; OTP challenge → completion → account allocation |
| direct relational HTTP boundary test | PASS; account và transfer quote route không gọi `withState` |
| `npm run test:database` trên PostgreSQL disposable | 4 PASS |
| `npm run test:relational` trên PostgreSQL disposable | 1 PASS |
| `npm run test:worker` trên PostgreSQL disposable | 10 PASS |
| `npm run test:admin:database` | 8 PASS |
| `npm run validate:database` | 49 bảng PASS |
| `npm run validate:relational-v2` | PASS; migration 006–011 và invariant không lỗi |
| `npm run validate:outbox` | PASS; event lỗi/secret-like errors bằng 0 |
| `npm run validate:admin-schema` | 37 bảng PASS |
| `npm run validate:admin-authz` | 63 route / 46 permission / 4 role PASS |
| `npm run validate:admin-openapi` | 63 route PASS |
| Backend secret scan + `npm audit --omit=dev --audit-level=high` | PASS; 0 vulnerability high |
| Mobile lint/typecheck/unit/OpenAPI/Maestro/public-env | PASS; 46 suite / 259 test |
| Mobile export với HTTPS CI placeholder | PASS; 36 static route |
| Admin Web lint/typecheck/unit/build/audit | PASS; 3 test / 0 vulnerability high |
| Docker Compose config/build backend, Admin, migration, worker | PASS |
| Docker image surface scan cho 5 local images | PASS |
| Worker không có cutover confirmation | BLOCKED đúng kỳ vọng; entrypoint từ chối khởi động |

## Giới hạn còn lại

- HTTP backend hiện có feature group opt-in `BANKING_RELATIONAL_HTTP_ROUTES`:
  session auth, account/transaction reads, beneficiary CRUD và transfer
  quote/submit/read đã có direct boundary; registration là group riêng vì cần
  email provider. Internal-recipient lookup, MFA lifecycle, notifications,
  savings và credit vẫn đi qua `PostgresRelationalRepository.withState`. Vì vậy chưa được đặt
  `BANKING_PERSISTENCE_MODE=relational-v2` cho toàn bộ HTTP, chưa đặt
  `WORKER_CUTOVER_CONFIRMED=1` và chưa ghi `STAGING VERIFIED`.
- Chưa có provider cloud cụ thể, registry/GHCR digest, Cosign identity thật,
  managed secret client/IAM, PostgreSQL staging TLS, DNS/HTTPS, APK signing,
  device E2E, backup/restore staging hoặc rollback evidence.
- Các test backend có 19 case PostgreSQL/device phụ thuộc môi trường trong
  `npm test` được đánh dấu SKIPPED; các suite database disposable riêng đã
  chạy PASS như bảng trên.

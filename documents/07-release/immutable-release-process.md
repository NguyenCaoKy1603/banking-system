# Quy trình release bất biến — Staging và Production-like

Ngày cập nhật: 2026-08-26

## Trạng thái

Đã triển khai trong workspace phần guard runtime, probe, fingerprint migration, Docker OCI metadata, release gate, release manifest generator và workflow `container-release.yml`. Registry, OIDC signing thực tế, managed PostgreSQL, DNS/TLS, IaC và deployment provider chưa được cấu hình trong tài khoản nên chưa được đánh dấu là đã deploy.

## Nguyên tắc

Một release được build đúng một lần từ commit sạch trong CI. Staging và Production-like chỉ nhận cùng một image manifest digest; không dùng `latest`, không build lại và không sửa code trên server.

Backend API, migration, Admin API và worker dùng cùng backend digest; Admin Web
được build/ký bằng digest riêng. Bundle Admin Web chỉ gọi đường dẫn tương đối
`/api/v1`; Nginx nhận origin Admin API qua `ADMIN_API_UPSTREAM` khi container
khởi động. Không bake URL môi trường vào JavaScript hoặc image, vì vậy cùng một
Admin Web digest có thể chạy ở preview, staging và production-like.

```text
clean commit
  → quality gates
  → buildx image + SBOM + provenance
  → registry manifest digest
  → Cosign keyless signature
  → Admin Web runtime proxy (same-origin /api/v1)
  → release-manifest.json
  → migration job cùng digest
  → /startupz + /readyz + /versionz
  → Staging evidence
  → manual promotion theo verificationMode đã khai báo
```

## Gate local hiện có

```powershell
cd backend
npm run release:gate
npm run release:migration-fingerprint
npm run db:migrate -- --plan
npm run db:migrate -- --verify-only
```

`release:gate` phải trả `promotionAllowed=true`; mọi migration từ `001` tới migration mới nhất phải được Git theo dõi và checksum phải nằm trong release manifest. Nếu worktree dirty, image digest là `unknown` hoặc chưa có chữ ký/provenance/staging evidence thì chỉ được ghi nhận là **UNTRUSTED LOCAL PREVIEW**, không được promote.

Staging/production-like còn bắt buộc `BANKING_PERSISTENCE_MODE=relational-v2`.
HTTP legacy full-state writer không được chạy cùng worker; worker entrypoint
fail-closed nếu thiếu `WORKER_CUTOVER_CONFIRMED=1`. Secret provider managed có
thể nhận secret từ provider mount qua `BANKING_MANAGED_SECRETS_DIR`, với version
sidecar cho từng secret; không được fallback về `.env`.

## Admin Web runtime proxy

Admin Web không còn nhận `VITE_ADMIN_API_URL` hoặc `STAGING_ADMIN_API_URL` ở
giai đoạn build. Deployment phải cấp hai biến runtime:

```text
ADMIN_WEB_ENV=preview|staging|production-like
ADMIN_API_UPSTREAM=<HTTP(S) origin, không có path/query/fragment/credential>
```

Preview cho phép HTTP trên localhost hoặc mạng container; staging và
production-like bắt buộc HTTPS. Container dừng trước khi Nginx chạy nếu thiếu
hoặc sai cấu hình. Trình duyệt luôn gọi cùng origin `/api/v1/...`; Nginx chuyển
tiếp URI đó tới upstream, giữ cookie HttpOnly, CSRF và request ID, không cache
API và không ghi cookie/Authorization/request body vào log. CSP dùng
`connect-src 'self'`.

`ADMIN_API_UPSTREAM` là cấu hình triển khai, không phải secret. URL staging
thật chỉ xuất hiện trong deployment/IaC hoặc runtime secret/config, không cần
repository variable để tạo Release Candidate và không được đưa vào artifact.

## Runtime contract

| Môi trường | `NODE_ENV` | `BANKING_ENV` | Storage | Money mode |
|---|---|---|---|---|
| Development | `development` | `development` | local/test | `virtual` |
| Local preview | `preview` | `preview` | PostgreSQL | `virtual` |
| Staging | `production` | `staging` | PostgreSQL riêng | `virtual` |
| Production-like | `production` | `production-like` | PostgreSQL riêng | `virtual` |

Staging/Production-like fail closed nếu không resolve được `database-credential`, `otp-pepper`, `mfa-encryption-key` từ SecretProvider managed, thiếu `BANKING_SECRET_PROVIDER=managed`, `BANKING_MFA_REQUIRED=1`, exact HTTPS CORS origins, full `BUILD_COMMIT_SHA`, `RELEASE_ID` hoặc `IMAGE_DIGEST`. `BANKING_ENV=production`, `BANKING_MONEY_MODE=real` và deterministic OTP env bị từ chối.

## Metadata đối chiếu sau deploy

```powershell
Invoke-RestMethod https://api.staging.example.com/livez
Invoke-RestMethod https://api.staging.example.com/startupz
Invoke-RestMethod https://api.staging.example.com/readyz
Invoke-RestMethod https://api.staging.example.com/versionz
```

`/versionz` phải khớp release manifest ở `releaseId`, full commit SHA, image digest, migration set digest, schema version, API contract digest và `moneyMode=virtual`. Không đưa response chứa secret vào artifact công khai.

## Phần cần owner/provider hoàn tất

- Merge các thay đổi MFA/Admin và đảm bảo mọi migration đã tracked, checksum được review.
- Cấu hình GHCR, OIDC/Cosign và lưu artifact workflow.
- Tạo PostgreSQL Staging/Production-like riêng, role riêng, TLS private, backup/PITR và restore rehearsal.
- Chọn provider managed container/DNS/TLS/secret manager và viết adapter deploy/IaC tương ứng.
- Inject ManagedSecretClient/KMS envelope adapter, workload identity/OIDC và rotation/rollback evidence; workspace hiện chỉ có seam fail-closed provider-neutral.
- Chạy mobile E2E qua HTTPS staging (không dùng Metro/ADB reverse), performance và rollback rehearsal. Với phạm vi khóa luận solo, owner ghi `SOLO_ACADEMIC_OWNER`, `independentReview=false`, scope synthetic/virtual; chỉ production-like mới yêu cầu `INDEPENDENT_REVIEW`.

Runbook thao tác: [`migration-runbook.md`](migration-runbook.md), [`backup-restore-runbook.md`](backup-restore-runbook.md), [`rollback-runbook.md`](rollback-runbook.md) và [`incident-checklist.md`](incident-checklist.md).

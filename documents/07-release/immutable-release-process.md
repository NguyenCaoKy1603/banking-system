# Quy trình release bất biến — Staging và Production-like

Ngày cập nhật: 2026-08-25

## Trạng thái

Đã triển khai trong workspace phần guard runtime, probe, fingerprint migration, Docker OCI metadata, release gate, release manifest generator và workflow `container-release.yml`. Registry, OIDC signing thực tế, managed PostgreSQL, DNS/TLS, IaC và deployment provider chưa được cấu hình trong tài khoản nên chưa được đánh dấu là đã deploy.

## Nguyên tắc

Một release được build đúng một lần từ commit sạch trong CI. Staging và Production-like chỉ nhận cùng một image manifest digest; không dùng `latest`, không build lại và không sửa code trên server.

```text
clean commit
  → quality gates
  → buildx image + SBOM + provenance
  → registry manifest digest
  → Cosign keyless signature
  → release-manifest.json
  → migration job cùng digest
  → /startupz + /readyz + /versionz
  → Staging evidence
  → manual promotion với reviewer độc lập
```

## Gate local hiện có

```powershell
cd backend
npm run release:gate
npm run release:migration-fingerprint
npm run db:migrate -- --plan
npm run db:migrate -- --verify-only
```

`release:gate` phải trả `promotionAllowed=true`. Worktree hiện tại vẫn dirty và migration `014–025` chưa được Git theo dõi, nên bằng chứng ngày 2026-08-25 đang đúng là **UNTRUSTED LOCAL PREVIEW** và không được promote.

## Runtime contract

| Môi trường | `NODE_ENV` | `BANKING_ENV` | Storage | Money mode |
|---|---|---|---|---|
| Development | `development` | `development` | local/test | `virtual` |
| Local preview | `preview` | `preview` | PostgreSQL | `virtual` |
| Staging | `production` | `staging` | PostgreSQL riêng | `virtual` |
| Production-like | `production` | `production-like` | PostgreSQL riêng | `virtual` |

Staging/Production-like fail closed nếu thiếu `DATABASE_URL`, `BANKING_OTP_PEPPER`, `BANKING_MFA_ENCRYPTION_KEY`, `BANKING_MFA_REQUIRED=1`, exact HTTPS CORS origins, full `BUILD_COMMIT_SHA`, `RELEASE_ID` hoặc `IMAGE_DIGEST`. `BANKING_ENV=production`, `BANKING_MONEY_MODE=real` và deterministic OTP env bị từ chối.

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
- Chạy mobile E2E qua HTTPS staging (không dùng Metro/ADB reverse), performance, rollback rehearsal và reviewer độc lập.

Runbook thao tác: [`migration-runbook.md`](migration-runbook.md), [`backup-restore-runbook.md`](backup-restore-runbook.md), [`rollback-runbook.md`](rollback-runbook.md) và [`incident-checklist.md`](incident-checklist.md).

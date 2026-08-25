# Staging deployment contract

Thư mục này chỉ chứa contract provider-neutral cho môi trường staging học
thuật. Chưa có cloud provider, DNS, managed PostgreSQL, Secret Manager hay
deployment state nào được cấu hình trong workspace; vì vậy không được dùng
file này làm bằng chứng đã deploy.

## Mục tiêu

Môi trường đích là:

```text
STAGING VERIFIED — ACADEMIC / SYNTHETIC DATA / VIRTUAL MONEY
```

Các service phải chạy bằng image đã push một lần lên registry và được định
danh bằng manifest digest, không dùng `latest`:

```text
backend API + migration job + worker  -> backend image digest
Admin API                              -> backend image digest
Admin Web                              -> admin-web image digest riêng
Mobile                                 -> APK release đã ký + SHA-256
```

## Runtime bắt buộc

```text
NODE_ENV=production
BANKING_ENV=staging
BANKING_MONEY_MODE=virtual
BANKING_STORAGE=postgres
BANKING_PERSISTENCE_MODE=relational-v2
BANKING_SECRET_PROVIDER=managed
BANKING_MFA_REQUIRED=1
BANKING_MFA_METHODS=TOTP
DATABASE_SSL_MODE=verify-full
DATABASE_SERVER_NAME=<managed-postgres-hostname>
BUILD_COMMIT_SHA=<40-char commit SHA>
RELEASE_ID=<immutable release id>
IMAGE_DIGEST=sha256:<64-char registry manifest digest>
```

Staging fail closed nếu thiếu một giá trị trên. `BANKING_MANAGED_SECRETS_DIR`
có thể trỏ tới thư mục secret được provider mount vào workload; mỗi secret
phải có file `<secret-id>` và sidecar `<secret-id>.version`. Secret value
không được commit hoặc đưa vào release evidence.

## Thành phần hạ tầng tối thiểu

- API HTTPS ổn định và Admin HTTPS riêng, CORS exact-origin.
- `STAGING_ADMIN_API_URL` phải là URL HTTPS của Admin API và được cấp qua CI
  variable trước khi build Admin Web; không dùng `.invalid` hoặc localhost.
- Managed PostgreSQL riêng, private/allowlisted, TLS `verify-full`.
- Secret namespace riêng, workload identity hoặc cơ chế mount được provider
  phê duyệt.
- Migration job chạy trước API bằng đúng backend digest.
- Ít nhất một API, một Admin API/Web và một worker.
- Backup/restore vào database mới, rollback application về digest trước.
- Log/metric/trace redaction, health/readiness/version evidence.

## Trình tự evidence

Sau deploy lần đầu chỉ ghi:

```text
STAGING DEPLOYED — UNVERIFIED
```

Chỉ chuyển sang `STAGING VERIFIED` khi manifest, `/versionz`, migration
fingerprint, signature/SBOM/provenance, APK checksum, E2E HTTPS, backup
restore, rollback và người review độc lập đều đã có bằng chứng. Các artifact
được kiểm tra bởi `backend/scripts/verify-release-manifest.cjs` nhưng script
không tự tạo hoặc giả lập cloud evidence.

## Blocker bên ngoài workspace

Chủ sở hữu cần chọn một provider và cung cấp quyền tương ứng cho registry,
container hosting, PostgreSQL, Secret Manager, HTTPS endpoint và (nếu dùng)
EAS. Không tự mua dịch vụ, tạo DNS, push image, deploy hoặc ghi nhận staging
evidence từ phiên local này.

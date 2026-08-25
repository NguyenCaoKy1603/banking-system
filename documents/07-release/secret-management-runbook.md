# Secret management runbook — P0

Ngày cập nhật: 2026-08-25

Tài liệu này mô tả boundary đã có trong repository và phần phải được owner/provider hoàn tất. Không ghi secret value, database URL, token hoặc private key vào registry, GitHub issue, log hay artifact.

## Phân loại runtime

| Runtime | Provider hợp lệ | Trạng thái |
|---|---|---|
| Development/Test/Local preview | `local` đọc biến môi trường bị ignore | Có thể chạy với dữ liệu synthetic; không phải release |
| Staging | `managed` + workload identity/OIDC + TLS `verify-full` | Chưa đủ cho tới khi inject client thật và có evidence |
| Production-like | `managed` + KMS/HSM + IAM tách role + TLS `verify-full` | Chưa đủ cho tới khi có staging promotion và drill |

`ManagedSecretProvider` mặc định fail-closed nếu chưa được inject client cloud/Vault thật. Không đổi thành fallback env để làm cho staging “chạy được”.
Deployment adapter sẽ truyền `ManagedSecretClient` vào `createRuntimeSecretProvider`; workspace hiện chưa chọn SDK/provider nên không tự tạo client giả.

## Registry và secret references

- Metadata-only registry: `documents/07-release/secret-registry.yaml`.
- Runtime references: `backend/src/secrets/runtimeSecrets.ts`.
- Các nhóm bắt buộc gồm database credential, OTP pepper, MFA encryption key, notification endpoint key, backup encryption key và mobile signing key.
- Local provider chỉ đọc env của đúng environment; `SecretCache` chỉ giữ giá trị trong memory, có TTL/refresh và không ghi file.

Kiểm tra:

```powershell
cd backend
npm run validate:secret-registry
npm run validate:secrets -- --history
```

## Rotation không gián đoạn

1. Tạo key/version mới trong KMS/Secret Manager, giữ version cũ ở trạng thái `DECRYPT_ONLY`.
2. Cập nhật reference current và previous qua deployment secret binding; không sửa ciphertext thủ công.
3. Chụp backup đã mã hóa và kiểm tra restore trước khi chạy re-encryption.
4. Chạy inventory dry-run, sau đó apply với checkpoint và phê duyệt:

```powershell
$env:REENCRYPT_CONFIRM = "1"
npm run secrets:reencrypt -- --record-type=mfa-customer --apply
npm run secrets:reencrypt -- --record-type=mfa-staff --apply
npm run secrets:reencrypt -- --record-type=notification-endpoint --apply
```

Script chỉ ghi ciphertext v2 AES-256-GCM envelope, AAD/version/key metadata và checkpoint; không in plaintext. Mỗi batch giữ row lock `FOR UPDATE` thay vì `SKIP LOCKED`, nên checkpoint monotonic không thể vượt qua bản ghi đang bận. Nếu một batch giải mã thất bại, transaction bị rollback và checkpoint chuyển `FAILED`, không bỏ qua bản ghi.

5. Kiểm tra số lượng `v2`, key ID current, `failed_count=0`, login/MFA/notification smoke và restore rehearsal.
6. Chỉ sau khi có evidence đầy đủ mới chuyển key cũ sang `REVOKED`/`DESTROY_PENDING` theo retention policy.

## Backup và sự cố

Local/CI có thể dùng `backend/scripts/encrypted-backup.cjs` để rehearsal AES-GCM stream. Staging/Production-like phải dùng KMS envelope/object storage versioning, access log, retention, PITR và restore approval của provider; local rehearsal không thay thế evidence đó. Quy trình restore nằm ở [`backup-restore-runbook.md`](backup-restore-runbook.md).

Nếu nghi ngờ lộ key: dừng promotion, giữ key cũ ở `DECRYPT_ONLY`, rotate current, revoke workload identity bị ảnh hưởng, chạy re-encryption có checkpoint, kiểm tra audit/backup và ghi incident timeline. Không xoá key cũ trước khi xác nhận mọi ciphertext đã chuyển hoặc có restore point được phê duyệt.

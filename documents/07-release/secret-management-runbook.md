# Secret management runbook — P0

Ngày cập nhật: 2026-10-05

Tài liệu này mô tả boundary đã có trong repository và phần phải được owner/provider hoàn tất. Không ghi secret value, database URL, token hoặc private key vào registry, GitHub issue, log hay artifact.

## Phân loại runtime

| Runtime | Provider hợp lệ | Trạng thái |
|---|---|---|
| Development/Test/Local preview | `local` đọc biến môi trường bị ignore | Có thể chạy với dữ liệu synthetic; không phải release |
| Staging | `managed` + workload identity/OIDC + TLS `verify-full` | Chưa đủ cho tới khi inject client thật và có evidence |
| Production-like | `managed` + KMS/HSM + IAM tách role + TLS `verify-full` | Chưa đủ cho tới khi có staging promotion và drill |

`ManagedSecretProvider` mặc định fail-closed nếu chưa được inject client managed thật. Không đổi thành fallback env để làm cho staging “chạy được”.

Repository hiện có hai adapter: `MountedSecretClient` đọc value cùng sidecar version từ mount; `GoogleSecretManagerClient` dùng SDK chính thức `@google-cloud/secret-manager` và Application Default Credentials (ADC). Adapter Google chỉ được chọn rõ ràng bằng `BANKING_MANAGED_SECRET_BACKEND=google-secret-manager` cùng `BANKING_SECRET_PROJECT_ID`; không được đặt đồng thời `BANKING_MANAGED_SECRETS_DIR`. Chế độ mount dùng `BANKING_MANAGED_SECRET_BACKEND=mounted` và `BANKING_MANAGED_SECRETS_DIR`. Không đặt backend/provider thì managed client vẫn fail-closed.

Adapter Google đã có unit test với fake API; chưa có Google Cloud project, ADC, IAM binding hoặc lần đọc Secret Manager thật. Trên Cloud Run, workload nên dùng service identity gắn với service và ADC; không đưa service-account key JSON vào image, environment hoặc Git. Cấp quyền `Secret Manager Secret Accessor` cho đúng secret IDs mà từng service cần đọc, không cấp quyền rộng ở project nếu không cần. Tài liệu Google xác nhận Cloud Client Libraries dùng ADC và Cloud Run có thể cung cấp service identity gắn với workload: [ADC](https://cloud.google.com/docs/authentication/application-default-credentials), [Cloud Run service identity](https://cloud.google.com/run/docs/securing/service-identity).

`GoogleSecretManagerClient` yêu cầu resource `projects/<project>/secrets/<secret>/versions/latest`, giải mã payload trong bộ nhớ và lưu mã version số thực tế từ tên resource trả về. Lỗi adapter không đưa thông điệp thô từ SDK ra ngoài. `SecretCache` giữ giá trị trong bộ nhớ tối đa 5 phút, nhưng keyring MFA/OTP/notification được tạo khi service khởi động; khi xoay khóa phải rollout/restart có kiểm soát để process mới nạp đúng current/previous. API Google trả payload và tên version của phản hồi truy cập; xem [Access a secret version](https://cloud.google.com/secret-manager/docs/access-secret-version) và [Node.js client API](https://cloud.google.com/nodejs/docs/reference/secret-manager/latest/secret-manager/v1.secretmanagerserviceclient).

## Registry và secret references

- Metadata-only registry: `documents/07-release/secret-registry.yaml`.
- Runtime references: `backend/src/secrets/runtimeSecrets.ts`.
- Các nhóm bắt buộc gồm database credential, OTP pepper, MFA encryption key, notification endpoint key và mobile signing key. Backup encryption key còn trong registry như metadata cho provider tương lai; hiện không có backup local code sử dụng nó.
- Registry ghi rõ owner, binding, vị trí phiên bản (`single`/`current`/`previous`), nguồn version metadata do provider gán và vòng đời cho từng secret. Các version thật chỉ được ghi trong Secret Manager; registry chỉ giữ chính sách, không ghi version ID hay giá trị thực.
- Quyết định cho lần staging đầu tiên: các khóa current bắt buộc vẫn phải có; ba slot `otp-pepper-previous`, `mfa-encryption-key-previous` và `notification-endpoint-key-previous` cũng phải được cấp trước lần khởi động staging đầu tiên. Runtime hiện truyền `required: runtimeConfig.isProductionLike` cho các keyring tương ứng, vì vậy không có ngoại lệ “first boot” hoặc fallback về local. Khi môi trường dữ liệu còn mới và chưa có dữ liệu mã hóa cũ, operator tạo một khóa ngẫu nhiên riêng cho staging ở trạng thái `PREPARED` cho mỗi slot previous; không dùng lại current key, khóa local hay khóa môi trường khác. Đây là slot dự phòng tương thích với hợp đồng runtime, không phải bằng chứng rằng đã có ciphertext cũ.
- Khi xoay khóa lần đầu, đưa current cũ vào slot previous, rollout/restart process để nạp keyring mới, rồi chỉ loại khóa bootstrap ban đầu sau khi đã xác nhận không có dữ liệu nào tham chiếu tới nó và owner phê duyệt. Không đổi runtime để âm thầm bỏ qua khóa previous bắt buộc.
- `REGISTRATION_FINGERPRINT_KEY` được `readRuntimeConfig()` kiểm tra trước khi Backend API mở listener. Provider phải cấp biến môi trường này cho riêng `backend-api` trước khi process bắt đầu; Admin API và worker không cần nhận khóa đó.
- Khóa ký Mobile chỉ được cấp cho managed build service trong bước ký, không đưa vào `EXPO_PUBLIC_*`, JavaScript bundle hay runtime service.
- `email-provider-token` là credential của adapter email. Khi `EMAIL_PROVIDER=smtp` trong rehearsal Gmail, giá trị là App Password của tài khoản gửi; khi dùng HTTP provider, giá trị là bearer/API token. Cả hai trường hợp đều phải đi qua SecretProvider, không ghi giá trị vào registry, Compose file, log hoặc artifact.
- Local provider chỉ đọc env của đúng environment; `SecretCache` chỉ giữ giá trị trong memory, có TTL/refresh và không ghi file.
- Registry và provider-neutral contract chỉ định danh secret cùng chính sách binding/version. Adapter Google là lựa chọn có thể cấu hình, không đồng nghĩa Secret Manager, workload identity, quyền IAM, audit hoặc version đã được cấu hình ở một cloud provider thật.

Kiểm tra:

```powershell
cd backend
npm run validate:secret-registry
npm run validate:secrets -- --history
```

## Rotation không gián đoạn

1. Tạo key/version mới trong KMS/Secret Manager, giữ version cũ ở trạng thái `DECRYPT_ONLY`.
2. Cập nhật reference current và previous qua deployment secret binding; không sửa ciphertext thủ công.
   Backend tạo keyring khi khởi động, vì vậy cần rollout/restart service có kiểm soát để process mới thực sự nạp version mới; chỉ sửa file mount hoặc cache bên ngoài chưa đủ.
3. Xác nhận provider backup đã mã hóa và kiểm tra restore trước khi chạy re-encryption; repository hiện không có script local cho bước này.
4. Chạy inventory dry-run, sau đó apply với checkpoint và phê duyệt:

```powershell
$env:REENCRYPT_CONFIRM = "1"
npm run secrets:reencrypt -- --record-type=mfa-customer --apply
npm run secrets:reencrypt -- --record-type=mfa-staff --apply
npm run secrets:reencrypt -- --record-type=notification-endpoint --apply
```

Script chỉ ghi ciphertext v2 AES-256-GCM envelope, AAD/version/key metadata và checkpoint; không in plaintext. Mỗi batch giữ row lock `FOR UPDATE` thay vì `SKIP LOCKED`, nên checkpoint monotonic không thể vượt qua bản ghi đang bận. Nếu một batch giải mã thất bại, transaction bị rollback và checkpoint chuyển `FAILED`, không bỏ qua bản ghi.

5. Kiểm tra số lượng `v2`, key ID current, `failed_count=0`, login/MFA/notification smoke và provider restore rehearsal.
6. Chỉ sau khi có evidence đầy đủ mới chuyển key cũ sang `REVOKED`/`DESTROY_PENDING` theo retention policy.

## Backup và sự cố

Script `backend/scripts/encrypted-backup.cjs` đã được gỡ; local/CI hiện không có luồng backup mã hóa để rehearsal. Staging/Production-like cần KMS envelope/object storage versioning, access log, retention, PITR và restore approval của provider. Quy trình mục tiêu nằm ở [`backup-restore-runbook.md`](backup-restore-runbook.md).

Nếu nghi ngờ lộ key: dừng promotion, giữ key cũ ở `DECRYPT_ONLY`, rotate current, revoke workload identity bị ảnh hưởng, chạy re-encryption có checkpoint, kiểm tra audit/backup và ghi incident timeline. Không xoá key cũ trước khi xác nhận mọi ciphertext đã chuyển hoặc có restore point được phê duyệt.

# Chính sách backup và phục hồi — P1

Ngày cập nhật: 2026-08-25

## Phạm vi và trạng thái

Repository này chỉ chạy dữ liệu synthetic/virtual-money. Công cụ backup trong `backend/scripts/` đã triển khai được logical backup custom-format, mã hóa AES-256-GCM, manifest/checksum, verify và restore vào database mới cho `development`, `test` và `preview`.

Trạng thái hiện tại vẫn là **UNTRUSTED LOCAL PREVIEW**. `IMAGE_DIGEST=unknown` là hợp lệ trong local preview; không có object storage/KMS/managed PostgreSQL/WAL archive/staging evidence thật trong workspace. Không dùng bằng chứng local này để tuyên bố production readiness.

## Mục tiêu theo môi trường

| Môi trường | RPO/RTO | Cơ chế được phép | Trạng thái |
|---|---|---|---|
| Development | Không cam kết | Dữ liệu reset hoặc backup thủ công | Không phải release |
| Local preview | Mục tiêu 24h/2h | Logical custom dump, AES-GCM, restore DB mới | Đã diễn tập local; RPO chưa đo |
| Staging | Mục tiêu 24h/2h | Managed backup/PITR hoặc daily encrypted dump ngoài DB | Chưa cấu hình |
| Production-like | Mục tiêu ≤5 phút/≤60 phút | Base backup + WAL liên tục + PITR | Chưa cấu hình |

RPO/RTO chỉ được ghi là **đạt** sau khi có rehearsal và số đo thực tế. Restore logical không cung cấp PITR.

## Quy tắc bắt buộc

- Backup primary dùng `pg_dump --format=custom --no-owner --no-privileges`; plain SQL chỉ dùng debug.
- Dump được truyền trực tiếp vào AES-256-GCM; không ghi plaintext dump ra ổ đĩa.
- Manifest ghi release/migration digest, PostgreSQL major, LSN, checksum plaintext/ciphertext, key ID, retention và trạng thái; không ghi `DATABASE_URL`, password, signed URL hoặc key value.
- `backup-create` có lock file; job trùng bị bỏ qua và không xóa bản backup tốt gần nhất.
- Restore luôn vào database mới; không dùng `--clean` trên source. Worker/provider gửi mail phải tắt cho tới khi validation xong.
- Retention chỉ xóa manifest/object đúng scope khi gọi `--apply`; mặc định là dry-run và luôn bảo vệ backup COMPLETE mới nhất theo environment/type.
- Backup artifact (`*.dump`, `*.enc`, WAL, restore data) không được track trong Git.

## Lệnh local preview

```powershell
cd C:\Projects\banking-system
$bytes = [byte[]](1..32) # khóa fixture disposable; không commit hoặc dùng staging
$env:BACKUP_ENCRYPTION_KEY = 'base64:' + [Convert]::ToBase64String($bytes)
$env:BACKUP_ENCRYPTION_KEY_ID = 'backup-local-v1'
$env:BANKING_ENV = 'preview'

node backend/scripts/backup-create.cjs --driver=docker --compose-env=.env.compose
node backend/scripts/backup-verify.cjs --manifest=<đường-dẫn-manifest>
node backend/scripts/restore-rehearsal.cjs --driver=docker --compose-env=.env.compose --manifest=<đường-dẫn-manifest>
node backend/scripts/backup-retention.cjs --retention-days=14
node backend/scripts/validate-backup-surface.cjs
```

`backup-scheduler.cjs` chỉ là scheduler ngoài process để dùng với Task Scheduler/cron; local không tự nhận là lịch vận hành. Provider production phải cấp short-lived credential, KMS envelope key, object storage private/versioned/retention và audit log.

## Điều kiện mở P1 đầy đủ

Owner/provider phải cấu hình workload identity, KMS key namespace theo môi trường, bucket private có versioning/immutability, managed PostgreSQL PITR, WAL lag/backup alerts, restore approval và diễn tập RPO/RTO. Các điều kiện đó chưa được giả lập trong repo.

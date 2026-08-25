# Backup và restore runbook — P1

Ngày cập nhật: 2026-08-25

Database chỉ chứa dữ liệu synthetic/virtual-money. Backup phải tách namespace môi trường và được restore thử vào database mới trước khi coi là bằng chứng. Local preview hiện đã có rehearsal tự động hóa; staging/production-like vẫn là gate provider thủ công.

## Trước migration hoặc promotion

- Kiểm tra thời điểm backup gần nhất, retention, RPO/RTO và checksum do provider trả về.
- Tạo restore point/PITR marker nếu provider hỗ trợ.
- Chạy migration `--plan` và `--verify-only`; không apply khi checksum lệch.
- Ghi `releaseId`, commit SHA, image digest, schema version và migration fingerprint vào change record.

## Rehearsal

1. Restore backup vào database tạm, không ghi đè database nguồn.
2. Chạy migration verify, schema validator, reconciliation và readiness.
3. Kiểm tra login/MFA, idempotency, outbox/worker và một smoke tài chính synthetic.
4. Đo thời gian restore, ghi RPO/RTO thực tế và hủy database tạm theo policy.

## Khôi phục sự cố

Ưu tiên rollback application nếu schema backward-compatible. Nếu cần PITR, tạo database mới từ mốc đã duyệt, validate đầy đủ rồi mới đổi connection secret/revision. Không xóa database cũ trước khi incident owner xác nhận.

Provider managed PostgreSQL, backup/PITR và quyền restore chưa được cấu hình trong workspace; phần này vẫn là gate thủ công.

## Local preview logical backup reference

`backup-create.cjs` dùng `pg_dump --format=custom` và truyền stream trực tiếp qua AES-256-GCM; không ghi plaintext dump. `BACKUP_ENCRYPTION_KEY` chỉ được cấp từ môi trường gọi lệnh và không được in log:

```powershell
$env:BACKUP_ENCRYPTION_KEY = "base64:<32-byte-disposable-local-key>"
$env:BACKUP_ENCRYPTION_KEY_ID = "backup-local-v1"
$env:BANKING_ENV = "preview"
node backend/scripts/backup-create.cjs --driver=docker --compose-env=.env.compose
node backend/scripts/backup-verify.cjs --manifest=<manifest.json>
node backend/scripts/restore-rehearsal.cjs --driver=docker --compose-env=.env.compose --manifest=<manifest.json>
node backend/scripts/backup-retention.cjs --retention-days=14
```

`restore-rehearsal.cjs` verify trước rồi mới stream decrypt vào `pg_restore` của database mới; target có prefix `restore_` và mặc định được dọn sau validation. Không dùng `--allow-plaintext-output` với dữ liệu thật. Manifest chỉ ghi metadata, checksum, LSN và count tổng hợp; không ghi key value, password, `DATABASE_URL` hay customer data. KMS/object storage/restore approval thật vẫn phải được cấu hình ở provider.

## PITR và key rotation

- `npm run backup:pitr:check -- --driver=docker --compose-env=..\.env.compose` chỉ kiểm tra PostgreSQL prerequisite; local hiện trả `NOT_CONFIGURED_LOCAL_PREVIEW` vì chưa bật WAL archive.
- Base backup/WAL/PITR, object storage, retention audit, alert và RPO/RTO production-like xem [`pitr-runbook.md`](pitr-runbook.md), [`backup-policy.md`](backup-policy.md) và [`backup-key-rotation.md`](backup-key-rotation.md).
- Không tự xóa source volume hoặc giả lập `archive_mode` để tạo evidence.

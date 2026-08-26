# Backup infrastructure contract

Thư mục này chỉ ghi contract provider-neutral cho P1; chưa có bucket/KMS/registry thật và không được coi là deployment evidence.

Provider cần cung cấp:

- bucket/container private theo namespace `staging` và `production-like`, TLS, versioning, retention, access audit và object lock nếu được duyệt;
- KMS envelope key theo environment/key version, workload identity ngắn hạn và quyền tách biệt backup/restore/application;
- scheduler ngoài process, distributed lock, retry idempotent, checksum/manifest verification;
- metrics/alert cho backup missing/failure/checksum/key availability/retention.

Local preview dùng `backend/scripts/backup-create.cjs --driver=docker`, lưu artifact dưới `artifacts/backups/` (đã ignore). Không commit dump/encrypted object vào Git.

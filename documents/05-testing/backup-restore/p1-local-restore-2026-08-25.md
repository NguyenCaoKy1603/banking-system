# P1 local logical backup/restore rehearsal — 2026-08-25

Môi trường: Docker Compose local, PostgreSQL 16, dữ liệu synthetic/virtual-money. Đây là evidence `UNTRUSTED LOCAL PREVIEW`, không thay thế staging/managed PostgreSQL/PITR.

## Kết quả

- Migration baseline: `028_dr_recovery_markers` đã apply; 28 migration checksum hợp lệ.
- Backup ID: `backup-cf806180-d48f-4763-a416-9b740e4dbf12`.
- Format: `pg_dump --format=custom --no-owner --no-privileges`, truyền thẳng qua AES-256-GCM; không tạo plaintext dump.
- Encrypted object: `364017` bytes; manifest có plaintext/ciphertext SHA-256 và key ID metadata-only.
- Verify: pass với authenticated metadata/checksum; sai key/tamper/truncate đã có unit test và bị từ chối.
- Restore: database mới `restore_cf806180d48f4763a4169b74`, sau validation đã dọn; source volume không bị xóa.
- Counts sau restore: customers 59, payment_accounts 69, transfers 10, account_transactions 80, ledger_journals 50, ledger_entries 110, outbox_events 70, audit_events 78, staff_users 135.
- Ledger: debit `220500` = credit `220500`; orphan business references `0`.
- Actual RTO của rehearsal: `3.288s` (một lần chạy local, không phải SLA).
- Actual RPO: chưa đo; logical backup không chứng minh PITR.

Manifest/report thật nằm ngoài Git dưới `artifacts/backups/` và đã được ignore. Bằng chứng cũ [`stage1-backup-restore-report.md`](../stage1-backup-restore-report.md) chỉ có 5 migration, được giữ để tham chiếu lịch sử, không dùng cho baseline hiện tại.

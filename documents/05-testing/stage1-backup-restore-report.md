# Stage 1 backup/restore rehearsal — local Compose (historical)

> Historical evidence only. This report used five migrations and must not be used for the current P1 baseline; the current rehearsal is [`backup-restore/p1-local-restore-2026-08-25.md`](backup-restore/p1-local-restore-2026-08-25.md).

Ngày kiểm tra: 2026-08-24 13:02 +07

Phạm vi: database `banking_preview` trong PostgreSQL 16 của Compose local. File dump được giữ ngoài repository tại thư mục tạm của máy phát triển và không commit.

## Kết quả

- `pg_dump --format=plain --no-owner --no-privileges` hoàn tất.
- Kích thước file dump: `71,918` bytes.
- SHA-256: `6B2A49B8B60EF192DB71BE0E8F266006C2C173C5940DB1ECB98FB0F2859B728E`.
- Tạo database tạm `banking_restore_test`, nạp dump bằng `psql -v ON_ERROR_STOP=1`, rồi kiểm tra dữ liệu.
- Kết quả sau restore: `reference_schema_migrations=5`, `customers=2`, `payment_accounts=2`, `reference_runtime_records=13`.
- Database tạm đã được xóa sau khi kiểm tra; named volume preview chính không bị xóa trong rehearsal này.

Đây là bằng chứng backup/restore local, không thay thế backup retention, encryption, PITR và rollback của managed PostgreSQL/cloud provider.

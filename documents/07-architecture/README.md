# Architecture decisions

Thư mục này lưu các ADR của hệ thống reference. ADR ghi quyết định trong phạm vi và thời điểm cụ thể; runtime code và current status cho biết quyết định đã được triển khai đến đâu.

| ADR | Chủ đề | Đọc kèm |
| --- | --- | --- |
| [p0-postgres-relational-v2-adr.md](p0-postgres-relational-v2-adr.md) | PostgreSQL, relational-v2 và cutover | [Current architecture](../02-design/architecture-and-scope.md), [migration runbook](../07-release/migration-runbook.md) |
| [p0-worker-outbox-adr.md](p0-worker-outbox-adr.md) | Transactional outbox và worker | [Worker runbook](../07-release/outbox-worker-runbook.md), [current status](../01-planning/current-status.md) |

Không suy từ ADR sang production readiness, provider approval hoặc quyền chạy migration/deployment.

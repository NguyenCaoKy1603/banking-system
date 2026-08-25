# Backup và restore runbook — Staging/Production-like

Ngày cập nhật: 2026-08-25

Database chỉ chứa dữ liệu synthetic/virtual-money. Backup phải tách namespace môi trường và được restore thử vào database mới trước khi coi là bằng chứng.

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

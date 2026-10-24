# Rollback runbook — immutable release

Ngày cập nhật: 2026-08-25

Áp dụng cho Staging và Production-like dùng tiền ảo. Rollback ứng dụng dùng lại release manifest/digest trước đó; không rebuild commit cũ và không chạy down migration tự động.

## Quyết định

1. Ghi incident ID, release hiện tại, digest hiện tại, digest mục tiêu và người phê duyệt.
2. Nếu schema mới tương thích ngược, giữ database và chuyển traffic về digest trước.
3. Nếu không tương thích, dừng rollout, ưu tiên forward fix; chỉ PITR sang database mới sau incident approval.
4. Không đổi secret bằng cách ghi giá trị vào log hoặc release record.

## Thao tác provider-agnostic

```text
verify signature/digest của rollback manifest
  → acquire environment deployment lock
  → deploy đúng image@sha256:<rollback-digest>
  → chờ /startupz và /readyz trên từng replica
  → đối chiếu /versionz với manifest
  → chạy API/Auth/MFA/worker smoke
  → chuyển traffic và drain revision lỗi
  → ghi audit + evidence
```

Không rollback bằng tag `latest`, `staging` hoặc `production`. Nếu readiness/reconciliation vẫn lỗi, giữ traffic ở revision khỏe và chuyển sang incident procedure.

## Còn thiếu ngoài workspace

Provider/container service, registry signature verification, deployment lock, traffic draining, managed PostgreSQL/PITR và reviewer chưa được cấu hình; chưa được coi là rehearsal đã đạt.

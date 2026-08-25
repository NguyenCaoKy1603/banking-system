# Migration job runbook

Migration không chạy trong API startup. Job phải chạy từ cùng image digest với release dự kiến.

## Kiểm tra trước khi apply

```powershell
node scripts/apply-migration.cjs --plan --release-id "$env:RELEASE_ID" --commit-sha "$env:BUILD_COMMIT_SHA" --image-digest "$env:IMAGE_DIGEST"
node scripts/apply-migration.cjs --verify-only
```

Nếu checksum mismatch, migration pending ngoài allow-list, lock timeout hoặc backup evidence hết hạn thì dừng. Không sửa migration đã apply và không chạy down migration tự động.

## Apply

```powershell
node scripts/apply-migration.cjs --release-id "$env:RELEASE_ID" --commit-sha "$env:BUILD_COMMIT_SHA" --image-digest "$env:IMAGE_DIGEST"
node scripts/apply-migration.cjs --verify-only
```

Runner ghi execution ID, release ID, commit SHA, image digest, checksum, thời lượng và status vào `reference_schema_migrations`. `--target <migration_key>` chỉ dùng cho rehearsal/expand step đã được reviewer duyệt.

## Rollback

Ưu tiên rollback application về digest trước nếu schema vẫn backward-compatible. Không tự động xóa cột/bảng. Nếu schema không tương thích, forward fix hoặc PITR sang database mới theo incident approval.

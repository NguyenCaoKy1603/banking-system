# Migration job runbook

Migration không chạy trong API startup. Job phải chạy từ cùng image digest với release dự kiến.

## Kiểm tra trước khi apply

```powershell
node scripts/apply-migration.cjs --plan --release-id "$env:RELEASE_ID" --commit-sha "$env:BUILD_COMMIT_SHA" --image-digest "$env:IMAGE_DIGEST"
node scripts/apply-migration.cjs --verify-only
```

Nếu checksum mismatch, migration pending ngoài allow-list, lock timeout hoặc backup evidence hết hạn thì dừng. Không sửa migration đã apply và không chạy down migration tự động.

## Ciphertext re-encryption checkpoint

Migration `026_secret_envelope_metadata` bổ sung metadata và bảng checkpoint cho MFA/notification ciphertext; `027_secret_rotation_inventory` bổ sung endpoint key ID và mốc tái mã hóa. Chạy inventory trước; chỉ áp dụng khi đã có current/previous keyring, backup đã được kiểm chứng và có phê duyệt:

```powershell
cd backend
$env:REENCRYPT_CONFIRM = "1"
npm run secrets:reencrypt -- --record-type=mfa-customer --apply
npm run secrets:reencrypt -- --record-type=mfa-staff --apply
npm run secrets:reencrypt -- --record-type=notification-endpoint --apply
```

Không đưa plaintext vào log. Script dùng row lock `FOR UPDATE` theo batch (cố ý không dùng `SKIP LOCKED`, vì checkpoint tăng dần không được phép bỏ qua bản ghi đang bận), lưu `encryption_rekey_checkpoints`, ghi key ID/version/AAD metadata và đọc được định dạng cũ trước khi ghi định dạng mới. Nếu thiếu provider/KMS thật, chỉ dùng local preview synthetic; không xem đó là staging rotation evidence.

## Apply

```powershell
node scripts/apply-migration.cjs --release-id "$env:RELEASE_ID" --commit-sha "$env:BUILD_COMMIT_SHA" --image-digest "$env:IMAGE_DIGEST"
node scripts/apply-migration.cjs --verify-only
```

Runner ghi execution ID, release ID, commit SHA, image digest, checksum, thời lượng và status vào `reference_schema_migrations`. `--target <migration_key>` chỉ dùng cho rehearsal/expand step đã được reviewer duyệt.

## Rollback

Ưu tiên rollback application về digest trước nếu schema vẫn backward-compatible. Không tự động xóa cột/bảng. Nếu schema không tương thích, forward fix hoặc PITR sang database mới theo incident approval.

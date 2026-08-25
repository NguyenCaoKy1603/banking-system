# Backup encryption key rotation

## Local preview

`BACKUP_ENCRYPTION_KEY` và `BACKUP_ENCRYPTION_KEY_ID` chỉ được truyền từ shell/secret test. `encrypted-backup.cjs` dùng AES-256-GCM và authenticated metadata; verify sai key, sửa metadata, sửa ciphertext hoặc truncate đều thất bại. Không lưu key vào manifest, Git, log hay backup object.

## Staging/production-like

- Key nằm trong KMS namespace riêng theo environment; backup agent chỉ có quyền encrypt/upload, restore operator mới được decrypt; API/Admin/CI không có quyền đọc.
- Manifest chỉ lưu `encryptionKeyId`. Key cũ giữ `DECRYPT_ONLY` tới khi backup phụ thuộc hết retention hoặc đã re-encrypt.
- Luân phiên theo envelope key version; kiểm tra old-key restore trước khi revoke; ghi checkpoint/audit ngoài source DB.
- Nếu KMS unavailable, dừng backup/restore promotion; không fallback sang plaintext hoặc key trong `.env`.

## Trình tự kiểm tra

1. Xác định danh sách backup/key version còn retention.
2. Tạo current key và quyền workload identity; kiểm tra encrypt/upload.
3. Tạo backup mới, verify manifest/checksum, restore rehearsal vào DB mới.
4. Re-encrypt hoặc giữ old key DECRYPT_ONLY; xác nhận old backup vẫn restore được.
5. Cập nhật registry/change record và chỉ destroy key sau approval.

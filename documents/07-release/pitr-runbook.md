# PITR/DR runbook — production-like (chưa cấu hình)

Tài liệu này là runbook mục tiêu, không phải bằng chứng đã có PITR. Local preview hiện không bật `archive_mode`, không có WAL object storage và giữ nguyên `IMAGE_DIGEST=unknown`.

## Kiểm tra không phá hủy

```powershell
cd C:\Projects\banking-system\backend
npm run backup:pitr:check -- --driver=docker --compose-env=..\.env.compose
```

Kết quả `NOT_CONFIGURED_LOCAL_PREVIEW` là đúng với môi trường hiện tại. Không xóa volume/source để “thử” PITR.

Trong local có thể ghi marker synthetic để kiểm tra schema bằng `npm run backup:marker` với `DATABASE_URL` trỏ vào preview. Marker không có dữ liệu người dùng và không làm cho RPO trở thành evidence; job phút một và phép đo `actualRpo` chỉ được bật ở production-like sau khi WAL archive thật hoạt động.

## Điều kiện provider cần có

1. PostgreSQL major giống nhau, `wal_level=replica`, `archive_mode=on`, archive command/library upload nguyên tử và idempotent.
2. Base backup có manifest/checksum; `pg_verifybackup` chỉ là kiểm tra bổ sung, vẫn phải restore boot thật.
3. WAL liên tục, timeline history và retention đủ dài; cảnh báo archive lag >2 phút và nguy cơ RPO >5 phút.
4. Restore target là instance mới/private, provider gửi mail/push và Worker tắt; chỉ restore operator được kết nối.

## Flow khi đã có provider

Incident Commander bật write kill switch → dừng Worker/jobs → ghi `incidentTime` ngoài source DB → chọn base backup/WAL/restore point → provision DB mới → replay WAL đến `recovery_target_time` hoặc named restore point → promote → chạy migration checksum, schema validator, reconciliation, ledger, login/MFA/read transfer → bump auth epoch/revoke session/challenge → chỉ bật Worker sau validation → cutover secret/traffic → giữ source read-only → ghi actual RPO/RTO và postmortem.

Không tự replay notification/transfer sau restore point khi chưa đối chiếu provider message ID hoặc core reconciliation. Không reverse cutover về source đã nhận write.

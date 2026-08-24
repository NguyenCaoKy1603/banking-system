# Preview persistent deployment runbook — Giai đoạn 1

Ngày cập nhật: 2026-08-24
Trạng thái: **Local/CI implementation đã có; cloud preview chưa triển khai**

Đây là runbook cho môi trường preview dùng dữ liệu và tiền mô phỏng. Backend reference vẫn từ chối `BANKING_ENV=production`/`NODE_ENV=production`; không dùng cho tiền thật, core banking, KYC/AML hoặc phát hành cho khách hàng.

## Kiến trúc

```text
Mobile APK / Web preview
          │ HTTPS (cloud preview — chưa cấu hình)
          ▼
Backend image (Node 22, JS build, non-root)
          │ private Compose network
          ▼
PostgreSQL 16 + named volume
```

Local/CI dùng `compose.yaml` với ba service: `postgres`, `migrate` và `backend`. `migrate` phải hoàn tất trước khi Backend khởi động. Database chỉ bind vào loopback cho local; cloud preview phải để database private trong network/provider.

## Chạy local

```powershell
Copy-Item .env.compose.example .env.compose
# Sửa tất cả giá trị change-this-* trong .env.compose.
docker compose --env-file .env.compose up -d --build
docker compose --env-file .env.compose ps
```

`DATABASE_URL` trong `.env.compose` phải dùng hostname `postgres`, không dùng `localhost` từ bên trong container. Không commit `.env.compose`; file này đã nằm trong `.gitignore`.

Kiểm tra health và smoke flow:

```powershell
Invoke-RestMethod http://127.0.0.1:5000/livez
Invoke-RestMethod http://127.0.0.1:5000/healthz
docker compose --env-file .env.compose exec backend node scripts/container-smoke.cjs
```

`/livez` chỉ xác nhận process còn chạy. `/healthz` và `/readyz` là readiness: phải truy cập được PostgreSQL, reconciliation không mismatch và outbox không vượt ngưỡng. Response chỉ chứa metadata service/environment/storage/commit, health state và trace ID; không chứa URL database, OTP, token hay account number.

## Migration, restart và persistence

```powershell
docker compose --env-file .env.compose run --rm migrate
docker compose --env-file .env.compose restart backend
docker compose --env-file .env.compose down
docker compose --env-file .env.compose up -d
```

Migration Node-native đọc SQL `001`–`005`, dùng transaction và advisory lock. Chạy lại migration phải in `already applied` và không tạo bảng trùng. `down` không kèm `--volumes` giữ dữ liệu; chỉ dùng `docker compose down --volumes` khi chủ động reset dữ liệu giả lập.

CI chạy smoke flow lần đầu, restart Backend, rồi login lại cùng user để chứng minh PostgreSQL volume giữ state. CI disposable không được dùng dữ liệu thật.

## Backup/restore và rollback

Trước thay đổi schema, operator phải tạo backup ngoài Git và ghi checksum/thời gian:

```powershell
docker compose --env-file .env.compose exec -T postgres pg_dump -U $env:POSTGRES_USER $env:POSTGRES_DB > preview-backup.sql
Get-FileHash preview-backup.sql -Algorithm SHA256
```

Restore phải thực hiện vào database tạm, kiểm tra migration/health/reconciliation rồi mới cân nhắc preview. Không tự chạy down migration. Rollback ứng dụng dùng image digest trước đó; nếu schema không backward-compatible thì dừng deploy và khôi phục backup đã kiểm chứng. Bằng chứng cloud backup/restore và rollback chưa có trong workspace.

## Cloud preview còn phải làm thủ công

- Chọn provider hỗ trợ container, HTTPS tự động, secret manager, log/health và PostgreSQL private; hiện chưa chốt provider.
- Sau lần CI đầu tiên của workflow này, maintainer cần thêm check `Preview container smoke / container-smoke` vào required status checks của `main` nếu branch protection đang dùng allow-list cố định.
- Push image lên GHCR hoặc registry được duyệt, gắn tag commit SHA và lưu digest.
- Tạo managed PostgreSQL private, chạy migration job một lần, deploy đúng digest và cấu hình `/healthz` làm readiness.
- Cấp `BANKING_*` qua secret manager; không đưa OTP/operator key vào `EXPO_PUBLIC_*` hoặc Mobile.
- Gán domain HTTPS `https://<preview-api-domain>/api/v1`, giới hạn `BANKING_ALLOWED_ORIGINS`, kiểm tra origin lạ nhận `403`.
- Tạo EAS environment/profile preview, build APK internal, cài không Metro/ADB reverse và ghi SHA-256.

Không đánh dấu Giai đoạn 1 hoàn tất cho tới khi có URL HTTPS, image digest, migration log, health JSON, APK checksum, backup/restore và rollback rehearsal trên môi trường cloud được duyệt.

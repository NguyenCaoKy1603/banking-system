# Stage 1 deployment report — Docker và Preview Persistent

Ngày kiểm tra: 2026-08-24
Baseline Giai đoạn 0: `6a512e9`
Branch triển khai: `codex/stage1-docker-preview`
Trạng thái: **Implementation local/CI đang tiến hành; chưa phải cloud preview**

## Thay đổi đã thực hiện

| Hạng mục | Kết quả |
| --- | --- |
| Migration runtime | Thay `tsx` bằng `scripts/apply-migration.cjs`; giữ transaction/advisory lock và kiểm tra migration state |
| Backend image | `backend/Dockerfile` multi-stage, Node 22, production dependencies, `node dist/server.js`, user `node`, healthcheck, commit SHA build arg |
| Compose | `compose.yaml` gồm PostgreSQL 16 + named volume, migrate one-shot và backend phụ thuộc migration |
| Secret boundary | `.env.compose.example` chỉ là placeholder; `.env.compose` bị ignore; Compose không public database ngoài loopback local |
| Health | `/livez` độc lập database; `/healthz`/`/readyz` readiness; response không chứa secret; startup log JSON có commit/storage/environment |
| CORS | Origin ngoài allow-list preview trả `403 CORS_ORIGIN_DENIED` |
| Container smoke | `scripts/container-smoke.cjs` kiểm tra liveness/readiness, CORS, registration, MFA, login và accounts; CI chạy lại login sau restart |
| CI | `.github/workflows/preview-container-smoke.yml` build image, migrate database rỗng, re-run migration idempotent, health, smoke, restart Backend, restart toàn Compose giữ volume và teardown volume |

## Gate local đã chạy

- Backend typecheck: đạt.
- Backend build: đạt.
- Backend test: 90 definition, 84 pass, 6 PostgreSQL/relational skip vì Docker daemon chưa chạy.
- Backend container smoke: đạt trên Backend in-memory với `BANKING_ENV=preview`; đây không thay thế Docker/PostgreSQL evidence.
- Health JSON đã làm sạch được ghi tại [`health-preview-local.json`](health-preview-local.json), chỉ phản ánh in-memory preview và không chứa credential/token/account number.
- `node --check` cho migration runner và container smoke: đạt.
- `docker compose config --quiet`: đạt với bộ biến CI test-only.
- `docker info`: Docker client có nhưng Docker Desktop Linux engine không kết nối được; chưa thể build image, chạy Compose, migrate PostgreSQL, restart persistent hoặc lấy image digest.

## Acceptance matrix

| Tiêu chí | Kết quả hiện tại |
| --- | --- |
| Docker build từ clone sạch | Chờ Docker daemon/CI |
| Runtime JS non-root | Đã thiết kế trong Dockerfile; chờ image inspection |
| Migration rỗng/lặp | Runner đã có; chờ PostgreSQL/CI |
| Health healthy/DB lỗi | Có test liveness tách DB và persistent failure; chờ Compose |
| Persistence/restart/concurrency | Existing PostgreSQL tests + CI workflow; local chưa chạy |
| HTTPS API bên ngoài | Chưa có provider/domain |
| APK không Metro/ADB reverse | Chưa có EAS environment/API URL |
| Secret scan/image/log | `.dockerignore`, env boundary và startup log đã cập nhật; image scan chờ registry/CI |
| Backup/restore/rollback | Runbook đã định nghĩa; chưa rehearsal cloud |

## Evidence còn thiếu

Chưa tạo được migration log, Docker image digest, cloud health URL/JSON, APK SHA-256 staging, backup/restore report hoặc rollback rehearsal vì chưa có Docker engine, registry/provider, HTTPS domain, managed PostgreSQL và EAS account trong workspace. Health JSON local ở trên không được dùng thay cho cloud evidence. Không ghi các mục còn thiếu là “đạt” bằng dữ liệu giả.

Giai đoạn 1 chỉ được đóng sau khi CI container smoke xanh và maintainer bổ sung toàn bộ evidence cloud/device nêu trên.

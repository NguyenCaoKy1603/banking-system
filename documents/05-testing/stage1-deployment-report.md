# Stage 1 deployment report — Docker và Preview Persistent

Ngày kiểm tra: 2026-08-24
Baseline Giai đoạn 0: `6a512e9`
Branch triển khai: `codex/stage1-docker-preview`
Implementation commit: `6438083`
Trạng thái: **Local Docker/CI implementation đã kiểm chứng; chưa phải cloud preview**

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
- Backend test với PostgreSQL/relational disposable: 91 definition, 91 pass, 0 skip.
- Backend critical HTTP: 10/10 pass; database contract: 28 bảng; OpenAPI draft: 46 path/51 method guards.
- Backend container smoke: đăng ký/đăng nhập lần đầu đạt; restart Backend giữ session data đạt; restart toàn Compose giữ named volume và đăng nhập lại đạt.
- Health JSON PostgreSQL local đã làm sạch được ghi tại [`stage1-docker-health.json`](stage1-docker-health.json); health in-memory lịch sử vẫn nằm tại [`health-preview-local.json`](health-preview-local.json).
- Migration log database rỗng/lặp: [`stage1-docker-migration.md`](stage1-docker-migration.md).
- Backup/restore rehearsal local: [`stage1-backup-restore-report.md`](stage1-backup-restore-report.md).
- `node --check` cho migration runner và container smoke: đạt.
- `docker compose config --quiet`: đạt với bộ biến CI test-only.
- `docker compose build --pull=false backend migrate`: đạt; builder typecheck/build và production dependency audit đều 0 vulnerability.
- Runtime inspect: backend/migrate chạy bằng user `node` (UID 1000), production image không có `node_modules/tsx`; image ID local được ghi trong `stage1-docker-health.json`.
- Docker Desktop Linux engine đã chạy; migration, health, persistence, backup/restore và restart rehearsal đều đã có bằng chứng local.
- Chạy lại đúng chuỗi biến môi trường của workflow CI (port 55432/55000, volume rỗng, migration lặp, smoke lần đầu, restart Backend và restart toàn stack) cũng đạt; remote GitHub Actions vẫn cần maintainer mở PR để ghi nhận check.

## Acceptance matrix

| Tiêu chí | Kết quả hiện tại |
| --- | --- |
| Docker build từ clone sạch | Local Compose build đạt; clone sạch/remote CI còn chờ |
| Runtime JS non-root | Đạt: `node`, UID 1000; production image không có `tsx` |
| Migration rỗng/lặp | Đạt trên PostgreSQL 16 named volume; log applied/already-applied |
| Health healthy/DB lỗi | Đạt: `/livez`/`/healthz` Compose healthy; liveness khi DB lỗi có regression |
| Persistence/restart/concurrency | Đạt local: smoke qua backend/Compose restart; PostgreSQL + relational 91/91 |
| HTTPS API bên ngoài | Chưa có provider/domain |
| APK không Metro/ADB reverse | Chưa có EAS environment/API URL |
| Secret scan/image/log | Local npm audit production 0; env boundary, non-root và startup log đã inspect; registry image scan còn chờ |
| Backup/restore/rollback | Backup/restore local đạt; rollback cloud/provider còn chờ image digest trước đó |

## Evidence còn thiếu

Đã tạo migration log, local image ID/health JSON và backup/restore report. Chưa có cloud health URL/JSON, registry digest, APK SHA-256 staging hoặc provider rollback rehearsal vì workspace chưa có registry/provider, HTTPS domain, managed PostgreSQL và EAS account. Local evidence ở trên không được dùng thay cho cloud evidence. Không ghi các mục còn thiếu là “đạt” bằng dữ liệu giả.

Phần Docker/Preview Persistent local của Giai đoạn 1 đã hoàn thành. Việc đóng toàn bộ milestone vẫn cần remote CI xanh và evidence cloud/device (HTTPS, managed PostgreSQL, registry digest, EAS APK và thiết bị thật).

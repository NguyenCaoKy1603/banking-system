# Preview environment matrix — Giai đoạn 1

Ngày cập nhật: 2026-08-24

| Môi trường | Backend | Database | Secrets | Health/CI | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| Local Compose | Docker multi-stage, Node 22 JS runtime, non-root, một replica | PostgreSQL 16 named volume, loopback-only port | `.env.compose` local, không commit | `/livez`, `/healthz`, `/readyz`, `container-smoke.cjs` | Đạt local: build, migration rỗng/lặp, smoke/restart, backup/restore |
| GitHub Actions | Build target `runtime` từ commit SHA | PostgreSQL 16 service/container private trong job | Test-only env của workflow, không phải secret production | `preview-container-smoke.yml`: migrate, health, API smoke, restart-login | Đã thêm workflow; chờ remote run |
| Cloud preview | Backend image digest từ GHCR/registry | Managed PostgreSQL private | Secret manager của provider | HTTPS proxy + readiness + log/alert | Chưa cấu hình provider/domain/account |
| EAS preview APK | Internal APK profile, `EXPO_PUBLIC_API_URL` HTTPS | Gọi cloud preview API | Không chứa OTP/operator key | SHA-256 + device smoke, không Metro/ADB reverse | Chưa có EAS environment/API URL thực tế |
| Production | Bị Backend guard từ chối | Không áp dụng | Không áp dụng | Không tuyên bố production-ready | Ngoài phạm vi |

Các cột cloud/EAS chỉ được chuyển sang “Đạt” khi có URL, credential quản lý ngoài Git, evidence và người review được ghi nhận.

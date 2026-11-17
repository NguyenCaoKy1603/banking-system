# PROJECT_CONTEXT — Banking System / NOVA

> Cập nhật hiện hành. Repository: `banking-system`. Branch: `main`.

Dự án là **reference implementation** cho ứng dụng ngân hàng di động NOVA, vận hành bằng dữ liệu tổng hợp và tiền ảo trong môi trường local preview. Mục tiêu là minh họa cách tổ chức các luồng Mobile, Customer API, Admin API, PostgreSQL relational persistence, idempotency, MFA và outbox worker.

---

## 1. Bản đồ cấu trúc thư mục (Canonical Structure)

| Thư mục / Tệp tin | Vai trò chính |
| :--- | :--- |
| `backend/` | Customer API (`src/server.ts`, `src/http.ts`), Admin API (`src/adminServer.ts`), Outbox Worker (`src/worker.ts`), Database Migrations (`database/`) |
| `mobile-app/` | Ứng dụng di động khách hàng Expo SDK 57 / React Native 0.86 (`src/app/`, `src/features/`) |
| `admin-web/` | Giao diện vận hành cho nhân viên ngân hàng React/Vite (`src/`) |
| `documents/` | Toàn bộ tài liệu kiến trúc, đặc tả use-case, OpenAPI contracts và runbooks triển khai |
| `infrastructure/` | Staging deployment contract cho quy trình CI |
| `observability/` | Bộ đo kiểm Prometheus metrics, structured logger và request context |
| `performance/` | Script kiểm thử tải nhẹ (smoke test) |
| `compose.yaml` | Cấu hình Docker Compose chạy full stack local |
| `AGENTS.md` | Nguyên tắc bắt buộc về bảo mật, ownership, database và quality gates |
| `README.md` | Hướng dẫn khởi động nhanh (Quickstart) cho lập trình viên |

---

## 2. Tài liệu trọng yếu cần đọc theo thứ tự

1. [`AGENTS.md`](AGENTS.md) — Quy tắc an toàn, quyền sửa đổi và quality gates.
2. [`README.md`](README.md) — Hướng dẫn cài đặt và chạy stack local.
3. [`documents/01-planning/current-status.md`](documents/01-planning/current-status.md) — Hiện trạng tính năng và các giới hạn kỹ thuật.
4. [`documents/01-planning/repository-map-current.md`](documents/01-planning/repository-map-current.md) — Bản đồ chi tiết từng file source code.
5. [`documents/02-design/architecture-and-scope.md`](documents/02-design/architecture-and-scope.md) — Kiến trúc tổng thể và ranh giới dữ liệu.
6. [`documents/api/README.md`](documents/api/README.md) — Đặc tả OpenAPI contract.

---

## 3. Quality Gates bắt buộc trước khi commit

* **Backend**: `npm run validate:database`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:critical`, `npm run validate:openapi`
* **Mobile**: `npm run lint`, `npm run typecheck`, `npm test`, `npm run validate:openapi`, `npm run export:web`
* **Admin Web**: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`

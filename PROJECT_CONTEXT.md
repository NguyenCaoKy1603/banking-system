# PROJECT_CONTEXT — Banking System / NOVA

> Cập nhật hiện hành (2026-11-27). Repository: `banking-system`. Branch: `main` (đã hợp nhất `origin/main` và `Duong`).

Dự án là **reference implementation** cho ứng dụng ngân hàng di động NOVA, vận hành bằng dữ liệu tổng hợp và tiền ảo trong môi trường local preview. Mục tiêu là minh họa đầy đủ chuỗi luồng Mobile, Customer API, Admin API/Web, PostgreSQL relational-v2 persistence (`001`–`051`), double-entry ledger & đối soát, idempotency, TOTP & device-bound biometric MFA, phát hiện giao dịch bất thường, chuyển khoản liên ngân hàng mô phỏng NAPAS IBFT / VietQR, quản trị chính sách động và outbox/lifecycle worker.

---

## 1. Bản đồ cấu trúc thư mục (Canonical Structure)

| Thư mục / Tệp tin | Vai trò chính |
| :--- | :--- |
| `backend/` | Customer API (`src/server.ts`, `src/http.ts`, `src/routes/`, `src/controllers/`, `src/domain/`, `src/database/`), Admin API (`src/adminServer.ts`, `src/admin/`), Outbox & Lifecycle Worker (`src/worker.ts`, `src/workers/`), Database Migrations `001`–`051` (`database/`) |
| `mobile-app/` | Ứng dụng di động khách hàng Expo SDK 57 / React Native 0.86 (`src/app/`, `src/features/`, `src/services/security/`) |
| `admin-web/` | Giao diện vận hành & quản trị ngân hàng React/TypeScript/Vite (`src/features/` gồm Overview, Customers, Applications KYC/Credit, Transfers & Anomalies, Approvals, Operations, Policy & Ledger Reconciliation, Staff, Audit) |
| `documents/` | Toàn bộ tài liệu kế hoạch, kiến trúc, đặc tả 40 use-case, OpenAPI contracts (`70` Customer paths / `62` Admin paths), Admin RBAC và runbooks triển khai |
| `infrastructure/` | Staging deployment contract provider-neutral cho quy trình CI |
| `observability/` | Bộ đo kiểm Prometheus metrics, structured redacted logger và request context |
| `performance/` | Script kiểm thử tải nhẹ (smoke test) |
| `compose.yaml` | Cấu hình Docker Compose chạy full stack local (bind backend `0.0.0.0:5000` hỗ trợ LAN preview) |
| `AGENTS.md` | Nguyên tắc bắt buộc về bảo mật, ownership, database và quality gates |
| `README.md` | Hướng dẫn khởi động nhanh (Quickstart) cho lập trình viên |

---

## 2. Tài liệu trọng yếu cần đọc theo thứ tự

1. [`AGENTS.md`](AGENTS.md) — Quy tắc an toàn, quyền sửa đổi và quality gates.
2. [`README.md`](README.md) — Hướng dẫn cài đặt và chạy stack local.
3. [`documents/01-planning/current-status.md`](documents/01-planning/current-status.md) — Hiện trạng tính năng, kết quả kiểm tra mới nhất và các giới hạn kỹ thuật.
4. [`documents/01-planning/repository-map-current.md`](documents/01-planning/repository-map-current.md) — Bản đồ chi tiết từng module/file source code.
5. [`documents/02-design/architecture-and-scope.md`](documents/02-design/architecture-and-scope.md) — Kiến trúc tổng thể và ranh giới dữ liệu.
6. [`documents/02-design/use-cases-complete-specification.md`](documents/02-design/use-cases-complete-specification.md) — Đặc tả chi tiết 40 Use Cases toàn hệ thống.
7. [`documents/api/README.md`](documents/api/README.md) — Đặc tả OpenAPI & narrative contracts.

---

## 3. Quality Gates bắt buộc trước khi commit

* **Backend**: `npm run validate:database`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:critical`, `npm run validate:openapi`, `npm run validate:admin-openapi`, `npm run validate:secrets`
* **Mobile**: `npm run lint`, `npm run typecheck`, `npm test`, `npm run validate:openapi`, `npm run validate:public-env`, `npm run validate:release`, `npm run export:web`
* **Admin Web**: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`

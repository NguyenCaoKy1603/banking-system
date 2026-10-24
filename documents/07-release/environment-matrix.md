# Environment matrix

| Hạng mục | Development | Local preview | Staging | Production-like |
|---|---|---|---|---|
| Dữ liệu | synthetic, reset được | synthetic local | synthetic riêng | synthetic kiểm soát |
| API | local | loopback HTTP | HTTPS domain riêng | HTTPS domain riêng |
| Admin Web/API | local Vite + Admin API | same-origin HTTP qua Nginx → `http://admin-api:5001` | same-origin HTTPS qua Nginx → HTTPS upstream | same-origin HTTPS qua Nginx → HTTPS upstream |
| PostgreSQL | container riêng | volume local | managed instance riêng | managed instance riêng |
| PostgreSQL TLS | `DATABASE_SSL_MODE=disable` | `DATABASE_SSL_MODE=disable` | `verify-full` + CA + `DATABASE_SERVER_NAME` | `verify-full` + CA + `DATABASE_SERVER_NAME` |
| Secret | `.env` bị ignore | `.env.compose` bị ignore | Secret Manager namespace riêng | Secret Manager namespace riêng |
| Secret provider runtime | local env provider | local env provider, fail-closed ngoài preview | managed provider + workload identity bắt buộc | managed provider + workload identity bắt buộc |
| Ciphertext key rotation | manual local rehearsal, v1 đọc tương thích | checkpoint/re-encryption chỉ là synthetic evidence | dual-read KMS rotation + checkpoint/restore evidence | KMS/HSM rotation + incident/restore evidence |
| Image | build local | build local | registry digest | cùng digest đã pass Staging |
| Replicas | 1 | 1 | tối thiểu 2 API | tối thiểu 2 API |
| Worker | tùy chọn | tùy chọn | 1–2, lease/restart | ít nhất 1, drain có kiểm soát |
| Backup | không cam kết | mục tiêu RPO 24h/RTO 2h; local logical rehearsal | mục tiêu RPO 24h/RTO 2h | mục tiêu RPO ≤5m/RTO ≤60m |
| Tiền | virtual only | virtual only | virtual only | virtual only |

## Verification mode

| Môi trường | Mode hợp lệ | Reviewer độc lập |
|---|---|---|
| Staging học thuật synthetic/solo | `SOLO_ACADEMIC_OWNER` | Không; owner xác nhận bằng `verifiedBy=repository-owner` và `independentReview=false` |
| Production-like | `INDEPENDENT_REVIEW` | Bắt buộc |

Solo mode chỉ xác nhận phạm vi học thuật, tiền ảo và dữ liệu synthetic;
không phải tuyên bố production readiness.

## Admin Web runtime contract

Admin Web được build một lần thành image độc lập môi trường. Mọi môi trường
chỉ cấp cấu hình lúc container khởi động:

| Môi trường | `ADMIN_WEB_ENV` | `ADMIN_API_UPSTREAM` | Quy tắc |
|---|---|---|---|
| Development | `preview` (Vite proxy) | `http://127.0.0.1:5001` | chỉ dành cho local |
| Local preview | `preview` | `http://admin-api:5001` | HTTP localhost/container network |
| Staging | `staging` | origin HTTPS thật của Admin API | fail-closed nếu không phải HTTPS |
| Production-like | `production-like` | origin HTTPS thật của Admin API | fail-closed nếu không phải HTTPS |

Frontend chỉ gọi `/api/v1`; không dùng `VITE_ADMIN_API_URL` hay
`STAGING_ADMIN_API_URL`, không bake endpoint vào bundle. Upstream phải là một
origin không có path, query, fragment hoặc credential. Nginx giữ URI, cookie,
CSRF và request ID, tắt cache API và CSP chỉ cho `connect-src 'self'`.

Môi trường không dùng chung network, database, secret namespace, DNS, logging hoặc backup. Không có endpoint sandbox funding/operator key trong Staging/Production-like.

`disable` chỉ dành cho Development/Local preview với dữ liệu synthetic và loopback/container network. Runtime production-like từ chối `disable`, `require` hoặc thiếu CA/server name; trust store/CA phải được cấp qua Secret Manager hoặc cơ chế mount được phê duyệt, không commit vào repository. `BANKING_SECRET_PROVIDER=managed` chỉ là hợp lệ khi deployment đã inject một client provider thật; adapter mặc định trong workspace cố ý từ chối khởi động.

# Environment matrix

| Hạng mục | Development | Local preview | Staging | Production-like |
|---|---|---|---|---|
| Dữ liệu | synthetic, reset được | synthetic local | synthetic riêng | synthetic kiểm soát |
| API | local | loopback HTTP | HTTPS domain riêng | HTTPS domain riêng |
| Admin | local | loopback HTTP | HTTPS + allowlist | HTTPS + allowlist/VPN nếu có |
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

Môi trường không dùng chung network, database, secret namespace, DNS, logging hoặc backup. Không có endpoint sandbox funding/operator key trong Staging/Production-like.

`disable` chỉ dành cho Development/Local preview với dữ liệu synthetic và loopback/container network. Runtime production-like từ chối `disable`, `require` hoặc thiếu CA/server name; trust store/CA phải được cấp qua Secret Manager hoặc cơ chế mount được phê duyệt, không commit vào repository. `BANKING_SECRET_PROVIDER=managed` chỉ là hợp lệ khi deployment đã inject một client provider thật; adapter mặc định trong workspace cố ý từ chối khởi động.

# Environment matrix

| Hạng mục | Development | Local preview | Staging | Production-like |
|---|---|---|---|---|
| Dữ liệu | synthetic, reset được | synthetic local | synthetic riêng | synthetic kiểm soát |
| API | local | loopback HTTP | HTTPS domain riêng | HTTPS domain riêng |
| Admin | local | loopback HTTP | HTTPS + allowlist | HTTPS + allowlist/VPN nếu có |
| PostgreSQL | container riêng | volume local | managed instance riêng | managed instance riêng |
| PostgreSQL TLS | `DATABASE_SSL_MODE=disable` | `DATABASE_SSL_MODE=disable` | `verify-full` + CA + `DATABASE_SERVER_NAME` | `verify-full` + CA + `DATABASE_SERVER_NAME` |
| Secret | `.env` bị ignore | `.env.compose` bị ignore | Secret Manager namespace riêng | Secret Manager namespace riêng |
| Image | build local | build local | registry digest | cùng digest đã pass Staging |
| Replicas | 1 | 1 | tối thiểu 2 API | tối thiểu 2 API |
| Worker | tùy chọn | tùy chọn | 1–2, lease/restart | ít nhất 1, drain có kiểm soát |
| Backup | không cam kết | không cam kết | RPO 24h/RTO 2h | RPO 15–60m/RTO 1h |
| Tiền | virtual only | virtual only | virtual only | virtual only |

Môi trường không dùng chung network, database, secret namespace, DNS, logging hoặc backup. Không có endpoint sandbox funding/operator key trong Staging/Production-like.

`disable` chỉ dành cho Development/Local preview với dữ liệu synthetic và loopback/container network. Runtime production-like từ chối `disable`, `require` hoặc thiếu CA/server name; trust store/CA phải được cấp qua Secret Manager hoặc cơ chế mount được phê duyệt, không commit vào repository.

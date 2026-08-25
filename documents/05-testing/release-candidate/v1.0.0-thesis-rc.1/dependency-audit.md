# Dependency and supply-chain audit

| Surface | Install/audit result |
| --- | --- |
| Backend | `npm ci --ignore-scripts` PASS; high-audit gate PASS, 0 vulnerabilities |
| Mobile | `npm ci --ignore-scripts` PASS; high-audit gate PASS, 0 vulnerabilities |
| Admin | `npm ci --ignore-scripts` PASS; high-audit gate PASS, 0 vulnerabilities |
| Container bases | Node 22 and Postgres 16 references are digest-pinned in the checked-in Docker/Compose files; Admin nginx is digest-resolved by Docker during the local build |

Deprecation notices from transitive development packages were not high/critical audit findings. Remote registry scanning and provenance verification were not run.

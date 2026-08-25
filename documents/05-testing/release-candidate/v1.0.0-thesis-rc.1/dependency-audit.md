# Dependency and supply-chain audit

## Run metadata

- Tested source commit: `9399604be95bb4c578eca1f4421c1702a5384193`.
- Branch: `codex/p0-postgres-foundation`.
- Evidence recorded: `2026-08-26` (Asia/Bangkok).
- Toolchain: Node `v24.19.0`, npm `11.17.0`, Docker `28.4.0`.
- Commands: `npm ci --ignore-scripts` and `npm audit --omit=dev --audit-level=high` for Backend, Mobile and Admin; local Docker image builds.

| Surface | Install/audit result |
| --- | --- |
| Backend | `npm ci --ignore-scripts` PASS; high-audit gate PASS, 0 vulnerabilities |
| Mobile | `npm ci --ignore-scripts` PASS; high-audit gate PASS, 0 vulnerabilities |
| Admin | `npm ci --ignore-scripts` PASS; high-audit gate PASS, 0 vulnerabilities |
| Container bases | Node 22 and Postgres 16 references are digest-pinned in the checked-in Docker/Compose files; Admin nginx is digest-resolved by Docker during the local build |

Deprecation notices from transitive development packages were not high/critical audit findings. Remote registry scanning and provenance verification were not run.

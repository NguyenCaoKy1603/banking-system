# Admin quality evidence

## Run metadata

- Branch: `codex/p0-postgres-foundation`.
- Evidence recorded: `2026-08-26` (Asia/Bangkok).
- Source binding: the final RC source is the commit in the signed `release-manifest.json` and the peeled commit of tag `v1.0.0-thesis-rc.1`.
- Toolchain: Node `v24.19.0`, npm `11.17.0`, Docker `28.4.0`, Compose `v2.39.4-desktop.1`.
- Commands: `npm ci --ignore-scripts`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build`, `npm audit --omit=dev --audit-level=high`.

- Historical pre-patch clean-clone evidence is retained below; it is not the final RC source binding.
- `npm ci --ignore-scripts`: PASS, 0 vulnerabilities.
- `npm run typecheck`: PASS.
- `npm test`: PASS, 5/5 tests.
- `npm run build`: PASS.
- `npm run test:e2e`: PASS, 1/1 Playwright test.
- `npm run audit`: PASS, 0 vulnerabilities.
- Shared runtime-proxy fixture: PASS for `/readyz` and `/api/v1/admin/me`, including `Host` and `X-Forwarded-Host` on two upstreams.

The static Admin image was hardened to run as the unprivileged `nginx` user on internal port 8080; Compose maps the existing host port to that port. Final image smoke returned HTTP 200.

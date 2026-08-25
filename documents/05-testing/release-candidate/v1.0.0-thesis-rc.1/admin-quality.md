# Admin quality evidence

## Run metadata

- Tested source commit: `9399604be95bb4c578eca1f4421c1702a5384193`.
- Branch: `codex/p0-postgres-foundation`.
- Evidence recorded: `2026-08-26` (Asia/Bangkok).
- Toolchain: Node `v24.19.0`, npm `11.17.0`, Docker `28.4.0`, Compose `v2.39.4-desktop.1`.
- Commands: `npm ci --ignore-scripts`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build`, `npm audit --omit=dev --audit-level=high`.

- Tested source: `9399604be95bb4c578eca1f4421c1702a5384193` clean clone.
- `npm ci --ignore-scripts`: PASS, 0 vulnerabilities.
- `npm run typecheck`: PASS.
- `npm test`: PASS, 3/3 tests.
- `npm run build`: PASS.
- `npm run test:e2e`: PASS, 1/1 Playwright test.
- `npm run audit`: PASS, 0 vulnerabilities.

The static Admin image was hardened to run as the unprivileged `nginx` user on internal port 8080; Compose maps the existing host port to that port. Final image smoke returned HTTP 200.

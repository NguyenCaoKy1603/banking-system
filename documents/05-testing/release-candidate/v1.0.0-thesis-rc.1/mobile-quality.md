# Mobile quality evidence

## Run metadata

- Tested source commit: `9399604be95bb4c578eca1f4421c1702a5384193`.
- Branch: `codex/p0-postgres-foundation`.
- Evidence recorded: `2026-08-26` (Asia/Bangkok).
- Toolchain: Node `v24.19.0`, npm `11.17.0`, Java `17.0.12`.
- Commands: `npm ci --ignore-scripts`, lint, typecheck, Jest/test coverage, OpenAPI/Maestro/public-env/release validators, audit and HTTPS-placeholder web export.

- Tested source: `9399604be95bb4c578eca1f4421c1702a5384193` clean clone.
- `npm ci --ignore-scripts`: PASS, 0 vulnerabilities.
- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `npm test -- --runInBand`: PASS, 46 suites / 259 tests.
- `npm run test:coverage -- --runInBand`: PASS, 84.72% statements, 86.11% branches, 92.98% functions, 85.13% lines.
- `npm run validate:openapi`: PASS.
- `npm run validate:e2e`: PASS, 10 Maestro flows syntax-checked.
- `npm run validate:public-env`: PASS; no forbidden public secret variable.
- `npm run validate:release`: PASS; preview/staging APK profiles are structurally valid.
- `npm audit --omit=dev --audit-level=high`: PASS, 0 vulnerabilities.
- `npm run export:web`: PASS with an HTTPS placeholder API URL; no sandbox URL was injected.

No Android APK or physical/emulator E2E evidence was created in this run.

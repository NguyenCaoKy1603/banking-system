# Release-quality rehearsal summary

## Run metadata

- Tested source commit: `9399604be95bb4c578eca1f4421c1702a5384193`.
- Branch: `codex/p0-postgres-foundation`.
- Evidence recorded: `2026-08-26` (Asia/Bangkok).
- Toolchain: Node `v24.19.0`, npm `11.17.0`, PostgreSQL `16.15` disposable image.
- Command: `npm run test:release` with disposable PostgreSQL credentials injected only for the test process.

The final clean-clone `npm run test:release` matrix completed 17/17 PASS on source `9399604be95bb4c578eca1f4421c1702a5384193`:

| Group | Result |
| --- | --- |
| Aggregate unit/HTTP | 173 tests, 140 passed, 0 failed, 33 skipped by guard policy |
| Critical HTTP | PASS, 10/10 |
| Database guard | PASS, 5/5 |
| Database foundation | PASS, 4/4 |
| Relational adapter regression | PASS, 1/1 |
| Persistent MFA | PASS, 1/1 |
| Registration/provider boundary | PASS, 1/1 |
| Savings persistence | PASS, 2/2 |
| Credit persistence | PASS, 3/3 |
| Remaining routes | PASS, 2/2 |
| Lifecycle persistence | PASS, 3/3 |
| Lifecycle scheduler | PASS, 2/2 |
| Runtime email provider | PASS, 3/3 |
| Integrated disposable rehearsal | PASS, 1/1 |
| Admin database | PASS, 8/8 |
| Persistence regression | PASS, 11/11 |
| Worker lease/retry/restart/load | PASS, 10/10 |

The 33 aggregate skips are intentional protection against accidentally touching `banking_preview`; each corresponding disposable group passed. No production-like or staging database was used.

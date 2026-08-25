# Backend quality evidence

- Tested source: `9399604be95bb4c578eca1f4421c1702a5384193` in a clean clone.
- `npm ci --ignore-scripts`: PASS, 0 vulnerabilities.
- `npm run release:gate`: PASS before evidence commit; 32 tracked migrations and clean tree.
- `npm run validate:secrets -- --history`: PASS (592 tracked files).
- `npm run validate:secret-registry`: PASS (7 metadata-only entries).
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- `npm audit --omit=dev --audit-level=high`: PASS, 0 vulnerabilities.
- `npm run test:release`: PASS, all 17/17 commands.
- `npm run validate:database`: PASS (49 tables).
- `npm run validate:relational-v2`: PASS (all relational invariants zero).
- `npm run validate:outbox`: PASS (all outbox invariants zero; legacy pending requiring review: 0).
- `npm run validate:admin-schema`: PASS (37 tables).
- `npm run validate:admin-authz`: PASS (63 routes, 46 permissions, 4 roles).
- `npm run validate:admin-openapi`: PASS (63 routes).
- `npm run validate:openapi`: PASS (52 required paths).

The CI workflow fixes were also exercised from this source: the backend worker
validator targets the disposable worker database, and the Mobile service image
uses the pinned Postgres digest. No preview database was involved.

The PostgreSQL validators and all release tests used disposable `banking_test_*` databases created from the local maintenance connection. `banking_preview` was not reset, migrated, or used by the tests. The aggregate suite reports 173 tests, 140 passed, 0 failed, 33 skipped by the explicit disposable-database policy; every skipped PostgreSQL group has a passing disposable command in the 17-command release matrix.

Migration fingerprinting is canonicalized to LF content, so the Windows working tree and clean clone produce the same `1a768…` digest. The legacy raw checksum for `002_savings_sandbox.sql` is accepted only for compatibility and is upgraded to the canonical checksum without rerunning SQL.

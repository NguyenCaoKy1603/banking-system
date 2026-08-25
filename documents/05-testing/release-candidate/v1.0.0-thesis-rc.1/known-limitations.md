# Known limitations and blockers

## Evidence metadata

- Tested source commit: `9399604be95bb4c578eca1f4421c1702a5384193`.
- Branch: `codex/p0-postgres-foundation`.
- Evidence recorded: `2026-08-26` (Asia/Bangkok).
- Status values in this document are explicit `PASS`, `NOT RUN`, or limitation statements; no credential is included.

1. Migration fingerprinting now normalizes CRLF/CR to LF. The clean clone and Windows checkout both produce canonical digest `1a768…`; raw legacy checksum `5ec06…` for `002_savings_sandbox.sql` is compatibility-only.
2. This is local/disposable evidence only. No staging deployment, staging HTTPS, remote CI, main-branch merge, registry push, GHCR digest, Cosign signature, SBOM, SLSA/provenance attestation, backup/rollback staging rehearsal, SLO or on-call evidence exists.
3. No signed RC APK or physical-device E2E was produced. Mobile evidence is unit/contract/static-export evidence.
4. Money remains synthetic virtual money; this is not a production banking or payment-rail release.
5. `IMAGE_DIGEST=unknown` remains correct for local images without a registry manifest. It must be replaced by a verified `sha256:` manifest digest before staging/production-like startup.
6. The preview worker remains off and legacy preview outbox rows are not promoted. Staging must start from a clean database with migrations 001–032.

The prior `code_review.md` deletion is already represented in the source history; this run did not make a new decision about restoring it.

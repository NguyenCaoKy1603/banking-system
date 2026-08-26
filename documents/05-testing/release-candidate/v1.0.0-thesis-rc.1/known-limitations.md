# Known limitations and blockers

## Evidence metadata

- Branch: `codex/p0-postgres-foundation`.
- Evidence recorded: `2026-08-26` (Asia/Bangkok).
- Status values in this document are explicit `PASS`, `NOT RUN`, or limitation statements; no credential is included.
- Release binding: the final source is the `sourceCommit` in the signed `release-manifest.json` and the peeled commit of tag `v1.0.0-thesis-rc.1`.

1. Migration fingerprinting now normalizes CRLF/CR to LF. The clean clone and Windows checkout both produce canonical digest `1a768…`; raw legacy checksum `5ec06…` for `002_savings_sandbox.sql` is compatibility-only.
2. The PR remote checks are available, but main-branch merge, tag-triggered registry push, GHCR digest, Cosign signature, SBOM, SLSA/provenance attestation, staging deployment, staging HTTPS, backup/rollback rehearsal, SLO and on-call evidence are still `NOT RUN` for this patch.
3. No signed RC APK or physical-device E2E was produced. Mobile evidence is unit/contract/static-export evidence.
4. Money remains synthetic virtual money; this is not a production banking or payment-rail release.
5. `IMAGE_DIGEST=unknown` remains correct for local images without a registry manifest. It must be replaced by a verified `sha256:` manifest digest before staging/production-like startup.
6. The preview worker remains off and legacy preview outbox rows are not promoted. Staging must start from a clean database with migrations 001–032; staging deployment is explicitly out of scope for this patch.

The prior `code_review.md` deletion is already represented in the source history; this run did not make a new decision about restoring it.

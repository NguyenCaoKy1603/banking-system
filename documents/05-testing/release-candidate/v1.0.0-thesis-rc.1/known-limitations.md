# Known limitations and blockers

1. The clean-clone migration fingerprint (`1a768…`) differs from the Windows working-tree fingerprint (`4a500…`) because the fingerprint hashes raw bytes and `002_savings_sandbox.sql` has an EOF newline representation difference. This blocks an immutable release-candidate decision until the fingerprint policy is normalized and rerun.
2. This is local/disposable evidence only. No staging deployment, staging HTTPS, remote CI, main-branch merge, registry push, GHCR digest, Cosign signature, SBOM, SLSA/provenance attestation, backup/rollback staging rehearsal, SLO or on-call evidence exists.
3. No signed RC APK or physical-device E2E was produced. Mobile evidence is unit/contract/static-export evidence.
4. Money remains synthetic virtual money; this is not a production banking or payment-rail release.
5. `IMAGE_DIGEST=unknown` remains correct for local images without a registry manifest. It must be replaced by a verified `sha256:` manifest digest before staging/production-like startup.
6. The preview worker remains off and legacy preview outbox rows are not promoted. Staging must start from a clean database with migrations 001–032.

The prior `code_review.md` deletion is already represented in the source history; this run did not make a new decision about restoring it.

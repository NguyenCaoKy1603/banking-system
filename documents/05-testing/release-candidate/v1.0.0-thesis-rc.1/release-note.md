# v1.0.0-thesis-rc.1 — release-candidate source preparation

## Evidence metadata

- Branch: `codex/p0-postgres-foundation`.
- Evidence recorded: `2026-08-26` (Asia/Bangkok).
- Release binding: the final source is the commit recorded in the signed `release-manifest.json` and the peeled commit of tag `v1.0.0-thesis-rc.1`.
- Verification commands are listed in the Backend, Mobile, Admin and Container evidence files; the final PR gates must be green before merging.

This note records preparation of a release-candidate source for the relational-v2 core, persistent MFA/email boundary, lifecycle scheduler, Outbox worker, Mobile, Admin and container surfaces. It is not staging or production approval.

Notable hardening in the tested source:

- Runtime HTTP email provider remains disabled only for local/test and is covered by HTTP capture/retry/fail-closed tests.
- Worker runtime is relational-v2-only when cutover confirmation is required and starts the durable lifecycle scheduler with catch-up, leases and readiness.
- Admin static image runs as non-root nginx on internal port 8080.
- All database rehearsal uses disposable databases and migrations 001–032.

The local quality gate is reproducible with the canonical migration fingerprint. Registry publication is pending the tag workflow; its signed digests, SBOM, provenance and manifest are the authoritative release evidence. Staging deployment remains out of scope for this patch.

# v1.0.0-thesis-rc.1 — local rehearsal note

## Evidence metadata

- Tested source commit: `9399604be95bb4c578eca1f4421c1702a5384193`.
- Branch: `codex/p0-postgres-foundation`.
- Evidence recorded: `2026-08-26` (Asia/Bangkok).
- Verification commands are listed in the Backend, Mobile, Admin and Container evidence files; all local gates are PASS and external promotion is `NOT RUN`.

This note records a local, disposable rehearsal for the relational-v2 core, persistent MFA/email boundary, lifecycle scheduler, Outbox worker, Mobile, Admin and container surfaces. It is **not** an approved Release Candidate and must not be deployed to staging.

Notable hardening in the tested source:

- Runtime HTTP email provider remains disabled only for local/test and is covered by HTTP capture/retry/fail-closed tests.
- Worker runtime is relational-v2-only when cutover confirmation is required and starts the durable lifecycle scheduler with catch-up, leases and readiness.
- Admin static image runs as non-root nginx on internal port 8080.
- All database rehearsal uses disposable databases and migrations 001–032.

The local quality gate is now reproducible with the canonical migration fingerprint. Promotion remains pending because remote CI, registry digest/signature/provenance and staging evidence listed in `known-limitations.md` do not exist yet.

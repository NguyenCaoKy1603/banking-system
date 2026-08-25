# v1.0.0-thesis-rc.1 — local rehearsal note

This note records a local, disposable rehearsal for the relational-v2 core, persistent MFA/email boundary, lifecycle scheduler, Outbox worker, Mobile, Admin and container surfaces. It is **not** an approved Release Candidate and must not be deployed to staging.

Notable hardening in the tested source:

- Runtime HTTP email provider remains disabled only for local/test and is covered by HTTP capture/retry/fail-closed tests.
- Worker runtime is relational-v2-only when cutover confirmation is required and starts the durable lifecycle scheduler with catch-up, leases and readiness.
- Admin static image runs as non-root nginx on internal port 8080.
- All database rehearsal uses disposable databases and migrations 001–032.

Promotion is blocked by the migration fingerprint reproducibility mismatch and by the absence of remote registry/signature/provenance/staging evidence listed in `known-limitations.md`.

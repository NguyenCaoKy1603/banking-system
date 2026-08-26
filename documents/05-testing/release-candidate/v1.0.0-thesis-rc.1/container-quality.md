# Container quality evidence

## Run metadata

- Branch: `codex/p0-postgres-foundation`.
- Evidence recorded: `2026-08-26` (Asia/Bangkok).
- Source binding: the final RC source is the commit in the signed `release-manifest.json` and the peeled commit of tag `v1.0.0-thesis-rc.1`.
- Toolchain: Docker `28.4.0`, Compose `v2.39.4-desktop.1`, PostgreSQL `16.15` disposable image.
- Commands: Compose config, Docker builds, image-surface validation, nginx smoke, disposable migration twice, API/Admin/worker endpoint probes, HTTP registration, API/worker restart, SQL invariants and log scan.

- `docker compose ... config --quiet`: PASS.
- `container-release` workflow validator: PASS; release is tag-only and publish permissions are job-scoped.
- Backend runtime image build: PASS; configured user `node` (UID 1000).
- Admin runtime image build: PASS; configured user `nginx` (UID 101), internal port 8080.
- Backend `validate:image-surface`: PASS; no source tree, `.env`, or `tsx` runtime surface.
- Admin image smoke: PASS, HTTP 200.
- Shared runtime-proxy fixture: PASS for `/readyz` and `/api/v1/admin/me`; both upstream Host values and the browser `X-Forwarded-Host` were verified on two Admin Web containers using one image ID.
- Final pre-patch disposable container rehearsal: PASS on the historical baseline; runtime image includes the canonical migration helper. This evidence is not the final RC source binding.

The rehearsal created a separate Docker network and PostgreSQL container, applied migrations 001–032 twice, started relational-v2 API/Admin API, a local HTTP capture email provider, two Outbox workers with lifecycle schedulers, checked API `/livez`, `/startupz`, `/readyz`, `/healthz`, `/versionz`, checked Admin API/Web and the same worker endpoints, verified scheduler `lastSuccessfulTick`, completed registration over HTTP, verified the capture OTP was consumed once and only a digest was persisted, confirmed customer creation before and after API restart, confirmed outbox pending count was zero, checked ledger/balance invariants, checked logs for secret/OTP-like leakage, restarted one worker and verified readiness. All containers and the network were removed afterward. The preview Compose project and `banking_preview` were not restarted or migrated.

Local image metadata uses `IMAGE_DIGEST=unknown` by design. No registry digest, Cosign signature, SBOM, provenance attestation, or staging HTTPS evidence exists yet.

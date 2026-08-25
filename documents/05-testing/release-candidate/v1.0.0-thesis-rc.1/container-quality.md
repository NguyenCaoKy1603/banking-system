# Container quality evidence

- `docker compose ... config --quiet`: PASS.
- Backend runtime image build: PASS; configured user `node` (UID 1000).
- Admin runtime image build: PASS; configured user `nginx` (UID 101), internal port 8080.
- Backend `validate:image-surface`: PASS; no source tree, `.env`, or `tsx` runtime surface.
- Admin image smoke: PASS, HTTP 200.
- Final disposable container rehearsal: PASS on `167824d5888fac7139bd1cd245fb4fa49502b48c`; runtime image includes the canonical migration helper.

The rehearsal created a separate Docker network and PostgreSQL container, applied migrations 001–032 twice, started relational-v2 API/Admin API, two Outbox workers with lifecycle schedulers, checked API/Admin/worker readiness, confirmed outbox pending count was zero, checked logs for secret/OTP-like leakage, stopped one worker and verified restart readiness. All containers and the network were removed afterward. The preview Compose project and `banking_preview` were not restarted or migrated.

Local image metadata uses `IMAGE_DIGEST=unknown` by design. No registry digest, Cosign signature, SBOM, provenance attestation, or staging HTTPS evidence exists yet.

# 07 — Release và vận hành

## Trạng thái

Đây là project academic/reference với tiền ảo. Local Compose, APK local, migration test và rehearsal không đồng nghĩa cloud staging đã được nghiệm thu. Trong hồ sơ hiện có chưa thấy evidence hoàn chỉnh cho public HTTPS, managed PostgreSQL, secret manager, signed APK, partner/core integration, monitoring, backup restore drill và rollback trên staging.

Đọc [current status](../01-planning/current-status.md) trước khi dùng runbook. Hồ sơ HTTPS/secrets được lập theo các đợt 2026-10-05 và local lab 2026-10-13; xác minh lại với owner nếu môi trường ngoài workspace đã thay đổi.

## Runbooks theo chủ đề

| Chủ đề | Tài liệu | Lưu ý |
| --- | --- | --- |
| Environment | [environment-matrix.md](environment-matrix.md) | Runtime fail-closed; tiền ảo; local sandbox HTTP chỉ ở local |
| Local preview | [preview-deployment-runbook.md](preview-deployment-runbook.md) | Compose/reference instructions, không phải cloud deployment approval |
| HTTPS/secrets readiness | [local HTTPS learning lab](local-https-secrets-learning-lab.md), [environment-matrix.md](environment-matrix.md) | Lab local không chứng minh cloud IAM/HTTPS/managed secrets |
| Secret management | [secret-management-runbook.md](secret-management-runbook.md) và secret-registry.yaml | Registry chỉ mô tả metadata/reference; không lưu secret value |
| Database migration | [migration-runbook.md](migration-runbook.md) | Forward-only; kiểm tra checksum; không down migration |
| Backup/restore | Đã gỡ bỏ | Đồ án học thuật vận hành 1 PostgreSQL database duy nhất; các tài liệu lý thuyết backup/PITR đã được dọn sạch để khớp với mã nguồn. |
| Worker | [outbox-worker-runbook.md](outbox-worker-runbook.md) | Worker yêu cầu opt-in và cutover; provider thật chưa được xác minh |
| Rollback/incident | [rollback-runbook.md](rollback-runbook.md), [incident-checklist.md](incident-checklist.md) | Chỉ chạy với image/db target có owner và evidence rõ |
| Observability | [observability-local-preview.md](observability-local-preview.md) | Metric/health contract local không chứng minh alerting/SLO vận hành |
| Release artifact | [immutable-release-process.md](immutable-release-process.md), [release-note.template.md](release-note.template.md) | Pin commit, digest, migration fingerprint, artifact checksum và reviewer |

## Promotion gates

Trước khi gọi một môi trường là staging/pilot, cần có tối thiểu:

1. Owner xác nhận môi trường, quyền truy cập, dữ liệu synthetic và chi phí.
2. HTTPS hostname/certificate, origin allow-list và Mobile HTTPS build.
3. PostgreSQL private, migration/checksum, persistence cutover và database TLS.
4. Secret provider/IAM tối thiểu, không fallback environment file ở production-like.
5. Image/build digest, commit SHA, contract/migration fingerprints và health/version evidence.
6. Unit/integration, device, smoke, backup/restore và rollback rehearsal phù hợp.
7. Legal/compliance, security, partner/core và release reviewer approvals.

Không hạ threshold để pass gate. Không dùng dữ liệu thật hoặc lệnh destructive ngoài database disposable đã guard xác nhận.

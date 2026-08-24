# Giai đoạn 2 — Security verification report

Ngày chạy: 2026-08-24  
Build ID: `stage2-20260824-df1f40b`  
Phạm vi: reference sandbox local, không phải production certification.

## Đã kiểm tra

| Nhóm | Bằng chứng | Kết quả |
| --- | --- | --- |
| Session/auth | refresh rotation/reuse, logout-all, device binding, MFA challenge | Đạt trong full/critical suite |
| Rate limit | login, registration, challenge/step-up bounded window | Đạt trong full suite |
| Authorization | beneficiary/account isolation, fraud report owner isolation, server policy | Đạt trong full suite |
| Input/routing | malformed body, unknown/trailing route, CORS | Đạt trong critical suite |
| Error/log redaction | trace ID giữ nguyên, không echo password material | Đạt trong HTTP regression |
| Financial integrity | idempotency, pending/reversal, reconciliation, no double debit | Đạt trong full + performance integrity smoke |
| Dependency audit | backend và mobile `npm audit --omit=dev --audit-level=high` | 0 vulnerability local |
| Runtime secret canary | scan Docker logs và image history với canary strings | Không phát hiện canary |
| Container hardening | backend container health, runtime user `node`/UID 1000 | Đạt local |

## Dependency finding đã xử lý cục bộ

Finding High trước đây đi qua Metro/Expo `image-size` được ghi nhận tại [`dependency-risk-acceptance.md`](../06-security-ai/dependency-risk-acceptance.md). Lockfile hiện audit local bằng 0; vẫn cần remote CI xác nhận và review compatibility trước khi coi là release evidence.

## Còn thiếu trước khi đóng security gate

- GitHub Actions/remote dependency scan, SBOM và container registry scan.
- APK/native binary scan và kiểm tra package signing.
- MASTG/TalkBack/biometric/camera trên thiết bị thật.
- Cloud staging TLS, secret store, rate-limit/proxy và monitoring evidence.

Không đưa password, OTP, token, PIN, CVV, account number đầy đủ hoặc raw request body vào report.

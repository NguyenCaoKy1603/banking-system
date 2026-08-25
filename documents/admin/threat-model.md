# Threat model và baseline P0

## Baseline đã xác minh

- Repo đang có thay đổi MFA/PostgreSQL chưa commit trên `codex/p0-postgres-foundation`; không reset/ghi đè.
- Migration trước Admin là `018_mfa_challenge_constraints.sql`; Admin dùng migration additive `019–025`.
- Public `http.ts` không còn funding, scheduled-work hoặc OTP fixture route. Seed E2E chỉ dùng database fixture cô lập hoặc tài khoản đã cấp tiền qua Admin bốn mắt.
- Credit customer flow bắt đầu ở `SUBMITTED`; chỉ Admin decision mới đưa sang `PENDING_ACTIVATION`.
- eKYC Mobile vẫn là mock; Admin KYC/credit tables chỉ là nguồn case synthetic cho reference review.

## Controls

- Staff account riêng, password hash, TOTP secret mã hóa, session/refresh hash, authorization version, idle 15 phút/absolute 8 giờ.
- Cookie HttpOnly + SameSite Strict; CSRF header; CORS allow-list; Admin bind localhost/private network.
- Deny-by-default route registry; permission kiểm tra mỗi request; PII/account-number reveal là permission riêng và phải audit.
- Audit redact password/token/OTP/TOTP/cookie/secret/CVV/PIN/full account number/database URL/encryption key. Runtime không update/delete audit.
- Typed action tables và fingerprint/version chống sửa payload, IDOR và stale approval.

## Rủi ro còn lại

Admin Web chưa thay thế toàn bộ customer-facing mock workflow; browser Playwright synthetic E2E và OWASP ZAP baseline preview đã chạy, nhưng chưa có MinIO/object-storage eKYC, native device E2E, email invite provider hoặc production credential provisioning. Migration `023`/`025` đã định nghĩa DB roles/RLS và case scope; preview vẫn chạy owner role và cần `app.staff_id`/`app.staff_scope` + credential riêng ở staging. Fraud block/revoke/reversal còn chờ domain adapter. Vì vậy milestone này là reference hardening, không phải production readiness.

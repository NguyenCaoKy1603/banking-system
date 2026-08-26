# Giai đoạn 2 — API contract/runtime report

Ngày chạy: 2026-08-24  
Build ID: `stage2-20260824-df1f40b`

Evidence commit: `c31b33e` (runtime contract checks use the baseline backend image; test/docs changes are traceable in `e293100` and `c31b33e`).

## Kết quả

- Backend `npm run validate:openapi`: đạt `46` required paths và `51` exact method/segment guards.
- Mobile `npm run validate:openapi`: đạt `43` required paths và các marker route/reference.
- Critical HTTP suite: `10/10` pass, gồm health/liveness, CORS, trailing route, auth, account, quote, transfer pending, beneficiary và challenge-bound step-up.
- Full backend suite: `92/92` pass, gồm malformed payload validation, error trace, response redaction, idempotency và persistence.
- Mobile unit/validator suite: `46` suites, `260/260` tests pass; Maestro flow validator `10/10` flow syntax hợp lệ.

## Contract cases đã có bằng chứng

- Unknown/trailing route không được dispatch theo prefix.
- Payload lỗi trả trace ID nhưng không echo password material.
- Financial response dùng server-authoritative amount/balance/status.
- Transfer, savings, credit payment và fraud report giữ idempotency/replay semantics.
- Device binding và challenge-bound step-up được kiểm tra ở HTTP/runtime.

## Chưa thể kết luận

Chưa có consumer contract test từ app mobile chạy trên APK với cloud staging; vì vậy remote API compatibility, TLS/proxy thực tế và server version skew vẫn là việc cần maintainer chạy tiếp.

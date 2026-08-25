# P0 Admin control plane — phiên triển khai

## Kết quả đã xác minh

- Admin API tách process/port `:5001`, Admin Web `:5173`; preview chỉ publish trên localhost.
- PostgreSQL migrations `019–025` chạy được trên database hiện tại và idempotent; `022` tách permission tạo yêu cầu mở khóa customer, `023` tách DB principals/RLS/domain tables, `024` thêm policy four-eyes cho staff invite, `025` căn chỉnh ABAC case scope.
- Toàn bộ migration `001–025` đã được diễn tập trên database rỗng, chạy lại lần hai không đổi checksum và các validator database/admin/outbox/relational đều pass.
- Staff login password + TOTP, session/refresh rotation, CSRF, CORS, deny-by-default route registry và four-eyes action engine đã có.
- Funding persistent đi qua account transaction + balanced ledger + audit + transactional outbox trong cùng transaction; row lock chống thực thi trùng.
- Funding reversal và transfer reversal đã đi qua domain adapter persistent; kiểm tra source/status/version/số dư, tạo bút toán đảo cân bằng, transaction history, audit và outbox trong cùng transaction.
- Outbox event do Admin tạo đã dùng registry/envelope canonical (kể cả funding/reversal/transfer/staff invite); requeue chỉ nhận `DEAD`/`SKIPPED` có payload hợp lệ, event type/version được hỗ trợ, aggregate metadata khớp và không có event cùng deduplication key đang `PROCESSING`. Attempts được giữ nguyên, lock/dead-letter marker được dọn để tạo retry cycle mới.
- Credit customer-facing không còn tự duyệt: hồ sơ mới là `SUBMITTED`; quyết định Admin chỉ đưa sang `PENDING_ACTIVATION` hoặc `REJECTED`.
- Customer/account/application/transfer/fraud/outbox/job/staff/audit routes có server-side permission; đọc dữ liệu quản trị được audit và dữ liệu liên hệ mặc định được che.
- Transfer và fraud detail có timeline hợp nhất từ audit, transaction, Outbox, case action và internal note; note được sanitize trước khi lưu và không đi qua Customer API.
- Admin API HTTP E2E đã chạy thật qua login password + TOTP, CSRF, customer-realm token bị từ chối, Operations tạo funding, tự duyệt trả `SELF_APPROVAL_FORBIDDEN`, Control step-up/approve và replay approval không tạo mutation lần hai.
- Browser Playwright E2E đã chạy với bốn fixture role: funding → Control approve → số dư tăng một lần; account block; KYC/Credit; pending transfer; fraud triage/resolution; Outbox DEAD requeue; Job DEAD retry; staff disable → Support session bị thu hồi.
- Compatibility writer legacy đã được chặn không xóa/ghi đè audit và outbox append-only hoặc các bản ghi core đang được Admin tham chiếu; test replay sentinel xác nhận các event vẫn tồn tại. `clear()`/helper chỉ dùng `TRUNCATE ... CASCADE` trong disposable test database.

## Gate phiên này

| Gate | Kết quả |
|---|---|
| Backend typecheck/build | pass |
| Backend test | 106 pass, 19 skip, 0 fail / 125 (skips là các PostgreSQL suites khi chạy không truyền env trong lệnh tổng; các suite DB đã chạy riêng với PostgreSQL) |
| Critical API | 10 pass |
| Admin unit/workflow | 21 pass khi chạy với PostgreSQL; không còn skip trong môi trường có DB (workflow, authz, ABAC, auth/MFA và HTTP E2E) |
| Admin API HTTP E2E | 2 pass; MFA, CSRF, realm isolation, full P0 case operations, funding four-eyes và idempotent replay |
| Admin PostgreSQL integration | 8 pass; funding/reversal, compatibility replay, ledger/outbox rollback fault injection, stored-XSS-safe fraud note, lock restart persistence và worker/Admin canonical outbox race |
| Admin concurrency | 1 pass |
| MFA/relational-v2 database tests | MFA 4 pass; relational adapter 1 pass; database foundation 4 pass |
| Worker/outbox regression | 9 pass trên PostgreSQL disposable |
| Admin schema/authz/OpenAPI | pass; 37 bảng, permission four-eyes, 63 route |
| Database/relational/outbox validators | pass |
| Dependency/security scan | backend và Admin Web audit 0 High/Critical; operator-key scan 0 occurrence; OWASP ZAP Admin Web/API baseline 0 FAIL (chỉ cảnh báo thấp đã ghi trong evidence) |
| Admin Web lint/typecheck/unit/build/audit | pass; unit 3 pass, audit 0 vulnerability |
| Admin Web Playwright E2E | 1 pass; browser maker-checker flow với Operations/Control/Support/ADMIN |
| Mobile regression | lint/typecheck pass; 46 suites/260 tests pass; OpenAPI 43 paths; Maestro 10 flow definitions; HTTPS web export 36 routes |
| Docker preview smoke | fresh disposable DB: Public API health 200, Admin API `/livez` 200, Admin Web 200; registration challenge 202; CSP có |

## Residual risk / blocker còn lại

Đây vẫn là reference hardening, chưa phải production-ready:

- Các endpoint public `/sandbox/fundings`, `/sandbox/process-scheduled`, `/sandbox/otp/{challengeId}` và operator-key config/runtime đã bị loại bỏ; fixture seed dùng DB transaction nội bộ hoặc dữ liệu pre-seeded.
- Staff invite đã có maker-checker và chỉ tạo staff sau khi checker duyệt; delivery provider/token hand-off chưa triển khai nên preview cần một kênh cấp invite an toàn ngoài repository.
- Password staff hiện dùng PBKDF2 reference implementation; production cần Argon2id hoặc adapter đã phê duyệt.
- DB principals/RLS/policy đã có migration, nhưng preview local vẫn chạy bằng owner role; production phải cấp credential riêng và đặt `app.staff_id`/`app.staff_scope` cho mọi transaction. ABAC case queue hiện giới hạn theo assigned/unassigned scope, chưa có unit/tenant directory thật.
- Fraud `BLOCK/REVOKE/REVERSAL` vẫn yêu cầu domain adapter riêng; chỉ `RESOLVE` được thực thi trong P0.
- Quyết định `APPROVED` và execution vẫn là hai transaction boundary; recovery path đã cho phép retry action đang `APPROVED` sau process death và row lock bảo đảm một domain mutation, nhưng vẫn cần fault-injection/chaos verification trước production. Audit domain và mutation/ledger/outbox vẫn cùng transaction execution.
- Worker/outbox provider thật và event delivery Admin chưa bật trong preview; event Admin hiện đã canonical và worker-safe nhưng các event pending/dead vẫn phải qua runbook reconciliation, không được coi là đã gửi ra kênh thật.
- Playwright browser E2E synthetic và OWASP ZAP baseline preview đã có (`FAIL-NEW: 0`); vẫn chưa có device E2E native trong môi trường hiện tại. OpenAPI Admin vẫn đánh dấu `DRAFT` cho tới khi chốt deployment contract.
- Preview volume chính không bị reset; sau khi rebuild/restart hiện `/healthz`, Admin `/livez` và Admin Web đều trả 200 với reconciliation/outbox `ok`. Nếu fixture cũ được nạp lại, phải điều tra/reconcile theo runbook thay vì xóa volume.
- Các test PostgreSQL chạy local/CI khi có service; các test device thật không được coi là đã chạy chỉ vì Maestro definition validate thành công.

Không đưa secret, token, OTP, TOTP hoặc full account number vào tài liệu/bằng chứng. Không push/deploy từ phiên này.

# Admin control plane P0 (reference sandbox)

## Trạng thái

Đây là control plane tách process với Public Banking API. Browser chỉ gọi
đường dẫn cùng origin `/api/v1`; Admin Web Nginx chuyển tiếp tới Admin API qua
`ADMIN_API_UPSTREAM` được cấp lúc container khởi động. Admin API mặc định chạy
`127.0.0.1:5001` ở local, dùng realm phiên staff riêng, cookie
HttpOnly/SameSite=Strict và CSRF token cho request thay đổi dữ liệu. Dữ liệu
chỉ là tiền mô phỏng; không dùng cho tiền thật, core banking, payment rail
hoặc KYC thật.

```text
Browser → Admin Web :5173 (same-origin `/api/v1`)
    │ cookie staff + CSRF
    ▼
Nginx trong Admin Web → `ADMIN_API_UPSTREAM`
    ▼
Admin API :5001 (localhost/private network)
    ├─ StaffAuthService (password + TOTP, session rotation)
    ├─ Permission registry (deny-by-default, route registry)
    ├─ AdminActionEngine (maker → checker, fingerprint, idempotency)
    └─ PostgresAdminRepository
          ├─ staff/session/action/audit tables
          ├─ relational account/ledger/outbox transaction
          └─ append-only audit + transactional outbox

Customer Mobile → Public API :5000 → customer realm
```

Trong Docker Compose, upstream là `http://admin-api:5001`, không phải
`127.0.0.1` (địa chỉ đó trỏ vào chính container Admin Web). Staging và
production-like bắt buộc upstream HTTPS; thiếu hoặc sai origin làm container
fail-closed trước khi Nginx chạy. Image/bundle không chứa URL môi trường.

Public API không mount route `/admin`. Admin API không chấp nhận customer bearer token; staff session có bảng và hash riêng. UI chỉ hiển thị policy/result; mọi authorization, freshness, version và fingerprint được kiểm tra lại ở server.

Customer search/detail trong P0 trả email/số điện thoại đã che; các lần đọc customer/account/transaction/audit đều tạo audit event. PII đầy đủ và account number đầy đủ chưa được mở trong reference UI nếu chưa có permission/ABAC và quy trình reveal riêng.

## Data flow command

`request → authenticate staff → resolve roles/scope → require permission → validate typed body + Idempotency-Key → read/lock target → snapshot version/status + fingerprint → PENDING_APPROVAL + audit → checker step-up MFA → lock action FOR UPDATE → reject self-approval/stale/fingerprint mismatch → domain mutation + ledger/history + outbox + audit → SUCCEEDED/FAILED → commit`.

Funding dùng minor-unit `bigint`, chỉ VND, tối đa 100.000.000 minor-unit mỗi action trong reference P0. Không có đường nhập số âm để hoàn tác và không cập nhật balance thiếu account transaction/ledger/audit/outbox.

## Trạng thái adapter nghiệp vụ

Migration 019–025 và action engine đã có đường persistent cho account/customer lock, simulation funding + reversal, KYC/credit case review, transfer retry/cancel/reversal, fraud claim/note/resolve, outbox requeue và background-job retry. Migration 022 căn chỉnh permission mở khóa customer; 023 tách DB principals/RLS/domain tables; 024 đưa staff invite vào four-eyes; 025 mở unassigned case queue cho triage nhưng vẫn giới hạn case đã phân công. Các mutation đều đi qua typed request detail, row lock và audit; fraud block/revoke/reversal vẫn chờ adapter domain riêng. KYC document chỉ lưu metadata/object key giả, không lưu bytes/PII thật.

Public reference không còn endpoint/operator key bypass; fixture seed chạy bằng DB transaction nội bộ hoặc dữ liệu pre-seeded. Local preview đã có provider HTTP `invitation-capture` trong memory để hoàn tất luồng maker-checker → activation; token chỉ đi qua delivery seam tạm thời, còn PostgreSQL giữ hash. Device E2E native, provider invite HTTPS/credential thật cho staging, credential provisioning cho DB role, Argon2id và eKYC object store thật vẫn là residual risk. Vì vậy milestone này là reference hardening, không phải production readiness hay kết nối tiền thật.

# M7 — Credit card sandbox status

Ngày cập nhật: 2026-08-24

## Phạm vi đã triển khai

- Một `CardInstrument` VND cấp sẵn cho mỗi user; limit `20.000.000`, posted outstanding seed `4.000.000`, pending authorization `0`, available `16.000.000`.
- Sao kê có cycle/close, due sau 15 ngày, minimum payment `max(statement × 5%, 100.000)`, fee `0`, timezone policy `Asia/Ho_Chi_Minh` ở mức sandbox.
- Backend API draft: `/cards`, lock/unlock, `/credit/accounts`, transactions, statements, payment quote, payment submit/status.
- Thanh toán có quote snapshot, statement version, MFA/step-up, idempotency, PENDING/FAILED/REVERSED, ledger double-entry, audit/outbox và reconciliation.
- Mobile có danh sách/chi tiết thẻ, giao dịch, sao kê, thanh toán MINIMUM/FULL/CUSTOM, SecureStore intent và resume sau timeout/restart. Không lưu OTP/PIN/CVV/PAN.

## Chính sách không triển khai

Không có phê duyệt tín dụng thật, CIC, scoring, processor/acquirer, PAN/CVV/PIN, real payment, lãi/phí thật hoặc production card control. UI phải ghi rõ `sandbox` khi có thể gây nhầm lẫn.

## Bằng chứng và gate còn lại

- [x] Chạy migration 001–004 trên PostgreSQL rỗng và live schema validator; 004 bổ sung policy unlock cho database đã áp dụng 003.
- [x] Kiểm thử restart/concurrency payment; chứng minh không debit hai lần và reconciliation difference bằng 0.
- [x] Chạy `seed:e2e`, lưu output không chứa secret; transfer và savings đều `SUCCEEDED`, Credit seed có card/statement; seed mode overdue đã tạo notification CREDIT trỏ đúng `cardId`.
- [x] Chạy Maestro overview/payment/pending-resume, card lock → stop/launch → OTP unlock và overdue notification → card detail trên Android emulator `Pixel_7_API_35`; artifact overview M0–M4/M8 (gồm hiện/sao chép đủ số tài khoản) là `C:\Users\admin\.maestro\tests\2026-08-16_014619`, card là `C:\Users\admin\.maestro\tests\2026-08-16_003018`, overdue là `C:\Users\admin\.maestro\tests\2026-08-16_004626`; thiết bị thật vẫn là gate mở.
- [x] Rerun regression M0–M4/M8 và cập nhật test report, device evidence và runbook theo bằng chứng local; checkpoint code hiện hành là `cab97e0`.
- [ ] Không đánh dấu production/pilot readiness khi chưa có staging, signing, monitoring, legal/compliance và partner approval.

## Cập nhật xác nhận cuối - 2026-08-16

- Backend PostgreSQL 16 local: 70/70 test, migration 001–005 và live schema validator đạt, critical HTTP 8/8.
- Mobile: typecheck, lint, 37 suite/170 test, OpenAPI 36 path, Maestro syntax 10 flow, web export 33 route và release config đều đạt.
- So tai khoan: danh sach chi tra so che; Home va Account Detail goi `GET /accounts/{accountId}/number` khi bam `Hien day du` hoac `Sao chep`, sau do hien/clipboard dung toan bo chuoi so.
- Maestro 2.8.0 va ADB da duoc dung tren `Pixel_7_API_35`: flow M0–M4/M8 tren APK hien tai, M6 savings, credit payment, credit pending → stop/launch → resume, Credit card lock → stop/launch → OTP unlock va Credit overdue notification → card detail deu pass. Thiet bi that, camera/biometric native va staging van mo.
- Backend dependency audit: 0 vulnerability. Mobile con 14 High transitive tu `image-size` trong Expo/Metro; khong ap dung `npm audit fix --force` vi no de xuat breaking downgrade Expo.
- Core M0–M4/M8 dùng relational reference adapter với state version/migration fallback; auth runtime và M6/M7 vẫn record-level reference. Repository production toàn domain, device lifecycle và staging/partner approval vẫn là gate mở.

## Hardening nghĩa vụ và recovery — 2026-08-24

- Payable obligation được neo vào latest statement của credit account. Statement cũ carry-forward chỉ để xem lịch sử; quote/submit trả `STATEMENT_SUPERSEDED` nếu user chọn kỳ cũ.
- Khi credit account còn payment `PENDING`, quote/submit mới bị chặn bằng `PAYMENT_PENDING`. Quote, submit và settlement cùng kiểm tra amount không vượt statement remaining hoặc account posted outstanding.
- Settlement fail closed nếu có thể tạo outstanding âm. Reconciliation kiểm tra `0 <= postedOutstanding <= creditLimit` và `availableCredit = creditLimit - postedOutstanding - pendingAuthorizations`; health degraded khi difference/invariant sai.
- Statement chỉ `OVERDUE` sau due date khi minimum payment còn thiếu. Đã trả đủ minimum nhưng chưa trả hết được giữ `PARTIALLY_PAID`. Success/reversal tính lại totals từ payment đã apply thay vì cộng/trừ mù.
- Mobile payment intent dùng `DRAFT_QUOTE`, `SUBMIT_UNKNOWN`, `ACCEPTED_PENDING`, `ACCEPTED_TERMINAL`; intent đã submit không bị xóa theo quote TTL, retry giữ cùng idempotency key và receipt terminal chỉ xóa khi user xác nhận/rời chủ đích.
- Payment intent được scope theo `userId + cardId`, có index scoped theo user để logout chỉ xóa đúng owner; legacy global migrate theo thứ tự ghi mới trước/xóa cũ sau. Unit test bao phủ lifecycle, migration, card/user isolation và clear scoped. PostgreSQL live concurrency/reversal và device/network-fault E2E còn phải chạy lại.
- SecureStore malformed/read failure của payment intent fail-closed và giữ nguyên record; UI không cho tạo payment mới khi chưa xác định an toàn kết quả lần trước.
- Public Credit GET đã chỉ đọc state; operator command settle payment `PENDING` trước khi tạo statement/carry-forward, và late reversal sau rollover bị đưa sang manual review. Durable idempotent worker cho statement close, overdue evaluation và payment settlement vẫn là target DRAFT còn mở; chưa production/pilot-ready.

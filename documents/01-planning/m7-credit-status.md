# M7 — Credit card sandbox status

Ngày cập nhật: 2026-08-15

## Phạm vi đã triển khai

- Một `CardInstrument` VND cấp sẵn cho mỗi user; limit `20.000.000`, posted outstanding seed `4.000.000`, pending authorization `0`, available `16.000.000`.
- Sao kê có cycle/close, due sau 15 ngày, minimum payment `max(statement × 5%, 100.000)`, fee `0`, timezone policy `Asia/Ho_Chi_Minh` ở mức sandbox.
- Backend API draft: `/cards`, lock/unlock, `/credit/accounts`, transactions, statements, payment quote, payment submit/status.
- Thanh toán có quote snapshot, statement version, MFA/step-up, idempotency, PENDING/FAILED/REVERSED, ledger double-entry, audit/outbox và reconciliation.
- Mobile có danh sách/chi tiết thẻ, giao dịch, sao kê, thanh toán MINIMUM/FULL/CUSTOM, SecureStore intent và resume sau timeout/restart. Không lưu OTP/PIN/CVV/PAN.

## Chính sách không triển khai

Không có phê duyệt tín dụng thật, CIC, scoring, processor/acquirer, PAN/CVV/PIN, real payment, lãi/phí thật hoặc production card control. UI phải ghi rõ `sandbox` khi có thể gây nhầm lẫn.

## Bằng chứng và gate còn lại

- [x] Chạy migration 001–003 trên PostgreSQL rỗng và live schema validator.
- [x] Kiểm thử restart/concurrency payment; chứng minh không debit hai lần và reconciliation difference bằng 0.
- [x] Chạy `seed:e2e`, lưu output không chứa secret; transfer và savings đều `SUCCEEDED`, Credit seed có card/statement.
- [x] Chạy Maestro overview/payment/pending-resume trên Android emulator `Pixel_7_API_35`; thiết bị thật vẫn là gate mở.
- [x] Rerun regression M0–M4/M8 và cập nhật test report, device evidence và runbook theo bằng chứng local; checkpoint Git là `aa0e3de`.
- [ ] Không đánh dấu production/pilot readiness khi chưa có staging, signing, monitoring, legal/compliance và partner approval.

## Cap nhat xac nhan cuoi - 2026-08-15

- Backend local khong co `DATABASE_URL`: 54 test, 50 pass va 4 skip PostgreSQL; voi PostgreSQL 16 tam thoi: 54/54 pass, migration 001–003 va live schema validator dat, critical HTTP 8/8.
- Mobile: typecheck, lint, 36 suite/166 test, OpenAPI 36 path, Maestro syntax 8 flow, web export 32 route va release config deu dat.
- So tai khoan: danh sach chi tra so che; Home va Account Detail goi `GET /accounts/{accountId}/number` khi bam `Hien day du` hoac `Sao chep`, sau do hien/clipboard dung toan bo chuoi so.
- Maestro 2.8.0 va ADB da duoc dung tren `Pixel_7_API_35`: flow M0–M4/M8, credit payment va credit pending → stop/launch → resume deu pass. Thiet bi that, camera/biometric native va staging van mo.
- Backend dependency audit: 0 vulnerability. Mobile con 14 High transitive tu `image-size` trong Expo/Metro; khong ap dung `npm audit fix --force` vi no de xuat breaking downgrade Expo.
- Persistent sandbox van dung snapshot adapter; repository relational production, seed E2E, device lifecycle va staging/partner approval van la gate mo.

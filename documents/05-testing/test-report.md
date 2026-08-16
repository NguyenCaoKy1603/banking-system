# Test report — Mobile banking reference preview

> Cập nhật hiện hành 2026-08-17: Mobile trên branch `codex/mini-core-banking-sandbox` đạt lint/typecheck, 36 suite/167 test, 9 Maestro flow syntax và web export 33 route. Backend hiện 65 test, 61 đạt/4 skip PostgreSQL. Artifact thiết bị trong báo cáo này thuộc snapshot trước branch và cần chạy lại cho clean registration, full account reveal/copy và credit activation.

Ngày lập: 2026-08-16
Phạm vi: M0–M4, M6–M8 và Card mock bonus
Trạng thái: **Local reference pass; Android emulator E2E pass; device/staging gates còn mở**
Backend verification checkpoint: code/evidence checkpoint `079e9d2`; implementation hardening `0f06b77`; historical backend gate `595afc3` remains referenced in the audit trail. The checkpoint includes the current M6/M7 and account-reveal evidence.

## Kết quả đã chạy

| Gate | Kết quả |
| --- | --- |
| Mobile lint | Đạt sau khi hoàn tất thay đổi hiện tại |
| Mobile typecheck | Đạt |
| Mobile unit tests | 36 suite, 167 test đạt |
| Mobile coverage | 95.58% statements, 93.11% branches, 97.95% functions, 95.58% lines |
| OpenAPI required paths | Đạt, 36 path bắt buộc |
| Native E2E | Android emulator `Pixel_7_API_35`: M0–M4, M6, M8 và Credit sandbox flow đạt; gồm hiện/sao chép đầy đủ số tài khoản, eKYC mô phỏng, beneficiary, QR manual fallback, savings quote/review/OTP và notification deep link |
| Maestro | 9 flow hợp lệ; M0–M4/M8, M6 savings, credit payment, pending-resume, Credit card lock/restart/unlock và Credit overdue notification chạy thành công trên Android emulator bằng Maestro 2.8.0 |
| Backend reference | 58 test definition; không có `DATABASE_URL`: 54 pass và 4 skip PostgreSQL; bằng chứng PostgreSQL 16 tạm: 58/58 pass; seed E2E smoke thành công |
| Expo web export | Đạt, 32 static route; dùng URL HTTPS placeholder cho static export vì `.env` local là HTTP sandbox và bị production guard từ chối |
| Dependency audit | **Không đạt**: 14 High từ `image-size`, chờ risk acceptance/upstream fix |

## Smoke seed

`backend/scripts/seed-e2e.ts` tạo user thử nghiệm, bật MFA sandbox theo biến môi trường, tạo beneficiary nếu thiếu, tạo một transfer reference và in ra các biến môi trường cần cho Maestro. Password/OTP chỉ truyền qua biến môi trường, không ghi vào source hoặc report.

## Chưa thể xác nhận tại workspace

- Chưa có thiết bị Android/iOS thật hoặc EAS CLI.
- Đã có APK release local, package/checksum và log Maestro trên emulator; chưa có video cold start/crash-resume, camera thật hoặc biometric prompt thật.
- Transfer kill app trước/sau submit và session restore sau force-stop chưa có kết quả native lặp lại; riêng credit pending → restart → resume đã pass bằng flow dedicated.
- Chưa có staging URL/partner integration đã phê duyệt.
- Handoff Git: implementation/evidence checkpoint `079e9d2` và hardening commit `0f06b77` đã commit toàn bộ source/workflow/contract/tài liệu trong phạm vi; clone sạch đã chạy `npm ci` và các gate chính. Chưa push/PR trong phiên này.
- Chưa có kết quả usability/accessibility với người dùng và chưa có approver cho 14 cảnh báo High.

## Kết luận

Các kiểm tra local cùng E2E emulator chứng minh reference implementation có thể cài/chạy trong một môi trường Android sandbox và contract boundary, nhưng không chứng minh sẵn sàng pilot. Bằng chứng Maestro mới của flow M0–M4/M8, M6 savings, credit payment, pending-resume, Credit card lock/restart/unlock và Credit overdue notification lần lượt được lưu tại `C:\Users\admin\.maestro\tests\2026-08-16_014619`, `C:\Users\admin\.maestro\tests\2026-08-16_013045`, `C:\Users\admin\.maestro\tests\2026-08-16_000436`, `C:\Users\admin\.maestro\tests\2026-08-16_000714`, `C:\Users\admin\.maestro\tests\2026-08-16_003018` và `C:\Users\admin\.maestro\tests\2026-08-16_004626`; M11 chỉ được đóng khi có device matrix trên thiết bị được duyệt, native lifecycle E2E đầy đủ, staging approval và quyết định dependency risk.

## Cap nhat xac nhan cuoi M6/M7 va account reveal - 2026-08-15

- Backend: local khong co `DATABASE_URL` co 58 test, 54 pass va 4 skip; voi PostgreSQL 16 tam thoi co 58/58 pass, migration 001–004, live schema validator va critical HTTP 8/8.
- Mobile: 36 suite/167 test pass; lint, typecheck, OpenAPI 36 path, 9 flow Maestro syntax, web export 32 route va release config deu dat.
- Credit sandbox da co seed card, sao ke, quote, MFA, idempotency, PENDING resume, ledger/reconciliation va lock/unlock step-up.
- `seed:e2e` da chay thanh cong tren server sandbox tam: transfer va savings `SUCCEEDED`, Credit card/statement duoc tao; stdout khong chua password/OTP.
- Account number: list API chi tra masked; `GET /accounts/{accountId}/number` tra full number; Home va Account Detail co nut Hien day du va Sao chep, clipboard nhan dung toan bo chuoi so.
- Backend dependency audit 0 vulnerability; Mobile con 14 High transitive tu `image-size` trong Expo/Metro. Khong ap dung `npm audit fix --force` vi no de xuat breaking downgrade Expo.
- Maestro/ADB da chay M7 tren `Pixel_7_API_35`: credit payment, pending → stop/launch → resume, card lock → stop/launch → OTP unlock va overdue notification → card detail deu pass; staging, partner integration va physical-device evidence van mo.
- Maestro/ADB da chay M6 savings tren APK release moi: quote/review → step-up OTP → mo khoan → danh sach tien gui pass; artifact `C:\Users\admin\.maestro\tests\2026-08-16_013045`.

# Test report — Mobile banking reference preview

Ngày lập: 2026-08-16
Phạm vi: M0–M4, M6–M8 và Card mock bonus
Trạng thái: **Local reference pass; Android emulator E2E pass; device/staging gates còn mở**
Backend verification checkpoint: current repository HEAD `a47b6a8`; implementation hardening `0f06b77`; historical backend gate `595afc3` remains referenced in the audit trail.

## Kết quả đã chạy

| Gate | Kết quả |
| --- | --- |
| Mobile lint | Đạt sau khi hoàn tất thay đổi hiện tại |
| Mobile typecheck | Đạt |
| Mobile unit tests | 36 suite, 166 test đạt |
| Mobile coverage | 95.58% statements, 93.11% branches, 97.95% functions, 95.58% lines |
| OpenAPI required paths | Đạt, 36 path bắt buộc |
| Native E2E | Android emulator `Pixel_7_API_35`: full flow M0–M4, M8 đạt, gồm hiện/sao chép đầy đủ số tài khoản, eKYC mô phỏng, beneficiary, QR manual fallback và notification deep link |
| Maestro | 8 flow hợp lệ; M0–M4/M8, credit payment và pending-resume chạy thành công trên Android emulator bằng Maestro 2.8.0 |
| Backend reference | 57 test definition; không có `DATABASE_URL`: 53 pass và 4 skip PostgreSQL; bằng chứng PostgreSQL 16 tạm: 57/57 pass; seed E2E smoke thành công |
| Expo web export | Đạt, 32 static route; dùng URL HTTPS placeholder cho static export vì `.env` local là HTTP sandbox và bị production guard từ chối |
| Dependency audit | **Không đạt**: 14 High từ `image-size`, chờ risk acceptance/upstream fix |

## Smoke seed

`backend/scripts/seed-e2e.ts` tạo user thử nghiệm, bật MFA sandbox theo biến môi trường, tạo beneficiary nếu thiếu, tạo một transfer reference và in ra các biến môi trường cần cho Maestro. Password/OTP chỉ truyền qua biến môi trường, không ghi vào source hoặc report.

## Chưa thể xác nhận tại workspace

- Chưa có thiết bị Android/iOS thật hoặc EAS CLI.
- Đã có APK release local, package/checksum và log Maestro trên emulator; chưa có video cold start/crash-resume, camera thật hoặc biometric prompt thật.
- Transfer kill app trước/sau submit và session restore sau force-stop chưa có kết quả native lặp lại; riêng credit pending → restart → resume đã pass bằng flow dedicated.
- Chưa có staging URL/partner integration đã phê duyệt.
- Handoff Git: implementation checkpoint `aa0e3de` và hardening commit `0f06b77` đã commit toàn bộ source/workflow/contract/tài liệu trong phạm vi; clone sạch đã chạy `npm ci` và các gate chính. Chưa push/PR trong phiên này.
- Chưa có kết quả usability/accessibility với người dùng và chưa có approver cho 14 cảnh báo High.

## Kết luận

Các kiểm tra local cùng E2E emulator chứng minh reference implementation có thể cài/chạy trong một môi trường Android sandbox và contract boundary, nhưng không chứng minh sẵn sàng pilot. Bằng chứng Maestro mới của flow M0–M4/M8, credit payment và pending-resume lần lượt được lưu tại `C:\Users\admin\.maestro\tests\2026-08-16_000105`, `C:\Users\admin\.maestro\tests\2026-08-16_000436` và `C:\Users\admin\.maestro\tests\2026-08-16_000714`; M11 chỉ được đóng khi có device matrix trên thiết bị được duyệt, native lifecycle E2E đầy đủ, staging approval và quyết định dependency risk.

## Cap nhat xac nhan cuoi M6/M7 va account reveal - 2026-08-15

- Backend: local khong co `DATABASE_URL` co 57 test, 53 pass va 4 skip; voi PostgreSQL 16 tam thoi co 57/57 pass, migration 001–004, live schema validator va critical HTTP 8/8.
- Mobile: 36 suite/166 test pass; lint, typecheck, OpenAPI 36 path, 8 flow Maestro syntax, web export 32 route va release config deu dat.
- Credit sandbox da co seed card, sao ke, quote, MFA, idempotency, PENDING resume, ledger/reconciliation va lock/unlock step-up.
- `seed:e2e` da chay thanh cong tren server sandbox tam: transfer va savings `SUCCEEDED`, Credit card/statement duoc tao; stdout khong chua password/OTP.
- Account number: list API chi tra masked; `GET /accounts/{accountId}/number` tra full number; Home va Account Detail co nut Hien day du va Sao chep, clipboard nhan dung toan bo chuoi so.
- Backend dependency audit 0 vulnerability; Mobile con 14 High transitive tu `image-size` trong Expo/Metro. Khong ap dung `npm audit fix --force` vi no de xuat breaking downgrade Expo.
- Maestro/ADB da chay M7 tren `Pixel_7_API_35`: credit payment va pending → stop/launch → resume deu pass; staging, partner integration va physical-device evidence van mo.

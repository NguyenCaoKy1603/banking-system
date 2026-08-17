# Test report — Mobile banking reference preview

> Cập nhật hiện hành 2026-08-17: Mobile trên branch `codex/mini-core-banking-sandbox` đạt lint/typecheck, 37 suite/170 test, coverage gate, 10 Maestro flow syntax và web export 33 route. Backend đạt 70/70 test với PostgreSQL, relational regression 1/1 trên database disposable và critical API 8/8. Bằng chứng emulator mới cho M0–M4/M8, transfer pending-resume và offline login retry đã được bổ sung bên dưới.

> Handoff manifest không chứa credential/token/OTP: [`handoff-manifest-2026-08-17.json`](handoff-manifest-2026-08-17.json).

Ngày lập: 2026-08-16
Phạm vi: M0–M4, M6–M8 và Card mock bonus
Trạng thái: **Local reference pass; Android emulator E2E pass; device/staging gates còn mở**
Backend verification checkpoint hiện hành: code `cd3e76e`; documentation/evidence emulator giữ theo các artifact đã ghi trong manifest; historical backend gate `595afc3` remains referenced in the audit trail. The checkpoint includes the current M6/M7, account-reveal and offline-retry evidence.

## Kết quả đã chạy

| Gate | Kết quả |
| --- | --- |
| Mobile lint | Đạt sau khi hoàn tất thay đổi hiện tại |
| Mobile typecheck | Đạt |
| Mobile unit tests | 37 suite, 170 test đạt |
| Mobile coverage | 84.09% statements, 85.52% branches, 91.95% functions, 85.04% lines |
| Offline/timeout presentation | Đạt mapping và retry unit test cho `NETWORK_ERROR`, `TIMEOUT`, `REQUEST_ABORTED`; Home/Account Detail/History/Login giữ nguyên lỗi API để hiển thị đúng loại lỗi, có retry notice; offline login retry đã pass trên emulator |
| OpenAPI required paths | Đạt, 36 path bắt buộc |
| Native E2E | Android emulator `Pixel_7_API_35`: M0–M4, M6, M8 và Credit sandbox flow đạt; gồm hiện/sao chép đầy đủ số tài khoản, eKYC mô phỏng, beneficiary, QR manual fallback, savings quote/review/OTP và notification deep link |
| Maestro | 10 flow hợp lệ; M0–M4/M8, M6 savings, credit payment, pending-resume, Credit card lock/restart/unlock, Credit overdue notification và offline login retry chạy thành công trên Android emulator bằng Maestro 2.8.0 |
| Backend reference | PostgreSQL 16 local: 70/70 test đạt, relational regression 1/1 trên database disposable, critical API 8/8, migration/validator đạt; seed E2E smoke thành công |
| Expo web export | Đạt, 33 static route; dùng URL HTTPS placeholder cho static export vì `.env` local là HTTP sandbox và bị production guard từ chối |
| Dependency audit | **Không đạt**: 14 High theo chuỗi Expo/Metro → `image-size@1.2.1`; npm chỉ đề xuất hạ major Expo/React Native không tương thích. Không force fix; chờ bản vá upstream và risk acceptance |

## Smoke seed

`backend/scripts/seed-e2e.ts` tạo user thử nghiệm, bật MFA sandbox theo biến môi trường, tạo beneficiary nếu thiếu, tạo một transfer reference và in ra các biến môi trường cần cho Maestro. Password/OTP chỉ truyền qua biến môi trường, không ghi vào source hoặc report.

## Chưa thể xác nhận tại workspace

- Chưa có thiết bị Android/iOS thật hoặc EAS CLI.
- Đã có APK release local, package/checksum và log Maestro trên emulator; chưa có video cold start/crash-resume, camera thật hoặc biometric prompt thật.
- Transfer kill app trước/sau submit và session restore sau force-stop chưa có kết quả native lặp lại; riêng credit pending → restart → resume đã pass bằng flow dedicated.
- Chưa có staging URL/partner integration đã phê duyệt.
- Handoff Git: code checkpoint hiện hành `cd3e76e`; source/workflow/contract/tài liệu cập nhật đang được chốt trong cùng handoff; clone sạch đã chạy `npm ci` và các gate chính. Chưa push/PR trong phiên này.
- Chưa có kết quả usability/accessibility với người dùng và chưa có approver cho 14 cảnh báo High.

## Kết luận

Các kiểm tra local cùng E2E emulator chứng minh reference implementation có thể cài/chạy trong một môi trường Android sandbox và contract boundary, nhưng không chứng minh sẵn sàng pilot. Bằng chứng Maestro mới của flow M0–M4/M8, M6 savings, credit payment, pending-resume, Credit card lock/restart/unlock và Credit overdue notification lần lượt được lưu tại `C:\Users\admin\.maestro\tests\2026-08-16_014619`, `C:\Users\admin\.maestro\tests\2026-08-16_013045`, `C:\Users\admin\.maestro\tests\2026-08-16_000436`, `C:\Users\admin\.maestro\tests\2026-08-16_000714`, `C:\Users\admin\.maestro\tests\2026-08-16_003018` và `C:\Users\admin\.maestro\tests\2026-08-16_004626`; M11 chỉ được đóng khi có device matrix trên thiết bị được duyệt, native lifecycle E2E đầy đủ, staging approval và quyết định dependency risk.

## Xác nhận hiện hành — 2026-08-17

- Clone sạch backend/mobile đã chạy `npm ci`; backend migration từ database rỗng, 70/70 test và Mobile typecheck/10 flow syntax đạt.
- M0–M4/M8 pass trên APK release hiện tại: `C:\Users\admin\.maestro\tests\2026-08-17_121849`.
- Transfer pending-resume pass sau force-stop/mở lại: `C:\Users\admin\.maestro\tests\2026-08-17_125314`.
- Offline login retry pass trên emulator với API URL cố ý không reachable; raw Maestro artifact đã xóa để không lưu password test vào command metadata.
- Mobile audit vẫn có 14 High transitive từ Expo/Metro; đây là risk mở, không tuyên bố production-ready.

## Cap nhat xac nhan cuoi M6/M7 va account reveal - 2026-08-15

- Backend: local không có database có 70 test, 64 pass và 6 skip; với PostgreSQL 16 tạm thời có 70/70 pass, migration 001–005, live schema validator và critical HTTP 8/8.
- Mobile: 37 suite/170 test pass; lint, typecheck, OpenAPI 36 path, 10 flow Maestro syntax, web export 33 route và release config đều đạt.
- Credit sandbox da co seed card, sao ke, quote, MFA, idempotency, PENDING resume, ledger/reconciliation va lock/unlock step-up.
- `seed:e2e` da chay thanh cong tren server sandbox tam: transfer va savings `SUCCEEDED`, Credit card/statement duoc tao; stdout khong chua password/OTP.
- Account number: list API chi tra masked; `GET /accounts/{accountId}/number` tra full number; Home va Account Detail co nut Hien day du va Sao chep, clipboard nhan dung toan bo chuoi so.
- Backend dependency audit 0 vulnerability; Mobile con 14 High transitive tu `image-size` trong Expo/Metro. Khong ap dung `npm audit fix --force` vi no de xuat breaking downgrade Expo.
- Maestro/ADB da chay M7 tren `Pixel_7_API_35`: credit payment, pending → stop/launch → resume, card lock → stop/launch → OTP unlock va overdue notification → card detail deu pass; staging, partner integration va physical-device evidence van mo.
- Maestro/ADB da chay M6 savings tren APK release moi: quote/review → step-up OTP → mo khoan → danh sach tien gui pass; artifact `C:\Users\admin\.maestro\tests\2026-08-16_013045`.

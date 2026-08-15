# Test report — Mobile banking reference preview

Ngày lập: 2026-08-15
Phạm vi: M0–M4, M8 và Card mock bonus
Trạng thái: **Local reference pass; device/release gates còn mở**
Backend verification checkpoint: `e555b77` (`Fix M8 notification transaction deep link`)

## Kết quả đã chạy

| Gate | Kết quả |
| --- | --- |
| Mobile lint | Đạt sau khi hoàn tất thay đổi hiện tại |
| Mobile typecheck | Đạt |
| Mobile unit tests | 27 suite, 143 test đạt |
| Mobile coverage | 95.45% statements, 93.35% branches, 97.87% functions, 95.45% lines |
| OpenAPI required paths | Đạt, 18 path bắt buộc |
| Native smoke | Android emulator `Pixel_7_API_35`: cold install/launch, login + MFA, account detail, M4 transfer và M8 notification deep link đạt; pending restart/resume chưa xác nhận |
| Maestro syntax | 5 flow hợp lệ; Maestro CLI chưa cài |
| Backend reference | 37 test definition (37 pass, gồm 2 PostgreSQL persistence tests), 8 critical HTTP flow; seed E2E smoke đã chạy thành công |
| Expo web export | Đạt, 22 static route |
| Dependency audit | **Không đạt**: 14 High từ `image-size`, chờ risk acceptance/upstream fix |

## Smoke seed

`backend/scripts/seed-e2e.ts` tạo user thử nghiệm, bật MFA sandbox theo biến môi trường, tạo beneficiary nếu thiếu, tạo một transfer reference và in ra các biến môi trường cần cho Maestro. Password/OTP chỉ truyền qua biến môi trường, không ghi vào source hoặc report.

## Chưa thể xác nhận tại workspace

- Chưa có thiết bị Android/iOS thật, Maestro CLI hoặc EAS CLI.
- Đã có APK debug preview, package/checksum và log smoke emulator; chưa có video cold start/crash-resume, camera thật hoặc biometric prompt thật.
- Kill app trước/sau submit, pending resume sau restart và session restore sau force-stop chưa có kết quả native lặp lại đáng tin cậy.
- Chưa có staging URL/partner integration đã phê duyệt.
- Chưa có kết quả usability/accessibility với người dùng và chưa có approver cho 14 cảnh báo High.

## Kết luận

Các kiểm tra local cùng smoke emulator chứng minh reference implementation có thể cài/chạy trong một môi trường Android sandbox và contract boundary, nhưng không chứng minh sẵn sàng pilot. M11 chỉ được đóng khi có APK release candidate, manifest/checksum, device matrix trên thiết bị được duyệt, native E2E evidence đầy đủ, staging approval và quyết định dependency risk.

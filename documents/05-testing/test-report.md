# Test report — Mobile banking reference preview

Ngày lập: 2026-08-15
Phạm vi: M0–M4, M8 và Card mock bonus
Trạng thái: **Local reference pass; device/release gates còn mở**

## Kết quả đã chạy

| Gate | Kết quả |
| --- | --- |
| Mobile lint | Đạt sau khi hoàn tất thay đổi hiện tại |
| Mobile typecheck | Đạt |
| Mobile unit tests | 27 suite, 143 test đạt |
| Mobile coverage | 95.45% statements, 93.35% branches, 97.87% functions, 95.45% lines |
| OpenAPI required paths | Đạt, 18 path bắt buộc |
| Maestro syntax | Đã có 5 flow hợp lệ; chưa chạy native |
| Backend reference | 37 test definition (37 pass, gồm 2 PostgreSQL persistence tests), 8 critical HTTP flow; seed E2E smoke đã chạy thành công |
| Expo web export | Đạt, 22 static route |
| Dependency audit | **Không đạt**: 14 High từ `image-size`, chờ risk acceptance/upstream fix |

## Smoke seed

`backend/scripts/seed-e2e.ts` tạo user thử nghiệm, bật MFA sandbox theo biến môi trường, tạo beneficiary nếu thiếu, tạo một transfer reference và in ra các biến môi trường cần cho Maestro. Password/OTP chỉ truyền qua biến môi trường, không ghi vào source hoặc report.

## Chưa thể xác nhận tại workspace

- Chưa có `adb`, Android emulator/thiết bị thật, Maestro CLI hoặc EAS CLI.
- Chưa có APK preview, checksum, video cold start/crash-resume, camera thật hoặc biometric prompt thật.
- Chưa có staging URL/partner integration đã phê duyệt.
- Chưa có kết quả usability/accessibility với người dùng và chưa có approver cho 14 cảnh báo High.

## Kết luận

Các kiểm tra local chứng minh reference implementation và contract boundary, không chứng minh ứng dụng đã cài/chạy trên thiết bị hoặc sẵn sàng pilot. M11 chỉ được đóng khi có APK, manifest/checksum, device matrix, native E2E evidence, staging approval và quyết định dependency risk.

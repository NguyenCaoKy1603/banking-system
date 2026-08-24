# Giai đoạn 2 — Mobile quality report

Ngày chạy: 2026-08-24  
Build ID: `stage2-20260824-df1f40b`  
Phạm vi: Expo web/static và unit/validator local; chưa phải APK/device certification.

## Gate local

| Gate | Kết quả |
| --- | --- |
| `npm run lint` | Đạt |
| `npm run typecheck` | Đạt |
| `npm test -- --runInBand` | Đạt — 46 suites, 260/260 tests |
| `npm run test:coverage -- --runInBand` | Đạt — statements 85.53%, branches 86.57%, funcs 93.39%, lines 85.97% |
| `npm run validate:openapi` | Đạt — 43 paths |
| `npm run validate:e2e` | Đạt — 10 flow syntax |
| `npm run validate:release` | Đạt — package `com.example.digitalbanking.mobile`, preview APK config |
| HTTPS `npm run export:web` | Đạt — 33 static routes |
| `npm audit --omit=dev --audit-level=high` | Đạt — 0 vulnerability |

Export production với `EXPO_PUBLIC_API_URL=http://...` bị chặn đúng bởi guard HTTPS; run được ghi nhận là negative safety check, không tính làm lỗi release. Run HTTPS ở trên mới là evidence export hợp lệ.

## Accessibility hardening cục bộ

Đã bổ sung `accessibilityRole` và `accessibilityState.selected/disabled` cho các lựa chọn mở khóa thẻ, nguồn thanh toán, phương thức thanh toán và dòng sao kê. Static scan sau patch ghi nhận `56` Pressable, không còn Pressable trực tiếp thiếu role; chi tiết ở [`stage2-accessibility-report.md`](stage2-accessibility-report.md).

Coverage là coverage logic/component tests hiện có; không tuyên bố toàn bộ screen/navigation đạt 85%.

## Còn thiếu

Chưa có APK checksum, Maestro CLI/device execution, TalkBack/large-font/camera/biometric/lifecycle evidence hoặc remote CI result.

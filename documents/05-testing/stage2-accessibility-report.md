# Giai đoạn 2 — Accessibility static report

Ngày chạy: 2026-08-24  
Build ID: `stage2-20260824-df1f40b`

## Static inventory

Quét source `mobile-app/src/**/*.tsx` sau accessibility patch:

| Chỉ dấu | Count |
| --- | ---: |
| `<Pressable` | 56 |
| `accessibilityRole=` | 57 |
| `accessibilityLabel=` | 33 |
| `accessibilityState=` | 14 |
| `accessibilityLiveRegion=` | 13 |
| `minHeight` 44–59 hoặc `hitSlop` | 27 |

Không còn Pressable trực tiếp thiếu `accessibilityRole` theo static heuristic. Các role/state mới tập trung vào control lựa chọn và trạng thái disabled/selected.

## Giới hạn của bằng chứng

Static scan không chứng minh được thứ tự focus, nhãn đọc tự nhiên, contrast, TalkBack announcement, font scale, keyboard traversal hay camera/biometric prompt. Những mục này phải chạy trên APK thật và ghi screen recording/log không chứa dữ liệu nhạy cảm.

## Retest bắt buộc

- Android TalkBack: login, home, transfer, savings, credit, fraud report, notification.
- Font scale lớn và landscape/compact viewport.
- Focus sau loading/error/retry và live-region sau transfer pending/failed.
- Touch target bằng accessibility inspector trên thiết bị thật.

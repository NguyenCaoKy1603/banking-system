# Giai đoạn 2 — Physical device/E2E evidence

Trạng thái ngày 2026-08-24: **Chưa thực hiện — blocker ngoài local workspace**.

## Chưa có artifact

- APK staging và checksum chưa được build/đính kèm.
- Không có Android device/emulator có Google APIs để chạy camera, biometric, TalkBack, background/resume và offline/timeout.
- Maestro CLI chưa cài trong workspace; validator mới chỉ kiểm tra cú pháp 10 flow.
- Chưa có HTTPS cloud staging hoặc remote CI run để đối chiếu build.

## Ma trận cần maintainer/device owner hoàn tất

| Thiết bị | Android | APK/checksum | TalkBack | Camera/QR | Biometric | Kill/resume/offline | Kết quả |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Android thấp nhất hỗ trợ | TBD | TBD | TBD | TBD | TBD | TBD | Chưa chạy |
| Android thiết bị phổ biến | TBD | TBD | TBD | TBD | TBD | TBD | Chưa chạy |
| Android màn hình nhỏ/font lớn | TBD | TBD | TBD | TBD | TBD | TBD | Chưa chạy |

Không đóng Stage 2 khi bảng này chưa có người thực hiện, timestamp, build checksum và evidence đã redaction.

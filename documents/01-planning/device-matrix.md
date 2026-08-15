# Device matrix và evidence gate

Snapshot: 2026-08-15.

| Nền tảng | Mục tiêu | Công cụ/evidence | Trạng thái local | Gate còn lại |
| --- | --- | --- | --- | --- |
| Android emulator | Preview build, login MFA, transfer retry/pending, KYC, beneficiary, QR, notification deep link, Card mock | ADB/UIAutomator smoke; Maestro + `APP_ID` + sandbox seed khi CLI sẵn sàng | Có `Pixel_7_API_35`; native smoke đạt login/MFA, account detail, M4 transfer và M8 notification deep link; Maestro CLI chưa cài | Chạy đủ flow, đặc biệt pending/restart/resume, trên preview build |
| Android thiết bị thật | Camera QR, biometric, lifecycle/background, network timeout | Maestro/device recording + build checksum | Chưa chạy | Chạy trên ít nhất một thiết bị được phê duyệt |
| iOS simulator/thiết bị thật | Native permission, biometric, lifecycle, deep link | Xcode/physical device evidence | Chưa có build/evidence | Chạy trên matrix iOS được phê duyệt |
| Staging partner | Auth/KYC/core balance/transfer/notification contract | URL, seed data, request/trace IDs, partner approval | Chưa được cấp | Có staging, owner, seed data và sign-off |

Các kiểm tra hiện có trong workspace chỉ chứng minh reference implementation: mobile lint/typecheck/unit test/coverage, OpenAPI/Maestro syntax, Expo config/web export, backend typecheck/build/test và database boundary validation. Không coi việc các kiểm tra local đạt là thay thế device E2E, staging, signing hoặc certification. Chi tiết kết quả và phần chưa chạy nằm tại [`documents/05-testing/test-report.md`](../05-testing/test-report.md).

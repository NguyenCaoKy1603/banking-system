# Device evidence — Android emulator smoke

> Cập nhật hiện hành 2026-08-17: phần evidence cũ bên dưới được giữ để truy vết; bằng chứng APK hiện tại cho M0–M4/M8 và transfer pending-resume nằm ở các artifact mới trong phần bổ sung cuối file.

Dùng bản ghi này cho smoke test local ngày 2026-08-16. Không ghi password, OTP, token, PIN, CVV hoặc dữ liệu tài chính nhạy cảm vào ảnh/video.

| Trường | Giá trị |
| --- | --- |
| Build version/package | `1.0.0` / `com.example.digitalbanking.mobile` (debug dev-client dùng cho E2E; release cũng đã build) |
| APK SHA-256 | Debug `9D61EE86309FB00713DE001992D3FDD076CD087C51C9624B448247118BC3E74A`; release `DAFC8332B08B1A4426585A504BD3DF771315CB9BB36289D9ABB6899C45B0EF48` (built after the savings keyboard-submit fix) |
| Device/emulator model | `Pixel_7_API_35` / `sdk_gphone64_x86_64` / `emulator-5554` |
| OS version | Android 15, API 35 |
| Build/install time | 2026-08-16 01:21 local time; release APK build/install completed successfully |
| API environment | Reference backend local; emulator release build dùng `EXPO_PUBLIC_SANDBOX_HTTP=1`, `EXPO_PUBLIC_API_URL=http://127.0.0.1:5000/api/v1` và `adb reverse tcp:5000 tcp:5000`; production vẫn bắt buộc HTTPS |
| Maestro version | 2.8.0; 9 flow files passed syntax validation; critical M0–M4/M8, M6 savings, credit payment, credit pending-resume, Credit card lock/restart/unlock và Credit overdue notification flow đã pass |
| Tester/reviewer | Codex local verification; human device reviewer pending |

## Required recordings/checks

- [x] Cold install and first launch; app launched successfully on the emulator.
- [x] Login + server-driven MFA; session restore after force-stop was not independently evidenced.
- [x] Dashboard, balance visibility, account detail with full account-number reveal/copy, notification list/read/detail and TRANSFER deep link to transaction detail.
- [x] M2 eKYC mock, beneficiary list and QR manual payload validation/fallback.
- [x] Transfer quote → review → step-up → result with immediate sandbox settlement.
- [x] Credit payment pending → stop app → launch app → mở lại payment detail → resume thành công; flow lưu tại `critical-credit-pending-resume.yaml`.
- [x] Transfer pending: quote → review → step-up → submit → stop app → launch app → refresh trạng thái `PENDING` trên emulator; idempotency/double-submit được kiểm chứng riêng ở critical API.
- [ ] QR camera permission/camera scanning, pending/restart/resume and manual fallback after a native lifecycle interruption.
- [ ] Real biometric prompt and negative/cancel path.
- [x] Credit sandbox card lock/unlock: khóa thẻ, stop/launch giữ trạng thái khóa và mở khóa bằng OTP sandbox trên emulator.
- [x] Credit overdue notification: seed statement quá hạn, mở notification CREDIT và deep-link tới đúng chi tiết thẻ trên emulator.
- [x] M6 savings: Home → Tiền gửi → quote/review → step-up OTP → mở khoản → danh sách tiền gửi trên emulator.
- [ ] Offline/timeout banner and retry behavior.

Evidence: Maestro run thành công tương ứng nằm tại `C:\Users\admin\.maestro\tests\2026-08-16_014619` (M0–M4/M8, kiểm tra đủ số tài khoản ở Home và Account Detail), `C:\Users\admin\.maestro\tests\2026-08-16_000436` (credit payment), `C:\Users\admin\.maestro\tests\2026-08-16_000714` (credit pending-resume), `C:\Users\admin\.maestro\tests\2026-08-16_003018` (Credit card lock → stop/launch → OTP unlock), `C:\Users\admin\.maestro\tests\2026-08-16_004626` (Credit overdue notification → card detail) và `C:\Users\admin\.maestro\tests\2026-08-16_013045` (M6 savings). No password or OTP is recorded in this report. Physical-device, camera/biometric and staging evidence remain open.

## Cập nhật xác nhận sau M7 và account reveal - 2026-08-16

- Flow M0–M4–M8 da chay lai tren APK release hien tai; test ID o Home va Account Detail da xac nhan hien/sao chep full number qua endpoint rieng, khong lay tu masked suffix. Artifact: `C:\Users\admin\.maestro\tests\2026-08-16_014619`.
- Maestro hien co 9 flow hop le; `critical-credit.yaml`, `critical-credit-pending-resume.yaml`, `critical-card.yaml` va `critical-credit-overdue-notification.yaml` da chay pass tren `Pixel_7_API_35`, trong do flow card da kiem tra khoa → restart → mo khoa bang OTP va flow overdue da kiem tra notification → deep-link ve card detail.
- `critical-savings.yaml` da chay pass tren APK release moi sau khi sua xu ly ban phim; artifact la `C:\Users\admin\.maestro\tests\2026-08-16_013045`.
- Ket qua M7 chi bao pham vi Android emulator sandbox. Physical device, camera, biometric va staging/partner integration van mo.

## Bổ sung evidence hiện hành — 2026-08-17

- APK release hiện tại đã chạy lại M0–M4/M8 trên Android emulator; artifact: `C:\Users\admin\.maestro\tests\2026-08-17_121849`.
- Transfer pending-resume đã pass với PostgreSQL persistent: tạo transfer `PENDING`, force-stop, mở lại và cập nhật trạng thái; artifact: `C:\Users\admin\.maestro\tests\2026-08-17_125314`.
- Không ghi password, OTP, token hoặc số tài khoản đầy đủ vào artifact/report. Thiết bị Android thật, QR camera native, biometric native và staging vẫn là gate mở.

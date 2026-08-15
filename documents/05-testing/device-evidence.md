# Device evidence — Android emulator smoke

Dùng bản ghi này cho smoke test local ngày 2026-08-16. Không ghi password, OTP, token, PIN, CVV hoặc dữ liệu tài chính nhạy cảm vào ảnh/video.

| Trường | Giá trị |
| --- | --- |
| Build version/package | `1.0.0` / `com.example.digitalbanking.mobile` (debug dev-client dùng cho E2E; release cũng đã build) |
| APK SHA-256 | Debug `9D61EE86309FB00713DE001992D3FDD076CD087C51C9624B448247118BC3E74A`; release `4A5F887BAB87A57F8F4CA00BBDE156CF638B2C06BA2E1E666572E7BC9F0C3F11` (built after state migration, unlock policy and payment review/error hardening) |
| Device/emulator model | `Pixel_7_API_35` / `sdk_gphone64_x86_64` / `emulator-5554` |
| OS version | Android 15, API 35 |
| Build/install time | 2026-08-15, local time; debug dev-client đã cài để chạy E2E, release APK build completed successfully |
| API environment | Reference backend local; emulator release build dùng `EXPO_PUBLIC_SANDBOX_HTTP=1`, `EXPO_PUBLIC_API_URL=http://127.0.0.1:5000/api/v1` và `adb reverse tcp:5000 tcp:5000`; production vẫn bắt buộc HTTPS |
| Maestro version | 2.8.0; 8 flow files passed syntax validation; critical M0–M4/M8, credit payment và credit pending-resume flow đã pass |
| Tester/reviewer | Codex local verification; human device reviewer pending |

## Required recordings/checks

- [x] Cold install and first launch; app launched successfully on the emulator.
- [x] Login + server-driven MFA; session restore after force-stop was not independently evidenced.
- [x] Dashboard, balance visibility, account detail with full account-number reveal/copy, notification list/read/detail and TRANSFER deep link to transaction detail.
- [x] M2 eKYC mock, beneficiary list and QR manual payload validation/fallback.
- [x] Transfer quote → review → step-up → result with immediate sandbox settlement.
- [x] Credit payment pending → stop app → launch app → mở lại payment detail → resume thành công; flow lưu tại `critical-credit-pending-resume.yaml`.
- [ ] Transfer double-tap/retry protection và kill app trước/sau submit cần bổ sung bằng chứng native riêng.
- [ ] QR camera permission/camera scanning, pending/restart/resume and manual fallback after a native lifecycle interruption.
- [ ] Real biometric prompt and negative/cancel path.
- [ ] Card mock lock/unlock, controlled visibility and simulated PIN validation on native device.
- [ ] Offline/timeout banner and retry behavior.

Evidence: Maestro run thành công tương ứng nằm tại `C:\Users\admin\.maestro\tests\2026-08-16_000105` (M0–M4/M8, kiểm tra đủ số tài khoản ở Home và Account Detail), `C:\Users\admin\.maestro\tests\2026-08-16_000436` (credit payment) và `C:\Users\admin\.maestro\tests\2026-08-16_000714` (credit pending-resume). No password or OTP is recorded in this report. Physical-device, camera/biometric and staging evidence remain open.

## Cập nhật xác nhận sau M7 và account reveal - 2026-08-16

- Flow M0–M4–M8 da co them test ID cho nut hien/sao chep so tai khoan tren Home; endpoint rieng tra full number, khong lay tu masked suffix.
- Maestro hien co 8 flow hop le; `critical-credit.yaml` va `critical-credit-pending-resume.yaml` da chay pass tren `Pixel_7_API_35`.
- Ket qua M7 chi bao pham vi Android emulator sandbox. Physical device, camera, biometric va staging/partner integration van mo.

# Device evidence — Android emulator smoke

> Cập nhật hiện hành 2026-08-17: phần evidence cũ bên dưới được giữ để truy vết; bằng chứng APK hiện tại cho M0–M4/M8 và transfer pending-resume nằm ở các artifact mới trong phần bổ sung cuối file.

Dùng bản ghi này cho smoke test local ngày 2026-08-16. Không ghi password, OTP, token, PIN, CVV hoặc dữ liệu tài chính nhạy cảm vào ảnh/video.

| Trường | Giá trị |
| --- | --- |
| Build version/package | `1.0.0` / `com.example.digitalbanking.mobile` (debug dev-client dùng cho E2E; release cũng đã build) |
| APK SHA-256 | Release `8ADAEEDD4A21D310A1CDA0A79B75515785A6683792CD5FF26583F2B65D808F7A` (bản chuẩn vừa build/cài trên emulator) |
| Device/emulator model | `Pixel_7_API_35` / `sdk_gphone64_x86_64` / `emulator-5554` |
| OS version | Android 15, API 35 |
| Build/install time | 2026-08-17 local time; release APK force-rebuild/install/launch completed successfully |
| API environment | Reference backend local; emulator release build dùng `EXPO_PUBLIC_SANDBOX_HTTP=1`, `EXPO_PUBLIC_API_URL=http://127.0.0.1:5000/api/v1` và `adb reverse tcp:5000 tcp:5000`; production vẫn bắt buộc HTTPS |
| Maestro version | 2.8.0; 10 flow files passed syntax validation; critical M0–M4/M8, M6 savings, credit payment, credit pending-resume, Credit card lock/restart/unlock, Credit overdue notification và offline login retry flow đã pass |
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
- [x] Offline banner and retry behavior: `critical-offline-retry.yaml` đã chạy pass trên emulator với API URL cố ý không reachable; artifact raw đã xóa vì command metadata chứa dữ liệu test nhạy cảm, report chỉ giữ kết quả không chứa secret.

Evidence: Maestro run thành công tương ứng nằm tại `C:\Users\admin\.maestro\tests\2026-08-16_014619` (M0–M4/M8, kiểm tra đủ số tài khoản ở Home và Account Detail), `C:\Users\admin\.maestro\tests\2026-08-16_000436` (credit payment), `C:\Users\admin\.maestro\tests\2026-08-16_000714` (credit pending-resume), `C:\Users\admin\.maestro\tests\2026-08-16_003018` (Credit card lock → stop/launch → OTP unlock), `C:\Users\admin\.maestro\tests\2026-08-16_004626` (Credit overdue notification → card detail) và `C:\Users\admin\.maestro\tests\2026-08-16_013045` (M6 savings). No password or OTP is recorded in this report. Physical-device, camera/biometric and staging evidence remain open.

## Cập nhật xác nhận sau M7 và account reveal - 2026-08-16

- Flow M0–M4–M8 da chay lai tren APK release hien tai; test ID o Home va Account Detail da xac nhan hien/sao chep full number qua endpoint rieng, khong lay tu masked suffix. Artifact: `C:\Users\admin\.maestro\tests\2026-08-16_014619`.
- Maestro hiện có 10 flow hợp lệ; `critical-credit.yaml`, `critical-credit-pending-resume.yaml`, `critical-card.yaml`, `critical-credit-overdue-notification.yaml` và `critical-offline-retry.yaml` đã chạy pass trên `Pixel_7_API_35`, trong đó flow offline kiểm tra banner mất kết nối và retry.
- `critical-savings.yaml` da chay pass tren APK release moi sau khi sua xu ly ban phim; artifact la `C:\Users\admin\.maestro\tests\2026-08-16_013045`.
- Ket qua M7 chi bao pham vi Android emulator sandbox. Physical device, camera, biometric va staging/partner integration van mo.

## Bổ sung evidence hiện hành — 2026-08-17

- APK release hiện tại đã chạy lại M0–M4/M8 trên Android emulator; artifact: `C:\Users\admin\.maestro\tests\2026-08-17_121849`.
- Transfer pending-resume đã pass với PostgreSQL persistent: tạo transfer `PENDING`, force-stop, mở lại và cập nhật trạng thái; artifact: `C:\Users\admin\.maestro\tests\2026-08-17_125314`.
- Không ghi password, OTP, token hoặc số tài khoản đầy đủ vào artifact/report. Thiết bị Android thật, QR camera native, biometric native và staging vẫn là gate mở.
- Mobile đã có trạng thái hiển thị riêng cho mất kết nối, timeout và yêu cầu bị hủy, kèm nút thử lại; unit test đã kiểm tra mapping này. Kiểm thử các trạng thái đó khi tắt mạng trên thiết bị thật vẫn chưa chạy.
- APK release sau thay đổi UI đã được force-rebuild với cấu hình sandbox HTTP, cài lại và mở thành công trên emulator; tiến trình app còn sống và logcat không có chữ ký crash.
- Bản APK hiện hành đã bao gồm retry notice cho lỗi mất mạng/timeout khi tải tài khoản, lịch sử và khi hiện/sao chép số tài khoản; force-stop/launch sau cài đặt vẫn giữ app chạy, logcat không có chữ ký crash.
- Màn hình đăng nhập cũng giữ banner lỗi trong lúc retry, khóa nút retry khi request đang chạy và hiển thị lại trạng thái mất kết nối khi retry thất bại.

## Preflight trước mỗi lần chạy thiết bị

Từ thư mục `mobile-app`, chạy `npm run device:preflight`. Lệnh này kiểm tra ADB, thiết bị đang ở trạng thái `device`, package app, backend `/healthz` và khả năng phát hiện Maestro. Kết quả chỉ gồm thông tin chẩn đoán không nhạy cảm; không in password, OTP, token, PIN hoặc số tài khoản.

- Chạy local với emulator hoặc thiết bị Android đã kết nối: `npm run device:preflight`.
- Đóng gate thiết bị thật: `npm run device:preflight -- --require-physical`.
- Nếu chỉ có emulator, kết quả local có thể đạt nhưng lệnh `--require-physical` cố ý trả lỗi để không nhầm bằng chứng emulator với thiết bị thật.
- Kết quả preflight đã lưu tại [`device-preflight-2026-08-17.json`](device-preflight-2026-08-17.json).

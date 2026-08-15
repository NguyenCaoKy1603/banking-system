# Device evidence — Android emulator smoke

Dùng bản ghi này cho smoke test local ngày 2026-08-15. Không ghi password, OTP, token, PIN, CVV hoặc dữ liệu tài chính nhạy cảm vào ảnh/video.

| Trường | Giá trị |
| --- | --- |
| Build version/package | `1.0.0` / `com.example.digitalbanking.mobile` |
| APK SHA-256 | `7670524688D3D05FBF663D17F3C108324925F954D94B65EC692E4FA391BCFBDB` |
| Device/emulator model | `Pixel_7_API_35` / `sdk_gphone64_x86_64` / `emulator-5554` |
| OS version | Android 15, API 35 |
| Install time | 2026-08-15, local time; APK build timestamp 09:05:04 (+07) |
| API environment | Reference backend local, `http://10.0.2.2:5000/api/v1`, sandbox MFA/OTP only |
| Maestro version | Not installed; 5 flow files passed syntax validation |
| Tester/reviewer | Codex local verification; human device reviewer pending |

## Required recordings/checks

- [x] Cold install and first launch; app launched successfully on the emulator.
- [x] Login + server-driven MFA; session restore after force-stop was not independently evidenced.
- [x] Dashboard, account detail, notification list/read/detail and TRANSFER deep link to transaction detail; history screen was not separately recorded.
- [x] Transfer quote → review → step-up → result with immediate sandbox settlement.
- [ ] Double tap/retry protection and kill app before/after submit with pending resume; native replay was not repeatable in this run.
- [ ] KYC mock, beneficiary, QR camera permission and manual fallback on native device.
- [ ] Real biometric prompt and negative/cancel path.
- [ ] Card mock lock/unlock, controlled visibility and simulated PIN validation on native device.
- [ ] Offline/timeout banner and retry behavior.

Evidence: manual ADB/UIAutomator checkpoints from the local emulator on 2026-08-15; no screenshot/video was committed. Native smoke initially exposed an invalid M8 transaction link; the subsequent build fixed the notification target contract and opened the transaction detail successfully. No password or OTP is recorded in this report.

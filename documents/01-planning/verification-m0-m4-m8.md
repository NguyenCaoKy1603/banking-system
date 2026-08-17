# Verification report M0–M4 và M8

> Cập nhật hiện hành 2026-08-17: phần bằng chứng M0–M4/M8 đã được chạy lại trên APK release hiện tại; transfer pending-resume có artifact riêng. Các checkpoint cũ bên dưới được giữ để truy vết. Bảng trạng thái canonical nằm tại [`mini-core-sandbox-status.md`](mini-core-sandbox-status.md).

Ngày kiểm tra: 2026-08-16
Evidence checkpoint: `079e9d2` (`Verify M6 M7 native flows and account reveal`); implementation hardening `0f06b77`; earlier implementation baseline `aa0e3de`.

## Phạm vi đã đối chiếu

| Milestone | Kết quả trong workspace |
| --- | --- |
| M0 | AGENTS, repository map, backlog, decision log, risk register, milestone status, device matrix, API/design/testing/release index và evidence rules đã có. |
| M1 | Expo/React Native foundation, route guard, SecureStore session, device binding, refresh rotation, MFA, HTTP client, lint/typecheck/test/build/export đã có. |
| M2 | Auth flow và eKYC mô phỏng có form, document mẫu và trạng thái DRAFT/PENDING/APPROVED/REJECTED. |
| M3 | Dashboard/account detail, cursor history, transaction detail và filter status/direction trên dữ liệu đã tải. |
| M4 | Transfer quote/review/step-up/idempotency/pending recovery; beneficiary list/create/rename/delete; QR My QR, camera scanner, payload validation và manual fallback. |
| M8 | Notification list/read, notification detail và deep link theo loại TRANSFER/SECURITY tới transaction detail/profile. |

## Bằng chứng local

- Mobile: lint, typecheck, 36 test suites/167 tests, OpenAPI 36 required paths, Maestro syntax 9 flows và web export 32 routes đều đạt.
- Backend reference: typecheck, build, database boundary validation source + live PostgreSQL, 68/68 test với PostgreSQL và 8 critical HTTP tests; correctness P1/P2, beneficiary fingerprint, quote one-time, reconciliation drift, exact route, async HTTP auth, persistent body validation và outbox retry đều có regression test.
- Full critical flow đã chạy lại trên Android emulator `Pixel_7_API_35` (Android 15/API 35) bằng Maestro 2.8.0: cold launch, login + server-driven MFA, dashboard, hiện/che số dư, account detail với hiện và sao chép số tài khoản đầy đủ, M2 eKYC, M4 beneficiary và QR manual fallback, M8 notification detail → transaction/profile deep link. Bằng chứng bản APK hiện tại: `C:\Users\admin\.maestro\tests\2026-08-16_014619`.
- Credit pending → stop/launch → resume, Credit card lock → stop/launch → OTP unlock và Credit overdue notification → card detail đã có bằng chứng native trên emulator; chưa có bằng chứng lặp lại cho transfer kill app trước/sau submit, session restore sau force-stop, QR camera permission/biometric thật, thiết bị thật hoặc staging partner. Đây vẫn là gate bắt buộc trước preview/pilot.
- Seed E2E sandbox đã có tại `backend/scripts/seed-e2e.ts`; lần smoke local đã tạo dữ liệu tester/beneficiary/transfer mà không ghi credential vào source.
- Card mock bonus đã có list/detail, lock/unlock, controlled visibility và simulated PIN change; không coi là card integration thật.

## Giới hạn cần giữ nguyên

- eKYC và QR hiện là mock/reference, chưa phải tích hợp KYC/QR provider thật.
- `backend/` có in-memory reference và persistent PostgreSQL snapshot sandbox; migration, restart và concurrent HTTP persistence đã đạt local với PostgreSQL 16; chưa phải NestJS/PostgreSQL production backend.
- `npm audit --omit=dev --audit-level=high` vẫn fail với 14 High trong dependency Metro/`image-size`; không chạy `npm audit fix --force` vì có thể gây breaking change Expo/React Native.
- Chưa có staging core/partner, signing/APK release candidate, device matrix evidence hoặc legal/compliance sign-off.
- `mobile-app/app.json` và `eas.json` đã có package/profile preview APK. APK release local `1.0.0` đã build thành công; checksum và checklist chi tiết nằm tại [`documents/05-testing/device-evidence.md`](../05-testing/device-evidence.md). Chưa có signing/phê duyệt release candidate hoặc cài đặt trên thiết bị thật.

## Bổ sung kiểm thử transfer pending trên emulator — 2026-08-17

- Với backend PostgreSQL persistent và settle immediate tắt cho snapshot E2E, flow đã tạo transfer `PENDING`, force-stop ứng dụng, mở lại và cập nhật trạng thái thành công.
- Artifact: `C:\Users\admin\.maestro\tests\2026-08-17_125314`.
- Flow được thực thi bằng Maestro 2.8.0 trên `emulator-5554`; biến môi trường được truyền qua tham số Maestro, không ghi credential vào file flow.
- Đây là bằng chứng bổ sung cho M4 lifecycle; chưa phải bằng chứng thiết bị vật lý hoặc tích hợp core/payment thật.

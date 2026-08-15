# Verification report M0–M4 và M8

Ngày kiểm tra: 2026-08-15
Backend evidence checkpoint: `e555b77` (`Fix M8 notification transaction deep link`)

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

- Mobile: lint, typecheck, 27 test suites/143 tests, coverage 95.45% statements và 93.35% branches, OpenAPI 18 required paths, Maestro syntax 5 flows và web export 22 routes đều đạt.
- Backend reference: typecheck, build, database boundary validation, 37 test definition (37 pass, gồm 2 PostgreSQL persistence tests) và 8 critical HTTP tests; correctness P1/P2, beneficiary fingerprint, quote one-time, reconciliation drift, exact route, async HTTP auth và outbox retry đều có regression test.
- Native smoke đã chạy trên Android emulator `Pixel_7_API_35` (Android 15/API 35): cold install/launch, login + server-driven MFA, dashboard/account detail, M4 transfer quote → review → step-up → result và M8 notification detail → transaction deep link đều đã kiểm tra được. Lần chạy đầu phát hiện deep link dùng sai `transferId`; bản vá contract dùng `transactionId` kèm `accountId` và lần chạy lại đã mở đúng transaction detail. Maestro CLI chưa cài; 5 flow chỉ mới qua syntax validation.
- Chưa có bằng chứng native lặp lại cho kill app trước/sau submit, pending resume sau restart, session restore sau force-stop, QR camera/biometric thật, thiết bị thật hoặc staging partner. Đây vẫn là gate bắt buộc trước preview/pilot.
- Seed E2E sandbox đã có tại `backend/scripts/seed-e2e.ts`; lần smoke local đã tạo dữ liệu tester/beneficiary/transfer mà không ghi credential vào source.
- Card mock bonus đã có list/detail, lock/unlock, controlled visibility và simulated PIN change; không coi là card integration thật.

## Giới hạn cần giữ nguyên

- eKYC và QR hiện là mock/reference, chưa phải tích hợp KYC/QR provider thật.
- `backend/` có in-memory reference và persistent PostgreSQL snapshot sandbox; migration, restart và concurrent HTTP persistence đã đạt local với PostgreSQL 16; chưa phải NestJS/PostgreSQL production backend.
- `npm audit --omit=dev --audit-level=high` vẫn fail với 14 High trong dependency Metro/`image-size`; không chạy `npm audit fix --force` vì có thể gây breaking change Expo/React Native.
- Chưa có staging core/partner, signing/APK release candidate, device matrix evidence hoặc legal/compliance sign-off.
- `mobile-app/app.json` và `eas.json` đã có package/profile preview APK. APK debug local `1.0.0` đã cài trên emulator; checksum và checklist chi tiết nằm tại [`documents/05-testing/device-evidence.md`](../05-testing/device-evidence.md). Chưa có release candidate, signing hoặc cài đặt trên thiết bị thật.

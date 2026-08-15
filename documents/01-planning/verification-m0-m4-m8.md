# Verification report M0–M4 và M8

Ngày kiểm tra: 2026-08-15

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
- E2E native trên thiết bị/emulator chưa chạy vì workspace chưa có `adb`, emulator và Maestro CLI. Đây là gate bắt buộc trước preview/pilot.
- Seed E2E sandbox đã có tại `backend/scripts/seed-e2e.ts`; lần smoke local đã tạo dữ liệu tester/beneficiary/transfer mà không ghi credential vào source.
- Card mock bonus đã có list/detail, lock/unlock, controlled visibility và simulated PIN change; không coi là card integration thật.

## Giới hạn cần giữ nguyên

- eKYC và QR hiện là mock/reference, chưa phải tích hợp KYC/QR provider thật.
- `backend/` có in-memory reference và persistent PostgreSQL snapshot sandbox; migration, restart và concurrent HTTP persistence đã đạt local với PostgreSQL 16; chưa phải NestJS/PostgreSQL production backend.
- `npm audit --omit=dev --audit-level=high` vẫn fail với 14 High trong dependency Metro/`image-size`; không chạy `npm audit fix --force` vì có thể gây breaking change Expo/React Native.
- Chưa có staging core/partner, signing/APK release candidate, device matrix evidence hoặc legal/compliance sign-off.
- `mobile-app/app.json` và `eas.json` đã có package/profile preview APK; APK, checksum và cài đặt trên máy khác vẫn chưa có.

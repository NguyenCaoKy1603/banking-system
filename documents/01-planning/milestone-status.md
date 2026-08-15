# Milestone status snapshot — 2026-08-15

## Đã kiểm chứng local

Backend evidence checkpoint: `595afc3` (`Harden database and OpenAPI quality gates`).

- Mobile lint, type-check và 27 suite/143 test đạt; coverage đạt 95.45% statements/lines, 93.35% branches và 97.87% functions trên nhóm domain/validation/presentation/storage/navigation được thu thập; coverage gate tối thiểu là 80% statements/lines, 75% branches và 80% functions.
- Backend reference type-check, build, 37 test definition (37 pass, gồm 2 PostgreSQL persistence tests) và 8 critical HTTP flow đạt; database boundary validator đạt cấu trúc SQL + live PostgreSQL 16 bảng/invariant.
- Backend correctness đã có quote snapshot/one-time, beneficiary fingerprint, UUID-compatible IDs, exact route, registration/step-up rate limit, reconciliation formula và outbox retry threshold.
- Persistent PostgreSQL snapshot adapter, migration runner và CI service đã được thêm; integration test chỉ chạy khi có `DATABASE_URL`.
- OpenAPI validation, Maestro syntax validation, Expo native config và web export đều đã chạy lại sau route Card; hiện có 5 flow Maestro hợp lệ và 22 static route.
- Auth/session/device binding/MFA, accounts/history/detail/filter, transfer quote/step-up/idempotency/pending recovery, notifications và fraud report có reference flow.
- M2 có eKYC mô phỏng với form, ảnh mẫu và vòng đời DRAFT/PENDING/APPROVED/REJECTED.
- M4 có transfer flow, danh bạ người nhận CRUD, QR payload validation, camera scanner và manual input fallback.
- M8 có notification list/read, notification detail và deep link tới transaction detail hoặc profile.
- M5 có Card mock/reference: list/detail, lock/unlock, ẩn/hiện số mô phỏng và đổi PIN mô phỏng; không lưu PIN/CVV thật.
- Có seed sandbox tự động cho E2E và report release/device nêu rõ các gate chưa thể chạy tại workspace.

## Chưa đủ điều kiện đóng milestone

- M0: baseline tài liệu, evidence rules, device evidence và hai commit checkpoint đã có; working tree vẫn còn các thay đổi Mobile có sẵn chưa thuộc phạm vi commit này nên chưa thể coi là clean checkpoint của toàn workspace.
- M1–M4 và M8: đã có native smoke trên Android emulator cho login/MFA, account detail, M4 transfer và M8 notification deep link; chưa có full device matrix, thiết bị thật hoặc staging partner.
- M2: eKYC thật/API KYC và test data staging chưa có; phần hiện tại là mock có chủ đích.
- M4: transfer smoke trên emulator đã đạt; QR camera/permission, beneficiary CRUD đầy đủ và fallback native vẫn chưa có bằng chứng thiết bị.
- M6, M7 và M9: chưa triển khai theo ưu tiên hiện tại; M5 chỉ là mock bonus, chưa phải API/production card integration.
- M10: usability, accessibility, performance và native device regression chưa hoàn tất; audit Mobile còn 14 High; remote CI execution chưa có log trong workspace dù local PostgreSQL gate đã đạt.
- M11: mới có APK debug preview cài trên Android emulator và checksum local; chưa có APK release candidate cài ngoài máy phát triển, signing, staging, monitoring và hồ sơ bảo vệ đầy đủ.

## Quyết định sử dụng snapshot

Các kết quả local là bằng chứng cho reference implementation, không phải chứng nhận production/pilot. Mọi trạng thái `HOÀN THÀNH` trong kế hoạch phải kèm test report, thiết bị, evidence và người review.

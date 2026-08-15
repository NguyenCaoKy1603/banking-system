# Milestone status snapshot — 2026-08-15

## Đã kiểm chứng local

Backend evidence checkpoint: `595afc3` (`Harden database and OpenAPI quality gates`).

- Mobile lint, type-check và 36 suite/166 test đạt; các coverage gate trước đó vẫn đạt trên nhóm domain/validation/presentation/storage/navigation; coverage không được chạy lại trong lượt cuối.
- Backend reference type-check, build, 53 test definition và 8 critical HTTP flow đạt; không có database thật thì 4 test PostgreSQL được skip, còn bằng chứng PostgreSQL 16 tạm thời đạt 53/53; database boundary validator đạt cấu trúc SQL + live PostgreSQL 27 bảng/invariant.
- Backend correctness đã có quote snapshot/one-time, beneficiary fingerprint, UUID-compatible IDs, exact route, registration/step-up rate limit, reconciliation formula và outbox retry threshold.
- Persistent PostgreSQL snapshot adapter, migration runner và CI service đã được thêm; integration test chỉ chạy khi có `DATABASE_URL`.
- OpenAPI validation, Maestro syntax validation, Expo native config và web export đều đã chạy lại sau các route hiện tại; hiện có 36 path OpenAPI, 8 flow Maestro hợp lệ và 32 static route. Critical flow M0–M4/M8, credit payment và credit pending-resume đã chạy thành công trên Android emulator.
- Auth/session/device binding/MFA, accounts/history/detail/filter, transfer quote/step-up/idempotency/pending recovery, notifications và fraud report có reference flow.
- M2 có eKYC mô phỏng với form, ảnh mẫu và vòng đời DRAFT/PENDING/APPROVED/REJECTED.
- M4 có transfer flow, danh bạ người nhận CRUD, QR payload validation, camera scanner và manual input fallback.
- M8 có notification list/read, notification detail và deep link tới transaction detail hoặc profile.
- M5 có Card mock/reference: list/detail, lock/unlock, ẩn/hiện số mô phỏng và đổi PIN mô phỏng; không lưu PIN/CVV thật.
- Có seed sandbox tự động cho E2E và report release/device nêu rõ các gate chưa thể chạy tại workspace.

## Chưa đủ điều kiện đóng milestone

- M0: baseline tài liệu, evidence rules, device evidence và checkpoint Git sạch `aa0e3de` đã có; owner review/push vẫn còn.
- M1–M4 và M8: critical flow đã chạy trên Android emulator cho login/MFA, account detail, hiện/sao chép số tài khoản đầy đủ, eKYC, beneficiary, QR manual fallback, M4 transfer và M8 notification deep link; chưa có full device matrix, thiết bị thật hoặc staging partner.
- M2: eKYC thật/API KYC và test data staging chưa có; phần hiện tại là mock có chủ đích.
- M4: transfer, beneficiary CRUD và QR manual fallback đã có bằng chứng Maestro trên emulator; QR camera/permission, transfer pending/restart/resume và lifecycle native vẫn chưa có bằng chứng thiết bị.
- M6 và M7: đã có reference sandbox; M7 payment pending → stop/launch → resume đã có flow pass trên emulator. M5 vẫn là mock/fixture, chưa phải API/production card integration; M9 chưa triển khai.
- M10: usability, accessibility, performance và native device regression chưa hoàn tất; audit Mobile còn 14 High; remote CI execution chưa có log trong workspace dù local PostgreSQL gate đã đạt.
- M11: đã build APK release local và lưu checksum/evidence; chưa có signing, cài đặt ngoài máy phát triển, staging, monitoring và hồ sơ bảo vệ đầy đủ.

## Quyết định sử dụng snapshot

Các kết quả local là bằng chứng cho reference implementation, không phải chứng nhận production/pilot. Mọi trạng thái `HOÀN THÀNH` trong kế hoạch phải kèm test report, thiết bị, evidence và người review.
## Cập nhật sau đồng bộ M6 và triển khai M7 — 2026-08-15

- M6 Savings đã có quote/MFA/idempotency/PENDING-resume/maturity, Mobile list/open/detail và notification deep link; chưa đóng vì thiếu Maestro CLI trên thiết bị thật và repository relational.
- M7 Credit sandbox đã bắt đầu: thẻ VND cấp sẵn, hạn mức 20.000.000, dư nợ seed 4.000.000, khả dụng 16.000.000, sao kê và thanh toán MINIMUM/FULL/CUSTOM. Không có CIC, processor, PAN/CVV/PIN hoặc tiền thật.
- OpenAPI draft hiện có 36 path; backend route/schema validator đã bao phủ Cards/Credit. Mobile `/cards` đã chuyển khỏi `cardsMock` sang API Credit draft.
- Migration `003_credit_sandbox.sql` và policy fields đã có ở mức draft; live Postgres/Maestro/device evidence M7 phải chạy lại sau checkpoint sạch.

## Cap nhat chinh xac sau M7 local verification - 2026-08-15

- M6 Savings va M7 Credit da co reference sandbox implementation; cac dong mo ta cu "chua trien khai" chi la snapshot truoc khi thuc hien.
- M7 local gate hien tai: Backend 53 test definition (49 pass, 4 PostgreSQL skip; PostgreSQL 16 tam 53/53), Mobile 166/166, OpenAPI 36 path, Maestro syntax 8 flow.
- Home/account detail da cho phep hien va sao chep day du so tai khoan qua API rieng; mat tren Home van chi hien/che so du.
- Chua dong milestone: relational repository production, transfer lifecycle native day du, physical device, staging/partner integration va production controls. PostgreSQL live, concurrency/restart sandbox va Maestro M7 emulator da co evidence.

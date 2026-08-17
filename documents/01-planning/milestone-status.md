# Milestone status snapshot — 2026-08-17

## Đã kiểm chứng local

Backend evidence checkpoint hiện hành: code checkpoint `dd515ad`; historical gate `595afc3` (`Harden database and OpenAPI quality gates`).

- Mobile lint, type-check và 37 suite/170 test đạt; coverage gate đã được chạy lại sau khi bổ sung trạng thái offline/timeout.
- Backend reference type-check, build, 70/70 test và 8 critical HTTP flow đạt; relational regression 1/1 đạt trên database disposable; database boundary validator đạt cấu trúc SQL + live PostgreSQL 28 bảng/invariant.

## Cập nhật mới nhất — relational reference adapter

- Runtime PostgreSQL mặc định đã chuyển sang `PostgresRelationalRepository`. Core M0–M4/M8 được lưu ở customer/account/beneficiary/quote/transfer/transaction/ledger/notification/audit/outbox tables; snapshot cũ chỉ được nâng một lần.
- Gate mới `npm run test:relational` đạt 1/1 trên database disposable, gồm restart, pending settlement, reconciliation và concurrent quote submit. Auth runtime và M6/M7 bonus vẫn là record-level reference; chưa tuyên bố production readiness.
- Backend correctness đã có quote snapshot/one-time, beneficiary fingerprint, UUID-compatible IDs, exact route, registration/step-up rate limit, reconciliation formula và outbox retry threshold.
- Persistent PostgreSQL relational reference adapter, migration runner và CI service đã được thêm; integration test core chạy khi có `DATABASE_URL`, còn relational regression dùng `RELATIONAL_DATABASE_URL` disposable.
- OpenAPI validation, Maestro syntax validation, Expo native config và web export đều đã chạy lại sau các route hiện tại; hiện có 36 path OpenAPI, 10 flow Maestro hợp lệ và 33 static route. Critical flow M0–M4/M8, M6 savings, credit payment, credit pending-resume, Credit card lock/restart/unlock, Credit overdue notification và offline login retry đã chạy thành công trên Android emulator.
- Auth/session/device binding/MFA, accounts/history/detail/filter, transfer quote/step-up/idempotency/pending recovery, notifications và fraud report có reference flow.
- M2 có eKYC mô phỏng với form, ảnh mẫu và vòng đời DRAFT/PENDING/APPROVED/REJECTED.
- M4 có transfer flow, danh bạ người nhận CRUD, QR payload validation, camera scanner và manual input fallback.
- M8 có notification list/read, notification detail và deep link tới transaction detail hoặc profile.
- M5 có Card mock/reference: list/detail, lock/unlock, ẩn/hiện số mô phỏng và đổi PIN mô phỏng; không lưu PIN/CVV thật.
- Có seed sandbox tự động cho E2E và report release/device nêu rõ các gate chưa thể chạy tại workspace.

## Chưa đủ điều kiện đóng milestone

- M0: baseline tài liệu, evidence rules, device evidence và checkpoint Git sạch `dd515ad` đã có; owner review/push vẫn còn.
- M1–M4 và M8: critical flow đã chạy trên Android emulator cho login/MFA, account detail, hiện/sao chép số tài khoản đầy đủ, eKYC, beneficiary, QR manual fallback, M4 transfer và M8 notification deep link; chưa có full device matrix, thiết bị thật hoặc staging partner.
- M2: eKYC thật/API KYC và test data staging chưa có; phần hiện tại là mock có chủ đích.
- M4: transfer, beneficiary CRUD, QR manual fallback và pending/restart/resume đã có bằng chứng Maestro trên emulator; QR camera/permission và lifecycle native trên thiết bị thật vẫn chưa có.
- M6 và M7: đã có reference sandbox; M6 quote/review/step-up/mở khoản → danh sách, M7 payment pending → stop/launch → resume, card lock → stop/launch → OTP unlock và overdue notification → card detail đã có flow pass trên emulator. M5 vẫn là mock/fixture, chưa phải API/production card integration; M9 chưa triển khai.
- M10: usability, accessibility, performance và native device regression chưa hoàn tất; audit Mobile còn 14 High; remote CI execution chưa có log trong workspace dù local PostgreSQL gate đã đạt.
- M11: đã build APK release local và lưu checksum/evidence; chưa có signing, cài đặt ngoài máy phát triển, staging, monitoring và hồ sơ bảo vệ đầy đủ.

## Quyết định persistence reference

Các kết quả local là bằng chứng cho reference implementation, không phải chứng nhận production/pilot. Core M0–M4/M8 dùng bảng relational; auth runtime và M6/M7 bonus dùng record-level reference. Mọi trạng thái `HOÀN THÀNH` trong kế hoạch phải kèm test report, thiết bị, evidence và người review.
## Cập nhật sau đồng bộ M6 và triển khai M7 — 2026-08-15

- M6 Savings đã có quote/MFA/idempotency/PENDING-resume/maturity, Mobile list/open/detail và notification deep link; flow native emulator đã pass, nhưng chưa đóng vì thiếu repository relational production, thiết bị thật và staging.
- M7 Credit sandbox đã bắt đầu: thẻ VND cấp sẵn, hạn mức 20.000.000, dư nợ seed 4.000.000, khả dụng 16.000.000, sao kê và thanh toán MINIMUM/FULL/CUSTOM. Không có CIC, processor, PAN/CVV/PIN hoặc tiền thật.
- OpenAPI draft hiện có 36 path; backend route/schema validator đã bao phủ Cards/Credit. Mobile `/cards` đã chuyển khỏi `cardsMock` sang API Credit draft.
- Migration `003_credit_sandbox.sql` và policy fields đã có ở mức draft; live Postgres/Maestro evidence M7 đã chạy ở checkpoint hiện tại; relational production và device thật vẫn là gate mở.

## Cap nhat chinh xac sau M7 local verification - 2026-08-15

- M6 Savings va M7 Credit da co reference sandbox implementation; cac dong mo ta cu "chua trien khai" chi la snapshot truoc khi thuc hien.
- M6/M7 local gate hiện tại: Mobile 37 suite/170 test, OpenAPI 36 path, Maestro syntax 10 flow; M6 savings, M7 credit và offline retry đã có bằng chứng emulator.
- Home/account detail da cho phep hien va sao chep day du so tai khoan qua API rieng; mat tren Home van chi hien/che so du.
- Chua dong milestone: relational repository production, transfer lifecycle native day du, physical device, staging/partner integration va production controls. PostgreSQL live, concurrency/restart sandbox va Maestro M7 emulator da co evidence.

## Cập nhật sau khi hoàn tất kế hoạch persistent local — 2026-08-17

- M0–M4 và M8 đã được kiểm tra lại trên APK release mới với Android emulator; artifact mới nhất là `C:\Users\admin\.maestro\tests\2026-08-17_121849`.
- Backend mặc định chạy PostgreSQL persistent, đã kiểm tra migration từ database local, restart giữ user/account/balance, và 70/70 test backend đạt khi cấu hình cả `DATABASE_URL` và `RELATIONAL_DATABASE_URL`.
- Đã xử lý lỗi tương thích notification giữa seed và Mobile bằng migration trạng thái; không để nhãn kỹ thuật funding nội bộ xuất hiện như loại notification người dùng.
- Phần còn mở của các milestone là relational repository production cho toàn domain, device thật, camera/biometric native, performance/concurrency quy mô lớn, remote CI và các kiểm soát staging/production.

## Cập nhật bằng chứng transfer pending — 2026-08-17

- Transfer `PENDING` đã được kiểm tra trên Android emulator sau khi dừng ứng dụng và mở lại; trạng thái vẫn được đọc từ backend PostgreSQL persistent.
- Artifact: `C:\Users\admin\.maestro\tests\2026-08-17_125314`.
- M4 hiện có bằng chứng emulator cho quote/review/step-up/submit và pending-resume. Gate còn lại là thiết bị thật, camera QR/permission native, concurrency quy mô lớn và staging.
- Các bước tiếp theo theo phạm vi: reproducible CI → hardening lỗi mạng/concurrency → repository relational canonical (nếu bàn giao persistent dài hạn) → Android thật → bộ bằng chứng và runbook.

## Cập nhật hardening request boundary — 2026-08-17

- Persistent server đã tách bước đọc/parse body khỏi transaction relational; body không hợp lệ được trả lỗi validation trước khi lấy advisory lock và lỗi 4xx/5xx không commit state dở dang.
- Regression suite PostgreSQL đạt 70/70; critical API đạt 8/8. Cleanup quote/outbox và retry idempotency đã có regression; đây là hardening reference sandbox, chưa thay thế rate-limit phân tán hoặc gateway production.

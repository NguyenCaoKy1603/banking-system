# Mini Core Banking Sandbox — trạng thái triển khai

Ngày cập nhật: 2026-08-17
Branch: `codex/mini-core-banking-sandbox`
Phạm vi: reference sandbox cho đồ án; không phải hệ thống xử lý tiền thật.

## Kết quả chính

- PostgreSQL runtime mặc định đã dùng `PostgresRelationalRepository`: customer/account/beneficiary/quote/transfer/transaction/ledger/notification/audit/outbox được chiếu vào bảng relational. Snapshot cũ chỉ được đọc một lần để nâng dữ liệu; state auth tạm thời và M6/M7 bonus nằm theo từng record trong `reference_runtime_records`.
- `npm run seed:e2e` đã chạy lại trên adapter mới sau restart backend: registration/MFA, Funding, transfer `SUCCEEDED`, savings `SUCCEEDED` và credit activation đều đạt; không in secret.

- M0–M4 và M8 vẫn có trong chương trình: nền tảng, auth/eKYC dùng dữ liệu thử nghiệm, account/history, transfer/beneficiary/QR và notification/deep-link.
- Đăng ký mới hoàn tất qua hai bước OTP; trước khi xác minh chưa tạo user/account. Sau xác minh chỉ có một payment account, số dư 0 VND, không tự tạo beneficiary, savings hoặc credit.
- Sandbox Funding chỉ còn là fixture nội bộ hoặc Admin action four-eyes; không có customer route/operator-key endpoint. Funding tạo journal cân bằng, transaction, audit và outbox.
- Tra cứu người nhận dùng số tài khoản thật; beneficiary lưu destination nội bộ và chỉ trả dữ liệu công khai đã che. Quote lưu snapshot bất biến và chỉ được submit một lần.
- Transfer immediate tạo debit nguồn, credit người nhận, fee journal, transaction hai phía, audit/outbox và reconciliation. Transfer pending giữ tiền bằng hold; FAILED giải phóng hold; REVERSED chỉ áp dụng sau SUCCEEDED.
- OTP step-up có purpose/resource/device/fingerprint, dùng một lần. Public API không còn endpoint đọc OTP fixture; test dùng adapter nội bộ hoặc provider test được cấp riêng.
- Savings và Credit không còn là sản phẩm mặc định: savings mở sau khi người dùng chọn; credit đi qua `SUBMITTED` → Admin review/decision (`PENDING_ACTIVATION`) → activation step-up → tạo thẻ/account với dư nợ ban đầu 0.
- Home và Account Detail dùng endpoint riêng để hiện số tài khoản đầy đủ. Danh sách chỉ trả số đã che; nút Hiện đầy đủ và Sao chép lấy cùng một chuỗi đầy đủ, không lấy từ 4 số cuối.

## Chất lượng đã chạy trên branch này

| Hạng mục | Kết quả |
| --- | --- |
| Backend typecheck/build | Đạt |
| Backend unit + HTTP | 70/70 đạt với PostgreSQL persistent local khi cấu hình cả `DATABASE_URL` và `RELATIONAL_DATABASE_URL`; không có database thì 6 test persistence được skip có chủ ý |
| Relational persistence regression | 1/1 đạt trên PostgreSQL disposable: restart, pending settlement, reconciliation và concurrent quote submit |
| Mini Core regression | 7/7 đạt |
| Database boundary validator | Đạt live PostgreSQL: 28 bảng, cột và constraint chính |
| Backend OpenAPI validator | 44 path bắt buộc, 49 exact route guards |
| Mobile lint/typecheck | Đạt |
| Mobile unit test | 37 suite, 170 test đạt |
| Mobile OpenAPI/Maestro syntax | 36 path Mobile; 10 flow hợp lệ |
| Web export | Đạt 33 static route khi dùng URL HTTPS preview cho bước export |
| E2E seed tích hợp | Đạt trên PostgreSQL persistent local: clean registration → Funding → transfer → savings → credit activation |

## Bằng chứng hiện hành và phần cần bổ sung

Các artifact ngày 2026-08-16 chỉ giữ vai trò truy vết lịch sử, không dùng để khẳng định các flow clean-registration/credit-activation mới. Bằng chứng hiện hành trên APK release ngày 2026-08-17 đã xác nhận M0–M4/M8 và transfer pending-resume trên emulator; các gate còn phải bổ sung là thiết bị thật, native camera/biometric và staging:

1. M0–M4/M8 trên thiết bị Android thật: đăng ký OTP → login → Home → Hiện đầy đủ/Sao chép số tài khoản → transfer người nhận thật → notification/deep-link.
2. Savings trên APK hiện tại: chọn ô Tiền gửi → quote → OTP động → mở khoản.
3. Credit trên APK hiện tại: đăng ký hồ sơ → OTP → kích hoạt → thẻ xuất hiện với dư nợ 0.
4. Card unlock/transfer/pending-resume sau restart trên lifecycle native và thiết bị thật.

Kiểm tra trên Android emulator `emulator-5554` ngày 2026-08-17 đã hoàn tất cho M0–M4/M8 và phạm vi số tài khoản: cài APK sandbox, đăng nhập dữ liệu giả lập, Home và Account Detail đều hiện số dạng 12 chữ số khi bấm `Hiện`; hai nút `Sao chép` đều hiển thị thông báo thành công. Không lưu số đầy đủ, mật khẩu hoặc OTP vào bằng chứng. Đây vẫn chưa phải bằng chứng thiết bị Android thật hoặc staging.

PostgreSQL thật, tải/concurrency quy mô lớn, thiết bị vật lý, camera/biometric native, staging/partner integration, signing và compliance vẫn là phần còn thiếu.

## APK build mới

- `assembleRelease`: thành công ngày 2026-08-17; APK nằm tại `mobile-app/android/app/build/outputs/apk/release/app-release.apk`.
- SHA-256 bản sandbox emulator hiện hành: `8ADAEEDD4A21D310A1CDA0A79B75515785A6683792CD5FF26583F2B65D808F7A`.
- Bản này dùng `EXPO_PUBLIC_SANDBOX_HTTP=1` và URL HTTP nội bộ `127.0.0.1:5000` qua `adb reverse`; chỉ dùng cho emulator/local sandbox, không dùng production.
- Đây là artifact để cài kiểm tra thủ công; cần chạy lại Maestro/E2E đầy đủ trước khi coi là bằng chứng hoàn tất.

## Cách kiểm tra số tài khoản đầy đủ

Sau khi sửa code, khởi động lại backend và reload/rebuild Mobile. Đăng nhập lại, vào Home hoặc Chi tiết tài khoản rồi bấm `Hiện đầy đủ` hoặc `Sao chép`. Backend phải trả `GET /accounts/{accountId}/number` với chuỗi số đầy đủ; UI không được dùng `maskedNumber` cho hai thao tác này. Không hiển thị UUID, token, device ID, PIN, OTP, password hoặc ledger journal ID.

## Xác nhận triển khai tiếp theo — 2026-08-17

- Runtime local mặc định đã chuyển sang PostgreSQL persistent; `npm start` đọc `.env`, yêu cầu schema đã migrate và chỉ dùng `BANKING_STORAGE=in-memory` cho unit/reference test nhanh.
- PostgreSQL 16 local đã chạy đủ migration, database validator xác nhận 28 bảng và constraint chính; health trả reconciliation/outbox `ok`.
- Backend đạt 70/70 test khi chạy cùng PostgreSQL, typecheck, build, critical API, OpenAPI và dependency audit đều đạt. Dữ liệu user/account/balance đã được kiểm tra còn nguyên sau khi restart backend.
- Lần chạy Maestro đầu tiên phát hiện lỗi contract notification: dữ liệu funding cũ có loại nội bộ `SANDBOX_FUNDING`, khiến Mobile từ chối cả danh sách. Đã sửa generator và thêm state migration sang notification `SECURITY`, đồng thời thêm regression test.
- Luồng M0–M4/M8 đã pass trên Android emulator sau sửa: login + MFA, Home, hiện/sao chép số tài khoản đầy đủ ở Home và Account Detail, KYC dùng dữ liệu thử nghiệm, beneficiary, QR manual fallback và notification deep-link. Artifact: `C:\Users\admin\.maestro\tests\2026-08-17_121849`.
- Phạm vi vẫn là hệ thống thử nghiệm dùng tiền ảo; chưa kết nối core banking, payment rail, repository relational production cho toàn bộ M6/M7/auth runtime, thiết bị vật lý, camera/biometric native, tải lớn, staging hoặc compliance production.

## Xác nhận transfer pending sau restart — 2026-08-17

- Đã chạy lại trên Android emulator bằng dữ liệu PostgreSQL persistent riêng cho E2E; transfer được tạo ở trạng thái `PENDING`.
- Flow đã kiểm tra: đăng nhập MFA → chọn beneficiary đã lưu → quote/review → step-up → submit → force-stop app → mở lại → cập nhật trạng thái. Sau restart, giao dịch vẫn hiển thị `Giao dịch đang được xử lý`.
- Artifact Maestro: `C:\Users\admin\.maestro\tests\2026-08-17_125314`.
- Kịch bản `critical-transfer-retry.yaml` đã được sửa để chọn beneficiary từ danh bạ, xử lý bàn phím che nút quote/submit và không bấm lại nút submit sau khi UI đã chuyển sang màn hình trạng thái. Tính idempotency/double-submit tiếp tục được bảo vệ bởi critical API test.
- Kết quả này đóng bằng chứng lifecycle pending ở emulator cho reference sandbox; chưa thay thế test trên thiết bị Android thật, iOS hoặc staging.

## Các bước tiếp theo trong phạm vi đã chốt

1. Đóng gói reproducible: chạy lại quality gate từ clone sạch, xác nhận CI dùng PostgreSQL service và giữ `.env`, secret, `node_modules`, `dist` ngoài Git.
2. Hardening transfer: thêm/duy trì test concurrency, retry, timeout/offline, hết hạn quote/OTP, cleanup dữ liệu hết hạn và health fail khi DB/outbox lỗi.
3. Hoàn thiện persistence dài hạn nếu cần bàn giao ngoài reference: mở rộng repository relational cho toàn bộ M6/M7 và auth runtime, migration từ database rỗng, backup/restore rehearsal và kiểm thử transaction quote → transfer → ledger → outbox.
4. Mở rộng bằng chứng thiết bị: Android thật cho camera QR, background/resume và permission; iOS chỉ khi được đưa vào scope; không coi emulator là thiết bị thật.
5. Hồ sơ bàn giao: chốt commit SHA, test report, health JSON, checksum APK, runbook giả lập và video/ảnh không chứa OTP, token hoặc số tài khoản đầy đủ.

Savings/Credit tiếp tục là module bonus/reference; Chatbot AI, payment rail, core banking và tiền thật nằm ngoài phạm vi này.

## Hardening persistent request boundary — 2026-08-17

- Persistent HTTP server hiện đọc và validate request body trước khi mở transaction/advisory lock PostgreSQL; request JSON lỗi trả `422 VALIDATION_ERROR` mà không giữ lock trong lúc chờ body.
- Regression test cleanup quote/outbox nằm trong bộ backend test; backend hiện đạt 70/70 test với cả hai biến database, gồm cả nhánh PostgreSQL unavailable trả `503`.

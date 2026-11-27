# Trạng thái hiện tại — Banking System / NOVA

> Rà soát source và tài liệu: 2026-11-26. Workspace: branch `Duong` (đồng bộ các bản nâng cấp P0–P1 bảo mật, NAPAS/VietQR, quản lý thiết bị, cảnh báo bất thường, xuất sao kê, đối soát sổ cái & Control Policy, thực thi trực tiếp 1 bước trên Admin Web và đăng nhập/step-up Sinh trắc học + Mã PIN thiết bị trên Mobile). Đây là snapshot hiện trạng code và tài liệu, không phải release manifest.

## Kết luận

Dự án có một ứng dụng Mobile, Customer API, Admin API/Web và PostgreSQL reference runtime cho các luồng ngân hàng dùng dữ liệu tổng hợp và tiền ảo. Một số domain đã được nối trực tiếp qua PostgreSQL relational-v2; các adapter nghiệp vụ vẫn là reference implementation. Chưa có bằng chứng đủ để gọi hệ thống là pilot-ready hoặc production-ready.

## Mức độ tin cậy của trạng thái

| Điều được xác nhận | Căn cứ | Không chứng minh |
| --- | --- | --- |
| Source hiện có các tính năng trong [bản đồ chức năng](../02-design/function-scope.md) | Thư mục và entrypoint hiện hành trong mobile-app, backend, admin-web | Không chứng minh mọi màn hình/nhánh đã chạy |
| Backend, Admin API và worker là process riêng | server.ts, adminServer.ts, worker.ts | Không chứng minh đã triển khai thành nhiều service trên cloud |
| PostgreSQL relational-v2 có route groups trực tiếp | runtime config, RelationalHttpBoundary, services và migrations | Không chứng minh database production, backup, RLS hay partner integration |
| Mobile yêu cầu HTTPS ở staging/production; HTTP chỉ dành cho local sandbox | Mobile runtime transport policy | Không chứng minh đã có HTTPS endpoint thật |
| Radox/Assistant và Financial Advice có runtime code | backend assistant/financialAdvice và Mobile feature APIs | Không chứng minh model luôn chọn đúng hoặc nội dung được ngân hàng/legal phê duyệt |

## Phần có trong source

- **Customer identity & MFA:** đăng ký (hỗ trợ hủy challenge `POST /auth/register/cancel`), login mật khẩu hoặc **đăng nhập nhanh bằng Sinh trắc học / Mã PIN thiết bị** (`POST /auth/mfa/biometric/login/{challenge,verify}` gắn `deviceId`, không lưu mật khẩu), session refresh/revoke, quản lý thiết bị (`GET/DELETE /auth/devices`), TOTP MFA, recovery và device binding. Bổ sung lớp che Privacy Shield khi app vào nền, cửa sổ ân hạn 30 giây (`BACKGROUND_LOCK_GRACE_MS`), và hỗ trợ cả Mã PIN khóa thiết bị (`SecurityLevel.SECRET`) bên cạnh Vân tay / Khuôn mặt.
- **Banking & QR:** account reads (`HomeScreen`/`BalanceCard` đa tài khoản), lịch sử giao dịch (`HistoryScreen` lọc server-side, thống kê tháng và **xuất sao kê CSV/HTML**), beneficiary, recipient lookup, quote phí động từ `Control Policy`, chuyển tiền nội bộ & liên ngân hàng **NAPAS / VietQR**, cảnh báo giao dịch bất thường (`/anomalies` chấm điểm 6 quy tắc, khách hàng xác nhận an toàn hoặc báo nghi ngờ) và **phân tầng Step-up** (`< 1.000.000 VND` & rủi ro thấp ưu tiên Sinh trắc học/PIN; `≥ 1.000.000 VND` hoặc rủi ro cao bắt buộc TOTP).
- **Savings và Credit:** quote, mở khoản, tất toán trước hạn, repayment, lifecycle và trạng thái pending trong sandbox; cả `CreditApplicationScreen.tsx` lẫn Backend `relational-v2` (`409 KYC_REQUIRED`) yêu cầu KYC đạt `APPROVED` trước khi mở thẻ tín dụng mới.
- **KYC và Card:** luồng thử nghiệm cho customer/Admin review và card controls (`lock`, `unlock`, `report-lost`); không có provider ngoài thật.
- **QR (`QrScreen.tsx`):** tạo mã QR nhận tiền chuẩn **VIETQR (NAPAS)** và nội bộ, quét camera sau (`facing="back"`) hoặc dán chuỗi thủ công, đối soát qua `/transfer`.
- **Notifications:** inbox/read/deep link cùng outbox processing boundary.
- **Assistant Help & Financial Advice:** hỏi đáp FAQ từ catalog có kiểm soát và tính toán kế hoạch tài chính cá nhân.
- **Admin:** staff auth/session, permission registry, **thực thi trực tiếp 1 bước** cho toàn bộ nghiệp vụ của `OPERATIONS` khi `ADMIN_DIRECT_EXECUTION=true`, `ADMIN` khóa nhân sự trực tiếp kèm Step-up TOTP tại `StaffView`, cấu hình `Control Policy` + đối soát sổ cái (`reconcileLedger` bằng `BigInt`), và `Audit Explorer` (lọc `STAFF`/`CUSTOMER`/`SYSTEM`, xuất CSV/JSON); ẩn `Approval Inbox` trên Sidebar ở chế độ trực tiếp (giữ dự phòng khi `ADMIN_DIRECT_EXECUTION=false`).
- **Worker:** outbox và scheduled lifecycle runner có startup/cutover guards (`compose.yaml` và `backend/.env.example` mặc định `BANKING_PERSISTENCE_MODE=relational-v2` từ 2026-11-16); provider hiện là fake/disabled nếu chưa có adapter đã cấu hình.

## Giới hạn hiện hành cần giữ rõ

1. **Tiền:** runtime là virtual money. Không có quyền chuyển tiền thật.
2. **Core và đối tác:** chưa xác minh core banking, payment rail, card issuer, KYC/AML hoặc identity provider thật.
3. **API:** các contract/OpenAPI trong documents/api là Draft/reference; thay đổi cần owner và partner approval phù hợp.
4. **Môi trường:** local Compose là preview sandbox. Không có trong tài liệu này bằng chứng cloud staging đã qua smoke, device, secret, database TLS, backup/restore hoặc rollback gate.
5. **Thiết bị:** các E2E runner/flow chạy được đã bị gỡ khỏi source/CI ngày 2026-10-11. Báo cáo emulator cũ là historical evidence; không coi là test hiện hành.
6. **Fraud:** customer fraud reporting và Admin Fraud workflow đã bị gỡ ngày 2026-10-13. Schema/migration và dữ liệu cũ còn để bảo toàn lịch sử, không có nghĩa API hiện hành tiếp tục nhận báo cáo.
7. **Backup/DR:** các script backup/restore đã bị gỡ ngày 2026-10-13. Runbook/rehearsal cũ không chứng minh có backup cloud đang vận hành.
8. **AI:** Assistant evaluation lưu trong repo là các đợt dated; controlled catalog report ghi chất lượng partial. Không gọi test offline hoặc mock là live-model/device safety proof.
9. **Dependency/release:** trạng thái audit phụ thuộc thời điểm và lockfile. Tài liệu này ghi nhận kết quả kiểm tra ngày 2026-11-26 (trên nhánh `Duong`):
   - **Mobile:** `lint`, `typecheck`, `validate:openapi` (44 paths) và **74/74 suites (535/535 Jest tests)** đạt.
   - **Admin Web:** `lint`, `typecheck`, `build` và **17/17 tests** đạt.
   - **Backend:** `validate:database` (52 tables khớp PostgreSQL), `typecheck`, `build` và `npm test` đạt **664 pass / 0 fail / 56 skipped** (skip khi không truyền DB URL riêng cho bộ disposable).
   - **Hai vướng mắc DB còn mở cần owner quyết định:** (a) `test:credit:persistence` (`creditRelational.test.ts`) và các script ngoài 10 path trong `APPROVED_TEST_PATHS` hiện bị `disposableDatabaseGuard.ts` từ chối qua CLI wrapper dù `package.json`/CI có gọi; (b) `disposableMigrationRuntime.test.ts` gặp `FAIL` (`PRIMARY_ERROR`) ở pha `7_CHILD_TEST_INITIAL_HISTORY` (cleanup xóa container sạch). Hành vi camera thật và chuyển app trên thiết bị Android/iOS thực tế vẫn cần xác minh sau khi build APK mới.

## Điều kiện trước khi nâng mức môi trường

| Bước | Điều kiện tối thiểu | Tài liệu |
| --- | --- | --- |
| Local reference | Cấu hình sandbox, database disposable khi chạy destructive test, dữ liệu tổng hợp | [Backend README](../../backend/README.md), [Testing README](../05-testing/README.md) |
| Preview nội bộ | HTTPS/API allow-list, PostgreSQL riêng/private, secret provider, artifact digest, migration/health/smoke, rollback plan | [Preview runbook](../07-release/preview-deployment-runbook.md), [Secret management](../07-release/secret-management-runbook.md) |
| Pilot/production-like | Tất cả preview gates, partner/core, legal/compliance, device matrix, signed build, monitoring/incident/restore drills và approvals | Chưa được chứng minh trong workspace hiện tại |

Không bỏ gate hoặc đổi ngưỡng chỉ để làm tài liệu trông hoàn tất.

## Tài liệu kiến trúc và hướng dẫn liên quan

- [Repository map](repository-map-current.md) — vị trí source hiện tại.
- [Release README](../07-release/README.md) — cách đọc release artifacts và runbook.

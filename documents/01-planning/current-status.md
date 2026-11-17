# Trạng thái hiện tại — Banking System / NOVA

> Rà soát source và tài liệu: 2026-11-17. Workspace: branch `main`, có các thay đổi local chưa commit (cấu hình staging EAS/app của owner, bản nâng cấp Mobile TOTP/QR/QR→Transfer/History Summary/Home Multi-account/TransferStepViews/Credit KYC gating, Admin Web KYC format check, Backend Credit KYC guard/`AuditRepository` `trace_id` và `compose.yaml`/`.env.example` mặc định `relational-v2`). Đây là snapshot của working tree, không phải release manifest.

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

- **Customer identity:** đăng ký, login, session refresh/revoke, TOTP MFA, recovery và device binding. Từ 2026-11-16 bổ sung lớp che Privacy Shield khi app vào `background`/`inactive`, cửa sổ ân hạn nền 30 giây (`BACKGROUND_LOCK_GRACE_MS`) để lấy mã TOTP trên cùng thiết bị, khôi phục đúng tuyến đường sau khi mở khóa `> 30s` và giữ tạm bản nháp MFA enrollment/challenge trên RAM theo `sessionEpoch`.
- **Banking:** account reads (`HomeScreen`/`BalanceCard` cộng dồn tổng số dư thực trên tất cả tài khoản thanh toán và hỗ trợ chuyển đổi tài khoản khi có nhiều tài khoản), lịch sử giao dịch (`HistoryScreen`/`historySummary.ts` thống kê Thu/Chi/Chênh lệch ròng theo tháng hiện tại trên dữ liệu đã tải, hỗ trợ chọn tài khoản và hướng dẫn phân trang khi lọc rỗng), beneficiary, recipient lookup, quote và internal transfer với idempotency/step-up; `TransferScreen.tsx` (đã tách UI bước sang `TransferStepViews.tsx`) hỗ trợ chọn tài khoản nguồn, đồng bộ route params và tự động đối soát tài khoản nhận từ QR qua `lookupInternalRecipient` (không ghi đè recovery intent đang mở).
- **Savings và Credit:** quote, mở khoản, repayment, lifecycle và trạng thái pending trong sandbox; từ 2026-11-16 cả `CreditApplicationScreen.tsx` lẫn Backend `relational-v2` (`RelationalCreditService.submitApplication` trả `409 KYC_REQUIRED`) đều yêu cầu hồ sơ KYC đạt `APPROVED` trước khi gửi đề nghị mở thẻ tín dụng mới.
- **KYC và Card:** luồng thử nghiệm cho customer/Admin review và card controls; không có provider ngoài thật. `KycScreen.tsx` hiển thị ghi chú tài liệu mẫu tổng hợp và Admin Web `Applications.tsx` đối chiếu định dạng 6–24 chữ số khớp Backend `kycService.ts`.
- **QR:** màn hình QR của tôi & Quét QR (`QrScreen.tsx`); từ 2026-11-16 tự động kiểm tra/xin quyền và mở camera sau (`facing="back"`, `height: 300`) khi vào tab Quét QR, hỗ trợ mở Cài đặt OS khi bị chặn quyền và tự kiểm tra lại khi quay về app, giữ nguyên ranh giới `D-20` không tự tạo lệnh chuyển tiền từ QR (chuyển tiếp sang `/transfer` để server đối soát).
- **Notifications:** inbox/read/deep link cùng outbox processing boundary.
- **Assistant Help:** câu hỏi được kiểm tra, có nhánh tất định và nhánh selector AI chọn câu trả lời từ catalog; không thực hiện giao dịch.
- **Financial Advice:** calculator xác định và selector AI có giới hạn; kết quả dựa trên số liệu người dùng nhập.
- **Admin:** staff auth/session, permission registry, maker-checker/action engine, audit (kèm `trace_id` ở `AuditRepository`) và operations UI.
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
9. **Dependency/release:** trạng thái audit phụ thuộc thời điểm và lockfile. Tài liệu này ghi nhận kết quả kiểm tra ngày 2026-11-16:
   - **Mobile:** `lint` (0 lỗi/0 cảnh báo), `typecheck`, `validate:openapi` (44 paths), `validate:release`, `validate:public-env` (244 files), **69/69 suites (498/498 Jest tests)** và `export:web` (37 static routes HTTPS staging env + `validate:public-env -- dist` 3 files) đạt.
   - **Admin Web:** `typecheck`, `build` và **17/17 tests** đạt.
   - **Backend (không DB & trên PostgreSQL 16 Docker disposable):** `typecheck`, `build`, `validate:openapi` (52 paths), `validate:admin-openapi` (58 routes), `validate:secrets` (754 files) đạt; `npm test` đạt **637 pass / 0 fail / 55 skipped** (skip khi không truyền DB URL). Trên container PostgreSQL 16 disposable áp dụng đủ 44 migration (`001`–`044`), **8 suite trong allowlist đạt 23/23 tests PASS**: `databaseFoundation` (11/11), `kycRelational` (1/1), `authRelational` (3/3), `registrationRelational` (1/1), `mfaPersistence` (4/4), `assistantHelpRelational.database` (1/1), `integratedDisposable` (1/1), `migrationFingerprint` (1/1).
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

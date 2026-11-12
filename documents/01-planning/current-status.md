# Trạng thái hiện tại — Banking System / NOVA

> Rà soát source và tài liệu: 2026-10-14. Workspace: branch codex/staging-academic-completion, HEAD a5bf4a6, có thay đổi chưa commit. Đây là snapshot của working tree, không phải release manifest.

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

- **Customer identity:** đăng ký, login, session refresh/revoke, TOTP MFA, recovery và device binding.
- **Banking:** account reads, transaction history/detail, beneficiary, recipient lookup, quote và internal transfer với idempotency/step-up.
- **Savings và Credit:** quote, mở khoản, repayment, lifecycle và trạng thái pending trong sandbox.
- **KYC và Card:** luồng thử nghiệm cho customer/Admin review và card controls; không có provider ngoài thật.
- **Notifications:** inbox/read/deep link cùng outbox processing boundary.
- **Assistant Help:** câu hỏi được kiểm tra, có nhánh tất định và nhánh selector AI chọn câu trả lời từ catalog; không thực hiện giao dịch.
- **Financial Advice:** calculator xác định và selector AI có giới hạn; kết quả dựa trên số liệu người dùng nhập.
- **Admin:** staff auth/session, permission registry, maker-checker/action engine, audit và operations UI.
- **Worker:** outbox và scheduled lifecycle runner có startup/cutover guards; provider hiện là fake/disabled nếu chưa có adapter đã cấu hình.

## Giới hạn hiện hành cần giữ rõ

1. **Tiền:** runtime là virtual money. Không có quyền chuyển tiền thật.
2. **Core và đối tác:** chưa xác minh core banking, payment rail, card issuer, KYC/AML hoặc identity provider thật.
3. **API:** các contract/OpenAPI trong documents/api là Draft/reference; thay đổi cần owner và partner approval phù hợp.
4. **Môi trường:** local Compose là preview sandbox. Không có trong tài liệu này bằng chứng cloud staging đã qua smoke, device, secret, database TLS, backup/restore hoặc rollback gate.
5. **Thiết bị:** các E2E runner/flow chạy được đã bị gỡ khỏi source/CI ngày 2026-10-11. Báo cáo emulator cũ là historical evidence; không coi là test hiện hành.
6. **Fraud:** customer fraud reporting và Admin Fraud workflow đã bị gỡ ngày 2026-10-13. Schema/migration và dữ liệu cũ còn để bảo toàn lịch sử, không có nghĩa API hiện hành tiếp tục nhận báo cáo.
7. **Backup/DR:** các script backup/restore đã bị gỡ ngày 2026-10-13. Runbook/rehearsal cũ không chứng minh có backup cloud đang vận hành.
8. **AI:** Assistant evaluation lưu trong repo là các đợt dated; controlled catalog report ghi chất lượng partial. Không gọi test offline hoặc mock là live-model/device safety proof.
9. **Dependency/release:** trạng thái audit phụ thuộc thời điểm và lockfile. Tài liệu này chưa chạy audit, build, test hay deploy.

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

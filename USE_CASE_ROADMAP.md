# Danh mục use case và điểm tiếp tục — Banking System

Ngày cập nhật: 2026-09-07.

## Đọc khi bắt đầu lại

- Đọc `AGENTS.md`, `PROJECT_CONTEXT.md`, file này và task hiện hành.
- Kiểm tra branch, HEAD và working tree trước khi hành động; các mốc dưới đây là lịch sử, không yêu cầu reset về chúng.
- Dự án là đồ án tốt nghiệp: dữ liệu synthetic, tiền ảo, local demo; không production, KYC thật hoặc tích hợp ngân hàng thật.
- Danh mục 22 use case dưới đây là đề xuất lập từ chức năng hiện có và được lưu theo yêu cầu Owner. Lưu danh mục không tự cấp quyền triển khai tất cả mục, thay đổi acceptance hoặc quyền Git.
- Không đồng nhất các mã này với milestone cũ M0–M11 hoặc giai đoạn S1–S5.

## Trạng thái và bước tiếp theo

**UC-M01 — Registration và Synthetic KYC: COMPLETED — OWNER APPROVED.**

- Đóng nghiệm thu ngày 2026-09-07, qua chuỗi M01-01 đến M01-09.
- Commit implementation/relational verification: `b5ef30cb78eaa43932a2ba14f3989aab6e648994`.
- Commit tài liệu closure: `98f8a1857910f4067828714f8a786e4a77928072`.
- Branch tại closure: `codex/staging-academic-completion`.
- Biên bản: `tasks/UC-M01/TASK_M01_09_AUDIT_AND_CLOSE_UC_M01.md`.
- Giữ giới hạn đã duyệt: KYC-15 kết hợp unit/contract và relational; Registration recovery/cancel chưa có emulator verification độc lập; privacy evidence có phạm vi, không bảo đảm zero leakage tuyệt đối.
- Không mở lại UC-M01 nếu không có bằng chứng regression hoặc yêu cầu mới của Owner.

**UC-M02 — Đăng nhập, quản lý phiên và đăng xuất: COMPLETED — OWNER APPROVED.**

- Đóng nghiệm thu ngày 2026-09-07, qua chuỗi nhiệm vụ M02-01 đến M02-07.
- Commit implementation Mobile/Client Lifecycle: `95c05d35bbed510c175309fe68ea10dd3332cd5f` (M02-05).
- Commit implementation Route Guard & Emulator Verification: `679ef87759f9c350b5f25ac6688b9cadd842bf4c` (M02-06).
- Commit runner alignment & closure audit: lưu cùng checkpoint này.
- Branch tại closure: `codex/staging-academic-completion`.
- Biên bản nghiệm thu: `tasks/UC-M02/TASK_M02_07_AUDIT_AND_CLOSE_UC_M02.md`.
- Giữ 4 giới hạn đồ án đã được Owner phê duyệt: (1) Đăng xuất kết hợp HTTP in-memory và relational service PG, chưa có HTTP relational boundary test tích hợp; (2) SecureStore mock/UI test, không tuyên bố hardware keystore persistence; (3) Cold start / AppState transition kiểm chứng qua React Native unit state machine test; (4) Deep-link kiểm chứng thực nghiệm 5 route Credit sâu kết hợp layout structure audit.
- Không mở lại UC-M02 nếu không có bằng chứng regression hoặc yêu cầu mới từ Owner.

**UC-M03 — Quản lý phương thức xác thực và khôi phục MFA: COMPLETED — OWNER APPROVED.**

- Đóng nghiệm thu Đợt 1 ngày 2026-09-08 theo biên bản `tasks/UC-M03/TASK_DOT_1_HOAN_TAT_AUTHENTICATION_MFA.md`.
- Đã khắc phục lỗi TTL recovery token (`expiresAt = cooldownUntil + 15m`) và lỗi AAD encryption context trong `beginRecoveryTotpEnrollment`.
- Đã đồng bộ OpenAPI contract (`POST /auth/mfa/recovery-codes/rotate`, 409 conflict responses, required fields).
- Cập nhật test contract KYC (`kycContract.test.ts`) tường minh, độc lập và đạt PASS toàn bộ 28/28 tests.
- Kế thừa và kiểm chứng cơ chế client continuation của M03-10 trên Mobile (`MfaRecoveryScreen.tsx`).
- Kiểm chứng toàn diện: unit regression test, relational test trên PostgreSQL disposable (4/4 PASS), 6 luồng HTTP lifecycle demo end-to-end (PASS), Mobile Jest suite (408/408 PASS), và build/install release APK lên Android emulator-5554 thành công.
- Giữ 2 giới hạn đồ án đã được Owner phê duyệt:
  1. MFA UI interactive flow trên emulator chưa chạy; APK mới có build/install/startup smoke PASS; bằng chứng component Jest, HTTP lifecycle và PostgreSQL không thay thế tương đương cho emulator E2E.
  2. Recovery continuation chỉ hoạt động khi `recoveryToken` còn trong memory state của màn hình; không hỗ trợ khôi phục sau cold restart hoặc process-kill.
- Điểm tiếp tục Đợt 2: Chuẩn bị backend local phục vụ demo và kiểm chứng tích hợp Mobile trực tiếp trên emulator.

## Khách hàng Mobile — 16 use case

| Mã | Tên | Phạm vi chính |
| --- | --- | --- |
| UC-M01 | Đăng ký và Synthetic KYC | Đăng ký, OTP, KYC Draft/Submit; đã hoàn tất với giới hạn được duyệt. |
| UC-M02 | Đăng nhập, quản lý phiên và đăng xuất | Login, refresh, restore, route guard, logout, logout-all. |
| UC-M03 | Quản lý phương thức xác thực và khôi phục MFA | TOTP enrollment/confirmation, quản lý phương thức và recovery theo contract. |
| UC-M04 | Xem tài khoản và số dư | Dashboard, account detail, số dư từ server, hiện/sao chép số tài khoản. |
| UC-M05 | Tra cứu lịch sử và chi tiết giao dịch | Danh sách, lọc/phân trang, chi tiết và trạng thái. |
| UC-M06 | Quản lý người thụ hưởng | Xem, thêm, đổi tên, xóa; validation và duplicate handling. |
| UC-M07 | Chuyển tiền nội bộ mô phỏng | Recipient lookup, quote/phí, step-up, submit, receipt, retry/resume không chuyển trùng. |
| UC-M08 | Xem và quét QR thông tin tài khoản | Hiển thị/quét/nhập QR; UNVERIFIED, không tự khởi tạo thanh toán. |
| UC-M09 | Xem và đánh dấu thông báo | List/detail, mark-read, điều hướng; không yêu cầu push thật. |
| UC-M10 | Báo cáo giao dịch đáng ngờ | Gửi báo cáo, chống trùng và tra cứu trạng thái theo API. |
| UC-M11 | Mở khoản tiết kiệm mô phỏng | Sản phẩm, quote, xác nhận, xác thực, kết quả mở khoản. |
| UC-M12 | Theo dõi khoản tiết kiệm | List/detail, trạng thái, kết quả đáo hạn theo sandbox; không tự thêm tất toán sớm. |
| UC-M13 | Đăng ký và kích hoạt thẻ tín dụng mô phỏng | Hồ sơ, trạng thái xét duyệt, kích hoạt; không CIC/processor thật. |
| UC-M14 | Xem và quản lý trạng thái thẻ | List/detail, khóa, mở khóa, báo mất theo quyền/xác thực. |
| UC-M15 | Tra cứu tài khoản tín dụng và sao kê | Hạn mức, dư nợ, giao dịch, danh sách/chi tiết sao kê. |
| UC-M16 | Thanh toán dư nợ tín dụng mô phỏng | Quote, số tiền, xác thực, submit, phục hồi không ghi nợ trùng. |

## Nhân viên/Admin — 6 use case

| Mã | Tên | Phạm vi chính |
| --- | --- | --- |
| UC-A01 | Đăng nhập và quản lý quyền nhân viên | Staff auth/MFA/session, staff/role và quyền truy cập hiện có. |
| UC-A02 | Tra cứu và kiểm soát khách hàng/tài khoản | Masked reads, yêu cầu khóa/chặn, cấp tiền ảo theo quy trình phê duyệt. |
| UC-A03 | Xét duyệt hồ sơ KYC | Yêu cầu bổ sung, duyệt/từ chối; Mobile không tự duyệt. |
| UC-A04 | Xét duyệt hồ sơ tín dụng | Quyết định theo rule sandbox, không mở nghiệp vụ cho vay thật. |
| UC-A05 | Xử lý giao dịch và báo cáo đáng ngờ | Pending/reversal, fraud case theo quyền và hành động hiện có. |
| UC-A06 | Phê duyệt yêu cầu và tra cứu nhật ký | Approval Inbox, maker-checker, audit trail cho thao tác quản trị. |

Ngoài UC-M01, danh mục không tuyên bố use case nào đã được audit/đóng nghiệm thu. Có implementation không đồng nghĩa COMPLETED.

## Thứ tự đề xuất và dependency

1. UC-M02 → UC-M03 → UC-M04 → UC-M05 → UC-M06.
2. Kiểm chứng phần UC-A01/A02/A03/A06 cần thiết cho quyền KYC, tài khoản và tiền ảo của demo; không bypass quyền để chạy giao dịch.
3. UC-M07 → UC-M09 → UC-M10; phối hợp UC-A05 khi kiểm chứng xử lý phía nhân viên.
4. UC-M08.
5. UC-M11 → UC-M12.
6. UC-A04 phối hợp UC-M13 → UC-M14 → UC-M15 → UC-M16.

Đây là thứ tự đề xuất, cần đối chiếu dependency thực tế khi lập từng task. Savings/Credit giữ mức reference/bonus theo tài liệu lịch sử; đưa vào danh mục không tự nâng thành cam kết nghiệm thu bắt buộc.

## Quy tắc chống mở rộng phạm vi

- Một use case không bắt buộc có chín task như UC-M01. Chỉ tách task khi có lý do cụ thể.
- Migration, Docker, CodeGraph, retry, audit log và test harness không phải use case độc lập trong danh mục này.
- Không thêm chatbot, bill payment, liên ngân hàng, tiền thật, KYC thật hoặc hạ tầng production.
- Tiêu chí đồ án: nghiệp vụ đúng, demo được, dữ liệu đúng, lỗi phổ biến được xử lý, test hợp lý và sinh viên giải thích được.
- Mỗi task cần scope, acceptance và quyền Git rõ; mặc định không stage/commit/push.

## Nguồn lập danh mục

- `mobile-app/README.md` và các màn hình trong `mobile-app/src/features/`.
- `backend/README.md` và `documents/api/banking-mvp.openapi.yaml`.
- `admin-web/README.md`.
- `PROJECT_CONTEXT.md` và biên bản closure UC-M01.

Danh mục dựa trên kiểm tra source/contract và tài liệu, không phải một lần chạy runtime toàn dự án.

## Cập nhật Đợt 2 — Demo ngân hàng cốt lõi (2026-09-08)

- Demo local trên snapshot `3b38cabc39c9254231e5ef0ccb90e2ae278a532f` đã chạy
  được luồng synthetic customer A/B, KYC maker–checker, sandbox funding, Mobile
  login/MFA, internal beneficiary lookup, quote, TOTP step-up và transfer receipt.
- Đối soát PostgreSQL cho thấy A giảm đúng amount + fee, B tăng đúng amount;
  account history và double-entry ledger cân bằng. Lần insufficient-funds không
  tạo ghi sổ một phần.
- Bằng chứng này hỗ trợ UC-M04, UC-M06 và UC-M07 ở mức demo local/reference,
  không tự đóng các use case đó. Replay idempotency cùng payload, negative
  cross-account action và negative maker self-approval chưa có execution evidence
  riêng; cần Owner quyết định có mở lượt kiểm chứng bổ sung hay giữ là giới hạn
  học thuật.
- Hồ sơ chi tiết: `tasks/DEMO/TASK_DOT_2_CORE_BANKING_DEMO.md`. Database demo
  và dịch vụ local được giữ chạy; không có tuyên bố staging, pilot hoặc production
  readiness.

### Cập nhật Đợt 2 — hoàn tất các kiểm tra còn thiếu (2026-09-08)

- Đối soát số dư/ledger đã khớp: A kết thúc `4,498,000 VND`, B kết thúc
  `5,500,000 VND`, ledger CREDIT và DEBIT cùng `15,502,000` trong minor VND.
- Idempotency replay cùng key/payload đạt trên PostgreSQL disposable bằng test
  relational hiện hành; không có side effect transfer/debit/journal thứ hai.
- Cross-account denial đạt qua HTTP + PostgreSQL invariant: customer B không đọc được
  account/transactions của A và nhận `404 NOT_FOUND`; dữ liệu protected không đổi.
- Maker self-approval đạt ở policy/service scope với `SELF_APPROVAL_FORBIDDEN`, và
  checker độc lập vẫn approve/execute đúng một lần.
- Ba tiêu chí bổ sung thuộc Đợt 2 đã có evidence theo đúng tầng kiểm chứng; disposable
  resource đã cleanup, demo DB và local services được giữ nguyên.
- Các trạng thái UC khác không bị tự động đóng; tại thời điểm cập nhật lịch sử này
  Đợt 3 chưa bắt đầu. Hồ sơ chi tiết:
  `tasks/DEMO/TASK_DOT_2_CORE_BANKING_DEMO.md`.

### Owner approval Đợt 2 — 2026-09-08

- Đợt 2 Core Banking Demo: `COMPLETED — OWNER APPROVED` trong phạm vi đồ án học thuật.
- Nghiệm thu giữ rõ hai transfer `500,000` và `5,000,000 VND`, fee `1,000 VND` mỗi
  giao dịch, số dư cuối A `4,498,000` và B `5,500,000`; ledger debit/credit cùng
  `15,502,000` minor VND.
- Idempotency và cross-account được chấp thuận theo evidence service/PostgreSQL và
  HTTP tương ứng; maker self-approval chỉ được tuyên bố ở policy/service scope,
  không phải negative UI E2E.
- Không tự đóng UC-M04+ hoặc use case khác. Điểm tiếp tục là Đợt 3: UI cần thiết,
  setup/deployment, CI/Git evidence, báo cáo/UML/ERD, slides và rehearsal.

## Đợt 3 — chuẩn bị hồ sơ bàn giao (2026-09-08)

Trạng thái: `IN PROGRESS — DRAFT DELIVERABLES`. Đợt 3 chỉ chuẩn bị tài liệu bàn giao
và bảo vệ dựa trên source/evidence hiện có; chưa triển khai cloud, chưa thay đổi source
và chưa đóng thêm use case.

- Entry point: [`README.md`](README.md).
- Kiến trúc/ERD/sequence/phạm vi: `documents/02-design/`.
- Báo cáo, slide, run sheet, checklist, Q&A và evidence index: `documents/08-presentation/`.
- Hồ sơ tổng hợp: [`tasks/DEMO/TASK_DOT_3_PROJECT_HANDOFF.md`](tasks/DEMO/TASK_DOT_3_PROJECT_HANDOFF.md).
- Đợt 2 giữ trạng thái Owner approved theo phạm vi trong
  [`tasks/DEMO/TASK_DOT_2_CORE_BANKING_DEMO.md`](tasks/DEMO/TASK_DOT_2_CORE_BANKING_DEMO.md).

Rubric MHTML local đã đọc được ở mức nhóm sản phẩm, quy trình/công nghệ và báo cáo/
thuyết trình. Checklist XLSX tại đường dẫn Owner cung cấp chưa có; không suy ra điểm.
Các khoảng trống cần Owner chốt gồm mẫu báo cáo, hạn nộp, thời lượng bảo vệ, thông tin
nhóm và deployment requirement. Không coi workflow CI, README hay Compose file là bằng
chứng remote/deployment đã chạy.

# Danh mục use case và điểm tiếp tục — Banking System

Ngày cập nhật: 2026-09-07.

## Đọc khi bắt đầu lại

- Đọc `AGENTS.md`, `PROJECT_CONTEXT.md`, file này và task hiện hành.
- Kiểm tra branch, HEAD và working tree trước khi hành động; các mốc dưới đây là lịch sử, không yêu cầu reset về chúng.
- Dự án là đồ án tốt nghiệp, tập trung vào luồng ngân hàng số và quy trình phê duyệt.
- Danh mục 22 use case dưới đây là đề xuất lập từ chức năng hiện có và được lưu theo yêu cầu Owner. Lưu danh mục không tự cấp quyền triển khai tất cả mục, thay đổi acceptance hoặc quyền Git.
- Không đồng nhất các mã này với milestone cũ M0–M11 hoặc giai đoạn S1–S5.

## Trạng thái và bước tiếp theo

**UC-M01 — Registration và KYC: COMPLETED — OWNER APPROVED.**

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

## Danh mục Use Case toàn diện (Cập nhật 14/10/2026)

> Tài liệu đặc tả chi tiết toàn bộ luồng sự kiện, ngoại lệ, bất biến và đối chiếu code xem tại:  
> [`documents/02-design/use-cases-complete-specification.md`](documents/02-design/use-cases-complete-specification.md).

### 1. Phân hệ Khách hàng Mobile — 17 Use Case (15 Nghiệp vụ + 2 AI)

| Mã | Tên Use Case | Phạm vi chính trong source code | Trạng thái |
| --- | --- | --- | --- |
| UC-M01 | Đăng ký tài khoản & Khai báo định danh (KYC) | Đăng ký EMAIL_OTP, nộp hồ sơ định danh KYC draft/submit; kiểm chứng relational. | COMPLETED — APPROVED |
| UC-M02 | Đăng nhập & Quản lý phiên | Login, refresh rotation, app lock, restore, logout, logout-all. | COMPLETED — APPROVED |
| UC-M03 | Quản lý MFA TOTP & Khôi phục | TOTP enroll/confirm, quản lý methods, xoay recovery codes, khôi phục. | COMPLETED — APPROVED |
| UC-M04 | Xem tài khoản và số dư | Dashboard, account detail, số dư authoritative, mở che số tài khoản. | COMPLETED (Đợt 2 demo) |
| UC-M05 | Tra cứu lịch sử & Chi tiết giao dịch | Danh sách phân trang keyset cursor, bộ lọc, chi tiết biên lai. | COMPLETED (Đợt 2 demo) |
| UC-M06 | Quản lý người thụ hưởng | Xem danh bạ, thêm mới, sửa tên gợi nhớ, xóa người thụ hưởng. | COMPLETED (Đợt 2 demo) |
| UC-M07 | Chuyển tiền nội bộ NOVA | Lookup, quote/phí, TOTP step-up, idempotent submit, double-entry ledger. | COMPLETED — APPROVED (Đợt 2) |
| UC-M08 | Xem và quét QR thông tin tài khoản | Hiển thị/quét QR chuẩn versioned; nhãn UNVERIFIED, không tự chuyển tiền. | IMPLEMENTED |
| UC-M09 | Xem và quản lý thông báo | Danh sách thông báo, đánh dấu đã đọc, deep-link chuyển màn hình. | IMPLEMENTED |
| *UC-M10* | *Báo cáo giao dịch đáng ngờ* | *Đã gỡ bỏ khỏi app, API và OpenAPI theo quyết định D-39 (13/10/2026).* | *RETIRED / GỠ BỎ* |
| UC-M11 | Mở khoản tiền gửi tiết kiệm | Sản phẩm, quote lãi thực tế actual-days, chỉ thị tái tục, step-up, mở sổ. | IMPLEMENTED |
| UC-M12 | Quản lý danh mục & Tất toán tiết kiệm | Danh sách, chi tiết sổ, đổi phương án đáo hạn (PATCH), tất toán trước hạn lãi không kỳ hạn (POST /withdraw), liên kết tái tục. | IMPLEMENTED |
| UC-M13 | Đăng ký & Kích hoạt thẻ tín dụng | Nộp hồ sơ hạn mức, theo dõi xét duyệt, kích hoạt thẻ tín dụng sandbox. | IMPLEMENTED |
| UC-M14 | Quản lý an toàn thẻ tín dụng | Khóa thẻ khẩn cấp (không cần OTP), mở khóa (TOTP), báo mất thẻ. | IMPLEMENTED |
| UC-M15 | Tra cứu thẻ, giao dịch & Sao kê | Hạn mức khả dụng, dư nợ ghi sổ, lịch sử quẹt thẻ, chi tiết sao kê kỳ. | IMPLEMENTED |
| UC-M16 | Thanh toán dư nợ thẻ tín dụng | Quote (tối thiểu, toàn bộ, tùy chọn), trích nợ tài khoản, cấn trừ dư nợ. | IMPLEMENTED |
| **UC-AI-01** | Trợ lý giải đáp NOVA Help | Lọc dữ liệu nhạy cảm, tra cứu FAQ, mô hình AI Radox chọn câu trả lời chuẩn. | IMPLEMENTED |
| **UC-AI-02** | Tư vấn lập kế hoạch tài chính | SAVINGS_PLAN & BUDGET_BALANCE; BigInt calculator + Bounded AI selector. | IMPLEMENTED |

### 2. Phân hệ Vận hành & Quản trị Admin Web — 11 Use Case

| Mã | Tên Use Case | Phạm vi chính trong source code | Trạng thái |
| --- | --- | --- | --- |
| UC-A01 | Xác thực nhân viên & Quản lý phiên | Staff login (Operations/Admin TOTP), HttpOnly cookie + CSRF, timeout. | IMPLEMENTED |
| UC-A02 | Quản lý nhân sự & Phân quyền RBAC | Quản lý Staff, Roles, Permissions, khởi tạo tài khoản vận hành. | IMPLEMENTED |
| UC-A03 | Tra cứu & Kiểm soát tài khoản | Tra cứu masked, yêu cầu khóa/mở khóa truy cập, phong tỏa tài khoản. | IMPLEMENTED |
| UC-A04 | Cấp vốn thử nghiệm & Đảo ngược | Yêu cầu nạp tiền ảo (Simulation funding) và Đảo ngược thu hồi vốn ảo. | COMPLETED (Đợt 2 demo) |
| UC-A05 | Thẩm định & Phê duyệt hồ sơ định danh | Hàng đợi Hồ sơ định danh, Claim tiếp nhận, thẩm định ảnh CCCD và phê duyệt trực tiếp 1 cấp. | COMPLETED (Đợt 2 demo) |
| UC-A06 | Thẩm định & Phê duyệt hồ sơ tín dụng | Hàng đợi Hồ sơ tín dụng, Claim tiếp nhận, thẩm định thu nhập và phê duyệt cấp hạn mức thẻ tín dụng trực tiếp 1 cấp. | IMPLEMENTED |
| UC-A07 | Giám sát & Xử lý sự cố chuyển tiền | Tra cứu transfer timeline, yêu cầu retry, cancel hoặc reversal giao dịch. | IMPLEMENTED |
| UC-A08 | Phê duyệt đa cấp Maker–Checker | Hòm thư Approvals, Four-Eyes Policy (chống tự duyệt), TOTP fresh step-up. | COMPLETED — APPROVED (Đợt 2) |
| UC-A09 | Giám sát Outbox & Dead-Letters | Thống kê gửi tin, xem sự kiện lỗi vĩnh viễn, yêu cầu Requeue gửi lại. | IMPLEMENTED |
| UC-A10 | Giám sát & Thử lại Background Jobs | Danh sách background jobs, xem lịch sử attempts, yêu cầu Retry job lỗi. | IMPLEMENTED |
| UC-A11 | Nhật ký kiểm toán & Xuất báo cáo | Tra cứu audit events (DB trigger chống xóa/sửa), tạo yêu cầu xuất báo cáo. | IMPLEMENTED |

### 3. Phân hệ Hệ thống ngầm tự động (System Worker) — 3 Use Case

| Mã | Tên Use Case | Phạm vi chính trong source code | Trạng thái |
| --- | --- | --- | --- |
| **UC-S01** | Transactional Outbox Dispatcher | Polling lease claim, gửi Email/Push, Exponential Backoff, Dead-Letter. | IMPLEMENTED |
| **UC-S02** | Đáo hạn & Tái tục Tiết kiệm | Tự động tính lãi thực tế, tất toán về tài khoản hoặc mở sổ tái tục, suspense. | IMPLEMENTED |
| **UC-S03** | Chốt sao kê & Quá hạn Thẻ tín dụng | Tự động chốt kỳ sao kê, tính minimum due, đánh giá sao kê nợ quá hạn. | IMPLEMENTED |

---

Ngoài UC-M01, UC-M02, UC-M03 và kịch bản lõi Đợt 2 (UC-M04, UC-M06, UC-M07, UC-A04, UC-A05, UC-A08), các use case khác ở trạng thái IMPLEMENTED sẵn sàng trong source code phục vụ kiểm thử và mở rộng.

## Thứ tự đề xuất và dependency

1. UC-M02 → UC-M03 → UC-M04 → UC-M05 → UC-M06.
2. Kiểm chứng phần UC-A01/A02/A03/A06 cần thiết cho quyền KYC, tài khoản và cập nhật số dư; không bypass quyền để chạy giao dịch.
3. UC-M07 → UC-M09; phối hợp UC-A05 (KYC) khi kiểm chứng xử lý phía nhân viên.
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
  được luồng customer A/B, KYC maker–checker, cấp tiền, Mobile
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

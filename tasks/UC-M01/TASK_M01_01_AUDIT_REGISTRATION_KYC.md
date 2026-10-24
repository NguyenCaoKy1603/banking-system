# TASK M01-01 — Audit Registration và Synthetic KYC

Trạng thái: `COMPLETED`

## 1. Thông tin dự án và quyền truy cập

Tên dự án: Banking System

Repository dự kiến trên Windows: `C:\Projects\banking-system`

Codex phải được mở tại repository thật. Trước khi audit, phải xác nhận:

- Current working directory.
- Git branch.
- Git HEAD.
- `git status`.
- Thay đổi tracked, untracked và WIP hiện có liên quan.

Chỉ có đường dẫn trong task không được xem là bằng chứng đã truy cập repository.

Mục đích dự án: Mobile banking academic/reference sử dụng dữ liệu tổng hợp và tiền ảo. Đây không phải hệ thống xử lý tiền thật, pilot đã xác minh hoặc production-ready.

Tài liệu phải đọc trước:

- `AGENTS.md`
- `PROJECT_CONTEXT.md`
- `mobile-app/AGENTS.md` nếu tồn tại
- `mobile-app/README.md`
- `backend/README.md`
- OpenAPI liên quan dưới `documents/api/`
- Kế hoạch, test và evidence đã redact liên quan đến registration/KYC

## 2. Chế độ làm việc và quyền Git

Chế độ làm việc: `DIAGNOSE_AND_PLAN`

Quyền sửa code: Không.

Quyền ghi tài liệu: Chỉ được cập nhật mục `Audit result` trong chính file task này sau khi audit. Không được tạo hoặc sửa tài liệu khác.

Git add/stage: Không.

Commit: Không.

Push: Không.

Merge/rebase/tag: Không.

Quyền ngoài repository:

- Network hoặc dịch vụ bên thứ ba: Không.
- Deploy/provision/mua hoặc bật dịch vụ: Không.
- Bật worker/scheduler: Không.
- Destructive database operation: Không.
- Khởi tạo hoặc reset database: Không.

Không reset, restore, checkout, clean, xóa, di chuyển hoặc ghi đè WIP hiện có.

Không sửa hoặc làm mất thay đổi của tiến trình khác, bao gồm Maestro YAML đang có WIP nếu vẫn tồn tại.

## 3. Nhiệm vụ

Tên nhiệm vụ: Audit mức độ hoàn thiện của `UC-M01 — Registration và Synthetic KYC`

Mục tiêu:

Xác minh luồng Registration → Synthetic KYC dựa trên source code, OpenAPI, runtime validator, route implementation, persistence và test thực tế.

Audit phải xác định chính xác:

- Phần nào đã được triển khai.
- Phần nào đã có test.
- Phần nào chỉ được mô tả trong tài liệu.
- Phần nào đang thiếu, mâu thuẫn hoặc chưa thể xác minh.
- Những task implementation nào thực sự cần tạo tiếp theo.

Ưu tiên: `P1`

Lý do ưu tiên:

Registration là điểm bắt đầu của hành trình người dùng. Sai lệch giữa UI, API, validation, persistence hoặc KYC có thể khiến tài khoản được tạo sai, tạo trùng, rò rỉ dữ liệu hoặc khiến người dùng không thể tiếp tục sử dụng hệ thống.

## 4. Hành vi và scenario cần kiểm tra

Hành vi hiện tại:

`PROJECT_CONTEXT.md` cho biết hệ thống đã có registration và synthetic KYC. Đây chỉ là snapshot định hướng; Codex phải tự kiểm tra lại source và test hiện tại.

Không được xem chức năng là hoàn thành chỉ vì screen, route hoặc test file tồn tại.

Các scenario phải kiểm tra:

1. Người dùng chưa đăng nhập có thể mở registration.
2. Form validation xử lý dữ liệu thiếu hoặc sai định dạng.
3. Dữ liệu không hợp lệ không gửi request ngoài dự kiến.
4. Registration thành công theo đúng API contract.
5. Thông tin hoặc tài khoản đã tồn tại được xử lý đúng.
6. Server validation error được ánh xạ đúng sang UI.
7. Offline và timeout được xử lý rõ ràng.
8. Người dùng retry không tạo submit đồng thời hoặc tài khoản trùng ngoài dự kiến.
9. Response registration được runtime-validate trước khi dùng.
10. Synthetic KYC nhận và validate dữ liệu đúng contract.
11. Các trạng thái KYC thực tế trong source được lưu và hiển thị đúng.
12. Unauthorized/session behavior được xử lý đúng nếu flow yêu cầu authentication.
13. Đóng hoặc khởi động lại ứng dụng giữa flow không gây state sai.
14. Điều hướng sau registration/KYC đúng với contract hiện hành.
15. Password, token, OTP, device secret và dữ liệu định danh nhạy cảm không xuất hiện trong log, analytics, crash report hoặc evidence.
16. Test hiện có thực sự bao phủ các hành vi được tuyên bố.

Codex phải ghi trạng thái từng scenario theo một trong các giá trị:

- `VERIFIED`
- `PARTIAL`
- `CONFLICT`
- `MISSING`
- `BLOCKED`
- `NOT_APPLICABLE`

`NOT_APPLICABLE` phải có lý do cụ thể.

## 5. Data flow phải truy vết

Codex phải truy vết luồng thực tế, không suy đoán:

```text
Mobile route/screen
→ form validation
→ component/store/state
→ registration/KYC service
→ HTTP client
→ OpenAPI và runtime response validator
→ Backend route
→ Backend validation/service
→ UnitOfWork hoặc persistence
→ database migration/table liên quan
→ response
→ Mobile state
→ UI success/error
```

Với mỗi mắt xích, báo:

- File và symbol liên quan.
- Dữ liệu đầu vào/đầu ra quan trọng.
- Source of truth.
- Error behavior.
- Test liên quan.
- Điểm mâu thuẫn hoặc chưa có bằng chứng.

Không in giá trị credential, token, password, OTP hoặc dữ liệu người dùng thật.

## 6. Phạm vi

Được phép kiểm tra:

- `mobile-app/` trong phạm vi registration, auth session và KYC.
- `backend/` trong phạm vi registration, auth và synthetic KYC.
- Migration liên quan dưới `backend/database/`, chỉ đọc.
- OpenAPI liên quan dưới `documents/api/`.
- Runtime validators.
- Unit, integration và E2E test liên quan.
- `package.json` và cấu hình cần thiết để xác định test command.
- Git metadata và diff liên quan.

Được phép sửa:

- Chỉ mục `Audit result` trong file task này.

Không được thay đổi:

- Source code Mobile.
- Source code Backend.
- Database schema hoặc migration.
- OpenAPI hoặc API response.
- Dependency hoặc lockfile.
- CI.
- Infrastructure.
- Admin Web.
- Observability/performance.
- `AGENTS.md`.
- `PROJECT_CONTEXT.md`.
- `TASK_TEMPLATE.md`.
- Maestro YAML.
- Raw `artifacts/`.

Không được mở, trích xuất, upload, chia sẻ hoặc đóng gói raw artifacts có khả năng chứa password, OTP, token hoặc credential.

## 7. Source of truth và xung đột

Source of truth phải được đối chiếu theo loại:

- Database: migration và migration history/checksum.
- API: OpenAPI, runtime validator và route implementation.
- Mobile behavior: screen, state, service, storage, domain code và test thực thi.
- Trạng thái hiện tại: source tree, Git HEAD, worktree và test vừa chạy.

Nếu source, OpenAPI, runtime validator, test và tài liệu mâu thuẫn:

- Không tự chọn một phía.
- Ghi chính xác file và symbol.
- Giải thích ảnh hưởng.
- Đưa ra các lựa chọn.
- Xác định quyết định cần owner xác nhận.
- Không sửa để đồng bộ trong task audit này.

## 8. Kiểm tra được phép chạy

Trước khi chạy test, Codex phải đọc package scripts và xác nhận lệnh không sửa source, không chạy database destructive và không bật worker/scheduler.

Kiểm tra tối thiểu:

- Xác định tất cả test registration/KYC hiện có.
- Chạy targeted test phù hợp nếu môi trường cho phép.
- Chạy Mobile typecheck nếu không làm thay đổi source.
- Chạy OpenAPI validation liên quan nếu không cần dịch vụ ngoài.
- Kiểm tra Git diff/status sau khi audit.

Không chạy:

- Full release gate không cần thiết.
- Database integration cần reset/provision.
- Worker/scheduler.
- Deploy.
- Test cần credential hoặc dịch vụ thật.
- Test ghi raw evidence nhạy cảm.
- Build/export không liên quan trực tiếp.

Nếu không chạy được test, phải ghi:

- Lệnh định chạy.
- Lý do không chạy được.
- Phần nào vì vậy chưa thể xác minh.
- Không được ghi `PASS` dựa trên evidence cũ.

## 9. Hoàn thành khi

Task hoàn thành khi:

1. Xác nhận repository root, branch, HEAD và worktree.
2. Liệt kê source, contract, migration và test liên quan.
3. Truy vết được data flow Registration → Synthetic KYC.
4. Có bảng trạng thái cho toàn bộ scenario.
5. Mỗi kết luận có file/symbol/test làm bằng chứng.
6. Ghi rõ conflict, missing và blocker.
7. Phân biệt bằng chứng vừa chạy với snapshot/evidence cũ.
8. Đề xuất danh sách task tiếp theo theo thứ tự phụ thuộc.
9. Mỗi task đề xuất chỉ có một kết quả chính.
10. Không sửa source hoặc tài liệu ngoài file task này.
11. Không stage hoặc commit.
12. `git status` cuối phiên không có thay đổi ngoài phạm vi do Codex tạo.

## 10. Yêu cầu bàn giao

Bàn giao bằng tiếng Việt gồm:

1. Repository, branch, HEAD và trạng thái worktree.
2. Các tài liệu/source/test đã đọc.
3. Bản đồ data flow.
4. Bảng scenario và trạng thái.
5. Hành vi đã xác minh.
6. Conflict và nguyên nhân.
7. Test đã chạy, lệnh đầy đủ và kết quả.
8. Phần chưa thể xác minh.
9. Danh sách task tiếp theo được đề xuất.
10. Rủi ro và quyết định cần owner xác nhận.
11. File đã thay đổi.
12. Xác nhận không stage/commit.

## 11. Audit result

### Kết quả audit

- Trạng thái: `COMPLETED`
- Thời điểm: `2026-09-01 22:03:49 +07:00` (`Asia/Bangkok`)
- Chế độ: `DIAGNOSE_AND_PLAN`; không sửa source, migration, OpenAPI, CI hoặc infrastructure.
- Repository: `C:\Projects\banking-system`
- Branch: `codex/staging-academic-completion`
- HEAD: `c64e5f3e1c9dd2f660669948d21c30745c4f778e`
- Worktree trước và sau audit giữ nguyên: `AGENTS.md` đang modified; `PROJECT_CONTEXT.md`, `TASK_TEMPLATE.md` và `tasks/` đang untracked; branch ahead upstream 11 commit. Đây là WIP cần bảo vệ, không được stage/commit/reset/clean.
- File được cập nhật trong phiên: chỉ phần `Audit result` của task này. Không có source file Mobile/Backend nào được tạo hoặc sửa bởi audit.

### Phạm vi và cách phân loại bằng chứng

Audit đối chiếu source hiện tại, OpenAPI, runtime validator, migration, test vừa chạy và evidence đã redact. `VERIFIED` dưới đây nghĩa là mắt xích đó có implementation hiện tại và có bằng chứng kiểm tra phù hợp; không đồng nghĩa với production/staging readiness. Evidence trong `local-completion-evidence-2026-09-01.md` được ghi là evidence lịch sử/đã có, không tính là PASS mới của phiên audit nếu chưa rerun.

Kết luận tổng quát:

- Registration đã có luồng relational-v2 từ pre-auth challenge đến tạo customer/payment account, OTP hash-only, khóa challenge/pending row và cơ chế completion để bảo vệ verify một lần. Contract/API mapping và các gate an toàn hiện tại đạt.
- Synthetic KYC đã có route, service PostgreSQL, trạng thái nghiệp vụ, audit/outbox và Admin decision path. Tuy nhiên Mobile validator, OpenAPI/backend contract và response privacy chưa đồng nhất; UI chưa map đầy đủ lỗi server và chưa có test screen/response-validator đủ sâu.
- Do các xung đột trên, UC-M01 chưa nên được tuyên bố hoàn thiện nghiệp vụ ở mức `VERIFIED` toàn luồng. Mức trung thực hiện tại là `PARTIAL`, với các điểm `CONFLICT` được liệt kê bên dưới.
- Không thể xác minh lại database integration/concurrency hoặc chạy emulator trong phiên này vì task cấm reset/provision database, worker/scheduler, dịch vụ ngoài và test cần credential. Không suy diễn PASS mới từ các kết quả đó.

### Bản đồ data flow thực tế

#### Registration

1. **Route và quyền truy cập Mobile** — `mobile-app/src/app/(auth)/register.tsx` render `RegisterScreen`; `mobile-app/src/app/(auth)/_layout.tsx` khai báo route `register`; `mobile-app/src/app/_layout.tsx` đặt `(auth)` dưới guard `!isAuthenticated`. Registration là pre-auth nên không cần bearer token.
2. **Form và state** — `RegisterScreen` giữ `values`, `errors`, `serverError`, `registrationChallenge` và `registrationOtp` trong React state. `validateRegisterForm` chạy trước request đầu tiên; khi có challenge, các field registration bị khóa và chỉ còn bước nhập OTP/resend.
3. **Service và HTTP client** — `AuthContext` chuyển lời gọi đến `authApi.register`, `verifyRegistrationChallenge` và `resendRegistrationChallenge`. `authApi` gửi đúng các field server cần (`fullName`, `email`, `phoneNumber`, `password`), thêm `X-Device-ID`, và dùng `requestJson` của `mobile-app/src/services/api/httpClient.ts` để timeout, parse lỗi, gắn request ID và runtime-validate response.
4. **Contract và response validator** — `documents/api/banking-mvp.openapi.yaml` và `documents/api/auth-api-contract.md` quy định register trả `202` challenge `EMAIL_OTP/REGISTRATION_EMAIL_VERIFY`; verify trả `201` user sau khi challenge hợp lệ. `authResponseValidators.ts` kiểm tra shape challenge/user trước khi UI dùng. Điểm yếu: validator registration hiện chấp nhận thêm alias `REGISTRATION_VERIFY` và method `OTP`, rộng hơn OpenAPI hiện hành.
5. **Backend route và validation** — `backend/src/http.ts` nhận exact `POST /auth/register`, `POST /auth/register/verify` và resend; relational-v2 route boundary nằm ở `relationalHttpBoundary.ts`. `registrationService.ts` trim/lowercase dữ liệu, validate full name/email/phone/password, rate-limit, kiểm tra customer/pending identity và tạo pending registration.
6. **MFA và persistence** — `PersistentMfaService` sinh OTP ngẫu nhiên, chỉ giữ digest, expiry 5 phút, cooldown/resend/attempt limit, kiểm tra device/purpose/resource/fingerprint và consume một lần. `customerRepository`/migration `007`, `011`, `015`, `018` lưu `pending_registrations`, `auth_challenges` và `registration_completions`; completion khóa pending row `FOR UPDATE`, tạo customer/payment account, audit và outbox trong transaction.
7. **Response và UI** — verify thành công lấy user, trả response đã validate, hiển thị thông báo tạo tài khoản số dư 0 VND và `router.replace("/login")`. Lỗi registration đầu tiên map `ApiError.fieldErrors` vào form; lỗi verify hiển thị thông báo chung.

#### Synthetic KYC

1. **Route và session** — `mobile-app/src/app/kyc.tsx` render `KycScreen`; root navigator chỉ expose route KYC khi authenticated. `KycScreen` lấy `accessToken`, `deviceId`, `refreshAccessToken` từ `AuthContext`, rồi gọi `GET /kyc/application`.
2. **State và UI** — screen giữ `application`, `draft`, `fieldErrors`, `isLoading`, `isSubmitting`, `error`. Có input họ tên, identity number, địa chỉ, URI giấy tờ mẫu `mock://...`, và bắt buộc xác nhận dữ liệu synthetic. Các trạng thái đã có label: `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `NEEDS_MORE_INFO`, `APPROVED`, `REJECTED`; trạng thái đang xử lý/đã duyệt hiển thị read-only và che 4 số cuối identity.
3. **KYC service/HTTP** — `kycApi.ts` trim draft, gọi GET/POST `/kyc/application` và POST `/kyc/application/submit`, rồi chạy `isKycApplicationResponse` trước khi cập nhật state. `httpClient` xử lý bearer/device, timeout, network error, 401 refresh hook và payload lỗi.
4. **Contract và validator** — OpenAPI quy định KYC authenticated, synthetic-only, identity 6–24 chữ số và `documentUri` bắt đầu bằng `mock://` hoặc `synthetic://`. Mobile `kycValidators.ts` lại giới hạn identity 9–12 chữ số và chỉ kiểm tra document URI không rỗng. `kycResponseValidators.ts` chỉ kiểm tra kiểu cơ bản/status; chưa kiểm UUID/date-time/version bắt buộc, chưa cấm field thừa, và chấp nhận full identity number.
5. **Backend/persistence** — `backend/src/http.ts` exact-match route và `requireBearer`; `relationalHttpBoundary.ts` dispatch KYC relational-v2. `kycService.ts` normalize synthetic input, khóa application mở `FOR UPDATE`, tạo/cập nhật DRAFT hoặc SUBMITTED, enforce một application mở bằng partial unique index ở migration `038`, ghi audit/notification/outbox cùng transaction. `adminRepository.ts` claim case và xử lý quyết định bốn mắt, cập nhật version/status, review/audit/notification/outbox.
6. **Response/UI/error** — backend trả wrapper `{application}`; Mobile nạp lại state và hiển thị pending/read-only. UI KYC hiện chỉ ghi lỗi chung; chưa map `ApiError.fieldErrors` về từng field, nhánh lỗi tải lần đầu chưa có nút retry rõ ràng, và thông điệp `REJECTED` đang diễn đạt như `NEEDS_MORE_INFO`.

### Ma trận scenario

| # | Scenario | Trạng thái | Kết luận và bằng chứng |
|---:|---|---|---|
| 1 | Người chưa đăng nhập mở registration | `PARTIAL` | Route, auth guard và link login tồn tại; source cho thấy pre-auth đúng. Chưa có screen test trực tiếp trong Mobile; emulator registration chỉ là evidence đã có từ trước, không rerun trong phiên này. |
| 2 | Registration form xử lý thiếu/sai định dạng | `VERIFIED` | `RegisterScreen` gọi `validateRegisterForm` trước request; `authValidation.test.ts` vừa chạy đạt. Backend `registrationService.ts` còn validate lại ở server. |
| 3 | Dữ liệu không hợp lệ không gửi request ngoài dự kiến | `PARTIAL` | Nhánh client return trước `register()` đã có và validation unit đạt, nhưng không có RegisterScreen test spy để chứng minh không phát sinh HTTP request. Backend verify còn ép kiểu `data.challengeId`/`data.proof` thay vì kiểm tra runtime trước service, có rủi ro malformed body thành lỗi không đúng 422. |
| 4 | Registration thành công đúng API contract | `PARTIAL` | `authApi` gửi đúng body/header; OpenAPI và route exact-match đúng 202/201; response validator được gọi. Chưa rerun PostgreSQL registration transaction hoặc E2E trong phiên này nên chưa xác minh mới toàn bộ persistence-to-UI. |
| 5 | Email/phone/account đã tồn tại xử lý đúng | `CONFLICT` | Customer và pending có pre-check cùng unique index; completion replay có bảo vệ. Tuy nhiên “Thay đổi thông tin đăng ký” chỉ xóa challenge trong Mobile, không gọi cancel/cleanup server; pending cũ có thể làm lần đăng ký lại gặp conflict. Race giữa hai begin có thể rơi vào unique violation nếu chưa map về 409. |
| 6 | Server validation error map đúng UI | `PARTIAL` | Registration initial error map `fieldErrors` vào 5 field. KYC `KycScreen` chỉ đặt lỗi chung, không map `ApiError.fieldErrors` vào field tương ứng; verify OTP cũng chỉ có lỗi chung, phù hợp hơn với lỗi challenge nhưng chưa có test screen. |
| 7 | Offline/timeout rõ ràng | `PARTIAL` | `httpClient` có mã và thông điệp ổn định cho network/timeout/5xx; registration/KYC hiển thị lỗi. KYC initial load chưa có retry rõ ràng ở nhánh lỗi/editable; chưa có screen integration test cho offline/timeout của hai flow. |
| 8 | Retry không tạo submit đồng thời/account trùng | `PARTIAL` | UI disable khi submitting; backend có `FOR UPDATE`, `registration_completions`, unique index và KYC submit idempotent theo application đang mở. Chưa có idempotency key riêng cho registration, challenge/pending cancel chưa hoàn chỉnh, và DB concurrency test hiện không được chạy trong audit do cần database setup. |
| 9 | Registration response runtime-validated | `PARTIAL` | `authApi.register`, verify và resend đều truyền validator vào `requestJson`; auth API test vừa chạy có kiểm response lỗi. Validator registration đang rộng hơn contract (alias purpose/method) nên chưa đủ strict để gọi VERIFIED toàn contract. |
| 10 | Synthetic KYC input/validate đúng contract | `CONFLICT` | Backend/OpenAPI cho identity 6–24 digits và URI `mock://`/`synthetic://`; Mobile chỉ cho 9–12 và chỉ yêu cầu URI không rỗng. Đây là sai khác observable: Mobile có thể chặn input mà server chấp nhận hoặc gửi URI server từ chối. `syntheticDataConfirmed=true` và sample mock URI là đúng hướng. |
| 11 | KYC states được lưu và hiển thị đúng | `PARTIAL` | Backend có 6 trạng thái, row lock, version, partial unique open index; Admin DB test lịch sử bao phủ submit/claim/four-eyes/NEEDS_MORE_INFO. UI hiển thị phần lớn trạng thái nhưng thông điệp REJECTED/NEEDS_MORE_INFO chưa đúng ngữ nghĩa; không có KycScreen test và chưa rerun DB hiện tại. |
| 12 | Unauthorized/session behavior của KYC | `VERIFIED` | OpenAPI đánh dấu authenticated; HTTP exact KYC routes gọi `requireBearer` yêu cầu bearer và `X-Device-ID`; Mobile lấy session/device từ AuthContext. Test route/cutover vừa chạy đạt; chưa có KYC DB integration mới trong phiên. |
| 13 | Đóng/khởi động lại giữa flow không làm sai state | `CONFLICT` | Registration challenge, form và OTP chỉ nằm trong React state, không có SecureStore/AsyncStorage; restart giữa OTP làm mất khả năng resume và có thể để pending challenge trên server. KYC đã lưu committed state server và reload được, nhưng không có local intent/unknown-outcome state rõ ràng. |
| 14 | Điều hướng sau registration/KYC | `PARTIAL` | Registration success route về `/login`; KYC submit giữ trạng thái pending/read-only và nút back gọi `router.back`; Maestro syntax và source đúng. Chưa rerun UI emulator trong phiên, chỉ có evidence local trước đó. |
| 15 | Secret/PII không vào log/telemetry/evidence | `CONFLICT` | OTP không nằm trong DB/outbox và HTTP log được redact; password/token không được ghi vào body log theo source. Nhưng `REGISTRATION_STARTED` audit nhận `rateLimitKey` từ `getRateLimitKey` (có thể là raw IP/network key), KYC `publicApplication` trả full identityNumber và Mobile giữ full number trong state; response schema lại đánh dấu identity là write-only. Cần quyết định/redact trước khi coi privacy claim đạt. |
| 16 | Test bao phủ đúng các claim | `PARTIAL` | Gate vừa chạy: Mobile auth/KYC validator + API `59/59`, TypeScript PASS, OpenAPI Mobile 46 required paths PASS, Maestro syntax 19 flows PASS; Backend relational boundary/cutover/HTTP `19/19`, OpenAPI 54 paths/60 exact guards PASS, `git diff --check` PASS. Còn thiếu Register/KYC screen tests, KYC response-validator tests, current PostgreSQL integration/concurrency và current emulator rerun. |

Không có scenario nào được đánh dấu `NOT_APPLICABLE`; các scenario đều áp dụng cho Registration hoặc Synthetic KYC. Không đánh dấu `BLOCKED` cho toàn audit vì blocker chỉ giới hạn ở các phép kiểm bị task cấm, không ngăn được việc kết luận source/contract.

### Conflict, missing và rủi ro cần owner quyết định

1. **Canonical KYC identity rule:** chọn một chuẩn duy nhất. Khuyến nghị dùng cùng chuẩn OpenAPI/backend hiện tại (6–24 chữ số) rồi cập nhật Mobile, hoặc nếu đồ án muốn 9–12 thì phải đổi cả OpenAPI/backend và test.
2. **KYC response privacy:** quyết định có cần trả identityNumber đầy đủ cho Mobile không. Khuyến nghị response chỉ trả masked value hoặc bỏ field; không để backend `publicApplication` trả full value trong khi OpenAPI ghi `writeOnly`.
3. **Document URI contract:** giữ synthetic-only và enforce giống nhau ở Mobile, OpenAPI, backend; không dùng một chuỗi bất kỳ chỉ vì UI có giá trị.
4. **Registration cancel/retry:** quyết định thêm server-side cancel/expiry cleanup hay đổi UX “Thay đổi thông tin” thành bắt đầu registration mới với thông báo pending rõ ràng; đồng thời map unique race thành 409.
5. **Malformed verify body:** thêm runtime schema check để thiếu/sai kiểu `challengeId`, `method`, `proof` trả 422 thay vì đi vào service bằng type assertion.
6. **KYC error UX:** map field errors, thêm retry cho initial GET và tách đúng thông điệp `REJECTED` với `NEEDS_MORE_INFO`. Quyết định “Lưu bản nháp” có cho phép thiếu field hay đổi label vì contract hiện tại yêu cầu đủ field.
7. **Audit/telemetry redaction:** không lưu raw network/rate-limit key trong audit; xác định danh sách field được phép và test chống leak. Evidence chỉ dùng dữ liệu synthetic/masked.

### Task implementation tiếp theo theo thứ tự phụ thuộc

Mỗi task có một kết quả chính:

1. **M01-02 — Chốt contract Registration/KYC:** một quyết định canonical cho status, identity, document URI và response privacy được ghi nhận.
2. **M01-03 — Đồng bộ KYC contract và validator:** Mobile/OpenAPI/backend chấp nhận đúng cùng một bộ dữ liệu synthetic và response không lộ identity đầy đủ.
3. **M01-04 — Làm cứng Registration retry/validation:** malformed request trả lỗi chuẩn, duplicate race trả 409, và đổi thông tin/cancel không để pending challenge ngoài ý muốn.
4. **M01-05 — Hoàn thiện KYC UX state/error:** field error, retry, rejected/needs-more-info, loading/offline và draft semantics nhất quán.
5. **M01-06 — Bổ sung test Mobile:** có screen tests cho register/KYC, no-unexpected-request, response-validator strictness, retry/unauthorized/restart state.
6. **M01-07 — Chạy lại disposable PostgreSQL an toàn:** migration hiện tại, registration/KYC concurrency, one-winner/idempotency, audit/outbox và restart đều có kết quả mới; chỉ thực hiện bằng database disposable đúng guard.
7. **M01-08 — Rerun E2E emulator:** đăng ký qua capture provider nội bộ, KYC DRAFT → SUBMITTED → decision/read-only, offline/retry và app restart bằng dữ liệu synthetic; lưu evidence đã redact.
8. **M01-09 — Đóng audit UC-M01:** cập nhật scenario matrix/evidence của task sau khi các điểm `CONFLICT/PARTIAL` được kiểm chứng lại.

### Lệnh kiểm tra đã chạy trong phiên audit

- `mobile-app`: `npm test -- --runInBand src/features/auth/services/__tests__/authApi.test.ts src/features/auth/validation/__tests__/authValidation.test.ts src/features/kyc/validation/__tests__/kycValidators.test.ts` → **3 suites, 59/59 tests PASS**.
- `mobile-app`: `npx tsc --noEmit` → **PASS**.
- `mobile-app`: `node scripts/validate-openapi.cjs` → **PASS**, 46 required paths.
- `mobile-app`: `node scripts/validate-maestro.cjs` → **PASS**, 19 flows hợp lệ về cú pháp.
- `backend`: `node --import=tsx --test src/tests/relationalHttpBoundary.test.ts src/tests/relationalHttpCutover.test.ts src/tests/http.test.ts` → **19/19 PASS**.
- `backend`: `node scripts/validate-openapi.cjs` → **PASS**, 54 required paths và 60 exact method/segment guards.
- repository: `git diff --check` → **PASS**.

Không chạy trong phiên này: PostgreSQL integration cần reset/provision, full release gate, worker/scheduler, deploy, SMTP/HTTP provider thật, credential thật và emulator E2E. Các kết quả đó chỉ được tham chiếu là evidence lịch sử đã redact trong tài liệu; không coi là test PASS mới của audit.

### Xác nhận bàn giao

- Hành vi đã xác minh: route/auth guard, client validation, request/response mapping, exact backend routing, KYC authentication guard, relational service/migration shape và các gate an toàn nêu trên.
- Hành vi chưa hoàn toàn xác minh: persistence/concurrency mới nhất, full UI screen behavior, restart giữa registration OTP, KYC error mapping và privacy contract.
- Không có secret, OTP, password, token, số định danh thật hoặc dữ liệu người dùng thật trong kết quả này.
- Không stage, commit, push, merge, tag, reset, clean, xóa hoặc thay đổi source trong phiên audit.

---

## 12. Bổ sung đối soát hiện tại tại thời điểm hoàn tất M01-09 (2026-09-07)

- **Thời điểm**: `2026-09-07 17:25:00 +07:00`
- **Branch**: `codex/staging-academic-completion`
- **HEAD**: `b5ef30cb78eaa43932a2ba14f3989aab6e648994`
- **Nhiệm vụ thực hiện**: M01-09 — Tổng kiểm toán đối soát và đóng Use Case UC-M01.

### Bảng đối soát 16 kịch bản ban đầu từ M01-01 chuyển sang trạng thái hiện tại

Toàn bộ 16 kịch bản ban đầu đã được giải quyết triệt để thông qua chuỗi nhiệm vụ M01-02 đến M01-08:

| # | Kịch bản kiểm thử (Scenario M01-01) | Trạng thái ban đầu (M01-01) | Trạng thái hiện tại (M01-09) | Giải pháp triển khai & Bằng chứng kiểm chứng |
|---:|:---|:---:|:---:|:---|
| 1 | Người chưa đăng nhập mở registration | `PARTIAL` | **VERIFIED** | Route pre-auth trong Expo Router `(auth)/register`. Kiểm chứng qua Jest `RegisterScreen.test.tsx` (test: `shows the registration form when storage is empty`) và Emulator E2E runtime `TASK_M01_08` (`E2E-REG-01`). |
| 2 | Registration form xử lý thiếu/sai định dạng | `VERIFIED` | **VERIFIED** | Client validation `validateRegisterForm` và Server validation trong `registrationService.ts`. Kiểm chứng qua `authValidation.test.ts` và `registrationContract.test.ts`. |
| 3 | Dữ liệu không hợp lệ không gửi request ngoài dự kiến | `PARTIAL` | **VERIFIED** | Client return sớm nếu form không hợp lệ; Backend verify có runtime body guard trả 422 trước service (D-06). Kiểm chứng qua Jest `RegisterScreen.test.tsx` (test: `T-REG-FE-VAL-01`) và `registrationContract.test.ts`. |
| 4 | Registration thành công đúng API contract | `PARTIAL` | **VERIFIED** | API client gọi `/auth/register` (202), verify OTP (201), điều hướng về `/login`. Kiểm chứng qua `registrationRelational.test.ts` (test: `relational registration persists only OTP digest, uses outbox intent and completes once`) và Emulator runtime `TASK_M01_08` (`E2E-REG-01`). |
| 5 | Email/phone/account đã tồn tại xử lý đúng | `CONFLICT` | **VERIFIED** | Pre-check kết hợp unique index PostgreSQL; endpoint `POST /auth/register/cancel` giải phóng pending registration an toàn; race condition trả HTTP 409 (D-07, D-08, D-09). Kiểm chứng qua `registrationRelational.test.ts` (assertion duplicate begin rejected 409 `CONFLICT`) và `registrationContract.test.ts`. |
| 6 | Server validation error map đúng UI | `PARTIAL` | **VERIFIED** | Registration map `fieldErrors` về form; KYC map `fieldErrors` về từng ô nhập liệu (D-14). Kiểm chứng qua Jest tests trong `RegisterScreen.test.tsx` (test: `T-REG-FE-ERR-422`) và `KycScreen.test.tsx` (test: `T-KYC-FE-01`). |
| 7 | Offline/timeout rõ ràng | `PARTIAL` | **VERIFIED** | `httpClient` xử lý mã lỗi mạng ổn định; UI hiển thị thông báo lỗi; màn hình KYC có nút thử lại khi tải thất bại lần đầu (D-14). Kiểm chứng qua `httpClient.test.ts`, `RegisterScreen.test.tsx` (tests: `T-REG-FE-ERR-NETWORK`, `T-REG-FE-ERR-TIMEOUT`) và `KycScreen.test.tsx` (test: `T-KYC-FE-02`). |
| 8 | Retry không tạo submit đồng thời/account trùng | `PARTIAL` | **VERIFIED** | Nút bấm disable khi đang gửi yêu cầu; PostgreSQL khóa dòng `FOR UPDATE`; cancel và completion được thiết kế idempotent. Kiểm chứng qua `RegisterScreen.test.tsx` (test: `T-REG-FE-DBL-01`) và `registrationRelational.test.ts` (concurrent verify race assertion: 1 fulfilled, 1 rejected). |
| 9 | Registration response runtime-validated | `PARTIAL` | **VERIFIED** | `authResponseValidators.ts` chuẩn hóa kiểm tra chặt chẽ theo enum OpenAPI (D-05), loại bỏ alias ngoài contract. Kiểm chứng qua `authResponseValidators.test.ts` và `authApi.test.ts`. |
| 10 | Synthetic KYC input/validate đúng contract | `CONFLICT` | **VERIFIED** | Thống nhất quy tắc CCCD 6–24 chữ số và document URI `mock://` / `synthetic://` ở cả 3 tầng (D-01, D-02). Kiểm chứng qua `kycValidators.test.ts` (test: `uses the canonical identity boundary and document URI schemes`) và `kycRelational.test.ts` (tiêu chí `KYC-03`, `KYC-04`). |
| 11 | KYC states được lưu và hiển thị đúng | `PARTIAL` | **ACCEPTED LIMITATION** | Backend hỗ trợ đầy đủ vòng đời trạng thái; migration 038 partial unique index; UI phân biệt DRAFT, SUBMITTED, NEEDS_MORE_INFO, REJECTED (D-10, D-11, D-14). Kiểm chứng qua `kycRelational.test.ts` (tiêu chí `KYC-01` đến `KYC-12`), `KycScreen.test.tsx` (test: `T-KYC-FE-03`), và Emulator runtime `TASK_M01_08` (`E2E-KYC-01`, `E2E-KYC-02`). Giới hạn KYC-15 được Owner duyệt. |
| 12 | Unauthorized/session behavior của KYC | `VERIFIED` | **VERIFIED** | Endpoints KYC yêu cầu Bearer token và header `X-Device-ID`; Mobile lấy token từ `AuthContext`; 401 tự động refresh single-flight. Kiểm chứng qua HTTP route tests trong `kycContract.test.ts` và `httpClient.test.ts`. |
| 13 | Đóng/khởi động lại giữa flow không làm sai state | `CONFLICT` | **ACCEPTED LIMITATION** | `registrationSessionStorage` lưu metadata phase `BEGIN_UNKNOWN` hoặc `CHALLENGE_RECEIVED`; cho phép khôi phục OTP hoặc reset form an toàn (D-12); server-side cancel giải phóng challenge cũ (D-08, D-09). Nghiệm thu qua Jest `RegisterScreen.test.tsx` (tests: `saves BEGIN_UNKNOWN before calling register()`, `shows OTP field with restored challengeId`, `T-REG-FE-REC-01`), Owner chấp thuận chưa chạy trên emulator runtime. |
| 14 | Điều hướng sau registration/KYC | `PARTIAL` | **VERIFIED** | Registration thành công bấm Alert điều hướng về `/login`; KYC nộp hồ sơ giữ trạng thái "Đang chờ duyệt" (SUBMITTED) và hiển thị ghi chú thẩm quyền. Kiểm chứng trực tiếp trên Emulator runtime `TASK_M01_08` (`E2E-REG-01`, `E2E-KYC-02`). |
| 15 | Secret/PII không vào log/telemetry/evidence | `CONFLICT` | **ACCEPTED LIMITATION** | Response KYC chuyển sang `identityNumberLast4` (D-03); CCCD full được persist ở backend trong cột JSONB `synthetic_payload` (`synthetic_payload.identityNumber`) theo schema nghiệp vụ 038 nhưng là write-only đối với public response (D-04); SecureStore không lưu password/OTP/CCCD (D-12); audit registration dùng keyed fingerprint (D-13); script `validate:public-env` quét 216 file PASS. Owner chấp thuận phân tầng bằng chứng, không cam kết zero leakage tuyệt đối. |
| 16 | Test bao phủ đúng các claim | `PARTIAL` | **VERIFIED** | Bổ sung đầy đủ unit tests, screen tests, contract tests, relational PostgreSQL tests và emulator E2E tests qua M01-03 đến M01-08. Toàn bộ các suite Mobile (51 suites / 373 tests PASS theo M01-06/M01-08) và các suite Backend đạt PASS 100%. |

### Kết luận đối soát M01-01 và Đóng Use Case
- 100% các điểm `CONFLICT` và `PARTIAL` đã được chuyển sang `VERIFIED` hoặc `ACCEPTED LIMITATION` được Owner phê duyệt.
- Chi tiết đối soát 15 quyết định kiến trúc và toàn bộ bằng chứng cổng chất lượng được lưu trữ tại `tasks/UC-M01/TASK_M01_09_AUDIT_AND_CLOSE_UC_M01.md`.
- **Trạng thái Use Case UC-M01**: **COMPLETED** (Chính thức đóng theo phê duyệt của Owner ngày 2026-09-07).

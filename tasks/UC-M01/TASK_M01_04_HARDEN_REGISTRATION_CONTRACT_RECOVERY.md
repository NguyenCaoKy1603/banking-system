# TASK M01-04 — Làm cứng Registration contract và recovery

Trạng thái: IN_PROGRESS — B1A COMMITTED — B1B/B2 NOT IMPLEMENTED
Ưu tiên: P1
Chế độ dự kiến: IMPLEMENT_AND_VERIFY

## 1. Thông tin dự án và quyền truy cập

Tên dự án: Banking System

Repository root thực tế: C:/Projects/banking-system

Mục đích: Mobile banking academic/reference dùng dữ liệu tổng hợp và tiền ảo. Hệ thống không xử lý tiền thật, không phải pilot đã xác minh và chưa được tuyên bố production-ready.

Preflight khi soạn task:

- Current working directory: C:/Projects/banking-system
- Branch: codex/staging-academic-completion
- HEAD: f14e1e53e571ea37b96ecb581a7cc1193b2edf43
- Worktree: sạch tại thời điểm soạn task
- M01-04 chưa được thực hiện; source, OpenAPI, migration, test và cấu hình chưa được sửa bởi task này.

Trước khi implementation, phải kiểm tra lại CWD, branch, HEAD, git status --short --untracked-files=all, diff và WIP. Không được coi snapshot preflight hoặc PROJECT_CONTEXT là bằng chứng thay cho kiểm tra mới.

Tài liệu phải đọc trước khi implementation:

- AGENTS.md
- PROJECT_CONTEXT.md
- TASK_TEMPLATE.md
- mobile-app/AGENTS.md và tài liệu Expo phiên bản đang dùng
- mobile-app/README.md
- backend/README.md
- tasks/UC-M01/TASK_M01_01_AUDIT_REGISTRATION_KYC.md
- tasks/UC-M01/TASK_M01_02_DECIDE_REGISTRATION_KYC_CONTRACT.md
- tasks/UC-M01/TASK_M01_03_SYNC_KYC_CONTRACT_PRIVACY.md
- documents/api/banking-mvp.openapi.yaml
- package.json của backend và mobile-app để xác minh script thực tế

## 2. Chế độ làm việc và quyền Git

Chế độ dự kiến: IMPLEMENT_AND_VERIFY

Quyền sửa: chỉ các file trong allowlist của mục 6 và chỉ trong các symbol/phạm vi được nêu ở task này.

Git stage/add: Không.

Commit: Không.

Push: Không.

Merge, rebase, tag: Không.

Network hoặc dịch vụ bên thứ ba: Không. Chỉ dùng test/unit/HTTP fake và dữ liệu synthetic.

Deploy, provision cloud, secret manager hoặc provider thật: Không.

Bật worker hoặc scheduler: Không.

Database: Không provision, reset, truncate, migrate database thật, truy cập database remote hoặc chạy integration/destructive test. PostgreSQL verification thuộc M01-07.

Dependency và lockfile: Không thêm hoặc nâng dependency. Không sửa package.json để tạo script mới.

Không reset, clean, restore, checkout, xóa, di chuyển hoặc ghi đè WIP có trước. Nếu source cần sửa ngoài allowlist, chuyển task thành BLOCKED và báo chính xác file, symbol, bằng chứng và quyết định cần owner.

## 3. Nhiệm vụ lần này

Tên nhiệm vụ: Làm cứng Registration contract và recovery

Mục tiêu:

Đồng bộ Registration challenge giữa OpenAPI, Backend và Mobile theo method EMAIL_OTP và purpose REGISTRATION_EMAIL_VERIFY; biến malformed verify request thành lỗi 422 có kiểm soát; bảo đảm duplicate registration trả 409; bổ sung cancel server-side đúng device/purpose với tính idempotent; và làm cho restart/retry không tạo challenge hoặc registration trùng, không làm lộ dữ liệu bí mật.

Kết quả quan sát được:

- Registration verify chỉ nhận request đúng shape và method canonical; body sai hoặc thiếu field bị từ chối trước side effect.
- Registration trùng hoặc race conflict được trả 409 theo contract, không tạo customer hoặc payment account trùng.
- Người dùng có challenge pending có thể cancel bằng POST /auth/register/cancel; request được ràng buộc bởi challengeId và X-Device-ID.
- Cancel lặp lại an toàn, không hủy nhầm challenge khác device hoặc purpose và không ảnh hưởng registration đã hoàn thành.
- Sau timeout hoặc app restart, Mobile không tự gửi registration mới khi trạng thái challenge cũ chưa được xác định; chỉ resume hoặc reconcile/cancel theo contract an toàn.
- Không có password, OTP, proof, token, device secret hoặc raw identifier trong response, log, audit payload, test output hay Mobile persistence.

Lý do ưu tiên: Registration là điểm đầu của toàn bộ hành trình khách hàng. Sai contract, duplicate race hoặc recovery không an toàn có thể tạo tài khoản trùng, làm challenge không thể hủy hoặc làm lộ dữ liệu xác thực.

## 4. Hành vi hiện tại và cách tái hiện

Hiện trạng cần xác minh lại ở đầu phiên implementation:

- Backend có route registration begin, verify và resend; verify route hiện phải được kiểm tra vì còn khả năng cast challengeId, method hoặc proof từ body thay vì guard runtime đầy đủ.
- OpenAPI đang dùng VerifyAuthChallengeRequest chung cho registration verify và một consumer auth khác. Registration challenge response có consumer phải được kiểm tra để xác nhận method/purpose canonical; không được thu hẹp schema chung khi chưa quét consumer.
- OpenAPI chưa có path key canonical cho POST /auth/register/cancel; Mobile hiện có nút hủy challenge nhưng cần xác minh có chỉ xóa local state hay đã gọi server.
- RegistrationService và PersistentMfaService đã có các boundary begin/verify/complete/resend; repository có các primitive lock/cancel cần được kiểm tra trước khi thêm service/HTTP wiring.
- Registration state của RegisterScreen hiện chủ yếu nằm trong React state. Phải xác minh lại rằng password, OTP và proof không được persist; nếu challenge state bị mất sau restart thì app phải không tự tạo request mới.
- D-13 yêu cầu audit/rate-limit identifier được loại bỏ khi không cần hoặc chỉ dùng keyed fingerprint đã security-review. M01-04 không được tự thêm secret/config.

Cách tái hiện và kiểm tra:

1. Đọc OpenAPI và tìm mọi $ref của VerifyAuthChallengeRequest, RegistrationChallengeResponse và schema liên quan.
2. Quét route dispatch Backend và gọi HTTP fake với body thiếu field, sai kiểu, method không canonical và route có path thừa.
3. Gọi registration begin hai lần với cùng identity/contact trong fake boundary và mô phỏng hai completion cạnh tranh.
4. Gọi cancel với challenge đúng device, sai device, sai purpose, challenge terminal/expired và registration đã completed.
5. Mô phỏng timeout sau request registration, đóng/mở lại RegisterScreen và kiểm tra không có request begin tự động thứ hai.
6. Chạy các test log/storage redaction với dữ liệu synthetic được tạo trong memory; không in giá trị bí mật trong failure output.

Tần suất: Đây là các boundary và recovery scenario phải được kiểm tra deterministically ở unit/contract/HTTP fake. Race/transaction trên PostgreSQL và UI chạy trên emulator được defer theo mục 15.

Thông báo lỗi an toàn:

- Malformed verify: HTTP 422.
- Duplicate registration conflict: HTTP 409.
- Cancel mismatch hoặc không tồn tại: HTTP 404 với chi tiết đã redact.
- Cancel thành công, lặp lại hoặc challenge đã terminal/expired/cancelled: HTTP 204 No Content.
- Cancel khi registration đã hoàn thành: HTTP 409.

## 5. Môi trường và evidence

Môi trường mục tiêu:

- Windows repository local: HÃY TỰ KIỂM TRA TRONG REPOSITORY khi thực hiện.
- Node: HÃY TỰ KIỂM TRA TRONG REPOSITORY và package manager thực tế.
- Mobile: Expo/React Native phiên bản ghi trong package.json; phải đọc mobile-app/AGENTS.md trước khi viết code.
- Backend: Node HTTP reference runtime và test stack hiện có.
- PostgreSQL/Docker: KHÔNG ÁP DỤNG trong M01-04; xác minh thật thuộc M01-07.
- Android emulator/Maestro: KHÔNG ÁP DỤNG trong M01-04; xác minh thuộc M01-08.

Evidence tại thời điểm tạo task:

- Implementation evidence: CHƯA CÓ — task chưa được thực hiện.
- HTTP fake/unit evidence mới: CHƯA CÓ.
- Database/race/transaction evidence: CHƯA CÓ trong M01-04; chuyển M01-07.
- Emulator/Maestro/restart UI evidence: CHƯA CÓ trong M01-04; chuyển M01-08.
- Staging/production evidence: KHÔNG ÁP DỤNG cho task này.
- Evidence phải gắn branch, HEAD, lệnh, environment và kết quả; không đính kèm raw log/artifact có dữ liệu nhạy cảm.

## 6. Phạm vi và allowlist

Được phép kiểm tra:

- OpenAPI, runtime route, registration/MFA service, repository boundary và test hiện có trong Backend.
- Auth types, API service, response validator, AuthContext, RegisterScreen và test hiện có trong Mobile.
- package.json để xác định command; Git metadata, diff và WIP.
- Migration/schema chỉ đọc để phát hiện liệu contract hiện tại đã đủ hay chưa; không chạy database.

Được phép sửa khi M01-04 được owner phê duyệt:

OpenAPI:

- documents/api/banking-mvp.openapi.yaml — chỉ các registration operation/schema cần cho begin, verify, resend, cancel và flow-specific request/response; không thay đổi Admin contract hoặc auth flow khác.

Backend:

- backend/src/http.ts — readJson, getRateLimitKey và các registration route dispatch branch; chỉ validation, exact route, cancel và redaction thuộc Registration.
- backend/src/database/registrationService.ts — RelationalRegistrationService.begin, verify, complete và cancel/recovery boundary cần thiết.
- backend/src/mfa/persistentMfaService.ts — createEmailChallenge, verifyChallenge, resendRegistrationChallenge và registration cancellation/recovery boundary cần thiết.
- backend/src/database/repositories/customerRepository.ts — findCustomerByEmail, findCustomerByPhone, createPendingRegistration, lockPendingRegistration, consumePendingRegistration hoặc primitive registration tương đương đã xác minh.
- backend/src/database/repositories/mfaRepository.ts — lockChallenge, cancelChallenge, cancelActiveChallenges và primitive challenge status đã xác minh; không sửa nghiệp vụ MFA ngoài Registration.

Mobile:

- mobile-app/src/features/auth/types/auth.ts — Registration-specific type/contract; không thu hẹp global login/recovery/biometric type nếu chưa có consumer scan và regression.
- mobile-app/src/features/auth/services/authApi.ts — register, verifyRegistrationChallenge, resendRegistrationChallenge và cancelRegistration.
- mobile-app/src/features/auth/services/authResponseValidators.ts — isRegistrationChallengeResponse và validator theo Registration; không đổi global helper ngoài bằng chứng scan.
- mobile-app/src/features/auth/context/AuthContext.tsx — AuthContextValue và wrapper cancel/reconcile chỉ khi kiến trúc hiện tại cần expose service này.
- mobile-app/src/features/auth/screens/RegisterScreen.tsx — handleRegister, handleResendRegistrationChallenge và cancel/recovery UI/state trong phạm vi Registration.

Test:

- backend/src/tests/registrationContract.test.ts — test mới hoặc test contract tập trung cho Backend Registration, HTTP fake, malformed body, duplicate conflict, cancel, redaction và global-enum regression.
- mobile-app/src/features/auth/services/__tests__/authApi.test.ts — request path, header, body và 204 handling.
- mobile-app/src/features/auth/services/__tests__/authResponseValidators.test.ts — Registration method/purpose canonical và negative alias tests; chỉ tạo nếu inventory xác nhận chưa có file tương đương.
- mobile-app/src/features/auth/context/__tests__/AuthContext.test.tsx — cancel/reconcile wrapper nếu AuthContext bị sửa.
- mobile-app/src/features/auth/screens/__tests__/RegisterScreen.test.tsx — test screen cho cancel, retry/restart guard và không gửi request trùng; sử dụng test stack hiện có, không thêm dependency.

File task:

- tasks/UC-M01/TASK_M01_04_HARDEN_REGISTRATION_CONTRACT_RECOVERY.md — sau implementation chỉ được cập nhật trạng thái và Decision result.

Các file trên là allowlist dự kiến. Nếu cần sửa file khác, kể cả backend/src/database/index.ts, httpClient, package.json, lockfile, migration, env hoặc config, phải dừng và chuyển BLOCKED; không tự mở rộng allowlist.

## 7. File tuyệt đối không được sửa

- AGENTS.md
- PROJECT_CONTEXT.md
- TASK_TEMPLATE.md
- tasks/UC-M01/TASK_M01_01_AUDIT_REGISTRATION_KYC.md
- tasks/UC-M01/TASK_M01_02_DECIDE_REGISTRATION_KYC_CONTRACT.md
- tasks/UC-M01/TASK_M01_03_SYNC_KYC_CONTRACT_PRIVACY.md
- Mọi file KYC thuộc M01-03 trừ khi owner tạo task mới cho thay đổi đó.
- Mọi file Admin Web và Admin API.
- backend/database/*.sql và migration history.
- backend/src/database/index.ts hoặc repository wiring ngoài allowlist.
- CI workflow, Docker, infrastructure, observability, worker, scheduler và release artifact.
- package.json, lockfile, node_modules, dist, .env, secret registry và cấu hình secret.
- mobile-app/e2e, Maestro YAML, screenshots, video và raw artifacts.
- Core banking, payment rail, email/SMS provider thật và cloud resource.

Không sửa global login, recovery hoặc biometric enum chỉ để làm Registration pass. Không thêm endpoint reconcile mới nếu chưa có contract owner; nếu recovery yêu cầu endpoint chưa tồn tại, dừng và báo blocker thay vì tự phát minh path.

## 8. Source of truth và xử lý xung đột

Phân loại source of truth:

- Database: migration và migration history/checksum; M01-04 chỉ đọc, M01-07 xác minh disposable PostgreSQL.
- API: documents/api/banking-mvp.openapi.yaml, runtime validator, route implementation và test contract. Path key OpenAPI của cancel là /auth/register/cancel; không tự thêm /api/v1 vào OpenAPI. Prefix runtime phải lấy từ API_PREFIX/config đã xác minh.
- Mobile: auth types, API service, validator, context, screen, storage boundary và test thực thi.
- Evidence: source tree, test vừa chạy, branch/HEAD/environment; không dùng snapshot cũ thay cho evidence mới.

Nếu code, OpenAPI, test hoặc migration mâu thuẫn:

1. Ghi file, symbol, consumer và bằng chứng.
2. Dừng trước thay đổi có thể phá contract.
3. Nếu shared schema có consumer ngoài Registration, ưu tiên flow-specific schema trong cùng OpenAPI.
4. Nếu cần sửa Admin runtime hoặc Admin contract, chuyển BLOCKED và báo owner.
5. Không tự giữ alias ngoài canonical chỉ vì tương thích ngầm.

## 9. Decision ownership và giới hạn

M01-04 sở hữu:

- Registration slice của D-05: method EMAIL_OTP và purpose REGISTRATION_EMAIL_VERIFY; chỉ áp dụng cho Registration challenge.
- D-06: verify body thiếu hoặc sai field trả 422 trước side effect.
- D-07: duplicate registration race/conflict trả 409 theo contract; không tạo bản ghi trùng.
- D-08: canonical POST /auth/register/cancel.
- D-09: cancel yêu cầu challengeId và X-Device-ID, ràng buộc device/purpose, idempotent và không ảnh hưởng completed registration.
- D-12: registration recovery/restart không persist password, OTP hoặc proof; không tự tạo request mới khi challenge cũ chưa xác định.
- D-13: identifier audit/rate-limit được loại bỏ nếu không cần; nếu bắt buộc thì chỉ tiếp tục sau owner/security decision về keyed fingerprint hoặc server-side secret.

Không sở hữu:

- D-10, D-11, D-14, D-15.
- KYC request/response/privacy đã hoàn tất trong M01-03.
- PostgreSQL migration, concurrency evidence và transaction proof của M01-07.
- Emulator, Maestro và restart/resume UI evidence của M01-08.
- M01-05 KYC UI/error và M01-06 coverage còn thiếu.

## 10. Current và expected data flow

### Current registration begin

Mobile RegisterScreen.handleRegister
→ AuthContext registration wrapper
→ authApi.register
→ HTTP POST /auth/register với X-Device-ID
→ Backend readJson/registration dispatch
→ RelationalRegistrationService.begin
→ customer/pending registration boundary và PersistentMfaService.createEmailChallenge
→ response RegistrationChallengeResponse
→ Mobile registrationChallenge state và chuyển sang OTP UI.

Điểm cần làm cứng: request/body runtime guard, canonical challenge method/purpose, duplicate mapping, privacy của audit/rate-limit identifier và behavior khi response/timeout không xác định.

### Current verify

Mobile nhập proof tại RegisterScreen
→ authApi.verifyRegistrationChallenge
→ HTTP POST /auth/register/verify
→ Backend route đọc body
→ RelationalRegistrationService.verify
→ PersistentMfaService.verifyChallenge
→ RelationalRegistrationService.complete
→ response/session hoặc lỗi.

Điểm cần làm cứng: không cast mù field, không gọi service khi body malformed, chỉ nhận method canonical của Registration, không trả secret trong lỗi và không tạo completion trùng.

### Current cancel/restart

Nút hủy hiện có thể chỉ xóa registrationChallenge local và proof local
→ không bảo đảm challenge/pending server-side đã bị hủy.

Khi app restart hoặc request timeout, local challenge có thể mất hoặc không xác định
→ không được tự gọi registration begin lần nữa
→ cần resume bằng metadata tối thiểu đã security-review hoặc hiển thị recovery/cancel an toàn theo contract.

### Expected flow

Registration begin:

Form hợp lệ
→ API gửi request đúng contract
→ Backend validate trước side effect
→ kiểm tra duplicate/lock boundary
→ tạo pending/challenge canonical
→ response không chứa secret
→ Mobile lưu chỉ state tối thiểu cần cho màn hình.

Registration verify:

Request có challengeId, method canonical và proof đúng kiểu
→ runtime validator
→ kiểm tra challenge/device/purpose server-side
→ verify one-time
→ complete idempotent boundary
→ session/response an toàn hoặc lỗi đã map.

Registration cancel:

Người dùng chọn hủy
→ Mobile gửi POST /auth/register/cancel với challengeId và X-Device-ID
→ Backend validate body/header
→ khóa/kiểm tra đúng challenge và pending registration, đúng device và purpose
→ chuyển trạng thái cancel an toàn hoặc nhận diện terminal
→ trả 204 không body; mismatch trả 404 redact; completed trả 409
→ Mobile chỉ xóa local challenge state sau khi nhận kết quả an toàn hoặc đã reconcile theo policy.

Restart/retry:

App mở lại
→ đọc state tối thiểu nếu có và không chứa password/OTP/proof
→ nếu challenge state rõ thì resume hoặc cancel
→ nếu không rõ thì không tạo request mới; thực hiện reconcile/cancel được contract cho phép hoặc báo người dùng bắt đầu lại sau khi trạng thái server đã xác định
→ request retry dùng cùng intent/challenge, không tạo duplicate.

## 11. Canonical contract và behavior

### 11.1 Registration challenge

- Registration challenge response dùng method EMAIL_OTP.
- Registration challenge response dùng purpose REGISTRATION_EMAIL_VERIFY.
- Runtime Registration validator chỉ nhận enum canonical trong OpenAPI.
- Alias cũ hoặc method khác chỉ bị loại trong Registration flow; global login/recovery/biometric helper giữ nguyên nếu consumer scan không cho phép thay đổi.
- Nếu VerifyAuthChallengeRequest đang dùng chung cho /auth/register/verify và /auth/verify, phải tạo schema request theo Registration trong cùng OpenAPI hoặc dùng validator theo flow. Không sửa contract /auth/verify chỉ để Registration pass.

### 11.2 Verify request

Request canonical cần có đúng các field bắt buộc đã được OpenAPI xác nhận, gồm challengeId, method và proof theo shape thực tế của repository.

- Thiếu field, sai kiểu, method không canonical hoặc body không phải object trả 422.
- Validation xảy ra trước gọi service, ghi ledger, tạo session, ghi audit/outbox hoặc thay đổi challenge.
- proof chỉ được xử lý trong memory/secure boundary cần thiết; không trả lại, không log và không đưa vào failure message.
- Response thành công và lỗi không chứa password, OTP, proof, token, device secret hoặc raw identifier.

### 11.3 Duplicate registration

- Duplicate đã tồn tại hoặc conflict từ pending registration phải map thành 409 theo cùng contract.
- Hai request cạnh tranh không được tạo hai customer, hai pending completion hoặc hai payment account.
- M01-04 chỉ chứng minh mapping và behavior bằng unit/HTTP fake; row lock, unique constraint, transaction và race thật chuyển M01-07.

### 11.4 POST /auth/register/cancel

OpenAPI path key canonical: /auth/register/cancel.

Request:

- Method POST.
- Body là object có challengeId.
- Header bắt buộc X-Device-ID.
- Purpose được xác định từ challenge server-side; client không được dùng body để hủy purpose khác.

Response:

| Tình huống | HTTP status | Body |
| ---------- | ----------- | ---- |
| Cancel thành công | 204 | Không có |
| Cancel lặp lại hoặc challenge terminal/expired/cancelled | 204 | Không có |
| Body hoặc header malformed | 422 | Không có dữ liệu nhạy cảm |
| Challenge không tồn tại hoặc sai device/purpose | 404 | Chi tiết đã redact |
| Registration đã hoàn thành | 409 | Không có dữ liệu nhạy cảm |

Cancel phải idempotent, chỉ tác động challenge/pending đúng device và purpose, không hủy challenge khác và không làm thay đổi registration đã hoàn thành. Mobile chỉ xóa local state sau khi response/reconcile an toàn.

### 11.5 Restart, retry và recovery

- Không persist password, OTP hoặc proof trong Mobile, response, log, audit hoặc recovery metadata.
- Không tự tạo request begin mới khi challenge cũ đang ở trạng thái unknown.
- Chỉ persist metadata tối thiểu không phải secret khi security review của task xác nhận cần thiết; nếu chưa có quyết định an toàn, không persist metadata mới và dùng recovery/cancel contract hiện có.
- Retry timeout phải giữ intent/challenge hiện có; không dùng retry để tạo challenge mới.
- Nếu repository chưa có server-side reconcile phù hợp và không thể đạt behavior an toàn bằng allowlist, task phải BLOCKED; không tự thêm endpoint hoặc migration.

### 11.6 D-13 identifier

- Nếu rate-limit/audit identifier không cần cho behavior, loại bỏ khỏi payload hoặc dùng thông tin đã redact.
- Không lưu raw IP, email, phone, challenge proof hoặc full identifier.
- Không dùng unkeyed hash của IP/email/phone.
- Nếu bắt buộc keyed fingerprint, phải dừng và xin owner quyết định về secret/config server-side. M01-04 không tự thêm key, secret, env hoặc EXPO_PUBLIC_*.

### 11.7 Mandatory checkpoint gates

Task M01-04 được chia thành hai checkpoint bắt buộc. Không được gộp hoặc bỏ qua checkpoint.

Checkpoint A sở hữu:

- Registration slice D-05: method EMAIL_OTP và purpose REGISTRATION_EMAIL_VERIFY.
- D-06: runtime validation 422 cho verify body malformed/thiếu field/sai kiểu/method không canonical.
- D-07: duplicate/conflict mapping 409 cho registration trùng hoặc race conflict.

Sau khi hoàn tất Checkpoint A:

1. Chạy tất cả test/gate thuộc Checkpoint A (OpenAPI contract, 422 negative, 409 duplicate/conflict, regression consumer scan).
2. Ghi evidence: branch, HEAD, lệnh, kết quả, diff.
3. Chuyển trạng thái task thành: IN_PROGRESS — CHECKPOINT A AWAITING OWNER REVIEW.
4. Dừng. Không bắt đầu Checkpoint B.
5. Không stage, commit hoặc push nếu owner chưa cho phép riêng.

Checkpoint B chỉ được bắt đầu sau khi owner xác nhận GO cho Checkpoint A. Checkpoint B sở hữu:

- D-08: canonical POST /auth/register/cancel path và OpenAPI.
- D-09: cancel yêu cầu challengeId và X-Device-ID, ràng buộc device/purpose, idempotent, response 204/422/404/409.
- D-12: registration recovery/restart không persist secret, không tự tạo request mới khi challenge unknown.
- D-13: identifier audit/rate-limit loại bỏ hoặc keyed fingerprint sau owner decision.

Nếu Checkpoint B phát hiện blocker (cần migration, endpoint mới, secret, config hoặc file ngoài allowlist), chuyển BLOCKED trước khi sửa source của Checkpoint B.

### 11.8 Cancel precedence

Thứ tự canonical xử lý cancel request:

1. Nếu registration đã completed: trả 409 và không thay đổi dữ liệu. Completed registration không bao giờ bị generic terminal handling biến thành 204.
2. Nếu registration chưa completed nhưng challenge đã cancelled/expired/terminal: trả 204 idempotent.
3. Nếu challenge không tồn tại hoặc sai device/purpose: trả 404 với chi tiết đã redact.
4. Malformed body/header: trả 422 trước mọi side effect.

Test bắt buộc phải chứng minh rằng completed registration không bị generic terminal handling biến thành 204. Cụ thể: khi gọi cancel cho một registration đã completed mà challenge cũng ở trạng thái terminal, kết quả phải là 409 chứ không phải 204.

### 11.9 Restart/recovery feasibility gate

Trước khi sửa source thuộc Checkpoint B (D-12 recovery/restart), phải thực hiện inventory sau và ghi kết quả vào Decision result:

1. Existing Mobile storage boundary: xác định chính xác những gì RegisterScreen/AuthContext/SecureStore/AsyncStorage hiện persist và những gì chỉ nằm trong React state.
2. Metadata hiện được persist: liệt kê field, storage key, scope và lifecycle.
3. Existing Backend cancel/reconcile primitive: liệt kê method/function trong RegistrationService, PersistentMfaService và repository đã có sẵn cho cancel, lookup challenge status và reconcile.
4. Repository/service wiring cần thiết: xác định liệu recovery flow có thể đạt được chỉ bằng allowlist hiện tại hay cần file/symbol ngoài phạm vi.

Nếu inventory cho thấy không thể đạt recovery an toàn bằng allowlist hiện tại:

- Chuyển BLOCKED trước khi sửa source Checkpoint B.
- Không tự thêm endpoint, storage adapter, migration hoặc config.
- Không dùng React state unit test để tuyên bố đã chứng minh app restart recovery. React state bị mất khi process bị kill; chỉ test React state chứng minh behavior trong cùng session, không phải cross-restart.
- Emulator restart evidence thuộc M01-08 và không được dùng để thay thế cho inventory này.

### 11.10 D-13 rate-limit safety

Các ràng buộc bắt buộc cho D-13 identifier audit/rate-limit:

- Không được tắt, bypass hoặc hạ threshold rate limiting trong bất kỳ trường hợp nào.
- Loại bỏ identifier khỏi audit/log không được làm mất security control. Nếu rate limiter đang dùng identifier để enforce limit, phải bảo đảm enforcement vẫn hoạt động sau khi loại bỏ identifier khỏi log/audit payload.
- Không dùng raw identifier (IP, email, phone), unkeyed hash hoặc hard-coded key làm rate-limit key.
- Nếu rate limiter bắt buộc cần stable identifier để enforce chính xác, chuyển BLOCKED và xin owner quyết định về keyed fingerprint hoặc server-side secret. Không tự thêm env, config, dependency, EXPO_PUBLIC_* hoặc secret.
- Test phải chứng minh: (a) rate limiter vẫn enforce sau thay đổi D-13, (b) identifier không xuất hiện dạng raw trong log/audit/response, (c) không có unkeyed hash hoặc hard-coded key.

## 12. Kế hoạch implementation

Implementation tuân thủ hai checkpoint bắt buộc (xem 11.7). Không được gộp checkpoint hoặc bắt đầu B khi A chưa được owner review.

### Checkpoint A — Registration contract, 422/409 và regression

1. Preflight lại CWD, branch, HEAD, status, diff, WIP và package scripts; ghi baseline trong Decision result.
2. Quét toàn bộ OpenAPI $ref và consumer của VerifyAuthChallengeRequest, RegistrationChallengeResponse, AuthChallengeMethod/AuthChallengePurpose; lập danh sách endpoint Public/Admin bị ảnh hưởng.
3. Viết hoặc mở rộng negative contract tests trước khi đổi route: malformed body, wrong type, alias, path thừa, no side effect và no sensitive error.
4. Đồng bộ OpenAPI registration schema/path; nếu schema dùng chung thì tạo flow-specific schema, không đổi Admin hoặc global auth contract.
5. Thêm Backend runtime guard cho verify; đảm bảo 422 xảy ra trước service side effect và route exact-match.
6. Chuẩn hóa Registration challenge method/purpose ở service/validator; giữ các enum global ngoài phạm vi nếu consumer scan yêu cầu.
7. Xử lý duplicate conflict mapping ở RegistrationService/fake boundary; không thay migration hoặc claim đã chứng minh race thật.
8. Chạy test/gate thuộc Checkpoint A: OpenAPI validator, 422 negative, 409 duplicate/conflict, consumer regression, lint, typecheck, build.
9. Ghi evidence Checkpoint A: branch, HEAD, lệnh, kết quả, diff.
10. Chuyển trạng thái: IN_PROGRESS — CHECKPOINT A AWAITING OWNER REVIEW.
11. Dừng. Không bắt đầu Checkpoint B. Không stage/commit nếu owner chưa cho phép.

### Checkpoint B — Cancel, restart/recovery và D-13 (chỉ sau owner GO)

12. Thực hiện restart/recovery feasibility inventory theo 11.9; ghi kết quả. Nếu không đạt, chuyển BLOCKED.
13. Thực hiện cancel server-side với device/purpose binding, idempotency và response tuân thủ cancel precedence (11.8); đảm bảo completed registration trả 409 chứ không phải 204.
14. Cập nhật Mobile type/API/validator/context/screen trong allowlist; chỉ xóa local state sau kết quả cancel/reconcile an toàn.
15. Đánh giá D-13 theo ràng buộc 11.10. Nếu không cần identifier thì loại bỏ. Nếu cần keyed fingerprint/server-side secret thì dừng BLOCKED và báo owner. Không tắt, bypass hoặc hạ threshold rate limiting.
16. Bổ sung test cho mọi symbol đã thay đổi, bao gồm: cancel precedence (completed → 409, không phải 204), screen/service spy, log/storage redaction, rate-limit enforcement sau D-13.
17. Chạy quality gates theo mục 15, kiểm tra diff/status và ghi đầy đủ Decision result. Không chạy PostgreSQL hoặc emulator.

## 13. Acceptance criteria quan sát được

### Checkpoint A

- [ ] OpenAPI có contract registration canonical; không tự thêm /api/v1 vào OpenAPI.
- [ ] Toàn bộ $ref consumer của schema liên quan đã được quét; endpoint ngoài Public Registration không đổi contract; Admin runtime/contract không bị sửa.
- [ ] Registration challenge response và flow validator chỉ nhận EMAIL_OTP và REGISTRATION_EMAIL_VERIFY; global login/recovery/biometric enum không bị thu hẹp ngoài bằng chứng regression được owner chấp nhận.
- [ ] Verify body malformed, thiếu field, sai kiểu hoặc method không canonical trả 422 trước mọi side effect.
- [ ] Duplicate registration và fake concurrent conflict trả 409; không tạo completion/customer/account thứ hai trong fake boundary được test.
- [ ] Test/gate Checkpoint A đã PASS; evidence được ghi với branch, HEAD, lệnh và kết quả.
- [ ] Trạng thái chuyển IN_PROGRESS — CHECKPOINT A AWAITING OWNER REVIEW trước khi bắt đầu B.

### Checkpoint B (chỉ sau owner GO)

- [ ] Restart/recovery feasibility inventory (11.9) đã hoàn tất và ghi kết quả; nếu không đạt thì đã chuyển BLOCKED.
- [ ] OpenAPI có path key /auth/register/cancel.
- [ ] POST /auth/register/cancel yêu cầu challengeId và X-Device-ID, kiểm tra đúng device/purpose, idempotent và có response 204/422/404/409 đúng bảng contract.
- [ ] Cancel precedence (11.8) được tuân thủ: completed registration trả 409 chứ không phải 204; test chứng minh rõ ràng.
- [ ] Cancel mismatch không tiết lộ challenge/device/purpose; cancel không ảnh hưởng registration đã hoàn thành.
- [ ] Mobile không tự begin request mới khi challenge state unknown sau timeout/restart; cancel/reconcile chỉ được gọi theo intent/challenge đã xác định.
- [ ] Không persist password, OTP hoặc proof; không có secret hoặc raw identifier trong response, log, audit payload, snapshot, test failure output hay Mobile persistence.
- [ ] D-13 được xử lý bằng loại bỏ identifier hoặc có owner/security decision keyed fingerprint; không có hard-code key, unkeyed hash, secret mới hoặc EXPO_PUBLIC_*.
- [ ] D-13 rate-limit safety (11.10): rate limiter vẫn enforce sau thay đổi; không tắt, bypass hoặc hạ threshold; không dùng raw identifier, unkeyed hash hoặc hard-coded key.
- [ ] React state unit test không được dùng để tuyên bố đã chứng minh app restart recovery; emulator restart evidence thuộc M01-08.

### Chung (cả hai checkpoint)

- [ ] Mọi code source thay đổi đều có unit/contract/screen test tương ứng trong allowlist; test kiểm tra behavior và payload thực tế, không chỉ kiểm tra mock đã được gọi.
- [ ] Không có migration, dependency, config, Admin, CI, infrastructure, worker hoặc scheduler thay đổi.
- [ ] Backend và Mobile lint/typecheck/build/test/OpenAPI gates phù hợp đều PASS; diff --check PASS.
- [ ] PostgreSQL disposable/race/transaction/idempotency chưa được tuyên bố trong M01-04 và được gắn M01-07; emulator/Maestro/restart UI chưa được tuyên bố và được gắn M01-08.

## 14. Test matrix và negative regression

### Checkpoint A test

| Khu vực | Scenario | Loại test | Kết quả bắt buộc |
| -------- | -------- | --------- | ---------------- |
| OpenAPI | Parse toàn bộ $ref và liệt kê mọi consumer của schema Registration/Verify | Contract test | Không có consumer ẩn; schema dùng chung không bị thu hẹp ngoài Registration |
| OpenAPI | So sánh path, method, request/response của endpoint ngoài Registration | Regression contract | Không đổi Public endpoint ngoài phạm vi và không đổi Admin contract |
| Backend HTTP | Verify body thiếu challengeId, method hoặc proof | HTTP fake | 422, service không được gọi, không có side effect |
| Backend HTTP | Verify field sai kiểu, method alias hoặc method ngoài canonical | HTTP fake | 422, lỗi redact, không gọi completion |
| Backend HTTP | Verify route có path thừa | HTTP fake | Không dispatch nhầm vào route Registration |
| Backend service | Duplicate existing/pending và conflict mapping | Unit/fake | 409 deterministic, không tạo completion/customer/account thứ hai trong fake boundary |

### Checkpoint B test (chỉ sau owner GO)

| Khu vực | Scenario | Loại test | Kết quả bắt buộc |
| -------- | -------- | --------- | ---------------- |
| Backend cancel | Cancel đúng challenge/device/purpose | HTTP fake/unit | 204 No Content |
| Backend cancel | Cancel lặp lại, expired, cancelled hoặc terminal (challenge KHÔNG thuộc completed registration) | HTTP fake/unit | 204 No Content, không side effect ngoài trạng thái đã terminal |
| Backend cancel | Sai device, sai purpose hoặc challenge không tồn tại | HTTP fake/unit | 404 đã redact, không hủy nhầm |
| Backend cancel | Registration đã completed (cancel precedence 11.8) | HTTP fake/unit | 409 chứ không phải 204; không thay đổi registration completed |
| Backend cancel | Completed registration có challenge terminal — cancel precedence | HTTP fake/unit | 409; chứng minh completed check ưu tiên hơn generic terminal → 204 |
| Mobile API | Cancel path, X-Device-ID, body và 204 parsing | Service contract | Payload/header đúng; response không yêu cầu body |
| Mobile validator | Canonical method/purpose được nhận; alias bị từ chối trong Registration | Unit | Không làm thay đổi global validator ngoài phạm vi |
| RegisterScreen | Cancel chỉ xóa local state sau response/reconcile an toàn | Screen test | Service spy kiểm tra thứ tự và payload |
| RegisterScreen | Timeout/restart với challenge unknown | Screen/service test | Không tự gửi begin request mới |
| RegisterScreen | Retry cùng intent/challenge | Screen/service test | Không sinh duplicate request |
| Privacy | Error/log/serialization capture với synthetic identity/contact/proof | Unit/contract | Không có giá trị nhạy cảm trong output/failure message |
| D-13 | Rate limiter enforcement sau loại bỏ identifier | Unit/contract | Rate limiter vẫn enforce; không tắt, bypass hoặc hạ threshold |
| D-13 | Audit/rate-limit payload không chứa raw identifier | Unit/contract | Identifier bị loại bỏ hoặc chỉ dùng cơ chế keyed đã được owner quyết định; không unkeyed hash, không hard-coded key |
| Recovery | Restart/recovery feasibility inventory | Inventory/doc | Inventory hoàn tất trước khi sửa source; nếu không đạt thì BLOCKED |
| Recovery | React state unit test scope | Gate | Test React state chỉ chứng minh in-session behavior; không được tuyên bố cross-restart |

### Deferred test

| Khu vực | Scenario | Loại test | Kết quả bắt buộc |
| -------- | -------- | --------- | ---------------- |
| Database boundary | Row lock, unique constraint, transaction, race và restart persistence | Deferred | Không chạy ở M01-04; chuyển M01-07 |
| Device boundary | Emulator/Maestro restart/resume và UI recovery | Deferred | Không chạy ở M01-04; chuyển M01-08 |

Các test phải dùng dữ liệu synthetic tạo trong memory và phải redact giá trị khi assertion fail. Không ghi giá trị password, OTP, proof, token, phone/email thật hoặc full identifier vào test name, snapshot, log hoặc evidence.

## 15. Quality gates và phần deferred

Trước khi chọn command, phải đọc package.json thực tế của backend và mobile-app. Chỉ dùng script đang tồn tại; không tạo script mới và không giả định tên script nếu repository không có.

Backend tối thiểu:

- Typecheck hiện có của package.
- Build hiện có của package.
- Targeted registration contract/unit/HTTP fake test.
- Full unit test phù hợp với package.
- OpenAPI validator hiện có của repository.
- Lint nếu backend package có gate tương ứng.

Mobile tối thiểu:

- Lint.
- Typecheck.
- Targeted auth API, validator, context và RegisterScreen tests trong allowlist.
- Full Jest test phù hợp với package.
- OpenAPI validator.
- Web export nếu đây là gate bắt buộc hiện hành của mobile.

Repository:

- git diff --check.
- git status --short --untracked-files=all.
- Kiểm tra allowlist, file ngoài phạm vi, secret/PII marker và test output đã redact.

Không được chạy trong M01-04:

- PostgreSQL integration, disposable reset, migration apply/reset, remote database hoặc destructive test. M01-07 chịu trách nhiệm.
- Emulator, Maestro, APK/device E2E hoặc restart/resume UI thật. M01-08 chịu trách nhiệm.
- Worker/scheduler, staging, cloud provider, email/SMS provider thật hoặc production-like deployment.

M01-07 tiếp nhận:

- Migration 001–040/history/checksum, schema constraint và index.
- PostgreSQL database rỗng, upgrade path, row lock, unique constraint, transaction atomicity, duplicate race, cancel idempotency và restart persistence.

M01-08 tiếp nhận:

- Registration trên emulator, cancel/restart/resume UI, timeout/retry, KYC, transfer, savings và credit theo ma trận E2E.
- Bằng chứng screenshot/video/log đã redact và gắn đúng source/build/environment.

M01-05 và M01-06 không được dùng để trì hoãn test của M01-04. M01-04 phải tự thêm test cho mọi code mà task thay đổi; M01-06 chỉ xử lý coverage còn thiếu sau các task implementation.

## 16. Yêu cầu bàn giao

Bàn giao bằng tiếng Việt, tối thiểu gồm:

1. CWD, branch, HEAD, git status trước và sau; WIP có trước và cách bảo vệ.
2. Danh sách file/symbol thực tế đã sửa, đối chiếu allowlist.
3. Bằng chứng OpenAPI $ref/consumer scan và xác nhận endpoint ngoài Registration/Admin không đổi.
4. Request → state → UI → error cho begin, verify, cancel và restart/retry.
5. Current/expected data flow và response status thực tế.
6. Breaking/non-breaking impact, đặc biệt shared schema và global enum.
7. Kết luận D-13: identifier đã loại bỏ hoặc owner/security decision keyed fingerprint; không ghi secret.
8. Migration conclusion: không sửa migration; PostgreSQL evidence deferred M01-07.
9. Tất cả command đã chạy và kết quả thực tế, lấy từ package.json đã đọc; không ghi PASS dựa trên snapshot cũ.
10. Test matrix, negative regression, leakage/log/storage test và kết quả.
11. Phần chưa kiểm chứng, đặc biệt PostgreSQL và emulator/Maestro.
12. Xác nhận không sửa Admin, dependency, config, CI, infrastructure, worker hoặc file ngoài allowlist.
13. Xác nhận không stage, commit, push, merge, rebase, tag hoặc deploy.

## 17. Decision result

Trạng thái thực hiện: IN_PROGRESS — B1A VERIFIED — AWAITING CHECKPOINT COMMIT

Owner approval date: 2026-09-02 (Asia/Bangkok).
Scope được phê duyệt với Checkpoint A (D-05, D-06, D-07) và Checkpoint B (D-08, D-09, D-12, D-13) cùng mandatory owner gate giữa hai checkpoint đúng như task hiện tại (xem 11.7).

**Current B1A checkpoint decision result:**

- B1a D-08/D-09 đã đạt local/unit/HTTP fake gates.
- Backend: 228 total / 180 pass / 0 fail / 48 skipped.
- Mobile: 50 suites / 301 pass / 0 fail / 0 skipped.
- Mobile E2E syntax: 19 flows.
- Backend/Mobile OpenAPI validators: PASS.
- PostgreSQL transaction/concurrency proof deferred M01-07.
- Emulator/device proof deferred M01-08.
- B1b chưa triển khai.
- B2 chưa triển khai.
- M01-04 chưa COMPLETED.

---

**B1A CHECKPOINT COMMIT**

- Status B1a: COMPLETED tại local/unit/HTTP fake boundary.
- Commit SHA: `04c6f997f1d36879201d5c9a6a09e76928c25688`
- Parent SHA: `78e2dde71f577161bcd8897c59487d3a5f72199e`
- Message: `feat(registration): add device-bound cancellation`
- Commit timestamp: Wed Sep 2 14:47:37 2026 +0700 (Asia/Bangkok)
- Files: 14 — 13 modified, 1 added (`RegisterScreen.test.tsx`).
  1. `backend/scripts/validate-openapi.cjs` (M)
  2. `backend/src/database/registrationService.ts` (M)
  3. `backend/src/http.ts` (M)
  4. `backend/src/tests/kycContract.test.ts` (M)
  5. `backend/src/tests/registrationContract.test.ts` (M)
  6. `documents/api/banking-mvp.openapi.yaml` (M)
  7. `mobile-app/scripts/validate-openapi.cjs` (M)
  8. `mobile-app/src/features/auth/context/AuthContext.tsx` (M)
  9. `mobile-app/src/features/auth/context/__tests__/AuthContext.test.tsx` (M)
  10. `mobile-app/src/features/auth/screens/RegisterScreen.tsx` (M)
  11. `mobile-app/src/features/auth/screens/__tests__/RegisterScreen.test.tsx` (A)
  12. `mobile-app/src/features/auth/services/__tests__/authApi.test.ts` (M)
  13. `mobile-app/src/features/auth/services/authApi.ts` (M)
  14. `tasks/UC-M01/TASK_M01_04_HARDEN_REGISTRATION_CONTRACT_RECOVERY.md` (M)
- Chưa push.
- Branch ahead 17 tại thời điểm checkpoint (so với `origin/codex/staging-academic-completion`).
- Cached area và worktree sạch sau commit.

Test evidence tại thời điểm commit:

Backend:
- Total: 228 | Pass: 180 | Fail: 0 | Intentional skips: 48
- build/typecheck/OpenAPI: PASS

Mobile:
- Suites: 50 | Tests: 301 | Pass: 301 | Fail: 0 | Skipped: 0
- Targeted 3 suites / 52 tests: PASS
- lint/typecheck/OpenAPI/export: PASS
- E2E syntax 19 flows: PASS

Scope:
- D-08 và D-09 đã triển khai.
- Cancel public pre-auth, bắt buộc X-Device-ID.
- Response 204/404/409/422 đúng contract.
- B1b (unknown-response/expired-pending) chưa triển khai.
- B2 D-13 keyed fingerprint chưa triển khai.
- PostgreSQL transaction/concurrency proof chuyển M01-07.
- Emulator/Maestro proof chuyển M01-08.
- M01-04 không được tuyên bố COMPLETED.

---

Các mục lịch sử Checkpoint A bên dưới được giữ nguyên để truy vết và không thay thế kết quả B1A hiện tại.

**1. Ghi nhận Owner Expansion:**
- Owner đã cấp phép sửa 3 file test: `kycContract.test.ts`, `http.test.ts`, `savings-http.test.ts` để cập nhật schema (từ VerifyAuthChallengeRequest sang VerifyRegistrationChallengeRequest) và đổi method từ `OTP` sang `EMAIL_OTP` cho luồng Registration.

**2. Báo Git evidence:**
- `git status --short --untracked-files=all`:
  ```text
   M backend/src/database/registrationService.ts
   M backend/src/http.ts
   M backend/src/tests/http.test.ts
   M backend/src/tests/kycContract.test.ts
   M backend/src/tests/savings-http.test.ts
   M documents/api/banking-mvp.openapi.yaml
   M mobile-app/src/features/auth/services/authResponseValidators.ts
   M tasks/UC-M01/TASK_M01_04_HARDEN_REGISTRATION_CONTRACT_RECOVERY.md
  ?? backend/src/tests/registrationContract.test.ts
  ?? mobile-app/src/features/auth/services/__tests__/authResponseValidators.test.ts
  ```
- `git diff --name-only`: `backend/src/database/registrationService.ts`, `backend/src/http.ts`, `backend/src/tests/http.test.ts`, `backend/src/tests/kycContract.test.ts`, `backend/src/tests/savings-http.test.ts`, `documents/api/banking-mvp.openapi.yaml`, `mobile-app/src/features/auth/services/authResponseValidators.ts`, `tasks/UC-M01/TASK_M01_04_HARDEN_REGISTRATION_CONTRACT_RECOVERY.md`.
- **Xác nhận**: Không có bất kỳ file Checkpoint B nào (Cancel route/Mobile UI/Restart logic) bị sửa.

**3. Báo test evidence:**
- **Targeted Backend** (`registrationContract.test.ts`, `kycContract.test.ts`, `http.test.ts`, `savings-http.test.ts`): PASS.
- **Full Backend (`npm test`)**: Fails 1. (Phát hiện lỗi mới ngoài allowlist tại `credit-http.test.ts` do dùng helper gửi method `"OTP"`).
- **Backend Quality Gates**: `npm run typecheck`, `npm run build`, `npm run validate:openapi`: PASS.
- **Mobile Gates**: PASS.

**4. Failure matrix bổ sung (BLOCKED):**

| File test | Test case | Endpoint/flow | Expected cũ | Actual mới | Hợp lệ từ D-06? | Đề xuất chỉnh sửa tối thiểu |
|---|---|---|---|---|---|---|
| `credit-http.test.ts` | HTTP credit sandbox exposes... | `completeRegistration()` -> POST `/auth/register/verify` | HTTP 201 | HTTP 422 | CÓ | Tại helper `completeRegistration` trong file, đổi `method: "OTP"` thành `"EMAIL_OTP"`. |

**5. Constraint classification (D-07):**

| Phase | File/Symbol | Error class/code | PostgreSQL constraint name | Được map 409? | Unknown error rethrow? | Test fake/unit tương ứng |
|---|---|---|---|---|---|---|
| `begin` / `createPendingRegistration` | `registrationService.ts` / `begin` | 23505 | `pending_registrations_email_idx`, `pending_registrations_phone_idx`, `pending_registrations_pkey` | CÓ (`conflict()`) | CÓ | `Begin conflict returns 409` |
| `complete` / `createCustomer` | `registrationService.ts` / `complete` | 23505 | `customers_email_key`, `customers_phone_number_key`, `customers_email_lower_idx`, `customers_pkey` | CÓ (`RelationalConflictError`) | CÓ | `Complete conflict returns 409` |
*Ghi chú*: Việc map 409 cho `complete conflict` đã được xử lý. Test đang chạy bằng Fake In-Memory. (PostgreSQL test thuộc gap M01-07/M01-08 theo định hướng task).

**5. Xác minh OpenAPI/Mobile strictness:**
- `/auth/register/verify` đã được migrate sang dùng schema riêng `VerifyRegistrationChallengeRequest` chỉ chấp nhận method `EMAIL_OTP`.
- `/auth/verify` vẫn dùng nguyên schema chung `VerifyAuthChallengeRequest`.
- Registration Mobile validator khước từ triệt để các array mixed (`[EMAIL_OTP, OTP]`, `[EMAIL_OTP, BIOMETRIC]`), duplicate `EMAIL_OTP` (`[EMAIL_OTP, EMAIL_OTP]`), và reject alias `REGISTRATION_VERIFY`.
- General auth validator của `/auth/verify` không bị ảnh hưởng.

**6. Kết luận (Đề xuất exact allowlist expansion):**
- **Test cũ cần cập nhật hợp lệ**:
  - `backend/src/tests/kycContract.test.ts`
  - `backend/src/tests/http.test.ts`
  - `backend/src/tests/savings-http.test.ts`
- **Source gap còn thiếu**: KHÔNG. (Checkpoint A implementation đã đáp ứng đủ).
- **File không được phép chạm**: KHÔNG global search-and-replace `OTP`, KHÔNG sửa API endpoints của luồng ngoài Registration, KHÔNG bắt đầu Checkpoint B.

Khi task được owner phê duyệt và thực hiện:

- Nếu hoàn thành, đổi trạng thái đầu file thành COMPLETED và ghi rõ timestamp.
- Nếu có blocker, đổi trạng thái thành BLOCKED và chờ owner giải quyết.
- Chỉ được ghi COMPLETED khi acceptance criteria in-scope đã đạt.

## 18. CHECKPOINT B REMEDIATION DESIGN

**7. B1a Completed-link Evidence (FEASIBLE)**

- **Nguồn lấy thông tin**: Khi `cancel` được gọi, hệ thống load challenge thông qua `mfaRepository.getChallenge(challengeId)`. Challenge này chứa `pending_registration_id` (được lưu tại cột `auth_challenges.pending_registration_id`) và email của user (`destination`).
- **Completed check**: Trạng thái `COMPLETED` của Registration xảy ra khi hàm `registrationService.complete` được gọi. Hàm này tiêu thụ `pending_registrations` row và gọi `createCustomer`, đồng thời insert ID vào bảng `registration_completions`. ID của Customer (`customerId`) là một UUID mới, hoàn toàn khác với `pendingRegistrationId`.
- **Reference tồn tại sau khi tiêu thụ**: Mặc dù `pending_registrations` row đã bị xóa bởi `consumePendingRegistration`, bảng `registration_completions` vẫn lưu lại `pending_registration_id` cùng với `customer_id`. Do đó, `cancel` có thể query `registration_completions` bằng khóa `pending_registration_id` có trong challenge.
- **Phân biệt Verified và Completed**:
  - `VERIFIED` ở MFA: Chỉ có nghĩa là người dùng điền đúng OTP.
  - Có trường hợp challenge `VERIFIED` nhưng completion transaction thất bại (VD: lỗi database). Khi đó, `pending_registrations` row vẫn còn, transaction rollback, và `registration_completions` không có dữ liệu.
- **Kết luận link**: **FEASIBLE**. Việc kiểm tra `COMPLETED` hoàn toàn tách biệt khỏi mutation: chỉ cần `SELECT 1 FROM registration_completions WHERE pending_registration_id = $1`. Nếu có -> trả 409 (Completed). Nếu không có, tiếp tục kiểm tra `pending_registrations` -> nếu mất -> 204. Nếu còn -> Cancel active (xóa bằng `consumePendingRegistration` qua ID và hủy challenge trong cùng 1 UnitOfWork).

**8. B1b Cleanup expired pending khi retry begin (FEASIBLE NẾU MỞ QUYỀN CUSTOMER_REPOSITORY)**

- **Thiết kế cleanup**:
  - Thêm một method mới vào `customerRepository` (VD: `findAndLockPendingRegistrationByEmailOrPhone`) bọc trong UnitOfWork.
  - Tại `begin`, trước khi insert: lock row `pending_registrations` hiện có theo normalized email/phone.
  - Nếu pending chưa expire: trả 409, không mutation.
  - Nếu pending đã expire: khóa và cancel challenge liên quan, delete pending cũ, sau đó tạo pending và challenge mới trong cùng một transaction.
  - Mobile chỉ Retry, Backend tự quyết định đã expire hay chưa (không dựa vào local clock). Không thêm endpoint reconcile, không tự động retry.
- **Đánh giá**: **FEASIBLE** nếu thêm method lock/delete vào `CustomerRepository`. (PostgreSQL concurrency proof cho unique constraint sẽ chuyển sang M01-07 theo quy tắc không migration).

**9. B2 Rate-limit & Audit Keyed Fingerprint (BLOCKED do thiếu quyền wiring)**

- **Owner Decision (D-13)**:
  - Chỉ dùng `request.socket.remoteAddress`, **TUYỆT ĐỐI BỎ QUA** `x-forwarded-for`. (Đã xóa/đánh dấu REJECTED mọi đề xuất tin x-forwarded-for, tắt rate-limit hay bypass D-13 trước đây).
  - Nếu `remoteAddress` thiếu, dùng constant internal bucket an toàn để fail closed, không random key.
  - Bỏ hẳn `rateLimitKey` ở caller payload trước khi truyền vào `AuditRepository` (Không sửa `auditRepository.ts`).
  - Keyed Fingerprint: HMAC-SHA-256 (domain separation). Key base64 giải mã tối thiểu 32 bytes từ runtime config. Không default/fallback/hard-code. Không log key. Startup fail closed nếu thiếu/sai. Test sinh synthetic key trong memory.
- **Consumer matrix**:
  | File/symbol | Input | Domain | Output | Nơi lưu | Dùng để lookup/compare? | Ảnh hưởng rotation | Migration/compatibility policy |
  |---|---|---|---|---|---|---|---|
  | Registration rate-limit bucket | `remoteAddress` | `rate_limit_registration` | HMAC hex | Redis | CÓ | Reset bucket cũ. | An toàn (chỉ 10 phút). |
  | Registration audit payload | - | - | - | - | - | - | Loại bỏ nguyên trường IP, không hash. |
  | `registrationService.begin` | `email, phone` | `contact_fingerprint` | HMAC hex | Tạm trong hàm | KHÔNG | Challenge mất fingerprint. | An toàn, OTP ngắn hạn. |
  | `persistentMfaService.createEmailChallenge` | `email, phone` | `request_fingerprint` | HMAC hex | `auth_challenges` | KHÔNG (hiện tại) | Record cũ khác fingerprint. | An toàn, OTP ngắn hạn. |
  | Các consumer ngoài Registration | - | - | - | - | - | - | Không dùng fallback sang unkeyed hash. Phải truyền explicit key từ wiring. |
- **Injection-path inventory**:
  - `runtimeConfig` lấy field `REGISTRATION_FINGERPRINT_KEY`.
  - `backend/src/server.ts` đọc config truyền vào constructor `RelationalHttpBoundary` (`backend/src/database/relationalHttpBoundary.ts`), sau đó truyền xuống `registrationService`.
- **Kết luận**: **BLOCKED** vì cần sửa `server.ts` và `relationalHttpBoundary.ts` (các file này không nằm trong allowlist hiện tại).

**10. Đồng bộ Cancel Precedence**

Duy nhất 1 precedence xử lý theo thứ tự:
1. Validate malformed body/header → 422 trước DB.
2. Lock/load challenge.
3. Không tồn tại hoặc sai device/purpose → 404 redact.
4. Với challenge đúng owner/purpose:
   - **COMPLETED** (kiểm tra qua `registration_completions` trước mọi mutation/terminal handling) → 409, không mutation.
   - Chưa completed nhưng terminal/cancelled/expired → 204.
   - Active → cancel challenge và cleanup pending (bằng `consumePendingRegistration`) trong cùng UnitOfWork → 204.

**11. Mobile Transition Table (B1b/B1a)**

| Current phase | Event/response | Server state | Local action | Next phase | Có được begin lại? |
|---|---|---|---|---|---|
| `BEGIN_UNKNOWN` | Response success (2xx) | Tạo pending & MFA challenge | Lưu `challengeId`, update `expiresAt` | `CHALLENGE_RECEIVED` | KHÔNG (đã có challenge). |
| `BEGIN_UNKNOWN` | Timeout | Unknown | Không xóa metadata, báo lỗi UI | `BEGIN_UNKNOWN` | KHÔNG (tránh spam 409). |
| Restart trước expiry | Khởi động app | Unknown | Block begin mới, khôi phục UI nếu có challenge | `BEGIN_UNKNOWN` / `CHALLENGE_RECEIVED` | KHÔNG. |
| Restart sau expiry | Khởi động app | B1b server tự cleanup khi retry | Cho user chọn bắt đầu lại | Trống (cho đến khi begin) | **CÓ** (Server quyết định và cleanup). |
| `CHALLENGE_RECEIVED` | Cancel 204 | Đã xóa pending & MFA | Xóa metadata | Trống | CÓ. |
| `CHALLENGE_RECEIVED` | Cancel 409 (Completed) | Đã là Customer | Xóa metadata, sang màn Login | Trống | KHÔNG. |
| `CHALLENGE_RECEIVED` | Cancel 404 | Không có/Đã xóa | **Không tự động xóa** | `CHALLENGE_RECEIVED` | KHÔNG. |
| `CHALLENGE_RECEIVED` | Cancel 422 | Không đổi | Không xóa | `CHALLENGE_RECEIVED` | KHÔNG. |
| `CHALLENGE_RECEIVED` | Cancel Network Timeout | Unknown | Không xóa | `CHALLENGE_RECEIVED` | KHÔNG. |
| Bất kỳ | SecureStore write failure | Đã mutation ở server | Fallback state in-memory | Tùy write | Tùy. |
| Bất kỳ | SecureStore delete failure | Server đã xử lý | Cho qua / thử lại | Tùy delete | KHÔNG. |

**12. Exact Allowlist B1a, B1b, B2**

**B1a (Cancel UI & Logic)** - *FEASIBLE*:
- `documents/api/banking-mvp.openapi.yaml`
- `backend/src/http.ts`
- `backend/src/database/registrationService.ts`
- `backend/src/tests/registrationContract.test.ts`
- `mobile-app/src/features/auth/services/authApi.ts`
- `mobile-app/src/features/auth/services/__tests__/authApi.test.ts`
- `mobile-app/src/features/auth/screens/RegisterScreen.tsx`
- `mobile-app/src/features/auth/screens/__tests__/RegisterScreen.test.tsx`
- `mobile-app/src/features/auth/context/AuthContext.tsx`
- `mobile-app/src/features/auth/context/__tests__/AuthContext.test.tsx`
- `mobile-app/src/features/auth/types/auth.ts`
- `tasks/UC-M01/TASK_M01_04_HARDEN_REGISTRATION_CONTRACT_RECOVERY.md`

*(Quét nguồn xác nhận Không đưa Mobile Storage Adapter hoặc mfaRepository vào B1a. Check completed lấy qua registration_completions thẳng tại service).*

**B1b (Unknown-response recovery)** - *BLOCKED*:
- Cần thêm `backend/src/database/repositories/customerRepository.ts` để sửa hàm tìm/khóa pending. Đang chờ Owner phê duyệt cấp quyền B1b.

**B2 (D-13 Fingerprint)** - *BLOCKED VÌ WIRING*:
- *Chấp thuận về nguyên tắc*: `backend/src/security.ts`, `backend/src/runtimeConfig.ts`, `backend/src/server.ts` (chỉ config wiring), `backend/src/database/relationalHttpBoundary.ts` (chỉ constructor), `backend/src/database/registrationService.ts`, `backend/src/mfa/persistentMfaService.ts`, `backend/src/http.ts`, `backend/src/tests/security.test.ts`, `backend/src/tests/runtimeConfig.test.ts`, `backend/src/tests/registrationContract.test.ts`, `tasks/UC-M01/TASK_M01_04_HARDEN_REGISTRATION_CONTRACT_RECOVERY.md`.
- *KHÔNG ĐƯỢC PHÉP SỬA*: `auditRepository.ts` (Caller drops `rateLimitKey`), .env thật, migration, dependency.

## 19. CHECKPOINT B1A — MOBILE VALIDATOR ALLOWLIST (OWNER DECISION 2026-09-02)

Owner decision: cancel remains public pre-auth device-bound. OpenAPI `security: []` is canonical. Do not add fake bearer authentication. Do not add `{}` security alternative.

**Pre-change inventory (trước khi sửa):**

- Exact script `mobile-app/package.json` gọi: `node scripts/validate-openapi.cjs` → `mobile-app/scripts/validate-openapi.cjs`.
- `PUBLIC_OPERATIONS` chỉ nới rule bearerAuth+deviceBinding (empty `security`); Device ID được enforce ở vòng `requireDeviceId` riêng. Không BLOCKED.
- Begin/verify/resend: nằm trong `PUBLIC_OPERATIONS` (`security: []`) và (begin/verify/resend) nằm trong vòng bắt buộc `X-Device-ID`.
- Cancel trước sửa: OpenAPI đã `security: []` + `$ref` DeviceId required; Mobile validator chưa có cancel trong `PUBLIC_OPERATIONS` nên fail private rule: `POST /auth/register/cancel must require bearerAuth and deviceBinding together with no weaker alternative.`

**Thay đổi lượt này (chỉ hai file được phép):**

- `mobile-app/scripts/validate-openapi.cjs`: thêm đúng `POST /auth/register/cancel` vào `PUBLIC_OPERATIONS` và vào vòng `requireDeviceId`. Không wildcard, không đổi default private rule, không skip/catch-ignore, không đổi threshold.
- File task này: trạng thái + evidence.

Không sửa Backend, OpenAPI, Mobile source trong lượt này. B1b và B2 chưa triển khai. M01-04 không đánh dấu COMPLETED.

**Security evidence (validator nhận):**

- Cancel `security: []`; không `bearerAuth`; không `{}` alternative; `X-Device-ID` required via `#/components/parameters/DeviceId` (`required: true`).
- Begin/verify/resend giữ `security: []` + DeviceId `$ref`.
- Private `GET /accounts` vẫn `bearerAuth` + `deviceBinding`, không alternative yếu.
- Path giả `POST /auth/not-allowlisted` với `security: []` không nằm allowlist → `wouldPass=false`.
- Backend validator (`backend/scripts/validate-openapi.cjs`) đã có cancel trong cùng hai nhóm; không sửa thêm Backend lượt này. `npm run validate:openapi` Backend PASS.

**Mobile gates (CWD `mobile-app`, Node v24.19.0):**

| Gate | Kết quả |
| --- | --- |
| `npm run validate:openapi` | PASS |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| Targeted Jest | 3 suites / 52 tests / 52 pass / 0 fail / 0 skipped |
| Full Jest `--runInBand` | 50 suites / 301 tests / 301 pass / 0 fail / 0 skipped |
| `npm run validate:e2e` | PASS, 19 flows |
| `npm run export:web` | PASS |
| `git diff --check` | PASS (warning CRLF task file) |
| Sensitive-data scan | Không có credential/OTP/token plaintext trong validator diff |
| `git status --short --untracked-files=all` | WIP trước đó giữ nguyên; lượt này thêm `M mobile-app/scripts/validate-openapi.cjs` |
| `git diff --cached --name-status` | trống (không stage) |

Targeted breakdown: `authApi.test.ts` 1/37/37/0/0; `AuthContext.test.tsx` 1/6/6/0/0; `RegisterScreen.test.tsx` 1/9/9/0/0.

Branch: `codex/staging-academic-completion`. HEAD: `78e2dde71f577161bcd8897c59487d3a5f72199e`.

Staging plan được owner duyệt, chưa thực hiện: chỉ stage đúng 14 file sau; không commit/push:

1. `backend/scripts/validate-openapi.cjs`
2. `backend/src/database/registrationService.ts`
3. `backend/src/http.ts`
4. `backend/src/tests/kycContract.test.ts`
5. `backend/src/tests/registrationContract.test.ts`
6. `documents/api/banking-mvp.openapi.yaml`
7. `mobile-app/scripts/validate-openapi.cjs`
8. `mobile-app/src/features/auth/context/AuthContext.tsx`
9. `mobile-app/src/features/auth/context/__tests__/AuthContext.test.tsx`
10. `mobile-app/src/features/auth/screens/RegisterScreen.tsx`
11. `mobile-app/src/features/auth/screens/__tests__/RegisterScreen.test.tsx`
12. `mobile-app/src/features/auth/services/authApi.ts`
13. `mobile-app/src/features/auth/services/__tests__/authApi.test.ts`
14. `tasks/UC-M01/TASK_M01_04_HARDEN_REGISTRATION_CONTRACT_RECOVERY.md`

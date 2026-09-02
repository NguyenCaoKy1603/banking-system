# TASK M01-02 — Chốt contract Registration và Synthetic KYC

Trạng thái: `COMPLETED`

## 1. Thông tin dự án và quyền truy cập

Tên dự án: Banking System

Repository dự kiến trên Windows: `C:\Projects\banking-system`

Codex phải được mở tại repository thật. Trước khi thực hiện, phải xác nhận:

- Current working directory.
- Git branch.
- Git HEAD.
- `git status`.
- WIP tracked và untracked cần bảo vệ.
- File hướng dẫn áp dụng cho từng module.

Không được mặc định branch, HEAD, status hoặc WIP của M01-01 vẫn là hiện trạng. Các giá trị này phải được kiểm tra lại ngay khi bắt đầu thực hiện M01-02 và ghi nhận vào `Decision result`.

Chỉ có đường dẫn trong task không được xem là bằng chứng đã truy cập repository.

Mục đích dự án: Mobile banking academic/reference sử dụng dữ liệu tổng hợp và tiền ảo. Đây không phải hệ thống xử lý tiền thật, pilot đã xác minh hoặc production-ready.

Tài liệu bắt buộc đọc trước:

- `AGENTS.md`
- `PROJECT_CONTEXT.md`
- `TASK_TEMPLATE.md`
- `mobile-app/AGENTS.md` nếu tồn tại
- `mobile-app/README.md`
- `backend/README.md`
- `tasks/UC-M01/TASK_M01_01_AUDIT_REGISTRATION_KYC.md`
- OpenAPI và contract liên quan dưới `documents/api/`
- Runtime validator, route implementation và test liên quan đến Registration/KYC

Baseline từ audit M01-01:

- Audit được hoàn thành tại HEAD `c64e5f3e1c9dd2f660669948d21c30745c4f778e`.
- UC-M01 được đánh giá `PARTIAL`.
- Baseline này chỉ dùng để định hướng. Codex phải kiểm tra lại HEAD và worktree hiện tại trước khi tin số liệu.

## 2. Chế độ làm việc và quyền Git

Chế độ làm việc: `DIAGNOSE_AND_PLAN`

Quyền sửa code: Không.

Quyền ghi tài liệu:

- Chỉ được sửa `tasks/UC-M01/TASK_M01_02_DECIDE_REGISTRATION_KYC_CONTRACT.md`.
- Trong file đó, chỉ được đổi trạng thái và điền hoặc cập nhật mục `Decision result`.
- Không được sửa bất kỳ file repository nào khác.

Git add/stage: Không.

Commit: Không.

Push: Không.

Merge/rebase/tag: Không.

Quyền ngoài repository:

- Network hoặc dịch vụ bên thứ ba: Không.
- Deploy/provision/mua hoặc bật dịch vụ: Không.
- Bật worker/scheduler: Không.
- Khởi tạo/reset database: Không.
- Destructive database operation: Không.

Không reset, restore, checkout, clean, xóa, di chuyển hoặc ghi đè WIP hiện có.

Không sửa các Maestro YAML hoặc thay đổi của tiến trình khác.

## 3. Nhiệm vụ

Tên nhiệm vụ: Chốt canonical contract và hành vi đúng cho Registration/Synthetic KYC

Mục tiêu:

Chuyển các quyết định owner đã phê duyệt thành một contract plan rõ ràng, nhất quán và có thể triển khai trong các task tiếp theo.

Task phải xác định:

- Trạng thái hiện tại của từng contract.
- Trạng thái mục tiêu đã được owner phê duyệt.
- Mobile, OpenAPI, runtime validator, Backend, persistence và test nào bị tác động.
- Thay đổi nào là breaking hoặc non-breaking.
- Có cần migration hay không.
- Thứ tự các task implementation.
- Acceptance criteria và test bắt buộc cho từng task.

Task này không được sửa implementation hoặc contract runtime.

Ưu tiên: `P1`

Lý do ưu tiên:

Audit M01-01 đã phát hiện Mobile, OpenAPI, runtime validator và Backend chưa thống nhất ở KYC identity, document URI, response privacy và Registration retry/cancel. Nếu sửa code trước khi chốt contract, các tầng có thể tiếp tục mâu thuẫn.

## 4. Hành vi hiện tại

Theo audit M01-01:

1. OpenAPI/Backend chấp nhận identity number từ 6–24 chữ số, Mobile chỉ chấp nhận 9–12.
2. OpenAPI/Backend chỉ chấp nhận `mock://` hoặc `synthetic://`, Mobile chỉ kiểm tra document URI không rỗng.
3. Backend có thể trả identity number đầy đủ trong KYC response trong khi schema đánh dấu dữ liệu này là `writeOnly`.
4. Registration response validator chấp nhận alias enum rộng hơn OpenAPI.
5. Verify body có chỗ dùng type assertion trước runtime validation.
6. Duplicate registration race chưa được chứng minh luôn ánh xạ thành `409`.
7. Nút thay đổi thông tin chỉ xóa state Mobile, chưa hủy pending registration/challenge trên server.
8. KYC chưa map đầy đủ server field errors.
9. Initial KYC load chưa có retry rõ ràng.
10. `REJECTED` và `NEEDS_MORE_INFO` chưa được thể hiện đúng ý nghĩa khác nhau.
11. Registration challenge chỉ nằm trong React state nên không resume được sau app restart.
12. Audit event có nguy cơ lưu raw rate-limit/network identifier.

Codex phải kiểm tra lại từng kết luận trên tại HEAD hiện tại và ghi rõ nếu source đã thay đổi sau audit.

## 5. Canonical decisions của owner

Các quyết định dưới đây đã được owner phê duyệt cho contract plan. Codex không được tự đổi sang phương án khác.

### 5.0. Decision summary

| Decision ID | Quyết định canonical |
| ----------- | -------------------- |
| D-01 | Identity number hợp lệ gồm `6–24` chữ số |
| D-02 | Document URI chỉ bắt đầu bằng `mock://` hoặc `synthetic://` |
| D-03 | KYC response chỉ sử dụng `identityNumberLast4` |
| D-04 | KYC response không trả identity number đầy đủ |
| D-05 | Runtime validator chỉ chấp nhận enum chính thức trong OpenAPI |
| D-06 | Verify body thiếu hoặc sai field trả HTTP `422` |
| D-07 | Duplicate registration race trả HTTP `409` |
| D-08 | Registration cancel dùng `POST /auth/register/cancel` |
| D-09 | Cancel yêu cầu `challengeId` và `X-Device-ID`, đồng thời idempotent |
| D-10 | KYC DRAFT là payload đầy đủ và hợp lệ đã lưu nhưng chưa submit |
| D-11 | `REJECTED` là terminal đối với application hiện tại; resubmit tạo application mới |
| D-12 | Registration restart không persist password, OTP hoặc proof |
| D-13 | Audit/rate-limit identifier chỉ dùng keyed fingerprint đã security-review hoặc loại bỏ |
| D-14 | KYC phải map field error, có retry initial load và phân biệt `REJECTED` với `NEEDS_MORE_INFO` |
| D-15 | KYC update privacy dùng `identityNumberLast4` đúng bốn chữ số; update không đổi identity được bỏ `identityNumber`; đổi identity phải nhập lại full value `6–24` chữ số; full identity không vào response, Mobile persistence hoặc log |

### 5.0.1. Base-path convention

Khi thực hiện task phải đọc lại `servers` và path keys từ OpenAPI hiện tại. Endpoint trong task phải được ghi theo path key tương đối đúng như OpenAPI khai báo, không tự nối thêm prefix vào tên endpoint.

Các path canonical được ghi trong task này là:

- `POST /auth/register`
- `POST /auth/register/verify`
- `POST /auth/register/cancel`
- `POST /auth/challenges/{challengeId}/resend`
- `GET /kyc/application`
- `POST /kyc/application`
- `POST /kyc/application/submit`

`POST /auth/register/cancel` là Draft contract trong M01-02; không được thêm vào OpenAPI hoặc source trong task này.

### 5.1. KYC identity number

- Request field chính thức: `identityNumber`.
- Chỉ chấp nhận chuỗi gồm `6–24` chữ số.
- Không chấp nhận chữ cái hoặc ký tự đặc biệt; quy tắc trim/chuẩn hóa phải được ghi rõ trong implementation task.
- Mobile, OpenAPI và Backend phải dùng cùng quy tắc.
- Đây là synthetic identity cho academic/reference implementation, không tuyên bố tương thích với KYC provider thật.

### 5.2. KYC response privacy

- Backend không được trả identity number đầy đủ trong response.
- `identityNumber` là request-only/write-only.
- Response chỉ được trả `identityNumberLast4`.
- `identityNumberLast4` luôn là chuỗi đúng bốn chữ số cuối do server tạo.
- Mobile không được gửi `identityNumberLast4` như full identity.
- Khi cập nhật application hiện có mà không đổi identity, request được phép bỏ `identityNumber`.
- Backend phải giữ identity hiện tại nếu `identityNumber` bị bỏ khỏi request.
- Khi thay đổi identity, người dùng phải nhập lại full value gồm `6–24` chữ số.
- Full identity không được đưa vào API response, persistent storage của Mobile hoặc log.
- Full identity chỉ được xử lý tạm thời khi cần nhập hoặc gửi request hợp lệ; không được đưa vào analytics, crash report hoặc evidence.

### 5.3. Synthetic document URI

- Chỉ chấp nhận URI bắt đầu bằng `mock://` hoặc `synthetic://`.
- Mobile validation, OpenAPI và Backend phải cùng thực thi quy tắc này.
- Không chấp nhận URI tùy ý, local file thật hoặc remote document provider.
- UI phải ghi rõ đây là tài liệu synthetic/reference.

### 5.4. KYC lifecycle

Canonical status:

- `DRAFT`
- `SUBMITTED`
- `UNDER_REVIEW`
- `NEEDS_MORE_INFO`
- `APPROVED`
- `REJECTED`

Ý nghĩa:

- `DRAFT`: hồ sơ có payload hợp lệ đã được lưu nhưng chưa submit; không phải tính năng lưu form thiếu field.
- `SUBMITTED`: đã gửi, chờ nhân viên tiếp nhận; read-only trên Mobile.
- `UNDER_REVIEW`: nhân viên đang review; read-only trên Mobile.
- `NEEDS_MORE_INFO`: người dùng được sửa hồ sơ hiện tại và submit lại.
- `APPROVED`: kết thúc thành công; read-only.
- `REJECTED`: kết thúc không thành công; không được hiển thị cùng thông điệp với `NEEDS_MORE_INFO`. Owner cho phép người dùng tạo application mới sau REJECTED. Application REJECTED hiện tại vẫn terminal và immutable.

Mỗi trạng thái phải có:

- UI label riêng.
- Hành động được phép rõ ràng.
- Runtime response validation.
- Unit/screen test tương ứng.

### 5.4.1. KYC status transition

| Trạng thái hiện tại | Thao tác | Trạng thái tiếp theo |
| ------------------- | -------- | -------------------- |
| Không có application | Lưu payload đầy đủ và hợp lệ | `DRAFT` |
| `DRAFT` | Lưu lại payload đầy đủ và hợp lệ | `DRAFT` |
| `DRAFT` | Submit | `SUBMITTED` |
| `SUBMITTED` | Admin claim | `UNDER_REVIEW` |
| `UNDER_REVIEW` | Yêu cầu bổ sung | `NEEDS_MORE_INFO` |
| `UNDER_REVIEW` | Duyệt | `APPROVED` |
| `UNDER_REVIEW` | Từ chối | `REJECTED` |
| `NEEDS_MORE_INFO` | Lưu payload đầy đủ đã chỉnh sửa | `DRAFT` |
| `NEEDS_MORE_INFO` | Submit lại | `SUBMITTED` |
| `REJECTED` | Cập nhật record hiện tại | Không được phép; record hiện tại immutable |
| `REJECTED` | Nộp lại | Tạo application mới ở `DRAFT`; giữ nguyên record `REJECTED` cũ |
| `APPROVED` | Cập nhật record hiện tại | Không được phép; record hiện tại terminal |

Sau `REJECTED`:

- Được phép tạo application mới sau REJECTED.
- Application mới phải tuân thủ giới hạn tối đa một application đang mở.
- Application `REJECTED` cũ giữ immutable.
- Không transition record cũ về `DRAFT` hoặc `SUBMITTED`.
- Chỉ tối đa một application đang mở tại một thời điểm.
- Application mới bắt đầu ở `DRAFT` và phải có payload đầy đủ, hợp lệ.

### 5.5. KYC error UX

Mobile phải có hành vi mục tiêu:

- Map `ApiError.fieldErrors` về đúng field.
- Initial GET thất bại phải có nút retry.
- Offline, timeout, unauthorized và server error phải có thông điệp phân biệt phù hợp.
- Không xóa dữ liệu người dùng vừa nhập chỉ vì request thất bại.
- Không submit đồng thời khi request đang chạy.
- `REJECTED` và `NEEDS_MORE_INFO` phải có thông điệp và hành động khác nhau.

### 5.5.1. Error contract

| Tình huống | HTTP status | Hành vi |
| ---------- | ----------- | ------- |
| Body thiếu field | `422` | Trả `fieldErrors` nếu xác định được field; không tạo side effect |
| Body sai kiểu hoặc sai định dạng | `422` | Không đi vào service bằng type assertion chưa kiểm chứng |
| Duplicate hoặc duplicate race | `409` | Không trả raw database error và không tạo dữ liệu trùng |
| State conflict | `409` | Không tạo side effect mới |
| Session hoặc device không hợp lệ | `401` | Trả lỗi đã redact và chuyển flow session phù hợp |
| Resource không tồn tại | `404` | Không làm lộ dữ liệu ngoài quyền |
| Vượt rate limit | `429` | Hiển thị retry phù hợp |
| Lỗi server | `5xx` | Message, log và telemetry phải được redact |

### 5.6. Registration challenge enums

Chỉ chấp nhận canonical value trong OpenAPI:

- Method: `EMAIL_OTP`
- Purpose: `REGISTRATION_EMAIL_VERIFY`

Runtime validator không được chấp nhận alias `OTP` hoặc `REGISTRATION_VERIFY` nếu các alias này không có trong OpenAPI đã phê duyệt.

API chưa triển khai thay đổi này phải được ghi Draft trong contract plan, không được sửa ngầm trong task M01-02.

### 5.7. Malformed Registration verify request

Request verify thiếu field hoặc sai kiểu phải:

- Bị runtime-validate tại HTTP boundary.
- Không đi vào service bằng type assertion chưa kiểm chứng.
- Trả HTTP `422`.
- Trả error shape đúng contract.
- Không tạo, consume hoặc thay đổi challenge/pending registration.
- Có test cho thiếu/sai kiểu `challengeId`, `method` và `proof`.

### 5.8. Duplicate registration

Hành vi mục tiêu:

- Customer đã tồn tại phải trả conflict ổn định.
- Pending registration đang hoạt động phải có lỗi nghiệp vụ rõ ràng.
- Race do unique constraint không được trở thành lỗi `500`.
- Duplicate/unique race phải được ánh xạ về HTTP `409`.
- Không được tạo hai customer hoặc hai payment account cho cùng completion.
- Concurrency behavior phải được kiểm tra bằng disposable PostgreSQL ở task riêng.

Tên error code chính xác phải ưu tiên tái sử dụng error code hiện có. Nếu cần error code mới, Codex phải đề xuất rõ trong contract plan, không tự thêm trong task này.

### 5.9. Thay đổi hoặc hủy registration đang pending

Owner chọn hành vi server-side rõ ràng:

- Bổ sung Draft contract cho `POST /auth/register/cancel`.
- Đây là pre-auth endpoint nhưng bắt buộc có `challengeId` và `X-Device-ID`.
- Chỉ challenge/pending registration thuộc đúng device binding mới được hủy.
- Endpoint phải idempotent.
- Hủy lại challenge đã hủy/hết hạn không được gây lỗi nội bộ hoặc lộ thông tin nhạy cảm.
- Cancel không được ảnh hưởng customer đã hoàn thành registration.
- Cancel phải revoke challenge và giải phóng pending registration một cách nguyên tử.
- Mobile chỉ xóa local registration state sau khi server xác nhận cancel hoặc sau khi kết quả được reconcile an toàn.
- Nếu cancel timeout, retry cùng request không được gây trạng thái sai.
- Endpoint này chỉ là Draft decision trong M01-02; chưa được thêm vào OpenAPI hoặc code cho đến task implementation được owner phê duyệt.

#### Response contract của `POST /auth/register/cancel`

| Tình huống | HTTP status | Hành vi |
| ---------- | ----------- | ------- |
| Cancel thành công | `204 No Content` | Hủy challenge/pending registration đúng device và purpose; không có response body |
| Cancel lặp lại cùng challenge và device | `204 No Content` | Idempotent, không tạo thêm side effect |
| Challenge đã terminal, expired hoặc cancelled nhưng registration chưa hoàn thành | `204 No Content` | Xem như đã được xử lý an toàn |
| Body malformed hoặc thiếu `challengeId` | `422` | Trả lỗi validation, không thay đổi state |
| Challenge không tồn tại hoặc sai device/purpose | `404` | Response đã redact, không tiết lộ thông tin challenge |
| Registration đã hoàn thành | `409` | Không xóa hoặc thay đổi customer/account đã hoàn thành |

Cancel thành công không trả response body. Các response lỗi cũng không được chứa password, OTP, proof, token, device secret hoặc full identity.

### 5.10. Registration restart behavior

- Không persist password, OTP hoặc proof.
- Không persist full registration form chứa dữ liệu nhạy cảm.
- Có thể persist tối thiểu `challengeId`, expiry, purpose và metadata không nhạy cảm trong storage phù hợp nếu security review cho phép.
- Sau app restart, Mobile phải kiểm tra challenge còn hợp lệ hoặc cung cấp hành động bắt đầu lại/cancel an toàn.
- Không được tự tạo registration request mới khi chưa xác định trạng thái challenge cũ.
- Phải có cancel hoặc reconcile an toàn sau app restart trước khi xóa metadata hoặc bắt đầu lại.
- Chi tiết storage và resume flow phải được đề xuất trong task M01-04 và cần security review trước khi triển khai.

### 5.11. Audit và telemetry redaction

- Không ghi raw IP, raw network key hoặc raw rate-limit key vào audit event.
- Audit chỉ được ghi loại sự kiện, kết quả, request ID và metadata không nhạy cảm cần thiết.
- Nếu cần correlation identifier, chỉ dùng keyed fingerprint đã được security review hoặc loại bỏ identifier.
- Không dùng unkeyed hash của IP, email hoặc phone.
- Không tự thêm secret/config mới trong task M01-02.
- Phải có test chống leak cho password, OTP, token, full identity và raw network identifier.

## 6. Phạm vi

Được phép kiểm tra:

- Mobile Registration, AuthContext, auth API, HTTP client và KYC.
- Mobile runtime validators và test liên quan.
- Backend HTTP boundary, registration/KYC services và repositories.
- Migration liên quan, chỉ đọc.
- OpenAPI và auth/KYC contract hiện tại.
- Test unit/integration/E2E hiện có.
- Audit M01-01.
- Git metadata và diff liên quan.

Được phép sửa:

- Chỉ mục `Decision result` trong file task này.

Không được thay đổi:

- Mobile source.
- Backend source.
- Database migration/schema.
- OpenAPI.
- Runtime validators.
- Test.
- Dependency hoặc lockfile.
- CI.
- Admin Web.
- Infrastructure.
- Worker/scheduler.
- `AGENTS.md`.
- `PROJECT_CONTEXT.md`.
- `TASK_TEMPLATE.md`.
- Task M01-01.
- Maestro YAML.
- Raw `artifacts/`.

Dependency/config/API được phép thay đổi: Không trong task này.

## 7. Phân tích tác động bắt buộc

Với mỗi quyết định tại mục 5, Codex phải lập bảng:

| Decision ID | Hiện trạng | Mục tiêu | File/symbol bị tác động | Breaking/non-breaking | Migration cần thiết | Test bắt buộc | Task implementation |
| ----------- | ---------- | -------- | ----------------------- | --------------------- | ------------------- | ------------- | ------------------- |

Codex phải:

1. Xác định chính xác file/symbol hiện tại bằng repo-relative path và symbol thực tế đã đọc.
2. Phân biệt thay đổi Mobile, OpenAPI, Backend, persistence và test.
3. Đánh dấu thay đổi breaking/non-breaking.
4. Xác định có cần migration mới hay không.
5. Không đề xuất sửa migration đã áp dụng.
6. Chỉ định task implementation chịu trách nhiệm.
7. Nêu dependency giữa các task.
8. Nêu quyết định nào vẫn cần owner hoặc security review bổ sung.

Trong `Decision result`, cột `File/symbol bị tác động` bắt buộc dùng định dạng:

`repo-relative/path/to/file.ts::symbolName`

Không chấp nhận chỉ ghi tên file chung như `kycValidators.ts` hoặc `registrationService.ts`. Không được tự suy đoán symbol; nếu chưa xác minh được phải ghi `UNVERIFIED` và nêu lý do.

Ví dụ format hợp lệ:

- `mobile-app/src/features/kyc/validation/kycValidators.ts::validateKycDraft`
- `mobile-app/src/features/kyc/validation/kycResponseValidators.ts::isKycApplicationResponse`
- `mobile-app/src/features/kyc/screens/KycScreen.tsx::loadApplication`
- `mobile-app/src/features/auth/services/authApi.ts::verifyRegistrationChallenge`
- `backend/src/database/kycService.ts::publicApplication`
- `backend/src/database/registrationService.ts::RelationalRegistrationService.complete`
- `backend/src/http.ts::getRateLimitKey`

Nếu owner decision không thể triển khai an toàn với kiến trúc hiện tại, Codex phải:

- Ghi bằng chứng.
- Nêu blocker.
- Đưa ra phương án thay thế.
- Không tự thay đổi quyết định.

## 8. Kế hoạch task implementation bắt buộc

Codex phải hoàn thiện scope cho các task tiếp theo:

### M01-03 — Đồng bộ KYC contract và privacy

Kết quả chính:

Mobile, OpenAPI, runtime validator và Backend sử dụng cùng KYC input/response contract; response không trả full identity.

Phải xác định:

- File được phép sửa.
- OpenAPI thay đổi.
- Runtime validator thay đổi.
- Backend response projection.
- Mobile model/state/UI thay đổi.
- Compatibility impact.
- Unit/contract test bắt buộc.
- Có cần migration hay không.

### M01-04 — Làm cứng Registration validation, cancel và retry

Kết quả chính:

Malformed request, duplicate race, pending cancel và restart/retry có hành vi an toàn, xác định được và không tạo account trùng.

Phải xác định:

- Draft cancel endpoint.
- HTTP boundary validation.
- Transaction/concurrency behavior.
- Mobile cancel/resume behavior.
- Security review cho storage tối thiểu.
- Unit/integration test.
- Disposable PostgreSQL test.

### M01-05 — Hoàn thiện KYC UI state và error

Kết quả chính:

Mobile hiển thị đúng loading/error/retry/field error và lifecycle state theo canonical contract.

Phải xác định:

- Screen/state/service file.
- Error mapping.
- Retry behavior.
- `REJECTED`/`NEEDS_MORE_INFO`.
- Draft/edit/resubmit.
- Screen test bắt buộc.

### M01-06 — Bổ sung coverage còn thiếu

Kết quả chính:

Bổ sung screen/validator/integration coverage còn thiếu sau M01-03, M01-04 và M01-05.

Lưu ý:

- M01-03, M01-04 và M01-05 phải tự thêm test cho code chúng thay đổi.
- M01-06 không được dùng để trì hoãn test của các task implementation.
- M01-06 chỉ xử lý khoảng trống coverage còn lại.

### M01-07 — Disposable PostgreSQL verification

Kết quả chính:

Xác minh migration hiện tại, registration/KYC concurrency, one-winner, cancel/retry, audit/outbox và idempotency trên database disposable đã guard.

Không được chạy cho đến khi task riêng cấp quyền database rõ ràng.

### M01-08 — Emulator E2E verification

Kết quả chính:

Chạy Registration → OTP capture → Login → KYC lifecycle, error/retry và app restart trên emulator bằng dữ liệu synthetic, evidence đã redact.

Không dùng credential hoặc dữ liệu người dùng thật.

### M01-09 — Đóng UC-M01

Kết quả chính:

Audit lại toàn bộ scenario, cập nhật bằng chứng gắn đúng HEAD/environment và chỉ đánh dấu UC-M01 `VERIFIED` nếu không còn conflict bắt buộc.

## 9. Source of truth và xử lý xung đột

| Loại dữ liệu | Source of truth | Cách xác minh |
| ------------ | --------------- | ------------- |
| Database | Migration, migration history và checksum | Kiểm tra schema, migration đã áp dụng và checksum tương ứng |
| API | OpenAPI, runtime validator và route implementation | Đối chiếu path, method, field, enum, status và response ở cả ba nơi |
| Mobile | Screen, state, service và test thực thi | Truy vết data flow và test gắn đúng source revision |
| Evidence | Source tree, test output, HEAD và environment tương ứng | Chỉ chấp nhận evidence truy nguyên được đúng commit và environment |

Quyết định nghiệp vụ trong task này chỉ có hiệu lực sau khi owner phê duyệt. Tài liệu kế hoạch không tự chứng minh behavior đã chạy.

Nếu source hiện tại mâu thuẫn với quyết định owner:

- Ghi là gap cần implementation.
- Không sửa source trong M01-02.
- Không tự thay đổi quyết định để phù hợp với code hiện tại.

## 10. Kiểm tra được phép chạy

Task này chủ yếu là phân tích contract và không cần full test suite.

Được phép:

- Đọc package scripts.
- Dùng tìm kiếm source không làm thay đổi file.
- Chạy OpenAPI validator hiện có nếu cần xác nhận baseline.
- Chạy targeted validator test nếu cần xác minh nhận định.
- Chạy `git diff --check`.
- Kiểm tra `git status` trước và sau task.

Không được:

- Chạy database reset/provision.
- Chạy worker/scheduler.
- Chạy deploy.
- Chạy test cần credential.
- Tạo raw evidence.
- Thay đổi source để làm validator pass.

Nếu chạy test, phải ghi rõ lệnh, HEAD và kết quả. Không được dùng kết quả M01-01 như PASS mới nếu không rerun.

## 11. Hoàn thành khi

Task hoàn thành khi:

1. Xác nhận repository, branch, HEAD và worktree.
2. Kiểm tra lại toàn bộ conflict từ M01-01 tại source hiện tại.
3. Lập đầy đủ impact matrix cho các quyết định owner.
4. Mỗi quyết định có trạng thái hiện tại và trạng thái mục tiêu.
5. Chỉ ra chính xác file/symbol dự kiến bị tác động.
6. Đánh dấu breaking/non-breaking và migration impact.
7. Hoàn thiện scope, acceptance criteria và test plan cho M01-03 đến M01-09.
8. Ghi rõ dependency giữa các task.
9. Không sửa Mobile, Backend, OpenAPI, migration hoặc test.
10. Không sửa file repository nào ngoài chính task M01-02.
11. Chỉ đổi trạng thái và điền hoặc cập nhật mục `Decision result` của file task này.
12. Không stage hoặc commit.
13. Worktree cuối phiên không có thay đổi ngoài phạm vi được phép.

## 12. Yêu cầu bàn giao

Bàn giao bằng tiếng Việt gồm:

1. Repository, branch, HEAD và worktree.
2. Source/contract/test đã đọc.
3. Xác nhận conflict M01-01 còn tồn tại hay đã thay đổi.
4. Canonical decision matrix.
5. Impact matrix theo từng tầng.
6. Breaking change và migration assessment.
7. Kế hoạch M01-03 đến M01-09.
8. Acceptance criteria và test cho từng task.
9. Security/privacy impact.
10. Blocker hoặc quyết định bổ sung cần owner xác nhận.
11. File đã thay đổi.
12. Xác nhận không stage/commit.

## 13. Decision result

Trạng thái thực hiện: `COMPLETED — DIAGNOSE_AND_PLAN; CHƯA IMPLEMENTATION`

### 13.1. Kết quả và phạm vi thực hiện

M01-02 đã chốt decision/contract plan cho Registration và Synthetic KYC theo đúng 15 quyết định owner D-01 đến D-15. Phạm vi của task chỉ là chẩn đoán, chốt contract, lập impact/dependency plan và ghi nhận bằng chứng; không thực hiện implementation.

Thời điểm ghi kết quả: `2026-09-01 23:18:42 +07:00` (Asia/Bangkok).

### 13.2. Repository verification và WIP cần bảo vệ

- Current working directory: `C:\Projects\banking-system`.
- Branch: `codex/staging-academic-completion`.
- HEAD: `c64e5f3e1c9dd2f660669948d21c30745c4f778e`.
- `HEAD` đang ahead `origin/codex/staging-academic-completion` 11 commit.
- Trạng thái Git tại thời điểm xác minh:

  ```text
  ## codex/staging-academic-completion...origin/codex/staging-academic-completion [ahead 11]
   M AGENTS.md
  ?? PROJECT_CONTEXT.md
  ?? TASK_TEMPLATE.md
  ?? tasks/
  ```

- WIP phải bảo vệ nguyên trạng: `AGENTS.md` đang modified; `PROJECT_CONTEXT.md`, `TASK_TEMPLATE.md` và toàn bộ `tasks/` đang untracked; trong đó có M01-01 và M01-02. Không giả định snapshot M01-01 là hiện trạng duy nhất trước khi kiểm tra.
- Không dùng `git reset`, `git checkout`, `git restore`, `git clean`, xóa hoặc ghi đè WIP. Không stage và không commit.

### 13.3. Tài liệu và nguồn sự thật đã kiểm tra

Đã đọc toàn bộ các tài liệu bắt buộc: `AGENTS.md`, `PROJECT_CONTEXT.md`, `TASK_TEMPLATE.md`, `mobile-app/AGENTS.md`, `mobile-app/README.md`, `backend/README.md`, `tasks/UC-M01/TASK_M01_01_AUDIT_REGISTRATION_KYC.md` và toàn bộ task này.

Nguồn sự thật được phân loại, không áp dụng một thứ tự ưu tiên chung:

| Loại dữ liệu | Source of truth | Cách xác minh |
| ------------ | --------------- | ------------- |
| Database | `backend/database/*.sql`, migration history/checksum và migration runner | Đối chiếu migration 001–040, constraint/index/status với database validator hoặc disposable PostgreSQL ở M01-07 |
| API | `documents/api/banking-mvp.openapi.yaml`, runtime validator và route implementation | Đối chiếu path key thực tế, schema, enum, status code, route exact-match và test HTTP |
| Mobile | Screen/state/service/type/validator/test dưới `mobile-app/src/` | Đối chiếu request, response validator, state transition, loading/error/retry và test Mobile |
| Evidence | Source tree, test output gắn đúng HEAD/environment và tài liệu dưới `documents/05-testing/` | Ghi command, timestamp, branch, HEAD, environment; không dùng bằng chứng của HEAD khác để chứng minh HEAD hiện tại |

Base-path được giữ theo path key thực tế của OpenAPI hiện tại. Không tự thêm prefix `/api/v1` vào tên endpoint trong contract plan; server URL của OpenAPI hiện chứa prefix đó nhưng path key là `/auth/...` và `/kyc/...`.

### 13.4. Đối chiếu hiện trạng với canonical contract

Các điểm `PARTIAL` hoặc `CONFLICT` của M01-01 vẫn còn trong source tại HEAD hiện tại; M01-02 không sửa chúng. Đối chiếu tĩnh xác nhận các điểm chính sau:

- Mobile `validateKycDraft` hiện còn giới hạn identity theo pattern 9–12 chữ số, trong khi Backend/OpenAPI đã dùng 6–24 chữ số.
- Mobile hiện chỉ kiểm tra document URI không rỗng, trong khi contract Backend/OpenAPI yêu cầu `mock://` hoặc `synthetic://`.
- Backend `publicApplication`, Mobile `KycApplication` và `isKycApplication` hiện còn dùng `identityNumber`; canonical contract chuyển response sang `identityNumberLast4` đúng bốn chữ số.
- Route verify registration hiện cần runtime guard đầy đủ để body sai hoặc thiếu field luôn trả 422; các cast TypeScript không đủ thay thế runtime validation.
- OpenAPI hiện chưa có route cancel canonical; `POST /auth/register/cancel` là contract đã chốt để M01-04 triển khai, với challenge/device/purpose và response contract ở task này.
- `RegisterScreen` hiện chỉ xóa challenge trong local state; chưa có server cancel/reconcile an toàn sau restart.
- `KycScreen` hiện chưa có retry initial load và chưa phân biệt đầy đủ `REJECTED` với `NEEDS_MORE_INFO` trong hành vi UI/error.
- Registration challenge/form/proof hiện phụ thuộc React state; password, OTP và proof không được persist. Cần thiết kế metadata restart tối thiểu, nếu security review cho phép, cùng cancel/reconcile an toàn.
- `getRateLimitKey` và audit registration cần được xử lý theo D-13; không được lưu raw IP/email/phone hoặc unkeyed hash.
- Chưa có screen-level test đầy đủ cho Register/KYC và chưa có bằng chứng mới của PostgreSQL concurrency hoặc emulator E2E ở task này.

### 13.5. Canonical decision matrix

| Decision ID | Quyết định canonical | Hành vi/giới hạn bắt buộc |
| ----------- | -------------------- | ------------------------- |
| D-01 | Identity number hợp lệ gồm 6–24 chữ số | Mobile, Backend và OpenAPI phải dùng cùng pattern; không suy diễn thêm định dạng |
| D-02 | Document URI chỉ nhận `mock://` hoặc `synthetic://` | Runtime validator và Backend từ chối scheme khác |
| D-03 | KYC response chỉ dùng `identityNumberLast4` | `identityNumberLast4` luôn đúng bốn chữ số; không trả `identityNumber` đầy đủ |
| D-04 | Full identity là write-only | Không đưa full identity vào response, persistence Mobile hoặc log |
| D-05 | Runtime validator chỉ chấp nhận enum chính thức trong OpenAPI | Không giữ alias ngoài contract chỉ vì tương thích ngầm |
| D-06 | Verify body sai hoặc thiếu field trả 422 | Phải có runtime body guard trước khi gọi service |
| D-07 | Duplicate registration race trả 409 | Constraint/transaction/service phải cho kết quả deterministic; không tạo customer/account trùng |
| D-08 | Registration cancel dùng `POST /auth/register/cancel` | Path được ghi theo base-path convention thực tế của repository |
| D-09 | Cancel yêu cầu `challengeId` và `X-Device-ID`, idempotent | Chỉ hủy challenge/pending đúng device và purpose; terminal/expired/cancelled lặp lại vẫn 204; registration đã hoàn thành trả 409 |
| D-10 | KYC `DRAFT` là payload đầy đủ và hợp lệ đã lưu nhưng chưa submit | Không biến DRAFT thành cơ chế lưu form thiếu field |
| D-11 | `REJECTED` là terminal đối với application hiện tại | Cho phép application mới ở DRAFT; record REJECTED cũ immutable; tối đa một application đang mở |
| D-12 | Registration restart không lưu dữ liệu bí mật | Không persist password, OTP hoặc proof; chỉ persist metadata tối thiểu nếu security review cho phép |
| D-13 | Audit/rate-limit identifier phải an toàn | Chỉ dùng keyed fingerprint đã security-review hoặc loại bỏ; không dùng unkeyed hash của IP/email/phone; không thêm secret/config trong M01-02 |
| D-14 | KYC phải có field error mapping và trạng thái rõ | Initial load có retry; `REJECTED` phải khác `NEEDS_MORE_INFO`; không gom mọi lỗi thành một thông báo mất ngữ nghĩa |
| D-15 | KYC update privacy | `identityNumberLast4` đúng bốn chữ số; Mobile không gửi last4 như full identity; bỏ `identityNumber` khi không đổi; Backend giữ identity hiện tại; đổi identity phải nhập full 6–24 chữ số; full identity không xuất hiện trong response, Mobile persistence hoặc log |

### 13.6. Impact matrix bắt buộc

| Decision ID | Hiện trạng | Mục tiêu | File/symbol bị tác động | Breaking/non-breaking | Migration cần thiết | Test bắt buộc | Task implementation |
| ----------- | ---------- | -------- | ----------------------- | --------------------- | ------------------- | ------------- | ------------------- |
| D-01 | Mobile validator còn 9–12; Backend/OpenAPI là 6–24 | Một pattern 6–24 ở cả ba lớp | `mobile-app/src/features/kyc/validation/kycValidators.ts::validateKycDraft`<br>`backend/src/database/kycService.ts::normalizeInput`<br>`documents/api/banking-mvp.openapi.yaml::KycApplicationRequest` | Breaking với client cũ ngoài khoảng; canonical với client hợp lệ | Không mặc định migration; chỉ tạo migration nếu kiểm tra schema chứng minh cần constraint mới | Validator boundary 5/6/24/25; HTTP valid/invalid; OpenAPI | M01-03 |
| D-02 | Mobile chỉ kiểm tra non-empty; Backend/OpenAPI đã kiểm tra scheme | Chỉ `mock://` hoặc `synthetic://` ở client, runtime và API | `mobile-app/src/features/kyc/validation/kycValidators.ts::validateKycDraft`<br>`backend/src/database/kycService.ts::normalizeInput`<br>`documents/api/banking-mvp.openapi.yaml::KycApplicationRequest` | Breaking với scheme khác | Không | Validator scheme; 422 runtime; OpenAPI contract | M01-03 |
| D-03 | Response Backend/Mobile còn `identityNumber` | Response chỉ có `identityNumberLast4` đúng 4 chữ số | `backend/src/database/kycService.ts::publicApplication`<br>`mobile-app/src/features/kyc/validation/kycResponseValidators.ts::isKycApplication`<br>`mobile-app/src/features/kyc/types/kyc.ts::KycApplication`<br>`documents/api/banking-mvp.openapi.yaml::KycApplication` | Breaking response field; cần cập nhật đồng bộ | Không nếu chỉ đổi projection; kiểm tra schema history trước khi tạo migration | Response allow-list; last4 shape; không full identity; KYC API test | M01-03 |
| D-04 | Full identity còn xuất hiện trong response/type/state | Full identity write-only, không response/Mobile persistence/log | `backend/src/database/kycService.ts::publicApplication`<br>`mobile-app/src/features/kyc/types/kyc.ts::KycApplication`<br>`mobile-app/src/features/kyc/services/kycApi.ts::{getKycApplication,saveKycDraft,submitKycApplication}` | Breaking với consumer đọc field cũ; non-breaking với privacy contract mới | Không | Response redaction; storage/log scan; update without identity giữ identity server-side | M01-03, M01-05 |
| D-05 | Auth response validator còn chấp nhận alias/method ngoài canonical | Chỉ enum đã khai báo trong OpenAPI | `mobile-app/src/features/auth/services/authResponseValidators.ts::{isRegistrationChallengeResponse,isAuthChallengeMethod}`<br>`mobile-app/src/features/auth/types/auth.ts::{AuthChallengeMethod,AuthChallengePurpose}`<br>`documents/api/banking-mvp.openapi.yaml` | Breaking với alias chưa được phê duyệt | Không | Enum acceptance/rejection; response contract | M01-03 |
| D-06 | Verify route còn cast body field, chưa bảo đảm runtime 422 cho mọi malformed body | Guard body trước service, sai/thiếu field trả 422 | `backend/src/http.ts::readJson`<br>`backend/src/http.ts::POST /auth/register/verify route branch`<br>`backend/src/database/registrationService.ts::RelationalRegistrationService.verify` | Non-breaking với request hợp lệ; thay đổi lỗi malformed thành 422 | Không | Missing/wrong type/extra invalid field; valid verify; no secret echo | M01-04 |
| D-07 | Có repository lookup/unique path nhưng concurrency evidence hiện chưa chạy mới | Duplicate race deterministic 409, không tạo bản ghi trùng | `backend/src/database/registrationService.ts::RelationalRegistrationService.{begin,complete}`<br>`backend/src/database/repositories/customerRepository.ts::{findCustomerByEmail,findCustomerByPhone,createPendingRegistration,lockPendingRegistration}` | Non-breaking với registration hợp lệ; deterministic conflict | Kiểm tra migration 007/011 và unique constraints; chỉ thêm forward migration nếu thiếu | Concurrent registration; unique violation mapping; restart/retry | M01-04, M01-07 |
| D-08 | OpenAPI/source hiện chưa có cancel route canonical | Có `POST /auth/register/cancel` theo path key thực tế | `backend/src/http.ts::registration route dispatch`<br>`mobile-app/src/features/auth/services/authApi.ts`<br>`documents/api/banking-mvp.openapi.yaml` | Additive endpoint; contract change bắt buộc đồng bộ | Kiểm tra challenge/pending status schema; migration chỉ khi thiếu trạng thái | Route exact-match; OpenAPI; API client contract | M01-04 |
| D-09 | Mobile chỉ `setRegistrationChallenge(null)`; chưa cancel server | Cancel challenge/pending đúng device/purpose, idempotent và không hủy completed | `mobile-app/src/features/auth/screens/RegisterScreen.tsx::{handleRegister,handleResendRegistrationChallenge}`<br>`backend/src/mfa/persistentMfaService.ts::{verifyChallenge,resendRegistrationChallenge}`<br>`backend/src/database/registrationService.ts::{begin,verify,complete}` | Behavioral hardening; completed registration không bị ảnh hưởng | Kiểm tra migration 007/015/018; chỉ thêm migration nếu status/ownership chưa đủ | 204 success/repeat; 404 redacted mismatch; 409 completed; wrong device/purpose; race | M01-04, M01-07 |
| D-10 | Backend có saveDraft nhưng UI/contract chưa chốt rõ payload đầy đủ hợp lệ | DRAFT chỉ được lưu sau validation đầy đủ, chưa submit | `backend/src/database/kycService.ts::{saveDraft,get,submit}`<br>`mobile-app/src/features/kyc/screens/KycScreen.tsx::{loadApplication,handleSubmit}`<br>`documents/api/banking-mvp.openapi.yaml::KycApplicationRequest` | Clarification; có thể ảnh hưởng client gửi thiếu field | Kiểm tra migration 038; không thêm migration nếu cột hiện tại đủ | Complete-valid draft save; incomplete rejection; reload retains draft; submit transition | M01-05, M01-07 |
| D-11 | Backend/admin có status path nhưng policy resubmit còn phải chốt đồng bộ | REJECTED immutable terminal; application mới DRAFT; tối đa một open | `backend/src/database/kycService.ts::{submit,get}`<br>`backend/src/admin/repositories/adminRepository.ts::{claimApplication,executeApprovedAction}`<br>`backend/database/038_customer_kyc_runtime.sql` | Breaking với code mutate record REJECTED; nghiệp vụ mới rõ ràng | Verify partial unique open index/status history; forward migration only if gap found | REJECTED no reverse transition; new DRAFT; one-open constraint; four-eyes admin | M01-05, M01-07 |
| D-12 | Registration state chỉ ở React state; không persist secret | Restart không tạo request mới khi challenge chưa xác định; cancel/reconcile an toàn; không persist password, OTP hoặc proof | `mobile-app/src/features/auth/screens/RegisterScreen.tsx::{handleRegister,handleResendRegistrationChallenge}`<br>`mobile-app/src/features/auth/services/authApi.ts::{register,verifyRegistrationChallenge,resendRegistrationChallenge}`<br>`backend/src/mfa/persistentMfaService.ts::{createEmailChallenge,verifyChallenge}` | Non-breaking security hardening; có thể thay đổi resume UX | Không | Restart/reconcile; no secret storage/log; stale challenge; duplicate submit | M01-04, M01-08 |
| D-13 | Registration audit nhận `rateLimitKey`; nguy cơ raw identifier hoặc unkeyed hash | Keyed fingerprint đã review hoặc bỏ identifier; không thêm secret/config ở M01-02 | `backend/src/http.ts::getRateLimitKey`<br>`backend/src/database/registrationService.ts::RelationalRegistrationService.begin` | Non-breaking nếu chỉ redaction/keying; cần security review | Không | Audit payload scan; raw IP/email/phone rejection; rate-limit behavior | M01-04 |
| D-14 | KYC UI general error, initial load chưa retry, status message chưa đủ | Field error mapping, retry initial load, REJECTED khác NEEDS_MORE_INFO | `mobile-app/src/features/kyc/screens/KycScreen.tsx::{loadApplication,handleSubmit}`<br>`mobile-app/src/features/kyc/services/kycApi.ts::{getKycApplication,saveKycDraft,submitKycApplication}`<br>`mobile-app/src/features/kyc/validation/kycResponseValidators.ts::isKycApplication` | Non-breaking UX/error refinement | Không | Field error mapping; retry; offline/timeout/401; status rendering | M01-05 |
| D-15 | KYC update còn full identity trong response/type; update contract chưa phân biệt unchanged/changed | Last4 đúng 4; bỏ identity khi unchanged; đổi identity phải full 6–24; không full identity ở response/persistence/log | `backend/src/database/kycService.ts::{normalizeInput,saveDraft,publicApplication}`<br>`mobile-app/src/features/kyc/services/kycApi.ts::{saveKycDraft,submitKycApplication}`<br>`mobile-app/src/features/kyc/validation/kycValidators.ts::validateKycDraft` | Breaking privacy contract; valid unchanged update vẫn được hỗ trợ | Kiểm tra schema 038; migration chỉ khi persistence cần tách/đổi constraint | Unchanged omit; changed full value; last4 exactly 4; response/storage/log redaction | M01-03, M01-05 |

### 13.7. Dependency và thứ tự implementation

1. **M01-03 — Đồng bộ KYC contract/privacy:** cập nhật canonical request/response, validator, projection và test của chính các file/symbol được sửa. Không trả full identity.
2. **M01-04 — Sửa Registration contract/recovery:** runtime 422, conflict 409, cancel server-side, device/purpose binding, restart/reconcile và keyed fingerprint hoặc loại bỏ identifier. Task này phải thêm test cho mọi code thay đổi.
3. **M01-05 — Hoàn thiện KYC UI/state/error:** DRAFT đầy đủ, update privacy, retry initial load, field error mapping và phân biệt status. Task này phải thêm test cho mọi code thay đổi.
4. **M01-06 — Bù coverage còn thiếu:** chỉ xử lý coverage còn thiếu sau M01-03 đến M01-05; không dùng M01-06 để trì hoãn test bắt buộc của task implementation.
5. **M01-07 — Disposable PostgreSQL verification:** chạy migration từ database rỗng, kiểm tra history/checksum, row lock, unique constraint, transaction, restart safety và concurrency bằng dữ liệu synthetic; không dùng database preview có dữ liệu người dùng.
6. **M01-08 — Emulator E2E verification:** chạy đăng ký, cancel/restart/reconcile, KYC, transfer, savings và credit bằng dữ liệu synthetic; không đưa password, OTP, token hoặc full identity vào screenshot/log/evidence.
7. **M01-09 — Audit và đóng UC-M01:** audit lại source/API/Mobile/database/evidence theo đúng HEAD/environment; chỉ đóng UC-M01 khi các conflict đã có test/evidence tương ứng và không còn acceptance criterion chưa đạt.

M01-03, M01-04 và M01-05 bắt buộc tự bổ sung test cho code thay đổi trong chính task đó. M01-06 chỉ xử lý phần coverage còn thiếu sau khi các task trước đã có regression test.

### 13.8. Acceptance criteria của M01-02

- D-01 đến D-15 được ghi rõ, không còn lựa chọn policy mơ hồ cho REJECTED.
- KYC response canonical chỉ có `identityNumberLast4` đúng bốn chữ số; full identity là write-only.
- Cancel contract cố định `POST /auth/register/cancel`, challenge/device/purpose-bound, idempotent, không ảnh hưởng completed registration và không có body nhạy cảm.
- Registration restart behavior không persist password, OTP hoặc proof; không tự tạo request mới khi challenge cũ chưa xác định.
- Source of truth được phân loại theo database, API, Mobile và evidence.
- Impact matrix dùng repo-relative path và symbol/route branch đã xác minh; migration/test/task implementation được chỉ rõ cho từng decision.
- Dependency M01-03 đến M01-09 và nguyên tắc test cùng task đã được chốt.
- Không sửa file repository nào ngoài chính task M01-02; không sửa source, OpenAPI, migration hoặc test trong task này.

### 13.9. Kiểm tra đã chạy tại HEAD hiện tại

- Mobile: `npm test -- --runInBand src/features/auth/services/__tests__/authApi.test.ts src/features/auth/validation/__tests__/authValidation.test.ts src/features/kyc/validation/__tests__/kycValidators.test.ts` — **59/59 PASS**.
- Mobile: `npx tsc --noEmit` — **PASS**.
- Mobile: `node scripts/validate-openapi.cjs` — **PASS**, 46 required paths.
- Mobile: `node scripts/validate-maestro.cjs` — **PASS**, 19 flows syntax valid.
- Backend: `node --import=tsx --test src/tests/relationalHttpBoundary.test.ts src/tests/relationalHttpCutover.test.ts src/tests/http.test.ts` — **19/19 PASS**.
- Backend: `node scripts/validate-openapi.cjs` — **PASS**, 54 required paths và 60 exact method/segment guards.
- Repository: `git diff --check` — **PASS**.

Chưa chạy trong M01-02: disposable PostgreSQL integration/concurrency, migration reset, worker, emulator/device E2E, staging hoặc external provider. Đây là phần được giao cho M01-07/M01-08 và không phải bằng chứng thất bại của decision task.

### 13.10. Blocker và rủi ro bàn giao

- Không có blocker ngăn hoàn thành M01-02 ở chế độ `DIAGNOSE_AND_PLAN`.
- Implementation vẫn bị chặn theo phạm vi công việc cho đến khi M01-03, M01-04 và M01-05 được thực hiện; các task đó phải tuân thủ decision matrix này.
- `POST /auth/register/cancel` chưa tồn tại trong OpenAPI/source hiện tại; đây là gap implementation đã ghi nhận, không được giả vờ là đã có.
- KYC response/privacy, Mobile validation và restart/cancel hiện chưa đạt canonical target; chưa được tuyên bố hoàn thành nghiệp vụ.
- Keyed fingerprint và metadata restart cần security review khi implementation; M01-02 không tự thêm secret/config.
- Bằng chứng test hiện tại chỉ chứng minh các kiểm tra chỉ-đọc nêu trên tại HEAD; không chứng minh emulator, PostgreSQL concurrency hay staging.

### 13.11. Hướng dẫn bàn giao và Decision result

Khi một task implementation hoàn thành, task đó phải ghi evidence gắn đúng branch/HEAD/environment và tự thêm regression test cho code đã sửa. M01-09 phải audit lại toàn bộ decision matrix, impact matrix, test và evidence trước khi đóng UC-M01.

Kết quả M01-02:

- Đã hoàn thành chẩn đoán và lập decision/contract plan.
- Đã ghi canonical decision matrix, impact matrix, dependency, acceptance criteria, blocker và lệnh kiểm tra.
- Chưa implementation bất kỳ source, OpenAPI, migration hoặc test nào.
- Trong phiên này chỉ cập nhật file `tasks/UC-M01/TASK_M01_02_DECIDE_REGISTRATION_KYC_CONTRACT.md`, gồm trạng thái và mục `Decision result` theo quyền được cấp.
- Không stage và không commit.
- Không ghi secret, password, OTP, proof hoặc dữ liệu người dùng thật.

## 14. Owner clarification after M01-03

Ngày xác nhận: 2026-09-02 (Asia/Bangkok).

- M01-03 đã hoàn tất phần KYC thuộc D-05 và không làm thay đổi ownership của Registration challenge. Implementation checkpoint của M01-03 là 35da22d832676a54cd2d8598feed8e1aa5b34fe6.
- M01-04 sở hữu Registration slice của D-05, cùng D-06, D-07, D-08, D-09, D-12 và D-13. M01-04 không sở hữu D-10, D-11, D-14 hoặc D-15.
- Registration challenge canonical mà M01-04 phải đồng bộ là method EMAIL_OTP và purpose REGISTRATION_EMAIL_VERIFY. Registration flow không được tiếp tục chấp nhận alias hoặc method ngoài contract canonical.
- Trước khi sửa validator dùng chung, M01-04 phải quét toàn bộ consumer và regression test của login, recovery và biometric. Nếu sửa validator dùng chung có thể ảnh hưởng các flow đó, phải dùng validator theo Registration flow hoặc dừng để xin owner quyết định; không tự thu hẹp global enum.
- Test boundary của M01-04 là unit, contract và HTTP fake, cùng lint, typecheck, build và OpenAPI. Disposable PostgreSQL, migration, row lock, transaction, race và idempotency thật thuộc M01-07. Emulator, Maestro, restart/resume UI thuộc M01-08.
- Với D-13, M01-04 phải loại bỏ identifier nếu không cần. Nếu retry hoặc reconcile bắt buộc phải có identifier, phải dừng và xin owner quyết định về keyed fingerprint hoặc server-side secret. Không hard-code key, không dùng EXPO_PUBLIC_* và không dùng unkeyed hash.
- Mục này chỉ làm rõ ownership sau M01-03; không sửa lại hoặc thay thế bất kỳ canonical decision D-01 đến D-15 nào trong các mục trước.

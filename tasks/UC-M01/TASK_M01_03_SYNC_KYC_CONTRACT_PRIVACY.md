# TASK M01-03 — Đồng bộ KYC contract và privacy

Trạng thái: `COMPLETED`
Ưu tiên: `P1`
Chế độ: `IMPLEMENT_AND_VERIFY`

## 1. Mục tiêu

Đồng bộ contract KYC giữa:

- OpenAPI.
- Backend input validation.
- Backend public response mapper.
- Mobile request/response types.
- Mobile validators.
- Contract/unit tests.

Mục tiêu bảo mật bắt buộc: API tuyệt đối không trả `identityNumber` đầy đủ.

Không được chỉ sửa OpenAPI rồi để Backend và Mobile tiếp tục sử dụng contract cũ.

## 2. Phạm vi sở hữu

M01-03 sở hữu các quyết định:

- D-01: `identityNumber` hợp lệ gồm 6–24 chữ số.
- D-02: `documentUri` chỉ sử dụng scheme `mock://` hoặc `synthetic://`.
- D-03: KYC response chỉ trả `identityNumberLast4`, đúng bốn chữ số.
- D-04: Không trả full identity number trong response.
- Phần KYC của D-05: runtime validator chỉ chấp nhận enum canonical trong OpenAPI.
- D-15:
  - Update không đổi identity được phép bỏ `identityNumber`.
  - Backend giữ identity hiện tại nếu field bị bỏ.
  - Nếu đổi identity, phải gửi lại full value 6–24 chữ số.
  - Full identity không xuất hiện trong response, Mobile persistence hoặc log.

Trong phạm vi KycScreen, M01-03 được phép xử lý riêng identity flow:

- Hiển thị `identityNumberLast4` ở dạng masked.
- Theo dõi identity có được người dùng thay đổi hay không.
- Create application phải gửi full identity.
- Update không đổi identity phải bỏ hẳn `identityNumber`.
- Update đổi identity phải yêu cầu full value 6–24 chữ số.
- Không dùng last4 hoặc masked value làm full identity.

Không sở hữu các phần sau:

- Registration cancel, restart hoặc duplicate registration.
- KYC field-error, retry và status UX ngoài thay đổi cần thiết để compile.
- KYC lifecycle `REJECTED`, resubmit hoặc one-open application.
- Database migration nếu chưa có bằng chứng bắt buộc.
- Admin Web.
- CI, dependency, infrastructure, worker hoặc scheduler.
- Maestro flow và emulator E2E.
- Auth challenge enum ngoài phần KYC của D-05.

## 3. Kiểm tra bắt buộc trước khi sửa

Trước khi implementation phải kiểm tra và ghi lại:

- Current working directory.
- Branch.
- HEAD.
- `git status --short --branch`.
- Các file đang modified hoặc untracked.
- WIP cần bảo vệ.

Không được giả định HEAD hoặc trạng thái M01-02 trong `PROJECT_CONTEXT.md` là hiện trạng mới nhất.

Phải đọc lại:

- `AGENTS.md`
- `PROJECT_CONTEXT.md`
- `TASK_TEMPLATE.md`
- `mobile-app/AGENTS.md`
- `mobile-app/README.md`
- `backend/README.md`
- `tasks/UC-M01/TASK_M01_01_AUDIT_REGISTRATION_KYC.md`
- `tasks/UC-M01/TASK_M01_02_DECIDE_REGISTRATION_KYC_CONTRACT.md`

Không sử dụng `git reset`, `git restore`, `git checkout`, `git clean`, xóa hoặc ghi đè WIP.

## 4. Hiện trạng cần xác minh

Các điểm đã được M01-02 ghi nhận và phải kiểm tra lại tại HEAD thực tế:

- `mobile-app/src/features/kyc/validation/kycValidators.ts::validateKycDraft` còn kiểm tra identity theo 9–12 chữ số.
- `backend/src/database/kycService.ts::normalizeInput` đang dùng 6–24 chữ số.
- Mobile chỉ kiểm tra `documentUri` không rỗng.
- Backend yêu cầu `mock://` hoặc `synthetic://`.
- `backend/src/database/kycService.ts::publicApplication` còn trả `identityNumber`.
- Mobile `KycApplication` và `isKycApplication` còn yêu cầu `identityNumber`.
- OpenAPI response schema còn khai báo `identityNumber`.
- KYC request hiện yêu cầu `identityNumber` trong mọi trường hợp, chưa hỗ trợ update unchanged.
- Chưa có response-validator test riêng cho KYC.

## 5. Data flow hiện tại

```text
KycScreen form state
  → KycDraft
  → kycApi.requireDraft
  → requestJson(/kyc/application)
    hoặc requestJson(/kyc/application/submit)
  → Backend route/relational boundary
  → RelationalKycService.normalizeInput
  → synthetic_payload trong PostgreSQL
  → publicApplication
  → response có identityNumber đầy đủ
  → Mobile KycApplication/isKycApplication
  → KycScreen hiển thị/mask dữ liệu
```

Các vấn đề hiện tại:

- Contract Mobile và Backend khác nhau về độ dài identity.
- Response chứa full identity.
- Mobile có thể coi identity trong response là dữ liệu nhập lại.
- Request chưa phân biệt tạo mới, update không đổi identity và update đổi identity.
- Response validator không chặn field `identityNumber` đầy đủ.

## 6. Data flow kỳ vọng

### 6.1. Tạo application mới

```text
Mobile nhập full identity tạm thời trong form
  → request có identityNumber
  → Backend kiểm tra 6–24 chữ số
  → lưu theo cơ chế persistence hiện tại
  → public response chỉ có identityNumberLast4
  → Mobile chỉ lưu application projection không chứa full identity
```

Nếu tạo mới mà thiếu `identityNumber`, Backend trả `422`.

### 6.2. Update application không đổi identity

```text
Mobile nhận identityNumberLast4
  → không dùng last4 làm identityNumber
  → request bỏ hẳn field identityNumber
  → Backend khóa application hiện tại
  → giữ full identity đang lưu trên server
  → response chỉ có identityNumberLast4
```

Các trường hợp sau không được coi là bỏ qua identity:

- `identityNumber` rỗng.
- `identityNumber: null`.
- `identityNumber` bằng last4.
- Identity đã mask một phần.

Các giá trị trên phải bị từ chối hoặc không được gửi tùy lớp, nhưng không được dùng để thay thế full identity.

### 6.3. Update application có thay đổi identity

```text
Mobile yêu cầu người dùng nhập lại full identity
  → request có identityNumber đầy đủ
  → Backend kiểm tra 6–24 chữ số
  → cập nhật persistence hiện tại
  → response chỉ có identityNumberLast4 mới
```

### 6.4. Response

Mọi response từ:

- `GET /kyc/application`
- `POST /kyc/application`
- `POST /kyc/application/submit`

phải:

- Có `identityNumberLast4`.
- `identityNumberLast4` đúng bốn chữ số.
- Không có key `identityNumber`.
- Không chứa full identity trong bất kỳ nested object nào.

Endpoint phải ghi theo path key thực tế của OpenAPI. Không tự thêm prefix `/api/v1`.

## 7. Canonical request contract

OpenAPI phải thể hiện rõ:

- `fullName`: bắt buộc.
- `address`: bắt buộc.
- `documentUri`: bắt buộc.
- `syntheticDataConfirmed`: bắt buộc và chỉ nhận `true`.
- `identityNumber`:
  - Bắt buộc khi tạo application mới.
  - Có thể bỏ khi update application hiện có và không đổi identity.
  - Nếu có mặt thì phải là full value gồm 6–24 chữ số.
  - Không chấp nhận last4 hoặc masked value.

Do OpenAPI không biết request đang tạo mới hay update application hiện có, việc `identityNumber` có bắt buộc hay không phải được kiểm tra theo context tại Backend runtime.

`identityNumber` trong request là write-only.

`documentUri` chỉ được dùng một trong hai scheme canonical:

- `mock://`
- `synthetic://`

Không chấp nhận:

- URI rỗng.
- `http://`.
- `https://`.
- Scheme không nằm trong danh sách canonical.
- Giá trị không phải string.

## 8. Canonical response contract

Schema `KycApplication` phải:

- Xóa `identityNumber` khỏi response properties và required list.
- Thêm `identityNumberLast4`.
- Khai báo `identityNumberLast4` là string, read-only.
- Ràng buộc `identityNumberLast4` đúng bốn chữ số.
- Không cho phép additional response property chứa full identity nếu contract hiện tại hỗ trợ giới hạn property.

Các field không liên quan như `id`, `userId`, `fullName`, `address`, `documentUri`, `status`, `rejectionReason`, `submittedAt`, `updatedAt` và `version` chỉ được giữ nếu vẫn phù hợp với OpenAPI hiện tại.

KYC status chỉ được nhận enum canonical:

- `DRAFT`
- `SUBMITTED`
- `UNDER_REVIEW`
- `NEEDS_MORE_INFO`
- `APPROVED`
- `REJECTED`

Không thêm alias hoặc status mới trong M01-03.

## 9. File được phép sửa

| File                                                                             | Symbol/phạm vi được sửa                                                                                                                                      | Giới hạn                                                                                          |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `tasks/UC-M01/TASK_M01_03_SYNC_KYC_CONTRACT_PRIVACY.md`                          | Trạng thái đầu file và mục `Decision result`                                                                                                                 | Chỉ đổi trạng thái, điền/cập nhật Decision result                                                 |
| `documents/api/banking-mvp.openapi.yaml`                                         | `KycApplicationRequest`, `KycApplication`, `KycApplicationResponse` và reference của hai KYC operation                                                       | Không sửa API ngoài KYC                                                                           |
| `backend/src/database/kycService.ts`                                             | `CustomerKycInput`, `CustomerKycApplication`, `normalizeInput`, `publicApplication`, `RelationalKycService.get`, `saveDraft`, `submit`                       | Không đổi lifecycle ngoài phạm vi contract                                                        |
| `mobile-app/src/features/kyc/types/kyc.ts`                                       | `KycApplication`, `KycDraft`, `KycStatus`                                                                                                                    | Tách rõ request/form type và response type nếu cần                                                |
| `mobile-app/src/features/kyc/services/kycApi.ts`                                 | `requireDraft`, `getKycApplication`, `saveKycDraft`, `submitKycApplication`                                                                                  | Không gửi last4 như full identity                                                                 |
| `mobile-app/src/features/kyc/validation/kycValidators.ts`                        | `validateKycDraft`, `hasKycFieldErrors`                                                                                                                      | Đồng bộ pattern 6–24 và document URI                                                              |
| `mobile-app/src/features/kyc/validation/kycResponseValidators.ts`                | `isKycApplication`, `isKycApplicationResponse`                                                                                                               | Chỉ chấp nhận response có last4, từ chối full identity                                            |
| `mobile-app/src/features/kyc/screens/KycScreen.tsx`                              | Identity flow: masked `identityNumberLast4`, theo dõi thay đổi, create gửi full identity, update unchanged bỏ field, update changed yêu cầu full 6–24 chữ số | Không sửa field-error/retry/status hoặc lifecycle UX ngoài phần cần thiết cho contract và compile |
| `mobile-app/src/features/kyc/validation/__tests__/kycValidators.test.ts`         | Test validator hiện có                                                                                                                                       | Bổ sung boundary và URI cases                                                                     |
| `mobile-app/src/features/kyc/validation/__tests__/kycResponseValidators.test.ts` | File test mới                                                                                                                                                | Test response allow-list và privacy                                                               |
| `mobile-app/src/features/kyc/services/__tests__/kycApi.test.ts`                  | File test mới                                                                                                                                                | Test request serialization                                                                        |
| `backend/src/tests/kycContract.test.ts`                                          | File test mới                                                                                                                                                | Test input, mapper và privacy contract                                                            |
| `mobile-app/src/features/kyc/screens/__tests__/KycScreen.test.tsx` | File test mới cho identity flow của `KycScreen` | Dùng test stack hiện có; không thêm dependency |

Có thể tạo các file test mới nêu trên. Không được thêm dependency mới.

### 9.1. Kiểm tra dependency của KYC schema trước khi sửa OpenAPI

Trước khi sửa `KycApplication` hoặc schema KYC liên quan, phải:

1. Tìm tất cả `$ref` đến `KycApplication`, `KycApplicationResponse`, `KycApplicationRequest` và schema con.
2. Tìm toàn bộ endpoint sử dụng các schema đó.
3. Xác định ảnh hưởng đến Public API, Admin API và contract khác.
4. Nếu schema dùng chung, ưu tiên tạo public KYC response schema riêng trong cùng file OpenAPI để không phải sửa Admin runtime.
5. Nếu cần sửa Admin source hoặc runtime, dừng task và chuyển trạng thái `BLOCKED` để báo owner.
6. Không thay đổi Admin contract ngoài phạm vi.
7. Bổ sung test xác nhận endpoint ngoài KYC không đổi path, method, schema reference hoặc response contract.

## 10. File tuyệt đối không được sửa

- `backend/database/*.sql`.
- Các migration 001–040.
- `backend/src/http.ts`.
- `backend/src/database/relationalHttpBoundary.ts`.
- `backend/src/database/repositories/**`.
- `backend/src/database/registrationService.ts`.
- `backend/src/mfa/**`.
- `mobile-app/src/features/auth/**`.
- `mobile-app/e2e/**`.
- `admin-web/**`.
- `backend/src/workers/**`.
- Outbox, scheduler và notification provider.
- `.github/workflows/**`.
- `infrastructure/**`.
- `observability/**`.
- `performance/**`.
- `package.json`, lockfile và cấu hình dependency.
- `.env`, `.env.*`, secret registry và runtime secret.
- `artifacts/**`.
- Tài liệu khác ngoài `documents/api/banking-mvp.openapi.yaml`.

Nếu cần sửa ngoài danh sách, phải dừng và báo owner; không tự mở rộng phạm vi.

## 11. Kế hoạch implementation

1. Kiểm tra source và WIP tại HEAD thực tế.
2. Đối chiếu OpenAPI, Backend và Mobile hiện trạng.
3. Viết hoặc cập nhật test contract trước khi đổi implementation.
4. Tìm tất cả `$ref` và endpoint sử dụng KYC schema; phân loại Public API, Admin API và contract khác trước khi sửa OpenAPI.
5. Cập nhật OpenAPI KYC request/response mà không thay đổi contract ngoài KYC.
6. Cập nhật Backend:
   - Validation 6–24.
   - Validation document URI.
   - Contextual handling của identity bị bỏ.
   - Public mapper chỉ tạo last4.
   - Không serialize full identity.
7. Cập nhật Mobile:
   - Response type dùng `identityNumberLast4`.
   - Request type cho phép bỏ identity trong update unchanged.
   - Không dùng last4 làm request identity.
   - Đồng bộ validators.
   - Cập nhật `KycScreen` chỉ trong identity flow đã được phép.
8. Chạy contract/unit tests và leakage tests.
9. Kiểm tra diff chỉ nằm trong phạm vi cho phép.
10. Bàn giao kết quả, file đã sửa, test và phần còn thiếu.

## 12. Quyết định migration

Hiện tại dự kiến: **không cần migration**.

Lý do:

- Thay đổi chính là API projection và contract.
- Backend vẫn có thể giữ dữ liệu KYC synthetic hiện tại trong `synthetic_payload`.
- `backend/database/038_customer_kyc_runtime.sql` đã có cấu trúc KYC cần thiết cho application hiện tại.
- `identityNumberLast4` có thể được tính từ full identity ở server khi tạo response.
- Không cần thêm cột mới chỉ để thay đổi response.

Phải kiểm tra migration history và schema để xác nhận kết luận, nhưng không được provision, reset, truy cập database remote hoặc chạy database integration/destructive test trong M01-03.

PostgreSQL verification thuộc M01-07. M01-03 chỉ dùng unit test và contract test không cần database thật.

Nếu phát hiện schema không đủ để bảo toàn behavior, M01-03 phải:

- Dừng implementation phần migration.
- Ghi rõ bằng chứng.
- Báo owner.
- Không tự sửa migration cũ.
- Không tự tạo migration mới trong task này.

## 13. Breaking và non-breaking impact

| Hạng mục                                                    | Loại tác động                                           | Yêu cầu                                       |
| ----------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------- |
| Response đổi từ `identityNumber` sang `identityNumberLast4` | Breaking contract                                       | Backend và Mobile phải đổi đồng thời          |
| Response không còn full identity                            | Breaking với consumer đọc field cũ; bắt buộc vì privacy | Response validator phải reject field cũ       |
| Request tạo mới vẫn gửi full identity hợp lệ                | Non-breaking                                            | Giữ behavior hợp lệ hiện tại                  |
| Request update được bỏ identity khi unchanged               | Non-breaking extension                                  | Backend phải giữ giá trị hiện tại             |
| Request gửi last4 thay full identity                        | Breaking/invalid                                        | Trả hoặc map thành lỗi validation, không đoán |
| Document URI chỉ nhận hai scheme canonical                  | Breaking với URI ngoài contract                         | Mobile và Backend phải cùng reject            |
| KYC enum canonical                                          | Breaking với alias/status lạ                            | Không thêm alias để làm test pass             |
| Database schema                                             | Không thay đổi                                          | Không migration nếu không có bằng chứng       |

## 14. Acceptance criteria

### OpenAPI

- `KycApplicationRequest` khai báo đúng các field request.
- `identityNumber` được mô tả là bắt buộc khi tạo mới, optional khi update unchanged.
- `identityNumber` có pattern 6–24 chữ số khi xuất hiện.
- `documentUri` chỉ nhận `mock://` hoặc `synthetic://`.
- `KycApplication` không khai báo `identityNumber`.
- `KycApplication` khai báo `identityNumberLast4` đúng bốn chữ số.
- KYC status chỉ dùng enum canonical.
- Không tự thêm `/api/v1` vào path key.
- Trước khi sửa `KycApplication`, tất cả `$ref` và endpoint sử dụng schema đã được kiểm tra.
- Các endpoint ngoài KYC không thay đổi path, method, schema reference hoặc response contract.
- Nếu KYC schema dùng chung với Admin, phải dùng public KYC response schema riêng nếu có thể.
- Nếu cần sửa Admin source/runtime, task phải chuyển sang `BLOCKED` và báo owner.

### Backend

- Tạo application thiếu identity trả `422`.
- Update application bỏ identity giữ full identity hiện có trên server.
- Update application có identity mới hợp lệ cập nhật đúng identity.
- Identity rỗng, null, masked hoặc chỉ có last4 không được coi là full identity hợp lệ.
- Identity ngoài khoảng 6–24 chữ số trả `422`.
- URI ngoài `mock://` và `synthetic://` trả `422`.
- `GET`, save draft và submit đều không trả key `identityNumber`.
- `identityNumberLast4` luôn là đúng bốn chữ số, bao gồm trường hợp có số 0 ở đầu.
- Response không chứa full identity trong nested object hoặc error payload.

### Mobile

- `KycApplication` không còn field full `identityNumber`.
- `KycApplication` chỉ dùng `identityNumberLast4`.
- Response validator chấp nhận response canonical.
- Response validator từ chối response có `identityNumber`.
- Request builder gửi full identity khi tạo mới hoặc đổi identity.
- Request builder bỏ hẳn `identityNumber` khi update unchanged.
- Mobile không biến `identityNumberLast4` thành `identityNumber`.
- `validateKycDraft` đồng bộ 6–24 chữ số.
- `validateKycDraft` đồng bộ scheme document URI.
- `syntheticDataConfirmed` chỉ chấp nhận giá trị boolean canonical `true`.
- Không persist full identity vào Mobile storage.
- Không ghi full identity vào log hoặc telemetry.
- KycScreen chỉ thay đổi identity flow: masked last4, theo dõi thay đổi, create gửi full identity, update unchanged bỏ field và update changed yêu cầu full 6–24 chữ số.
- Mọi thay đổi identity flow trong `KycScreen` đều có screen test tương ứng.
- Screen test dùng service spy để kiểm tra request payload.
- Không có full identity trong rendered output, snapshot, log hoặc test failure output.
- Test sử dụng hạ tầng hiện có; nếu thiếu test infrastructure và cần dependency mới, task phải chuyển thành `BLOCKED` và báo owner.

### Phạm vi

- Không sửa registration cancel/restart/duplicate.
- Không sửa KYC field-error, retry, `REJECTED`, `NEEDS_MORE_INFO` hoặc lifecycle UX ngoài phần cần thiết cho identity contract và compile.
- Không sửa migration.
- Không sửa Admin Web, CI, worker hoặc Maestro.
- Không thêm dependency.
- Không có thay đổi ngoài danh sách file được phép.

## 15. Test bắt buộc

| Nhóm               | Test cụ thể                                            | Kết quả yêu cầu                                                     |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------------------------- |
| Backend input      | Identity 5, 6, 24 và 25 chữ số                         | Chỉ 6 và 24 hợp lệ                                                  |
| Backend input      | URI `mock://`, `synthetic://`, URI rỗng và scheme khác | Chỉ hai scheme canonical hợp lệ                                     |
| Backend update     | Application mới thiếu identity                         | `422`                                                               |
| Backend update     | Application hiện có bỏ identity                        | Giữ identity server-side                                            |
| Backend update     | Application hiện có đổi identity hợp lệ                | Cập nhật và trả last4 mới                                           |
| Backend update     | Gửi empty, null, masked hoặc last4                     | Không được coi là full identity                                     |
| Backend response   | GET/save/submit                                        | Có last4 đúng 4 chữ số, không có full identity                      |
| Backend privacy    | Serialize response, error và log capture               | Không chứa full identity hoặc secret                                |
| Mobile validator   | Identity boundary và URI scheme                        | Đồng bộ với Backend/OpenAPI                                         |
| Mobile response    | Response có last4                                      | PASS                                                                |
| Mobile response    | Response có `identityNumber`                           | FAIL validation                                                     |
| Mobile request     | Update unchanged                                       | Không có key `identityNumber`                                       |
| Mobile request     | Create/changed identity                                | Có full identity đúng pattern                                       |
| Mobile persistence | State/storage snapshot                                 | Không lưu full identity trong application response/persistent state |
| OpenAPI            | OpenAPI validator                                      | PASS                                                                |
| Regression         | Test hiện có của Backend và Mobile                     | Không có failure ngoài phạm vi                                      |
| KycScreen          | Application hiện có chỉ chứa `identityNumberLast4`       | UI dạng masked, không hiển thị full identity                        |
| KycScreen          | Update unchanged dùng service spy                        | Request không có key `identityNumber`                               |
| KycScreen          | Update changed dùng service spy                          | Request gửi full value mới gồm 6–24 chữ số                         |
| KycScreen          | Create thiếu identity                                    | Không gửi request và hiển thị validation identity                  |
| KycScreen          | Last4/masked và persistence                              | Không dùng làm full identity, không persist full identity           |

## 16. Lệnh kiểm tra phải chạy

Tại `backend/`:

- `npm run typecheck`
- `npm run build`
- `node --import=tsx --test src/tests/kycContract.test.ts`
- `npm test`
- Nếu `backend/package.json` có script `validate:openapi`, chạy `npm run validate:openapi`; nếu không có, chạy `node scripts/validate-openapi.cjs`.
- Không sửa `package.json` để tạo script mới.

Tại `mobile-app/`:

- `npm run lint`
- `npm run typecheck`
- `npm test -- --runInBand src/features/kyc/screens/__tests__/KycScreen.test.tsx src/features/kyc/validation/__tests__/kycValidators.test.ts src/features/kyc/validation/__tests__/kycResponseValidators.test.ts src/features/kyc/services/__tests__/kycApi.test.ts`
- `npm run validate:openapi`
- `npm run export:web`

Tại repository root:

- `git diff --check`
- `git status --short --branch`

Không chạy database integration, disposable PostgreSQL, migration reset, database remote, worker/scheduler, staging hoặc external provider trong M01-03.
Không bắt buộc chạy hoặc chỉnh sửa Maestro trong M01-03.

## 17. Yêu cầu secret/PII leakage test

Test phải dùng dữ liệu synthetic được tạo trong bộ nhớ và không in giá trị ra terminal.

Phải xác nhận:

- Full identity không xuất hiện trong JSON response.
- Full identity không xuất hiện trong error details.
- Full identity không xuất hiện trong log capture.
- Full identity không xuất hiện trong Mobile application response state.
- `identityNumberLast4` chỉ gồm bốn chữ số.
- Không có password, OTP, token, PIN, proof hoặc dữ liệu người dùng thật trong fixture/test output.
- Không đưa full identity vào ảnh chụp, evidence hoặc artifact.

Không dùng unkeyed hash để thay thế việc redaction. Không thêm secret hoặc config mới trong M01-03.

## 18. Yêu cầu bàn giao

Bàn giao phải ghi:

- CWD, branch, HEAD và Git status trước/sau.
- WIP có sẵn trước khi làm.
- Danh sách file đã sửa/tạo.
- Symbol chính đã thay đổi.
- Current data flow và expected data flow.
- Request contract và response contract sau khi sửa.
- Breaking/non-breaking impact.
- Kết luận migration có cần hay không.
- Test đã chạy và kết quả.
- Leakage test đã chạy và kết quả.
- Xác nhận không sửa file ngoài phạm vi.
- Xác nhận tại thời điểm phiên implementation/P2 follow-up: không stage, commit hoặc push.
- Các điểm chưa được kiểm chứng, đặc biệt emulator/Maestro/PostgreSQL nếu chưa chạy.

## 19. Quyền Git và môi trường

- Git stage: `Không` — đây là quyền ban đầu của phiên `IMPLEMENT_AND_VERIFY`.
- Commit: `Không` — đây là quyền ban đầu của phiên `IMPLEMENT_AND_VERIFY`; checkpoint Git sau đó được owner phê duyệt riêng và được ghi tại mục 20.11.
- Push: `Không` — không được phép trong phiên implementation/P2 follow-up.
- Merge/rebase/tag: `Không`.
- Deploy/provision cloud: `Không`.
- Bật worker/scheduler: `Không`.
- Database: `Không provision, reset, truy cập remote hoặc chạy integration/destructive test`; PostgreSQL verification thuộc M01-07.
- M01-03 chỉ được chạy unit/contract test không cần database thật.
- Thêm dependency: `Không`.

## 20. Decision result

Trạng thái thực hiện: `COMPLETED`

Lịch sử trạng thái: `REOPENED_AFTER_REVIEW — P2 FOLLOW-UP REQUIRED`.

Các khoảng trống P2 đã được xử lý trong đúng phạm vi M01-03. Tại thời điểm hoàn tất P2 follow-up, chưa stage, commit hoặc push; checkpoint sau đó được owner phê duyệt riêng tại mục 20.11. Giữ nguyên các thay đổi đã đúng.

### 20.1. Bối cảnh thực hiện và WIP được bảo vệ

- Timestamp kết thúc: `2026-09-02 00:14:32 +07:00` (Asia/Bangkok).
- CWD: `C:\Projects\banking-system`.
- Branch: `codex/staging-academic-completion`.
- Baseline HEAD trước implementation: `c64e5f3e1c9dd2f660669948d21c30745c4f778e`.
- Implementation checkpoint sau commit: `35da22d832676a54cd2d8598feed8e1aa5b34fe6`.
- `git status` trước implementation: branch ahead 11; WIP gồm `AGENTS.md` đang modified và các file untracked `PROJECT_CONTEXT.md`, `TASK_TEMPLATE.md`, `tasks/UC-M01/TASK_M01_01_AUDIT_REGISTRATION_KYC.md`, `tasks/UC-M01/TASK_M01_02_DECIDE_REGISTRATION_KYC_CONTRACT.md`, `tasks/UC-M01/TASK_M01_03_SYNC_KYC_CONTRACT_PRIVACY.md`.
- WIP đã bảo vệ trong thời gian implementation/P2 follow-up: không reset, restore, clean, checkout, stage, commit, push hoặc thay đổi các file WIP ngoài phạm vi. `AGENTS.md`, `PROJECT_CONTEXT.md`, `TASK_TEMPLATE.md`, M01-01 và M01-02 vẫn được giữ nguyên.
- `git status` sau implementation: chỉ xuất hiện các thay đổi KYC trong allowlist của M01-03 cùng WIP nêu trên; không có migration, Admin, CI, infrastructure, dependency hoặc database artifact mới.

### 20.2. File và symbol thực tế đã sửa

Chỉ các file sau thuộc allowlist M01-03 đã được sửa hoặc tạo:

- `documents/api/banking-mvp.openapi.yaml`: KYC operations; `KycApplicationRequest`, `KycApplication`, `KycApplicationResponse`.
- `backend/src/database/kycService.ts`: `CustomerKycInput`, `CustomerKycApplication`, `normalizeInput`, `publicApplication`, `RelationalKycService.saveDraft`, `RelationalKycService.submit` và canonical KYC status guard.
- `backend/src/tests/kycContract.test.ts`: unit tests cho identity boundary, contextual update, document URI, public mapper và privacy.
- `mobile-app/src/features/kyc/types/kyc.ts`: response type `KycApplication.identityNumberLast4` và form type `KycDraft`.
- `mobile-app/src/features/kyc/services/kycApi.ts`: `KycWriteOptions`, `KycWriteRequest`, `requireDraft`, `saveKycDraft`, `submitKycApplication`.
- `mobile-app/src/features/kyc/validation/kycValidators.ts`: `KycValidationOptions`, `validateKycDraft`, `hasKycFieldErrors` với identity 6–24 và URI canonical.
- `mobile-app/src/features/kyc/validation/kycResponseValidators.ts`: `isKycApplication`, `isKycApplicationResponse` chỉ nhận `identityNumberLast4` đúng bốn chữ số và từ chối `identityNumber`.
- `mobile-app/src/features/kyc/screens/KycScreen.tsx`: `identityChanged`, `identityRequired`, masked last4, create/update request behavior và xóa full identity khỏi draft sau khi ghi thành công.
- `mobile-app/src/features/kyc/validation/__tests__/kycValidators.test.ts`: boundary và URI tests.
- `mobile-app/src/features/kyc/validation/__tests__/kycResponseValidators.test.ts`: response allow-list/privacy tests.
- `mobile-app/src/features/kyc/services/__tests__/kycApi.test.ts`: serialized request payload tests.
- `mobile-app/src/features/kyc/screens/__tests__/KycScreen.test.tsx`: screen tests dùng service spy cho unchanged/changed/create-invalid/masked flow.

Không sửa file ngoài allowlist; không sửa Admin runtime, database migration, `backend/src/http.ts`, CI, infrastructure, worker/scheduler, dependency hoặc file secret.

### 20.3. Data flow sau implementation

- Create: Mobile validate full identity 6–24 chữ số và `mock://`/`synthetic://` → API gửi `identityNumber` full → Backend validate, lưu full identity trong `synthetic_payload` backend → public mapper chỉ trả `identityNumberLast4` → Mobile giữ response projection không có full identity.
- Update không đổi identity: Mobile tải `identityNumberLast4`, hiển thị masked và để field full identity rỗng → request bỏ hẳn key `identityNumber` → Backend khóa application hiện tại và dùng identity đang lưu → response tiếp tục chỉ có last4.
- Update đổi identity: người dùng nhập full value mới 6–24 chữ số → Mobile validator yêu cầu full value và API gửi key `identityNumber` → Backend thay identity trong payload sau khi khóa bản ghi → public response chỉ trả last4 mới.
- Invalid input/response: Mobile chặn trước khi gọi service; Backend trả validation error 422 cho request sai; response validator từ chối field full identity hoặc last4 không đúng bốn chữ số. Không có full identity trong response, application response state, log hoặc telemetry do M01-03 tạo.

### 20.4. Impact và migration conclusion

- Breaking: public KYC response đổi `identityNumber` thành `identityNumberLast4`; consumer KYC phải dùng field mới. Đây là thay đổi bắt buộc vì privacy.
- Non-breaking: create request hợp lệ vẫn gửi full identity; update hiện có thêm khả năng bỏ identity khi không thay đổi; document URI canonical được đồng bộ chặt hơn.
- Preflight `$ref` và consumer đã xác minh trước khi sửa: KYC schema chỉ được dùng bởi ba KYC operation của Public API và Mobile KYC; không tìm thấy Admin consumer/runtime cần đổi. Endpoint ngoài KYC không được thay đổi.
- Migration: `KHÔNG CẦN`. Dữ liệu full identity synthetic tiếp tục nằm trong `synthetic_payload` backend; chỉ projection/API contract thay đổi. Không provision/reset/truy cập database remote và không chạy database integration/destructive test; PostgreSQL verification thuộc M01-07.

### 20.5. Lệnh kiểm tra và kết quả thực tế

Backend (`C:\Projects\banking-system\backend`):

- `npm run typecheck` — PASS.
- `npm run build` — PASS.
- `node --import=tsx --test src/tests/kycContract.test.ts` — PASS, `5/5`.
- `npm test` — PASS, `211` tests: `163 PASS`, `48 SKIPPED`, `0 FAIL`.
- `npm run validate:openapi` — PASS, `54` required paths và `60` exact method/segment guards.

Mobile (`C:\Projects\banking-system\mobile-app`):

- `npm run lint` — PASS.
- `npm run typecheck` — PASS; route types generated thành công.
- `npm test -- --runInBand src/features/kyc/screens/__tests__/KycScreen.test.tsx src/features/kyc/validation/__tests__/kycValidators.test.ts src/features/kyc/validation/__tests__/kycResponseValidators.test.ts src/features/kyc/services/__tests__/kycApi.test.ts` — PASS, `4/4` suites và `12/12` tests.
- `npm test -- --runInBand` — PASS, `48/48` suites và `269/269` tests.
- `npm run validate:openapi` — PASS, `46` required paths.
- `npm run export:web` — PASS, export `36` static routes thành công.

Repository root:

- `git diff --check` — PASS, không có whitespace error.
- `git status --short --branch` — PASS tại thời điểm hoàn tất implementation trước checkpoint; HEAD không đổi trong phiên đó, không có file ngoài allowlist do M01-03 tạo.

### 20.6. Leakage/privacy test result và phần chưa kiểm chứng

- Backend mapper test xác nhận response có `identityNumberLast4` đúng bốn chữ số, không có key `identityNumber` và serialized response không chứa full identity.
- Backend validation test xác nhận full identity không xuất hiện trong error details; request thiếu identity khi create hoặc gửi last4/masked value bị từ chối.
- Mobile response validator test xác nhận response có full `identityNumber` bị từ chối và last4 phải đúng bốn chữ số.
- Mobile API test xác nhận update unchanged không serialize key `identityNumber`; create/changed flow chỉ serialize full identity khi được yêu cầu bởi context.
- KycScreen test xác nhận application hiện có chỉ render masked last4, không render full identity, không dùng last4/masked làm request identity, create thiếu identity không gọi service, và sau ghi thành công full identity không còn trong draft UI.
- Test fixture chỉ dùng synthetic data; password, OTP, token, PIN, CVV, proof và dữ liệu người dùng thật không được đưa vào fixture/output. Không có log/snapshot/evidence mới chứa full identity.
- Chưa kiểm chứng trong M01-03: PostgreSQL thật/disposable integration, migration execution, emulator/Maestro, Admin runtime, staging và production-like deployment. Các phần này thuộc task sau hoặc bị loại khỏi phạm vi đã được owner duyệt.

Xác nhận baseline trước reopen: M01-03 đã đạt baseline `IMPLEMENT_AND_VERIFY`; sau đó review phát hiện các khoảng trống P2 cần follow-up.

### 20.7. Kết quả P2 follow-up và quyết định hoàn tất

- Timestamp hoàn tất follow-up: `2026-09-02 00:49:34 +07:00` (Asia/Bangkok).
- CWD: `C:\Projects\banking-system`.
- Branch: `codex/staging-academic-completion`.
- HEAD trước/sau follow-up, trước checkpoint: `c64e5f3e1c9dd2f660669948d21c30745c4f778e`; tại thời điểm hoàn tất follow-up chưa tạo commit; checkpoint sau đó được owner phê duyệt riêng tại mục 20.11.
- Git status trước/sau: branch ahead 11; giữ nguyên WIP có trước gồm `AGENTS.md` modified và các file untracked `PROJECT_CONTEXT.md`, `TASK_TEMPLATE.md`, M01-01, M01-02 và task M01-03. Sau follow-up chỉ có thay đổi KYC hiện hành trong allowlist cùng WIP nói trên; không có file staged.
- WIP đã bảo vệ: không reset, restore, clean, checkout, stage, commit hoặc push; không khôi phục hay ghi đè `AGENTS.md`, `PROJECT_CONTEXT.md`, `TASK_TEMPLATE.md`, M01-01 hoặc M01-02.

Các điểm P2 đã hoàn tất:

1. `mobile-app/src/features/kyc/validation/kycValidators.ts` — `validateKycDraft` chỉ chấp nhận `syntheticDataConfirmed === true` bằng kiểm tra kiểu/giá trị chính xác; `false`, string, number, object, `null` và truthy khác đều bị từ chối. Test tương ứng đã thêm trong `kycValidators.test.ts`.
2. `mobile-app/src/features/kyc/types/kyc.ts` và `mobile-app/src/features/kyc/validation/kycResponseValidators.ts` — `KycApplication.version` là bắt buộc; validator yêu cầu `version` là số nguyên hợp lệ theo contract. Có test thiếu field, sai kiểu, phân số, giá trị dưới ngưỡng và giá trị hợp lệ.
3. `backend/src/database/kycService.ts` — helper canonical KYC status không còn chấp nhận alias `MORE_INFO_REQUIRED`; chỉ chấp nhận `NEEDS_MORE_INFO`. Kiểm tra source cho thấy helper không có call site khác. Giá trị `MORE_INFO_REQUIRED` còn lại trong schema/mapping Admin là giá trị lưu trữ nội bộ tương thích, không phải public KYC status; không sửa Admin runtime hoặc migration.
4. `backend/src/tests/kycContract.test.ts` — bổ sung boundary/privacy cho identity `null`, rỗng, masked, chỉ last4 và last4 có số 0 đầu; kiểm tra update changed lưu đúng full value ở service/unit boundary nhưng public response chỉ có last4; kiểm tra error serialization và log capture không làm lộ full identity.
5. HTTP fake test trong `kycContract.test.ts` — GET/save/submit dùng fake relational boundary, không gọi legacy full-state boundary, request nhận full identity đúng ngữ cảnh nhưng cả ba response chỉ serialize public projection. Không truy cập database thật.
6. OpenAPI regression trong `kycContract.test.ts` — parse toàn bộ `$ref`, kiểm tra consumer của KYC schema và so sánh toàn bộ path ngoài KYC với baseline trước thay đổi về path, method và contract. Không phát hiện thay đổi ngoài Public KYC; không sửa Admin contract/runtime.
7. `KycScreen`/`kycApi` tests — xác nhận update unchanged không gửi key `identityNumber`, update changed yêu cầu và gửi full value mới, create thiếu identity không gọi service, last4/masked không bị dùng làm full identity, UI chỉ hiển thị masked last4 và state response không giữ full identity. Không có full identity trong rendered output, snapshot, log hoặc failure message.
8. Storage/log boundary — source path của KYC không có adapter storage riêng trong allowlist để gắn persistent-storage spy; screen/service chỉ giữ request tạm thời và response projection. Các test serialization/state hiện có xác nhận không persist full identity ở application response state. Kiểm chứng persistence trong database thật được chuyển sang M01-07.

### 20.8. Acceptance criteria sau follow-up

- [x] `syntheticDataConfirmed` chỉ nhận boolean `true`.
- [x] `KycApplication.version` bắt buộc và response validator yêu cầu số nguyên hợp lệ.
- [x] Public KYC status canonical không còn alias `MORE_INFO_REQUIRED`.
- [x] Các identity boundary và leading-zero last4 đã có test.
- [x] Create, update unchanged và update changed có behavior và test riêng.
- [x] Public response, error serialization, log capture, rendered UI và application response state không làm lộ full identity.
- [x] OpenAPI `$ref` consumer và endpoint ngoài KYC đã có regression check; Admin runtime không bị sửa.
- [x] Không có migration, dependency, config, CI, infrastructure, worker hoặc database change trong follow-up.
- [x] Không chạy PostgreSQL/integration/destructive test; phần này được ghi rõ thuộc M01-07.
- [x] Không chạy emulator/Maestro; phần này được ghi rõ thuộc M01-08.

### 20.9. Lệnh follow-up đã chạy

Backend (`C:\Projects\banking-system\backend`):

- `npm run typecheck` — PASS.
- `npm run build` — PASS.
- `node --import=tsx --test src/tests/kycContract.test.ts` — PASS, `12/12`.
- `npm test` — PASS, `217` tests: `169 PASS`, `48 SKIPPED`, `0 FAIL`.
- `npm run validate:openapi` — PASS, `54` required paths và `60` method/segment guards.

Mobile (`C:\Projects\banking-system\mobile-app`):

- `npm run lint` — PASS.
- `npm run typecheck` — PASS.
- `npm test -- --runInBand src/features/kyc/validation/__tests__/kycValidators.test.ts src/features/kyc/validation/__tests__/kycResponseValidators.test.ts src/features/kyc/services/__tests__/kycApi.test.ts src/features/kyc/screens/__tests__/KycScreen.test.tsx` — PASS, `4/4` suites và `14/14` tests.
- `npm test -- --runInBand` — PASS, `48/48` suites và `271/271` tests.
- `npm run validate:openapi` — PASS, `46` required paths.
- `npm run export:web` — PASS, `36` static routes.

Repository root:

- `git diff --check` — PASS.
- `git status --short --branch` — PASS tại thời điểm hoàn tất P2 follow-up trước checkpoint; HEAD không đổi trong phiên đó, không có file staged.

### 20.10. Kết luận bàn giao

- M01-03 được đổi sang `COMPLETED` vì toàn bộ yêu cầu P2 thuộc phạm vi `IMPLEMENT_AND_VERIFY` đã có implementation/test và các quality gate đều pass.
- Migration conclusion: `KHÔNG CẦN` cho M01-03. Không provision/reset database, không truy cập database remote và không chạy PostgreSQL integration; migration/persistent verification thuộc M01-07.
- Chưa tuyên bố hoàn tất device behavior: emulator/Maestro E2E thuộc M01-08 và chưa được chạy trong task này.
- Chưa tuyên bố staging/production readiness; các phần external infrastructure vẫn nằm ngoài M01-03.
- Chỉ các file thuộc allowlist M01-03 được sửa/tạo bởi phần implementation; WIP có trước được bảo vệ và vẫn được tách biệt trong `git status`.
- Trong phiên implementation và P2 follow-up: không stage, commit, push, merge, tag hoặc deploy. Sau đó, commit checkpoint `35da22d832676a54cd2d8598feed8e1aa5b34fe6` được tạo theo phê duyệt riêng của owner và được ghi tại mục 20.11.

### 20.11. Implementation checkpoint

- Baseline HEAD trước triển khai được giữ nguyên: `c64e5f3e1c9dd2f660669948d21c30745c4f778e`.
- Commit implementation checkpoint: `35da22d832676a54cd2d8598feed8e1aa5b34fe6`.
- Parent của checkpoint: `c64e5f3e1c9dd2f660669948d21c30745c4f778e`; baseline không bị thay thế bằng implementation SHA.
- Commit message: `fix(kyc): align contract and protect identity data`.
- Thời điểm checkpoint theo committer date: `2026-09-02 01:03:55 +07:00` (Asia/Bangkok).
- Branch tại checkpoint: `codex/staging-academic-completion`.
- Commit chứa đúng 12 file implementation M01-03:
  - `backend/src/database/kycService.ts`
  - `backend/src/tests/kycContract.test.ts`
  - `documents/api/banking-mvp.openapi.yaml`
  - `mobile-app/src/features/kyc/screens/KycScreen.tsx`
  - `mobile-app/src/features/kyc/screens/__tests__/KycScreen.test.tsx`
  - `mobile-app/src/features/kyc/services/__tests__/kycApi.test.ts`
  - `mobile-app/src/features/kyc/services/kycApi.ts`
  - `mobile-app/src/features/kyc/types/kyc.ts`
  - `mobile-app/src/features/kyc/validation/__tests__/kycResponseValidators.test.ts`
  - `mobile-app/src/features/kyc/validation/__tests__/kycValidators.test.ts`
  - `mobile-app/src/features/kyc/validation/kycResponseValidators.ts`
  - `mobile-app/src/features/kyc/validation/kycValidators.ts`
- Targeted Backend: `npm run typecheck` PASS; `node --import=tsx --test src/tests/kycContract.test.ts` PASS, `12/12`.
- Targeted Mobile: `npm test -- --runInBand src/features/kyc/screens/__tests__/KycScreen.test.tsx src/features/kyc/validation/__tests__/kycValidators.test.ts src/features/kyc/validation/__tests__/kycResponseValidators.test.ts src/features/kyc/services/__tests__/kycApi.test.ts` PASS, `4/4` suites và `14/14` tests.
- Cached allowlist trước commit: đúng 12 file; `git diff --cached --check` PASS; sensitive-data scan PASS với fixture synthetic/placeholder đã xác minh.
- Xác nhận tại thời điểm checkpoint: checkpoint chỉ được tạo local; chưa push remote.
- Sau checkpoint, các WIP `AGENTS.md`, `PROJECT_CONTEXT.md`, `TASK_TEMPLATE.md` và ba task record UC-M01 vẫn chưa được stage; chúng không thuộc commit implementation.

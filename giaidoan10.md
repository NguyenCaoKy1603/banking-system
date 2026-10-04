
# Giai đoạn 10 — Testing: đọc test để hiểu hệ thống đang bảo vệ điều gì

Tài liệu này tiếp nối [giaidoan9.md](C:/Projects/banking-system/giaidoan9.md). Giai đoạn 9 giải thích state, lỗi và trường hợp biên trong runtime; Giai đoạn 10 giải thích cách project dùng test để kiểm tra những hành vi đó.

Mục tiêu của tài liệu không phải là học thuộc cú pháp Jest hay Node test. Mục tiêu là đọc được một test và trả lời:

1. Test đang chuẩn bị dữ liệu gì?
2. Nó gọi hàm, class hoặc API nào?
3. Assertion đang chứng minh điều gì?
4. Nếu test thất bại thì lỗi có thể nằm ở đâu?
5. Test đó chưa chứng minh được điều gì?

Tài liệu được viết từ source hiện tại của repository. Phạm vi là đọc và học: không sửa code, không sửa test, không chạy migration và không ghi dữ liệu. Database integration nếu được nhắc tới trong ví dụ là database disposable được code bảo vệ, không phải database preview.

## Cách đọc

Hãy xem một test như một câu chuyện ngắn:

~~~text
Arrange  → chuẩn bị fixture, mock hoặc database
Act     → gọi method, gửi HTTP request hoặc bấm UI
Assert  → kiểm tra kết quả và state
Cleanup → đóng server, xóa fixture hoặc giải phóng resource
~~~

Đừng chỉ đọc dòng `expect`. Hãy đọc cả phần chuẩn bị và cleanup, vì chúng cho biết test đang chạy trong môi trường nào.

## Mục lục

1. Kiến thức nền về testing
2. Bản đồ test và cách chạy
3. Unit test các hàm thuần
4. Test API client và HTTP boundary của Mobile
5. Test AuthContext và lifecycle session
6. Test state machine, idempotency và recovery
7. Test Backend in-memory và business logic
8. Test PostgreSQL integration và disposable database
9. Test API contract và HTTP end-to-end
10. Test Admin Web và Playwright E2E
11. Test chứng minh gì và chưa chứng minh gì?
12. Bài tập tổng hợp

# 1. Kiến thức nền về testing

## 1.1. Test là một thí nghiệm nhỏ

Một test tốt đặt một điều kiện, thực hiện một hành động, rồi kiểm tra kết quả mong đợi.

Ví dụ đơn giản:

~~~text
Điều kiện: transfer đang PENDING
Hành động: chuyển sang SUCCEEDED
Kết quả: được phép
~~~

Hoặc:

~~~text
Điều kiện: access token hết hạn
Hành động: requestJson nhận 401
Kết quả: gọi refresh một lần rồi retry request
~~~

Test không phải là bản sao của implementation. Nó là một lời khẳng định về behavior mà code phải giữ.

## 1.2. Arrange, Act, Assert, Cleanup

Trong project, nhiều test dùng cấu trúc này dù không luôn đặt comment tên rõ ràng.

| Phần | Câu hỏi | Ví dụ |
| --- | --- | --- |
| Arrange | Cần chuẩn bị gì? | mock `fetch`, fixture customer, server |
| Act | Đang làm hành động nào? | gọi `requestJson`, `service.submit`, `fetch` |
| Assert | Kết quả phải ra sao? | status, code, state, số lần gọi |
| Cleanup | Resource được dọn thế nào? | `t.after`, `server.close`, `pool.close` |

Nếu test PostgreSQL không có cleanup, dữ liệu hoặc connection có thể làm hỏng test tiếp theo. Nếu test UI không reset mock, kết quả có thể phụ thuộc thứ tự chạy.

## 1.3. Bốn lớp test chính trong project

| Loại | Phạm vi | Tốc độ | Điều nó trả lời |
| --- | --- | ---: | --- |
| Unit | Một hàm/class nhỏ | Nhanh | Quy tắc cục bộ có đúng không? |
| Integration | Nhiều module cùng chạy | Trung bình | Các module và database phối hợp đúng không? |
| Contract/HTTP | Request/response thật ở boundary | Trung bình | API status, shape và code có đúng contract không? |
| E2E/UI | Người dùng qua trình duyệt/thiết bị | Chậm | Luồng quan trọng có chạy từ UI đến hệ thống không? |

Không có loại nào tự thay thế được loại khác. Unit test nhanh nhưng không phát hiện SQL sai. E2E gần người dùng nhưng khó chẩn đoán khi hỏng.

## 1.4. Mock, fake và fixture

- **Mock**: object được thay thế để kiểm tra cách gọi, ví dụ `fetchMock` hoặc `SecureStore` mock.
- **Fake**: implementation đơn giản nhưng có hành vi, ví dụ `FakeEmailProvider` hoặc `FakePushProvider`.
- **Fixture**: dữ liệu cố định dùng cho test, ví dụ customer/account/quote.

Một test dùng mock thường chứng minh việc code tương tác đúng với dependency. Nó chưa chắc chứng minh dependency thật hoạt động đúng.

## 1.5. Test pass không đồng nghĩa hệ thống hoàn hảo

`PASS` chỉ có nghĩa các assertion trong test đó đúng với môi trường test đó. Nó không chứng minh:

- mọi device thật đều render đúng;
- mạng thật không bị timeout;
- PostgreSQL production có cùng cấu hình;
- email provider bên ngoài luôn hoạt động;
- mọi trường hợp chưa được viết test đều an toàn.

Vì vậy tài liệu sẽ luôn ghi cả “test chứng minh gì” và “test chưa chứng minh gì”.

## Câu hỏi tự kiểm tra phần 1

1. Arrange khác Act ở điểm nào?
2. Unit test có thể phát hiện SQL sai không?
3. Mock `fetch` đang chứng minh API server thật hay cách Mobile gọi `fetch`?
4. Vì sao test database cần cleanup?
5. Một test pass có nghĩa production đã sẵn sàng không?

# 2. Bản đồ test và cách chạy

## 2.1. Bản đồ thư mục test

~~~text
mobile-app/src/**/__tests__
  → Jest unit, domain, service, storage, screen/context test

backend/src/tests/*.test.ts
  → Node test/tsx: HTTP, domain, auth, repository, admin, database

admin-web/test
  → Node contract test đọc source/config

admin-web/e2e
  → Playwright browser E2E

documents/05-testing
  → báo cáo, baseline, evidence và giới hạn của test
~~~

Tên `__tests__` không tự nói test là unit hay integration. Hãy đọc import và setup để biết test có dựng server, database hoặc mock hay không.

## 2.2. Mobile scripts

Trong [mobile-app/package.json](C:/Projects/banking-system/mobile-app/package.json):

- `npm test`: chạy Jest;
- `npm run test:coverage`: chạy Jest kèm coverage;
- `npm run lint`: kiểm tra lint;
- `npm run typecheck`: generate route types rồi chạy TypeScript;
- `npm run validate:openapi`: kiểm tra contract OpenAPI;
- `npm run validate:e2e`: kiểm tra Maestro flow.

`npm test` không tự biến thành device E2E. Nó chủ yếu chạy test JavaScript/Jest trong môi trường Jest Expo.

## 2.3. Backend scripts

Trong [backend/package.json](C:/Projects/banking-system/backend/package.json):

| Script | Nhóm test |
| --- | --- |
| `npm test` | `run-core-tests.cjs`, chạy các `src/tests/*.test.ts` theo thứ tự, bỏ workerOutbox riêng |
| `npm run test:critical` | HTTP critical contract |
| `npm run test:database:guard` | negative/positive guard cho database disposable |
| `npm run test:database` | database foundation |
| `npm run test:relational` | relational persistence |
| `npm run test:mfa:persistence` | MFA PostgreSQL |
| `npm run test:registration:persistence` | registration/provider boundary |
| `npm run test:savings:persistence` | savings relational |
| `npm run test:credit:persistence` | credit relational |
| `npm run test:remaining:persistence` | các route customer còn lại |
| `npm run test:worker` | worker lease/retry/dead-letter |
| `npm run test:admin:e2e` | Admin HTTP E2E |
| `npm run test:release` | release-quality rehearsal nhiều nhóm disposable |

`run-core-tests.cjs` đặt `--test-concurrency=1`. Điều này giúp các test dùng state hoặc resource chung không chạy tranh chấp ngoài ý muốn.

## 2.4. Admin Web scripts

Trong [admin-web/package.json](C:/Projects/banking-system/admin-web/package.json):

- `npm test`: Node contract tests trong `admin-web/test`;
- `npm run test:e2e`: Playwright;
- `npm run typecheck` hoặc `npm run lint`: kiểm tra TypeScript;
- `npm run build`: build Vite và TypeScript.

Contract test và browser E2E là hai lớp khác nhau. Một test đọc string trong `App.tsx` không chứng minh click UI thật chạy được; Playwright mới kiểm tra hành vi trên browser.

## 2.5. Release runner và skip policy

[test-release.cjs](C:/Projects/banking-system/backend/scripts/test-release.cjs) chạy các nhóm test theo thứ tự và dừng khi một nhóm fail. Script này ghi rõ:

~~~text
Aggregate npm test không nhận database URL
  → nhóm PostgreSQL bị skip có chủ đích

Các script disposable riêng
  → phải PASS cho từng nhóm bị skip
  → nếu thiếu hoặc fail, release gate không đạt
~~~

Đây là khác biệt giữa “skip vì không có database” và “bỏ qua không kiểm soát”. Skip được coi là hợp lệ chỉ khi có nhóm disposable tương ứng chạy sau đó.

## Câu hỏi tự kiểm tra phần 2

1. `npm test` của Mobile có phải device E2E không?
2. Script nào chạy HTTP critical test của Backend?
3. Vì sao Backend có script riêng cho `test:database`?
4. Admin contract test khác Playwright E2E thế nào?
5. Release runner xử lý test database bị skip ra sao?

# 3. Unit test các hàm thuần

Unit test dễ bắt đầu nhất là test hàm không phụ thuộc mạng, UI hoặc database.

## 3.1. Test mapping lỗi sang UI

[requestErrorPresentation.test.ts](C:/Projects/banking-system/mobile-app/src/components/ui/__tests__/requestErrorPresentation.test.ts) gọi trực tiếp `getRequestErrorPresentation`.

Ví dụ test:

~~~typescript
expect(
  getRequestErrorPresentation(
    new ApiError({
      status: null,
      code: "NETWORK_ERROR",
      message: "network failure",
    }),
    "fallback",
  ),
).toEqual({
  kind: "offline",
  title: "Đang ngoại tuyến",
  message: "Không thể kết nối đến máy chủ. Kiểm tra mạng rồi thử lại.",
});
~~~

Test này không mở `RequestErrorNotice` và không gọi server. Nó chứng minh quy tắc mapping:

~~~text
ApiError.code = NETWORK_ERROR
  → kind = offline
  → title/message tiếng Việt đúng
~~~

Nếu test fail, tìm trước ở `requestErrorPresentation.ts`, không cần điều tra PostgreSQL.

## 3.2. Test transition của transfer

[transferStateMachine.test.ts](C:/Projects/banking-system/mobile-app/src/features/transfers/domain/__tests__/transferStateMachine.test.ts) kiểm tra bảng transition trong `transferStateMachine.ts`:

- `PENDING` được đi tới `SUCCEEDED`, `FAILED`, `REVERSED`;
- terminal không quay lại `PENDING`;
- chuyển cùng state vẫn hợp lệ.

Assertion `toThrow("Không thể chuyển trạng thái giao dịch")` chứng minh rule từ chối không chỉ trả `false`; hàm `transitionTransfer` còn ném lỗi khi caller yêu cầu transition sai.

## 3.3. Test validator và formatter

Các test như:

- [moneyValidators.test.ts](C:/Projects/banking-system/mobile-app/src/features/banking/validation/__tests__/moneyValidators.test.ts);
- [accountResponseValidators.test.ts](C:/Projects/banking-system/mobile-app/src/features/accounts/validation/__tests__/accountResponseValidators.test.ts);
- [formatMoney.test.ts](C:/Projects/banking-system/mobile-app/src/features/banking/presentation/__tests__/formatMoney.test.ts);
- [historyFilters.test.ts](C:/Projects/banking-system/mobile-app/src/features/history/presentation/__tests__/historyFilters.test.ts);

thường nhận object/string trực tiếp rồi trả boolean hoặc text. Đây là nơi phù hợp để kiểm tra boundary nhỏ:

~~~text
payload đúng shape → true
payload thiếu field/sai enum → false
amount âm hoặc currency sai → từ chối
money minor → chuỗi hiển thị đúng
~~~

Test kiểu này nhanh và dễ chẩn đoán, nhưng chưa chứng minh screen sử dụng validator đúng lúc.

## 3.4. Test security utility

[safeTelemetry.test.ts](C:/Projects/banking-system/mobile-app/src/services/telemetry/__tests__/safeTelemetry.test.ts) kiểm tra chỉ những property key an toàn mới được giữ lại. [security.test.ts](C:/Projects/banking-system/backend/src/tests/security.test.ts) kiểm tra hash/fingerprint hoặc quy tắc security utility ở Backend.

Điểm quan trọng là test bảo mật thường kiểm tra cả điều không được phép xảy ra, ví dụ secret không xuất hiện trong telemetry.

## 3.5. Mẫu đọc một unit test

Khi mở một unit test, hãy trả lời:

1. Hàm được import trực tiếp là gì?
2. Input nhỏ nhất và input biên nào được dùng?
3. Test kiểm tra giá trị trả về, exception hay side effect?
4. Có dependency nào bị mock không?
5. Có nhánh quan trọng nào chưa được test không?

## Câu hỏi tự kiểm tra phần 3

1. Vì sao `requestErrorPresentation.test.ts` không cần mock `fetch`?
2. Test terminal transfer không quay lại pending bảo vệ rule nào?
3. Validator test đang kiểm tra dữ liệu trước hay sau khi gọi API?
4. Assertion `toThrow` khác `toBe(false)` thế nào?
5. Unit test security có thể kiểm tra việc secret bị log không nếu không quan sát logger?

# 4. Test API client và HTTP boundary của Mobile

## 4.1. `httpClient.test.ts` mock `fetch`

[httpClient.test.ts](C:/Projects/banking-system/mobile-app/src/services/api/__tests__/httpClient.test.ts) thay `globalThis.fetch` bằng `fetchMock`. Vì vậy test không cần Backend chạy thật.

Test đầu tiên kiểm tra header:

~~~text
requestJson("/transfers", POST, body, accessToken, idempotencyKey)
  → fetch được gọi
  → Authorization: Bearer access-token
  → Content-Type: application/json
  → Idempotency-Key: transfer-key-1
  → X-Request-ID có giá trị
~~~

Nó chứng minh client không quên thông tin cần thiết cho một command, nhưng không chứng minh Backend chấp nhận header đó.

## 4.2. Test timeout và abort

Test timeout tạo một Promise chỉ reject khi `request.signal` bị abort. Gọi:

~~~typescript
requestJson("/slow", { timeoutMs: 1 })
~~~

Assertion mong đợi `code: "TIMEOUT"` và `status: null`.

Test caller abort tạo `AbortController`, truyền `signal`, rồi gọi `controller.abort()`. Assertion mong đợi `REQUEST_ABORTED`.

Hai test này phân biệt:

~~~text
timer của httpClient hết hạn → TIMEOUT
caller chủ động hủy → REQUEST_ABORTED
~~~

## 4.3. Test refresh single-flight

Test tạo hai request `/accounts` cùng access token hết hạn. `fetchMock` trả 401 cho hai request đầu; refresh Promise được giữ ở trạng thái pending.

Assertion quan trọng:

- `refreshAccessToken` chỉ được gọi một lần;
- sau khi resolve token mới, cả hai request đều thành công;
- request retry dùng `Authorization: Bearer fresh-token`;
- tổng số lần fetch là bốn: hai lần đầu + hai lần retry.

Đây là test concurrency ở client. Nó không test refresh token database, vì callback refresh đang được mock.

## 4.4. Test không retry vô hạn

Test tiếp theo cho refresh trả token mới nhưng response retry vẫn 401. Assertion kiểm tra:

- refresh chỉ một lần;
- fetch chỉ hai lần;
- lỗi cuối là `UNAUTHORIZED`.

Nếu bỏ `retryOnUnauthorized: false`, test có thể rơi vào vòng lặp vô hạn. Assertion về số lần gọi bảo vệ cả behavior lẫn tài nguyên.

## 4.5. Test response 500 và validator

Test 500 đưa payload có message nội bộ `Unexpected server error.` nhưng mong đợi message an toàn bằng tiếng Việt. Test response validator trong [responseValidators.test.ts](C:/Projects/banking-system/mobile-app/src/services/api/__tests__/responseValidators.test.ts) kiểm tra JSON shape không hợp lệ bị từ chối.

Luồng cần nhớ:

~~~text
fetch response
  → parse JSON
  → kiểm tra error payload hoặc response validator
  → tạo ApiError
  → feature/screen xử lý
~~~

## 4.6. Test service API của feature

Các file như [authApi.test.ts](C:/Projects/banking-system/mobile-app/src/features/auth/services/__tests__/authApi.test.ts), [bankingApi.test.ts](C:/Projects/banking-system/mobile-app/src/features/banking/services/__tests__/bankingApi.test.ts), [creditApi.test.ts](C:/Projects/banking-system/mobile-app/src/features/credit/services/__tests__/creditApi.test.ts) thường mock `requestJson` hoặc `fetch` để kiểm tra:

- path đúng;
- method đúng;
- body đúng;
- idempotency key được truyền;
- validator được dùng;
- input sai bị chặn trước khi network call.

Nếu muốn trace một API, đọc service test trước rồi nhảy vào service implementation, sau đó mới đọc `httpClient`.

## Câu hỏi tự kiểm tra phần 4

1. `httpClient.test.ts` có kết nối PostgreSQL không?
2. Vì sao một request 401 được fetch tổng cộng bốn lần trong test single-flight?
3. `TIMEOUT` và `REQUEST_ABORTED` khác nhau do điều kiện nào?
4. Test 500 bảo vệ người dùng khỏi thông tin gì?
5. Feature API test khác `httpClient.test.ts` ở phạm vi nào?

# 5. Test AuthContext và lifecycle session

## 5.1. Vì sao AuthContext cần test riêng?

`AuthContext` phối hợp SecureStore, AppState, refresh session, logout và React state. Một unit test cho `createAuthSession` không thể chứng minh các Promise chạy đồng thời được xử lý đúng.

[AuthContext.test.tsx](C:/Projects/banking-system/mobile-app/src/features/auth/context/__tests__/AuthContext.test.tsx) render provider trong test harness, mock các service request/storage và quan sát context value.

## 5.2. Test boot và restore session

Luồng test thường mô phỏng:

~~~text
loadAuthSession() trả stored session
  → provider bắt đầu ở booting
  → session tạm locked
  → refreshSessionRequest trả response mới
  → saveAuthSession được gọi
  → status authenticated
~~~

Assertion không chỉ là status cuối. Nó còn kiểm tra access/refresh token mới được lưu và session cũ không bị dùng làm dữ liệu đã xác nhận.

## 5.3. Test AppState background/active

Test đăng ký listener `AppState.addEventListener`, sau đó gọi callback với `background`:

- status thành `locked`;
- `isAuthenticated` thành `false`;
- session object có thể vẫn còn để refresh.

Khi callback nhận `active`:

- status thành `refreshing` trong lúc Promise pending;
- sau khi resolve, session mới được lưu;
- status thành `authenticated`.

Test này chứng minh lifecycle, không chỉ UI text.

## 5.4. Test terminal refresh failure

Khi mock refresh ném `ApiError` 401, test kiểm tra `clearAuthSession` được gọi và provider chuyển `anonymous`. Khi mock lỗi transport, test cần phân biệt việc session được giữ để retry.

Rule chính đến từ [refreshFailure.ts](C:/Projects/banking-system/mobile-app/src/features/auth/domain/refreshFailure.ts): chỉ HTTP 401 mới là terminal refresh failure.

## 5.5. Test response cũ về muộn

Một test tạo deferred refresh Promise, rồi gọi `completeMfaRevocation` trước khi Promise resolve. Sau đó Promise cũ mới resolve.

Assertion mong đợi:

- status vẫn `anonymous`;
- session vẫn `null`;
- recovery codes vẫn còn;
- `saveAuthSession` không bị gọi bởi response cũ.

Test này bảo vệ `sessionEpoch` và `invalidatedSessionEpochsRef`.

## 5.6. Test logout và storage clear

AuthContext test còn mô phỏng logout khi:

- access token đã hết hạn;
- refresh cần chạy trước revoke;
- revoke remote thất bại;
- clear local storage thất bại;
- logout được gọi hai lần cùng lúc.

Mục tiêu là kiểm tra `LogoutResult` và `logoutNotice`, chứ không giả định mọi logout luôn hoàn hảo.

## Câu hỏi tự kiểm tra phần 5

1. Vì sao AuthContext test cần deferred Promise?
2. Khi AppState là background, `isAuthenticated` có còn true không?
3. Lỗi 401 khi refresh khiến test kiểm tra thao tác nào?
4. `sessionEpoch` bảo vệ dữ liệu nào khỏi response cũ?
5. Logout local và revoke remote có phải cùng một thao tác không?

# 6. Test state machine, idempotency và recovery

## 6.1. Test lifecycle của client intent

[clientIntentLifecycle.test.ts](C:/Projects/banking-system/mobile-app/src/features/banking/domain/__tests__/clientIntentLifecycle.test.ts) kiểm tra dữ liệu persisted được chuẩn hóa:

- record cũ chưa submit → `DRAFT_QUOTE`;
- record cũ đã thử submit nhưng chưa có operation ID → `SUBMIT_UNKNOWN`;
- có operation ID → accepted phase;
- phase và `submitAttempted` mâu thuẫn → reject bằng `null`;
- chỉ draft chưa submit mới được discard khi quote hết hạn.

Test này không gọi SecureStore. Nó chỉ bảo vệ rule chuyển đổi dữ liệu lifecycle.

## 6.2. Test phân loại lỗi submit

[submitFailure.test.ts](C:/Projects/banking-system/mobile-app/src/features/banking/domain/__tests__/submitFailure.test.ts) chia lỗi thành hai nhóm.

Nhóm giữ unknown gồm:

- `NETWORK_ERROR`, `TIMEOUT`, `REQUEST_ABORTED`;
- `INVALID_RESPONSE`;
- `IDEMPOTENCY_CONFLICT`;
- status 401, 408, 425, 429 không có code rejection rõ;
- status 500/503.

Nhóm rejection đã biết gồm:

- `INVALID_REQUEST`;
- `FEATURE_DISABLED`;
- `NOT_FOUND`;
- `INSUFFICIENT_FUNDS`;
- `QUOTE_EXPIRED`;
- `STEP_UP_VERIFICATION_FAILED`;
- code `RATE_LIMITED`.

Một test riêng chứng minh network ambiguity không tự động bị nâng thành manual review.

## 6.3. Test SecureStore scope và migration

[transferIntentStorage.test.ts](C:/Projects/banking-system/mobile-app/src/features/transfers/storage/__tests__/transferIntentStorage.test.ts) mock `expo-secure-store` và `expo-crypto`, rồi dùng `Map` làm fake store.

Các assertion quan trọng:

- intent được lưu dưới key scope theo user;
- user khác không đọc hoặc xóa intent của user hiện tại;
- legacy record được migrate sau khi ghi key mới;
- nếu migration write fail, legacy record vẫn còn;
- expired draft được xóa;
- expired unknown vẫn được giữ;
- receipt ID thiếu hoặc lệch làm recovery fail closed.

Đây là test persistence ở client, nhưng không phải test keychain thật của iOS/Android.

## 6.4. Savings và credit áp dụng cùng ý tưởng

[savingsIntentStorage.test.ts](C:/Projects/banking-system/mobile-app/src/features/savings/storage/__tests__/savingsIntentStorage.test.ts) kiểm tra quote/opening ID, pending/terminal và user scope. [cardPaymentIntentStorage.test.ts](C:/Projects/banking-system/mobile-app/src/features/credit/storage/__tests__/cardPaymentIntentStorage.test.ts) kiểm tra intent của payment.

Các test này giúp tìm điểm chung:

~~~text
command có thể lặp
  → cần idempotency key
  → cần persisted intent
  → cần xác minh resource ID
  → không xóa unknown chỉ vì thời gian đã qua
~~~

## 6.5. Test state không giống test UI

`transferStateMachine.test.ts` có thể pass dù `TransferScreen` gọi transition sai. Ngược lại, screen test có thể pass với mock state dù transition function sai.

Khi đọc test, hãy ghi rõ tầng của nó:

| Test | Nó chứng minh |
| --- | --- |
| State machine | Rule transition |
| Storage | Parse/scope/migration |
| Screen | Mapping state vào UI và event handler |
| API client | Request shape và validator |
| Backend service | Business/data behavior |

## Câu hỏi tự kiểm tra phần 6

1. Vì sao expired `SUBMIT_UNKNOWN` không được xóa giống expired draft?
2. Test nào chứng minh user-2 không đọc intent của user-1?
3. `IDEMPOTENCY_CONFLICT` là rejection đã biết hay manual review?
4. State machine test có chứng minh SecureStore ghi đúng key không?
5. Nếu receipt ID lệch operation ID, tại sao storage phải fail closed?

# 7. Test Backend in-memory và business logic

## 7.1. `BankingSystem` là test double runtime hữu ích

Nhiều HTTP test tạo:

~~~typescript
const system = new BankingSystem({
  sandboxOtp: "123456",
  allowUnsafeDirectSandboxStepUp: true,
});
const server = createBankingServer(system, options);
~~~

`BankingSystem` giữ state in-memory. Test có thể đăng ký customer, tạo account, quote và transfer mà không cần PostgreSQL.

Ưu điểm:

- chạy nhanh;
- fixture đơn giản;
- dễ kiểm tra business flow và HTTP route.

Giới hạn:

- không kiểm tra SQL;
- không kiểm tra PostgreSQL constraint/lock;
- không chứng minh relational-v2 runtime.

## 7.2. Test domain core

Các file như:

- [bankingSystem.test.ts](C:/Projects/banking-system/backend/src/tests/bankingSystem.test.ts);
- [ledger.test.ts](C:/Projects/banking-system/backend/src/tests/ledger.test.ts);
- [credit.test.ts](C:/Projects/banking-system/backend/src/tests/credit.test.ts);
- [savings.test.ts](C:/Projects/banking-system/backend/src/tests/savings.test.ts);

kiểm tra nghiệp vụ hoặc cấu trúc state in-memory.

Ví dụ test ledger thường kiểm tra tổng debit/credit cân bằng. Test savings/credit kiểm tra trạng thái, hạn mức, quote, payment và idempotency trong domain.

## 7.3. Test HTTP in-memory

[http.test.ts](C:/Projects/banking-system/backend/src/tests/http.test.ts) dựng server trên port ngẫu nhiên rồi gọi `fetch` thật tới server local. Đây không còn là unit test thuần, vì router, parser và service cùng chạy; tuy nhiên database vẫn là in-memory `BankingSystem`.

Một test HTTP lớn đi qua:

~~~text
register
  → login
  → accounts
  → account number
  → control policy
  → quote transfer
  → submit idempotent transfer
  → history/notification/fraud
  → refresh/logout/logout-all
~~~

Assertion kiểm tra status code, JSON payload, masked number, idempotency conflict và token revoke.

## 7.4. Test HTTP pending

`http.test.ts` có test cấu hình `settleTransfersImmediately: false`, gửi transfer rồi mong đợi status `PENDING`. Test này chứng minh contract cho async settlement ở in-memory runtime.

Nó không chứng minh worker thật sẽ settle transfer trong PostgreSQL; test worker/lifecycle riêng mới trả lời phần đó.

## 7.5. Test lỗi và security state

HTTP test kiểm tra:

- CORS origin không nằm allow-list trả 403;
- trailing route trả 404 thay vì match prefix;
- payload lỗi có trace ID;
- password gửi vào request không xuất hiện trong response;
- thiếu hoặc sai auth/device bị từ chối.

`http-security-persistence.test.ts` còn kiểm tra domain rejection có thể giữ security failure audit trong khi business state bị rollback theo boundary policy.

## 7.6. Test Backend không dùng database có thể vẫn quan trọng

Một test không chạm database không phải test “giả”. Nó phù hợp với rule thuần, router, error mapping, in-memory state và contract chung. Vấn đề chỉ xảy ra khi dùng nó để kết luận về SQL hoặc persistence thật.

## Câu hỏi tự kiểm tra phần 7

1. `http.test.ts` có phải unit test của một hàm duy nhất không?
2. `BankingSystem` giúp test nhanh điều gì?
3. Vì sao HTTP test in-memory không chứng minh PostgreSQL query đúng?
4. Test pending transfer chứng minh contract nào?
5. Password không xuất hiện trong response được kiểm tra ở đâu?

# 8. Test PostgreSQL integration và disposable database

## 8.1. Khi nào cần PostgreSQL thật?

Cần integration test với PostgreSQL khi behavior phụ thuộc vào:

- migration và tên bảng/cột;
- foreign key, unique/check constraint;
- `SELECT ... FOR UPDATE`;
- transaction commit/rollback;
- isolation level;
- serialization failure/deadlock;
- idempotency record trong database;
- RLS/grant hoặc readiness check;
- worker lease/outbox concurrency.

Mock `client.query` không thể tự chứng minh các đặc tính này.

## 8.2. Runner disposable

[run-disposable-postgres-test.ts](C:/Projects/banking-system/backend/scripts/run-disposable-postgres-test.ts) import các hàm từ [disposableDatabaseGuard.ts](C:/Projects/banking-system/backend/src/database/disposableDatabaseGuard.ts). Module chỉ chạy CLI khi là entry point, nên import trong test không tự mở container hoặc reset database.

Guard yêu cầu:

~~~text
NODE_ENV=test
BANKING_ENV=test
ALLOW_DATABASE_TEST_RESET=1
DATABASE URL có tên banking_test_<suffix>
host thuộc allow-list
không trùng DATABASE_URL/preview URL
~~~

Nếu thiếu marker hoặc target không rõ, guard fail closed. “Không chắc database là disposable” không được coi là lý do để tiếp tục.

## 8.3. Test guard

[disposableDatabaseGuard.test.ts](C:/Projects/banking-system/backend/src/tests/disposableDatabaseGuard.test.ts) kiểm tra cả trường hợp được phép và bị từ chối:

- URL đúng pattern được chấp nhận;
- database `postgres` hoặc tên protected bị từ chối;
- host ngoài allow-list bị từ chối;
- môi trường không phải test bị từ chối;
- target trùng preview URL bị từ chối;
- marker/ownership/checksum không hợp lệ bị từ chối.

Đây là test của hàng rào an toàn, không phải test nghiệp vụ banking.

## 8.4. Test rollback và transaction retry

Trong [databaseFoundation.test.ts](C:/Projects/banking-system/backend/src/tests/databaseFoundation.test.ts), một test:

1. insert customer trong `unitOfWork.transaction`;
2. cố tình ném `fault-injection`;
3. kiểm tra customer không còn trong database.

Test khác dùng `withTransactionRetry`, lần đầu ném code `40001`, lần sau trả `ok`, rồi kiểm tra callback được gọi hai lần.

Điều này nối trực tiếp với [unitOfWork.ts](C:/Projects/banking-system/backend/src/database/unitOfWork.ts): `BEGIN`, callback, `COMMIT`, hoặc `ROLLBACK`; chỉ lỗi serialization/deadlock mới được retry.

## 8.5. Test relational auth

[authRelational.test.ts](C:/Projects/banking-system/backend/src/tests/authRelational.test.ts) dùng PostgreSQL để kiểm tra:

- refresh rotation;
- device mismatch;
- revoke family;
- refresh token reuse;
- revoke all sessions;
- access/refresh token sau revoke bị 401;
- customer/device khác vẫn hoạt động độc lập;
- audit event persistence.

Các assertion truy vấn `auth_sessions`, `refresh_session_families` và `refresh_session_records`, nên đây là điều in-memory test không thể thay thế.

## 8.6. Test persistence transfer

`databaseFoundation.test.ts` và [relationalPersistence.test.ts](C:/Projects/banking-system/backend/src/tests/relationalPersistence.test.ts) kiểm tra command transfer với fixture database:

~~~text
quote
  → reserve idempotency
  → lock quote/accounts
  → cập nhật balance
  → ghi transaction/ledger/audit/outbox
  → commit
~~~

Test retry cùng key mong đợi canonical transfer; retry khác fingerprint mong đợi conflict. Test fault injection kiểm tra rollback không để lại balance/ledger một phần.

## 8.7. Test tích hợp nhiều process

[integratedDisposable.test.ts](C:/Projects/banking-system/backend/src/tests/integratedDisposable.test.ts) dựng một rehearsal lớn:

- API persistent server;
- HTTP email capture provider;
- hai worker;
- hai lifecycle scheduler;
- PostgreSQL disposable;
- OTP registration và resend;
- outbox không chứa plaintext OTP;
- savings maturity;
- worker readiness;
- ledger không mất cân bằng.

Đây là test gần hệ thống thật hơn unit test, nhưng vẫn là sandbox/disposable rehearsal, không phải bằng chứng production.

## 8.8. Test database không được đụng preview

Không chạy destructive persistence test nếu chưa xác minh target. Root instructions của repository cấm reset/drop/truncate `banking_preview` hoặc database không xác minh ownership. Tài liệu này chỉ giải thích guard; không tự chạy các script database.

## Câu hỏi tự kiểm tra phần 8

1. Vì sao mock `client.query` không đủ để test row lock?
2. Guard yêu cầu những biến môi trường nào?
3. Test rollback kiểm tra dữ liệu gì sau khi callback ném lỗi?
4. Refresh token family test khác HTTP in-memory test ở đâu?
5. Tại sao integrated disposable rehearsal chưa phải production evidence?

# 9. Test API contract và HTTP end-to-end

## 9.1. Contract test là gì?

Contract test kiểm tra thỏa thuận ở boundary: route, method, status, JSON shape, error code và các field bắt buộc.

Ví dụ [authContract.test.ts](C:/Projects/banking-system/backend/src/tests/authContract.test.ts) và [registrationContract.test.ts](C:/Projects/banking-system/backend/src/tests/registrationContract.test.ts) tập trung vào auth/registration contract. [kycContract.test.ts](C:/Projects/banking-system/backend/src/tests/kycContract.test.ts) làm điều tương tự cho KYC.

Contract test giúp phát hiện tình huống Backend trả đúng business result nhưng sai tên field khiến Mobile không parse được.

## 9.2. Contract từ hai phía

Mobile có response validators như [transferResponseValidators.test.ts](C:/Projects/banking-system/mobile-app/src/features/transfers/validation/__tests__/transferResponseValidators.test.ts). Backend có HTTP/contract tests và OpenAPI validator.

~~~text
Backend contract
  → server phải trả shape đã hứa

Mobile validator
  → client chỉ nhận shape đúng

Hai phía cùng đúng
  → feature có thể truyền dữ liệu an toàn
~~~

Nếu một phía thay đổi enum/status mà phía kia chưa cập nhật, contract test hoặc runtime validator nên phát hiện sớm.

## 9.3. HTTP test thật nhưng local

`http.test.ts` tạo Node HTTP server lắng nghe `127.0.0.1` trên port ngẫu nhiên rồi dùng `fetch`. Đây là HTTP integration test:

- request parser chạy thật;
- route matching chạy thật;
- error mapper chạy thật;
- service được gọi thật trong runtime test.

Nhưng nếu dùng `BankingSystem`, persistence vẫn in-memory. Nếu dùng `createPersistentBankingServer` với repository, test mới đi qua relational boundary.

## 9.4. Những assertion cần đọc

Khi đọc một HTTP test, hãy phân loại assertion:

| Assertion | Nó kiểm tra |
| --- | --- |
| `response.status` | HTTP contract |
| `payload.code` | error taxonomy |
| `payload.traceId` | observability/correlation |
| field không tồn tại | privacy/data minimization |
| cùng ID khi retry | idempotency |
| status `PENDING` | async business state |
| token sau logout trả 401 | auth lifecycle |

Một test có nhiều assertion đang bảo vệ nhiều contract cùng lúc; nếu fail, đọc message/assertion cụ thể để tìm tầng lỗi.

## 9.5. API validation scripts

Backend có `npm run validate:openapi`, `validate:admin-openapi`, `validate:database`, `validate:relational-v2`. Đây không phải unit test thông thường; chúng là static/runtime validation script để kiểm tra schema, route và invariant.

Không nên gọi mọi script là “test” rồi bỏ qua khác biệt:

- test chạy behavior với input;
- validator kiểm tra artifact hoặc invariant;
- integration test chạy nhiều thành phần cùng nhau.

## Câu hỏi tự kiểm tra phần 9

1. Contract test kiểm tra phần nào của API?
2. Mobile response validator có thay thế Backend contract test không?
3. HTTP local test dùng `BankingSystem` khác persistent HTTP test ra sao?
4. Assertion field không tồn tại có thể bảo vệ điều gì?
5. OpenAPI validator khác behavior test ở điểm nào?

# 10. Test Admin Web và Playwright E2E

## 10.1. Admin source contract test

[admin-web/test/admin-web.contract.test.cjs](C:/Projects/banking-system/admin-web/test/admin-web.contract.test.cjs) đọc source `App.tsx`, `api.ts`, Vite config, Dockerfile, Nginx template và runtime script bằng `fs.readFileSync`.

Các test kiểm tra marker như:

- các khu vực P0: Approval Inbox, KYC/Credit, giao dịch chờ, fraud, outbox, staff, audit;
- không dùng `localStorage`/`sessionStorage` cho staff token;
- có `credentials: "include"` và `X-CSRF-Token`;
- Admin API cùng origin `/api/v1`;
- activation token được loại khỏi browser history;
- approval có checker comment và permission gate;
- Nginx proxy và runtime config có marker đúng.

Đây là test bảo vệ cấu trúc source/config. Nó không render React và không đăng nhập server thật.

## 10.2. Admin HTTP E2E của Backend

[adminHttp.e2e.test.ts](C:/Projects/banking-system/backend/src/tests/adminHttp.e2e.test.ts) kiểm tra route Admin ở HTTP boundary. Nó phù hợp để kiểm tra cookie, CSRF, staff session, role/permission và action response mà không cần mở browser.

## 10.3. Playwright browser E2E

[admin-web/e2e/admin-web.spec.ts](C:/Projects/banking-system/admin-web/e2e/admin-web.spec.ts) mở nhiều browser page cho operations, control, support và admin.

Luồng chính:

~~~text
staff password
  → TOTP login
  → maker tạo request
  → checker mở Approval Inbox
  → fresh step-up
  → approve/reject với reason
  → kiểm tra transfer/KYC/Credit/Fraud/Outbox/Staff
  → support bị disable phải quay lại login
~~~

Playwright kiểm tra text, role, `data-testid`, modal, nhiều session browser và state sau thao tác. Đây là bằng chứng gần người dùng hơn source contract test.

## 10.4. Fixture và secret trong E2E

E2E dùng credential fixture và TOTP secret cho local test. Khi đọc test, cần phân biệt credential giả dành cho test với secret thật. Không sao chép credential vào log/evidence bên ngoài phạm vi test.

## 10.5. Giới hạn Admin E2E

Một browser E2E pass chỉ chứng minh fixture và môi trường test đó. Nó không chứng minh:

- permission matrix đầy đủ cho mọi role ngoài scenario;
- network/proxy production;
- database failover;
- browser/device chưa nằm trong matrix.

Các kết luận phải ghi kèm environment và fixture.

## Câu hỏi tự kiểm tra phần 10

1. Admin contract test có mở browser không?
2. Vì sao source test không chứng minh cookie thật được gửi?
3. Playwright E2E dùng những staff role nào?
4. Fresh step-up xuất hiện ở bước nào?
5. E2E pass có chứng minh mọi role/permission đều đúng không?

# 11. Test chứng minh gì và chưa chứng minh gì?

## 11.1. Ma trận phạm vi

| Câu hỏi | Unit | In-memory HTTP | PostgreSQL integration | E2E |
| --- | --- | --- | --- | --- |
| Hàm mapping có đúng? | Có | Có thể gián tiếp | Không cần | Không phù hợp |
| Header/body đúng? | Có thể | Có | Có thể | Có thể |
| Route/status JSON đúng? | Không đầy đủ | Có | Có | Có |
| SQL/constraint đúng? | Không | Không | Có | Có thể gián tiếp |
| Rollback/lock thật? | Không | Không | Có | Có thể gián tiếp |
| UI state đúng? | Có nếu screen test | Không chắc | Không | Có |
| Device thật/network thật? | Không | Không | Không | Chỉ một phần |
| Production readiness? | Không | Không | Không | Không tự động |

## 11.2. Test coverage không phải behavior coverage

Coverage phần trăm cho biết dòng/branch nào được chạy, nhưng không tự cho biết assertion có ý nghĩa hay không. Một test có thể chạy qua dòng code mà chỉ `expect(true).toBe(true)`.

Khi đọc test, ưu tiên:

1. assertion về behavior;
2. assertion về state/side effect;
3. assertion về security/privacy;
4. assertion số lần gọi hoặc thứ tự gọi;
5. coverage như thông tin bổ sung.

## 11.3. Test critical nên nhìn theo rủi ro

Với banking reference project, các nhóm rủi ro cao gồm:

- double transfer hoặc double payment;
- refresh token reuse;
- ownership/IDOR;
- rollback một phần balance/ledger;
- MFA replay;
- Admin self-approval hoặc bypass permission;
- worker xử lý cùng outbox event hai lần;
- response lỗi làm lộ secret.

Một test nhỏ cho idempotency có thể quan trọng hơn nhiều test formatter, vì hậu quả nghiệp vụ khác nhau.

## 11.4. In-memory repository và PostgreSQL repository

Có thể hình dung:

~~~text
In-memory BankingSystem
  → kiểm tra nhanh business state, HTTP flow, sandbox behavior

Relational service + Repository + UnitOfWork
  → kiểm tra SQL, transaction, constraint, lock, persistence
~~~

Nếu một feature chỉ có test in-memory, hãy ghi rõ “chưa có bằng chứng PostgreSQL”. Nếu chỉ có integration test, hãy cân nhắc test unit nhỏ để lỗi dễ chẩn đoán hơn.

## 11.5. Bằng chứng local, disposable và device

Các nhãn cần giữ rõ:

- **Unit/Jest local**: chạy không cần server thật;
- **HTTP local**: server local, có thể in-memory;
- **Disposable PostgreSQL**: database tạo riêng, có guard và cleanup;
- **Browser E2E**: browser fixture local;
- **Device/Maestro**: emulator hoặc thiết bị cụ thể;
- **Staging/production-like**: cần evidence và phê duyệt riêng.

Không gọi một báo cáo local là staging evidence nếu chưa có staging runtime.

## 11.6. Cách đọc test fail

Khi test fail, đi theo thứ tự:

~~~text
1. Test đang chạy ở runtime nào?
2. Fixture/mock có đúng không?
3. Assertion fail ở value, call count hay side effect?
4. Lỗi nằm ở setup, implementation hay environment?
5. Có test tầng thấp hơn giúp khoanh vùng không?
6. Có thay đổi contract hay migration gần đây không?
~~~

Đừng sửa test chỉ để màu xanh trước khi hiểu behavior test đang bảo vệ.

## Câu hỏi tự kiểm tra phần 11

1. Vì sao coverage cao vẫn có thể thiếu test quan trọng?
2. Test nào phù hợp nhất để phát hiện SQL constraint sai?
3. Double transfer thuộc nhóm rủi ro nào?
4. Nếu chỉ có in-memory test cho transfer, còn thiếu bằng chứng gì?
5. Khi test fail, nên kiểm tra environment hay implementation trước?

# 12. Bài tập tổng hợp

Các ví dụ dưới đây dùng dữ liệu giả. Hãy trả lời bằng tên test file, class, method và tầng test.

## Bài 1 — Đọc một assertion đơn giản

Test `requestErrorPresentation.test.ts` tạo `ApiError` code `TIMEOUT`.

1. Hàm nào được gọi?
2. Kết quả `kind` là gì?
3. Test này có gọi network không?
4. Nếu muốn kiểm tra nút “Thử lại”, cần đọc thêm file nào?

## Bài 2 — Đọc test refresh

Trong `httpClient.test.ts`, hai request cùng gặp 401.

1. Vì sao refresh mock chỉ được gọi một lần?
2. Có bao nhiêu lần fetch?
3. Nếu retry lần hai vẫn 401, lỗi cuối là gì?

## Bài 3 — Đọc test session lifecycle

Trong `AuthContext.test.tsx`, app chuyển `background` rồi `active`.

1. Status ở background là gì?
2. Status trong lúc refresh là gì?
3. Assertion nào chứng minh session mới được lưu?

## Bài 4 — Đọc test idempotency

Trong `http.test.ts`, cùng idempotency key được gửi cho hai quote khác nhau.

1. Response thứ hai có status/code gì?
2. Vì sao Backend không tạo transfer thứ hai?
3. Test này là in-memory hay PostgreSQL?

## Bài 5 — Đọc test rollback

Trong `databaseFoundation.test.ts`, callback insert customer rồi ném lỗi.

1. `UnitOfWork` phải gửi SQL nào sau lỗi?
2. Assertion kiểm tra database ra sao?
3. Nếu test pass, nó chứng minh điều gì về transaction?

## Bài 6 — Đọc disposable guard

Giả sử `DATABASE_URL` trỏ tới `banking_preview`.

1. Guard có cho phép reset không?
2. Vì sao fail closed quan trọng?
3. Test nào kiểm tra rule này?

## Bài 7 — Đọc integrated rehearsal

Trong `integratedDisposable.test.ts`:

1. Có bao nhiêu worker được tạo?
2. OTP plaintext có được lưu vào `auth_challenges` hoặc outbox không?
3. Scheduler maturity được chứng minh bằng assertion nào?
4. Vì sao đây vẫn chưa phải production evidence?

## Bài 8 — Đọc Admin contract test

`admin-web.contract.test.cjs` kiểm tra `localStorage`, CSRF và same-origin API.

1. Test có render React không?
2. Nó đọc những file nào?
3. Muốn kiểm tra click login thật, cần test nào?

## Bài 9 — Phân loại test

Xếp các test sau vào unit, in-memory HTTP, PostgreSQL integration hoặc browser E2E:

| Test | Loại |
| --- | --- |
| `transferStateMachine.test.ts` | ? |
| `http.test.ts` dùng `BankingSystem` | ? |
| `authRelational.test.ts` có `Pool` | ? |
| `admin-web.spec.ts` dùng Playwright | ? |
| `admin-web.contract.test.cjs` đọc source bằng `fs` | ? |

## Bài 10 — Viết lời giải thích cho một test

Chọn một test bất kỳ và điền mẫu:

~~~text
File test:
Runtime:
Fixture/mock:
Hành động:
Assertion chính:
Behavior được bảo vệ:
Nếu fail, kiểm tra file runtime nào:
Test chưa chứng minh:
~~~

## Checklist trước khi kết luận “đã được test”

~~~text
□ Biết test chạy ở runtime nào
□ Biết dependency nào là mock/fake/thật
□ Đọc assertion, không chỉ đọc tên test
□ Biết cleanup có chạy không
□ Biết test có chạm PostgreSQL không
□ Biết test bảo vệ behavior hay chỉ source marker
□ Ghi rõ giới hạn của bằng chứng
~~~

## Câu hỏi kết thúc Giai đoạn 10

1. Test nào chứng minh retry HTTP, test nào chứng minh retry transaction?
2. Vì sao idempotency cần được test ở cả Mobile và Backend?
3. Test contract và E2E bổ sung cho nhau thế nào?
4. Một test database disposable bảo vệ workspace khỏi rủi ro gì?
5. Khi đọc một test mới, bạn sẽ xác định runtime hay assertion trước?

## Kết luận học tập

Sau Giai đoạn 10, bạn có thể nhìn một test và nối được nó với code runtime:

~~~text
Test fixture
  → hành động
  → class/method thật
  → state/data thay đổi
  → assertion
  → giới hạn của bằng chứng
~~~

Đó là bước chuyển từ “test pass nên chắc đúng” sang cách suy nghĩ chính xác hơn: “test này chứng minh đúng behavior nào, trong môi trường nào, và còn khoảng trống nào?”.

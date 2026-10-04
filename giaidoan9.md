
# Giai đoạn 9 — State, lỗi và các trường hợp biên

Tài liệu này tiếp nối [giaidoan8.md](C:/Projects/banking-system/giaidoan8.md). Giai đoạn 8 trả lời “ai đang gọi và người đó được phép làm gì”; Giai đoạn 9 trả lời câu hỏi tiếp theo: “Nếu request đang chạy, không có dữ liệu, bị mất mạng hoặc kết quả chưa rõ thì ứng dụng đang ở trạng thái nào và phải làm gì tiếp theo?”.

Tài liệu được viết từ source hiện tại của repository. Phạm vi là đọc và học: không sửa code, không sửa schema, không chạy migration và không ghi dữ liệu. Mọi ID, số tiền, token và thông báo trong ví dụ đều là dữ liệu giả.

## Cách đọc

Hãy giữ bốn câu hỏi này trong đầu:

1. Hệ thống đang ở trạng thái nào?
2. Lỗi xảy ra ở UI, mạng, API, business logic hay database?
3. Server đã chắc chắn từ chối thao tác, hay kết quả vẫn chưa biết?
4. Người dùng có thể khôi phục bằng cách nào mà không tạo thêm thao tác nguy hiểm?

## Mục lục

1. Kiến thức nền về state và lỗi
2. Bản đồ xử lý lỗi của toàn hệ thống
3. Tải tài khoản và lịch sử giao dịch
4. Session, token và ứng dụng bị khóa
5. Mạng, timeout, hủy request và response sai
6. Validation và lỗi nghiệp vụ
7. Chuyển tiền bị gián đoạn và kết quả chưa rõ
8. Các chức năng khác và trường hợp biên riêng
9. Bất đồng bộ, cạnh tranh và dữ liệu cũ
10. Test đang chứng minh điều gì?
11. Bài tập tổng hợp

# 1. Kiến thức nền về state và lỗi

## 1.1. State là gì?

State là thông tin mô tả tình trạng hiện tại của một màn hình hoặc một luồng nghiệp vụ. Ví dụ màn hình Home không chỉ có “đã có số dư” hoặc “không có số dư”. Nó có thể đang tải, đã tải thành công, không có tài khoản, gặp lỗi, hoặc phiên đăng nhập đã hết hạn.

Một màn hình thường phải phân biệt ít nhất các trạng thái sau:

| Trạng thái | Ý nghĩa | Ví dụ trong project |
| --- | --- | --- |
| Loading | Đang chờ dữ liệu hoặc thao tác | `isLoading` trong `HomeScreen` |
| Success có dữ liệu | Có dữ liệu để hiển thị | `account` khác `null` |
| Success rỗng | Request thành công nhưng danh sách rỗng | `transactions.length === 0` |
| Validation error | Input không hợp lệ | Số tiền chuyển không phải số nguyên dương |
| Domain rejection | Server biết chắc nghiệp vụ bị từ chối | `INSUFFICIENT_BALANCE`, `QUOTE_EXPIRED` |
| Transport error | Không nhận được kết quả từ server | `NETWORK_ERROR`, `TIMEOUT` |
| Unauthorized | Session không còn dùng được | HTTP 401 sau khi refresh thất bại |
| Unknown outcome | Có thể server đã nhận lệnh nhưng client chưa biết kết quả | timeout sau khi submit transfer |

Nếu gộp tất cả thành một biến `error = true`, UI sẽ không biết nên cho người dùng sửa dữ liệu, đăng nhập lại, thử lại, hay chờ kiểm tra trạng thái.

## 1.2. Empty khác error

“Chưa có giao dịch” là kết quả hợp lệ của một request thành công. “Không tải được giao dịch” là request thất bại. Hai tình huống này cần thông báo khác nhau:

~~~text
GET /accounts/acc-1/transactions
    ├─ HTTP 200, items = []
    │    → empty state: Chưa có giao dịch
    └─ NETWORK_ERROR / 500
         → error state: Không thể tải dữ liệu + Thử lại
~~~

Trong [HistoryScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/history/screens/HistoryScreen.tsx), `visibleTransactions.length === 0` chỉ được xét sau khi `isLoading` là `false` và `error` không tồn tại. Vì vậy danh sách rỗng không bị nhầm với lỗi.

## 1.3. Lỗi đã biết và kết quả chưa biết

Một lỗi 422 với `VALIDATION_ERROR` thường là kết quả đã biết: server chưa thực hiện nghiệp vụ vì input sai. Người dùng có thể sửa field rồi gửi lại.

Ngược lại, nếu `fetch` bị timeout sau khi gửi lệnh chuyển tiền, client không thể kết luận server chưa nhận request. Request có thể đã chạy xong ở Backend nhưng response bị mất trên đường về. Đây là lý do project có `SUBMIT_UNKNOWN` và idempotency key.

~~~text
Lỗi trước khi dispatch
  → biết chắc chưa tạo nghiệp vụ
  → cho sửa hoặc thử lại

Lỗi sau khi command có thể đã dispatch
  → chưa biết server đã tạo nghiệp vụ chưa
  → giữ intent + idempotency key
  → truy vấn trạng thái hoặc đối soát thủ công
~~~

## 1.4. Một thao tác bất đồng bộ có nhiều cờ

Trong code Mobile, một màn hình có thể có nhiều cờ vì chúng mô tả những việc khác nhau:

- `isLoadingAccounts`: đang tải danh sách account;
- `isLoadingControlPolicy`: đang tải policy;
- `isRestoringIntent`: đang đọc thao tác chưa hoàn tất từ SecureStore;
- `isSubmitting`: đang gửi thao tác hiện tại;
- `isLoadingMore`: đang tải trang tiếp theo;
- `isSessionExpired`: không thể tiếp tục với session hiện tại;
- `recoveryBlocked`: chưa thể xác định an toàn intent cũ.

Không nên hiểu mỗi cờ là một “lỗi”. Nhiều cờ chỉ là trạng thái tiến trình. UI dùng chúng để khóa nút, hiển thị spinner và tránh hai thao tác chạy đồng thời.

## 1.5. Mã lỗi của Backend

[errors.ts](C:/Projects/banking-system/backend/src/errors.ts) định nghĩa `DomainError` với `status`, `code`, `fieldErrors` và `retryAfterSeconds`.

| Hàm tạo lỗi | HTTP | Ý nghĩa học tập |
| --- | ---: | --- |
| `invalidRequest` | 422 | Dữ liệu hoặc cấu trúc request không hợp lệ |
| `unauthorized` | 401 | Chưa xác thực được session/device |
| `notFound` | 404 | Resource không tồn tại hoặc không thuộc user |
| `conflict` | 409 | Trạng thái nghiệp vụ hoặc concurrency không phù hợp |
| `conflictWithCode` | 409 | Conflict có mã cụ thể để client phân loại |
| `rateLimited` | 429 | Thử quá nhiều, có thể kèm thời gian chờ |

Lỗi 500 không nên đưa chi tiết nội bộ database cho người dùng. [http.ts](C:/Projects/banking-system/backend/src/http.ts) chuyển lỗi bất ngờ thành `INTERNAL_ERROR` với thông báo an toàn.

## Câu hỏi tự kiểm tra phần 1

1. Vì sao danh sách rỗng không phải là lỗi?
2. Timeout khi đọc lịch sử có giống timeout sau khi gửi chuyển tiền không?
3. HTTP 422 thường cho biết điều gì?
4. Vì sao cần nhiều cờ loading ở một màn hình?
5. Khi nào hệ thống phải giữ kết quả ở trạng thái chưa biết?

# 2. Bản đồ xử lý lỗi của toàn hệ thống

## 2.1. Luồng lỗi từ Mobile đến Backend

Một request đọc dữ liệu đi qua các lớp sau:

~~~text
Screen
  → feature API, ví dụ listAccounts hoặc listTransactions
  → requestJson trong httpClient.ts
  → fetch + Authorization + X-Device-ID + X-Request-ID
  → backend/src/http.ts
  → requireBearer / route handler
  → service / repository / PostgreSQL
  → JSON response hoặc DomainError
  → ApiError ở Mobile
  → state của Screen
  → StateCard hoặc RequestErrorNotice
~~~

`requestJson` là điểm tập trung để chuẩn hóa lỗi transport, parse JSON, kiểm tra response validator và retry 401 một lần. Mỗi feature không phải tự viết lại toàn bộ logic HTTP.

## 2.2. `ApiError` là dạng lỗi của Mobile

[ApiError.ts](C:/Projects/banking-system/mobile-app/src/services/api/ApiError.ts) giữ:

- `status`: HTTP status hoặc `null` nếu chưa nhận được response;
- `code`: mã lỗi ổn định để code phân loại;
- `message`: thông báo để hiển thị;
- `fieldErrors`: lỗi theo field nếu có;
- `traceId`: mã giúp đối chiếu log.

Ví dụ:

~~~typescript
new ApiError({
  status: null,
  code: "TIMEOUT",
  message: "Yêu cầu đến máy chủ đã hết thời gian chờ.",
})
~~~

`status: null` không có nghĩa server trả status null. Nó có nghĩa client chưa nhận được một HTTP response hợp lệ.

## 2.3. `requestErrorPresentation` biến lỗi kỹ thuật thành UI

[requestErrorPresentation.ts](C:/Projects/banking-system/mobile-app/src/components/ui/requestErrorPresentation.ts) gom lỗi transport thành bốn loại:

| `ApiError.code` | Loại UI | Thông điệp hiện tại |
| --- | --- | --- |
| `NETWORK_ERROR` | `offline` | Không thể kết nối đến máy chủ |
| `TIMEOUT` | `timeout` | Máy chủ phản hồi chậm; có thể thử lại |
| `REQUEST_ABORTED` | `cancelled` | Yêu cầu đã được hủy |
| Mã khác | `generic` | Dùng message của API hoặc fallback |

[RequestErrorNotice.tsx](C:/Projects/banking-system/mobile-app/src/components/ui/RequestErrorNotice.tsx) nhận lỗi, gọi `getRequestErrorPresentation`, hiển thị tiêu đề/thông báo và nút `Thử lại`. Khi `isRetrying` là `true`, nút bị khóa và đổi nhãn thành `Đang thử lại...`.

## 2.4. Backend đóng gói lỗi

Trong [http.ts](C:/Projects/banking-system/backend/src/http.ts), `handleRequest` bắt ba nhóm:

1. `DomainError`: log rejection, giữ lại những thay đổi security cần thiết và trả status/code tương ứng.
2. `DatabaseCommandError`: chuyển thành cùng dạng JSON lỗi với status/code của command.
3. Lỗi bất ngờ: log nội bộ, rollback phần business phù hợp và trả `500 INTERNAL_ERROR`.

`writeError` đưa `code`, `message`, `fieldErrors`, `traceId` vào JSON. Nếu lỗi có `retryAfterSeconds`, response có thêm header `Retry-After`.

## 2.5. Trace và request ID

[requestContext.ts](C:/Projects/banking-system/backend/src/observability/requestContext.ts) tạo `requestId`, `traceId`, `spanId` và `traceparent`. Mobile tạo `X-Request-ID` trong `requestJson`; Backend chuẩn hóa request ID và trả các header liên quan.

Mục đích của trace không phải để người dùng tự sửa lỗi. Nó giúp người vận hành nối được:

~~~text
Màn hình báo lỗi
  → ApiError.traceId / request ID
  → log http_request_rejected hoặc http_request_failed
  → service / audit / database record
~~~

[safeTelemetry.ts](C:/Projects/banking-system/mobile-app/src/services/telemetry/safeTelemetry.ts) chỉ ghi metadata an toàn như method, status, code, traceId cho lỗi API; không ghi password, token, OTP hay số tài khoản đầy đủ.

## 2.6. Admin Web có luồng riêng

[admin-web/src/api.ts](C:/Projects/banking-system/admin-web/src/api.ts) dùng `adminFetch`:

1. gọi cùng origin `/api/v1`;
2. gửi cookie bằng `credentials: "include"`;
3. thêm CSRF header cho request thay đổi dữ liệu;
4. parse JSON lỗi thành `ApiError` đơn giản;
5. giữ `status`, `code`, `traceId` cho UI.

`ErrorNotice` trong [App.tsx](C:/Projects/banking-system/admin-web/src/App.tsx) đổi một số lỗi thành hướng dẫn cụ thể: session hết hạn, permission bị từ chối, action stale hoặc action đã được người khác xử lý. AppShell cũng có `loading`, `error` và trạng thái `navigator.onLine`.

## Câu hỏi tự kiểm tra phần 2

1. Lớp nào biến lỗi HTTP thành `ApiError`?
2. Vì sao `status` của `NETWORK_ERROR` là `null`?
3. `RequestErrorNotice` làm gì khi người dùng bấm `Thử lại`?
4. Backend lấy thông tin gì để trả lỗi 500 an toàn?
5. Trace ID giúp người vận hành làm gì?

# 3. Tải tài khoản và lịch sử giao dịch

## 3.1. Xem tài khoản trên Home

Luồng chính nằm trong [HomeScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/home/screens/HomeScreen.tsx).

~~~text
HomeScreen.useFocusEffect
  → loadAccounts()
  → listAccounts(auth)
  → requestJson("/accounts")
  → HTTP GET /api/v1/accounts
  → requireBearer
  → RelationalHttpBoundary.listAccounts
  → RelationalAccountReadService.listAccounts
  → AccountRepository.findAccountsByCustomer
  → PostgreSQL
  → { accounts: [...] }
  → setAccount(response.accounts[0] ?? null)
~~~

`auth` chứa access token, device ID và callback refresh. `requestJson` tự thêm các header cần thiết và validator kiểm tra response trước khi trả về cho màn hình.

## 3.2. Các nhánh state của Home

`HomeScreen` xử lý theo thứ tự:

1. Không có `accessToken`: đặt `account = null`, `isSessionExpired = true`, dừng loading.
2. Có token: đặt loading, xóa lỗi cũ và gọi `listAccounts`.
3. Thành công: lấy account đầu tiên hoặc `null` nếu mảng rỗng.
4. Lỗi 401 sau chu trình refresh: đặt `isSessionExpired = true`.
5. Lỗi khác: giữ `error` để `RequestErrorNotice` hiển thị.
6. Cuối cùng: `isLoading = false`.

UI hiển thị:

~~~text
isLoading
  → StateCard loading: Đang tải số dư an toàn...

isSessionExpired
  → StateCard: Phiên đăng nhập đã hết hạn + Đăng nhập lại

error
  → RequestErrorNotice + Thử lại

account có dữ liệu
  → BalanceCard

không có account và không có lỗi
  → StateCard: Chưa có tài khoản thanh toán
~~~

Đây là ví dụ rõ ràng về việc “rỗng” và “lỗi” không cùng một nhánh.

## 3.3. Hiện số tài khoản là request riêng

Home chỉ nhận account đã được che số. Khi người dùng muốn xem hoặc sao chép số đầy đủ, `revealAccountNumber` gọi `getAccountNumber(account.id, auth)`. State riêng gồm:

- `isAccountNumberLoading`;
- `revealedAccountNumber`;
- `isAccountNumberVisible`;
- `accountNumberError`;
- `isCopyingAccountNumber`.

Nếu request reveal lỗi, số tài khoản vẫn không được hiện. Người dùng có thể thử lại mà không làm hỏng dữ liệu account đã tải trước đó.

## 3.4. Lịch sử giao dịch và phân trang

[HistoryScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/history/screens/HistoryScreen.tsx) có hai request đọc:

1. `loadInitial`: gọi `listAccounts`, chọn account đầu tiên, rồi gọi `listTransactions(account.id, { limit: 20 })`.
2. `loadMore`: nếu có `selectedAccountId`, `nextCursor` và không đang tải thêm, gọi trang tiếp theo rồi nối vào mảng hiện tại.

Sau khi lấy dữ liệu, `filterTransactions` lọc theo status và direction ở client. Vì vậy có hai kiểu empty:

- server trả `items = []`: “Chưa có giao dịch”;
- server có dữ liệu nhưng bộ lọc làm danh sách hiển thị rỗng: “Không tìm thấy kết quả”.

Nếu tải trang đầu lỗi, `RequestErrorNotice` gọi lại `loadInitial`. Nếu tải trang tiếp theo lỗi, state hiện tại vẫn còn; `error` được đặt để người dùng thử lại theo luồng của màn hình.

## 3.5. Chi tiết account

[AccountDetailScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/accounts/screens/AccountDetailScreen.tsx) lấy toàn bộ account rồi tìm `accountId` trong response. Nếu không tìm thấy, UI hiển thị “Tài khoản không khả dụng”. Đây là trường hợp dữ liệu hợp lệ nhưng resource không có trong danh sách hiện tại; không nên tự giả định đó là lỗi mạng.

## Câu hỏi tự kiểm tra phần 3

1. `HomeScreen` gọi method nào để lấy danh sách account?
2. Khi `accounts` là mảng rỗng nhưng HTTP thành công, UI hiển thị gì?
3. Vì sao `getAccountNumber` là request riêng thay vì trả số đầy đủ ngay trong `listAccounts`?
4. `HistoryScreen` phân biệt “chưa có giao dịch” và “không tìm thấy kết quả” như thế nào?
5. Khi tải trang tiếp theo lỗi, dữ liệu các trang trước có bị xóa không?

# 4. Session, token và ứng dụng bị khóa

## 4.1. Các trạng thái của `AuthContext`

[AuthContext.tsx](C:/Projects/banking-system/mobile-app/src/features/auth/context/AuthContext.tsx) khai báo:

~~~typescript
type AuthStatus =
  | "booting"
  | "anonymous"
  | "authenticated"
  | "locked"
  | "loggingOut"
  | "refreshing";
~~~

Ý nghĩa:

- `booting`: ứng dụng chưa đọc xong SecureStore;
- `anonymous`: không có session hợp lệ;
- `authenticated`: có session đã được server xác nhận;
- `locked`: giữ session để chờ xác nhận lại, không coi là đang hoạt động;
- `refreshing`: đang đổi refresh token lấy session mới;
- `loggingOut`: đang thu hồi session và dọn storage.

`isAuthenticated` không đơn giản là “session object khác null”. Nó gắn với trạng thái hoạt động để màn hình tài chính không hiện dữ liệu cached khi app chưa xác nhận lại session.

## 4.2. Cold start

Khi `AuthProvider` mount:

~~~text
booting
  → ensureDeviceId()
  → loadAuthSession() từ SecureStore
  ├─ không có session → anonymous
  └─ có session → locked
       → refreshSession(storedSession)
       ├─ thành công → lưu session mới → authenticated nếu app active
       ├─ 401 → clearAuthSession → anonymous
       └─ lỗi tạm thời → giữ session, giữ locked/authenticated phù hợp, ném lỗi cho caller
~~~

Comment trong source giải thích vì sao session khôi phục ban đầu bị khóa: không được hiển thị số dư cached trước khi server xác nhận session còn tồn tại.

## 4.3. Khi API trả 401

`requestJson` có cơ chế refresh một lần:

1. request nghiệp vụ gửi access token cũ;
2. server trả 401;
3. nếu `auth.refreshAccessToken` tồn tại, gọi refresh;
4. các request đồng thời dùng cùng callback chia sẻ một Promise trong `refreshPromises`;
5. nếu nhận access token mới, request ban đầu được gửi lại một lần;
6. request retry được đặt `retryOnUnauthorized: false`, nên 401 lần hai được trả về cho màn hình.

Test [httpClient.test.ts](C:/Projects/banking-system/mobile-app/src/services/api/__tests__/httpClient.test.ts) chứng minh hai request cùng lúc chỉ gọi refresh một lần và không retry 401 lần thứ hai.

## 4.4. Refresh failure tạm thời và terminal

[refreshFailure.ts](C:/Projects/banking-system/mobile-app/src/features/auth/domain/refreshFailure.ts) chỉ coi `ApiError` 401 là `isTerminalRefreshFailure`.

| Kết quả refresh | Ý nghĩa | Xử lý |
| --- | --- | --- |
| 401 | Refresh token/session bị thu hồi hoặc hết hạn | Xóa session cục bộ, chuyển `anonymous` |
| NETWORK_ERROR | Chưa biết server còn chấp nhận refresh không | Giữ session để thử lại sau |
| TIMEOUT | Chưa biết kết quả | Không xóa token ngay |
| Lỗi khác tạm thời | Chưa thể xác nhận | Giữ state phù hợp, báo lỗi ở lớp gọi |

Đây là nguyên tắc quan trọng: không xóa session chỉ vì mạng đang mất.

## 4.5. AppState background và foreground

`AuthContext` lắng nghe `AppState`:

~~~text
active → background/inactive
  → status = locked
  → isAuthenticated = false

background/inactive → active
  → refreshSession()
  → status = refreshing
  → success: authenticated
  → terminal 401: anonymous
~~~

Test `AuthContext.test.tsx` kiểm tra rằng khi quay lại active, session được refresh trước khi trở thành `authenticated`. Điều này giới hạn việc hiển thị dữ liệu tài chính trên một session đã cũ.

## 4.6. Login có lỗi mạng khác lỗi credential

[LoginScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/auth/screens/LoginScreen.tsx) gọi `validateLoginForm` trước khi gửi. Nếu lỗi có code `NETWORK_ERROR`, `TIMEOUT` hoặc `REQUEST_ABORTED`, màn hình dùng `RequestErrorNotice` để người dùng thử lại.

Nếu `ApiError` không thuộc nhóm transport, màn hình lấy `fieldErrors.email`, `fieldErrors.password` và `message` để hiển thị lỗi server hoặc lỗi thông tin đăng nhập. Vì vậy “mật khẩu sai” không bị trình bày giống “máy chủ không kết nối được”.

## Câu hỏi tự kiểm tra phần 4

1. Tại sao session đọc từ SecureStore ban đầu ở trạng thái `locked`?
2. `requestJson` refresh access token tối đa bao nhiêu lần cho một request?
3. Vì sao hai request đồng thời không nên tự gọi hai refresh khác nhau?
4. Lỗi nào khiến `AuthContext` xóa session và chuyển sang `anonymous`?
5. Khi app quay lại foreground, trạng thái nào xuất hiện trong lúc refresh?

# 5. Mạng, timeout, hủy request và response sai

## 5.1. `httpClient.ts` tạo timeout bằng AbortController

Trong [httpClient.ts](C:/Projects/banking-system/mobile-app/src/services/api/httpClient.ts), timeout mặc định là 15.000 ms. `createAbortState` kết hợp:

- `signal` do caller truyền vào;
- `AbortController` nội bộ;
- timer đặt `didTimeout = true` rồi abort.

Sau `fetch`:

~~~text
fetch ném lỗi
  ├─ didTimeout() = true → ApiError(TIMEOUT)
  ├─ controller.signal.aborted → ApiError(REQUEST_ABORTED)
  └─ còn lại → ApiError(NETWORK_ERROR)
~~~

`finally` luôn gọi `cleanup` để xóa timer và listener. Nếu không dọn, mỗi request có thể để lại timer hoặc listener trong bộ nhớ.

## 5.2. Response không phải JSON

`parseJson` gọi `response.json()`. Nếu body không parse được, `createInvalidResponseError` trả `ApiError` với code `INVALID_RESPONSE`.

Sau khi parse, `requestJson` còn kiểm tra:

1. HTTP status có thành công không;
2. payload lỗi có đủ `code`, `message`, `fieldErrors`, `traceId` không;
3. nếu thành công, `validateResponse` của feature có chấp nhận payload không.

Vì vậy HTTP 200 với JSON thiếu field cũng bị coi là lỗi contract, thay vì đưa dữ liệu hỏng vào state.

## 5.3. Lỗi 5xx không lộ chi tiết nội bộ

Khi response status từ 500 trở lên, `requestJson` thay message server bằng:

~~~text
Dịch vụ đang tạm thời gián đoạn. Vui lòng thử lại sau.
~~~

`code` và `traceId` vẫn được giữ để code/test và việc chẩn đoán có thể hoạt động. Người dùng không thấy SQL error, tên bảng hoặc stack trace.

## 5.4. Retry của người dùng và retry tự động

Có ba kiểu “thử lại” khác nhau:

| Cơ chế | Nằm ở đâu | Có an toàn cho mọi request không? |
| --- | --- | --- |
| Retry 401 sau refresh | `requestJson` | Có giới hạn một lần và chỉ do 401 |
| Bấm `Thử lại` trên UI | Screen + `RequestErrorNotice` | Phụ thuộc loại thao tác |
| Retry command bằng idempotency | Transfer/Savings/Credit | Cần giữ cùng idempotency key |

Không nên thêm vòng lặp tự động cho mọi `POST`. Với một command tài chính, gửi lại bằng key mới có thể tạo nghiệp vụ thứ hai.

## 5.5. Admin Web khi offline

`AppShell` trong [App.tsx](C:/Projects/banking-system/admin-web/src/App.tsx) lắng nghe sự kiện `online` và `offline`, rồi hiển thị trạng thái ở topbar. Đây là thông tin hướng dẫn, không phải bằng chứng request thành công.

Khi gọi API, `adminFetch` vẫn phải xử lý `fetch` throw hoặc response lỗi ở caller. `ErrorNotice` có thể hiện nút retry, nhưng thao tác POST vẫn phải dùng idempotency và server-side authorization.

## 5.6. Câu hỏi tự kiểm tra phần 5

1. Làm sao `httpClient` phân biệt timeout với người dùng chủ động abort?
2. Vì sao response 200 nhưng sai shape vẫn là lỗi?
3. Tại sao không retry tự động mọi POST sau network error?
4. `Retry-After` do lớp nào thêm vào response?
5. Trạng thái “Offline” của Admin Web có chứng minh request vừa rồi thất bại không?

# 6. Validation và lỗi nghiệp vụ

## 6.1. Validation ở nhiều lớp

Một input có thể được kiểm tra ở ba nơi:

~~~text
Form UI
  → validation ở Mobile để phản hồi nhanh
  → feature API kiểm tra shape trước khi gửi
  → Backend validate lại vì client không đáng tin
~~~

Ví dụ chuyển tiền:

- `TransferScreen` yêu cầu amount là số nguyên dương và không vượt policy đã tải;
- `transfersApi.ts` kiểm tra đúng một trong `beneficiaryId` hoặc `lookupId`, money shape và step-up proof;
- Backend kiểm tra quote, account ownership, account status, policy, số dư và idempotency.

Validation ở Mobile cải thiện trải nghiệm. Validation ở Backend mới bảo vệ dữ liệu thật.

## 6.2. Lỗi field và lỗi toàn request

`ApiError.fieldErrors` phù hợp với lỗi gắn vào input, ví dụ email hoặc password trong Login, `fullName` hoặc `identityNumber` trong KYC.

Lỗi như `INSUFFICIENT_BALANCE`, `FEATURE_DISABLED` hoặc `QUOTE_EXPIRED` không thuộc một field đơn lẻ; Screen hiển thị message nghiệp vụ ở khu vực chung.

## 6.3. KYC xử lý conflict

[KycScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/kyc/screens/KycScreen.tsx) có hai nhánh đặc biệt:

- status 422: lấy field errors, hiển thị ngay trên field;
- status 409 hoặc code `CONFLICT`: gọi lại `getKycApplication`, cập nhật bản canonical từ server và thông báo rằng hồ sơ đã thay đổi.

Conflict không nhất thiết là “lỗi cần thử lại ngay”. Nó có thể có nghĩa một tab khác hoặc nhân viên đã thay đổi resource. Cách an toàn là tải bản mới rồi để người dùng quyết định.

## 6.4. Account không tồn tại hoặc không thuộc user

Backend thường trả 404 cho resource không tồn tại hoặc không nằm trong phạm vi customer. Client không nên tự suy ra nguyên nhân chi tiết để tránh lộ dữ liệu người khác.

Ví dụ [AccountRepository.ts](C:/Projects/banking-system/backend/src/database/repositories/accountRepository.ts) có `findOwnedAccount`, `findAccountsByCustomer` và các truy vấn nhận `customerId`. Nếu account ID không thuộc customer hiện tại, kết quả không được đưa ra như một account hợp lệ.

## 6.5. Rate limit không giống lỗi mạng

`rateLimited` tạo HTTP 429 và có thể có `retryAfterSeconds`. Đây là response có chủ đích từ server: server đã xử lý request đủ để biết client cần chờ.

Mobile có thể hiển thị message server hoặc fallback generic tùy Screen. Không nên đổi 429 thành `NETWORK_ERROR`, vì người dùng cần biết rằng chờ rồi thử lại là hành động phù hợp.

## 6.6. Các lỗi policy và control plane

Trong chuyển tiền, `TransferScreen` tải `ControlPolicy` trước khi tạo quote. Nếu `globalKillSwitch`, `transfersEnabled` hoặc `allowlisted` không cho phép, client dừng trước khi gửi quote.

Backend vẫn kiểm tra lại policy trong service. Một policy có thể thay đổi giữa lúc Mobile tải và lúc submit, nên client-side check chỉ là trải nghiệm; server-side check mới quyết định.

## Câu hỏi tự kiểm tra phần 6

1. Vì sao phải validate lại ở Backend dù Mobile đã validate?
2. Khi nào dùng `fieldErrors`, khi nào dùng message chung?
3. KYC gặp 409 thì tại sao tải lại bản canonical?
4. 404 account có nên hiển thị “account thuộc người khác” không?
5. 429 khác `NETWORK_ERROR` ở điểm nào?

# 7. Chuyển tiền bị gián đoạn và kết quả chưa rõ

Đây là luồng quan trọng nhất của Giai đoạn 9 vì một request đọc có thể retry khá đơn giản, còn một command tiền tệ có thể đã thay đổi số dư.

## 7.1. Các phase của client intent

[clientIntentLifecycle.ts](C:/Projects/banking-system/mobile-app/src/features/banking/domain/clientIntentLifecycle.ts) định nghĩa:

| Phase | Ý nghĩa |
| --- | --- |
| `DRAFT_QUOTE` | Có quote nhưng chưa gửi command |
| `SUBMIT_UNKNOWN` | Đã bắt đầu submit; chưa biết server nhận hay chưa |
| `ACCEPTED_PENDING` | Server trả transfer ID và trạng thái còn pending |
| `ACCEPTED_TERMINAL` | Server trả trạng thái cuối như succeeded, failed hoặc reversed |

`submitAttempted` là cờ bổ sung. Hàm `canDiscardExpiredIntent` chỉ cho phép xóa quote hết hạn khi phase vẫn là `DRAFT_QUOTE` và chưa submit.

## 7.2. Chuẩn bị submit trong `TransferScreen`

Trong [TransferScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/transfers/screens/TransferScreen.tsx), người dùng đi qua:

~~~text
beneficiary
  → lookupBeneficiary / lookupInternalRecipient
amount
  → kiểm tra số tiền và control policy
review
  → quoteTransfer
stepUp
  → createOtpChallenge + nhập OTP/TOTP hoặc biometric
result
  → submitTransfer hoặc truy vấn transfer
~~~

Trước khi tạo challenge, `handleContinueToStepUp` tạo `idempotencyKey` nếu chưa có và lưu intent phase `DRAFT_QUOTE` vào SecureStore. Key này sẽ được giữ cho command sau đó.

## 7.3. Vì sao lưu intent trước submit?

`saveTransferIntent` trong [transferIntentStorage.ts](C:/Projects/banking-system/mobile-app/src/features/transfers/storage/transferIntentStorage.ts) lưu:

- `userId`;
- `idempotencyKey`;
- quote;
- phase;
- `submitAttempted`;
- `transferId` và receipt nếu đã nhận.

Key được scope theo user và dùng `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Khi app bị đóng ngay sau lúc gửi, lần mở lại có thể đọc intent và không tự ý tạo key mới.

## 7.4. Thời điểm chuyển sang `SUBMIT_UNKNOWN`

`handleSubmitTransfer` làm điều quan trọng này trước khi gọi `submitTransfer`:

~~~text
saveTransferIntent({
  phase: "SUBMIT_UNKNOWN",
  submitAttempted: true,
  idempotencyKey: key,
  quote,
})
  → requestStarted = true
  → submitTransfer(..., { idempotencyKey: key })
~~~

Nếu app crash hoặc mạng mất sau bước lưu, lần khôi phục sau vẫn biết rằng command đã bắt đầu.

## 7.5. Phân loại lỗi sau submit

Sau khi `submitTransfer` ném lỗi, `TransferScreen` chia nhánh:

### Quote chắc chắn hết hạn hoặc không còn tồn tại

Với `QUOTE_EXPIRED` hoặc `NOT_FOUND`, client xóa intent, xóa challenge/key/quote và quay về bước amount. Đây là rejection đã biết; tạo quote mới là hợp lý.

### Cần đối soát thủ công

[submitFailure.ts](C:/Projects/banking-system/mobile-app/src/features/banking/domain/submitFailure.ts) coi các mã sau là `ManualReviewCode`:

- `IDEMPOTENCY_CONFLICT`;
- `IDEMPOTENCY_STATE_MISSING`;
- `MANUAL_REVIEW_REQUIRED`;
- `QUOTE_ALREADY_USED`;
- `REVERSAL_REQUIRES_REVIEW`.

Client giữ intent ở `SUBMIT_UNKNOWN`, lưu `manualReviewCode` và hiển thị:

~~~text
Yêu cầu này cần được đối soát thủ công.
Không gửi lại hoặc tạo mã mới; vui lòng liên hệ hỗ trợ.
~~~

Không được đổi key hoặc bấm submit tiếp trong trạng thái này.

### Lỗi có thể làm kết quả chưa biết

`shouldKeepSubmitUnknown` giữ phase unknown cho:

- `NETWORK_ERROR`;
- `TIMEOUT`;
- `REQUEST_ABORTED`;
- `INVALID_RESPONSE`;
- status 401, 408, 425, 429 không có rejection có cấu trúc;
- mọi status từ 500 trở lên;
- lỗi không phải `ApiError`.

Đây là cách bảo thủ: client không tự tuyên bố “giao dịch thất bại” khi chưa có bằng chứng.

### Rejection có cấu trúc nhưng không phải manual review

`shouldKeepSubmitUnknown` trả `false` cho những rejection như `INSUFFICIENT_FUNDS`, `QUOTE_EXPIRED`, `STEP_UP_VERIFICATION_FAILED` và `RATE_LIMITED`. Client đưa intent về `DRAFT_QUOTE`, xóa challenge và cho phép người dùng chuẩn bị lại.

Riêng `RATE_LIMITED` với code chính xác `RATE_LIMITED` được coi là rejection có cấu trúc; một 429 lạ vẫn được giữ unknown theo nguyên tắc an toàn.

## 7.6. Khôi phục sau crash hoặc timeout

Khi `TransferScreen` mount, `restoreTransferIntent` đọc SecureStore:

~~~text
loadTransferIntent(userId)
  ├─ không có intent → bắt đầu luồng mới
  ├─ có transferId
  │    → hiển thị result
  │    → getTransfer(transferId)
  │    → cập nhật receipt và phase
  ├─ có manualReviewCode
  │    → khóa luồng, không tạo challenge mới
  └─ chưa có transferId, chưa manual review
       → tạo challenge TRANSFER mới để tiếp tục với cùng key
~~~

Nếu đọc dữ liệu recovery lỗi hoặc corrupt, `recoveryBlocked = true`. Các handler kiểm tra cờ này và không cho tạo request mới cho đến khi dữ liệu được kiểm tra an toàn.

## 7.7. Pending và cập nhật trạng thái

Receipt có status `PENDING`, `SUCCEEDED`, `FAILED`, `REVERSED`. [transferStateMachine.ts](C:/Projects/banking-system/mobile-app/src/features/transfers/domain/transferStateMachine.ts) cho phép:

~~~text
PENDING → PENDING | SUCCEEDED | FAILED | REVERSED
SUCCEEDED → SUCCEEDED
FAILED → FAILED
REVERSED → REVERSED
~~~

`TransferScreen` hiển thị nhãn tương ứng và có nút “Cập nhật trạng thái” khi đã có transfer ID. `handleRefreshTransferStatus` gọi `getTransfer`, lưu receipt mới và cập nhật phase accepted pending hoặc accepted terminal.

## 7.8. Backend giữ idempotency và transaction

Trong [transferService.ts](C:/Projects/banking-system/backend/src/database/transferService.ts), `submit` chạy trong `UnitOfWork.transaction` và thực hiện theo thứ tự khái quát:

1. reserve command idempotency;
2. nếu key đã tồn tại, kiểm tra request fingerprint;
3. tìm quote và khóa quote;
4. kiểm tra quote còn hạn, recipient, policy và account ownership;
5. khóa hai account;
6. kiểm tra status và available balance;
7. tạo transfer;
8. consume quote;
9. cập nhật balances;
10. ghi account transactions và ledger;
11. ghi audit và notifications;
12. ghi outbox;
13. complete idempotency với canonical transfer.

Nếu cùng key được gửi lại với cùng fingerprint, service trả canonical record. Nếu key được dùng cho payload khác, ném `IdempotencyConflictError`. Như vậy retry với cùng key có thể an toàn hơn việc tạo command mới.

## 7.9. Retry transaction không phải retry business command

[transactionRetry.ts](C:/Projects/banking-system/backend/src/database/transactionRetry.ts) chỉ retry toàn bộ callback khi PostgreSQL báo serialization failure hoặc deadlock. [unitOfWork.ts](C:/Projects/banking-system/backend/src/database/unitOfWork.ts) bao quanh bằng `BEGIN`, `COMMIT`, `ROLLBACK`.

Comment trong source nhấn mạnh không đặt external side effect vào callback retry. Nếu commit visibility không rõ, idempotency là cơ chế để command lặp lại không nhân đôi nghiệp vụ.

## Câu hỏi tự kiểm tra phần 7

1. Vì sao phải lưu intent trước khi gọi `submitTransfer`?
2. `SUBMIT_UNKNOWN` khác `ACCEPTED_PENDING` như thế nào?
3. Khi timeout sau submit, vì sao không tự tạo idempotency key mới?
4. Mã lỗi nào đưa transfer vào manual review?
5. Backend dùng những dữ liệu nào để trả canonical transfer cho một retry cùng key?

# 8. Các chức năng khác và trường hợp biên riêng

Các luồng khác dùng cùng nguyên tắc state, nhưng mỗi nghiệp vụ có resource và cách khôi phục riêng.

## 8.1. Tiền gửi tiết kiệm

[savingsOpeningStateMachine.ts](C:/Projects/banking-system/mobile-app/src/features/savings/domain/savingsOpeningStateMachine.ts) mô tả các bước `input`, `review`, `stepUp`, `result`. `canRetrySavingsOpening` chỉ trả `true` khi status là `PENDING`.

[savingsIntentStorage.ts](C:/Projects/banking-system/mobile-app/src/features/savings/storage/savingsIntentStorage.ts) dùng cùng kiểu lifecycle với transfer:

- quote hết hạn được xóa nếu chưa submit;
- unknown hoặc terminal không bị xóa chỉ vì quote hết hạn;
- opening ID phải khớp với opening trong receipt;
- dữ liệu corrupt tạo `IntentRecoveryError` và fail closed.

Điểm học được: trạng thái của tiền gửi không nên được quyết định chỉ từ việc UI đang mở màn hình. Phải hỏi server bằng opening ID khi kết quả chưa terminal.

## 8.2. Thanh toán credit

Các màn hình trong `mobile-app/src/features/credit/screens` phân biệt payment `PENDING`, `SUCCEEDED` và `FAILED` qua [CreditPaymentResultScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/credit/screens/CreditPaymentResultScreen.tsx). API credit dùng idempotency key cho các command.

Backend [creditService.ts](C:/Projects/banking-system/backend/src/database/creditService.ts) reserve idempotency, kiểm tra fingerprint và trả conflict `IDEMPOTENCY_IN_PROGRESS` nếu command cùng key đang được hoàn tất. Đây là cùng ý tưởng với transfer nhưng resource là payment/credit account.

## 8.3. Đăng ký và OTP

[RegisterScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/auth/screens/RegisterScreen.tsx) có form và bước OTP. Screen lưu trạng thái registration để không tự động gửi lại một request khi kết quả trước đó chưa rõ. Các nhánh thường gặp:

- validation lỗi: giữ form để sửa;
- challenge hết hạn: tạo/resend theo contract;
- delivery hoặc network lỗi: hiển thị lỗi và chờ thao tác rõ ràng của người dùng;
- verify thành công: chuyển sang kết quả đăng ký;
- cancel: xóa trạng thái tạm.

Backend `PersistentMfaService` và `MfaRepository` giới hạn attempts, expire challenge và khóa challenge sau quá nhiều lần sai. Đây là state của security resource, không chỉ là state UI.

## 8.4. KYC

KYC có các trạng thái nghiệp vụ riêng như `SUBMITTED`, `UNDER_REVIEW`, `APPROVED`, `REJECTED`, `NEEDS_MORE_INFO`. [KycScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/kyc/screens/KycScreen.tsx) xử lý:

- lỗi tải lần đầu bằng `initialLoadFailed` và nút “Thử lại”;
- hồ sơ đang chờ bằng nút “Tải lại trạng thái”;
- `REJECTED` bằng banner giải thích để tạo hồ sơ mới;
- `NEEDS_MORE_INFO` bằng form cập nhật hồ sơ hiện tại;
- 422 bằng field error;
- 409 bằng cách tải lại bản canonical.

“Đang chờ nhân viên xét duyệt” không phải lỗi transport và không nên hiển thị như mất mạng.

## 8.5. Thông báo

[NotificationsScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/notifications/screens/NotificationsScreen.tsx) có `isLoading`, `error` và `notifications`. Nếu mảng rỗng sau khi tải thành công, UI dùng empty state. Nếu mark read lỗi, notification hiện tại không nên bị đánh dấu read ở client nếu server chưa xác nhận.

## 8.6. Beneficiary và card

Các API beneficiary validate ID/name ở [transfersApi.ts](C:/Projects/banking-system/mobile-app/src/features/transfers/services/transfersApi.ts). Backend query luôn gắn `customerId`, nên lỗi resource không thuộc user được xử lý như not found.

Card có state như active, locked và lost. Luồng lock khẩn cấp được tách khỏi một số policy step-up; unlock lại cần TOTP theo route trong [http.ts](C:/Projects/banking-system/backend/src/http.ts). Đây là ví dụ cho thấy “mỗi thao tác nhạy cảm” có điều kiện phục hồi khác nhau.

## 8.7. Admin operations và outbox

Admin Web hiển thị empty state cho approval, transfer pending, fraud case, job và outbox. Retry/requeue chỉ tạo action four-eyes qua `adminFetch`; UI không tự sửa trạng thái tài chính.

`ErrorNotice` đặc biệt phân biệt `ACTION_STALE` và `ACTION_ALREADY_DECIDED`:

- stale: tải lại action vì version đã thay đổi;
- already decided: người khác đã xử lý, không submit lại action cũ.

## Câu hỏi tự kiểm tra phần 8

1. Tiền gửi hết hạn nhưng đã submit có được xóa intent ngay không?
2. KYC `UNDER_REVIEW` là loading hay là business state?
3. Vì sao mark notification read nên chờ response server?
4. Khi Admin action stale, nên gửi lại action cũ hay tải lại dữ liệu?
5. Unlock card khác lock card khẩn cấp ở điều kiện nào?

# 9. Bất đồng bộ, cạnh tranh và dữ liệu cũ

## 9.1. Khóa nút submit ở Mobile

`TransferScreen` dùng `submitLockRef` cùng `isSubmitting`:

~~~text
người dùng bấm submit
  → kiểm tra submitLockRef
  → đặt ref = true, isSubmitting = true
  → thực hiện một command
  → finally đặt ref = false, isSubmitting = false
~~~

Ref chống double tap ngay cả trong khoảng thời gian React chưa render state mới. Button disabled cải thiện UI, còn ref là hàng rào đồng bộ trong handler.

Các màn hình form khác dùng `isSubmitting` để disable button. Đây là bảo vệ phía client; server vẫn phải có idempotency và constraint.

## 9.2. Single-flight refresh

`AuthContext` có `refreshPromisesRef` theo `sessionEpoch`. `httpClient` có `WeakMap` theo callback refresh. Hai cơ chế cùng phục vụ một ý tưởng: nhiều request nhìn thấy access token hết hạn không được tạo nhiều refresh cạnh tranh.

`sessionEpoch` còn ngăn một refresh cũ ghi đè session mới sau logout hoặc MFA revocation.

## 9.3. Kết quả trả về muộn sau logout

Test trong `AuthContext.test.tsx` mô phỏng refresh Promise hoàn thành muộn sau `completeMfaRevocation`. Context kiểm tra epoch/invalidation và không cho Promise cũ:

- lưu lại session cũ;
- chuyển status về authenticated;
- ghi đè pending recovery codes.

Đây là pattern “kết quả async phải còn thuộc lifecycle hiện tại”:

~~~text
request bắt đầu với epoch E1
  → logout/revocation đổi lifecycle sang E2
  → response của E1 về
  → nhận ra E1 đã invalid
  → bỏ qua response
~~~

## 9.4. Storage mutation queue

`transferIntentStorage.ts` và `savingsIntentStorage.ts` có `mutationQueue`. Các thao tác đọc/ghi/xóa được xếp hàng để hai lần ghi không đè nhau theo thứ tự khó đoán.

Parser còn fail closed:

- JSON không đúng shape → `IntentRecoveryError`;
- userId không khớp → không dùng intent;
- receipt ID không khớp operation ID → giữ dữ liệu và dừng khôi phục;
- migration legacy chỉ xóa key cũ sau khi ghi key mới thành công.

## 9.5. Database lock và retry

Ở Backend, `UnitOfWork` dùng một PoolClient cho toàn transaction. Transfer service khóa quote và account trước khi cập nhật. `withTransactionRetry` chỉ lặp lại transaction hoàn chỉnh khi lỗi serialization/deadlock.

Ở outbox, [outboxRepository.ts](C:/Projects/banking-system/backend/src/database/repositories/outboxRepository.ts) dùng `FOR UPDATE SKIP LOCKED` để nhiều worker không cùng claim một event. Đây là cơ chế cạnh tranh ở worker, khác với retry request của Mobile.

## 9.6. Response cũ và UI

Project có các hàng rào rõ ở các luồng quan trọng: epoch trong AuthContext, ref lock trong transfer, queue trong intent storage và transaction/row lock ở Backend. Tuy nhiên không nên suy ra rằng mọi screen đều có một thư viện chống stale response chung.

Khi đọc một screen, hãy kiểm tra cụ thể:

1. request nào đang chạy;
2. callback có dùng state mới nhất không;
3. component có còn mounted không;
4. có requestId/epoch/abort guard không;
5. response cũ có thể ghi đè state không.

## Câu hỏi tự kiểm tra phần 9

1. Vì sao `submitLockRef` tồn tại bên cạnh `isSubmitting`?
2. `sessionEpoch` bảo vệ tình huống nào?
3. Tại sao migration phải ghi key mới trước khi xóa key legacy?
4. `FOR UPDATE SKIP LOCKED` giải quyết vấn đề gì?
5. Có thể khẳng định mọi screen đều chống stale response không? Vì sao?

# 10. Test đang chứng minh điều gì?

Giai đoạn 9 không chỉ đọc code runtime. Test cho thấy tác giả muốn bảo vệ trường hợp biên nào.

## 10.1. HTTP client

[httpClient.test.ts](C:/Projects/banking-system/mobile-app/src/services/api/__tests__/httpClient.test.ts) kiểm tra các nhóm chính:

- timeout tạo code `TIMEOUT`;
- abort tạo `REQUEST_ABORTED`;
- lỗi fetch thông thường tạo `NETWORK_ERROR`;
- response sai JSON/shape tạo `INVALID_RESPONSE`;
- server 500 không lộ message nội bộ;
- hai request 401 dùng chung một refresh Promise;
- request retry sau refresh chỉ chạy một lần;
- hai session khác nhau không chia sẻ refresh.

Test không chỉ kiểm tra “fetch có được gọi”. Nó kiểm tra policy retry và thông tin lỗi.

## 10.2. Error presentation

[requestErrorPresentation.test.ts](C:/Projects/banking-system/mobile-app/src/components/ui/__tests__/requestErrorPresentation.test.ts) chứng minh:

- network hiển thị trạng thái offline;
- timeout nói rằng có thể thử lại;
- lỗi validation giữ message server.

Đây là test mapping từ domain error sang ngôn ngữ UI.

## 10.3. AuthContext

[AuthContext.test.tsx](C:/Projects/banking-system/mobile-app/src/features/auth/context/__tests__/AuthContext.test.tsx) kiểm tra boot, refresh, AppState background/active, MFA revocation, storage clear và response cũ về muộn.

Các test này bảo vệ lifecycle của session, không chỉ test màn hình login.

## 10.4. Transfer và intent

Các test trong:

- [transferStateMachine.test.ts](C:/Projects/banking-system/mobile-app/src/features/transfers/domain/__tests__/transferStateMachine.test.ts);
- [submitFailure.test.ts](C:/Projects/banking-system/mobile-app/src/features/banking/domain/__tests__/submitFailure.test.ts);
- [clientIntentLifecycle.test.ts](C:/Projects/banking-system/mobile-app/src/features/banking/domain/__tests__/clientIntentLifecycle.test.ts);
- [transferIntentStorage.test.ts](C:/Projects/banking-system/mobile-app/src/features/transfers/storage/__tests__/transferIntentStorage.test.ts).

chứng minh:

- terminal transfer không quay lại pending;
- lỗi transport giữ unknown;
- rejection có cấu trúc có thể đưa về draft;
- expired draft được xóa nhưng expired unknown được giữ;
- intent được scope theo user;
- receipt và operation ID phải khớp;
- migration legacy fail thì dữ liệu cũ được giữ.

## 10.5. Backend auth và HTTP

Các test Backend như [authRelational.test.ts](C:/Projects/banking-system/backend/src/tests/authRelational.test.ts), [http.test.ts](C:/Projects/banking-system/backend/src/tests/http.test.ts) và [http-security-persistence.test.ts](C:/Projects/banking-system/backend/src/tests/http-security-persistence.test.ts) kiểm tra token/device, revoke family, refresh reuse, status code, error contract và việc giữ security state khi domain request bị từ chối.

Không nên đọc tên test rồi kết luận tất cả production behavior đã được kiểm chứng. Hãy xem assertion cụ thể và runtime nào test đó sử dụng.

## 10.6. Những điều test chưa tự chứng minh

Unit test không tự chứng minh:

- mạng di động thực tế luôn ổn định;
- mọi database timeout được xử lý đúng;
- UI trên mọi kích thước màn hình;
- provider email/TOTP bên ngoài luôn trả kết quả;
- staging hoặc production đã sẵn sàng;
- mọi response cũ ở mọi screen đều bị loại bỏ.

Đây là giới hạn cần ghi nhận, không phải lý do để bỏ qua test.

## Câu hỏi tự kiểm tra phần 10

1. Test nào chứng minh refresh chỉ chạy một lần cho hai request 401?
2. Test nào chứng minh expired unknown intent không bị xóa?
3. Vì sao test `requestErrorPresentation` có giá trị riêng dù `httpClient` đã được test?
4. Unit test có chứng minh provider email thật hoạt động không?
5. Khi đọc một test, nên tìm assertion nào trước?

# 11. Bài tập tổng hợp

Các ví dụ dưới đây dùng dữ liệu giả. Hãy trả lời bằng tên file/class/method trong repository.

## Bài 1 — Mở Home khi không có account

Giả sử `GET /accounts` trả HTTP 200 với `accounts: []`.

1. `HomeScreen` đặt state nào sau `await listAccounts`?
2. UI hiển thị `RequestErrorNotice` hay `StateCard`?
3. Đây là lỗi hay empty state?

Gợi ý kiểm tra [HomeScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/home/screens/HomeScreen.tsx).

## Bài 2 — Lịch sử bị mất mạng

Giả sử `fetch` ném lỗi không có response.

1. `httpClient.ts` tạo code nào?
2. `getRequestErrorPresentation` chọn kind nào?
3. Người dùng bấm nút nào để gọi lại `loadInitial`?

## Bài 3 — Access token hết hạn

Giả sử request `/accounts` trả 401, refresh trả access token mới, request retry trả 200.

1. Có bao nhiêu request refresh được tạo nếu hai request cùng lúc gặp 401?
2. Tại sao retry lần hai không lặp vô hạn?
3. Class/context nào lưu session mới?

## Bài 4 — Refresh token bị thu hồi

Giả sử refresh trả `ApiError` status 401.

1. `isTerminalRefreshFailure` trả gì?
2. `AuthContext` làm gì với SecureStore?
3. Status cuối là `anonymous` hay `authenticated`?

## Bài 5 — Timeout sau submit transfer

Giả sử `submitTransfer` timeout sau khi Backend có thể đã tạo transfer.

1. Client giữ phase nào?
2. Có tạo idempotency key mới không?
3. Khi mở lại màn hình, method nào truy vấn transfer nếu đã có `transferId`?

## Bài 6 — Số dư không đủ

Giả sử Backend trả 409 `INSUFFICIENT_BALANCE` trước khi tạo transfer.

1. `shouldKeepSubmitUnknown` trả `true` hay `false`?
2. Client có giữ manual review code không?
3. Intent được đưa về phase nào?

## Bài 7 — Intent bị hỏng

Giả sử SecureStore chứa receipt có transfer ID khác `transferId`.

1. `transferIntentStorage` có dùng dữ liệu đó không?
2. Lỗi recovery nào được tạo?
3. Tại sao không xóa ngay record legacy?

## Bài 8 — KYC conflict

Giả sử lưu KYC trả 409 vì hồ sơ đã thay đổi trên server.

1. `KycScreen` gọi API nào để lấy bản canonical?
2. Vì sao không tự ghi đè bản server bằng draft cũ?
3. Người dùng nhìn thấy thông báo nào?

## Bài 9 — Admin action stale

Giả sử Admin mở action version 3 nhưng server hiện đã version 4.

1. `ErrorNotice` nhận diện code nào?
2. UI gợi ý thao tác gì?
3. Vì sao approve lại nguyên payload cũ là nguy hiểm?

## Bài 10 — Phân loại request

Hãy tự xếp các tình huống vào `known rejection`, `transport error` hoặc `unknown outcome`:

| Tình huống | Nhóm của bạn |
| --- | --- |
| Sai định dạng amount trước khi gửi | ? |
| HTTP 422 `VALIDATION_ERROR` | ? |
| HTTP 409 `INSUFFICIENT_BALANCE` | ? |
| `NETWORK_ERROR` sau submit transfer | ? |
| HTTP 500 sau submit transfer | ? |
| HTTP 200 với JSON thiếu field | ? |
| HTTP 401 sau khi refresh thất bại | ? |

## Checklist tự trace một trường hợp biên

Khi gặp một tình huống mới, hãy viết theo thứ tự:

~~~text
1. User action
2. Screen state trước request
3. Method API được gọi
4. Header/body/idempotency key
5. Route Backend
6. Service/repository/transaction
7. Response status + code
8. ApiError hoặc data validator
9. State sau request
10. UI và nút khôi phục
11. Có cần giữ intent hoặc truy vấn status không?
12. Test nào đã chứng minh điều này?
~~~

Nếu không trả lời được bước 11, hãy tạm coi thao tác command là chưa an toàn để retry bằng key mới. Đây là thói quen quan trọng nhất khi đọc các luồng tài chính.

## Câu hỏi kết thúc Giai đoạn 9

1. Lỗi nào có thể thử lại ngay, lỗi nào phải đăng nhập lại?
2. Khi nào một timeout là unknown outcome?
3. Tại sao `PENDING` khác `SUBMIT_UNKNOWN` dù cả hai đều chưa có trạng thái cuối?
4. UI có thể tự quyết định số dư sau lỗi mạng không?
5. Nếu phải thêm một trường hợp biên mới, bạn sẽ tìm state machine, API error mapping hay storage trước?

## Kết luận học tập

Sau Giai đoạn 9, mục tiêu là bạn có thể nhìn một lỗi và không chỉ hỏi “sửa dòng nào?”. Bạn có thể hỏi đúng hơn:

~~~text
Hệ thống đang ở state nào?
Server đã biết chắc điều gì?
Dữ liệu nào đã có thể thay đổi?
Retry có tạo duplicate không?
UI cần cho người dùng làm gì tiếp theo?
~~~

Đó là nền tảng để bước sang Giai đoạn 10: đọc test như bằng chứng cho từng state và từng trường hợp biên.

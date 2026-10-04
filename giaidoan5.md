# Giai đoạn 5 — Đọc code của các chức năng trong Banking System

Đối chiếu source tại HEAD **9c585ce**, ngày **20/09/2026**. Đây là tài liệu học từ code, không phải báo cáo đã chạy thử tất cả chức năng. Chỉ tạo tài liệu; không thay đổi code, dữ liệu hoặc cấu hình.

## Cách học tài liệu này

Giai đoạn 4 hỏi **dữ liệu đi đường nào**. Giai đoạn 5 hỏi **từng đoạn code trên đường đó làm gì**. Bạn nên đọc phần nền tảng, sau đó học M04 trước, M05 tiếp theo, rồi mới đến chuyển tiền M07. Mỗi lần chỉ học một chương và trả lời câu hỏi ở cuối chương.

“Tất cả chức năng” trong tài liệu là **16 nhóm Mobile và 6 nhóm Admin** theo phạm vi [USE_CASE_ROADMAP.md](C:/Projects/banking-system/USE_CASE_ROADMAP.md), cộng phần code dùng chung và xử lý nền liên quan. Các biến thể như xem chi tiết, gửi lại mã, khóa/mở khóa, đọc lại kết quả và xử lý lỗi được đặt trong cùng nhóm. Không chép toàn bộ JSX, style, file generated hoặc toàn bộ test vào tài liệu.

Luồng Backend được giải thích chủ yếu là **relational-v2**: Service → SQL repository → PostgreSQL. [http.ts](C:/Projects/banking-system/backend/src/http.ts) còn chứa nhánh gọi BankingSystem theo cấu hình. Không được lấy hành vi của nhánh này để khẳng định nhánh kia cũng chạy giống hệt. Những điểm chưa nối đầy đủ hoặc khác với tên gọi được ghi riêng.

Không có constructor cho mọi file. **HomeScreen**, **TransferScreen**, **AuthProvider** là function component React; các hàm API là hàm trong module. Chỉ những khai báo **class** mới được giải thích như class.

## Mục lục chức năng

| Mã | Chương | Trọng tâm đọc code |
|---|---|---|
| N01–N05 | Nền tảng | TypeScript, HTTP, Boundary, UnitOfWork, Repository |
| M01 | Đăng ký và hồ sơ KYC | Challenge, tạo customer/account, lưu nháp và gửi duyệt |
| M02 | Đăng nhập, phiên và đăng xuất | AuthProvider, token, refresh, logout |
| M03 | MFA và phục hồi | TOTP, recovery code, thay đổi yếu tố xác thực |
| M04 | Tài khoản, số dư, số tài khoản | Mapping, quyền sở hữu, hiện/sao chép số |
| M05 | Lịch sử và chi tiết giao dịch | Cursor, phân trang, dữ liệu hiển thị |
| M06 | Người thụ hưởng | Thêm, đọc, đổi tên, xóa mềm |
| M07 | Chuyển tiền | Quote, step-up, submit, idempotency, phục hồi |
| M08 | QR | Tạo và kiểm tra payload, camera |
| M09 | Thông báo | Danh sách, đánh dấu đã đọc, điều hướng |
| M10 | Báo cáo gian lận | Gửi báo cáo và đọc lại kết quả |
| M11 | Mở tiết kiệm | Báo giá, xác thực, ghi sổ |
| M12 | Xem và đáo hạn tiết kiệm | Danh sách, chi tiết, lifecycle |
| M13 | Đăng ký và kích hoạt tín dụng | Application, phê duyệt, tạo account/card |
| M14 | Quản lý thẻ | Xem, khóa, mở khóa, báo mất |
| M15 | Tài khoản tín dụng và sao kê | Giao dịch, sao kê, chi tiết |
| M16 | Thanh toán dư nợ | Quote, nguồn tiền, cập nhật nợ và kết quả |
| A01 | Đăng nhập và quyền Admin | Cookie, CSRF, TOTP, quản lý nhân viên |
| A02 | Khách hàng, tài khoản, tiền demo | Tra cứu và yêu cầu thao tác |
| A03 | Duyệt KYC | Nhận hồ sơ, đề xuất, phê duyệt |
| A04 | Duyệt tín dụng | Hạn mức, trạng thái chờ kích hoạt |
| A05 | Giao dịch, fraud và vận hành | Retry, cancel, reversal, outbox/jobs |
| A06 | Phê duyệt và audit | Maker–checker, fingerprint, version |
| N06 | Xử lý nền | Worker và lịch đáo hạn/sao kê |

## N01 — Những cú pháp cần biết trước

Đọc đoạn thật trong [RelationalAccountReadService](C:/Projects/banking-system/backend/src/database/relationalAccountReadService.ts:106):

~~~typescript
export class RelationalAccountReadService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async listAccounts(customerId: string): Promise<PaymentAccount[]> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const accounts = await new AccountRepository(client).findAccountsByCustomer(customerId);
      return accounts.map(toPaymentAccount);
    });
  }
~~~

Đây là phần trích class; các method còn lại được giải thích ở M04–M05.

| Đoạn code | Nghĩa cho người mới |
|---|---|
| export | Cho module khác import class này |
| class | Bản mô tả cách tạo một object có dữ liệu và hành vi |
| constructor(...) | Chạy khi gọi new RelationalAccountReadService(...) |
| private readonly unitOfWork | TypeScript vừa khai báo thuộc tính vừa gán tham số vào thuộc tính; chỉ dùng nội bộ và không gán lại tham chiếu qua code TypeScript thông thường |
| this | Object RelationalAccountReadService đang thực hiện method |
| customerId: string | Tham số là chuỗi; thông thường đến từ phiên đã xác thực ở Backend |
| async | Hàm trả Promise; có thể dùng await bên trong |
| Promise<PaymentAccount[]> | Lời hứa trả một mảng PaymentAccount khi hoàn thành; không phải dữ liệu có ngay lập tức |
| await | Chờ Promise hoàn thành trước khi chạy bước phụ thuộc tiếp theo; không khóa toàn bộ Node.js |
| async ({ client }) => {...} | Callback: một hàm được truyền cho transaction; lấy thuộc tính client từ object callback nhận được |
| new AccountRepository(client) | Tạo repository dùng đúng kết nối của transaction này |
| accounts.map(toPaymentAccount) | Với từng hàng, gọi hàm chuyển đổi và tạo mảng kết quả mới |
| return this.unitOfWork.transaction(...) | Trả kết quả của công việc trong transaction; UnitOfWork sẽ commit trước khi Promise ngoài hoàn tất |

**Luồng dữ liệu đổi hình dạng:**

~~~text
SQL row: available_minor
  → mapAccount: availableMinor (chuỗi)
  → toPaymentAccount: availableBalance = { currency: "VND", amountMinor: "..." }
  → JSON qua HTTP
  → Mobile validator
  → state
  → UI định dạng để hiển thị
~~~

**Không nhầm type với kiểm tra dữ liệu.** PaymentAccount là kiểu TypeScript, giúp phát hiện lỗi khi phát triển. JSON từ mạng vẫn cần validator lúc chạy. Ép kiểu bằng “as PaymentAccount” không tự kiểm chứng các field.

**Tiền trong project.** [money.ts](C:/Projects/banking-system/backend/src/money.ts) có parseMoney nhận unknown, kiểm tra object VND và chuỗi số không âm, rồi trả bigint. toMoney nhận bigint và trả object JSON với amountMinor dạng chuỗi. Ví dụ **"100000" → 100000n → "100000"**. Ký tự n đánh dấu số nguyên bigint; JSON.stringify không trực tiếp xử lý bigint. Ví dụ tiền trong tài liệu là dữ liệu minh họa, không phải số dư thật.

**React state và ref.** useState giữ dữ liệu để React render lại màn hình khi cập nhật. useRef giữ một giá trị thay đổi được mà không yêu cầu render; vì vậy submitLockRef có thể chặn hai lần bấm sát nhau ngay lập tức. useCallback tạo/giữ tham chiếu callback theo dependency; bản thân useCallback không tự gửi request.

**Tự kiểm tra:** (1) await chờ điều gì? (2) map có cập nhật PostgreSQL không? (3) Vì sao JSON vẫn phải kiểm tra dù TypeScript đã có type?

## N02 — Module HTTP của Mobile: requestJson

Nguồn: [httpClient.ts](C:/Projects/banking-system/mobile-app/src/services/api/httpClient.ts:177).

1. **Vai trò.** Gửi HTTP và chuẩn hóa lỗi cho các feature. Xóa module này sẽ làm các API wrapper import nó không biên dịch/chạy được.
2. **Vị trí.** Màn hình → hàm trong accountsApi/transfersApi/... → requestJson → fetch → Backend.
3. **Input.** path; RequestOptions gồm method, body, auth, headers, signal, timeoutMs, requestId, idempotencyKey, retryOnUnauthorized; validator tùy chọn.
4. **Output.** Promise<ResponseBody> nếu hợp lệ; nếu lỗi thì throw ApiError. Không trực tiếp gọi setState.
5. **Dữ liệu giữ.** DEFAULT_TIMEOUT_MS = 15_000; requestSequence để tạo request ID; refreshPromises là WeakMap gộp các request refresh dùng cùng callback.
6. **Constructor.** Không có: đây là module hàm. import không tương đương new HttpClient.
7. **Các hàm.** buildUrl ghép base/path; createRequestId tạo mã theo dõi; parseJson đọc JSON; createAbortState quản lý timeout/hủy; validateRequestOptions chặn timeout vô nghĩa; refreshAccessTokenSingleFlight dùng chung Promise refresh; requestJson điều phối tất cả. Các create...Error tạo lỗi có cấu trúc; reportApiFailure ghi metadata đã giới hạn.
8. **Ai gọi ai.** requestJson → fetch → xử lý 401 → refreshAccessTokenSingleFlight → gọi lại requestJson với retryOnUnauthorized = false → kiểm tra payload.
9. **Ai tạo đối tượng.** Không tạo instance của module; requestJson tạo headers và trạng thái AbortController cho mỗi request.
10. **Phụ thuộc.** apiConfig, ApiError, callback refresh từ AuthProvider, fetch và validator của feature.
11. **Code khó.** Xem đoạn thật dưới đây.
12. **Ví dụ.** HomeScreen gọi listAccounts; token hết hạn gây 401; client thử refresh một lần rồi gửi lại. Nếu JSON sai cấu trúc, nhận INVALID_RESPONSE, không đưa dữ liệu sai vào UI.

~~~typescript
if (validateResponse && !validateResponse(payload)) {
  const invalidResponseError = createInvalidResponseError(response.status);
  reportApiFailure(method, invalidResponseError);
  throw invalidResponseError;
}
~~~

Toán tử && chỉ gọi validator khi nó được cung cấp. ! đảo kết quả kiểm tra. throw làm Promise bị reject; catch ở màn hình xử lý lỗi. HTTP 204 được xử lý thành null thay vì cố đọc một JSON không tồn tại.

**Tự kiểm tra:** (1) requestJson biết layout HomeScreen không? (2) Vì sao không refresh lặp vô hạn? (3) TIMEOUT có chứng minh Backend chưa ghi dữ liệu không?

## N03 — RelationalHttpBoundary: cửa nối HTTP với Service

Nguồn: [relationalHttpBoundary.ts](C:/Projects/banking-system/backend/src/database/relationalHttpBoundary.ts:33), [http.ts](C:/Projects/banking-system/backend/src/http.ts).

1. **Vai trò.** Tập hợp các entry method cho nhánh relational; chọn nhóm route được bật. Bỏ class này sẽ mất điểm nối mà HTTP đang gọi.
2. **Vị trí.** handleRequest → kiểm tra request/phiên/step-up → Boundary → Service.
3. **Input.** Constructor nhận UnitOfWork và routeConfig tùy chọn; các method nhận customerId, tham số route và request nghiệp vụ.
4. **Output.** Promise theo API: tài khoản, quote, receipt, application... Không tự render UI.
5. **Thuộc tính.** unitOfWork, routes; auth, accounts, registration, beneficiaries, transfers, savings, credit, remaining, kyc là object service.
6. **Constructor.** Đọc cấu hình route và tạo các service dùng cùng UnitOfWork. Chặn bật nhóm tài khoản/lệnh nghiệp vụ mà không bật auth.
7. **Các method.** isRouteEnabled kiểm tra method/path; assertRelationalV2Complete kiểm tra nhóm route bắt buộc; các method nghiệp vụ ủy quyền, được liệt kê ở từng chương. enabled cho biết có nhóm nào bật.
8. **Ai gọi ai.** Ví dụ listAccounts → accounts.listAccounts; createTransferQuote → transfers.createQuote; submitTransfer → transfers.submit rồi toPublic.
9. **Ai tạo object.** Code khởi tạo HTTP/Backend ghép Boundary với UnitOfWork; Boundary tạo service trong constructor. Nó không tạo lại tất cả service mỗi lần bấm nút.
10. **Phụ thuộc.** Các service relational cụ thể và cấu hình; đây chưa phải lớp hoàn toàn độc lập mọi implementation.
11. **Code khó.** this.accounts = new RelationalAccountReadService(unitOfWork) nghĩa là giữ một object service để dùng về sau. Không có SELECT nào chỉ vì thực hiện phép gán này.
12. **Ví dụ.** HTTP xác định người dùng C; gọi boundary.listAccounts(C); Boundary chuyển tiếp C, Service mới bắt đầu transaction đọc.

**Tự kiểm tra:** (1) Constructor có tự lấy số dư không? (2) Vì sao phải biết nhóm route đang bật? (3) Method Boundary và method Service cùng tên có phải cùng object không?

## N04 — UnitOfWork: bao bọc transaction

Nguồn: [unitOfWork.ts](C:/Projects/banking-system/backend/src/database/unitOfWork.ts), [transactionRetry.ts](C:/Projects/banking-system/backend/src/database/transactionRetry.ts).

1. **Vai trò.** Đảm bảo callback nghiệp vụ dùng một kết nối và một transaction. Bỏ class nhưng giữ nguyên caller sẽ lỗi; thay bằng query rời rạc có thể làm ghi dữ liệu dở dang.
2. **Vị trí.** Service.transaction(callback) → DatabasePool.connect → callback với client → COMMIT/ROLLBACK.
3. **Input.** Hàm operation nhận TransactionContext; options cho isolation/retry và thông tin liên quan.
4. **Output.** Promise<T>, với T là đúng kiểu kết quả callback trả. Lỗi được ném lại sau khi thử rollback.
5. **Thuộc tính.** database là DatabasePool; counters giữ started, committed, rolledBack, retried và thời gian thực thi.
6. **Constructor.** Nhận DatabasePool đã được tạo. Không mở transaction ngay.
7. **Method.** metrics trả bản sao số liệu; transaction lấy client, BEGIN, gọi operation, COMMIT; catch thử ROLLBACK; finally release client. withTransactionRetry ở module riêng chỉ thử lại lỗi database được phân loại có thể retry.
8. **Ai gọi ai.** Service → transaction → withTransactionRetry → callback → các repository; nếu callback lỗi thì quay về catch của UnitOfWork.
9. **Ai tạo object.** Phần ghép dependency Backend tạo UnitOfWork từ pool; Admin repository và worker cũng có điểm tạo UnitOfWork riêng. Không đồng nghĩa mọi process dùng chung một kết nối.
10. **Phụ thuộc.** DatabasePool, TransactionContext và bộ phân loại lỗi PostgreSQL. Các repository nhận client của callback, không tự COMMIT.
11. **Code khó.** Callback là “việc cần làm”, UnitOfWork là “cách mở/đóng transaction quanh việc đó”. Generic T giữ nguyên kiểu kết quả thay vì trả any. finally chạy cả khi thành công lẫn thất bại để trả kết nối về pool.
12. **Ví dụ.** Đã ghi trừ A, nhưng ghi cộng B lỗi: throw thoát callback; transaction rollback nên phần trừ chưa commit không được giữ lại.

Mặc định transaction dùng READ COMMITTED. Điều này **không** tự làm mọi thao tác nhiều bước an toàn trước cạnh tranh; các luồng tiền còn dùng khóa hàng và kiểm tra version. withTransactionRetry mặc định maxRetries = 1, chấp nhận 0–2; không phải retry mọi lỗi HTTP hay tự giải quyết trường hợp mất phản hồi sau commit.

**Tự kiểm tra:** (1) Vì sao mọi repository trong một lệnh phải nhận cùng client? (2) Callback trả kết quả rồi có đồng nghĩa COMMIT đã xong chưa? (3) Có nên gửi email trực tiếp trong callback có thể chạy lại không?

## N05 — AccountRepository: từ method TypeScript đến SQL

Nguồn: [accountRepository.ts](C:/Projects/banking-system/backend/src/database/repositories/accountRepository.ts:73).

1. **Vai trò.** Đọc/ghi payment_accounts và account_transactions, chuyển SQL row sang object. Xóa nó khiến các service tài khoản, chuyển tiền, tiết kiệm và tín dụng mất phần truy cập dữ liệu.
2. **Vị trí.** Service → AccountRepository → client.query → PostgreSQL.
3. **Input.** Constructor nhận PoolClient; method nhận customerId, accountId, số dư, cursor hoặc dữ liệu giao dịch.
4. **Output.** AccountRow, AccountTransactionRow, mảng hoặc null; updateBalances ném lỗi khi không cập nhật được hàng.
5. **Thuộc tính.** private readonly client. Repository không giữ bản cache số dư của người dùng.
6. **Constructor.** Gắn client vào object. new repository không tạo account trong database; createForCustomer mới thực hiện INSERT.
7. **Các method.** Bảng dưới đây.
8. **Ai gọi ai.** RelationalAccountReadService gọi các method đọc; RelationalTransferService gọi khóa, updateBalances và appendTransaction; các service tiết kiệm/tín dụng dùng lại method phù hợp.
9. **Ai tạo object.** Service gọi new AccountRepository(client) bên trong callback của UnitOfWork.
10. **Phụ thuộc.** PoolClient của pg; rowMappers kiểm tra UUID, số dạng chuỗi và thời gian.
11. **Code khó.** SQL $1/$2 là vị trí tham số, giá trị được truyền bằng mảng riêng. mapAccount chuyển tên snake_case ở DB thành camelCase ở TypeScript.
12. **Ví dụ.** findOwnedAccount(C,A) chỉ tìm hàng có cả id=A và customer_id=C. Biết A nhưng không sở hữu nó vẫn không lấy được hàng qua method này.

| Method | Công việc |
|---|---|
| createForCustomer | Tạo tài khoản và số tài khoản từ sequence; số dư khởi tạo theo input/default |
| findOwnedAccount | Đọc một tài khoản có kiểm tra customer sở hữu |
| findByAccountNumber | Tra cứu số tài khoản; caller phải áp dụng quyền/nghiệp vụ đúng bối cảnh |
| findAccountsByCustomer | Danh sách của customer, ORDER BY id |
| lockById | SELECT ... FOR UPDATE một hàng |
| lockManyByIds | Khóa nhiều tài khoản theo thứ tự id |
| updateBalances | Cập nhật available/current/held, tăng version; kiểm tra expectedVersion nếu truyền vào |
| updateStatus | Đổi trạng thái và tăng version |
| listTransactions | Lọc theo account và cursor, sắp occurred_at/id giảm dần |
| findTransaction | Tìm transaction trong đúng account |
| appendTransaction | Thêm dòng lịch sử giao dịch |

~~~typescript
const result = await this.client.query(
  "SELECT * FROM payment_accounts WHERE id = $1 AND customer_id = $2",
  [requireUuid(accountId, "accountId"), requireUuid(customerId, "customerId")],
);
~~~

Dòng đầu chờ PostgreSQL. Chuỗi SQL nói “lọc theo hai điều kiện”. Mảng xác định $1 là accountId, $2 là customerId. Sau đó method trả null hoặc gọi mapAccount. Đây là tham số hóa SQL; không nối trực tiếp input vào câu lệnh.

**Tự kiểm tra:** (1) new AccountRepository tạo kết nối mới không? (2) findByAccountNumber có kiểm tra chủ sở hữu như findOwnedAccount không? (3) updateBalances khác appendTransaction ở dữ liệu nào?

## M01 — Đăng ký và hồ sơ KYC

**Mở code:** [RegisterScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/auth/screens/RegisterScreen.tsx), [authApi.ts](C:/Projects/banking-system/mobile-app/src/features/auth/services/authApi.ts), [registrationService.ts](C:/Projects/banking-system/backend/src/database/registrationService.ts), [KycScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/kyc/screens/KycScreen.tsx), [kycApi.ts](C:/Projects/banking-system/mobile-app/src/features/kyc/services/kycApi.ts), [kycService.ts](C:/Projects/banking-system/backend/src/database/kycService.ts).

1. **Vai trò.** RelationalRegistrationService tạo danh tính khách hàng sau khi xác minh đăng ký. RelationalKycService lưu/gửi hồ sơ định danh demo. Hai việc riêng: đăng ký không đồng nghĩa KYC đã được Admin duyệt. Bỏ registration service thì không tạo được khách hàng qua nhánh này; bỏ KYC service thì mất lưu nháp/gửi hồ sơ.
2. **Vị trí.** RegisterScreen → AuthProvider → authApi → HTTP → Boundary → registration. KycScreen → kycApi → HTTP/Boundary → kyc. Cả hai dùng UnitOfWork.
3. **Input.** Đăng ký: fullName, email, phone, password và deviceId; xác minh: challengeId, proof. KYC: dữ liệu nháp đã kiểm tra, customerId từ phiên; đây là hồ sơ synthetic phục vụ demo.
4. **Output.** Bắt đầu đăng ký trả challenge; xác minh thành công trả user, không nên đọc thành “đã có phiên đăng nhập”. KYC trả application hoặc null khi chưa có hồ sơ.
5. **Thuộc tính/state.** Hai service giữ unitOfWork. RegisterScreen giữ dữ liệu form, lỗi, trạng thái gửi/hủy, mã xác minh và phase; persistedChallengeRef giúp nhớ challenge. KycScreen giữ application và draft riêng: dữ liệu đã lưu và dữ liệu đang sửa.
6. **Constructor.** Hai class nhận UnitOfWork. React gọi RegisterScreen/KycScreen; không có new RegisterScreen().
7. **Method/hàm cần đọc.** Bảng bên dưới tách việc của UI và server.
8. **Ai gọi ai.** handleRegister → register hoặc verifyRegistrationChallenge tùy phase. RelationalRegistrationService.verify → mfaService.verifyChallenge → complete. KYC handleSaveDraft → saveKycDraft → saveDraft; handleSubmit → submitKycApplication → submit.
9. **Ai tạo object.** Boundary tạo hai service. Service tạo repository trong transaction; PersistentMfaService được đưa vào đường đăng ký từ tầng HTTP.
10. **Phụ thuộc/dữ liệu.** CustomerRepository, AccountRepository, MFA, audit/outbox; pending registration, customers, payment_accounts, registration_completions, customer_feature_entitlements; KYC dùng SQL trên kyc_applications và bản ghi liên quan. Không có class KycRepository riêng trong luồng này.
11. **Code khó.** BEGIN_UNKNOWN là “đã chuẩn bị gửi nhưng chưa biết server tiếp nhận ra sao”; CHALLENGE_RECEIVED nghĩa là đã biết challenge. Lưu trước request giúp khôi phục sau app đóng. Trong complete, tạo customer và account trong một transaction: nếu account tạo lỗi thì không giữ một customer mới tạo dở dang của transaction đó.
12. **Ví dụ.** Người học nhập hồ sơ demo → nhận challenge → nhập mã đúng → customer và tài khoản số dư ban đầu 0 được tạo → quay lại đăng nhập. Sau đăng nhập, lưu KYC nháp rồi submit để Admin xem xét; UI phải hiển thị trạng thái server trả, không tự đổi APPROVED.

| File/class | Method/hàm | Công việc |
|---|---|---|
| RegisterScreen | handleRegister | Kiểm tra form ở bước đầu; ở bước OTP thì xác minh challenge |
| RegisterScreen | handleCancel | Gửi hủy và xử lý dữ liệu đăng ký đang lưu ở máy |
| authApi | register, verifyRegistrationChallenge, resendRegistrationChallenge, cancelRegistration | Đóng gói các HTTP request; không tự INSERT customer |
| RelationalRegistrationService | begin | Chuẩn hóa/kiểm tra, hash mật khẩu, lưu đăng ký chờ và tạo email challenge |
| RelationalRegistrationService | verify | Kiểm tra context challenge/device, xác minh proof rồi hoàn thành |
| RelationalRegistrationService | complete | Khóa đăng ký chờ, xử lý kết quả cũ, tạo customer/account/entitlements và dấu vết |
| RelationalRegistrationService | cancel | Xử lý hủy đăng ký chờ khi được gọi đúng đường |
| KycScreen | loadApplication, updateDraft | Đọc hồ sơ; cập nhật một field trong bản nháp |
| KycScreen | handleSaveDraft, handleSubmit | Kiểm tra input, gọi API, cập nhật trạng thái hoặc đọc lại khi xung đột |
| kycApi | requireDraft | Chuẩn hóa/kiểm tra dữ liệu trước khi gửi |
| RelationalKycService | get, saveDraft, submit, lockOpen | Đọc; lưu nháp; chuyển sang chờ xử lý; khóa hồ sơ đang mở để cập nhật |

**Điểm cần đọc cẩn thận:** http.ts có handler /auth/register/cancel, nhưng predicate nhóm registration trong RelationalHttpBoundary.isRouteEnabled chỉ nhận đường bắt đầu và xác minh. Trong relational-v2, guard registration trước handler trả 503 RELATIONAL_ROUTE_OUT_OF_SCOPE khi route không được bật. Vì thế không nối trace HTTP cancel tới RelationalRegistrationService.cancel chỉ vì method tồn tại. Đây là sự lệch giữa handler và chọn route quan sát từ source, chưa sửa và chưa chạy kiểm chứng trong phiên viết tài liệu.

**Tự kiểm tra:** (1) Khi nào tài khoản thanh toán thực sự được tạo? (2) Tại sao draft KYC và application tách nhau? (3) Có method cancel là đủ chứng minh HTTP đã nối tới nó chưa?

## M02 — Đăng nhập, phiên đăng nhập và đăng xuất

**Mở code:** [LoginScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/auth/screens/LoginScreen.tsx), [AuthContext.tsx](C:/Projects/banking-system/mobile-app/src/features/auth/context/AuthContext.tsx), [ProfileScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/profile/screens/ProfileScreen.tsx), [relationalAuthService.ts](C:/Projects/banking-system/backend/src/database/relationalAuthService.ts).

1. **Vai trò.** AuthProvider quản lý phiên trên Mobile; RelationalAuthService xác minh và quản lý phiên bền vững phía server. Bỏ AuthProvider thì useAuth không có context để các màn hình dùng; bỏ service thì nhánh relational không xác thực được phiên.
2. **Vị trí.** LoginScreen → useAuth().login → authApi.login → HTTP → loginPasswordOnly → issueMfaSession → issueSession. Tên issueMfaSession ở Boundary không chứng minh lần login này đã qua MFA.
3. **Input.** Email/password/deviceId cho login; access token/device cho authenticate; refresh token/device cho refresh; scope current hoặc all cho logout Mobile.
4. **Output.** Login trả thông tin phiên/token/user; AuthProvider chuyển state để UI hiển thị nội dung được bảo vệ. Logout trả LogoutResult có localSessionCleared, remoteRevoked, recoveryIntentsPreserved.
5. **Thuộc tính/state.** Backend giữ unitOfWork. Provider giữ status, session, deviceId, logoutNotice, pendingRecoveryCodes; các ref giữ phiên hiện tại, epoch, tác vụ refresh đang chạy và trạng thái mounted. Epoch là mã phân biệt đời phiên để kết quả cũ không ghi đè phiên mới.
6. **Constructor.** Boundary tạo RelationalAuthService(UnitOfWork). AuthProvider là component bao quanh cây UI; các callback được tạo trong vòng đời React.
7. **Method/hàm.** Bảng dưới đây. ProfileScreen đọc user trong session và cung cấp logout; không cần suy ra có API “GET profile” riêng.
8. **Ai gọi ai.** requestJson gặp 401 → refreshAccessToken → refreshSession của Provider → authApi.refreshSession → service.refresh. Các hàm cùng tên nằm ở những module khác nhau.
9. **Ai tạo object.** Phần layout/provider của ứng dụng render AuthProvider; Boundary tạo service; service tạo CustomerRepository và các object dữ liệu phiên trong transaction.
10. **Phụ thuộc/dữ liệu.** Lưu phiên trên thiết bị, authApi, kiểm tra mật khẩu, customers, customer_devices, auth_sessions, refresh_session_families, refresh_session_records, rate_limit_buckets và audit.
11. **Code khó.** setActiveSession đồng bộ ref/state. Promise refresh được chia sẻ để nhiều request không xoay token cùng lúc. Sau await, code kiểm tra epoch: người dùng có thể đã logout trong lúc đang chờ mạng. Có token lưu ở máy chưa đủ để tin phiên còn hợp lệ; cold start đặt locked trước khi xác nhận lại.
12. **Ví dụ.** Hai màn hình cùng gặp token hết hạn. Chúng dùng chung refresh đang chạy. Nếu người dùng logout khi refresh chưa xong, kết quả refresh cũ không được làm người dùng “tự đăng nhập lại”.

| Module | Hàm/method | Ý nghĩa |
|---|---|---|
| AuthProvider | ensureDeviceId | Lấy/khởi tạo định danh thiết bị qua storage |
| AuthProvider | setActiveSession | Cập nhật nguồn tham chiếu và state phiên |
| AuthProvider | login | Gọi login API, tạo/lưu session rồi cập nhật UI |
| AuthProvider | refreshSession | Quản lý một lần xoay phiên, chống kết quả cũ và phân loại lỗi |
| AuthProvider | refreshAccessTokenForEpoch, refreshAccessToken | Trả access token còn gắn với đời phiên đúng |
| AuthProvider | waitForPendingRefreshes, beginLogout | Phối hợp logout với refresh đang chạy |
| AuthProvider | clearLocalSession, logout, logoutAll | Dọn phiên máy và yêu cầu thu hồi phạm vi tương ứng |
| AuthProvider | completeMfaRevocation, clearPendingRecoveryCodes | Đồng bộ UI sau thay đổi MFA và quản lý mã phục hồi hiển thị |
| RelationalAuthService | loginPasswordOnly | Kiểm tra mật khẩu và giới hạn thử đăng nhập |
| RelationalAuthService | issueSession | Gắn device, tạo session và dữ liệu refresh |
| RelationalAuthService | authenticate, getUser | Xác minh phiên hoặc đọc user |
| RelationalAuthService | verifyCurrentPassword | Xác minh lại mật khẩu cho thao tác yêu cầu |
| RelationalAuthService | refresh | Khóa dữ liệu refresh, xoay token; xử lý phát hiện dùng lại |
| RelationalAuthService | revoke, revokeAll | Thu hồi theo phạm vi phiên/gia đình refresh hoặc toàn bộ customer |

**Điểm dễ nhầm:** clearLocalSession không phải bằng chứng server đã thu hồi token. Vì vậy LogoutResult phân biệt hai kết quả. Intent nghiệp vụ cần phục hồi không bị coi như cache phiên có thể xóa tùy tiện.

**Tự kiểm tra:** (1) Tại sao xóa token ở máy chưa đủ? (2) Epoch chống lỗi tình huống nào? (3) Ai chịu trách nhiệm xác nhận token hợp lệ: UI hay server?

## M03 — MFA, TOTP và phục hồi yếu tố xác thực

**Mở code:** [MfaMethodsScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/auth/screens/MfaMethodsScreen.tsx), [MfaRecoveryScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/auth/screens/MfaRecoveryScreen.tsx), [persistentMfaService.ts](C:/Projects/banking-system/backend/src/mfa/persistentMfaService.ts), [mfaRepository.ts](C:/Projects/banking-system/backend/src/database/repositories/mfaRepository.ts), [otpApi.ts](C:/Projects/banking-system/mobile-app/src/features/auth/services/otpApi.ts).

1. **Vai trò.** PersistentMfaService quản lý credential, challenge, kiểm tra proof và recovery. MfaMethodsScreen quản lý yếu tố đã đăng ký; MfaRecoveryScreen đi theo luồng phục hồi. Bỏ service làm mất xác minh bổ sung phía server, không chỉ mất một màn hình.
2. **Vị trí.** UI → authApi/otpApi → HTTP kiểm tra mục đích/quyền → PersistentMfaService → MfaRepository → DB.
3. **Input.** Customer/device, purpose, resourceId/fingerprint, challengeId và proof; enrollment/recovery có input riêng. Không ghi proof, secret hay recovery code vào log.
4. **Output.** Danh sách metadata credential, challenge, kết quả enrollment, recovery request/token theo từng bước. Recovery token là quyền giới hạn cho phục hồi, không phải access token sử dụng ngân hàng.
5. **Thuộc tính.** Service giữ options chứa unitOfWork, encryption, otpDigestKeyring, environmentScope và các dependency delivery, codeGenerator, clock, metrics. Screen giữ danh sách, challenge/enrollment đang thực hiện, input proof, trạng thái chờ/lỗi; token phục hồi dùng trong luồng màn hình.
6. **Constructor.** Nhận object cấu hình/dependency; khởi tạo các dependency tùy chọn theo mặc định. MfaRepository nhận client của transaction.
7. **Các method.** Bảng dưới đây giúp đọc theo từng nhóm, không học cả file lớn cùng lúc.
8. **Ai gọi ai.** handleBeginEnrollment/handleConfirmEnrollment của màn hình quản lý gọi beginTotpEnrollment/confirmTotpEnrollment ở authApi. Phục hồi gọi startMfaRecovery → completeMfaRecovery → beginRecoveryTotpEnrollment → confirmRecoveryTotpEnrollment theo trạng thái/cooldown.
9. **Ai tạo object.** Tầng khởi tạo Backend cung cấp PersistentMfaService cho HTTP; service tạo MfaRepository trong transaction. UI do React render.
10. **Phụ thuộc/dữ liệu.** auth_challenges, mfa_credentials, mfa_recovery_codes, mfa_recovery_requests, auth_security_events, rate limits; encryption dùng bảo vệ secret lưu trữ. Các route thay đổi MFA phối hợp thu hồi session.
11. **Code khó.** purpose và requestFingerprint ràng buộc proof với loại thao tác/nội dung được xác nhận. Một mã hợp lệ về thời gian vẫn có thể sai mục đích hoặc không thuộc challenge/device/customer đang dùng.
12. **Ví dụ.** Bạn bật TOTP, xác nhận mã đầu tiên, giữ recovery codes ở nơi riêng. Khi mất yếu tố, luồng recovery kiểm tra mật khẩu và recovery code, chờ điều kiện cho phép rồi đăng ký yếu tố mới; không bỏ qua các bước để cấp ngay phiên ngân hàng.

| Method PersistentMfaService | Công việc |
|---|---|
| listCredentials | Trả thông tin credential có thể công khai |
| beginTotpEnrollment, confirmTotpEnrollment | Tạo enrollment và xác minh trước khi kích hoạt |
| beginRecoveryTotpEnrollment | Enrollment trong bối cảnh phục hồi đã được phép |
| revokeCredential | Thu hồi credential với guard tương ứng |
| beginLoginChallenge, beginTotpChallenge | Tạo challenge theo mục đích; không mặc định mọi login Mobile gọi beginLoginChallenge |
| createEmailChallenge | Tạo/gửi email challenge, dùng trong đăng ký |
| verifyChallenge | Kiểm tra challenge, hạn, proof và binding; cập nhật trạng thái/attempt |
| resendChallenge, resendRegistrationChallenge | Đường gửi lại theo bối cảnh và giới hạn |
| verifyRecoveryCode, completeRecovery | Tiêu thụ code phục hồi và hoàn thành yêu cầu theo điều kiện |
| rotateRecoveryCodes | Thay bộ recovery codes |

Tên method resend trong class cần đọc theo source: **resendChallenge** không nên suy từ tên nút “resend OTP” thành gửi email ở mọi nghiệp vụ. createOtpChallenge phía Mobile trong nhánh persistent step-up có thể nhận **method TOTP**; không đồng nhất “OTP” trong nhãn UI với “mã gửi SMS”.

**Tự kiểm tra:** (1) Recovery token có thể dùng gọi xem số dư không? (2) Vì sao challenge cần purpose? (3) Thay đổi yếu tố xác thực liên quan gì tới các phiên đang tồn tại?

## M04 — Xem tài khoản, số dư và số tài khoản

**Mở code:** [HomeScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/home/screens/HomeScreen.tsx), [AccountDetailScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/accounts/screens/AccountDetailScreen.tsx), [accountsApi.ts](C:/Projects/banking-system/mobile-app/src/features/accounts/services/accountsApi.ts), [relationalAccountReadService.ts](C:/Projects/banking-system/backend/src/database/relationalAccountReadService.ts).

1. **Vai trò.** RelationalAccountReadService trả dữ liệu account phù hợp API, kiểm tra quyền và ghi dấu vết khi lộ số đầy đủ. Nếu bỏ nó, Boundary không có nơi xử lý các yêu cầu đọc này; chuyển hết SQL lên UI cũng không khả thi vì DB ở server.
2. **Vị trí.** HomeScreen.loadAccounts → accountsApi.listAccounts → requestJson → HTTP → Boundary.listAccounts → service.listAccounts → AccountRepository.
3. **Input.** listAccounts nhận customerId tại Backend; getAccountNumber nhận thêm accountId. CustomerId không lấy từ một ô nhập trên HomeScreen.
4. **Output.** Service trả PaymentAccount[]; HTTP đóng gói danh sách cho Mobile. getAccountNumber của service trả string; API Mobile nhận response chứa số tài khoản.
5. **Thuộc tính/state.** Service chỉ giữ unitOfWork. HomeScreen giữ account, loading/error, trạng thái ẩn/hiện số dư/số tài khoản và số đầy đủ đã lấy; AccountDetailScreen dùng accountId của route.
6. **Constructor.** constructor(private readonly unitOfWork: UnitOfWork) {} không truy vấn ngay; Boundary là nơi new service.
7. **Method.** listAccounts đọc các row và map; getAccountNumber kiểm tra ID/quyền, append audit rồi trả số. Hai method lịch sử dùng cùng class được đọc tiếp ở M05.
8. **Ai gọi ai.** HomeScreen.handleToggleAccountNumber/handleCopyAccountNumber → revealAccountNumber → accountsApi.getAccountNumber. AccountDetailScreen có handleToggleNumber/handleCopyNumber/revealAccountNumber tương tự.
9. **Ai tạo object.** React render hai screen; Boundary tạo service; mỗi callback transaction tạo AccountRepository và, khi cần, AuditRepository.
10. **Phụ thuộc/dữ liệu.** payment_accounts, audit_events; Clipboard ở Mobile khi sao chép; AuthProvider cấp thông tin phiên.
11. **Code khó.** Đoạn listAccounts đã giải thích từng dòng ở N01. Trong toPaymentAccount, availableMinor được bọc vào availableBalance, currentMinor vào currentBalance, heldMinor vào heldAmount. Không trả nguyên row gồm mọi field nội bộ.
12. **Ví dụ.** AccountRow có availableMinor = "250000", currentMinor = "300000", heldMinor = "50000". UI nhận ba Money object khác nhau. Ẩn/hiện số dư chỉ đổi UI state; bấm hiện số tài khoản đầy đủ có thể gọi API riêng.

**Bóc getAccountNumber:**

~~~text
assertAccountId(accountId)
  → tìm bằng cả customerId và accountId
  → không thấy: throw notFound
  → có: AuditRepository.append(eventType = ACCOUNT_NUMBER_REVEALED)
  → return account.accountNumber
  → UnitOfWork COMMIT
~~~

Bất kỳ lỗi audit trong transaction này cũng có thể khiến request thất bại; “đọc số” có tác dụng ghi dấu vết, không hoàn toàn là SELECT đơn thuần.

**Tự kiểm tra:** (1) Vì sao listAccounts không trả số đầy đủ luôn? (2) map(toPaymentAccount) có làm số dư tăng không? (3) Nút sao chép gọi method nào để lấy số nếu chưa có?

## M05 — Lịch sử và chi tiết giao dịch

**Mở code:** [HistoryScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/history/screens/HistoryScreen.tsx), [TransactionDetailScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/history/screens/TransactionDetailScreen.tsx), [accountResponseValidators.ts](C:/Projects/banking-system/mobile-app/src/features/accounts/validation/accountResponseValidators.ts), [RelationalAccountReadService.listTransactions](C:/Projects/banking-system/backend/src/database/relationalAccountReadService.ts:131).

1. **Vai trò.** Cùng RelationalAccountReadService nhưng đọc account_transactions. Bỏ phần này thì xem số dư vẫn là một nghiệp vụ riêng, nhưng màn hình lịch sử/chi tiết mất dữ liệu.
2. **Vị trí.** HistoryScreen → accountsApi.listTransactions → Boundary.listTransactions → Service.listTransactions → Repository.listTransactions.
3. **Input.** customerId, accountId, cursor tùy chọn, limit mặc định 20. Chi tiết nhận thêm transactionId.
4. **Output.** Trang gồm items và nextCursor; chi tiết gồm dữ liệu transaction cùng reference, createdAt, completedAt. Cursor null nghĩa là không có trang tiếp theo theo kết quả này.
5. **Thuộc tính/state.** Service dùng unitOfWork như M04. HistoryScreen giữ account được chọn, items, cursor, bộ lọc, loading/error; TransactionDetailScreen giữ detail/lỗi/trạng thái tải.
6. **Constructor.** Không thêm class HistoryService tưởng tượng: constructor của service đã học ở M04.
7. **Method.** loadInitial tải account và trang đầu; loadMore tải bằng cursor rồi nối danh sách; loadDetail gọi getTransactionDetail. Backend dùng decodeCursor/encodeCursor, toTransaction/toTransactionDetail/toTransactionKind.
8. **Ai gọi ai.** getTransactionDetail ở API Mobile → getTransaction ở service → findOwnedAccount → findTransaction. Tên method ở hai phía không bắt buộc giống nhau.
9. **Ai tạo object.** React tạo/render màn hình; Boundary dùng cùng instance account service; repository tạo trong transaction.
10. **Phụ thuộc/dữ liệu.** AccountRepository, payment_accounts để kiểm tra quyền, account_transactions để đọc; validator kiểm tra shape response trước khi UI dùng.
11. **Code khó.** Đọc đoạn thật dưới. Cursor mang vị trí và scope account; không thể chỉ dùng một thời điểm nếu nhiều giao dịch cùng thời điểm.
12. **Ví dụ.** limit = 20, DB trả 21 hàng: API gửi 20, dùng hàng thứ 20 làm mốc trang sau. Lần loadMore nối kết quả mới; bộ lọc UI chỉ tác động dữ liệu đã tải, không chứng minh đã tìm hết lịch sử trong DB.

~~~typescript
const hasMore = rows.length > limit;
const items = rows.slice(0, limit);
const last = items.at(-1);
~~~

rows.length là số hàng đang có; slice tạo mảng lấy tối đa limit phần tử; at(-1) lấy phần tử cuối hoặc undefined. Service chỉ tạo nextCursor khi còn dữ liệu và last tồn tại.

Repository dùng thứ tự **occurred_at DESC, id DESC**; khi thời gian bằng nhau thì id phân định. toTransactionKind chỉ cho các kind thuộc public contract; giá trị nội bộ/không hợp lệ được bỏ khỏi output thay vì ép thành enum sai.

**Tự kiểm tra:** (1) Vì sao lấy limit + 1? (2) Có transactionId rồi có cần kiểm tra account thuộc customer không? (3) Lọc danh sách đã tải có phải tìm toàn bộ DB không?

## M06 — Quản lý người thụ hưởng

**Mở code:** [BeneficiariesScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/transfers/screens/BeneficiariesScreen.tsx), [transfersApi.ts](C:/Projects/banking-system/mobile-app/src/features/transfers/services/transfersApi.ts), [relationalBeneficiaryService.ts](C:/Projects/banking-system/backend/src/database/relationalBeneficiaryService.ts), [TransferRepository](C:/Projects/banking-system/backend/src/database/repositories/transferRepository.ts).

1. **Vai trò.** RelationalBeneficiaryService quản lý người nhận đã lưu của customer. Bỏ nó làm mất CRUD danh bạ người nhận; chuyển tiền bằng tra cứu số tài khoản là đường khác, không phải cứ có người nhận là đã chuyển tiền.
2. **Vị trí.** BeneficiariesScreen → transfersApi → Boundary → RelationalBeneficiaryService → TransferRepository.
3. **Input.** CustomerId; tạo mới có accountNumber/displayName; đổi tên có beneficiaryId/displayName; xóa có beneficiaryId.
4. **Output.** Danh sách hoặc beneficiary công khai; xóa qua HTTP trả 204.
5. **Thuộc tính/state.** Service giữ unitOfWork. Screen giữ danh sách, form tạo, người đang sửa tên, trạng thái gửi/lỗi; không tự nắm thông tin nội bộ của tài khoản người nhận.
6. **Constructor.** Boundary new RelationalBeneficiaryService(unitOfWork); TransferRepository nhận client.
7. **Method.** Service.list/get/create/rename/remove; UI.loadBeneficiaries/handleCreate/handleRename/handleDelete. API có listBeneficiaries/createBeneficiary/renameBeneficiary/deleteBeneficiary/lookupBeneficiary.
8. **Ai gọi ai.** create → AccountRepository.findByAccountNumber → CustomerRepository.findCustomerById → kiểm tra trùng → TransferRepository.createBeneficiary → audit. rename → updateBeneficiaryName; remove → deleteBeneficiary.
9. **Ai tạo object.** React render screen; service được Boundary tạo; service tạo các repository theo transaction.
10. **Phụ thuộc/dữ liệu.** beneficiaries và account/customer đích để tra cứu. TransferRepository gom phần người nhận, quote và transfer; tên file không có nghĩa mọi method đều chuyển tiền.
11. **Code khó.** deleteBeneficiary ở DB là xóa mềm: đổi trạng thái/đặt deleted_at. list/get loại bản ghi đã xóa. UI chỉ loại item sau API thành công; HTTP 204 không có JSON object beneficiary để đọc.
12. **Ví dụ.** Lưu tài khoản demo của Bình với tên “Bình học nhóm”; đổi thành “Bình”; sau đó xóa khỏi danh bạ. Những giao dịch đã xảy ra trước đó không bị xóa theo danh bạ.

**Đọc method theo công việc:** list chỉ lấy mục active của customer; get kiểm tra sở hữu; create kiểm tra account nhận có tồn tại; rename chỉ thay tên hiển thị; remove phân biệt mục thuộc mình đã xóa với ID không tìm thấy. publicBeneficiary chọn dữ liệu để trả API.

**Tự kiểm tra:** (1) Đổi tên người thụ hưởng có đổi chủ sở hữu account nhận không? (2) Xóa mềm khác DELETE hàng ra sao? (3) Tạo beneficiary có trừ số dư không?

## M07 — Chuyển tiền nội bộ: đọc sâu luồng chính

**Mở code:** [TransferScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/transfers/screens/TransferScreen.tsx), [transfersApi.ts](C:/Projects/banking-system/mobile-app/src/features/transfers/services/transfersApi.ts), [transferIntentStorage.ts](C:/Projects/banking-system/mobile-app/src/features/transfers/storage/transferIntentStorage.ts), [transferService.ts](C:/Projects/banking-system/backend/src/database/transferService.ts), [TransferRepository](C:/Projects/banking-system/backend/src/database/repositories/transferRepository.ts).

### 1. Vai trò và hậu quả nếu bỏ

**TransferScreen** điều phối các bước người dùng. **RelationalTransferService** kiểm tra nghiệp vụ và thực hiện chuyển tiền trong DB. **TransferRepository** lưu quote, transfer và idempotency. **transferIntentStorage** lưu dấu vết yêu cầu ở máy để phục hồi.

Bỏ screen: mất giao diện. Bỏ service: không có phần thực hiện nghiệp vụ qua Boundary. Bỏ lưu intent: server vẫn có cơ chế chống lặp, nhưng Mobile có thể không còn biết yêu cầu cũ khi mở lại. Bỏ idempotency/guard ở server: chặn bấm đôi trên UI không đủ để bảo vệ trước retry hoặc nhiều thiết bị.

### 2. Vị trí trong luồng

~~~text
TransferScreen
  → tra người nhận / lấy quote
  → lưu intent DRAFT_QUOTE
  → tạo challenge và nhập proof
  → lưu SUBMIT_UNKNOWN
  → transfersApi.submitTransfer
  → requestJson → http.ts (xác thực, kiểm tra proof)
  → RelationalHttpBoundary.submitTransfer
  → RelationalTransferService.submit
  → UnitOfWork + các repository → PostgreSQL COMMIT
  → toPublic → JSON → validator → receipt/state/UI
~~~

### 3. Input

Tạo quote cần **sourceAccountId**, **amount** dạng Money và **đúng một** trong beneficiaryId/lookupId. Người nhận lưu sẵn và kết quả lookup số tài khoản là hai cách tham chiếu khác nhau.

Submit phía Mobile gửi **quoteId**, **stepUp** gồm method/proof/challengeId và header **Idempotency-Key**. Service nhận TransferCommandInput chứa customerId, quoteId, idempotencyKey, requestFingerprint và các thông tin điều khiển/test tùy chọn. Không có nghĩa Mobile được tự chọn customerId của người khác.

### 4. Output

createQuote trả TransferQuote có quoteId, nguồn, người nhận, amount, fee, totalDebit, expiresAt. submit trả TransferRow nội bộ; toPublic chuyển thành TransferReceipt gồm transferId, reference, status, amount, fee, createdAt, updatedAt.

**Nhánh chuyển tiền nội bộ này ghi status SUCCEEDED ngay trong transaction**. UI vẫn hỗ trợ PENDING/FAILED/REVERSED vì phải hiểu contract/trạng thái có thể đọc lại; không suy rằng mọi submit đều chờ worker chuyển tiền.

### 5. Thuộc tính và state

| Nơi | Tên | Mục đích |
|---|---|---|
| Service | unitOfWork | Ranh giới transaction |
| Repository | client | Kết nối đang tham gia transaction |
| Screen | accounts, sourceAccountId | Nguồn tiền |
| Screen | beneficiaryId, recipientAccountNumber, recipientLookupId, beneficiary | Người nhận ở các bước |
| Screen | amountMinor, quote | Số nhập và báo giá server xác nhận |
| Screen | stepUpMethod, stepUpProof, transferChallenge | Xác thực bổ sung đang thực hiện |
| Screen | idempotencyKey | Danh tính yêu cầu, phải giữ khi thử lại cùng ý định |
| Screen | intentPhase, manualReviewCode, recoveryTransferId, receipt | Theo dõi và phục hồi kết quả |
| Screen | step | beneficiary / amount / review / stepUp / result |
| Screen | isSubmitting, error, clockMs, các cờ loading/restore | Trạng thái UI và kiểm tra hạn |
| Screen | submitLockRef | Chặn thực thi callback trùng ngay lúc bấm |

### 6. Constructor

Service: constructor(private readonly unitOfWork: UnitOfWork) {}. Repository: constructor(private readonly client: PoolClient) {}. TransferScreen không có constructor; React giữ hook state theo instance màn hình. Module storage giữ mutationQueue để tuần tự hóa các thay đổi lưu trữ.

### 7. Từng method/hàm chính

| Nơi | Method/hàm | Bên trong làm gì |
|---|---|---|
| Screen | loadAccounts, loadControlPolicy | Tải nguồn tiền và chính sách; cập nhật state hoặc lỗi |
| Screen | applyTransferChallenge | Đưa challenge và phương thức phù hợp vào state |
| Screen | restoreTransferIntent | Đọc intent; nếu biết transferId thì GET trạng thái; nếu chưa rõ kết quả thì giữ thông tin phục hồi |
| Screen | handleLookupBeneficiary | Tra số tài khoản hoặc đọc beneficiary đã lưu; chỉ đi tiếp khi hợp lệ |
| Screen | handleCreateQuote | Kiểm tra input, gọi quoteTransfer, đặt quote và bước review |
| Screen | handleContinueToStepUp | Lưu draft/key, tạo challenge, chuyển bước xác thực |
| Screen | handleSubmitTransfer | Kiểm tra guard/proof/hạn; lưu unknown; gửi lệnh; lưu receipt; phân loại lỗi |
| Screen | handleBiometricStepUp | Xin xác thực/khẳng định gắn thiết bị theo capability; không thay thế mọi kiểm tra Backend |
| Screen | handleRenewTransferChallenge | Tạo challenge mới khi có thể tiếp tục |
| Screen | handleRefreshTransferStatus | GET kết quả đã biết ID |
| Screen | handleBack, handleGoHome | Điều hướng có cân nhắc trạng thái intent |
| API | lookupInternalRecipient, lookupBeneficiary | Lấy tham chiếu người nhận hợp lệ |
| API | quoteTransfer, submitTransfer, getTransfer | Tạo quote, gửi command, đọc receipt |
| Service | createQuote | Kiểm tra nguồn/đích/policy/tiền; phí demo 1_000n; lưu quote có hạn |
| Service | submit | Toàn bộ transaction tiền, đọc kỹ ở mục 11 |
| Service | get | Kiểm tra transfer thuộc customer rồi đọc |
| Service | getStepUpRequestFingerprint | Lấy fingerprint gắn quote để bước xác thực ràng buộc đúng yêu cầu |
| Service | toPublic | Chọn field và bọc tiền thành Money |
| TransferRepository | createQuote, findQuoteForUpdate, consumeQuote | Ghi, khóa đọc và đánh dấu quote đã dùng |
| TransferRepository | reserveCommandIdempotency, completeCommandIdempotency | Giữ/chốt danh tính command |
| TransferRepository | createTransfer, findById, findByIdempotency | Lưu/đọc giao dịch canonical |
| Storage | saveTransferIntent, loadTransferIntent, clearTransferIntent | Ghi/đọc/xóa intent với kiểm tra cấu trúc và scope user |

### 8. Method nào gọi method nào?

submit → reserveCommandIdempotency → findQuoteForUpdate → ControlPolicyRepository.assertTransferAllowed → AccountRepository.lockManyByIds → createTransfer → consumeQuote → updateBalances hai tài khoản → appendTransaction hai phía → LedgerRepository.appendJournal/appendEntries → AuditRepository.append → INSERT notifications → OutboxRepository.append → completeCommandIdempotency.

Các bước trên nằm trong callback transaction. Một số nhánh **return sớm** khi đã có kết quả canonical, nên không thực hiện lại toàn bộ chuỗi.

### 9. Ai tạo object?

Boundary tạo RelationalTransferService một lần khi ghép dependency. Mỗi submit tạo AccountRepository, TransferRepository, LedgerRepository, AuditRepository, OutboxRepository với **cùng client**. Tạo repository không tạo transaction mới.

### 10. Phụ thuộc và bảng dữ liệu

payment_accounts, beneficiaries/recipient_lookups, transfer_quotes, transfers, command_idempotency, account_transactions, ledger, audit_events, notifications, outbox_events. Các bảng phục vụ mục đích khác nhau: số dư hiện tại, lịch sử hiển thị, ghi sổ, truy vết và công việc nền.

Step-up được xử lý ở đường HTTP trước khi vào nghiệp vụ relational. Service.submit không trực tiếp gọi camera/vân tay hay gửi OTP.

### 11. Bóc những đoạn khó

**A. Lưu trước khi gửi — trích TransferScreen:**

~~~typescript
await saveTransferIntent({
  phase: "SUBMIT_UNKNOWN",
  submitAttempted: true,
  userId,
  idempotencyKey,
  quote,
  createdAt: Date.now(),
});
setIntentPhase("SUBMIT_UNKNOWN");
requestStarted = true;
~~~

await đảm bảo thao tác ghi hoàn tất trước khi gửi. Nếu lưu thất bại, code chưa nên vượt qua bước này để gửi command. SUBMIT_UNKNOWN không phải trạng thái tiền của server; nó là mức độ biết kết quả của Mobile. requestStarted giúp catch phân biệt lỗi xảy ra trước hay sau khi bắt đầu request.

**B. Giữ một client — trích Service.submit:**

~~~typescript
const accounts = new AccountRepository(client);
const transfers = new TransferRepository(client);
const ledger = new LedgerRepository(client);
const audit = new AuditRepository(client);
const outbox = new OutboxRepository(client);
~~~

Năm object phụ trách năm nhóm SQL, nhưng đều tham gia transaction đang mở. Đừng thấy năm lần new rồi nghĩ có năm database.

**C. Tiền — trích Service.submit:**

~~~typescript
const amount = BigInt(quote.amountMinor);
const fee = BigInt(quote.feeMinor);
const totalDebit = amount + fee;
~~~

Dùng **quote đã lưu**, không dùng một số tiền mới tự ý thay trong submit body. Người gửi giảm amount + fee; người nhận tăng amount. heldMinor được giữ theo logic cập nhật của nhánh này; transfer được tạo với heldMinor = "0".

**D. Khóa và đọc lại.** lockManyByIds dùng ORDER BY id FOR UPDATE. Sau khi khóa, service kiểm tra đủ hai account, sở hữu nguồn, chủ đích, trạng thái ACTIVE và available balance. Quote trước đó chỉ là preview; tiền/chính sách có thể đã thay đổi.

**E. Replay.** Nếu reservation cũ có fingerprint khác, ném IdempotencyConflictError. Nếu cùng fingerprint và đã có aggregateId hợp lệ, trả transfer cũ. Nếu quote đã có consumedTransferId, lấy canonical thay vì trừ tiền lần nữa. Không tạo key mới chỉ vì timeout.

**F. Hoàn tất.** completeCommandIdempotency gắn command với transfer. Return trong callback chưa gửi HTTP ngay; UnitOfWork phải COMMIT. Lỗi sau commit nhưng trước Mobile nhận response tạo tình huống “đã làm nhưng chưa biết”, là lý do cần cả receipt GET lẫn intent/key bền vững.

### 12. Ví dụ chạy với số nhỏ

Giả sử A có available/current 500.000, B có 20.000, cùng ACTIVE và đủ điều kiện; chuyển 100.000, phí quote 1.000:

| Dữ liệu | Trước | Sau transaction thành công |
|---|---:|---:|
| A available/current | 500.000 | 399.000 |
| B available/current | 20.000 | 120.000 |
| Phí trong ledger | Chưa có bút toán cho transfer này | 1.000 |
| Transfer | Chưa có | SUCCEEDED |
| Quote | Chưa tiêu thụ | Gắn transfer vừa tạo |

Nếu một bước ghi trong transaction lỗi thì rollback, không giữ riêng phần trừ A. Nếu commit thành công nhưng mất mạng, không kết luận FAILED chỉ từ timeout: giữ intent và dùng đường đọc lại/thử lại theo policy với cùng danh tính yêu cầu.

**Tự kiểm tra:** (1) Tại sao saveTransferIntent chạy trước submitTransfer? (2) Phí lấy ở Mobile hay quote server? (3) Ai COMMIT? (4) Cùng key nhưng đổi nội dung phải được xử lý thế nào? (5) SUCCEEDED trong DB có bảo đảm Mobile đã nhận response không?

## M08 — QR nhận tiền và quét nội dung QR

**Mở code:** [QrScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/qr/screens/QrScreen.tsx), [qrPayload.ts](C:/Projects/banking-system/mobile-app/src/features/qr/validation/qrPayload.ts).

1. **Vai trò.** QrScreen lấy thông tin account, tạo nội dung QR nhận tiền và đọc payload quét được. Parser bảo vệ UI trước dữ liệu không đúng cấu trúc. Bỏ parser rồi JSON.parse thẳng sẽ không có đủ kiểm tra nội dung.
2. **Vị trí.** Account API → createReceiveQrPayload → UI QR; camera/text → parseReceiveQrPayload → kết quả kiểm tra → UI.
3. **Input.** Tạo QR dùng thông tin tài khoản; parse dùng chuỗi từ camera hoặc ô nhập. Camera không phải nguồn dữ liệu đáng tin tự động.
4. **Output.** createReceiveQrPayload trả chuỗi JSON; parseReceiveQrPayload trả object UnverifiedReceiveQrData với mức tin cậy UNVERIFIED. Hợp lệ cấu trúc không chứng minh người nhận đã được server xác thực.
5. **State.** Account, payload, kết quả quét, quyền camera, loading/error; không có số dư tự tính để ghi vào Backend.
6. **Constructor.** Cả screen và parser là hàm. Module parser không giữ kết nối DB.
7. **Hàm.** loadAccount đọc listAccounts/getAccountNumber; createReceiveQrPayload tạo payload; handleParsePayload gọi parser; handleBarcodeScanned xử lý camera; handleEnableCamera xin quyền; resetScanner cho quét lại.
8. **Ai gọi ai.** QrScreen → accountsApi khi tải thông tin; phần parse chạy cục bộ → validator. Không có lệnh submitTransfer trong thao tác chỉ quét này.
9. **Ai tạo object.** React render screen; các hàm tạo object payload/result mới.
10. **Phụ thuộc.** Camera, account API, quy tắc QR cục bộ. Không có bảng qr_codes bắt buộc cho luồng đang mô tả.
11. **Code khó.** JSON.parse chỉ biến chuỗi thành giá trị JavaScript. Parser còn kiểm tra độ dài, version/kind, currency và field cho phép; trường hợp sai bị từ chối. Không gắn tên chuẩn QR bên ngoài khi code chỉ định nghĩa schema riêng.
12. **Ví dụ.** Quét JSON có số tài khoản demo hợp lệ: UI có thể hiển thị nội dung đã kiểm tra. Số dư A/B vẫn không đổi; muốn chuyển tiền phải đi qua nghiệp vụ chuyển tiền riêng.

**Tự kiểm tra:** (1) UNVERIFIED nghĩa là gì? (2) JSON hợp lệ đã đủ để chuyển tiền chưa? (3) Vì sao parser cần giới hạn kích thước?

## M09 — Danh sách, đọc và mở thông báo

**Mở code:** [NotificationsScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/notifications/screens/NotificationsScreen.tsx), [NotificationDetailScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/notifications/screens/NotificationDetailScreen.tsx), [notificationsApi.ts](C:/Projects/banking-system/mobile-app/src/features/notifications/services/notificationsApi.ts), [remainingService.ts](C:/Projects/banking-system/backend/src/database/remainingService.ts).

1. **Vai trò.** RelationalRemainingService.listNotifications/markNotificationRead phục vụ hộp thông báo. Bỏ các method này làm mất đọc/đánh dấu ở server; không được coi state cục bộ là DB đã lưu.
2. **Vị trí.** Screen → notificationsApi → Boundary → RelationalRemainingService → client.query.
3. **Input.** customerId; khi đánh dấu thêm notificationId.
4. **Output.** Danh sách notifications hoặc notification vừa cập nhật; route UI được chọn theo loại/resource của thông báo.
5. **Thuộc tính/state.** Service giữ unitOfWork; màn hình giữ danh sách hoặc mục chi tiết, loading/error. Không có NotificationRepository riêng trong đường này.
6. **Constructor.** Boundary tạo RelationalRemainingService(UnitOfWork). Screen là React function.
7. **Method/hàm.** loadNotifications tải list; handleOpen đánh dấu nếu chưa đọc rồi điều hướng. loadNotification ở detail tải danh sách, tìm đúng ID và đánh dấu khi cần; getNotificationRoute chọn màn hình đích.
8. **Ai gọi ai.** listNotifications API → service.listNotifications; markNotificationRead API → service.markNotificationRead → UPDATE notifications có điều kiện customer.
9. **Ai tạo object.** Service do Boundary tạo; callback transaction nhận client; mapper tạo object public.
10. **Phụ thuộc/dữ liệu.** notifications; auth và router. Dòng notification có thể được tạo cùng transaction chuyển tiền/tiết kiệm/tín dụng/KYC.
11. **Code khó.** Tìm chi tiết bằng danh sách rồi find không tương đương có API GET /notifications/:id. Trong code hiện tại, cần đọc điều screen thực sự gọi. UPDATE gắn customerId ngăn tự đánh dấu thông báo của người khác.
12. **Ví dụ.** Chuyển tiền xong tạo thông báo chưa đọc. Bấm vào: API đánh dấu; thành công thì state đổi và mở nội dung liên quan. API lỗi thì UI báo lỗi, không giả vờ đã lưu thành công.

**Tự kiểm tra:** (1) Dòng notification và push notification có phải một việc không? (2) Detail đang lấy dữ liệu qua API nào? (3) Vì sao UPDATE phải lọc customer?

## M10 — Báo cáo giao dịch nghi gian lận

**Mở code:** [FraudReportScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/fraud/screens/FraudReportScreen.tsx), [fraudReportsApi.ts](C:/Projects/banking-system/mobile-app/src/features/fraud/services/fraudReportsApi.ts), [fraudReportIntentStorage.ts](C:/Projects/banking-system/mobile-app/src/features/fraud/storage/fraudReportIntentStorage.ts), [remainingService.ts](C:/Projects/banking-system/backend/src/database/remainingService.ts:106).

1. **Vai trò.** Gửi và đọc lại một báo cáo; không tự hoàn tiền. Bỏ storage thì phục hồi ý định gửi khó hơn; bỏ service thì không lưu được báo cáo lên hệ thống.
2. **Vị trí.** TransactionDetailScreen → FraudReportScreen → submitFraudReport → Boundary.reportFraud → RelationalRemainingService.reportFraud.
3. **Input.** accountId, transactionId, reason, Idempotency-Key; customerId xác định từ auth.
4. **Output.** FraudReportResponse chứa định danh/trạng thái báo cáo; getFraudReport đọc lại báo cáo của customer.
5. **State.** Nội dung lý do, kết quả báo cáo, loading/error và intent phục hồi. Service dùng unitOfWork như M09.
6. **Constructor.** Không tạo một FraudService mới: service là RelationalRemainingService được dùng chung. Storage là module hàm.
7. **Method/hàm.** handleSubmit kiểm tra reason, ghi intent rồi submit; effect phục hồi đọc intent và nếu đã có ID thì gọi getFraudReport. Backend.reportFraud kiểm tra ownership/idempotency/trùng báo cáo trước khi INSERT; getFraudReport đọc có scope.
8. **Ai gọi ai.** submitFraudReport → requestJson POST /fraud-reports; getFraudReport → GET /fraud-reports/:id; service dùng query trên transaction liên kết account.
9. **Ai tạo object.** React render screen; Boundary giữ service; intent/result là object dữ liệu, không phải class có hành vi tự chạy.
10. **Phụ thuộc/dữ liệu.** fraud_reports, dữ liệu idempotency, account_transactions/payment_accounts, audit và outbox; Admin đọc/xử lý ở A05.
11. **Code khó.** Fingerprint giúp phân biệt gửi lại cùng lý do/giao dịch với dùng lại key cho nội dung khác. Một request thất bại ở mạng có thể đã được server nhận; giữ intent để không tạo báo cáo mới mù quáng.
12. **Ví dụ.** Báo cáo transaction T thuộc account A với lý do hợp lệ. Server trả RECEIVED. Điều này chỉ chứng minh đã tiếp nhận báo cáo; số dư chưa tự tăng và transfer chưa tự thành REVERSED.

**Tự kiểm tra:** (1) RECEIVED có đồng nghĩa được hoàn tiền không? (2) Vì sao phải xác minh transaction thuộc account của customer? (3) Mất response thì cần giữ dữ liệu nào để phục hồi?

## M11 — Mở khoản tiết kiệm

**Mở code:** [OpenSavingsScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/savings/screens/OpenSavingsScreen.tsx), [savingsApi.ts](C:/Projects/banking-system/mobile-app/src/features/savings/services/savingsApi.ts), [savingsIntentStorage.ts](C:/Projects/banking-system/mobile-app/src/features/savings/storage/savingsIntentStorage.ts), [savingsService.ts](C:/Projects/banking-system/backend/src/database/savingsService.ts), [SavingsRepository](C:/Projects/banking-system/backend/src/database/repositories/savingsRepository.ts).

1. **Vai trò.** RelationalSavingsService biến yêu cầu gửi tiết kiệm thành opening và deposit; OpenSavingsScreen đưa người dùng qua input/review/stepUp/result. Bỏ service sẽ mất việc đồng bộ trừ tài khoản nguồn và tạo khoản gửi.
2. **Vị trí.** Screen → quoteSavings/submitSavingsOpening → HTTP/Boundary → createQuote/submitOpening → UnitOfWork.
3. **Input.** Quote: sourceAccountId, productId, principal dạng Money, maturityInstruction. Submit: quoteId, stepUp, Idempotency-Key; customerId xác định từ phiên.
4. **Output.** SavingsQuote có kỳ hạn/lãi dự kiến/ngày đáo hạn; SavingsOpening có openingId và depositId khi thành công. **Opening** là kết quả lệnh mở; **deposit** là khoản gửi tồn tại sau lệnh.
5. **Thuộc tính/state.** Service giữ unitOfWork. Screen giữ accounts/product đã chọn, nguồn tiền, số gốc, chỉ thị đáo hạn, quote, opening, challenge/proof, key/intentPhase, step, lỗi và submitLockRef.
6. **Constructor.** Boundary tạo service; SavingsRepository nhận client; screen/storage không phải class.
7. **Method/hàm.** Bảng dưới. Các hàm *ToPublic chuyển row sang model API, không tự tính tiền trên Mobile.
8. **Ai gọi ai.** createQuote → ControlPolicyRepository → SavingsRepository.findActiveProduct → AccountRepository.findOwnedAccount → buildSavingsQuote → createQuote repository. submitOpening → reserveIdempotency → lockQuote → lockById nguồn → createOpening/consumeQuote/updateBalances/createDeposit → lịch sử/ledger/audit/notification/outbox → completeIdempotency.
9. **Ai tạo object.** Service được Boundary tạo; repository tạo trong callback; React giữ vòng đời OpenSavingsScreen.
10. **Phụ thuộc/dữ liệu.** savings_products, savings_quotes, savings_openings, savings_deposits, dữ liệu idempotency tiết kiệm, payment_accounts và các bảng ghi sổ/dấu vết.
11. **Code khó.** Đọc đoạn trích bên dưới: principal là bigint; tiền nguồn giảm đúng principal, held không tự tăng theo phép cập nhật này. createDeposit lấy lãi/kỳ hạn/điều khoản từ quote đã lưu, không tin một bộ lãi mới gửi kèm submit.
12. **Ví dụ.** Có 5 triệu khả dụng, chọn gửi 1 triệu theo sản phẩm hợp lệ: quote chỉ preview. Sau xác thực và submit thành công, nguồn giảm 1 triệu, có opening SUCCEEDED và deposit tương ứng. Nhập số rồi quay lại trước submit chưa làm giảm tiền.

| Nơi | Method/hàm | Công việc |
|---|---|---|
| Screen | loadInitialData | Promise.all lấy accounts, products và policy |
| Screen | restoreIntent | Đọc intent; biết openingId thì lấy lại kết quả |
| Screen | handleQuote | Kiểm tra form và lấy quote |
| Screen | handleConfirmReview | Lưu DRAFT_QUOTE, tạo challenge SAVINGS_OPENING |
| Screen | handleEditInput | Quay sửa khi trạng thái cho phép |
| Screen | handleSubmit | Lưu SUBMIT_UNKNOWN trước request; lưu kết quả/phân loại lỗi |
| Screen | handleBiometric, handleRenewSavingsChallenge | Các nhánh xác thực/phục hồi challenge |
| Screen | handleRefreshOpening, handleBack, handleOpenSavingsList | Đọc lại và điều hướng an toàn theo intent |
| Service | listProducts, createQuote | Danh mục ACTIVE và quote |
| Service | getQuoteStepUpRequestFingerprint | Binding cho challenge của quote |
| Service | submitOpening, getOpening | Thực hiện lệnh và đọc canonical result |
| Mapper | productToPublic, quoteToPublic, openingToPublic, depositToPublic | Chuyển row sang dữ liệu public |

~~~typescript
const updatedAccount = await accounts.updateBalances(source.id, {
  availableMinor: (BigInt(source.availableMinor) - principal).toString(),
  currentMinor: (BigInt(source.currentMinor) - principal).toString(),
  heldMinor: source.heldMinor,
  expectedVersion: source.version,
});
~~~

expectedVersion là phiên bản đã đọc, để phát hiện cập nhật không còn phù hợp. toString trả số về dạng lưu/trao đổi thống nhất.

**Tự kiểm tra:** (1) openingId và depositId dùng cho hai việc nào? (2) Quote có trừ tiền không? (3) Khi mất phản hồi submit, tại sao cần giữ key?

## M12 — Xem tiết kiệm và xử lý đáo hạn

**Mở code:** [SavingsListScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/savings/screens/SavingsListScreen.tsx), [SavingsDetailScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/savings/screens/SavingsDetailScreen.tsx), [savingsService.ts](C:/Projects/banking-system/backend/src/database/savingsService.ts:321), [lifecycleService.ts](C:/Projects/banking-system/backend/src/database/lifecycleService.ts).

1. **Vai trò.** RelationalSavingsService.listDeposits/getDeposit phục vụ xem. RelationalLifecycleService thực hiện việc đến hạn ở Backend. Bỏ màn hình không làm thời gian đáo hạn ngừng trôi; bỏ worker/scheduler đang chịu trách nhiệm chạy lifecycle thì không nên kỳ vọng việc tự động diễn ra.
2. **Vị trí.** UI → savingsApi → service đọc. Đường nền riêng: RelationalLifecycleScheduler → runSavingsMaturities → matureSavingsDeposit.
3. **Input.** Xem: customerId và depositId. Lifecycle: asOf/thời điểm xử lý, giới hạn batch hoặc depositId cụ thể.
4. **Output.** Danh sách/chi tiết deposit; tổng principal của khoản ACTIVE trong list. Lifecycle trả kết quả/số lượng xử lý, không trực tiếp setState Mobile.
5. **Thuộc tính/state.** Hai service giữ UnitOfWork; List giữ deposits/bộ lọc/loading/error; Detail giữ deposit được chọn. Scheduler giữ timer/inFlight/health riêng.
6. **Constructor.** Boundary tạo SavingsService; Scheduler tạo RelationalLifecycleService(UnitOfWork). Đây là hai đường gọi khác nhau.
7. **Method.** loadDeposits → listSavingsDeposits → listDeposits; loadDeposit → getSavingsDeposit → getDeposit. Lifecycle có runSavingsMaturities, matureSavingsDeposit, runSavingsSuspense và resolveSavingsSuspense.
8. **Ai gọi ai.** listDeposits → SavingsRepository.listDeposits → depositToPublic và cộng principal ACTIVE. Đáo hạn khóa khoản gửi và dùng maturity operation để tránh xử lý lặp; nhánh trả/tái tục phụ thuộc maturityInstruction.
9. **Ai tạo object.** React render màn hình; Service tạo repository mỗi transaction; WorkerRuntime có thể tạo Scheduler theo config.
10. **Phụ thuộc/dữ liệu.** savings_deposits, savings_maturity_operations, payment_accounts, ledger/dấu vết và savings_maturity_suspense khi chưa thể hoàn tất đường nhận tiền.
11. **Code khó.** Ba lựa chọn thực tế là RETURN_PRINCIPAL_AND_INTEREST, RENEW_PRINCIPAL, RENEW_PRINCIPAL_AND_INTEREST. Đây là dữ liệu điều khiển nhánh nghiệp vụ, không phải ba class Strategy độc lập. Suspense lưu tình huống cần xử lý tiếp, không được tự coi là thành công trả tiền.
12. **Ví dụ.** Chọn RETURN_PRINCIPAL_AND_INTEREST: đến hạn, Backend kiểm tra rồi thực hiện trả theo nghiệp vụ. Nếu tài khoản nhận không dùng được, có đường suspense; màn hình lấy trạng thái từ server. Không có thao tác rút trước hạn trong nhóm screen này để tự suy thêm.

**Tự kiểm tra:** (1) Mở màn hình detail có tự đáo hạn khoản gửi không? (2) Tái tục gốc khác tái tục gốc+lãi thế nào? (3) Vì sao chạy scheduler hai lần cần guard ở DB?

## M13 — Đăng ký tín dụng và kích hoạt

**Mở code:** [CreditApplicationScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/credit/screens/CreditApplicationScreen.tsx), [creditApi.ts](C:/Projects/banking-system/mobile-app/src/features/credit/services/creditApi.ts), [creditService.ts](C:/Projects/banking-system/backend/src/database/creditService.ts:219), [CreditRepository](C:/Projects/banking-system/backend/src/database/repositories/creditRepository.ts).

1. **Vai trò.** RelationalCreditService tạo hồ sơ xin tín dụng và, sau khi đủ điều kiện, tạo tài khoản tín dụng/thẻ. Bỏ submitApplication làm mất nộp hồ sơ; bỏ activateApplication làm hồ sơ đã duyệt chưa tạo được sản phẩm dùng tiếp.
2. **Vị trí.** Screen → submitCreditApplication/activateCreditApplication → HTTP/Boundary → submitApplication/activateApplication → CreditRepository.
3. **Input.** requestedLimit dạng Money khi nộp; applicationId khi kích hoạt; hai lệnh có stepUp và idempotency key riêng theo request.
4. **Output.** CreditApplication; sau kích hoạt có liên kết credit account và trạng thái ACTIVE. Chấp nhận request nộp không đồng nghĩa được cấp hạn mức ngay.
5. **Thuộc tính/state.** Service giữ UnitOfWork; screen giữ application, requestedLimit, otp, challengeId, mode (idle/verify-application/verify-activation), isSubmitting/error.
6. **Constructor.** Boundary tạo service; CreditRepository nhận PoolClient. Không có constructor cho CreditApplicationScreen.
7. **Method/hàm.** load đọc hồ sơ; requestApplicationOtp tạo challenge theo nội dung hạn mức; requestActivationOtp tạo challenge cho application; verify chọn nhánh submit/activate theo mode; handleBack điều hướng. Service có listApplications/getApplication/getApplicationRequestFingerprint/submitApplication/activateApplication.
8. **Ai gọi ai.** activateApplication → reserveIdempotency → lockApplication → kiểm tra customer/status → createCreditAccount → createCard → repository.activateApplication → audit/outbox → completeIdempotency.
9. **Ai tạo object.** Boundary tạo service, service tạo repository. Các hàng account/card được INSERT bởi method, không sinh ra chỉ vì new CreditRepository.
10. **Phụ thuộc/dữ liệu.** credit_applications, credit_accounts, credit_cards, credit_idempotency; ControlPolicyRepository; MFA ở HTTP; duyệt Admin ở A04.
11. **Code khó.** Chỉ PENDING_ACTIVATION mới đi đường tạo mới; ACTIVE có account thì trả kết quả canonical. Biểu thức approved_limit_minor ?? requested_limit_minor dùng vế phải chỉ khi vế trái null/undefined; không phải tự cấp hạn mức tùy ý bỏ qua trạng thái duyệt.
12. **Ví dụ.** Xin hạn mức 20 triệu → Admin đề xuất/duyệt hạn mức hợp lệ → application PENDING_ACTIVATION → Mobile xác thực kích hoạt → account/card được tạo trong transaction → application ACTIVE.

**Không gộp trạng thái:** “hồ sơ được gửi”, “hồ sơ được duyệt” và “thẻ/tài khoản được tạo” là ba mốc khác nhau. UI đọc lại hồ sơ sau một số lỗi để biết server đang ở mốc nào; đây không phải bằng chứng toàn bộ màn hình có cùng durable intent như TransferScreen.

**Tự kiểm tra:** (1) createCard chạy ở nộp hồ sơ hay kích hoạt? (2) Ai quyết định approved limit? (3) Tại sao activate cần lockApplication?

## M14 — Danh sách thẻ, khóa, mở khóa và báo mất

**Mở code:** [CardsScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/cards/screens/CardsScreen.tsx), [CardDetailScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/cards/screens/CardDetailScreen.tsx), [creditApi.ts](C:/Projects/banking-system/mobile-app/src/features/credit/services/creditApi.ts), [creditService.ts](C:/Projects/banking-system/backend/src/database/creditService.ts:485).

1. **Vai trò.** Quản lý trạng thái thẻ, không phải sửa trực tiếp số dư account. Bỏ các method thẻ trong RelationalCreditService làm mất dữ liệu/điều khiển thẻ dù payment account vẫn tồn tại.
2. **Vị trí.** CardsScreen/CardDetailScreen → creditApi → HTTP/Boundary → RelationalCreditService → CreditRepository.
3. **Input.** cardId, customerId; unlock/report-lost có dữ liệu stepUp tại HTTP. Khóa hiện tại đi đường đơn giản hơn mở khóa.
4. **Output.** Danh sách thẻ; detail gồm card, creditAccount, latestStatement; đổi trạng thái trả card; báo mất trả kết quả có card/case.
5. **Thuộc tính/state.** Service giữ UnitOfWork; CardsScreen giữ cards và application còn chờ để hiển thị; CardDetailScreen giữ detail, challenge/proof, trạng thái thao tác/lỗi.
6. **Constructor.** Service và repository như M13; React render screen.
7. **Method.** loadCards lấy listCreditCards và listCreditApplications; loadCard gọi getCreditCard. handleToggleLock chọn lockCreditCard/unlockCreditCard; handleReportLost gọi reportCreditCardLost sau challenge. Backend dùng listCards/getCard/setCardStatus/reportCardLost.
8. **Ai gọi ai.** setCardStatus → lockCard → kiểm tra trạng thái/policy → updateCardStatus → audit/outbox. reportCardLost khóa thẻ, kiểm tra case cũ rồi xử lý BLOCKED/case/notification.
9. **Ai tạo object.** Boundary giữ service; service tạo CreditRepository và các repository ghi dấu vết trong transaction.
10. **Phụ thuộc/dữ liệu.** credit_cards, credit_accounts, credit_statements, card_security_cases; chính sách và MFA theo thao tác.
11. **Code khó.** ACTIVE/LOCKED phục vụ khóa tạm/mở lại; báo mất dùng BLOCKED và case riêng. Không đổi BLOCKED thành ACTIVE chỉ vì button thường “mở khóa” tồn tại. Các guard ở server mới quyết định.
12. **Ví dụ.** Khóa tạm khi chưa cần dùng → card LOCKED. Mở lại cần xác thực bổ sung. Báo mất là tình huống khác, server ghi case; UI phải hiển thị kết quả đó thay vì giả vờ chỉ toggle một boolean.

**Tự kiểm tra:** (1) LOCKED và BLOCKED có thể dùng thay nhau không? (2) Vì sao unlock có step-up? (3) Thẻ bị khóa có đồng nghĩa khoản nợ biến mất không?

## M15 — Tài khoản tín dụng, giao dịch và sao kê

**Mở code:** [CreditTransactionsScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/credit/screens/CreditTransactionsScreen.tsx), [CreditStatementsScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/credit/screens/CreditStatementsScreen.tsx), [CreditStatementDetailScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/credit/screens/CreditStatementDetailScreen.tsx), [creditService.ts](C:/Projects/banking-system/backend/src/database/creditService.ts:307).

1. **Vai trò.** Phần đọc của RelationalCreditService cung cấp tài khoản tín dụng và sao kê. Bỏ phần này làm người dùng không xem được nghĩa vụ thanh toán, dù dữ liệu có thể vẫn tồn tại trong DB.
2. **Vị trí.** Screen → getCreditCard để biết creditAccountId → listCreditTransactions/listCreditStatements/getCreditStatement → Service → Repository.
3. **Input.** customerId, creditAccountId, cursor/limit cho danh sách; statementId cho detail. cardId và creditAccountId là hai định danh khác nhau.
4. **Output.** CreditAccount hoặc mảng; trang giao dịch/sao kê với nextCursor; CreditStatement gồm thông tin sao kê và các dữ liệu cần hiển thị được tổng hợp.
5. **Thuộc tính/state.** Service giữ UnitOfWork; screen giữ dữ liệu tải về, loading/error. Không coi sao kê là một mảng giao dịch thanh toán thông thường.
6. **Constructor.** Dùng service/repository ở M13; không tạo một StatementController không tồn tại.
7. **Method.** Service.listAccounts/getAccount/listTransactions/listStatements/getStatement; private statement đọc items/payments để dựng CreditStatement. API tương ứng có tiền tố Credit để phân biệt tài khoản thanh toán.
8. **Ai gọi ai.** getStatement → CreditRepository.findStatement → statement → listStatementItems và listPaymentsForStatement → mapper. listTransactions kiểm tra quyền account rồi phân trang dữ liệu credit.
9. **Ai tạo object.** React render màn hình; Service tạo CreditRepository trong transaction; mapper trả object public.
10. **Phụ thuộc/dữ liệu.** credit_accounts, credit_transactions, credit_statements, credit_statement_items, credit_payments.
11. **Code khó.** accountPublic/transactionPublic và statement mapping chọn/biến đổi dữ liệu; không trả nguyên SQL row. API có cursor nhưng hai screen danh sách hiện gọi limit 100 và không có vòng loadMore dùng nextCursor như HistoryScreen; không khẳng định UI đã duyệt hết mọi trang.
12. **Ví dụ.** Từ thẻ X, lấy creditAccountId C rồi sao kê S của C. Bấm S tải chi tiết đúng cặp C/S; không dùng cardId thay statementId dù cả hai là chuỗi.

**Tự kiểm tra:** (1) cardId khác creditAccountId ra sao? (2) 100 mục trên UI có chứng minh DB chỉ có 100 không? (3) Vì sao chi tiết sao kê cần các payment đã ghi nhận?

## M16 — Thanh toán dư nợ tín dụng

**Mở code:** [CreditPaymentScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/credit/screens/CreditPaymentScreen.tsx), [CreditPaymentResultScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/credit/screens/CreditPaymentResultScreen.tsx), [cardPaymentIntentStorage.ts](C:/Projects/banking-system/mobile-app/src/features/credit/storage/cardPaymentIntentStorage.ts), [creditService.ts](C:/Projects/banking-system/backend/src/database/creditService.ts:348).

1. **Vai trò.** createPaymentQuote/submitPayment phối hợp trừ payment account và giảm nợ credit account/sao kê. Bỏ service làm mất tính thống nhất của hai phía; UI không tự trừ tiền để thay thế.
2. **Vị trí.** Screen → quoteCreditPayment → review → challenge CREDIT_PAYMENT → submitCreditPayment → HTTP/Boundary → submitPayment → transaction.
3. **Input.** sourceAccountId, creditAccountId, statementId, paymentOption (MINIMUM/FULL_STATEMENT/CUSTOM), amount theo lựa chọn. Submit gửi quoteId/stepUp/key.
4. **Output.** CreditPaymentQuote; CreditPayment có paymentId/trạng thái để màn hình kết quả đọc lại bằng getCreditPayment.
5. **State.** Dữ liệu nguồn/thẻ/sao kê, phương án tiền, quote, challenge/proof, key, intent phục hồi, step/loading/error/submit guard. Service chỉ giữ UnitOfWork, không giữ số dư trong field.
6. **Constructor.** Service/Repository giống M13; storage là module; hai screen là component.
7. **Method/hàm.** Screen.loadData/restoreIntent/handleQuote/handleContinueToStepUp/handleSubmit; handleEditQuote/handleRenewPaymentChallenge/handleRefreshPayment/handleBack/handlePaymentDone điều khiển tiếp tục và kết quả. Service.createPaymentQuote/getPaymentStepUpRequestFingerprint/submitPayment/getPayment.
8. **Ai gọi ai.** submitPayment → reserveIdempotency → lockPaymentQuote → AccountRepository.lockById → lockCreditAccount/lockStatement → kiểm tra version/sao kê mới nhất → consumePaymentQuote → updateBalances/updateCreditAccount → createPayment/updateStatementPayment/createTransaction → ledger/audit/notification/outbox → completeIdempotency.
9. **Ai tạo object.** Boundary tạo service; trong một transaction, nhiều repository dùng cùng client. ResultScreen gọi GET dựa trên paymentId, không thực hiện thanh toán lần nữa.
10. **Phụ thuộc/dữ liệu.** payment_accounts, credit_accounts, credit_statements, credit_payment_quotes, credit_payments, credit_transactions, account_transactions, credit_idempotency và ghi sổ/dấu vết.
11. **Code khó.** Quote giữ statement_version. Nếu sao kê đổi sau khi lấy quote, submit ném STATEMENT_CHANGED; nếu không còn sao kê hiện hành, có STATEMENT_SUPERSEDED. Source tiền đủ chưa phải điều kiện duy nhất: không trả vượt nợ/số còn phải trả. Intent SUBMIT_UNKNOWN được lưu trước POST giống nguyên tắc M07.
12. **Ví dụ.** Nguồn có 2 triệu, nợ đã ghi nhận 1 triệu, chọn trả 300.000 và quote hợp lệ: nguồn còn 1,7 triệu; posted outstanding giảm 300.000; sao kê và lịch sử ghi payment. Nếu một ghi dữ liệu trong transaction lỗi, không giữ riêng phần đã trừ nguồn.

**Bóc phép cập nhật thật:** service gọi updateCreditAccount với postedOutstandingMinor bằng nợ cũ trừ amount; pendingAuthorizationsMinor lấy lại giá trị đang có; version truyền để kiểm tra cạnh tranh. Không suy rằng mọi authorization đang chờ tự được thanh toán theo amount đó.

**Tự kiểm tra:** (1) Tại sao phải kiểm tra version sao kê? (2) Màn hình kết quả có gửi POST lại không? (3) Có tiền nguồn là đủ để trả bất kỳ số tiền nào không?

## A01 — Phiên nhân viên, quyền và quản lý staff

**Mở code:** [App.tsx](C:/Projects/banking-system/admin-web/src/App.tsx), [api.ts](C:/Projects/banking-system/admin-web/src/api.ts), [staffAuthService.ts](C:/Projects/banking-system/backend/src/admin/auth/staffAuthService.ts), [adminHttp.ts](C:/Projects/banking-system/backend/src/admin/http/adminHttp.ts), [authorization.ts](C:/Projects/banking-system/backend/src/admin/authorization/authorization.ts).

1. **Vai trò.** StaffAuthService xác thực nhân viên độc lập customer. Login/Activation/StaffView trong App.tsx là component, không phải class. Bỏ service làm mất cơ chế phiên staff; ẩn nút trên UI không thay thế nó.
2. **Vị trí.** Login.login → adminFetch → beginLogin → challenge; Login.verify → verifyLoginMfa → phiên/cookie → AppShell. Activation nhận invite token và tạo thông tin kích hoạt theo API.
3. **Input.** Email/password; challengeId/code TOTP; cookie phiên; CSRF cho request ghi. StaffView gửi yêu cầu invite/đổi role/disable kèm lý do; không tự ghi staff DB.
4. **Output.** Challenge hoặc staff/session metadata; authenticate trả context dùng kiểm tra quyền; UI nhận lỗi 401/403 khi không thỏa.
5. **Thuộc tính/state.** StaffAuthService giữ options(repository/encryption...), clock, environmentScope, loginFailures. Login giữ email/password/challengeId/code/busy/error. AppShell giữ tab/dữ liệu/quyền hiển thị; adminFetch có csrfTokenValue ở module.
6. **Constructor.** Backend khởi tạo StaffAuthService với AdminRepository và encryption. PostgresAdminRepository là một implementation; InMemoryAdminRepository là implementation khác. adminFetch không có constructor.
7. **Method.** invite/activate; beginLogin/verifyLoginMfa; authenticate/verifyCsrf; stepUp/requireFreshStepUp; refresh/logout/listSessions; các helper createSession/subjectFor và xử lý encryption/rate limit phục vụ bên trong.
8. **Ai gọi ai.** handleAdminRequest → authenticate → requirePermission; thao tác ghi → verifyCsrf; thao tác duyệt cần step-up còn mới. StaffView.invite/submitRole → AppShell.requestAction → action engine → phê duyệt A06.
9. **Ai tạo object.** adminServer ghép repository/auth/action engine; React render các component. Không dùng AuthProvider của Mobile cho Admin.
10. **Phụ thuộc/dữ liệu.** Staff, role/grant, invitation, MFA credential, challenge/session và audit qua AdminRepository. Đổi quyền/disable khi thực thi làm thay authorization version và thu hồi phiên theo logic repository.
11. **Code khó.** Xem trích adminFetch dưới. credentials: "include" cho phép gửi cookie; CSRF là kiểm tra riêng cho thao tác ghi, không phải thay mật khẩu. Generic T ở return payload as T không phải runtime validator tương đương Mobile.
12. **Ví dụ.** Đăng nhập staff đúng mật khẩu mới nhận challenge; nhập TOTP đúng mới vào Admin. Có role trên UI nhưng server đánh giá quyền đã hết hạn thì request vẫn bị từ chối.

~~~typescript
if (!["GET", "HEAD", "OPTIONS"].includes(method)) headers.set("X-CSRF-Token", csrfToken());
~~~

Dấu ! nghĩa “không nằm trong nhóm method chỉ đọc này”. Vì vậy các POST/PATCH/... mang thêm header. Không suy rằng có header là được phép: Backend vẫn xác minh.

**Giới hạn UI hiện tại:** adminFetch không có vòng refresh tự động khi 401 giống requestJson Mobile; ErrorNotice hướng dẫn đăng nhập lại. StaffView gửi environmentScope = preview cho thay đổi role theo code hiện tại. Mời/đổi role/disable là request cần duyệt, không phải bấm xong staff đã đổi.

**Tự kiểm tra:** (1) Phiên staff có dùng token customer không? (2) CSRF và permission kiểm tra hai điều gì? (3) invite request đã tạo tài khoản staff ACTIVE chưa?

## A02 — Tra cứu customer/account và điều khiển tiền demo

**Mở code:** [Customers và AppShell](C:/Projects/banking-system/admin-web/src/App.tsx), [adminHttp.ts](C:/Projects/banking-system/backend/src/admin/http/adminHttp.ts), [actionEngine.ts](C:/Projects/banking-system/backend/src/admin/actions/actionEngine.ts), [adminRepository.ts](C:/Projects/banking-system/backend/src/admin/repositories/adminRepository.ts).

1. **Vai trò.** Tra cứu dữ liệu cần cho hỗ trợ/vận hành và tạo yêu cầu khóa/mở/nạp/đảo nạp demo. Bỏ phần đọc thì UI không biết đối tượng; bỏ action engine thì mất quy trình kiểm tra yêu cầu trước khi duyệt.
2. **Vị trí.** AppShell.search/openCustomer → adminFetch → HTTP → repository đọc. Customers.submitAccount → requestAction → HTTP → AdminActionEngine.create → chờ A06 → executeApprovedAction.
3. **Input.** query tìm kiếm; customerId/accountId; reasonCode/ticketReference/description; funding có amountMinor/currency; reversal có sourceTransactionId.
4. **Output.** Danh sách customer/account đã giới hạn dữ liệu; thao tác ghi trước hết trả action request, không phải số dư đã đổi.
5. **Thuộc tính/state.** AppShell giữ query/customers/accounts/loading/error; Customers giữ form thao tác. Action engine giữ repository/auth/options; PostgresAdminRepository giữ pool, unitOfWork và executionFault tùy chọn.
6. **Constructor.** Admin server tạo repository rồi truyền cho engine. PostgresAdminRepository tạo UnitOfWork từ pool; component không new class Customers.
7. **Method.** search → findCustomers; openCustomer → listCustomerAccounts; các API đọc khác dùng findCustomer/findAccount/listAccountTransactions. submitAccount phân nhánh BLOCK/UNBLOCK/FUND/REVERSAL; khóa truy cập customer đi request riêng.
8. **Ai gọi ai.** HTTP tạo action với target/type/body → engine kiểm tra permission/body/target version → repository.createAction. Sau approve, repository.executeApprovedAction chọn đúng actionType để ghi dữ liệu.
9. **Ai tạo object.** React render form; Engine do server tạo; rows/action là dữ liệu được repository chuyển thành object.
10. **Phụ thuộc/dữ liệu.** customers, payment_accounts, account_transactions, admin_action_requests, approval/execution records, ledger/audit/outbox; funding reversal lưu liên hệ giao dịch gốc.
11. **Code khó.** Access lock của customer khác status BLOCKED của account. Việc khóa customer tác động quyền dùng phiên; khóa account tác động tài khoản cụ thể. Reversal funding phải tham chiếu giao dịch gốc và kiểm tra điều kiện, không chỉ nhập một số âm.
12. **Ví dụ.** Nhân viên tạo yêu cầu nạp 100.000 tiền demo; account chưa tự tăng. Checker khác duyệt; execution hợp lệ mới cập nhật số dư, lịch sử và ledger trong transaction.

**Tự kiểm tra:** (1) Khóa customer và khóa account khác gì? (2) Vì sao funding response 202 chưa chứng minh số dư tăng? (3) Reversal cần giao dịch gốc để làm gì?

## A03 — Nhận xử lý và duyệt hồ sơ KYC

**Mở code:** [Applications](C:/Projects/banking-system/admin-web/src/App.tsx), [adminHttp.ts](C:/Projects/banking-system/backend/src/admin/http/adminHttp.ts), [AdminActionEngine](C:/Projects/banking-system/backend/src/admin/actions/actionEngine.ts), [PostgresAdminRepository](C:/Projects/banking-system/backend/src/admin/repositories/adminRepository.ts:1156).

1. **Vai trò.** Đưa hồ sơ do M01 gửi qua bước người xử lý đề xuất và người khác duyệt. Bỏ claim/review thì hồ sơ SUBMITTED không tự thành APPROVED.
2. **Vị trí.** AppShell.load tab applications → listApplications; Applications.submit → endpoint recommendation → engine.create; Approval Inbox → approve → executeApprovedAction.
3. **Input.** applicationType KYC, applicationId; decision, reasonCode, ticketReference, description; claim gắn staffId từ phiên.
4. **Output.** AdminApplication hoặc action chờ duyệt; sau execution, trạng thái KYC và thông báo cập nhật.
5. **Thuộc tính/state.** Component Applications giữ hồ sơ chọn/decision/reason; engine/repository dùng dependency chung ở A02. Hồ sơ có version để phát hiện dữ liệu đổi trong lúc người duyệt đang xem.
6. **Constructor.** Không có KycAdminController riêng trong luồng này; handleAdminRequest và engine/repository hiện hữu xử lý.
7. **Method.** listApplications/findApplication/claimApplication ở repository; submit của Applications gửi đề xuất; AdminActionEngine.create/approve/reject điều phối action. executeApprovedAction xử lý nhánh KYC.
8. **Ai gọi ai.** Claim đi qua HTTP tới repository để nhận việc/chuyển UNDER_REVIEW. Đề xuất đi đường action engine. Phê duyệt gọi decideAction rồi executeApprovedAction; ba bước không được gọi là một method “duyệt tất cả”.
9. **Ai tạo object.** Các service Admin được server ghép sẵn; React tạo component; repository map SQL rows thành AdminApplication.
10. **Phụ thuộc/dữ liệu.** kyc_applications, kyc_reviews, admin_action_requests, dấu vết quyết định/thực thi, notifications, audit/outbox.
11. **Code khó.** Claim kiểm tra người đã nhận và trạng thái hồ sơ. APPROVED, REJECTED, NEEDS_MORE_INFO là các kết quả đề xuất KYC. Version/fingerprint giúp người duyệt không xác nhận một hồ sơ/nội dung đã bị thay sau lúc tải.
12. **Ví dụ.** Hồ sơ thiếu dữ liệu → staff đề xuất NEEDS_MORE_INFO kèm lý do → checker phê duyệt → Backend cập nhật hồ sơ → Mobile đọc lại và thấy cần bổ sung. Nhận hồ sơ xử lý chưa phải quyết định cuối.

**Tự kiểm tra:** (1) UNDER_REVIEW khác APPROVED thế nào? (2) Ai được tự duyệt đề xuất của mình? (3) Vì sao Mobile phải đọc lại trạng thái server?

## A04 — Duyệt hồ sơ tín dụng và hạn mức

**Mở code:** [Applications](C:/Projects/banking-system/admin-web/src/App.tsx), [adminHttp.ts](C:/Projects/banking-system/backend/src/admin/http/adminHttp.ts), [adminRepository.ts](C:/Projects/banking-system/backend/src/admin/repositories/adminRepository.ts), [RelationalCreditService.activateApplication](C:/Projects/banking-system/backend/src/database/creditService.ts:272).

1. **Vai trò.** Quyết định hồ sơ tín dụng đủ điều kiện chờ kích hoạt hay bị từ chối. Bỏ bước này làm M13 không có trạng thái hợp lệ để kích hoạt theo quy trình.
2. **Vị trí.** Cùng component Applications nhưng applicationType CREDIT → recommendation → action → checker → execution → Mobile activate sau đó.
3. **Input.** applicationId, decision, approvedLimitMinor khi phù hợp, lý do/ticket/description; fingerprint/version lúc duyệt.
4. **Output.** Action request và sau thực thi là application PENDING_ACTIVATION hoặc REJECTED theo quyết định hợp lệ.
5. **State.** Applications giữ approved limit input khi chọn CREDIT; backend dùng version/status của hồ sơ. Không giữ một credit card mới ở frontend để thay server.
6. **Constructor.** Dùng AdminActionEngine/PostgresAdminRepository hiện hữu; không thêm service chỉ vì tên feature là credit review.
7. **Method.** listApplications/findApplication/claimApplication; Applications.submit; engine.create/approve/reject; repository.executeApprovedAction nhánh tín dụng.
8. **Ai gọi ai.** submit tạo action với quyết định/hạn mức → create lưu fingerprint → approve kiểm tra → execute cập nhật credit_applications → khách hàng gọi activateApplication ở luồng khác.
9. **Ai tạo object.** Server tạo dependencies; repository ghi hồ sơ, RelationalCreditService chỉ tạo credit account/card tại bước kích hoạt M13.
10. **Phụ thuộc/dữ liệu.** credit_applications, admin action/decision/execution, audit/outbox và thông báo. Hạn mức đề nghị và hạn mức được duyệt là hai field/ý nghĩa khác nhau.
11. **Code khó.** “Được duyệt” ở nghiệp vụ này đi tới PENDING_ACTIVATION, không tự đồng nhất với ACTIVE. Decision của action (APPROVED) và status của application (PENDING_ACTIVATION) cũng là hai đối tượng khác nhau.
12. **Ví dụ.** Khách xin 20 triệu, được duyệt 10 triệu. Action SUCCEEDED nghĩa là quyết định đã được áp dụng; khách còn phải kích hoạt để tạo account/card với hạn mức được chấp nhận.

**Tự kiểm tra:** (1) APPROVED của action có phải ACTIVE của application không? (2) Khi nào createCreditAccount chạy? (3) Cần kiểm tra field nào để biết hạn mức cuối cùng?

## A05 — Vận hành transfer, fraud, outbox và job

**Mở code:** [Transfers, FraudCases, Operations](C:/Projects/banking-system/admin-web/src/App.tsx), [adminHttp.ts](C:/Projects/banking-system/backend/src/admin/http/adminHttp.ts), [adminRepository.ts](C:/Projects/banking-system/backend/src/admin/repositories/adminRepository.ts), [workerRuntime.ts](C:/Projects/banking-system/backend/src/workers/workerRuntime.ts).

1. **Vai trò.** Cho nhân viên xem và yêu cầu xử lý các tình huống vận hành. Bỏ UI này không tự xóa transfer/fraud/job; bỏ đường execution sẽ không có thao tác được áp dụng.
2. **Vị trí.** AppShell.load → API danh sách; component → requestAction → AdminActionEngine → duyệt A06 → repository.executeApprovedAction. Worker xử lý công việc nền sau requeue theo cơ chế riêng.
3. **Input.** transferId/fraud caseId/outbox eventId/jobId, loại thao tác, reason và thông tin yêu cầu; fraud có nhận xử lý/note/resolution.
4. **Output.** Dữ liệu list/summary, case/timeline hoặc action request; kết quả execution được lưu phía server.
5. **State.** AppShell giữ transfers/fraudCases/jobs/outboxEvents/summary; component giữ lý do/form. Repository dùng pool/unitOfWork; worker giữ lease/retry trạng thái xử lý riêng.
6. **Constructor.** Component là hàm; engine/repository như A02; WorkerRuntime độc lập UI.
7. **Method.** load và requestAction phía UI; repository có listFraudCases/findFraudCase/listFraudCaseTimeline/claimFraudCase, listJobs/listOutboxEvents; engine.create rồi approve/executeApprovedAction cho lệnh nhạy cảm.
8. **Ai gọi ai.** Transfer retry/cancel/reversal → action engine → nhánh SQL tương ứng. Fraud claim/note → route chuyên biệt; resolution → action. Outbox requeue/job retry → action → đặt lại trạng thái phù hợp → worker lần sau nhận.
9. **Ai tạo object.** Server tạo engine/repository; worker được entry point worker ghép dependency, không phải Operations component khởi chạy shell.
10. **Phụ thuộc/dữ liệu.** transfers, payment_accounts, ledger, fraud_reports và timeline/notes, outbox_events, background jobs/retry history, audit và admin actions.
11. **Code khó.** Retry không đồng nghĩa reversal: retry thử xử lý tiếp theo trạng thái cho phép, cancel chuyển giao dịch chờ theo nhánh hủy, reversal ghi nghiệp vụ đảo có kiểm tra tiền/đối ứng. Requeue dùng payload canonical đang lưu; UI không sửa payload để chạy mã tùy ý.
12. **Ví dụ.** Outbox event DEAD: staff đề xuất requeue; checker duyệt; DB đặt lại để worker có thể nhận. Điều đó không chứng minh push/email đã gửi thành công, càng không làm một transfer nội bộ đã commit bị chạy trừ tiền lại.

**Các giới hạn quan sát được trong UI hiện tại:**

- Tab transfers tải **status=PENDING**. Dù component có nhánh nút retry/reversal theo status, không suy rằng danh sách này đang hiển thị đủ FAILED/SUCCEEDED.
- FraudCases có thao tác note hướng tới mục đầu trong danh sách theo code; không mô tả thành trình soạn note đầy đủ cho mọi case.
- UI resolution hiện gửi lựa chọn NOT_FRAUD trong đường tương ứng; không tự thêm các phương án nghiệp vụ khác vào mô tả.
- Requeue outbox hiển thị cho DEAD/SKIPPED; retry job cho FAILED/DEAD. Server vẫn kiểm tra lại trạng thái/lease/canonical data.

**Tự kiểm tra:** (1) Requeue có nghĩa notification đã đến máy khách chưa? (2) Reversal khác sửa status thế nào? (3) Có nhánh render nút là đủ chứng minh người dùng truy cập được nhánh đó chưa?

## A06 — Approval Inbox, maker–checker và audit

**Mở code:** [AppShell.approve/reject và AuditView](C:/Projects/banking-system/admin-web/src/App.tsx), [actionEngine.ts](C:/Projects/banking-system/backend/src/admin/actions/actionEngine.ts), [adminRepository.ts](C:/Projects/banking-system/backend/src/admin/repositories/adminRepository.ts).

1. **Vai trò.** AdminActionEngine kiểm tra và điều phối một yêu cầu thay đổi nhạy cảm; PostgresAdminRepository lưu quyết định/thực thi. Bỏ engine hoặc guard tự duyệt sẽ phá quy trình phân tách người yêu cầu/người duyệt.
2. **Vị trí.** requestAction → create → action chờ → AppShell.approve/reject → HTTP → engine → repository. AuditView đọc kết quả dấu vết.
3. **Input.** create nhận subject/actionType/targetType/targetId/body/key/traceId. approve nhận subject/accessToken/requestId/body có fingerprint/version/reason; reject tương tự; cancel nhận subject/requestId/traceId.
4. **Output.** AdminActionRecord. Tạo request, quyết định APPROVED và thực thi SUCCEEDED là các mốc riêng.
5. **Thuộc tính.** Engine giữ repository, auth, options. Repository Postgres giữ pool/unitOfWork/executionFault. UI giữ selected, reason, stepUpCode, stepUpFreshUntil, loading/error.
6. **Constructor.** AdminActionEngine nhận AdminRepository và StaffAuthService; điều này không có nghĩa mọi method đều gọi mọi dependency. Repository Postgres thực hiện SQL; bản InMemory lưu Maps phục vụ bối cảnh kiểm thử/reference.
7. **Method.** create chuẩn hóa/kiểm tra quyền và body rồi createAction; approve kiểm tra người duyệt/permission/MFA/fingerprint/version/hạn, decideAction rồi executeApprovedAction; reject lưu từ chối; cancel chỉ cho phép theo người/trạng thái phù hợp.
8. **Ai gọi ai.** AppShell.approve có thể gọi /admin/auth/step-up trước, rồi /admin/approvals/:id/approve → engine.approve → findAction → guard → decideAction → executeApprovedAction → audit/read result.
9. **Ai tạo object.** adminServer ghép engine với implementation AdminRepository; không tạo engine mới cho mỗi hàng bảng Approval Inbox.
10. **Phụ thuộc/dữ liệu.** admin_action_requests, decisions/execution attempts, version của target, audit_events và bảng nghiệp vụ bị tác động. listAudit chỉ trả dữ liệu staff theo SQL và redaction của repository.
11. **Code khó.** Xem hai đoạn ý nghĩa dưới. Approval và execution có transaction riêng; code hỗ trợ cửa sổ crash sau quyết định trước thực thi. Không mô tả chúng là một transaction duy nhất.
12. **Ví dụ.** A tạo khóa account phiên bản 3. B xem nội dung/fingerprint/version và duyệt bằng MFA còn mới. Nếu account đã đổi trước execution, action có thể STALE; nếu đã SUCCEEDED mà mất response, retry approval được xử lý theo nhánh replay thay vì làm lại thay đổi.

**Guard tự duyệt — trích điều kiện thật:**

~~~typescript
if (action.requesterStaffId === input.subject.staffId) {
~~~

=== so sánh đúng danh tính; nhánh này ghi ADMIN_SELF_APPROVAL_ATTEMPT rồi ném SELF_APPROVAL_FORBIDDEN. Có quyền cao không làm bỏ qua điều kiện đó.

**Bảo vệ nội dung được duyệt:** approvedFingerprint phải bằng action.requestFingerprint. version cho biết người duyệt đang xem phiên bản nào. Code có ngoại lệ phục hồi cho APPROVED/SUCCEEDED; vì vậy không diễn giải thành “mọi version khác đều luôn thất bại”.

**Audit:** appendAudit ghi actor/action/target/outcome/reason/trace/version và metadata đã xử lý. listAudit → AuditView là đường đọc. Các endpoint audit export hiện trả REFERENCE_EXPORT_PENDING; không tuyên bố đã tạo được file tải xuống thực tế.

**Tự kiểm tra:** (1) Maker có được approve yêu cầu của mình không? (2) Fingerprint và version bảo vệ hai khía cạnh nào? (3) APPROVED có chắc đã đổi dữ liệu nghiệp vụ chưa? (4) Audit phục vụ việc gì mà console.log đơn giản chưa thay được?
## N06 — Worker, outbox và lịch xử lý nghiệp vụ

**Mở code:** [WorkerRuntime](C:/Projects/banking-system/backend/src/workers/workerRuntime.ts), [RelationalLifecycleScheduler](C:/Projects/banking-system/backend/src/workers/lifecycleScheduler.ts), [RelationalLifecycleService](C:/Projects/banking-system/backend/src/database/lifecycleService.ts), [worker.ts](C:/Projects/banking-system/backend/src/worker.ts).

1. **Vai trò.** WorkerRuntime nhận/xử lý outbox delivery; Scheduler kích hoạt công việc đến hạn; LifecycleService thực hiện nghiệp vụ tiết kiệm/tín dụng. Bỏ scheduler không được coi là hệ thống vẫn tự đáo hạn; bỏ worker không đồng nghĩa các dòng notifications đã commit bị mất.
2. **Vị trí.** API ghi outbox cùng nghiệp vụ → COMMIT → worker lấy việc; đường thời gian: scheduler → lifecycle → transaction → DB.
3. **Input.** WorkerConfig (batch, concurrency, lease, retry, DB...); scheduler config enabled/pollIntervalMs/batchSize/stallThresholdMs; lifecycle nhận asOf, limit hoặc ID cụ thể.
4. **Output.** Kết quả batch, metrics/health, trạng thái event/delivery; lifecycle trả số lượng/kết quả xử lý. Không trả một React component.
5. **Thuộc tính.** Worker có repository, providers, database, metrics, running/initialized/timer và lifecycleScheduler tùy chọn. Scheduler giữ lifecycle/timer/inFlight/started và thông tin lần chạy/lỗi.
6. **Constructor.** Worker tạo PostgresOutboxRepository từ database; nếu scheduledLifecycle bật thì tạo Scheduler với UnitOfWork. Scheduler tạo RelationalLifecycleService.
7. **Method.** Worker.initialize kiểm tra dữ liệu/schema cần thiết; runOnce reclaim lease hết hạn, claim event, dispatch và xử lý delivery. Scheduler.start/runOnce/runTick/stop/health điều khiển vòng lặp. Lifecycle có runSavingsMaturities/runSavingsSuspense/runCreditLifecycle.
8. **Ai gọi ai.** runCreditLifecycle → các nhánh closeCreditStatement và settlePendingCreditPayment; reverseCreditPayment là nghiệp vụ riêng khi được gọi phù hợp, không phải cứ qua một tick là đảo tiền. runSavingsMaturities → matureSavingsDeposit.
9. **Ai tạo object.** Entry point worker khởi tạo WorkerRuntime; vòng đời process khác Mobile/Public API/Admin. Phiên viết tài liệu này không bật worker.
10. **Phụ thuộc/dữ liệu.** outbox_events, notification deliveries, worker_instances; các bảng tiết kiệm/tín dụng/ledger. Provider push/email của outbox hiện có fake/disabled theo config được đọc; email OTP của API là đường provider riêng.
11. **Code khó.** inFlight tránh hai tick trong cùng object chồng nhau; lease/lock ở DB xử lý nhiều worker. await trong một process không đủ điều phối nhiều process. Hết lease có thể nhận lại việc, nên cần dedup và trạng thái bền vững.
12. **Ví dụ.** Sau thời gian process tắt, tick mới tìm khoản đến hạn chưa xử lý; guard DB ngăn ghi đáo hạn hai lần. UI chỉ thấy trạng thái mới sau khi tải lại từ server.

**Tự kiểm tra:** (1) inFlight có thay thế khóa DB giữa hai process không? (2) Ghi outbox có phải đã gửi push thành công không? (3) Notification trong DB có thể tồn tại dù worker đang tắt không?

## Đối chiếu nơi tạo object thật

Bảng này bổ sung mục “ai tạo object” trong các chương, để bạn tìm đúng chỗ thay vì đoán từ tên class.

| Object/component | Nơi tạo hoặc render | Dependency được truyền |
|---|---|---|
| AuthProvider | [mobile-app/src/app/_layout.tsx](C:/Projects/banking-system/mobile-app/src/app/_layout.tsx:167) | Bao quanh cây UI qua JSX; không dùng new |
| PostgresRelationalRepository | [server.ts: start](C:/Projects/banking-system/backend/src/server.ts:81) | Cấu hình kết nối từ cơ chế secret/config |
| UnitOfWork của public relational | [postgresRelationalRepository.ts](C:/Projects/banking-system/backend/src/postgresRelationalRepository.ts:141) | this.pool |
| PersistentMfaService | [server.ts: start](C:/Projects/banking-system/backend/src/server.ts:112) | unitOfWork, encryption, otpDigestKeyring, environmentScope, delivery |
| RelationalHttpBoundary | [server.ts: start](C:/Projects/banking-system/backend/src/server.ts:119) | repository.unitOfWork |
| Các relational service | [RelationalHttpBoundary.constructor](C:/Projects/banking-system/backend/src/database/relationalHttpBoundary.ts:52) | Cùng object UnitOfWork của Boundary |
| Repository của một command | [RelationalTransferService.submit](C:/Projects/banking-system/backend/src/database/transferService.ts:164) | client của lần transaction đang chạy |
| PostgresAdminRepository hoặc InMemoryAdminRepository | [adminServer.ts: start](C:/Projects/banking-system/backend/src/adminServer.ts:34) | Chọn theo cấu hình storage |
| StaffAuthService | [adminServer.ts: start](C:/Projects/banking-system/backend/src/adminServer.ts:52) | repository, encryption, environmentScope |
| AdminActionEngine | [adminServer.ts: start](C:/Projects/banking-system/backend/src/adminServer.ts:66) | repository, auth, tùy chọn invitation provider |
| WorkerRuntime | [worker.ts](C:/Projects/banking-system/backend/src/worker.ts:20) | config và providerSet; database có default riêng |
| RelationalLifecycleScheduler | [WorkerRuntime.constructor](C:/Projects/banking-system/backend/src/workers/workerRuntime.ts:166) | UnitOfWork, lifecycle config, metrics khi được bật |

**Điểm phân biệt:** nhiều service nhận cùng UnitOfWork không có nghĩa mọi request dùng cùng transaction. Mỗi lần gọi transaction lấy một client cho lần công việc đó. Các process Public API, Admin API và Worker cũng có pool/vòng đời riêng.

## Bài tập đọc code theo đúng thứ tự

Không cần sửa code để làm các bài này.

1. M04: chỉ vào đúng dòng biến availableMinor thành availableBalance.
2. M05: tìm dòng lấy limit + 1 và giải thích dữ liệu dư dùng làm gì.
3. M07: chỉ ra lần ghi intent trước POST, khóa tài khoản, cập nhật số dư và điểm COMMIT.
4. M11/M16: so sánh dữ liệu được tạo khi mở tiết kiệm với thanh toán dư nợ.
5. A06: tìm guard tự duyệt và giải thích khoảng trống giữa APPROVED/SUCCEEDED.
6. M02/M03: phân biệt phiên ngân hàng với challenge/recovery token bằng caller thực tế.

## Cách tự đánh giá đã hiểu Giai đoạn 5

Với mỗi chương, bạn tự nói lại được: ai nhận input, ai giữ state, constructor nhận gì, method nào chạy SQL, output đổi hình dạng ở đâu, lỗi đi về UI thế nào. Không cần thuộc lòng tên mọi biến.

Khi thấy một helper trong source chưa được chép nguyên thân hàm ở đây, lần theo caller đã nêu và hỏi: “helper này kiểm tra, biến đổi, đọc hay ghi?”. Tài liệu bao phủ các nhóm chức năng, không thay thế toàn bộ source bằng một bản sao có chú thích.

Các giới hạn/mismatch đã nêu là kết quả đọc code, không phải bản sửa hoặc kết luận kiểm thử runtime: chọn route cancel đăng ký; cursor UI tín dụng; danh sách transfer Admin chỉ tải PENDING; audit export chưa có file; provider outbox chưa chứng minh gửi thật.

Đọc tiếp [giaidoan6.md](C:/Projects/banking-system/giaidoan6.md) khi bạn có thể kể lại M07 bằng lời của mình. Tài liệu tiếp theo giải thích **vì sao** chia lớp, dùng transaction, idempotency và outbox như hiện tại.

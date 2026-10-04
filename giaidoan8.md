
# Giai đoạn 8 — Authentication, Authorization và Security

Tài liệu này tiếp nối [giaidoan7.md](C:/Projects/banking-system/giaidoan7.md). Giai đoạn 7 giải thích dữ liệu nằm ở bảng nào; giai đoạn 8 giải thích ai được phép đọc hoặc thay đổi dữ liệu đó, server xác nhận danh tính thế nào, và vì sao một request hợp lệ ở UI vẫn có thể bị từ chối ở Backend.

Tài liệu được viết từ source hiện tại của repository. Phạm vi là đọc và học: không sửa code, không sửa schema, không chạy migration và không ghi dữ liệu. Mọi ID, email, token trong ví dụ đều là dữ liệu giả.

## Cách đọc

Hãy giữ ba câu hỏi này trong đầu:

1. Server biết request đến từ ai bằng cách nào?
2. Người đó được phép làm đúng hành động nào?
3. Nếu token, challenge hoặc request đã cũ/bị sửa thì lớp nào chặn lại?

## Mục lục

1. Kiến thức nền
2. Bản đồ các lớp bảo mật
3. Đăng ký và xác minh email
4. Đăng nhập, mật khẩu và cấp session
5. Access token, refresh token và đăng xuất
6. Authorization và quyền sở hữu dữ liệu
7. MFA và step-up cho thao tác nhạy cảm
8. Mobile giữ và gửi thông tin xác thực
9. Admin authentication, permission và four-eyes
10. Rate limit, secret, audit và các lớp bảo vệ khác
11. Kiểm tra tổng hợp

# 1. Kiến thức nền

## 1.1 Authentication là gì?

Authentication trả lời “bạn là ai?”. Trong project, customer đăng nhập bằng email và password. Server tìm customer, kiểm tra password digest, rồi cấp access token và refresh token. Từ đó các request sau mang access token để server tìm lại session.

Ví dụ:

~~~text
email + password + X-Device-ID
  → tìm customers
  → verifyPasswordAsync
  → tạo session
  → trả accessToken + refreshToken
~~~

Authentication chưa trả lời “bạn được xem account nào?”. Câu hỏi thứ hai thuộc authorization.

## 1.2 Authorization là gì?

Authorization trả lời “bạn được phép làm gì?”. Ví dụ customer C001 có thể xem account A001 nếu A001 có customer_id = C001. Biết một accountId chưa đủ; Backend phải lấy customerId từ session rồi kiểm tra quan hệ sở hữu.

~~~text
access token
  → xác định customer C001
  → yêu cầu account A001
  → kiểm tra A001.customer_id = C001
  → mới đọc dữ liệu
~~~

Nếu client gửi thêm customerId = C002, server không được tin giá trị đó để thay thế identity trong token.

## 1.3 Session, access token và refresh token

Session là trạng thái server lưu để liên kết token với customer/device/thời hạn.

- Access token dùng cho request nghiệp vụ; trong relational runtime sống 15 phút.
- Refresh token dùng để xin access token mới; trong relational runtime sống 30 ngày.
- Token thật được trả một lần cho client; database lưu hash của token.
- Session có revoked_at, expires_at, family_id và device liên kết.

Token là một “chìa khóa tạm thời”; session trong database là “sổ đăng ký chìa khóa”.

## 1.4 Hash khác encryption thế nào?

Password và token không cần server khôi phục lại giá trị gốc:

- password được PBKDF2 với salt rồi lưu password_digest;
- access/refresh token được SHA-256 hash rồi lưu token hash;
- khi request đến, server hash giá trị client gửi và so sánh.

MFA TOTP secret lại cần dùng để tính mã trong tương lai, nên phải được encryption bảo vệ trước khi lưu. [security.ts](C:/Projects/banking-system/backend/src/security.ts) có hash password/token; [persistentMfaService.ts](C:/Projects/banking-system/backend/src/mfa/persistentMfaService.ts) dùng KeyEncryptionPort để mã hóa TOTP secret.

## 1.5 Device binding

Mỗi request đã xác thực cần header X-Device-ID. Mobile tạo một UUID một lần trong [deviceBindingStorage.ts](C:/Projects/banking-system/mobile-app/src/features/auth/storage/deviceBindingStorage.ts) và lưu trong SecureStore.

Server đưa deviceId vào:

- customer_devices khi tạo session;
- auth_sessions khi tạo access/refresh session;
- truy vấn authenticate/refresh;
- auth_challenges và step-up context.

Vì vậy token bị sao chép sang một device khác không tự động sử dụng được.

## 1.6 MFA và step-up

MFA là xác thực nhiều yếu tố. Project có TOTP và EMAIL_OTP tùy purpose.

- Login customer relational-v2 hiện là password-only theo contract của [http.ts](C:/Projects/banking-system/backend/src/http.ts); TOTP được dùng cho các thao tác nhạy cảm.
- Đăng ký dùng EMAIL_OTP để xác minh email.
- Chuyển tiền, mở tiết kiệm, thanh toán credit, đổi MFA và một số thao tác thẻ dùng TOTP step-up.
- Admin login dùng password rồi TOTP; Admin approve còn yêu cầu fresh step-up.

Step-up nghĩa là session đang hợp lệ vẫn phải chứng minh lại yếu tố mạnh trước một hành động có rủi ro cao.

## 1.7 Các từ dễ nhầm

| Khái niệm | Câu hỏi | Dữ liệu/code liên quan |
| --- | --- | --- |
| Authentication | Ai đang gọi? | access token, auth_sessions, RelationalAuthService.authenticate |
| Authorization | Người đó được làm gì? | customerId, ownership query, permission registry |
| Session | Server nhớ trạng thái đăng nhập nào? | auth_sessions, refresh families, expiry/revocation |
| MFA challenge | Proof nào đang chờ xác minh? | auth_challenges, purpose, device, resource |
| Step-up | Có cần proof mới cho command này không? | TOTP, requestFingerprint, resourceId |
| Audit | Chuyện gì đã xảy ra? | audit_events, auth_security_events |
| Rate limit | Ai đang thử quá nhiều? | rate_limit_buckets, HMAC network fingerprint |

## Câu hỏi tự kiểm tra phần 1

1. Authentication khác authorization ở câu hỏi nào?
2. Vì sao password không lưu plaintext?
3. Access token và refresh token có cùng thời gian sống không?
4. Device ID giúp chặn tình huống nào?
5. Tại sao “đã login” vẫn có thể cần step-up?

# 2. Bản đồ các lớp bảo mật

## 2.1. Luồng request customer

Public API bắt đầu từ [server.ts](C:/Projects/banking-system/backend/src/server.ts). Khi storage là postgres, startup tạo PostgresRelationalRepository, PersistentMfaService và RelationalHttpBoundary; sau đó truyền chúng vào createPersistentBankingServer.

Một request customer đi qua các lớp:

~~~text
Mobile Screen
  → AuthContext / authApi
  → requestJson
  → HTTP headers: Authorization, X-Device-ID, X-Request-ID
  → http.ts
      → route parsing
      → requireBearer cho route cần đăng nhập
      → RelationalHttpBoundary
          → RelationalAuthService
          → RelationalAccountReadService
          → RelationalTransferService
          → RelationalSavingsService
          → RelationalCreditService
          → PersistentMfaService khi cần challenge
      → Repository / UnitOfWork
      → PostgreSQL
  → JSON response
  → Mobile state/UI
~~~

http.ts không tự quyết định customerId từ body. Hàm requireBearer xác minh bearer token và deviceId, rồi trả userId từ AuthUser.id.

## 2.2. requireBearer là cổng vào route đã đăng nhập

Trong [http.ts](C:/Projects/banking-system/backend/src/http.ts), requireBearer làm các bước:

1. đọc header Authorization;
2. yêu cầu chuỗi bắt đầu bằng Bearer;
3. đọc X-Device-ID;
4. gọi RelationalHttpBoundary.authenticate hoặc BankingSystem.authenticate;
5. nhận AuthUser.id;
6. kiểm tra customerAccessStatus nếu control plane khóa customer;
7. trả customerId cho phần xử lý route.

Nếu thiếu token hoặc device, lỗi 401. Nếu customer bị khóa, cũng trả 401 để không tiết lộ thêm trạng thái quyền truy cập.

## 2.3. Route group của relational-v2

[relationalHttpBoundary.ts](C:/Projects/banking-system/backend/src/database/relationalHttpBoundary.ts) có các nhóm:

auth, registration, mfa, accounts, beneficiaries, transfers, savings, credit, recipients, notifications, fraud, kyc.

Constructor tạo từng service với cùng UnitOfWork. Nếu bật nhóm accounts/command/MFA mà không bật auth, constructor ném lỗi vì các nhóm đó cần session boundary trực tiếp.

assertRelationalV2Complete kiểm tra một danh sách route bắt buộc trước khi server sẵn sàng. Đây là một guard cấu hình: route có thể tồn tại trong code nhưng không được coi là hoàn tất nếu chưa được bật.

## 2.4. Hai runtime cần phân biệt

Project vẫn giữ BankingSystem in-memory cho reference/test harness. Relational-v2 dùng PostgreSQL và các service relational.

- relational-v2: RelationalAuthService, PersistentMfaService, UnitOfWork, PostgreSQL.
- in-memory: BankingSystem giữ state trong memory/snapshot và có các method authenticate, refresh, revoke tương ứng.
- http.ts chọn relational route nếu relationalHttp.isRouteEnabled trả true; nếu không, route có thể dùng system legacy.

Khi đọc một test, hãy kiểm tra test đang dựng BankingSystem hay RelationalHttpBoundary. Hai đường có cùng ý nghĩa nghiệp vụ nhưng storage và method cụ thể khác nhau.

## 2.5. Bản đồ bảng bảo mật

~~~text
customers
  ├── customer_devices
  ├── auth_sessions
  ├── refresh_session_families
  │     └── refresh_session_records
  ├── auth_challenges
  ├── mfa_credentials
  ├── mfa_recovery_codes
  ├── mfa_recovery_requests
  ├── auth_security_events
  └── rate_limit_buckets

staff_users
  ├── staff_roles / staff_permissions
  ├── staff_sessions
  ├── staff_mfa_credentials
  ├── staff_auth_challenges
  └── admin_action_requests
~~~

Migration nền nằm ở [001_banking_mvp.sql](C:/Projects/banking-system/backend/database/001_banking_mvp.sql) và [007_identity_runtime_normalization.sql](C:/Projects/banking-system/backend/database/007_identity_runtime_normalization.sql). MFA nằm ở migrations 014–018; Admin nằm chủ yếu ở 019 và RLS/grant ở 023–025.

## 2.6. Security boundary không chỉ là một file

Một request được bảo vệ bởi nhiều lớp:

~~~text
Mobile validation
  → HTTP token/device check
  → customer access status
  → service ownership/policy check
  → MFA challenge context
  → repository WHERE/FK/constraint
  → audit/security event
~~~

Nếu một lớp bị bỏ qua, lớp khác có thể vẫn chặn một số lỗi, nhưng thiết kế không nên dựa vào may mắn. Ví dụ UI ẩn nút chuyển tiền không thay thế việc Backend kiểm tra ownership và balance.

## Câu hỏi tự kiểm tra phần 2

1. File nào dựng PersistentMfaService trong PostgreSQL runtime?
2. Hàm nào biến access token thành customerId ở HTTP boundary?
3. Vì sao relational command routes yêu cầu auth route group?
4. In-memory runtime khác relational-v2 ở đâu?
5. Database constraint đứng ở vị trí nào trong chuỗi bảo vệ?

# 3. Đăng ký và xác minh email

## 3.1. Dữ liệu bắt đầu từ Mobile

Màn hình [RegisterScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/auth/screens/RegisterScreen.tsx) có hai phase:

- FORM: người dùng nhập fullName, email, phoneNumber, password;
- OTP: server trả challengeId, expiresAt, method EMAIL_OTP và resendAfter.

Khi form hợp lệ, handleRegister:

1. validateRegisterForm kiểm tra dữ liệu local;
2. ghi registration session với phase BEGIN_UNKNOWN;
3. gọi AuthContext.register;
4. nhận challenge;
5. lưu phase CHALLENGE_RECEIVED vào SecureStore;
6. hiển thị ô nhập OTP.

BEGIN_UNKNOWN có ý nghĩa an toàn: nếu app chết ngay quanh thời điểm gọi API, lần mở sau biết rằng kết quả server chưa chắc chắn và không tự động gửi lại request.

## 3.2. Mobile → API

AuthContext.register gọi registerRequest trong [authApi.ts](C:/Projects/banking-system/mobile-app/src/features/auth/services/authApi.ts).

Request có:

- POST /auth/register;
- body fullName, email, phoneNumber, password;
- X-Device-ID từ ensureDeviceId;
- requestJson validator isRegistrationChallengeResponse.

requestJson thêm X-Request-ID, timeout và xử lý lỗi JSON. Token chưa tồn tại nên request này không có Authorization.

## 3.3. HTTP → RelationalRegistrationService.begin

Trong [relationalHttpBoundary.ts](C:/Projects/banking-system/backend/src/database/relationalHttpBoundary.ts), beginRegistration gọi:

~~~text
HTTP POST /auth/register
  → relationalHttp.beginRegistration
  → RelationalRegistrationService.begin
~~~

RelationalRegistrationService.begin:

1. trim và lowercase email;
2. yêu cầu fullName, email hợp lệ, phoneNumber và password ít nhất 8 ký tự;
3. hash password bằng hashPasswordAsync;
4. tạo pendingRegistrationId và expiresAt sau 5 phút;
5. mở UnitOfWork.transaction;
6. dùng CustomerRepository, MfaRepository, AuditRepository cùng client;
7. áp rate limit theo networkFingerprint;
8. kiểm tra customer email/phone đã tồn tại;
9. khóa pending registration cũ cùng contact;
10. tạo row pending_registrations;
11. ghi audit REGISTRATION_STARTED;
12. commit;
13. sau transaction gọi PersistentMfaService.createEmailChallenge.

Network fingerprint được tạo từ socket address và HMAC key bằng computeRegistrationNetworkFingerprint. Registration không dùng x-forwarded-for vì header đó có thể bị client giả mạo.

## 3.4. Tạo EMAIL_OTP challenge

PersistentMfaService.createEmailChallenge:

1. tạo challengeId dạng opaque token;
2. chỉ lưu hash của challengeId trong auth_challenges.id;
3. tạo OTP 6 chữ số qua OtpCodeGenerator;
4. tạo proof digest qua OtpDigestKeyring;
5. lưu purpose REGISTRATION_EMAIL_VERIFY, deviceId, pendingRegistrationId, requestFingerprint và expiresAt;
6. ghi outbox security.registration_otp_requested với destination fingerprint và masked destination;
7. gửi code qua VerificationCodeDeliveryPort;
8. nếu gửi lỗi, đánh dấu DELIVERY_FAILED và ghi auth_security_events;
9. nếu gửi thành công, đổi status PENDING_DELIVERY thành ACTIVE;
10. trả challengeId thật, expiry, resendAfter và maskedDestination.

Code OTP không được lưu plaintext trong PostgreSQL, log hoặc outbox payload.

## 3.5. Xác minh đăng ký

Khi người dùng bấm xác nhận:

~~~text
RegisterScreen.handleRegister
  → AuthContext.verifyRegistrationChallenge
  → authApi.verifyRegistrationChallenge
  → POST /auth/register/verify
  → RelationalHttpBoundary.verifyRegistration
  → RelationalRegistrationService.verify
  → PersistentMfaService.verifyChallenge
  → RelationalRegistrationService.complete
  → customers + payment_accounts + registration_completions
~~~

RelationalRegistrationService.verify trước hết đọc auth_challenges bằng hash challengeId và kiểm tra purpose, deviceId. Sau đó gọi verifyChallenge với:

- challengeId;
- deviceId;
- proof;
- purpose REGISTRATION_EMAIL_VERIFY;
- resourceId;
- requestFingerprint.

PersistentMfaService kiểm tra challenge còn ACTIVE, chưa hết hạn và đúng context; OTP digest đúng thì consume challenge và ghi MFA_VERIFY_SUCCEEDED.

complete mở transaction, khóa pending registration, rồi:

- tạo customers;
- tạo payment_accounts;
- tạo customer_feature_entitlements cho TRANSFERS, SAVINGS, CREDIT;
- tạo registration_completions;
- tháo FK pending_registration_id khỏi challenge;
- consume pending registration;
- ghi audit CUSTOMER_REGISTERED;
- ghi outbox CUSTOMER_REGISTERED.

Nếu request verify lặp lại sau khi hoàn tất, registration_completions cho phép đọc kết quả cũ thay vì tạo customer/account thứ hai.

## 3.6. Resend và cancel

Resend route không cần bearer vì đăng ký chưa có session. Server lấy email từ pending registration, không tin destination do client gửi.

PersistentMfaService.resendRegistrationChallenge kiểm tra challenge, deviceId, method EMAIL_OTP, purpose và status ACTIVE; sau đó áp cooldown 60 giây và rate limit tối đa 3 lần trong cửa sổ 10 phút.

Cancel route yêu cầu challengeId và deviceId. RegistrationService.cancel khóa challenge, kiểm tra chưa completed, consume pending registration và cancel challenge nếu còn active.

## 3.7. Các nhánh lỗi

| Tình huống | Nơi chặn | Kết quả học được |
| --- | --- | --- |
| Email sai | RegisterScreen + begin | lỗi field/message |
| Password ngắn | RegisterScreen + begin | client không đủ vẫn bị server chặn |
| Email đã tồn tại | CustomerRepository/unique index | 409 conflict |
| OTP sai | verifyChallenge.recordChallengeFailure | attempts tăng, có thể LOCKED |
| OTP hết hạn | verifyChallenge | 401 challenge invalid/expired |
| Gửi OTP thất bại | delivery + auth_security_events | 409 OTP_DELIVERY_FAILED |
| App chết sau begin | registration session | phase BEGIN_UNKNOWN, không tự động retry mù |

## Câu hỏi tự kiểm tra phần 3

1. Tại sao registration lưu pending_registrations trước khi tạo customers?
2. ChallengeId thật và challenge hash được dùng ở đâu?
3. Vì sao outbox không chứa OTP plaintext?
4. Bảng nào giúp verify registration retry không tạo account kép?
5. Tại sao resend không nhận email mới từ client?




# 4. Đăng nhập, mật khẩu và cấp session

## 4.1. Customer login bắt đầu ở đâu?

[LoginScreen.tsx](C:/Projects/banking-system/mobile-app/src/features/auth/screens/LoginScreen.tsx) lấy email/password từ form rồi gọi AuthContext.login. AuthContext:

1. tăng sessionLifecycleEpoch;
2. chờ dọn storage cũ nếu có;
3. gọi ensureDeviceId;
4. gọi loginRequest;
5. chuyển response thành AuthSession bằng createAuthSession;
6. saveAuthSession vào SecureStore;
7. setActiveSession với status authenticated.

Login response gồm accessToken, refreshToken, expiresInSeconds và public user. Mobile không tự suy ra customerId từ email.

## 4.2. API function và headers

[authApi.ts](C:/Projects/banking-system/mobile-app/src/features/auth/services/authApi.ts) tạo:

~~~text
POST /auth/login
body: { email, password }
header: X-Device-ID
~~~

requestJson thêm X-Request-ID. Vì đây là request chưa có session, không có Authorization. Validator isLoginResponse kiểm tra JSON có đúng shape trước khi AuthContext lưu.

## 4.3. Password-only trong relational-v2

Trong HTTP route /auth/login, relational runtime gọi:

~~~text
http.ts
  → relationalHttp.loginPasswordOnly
  → RelationalAuthService.loginPasswordOnly
  → relationalHttp.issueMfaSession
  → RelationalAuthService.issueSession
~~~

Tên issueMfaSession là tên boundary cũ; với relational-v2, login customer được ghi rõ là password-only. Route /auth/verify không dùng để thêm login MFA trong relational-v2; http.ts ném invalidRequest nếu relational route đang bật. TOTP vẫn được dùng cho step-up nghiệp vụ.

## 4.4. RelationalAuthService.loginPasswordOnly

Method này nằm ở [relationalAuthService.ts](C:/Projects/banking-system/backend/src/database/relationalAuthService.ts).

Các bước bên trong UnitOfWork.transaction:

1. normalize email bằng trim/lowercase;
2. normalize deviceId và từ chối chuỗi rỗng;
3. tạo hai rate-limit key: theo email và theo device;
4. lockLoginBuckets tạo hoặc khóa các bucket;
5. nếu bucket bị block, trả rateLimited;
6. SELECT customer theo lower(email);
7. nếu không có customer, dùng DUMMY_PASSWORD thay cho việc bỏ qua bước verify;
8. verifyPasswordAsync bằng PBKDF2;
9. nếu sai, recordLoginFailure tăng attempts và có thể block;
10. nếu đúng, resetLoginBuckets và trả publicUser.

DUMMY_PASSWORD làm cho đường xử lý user không tồn tại vẫn thực hiện phép kiểm tra password tương tự, giảm rò rỉ “email này có tồn tại hay không” qua thời gian xử lý.

## 4.5. Password được lưu và kiểm tra thế nào?

[security.ts](C:/Projects/banking-system/backend/src/security.ts) dùng:

- random salt 16 bytes;
- PBKDF2 SHA-256 với 120,000 iterations;
- digest 32 bytes;
- timingSafeEqual khi so sánh.

RegistrationService lưu password_salt và password_digest vào pending_registrations, rồi copy vào customers khi complete. RelationalAuthService không lấy password từ client để so với plaintext trong database; nó derive digest mới từ password nhập vào.

## 4.6. Rate limit đăng nhập

RelationalAuthService dùng LOGIN_RATE_LIMIT_WINDOW_SECONDS, mặc định 600 giây, và LOGIN_RATE_LIMIT_MAX_ATTEMPTS, mặc định 10. Hai bucket email/device cùng bị tăng khi password sai.

SQL có SELECT ... FOR UPDATE trên rate_limit_buckets, sau đó UPDATE attempts và blocked_until. Khi request thành công, resetLoginBuckets đưa attempts về 0.

Kết quả UI:

- sai ít lần: 401 Invalid credentials;
- quá nhiều lần: 429 Too many login attempts;
- Mobile nhận ApiError và hiển thị lỗi server, không lưu session.

## 4.7. Cấp session trong issueSession

Sau khi password đúng, RelationalAuthService.issueSession:

1. tìm customer bằng customerId;
2. tạo customer_devices row với attestation PENDING;
3. tạo accessToken và refreshToken bằng createOpaqueToken;
4. tạo familyId và sessionId;
5. lưu hash token vào auth_sessions;
6. lưu refresh token hash vào refresh_session_records;
7. tạo refresh_session_families;
8. ghi audit SESSION_CREATED;
9. trả token thật cho Mobile.

Access token TTL là 15 phút. Refresh record TTL là 30 ngày. Database chỉ nhận hashOpaqueToken(token), không nhận giá trị token plaintext.

## 4.8. Câu hỏi tự kiểm tra phần 4

1. Vì sao login response không chứa password?
2. DUMMY_PASSWORD phục vụ mục đích gì?
3. Khi password sai, những bucket nào tăng attempts?
4. Customer relational-v2 có dùng /auth/verify cho login MFA không?
5. Row nào lưu hash của access token?

# 5. Access token, refresh token và đăng xuất

## 5.1. Authenticate một request

Khi Mobile gọi route đã đăng nhập:

~~~text
Authorization: Bearer accessToken
X-Device-ID: deviceId
  → http.requireBearer
  → RelationalAuthService.authenticate
~~~

authenticate hash accessToken rồi chạy query:

~~~sql
SELECT c.id, c.full_name, c.email, c.phone_number, c.created_at
FROM auth_sessions s
JOIN customers c ON c.id = s.customer_id
JOIN customer_devices d ON d.id = s.device_id
WHERE s.access_token_hash = $1
  AND s.revoked_at IS NULL
  AND s.expires_at > NOW()
  AND d.device_id = $2
  AND d.revoked_at IS NULL
~~~

Nếu không có row, trả 401 Access token is invalid or expired. Kết quả public user chỉ chứa dữ liệu customer cần cho boundary.

## 5.2. Access token hết hạn

Mobile không chờ user bấm login ngay. [httpClient.ts](C:/Projects/banking-system/mobile-app/src/services/api/httpClient.ts) khi response status 401 và RequestAuth có refreshAccessToken sẽ:

1. gọi refreshAccessTokenSingleFlight;
2. nếu nhiều request cùng gặp 401, dùng chung một Promise;
3. AuthContext.refreshSession gọi POST /auth/refresh;
4. nhận cặp token mới;
5. retry đúng request ban đầu một lần với access token mới;
6. retryOnUnauthorized = false để tránh vòng lặp vô hạn.

Nếu refresh cũng 401, isTerminalRefreshFailure trả true; AuthContext clearAuthSession và chuyển status anonymous.

## 5.3. Refresh rotation ở Backend

RelationalAuthService.refresh:

1. hash refreshToken;
2. SELECT auth_sessions + refresh_session_records + refresh_session_families bằng hash và FOR UPDATE;
3. kiểm tra device binding, revoked và expiry;
4. nếu token đã revoked/đã rotate, đánh dấu toàn bộ family revoked và trả reuse detected;
5. nếu hợp lệ, tạo accessToken/nextRefreshToken/session mới;
6. revoke session cũ và set replaced_by_session_id;
7. đánh dấu refresh record cũ revoked;
8. insert refresh record mới;
9. ghi audit REFRESH_ROTATED;
10. trả token mới.

Refresh token cũ không được dùng lại. Nếu bị dùng lại, server thu hồi family để hạn chế kẻ đã lấy token tiếp tục hoạt động.

## 5.4. Logout hiện tại và logout mọi session

POST /auth/logout nhận refreshToken + X-Device-ID. RelationalAuthService.revoke khóa session theo refresh hash, kiểm tra device, rồi revoke auth_sessions, refresh_session_families và refresh_session_records trong family.

POST /auth/logout-all trước hết gọi requireBearer để biết customerId, rồi RelationalAuthService.revokeAllSessions cập nhật mọi session của customer.

Cả hai ghi audit:

- SESSION_REVOKED cho một family;
- ALL_SESSIONS_REVOKED cho customer.

## 5.5. Logout ở Mobile có nhiều trạng thái

AuthContext.beginLogout:

1. đánh dấu session epoch invalid để refresh cũ không ghi đè state mới;
2. set status loggingOut;
3. chờ refresh đang chạy;
4. gọi revokeSession hoặc revokeAllSessions nếu còn token;
5. luôn cố clearAuthSession;
6. set anonymous;
7. tạo LogoutResult gồm localSessionCleared, remoteRevoked và recoveryIntentsPreserved.

Nếu mạng mất, app vẫn xóa local session nhưng ghi logoutNotice rằng server chưa xác nhận thu hồi remote. Điều này giúp user hiểu sự khác nhau giữa “đã rời UI” và “server đã revoke”.

## 5.6. Cold start và AppState

AuthProvider trong [AuthContext.tsx](C:/Projects/banking-system/mobile-app/src/features/auth/context/AuthContext.tsx) khi mount:

1. load device binding;
2. load AuthSession từ SecureStore;
3. nếu không có session, status anonymous;
4. nếu có session, trước tiên status locked;
5. gọi refreshSession để server xác nhận và rotate;
6. chỉ sau khi xác nhận mới chuyển authenticated.

Khi AppState rời active, session được đặt locked. Khi app active lại, refreshSession chạy. RootNavigator không hiển thị màn hình tài chính trong status locked.

## 5.7. Session storage trên Mobile

[authSessionStorage.ts](C:/Projects/banking-system/mobile-app/src/features/auth/storage/authSessionStorage.ts):

- lưu một record v2 gồm accessToken, refreshToken, accessTokenExpiresAt, sessionEpoch và user;
- dùng Expo SecureStore với WHEN_UNLOCKED_THIS_DEVICE_ONLY;
- có mutation queue để tránh hai ghi/xóa chồng nhau;
- migrate dữ liệu ba-key legacy;
- xóa record nếu JSON sai shape;
- clearAuthSession xóa v2 và legacy keys.

Đây là lý do session không nằm trong AsyncStorage thông thường.

## Câu hỏi tự kiểm tra phần 5

1. Server kiểm tra deviceId ở query authenticate bằng cột nào?
2. Vì sao refresh token rotation cần revoke token cũ?
3. Nếu refresh token đã bị rotate nhưng bị gửi lại thì điều gì xảy ra?
4. Mobile retry 401 tối đa bao nhiêu lần?
5. Vì sao cold start bắt đầu ở status locked?

# 6. Authorization và quyền sở hữu dữ liệu

## 6.1. CustomerId đáng tin cậy lấy từ đâu?

Với route đã authenticate, customerId trong service đến từ:

~~~text
accessToken + X-Device-ID
  → RelationalAuthService.authenticate
  → AuthUser.id
  → http.requireBearer trả userId
  → RelationalHttpBoundary method(customerId, ...)
~~~

Body/path chỉ cung cấp resourceId như accountId, transactionId hoặc quoteId. Chúng không được thay thế customerId từ session.

## 6.2. Xem danh sách tài khoản

Route GET /accounts:

~~~text
Mobile accounts API
  → http.requireBearer → userId = C001
  → RelationalHttpBoundary.listAccounts(C001)
  → RelationalAccountReadService.listAccounts
  → AccountRepository.findAccountsByCustomer(C001)
  → SELECT payment_accounts WHERE customer_id = $1
~~~

Danh sách chỉ chứa account thuộc C001. Nếu Mobile sửa local state để hiển thị account của C002, request server vẫn không trả account đó.

## 6.3. Xem một account bằng accountId

AccountRepository.findOwnedAccount dùng query có cả hai điều kiện:

~~~sql
SELECT *
FROM payment_accounts
WHERE id = $1
  AND customer_id = $2
~~~

Service gọi query này trước khi:

- getAccountNumber;
- listTransactions;
- getTransaction;
- các thao tác đọc account detail.

Nếu account tồn tại nhưng customer_id khác, service xem như không tìm thấy/không được phép. Cách này ngăn IDOR: attacker đoán UUID không thể biến thành quyền đọc.

## 6.4. Lịch sử transaction và transaction detail

RelationalAccountReadService.listTransactions nhận customerId, accountId, cursor và limit. Nó:

1. validate limit/cursor;
2. findOwnedAccount(customerId, accountId);
3. gọi AccountRepository.listAccountTransactions;
4. map row sang Transaction;
5. trả items và nextCursor.

getTransaction cũng kiểm tra ownership trước khi tìm transactionId. Không được query transaction chỉ bằng transactionId vì transactionId riêng lẻ không chứng minh account ownership.

## 6.5. Beneficiary và recipient lookup

RelationalBeneficiaryService nhận customerId từ boundary:

- list(customerId);
- get(customerId, beneficiaryId);
- create(customerId, input);
- rename(customerId, beneficiaryId, displayName);
- remove(customerId, beneficiaryId).

BeneficiaryRepository phải lọc customer_id khi đọc/sửa. Recipient lookup cũng gắn customerId, token hash, destination owner và expiry. Account number tra cứu không tạo quyền xem toàn bộ customer đích.

## 6.6. Transfer ownership

RelationalTransferService.createQuote nhận customerId + sourceAccountId + beneficiary/lookup. Nó kiểm tra:

- customer có quyền với source account;
- destination hợp lệ;
- source khác destination;
- account status ACTIVE;
- control policy cho phép;
- amount trong giới hạn.

submit nhận customerId, quoteId, requestFingerprint và idempotencyKey. Quote được khóa và phải thuộc customer đó; source/destination account cũng được lock và kiểm tra ownership/status trước khi ghi transfer.

## 6.7. Customer lock ở control plane

http.ts có option customerAccessStatus. Sau requireBearer, server gọi gate này. Nếu Admin đã khóa customer, route trả Unauthorized trước khi gọi service nghiệp vụ.

Database migration 019 thêm customers.access_status và history. Admin không sửa trực tiếp từ UI; thao tác lock/unlock đi qua AdminActionEngine và action policy.

## 6.8. Authorization không chỉ là 401

- 401: chưa xác thực hoặc session/token không hợp lệ;
- 403: thường dùng cho origin/permission boundary;
- 409: request xác thực nhưng conflict nghiệp vụ, ví dụ step-up sai, self-approval, stale action;
- 429: rate limit.

Mobile/Admin hiển thị thông báo theo status/code. Một permission failure không nên bị biến thành “mạng lỗi”.

## Câu hỏi tự kiểm tra phần 6

1. customerId trong listAccounts đến từ body hay access token?
2. Vì sao query payment_accounts cần cả id và customer_id?
3. Nếu biết transactionId của người khác, vì sao vẫn không được xem detail?
4. Khi customer bị Admin khóa, request bị chặn ở đâu?
5. 401, 403, 409 và 429 khác nhau thế nào trong project?




# 7. MFA và step-up cho thao tác nhạy cảm

## 7.1. Mô hình một challenge

Một row auth_challenges không chỉ chứa “mã OTP”. Nó chứa context mà proof phải khớp:

- customer_id;
- device_id;
- method;
- purpose;
- resource_id;
- request_fingerprint;
- expires_at;
- attempts/max_attempts;
- status;
- credential_id nếu là TOTP.

Purpose cho customer gồm REGISTRATION_EMAIL_VERIFY, LOGIN, TRANSFER, SAVINGS_OPENING, CREDIT_APPLICATION, CARD_ACTIVATION, CREDIT_PAYMENT, CARD_UNLOCK, CARD_REPORT_LOST, MFA_FACTOR_CHANGE, MFA_FACTOR_REMOVAL và RECOVERY_CODE_ROTATION.

Vì challenge gắn với resource và fingerprint, mã TOTP đúng cho quote A không được dùng để submit quote B.

## 7.2. Tạo challenge TOTP

Mobile gọi createMfaChallenge trong authApi, route POST /auth/otp/challenges. HTTP layer:

1. yêu cầu bearer session;
2. kiểm tra purpose nằm trong allowlist;
3. lấy resourceId nếu có;
4. lấy requestFingerprint từ quote/service khi route relational-v2;
5. gọi PersistentMfaService.beginTotpChallenge.

beginTotpChallenge:

1. tìm credential TOTP ACTIVE;
2. rate limit theo customer + purpose, device và network;
3. cancel các challenge active cũ cùng customer/device/purpose/resource/fingerprint;
4. tạo opaque challengeId và lưu hash;
5. lưu expiresAt 5 phút, method TOTP, maxAttempts 5;
6. trả challengeId, method TOTP và expiresAt.

HTTP không để client tự đặt fingerprint cho transfer relational; nó lấy fingerprint từ quote qua getTransferStepUpRequestFingerprint.

## 7.3. Xác minh challenge

Khi submit command, verifyPersistentStepUp trong http.ts yêu cầu body:

~~~json
{
  "stepUp": {
    "method": "TOTP",
    "challengeId": "challenge-demo",
    "proof": "123456"
  }
}
~~~

Method này:

1. yêu cầu stepUp là object;
2. chỉ chấp nhận method TOTP;
3. yêu cầu challengeId và proof;
4. lấy X-Device-ID;
5. tính requestFingerprint theo purpose/resource;
6. gọi PersistentMfaService.verifyChallenge;
7. kiểm tra result.customerId khớp userId;
8. đăng ký external step-up verification cho in-memory compatibility khi cần.

PersistentMfaService.verifyChallenge:

- hash challengeId;
- lock challenge;
- kiểm tra expiry, status ACTIVE, customer/device/purpose/resource/fingerprint;
- lock credential;
- decrypt TOTP secret;
- validateTotp với cửa sổ lệch tối đa 1 time step;
- gọi MfaRepository.acceptTotpStep;
- nếu hợp lệ, consume challenge và ghi MFA_VERIFY_SUCCEEDED;
- nếu sai, recordChallengeFailure; mã hợp lệ nhưng time step đã dùng được ghi MFA_REPLAY_DETECTED.

Mã replay trả code MFA_REPLAY_DETECTED. Step-up nghiệp vụ thất bại trả STEP_UP_VERIFICATION_FAILED hoặc 401 tùy nhánh lỗi.

## 7.4. Vì sao cần acceptTotpStep?

TOTP cùng một time step có thể được gửi lại nhiều lần. MfaRepository.acceptTotpStep cập nhật last_accepted_time_step theo điều kiện chỉ nhận time step mới hơn. Nhờ đó:

~~~text
mã TOTP đúng lần đầu
  → accept time step → consume challenge → thành công

gửi lại đúng mã trong cùng time step
  → acceptTotpStep false
  → MFA_REPLAY_DETECTED
~~~

TOTP secret được mã hóa envelope bằng KeyEncryptionPort; migration [014_mfa_credentials.sql](C:/Projects/banking-system/backend/database/014_mfa_credentials.sql) yêu cầu material TOTP có ciphertext/key id và SHA1/6 digits/30 seconds theo constraint hiện tại.

## 7.5. Trace chuyển tiền với step-up

Luồng thật rút gọn:

~~~text
Mobile tạo quote
  → POST /transfers/quote
  → transfer_quotes
  → Mobile gọi POST /auth/otp/challenges purpose TRANSFER, resourceId=quoteId
  → PersistentMfaService.beginTotpChallenge
  → Mobile nhập TOTP
  → POST /transfers với stepUp + Idempotency-Key
  → http.verifyPersistentStepUp
  → RelationalTransferService.submit
  → khóa quote + hai account
  → kiểm tra ownership/status/fingerprint/expiry
  → ghi transfer, balance, ledger, audit, outbox
~~~

Ở POST /transfers, server bắt buộc Idempotency-Key ít nhất 16 ký tự. Service không nhận số tiền mới từ request submit; số tiền được lấy từ quote đã tạo và fingerprint phải trùng.

## 7.6. Các thao tác khác dùng cùng cơ chế

| Purpose | Resource/fingerprint | Command sau verify |
| --- | --- | --- |
| SAVINGS_OPENING | savings quote id + quote fingerprint | submitSavingsOpening |
| CREDIT_APPLICATION | request fingerprint của requestedLimit | submitCreditApplication |
| CARD_ACTIVATION | application id fingerprint | activateCreditApplication |
| CREDIT_PAYMENT | payment quote id + quote fingerprint | submitCreditPayment |
| CARD_UNLOCK | card id fingerprint | unlock card |
| CARD_REPORT_LOST | card id + action REPORT_LOST | report lost |
| MFA_FACTOR_CHANGE | null + lifecycle context | enroll TOTP mới |
| MFA_FACTOR_REMOVAL | credential id/lifecycle proof | revoke credential |
| RECOVERY_CODE_ROTATION | lifecycle challenge | rotate recovery codes |

## 7.7. TOTP enrollment

MFA screen gọi POST /auth/mfa/totp/enroll với current password. HTTP:

1. authenticate customer;
2. verify current password;
3. nếu đã có credential ACTIVE, yêu cầu challenge MFA_FACTOR_CHANGE;
4. gọi PersistentMfaService.beginTotpEnrollment.

beginTotpEnrollment tạo secret, encrypt và lưu credential PENDING, ghi MFA_ENROLLMENT_STARTED, rồi trả manualSetupKey và otpauthUri.

POST /auth/mfa/totp/confirm nhận credentialId + code. confirmTotpEnrollment:

- kiểm tra credential thuộc customer và còn PENDING;
- kiểm tra chưa quá 10 phút;
- decrypt secret và validate TOTP;
- activate credential;
- revoke recovery codes cũ;
- sinh 10 recovery codes;
- chỉ trả plaintext recovery codes cho lần này;
- ghi MFA_ENROLLED.

Sau khi confirm, HTTP revokeAllSessions để các session cũ phải xác thực lại.

## 7.8. Recovery code và mất Authenticator

MfaRecoveryScreen gọi:

~~~text
email + password + recovery code
  → POST /auth/mfa/recover
  → verifyRecoveryCode
  → consume một recovery code
  → revoke các code còn lại
  → tạo mfa_recovery_requests cooldown
  → revokeAllSessions
~~~

Sau cooldown, recoveryToken one-time cho phép completeRecovery và beginRecoveryTotpEnrollment. Service không chấp nhận bearer session làm thay recovery proof.

Recovery code chỉ lưu digest + salt trong mfa_recovery_codes. Một code đã USED không thể dùng lại.

## 7.9. Đổi/xóa MFA

MFA methods screen:

- listMfaMethods đọc credential summary, không trả secret;
- begin enroll yêu cầu current password và có thể yêu cầu factor change;
- revokeMfaMethod yêu cầu current password và challenge MFA_FACTOR_REMOVAL;
- không cho xóa factor ACTIVE cuối cùng, lỗi MFA_LAST_FACTOR;
- sau thay đổi thành công revokeAllSessions.

Đây là ví dụ “authorization theo hành động”: customer có quyền vào màn hình MFA nhưng từng thay đổi vẫn cần proof riêng.

## 7.10. Câu hỏi tự kiểm tra phần 7

1. Vì sao challenge phải chứa purpose và resourceId?
2. TOTP đúng nhưng replay trong cùng time step bị chặn ở method nào?
3. Ai tạo requestFingerprint của transfer?
4. Vì sao submit transfer vẫn cần Idempotency-Key sau khi đã có step-up?
5. Sau khi enroll hoặc remove MFA, tại sao server revoke all sessions?

# 8. Mobile giữ và gửi thông tin xác thực

## 8.1. AuthContext là state machine

AuthContext có các status:

~~~text
booting
  → anonymous hoặc locked
locked
  → refreshing
  → authenticated hoặc anonymous
authenticated
  → loggingOut
  → anonymous
~~~

RootNavigator trong [app/_layout.tsx](C:/Projects/banking-system/mobile-app/src/app/_layout.tsx) chỉ mở nhóm tab tài chính khi isAuthenticated = status authenticated và session khác null.

Nếu status locked, app hiển thị “Dữ liệu đang được bảo vệ” và chỉ cho thử refresh hoặc logout. Cached balance không được hiển thị chỉ vì SecureStore còn session cũ.

## 8.2. HTTP headers từ Mobile

requestJson trong [httpClient.ts](C:/Projects/banking-system/mobile-app/src/services/api/httpClient.ts) tạo:

- Authorization: Bearer accessToken nếu request có auth;
- X-Device-ID nếu có deviceId;
- X-Request-ID cho trace;
- Idempotency-Key nếu caller truyền;
- Content-Type application/json khi có body.

Mỗi API feature không tự viết fetch riêng. authApi, account API, transfer API dùng chung requestJson để có timeout, abort, response validation và xử lý 401 nhất quán.

## 8.3. 401 và single-flight refresh

Khi một API trả 401:

~~~text
requestJson
  → refreshAccessTokenSingleFlight
  → AuthContext.refreshAccessToken
  → refreshSession
  → authApi.refreshSession
  → /auth/refresh
  → saveAuthSession
  → retry request một lần
~~~

WeakMap trong httpClient dedupe refresh theo callback. Map trong AuthContext dedupe theo sessionEpoch. Hai lớp này ngăn 10 request đồng thời tạo 10 refresh rotation.

## 8.4. Session epoch tránh race condition

AuthContext lưu sessionEpoch cho mỗi session. refreshSession kiểm tra:

- status chưa loggingOut;
- epoch chưa invalidated;
- sessionRef vẫn là epoch đang refresh.

Nếu user bấm logout trong lúc refresh, kết quả refresh cũ không được ghi đè session mới đã bị xóa. Đây là lý do code có invalidatedSessionEpochsRef và sessionLifecycleEpochRef.

## 8.5. Timeout, offline và response sai

requestJson phân biệt:

- TIMEOUT khi AbortController hết thời gian;
- REQUEST_ABORTED khi caller hủy;
- NETWORK_ERROR khi fetch không kết nối;
- INVALID_RESPONSE khi JSON/shape sai;
- ApiError có status/code/message/traceId khi server trả lỗi chuẩn.

Response validator như isLoginResponse, isRefreshTokenResponse, isAuthChallengeResponse bảo vệ Mobile khỏi việc coi JSON bất kỳ là session hợp lệ.

## 8.6. HTTPS và sandbox HTTP

[config.ts](C:/Projects/banking-system/mobile-app/src/services/api/config.ts):

- development không cấu hình API URL thì dùng http://10.0.2.2:5000/api/v1;
- production phải có EXPO_PUBLIC_API_URL;
- production chỉ cho HTTPS, trừ khi cờ sandbox đã được bật theo contract;
- URL phải là http/https hợp lệ.

Cờ EXPO_PUBLIC_SANDBOX_HTTP chỉ dành cho sandbox local; không được dùng để biến production-like thành cleartext.

## 8.7. Mobile logout và UI

ProfileScreen gọi logout hoặc logoutAll từ AuthContext. AuthContext cố revoke remote rồi luôn clear SecureStore. Nếu remote revoke thất bại, logoutNotice hiển thị cảnh báo; RootNavigator vẫn đưa UI về anonymous.

Recovery codes được giữ trong pendingRecoveryCodes sau khi remove/rotate MFA để user phải xem/xác nhận. clearPendingRecoveryCodes xóa chúng khỏi state sau khi user đã acknowledge.

## Câu hỏi tự kiểm tra phần 8

1. Vì sao app có status locked thay vì hiển thị ngay dữ liệu cache?
2. X-Device-ID được tạo và lưu ở file nào?
3. Tại sao refresh có cả sessionEpoch và single-flight?
4. requestJson retry 401 mấy lần để tránh vòng lặp?
5. Cờ sandbox HTTP nên dùng trong môi trường nào?

# 9. Admin authentication, permission và four-eyes

## 9.1. Admin có boundary riêng

Admin API chạy qua [adminServer.ts](C:/Projects/banking-system/backend/src/adminServer.ts), dùng StaffAuthService, AdminActionEngine và AdminRepository. Admin Web gọi cùng-origin /api/v1 bằng [admin-web/src/api.ts](C:/Projects/banking-system/admin-web/src/api.ts).

Customer token không dùng cho Admin. Admin session có cookie, staff identity, role/permission và CSRF token riêng.

## 9.2. Staff invite và activation

StaffAuthService.invite:

1. normalize email;
2. validate employee code;
3. tạo invite token;
4. lưu token hash trong staff_invites;
5. expiry 24 giờ;
6. trả token cho delivery boundary.

StaffAuthService.activate:

1. hash password tối thiểu 12 ký tự;
2. activate staff user;
3. tạo hoặc nhận TOTP secret;
4. encrypt secret bằng KeyEncryptionPort;
5. lưu staff_mfa_credentials;
6. ghi audit STAFF_INVITE_ACTIVATED.

Admin invite delivery đi qua AdminInvitationProvider; token không ghi log hoặc trả trong health.

## 9.3. Staff login gồm hai bước

Admin Web POST /admin/auth/login gửi email/password. StaffAuthService.beginLogin:

- giới hạn tối đa 5 lỗi trong 10 phút ở process memory;
- tìm staff active;
- verifyPasswordAsync;
- yêu cầu có MFA credential;
- tạo staff_auth_challenges LOGIN, expiry 5 phút;
- trả challengeId.

Admin Web POST /admin/auth/mfa/verify gửi challengeId + code. verifyLoginMfa:

- kiểm tra challenge chưa consume/chưa hết hạn;
- decrypt staff TOTP secret;
- validateTotp;
- reject replay qua acceptMfaTimeStep;
- consume challenge;
- createSession;
- ghi STAFF_LOGIN audit.

## 9.4. Cookie, CSRF và session

StaffAuthService.createSession tạo accessToken, refreshToken, csrfToken và lưu hash trong staff_sessions.

adminHttp.setAuthCookies đặt:

- access cookie HttpOnly;
- refresh cookie HttpOnly;
- csrf cookie không HttpOnly để JavaScript đọc;
- Secure tùy secureCookies;
- SameSite=Strict.

Admin Web adminFetch dùng credentials include. Với POST/DELETE, nó thêm X-CSRF-Token. adminHttp.verifyCsrf hash giá trị header và so với staff_sessions.csrf_token_hash.

## 9.5. Staff authenticate và timeout

StaffAuthService.authenticate:

1. hash access cookie;
2. tìm staff_sessions;
3. kiểm tra revokedAt;
4. kiểm tra idleExpiresAt và absoluteExpiresAt;
5. tìm staff user;
6. kiểm tra status ACTIVE;
7. so authorizationVersion giữa staff và session;
8. touch idle expiry;
9. trả AdminSubject.

Idle timeout là 15 phút, absolute timeout là 8 giờ. Nếu staff bị disable hoặc authorizationVersion đổi, session cũ bị vô hiệu hóa.

## 9.6. Permission registry

[permissionRegistry.ts](C:/Projects/banking-system/backend/src/admin/authorization/permissionRegistry.ts) định nghĩa ADMIN_ROUTES và permission như:

- customer.read;
- account.read;
- kyc.read/kyc.decision.request/kyc.decision.approve;
- transfer.read/transfer.action.request/transfer.action.approve;
- audit.read;
- staff.role-change.request/approve.

[authorization.ts](C:/Projects/banking-system/backend/src/admin/authorization/authorization.ts):

- requireStaffSession kiểm tra subject tồn tại và ACTIVE;
- requirePermission gọi hasPermission;
- requireFreshStepUp yêu cầu MFA gần đây tối đa 5 phút.

Route state-changing cần permission và CSRF. UI ẩn tab chỉ là trải nghiệm; route vẫn kiểm tra ở server.

## 9.7. Four-eyes và AdminActionEngine

AdminActionEngine.create:

1. yêu cầu request permission;
2. validate field được phép;
3. đọc target và expected version/status;
4. tạo requestFingerprint;
5. insert admin_action_requests với idempotency key;
6. ghi ADMIN_ACTION_CREATED ở trạng thái PENDING_APPROVAL.

AdminActionEngine.approve:

1. tìm action;
2. cấm requester tự approve;
3. yêu cầu approval permission;
4. yêu cầu requireFreshStepUp;
5. so fingerprint;
6. so version để phát hiện stale;
7. ghi decision;
8. execute action trong repository;
9. ghi audit ADMIN_ACTION_APPROVED.

Nếu process chết sau decision nhưng trước execution, approval retry được thiết kế idempotent. Nếu target đã đổi version, trả ACTION_STALE.

## 9.8. RLS và phạm vi case

Migrations [023_admin_roles_rls_and_domain_adapters.sql](C:/Projects/banking-system/backend/database/023_admin_roles_rls_and_domain_adapters.sql) bật Row-Level Security cho kyc_applications, credit_applications, case_assignments, case_internal_notes và admin_action_requests.

Có ba lớp:

~~~text
staff session
  → permission registry: được làm action nào
  → caseScope/RLS: được thấy row nào
  → AdminActionEngine: action có đúng policy/fingerprint/version không
~~~

CONTROL/ADMIN có phạm vi rộng hơn; SUPPORT/OPERATIONS chỉ thấy phạm vi được policy cho phép. AdminRepository vẫn append audit cho customer read, account read và command.

## 9.9. Admin Web hiển thị lỗi bảo mật

admin-web/src/App.tsx ánh xạ:

- 401 → staff session hết hạn;
- 403 hoặc ADMIN_PERMISSION_DENIED → không có quyền;
- ACTION_STALE → dữ liệu đã đổi, cần tải lại;
- ACTION_ALREADY_DECIDED → người khác đã xử lý.

Nhờ code lỗi rõ, UI không gọi mọi lỗi thành “không kết nối được”.

## Câu hỏi tự kiểm tra phần 9

1. Vì sao Admin dùng cookie/CSRF còn Mobile dùng bearer/device header?
2. Staff login cần password và TOTP ở những method nào?
3. authorizationVersion dùng để vô hiệu hóa tình huống nào?
4. Vì sao maker không được tự approve action?
5. RLS khác permission registry ở đâu?




# 10. Rate limit, secret, audit và các lớp bảo vệ khác

## 10.1. Rate limit theo mục đích

Rate limit không chỉ có một bộ đếm.

| Luồng | Bucket/cơ chế | Mục tiêu |
| --- | --- | --- |
| Customer login | email + device, rate_limit_buckets | giảm password guessing |
| Registration | HMAC network fingerprint | giảm spam đăng ký mà không lưu IP thô |
| MFA challenge | customer + purpose, device, network | giảm spam TOTP/challenge |
| MFA resend | subject + cooldown | giảm gửi email lặp |
| Admin login | email trong StaffAuthService | giảm thử password staff |
| Step-up | challenge attempts/max_attempts | khóa challenge sai nhiều lần |

MfaRepository.atomicRateLimit dùng INSERT ... ON CONFLICT và khóa bucket trong transaction. RelationalAuthService.lockLoginBuckets cũng khóa bucket trước khi đọc attempts.

## 10.2. Network fingerprint đăng ký

security.ts có computeRegistrationNetworkFingerprint:

1. chuẩn hóa IPv4/IPv6;
2. đổi IPv4-mapped IPv6 về IPv4;
3. dùng sentinel cho địa chỉ thiếu/sai;
4. HMAC-SHA256 với REGISTRATION_FINGERPRINT_KEY;
5. trả hex 64 ký tự.

Key phải có prefix base64:, decode ít nhất 32 bytes, canonical padding và không toàn số 0. Server validate key trong readRuntimeConfig trước khi mở listener.

Mục đích là rate limit theo dấu vết ổn định mà không ghi IP thô vào bucket nghiệp vụ.

## 10.3. Runtime guard

[runtimeConfig.ts](C:/Projects/banking-system/backend/src/runtimeConfig.ts) kiểm tra trước startup:

- BANKING_MONEY_MODE phải là virtual;
- production-like bắt buộc PostgreSQL và relational-v2;
- DATABASE_SSL_MODE phải verify-full;
- secret provider phải managed;
- BANKING_MFA_REQUIRED phải là 1;
- chỉ TOTP được phép ở staging/production-like;
- BANKING_ALLOWED_ORIGINS không được wildcard;
- deterministic sandbox OTP không được bật;
- BUILD_COMMIT_SHA và IMAGE_DIGEST phải có dạng hợp lệ;
- BANKING_RELATIONAL_HTTP_ROUTES không được dùng trong production-like.

Điểm cần nhớ: đây là reference system virtual money. Những guard này ngăn cấu hình nguy hiểm, nhưng không biến project thành hệ thống tiền thật.

## 10.4. Origin, CORS và HTTPS

Public HTTP và Admin HTTP kiểm tra allowed origins. Admin còn kiểm tra sec-fetch-site để chặn cross-site không nằm trong allowlist. Admin response thêm:

- Cache-Control no-store;
- X-Content-Type-Options nosniff;
- Content-Security-Policy;
- Referrer-Policy no-referrer.

Mobile config bắt production API dùng HTTPS. Admin cookie Secure phụ thuộc môi trường; development có cookie tên không có __Host- để chạy local, còn secure runtime dùng __Host-admin_access và __Host-admin_refresh.

## 10.5. Secret provider và encryption keyring

server.ts ở PostgreSQL runtime lấy:

- database URL từ SecretProvider;
- MFA encryption key current/previous;
- OTP pepper current/previous;
- email provider.

PersistentMfaService dùng KeyEncryptionPort để encrypt/decrypt TOTP secret. OtpDigestKeyring dùng pepper/key id để digest OTP. Code chỉ ghi key id/version/metadata khi cần rotate, không ghi secret plaintext.

Migrations 026–028 giữ metadata/checkpoint/DR marker cho secret rotation và recovery; không phải bảng để client đọc secret.

## 10.6. Audit thường và security event

Có hai dòng bằng chứng:

- audit_events: customer registered, session created/revoked, transfer, Admin action;
- auth_security_events: MFA verify fail/succeed, replay, recovery, challenge failure, security risk.

Audit payload phải redact. Token, password, OTP, PIN, CVV và secret không được đưa vào log, analytics hoặc audit.

http.ts có PERSISTED_SECURITY_FAILURE_AUDIT_EVENTS gồm STEP_UP_VERIFICATION_FAILED và CREDIT_STEP_UP_VERIFICATION_FAILED. Khi request nghiệp vụ bị reject, HTTP layer giữ lại các trạng thái bảo vệ abuse như auth challenge, rate window, refresh family và security audit, trong khi rollback phần business aggregate không nên commit.

## 10.7. Error mapping và không làm lộ thông tin

Backend trả DomainError gồm status, code, message, fieldErrors và traceId. Mobile ApiError giữ status/code/traceId để UI chọn message.

Một số thông báo cố ý chung:

- Invalid credentials không nói email có tồn tại hay không;
- refresh token invalid không nói row nào sai;
- MFA challenge invalid/expired dùng message chung;
- customer bị khóa trả Unauthorized ở customer HTTP boundary.

Mục tiêu là người gọi không thể dùng message để dò dữ liệu nhạy cảm.

## 10.8. Kiểm tra bằng test nào?

Một số test liên quan:

- backend/src/tests/security.test.ts: validate fingerprint key, HMAC network fingerprint, không leak secret trong error;
- backend/src/tests/authContract.test.ts: contract auth/login/refresh/logout;
- backend/src/tests/authRelational.test.ts: RelationalAuthService và session rows;
- backend/src/tests/mfaPersistence.test.ts: credential/challenge/replay/recovery;
- backend/src/tests/registrationRelational.test.ts: pending registration, completion, retry;
- backend/src/tests/http-security-persistence.test.ts: failed-login rate limit và refresh-family revocation sống qua restart;
- backend/src/tests/adminAuth.test.ts: staff password/MFA/session;
- backend/src/tests/adminP0.e2e.test.ts và adminWorkflow.test.ts: permission/four-eyes/action;
- mobile-app/src/features/auth/context/__tests__/AuthContext.test.tsx: boot/refresh/logout race;
- mobile-app/src/services/api/__tests__/httpClient.test.ts: 401 retry, timeout, invalid response;
- mobile-app/src/features/auth/storage/__tests__/authSessionStorage.test.ts: SecureStore migration/clear.

Khi đọc test, hãy ghi câu “test này chứng minh điều gì?” thay vì chỉ nhìn tên test.

## 10.9. Giới hạn của bằng chứng

Một test có thể chứng minh một method không nhận token đã revoke; nó không tự chứng minh TLS của môi trường staging. Hãy phân biệt:

- unit test: một hàm/class;
- integration test: service + repository/database;
- HTTP test: route/status/header;
- Mobile test: state/UI client;
- staging/device evidence: runtime thật.

README và AGENTS nhắc rằng đây là reference sandbox. Không kết luận production readiness chỉ từ việc test local pass.

## Câu hỏi tự kiểm tra phần 10

1. Vì sao rate limit registration dùng HMAC fingerprint thay vì key raw IP?
2. Production-like bắt buộc những guard nào đáng chú ý?
3. OTP digest và TOTP secret được bảo vệ bằng cơ chế giống nhau không?
4. audit_events khác auth_security_events ở mục đích nào?
5. Tại sao HTTP phải giữ security state khi business state bị rollback?

# 11. Kiểm tra tổng hợp

## Bài 1 — Token hết hạn khi xem account

**Dữ liệu giả:** Mobile có access token hết hạn, refresh token còn hạn, deviceId D001. User mở account A001.

Hãy trace:

~~~text
AccountScreen
  → requestJson GET /accounts
  → Backend trả 401
  → AuthContext.refreshAccessToken
  → POST /auth/refresh
  → RelationalAuthService.refresh
  → saveAuthSession token mới
  → retry GET /accounts một lần
~~~

Câu hỏi:

1. Refresh route dùng refresh token hay access token?
2. Vì sao retry không lặp vô hạn?
3. Nếu refresh trả 401, status Mobile chuyển thành gì?

Gợi ý: refresh token được hash để tra refresh_session_records; retryOnUnauthorized bị tắt ở lần retry; 401 terminal làm clear session và anonymous.

## Bài 2 — Đọc account của người khác

**Dữ liệu giả:** token thuộc C001; path chứa accountId A999 thuộc C002.

Hãy tìm điểm chặn:

1. requireBearer lấy customerId nào?
2. method nào query ownership?
3. có trả payment row của C002 không?

Gợi ý: userId đến từ authenticate(token, deviceId) là C001; AccountRepository.findOwnedAccount dùng id + customer_id; không có hàng phù hợp.

## Bài 3 — OTP đăng ký bị replay

**Tình huống:** OTP đã verify thành công, request verify thứ hai gửi cùng challengeId/proof/device.

Hãy dự đoán:

1. challenge status trước request thứ hai;
2. method nào đọc status;
3. customer/account có được tạo thêm không.

Gợi ý: challenge đã CONSUMED; verifyChallenge không đi tiếp tới complete; registration_completions cũng là lớp idempotent thứ hai.

## Bài 4 — Transfer dùng challenge của quote khác

**Tình huống:** challenge được tạo cho quote Q1, request submit gửi quoteId Q2 nhưng vẫn dùng proof đúng.

Gợi ý trace:

~~~text
challenge.resourceId = Q1
  → getTransferStepUpRequestFingerprint(Q2)
  → verifyChallenge so resourceId/fingerprint
  → context mismatch
  → không gọi RelationalTransferService.submit
~~~

Câu hỏi:

1. Vì sao chỉ kiểm tra TOTP đúng là chưa đủ?
2. RequestFingerprint gắn với dữ liệu nào?
3. Có tạo transfer row không?

## Bài 5 — Refresh token reuse

**Tình huống:** R1 đã được rotate thành R2; kẻ xấu gửi lại R1.

Hãy dự đoán:

1. server trả status/code nào;
2. family/session nào bị revoke;
3. R2 có dùng tiếp được không.

Gợi ý: RelationalAuthService.refresh trả 401 Refresh token reuse detected và revoke toàn bộ family; test http-security-persistence chứng minh trạng thái vẫn bị revoke sau restart.

## Bài 6 — Admin tự approve

**Tình huống:** staff S001 tạo action khóa account, sau đó chính S001 gọi approve.

Gợi ý: AdminActionEngine.approve ghi ADMIN_SELF_APPROVAL_ATTEMPT và trả SELF_APPROVAL_FORBIDDEN trước execution.

## Bài 7 — Admin session stale

**Tình huống:** staff role bị đổi làm authorizationVersion tăng, browser vẫn giữ cookie cũ.

Hãy trả lời:

1. StaffAuthService.authenticate so sánh những gì?
2. Admin Web nhận code nào?
3. User cần login lại hay chỉ refresh?

Gợi ý: session authorizationVersion cũ không khớp staff mới; session bị invalidated, thường cần login lại.

## Bài 8 — Mất Authenticator

**Tình huống:** customer mất app TOTP nhưng còn recovery code giả RCV001.

Luồng mong đợi:

~~~text
MfaRecoveryScreen
  → POST /auth/mfa/recover
  → verifyRecoveryCode
  → consume RCV001 + revoke codes còn lại
  → cooldown
  → completeRecovery
  → revoke TOTP credentials
  → begin/confirm recovery TOTP
  → cấp recovery codes mới
~~~

Câu hỏi:

1. Vì sao không cho dùng bearer session để thay recovery proof?
2. Vì sao các recovery code còn lại bị revoke ngay khi một code thành công?
3. Session cũ bị xử lý ra sao?

## Bài 9 — Tự lập bảng “identity vs permission”

Điền ví dụ:

| Tình huống | Authentication evidence | Authorization evidence |
| --- | --- | --- |
| Xem account | access token + device | payment_accounts.customer_id |
| Chuyển tiền | access token + device + TOTP | quote/customer/source ownership/policy |
| Admin xem KYC | staff cookie + session | permission + RLS/case scope |
| Approve KYC | staff session | approval permission + fresh step-up + khác requester |

Nếu một ô trống, quay lại section tương ứng và tìm method thật.

## Bài 10 — Checklist khi thêm một chức năng nhạy cảm

Nếu sau này thêm một command mới, hãy tự hỏi:

1. Route lấy customer/staff identity từ đâu?
2. Token/device/session được kiểm tra ở đâu?
3. Resource ownership hoặc case scope được kiểm tra ở đâu?
4. Có cần challenge purpose mới không?
5. requestFingerprint bao gồm field nào?
6. Idempotency key và replay xử lý thế nào?
7. Database FK/check/unique bảo vệ thêm gì?
8. Audit/security event nào được ghi?
9. 401/403/409/429/5xx được Mobile/Admin hiển thị ra sao?
10. Test nào chứng minh happy path và failure path?

## Kết luận học tập

Sau Giai đoạn 8, hãy tự nói thành lời ba câu:

- “Server biết tôi là customer nào vì nó hash access token, kiểm tra session/device rồi lấy AuthUser.id.”
- “Tôi chỉ được đọc account khi service dùng customerId từ session để kiểm tra ownership.”
- “TOTP step-up chỉ hợp lệ khi challenge còn active và đúng customer, device, purpose, resource, fingerprint; proof đúng nhưng context sai vẫn bị từ chối.”

Nếu giải thích được ba câu đó bằng tên file và method trong tài liệu, bạn đã nối được database của Giai đoạn 7 với security boundary của toàn hệ thống.

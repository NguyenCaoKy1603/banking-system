# Giai đoạn 6 — Vì sao luồng chính được thiết kế như vậy?

Luồng chính dùng để học: **chuyển tiền nội bộ từ Mobile qua Backend tới PostgreSQL**, sau đó liên hệ tiết kiệm, tín dụng và phê duyệt Admin.

Đối chiếu source tại HEAD **9c585ce**, ngày **20/09/2026**. Tài liệu này giải thích quyết định có thể quan sát từ code. Khi nói một thiết kế “giúp” điều gì, đó là phân tích tác dụng, không khẳng định đã biết suy nghĩ của tác giả. Không có thay đổi code, cấu hình, dữ liệu hoặc feature trong lần soạn này.

Nên đọc M07 của [giaidoan5.md](C:/Projects/banking-system/giaidoan5.md) trước. Mỗi mục dưới trả lời: **vấn đề → bằng chứng code → lợi ích → cách đơn giản hơn và đánh đổi**. Các đoạn ghi “mã giả” chỉ là ví dụ so sánh, không phải class/method tồn tại trong repository.

## 1. Bản đồ trách nhiệm của luồng chuyển tiền

~~~text
Mobile
  TransferScreen
    ├─ thu input, quản lý bước và lỗi
    ├─ transferIntentStorage: nhớ yêu cầu để phục hồi
    └─ transfersApi → requestJson → HTTP
                                      |
Backend                               v
  http.ts
    ├─ đọc request, xác thực phiên/device, kiểm tra step-up
    └─ RelationalHttpBoundary
         └─ RelationalTransferService
              └─ UnitOfWork.transaction
                   ├─ AccountRepository: tài khoản
                   ├─ TransferRepository: quote, transfer, idempotency
                   ├─ LedgerRepository: bút toán
                   ├─ AuditRepository: dấu vết
                   └─ OutboxRepository: sự kiện cần xử lý tiếp
                         |
                         v
                    PostgreSQL COMMIT
                         |
                  receipt về Mobile

Sau commit, process worker có thể đọc outbox để xử lý delivery.
Chuyển tiền nội bộ trong service hiện tại đã ghi SUCCEEDED trong transaction.
~~~

**Bằng chứng:** [TransferScreen](C:/Projects/banking-system/mobile-app/src/features/transfers/screens/TransferScreen.tsx), [http.ts](C:/Projects/banking-system/backend/src/http.ts:1364), [Boundary](C:/Projects/banking-system/backend/src/database/relationalHttpBoundary.ts), [Service.submit](C:/Projects/banking-system/backend/src/database/transferService.ts:159).

Tại sao nhiều phần? Vì “bấm nút chuyển tiền” chứa nhiều vấn đề khác nhau: trải nghiệm màn hình, giao thức mạng, quyền người dùng, quy tắc tiền, tính nhất quán DB và xử lý công việc nền. Mỗi vấn đề có lý do thay đổi riêng.

Nếu sửa nội dung thông báo UI, không cần đổi SQL khóa account. Nếu đổi cách lấy row từ PostgreSQL, không cần để TransferScreen biết FOR UPDATE là gì. Đây là **separation of concerns — phân chia trách nhiệm**.

**Đánh đổi:** Người mới phải theo nhiều file; Boundary có nhiều method chuyển tiếp; callback transaction vẫn khá dài. Nhiều file tự nó không bảo đảm thiết kế tốt. Cần xem sự phân chia có giúp giữ một quy tắc ở đúng chỗ không.

**Tự kiểm tra:** (1) Chỗ nào quyết định hiển thị lỗi? (2) Chỗ nào quyết định tiền có đủ không? (3) Ai chịu trách nhiệm COMMIT?

## 2. Tại sao không viết tất cả trong một class hoặc một handler?

Một phiên bản ngắn có thể trông như sau.

~~~text
MÃ GIẢ để so sánh, không phải source project:

khi nhận request chuyển tiền:
  đọc token và body
  kiểm tra người dùng
  SELECT account
  UPDATE account A
  UPDATE account B
  tạo lịch sử
  gửi email
  return success
~~~

Nhìn ít dòng nhưng có câu hỏi chưa được giải quyết: ai rollback nếu cập nhật B lỗi? Gửi lại request có trừ thêm lần nữa không? Email chậm có giữ khóa DB không? HTTP body thay đổi có buộc sửa toàn bộ nghiệp vụ không?

Trong code thật, **Service** giữ thứ tự nghiệp vụ; **Repository** gom SQL; **UnitOfWork** xử lý vòng đời transaction. Vẫn có thể viết SQL trực tiếp trong một transaction của service và giữ tính nguyên tử. Repository là lựa chọn tổ chức code, **không phải điều kiện thần kỳ làm dữ liệu an toàn**.

Ví dụ thực tế: [RelationalRemainingService](C:/Projects/banking-system/backend/src/database/remainingService.ts) và [RelationalKycService](C:/Projects/banking-system/backend/src/database/kycService.ts) có SQL trực tiếp trong callback. Project không áp dụng quy tắc “mọi câu SQL bắt buộc có một Repository riêng” đồng nhất ở mọi nơi.

**Có thể đơn giản hơn:** Với một màn hình đọc dữ liệu nhỏ, handler → một hàm query → mapping có thể đủ. Với chuyển tiền, dù gộp file vẫn phải giữ transaction, ownership, khóa/cạnh tranh, chống lặp và khả năng đọc lại kết quả. Bỏ phân lớp có thể giảm số file; bỏ các điều kiện này là đổi hành vi.

**Tự kiểm tra:** (1) Gộp file có đồng nghĩa không thể dùng transaction không? (2) Repository có tự ngăn chuyển tiền hai lần không? (3) Vì sao không nên để JSX biết cách cập nhật ledger?

## 3. Vì sao cần Boundary và Service riêng?

### Bằng chứng trong code

[RelationalHttpBoundary](C:/Projects/banking-system/backend/src/database/relationalHttpBoundary.ts:46) nhận UnitOfWork, tạo các service và kiểm tra cấu hình nhóm route. Ví dụ constructor có:

~~~typescript
this.transfers = new RelationalTransferService(unitOfWork);
~~~

Boundary.submitTransfer gọi service.submit và chuyển kết quả sang public receipt. **http.ts** vẫn chịu trách nhiệm giao thức: đọc header/body, xác thực, kiểm tra step-up, chọn nhánh relational hay BankingSystem theo cấu hình và ghi HTTP response.

[RelationalTransferService.submit](C:/Projects/banking-system/backend/src/database/transferService.ts:159) nhận dữ liệu đã có cấu trúc như customerId/quoteId/key/fingerprint. Nó không nhận một đối tượng React, cũng không cần biết màu nút.

### Lợi ích và giới hạn

Service là nơi diễn tả **trình tự một nghiệp vụ**. Boundary là điểm gom cửa vào cho nhánh relational và chuyển tiếp. Điều này giúp đọc cấu hình route và tránh HTTP handler biết tất cả field riêng của từng service.

Có thể gọi service trực tiếp từ HTTP để giảm một lớp. Khi chỉ có một cơ chế persistence, lợi ích của lớp chuyển tiếp có thể ít hơn. Ở repository này, sự tồn tại của nhánh relational và nhánh BankingSystem khiến lựa chọn route là vấn đề thật.

**Không kết luận quá mức:** Boundary có vai trò giống một facade — cửa vào thống nhất — nhưng vẫn phụ thuộc vào concrete service. Không đủ bằng chứng để gọi toàn hệ thống là Clean Architecture/Hexagonal “chuẩn” chỉ từ tên Boundary.

**Tự kiểm tra:** (1) Service.submit biết HTTP status 200 không? (2) Vì sao route config ảnh hưởng việc đọc trace? (3) Boundary có tự làm mọi kiểm tra nghiệp vụ không?

## 4. Dependency injection và interface thực sự có ở đâu?

**Dependency** là đối tượng/mô-đun mà một phần code cần để làm việc. Ví dụ service cần UnitOfWork; repository cần client.

### Bằng chứng constructor injection

Trong [transferService.ts](C:/Projects/banking-system/backend/src/database/transferService.ts:86):

~~~typescript
constructor(private readonly unitOfWork: UnitOfWork) {}
~~~

UnitOfWork được **truyền từ bên ngoài**. Service không tự đọc DATABASE_URL rồi tạo pool trong mỗi submit. Đây là constructor injection, không cần một framework DI mới gọi được như vậy.

Trong callback, service lại viết new AccountRepository(client) và new TransferRepository(client). Nghĩa là **không phải mọi dependency đều được inject dưới dạng interface**; class này vẫn biết concrete repository. Đây là ranh giới linh hoạt hiện có, không nên tô vẽ rộng hơn.

### Interface có bằng chứng rõ: AdminRepository

[adminRepository.ts](C:/Projects/banking-system/backend/src/admin/repositories/adminRepository.ts:287) khai báo interface AdminRepository và hai implementation:

~~~typescript
export class InMemoryAdminRepository implements AdminRepository {
~~~

~~~typescript
export class PostgresAdminRepository implements AdminRepository {
~~~

Đây là hai dòng khai báo trích source; thân class đọc tại liên kết trên. **AdminActionEngine** nhận AdminRepository. Interface mô tả các thao tác mà engine được phép gọi; implementation quyết định lưu Maps hay PostgreSQL.

Interface TypeScript không tồn tại như bộ kiểm tra runtime. implements kiểm tra cấu trúc khi type-check; không tự chứng minh hai implementation có cùng hành vi cạnh tranh/transaction.

### Nếu viết đơn giản hơn

Cho engine tự new PostgresAdminRepository có thể ít tham số hơn, nhưng test engine sẽ khó thay storage. Dùng InMemory giúp test workflow nhanh, còn khóa hàng/rollback phải kiểm chứng với PostgreSQL thật trong môi trường test phù hợp.

**Tự kiểm tra:** (1) Ai cấp UnitOfWork cho service? (2) Service có hoàn toàn không biết repository cụ thể không? (3) Test Maps có chứng minh FOR UPDATE đúng không?

## 5. Repository tách điều gì, không tách điều gì?

Nguồn: [AccountRepository](C:/Projects/banking-system/backend/src/database/repositories/accountRepository.ts), [TransferRepository](C:/Projects/banking-system/backend/src/database/repositories/transferRepository.ts).

### Bằng chứng

AccountRepository.findOwnedAccount thực hiện SQL lọc account/customer rồi map row. lockManyByIds thực hiện SQL khóa hàng. updateBalances ghi số dư và kiểm tra version.

RelationalTransferService dùng các method này để nói:

~~~text
Đọc/khóa account
  → kiểm tra active/quyền/số tiền
  → tính số dư mới
  → gọi repository cập nhật
~~~

Service quyết định **khi nào** và **vì sao** cập nhật. Repository chịu trách nhiệm **câu SQL nào** thực hiện yêu cầu đó. Đây là bằng chứng vai trò Repository/data access trong code, không chỉ là hậu tố tên class.

### Tại sao hữu ích?

Câu SQL và mapping account được nhiều service dùng lại. Đổi tên cột ở nơi truy cập dữ liệu tập trung dễ theo dõi hơn việc tìm SQL rải trong mọi màn hình. Cũng dễ nhìn thấy method nguy hiểm: findByAccountNumber không mang cùng điều kiện sở hữu như findOwnedAccount.

### Nếu không dùng

Có thể chép query trực tiếp vào service. Với query một lần và ít logic, điều đó có thể hợp lý. Nhưng khi nhiều service đều cập nhật available/current/held/version, sao chép dễ làm một nơi quên điều kiện.

Repository hiện tại không phải “collection của rich domain entity” theo mọi định nghĩa chặt; nhiều method là SQL chuyên biệt và trả row DTO. Nên mô tả vai trò thực tế thay vì áp một trường phái kiến trúc quá rộng.

**Tự kiểm tra:** (1) Ai tính totalDebit? (2) Ai biết tên cột available_minor? (3) Vì sao findOwnedAccount tốt hơn findById trong luồng đọc của customer?

## 6. UnitOfWork giải quyết lỗi ghi dở dang thế nào?

Nguồn: [unitOfWork.ts](C:/Projects/banking-system/backend/src/database/unitOfWork.ts), [Service.submit](C:/Projects/banking-system/backend/src/database/transferService.ts:159).

### Tình huống

A có 500.000, chuyển 100.000, phí 1.000. Nếu trừ A đã commit nhưng cộng B lỗi, hệ thống bị lệch. try/catch JavaScript một mình không hoàn tác SQL đã commit.

### Bằng chứng

Service tạo mọi repository bằng cùng client của callback. UnitOfWork thực hiện:

~~~text
database.connect()
  → BEGIN
  → operation({ client, ... })
  → COMMIT
Lỗi trước khi hoàn tất:
  → thử ROLLBACK
Cuối cùng:
  → client.release()
~~~

Đây là transaction wrapper theo vai trò Unit of Work: nhiều ghi dữ liệu cùng thành công hoặc cùng rollback trong phạm vi PostgreSQL transaction đó. Class hiện tại không có cơ chế ORM tự dò object thay đổi/dirty tracking.

### Nếu viết đơn giản hơn

Mỗi service có thể tự viết BEGIN/COMMIT/ROLLBACK/finally. Nhưng lặp lại sẽ dễ quên release, không thống nhất retry/metrics và vô tình dùng sai client. Gom code hạ tầng vào UnitOfWork giữ callback tập trung vào nghiệp vụ.

### Giới hạn bắt buộc hiểu

- Transaction không bao phủ state Mobile, mạng HTTP hay email/push đã gửi ra ngoài.
- Đọc số dư trong transaction READ COMMITTED không tự chặn hai request cùng tính từ số dư cũ.
- COMMIT thành công không bảo đảm response đến được Mobile.
- Rollback hoàn tác phần ghi trong transaction này; không phải đảo ngược mọi việc hệ thống từng làm.

**Tự kiểm tra:** (1) Vì sao năm repository phải dùng cùng client? (2) Email đã gửi có tự bị rollback không? (3) Vì sao còn cần khóa hàng nếu đã có transaction?

## 7. Vì sao vừa khóa hàng, vừa kiểm tra version?

Nguồn: [AccountRepository.lockManyByIds](C:/Projects/banking-system/backend/src/database/repositories/accountRepository.ts:141), [updateBalances](C:/Projects/banking-system/backend/src/database/repositories/accountRepository.ts:150).

### Lỗi khi chỉ SELECT rồi UPDATE

Giả sử A có 150.000 và hai request đều muốn trừ 100.000:

~~~text
Request 1 đọc A = 150.000
Request 2 đọc A = 150.000
Request 1 tính còn 50.000
Request 2 cũng tính còn 50.000
~~~

Cả hai có thể tưởng tiền đủ trong khi tổng cần trừ vượt số dư. await chỉ sắp thứ tự bên trong từng lần gọi, không ngăn request khác chạy.

### Khóa hàng trong code

~~~sql
SELECT * FROM payment_accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE
~~~

FOR UPDATE giữ khóa các hàng đến khi transaction kết thúc. Request cạnh tranh cần khóa cùng account phải đợi, sau đó kiểm tra trên dữ liệu thích hợp. ORDER BY id giúp các request khóa theo thứ tự ổn định, giảm nguy cơ vòng chờ khi A→B và B→A.

### Version trong code

updateBalances tăng version và có điều kiện:

~~~sql
AND ($5::bigint IS NULL OR version = $5)
~~~

Trong submit, expectedVersion được truyền từ row đã đọc. Nếu không khớp, UPDATE không trả row và method ném lỗi. Đây là kiểm tra cập nhật có điều kiện theo phiên bản; cùng với khóa hàng giúp phát hiện giả định đã lỗi thời.

Không nói hệ thống hết mọi deadlock: nhiều loại lệnh khóa nhiều bảng vẫn có thể cạnh tranh. [transactionRetry.ts](C:/Projects/banking-system/backend/src/database/transactionRetry.ts) và [postgresErrors.ts](C:/Projects/banking-system/backend/src/database/postgresErrors.ts) chỉ retry cả transaction đối với 40001/40P01 theo giới hạn.

**Nếu đơn giản hơn:** Có thể thiết kế một câu UPDATE điều kiện số dư rồi RETURNING cho từng tình huống; nhưng phải giữ nguyên điều kiện liên quan hai account, quote, ledger và idempotency. Không thay đổi query chỉ để ít dòng khi chưa chứng minh tương đương.

**Tự kiểm tra:** (1) await có khóa account cho request khác không? (2) ORDER BY giúp giảm tình huống nào? (3) Version sai nên bỏ qua hay báo thất bại?

## 8. Tại sao có Quote rồi mới Submit?

Nguồn: [createQuote](C:/Projects/banking-system/backend/src/database/transferService.ts:89), [submit](C:/Projects/banking-system/backend/src/database/transferService.ts:159), [TransferScreen](C:/Projects/banking-system/mobile-app/src/features/transfers/screens/TransferScreen.tsx).

### Quote giải quyết việc gì?

Người dùng cần thấy chính xác **người nhận, số tiền, phí, tổng trừ và hạn hiệu lực** trước khi xác nhận. createQuote kiểm tra tham chiếu người nhận, nguồn tiền và policy, lưu nội dung server biết; phí demo hiện là 1_000n.

Submit gửi quoteId. Service đọc quote đã lưu, kiểm tra sở hữu/hạn/đã dùng, lấy amount/fee từ đó. Người dùng không thể chỉ sửa hiển thị “phí 0” trên Mobile rồi làm service tin số phí mới.

### Tại sao vẫn kiểm tra lại?

Giữa lúc lấy quote và submit, account có thể bị khóa, tiền đã dùng cho giao dịch khác, hoặc policy đã đổi. Có quote không phải đã giữ tiền hay bảo đảm giao dịch thành công.

Service.submit có comment và lời gọi assertTransferAllowed sau khi khóa quote, trước cập nhật tiền. Đây là kiểm tra thời điểm thực thi, không chỉ kiểm tra lúc preview.

### Có thể chỉ một request không?

Có thể với thao tác ít rủi ro hoặc giao diện không cần xác nhận điều khoản. Với luồng này, một request khiến việc “người dùng đã xác nhận đúng số tiền/phí nào?” khó diễn tả. Quote cũng tạo resource để challenge ràng buộc.

**Tự kiểm tra:** (1) Quote có khóa tiền đến khi người dùng suy nghĩ xong không? (2) Phí dùng khi submit lấy từ đâu? (3) Quote chưa hết hạn có bảo đảm account vẫn ACTIVE không?

## 9. Vì sao cần cả phiên đăng nhập, ownership, policy và step-up?

Nguồn: [http.ts](C:/Projects/banking-system/backend/src/http.ts:1379), [PersistentMfaService.verifyChallenge](C:/Projects/banking-system/backend/src/mfa/persistentMfaService.ts:535), [ControlPolicyRepository](C:/Projects/banking-system/backend/src/database/controlPolicyRepository.ts:102), [transferService.ts](C:/Projects/banking-system/backend/src/database/transferService.ts).

| Kiểm tra | Câu hỏi nó trả lời | Bằng chứng trong luồng |
|---|---|---|
| Session/device | Người gửi request là ai, phiên này còn hợp lệ không? | HTTP lấy user qua xác thực token/device |
| Ownership | Account nguồn có thuộc customer này không? | source.customerId được so với input.customerId |
| Policy | Hiện tại có cho phép nghiệp vụ/số tiền này không? | assertTransferAllowed |
| Step-up | Proof có đúng challenge/người/thiết bị/mục đích/nội dung không? | verifyChallenge nhận purpose TRANSFER, resourceId quote, fingerprint |
| Guard tài chính | Account active, số tiền dương, tiền khả dụng đủ không? | Service.submit sau khóa hàng |

Một bước không thay được bước khác. Đúng mật khẩu không tự cho phép dùng account của người khác. Mã TOTP hợp lệ không tự khiến số dư đủ.

Trong nhánh relational-v2 hiện tại, policy yêu cầu **TOTP khả dụng** vì đường HTTP persistent step-up đang xác minh TOTP. Mobile có code/capability liên quan OTP/biometric không đủ chứng minh Backend nhánh này thực thi tất cả phương thức.

**Ranh giới transaction:** verifyChallenge ở HTTP được gọi trước submitTransfer; không coi việc xác minh MFA và transaction chuyển tiền là một transaction DB duy nhất. Khi bước sau thất bại, cơ chế challenge/renew/recovery phải được xử lý đúng, không tự giả định proof luôn dùng lại được.

**Có thể đơn giản hơn:** Giao diện vẫn có thể ít bước cho người dùng, nhưng Backend cần giữ các kiểm tra độc lập. Gộp chúng vào một if khổng lồ làm khó biết lỗi nào xảy ra và khó test từng điều kiện.

**Tự kiểm tra:** (1) Biết accountId có chứng minh quyền sở hữu không? (2) Đúng TOTP có nghĩa tiền đủ không? (3) Vì sao phải gắn challenge với quote thay vì chỉ với customer?

## 10. Idempotency: tại sao khóa nút trên UI chưa đủ?

Nguồn: [TransferRepository.reserveCommandIdempotency](C:/Projects/banking-system/backend/src/database/repositories/transferRepository.ts:345), [Service.submit](C:/Projects/banking-system/backend/src/database/transferService.ts:170).

### Tình huống thật cần xử lý

Mobile gửi một lần. Server commit. Response bị mất. Người dùng thử lại. Không có bấm đôi, nhưng hệ thống vẫn nhận hai request cho cùng ý định.

submitLockRef và isSubmitting chỉ bảo vệ một instance màn hình trong một khoảng thời gian. App khởi động lại, HTTP retry hoặc client khác không bị ràng buộc bởi ref đó.

### Bằng chứng SQL

~~~sql
INSERT INTO command_idempotency
  (id, customer_id, operation_type, idempotency_key, request_fingerprint, status)
VALUES ($1, $2, $3, $4, $5, 'PENDING')
ON CONFLICT (customer_id, operation_type, idempotency_key) DO NOTHING
RETURNING *
~~~

Bộ khóa có **customer + operation + key**. Nếu không INSERT được vì đã có, repository đọc bản ghi cũ FOR UPDATE. Service so fingerprint và lấy canonical transfer nếu đã hoàn tất.

| Trường hợp | Hành vi theo code |
|---|---|
| Chưa có key trong scope | Giữ chỗ và tiếp tục command |
| Có key, fingerprint khác | IdempotencyConflictError |
| Có key, đã có transfer canonical | Trả transfer cũ |
| Có key nhưng chưa có kết quả hoàn chỉnh | IDEMPOTENCY_IN_PROGRESS theo nhánh xử lý |
| Quote đã tiêu thụ và có canonical | Lấy kết quả cũ, không trừ lần nữa |

**Key** là danh tính lần yêu cầu. **Fingerprint** mô tả nội dung mà danh tính đó đại diện. Hai field phục vụ hai việc, không nên thay nhau. Key giống nhau không cho phép thay người nhận/số tiền.

### Nếu không dùng

Có thể chặn bấm nút và tin mạng không lỗi; cách đó ngắn nhưng không giải quyết mất response. Có thể dùng unique quote như một phần chống lặp; project còn lưu command result để truy vết/replay theo yêu cầu và kiểm tra nội dung.

Đừng mô tả thành bảo đảm “exactly-once toàn bộ thế giới”. Cơ chế này bảo vệ command trong scope/quy tắc DB hiện có. Delivery ra bên ngoài vẫn có retry/dedup riêng.

**Tự kiểm tra:** (1) Timeout có phải lý do tạo key mới không? (2) Fingerprint khác nhưng key giống nên làm gì? (3) Vì sao scope phải có customer/operation?

## 11. Durable intent: vì sao Mobile phải ghi xuống máy trước POST?

Nguồn: [TransferScreen.handleSubmitTransfer](C:/Projects/banking-system/mobile-app/src/features/transfers/screens/TransferScreen.tsx:452), [transferIntentStorage.ts](C:/Projects/banking-system/mobile-app/src/features/transfers/storage/transferIntentStorage.ts).

### Server chống lặp rồi, tại sao còn lưu ở máy?

Server có thể biết giao dịch đã xong, nhưng Mobile cần nhớ **mình đã gửi ý định nào và với key nào** để hỏi lại đúng việc. Nếu chỉ giữ state trong RAM, đóng ứng dụng làm mất thông tin đó.

PendingTransferIntent có userId, idempotencyKey, quote, createdAt; có thể thêm transferId/receipt/manualReviewCode và dữ liệu lifecycle. Storage kiểm tra cấu trúc khi load, đồng thời tuần tự hóa mutation qua queue.

### Các trạng thái không được trộn lẫn

| Loại | Ví dụ | Ý nghĩa |
|---|---|---|
| Bước giao diện | review, stepUp, result | Người dùng đang nhìn màn hình nào |
| Mức độ biết kết quả của client | DRAFT_QUOTE, SUBMIT_UNKNOWN, ACCEPTED_PENDING, ACCEPTED_TERMINAL | Mobile biết gì về yêu cầu đã gửi |
| Trạng thái nghiệp vụ server | PENDING, SUCCEEDED, FAILED, REVERSED | Server ghi nhận giao dịch ở trạng thái nào |

SUBMIT_UNKNOWN không có nghĩa FAILED. ACCEPTED_TERMINAL cũng không tự có nghĩa thành công; phải đọc status receipt.

### Vì sao ghi trước?

Nếu ghi sau POST, có cửa sổ: server đã thực hiện nhưng app chết trước khi lưu. Ghi intent trước POST giúp lần mở sau biết có yêu cầu cần phục hồi. Đổi lại, có thể app chết sau khi lưu nhưng trước khi thực sự gửi; khi đó phải xử lý như **chưa biết chắc**, không tuyên bố đã chuyển tiền.

Khi đã có transferId, restoreTransferIntent dùng getTransfer đọc canonical status. Khi chưa có/không rõ, code dùng policy recovery/manual review thay vì tự xóa intent rồi gửi ý định mới.

### Có thể đơn giản hơn?

Với màn hình đọc danh sách: mất state thì tải lại, thường không cần durable intent. Với lệnh làm thay đổi tiền: bỏ nó làm mất thông tin cần phân biệt “chưa làm” với “đã làm nhưng mất phản hồi”. Đây là độ phức tạp do sự cố có thể xảy ra, không phải chỉ vì muốn áp pattern.

**Tự kiểm tra:** (1) App chết trước POST có thể để lại SUBMIT_UNKNOWN không? (2) ACCEPTED_TERMINAL có luôn SUCCEEDED không? (3) Server idempotency thay được storage client hoàn toàn không?

## 12. Tại sao cùng một giao dịch ghi nhiều loại dữ liệu?

Nguồn: [Service.submit phần ghi sổ](C:/Projects/banking-system/backend/src/database/transferService.ts:306), [LedgerRepository](C:/Projects/banking-system/backend/src/database/repositories/ledgerRepository.ts), [AuditRepository](C:/Projects/banking-system/backend/src/database/repositories/auditRepository.ts).

| Dữ liệu | Câu hỏi nó phục vụ |
|---|---|
| payment_accounts | Hiện tại còn bao nhiêu tiền khả dụng/current/held? |
| transfers | Command chuyển tiền nào, quote/key/reference/status nào? |
| account_transactions | Người gửi/người nhận nhìn thấy lịch sử nào? |
| Ledger journal/entries | Các vế ghi sổ của nghiệp vụ này là gì? |
| audit_events | Ai thực hiện gì, trên resource nào, truy dấu bằng gì? |
| notifications | Khách hàng có thông báo nào trong hộp thông báo? |
| outbox_events | Công việc/sự kiện nào cần được xử lý tiếp sau commit? |

Với ví dụ 100.000 và phí 1.000, code ghi một vế DEBIT nguồn 101.000, CREDIT đích 100.000 và CREDIT fee-income:VND 1.000. Đây là cách ledger trong project ghi nghiệp vụ, không phải bài khẳng định chuẩn kế toán áp dụng cho mọi hệ thống.

### Có thể chỉ lưu số dư?

Có, nếu chỉ muốn một mô phỏng cộng/trừ tối giản. Nhưng khi người dùng hỏi “vì sao tài khoản giảm?”, chỉ số dư hiện tại không đủ để dựng lịch sử/chứng minh vế đối ứng. Chỉ lưu lịch sử rồi tính tổng mỗi lần cũng là thiết kế khác, phải giải quyết hiệu năng và quy tắc tính.

**Đánh đổi hiện tại:** Nhiều bảng phải đồng bộ. Transaction là phần giữ chúng nhất quán trong phạm vi command; mapping và tests phải kiểm tra cả các mối liên kết. Nhiều bảng không tự làm dữ liệu đúng.

**Không gọi là Event Sourcing:** Code trực tiếp UPDATE payment_accounts và lưu nhiều bảng trạng thái hiện tại. Có ledger/outbox/audit không chứng minh toàn bộ state được dựng bằng replay event.

**Tự kiểm tra:** (1) Lịch sử UI và ledger có cùng mục đích không? (2) Audit thay được số dư không? (3) Có event table là đủ để gọi Event Sourcing chưa?

## 13. Transactional Outbox: tại sao không gửi push/email ngay trong submit?

Nguồn: [OutboxRepository](C:/Projects/banking-system/backend/src/database/repositories/outboxRepository.ts), [Service.submit](C:/Projects/banking-system/backend/src/database/transferService.ts:406), [WorkerRuntime.runOnce](C:/Projects/banking-system/backend/src/workers/workerRuntime.ts:205).

### Hai cách đơn giản đều có một khoảng lỗi

~~~text
Gửi email trước COMMIT:
  Email báo thành công → DB rollback → email sai

COMMIT rồi mới gửi email trực tiếp:
  DB thành công → process chết trước gửi → việc gửi bị bỏ quên
~~~

### Bằng chứng trong project

Service gọi outbox.append bằng **cùng client transaction với ghi tiền**. Event TRANSFER_SUCCEEDED có aggregateId, deduplicationKey, payload, traceId, subjectCustomerIds và notificationIds. Các notification trong DB cũng được tạo trong command.

WorkerRuntime dùng repository để claim event, dispatch và xử lý delivery; có lease/retry/metrics. Điều này đáp ứng cấu trúc **Transactional Outbox**: commit dữ liệu nghiệp vụ và ý định xử lý sự kiện cùng nhau, xử lý bên ngoài sau.

### Đánh đổi

Tăng số bảng, worker, cơ chế retry và giám sát. Thông báo ngoài có thể đến chậm; một lần retry có thể gặp kết quả gửi chưa rõ, nên dedup/delivery policy vẫn cần thiết. Không tự có bảo đảm external delivery đúng một lần.

Trong config provider được đọc, outbox push/email có fake/disabled; không lấy sự tồn tại của worker làm bằng chứng đã gửi thật đến điện thoại/hộp thư. Đường email OTP của API là vấn đề khác.

**Không nhầm worker với bước cộng tiền B:** Nhánh transfer nội bộ hiện tại đã cập nhật cả hai account và SUCCEEDED trước commit; worker ở đây xử lý hậu kỳ/delivery của sự kiện, không phải luôn là nơi thực hiện chuyển tiền.

**Tự kiểm tra:** (1) Vì sao outbox phải cùng transaction? (2) Chậm push có làm balance chưa commit không? (3) Claim lại event có nghĩa được phép trừ tiền lần nữa không?

## 14. Mapping và biểu diễn tiền: tại sao không trả SQL row thẳng cho UI?

Nguồn: [row mapping account](C:/Projects/banking-system/backend/src/database/repositories/accountRepository.ts:37), [toPaymentAccount](C:/Projects/banking-system/backend/src/database/relationalAccountReadService.ts:38), [publicTransfer](C:/Projects/banking-system/backend/src/database/transferService.ts:69), [money.ts](C:/Projects/banking-system/backend/src/money.ts).

### Bằng chứng đổi hình dạng

~~~text
Database: amount_minor
  → repository: amountMinor
  → public transfer: amount = { currency: "VND", amountMinor: "100000" }
  → JSON
  → validator Mobile
  → định dạng "100.000 ₫" trên UI
~~~

SQL row chứa thông tin phục vụ persistence, version và quan hệ nội bộ; UI không cần tất cả. Mapping làm rõ contract được phép trả. Số tài khoản đầy đủ có API riêng với ownership/audit, trong khi list trả maskedNumber.

### Vì sao chuỗi và bigint?

JavaScript number không biểu diễn chính xác mọi số nguyên lớn. parseMoney kiểm tra rồi chuyển sang bigint để tính nguyên; toMoney trả chuỗi để JSON trao đổi. Mobile trình bày tiền, server quyết định kết quả nghiệp vụ.

### Có thể đơn giản hơn?

Trả result.rows trực tiếp ít code hơn, nhưng schema DB bị lộ vào contract và dễ vô tình gửi field nhạy cảm/nội bộ. Dùng number cho số nhỏ của bài tập có thể dễ học, nhưng thay đổi kiểu tiền ở project này ảnh hưởng validation, API, tính toán và DB.

**Mapping không tự an toàn nếu bỏ field sai.** Cần kiểm tra mapper thật. Cũng không vì có type PaymentAccount mà JSON từ mạng chắc chắn đúng; requestJson có đường validator để xử lý INVALID_RESPONSE.

**Tự kiểm tra:** (1) BigInt có JSON.stringify trực tiếp được không? (2) Vì sao API không nên tự lộ version/customerId chỉ vì SELECT * có chúng? (3) Mapper là nơi đổi số dư hay đổi hình dạng dữ liệu?

## 15. State machine và callback: gọi tên pattern tới đâu là đúng?

Nguồn: [TransferScreen](C:/Projects/banking-system/mobile-app/src/features/transfers/screens/TransferScreen.tsx), [transferStateMachine.ts](C:/Projects/banking-system/mobile-app/src/features/transfers/domain/transferStateMachine.ts).

TransferScreen dùng step và intentPhase cùng nhiều guard để điều khiển chuyển bước. Cách biểu diễn này có tính chất **máy trạng thái**: trạng thái hiện tại quyết định hành động tiếp theo được phép.

File transferStateMachine.ts có allowedTransitions, canTransitionTransfer, transitionTransfer. Nhưng qua tìm tham chiếu trong source Mobile ngoài test, hai hàm đó chỉ xuất hiện trong chính file helper; **không có bằng chứng TransferScreen hiện gọi helper này để kiểm soát mọi trạng thái**. Không nối một mũi tên chỉ vì tên file có vẻ phù hợp.

Ngoài ra helper đó cho SUCCEEDED tự lặp SUCCEEDED; không nên dùng nó để suy ra mọi chuyển trạng thái backend, đặc biệt xử lý reversal Admin, đều đi qua cùng bảng.

### Không đồng nhất với GoF State

GoF State thường có các object trạng thái với hành vi thay thế nhau. Ở đây bằng chứng đang có là union string, bảng chuyển và if/guard; không cần gọi là GoF State để giải thích đúng.

Callback async ({ client }) => {...} trong UnitOfWork là truyền hàm để thực hiện công việc. Có callback không tự chứng minh Observer. new Repository cũng không tự chứng minh Factory Method. Không nên gán tên pattern cho mọi cú pháp.

**Có thể đơn giản hơn:** Một boolean isLoading đủ cho màn hình GET đơn giản. Với chuyển tiền, boolean đó không trả lời đã có quote chưa, đã gửi chưa, đang phục hồi gì. Nhiều trạng thái là để biểu đạt các tình huống khác nhau; vẫn cần hạn chế tổ hợp không hợp lệ.

**Tự kiểm tra:** (1) Có file StateMachine có nghĩa screen đang dùng nó không? (2) isSubmitting = false có nghĩa chưa từng submit không? (3) Callback có luôn là Observer không?

## 16. Admin maker–checker và command lưu trong DB

Nguồn: [AdminActionEngine](C:/Projects/banking-system/backend/src/admin/actions/actionEngine.ts), [PostgresAdminRepository](C:/Projects/banking-system/backend/src/admin/repositories/adminRepository.ts:776), [AppShell.approve](C:/Projects/banking-system/admin-web/src/App.tsx:89).

### Vấn đề khác với customer tự chuyển tiền

Một nhân viên vận hành không nên chỉ có một button thay đổi ngay mọi dữ liệu nhạy cảm. Hệ thống cần biết ai đề xuất, ai kiểm tra, họ đã duyệt nội dung nào và thực thi có thành công không.

### Bằng chứng workflow

~~~text
create
  → action request lưu body/target/fingerprint/version
approve
  → chặn requester tự duyệt
  → kiểm tra permission + fresh step-up
  → kiểm tra fingerprint/version/hạn
  → decideAction
  → executeApprovedAction
  → trạng thái/kết quả + audit
~~~

Một request được biểu diễn thành bản ghi có loại lệnh, target và payload để có thể duyệt/thực thi về sau. Có thể gọi đây là **command workflow lưu bền vững**. Không khẳng định là GoF Command với mỗi hành động có class execute/undo riêng: implementation thật dùng actionType và các nhánh xử lý trong repository.

### Vì sao tách decision khỏi execution?

Code cho phép tình huống process chết sau transaction lưu APPROVED nhưng trước transaction execution. Lần gọi lại có đường recovery; repository khóa action để kiểm soát thực thi và trả receipt cho action đã hoàn thành.

Tách bước giúp lưu quyết định kiểm soát, nhưng tạo thêm trạng thái trung gian phải quản lý. Không được nói một approve HTTP là một transaction duy nhất bao phủ mọi thứ.

### Nếu đơn giản hơn

Một button UPDATE account trực tiếp ít code hơn, nhưng mất bước người khác xác nhận và mất bản ghi nội dung đã được duyệt. Với công cụ demo cá nhân rất nhỏ có thể không cần quy trình này; project hiện đang minh họa kiểm soát vận hành nên có chi phí đó.

**Tự kiểm tra:** (1) APPROVED khác SUCCEEDED thế nào? (2) Fingerprint giúp chống duyệt nhầm nội dung ra sao? (3) Vì sao approval retry không nên thực thi cùng thay đổi lần nữa?

## 17. Những nguyên tắc này xuất hiện ở chức năng khác ra sao?

| Nhóm chức năng | Code thực tế | Lý do thiết kế liên quan |
|---|---|---|
| Xem account | RelationalAccountReadService, AccountRepository | Ownership + public mapping; nhẹ hơn command tiền |
| Lịch sử | listTransactions, encodeCursor/decodeCursor | Phân trang ổn định theo thời gian và ID; không tải toàn DB |
| Đăng ký | RelationalRegistrationService.complete | Tạo customer/account/entitlements cùng transaction; challenge trước khi tạo hoàn chỉnh |
| Phiên | AuthProvider, RelationalAuthService.refresh | Single-flight giảm refresh trùng; epoch tránh kết quả cũ hồi sinh phiên |
| MFA | PersistentMfaService | Tách challenge/credential/recovery khỏi UI và logic số dư |
| Người thụ hưởng | RelationalBeneficiaryService.remove | Xóa mềm danh bạ, không xóa lịch sử chuyển tiền |
| QR | parseReceiveQrPayload | Dữ liệu bên ngoài cần kiểm tra; parse không thay xác minh người nhận phía server |
| Notifications | RelationalRemainingService | Đọc hộp thông báo riêng với delivery push/email |
| Fraud | reportFraud/getFraudReport | Tiếp nhận báo cáo có chống lặp; không tự coi báo cáo là lệnh hoàn tiền |
| Mở tiết kiệm | RelationalSavingsService.submitOpening | Quote + intent + idempotency + transaction trừ nguồn/tạo deposit |
| Đáo hạn | RelationalLifecycleService | Công việc theo thời gian chạy ở Backend; phải bắt kịp sau downtime và chống lặp |
| Credit application | submitApplication/activateApplication | Tách đề nghị, phê duyệt và tạo sản phẩm |
| Thẻ | setCardStatus/reportCardLost | Khóa tạm và báo mất là nghiệp vụ khác nhau |
| Sao kê | getStatement, private statement | Tổng hợp dữ liệu cần cho nghĩa vụ thanh toán |
| Trả nợ | RelationalCreditService.submitPayment | Khóa/version sao kê, không trả vượt nợ; cập nhật hai phía cùng transaction |
| KYC/Credit Admin | claimApplication, action engine | Nhận xử lý khác quyết định; quyết định khác thực thi |
| Funding/transfer Admin | executeApprovedAction | Guard trước ghi tiền, kiểm tra target version, ledger/audit |
| Vận hành nền | WorkerRuntime, Operations | Requeue phải giữ canonical payload và điều kiện trạng thái |

Xem tên file đầy đủ và diễn giải từng method ở [giaidoan5.md](C:/Projects/banking-system/giaidoan5.md). Không nên copy cả cấu trúc chuyển tiền cho QR chỉ vì muốn “thống nhất”; mức độ phức tạp nên đi theo tác dụng của nghiệp vụ.

**Tự kiểm tra:** (1) Vì sao GET danh sách ít cần durable intent hơn POST tiền? (2) Đáo hạn nên phụ thuộc app khách đang mở không? (3) Vì sao mở tiết kiệm và trả nợ giống khung nhưng khác các bảng phải cập nhật?

## 18. Bảng kết luận về pattern — kèm bằng chứng, không học tên suông

| Khái niệm | Bằng chứng trong luồng đã đọc | Cách nói chính xác |
|---|---|---|
| Separation of concerns | Screen/API/HTTP/Service/Repository | Phân chia trách nhiệm có thật, nhưng một số file vẫn lớn |
| Service Layer | RelationalTransferService.submit điều phối nghiệp vụ | Vai trò service rõ; không tự suy mọi business rule nằm duy nhất ở service |
| Repository | AccountRepository/TransferRepository gói SQL/mapping | Có lớp data access theo vai trò Repository |
| Unit of Work | UnitOfWork.transaction cùng client, commit/rollback | Transaction wrapper; không có ORM dirty tracking trong class này |
| Constructor DI | Service nhận UnitOfWork; AdminActionEngine nhận AdminRepository | DI có thật nhưng chưa abstract mọi dependency |
| Facade-like boundary | RelationalHttpBoundary gom entry method/route config | Vai trò cửa vào thống nhất; không chứng minh toàn kiến trúc theo một khuôn chuẩn |
| Transactional Outbox | outbox.append cùng transaction tiền; worker đọc sau | Có bằng chứng đầy đủ của cơ chế outbox |
| Idempotent command | reserve/completeCommandIdempotency + canonical result | Chống lặp command theo scope, key và fingerprint |
| Máy trạng thái | step/intentPhase/guard; helper allowedTransitions | Có mô hình trạng thái; không tự gọi là GoF State |
| Command workflow Admin | action record + approve + executeApprovedAction | Lệnh lưu DB để kiểm soát; không phải mỗi lệnh có một class execute/undo |
| Event Sourcing/CQRS đầy đủ | Không đủ từ những phần này | Đọc/ghi tách method và có outbox chưa đủ để kết luận |
| Observer/Strategy/Factory Method | Chưa chứng minh trong luồng chính bằng cấu trúc tương ứng | Không gắn tên chỉ vì có callback, if hoặc new |

**Tự kiểm tra:** (1) Chỉ vào hai đoạn chứng minh Outbox. (2) Chỉ vào một constructor chứng minh DI. (3) Vì sao không gọi new AccountRepository là Factory Method?

## 19. Thiết kế hiện tại có thể đơn giản hơn ở đâu?

Đây là phân tích học tập, **không phải đề xuất tự động sửa code**.

- **Boundary chuyển tiếp:** có thể giảm bớt nếu không còn nhu cầu chọn nhánh/ghép service ở cửa vào. Đổi lại HTTP sẽ phụ thuộc trực tiếp nhiều service hơn.
- **Đọc account:** một SELECT thuần có thể không cần transaction tường minh. Project dùng UnitOfWork để thống nhất kết nối/cơ chế; getAccountNumber còn ghi audit nên không hoàn toàn thuần đọc.
- **Các screen command lớn:** có logic lặp về quote/challenge/intent. Có thể tách hook khi quy tắc thật sự giống, nhưng abstraction chung quá sớm dễ che khác biệt transfer/savings/credit.
- **Repository Admin lớn:** executeApprovedAction chứa nhiều nhánh nghiệp vụ. Có thể tách handler theo actionType, nhưng cần giữ ranh giới transaction/lock/replay; không chỉ di chuyển mỗi if sang một file cho đủ pattern.
- **Relational và BankingSystem cùng tồn tại:** làm việc đọc trace khó hơn. Cần hiểu route/config thực tế trước khi chọn nhánh; việc bỏ một nhánh là thay đổi phạm vi, không nằm trong tài liệu này.
- **Thứ không thể bỏ chỉ để ít code hơn mà vẫn gọi là cùng hành vi:** ownership, kiểm tra tiền, transaction, chống lặp, trạng thái chưa rõ kết quả và guard phê duyệt tương ứng.

Một điểm cụ thể của route: trong relational-v2, guard đăng ký ở http.ts từ chối route registration không được Boundary bật bằng RELATIONAL_ROUTE_OUT_OF_SCOPE. Predicate hiện không nhận /auth/register/cancel; vì vậy việc method cancel tồn tại chưa chứng minh chức năng HTTP hủy được nối trong chế độ đó. Đây là ví dụ tại sao đánh giá thiết kế phải đọc cả caller và callee.

**Tự kiểm tra:** (1) Tách file có chắc giảm độ phức tạp không? (2) Guard nào của chuyển tiền không được bỏ khi refactor? (3) Vì sao cần đọc route predicate ngoài service method?

## 20. Kiểm chứng bằng test nào và bạn nên hiểu tới đâu?

Chỉ dẫn đọc các test hiện có; **không chạy test hoặc DB/worker trong lần soạn tài liệu này**.

| Source test | Câu hỏi nên dùng khi đọc |
|---|---|
| [databaseFoundation.test.ts](C:/Projects/banking-system/backend/src/tests/databaseFoundation.test.ts) | Có kiểm tra rollback, idempotency và cạnh tranh của command DB như thế nào? |
| [savingsRelational.test.ts](C:/Projects/banking-system/backend/src/tests/savingsRelational.test.ts) | Mở khoản gửi và nguồn tiền được kiểm tra cùng nhau ở những assertion nào? |
| [creditRelational.test.ts](C:/Projects/banking-system/backend/src/tests/creditRelational.test.ts) | Quote/sao kê/thanh toán dùng guard nào và kết quả DB được xác nhận ra sao? |
| [workerOutbox.test.ts](C:/Projects/banking-system/backend/src/tests/workerOutbox.test.ts) | Claim, retry và kết quả xử lý worker được kiểm tra bằng input/output nào? |
| [adminWorkflow.test.ts](C:/Projects/banking-system/backend/src/tests/adminWorkflow.test.ts) | Maker–checker và trạng thái action được chứng minh bằng case nào? |
| [admin.database.test.ts](C:/Projects/banking-system/backend/src/tests/admin.database.test.ts) | Điều gì được xác nhận bằng PostgreSQL thay vì chỉ Maps? |

Không coi “có file test” là “test đã pass”. Khi đến giai đoạn testing, cần đọc từng test/assertion và chạy đúng môi trường disposable theo hướng dẫn repo. Các fault hook trong service cho phép test ném lỗi tại một điểm cụ thể; chúng không phải nút chức năng dành cho customer.

Bạn đã hiểu Giai đoạn 6 ở mức nền tảng khi có thể tự trả lời:

1. Nếu trừ A xong mà cộng B lỗi, lớp nào xử lý và dữ liệu nào được rollback?
2. Nếu server commit rồi mất response, tại sao không tạo key mới ngay?
3. Nếu quote tạo lúc account ACTIVE nhưng account bị khóa trước submit, chỗ nào phát hiện?
4. Nếu bỏ outbox và gửi email ngay, hai thứ tự trước/sau COMMIT có thể lỗi ra sao?
5. Nếu người tạo action tự duyệt, guard nào từ chối và audit ghi để làm gì?

Hãy dùng tên method và một đoạn source để trả lời mỗi câu. Chưa cần thuộc các tên pattern nâng cao; hiểu được tình huống lỗi mà thiết kế đang xử lý là mục tiêu chính.

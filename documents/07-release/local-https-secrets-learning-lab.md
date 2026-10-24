# Bài thực hành local: HTTPS và secrets trước khi deploy

Ngày cập nhật: 2026-10-05

## Mục tiêu

Bài thực hành này giúp sinh viên nhìn thấy TLS và secret đi qua hệ thống thế nào trước khi học về deploy. Tất cả chạy trên máy cá nhân bằng dữ liệu giả; không tạo staging, không gọi cloud, không dùng database preview và không thực hiện giao dịch.

Luồng API được thực hành:

```text
Expo Web trên máy
  → HTTPS https://localhost:5443
  → local TLS proxy (chỉ bind 127.0.0.1)
  → HTTP nội bộ http://127.0.0.1:5000
  → Backend in-memory
```

TLS ở đây kết thúc tại local proxy, tương tự vai trò TLS gateway ở staging. Request từ proxy tới Backend chỉ qua loopback của cùng máy. PostgreSQL TLS là bài tập độc lập, dùng một container disposable riêng nếu image đã có sẵn. Bài secret tạo giá trị ngẫu nhiên trong thư mục tạm rồi tự xóa; nó không cần Google Secret Manager.

## Những gì repository đang làm

| Phần | Hành vi hiện tại |
| --- | --- |
| Mobile local sandbox | `mobile-app/src/services/api/config.ts` cho phép HTTPS ở `local-sandbox`; HTTP chỉ được bật khi `EXPO_PUBLIC_SANDBOX_HTTP=1` và đích là loopback/emulator. |
| Backend local | `backend/src/server.ts` vẫn giữ bind mặc định tương thích container là `0.0.0.0`; bài tập đặt `BANKING_BIND_HOST=127.0.0.1` để chỉ mở cổng trên máy local. |
| PostgreSQL TLS | `backend/src/database/pool.ts` có các chế độ `disable`, `require`, `verify-ca`, `verify-full`. TLS query options trong `DATABASE_URL` giờ bị từ chối để không ghi đè policy đã phân giải. |
| Secrets | Development dùng `LocalDevelopmentSecretProvider` từ environment. `MountedSecretClient` đóng vai trò test double cho managed mount với một file cho mỗi secret và file `<secretId>.version`; bài tập sử dụng riêng giá trị synthetic trong thư mục tạm. |

## A. Tạo chứng chỉ local

Chứng chỉ và private key được đặt ngoài repository trong `%LOCALAPPDATA%\BankingSystem\local-https-lab`. Script không sửa Windows trust store và từ chối ghi đè thư mục đã tồn tại. Khóa PEM cho bài lab không mã hóa; thư mục nằm trong profile người dùng và khóa chỉ dùng local, nên xóa sau buổi học và tuyệt đối không sao chép lên Git.

```powershell
pwsh -NoProfile -File backend/scripts/local-https-lab/new-certificate.ps1
```

Thư mục có CA public certificate, server certificate và private key PEM. Chứng chỉ có SAN cho `localhost`, `127.0.0.1` và `10.0.2.2`, hạn dùng 30 ngày. CA private key chỉ tồn tại trong bộ nhớ khi cấp chứng chỉ; script không cài CA vào Windows.

## B. Chạy HTTPS API không dùng database

Mở terminal thứ nhất:

```powershell
pwsh -NoProfile -File backend/scripts/local-https-lab/run-api.ps1
```

Script đặt Backend vào `BANKING_STORAGE=in-memory`, tạo một `REGISTRATION_FINGERPRINT_KEY` ngẫu nhiên chỉ tồn tại trong process, tắt AI và email, ép bind `127.0.0.1:5000`, rồi chạy server development. Nó không dùng giá trị key từ `.env`, không khởi động PostgreSQL, worker hay Compose. Các biến môi trường ban đầu của terminal được khôi phục khi dừng bằng Ctrl+C.

Mở terminal thứ hai để chạy TLS proxy:

```powershell
pwsh -NoProfile -File backend/scripts/local-https-lab/run-proxy.ps1
```

Proxy chỉ nghe `127.0.0.1:5443`, yêu cầu TLS 1.2 trở lên và chỉ chuyển tiếp health/API path tới `127.0.0.1:5000`. Log chỉ ghi nhóm route và mã HTTP, không ghi body, query string, token hoặc header.

Mở terminal thứ ba để kiểm tra chứng chỉ, CA và hostname mà không bỏ qua xác minh TLS:

```powershell
$env:BANKING_LOCAL_HTTPS_CA_FILE = "$env:LOCALAPPDATA\BankingSystem\local-https-lab\local-https-ca.pem"
node backend/scripts/local-https-lab/probe-https.cjs
Remove-Item Env:BANKING_LOCAL_HTTPS_CA_FILE
```

Kết quả mong đợi là `PASS`, HTTP `200`, TLS version và `hostnameVerified: true`. Script đọc CA riêng; nó không dùng tùy chọn kiểu `rejectUnauthorized: false` hay `curl -k`.

### Mở bài tập bằng Expo Web

Để trình duyệt tin CA local, có thể import **chỉ CA của bài lab** vào Current User → Trusted Root Certification Authorities. Đây là thay đổi trust store trên tài khoản Windows; không import vào Local Machine. Sau buổi học, xóa chứng chỉ theo thumbprint `CaThumbprint` mà script tạo đã in ra.

Trong terminal thứ tư:

```powershell
Set-Location mobile-app
$env:APP_VARIANT = "local-sandbox"
$env:EXPO_PUBLIC_SANDBOX_HTTP = "0"
$env:EXPO_PUBLIC_API_URL = "https://localhost:5443/api/v1"
npm run web
```

Đây là Expo Web chạy trong trình duyệt máy tính, chưa phải kiểm thử native Android. Android emulator cần tin CA trong Android và cấu hình trust dành riêng cho debug build; bài thực hành hiện không thay đổi trust policy của app native và không tuyên bố Android E2E đã chạy.

> **Giới hạn kết nối:** proxy hiện chỉ bind `127.0.0.1`, nên emulator Android không thể truy cập proxy qua `10.0.2.2`. Proxy giữ loopback-only để không mở listener lên mạng LAN. Bài thực hành được thiết kế cho trình duyệt trên chính máy tính.

## C. Thử PostgreSQL `verify-full` trên database disposable

Script dưới đây chỉ kết nối tới `localhost:55433/banking_tls_lab`, thực hiện một truy vấn `SELECT` đọc trạng thái TLS, dùng thư mục dữ liệu tmpfs và xóa container sau khi chạy. Không dùng Compose `banking_preview`, không chạy migration.

```powershell
pwsh -NoProfile -File backend/scripts/local-https-lab/run-postgres-tls.ps1
```

Script không tự tải Docker image. Image PostgreSQL 16 đã ghim digest trong `compose.yaml` phải có sẵn cục bộ. Nếu máy chưa có image, script dừng; tham số `-PullImage` sẽ tải image công khai và dùng Internet bandwidth (không có service fee), vì vậy chỉ dùng khi người học chủ động chấp nhận việc tải.

Khi chạy, kết quả mong đợi là `PASS`, `tlsEnabled: true`, có phiên bản TLS và `hostnameVerified: true`. `DATABASE_URL` có tham số `sslmode`, `sslrootcert`, `sslkey`, `sslnegotiation` hoặc `ssl=0` sẽ bị từ chối trước khi tạo kết nối.

## D. Thử secret mount bằng dữ liệu giả

```powershell
Set-Location backend
node --import=tsx scripts/local-https-lab/mounted-secrets.ts
```

Script tạo một secret ngẫu nhiên, ghi tạm giá trị và version sidecar, đọc qua `createRuntimeSecretProvider` với staging reference và mounted backend, xác nhận local `.env` fallback không được dùng, rồi xóa thư mục tạm. Kết quả chỉ hiện `source`, version và cờ `secretValuePrinted: false`. Không gọi Google API hoặc dịch vụ cloud.

Trong hệ thống triển khai thật, nền tảng sẽ gắn các file secret vào workload và cấp quyền đọc theo service. Local mount này chỉ kiểm tra định dạng đọc; nó không chứng minh IAM, audit log hay rotation của Secret Manager thật.

## Kết quả kiểm chứng trên máy local

Ngày 2026-10-05, các bài sau đã chạy thành công trên máy phát triển:

| Bài kiểm tra | Kết quả | Giới hạn |
| --- | --- | --- |
| Backend in-memory qua HTTPS proxy | PASS: HTTP 200, TLS 1.3, hostname được xác minh; probe với CA sai bị từ chối | Kiểm tra từ Node trên cùng máy; chưa chạy Expo Web hoặc Android E2E |
| Phạm vi listener API/proxy | PASS: cả hai chỉ nghe trên `127.0.0.1`; sau bài test không còn listener | Chỉ chứng minh bind trên máy local, không phải firewall hoặc ingress của staging |
| PostgreSQL disposable với `verify-full` | PASS: TLS 1.3, hostname `localhost` được xác minh; chỉ chạy truy vấn đọc trạng thái TLS | Image PostgreSQL ghim digest đã có sẵn; không tải image, không migration; container và dữ liệu tmpfs đã được dọn |
| Mounted secret giả lập | PASS: đọc qua mounted provider, không dùng env fallback, không in giá trị secret | Không gọi cloud; không kiểm tra IAM, audit hoặc rotation thật |
| Kiểm tra code liên quan | Backend typecheck/build PASS; 24/24 test Backend; 12/12 transport-policy test và 11/11 API-config test Mobile | Đây là các kiểm tra tập trung, không phải toàn bộ test suite của dự án |

CA chưa được cài vào Windows trust store. HTTPS đã được xác minh bằng probe Node truyền CA tường minh; bước mở Expo Web trong trình duyệt vẫn cần người học tự quyết định có tin CA local hay không. Private key PEM của bài lab được giữ ngoài repository tại `%LOCALAPPDATA%\BankingSystem\local-https-lab` để có thể học lại, và nên xóa thư mục này sau khi hoàn tất.

## E. Local lab so với triển khai thật

| Chủ đề | Bài local | Khi deploy thật |
| --- | --- | --- |
| HTTPS Mobile/Web → API | Proxy local, chứng chỉ CA tự tạo, hostname local | Domain đã được cấp, chứng chỉ từ CA được thiết bị tin cậy, gia hạn tự động và gateway có ingress phù hợp |
| Gateway → Backend | Loopback cùng máy, Backend in-memory | Mạng riêng giữa gateway và service; giới hạn cổng Backend không truy cập trực tiếp từ Internet |
| Backend → PostgreSQL | PostgreSQL disposable, `verify-full`, CA local, hostname `localhost` | Database staging riêng, private networking, CA/hostname do nền tảng cấp và TLS handshake đã xác minh |
| Secrets | Fake mount tự xóa hoặc env development local | Managed secret mount/store, identity/IAM tối thiểu, audit và quy trình rotation |
| Chống truy cập ngoài ý muốn | Listener chỉ bind loopback | Firewall/ingress/rate limits, giám sát và quy trình ứng phó lưu lượng bất thường |
| Kết quả chứng minh | Học và xác minh cơ chế trên máy | Không thay thế staging, device E2E, backup/monitoring hay phê duyệt vận hành |

## Dọn dẹp và giới hạn

- Dừng API và proxy bằng Ctrl+C. Bài PostgreSQL tự xóa container; dữ liệu nằm trong tmpfs, không có volume lưu lại.
- Nếu đã import CA vào Current User trust store, gỡ đúng CA theo thumbprint. Không xóa các chứng chỉ khác.
- Sau khi học, xác minh đường dẫn `%LOCALAPPDATA%\BankingSystem\local-https-lab` rồi xóa riêng thư mục đó; nơi này chứa private key. Không xóa thư mục cha.
- Bài này không sửa `.env`, `.env.compose`, database preview hoặc Mobile EAS profiles. Không có cloud resources, API AI trả phí, migration hay dữ liệu giao dịch nào được dùng.
- HTTPS API probe và secret mount lab có thể chạy không cần network. PostgreSQL TLS live test chỉ chạy khi image đã có sẵn hoặc người dùng tự chọn tải image công khai.
- Kết quả local không chứng minh domain công khai, cấu hình TLS của host, IAM, staging secrets hoặc mức chống DDoS của dịch vụ Internet.

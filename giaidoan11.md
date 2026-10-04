# Giai đoạn 11 — Configuration / Runtime / Deployment

Tài liệu này tiếp nối [giaidoan10.md](C:/Projects/banking-system/giaidoan10.md).
Giai đoạn 10 giải thích test đang chứng minh điều gì; Giai đoạn 11 giải thích
project lấy cấu hình ở đâu, các process được khởi động thế nào, các process nói
chuyện với nhau qua port nào, và từ một máy mới có thể tái hiện preview local ra
sao.

Đây là tài liệu đọc hiểu source hiện tại. Tôi chỉ mô tả và minh họa bằng dữ liệu
giả; không sửa code/schema, không chạy migration, không ghi database, không bật
worker và không tuyên bố project đã được deploy lên staging hay production.
Repository tự mô tả là reference implementation dùng tiền ảo và dữ liệu
synthetic; vì vậy “production-like” trong tài liệu này là một bộ điều kiện
fail-closed để kiểm thử cấu hình, không phải bằng chứng hệ thống xử lý tiền thật.
Xem [README.md](C:/Projects/banking-system/README.md) và
[backend/README.md](C:/Projects/banking-system/backend/README.md) để phân biệt
preview local, database disposable và môi trường thật.

## Mục lục

1. Kiến thức nền: configuration, process, runtime, build và environment
2. Bản đồ runtime của toàn project
3. Các lệnh chạy, build và artifact
4. Biến môi trường: ai khai báo, ai đọc, sai thì chuyện gì xảy ra
5. Host, port và URL: Mobile/API/Admin nói chuyện với nhau thế nào
6. PostgreSQL và migration: database sẵn sàng trước ứng dụng ra sao
7. Docker Compose: các service được ghép thành một preview local thế nào
8. Worker và background lifecycle
9. Development, test, preview, staging và production-like khác nhau thế nào
10. Từ một máy mới đến preview local
11. Chẩn đoán lỗi startup và runtime
12. Build/deployment: source trở thành artifact và được kiểm tra thế nào
13. Bài tập tổng hợp

---

# 1. Kiến thức nền: configuration, process, runtime, build và environment

## 1.1. Configuration là gì?

Code trả lời câu hỏi “chương trình làm gì”. Configuration trả lời câu hỏi
“chương trình làm việc ở đâu và với tài nguyên nào”. Ví dụ cùng một code
`backend/src/server.ts` có thể:

```text
DATABASE_URL=postgresql://...@localhost:5432/banking_test
    → chạy trực tiếp trên máy phát triển

DATABASE_URL=postgresql://...@postgres:5432/banking_preview
    → chạy trong network Docker Compose, nơi host database tên là postgres
```

Code không đổi; chỉ địa chỉ database đổi. Vì vậy cấu hình là một phần của
runtime contract, không phải ghi chú phụ.

## 1.2. Process, service và runtime

- **Process** là một chương trình đang chạy, có PID, bộ nhớ và port riêng nếu
  nó mở network listener.
- **Service** là cách ta gọi process theo vai trò. Ví dụ service `backend` là
  process Node chạy Public API.
- **Runtime** là thời điểm code đã được nạp và đang phục vụ request. Nó bao gồm
  code, biến môi trường, filesystem, network, database và secret provider.
- **Environment** là bối cảnh có tên như `development`, `test`, `preview`,
  `staging` hoặc `production-like`.

Project dùng `backend/src/runtimeConfig.ts` để đọc `NODE_ENV` và `BANKING_ENV`,
kiểm tra giá trị hợp lệ rồi trả về `RuntimeConfig`. Hàm
`readRuntimeConfig()` chạy trước khi listener được mở; nếu cấu hình mâu thuẫn,
process dừng với exit code khác 0 thay vì chạy nửa đúng nửa sai.

## 1.3. Port, host và URL

```text
host = địa chỉ máy/interface nhận kết nối
port = “cửa” số của một process
URL = protocol + host + port + path

http://localhost:5000/api/v1
      └──────┬─────┘ └──┬──┘
           host:port   API path
```

`localhost` bên trong container là chính container đó, không phải máy host.
Ngược lại, Android emulator dùng `10.0.2.2` để đi tới máy phát triển. Đây là lý
do Mobile không dùng cùng một URL cho mọi môi trường.

## 1.4. Build-time và runtime

```text
Source TypeScript/React
        │ build
        ▼
JavaScript trong dist/ hoặc bundle Expo
        │ start + environment
        ▼
Process đang phục vụ request
```

Một giá trị **build-time** được đóng vào artifact khi build. Một giá trị
**runtime** được đưa vào lúc container/process khởi động. Admin Web được thiết
kế để `ADMIN_API_UPSTREAM` là runtime configuration của Nginx, không bị đóng
vào JavaScript bundle. Mobile `EXPO_PUBLIC_API_URL` lại được Expo đọc như public
build configuration; không được xem nó là secret.

## Câu hỏi tự kiểm tra phần 1

1. Process khác service ở điểm nào?
2. Vì sao `localhost` trong container không nhất thiết là máy host?
3. `DATABASE_URL` là code hay configuration?
4. Tại sao project cần phân biệt build-time và runtime?
5. Nếu `BANKING_ENV=production` bị từ chối thì đó là lỗi compile hay lỗi runtime?

---

# 2. Bản đồ runtime của toàn project

## 2.1. Sơ đồ tổng thể

```text
                         ┌─────────────────────────┐
                         │ PostgreSQL                │
                         │ container: 5432          │
                         │ volume: banking_preview  │
                         └────────────┬────────────┘
                                      │ DATABASE_URL
                                      ▼
┌──────────────┐   /api/v1   ┌──────────────────────┐
│ Mobile Expo  │────────────▶│ Public Backend API   │
│ emulator     │ :5000       │ src/server.ts        │
└──────────────┘             └──────────┬───────────┘
                                        │ outbox rows
                                        ▼
                              ┌──────────────────────┐
                              │ Worker (opt-in)       │
                              │ src/worker.ts         │
                              │ health :9091          │
                              └──────────────────────┘

┌──────────────┐ same-origin /api/v1 ┌──────────────────────┐
│ Admin Web    │────────────────────▶│ Admin API             │
│ Vite :5173   │   proxy/Nginx       │ src/adminServer.ts    │
└──────────────┘                     │ :5001                 │
                                     └──────────────────────┘

PostgreSQL startup path:
postgres healthy → migrate completed → backend/admin-api/worker start
```

Đây là sơ đồ process, không phải sơ đồ class. Class-level flow đã được giải
thích ở [giaidoan6.md](C:/Projects/banking-system/giaidoan6.md).

## 2.2. Bảng service và entry point

| Thành phần | Entry point hoặc image command | Port mặc định | Nhiệm vụ | Phụ thuộc chính |
| --- | --- | ---: | --- | --- |
| Public API | `backend/src/server.ts`; direct `npm start`, image `node dist/server.js` | 5000 | Mobile/customer HTTP API, health, metrics | PostgreSQL nếu `BANKING_STORAGE=postgres` |
| Admin API | `backend/src/adminServer.ts`; Compose `node dist/adminServer.js` | 5001 | Staff login, RBAC, four-eyes operations | PostgreSQL, invitation provider tùy chọn |
| Admin Web dev | Vite `admin-web/vite.config.ts` | 5173 | React control plane, proxy `/api` | Admin API upstream |
| Admin Web image | Nginx trong `admin-web/Dockerfile` | 8080 trong container, 5173 trên host Compose | Phục vụ static bundle và proxy `/api` | Admin API healthy |
| PostgreSQL | image `postgres:16@sha256:...` | 5432 container, 5433 host Compose | Lưu dữ liệu persistent local | volume `banking_preview_pgdata` |
| Migration job | `backend/scripts/apply-migration.cjs` | không mở port | Áp migration một lần trước API | PostgreSQL healthy |
| Outbox worker | `backend/src/worker.ts` | health 9091 | Claim/dispatch outbox, lifecycle scheduler | PostgreSQL, cutover flag |
| Email capture | `backend/scripts/email-capture.cjs` | 5700 | Giữ OTP synthetic trong memory local | Backend health/dependency |
| Invitation capture | `backend/scripts/admin-invitation-capture.cjs` | 8025 | Giữ link mời Admin synthetic local | Admin API dependency |

Tên và port trên lấy từ [compose.yaml](C:/Projects/banking-system/compose.yaml),
[backend/src/server.ts](C:/Projects/banking-system/backend/src/server.ts),
[backend/src/adminServer.ts](C:/Projects/banking-system/backend/src/adminServer.ts)
và các Dockerfile tương ứng.

## 2.3. Public Backend khởi động theo thứ tự nào?

Script `npm start` trong
[backend/package.json](C:/Projects/banking-system/backend/package.json) chạy:

```text
node --env-file-if-exists=.env --import=tsx src/server.ts
```

Khi file được import, `server.ts` làm các việc sau:

1. Gọi `readRuntimeConfig()` để kiểm tra environment, storage, persistence mode,
   money mode, fingerprint key và metadata build.
2. Đọc `PORT`, mặc định 5000, và `BANKING_ALLOWED_ORIGINS`.
3. Tạo `BankingSystem` với các cờ sandbox như
   `BANKING_SETTLE_IMMEDIATELY`.
4. Nếu storage là PostgreSQL, tạo secret provider, lấy database URL, tạo
   `PostgresRelationalRepository`, gọi `initialize()`, tạo email provider,
   encryption keyring, OTP digest keyring và `PersistentMfaService`.
5. Tạo `RelationalHttpBoundary`. Nếu persistence mode là `relational-v2`, gọi
   `assertRelationalV2Complete()` để không chạy thiếu route.
6. Gọi `createPersistentBankingServer(...)`; nếu storage là in-memory thì gọi
   `createBankingServer(...)`.
7. Gọi `repository.healthCheck()` nếu có repository.
8. Đặt `startupReady = true`, rồi `server.listen(port, "0.0.0.0", ...)`.
9. Đăng ký `SIGINT`/`SIGTERM` để đóng HTTP server và PostgreSQL repository.

Các bước này nằm trong [server.ts:38](C:/Projects/banking-system/backend/src/server.ts:38)
đến [server.ts:165](C:/Projects/banking-system/backend/src/server.ts:165). Điểm
quan trọng là listener chỉ mở sau khi cấu hình và database health đã vượt qua.

## 2.4. Admin API khởi động thế nào?

[adminServer.ts](C:/Projects/banking-system/backend/src/adminServer.ts) đọc:

```text
ADMIN_PORT   → 5001 nếu không cấu hình
ADMIN_BIND   → 127.0.0.1 khi chạy trực tiếp; Compose đặt 0.0.0.0
ADMIN_STORAGE → postgres mặc định
ADMIN_ALLOWED_ORIGINS → localhost:5173 trong local
```

Sau đó process tạo secret provider, chọn `InMemoryAdminRepository` hoặc
`PostgresAdminRepository`, gọi `initialize()`, tạo encryption adapter,
`StaffAuthService`, invitation provider và `AdminActionEngine`, rồi gọi
`createAdminServer(...)` và `server.listen(port, bind, ...)`. Môi trường
production-like bắt buộc PostgreSQL, exact HTTPS origins và invitation provider.

## 2.5. Mobile và Admin Web khởi động thế nào?

Mobile có `main: "index.ts"` trong
[mobile-app/package.json](C:/Projects/banking-system/mobile-app/package.json).
[mobile-app/index.ts](C:/Projects/banking-system/mobile-app/index.ts) gọi
`initializeNativeRuntime()`, nạp `@expo/metro-runtime`, lấy `App` từ Expo Router
và gọi `renderRootComponent(App)`. Expo Router sau đó nạp route trong
`mobile-app/src/app`.

Admin Web dev chạy `vite` từ
[admin-web/package.json](C:/Projects/banking-system/admin-web/package.json).
`vite.config.ts` mở server `127.0.0.1:5173`, lấy `ADMIN_API_UPSTREAM` và proxy
request `/api` tới upstream. Trình duyệt luôn gọi `/api/v1`; URL Admin API không
bị nhúng vào code React. Trong image, bundle được build một lần rồi Nginx đọc
`ADMIN_WEB_ENV` và `ADMIN_API_UPSTREAM` lúc container start.

## Câu hỏi tự kiểm tra phần 2

1. Public API chạy từ file nào và mặc định nghe port nào?
2. Service nào chạy migration trước Backend?
3. Admin Web gọi trực tiếp `http://localhost:5001` từ browser hay gọi path nào?
4. Vì sao `server.listen()` nằm sau `repository.healthCheck()`?
5. Worker có tự chạy khi chỉ gọi `npm start` không?

---

# 3. Các lệnh chạy, build và artifact

## 3.1. Backend: chạy source và chạy artifact

Trong [backend/package.json](C:/Projects/banking-system/backend/package.json):

| Lệnh | Ý nghĩa |
| --- | --- |
| `npm run dev` | Chạy `src/server.ts` bằng `tsx`, watch khi source đổi |
| `npm start` | Chạy `src/server.ts` bằng `tsx`, đọc `.env` nếu có |
| `npm run admin:dev` | Chạy `src/adminServer.ts` bằng `tsx` |
| `npm run build` | `tsc -p tsconfig.build.json`, tạo JavaScript trong `dist` |
| `npm run start:runtime` | Chạy artifact `dist/server.js` |
| `npm run start:admin` | Chạy artifact `dist/adminServer.js` |
| `npm run db:migrate` | Chạy Node script `scripts/apply-migration.cjs` |
| `npm run start:persistent` | Chạy migration rồi mới `npm start` |
| `npm run worker:dev` | Chạy `src/worker.ts` bằng `tsx`, watch |
| `npm run start:worker` | Chạy artifact `dist/worker.js` |

`tsx` giúp local chạy TypeScript trực tiếp. Container runtime không cần `tsx`:
[backend/Dockerfile](C:/Projects/banking-system/backend/Dockerfile) build ở
stage đầu, copy `dist`, SQL và production dependencies sang stage runtime rồi
chạy dưới user `node`.

## 3.2. Mobile và Admin Web

| Package | Lệnh thường dùng | Artifact hoặc runtime |
| --- | --- | --- |
| `mobile-app` | `npm start`, `npm run android`, `npm run web` | Expo Metro/native bundle; `npm run export:web` tạo web export |
| `mobile-app` | `npm run typecheck` | Generate route types rồi `tsc --noEmit` |
| `admin-web` | `npm run dev` | Vite dev server 5173 |
| `admin-web` | `npm run build` | `tsc -b` rồi Vite tạo `dist` |
| `admin-web` image | Docker build | Nginx phục vụ `dist` trên container port 8080 |

Build thành công chỉ chứng minh artifact tạo được. Nó chưa chứng minh
PostgreSQL reachable, origin đúng hoặc secret có thể đọc; các điều đó được kiểm
tra ở runtime.

## 3.3. Một lệnh không có nghĩa là toàn hệ thống đã chạy

Ví dụ `npm run build` ở Backend chỉ tạo `dist`. Để HTTP phục vụ request còn cần:

```text
build → có dist/server.js
database migration → có schema hiện tại
runtime env → có DATABASE_URL, key và origin hợp lệ
start → process mở port
health/readiness → process và dependency thật sự sẵn sàng
```

## Câu hỏi tự kiểm tra phần 3

1. `npm run build` có tự mở port 5000 không?
2. Vì sao image runtime dùng `dist/server.js` chứ không dùng `src/server.ts`?
3. `start:persistent` khác `start` ở bước nào?
4. Vite dev server và Nginx production image phục vụ cùng loại artifact nào?

---

# 4. Biến môi trường: ai khai báo, ai đọc, sai thì chuyện gì xảy ra

## 4.1. Hai cách nạp `.env`

Backend script thêm `--env-file-if-exists=.env`, nghĩa là Node đọc file `.env`
nếu file tồn tại. Compose lại đọc file do người vận hành chỉ định:

```powershell
docker compose --env-file .env.compose up -d --build
```

`.env.example` là mẫu để đọc, không tự được nạp nếu chưa copy thành `.env`.
`.env.compose.example` phải copy thành `.env.compose`; file copy chứa password
local và phải giữ ngoài Git.

## 4.2. Nhóm configuration chính

| Nhóm | Ví dụ | Nơi đọc | Ảnh hưởng |
| --- | --- | --- | --- |
| Runtime identity | `NODE_ENV`, `BANKING_ENV`, `BANKING_MONEY_MODE` | `runtimeConfig.ts` | Chọn policy và guard |
| Storage/persistence | `BANKING_STORAGE`, `BANKING_PERSISTENCE_MODE` | `server.ts`, repository, worker | In-memory/PostgreSQL và boundary legacy/relational |
| Database | `DATABASE_URL`, `DATABASE_SSL_MODE`, `DATABASE_SERVER_NAME`, `DATABASE_CA_CERT` | secret provider, pool, migration | Kết nối và xác minh TLS |
| Listener | `PORT`, `ADMIN_PORT`, `ADMIN_BIND`, `WORKER_HEALTH_PORT` | entry point | Cổng và interface lắng nghe |
| Origin/proxy | `BANKING_ALLOWED_ORIGINS`, `ADMIN_ALLOWED_ORIGINS`, `ADMIN_API_UPSTREAM` | HTTP, Vite, Nginx | CORS và proxy |
| MFA/secret | `BANKING_OTP_PEPPER`, `BANKING_MFA_ENCRYPTION_KEY`, key IDs | MFA crypto/provider | Hash OTP, mã hóa credential |
| Worker | `WORKER_ENABLED`, cutover, `OUTBOX_*`, scheduler | `worker.ts`, `workerRuntime.ts` | Poll, lease, retry, lifecycle |
| Mobile public | `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SANDBOX_HTTP` | `mobile-app/src/services/api/config.ts` | Địa chỉ API client và HTTPS guard |
| Build metadata | `BUILD_COMMIT_SHA`, `RELEASE_ID`, `IMAGE_DIGEST` | runtime metadata, health/version | Biết artifact nào đang chạy |

## 4.3. `readRuntimeConfig()` và fail-closed

[backend/src/runtimeConfig.ts](C:/Projects/banking-system/backend/src/runtimeConfig.ts)
định nghĩa các environment được phép:

```text
development | test | preview | staging | production-like
```

Các invariant quan trọng:

- `BANKING_MONEY_MODE` chỉ được là `virtual`.
- `BANKING_ENV=production` bị từ chối vì reference system không bật tiền thật.
- `BANKING_STORAGE` chỉ là `postgres` hoặc `in-memory`.
- `BANKING_PERSISTENCE_MODE` chỉ là `legacy-state` hoặc `relational-v2`.
- staging/production-like bắt buộc `NODE_ENV=production`, PostgreSQL,
  `relational-v2`, `DATABASE_SSL_MODE=verify-full`, `DATABASE_SERVER_NAME`,
  `BANKING_SECRET_PROVIDER=managed`, MFA TOTP, exact HTTPS origins, full
  `BUILD_COMMIT_SHA`, `RELEASE_ID` và SHA-256 `IMAGE_DIGEST`.
- Các biến OTP deterministic dành cho sandbox bị từ chối ngoài local.

Nếu một điều kiện sai, `readRuntimeConfig()` throw trước khi listener được mở.
Đó là chủ ý: process chết rõ ràng còn an toàn hơn server trả một phần request
với cấu hình không đáng tin.

## 4.4. Ví dụ cấu hình local giả

Đây là ví dụ học tập, không phải credential thật:

```text
NODE_ENV=development
BANKING_ENV=development
BANKING_MONEY_MODE=virtual
BANKING_STORAGE=postgres
BANKING_PERSISTENCE_MODE=relational-v2
DATABASE_URL=postgresql://demo:demo@localhost:5433/banking_preview
DATABASE_SSL_MODE=disable
PORT=5000
ADMIN_PORT=5001
BANKING_ALLOWED_ORIGINS=http://localhost:5173
EXPO_PUBLIC_API_URL=http://10.0.2.2:5000/api/v1
# Các secret local bắt buộc khi chạy persistent; đây chỉ là placeholder giả.
REGISTRATION_FINGERPRINT_KEY=base64:<32-byte-local-secret>
BANKING_OTP_PEPPER=base64:<32-byte-local-secret>
BANKING_MFA_ENCRYPTION_KEY=base64:<32-byte-local-secret>
```

Không copy chuỗi này vào staging. Secret như OTP pepper, MFA encryption key,
database password và provider token phải đi qua secret manager hoặc giá trị local
riêng, không commit.

## Câu hỏi tự kiểm tra phần 4

1. `.env.example` có phải secret đang được project nạp tự động không?
2. Ai đọc `BANKING_ENV` và kiểm tra nó?
3. Tại sao `BANKING_MONEY_MODE=real` bị từ chối?
4. Biến nào quyết định Public API dùng PostgreSQL hay in-memory?
5. Nếu thiếu `BANKING_MFA_ENCRYPTION_KEY` trong persistent local thì nên tìm lỗi ở compile hay startup?

---

# 5. Host, port và URL: Mobile/API/Admin nói chuyện với nhau thế nào

## 5.1. Bảng port trong preview Compose

| Thành phần | Port trong container | Port trên host | URL kiểm tra từ host |
| --- | ---: | ---: | --- |
| PostgreSQL | 5432 | 5433 mặc định | `postgresql://...@localhost:5433/...` |
| Public Backend | 5000 | 5000 | `http://localhost:5000/livez` |
| Admin API | 5001 | 5001 | `http://localhost:5001/livez` |
| Admin Web | 8080 | 5173 | `http://localhost:5173/readyz` |
| Email capture | 5700 | 5700 | `http://localhost:5700/readyz` |
| Invitation capture | 8025 | 8025 | `http://localhost:8025/readyz` |
| Worker health | 9091 | không publish mặc định | gọi trong network/container nếu cần |

Các mapping loopback `127.0.0.1:host:container` nằm trong
[compose.yaml](C:/Projects/banking-system/compose.yaml). Chúng giúp preview
local không vô tình mở database/API ra toàn mạng LAN.

## 5.2. Mobile URL và Android emulator

`mobile-app/src/services/api/config.ts` đặt fallback development:

```text
http://10.0.2.2:5000/api/v1
```

Khi chạy Android emulator, `10.0.2.2` là alias tới host development. Khi Mobile
chạy trên chính máy bằng web, thường dùng `http://localhost:5000/api/v1`. Khi
chạy thiết bị thật, `localhost` là điện thoại; cần địa chỉ host có thể truy cập
được và firewall phù hợp.

Hàm `resolveApiUrl()`:

1. dùng `EXPO_PUBLIC_API_URL` nếu đã cấu hình;
2. dùng fallback emulator khi development;
3. throw nếu production thiếu URL;
4. throw nếu URL không phải HTTP(S);
5. yêu cầu HTTPS trong production, trừ khi cờ sandbox HTTP được bật.

Source: [mobile-app/src/services/api/config.ts](C:/Projects/banking-system/mobile-app/src/services/api/config.ts).

## 5.3. Admin Web proxy

Browser gọi:

```text
GET /api/v1/...
```

`admin-web/src/api.ts` dùng `const API_BASE = "/api/v1"` và
`credentials: "include"`, nên cookie HttpOnly ở cùng origin được gửi. Dev Vite
proxy `/api` tới `ADMIN_API_UPSTREAM`; container Nginx render cùng upstream lúc
start. Cách này tránh nhúng địa chỉ Admin API khác nhau vào bundle JavaScript.

`ADMIN_API_UPSTREAM` phải là một origin tuyệt đối, không có credential, path,
query hay fragment. `admin-web/docker-entrypoint.d/10-validate-runtime-config.sh`
cho phép HTTP ở preview nhưng bắt HTTPS ở staging/production-like.

## 5.4. CORS và cookie không phải là một thứ

- `BANKING_ALLOWED_ORIGINS` kiểm soát browser origin được Public API chấp nhận.
- `ADMIN_ALLOWED_ORIGINS` kiểm soát origin của Admin Web.
- Proxy same-origin làm Admin Web giảm nhu cầu CORS trực tiếp.
- Cookie/session và CSRF của Admin vẫn do Admin API quyết định; đổi port không
  tự cấp quyền.

## Câu hỏi tự kiểm tra phần 5

1. Vì sao Android emulator dùng `10.0.2.2` thay vì `localhost`?
2. Browser Admin gọi URL upstream hay path `/api/v1`?
3. Port host 5173 ánh xạ tới port nào trong Admin Web container?
4. `BANKING_ALLOWED_ORIGINS` có thay thế authentication không?

---

# 6. PostgreSQL và migration: database sẵn sàng trước ứng dụng ra sao

## 6.1. Hai loại database URL cần phân biệt

```text
DATABASE_URL
  → database runtime mà API/Admin/worker sử dụng

DATABASE_TEST_ADMIN_URL
  → connection maintenance cho runner tạo database disposable của test
```

`DATABASE_TEST_ADMIN_URL` không được trỏ vào preview database. Guard yêu cầu
`NODE_ENV=test`, `BANKING_ENV=test`, `ALLOW_DATABASE_TEST_RESET=1`, host được
allow và database có tên `banking_test_<suffix>`. Đây là bảo vệ của test, không
phải đường startup production.

## 6.2. `start:persistent` là một pipeline nhỏ

Trong `backend/package.json`:

```text
npm run start:persistent
  → npm run db:migrate
  → npm start
```

Nếu migration fail, shell không nên đi tiếp tới server. Với Compose, pipeline
tách thành service `migrate`; `backend`, `admin-api` và `worker` khai báo
`depends_on` với điều kiện `service_completed_successfully`.

## 6.3. `apply-migration.cjs` làm gì?

Script [backend/scripts/apply-migration.cjs](C:/Projects/banking-system/backend/scripts/apply-migration.cjs)
thực hiện các bước:

1. Yêu cầu `DATABASE_URL`.
2. Đọc các file `backend/database/NNN_*.sql`, sort theo số thứ tự.
3. Canonicalize SQL, tính checksum từng migration và migration-set digest.
4. Tạo hoặc kiểm tra bảng `reference_schema_migrations`.
5. Đọc các migration đã áp dụng, tìm migration còn thiếu và checksum lệch.
6. Với mỗi migration mới, mở `BEGIN`, lấy advisory transaction lock theo key,
   kiểm tra migration đã ghi chưa và kiểm tra bảng dự kiến không tồn tại ngoài
   lịch sử.
7. Chạy SQL, ghi key/checksum/release/commit/image metadata, rồi `COMMIT`.
8. Nếu có lỗi, `ROLLBACK`; cuối cùng đóng pool bằng `pool.end()`.

Nếu migration đã áp dụng với nội dung khác, runner dừng thay vì tự đoán. Nếu
database có bảng nhưng chưa có record migration tương ứng, runner cũng dừng để
người vận hành điều tra. Đây là lý do migration trong project là forward-only:
không sửa file SQL cũ đã áp dụng để “chữa nhanh”.

## 6.4. Ba mode hữu ích

```powershell
npm run db:migrate -- --plan
npm run db:migrate -- --verify-only
npm run db:migrate
```

- `--plan` đọc trạng thái và in pending/checksum mismatch, không apply.
- `--verify-only` yêu cầu schema đã đủ, fail nếu còn migration pending.
- mode mặc định apply migration trong transaction từng migration.

Tài liệu này không chạy các lệnh trên; chúng chỉ là cách đọc ý nghĩa script.

## 6.5. Vì sao migration đứng trước API?

```text
Postgres process
   ↓ healthcheck pg_isready
migrate service
   ↓ schema + constraints + migration evidence
backend/admin/worker
   ↓ repository.initialize() và health check
listener nhận request
```

Nếu API mở trước schema, request đầu tiên có thể gặp “table does not exist” hoặc
schema cũ. Compose dùng healthcheck và dependency condition để làm thứ tự này
rõ ràng.

## Câu hỏi tự kiểm tra phần 6

1. `DATABASE_TEST_ADMIN_URL` có phải URL mà Public API dùng khi chạy bình thường không?
2. Migration được đánh dấu đã áp dụng ở bảng nào?
3. Khi checksum của migration đã áp dụng đổi, runner làm gì?
4. `ROLLBACK` xảy ra khi nào?
5. Vì sao Backend phụ thuộc `migrate` thay vì chỉ phụ thuộc `postgres` healthy?

---

# 7. Docker Compose: các service được ghép thành một preview local thế nào

## 7.1. Các service trong `compose.yaml`

```text
postgres
  └─ healthy
      └─ migrate (one-shot)
          ├─ backend
          ├─ admin-api ── invitation-capture healthy
          ├─ worker (profile worker, opt-in)
          └─ admin-web (sau admin-api healthy)

email-capture ── backend dependency cho OTP HTTP local
```

`postgres` dùng image PostgreSQL 16 được pin bằng digest và volume named
`banking_preview_pgdata`. `migrate`, Backend, Admin API và worker đều build từ
`backend/Dockerfile`; Admin Web build từ `admin-web/Dockerfile`.

## 7.2. Lệnh preview được tài liệu hóa

```powershell
Copy-Item .env.compose.example .env.compose
# sửa placeholder/password/key chỉ trong file local
docker compose --env-file .env.compose up -d --build
docker compose --env-file .env.compose ps
docker compose --env-file .env.compose exec backend node scripts/container-smoke.cjs
```

Các lệnh này nằm trong [README.md](C:/Projects/banking-system/README.md) và
[backend/README.md](C:/Projects/banking-system/backend/README.md). Tài liệu này
không chạy chúng vì yêu cầu hiện tại chỉ là viết tài liệu.

## 7.3. Healthcheck và `depends_on`

Compose không chỉ “start tất cả cùng lúc”. Nó chờ:

- `pg_isready` cho PostgreSQL;
- migration exit code 0;
- `/readyz` của Backend;
- `/livez` của Admin API;
- `/readyz` của Admin Web;
- capture services healthy.

Healthcheck giúp Docker biết process còn sống hoặc đã sẵn sàng. Nó không thay
thế authorization, business assertion hay test device.

## 7.4. Capture service và dữ liệu local

`email-capture` và `invitation-capture` chỉ giữ dữ liệu synthetic trong memory.
Chúng không gửi email ra Internet, không phải provider staging/production và
không được dùng để suy ra delivery production hoạt động.

## 7.5. Dừng stack an toàn

```powershell
docker compose --env-file .env.compose stop
docker compose --env-file .env.compose down
```

`stop` dừng container; `down` xóa container/network nhưng giữ volume nếu không
thêm `--volumes`. Không dùng `down --volumes` khi chưa quyết định xóa dữ liệu
preview. Tuyệt đối không dùng thao tác tương tự lên database không xác minh được
ownership.

## Câu hỏi tự kiểm tra phần 7

1. Service nào tạo schema một lần rồi kết thúc?
2. Vì sao `admin-web` chờ `admin-api` healthy?
3. Volume `banking_preview_pgdata` giữ loại dữ liệu nào?
4. Worker có nằm trong nhóm service mặc định không?
5. `docker compose down` khác `down --volumes` ở đâu?

---

# 8. Worker và background lifecycle

## 8.1. Worker không phải Public API thứ hai

Worker xử lý công việc nền đã được ghi durable trong outbox, ví dụ notification
delivery hoặc scheduled lifecycle. Public API ghi business state và outbox
intent; worker claim event, dispatch provider, retry hoặc dead-letter.

```text
HTTP request
  → transaction business + outbox_events
  → COMMIT
  → WorkerRuntime.start()
  → claim lease
  → dispatch provider
  → retry / success / dead-letter
```

Các class chính nằm ở
[backend/src/worker.ts](C:/Projects/banking-system/backend/src/worker.ts),
[backend/src/workers/workerRuntime.ts](C:/Projects/banking-system/backend/src/workers/workerRuntime.ts)
và [backend/src/workers/workerHealth.ts](C:/Projects/banking-system/backend/src/workers/workerHealth.ts).

## 8.2. Điều kiện để worker được phép start

`worker.ts` kiểm tra theo thứ tự:

1. `WORKER_ENABLED` phải bằng `1`.
2. `assertWorkerCutoverConfirmed()` yêu cầu `WORKER_CUTOVER_CONFIRMED=1`.
3. Đọc runtime config và lấy database secret.
4. Tạo `WorkerConfig` từ `workerConfigFromEnv()`.
5. Tạo provider set (push/email fake hoặc disabled trong reference).
6. Tạo `WorkerRuntime`, gọi `initialize()`.
7. Mở `WorkerHealthServer` trên `WORKER_HEALTH_PORT` (mặc định 9091).
8. Đăng ký SIGINT/SIGTERM, rồi gọi `runtime.start()`.

Hai guard đầu giải thích vì sao worker preview mặc định chưa chạy: HTTP legacy
writer có thể ghi đè state worker. Compose đặt worker trong profile `worker` và
đặt `WORKER_CUTOVER_CONFIRMED=0` mặc định. Bật profile không tự vượt qua guard.

## 8.3. Các tham số loop

`workerConfigFromEnv()` đọc:

| Biến | Mặc định | Ý nghĩa |
| --- | ---: | --- |
| `OUTBOX_POLL_INTERVAL_MS` | 1000 | Khoảng cách giữa các tick |
| `OUTBOX_BATCH_SIZE` | 50 | Số event claim mỗi lượt |
| `OUTBOX_CONCURRENCY` | 10 | Số handler chạy song song |
| `OUTBOX_LEASE_SECONDS` | 60 | Thời gian lease trước khi reclaim |
| `OUTBOX_MAX_ATTEMPTS` | 8 | Số lần thử tối đa |
| `WORKER_HEARTBEAT_INTERVAL_MS` | 10000 | Nhịp heartbeat worker |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | 25000 | Thời gian drain trước khi đóng |
| `SCHEDULED_LIFECYCLE_ENABLED` | 0 | Có bật scheduler maturity/statement không |

Constructor `WorkerRuntime` còn bảo đảm lease phải dài hơn poll interval và
refuse legacy persistence writer nếu chưa được cho phép.

## 8.4. Worker health

`WorkerHealthServer` cung cấp:

- `/livez`: process còn phục vụ health;
- `/startupz`: `runtime.health()` đã initialize chưa;
- `/versionz`: worker id/version, commit, image digest, environment;
- `/metrics`: Prometheus text;
- `/readyz` và `/healthz`: trạng thái database, heartbeat, lifecycle và metrics.

Worker health bind `127.0.0.1` trong container. Compose healthcheck gọi
`http://127.0.0.1:9091/readyz` từ bên trong container.

## Câu hỏi tự kiểm tra phần 8

1. Tại sao worker cần `WORKER_CUTOVER_CONFIRMED=1`?
2. Worker đọc dữ liệu trực tiếp từ Mobile hay từ bảng outbox?
3. `OUTBOX_BATCH_SIZE` và `OUTBOX_CONCURRENCY` khác nhau thế nào?
4. Endpoint nào cho biết worker đã initialize?
5. Vì sao bật Compose profile chưa đủ để worker chạy?

---

# 9. Development, test, preview, staging và production-like khác nhau thế nào

## 9.1. Bảng môi trường

| `BANKING_ENV` | Mục đích | Lưu trữ | Điều kiện nổi bật | Có phải production thật không? |
| --- | --- | --- | --- | --- |
| `development` | Học và chạy local | PostgreSQL hoặc in-memory | Cấu hình local, origin có thể HTTP | Không |
| `test` | Unit/integration/disposable | Database test được guard | Reset có allowlist và tên disposable | Không |
| `preview` | Compose local rehearsal | PostgreSQL local, tiền ảo | Compatibility local, capture provider | Không |
| `staging` | Kiểm tra production-like contract | PostgreSQL | Node production, TLS verify-full, managed secrets, relational-v2 | Chưa; vẫn virtual-money reference |
| `production-like` | Kiểm tra guard chặt nhất | PostgreSQL | Thêm metadata/image/origin/MFA đầy đủ | Chưa; không hỗ trợ `BANKING_ENV=production` |

## 9.2. Những điều production-like bắt buộc

Trong [runtimeConfig.ts](C:/Projects/banking-system/backend/src/runtimeConfig.ts),
staging/production-like phải có:

```text
NODE_ENV=production
BANKING_STORAGE=postgres
BANKING_PERSISTENCE_MODE=relational-v2
BANKING_SECRET_PROVIDER=managed
DATABASE_SSL_MODE=verify-full
DATABASE_SERVER_NAME=<hostname chính xác>
BANKING_MFA_REQUIRED=1
BANKING_MFA_METHODS=TOTP
BANKING_ALLOWED_ORIGINS=<exact HTTPS origins>
BUILD_COMMIT_SHA=<40 ký tự SHA>
RELEASE_ID=<release identifier>
IMAGE_DIGEST=sha256:<64 hex chars>
```

Wildcard origin, deterministic OTP, local relational route flag và database
không phải PostgreSQL đều bị từ chối. Money mode vẫn chỉ là `virtual`.

## 9.3. Preview không phải staging

`.env.compose.example` dùng `BANKING_ENV=preview`, local secret/provider và
database trong network Docker. `README.md` gọi đây là `UNTRUSTED LOCAL PREVIEW`.
Preview chứng minh ta có thể tái hiện stack; nó không chứng minh TLS managed,
external email, monitoring, device evidence, core-banking partner hoặc legal
approval.

## 9.4. Test database phải disposable

Test persistence dùng runner tạo database dạng `banking_test_<suffix>`, apply
migration, chạy một suite rồi cleanup. Guard không cho reset database preview.
Đây là lý do không được lấy URL từ `.env.compose` để chạy destructive test.

## Câu hỏi tự kiểm tra phần 9

1. `preview` khác `staging` ở những dependency nào?
2. Vì sao `NODE_ENV=production` không tự đồng nghĩa tiền thật?
3. Production-like yêu cầu `relational-v2` để giải quyết rủi ro gì?
4. Tên database test phải có dạng gì?
5. Preview local có đủ để tuyên bố production-ready không?

---

# 10. Từ một máy mới đến preview local

Phần này là runbook học tập. Các lệnh dưới đây là hướng dẫn tái hiện; không có
nghĩa chúng đã được chạy trong phiên viết tài liệu này.

## 10.1. Chuẩn bị

1. Cài Git, PowerShell và Docker Desktop.
2. Cài Node tương thích với image/repository; Backend Dockerfile dùng Node 22.
   Mobile/Admin có manifest riêng nên sau đó cài dependency ở từng thư mục.
3. Clone repository và mở PowerShell tại root `C:\Projects\banking-system`.
4. Kiểm tra `git status`; không ghi đè các file WIP hiện có.

## 10.2. Tạo cấu hình Compose local

```powershell
Copy-Item .env.compose.example .env.compose
```

Mở `.env.compose` và thay password/key placeholder bằng giá trị local riêng.
Giữ:

```text
BANKING_ENV=preview
NODE_ENV=preview
BANKING_MONEY_MODE=virtual
DATABASE_SSL_MODE=disable
DATABASE_URL=...@postgres:5432/banking_preview
ADMIN_API_UPSTREAM=http://admin-api:5001
```

Không dùng `localhost` trong `DATABASE_URL` của container Compose: bên trong
network, hostname database là `postgres`.

## 10.3. Kiểm tra file Compose trước khi start

```powershell
docker compose --env-file .env.compose config
```

Lệnh này render cấu hình sau khi thay biến. Nếu gặp “is required”, một biến có
`${VAR:?message}` chưa được cung cấp. Không dán output chứa password/token vào
issue hoặc tài liệu.

## 10.4. Khởi động theo dependency graph

```powershell
docker compose --env-file .env.compose up -d --build
docker compose --env-file .env.compose ps
```

Đợi `postgres` healthy, `migrate` exited 0, rồi Backend/Admin API/Admin Web
healthy. Nếu cần smoke:

```powershell
docker compose --env-file .env.compose exec backend node scripts/container-smoke.cjs
```

## 10.5. Kiểm tra bằng HTTP từ máy host

```powershell
Invoke-WebRequest http://127.0.0.1:5000/livez
Invoke-WebRequest http://127.0.0.1:5000/readyz
Invoke-WebRequest http://127.0.0.1:5001/livez
Invoke-WebRequest http://127.0.0.1:5173/readyz
```

`livez=200` chỉ nói process sống. `readyz=200` còn nói dependency/config cần
thiết đã sẵn sàng.

## 10.6. Cài package để chạy client dev

```powershell
cd backend
npm install
cd ..\admin-web
npm install
cd ..\mobile-app
npm install
```

Có thể chạy Admin Web dev độc lập với:

```powershell
$env:ADMIN_API_UPSTREAM = "http://127.0.0.1:5001"
npm run dev
```

Mobile Android emulator dùng:

```powershell
$env:EXPO_PUBLIC_API_URL = "http://10.0.2.2:5000/api/v1"
npm start
```

Các biến public này không chứa secret. Device thật cần địa chỉ host có thể truy
cập được; `localhost` trên device không trỏ về PC.

## 10.7. Dừng và giữ dữ liệu

```powershell
docker compose --env-file .env.compose stop
docker compose --env-file .env.compose down
```

Chỉ thêm `--volumes` khi đã quyết định xóa volume preview. Không dùng database
preview cho destructive test.

## Câu hỏi tự kiểm tra phần 10

1. Vì sao Compose `DATABASE_URL` dùng host `postgres` còn direct local dùng `localhost`?
2. `docker compose config` giúp phát hiện lỗi nào?
3. Migration service phải có trạng thái gì trước Backend?
4. `livez` và `readyz` khác nhau thế nào?
5. Biến nào Mobile Android emulator cần để gọi API local?

---

# 11. Chẩn đoán lỗi startup và runtime

## 11.1. Bảng triệu chứng

| Triệu chứng | Nơi kiểm tra đầu tiên | Nguyên nhân thường gặp | Cách suy luận |
| --- | --- | --- | --- |
| Compose báo biến required | `.env.compose`, `docker compose config` | Thiếu `DATABASE_URL`, password, MFA key hoặc origin | Compose chưa tạo container đúng env |
| `migrate` exit 1 | `docker compose logs migrate` | DB chưa reachable, checksum mismatch, SQL lỗi | Backend chưa nên start |
| Backend `503 /readyz` | `docker compose logs backend`, `/versionz` | PostgreSQL, schema, provider hoặc key lỗi | Process có thể sống nhưng dependency chưa ready |
| Port 5000/5001/5173 bận | `docker compose ps`, `Get-NetTCPConnection` | Process khác đang giữ port | Đổi host port, không đổi container port tùy tiện |
| Mobile timeout | `EXPO_PUBLIC_API_URL`, emulator/device network | Dùng `localhost` trên device, API chưa listen, firewall | Kiểm tra URL từ đúng môi trường client |
| Admin UI gọi 404 | `ADMIN_API_UPSTREAM`, Vite/Nginx log | Upstream có path dư hoặc Admin API chưa healthy | Browser phải gọi `/api/v1`, proxy mới nối upstream |
| Admin CORS/CSRF lỗi | `ADMIN_ALLOWED_ORIGINS`, cookie, same-origin | Origin không allow, secure cookie sai HTTP local | Authentication và proxy là hai lớp khác nhau |
| Worker dừng ngay | `WORKER_ENABLED`, `WORKER_CUTOVER_CONFIRMED` | Chưa bật hoặc chưa xác nhận cutover | Đây là guard có chủ ý |
| TLS database fail | `DATABASE_SSL_MODE`, server name, CA | Dùng `verify-full` thiếu CA/hostname hoặc dùng disable ngoài local | Đối chiếu environment contract |

## 11.2. Trình tự debug an toàn

```text
1. docker compose ps
2. xem logs của service đúng tên, không in secret
3. kiểm tra /livez rồi /readyz
4. kiểm tra /versionz để biết commit/release/image
5. đối chiếu biến trong .env.example và runtimeConfig.ts
6. chỉ sau đó kiểm tra request cụ thể
```

Đừng bắt đầu bằng việc xóa volume hoặc reset database. Startup failure thường là
thiếu biến, sai hostname, schema chưa migrate hoặc guard từ chối cấu hình.

## 11.3. Ví dụ suy luận

```text
/livez = 200, /readyz = 503
→ Node listener đang sống
→ readiness check thất bại
→ kiểm tra PostgreSQL/healthCheck/provider, chưa cần sửa Mobile
```

```text
Admin Web mở được nhưng request /api/v1 = 502
→ static Nginx đã phục vụ
→ proxy upstream không tới Admin API
→ kiểm tra ADMIN_API_UPSTREAM và admin-api health
```

## Câu hỏi tự kiểm tra phần 11

1. `livez=200` có chứng minh database đã sẵn sàng không?
2. Khi `migrate` fail, có nên sửa Mobile trước không?
3. Worker exit vì `WORKER_CUTOVER_CONFIRMED=0` là bug ngẫu nhiên hay guard?
4. Vì sao không nên xóa volume ngay khi thấy `readyz=503`?

---

# 12. Build/deployment: source trở thành artifact và được kiểm tra thế nào

## 12.1. Backend image

[backend/Dockerfile](C:/Projects/banking-system/backend/Dockerfile) dùng ba
stage:

```text
build
  → npm ci
  → copy src + database
  → typecheck + tsc build
  → dist

production-dependencies
  → npm ci --omit=dev

runtime
  → copy dist + SQL + Node scripts
  → USER node
  → healthcheck /healthz
  → CMD node dist/server.js
```

Build args `COMMIT_SHA`, `RELEASE_ID`, `BUILD_CREATED_AT` và
`API_CONTRACT_DIGEST` được ghi vào image label/environment để `/versionz` và
release evidence biết artifact nào đang chạy.

## 12.2. Admin Web image

[admin-web/Dockerfile](C:/Projects/banking-system/admin-web/Dockerfile):

```text
Node build stage: npm ci → npm run build → dist/
Nginx stage: copy dist → copy template + entrypoint validator
container start: validate ADMIN_WEB_ENV/ADMIN_API_UPSTREAM → render nginx.conf
listen: port 8080 dưới user nginx
```

Không truyền `ADMIN_API_UPSTREAM` như Vite build arg. Địa chỉ upstream là
runtime config, vì cùng một bundle có thể chạy preview hoặc môi trường khác với
origin được kiểm tra phù hợp.

## 12.3. Mobile artifact

Expo tạo bundle/native build từ `mobile-app`. `EXPO_PUBLIC_API_URL` là giá trị
public cần được cung cấp cho development/EAS environment; production bắt buộc
HTTPS. Không đưa access token, refresh token, OTP, PIN, database URL hoặc key
vào public bundle.

## 12.4. Trình tự deployment contract (mô tả, chưa thực hiện)

```text
1. Chọn commit đã review
2. Build image/bundle với metadata
3. Verify typecheck, test, contract, secret/image/release gate
4. Chạy migration job trên database đích, kiểm tra checksum
5. Chỉ start API/Admin/worker sau migration thành công
6. Kiểm tra /livez, /startupz, /readyz, /versionz và metrics
7. Kiểm tra smoke/E2E phù hợp môi trường
8. Ghi lại commit SHA, image digest, migration-set digest và evidence
```

Rollback không phải “sửa migration cũ cho giống version trước”. Cần dùng release
và migration rollback strategy đã được owner phê duyệt; migration trong project
là forward-only và runner cố ý từ chối checksum đã thay đổi.

## 12.5. Giới hạn của project hiện tại

Các file release/runbook trong `documents/07-release` mô tả contract và rehearsal,
nhưng README ghi rõ repository chưa có bằng chứng cloud/staging/production, core
banking partner, KYC thật, signing đầy đủ hoặc legal/compliance approval. Vì vậy
không được biến quy trình local Compose thành tuyên bố đã triển khai production.

## Câu hỏi tự kiểm tra phần 12

1. Backend runtime image lấy code từ `src` hay `dist`?
2. Tại sao Admin API upstream được render lúc Nginx start?
3. Migration có nằm trong artifact Backend không?
4. `/versionz` giúp liên hệ health với artifact nào?
5. Vì sao sửa migration cũ không phải chiến lược rollback an toàn?

---

# 13. Bài tập tổng hợp

Hãy thử trả lời mà chưa mở source, sau đó đối chiếu các liên kết trong tài liệu.

## Bài 1 — Từ máy mới đến request Mobile

Điền các ô còn thiếu:

```text
Copy .env.compose.example
  → docker compose tạo ________
  → service ________ apply SQL
  → Public API nghe host port ________
  → Android emulator gọi ________/api/v1
```

Đáp án cần nhắc tới `postgres`, `migrate`, `5000` và `10.0.2.2`.

## Bài 2 — Tại sao `/readyz` chưa xanh?

Giả sử:

```text
/livez = 200
/readyz = 503
migrate = exited 1
```

Hãy viết thứ tự điều tra. Câu trả lời tốt phải bắt đầu ở log `migrate`/database,
không bắt đầu bằng việc sửa màn hình Mobile.

## Bài 3 — Worker có được chạy không?

Với cấu hình:

```text
WORKER_ENABLED=1
WORKER_CUTOVER_CONFIRMED=0
BANKING_PERSISTENCE_MODE=relational-v2
```

Worker vẫn dừng. Hãy chỉ rõ guard nào dừng nó và tại sao guard này bảo vệ dữ
liệu khi HTTP legacy writer chưa được xác nhận đã tắt.

## Bài 4 — Direct local và Compose

So sánh hai URL:

```text
postgresql://demo:demo@localhost:5433/banking_preview
postgresql://demo:demo@postgres:5432/banking_preview
```

URL đầu dành cho process chạy ở đâu? URL sau dành cho process chạy ở đâu? Vì sao
port khác nhau dù cùng một PostgreSQL container?

## Bài 5 — Build hay runtime?

Phân loại:

```text
BUILD_COMMIT_SHA
ADMIN_API_UPSTREAM
EXPO_PUBLIC_API_URL
BANKING_ALLOWED_ORIGINS
```

Một giá trị có thể được kiểm tra ở nhiều thời điểm; hãy giải thích nơi source
đọc nó và lỗi quan sát được nếu sai.

## Bản đồ source để quay lại đọc

- [backend/package.json](C:/Projects/banking-system/backend/package.json) — script
  dev/build/start/migrate/worker.
- [backend/src/server.ts](C:/Projects/banking-system/backend/src/server.ts) — Public
  API startup.
- [backend/src/adminServer.ts](C:/Projects/banking-system/backend/src/adminServer.ts)
  — Admin API startup.
- [backend/src/worker.ts](C:/Projects/banking-system/backend/src/worker.ts) — worker
  startup guard và shutdown.
- [backend/src/runtimeConfig.ts](C:/Projects/banking-system/backend/src/runtimeConfig.ts)
  — environment contract/fail-closed.
- [backend/scripts/apply-migration.cjs](C:/Projects/banking-system/backend/scripts/apply-migration.cjs)
  — migration ordering/checksum/transaction.
- [backend/src/http.ts](C:/Projects/banking-system/backend/src/http.ts) — public
  health, readiness và API boundary.
- [backend/src/workers/workerHealth.ts](C:/Projects/banking-system/backend/src/workers/workerHealth.ts)
  — worker health/metrics.
- [mobile-app/index.ts](C:/Projects/banking-system/mobile-app/index.ts) — Expo entry.
- [mobile-app/src/services/api/config.ts](C:/Projects/banking-system/mobile-app/src/services/api/config.ts)
  — Mobile API URL/HTTPS guard.
- [admin-web/vite.config.ts](C:/Projects/banking-system/admin-web/vite.config.ts)
  — dev proxy.
- [admin-web/src/api.ts](C:/Projects/banking-system/admin-web/src/api.ts) — browser
  same-origin API client.
- [compose.yaml](C:/Projects/banking-system/compose.yaml) — service graph, ports,
  healthcheck và environment mapping.
- [backend/Dockerfile](C:/Projects/banking-system/backend/Dockerfile) và
  [admin-web/Dockerfile](C:/Projects/banking-system/admin-web/Dockerfile) — build
  và runtime image.

Sau Giai đoạn 11, mục tiêu không phải là nhớ mọi biến môi trường. Mục tiêu là
khi thấy một process không chạy, bạn biết lần theo chuỗi:

```text
command
→ entry point
→ environment reader
→ dependency (database/provider/proxy)
→ listener
→ health/readiness
→ client URL
```

Chuỗi này là cầu nối để sang Giai đoạn 12: tự làm một thay đổi nhỏ mà vẫn biết
phải cập nhật code, configuration, migration, test và cách chạy ở đâu.

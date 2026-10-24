# HTTPS và secrets — trạng thái sẵn sàng cho demo học thuật

Ngày cập nhật: 2026-10-05

## Kết luận

Các guard cấu hình trong repository đã được hoàn thiện và kiểm thử offline. Trạng thái triển khai thực tế vẫn là **NOT_PROVISIONED / NOT_VERIFIED**: chưa có domain, TLS gateway, staging cloud, PostgreSQL staging hoặc Secret Manager được chọn và cấu hình. Vì vậy tài liệu này không xác nhận staging hay production đã sẵn sàng.

**Ràng buộc chi phí của Owner (2026-10-05): không được phát sinh bất kỳ khoản phí nào.** Ràng buộc này loại trừ việc tạo hoặc bật tài nguyên cloud, domain, database, Secret Manager, chứng chỉ hay dịch vụ có thể tính phí; free tier/trial cũng không được xem là bảo đảm chi phí bằng 0. Chỉ có thể tiếp tục kiểm chứng staging hosted nếu đã có sẵn hạ tầng do trường/đơn vị cung cấp và xác nhận rõ không phát sinh chi phí biên. Hiện workspace không có bằng chứng về một môi trường như vậy, nên Pha B vẫn `NOT RUN`.

Đây là banking reference project dùng tiền ảo và dữ liệu demo. Những thay đổi dưới đây hỗ trợ cấu hình demo an toàn; chúng không biến Backend thành hệ thống ngân hàng production.

## Những gì repository hiện bảo vệ

### Mobile và API URL

- [app.config.js](../../mobile-app/app.config.js) ánh xạ EAS profile sang môi trường runtime, từ chối profile/`APP_VARIANT` mâu thuẫn và chỉ bật Android cleartext cho local sandbox.
- [eas.json](../../mobile-app/eas.json) đặt `APP_VARIANT=local-sandbox` cùng `EXPO_PUBLIC_SANDBOX_HTTP=1` cho development/preview; staging/production dùng variant tương ứng và cờ `0`.
- [config.ts](../../mobile-app/src/services/api/config.ts) chỉ cho HTTP khi môi trường là local sandbox, cờ được bật rõ ràng và hostname là loopback/emulator (`localhost`, `127.0.0.1`, `::1`, `10.0.2.2`). Staging/production từ chối HTTP và từ chối cờ sandbox. `EXPO_PUBLIC_API_URL` là URL công khai của API, không phải nơi chứa credential.
- [.env.example](../../mobile-app/.env.example) mô tả cấu hình local và chỗ đặt URL HTTPS khi có môi trường staging. File này chỉ là ví dụ, không chứa secret triển khai.

### Backend, TLS và cơ sở dữ liệu

- Backend hiện dùng Node HTTP. [Hợp đồng staging](../../infrastructure/staging/provider-neutral/contract.yaml) yêu cầu TLS kết thúc ở gateway có chứng chỉ khớp hostname, ưu tiên TLS 1.3 và cho phép TLS 1.2 tương thích; giao thức cũ và truy cập công khai trực tiếp vào cổng Backend bị cấm.
- Hợp đồng giữ hop từ gateway tới Backend trong mạng riêng; Admin Web phải kiểm tra TLS tới Admin API.
- [runtimeConfig.ts](../../backend/src/runtimeConfig.ts) yêu cầu `DATABASE_SSL_MODE=verify-full`, tên máy chủ PostgreSQL, Secret Provider managed và các cấu hình staging cần thiết trước khi mở service. PostgreSQL `verify-full` cần CA tin cậy cùng hostname chính xác.
- Hợp đồng provider-neutral chỉ mô tả yêu cầu triển khai. Chưa có kiểm chứng TLS handshake từ Web/emulator tới một host thật.

### Secret inventory và quyền cấp theo service

- [secret-registry.yaml](./secret-registry.yaml) hiện kiểm kê 11 `secretId` dạng metadata; validator từ chối trường có vẻ chứa giá trị secret.
- Contract cấp secret theo phạm vi nhỏ: API nhận credential/khóa cần cho API và `REGISTRATION_FINGERPRINT_KEY`; Admin API không nhận khóa fingerprint; worker chỉ nhận khóa notification; migrator nhận database credential; khóa ký Mobile chỉ dành cho managed build service.
- `REGISTRATION_FINGERPRINT_KEY` được yêu cầu bởi cấu hình Public API. Admin API, worker và bootstrap không cần khóa đó; các entry point này gọi runtime config ở chế độ không yêu cầu khóa API-only.
- Local provider đọc env cho môi trường local. Managed provider hỗ trợ mount có sidecar version và adapter Google Secret Manager qua SDK/ADC; adapter Google mới được kiểm thử bằng fake API, chưa được nối với Google Cloud project, workload identity hoặc IAM thật. Runbook mô tả current/previous key và việc rollout process khi xoay khóa.
- Không có secret value, token, certificate private key hay credential thật được thêm vào tài liệu/repository trong nhiệm vụ này.

## Kiểm chứng offline đã chạy

| Phạm vi | Kết quả |
| --- | --- |
| Mobile transport policy và kiểm tra Android manifest cleartext | 12/12 PASS, rerun trong lượt tiếp nối |
| Mobile API URL config | 11/11 PASS, rerun trong lượt tiếp nối |
| Toàn bộ Mobile Jest | 62 suites, 477/477 PASS ở lượt Pha A trước đó |
| Mobile lint và TypeScript (`npx tsc --noEmit`) | PASS ở lượt Pha A trước đó |
| Mobile release config và public-env validators | PASS, rerun trong lượt tiếp nối |
| Mobile OpenAPI và Maestro syntax validators | PASS ở lượt Pha A trước đó |
| Expo Web export với biến sandbox local tạm thời | PASS ở lượt Pha A trước đó; static export local, không phải deploy |
| Backend typecheck và build | PASS trong lượt tiếp nối |
| Critical HTTP tests | 13/13 PASS theo lượt Pha A trước đó; phần tiếp nối không sửa HTTP route |
| Runtime config, PostgreSQL TLS helper và Secret Provider tests | 20/20 PASS sau khi bổ sung Google adapter fake tests |
| Secret registry validator/tests | 11 metadata entries; 6/6 PASS trong lượt tiếp nối |
| Secret surface scan | 953 tracked files và 2 artifact mới được quét tường minh; PASS, 0 findings |

Các lệnh kiểm tra này chỉ chứng minh rule, type, test và build trong workspace. Chúng không chứng minh domain, chứng chỉ đang hoạt động, quyền IAM, Secret Manager, PostgreSQL staging hay HTTPS từ thiết bị.

## Cần làm trước khi có staging HTTPS thật

1. Chọn hosting/provider và domain; cấu hình DNS, edge gateway, chứng chỉ tự gia hạn và giám sát ngày hết hạn.
2. Chặn truy cập Internet trực tiếp tới cổng HTTP của API/Admin; chỉ cho gateway gọi Backend qua mạng riêng. Kiểm tra redirect HTTP→HTTPS và TLS handshake từ Web cùng Android emulator.
3. Cấu hình Admin Web → Admin API bằng HTTPS với xác minh chứng chỉ; bật secure cookie trong môi trường staging.
4. Cấp PostgreSQL staging riêng, private/allowlisted, CA tin cậy và `verify-full`; kiểm tra bằng migration/release rehearsal được database guard cho phép.
5. Chọn Secret Manager, tạo identity/IAM tối thiểu, cấu hình adapter đã có, cấp secret theo đúng service binding, bật audit log và diễn tập rotate current/previous key.
6. Đặt URL API staging dạng public config cho EAS staging; giữ sandbox flag tắt. Sau đó chạy device/Web E2E qua HTTPS và lưu evidence đã redact gắn với release ID/image digest.

## Pha A — kiểm kê hiện trạng, phạm vi và quyết định

### Ảnh chụp Git trước phần hiệu chỉnh tiếp nối

Ảnh chụp được lấy trước khi sửa phần registry/kiểm thử trong phiên tiếp nối ngày 2026-10-05. `git status` là nguồn sự thật; snapshot trong `PROJECT_CONTEXT.md` có HEAD cũ hơn và không được dùng thay thế.

| Trạng thái | Giá trị lúc bắt đầu phần tiếp nối |
| --- | --- |
| Branch | `codex/staging-academic-completion` |
| HEAD | `a5bf4a69cef4e9f4e3b4c0a8931ce8d93bd168c3` |
| Staged | Không có |
| Tracked, modified, unstaged (19) | `backend/package.json`; `backend/scripts/admin-bootstrap.ts`; `backend/scripts/validate-secret-registry.cjs`; `backend/src/adminServer.ts`; `backend/src/runtimeConfig.ts`; `backend/src/tests/runtimeConfig.test.ts`; `backend/src/worker.ts`; `documents/07-release/secret-management-runbook.md`; `documents/07-release/secret-registry.yaml`; `infrastructure/staging/README.md`; `infrastructure/staging/provider-neutral/contract.yaml`; `mobile-app/.env.example`; `mobile-app/app.config.js`; `mobile-app/eas.json`; `mobile-app/jest.config.js`; `mobile-app/package.json`; `mobile-app/scripts/validate-release.cjs`; `mobile-app/src/services/api/__tests__/config.test.ts`; `mobile-app/src/services/api/config.ts` |
| Untracked (16) | 12 generated `.js`, `.js.map`, `.d.ts`, `.d.ts.map` files under `backend/scripts/` for `aggregate-financial-advice-evaluation`, `evaluate-assistant-intent`, and `evaluate-assistant-ollama`; `backend/src/tests/secretRegistry.test.cjs`; this readiness report; `mobile-app/jest.setup.cjs`; `mobile-app/scripts/runtime-transport-policy.test.cjs` |

Các thay đổi trên đã tồn tại trước phần tiếp nối và được bảo toàn. Phần tiếp nối chỉ được phép chỉnh các file cụ thể ở bảng phạm vi bên dưới; không dùng Git để stage, commit, reset, restore, clean hoặc ghi đè WIP.

### Ma trận hiện trạng theo yêu cầu

| Yêu cầu | Code/contract hiện có | Kiểm thử offline cần có | Hạ tầng thật cần có | Trạng thái sau kiểm chứng Pha A |
| --- | --- | --- | --- | --- |
| Mobile phân biệt local sandbox với staging/production-like | `app.config.js`, `eas.json`, `src/services/api/config.ts`; local HTTP chỉ cho loopback/emulator, staging/production-like yêu cầu HTTPS và cấm sandbox flag | URL HTTP staging/production-like bị từ chối; sandbox flag bị từ chối kể cả URL HTTPS; local Web/emulator được phép; Android staging cleartext false | EAS build và request từ thiết bị tới host HTTPS thật, xác minh hostname/chứng chỉ | Guard/configuration được kiểm tra offline; HTTPS thiết bị chưa xác minh |
| Backend PostgreSQL staging TLS | `runtimeConfig.ts` yêu cầu `verify-full` và hostname; TLS helper dùng CA/hostname validation | Sai mode/thiếu hostname bị từ chối; đúng mode được chấp nhận | PostgreSQL staging thật với CA và hostname thật; thử sai CA/hostname | Rule offline có test; handshake thật chưa chạy |
| Secret inventory đầy đủ | `runtimeSecrets.ts`, API/Admin/worker/bootstrap và provider-neutral contract là nguồn đối chiếu; registry có 11 IDs, gồm `registration-fingerprint-key` | Registry kiểm tra IDs bắt buộc, metadata, contract binding và cấm giá trị secret | Secret Manager, identity/IAM, quyền, audit log | Metadata/validator offline được kiểm tra; chưa có provider thật |
| Managed provider và fallback | Staging/production-like chỉ dùng `managed`; hỗ trợ backend `mounted` hoặc `google-secret-manager` được chọn rõ | Thiếu project ID, backend mâu thuẫn/không hợp lệ, secret/version rỗng, lỗi không phản chiếu giá trị, không fallback về env local | Google project, ADC/workload identity, IAM secret-level, audit | Adapter Google chạy với fake API; không xác minh credential, quyền IAM hoặc lần đọc thật |
| Khóa current/previous | Runtime yêu cầu current; các entrypoint truyền `required: isProductionLike` cho previous của OTP/MFA/notification | Nạp current+previous thành công; thiếu previous ở staging fail closed; không in giá trị ra lỗi | Tạo version trong Secret Manager, xác minh rollout/restart và rotation thật | Chính sách first deployment đã chốt; lifecycle thật chưa diễn tập |
| HTTPS gateway, Admin cookie/CORS, public port | Provider-neutral contract yêu cầu gateway, private backend hop, `ADMIN_SECURE_COOKIES=1`, exact origins | Kiểm tra validator/configuration cục bộ nếu có | DNS/domain, TLS cert, redirect, ingress rules, Web/emulator E2E | Chỉ là contract; chưa có endpoint |

### Phạm vi file theo bước

| Bước | File được phép sửa khi thực hiện bước | Ghi chú |
| --- | --- | --- |
| A1 — ghi nhận hiện trạng | `documents/07-release/https-secrets-academic-readiness.md` | Chỉ tài liệu, không thay đổi runtime |
| A2 — Mobile HTTPS guard | `mobile-app/app.config.js`, `mobile-app/eas.json`, `mobile-app/src/services/api/config.ts`, test/validator tương ứng, `.env.example`, `package.json`/Jest config nếu cần | Phần này đã có trong WIP trước phiên tiếp nối; phần tiếp nối không mở rộng logic Mobile |
| A3 — secret metadata/binding | `documents/07-release/secret-registry.yaml`, `backend/scripts/validate-secret-registry.cjs`, `backend/src/tests/secretRegistry.test.cjs`, `infrastructure/staging/provider-neutral/contract.yaml`, `documents/07-release/secret-management-runbook.md` | Runtime config, `runtimeSecrets.ts`, `server.ts`, `adminServer.ts`, `worker.ts`, bootstrap chỉ được sửa nếu kiểm chứng phát hiện hành vi sai; lần này giữ nguyên hành vi fail-closed |
| A4 — fake/offline tests | `backend/src/tests/runtimeConfig.test.ts`, `backend/src/tests/secretProvider.test.ts`, `backend/src/tests/secretRegistry.test.cjs`, Mobile tests tương ứng và readiness report | Không chạy DB/migration; không gọi mạng/model |
| B5 — chọn provider và dự toán | `documents/07-release/https-secrets-academic-readiness.md`, `infrastructure/staging/provider-neutral/contract.yaml`, tài liệu triển khai mới nếu cần | Chỉ chuẩn bị phương án để Owner duyệt; chưa cấp tài nguyên |
| B6 — HTTPS thật | Manifest/gateway config của provider đã chọn, `mobile-app/eas.json`/API URL staging, tài liệu vận hành | Chỉ sau khi Owner chọn provider/domain và duyệt chi phí |
| B7 — Secret Manager thật | Google adapter đã có trong `backend/src/secrets/`; còn project, ADC/workload identity, IAM bindings, access audit và version/rotation thật | Chỉ sau khi có provider/account/identity và quyền được duyệt |
| B8 — nghiệm thu | readiness report, deployment runbook và evidence đã khử nhạy cảm | Không ghi credential, raw secret, token, private key hoặc log chứa dữ liệu nhạy cảm |

### Chính sách khóa previous ở lần triển khai staging đầu

Quyết định thống nhất với runtime hiện tại là **không cho thiếu slot previous ở lần khởi động staging đầu tiên**. Các slot `otp-pepper-previous`, `mfa-encryption-key-previous` và `notification-endpoint-key-previous` phải được cấp trước khi service tương ứng chạy. Khi database staging còn mới và chưa có dữ liệu cũ, mỗi slot vẫn phải có một giá trị ngẫu nhiên riêng, chỉ dùng trong namespace staging, được đánh dấu `PREPARED`; không dùng chung với current, local hoặc môi trường khác. Đây là yêu cầu cấu hình của runtime fail-closed, không phải khẳng định rằng đã tồn tại dữ liệu/ciphertext cũ.

Khi xoay lần đầu, current cũ trở thành previous. Chỉ thu hồi khóa bootstrap ban đầu sau khi inventory xác nhận không có bản ghi nào phụ thuộc vào nó, service đã rollout/restart và Owner chấp thuận. `secret-registry.yaml` giữ metadata/policy; version ID thật do provider cấp và chỉ lưu trong hệ thống quản lý secret. Test fake chứng minh keyring nạp được current/previous và từ chối thiếu previous; test không chứng minh provider cloud đã cấp key.

### Kết quả phần tiếp nối và ranh giới Pha B

Phần tiếp nối đã bổ sung owner/binding/version/lifecycle metadata cho cả 11 secret, validator fail-closed cho metadata thiếu/sai, test đối chiếu secret registry với contract và test fake cho các keyring current/previous. Audit còn phát hiện Admin API contract thiếu `NODE_ENV=production` và `BANKING_ENV=staging`, khiến `runtimeConfig` mặc định về development; contract nay khai báo rõ environment, virtual money, PostgreSQL, relational-v2 và managed provider. Test cũng đối chiếu dải migration với thư mục thật và đã cập nhật contract lên `001-043` (các migration 041–043 có trong repository). Các thay đổi chỉ nằm trong registry, validator/test, contract, runbook và tài liệu readiness. Chúng không thay đổi khóa runtime, database schema hay business logic.

| Pha | Kết luận |
| --- | --- |
| A — repository và offline gates | `OFFLINE_CONFIGURATION_PASS` sau khi quality gates được chạy lại và kết quả bên dưới được cập nhật |
| B5 — chọn provider, domain, region, budget | Không triển khai provider có phí theo ràng buộc 0 đồng; chỉ tiếp tục nếu có hạ tầng sẵn có được xác nhận không phát sinh phí |
| B6 — HTTPS host/gateway/device verification | `NOT_PROVISIONED / NOT_VERIFIED` |
| B7 — managed Secret Manager/IAM/rotation thật | `NOT_PROVISIONED / NOT_VERIFIED`; Google adapter chỉ mới qua fake API tests |
| B8 — nghiệm thu triển khai | Chưa thể hoàn thành trước khi B6/B7 có evidence |

Các bước B5–B8 có thể tạo chi phí và cần account/quyền ngoài repository. Theo ràng buộc mới của Owner, không tạo dịch vụ, domain, database, Secret Manager, chứng chỉ hay identity, kể cả qua free tier/trial. Không coi ngân sách US$100 được đề xuất bên dưới trong bản kế hoạch cũ là quyền chi tiêu. Chỉ dùng hạ tầng đã tồn tại khi có bằng chứng xác nhận không phát sinh khoản phí nào; nếu không, staging HTTPS thật tiếp tục `NOT RUN`.

### Quality gates của phần tiếp nối ngày 2026-10-05

| Lệnh/kiểm tra | Kết quả | Bằng chứng |
| --- | --- | --- |
| `npm run validate:secret-registry` | PASS | 11 metadata-only entries; không phát hiện value field |
| `npm run test:secret-registry` | PASS | 6/6, gồm completeness metadata, fail-closed missing fields, first-deployment previous policy và contract binding |
| `npx tsx --test src/tests/secretProvider.test.ts src/tests/runtimeConfig.test.ts src/tests/databaseTls.test.ts` | PASS | 20/20 sau khi bổ sung fake Google Secret Manager adapter cases; gồm empty value/version, không fallback sang env local, current/previous success, missing previous rejection và PostgreSQL TLS guards |
| `npm run typecheck` | PASS | `tsc --noEmit`, exit code 0 |
| `npm run build` | PASS | `tsc -p tsconfig.build.json`, exit code 0 |
| Secret surface scanner | PASS | Quét 953 tracked files và 17 untracked artifacts được chỉ định tường minh; 0 findings |
| YAML parse | PASS | `secret-registry.yaml` và provider-neutral staging contract parse được |
| `git diff --check` | PASS | Không có lỗi trong tracked diff; readiness report và CJS test untracked được kiểm tra whitespace/conflict marker riêng |
| `npm run test:critical` | PASS | 13/13 HTTP critical tests |
| `npm run test:assistant` | PASS | 74/74; không gọi Ollama/cloud |
| `npm audit --omit=dev` | FAIL / existing dependency finding | 1 High trong `nodemailer@9.0.5`; không được tuyên bố dependency audit sạch |

Phần tiếp nối cài dependency SDK Google Secret Manager từ npm registry và không gọi Google Cloud API, database/migration hoặc model. Phần này không provision hạ tầng. Mobile transport/API-config tests và release/public-env validators đã được rerun trước khi thêm adapter; full Mobile Jest, lint/typecheck, OpenAPI/Maestro validators và Web export vẫn dựa trên bằng chứng Pha A trước đó vì phần tiếp nối không sửa Mobile.

## Pha B5 — phương án triển khai để Owner duyệt (chưa chọn/chưa provision)

Đây là một phương án kỹ thuật có thể duyệt, không phải cấu hình đã áp dụng. Tôi đề xuất đánh giá Google Cloud tại `asia-southeast3` (Bangkok) vì Cloud Run và Cloud SQL có region này; region thực tế vẫn phải được chọn trong Pricing Calculator trước khi tạo tài nguyên. Nếu Owner không có Google Cloud billing account hoặc domain riêng, chưa triển khai theo phương án này.

### Sơ đồ đề xuất

```text
Mobile / Admin Browser
        |
        | HTTPS :443, Google-managed certificate, TLS 1.2/1.3
        v
External Application Load Balancer (host routing; one public edge)
  |             |                 |
  |             |                 +--> admin-api.<domain> -> Cloud Run Admin API
  |             +--------------------> admin.<domain>     -> Cloud Run Admin Web/Nginx
  +----------------------------------> api.<domain>       -> Cloud Run Public API
                                          |
                                          +-- private VPC egress + TLS verify-full --> Cloud SQL PostgreSQL 16

Cloud Run service identities -- least-privilege Secret Manager access --> Secret Manager
One-shot migration job -------- database credential only -------------> Cloud SQL
Private worker pool ----------- database + notification keys ---------> Cloud SQL / Secret Manager
Mobile signing key -----------------------------------------------> managed build step only
Ollama/Qwen: excluded from hosted staging in this proposal; no cloud AI call.
```

| Endpoint/secret boundary | Proposed route or permission |
| --- | --- |
| Mobile API | `https://api.<domain>/api/v1`; `APP_VARIANT=staging`, `EXPO_PUBLIC_SANDBOX_HTTP=0`; only public HTTPS load balancer route |
| Admin Web | `https://admin.<domain>`; exact origin entered into `ADMIN_ALLOWED_ORIGINS`; HTTPS upstream only |
| Admin API | `https://admin-api.<domain>/api/v1`; secure cookies and exact CORS origin; available through the same load-balancer edge |
| API/Admin/worker ingress | Cloud Run ingress `internal-and-cloud-load-balancing`; disable default `run.app` URL; public traffic enters through the managed load balancer only |
| PostgreSQL | Cloud SQL private address; no public IP; `DATABASE_SSL_MODE=verify-full`, trusted server CA and `DATABASE_SERVER_NAME` matching certificate SAN |
| Secret Manager | API/Admin API/worker use `BANKING_MANAGED_SECRET_BACKEND=google-secret-manager` and `BANKING_SECRET_PROJECT_ID=<project-id>`; separate Cloud Run service identity per runtime; grant `secretAccessor` only on that service's registry-listed secret IDs. Use ADC/service identity; no service-account key JSON |
| Mobile signing | Build service only; never in Cloud Run, EAS public config or JavaScript bundle |
| AI | Not included. Local Ollama on the developer PC is not reachable as a managed staging dependency; a hosted model/compute path needs a separate design and budget approval. |

The offline GCP candidate now has a concrete Google Secret Manager adapter, with `@google-cloud/secret-manager` recorded as a Backend production dependency. Runtime selection is explicit: `BANKING_MANAGED_SECRET_BACKEND=google-secret-manager` plus `BANKING_SECRET_PROJECT_ID`; production credentials are expected from ADC using the Cloud Run service identity, with no service-account key file. The adapter requests the `latest` version alias and records the actual numeric version returned by Google. Tests use an injected fake API only; no cloud request was made. Before provisioning, Owner must choose/approve the Google project and IAM identities, and a live access test must prove per-secret bindings and audit evidence. The separate Cloud SQL compatibility check remains unresolved: verify that the chosen Cloud SQL CA and hostname satisfy `verify-full`, and prove valid plus invalid CA/hostname cases against a disposable staging database. The Google SDK's documented access-version and ADC behavior is linked in the runbook; documentation is not deployment evidence.

### Ước lượng chi phí lịch sử — không được triển khai theo ràng buộc 0 đồng

Các số liệu dưới đây được lập trước khi Owner đặt ràng buộc không phát sinh chi phí. Chúng chỉ là tham khảo lịch sử, không phải báo giá chính xác, ngân sách được duyệt hay quyền tạo tài nguyên. Không dùng free tier/trial để né ràng buộc này vì giới hạn, traffic, lưu trữ, backup, region, thuế hoặc cấu hình có thể tạo hóa đơn.

Giá dưới đây được tra cứu từ trang giá/chính thức của Google Cloud ngày 2026-10-05, nhưng không phải báo giá cho `asia-southeast3`; Cloud SQL/Cloud Run rates vary by region, traffic, storage, backup, network path, tax and billing currency. Các phép quy đổi dùng 730 giờ/tháng.

| Thành phần | Tham chiếu giá công khai | Ước lượng sơ bộ 30 ngày |
| --- | --- | ---: |
| Cloud SQL PostgreSQL `db-g1-small` (shared core, 1.7 GiB) | Giá bảng mặc định $0.035/giờ; loại shared-core không thuộc Cloud SQL SLA | $25.55 trước storage/backup; Bangkok cần tính lại |
| External Application Load Balancer, 1 forwarding rule | $0.025/giờ; processing $0.008/GiB vào và $0.008/GiB ra | $18.25 + traffic |
| Cloud Run worker pool, 1 instance 1 vCPU/512 MiB chạy liên tục | Ví dụ chính thức ở Belgium là $11.61/tháng sau free tier; Bangkok khác giá | Dùng $11.61 làm tham chiếu, không coi là giá Bangkok |
| Secret Manager | 6 active versions và 10,000 access operations/tháng miễn phí nếu hạn mức billing account còn; 11 secret IDs, mỗi ID một active version | ~$0.30 nếu còn free allowance; tối đa ~$0.66 nếu toàn bộ 11 version bị tính phí; tăng khi giữ thêm version |
| Cloud DNS | Một zone ~$0.000273973/giờ; query $0.40/1M | ~$0.20 + query |
| Cloud Run API/Admin API/Admin Web | Request-based, min instances 0; free tier phụ thuộc billing account và traffic | Chưa thể tính nếu chưa chốt request/CPU/memory/region |
| Domain, storage, backup, VPC egress, tax | Chưa biết domain/TLD, cấu hình storage/retention và billing country | Chưa gồm |
| **Tổng các dòng có số** | Chỉ là phép cộng các mức tham khảo trên | **~$55.91/tháng nếu còn free allowance, hoặc ~$56.27 nếu không + phần chưa định giá** |

Đề xuất cũ **US$100/tháng đã bị rút khỏi phương án thực hiện** vì Owner yêu cầu chi phí bằng 0; mức đó cũng chưa từng là trần bảo đảm hóa đơn. Không chạy Pricing Calculator hoặc bật dịch vụ trả phí trong phạm vi hiện tại. Không có lời gọi OpenAI/cloud AI; Qwen local không được host hoặc gọi từ staging.

### Kiểm tra khả năng tiếp tục mà không phát sinh phí (2026-10-05)

- `gcloud` chưa được cài trong PATH; các biến môi trường thường dùng để chỉ định Google Cloud project/credential (`GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`, `GCLOUD_PROJECT`, `CLOUDSDK_AUTH_ACCESS_TOKEN`) không được cấu hình. Đây chỉ là kiểm tra workspace/máy hiện tại, không khẳng định Owner không có tài khoản hoặc tài nguyên ở nơi khác.
- Kiểm tra metadata của các file `.env` bị bỏ qua bởi Git chỉ đọc tên biến và phân loại an toàn, không in giá trị: `backend/.env` khai báo `BANKING_ENV=development`, `.env.compose` đặt `DATABASE_SSL_MODE=disable`, và `mobile-app/.env` bật `EXPO_PUBLIC_SANDBOX_HTTP=1`. Đây là cấu hình local sandbox, không phải cấu hình staging; không dùng chúng làm bằng chứng HTTPS hoặc PostgreSQL TLS staging.
- Docker Engine local có sẵn, nhưng không có container đang chạy khi kiểm tra. Không khởi động container hay tạo tài nguyên trong lượt này.
- Không có bằng chứng domain, cloud project, TLS gateway, PostgreSQL staging hoặc managed Secret Manager đã được cung cấp sẵn cho dự án.
- Vì vậy, không thể xác minh HTTPS công khai, IAM/Secret Manager thật, PostgreSQL `verify-full` trên staging, hoặc Mobile/Web E2E qua staging mà vẫn bảo đảm chi phí bằng 0. Các mục này tiếp tục `NOT PROVISIONED / NOT VERIFIED`; không được thay bằng kết quả giả lập local.

### Đầu vào cần có để tiếp tục trên hạ tầng trường đã cấp (không gửi secret vào chat/repository)

1. Xác nhận của đơn vị quản lý rằng staging/domain/database/secret store đã tồn tại, được phép dùng cho đồ án và không phát sinh phí biên, tự động nâng gói hoặc overage.
2. Hostname HTTPS staging cùng đầu mối quản lý DNS/chứng chỉ và gateway; thông tin để kiểm tra certificate chain, hostname, gia hạn và đường vào nội bộ.
3. Quyền triển khai API/Admin/worker lên môi trường hiện có, kèm chính sách ingress/private routing; không gửi access token hoặc private key.
4. PostgreSQL staging riêng cho dữ liệu giả, hostname và CA tin cậy để kiểm tra `verify-full`; thông tin kết nối bí mật chỉ được nhập trực tiếp vào secret store được duyệt.
5. Secret manager/mount provider đã có, danh sách identity theo service, quyền đọc tối thiểu và audit log; không đưa giá trị secret vào tài liệu.
6. Thiết bị/emulator hoặc Web có thể truy cập hostname staging, cùng quyền thực hiện deployment rehearsal và cleanup mà không ảnh hưởng tài nguyên dùng chung.

Khi có các đầu vào này, có thể tiếp tục kiểm chứng trên chính môi trường được cấp mà không tạo tài nguyên mới. Nếu đơn vị không thể xác nhận chi phí biên bằng 0, dừng trước mọi lệnh triển khai hoặc gọi API quản lý cloud.

### Xác minh offline bổ sung ngày 2026-10-05

Các kiểm tra sau được chạy lại sau khi xác nhận ràng buộc 0 đồng; chúng chỉ chạy test/configuration cục bộ:

| Lệnh/kiểm tra | Kết quả | Phạm vi chứng minh |
| --- | --- | --- |
| Backend `npm run typecheck` | PASS | TypeScript hiện tại biên dịch kiểu thành công |
| Backend `npm run test:secret-registry` | PASS, 6/6 | Metadata registry, binding, first-deployment policy và fail-closed validator |
| Backend `node --import=tsx --test src/tests/runtimeConfig.test.ts src/tests/secretProvider.test.ts src/tests/databaseTls.test.ts` | PASS, 20/20 | Runtime config, fake SecretProvider/Google adapter và các nhánh kiểm tra PostgreSQL TLS; không phải kết nối cloud/database thật |
| Mobile `npm run test:transport-policy` | PASS, 12/12 | EAS profile, sandbox HTTP và Android cleartext policy |
| Mobile `npm test -- --runInBand src/services/api/__tests__/config.test.ts` | PASS, 11/11 | URL API local/staging và HTTPS guard ở runtime Mobile |
| Mobile `npm run validate:public-env` | PASS, 237 files scanned | Bề mặt biến public không có cấu hình secret bị phát hiện |
| Mobile `npm run validate:release` | PASS | Release config yêu cầu HTTPS ở staging/production và chỉ cho sandbox loopback local |

Trong lượt xác minh Pha A được ghi ở bảng trên, không có test nào gọi Google Cloud, PostgreSQL, Ollama/Qwen hoặc API AI ngoài; không chạy migration, không tạo container hay tài nguyên cloud. Bài thực hành local bổ sung sau đó được ghi riêng tại [local HTTPS và secrets learning lab](local-https-secrets-learning-lab.md): bài đó dùng một container PostgreSQL disposable đã có image sẵn, không dùng database preview và không tạo tài nguyên cloud. Cả hai bộ bằng chứng đều không thay thế các kiểm tra B6/B7/B8 trên staging thật.

**Lưu ý kiểm toán dependency:** sau khi thêm SDK, `npm audit --omit=dev` vẫn báo một High trong dependency production hiện có `nodemailer` (affected range `<=10.0.5`; package hiện nằm trong range `^9.0.5`). Không tự nâng major version trong task HTTPS/secrets; cần xử lý bảo mật riêng trước khi tuyên bố release/staging gate sạch.

Nguồn giá và cấu hình chính thức:

- [Cloud Run pricing](https://cloud.google.com/run/pricing) — request/worker pricing, free tier và ví dụ worker pool.
- [Cloud SQL pricing](https://cloud.google.com/sql/pricing) — giá loại `db-g1-small` và lưu ý shared-core không có SLA.
- [Secret Manager pricing](https://cloud.google.com/secret-manager/pricing) — active versions và access operations.
- [Cloud Load Balancing pricing](https://cloud.google.com/load-balancing/pricing) — forwarding rules và data processing.
- [Cloud DNS pricing](https://cloud.google.com/dns/pricing) — managed zone và queries.
- [Cloud Run secret configuration](https://docs.cloud.google.com/run/docs/configuring/services/secrets) và [ingress restriction](https://docs.cloud.google.com/run/docs/securing/ingress) — versioned secrets/service identity và chặn gọi trực tiếp `run.app`.
- [Cloud SQL certificate hostname guidance](https://docs.cloud.google.com/sql/docs/postgres/configure-ip) — `verify-full` cần hostname trùng SAN và trusted CA.

**Phạm vi hiện tại:** chủ dự án muốn học cấu hình local và chưa có kế hoạch deploy. Bài thực hành miễn phí, không cần billing account/domain/cloud, nằm trong [local HTTPS và secrets learning lab](local-https-secrets-learning-lab.md). Con số US$100/30 ngày bên dưới là ước tính giả định cho một phương án hosted cũ, không phải khoản đã duyệt hay đã phát sinh.

**Chỉ khi sau này quyết định làm Pha B hosted:** Owner cần chấp nhận hoặc thay Google Cloud, xác nhận billing account/domain, quyết định ngân sách và xác nhận demo không host Qwen/Ollama. Cho tới khi có quyết định đó, trạng thái vẫn là `HOSTED_HTTPS_NOT_VERIFIED / MANAGED_SECRETS_NOT_PROVISIONED`.

Cho tới khi các bước B5–B8 được thực hiện và bằng chứng được lưu, trạng thái tổng thể vẫn là **OFFLINE_CONFIGURATION_PASS / HOSTED_HTTPS_NOT_VERIFIED / MANAGED_SECRETS_NOT_PROVISIONED**.

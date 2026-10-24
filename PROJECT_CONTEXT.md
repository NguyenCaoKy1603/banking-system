# PROJECT_CONTEXT — Banking System / NOVA

> Snapshot source/worktree: **14/10/2026, Asia/Bangkok**. Repository: C:/Projects/banking-system. Branch: codex/staging-academic-completion. HEAD: a5bf4a69cef4e9f4e3b4c0a8931ce8d93bd168c3.
>
> Cập nhật sau snapshot 2026-10-11: theo yêu cầu người dùng, các suite E2E chạy được của Backend API, Admin Web Playwright và Mobile Maestro cùng runner/fixture riêng đã được gỡ khỏi source, package scripts và CI. Các tham chiếu E2E khác trong snapshot dưới đây mô tả trạng thái tại ngày 04/10 hoặc là bằng chứng lịch sử; unit/integration test vẫn được giữ.
>
> Cập nhật sau snapshot 2026-10-13: chức năng khách hàng báo cáo giao dịch đáng ngờ và luồng Admin Fraud đã được gỡ khỏi app, API, quyền Admin và OpenAPI (quyết định D-39). Tham chiếu Fraud bên dưới mô tả snapshot lịch sử; migration/schema và dữ liệu cũ được giữ nguyên, không phục vụ tạo hoặc xử lý báo cáo mới.
>
> Đây là bản đồ code hiện tại cho người/AI mới. Phân tích gồm file tracked đã sửa, source untracked, test, script, SQL và cấu hình; không chỉ nội dung ở HEAD. Chỉ clone commit trên sẽ không có toàn bộ WIP, đặc biệt Financial Advice. Tài liệu này không phải lệnh triển khai hoặc quyền chạy database/model.
>
> Phương pháp: CodeGraph để tìm entrypoint/call paths; đọc toàn nội dung file qua công cụ và phân tích AST/import/export/body/type đối với TypeScript, đối chiếu DDL/OpenAPI/config; đọc sâu các luồng runtime trọng yếu. Coverage toàn file bằng công cụ khác với việc xem thủ công từng dòng style/fixture. Index cuối file là phạm vi source hiện hữu lúc tạo snapshot. Dependencies, cache/build, binary, generated JS/declaration cạnh TS, private .env và raw artifacts/credential logs được loại trừ. Không chạy test/build/server/database/model trong lần cập nhật này.
>
> **Inventory snapshot:** 609 canonical authored-source paths after excluding generated Expo declarations; no extracted New folder/ source tree is present. 134 textual config/contract/asset paths were indexed. Source index includes runtime code, test code, scripts and 43 SQL migration files. Full text source and repository-specific files were read; TypeScript modules were structurally inventoried and key execution flows were checked against imports/calls, OpenAPI/runtime validation, migrations and configuration. Binary/dependency/generated/cache/private credential files were intentionally excluded.
>
> Source/runtime validator/SQL là căn cứ cho hành vi; OpenAPI hiện là Draft và tài liệu/evidence có thể cũ. Khi khác nhau, ghi rõ khác biệt, không tự sửa hoặc chọn một bên là phê duyệt nghiệp vụ. Đọc AGENTS.md trước khi thực hiện task mới.

## 1. PROJECT OVERVIEW

### Mục đích và bài toán

Banking System là reference implementation cho đồ án mobile banking, có tên giao diện NOVA. Dự án gồm các luồng của ứng dụng khách hàng, Backend giao dịch và cổng vận hành cho nhân viên. Bài toán chính là tổ chức các luồng ngân hàng có kiểm tra quyền, tính toán tiền phía server, xác thực tăng cường, idempotency, transaction/ledger và phục hồi khi mạng hoặc ứng dụng gián đoạn.

Các adapter core/card/KYC hiện là nội bộ. Repository chưa chứng minh tích hợp core banking hoặc payment rail thật, KYC/AML provider thật, vận hành cloud/staging hoặc xử lý tiền thật.

### Chức năng chính

| Nhóm | Hành vi có implementation trong source |
| --- | --- |
| Customer identity | Đăng ký EMAIL_OTP, đăng nhập password, refresh/session rotation, đăng xuất và logout-all; MFA TOTP enrollment/remove/recovery/recovery-code rotation |
| Accounts | Tài khoản thanh toán, số dư authoritative, số tài khoản masked/reveal có quyền, lịch sử và chi tiết giao dịch |
| Transfers | Người thụ hưởng, internal recipient lookup, quote phí, step-up, chuyển nội bộ idempotent, receipt/status/recovery |
| Savings | Sản phẩm, quote kỳ hạn/lãi, mở tiền gửi idempotent, danh sách/chi tiết và lifecycle đáo hạn |
| Credit/Card | Hồ sơ tín dụng, card/account, khóa/mở/báo mất, giao dịch, sao kê, minimum/full/custom repayment và lifecycle |
| KYC | Khai báo, draft/save/submit, masked identity last4; Admin review |
| Notifications | Danh sách/đánh dấu đọc/thông báo liên kết tài nguyên; (Fraud report đã gỡ bỏ hoàn toàn theo D-39 ngày 13/10/2026) |
| QR | Tạo/quét thông tin nhận tiền versioned, trust UNVERIFIED; không tạo payment trực tiếp từ QR |
| Assistant Help | Hướng dẫn dùng app từ catalog/knowledge bundle và controlled selection; không thực hiện giao dịch |
| Financial Advice | SAVINGS_PLAN và BUDGET_BALANCE từ số liệu người dùng nhập, calculator xác định + selector AI có giới hạn + rules fallback |
| Admin | Operations password-only login after one-time TOTP enrollment; Admin password/TOTP login; cookie session; customer/account control; KYC/Credit review; direct action execution with step-up MFA (Approval Inbox retired); transfer requests; outbox/jobs; staff/roles; audit |
| Background/quality | Transactional outbox worker, lifecycle scheduler, migrations/guard, test/contract/release/performance harness; backup/DR design docs only (runnable scripts removed) |

“Có implementation” không đồng nghĩa đã nghiệm thu toàn bộ use case ở environment hiện tại. Những khoảng trống cụ thể nằm ở mục 12.

### Công nghệ được khai báo

| Phần | Stack thực tế và dependency quan trọng |
| --- | --- |
| Backend | Node.js node:http, TypeScript ESM, pg ^8.23.0, nodemailer ^9.0.5, otpauth ^9.5.1, @google-cloud/secret-manager ^6.3.0; dev tsx ^4.19.4, TypeScript ^5.8.3, yaml ^2.9.0 |
| Mobile | Expo ~57.0.12, expo-router ~57.0.12, React/React DOM 19.2.3, React Native 0.86.2, react-native-web ~0.21.0, TypeScript ~6.0.3 |
| Mobile platform | SecureStore, Crypto, LocalAuthentication, Camera, Clipboard, react-native-qrcode-svg, react-native-svg, safe-area/screens/gesture-handler, expo-dev-client ~57.0.19; Jest/jest-expo và ESLint |
| Admin Web | React/DOM ^19.1.1, Vite ^7.1.3, TypeScript ^5.9.2, plugin-react ^5.0.4; khóa hiện tại trong snapshot React 19.2.8/Vite 7.3.6/TS 5.9.3 |
| Database | PostgreSQL; Compose chọn image PostgreSQL 16 theo digest. Driver SQL pg, không ORM |
| AI | Radox AI Gateway (OpenAI-compatible Cloud LLM via API Key, default model gemini-3.6-flash); hỗ trợ Assistant Help và Financial Advice |
| Packaging | Docker Compose, Backend Node 22 image, Admin static Nginx 1.27; EAS profiles/native Android scaffold |
| API contracts | Public OpenAPI 3.1.0 / 0.2.0-draft (63 operations); Admin OpenAPI 3.0.3 / 0.1.0-draft (58 operations) |

Không có Express/Nest, ORM, Redux, React Query hoặc Axios trong kiến trúc runtime được rà soát. Admin dùng hash router tự viết; Mobile dùng Expo Router.

## 2. PROJECT STRUCTURE

Cây dưới đây tập trung vào source/config tự viết, không mở node_modules/.git/build/dist/cache/binary. Danh sách file đầy đủ nằm ở mục 15.

~~~text
banking-system/
├── AGENTS.md
├── PROJECT_CONTEXT.md
├── README.md
├── TASK_TEMPLATE.md
├── USE_CASE_ROADMAP.md
├── prompt.md                         # nhiệm vụ AI hiện hành + lịch sử tham chiếu
├── compose.yaml / .env.compose.example
├── .github/
│   ├── workflows/                    # quality/container/preview CI definitions
│   └── modernize/java-upgrade/hooks/ # tooling hook; không Java banking runtime
├── backend/
│   ├── package.json / tsconfig*.json / Dockerfile / README.md
│   ├── src/
│   │   ├── server.ts / http.ts / adminServer.ts / worker.ts / serverBind.ts
│   │   ├── bankingSystem.ts / types.ts / errors.ts / security.ts / runtimeConfig.ts / runtimeMetadata.ts
│   │   ├── routes/                   # [Routing] system, auth, accounts, transfers, cards, savings, kyc, notifications, assistant, mobile
│   │   ├── controllers/              # [Controllers] auth, account, transfer, savings, card, kyc, notification, assistant, mobile
│   │   ├── middlewares/              # [Middlewares] cors, auth, error, recipientLookupRateLimiter
│   │   ├── services/                 # [Application Services] coreBanking (CoreBankingPort)
│   │   ├── domain/                   # [Pure Domain] ledger (double-entry), money, savings/, credit/
│   │   ├── database/                 # [Persistence] unitOfWork, pool, services, repositories, postgresRelationalRepository, postgresSnapshotRepository
│   │   ├── admin/{http,auth,authorization,actions,audit,repositories}/
│   │   ├── assistant/                # help/knowledge/radox-provider/controlled selector
│   │   ├── financialAdvice/          # calculator/options/policy/validation/service
│   │   ├── mfa/ / secrets/ / outbox/ / notifications/ / workers/
│   │   ├── observability/            # runtime logger/metrics/requestContext modules
│   │   └── tests/                    # unit/HTTP/relational/evaluator fixtures
│   ├── database/                     # 001–043 forward SQL migrations
│   └── scripts/                      # migration/guard/seed/eval/release/DR tooling
├── mobile-app/
│   ├── index.ts / app.json / app.config.js / eas.json
│   ├── package.json / tsconfig.json / jest.config.js / eslint.config.js
│   ├── src/
│   │   ├── app/
│   │   │   ├── _layout.tsx / (auth)/ / (tabs)/
│   │   │   ├── account/ / transaction/ / cards/ / savings/
│   │   │   └── transfer / beneficiaries / history / kyc / mfa /
│   │   │       notifications / assistant / financial-advice / qr
│   │   ├── features/
│   │   │   ├── accounts / assistant / auth / banking / cards / control / credit
│   │   │   ├── financial-advice / history / home / kyc
│   │   │   └── notifications / profile / qr / savings / transfers
│   │   ├── components/{brand,ui}/
│   │   ├── runtime/ / services/{api,mock,security,telemetry}/
│   │   └── theme/ / types/
│   ├── scripts/
│   ├── assets/                       # binary bỏ khỏi index, SVG/config có index
│   ├── example/                      # starter/template, excluded khỏi live app
│   └── android/                      # local Expo-generated scaffold, ignored Git
├── admin-web/
│   ├── index.html / vite.config.ts / package.json / Dockerfile
│   ├── src/
│   │   ├── main.tsx / App.tsx / api.ts / router.ts / types.ts
│   │   ├── context/ / components/common/
│   │   └── features/{auth,overview,customers,applications,approvals,
│   │                 transfers,operations,staff,audit}/
│   ├── test/ / scripts/
│   └── docker-entrypoint.d/ / nginx.conf.template
├── documents/
│   ├── api/                          # Public + Admin Draft OpenAPI
│   ├── admin/                        # permission/architecture/test documents
│   ├── 02-design/ / 05-testing/ / 06-security-ai/ / 08-presentation/
│   └── ...                           # contracts, evidence, runbooks, archived prompts
├── infrastructure/{backup,postgres-pitr,staging}/
├── observability/{alerts,dashboards}/
├── performance/node/
├── tasks/{DEMO,UC-M01,UC-M02,UC-M03,...}/
└── giaidoan*.md                      # kế hoạch/tài liệu lịch sử
~~~

Tại snapshot, không có thư mục New folder/ đã giải nén trong workspace. Có archive New folder.zip nhưng archive nhị phân được loại khỏi cây source/index theo yêu cầu; không nên coi archive đó là runtime module.

Native android/ và example/ có nội dung trong workspace nhưng bị ignore/exclude theo cấu hình Mobile. Không suy từ file Kotlin/Gradle hiện hữu rằng source này đã được commit, có signing release chính thức hoặc là một app khác.

## 3. ARCHITECTURE

### Ranh giới ứng dụng

~~~text
Mobile (React Native/Expo, hoặc cùng source chạy Expo Web)
  → shared requestJson HTTP + validators
  → Public API process :5000
  → HTTP guards/auth/route dispatcher
  → typed relational service → UnitOfWork → SQL repositories → PostgreSQL
                           └→ ledger + audit + outbox

Admin Web SPA :5173 (dev) / Nginx static proxy (container)
  → same-origin /api/v1 + cookie + CSRF
  → Admin API process :5001
  → staff authorization + action workflow + AdminRepository → PostgreSQL

worker.ts process riêng
  → PostgreSQL outbox lease/retry/dead-letter
  → notification fake/disabled adapters
  → lifecycle scheduler (khi flags/cutover cho phép)

Assistant/Financial Advice
  → controlled deterministic facts/options
  → bounded provider call tới Radox (hoặc loopback provider) nếu enabled
  → validated selector + fixed response/template hoặc rules fallback
~~~

### Backend không chỉ có một business path

- **In-memory/reference:** createBankingServer dùng BankingSystem, Maps/state, InMemoryCoreBanking/InMemoryLedger. Hữu ích cho unit/HTTP fixture và sandbox.
- **PostgreSQL legacy-state:** createPersistentBankingServer có PostgresRelationalRepository.withState; import/export compatibility state dưới transaction.
- **PostgreSQL relational-v2:** RelationalHttpBoundary điều phối auth/account/beneficiary/registration/transfer/savings/credit/KYC/remaining services; repositories dùng cùng PoolClient từ UnitOfWork. Route chưa cutover bị từ chối, không lặng lẽ fallback.
- **AI dispatch:** persistent HTTP dispatch /assistant/* riêng; không bọc toàn bộ inference chậm trong legacy withState. Auth/device guards vẫn áp dụng.
- Mặc định runtime là postgres + legacy-state. Muốn relational-v2 phải đặt BANKING_PERSISTENCE_MODE rõ ràng; đừng suy từ SQL tables tồn tại rằng mode hiện tại đã v2.

Không có Controller class/framework. http.ts và adminHttp.ts giữ vai trò HTTP boundary/controller bằng các hàm route dispatcher, validate/auth/service calls.

### Mobile

Feature-oriented function components/hooks. Route wrappers → feature screen → feature API → shared HTTP → response validator → React state/UI. AuthProvider là shared session owner. Money/intent/validation/storage modules hỗ trợ banking screens; Mobile không có local business database/ORM và không tự xác định balance/fee/interest.

Native session/device/intent dùng SecureStore. Web session/device là memory trong runtime: reload mất phiên; Web FA demo không chứng minh native durable intent/crash recovery.

### Admin Web

AppShell phối hợp các page và dữ liệu list. StaffProvider giữ staff/permissions/session generation; hash router tự viết chọn 10 menu. Backend phát HttpOnly session cookies; frontend CSRF memory/cookie và credentials:include. Action requests có review/frozen payload/idempotency/session scope; server là authority cho permission/version/fingerprint/four-eyes.

## 4. IMPORTANT FILES

Các tên file dưới đây có trong source hiện tại. “Được gọi bởi” mô tả entry/import/call hoặc route discovery thực tế, không phải mọi caller.

| File | Vai trò | Được gọi bởi | Gọi tới |
| --- | --- | --- | --- |
| backend/src/server.ts | Public API startup, chọn storage, inject config/MFA/AI | package start/dev, runtime/container | runtimeConfig, serverBind, BankingSystem, createBankingServer/createPersistentBankingServer, PostgresRelationalRepository |
| backend/src/serverBind.ts | Resolve host/binding an toàn cho server | server.ts, adminServer.ts | runtimeConfig, network interfaces |
| backend/src/runtimeConfig.ts | Validate env/storage/money/secrets/security configuration trước startup | server/adminServer/worker và scripts | secret metadata/runtime requirements |
| backend/src/http.ts | Customer route/controller boundary, body/auth/device/rate/deadline guards | server factories; HTTP tests | BankingSystem hoặc RelationalHttpBoundary, MFA, Assistant/FA service |
| backend/src/bankingSystem.ts | Reference facade/state orchestration | in-memory/legacy HTTP and fixtures | CoreBankingPort, LedgerPort, security, savings/credit/domain state |
| backend/src/coreBanking.ts | Core port + in-memory balance/transfer adapter | BankingSystem | money/domain records |
| backend/src/ledger.ts | Double-entry ledger port/in-memory implementation | BankingSystem/domain operations | ledger records/validation |
| backend/src/postgresRelationalRepository.ts | Pool/UoW + legacy compatibility persistence | public startup, tests | DatabasePool, UnitOfWork, SQL/state import/export |
| backend/src/database/relationalHttpBoundary.ts | Facade vào typed relational services | persistent http.ts | auth/account/beneficiary/registration/transfer/savings/credit/KYC/remaining services |
| backend/src/database/unitOfWork.ts | BEGIN/COMMIT/ROLLBACK/release transaction | relational services/Admin persistence | pool/client and transaction callback |
| backend/src/database/transferService.ts | Quote/submit transactional internal transfer | RelationalHttpBoundary | account/customer/transfer/ledger/audit/outbox repositories |
| backend/src/database/savingsService.ts | Products/quote/opening/deposit | RelationalHttpBoundary | savings/account/ledger/audit/outbox repositories, savings math |
| backend/src/database/creditService.ts | Credit applications/cards/statements/payments | RelationalHttpBoundary | credit/account/ledger/audit/outbox repositories, credit math |
| backend/src/database/lifecycleService.ts | Savings maturity/credit lifecycle transactions | scheduler/worker/tests | lifecycle locks, repositories, ledger/suspense/idempotency |
| backend/src/adminServer.ts | Admin process startup, repository/auth/action dependencies | admin:dev/start:admin | createAdminServer, staff auth/bootstrap/action engine, serverBind |
| backend/src/admin/http/adminHttp.ts | 58 registered Admin operations, cookie/CSRF/auth/response | Admin server | StaffAuthService, authorization, actionEngine, AdminRepository |
| backend/src/admin/actions/actionEngine.ts | Maker–checker action lifecycle/payload/fingerprint/execute | adminHttp/tests | permission registry, AdminRepository, policy and transactional execution |
| backend/src/admin/repositories/adminRepository.ts | Admin interface + in-memory/Postgres implementations | Admin bootstrap/auth/action/HTTP | SQL and domain mutation/adapters |
| backend/src/worker.ts | Background process entry | worker scripts/container profile | runtime config, WorkerRuntime, optional lifecycle scheduler |
| backend/src/workers/workerRuntime.ts | Lease/dispatch/delivery/retry/health | worker.ts | outbox repository/provider adapters/lifecycle |
| backend/scripts/apply-migration.cjs | Ordered SQL migration/checksum/advisory-lock runner | db:migrate/start:persistent/container migrate | database/*.sql, pg |
| backend/src/secrets/GoogleSecretManagerClient.ts | Client tích hợp Google Secret Manager | SecretProvider resolution | @google-cloud/secret-manager |
| backend/src/mfa/persistentMfaService.ts | TOTP credentials/challenge/recovery/rotation | auth/MFA HTTP + relational services | mfaRepository, crypto, digest/encryption keyring, delivery |
| backend/src/assistant/helpService.ts | Controlled guide/help selection | HTTP Assistant handler | knowledge/catalog/policy/provider/filter/limiter |
| backend/src/assistant/knowledgeLoader.ts | Chọn active compiled knowledge bundle | Help service/sync | assistant/knowledgeBundle.ts |
| backend/src/assistant/radoxHelpProvider.ts | Local model transport/strict provider boundary (thay thế Ollama) | Help/FA service | Radox / loopback provider + stream reader/abort |
| backend/src/financialAdvice/adviceService.ts | Financial Advice orchestration | HTTP FA handler/evaluator | validation/calculations/options/selectionPolicy/advisorPrompt/selectorValidation/explanationCatalog |
| backend/src/financialAdvice/isolatedDemoConfig.ts | Demo-only isolation/cap/counter config | demo launcher/tests | shared limiter/HTTP options; không business implementation riêng |
| mobile-app/index.ts | JS entry/platform bootstrap/router render | Expo/native | nativeBootstrap, Expo runtime/router |
| mobile-app/src/app/_layout.tsx | Root AuthProvider/locked UI/protected routes | Expo Router auto discovery | AuthContext, RootNavigator/shared UI |
| mobile-app/src/features/auth/context/AuthContext.tsx | Session epoch/refresh/logout/MFA lifecycle | root provider, useAuth consumers | authApi + session/device storage + AppState |
| mobile-app/src/services/api/httpClient.ts | Shared request/auth/device/idempotency/timeout/refresh/validation | feature API modules | fetch/config/ApiError/safeTelemetry/runtime validators |
| mobile-app/src/features/transfers/screens/TransferScreen.tsx | Transfer form/quote/step-up/persist/submit/recovery/UI | app/transfer.tsx | transfers/accounts/control/OTP APIs + transferIntentStorage |
| mobile-app/src/features/savings/screens/OpenSavingsScreen.tsx | Savings command flow | app/savings/open.tsx | savings/accounts/control/OTP APIs + savingsIntentStorage |
| mobile-app/src/features/credit/screens/CreditPaymentScreen.tsx | Card repayment/recovery | card payment route | credit/accounts/OTP APIs + cardPaymentIntentStorage |
| mobile-app/src/features/financial-advice/screens/FinancialAdviceScreen.tsx | Hai form/result advice + stale/session/abort guards | app/financial-advice.tsx | financialAdviceApi/validator/AuthContext/UI |
| mobile-app/src/features/banking/domain/clientIntentLifecycle.ts | Shared durable intent phases/normalization | intent stores/screens | pure lifecycle rules |
| admin-web/src/main.tsx | React mount | index.html | App |
| admin-web/src/App.tsx | Activation or StaffProvider/AppShell/menu/pages | main.tsx | StaffContext/router/feature pages |
| admin-web/src/context/StaffContext.tsx | Cookie session boot/refresh/login/logout/generation | App + page context consumers | api/logoutCoordinator/actionIntent |
| admin-web/src/api.ts | Same-origin cookie/CSRF/abort/deadline/error HTTP | context/pages/helpers | fetch; no Axios |
| admin-web/src/features/customers/actionIntent.ts | Frozen reviewed mutation/idempotency/unknown-result handling | Customers/StaffContext/tests | adminFetch/session-scoped pending state |
| admin-web/src/features/approvals/approvalsLogic.ts | Action-to-permission checks, fail-closed unknown action | Approvals/tests | action DTO/session permissions |
| documents/api/banking-mvp.openapi.yaml | Public Draft contract/type definitions | validators/docs/frontend contract tooling | 63 documented operations/105 schemas |
| documents/api/admin.openapi.yaml | Admin Draft route/permission contract | Admin contract validators/docs | 58 operations; business schemas còn thiếu |

## 5. PROGRAM FLOW

### 5.1 Public Backend startup

~~~text
package start/dev hoặc start:runtime
→ server.ts start()
→ readRuntimeConfig (validate env/required registration key)
→ BankingSystem + Assistant config/shared limiter + FA config
→ storage postgres?
   → resolve secret provider/database URL
   → initialize PostgresRelationalRepository/schema checks
   → persistent MFA + email provider
   → RelationalHttpBoundary
   → createPersistentBankingServer
  storage in-memory?
   → createBankingServer
→ repository health check khi có
→ startupReady=true
→ listen :5000 (default bind 0.0.0.0)
→ graceful server close + repository close
~~~

### 5.2 Mobile startup/session

~~~text
index.ts → platform bootstrap → Expo router App → RootLayout
→ AuthProvider loads device binding + stored session
→ booting/refreshing: loading UI
→ native stored session: locked → server refresh/rotation → authenticated
→ anonymous: (auth) login/register/recovery
→ authenticated: protected tabs/features
→ screen → API → requestJson → response validator → state/UI
~~~

HTTP mặc định timeout 15s, AbortController; 401 → refresh single-flight → retry đúng một lần. Giữ request ID/idempotency key; stale sessionEpoch không được ghi đè phiên mới. App background khóa, foreground xác nhận lại. Logout invalidate epoch, best-effort revoke server, clear local session và giữ banking recovery intents.

Customer login hiện password-only. Registration EMAIL_OTP và transaction/account-security TOTP step-up là những flow riêng; Admin login vẫn có TOTP.

### 5.3 Registration/KYC

RegisterScreen persist BEGIN_UNKNOWN trước POST registration → server rate/validation/pending registration → challenge EMAIL_OTP → verify → tạo customer/device/account zero balance → login. Chưa rõ kết quả bắt đầu thì recovery bằng record/challenge đã có; không tự đăng ký lại khi mount.

KycScreen GET draft/status/version → synthetic validation → save/submit → backend KYC service/persistence → Admin claim/recommendation/action decision → server status. Public identity chỉ last4; full newly entered value không giữ như public profile.

### 5.4 Accounts/history/QR

Home/AccountDetail/History → account/transaction APIs → ownership/auth guards → account read service/repository → authoritative balances/page/detail → state/render. Reveal account number dùng endpoint riêng.

QR: owned account + protected reveal → generate receiving-information QR hoặc scan → strict version/schema validation → trust UNVERIFIED → hiển thị thông tin. Không có payment execution từ QR.

### 5.5 Transfer

~~~text
Recipient/beneficiary lookup → policy + amount → server quote
→ review quote/fee/expiry → persist DRAFT_QUOTE + idempotency
→ step-up challenge/proof
→ persist SUBMIT_UNKNOWN trước POST
→ server reserve idempotency/fingerprint
→ replay receipt hoặc lock quote/accounts + validate ownership/policy/funds
→ balances/version + transfer + account transactions + balanced ledger
→ audit + notification/outbox + canonical idempotency response
→ commit → receipt → state/UI
→ pending/unknown: GET operation hoặc retry cùng key; recovery sau restart native
~~~

Không optimistic-update balance. Known rejection, outcome unknown và manual review được xử lý khác nhau. Relational internal transfer có settle synchronous; reference path vẫn có thể trả trạng thái pending/failure/reversed.

### 5.6 Savings/Credit/Card

Savings: products/accounts/policy → server quote principal/rate/actual-days/maturity → review/step-up → durable idempotent opening → transactional debit/deposit/ledger/outbox → list/detail. Scheduler riêng xử lý maturity/renewal/suspense khi enabled.

Credit: application → Admin decision → activation → sandbox credit account/card. Statement/payment: server totals/due/version → MINIMUM/FULL_STATEMENT/CUSTOM quote → step-up + durable submit → transaction/idempotency/ledger/outbox → receipt/recovery. Emergency card lock tách khỏi unlock/report-lost có step-up.

### 5.7 Notifications

Outbox/business event → notification record → owned list/read → route tới resource. Push/email notification worker hiện fake/disabled. Chức năng khách hàng báo cáo gian lận (FraudReportScreen) và luồng xử lý Fraud của Admin đã được gỡ bỏ hoàn toàn khỏi app, API và Admin theo quyết định D-39 (13/10/2026).

### 5.8 Assistant/Financial Advice

Help: câu hỏi → sensitive input filter/knowledge/catalog → controlled provider selection (Radox/loopback) hoặc deterministic answer → fixed safe guide; không gọi banking command.

Financial Advice:

~~~text
FinancialAdviceScreen chọn SAVINGS_PLAN/BUDGET_BALANCE
→ nhập số liệu USER_ENTERED + xác nhận giả định
→ mobile canonical amount/form validation
→ POST /api/v1/assistant/financial-advice
→ bearer/device/body/deadline/rate guards
→ BigInt calculator → feasible options/allowed reasons
→ bounded Radox/Qwen selector nếu enabled + quota
→ strict JSON/duplicate-key/semantic allowlist validation
→ explanationCatalog templates
→ AI_ASSISTED hoặc RULE_BASED
→ Mobile response validator + requestGeneration/sessionEpoch guards
→ metrics/options/warnings/assumptions UI
~~~

Không lấy history/accounts tự động, không lưu advice xuống DB, không chuyển tiền. Request tổng timeout vẫn có thể 504; provider timeout/invalid/quota có thể fallback riêng. suggestedMonths=0 khi goal đã đủ, null khi không có timeline phù hợp. Hai use case dùng cùng native/Web source; demo launcher chỉ thay environment.

### 5.9 Admin startup/action workflow

~~~text
index.html → main.tsx → App
→ /admin/activate? : Activation
→ đường khác: StaffProvider → refresh cookie → /admin/me
→ OPERATIONS: password login; ADMIN: password → TOTP verify → staff permissions
→ AppShell hash tab → page → adminFetch
→ backend staff session + CSRF + permission/environment/ownership checks
→ request action (maker, frozen payload/key/target version/fingerprint)
→ checker fresh TOTP step-up → approve/reject
→ forbidden self-approval/stale target check
→ repository transaction executes once + audit
→ authoritative response + reload UI
~~~

Logout/session generation guards chặn response/action của phiên cũ. Admin không tự retry mutation khi outcome chưa xác định; actionIntent giữ reviewed payload/key trong memory theo phiên.

### 5.10 Worker startup

worker.ts → runtime worker config/explicit enabled+cutover guards → WorkerRuntime initialize → poll/claim outbox lease → dispatch/delivery retry/backoff/dedup → sent hoặc dead-letter → health/heartbeat. Lifecycle scheduler chạy riêng theo flags; public API startup không tự mở worker.

## 6. CLASS / MODULE RELATIONSHIPS

~~~text
Public HTTP handler
 ├─ BankingSystem (reference facade)
 │   ├─ CoreBankingPort → InMemoryCoreBanking
 │   └─ LedgerPort → InMemoryLedger
 └─ RelationalHttpBoundary
     ├─ RelationalAuthService / RegistrationService / KycService
     ├─ RelationalAccountReadService / Beneficiary / Remaining
     ├─ RelationalTransferService / SavingsService / CreditService
     └─ UnitOfWork → PoolClient → repositories → PostgreSQL

Business mutation transaction
 → account/domain record
 → ledger journal/entries
 → audit
 → outbox
 → worker after commit

AdminHttp → StaffAuthService + authorization
          → actionEngine → AdminRepository
                          ├─ InMemoryAdminRepository
                          └─ PostgresAdminRepository

Mobile Route → Screen → Feature API → requestJson → Public HTTP
       AuthProvider/useAuth ↔ session epoch/storage/refresh lifecycle

Admin App → StaffProvider → AppShell/Page → adminFetch → AdminHttp
                             actionIntent/AccountLoadManager/approvalsLogic

FinancialAdviceService
 → calculator/options → selectionPolicy
 → advisorPrompt → AssistantHelpProvider (Ollama hoặc fake)
 → selectorValidation → explanationCatalog → public DTO
~~~

Các DTO TypeScript không phải ORM class. Một số class constructor nhận repository/provider/clock/keyring để thay bằng fixture; không có DI container/framework.

## 7. DESIGN PATTERNS

Chỉ các cơ chế có code thể hiện được liệt kê:

| Pattern/cơ chế | Class/module tham gia | Vai trò và luồng hoạt động |
| --- | --- | --- |
| Repository | database/repositories/*; AdminRepository/InMemoryAdminRepository/PostgresAdminRepository | Tách truy vấn/map row khỏi service; service gọi repository với transaction client; test có in-memory implementation |
| Unit of Work | database/unitOfWork.ts, pool.ts, transactionRetry.ts | Cùng PoolClient cho mutation/ledger/audit/outbox; commit/rollback/release; retry bounded callback cho serialization/deadlock SQLSTATE |
| Ports & Adapters | CoreBankingPort/InMemoryCoreBanking, LedgerPort/InMemoryLedger, AssistantHelpProvider/Fake/Ollama, SecretProvider và delivery ports | Business code phụ thuộc interface; constructor/factory chọn adapter cho local/runtime/test |
| Manual DI / Strategy | Constructors/factories của services/providers/repositories | Inject provider/clock/storage/crypto; chọn behavior qua cấu hình, không framework decorator |
| Facade | BankingSystem, RelationalHttpBoundary | HTTP gọi facade/service groups thay vì thao tác trực tiếp mọi domain object |
| Transactional Outbox | OutboxRepository + business transactions + WorkerRuntime | Event ghi cùng business transaction; worker lease/retry/dedup sau commit |
| Cache decorator | secrets/secretCache.ts implements SecretProvider | Bao inner provider bằng cache TTL; delegate cache miss; không suy ra cloud Secret Manager đã triển khai |
| Provider composition | Mobile AuthProvider/useAuth, Admin StaffProvider | Shared authentication state/lifecycle tới React consumers |
| Explicit state-machine approach | clientIntentLifecycle; Admin actionIntent | Discriminated phases và transitions cho reviewed/submitting/unknown/accepted command; không đồng nhất với GoF State class hierarchy |
| Single-flight/serialized queue idioms | AuthContext, httpClient, SecureStore queues, logoutCoordinator | Gộp concurrent refresh và chặn stale/old-session writes; đây là concurrency coordination, không gán thêm GoF pattern |

Standalone transferStateMachine.ts/savingsOpeningStateMachine.ts có tests nhưng runtime screens không import trực tiếp. Không gọi chúng là state engine đang điều khiển UI.

Không thấy căn cứ để gán toàn project MVC/MVVM, Event Sourcing, Singleton, CQRS framework hoặc GoF Observer. Ledger/audit/event table và tên trạng thái không tự chứng minh các pattern đó.

## 8. DATA MODEL

### Quy ước dữ liệu

- Domain/public models là TypeScript type/interface trong backend/src/types.ts, savings.ts, credit.ts, financialAdvice/types.ts và Mobile features/*/types.
- Money public: currency=VND, amountMinor là chuỗi integer; calculator dùng BigInt, không floating-point làm nguồn sự thật tài chính.
- SQL thường dùng *_minor bigint, IDs UUID/text tùy bảng, status/version/timestamps; row mapper chuyển sang public masked DTO.
- Tên field credential được nêu để hiểu model, không có giá trị password/token/key trong tài liệu.

| Model | Field chính | Quan hệ |
| --- | --- | --- |
| AuthUser / Customer | id, fullName, email, phoneNumber, createdAt; persistence thêm digest/salt/access status | 1 customer → nhiều devices/sessions/accounts/beneficiaries/domain operations |
| Device / Session | deviceId/customerId, attestation/revoked; session family/device/expiry/token hashes/revocation | customer → device → session; refresh rotation theo family |
| PaymentAccount | id, displayName, maskedNumber, currency, heldAmount, availableBalance, currentBalance, status, updatedAt; private owner/number/version | customer → nhiều accounts → nhiều account transactions |
| Transaction | id, accountId, direction, amount, fee, status, kind, description, counterpartyName, occurredAt; detail reference/createdAt/completedAt | tài khoản → transaction; liên kết transfer/savings opening/credit payment khi phù hợp |
| Beneficiary / RecipientLookup | id, displayName, accountHolderName, maskedAccountNumber, bankName, status; lookup TTL/fingerprint | thuộc customer, được quote xác nhận recipient |
| TransferQuote | quoteId, sourceAccountId, beneficiary, amount, fee, totalDebit, expiresAt | source/recipient → quote → consumed transfer |
| TransferReceipt / TransferRow | transferId/reference/status/amount/fee/createdAt/updatedAt; private quote/idempotency/fingerprint/version | transfer → debit/credit transaction + ledger/audit/outbox |
| LedgerJournal / Entry | journalId/aggregateId/type/currency; lineNumber/accountRef/side/amountMinor/entryId | journal → nhiều entries; deferred balanced/has-entry constraints |
| SavingsProduct | productId/name/termMonths/annualRateBasisPoints/currency/min/max/status/termsVersion | product → quotes/deposits |
| SavingsQuote / Opening / Deposit | quote source/principal/rate/interest/total/dates; opening quote/deposit/status/reference; deposit principal/rate/term/maturityInstruction/status/renewedDepositId | quote → opening → deposit; deposit có renewal/lifecycle operation |
| CreditApplication | applicationId/requestedLimit/approvedLimit/status/decisionReason/accountId/timestamps | customer → application → approved/activated account/card |
| CreditAccount / CreditCard | accountId/creditLimit/postedOutstanding/pendingAuthorizations/availableCredit/nextStatement/status/version; cardId/brand/maskedNumber/last4/expiry/status | account → nhiều cards/transactions/statements |
| CreditStatement / Transaction | cycle/issue/due, totals/minimum/remaining/paid/status/version; transaction type/status/merchant/amount/debtEffect/dates | statement ↔ items/credit transactions → payment allocations |
| CreditPaymentQuote / Payment | quote source/account/statement/version/option/amount/fee/expiry; paymentId/statement/source/amount/reference/status/failureReason | source payment account → repayment → credit statement/account |
| KycApplication | id/userId/fullName/identityNumberLast4/address/documentUri/status/rejectionReason/submittedAt/updatedAt/version | customer → application/documents/reviews; private synthetic payload không là public identity |
| Notification | id/type/title/body/resourceId/resourceAccountId/read/createdAt | customer + owned business resource |
| FraudReport | reportId/accountId/transactionId/reason/status/createdAt | Model lịch sử (runtime API và app đã gỡ bỏ theo D-39; bảng DB giữ để bảo toàn dữ liệu) |
| OutboxEvent / Delivery / DeadLetter | eventType/aggregateId/deduplicationKey/payload/attempts/nextAttempt/published; delivery lease/provider/status; dead-letter final error metadata | business event → deliveries/worker state |
| MfaCredential / Recovery | credential owner/type/status/ciphertext/key metadata/time step; recovery code digest/status; recovery request cooldown/expiry | customer → credentials/challenges/recovery records |
| Staff / Role / Session | staff id/status/authorizationVersion/roles/environmentScope/expiry; session hashes/CSRF/step-up/idle+absolute TTL | staff ↔ roles ↔ permissions; separate customer auth realm |
| AdminAction / Decision | actionType/requester/target/fingerprint/policy/status/key/version/expiry/payload/result; reviewer/decision/reason/approvedFingerprint | maker action → distinct checker decision → execution attempt/audit |
| FinancialAdviceRequest | schemaVersion/kind/currency/monthlyIncomeMinor/essentialExpensesMinor/flexibleExpensesMinor/monthlyDebtPaymentsMinor/monthlyBufferMinor/preference/inputConfirmed; goal hoặc monthlySavingsTargetMinor | request-scoped USER_ENTERED, không entity lưu DB |
| FinancialAdviceResponse | source/calculationVersion/catalogVersion/budgetStatus/goalStatus hoặc savingsTargetStatus/metrics/options/preferredOptionId/explanation/assumptions/warnings | calculator facts → finite options → AI/rules preference + fixed explanations |

Public schema fields và yêu cầu chính xác xem mục 9 + runtime validators. Admin frontend DTO generics không có runtime validator đầy đủ cho mọi response; server/contract không bị thay bằng TypeScript cast.


## 9. API / DATABASE

### 9.1 Contract và runtime boundaries

Public base path /api/v1; Admin base /api/v1/admin. Tables dưới là inventory toàn bộ operations trong hai OpenAPI Draft hiện tại, đối chiếu nhóm dispatcher/service trong source. Auth/config/mode có thể làm một operation không khả dụng: có path trong contract không chứng minh đã bật hoặc đã chạy.

Public request/response có named schemas; dấu * trong danh mục schema chỉ field required. Path IDs và query/header được ghi khi contract định nghĩa. RequestAuth gửi bearer + X-Device-ID; mutation ngân hàng giữ Idempotency-Key, step-up theo purpose/fingerprint; Admin dùng cookie + CSRF, không dùng customer bearer.

Đặc biệt POST /auth/verify là compatibility route; relational-v2 không thực hiện login-challenge verifier. Customer login thực tế password-only. POST /assistant/financial-advice mặc định disabled cho đến FINANCIAL_ADVICE_ENABLED=1; bật AI là cấu hình riêng.

### 9.2 Public API — 63 operations

Nguồn: documents/api/banking-mvp.openapi.yaml (63 operations sau khi gỡ bỏ 2 route Fraud); dispatcher backend/src/http.ts. Các service path rút gọn trong bảng đều tương đối dưới backend/src/.

| Method + endpoint (thêm /api/v1 trước path) | Request body/schema; params | Response status/schema | File xử lý |
| --- | --- | --- | --- |
| POST `/auth/register` | RegisterRequest | 202:RegistrationChallengeResponse; 409:body không khai báo; 422:body không khai báo; 429:body không khai báo | `backend/src/http.ts` + `database/registrationService.ts` |
| POST `/auth/register/verify` | VerifyRegistrationChallengeRequest | 201:RegisterResponse; 401:body không khai báo; 409:body không khai báo; 422:body không khai báo; 429:body không khai báo | `backend/src/http.ts` + `database/registrationService.ts` |
| POST `/auth/register/cancel` | CancelChallengeRequest | 204:body không khai báo; 404:body không khai báo; 409:body không khai báo; 422:body không khai báo; 429:body không khai báo | `backend/src/http.ts` + `database/registrationService.ts` |
| POST `/auth/otp/challenges` | CreateOtpChallengeRequest | 201:AuthChallengeResponse; 401:body không khai báo; 422:body không khai báo; 429:body không khai báo | `backend/src/http.ts` + `mfa/persistentMfaService.ts` |
| GET `/auth/mfa/methods` | không body được khai báo | 200:MfaMethodsResponse; 401:body không khai báo | `backend/src/http.ts` + `mfa/persistentMfaService.ts` |
| POST `/auth/mfa/totp/enroll` | TotpEnrollRequest | 201:TotpEnrollmentResponse; 401:body không khai báo | `backend/src/http.ts` + `mfa/persistentMfaService.ts` |
| POST `/auth/mfa/totp/confirm` | TotpConfirmRequest | 200:TotpConfirmationResponse; 401:body không khai báo | `backend/src/http.ts` + `mfa/persistentMfaService.ts` |
| DELETE `/auth/mfa/methods/{credentialId}` | CurrentPasswordRequest | 204:body không khai báo; 401:body không khai báo; 409:body không khai báo | `backend/src/http.ts` + `mfa/persistentMfaService.ts` |
| POST `/auth/mfa/recover` | RecoveryCodeRequest | 202:RecoveryStartedResponse; 401:body không khai báo | `backend/src/http.ts` + `mfa/persistentMfaService.ts` |
| POST `/auth/mfa/recover/verify` | RecoveryCodeRequest | 202:RecoveryStartedResponse; 401:body không khai báo | `backend/src/http.ts` + `mfa/persistentMfaService.ts` |
| POST `/auth/mfa/recover/complete` | RecoveryCompletionRequest | 202:RecoveryCompletionResponse; 401:body không khai báo; 409:ApiError | `backend/src/http.ts` + `mfa/persistentMfaService.ts` |
| POST `/auth/mfa/recover/enroll` | RecoveryEnrollmentRequest | 201:TotpEnrollmentResponse; 401:body không khai báo | `backend/src/http.ts` + `mfa/persistentMfaService.ts` |
| POST `/auth/mfa/recovery-codes/rotate` | RecoveryCodesRotateRequest | 200:RecoveryCodesRotateResponse; 400:body không khai báo; 401:body không khai báo | `backend/src/http.ts` + `mfa/persistentMfaService.ts` |
| POST `/auth/challenges/{challengeId}/resend` | không body được khai báo | 200:RegistrationChallengeResponse; 404:body không khai báo; 429:body không khai báo | `backend/src/http.ts` + `mfa/persistentMfaService.ts` |
| POST `/auth/login` | LoginRequest | 200:LoginResponse; 401:body không khai báo; 422:body không khai báo; 429:body không khai báo | `backend/src/http.ts` + `database/relationalAuthService.ts` |
| POST `/auth/refresh` | RefreshTokenRequest | 200:RefreshTokenResponse; 401:body không khai báo; 429:body không khai báo | `backend/src/http.ts` + `database/relationalAuthService.ts` |
| POST `/auth/verify` | VerifyAuthChallengeRequest | 200:LoginResponse; 401:body không khai báo; 429:body không khai báo; compatibility, relational-v2 disabled | `backend/src/http.ts` + `database/relationalAuthService.ts` |
| POST `/auth/logout` | LogoutRequest | 204:body không khai báo; 401:body không khai báo | `backend/src/http.ts` + `database/relationalAuthService.ts` |
| POST `/auth/logout-all` | không body được khai báo | 204:body không khai báo; 401:body không khai báo | `backend/src/http.ts` + `database/relationalAuthService.ts` |
| GET `/mobile/control-policy` | không body được khai báo | 200:ControlPolicy; 401:body không khai báo | `backend/src/http.ts` + `database/controlPolicyRepository.ts` |
| GET `/notifications` | không body được khai báo | 200:NotificationsResponse; 401:body không khai báo | `backend/src/http.ts` + `database/remainingService.ts` |
| POST `/notifications/{notificationId}/read` | không body được khai báo | 200:Notification; 401:body không khai báo; 404:body không khai báo | `backend/src/http.ts` + `database/remainingService.ts` |
| GET `/accounts` | không body được khai báo | 200:AccountsResponse; 401:body không khai báo | `backend/src/http.ts` + `database/relationalAccountReadService.ts` |
| POST `/internal-recipients/lookup` | InternalRecipientLookupRequest | 200:InternalRecipientLookupResponse; 401:body không khai báo; 404:body không khai báo; 409:body không khai báo; 500:body không khai báo | `backend/src/http.ts` + `database/remainingService.ts` |
| GET `/accounts/{accountId}/number` | không body được khai báo | 200:AccountNumberResponse; 401:body không khai báo; 404:body không khai báo | `backend/src/http.ts` + `database/relationalAccountReadService.ts` |
| GET `/accounts/{accountId}/transactions` | không body được khai báo; query:cursor, query:limit | 200:TransactionPage; 401:body không khai báo; 404:body không khai báo | `backend/src/http.ts` + `database/relationalAccountReadService.ts` |
| GET `/accounts/{accountId}/transactions/{transactionId}` | không body được khai báo | 200:TransactionDetail; 401:body không khai báo; 404:body không khai báo | `backend/src/http.ts` + `database/relationalAccountReadService.ts` |
| GET `/beneficiaries/{beneficiaryId}` | không body được khai báo | 200:BeneficiaryResponse; 401:body không khai báo; 404:body không khai báo | `backend/src/http.ts` + `database/relationalBeneficiaryService.ts` |
| PATCH `/beneficiaries/{beneficiaryId}` | RenameBeneficiaryRequest | 200:BeneficiaryResponse; 401:body không khai báo; 404:body không khai báo; 422:body không khai báo | `backend/src/http.ts` + `database/relationalBeneficiaryService.ts` |
| DELETE `/beneficiaries/{beneficiaryId}` | không body được khai báo | 204:body không khai báo; 401:body không khai báo; 404:body không khai báo | `backend/src/http.ts` + `database/relationalBeneficiaryService.ts` |
| GET `/beneficiaries` | không body được khai báo | 200:BeneficiariesResponse; 401:body không khai báo | `backend/src/http.ts` + `database/relationalBeneficiaryService.ts` |
| POST `/beneficiaries` | CreateBeneficiaryRequest | 201:BeneficiaryResponse; 401:body không khai báo; 409:body không khai báo; 422:body không khai báo | `backend/src/http.ts` + `database/relationalBeneficiaryService.ts` |
| POST `/transfers/quote` | TransferQuoteRequest | 200:TransferQuote; 401:body không khai báo; 404:body không khai báo; 409:body không khai báo; 422:body không khai báo | `backend/src/http.ts` + `database/transferService.ts` |
| POST `/transfers` | SubmitTransferRequest; header:Idempotency-Key* | 200:TransferReceipt; 202:TransferReceipt; 401:body không khai báo; 404:body không khai báo; 409:body không khai báo; 422:body không khai báo; 429:body không khai báo | `backend/src/http.ts` + `database/transferService.ts` |
| GET `/transfers/{transferId}` | không body được khai báo | 200:TransferReceipt; 401:body không khai báo; 404:body không khai báo | `backend/src/http.ts` + `database/transferService.ts` |
| GET `/savings/products` | không body được khai báo | 200:object; 401:body không khai báo | `backend/src/http.ts` + `database/savingsService.ts` |
| POST `/savings/quotes` | SavingsQuoteRequest | 200:SavingsQuote; 401:body không khai báo; 404:body không khai báo; 409:body không khai báo; 422:body không khai báo | `backend/src/http.ts` + `database/savingsService.ts` |
| GET `/savings/deposits` | không body được khai báo | 200:SavingsDepositsResponse; 401:body không khai báo | `backend/src/http.ts` + `database/savingsService.ts` |
| POST `/savings/deposits` | SubmitSavingsOpeningRequest; header:Idempotency-Key* | 200:SavingsOpening; 202:SavingsOpening; 401:body không khai báo; 404:body không khai báo; 409:body không khai báo; 422:body không khai báo; 429:body không khai báo | `backend/src/http.ts` + `database/savingsService.ts` |
| GET `/savings/openings/{openingId}` | không body được khai báo | 200:SavingsOpening; 401:body không khai báo; 404:body không khai báo | `backend/src/http.ts` + `database/savingsService.ts` |
| GET `/savings/deposits/{depositId}` | không body được khai báo | 200:SavingsDeposit; 401:body không khai báo; 404:body không khai báo | `backend/src/http.ts` + `database/savingsService.ts` |
| GET `/cards` | không body được khai báo | 200:CreditCardsResponse; 401:body không khai báo; 409:body không khai báo | `backend/src/http.ts` + `database/creditService.ts` |
| GET `/cards/{cardId}` | không body được khai báo | 200:CreditCardDetailResponse; 401:body không khai báo; 404:body không khai báo | `backend/src/http.ts` + `database/creditService.ts` |
| POST `/cards/{cardId}/lock` | không body được khai báo | 200:CreditCardResponse; 401:body không khai báo; 404:body không khai báo; 409:body không khai báo | `backend/src/http.ts` + `database/creditService.ts` |
| POST `/cards/{cardId}/unlock` | CardControlStepUpRequest | 200:CreditCardResponse; 401:body không khai báo; 404:body không khai báo; 409:body không khai báo; 422:body không khai báo; 429:body không khai báo | `backend/src/http.ts` + `database/creditService.ts` |
| POST `/cards/{cardId}/report-lost` | CardControlStepUpRequest | 200:CardReportedLostResponse; 401:body không khai báo; 404:body không khai báo; 409:body không khai báo; 422:body không khai báo; 429:body không khai báo | `backend/src/http.ts` + `database/creditService.ts` |
| GET `/credit/accounts` | không body được khai báo | 200:CreditAccountsResponse; 401:body không khai báo | `backend/src/http.ts` + `database/creditService.ts` |
| GET `/credit/applications` | không body được khai báo | 200:CreditApplicationsResponse; 401:body không khai báo | `backend/src/http.ts` + `database/creditService.ts` |
| POST `/credit/applications` | CreditApplicationRequest | 201:CreditApplication; 401:body không khai báo; 409:body không khai báo; 422:body không khai báo; 429:body không khai báo | `backend/src/http.ts` + `database/creditService.ts` |
| GET `/credit/applications/{applicationId}` | không body được khai báo | 200:CreditApplication; 401:body không khai báo; 404:body không khai báo | `backend/src/http.ts` + `database/creditService.ts` |
| POST `/credit/applications/{applicationId}/activate` | CreditStepUpRequest | 200:CreditApplication; 401:body không khai báo; 404:body không khai báo; 409:body không khai báo; 422:body không khai báo; 429:body không khai báo | `backend/src/http.ts` + `database/creditService.ts` |
| GET `/credit/accounts/{creditAccountId}` | không body được khai báo | 200:CreditAccount; 401:body không khai báo; 409:body không khai báo | `backend/src/http.ts` + `database/creditService.ts` |
| GET `/credit/accounts/{creditAccountId}/transactions` | không body được khai báo | 200:CreditTransactionsResponse; 401:body không khai báo | `backend/src/http.ts` + `database/creditService.ts` |
| GET `/credit/accounts/{creditAccountId}/statements` | không body được khai báo | 200:CreditStatementsResponse; 401:body không khai báo | `backend/src/http.ts` + `database/creditService.ts` |
| GET `/credit/accounts/{creditAccountId}/statements/{statementId}` | không body được khai báo | 200:CreditStatementResponse; 401:body không khai báo; 409:body không khai báo | `backend/src/http.ts` + `database/creditService.ts` |
| POST `/credit/payment-quotes` | CreditPaymentQuoteRequest | 200:CreditPaymentQuote; 401:body không khai báo; 404:body không khai báo; 409:body không khai báo; 422:body không khai báo | `backend/src/http.ts` + `database/creditService.ts` |
| POST `/credit/payments` | CreditPaymentRequest; header:Idempotency-Key* | 200:CreditPayment; 202:CreditPayment; 401:body không khai báo; 404:body không khai báo; 409:body không khai báo; 422:body không khai báo; 429:body không khai báo | `backend/src/http.ts` + `database/creditService.ts` |
| GET `/credit/payments/{paymentId}` | không body được khai báo | 200:CreditPayment; 401:body không khai báo; 404:body không khai báo | `backend/src/http.ts` + `database/creditService.ts` |
| GET `/kyc/application` | không body được khai báo | 200:KycApplicationResponse; 401:body không khai báo | `backend/src/http.ts` + `database/kycService.ts` |
| POST `/kyc/application` | KycApplicationRequest | 200:KycApplicationResponse; 401:body không khai báo; 409:body không khai báo; 422:body không khai báo | `backend/src/http.ts` + `database/kycService.ts` |
| POST `/kyc/application/submit` | KycApplicationRequest | 201:KycApplicationResponse; 401:body không khai báo; 409:body không khai báo; 422:body không khai báo | `backend/src/http.ts` + `database/kycService.ts` |
| POST `/assistant/help` | AssistantHelpRequest | 200:AssistantHelpResponse; 401:body không khai báo; 415:body không khai báo; 422:body không khai báo; 429:body không khai báo; 502:body không khai báo; 503:body không khai báo; 504:body không khai báo | `backend/src/http.ts` + `assistant/helpService.ts` |
| POST `/assistant/financial-advice` | FinancialAdviceRequest | 200:FinancialAdviceResponse; 401:body không khai báo; 413:body không khai báo; 415:body không khai báo; 422:body không khai báo; 429:body không khai báo; 503:body không khai báo; 504:body không khai báo | `backend/src/http.ts` + `financialAdvice/adviceService.ts` |

### 9.3 Public schema index

Các schema sau lấy từ components.schemas, không từ ví dụ dữ liệu. Chỉ ghi field names/type reference, không token/password/OTP/key values. Inline nested/union constraints và additionalProperties phải đọc trực tiếp OpenAPI và runtime validator; bảng không thay thế validation.

| Schema | Top-level fields (* required) |
| --- | --- |
| `ApiErrorPayload` | code*, message*, fieldErrors*, traceId* |
| `AuthUser` | id*, fullName*, email*, phoneNumber*, createdAt* |
| `RegisterRequest` | fullName*, email*, phoneNumber*, password* |
| `RegisterResponse` | user* |
| `LoginRequest` | email*, password* |
| `LoginResponse` | accessToken*, refreshToken*, expiresInSeconds*, user* |
| `RefreshTokenRequest` | refreshToken* |
| `RefreshTokenResponse` | xem union/inline definition |
| `AuthChallengeResponse` | challengeId*, expiresAt*, purpose*, methods*, method, resendAfter, maskedDestination |
| `RegistrationChallengeResponse` | challengeId*, expiresAt*, methods*, method*, purpose*, resendAfter*, maskedDestination* |
| `MfaChallengeResponse` | challengeId*, method*, methods*, purpose*, expiresAt*, resendAfter, maskedDestination |
| `MfaCredential` | id*, customerId*, credentialType*, displayName*, status*, algorithm, digits, periodSeconds |
| `MfaMethodsResponse` | items* |
| `TotpEnrollRequest` | password*, displayName, challengeId, code |
| `TotpEnrollmentResponse` | credentialId*, status*, expiresAt*, manualSetupKey*, otpauthUri* |
| `TotpConfirmRequest` | credentialId*, code*, recoveryToken |
| `TotpConfirmationResponse` | credentialId*, status*, recoveryCodes* |
| `RecoveryCodeRequest` | code*, recoveryToken, email, password |
| `RecoveryCompletionRequest` | recoveryToken* |
| `RecoveryCompletionResponse` | status* |
| `RecoveryEnrollmentRequest` | recoveryToken*, displayName |
| `RecoveryStartedResponse` | status*, recoveryRequestId*, recoveryToken*, cooldownUntil* |
| `RecoveryCodesRotateRequest` | password, challengeId*, code* |
| `RecoveryCodesRotateResponse` | status*, recoveryCodes* |
| `CurrentPasswordRequest` | password*, challengeId, code |
| `CreateOtpChallengeRequest` | purpose*, resourceId, requestFingerprint |
| `FundingReceipt` | fundingId*, reference*, status*, amount*, transactionId*, recipientMaskedAccountNumber*, createdAt* |
| `InternalRecipientLookupRequest` | accountNumber* |
| `InternalRecipientLookup` | lookupId*, accountHolderName*, maskedAccountNumber*, bankName*, status*, expiresAt* |
| `InternalRecipientLookupResponse` | recipient* |
| `VerifyAuthChallengeRequest` | challengeId*, method*, proof* |
| `VerifyRegistrationChallengeRequest` | challengeId*, method*, proof* |
| `CancelChallengeRequest` | challengeId* |
| `LogoutRequest` | refreshToken* |
| `ControlPolicy` | configVersion*, globalKillSwitch*, transfersEnabled*, allowlisted*, maxTransferAmountMinor*, stepUpMethods*, savingsEnabled*, savingsAllowlisted*, maxSavingsAmountMinor*, savingsStepUpMethods*, creditEnabled*, creditAllowlisted*, creditPaymentsEnabled*, cardControlsEnabled*, maxCreditPaymentAmountMinor*, creditPaymentStepUpMethods*, cardUnlockStepUpMethods*, updatedAt* |
| `Notification` | id*, type*, title*, body*, resourceId*, resourceAccountId*, read*, createdAt* |
| `NotificationsResponse` | items* |
| `FraudReportRequest` | accountId*, transactionId*, reason* |
| `FraudReportResponse` | reportId*, status*, createdAt* |
| `KycApplicationRequest` | fullName*, identityNumber, address*, documentUri*, syntheticDataConfirmed* |
| `KycApplication` | id*, userId*, fullName*, identityNumberLast4*, address*, documentUri*, status*, rejectionReason*, submittedAt*, updatedAt*, version* |
| `KycApplicationResponse` | application* |
| `Money` | currency*, amountMinor* |
| `Beneficiary` | id*, displayName*, accountHolderName*, maskedAccountNumber*, bankName*, status* |
| `BeneficiaryResponse` | beneficiary* |
| `BeneficiariesResponse` | items* |
| `CreateBeneficiaryRequest` | displayName*, accountNumber*, bankName |
| `RenameBeneficiaryRequest` | displayName* |
| `PaymentAccount` | id*, displayName*, maskedNumber*, bankName*, currency*, heldAmount*, availableBalance*, currentBalance*, status*, updatedAt* |
| `AccountsResponse` | accounts* |
| `AccountNumberResponse` | accountNumber* |
| `Transaction` | id*, accountId*, direction*, amount*, fee*, status*, kind*, description*, counterpartyName*, occurredAt* |
| `TransactionPage` | items*, nextCursor* |
| `TransactionDetail` | xem union/inline definition |
| `TransferQuoteRequest` | sourceAccountId*, beneficiaryId, lookupId, amount* |
| `TransferQuote` | quoteId*, sourceAccountId*, beneficiary*, amount*, fee*, totalDebit*, expiresAt* |
| `SubmitTransferRequest` | quoteId*, stepUp* |
| `TransferReceipt` | transferId*, reference*, status*, amount*, fee*, createdAt*, updatedAt* |
| `SavingsProduct` | productId*, name*, termMonths*, annualRateBasisPoints*, currency*, minAmountMinor*, maxAmountMinor*, status*, termsVersion* |
| `SavingsQuoteRequest` | sourceAccountId*, productId*, principal*, maturityInstruction* |
| `SavingsQuote` | quoteId*, productId*, productName*, termsVersion*, termMonths*, sourceAccountId*, sourceAccountMaskedNumber*, principal*, annualRateBasisPoints*, interestDays*, expectedInterest*, totalAtMaturity*, openedAt*, maturityAt*, maturityInstruction*, expiresAt* |
| `SubmitSavingsOpeningRequest` | quoteId*, stepUp* |
| `SavingsOpening` | openingId*, quoteId*, depositId*, status*, reference*, failureReason*, createdAt*, updatedAt* |
| `SavingsDeposit` | depositId*, productId*, productName*, termsVersion*, termMonths*, principal*, annualRateBasisPoints*, expectedInterest*, totalAtMaturity*, openedAt*, maturityAt*, maturityInstruction*, sourceAccountMaskedNumber*, status*, reference*, updatedAt*, renewedDepositId* |
| `SavingsDepositsResponse` | items*, totalPrincipal* |
| `CreditStepUpRequest` | method*, proof*, challengeId* |
| `CardControlStepUpRequest` | stepUp* |
| `CreditCard` | cardId*, creditAccountId*, displayName*, brand*, maskedNumber*, lastFour*, expiryMonth*, expiryYear*, status*, updatedAt*, creditLimit*, availableCredit*, postedOutstanding*, pendingAuthorizations*, nextDueAt*, remainingAmountDue*, minimumPaymentRemaining*, sandbox* |
| `CreditCardResponse` | card* |
| `CardReportedLostResponse` | card*, caseId*, caseStatus* |
| `CreditCardDetailResponse` | card*, creditAccount*, latestStatement* |
| `CreditCardsResponse` | items* |
| `CreditAccount` | creditAccountId*, currency*, creditLimit*, postedOutstanding*, pendingAuthorizations*, availableCredit*, nextStatementAt*, status*, version*, updatedAt* |
| `CreditAccountsResponse` | items* |
| `CreditApplication` | applicationId*, requestedLimit*, approvedLimit*, status*, decisionReason*, creditAccountId*, createdAt*, updatedAt* |
| `CreditApplicationsResponse` | items* |
| `CreditApplicationRequest` | requestedLimit, stepUp* |
| `CreditTransaction` | transactionId*, creditAccountId*, statementId*, type*, status*, description*, merchantName*, amount*, debtEffect*, occurredAt*, postedAt* |
| `CreditTransactionsResponse` | items*, nextCursor* |
| `CreditPayment` | paymentId*, statementId*, sourceAccountId*, amount*, reference*, status*, failureReason*, createdAt*, updatedAt* |
| `CreditStatement` | statementId*, creditAccountId*, cycleStartAt*, cycleEndAt*, issuedAt*, dueAt*, openingBalance*, purchaseTotal*, refundTotal*, feeTotal*, interestTotal*, closingBalance*, remainingAmountDue*, minimumPaymentDue*, minimumPaymentRemaining*, paidAmount*, status*, version*, items*, payments* |
| `CreditStatementResponse` | statement* |
| `CreditStatementsResponse` | items*, nextCursor* |
| `CreditPaymentQuoteRequest` | sourceAccountId*, creditAccountId*, statementId*, paymentOption*, amount |
| `CreditPaymentQuote` | quoteId*, sourceAccountId*, sourceAccountMaskedNumber*, creditAccountId*, cardLastFour*, statementId*, statementVersion*, paymentOption*, amount*, fee*, outstandingBefore*, outstandingAfter*, minimumPaymentRemainingBefore*, minimumPaymentRemainingAfter*, terms*, expiresAt* |
| `CreditPaymentRequest` | quoteId*, stepUp* |
| `AssistantHelpRequest` | question* |
| `AssistantHelpResponse` | answer* |
| `FinancialAdviceRequest` | union FinancialAdviceSavingsRequest / FinancialAdviceBudgetRequest |
| `FinancialAdviceSavingsRequest` | schemaVersion*, kind*, currency*, monthlyIncomeMinor*, essentialExpensesMinor*, flexibleExpensesMinor*, monthlyDebtPaymentsMinor*, monthlyBufferMinor*, preference*, inputConfirmed*, goal* |
| `FinancialAdviceBudgetRequest` | schemaVersion*, kind*, currency*, monthlyIncomeMinor*, essentialExpensesMinor*, flexibleExpensesMinor*, monthlyDebtPaymentsMinor*, monthlyBufferMinor*, preference*, inputConfirmed*, monthlySavingsTargetMinor* |
| `FinancialAdviceResponse` | union FinancialAdviceSavingsResponse / FinancialAdviceBudgetResponse |
| `FinancialAdviceSavingsResponse` | schemaVersion*, kind*, currency*, source*, calculationVersion*, catalogVersion*, budgetStatus*, goalStatus*, metrics*, options*, preferredOptionId*, explanation*, assumptions*, warnings* |
| `FinancialAdviceBudgetResponse` | schemaVersion*, kind*, currency*, source*, calculationVersion*, catalogVersion*, budgetStatus*, savingsTargetStatus*, metrics*, options*, preferredOptionId*, explanation*, assumptions*, warnings* |
| `FinancialAdviceOption` | union option DTOs theo id |
| `FinancialAdviceMaintainPlanOption` | id*, title*, description*, changes* |
| `FinancialAdviceExtendDeadlineOption` | id*, title*, description*, changes* |
| `FinancialAdviceReduceFlexibleOption` | id*, title*, description*, changes* |
| `FinancialAdviceLowerGoalOption` | id*, title*, description*, changes* |
| `FinancialAdviceReviewOption` | id*, title*, description*, changes* |
| `FinancialAdviceMaintainBudgetOption` | id*, title*, description*, changes* |
| `FinancialAdviceAdjustSavingsOption` | id*, title*, description*, changes* |
| `FinancialAdviceFundedOption` | id*, title*, description*, changes* |
| `FinancialAdviceExplanation` | mode*, reasonIds*, paragraphs*, fallbackReason* |
| `FinancialAdviceWarning` | code*, message* |

### 9.4 Admin API — 63 operations

Nguồn route/permission: documents/api/admin.openapi.yaml và backend/src/admin/authorization/permissionRegistry.ts. Toàn bộ runtime handler: backend/src/admin/http/adminHttp.ts; staff auth/service: auth/staffAuthService.ts; typed action workflow: actions/actionEngine.ts + repositories/adminRepository.ts (các path này dưới backend/src/admin/).

Admin OpenAPI chưa mô tả đủ business request/response schemas. Bảng ghi shape đã đối chiếu cho các nhóm trọng yếu; các envelope/type chi tiết còn thiếu phải xem handler/DTO tương ứng, không coi “body không được khai báo trong Draft” là “runtime không có body”.

| Method + endpoint (thêm /api/v1 trước path) | Request/runtime boundary | Response | File xử lý |
| --- | --- | --- | --- |
| POST `/admin/auth/login` | email, password | OPERATIONS: 200 session cookies + staff/permissions; ADMIN: 202 {challengeId, expiresAt} | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/auth/mfa/verify` | challengeId, code | 200 {staff, csrfToken, expiresInSeconds} + HttpOnly cookies | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/auth/activate` | inviteToken, password, totpSecret (tên field; không đưa giá trị) | staffId, mfaSetup? (sensitive setup) | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/auth/step-up` | code | 204 | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/auth/refresh` | refresh cookie + CSRF theo runtime | csrfToken, expiresInSeconds + rotated cookies | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/auth/logout` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 204 | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/me` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | {staff, permissions} | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/me/sessions` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/staff` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/roles` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/permissions` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/staff/invite-requests` | typed action payload + Idempotency-Key; xem bảng allowlist dưới | 202/200 {action} theo handler | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/customers` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/customers/{customerId}/accounts` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/accounts/{accountId}` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/accounts/{accountId}/transactions` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/accounts/{accountId}/block-requests` | typed action payload + Idempotency-Key; xem bảng allowlist dưới | 202/200 {action} theo handler | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/accounts/{accountId}/unblock-requests` | typed action payload + Idempotency-Key; xem bảng allowlist dưới | 202/200 {action} theo handler | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/accounts/{accountId}/funding-requests` | typed action payload + Idempotency-Key; xem bảng allowlist dưới | 202/200 {action} theo handler | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/approvals` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/approvals/{requestId}` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/approvals/{requestId}/approve` | fingerprint, version, reasonCode, decision/comment theo runtime | {action, receipt} | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/approvals/{requestId}/reject` | fingerprint, version, reasonCode, comment | 202/200 {action} theo handler | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/approvals/{requestId}/cancel` | object rỗng/path ID theo runtime | 202/200 {action} theo handler | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/applications` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/transfers` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/fraud-cases` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/operations/outbox/summary` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/operations/outbox/events` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/audit-events` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| DELETE `/admin/me/sessions/{sessionId}` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 204 | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/staff/{staffId}` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/staff/{staffId}/role-change-requests` | typed action payload + Idempotency-Key; xem bảng allowlist dưới | 202/200 {action} theo handler | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/staff/{staffId}/disable-requests` | typed action payload + Idempotency-Key; xem bảng allowlist dưới | 202/200 {action} theo handler | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/customers/{customerId}` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/customers/{customerId}/access-lock-requests` | typed action payload + Idempotency-Key; xem bảng allowlist dưới | 202/200 {action} theo handler | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/customers/{customerId}/access-unlock-requests` | typed action payload + Idempotency-Key; xem bảng allowlist dưới | 202/200 {action} theo handler | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/accounts/{accountId}/funding-reversal-requests` | typed action payload + Idempotency-Key; xem bảng allowlist dưới | 202/200 {action} theo handler | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/kyc-applications/{applicationId}` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/kyc-applications/{applicationId}/claim` | object rỗng/path ID theo runtime | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/kyc-applications/{applicationId}/review-recommendations` | typed action payload + Idempotency-Key; xem bảng allowlist dưới | 202/200 {action} theo handler | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/credit-applications/{applicationId}` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/credit-applications/{applicationId}/claim` | object rỗng/path ID theo runtime | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/credit-applications/{applicationId}/review-recommendations` | typed action payload + Idempotency-Key; xem bảng allowlist dưới | 202/200 {action} theo handler | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/transfers/{transferId}` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/transfers/{transferId}/timeline` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/transfers/{transferId}/retry-requests` | typed action payload + Idempotency-Key; xem bảng allowlist dưới | 202/200 {action} theo handler | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/transfers/{transferId}/cancel-requests` | typed action payload + Idempotency-Key; xem bảng allowlist dưới | 202/200 {action} theo handler | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/transfers/{transferId}/reversal-requests` | typed action payload + Idempotency-Key; xem bảng allowlist dưới | 202/200 {action} theo handler | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/fraud-cases/{reportId}` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/fraud-cases/{reportId}/claim` | object rỗng/path ID theo runtime | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/fraud-cases/{reportId}/notes` | note | 201 {status: RECORDED} | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/fraud-cases/{reportId}/action-requests` | typed action payload + Idempotency-Key; xem bảng allowlist dưới | 202/200 {action} theo handler | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/fraud-cases/{reportId}/resolution-requests` | typed action payload + Idempotency-Key; xem bảng allowlist dưới | 202/200 {action} theo handler | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/operations/outbox/events/{eventId}` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/operations/outbox/dead-letters` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/operations/outbox/events/{eventId}/requeue-requests` | typed action payload + Idempotency-Key; xem bảng allowlist dưới | 202/200 {action} theo handler | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/operations/jobs` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/operations/jobs/{jobId}` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/operations/jobs/{jobId}/retry-requests` | typed action payload + Idempotency-Key; xem bảng allowlist dưới | 202/200 {action} theo handler | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/audit-events/{eventId}` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | 200; envelope items/resource/summary theo runtime | `backend/src/admin/http/adminHttp.ts` |
| POST `/admin/audit-export-requests` | typed action payload + Idempotency-Key; xem bảng allowlist dưới | 202/200 {action} theo handler | `backend/src/admin/http/adminHttp.ts` |
| GET `/admin/audit-exports/{exportId}` | path/query/cookie theo operation; Draft chưa có body schema đầy đủ | {status: REFERENCE_EXPORT_PENDING, items?} | `backend/src/admin/http/adminHttp.ts` |

Typed action allowlist trong actionEngine:

| Action family | Fields ngoài base reasonCode, ticketReference, description |
| --- | --- |
| Funding / reversal | amountMinor, currency / sourceTransactionId |
| KYC decision | decision |
| Credit decision | decision, approvedLimitMinor |
| Transfer operation | operation |
| Fraud action/resolution | operation, resolutionCode |
| Role change | roleCode, operation, environmentScope |
| Staff invite | email, employeeCode, displayName, role |
| Account/customer control, requeue/job retry, staff disable | base fields; path định nghĩa target |

Allowlist không có nghĩa mọi field đều required cho mọi command. Engine kiểm idempotency/fingerprint/expected target version, expiry, permissions và maker≠checker; fresh step-up khi duyệt. Unknown action bị từ chối. SUPPORT không có mọi quyền unblock; ADMIN không phải universal superuser.

Health/readiness/metrics routes ngoài business OpenAPI cần đọc các HTTP/worker health module và container config. Chúng không được cộng vào 65/63 business operation counts.

### 9.5 PostgreSQL schema và quan hệ

Có 40 migration forward-only, 92 CREATE TABLE distinct. Đọc đủ migration không thấy DROP TABLE/RENAME TABLE/RENAME COLUMN/DROP COLUMN. apply-migration.cjs tạo thêm reference_schema_migrations: 93 bảng là schema kỳ vọng nếu toàn bộ apply thành công, không phải số đo live DB.

| Migration tạo bảng | Tên bảng |
| --- | --- |
| `backend/database/001_banking_mvp.sql` | `customers`, `customer_devices`, `auth_sessions`, `payment_accounts`, `beneficiaries`, `transfer_quotes`, `transfers`, `account_transactions`, `ledger_journals`, `ledger_entries`, `audit_events`, `outbox_events`, `reference_state_snapshots`, `notifications`, `fraud_reports`, `control_policy` |
| `backend/database/002_savings_sandbox.sql` | `savings_products`, `savings_quotes`, `savings_deposits`, `savings_openings` |
| `backend/database/003_credit_sandbox.sql` | `credit_accounts`, `credit_cards`, `credit_statements`, `credit_transactions`, `credit_statement_items`, `credit_payment_quotes`, `credit_payments` |
| `backend/database/005_relational_reference_runtime.sql` | `reference_runtime_records` |
| `backend/database/006_relational_v2_foundation.sql` | `command_idempotency` |
| `backend/database/007_identity_runtime_normalization.sql` | `refresh_session_families`, `refresh_session_records`, `auth_challenges`, `pending_registrations`, `rate_limit_buckets` |
| `backend/database/009_savings_relational_v2.sql` | `savings_idempotency`, `savings_maturity_operations` |
| `backend/database/010_credit_relational_v2.sql` | `credit_idempotency` |
| `backend/database/011_registration_recovery.sql` | `registration_completions` |
| `backend/database/012_outbox_worker.sql` | `notification_endpoints`, `notification_preferences`, `notification_deliveries`, `dead_letter_events`, `worker_instances` |
| `backend/database/014_mfa_credentials.sql` | `mfa_credentials` |
| `backend/database/016_mfa_recovery.sql` | `mfa_recovery_codes`, `mfa_recovery_requests` |
| `backend/database/017_auth_security_events.sql` | `auth_security_events` |
| `backend/database/019_admin_control_plane.sql` | `staff_users`, `staff_roles`, `staff_permissions`, `staff_role_permissions`, `staff_user_roles`, `staff_sessions`, `staff_mfa_credentials`, `staff_invites`, `staff_auth_challenges`, `admin_action_policies`, `admin_action_requests`, `admin_action_decisions`, `admin_action_execution_attempts`, `account_status_change_requests`, `customer_access_change_requests`, `simulation_funding_requests`, `application_decision_requests`, `transfer_operation_requests`, `fraud_resolution_requests`, `outbox_requeue_requests`, `job_retry_requests`, `staff_role_change_requests`, `account_status_history`, `customer_access_status_history`, `background_jobs`, `background_job_attempts`, `job_retry_history` |
| `backend/database/020_admin_case_operations.sql` | `kyc_applications`, `kyc_application_documents`, `kyc_reviews`, `credit_applications`, `case_assignments`, `case_internal_notes`, `fraud_case_actions` |
| `backend/database/021_admin_bootstrap_guard.sql` | `admin_bootstrap_state` |
| `backend/database/023_admin_roles_rls_and_domain_adapters.sql` | `staff_invite_requests`, `simulation_funding_reversals` |
| `backend/database/026_secret_envelope_metadata.sql` | `encryption_rekey_checkpoints` |
| `backend/database/028_dr_recovery_markers.sql` | `dr_recovery_markers` |
| `backend/database/031_remaining_relational_v2.sql` | `recipient_lookups`, `fraud_report_idempotency` |
| `backend/database/032_relational_scheduled_lifecycle.sql` | `credit_lifecycle_operations` |
| `backend/database/034_policy_entitlements_login_rate_limit.sql` | `customer_feature_entitlements` |
| `backend/database/039_lifecycle_suspense_and_keyset_indexes.sql` | `savings_maturity_suspense` |
| `backend/database/040_card_security_and_suspense_retry.sql` | `card_security_cases` |
| `backend/database/041_admin_two_roles.sql` | `staff_roles`, `admin_action_policies` |
| `backend/database/042_admin_direct_operations_accounts.sql` | `staff_users`, operations accounts direct bootstrap |
| `backend/database/043_retire_staff_invite_approval.sql` | retire `staff_invite_requests` maker-checker |

Bảng bookkeeping: reference_schema_migrations do backend/scripts/apply-migration.cjs tạo, lưu applied checksum và execution/release metadata.

Các quan hệ và constraint đáng đọc:

- Customer → devices, accounts, beneficiaries, registration/MFA/recovery/session families. V2 refresh_session_records.device_id là text, không phải FK customer_devices; legacy auth_sessions vẫn còn.
- Payment account → transactions; quote → transfer; transfer source/destination account → authoritative balances/ledger. Các cột tên *_id không tự chứng minh FK: beneficiary destination metadata, transfer transaction/journal IDs cần đọc DDL cụ thể.
- Ledger journal → entries; deferred triggers kiểm ít nhất hai entries và debit-credit cân bằng. Không suy ra generic DELETE immutability cho ledger. audit_events có trigger chống UPDATE/DELETE.
- Savings product → quote → opening ↔ deposit; deposit renewal self-reference; idempotency/maturity operation/suspense tracking riêng.
- Customer → credit application → account → card/statement/transactions; statement_items nối statements với transactions; repayments tham chiếu source payment account.
- Staff ↔ roles ↔ permissions; staff auth realm độc lập customer. Action → decisions/execution attempts/domain request tables/audit; service enforcement mới chặn maker self-approval, không chỉ FK.
- Outbox event → notification deliveries/endpoints/dead letters; ciphertext/key metadata cho endpoint, lease/backoff/dedup indexes cho workers.
- Case assignments/notes dùng polymorphic case_type + case_id; không có FK cho từng loại case.
- KYC synthetic payload full/private được lưu server, public chỉ identityNumberLast4; 038 chuẩn hóa NEEDS_MORE_INFO và vẫn có compatibility naming trong một số constraint.
- Legacy reference_state_snapshots/reference_runtime_records còn trong schema cạnh normalized tables. Không có bảng Financial Advice hoặc lưu AI advice trong 43 migration.

RLS enabled trên kyc_applications, credit_applications, case_assignments, case_internal_notes, admin_action_requests; dùng app.staff_id/app.staff_scope. Source không FORCE RLS; hiệu lực thực tế phụ thuộc DB role/owner/session binding, chưa xác minh database ở phiên này.

Money SQL là bigint minor, rate integer basis points, phần lớn time là timestamptz và version bigint. DB access:

~~~text
DatabasePool(pg)
→ UnitOfWork transaction / bounded transaction retry
→ database/repositories/* / PostgresAdminRepository
→ parameterized SQL + rowMappers
→ PostgreSQL
~~~

Migration runner chuẩn hóa line ending/checksum, BEGIN→advisory lock theo migration key→applied-checksum check→SQL/bookkeeping→COMMIT, failure ROLLBACK. Plan/verify-only vẫn kết nối DB, không phải offline command. Không sửa/chạy lại migration applied. Canonical migration set digest tại rà soát: 5ade9c37ce6502cf02bda6b9adfa546817e9f0d3482aec57ba8f63924292191d.

Giới hạn source guard: requiredTablesByMigration trong runner chưa có entry 031 dù migration đó tạo bảng. Đây là candidate kiểm tra, chưa có runtime failure proof; không sửa ở task này.



## 10. CONFIGURATION & DEPENDENCIES

### Package và công cụ

| Phạm vi | Manifest / công cụ | Tác dụng |
| --- | --- | --- |
| Backend | backend/package.json, Node.js 22 trong Docker/CI, TypeScript ESM, tsx | HTTP public/Admin/worker và scripts. Phụ thuộc runtime chính: pg, otpauth, nodemailer, @google-cloud/secret-manager. Không có ORM/framework HTTP. |
| Mobile | mobile-app/package.json, Expo SDK 57, React 19, React Native 0.86, Expo Router | App iOS/Android và Expo Web dùng chung source. SecureStore/Crypto/LocalAuthentication/Camera hỗ trợ session, thiết bị, MFA/QR; Jest/jest-expo và ESLint cho kiểm tra. |
| Admin Web | admin-web/package.json, React 19, Vite 7, TypeScript | SPA vận hành nhân viên; build static để Nginx phục vụ. |
| Database | backend/database/*.sql, pg | 43 migration PostgreSQL forward-only; không có ORM. |
| Local packaging | compose.yaml, Dockerfiles, Nginx config | Preview local gồm PostgreSQL, API, Admin API/Web và capture services; worker opt-in. Không có model inference trong Compose. |
| API contract | documents/api/*.yaml | Public (63 ops) / Admin (58 ops) OpenAPI ở trạng thái Draft; implementation + runtime validator vẫn cần đối chiếu khi lệch nhau. |

Lockfiles nằm cạnh từng app manifest. Dùng phiên bản Node tương ứng với CI/container (22) và cài dependency riêng trong backend, mobile-app, admin-web; root không có một workspace package manager điều phối cả ba.

### Cấu hình quan trọng

Chỉ ghi tên và ý nghĩa biến, không ghi bất kỳ giá trị bí mật nào. Giá trị runtime phải đặt trong file local bị ignore/secret store phù hợp, không đưa vào context, issue hay log.

| Nhóm | Tên cấu hình | Ý nghĩa / điều kiện |
| --- | --- | --- |
| Backend runtime | NODE_ENV, BANKING_ENV, BANKING_MONEY_MODE, BANKING_STORAGE, BANKING_PERSISTENCE_MODE | Chọn môi trường, bắt buộc virtual money cho reference runtime, persistence postgres/in-memory và legacy-state/relational-v2. Defaults nguồn cho thấy postgres + legacy-state; Compose/example có thể override. |
| Database | DATABASE_URL, DATABASE_TEST_ADMIN_URL, ALLOW_DATABASE_TEST_RESET | Kết nối PostgreSQL và guard cho test disposable. Không dùng banking_preview, remote DB hoặc database chưa xác minh ownership cho test/destructive action. |
| Crypto/auth | REGISTRATION_FINGERPRINT_KEY, pepper/encryption-key metadata, BANKING_MFA_METHODS | Runtime persistent fail-closed nếu thiếu/không hợp lệ. Chỉ mô tả tên tại đây; secret thật không được ghi hoặc in ra. |
| Assistant Help | ASSISTANT_ENABLED, ASSISTANT_PROVIDER, ASSISTANT_MODEL, ASSISTANT_PROVIDER_TIMEOUT_MS, ASSISTANT_REQUEST_TIMEOUT_MS | ASSISTANT_ENABLED khác 1 làm endpoint Help disabled. Provider interface hỗ trợ Radox hoặc loopback; model phải được validate; request timeout phải lớn hơn provider timeout. Default model là gemini-3.6-flash qua Radox provider. |
| Financial Advice | FINANCIAL_ADVICE_ENABLED cùng nhóm ASSISTANT_* | Feature route và AI selector là hai công tắc riêng. Rule-based calculator/fallback có thể hoạt động mà không có LLM; muốn selector AI phải cấu hình Assistant provider hợp lệ. |
| Mobile | EXPO_PUBLIC_API_URL, EXPO_PUBLIC_SANDBOX_HTTP | URL Backend của app. HTTP sandbox chỉ dành cho local; staging/production-like phải HTTPS và fail-closed nếu bật sandbox flag. Android emulator dùng host alias 10.0.2.2; khi Expo Web chạy trên máy local, API resolver đổi alias đó thành localhost. |
| Operational policy | BANKING_ALLOWED_ORIGINS, BANKING_ALLOWLIST_ENABLED, BANKING_MAX_TRANSFER_AMOUNT_MINOR, settlement flags | CORS allowlist, sandbox allowlist/limit và thời điểm settlement; chỉ thay đổi theo cấu hình môi trường được duyệt. |

### Các script nên biết

- Backend: npm run dev, npm run start, npm run start:persistent, npm run admin:dev, npm run worker:dev.
- Backend kiểm tra/contract: npm run validate:database, npm run typecheck, npm run build, npm test, npm run test:critical, npm run validate:openapi, npm run test:assistant.
- Backend database suites gọi script guard với PostgreSQL disposable; không chạy chỉ để “thử nhanh” khi DATABASE_URL đang trỏ tới dữ liệu persistent.
- Mobile: npm start, npm run android, npm run ios, npm run web, npm run lint, npm run typecheck, npm test, npm run validate:openapi, npm run export:web. E2E đã bị gỡ ngày 2026-10-11.
- Admin Web hiện tại: npm run dev, npm run lint, npm run typecheck, npm test, npm run build, npm run audit. E2E đã bị gỡ ngày 2026-10-11.
- Compose smoke, migrations, seeding, worker/performance/release scripts có thể kết nối hoặc ghi dữ liệu; phải đọc script guard/runbook và xác minh disposable scope trước khi chạy.

## 11. FEATURE MAP

Feature map dưới đây trỏ tới đường đi chính. Các route wrapper Expo thường chỉ kết nối screen với router; business logic ở feature module và Backend.

| Feature | Mobile UI / entry | Client API / validation | Backend xử lý chính | Persistence |
| --- | --- | --- | --- | --- |
| Đăng ký / đăng nhập / session | mobile-app/src/app/(auth)/login.tsx, register.tsx, recover.tsx; mobile-app/src/app/_layout.tsx | mobile-app/src/features/auth/**, services/api/httpClient.ts | backend/src/http.ts, bankingSystem.ts; relational path qua database/relationalHttpBoundary.ts và auth/registration services | auth/customer/device/session repositories; migration SQL |
| Home / accounts / transaction history | mobile-app/src/app/(tabs)/index.tsx và account/history route wrappers | mobile-app/src/features/home, accounts, history | customer routes trong backend/src/http.ts; typed relational account/transaction services | accountRepository.ts, ledgerRepository.ts và transaction tables |
| Transfer / beneficiary / recipient lookup | mobile-app/src/app/transfer.tsx, beneficiaries route; features/transfers | feature API + transfer intent/state machines + shared httpClient | transfer/beneficiary/recipient handlers → transferService.ts / beneficiaryService.ts / recipient service | transferRepository.ts, idempotency/quote/ledger/audit/outbox tables |
| Savings | mobile-app/src/app/savings/**; features/savings | Savings API, calculators/validators | savings routes → savings service/calculation | savingsRepository.ts, deposit/product tables |
| Card / credit / repayment | mobile-app/src/app/(tabs)/cards.tsx, cards/credit route wrappers; features/cards, credit | card/credit APIs and validators | card controls + credit statement/repayment services | creditRepository.ts, card/credit tables |
| KYC | mobile-app/src/app/kyc.tsx; features/kyc | KYC API + payload validation | customer KYC boundary và Admin review routes | KYC case/review tables; only synthetic provider boundary |
| QR / notifications | mobile-app/src/app/(tabs)/qr.tsx and route wrappers; features/qr, notifications | feature APIs + QR payload/runtime validators | matching customer endpoints in http.ts / RelationalHttpBoundary | notifications/outbox, audit tables; QR does not itself transfer; (Fraud report đã gỡ) |
| Trợ lý hướng dẫn | mobile-app/src/app/assistant.tsx → features/assistant/screens/AssistantScreen.tsx | features/assistant/api/assistantApi.ts → POST /api/v1/assistant/help | backend/src/http.ts: handleAssistantHelpRoute → assistant/helpService.ts, responseCatalog/knowledgeLoader, controlled selection; optionally Radox provider | No banking transaction/account persistence; provider call separately configured |
| Tư vấn tài chính | mobile-app/src/app/financial-advice.tsx → features/financial-advice/screens/FinancialAdviceScreen.tsx | features/financial-advice/api/financialAdviceApi.ts + runtime validators | POST /api/v1/assistant/financial-advice → financialAdvice/adviceService.ts, calculations.ts, options/selectionPolicy/selectorValidation | No banking account/transaction writes; advice uses user-entered values |
| Admin authentication / customer controls | admin-web/src/main.tsx → App.tsx, router.ts, context/StaffContext.tsx | admin-web/src/api.ts; same-origin cookie + CSRF | backend/src/adminServer.ts, adminHttp.ts, auth/authorization/action workflows | admin repositories, staff/customer tables, audit/action records |
| Admin KYC / credit / transfer / staff / audit / operations | admin-web/src/features/{applications,approvals,transfers,customers,staff,audit,operations} | Admin API request/response types and permission registry | backend/src/admin/* services/routes/repositories | PostgreSQL Admin/control-plane tables, audit and outbox |
| Background outbox / lifecycle | Không có customer UI trực tiếp | Worker process, ops visibility | backend/src/worker.ts → workers/outbox + lifecycle scheduler | outbox, worker lease, dead-letter, scheduled lifecycle tables |

Tên thư mục biểu diễn module, không khẳng định mỗi feature đã có đầy đủ mọi hành vi trong mọi persistence mode. Public API contract / route table đầy đủ nằm ở mục 9.

## 12. CURRENT PROJECT STATUS

### Trạng thái đọc từ repository snapshot

- HEAD tại thời điểm cập nhật: codex/staging-academic-completion / a5bf4a69cef4e9f4e3b4c0a8931ce8d93bd168c3. Worktree đã có thay đổi tracked và untracked; đây là trạng thái WIP, không phải nội dung commit HEAD.
- Customer Mobile, Public Backend, Admin Web, worker, SQL migrations, tests/evaluators, contracts và handoff docs đều có source. “Có source/test/document” không chứng minh tính năng được bật hoặc đã chạy ở environment.
- Banking runtime được mô tả là academic/reference, virtual money, synthetic fixtures/adapters. Không có evidence đủ để gọi là hệ thống production, payment/core/KYC partner integration hoặc pilot đã phê duyệt.
- Trợ lý hướng dẫn có Mobile route + authenticated API + service/catalog/knowledge bundle và Radox provider. Runtime config trả disabled nếu ASSISTANT_ENABLED khác 1; Backend trả 503 cho route khi disabled. /healthz 200 chỉ chứng minh Backend health endpoint trả lời, không chứng minh Help enabled, provider/model sống hoặc Web đang trỏ đúng API.
- Financial Advice source có hai mode: SAVINGS_PLAN và BUDGET_BALANCE; số học là deterministic/rule-based, selector AI chỉ chọn một option whitelisted rồi validate. Không ghi giao dịch hay tự động thực thi khuyến nghị. Reports trong documents/06-security-ai ghi lại offline và live batch evidence; snapshot đó báo live 15/16 (Savings 8/8; Budget 7/8, có ORACLE_MISMATCH), trong khi acceptance threshold/live-preference gate còn UNRESOLVED/PROVISIONAL. Web demo và provider evaluation là bằng chứng khác loại. Một lần người dùng xác nhận kết quả nhìn hợp lý không thay thế regression/oracle/evidence gate.
- Tài liệu root và archive có trạng thái/tuyên bố từ các mốc khác nhau. README/handoff/evidence phải đọc ngày, commit, mode và loại test trước khi coi số liệu là hiện hành.
- OpenAPI Public/Admin được đánh dấu Draft; có các route/shape phải đọc implementation/runtime validator để xác định chính xác. Auth compatibility verifier, Admin operation coverage, policy/worker cutover và migration/runtime modes không thể suy ra chỉ từ OpenAPI.
- Database: có 43 forward migrations và schemas/repositories, nhưng lần lập context này không kết nối database hoặc kiểm tra migration trên DB; số bảng nêu ở mục 9 là inventory tĩnh từ DDL, không phải trạng thái live.
- Các script backup/restore local đã được gỡ ngày 2026-10-13; hiện không có backup/PITR implementation hoặc provider evidence. Cũng chưa có bằng chứng trong task này về Android/iOS device end-to-end, staging deployment, image digest release, live operational monitoring, core/payment partner, hoặc compliance/legal approval.
- Scan marker trong source Backend/Mobile/Admin không tìm thấy TODO/FIXME/HACK/XXX ở các khu vực đã quét. Đây chỉ là kết quả tìm marker; việc không có tag không có nghĩa không còn việc phải làm.

### Việc dở / rủi ro cấu trúc cần người nhận ra trước

1. Runtime/persistence: default backend là Postgres + legacy-state; Compose example có thể chọn relational-v2. Đây là khác biệt quan trọng và có thể làm test/demo kết nối một database khác với điều người chạy nghĩ.
2. Assistant availability: Assistant Help và Financial Advice là hai endpoint/flag; cấu hình model/provider không đồng nghĩa có provider process/model đã tải. Khi Ollama chết/không truy cập được, UI có thể báo provider/timeout.
3. Mobile authentication/platform: Mobile customer login source hiện password-only; một số tài liệu/Maestro cũ có thể nhắc login challenge/MFA UI chưa có. Biometric prompt local không phải server attestation proof; getDeviceBoundAssertion fail-closed/empty. Native durable intent không được chứng minh bằng Web.
4. Provider boundaries: KYC, card/core, notifications/email/push adapters phần lớn synthetic/fake/disabled. QR payload không phải lệnh thanh toán.
5. Admin: SPA/admin API có flows thực nhưng registry/route/page/OpenAPI/docs có thể lệch nhau; permission coverage phải xác minh ở route + service, không suy từ menu.
6. Release/operations: tài liệu backup, DR, staging, performance và preview là contract/plan; backup scripts đã được gỡ và tài liệu rehearsal cũ là bằng chứng lịch sử. Không tự hiểu là cloud được provision, monitoring connected, worker đã bật hoặc restore đã được diễn tập trong môi trường đại diện.
7. Repository hygiene: New folder.zip hiện có trong workspace nhưng là binary archive, không trích xuất/đưa vào source index. Không có thư mục New folder/ đã giải nén tại snapshot; chỉ dùng canonical root.
8. Unused candidates (static-reference heuristic, không phải quyết định xóa): Mobile cardsMock/cardValidators, TransferStateMachine/SavingsOpeningStateMachine, feature barrel/types index có vẻ chỉ được test hoặc không có consumer trực tiếp; Backend snapshotRepository chủ yếu test/reference; một số Admin table/inline DTO không được UI gọi. Import động, tooling và public exports có thể làm kết luận khác, nên người nhận phải kiểm tra trước khi xóa.
9. Database safety: destructive/integration suites chỉ trên database disposable được guard xác nhận; không reset/drop/truncate banking_preview, remote hoặc database chưa xác minh ownership.

## 13. HOW TO RUN

Các bước dưới đây là hướng dẫn source/documentation, không được chạy trong lúc tạo file này. Mặc định đây là local sandbox với virtual money. Không đưa credential vào Git/chat; thay bằng giá trị local do chủ dự án quản lý.

### Prerequisites

- Windows/macOS/Linux có Node.js 22 + npm; Docker Desktop/Compose nếu muốn chạy toàn stack.
- PostgreSQL 16 cho persistent preview nếu không dùng Compose. Ollama local + model được source cho phép chỉ cần khi muốn gọi model AI.
- Android Studio/emulator cho Android; Xcode/macOS cho iOS. Expo Web chạy bằng Node/browser.
- Không sử dụng production/personal database; BANKING_STORAGE=postgres hoặc Compose gắn persistent volume sẽ giữ dữ liệu qua lần dừng app.

### A. Local stack bằng Compose (persistent database)

1. Tạo private local file từ .env.compose.example thành .env.compose; điền cấu hình/secret local theo README, không commit hoặc dán giá trị vào tài liệu.
2. Chạy tại repository root:

~~~powershell
docker compose --env-file .env.compose up -d --build
docker compose --env-file .env.compose exec backend node scripts/container-smoke.cjs
~~~

3. Mobile/Admin cùng gọi stack. Khi dừng, docker compose --env-file .env.compose stop; down giữ volume trừ khi dùng tùy chọn xóa volume. Không dùng tùy chọn đó trừ khi cố ý xóa dữ liệu disposable đã xác minh.
4. Cấu hình Compose và .env.compose có persistent PostgreSQL; đây không phải cách chạy “không chạm database”.

### B. Chạy Backend persistent trực tiếp

~~~powershell
cd backend
npm install
# Chuẩn bị backend/.env ở local theo backend/README.md; không đưa secret vào Git.
npm run start:persistent
~~~

start:persistent chạy migration trước rồi khởi động server. Yêu cầu PostgreSQL local đã được xác minh, DATABASE_URL trỏ đúng database được phép dùng, REGISTRATION_FINGERPRINT_KEY và các key/MFA runtime hợp lệ. Chỉ làm điều này khi được phép dùng database đó; không trỏ vào banking_preview. npm run start cũng mặc định là persistent theo runtime config, đừng cho rằng gọi nó sẽ dùng in-memory.

### C. Admin API + Admin Web

~~~powershell
cd backend
npm install
npm run admin:dev
~~~

Ở terminal khác:

~~~powershell
cd admin-web
npm install
npm run dev
~~~

Admin API là tiến trình riêng; Admin Web dev server proxy tới API theo Vite config. Staff session/cookie không dùng customer token. Đọc Admin README và cấu hình local trước khi tạo staff/user fixture.

### D. Mobile

~~~powershell
cd mobile-app
npm install
$env:EXPO_PUBLIC_API_URL = "http://10.0.2.2:5000/api/v1"
npm run android
~~~

URL trên dành cho Android emulator gọi host. Với thiết bị thật cần URL LAN có thể truy cập; với browser/Web cần host loopback phù hợp. Expo Web:

~~~powershell
npm run web
~~~

iOS yêu cầu macOS/Xcode:

~~~powershell
npm run ios
~~~

HTTP local chỉ dùng khi cấu hình EXPO_PUBLIC_SANDBOX_HTTP=1 theo mobile-app/README.md. Cờ này không được đưa vào build staging/production-like.

### E. Bật Trợ lý hướng dẫn / model AI

- Kiểm tra trước Backend đang đọc đúng private .env (hoặc .env.compose), API URL client trỏ tới process đó, và API key Radox AI đã được cấu hình.
- Trong private Backend environment hoặc .env.compose, bật ASSISTANT_ENABLED=1; đặt ASSISTANT_PROVIDER=radox, ASSISTANT_MODEL=gemini-3.6-flash, và ASSISTANT_RADOX_BASE_URL=https://radoxai.com/v1 cùng ASSISTANT_RADOX_API_KEY. Timeout request phải lớn hơn provider timeout.
- Restart đúng Backend process sau đổi env; quan sát health/log đã redact. Không gửi password, session token, OTP hoặc dữ liệu tài chính thật.
- Nếu bật AI trong container, đảm bảo container backend nhận được các biến cấu hình từ .env.compose.
- Khi flag tắt, POST /api/v1/assistant/help trả ASSISTANT_UNAVAILABLE/503; khi service enabled nhưng provider không phản hồi, UI hiển thị lỗi provider hoặc timeout. Xem mục “Assistant availability” mục 12.

### F. Tư vấn tài chính

- FINANCIAL_ADVICE_ENABLED điều khiển route riêng; feature route và ASSISTANT_ENABLED/provider có cấu hình riêng.
- Chạy mode offline/rule-based theo documents/06-security-ai/financial-advice-demo-runbook.md khi cần chứng minh phép tính không gọi provider. Chạy live chỉ theo quota/guard/runbook đã duyệt; provider call tính quota và có thể không retry-safe.
- Dùng dữ liệu synthetic do runbook quy định. Không suy “Qwen trả lời” nếu báo cáo ghi RULE_BASED, providerCalls=0 hoặc offline.
- Hướng dẫn này ghi các command tham chiếu, không tuyên bố các dịch vụ hoặc database đang chạy từ lượt tạo context.

## 14. RECOMMENDED READING ORDER

1. AGENTS.md — phạm vi, bảo vệ WIP, database safety, security và các quality gates.
2. README.md — trạng thái bàn giao, prerequisite, Compose và phân biệt local preview với release. Đọc ngày/chốt source snapshot.
3. documents/02-design/architecture-and-scope.md và documents/02-design/function-scope.md — mục tiêu và boundaries; đối chiếu với source vì tài liệu có thể cũ.
4. backend/package.json và backend/src/server.ts — lệnh/runtime entry public backend, storage/config selection.
5. backend/src/runtimeConfig.ts và backend/src/http.ts — fail-closed environment, auth/validation, API dispatcher/error handling.
6. backend/src/bankingSystem.ts, backend/src/coreBanking.ts, backend/src/ledger.ts — in-memory/reference domain facade, money and ledger invariants.
7. backend/src/database/relationalHttpBoundary.ts, database/unitOfWork.ts, database/repositories/ — persistent path, transaction scope and repository boundary.
8. backend/database/README.md rồi 001–043 migration theo thứ tự — schema evolution; không chạy migration để “đọc” schema.
9. Mobile entry: mobile-app/index.ts, mobile-app/src/app/_layout.tsx, src/app/(tabs)/_layout.tsx — Expo bootstrap, providers, route tree.
10. mobile-app/src/features/auth/ và mobile-app/src/services/api/httpClient.ts — customer session/token, request headers/retry/URL config.
11. Đọc một flow UI ít rủi ro: mobile-app/src/features/accounts hoặc history; theo screen → API → Backend route → service → repository → tests.
12. Đọc money flow: transfers/beneficiaries + backend transferService.ts/repositories + idempotency, step-up, journal and outbox tests.
13. Đọc savings/credit và lifecycle worker; so sánh scheduling/settlement flags với process worker riêng.
14. Đọc assistant-help: AssistantScreen.tsx → assistantApi.ts → http.ts:handleAssistantHelpRoute → runtimeAssistantConfig.ts → helpService/knowledgeLoader/responseCatalog/selectionPolicy → Radox provider và assistant tests.
15. Đọc Financial Advice: FinancialAdviceScreen.tsx → financialAdviceApi.ts/validators → financialAdvice route/config/adviceService.ts → calculations.ts → selectionPolicy/selectorValidation → test plan/evidence/runbook/reports. Phân biệt offline, RULE_BASED và live-Qwen evidence.
16. Admin Web: admin-web/src/main.tsx, App.tsx, router.ts, context/StaffContext.tsx → một page/action → backend adminHttp/auth/authorization/action service → repository/audit tests.
17. Cuối cùng đọc OpenAPI + test harness + staging/release/backup/security docs; xác nhận environment, commit, flags và loại bằng chứng trước khi nhận một mệnh đề PASS.
18. Dùng mục 15 để lần tới module/file; file trong New folder/ là workspace mirror candidate, ưu tiên path canonical ngoài thư mục đó.


## 15. COMPLETE SOURCE FILE INDEX

Phạm vi index là đường dẫn tương đối của source code, test, evaluator/script, SQL migration và file build/config/contract dạng văn bản tại snapshot. Không liệt kê dependency, .git, build/dist/target/cache, binary, generated declaration/type output hoặc raw/private environment files. Source JavaScript do dự án viết (app config/tooling) vẫn được giữ; generated JS/map/declaration artifacts bị loại. Tên file cấu hình được liệt kê, không có giá trị cấu hình hay secret nào.

- Canonical source tree: 609 file.
- Không có extracted secondary source tree New folder/ tại snapshot. Archive New folder.zip là binary và bị loại.
- Textual configuration, contracts, workflow and asset-source files: 134 paths.

### 15.1 Canonical source (root project)

~~~text
.github/modernize/java-upgrade/hooks/scripts/recordToolUse.ps1
.github/modernize/java-upgrade/hooks/scripts/recordToolUse.sh
admin-web/docker-entrypoint.d/10-validate-runtime-config.sh
admin-web/scripts/verify-runtime-proxy.cjs
admin-web/src/api.ts
admin-web/src/App.tsx
admin-web/src/components/common/DataTable.tsx
admin-web/src/components/common/Heading.tsx
admin-web/src/components/common/Modal.tsx
admin-web/src/components/common/Notice.tsx
admin-web/src/components/common/StatusBadge.tsx
admin-web/src/components/layout/AppLayout.tsx
admin-web/src/context/logoutCoordinator.ts
admin-web/src/context/StaffContext.tsx
admin-web/src/features/applications/Applications.tsx
admin-web/src/features/approvals/Approvals.tsx
admin-web/src/features/approvals/approvalsLogic.ts
admin-web/src/features/audit/AuditView.tsx
admin-web/src/features/auth/Activation.tsx
admin-web/src/features/auth/Login.tsx
admin-web/src/features/customers/accountLoader.ts
admin-web/src/features/customers/actionIntent.ts
admin-web/src/features/customers/Customers.tsx
admin-web/src/features/operations/Operations.tsx
admin-web/src/features/overview/Overview.tsx
admin-web/src/features/staff/StaffView.tsx
admin-web/src/features/transfers/Transfers.tsx
admin-web/src/main.tsx
admin-web/src/router.ts
admin-web/src/types.ts
admin-web/test/admin-web.contract.test.cjs
admin-web/test/admin-web.ui-logic.test.cjs
admin-web/vite.config.ts
backend/database/001_banking_mvp.sql
backend/database/002_savings_sandbox.sql
backend/database/003_credit_sandbox.sql
backend/database/004_credit_unlock_policy.sql
backend/database/005_relational_reference_runtime.sql
backend/database/006_relational_v2_foundation.sql
backend/database/007_identity_runtime_normalization.sql
backend/database/008_transfer_relational_v2.sql
backend/database/009_savings_relational_v2.sql
backend/database/010_credit_relational_v2.sql
backend/database/011_registration_recovery.sql
backend/database/012_outbox_worker.sql
backend/database/013_outbox_worker_operations.sql
backend/database/014_mfa_credentials.sql
backend/database/015_auth_challenge_hardening.sql
backend/database/016_mfa_recovery.sql
backend/database/017_auth_security_events.sql
backend/database/018_mfa_challenge_constraints.sql
backend/database/019_admin_control_plane.sql
backend/database/020_admin_case_operations.sql
backend/database/021_admin_bootstrap_guard.sql
backend/database/022_admin_policy_alignment.sql
backend/database/023_admin_roles_rls_and_domain_adapters.sql
backend/database/024_admin_staff_invite_workflow.sql
backend/database/025_admin_case_scope_alignment.sql
backend/database/026_secret_envelope_metadata.sql
backend/database/027_secret_rotation_inventory.sql
backend/database/028_dr_recovery_markers.sql
backend/database/029_savings_products_relational_v2.sql
backend/database/030_credit_relational_v2_cutover.sql
backend/database/031_remaining_relational_v2.sql
backend/database/032_relational_scheduled_lifecycle.sql
backend/database/033_control_policy_bootstrap.sql
backend/database/034_policy_entitlements_login_rate_limit.sql
backend/database/035_credit_cycle_start.sql
backend/database/036_beneficiary_lifecycle.sql
backend/database/037_transfer_counterparty_snapshots.sql
backend/database/038_customer_kyc_runtime.sql
backend/database/039_lifecycle_suspense_and_keyset_indexes.sql
backend/database/040_card_security_and_suspense_retry.sql
backend/database/041_admin_two_roles.sql
backend/database/042_admin_direct_operations_accounts.sql
backend/database/043_retire_staff_invite_approval.sql
backend/scripts/admin-bootstrap.ts
backend/scripts/admin-invitation-capture.cjs
backend/scripts/aggregate-financial-advice-evaluation.ts
backend/scripts/apply-migration.cjs
backend/scripts/bundle-assistant-knowledge.ts
backend/scripts/container-smoke.cjs
backend/scripts/create-release-manifest.cjs
backend/scripts/demo-financial-advice-isolated.ts
backend/scripts/evaluate-assistant-controlled.ts
backend/scripts/evaluate-assistant-intent.ts
backend/scripts/evaluate-assistant-radox.ts
backend/scripts/evaluate-assistant.ts
backend/scripts/evaluate-financial-advice.ts
backend/scripts/migration-content.cjs
backend/scripts/migration-fingerprint.cjs
backend/scripts/outbox-inspect.cjs
backend/scripts/outbox-inventory.cjs
backend/scripts/p0-inventory.cjs
backend/scripts/postgres-ssl.cjs
backend/scripts/reencrypt-ciphertexts.ts
backend/scripts/release-gate.cjs
backend/scripts/reset-sandbox.ts
backend/scripts/run-core-tests.cjs
backend/scripts/run-disposable-postgres-test.ts
backend/scripts/run-worker-load-test.cjs
backend/scripts/snapshot-assistant-runtime.ts
backend/scripts/test-release.cjs
backend/scripts/validate-admin-authz.ts
backend/scripts/validate-admin-openapi.cjs
backend/scripts/validate-admin-schema.cjs
backend/scripts/validate-container-release-workflow.cjs
backend/scripts/validate-database-schema.cjs
backend/scripts/validate-image-surface.cjs
backend/scripts/validate-openapi.cjs
backend/scripts/validate-outbox-worker.cjs
backend/scripts/validate-relational-v2.cjs
backend/scripts/validate-secret-registry.cjs
backend/scripts/validate-secret-surface.cjs
backend/scripts/verify-buildkit-attestations.cjs
backend/scripts/verify-release-manifest.cjs
backend/src/admin/actions/actionEngine.ts
backend/src/admin/audit/redaction.ts
backend/src/admin/auth/adminBootstrapService.ts
backend/src/admin/auth/adminInvitationProvider.ts
backend/src/admin/auth/staffAuthService.ts
backend/src/admin/authorization/authorization.ts
backend/src/admin/authorization/permissionRegistry.ts
backend/src/admin/http/adminHttp.ts
backend/src/admin/repositories/adminRepository.ts
backend/src/adminServer.ts
backend/src/assistant/helpConfig.ts
backend/src/assistant/helpProvider.ts
backend/src/assistant/helpService.ts
backend/src/assistant/index.ts
backend/src/assistant/knowledgeBundle.ts
backend/src/assistant/knowledgeLoader.ts
backend/src/assistant/knowledgeSync.ts
backend/src/assistant/radoxHelpProvider.ts
backend/src/assistant/rateLimiter.ts
backend/src/assistant/responseCatalog.ts
backend/src/assistant/runtimeAssistantConfig.ts
backend/src/assistant/selectionPolicy.ts
backend/src/assistant/sensitiveDataFilter.ts
backend/src/assistant/streamReader.ts
backend/src/bankingSystem.ts
backend/src/coreBanking.ts
backend/src/credit.ts
backend/src/secrets/GoogleSecretManagerClient.ts
backend/src/serverBind.ts
backend/src/database/commandErrors.ts
backend/src/database/controlPolicyRepository.ts
backend/src/database/creditService.ts
backend/src/database/disposableDatabaseGuard.ts
backend/src/database/index.ts
backend/src/database/kycService.ts
backend/src/database/lifecycleService.ts
backend/src/database/pool.ts
backend/src/database/postgresErrors.ts
backend/src/database/registrationService.ts
backend/src/database/relationalAccountReadService.ts
backend/src/database/relationalAuthService.ts
backend/src/database/relationalBeneficiaryService.ts
backend/src/database/relationalHttpBoundary.ts
backend/src/database/remainingService.ts
backend/src/database/repositories/accountRepository.ts
backend/src/database/repositories/auditRepository.ts
backend/src/database/repositories/creditRepository.ts
backend/src/database/repositories/customerRepository.ts
backend/src/database/repositories/index.ts
backend/src/database/repositories/ledgerRepository.ts
backend/src/database/repositories/mfaRepository.ts
backend/src/database/repositories/outboxRepository.ts
backend/src/database/repositories/savingsRepository.ts
backend/src/database/repositories/transferRepository.ts
backend/src/database/rowMappers.ts
backend/src/database/savingsService.ts
backend/src/database/transactionRetry.ts
backend/src/database/transferService.ts
backend/src/database/unitOfWork.ts
backend/src/errors.ts
backend/src/financialAdvice/adviceConfig.ts
backend/src/financialAdvice/adviceService.ts
backend/src/financialAdvice/advisorPrompt.ts
backend/src/financialAdvice/calculations.ts
backend/src/financialAdvice/explanationCatalog.ts
backend/src/financialAdvice/index.ts
backend/src/financialAdvice/isolatedDemoConfig.ts
backend/src/financialAdvice/options.ts
backend/src/financialAdvice/selectionPolicy.ts
backend/src/financialAdvice/selectorValidation.ts
backend/src/financialAdvice/streamReader.ts
backend/src/financialAdvice/types.ts
backend/src/financialAdvice/validation.ts
backend/src/http.ts
backend/src/ledger.ts
backend/src/mfa/crypto.ts
backend/src/mfa/delivery.ts
backend/src/mfa/httpEmailProvider.ts
backend/src/mfa/metrics.ts
backend/src/mfa/persistentMfaService.ts
backend/src/mfa/runtimeEmailProvider.ts
backend/src/mfa/smtpEmailProvider.ts
backend/src/money.ts
backend/src/notifications/endpointCrypto.ts
backend/src/notifications/index.ts
backend/src/notifications/providers/provider.ts
backend/src/notifications/templateRegistry.ts
backend/src/observability/logger.ts
backend/src/observability/metrics.ts
backend/src/observability/requestContext.ts
backend/src/outbox/errorClassifier.ts
backend/src/outbox/eventRegistry.ts
backend/src/outbox/index.ts
backend/src/outbox/postgresOutboxRepository.ts
backend/src/outbox/retryPolicy.ts
backend/src/outbox/types.ts
backend/src/postgresRelationalRepository.ts
backend/src/postgresSnapshotRepository.ts
backend/src/runtimeConfig.ts
backend/src/runtimeMetadata.ts
backend/src/savings.ts
backend/src/secrets/LocalDevelopmentSecretProvider.ts
backend/src/secrets/ManagedSecretProvider.ts
backend/src/secrets/MountedSecretClient.ts
backend/src/secrets/runtimeSecrets.ts
backend/src/secrets/secretCache.ts
backend/src/secrets/SecretProvider.ts
backend/src/secrets/secretSchema.ts
backend/src/security.ts
backend/src/server.ts
backend/src/tests/admin.concurrency.test.ts
backend/src/tests/admin.database.test.ts
backend/src/tests/adminAuth.test.ts
backend/src/tests/adminAuthorization.test.ts
backend/src/tests/adminBootstrap.test.ts
backend/src/tests/adminWorkflow.test.ts
backend/src/tests/assistantControlledSelection.test.ts
backend/src/tests/assistantDistArtifact.test.ts
backend/src/tests/assistantEvaluation.test.ts
backend/src/tests/assistantEvaluation/controlledDataset.ts
backend/src/tests/assistantEvaluation/controlledRunner.ts
backend/src/tests/assistantEvaluation/dataset.ts
backend/src/tests/assistantEvaluation/fixtures.ts
backend/src/tests/assistantEvaluation/index.ts
backend/src/tests/assistantEvaluation/intentDisambiguationDataset.ts
backend/src/tests/assistantEvaluation/intentJournal.ts
backend/src/tests/assistantEvaluation/intentRunner.ts
backend/src/tests/assistantEvaluation/ollamaRunner.ts
backend/src/tests/assistantEvaluation/pos23BudgetTracker.ts
backend/src/tests/assistantEvaluation/pos23DisambiguationDataset.ts
backend/src/tests/assistantEvaluation/pos23Faq06Faq13Dataset.ts
backend/src/tests/assistantEvaluation/pos24DisambiguationDataset.ts
backend/src/tests/assistantEvaluation/pos24Orchestrator.ts
backend/src/tests/assistantEvaluation/pos24Workspace.ts
backend/src/tests/assistantEvaluation/runner.ts
backend/src/tests/assistantEvaluation/scorer.ts
backend/src/tests/assistantEvaluation/snapshotManager.ts
backend/src/tests/assistantEvaluation/types.ts
backend/src/tests/assistantHelp.test.ts
backend/src/tests/assistantHelpHttp.test.ts
backend/src/tests/assistantHelpRelational.database.test.ts
backend/src/tests/assistantOllamaEvaluation.test.ts
backend/src/tests/authContract.test.ts
backend/src/tests/authRelational.test.ts
backend/src/tests/bankingSystem.test.ts
backend/src/tests/credit-http.test.ts
backend/src/tests/credit.test.ts
backend/src/tests/creditRelational.test.ts
backend/src/tests/databaseFoundation.test.ts
backend/src/tests/databaseTls.test.ts
backend/src/tests/disposableDatabaseGuard.test.ts
backend/src/tests/disposableMigrationRuntime.test.ts
backend/src/tests/encryptionEnvelope.test.ts
backend/src/tests/evaluatorHardening.test.ts
backend/src/tests/financialAdviceCalculation.test.ts
backend/src/tests/financialAdviceContract.test.ts
backend/src/tests/financialAdviceCrossContract.test.ts
backend/src/tests/financialAdviceEvaluation.test.ts
backend/src/tests/financialAdviceEvaluation/dataset.ts
backend/src/tests/financialAdviceEvaluation/reporting.ts
backend/src/tests/financialAdviceEvaluation/runner.ts
backend/src/tests/financialAdviceHttp.test.ts
backend/src/tests/financialAdviceIsolatedDemo.test.ts
backend/src/tests/financialAdviceService.test.ts
backend/src/tests/http-security-persistence.test.ts
backend/src/tests/http.test.ts
backend/src/tests/integratedDisposable.test.ts
backend/src/tests/intentDisambiguation.test.ts
backend/src/tests/kycContract.test.ts
backend/src/tests/kycRelational.test.ts
backend/src/tests/ledger.test.ts
backend/src/tests/lifecycleRelational.test.ts
backend/src/tests/lifecycleScheduler.test.ts
backend/src/tests/mfaCrypto.test.ts
backend/src/tests/mfaPersistence.test.ts
backend/src/tests/migrationFingerprint.test.ts
backend/src/tests/miniCoreSandbox.test.ts
backend/src/tests/observability.test.ts
backend/src/tests/ollamaAssistantHelpProvider.test.ts
backend/src/tests/outboxUnit.test.ts
backend/src/tests/persistence.test.ts
backend/src/tests/pos24OfflinePreparation.test.ts
backend/src/tests/registrationContract.test.ts
backend/src/tests/registrationRelational.test.ts
backend/src/tests/relationalHttpBoundary.test.ts
backend/src/tests/relationalHttpCutover.test.ts
backend/src/tests/relationalPersistence.test.ts
backend/src/tests/releaseManifestVerifier.test.ts
backend/src/tests/remainingRelational.test.ts
backend/src/tests/runtimeConfig.test.ts
backend/src/tests/runtimeEmailProvider.test.ts
backend/src/tests/savings-http.test.ts
backend/src/tests/savings.test.ts
backend/src/tests/savingsRelational.test.ts
backend/src/tests/secretProvider.test.ts
backend/src/tests/security.test.ts
backend/src/tests/smtpEmailProvider.test.ts
backend/src/tests/workerOutbox.test.ts
backend/src/types.ts
backend/src/worker.ts
backend/src/workers/index.ts
backend/src/workers/lifecycleScheduler.ts
backend/src/workers/workerHealth.ts
backend/src/workers/workerRuntime.ts
documents/06-security-ai/prompt-archive/candidate-1-knowledgeBundle-v0.5.ts
documents/06-security-ai/prompt-archive/candidate-2-knowledgeBundle-v0.6.ts
documents/06-security-ai/prompt-archive/candidate-3-knowledgeBundle-v0.7.ts
documents/06-security-ai/prompt-archive/initial-baseline-knowledgeBundle-v0.4.ts
mobile-app/android/app/build.gradle
mobile-app/android/app/src/main/java/com/example/digitalbanking/mobile/MainActivity.kt
mobile-app/android/app/src/main/java/com/example/digitalbanking/mobile/MainApplication.kt
mobile-app/android/build.gradle
mobile-app/android/gradlew.bat
mobile-app/android/settings.gradle
mobile-app/app.config.js
mobile-app/eslint.config.js
mobile-app/example/scripts/reset-project.js
mobile-app/example/src/app/_layout.tsx
mobile-app/example/src/app/explore.tsx
mobile-app/example/src/app/index.tsx
mobile-app/example/src/components/animated-icon.tsx
mobile-app/example/src/components/animated-icon.web.tsx
mobile-app/example/src/components/app-tabs.tsx
mobile-app/example/src/components/app-tabs.web.tsx
mobile-app/example/src/components/external-link.tsx
mobile-app/example/src/components/hint-row.tsx
mobile-app/example/src/components/themed-text.tsx
mobile-app/example/src/components/themed-view.tsx
mobile-app/example/src/components/ui/collapsible.tsx
mobile-app/example/src/components/web-badge.tsx
mobile-app/example/src/constants/theme.ts
mobile-app/example/src/hooks/use-color-scheme.ts
mobile-app/example/src/hooks/use-color-scheme.web.ts
mobile-app/example/src/hooks/use-theme.ts
mobile-app/index.ts
mobile-app/jest.config.js
mobile-app/scripts/android-bundle-proxy.cjs
mobile-app/scripts/create-release-checksum.cjs
mobile-app/scripts/device-preflight.cjs
mobile-app/scripts/generate-router-types.cjs
mobile-app/scripts/validate-openapi.cjs
mobile-app/scripts/validate-public-env.cjs
mobile-app/scripts/validate-release.cjs
mobile-app/src/app/_layout.tsx
mobile-app/src/app/(auth)/_layout.tsx
mobile-app/src/app/(auth)/login.tsx
mobile-app/src/app/(auth)/recover.tsx
mobile-app/src/app/(auth)/register.tsx
mobile-app/src/app/(tabs)/_layout.tsx
mobile-app/src/app/(tabs)/cards.tsx
mobile-app/src/app/(tabs)/index.tsx
mobile-app/src/app/(tabs)/profile.tsx
mobile-app/src/app/(tabs)/qr.tsx
mobile-app/src/app/account/[accountId].tsx
mobile-app/src/app/assistant.tsx
mobile-app/src/app/beneficiaries.tsx
mobile-app/src/app/cards.tsx
mobile-app/src/app/cards/[cardId].tsx
mobile-app/src/app/cards/[cardId]/pay.tsx
mobile-app/src/app/cards/[cardId]/payments/[paymentId].tsx
mobile-app/src/app/cards/[cardId]/statements.tsx
mobile-app/src/app/cards/[cardId]/statements/[statementId].tsx
mobile-app/src/app/cards/[cardId]/transactions.tsx
mobile-app/src/app/cards/apply.tsx
mobile-app/src/app/financial-advice.tsx
mobile-app/src/app/history.tsx
mobile-app/src/app/kyc.tsx
mobile-app/src/app/mfa.tsx
mobile-app/src/app/notifications.tsx
mobile-app/src/app/notifications/[notificationId].tsx
mobile-app/src/app/qr.tsx
mobile-app/src/app/savings/[depositId].tsx
mobile-app/src/app/savings/index.tsx
mobile-app/src/app/savings/open.tsx
mobile-app/src/app/transaction/[transactionId].tsx
mobile-app/src/app/transfer.tsx
mobile-app/src/components/brand/BrandMark.tsx
mobile-app/src/components/ui/__tests__/requestErrorPresentation.test.ts
mobile-app/src/components/ui/AppHeader.tsx
mobile-app/src/components/ui/AppIcon.tsx
mobile-app/src/components/ui/Button.tsx
mobile-app/src/components/ui/Card.tsx
mobile-app/src/components/ui/EnvironmentBadge.tsx
mobile-app/src/components/ui/IconButton.tsx
mobile-app/src/components/ui/ListRow.tsx
mobile-app/src/components/ui/PrimaryButton.tsx
mobile-app/src/components/ui/RequestErrorNotice.tsx
mobile-app/src/components/ui/requestErrorPresentation.ts
mobile-app/src/components/ui/Screen.tsx
mobile-app/src/components/ui/SectionHeader.tsx
mobile-app/src/components/ui/StateCard.tsx
mobile-app/src/components/ui/StatusBadge.tsx
mobile-app/src/components/ui/TextField.tsx
mobile-app/src/features/accounts/presentation/__tests__/accountPresentation.test.ts
mobile-app/src/features/accounts/presentation/accountPresentation.ts
mobile-app/src/features/accounts/screens/AccountDetailScreen.tsx
mobile-app/src/features/accounts/services/accountsApi.ts
mobile-app/src/features/accounts/types/account.ts
mobile-app/src/features/accounts/validation/__tests__/accountResponseValidators.test.ts
mobile-app/src/features/accounts/validation/accountResponseValidators.ts
mobile-app/src/features/assistant/api/__tests__/assistantApi.test.ts
mobile-app/src/features/assistant/api/assistantApi.ts
mobile-app/src/features/assistant/screens/__tests__/AssistantReauthentication.integration.test.tsx
mobile-app/src/features/assistant/screens/__tests__/AssistantScreen.test.tsx
mobile-app/src/features/assistant/screens/AssistantScreen.tsx
mobile-app/src/features/assistant/types/assistant.ts
mobile-app/src/features/auth/context/__tests__/AuthContext.test.tsx
mobile-app/src/features/auth/context/AuthContext.tsx
mobile-app/src/features/auth/domain/__tests__/refreshFailure.test.ts
mobile-app/src/features/auth/domain/refreshFailure.ts
mobile-app/src/features/auth/screens/__tests__/LoginScreen.test.tsx
mobile-app/src/features/auth/screens/__tests__/MfaMethodsScreen.test.tsx
mobile-app/src/features/auth/screens/__tests__/MfaRecoveryScreen.test.tsx
mobile-app/src/features/auth/screens/__tests__/RegisterScreen.test.tsx
mobile-app/src/features/auth/screens/LoginScreen.tsx
mobile-app/src/features/auth/screens/MfaMethodsScreen.tsx
mobile-app/src/features/auth/screens/MfaRecoveryScreen.tsx
mobile-app/src/features/auth/screens/RegisterScreen.tsx
mobile-app/src/features/auth/services/__tests__/authApi.test.ts
mobile-app/src/features/auth/services/__tests__/authResponseValidators.test.ts
mobile-app/src/features/auth/services/authApi.ts
mobile-app/src/features/auth/services/authResponseValidators.ts
mobile-app/src/features/auth/services/otpApi.ts
mobile-app/src/features/auth/storage/__tests__/authSessionStorage.test.ts
mobile-app/src/features/auth/storage/__tests__/deviceBindingStorage.test.ts
mobile-app/src/features/auth/storage/__tests__/registrationSessionStorage.test.ts
mobile-app/src/features/auth/storage/authSessionStorage.ts
mobile-app/src/features/auth/storage/deviceBindingStorage.ts
mobile-app/src/features/auth/storage/registrationSessionStorage.ts
mobile-app/src/features/auth/types/__tests__/session.test.ts
mobile-app/src/features/auth/types/auth.ts
mobile-app/src/features/auth/types/session.ts
mobile-app/src/features/auth/validation/__tests__/authValidation.test.ts
mobile-app/src/features/auth/validation/authDataValidators.ts
mobile-app/src/features/auth/validation/authValidation.ts
mobile-app/src/features/banking/domain/__tests__/clientIntentLifecycle.test.ts
mobile-app/src/features/banking/domain/__tests__/submitFailure.test.ts
mobile-app/src/features/banking/domain/clientIntentLifecycle.ts
mobile-app/src/features/banking/domain/submitFailure.ts
mobile-app/src/features/banking/presentation/__tests__/formatMoney.test.ts
mobile-app/src/features/banking/presentation/formatMoney.ts
mobile-app/src/features/banking/services/__tests__/bankingApi.test.ts
mobile-app/src/features/banking/storage/__tests__/secureStoreScope.test.ts
mobile-app/src/features/banking/storage/intentRecovery.ts
mobile-app/src/features/banking/storage/secureStoreScope.ts
mobile-app/src/features/banking/types/money.ts
mobile-app/src/features/banking/validation/__tests__/idempotencyKey.test.ts
mobile-app/src/features/banking/validation/__tests__/moneyValidators.test.ts
mobile-app/src/features/banking/validation/idempotencyKey.ts
mobile-app/src/features/banking/validation/moneyValidators.ts
mobile-app/src/features/cards/screens/CardDetailScreen.tsx
mobile-app/src/features/cards/screens/CardsScreen.tsx
mobile-app/src/features/cards/services/__tests__/cardsMock.test.ts
mobile-app/src/features/cards/services/cardsMock.ts
mobile-app/src/features/cards/types/card.ts
mobile-app/src/features/cards/validation/__tests__/cardValidators.test.ts
mobile-app/src/features/cards/validation/cardValidators.ts
mobile-app/src/features/control/services/controlPolicyApi.ts
mobile-app/src/features/control/types/controlPolicy.ts
mobile-app/src/features/control/validation/__tests__/controlPolicyValidators.test.ts
mobile-app/src/features/control/validation/controlPolicyValidators.ts
mobile-app/src/features/credit/presentation/creditPresentation.ts
mobile-app/src/features/credit/screens/CreditApplicationScreen.tsx
mobile-app/src/features/credit/screens/CreditPaymentResultScreen.tsx
mobile-app/src/features/credit/screens/CreditPaymentScreen.tsx
mobile-app/src/features/credit/screens/CreditStatementDetailScreen.tsx
mobile-app/src/features/credit/screens/CreditStatementsScreen.tsx
mobile-app/src/features/credit/screens/CreditTransactionsScreen.tsx
mobile-app/src/features/credit/services/__tests__/creditApi.test.ts
mobile-app/src/features/credit/services/creditApi.ts
mobile-app/src/features/credit/storage/__tests__/cardPaymentIntentStorage.test.ts
mobile-app/src/features/credit/storage/cardPaymentIntentStorage.ts
mobile-app/src/features/credit/types/credit.ts
mobile-app/src/features/credit/validation/__tests__/creditResponseValidators.test.ts
mobile-app/src/features/credit/validation/creditResponseValidators.ts
mobile-app/src/features/financial-advice/__tests__/financialAdviceApi.test.ts
mobile-app/src/features/financial-advice/__tests__/FinancialAdviceReauthentication.integration.test.tsx
mobile-app/src/features/financial-advice/__tests__/FinancialAdviceScreen.test.tsx
mobile-app/src/features/financial-advice/__tests__/financialAdviceValidators.test.ts
mobile-app/src/features/financial-advice/api/financialAdviceApi.ts
mobile-app/src/features/financial-advice/index.ts
mobile-app/src/features/financial-advice/screens/FinancialAdviceScreen.tsx
mobile-app/src/features/financial-advice/types/financialAdvice.ts
mobile-app/src/features/financial-advice/validation/financialAdviceValidators.ts
mobile-app/src/features/history/presentation/__tests__/historyFilters.test.ts
mobile-app/src/features/history/presentation/historyFilters.ts
mobile-app/src/features/history/screens/HistoryScreen.tsx
mobile-app/src/features/history/screens/TransactionDetailScreen.tsx
mobile-app/src/features/home/components/BalanceCard.tsx
mobile-app/src/features/home/components/HomeHeader.tsx
mobile-app/src/features/home/components/QuickActionTile.tsx
mobile-app/src/features/home/presentation/__tests__/homePresentation.test.ts
mobile-app/src/features/home/presentation/homePresentation.ts
mobile-app/src/features/home/screens/__tests__/HomeScreenAssistantEntry.test.tsx
mobile-app/src/features/home/screens/HomeScreen.tsx
mobile-app/src/features/kyc/screens/__tests__/KycScreen.test.tsx
mobile-app/src/features/kyc/screens/KycScreen.tsx
mobile-app/src/features/kyc/services/__tests__/kycApi.test.ts
mobile-app/src/features/kyc/services/kycApi.ts
mobile-app/src/features/kyc/types/kyc.ts
mobile-app/src/features/kyc/validation/__tests__/kycResponseValidators.test.ts
mobile-app/src/features/kyc/validation/__tests__/kycValidators.test.ts
mobile-app/src/features/kyc/validation/kycResponseValidators.ts
mobile-app/src/features/kyc/validation/kycValidators.ts
mobile-app/src/features/notifications/navigation/__tests__/notificationRoute.test.ts
mobile-app/src/features/notifications/navigation/notificationRoute.ts
mobile-app/src/features/notifications/screens/NotificationDetailScreen.tsx
mobile-app/src/features/notifications/screens/NotificationsScreen.tsx
mobile-app/src/features/notifications/services/notificationsApi.ts
mobile-app/src/features/notifications/types/notification.ts
mobile-app/src/features/notifications/validation/__tests__/notificationValidators.test.ts
mobile-app/src/features/notifications/validation/notificationValidators.ts
mobile-app/src/features/profile/screens/ProfileScreen.tsx
mobile-app/src/features/qr/screens/QrScreen.tsx
mobile-app/src/features/qr/types/qr.ts
mobile-app/src/features/qr/validation/__tests__/qrPayload.test.ts
mobile-app/src/features/qr/validation/qrPayload.ts
mobile-app/src/features/savings/domain/__tests__/savingsOpeningStateMachine.test.ts
mobile-app/src/features/savings/domain/savingsOpeningStateMachine.ts
mobile-app/src/features/savings/presentation/__tests__/savingsPresentation.test.ts
mobile-app/src/features/savings/presentation/savingsPresentation.ts
mobile-app/src/features/savings/screens/OpenSavingsScreen.tsx
mobile-app/src/features/savings/screens/SavingsDetailScreen.tsx
mobile-app/src/features/savings/screens/SavingsListScreen.tsx
mobile-app/src/features/savings/services/savingsApi.ts
mobile-app/src/features/savings/storage/__tests__/savingsIntentStorage.test.ts
mobile-app/src/features/savings/storage/savingsIntentStorage.ts
mobile-app/src/features/savings/types/savings.ts
mobile-app/src/features/savings/validation/__tests__/savingsResponseValidators.test.ts
mobile-app/src/features/savings/validation/savingsResponseValidators.ts
mobile-app/src/features/transfers/components/TransferProgress.tsx
mobile-app/src/features/transfers/domain/__tests__/transferStateMachine.test.ts
mobile-app/src/features/transfers/domain/transferStateMachine.ts
mobile-app/src/features/transfers/screens/BeneficiariesScreen.tsx
mobile-app/src/features/transfers/screens/TransferScreen.tsx
mobile-app/src/features/transfers/services/transfersApi.ts
mobile-app/src/features/transfers/storage/__tests__/transferIntentStorage.test.ts
mobile-app/src/features/transfers/storage/transferIntentStorage.ts
mobile-app/src/features/transfers/types/transfer.ts
mobile-app/src/features/transfers/validation/__tests__/transferResponseValidators.test.ts
mobile-app/src/features/transfers/validation/transferResponseValidators.ts
mobile-app/src/runtime/nativeBootstrap.android.ts
mobile-app/src/runtime/nativeBootstrap.ts
mobile-app/src/services/api/__tests__/config.test.ts
mobile-app/src/services/api/__tests__/httpClient.test.ts
mobile-app/src/services/api/__tests__/responseValidators.test.ts
mobile-app/src/services/api/ApiError.ts
mobile-app/src/services/api/config.ts
mobile-app/src/services/api/httpClient.ts
mobile-app/src/services/api/responseValidators.ts
mobile-app/src/services/api/types.ts
mobile-app/src/services/mock/mockService.ts
mobile-app/src/services/security/__tests__/biometricAuth.test.ts
mobile-app/src/services/security/biometricAuth.ts
mobile-app/src/services/telemetry/__tests__/safeTelemetry.test.ts
mobile-app/src/services/telemetry/safeTelemetry.ts
mobile-app/src/theme/colors.ts
mobile-app/src/theme/index.ts
mobile-app/src/theme/radius.ts
mobile-app/src/theme/shadows.ts
mobile-app/src/theme/sizes.ts
mobile-app/src/theme/spacing.ts
mobile-app/src/theme/typography.ts
mobile-app/src/types/index.ts
performance/node/stage2-smoke.cjs
~~~

### 15.2 Text configuration, contracts and source assets

~~~text
.env.compose.example
.gitattributes
.github/modernize/java-upgrade/.gitignore
.github/workflows/admin-web-quality.yml
.github/workflows/backend-quality.yml
.github/workflows/container-release.yml
.github/workflows/mobile-app-quality.yml
.github/workflows/preview-container-smoke.yml
.gitignore
admin-web/.gitignore
admin-web/Dockerfile
admin-web/index.html
admin-web/nginx.conf.template
admin-web/package.json
admin-web/src/styles.css
admin-web/tsconfig.json
backend/.dockerignore
backend/.env.example
backend/Dockerfile
backend/package.json
backend/src/tests/assistantEvaluation/fixtures/pos24-reference-catalog.json
backend/src/tests/assistantEvaluation/fixtures/pos24-synthetic-candidate.json
backend/src/tests/assistantEvaluation/fixtures/pos24-synthetic-control.json
backend/src/tests/assistantEvaluation/fixtures/pos24-synthetic-error.json
backend/tsconfig.build.json
backend/tsconfig.json
compose.yaml
documents/05-testing/device-preflight-2026-08-17.json
documents/05-testing/device-preflight-2026-08-25.json
documents/05-testing/handoff-manifest-2026-08-17.json
documents/05-testing/health-preview-local.json
documents/05-testing/health-sandbox-2026-08-17.json
documents/05-testing/release-candidate/v1.0.0-thesis-rc.1/migration-fingerprint.json
documents/05-testing/release-candidate/v1.0.0-thesis-rc.1/source-gate.json
documents/05-testing/stage1-docker-health.json
documents/05-testing/stage2-baseline.json
documents/06-security-ai/assistant-controlled-evaluation-nova-controlled-20260923062727878-630a5c38-754b-4cd7-b197-651fa29706be.json
documents/06-security-ai/assistant-evaluation-ollama-baseline-report.json
documents/06-security-ai/assistant-evaluation-ollama-exp-baseline-pass1.json
documents/06-security-ai/assistant-evaluation-ollama-exp-baseline-pass2.json
documents/06-security-ai/assistant-evaluation-ollama-exp-c1-pass1.json
documents/06-security-ai/assistant-evaluation-ollama-exp-c1-pass2.json
documents/06-security-ai/assistant-evaluation-ollama-exp-c2-pass1.json
documents/06-security-ai/assistant-evaluation-ollama-exp-c2-pass2.json
documents/06-security-ai/assistant-evaluation-ollama-exp-c3-pass1.json
documents/06-security-ai/assistant-evaluation-ollama-exp-c3-pass2.json
documents/06-security-ai/assistant-evaluation-ollama-report.json
documents/06-security-ai/assistant-evaluation-ollama-trial-500-pass1.json
documents/06-security-ai/assistant-evaluation-ollama-trial-500-pass2.json
documents/06-security-ai/assistant-evaluation-ollama-trial-700-pass1.json
documents/06-security-ai/assistant-evaluation-report.json
documents/06-security-ai/assistant-intent-evaluation-nova-intent-baseline-dev-20260923090905832-6a3a63a7-3838-4ba8-8172-1d3f12766816.json
documents/06-security-ai/assistant-intent-evaluation-nova-intent-benchmark-20260923092138045-9974bf01-c9b5-4711-9acb-e1901e7fc1cb.json
documents/06-security-ai/assistant-intent-evaluation-nova-intent-holdout-20260923091847715-1d3e92ba-5c01-4662-abc2-b50e1c0bba28.json
documents/06-security-ai/assistant-intent-evaluation-nova-intent-planA-dev-20260923091124002-f0bd8e85-61f9-49e5-8250-4cdfcac2494a.json
documents/06-security-ai/assistant-intent-evaluation-nova-intent-planB-dev-20260923091343304-4b9eb3d5-0251-4ff8-ac9a-2c85f890428c.json
documents/06-security-ai/assistant-intent-evaluation-nova-intent-planB-dev-20260923091832178-f6642365-8033-4bc6-813e-3b467a373728.json
documents/06-security-ai/assistant-intent-evaluation-nova-intent-pos23-dev-20260923095227419-d3a7dc34-3e83-4b38-8235-2edc20d92b6c.json
documents/06-security-ai/assistant-intent-evaluation-nova-intent-pos23-exp-baseline-dev-20260923105204940-3574c7ed-fb02-4dab-ad7f-56671e907200.json
documents/06-security-ai/assistant-intent-evaluation-nova-intent-pos23-exp-benchmark-20260923105428157-51a0df5c-5354-415b-b133-f0de995a38ec.json
documents/06-security-ai/assistant-intent-evaluation-nova-intent-pos23-exp-candidate-dev-20260923105348283-0dd33e2d-279a-43da-8a48-4515fa9277b6.json
documents/06-security-ai/assistant-intent-evaluation-nova-intent-pos23-exp-holdout-20260923105414316-b696dde3-403f-41a3-80a6-ddb0ca07776a.json
documents/06-security-ai/financial-advice-acceptance-review-20261004.json
documents/06-security-ai/financial-advice-aggregate-20261003-164246440-3192cfdc-7167-4de8-9cf8-5e9011860ce3.json
documents/06-security-ai/financial-advice-run-live-budget-20261003-164205140-888e36b4-7ed5-4cdc-aef7-26816406efc7.json
documents/06-security-ai/financial-advice-run-live-savings-20261003-164113722-c0961ce5-79ce-432d-80f0-2240d7f04471.json
documents/06-security-ai/financial-advice-run-offline-all-20261003-091250701-fe62a8f1-11d3-4d03-9d16-3fcf018b03a7.json
documents/06-security-ai/financial-advice-run-offline-all-20261003-091522475-74ba1eb8-b20e-422e-8bf3-87a06df5a109.json
documents/06-security-ai/pos23-call-budget-tracker.json
documents/06-security-ai/prompt-archive/initial-baseline-report-reference.json
documents/06-security-ai/prompt-archive/pos23-baseline-snapshot.json
documents/06-security-ai/prompt-archive/pos23-candidate-1-snapshot.json
documents/07-release/release-manifest.schema.json
documents/07-release/release-manifest.template.json
documents/07-release/secret-registry.yaml
documents/api/admin.openapi.yaml
documents/api/banking-mvp.openapi.yaml
infrastructure/staging/provider-neutral/contract.yaml
mobile-app/.claude/settings.json
mobile-app/.env.example
mobile-app/.gitignore
mobile-app/.vscode/extensions.json
mobile-app/.vscode/settings.json
mobile-app/android/.gitignore
mobile-app/android/app/proguard-rules.pro
mobile-app/android/app/src/debug/AndroidManifest.xml
mobile-app/android/app/src/debugOptimized/AndroidManifest.xml
mobile-app/android/app/src/main/AndroidManifest.xml
mobile-app/android/app/src/main/res/drawable/ic_launcher_background.xml
mobile-app/android/app/src/main/res/drawable/rn_edit_text_material.xml
mobile-app/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml
mobile-app/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml
mobile-app/android/app/src/main/res/values-night/colors.xml
mobile-app/android/app/src/main/res/values/colors.xml
mobile-app/android/app/src/main/res/values/strings.xml
mobile-app/android/app/src/main/res/values/styles.xml
mobile-app/android/gradle.properties
mobile-app/android/gradle/wrapper/gradle-wrapper.properties
mobile-app/android/gradlew
mobile-app/app.json
mobile-app/assets/brand/nova-android-foreground.svg
mobile-app/assets/brand/nova-android-monochrome.svg
mobile-app/assets/brand/nova-app-icon.svg
mobile-app/assets/brand/nova-splash-mark.svg
mobile-app/assets/expo.icon/Assets/expo-symbol 2.svg
mobile-app/assets/expo.icon/icon.json
mobile-app/eas.json
mobile-app/example/src/components/animated-icon.module.css
mobile-app/example/src/global.css
mobile-app/package.json
mobile-app/tsconfig.json
observability/alerts/backup-rules.yml
observability/dashboards/backup-dr.json
~~~

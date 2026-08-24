# Backend hardening test report

> Cập nhật hiện hành 2026-08-24: Stage 1 worktree có 90 test definition, 84 pass và 6 PostgreSQL/relational skip khi Docker chưa chạy; critical API 8/8, static source contract 28 bảng đạt. Bằng chứng PostgreSQL 70/70 và relational 1/1 ngày 2026-08-17 vẫn là lịch sử.

Ngày kiểm tra: 2026-08-24
Phạm vi: correctness P1/P2, reference hardening và persistent sandbox adapter
Trạng thái: **In-memory và PostgreSQL persistent reference relational pass; production adapter toàn domain vẫn là DRAFT**
Commit backend gần nhất: `dd515ad` (`Make sandbox handoff reproducible`)

## Đã kiểm chứng local

| Gate | Kết quả |
| --- | --- |
| Typecheck/build | Đạt |
| Database boundary validator | Đạt static source contract: 28 bảng, cột UUID/transfer/notification/runtime và constraint chính; live DB bị bỏ qua vì không có `DATABASE_URL` |
| Unit + HTTP tests | Worktree không DB: 90 definition, 84 pass, 6 PostgreSQL skip; gồm body validation trước transaction, liveness độc lập DB và fail-closed khi DB unavailable |
| Relational persistence | `npm run test:relational`: 0 pass/1 skip trong lượt hiện tại vì Docker daemon không kết nối; historical 1/1 disposable database vẫn được giữ để truy vết |
| Critical HTTP tests | 8 đạt |
| Backend dependency audit | `npm audit --omit=dev --audit-level=high`: 0 vulnerability |
| Quote correctness | Snapshot beneficiary, one-time quote, idempotent retry |
| Beneficiary identity | Full account fingerprint + bank, không dùng masked suffix |
| Reconciliation | `differenceMinor = core - ledger` và test drift -1 |
| Runtime IDs | UUID-compatible với PostgreSQL |
| Router | Trailing segment bị 404 |
| Rate limit | Registration và transfer step-up có regression test |
| Outbox | Retry backoff/attempts, health threshold và cleanup event đã publish quá 24 giờ có regression test |
| M8 notification target | HTTP và domain test xác nhận `resourceId=transactionId`, `resourceAccountId=accountId`; Mobile route chỉ mở transaction khi đủ cả hai trường |

## PostgreSQL gate

Test `persistence.test.ts` dùng `DATABASE_URL`, chạy migration từ database rỗng, kiểm tra restart state, HTTP restart và concurrent submit bằng hai idempotency key khác nhau. Gate local đã chạy với PostgreSQL 16 trong Docker: migration từ database rỗng đạt, chạy lại migration không lỗi, live schema validation đạt, cả 70/70 test đạt và chỉ một request concurrent được debit. Workflow [`backend-quality.yml`](../../.github/workflows/backend-quality.yml) tái hiện cùng gate trên CI service.

`relationalPersistence.test.ts` chạy bằng `RELATIONAL_DATABASE_URL` trên database disposable riêng, kiểm tra cùng một quote khi hai request đến đồng thời, pending hold → settle, restart và reconciliation sau khi ghi vào bảng relational.

Persistent mode dùng `PostgresRelationalRepository` với advisory transaction lock. Core M0–M4/M8 ghi vào bảng relational; auth runtime và M6/M7 bonus dùng record-level JSONB. `reference_state_snapshots` chỉ là đường nâng dữ liệu cũ một lần; đây vẫn là sandbox-only.

## Còn thiếu

- Chưa có log của một CI run remote; clone sạch đã tái hiện static/reference gates, còn local PostgreSQL integration live không chạy được trong lượt này vì Docker daemon không kết nối.
- Logical backup/restore rehearsal đã đạt trên PostgreSQL database tạm; migration rollback thực tế vẫn chưa được triển khai vì schema reference chưa có chiến lược down migration.
- Core M0–M4/M8 đã wire vào các bảng relational reference tương ứng; auth runtime và M6/M7 vẫn lưu record-level JSONB, chưa phải repository production toàn domain.

## Cap nhat xac nhan cuoi M7 - 2026-08-15

- Credit test bao phu seed balance/minimum, quote one-time, payment ledger/reconciliation, pending resume, lock/unlock va HTTP idempotency flow.
- `npm test`: local không có database 70 test, 64 pass, 6 skip; với PostgreSQL 16 và cả hai biến database 70/70 pass, bao gồm restart/concurrency Credit, relational adapter và overdue notification idempotency.
- `npm run test:critical` 8/8; typecheck, build, OpenAPI validator va Backend dependency audit (0 vulnerability) dat.
- `003_credit_sandbox.sql` và `005_relational_reference_runtime.sql` đã migrate từ database rỗng; live validator kiểm tra 28 table definitions và constraints chính.
- `seed:e2e` da chay thanh cong voi MFA sandbox: transfer va savings `SUCCEEDED`, Credit card/statement seed thanh cong; khong in password/OTP.
- Persistent mode đã chuyển sang relational reference adapter cho core; repository production toàn domain và backup/restore rehearsal vẫn mở.

## Xác nhận hiện hành — 2026-08-17

- Clone sạch đã chạy `npm ci`; backend typecheck/build/OpenAPI đạt, migration từ database PostgreSQL rỗng đạt và test backend 70/70 đạt khi khai báo cả hai biến database.
- `reset:sandbox` đã được diễn tập trên database PostgreSQL tạm: guard từ chối target không đúng quy ước, target local hợp lệ được reset và bản ghi kiểm tra về 0; database tạm được xóa sau rehearsal.
- Persistent HTTP đọc/validate request body trước advisory lock và trả `503 PERSISTENCE_UNAVAILABLE` khi PostgreSQL không truy cập được.
- Backend source checkpoint: `dd515ad`; health fail-closed và request transaction boundary nằm trong lịch sử trước đó.
- Runtime mặc định hiện dùng `PostgresRelationalRepository`: core M0–M4/M8 được lưu trong bảng relational; auth runtime và M6/M7 bonus dùng `reference_runtime_records` theo từng record. Snapshot JSON chỉ còn đường nâng dữ liệu cũ một lần, không phải nguồn ghi mới.
- `npm run seed:e2e` đã chạy lại trên adapter relational sau restart backend: registration/MFA → Sandbox Funding → transfer `SUCCEEDED` → savings `SUCCEEDED` → credit application/activation; stdout không chứa password/OTP.
- Health JSON an toàn (không chứa credential/token/OTP) được lưu tại [`health-sandbox-2026-08-17.json`](health-sandbox-2026-08-17.json).

## Regression hardening nghiệp vụ — working tree 2026-08-24

### Đã chạy

| Gate | Kết quả |
| --- | --- |
| `npm ci` | Đạt; lockfile không đổi |
| Typecheck | Đạt |
| Build | Đạt |
| Full test không DB | 90 definition; 84 pass, 6 PostgreSQL skip, 0 fail |
| Persistent HTTP security boundary | 4/4 pass, không skip |
| Critical HTTP | 8/8 pass |
| OpenAPI contract/route | Đạt, 46 required paths và 51 exact method/segment guards |
| Static database source contract | Đạt, 28 table definitions/invariants; live DB chưa đạt trong môi trường hiện tại |
| Dependency audit | Đạt, 0 vulnerability |

Regression mới/chỉnh sửa kiểm tra:

- Refresh-token reuse trả `401` vẫn persist revoke family; token đã rotate tiếp tục bị từ chối sau restart.
- Năm login failure và OTP challenge attempt/lock vẫn tồn tại sau persistent-server restart.
- Domain rejection sau một business mutation giả lập rollback balance/history, trong khi chỉ whitelist security state được giữ.
- Pending registration export/migration không chứa plaintext password.
- Fraud report dùng idempotency fingerprint, retry trả cùng report, GET kiểm tra ownership/status và state export/import giữ report.
- Credit chỉ cho phép latest payable statement, chặn payment `PENDING` song song/overpay, giữ outstanding không âm và kiểm tra invariant trong reconciliation/health.
- Minimum payment đã đủ không còn tự chuyển statement thành `OVERDUE`.
- Savings opening và credit payment GET giữ nguyên exported state khi operation còn `PENDING`; scheduled-work command settle transfer/savings opening/credit payment trước maturity/statement và được kiểm tra chạy lặp lại không tạo thêm money movement/cycle đã xử lý.
- Savings maturity từ chối phantom/unbalanced liability, replay idempotent qua export/import và đưa savings liability vào reconciliation/health.
- Transaction/credit pagination dùng keyset; regression chèn record mới giữa hai lần đọc không tạo duplicate/skip.
- Static biometric proof bị từ chối mặc định và chỉ hoạt động khi local test bật unsafe switch tường minh.
- Financial step-up rejection dùng `409 STEP_UP_VERIFICATION_FAILED`, không kích hoạt refresh/replay từ `401`; canonical replay của quote đã consume không tạo ledger/audit/outbox mới và state thiếu trả `IDEMPOTENCY_STATE_MISSING`.
- Stage 0 secret scan và safety checkpoint hoàn tất; working tree được tách thành commit logic, không đưa `.env`/credential/build output vào Git.

## Triage lỗi CI — 2026-08-24

Ảnh PR đầu cho thấy 5 check fail: Backend `quality` (pull request), Mobile `backend-quality` (pull request/push) và Mobile `quality` (pull request/push). Log Backend có 5 lỗi PostgreSQL persistence/concurrency, nhưng cùng một nguyên nhân: hardening commit `0a9454c` đặt `allowUnsafeDirectSandboxStepUp` mặc định là `false`; các fixture persistence vẫn submit OTP trực tiếp thay vì bật compatibility switch test-only. Vì vậy step-up bị từ chối, giao dịch bị rollback và các assertion fulfilled/HTTP status thất bại.

Đã sửa cục bộ trong `backend/src/tests/persistence.test.ts` và `backend/src/tests/relationalPersistence.test.ts`: chỉ các fixture sandbox gọi submit trực tiếp bật `allowUnsafeDirectSandboxStepUp: true`; HTTP server production và mặc định runtime vẫn fail-closed, không thay đổi workflow CI.

Lượt CI tiếp theo còn hai assertion cũ trong `persistence.test.ts`: HTTP test chờ `409` và Credit test chờ một promise bị reject. Contract hiện hành quy định idempotency key mới sau khi quote đã consume phải alias operation canonical, nên cả hai request trả receipt/payment cùng ID. Đã cập nhật test để kiểm tra `200/200`, cùng `transferId` và hai kết quả fulfilled cùng `paymentId`; production behavior không đổi.

Kết quả local sau triage: typecheck, build, OpenAPI, static database contract, backend dependency audit (0 vulnerability), `npm test` không DB (84 pass, 6 PostgreSQL skip) và critical API (8/8) đạt. Mobile audit đã về 0 vulnerability sau `npm audit fix` không dùng `--force`, `@expo/metro@56.0.2` và Metro `0.84.5` override; web export/test gates vẫn đạt. Live PostgreSQL chưa thể chạy lại vì Docker daemon không kết nối được; Stage 1 có workflow container smoke để remote CI xác nhận.

### Data flow đã kiểm chứng ở mức reference

```text
HTTP request
  -> import transaction-start state
  -> success: commit all
  -> DomainError: merge security whitelist, rollback business aggregates
  -> unexpected error: rollback all
```

```text
fraud POST + Idempotency-Key
  -> ownership + fingerprint
  -> durable fraud_reports + idempotency metadata + audit/outbox
  -> 201 RECEIVED
  -> GET /fraud-reports/{reportId} chỉ đọc status thuộc user
```

### Gate còn mở

- Lần chạy live validator 2026-08-24 được chạy ở chế độ static với `DATABASE_URL` rỗng; static source contract đạt. Docker daemon không kết nối nên sáu PostgreSQL test và relational test bị skip; phải rerun migration, live validator, restart/concurrency và logical restore trước handoff mới.
- Chưa có dedicated live PostgreSQL regression cho fraud reason/idempotency qua restart và concurrent retry.
- Savings/Credit public GET đã read-only và có domain no-mutation regression; mutation được tách thành settlement/scheduled-work command reference. Dedicated HTTP/PostgreSQL no-mutation regression vẫn cần bổ sung. Durable worker/scheduler có lease/retry/backoff cho settlement, maturity, statement close/overdue chưa có; operator hook tuần tự không phải production settlement mechanism.
- Transaction boundary hiện là reference snapshot/relational adapter; chưa thay thế distributed rate-limit, Identity provider, core callback, queue, RLS, encryption/retention policy hoặc production monitoring.

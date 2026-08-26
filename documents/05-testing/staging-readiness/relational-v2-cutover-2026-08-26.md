# Relational-v2 customer cutover — local evidence 2026-08-26

## Kết luận

Đây là bằng chứng local/provider-neutral. Baseline trước đó bắt đầu từ
implementation commit `516083e0be71db7ee813c11bf7bfe82e5568830e`; các commit
evidence trước đó là `afc1305`, `c6eacea` và `b757b0a`. Lượt này bổ sung
registration persistent, migration `032`, scheduled Savings/Credit lifecycle và
release-quality rehearsal trên database disposable, đã được commit tại
`33f0e256cb1a23178064005052ba13c82c2d4ff7`. Evidence document ban đầu được
ghi nhận trong commit `ab863940aeb0ecd630fd2701f38c2160c87f20e0`, và bản
clarification cuối hiện ở commit `c1fc3e7`; hai SHA được giữ riêng để phân biệt
implementation với bằng chứng.
Follow-up runtime đã được commit tại `91ea325be5ab8b0145e58fee9543d1bd87b896df`:
API không còn dùng `NullEmailProvider` trên runtime mà dùng HTTP adapter có
timeout/retry, local capture allow-list, health redaction và staging fail-closed;
worker đã gắn `RelationalLifecycleScheduler` với startup catch-up, poll/batch,
row-lock `SKIP LOCKED`, idempotency, stall readiness và metrics. Rehearsal tích
hợp đã chạy trên database disposable với API, inbox HTTP capture, hai worker và
hai scheduler.
Trạng thái vẫn là:

```text
UNTRUSTED LOCAL PREVIEW
IMAGE_DIGEST=unknown
BANKING_PERSISTENCE_MODE=relational-v2
WORKER_ENABLED=0
WORKER_CUTOVER_CONFIRMED=0
```

Không có registry digest/signature/provenance, staging HTTPS, managed
PostgreSQL/Secret Manager, cloud worker hoặc device staging evidence trong
report này. Không được dùng report để gắn nhãn `STAGING VERIFIED` hay
`RELEASE CANDIDATE`.

## Thay đổi đã chốt

- `927ed19` — guard database disposable và negative test chống đụng preview.
- `a87303a` — persistent MFA lifecycle, one-time consume/retry/expiry/recovery.
- `c58eae8` — Savings quote → step-up → idempotency → debit/ledger/audit/outbox.
- `a155582` — Credit application/card/payment/lock và atomic payment boundary.
- `b69a552` — recipient lookup, notifications và fraud report relational.
- `516083e` — HTTP relational-v2 boundary fail-closed, startup completeness
  assertion và cấm fallback `withState` trong profile relational-v2.
- `032_relational_scheduled_lifecycle` — operation key durable cho Savings
  maturity/renewal và Credit statement/overdue/payment/reversal.
- Registration — HTTP provider boundary, hash-only OTP, outbox delivery intent
  và concurrent one-winner verification; local capture không ghi mã vào log,
  database hay outbox.
- Disposable release rehearsal — test runner hợp nhất; worker chỉ chạy trong
  database disposable, không thay đổi preview.
- `33f0e256cb1a23178064005052ba13c82c2d4ff7` — implementation commit chứa
  registration persistent, migration `032`, lifecycle service, disposable
  tests và unified release-quality runner.
- `91ea325be5ab8b0145e58fee9543d1bd87b896df` — runtime email provider,
  lifecycle scheduler, integrated disposable rehearsal và secret metadata.

Evidence preview trước đó ghi nhận migration `029`, `030`, `031` đã được áp
dụng idempotent vào `banking_preview`; lượt này không reset, drop hoặc migrate
preview. Disposable rehearsal đã áp dụng `001`–`032`; migration-set digest của
đầy đủ bộ hiện tại là
`4a50076d5ee5ce2ee1f72ace3816d49c5c8ea63a3454e544978d7815a9ce0b94`.

## Ma trận route

Các nhóm customer sau đi trực tiếp qua UnitOfWork PostgreSQL:

`auth`, `registration`, `mfa`, `accounts`, `beneficiaries`, `transfers`,
`savings`, `credit`, `recipients`, `notifications`, `fraud`.

Route không nằm trong boundary relational-v2 nhận `503 RELATIONAL_ROUTE_NOT_CUTOVER`
và không gọi `PostgresRelationalRepository.withState`. Startup fail-closed nếu
thiếu một route đại diện bắt buộc. Registration đã là RELATIONAL-V2 với HTTP
capture provider trong disposable; preview vẫn có thể giữ `EMAIL_PROVIDER=disabled`,
còn staging fail-closed nếu chưa có adapter HTTPS và credential từ Secret Manager.
Savings maturity/renewal và Credit settlement/overdue/reversal đã có service
relational-v2 và disposable evidence nhưng chưa tự chạy trên preview. Profile/KYC
customer vẫn explicit out-of-scope.

## Quality gate local

| Kiểm tra | Kết quả |
|---|---:|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm test` | 172 tests: 139 PASS, 0 FAIL, 33 SKIPPED |
| `npm run test:critical` | 10 PASS |
| `npm run test:database:guard` | 5 PASS |
| `npm run test:database` disposable | 4 PASS |
| `npm run test:relational` disposable | 1 PASS |
| `npm run test:mfa:persistence` disposable | 1 PASS |
| `npm run test:savings:persistence` disposable | 2 PASS |
| `npm run test:credit:persistence` disposable | 3 PASS |
| `npm run test:remaining:persistence` disposable | 2 PASS |
| `npm run test:registration:persistence` disposable | 1 PASS |
| `npm run test:lifecycle:persistence` disposable | 3 PASS |
| `npm run test:lifecycle:scheduler` disposable | 2 PASS |
| `npm run test:runtime-email` | 3 PASS |
| `npm run test:integrated:disposable` | 1 PASS |
| `npm run test:admin:database` disposable | 8 PASS |
| `npm run test:persistence` disposable regression | 11 PASS |
| `npm run test:worker` disposable rehearsal | 10 PASS |
| `npm run test:release` aggregate disposable gate | 17/17 commands PASS |
| `relationalHttpCutover.test.ts` | 5 PASS |
| `npm run release:gate` | FAIL có chủ đích: `code_review.md` vẫn deleted, 1 file dirty |
| `npm run validate:database` (baseline evidence) | 49 tables/constraints PASS; không re-run vì DB `.env` hiện không chạy |
| `npm run validate:relational-v2` (baseline evidence) | PASS; không re-run vì DB `.env` hiện không chạy |
| `npm run validate:outbox` (baseline evidence) | PASS; không re-run vì DB `.env` hiện không chạy |

Các kiểm tra client/admin/Compose dưới đây là evidence baseline trước commit
`33f0e25`; không bị thay đổi trong task này và không re-run khi DB `.env` đã tắt:

- Mobile lint, typecheck, unit: 46 suite / 259 test PASS; OpenAPI 43 path,
  Maestro 10 flow syntax và public-env scan 193 file PASS.
- Admin Web lint, test: 3/3 và build PASS.
- `docker compose --env-file .env.compose config --quiet` PASS; chỉ backend,
  migrate, PostgreSQL, Admin API/Web đang chạy. Không có worker đang chạy.

### Phân loại 33 SKIPPED trong aggregate `npm test`

Các skip này là do aggregate test không tự cấp `DATABASE_TEST_ADMIN_URL` để
tránh đụng database preview; các nhóm đã có lệnh disposable riêng và đều PASS:

- Admin PostgreSQL: 8.
- Credit relational: 3.
- Database foundation: 4.
- Persistent MFA: 1.
- Persistent snapshot/HTTP regression: 6.
- Relational adapter: 1.
- Recipient/notification/fraud relational: 2.
- Savings relational: 2.
- Registration relational: 1.
- Scheduled lifecycle: 3.
- Scheduler disposable database: 1 (cấu hình vẫn chạy PASS; DB cần runner disposable).
- Integrated disposable rehearsal: 1 (đã PASS khi chạy bằng `test:integrated:disposable`).

Worker test đã chạy 10/10 trên disposable với migration 001–032, gồm lease,
retry/backoff, dead-letter, restart, hai worker và load 1.000 event. Đây không
phải worker preview: `.env.compose` vẫn `WORKER_ENABLED=0` và
`WORKER_CUTOVER_CONFIRMED=0`. Rehearsal không claim hoặc thay đổi 12 legacy
pending events trong preview; chúng vẫn cần operator reconciliation khi có quyết
định cutover riêng.

## Compose smoke

Lượt này không khởi động lại hoặc migrate `banking_preview`; Compose preview vẫn
giữ `IMAGE_DIGEST=unknown`, worker tắt và migration schema preview theo evidence
trước đó. Route registration đã được đưa vào relational boundary; khi provider
email còn `disabled`, lỗi delivery được trả rõ ràng thay vì rơi về legacy writer.
Provider HTTP và scheduler runtime đã được rehearsal đầy đủ trên disposable;
không có scheduled command nào tự chạy trên `banking_preview`.

`code_review.md` vẫn được giữ ở trạng thái deleted theo worktree của người dùng;
không được restore hoặc đưa vào commit này.

## Việc còn mở trước release candidate

1. Chưa có staging evidence thật cho provider/lifecycle: cần HTTPS, managed
   Secret Manager, registry digest/signature/provenance và database staging
   sạch trước khi promote.
2. Không đặt `WORKER_CUTOVER_CONFIRMED=1` hoặc bật worker trên preview. Khi có
   cutover được phê duyệt mới gắn scheduler vào runtime staging và ghi backlog,
   lease, retry, dead-letter, restart, reconciliation.
3. Tạo staging thật với registry digest, signature/provenance, managed secrets,
   HTTPS, backup/rollback và device E2E; sau đó cập nhật evidence cùng commit.

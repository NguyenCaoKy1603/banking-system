# Relational-v2 customer cutover — local evidence 2026-08-26

## Kết luận

Đây là bằng chứng local/provider-neutral cho commit `516083e0be71db7ee813c11bf7bfe82e5568830e`.
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

Migration `029`, `030`, `031` đã được áp dụng idempotent vào `banking_preview`;
không reset hoặc xóa volume. Migration-set digest local là
`a55097bd3bd54e4dcdc4110eaebc111f2d817c1a2864cec3586a794c4f45f84f`.

## Ma trận route

Các nhóm customer sau đi trực tiếp qua UnitOfWork PostgreSQL:

`auth`, `mfa`, `accounts`, `beneficiaries`, `transfers`, `savings`, `credit`,
`recipients`, `notifications`, `fraud`.

Route không nằm trong boundary relational-v2 nhận `503 RELATIONAL_ROUTE_NOT_CUTOVER`
và không gọi `PostgresRelationalRepository.withState`. Startup fail-closed nếu
thiếu một route đại diện bắt buộc. Các nhóm vẫn explicit out-of-scope là
registration (chưa có email provider evidence), Savings maturity/renewal,
Credit settlement/overdue/reversal scheduler và profile/KYC customer.

## Quality gate local

| Kiểm tra | Kết quả |
|---|---:|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm test` | 161 tests: 134 PASS, 0 FAIL, 27 SKIPPED |
| `npm run test:critical` | 10 PASS |
| `npm run test:database:guard` | 5 PASS |
| `npm run test:database` disposable | 4 PASS |
| `npm run test:relational` disposable | 1 PASS |
| `npm run test:mfa:persistence` disposable | 1 PASS |
| `npm run test:savings:persistence` disposable | 2 PASS |
| `npm run test:credit:persistence` disposable | 3 PASS |
| `npm run test:remaining:persistence` disposable | 2 PASS |
| `npm run test:admin:database` disposable | 8 PASS |
| `npm run test:persistence` disposable regression | 11 PASS |
| `relationalHttpCutover.test.ts` | 5 PASS |
| `npm run validate:database` | 49 tables/constraints PASS |
| `npm run validate:relational-v2` | PASS; migration/checksum/invariant/orphan checks đều 0 |
| `npm run validate:outbox` | PASS; secret-like errors/orphan/invalid records 0 |

### Phân loại 27 SKIPPED trong aggregate `npm test`

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

Worker test/worker runtime không được bật trong phiên này theo quyết định phạm
vi; đó là gate tiếp theo, không phải một skip bị che giấu. Outbox validator hiện
ghi nhận 12 legacy pending events cần operator reconciliation; worker chưa claim
chúng.

## Compose smoke

Đã build lại `migrate` và `backend`, chạy migration idempotent, restart backend
không mất volume. `/healthz` và `/versionz` trả `200`, schema `031`,
`migrationSetDigest` đúng commit và `imageDigest=unknown`. Route registration
và route không được duyệt trả `503`, chứng minh không rơi về legacy writer.

`code_review.md` vẫn được giữ ở trạng thái deleted theo worktree của người dùng;
không được restore hoặc đưa vào commit này.

## Việc còn mở trước release candidate

1. Người dùng quyết định phạm vi/provider cho registration và các scheduled
   lifecycle out-of-scope.
2. Chỉ sau khi có quyết định đó mới chạy worker rehearsal/lease/retry/restart;
   không đặt `WORKER_CUTOVER_CONFIRMED=1` trong local hiện tại.
3. Tạo staging thật với registry digest, signature/provenance, managed secrets,
   HTTPS, backup/rollback và device E2E; sau đó cập nhật evidence cùng commit.

# Báo cáo CodeGraph — Banking System

## 1. Mục đích

Tài liệu này tổng hợp cách CodeGraph đã lập chỉ mục và truy vết mã nguồn cho dự án Banking System. Báo cáo dành cho việc review kiến trúc, xác định đường gọi giữa các module và ước lượng phạm vi ảnh hưởng trước khi sửa code.

CodeGraph là công cụ phân tích tĩnh. Nó không chạy nghiệp vụ ngân hàng, không kết nối database, không tạo container và không tự sửa source code.

## 2. Trạng thái index

- Repository: C:/Projects/banking-system.
- Ngày lập báo cáo: 2026-09-05 (Asia/Bangkok).
- Lệnh khởi tạo: codegraph init.
- Kết quả khởi tạo: thành công.
- File đã index: 443.
- Số node: 8.300.
- Số edge: 26.920.
- Index được tạo trong thư mục .codegraph.
- CodeGraph có thể link dynamic dispatch và trả source hiện tại kèm số dòng.

### Git tại thời điểm lập báo cáo

- Branch: codex/staging-academic-completion.
- HEAD: 0037cb96971e8f6223867852f27df66c9d36f8b7.
- Task M01-07 đã modified từ trước.
- .codegraph/.gitignore là file untracked được tạo khi khởi tạo index.
- Không có source nghiệp vụ nào bị CodeGraph sửa.
- Báo cáo này được tạo để bàn giao; chưa stage và chưa commit.

## 3. Các truy vấn đã thực hiện

~~~text
runCliMain dispatchCliRun runCanonicalEvidenceSequence DisposablePoolClient Pool.query pg-pool TypeError cb
~~~

~~~text
runCanonicalEvidenceSequence DisposablePoolClient verifyDatabaseDroppedInCatalog adminPool.query Pool.query call paths and callers/callees
~~~

~~~text
runCliMain dispatchCliRun runCanonicalEvidenceSequence exact callers callees call graph
~~~

Kết quả từng truy vấn lần lượt trả về khoảng 66, 82 và 97 symbols. Các con số này khác nhau vì mỗi truy vấn có phạm vi symbol/file khác nhau; không phải index bị mất dữ liệu.

## 4. Call graph chính đã xác định

~~~text
run-disposable-postgres-test.ts
  → runCliMain
    → dispatchCliRun
      → runCanonicalEvidenceSequence
        → inspectImage
        → runContainer
        → inspectContainer
        → attestMountNamespaceWithResult
        → validateMountNamespaceAttestation
        → waitForReady
        → createPoolFn hoặc new Pool
        → adminPool.query
        → migration/checksum child commands
        → cleanup: query, verify catalog, remove container, pool.end
~~~

### Các symbol và vị trí quan trọng

| Symbol | File | Vị trí | Ý nghĩa |
| --- | --- | --- | --- |
| runCliMain | backend/src/database/disposableDatabaseGuard.ts | :2677 | Entry point điều phối CLI và sanitize lỗi. |
| dispatchCliRun | backend/src/database/disposableDatabaseGuard.ts | :2560 | Chọn canonical runner hoặc legacy runner; canonical target phải là positional argument duy nhất. |
| runCanonicalEvidenceSequence | backend/src/database/disposableDatabaseGuard.ts | :2160 | Điều phối chuỗi evidence 19 bước. |
| DisposablePoolClient | backend/src/database/disposableDatabaseGuard.ts | :406 | Interface pool nội bộ của disposable runner. |
| verifyDatabaseDroppedInCatalog | backend/src/database/disposableDatabaseGuard.ts | :1878 | Kiểm tra database mục tiêu đã biến mất khỏi catalog. |
| realDockerAdapter | backend/src/database/disposableDatabaseGuard.ts | :2052 | Adapter Docker thật, dùng argv rõ ràng và timeout/cancellation. |
| attestMountNamespaceWithResult | backend/src/database/disposableDatabaseGuard.ts | :2081 | Gọi đường attestation mount namespace. |
| executeMountNamespaceCommand | backend/src/database/disposableDatabaseGuard.ts | :2031 | Thực thi docker exec và chuẩn hóa lỗi command. |
| DatabasePool.query | backend/src/database/pool.ts | :161 | Pool dùng chung của backend application; đây là symbol tên chung, không đồng nhất với disposable pool. |

## 5. Thứ tự phase được CodeGraph/source trace xác nhận

1. runCliMain nhận argv.
2. dispatchCliRun nhận đúng canonical runtime target.
3. runCanonicalEvidenceSequence xác minh image.
4. Tạo container disposable và xác minh launched ID.
5. Inspect container.
6. Attestation mount namespace.
7. Chờ PostgreSQL readiness.
8. Tạo pool quản trị.
9. Tạo database mục tiêu và ownership marker.
10. Chạy child migration/checksum phases.
11. Đóng kết nối, drop database, kiểm tra catalog và xóa container.

Attestation được gọi trước readiness và mọi database/migration action. Cleanup được thực hiện trong boundary riêng; lỗi cleanup không nên thay thế lỗi chính.

## 6. Blast radius CodeGraph trả về

| Symbol | Caller/callee summary | Ý nghĩa khi sửa |
| --- | --- | --- |
| runCliMain | 2 callers: CLI script và test | Sửa có thể ảnh hưởng entry point và cách báo lỗi CLI. |
| dispatchCliRun | 3 callers trong guard, script và test | Sửa có thể ảnh hưởng canonical/legacy routing. |
| runCanonicalEvidenceSequence | 3 callers: script và test | Đây là boundary chính của M07-A2; cần regression orchestration. |
| DisposablePoolClient | 7 callers trong guard; script/test sử dụng type này | Thay đổi interface có phạm vi trong disposable runner và các fake tương ứng. |
| query tại backend/src/database/pool.ts:161 | CodeGraph báo khoảng 196 callers ở nhiều repository và test | Đây là kết quả tên method tổng quát; phải khoanh vùng symbol/receiver trước khi sửa, không coi toàn bộ 196 caller là cùng lỗi. |

Các module được CodeGraph liệt kê quanh DatabasePool.query gồm repository Admin, control policy, script re-encryption/reset và nhiều test relational. Đây là blast-radius cảnh báo, không phải bằng chứng tất cả module đều bị lỗi pg-pool của disposable runner.

## 7. Liên hệ với chẩn đoán pg-pool

CodeGraph xác nhận đường đi trong repository đến lời gọi pool:

~~~text
runCanonicalEvidenceSequence
  → new Pool / createPoolFn
  → adminPool.query
~~~

Tại pre-remediation snapshot HEAD 0037cb96971e8f6223867852f27df66c9d36f8b7,
lời gọi database đầu tiên của canonical path nằm tại
`backend/src/database/disposableDatabaseGuard.ts:2377`; các call site liên quan
khác nằm tại `:2383`, `:2209` và helper `:1883-1886`. Đây là các historical
line positions của snapshot trước remediation. CodeGraph giúp xác định
callers/callees và phạm vi ảnh hưởng của các symbol này.

Kết luận overload của thư viện được xác minh riêng bằng dependency đã cài:

- pg: 8.23.0.
- pg-pool: 3.14.0.
- Pool.query không có overload Promise nhận AbortSignal ở argument thứ ba.
- Code tại pre-remediation snapshot đã truyền AbortSignal ở vị trí mà pg-pool
  dùng làm callback.
- Phân loại lỗi: POOL_QUERY_OVERLOAD_MISMATCH.

CodeGraph không thay thế việc đọc pg-pool/index.js và @types/pg; dependency runtime thường không nằm trong graph source của repository. Kết luận trên là bằng chứng kết hợp giữa CodeGraph call path và dependency contract.

## 8. Post-change CodeGraph reconciliation — PG-pool remediation

Sau khi sửa adapter disposable, đã chạy:

~~~powershell
codegraph sync
~~~

Kết quả: `Already up to date`. Sau đó chạy lại đúng truy vấn tập trung:

~~~text
runCanonicalEvidenceSequence DisposablePoolClient adminPool.query verifyDatabaseDroppedInCatalog callers callees
~~~

Kết quả hậu thay đổi: 84 symbols across 5 files. Các symbol được truy vấn và
receiver disposable vẫn là:

Kết quả `Already up to date` nghĩa là CodeGraph sync đã nhận working-tree
changes qua index/watcher và không cần quét thêm; nó không có nghĩa remediation
đã được commit. Graph hậu thay đổi phản ánh working tree chưa commit, không phải
tree của HEAD 0037cb96971e8f6223867852f27df66c9d36f8b7.

| Symbol | File và vị trí hậu thay đổi | Vai trò |
| --- | --- | --- |
| `DisposablePoolClient` | `backend/src/database/disposableDatabaseGuard.ts:406` | Adapter nội bộ chỉ nhận `query(sql, params?)` và `end()`. |
| `verifyDatabaseDroppedInCatalog` | `backend/src/database/disposableDatabaseGuard.ts:1907` | Catalog query dùng đúng hai argument Promise; signal chỉ được kiểm tra trước query. |
| `runCanonicalEvidenceSequence` | `backend/src/database/disposableDatabaseGuard.ts:2190` | Canonical orchestration; database query chạy qua `executeDatabaseQuery` tại `:2216`. |
| `executeDatabaseQuery` | `backend/src/database/disposableDatabaseGuard.ts:2216` | Kiểm tra cancellation trước query và tạo diagnostic đóng khi query fail/cancel. |
| Canonical create/marker | `backend/src/database/disposableDatabaseGuard.ts:2438-2453` | Gọi `pool.query(sql, undefined)`, không có argument thứ ba. |
| Canonical cleanup/catalog | `backend/src/database/disposableDatabaseGuard.ts:2259-2279` | Drop và verify đi qua cùng adapter contract, không truyền signal vào `Pool.query`. |
| `runCliMain` / `dispatchCliRun` | `backend/src/database/disposableDatabaseGuard.ts:2633` và `:2750` | Vẫn điều phối canonical target, không thêm fallback legacy cho target canonical. |

### Call path hậu remediation

~~~text
run-disposable-postgres-test.ts
  → runCliMain
    → dispatchCliRun
      → runCanonicalEvidenceSequence
        → executeDatabaseQuery
          → DisposablePoolClient.query(sql, params?)
            → Promise overload của pg/pg-pool
        → verifyDatabaseDroppedInCatalog
          → DisposablePoolClient.query(sql, params?)
~~~

Source verification hậu thay đổi:

- `rg` trên disposable guard không còn lời gọi `.query(..., AbortSignal)` ở
  các setup, marker, cleanup hoặc catalog call site.
- `DisposablePoolClient.query` không còn tham số `signal`.
- `backend/src/database/pool.ts` không bị thay đổi; 196 caller của method tên
  chung `query` không thuộc blast radius remediation này.
- Bốn regression test `M07-A2-PGPOOL-01..04` kiểm tra Promise overload tối đa
  hai argument, callback-faithful rejection của hình dạng cũ, primary error/
  diagnostic và cancellation trước catalog query.

Giới hạn: CodeGraph chỉ xác minh source/index và call graph. Chưa có runtime
Docker/PostgreSQL evidence; chưa chứng minh socket-level cancellation hoặc
M07-A2 runtime PASS.

## 9. Những gì CodeGraph đã làm và chưa làm

### Đã làm

- Tạo knowledge graph cho source tree hiện tại.
- Tìm symbol và vị trí dòng.
- Tìm caller/callee liên quan.
- Link các đường gọi có dynamic dispatch khi nhận diện được.
- Trả blast-radius summary trước khi sửa.
- Trả source hiện tại của các symbol được truy vấn.

### Chưa làm

- Bản thân CodeGraph không chạy unit test, typecheck hoặc build; các quality
  gate của remediation được chạy riêng và ghi trong task M01-07.
- Không chạy Docker/PostgreSQL/migration.
- Không kiểm tra network/socket runtime.
- Không kiểm tra dependency behavior bằng kết nối thật.
- Không đánh dấu M07-A2 runtime verified.
- Không sửa source nghiệp vụ.
- Không tự tạo commit hoặc push.

## 10. Giới hạn cần nói rõ với người review

- Graph phản ánh snapshot source tại thời điểm index; sau khi source thay đổi cần index lại để bảo đảm kết quả mới nhất.
- Tên method chung như query có thể tạo blast radius rộng hơn thực tế. Cần xác nhận receiver, file và symbol trước khi dùng làm căn cứ thay đổi.
- CodeGraph không tự quyết định source of truth khi code, OpenAPI, test và dependency mâu thuẫn.
- CodeGraph không chứng minh hành vi runtime; evidence runtime vẫn phải đến từ test, container probe, PostgreSQL disposable hoặc staging tương ứng.
- Index không nên được xem là bằng chứng production readiness.

## 11. Cách để sếp tự xem

### Xem báo cáo đã xuất

Mở file này:

documents/05-testing/staging-readiness/codegraph-report-2026-09-05.md

### Chạy truy vấn trực tiếp

~~~powershell
cd C:/Projects/banking-system
codegraph explore "runCliMain dispatchCliRun runCanonicalEvidenceSequence DisposablePoolClient Pool.query"
~~~

### Truy vấn riêng blast radius

~~~powershell
codegraph explore "callers and callees of runCanonicalEvidenceSequence"
~~~

### Truy vấn một symbol trước khi sửa

~~~powershell
codegraph explore "DisposablePoolClient verifyDatabaseDroppedInCatalog"
~~~

## 12. Kết luận bàn giao

CodeGraph đã lập chỉ mục thành công và chứng minh được cấu trúc call graph của
M07-A2 trong repository. Root cause `POOL_QUERY_OVERLOAD_MISMATCH` đã được xác
nhận bằng CodeGraph kết hợp với dependency contract đã cài. Post-change
graph/source không còn unsupported query shape trong disposable scope.

Đây chỉ là static/local evidence: CodeGraph không chứng minh hành vi Docker,
PostgreSQL, socket cancellation, migration hoặc cleanup runtime. M07-A2 runtime
chưa được verified và vẫn cần Owner authorization riêng cho retry.

## 13. M07-A2 STRUCTURED RESULT EMISSION REMEDIATION — CODEGRAPH RECONCILIATION

> Ghi chú: mục 13 là snapshot CodeGraph của remediation trung gian trước
> continuation output protocol. Mục 14 là kết quả hiện hành sau khi bổ sung
> EMIT-06..09 và awaitable production entrypoint.

### 13.1 Pre-change binding

Trước remediation, CodeGraph đã được sync và chạy đúng query:

```text
runCliMain dispatchCliRun runCanonicalEvidenceSequence CanonicalSequenceExecutionResult CliDispatchResult structured result stdout writer return throw callers callees
```

Kết quả pre-change: `63 symbols across 3 files`. Các symbol và line position
của snapshot trước sửa:

- `CanonicalSequenceExecutionResult` —
  `backend/src/database/disposableDatabaseGuard.ts:2175`.
- `dispatchCliRun` — `.../disposableDatabaseGuard.ts:2633`.
- `CliDispatchResult` — `.../disposableDatabaseGuard.ts:2626`.
- `runCliMain` — `.../disposableDatabaseGuard.ts:2750`.
- CLI entrypoint — `backend/scripts/run-disposable-postgres-test.ts:39-43`.

Call path trước sửa:

```text
run-disposable-postgres-test.ts
  → runCliMain
    → dispatchCliRun
      → runCanonicalEvidenceSequence
        → CanonicalSequenceExecutionResult
```

Source trace cho thấy canonical dispatch chỉ giữ các field điều phối cơ bản
và làm mất `completedSteps`, attestation/database diagnostic trước khi result
đến `runCliMain`; entrypoint cũng không serialize return value.

### 13.2 Remediation surface

Source change chỉ nằm trong disposable result/CLI boundary:

- `CanonicalRuntimeResultEnvelope` —
  `backend/src/database/disposableDatabaseGuard.ts:2209`.
- `createCanonicalRuntimeResultEnvelope` — `:2313`.
- `serializeCanonicalRuntimeResult` — `:2334`.
- `CliDispatchResult.canonicalResult` — `:2783`.
- `CliDispatcherDependencies.writeCanonicalResultFn` — `:2777`.
- `dispatchCliRun` canonical branches — `:2828-2841`.
- `runCliMain` canonical writer boundary — `:2907-2925`.

Mapper chỉ tạo envelope từ các field explicit đã allowlist. Internal `Error`
và các identity/runtime payload không được đưa vào JSON. Writer là stdout
channel và được `await`; legacy branch tiếp tục dùng log path đã sanitize.

### 13.3 Post-change CodeGraph query

Sau source change đã chạy:

```text
codegraph sync
```

Kết quả exact: `Already up to date`.

Query cùng nội dung được chạy lại:

```text
runCliMain dispatchCliRun runCanonicalEvidenceSequence CanonicalSequenceExecutionResult CliDispatchResult structured result stdout writer return throw callers callees
```

Kết quả post-change: `63 symbols across 2 files`. Việc sync trả
`Already up to date` phản ánh watcher/index đã nhận working-tree changes; nó
không có nghĩa các thay đổi đã commit. Graph hậu thay đổi phản ánh working
tree remediation, chưa phải tree của HEAD trước sửa.

Call path hậu thay đổi:

```text
run-disposable-postgres-test.ts
  → runCliMain
    → dispatchCliRun
      → runCanonicalEvidenceSequence
        → canonicalResult
          → createCanonicalRuntimeResultEnvelope
            → serializeCanonicalRuntimeResult
              → awaited stdout writer
```

CodeGraph/source reconciliation xác nhận `canonicalResult` không còn bị
discard tại dispatch boundary trong disposable scope. Không có thay đổi tại
`backend/src/database/pool.ts`; các caller tổng quát của method `query` nằm
ngoài blast radius này.

### 13.4 Evidence liên kết

- `M07-A2-EMIT-01` kiểm tra dispatch giữ complete canonical result.
- `M07-A2-EMIT-02` kiểm tra success envelope, schema, version và key set.
- `M07-A2-EMIT-03` kiểm tra throw/no-result envelope và không fallback legacy.
- `M07-A2-EMIT-04` kiểm tra async writer được await và legacy output tách
  biệt.
- `M07-A2-EMIT-05` kiểm tra primary failure và cleanup failure được tách trong
  envelope.
- Targeted suite sau remediation: `120/120 PASS`; không có test bị xóa,
  rename hoặc skip.

### 13.5 Giới hạn

CodeGraph chỉ cung cấp static/local source evidence và caller/callee
reconciliation. Nó không chứng minh Docker, PostgreSQL, migration, resource
cleanup runtime, socket-level cancellation hoặc M07-A2 runtime PASS. Không
được dùng report này để suy luận underlying runtime failure của invocation
lịch sử.

## 14. M07-A2 STRUCTURED RESULT EMISSION — POST-EMISSION RECONCILIATION

### 14.1 Mục đích và trạng thái index

Phần này ghi nhận CodeGraph sau continuation verification của output protocol;
đây là static evidence cho working tree, không phải runtime evidence. Sau khi
dọn các JavaScript/declaration artifact do backend build sinh ra, CodeGraph
index local đã được làm mới; `.codegraph` không nằm trong Git index.

- `codegraph sync` trả exact: `Already up to date`.
- Graph hiện phản ánh ba source files liên quan trong allowlist: disposable
  guard, canonical CLI script và targeted test seam.
- Kết quả không được dùng để đánh dấu M07-A2 runtime, M01-07 hoặc UC-M01
  hoàn thành.

### 14.2 Query exact và result

Query đã chạy đúng:

```text
runCliMain dispatchCliRun runCanonicalEvidenceSequence CanonicalSequenceExecutionResult CliDispatchResult structured result writer stdout callers callees
```

Kết quả exact: `Found 63 symbols across 3 files`.

Các symbol và vị trí hiện hành được CodeGraph/source đối chiếu:

| Symbol | File | Vị trí hiện hành |
| --- | --- | ---: |
| `CanonicalSequenceExecutionResult` | `backend/src/database/disposableDatabaseGuard.ts` | `2175` |
| `CanonicalRuntimeResultEnvelope` | `backend/src/database/disposableDatabaseGuard.ts` | `2210` |
| `createCanonicalRuntimeResultEnvelope` | `backend/src/database/disposableDatabaseGuard.ts` | `2314` |
| `serializeCanonicalRuntimeResult` | `backend/src/database/disposableDatabaseGuard.ts` | `2335` |
| `formatCanonicalRuntimeResultLine` | `backend/src/database/disposableDatabaseGuard.ts` | `2341` |
| `CliDispatcherDependencies.writeCanonicalResultFn` | `backend/src/database/disposableDatabaseGuard.ts` | `2784` |
| `CliDispatchResult` | `backend/src/database/disposableDatabaseGuard.ts` | `2787` |
| `dispatchCliRun` | `backend/src/database/disposableDatabaseGuard.ts` | `2795` |
| `runCliMain` | `backend/src/database/disposableDatabaseGuard.ts` | `2907`, writer `2930` |
| production entrypoint | `backend/scripts/run-disposable-postgres-test.ts` | `45–49` |

### 14.3 Post-change call graph và output path

```text
run-disposable-postgres-test.ts:45-49
  → await runCliMain:2907
    → dispatchCliRun:2795
      → runCanonicalEvidenceSequence:2350
        → CanonicalSequenceExecutionResult:2175
          → formatCanonicalRuntimeResultLine:2341
            → serializeCanonicalRuntimeResult:2335
              → awaited stdout writer:2930
```

Reconciliation với source xác nhận:

- `dispatchCliRun` giữ `canonicalResult` nguyên vẹn; không còn discard
  `completedSteps`, attestation diagnostic hoặc database diagnostic.
- `runCliMain` là production output sink; prefix `M07_A2_RESULT_V1 ` được tạo
  đúng một lần cho canonical invocation.
- Writer có contract đồng bộ/bất đồng bộ, được await; entrypoint cũng await
  `runCliMain`. Không có `process.exit()` hoặc duplicate writer path.
- Canonical throw được map thành `CANONICAL_SEQUENCE_THROWN`; writer rejection
  không retry và không đưa raw error sang stderr.
- Legacy route không emit canonical prefix và tiếp tục dùng sanitized stderr.
- PG-pool remediation hai-argument, tmpfs, migration, checksum, ownership và
  exact cleanup semantics không bị mở rộng hoặc thay đổi trong continuation.
- `backend/src/database/pool.ts` không thay đổi; generic `query` callers không
  được dùng làm blast radius.

### 14.4 Test/evidence binding

- Baseline: `115/115 PASS` tại committed HEAD trước continuation.
- Final local targeted suite: `124/124 PASS`, delta `+9`; chín registration
  `M07-A2-EMIT-01..09` xuất hiện đúng một lần.
- EMIT matrix bao phủ success, returned failure diagnostics, throw/no-result,
  cleanup precedence, duplicate prevention, awaited writer, writer rejection,
  leakage và legacy/import safety.
- Typecheck, build và `git diff --check` đều PASS.
- Đây chỉ là unit/static/local evidence; chưa chạy Docker, PostgreSQL,
  migration hoặc M07-A2 runtime retry.

### 14.5 Giới hạn và bàn giao

CodeGraph không chứng minh runtime behavior, PostgreSQL migration history,
container cleanup, network/socket behavior hoặc socket-level cancellation.
Underlying runtime failure lịch sử vẫn `UNKNOWN`; M07-A2 runtime vẫn
`NOT AUTHORIZED`/`BLOCKED`, M01-07 và UC-M01 vẫn `INCOMPLETE`.

**Kết luận:** `READY FOR M07-A2 STRUCTURED RESULT EMISSION OWNER REVIEW`.

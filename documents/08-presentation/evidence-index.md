# Evidence index — Đợt 1–3

Quy ước tầng: `source/static` = đối chiếu code/tài liệu; `component` = unit/service;
`PostgreSQL` = disposable hoặc persistent local được ghi rõ; `HTTP` = API local;
`emulator` = Android/native local; `remote CI` = chỉ khi có run evidence, không suy ra
từ workflow file.

| Claim | Evidence chính | Snapshot/commit | Tầng | Trạng thái và giới hạn |
| --- | --- | --- | --- | --- |
| Đợt 2 demo customer/KYC/funding/transfer chạy được | `tasks/DEMO/TASK_DOT_2_CORE_BANKING_DEMO.md` §2–§4 | `3b38cabc39c9254231e5ef0ccb90e2ae278a532f` | Mobile/Admin/API/PostgreSQL local | Owner approved academic; không phải staging |
| A/B và ledger đối soát | Đợt 2 §8.1 | `3b38cabc39c9254231e5ef0ccb90e2ae278a532f` | PostgreSQL read-only | A `4,498,000`, B `5,500,000`, debit=credit `15,502,000` |
| Idempotency replay không tạo side effect thứ hai | Đợt 2 §8.2, `backend/src/tests/databaseFoundation.test.ts` | snapshot ghi trong task | component/PostgreSQL disposable | Không dùng database demo |
| Cross-account denial | Đợt 2 §8.3 | snapshot ghi trong task | HTTP + PostgreSQL invariant | Không phải UI E2E đầy đủ |
| Maker self-approval bị chặn | Đợt 2 §8.4, `backend/src/admin/actions/actionEngine.ts` | snapshot ghi trong task | policy/service + Admin Web | Negative self-approval không phải UI E2E độc lập |
| Registration/KYC relational contract | `backend/src/tests/registrationRelational.test.ts`, `kycRelational.test.ts` | source snapshot | PostgreSQL disposable | Dùng command documented, không suy ra từ file tồn tại |
| Mobile loading/error/retry và route | `mobile-app/src/features/*`, `RequestErrorNotice.tsx` | current source | source/static + emulator report | Device/physical evidence còn phân mảnh |
| Local backend/mobile/admin quality | `documents/05-testing/stage2-*.md` | theo ngày từng report | component/local/emulator | Historical; không thay thế current remote run |
| Local Compose/migration/deployment recipe | `compose.yaml`, `backend/README.md`, `documents/07-release/preview-environment-matrix.md` | current source/docs | source/static + local preview | Cloud, managed DB, HTTPS chưa làm |
| CI workflows | `.github/workflows/*.yml` | current tree | source/static | Workflow tồn tại ≠ CI PASS; remote run chưa có trong packet |
| Đợt 3 documentation checkpoint | `tasks/DEMO/TASK_DOT_3_PROJECT_HANDOFF.md` | `9c585ce336ee5867557f89862bc8e07be3c0ca83` | documentation | Draft, chưa nghiệm thu |

## Quy tắc sử dụng

- Mỗi claim khi trình bày phải nói rõ tầng và snapshot; không trộn local với remote.
- Report lịch sử có thể có số flow/test khác nhau theo ngày; dùng commit/date của dòng
  evidence tương ứng, không âm thầm hợp nhất.
- Không đưa raw `artifacts/`, credential, log thô hoặc scratch script vào phụ lục.
- Chưa có bằng chứng teamwork, phân công thành viên, deployment cloud hay remote CI thì
  chuyển sang mục “Chờ Owner cung cấp”, không điền giả.

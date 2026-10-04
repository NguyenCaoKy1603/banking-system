# Đợt 3 — Chuẩn bị hồ sơ bàn giao và bảo vệ đồ án

## Trạng thái

`IN PROGRESS — DRAFT DELIVERABLES`

- Chế độ: `IMPLEMENT_AND_VERIFY — DOCUMENTATION FIRST`.
- Repository: `C:\Projects\banking-system`.
- Snapshot lập hồ sơ: `9c585ce336ee5867557f89862bc8e07be3c0ca83`.
- Đợt 1–2 giữ nguyên trạng thái đã nghiệm thu ở phạm vi academic; không mở lại nếu
  không có regression trực tiếp chặn bàn giao.
- Chưa triển khai cloud, chưa đổi source, chưa chạy test/build/Docker trong phiên soạn
  hồ sơ này, chưa stage/commit/push và không thay đổi database demo/dịch vụ đang giữ.

## 1. Mục tiêu và nguyên tắc

Tạo một bộ hồ sơ duy nhất để Owner có thể trình bày, tái hiện local và giải thích
kiến trúc, dữ liệu, kiểm thử, giới hạn và quyết định deployment. Ưu tiên chức năng,
demo, dữ liệu đúng, test hợp lý và code sinh viên giải thích được.

Không coi catalog 22 use case là 22 cam kết bắt buộc. Không bịa tên trường, giảng viên,
thành viên, đóng góp, ngày nộp, điểm hoặc bằng chứng teamwork/CI/deployment chưa có.

## 2. Deliverables đã tạo trong checkpoint này

| Nhóm | File |
| --- | --- |
| Entry point | [`README.md`](../../README.md) |
| Kiến trúc/phạm vi | [`architecture-and-scope.md`](../../documents/02-design/architecture-and-scope.md), [`function-scope.md`](../../documents/02-design/function-scope.md) |
| ERD/sequence | [`erd-core-demo.md`](../../documents/02-design/erd-core-demo.md), [`sequence-core-demo.md`](../../documents/02-design/sequence-core-demo.md) |
| Báo cáo | [`thesis-report-draft.md`](../../documents/08-presentation/thesis-report-draft.md) |
| Bảo vệ | [`slide-outline.md`](../../documents/08-presentation/slide-outline.md), [`demo-run-sheet.md`](../../documents/08-presentation/demo-run-sheet.md), [`pre-demo-checklist.md`](../../documents/08-presentation/pre-demo-checklist.md), [`defense-qa.md`](../../documents/08-presentation/defense-qa.md) |
| Evidence | [`evidence-index.md`](../../documents/08-presentation/evidence-index.md) |
| Tổng hợp Đợt 3 | File này |

README module hiện tại được giữ nguyên vì hướng dẫn Backend/Admin/Mobile đang có đã
phân biệt local, preview, disposable và production-like; root README liên kết tới
chúng làm hướng dẫn chi tiết. Scratch scripts không được đưa vào quy trình chính.

## 3. Căn cứ chức năng đã nghiệm thu

Đợt 2 đã được Owner chấp thuận trong phạm vi local/emulator/reference academic:

- Customer synthetic, KYC synthetic và Admin maker–checker.
- Funding virtual cho A `10,000,000 VND`.
- Transfer `500,000` và `5,000,000 VND`, fee `1,000 VND` mỗi giao dịch.
- A cuối kỳ `4,498,000 VND`, B nhận `5,500,000 VND`.
- Ledger debit và credit cùng `15,502,000 minor VND` trong phạm vi đối soát.
- Idempotency, cross-account denial và maker self-approval có evidence theo các tầng
  đã ghi; self-approval là policy/service scope, không phải negative UI E2E độc lập.

Nguồn: [`TASK_DOT_2_CORE_BANKING_DEMO.md`](TASK_DOT_2_CORE_BANKING_DEMO.md), snapshot
thực thi `3b38cabc39c9254231e5ef0ccb90e2ae278a532f` và documentation checkpoint hiện tại.

## 4. Đối chiếu rubric

Rubric MHTML tại `C:\Users\admin\Downloads\Hướng dẫn chấm Dự án CNTT.mhtml` đọc
được ở mức nhóm tiêu chí: chất lượng phần mềm/sản phẩm, quy trình & công nghệ, báo
cáo & thuyết trình. File checklist XLSX
`C:\Users\admin\Downloads\00\_Checklist chấm điểm DACNTT (1).xlsx` hiện không có;
không suy ra điểm từ ô mặc định hay từ rubric thiếu chi tiết.

Hồ sơ Đợt 3 vì vậy tập trung vào:

1. Demo có thể giải thích và tái hiện local.
2. Setup/deployment recipe tách bạch với evidence đã chạy.
3. Git/workflow được dẫn nguồn, không tuyên bố remote CI PASS khi chưa có run.
4. Báo cáo, ERD, sequence, slide, run sheet và Q&A khớp source/schema/API.
5. Giới hạn synthetic, device, staging, performance và security được nói rõ.

## 5. Khoảng trống bàn giao

- Chưa có quyết định cuối về mẫu báo cáo, thời lượng bảo vệ, hạn nộp và thông tin nhóm.
- Chưa có checklist XLSX tại đường dẫn Owner đưa.
- Chưa có remote CI run evidence, signed APK phát hành, physical-device evidence đầy
  đủ, usability study hoặc staging/managed database/HTTPS public.
- Một số report lịch sử có phạm vi/count khác nhau theo snapshot; evidence index giữ
  ngày/commit để tránh hợp nhất ngầm.
- README hiện nêu procedure local nhưng chưa được tuyên bố là clone sạch đã kiểm chứng.
- Không có source blocker được sửa trong phiên tài liệu này. Nếu rehearsal phát hiện
  blocker UI/validation/loading/navigation, mở task functional riêng trước khi sửa.

## 6. Đề xuất triển khai tối giản

Phương án đề xuất để đáp ứng rubric nếu deployment là bắt buộc: một private staging
duy nhất, một vùng triển khai, một backend/admin stack và PostgreSQL managed hoặc VM
riêng, HTTPS bắt buộc, secret manager và một signed APK/URL test. Không mở public
payment rail, worker production hay dữ liệu thật.

- Chi phí: chưa thể định lượng khi Owner chưa chọn provider; tối thiểu có thể phát sinh
  compute/database, domain/TLS và storage. Nếu rubric chấp nhận local preview, chi phí
  hạ tầng là `0` nhưng không đáp ứng claim deployment remote.
- Tài khoản/quyền cần Owner cấp: cloud/project/billing, registry nếu dùng image, DNS/TLS,
  secret manager, GitHub Actions secrets/environments, signing account và quyền đọc
  log/healthcheck.
- Điều kiện chấp nhận: provider và ngân sách rõ, dữ liệu synthetic, network private,
  backup/restore policy, migration approval, CI run, release checksum và rollback plan.
- Trạng thái: chưa provision, chưa publish, chưa mua/bật dịch vụ; Owner quyết định có
  thực hiện hay giữ local-only academic demo.

## 7. Acceptance criteria cho Đợt 3

- [x] Có root README làm entry point và liên kết tới hướng dẫn module.
- [x] Có bản báo cáo kỹ thuật tiếng Việt với mục “Chờ Owner cung cấp”.
- [x] Có kiến trúc, ERD subset, sequence và function scope bằng Mermaid/text.
- [x] Có slide outline, run sheet, pre-demo checklist và defense Q&A.
- [x] Có evidence index phân biệt local/component/PostgreSQL/HTTP/emulator/remote CI.
- [x] Có ghi rõ rubric MHTML đọc được và checklist XLSX bị thiếu.
- [ ] Owner chốt mẫu báo cáo, thời lượng, hạn nộp, nhóm và deployment requirement.
- [ ] Rehearsal demo được Owner thực hiện/chấp thuận; không chạy trong phiên soạn hồ sơ.
- [ ] Nếu rubric yêu cầu, có staging/device/remote CI evidence tương ứng; không suy ra từ
  tài liệu tĩnh.

## 8. Quyết định cần Owner cung cấp

1. Hạn nộp, mẫu báo cáo, thời lượng và hình thức bảo vệ.
2. Tên đề tài/trường/lớp/giảng viên và thông tin nhóm đã được xác nhận.
3. Deployment có bắt buộc không; nếu có, provider, ngân sách, domain và quyền cấp.
4. Có cần signed APK, thiết bị thật, video hoặc usability evidence không.
5. Người chịu trách nhiệm demo database/dịch vụ local và quyền restart/khôi phục.

## 9. Kiểm chứng trong phiên soạn hồ sơ

- Preflight branch/HEAD/status/index/untracked: phù hợp snapshot yêu cầu và sạch trước
  khi tạo tài liệu.
- CodeGraph đã được dùng cho truy vết Registration, Mobile, Admin, Transfer và schema;
  source TypeScript/DDL/OpenAPI là nguồn đối chiếu cuối.
- Đã kiểm tra cấu trúc README module, Compose, package manifests, migration/API anchors.
- Chưa chạy test, build, Docker, database, migration, deployment hoặc demo transaction.
- Bước tiếp theo là Owner review nội dung và chốt các quyết định ở §8; Đợt 3 vẫn
  `IN PROGRESS — DRAFT DELIVERABLES`.

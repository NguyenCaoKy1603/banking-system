# Outline slide bảo vệ — bản Markdown

`Chưa phải PPTX; thời lượng và mẫu slide chờ Owner cung cấp.`

| Slide | Nội dung | Điểm cần nói | Evidence gợi ý |
| --- | --- | --- | --- |
| 1 | Tên đề tài và mục tiêu | Reference academic, virtual money, local scope | `thesis-report-draft.md` |
| 2 | Bài toán và ranh giới | Điều gì mô phỏng, điều gì không tuyên bố | `function-scope.md` |
| 3 | Yêu cầu/use case bàn giao | Registration, KYC, maker–checker, funding, transfer | Đợt 2 task |
| 4 | Kiến trúc | Mobile/Admin/API/UnitOfWork/PostgreSQL | `architecture-and-scope.md` |
| 5 | Database và ERD | Account, transfer, ledger, KYC, staff/action | `erd-core-demo.md` |
| 6 | Registration/KYC | OTP challenge, metadata KYC, review boundary | `sequence-core-demo.md` |
| 7 | Maker–checker/funding | Maker bị chặn, checker độc lập, virtual funding | Đợt 2 §8.3–8.4 |
| 8 | Transfer và ledger | Quote, fee, TOTP, idempotency, receipt, đối soát | Đợt 2 §8.1–8.2 |
| 9 | UX và error handling | Loading/empty/error/retry, server-authoritative state | Mobile source/evidence |
| 10 | Kiểm thử và Git/CI | Tầng local/component/PostgreSQL/HTTP/emulator; workflow không đồng nghĩa CI pass | `evidence-index.md` |
| 11 | Demo trực tiếp | Chạy theo run sheet, có nhánh rút gọn | `demo-run-sheet.md` |
| 12 | Giới hạn và hướng phát triển | Không tiền thật/KYC thật; staging/device/CI còn mở | `defense-qa.md` |

## Ghi chú trình bày

- Không đưa credential, OTP/TOTP secret, full account number, token, raw ID hoặc dữ
  liệu cá nhân lên slide.
- Không dùng ô điểm mặc định của checklist XLSX vì file chưa có ở đường dẫn Owner cung cấp.
- Nếu cần rút ngắn, giữ slide 1–5, 7–8, 11–12; các chi tiết còn lại chuyển sang Q&A.

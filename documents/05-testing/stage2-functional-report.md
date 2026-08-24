# Giai đoạn 2 — Functional và PostgreSQL regression report

Ngày chạy: 2026-08-24  
Build ID: `stage2-20260824-df1f40b`  
Baseline: `df1f40bccbf8e1a3604101f6f23987f92480df54`

## Môi trường

- PostgreSQL `16.11` trong Docker Compose local.
- Database test riêng `stage2_full`, tạo từ rỗng và xóa sau khi hoàn tất bằng chứng.
- Backend chạy với test configuration sandbox; không dùng dữ liệu người dùng thật.
- Migration và test đều dùng cùng baseline commit; không có test PostgreSQL nào bị skip.

## Kết quả gate

| Gate | Kết quả | Bằng chứng |
| --- | --- | --- |
| Migration lần 1 | Đạt — 5 migration được áp dụng | `npm run db:migrate` |
| Migration lần 2 | Đạt — cả 5 migration báo đã áp dụng, không tạo bản ghi trùng | `npm run db:migrate` |
| Database contract | Đạt — 28 bảng, cột sống và constraint hợp lệ | `npm run validate:database` |
| OpenAPI backend | Đạt — 46 path và 51 guard method/segment | `npm run validate:openapi` |
| TypeScript/build | Đạt | `npm run typecheck`, `npm run build` |
| Full backend tests | Đạt — 92/92, fail 0, skip 0 | `npm test` |
| Critical HTTP tests | Đạt — 10/10 | `npm run test:critical` |
| Relational persistence | Đạt — 1/1 | `npm run test:relational` |
| Backend production dependency audit | Đạt — 0 vulnerability | `npm audit --omit=dev --audit-level=high` |

## Regression mới trong Stage 2

`persistence.test.ts` bổ sung kiểm thử PostgreSQL cho fraud report:

- hai request đồng thời với idempotency key khác nhau vẫn trả cùng một report;
- replay cùng transaction/reason không tạo report thứ hai;
- report còn sau khi tạo repository/system mới;
- user khác không thể đọc report của owner (user isolation);
- dữ liệu sau test giữ nguyên `reportCount = 1`.

Kết quả nằm trong full suite `92/92` và test persistence riêng không bị skip.

## Đánh giá

Functional backend và persistence gate đạt ở local database sạch. Bằng chứng này chưa thay thế remote CI, cloud staging, backup/restore thật hoặc device E2E.

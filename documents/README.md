# Tài liệu dự án Banking System / NOVA

> Cập nhật nội dung: 2026-10-14. Tài liệu này mô tả source đang có trong workspace tại HEAD **a5bf4a6** cộng với các thay đổi chưa commit. Đây không phải hồ sơ của một bản release đã đóng dấu.

## Đọc nhanh

Banking System / NOVA là reference implementation học thuật cho ứng dụng ngân hàng di động, vận hành bằng dữ liệu tổng hợp và tiền ảo. Mục tiêu là minh họa cách tổ chức luồng Mobile, API, persistence, quyền vận hành, idempotency, MFA và xử lý trạng thái lỗi. Đây không phải ngân hàng số đã được xác minh để pilot hoặc production.

- Không có tích hợp đã được xác minh với core banking, payment rail, KYC/AML hoặc nhà phát hành thẻ thật.
- Môi trường cloud/staging, HTTPS public, ký phát hành, monitoring và quy trình vận hành chưa có bằng chứng nghiệm thu trong tài liệu hiện hành.
- API mô tả dưới documents/api là Draft/reference. Source runtime, migration và validator mới là căn cứ cho hành vi hiện tại.
- Một tính năng có code không đồng nghĩa đã chạy qua mọi quality gate hoặc được owner/partner phê duyệt.

## Lộ trình đọc

1. [Trạng thái hiện tại](01-planning/current-status.md) — điều gì đang có, điều gì chưa được chứng minh.
2. [Kiến trúc và phạm vi](02-design/architecture-and-scope.md) — các process, data boundary và request flow.
3. [Bản đồ chức năng](02-design/function-scope.md) — nhóm tính năng Mobile, Backend, Admin và giới hạn.
4. [Bản đồ repository](01-planning/repository-map-current.md) — entrypoint và thư mục source.
5. Chọn phần chi tiết: [API](api/README.md), [Admin](admin/README.md), [AI và bảo mật](06-security-ai/README.md), [kiểm thử](05-testing/README.md), [release](07-release/README.md).

## Hệ thống gồm những gì

| Thành phần | Vai trò | Source chính |
| --- | --- | --- |
| Mobile NOVA | Expo / React Native app cho khách hàng; có cấu hình web export | mobile-app/src/app và mobile-app/src/features |
| Customer API | HTTP API cho auth, account, transfer, savings, credit, KYC, notification và các tính năng hướng dẫn | backend/src/server.ts, backend/src/http.ts |
| Relational persistence | PostgreSQL repositories và transaction boundary cho route đã cut over | backend/src/database, backend/src/database/postgresRelationalRepository.ts |
| Admin API | Process riêng cho staff session, quyền, action và audit | backend/src/adminServer.ts, backend/src/admin |
| Admin Web | Giao diện vận hành staff | admin-web/src |
| Worker | Outbox và scheduled lifecycle; phải bật riêng, có cutover guard | backend/src/worker.ts, backend/src/workers |
| Local stack | Compose phục vụ local preview/reference, không phải cloud release | compose.yaml |

~~~mermaid
flowchart LR
  M[Mobile NOVA] -->|HTTPS hoặc local sandbox| API[Customer API]
  API --> AUTH[Auth, device và request guards]
  AUTH --> RH[Relational HTTP boundary]
  RH --> SVC[Domain services]
  SVC --> UOW[UnitOfWork transaction]
  UOW --> DB[(PostgreSQL reference)]
  SVC -->|cùng transaction| LEDGER[Ledger, audit, outbox]
  ADMIN[Admin Web] --> AAPI[Admin API riêng]
  AAPI --> ACT[Staff auth, permission, maker-checker]
  ACT --> DB
  WORKER[Worker opt-in] --> DB
  WORKER --> EXT[Fake hoặc disabled providers]
  API --> AI[Assistant / Financial Advice]
  AI -. tùy chọn, private .-> RADOX[Radox AI API]
~~~

## Trạng thái chức năng ở mức tổng quan

Đây là bản đồ source, không phải tuyên bố nghiệm thu.

| Nhóm | Tình trạng trong source | Giới hạn cần giữ rõ |
| --- | --- | --- |
| Identity và MFA | Registration, login/session, TOTP và recovery flows | Provider email/OTP và thiết bị thật phụ thuộc cấu hình; không suy ra đã đạt staging |
| Accounts và history | Số dư, transaction history/detail, masked account number | Server là nguồn sự thật; không dùng số dư mock làm trạng thái authoritative |
| Transfer | Beneficiary, recipient lookup, quote, step-up, idempotency và trạng thái giao dịch | Chuyển nội bộ reference; không có payment rail/core thật |
| Savings | Quote, mở khoản, danh sách/chi tiết và lifecycle reference | Không phải sản phẩm tiền gửi đã được phê duyệt |
| Credit và Cards | Credit account/statement/payment và card controls trong sandbox | Không phải processor hoặc card issuer thật |
| KYC | Customer draft/submit và Admin review | Không có identity/KYC provider thật |
| QR | Tạo và quét thông tin nhận tiền có version | Payload luôn chưa xác minh; quét QR không tự tạo payment |
| Notifications | Danh sách, đọc, deep link và outbox plumbing | Push/email delivery thật chưa được xác minh |
| Assistant Help | FAQ catalog có controlled selection; Radox AI là provider runtime (yêu cầu ASSISTANT_RADOX_API_KEY) | Selector có thể chọn sai FAQ; đánh giá đã lưu vẫn partial |
| Financial Advice | Tính toán từ dữ liệu người dùng nhập, lựa chọn phương án có giới hạn và fallback | Không phải tư vấn ngân hàng được duyệt; không lấy balance thật làm input |
| Admin | Staff login, permissions, KYC/Credit/transfer operations, approvals, audit và outbox views | Không thay thế cổng vận hành ngân hàng thật |
| Fraud reporting | Đã gỡ customer flow và Admin workflow khỏi source hiện hành | Schema/migration cũ còn lại chỉ để bảo toàn dữ liệu lịch sử |

Chi tiết theo feature và evidence nằm trong [bản đồ chức năng](02-design/function-scope.md) và [trạng thái hiện tại](01-planning/current-status.md).

## Cách hiểu trạng thái và bằng chứng

| Nhãn | Có nghĩa là |
| --- | --- |
| Có trong source | Có implementation/config hiện tại; chưa nói gì về kết quả runtime |
| Đã kiểm tra local | Có report/lệnh và ngày chạy; chỉ chứng minh phạm vi, commit, database và máy được ghi trong evidence |
| Đã kiểm tra emulator/thiết bị | Chỉ áp dụng cho thiết bị, build và flow được ghi cụ thể |
| Staging verified | Chỉ dùng khi có URL, image/build digest, commit, migration fingerprint, test/device evidence và reviewer |
| Draft | Chưa có phê duyệt hợp đồng hoặc nghiệp vụ |
| Historical | Bằng chứng/snapshot cho một thời điểm trước; không được dùng như trạng thái hiện tại |

Các báo cáo trong documents/05-testing, documents/06-security-ai và documents/07-release được lưu theo đợt. Đọc ngày, commit/build, environment và phạm vi trong từng báo cáo trước khi dùng kết quả. Không gộp unit test, HTTP integration, emulator, thiết bị thật và staging thành cùng một loại bằng chứng.

## Source of truth

Khi nội dung mâu thuẫn, xử lý theo thứ tự sau và ghi rõ xung đột:

1. Runtime implementation và guards dưới backend/src, mobile-app/src, admin-web/src.
2. Database migrations, runtime validators và quality-gate scripts.
3. OpenAPI/contracts — hiện là draft/reference, không tự cấp quyền thay đổi API.
4. Tài liệu mô tả và report/evidence có ngày.
5. PROJECT_CONTEXT.md là snapshot định hướng; không phải trạng thái release hay task hiện tại.

Không sửa backend, schema, Mobile, Admin hoặc CI chỉ để tài liệu khớp một phía. Quy tắc scope và bảo mật nằm trong [AGENTS.md](../AGENTS.md).

## Bản đồ thư mục tài liệu

| Thư mục | Nội dung và điểm bắt đầu |
| --- | --- |
| 01-planning | [README](01-planning/README.md), current status, repository map, quyết định và quản trị rủi ro |
| 02-design | [README](02-design/README.md), kiến trúc, phạm vi tính năng, sequence và ERD demo |
| 04-code-process | Git, review, CI và quy trình thay đổi |
| 05-testing | [README](05-testing/README.md), hướng dẫn seed dữ liệu E2E và sổ tay kiểm thử MFA |
| 06-security-ai | [README](06-security-ai/README.md), assistant, financial advice, privacy, threat model và evaluation |
| 07-architecture | ADR cho PostgreSQL relational-v2 và outbox worker |
| 07-release | [README](07-release/README.md), environment, secret, migration, backup, rollback và preview runbooks |
| admin | [README](admin/README.md), Admin architecture, RBAC, threat model và runbook |
| api | [README](api/README.md), OpenAPI và API contracts |

Tên thư mục 07-architecture và 07-release cùng số do lịch sử tạo tài liệu. Không di chuyển file trong lượt tái cấu trúc này để giữ nguyên các liên kết evidence.

## Quy tắc dùng tài liệu

- Dùng current-status.md để hiểu phần còn mở; không suy từ backlog/milestone snapshot cũ.
- Dùng OpenAPI và contract để tham khảo hình dạng API, nhưng kiểm tra runtime và validator trước khi triển khai.
- Không đưa password, token, OTP, PIN, CVV, device secret, dữ liệu tài chính thật hoặc raw credential evidence vào tài liệu.
- Dữ liệu tiền luôn là virtual/synthetic. Không tuyên bố pilot/production readiness khi chưa có partner/core, legal/compliance, staging, device, monitoring, signing và rollback evidence.

# Repository map

## Thành phần chính

| Khu vực | Vai trò | Ownership hiện tại | Trạng thái |
| --- | --- | --- | --- |
| `mobile-app/` | Expo/React Native Mobile, auth, accounts, history, transfer, notifications, fraud, Card mock | Thành viên 2 | Reference flow đã chạy local |
| `mobile-app/src/app/` | Router, public/authenticated routes và screen entry points | Thành viên 2 | Có Login, Register, Home, Profile, KYC, QR, Beneficiaries, History, Transfer, Notification, Fraud, Transaction Detail, Card list/detail |
| `mobile-app/src/features/` | Feature services, types, validators, state/domain tests | Thành viên 2 | Có auth, accounts, history, transfers/beneficiaries, KYC, QR, notifications, fraud, control và Card mock |
| `mobile-app/e2e/maestro/` | Native E2E flow syntax và test IDs | Phối hợp | Có 5 flow, chưa chạy trên thiết bị thật |
| `backend/` | Reference HTTP/backend sandbox, PostgreSQL snapshot adapter, core adapter, ledger, audit, outbox | Thành viên 1/reference | Persistent snapshot sandbox; chưa phải relational production |
| `backend/database/` | Boundary SQL draft và validator | Thành viên 1/reference | Chưa wire vào runtime |
| `documents/api/` | Auth, session, accounts/transfers contract và OpenAPI | Phối hợp | Auth v1 approved nội bộ; banking contract/OpenAPI còn Draft |
| `documents/architecture/` | Scope, threat model, data classification và phase gates | Phối hợp | Có risk/scope baseline |
| `documents/mobile-pilot-runbook.md` | Quality gate, pilot limitation, rollback/incident notes | Phối hợp | Đã cập nhật snapshot local |

## Quy tắc phụ thuộc

`M0 → M1 → M2 → M3 → M4 → M10 → M11` là đường găng. Card, Savings, Credit và Chatbot chỉ được đóng khi có contract, test data, policy và owner phù hợp; mọi module phải quay về M10 để regression.

## Khoảng trống cần xác nhận

- Chưa có root planning board/Git PR evidence, thiết bị mục tiêu và staging URL được phê duyệt.
- Card đã có flow mock/reference; Savings, Credit và Chatbot chưa triển khai; eKYC/QR hiện là flow mô phỏng/reference.
- Chưa có backend NestJS/PostgreSQL/Redis/LLM production boundary; PostgreSQL snapshot chỉ phục vụ restart/concurrency contract test.

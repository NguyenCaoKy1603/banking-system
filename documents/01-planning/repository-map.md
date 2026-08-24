# Repository map

## Thành phần chính

| Khu vực | Vai trò | Ownership hiện tại | Trạng thái |
| --- | --- | --- | --- |
| `mobile-app/` | Expo/React Native Mobile, auth, accounts, history, transfer, notifications, fraud, Card mock | Thành viên 2 | Reference flow đã chạy local |
| `mobile-app/src/app/` | Router, public/authenticated routes và screen entry points | Thành viên 2 | Có Login, Register, Home, Profile, KYC, QR, Beneficiaries, History, Transfer, Notification, Fraud, Transaction Detail, Card list/detail |
| `mobile-app/src/features/` | Feature services, types, validators, state/domain tests | Thành viên 2 | Có auth, accounts, history, transfers/beneficiaries, KYC, QR, notifications, fraud, control, Savings và Credit; Card mock chỉ là fixture legacy |
| `mobile-app/e2e/maestro/` | Native E2E flow syntax và test IDs | Phối hợp | Có 10 flow; critical M0–M4/M8, M6 savings, credit payment, pending-resume, overdue notification và offline retry đã chạy trên Android emulator, chưa chạy trên thiết bị thật |
| `backend/` | Reference HTTP/backend sandbox, PostgreSQL relational reference, core adapter, ledger, audit, outbox | Thành viên 1/reference | Core M0–M4/M8 persistent relational sandbox; chưa phải production toàn domain |
| `backend/database/` | Boundary SQL draft, migration và validator | Thành viên 1/reference | Core M0–M4/M8 đã wire qua relational reference; toàn domain chưa phải production repository |
| `documents/api/` | Auth, session, accounts/transfers contract và OpenAPI | Phối hợp | Auth DRAFT v2 và banking contract/OpenAPI đều chưa có phê duyệt production |
| `documents/architecture/` | Scope, threat model, data classification và phase gates | Phối hợp | Có risk/scope baseline |
| `documents/mobile-pilot-runbook.md` | Quality gate, pilot limitation, rollback/incident notes | Phối hợp | Đã cập nhật snapshot local |

## Quy tắc phụ thuộc

`M0 → M1 → M2 → M3 → M4 → M10 → M11` là đường găng. Card, Savings, Credit và Chatbot chỉ được đóng khi có contract, test data, policy và owner phù hợp; mọi module phải quay về M10 để regression.

## Khoảng trống cần xác nhận

- Chưa có root planning board/Git PR evidence, thiết bị mục tiêu và staging URL được phê duyệt.
- Card vẫn có fixture mock/reference; Savings và Credit đã có reference sandbox; Chatbot chưa triển khai; eKYC/QR hiện là flow mô phỏng/reference.
- Chưa có backend NestJS/PostgreSQL/Redis/LLM production boundary; PostgreSQL relational reference hiện phục vụ core sandbox, còn auth runtime/M6/M7 vẫn record-level reference.
## Đồng bộ M6/M7 — 2026-08-15

- `mobile-app/src/features/savings/` là M6 reference flow; `mobile-app/src/features/credit/` là M7 Credit sandbox flow.
- `mobile-app/src/features/cards/screens/` dùng API Credit draft cho route `/cards`; `cardsMock.ts` chỉ là fixture/test legacy, không phải runtime source M7.
- `backend/src/credit.ts`, `backend/src/bankingSystem.ts`, `backend/src/http.ts` và `backend/database/003_credit_sandbox.sql` tạo boundary Credit ở mức persistent-snapshot reference; chưa phải card processor hay production relational repository.

## Cap nhat M6/M7 - 2026-08-15

- `mobile-app/src/features/credit/` va `mobile-app/src/features/savings/` la feature runtime reference; Cards khong con dung `cardsMock` o runtime.
- `mobile-app/e2e/maestro/` hiện có 10 flow syntax hợp lệ, thêm `critical-savings.yaml`, `critical-credit.yaml`, `critical-credit-pending-resume.yaml`, `critical-credit-overdue-notification.yaml` và `critical-offline-retry.yaml`; M6/M7/offline emulator execution đã pass.
- `backend/src/credit.ts`, `backend/database/003_credit_sandbox.sql` va API Credit la sandbox draft; PostgreSQL relational runtime chua wire.

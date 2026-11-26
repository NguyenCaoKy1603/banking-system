# Admin Console và control plane

Admin Web và Admin API là một control plane riêng với staff session, cookie/CSRF và permission model tách khỏi customer Mobile/API.

## Đọc theo chủ đề

| Tài liệu | Nội dung |
| --- | --- |
| [architecture.md](architecture.md) | Process boundary và application architecture |
| [rbac-matrix.md](rbac-matrix.md) | Role/permission interpretation; runtime permission registry mới là source of truth |
| [four-eyes-workflow.md](four-eyes-workflow.md) | Maker-checker/action lifecycle |
| [threat-model.md](threat-model.md) | Threats và controls của Admin |
| [runbook.md](runbook.md) | Local setup và thao tác vận hành reference |
| [manual-test.md](manual-test.md) | Manual checks và scope của test report |

## Source anchors

- Startup: backend/src/adminServer.ts.
- Route/session/CSRF boundary: backend/src/admin/http/adminHttp.ts.
- Permission registry: backend/src/admin/authorization/permissionRegistry.ts.
- Action authorization and maker-checker: backend/src/admin/actions/actionEngine.ts.
- Staff persistence: backend/src/admin/repositories/adminRepository.ts.
- UI entry: admin-web/src/App.tsx and admin-web/src/router.ts.

## Giới hạn

Admin hiện vận hành trên dữ liệu reference/virtual (`63` routes trong `permissionRegistry.ts`, bao gồm quản trị `control_policy`, đối soát sổ cái kép `ledger-reconciliation` và hàng đợi cảnh báo bất thường `anomalies`). Legacy `fraud_reports` queue cũ đã bị gỡ (D-39); luồng mới xử lý cảnh báo bất thường từ bảng `transaction_anomalies`. Không coi local Admin test, local PostgreSQL hoặc browser screenshot là staging/production evidence.

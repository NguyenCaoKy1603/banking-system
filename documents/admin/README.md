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
| [p0-status.md](p0-status.md) | Snapshot tiến độ P0 |
| [admin-web-improvement-plan.md](admin-web-improvement-plan.md) | Kế hoạch theo thời điểm |
| [admin-web-improvement-report.md](admin-web-improvement-report.md) | Báo cáo cải thiện theo thời điểm |
| [e2e-evidence.md](e2e-evidence.md) | Evidence lịch sử; các E2E runner đã gỡ khỏi source ngày 2026-10-11 |

## Source anchors

- Startup: backend/src/adminServer.ts.
- Route/session/CSRF boundary: backend/src/admin/http/adminHttp.ts.
- Permission registry: backend/src/admin/authorization/permissionRegistry.ts.
- Action authorization and maker-checker: backend/src/admin/actions/actionEngine.ts.
- Staff persistence: backend/src/admin/repositories/adminRepository.ts.
- UI entry: admin-web/src/App.tsx and admin-web/src/router.ts.

## Giới hạn

Admin hiện vận hành trên dữ liệu reference/virtual. Không có fraud queue hiện hành; legacy schema không đồng nghĩa workflow còn được support. Không coi local Admin test, local PostgreSQL hoặc browser screenshot là staging/production evidence.

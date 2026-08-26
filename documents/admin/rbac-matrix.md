# RBAC matrix P0

| Permission group | SUPPORT | OPERATIONS | CONTROL | ADMIN |
|---|---:|---:|---:|---:|
| Customer masked read / account read | ✓ | ✓ | ✓ | ✓ |
| Customer PII / assigned case | hạn chế | ✓ | ✓ | theo scope |
| Tạo customer access-lock request | ✓ | ✓ | — | ✓ |
| Tạo customer access-unlock request | — | ✓ | — | ✓ |
| Tạo account block/unblock request | — | ✓ | — | — |
| Tạo funding request | — | ✓ | — | — |
| Approve lock/unlock/funding | — | — | ✓ | — |
| KYC/credit review | — | ✓ | xem/approve | xem |
| Pending transfer read | giới hạn | ✓ | ✓ | ✓ |
| Fraud triage | ✓ | ✓ | ✓ | xem |
| Fraud investigation/request | — | ✓ | ✓ | — |
| Outbox/job read | tổng quan | ✓ | ✓ | ✓ |
| Outbox/job request | — | ✓ | — | — |
| Outbox/job approve | — | — | ✓ | — |
| Staff invite/role/disable request | — | — | xem | ✓ |
| Role/disable approve | — | — | ✓ | — |
| Audit read/export | — | scope | ✓ | scope |

Permission được khai báo bằng code chi tiết; không dùng điều kiện `role === "ADMIN"`. Role hết hạn, staff LOCKED/DISABLED hoặc session có `authorization_version` cũ đều bị deny.

`customer.access-lock.request` và `customer.access-unlock.request` là hai permission tách biệt: SUPPORT chỉ được tạo yêu cầu khóa; OPERATIONS/ADMIN mới được tạo yêu cầu mở khóa; quyết định cuối vẫn cần CONTROL.

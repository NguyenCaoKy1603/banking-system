# Provider-neutral staging contract

[`contract.yaml`](contract.yaml) mô tả deployment contract tối thiểu cho
staging học thuật: API, Admin API, Admin Web, migration job, hai worker,
PostgreSQL 16 riêng, secret references, HTTPS origin, probes, limits và
rollback revision. Đây chưa phải manifest triển khai của một provider cụ thể;
`metadata.status=NOT_PROVISIONED` là cố ý cho tới khi owner chọn provider và
cấp credential ngoài Git.

Provider adapter sau này phải giữ nguyên image digest, biến runtime,
`verify-full`, secret IDs và thứ tự migration → API → Admin → worker; không
được thay placeholder bằng secret trong repository.

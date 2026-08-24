# Stage 1 migration evidence — local Compose

Ngày kiểm tra: 2026-08-24
Compose project: `banking-reference-preview`
Image metadata commit: `6438083`

First run against a new PostgreSQL named volume:

```text
PostgreSQL migration applied successfully: 001_banking_mvp.
PostgreSQL migration applied successfully: 002_savings_sandbox.
PostgreSQL migration applied successfully: 003_credit_sandbox.
PostgreSQL migration applied successfully: 004_credit_unlock_policy.
PostgreSQL migration applied successfully: 005_relational_reference_runtime.
```

Second run against the same database (idempotency):

```text
PostgreSQL migration already applied: 001_banking_mvp.
PostgreSQL migration already applied: 002_savings_sandbox.
PostgreSQL migration already applied: 003_credit_sandbox.
PostgreSQL migration already applied: 004_credit_unlock_policy.
PostgreSQL migration already applied: 005_relational_reference_runtime.
```

The evidence is sanitized; no database password, OTP, token, operator key or customer identifier is recorded.

# Banking MVP scope and risk record

> **Trạng thái:** Working decision record for phase 0. Các mục phụ thuộc partner/legal vẫn mở.

## Giả định phạm vi

- Thị trường Việt Nam, khách hàng cá nhân, tiền tệ VND.
- Kênh mobile Android/iOS; Expo/React Native giữ vai trò presentation/client.
- MVP kích hoạt digital banking cho khách hàng đã có quan hệ với ngân hàng/BaaS partner.
- Không tự mở tài khoản mới trong phase này; eKYC, AML, consent và account opening là workstream riêng.

### In scope

- Login, OTP/MFA theo policy từ backend, device binding, session restore và logout tất cả thiết bị.
- Một tài khoản thanh toán với available/current balance do core banking cung cấp.
- Lịch sử giao dịch cursor pagination và transaction detail.
- Chuyển tiền: beneficiary → amount/fee quote → review → step-up → submit → pending/success/failed/reversed → receipt.
- Transaction notification, profile và fraud reporting channel.

### Out of scope

Thẻ, khoản vay, tiết kiệm, đầu tư, hóa đơn, ngoại tệ, chuyển quốc tế, tài khoản doanh nghiệp và QR payment ở phase đầu.

## Phụ thuộc bắt buộc

1. Chọn ngân hàng/BaaS partner và core-banking adapter; chưa có lựa chọn này thì chưa có nguồn sự thật cho balance/ledger.
2. Chốt OTP/MFA provider, device binding, risk engine và step-up policy.
3. Phê duyệt OpenAPI chính thức từ Mobile, Backend, partner và legal/compliance. Contract accounts/transfers trong repo hiện chỉ là DRAFT.
4. Chốt môi trường certification, secrets, app signing, monitoring và quy trình incident/kill switch.

## Threat model tối thiểu

| Threat | Ví dụ | Kiểm soát bắt buộc |
| --- | --- | --- |
| Credential theft | Password/token bị lộ hoặc replay | SecureStore, refresh rotation, revoke, không log secrets, server authorization |
| Session abuse | Thiết bị mất hoặc token bị đánh cắp | Device binding, TTL, all-device logout, risk-based step-up |
| Replay/double submit | Retry hoặc double-tap tạo hai transfer | Idempotency key, request fingerprint, immutable state machine |
| Tampering | Client sửa amount/balance/status | Server recalculates quote, core-banking source of truth, no optimistic balance |
| API abuse | Brute force, enumeration, automation | Rate limit, generic errors, velocity/risk rules, audit |
| Supply-chain/build risk | Dependency hoặc artifact bị thay đổi | Lockfile review, dependency audit, signed builds, CI gates |
| Privacy leakage | PII/financial data vào logs | Data minimization, redaction, access control, retention policy |

## Phân loại dữ liệu

- **Restricted:** password, access/refresh token, OTP/step-up proof, device binding secret, fraud signals.
- **Confidential:** customer PII, account identifiers, balances, transaction details, beneficiary data.
- **Internal:** request ID, trace ID, operational metrics đã được redaction.
- **Public:** app metadata, không chứa thông tin customer hoặc giao dịch.

Restricted/Confidential data không được ghi log/analytics/crash payload; mọi truy cập backend phải có authorization và audit.

## Điều kiện chuyển phase

- Phase 0 → 1: partner/core, threat model, data classification và approved OpenAPI đã ký.
- Phase 1 → 2: auth thật, refresh/revoke contract, CI gates và HTTPS-only đã chạy trong môi trường test.
- Phase 2 → 3: balance/history reconciliation test và offline/error states đã đạt.
- Phase 3 → 4: idempotency/retry, crash-resume, step-up và transfer state machine đã được integration test với partner sandbox.
- Phase 4 → 5: không còn High/Critical security finding, có monitoring/kill switch, backup/restore và runbook diễn tập.

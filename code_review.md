# Code review checklist

## Phạm vi

- [ ] Diff chỉ nằm trong task và ownership đã được duyệt.
- [ ] Không có file môi trường thật, secret, token, password hoặc dữ liệu cá nhân.
- [ ] Không có API breaking change hoặc thay đổi shared contract ngoài quyết định đã ghi.

## Hành vi

- [ ] Có loading, empty, success, validation, API error, offline/timeout và retry phù hợp.
- [ ] Unauthorized xử lý bằng refresh hoặc đưa về đăng nhập an toàn.
- [ ] Balance, fee, interest, credit debt và transaction status lấy từ server; không optimistic-update số dư.
- [ ] Transfer có idempotency, step-up, pending/failed/reversed và resume sau restart.

## Bảo mật

- [ ] Không log secret hoặc dữ liệu Restricted/Confidential.
- [ ] Ownership và authorization được kiểm tra ở Backend/reference contract.
- [ ] Dữ liệu nhạy cảm được che trong UI, screenshot, telemetry và test fixture.

## Kiểm chứng

- [ ] Lint, type-check, test và build/export liên quan đều đạt.
- [ ] OpenAPI/contract và E2E syntax được kiểm tra nếu task chạm API/flow.
- [ ] Đã ghi rõ phần chưa thể kiểm tra trên thiết bị thật/staging.

# Code review checklist

Checkpoint review: `611c51f` (implementation `aa0e3de`)
Phạm vi: reference sandbox/demo; không phải production banking.

## Phạm vi

- [x] Diff nằm trong task M0–M8/M7 sandbox và ownership Mobile/Backend/reference đã được ghi nhận.
- [x] Không commit file môi trường thật, secret, token, password hoặc dữ liệu cá nhân; artifact local bị ignore.
- [x] API mới được ghi rõ là Draft trong contract/OpenAPI và không thay đổi production API đã phê duyệt.

## Hành vi

- [x] Có loading, empty, success, validation, API error, timeout/offline và retry ở các flow chính.
- [x] Unauthorized xử lý bằng refresh hoặc đưa về đăng nhập an toàn.
- [x] Balance, fee, interest, credit debt và transaction status lấy từ server; không optimistic-update số dư.
- [x] Transfer/Credit payment có idempotency, step-up, pending/failed/reversed và resume sau restart sandbox.

## Bảo mật

- [x] Không log secret hoặc dữ liệu Restricted/Confidential; seed không in password/OTP.
- [x] Ownership và authorization được kiểm tra ở Backend/reference contract.
- [x] Dữ liệu nhạy cảm được che trong UI, screenshot, telemetry và test fixture.

## Kiểm chứng

- [x] Lint, type-check, test, build/export và PostgreSQL sandbox liên quan đều đạt; Mobile audit High là blocker riêng.
- [x] OpenAPI/contract và E2E syntax được kiểm tra; Maestro critical flow đã chạy trên Android emulator.
- [x] Phần chưa thể kiểm tra trên thiết bị thật, staging, signing, relational production và dependency audit đã ghi rõ trong risk/test report.

Kết luận: reference sandbox đủ bằng chứng demo; chưa được phê duyệt production/pilot.

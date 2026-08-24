# Test report — Mobile banking reference preview

> Cập nhật hiện hành 2026-08-24: worktree hardening đạt Mobile lint/typecheck, 46 suite/260 test, coverage, OpenAPI, 10 Maestro flow syntax và web export 33 route; Backend đạt 88 definition/82 pass/6 PostgreSQL skip cùng critical 8/8. Bằng chứng PostgreSQL/emulator ngày 2026-08-17 bên dưới là lịch sử và chưa được chạy lại cho worktree mới.

> Handoff manifest không chứa credential/token/OTP: [`handoff-manifest-2026-08-17.json`](handoff-manifest-2026-08-17.json).

Ngày lập: 2026-08-24
Phạm vi: M0–M4, M6–M8 và Card mock bonus
Trạng thái: **Local reference pass; Android emulator E2E pass; device/staging gates còn mở**
Backend verification checkpoint hiện hành: code `dd515ad`; documentation/evidence emulator giữ theo các artifact đã ghi trong manifest; historical backend gate `595afc3` remains referenced in the audit trail. The checkpoint includes the current M6/M7, account-reveal and offline-retry evidence.

## Kết quả đã chạy

| Gate | Kết quả |
| --- | --- |
| Mobile lint | Đạt sau khi hoàn tất thay đổi hiện tại |
| Mobile typecheck | Đạt |
| Mobile unit tests | 46 suite, 260 test đạt |
| Mobile coverage | 85,53% statements, 86,57% branches, 93,39% functions, 85,97% lines |
| Offline/timeout presentation | Đạt mapping và retry unit test cho `NETWORK_ERROR`, `TIMEOUT`, `REQUEST_ABORTED`; Home/Account Detail/History/Login giữ nguyên lỗi API để hiển thị đúng loại lỗi, có retry notice; offline login retry đã pass trên emulator |
| OpenAPI required paths | Đạt, 43 path bắt buộc phía Mobile; Backend kiểm tra 46 path và 51 exact route guard |
| Native E2E | Android emulator `Pixel_7_API_35`: M0–M4, M6, M8 và Credit sandbox flow đạt; gồm hiện/sao chép đầy đủ số tài khoản, eKYC mô phỏng, beneficiary, QR manual fallback, savings quote/review/OTP và notification deep link |
| Maestro | 10 flow hợp lệ; M0–M4/M8, M6 savings, credit payment, pending-resume, Credit card lock/restart/unlock, Credit overdue notification và offline login retry chạy thành công trên Android emulator bằng Maestro 2.8.0 |
| Backend reference | Worktree không DB: 88 definition, 82 pass, 6 PostgreSQL skip; critical API 8/8; static schema 28 bảng đạt. PostgreSQL live và seed E2E là bằng chứng lịch sử 2026-08-17 |
| Expo web export | Đạt, 33 static route; dùng URL HTTPS placeholder cho static export vì `.env` local là HTTP sandbox và bị production guard từ chối |
| Dependency audit | **Không đạt**: 14 High theo chuỗi Expo/Metro → `image-size@1.2.1`; npm chỉ đề xuất hạ major Expo/React Native không tương thích. Không force fix; chờ bản vá upstream và risk acceptance |

## Smoke seed

`backend/scripts/seed-e2e.ts` tạo user thử nghiệm, bật MFA sandbox theo biến môi trường, tạo beneficiary nếu thiếu, tạo một transfer reference và in ra các biến môi trường cần cho Maestro. Password/OTP chỉ truyền qua biến môi trường, không ghi vào source hoặc report.

## Chưa thể xác nhận tại workspace

- Chưa có thiết bị Android/iOS thật hoặc EAS CLI.
- Đã có APK release local, package/checksum và log Maestro trên emulator; chưa có video cold start/crash-resume, camera thật hoặc biometric prompt thật.
- Transfer kill app trước/sau submit và session restore sau force-stop chưa có kết quả native lặp lại; riêng credit pending → restart → resume đã pass bằng flow dedicated.
- Chưa có staging URL/partner integration đã phê duyệt.
- Handoff Git: code checkpoint hiện hành `cab97e0`; source/workflow/contract/tài liệu cập nhật đang được chốt trong cùng handoff; clone sạch đã chạy `npm ci` và các gate chính. Chưa push/PR trong phiên này.
- Chưa có kết quả usability/accessibility với người dùng và chưa có approver cho 14 cảnh báo High.

## Kết luận

Các kiểm tra local cùng E2E emulator chứng minh reference implementation có thể cài/chạy trong một môi trường Android sandbox và contract boundary, nhưng không chứng minh sẵn sàng pilot. Bằng chứng Maestro mới của flow M0–M4/M8, M6 savings, credit payment, pending-resume, Credit card lock/restart/unlock và Credit overdue notification lần lượt được lưu tại `C:\Users\admin\.maestro\tests\2026-08-16_014619`, `C:\Users\admin\.maestro\tests\2026-08-16_013045`, `C:\Users\admin\.maestro\tests\2026-08-16_000436`, `C:\Users\admin\.maestro\tests\2026-08-16_000714`, `C:\Users\admin\.maestro\tests\2026-08-16_003018` và `C:\Users\admin\.maestro\tests\2026-08-16_004626`; M11 chỉ được đóng khi có device matrix trên thiết bị được duyệt, native lifecycle E2E đầy đủ, staging approval và quyết định dependency risk.

## Xác nhận hiện hành — 2026-08-17

- Clone sạch backend/mobile đã chạy `npm ci`; backend migration từ database rỗng, 70/70 test và Mobile typecheck/10 flow syntax đạt.
- M0–M4/M8 pass trên APK release hiện tại: `C:\Users\admin\.maestro\tests\2026-08-17_121849`.
- Transfer pending-resume pass sau force-stop/mở lại: `C:\Users\admin\.maestro\tests\2026-08-17_125314`.
- Offline login retry pass trên emulator với API URL cố ý không reachable; raw Maestro artifact đã xóa để không lưu password test vào command metadata.
- Mobile audit vẫn có 14 High transitive từ Expo/Metro; đây là risk mở, không tuyên bố production-ready.

## Cap nhat xac nhan cuoi M6/M7 va account reveal - 2026-08-15

- Backend: local không có database có 70 test, 64 pass và 6 skip; với PostgreSQL 16 tạm thời có 70/70 pass, migration 001–005, live schema validator và critical HTTP 8/8.
- Mobile: 37 suite/170 test pass; lint, typecheck, OpenAPI 36 path, 10 flow Maestro syntax, web export 33 route và release config đều đạt.
- Credit sandbox da co seed card, sao ke, quote, MFA, idempotency, PENDING resume, ledger/reconciliation va lock/unlock step-up.
- `seed:e2e` da chay thanh cong tren server sandbox tam: transfer va savings `SUCCEEDED`, Credit card/statement duoc tao; stdout khong chua password/OTP.
- Account number: list API chi tra masked; `GET /accounts/{accountId}/number` tra full number; Home va Account Detail co nut Hien day du va Sao chep, clipboard nhan dung toan bo chuoi so.
- Backend dependency audit 0 vulnerability; Mobile con 14 High transitive tu `image-size` trong Expo/Metro. Khong ap dung `npm audit fix --force` vi no de xuat breaking downgrade Expo.
- Maestro/ADB da chay M7 tren `Pixel_7_API_35`: credit payment, pending → stop/launch → resume, card lock → stop/launch → OTP unlock va overdue notification → card detail deu pass; staging, partner integration va physical-device evidence van mo.
- Maestro/ADB da chay M6 savings tren APK release moi: quote/review → step-up OTP → mo khoan → danh sach tien gui pass; artifact `C:\Users\admin\.maestro\tests\2026-08-16_013045`.

## Hardening worktree — 2026-08-24

Trạng thái: **reference regression đang cập nhật; chưa thay thế device/staging evidence ngày 2026-08-17**.

| Hạng mục | Bằng chứng hiện có | Còn thiếu |
| --- | --- | --- |
| Client intent recovery | Unit test bao phủ draft hết hạn bị xóa, `SUBMIT_UNKNOWN`/`ACCEPTED_PENDING`/`ACCEPTED_TERMINAL` được giữ sau quote TTL/logout, phân loại lỗi submit, scoped SecureStore key, migration legacy và fail-closed khi SecureStore hỏng/dữ liệu malformed cho transfer/savings/credit/fraud | Network fault injection trước/sau server commit; force-stop sau receipt terminal; logout/re-login cùng user và cross-user/card isolation trên device |
| Auth transient/terminal | Unit test phân loại refresh `401` terminal và lỗi khác recoverable; session epoch/single-flight tách theo phiên; cold-start/background dùng trạng thái lock; logout race không làm sống lại session và không purge recovery intent; persistent HTTP giữ revoke/rate-limit/challenge lock qua restart | Device test cho offline background/resume, app-switcher snapshot và xác nhận token cũ 401 sau logout-all trên backend thật |
| Fraud report | HTTP regression kiểm tra cùng idempotency key trả cùng `reportId` và GET status; Mobile có durable local intent/response validation, fail-closed recovery và reset có kiểm soát cho `FRAUD_REPORT_ALREADY_EXISTS`/rejection đã biết | PostgreSQL live restart test, downstream fraud/risk integration, status sau `RECEIVED`, SLA/operator flow |
| Credit correctness | Domain regression cho latest payable statement, overpay/non-negative outstanding, minimum-payment delinquency và reconciliation invariant | PostgreSQL concurrent payment/reversal với worker thật; interest/fee/allocation policy được product/legal duyệt |
| GET read-only/worker | Domain regression snapshot state trước/sau read cho Savings/Credit; có settlement/scheduled-work command riêng và scheduled catch-up idempotency test | Chưa có dedicated no-mutation HTTP/PostgreSQL regression và durable scheduler/queue, lease/retry/backoff, crash/concurrency test |

Backend gate đã chạy trên worktree không cấu hình database:

- `npm run typecheck`: đạt.
- `npm run build`: đạt.
- Backend `npm test`: 88 definition, 82 pass, 6 PostgreSQL test skip, 0 fail; `test:critical` 8/8 pass.
- Mobile `npm test -- --runInBand`: 46 suite, 260/260 test pass.
- Mobile coverage: 85,53% statement, 86,57% branch, 93,39% function, 85,97% line; lint/typecheck/OpenAPI/10 Maestro flow syntax đạt.
- Web export: 33 route đạt với `EXPO_PUBLIC_API_URL` HTTPS tạm thời; `.env` local HTTP vẫn bị production guard chặn đúng policy.
- Static database source contract: đạt 28 bảng/invariant khi bỏ `DATABASE_URL`; live PostgreSQL validator/test chưa đạt trong môi trường hiện tại và 6 bài bị skip.
- `tsx --test src/tests/http-security-persistence.test.ts`: 4/4 pass, 0 skip.

Full Mobile lint/typecheck/test/coverage/OpenAPI/Maestro syntax/export và Backend typecheck/build/test/critical/static database contract đã được chạy lại và đạt. PostgreSQL live cùng device E2E chưa được chạy lại; các emulator artifact 2026-08-17 vẫn chỉ là baseline lịch sử, không phải bằng chứng native cho hardening 2026-08-24.

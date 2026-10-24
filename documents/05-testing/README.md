# 05 — Kiểm thử và bằng chứng

## Nguyên tắc đọc evidence

Mỗi báo cáo chỉ chứng minh đúng commit/build, database, environment, thiết bị và test layer được ghi trong báo cáo. Unit, HTTP integration, database disposable, emulator, thiết bị thật và staging là các mức evidence khác nhau.

Các test E2E/runner/fixture đã bị gỡ khỏi source, package scripts và CI ngày 2026-10-11. Reports E2E cũ được giữ làm lịch sử; không chạy lại hoặc mô tả như một gate đang có. Task tài liệu này không chạy test/build.

## Quality gates theo thành phần

| Thành phần | Lệnh nền tảng | Phạm vi |
| --- | --- | --- |
| Backend | npm run typecheck; npm run build; npm test; npm run test:critical; npm run validate:openapi; npm run validate:database | Type, build, unit/integration suites, critical HTTP, schema và API validation |
| Backend persistence | npm run validate:database và các test:persistence/test:relational/test:*:persistence phù hợp | Chỉ database disposable đã qua guard; không dùng banking_preview hoặc database không xác minh ownership |
| Admin Web | npm run lint; npm run typecheck; npm test; npm run build | Type, unit và bundle |
| Mobile | npm run lint; npm run typecheck; npm test; npm run validate:openapi; npm run export:web | Lint/type/unit, contract checks và web export |
| Release/security | Gate/scripts trong backend/package.json, mobile-app/package.json và documents/07-release | Public env, secret/image/release manifest, dependency audit và artifact policy phù hợp scope |

Danh sách trên là cách tổ chức gate, không phải kết quả của lượt rà soát này. Đọc package scripts hiện hành và root AGENTS.md trước khi chạy.

## Evidence hiện có trong hồ sơ

| Hồ sơ | Dùng để |
| --- | --- |
| backend-test-report.md, test-report.md | Các lượt test Backend theo snapshot cụ thể |
| device-evidence.md | Bằng chứng device/emulator đã lưu; kiểm tra build và ngày |
| staging-readiness/ | PostgreSQL, relational-v2, local hardening và cutover evidence |
| stage1-* và stage2-* | Reports theo giai đoạn lịch sử; không tự động đại diện current source |
| release-candidate/v1.0.0-thesis-rc.1/ | Release candidate snapshot cũ; không tuyên bố là artifact hiện tại |
| backup-restore/ | Rehearsal local dated; không chứng minh cloud backup/restore đang vận hành |

## Database safety

- Chỉ dùng database disposable khi test có reset/drop/truncate.
- Guard phải xác nhận environment test, host được allow và database name disposable.
- Không reset/drop/truncate banking_preview, remote DB hoặc database chưa xác minh ownership.
- Không in connection string, secrets, OTP hoặc raw credential evidence.

## Khi tạo report mới

Ghi ngày, HEAD/commit, dirty/clean state, lệnh, environment, device/build digest nếu có, số pass/fail/skip, warnings và giới hạn. Tách local, CI, emulator, device và staging. Không nâng “validator pass” thành runtime/device/staging evidence.

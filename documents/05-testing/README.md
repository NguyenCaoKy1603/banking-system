# 05 — Kiểm thử và bằng chứng

## Nguyên tắc đọc evidence

Mỗi báo cáo chỉ chứng minh đúng commit/build, database, environment, thiết bị và test layer được ghi trong báo cáo. Unit, HTTP integration, database disposable, emulator, thiết bị thật và staging là các mức evidence khác nhau.

Các test E2E/runner/fixture cũ đã bị gỡ khỏi source, package scripts và CI ngày 2026-10-11. Không dùng các kịch bản hoặc lệnh E2E cũ làm gate hiện hành.

## Quality gates theo thành phần

| Thành phần | Lệnh nền tảng | Phạm vi |
| --- | --- | --- |
| Backend | npm run typecheck; npm run build; npm test; npm run test:critical; npm run validate:openapi; npm run validate:database | Type, build, unit/integration suites, critical HTTP, schema và API validation |
| Backend persistence | npm run validate:database và các test:persistence/test:relational/test:*:persistence phù hợp | Chỉ database disposable đã qua guard; không dùng banking_preview hoặc database không xác minh ownership |
| Admin Web | npm run lint; npm run typecheck; npm test; npm run build | Type, unit và bundle |
| Mobile | npm run lint; npm run typecheck; npm test; npm run validate:openapi; npm run export:web | Lint/type/unit, contract checks và web export |
| Release/security | Gate/scripts trong backend/package.json, mobile-app/package.json và documents/07-release | Public env, secret/image/release manifest, dependency audit và artifact policy phù hợp scope |

Danh sách trên là cách tổ chức gate, không phải kết quả của lượt rà soát này. Đọc package scripts hiện hành và root AGENTS.md trước khi chạy.

## Hướng dẫn kiểm thử hiện có

| Tài liệu | Dùng để |
| --- | --- |
| [mfa-runbook.md](mfa-runbook.md) | Hướng dẫn kiểm thử luồng xác thực đa yếu tố (MFA / TOTP) |

## Database safety

- Chỉ dùng database disposable khi test có reset/drop/truncate.
- Guard phải xác nhận environment test, host được allow và database name disposable.
- Không reset/drop/truncate banking_preview, remote DB hoặc database chưa xác minh ownership.
- Không in connection string, secrets, OTP hoặc raw credential evidence.

## Khi tạo report mới

Ghi ngày, HEAD/commit, dirty/clean state, lệnh, environment, device/build digest nếu có, số pass/fail/skip, warnings và giới hạn. Tách local, CI, emulator, device và staging. Không nâng “validator pass” thành runtime/device/staging evidence.

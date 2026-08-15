# Mobile preview release note — template

Trạng thái: **BLOCKED until APK/device gates are complete**
Version: `1.0.0-preview.1`
Package: `com.example.digitalbanking.mobile`
Profile: `preview`
API environment: `preview` / HTTPS URL approved by owner

## Included scope

- M0–M4 và M8 reference flow.
- Card mock bonus: list/detail, lock/unlock, controlled visibility, simulated PIN change.
- Backend reference sandbox và E2E seed; không phải production money movement.

## Artifact evidence

| Trường | Giá trị |
| --- | --- |
| APK path | `TO_BE_FILLED` |
| SHA-256 | `TO_BE_GENERATED` |
| Built commit | `TO_BE_FILLED` |
| API URL | `TO_BE_FILLED` |
| Device report | [`../05-testing/device-evidence.md`](../05-testing/device-evidence.md) |
| Test report | [`../05-testing/test-report.md`](../05-testing/test-report.md) |

## Release gates

- [ ] `npm run validate:release`
- [ ] APK built from a clean reviewed checkpoint.
- [ ] Install on a second Android environment and record checksum.
- [ ] Run Maestro P0 flows, transfer double-submit, kill/resume and pending recovery.
- [ ] Verify real camera/biometric permission and lifecycle behavior.
- [ ] Dependency High/Critical finding resolved or formally approved with expiry.
- [ ] Staging/core/partner and legal/compliance approvals attached.

Do not distribute this note as a release approval while any item is unchecked.

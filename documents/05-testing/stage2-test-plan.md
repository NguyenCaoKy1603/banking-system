# Giai đoạn 2 — Test plan và quality evidence

Ngày tạo: 2026-08-24  
Owner local run: Codex  
Owner remote/device/cloud: maintainer chưa chỉ định  
Build ID: `stage2-20260824-df1f40b`

## Baseline khóa

- Branch: `codex/stage2-quality-evidence`
- Baseline commit: `df1f40bccbf8e1a3604101f6f23987f92480df54`
- Backend local image ID: `sha256:ad1f30ee6f81cc98322f541af5e6904cf1d90a9e9a8877471ea504a8aa6a39b3`
- Backend runtime: Node `v22.23.2`, user `node`, UID 1000
- Host toolchain: Node `v24.19.0`, npm `11.17.0`
- PostgreSQL: `16.11` trong Compose local
- Mobile package: Expo `~57.0.12`, React Native `0.86.2`, version `1.0.0`
- Maestro CLI: chưa cài trong workspace; chỉ chạy được validator tĩnh
- API local: `http://127.0.0.1:5000/api/v1`
- APK/checksum/thiết bị thật: chưa có artifact mới cho baseline này

Không dùng evidence ngày 17/08 để kết luận cho build Stage 2. Những artifact lịch sử chỉ được liên kết để truy vết và ghi rõ phạm vi.

## Ma trận kiểm thử

| Requirement | Test case | Môi trường | Người thực hiện | Kết quả | Artifact | Defect/commit |
| --- | --- | --- | --- | --- | --- | --- |
| Migration và schema | DB rỗng, chạy migration hai lần, validate 28 bảng | Docker PostgreSQL 16 | Codex | Đạt local | `stage2-functional-report.md` | — |
| Backend correctness | typecheck/build/full/critical/relational | Docker PostgreSQL disposable | Codex | Đạt local | `stage2-functional-report.md` | — |
| Fraud persistence/authorization | idempotency, restart, user isolation, concurrent request | PostgreSQL persistent | Codex | Đạt local — regression trong full suite | `stage2-functional-report.md` | — |
| Credit/Savings/Transfer integrity | concurrent submit, replay, reconciliation | PostgreSQL persistent | Codex | Baseline có; chạy lại Stage 2 | test + report | — |
| Contract | request/response/error/unknown route/malformed payload | Backend HTTP | Codex | Baseline 46 path/51 guards; bổ sung runtime checks | `stage2-contract-report.md` | — |
| Security | auth/session/IDOR/input/log/secret/container | Local sandbox | Codex | Đạt local; remote/APK scan chờ | `stage2-security-verification.md` | — |
| Performance smoke | health/read/account/history + transfer integrity concurrency | Docker local, DB riêng | Codex | Integrity đạt; transfer threshold chưa ổn định | `stage2-performance-report.md` | D2-004 |
| Mobile quality | lint/typecheck/unit/coverage/export/audit | Local worktree | Codex | Đạt local | `stage2-mobile-report.md` | — |
| Accessibility | static Pressable/label/state scan | Mobile source | Codex | Static đạt; device/TalkBack chờ | `stage2-accessibility-report.md` | D2-003 |
| Physical E2E | TalkBack, camera, biometric, lifecycle, fault injection | Android thật + HTTPS | Maintainer/device owner | Chưa thực hiện | — | — |
| Usability | 5 người dùng ẩn danh, retest 2 người | Staging APK | Product/UX owner | Chưa thực hiện | `stage2-usability-report.md` | — |

## Quy tắc dữ liệu và evidence

- Chỉ dùng user/database giả lập; performance dùng database riêng.
- Mỗi test run dùng suffix ngẫu nhiên; không ghi password, OTP, token, PIN, CVV, số tài khoản đầy đủ hoặc raw request body.
- Report chỉ ghi status, count, latency percentile và ID đã redaction.
- Mọi evidence phải ghi commit/build ID; cloud/device evidence không được suy ra từ local.

## CI đã chuẩn bị

- Backend quality workflow chạy migration hai lần, schema/OpenAPI/typecheck/build/full/critical/relational/audit.
- Mobile quality workflow giữ lint/typecheck/unit/coverage/contract/E2E syntax/release/export/audit và upload coverage artifact.
- Preview container workflow chạy thêm performance/integrity smoke 20 read iterations + 20 transfer replay, secret-canary log scan và upload JSON đã sanitize.
- Performance smoke giữ ngưỡng transfer p95 `<700 ms`; do D2-004 đang mở, remote run có thể fail và phải được triage, không được dùng `continue-on-error` để che kết quả.
- Full load/spike/soak, SBOM/container registry scan, Maestro device run và physical-device evidence vẫn là manual/scheduled work chờ môi trường cloud/thiết bị.

## Exit gate

Đóng Stage 2 chỉ khi không còn P0/P1, backend/mobile remote audit không có High/Critical, PostgreSQL không skip, không double-debit, reconciliation bằng 0 trước/sau load, performance threshold đạt, critical E2E pass ba lượt, có Android thật/TalkBack/usability report và mọi artifact gắn commit + APK checksum. Các giới hạn iOS/provider thật phải được ghi rõ.

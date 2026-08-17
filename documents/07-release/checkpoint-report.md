# Working-tree checkpoint report

> Cập nhật hiện hành 2026-08-17: branch thực tế là `codex/mini-core-banking-sandbox`; code commit `08e8d33`, documentation/evidence commit `d5fe672`. Backend đạt 68/68 test với PostgreSQL, relational regression 1/1, Mobile 36 suite/167 test, coverage đạt, web export 33 route; M0–M4/M8 và transfer pending-resume đã có evidence emulator. Manifest bàn giao nằm tại [`handoff-manifest-2026-08-17.json`](../05-testing/handoff-manifest-2026-08-17.json).

Ngày ghi nhận: 2026-08-16
Nhánh: `feature/mobile-authentication`
Implementation/evidence checkpoint: `079e9d2` (`Verify M6 M7 native flows and account reveal`); implementation hardening `0f06b77`; previous verification `2af2f2f` (`Expand credit date boundary regression coverage`)

## Trạng thái

**ĐÃ TẠO checkpoint Git sạch.** Backend, workflow, contract, lockfile, Mobile, Maestro flow và tài liệu triển khai đã được commit. `artifacts/`, native generated folder và `.env` local bị loại khỏi commit. Core M0–M4/M8 persistence dùng relational reference adapter; auth runtime/M6/M7 vẫn được ghi nhận là reference-level.

Quality gate hiện tại: backend 68/68 test với PostgreSQL 16, relational regression 1/1, critical HTTP 8/8, database/OpenAPI validator đạt; Mobile lint/typecheck, 36 suite/167 test, OpenAPI 36 path, 9 Maestro flow syntax và web export 33 route đạt. APK release local SHA-256 đã được ghi trong manifest; Maestro emulator evidence gồm M0–M4/M8, M6 Savings, Credit payment/resume, card lock/unlock và overdue notification. Đây vẫn là reference sandbox, chưa phải release production.

## Việc cần làm sau checkpoint

1. Owner review commit mới nhất của phiên này và quyết định có push/PR hay không.
2. Gắn checksum APK và commit hash vào release manifest khi có release candidate được phê duyệt; bản APK sandbox local hiện đã có checksum trong device evidence.
3. Chỉ mở preview/pilot sau khi xử lý dependency High, thiết bị thật, staging, signing và legal/compliance.

APK sandbox local đã được build sau các thay đổi state migration, policy unlock, payment review/error mapping và M6 keyboard-submit fix; bản này chưa phải release candidate đã ký và chưa được phê duyệt cho pilot/production.

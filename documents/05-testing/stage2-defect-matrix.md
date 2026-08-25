# Giai đoạn 2 — Defect matrix

Ngày tạo: 2026-08-24  
Owner triage: maintainer chưa chỉ định

| ID | Severity | Phạm vi | Bước tái hiện | Kỳ vọng | Thực tế | Môi trường | Regression | Commit sửa | Owner | Deadline | Retest |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D2-001 | P1 | Persistent MFA challenge | Restart backend rồi verify challenge trong PostgreSQL bằng TOTP fixture | Challenge/credential vẫn bind đúng và mã không lộ qua API | Đã chuyển sang `mfa_credentials` + `auth_challenges` với TOTP, row lock và replay guard; không còn endpoint đọc mã | Docker/PostgreSQL | Persistent MFA integration tests | working tree | Maintainer | Đã xử lý | Đạt ở local; remote CI chờ maintainer |
| D2-002 | P1 | Cloud CI | Mở PR và chạy workflow container/security gates | Remote checks xanh | Chưa có remote run trong workspace | GitHub | Chờ maintainer mở PR | — | Maintainer | Trước đóng Stage 2 | Chưa retest |
| D2-003 | P1 | Physical device | Clean install APK, HTTPS, TalkBack/camera/biometric/lifecycle | Có evidence thiết bị thật | Chưa có APK staging/device/provider | Android thật | Chưa có | — | Device owner | Trước đóng Stage 2 | Chưa retest |
| D2-004 | P2 | Performance | Chạy 20 request transfer đồng thời và read smoke | Threshold p95/p99 đạt | Integrity đạt nhưng transfer p95 588,91 ms ở run 1, 773,61 ms ở run 2 và 1.048,18 ms ở run 3; hai lượt vượt 700 ms | Docker local, database riêng; cloud staging chưa có | `performance/node/stage2-smoke.cjs` + `stage2-performance-report.md` | — | Maintainer | Trước chốt SLO Stage 2 | Mở, cần tối ưu và chạy lại |

Không được đóng defect chỉ vì một lần không tái hiện; defect P0/P1 phải có regression và retest ghi commit/build cụ thể.

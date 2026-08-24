# Giai đoạn 2 — Security verification

Báo cáo kiểm thử chi tiết nằm tại [`documents/05-testing/stage2-security-verification.md`](../05-testing/stage2-security-verification.md). File này là điểm neo trong thư mục security theo kế hoạch Stage 2.

Trạng thái ngày 2026-08-24: các kiểm tra auth/session, authorization/IDOR, input/routing, redaction, financial integrity, local dependency audit, runtime canary và non-root container đạt local. Remote CI, SBOM/container scan, APK/native scan, staging TLS và physical-device MASTG/TalkBack vẫn chờ maintainer/device owner; vì vậy chưa phải security sign-off hay production readiness.

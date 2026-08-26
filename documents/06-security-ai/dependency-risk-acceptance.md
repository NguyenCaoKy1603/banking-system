# Dependency risk acceptance — Mobile preview

Ngày kiểm tra: 2026-08-24
Trạng thái: **Đã xử lý cục bộ — chờ remote CI và review bảo mật**

## Finding

Lượt CI trước báo các cảnh báo High liên quan đến `image-size`, đi qua Metro/Expo. Advisory mô tả khả năng denial of service trong parser ICNS/JXL/HEIF. Đây là dependency gián tiếp của toolchain build, không phải module nghiệp vụ được gọi trực tiếp trong runtime Mobile.

Đã chạy `npm audit fix` không dùng `--force`, cập nhật `@expo/metro` lên `56.0.2` và khóa toàn bộ Metro ở `0.84.5` trong `mobile-app/package.json`/`package-lock.json`. Kết quả `npm audit --omit=dev --audit-level=high` local là 0 vulnerability; không đổi major Expo/React Native. Override `image-size` 2.x trước đó làm hỏng web export và không được giữ lại.

## Quyết định tạm thời

- Chỉ coi audit là xanh ở worktree sau khi remote CI xác nhận; không tuyên bố preview/pilot production-ready chỉ dựa trên audit local.
- Giữ `npm audit --omit=dev --audit-level=high` là release gate trong CI.
- Chỉ cho phép build nội bộ/reference để kiểm thử, với URL/API và dữ liệu sandbox.
- Cần Engineering + Security review bản override và kết quả remote CI; trước khi phát hành APK vẫn cần device matrix, staging, monitoring, risk owner/expiry và phê duyệt upstream compatibility.
- Stage 2 local verification được tổng hợp tại [`stage2-security-verification.md`](stage2-security-verification.md); tài liệu này không thay thế remote scan hoặc security reviewer sign-off.

## Mitigation và điều kiện đóng

1. Theo dõi bản vá chính thức trong Expo/Metro và thử lại khi Expo/RN nâng phiên bản.
2. Đã chạy lại lint, typecheck, test, coverage, OpenAPI, E2E syntax, release config và web export sau khi cập nhật lockfile.
3. Kiểm tra lại native build, camera, biometric, background/resume và transfer retry trên thiết bị.
4. Cập nhật lockfile, advisory reference, owner, expiry và kết quả remote regression trong tài liệu này.

Owner/approver/expiry: **chưa được chỉ định**. Audit local không còn blocker trực tiếp, nhưng M10/M11 vẫn mở cho remote CI, device, staging và phê duyệt release.

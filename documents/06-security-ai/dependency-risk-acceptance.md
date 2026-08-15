# Dependency risk acceptance — Mobile preview

Ngày kiểm tra: 2026-08-15
Trạng thái: **BLOCKED — chờ phê duyệt rủi ro**

## Finding

`npm audit --omit=dev --audit-level=high` trong `mobile-app/` vẫn trả về 14 cảnh báo High liên quan đến `image-size`, đi qua Metro/Expo. Advisory mô tả khả năng denial of service trong parser ICNS/JXL/HEIF. Đây là dependency gián tiếp của toolchain build, không phải module nghiệp vụ được gọi trực tiếp trong runtime Mobile.

Lệnh `npm audit fix --force` đề xuất thay đổi breaking sang React Native/Expo khác major nên không được chạy trong task này. Override `image-size` 2.x trước đó làm hỏng web export và không được giữ lại.

## Quyết định tạm thời

- Không coi CI audit là xanh và không tuyên bố preview/pilot production-ready.
- Giữ `npm audit --omit=dev --audit-level=high` là release gate trong CI.
- Chỉ cho phép build nội bộ/reference để kiểm thử, với URL/API và dữ liệu sandbox.
- Cần một approver của Engineering + Security ghi nhận risk owner, phạm vi chấp nhận, ngày hết hạn và phương án upstream upgrade trước khi phát hành APK cho người dùng.

## Mitigation và điều kiện đóng

1. Theo dõi bản vá chính thức trong Expo/Metro và thử trên nhánh riêng.
2. Chạy lại lint, typecheck, test, coverage, OpenAPI, E2E syntax và web export sau khi nâng cấp.
3. Kiểm tra lại native build, camera, biometric, background/resume và transfer retry trên thiết bị.
4. Cập nhật lockfile, advisory reference, owner, expiry và kết quả regression trong tài liệu này.

Owner/approver/expiry: **chưa được chỉ định**. Vì vậy finding này vẫn là blocker của M10/M11.

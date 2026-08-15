# Decision log

| Ngày | Mã | Quyết định / trạng thái | Lý do | Ảnh hưởng | Người xác nhận |
| --- | --- | --- | --- | --- | --- |
| 2026-08-14 | D-01 | Dùng React Native + TypeScript trên Expo cho Mobile | Tận dụng React, type/logic dùng chung, hỗ trợ Android APK và iOS | `mobile-app/`, test/build scripts | Cần nhóm xác nhận khi chốt phát hành |
| 2026-08-14 | D-02 | Tổ chức feature-based; server là nguồn sự thật | Giảm coupling và tránh Mobile tự quyết định số dư/phí/trạng thái | `mobile-app/src/features/`, API contracts | Đã áp dụng ở reference |
| 2026-08-14 | D-03 | Banking accounts/transfers API và OpenAPI hiện là Draft; Auth v1 là contract nội bộ ổn định | Chưa có partner/core/legal phê duyệt production | Không dùng reference backend cho tiền thật | Cần Backend/Identity/partner/legal |
| 2026-08-14 | D-04 | `backend/` là reference sandbox, không phải production NestJS/PostgreSQL | Cho phép kiểm thử HTTP, idempotency, ledger invariant khi chưa có môi trường thật | Test local/CI; không tuyên bố pilot ready | Cần Thành viên 1 xác nhận boundary |
| 2026-08-14 | D-05 | eKYC/QR/beneficiary và Card hiện chỉ ở mức mô phỏng/reference; chưa giả định Card/Savings/Credit/Chatbot production | Các module production cần API, policy, test data và owner được duyệt | M2/M4 và Card mock có local evidence; production module vẫn mở | Cần Backend/partner/legal xác nhận |
| 2026-08-14 | D-06 | Không ép `npm audit fix --force` để vượt finding Metro/`image-size` | Có nguy cơ breaking Expo/React Native và làm hỏng export | M10/M11 vẫn bị chặn bởi audit gate | Cần upstream patch hoặc phê duyệt nâng cấp |
| 2026-08-15 | D-07 | Ưu tiên đóng bằng chứng M0–M4/M8 và APK/device gate; Card chỉ là mock bonus; chưa mở rộng Savings/Credit/Chatbot | Bản audit xác định thiếu bằng chứng chạy thật là điểm yếu lớn nhất | Giảm scope code mới, tập trung seed/E2E/release evidence | Owner cần xác nhận scope trước M6/M7/M9 |
| 2026-08-15 | D-08 | Seed E2E không in password/OTP; chỉ xuất ID, QR payload và trạng thái | Không để secret test xuất hiện trong log/evidence | Người chạy tự cấp secret qua environment | Đã áp dụng trong `backend/scripts/seed-e2e.ts` |
| 2026-08-15 | D-09 | Persistent sandbox dùng PostgreSQL snapshot adapter riêng; chưa coi JSON snapshot là production repository | Cho phép kiểm chứng restart/locking/transaction khi chưa wire toàn bộ domain vào bảng relational | Có thể chạy CI PostgreSQL; production vẫn phải thay bằng repository theo bảng nghiệp vụ | Chờ Backend/partner/security review trước tiền thật |

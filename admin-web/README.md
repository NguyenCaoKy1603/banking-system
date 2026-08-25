# Banking Admin Web

React + TypeScript + Vite desktop-first control plane cho reference sandbox. Session token chỉ nằm trong HttpOnly cookie do Admin API cấp; CSRF token chỉ được gửi qua header và không lưu localStorage.

```powershell
cd C:\Projects\banking-system\admin-web
npm install
$env:VITE_ADMIN_API_URL = "http://127.0.0.1:5001/api/v1"
npm run dev
```

Các màn hình P0 gồm Login/MFA, dashboard, Approval Inbox (maker/fingerprint/approve/reject/step-up), customer/account masked read và yêu cầu lock/block/funding/reversal, KYC/Credit review, pending transfer operations, fraud triage/resolution, Outbox/job retry, Staff/Roles và Audit explorer. UI chỉ tạo typed four-eyes request; server mới quyết định quyền, version, trạng thái và mutation.

Kiểm tra local:

```powershell
npm run lint
npm test
npm run build
npm run audit

# Browser E2E cần backend đã build; fixture dùng dữ liệu synthetic và Admin API in-memory.
cd ..\backend
npm run build
cd ..\admin-web
npx playwright install chromium
npm run test:e2e
```

Đây là control plane của reference sandbox, không phải production-ready và không kết nối tiền thật, payment rail thật hoặc KYC thật.

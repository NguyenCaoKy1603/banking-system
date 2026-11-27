# DRAFT v2 — Reference Auth API Contract

> **Trạng thái:** DRAFT v2 cho reference sandbox; thay thế state machine đăng ký trực tiếp của v1 trong workspace này.
>
> Registration reference dùng OTP hai bước để tạo dữ liệu demo, không phải account-opening/eKYC production. Mọi thay đổi cần Mobile, Backend, Identity và legal/compliance thống nhất.

## 1. Base URL và quy ước

- Android Emulator: `http://10.0.2.2:5000/api/v1`.
- Production bắt buộc sử dụng HTTPS.
- Request và response có body sử dụng `Content-Type: application/json`.
- Client gửi `Accept: application/json`.
- Client gửi `X-Device-ID` là installation ID đã lưu trong SecureStore; backend dùng ID này cho device binding.
- Không ghi password, access token hoặc refresh token vào log, analytics, crash report hay tracing payload.
- `createdAt` sử dụng chuỗi thời gian ISO 8601 UTC.

## 2. Error schema chung

Mọi response lỗi JSON sử dụng schema:

```ts
type ApiErrorPayload = {
  code: string;
  message: string;
  fieldErrors: Record<string, string> | null;
  traceId: string;
};
```

```json
{
  "code": "ERROR_CODE",
  "message": "Mô tả lỗi",
  "fieldErrors": null,
  "traceId": "trace-id"
}
```

`fieldErrors` chứa lỗi theo field khi có; nếu lỗi không gắn với field cụ thể thì giá trị là `null`.

## 3. POST `/auth/register`

URL hoàn chỉnh trên Android Emulator:

```text
http://10.0.2.2:5000/api/v1/auth/register
```

### Mục đích

Bắt đầu đăng ký reference và bind một challenge OTP với đúng snapshot thông tin đã gửi. Bước này chưa tạo user, chưa tạo payment account, không tự đăng nhập và không trả token.

### Request body

```ts
type RegisterRequest = {
  fullName: string;
  email: string;
  phoneNumber: string;
  password: string;
};
```

```json
{
  "fullName": "string",
  "email": "string",
  "phoneNumber": "string",
  "password": "string"
}
```

`confirmPassword` chỉ thuộc form Mobile và không được gửi lên API.

### Success response — `202 Accepted`

```ts
type AuthChallengeResponse = {
  challengeId: string;
  expiresAt: string;
  methods: Array<"EMAIL_OTP">;
  method: "EMAIL_OTP";
  purpose: "REGISTRATION_EMAIL_VERIFY";
  resendAfter: string;
  maskedDestination: string;
};
```

Mobile phải khóa các trường đăng ký sau khi nhận challenge. Nếu người dùng muốn sửa dữ liệu, client phải bỏ challenge cũ và gọi lại `/auth/register`; không được hiển thị dữ liệu mới rồi verify challenge đã bind với dữ liệu cũ.

### POST `/auth/register/verify`

Client gửi `X-Device-ID` giống bước bắt đầu và body:

```ts
type VerifyRegistrationRequest = {
  challengeId: string;
  method: "EMAIL_OTP";
  proof: string;
};
```

Chỉ khi challenge còn hạn, đúng device/purpose và proof hợp lệ, server mới tạo user cùng một payment account reference số dư `0 VND`, rồi trả `201 Created`:

```ts
type AuthUser = {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  createdAt: string;
};

type RegisterResponse = {
  user: AuthUser;
};
```

```json
{
  "user": {
    "id": "string",
    "fullName": "string",
    "email": "string",
    "phoneNumber": "string",
    "createdAt": "ISO 8601 UTC string"
  }
}
```

### HTTP status

- `202 Accepted`: challenge đăng ký đã được tạo, chưa có user/account.
- `201 Created` trên `/auth/register/verify`: verify thành công và user/account reference được tạo đúng một lần.
- `400 Bad Request`: request body không đọc được.
- `409 Conflict`: email hoặc số điện thoại đã tồn tại.
- `422 Unprocessable Entity`: validation không đạt.
- `429 Too Many Requests`: vượt rate limit.
- `500 Internal Server Error`: lỗi ngoài dự kiến.

### Gửi lại OTP đăng ký — `POST /auth/challenges/{challengeId}/resend`

Đây là endpoint **pre-authentication** chỉ dành cho challenge `REGISTRATION_EMAIL_VERIFY`.
Client gửi `X-Device-ID` giống bước đăng ký và body JSON rỗng `{}`. Server tự tra email từ
pending registration; client không được gửi hoặc thay đổi địa chỉ nhận. Challenge cũ bị hủy,
challenge mới được tạo với OTP mới, cooldown tối thiểu 60 giây và giới hạn tối đa 3 lần trong
10 phút. Response `200 OK` có `challengeId`, `method: "EMAIL_OTP"`, `methods: ["EMAIL_OTP"]`,
`expiresAt`, `resendAfter` và `maskedDestination`; không có plaintext OTP.

## 4. POST `/auth/login`

URL hoàn chỉnh trên Android Emulator:

```text
http://10.0.2.2:5000/api/v1/auth/login
```

### Mục đích

Xác thực bằng email và password, sau đó trả phiên đăng nhập cùng thông tin người dùng. Đây là
luồng password-only: login không gửi OTP/TOTP, không tạo challenge và không có bước xác thực bổ sung.

### Request body

```ts
type LoginRequest = {
  email: string;
  password: string;
};
```

```json
{
  "email": "string",
  "password": "string"
}
```

### Success response — `200 OK`

```ts
type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: AuthUser;
};
```

```json
{
  "accessToken": "string",
  "refreshToken": "string",
  "expiresInSeconds": 900,
  "user": {
    "id": "string",
    "fullName": "string",
    "email": "string",
    "phoneNumber": "string",
    "createdAt": "ISO 8601 UTC string"
  }
}
```

### HTTP status

- `200 OK`: đăng nhập thành công.
- `400 Bad Request`: request body không đọc được.
- `401 Unauthorized`: thông tin đăng nhập không hợp lệ.
- `422 Unprocessable Entity`: validation không đạt.
- `429 Too Many Requests`: vượt rate limit.
- `500 Internal Server Error`: lỗi ngoài dự kiến.

`POST /auth/verify` không thuộc login password-only của relational-v2. Endpoint chỉ được giữ cho
backward compatibility của reference sandbox; các OTP/TOTP challenge còn lại là step-up cho giao
dịch hoặc thao tác bảo mật sau khi đã đăng nhập.

### 4.1 Đăng nhập nhanh bằng Sinh trắc học / Mã PIN thiết bị (DRAFT Reference Extension)

Khi thiết bị đã kích hoạt khóa `BIOMETRIC` (qua `POST /auth/mfa/biometric/enroll` sau đăng nhập), Mobile lưu `biometricSecret` gắn thiết bị và thông tin gợi ý tài khoản gần nhất (`userId`, `email`, `fullName`) trong `SecureStore` (**tuyệt đối không lưu mật khẩu**). Ở màn hình Đăng nhập, luồng đăng nhập nhanh gồm 2 bước pre-auth:

1. **`POST /auth/mfa/biometric/login/challenge`** (yêu cầu header `X-Device-ID` và body `{ "email": "string" }`):
   - Kiểm tra tài khoản không bị khóa (`LOCKED`) và có khóa `BIOMETRIC` đang `ACTIVE` khớp `(customerId, deviceId)`.
   - Trả `200 OK` với `AuthChallengeResponse` (`purpose: "LOGIN"`, `method: "BIOMETRIC"`).
2. **`POST /auth/mfa/biometric/login/verify`** (yêu cầu header `X-Device-ID`, `X-Device-Name` tùy chọn, và body `{ "challengeId": "string", "proof": "biometric-v1.<sha256>" }`):
   - Sau khi OS xác thực người dùng thành công (Vân tay, Face ID/Face Unlock, hoặc Mã PIN khóa màn hình `SecurityLevel.SECRET`), Mobile ký SHA-256 theo ngữ cảnh `(biometricSecret, challengeId, deviceId, "LOGIN")`.
   - Server giải mã khóa tương ứng, kiểm chứng chữ ký hằng thời gian, tiêu thụ challenge một lần và trả `200 OK` với `LoginResponse` mới.

## 5. Bảo mật và phạm vi Mobile

- Production chỉ gọi API qua HTTPS.
- Password và token không được ghi log.
- Mobile lưu access token, refresh token và metadata session trong một bản ghi SecureStore nguyên tử trên thiết bị.
- Mobile gửi access token qua `Authorization: Bearer <token>` cho các API cần xác thực.
- Mobile gửi `X-Device-ID` để backend thực thi device binding; ID không phải secret và không thay thế authorization.
- Session restoration và local logout đã thuộc foundation mobile; reference backend đã có server-side revoke và refresh rotation để kiểm chứng contract. Việc bật trên môi trường tiền thật vẫn cần Identity/Backend và legal/compliance phê duyệt.

## 6. Quản lý mật khẩu, Thiết bị & Sinh trắc học gắn thiết bị (DRAFT)

Các endpoint mở rộng bên dưới đã có reference implementation trong `backend/src/routes/authRoutes.ts` và khai báo trong [`banking-mvp.openapi.yaml`](./banking-mvp.openapi.yaml), vẫn giữ trạng thái DRAFT:

### 6.1 Đổi mật khẩu — `POST /auth/password/change` (Authenticated)
- Yêu cầu `Authorization: Bearer <accessToken>` và `X-Device-ID`.
- Body: `{ currentPassword, newPassword (12–128 ký tự), stepUp?: { method: "TOTP" | "BIOMETRIC", challengeId, proof } }` (khi tài khoản có TOTP `ACTIVE`, bắt buộc xác thực step-up purpose `PASSWORD_CHANGE`).
- Response `200 OK`: `{ status: "PASSWORD_CHANGED", sessionsRevoked: true }`. Toàn bộ phiên đăng nhập hiện có bị thu hồi.

### 6.2 Quên & Đặt lại mật khẩu — `POST /auth/password/forgot` và `POST /auth/password/reset` (Pre-auth)
- Bắt buộc header `X-Device-ID`, không cần Bearer token.
- `POST /auth/password/forgot` nhận `{ email }` và trả `202 Accepted` với `AuthChallengeResponse` (purpose `PASSWORD_RESET`) mà không tiết lộ sự tồn tại của tài khoản.
- `POST /auth/password/reset` nhận `{ challengeId, proof, newPassword (12–128 ký tự) }` và trả `200 OK` `{ status: "PASSWORD_RESET", sessionsRevoked: true }`.

### 6.3 Quản lý thiết bị đăng nhập — `GET /auth/devices` và `DELETE /auth/devices/{deviceId}` (Authenticated)
- `GET /auth/devices` trả `{ items: CustomerDevice[] }` sắp xếp thiết bị hiện tại lên đầu (`id`, `deviceId`, `deviceName`, `attestationStatus`, `isCurrentDevice`, `lastSeenAt`, `createdAt`, `activeSessionCount`).
- `DELETE /auth/devices/{deviceId}` thu hồi thiết bị và toàn bộ phiên gắn với thiết bị đó, trả `204 No Content`.

### 6.4 Đăng ký sinh trắc học gắn thiết bị — `POST /auth/mfa/biometric/enroll` (Authenticated)
- Yêu cầu `Authorization: Bearer <accessToken>` và `X-Device-ID`.
- Body: `{ password, displayName?, challengeId?, code? }`.
- Response `201 Created`: `{ credentialId, credentialType: "BIOMETRIC", deviceId, displayName, status: "ACTIVE", biometricSecret, enrolledAt }`.
- `biometricSecret` chỉ trả một lần (`writeOnly`), lưu mã hóa AES-256-GCM ở DB và SecureStore trên thiết bị để ký challenge-response `biometric-v1.<sha256>` (không ghi log).

## 7. Session extension và trạng thái phê duyệt

Các endpoint session mở rộng đã có reference implementation và mobile integration. Contract chi tiết vẫn ở trạng thái DRAFT cho đến khi Backend/Identity và legal/compliance phê duyệt môi trường tiền thật, xem [auth-session-api-contract.md](./auth-session-api-contract.md):

- `POST /auth/refresh` — refresh rotation và phát hiện reuse.
- `POST /auth/logout` — revoke phiên hiện tại.
- `POST /auth/logout-all` — revoke mọi phiên của user.
- `POST /auth/verify` — endpoint tương thích lịch sử, không được gọi trong login relational-v2.
- `GET /users/me` chưa thuộc scope MVP hiện tại.

OpenAPI draft accounts/transfers trong [`banking-mvp.openapi.yaml`](./banking-mvp.openapi.yaml) phải được partner phê duyệt trước pilot dùng tiền thật.

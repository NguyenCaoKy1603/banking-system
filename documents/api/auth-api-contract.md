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
  methods: Array<"OTP">;
  purpose: "REGISTRATION_VERIFY";
};
```

Mobile phải khóa các trường đăng ký sau khi nhận challenge. Nếu người dùng muốn sửa dữ liệu, client phải bỏ challenge cũ và gọi lại `/auth/register`; không được hiển thị dữ liệu mới rồi verify challenge đã bind với dữ liệu cũ.

### POST `/auth/register/verify`

Client gửi `X-Device-ID` giống bước bắt đầu và body:

```ts
type VerifyRegistrationRequest = {
  challengeId: string;
  method: "OTP";
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

## 4. POST `/auth/login`

URL hoàn chỉnh trên Android Emulator:

```text
http://10.0.2.2:5000/api/v1/auth/login
```

### Mục đích

Xác thực bằng email và password, sau đó trả phiên đăng nhập cùng thông tin người dùng.

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
- `202 Accepted`: password đúng nhưng server/risk policy yêu cầu thêm MFA; response chứa `challengeId`, `expiresAt`, `methods` và không chứa token.
- `400 Bad Request`: request body không đọc được.
- `401 Unauthorized`: thông tin đăng nhập không hợp lệ.
- `422 Unprocessable Entity`: validation không đạt.
- `429 Too Many Requests`: vượt rate limit.
- `500 Internal Server Error`: lỗi ngoài dự kiến.

### MFA challenge — `POST /auth/verify`

Khi login trả `202`, client gửi `X-Device-ID` và request sau để hoàn tất authentication:

```ts
type AuthChallengeResponse = {
  challengeId: string;
  expiresAt: string;
  methods: Array<"OTP" | "BIOMETRIC">;
  purpose: "LOGIN";
};
```

Login `202 Accepted` chỉ trả challenge response và không trả token.

```ts
type VerifyAuthChallengeRequest = {
  challengeId: string;
  method: "OTP" | "BIOMETRIC";
  proof: string; // opaque provider assertion; không log
};
```

`200 OK` trả `LoginResponse`. Challenge phải one-time, có TTL, bind purpose/resource/device và được audit ở server. Reference mặc định chỉ bật OTP. Proof sinh trắc học tĩnh bị tắt trừ khi local test bật cờ unsafe tường minh; preview/production phải dùng provider assertion ký và không được hard-code proof trong Mobile.

## 5. Bảo mật và phạm vi Mobile

- Production chỉ gọi API qua HTTPS.
- Password và token không được ghi log.
- Mobile lưu access token, refresh token và metadata session trong một bản ghi SecureStore nguyên tử trên thiết bị.
- Mobile gửi access token qua `Authorization: Bearer <token>` cho các API cần xác thực.
- Mobile gửi `X-Device-ID` để backend thực thi device binding; ID không phải secret và không thay thế authorization.
- Session restoration và local logout đã thuộc foundation mobile; reference backend đã có server-side revoke và refresh rotation để kiểm chứng contract. Việc bật trên môi trường tiền thật vẫn cần Identity/Backend và legal/compliance phê duyệt.

## 6. Session extension và trạng thái phê duyệt

Các endpoint session mở rộng đã có reference implementation và mobile integration. Contract chi tiết vẫn ở trạng thái DRAFT cho đến khi Backend/Identity và legal/compliance phê duyệt môi trường tiền thật, xem [auth-session-api-contract.md](./auth-session-api-contract.md):

- `POST /auth/refresh` — refresh rotation và phát hiện reuse.
- `POST /auth/logout` — revoke phiên hiện tại.
- `POST /auth/logout-all` — revoke mọi phiên của user.
- `POST /auth/verify` — hoàn tất MFA challenge OTP/biometric.
- `GET /users/me` chưa thuộc scope MVP hiện tại.

OpenAPI draft accounts/transfers trong [`banking-mvp.openapi.yaml`](./banking-mvp.openapi.yaml) phải được partner phê duyệt trước pilot dùng tiền thật.

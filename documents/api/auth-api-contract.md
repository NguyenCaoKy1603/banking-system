# APPROVED v1 — Auth API Contract

> **Trạng thái:** APPROVED v1.
>
> Contract này chốt phạm vi đăng ký và đăng nhập cho checkpoint Auth API client foundation. Mọi thay đổi không tương thích cần được Mobile và Backend thống nhất thành phiên bản contract mới.

## 1. Base URL và quy ước

- Android Emulator: `http://10.0.2.2:5000/api/v1`.
- Production bắt buộc sử dụng HTTPS.
- Request và response có body sử dụng `Content-Type: application/json`.
- Client gửi `Accept: application/json`.
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

Tạo tài khoản mới. Đăng ký thành công không tự đăng nhập và không trả token.

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

### Success response — `201 Created`

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

- `201 Created`: đăng ký thành công.
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
  "expiresInSeconds": 0,
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

## 5. Bảo mật và phạm vi Mobile

- Production chỉ gọi API qua HTTPS.
- Password và token không được ghi log.
- Checkpoint foundation chỉ parse token từ login response; không lưu token.
- Token storage, session restoration và Authorization header chưa thuộc checkpoint này.

## 6. Checkpoint sau

Các endpoint sau chưa thuộc APPROVED v1 của checkpoint hiện tại và sẽ được chốt/triển khai sau:

- Refresh token.
- Logout.
- `GET /users/me`.

Không suy diễn request/response của các endpoint này từ phiên bản contract trước.

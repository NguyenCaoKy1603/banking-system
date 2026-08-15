# DRAFT v0.1 — Auth Session Rotation and Revoke API

> **Trạng thái:** DRAFT, cần Backend/Identity và legal/compliance phê duyệt trước khi bật trên môi trường tiền thật.
>
> Tài liệu này mở rộng [Auth API Contract v1](./auth-api-contract.md) cho refresh rotation và logout server-side. Mobile chỉ coi access token mới là hợp lệ sau khi response được runtime validation và session mới được ghi nguyên tử vào SecureStore.

## 1. POST `/auth/refresh`

Client phải gửi `X-Device-ID`, là installation ID được lưu trong SecureStore. Backend/risk engine phải bind token family với device này; token dùng trên device khác phải bị từ chối và được audit.

### Request

```ts
type RefreshTokenRequest = {
  refreshToken: string;
};
```

### Response `200 OK`

```ts
type RefreshTokenResponse = {
  accessToken: string;
  refreshToken: string; // token mới; token cũ phải bị rotate/revoke
  expiresInSeconds: number; // số dương
  user: AuthUser;
};
```

Server phải rotate refresh token, phát hiện reuse và revoke token family khi có dấu hiệu replay. Response không được chứa password, OTP, device secret hoặc dữ liệu nhạy cảm không cần thiết.

### HTTP status

- `200 OK`: refresh thành công.
- `401 Unauthorized`: refresh token hết hạn, đã revoke hoặc bị reuse.
- `429 Too Many Requests`: vượt rate limit.
- `500 Internal Server Error`: lỗi ngoài dự kiến.

## 2. POST `/auth/logout`

Client gửi cùng `X-Device-ID` đã dùng khi login. Revoke phải vô hiệu hóa cả access session và refresh-token family tương ứng.

### Request

```ts
type LogoutRequest = {
  refreshToken: string;
};
```

### Response

- `204 No Content`: revoke thành công hoặc token đã được revoke trước đó (endpoint idempotent).
- `401 Unauthorized`: token không hợp lệ; mobile vẫn phải hoàn tất local logout.

Server phải revoke refresh-token family/session tương ứng.

## 2.1 POST `/auth/logout-all`

Client gửi access token hiện tại và `X-Device-ID`. Server phải authorize người gọi, revoke mọi access session và refresh-token family thuộc user đó, đồng thời ghi audit event. Endpoint idempotent và trả `204 No Content`; mobile vẫn xóa session cục bộ nếu endpoint không truy cập được.

## 3. Quy tắc client

- Khi API trả `401`, chỉ một refresh operation được chạy tại một thời điểm; các request đồng thời dùng chung kết quả.
- Refresh thành công phải ghi access token, refresh token mới, expiry và user trong một SecureStore record.
- Refresh thất bại phải xóa session cục bộ và đưa app về trạng thái anonymous.
- Logout luôn xóa session cục bộ ngay cả khi endpoint revoke không reachable.
- Logout mọi thiết bị phải được server authorize và audit; mobile chỉ hiển thị thành công sau khi request hoàn tất, nhưng vẫn xóa local session khi mạng lỗi.
- Không log refresh token, access token, request body logout hoặc response chứa token.

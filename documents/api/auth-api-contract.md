# DRAFT — Auth API Contract

> **Trạng thái:** DRAFT — cần thành viên Backend xem xét và phê duyệt.
>
> Đây là đề xuất phối hợp Mobile/Backend, chưa phải quyết định cuối cùng và không được xem là hợp đồng ổn định trước khi Backend xác nhận.

## 1. Phạm vi và quy ước chung

- Base path đề xuất: `/api/v1`.
- Body sử dụng `Content-Type: application/json`.
- Production bắt buộc sử dụng HTTPS.
- Access token được gửi bằng header `Authorization: Bearer <access-token>`.
- Không ghi password, access token hoặc refresh token vào application log, analytics, crash report hay tracing payload.
- Mobile chưa triển khai token storage trong checkpoint này. Cơ chế lưu token an toàn phải được thống nhất trước khi tích hợp xác thực thật.
- Tên field, thời hạn token, refresh-token rotation và quy tắc thu hồi phiên vẫn cần Backend xác nhận.

## 2. Cấu trúc lỗi chuẩn

```json
{
  "code": "string",
  "message": "string",
  "fieldErrors": {
    "<fieldName>": "string"
  },
  "traceId": "string"
}
```

| Field | Kiểu | Ghi chú |
| --- | --- | --- |
| `code` | `string` | Mã lỗi ổn định để client xử lý. |
| `message` | `string` | Thông báo tổng quát, an toàn để hiển thị khi phù hợp. |
| `fieldErrors` | `Record<string, string> \| null` | Lỗi theo field; `null` nếu không gắn với field cụ thể. |
| `traceId` | `string` | Mã đối soát log, không chứa dữ liệu nhạy cảm. |

Response lỗi không được tiết lộ password, token, stack trace nội bộ hoặc chi tiết hỗ trợ dò tài khoản.

## 3. POST `/api/v1/auth/register`

### Mục đích

Tạo tài khoản sau khi dữ liệu vượt qua validation và kiểm tra nghiệp vụ của Backend.

### Request body

| Field | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `fullName` | `string` | Có | Họ tên đã trim. |
| `email` | `string` | Có | Email đã trim và chuyển lowercase. |
| `phoneNumber` | `string` | Có | Dạng chuẩn được Backend phê duyệt. |
| `password` | `string` | Có | Chỉ truyền qua HTTPS; tuyệt đối không ghi log. |

`confirmPassword` chỉ thuộc form Mobile và không được gửi trong request.

### Response body dự kiến — `201 Created`

| Field | Kiểu | Ghi chú |
| --- | --- | --- |
| `user.id` | `string` | Định danh người dùng. |
| `user.fullName` | `string` | Họ tên do Backend lưu. |
| `user.email` | `string` | Email chuẩn hóa. |
| `user.phoneNumber` | `string` | Số điện thoại chuẩn hóa. |
| `user.createdAt` | `string` | Thời gian ISO 8601. |

Response đăng ký không mặc định tạo phiên; quyết định này cần Backend xác nhận.

### HTTP status code dự kiến

- `201 Created`: tạo tài khoản thành công.
- `400 Bad Request`: body thiếu hoặc không đọc được.
- `409 Conflict`: email hoặc số điện thoại đã tồn tại.
- `422 Unprocessable Entity`: dữ liệu không đạt validation/nghiệp vụ.
- `429 Too Many Requests`: vượt giới hạn yêu cầu.
- `500 Internal Server Error`: lỗi ngoài dự kiến.

## 4. POST `/api/v1/auth/login`

### Mục đích

Xác thực bằng email và password, sau đó cấp thông tin phiên nếu hợp lệ.

### Request body

| Field | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `email` | `string` | Có | Email đã trim và chuyển lowercase. |
| `password` | `string` | Có | Không ghi log; không áp dụng lại validation độ mạnh khi đăng nhập. |

### Response body dự kiến — `200 OK`

| Field | Kiểu | Ghi chú |
| --- | --- | --- |
| `accessToken` | `string` | Token truy cập ngắn hạn. |
| `refreshToken` | `string` | Token làm mới; rotation cần Backend xác nhận. |
| `expiresInSeconds` | `number` | Thời hạn access token tính bằng giây. |
| `user.id` | `string` | Định danh người dùng. |
| `user.fullName` | `string` | Họ tên người dùng. |
| `user.email` | `string` | Email chuẩn hóa. |
| `user.phoneNumber` | `string` | Số điện thoại chuẩn hóa. |

### HTTP status code dự kiến

- `200 OK`: xác thực thành công.
- `400 Bad Request`: body thiếu hoặc không đọc được.
- `401 Unauthorized`: thông tin xác thực không hợp lệ; không tiết lộ field nào sai.
- `422 Unprocessable Entity`: dữ liệu không đúng định dạng.
- `429 Too Many Requests`: vượt giới hạn thử đăng nhập.
- `500 Internal Server Error`: lỗi ngoài dự kiến.

## 5. POST `/api/v1/auth/refresh`

### Mục đích

Cấp access token mới từ refresh token còn hiệu lực.

### Request body

| Field | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `refreshToken` | `string` | Có | Không ghi log; cách truyền cuối cùng cần Backend phê duyệt. |

### Response body dự kiến — `200 OK`

| Field | Kiểu | Ghi chú |
| --- | --- | --- |
| `accessToken` | `string` | Access token mới. |
| `refreshToken` | `string` | Refresh token mới nếu áp dụng rotation. |
| `expiresInSeconds` | `number` | Thời hạn access token mới tính bằng giây. |

### HTTP status code dự kiến

- `200 OK`: làm mới phiên thành công.
- `400 Bad Request`: thiếu refresh token.
- `401 Unauthorized`: refresh token hết hạn, bị thu hồi hoặc không hợp lệ.
- `429 Too Many Requests`: vượt giới hạn yêu cầu.
- `500 Internal Server Error`: lỗi ngoài dự kiến.

## 6. POST `/api/v1/auth/logout`

### Mục đích

Thu hồi refresh token hoặc phiên hiện tại theo chiến lược được Backend phê duyệt.

### Header và request body

- Header: `Authorization: Bearer <access-token>`.

| Field | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `refreshToken` | `string` | Có | Token cần thu hồi; không ghi log. |

### Response body dự kiến — `204 No Content`

Không có response body.

### HTTP status code dự kiến

- `204 No Content`: logout được xử lý theo hướng idempotent.
- `400 Bad Request`: request không hợp lệ.
- `401 Unauthorized`: access token không hợp lệ nếu Backend yêu cầu phiên còn hiệu lực.
- `500 Internal Server Error`: lỗi ngoài dự kiến.

## 7. GET `/api/v1/users/me`

### Mục đích

Lấy hồ sơ người dùng tương ứng với access token hiện tại.

### Header và request body

- Header bắt buộc: `Authorization: Bearer <access-token>`.
- Không có request body.

### Response body dự kiến — `200 OK`

| Field | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | `string` | Định danh người dùng. |
| `fullName` | `string` | Họ tên người dùng. |
| `email` | `string` | Email chuẩn hóa. |
| `phoneNumber` | `string` | Số điện thoại chuẩn hóa. |
| `createdAt` | `string` | Thời gian ISO 8601. |
| `updatedAt` | `string` | Thời gian ISO 8601. |

### HTTP status code dự kiến

- `200 OK`: trả hồ sơ thành công.
- `401 Unauthorized`: thiếu hoặc sai access token.
- `404 Not Found`: không tìm thấy người dùng tương ứng.
- `500 Internal Server Error`: lỗi ngoài dự kiến.

## 8. Các điểm cần Backend phê duyệt

1. Tên endpoint, field và response envelope cuối cùng.
2. Register có tự tạo phiên hay yêu cầu login riêng.
3. Thời hạn token và cơ chế refresh-token rotation.
4. Cách truyền refresh token cho refresh/logout.
5. Quy tắc chuẩn hóa số điện thoại và uniqueness của email/số điện thoại.
6. Danh mục `code` lỗi ổn định cho Mobile.
7. Rate limit, lockout và chính sách thu hồi phiên.
8. Giải pháp token storage an toàn trên Mobile ở checkpoint tích hợp sau.

Cho đến khi các điểm trên được Backend xác nhận, tài liệu này vẫn là **DRAFT**.

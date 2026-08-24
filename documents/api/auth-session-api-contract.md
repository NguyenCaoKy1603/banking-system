# DRAFT v0.2 — Auth Session Rotation and Revoke API

> **Trạng thái:** DRAFT, cần Backend/Identity và legal/compliance phê duyệt trước khi bật trên môi trường tiền thật.
>
> Tài liệu này mở rộng [Auth API Contract DRAFT v2](./auth-api-contract.md) cho refresh rotation và logout server-side. Mobile chỉ coi access token mới là hợp lệ sau khi response được runtime validation và session mới được ghi nguyên tử vào SecureStore.

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
- `401 Unauthorized`: refresh token hết hạn, đã revoke, bị reuse hoặc device binding không còn hợp lệ. Đây là lỗi terminal của phiên hiện tại.
- `429 Too Many Requests`: vượt rate limit; không tự kết luận refresh token đã mất hiệu lực.
- `500 Internal Server Error`: lỗi ngoài dự kiến; không tự kết luận refresh token đã mất hiệu lực.

Timeout, mất mạng, request bị hủy, `429` và `5xx` là lỗi transient đối với state machine của Mobile. Chúng được trả cho presentation layer để hiển thị offline/retry; không được xóa session hoặc client intent chỉ vì không nhận được response. Chỉ `401` từ refresh endpoint được reference Mobile coi là bằng chứng terminal để bỏ session hiện tại. Quy tắc này vẫn là DRAFT và cần Identity/risk owner duyệt danh sách error code terminal chính thức.

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

- Mỗi lần login mới tạo một `sessionEpoch` cục bộ. Single-flight refresh phải được scope theo epoch; request của epoch/user cũ không được retry bằng token của epoch/user mới.
- Khi API trả `401`, chỉ một refresh operation của cùng epoch được chạy tại một thời điểm; các request đồng thời trong epoch đó dùng chung kết quả.
- Refresh thành công phải ghi access token, refresh token mới, expiry và user trong một SecureStore record.
- Refresh trả `401` phải xóa session cục bộ và đưa app về trạng thái anonymous. Client intent giao dịch vẫn được giữ theo `userId` để có thể đối soát sau khi cùng customer đăng nhập lại; không dùng intent của user cũ trong phiên user mới.
- Refresh lỗi transient phải giữ nguyên refresh token/session record và client intent, trả đúng lỗi offline/timeout/rate-limit/server cho UI và cho phép retry có backoff.
- Session khôi phục từ SecureStore và session quay lại từ background phải ở trạng thái `locked` cho tới khi refresh server thành công. `locked`/`refreshing` không được mount navigator chứa PII hoặc dữ liệu tài chính; lỗi transient giữ record nhưng tiếp tục khóa và cho phép retry/đăng xuất cục bộ.
- Logout luôn chuyển UI về anonymous và cố xóa session cục bộ ngay cả khi endpoint revoke không reachable; lỗi SecureStore phải được phản ánh bằng `localSessionCleared=false`, không được báo thành công hoàn toàn.
- Logout và logout mọi thiết bị trả kết quả cục bộ có cấu trúc gồm `localSessionCleared`, `remoteRevoked` và literal `recoveryIntentsPreserved: true`. Nếu revoke từ xa lỗi, UI chỉ được thông báo đã thoát thiết bị hiện tại, không được tuyên bố các thiết bị khác đã bị thu hồi.
- Logout không purge transfer/savings/credit/fraud recovery intent. Các record này dùng SecureStore key băm và scope theo owner (Credit thêm card), không chứa OTP/proof; chỉ cùng customer đăng nhập lại mới được load để resume/reconcile bằng key/operation ID cũ.
- Logout mọi thiết bị phải được server authorize và audit; Mobile vẫn xóa local session khi mạng lỗi nhưng phải hiển thị trạng thái partial failure nêu trên.
- Không log refresh token, access token, request body logout hoặc response chứa token.
- Auth/session service phải fail trước network nếu thiếu `X-Device-ID`. UUID cục bộ hiện chỉ là reference binding ID, chưa thay thế hardware-backed key/attestation cho pilot.

## 4. Transaction boundary của reference persistent server

Đây là contract nội bộ DRAFT cho sandbox persistent, không phải kiến trúc Identity production:

- Request thành công commit toàn bộ state.
- Domain rejection chỉ được giữ các mutation kiểm soát lạm dụng đã xác định rõ: access/refresh session, refresh family, challenge one-time và các attempt/rate-limit window.
- Balance, ledger, quote, payment, transfer, savings, idempotency nghiệp vụ, audit/outbox nghiệp vụ và các aggregate khác phải rollback về snapshot đầu request khi domain trả lỗi.
- Lỗi ngoài dự kiến rollback toàn bộ.

Do đó refresh-token reuse trả `401` vẫn phải commit việc revoke token family; login/challenge trả `401` hoặc `429` vẫn phải commit failure counter/lockout. Không được dùng quy tắc chung kiểu “mọi 4xx đều commit” hoặc “mọi 4xx đều rollback”. Production cần transaction/repository riêng, security audit bền vững và kiểm thử concurrency phân tán.

# Bằng chứng nâng cấp giao diện Mobile — 2026-08-28

## Kết luận

Phần giao diện Mobile đã được nâng cấp theo nhận diện riêng `NOVA Digital Banking` và chạy được bằng APK release trên Android emulator Pixel 7 API 35. Thay đổi chỉ tác động lớp trình bày, điều hướng và tài sản nhận diện; không thay đổi cách backend quyết định số dư, phí, trạng thái giao dịch hoặc dữ liệu tài khoản.

Đây vẫn là ứng dụng dùng dữ liệu và tiền mô phỏng. Bằng chứng này không tuyên bố production readiness hoặc kiểm thử thiết bị thật.

## Phạm vi đã thực hiện

- Design system dùng chung cho màu, typography, spacing, radius, shadow, kích thước vùng bấm và icon SVG.
- App icon, adaptive icon, favicon và splash screen theo nhận diện NOVA; nguồn SVG có thể tái tạo nằm trong `mobile-app/assets/brand`.
- Thanh dưới bốn mục: Trang chủ, Thẻ, QR và Thêm; QR được làm nổi bật nhưng vẫn có nhãn.
- Trang chủ mới gồm header, nhãn dữ liệu mô phỏng, thẻ số dư, tài khoản che mặc định, hiện/sao chép số đầy đủ và đúng ba chức năng nhanh.
- Đồng bộ giao diện cho đăng nhập/đăng ký, tài khoản, lịch sử, chuyển tiền năm bước, người thụ hưởng, tiết kiệm, thẻ tín dụng, QR, thông báo, KYC, fraud report, hồ sơ và MFA.
- Giữ nguyên các kiểm soát nghiệp vụ hiện có: API là nguồn sự thật, session guard, idempotency, step-up, resume intent và không optimistic-update số dư.
- Sửa responsive để tên người dùng dài không bị cắt ở Home và ScrollView không co/chồng nội dung tại Profile/MFA.

## Luồng dữ liệu và lỗi

Luồng chung vẫn là:

`thao tác người dùng → service gọi API → state màn hình → UI loading/success/empty/error → retry hoặc đăng nhập lại`

- Balance và số tài khoản lấy từ backend. Số đầy đủ chỉ được yêu cầu khi người dùng bấm `Hiện đầy đủ` hoặc `Sao chép`; UI không hiển thị UUID, token, device ID, OTP, PIN hoặc ledger ID.
- Transfer giữ chuỗi `người nhận → số tiền → xem lại → xác thực → biên nhận`; lỗi chính sách/challenge dừng luồng trước submit.
- Lỗi máy chủ từ HTTP 5xx được đổi thành thông báo tiếng Việt an toàn ở client; mã lỗi và trace ID vẫn được giữ nội bộ để chẩn đoán, không hiển thị chi tiết kỹ thuật cho người dùng.
- QR nhận tiền hiển thị số tài khoản đã che và nhãn dữ liệu mô phỏng.
- Cards/Savings có empty, loading, error và trạng thái nghiệp vụ riêng; tính năng không có dữ liệu không dẫn sang màn giả không liên quan.

## Quality gates

Kết quả chạy tại workspace `C:\Projects\banking-system`, branch `codex/staging-academic-completion`, baseline HEAD `a68db8e85b3ed109b10097fa29870d3dceb83edc` trước khi commit phần UI:

| Kiểm tra | Kết quả |
| --- | --- |
| `npm run lint` | PASS, không có warning |
| `npm run typecheck` | PASS |
| `npm test -- --runInBand` | PASS, 46 suite / 261 test (bao gồm regression test che lỗi HTTP 5xx) |
| `npm run validate:openapi` | PASS, 44 required paths |
| `npm run validate:e2e` | PASS, 12 Maestro flows hợp lệ cú pháp |
| `npm run validate:public-env` | PASS, quét 209 file |
| `npm run validate:release` | PASS |
| `npm run export:web` | PASS, 36 static routes |
| `npm run device:preflight -- --health=http://127.0.0.1:5000/healthz` | PASS cho ADB, emulator, APK và backend health |
| Android `release` build | PASS, Gradle 568 task |
| Logcat crash signature sau kiểm tra thủ công | Không phát hiện |

## APK local

- File: `mobile-app/android/app/build/outputs/apk/release/app-release.apk`
- Kích thước: 134,750,487 byte (128.51 MiB, multi-ABI local build).
- SHA-256: `06FF1247B965F0A713F55E8202973DE5413B49C9BD2875A80985AC16F2F3A2B5`.
- Build local dùng `EXPO_PUBLIC_API_URL=http://10.0.2.2:5000/api/v1` và `EXPO_PUBLIC_SANDBOX_HTTP=1`; không có secret trong hai biến này.

## Kiểm tra thủ công trên emulator

| Màn hình/luồng | Kết quả |
| --- | --- |
| Native splash NOVA | PASS |
| Khôi phục session và tải Home | PASS |
| Home với tên dài `Nguyen Cao Ky` | PASS, hiển thị đủ và tự xuống dòng |
| Thẻ số dư, tài khoản che mặc định, ba dịch vụ nhanh | PASS về bố cục |
| Hiện và sao chép số tài khoản đầy đủ | PASS; API trả số đầy đủ và hộp thoại xác nhận sao chép xuất hiện. Không giữ ảnh chứa số đầy đủ trong evidence |
| Tab Thẻ ở trạng thái chưa có thẻ | PASS |
| Tab QR và QR nhận tiền | PASS |
| Tab Thêm, danh sách dài và thao tác cuộn | PASS sau sửa responsive |
| Màn quản lý MFA | PASS về bố cục và tải trạng thái |
| Mở luồng Chuyển tiền | Giao diện PASS; backend local trả lỗi control policy nên chưa thể tiếp tục E2E submit. Client hiện đổi mọi HTTP 5xx thành thông báo tiếng Việt an toàn; regression test PASS |

Ảnh bằng chứng:

- `artifacts/mobile-ui-splash-final.png`
- `artifacts/mobile-ui-home-final-v2.png`
- `artifacts/mobile-ui-home-account-action.png` (chỉ chứa số tài khoản đã che)
- `artifacts/mobile-ui-cards-final.png`
- `artifacts/mobile-ui-qr-final.png`
- `artifacts/mobile-ui-profile-final-v3.png`
- `artifacts/mobile-ui-profile-security.png`
- `artifacts/mobile-ui-mfa-final.png`
- `artifacts/mobile-ui-final-home-settled.png`

## Phần còn lại và rủi ro

- Cần xử lý lỗi control-policy của backend local rồi chạy lại transfer E2E; không được coi ảnh màn lỗi là bằng chứng nghiệp vụ chuyển tiền hoàn tất.
- Chưa chạy bộ Maestro end-to-end thực tế trong phiên refresh UI; mới xác nhận cú pháp, preflight và kiểm tra thủ công. Các flow có thể tạo dữ liệu nên cần database disposable hoặc baseline được kiểm soát.
- Chưa kiểm tra iOS, thiết bị Android thật, font scaling cực lớn, screen reader đầy đủ hoặc nhiều kích thước màn hình.
- APK local dùng debug signing mặc định của native project sinh bởi Expo; không phải APK staging đã ký để phát hành.
- Thư mục native `mobile-app/android` là output local đang bị Git ignore; thay đổi icon/splash được lưu ở `app.json` và `assets`, cần prebuild/build lại trên clone sạch.
- Workspace có thay đổi Backend/Admin do người dùng thực hiện ngoài phạm vi refresh UI; không đưa các thay đổi đó vào kết luận chất lượng Mobile.

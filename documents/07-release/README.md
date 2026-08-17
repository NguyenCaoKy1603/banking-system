# 07-release

## Trạng thái

Đã bổ sung package Android, EAS profile preview APK, environment mapping và công cụ kiểm tra release. Đã build APK release local, cài và mở thành công trên Android emulator; checksum và bằng chứng nằm trong [`../05-testing/device-evidence.md`](../05-testing/device-evidence.md). EAS CLI/staging signing vẫn chưa có nên artifact này chỉ là sandbox local, không phải release candidate.

## Kiểm tra cấu hình

```powershell
cd mobile-app
npm run validate:release
npx expo config --type public
```

`app.json` dùng package `com.example.digitalbanking.mobile`. Profile `preview` tạo APK internal distribution và lấy `EXPO_PUBLIC_API_URL` từ EAS environment `preview`; profile `production` dùng environment `production`. URL cấp cho build phải là HTTPS và được lưu trong secret/environment của EAS, không commit vào repository.

## Build APK preview

Sau khi đã đăng nhập EAS và cấu hình environment:

```powershell
cd mobile-app
eas build --platform android --profile preview
```

Sau khi tải APK về, tạo bằng chứng checksum:

```powershell
npm run release:checksum -- .\artifacts\mobile-app-preview.apk
```

Lưu JSON output cùng APK trong kho evidence của release; không commit APK hoặc credential vào source repository.

## Cài đặt và kiểm tra thiết bị

```powershell
adb install -r .\artifacts\mobile-app-preview.apk
```

Trên thiết bị mới cần xác nhận cold start, cấp quyền camera/biometric, cấu hình URL staging, login/MFA, QR fallback, transfer pending/recovery và notification deep link. Ghi model, Android version, APK checksum, thời gian, kết quả và video/ảnh vào device report.

## Release manifest

Mẫu trường bắt buộc nằm tại [`release-manifest.template.json`](./release-manifest.template.json): version, package, profile, API environment, artifact path, SHA-256, thiết bị, device evidence, test report, owner và rollback target. Bản release note điền theo [`release-note.template.md`](./release-note.template.md).

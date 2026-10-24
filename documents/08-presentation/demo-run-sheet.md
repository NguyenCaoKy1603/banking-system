# Run sheet demo — Đợt 2 trong gói bàn giao Đợt 3

`Bản nháp; thời lượng tổng và người trình bày chờ Owner cung cấp.`

Mục tiêu demo là trình diễn lại dữ liệu synthetic đã được nghiệm thu, không tạo giao
dịch mới trong phiên soạn hồ sơ. Dùng database demo/dịch vụ local đang được Owner giữ;
không reset database và không dùng database disposable cho live demo.

| Đoạn | Nội dung | Có thể rút gọn | Điểm phải nói |
| --- | --- | --- | --- |
| 0. Mở đầu | Nêu scope academic, tiền ảo, dữ liệu synthetic | Không | Không phải production/pilot |
| 1. Kiểm tra sẵn sàng | Hiển thị service health và màn hình bắt đầu | Có | Chỉ dùng thông tin đã được redact |
| 2. Customer/KYC | Mở customer state, KYC submitted/reviewed | Có thể dùng ảnh/recorded evidence | KYC synthetic, không document thật |
| 3. Maker request | Maker tạo funding request | Có | Request chờ checker, không bypass |
| 4. Checker | Checker độc lập mở Approval Inbox và approve | Có thể chỉ trình bày receipt | Hai principal khác nhau |
| 5. MFA/step-up | Đăng nhập và xác nhận step-up theo flow có sẵn | Có thể giải thích bằng slide | Secret/code không xuất hiện trên màn hình ghi hình |
| 6. Transfer A→B | Lookup, quote, fee, review, submit và receipt | Có thể chiếu evidence đã ghi | Server tính fee và số dư |
| 7. Đối soát | Nêu A `4,498,000`, B `5,500,000`; debit/credit `15,502,000` | Không cần query live | Tổng ledger không phải tổng số dư |
| 8. Negative controls | Replay idempotency, cross-account denial, maker self-approval | Có thể trình bày kết quả đã có | Evidence khác tầng, không gọi là một E2E claim |
| 9. Kết | Nhắc giới hạn và Q&A | Không | Chưa có staging/production |

## Kịch bản rút gọn

Nếu thời lượng ngắn: trình bày slide scope → checker/funding → transfer receipt →
đối soát → ba negative controls và giới hạn. Không tạo giao dịch mới để “làm lại” số
liệu; dùng hồ sơ Đợt 2 làm nguồn evidence.

## Khi demo gặp lỗi

1. Dừng thao tác và ghi nhận màn hình/lỗi đã redact; không reset/drop database.
2. Chuyển sang run sheet rút gọn hoặc evidence đã ghi trước đó.
3. Không khẳng định PASS nếu live state khác evidence; ghi rõ local demo không sẵn sàng.
4. Chỉ Owner/operator quyết định restart dịch vụ hoặc khôi phục dữ liệu.

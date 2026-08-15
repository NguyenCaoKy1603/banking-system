# Working-tree checkpoint report

Ngày ghi nhận: 2026-08-15
Nhánh: `feature/mobile-authentication`
Base commit quan sát: `418116d`

## Trạng thái

**CHƯA TẠO checkpoint Git sạch.** Workspace hiện có nhiều thay đổi staged/unstaged và file mới thuộc phạm vi triển khai M0–M5/M8. Vì quy tắc ownership yêu cầu bảo toàn thay đổi hiện có, task này không tự ý stage, commit hoặc reset các file.

## Cách chốt checkpoint sau khi owner review

1. Review diff và loại credential/local `.env` khỏi vùng commit.
2. Chạy lại test report và kiểm tra `git diff --check`.
3. Commit theo quyết định của owner, ví dụ `mvp-demo-v1`.
4. Gắn commit hash vào release manifest, test report và evidence device.

APK không được coi là artifact của checkpoint này cho tới khi được build từ một commit sạch và có checksum.

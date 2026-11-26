# 02 — Kiến trúc và thiết kế

Đây là khu vực mô tả hệ thống hiện tại ở mức logic. Source runtime và validator là căn cứ cuối cùng khi tài liệu khác source.

| Tài liệu | Nội dung |
| --- | --- |
| [architecture-and-scope.md](architecture-and-scope.md) | Topology, process boundaries, persistence modes, security boundary và data flow |
| [function-scope.md](function-scope.md) | Bản đồ module Mobile/Backend/Admin và giới hạn từng nhóm tính năng |
| [use-cases-complete-specification.md](use-cases-complete-specification.md) | Đặc tả chi tiết 40 Use Cases (Customer Mobile, Admin Web và System Worker) cùng bảng đối chiếu API/DB |
| [sequence-core-demo.md](sequence-core-demo.md) | Luồng request → state → response/UI và failure path cho các use case quan trọng |
| [erd-core-demo.md](erd-core-demo.md) | ERD và dữ liệu của demo/reference; đối chiếu migrations `001`–`051` trước khi dùng |

Tài liệu này không phải wireframe đã được phê duyệt. Khi UI/source và sơ đồ cũ khác nhau, ghi discrepancy và lấy source hiện hành làm trạng thái kỹ thuật.

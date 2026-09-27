interface StatusBadgeProps {
  status: string;
  variant?: "success" | "warning" | "danger" | "info" | "neutral";
  label?: string;
}

export function StatusBadge({ status, variant, label }: StatusBadgeProps) {
  let resolvedVariant = variant;
  let resolvedLabel = label;

  if (!resolvedVariant) {
    switch (status.toUpperCase()) {
      case "ACTIVE":
      case "APPROVED":
      case "SUCCEEDED":
      case "RESOLVED":
      case "COMPLETED":
        resolvedVariant = "success";
        break;
      case "PENDING":
      case "PENDING_APPROVAL":
      case "PENDING_ACTIVATION":
      case "SUBMITTED":
      case "UNDER_REVIEW":
      case "UNDER_INVESTIGATION":
      case "PROCESSING":
      case "RECEIVED":
        resolvedVariant = "warning";
        break;
      case "BLOCKED":
      case "LOCKED":
      case "DISABLED":
      case "REJECTED":
      case "FAILED":
      case "DEAD":
        resolvedVariant = "danger";
        break;
      case "NEEDS_MORE_INFO":
      case "SKIPPED":
      case "INVITED":
      case "CANCELLED":
      case "CLOSED":
        resolvedVariant = "neutral";
        break;
      default:
        resolvedVariant = "info";
    }
  }

  if (!resolvedLabel) {
    switch (status.toUpperCase()) {
      case "ACTIVE":
        resolvedLabel = "Hoạt động";
        break;
      case "BLOCKED":
        resolvedLabel = "Đã khóa";
        break;
      case "LOCKED":
        resolvedLabel = "Bị khóa";
        break;
      case "DISABLED":
        resolvedLabel = "Đã vô hiệu hóa";
        break;
      case "INVITED":
        resolvedLabel = "Đã gửi lời mời";
        break;
      case "SUBMITTED":
        resolvedLabel = "Chờ tiếp nhận";
        break;
      case "UNDER_REVIEW":
        resolvedLabel = "Đang xử lý";
        break;
      case "UNDER_INVESTIGATION":
        resolvedLabel = "Đang điều tra";
        break;
      case "RECEIVED":
        resolvedLabel = "Mới tiếp nhận";
        break;
      case "PENDING":
        resolvedLabel = "Chờ xử lý";
        break;
      case "PENDING_APPROVAL":
        resolvedLabel = "Chờ phê duyệt";
        break;
      case "PENDING_ACTIVATION":
        resolvedLabel = "Chờ kích hoạt";
        break;
      case "APPROVED":
        resolvedLabel = "Đã duyệt";
        break;
      case "REJECTED":
        resolvedLabel = "Đã từ chối";
        break;
      case "NEEDS_MORE_INFO":
        resolvedLabel = "Cần bổ sung";
        break;
      case "SUCCEEDED":
        resolvedLabel = "Thành công";
        break;
      case "FAILED":
        resolvedLabel = "Thất bại";
        break;
      case "DEAD":
        resolvedLabel = "Lỗi nghiêm trọng (Dead)";
        break;
      case "SKIPPED":
        resolvedLabel = "Đã bỏ qua";
        break;
      case "CANCELLED":
        resolvedLabel = "Đã hủy";
        break;
      case "RESOLVED":
        resolvedLabel = "Đã giải quyết";
        break;
      case "CLOSED":
        resolvedLabel = "Đã đóng";
        break;
      default:
        resolvedLabel = status;
    }
  }

  return (
    <span className={`status-pill status-${resolvedVariant}`} title={`Trạng thái: ${status}`}>
      <span className="status-dot-indicator">●</span> {resolvedLabel}
    </span>
  );
}

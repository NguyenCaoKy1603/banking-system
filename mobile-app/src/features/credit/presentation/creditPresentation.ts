import type {
  CreditPaymentOption,
  CreditPaymentStatus,
  CreditStatementStatus,
  CreditTransactionType,
} from "@/features/credit/types/credit";

export function formatCreditDate(value: string | null): string {
  if (!value) return "Chưa có";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("vi-VN");
}

export function getCreditCardStatusLabel(status: string): string {
  switch (status) {
    case "ACTIVE": return "Đang hoạt động";
    case "LOCKED": return "Đã khóa";
    case "BLOCKED": return "Bị chặn";
    case "EXPIRED": return "Hết hạn";
    case "CLOSED": return "Đã đóng";
    default: return status;
  }
}

export function getCreditStatementStatusLabel(status: CreditStatementStatus): string {
  switch (status) {
    case "ISSUED": return "Đã phát hành";
    case "PARTIALLY_PAID": return "Đã thanh toán một phần";
    case "PAID": return "Đã thanh toán đủ";
    case "OVERDUE": return "Quá hạn";
  }
}

export function getCreditPaymentStatusLabel(status: CreditPaymentStatus): string {
  switch (status) {
    case "PENDING": return "Đang xử lý";
    case "SUCCEEDED": return "Thành công";
    case "FAILED": return "Thất bại";
    case "REVERSED": return "Đã hoàn tác";
  }
}

export function getCreditPaymentOptionLabel(option: CreditPaymentOption): string {
  switch (option) {
    case "MINIMUM": return "Mức tối thiểu";
    case "FULL_STATEMENT": return "Toàn bộ sao kê";
    case "CUSTOM": return "Số tiền tùy chọn";
  }
}

export function getCreditTransactionTypeLabel(type: CreditTransactionType): string {
  switch (type) {
    case "PURCHASE": return "Mua hàng";
    case "REFUND": return "Hoàn tiền";
    case "PAYMENT": return "Thanh toán thẻ";
    case "FEE": return "Phí";
    case "INTEREST": return "Lãi";
    case "ADJUSTMENT": return "Điều chỉnh";
  }
}

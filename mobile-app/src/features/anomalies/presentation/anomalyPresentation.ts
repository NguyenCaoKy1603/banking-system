import type {
  AnomalyRiskLevel,
  AnomalyRuleCode,
  AnomalyStatus,
} from "@/features/anomalies/types/anomaly";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

export function getRiskLevelPresentation(riskLevel: AnomalyRiskLevel): {
  label: string;
  tone: BadgeTone;
} {
  switch (riskLevel) {
    case "CRITICAL":
      return { label: "Rủi ro nghiêm trọng", tone: "danger" };
    case "HIGH":
      return { label: "Bất thường cao", tone: "danger" };
    case "MEDIUM":
      return { label: "Cần lưu ý", tone: "warning" };
    case "LOW":
    default:
      return { label: "Bình thường", tone: "success" };
  }
}

export function getAnomalyStatusPresentation(status: AnomalyStatus): {
  label: string;
  tone: BadgeTone;
} {
  switch (status) {
    case "OPEN":
      return { label: "Chờ xác nhận", tone: "warning" };
    case "CONFIRMED_SAFE":
      return { label: "Đã xác nhận an toàn", tone: "success" };
    case "REPORTED_SUSPICIOUS":
      return { label: "Đã báo nghi ngờ", tone: "danger" };
    case "RESOLVED":
      return { label: "Đã xử lý", tone: "info" };
  }
}

export function getRuleCodeLabel(code: AnomalyRuleCode): string {
  switch (code) {
    case "HIGH_VALUE_TRANSFER":
      return "Giao dịch giá trị lớn";
    case "LARGE_BALANCE_DRAIN":
      return "Rút phần lớn số dư";
    case "NEW_RECIPIENT_HIGH_AMOUNT":
      return "Người nhận mới · số tiền lớn";
    case "VELOCITY_SPIKE":
      return "Tần suất giao dịch dày đặc";
    case "RAPID_REPEATED_RECIPIENT":
      return "Lặp lại cùng người nhận";
    case "UNUSUAL_NIGHT_HOUR":
      return "Giao dịch ban đêm (00:00–05:00)";
  }
}

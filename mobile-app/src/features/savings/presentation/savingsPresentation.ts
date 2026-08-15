import type {
  MaturityInstruction,
  SavingsDepositStatus,
  SavingsOpeningStatus,
} from "@/features/savings/types/savings";

export function formatSavingsRate(annualRateBasisPoints: number): string {
  return `${(annualRateBasisPoints / 100).toFixed(2)}%/năm`;
}

export function getMaturityInstructionLabel(
  instruction: MaturityInstruction,
): string {
  switch (instruction) {
    case "RETURN_PRINCIPAL_AND_INTEREST":
      return "Trả gốc và lãi về tài khoản";
    case "RENEW_PRINCIPAL":
      return "Tái tục gốc, trả lãi về tài khoản";
    case "RENEW_PRINCIPAL_AND_INTEREST":
      return "Tái tục cả gốc và lãi";
  }
}

export function getSavingsOpeningStatusLabel(
  status: SavingsOpeningStatus,
): string {
  switch (status) {
    case "PENDING":
      return "Đang xử lý";
    case "SUCCEEDED":
      return "Đã mở thành công";
    case "FAILED":
      return "Mở thất bại";
    case "REVERSED":
      return "Đã hoàn tác";
  }
}

export function getSavingsDepositStatusLabel(
  status: SavingsDepositStatus,
): string {
  switch (status) {
    case "ACTIVE":
      return "Đang hoạt động";
    case "MATURED":
      return "Đã đáo hạn";
    case "CLOSED":
      return "Đã đóng / tái tục";
  }
}

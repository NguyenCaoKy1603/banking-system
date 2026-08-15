import type { AccountStatus } from "@/features/accounts/types/account";

const fullyMaskedAccountNumber = "•••• ••••";

export function getAccountStatusLabel(status: AccountStatus): string {
  return status === "ACTIVE" ? "Đang hoạt động" : "Đã khóa";
}

export function getAccountNumberDisplay(
  maskedNumber: string,
  fullAccountNumber: string | null,
  isVisible: boolean,
): string {
  if (isVisible && fullAccountNumber) {
    return fullAccountNumber;
  }

  return maskedNumber || fullyMaskedAccountNumber;
}

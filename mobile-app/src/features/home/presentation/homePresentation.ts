import { formatVndMinor } from "@/features/banking/presentation/formatMoney";

export function getBalanceDisplay(amountMinor: string, isVisible: boolean): string {
  return isVisible ? formatVndMinor(amountMinor) : "••• ••• ••• VND";
}

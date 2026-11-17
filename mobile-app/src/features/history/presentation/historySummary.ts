import type { Transaction } from "@/features/accounts/types/account";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";

export type MonthlyCashFlowSummary = {
  monthLabel: string;
  totalIncomeMinor: string;
  totalExpenseMinor: string;
  netMinor: string;
  succeededCount: number;
  creditCount: number;
  debitCount: number;
};

/** Aggregates settled monthly income, expense and net balance in integer minor units. */
export function summarizeMonthlyCashFlow(
  transactions: readonly Transaction[],
  referenceDate: Date = new Date(),
): MonthlyCashFlowSummary {
  const targetYear = referenceDate.getFullYear();
  const targetMonth = referenceDate.getMonth();
  const monthLabel = `${String(targetMonth + 1).padStart(2, "0")}/${targetYear}`;

  let income = 0n;
  let expense = 0n;
  let creditCount = 0;
  let debitCount = 0;

  for (const transaction of transactions) {
    if (transaction.status !== "SUCCEEDED") {
      continue;
    }
    const occurred = new Date(transaction.occurredAt);
    if (
      Number.isNaN(occurred.getTime()) ||
      occurred.getFullYear() !== targetYear ||
      occurred.getMonth() !== targetMonth
    ) {
      continue;
    }
    const amount = BigInt(transaction.amount.amountMinor);
    if (transaction.direction === "CREDIT") {
      income += amount;
      creditCount += 1;
    } else if (transaction.direction === "DEBIT") {
      expense += amount;
      debitCount += 1;
    }
  }

  return {
    monthLabel,
    totalIncomeMinor: income.toString(),
    totalExpenseMinor: expense.toString(),
    netMinor: (income - expense).toString(),
    succeededCount: creditCount + debitCount,
    creditCount,
    debitCount,
  };
}

export function formatSignedVndMinor(signedMinor: string): string {
  if (signedMinor.startsWith("-")) {
    return `−${formatVndMinor(signedMinor.slice(1))}`;
  }
  if (signedMinor === "0") {
    return formatVndMinor("0");
  }
  return `+${formatVndMinor(signedMinor)}`;
}

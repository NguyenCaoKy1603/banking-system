import type {
  Transaction,
  TransactionDirection,
  TransactionStatus,
} from "@/features/accounts/types/account";

export type HistoryStatusFilter = "ALL" | TransactionStatus;
export type HistoryDirectionFilter = "ALL" | TransactionDirection;

export function filterTransactions(
  transactions: Transaction[],
  status: HistoryStatusFilter,
  direction: HistoryDirectionFilter,
): Transaction[] {
  return transactions.filter(
    (transaction) =>
      (status === "ALL" || transaction.status === status) &&
      (direction === "ALL" || transaction.direction === direction),
  );
}

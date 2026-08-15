import { filterTransactions } from "@/features/history/presentation/historyFilters";
import type { Transaction } from "@/features/accounts/types/account";

const transactions: Transaction[] = [
  {
    id: "transaction-1",
    accountId: "account-1",
    direction: "CREDIT",
    amount: { currency: "VND", amountMinor: "100000" },
    fee: { currency: "VND", amountMinor: "0" },
    status: "SUCCEEDED",
    description: "Tiền vào",
    counterpartyName: "A",
    occurredAt: "2026-08-14T00:00:00Z",
  },
  {
    id: "transaction-2",
    accountId: "account-1",
    direction: "DEBIT",
    amount: { currency: "VND", amountMinor: "200000" },
    fee: { currency: "VND", amountMinor: "1000" },
    status: "PENDING",
    description: "Tiền ra",
    counterpartyName: "B",
    occurredAt: "2026-08-14T00:00:00Z",
  },
];

describe("filterTransactions", () => {
  it("filters by status and direction without changing server records", () => {
    expect(filterTransactions(transactions, "SUCCEEDED", "CREDIT")).toHaveLength(1);
    expect(filterTransactions(transactions, "PENDING", "ALL")[0]?.id).toBe("transaction-2");
    expect(filterTransactions(transactions, "ALL", "ALL")).toEqual(transactions);
  });
});

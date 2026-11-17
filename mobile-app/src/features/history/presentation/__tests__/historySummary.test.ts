import type { Transaction } from "@/features/accounts/types/account";
import {
  formatSignedVndMinor,
  summarizeMonthlyCashFlow,
} from "@/features/history/presentation/historySummary";

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: "tx-1",
    accountId: "acc-1",
    direction: "DEBIT",
    amount: { currency: "VND", amountMinor: "100000" },
    fee: { currency: "VND", amountMinor: "0" },
    status: "SUCCEEDED",
    description: "Test tx",
    counterpartyName: null,
    occurredAt: "2026-11-10T10:00:00.000Z",
    ...overrides,
  };
}

describe("summarizeMonthlyCashFlow", () => {
  const reference = new Date("2026-11-16T12:00:00.000Z");

  it("sums SUCCEEDED credit and debit transactions in the current month using integer arithmetic", () => {
    const summary = summarizeMonthlyCashFlow(
      [
        tx({ id: "1", direction: "CREDIT", amount: { currency: "VND", amountMinor: "2500000" } }),
        tx({ id: "2", direction: "DEBIT", amount: { currency: "VND", amountMinor: "1200000" } }),
        tx({ id: "3", direction: "DEBIT", status: "FAILED", amount: { currency: "VND", amountMinor: "5000000" } }),
        tx({ id: "4", direction: "CREDIT", status: "PENDING", amount: { currency: "VND", amountMinor: "900000" } }),
        tx({ id: "5", direction: "CREDIT", occurredAt: "2026-10-20T10:00:00.000Z", amount: { currency: "VND", amountMinor: "8000000" } }),
      ],
      reference,
    );

    expect(summary).toEqual({
      monthLabel: "11/2026",
      totalIncomeMinor: "2500000",
      totalExpenseMinor: "1200000",
      netMinor: "1300000",
      succeededCount: 2,
      creditCount: 1,
      debitCount: 1,
    });
    expect(formatSignedVndMinor(summary.netMinor)).toBe("+1.300.000 ₫");
  });

  it("formats negative net balances cleanly", () => {
    const summary = summarizeMonthlyCashFlow(
      [
        tx({ id: "1", direction: "CREDIT", amount: { currency: "VND", amountMinor: "500000" } }),
        tx({ id: "2", direction: "DEBIT", amount: { currency: "VND", amountMinor: "1250000" } }),
      ],
      reference,
    );

    expect(summary.netMinor).toBe("-750000");
    expect(formatSignedVndMinor(summary.netMinor)).toBe("−750.000 ₫");
    expect(formatSignedVndMinor("0")).toBe("0 ₫");
  });
});

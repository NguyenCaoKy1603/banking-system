import {
  isAccountNumberResponse,
  isAccountsResponse,
  isTransactionDetail,
  isTransactionPage,
} from "@/features/accounts/validation/accountResponseValidators";
import { isMoney } from "@/features/banking/validation/moneyValidators";

const money = {
  currency: "VND" as const,
  amountMinor: "100000",
};

const account = {
  id: "account-1",
  displayName: "Tài khoản thanh toán",
  maskedNumber: "•••• 1234",
  bankName: "Ngân hàng reference",
  currency: "VND" as const,
  availableBalance: money,
  currentBalance: money,
  status: "ACTIVE" as const,
  updatedAt: "2026-08-14T00:00:00Z",
};

const transaction = {
  id: "transaction-1",
  accountId: account.id,
  direction: "DEBIT" as const,
  amount: money,
  fee: { currency: "VND" as const, amountMinor: "0" },
  status: "SUCCEEDED" as const,
  description: "Thanh toán thử nghiệm",
  counterpartyName: "Người nhận",
  occurredAt: "2026-08-14T00:00:00Z",
};

describe("banking response validators", () => {
  it("validates the full account number response", () => {
    expect(isAccountNumberResponse({ accountNumber: "970400000001" })).toBe(true);
    expect(isAccountNumberResponse({ accountNumber: "•••• 0001" })).toBe(false);
    expect(isAccountNumberResponse({ accountNumber: "123" })).toBe(false);
  });

  it("chỉ chấp nhận Money VND bằng chuỗi số nguyên", () => {
    expect(isMoney(money)).toBe(true);
    expect(isMoney({ currency: "VND", amountMinor: "01" })).toBe(false);
    expect(isMoney({ currency: "VND", amountMinor: 100 })).toBe(false);
    expect(isMoney({ currency: "USD", amountMinor: "100" })).toBe(false);
  });

  it("validate accounts response", () => {
    expect(isAccountsResponse({ accounts: [account] })).toBe(true);
    expect(isAccountsResponse({ accounts: [{ ...account, currentBalance: null }] })).toBe(
      false,
    );
  });

  it("validate transaction page và transaction detail", () => {
    expect(
      isTransactionPage({ items: [transaction], nextCursor: "next-cursor" }),
    ).toBe(true);
    expect(
      isTransactionDetail({
        ...transaction,
        reference: "REF-1",
        createdAt: "2026-08-14T00:00:00Z",
        completedAt: "2026-08-14T00:01:00Z",
      }),
    ).toBe(true);
    expect(
      isTransactionPage({ items: [transaction], nextCursor: 10 }),
    ).toBe(false);
  });
});

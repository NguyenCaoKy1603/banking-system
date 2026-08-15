import {
  isSavingsDeposit,
  isSavingsDepositsResponse,
  isSavingsOpening,
  isSavingsProductsResponse,
  isSavingsQuote,
} from "@/features/savings/validation/savingsResponseValidators";

const money = { currency: "VND" as const, amountMinor: "1000000" };
const product = {
  productId: "savings-vnd-1m",
  name: "Tiết kiệm 1 tháng",
  termMonths: 1 as const,
  annualRateBasisPoints: 300,
  currency: "VND" as const,
  minAmountMinor: "1000000",
  maxAmountMinor: "500000000",
  status: "ACTIVE" as const,
  termsVersion: "sandbox-v1",
};
const quote = {
  quoteId: "quote-1",
  productId: product.productId,
  productName: product.name,
  termsVersion: product.termsVersion,
  termMonths: 1 as const,
  sourceAccountId: "account-1",
  sourceAccountMaskedNumber: "•••• 0001",
  principal: money,
  annualRateBasisPoints: 300,
  interestDays: 31,
  expectedInterest: { currency: "VND" as const, amountMinor: "2547" },
  totalAtMaturity: { currency: "VND" as const, amountMinor: "1002547" },
  openedAt: "2026-08-14T00:00:00Z",
  maturityAt: "2026-09-14T00:00:00Z",
  maturityInstruction: "RETURN_PRINCIPAL_AND_INTEREST" as const,
  expiresAt: "2026-08-14T00:05:00Z",
};
const deposit = {
  depositId: "deposit-1",
  productId: product.productId,
  productName: product.name,
  termsVersion: product.termsVersion,
  termMonths: 1 as const,
  principal: money,
  annualRateBasisPoints: 300,
  expectedInterest: { currency: "VND" as const, amountMinor: "2547" },
  totalAtMaturity: { currency: "VND" as const, amountMinor: "1002547" },
  openedAt: quote.openedAt,
  maturityAt: quote.maturityAt,
  maturityInstruction: quote.maturityInstruction,
  sourceAccountMaskedNumber: "•••• 0001",
  status: "ACTIVE" as const,
  reference: "SAV-1",
  updatedAt: quote.openedAt,
  renewedDepositId: null,
};

describe("savings response validators", () => {
  it("accepts the server snapshots and rejects invalid term/status", () => {
    expect(isSavingsProductsResponse({ items: [product] })).toBe(true);
    expect(isSavingsQuote(quote)).toBe(true);
    expect(isSavingsOpening({
      openingId: "opening-1",
      quoteId: "quote-1",
      depositId: "deposit-1",
      status: "SUCCEEDED",
      reference: "SAV-1",
      failureReason: null,
      createdAt: quote.openedAt,
      updatedAt: quote.openedAt,
    })).toBe(true);
    expect(isSavingsDeposit(deposit)).toBe(true);
    expect(isSavingsDepositsResponse({ items: [deposit], totalPrincipal: money })).toBe(true);
    expect(isSavingsDeposit({ ...deposit, status: "UNKNOWN" })).toBe(false);
    expect(isSavingsQuote({ ...quote, termMonths: 2 })).toBe(false);
  });
});

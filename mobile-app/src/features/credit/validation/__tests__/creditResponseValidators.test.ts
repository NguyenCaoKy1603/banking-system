import {
  isCreditAccountResponse,
  isCreditAccountsResponse,
  isCreditCardDetailResponse,
  isCreditCardsResponse,
  isCreditPayment,
  isCreditPaymentQuote,
  isCreditStatementResponse,
  isCreditStatementsResponse,
  isCreditTransactionsResponse,
} from "@/features/credit/validation/creditResponseValidators";

const money = { currency: "VND" as const, amountMinor: "4000000" };
const account = {
  creditAccountId: "credit-account-1",
  currency: "VND" as const,
  creditLimit: { currency: "VND" as const, amountMinor: "20000000" },
  postedOutstanding: money,
  pendingAuthorizations: { currency: "VND" as const, amountMinor: "0" },
  availableCredit: { currency: "VND" as const, amountMinor: "16000000" },
  nextStatementAt: "2026-08-24T17:00:00.000Z",
  status: "ACTIVE" as const,
  version: 1,
  updatedAt: "2026-08-14T00:00:00.000Z",
};
const card = {
  cardId: "card-1",
  creditAccountId: account.creditAccountId,
  displayName: "Credit sandbox",
  brand: "VISA" as const,
  maskedNumber: "•••• 2468",
  lastFour: "2468",
  expiryMonth: 12,
  expiryYear: 30,
  status: "ACTIVE" as const,
  updatedAt: account.updatedAt,
  creditLimit: account.creditLimit,
  availableCredit: account.availableCredit,
  postedOutstanding: account.postedOutstanding,
  pendingAuthorizations: account.pendingAuthorizations,
  nextDueAt: "2026-09-08T17:00:00.000Z",
  remainingAmountDue: money,
  minimumPaymentRemaining: { currency: "VND" as const, amountMinor: "200000" },
  sandbox: true as const,
};
const transaction = {
  transactionId: "credit-transaction-1",
  creditAccountId: account.creditAccountId,
  statementId: "statement-1",
  type: "PURCHASE" as const,
  status: "POSTED" as const,
  description: "Sandbox purchase",
  merchantName: "Merchant sandbox",
  amount: money,
  debtEffect: "INCREASE" as const,
  occurredAt: account.updatedAt,
  postedAt: account.updatedAt,
};
const payment = {
  paymentId: "payment-1",
  statementId: "statement-1",
  sourceAccountId: "account-1",
  amount: { currency: "VND" as const, amountMinor: "1000000" },
  reference: "CRD-1",
  status: "SUCCEEDED" as const,
  failureReason: null,
  createdAt: account.updatedAt,
  updatedAt: account.updatedAt,
};
const statement = {
  statementId: "statement-1",
  creditAccountId: account.creditAccountId,
  cycleStartAt: "2026-07-24T17:00:00.000Z",
  cycleEndAt: "2026-08-24T17:00:00.000Z",
  issuedAt: "2026-08-24T17:00:00.000Z",
  dueAt: "2026-09-08T17:00:00.000Z",
  openingBalance: { currency: "VND" as const, amountMinor: "0" },
  purchaseTotal: money,
  refundTotal: { currency: "VND" as const, amountMinor: "0" },
  feeTotal: { currency: "VND" as const, amountMinor: "0" },
  interestTotal: { currency: "VND" as const, amountMinor: "0" },
  closingBalance: money,
  remainingAmountDue: money,
  minimumPaymentDue: { currency: "VND" as const, amountMinor: "200000" },
  minimumPaymentRemaining: { currency: "VND" as const, amountMinor: "200000" },
  paidAmount: { currency: "VND" as const, amountMinor: "0" },
  status: "ISSUED" as const,
  version: 1,
  items: [transaction],
  payments: [payment],
};
const quote = {
  quoteId: "quote-1",
  sourceAccountId: "account-1",
  sourceAccountMaskedNumber: "•••• 0001",
  creditAccountId: account.creditAccountId,
  cardLastFour: "2468",
  statementId: statement.statementId,
  statementVersion: statement.version,
  paymentOption: "MINIMUM" as const,
  amount: { currency: "VND" as const, amountMinor: "200000" },
  fee: { currency: "VND" as const, amountMinor: "0" },
  outstandingBefore: statement.remainingAmountDue,
  outstandingAfter: { currency: "VND" as const, amountMinor: "3800000" },
  minimumPaymentRemainingBefore: statement.minimumPaymentRemaining,
  minimumPaymentRemainingAfter: { currency: "VND" as const, amountMinor: "0" },
  terms: "Sandbox terms",
  expiresAt: "2099-08-24T17:05:00.000Z",
};

describe("credit response validators", () => {
  it("accepts card, account, transaction, statement, quote and payment snapshots", () => {
    expect(isCreditCardsResponse({ items: [card] })).toBe(true);
    expect(isCreditCardDetailResponse({ card, creditAccount: account, latestStatement: statement })).toBe(true);
    expect(isCreditAccountsResponse({ items: [account] })).toBe(true);
    expect(isCreditAccountResponse(account)).toBe(true);
    expect(isCreditTransactionsResponse({ items: [transaction], nextCursor: null })).toBe(true);
    expect(isCreditStatementsResponse({ items: [statement], nextCursor: null })).toBe(true);
    expect(isCreditStatementResponse({ statement })).toBe(true);
    expect(isCreditPaymentQuote(quote)).toBe(true);
    expect(isCreditPayment(payment)).toBe(true);
  });

  it("rejects malformed status, money and card identity fields", () => {
    expect(isCreditCardsResponse({ items: [{ ...card, lastFour: "123" }] })).toBe(false);
    expect(isCreditAccountsResponse({ items: [{ ...account, status: "BLOCKED" }] })).toBe(false);
    expect(isCreditStatementsResponse({ items: [{ ...statement, version: 0 }] })).toBe(false);
    expect(isCreditPaymentQuote({ ...quote, amount: { currency: "VND", amountMinor: "0" } })).toBe(false);
    expect(isCreditPayment({ ...payment, status: "PENDING", updatedAt: "not-a-date" })).toBe(false);
  });
});

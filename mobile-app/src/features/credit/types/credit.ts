import type { Money } from "@/features/banking/types/money";

export type CreditCardStatus = "ACTIVE" | "LOCKED" | "BLOCKED" | "EXPIRED" | "CLOSED";
export type CreditAccountStatus = "ACTIVE" | "FROZEN" | "CLOSED";
export type CreditTransactionType =
  | "PURCHASE"
  | "REFUND"
  | "PAYMENT"
  | "FEE"
  | "INTEREST"
  | "ADJUSTMENT";
export type CreditTransactionStatus = "PENDING" | "POSTED" | "REVERSED" | "DECLINED";
export type CreditDebtEffect = "INCREASE" | "DECREASE" | "NONE";
export type CreditStatementStatus = "ISSUED" | "PARTIALLY_PAID" | "PAID" | "OVERDUE";
export type CreditPaymentStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "REVERSED";
export type CreditPaymentOption = "MINIMUM" | "FULL_STATEMENT" | "CUSTOM";
export type CreditStepUpMethod = "OTP" | "TOTP" | "BIOMETRIC";

export type CreditCard = {
  cardId: string;
  creditAccountId: string;
  displayName: string;
  brand: "VISA" | "MASTERCARD";
  maskedNumber: string;
  lastFour: string;
  expiryMonth: number;
  expiryYear: number;
  status: CreditCardStatus;
  updatedAt: string;
  creditLimit: Money;
  availableCredit: Money;
  postedOutstanding: Money;
  pendingAuthorizations: Money;
  nextDueAt: string | null;
  remainingAmountDue: Money;
  minimumPaymentRemaining: Money;
  sandbox: true;
};

export type CreditAccount = {
  creditAccountId: string;
  currency: "VND";
  creditLimit: Money;
  postedOutstanding: Money;
  pendingAuthorizations: Money;
  availableCredit: Money;
  nextStatementAt: string;
  status: CreditAccountStatus;
  version: number;
  updatedAt: string;
};

export type CreditTransaction = {
  transactionId: string;
  creditAccountId: string;
  statementId: string | null;
  type: CreditTransactionType;
  status: CreditTransactionStatus;
  description: string;
  merchantName: string | null;
  amount: Money;
  debtEffect: CreditDebtEffect;
  occurredAt: string;
  postedAt: string | null;
};

export type CreditPayment = {
  paymentId: string;
  statementId: string;
  sourceAccountId: string;
  amount: Money;
  reference: string;
  status: CreditPaymentStatus;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreditStatement = {
  statementId: string;
  creditAccountId: string;
  cycleStartAt: string;
  cycleEndAt: string;
  issuedAt: string;
  dueAt: string;
  openingBalance: Money;
  purchaseTotal: Money;
  refundTotal: Money;
  feeTotal: Money;
  interestTotal: Money;
  closingBalance: Money;
  remainingAmountDue: Money;
  minimumPaymentDue: Money;
  minimumPaymentRemaining: Money;
  paidAmount: Money;
  status: CreditStatementStatus;
  version: number;
  items: CreditTransaction[];
  payments: CreditPayment[];
};

export type CreditCardDetailResponse = {
  card: CreditCard;
  creditAccount: CreditAccount;
  latestStatement: CreditStatement | null;
};

export type CardReportedLostResponse = {
  card: CreditCard;
  caseId: string;
  caseStatus: "OPEN" | "IN_REVIEW" | "RESOLVED";
};

export type CreditCardsResponse = { items: CreditCard[] };
export type CreditAccountsResponse = { items: CreditAccount[] };
export type CreditTransactionsResponse = {
  items: CreditTransaction[];
  nextCursor: string | null;
};
export type CreditStatementsResponse = {
  items: CreditStatement[];
  nextCursor: string | null;
};
export type CreditStatementResponse = { statement: CreditStatement };

export type CreditStepUp = {
  method: CreditStepUpMethod;
  proof: string;
  challengeId?: string;
};

export type CreditApplicationStatus =
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "PENDING_ACTIVATION"
  | "ACTIVE"
  | "REJECTED";

export type CreditApplication = {
  applicationId: string;
  requestedLimit: Money;
  approvedLimit: Money | null;
  status: CreditApplicationStatus;
  decisionReason: string | null;
  creditAccountId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreditApplicationsResponse = { items: CreditApplication[] };

export type CreditApplicationRequest = {
  requestedLimit?: Money;
  stepUp: CreditStepUp;
};

export type CreditPaymentQuoteRequest = {
  sourceAccountId: string;
  creditAccountId: string;
  statementId: string;
  paymentOption: CreditPaymentOption;
  amount?: Money;
};

export type CreditPaymentQuote = {
  quoteId: string;
  sourceAccountId: string;
  sourceAccountMaskedNumber: string;
  creditAccountId: string;
  cardLastFour: string;
  statementId: string;
  statementVersion: number;
  paymentOption: CreditPaymentOption;
  amount: Money;
  fee: Money;
  outstandingBefore: Money;
  outstandingAfter: Money;
  minimumPaymentRemainingBefore: Money;
  minimumPaymentRemainingAfter: Money;
  terms: string;
  expiresAt: string;
};

export type CreditPaymentRequest = {
  quoteId: string;
  stepUp: CreditStepUp;
};

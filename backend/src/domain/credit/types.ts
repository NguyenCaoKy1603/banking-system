import type { Money } from "../money.js";

export const CREDIT_POLICY_VERSION = "m7-sandbox-1";
export const DEFAULT_CREDIT_LIMIT_MINOR = "20000000";
export const DEFAULT_POSTED_OUTSTANDING_MINOR = "4000000";
export const DEFAULT_CARD_LAST_FOUR = "2468";
export const CREDIT_QUOTE_TTL_MS = 5 * 60 * 1000;
export const CREDIT_STATEMENT_DUE_DAYS = 15;
export const CREDIT_STATEMENT_CLOSE_DAY = 25;
export const CREDIT_TIME_ZONE = "Asia/Ho_Chi_Minh";
export const CREDIT_MINIMUM_PAYMENT_RATE_PERCENT = 5n;
export const CREDIT_MINIMUM_PAYMENT_FLOOR_MINOR = 100_000n;

export type CreditCardStatus = "ACTIVE" | "LOCKED" | "BLOCKED" | "EXPIRED" | "CLOSED";
export type CardSecurityCaseStatus = "OPEN" | "IN_REVIEW" | "RESOLVED";
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

export type CreditApplicationRequest = {
  requestedLimit?: Money;
  stepUp: { method: "OTP" | "TOTP" | "BIOMETRIC"; proof: string; challengeId?: string };
};

export type CreditApplicationRecord = CreditApplication & {
  userId: string;
  requestFingerprint: string;
};

export type CardInstrument = {
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
};

export type CardReportedLostResult = {
  card: CreditCard;
  caseId: string;
  caseStatus: CardSecurityCaseStatus;
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

export type CreditCard = CardInstrument & {
  creditLimit: Money;
  availableCredit: Money;
  postedOutstanding: Money;
  pendingAuthorizations: Money;
  nextDueAt: string | null;
  remainingAmountDue: Money;
  minimumPaymentRemaining: Money;
  sandbox: true;
};

export type CreditCardDetail = {
  card: CreditCard;
  creditAccount: CreditAccount;
  latestStatement: CreditStatement | null;
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

export type CreditCardsResponse = { items: CreditCard[] };
export type CreditTransactionsResponse = { items: CreditTransaction[]; nextCursor: string | null };
export type CreditStatementsResponse = { items: CreditStatement[]; nextCursor: string | null };

export type CreditPaymentRequest = {
  quoteId: string;
  stepUp: { method: "OTP" | "TOTP" | "BIOMETRIC"; proof: string; challengeId?: string };
};

export type CreditPaymentQuoteRequest = {
  sourceAccountId: string;
  creditAccountId: string;
  statementId: string;
  paymentOption: CreditPaymentOption;
  amount?: Money;
};

export type CreditPaymentQuoteRecord = CreditPaymentQuote & {
  userId: string;
  requestFingerprint: string;
  consumedPaymentId: string | null;
};

export type CreditCardRecord = CardInstrument & { userId: string };
export type CreditAccountRecord = CreditAccount & { userId: string; customerId: string };
export type CreditTransactionRecord = CreditTransaction & {
  userId: string;
  paymentId?: string | null;
};
export type CreditStatementRecord = CreditStatement & { userId: string };
export type CreditPaymentRecord = CreditPayment & {
  userId: string;
  quoteId: string;
  cardId: string;
  creditAccountId: string;
  refundApplied: boolean;
  clearingApplied: boolean;
  creditApplied: boolean;
};
export type CreditIdempotencyRecord = {
  userId: string;
  fingerprint: string;
  paymentId: string;
};

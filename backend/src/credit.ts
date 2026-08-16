import { randomUUID } from "node:crypto";

import type { Money } from "./types.js";

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
  stepUp: { method: "OTP" | "BIOMETRIC"; proof: string; challengeId?: string };
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

export function newCreditId(): string {
  return randomUUID();
}

export function money(amountMinor: bigint): Money {
  return { currency: "VND", amountMinor: amountMinor.toString() };
}

export function cloneMoney(value: Money): Money {
  return { ...value };
}

export function addDays(isoDate: string, days: number): string {
  const time = Date.parse(isoDate);
  if (!Number.isFinite(time) || !Number.isInteger(days)) {
    throw new Error("Invalid credit date input.");
  }
  return new Date(time + days * 24 * 60 * 60 * 1000).toISOString();
}

export function addMonthsClamped(isoDate: string, months: number): string {
  const source = new Date(isoDate);
  if (!Number.isFinite(source.getTime()) || !Number.isInteger(months)) {
    throw new Error("Invalid credit month input.");
  }
  const day = source.getUTCDate();
  const targetMonth = source.getUTCMonth() + months;
  const targetYear = source.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      normalizedMonth,
      Math.min(day, lastDay),
      source.getUTCHours(),
      source.getUTCMinutes(),
      source.getUTCSeconds(),
      source.getUTCMilliseconds(),
    ),
  ).toISOString();
}

/**
 * Returns the next local midnight on the configured statement close day.
 * The sandbox uses Asia/Ho_Chi_Minh, which has a fixed UTC+07:00 offset.
 */
export function nextStatementCloseAt(isoDate: string): string {
  const sourceTime = Date.parse(isoDate);
  if (!Number.isFinite(sourceTime)) {
    throw new Error("Invalid credit statement date input.");
  }

  const localTime = new Date(sourceTime + 7 * 60 * 60 * 1000);
  const year = localTime.getUTCFullYear();
  const month = localTime.getUTCMonth();
  const toUtcClose = (targetYear: number, targetMonth: number): number =>
    Date.UTC(targetYear, targetMonth, CREDIT_STATEMENT_CLOSE_DAY, 0, 0, 0, 0) -
    7 * 60 * 60 * 1000;

  let closeAt = toUtcClose(year, month);
  if (closeAt <= sourceTime) {
    closeAt = toUtcClose(year, month + 1);
  }
  return new Date(closeAt).toISOString();
}

export function calculateMinimumPayment(closingBalanceMinor: bigint): bigint {
  if (closingBalanceMinor <= 0n) {
    return 0n;
  }
  const percentage = (closingBalanceMinor * CREDIT_MINIMUM_PAYMENT_RATE_PERCENT + 99n) / 100n;
  const calculatedMinimum = percentage > CREDIT_MINIMUM_PAYMENT_FLOOR_MINOR
    ? percentage
    : CREDIT_MINIMUM_PAYMENT_FLOOR_MINOR;
  return calculatedMinimum < closingBalanceMinor ? calculatedMinimum : closingBalanceMinor;
}

export function calculateAvailableCredit(
  creditLimitMinor: bigint,
  postedOutstandingMinor: bigint,
  pendingAuthorizationsMinor: bigint,
): bigint {
  return creditLimitMinor - postedOutstandingMinor - pendingAuthorizationsMinor;
}

export function getStatementStatus(
  remainingAmountDueMinor: bigint,
  paidAmountMinor: bigint,
  dueAt: string,
  now: number,
): CreditStatementStatus {
  if (remainingAmountDueMinor <= 0n) {
    return "PAID";
  }
  if (Date.parse(dueAt) <= now) {
    return "OVERDUE";
  }
  if (paidAmountMinor > 0n) {
    return "PARTIALLY_PAID";
  }
  return "ISSUED";
}

function cloneTransaction(transaction: CreditTransaction): CreditTransaction {
  return { ...transaction, amount: cloneMoney(transaction.amount) };
}

export function cloneCreditStatement(statement: CreditStatement): CreditStatement {
  return {
    ...statement,
    openingBalance: cloneMoney(statement.openingBalance),
    purchaseTotal: cloneMoney(statement.purchaseTotal),
    refundTotal: cloneMoney(statement.refundTotal),
    feeTotal: cloneMoney(statement.feeTotal),
    interestTotal: cloneMoney(statement.interestTotal),
    closingBalance: cloneMoney(statement.closingBalance),
    remainingAmountDue: cloneMoney(statement.remainingAmountDue),
    minimumPaymentDue: cloneMoney(statement.minimumPaymentDue),
    minimumPaymentRemaining: cloneMoney(statement.minimumPaymentRemaining),
    paidAmount: cloneMoney(statement.paidAmount),
    items: statement.items.map(cloneTransaction),
    payments: statement.payments.map((payment) => ({
      ...payment,
      amount: cloneMoney(payment.amount),
    })),
  };
}

export function cloneCreditCard(card: CreditCard): CreditCard {
  return {
    ...card,
    creditLimit: cloneMoney(card.creditLimit),
    availableCredit: cloneMoney(card.availableCredit),
    postedOutstanding: cloneMoney(card.postedOutstanding),
    pendingAuthorizations: cloneMoney(card.pendingAuthorizations),
    remainingAmountDue: cloneMoney(card.remainingAmountDue),
    minimumPaymentRemaining: cloneMoney(card.minimumPaymentRemaining),
  };
}

export function cloneCreditAccount(account: CreditAccount): CreditAccount {
  return {
    ...account,
    creditLimit: cloneMoney(account.creditLimit),
    postedOutstanding: cloneMoney(account.postedOutstanding),
    pendingAuthorizations: cloneMoney(account.pendingAuthorizations),
    availableCredit: cloneMoney(account.availableCredit),
  };
}

export function cloneCreditTransaction(transaction: CreditTransaction): CreditTransaction {
  return cloneTransaction(transaction);
}

export function cloneCreditPayment(payment: CreditPayment): CreditPayment {
  return { ...payment, amount: cloneMoney(payment.amount) };
}

export function cloneCreditQuote(quote: CreditPaymentQuote): CreditPaymentQuote {
  return {
    ...quote,
    amount: cloneMoney(quote.amount),
    fee: cloneMoney(quote.fee),
    outstandingBefore: cloneMoney(quote.outstandingBefore),
    outstandingAfter: cloneMoney(quote.outstandingAfter),
    minimumPaymentRemainingBefore: cloneMoney(quote.minimumPaymentRemainingBefore),
    minimumPaymentRemainingAfter: cloneMoney(quote.minimumPaymentRemainingAfter),
  };
}

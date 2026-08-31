import type {
  CardReportedLostResponse,
  CreditAccount,
  CreditAccountsResponse,
  CreditApplication,
  CreditApplicationsResponse,
  CreditCard,
  CreditCardDetailResponse,
  CreditCardsResponse,
  CreditPayment,
  CreditPaymentQuote,
  CreditStatement,
  CreditStatementResponse,
  CreditStatementsResponse,
  CreditTransaction,
  CreditTransactionsResponse,
} from "@/features/credit/types/credit";
import { isMoney } from "@/features/banking/validation/moneyValidators";
import { isNonEmptyDateTime } from "@/services/api/responseValidators";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isDateOrNull(value: unknown): value is string | null {
  return value === null || isNonEmptyDateTime(value);
}

function isCreditApplicationValue(value: unknown): value is CreditApplication {
  return (
    isRecord(value) &&
    isString(value.applicationId) &&
    isMoney(value.requestedLimit) &&
    (value.approvedLimit === null || isMoney(value.approvedLimit)) &&
    ["SUBMITTED", "UNDER_REVIEW", "PENDING_ACTIVATION", "ACTIVE", "REJECTED"].includes(String(value.status)) &&
    isNullableString(value.decisionReason) &&
    (value.creditAccountId === null || isString(value.creditAccountId)) &&
    isNonEmptyDateTime(value.createdAt) &&
    isNonEmptyDateTime(value.updatedAt)
  );
}

function isPositiveMoney(value: unknown): boolean {
  return isMoney(value) && BigInt(value.amountMinor) > 0n;
}

function isCreditCard(value: unknown): value is CreditCard {
  return (
    isRecord(value) &&
    isString(value.cardId) &&
    isString(value.creditAccountId) &&
    isString(value.displayName) &&
    (value.brand === "VISA" || value.brand === "MASTERCARD") &&
    isString(value.maskedNumber) &&
    typeof value.lastFour === "string" &&
    /^\d{4}$/.test(value.lastFour) &&
    typeof value.expiryMonth === "number" &&
    Number.isInteger(value.expiryMonth) &&
    value.expiryMonth >= 1 &&
    value.expiryMonth <= 12 &&
    Number.isInteger(value.expiryYear) &&
    (value.status === "ACTIVE" ||
      value.status === "LOCKED" ||
      value.status === "BLOCKED" ||
      value.status === "EXPIRED" ||
      value.status === "CLOSED") &&
    isNonEmptyDateTime(value.updatedAt) &&
    isMoney(value.creditLimit) &&
    isMoney(value.availableCredit) &&
    isMoney(value.postedOutstanding) &&
    isMoney(value.pendingAuthorizations) &&
    isDateOrNull(value.nextDueAt) &&
    isMoney(value.remainingAmountDue) &&
    isMoney(value.minimumPaymentRemaining) &&
    value.sandbox === true
  );
}

function isCreditAccount(value: unknown): value is CreditAccount {
  return (
    isRecord(value) &&
    isString(value.creditAccountId) &&
    value.currency === "VND" &&
    isMoney(value.creditLimit) &&
    isMoney(value.postedOutstanding) &&
    isMoney(value.pendingAuthorizations) &&
    isMoney(value.availableCredit) &&
    isNonEmptyDateTime(value.nextStatementAt) &&
    (value.status === "ACTIVE" || value.status === "FROZEN" || value.status === "CLOSED") &&
    typeof value.version === "number" &&
    Number.isInteger(value.version) &&
    value.version >= 0 &&
    isNonEmptyDateTime(value.updatedAt)
  );
}

function isCreditTransaction(value: unknown): value is CreditTransaction {
  return (
    isRecord(value) &&
    isString(value.transactionId) &&
    isString(value.creditAccountId) &&
    isNullableString(value.statementId) &&
    ["PURCHASE", "REFUND", "PAYMENT", "FEE", "INTEREST", "ADJUSTMENT"].includes(String(value.type)) &&
    ["PENDING", "POSTED", "REVERSED", "DECLINED"].includes(String(value.status)) &&
    typeof value.description === "string" &&
    isNullableString(value.merchantName) &&
    isPositiveMoney(value.amount) &&
    ["INCREASE", "DECREASE", "NONE"].includes(String(value.debtEffect)) &&
    isNonEmptyDateTime(value.occurredAt) &&
    isDateOrNull(value.postedAt)
  );
}

function isCreditPaymentRecord(value: unknown): value is CreditPayment {
  return (
    isRecord(value) &&
    isString(value.paymentId) &&
    isString(value.statementId) &&
    isString(value.sourceAccountId) &&
    isPositiveMoney(value.amount) &&
    isString(value.reference) &&
    ["PENDING", "SUCCEEDED", "FAILED", "REVERSED"].includes(String(value.status)) &&
    isNullableString(value.failureReason) &&
    isNonEmptyDateTime(value.createdAt) &&
    isNonEmptyDateTime(value.updatedAt)
  );
}

function isCreditStatement(value: unknown): value is CreditStatement {
  return (
    isRecord(value) &&
    isString(value.statementId) &&
    isString(value.creditAccountId) &&
    isNonEmptyDateTime(value.cycleStartAt) &&
    isNonEmptyDateTime(value.cycleEndAt) &&
    isNonEmptyDateTime(value.issuedAt) &&
    isNonEmptyDateTime(value.dueAt) &&
    isMoney(value.openingBalance) &&
    isMoney(value.purchaseTotal) &&
    isMoney(value.refundTotal) &&
    isMoney(value.feeTotal) &&
    isMoney(value.interestTotal) &&
    isMoney(value.closingBalance) &&
    isMoney(value.remainingAmountDue) &&
    isMoney(value.minimumPaymentDue) &&
    isMoney(value.minimumPaymentRemaining) &&
    isMoney(value.paidAmount) &&
    ["ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE"].includes(String(value.status)) &&
    typeof value.version === "number" &&
    Number.isInteger(value.version) &&
    value.version > 0 &&
    Array.isArray(value.items) &&
    value.items.every(isCreditTransaction) &&
    Array.isArray(value.payments) &&
    value.payments.every(isCreditPaymentRecord)
  );
}

export function isCreditCardResponse(value: unknown): value is { card: CreditCard } {
  return isRecord(value) && isCreditCard(value.card);
}

export function isCardReportedLostResponse(value: unknown): value is CardReportedLostResponse {
  return isRecord(value) && isCreditCard(value.card) && isString(value.caseId) &&
    ["OPEN", "IN_REVIEW", "RESOLVED"].includes(String(value.caseStatus));
}

export function isCreditCardsResponse(value: unknown): value is CreditCardsResponse {
  return isRecord(value) && Array.isArray(value.items) && value.items.every(isCreditCard);
}

export function isCreditCardDetailResponse(value: unknown): value is CreditCardDetailResponse {
  return (
    isRecord(value) &&
    isCreditCard(value.card) &&
    isCreditAccount(value.creditAccount) &&
    (value.latestStatement === null || isCreditStatement(value.latestStatement))
  );
}

export function isCreditAccountsResponse(value: unknown): value is CreditAccountsResponse {
  return isRecord(value) && Array.isArray(value.items) && value.items.every(isCreditAccount);
}

export function isCreditApplication(value: unknown): value is CreditApplication {
  return isCreditApplicationValue(value);
}

export function isCreditApplicationsResponse(value: unknown): value is CreditApplicationsResponse {
  return isRecord(value) && Array.isArray(value.items) && value.items.every(isCreditApplicationValue);
}

export function isCreditAccountResponse(value: unknown): value is CreditAccount {
  return isCreditAccount(value);
}

export function isCreditTransactionsResponse(value: unknown): value is CreditTransactionsResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isCreditTransaction) &&
    (value.nextCursor === null || typeof value.nextCursor === "string")
  );
}

export function isCreditStatementsResponse(value: unknown): value is CreditStatementsResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isCreditStatement) &&
    (value.nextCursor === null || typeof value.nextCursor === "string")
  );
}

export function isCreditStatementResponse(value: unknown): value is CreditStatementResponse {
  return isRecord(value) && isCreditStatement(value.statement);
}

export function isCreditPaymentQuote(value: unknown): value is CreditPaymentQuote {
  return (
    isRecord(value) &&
    isString(value.quoteId) &&
    isString(value.sourceAccountId) &&
    isString(value.sourceAccountMaskedNumber) &&
    isString(value.creditAccountId) &&
    typeof value.cardLastFour === "string" &&
    /^\d{4}$/.test(value.cardLastFour) &&
    isString(value.statementId) &&
    typeof value.statementVersion === "number" &&
    Number.isInteger(value.statementVersion) &&
    value.statementVersion > 0 &&
    ["MINIMUM", "FULL_STATEMENT", "CUSTOM"].includes(String(value.paymentOption)) &&
    isPositiveMoney(value.amount) &&
    isMoney(value.fee) &&
    isMoney(value.outstandingBefore) &&
    isMoney(value.outstandingAfter) &&
    isMoney(value.minimumPaymentRemainingBefore) &&
    isMoney(value.minimumPaymentRemainingAfter) &&
    typeof value.terms === "string" &&
    isNonEmptyDateTime(value.expiresAt)
  );
}

export function isCreditPayment(value: unknown): value is CreditPayment {
  return isCreditPaymentRecord(value);
}

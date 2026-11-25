import type {
  AccountMonthlySummary,
  AccountNumberResponse,
  AccountsResponse,
  PaymentAccount,
  Transaction,
  TransactionDetail,
  TransactionPage,
} from "@/features/accounts/types/account";
import { isMoney } from "@/features/banking/validation/moneyValidators";
import { isNonEmptyDateTime } from "@/services/api/responseValidators";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isPaymentAccount(value: unknown): value is PaymentAccount {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.displayName) &&
    isNonEmptyString(value.maskedNumber) &&
    isNonEmptyString(value.bankName) &&
    value.currency === "VND" &&
    isMoney(value.heldAmount) &&
    isMoney(value.availableBalance) &&
    isMoney(value.currentBalance) &&
    (value.status === "ACTIVE" || value.status === "BLOCKED") &&
    isNonEmptyDateTime(value.updatedAt)
  );
}

function hasTransactionFields(value: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.accountId) &&
    (value.direction === "CREDIT" || value.direction === "DEBIT") &&
    isMoney(value.amount) &&
    isMoney(value.fee) &&
    (value.status === "PENDING" ||
      value.status === "SUCCEEDED" ||
      value.status === "FAILED" ||
      value.status === "REVERSED") &&
    (value.kind === undefined ||
      value.kind === "TRANSFER" ||
      value.kind === "SANDBOX_FUNDING" ||
      value.kind === "SAVINGS" ||
      value.kind === "CREDIT_PAYMENT" ||
      value.kind === "MATURITY") &&
    typeof value.description === "string" &&
    isNullableString(value.counterpartyName) &&
    isNonEmptyDateTime(value.occurredAt)
  );
}

export function isTransaction(value: unknown): value is Transaction {
  return isRecord(value) && hasTransactionFields(value);
}

export function isAccountsResponse(value: unknown): value is AccountsResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.accounts) &&
    value.accounts.every(isPaymentAccount)
  );
}

export function isAccountNumberResponse(
  value: unknown,
): value is AccountNumberResponse {
  return (
    isRecord(value) &&
    isNonEmptyString(value.accountNumber) &&
    /^\d{6,34}$/.test(value.accountNumber)
  );
}

export function isTransactionPage(value: unknown): value is TransactionPage {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isTransaction) &&
    (value.nextCursor === null || typeof value.nextCursor === "string")
  );
}

export function isTransactionDetail(
  value: unknown,
): value is TransactionDetail {
  return (
    isRecord(value) &&
    hasTransactionFields(value) &&
    isNonEmptyString(value.reference) &&
    isNonEmptyDateTime(value.createdAt) &&
    (value.completedAt === null || isNonEmptyDateTime(value.completedAt))
  );
}

export function isAccountMonthlySummary(
  value: unknown,
): value is AccountMonthlySummary {
  return (
    isRecord(value) &&
    isNonEmptyString(value.accountId) &&
    isNonEmptyString(value.month) &&
    isNonEmptyString(value.monthLabel) &&
    value.currency === "VND" &&
    typeof value.totalIncomeMinor === "string" &&
    /^\d+$/.test(value.totalIncomeMinor) &&
    typeof value.totalExpenseMinor === "string" &&
    /^\d+$/.test(value.totalExpenseMinor) &&
    typeof value.netMinor === "string" &&
    /^-?\d+$/.test(value.netMinor) &&
    typeof value.succeededCount === "number" &&
    Number.isInteger(value.succeededCount) &&
    value.succeededCount >= 0 &&
    typeof value.creditCount === "number" &&
    Number.isInteger(value.creditCount) &&
    value.creditCount >= 0 &&
    typeof value.debitCount === "number" &&
    Number.isInteger(value.debitCount) &&
    value.debitCount >= 0
  );
}

import type {
  MaturityInstruction,
  SavingsDeposit,
  SavingsDepositsResponse,
  SavingsOpening,
  SavingsProduct,
  SavingsProductsResponse,
  SavingsQuote,
  SavingsTermMonths,
  SavingsWithdrawalReceipt,
} from "@/features/savings/types/savings";
import { isMoney } from "@/features/banking/validation/moneyValidators";
import { isNonEmptyDateTime } from "@/services/api/responseValidators";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTerm(value: unknown): value is SavingsTermMonths {
  return value === 1 || value === 3 || value === 6 || value === 12;
}

function isInstruction(value: unknown): value is MaturityInstruction {
  return (
    value === "RETURN_PRINCIPAL_AND_INTEREST" ||
    value === "RENEW_PRINCIPAL" ||
    value === "RENEW_PRINCIPAL_AND_INTEREST"
  );
}

export function isSavingsProduct(value: unknown): value is SavingsProduct {
  return (
    isRecord(value) &&
    isNonEmptyString(value.productId) &&
    isNonEmptyString(value.name) &&
    isTerm(value.termMonths) &&
    typeof value.annualRateBasisPoints === "number" &&
    Number.isInteger(value.annualRateBasisPoints) &&
    value.annualRateBasisPoints >= 0 &&
    value.currency === "VND" &&
    typeof value.minAmountMinor === "string" &&
    /^(0|[1-9][0-9]*)$/.test(value.minAmountMinor) &&
    typeof value.maxAmountMinor === "string" &&
    /^(0|[1-9][0-9]*)$/.test(value.maxAmountMinor) &&
    (value.status === "ACTIVE" || value.status === "INACTIVE") &&
    isNonEmptyString(value.termsVersion)
  );
}

export function isSavingsProductsResponse(
  value: unknown,
): value is SavingsProductsResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every((item) => isSavingsProduct(item))
  );
}

export function isSavingsQuote(value: unknown): value is SavingsQuote {
  return (
    isRecord(value) &&
    isNonEmptyString(value.quoteId) &&
    isNonEmptyString(value.productId) &&
    isNonEmptyString(value.productName) &&
    isNonEmptyString(value.termsVersion) &&
    isTerm(value.termMonths) &&
    isNonEmptyString(value.sourceAccountId) &&
    isNonEmptyString(value.sourceAccountMaskedNumber) &&
    isMoney(value.principal) &&
    typeof value.annualRateBasisPoints === "number" &&
    Number.isInteger(value.annualRateBasisPoints) &&
    typeof value.interestDays === "number" &&
    Number.isInteger(value.interestDays) &&
    value.interestDays > 0 &&
    isMoney(value.expectedInterest) &&
    isMoney(value.totalAtMaturity) &&
    isNonEmptyDateTime(value.openedAt) &&
    isNonEmptyDateTime(value.maturityAt) &&
    isInstruction(value.maturityInstruction) &&
    isNonEmptyDateTime(value.expiresAt)
  );
}

export function isSavingsOpening(value: unknown): value is SavingsOpening {
  return (
    isRecord(value) &&
    isNonEmptyString(value.openingId) &&
    isNonEmptyString(value.quoteId) &&
    (typeof value.depositId === "string" || value.depositId === null) &&
    (value.status === "PENDING" ||
      value.status === "SUCCEEDED" ||
      value.status === "FAILED" ||
      value.status === "REVERSED") &&
    (typeof value.reference === "string" || value.reference === null) &&
    (typeof value.failureReason === "string" || value.failureReason === null) &&
    isNonEmptyDateTime(value.createdAt) &&
    isNonEmptyDateTime(value.updatedAt)
  );
}

export function isSavingsDeposit(value: unknown): value is SavingsDeposit {
  return (
    isRecord(value) &&
    isNonEmptyString(value.depositId) &&
    isNonEmptyString(value.productId) &&
    isNonEmptyString(value.productName) &&
    isNonEmptyString(value.termsVersion) &&
    isTerm(value.termMonths) &&
    isMoney(value.principal) &&
    typeof value.annualRateBasisPoints === "number" &&
    Number.isInteger(value.annualRateBasisPoints) &&
    isMoney(value.expectedInterest) &&
    isMoney(value.totalAtMaturity) &&
    isNonEmptyDateTime(value.openedAt) &&
    isNonEmptyDateTime(value.maturityAt) &&
    isInstruction(value.maturityInstruction) &&
    isNonEmptyString(value.sourceAccountMaskedNumber) &&
    (value.status === "ACTIVE" || value.status === "MATURED" || value.status === "CLOSED") &&
    isNonEmptyString(value.reference) &&
    isNonEmptyDateTime(value.updatedAt) &&
    (typeof value.renewedDepositId === "string" || value.renewedDepositId === null)
  );
}

export function isSavingsDepositsResponse(
  value: unknown,
): value is SavingsDepositsResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every((item) => isSavingsDeposit(item)) &&
    isMoney(value.totalPrincipal)
  );
}

export function isSavingsWithdrawalReceipt(
  value: unknown,
): value is SavingsWithdrawalReceipt {
  return (
    isRecord(value) &&
    isNonEmptyString(value.depositId) &&
    isNonEmptyString(value.sourceAccountId) &&
    isMoney(value.principal) &&
    typeof value.interestDays === "number" &&
    Number.isInteger(value.interestDays) &&
    value.interestDays >= 0 &&
    typeof value.demandRateBasisPoints === "number" &&
    Number.isInteger(value.demandRateBasisPoints) &&
    isMoney(value.earlyInterest) &&
    isMoney(value.totalPayout) &&
    value.status === "CLOSED" &&
    isNonEmptyString(value.reference) &&
    isNonEmptyDateTime(value.withdrawnAt)
  );
}

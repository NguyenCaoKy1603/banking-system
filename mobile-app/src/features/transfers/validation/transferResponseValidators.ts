import type {
  Beneficiary,
  BeneficiariesResponse,
  BeneficiaryResponse,
  TransferQuote,
  TransferReceipt,
} from "@/features/transfers/types/transfer";
import { isMoney } from "@/features/banking/validation/moneyValidators";
import { isNonEmptyDateTime } from "@/services/api/responseValidators";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isBeneficiary(value: unknown): value is Beneficiary {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.displayName) &&
    isNonEmptyString(value.maskedAccountNumber) &&
    isNonEmptyString(value.bankName) &&
    (value.status === "ACTIVE" || value.status === "BLOCKED")
  );
}

function isTransferStatus(value: unknown): value is TransferReceipt["status"] {
  return (
    value === "PENDING" ||
    value === "SUCCEEDED" ||
    value === "FAILED" ||
    value === "REVERSED"
  );
}

export function isBeneficiaryResponse(
  value: unknown,
): value is BeneficiaryResponse {
  return isRecord(value) && isBeneficiary(value.beneficiary);
}

export function isBeneficiariesResponse(
  value: unknown,
): value is BeneficiariesResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every((item) => isBeneficiary(item))
  );
}

export function isTransferQuote(value: unknown): value is TransferQuote {
  return (
    isRecord(value) &&
    isNonEmptyString(value.quoteId) &&
    isNonEmptyString(value.sourceAccountId) &&
    isBeneficiary(value.beneficiary) &&
    isMoney(value.amount) &&
    isMoney(value.fee) &&
    isMoney(value.totalDebit) &&
    isNonEmptyDateTime(value.expiresAt)
  );
}

export function isTransferReceipt(value: unknown): value is TransferReceipt {
  return (
    isRecord(value) &&
    isNonEmptyString(value.transferId) &&
    isNonEmptyString(value.reference) &&
    isTransferStatus(value.status) &&
    isMoney(value.amount) &&
    isMoney(value.fee) &&
    isNonEmptyDateTime(value.createdAt) &&
    isNonEmptyDateTime(value.updatedAt)
  );
}

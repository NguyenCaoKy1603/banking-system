import type { RequestAuth } from "@/services/api/httpClient";
import { requestJson } from "@/services/api/httpClient";
import type { Money } from "@/features/banking/types/money";
import {
  COMMAND_IDEMPOTENCY_KEY_MIN_LENGTH,
  requireIdempotencyKey,
} from "@/features/banking/validation/idempotencyKey";
import type {
  BeneficiariesResponse,
  BeneficiaryResponse,
  CreateBeneficiaryRequest,
  ExternalRecipientLookupResponse,
  InternalRecipientLookupResponse,
  RenameBeneficiaryRequest,
  SubmitTransferRequest,
  TransferQuote,
  TransferQuoteRequest,
  TransferReceipt,
} from "@/features/transfers/types/transfer";
import {
  isBeneficiaryResponse,
  isBeneficiariesResponse,
  isTransferQuote,
  isTransferReceipt,
} from "@/features/transfers/validation/transferResponseValidators";
import { isMoney } from "@/features/banking/validation/moneyValidators";

export type SubmitTransferOptions = {
  auth: RequestAuth;
  idempotencyKey: string;
};

function requireResourceId(value: string, fieldName: string): string {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new TypeError(`${fieldName} không được để trống.`);
  }

  return encodeURIComponent(normalizedValue);
}

function validateMoney(value: Money, fieldName: string): void {
  if (!isMoney(value)) {
    throw new TypeError(`${fieldName} không đúng định dạng tiền tệ.`);
  }
}

function validateQuoteRequest(request: TransferQuoteRequest): void {
  requireResourceId(request.sourceAccountId, "sourceAccountId");
  const hasBeneficiary = Boolean(request.beneficiaryId?.trim());
  const hasLookup = Boolean(request.lookupId?.trim());
  if (hasBeneficiary === hasLookup) {
    throw new TypeError("Cần đúng một beneficiaryId hoặc lookupId.");
  }
  validateMoney(request.amount, "amount");
}

function validateSubmitRequest(request: SubmitTransferRequest): void {
  requireResourceId(request.quoteId, "quoteId");

  if (
    !request.stepUp ||
    (request.stepUp.method !== "OTP" && request.stepUp.method !== "TOTP" && request.stepUp.method !== "BIOMETRIC") ||
    typeof request.stepUp.proof !== "string" ||
    !request.stepUp.proof.trim()
  ) {
    throw new TypeError("stepUp.proof không được để trống.");
  }
}

function validateBeneficiaryInput(request: CreateBeneficiaryRequest): void {
  if (request.displayName.trim().length < 2) {
    throw new TypeError("displayName ph\u1ea3i c\u00f3 ít nh\u1ea5t 2 k\u00fd t\u1ef1.");
  }
  if (!/^\d{6,34}$/.test(request.accountNumber.replace(/\s+/g, ""))) {
    throw new TypeError("accountNumber ph\u1ea3i c\u00f3 t\u1eeb 6 \u0111\u1ebfn 34 ch\u1eef s\u1ed1.");
  }
}

function validateBeneficiaryName(request: RenameBeneficiaryRequest): void {
  if (request.displayName.trim().length < 2) {
    throw new TypeError("displayName ph\u1ea3i c\u00f3 ít nh\u1ea5t 2 k\u00fd t\u1ef1.");
  }
}

export function listBeneficiaries(
  auth: RequestAuth,
): Promise<BeneficiariesResponse> {
  return requestJson<BeneficiariesResponse>(
    "/beneficiaries",
    { auth },
    isBeneficiariesResponse,
  );
}

export function createBeneficiary(
  request: CreateBeneficiaryRequest,
  auth: RequestAuth,
): Promise<BeneficiaryResponse> {
  validateBeneficiaryInput(request);
  return requestJson<BeneficiaryResponse>(
    "/beneficiaries",
    { method: "POST", body: request, auth },
    isBeneficiaryResponse,
  );
}

export function renameBeneficiary(
  beneficiaryId: string,
  request: RenameBeneficiaryRequest,
  auth: RequestAuth,
): Promise<BeneficiaryResponse> {
  validateBeneficiaryName(request);
  return requestJson<BeneficiaryResponse>(
    `/beneficiaries/${requireResourceId(beneficiaryId, "beneficiaryId")}`,
    { method: "PATCH", body: request, auth },
    isBeneficiaryResponse,
  );
}

export async function deleteBeneficiary(
  beneficiaryId: string,
  auth: RequestAuth,
): Promise<void> {
  await requestJson<null>(
    `/beneficiaries/${requireResourceId(beneficiaryId, "beneficiaryId")}`,
    { method: "DELETE", auth },
  );
}

export function lookupBeneficiary(
  beneficiaryId: string,
  auth: RequestAuth,
): Promise<BeneficiaryResponse> {
  return requestJson<BeneficiaryResponse>(
    `/beneficiaries/${requireResourceId(beneficiaryId, "beneficiaryId")}`,
    { auth },
    isBeneficiaryResponse,
  );
}

export function lookupInternalRecipient(
  accountNumber: string,
  auth: RequestAuth,
): Promise<InternalRecipientLookupResponse> {
  const normalized = accountNumber.replace(/\s+/g, "");
  if (!/^\d{6,34}$/.test(normalized)) {
    throw new TypeError("accountNumber phải có từ 6 đến 34 chữ số.");
  }
  return requestJson<InternalRecipientLookupResponse>(
    "/internal-recipients/lookup",
    { method: "POST", body: { accountNumber: normalized }, auth },
    (payload): payload is InternalRecipientLookupResponse => {
      if (!payload || typeof payload !== "object" || !("recipient" in payload)) {
        return false;
      }
      const recipient = (payload as { recipient?: unknown }).recipient;
      if (!recipient || typeof recipient !== "object") {
        return false;
      }
      const value = recipient as Record<string, unknown>;
      return (
        typeof value.lookupId === "string" &&
        value.lookupId.trim().length > 0 &&
        typeof value.accountHolderName === "string" &&
        value.accountHolderName.trim().length > 0 &&
        typeof value.maskedAccountNumber === "string" &&
        value.maskedAccountNumber.trim().length > 0 &&
        typeof value.bankName === "string" &&
        value.bankName.trim().length > 0 &&
        (value.status === "ACTIVE" || value.status === "BLOCKED") &&
        typeof value.expiresAt === "string"
      );
    },
  );
}

export function lookupExternalRecipient(
  bankBin: string,
  accountNumber: string,
  auth: RequestAuth,
): Promise<ExternalRecipientLookupResponse> {
  const normalizedBin = bankBin.replace(/\s+/g, "");
  const normalizedAccount = accountNumber.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalizedBin)) {
    throw new TypeError("bankBin phải gồm 6 chữ số.");
  }
  if (!/^\d{6,34}$/.test(normalizedAccount)) {
    throw new TypeError("accountNumber phải có từ 6 đến 34 chữ số.");
  }
  return requestJson<ExternalRecipientLookupResponse>(
    "/external-recipients/lookup",
    {
      method: "POST",
      body: { bankBin: normalizedBin, accountNumber: normalizedAccount },
      auth,
    },
    (payload): payload is ExternalRecipientLookupResponse => {
      if (!payload || typeof payload !== "object" || !("recipient" in payload)) {
        return false;
      }
      const recipient = (payload as { recipient?: unknown }).recipient;
      if (!recipient || typeof recipient !== "object") {
        return false;
      }
      const value = recipient as Record<string, unknown>;
      return (
        typeof value.lookupId === "string" &&
        value.lookupId.trim().length > 0 &&
        value.rail === "NAPAS_IBFT" &&
        typeof value.bankBin === "string" &&
        typeof value.bankCode === "string" &&
        typeof value.accountHolderName === "string" &&
        value.accountHolderName.trim().length > 0 &&
        typeof value.maskedAccountNumber === "string" &&
        value.maskedAccountNumber.trim().length > 0 &&
        typeof value.bankName === "string" &&
        value.bankName.trim().length > 0 &&
        (value.status === "ACTIVE" || value.status === "BLOCKED") &&
        typeof value.expiresAt === "string"
      );
    },
  );
}

export function quoteTransfer(
  request: TransferQuoteRequest,
  auth: RequestAuth,
): Promise<TransferQuote> {
  validateQuoteRequest(request);

  return requestJson<TransferQuote>(
    "/transfers/quote",
    { method: "POST", body: request, auth },
    isTransferQuote,
  );
}

export function submitTransfer(
  request: SubmitTransferRequest,
  { auth, idempotencyKey }: SubmitTransferOptions,
): Promise<TransferReceipt> {
  validateSubmitRequest(request);
  const normalizedIdempotencyKey = requireIdempotencyKey(
    idempotencyKey,
    COMMAND_IDEMPOTENCY_KEY_MIN_LENGTH,
  );

  return requestJson<TransferReceipt>(
    "/transfers",
    {
      method: "POST",
      body: request,
      auth,
      idempotencyKey: normalizedIdempotencyKey,
    },
    isTransferReceipt,
  );
}

export function getTransfer(
  transferId: string,
  auth: RequestAuth,
): Promise<TransferReceipt> {
  return requestJson<TransferReceipt>(
    `/transfers/${requireResourceId(transferId, "transferId")}`,
    { auth },
    isTransferReceipt,
  );
}

export const transfersApi = {
  listBeneficiaries,
  createBeneficiary,
  renameBeneficiary,
  deleteBeneficiary,
  lookupBeneficiary,
  quoteTransfer,
  submitTransfer,
  getTransfer,
  lookupInternalRecipient,
  lookupExternalRecipient,
};

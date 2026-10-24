import type { RequestAuth } from "@/services/api/httpClient";
import { requestJson } from "@/services/api/httpClient";
import type { Money } from "@/features/banking/types/money";
import {
  COMMAND_IDEMPOTENCY_KEY_MIN_LENGTH,
  requireIdempotencyKey,
} from "@/features/banking/validation/idempotencyKey";
import { isMoney } from "@/features/banking/validation/moneyValidators";
import type {
  MaturityInstruction,
  SavingsDeposit,
  SavingsDepositsResponse,
  SavingsOpening,
  SavingsProductsResponse,
  SavingsQuote,
  SavingsQuoteRequest,
  SavingsWithdrawalReceipt,
  SubmitSavingsOpeningRequest,
  SubmitSavingsWithdrawalRequest,
} from "@/features/savings/types/savings";
import {
  isSavingsDeposit,
  isSavingsDepositsResponse,
  isSavingsOpening,
  isSavingsProductsResponse,
  isSavingsQuote,
  isSavingsWithdrawalReceipt,
} from "@/features/savings/validation/savingsResponseValidators";

function requireResourceId(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${fieldName} không được để trống.`);
  }
  return encodeURIComponent(normalized);
}

function validateMoney(value: Money, fieldName: string): void {
  if (!isMoney(value) || BigInt(value.amountMinor) <= 0n) {
    throw new TypeError(`${fieldName} phải là số nguyên dương VND.`);
  }
}

function validateQuoteRequest(request: SavingsQuoteRequest): void {
  requireResourceId(request.sourceAccountId, "sourceAccountId");
  requireResourceId(request.productId, "productId");
  validateMoney(request.principal, "principal");
  if (
    request.maturityInstruction !== "RETURN_PRINCIPAL_AND_INTEREST" &&
    request.maturityInstruction !== "RENEW_PRINCIPAL" &&
    request.maturityInstruction !== "RENEW_PRINCIPAL_AND_INTEREST"
  ) {
    throw new TypeError("maturityInstruction không hợp lệ.");
  }
}

function validateSubmitRequest(request: SubmitSavingsOpeningRequest): void {
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

export function listSavingsProducts(
  auth: RequestAuth,
): Promise<SavingsProductsResponse> {
  return requestJson<SavingsProductsResponse>(
    "/savings/products",
    { auth },
    isSavingsProductsResponse,
  );
}

export function quoteSavings(
  request: SavingsQuoteRequest,
  auth: RequestAuth,
): Promise<SavingsQuote> {
  validateQuoteRequest(request);
  return requestJson<SavingsQuote>(
    "/savings/quotes",
    { method: "POST", body: request, auth },
    isSavingsQuote,
  );
}

export function submitSavingsOpening(
  request: SubmitSavingsOpeningRequest,
  options: { auth: RequestAuth; idempotencyKey: string },
): Promise<SavingsOpening> {
  validateSubmitRequest(request);
  const idempotencyKey = requireIdempotencyKey(
    options.idempotencyKey,
    COMMAND_IDEMPOTENCY_KEY_MIN_LENGTH,
  );
  return requestJson<SavingsOpening>(
    "/savings/deposits",
    {
      method: "POST",
      body: request,
      auth: options.auth,
      idempotencyKey,
    },
    isSavingsOpening,
  );
}

export function getSavingsOpening(
  openingId: string,
  auth: RequestAuth,
): Promise<SavingsOpening> {
  return requestJson<SavingsOpening>(
    `/savings/openings/${requireResourceId(openingId, "openingId")}`,
    { auth },
    isSavingsOpening,
  );
}

export function listSavingsDeposits(
  auth: RequestAuth,
): Promise<SavingsDepositsResponse> {
  return requestJson<SavingsDepositsResponse>(
    "/savings/deposits",
    { auth },
    isSavingsDepositsResponse,
  );
}

export function getSavingsDeposit(
  depositId: string,
  auth: RequestAuth,
): Promise<SavingsDeposit> {
  return requestJson<SavingsDeposit>(
    `/savings/deposits/${requireResourceId(depositId, "depositId")}`,
    { auth },
    isSavingsDeposit,
  );
}

export function updateSavingsDepositMaturityInstruction(
  depositId: string,
  maturityInstruction: MaturityInstruction,
  auth: RequestAuth,
): Promise<SavingsDeposit> {
  return requestJson<SavingsDeposit>(
    `/savings/deposits/${requireResourceId(depositId, "depositId")}`,
    {
      method: "PATCH",
      body: { maturityInstruction },
      auth,
    },
    isSavingsDeposit,
  );
}

export function withdrawSavingsDeposit(
  depositId: string,
  request: SubmitSavingsWithdrawalRequest,
  options: { auth: RequestAuth; idempotencyKey: string },
): Promise<SavingsWithdrawalReceipt> {
  const idempotencyKey = requireIdempotencyKey(
    options.idempotencyKey,
    COMMAND_IDEMPOTENCY_KEY_MIN_LENGTH,
  );
  return requestJson<SavingsWithdrawalReceipt>(
    `/savings/deposits/${requireResourceId(depositId, "depositId")}/withdraw`,
    {
      method: "POST",
      body: request,
      auth: options.auth,
      idempotencyKey,
    },
    isSavingsWithdrawalReceipt,
  );
}

export const savingsApi = {
  listSavingsProducts,
  quoteSavings,
  submitSavingsOpening,
  getSavingsOpening,
  listSavingsDeposits,
  getSavingsDeposit,
  updateSavingsDepositMaturityInstruction,
  withdrawSavingsDeposit,
};

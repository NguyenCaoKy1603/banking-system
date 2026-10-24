import type { RequestAuth } from "@/services/api/httpClient";
import { requestJson } from "@/services/api/httpClient";
import type { Money } from "@/features/banking/types/money";
import {
  COMMAND_IDEMPOTENCY_KEY_MIN_LENGTH,
  GENERAL_IDEMPOTENCY_KEY_MIN_LENGTH,
  requireIdempotencyKey,
} from "@/features/banking/validation/idempotencyKey";
import { isMoney } from "@/features/banking/validation/moneyValidators";
import type {
  CardReportedLostResponse,
  CreditAccount,
  CreditAccountsResponse,
  CreditApplication,
  CreditApplicationsResponse,
  CreditApplicationRequest,
  CreditCard,
  CreditCardDetailResponse,
  CreditCardsResponse,
  CreditPayment,
  CreditPaymentQuote,
  CreditPaymentQuoteRequest,
  CreditPaymentRequest,
  CreditStatement,
  CreditStatementsResponse,
  CreditTransactionsResponse,
} from "@/features/credit/types/credit";
import {
  isCardReportedLostResponse,
  isCreditAccountResponse,
  isCreditAccountsResponse,
  isCreditApplication,
  isCreditApplicationsResponse,
  isCreditCardDetailResponse,
  isCreditCardResponse,
  isCreditCardsResponse,
  isCreditPayment,
  isCreditPaymentQuote,
  isCreditStatementResponse,
  isCreditStatementsResponse,
  isCreditTransactionsResponse,
} from "@/features/credit/validation/creditResponseValidators";

function requireResourceId(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${fieldName} không được để trống.`);
  }
  return encodeURIComponent(normalized);
}

function validateMoney(value: Money, fieldName: string, allowZero = false): void {
  if (!isMoney(value)) {
    throw new TypeError(`${fieldName} phải là tiền VND hợp lệ.`);
  }
  const amount = BigInt(value.amountMinor);
  if (allowZero ? amount < 0n : amount <= 0n) {
    throw new TypeError(`${fieldName} phải là số tiền hợp lệ.`);
  }
}

function validateQuoteRequest(request: CreditPaymentQuoteRequest): void {
  requireResourceId(request.sourceAccountId, "sourceAccountId");
  requireResourceId(request.creditAccountId, "creditAccountId");
  requireResourceId(request.statementId, "statementId");
  if (!["MINIMUM", "FULL_STATEMENT", "CUSTOM"].includes(request.paymentOption)) {
    throw new TypeError("paymentOption không hợp lệ.");
  }
  if (request.paymentOption === "CUSTOM") {
    if (!request.amount) throw new TypeError("amount bắt buộc cho CUSTOM.");
    validateMoney(request.amount, "amount");
  } else if (request.amount !== undefined) {
    validateMoney(request.amount, "amount", true);
  }
}

function validateStepUp(request: CreditPaymentRequest): void {
  requireResourceId(request.quoteId, "quoteId");
  if (
    !request.stepUp ||
    (request.stepUp.method !== "OTP" && request.stepUp.method !== "TOTP" && request.stepUp.method !== "BIOMETRIC") ||
    !request.stepUp.proof.trim()
  ) {
    throw new TypeError("stepUp.proof không được để trống.");
  }
}

function buildListPath(basePath: string, cursor?: string, limit?: number): string {
  const query: string[] = [];
  if (cursor?.trim()) query.push(`cursor=${encodeURIComponent(cursor.trim())}`);
  if (limit !== undefined) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("limit phải là số nguyên từ 1 đến 100.");
    }
    query.push(`limit=${limit}`);
  }
  return query.length > 0 ? `${basePath}?${query.join("&")}` : basePath;
}

export function listCreditCards(auth: RequestAuth): Promise<CreditCardsResponse> {
  return requestJson("/cards", { auth }, isCreditCardsResponse);
}

export function getCreditCard(cardId: string, auth: RequestAuth): Promise<CreditCardDetailResponse> {
  return requestJson(
    `/cards/${requireResourceId(cardId, "cardId")}`,
    { auth },
    isCreditCardDetailResponse,
  );
}

type CardControlStepUp = {
  method: "TOTP";
  proof: string;
  challengeId: string;
};

function validateCardControlStepUp(stepUp: CardControlStepUp): void {
  if (
    !stepUp.challengeId.trim() ||
    stepUp.method !== "TOTP" ||
    !stepUp.proof.trim()
  ) {
    throw new TypeError("stepUp.challengeId và stepUp.proof không được để trống.");
  }
}

export function lockCreditCard(
  cardId: string,
  auth: RequestAuth,
): Promise<{ card: CreditCard }> {
  return requestJson(
    `/cards/${requireResourceId(cardId, "cardId")}/lock`,
    { method: "POST", auth },
    isCreditCardResponse,
  );
}

export function unlockCreditCard(
  cardId: string,
  stepUp: CardControlStepUp,
  auth: RequestAuth,
): Promise<{ card: CreditCard }> {
  validateCardControlStepUp(stepUp);
  return requestJson(
    `/cards/${requireResourceId(cardId, "cardId")}/unlock`,
    { method: "POST", body: { stepUp }, auth },
    isCreditCardResponse,
  );
}

export function reportCreditCardLost(
  cardId: string,
  stepUp: CardControlStepUp,
  auth: RequestAuth,
): Promise<CardReportedLostResponse> {
  validateCardControlStepUp(stepUp);
  return requestJson(
    `/cards/${requireResourceId(cardId, "cardId")}/report-lost`,
    { method: "POST", body: { stepUp }, auth },
    isCardReportedLostResponse,
  );
}

export function listCreditAccounts(auth: RequestAuth): Promise<CreditAccountsResponse> {
  return requestJson("/credit/accounts", { auth }, isCreditAccountsResponse);
}

export function listCreditApplications(auth: RequestAuth): Promise<CreditApplicationsResponse> {
  return requestJson("/credit/applications", { auth }, isCreditApplicationsResponse);
}

export function submitCreditApplication(
  request: CreditApplicationRequest,
  options: { auth: RequestAuth; idempotencyKey: string },
): Promise<CreditApplication> {
  validateStepUp({ quoteId: "credit-application", stepUp: request.stepUp });
  const idempotencyKey = requireIdempotencyKey(
    options.idempotencyKey,
    GENERAL_IDEMPOTENCY_KEY_MIN_LENGTH,
  );
  if (request.requestedLimit !== undefined) {
    validateMoney(request.requestedLimit, "requestedLimit");
  }
  return requestJson(
    "/credit/applications",
    { method: "POST", body: request, auth: options.auth, idempotencyKey },
    isCreditApplication,
  );
}

export function activateCreditApplication(
  applicationId: string,
  stepUp: { method: "OTP" | "TOTP" | "BIOMETRIC"; proof: string; challengeId?: string },
  options: { auth: RequestAuth; idempotencyKey: string },
): Promise<CreditApplication> {
  validateStepUp({ quoteId: applicationId, stepUp });
  const idempotencyKey = requireIdempotencyKey(
    options.idempotencyKey,
    GENERAL_IDEMPOTENCY_KEY_MIN_LENGTH,
  );
  return requestJson(
    `/credit/applications/${requireResourceId(applicationId, "applicationId")}/activate`,
    { method: "POST", body: { stepUp }, auth: options.auth, idempotencyKey },
    isCreditApplication,
  );
}

export function getCreditAccount(creditAccountId: string, auth: RequestAuth): Promise<CreditAccount> {
  return requestJson(
    `/credit/accounts/${requireResourceId(creditAccountId, "creditAccountId")}`,
    { auth },
    isCreditAccountResponse,
  );
}

export function listCreditTransactions(
  creditAccountId: string,
  options: { auth: RequestAuth; cursor?: string; limit?: number },
): Promise<CreditTransactionsResponse> {
  return requestJson(
    buildListPath(`/credit/accounts/${requireResourceId(creditAccountId, "creditAccountId")}/transactions`, options.cursor, options.limit),
    { auth: options.auth },
    isCreditTransactionsResponse,
  );
}

export function listCreditStatements(
  creditAccountId: string,
  options: { auth: RequestAuth; cursor?: string; limit?: number },
): Promise<CreditStatementsResponse> {
  return requestJson(
    buildListPath(`/credit/accounts/${requireResourceId(creditAccountId, "creditAccountId")}/statements`, options.cursor, options.limit),
    { auth: options.auth },
    isCreditStatementsResponse,
  );
}

export function getCreditStatement(
  creditAccountId: string,
  statementId: string,
  auth: RequestAuth,
): Promise<CreditStatement> {
  return requestJson(
    `/credit/accounts/${requireResourceId(creditAccountId, "creditAccountId")}/statements/${requireResourceId(statementId, "statementId")}`,
    { auth },
    isCreditStatementResponse,
  ).then((response) => response.statement);
}

export function quoteCreditPayment(
  request: CreditPaymentQuoteRequest,
  auth: RequestAuth,
): Promise<CreditPaymentQuote> {
  validateQuoteRequest(request);
  return requestJson("/credit/payment-quotes", { method: "POST", body: request, auth }, isCreditPaymentQuote);
}

export function submitCreditPayment(
  request: CreditPaymentRequest,
  options: { auth: RequestAuth; idempotencyKey: string },
): Promise<CreditPayment> {
  validateStepUp(request);
  const idempotencyKey = requireIdempotencyKey(
    options.idempotencyKey,
    COMMAND_IDEMPOTENCY_KEY_MIN_LENGTH,
  );
  return requestJson(
    "/credit/payments",
    { method: "POST", body: request, auth: options.auth, idempotencyKey },
    isCreditPayment,
  );
}

export function getCreditPayment(paymentId: string, auth: RequestAuth): Promise<CreditPayment> {
  return requestJson(
    `/credit/payments/${requireResourceId(paymentId, "paymentId")}`,
    { auth },
    isCreditPayment,
  );
}

export const creditApi = {
  listCreditCards,
  getCreditCard,
  lockCreditCard,
  unlockCreditCard,
  reportCreditCardLost,
  listCreditAccounts,
  listCreditApplications,
  submitCreditApplication,
  activateCreditApplication,
  getCreditAccount,
  listCreditTransactions,
  listCreditStatements,
  getCreditStatement,
  quoteCreditPayment,
  submitCreditPayment,
  getCreditPayment,
};

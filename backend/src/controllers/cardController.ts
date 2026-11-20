import type { IncomingMessage, ServerResponse } from "node:http";
import type { BankingSystem } from "../bankingSystem.js";
import type { HttpOptions } from "../http.js";
import { invalidRequest, notFound, unauthorized } from "../errors.js";
import { fingerprint } from "../security.js";
import { header, requireObject, requireDeviceId, writeResponse } from "../routes/httpUtils.js";
import type { VerifyStepUpFn } from "../routes/transferRoutes.js";

/**
 * Card & Credit Controller (Tầng Controller - Xử lý Request/Response cho Thẻ ghi nợ, Khóa thẻ & Thẻ tín dụng)
 */

// ==========================================
// DEBIT CARDS CONTROLLERS
// ==========================================

export async function listCardsController(
  response: ServerResponse,
  userId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  writeResponse(response, 200, traceId, relationalRoute && options.relationalHttp
    ? await options.relationalHttp.listCards(userId)
    : { items: system.listCards(userId) });
}

export async function getCardController(
  response: ServerResponse,
  userId: string,
  cardId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  writeResponse(response, 200, traceId, relationalRoute && options.relationalHttp
    ? await options.relationalHttp.getCard(userId, cardId)
    : system.getCard(userId, cardId));
}

export async function lockCardController(
  response: ServerResponse,
  userId: string,
  cardId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  if (relationalRoute && options.relationalHttp) {
    const card = await options.relationalHttp.lockCard(userId, cardId);
    writeResponse(response, 200, traceId, { card });
  } else {
    writeResponse(response, 200, traceId, { card: system.lockCard(userId, cardId) });
  }
}

export async function unlockCardController(
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  cardId: string,
  body: unknown,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
  verifyStepUp: VerifyStepUpFn,
): Promise<void> {
  const data = requireObject(body);
  if (relationalRoute && options.relationalHttp) {
    if (!options.mfaService) throw invalidRequest("TOTP step-up challenge is required for relational card unlock.");
    const stepUp = typeof data.stepUp === "object" && data.stepUp !== null && !Array.isArray(data.stepUp) ? data.stepUp as Record<string, unknown> : null;
    if (!stepUp || (stepUp.method !== "TOTP" && stepUp.method !== "BIOMETRIC") || typeof stepUp.challengeId !== "string" || typeof stepUp.proof !== "string") throw invalidRequest("TOTP or Biometric step-up challenge is required for relational card unlock.");
    const verified = await options.mfaService.verifyChallenge({
      challengeId: stepUp.challengeId,
      customerId: userId,
      deviceId: requireDeviceId(request),
      proof: stepUp.proof,
      purpose: "CARD_UNLOCK",
      resourceId: cardId,
      requestFingerprint: fingerprint({ cardId }),
    });
    if (verified.customerId !== userId) throw unauthorized("MFA user binding is invalid.");
    const card = await options.relationalHttp.unlockCard(userId, cardId);
    writeResponse(response, 200, traceId, { card });
  } else {
    if (options.mfaService) {
      await verifyStepUp(
        options.mfaService,
        system,
        request,
        userId,
        data,
        "CARD_UNLOCK",
        cardId,
      );
    }
    writeResponse(response, 200, traceId, {
      card: system.unlockCard(userId, cardId, data as never, requireDeviceId(request)),
    });
  }
}

export async function reportCardLostController(
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  cardId: string,
  body: unknown,
  options: HttpOptions,
  traceId: string,
): Promise<void> {
  const data = requireObject(body);
  if (!options.relationalHttp) return;
  if (!options.mfaService) throw invalidRequest("TOTP step-up challenge is required to report a card lost.");
  const stepUp = typeof data.stepUp === "object" && data.stepUp !== null && !Array.isArray(data.stepUp) ? data.stepUp as Record<string, unknown> : null;
  if (!stepUp || (stepUp.method !== "TOTP" && stepUp.method !== "BIOMETRIC") || typeof stepUp.challengeId !== "string" || typeof stepUp.proof !== "string") throw invalidRequest("TOTP or Biometric step-up challenge is required to report a card lost.");
  const verified = await options.mfaService.verifyChallenge({
    challengeId: stepUp.challengeId,
    customerId: userId,
    deviceId: requireDeviceId(request),
    proof: stepUp.proof,
    purpose: "CARD_REPORT_LOST",
    resourceId: cardId,
    requestFingerprint: fingerprint({ cardId, action: "REPORT_LOST" }),
  });
  if (verified.customerId !== userId) throw unauthorized("MFA user binding is invalid.");
  writeResponse(response, 200, traceId, await options.relationalHttp.reportCardLost(userId, cardId, traceId));
}

// ==========================================
// CREDIT CONTROLLERS
// ==========================================

export async function listCreditApplicationsController(
  response: ServerResponse,
  userId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  writeResponse(response, 200, traceId, relationalRoute && options.relationalHttp
    ? await options.relationalHttp.listCreditApplications(userId)
    : { items: system.listCreditApplications(userId) });
}

export async function submitCreditApplicationController(
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  body: unknown,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
  verifyStepUp: VerifyStepUpFn,
): Promise<void> {
  const data = requireObject(body);
  if (relationalRoute && options.relationalHttp) {
    if (!options.mfaService) throw invalidRequest("TOTP step-up challenge is required for relational credit application.");
    const stepUp = typeof data.stepUp === "object" && data.stepUp !== null && !Array.isArray(data.stepUp) ? data.stepUp as Record<string, unknown> : null;
    if (!stepUp || (stepUp.method !== "TOTP" && stepUp.method !== "BIOMETRIC") || typeof stepUp.challengeId !== "string" || typeof stepUp.proof !== "string") throw invalidRequest("TOTP or Biometric step-up challenge is required for relational credit application.");
    const requestFingerprint = await options.relationalHttp.getCreditApplicationRequestFingerprint(data.requestedLimit);
    const verified = await options.mfaService.verifyChallenge({
      challengeId: stepUp.challengeId,
      customerId: userId,
      deviceId: requireDeviceId(request),
      proof: stepUp.proof,
      purpose: "CREDIT_APPLICATION",
      resourceId: null,
      requestFingerprint,
    });
    if (verified.customerId !== userId) throw unauthorized("MFA user binding is invalid.");
    writeResponse(response, 201, traceId, await options.relationalHttp.submitCreditApplication({
      customerId: userId,
      idempotencyKey: header(request, "idempotency-key") ?? "",
      request: data as never,
      traceId,
    }));
  } else {
    if (options.mfaService) {
      await verifyStepUp(
        options.mfaService,
        system,
        request,
        userId,
        data,
        "CREDIT_APPLICATION",
        null,
        system.getCreditApplicationRequestFingerprint(data.requestedLimit),
      );
    }
    writeResponse(
      response,
      201,
      traceId,
      system.submitCreditApplication(
        userId,
        header(request, "idempotency-key") ?? "",
        data as never,
        requireDeviceId(request),
      ),
    );
  }
}

export async function getCreditApplicationController(
  response: ServerResponse,
  userId: string,
  applicationId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  writeResponse(response, 200, traceId, relationalRoute && options.relationalHttp
    ? await options.relationalHttp.getCreditApplication(userId, applicationId)
    : system.getCreditApplication(userId, applicationId));
}

export async function activateCreditApplicationController(
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  applicationId: string,
  body: unknown,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
  verifyStepUp: VerifyStepUpFn,
): Promise<void> {
  const data = requireObject(body);
  if (relationalRoute && options.relationalHttp) {
    if (!options.mfaService) throw invalidRequest("TOTP step-up challenge is required for relational credit activation.");
    const stepUp = typeof data.stepUp === "object" && data.stepUp !== null && !Array.isArray(data.stepUp) ? data.stepUp as Record<string, unknown> : null;
    if (!stepUp || (stepUp.method !== "TOTP" && stepUp.method !== "BIOMETRIC") || typeof stepUp.challengeId !== "string" || typeof stepUp.proof !== "string") throw invalidRequest("TOTP or Biometric step-up challenge is required for relational credit activation.");
    const verified = await options.mfaService.verifyChallenge({
      challengeId: stepUp.challengeId,
      customerId: userId,
      deviceId: requireDeviceId(request),
      proof: stepUp.proof,
      purpose: "CARD_ACTIVATION",
      resourceId: applicationId,
      requestFingerprint: fingerprint({ applicationId }),
    });
    if (verified.customerId !== userId) throw unauthorized("MFA user binding is invalid.");
    writeResponse(response, 200, traceId, await options.relationalHttp.activateCreditApplication({
      customerId: userId,
      applicationId,
      idempotencyKey: header(request, "idempotency-key") ?? "",
      traceId,
    }));
  } else {
    if (options.mfaService) {
      await verifyStepUp(
        options.mfaService,
        system,
        request,
        userId,
        data,
        "CARD_ACTIVATION",
        applicationId,
      );
    }
    writeResponse(
      response,
      200,
      traceId,
      system.activateCreditApplication(
        userId,
        applicationId,
        header(request, "idempotency-key") ?? "",
        data as never,
        requireDeviceId(request),
      ),
    );
  }
}

export async function listCreditAccountsController(
  response: ServerResponse,
  userId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  writeResponse(response, 200, traceId, relationalRoute && options.relationalHttp
    ? { items: await options.relationalHttp.listCreditAccounts(userId) }
    : { items: system.listCreditAccounts(userId) });
}

export async function getCreditAccountController(
  response: ServerResponse,
  userId: string,
  creditAccountId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  writeResponse(response, 200, traceId, relationalRoute && options.relationalHttp
    ? await options.relationalHttp.getCreditAccount(userId, creditAccountId)
    : system.getCreditAccount(userId, creditAccountId));
}

export async function listCreditTransactionsController(
  response: ServerResponse,
  userId: string,
  creditAccountId: string,
  cursor: string | undefined,
  limit: number | undefined,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  writeResponse(
    response,
    200,
    traceId,
    relationalRoute && options.relationalHttp
      ? await options.relationalHttp.listCreditTransactions(userId, creditAccountId, cursor, limit)
      : system.listCreditTransactions(userId, creditAccountId, cursor, limit),
  );
}

export async function listCreditStatementsController(
  response: ServerResponse,
  userId: string,
  creditAccountId: string,
  cursor: string | undefined,
  limit: number | undefined,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  writeResponse(
    response,
    200,
    traceId,
    relationalRoute && options.relationalHttp
      ? await options.relationalHttp.listCreditStatements(userId, creditAccountId, cursor, limit)
      : system.listCreditStatements(userId, creditAccountId, cursor, limit),
  );
}

export async function getCreditStatementController(
  response: ServerResponse,
  userId: string,
  creditAccountId: string,
  statementId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  writeResponse(
    response,
    200,
    traceId,
    relationalRoute && options.relationalHttp
      ? { statement: await options.relationalHttp.getCreditStatement(userId, creditAccountId, statementId) }
      : { statement: system.getCreditStatement(userId, creditAccountId, statementId) },
  );
}

export async function createCreditPaymentQuoteController(
  response: ServerResponse,
  userId: string,
  body: unknown,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  const data = requireObject(body);
  writeResponse(
    response,
    200,
    traceId,
    relationalRoute && options.relationalHttp
      ? await options.relationalHttp.createCreditPaymentQuote(userId, data as never)
      : system.createCreditPaymentQuote(userId, data as never),
  );
}

export async function submitCreditPaymentController(
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  body: unknown,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
  verifyStepUp: VerifyStepUpFn,
): Promise<void> {
  const data = requireObject(body);
  if (relationalRoute && options.relationalHttp) {
    const stepUp = typeof data.stepUp === "object" && data.stepUp !== null && !Array.isArray(data.stepUp) ? data.stepUp as Record<string, unknown> : null;
    if (!options.mfaService || !stepUp || (stepUp.method !== "TOTP" && stepUp.method !== "BIOMETRIC") || typeof stepUp.challengeId !== "string" || typeof stepUp.proof !== "string") throw invalidRequest("TOTP or Biometric step-up challenge is required for relational credit payment.");
    const quoteId = typeof data.quoteId === "string" ? data.quoteId : "";
    const requestFingerprint = await options.relationalHttp.getCreditPaymentStepUpRequestFingerprint(quoteId);
    if (!requestFingerprint) throw notFound("Credit payment quote not found.");
    const verified = await options.mfaService.verifyChallenge({
      challengeId: stepUp.challengeId,
      customerId: userId,
      deviceId: requireDeviceId(request),
      proof: stepUp.proof,
      purpose: "CREDIT_PAYMENT",
      resourceId: quoteId,
      requestFingerprint,
    });
    if (verified.customerId !== userId) throw unauthorized("MFA user binding is invalid.");
    writeResponse(response, 200, traceId, await options.relationalHttp.submitCreditPayment({
      customerId: userId,
      idempotencyKey: header(request, "idempotency-key") ?? "",
      quoteId,
      requestFingerprint,
      traceId,
    }));
  } else {
    if (options.mfaService) {
      await verifyStepUp(
        options.mfaService,
        system,
        request,
        userId,
        data,
        "CREDIT_PAYMENT",
        typeof data.quoteId === "string" ? data.quoteId : null,
      );
    }
    const payment = system.submitCreditPayment(
      userId,
      header(request, "idempotency-key") ?? "",
      data as never,
      requireDeviceId(request),
    );
    writeResponse(response, payment.status === "PENDING" ? 202 : 200, traceId, payment);
  }
}

export async function getCreditPaymentController(
  response: ServerResponse,
  userId: string,
  paymentId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  writeResponse(
    response,
    200,
    traceId,
    relationalRoute && options.relationalHttp
      ? await options.relationalHttp.getCreditPayment(userId, paymentId)
      : system.getCreditPayment(userId, paymentId),
  );
}

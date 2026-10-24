import type { IncomingMessage, ServerResponse } from "node:http";
import type { BankingSystem } from "../bankingSystem.js";
import type { HttpOptions } from "../http.js";
import type { MaturityInstruction } from "../domain/savings/index.js";
import { invalidRequest, notFound, unauthorized } from "../errors.js";
import { fingerprint } from "../security.js";
import { header, requireObject, requireDeviceId, writeResponse } from "../routes/httpUtils.js";
import type { VerifyStepUpFn } from "../routes/transferRoutes.js";

/**
 * Savings Controller (Tầng Controller - Xử lý Request/Response cho Tiết kiệm có kỳ hạn)
 */

export async function listSavingsProductsController(
  response: ServerResponse,
  userId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  writeResponse(response, 200, traceId, {
    items: relationalRoute && options.relationalHttp
      ? await options.relationalHttp.listSavingsProducts(userId)
      : system.listSavingsProducts(userId),
  });
}

export async function createSavingsQuoteController(
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
      ? await options.relationalHttp.createSavingsQuote(userId, data as never)
      : system.createSavingsQuote(userId, data as never),
  );
}

export async function submitSavingsOpeningController(
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
    const stepUp = typeof data.stepUp === "object" && data.stepUp !== null && !Array.isArray(data.stepUp)
      ? data.stepUp as Record<string, unknown>
      : null;
    if (!options.mfaService || !stepUp || (stepUp.method !== "TOTP" && stepUp.method !== "OTP") || typeof stepUp.challengeId !== "string" || typeof stepUp.proof !== "string") {
      throw invalidRequest("TOTP step-up challenge is required for relational savings opening.");
    }
    const quoteId = typeof data.quoteId === "string" ? data.quoteId : "";
    const savingsRequestFingerprint = await options.relationalHttp.getSavingsStepUpRequestFingerprint(quoteId);
    if (!savingsRequestFingerprint) throw notFound("Savings quote not found.");
    const verified = await options.mfaService.verifyChallenge({
      challengeId: stepUp.challengeId,
      customerId: userId,
      deviceId: requireDeviceId(request),
      proof: stepUp.proof,
      purpose: "SAVINGS_OPENING",
      resourceId: quoteId,
      requestFingerprint: savingsRequestFingerprint,
    });
    if (verified.customerId !== userId) throw unauthorized("MFA user binding is invalid.");
    const opening = await options.relationalHttp.submitSavingsOpening({
      customerId: userId,
      idempotencyKey: header(request, "idempotency-key") ?? "",
      request: data as never,
      traceId,
    });
    writeResponse(response, opening.status === "PENDING" ? 202 : 200, traceId, opening);
  } else {
    if (options.mfaService) {
      await verifyStepUp(
        options.mfaService,
        system,
        request,
        userId,
        data,
        "SAVINGS_OPENING",
        typeof data.quoteId === "string" ? data.quoteId : null,
      );
    }
    const opening = system.submitSavingsOpening(
      userId,
      header(request, "idempotency-key") ?? "",
      data as never,
      requireDeviceId(request),
    );
    writeResponse(response, opening.status === "PENDING" ? 202 : 200, traceId, opening);
  }
}

export async function getSavingsOpeningController(
  response: ServerResponse,
  userId: string,
  openingId: string,
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
      ? await options.relationalHttp.getSavingsOpening(userId, openingId)
      : system.getSavingsOpening(userId, openingId),
  );
}

export async function listSavingsDepositsController(
  response: ServerResponse,
  userId: string,
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
      ? await options.relationalHttp.listSavingsDeposits(userId)
      : system.listSavingsDeposits(userId),
  );
}

export async function getSavingsDepositController(
  response: ServerResponse,
  userId: string,
  depositId: string,
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
      ? await options.relationalHttp.getSavingsDeposit(userId, depositId)
      : system.getSavingsDeposit(userId, depositId),
  );
}

export async function updateSavingsMaturityInstructionController(
  response: ServerResponse,
  userId: string,
  depositId: string,
  body: unknown,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  const data = requireObject(body);
  if (typeof data.maturityInstruction !== "string" || !["RETURN_PRINCIPAL_AND_INTEREST", "RENEW_PRINCIPAL", "RENEW_PRINCIPAL_AND_INTEREST"].includes(data.maturityInstruction)) {
    throw invalidRequest("maturityInstruction is invalid or missing.");
  }
  const updated = relationalRoute && options.relationalHttp
    ? await options.relationalHttp.updateSavingsDepositMaturityInstruction(
      userId,
      depositId,
      data.maturityInstruction as MaturityInstruction,
    )
    : system.updateSavingsDepositMaturityInstruction(
      userId,
      depositId,
      data.maturityInstruction as MaturityInstruction,
    );
  writeResponse(response, 200, traceId, updated);
}

export async function withdrawSavingsDepositEarlyController(
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  depositId: string,
  body: unknown,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
  verifyStepUp: VerifyStepUpFn,
): Promise<void> {
  const data = requireObject(body);
  if (relationalRoute && options.relationalHttp) {
    const stepUp = typeof data.stepUp === "object" && data.stepUp !== null && !Array.isArray(data.stepUp)
      ? data.stepUp as Record<string, unknown>
      : null;
    if (!options.mfaService || !stepUp || stepUp.method !== "TOTP" || typeof stepUp.challengeId !== "string" || typeof stepUp.proof !== "string") {
      throw invalidRequest("TOTP step-up challenge is required for savings early withdrawal.");
    }
    const withdrawalFingerprint = fingerprint({ depositId, action: "EARLY_WITHDRAWAL" });
    const verified = await options.mfaService.verifyChallenge({
      challengeId: stepUp.challengeId,
      customerId: userId,
      deviceId: requireDeviceId(request),
      proof: stepUp.proof,
      purpose: "SAVINGS_WITHDRAWAL",
      resourceId: depositId,
      requestFingerprint: withdrawalFingerprint,
    });
    if (verified.customerId !== userId) throw unauthorized("MFA user binding is invalid.");
    const receipt = await options.relationalHttp.withdrawSavingsDepositEarly({
      customerId: userId,
      depositId,
      idempotencyKey: header(request, "idempotency-key") ?? "",
      traceId,
    });
    writeResponse(response, 200, traceId, receipt);
  } else {
    if (options.mfaService) {
      await verifyStepUp(
        options.mfaService,
        system,
        request,
        userId,
        data,
        "SAVINGS_WITHDRAWAL",
        depositId,
      );
    }
    writeResponse(
      response,
      200,
      traceId,
      system.withdrawSavingsDepositEarly(userId, depositId, header(request, "idempotency-key") ?? ""),
    );
  }
}

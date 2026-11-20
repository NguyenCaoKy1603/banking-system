import type { IncomingMessage, ServerResponse } from "node:http";
import type { BankingSystem } from "../bankingSystem.js";
import type { HttpOptions } from "../http.js";
import { invalidRequest, notFound, unauthorized } from "../errors.js";
import { defaultRecipientLookupRateLimiter } from "../middlewares/index.js";
import { header, requireObject, requireDeviceId, writeResponse } from "../routes/httpUtils.js";
import type { VerifyStepUpFn } from "../routes/transferRoutes.js";

/**
 * Transfer Controller (Tầng Controller - Xử lý Request/Response cho Chuyển tiền, Báo giá & Thụ hưởng)
 */

export async function lookupInternalRecipientController(
  response: ServerResponse,
  userId: string,
  body: unknown,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  (options.lookupRateLimiter ?? defaultRecipientLookupRateLimiter).acquire(userId);
  const data = requireObject(body);
  const recipient = relationalRoute && options.relationalHttp
    ? await options.relationalHttp.lookupInternalRecipient(userId, data.accountNumber)
    : system.lookupInternalRecipient(userId, data.accountNumber as string);
  writeResponse(response, 200, traceId, { recipient });
}

export async function listBeneficiariesController(
  response: ServerResponse,
  userId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  if (relationalRoute && options.relationalHttp) {
    writeResponse(response, 200, traceId, { items: await options.relationalHttp.listBeneficiaries(userId) });
  } else {
    writeResponse(response, 200, traceId, { items: system.listBeneficiaries(userId) });
  }
}

export async function getBeneficiaryController(
  response: ServerResponse,
  userId: string,
  beneficiaryId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  if (relationalRoute && options.relationalHttp) {
    writeResponse(response, 200, traceId, { beneficiary: await options.relationalHttp.getBeneficiary(userId, beneficiaryId) });
  } else {
    writeResponse(response, 200, traceId, { beneficiary: system.lookupBeneficiary(userId, beneficiaryId) });
  }
}

export async function createBeneficiaryController(
  response: ServerResponse,
  userId: string,
  body: unknown,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  const data = requireObject(body);
  if (relationalRoute && options.relationalHttp) {
    writeResponse(response, 201, traceId, {
      beneficiary: await options.relationalHttp.createBeneficiary(userId, {
        displayName: data.displayName,
        accountNumber: data.accountNumber,
      }),
    });
  } else {
    writeResponse(response, 201, traceId, {
      beneficiary: system.createBeneficiary(userId, data as never),
    });
  }
}

export async function renameBeneficiaryController(
  response: ServerResponse,
  userId: string,
  beneficiaryId: string,
  body: unknown,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  const data = requireObject(body);
  if (relationalRoute && options.relationalHttp) {
    writeResponse(response, 200, traceId, {
      beneficiary: await options.relationalHttp.renameBeneficiary(userId, beneficiaryId, data.displayName),
    });
  } else {
    writeResponse(response, 200, traceId, {
      beneficiary: system.renameBeneficiary(userId, beneficiaryId, data.displayName as string),
    });
  }
}

export async function deleteBeneficiaryController(
  response: ServerResponse,
  userId: string,
  beneficiaryId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  if (relationalRoute && options.relationalHttp) {
    await options.relationalHttp.removeBeneficiary(userId, beneficiaryId);
  } else {
    system.deleteBeneficiary(userId, beneficiaryId);
  }
  writeResponse(response, 204, traceId);
}

export async function createTransferQuoteController(
  response: ServerResponse,
  userId: string,
  body: unknown,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  const data = requireObject(body);
  if (relationalRoute && options.relationalHttp) {
    writeResponse(response, 200, traceId, await options.relationalHttp.createTransferQuote({
      customerId: userId,
      sourceAccountId: data.sourceAccountId as string,
      beneficiaryId: typeof data.beneficiaryId === "string" ? data.beneficiaryId : undefined,
      lookupId: typeof data.lookupId === "string" ? data.lookupId : undefined,
      amount: data.amount,
    }));
  } else {
    writeResponse(response, 200, traceId, system.createQuote(userId, data as never));
  }
}

export async function submitTransferController(
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
    const quoteId = typeof data.quoteId === "string" ? data.quoteId : "";
    const stepUp = typeof data.stepUp === "object" && data.stepUp !== null && !Array.isArray(data.stepUp)
      ? data.stepUp as Record<string, unknown>
      : null;
    if (!options.mfaService || !stepUp || (stepUp.method !== "TOTP" && stepUp.method !== "BIOMETRIC") || typeof stepUp.challengeId !== "string" || typeof stepUp.proof !== "string") {
      throw invalidRequest("Step-up challenge is required for relational transfer submission.");
    }
    const transferRequestFingerprint = await options.relationalHttp.getTransferStepUpRequestFingerprint(quoteId);
    if (!transferRequestFingerprint) throw notFound("Transfer quote not found.");
    const verified = await options.mfaService.verifyChallenge({
      challengeId: stepUp.challengeId,
      customerId: userId,
      deviceId: requireDeviceId(request),
      proof: stepUp.proof,
      purpose: "TRANSFER",
      resourceId: quoteId,
      requestFingerprint: transferRequestFingerprint,
    });
    if (verified.customerId !== userId) throw unauthorized("MFA user binding is invalid.");
    const idempotencyKey = header(request, "idempotency-key")?.trim() ?? "";
    if (idempotencyKey.length < 16) throw invalidRequest("Idempotency-Key must contain at least 16 characters.");
    writeResponse(response, 200, traceId, await options.relationalHttp.submitTransfer({
      customerId: userId,
      idempotencyKey,
      quoteId,
      requestFingerprint: transferRequestFingerprint,
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
        "TRANSFER",
        typeof data.quoteId === "string" ? data.quoteId : null,
      );
    }
    const receipt = system.submitTransfer(
      userId,
      header(request, "idempotency-key") ?? "",
      data as never,
      requireDeviceId(request),
    );
    writeResponse(
      response,
      receipt.status === "PENDING" ? 202 : 200,
      traceId,
      receipt,
    );
  }
}

export async function getTransferController(
  response: ServerResponse,
  userId: string,
  transferId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  if (relationalRoute && options.relationalHttp) {
    writeResponse(response, 200, traceId, await options.relationalHttp.getTransfer(userId, transferId));
  } else {
    writeResponse(response, 200, traceId, system.getTransfer(userId, transferId));
  }
}

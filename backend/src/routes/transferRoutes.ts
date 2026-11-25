import type { IncomingMessage, ServerResponse } from "node:http";
import type { BankingSystem } from "../bankingSystem.js";
import type { HttpOptions, PersistentStepUpPurpose } from "../http.js";
import type { PersistentMfaService } from "../mfa/persistentMfaService.js";
import {
  lookupExternalRecipientController,
  lookupInternalRecipientController,
  listBeneficiariesController,
  getBeneficiaryController,
  createBeneficiaryController,
  renameBeneficiaryController,
  deleteBeneficiaryController,
  createTransferQuoteController,
  submitTransferController,
  getTransferController,
} from "../controllers/transferController.js";

export type VerifyStepUpFn = (
  mfaService: PersistentMfaService,
  system: BankingSystem,
  request: IncomingMessage,
  userId: string,
  data: Record<string, unknown>,
  purpose: PersistentStepUpPurpose,
  resourceId: string | null,
  suppliedFingerprint?: string | null,
) => Promise<void>;

/**
 * Handles transfer-related routes (Router / URL Dispatcher):
 * - POST /api/v1/transfers/quote
 * - POST /api/v1/transfers
 * - GET  /api/v1/transfers/:id
 * - GET  /api/v1/beneficiaries
 * - POST /api/v1/beneficiaries
 * - GET  /api/v1/beneficiaries/:id
 * - PATCH /api/v1/beneficiaries/:id
 * - DELETE /api/v1/beneficiaries/:id
 * - POST /api/v1/internal-recipients/lookup
 */
export async function handleTransferRoute(
  request: IncomingMessage,
  response: ServerResponse,
  segments: readonly string[],
  body: unknown,
  userId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
  verifyStepUp: VerifyStepUpFn,
): Promise<boolean> {
  const root = segments[0];
  if (
    root !== "transfers" &&
    root !== "beneficiaries" &&
    root !== "internal-recipients" &&
    root !== "external-recipients"
  ) {
    return false;
  }

  // POST /internal-recipients/lookup
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "internal-recipients" &&
    segments[1] === "lookup"
  ) {
    await lookupInternalRecipientController(response, userId, body, relationalRoute, options, system, traceId);
    return true;
  }

  // POST /external-recipients/lookup
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "external-recipients" &&
    segments[1] === "lookup"
  ) {
    await lookupExternalRecipientController(response, userId, body, relationalRoute, options, traceId);
    return true;
  }

  // BENEFICIARIES
  if (root === "beneficiaries") {
    if (request.method === "GET" && segments.length === 1 && segments[0] === "beneficiaries") {
      await listBeneficiariesController(response, userId, relationalRoute, options, system, traceId);
      return true;
    }
    if (request.method === "POST" && segments.length === 1 && segments[0] === "beneficiaries") {
      await createBeneficiaryController(response, userId, body, relationalRoute, options, system, traceId);
      return true;
    }
    if (request.method === "PATCH" && segments.length === 2 && segments[0] === "beneficiaries") {
      await renameBeneficiaryController(response, userId, segments[1], body, relationalRoute, options, system, traceId);
      return true;
    }
    if (request.method === "DELETE" && segments.length === 2 && segments[0] === "beneficiaries") {
      await deleteBeneficiaryController(response, userId, segments[1], relationalRoute, options, system, traceId);
      return true;
    }
    if (request.method === "GET" && segments.length === 2 && segments[0] === "beneficiaries") {
      await getBeneficiaryController(response, userId, segments[1], relationalRoute, options, system, traceId);
      return true;
    }
  }

  // POST /transfers/quote
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "transfers" &&
    segments[1] === "quote"
  ) {
    await createTransferQuoteController(response, userId, body, relationalRoute, options, system, traceId);
    return true;
  }

  // POST /transfers
  if (request.method === "POST" && segments.length === 1 && segments[0] === "transfers") {
    await submitTransferController(
      request,
      response,
      userId,
      body,
      relationalRoute,
      options,
      system,
      traceId,
      verifyStepUp,
    );
    return true;
  }

  // GET /transfers/:id
  if (
    request.method === "GET" &&
    segments.length === 2 &&
    segments[0] === "transfers"
  ) {
    await getTransferController(response, userId, segments[1], relationalRoute, options, system, traceId);
    return true;
  }

  return false;
}

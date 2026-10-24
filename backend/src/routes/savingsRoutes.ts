import type { IncomingMessage, ServerResponse } from "node:http";
import type { BankingSystem } from "../bankingSystem.js";
import type { HttpOptions } from "../http.js";
import type { VerifyStepUpFn } from "./transferRoutes.js";
import {
  listSavingsProductsController,
  createSavingsQuoteController,
  submitSavingsOpeningController,
  getSavingsOpeningController,
  listSavingsDepositsController,
  getSavingsDepositController,
  updateSavingsMaturityInstructionController,
  withdrawSavingsDepositEarlyController,
} from "../controllers/savingsController.js";

/**
 * Handles savings-related routes (Router / URL Dispatcher):
 * - GET   /api/v1/savings/products
 * - POST  /api/v1/savings/quotes
 * - POST  /api/v1/savings/deposits
 * - GET   /api/v1/savings/openings/:id
 * - GET   /api/v1/savings/deposits
 * - GET   /api/v1/savings/deposits/:id
 * - PATCH /api/v1/savings/deposits/:id
 * - POST  /api/v1/savings/deposits/:id/withdraw
 */
export async function handleSavingsRoute(
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
  if (segments[0] !== "savings") {
    return false;
  }

  // GET /savings/products
  if (
    request.method === "GET" &&
    segments.length === 2 &&
    segments[0] === "savings" &&
    segments[1] === "products"
  ) {
    await listSavingsProductsController(response, userId, relationalRoute, options, system, traceId);
    return true;
  }

  // POST /savings/quotes
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "savings" &&
    segments[1] === "quotes"
  ) {
    await createSavingsQuoteController(response, userId, body, relationalRoute, options, system, traceId);
    return true;
  }

  // POST /savings/deposits
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "savings" &&
    segments[1] === "deposits"
  ) {
    await submitSavingsOpeningController(
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

  // GET /savings/openings/:id
  if (
    request.method === "GET" &&
    segments.length === 3 &&
    segments[0] === "savings" &&
    segments[1] === "openings"
  ) {
    await getSavingsOpeningController(response, userId, segments[2], relationalRoute, options, system, traceId);
    return true;
  }

  // GET /savings/deposits
  if (
    request.method === "GET" &&
    segments.length === 2 &&
    segments[0] === "savings" &&
    segments[1] === "deposits"
  ) {
    await listSavingsDepositsController(response, userId, relationalRoute, options, system, traceId);
    return true;
  }

  // GET /savings/deposits/:id
  if (
    request.method === "GET" &&
    segments.length === 3 &&
    segments[0] === "savings" &&
    segments[1] === "deposits"
  ) {
    await getSavingsDepositController(response, userId, segments[2], relationalRoute, options, system, traceId);
    return true;
  }

  // PATCH /savings/deposits/:id
  if (
    request.method === "PATCH" &&
    segments.length === 3 &&
    segments[0] === "savings" &&
    segments[1] === "deposits"
  ) {
    await updateSavingsMaturityInstructionController(
      response,
      userId,
      segments[2],
      body,
      relationalRoute,
      options,
      system,
      traceId,
    );
    return true;
  }

  // POST /savings/deposits/:id/withdraw
  if (request.method === "POST" && segments.length === 4 && segments[1] === "deposits" && segments[3] === "withdraw") {
    await withdrawSavingsDepositEarlyController(
      request,
      response,
      userId,
      segments[2],
      body,
      relationalRoute,
      options,
      system,
      traceId,
      verifyStepUp,
    );
    return true;
  }

  return false;
}

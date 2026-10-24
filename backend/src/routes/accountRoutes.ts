import type { IncomingMessage, ServerResponse } from "node:http";
import type { BankingSystem } from "../bankingSystem.js";
import type { HttpOptions } from "../http.js";
import {
  listAccountsController,
  getAccountNumberController,
  listTransactionsController,
  getTransactionController,
} from "../controllers/accountController.js";

/**
 * Handles account-related routes (Router / URL Dispatcher):
 * - GET /api/v1/accounts
 * - GET /api/v1/accounts/:id/number
 * - GET /api/v1/accounts/:id/transactions
 * - GET /api/v1/accounts/:id/transactions/:transactionId
 */
export async function handleAccountRoute(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  segments: readonly string[],
  userId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<boolean> {
  if (segments[0] !== "accounts") {
    return false;
  }

  // GET /accounts
  if (request.method === "GET" && segments.length === 1 && segments[0] === "accounts") {
    await listAccountsController(response, userId, relationalRoute, options, system, traceId);
    return true;
  }

  // GET /accounts/:id/number
  if (
    request.method === "GET" &&
    segments.length === 3 &&
    segments[0] === "accounts" &&
    segments[2] === "number"
  ) {
    await getAccountNumberController(response, userId, segments[1], relationalRoute, options, system, traceId);
    return true;
  }

  // GET /accounts/:id/transactions
  if (
    request.method === "GET" &&
    segments.length === 3 &&
    segments[0] === "accounts" &&
    segments[2] === "transactions"
  ) {
    const limitValue = requestUrl.searchParams.get("limit");
    const limit = limitValue === null ? undefined : Number(limitValue);
    const cursor = requestUrl.searchParams.get("cursor") ?? undefined;
    await listTransactionsController(
      response,
      userId,
      segments[1],
      cursor,
      limit,
      relationalRoute,
      options,
      system,
      traceId,
    );
    return true;
  }

  // GET /accounts/:id/transactions/:transactionId
  if (
    request.method === "GET" &&
    segments.length === 4 &&
    segments[0] === "accounts" &&
    segments[2] === "transactions"
  ) {
    await getTransactionController(
      response,
      userId,
      segments[1],
      segments[3],
      relationalRoute,
      options,
      system,
      traceId,
    );
    return true;
  }

  return false;
}

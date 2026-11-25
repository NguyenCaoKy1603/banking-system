import type { IncomingMessage, ServerResponse } from "node:http";
import type { BankingSystem } from "../bankingSystem.js";
import type { HttpOptions } from "../http.js";
import {
  listAccountsController,
  getAccountNumberController,
  listTransactionsController,
  getTransactionController,
  getAccountSummaryController,
  exportAccountStatementController,
} from "../controllers/accountController.js";
import type { TransactionListFilters } from "../types.js";

/**
 * Handles account-related routes (Router / URL Dispatcher):
 * - GET /api/v1/accounts
 * - GET /api/v1/accounts/:id/number
 * - GET /api/v1/accounts/:id/transactions
 * - GET /api/v1/accounts/:id/transactions/:transactionId
 * - GET /api/v1/accounts/:id/summary
 * - GET /api/v1/accounts/:id/statement-export
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
    const status = requestUrl.searchParams.get("status") ?? undefined;
    const direction = requestUrl.searchParams.get("direction") ?? undefined;
    const from = requestUrl.searchParams.get("from") ?? undefined;
    const to = requestUrl.searchParams.get("to") ?? undefined;
    const q = requestUrl.searchParams.get("q") ?? undefined;
    const filters: TransactionListFilters | undefined =
      status !== undefined ||
      direction !== undefined ||
      from !== undefined ||
      to !== undefined ||
      q !== undefined
        ? {
            status: status as TransactionListFilters["status"],
            direction: direction as TransactionListFilters["direction"],
            from,
            to,
            q,
          }
        : undefined;
    await listTransactionsController(
      response,
      userId,
      segments[1],
      cursor,
      limit,
      filters,
      relationalRoute,
      options,
      system,
      traceId,
    );
    return true;
  }

  // GET /accounts/:id/summary
  if (
    request.method === "GET" &&
    segments.length === 3 &&
    segments[0] === "accounts" &&
    segments[2] === "summary"
  ) {
    const month = requestUrl.searchParams.get("month") ?? undefined;
    await getAccountSummaryController(
      response,
      userId,
      segments[1],
      month,
      relationalRoute,
      options,
      system,
      traceId,
    );
    return true;
  }

  // GET /accounts/:id/statement-export
  if (
    request.method === "GET" &&
    segments.length === 3 &&
    segments[0] === "accounts" &&
    segments[2] === "statement-export"
  ) {
    await exportAccountStatementController(
      response,
      userId,
      segments[1],
      {
        from: requestUrl.searchParams.get("from") ?? undefined,
        to: requestUrl.searchParams.get("to") ?? undefined,
        format: requestUrl.searchParams.get("format") ?? undefined,
      },
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

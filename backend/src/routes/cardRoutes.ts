import type { IncomingMessage, ServerResponse } from "node:http";
import type { BankingSystem } from "../bankingSystem.js";
import type { HttpOptions } from "../http.js";
import type { VerifyStepUpFn } from "./transferRoutes.js";
import {
  listCardsController,
  getCardController,
  lockCardController,
  unlockCardController,
  reportCardLostController,
  listCreditApplicationsController,
  submitCreditApplicationController,
  getCreditApplicationController,
  activateCreditApplicationController,
  listCreditAccountsController,
  getCreditAccountController,
  listCreditTransactionsController,
  listCreditStatementsController,
  getCreditStatementController,
  createCreditPaymentQuoteController,
  submitCreditPaymentController,
  getCreditPaymentController,
} from "../controllers/cardController.js";

/**
 * Handles card and credit related routes (Router / URL Dispatcher):
 * - /api/v1/cards/* (Debit/ATM cards, lock, unlock, report-lost)
 * - /api/v1/credit/* (Credit applications, accounts, transactions, statements, payments)
 */
export async function handleCardRoute(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
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
  if (root !== "cards" && root !== "credit") {
    return false;
  }

  // ==========================================
  // CARDS (DEBIT & EMERGENCY CONTROLS)
  // ==========================================
  if (root === "cards") {
    // GET /cards
    if (request.method === "GET" && segments.length === 1 && segments[0] === "cards") {
      await listCardsController(response, userId, relationalRoute, options, system, traceId);
      return true;
    }

    // GET /cards/:id
    if (request.method === "GET" && segments.length === 2 && segments[0] === "cards") {
      await getCardController(response, userId, segments[1], relationalRoute, options, system, traceId);
      return true;
    }

    // POST /cards/:id/lock
    if (
      request.method === "POST" &&
      segments.length === 3 &&
      segments[0] === "cards" &&
      segments[2] === "lock"
    ) {
      await lockCardController(response, userId, segments[1], relationalRoute, options, system, traceId);
      return true;
    }

    // POST /cards/:id/unlock
    if (
      request.method === "POST" &&
      segments.length === 3 &&
      segments[0] === "cards" &&
      segments[2] === "unlock"
    ) {
      await unlockCardController(
        request,
        response,
        userId,
        segments[1],
        body,
        relationalRoute,
        options,
        system,
        traceId,
        verifyStepUp,
      );
      return true;
    }

    // POST /cards/:id/report-lost
    if (
      request.method === "POST" &&
      segments.length === 3 &&
      segments[0] === "cards" &&
      segments[2] === "report-lost"
    ) {
      await reportCardLostController(request, response, userId, segments[1], body, options, traceId);
      return true;
    }
  }

  // ==========================================
  // CREDIT APPLICATIONS & ACCOUNTS
  // ==========================================
  if (root === "credit") {
    // GET /credit/applications
    if (
      request.method === "GET" &&
      segments.length === 2 &&
      segments[0] === "credit" &&
      segments[1] === "applications"
    ) {
      await listCreditApplicationsController(response, userId, relationalRoute, options, system, traceId);
      return true;
    }

    // POST /credit/applications
    if (
      request.method === "POST" &&
      segments.length === 2 &&
      segments[0] === "credit" &&
      segments[1] === "applications"
    ) {
      await submitCreditApplicationController(
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

    // GET /credit/applications/:id
    if (
      request.method === "GET" &&
      segments.length === 3 &&
      segments[0] === "credit" &&
      segments[1] === "applications"
    ) {
      await getCreditApplicationController(response, userId, segments[2], relationalRoute, options, system, traceId);
      return true;
    }

    // POST /credit/applications/:id/activate
    if (
      request.method === "POST" &&
      segments.length === 4 &&
      segments[0] === "credit" &&
      segments[1] === "applications" &&
      segments[3] === "activate"
    ) {
      await activateCreditApplicationController(
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

    // GET /credit/accounts
    if (
      request.method === "GET" &&
      segments.length === 2 &&
      segments[0] === "credit" &&
      segments[1] === "accounts"
    ) {
      await listCreditAccountsController(response, userId, relationalRoute, options, system, traceId);
      return true;
    }

    // GET /credit/accounts/:id
    if (
      request.method === "GET" &&
      segments.length === 3 &&
      segments[0] === "credit" &&
      segments[1] === "accounts"
    ) {
      await getCreditAccountController(response, userId, segments[2], relationalRoute, options, system, traceId);
      return true;
    }

    // GET /credit/accounts/:id/transactions
    if (
      request.method === "GET" &&
      segments.length === 4 &&
      segments[0] === "credit" &&
      segments[1] === "accounts" &&
      segments[3] === "transactions"
    ) {
      const limitValue = requestUrl.searchParams.get("limit");
      const limit = limitValue === null ? undefined : Number(limitValue);
      const cursor = requestUrl.searchParams.get("cursor") ?? undefined;
      await listCreditTransactionsController(
        response,
        userId,
        segments[2],
        cursor,
        limit,
        relationalRoute,
        options,
        system,
        traceId,
      );
      return true;
    }

    // GET /credit/accounts/:id/statements
    if (
      request.method === "GET" &&
      segments.length === 4 &&
      segments[0] === "credit" &&
      segments[1] === "accounts" &&
      segments[3] === "statements"
    ) {
      const limitValue = requestUrl.searchParams.get("limit");
      const limit = limitValue === null ? undefined : Number(limitValue);
      const cursor = requestUrl.searchParams.get("cursor") ?? undefined;
      await listCreditStatementsController(
        response,
        userId,
        segments[2],
        cursor,
        limit,
        relationalRoute,
        options,
        system,
        traceId,
      );
      return true;
    }

    // GET /credit/accounts/:id/statements/:statementId
    if (
      request.method === "GET" &&
      segments.length === 5 &&
      segments[0] === "credit" &&
      segments[1] === "accounts" &&
      segments[3] === "statements"
    ) {
      await getCreditStatementController(
        response,
        userId,
        segments[2],
        segments[4],
        relationalRoute,
        options,
        system,
        traceId,
      );
      return true;
    }

    // POST /credit/payment-quotes
    if (
      request.method === "POST" &&
      segments.length === 2 &&
      segments[0] === "credit" &&
      segments[1] === "payment-quotes"
    ) {
      await createCreditPaymentQuoteController(response, userId, body, relationalRoute, options, system, traceId);
      return true;
    }

    // POST /credit/payments
    if (
      request.method === "POST" &&
      segments.length === 2 &&
      segments[0] === "credit" &&
      segments[1] === "payments"
    ) {
      await submitCreditPaymentController(
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

    // GET /credit/payments/:id
    if (
      request.method === "GET" &&
      segments.length === 3 &&
      segments[0] === "credit" &&
      segments[1] === "payments"
    ) {
      await getCreditPaymentController(response, userId, segments[2], relationalRoute, options, system, traceId);
      return true;
    }
  }

  return false;
}

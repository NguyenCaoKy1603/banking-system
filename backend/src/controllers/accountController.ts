import type { ServerResponse } from "node:http";
import type { BankingSystem } from "../bankingSystem.js";
import type { HttpOptions } from "../http.js";
import { writeResponse } from "../routes/httpUtils.js";

/**
 * Account Controller (Tầng Controller - Xử lý Request/Response cho Tài khoản & Giao dịch)
 */

export async function listAccountsController(
  response: ServerResponse,
  userId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  writeResponse(response, 200, traceId, {
    accounts: relationalRoute && options.relationalHttp
      ? await options.relationalHttp.listAccounts(userId)
      : system.listAccounts(userId),
  });
}

export async function getAccountNumberController(
  response: ServerResponse,
  userId: string,
  accountId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  writeResponse(response, 200, traceId, {
    accountNumber: relationalRoute && options.relationalHttp
      ? await options.relationalHttp.getAccountNumber(userId, accountId)
      : system.getAccountNumber(userId, accountId),
  });
}

export async function listTransactionsController(
  response: ServerResponse,
  userId: string,
  accountId: string,
  cursor: string | undefined,
  limit: number | undefined,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  const result = relationalRoute && options.relationalHttp
    ? await options.relationalHttp.listTransactions(userId, accountId, cursor, limit)
    : system.listTransactions(userId, accountId, cursor, limit);
  writeResponse(response, 200, traceId, result);
}

export async function getTransactionController(
  response: ServerResponse,
  userId: string,
  accountId: string,
  transactionId: string,
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
      ? await options.relationalHttp.getTransaction(userId, accountId, transactionId)
      : system.getTransaction(userId, accountId, transactionId),
  );
}

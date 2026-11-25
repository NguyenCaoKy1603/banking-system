import type { ServerResponse } from "node:http";
import type { BankingSystem } from "../bankingSystem.js";
import type { HttpOptions } from "../http.js";
import type { TransactionListFilters } from "../types.js";
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
  filters: TransactionListFilters | undefined,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  const result = relationalRoute && options.relationalHttp
    ? await options.relationalHttp.listTransactions(userId, accountId, cursor, limit, filters)
    : system.listTransactions(userId, accountId, cursor, limit, filters);
  writeResponse(response, 200, traceId, result);
}

export async function getAccountSummaryController(
  response: ServerResponse,
  userId: string,
  accountId: string,
  month: string | undefined,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  const summary = relationalRoute && options.relationalHttp
    ? await options.relationalHttp.getAccountMonthlySummary(userId, accountId, month)
    : system.getAccountMonthlySummary(userId, accountId, month);
  writeResponse(response, 200, traceId, summary);
}

export async function exportAccountStatementController(
  response: ServerResponse,
  userId: string,
  accountId: string,
  exportOptions: { from?: string; to?: string; format?: string },
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  const exported = relationalRoute && options.relationalHttp
    ? await options.relationalHttp.exportAccountStatement(userId, accountId, exportOptions)
    : system.exportAccountStatement(userId, accountId, exportOptions);
  response.statusCode = 200;
  response.setHeader("Content-Type", exported.contentType);
  response.setHeader("Content-Disposition", `attachment; filename="${exported.filename}"`);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Request-ID", traceId);
  response.end(exported.body);
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

import { ApiError } from "@/services/api/ApiError";
import { apiConfig } from "@/services/api/config";
import type { RequestAuth } from "@/services/api/httpClient";
import { requestJson } from "@/services/api/httpClient";
import type {
  AccountMonthlySummary,
  AccountNumberResponse,
  AccountsResponse,
  StatementExportFormat,
  TransactionDetail,
  TransactionFilterParams,
  TransactionPage,
} from "@/features/accounts/types/account";
import {
  isAccountMonthlySummary,
  isAccountNumberResponse,
  isAccountsResponse,
  isTransactionDetail,
  isTransactionPage,
} from "@/features/accounts/validation/accountResponseValidators";

export type ListTransactionsOptions = TransactionFilterParams & {
  auth: RequestAuth;
  cursor?: string;
  limit?: number;
};

export type GetAccountSummaryOptions = {
  auth: RequestAuth;
  month?: string;
};

export type ExportAccountStatementOptions = {
  auth: RequestAuth;
  from?: string;
  to?: string;
  format?: StatementExportFormat;
};

function requireResourceId(value: string, fieldName: string): string {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new TypeError(`${fieldName} không được để trống.`);
  }

  return encodeURIComponent(normalizedValue);
}

function buildTransactionPath(
  accountId: string,
  options: Omit<ListTransactionsOptions, "auth">,
): string {
  const query: string[] = [];

  if (options.cursor?.trim()) {
    query.push(`cursor=${encodeURIComponent(options.cursor.trim())}`);
  }

  if (options.limit !== undefined) {
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
      throw new RangeError("limit phải là số nguyên từ 1 đến 100.");
    }
    query.push(`limit=${options.limit}`);
  }

  if (options.status) {
    query.push(`status=${encodeURIComponent(options.status)}`);
  }

  if (options.direction) {
    query.push(`direction=${encodeURIComponent(options.direction)}`);
  }

  if (options.from?.trim()) {
    query.push(`from=${encodeURIComponent(options.from.trim())}`);
  }

  if (options.to?.trim()) {
    query.push(`to=${encodeURIComponent(options.to.trim())}`);
  }

  if (options.q?.trim()) {
    query.push(`q=${encodeURIComponent(options.q.trim())}`);
  }

  const queryString = query.length > 0 ? `?${query.join("&")}` : "";

  return `/accounts/${requireResourceId(accountId, "accountId")}/transactions${queryString}`;
}

export function listAccounts(auth: RequestAuth): Promise<AccountsResponse> {
  return requestJson<AccountsResponse>("/accounts", { auth }, isAccountsResponse);
}

export function getAccountNumber(
  accountId: string,
  auth: RequestAuth,
): Promise<AccountNumberResponse> {
  return requestJson<AccountNumberResponse>(
    `/accounts/${requireResourceId(accountId, "accountId")}/number`,
    { auth },
    isAccountNumberResponse,
  );
}

export function listTransactions(
  accountId: string,
  { auth, ...filters }: ListTransactionsOptions,
): Promise<TransactionPage> {
  return requestJson<TransactionPage>(
    buildTransactionPath(accountId, filters),
    { auth },
    isTransactionPage,
  );
}

export function getAccountSummary(
  accountId: string,
  { auth, month }: GetAccountSummaryOptions,
): Promise<AccountMonthlySummary> {
  const query = month?.trim() ? `?month=${encodeURIComponent(month.trim())}` : "";
  return requestJson<AccountMonthlySummary>(
    `/accounts/${requireResourceId(accountId, "accountId")}/summary${query}`,
    { auth },
    isAccountMonthlySummary,
  );
}

async function fetchStatementText(
  url: string,
  auth: RequestAuth,
  format: StatementExportFormat,
  allowRetry: boolean,
): Promise<string> {
  const headers: Record<string, string> = {
    Accept: format === "html" ? "text/html" : "text/csv",
  };
  if (auth.accessToken?.trim()) {
    headers.Authorization = `Bearer ${auth.accessToken.trim()}`;
  }
  if (auth.deviceId?.trim()) {
    headers["X-Device-ID"] = auth.deviceId.trim();
  }

  const response = await fetch(url, { method: "GET", headers });
  if (response.status === 401 && allowRetry && auth.refreshAccessToken) {
    const refreshed = await auth.refreshAccessToken();
    if (refreshed?.trim()) {
      return fetchStatementText(
        url,
        { ...auth, accessToken: refreshed.trim() },
        format,
        false,
      );
    }
  }

  if (!response.ok) {
    let message = "Không thể xuất sao kê tài khoản. Vui lòng thử lại.";
    let code = "INVALID_RESPONSE";
    try {
      const payload = (await response.json()) as { code?: string; message?: string };
      if (typeof payload.code === "string") code = payload.code;
      if (typeof payload.message === "string" && response.status < 500) {
        message = payload.message;
      }
    } catch {
      // keep default error message
    }
    throw new ApiError({ status: response.status, code, message });
  }

  return response.text();
}

export function exportAccountStatement(
  accountId: string,
  { auth, from, to, format = "csv" }: ExportAccountStatementOptions,
): Promise<string> {
  const query: string[] = [`format=${encodeURIComponent(format)}`];
  if (from?.trim()) {
    query.push(`from=${encodeURIComponent(from.trim())}`);
  }
  if (to?.trim()) {
    query.push(`to=${encodeURIComponent(to.trim())}`);
  }
  const baseUrl = apiConfig.baseUrl.replace(/\/+$/, "");
  const path = `/accounts/${requireResourceId(accountId, "accountId")}/statement-export?${query.join("&")}`;
  return fetchStatementText(`${baseUrl}${path}`, auth, format, true);
}

export function getTransactionDetail(
  accountId: string,
  transactionId: string,
  auth: RequestAuth,
): Promise<TransactionDetail> {
  return requestJson<TransactionDetail>(
    `/accounts/${requireResourceId(accountId, "accountId")}/transactions/${requireResourceId(transactionId, "transactionId")}`,
    { auth },
    isTransactionDetail,
  );
}

export const accountsApi = {
  listAccounts,
  getAccountNumber,
  listTransactions,
  getAccountSummary,
  exportAccountStatement,
  getTransactionDetail,
};

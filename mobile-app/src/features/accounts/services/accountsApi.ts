import type { RequestAuth } from "@/services/api/httpClient";
import { requestJson } from "@/services/api/httpClient";
import type {
  AccountNumberResponse,
  AccountsResponse,
  TransactionDetail,
  TransactionPage,
} from "@/features/accounts/types/account";
import {
  isAccountNumberResponse,
  isAccountsResponse,
  isTransactionDetail,
  isTransactionPage,
} from "@/features/accounts/validation/accountResponseValidators";

export type ListTransactionsOptions = {
  auth: RequestAuth;
  cursor?: string;
  limit?: number;
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
  cursor: string | undefined,
  limit: number | undefined,
): string {
  const query: string[] = [];

  if (cursor?.trim()) {
    query.push(`cursor=${encodeURIComponent(cursor.trim())}`);
  }

  if (limit !== undefined) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("limit phải là số nguyên từ 1 đến 100.");
    }
    query.push(`limit=${limit}`);
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
  { auth, cursor, limit }: ListTransactionsOptions,
): Promise<TransactionPage> {
  return requestJson<TransactionPage>(
    buildTransactionPath(accountId, cursor, limit),
    { auth },
    isTransactionPage,
  );
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
  getTransactionDetail,
};

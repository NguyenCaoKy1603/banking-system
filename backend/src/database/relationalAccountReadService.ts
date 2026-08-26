import { invalidRequest, notFound } from "../errors.js";
import type { PaymentAccount, Transaction, TransactionDetail } from "../types.js";
import { AccountRepository, type AccountTransactionRow } from "./repositories/accountRepository.js";
import { AuditRepository } from "./repositories/auditRepository.js";
import { randomUUID } from "node:crypto";
import { UnitOfWork } from "./unitOfWork.js";

type CursorPosition = { sortValue: string; id: string };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertAccountId(value: string): string {
  if (!UUID_PATTERN.test(value)) throw notFound("Account not found.");
  return value;
}

function decodeCursor(cursor: string | undefined, scope: string): CursorPosition | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>;
    if (parsed.version !== 1 || parsed.kind !== "ACCOUNT_TRANSACTIONS" || parsed.scope !== scope || typeof parsed.sortValue !== "string" || typeof parsed.id !== "string") {
      throw new Error("invalid cursor");
    }
    return { sortValue: parsed.sortValue, id: parsed.id };
  } catch {
    throw invalidRequest("cursor is invalid.", { cursor: "cursor is invalid." });
  }
}

function encodeCursor(scope: string, position: CursorPosition): string {
  return Buffer.from(JSON.stringify({ version: 1, kind: "ACCOUNT_TRANSACTIONS", scope, ...position }), "utf8").toString("base64url");
}

function money(amountMinor: string) {
  return { currency: "VND" as const, amountMinor };
}

function toPaymentAccount(row: {
  id: string;
  displayName: string;
  maskedNumber: string;
  bankName: string;
  availableMinor: string;
  currentMinor: string;
  heldMinor: string;
  status: "ACTIVE" | "BLOCKED";
  updatedAt: string;
}): PaymentAccount {
  return {
    id: row.id,
    displayName: row.displayName,
    maskedNumber: row.maskedNumber,
    bankName: row.bankName,
    currency: "VND",
    heldAmount: money(row.heldMinor),
    availableBalance: money(row.availableMinor),
    currentBalance: money(row.currentMinor),
    status: row.status,
    updatedAt: row.updatedAt,
  };
}

function toTransaction(row: AccountTransactionRow): Transaction {
  return {
    id: row.id,
    accountId: row.accountId,
    direction: row.direction,
    amount: money(row.amountMinor),
    fee: money(row.feeMinor),
    status: row.status,
    kind: row.kind as Transaction["kind"],
    description: row.description,
    counterpartyName: row.counterpartyName,
    occurredAt: row.occurredAt,
  };
}

function toTransactionDetail(row: AccountTransactionRow): TransactionDetail {
  return {
    ...toTransaction(row),
    reference: row.reference,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

/** Read-only account boundary for the relational HTTP cutover. */
export class RelationalAccountReadService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async listAccounts(customerId: string): Promise<PaymentAccount[]> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const accounts = await new AccountRepository(client).findAccountsByCustomer(customerId);
      return accounts.map(toPaymentAccount);
    });
  }

  async getAccountNumber(customerId: string, accountId: string): Promise<string> {
    assertAccountId(accountId);
    return this.unitOfWork.transaction(async ({ client }) => {
      const account = await new AccountRepository(client).findOwnedAccount(customerId, accountId);
      if (!account) throw notFound("Account not found.");
      await new AuditRepository(client).append({
        id: randomUUID(),
        eventType: "ACCOUNT_NUMBER_REVEALED",
        actorCustomerId: customerId,
        resourceId: account.id,
      });
      return account.accountNumber;
    });
  }

  async listTransactions(
    customerId: string,
    accountId: string,
    cursor?: string,
    limit = 20,
  ): Promise<{ items: Transaction[]; nextCursor: string | null }> {
    assertAccountId(accountId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw invalidRequest("limit must be an integer between 1 and 100.", { limit: "limit must be between 1 and 100." });
    }
    return this.unitOfWork.transaction(async ({ client }) => {
      const accounts = new AccountRepository(client);
      if (!(await accounts.findOwnedAccount(customerId, accountId))) throw notFound("Account not found.");
      const all = await accounts.listTransactions(accountId, 1000);
      const position = decodeCursor(cursor, accountId);
      const sorted = [...all].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id));
      const remaining = position
        ? sorted.filter((item) => item.occurredAt < position.sortValue || (item.occurredAt === position.sortValue && item.id < position.id))
        : sorted;
      const items = remaining.slice(0, limit);
      const last = items.at(-1);
      return {
        items: items.map(toTransaction),
        nextCursor: remaining.length > items.length && last ? encodeCursor(accountId, { sortValue: last.occurredAt, id: last.id }) : null,
      };
    });
  }

  async getTransaction(customerId: string, accountId: string, transactionId: string): Promise<TransactionDetail> {
    assertAccountId(accountId);
    if (!UUID_PATTERN.test(transactionId)) throw notFound("Transaction not found.");
    return this.unitOfWork.transaction(async ({ client }) => {
      const accounts = new AccountRepository(client);
      if (!(await accounts.findOwnedAccount(customerId, accountId))) throw notFound("Account not found.");
      const mapped = await accounts.findTransaction(accountId, transactionId);
      if (!mapped) throw notFound("Transaction not found.");
      return toTransactionDetail(mapped);
    });
  }
}

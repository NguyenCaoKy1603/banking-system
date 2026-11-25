import { invalidRequest, notFound } from "../errors.js";
import type {
  AccountMonthlySummary,
  AccountStatementExport,
  PaymentAccount,
  StatementExportFormat,
  Transaction,
  TransactionDetail,
  TransactionListFilters,
} from "../types.js";
import {
  AccountRepository,
  type AccountTransactionRow,
  type RepositoryTransactionFilters,
} from "./repositories/accountRepository.js";
import { AuditRepository } from "./repositories/auditRepository.js";
import { randomUUID } from "node:crypto";
import { UnitOfWork } from "./unitOfWork.js";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_STATEMENT_ROWS = 1000;

export type NormalizedTransactionFilters = {
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "REVERSED" | null;
  direction: "CREDIT" | "DEBIT" | null;
  fromIso: string | null;
  toIso: string | null;
  q: string | null;
  qPattern: string | null;
};

function parseBoundaryDate(value: string, bound: "from" | "to"): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw invalidRequest(`${bound} must be a valid ISO date.`, {
      [bound]: `${bound} must be a valid ISO date.`,
    });
  }
  const isoCandidate = DATE_ONLY_PATTERN.test(trimmed)
    ? bound === "from"
      ? `${trimmed}T00:00:00.000Z`
      : `${trimmed}T23:59:59.999Z`
    : trimmed;
  const timestamp = Date.parse(isoCandidate);
  if (Number.isNaN(timestamp)) {
    throw invalidRequest(`${bound} must be a valid ISO date.`, {
      [bound]: `${bound} must be a valid ISO date.`,
    });
  }
  return new Date(timestamp).toISOString();
}

export function normalizeTransactionFilters(
  filters?: TransactionListFilters,
): NormalizedTransactionFilters {
  let status: NormalizedTransactionFilters["status"] = null;
  if (filters?.status !== undefined) {
    if (
      filters.status !== "PENDING" &&
      filters.status !== "SUCCEEDED" &&
      filters.status !== "FAILED" &&
      filters.status !== "REVERSED"
    ) {
      throw invalidRequest("status is invalid.", {
        status: "status must be SUCCEEDED, PENDING, FAILED or REVERSED.",
      });
    }
    status = filters.status;
  }

  let direction: NormalizedTransactionFilters["direction"] = null;
  if (filters?.direction !== undefined) {
    if (filters.direction !== "CREDIT" && filters.direction !== "DEBIT") {
      throw invalidRequest("direction is invalid.", {
        direction: "direction must be CREDIT or DEBIT.",
      });
    }
    direction = filters.direction;
  }

  const fromIso = filters?.from?.trim() ? parseBoundaryDate(filters.from, "from") : null;
  const toIso = filters?.to?.trim() ? parseBoundaryDate(filters.to, "to") : null;
  if (fromIso && toIso && Date.parse(fromIso) > Date.parse(toIso)) {
    throw invalidRequest("from must not be after to.", {
      from: "from must not be after to.",
    });
  }

  const trimmedQuery = filters?.q?.trim() ?? "";
  if (trimmedQuery.length > 120) {
    throw invalidRequest("q is too long.", {
      q: "q must not exceed 120 characters.",
    });
  }
  const escapedPattern = trimmedQuery
    ? `%${trimmedQuery.replace(/[\\%_]/g, "\\$&")}%`
    : null;

  return {
    status,
    direction,
    fromIso,
    toIso,
    q: trimmedQuery || null,
    qPattern: escapedPattern,
  };
}

export function toRepositoryTransactionFilters(
  normalized: NormalizedTransactionFilters,
): RepositoryTransactionFilters {
  return {
    status: normalized.status,
    direction: normalized.direction,
    fromIso: normalized.fromIso,
    toIso: normalized.toIso,
    qPattern: normalized.qPattern,
  };
}

export function parseSummaryMonth(
  month?: string,
  now: Date = new Date(),
): { month: string; monthLabel: string; startIso: string; endIso: string } {
  const trimmed = month?.trim();
  let year: number;
  let monthNum: number;

  if (!trimmed) {
    year = now.getUTCFullYear();
    monthNum = now.getUTCMonth() + 1;
  } else {
    if (!MONTH_PATTERN.test(trimmed)) {
      throw invalidRequest("month must be in YYYY-MM format.", {
        month: "month must be in YYYY-MM format.",
      });
    }
    const [yearPart, monthPart] = trimmed.split("-");
    year = Number(yearPart);
    monthNum = Number(monthPart);
  }

  const monthPadded = String(monthNum).padStart(2, "0");
  const startIso = new Date(Date.UTC(year, monthNum - 1, 1, 0, 0, 0, 0)).toISOString();
  const endIso = new Date(Date.UTC(year, monthNum, 1, 0, 0, 0, 0)).toISOString();
  return {
    month: `${year}-${monthPadded}`,
    monthLabel: `${monthPadded}/${year}`,
    startIso,
    endIso,
  };
}

function escapeCsvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatVndFromMinor(minorText: string): string {
  const negative = minorText.startsWith("-");
  const digits = negative ? minorText.slice(1) : minorText;
  const formatted = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${formatted} VND`;
}

export function buildAccountStatementExport(input: {
  account: PaymentAccount;
  transactions: readonly TransactionDetail[];
  fromIso?: string | null;
  toIso?: string | null;
  format?: string;
}): AccountStatementExport {
  const normalizedFormat = (input.format?.trim().toLowerCase() || "csv") as StatementExportFormat;
  if (normalizedFormat !== "csv" && normalizedFormat !== "html") {
    throw invalidRequest("format must be csv or html.", {
      format: "format must be csv or html.",
    });
  }

  const dateTag = new Date().toISOString().slice(0, 10);
  const accountSuffix = input.account.id.slice(0, 8);

  if (normalizedFormat === "csv") {
    const header = [
      "Mã tham chiếu",
      "Thời gian",
      "Loại giao dịch",
      "Số tiền (VND)",
      "Phí (VND)",
      "Trạng thái",
      "Đối tác",
      "Nội dung",
    ]
      .map(escapeCsvCell)
      .join(",");

    const lines = input.transactions.map((tx) =>
      [
        tx.reference,
        tx.occurredAt,
        tx.direction === "CREDIT" ? "Tiền vào" : "Tiền ra",
        tx.amount.amountMinor,
        tx.fee.amountMinor,
        tx.status,
        tx.counterpartyName ?? "",
        tx.description,
      ]
        .map((cell) => escapeCsvCell(String(cell)))
        .join(","),
    );

    return {
      format: "csv",
      contentType: "text/csv; charset=utf-8",
      filename: `nova-statement-${accountSuffix}-${dateTag}.csv`,
      body: `\uFEFF${[header, ...lines].join("\r\n")}`,
    };
  }

  let totalIncome = 0n;
  let totalExpense = 0n;
  for (const tx of input.transactions) {
    if (tx.status !== "SUCCEEDED") continue;
    const amount = BigInt(tx.amount.amountMinor);
    if (tx.direction === "CREDIT") totalIncome += amount;
    else totalExpense += amount;
  }
  const net = totalIncome - totalExpense;
  const rangeLabel = `${input.fromIso ? input.fromIso.slice(0, 10) : "Từ đầu"} -> ${input.toIso ? input.toIso.slice(0, 10) : "Hiện tại"}`;

  const rowsHtml = input.transactions
    .map(
      (tx) => `<tr>
  <td>${escapeHtml(tx.occurredAt)}</td>
  <td>${escapeHtml(tx.reference)}</td>
  <td>${tx.direction === "CREDIT" ? "Tiền vào (+)" : "Tiền ra (-)"}</td>
  <td>${escapeHtml(formatVndFromMinor(tx.amount.amountMinor))}</td>
  <td>${escapeHtml(formatVndFromMinor(tx.fee.amountMinor))}</td>
  <td>${escapeHtml(tx.status)}</td>
  <td>${escapeHtml(tx.counterpartyName ?? "-")}</td>
  <td>${escapeHtml(tx.description)}</td>
</tr>`,
    )
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Sao kê tài khoản NOVA - ${escapeHtml(input.account.maskedNumber)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #101828; }
    h1 { color: #0B4F6C; margin-bottom: 4px; }
    .meta { margin-bottom: 16px; color: #475467; font-size: 14px; }
    .summary { display: flex; gap: 24px; margin-bottom: 20px; padding: 12px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid #CBD5E1; padding: 8px; text-align: left; }
    th { background: #F1F5F9; }
  </style>
</head>
<body>
  <h1>NOVA Digital Banking - Sao kê tài khoản</h1>
  <div class="meta">
    <div>Tài khoản: <strong>${escapeHtml(input.account.displayName)} (${escapeHtml(input.account.maskedNumber)})</strong> - ${escapeHtml(input.account.bankName)}</div>
    <div>Kỳ sao kê: ${escapeHtml(rangeLabel)} | Số lượng giao dịch: ${input.transactions.length}</div>
  </div>
  <div class="summary">
    <div>Tổng thu: <strong>+${escapeHtml(formatVndFromMinor(totalIncome.toString()))}</strong></div>
    <div>Tổng chi: <strong>-${escapeHtml(formatVndFromMinor(totalExpense.toString()))}</strong></div>
    <div>Chênh lệch ròng: <strong>${escapeHtml(formatVndFromMinor(net.toString()))}</strong></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Thời gian</th>
        <th>Mã tham chiếu</th>
        <th>Loại</th>
        <th>Số tiền</th>
        <th>Phí</th>
        <th>Trạng thái</th>
        <th>Đối tác</th>
        <th>Nội dung</th>
      </tr>
    </thead>
    <tbody>
${rowsHtml}
    </tbody>
  </table>
</body>
</html>`;

  return {
    format: "html",
    contentType: "text/html; charset=utf-8",
    filename: `nova-statement-${accountSuffix}-${dateTag}.html`,
    body: html,
  };
}

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
    if (!UUID_PATTERN.test(parsed.id) || Number.isNaN(Date.parse(parsed.sortValue))) throw new Error("invalid cursor");
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

function toTransactionKind(value: string | null): Transaction["kind"] {
  switch (value) {
    case "TRANSFER":
    case "SANDBOX_FUNDING":
    case "SAVINGS":
    case "CREDIT_PAYMENT":
    case "MATURITY":
      return value;
    default:
      // `kind` is nullable in the relational schema and older/admin rows can
      // contain internal values that are intentionally outside the public API
      // enum. Omit those values rather than emitting an invalid response.
      return undefined;
  }
}

function toTransaction(row: AccountTransactionRow): Transaction {
  const transaction: Transaction = {
    id: row.id,
    accountId: row.accountId,
    direction: row.direction,
    amount: money(row.amountMinor),
    fee: money(row.feeMinor),
    status: row.status,
    description: row.description,
    counterpartyName: row.counterpartyName,
    occurredAt: row.occurredAt,
  };
  const kind = toTransactionKind(row.kind);
  if (kind) transaction.kind = kind;
  return transaction;
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
    filters?: TransactionListFilters,
  ): Promise<{ items: Transaction[]; nextCursor: string | null }> {
    assertAccountId(accountId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw invalidRequest("limit must be an integer between 1 and 100.", { limit: "limit must be between 1 and 100." });
    }
    const normalizedFilters = normalizeTransactionFilters(filters);
    return this.unitOfWork.transaction(async ({ client }) => {
      const accounts = new AccountRepository(client);
      if (!(await accounts.findOwnedAccount(customerId, accountId))) throw notFound("Account not found.");
      const position = decodeCursor(cursor, accountId);
      const rows = await accounts.listTransactions(
        accountId,
        position ? { occurredAt: position.sortValue, id: position.id } : null,
        limit + 1,
        toRepositoryTransactionFilters(normalizedFilters),
      );
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      return {
        items: items.map(toTransaction),
        nextCursor: hasMore && last ? encodeCursor(accountId, { sortValue: last.occurredAt, id: last.id }) : null,
      };
    });
  }

  async getMonthlySummary(
    customerId: string,
    accountId: string,
    month?: string,
  ): Promise<AccountMonthlySummary> {
    assertAccountId(accountId);
    const period = parseSummaryMonth(month);
    return this.unitOfWork.transaction(async ({ client }) => {
      const accounts = new AccountRepository(client);
      if (!(await accounts.findOwnedAccount(customerId, accountId))) throw notFound("Account not found.");
      const aggregate = await accounts.summarizeMonthlyTransactions(
        accountId,
        period.startIso,
        period.endIso,
      );
      const totalIncome = BigInt(aggregate.totalIncomeMinor);
      const totalExpense = BigInt(aggregate.totalExpenseMinor);
      return {
        accountId,
        month: period.month,
        monthLabel: period.monthLabel,
        currency: "VND",
        totalIncomeMinor: totalIncome.toString(),
        totalExpenseMinor: totalExpense.toString(),
        netMinor: (totalIncome - totalExpense).toString(),
        succeededCount: aggregate.creditCount + aggregate.debitCount,
        creditCount: aggregate.creditCount,
        debitCount: aggregate.debitCount,
      };
    });
  }

  async exportStatement(
    customerId: string,
    accountId: string,
    options?: { from?: string; to?: string; format?: string },
  ): Promise<AccountStatementExport> {
    assertAccountId(accountId);
    const normalizedFilters = normalizeTransactionFilters({
      from: options?.from,
      to: options?.to,
    });
    const format = options?.format?.trim().toLowerCase() || "csv";
    if (format !== "csv" && format !== "html") {
      throw invalidRequest("format must be csv or html.", {
        format: "format must be csv or html.",
      });
    }
    return this.unitOfWork.transaction(async ({ client }) => {
      const accounts = new AccountRepository(client);
      const account = await accounts.findOwnedAccount(customerId, accountId);
      if (!account) throw notFound("Account not found.");
      const rows = await accounts.listTransactions(
        accountId,
        null,
        MAX_STATEMENT_ROWS,
        toRepositoryTransactionFilters(normalizedFilters),
      );
      return buildAccountStatementExport({
        account: toPaymentAccount(account),
        transactions: rows.map(toTransactionDetail),
        fromIso: normalizedFilters.fromIso,
        toIso: normalizedFilters.toIso,
        format,
      });
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

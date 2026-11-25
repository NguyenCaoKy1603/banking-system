import type { Money } from "@/features/banking/types/money";

export type AccountStatus = "ACTIVE" | "BLOCKED";

export type PaymentAccount = {
  id: string;
  displayName: string;
  maskedNumber: string;
  bankName: string;
  currency: "VND";
  heldAmount: Money;
  availableBalance: Money;
  currentBalance: Money;
  status: AccountStatus;
  updatedAt: string;
};

export type AccountsResponse = {
  accounts: PaymentAccount[];
};

export type AccountNumberResponse = {
  accountNumber: string;
};

export type TransactionDirection = "CREDIT" | "DEBIT";

export type TransactionStatus =
  | "PENDING"
  | "SUCCEEDED"
  | "FAILED"
  | "REVERSED";

export type TransactionKind =
  | "TRANSFER"
  | "SANDBOX_FUNDING"
  | "SAVINGS"
  | "CREDIT_PAYMENT"
  | "MATURITY";

export type Transaction = {
  id: string;
  accountId: string;
  direction: TransactionDirection;
  amount: Money;
  fee: Money;
  status: TransactionStatus;
  kind?: TransactionKind;
  description: string;
  counterpartyName: string | null;
  occurredAt: string;
};

export type TransactionPage = {
  items: Transaction[];
  nextCursor: string | null;
};

export type TransactionDetail = Transaction & {
  reference: string;
  createdAt: string;
  completedAt: string | null;
};

export type TransactionFilterParams = {
  status?: TransactionStatus;
  direction?: TransactionDirection;
  from?: string;
  to?: string;
  q?: string;
};

export type AccountMonthlySummary = {
  accountId: string;
  month: string;
  monthLabel: string;
  currency: "VND";
  totalIncomeMinor: string;
  totalExpenseMinor: string;
  netMinor: string;
  succeededCount: number;
  creditCount: number;
  debitCount: number;
};

export type StatementExportFormat = "csv" | "html";

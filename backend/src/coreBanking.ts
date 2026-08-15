import { conflict, notFound } from "./errors.js";
import {
  InMemoryLedger,
  type LedgerEntryInput,
  type InMemoryLedgerState,
  type LedgerPort,
} from "./ledger.js";
import { createId } from "./security.js";
import type {
  Money,
  PaymentAccount,
  TransactionDetail,
  TransferStatus,
  TransferReceipt,
} from "./types.js";
import { toMoney } from "./money.js";

type CoreAccount = {
  id: string;
  ownerId: string;
  displayName: string;
  maskedNumber: string;
  openingBalanceMinor: bigint;
  availableMinor: bigint;
  currentMinor: bigint;
  status: "ACTIVE" | "BLOCKED";
  updatedAt: string;
};

export type CoreTransferInput = {
  accountId: string;
  amountMinor: bigint;
  feeMinor: bigint;
  counterpartyName: string;
  description: string;
  now: string;
  settleImmediately?: boolean;
};

export type TerminalTransferStatus = Exclude<TransferStatus, "PENDING">;

export type ReconciliationRow = {
  accountId: string;
  coreAvailableMinor: string;
  computedAvailableMinor: string;
  transactionComputedAvailableMinor: string;
  differenceMinor: string;
};

type SerializedCoreAccount = Omit<
  CoreAccount,
  "openingBalanceMinor" | "availableMinor" | "currentMinor"
> & {
  openingBalanceMinor: string;
  availableMinor: string;
  currentMinor: string;
};

type CoreTransferState = {
  ownerId: string;
  accountId: string;
  transactionId: string;
  ledgerJournalId: string;
  receipt: TransferReceipt;
  refunded: boolean;
};

export type InMemoryCoreState = {
  accounts: Array<[string, SerializedCoreAccount]>;
  transactions: Array<[string, TransactionDetail[]]>;
  transfers: Array<[string, CoreTransferState]>;
  ledger: InMemoryLedgerState;
};

export interface CoreBankingPort {
  createPaymentAccount(ownerId: string, now: string): PaymentAccount;
  listPaymentAccounts(ownerId: string): PaymentAccount[];
  getPaymentAccount(ownerId: string, accountId: string): PaymentAccount;
  listTransactions(ownerId: string, accountId: string): TransactionDetail[];
  getTransaction(ownerId: string, accountId: string, transactionId: string): TransactionDetail;
  postTransfer(ownerId: string, input: CoreTransferInput): TransferReceipt;
  settleTransfer(ownerId: string, transferId: string, now: string): TransferReceipt;
  transitionTransfer(
    ownerId: string,
    transferId: string,
    status: TerminalTransferStatus,
    now: string,
  ): TransferReceipt;
  reconcile(): ReconciliationRow[];
}

export class InMemoryCoreBanking implements CoreBankingPort {
  readonly ledger: LedgerPort;
  private readonly accounts = new Map<string, CoreAccount>();
  private readonly transactions = new Map<string, TransactionDetail[]>();
  private readonly transfers = new Map<
    string,
    {
      ownerId: string;
      accountId: string;
      transactionId: string;
      ledgerJournalId: string;
      receipt: TransferReceipt;
      refunded: boolean;
    }
  >();

  constructor(options: { ledger?: LedgerPort } = {}) {
    this.ledger = options.ledger ?? new InMemoryLedger();
  }

  createPaymentAccount(ownerId: string, now: string): PaymentAccount {
    const account: CoreAccount = {
      id: createId("account"),
      ownerId,
      displayName: "Tài khoản thanh toán",
      maskedNumber: `•••• ${String(this.accounts.size + 1).padStart(4, "0")}`,
      openingBalanceMinor: 10_000_000n,
      availableMinor: 10_000_000n,
      currentMinor: 10_000_000n,
      status: "ACTIVE",
      updatedAt: now,
    };
    this.ledger.append({
      journalId: createId("ledger-journal"),
      occurredAt: now,
      entries: [
        {
          accountId: "opening-funding:VND",
          side: "DEBIT",
          amountMinor: account.openingBalanceMinor,
          currency: "VND",
        },
        {
          accountId: account.id,
          side: "CREDIT",
          amountMinor: account.openingBalanceMinor,
          currency: "VND",
        },
      ],
    });
    this.accounts.set(account.id, account);
    this.transactions.set(account.id, []);
    return this.toPaymentAccount(account);
  }

  listPaymentAccounts(ownerId: string): PaymentAccount[] {
    return [...this.accounts.values()]
      .filter((account) => account.ownerId === ownerId)
      .map((account) => this.toPaymentAccount(account));
  }

  getPaymentAccount(ownerId: string, accountId: string): PaymentAccount {
    const account = this.requireOwnedAccount(ownerId, accountId);
    return this.toPaymentAccount(account);
  }

  listTransactions(ownerId: string, accountId: string): TransactionDetail[] {
    this.requireOwnedAccount(ownerId, accountId);
    return [...(this.transactions.get(accountId) ?? [])].sort((left, right) =>
      right.occurredAt.localeCompare(left.occurredAt),
    );
  }

  getTransaction(
    ownerId: string,
    accountId: string,
    transactionId: string,
  ): TransactionDetail {
    const transactions = this.listTransactions(ownerId, accountId);
    const transaction = transactions.find((item) => item.id === transactionId);

    if (!transaction) {
      throw notFound("Transaction not found.");
    }

    return transaction;
  }

  postTransfer(ownerId: string, input: CoreTransferInput): TransferReceipt {
    const account = this.requireOwnedAccount(ownerId, input.accountId);

    if (account.status !== "ACTIVE") {
      throw conflict("The source account is not active.");
    }

    const totalDebit = input.amountMinor + input.feeMinor;
    if (input.amountMinor <= 0n || input.feeMinor < 0n || totalDebit <= 0n) {
      throw conflict("Transfer amount and fee must be valid positive minor units.");
    }
    if (account.availableMinor < totalDebit) {
      throw conflict("Insufficient available balance.");
    }

    const transferId = createId("transfer");
    const reference = `REF-${transferId.slice(-12).toUpperCase()}`;
    const ledgerJournalId = createId("ledger-journal");
    const ledgerEntries: LedgerEntryInput[] = [
      {
        accountId: account.id,
        side: "DEBIT",
        amountMinor: totalDebit,
        currency: "VND",
      },
      {
        accountId: "settlement:VND",
        side: "CREDIT",
        amountMinor: input.amountMinor,
        currency: "VND",
      },
    ];
    if (input.feeMinor > 0n) {
      ledgerEntries.push({
        accountId: "fee-income:VND",
        side: "CREDIT",
        amountMinor: input.feeMinor,
        currency: "VND",
      });
    }
    this.ledger.append({
      journalId: ledgerJournalId,
      occurredAt: input.now,
      entries: ledgerEntries,
    });

    account.availableMinor -= totalDebit;
    account.currentMinor -= totalDebit;
    account.updatedAt = input.now;

    const status = input.settleImmediately === false ? "PENDING" : "SUCCEEDED";
    const transaction: TransactionDetail = {
      id: createId("transaction"),
      accountId: account.id,
      direction: "DEBIT",
      amount: toMoney(input.amountMinor),
      fee: toMoney(input.feeMinor),
      status,
      description: input.description,
      counterpartyName: input.counterpartyName,
      occurredAt: input.now,
      reference,
      createdAt: input.now,
      completedAt: status === "SUCCEEDED" ? input.now : null,
    };
    this.transactions.get(account.id)?.push(transaction);

    const receipt: TransferReceipt = {
      transferId,
      reference,
      status,
      amount: toMoney(input.amountMinor),
      fee: toMoney(input.feeMinor),
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.transfers.set(transferId, {
      ownerId,
      accountId: account.id,
      transactionId: transaction.id,
      ledgerJournalId,
      receipt,
      refunded: false,
    });
    return receipt;
  }

  settleTransfer(ownerId: string, transferId: string, now: string): TransferReceipt {
    return this.transitionTransfer(ownerId, transferId, "SUCCEEDED", now);
  }

  transitionTransfer(
    ownerId: string,
    transferId: string,
    status: TerminalTransferStatus,
    now: string,
  ): TransferReceipt {
    const transfer = this.transfers.get(transferId);
    if (!transfer || transfer.ownerId !== ownerId) {
      throw notFound("Transfer not found.");
    }

    if (transfer.receipt.status === status) {
      return { ...transfer.receipt };
    }
    if (transfer.receipt.status !== "PENDING") {
      throw conflict("A terminal transfer cannot change state.");
    }

    const transaction = this.transactions
      .get(transfer.accountId)
      ?.find((item) => item.id === transfer.transactionId);
    if (!transaction) {
      throw notFound("Transfer transaction not found.");
    }

    if ((status === "FAILED" || status === "REVERSED") && !transfer.refunded) {
      const account = this.accounts.get(transfer.accountId);
      if (!account) {
        throw notFound("Transfer account not found.");
      }
      const totalDebit =
        BigInt(transfer.receipt.amount.amountMinor) +
        BigInt(transfer.receipt.fee.amountMinor);
      const reversalEntries: LedgerEntryInput[] = [
        {
          accountId: transfer.accountId,
          side: "CREDIT",
          amountMinor: totalDebit,
          currency: "VND",
        },
        {
          accountId: "settlement:VND",
          side: "DEBIT",
          amountMinor: BigInt(transfer.receipt.amount.amountMinor),
          currency: "VND",
        },
      ];
      if (BigInt(transfer.receipt.fee.amountMinor) > 0n) {
        reversalEntries.push({
          accountId: "fee-income:VND",
          side: "DEBIT",
          amountMinor: BigInt(transfer.receipt.fee.amountMinor),
          currency: "VND",
        });
      }
      this.ledger.append({
        journalId: createId("ledger-journal"),
        occurredAt: now,
        entries: reversalEntries,
      });
      account.availableMinor += totalDebit;
      account.currentMinor += totalDebit;
      account.updatedAt = now;
      transfer.refunded = true;
    }

    transaction.status = status;
    transaction.completedAt = now;
    transfer.receipt = {
      ...transfer.receipt,
      status,
      updatedAt: now,
    };
    return { ...transfer.receipt };
  }

  reconcile(): ReconciliationRow[] {
    return [...this.accounts.values()].map((account) => {
      const transactions = this.transactions.get(account.id) ?? [];
      const transactionComputedAvailableMinor = transactions.reduce(
        (balance, transaction) => {
          if (transaction.status === "FAILED" || transaction.status === "REVERSED") {
            return balance;
          }
          if (transaction.direction === "CREDIT") {
            return balance + BigInt(transaction.amount.amountMinor);
          }
          return (
            balance -
            BigInt(transaction.amount.amountMinor) -
            BigInt(transaction.fee.amountMinor)
          );
        },
        account.openingBalanceMinor,
      );
      const ledgerComputedAvailableMinor = this.ledger.getNetBalance(account.id);
      return {
        accountId: account.id,
        coreAvailableMinor: account.availableMinor.toString(),
        computedAvailableMinor: ledgerComputedAvailableMinor.toString(),
        transactionComputedAvailableMinor:
          transactionComputedAvailableMinor.toString(),
        differenceMinor: (
          account.availableMinor - ledgerComputedAvailableMinor
        ).toString(),
      };
    });
  }

  exportState(): InMemoryCoreState {
    if (!(this.ledger instanceof InMemoryLedger)) {
      throw new Error("Persistent sandbox requires an InMemoryLedger.");
    }

    return {
      accounts: [...this.accounts.entries()].map(([accountId, account]) => [
        accountId,
        {
          ...account,
          openingBalanceMinor: account.openingBalanceMinor.toString(),
          availableMinor: account.availableMinor.toString(),
          currentMinor: account.currentMinor.toString(),
        },
      ]),
      transactions: [...this.transactions.entries()].map(([accountId, items]) => [
        accountId,
        items.map((item) => ({
          ...item,
          amount: { ...item.amount },
          fee: { ...item.fee },
        })),
      ]),
      transfers: [...this.transfers.entries()].map(([transferId, transfer]) => [
        transferId,
        {
          ...transfer,
          receipt: {
            ...transfer.receipt,
            amount: { ...transfer.receipt.amount },
            fee: { ...transfer.receipt.fee },
          },
        },
      ]),
      ledger: this.ledger.exportState(),
    };
  }

  importState(state: InMemoryCoreState): void {
    if (!(this.ledger instanceof InMemoryLedger)) {
      throw new Error("Persistent sandbox requires an InMemoryLedger.");
    }

    this.accounts.clear();
    for (const [accountId, account] of state.accounts) {
      this.accounts.set(accountId, {
        ...account,
        openingBalanceMinor: BigInt(account.openingBalanceMinor),
        availableMinor: BigInt(account.availableMinor),
        currentMinor: BigInt(account.currentMinor),
      });
    }
    this.transactions.clear();
    for (const [accountId, items] of state.transactions) {
      this.transactions.set(
        accountId,
        items.map((item) => ({
          ...item,
          amount: { ...item.amount },
          fee: { ...item.fee },
        })),
      );
    }
    this.transfers.clear();
    for (const [transferId, transfer] of state.transfers) {
      this.transfers.set(transferId, {
        ...transfer,
        receipt: {
          ...transfer.receipt,
          amount: { ...transfer.receipt.amount },
          fee: { ...transfer.receipt.fee },
        },
      });
    }
    this.ledger.importState(state.ledger);
  }

  private requireOwnedAccount(ownerId: string, accountId: string): CoreAccount {
    const account = this.accounts.get(accountId);

    if (!account || account.ownerId !== ownerId) {
      throw notFound("Account not found.");
    }

    return account;
  }

  private toPaymentAccount(account: CoreAccount): PaymentAccount {
    const result: PaymentAccount = {
      id: account.id,
      displayName: account.displayName,
      maskedNumber: account.maskedNumber,
      currency: "VND",
      availableBalance: toMoney(account.availableMinor),
      currentBalance: toMoney(account.currentMinor),
      status: account.status,
      updatedAt: account.updatedAt,
    };
    return result;
  }
}

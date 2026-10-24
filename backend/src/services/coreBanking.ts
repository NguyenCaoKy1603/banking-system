import { conflict, conflictWithCode, notFound } from "../errors.js";
import {
  InMemoryLedger,
  type LedgerEntryInput,
  type InMemoryLedgerState,
  type LedgerPort,
} from "../domain/ledger.js";
import { createId } from "../security.js";
import type {
  FundingReceipt,
  Money,
  PaymentAccount,
  TransactionDetail,
  TransferStatus,
  TransferReceipt,
} from "../types.js";
import { toMoney } from "../domain/money.js";

type CoreAccount = {
  id: string;
  ownerId: string;
  displayName: string;
  accountNumber: string;
  maskedNumber: string;
  bankName: string;
  openingBalanceMinor: bigint;
  heldMinor: bigint;
  availableMinor: bigint;
  currentMinor: bigint;
  status: "ACTIVE" | "BLOCKED";
  updatedAt: string;
};

export type CoreTransferInput = {
  accountId: string;
  destinationAccountId: string;
  destinationOwnerId: string;
  amountMinor: bigint;
  feeMinor: bigint;
  counterpartyName: string;
  description: string;
  now: string;
  settleImmediately?: boolean;
};

export type TerminalTransferStatus = Exclude<TransferStatus, "PENDING">;

export type CoreTransferTarget = {
  accountId: string;
  transactionId: string;
};

export type CoreTransferParties = {
  sourceOwnerId: string;
  sourceAccountId: string;
  sourceTransactionId: string;
  destinationOwnerId: string;
  destinationAccountId: string;
  destinationTransactionId: string | null;
};

export type CoreAccountLookup = {
  ownerId: string;
  accountId: string;
  accountNumber: string;
  maskedNumber: string;
  displayName: string;
  bankName: string;
  status: "ACTIVE" | "BLOCKED";
};

export type CoreSavingsOpeningInput = {
  openingId: string;
  depositId: string;
  accountId: string;
  amountMinor: bigint;
  description: string;
  now: string;
  settleImmediately?: boolean;
};

export type SavingsOpeningReceipt = {
  openingId: string;
  depositId: string;
  transactionId: string;
  reference: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "REVERSED";
  amount: Money;
  createdAt: string;
  updatedAt: string;
};

export type CoreSavingsMaturityInput = {
  idempotencyKey: string;
  depositId: string;
  newDepositId?: string;
  accountId: string;
  principalMinor: bigint;
  interestMinor: bigint;
  creditToPaymentMinor: bigint;
  newSavingsPrincipalMinor: bigint;
  now: string;
  description: string;
};

export type SavingsMaturityReceipt = {
  depositId: string;
  newDepositId: string | null;
  transactionId: string | null;
  reference: string;
  creditedAmount: Money;
  occurredAt: string;
};

export type ReconciliationRow = {
  accountId: string;
  coreAvailableMinor: string;
  computedAvailableMinor: string;
  transactionComputedAvailableMinor: string;
  differenceMinor: string;
};

export type LedgerAccountBalance = {
  accountId: string;
  netBalanceMinor: string;
};

type SerializedCoreAccount = Omit<
  CoreAccount,
  | "accountNumber"
  | "openingBalanceMinor"
  | "heldMinor"
  | "availableMinor"
  | "currentMinor"
> & {
  accountNumber?: string;
  openingBalanceMinor: string;
  heldMinor?: string;
  availableMinor: string;
  currentMinor: string;
};

type CoreTransferState = {
  ownerId: string;
  destinationOwnerId?: string;
  accountId: string;
  destinationAccountId?: string;
  transactionId: string;
  destinationTransactionId?: string | null;
  ledgerJournalId?: string | null;
  receipt: TransferReceipt;
  refunded: boolean;
  heldMinor?: string;
};

type CoreSavingsOpeningState = {
  ownerId: string;
  accountId: string;
  depositId: string;
  transactionId: string;
  ledgerJournalId: string | null;
  receipt: SavingsOpeningReceipt;
  refunded: boolean;
  heldMinor?: string;
};

type CoreSavingsMaturityState = {
  ownerId: string;
  requestFingerprint: string;
  receipt: SavingsMaturityReceipt;
};

export type CoreCreditPaymentInput = {
  paymentId: string;
  creditAccountId: string;
  accountId: string;
  amountMinor: bigint;
  description: string;
  now: string;
  settleImmediately?: boolean;
};

export type CreditPaymentReceipt = {
  paymentId: string;
  transactionId: string;
  reference: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "REVERSED";
  amount: Money;
  createdAt: string;
  updatedAt: string;
};

type CoreCreditPaymentState = {
  ownerId: string;
  accountId: string;
  creditAccountId: string;
  transactionId: string;
  receipt: CreditPaymentReceipt;
  refunded: boolean;
  clearingApplied: boolean;
};

export type InMemoryCoreState = {
  accounts: Array<[string, SerializedCoreAccount]>;
  transactions: Array<[string, TransactionDetail[]]>;
  transfers: Array<[string, CoreTransferState]>;
  savingsOpenings?: Array<[string, CoreSavingsOpeningState]>;
  savingsMaturities?: Array<[string, CoreSavingsMaturityState]>;
  creditPayments?: Array<[string, CoreCreditPaymentState]>;
  ledger: InMemoryLedgerState;
};

export interface CoreBankingPort {
  createPaymentAccount(ownerId: string, now: string): PaymentAccount;
  findPaymentAccountByNumber(accountNumber: string): CoreAccountLookup;
  fundPaymentAccount(
    fundingId: string,
    recipientAccountNumber: string,
    amountMinor: bigint,
    reason: string,
    now: string,
  ): FundingReceipt;
  listPaymentAccounts(ownerId: string): PaymentAccount[];
  getPaymentAccount(ownerId: string, accountId: string): PaymentAccount;
  getPaymentAccountNumber(ownerId: string, accountId: string): string;
  listTransactions(ownerId: string, accountId: string): TransactionDetail[];
  getTransaction(ownerId: string, accountId: string, transactionId: string): TransactionDetail;
  getTransferTarget(ownerId: string, transferId: string): CoreTransferTarget;
  getTransferParties(transferId: string): CoreTransferParties;
  postTransfer(ownerId: string, input: CoreTransferInput): TransferReceipt;
  postSavingsOpening(
    ownerId: string,
    input: CoreSavingsOpeningInput,
  ): SavingsOpeningReceipt;
  settleSavingsOpening(
    ownerId: string,
    openingId: string,
    now: string,
  ): SavingsOpeningReceipt;
  transitionSavingsOpening(
    ownerId: string,
    openingId: string,
    status: Exclude<SavingsOpeningReceipt["status"], "PENDING">,
    now: string,
  ): SavingsOpeningReceipt;
  postSavingsMaturity(
    ownerId: string,
    input: CoreSavingsMaturityInput,
  ): SavingsMaturityReceipt;
  seedCreditPurchase(
    creditAccountId: string,
    amountMinor: bigint,
    now: string,
  ): void;
  postCreditPayment(ownerId: string, input: CoreCreditPaymentInput): CreditPaymentReceipt;
  getCreditPaymentTarget(
    ownerId: string,
    paymentId: string,
  ): { accountId: string; transactionId: string };
  settleCreditPayment(ownerId: string, paymentId: string, now: string): CreditPaymentReceipt;
  transitionCreditPayment(
    ownerId: string,
    paymentId: string,
    status: Exclude<CreditPaymentReceipt["status"], "PENDING">,
    now: string,
  ): CreditPaymentReceipt;
  getLedgerNetBalance(accountId: string): bigint;
  listLedgerAccountBalances(accountPrefix: string): LedgerAccountBalance[];
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
  private readonly transfers = new Map<string, CoreTransferState>();
  private readonly savingsOpenings = new Map<string, CoreSavingsOpeningState>();
  private readonly savingsMaturities = new Map<string, CoreSavingsMaturityState>();
  private readonly creditPayments = new Map<string, CoreCreditPaymentState>();

  constructor(options: { ledger?: LedgerPort } = {}) {
    this.ledger = options.ledger ?? new InMemoryLedger();
  }

  createPaymentAccount(ownerId: string, now: string): PaymentAccount {
    let sequence = this.accounts.size + 1;
    let accountNumber = `9704${String(sequence).padStart(8, "0")}`;
    while ([...this.accounts.values()].some((account) => account.accountNumber === accountNumber)) {
      sequence += 1;
      accountNumber = `9704${String(sequence).padStart(8, "0")}`;
    }
    const account: CoreAccount = {
      id: createId("account"),
      ownerId,
      displayName: "Tài khoản thanh toán",
      accountNumber,
      maskedNumber: `•••• ${accountNumber.slice(-4)}`,
      bankName: "Ngân hàng reference",
      openingBalanceMinor: 0n,
      heldMinor: 0n,
      availableMinor: 0n,
      currentMinor: 0n,
      status: "ACTIVE",
      updatedAt: now,
    };
    this.accounts.set(account.id, account);
    this.transactions.set(account.id, []);
    return this.toPaymentAccount(account);
  }

  findPaymentAccountByNumber(accountNumber: string): CoreAccountLookup {
    const normalized = accountNumber.trim().replace(/\s+/g, "");
    const account = [...this.accounts.values()].find(
      (candidate) => candidate.accountNumber === normalized,
    );
    if (!account) {
      throw notFound("Account not found.");
    }
    return {
      ownerId: account.ownerId,
      accountId: account.id,
      accountNumber: account.accountNumber,
      maskedNumber: account.maskedNumber,
      displayName: account.displayName,
      bankName: account.bankName,
      status: account.status,
    };
  }

  fundPaymentAccount(
    fundingId: string,
    recipientAccountNumber: string,
    amountMinor: bigint,
    reason: string,
    now: string,
  ): FundingReceipt {
    if (!fundingId.trim() || amountMinor <= 0n || !reason.trim()) {
      throw conflict("Sandbox funding input is invalid.");
    }
    const target = this.findPaymentAccountByNumber(recipientAccountNumber);
    if (target.status !== "ACTIVE") {
      throw conflict("The recipient account is not active.");
    }
    const account = this.accounts.get(target.accountId);
    if (!account) {
      throw notFound("Account not found.");
    }
    const reference = `FUND-${fundingId.slice(-12).toUpperCase()}`;
    this.ledger.append({
      journalId: `ledger-journal:${fundingId}`,
      occurredAt: now,
      entries: [
        {
          accountId: "sandbox-funding:VND",
          side: "DEBIT",
          amountMinor,
          currency: "VND",
        },
        {
          accountId: account.id,
          side: "CREDIT",
          amountMinor,
          currency: "VND",
        },
      ],
    });
    account.currentMinor += amountMinor;
    this.refreshAvailability(account);
    account.updatedAt = now;
    const transactionId = createId("transaction");
    this.transactions.get(account.id)?.push({
      id: transactionId,
      accountId: account.id,
      direction: "CREDIT",
      amount: toMoney(amountMinor),
      fee: toMoney(0n),
      status: "SUCCEEDED",
      kind: "SANDBOX_FUNDING",
      description: reason.trim(),
      counterpartyName: "Quỹ Sandbox",
      occurredAt: now,
      reference,
      createdAt: now,
      completedAt: now,
    });
    return {
      fundingId,
      reference,
      status: "SUCCEEDED",
      amount: toMoney(amountMinor),
      transactionId,
      recipientMaskedAccountNumber: account.maskedNumber,
      createdAt: now,
    };
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

  getPaymentAccountNumber(ownerId: string, accountId: string): string {
    return this.requireOwnedAccount(ownerId, accountId).accountNumber;
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

  getTransferTarget(ownerId: string, transferId: string): CoreTransferTarget {
    const transfer = this.transfers.get(transferId);
    if (!transfer || transfer.ownerId !== ownerId) {
      throw notFound("Transfer not found.");
    }

    return {
      accountId: transfer.accountId,
      transactionId: transfer.transactionId,
    };
  }

  getTransferParties(transferId: string): CoreTransferParties {
    const transfer = this.transfers.get(transferId);
    if (
      !transfer ||
      !transfer.destinationOwnerId ||
      !transfer.destinationAccountId
    ) {
      throw notFound("Transfer parties not found.");
    }
    return {
      sourceOwnerId: transfer.ownerId,
      sourceAccountId: transfer.accountId,
      sourceTransactionId: transfer.transactionId,
      destinationOwnerId: transfer.destinationOwnerId,
      destinationAccountId: transfer.destinationAccountId,
      destinationTransactionId: transfer.destinationTransactionId ?? null,
    };
  }

  postTransfer(ownerId: string, input: CoreTransferInput): TransferReceipt {
    const account = this.requireOwnedAccount(ownerId, input.accountId);
    const destination = this.accounts.get(input.destinationAccountId);
    if (!destination || destination.ownerId !== input.destinationOwnerId) {
      throw notFound("Recipient account not found.");
    }
    if (destination.id === account.id) {
      throw conflict("A transfer cannot be sent to the source account.");
    }

    if (account.status !== "ACTIVE" || destination.status !== "ACTIVE") {
      throw conflict("Both accounts must be active.");
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
    const status = input.settleImmediately === false ? "PENDING" : "SUCCEEDED";
    const transaction: TransactionDetail = {
      id: createId("transaction"),
      accountId: account.id,
      direction: "DEBIT",
      amount: toMoney(input.amountMinor),
      fee: toMoney(input.feeMinor),
      status,
      kind: "TRANSFER",
      description: input.description,
      counterpartyName: input.counterpartyName,
      occurredAt: input.now,
      reference,
      createdAt: input.now,
      completedAt: null,
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
      destinationOwnerId: input.destinationOwnerId,
      accountId: account.id,
      destinationAccountId: destination.id,
      transactionId: transaction.id,
      destinationTransactionId: null,
      ledgerJournalId: null,
      receipt,
      refunded: false,
      heldMinor: totalDebit.toString(),
    });
    const transfer = this.transfers.get(transferId)!;
    if (status === "PENDING") {
      account.heldMinor += totalDebit;
      this.refreshAvailability(account);
      account.updatedAt = input.now;
    } else {
      this.postTransferSuccess(transfer, input.now);
    }
    return receipt;
  }

  private postTransferSuccess(transfer: CoreTransferState, now: string): void {
    const destinationAccountId = transfer.destinationAccountId;
    const destinationOwnerId = transfer.destinationOwnerId;
    if (!destinationAccountId || !destinationOwnerId) {
      throw conflict("Legacy transfer is missing its recipient account.");
    }
    const source = this.accounts.get(transfer.accountId);
    const destination = this.accounts.get(destinationAccountId);
    if (!source || !destination || destination.ownerId !== destinationOwnerId) {
      throw notFound("Transfer account not found.");
    }
    const amountMinor = BigInt(transfer.receipt.amount.amountMinor);
    const feeMinor = BigInt(transfer.receipt.fee.amountMinor);
    const totalDebit = amountMinor + feeMinor;
    if (source.currentMinor < totalDebit) {
      throw conflict("Insufficient current balance to settle transfer.");
    }

    const journalId = transfer.ledgerJournalId ?? createId("ledger-journal");
    const ledgerEntries: LedgerEntryInput[] = [
      {
        accountId: source.id,
        side: "DEBIT",
        amountMinor: totalDebit,
        currency: "VND",
      },
      {
        accountId: destination.id,
        side: "CREDIT",
        amountMinor,
        currency: "VND",
      },
    ];
    if (feeMinor > 0n) {
      ledgerEntries.push({
        accountId: "fee-income:VND",
        side: "CREDIT",
        amountMinor: feeMinor,
        currency: "VND",
      });
    }
    this.ledger.append({ journalId, occurredAt: now, entries: ledgerEntries });

    const heldMinor = BigInt(transfer.heldMinor ?? "0");
    source.heldMinor = source.heldMinor >= heldMinor ? source.heldMinor - heldMinor : 0n;
    source.currentMinor -= totalDebit;
    destination.currentMinor += amountMinor;
    this.refreshAvailability(source);
    this.refreshAvailability(destination);
    source.updatedAt = now;
    destination.updatedAt = now;

    const sourceTransaction = this.transactions
      .get(source.id)
      ?.find((item) => item.id === transfer.transactionId);
    if (!sourceTransaction) {
      throw notFound("Transfer source transaction not found.");
    }
    sourceTransaction.status = "SUCCEEDED";
    sourceTransaction.completedAt = now;
    if (!transfer.destinationTransactionId) {
      const destinationTransaction: TransactionDetail = {
        id: createId("transaction"),
        accountId: destination.id,
        direction: "CREDIT",
        amount: toMoney(amountMinor),
        fee: toMoney(0n),
        status: "SUCCEEDED",
        kind: "TRANSFER",
        description: `Nhận tiền từ tài khoản nội bộ ${source.maskedNumber}`,
        counterpartyName: "Khách hàng nội bộ",
        occurredAt: now,
        reference: transfer.receipt.reference,
        createdAt: now,
        completedAt: now,
      };
      this.transactions.get(destination.id)?.push(destinationTransaction);
      transfer.destinationTransactionId = destinationTransaction.id;
    }
    transfer.ledgerJournalId = journalId;
    transfer.heldMinor = "0";
    transfer.receipt = { ...transfer.receipt, status: "SUCCEEDED", updatedAt: now };
  }

  postSavingsOpening(
    ownerId: string,
    input: CoreSavingsOpeningInput,
  ): SavingsOpeningReceipt {
    const account = this.requireOwnedAccount(ownerId, input.accountId);
    if (account.status !== "ACTIVE") {
      throw conflict("The source account is not active.");
    }
    if (input.amountMinor <= 0n || account.availableMinor < input.amountMinor) {
      throw conflict("Insufficient available balance for savings opening.");
    }

    const status = input.settleImmediately === false ? "PENDING" : "SUCCEEDED";
    const transactionId = createId("transaction");
    const reference = `SAV-${input.openingId.slice(-12).toUpperCase()}`;
    let ledgerJournalId: string | null = null;
    if (status === "SUCCEEDED") {
      ledgerJournalId = createId("ledger-journal");
      this.ledger.append({
        journalId: ledgerJournalId,
        occurredAt: input.now,
        entries: [
          {
            accountId: account.id,
            side: "DEBIT",
            amountMinor: input.amountMinor,
            currency: "VND",
          },
          {
            accountId: `savings-liability:${input.depositId}`,
            side: "CREDIT",
            amountMinor: input.amountMinor,
            currency: "VND",
          },
        ],
      });
      account.currentMinor -= input.amountMinor;
    } else {
      account.heldMinor += input.amountMinor;
    }
    this.refreshAvailability(account);
    account.updatedAt = input.now;
    const transaction: TransactionDetail = {
      id: transactionId,
      accountId: account.id,
      direction: "DEBIT",
      amount: toMoney(input.amountMinor),
      fee: toMoney(0n),
      status,
      kind: "SAVINGS",
      description: input.description,
      counterpartyName: null,
      occurredAt: input.now,
      reference,
      createdAt: input.now,
      completedAt: status === "SUCCEEDED" ? input.now : null,
    };
    this.transactions.get(account.id)?.push(transaction);

    const receipt: SavingsOpeningReceipt = {
      openingId: input.openingId,
      depositId: input.depositId,
      transactionId,
      reference,
      status,
      amount: toMoney(input.amountMinor),
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.savingsOpenings.set(input.openingId, {
      ownerId,
      accountId: account.id,
      depositId: input.depositId,
      transactionId,
      ledgerJournalId,
      receipt,
      refunded: false,
      heldMinor: status === "PENDING" ? input.amountMinor.toString() : "0",
    });
    return { ...receipt, amount: { ...receipt.amount } };
  }

  settleSavingsOpening(
    ownerId: string,
    openingId: string,
    now: string,
  ): SavingsOpeningReceipt {
    return this.transitionSavingsOpening(ownerId, openingId, "SUCCEEDED", now);
  }

  transitionSavingsOpening(
    ownerId: string,
    openingId: string,
    status: Exclude<SavingsOpeningReceipt["status"], "PENDING">,
    now: string,
  ): SavingsOpeningReceipt {
    const opening = this.savingsOpenings.get(openingId);
    if (!opening || opening.ownerId !== ownerId) {
      throw notFound("Savings opening not found.");
    }
    if (opening.receipt.status === status) {
      return { ...opening.receipt, amount: { ...opening.receipt.amount } };
    }
    if (opening.receipt.status !== "PENDING") {
      throw conflict("A terminal savings opening cannot change state.");
    }

    const transaction = this.transactions
      .get(opening.accountId)
      ?.find((item) => item.id === opening.transactionId);
    if (!transaction) {
      throw notFound("Savings opening transaction not found.");
    }

    if (status === "SUCCEEDED" && !opening.ledgerJournalId) {
      const account = this.accounts.get(opening.accountId);
      if (!account) {
        throw notFound("Savings opening account not found.");
      }
      const amountMinor = BigInt(opening.receipt.amount.amountMinor);
      const ledgerJournalId = createId("ledger-journal");
      this.ledger.append({
        journalId: ledgerJournalId,
        occurredAt: now,
        entries: [
          {
            accountId: opening.accountId,
            side: "DEBIT",
            amountMinor,
            currency: "VND",
          },
          {
            accountId: `savings-liability:${opening.depositId}`,
            side: "CREDIT",
            amountMinor,
            currency: "VND",
          },
        ],
      });
      const heldMinor = BigInt(opening.heldMinor ?? amountMinor.toString());
      account.heldMinor = account.heldMinor >= heldMinor ? account.heldMinor - heldMinor : 0n;
      account.currentMinor -= amountMinor;
      this.refreshAvailability(account);
      account.updatedAt = now;
      opening.ledgerJournalId = ledgerJournalId;
      opening.heldMinor = "0";
    }

    if ((status === "FAILED" || status === "REVERSED") && !opening.refunded) {
      const account = this.accounts.get(opening.accountId);
      if (!account) {
        throw notFound("Savings opening account not found.");
      }
      const amountMinor = BigInt(opening.receipt.amount.amountMinor);
      const heldMinor = BigInt(opening.heldMinor ?? amountMinor.toString());
      if (opening.ledgerJournalId) {
        this.ledger.append({
          journalId: createId("ledger-journal"),
          occurredAt: now,
          entries: [
            {
              accountId: opening.accountId,
              side: "CREDIT",
              amountMinor,
              currency: "VND",
            },
            {
              accountId: `savings-liability:${opening.depositId}`,
              side: "DEBIT",
              amountMinor,
              currency: "VND",
            },
          ],
        });
        account.currentMinor += amountMinor;
      } else {
        account.heldMinor = account.heldMinor >= heldMinor ? account.heldMinor - heldMinor : 0n;
      }
      this.refreshAvailability(account);
      account.updatedAt = now;
      opening.heldMinor = "0";
      opening.refunded = true;
    }

    transaction.status = status;
    transaction.completedAt = now;
    opening.receipt = {
      ...opening.receipt,
      status,
      updatedAt: now,
      amount: { ...opening.receipt.amount },
    };
    return { ...opening.receipt, amount: { ...opening.receipt.amount } };
  }

  postSavingsMaturity(
    ownerId: string,
    input: CoreSavingsMaturityInput,
  ): SavingsMaturityReceipt {
    const newDepositId = input.newDepositId?.trim() || undefined;
    if (
      !input.idempotencyKey.trim() ||
      input.principalMinor <= 0n ||
      input.interestMinor < 0n ||
      input.creditToPaymentMinor < 0n ||
      input.newSavingsPrincipalMinor < 0n ||
      (input.newSavingsPrincipalMinor > 0n) !== Boolean(newDepositId) ||
      newDepositId === input.depositId ||
      input.creditToPaymentMinor + input.newSavingsPrincipalMinor !==
        input.principalMinor + input.interestMinor
    ) {
      throw invalidMaturityInput();
    }
    const requestFingerprint = JSON.stringify({
      depositId: input.depositId,
      newDepositId: newDepositId ?? null,
      accountId: input.accountId,
      principalMinor: input.principalMinor.toString(),
      interestMinor: input.interestMinor.toString(),
      creditToPaymentMinor: input.creditToPaymentMinor.toString(),
      newSavingsPrincipalMinor: (input.newSavingsPrincipalMinor ?? 0n).toString(),
    });
    const existing = this.savingsMaturities.get(input.idempotencyKey);
    if (existing) {
      if (
        existing.ownerId !== ownerId ||
        existing.requestFingerprint !== requestFingerprint
      ) {
        throw conflict("Savings maturity idempotency key was reused with different input.");
      }
      return {
        ...existing.receipt,
        creditedAmount: { ...existing.receipt.creditedAmount },
      };
    }

    const account = this.requireOwnedAccount(ownerId, input.accountId);
    if (account.status !== "ACTIVE") {
      throw conflict("The payment account is not active.");
    }
    const savingsLiabilityAccountId = `savings-liability:${input.depositId}`;
    if (this.ledger.getNetBalance(savingsLiabilityAccountId) !== input.principalMinor) {
      throw conflict("Savings principal does not match the posted liability.");
    }

    const entries: LedgerEntryInput[] = [
      {
        accountId: savingsLiabilityAccountId,
        side: "DEBIT",
        amountMinor: input.principalMinor,
        currency: "VND",
      },
    ];
    if (input.interestMinor > 0n) {
      entries.push({
        accountId: "interest-expense:VND",
        side: "DEBIT",
        amountMinor: input.interestMinor,
        currency: "VND",
      });
    }
    if (newDepositId && input.newSavingsPrincipalMinor > 0n) {
      entries.push({
        accountId: `savings-liability:${newDepositId}`,
        side: "CREDIT",
        amountMinor: input.newSavingsPrincipalMinor,
        currency: "VND",
      });
    }
    if (input.creditToPaymentMinor > 0n) {
      entries.push({
        accountId: account.id,
        side: "CREDIT",
        amountMinor: input.creditToPaymentMinor,
        currency: "VND",
      });
    }
    this.ledger.append({
      journalId: `savings-maturity:${input.idempotencyKey}`,
      occurredAt: input.now,
      entries,
    });

    account.availableMinor += input.creditToPaymentMinor;
    account.currentMinor += input.creditToPaymentMinor;
    account.updatedAt = input.now;

    let transactionId: string | null = null;
    if (input.creditToPaymentMinor > 0n) {
      transactionId = createId("transaction");
      this.transactions.get(account.id)?.push({
        id: transactionId,
        accountId: account.id,
        direction: "CREDIT",
        amount: toMoney(input.creditToPaymentMinor),
        fee: toMoney(0n),
        status: "SUCCEEDED",
        kind: "MATURITY",
        description: input.description,
        counterpartyName: null,
        occurredAt: input.now,
        reference: `MAT-${input.depositId.slice(-12).toUpperCase()}`,
        createdAt: input.now,
        completedAt: input.now,
      });
    }

    const receipt: SavingsMaturityReceipt = {
      depositId: input.depositId,
      newDepositId: newDepositId ?? null,
      transactionId,
      reference: `MAT-${input.depositId.slice(-12).toUpperCase()}`,
      creditedAmount: toMoney(input.creditToPaymentMinor),
      occurredAt: input.now,
    };
    this.savingsMaturities.set(input.idempotencyKey, {
      ownerId,
      requestFingerprint,
      receipt,
    });
    return { ...receipt, creditedAmount: { ...receipt.creditedAmount } };
  }

  seedCreditPurchase(creditAccountId: string, amountMinor: bigint, now: string): void {
    if (!creditAccountId.trim() || amountMinor <= 0n) {
      throw conflict("Credit seed purchase is invalid.");
    }
    this.ledger.append({
      journalId: createId("ledger-journal"),
      occurredAt: now,
      entries: [
        {
          accountId: `credit-receivable:${creditAccountId}`,
          side: "DEBIT",
          amountMinor,
          currency: "VND",
        },
        {
          accountId: "merchant-settlement:VND",
          side: "CREDIT",
          amountMinor,
          currency: "VND",
        },
      ],
    });
  }

  postCreditPayment(ownerId: string, input: CoreCreditPaymentInput): CreditPaymentReceipt {
    const account = this.requireOwnedAccount(ownerId, input.accountId);
    if (account.status !== "ACTIVE") {
      throw conflict("The source account is not active.");
    }
    if (input.amountMinor <= 0n || account.availableMinor < input.amountMinor) {
      throw conflict("Insufficient available balance.");
    }
    if (this.creditPayments.has(input.paymentId)) {
      return { ...this.creditPayments.get(input.paymentId)!.receipt };
    }

    const transactionId = createId("transaction");
    const reference = `CRD-${input.paymentId.slice(-12).toUpperCase()}`;
    this.ledger.append({
      journalId: createId("ledger-journal"),
      occurredAt: input.now,
      entries: [
        {
          accountId: account.id,
          side: "DEBIT",
          amountMinor: input.amountMinor,
          currency: "VND",
        },
        {
          accountId: `credit-payment-clearing:${input.paymentId}`,
          side: "CREDIT",
          amountMinor: input.amountMinor,
          currency: "VND",
        },
      ],
    });
    account.availableMinor -= input.amountMinor;
    account.currentMinor -= input.amountMinor;
    account.updatedAt = input.now;
    const status = input.settleImmediately === false ? "PENDING" : "SUCCEEDED";
    const transaction: TransactionDetail = {
      id: transactionId,
      accountId: account.id,
      direction: "DEBIT",
      amount: toMoney(input.amountMinor),
      fee: toMoney(0n),
      status,
      kind: "CREDIT_PAYMENT",
      description: input.description,
      counterpartyName: "Tài khoản tín dụng sandbox",
      occurredAt: input.now,
      reference,
      createdAt: input.now,
      completedAt: status === "SUCCEEDED" ? input.now : null,
    };
    this.transactions.get(account.id)?.push(transaction);
    if (status === "SUCCEEDED") {
      this.ledger.append({
        journalId: createId("ledger-journal"),
        occurredAt: input.now,
        entries: [
          {
            accountId: `credit-payment-clearing:${input.paymentId}`,
            side: "DEBIT",
            amountMinor: input.amountMinor,
            currency: "VND",
          },
          {
            accountId: `credit-receivable:${input.creditAccountId}`,
            side: "CREDIT",
            amountMinor: input.amountMinor,
            currency: "VND",
          },
        ],
      });
    }
    const receipt: CreditPaymentReceipt = {
      paymentId: input.paymentId,
      transactionId,
      reference,
      status,
      amount: toMoney(input.amountMinor),
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.creditPayments.set(input.paymentId, {
      ownerId,
      accountId: account.id,
      creditAccountId: input.creditAccountId,
      transactionId,
      receipt,
      refunded: false,
      clearingApplied: status === "SUCCEEDED",
    });
    return { ...receipt, amount: { ...receipt.amount } };
  }

  getCreditPaymentTarget(
    ownerId: string,
    paymentId: string,
  ): { accountId: string; transactionId: string } {
    const payment = this.creditPayments.get(paymentId);
    if (!payment || payment.ownerId !== ownerId) {
      throw notFound("Credit payment not found.");
    }
    return { accountId: payment.accountId, transactionId: payment.transactionId };
  }

  settleCreditPayment(ownerId: string, paymentId: string, now: string): CreditPaymentReceipt {
    return this.transitionCreditPayment(ownerId, paymentId, "SUCCEEDED", now);
  }

  transitionCreditPayment(
    ownerId: string,
    paymentId: string,
    status: Exclude<CreditPaymentReceipt["status"], "PENDING">,
    now: string,
  ): CreditPaymentReceipt {
    const payment = this.creditPayments.get(paymentId);
    if (!payment || payment.ownerId !== ownerId) {
      throw notFound("Credit payment not found.");
    }
    if (payment.receipt.status === status) {
      return { ...payment.receipt, amount: { ...payment.receipt.amount } };
    }
    const canReverseSucceeded = payment.receipt.status === "SUCCEEDED" && status === "REVERSED";
    if (payment.receipt.status !== "PENDING" && !canReverseSucceeded) {
      throw conflict("A terminal credit payment cannot change state.");
    }

    const transaction = this.transactions
      .get(payment.accountId)
      ?.find((item) => item.id === payment.transactionId);
    if (!transaction) {
      throw notFound("Credit payment transaction not found.");
    }

    if (status === "SUCCEEDED" && !payment.clearingApplied) {
      const amountMinor = BigInt(payment.receipt.amount.amountMinor);
      this.ledger.append({
        journalId: createId("ledger-journal"),
        occurredAt: now,
        entries: [
          {
            accountId: `credit-payment-clearing:${paymentId}`,
            side: "DEBIT",
            amountMinor,
            currency: "VND",
          },
          {
            accountId: `credit-receivable:${payment.creditAccountId}`,
            side: "CREDIT",
            amountMinor,
            currency: "VND",
          },
        ],
      });
      payment.clearingApplied = true;
    }

    if ((status === "FAILED" || status === "REVERSED") && !payment.refunded) {
      const account = this.accounts.get(payment.accountId);
      if (!account) {
        throw notFound("Credit payment source account not found.");
      }
      const amountMinor = BigInt(payment.receipt.amount.amountMinor);
      if (payment.clearingApplied) {
        this.ledger.append({
          journalId: createId("ledger-journal"),
          occurredAt: now,
          entries: [
            {
              accountId: `credit-receivable:${payment.creditAccountId}`,
              side: "DEBIT",
              amountMinor,
              currency: "VND",
            },
            {
              accountId: `credit-payment-clearing:${paymentId}`,
              side: "CREDIT",
              amountMinor,
              currency: "VND",
            },
          ],
        });
        payment.clearingApplied = false;
      }
      this.ledger.append({
        journalId: createId("ledger-journal"),
        occurredAt: now,
        entries: [
          {
            accountId: `credit-payment-clearing:${paymentId}`,
            side: "DEBIT",
            amountMinor,
            currency: "VND",
          },
          {
            accountId: payment.accountId,
            side: "CREDIT",
            amountMinor,
            currency: "VND",
          },
        ],
      });
      account.availableMinor += amountMinor;
      account.currentMinor += amountMinor;
      account.updatedAt = now;
      payment.refunded = true;
    }

    transaction.status = status;
    transaction.completedAt = now;
    payment.receipt = { ...payment.receipt, status, updatedAt: now };
    return { ...payment.receipt, amount: { ...payment.receipt.amount } };
  }

  getLedgerNetBalance(accountId: string): bigint {
    return this.ledger.getNetBalance(accountId);
  }

  listLedgerAccountBalances(accountPrefix: string): LedgerAccountBalance[] {
    const normalizedPrefix = accountPrefix.trim();
    if (!normalizedPrefix) {
      throw new TypeError("Ledger account prefix is required.");
    }
    const accountIds = new Set(
      this.ledger
        .listEntries()
        .map((entry) => entry.accountId)
        .filter((accountId) => accountId.startsWith(normalizedPrefix)),
    );
    return [...accountIds]
      .sort((left, right) => left.localeCompare(right))
      .map((accountId) => ({
        accountId,
        netBalanceMinor: this.ledger.getNetBalance(accountId).toString(),
      }));
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
    if (transfer.receipt.status === "PENDING" && status === "SUCCEEDED") {
      this.postTransferSuccess(transfer, now);
      return { ...transfer.receipt };
    }
    if (transfer.receipt.status === "PENDING" && status === "FAILED") {
      const account = this.accounts.get(transfer.accountId);
      const transaction = this.transactions
        .get(transfer.accountId)
        ?.find((item) => item.id === transfer.transactionId);
      if (!account || !transaction) {
        throw notFound("Transfer source state not found.");
      }
      const heldMinor = BigInt(transfer.heldMinor ?? "0");
      account.heldMinor = account.heldMinor >= heldMinor ? account.heldMinor - heldMinor : 0n;
      this.refreshAvailability(account);
      account.updatedAt = now;
      transaction.status = "FAILED";
      transaction.completedAt = now;
      transfer.refunded = true;
      transfer.heldMinor = "0";
      transfer.receipt = { ...transfer.receipt, status, updatedAt: now };
      return { ...transfer.receipt };
    }
    if (transfer.receipt.status === "SUCCEEDED" && status === "REVERSED") {
      this.reverseTransferSuccess(transfer, now);
      return { ...transfer.receipt };
    }
    throw conflict("The requested transfer state transition is invalid.");
  }

  private reverseTransferSuccess(transfer: CoreTransferState, now: string): void {
    const destinationAccountId = transfer.destinationAccountId;
    const destinationOwnerId = transfer.destinationOwnerId;
    if (!destinationAccountId || !destinationOwnerId) {
      throw conflict("Legacy transfer is missing its recipient account.");
    }
    const source = this.accounts.get(transfer.accountId);
    const destination = this.accounts.get(destinationAccountId);
    if (!source || !destination || destination.ownerId !== destinationOwnerId) {
      throw notFound("Transfer account not found.");
    }
    const amountMinor = BigInt(transfer.receipt.amount.amountMinor);
    const feeMinor = BigInt(transfer.receipt.fee.amountMinor);
    const totalDebit = amountMinor + feeMinor;
    // A reversal may only consume funds that are not already reserved by an
    // outgoing operation. Checking current balance alone can make
    // `currentMinor < heldMinor` after the debit and leave the in-memory state
    // partially mutated when availability is refreshed.
    if (destination.availableMinor < amountMinor) {
      throw conflictWithCode(
        "REVERSAL_REQUIRES_REVIEW",
        "Không thể hoàn tác tự động vì số dư khả dụng của người nhận không còn đủ.",
      );
    }
    const reversalEntries: LedgerEntryInput[] = [
      {
        accountId: destination.id,
        side: "DEBIT",
        amountMinor,
        currency: "VND",
      },
      {
        accountId: source.id,
        side: "CREDIT",
        amountMinor: totalDebit,
        currency: "VND",
      },
    ];
    if (feeMinor > 0n) {
      reversalEntries.splice(1, 0, {
        accountId: "fee-income:VND",
        side: "DEBIT",
        amountMinor: feeMinor,
        currency: "VND",
      });
    }
    this.ledger.append({
      journalId: createId("ledger-journal"),
      occurredAt: now,
      entries: reversalEntries,
    });
    source.currentMinor += totalDebit;
    destination.currentMinor -= amountMinor;
    this.refreshAvailability(source);
    this.refreshAvailability(destination);
    source.updatedAt = now;
    destination.updatedAt = now;
    const sourceTransaction = this.transactions
      .get(source.id)
      ?.find((item) => item.id === transfer.transactionId);
    if (sourceTransaction) {
      sourceTransaction.status = "REVERSED";
      sourceTransaction.completedAt = now;
    }
    if (transfer.destinationTransactionId) {
      const destinationTransaction = this.transactions
        .get(destination.id)
        ?.find((item) => item.id === transfer.destinationTransactionId);
      if (destinationTransaction) {
        destinationTransaction.status = "REVERSED";
        destinationTransaction.completedAt = now;
      }
    }
    transfer.refunded = true;
    transfer.receipt = { ...transfer.receipt, status: "REVERSED", updatedAt: now };
  }

  reconcile(): ReconciliationRow[] {
    return [...this.accounts.values()].map((account) => {
      const transactions = this.transactions.get(account.id) ?? [];
      const transactionComputedAvailableMinor = transactions.reduce(
        (balance, transaction) => {
          if (transaction.status === "FAILED" || transaction.status === "REVERSED") {
            return balance;
          }
          if (
            transaction.status === "PENDING" &&
            (transaction.kind === "TRANSFER" || transaction.kind === "SAVINGS")
          ) {
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
      const ledgerComputedCurrentMinor = this.ledger.getNetBalance(account.id);
      const ledgerComputedAvailableMinor = ledgerComputedCurrentMinor - account.heldMinor;
      return {
        accountId: account.id,
        coreAvailableMinor: account.availableMinor.toString(),
        computedAvailableMinor: ledgerComputedAvailableMinor.toString(),
        transactionComputedAvailableMinor:
          (transactionComputedAvailableMinor - account.heldMinor).toString(),
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
          heldMinor: account.heldMinor.toString(),
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
      savingsOpenings: [...this.savingsOpenings.entries()].map(([openingId, opening]) => [
        openingId,
        {
          ...opening,
          receipt: {
            ...opening.receipt,
            amount: { ...opening.receipt.amount },
          },
        },
      ]),
      savingsMaturities: [...this.savingsMaturities.entries()].map(([key, maturity]) => [
        key,
        {
          ...maturity,
          receipt: {
            ...maturity.receipt,
            creditedAmount: { ...maturity.receipt.creditedAmount },
          },
        },
      ]),
      creditPayments: [...this.creditPayments.entries()].map(([paymentId, payment]) => [
        paymentId,
        {
          ...payment,
          receipt: { ...payment.receipt, amount: { ...payment.receipt.amount } },
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
      const legacyLastFour = account.maskedNumber.replace(/\D/g, "").slice(-4).padStart(4, "0");
      const legacyPrefix = accountId.replace(/\D/g, "").slice(-4).padStart(4, "0");
      this.accounts.set(accountId, {
        ...account,
        accountNumber: account.accountNumber ?? `9704${legacyPrefix}${legacyLastFour}`,
        bankName: account.bankName ?? "Ngân hàng reference",
        openingBalanceMinor: BigInt(account.openingBalanceMinor),
        heldMinor: BigInt(account.heldMinor ?? "0"),
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
    this.savingsOpenings.clear();
    for (const [openingId, opening] of state.savingsOpenings ?? []) {
      this.savingsOpenings.set(openingId, {
        ...opening,
        receipt: {
          ...opening.receipt,
          amount: { ...opening.receipt.amount },
        },
      });
    }
    this.savingsMaturities.clear();
    for (const [key, maturity] of state.savingsMaturities ?? []) {
      this.savingsMaturities.set(key, {
        ...maturity,
        receipt: {
          ...maturity.receipt,
          creditedAmount: { ...maturity.receipt.creditedAmount },
        },
      });
    }
    this.creditPayments.clear();
    for (const [paymentId, payment] of state.creditPayments ?? []) {
      this.creditPayments.set(paymentId, {
        ...payment,
        receipt: { ...payment.receipt, amount: { ...payment.receipt.amount } },
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

  private refreshAvailability(account: CoreAccount): void {
    account.availableMinor = account.currentMinor - account.heldMinor;
    if (account.availableMinor < 0n) {
      throw conflict("Account available balance cannot be negative.");
    }
  }

  private toPaymentAccount(account: CoreAccount): PaymentAccount {
    const result: PaymentAccount = {
      id: account.id,
      displayName: account.displayName,
      maskedNumber: account.maskedNumber,
      bankName: account.bankName,
      currency: "VND",
      heldAmount: toMoney(account.heldMinor),
      availableBalance: toMoney(account.availableMinor),
      currentBalance: toMoney(account.currentMinor),
      status: account.status,
      updatedAt: account.updatedAt,
    };
    return result;
  }
}

function invalidMaturityInput(): never {
  throw conflict("Savings maturity amounts must be valid minor units.");
}

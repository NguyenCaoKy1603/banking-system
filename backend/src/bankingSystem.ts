import {
  conflict,
  conflictWithCode,
  invalidRequest,
  notFound,
  rateLimited,
  unauthorized,
} from "./errors.js";
import {
  InMemoryCoreBanking,
  type CoreBankingPort,
  type CreditPaymentReceipt,
  type CoreSavingsMaturityInput,
  type InMemoryCoreState,
  type TerminalTransferStatus,
} from "./coreBanking.js";
import {
  CREDIT_MINIMUM_PAYMENT_FLOOR_MINOR,
  CREDIT_POLICY_VERSION,
  CREDIT_QUOTE_TTL_MS,
  CREDIT_STATEMENT_DUE_DAYS,
  DEFAULT_CARD_LAST_FOUR,
  DEFAULT_CREDIT_LIMIT_MINOR,
  DEFAULT_POSTED_OUTSTANDING_MINOR,
  addDays as addCreditDays,
  addMonthsClamped as addCreditMonthsClamped,
  calculateAvailableCredit,
  calculateMinimumPayment,
  cloneCreditAccount,
  cloneCreditCard,
  cloneCreditPayment,
  cloneCreditQuote,
  cloneCreditStatement,
  cloneCreditTransaction,
  cloneMoney,
  getStatementStatus,
  money as creditMoney,
  newCreditId,
  nextStatementCloseAt as nextCreditStatementCloseAt,
  type CardInstrument,
  type CreditAccount,
  type CreditAccountRecord,
  type CreditCard,
  type CreditCardRecord,
  type CreditDebtEffect,
  type CreditIdempotencyRecord,
  type CreditPayment,
  type CreditPaymentOption,
  type CreditPaymentQuote,
  type CreditPaymentQuoteRecord,
  type CreditPaymentRecord,
  type CreditPaymentRequest,
  type CreditPaymentQuoteRequest,
  type CreditStatement,
  type CreditStatementRecord,
  type CreditStatementStatus,
  type CreditTransaction,
  type CreditTransactionRecord,
  type CreditTransactionStatus,
  type CreditTransactionType,
  type CreditCardStatus,
} from "./credit.js";
import { parseMoney, toMoney } from "./money.js";
import {
  DEFAULT_SAVINGS_PRODUCTS,
  addMonthsClamped,
  buildSavingsQuote,
  calculateActualDays,
  calculateSavingsInterest,
  cloneSavingsDeposit,
  cloneSavingsOpening,
  cloneSavingsQuote,
  toPublicSavingsDeposit,
  toPublicSavingsOpening,
  toPublicSavingsQuote,
  type MaturityInstruction,
  type SavingsDeposit,
  type SavingsDepositRecord,
  type SavingsOpening,
  type SavingsOpeningRecord,
  type SavingsProduct,
  type SavingsQuote,
  type SavingsQuoteRecord,
  type SavingsTermMonths,
} from "./savings.js";
import {
  createId,
  createSandboxOtp,
  createOpaqueToken,
  fingerprint,
  hashOpaqueToken,
  hashPassword,
  hashPasswordAsync,
  verifyPassword,
  verifyPasswordAsync,
} from "./security.js";
import type {
  AuthUser,
  AuthChallengeResponse,
  Beneficiary,
  ControlPolicy,
  FundingReceipt,
  FraudReportResponse,
  InternalRecipientLookup,
  LoginResponse,
  LoginResult,
  Money,
  Notification,
  OtpPurpose,
  PaymentAccount,
  Transaction,
  TransactionDetail,
  TransferQuote,
  TransferReceipt,
} from "./types.js";

type Clock = () => number;

type UserRecord = AuthUser & {
  passwordSalt: string;
  passwordDigest: string;
};

type AccessSession = {
  userId: string;
  familyId: string;
  deviceId: string;
  expiresAt: number;
};

type RefreshSession = {
  userId: string;
  familyId: string;
  deviceId: string;
  expiresAt: number;
  revoked: boolean;
};

type QuoteRecord = {
  userId: string;
  quote: TransferQuote;
  destinationAccountId: string;
  destinationOwnerId: string;
  consumedTransferId?: string;
};

type BeneficiaryRecord = Beneficiary & {
  accountNumberFingerprint: string;
  destinationAccountId: string;
  destinationOwnerId: string;
};

type RecipientLookupRecord = InternalRecipientLookup & {
  userId: string;
  destinationAccountId: string;
  destinationOwnerId: string;
};

type FundingIdempotencyRecord = {
  fingerprint: string;
  receipt: FundingReceipt;
};

type IdempotencyRecord = {
  userId: string;
  fingerprint: string;
  receipt: TransferReceipt;
};

type SavingsIdempotencyRecord = {
  userId: string;
  fingerprint: string;
  openingId: string;
};

type CreditStepUpAttemptWindow = { startedAt: number; attempts: number };

type CreditPurchaseSeed = {
  userId: string;
  creditAccountId: string;
  transactionId: string;
};

export type AuditEvent = {
  id: string;
  eventType: string;
  actorUserId: string | null;
  resourceId: string | null;
  occurredAt: string;
};

export type OutboxEvent = {
  id: string;
  eventType: string;
  aggregateId: string;
  occurredAt: string;
  published: boolean;
  attempts: number;
  nextAttemptAt: string | null;
};

export type ListTransactionsResult = {
  items: Transaction[];
  nextCursor: string | null;
};

export type ServiceHealth = {
  status: "ok" | "degraded";
  checkedAt: string;
  reconciliation: "ok" | "mismatch";
  outbox: "ok" | "degraded";
  pendingOutboxEvents: number;
};

export type QuoteRequest = {
  sourceAccountId: string;
  beneficiaryId?: string;
  lookupId?: string;
  amount: Money;
};

export type BeneficiaryInput = {
  displayName: string;
  accountNumber: string;
  bankName?: string;
};

export type SandboxFundingRequest = {
  recipientAccountNumber: string;
  amount: Money;
  reason: string;
};

export type SubmitTransferRequest = {
  quoteId: string;
  stepUp: {
    method: "OTP" | "BIOMETRIC";
    proof: string;
    challengeId?: string;
  };
};

export type SavingsQuoteRequest = {
  sourceAccountId: string;
  productId: string;
  principal: Money;
  maturityInstruction: MaturityInstruction;
};

export type SubmitSavingsOpeningRequest = {
  quoteId: string;
  stepUp: {
    method: "OTP" | "BIOMETRIC";
    proof: string;
    challengeId?: string;
  };
};

export type SavingsListResult = {
  items: SavingsDeposit[];
  totalPrincipal: Money;
};

export type CreditTransactionsResult = {
  items: CreditTransaction[];
  nextCursor: string | null;
};

export type CreditStatementsResult = {
  items: CreditStatement[];
  nextCursor: string | null;
};

type StepUpMethod = "OTP" | "BIOMETRIC";

function normalizeStepUpMethods(
  methods: readonly StepUpMethod[] | undefined,
  fallback: readonly StepUpMethod[],
): StepUpMethod[] {
  const configuredMethods = methods ?? fallback;
  const normalizedMethods = Array.from(
    new Set(
      configuredMethods.filter(
        (method): method is StepUpMethod =>
          method === "OTP" || method === "BIOMETRIC",
      ),
    ),
  );

  if (normalizedMethods.length === 0) {
    throw new Error("At least one step-up method must be configured.");
  }

  return normalizedMethods;
}

function normalizeTransferLimit(
  value: string | undefined,
  fallback: bigint,
): string {
  const configuredValue = value?.trim();
  if (!configuredValue) {
    return fallback.toString();
  }

  if (!/^[1-9][0-9]*$/.test(configuredValue)) {
    throw new Error(
      "Transfer limit must be a positive integer minor-unit amount.",
    );
  }

  return BigInt(configuredValue).toString();
}

type AuthChallengeRecord = {
  userId: string;
  deviceId: string;
  expiresAt: number;
  methods: StepUpMethod[];
  attempts: number;
  purpose: OtpPurpose;
  resourceId: string | null;
  requestFingerprint: string | null;
  otpHash: string | null;
};

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const QUOTE_TTL_MS = 5 * 60 * 1000;
const RECIPIENT_LOOKUP_TTL_MS = 5 * 60 * 1000;
const AUTH_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const AUTH_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const AUTH_RATE_LIMIT_MAX_ATTEMPTS = 5;
const REGISTRATION_RATE_LIMIT_MAX_ATTEMPTS = 5;
const TRANSFER_STEP_UP_RATE_LIMIT_MAX_ATTEMPTS = 5;
const DEFAULT_OUTBOX_PENDING_THRESHOLD = 100;
const DEFAULT_TRANSFER_LIMIT_MINOR = 5_000_000n;
const DEFAULT_SANDBOX_FUNDING_LIMIT_MINOR = 100_000_000n;
const DEFAULT_SANDBOX_DEVICE_ID = "sandbox-device";

function nowIso(clock: Clock): string {
  return new Date(clock()).toISOString();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw invalidRequest(`${fieldName} is required.`, {
      [fieldName]: `${fieldName} is required.`,
    });
  }
  return value.trim();
}

function requireBoundedString(
  value: unknown,
  fieldName: string,
  maxLength: number,
): string {
  const normalized = requireString(value, fieldName);
  if (normalized.length > maxLength) {
    throw invalidRequest(`${fieldName} is too long.`, {
      [fieldName]: `${fieldName} must be at most ${maxLength} characters.`,
    });
  }
  return normalized;
}

function normalizeAccountNumber(value: unknown): string {
  const accountNumber = requireString(value, "accountNumber").replace(/\s+/g, "");
  if (!/^\d{6,34}$/.test(accountNumber)) {
    throw invalidRequest("accountNumber is invalid.", {
      accountNumber: "accountNumber must contain 6 to 34 digits.",
    });
  }
  return accountNumber;
}

function maskAccountNumber(accountNumber: string): string {
  return `•••• ${accountNumber.slice(-4)}`;
}

function normalizeBankName(bankName: string): string {
  return bankName.trim().toLocaleLowerCase();
}

function toPublicBeneficiary(beneficiary: BeneficiaryRecord): Beneficiary {
  const {
    accountNumberFingerprint: _accountNumberFingerprint,
    destinationAccountId: _destinationAccountId,
    destinationOwnerId: _destinationOwnerId,
    ...publicBeneficiary
  } = beneficiary;
  return { ...publicBeneficiary };
}

function cloneQuote(quote: TransferQuote): TransferQuote {
  return {
    ...quote,
    beneficiary: { ...quote.beneficiary },
    amount: { ...quote.amount },
    fee: { ...quote.fee },
    totalDebit: { ...quote.totalDebit },
  };
}

function cloneReceipt(receipt: TransferReceipt): TransferReceipt {
  return {
    ...receipt,
    amount: { ...receipt.amount },
    fee: { ...receipt.fee },
  };
}

function cloneSavingsProduct(product: SavingsProduct): SavingsProduct {
  return { ...product };
}

function cloneSavingsListResult(result: SavingsListResult): SavingsListResult {
  return {
    totalPrincipal: { ...result.totalPrincipal },
    items: result.items.map((item) => ({
      ...item,
      principal: { ...item.principal },
      expectedInterest: { ...item.expectedInterest },
      totalAtMaturity: { ...item.totalAtMaturity },
    })),
  };
}

function parseCreditPaymentOption(value: unknown): CreditPaymentOption {
  if (value === "MINIMUM" || value === "FULL_STATEMENT" || value === "CUSTOM") {
    return value;
  }
  throw invalidRequest("paymentOption is invalid.", {
    paymentOption: "paymentOption must be MINIMUM, FULL_STATEMENT or CUSTOM.",
  });
}

function toPublicCreditAccount(account: CreditAccountRecord): CreditAccount {
  const { userId: _userId, customerId: _customerId, ...publicAccount } = account;
  return cloneCreditAccount(publicAccount);
}

function toPublicCreditStatement(statement: CreditStatementRecord): CreditStatement {
  const { userId: _userId, ...publicStatement } = statement;
  return cloneCreditStatement(publicStatement);
}

function toPublicCreditPayment(payment: CreditPaymentRecord): CreditPayment {
  const { userId: _userId, quoteId: _quoteId, cardId: _cardId, creditAccountId: _creditAccountId, refundApplied: _refundApplied, clearingApplied: _clearingApplied, creditApplied: _creditApplied, ...publicPayment } = payment;
  return cloneCreditPayment(publicPayment);
}

function toPublicCreditCard(
  card: CreditCardRecord,
  account: CreditAccountRecord,
  statement: CreditStatementRecord | null,
): CreditCard {
  const publicCard: CreditCard = {
    cardId: card.cardId,
    creditAccountId: card.creditAccountId,
    displayName: card.displayName,
    brand: card.brand,
    maskedNumber: card.maskedNumber,
    lastFour: card.lastFour,
    expiryMonth: card.expiryMonth,
    expiryYear: card.expiryYear,
    status: card.status,
    updatedAt: card.updatedAt,
    creditLimit: account.creditLimit,
    availableCredit: account.availableCredit,
    postedOutstanding: account.postedOutstanding,
    pendingAuthorizations: account.pendingAuthorizations,
    nextDueAt: statement?.dueAt ?? null,
    remainingAmountDue: statement?.remainingAmountDue ?? creditMoney(0n),
    minimumPaymentRemaining: statement?.minimumPaymentRemaining ?? creditMoney(0n),
    sandbox: true,
  };
  return cloneCreditCard(publicCard);
}

function parseSavingsInstruction(value: unknown): MaturityInstruction {
  if (
    value === "RETURN_PRINCIPAL_AND_INTEREST" ||
    value === "RENEW_PRINCIPAL" ||
    value === "RENEW_PRINCIPAL_AND_INTEREST"
  ) {
    return value;
  }
  throw invalidRequest("maturityInstruction is invalid.", {
    maturityInstruction: "maturityInstruction is invalid.",
  });
}

function parseSavingsTerm(value: unknown): SavingsTermMonths {
  if (value === 1 || value === 3 || value === 6 || value === 12) {
    return value;
  }
  throw invalidRequest("termMonths is invalid.", {
    termMonths: "termMonths must be 1, 3, 6 or 12.",
  });
}

function cloneSavingsOpeningRecord(
  opening: SavingsOpeningRecord,
): SavingsOpeningRecord {
  return cloneSavingsOpening(opening);
}

type AttemptWindowState = { startedAt: number; attempts: number };

type PreparedRegistration = {
  fullName: string;
  email: string;
  phoneNumber: string;
  password: string;
};

type LoginContext = {
  normalizedEmail: string;
  normalizedPassword: string;
  normalizedDeviceId: string;
  attemptKeys: string[];
  user: UserRecord | undefined;
};

export const BANKING_SYSTEM_STATE_VERSION = 3;

export type BankingSystemState = {
  /** Optional for backwards compatibility with M0-M6 snapshots created before M7. */
  stateVersion?: number;
  core: InMemoryCoreState;
  users: Array<[string, UserRecord]>;
  accessSessions: Array<[string, AccessSession]>;
  authChallenges: Array<[string, AuthChallengeRecord]>;
  authAttemptWindows: Array<[string, AttemptWindowState]>;
  registrationAttemptWindows: Array<[string, AttemptWindowState]>;
  transferStepUpAttemptWindows: Array<[string, AttemptWindowState]>;
  savingsStepUpAttemptWindows?: Array<[string, AttemptWindowState]>;
  creditStepUpAttemptWindows?: Array<[string, CreditStepUpAttemptWindow]>;
  refreshSessions: Array<[string, RefreshSession]>;
  refreshFamilies: Array<[string, string[]]>;
  beneficiaries: Array<[string, BeneficiaryRecord[]]>;
  recipientLookups?: Array<[string, RecipientLookupRecord]>;
  notifications: Array<[string, Notification[]]>;
  quotes: Array<[string, QuoteRecord]>;
  transfers: Array<[string, { userId: string; receipt: TransferReceipt }]>;
  idempotency: Array<[string, IdempotencyRecord]>;
  fundingIdempotency?: Array<[string, FundingIdempotencyRecord]>;
  savingsQuotes?: Array<[string, SavingsQuoteRecord]>;
  savingsOpenings?: Array<[string, SavingsOpeningRecord]>;
  savingsDeposits?: Array<[string, SavingsDepositRecord]>;
  savingsIdempotency?: Array<[string, SavingsIdempotencyRecord]>;
  creditCards?: Array<[string, CreditCardRecord]>;
  creditAccounts?: Array<[string, CreditAccountRecord]>;
  creditTransactions?: Array<[string, CreditTransactionRecord]>;
  creditStatements?: Array<[string, CreditStatementRecord]>;
  creditQuotes?: Array<[string, CreditPaymentQuoteRecord]>;
  creditPayments?: Array<[string, CreditPaymentRecord]>;
  creditIdempotency?: Array<[string, CreditIdempotencyRecord]>;
  creditSeedPurchases?: Array<[string, CreditPurchaseSeed]>;
  auditEventStore: AuditEvent[];
  outboxEventStore: OutboxEvent[];
};

function migrateBankingSystemState(input: BankingSystemState): BankingSystemState {
  const candidate = input as Partial<BankingSystemState>;
  const stateVersion = candidate.stateVersion ?? 1;
  if (!Number.isInteger(stateVersion) || stateVersion < 1) {
    throw new Error("Banking snapshot state version is invalid.");
  }
  if (stateVersion > BANKING_SYSTEM_STATE_VERSION) {
    throw new Error(
      `Banking snapshot state version ${stateVersion} is newer than supported version ${BANKING_SYSTEM_STATE_VERSION}.`,
    );
  }

  const requiredArrays = [
    "users",
    "accessSessions",
    "authChallenges",
    "authAttemptWindows",
    "registrationAttemptWindows",
    "transferStepUpAttemptWindows",
    "refreshSessions",
    "refreshFamilies",
    "beneficiaries",
    "notifications",
    "quotes",
    "transfers",
    "idempotency",
    "auditEventStore",
    "outboxEventStore",
  ] as const;
  if (!candidate.core || requiredArrays.some((key) => !Array.isArray(candidate[key]))) {
    throw new Error("Banking snapshot state is missing required fields.");
  }

  return {
    stateVersion: BANKING_SYSTEM_STATE_VERSION,
    core: candidate.core,
    users: candidate.users!,
    accessSessions: candidate.accessSessions!,
    authChallenges: candidate.authChallenges!,
    authAttemptWindows: candidate.authAttemptWindows!,
    registrationAttemptWindows: candidate.registrationAttemptWindows!,
    transferStepUpAttemptWindows: candidate.transferStepUpAttemptWindows!,
    savingsStepUpAttemptWindows: candidate.savingsStepUpAttemptWindows ?? [],
    creditStepUpAttemptWindows: candidate.creditStepUpAttemptWindows ?? [],
    refreshSessions: candidate.refreshSessions!,
    refreshFamilies: candidate.refreshFamilies!,
    beneficiaries: candidate.beneficiaries!,
    recipientLookups: candidate.recipientLookups ?? [],
    notifications: candidate.notifications!,
    quotes: candidate.quotes!,
    transfers: candidate.transfers!,
    idempotency: candidate.idempotency!,
    fundingIdempotency: candidate.fundingIdempotency ?? [],
    savingsQuotes: candidate.savingsQuotes ?? [],
    savingsOpenings: candidate.savingsOpenings ?? [],
    savingsDeposits: candidate.savingsDeposits ?? [],
    savingsIdempotency: candidate.savingsIdempotency ?? [],
    creditCards: candidate.creditCards ?? [],
    creditAccounts: candidate.creditAccounts ?? [],
    creditTransactions: candidate.creditTransactions ?? [],
    creditStatements: candidate.creditStatements ?? [],
    creditQuotes: candidate.creditQuotes ?? [],
    creditPayments: candidate.creditPayments ?? [],
    creditIdempotency: candidate.creditIdempotency ?? [],
    creditSeedPurchases: candidate.creditSeedPurchases ?? [],
    auditEventStore: candidate.auditEventStore!,
    outboxEventStore: candidate.outboxEventStore!,
  };
}

function assertEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw invalidRequest("Email is invalid.", { email: "Email is invalid." });
  }
  return normalized;
}

function assertPassword(password: string): string {
  const normalized = requireString(password, "password");
  if (normalized.length < 8) {
    throw invalidRequest("Password is too short.", {
      password: "Password must contain at least 8 characters.",
    });
  }
  return normalized;
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    const offset =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { offset?: unknown }).offset
        : undefined;
    if (
      typeof offset !== "number" ||
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      throw new Error("invalid cursor");
    }
    return offset;
  } catch {
    throw invalidRequest("cursor is invalid.", { cursor: "cursor is invalid." });
  }
}

export class BankingSystem {
  readonly core: CoreBankingPort;
  private readonly auditEventStore: AuditEvent[] = [];
  private readonly outboxEventStore: OutboxEvent[] = [];

  private readonly clock: Clock;
  private readonly bankingEnvironment: string;
  private readonly sandboxOperatorKey: string;
  private readonly sandboxOtp: string | undefined;
  private readonly sandboxMfaOtp: string | undefined;
  private readonly mfaRequired: boolean;
  private readonly authChallengeMethods: StepUpMethod[];
  private readonly allowlistPredicate: (userId: string) => boolean;
  private readonly settleTransfersImmediately: boolean;
  private readonly settleSavingsImmediately: boolean;
  private readonly settleCreditPaymentsImmediately: boolean;
  private readonly creditOverdueSeed: boolean;
  private readonly savingsProducts: readonly SavingsProduct[];
  private readonly outboxPendingThreshold: number;
  private readonly users = new Map<string, UserRecord>();
  private readonly usersByEmail = new Map<string, string>();
  private readonly usersByPhone = new Map<string, string>();
  private readonly accessSessions = new Map<string, AccessSession>();
  private readonly authChallenges = new Map<string, AuthChallengeRecord>();
  private readonly sandboxOtpInbox = new Map<string, string>();
  private readonly authAttemptWindows = new Map<
    string,
    { startedAt: number; attempts: number }
  >();
  private readonly registrationAttemptWindows = new Map<
    string,
    { startedAt: number; attempts: number }
  >();
  private readonly transferStepUpAttemptWindows = new Map<
    string,
    { startedAt: number; attempts: number }
  >();
  private readonly savingsStepUpAttemptWindows = new Map<
    string,
    { startedAt: number; attempts: number }
  >();
  private readonly creditStepUpAttemptWindows = new Map<string, CreditStepUpAttemptWindow>();
  private readonly refreshSessions = new Map<string, RefreshSession>();
  private readonly refreshFamilies = new Map<string, Set<string>>();
  private readonly beneficiaries = new Map<string, BeneficiaryRecord[]>();
  private readonly recipientLookups = new Map<string, RecipientLookupRecord>();
  private readonly notifications = new Map<string, Notification[]>();
  private readonly quotes = new Map<string, QuoteRecord>();
  private readonly transfers = new Map<string, { userId: string; receipt: TransferReceipt }>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly fundingIdempotency = new Map<string, FundingIdempotencyRecord>();
  private readonly savingsQuotes = new Map<string, SavingsQuoteRecord>();
  private readonly savingsOpenings = new Map<string, SavingsOpeningRecord>();
  private readonly savingsDeposits = new Map<string, SavingsDepositRecord>();
  private readonly savingsIdempotency = new Map<string, SavingsIdempotencyRecord>();
  private readonly creditCards = new Map<string, CreditCardRecord>();
  private readonly creditAccounts = new Map<string, CreditAccountRecord>();
  private readonly creditTransactions = new Map<string, CreditTransactionRecord>();
  private readonly creditStatements = new Map<string, CreditStatementRecord>();
  private readonly creditQuotes = new Map<string, CreditPaymentQuoteRecord>();
  private readonly creditPayments = new Map<string, CreditPaymentRecord>();
  private readonly creditIdempotency = new Map<string, CreditIdempotencyRecord>();
  private readonly creditSeedPurchases = new Map<string, CreditPurchaseSeed>();
  private readonly policy: ControlPolicy;

  constructor(
    options: {
      clock?: Clock;
      core?: CoreBankingPort;
      sandboxOperatorKey?: string;
      sandboxOtp?: string;
      sandboxMfaOtp?: string;
      mfaRequired?: boolean;
      authChallengeMethods?: StepUpMethod[];
      globalKillSwitch?: boolean;
      transfersEnabled?: boolean;
      allowlisted?: boolean;
      allowlist?: (userId: string) => boolean;
      maxTransferAmountMinor?: string;
      stepUpMethods?: StepUpMethod[];
      settleTransfersImmediately?: boolean;
      savingsEnabled?: boolean;
      savingsAllowlisted?: boolean;
      maxSavingsAmountMinor?: string;
      savingsStepUpMethods?: StepUpMethod[];
      settleSavingsImmediately?: boolean;
      creditOverdueSeed?: boolean;
      creditEnabled?: boolean;
      creditAllowlisted?: boolean;
      creditPaymentsEnabled?: boolean;
      cardControlsEnabled?: boolean;
      maxCreditPaymentAmountMinor?: string;
      creditPaymentStepUpMethods?: StepUpMethod[];
      cardUnlockStepUpMethods?: StepUpMethod[];
      settleCreditPaymentsImmediately?: boolean;
      savingsProducts?: readonly SavingsProduct[];
      outboxPendingThreshold?: number;
    } = {},
  ) {
    this.clock = options.clock ?? (() => Date.now());
    this.bankingEnvironment = process.env.BANKING_ENV ?? "development";
    this.sandboxOperatorKey =
      options.sandboxOperatorKey ??
      process.env.BANKING_SANDBOX_OPERATOR_KEY ??
      "sandbox-operator-local";
    this.core = options.core ?? new InMemoryCoreBanking();
    this.sandboxOtp = options.sandboxOtp ?? process.env.BANKING_SANDBOX_OTP;
    this.sandboxMfaOtp =
      options.sandboxMfaOtp ?? process.env.BANKING_SANDBOX_MFA_OTP;
    this.mfaRequired =
      options.mfaRequired ??
      (process.env.BANKING_MFA_REQUIRED === "1" ||
        process.env.BANKING_ENV === "preview");
    this.authChallengeMethods = normalizeStepUpMethods(
      options.authChallengeMethods,
      ["OTP"],
    );
    this.allowlistPredicate = options.allowlist ?? (() => true);
    this.settleTransfersImmediately = options.settleTransfersImmediately ?? true;
    this.settleSavingsImmediately = options.settleSavingsImmediately ?? true;
    this.settleCreditPaymentsImmediately =
      options.settleCreditPaymentsImmediately ??
      process.env.BANKING_SETTLE_CREDIT_PAYMENTS_IMMEDIATELY !== "0";
    this.creditOverdueSeed =
      options.creditOverdueSeed ?? process.env.BANKING_SANDBOX_CREDIT_OVERDUE === "1";
    this.savingsProducts = (options.savingsProducts ?? DEFAULT_SAVINGS_PRODUCTS).map(
      (product) => ({
        ...product,
        minAmountMinor: product.minAmountMinor,
        maxAmountMinor: product.maxAmountMinor,
      }),
    );
    this.outboxPendingThreshold =
      options.outboxPendingThreshold ??
      Number(process.env.BANKING_OUTBOX_PENDING_THRESHOLD ?? DEFAULT_OUTBOX_PENDING_THRESHOLD);
    if (!Number.isInteger(this.outboxPendingThreshold) || this.outboxPendingThreshold < 0) {
      throw new Error("outboxPendingThreshold must be a non-negative integer.");
    }
    this.policy = {
      configVersion: CREDIT_POLICY_VERSION,
      globalKillSwitch:
        options.globalKillSwitch ?? process.env.BANKING_GLOBAL_KILL_SWITCH === "1",
      transfersEnabled:
        options.transfersEnabled ?? process.env.BANKING_TRANSFERS_ENABLED !== "0",
      allowlisted:
        options.allowlisted ?? process.env.BANKING_ALLOWLIST_ENABLED !== "0",
      maxTransferAmountMinor: normalizeTransferLimit(
        options.maxTransferAmountMinor ??
          process.env.BANKING_MAX_TRANSFER_AMOUNT_MINOR,
        DEFAULT_TRANSFER_LIMIT_MINOR,
      ),
      stepUpMethods: normalizeStepUpMethods(options.stepUpMethods, [
        "OTP",
        "BIOMETRIC",
      ]),
      savingsEnabled:
        options.savingsEnabled ?? process.env.BANKING_SAVINGS_ENABLED !== "0",
      savingsAllowlisted:
        options.savingsAllowlisted ?? process.env.BANKING_SAVINGS_ALLOWLIST_ENABLED !== "0",
      maxSavingsAmountMinor: normalizeTransferLimit(
        options.maxSavingsAmountMinor ?? process.env.BANKING_MAX_SAVINGS_AMOUNT_MINOR,
        500_000_000n,
      ),
      savingsStepUpMethods: normalizeStepUpMethods(options.savingsStepUpMethods, [
        "OTP",
        "BIOMETRIC",
      ]),
      creditEnabled:
        options.creditEnabled ?? process.env.BANKING_CREDIT_ENABLED !== "0",
      creditAllowlisted:
        options.creditAllowlisted ?? process.env.BANKING_CREDIT_ALLOWLIST_ENABLED !== "0",
      creditPaymentsEnabled:
        options.creditPaymentsEnabled ?? process.env.BANKING_CREDIT_PAYMENTS_ENABLED !== "0",
      cardControlsEnabled:
        options.cardControlsEnabled ?? process.env.BANKING_CARD_CONTROLS_ENABLED !== "0",
      maxCreditPaymentAmountMinor: normalizeTransferLimit(
        options.maxCreditPaymentAmountMinor ?? process.env.BANKING_MAX_CREDIT_PAYMENT_AMOUNT_MINOR,
        BigInt(DEFAULT_CREDIT_LIMIT_MINOR),
      ),
      creditPaymentStepUpMethods: normalizeStepUpMethods(
        options.creditPaymentStepUpMethods,
        ["OTP", "BIOMETRIC"],
      ),
      cardUnlockStepUpMethods: normalizeStepUpMethods(
        options.cardUnlockStepUpMethods,
        ["OTP", "BIOMETRIC"],
      ),
      updatedAt: nowIso(this.clock),
    };
  }

  private prepareRegistration(
    input: {
      fullName: string;
      email: string;
      phoneNumber: string;
      password: string;
    },
    rateLimitKey?: string,
  ): PreparedRegistration {
    this.cleanupExpiredState();
    const prepared = {
      fullName: requireString(input.fullName, "fullName"),
      email: assertEmail(input.email),
      phoneNumber: requireString(input.phoneNumber, "phoneNumber"),
      password: assertPassword(input.password),
    };
    const registrationKey = rateLimitKey?.trim() || `email:${prepared.email}`;
    this.assertRegistrationAttemptAllowed(registrationKey);
    this.recordRegistrationAttempt(registrationKey);

    if (
      this.usersByEmail.has(prepared.email) ||
      this.usersByPhone.has(prepared.phoneNumber)
    ) {
      throw conflict("Email or phone number already exists.");
    }

    return prepared;
  }

  private completeRegistration(
    prepared: PreparedRegistration,
    passwordMaterial: { salt: string; digest: string },
  ): { user: AuthUser } {
    const user: AuthUser = {
      id: createId("user"),
      fullName: prepared.fullName,
      email: prepared.email,
      phoneNumber: prepared.phoneNumber,
      createdAt: nowIso(this.clock),
    };
    const record: UserRecord = {
      ...user,
      passwordSalt: passwordMaterial.salt,
      passwordDigest: passwordMaterial.digest,
    };

    this.users.set(user.id, record);
    this.usersByEmail.set(prepared.email, user.id);
    this.usersByPhone.set(prepared.phoneNumber, user.id);
    this.core.createPaymentAccount(user.id, user.createdAt);
    this.beneficiaries.set(user.id, []);
    this.notifications.set(user.id, []);
    this.recordAudit("USER_REGISTERED", user.id, user.id);

    return { user };
  }

  private prepareLogin(
    email: string,
    password: string,
    deviceId?: string,
  ): LoginContext {
    this.cleanupExpiredState();
    const normalizedEmail = assertEmail(requireString(email, "email"));
    const normalizedDeviceId = this.normalizeDeviceId(deviceId);
    const attemptKeys = this.getLoginAttemptKeys(
      normalizedEmail,
      normalizedDeviceId,
    );
    for (const attemptKey of attemptKeys) {
      this.assertAuthAttemptAllowed(attemptKey);
    }
    const userId = this.usersByEmail.get(normalizedEmail);
    return {
      normalizedEmail,
      normalizedPassword: typeof password === "string" ? password : "",
      normalizedDeviceId,
      attemptKeys,
      user: userId ? this.users.get(userId) : undefined,
    };
  }

  private finishLogin(context: LoginContext, valid: boolean): LoginResult {
    if (!context.user || !valid) {
      for (const attemptKey of context.attemptKeys) {
        this.recordAuthFailure(attemptKey);
      }
      throw unauthorized("Invalid credentials.");
    }

    for (const attemptKey of context.attemptKeys) {
      this.authAttemptWindows.delete(attemptKey);
    }
    if (this.mfaRequired) {
      return this.issueAuthChallenge(context.user.id, context.normalizedDeviceId);
    }

    return this.issueTokenPair(
      context.user,
      createId("refresh-family"),
      context.normalizedDeviceId,
    );
  }

  register(input: {
    fullName: string;
    email: string;
    phoneNumber: string;
    password: string;
  }, rateLimitKey?: string): { user: AuthUser } {
    const prepared = this.prepareRegistration(input, rateLimitKey);
    return this.completeRegistration(prepared, hashPassword(prepared.password));
  }

  async registerAsync(input: {
    fullName: string;
    email: string;
    phoneNumber: string;
    password: string;
  }, rateLimitKey?: string): Promise<{ user: AuthUser }> {
    const prepared = this.prepareRegistration(input, rateLimitKey);
    const passwordMaterial = await hashPasswordAsync(prepared.password);
    return this.completeRegistration(prepared, passwordMaterial);
  }

  login(email: string, password: string, deviceId?: string): LoginResult {
    const context = this.prepareLogin(email, password, deviceId);
    const valid =
      context.user !== undefined &&
      verifyPassword(
        context.normalizedPassword,
        context.user.passwordSalt,
        context.user.passwordDigest,
      );
    return this.finishLogin(context, valid);
  }

  async loginAsync(
    email: string,
    password: string,
    deviceId?: string,
  ): Promise<LoginResult> {
    const context = this.prepareLogin(email, password, deviceId);
    const valid =
      context.user !== undefined &&
      (await verifyPasswordAsync(
        context.normalizedPassword,
        context.user.passwordSalt,
        context.user.passwordDigest,
      ));
    return this.finishLogin(context, valid);
  }

  verifyLoginChallenge(
    challengeId: string,
    method: StepUpMethod,
    proof: string,
    deviceId?: string,
  ): LoginResponse {
    this.cleanupExpiredState();
    const tokenHash = hashOpaqueToken(requireString(challengeId, "challengeId"));
    const challenge = this.authChallenges.get(tokenHash);
    if (!challenge || challenge.expiresAt <= this.clock()) {
      throw unauthorized("Authentication challenge is invalid or expired.");
    }
    const user = this.users.get(challenge.userId);
    if (!user) {
      throw unauthorized("User session is invalid.");
    }
    this.verifyOtpChallenge(
      challengeId,
      challenge.userId,
      deviceId,
      method,
      proof,
      "LOGIN",
      null,
      null,
    );
    this.recordAudit("AUTH_CHALLENGE_VERIFIED", user.id, null);
    return this.issueTokenPair(user, createId("refresh-family"), challenge.deviceId);
  }

  createOtpChallenge(
    userId: string,
    deviceId: string | undefined,
    purpose: OtpPurpose,
    resourceId: string | null = null,
    requestFingerprint: string | null = null,
  ): AuthChallengeResponse {
    const supportedPurposes: readonly OtpPurpose[] = [
      "REGISTRATION_VERIFY",
      "LOGIN",
      "TRANSFER",
      "SAVINGS_OPENING",
      "CREDIT_APPLICATION",
      "CARD_ACTIVATION",
      "CREDIT_PAYMENT",
      "CARD_UNLOCK",
    ];
    if (!supportedPurposes.includes(purpose)) {
      throw invalidRequest("OTP purpose is invalid.");
    }
    const methods =
      purpose === "TRANSFER"
        ? this.policy.stepUpMethods
        : purpose === "SAVINGS_OPENING"
          ? this.policy.savingsStepUpMethods
          : purpose === "CREDIT_PAYMENT"
            ? this.policy.creditPaymentStepUpMethods
            : purpose === "CARD_UNLOCK"
              ? this.policy.cardUnlockStepUpMethods
              : ["OTP"] as StepUpMethod[];
    return this.issueOtpChallenge(
      userId,
      this.normalizeDeviceId(deviceId),
      purpose,
      resourceId,
      requestFingerprint,
      methods,
    );
  }

  getSandboxOtp(operatorKey: string, challengeId: string): string {
    if (this.bankingEnvironment === "production" || operatorKey !== this.sandboxOperatorKey) {
      throw unauthorized("Sandbox operator authorization failed.");
    }
    const challengeHash = hashOpaqueToken(requireString(challengeId, "challengeId"));
    const challenge = this.authChallenges.get(challengeHash);
    const otp = this.sandboxOtpInbox.get(challengeHash);
    if (!challenge || challenge.expiresAt <= this.clock() || !otp) {
      throw notFound("Sandbox OTP challenge not found or expired.");
    }
    return otp;
  }

  refresh(refreshToken: string, deviceId?: string): LoginResponse {
    this.cleanupExpiredState();
    const tokenHash = hashOpaqueToken(requireString(refreshToken, "refreshToken"));
    const session = this.refreshSessions.get(tokenHash);

    if (!session || session.expiresAt <= this.clock()) {
      throw unauthorized("Refresh token is invalid or expired.");
    }

    if (session.deviceId !== this.normalizeDeviceId(deviceId)) {
      throw unauthorized("Device binding mismatch.");
    }

    if (session.revoked) {
      this.revokeFamily(session.familyId);
      throw unauthorized("Refresh token reuse detected.");
    }

    session.revoked = true;
    const user = this.users.get(session.userId);
    if (!user) {
      throw unauthorized("User session is invalid.");
    }

    this.recordAudit("REFRESH_ROTATED", user.id, null);
    return this.issueTokenPair(user, session.familyId, session.deviceId);
  }

  revoke(refreshToken: string, deviceId?: string): boolean {
    const tokenHash = hashOpaqueToken(requireString(refreshToken, "refreshToken"));
    const session = this.refreshSessions.get(tokenHash);
    if (!session) {
      return false;
    }

    if (session.deviceId !== this.normalizeDeviceId(deviceId)) {
      throw unauthorized("Device binding mismatch.");
    }

    this.revokeFamily(session.familyId);
    this.recordAudit("SESSION_REVOKED", session.userId, null);
    return true;
  }

  revokeAllSessions(userId: string): void {
    const familyIds = new Set<string>();

    for (const session of this.refreshSessions.values()) {
      if (session.userId === userId) {
        familyIds.add(session.familyId);
      }
    }

    for (const session of this.accessSessions.values()) {
      if (session.userId === userId) {
        familyIds.add(session.familyId);
      }
    }

    for (const familyId of familyIds) {
      this.revokeFamily(familyId);
    }

    this.recordAudit("ALL_SESSIONS_REVOKED", userId, null);
  }

  authenticate(accessToken: string, deviceId?: string): AuthUser {
    this.cleanupExpiredState();
    const tokenHash = hashOpaqueToken(requireString(accessToken, "accessToken"));
    const session = this.accessSessions.get(tokenHash);

    if (!session || session.expiresAt <= this.clock()) {
      throw unauthorized("Access token is invalid or expired.");
    }

    if (session.deviceId !== this.normalizeDeviceId(deviceId)) {
      throw unauthorized("Device binding mismatch.");
    }

    const user = this.users.get(session.userId);
    if (!user) {
      throw unauthorized("Access token is invalid.");
    }

    return this.publicUser(user);
  }

  listAccounts(userId: string): PaymentAccount[] {
    return this.core.listPaymentAccounts(userId);
  }

  fundSandbox(
    operatorKey: string,
    idempotencyKey: string,
    input: SandboxFundingRequest,
  ): FundingReceipt {
    if (this.bankingEnvironment === "production") {
      throw conflictWithCode(
        "SANDBOX_DISABLED",
        "Sandbox Funding bị vô hiệu hóa ngoài môi trường sandbox/development.",
      );
    }
    if (operatorKey !== this.sandboxOperatorKey) {
      throw unauthorized("Sandbox operator authorization failed.");
    }
    const normalizedKey = requireString(idempotencyKey, "Idempotency-Key");
    const amountMinor = parseMoney(input.amount, "amount");
    if (
      amountMinor <= 0n ||
      amountMinor > DEFAULT_SANDBOX_FUNDING_LIMIT_MINOR
    ) {
      throw conflict("Sandbox funding amount is outside the allowed limit.");
    }
    const requestFingerprint = fingerprint({
      recipientAccountNumber: normalizeAccountNumber(input.recipientAccountNumber),
      amountMinor: amountMinor.toString(),
      reason: requireBoundedString(input.reason, "reason", 160),
    });
    const existing = this.fundingIdempotency.get(normalizedKey);
    if (existing) {
      if (existing.fingerprint !== requestFingerprint) {
        throw conflict("Funding idempotency key was reused with a different request.");
      }
      return { ...existing.receipt, amount: { ...existing.receipt.amount } };
    }
    const target = this.core.findPaymentAccountByNumber(
      normalizeAccountNumber(input.recipientAccountNumber),
    );
    const reason = requireBoundedString(input.reason, "reason", 160);
    const receipt = this.core.fundPaymentAccount(
      createId("sandbox-funding"),
      target.accountNumber,
      amountMinor,
      reason,
      nowIso(this.clock),
    );
    this.fundingIdempotency.set(normalizedKey, {
      fingerprint: requestFingerprint,
      receipt: { ...receipt, amount: { ...receipt.amount } },
    });
    this.recordAudit("SANDBOX_FUNDING_SUCCEEDED", null, receipt.fundingId);
    this.enqueueOutbox("SANDBOX_FUNDING_SUCCEEDED", receipt.fundingId, receipt.createdAt);
    this.notifications.get(target.ownerId)?.unshift({
      id: createId("notification"),
      type: "TRANSFER",
      title: "Đã cấp tiền Sandbox",
      body: `Tài khoản đã nhận ${receipt.amount.amountMinor} minor unit VND từ Quỹ Sandbox.`,
      resourceId: receipt.transactionId,
      resourceAccountId: target.accountId,
      read: false,
      createdAt: receipt.createdAt,
    });
    return { ...receipt, amount: { ...receipt.amount } };
  }

  getAccountNumber(userId: string, accountId: string): string {
    const accountNumber = this.core.getPaymentAccountNumber(userId, accountId);
    this.recordAudit("ACCOUNT_NUMBER_REVEALED", userId, accountId);
    return accountNumber;
  }

  listTransactions(
    userId: string,
    accountId: string,
    cursor?: string,
    limit = 20,
  ): ListTransactionsResult {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw invalidRequest("limit must be an integer between 1 and 100.", {
        limit: "limit must be between 1 and 100.",
      });
    }

    const offset = decodeCursor(cursor);
    const all = this.core.listTransactions(userId, accountId);
    const items = all.slice(offset, offset + limit).map((transaction) => this.toTransaction(transaction));
    const nextOffset = offset + items.length;

    return {
      items,
      nextCursor: nextOffset < all.length ? encodeCursor(nextOffset) : null,
    };
  }

  getTransaction(userId: string, accountId: string, transactionId: string): TransactionDetail {
    return this.core.getTransaction(userId, accountId, transactionId);
  }

  listCards(userId: string): CreditCard[] {
    this.assertCreditVisible(userId);
    this.processCreditStatements(userId);
    return [...this.creditCards.values()]
      .filter((card) => card.userId === userId)
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .map((card) => {
        const account = this.requireCreditAccount(userId, card.creditAccountId);
        return toPublicCreditCard(card, account, this.findLatestCreditStatement(card.creditAccountId));
      });
  }

  listCreditAccounts(userId: string): CreditAccount[] {
    this.assertCreditVisible(userId);
    this.processCreditStatements(userId);
    return [...this.creditAccounts.values()]
      .filter((account) => account.userId === userId)
      .map(toPublicCreditAccount);
  }

  getCard(userId: string, cardId: string): {
    card: CreditCard;
    creditAccount: CreditAccount;
    latestStatement: CreditStatement | null;
  } {
    this.assertCreditVisible(userId);
    this.processCreditStatements(userId);
    const card = this.requireCard(userId, cardId);
    const account = this.requireCreditAccount(userId, card.creditAccountId);
    const latestStatement = this.findLatestCreditStatement(card.creditAccountId);
    return {
      card: toPublicCreditCard(card, account, latestStatement),
      creditAccount: toPublicCreditAccount(account),
      latestStatement: latestStatement ? toPublicCreditStatement(latestStatement) : null,
    };
  }

  getCreditAccount(userId: string, creditAccountId: string): CreditAccount {
    this.assertCreditVisible(userId);
    this.processCreditStatements(userId);
    return toPublicCreditAccount(this.requireCreditAccount(userId, creditAccountId));
  }

  listCreditTransactions(
    userId: string,
    creditAccountId: string,
    cursor?: string,
    limit = 20,
  ): CreditTransactionsResult {
    this.assertCreditVisible(userId);
    this.processCreditStatements(userId);
    this.requireCreditAccount(userId, creditAccountId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw invalidRequest("limit must be an integer between 1 and 100.", {
        limit: "limit must be between 1 and 100.",
      });
    }
    const offset = decodeCursor(cursor);
    const all = [...this.creditTransactions.values()]
      .filter((transaction) => transaction.userId === userId && transaction.creditAccountId === creditAccountId)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
    const items = all.slice(offset, offset + limit).map((transaction) => {
      const { userId: _userId, ...publicTransaction } = transaction;
      return cloneCreditTransaction(publicTransaction);
    });
    const nextOffset = offset + items.length;
    return { items, nextCursor: nextOffset < all.length ? encodeCursor(nextOffset) : null };
  }

  listCreditStatements(
    userId: string,
    creditAccountId: string,
    cursor?: string,
    limit = 20,
  ): CreditStatementsResult {
    this.assertCreditVisible(userId);
    this.processCreditStatements(userId);
    this.requireCreditAccount(userId, creditAccountId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw invalidRequest("limit must be an integer between 1 and 100.", {
        limit: "limit must be between 1 and 100.",
      });
    }
    const offset = decodeCursor(cursor);
    const all = [...this.creditStatements.values()]
      .filter((statement) => statement.userId === userId && statement.creditAccountId === creditAccountId)
      .sort((left, right) => right.issuedAt.localeCompare(left.issuedAt));
    const items = all.slice(offset, offset + limit).map(toPublicCreditStatement);
    const nextOffset = offset + items.length;
    return { items, nextCursor: nextOffset < all.length ? encodeCursor(nextOffset) : null };
  }

  getCreditStatement(userId: string, creditAccountId: string, statementId: string): CreditStatement {
    this.assertCreditVisible(userId);
    this.processCreditStatements(userId);
    const account = this.requireCreditAccount(userId, creditAccountId);
    const statement = this.creditStatements.get(statementId);
    if (!statement || statement.userId !== userId || statement.creditAccountId !== account.creditAccountId) {
      throw conflictWithCode("STATEMENT_NOT_FOUND", "Không tìm thấy sao kê tín dụng.");
    }
    return toPublicCreditStatement(statement);
  }

  lockCard(userId: string, cardId: string): CreditCard {
    this.assertCardControlsAvailable(userId);
    const card = this.requireCard(userId, cardId);
    if (card.status === "BLOCKED" || card.status === "EXPIRED" || card.status === "CLOSED") {
      throw conflictWithCode("CARD_STATE_INVALID", "Thẻ này không thể khóa hoặc mở bằng Mobile.");
    }
    card.status = "LOCKED";
    card.updatedAt = nowIso(this.clock);
    this.recordAudit("CREDIT_CARD_LOCKED", userId, card.cardId);
    this.enqueueOutbox("CREDIT_CARD_LOCKED", card.cardId, card.updatedAt);
    return this.getCard(userId, card.cardId).card;
  }

  unlockCard(
    userId: string,
    cardId: string,
    stepUp: { method: StepUpMethod; proof: string; challengeId?: string },
    deviceId?: string,
  ): CreditCard {
    this.assertCardControlsAvailable(userId);
    const card = this.requireCard(userId, cardId);
    if (card.status !== "LOCKED") {
      throw conflictWithCode("CARD_STATE_INVALID", "Chỉ thẻ đang khóa mới có thể mở.");
    }
    this.verifyCreditStepUp(
      userId,
      stepUp,
      card.cardId,
      this.policy.cardUnlockStepUpMethods,
      deviceId,
      "CARD_UNLOCK",
      null,
    );
    card.status = "ACTIVE";
    card.updatedAt = nowIso(this.clock);
    this.recordAudit("CREDIT_CARD_UNLOCKED", userId, card.cardId);
    this.enqueueOutbox("CREDIT_CARD_UNLOCKED", card.cardId, card.updatedAt);
    return this.getCard(userId, card.cardId).card;
  }

  createCreditPaymentQuote(
    userId: string,
    input: CreditPaymentQuoteRequest,
  ): CreditPaymentQuote {
    this.cleanupExpiredState();
    this.assertCreditPaymentAvailable(userId);
    this.processCreditStatements(userId);
    const sourceAccountId = requireString(input.sourceAccountId, "sourceAccountId");
    const creditAccountId = requireString(input.creditAccountId, "creditAccountId");
    const statementId = requireString(input.statementId, "statementId");
    const paymentOption = parseCreditPaymentOption(input.paymentOption);
    const sourceAccount = this.core.getPaymentAccount(userId, sourceAccountId);
    if (sourceAccount.status !== "ACTIVE") {
      throw conflictWithCode("SOURCE_ACCOUNT_BLOCKED", "Tài khoản nguồn không hoạt động.");
    }
    const account = this.requireCreditAccount(userId, creditAccountId);
    const statement = this.creditStatements.get(statementId);
    if (!statement || statement.userId !== userId || statement.creditAccountId !== creditAccountId) {
      throw conflictWithCode("STATEMENT_NOT_FOUND", "Không tìm thấy sao kê tín dụng.");
    }
    if (statement.remainingAmountDue.amountMinor === "0") {
      throw conflictWithCode("STATEMENT_PAID", "Sao kê này đã được thanh toán đủ.");
    }
    const remainingMinor = BigInt(statement.remainingAmountDue.amountMinor);
    let amountMinor: bigint;
    if (paymentOption === "MINIMUM") {
      amountMinor = BigInt(statement.minimumPaymentRemaining.amountMinor);
    } else if (paymentOption === "FULL_STATEMENT") {
      amountMinor = remainingMinor;
    } else {
      if (!input.amount) {
        throw invalidRequest("amount is required for CUSTOM payment.", { amount: "amount is required." });
      }
      amountMinor = parseMoney(input.amount, "amount");
    }
    if (amountMinor <= 0n) {
      throw conflictWithCode("PAYMENT_AMOUNT_INVALID", "Số tiền thanh toán phải lớn hơn 0.");
    }
    if (amountMinor > remainingMinor) {
      throw conflictWithCode("OVERPAYMENT", "Không thể thanh toán vượt dư nợ sao kê.");
    }
    if (amountMinor > BigInt(this.policy.maxCreditPaymentAmountMinor)) {
      throw conflictWithCode("PAYMENT_AMOUNT_INVALID", "Số tiền vượt giới hạn sandbox.");
    }
    const card = [...this.creditCards.values()].find(
      (item) => item.userId === userId && item.creditAccountId === creditAccountId,
    );
    if (!card) {
      throw notFound("Credit card not found.");
    }
    const now = nowIso(this.clock);
    const quote: CreditPaymentQuote = {
      quoteId: newCreditId(),
      sourceAccountId,
      sourceAccountMaskedNumber: sourceAccount.maskedNumber,
      creditAccountId,
      cardLastFour: card.lastFour,
      statementId,
      statementVersion: statement.version,
      paymentOption,
      amount: creditMoney(amountMinor),
      fee: creditMoney(0n),
      outstandingBefore: cloneMoney(account.postedOutstanding),
      outstandingAfter: creditMoney(BigInt(account.postedOutstanding.amountMinor) - amountMinor),
      minimumPaymentRemainingBefore: cloneMoney(statement.minimumPaymentRemaining),
      minimumPaymentRemainingAfter: creditMoney(
        BigInt(statement.minimumPaymentRemaining.amountMinor) - amountMinor > 0n
          ? BigInt(statement.minimumPaymentRemaining.amountMinor) - amountMinor
          : 0n,
      ),
      terms: "Đây là thanh toán tín dụng sandbox; không phải nghĩa vụ tín dụng thật.",
      expiresAt: new Date(this.clock() + CREDIT_QUOTE_TTL_MS).toISOString(),
    };
    const requestFingerprint = fingerprint({
      sourceAccountId,
      creditAccountId,
      statementId,
      statementVersion: statement.version,
      paymentOption,
      amountMinor: amountMinor.toString(),
      policyVersion: CREDIT_POLICY_VERSION,
    });
    this.creditQuotes.set(quote.quoteId, {
      ...quote,
      userId,
      requestFingerprint,
      consumedPaymentId: null,
    });
    this.recordAudit("CREDIT_PAYMENT_QUOTED", userId, quote.quoteId);
    return cloneCreditQuote(quote);
  }

  submitCreditPayment(
    userId: string,
    idempotencyKey: string,
    request: CreditPaymentRequest,
    deviceId?: string,
  ): CreditPayment {
    this.cleanupExpiredState();
    this.assertCreditPaymentAvailable(userId);
    const normalizedKey = requireString(idempotencyKey, "Idempotency-Key");
    const quoteId = requireString(request.quoteId, "quoteId");
    const quote = this.creditQuotes.get(quoteId);
    if (!quote || quote.userId !== userId) {
      throw notFound("Credit payment quote not found.");
    }
    const existing = this.creditIdempotency.get(`${userId}:${normalizedKey}`);
    if (existing) {
      if (existing.fingerprint !== quote.requestFingerprint) {
        throw conflictWithCode("IDEMPOTENCY_CONFLICT", "Idempotency-Key đã được dùng cho yêu cầu khác.");
      }
      const payment = this.creditPayments.get(existing.paymentId);
      if (!payment) {
        throw notFound("Credit payment not found.");
      }
      return this.getCreditPayment(userId, payment.paymentId);
    }
    if (Date.parse(quote.expiresAt) <= this.clock()) {
      throw conflictWithCode("QUOTE_EXPIRED", "Báo giá thanh toán đã hết hạn.");
    }
    if (quote.consumedPaymentId) {
      throw conflictWithCode("QUOTE_ALREADY_USED", "Báo giá thanh toán đã được sử dụng.");
    }
    const statement = this.creditStatements.get(quote.statementId);
    if (!statement || statement.version !== quote.statementVersion) {
      throw conflictWithCode("STATEMENT_CHANGED", "Sao kê đã thay đổi; hãy tạo báo giá mới.");
    }
    this.verifyCreditStepUp(
      userId,
      request.stepUp,
      quote.quoteId,
      this.policy.creditPaymentStepUpMethods,
      deviceId,
      "CREDIT_PAYMENT",
      quote.requestFingerprint,
    );
    const card = [...this.creditCards.values()].find(
      (item) => item.userId === userId && item.creditAccountId === quote.creditAccountId,
    );
    if (!card) {
      throw notFound("Credit card not found.");
    }
    const sourceAccount = this.core.getPaymentAccount(userId, quote.sourceAccountId);
    if (BigInt(sourceAccount.availableBalance.amountMinor) < BigInt(quote.amount.amountMinor)) {
      throw conflictWithCode("INSUFFICIENT_FUNDS", "Tài khoản nguồn không đủ số dư khả dụng.");
    }
    const paymentId = newCreditId();
    const coreReceipt = this.core.postCreditPayment(userId, {
      paymentId,
      creditAccountId: quote.creditAccountId,
      accountId: quote.sourceAccountId,
      amountMinor: BigInt(quote.amount.amountMinor),
      description: `Thanh toán thẻ ${card.lastFour}`,
      now: nowIso(this.clock),
      settleImmediately: this.settleCreditPaymentsImmediately,
    });
    const payment: CreditPaymentRecord = {
      paymentId,
      statementId: quote.statementId,
      sourceAccountId: quote.sourceAccountId,
      amount: { ...coreReceipt.amount },
      reference: coreReceipt.reference,
      status: coreReceipt.status,
      failureReason: null,
      createdAt: coreReceipt.createdAt,
      updatedAt: coreReceipt.updatedAt,
      userId,
      quoteId: quote.quoteId,
      cardId: card.cardId,
      creditAccountId: quote.creditAccountId,
      refundApplied: false,
      clearingApplied: coreReceipt.status === "SUCCEEDED",
      creditApplied: false,
    };
    this.creditPayments.set(paymentId, payment);
    this.creditIdempotency.set(`${userId}:${normalizedKey}`, {
      userId,
      fingerprint: quote.requestFingerprint,
      paymentId,
    });
    quote.consumedPaymentId = paymentId;
    const transaction: CreditTransactionRecord = {
      transactionId: newCreditId(),
      creditAccountId: quote.creditAccountId,
      statementId: quote.statementId,
      type: "PAYMENT",
      status: payment.status === "SUCCEEDED" ? "POSTED" : "PENDING",
      description: `Thanh toán thẻ ${card.lastFour}`,
      merchantName: null,
      amount: { ...payment.amount },
      debtEffect: "DECREASE",
      occurredAt: payment.createdAt,
      postedAt: payment.status === "SUCCEEDED" ? payment.updatedAt : null,
      userId,
    };
    this.creditTransactions.set(transaction.transactionId, transaction);
    if (payment.status === "SUCCEEDED") {
      this.applyCreditPaymentSuccess(payment, statement);
    }
    this.recordAudit("CREDIT_PAYMENT_SUBMITTED", userId, paymentId);
    this.recordAudit(
      payment.status === "PENDING" ? "CREDIT_PAYMENT_PENDING" : "CREDIT_PAYMENT_SUCCEEDED",
      userId,
      paymentId,
    );
    this.enqueueOutbox(
      payment.status === "PENDING" ? "CREDIT_PAYMENT_PENDING" : "CREDIT_PAYMENT_SUCCEEDED",
      paymentId,
      payment.updatedAt,
    );
    this.notifications.get(userId)?.unshift({
      id: createId("notification"),
      type: "CREDIT",
      title: payment.status === "PENDING" ? "Thanh toán thẻ đang xử lý" : "Thanh toán thẻ thành công",
      body: payment.status === "PENDING"
        ? `Thanh toán ${payment.reference} đang được xử lý.`
        : `Thanh toán ${payment.reference} đã được ghi nhận.`,
      resourceId: card.cardId,
      resourceAccountId: quote.sourceAccountId,
      read: false,
      createdAt: payment.updatedAt,
    });
    return toPublicCreditPayment(payment);
  }

  getCreditPayment(userId: string, paymentId: string): CreditPayment {
    const payment = this.creditPayments.get(paymentId);
    if (!payment || payment.userId !== userId) {
      throw notFound("Credit payment not found.");
    }
    if (payment.status === "PENDING") {
      this.transitionCreditPayment(userId, paymentId, "SUCCEEDED");
    }
    return toPublicCreditPayment(this.creditPayments.get(paymentId)!);
  }

  failCreditPayment(userId: string, paymentId: string): CreditPayment {
    return this.transitionCreditPayment(userId, paymentId, "FAILED");
  }

  reverseCreditPayment(userId: string, paymentId: string): CreditPayment {
    return this.transitionCreditPayment(userId, paymentId, "REVERSED");
  }

  listSavingsProducts(userId: string): SavingsProduct[] {
    this.assertSavingsAvailable(userId);
    return this.savingsProducts
      .filter((product) => product.status === "ACTIVE")
      .map(cloneSavingsProduct);
  }

  createSavingsQuote(userId: string, input: SavingsQuoteRequest): SavingsQuote {
    this.cleanupExpiredState();
    this.assertSavingsAvailable(userId);

    const sourceAccountId = requireString(input.sourceAccountId, "sourceAccountId");
    const productId = requireString(input.productId, "productId");
    const principalMinor = parseMoney(input.principal, "principal");
    const maturityInstruction = parseSavingsInstruction(input.maturityInstruction);
    const product = this.savingsProducts.find((item) => item.productId === productId);
    if (!product || product.status !== "ACTIVE") {
      throw notFound("Savings product not found.");
    }

    const maxAmountMinor = BigInt(
      product.maxAmountMinor < this.policy.maxSavingsAmountMinor
        ? product.maxAmountMinor
        : this.policy.maxSavingsAmountMinor,
    );
    const minAmountMinor = BigInt(product.minAmountMinor);
    if (principalMinor < minAmountMinor || principalMinor > maxAmountMinor) {
      throw conflict("Savings principal is outside the sandbox limit.");
    }

    const account = this.core.getPaymentAccount(userId, sourceAccountId);
    if (account.status !== "ACTIVE") {
      throw conflict("The source account is not active.");
    }

    const openedAt = nowIso(this.clock);
    const quote = buildSavingsQuote({
      quoteId: createId("savings-quote"),
      product,
      sourceAccountId,
      sourceAccountMaskedNumber: account.maskedNumber,
      principalMinor,
      openedAt,
      maturityInstruction,
      expiresAt: new Date(this.clock() + QUOTE_TTL_MS).toISOString(),
    });
    this.savingsQuotes.set(quote.quoteId, {
      ...quote,
      userId,
      fingerprint: fingerprint({
        quoteId: quote.quoteId,
        sourceAccountId: quote.sourceAccountId,
        productId: quote.productId,
        termsVersion: quote.termsVersion,
        principal: quote.principal,
        termMonths: quote.termMonths,
        maturityInstruction: quote.maturityInstruction,
      }),
      consumedOpeningId: null,
    });
    this.recordAudit("SAVINGS_QUOTED", userId, quote.quoteId);
    return toPublicSavingsQuote(this.savingsQuotes.get(quote.quoteId)!);
  }

  submitSavingsOpening(
    userId: string,
    idempotencyKey: string,
    request: SubmitSavingsOpeningRequest,
    deviceId?: string,
  ): SavingsOpening {
    this.cleanupExpiredState();
    this.assertSavingsAvailable(userId);
    const normalizedKey = requireString(idempotencyKey, "Idempotency-Key");
    const quoteId = requireString(request.quoteId, "quoteId");
    const quoteRecord = this.savingsQuotes.get(quoteId);
    if (!quoteRecord || quoteRecord.userId !== userId) {
      throw notFound("Savings quote not found.");
    }
    const requestFingerprint = fingerprint({
      quoteId: quoteRecord.quoteId,
      sourceAccountId: quoteRecord.sourceAccountId,
      productId: quoteRecord.productId,
      termsVersion: quoteRecord.termsVersion,
      principal: quoteRecord.principal,
      termMonths: quoteRecord.termMonths,
      maturityInstruction: quoteRecord.maturityInstruction,
    });
    const idempotencyMapKey = `${userId}:${normalizedKey}`;
    const existing = this.savingsIdempotency.get(idempotencyMapKey);
    if (existing) {
      if (existing.fingerprint !== requestFingerprint) {
        throw conflict("Idempotency key was reused with a different request.");
      }
      const existingOpening = this.savingsOpenings.get(existing.openingId);
      if (!existingOpening) {
        throw notFound("Savings opening not found.");
      }
      return toPublicSavingsOpening(existingOpening);
    }

    if (Date.parse(quoteRecord.expiresAt) <= this.clock()) {
      throw conflict("Savings quote has expired.");
    }
    if (quoteRecord.consumedOpeningId) {
      throw conflict("Savings quote has already been submitted.");
    }

    const stepUpRateKey = `savings-step-up:${userId}`;
    this.assertSavingsStepUpAttemptAllowed(stepUpRateKey);
    const stepUp = request.stepUp;
    if (
      !stepUp ||
      (stepUp.method !== "OTP" && stepUp.method !== "BIOMETRIC") ||
      typeof stepUp.proof !== "string" ||
      !stepUp.proof.trim()
    ) {
      this.recordSavingsStepUpFailure(stepUpRateKey);
      throw invalidRequest("stepUp proof is required.");
    }
    if (!this.policy.savingsStepUpMethods.includes(stepUp.method)) {
      throw conflict("The requested step-up method is not enabled.");
    }
    try {
      if (stepUp.challengeId) {
        this.verifyOtpChallenge(
          stepUp.challengeId,
          userId,
          deviceId,
          stepUp.method,
          stepUp.proof,
          "SAVINGS_OPENING",
          quoteRecord.quoteId,
          requestFingerprint,
        );
      } else if (
        !(
          (stepUp.method === "OTP" && this.sandboxOtp && stepUp.proof === this.sandboxOtp) ||
          (stepUp.method === "BIOMETRIC" && stepUp.proof === "sandbox-biometric")
        )
      ) {
        throw unauthorized("Step-up verification failed.");
      }
    } catch (error) {
      this.recordSavingsStepUpFailure(stepUpRateKey);
      this.recordAudit("STEP_UP_VERIFICATION_FAILED", userId, quoteRecord.quoteId);
      throw error;
    }
    this.savingsStepUpAttemptWindows.delete(stepUpRateKey);
    this.recordAudit("SAVINGS_STEP_UP_VERIFIED", userId, quoteRecord.quoteId);

    const now = nowIso(this.clock);
    const openingId = createId("savings-opening");
    const depositId = createId("savings-deposit");
    const coreReceipt = this.core.postSavingsOpening(userId, {
      openingId,
      depositId,
      accountId: quoteRecord.sourceAccountId,
      amountMinor: BigInt(quoteRecord.principal.amountMinor),
      description: `Mở tiết kiệm ${quoteRecord.productName}`,
      now,
      settleImmediately: this.settleSavingsImmediately,
    });
    const opening: SavingsOpeningRecord = {
      openingId,
      quoteId: quoteRecord.quoteId,
      depositId,
      status: coreReceipt.status,
      reference: coreReceipt.reference,
      failureReason: null,
      createdAt: coreReceipt.createdAt,
      updatedAt: coreReceipt.updatedAt,
      userId,
      idempotencyKey: normalizedKey,
    };
    this.savingsOpenings.set(openingId, opening);
    quoteRecord.consumedOpeningId = openingId;
    this.savingsIdempotency.set(idempotencyMapKey, {
      userId,
      fingerprint: requestFingerprint,
      openingId,
    });

    if (coreReceipt.status === "SUCCEEDED") {
      this.createSavingsDepositFromOpening(quoteRecord, opening);
    }
    this.recordAudit("SAVINGS_OPENING_SUBMITTED", userId, openingId);
    this.recordAudit(
      coreReceipt.status === "PENDING"
        ? "SAVINGS_OPENING_PENDING"
        : "SAVINGS_OPENING_SUCCEEDED",
      userId,
      openingId,
    );
    this.enqueueOutbox(
      coreReceipt.status === "PENDING"
        ? "SAVINGS_OPENING_PENDING"
        : "SAVINGS_OPENING_SUCCEEDED",
      openingId,
      coreReceipt.updatedAt,
    );
    this.notifications.get(userId)?.unshift({
      id: createId("notification"),
      type: "SAVINGS",
      title:
        coreReceipt.status === "PENDING"
          ? "Mở tiết kiệm đang được xử lý"
          : "Mở tiết kiệm thành công",
      body:
        coreReceipt.status === "PENDING"
          ? `Yêu cầu ${coreReceipt.reference} đang được xử lý.`
          : `Khoản tiết kiệm ${coreReceipt.reference} đã được ghi nhận.`,
      resourceId: coreReceipt.status === "PENDING" ? null : depositId,
      resourceAccountId: quoteRecord.sourceAccountId,
      read: false,
      createdAt: coreReceipt.updatedAt,
    });
    return toPublicSavingsOpening(opening);
  }

  getSavingsOpening(userId: string, openingId: string): SavingsOpening {
    const opening = this.savingsOpenings.get(openingId);
    if (!opening || opening.userId !== userId) {
      throw notFound("Savings opening not found.");
    }
    if (opening.status === "PENDING") {
      const receipt = this.core.settleSavingsOpening(
        userId,
        opening.openingId,
        nowIso(this.clock),
      );
      opening.status = receipt.status;
      opening.reference = receipt.reference;
      opening.updatedAt = receipt.updatedAt;
      if (receipt.status === "SUCCEEDED") {
        const quote = this.savingsQuotes.get(opening.quoteId);
        if (!quote) {
          throw notFound("Savings quote not found.");
        }
        this.createSavingsDepositFromOpening(quote, opening);
        this.recordAudit("SAVINGS_OPENING_SUCCEEDED", userId, opening.openingId);
        this.enqueueOutbox("SAVINGS_OPENING_SUCCEEDED", opening.openingId, receipt.updatedAt);
      }
    }
    return toPublicSavingsOpening(opening);
  }

  listSavingsDeposits(userId: string): SavingsListResult {
    this.assertSavingsAvailable(userId);
    this.processSavingsMaturities(userId);
    const items = [...this.savingsDeposits.values()]
      .filter((deposit) => deposit.userId === userId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(toPublicSavingsDeposit);
    const totalPrincipal = items
      .filter((deposit) => deposit.status === "ACTIVE")
      .reduce((total, deposit) => total + BigInt(deposit.principal.amountMinor), 0n);
    return cloneSavingsListResult({ items, totalPrincipal: toMoney(totalPrincipal) });
  }

  getSavingsDeposit(userId: string, depositId: string): SavingsDeposit {
    this.assertSavingsAvailable(userId);
    this.processSavingsMaturities(userId);
    const deposit = this.savingsDeposits.get(depositId);
    if (!deposit || deposit.userId !== userId) {
      throw notFound("Savings deposit not found.");
    }
    return toPublicSavingsDeposit(deposit);
  }

  simulateSavingsMaturity(userId: string, depositId: string): SavingsDeposit {
    const deposit = this.savingsDeposits.get(depositId);
    if (!deposit || deposit.userId !== userId) {
      throw notFound("Savings deposit not found.");
    }
    deposit.maturityAt = new Date(this.clock() - 1).toISOString();
    this.processSavingsMaturities(userId);
    return toPublicSavingsDeposit(this.savingsDeposits.get(depositId)!);
  }

  lookupBeneficiary(userId: string, beneficiaryId: string): Beneficiary {
    const beneficiary = this.beneficiaries
      .get(userId)
      ?.find((item) => item.id === beneficiaryId);
    if (!beneficiary) {
      throw notFound("Beneficiary not found.");
    }
    return toPublicBeneficiary(beneficiary);
  }

  lookupInternalRecipient(
    userId: string,
    accountNumber: string,
  ): InternalRecipientLookup {
    this.cleanupExpiredState();
    const target = this.core.findPaymentAccountByNumber(
      normalizeAccountNumber(accountNumber),
    );
    if (target.ownerId === userId) {
      throw conflict("Không thể chuyển tiền cho chính tài khoản của mình.");
    }
    if (target.status !== "ACTIVE") {
      throw conflict("Tài khoản người nhận không hoạt động.");
    }
    const owner = this.users.get(target.ownerId);
    if (!owner) {
      throw notFound("Recipient owner not found.");
    }
    const lookupId = createOpaqueToken();
    const lookup: RecipientLookupRecord = {
      lookupId,
      userId,
      destinationOwnerId: target.ownerId,
      destinationAccountId: target.accountId,
      accountHolderName: owner.fullName,
      maskedAccountNumber: target.maskedNumber,
      bankName: target.bankName,
      status: target.status,
      expiresAt: new Date(this.clock() + RECIPIENT_LOOKUP_TTL_MS).toISOString(),
    };
    this.recipientLookups.set(hashOpaqueToken(lookupId), lookup);
    this.recordAudit("INTERNAL_RECIPIENT_LOOKED_UP", userId, target.accountId);
    return { ...lookup };
  }

  listBeneficiaries(userId: string): Beneficiary[] {
    return (this.beneficiaries.get(userId) ?? []).map(toPublicBeneficiary);
  }

  createBeneficiary(userId: string, input: BeneficiaryInput): Beneficiary {
    const displayName = requireBoundedString(input.displayName, "displayName", 80);
    const accountNumber = normalizeAccountNumber(input.accountNumber);
    const target = this.core.findPaymentAccountByNumber(accountNumber);
    if (target.ownerId === userId) {
      throw conflict("Không thể lưu chính tài khoản của mình vào danh bạ.");
    }
    if (target.status !== "ACTIVE") {
      throw conflict("Tài khoản người nhận không hoạt động.");
    }
    const owner = this.users.get(target.ownerId);
    if (!owner) {
      throw notFound("Recipient owner not found.");
    }
    const bankName = target.bankName;
    const beneficiaries = this.beneficiaries.get(userId) ?? [];

    const accountNumberFingerprint = fingerprint(accountNumber);
    if (
      beneficiaries.some(
        (beneficiary) =>
          beneficiary.destinationAccountId === target.accountId,
      )
    ) {
      throw conflict("Beneficiary already exists.");
    }

    const beneficiary: BeneficiaryRecord = {
      id: createId("beneficiary"),
      displayName,
      accountHolderName: owner.fullName,
      maskedAccountNumber: maskAccountNumber(accountNumber),
      bankName,
      status: "ACTIVE",
      accountNumberFingerprint,
      destinationAccountId: target.accountId,
      destinationOwnerId: target.ownerId,
    };
    beneficiaries.push(beneficiary);
    this.beneficiaries.set(userId, beneficiaries);
    this.recordAudit("BENEFICIARY_CREATED", userId, beneficiary.id);
    return toPublicBeneficiary(beneficiary);
  }

  renameBeneficiary(
    userId: string,
    beneficiaryId: string,
    displayName: string,
  ): Beneficiary {
    const beneficiary = this.beneficiaries
      .get(userId)
      ?.find((item) => item.id === beneficiaryId);
    if (!beneficiary) {
      throw notFound("Beneficiary not found.");
    }
    beneficiary.displayName = requireBoundedString(displayName, "displayName", 80);
    this.recordAudit("BENEFICIARY_RENAMED", userId, beneficiary.id);
    return toPublicBeneficiary(beneficiary);
  }

  deleteBeneficiary(userId: string, beneficiaryId: string): void {
    const beneficiaries = this.beneficiaries.get(userId) ?? [];
    const index = beneficiaries.findIndex((item) => item.id === beneficiaryId);
    if (index < 0) {
      throw notFound("Beneficiary not found.");
    }

    const [deleted] = beneficiaries.splice(index, 1);
    this.recordAudit("BENEFICIARY_DELETED", userId, deleted?.id ?? beneficiaryId);
  }

  createQuote(userId: string, input: QuoteRequest): TransferQuote {
    this.cleanupExpiredState();
    if (
      this.policy.globalKillSwitch ||
      !this.policy.transfersEnabled ||
      !this.isUserAllowlisted(userId)
    ) {
      throw conflict("Transfers are temporarily unavailable.");
    }

    const sourceAccountId = requireString(input.sourceAccountId, "sourceAccountId");
    const amountMinor = parseMoney(input.amount, "amount");
    if (amountMinor <= 0n || amountMinor > BigInt(this.policy.maxTransferAmountMinor)) {
      throw conflict("Transfer amount is outside the sandbox limit.");
    }

    this.core.getPaymentAccount(userId, sourceAccountId);
    const lookupId = input.lookupId?.trim();
    const beneficiaryId = input.beneficiaryId?.trim();
    if ((!lookupId && !beneficiaryId) || (lookupId && beneficiaryId)) {
      throw invalidRequest("Exactly one recipient reference is required.", {
        lookupId: "Provide lookupId or beneficiaryId, but not both.",
      });
    }

    let beneficiary: Beneficiary;
    let destinationAccountId: string;
    let destinationOwnerId: string;
    if (lookupId) {
      const lookup = this.recipientLookups.get(hashOpaqueToken(lookupId));
      if (
        !lookup ||
        lookup.userId !== userId ||
        Date.parse(lookup.expiresAt) <= this.clock()
      ) {
        throw conflict("Recipient lookup has expired or is invalid.");
      }
      beneficiary = {
        id: lookup.lookupId,
        displayName: lookup.accountHolderName,
        accountHolderName: lookup.accountHolderName,
        maskedAccountNumber: lookup.maskedAccountNumber,
        bankName: lookup.bankName,
        status: lookup.status,
      };
      destinationAccountId = lookup.destinationAccountId;
      destinationOwnerId = lookup.destinationOwnerId;
    } else {
      const beneficiaryRecord = this.beneficiaries
        .get(userId)
        ?.find((item) => item.id === beneficiaryId);
      if (!beneficiaryRecord) {
        throw notFound("Beneficiary not found.");
      }
      beneficiary = toPublicBeneficiary(beneficiaryRecord);
      destinationAccountId = beneficiaryRecord.destinationAccountId;
      destinationOwnerId = beneficiaryRecord.destinationOwnerId;
    }
    if (beneficiary.status !== "ACTIVE") {
      throw conflict("Beneficiary is not active.");
    }

    const feeMinor = 1_000n;
    const quote: TransferQuote = {
      quoteId: createId("quote"),
      sourceAccountId,
      beneficiary: { ...beneficiary },
      amount: toMoney(amountMinor),
      fee: toMoney(feeMinor),
      totalDebit: toMoney(amountMinor + feeMinor),
      expiresAt: new Date(this.clock() + QUOTE_TTL_MS).toISOString(),
    };
    this.quotes.set(quote.quoteId, {
      userId,
      quote: cloneQuote(quote),
      destinationAccountId,
      destinationOwnerId,
    });
    this.recordAudit("TRANSFER_QUOTED", userId, quote.quoteId);
    return cloneQuote(quote);
  }

  submitTransfer(
    userId: string,
    idempotencyKey: string,
    request: SubmitTransferRequest,
    deviceId?: string,
  ): TransferReceipt {
    this.cleanupExpiredState();
    const normalizedKey = requireString(idempotencyKey, "Idempotency-Key");
    const quoteId = requireString(request.quoteId, "quoteId");
    const requestFingerprint = fingerprint({ quoteId });
    const existing = this.idempotency.get(`${userId}:${normalizedKey}`);
    if (existing) {
      if (existing.fingerprint !== requestFingerprint) {
        throw conflict("Idempotency key was reused with a different request.");
      }
      return existing.receipt;
    }

    if (
      this.policy.globalKillSwitch ||
      !this.policy.transfersEnabled ||
      !this.isUserAllowlisted(userId)
    ) {
      throw conflict("Transfers are temporarily unavailable.");
    }

    const quoteRecord = this.quotes.get(quoteId);
    if (!quoteRecord || quoteRecord.userId !== userId) {
      throw notFound("Transfer quote not found.");
    }
    if (Date.parse(quoteRecord.quote.expiresAt) <= this.clock()) {
      throw conflict("Transfer quote has expired.");
    }
    if (quoteRecord.consumedTransferId) {
      throw conflict("Transfer quote has already been submitted.");
    }

    const stepUpRateKey = `transfer-step-up:${userId}`;
    this.assertTransferStepUpAttemptAllowed(stepUpRateKey);
    const stepUp = request.stepUp;
    if (
      !stepUp ||
      (stepUp.method !== "OTP" && stepUp.method !== "BIOMETRIC") ||
      typeof stepUp.proof !== "string" ||
      !stepUp.proof.trim()
    ) {
      this.recordTransferStepUpFailure(stepUpRateKey);
      throw invalidRequest("stepUp proof is required.");
    }
    if (!this.policy.stepUpMethods.includes(stepUp.method)) {
      throw conflict("The requested step-up method is not enabled.");
    }
    const transferContextFingerprint = fingerprint({
      quoteId,
      amountMinor: quoteRecord.quote.amount.amountMinor,
      destinationAccountId: quoteRecord.destinationAccountId,
    });
    try {
      if (stepUp.challengeId) {
        this.verifyOtpChallenge(
          stepUp.challengeId,
          userId,
          deviceId,
          stepUp.method,
          stepUp.proof,
          "TRANSFER",
          quoteId,
          transferContextFingerprint,
        );
      } else if (
        !(
          (stepUp.method === "OTP" && this.sandboxOtp && stepUp.proof === this.sandboxOtp) ||
          (stepUp.method === "BIOMETRIC" && stepUp.proof === "sandbox-biometric")
        )
      ) {
        throw unauthorized("Step-up verification failed.");
      }
    } catch (error) {
      this.recordTransferStepUpFailure(stepUpRateKey);
      this.recordAudit("STEP_UP_VERIFICATION_FAILED", userId, quoteRecord.quote.quoteId);
      throw error;
    }

    this.transferStepUpAttemptWindows.delete(stepUpRateKey);
    this.recordAudit("TRANSFER_STEP_UP_VERIFIED", userId, quoteRecord.quote.quoteId);

    const receipt = this.core.postTransfer(userId, {
      accountId: quoteRecord.quote.sourceAccountId,
      destinationAccountId: quoteRecord.destinationAccountId,
      destinationOwnerId: quoteRecord.destinationOwnerId,
      amountMinor: BigInt(quoteRecord.quote.amount.amountMinor),
      feeMinor: BigInt(quoteRecord.quote.fee.amountMinor),
      counterpartyName: quoteRecord.quote.beneficiary.displayName,
      description: `Chuyển tiền đến ${quoteRecord.quote.beneficiary.displayName}`,
      now: nowIso(this.clock),
      settleImmediately: this.settleTransfersImmediately,
    });
    const transferTarget = this.core.getTransferTarget(userId, receipt.transferId);
    quoteRecord.consumedTransferId = receipt.transferId;
    this.transfers.set(receipt.transferId, { userId, receipt });
    this.idempotency.set(`${userId}:${normalizedKey}`, {
      userId,
      fingerprint: requestFingerprint,
      receipt,
    });
    this.recordAudit("TRANSFER_SUBMITTED", userId, receipt.transferId);
    this.recordAudit(
      receipt.status === "PENDING" ? "TRANSFER_PENDING" : "TRANSFER_SUCCEEDED",
      userId,
      receipt.transferId,
    );
    this.enqueueOutbox(
      receipt.status === "PENDING" ? "TRANSFER_PENDING" : "TRANSFER_SUCCEEDED",
      receipt.transferId,
      receipt.updatedAt,
    );
    const transferParties = this.core.getTransferParties(receipt.transferId);
    this.notifications.get(userId)?.unshift({
      id: createId("notification"),
      type: "TRANSFER",
      title:
        receipt.status === "PENDING"
          ? "Chuyển tiền đang được xử lý"
          : "Chuyển tiền thành công",
      body:
        receipt.status === "PENDING"
          ? `Giao dịch ${receipt.reference} đang chờ core banking xử lý.`
          : `Giao dịch ${receipt.reference} đã được ghi nhận.`,
      resourceId: transferTarget.transactionId,
      resourceAccountId: transferTarget.accountId,
      read: false,
      createdAt: receipt.updatedAt,
    });
    if (receipt.status === "SUCCEEDED" && transferParties.destinationTransactionId) {
      this.notifications.get(transferParties.destinationOwnerId)?.unshift({
        id: createId("notification"),
        type: "TRANSFER",
        title: "Bạn vừa nhận được tiền",
        body: `Giao dịch ${receipt.reference} đã được ghi có vào tài khoản.`,
        resourceId: transferParties.destinationTransactionId,
        resourceAccountId: transferParties.destinationAccountId,
        read: false,
        createdAt: receipt.updatedAt,
      });
    }
    return receipt;
  }

  getTransfer(userId: string, transferId: string): TransferReceipt {
    const transfer = this.transfers.get(transferId);
    if (!transfer || transfer.userId !== userId) {
      throw notFound("Transfer not found.");
    }
    return transfer.receipt;
  }

  settleTransfer(userId: string, transferId: string): TransferReceipt {
    return this.transitionTransfer(userId, transferId, "SUCCEEDED");
  }

  failTransfer(userId: string, transferId: string): TransferReceipt {
    return this.transitionTransfer(userId, transferId, "FAILED");
  }

  reverseTransfer(userId: string, transferId: string): TransferReceipt {
    return this.transitionTransfer(userId, transferId, "REVERSED");
  }

  private transitionTransfer(
    userId: string,
    transferId: string,
    status: TerminalTransferStatus,
  ): TransferReceipt {
    const transfer = this.transfers.get(transferId);
    if (!transfer || transfer.userId !== userId) {
      throw notFound("Transfer not found.");
    }

    if (transfer.receipt.status === status) {
      return transfer.receipt;
    }

    const transitioned = this.core.transitionTransfer(
      userId,
      transferId,
      status,
      nowIso(this.clock),
    );
    transfer.receipt = transitioned;
    const transferTarget = this.core.getTransferTarget(userId, transferId);
    const transferParties = this.core.getTransferParties(transferId);

    for (const record of this.idempotency.values()) {
      if (record.userId === userId && record.receipt.transferId === transferId) {
        record.receipt = transitioned;
      }
    }

    this.recordAudit(`TRANSFER_${status}`, userId, transferId);
    this.enqueueOutbox(`TRANSFER_${status}`, transferId, transitioned.updatedAt);
    this.notifications.get(userId)?.unshift({
      id: createId("notification"),
      type: "TRANSFER",
      title:
        status === "SUCCEEDED"
          ? "Chuyển tiền thành công"
          : status === "FAILED"
            ? "Chuyển tiền thất bại"
            : "Chuyển tiền đã hoàn tác",
      body:
        status === "SUCCEEDED"
          ? `Giao dịch ${transitioned.reference} đã được ghi nhận.`
          : `Giao dịch ${transitioned.reference} có trạng thái ${status}.`,
      resourceId: transferTarget.transactionId,
      resourceAccountId: transferTarget.accountId,
      read: false,
      createdAt: transitioned.updatedAt,
    });

    if (
      (status === "SUCCEEDED" || status === "REVERSED") &&
      transferParties.destinationTransactionId
    ) {
      this.notifications.get(transferParties.destinationOwnerId)?.unshift({
        id: createId("notification"),
        type: "TRANSFER",
        title:
          status === "SUCCEEDED"
            ? "Bạn vừa nhận được tiền"
            : "Giao dịch nhận tiền đã hoàn tác",
        body:
          status === "SUCCEEDED"
            ? `Giao dịch ${transitioned.reference} đã được ghi có vào tài khoản.`
            : `Giao dịch ${transitioned.reference} đã được hoàn tác trong sandbox.`,
        resourceId: transferParties.destinationTransactionId,
        resourceAccountId: transferParties.destinationAccountId,
        read: false,
        createdAt: transitioned.updatedAt,
      });
    }

    return transitioned;
  }

  getControlPolicy(userId?: string): ControlPolicy {
    return {
      ...this.policy,
      allowlisted:
        userId === undefined
          ? this.policy.allowlisted
          : this.isUserAllowlisted(userId),
      savingsAllowlisted:
        userId === undefined
          ? this.policy.savingsAllowlisted
          : this.isSavingsUserAllowlisted(userId),
      creditAllowlisted:
        userId === undefined
          ? this.policy.creditAllowlisted
          : this.policy.creditAllowlisted && this.allowlistPredicate(userId),
    };
  }

  getHealth(): ServiceHealth {
    this.cleanupExpiredState();
    const pendingOutboxEvents = this.outboxEventStore.filter(
      (event) => !event.published,
    ).length;
    const outboxStatus =
      pendingOutboxEvents > this.outboxPendingThreshold ? "degraded" : "ok";
    try {
      const reconciliation = this.core.reconcile();
      const hasMismatch = reconciliation.some(
        (row) => row.differenceMinor !== "0",
      );
      const hasCreditMismatch = this.reconcileCredit().some(
        (row) => row.differenceMinor !== "0",
      );
      const reconciliationStatus = hasMismatch ? "mismatch" : "ok";
      return {
        status: hasMismatch || hasCreditMismatch || outboxStatus === "degraded" ? "degraded" : "ok",
        checkedAt: nowIso(this.clock),
        reconciliation: hasMismatch || hasCreditMismatch ? "mismatch" : reconciliationStatus,
        outbox: outboxStatus,
        pendingOutboxEvents,
      };
    } catch {
      return {
        status: "degraded",
        checkedAt: nowIso(this.clock),
        reconciliation: "mismatch",
        outbox: "degraded",
        pendingOutboxEvents,
      };
    }
  }

  get auditEvents(): ReadonlyArray<Readonly<AuditEvent>> {
    return this.auditEventStore.map((event) => ({ ...event }));
  }

  get outboxEvents(): ReadonlyArray<Readonly<OutboxEvent>> {
    return this.outboxEventStore.map((event) => ({ ...event }));
  }

  retryOutbox(limit = 10): OutboxEvent[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw invalidRequest("limit must be an integer between 1 and 100.");
    }
    const now = this.clock();
    const ready = this.outboxEventStore
      .filter(
        (event) =>
          !event.published &&
          (!event.nextAttemptAt || Date.parse(event.nextAttemptAt) <= now),
      )
      .slice(0, limit);
    for (const event of ready) {
      event.attempts += 1;
      const delayMs = Math.min(60_000, 1_000 * 2 ** Math.min(event.attempts, 6));
      event.nextAttemptAt = new Date(now + delayMs).toISOString();
    }
    return ready.map((event) => ({ ...event }));
  }

  private createSavingsDepositFromOpening(
    quote: SavingsQuoteRecord,
    opening: SavingsOpeningRecord,
  ): SavingsDepositRecord {
    const existing = this.savingsDeposits.get(opening.depositId ?? "");
    if (existing) {
      return existing;
    }
    if (!opening.depositId) {
      throw invalidRequest("Savings opening is missing a deposit identifier.");
    }
    const deposit: SavingsDepositRecord = {
      depositId: opening.depositId,
      productId: quote.productId,
      productName: quote.productName,
      termsVersion: quote.termsVersion,
      termMonths: quote.termMonths,
      principal: { ...quote.principal },
      annualRateBasisPoints: quote.annualRateBasisPoints,
      expectedInterest: { ...quote.expectedInterest },
      totalAtMaturity: { ...quote.totalAtMaturity },
      openedAt: quote.openedAt,
      maturityAt: quote.maturityAt,
      maturityInstruction: quote.maturityInstruction,
      sourceAccountMaskedNumber: quote.sourceAccountMaskedNumber,
      status: "ACTIVE",
      reference: opening.reference ?? `SAV-${opening.openingId.slice(-12).toUpperCase()}`,
      updatedAt: opening.updatedAt,
      renewedDepositId: null,
      userId: opening.userId,
      sourceAccountId: quote.sourceAccountId,
      openingId: opening.openingId,
    };
    this.savingsDeposits.set(deposit.depositId, deposit);
    return deposit;
  }

  private processSavingsMaturities(userId: string): void {
    const now = this.clock();
    const dueDeposits = [...this.savingsDeposits.values()].filter(
      (deposit) =>
        deposit.userId === userId &&
        deposit.status === "ACTIVE" &&
        Date.parse(deposit.maturityAt) <= now,
    );
    for (const deposit of dueDeposits) {
      const principalMinor = BigInt(deposit.principal.amountMinor);
      const interestMinor = BigInt(deposit.expectedInterest.amountMinor);
      const renews = deposit.maturityInstruction !== "RETURN_PRINCIPAL_AND_INTEREST";
      const newDepositId = renews ? createId("savings-deposit") : undefined;
      const newPrincipalMinor = renews
        ? deposit.maturityInstruction === "RENEW_PRINCIPAL"
          ? principalMinor
          : principalMinor + interestMinor
        : 0n;
      const creditToPaymentMinor =
        deposit.maturityInstruction === "RETURN_PRINCIPAL_AND_INTEREST"
          ? principalMinor + interestMinor
          : deposit.maturityInstruction === "RENEW_PRINCIPAL"
            ? interestMinor
            : 0n;
      const maturityInput: CoreSavingsMaturityInput = {
        depositId: deposit.depositId,
        newDepositId,
        accountId: deposit.sourceAccountId,
        principalMinor,
        interestMinor,
        creditToPaymentMinor,
        newSavingsPrincipalMinor: newPrincipalMinor,
        now: nowIso(this.clock),
        description: "Tất toán tiền gửi tiết kiệm sandbox",
      };
      const receipt = this.core.postSavingsMaturity(userId, maturityInput);

      deposit.status = renews ? "CLOSED" : "MATURED";
      deposit.renewedDepositId = newDepositId ?? null;
      deposit.updatedAt = receipt.occurredAt;
      if (newDepositId) {
        const openedAt = deposit.maturityAt;
        const maturityAt = addMonthsClamped(openedAt, deposit.termMonths);
        const interestDays = calculateActualDays(openedAt, maturityAt);
        const renewedInterestMinor = calculateSavingsInterest(
          newPrincipalMinor,
          deposit.annualRateBasisPoints,
          interestDays,
        );
        this.savingsDeposits.set(newDepositId, {
          ...deposit,
          depositId: newDepositId,
          principal: toMoney(newPrincipalMinor),
          expectedInterest: toMoney(renewedInterestMinor),
          totalAtMaturity: toMoney(newPrincipalMinor + renewedInterestMinor),
          openedAt,
          maturityAt,
          status: "ACTIVE",
          reference: `SAV-${newDepositId.slice(-12).toUpperCase()}`,
          updatedAt: receipt.occurredAt,
          renewedDepositId: null,
          openingId: deposit.openingId,
        });
      }

      this.recordAudit("SAVINGS_MATURED", userId, deposit.depositId);
      this.enqueueOutbox("SAVINGS_MATURED", deposit.depositId, receipt.occurredAt);
      this.notifications.get(userId)?.unshift({
        id: createId("notification"),
        type: "SAVINGS",
        title: renews ? "Tiền gửi đã được tái tục" : "Tiền gửi đã đáo hạn",
        body: renews
          ? `Khoản ${deposit.reference} đã được tái tục theo chỉ thị đã chọn.`
          : `Khoản ${deposit.reference} đã chuyển tiền về tài khoản thanh toán.`,
        resourceId: newDepositId ?? deposit.depositId,
        resourceAccountId: deposit.sourceAccountId,
        read: false,
        createdAt: receipt.occurredAt,
      });
    }
  }

  private assertCreditVisible(userId: string): void {
    if (
      this.policy.globalKillSwitch ||
      !this.policy.creditEnabled ||
      !this.policy.creditAllowlisted ||
      !this.allowlistPredicate(userId)
    ) {
      throw conflictWithCode("CREDIT_DISABLED", "Tính năng tín dụng sandbox đang tạm dừng.");
    }
  }

  private assertCreditPaymentAvailable(userId: string): void {
    this.assertCreditVisible(userId);
    if (!this.policy.creditPaymentsEnabled) {
      throw conflictWithCode("CREDIT_DISABLED", "Thanh toán tín dụng sandbox đang tạm dừng.");
    }
  }

  private assertCardControlsAvailable(userId: string): void {
    this.assertCreditVisible(userId);
    if (!this.policy.cardControlsEnabled) {
      throw conflictWithCode("CARD_CONTROLS_DISABLED", "Quản lý trạng thái thẻ đang tạm dừng.");
    }
  }

  private requireCard(userId: string, cardId: string): CreditCardRecord {
    const card = this.creditCards.get(requireString(cardId, "cardId"));
    if (!card || card.userId !== userId) {
      throw notFound("Credit card not found.");
    }
    return card;
  }

  private requireCreditAccount(userId: string, creditAccountId: string): CreditAccountRecord {
    const account = this.creditAccounts.get(requireString(creditAccountId, "creditAccountId"));
    if (!account || account.userId !== userId) {
      throw conflictWithCode("CREDIT_ACCOUNT_NOT_FOUND", "Không tìm thấy tài khoản tín dụng.");
    }
    return account;
  }

  private findLatestCreditStatement(creditAccountId: string): CreditStatementRecord | null {
    return (
      [...this.creditStatements.values()]
        .filter((statement) => statement.creditAccountId === creditAccountId)
        .sort((left, right) => right.issuedAt.localeCompare(left.issuedAt))[0] ?? null
    );
  }

  private ensureCreditForUser(userId: string, now: string): void {
    const existing = [...this.creditAccounts.values()].some((account) => account.userId === userId);
    if (existing) {
      return;
    }
    const creditAccountId = newCreditId();
    const cardId = newCreditId();
    const statementId = newCreditId();
    const transactionId = newCreditId();
    const creditLimitMinor = BigInt(DEFAULT_CREDIT_LIMIT_MINOR);
    const openingOutstandingMinor = BigInt(DEFAULT_POSTED_OUTSTANDING_MINOR);
    const cycleStartAt = addCreditMonthsClamped(now, -1);
    const dueAt = this.creditOverdueSeed
      ? new Date(this.clock() - 1).toISOString()
      : addCreditDays(now, CREDIT_STATEMENT_DUE_DAYS);
    const account: CreditAccountRecord = {
      creditAccountId,
      customerId: userId,
      currency: "VND",
      creditLimit: creditMoney(creditLimitMinor),
      postedOutstanding: creditMoney(openingOutstandingMinor),
      pendingAuthorizations: creditMoney(0n),
      availableCredit: creditMoney(
        calculateAvailableCredit(creditLimitMinor, openingOutstandingMinor, 0n),
      ),
      nextStatementAt: nextCreditStatementCloseAt(now),
      status: "ACTIVE",
      version: 1,
      updatedAt: now,
      userId,
    };
    const card: CreditCardRecord = {
      cardId,
      creditAccountId,
      displayName: "Thẻ tín dụng sandbox",
      brand: "VISA",
      maskedNumber: `•••• ${DEFAULT_CARD_LAST_FOUR}`,
      lastFour: DEFAULT_CARD_LAST_FOUR,
      expiryMonth: 12,
      expiryYear: 30,
      status: "ACTIVE",
      updatedAt: now,
      userId,
    };
    const transaction: CreditTransactionRecord = {
      transactionId,
      creditAccountId,
      statementId,
      type: "PURCHASE",
      status: "POSTED",
      description: "Dư nợ seed tín dụng sandbox",
      merchantName: "Merchant sandbox",
      amount: creditMoney(openingOutstandingMinor),
      debtEffect: "INCREASE",
      occurredAt: addCreditDays(now, -5),
      postedAt: addCreditDays(now, -5),
      userId,
    };
    const statement: CreditStatementRecord = {
      statementId,
      creditAccountId,
      cycleStartAt,
      cycleEndAt: now,
      issuedAt: now,
      dueAt,
      openingBalance: creditMoney(0n),
      purchaseTotal: creditMoney(openingOutstandingMinor),
      refundTotal: creditMoney(0n),
      feeTotal: creditMoney(0n),
      interestTotal: creditMoney(0n),
      closingBalance: creditMoney(openingOutstandingMinor),
      remainingAmountDue: creditMoney(openingOutstandingMinor),
      minimumPaymentDue: creditMoney(calculateMinimumPayment(openingOutstandingMinor)),
      minimumPaymentRemaining: creditMoney(calculateMinimumPayment(openingOutstandingMinor)),
      paidAmount: creditMoney(0n),
      status: "ISSUED",
      version: 1,
      items: [cloneCreditTransaction(transaction)],
      payments: [],
      userId,
    };
    this.core.seedCreditPurchase(creditAccountId, openingOutstandingMinor, now);
    this.creditAccounts.set(creditAccountId, account);
    this.creditCards.set(cardId, card);
    this.creditTransactions.set(transactionId, transaction);
    this.creditStatements.set(statementId, statement);
    this.creditSeedPurchases.set(creditAccountId, {
      userId,
      creditAccountId,
      transactionId,
    });
    this.recordAudit("CREDIT_ACCOUNT_SEEDED", userId, creditAccountId);
  }

  private refreshCreditStatementStatus(statement: CreditStatementRecord): void {
    const nextStatus = getStatementStatus(
      BigInt(statement.remainingAmountDue.amountMinor),
      BigInt(statement.paidAmount.amountMinor),
      statement.dueAt,
      this.clock(),
    );
    if (nextStatus === statement.status) {
      return;
    }
    const previousStatus = statement.status;
    statement.status = nextStatus;
    statement.version += 1;
    if (nextStatus === "OVERDUE" && previousStatus !== "OVERDUE") {
      const card = [...this.creditCards.values()].find(
        (item) => item.creditAccountId === statement.creditAccountId && item.userId === statement.userId,
      );
      if (card) {
        const occurredAt = nowIso(this.clock);
        this.notifications.get(statement.userId)?.unshift({
          id: createId("notification"),
          type: "CREDIT",
          title: "Sao kê thẻ đã quá hạn",
          body: `Sao kê ${statement.statementId.slice(-8)} còn nghĩa vụ thanh toán trong sandbox.`,
          resourceId: card.cardId,
          resourceAccountId: null,
          read: false,
          createdAt: occurredAt,
        });
        this.enqueueOutbox("CREDIT_STATEMENT_OVERDUE", statement.statementId, occurredAt);
      }
    }
  }

  private processCreditStatements(userId: string): void {
    const now = this.clock();
    for (const account of [...this.creditAccounts.values()].filter((item) => item.userId === userId)) {
      for (let iteration = 0; iteration < 24 && Date.parse(account.nextStatementAt) <= now; iteration += 1) {
        const cycleEndAt = account.nextStatementAt;
        const previous = this.findLatestCreditStatement(account.creditAccountId);
        const cycleStartAt = previous?.cycleEndAt ?? addCreditMonthsClamped(cycleEndAt, -1);
        const items = [...this.creditTransactions.values()].filter(
          (transaction) =>
            transaction.userId === userId &&
            transaction.creditAccountId === account.creditAccountId &&
            transaction.statementId === null &&
            transaction.status === "POSTED" &&
            transaction.postedAt !== null &&
            Date.parse(transaction.postedAt) > Date.parse(cycleStartAt) &&
            Date.parse(transaction.postedAt) <= Date.parse(cycleEndAt),
        );
        const purchaseTotal = items
          .filter((item) => item.type === "PURCHASE" || item.debtEffect === "INCREASE")
          .reduce((total, item) => total + BigInt(item.amount.amountMinor), 0n);
        const refundTotal = items
          .filter((item) => item.type === "REFUND" || item.debtEffect === "DECREASE")
          .reduce((total, item) => total + BigInt(item.amount.amountMinor), 0n);
        const feeTotal = items
          .filter((item) => item.type === "FEE")
          .reduce((total, item) => total + BigInt(item.amount.amountMinor), 0n);
        const interestTotal = items
          .filter((item) => item.type === "INTEREST")
          .reduce((total, item) => total + BigInt(item.amount.amountMinor), 0n);
        const openingBalance = previous
          ? BigInt(previous.remainingAmountDue.amountMinor)
          : BigInt(account.postedOutstanding.amountMinor);
        const calculatedClosingBalance = openingBalance + purchaseTotal + feeTotal + interestTotal - refundTotal;
        const closingBalance = calculatedClosingBalance > 0n ? calculatedClosingBalance : 0n;
        const statement: CreditStatementRecord = {
          statementId: newCreditId(),
          creditAccountId: account.creditAccountId,
          cycleStartAt,
          cycleEndAt,
          issuedAt: cycleEndAt,
          dueAt: addCreditDays(cycleEndAt, CREDIT_STATEMENT_DUE_DAYS),
          openingBalance: creditMoney(openingBalance),
          purchaseTotal: creditMoney(purchaseTotal),
          refundTotal: creditMoney(refundTotal),
          feeTotal: creditMoney(feeTotal),
          interestTotal: creditMoney(interestTotal),
          closingBalance: creditMoney(closingBalance),
          remainingAmountDue: creditMoney(closingBalance),
          minimumPaymentDue: creditMoney(calculateMinimumPayment(closingBalance)),
          minimumPaymentRemaining: creditMoney(calculateMinimumPayment(closingBalance)),
          paidAmount: creditMoney(0n),
          status: closingBalance > 0n ? "ISSUED" : "PAID",
          version: 1,
          items: items.map((item) => {
            item.statementId = statement.statementId;
            return cloneCreditTransaction(item);
          }),
          payments: [],
          userId,
        };
        this.creditStatements.set(statement.statementId, statement);
        account.nextStatementAt = nextCreditStatementCloseAt(cycleEndAt);
        account.version += 1;
        account.updatedAt = cycleEndAt;
        const card = [...this.creditCards.values()].find(
          (item) => item.userId === userId && item.creditAccountId === account.creditAccountId,
        );
        if (card) {
          const occurredAt = cycleEndAt;
          this.notifications.get(userId)?.unshift({
            id: createId("notification"),
            type: "CREDIT",
            title: "Sao kê thẻ tín dụng đã phát hành",
            body: `Sao kê ${statement.statementId.slice(-8)} đã sẵn sàng trong sandbox.`,
            resourceId: card.cardId,
            resourceAccountId: null,
            read: false,
            createdAt: occurredAt,
          });
          this.enqueueOutbox("CREDIT_STATEMENT_ISSUED", statement.statementId, occurredAt);
        }
      }
    }
    for (const statement of [...this.creditStatements.values()].filter((item) => item.userId === userId)) {
      this.refreshCreditStatementStatus(statement);
    }
  }

  private applyCreditPaymentSuccess(
    payment: CreditPaymentRecord,
    statement: CreditStatementRecord,
  ): void {
    if (payment.creditApplied) {
      return;
    }
    const account = this.requireCreditAccount(payment.userId, statement.creditAccountId);
    const amountMinor = BigInt(payment.amount.amountMinor);
    const currentOutstanding = BigInt(account.postedOutstanding.amountMinor);
    account.postedOutstanding = creditMoney(currentOutstanding - amountMinor);
    account.availableCredit = creditMoney(
      calculateAvailableCredit(
        BigInt(account.creditLimit.amountMinor),
        currentOutstanding - amountMinor,
        BigInt(account.pendingAuthorizations.amountMinor),
      ),
    );
    account.version += 1;
    account.updatedAt = payment.updatedAt;
    const remaining = BigInt(statement.remainingAmountDue.amountMinor) - amountMinor;
    const minimumRemaining = BigInt(statement.minimumPaymentRemaining.amountMinor) - amountMinor;
    statement.remainingAmountDue = creditMoney(remaining > 0n ? remaining : 0n);
    statement.minimumPaymentRemaining = creditMoney(minimumRemaining > 0n ? minimumRemaining : 0n);
    statement.paidAmount = creditMoney(BigInt(statement.paidAmount.amountMinor) + amountMinor);
    statement.version += 1;
    statement.status = getStatementStatus(
      BigInt(statement.remainingAmountDue.amountMinor),
      BigInt(statement.paidAmount.amountMinor),
      statement.dueAt,
      this.clock(),
    );
    const paymentIndex = statement.payments.findIndex((item) => item.paymentId === payment.paymentId);
    const publicPayment = toPublicCreditPayment(payment);
    if (paymentIndex >= 0) statement.payments[paymentIndex] = publicPayment;
    else statement.payments.push(publicPayment);
    const paymentTransaction = [...this.creditTransactions.values()].find(
      (item) => item.paymentId === payment.paymentId,
    );
    if (paymentTransaction) {
      paymentTransaction.status = "POSTED";
      paymentTransaction.postedAt = payment.updatedAt;
    }
    payment.creditApplied = true;
  }

  private applyCreditPaymentReversal(payment: CreditPaymentRecord): void {
    if (!payment.creditApplied) {
      return;
    }
    const account = this.requireCreditAccount(payment.userId, payment.creditAccountId);
    const amountMinor = BigInt(payment.amount.amountMinor);
    const currentOutstanding = BigInt(account.postedOutstanding.amountMinor);
    account.postedOutstanding = creditMoney(currentOutstanding + amountMinor);
    account.availableCredit = creditMoney(
      calculateAvailableCredit(
        BigInt(account.creditLimit.amountMinor),
        currentOutstanding + amountMinor,
        BigInt(account.pendingAuthorizations.amountMinor),
      ),
    );
    account.version += 1;
    account.updatedAt = payment.updatedAt;
    const statement = this.creditStatements.get(payment.statementId);
    if (statement) {
      statement.remainingAmountDue = creditMoney(BigInt(statement.remainingAmountDue.amountMinor) + amountMinor);
      const paidAfterReversal = BigInt(statement.paidAmount.amountMinor) - amountMinor;
      statement.paidAmount = creditMoney(paidAfterReversal > 0n ? paidAfterReversal : 0n);
      const minimumRemaining = BigInt(statement.minimumPaymentRemaining.amountMinor) + amountMinor;
      statement.minimumPaymentRemaining = creditMoney(
        minimumRemaining < BigInt(statement.minimumPaymentDue.amountMinor)
          ? minimumRemaining
          : BigInt(statement.minimumPaymentDue.amountMinor),
      );
      statement.version += 1;
      statement.status = getStatementStatus(
        BigInt(statement.remainingAmountDue.amountMinor),
        BigInt(statement.paidAmount.amountMinor),
        statement.dueAt,
        this.clock(),
      );
      statement.payments = statement.payments.filter((item) => item.paymentId !== payment.paymentId);
    }
    payment.creditApplied = false;
  }

  private transitionCreditPayment(
    userId: string,
    paymentId: string,
    status: Exclude<CreditPayment["status"], "PENDING">,
  ): CreditPayment {
    const payment = this.creditPayments.get(paymentId);
    if (!payment || payment.userId !== userId) {
      throw notFound("Credit payment not found.");
    }
    const isReversal = payment.status === "SUCCEEDED" && status === "REVERSED";
    if (payment.status !== "PENDING" && !isReversal) {
      if (payment.status === status) return toPublicCreditPayment(payment);
      throw conflictWithCode("PAYMENT_STATE_INVALID", "Thanh toán tín dụng đã ở trạng thái kết thúc.");
    }
    const receipt = isReversal
      ? this.core.transitionCreditPayment(userId, paymentId, "REVERSED", nowIso(this.clock))
      : status === "SUCCEEDED"
        ? this.core.settleCreditPayment(userId, paymentId, nowIso(this.clock))
        : this.core.transitionCreditPayment(userId, paymentId, status, nowIso(this.clock));
    payment.status = receipt.status;
    payment.updatedAt = receipt.updatedAt;
    payment.failureReason = receipt.status === "FAILED" ? "SANDBOX_SETTLEMENT_FAILED" : null;
    const statement = this.creditStatements.get(payment.statementId);
    if (!statement) {
      throw notFound("Credit statement not found.");
    }
    if (receipt.status === "SUCCEEDED") {
      this.applyCreditPaymentSuccess(payment, statement);
    } else if (receipt.status === "REVERSED") {
      this.applyCreditPaymentReversal(payment);
    }
    const paymentTransaction = [...this.creditTransactions.values()].find(
      (item) => item.paymentId === payment.paymentId,
    );
    if (paymentTransaction) {
      paymentTransaction.status =
        receipt.status === "SUCCEEDED"
          ? "POSTED"
          : receipt.status === "FAILED"
            ? "DECLINED"
            : "REVERSED";
      paymentTransaction.postedAt = receipt.status === "SUCCEEDED" ? receipt.updatedAt : paymentTransaction.postedAt;
    }
    this.recordAudit(`CREDIT_PAYMENT_${receipt.status}`, userId, paymentId);
    this.enqueueOutbox(`CREDIT_PAYMENT_${receipt.status}`, paymentId, receipt.updatedAt);
    return toPublicCreditPayment(payment);
  }

  private verifyCreditStepUp(
    userId: string,
    stepUp: { method: StepUpMethod; proof: string; challengeId?: string } | undefined,
    resourceId: string,
    allowedMethods = this.policy.creditPaymentStepUpMethods,
    deviceId?: string,
    purpose: OtpPurpose = "CREDIT_PAYMENT",
    requestFingerprint: string | null = null,
  ): void {
    const key = `credit-step-up:${userId}`;
    const current = this.creditStepUpAttemptWindows.get(key);
    if (current && this.clock() - current.startedAt < AUTH_RATE_LIMIT_WINDOW_MS && current.attempts >= TRANSFER_STEP_UP_RATE_LIMIT_MAX_ATTEMPTS) {
      throw rateLimited("Too many credit payment step-up attempts.");
    }
    if (current && this.clock() - current.startedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
      this.creditStepUpAttemptWindows.delete(key);
    }
    if (
      !stepUp ||
      (stepUp.method !== "OTP" && stepUp.method !== "BIOMETRIC") ||
      typeof stepUp.proof !== "string" ||
      !stepUp.proof.trim()
    ) {
      this.recordCreditStepUpFailure(key);
      throw invalidRequest("stepUp proof is required.");
    }
    if (!allowedMethods.includes(stepUp.method)) {
      throw conflictWithCode("STEP_UP_INVALID", "Phương thức xác thực bước hai không được bật.");
    }
    try {
      if (stepUp.challengeId) {
        this.verifyOtpChallenge(
          stepUp.challengeId,
          userId,
          deviceId,
          stepUp.method,
          stepUp.proof,
          purpose,
          resourceId,
          requestFingerprint,
        );
      } else if (
        !(
          (stepUp.method === "OTP" && this.sandboxOtp && stepUp.proof === this.sandboxOtp) ||
          (stepUp.method === "BIOMETRIC" && stepUp.proof === "sandbox-biometric")
        )
      ) {
        throw unauthorized("Step-up verification failed.");
      }
    } catch (error) {
      this.recordCreditStepUpFailure(key);
      this.recordAudit("CREDIT_STEP_UP_VERIFICATION_FAILED", userId, resourceId);
      throw error;
    }
    this.creditStepUpAttemptWindows.delete(key);
    this.recordAudit("CREDIT_STEP_UP_VERIFIED", userId, resourceId);
  }

  private recordCreditStepUpFailure(key: string): void {
    const current = this.creditStepUpAttemptWindows.get(key);
    if (!current || this.clock() - current.startedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
      this.creditStepUpAttemptWindows.set(key, { startedAt: this.clock(), attempts: 1 });
      return;
    }
    current.attempts += 1;
    if (current.attempts >= TRANSFER_STEP_UP_RATE_LIMIT_MAX_ATTEMPTS) {
      throw rateLimited("Too many credit payment step-up attempts.");
    }
  }

  private assertSavingsAvailable(userId: string): void {
    if (
      this.policy.globalKillSwitch ||
      !this.policy.savingsEnabled ||
      !this.isSavingsUserAllowlisted(userId)
    ) {
      throw conflict("Savings sandbox is temporarily unavailable.");
    }
  }

  private isSavingsUserAllowlisted(userId: string): boolean {
    return this.policy.savingsAllowlisted && this.allowlistPredicate(userId);
  }

  markOutboxPublished(eventId: string): OutboxEvent {
    const event = this.outboxEventStore.find((item) => item.id === eventId);
    if (!event) {
      throw notFound("Outbox event not found.");
    }
    event.published = true;
    event.nextAttemptAt = null;
    return { ...event };
  }

  exportState(): BankingSystemState {
    if (!(this.core instanceof InMemoryCoreBanking)) {
      throw new Error("Persistent sandbox requires an InMemoryCoreBanking instance.");
    }

    return {
      stateVersion: BANKING_SYSTEM_STATE_VERSION,
      core: this.core.exportState(),
      users: [...this.users.entries()].map(([userId, user]) => [userId, { ...user }]),
      accessSessions: [...this.accessSessions.entries()].map(([hash, session]) => [hash, { ...session }]),
      authChallenges: [...this.authChallenges.entries()].map(([hash, challenge]) => [hash, { ...challenge, methods: [...challenge.methods] }]),
      authAttemptWindows: [...this.authAttemptWindows.entries()].map(([key, window]) => [key, { ...window }]),
      registrationAttemptWindows: [...this.registrationAttemptWindows.entries()].map(([key, window]) => [key, { ...window }]),
      transferStepUpAttemptWindows: [...this.transferStepUpAttemptWindows.entries()].map(([key, window]) => [key, { ...window }]),
      savingsStepUpAttemptWindows: [...this.savingsStepUpAttemptWindows.entries()].map(([key, window]) => [key, { ...window }]),
      creditStepUpAttemptWindows: [...this.creditStepUpAttemptWindows.entries()].map(([key, window]) => [key, { ...window }]),
      refreshSessions: [...this.refreshSessions.entries()].map(([hash, session]) => [hash, { ...session }]),
      refreshFamilies: [...this.refreshFamilies.entries()].map(([familyId, tokenHashes]) => [familyId, [...tokenHashes]]),
      beneficiaries: [...this.beneficiaries.entries()].map(([userId, items]) => [
        userId,
        items.map((item) => ({ ...item })),
      ]),
      recipientLookups: [...this.recipientLookups.entries()].map(([key, item]) => [
        key,
        { ...item },
      ]),
      notifications: [...this.notifications.entries()].map(([userId, items]) => [
        userId,
        items.map((item) => ({ ...item })),
      ]),
      quotes: [...this.quotes.entries()].map(([quoteId, record]) => [
        quoteId,
        { ...record, quote: cloneQuote(record.quote) },
      ]),
      transfers: [...this.transfers.entries()].map(([transferId, record]) => [
        transferId,
        { userId: record.userId, receipt: cloneReceipt(record.receipt) },
      ]),
      idempotency: [...this.idempotency.entries()].map(([key, record]) => [
        key,
        { ...record, receipt: cloneReceipt(record.receipt) },
      ]),
      fundingIdempotency: [...this.fundingIdempotency.entries()].map(([key, record]) => [
        key,
        { ...record, receipt: { ...record.receipt, amount: { ...record.receipt.amount } } },
      ]),
      savingsQuotes: [...this.savingsQuotes.entries()].map(([quoteId, record]) => [
        quoteId,
        cloneSavingsQuote(record),
      ]),
      savingsOpenings: [...this.savingsOpenings.entries()].map(([openingId, record]) => [
        openingId,
        cloneSavingsOpeningRecord(record),
      ]),
      savingsDeposits: [...this.savingsDeposits.entries()].map(([depositId, record]) => [
        depositId,
        cloneSavingsDeposit(record),
      ]),
      savingsIdempotency: [...this.savingsIdempotency.entries()].map(([key, record]) => [
        key,
        { ...record },
      ]),
      creditCards: [...this.creditCards.entries()].map(([cardId, record]) => [cardId, { ...record }]),
      creditAccounts: [...this.creditAccounts.entries()].map(([accountId, record]) => [
        accountId,
        { ...record, ...cloneCreditAccount(record) },
      ]),
      creditTransactions: [...this.creditTransactions.entries()].map(([transactionId, record]) => [
        transactionId,
        { ...record, ...cloneCreditTransaction(record) },
      ]),
      creditStatements: [...this.creditStatements.entries()].map(([statementId, record]) => [
        statementId,
        { ...record, ...cloneCreditStatement(record) },
      ]),
      creditQuotes: [...this.creditQuotes.entries()].map(([quoteId, record]) => [
        quoteId,
        { ...record, ...cloneCreditQuote(record) },
      ]),
      creditPayments: [...this.creditPayments.entries()].map(([paymentId, record]) => [
        paymentId,
        { ...record, ...cloneCreditPayment(record) },
      ]),
      creditIdempotency: [...this.creditIdempotency.entries()].map(([key, record]) => [key, { ...record }]),
      creditSeedPurchases: [...this.creditSeedPurchases.entries()].map(([key, record]) => [key, { ...record }]),
      auditEventStore: this.auditEventStore.map((event) => ({ ...event })),
      outboxEventStore: this.outboxEventStore.map((event) => ({ ...event })),
    };
  }

  importState(rawState: BankingSystemState): void {
    if (!(this.core instanceof InMemoryCoreBanking)) {
      throw new Error("Persistent sandbox requires an InMemoryCoreBanking instance.");
    }

    const state = migrateBankingSystemState(rawState);

    this.core.importState(state.core);
    this.users.clear();
    this.usersByEmail.clear();
    this.usersByPhone.clear();
    for (const [userId, user] of state.users) {
      this.users.set(userId, { ...user });
      this.usersByEmail.set(user.email, userId);
      this.usersByPhone.set(user.phoneNumber, userId);
    }
    this.accessSessions.clear();
    for (const [hash, session] of state.accessSessions) {
      this.accessSessions.set(hash, { ...session });
    }
    this.authChallenges.clear();
    this.sandboxOtpInbox.clear();
    for (const [hash, challenge] of state.authChallenges) {
      this.authChallenges.set(hash, {
        ...challenge,
        methods: [...challenge.methods],
        purpose: challenge.purpose ?? "LOGIN",
        resourceId: challenge.resourceId ?? null,
        requestFingerprint: challenge.requestFingerprint ?? null,
        otpHash:
          challenge.otpHash ??
          (challenge.purpose === "LOGIN" && (this.sandboxMfaOtp ?? this.sandboxOtp)
            ? hashOpaqueToken(this.sandboxMfaOtp ?? this.sandboxOtp!)
            : null),
      });
    }
    this.authAttemptWindows.clear();
    for (const [key, window] of state.authAttemptWindows) {
      this.authAttemptWindows.set(key, { ...window });
    }
    this.registrationAttemptWindows.clear();
    for (const [key, window] of state.registrationAttemptWindows) {
      this.registrationAttemptWindows.set(key, { ...window });
    }
    this.transferStepUpAttemptWindows.clear();
    for (const [key, window] of state.transferStepUpAttemptWindows) {
      this.transferStepUpAttemptWindows.set(key, { ...window });
    }
    this.savingsStepUpAttemptWindows.clear();
    for (const [key, window] of state.savingsStepUpAttemptWindows ?? []) {
      this.savingsStepUpAttemptWindows.set(key, { ...window });
    }
    this.creditStepUpAttemptWindows.clear();
    for (const [key, window] of state.creditStepUpAttemptWindows ?? []) {
      this.creditStepUpAttemptWindows.set(key, { ...window });
    }
    this.refreshSessions.clear();
    for (const [hash, session] of state.refreshSessions) {
      this.refreshSessions.set(hash, { ...session });
    }
    this.refreshFamilies.clear();
    for (const [familyId, tokenHashes] of state.refreshFamilies) {
      this.refreshFamilies.set(familyId, new Set(tokenHashes));
    }
    this.beneficiaries.clear();
    for (const [userId, items] of state.beneficiaries) {
      this.beneficiaries.set(
        userId,
        items.map((item) => ({
          ...item,
          accountHolderName: item.accountHolderName ?? item.displayName,
          destinationAccountId: item.destinationAccountId ?? "",
          destinationOwnerId: item.destinationOwnerId ?? "",
        })),
      );
    }
    this.recipientLookups.clear();
    for (const [key, item] of state.recipientLookups ?? []) {
      this.recipientLookups.set(key, { ...item });
    }
    this.notifications.clear();
    for (const [userId, items] of state.notifications) {
      this.notifications.set(
        userId,
        items.map((item) => ({
          ...item,
          resourceAccountId: item.resourceAccountId ?? null,
        })),
      );
    }
    this.quotes.clear();
    for (const [quoteId, record] of state.quotes) {
      this.quotes.set(quoteId, { ...record, quote: cloneQuote(record.quote) });
    }
    this.transfers.clear();
    for (const [transferId, record] of state.transfers) {
      this.transfers.set(transferId, {
        userId: record.userId,
        receipt: cloneReceipt(record.receipt),
      });
    }
    this.idempotency.clear();
    for (const [key, record] of state.idempotency) {
      this.idempotency.set(key, {
        ...record,
        receipt: cloneReceipt(record.receipt),
      });
    }
    this.fundingIdempotency.clear();
    for (const [key, record] of state.fundingIdempotency ?? []) {
      this.fundingIdempotency.set(key, {
        ...record,
        receipt: { ...record.receipt, amount: { ...record.receipt.amount } },
      });
    }
    this.savingsQuotes.clear();
    for (const [quoteId, record] of state.savingsQuotes ?? []) {
      this.savingsQuotes.set(quoteId, cloneSavingsQuote(record));
    }
    this.savingsOpenings.clear();
    for (const [openingId, record] of state.savingsOpenings ?? []) {
      this.savingsOpenings.set(openingId, cloneSavingsOpeningRecord(record));
    }
    this.savingsDeposits.clear();
    for (const [depositId, record] of state.savingsDeposits ?? []) {
      this.savingsDeposits.set(depositId, cloneSavingsDeposit(record));
    }
    this.savingsIdempotency.clear();
    for (const [key, record] of state.savingsIdempotency ?? []) {
      this.savingsIdempotency.set(key, { ...record });
    }
    this.creditCards.clear();
    for (const [cardId, record] of state.creditCards ?? []) {
      this.creditCards.set(cardId, { ...record });
    }
    this.creditAccounts.clear();
    for (const [accountId, record] of state.creditAccounts ?? []) {
      this.creditAccounts.set(accountId, { ...record, ...cloneCreditAccount(record) });
    }
    this.creditTransactions.clear();
    for (const [transactionId, record] of state.creditTransactions ?? []) {
      this.creditTransactions.set(transactionId, { ...record, ...cloneCreditTransaction(record) });
    }
    this.creditStatements.clear();
    for (const [statementId, record] of state.creditStatements ?? []) {
      this.creditStatements.set(statementId, { ...record, ...cloneCreditStatement(record) });
    }
    this.creditQuotes.clear();
    for (const [quoteId, record] of state.creditQuotes ?? []) {
      this.creditQuotes.set(quoteId, { ...record, ...cloneCreditQuote(record) });
    }
    this.creditPayments.clear();
    for (const [paymentId, record] of state.creditPayments ?? []) {
      this.creditPayments.set(paymentId, { ...record, ...cloneCreditPayment(record) });
    }
    this.creditIdempotency.clear();
    for (const [key, record] of state.creditIdempotency ?? []) {
      this.creditIdempotency.set(key, { ...record });
    }
    this.creditSeedPurchases.clear();
    for (const [key, record] of state.creditSeedPurchases ?? []) {
      this.creditSeedPurchases.set(key, { ...record });
    }
    this.auditEventStore.length = 0;
    this.auditEventStore.push(...state.auditEventStore.map((event) => ({ ...event })));
    this.outboxEventStore.length = 0;
    this.outboxEventStore.push(
      ...state.outboxEventStore.map((event) => ({
        ...event,
        attempts: event.attempts ?? 0,
        nextAttemptAt: event.nextAttemptAt ?? null,
      })),
    );
  }

  listNotifications(userId: string): Notification[] {
    return [...(this.notifications.get(userId) ?? [])].map((notification) => ({
      ...notification,
    }));
  }

  markNotificationRead(userId: string, notificationId: string): Notification {
    const notification = this.notifications
      .get(userId)
      ?.find((item) => item.id === notificationId);
    if (!notification) {
      throw notFound("Notification not found.");
    }
    notification.read = true;
    return { ...notification };
  }

  reportFraud(
    userId: string,
    accountId: string,
    transactionId: string,
    reason: string,
  ): FraudReportResponse {
    const normalizedReason = requireString(reason, "reason");
    if (normalizedReason.length < 5) {
      throw invalidRequest("reason must contain at least 5 characters.", {
        reason: "reason must contain at least 5 characters.",
      });
    }

    const transaction = this.core.getTransaction(userId, accountId, transactionId);
    const report: FraudReportResponse = {
      reportId: createId("fraud-report"),
      status: "RECEIVED",
      createdAt: nowIso(this.clock),
    };
    this.recordAudit("FRAUD_REPORT_CREATED", userId, transaction.id);
    this.enqueueOutbox("FRAUD_REPORT_CREATED", report.reportId, report.createdAt);
    return report;
  }

  reconcile() {
    const rows = this.core.reconcile();
    for (const row of rows) {
      if (row.differenceMinor !== "0") {
        this.recordAudit("RECONCILIATION_MISMATCH", null, row.accountId);
      }
    }
    return rows;
  }

  reconcileCredit(): Array<{
    creditAccountId: string;
    storedOutstandingMinor: string;
    expectedOutstandingMinor: string;
    differenceMinor: string;
  }> {
    return [...this.creditAccounts.values()].map((account) => {
      const stored = BigInt(account.postedOutstanding.amountMinor);
      const expected = -this.core.getLedgerNetBalance(`credit-receivable:${account.creditAccountId}`);
      const difference = stored - expected;
      if (difference !== 0n) {
        this.recordAudit("CREDIT_RECONCILIATION_MISMATCH", null, account.creditAccountId);
      }
      return {
        creditAccountId: account.creditAccountId,
        storedOutstandingMinor: stored.toString(),
        expectedOutstandingMinor: expected.toString(),
        differenceMinor: difference.toString(),
      };
    });
  }

  private issueTokenPair(
    user: UserRecord,
    familyId: string,
    deviceId: string,
  ): LoginResponse {
    const accessToken = createOpaqueToken();
    const refreshToken = createOpaqueToken();
    const now = this.clock();
    this.accessSessions.set(hashOpaqueToken(accessToken), {
      userId: user.id,
      familyId,
      deviceId,
      expiresAt: now + ACCESS_TOKEN_TTL_MS,
    });
    const refreshHash = hashOpaqueToken(refreshToken);
    this.refreshSessions.set(refreshHash, {
      userId: user.id,
      familyId,
      deviceId,
      expiresAt: now + REFRESH_TOKEN_TTL_MS,
      revoked: false,
    });
    const family = this.refreshFamilies.get(familyId) ?? new Set<string>();
    family.add(refreshHash);
    this.refreshFamilies.set(familyId, family);
    return {
      accessToken,
      refreshToken,
      expiresInSeconds: ACCESS_TOKEN_TTL_MS / 1000,
      user: this.publicUser(user),
    };
  }

  private issueAuthChallenge(
    userId: string,
    deviceId: string,
  ): AuthChallengeResponse {
    return this.issueOtpChallenge(
      userId,
      deviceId,
      "LOGIN",
      null,
      null,
      this.authChallengeMethods,
      this.sandboxMfaOtp ?? this.sandboxOtp,
    );
  }

  private issueOtpChallenge(
    userId: string,
    deviceId: string,
    purpose: OtpPurpose,
    resourceId: string | null,
    requestFingerprint: string | null,
    methods: readonly StepUpMethod[],
    fixedOtp?: string,
  ): AuthChallengeResponse {
    const challengeId = createOpaqueToken();
    const expiresAt = this.clock() + AUTH_CHALLENGE_TTL_MS;
    const challengeHash = hashOpaqueToken(challengeId);
    const otp = fixedOtp ?? createSandboxOtp();
    this.authChallenges.set(challengeHash, {
      userId,
      deviceId,
      expiresAt,
      methods: [...methods],
      attempts: 0,
      purpose,
      resourceId,
      requestFingerprint,
      otpHash: hashOpaqueToken(otp),
    });
    this.sandboxOtpInbox.set(challengeHash, otp);
    this.recordAudit("OTP_CHALLENGE_CREATED", userId, resourceId);
    return {
      challengeId,
      expiresAt: new Date(expiresAt).toISOString(),
      methods: [...methods],
      purpose,
    };
  }

  private verifyOtpChallenge(
    challengeId: string,
    userId: string,
    deviceId: string | undefined,
    method: StepUpMethod,
    proof: string,
    purpose: OtpPurpose,
    resourceId: string | null,
    requestFingerprint: string | null,
  ): void {
    const challengeHash = hashOpaqueToken(requireString(challengeId, "challengeId"));
    const challenge = this.authChallenges.get(challengeHash);
    if (!challenge || challenge.expiresAt <= this.clock()) {
      throw unauthorized("OTP challenge is invalid or expired.");
    }
    if (challenge.userId !== userId || challenge.deviceId !== this.normalizeDeviceId(deviceId)) {
      throw unauthorized("Device or user binding mismatch.");
    }
    if (
      challenge.purpose !== purpose ||
      challenge.resourceId !== resourceId ||
      challenge.requestFingerprint !== requestFingerprint
    ) {
      this.recordChallengeFailure(challengeHash, challenge);
      throw unauthorized("OTP challenge context mismatch.");
    }
    if (!challenge.methods.includes(method) || typeof proof !== "string" || !proof.trim()) {
      this.recordChallengeFailure(challengeHash, challenge);
      throw unauthorized("OTP challenge is invalid.");
    }
    const valid =
      method === "OTP"
        ? challenge.otpHash !== null && hashOpaqueToken(proof) === challenge.otpHash
        : proof === "sandbox-biometric";
    if (!valid) {
      this.recordChallengeFailure(challengeHash, challenge);
      throw unauthorized("OTP challenge verification failed.");
    }
    this.authChallenges.delete(challengeHash);
    this.sandboxOtpInbox.delete(challengeHash);
  }

  private cleanupExpiredState(): void {
    const now = this.clock();

    for (const [tokenHash, session] of this.accessSessions) {
      if (session.expiresAt <= now) {
        this.accessSessions.delete(tokenHash);
      }
    }
    for (const [tokenHash, session] of this.refreshSessions) {
      if (session.expiresAt <= now) {
        this.refreshSessions.delete(tokenHash);
      }
    }
    for (const [familyId, tokenHashes] of this.refreshFamilies) {
      for (const tokenHash of tokenHashes) {
        if (!this.refreshSessions.has(tokenHash)) {
          tokenHashes.delete(tokenHash);
        }
      }
      if (tokenHashes.size === 0) {
        this.refreshFamilies.delete(familyId);
      }
    }
    for (const [challengeHash, challenge] of this.authChallenges) {
      if (challenge.expiresAt <= now) {
        this.authChallenges.delete(challengeHash);
        this.sandboxOtpInbox.delete(challengeHash);
      }
    }
    for (const [lookupHash, lookup] of this.recipientLookups) {
      if (Date.parse(lookup.expiresAt) <= now) {
        this.recipientLookups.delete(lookupHash);
      }
    }
    for (const [key, window] of this.authAttemptWindows) {
      if (now - window.startedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
        this.authAttemptWindows.delete(key);
      }
    }
    for (const [key, window] of this.registrationAttemptWindows) {
      if (now - window.startedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
        this.registrationAttemptWindows.delete(key);
      }
    }
    for (const [key, window] of this.transferStepUpAttemptWindows) {
      if (now - window.startedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
        this.transferStepUpAttemptWindows.delete(key);
      }
    }
    for (const [key, window] of this.savingsStepUpAttemptWindows) {
      if (now - window.startedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
        this.savingsStepUpAttemptWindows.delete(key);
      }
    }
  }

  private normalizeDeviceId(deviceId: string | undefined): string {
    return deviceId?.trim() || DEFAULT_SANDBOX_DEVICE_ID;
  }

  private getLoginAttemptKeys(email: string, deviceId: string): string[] {
    return [`login:email:${email}`, `login:device:${deviceId}`];
  }

  private isUserAllowlisted(userId: string): boolean {
    return this.policy.allowlisted && this.allowlistPredicate(userId);
  }

  private assertAuthAttemptAllowed(key: string): void {
    const window = this.authAttemptWindows.get(key);
    if (!window) {
      return;
    }

    if (this.clock() - window.startedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
      this.authAttemptWindows.delete(key);
      return;
    }

    if (window.attempts >= AUTH_RATE_LIMIT_MAX_ATTEMPTS) {
      throw rateLimited("Too many authentication attempts.");
    }
  }

  private assertRegistrationAttemptAllowed(key: string): void {
    const window = this.registrationAttemptWindows.get(key);
    if (!window) {
      return;
    }

    if (this.clock() - window.startedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
      this.registrationAttemptWindows.delete(key);
      return;
    }

    if (window.attempts >= REGISTRATION_RATE_LIMIT_MAX_ATTEMPTS) {
      throw rateLimited("Too many registration attempts.");
    }
  }

  private recordRegistrationAttempt(key: string): void {
    const current = this.registrationAttemptWindows.get(key);
    if (!current || this.clock() - current.startedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
      this.registrationAttemptWindows.set(key, { startedAt: this.clock(), attempts: 1 });
      return;
    }

    current.attempts += 1;
  }

  private assertTransferStepUpAttemptAllowed(key: string): void {
    const window = this.transferStepUpAttemptWindows.get(key);
    if (!window) {
      return;
    }

    if (this.clock() - window.startedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
      this.transferStepUpAttemptWindows.delete(key);
      return;
    }

    if (window.attempts >= TRANSFER_STEP_UP_RATE_LIMIT_MAX_ATTEMPTS) {
      throw rateLimited("Too many transfer step-up attempts.");
    }
  }

  private assertSavingsStepUpAttemptAllowed(key: string): void {
    const window = this.savingsStepUpAttemptWindows.get(key);
    if (!window) {
      return;
    }
    if (this.clock() - window.startedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
      this.savingsStepUpAttemptWindows.delete(key);
      return;
    }
    if (window.attempts >= TRANSFER_STEP_UP_RATE_LIMIT_MAX_ATTEMPTS) {
      throw rateLimited("Too many savings step-up attempts.");
    }
  }

  private recordSavingsStepUpFailure(key: string): void {
    const current = this.savingsStepUpAttemptWindows.get(key);
    if (!current || this.clock() - current.startedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
      this.savingsStepUpAttemptWindows.set(key, {
        startedAt: this.clock(),
        attempts: 1,
      });
      return;
    }
    current.attempts += 1;
    if (current.attempts >= TRANSFER_STEP_UP_RATE_LIMIT_MAX_ATTEMPTS) {
      throw rateLimited("Too many savings step-up attempts.");
    }
  }

  private recordTransferStepUpFailure(key: string): void {
    const current = this.transferStepUpAttemptWindows.get(key);
    if (!current || this.clock() - current.startedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
      this.transferStepUpAttemptWindows.set(key, { startedAt: this.clock(), attempts: 1 });
      return;
    }

    current.attempts += 1;
    if (current.attempts >= TRANSFER_STEP_UP_RATE_LIMIT_MAX_ATTEMPTS) {
      throw rateLimited("Too many transfer step-up attempts.");
    }
  }

  private recordAuthFailure(key: string): void {
    const current = this.authAttemptWindows.get(key);
    if (!current || this.clock() - current.startedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
      this.authAttemptWindows.set(key, { startedAt: this.clock(), attempts: 1 });
      return;
    }

    current.attempts += 1;
  }

  private recordChallengeFailure(
    tokenHash: string,
    challenge: AuthChallengeRecord,
  ): void {
    challenge.attempts += 1;
    if (challenge.attempts >= AUTH_RATE_LIMIT_MAX_ATTEMPTS) {
      this.authChallenges.delete(tokenHash);
      throw rateLimited("Too many authentication challenge attempts.");
    }
  }

  private revokeFamily(familyId: string): void {
    for (const tokenHash of this.refreshFamilies.get(familyId) ?? []) {
      const session = this.refreshSessions.get(tokenHash);
      if (session) {
        session.revoked = true;
      }
    }

    for (const [accessHash, accessSession] of this.accessSessions) {
      if (accessSession.familyId === familyId) {
        this.accessSessions.delete(accessHash);
      }
    }
  }

  private publicUser(user: UserRecord): AuthUser {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      createdAt: user.createdAt,
    };
  }

  private toTransaction(transaction: TransactionDetail): Transaction {
    return {
      id: transaction.id,
      accountId: transaction.accountId,
      direction: transaction.direction,
      amount: transaction.amount,
      fee: transaction.fee,
      status: transaction.status,
      kind: transaction.kind,
      description: transaction.description,
      counterpartyName: transaction.counterpartyName,
      occurredAt: transaction.occurredAt,
    };
  }

  private enqueueOutbox(
    eventType: string,
    aggregateId: string,
    occurredAt: string,
  ): void {
    this.outboxEventStore.push({
      id: createId("outbox"),
      eventType,
      aggregateId,
      occurredAt,
      published: false,
      attempts: 0,
      nextAttemptAt: null,
    });
  }

  private recordAudit(eventType: string, actorUserId: string | null, resourceId: string | null): void {
    this.auditEventStore.push({
      id: createId("audit"),
      eventType,
      actorUserId,
      resourceId,
      occurredAt: nowIso(this.clock),
    });
  }
}

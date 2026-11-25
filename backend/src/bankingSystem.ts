import {
  DomainError,
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
} from "./services/coreBanking.js";
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
  type CreditApplication,
  type CreditApplicationRecord,
  type CreditApplicationRequest,
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
} from "./domain/credit/index.js";
import { parseMoney, toMoney } from "./domain/money.js";
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
  calculateEarlyWithdrawal,
  type SavingsDeposit,
  type SavingsDepositRecord,
  type SavingsOpening,
  type SavingsOpeningRecord,
  type SavingsProduct,
  type SavingsQuote,
  type SavingsQuoteRecord,
  type SavingsTermMonths,
  type SavingsWithdrawalReceipt,
} from "./domain/savings/index.js";
import {
  createId,
  createOpaqueToken,
  fingerprint,
  hashOpaqueToken,
  hashPassword,
  hashPasswordAsync,
  maskEmailAddress,
  validateStrongPassword,
  verifyPassword,
  verifyPasswordAsync,
} from "./security.js";
import {
  DeterministicOtpCodeGenerator,
  OtpDigestKeyring,
  SecureOtpCodeGenerator,
  generateBiometricSecret,
  type OtpCodeGenerator,
  verifyBiometricAssertion,
} from "./mfa/crypto.js";
import { NullEmailProvider, type VerificationCodeDeliveryPort } from "./mfa/delivery.js";
import {
  cloneAnomalyAssessment,
  cloneTransactionAnomaly,
  evaluateTransferAnomaly,
} from "./domain/anomaly/index.js";
import {
  buildAccountStatementExport,
  normalizeTransactionFilters,
  parseSummaryMonth,
} from "./database/relationalAccountReadService.js";
import type {
  AccountMonthlySummary,
  AccountStatementExport,
  AnomalyStatus,
  AuthUser,
  AuthChallengeResponse,
  Beneficiary,
  ControlPolicy,
  CustomerDeviceSummary,
  FundingReceipt,
  InternalRecipientLookup,
  LoginResponse,
  LoginResult,
  Money,
  Notification,
  OtpPurpose,
  PaymentAccount,
  Transaction,
  TransactionAnomaly,
  TransactionDetail,
  TransactionListFilters,
  TransferAnomalyAssessment,
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

// Retained only so snapshots created before removal can still be imported and
// exported without discarding their historical report data.
type FraudReportRecord = {
  reportId: string;
  status: "RECEIVED" | "IN_REVIEW" | "RESOLVED";
  createdAt: string;
  userId: string;
  accountId: string;
  transactionId: string;
  reason: string;
};

type FraudReportIdempotencyRecord = {
  userId: string;
  fingerprint: string;
  reportId: string;
};

type CreditStepUpAttemptWindow = { startedAt: number; attempts: number };

type CreditPurchaseSeed = {
  userId: string;
  creditAccountId: string;
  transactionId: string;
};

type CreditApplicationIdempotencyRecord = {
  userId: string;
  fingerprint: string;
  applicationId: string;
};

type CreditActivationIdempotencyRecord = {
  userId: string;
  fingerprint: string;
  applicationId: string;
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
  emailProvider?: {
    provider: "fake" | "disabled" | "http" | "smtp";
    status: "ok" | "disabled" | "degraded";
    configured: boolean;
    credentialConfigured: boolean;
    lastErrorCode?: string;
  };
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

export type ReferenceFundingRequest = {
  recipientAccountNumber: string;
  amount: Money;
  reason: string;
};

export type SubmitTransferRequest = {
  quoteId: string;
  confirmHighRisk?: boolean;
  stepUp: {
    method: "OTP" | "TOTP" | "BIOMETRIC";
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
    method: "OTP" | "TOTP" | "BIOMETRIC";
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

type StepUpMethod = "OTP" | "TOTP" | "BIOMETRIC";

type BiometricCredentialRecord = {
  id: string;
  customerId: string;
  credentialType: "BIOMETRIC";
  deviceId: string;
  displayName: string;
  status: "ACTIVE" | "REVOKED";
  biometricSecret: string;
  enrolledAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type ExternalStepUpVerification = {
  userId: string;
  challengeId: string;
  deviceId: string;
  method: StepUpMethod;
  purpose: OtpPurpose;
  resourceId: string | null;
  requestFingerprint: string | null;
  expiresAt: number;
};

function normalizeStepUpMethods(
  methods: readonly StepUpMethod[] | undefined,
  fallback: readonly StepUpMethod[],
): StepUpMethod[] {
  const configuredMethods = methods ?? fallback;
  const normalizedMethods = Array.from(
    new Set(
      configuredMethods.filter(
        (method): method is StepUpMethod =>
          method === "OTP" || method === "TOTP" || method === "BIOMETRIC",
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
  proofDigest: string | null;
  digestKeyId: string | null;
  status: "ACTIVE" | "CONSUMED" | "LOCKED" | "EXPIRED" | "CANCELLED" | "DELIVERY_FAILED";
  maxAttempts: number;
  resendCount: number;
  lastSentAt: number | null;
  credentialId: string | null;
};

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const QUOTE_TTL_MS = 5 * 60 * 1000;
const RECIPIENT_LOOKUP_TTL_MS = 5 * 60 * 1000;
const AUTH_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const OUTBOX_EVENT_RETENTION_MS = 24 * 60 * 60 * 1000;
const AUTH_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const AUTH_RATE_LIMIT_MAX_ATTEMPTS = 5;
const REGISTRATION_RATE_LIMIT_MAX_ATTEMPTS = 5;
const OTP_CHALLENGE_ISSUANCE_RATE_LIMIT_MAX_ATTEMPTS = 10;
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

function requireIdempotencyKey(value: unknown, minLength: number): string {
  const normalized = requireString(value, "Idempotency-Key");
  if (normalized.length < minLength) {
    const message = `Idempotency-Key must contain at least ${minLength} characters.`;
    throw invalidRequest(message, { "Idempotency-Key": message });
  }
  return normalized;
}

function rethrowFinancialStepUpFailure(error: unknown): never {
  if (error instanceof DomainError && error.status === 401) {
    throw conflictWithCode(
      "STEP_UP_VERIFICATION_FAILED",
      "Step-up challenge is invalid, expired, or does not match this request.",
    );
  }
  throw error;
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
    ...(quote.anomalyAssessment
      ? { anomalyAssessment: cloneAnomalyAssessment(quote.anomalyAssessment) }
      : {}),
  };
}

function cloneReceipt(receipt: TransferReceipt): TransferReceipt {
  return {
    ...receipt,
    amount: { ...receipt.amount },
    fee: { ...receipt.fee },
    ...(receipt.anomalyAssessment
      ? { anomalyAssessment: cloneAnomalyAssessment(receipt.anomalyAssessment) }
      : {}),
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

function toPublicCreditApplication(
  application: CreditApplicationRecord,
): CreditApplication {
  const { userId: _userId, requestFingerprint: _requestFingerprint, ...publicApplication } = application;
  return {
    ...publicApplication,
    requestedLimit: { ...publicApplication.requestedLimit },
    approvedLimit: publicApplication.approvedLimit
      ? { ...publicApplication.approvedLimit }
      : null,
  };
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
};

type PreparedRegistrationWithPassword = PreparedRegistration & {
  password: string;
};

type PendingRegistrationRecord = {
  prepared: PreparedRegistration;
  passwordMaterial: { salt: string; digest: string };
  expiresAt: number;
};

type LoginContext = {
  normalizedEmail: string;
  normalizedPassword: string;
  normalizedDeviceId: string;
  attemptKeys: string[];
  user: UserRecord | undefined;
};

const DUMMY_LOGIN_PASSWORD = hashPassword("reference-dummy-password-material");

export const BANKING_SYSTEM_STATE_VERSION = 7;

export type BankingSystemState = {
  /** Optional for backwards compatibility with M0-M6 snapshots created before M7. */
  stateVersion?: number;
  core: InMemoryCoreState;
  users: Array<[string, UserRecord]>;
  accessSessions: Array<[string, AccessSession]>;
  authChallenges: Array<[string, AuthChallengeRecord]>;
  pendingRegistrations?: Array<[string, PendingRegistrationRecord]>;
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
  creditApplications?: Array<[string, CreditApplicationRecord]>;
  creditApplicationIdempotency?: Array<[string, CreditApplicationIdempotencyRecord]>;
  creditActivationIdempotency?: Array<[string, CreditActivationIdempotencyRecord]>;
  fraudReports?: Array<[string, FraudReportRecord]>;
  fraudReportIdempotency?: Array<[string, FraudReportIdempotencyRecord]>;
  transactionAnomalies?: Array<[string, TransactionAnomaly]>;
  biometricCredentials?: Array<[string, BiometricCredentialRecord]>;
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
  const scopeLegacyCreditIdempotency = <T extends { userId: string }>(
    entries: Array<[string, T]> | undefined,
  ): Array<[string, T]> =>
    (entries ?? []).map(([key, record]) => [
      stateVersion < 7 ? `${record.userId}:${key}` : key,
      record,
    ]);

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

  const notifications = candidate.notifications!.map(([userId, items]) => [
    userId,
    items.map((notification) =>
      notification.type === "SANDBOX_FUNDING"
        ? {
          ...notification,
          type: "SECURITY" as const,
          title: "Tài khoản đã được nạp tiền",
          body: "Một khoản ghi có đã được cập nhật vào tài khoản.",
        }
        : { ...notification },
    ),
  ] as [string, Notification[]]);

  const pendingRegistrations = (candidate.pendingRegistrations ?? []).map(
    ([registrationId, record]) => [
      registrationId,
      {
        prepared: {
          fullName: record.prepared.fullName,
          email: record.prepared.email,
          phoneNumber: record.prepared.phoneNumber,
        },
        passwordMaterial: { ...record.passwordMaterial },
        expiresAt: record.expiresAt,
      },
    ] as [string, PendingRegistrationRecord],
  );

  return {
    stateVersion: BANKING_SYSTEM_STATE_VERSION,
    core: candidate.core,
    users: candidate.users!,
    accessSessions: candidate.accessSessions!,
    authChallenges: candidate.authChallenges!,
    pendingRegistrations,
    authAttemptWindows: candidate.authAttemptWindows!,
    registrationAttemptWindows: candidate.registrationAttemptWindows!,
    transferStepUpAttemptWindows: candidate.transferStepUpAttemptWindows!,
    savingsStepUpAttemptWindows: candidate.savingsStepUpAttemptWindows ?? [],
    creditStepUpAttemptWindows: candidate.creditStepUpAttemptWindows ?? [],
    refreshSessions: candidate.refreshSessions!,
    refreshFamilies: candidate.refreshFamilies!,
    beneficiaries: candidate.beneficiaries!,
    recipientLookups: candidate.recipientLookups ?? [],
    notifications,
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
    creditApplications: candidate.creditApplications ?? [],
    creditApplicationIdempotency: scopeLegacyCreditIdempotency(
      candidate.creditApplicationIdempotency,
    ),
    creditActivationIdempotency: scopeLegacyCreditIdempotency(
      candidate.creditActivationIdempotency,
    ),
    fraudReports: candidate.fraudReports ?? [],
    fraudReportIdempotency: candidate.fraudReportIdempotency ?? [],
    transactionAnomalies: (candidate.transactionAnomalies ?? []).map(([id, record]) => [
      id,
      cloneTransactionAnomaly(record),
    ]),
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

type CursorKind =
  | "ACCOUNT_TRANSACTIONS"
  | "CREDIT_TRANSACTIONS"
  | "CREDIT_STATEMENTS";

type CursorPosition = {
  sortValue: string;
  id: string;
};

function encodeCursor(
  kind: CursorKind,
  scope: string,
  position: CursorPosition,
): string {
  return Buffer.from(
    JSON.stringify({ version: 1, kind, scope, ...position }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(
  cursor: string | undefined,
  expectedKind: CursorKind,
  expectedScope: string,
): CursorPosition | null {
  if (!cursor) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    const candidate = typeof parsed === "object" && parsed !== null
      ? parsed as Record<string, unknown>
      : {};
    if (
      candidate.version !== 1 ||
      candidate.kind !== expectedKind ||
      candidate.scope !== expectedScope ||
      typeof candidate.sortValue !== "string" ||
      !candidate.sortValue ||
      typeof candidate.id !== "string" ||
      !candidate.id
    ) {
      throw new Error("invalid cursor");
    }
    return { sortValue: candidate.sortValue, id: candidate.id };
  } catch {
    throw invalidRequest("cursor is invalid.", { cursor: "cursor is invalid." });
  }
}

function paginateByKeyset<T>(
  source: readonly T[],
  cursor: string | undefined,
  limit: number,
  kind: CursorKind,
  scope: string,
  toPosition: (item: T) => CursorPosition,
): { items: T[]; nextCursor: string | null } {
  const position = decodeCursor(cursor, kind, scope);
  const sorted = [...source].sort((left, right) => {
    const leftPosition = toPosition(left);
    const rightPosition = toPosition(right);
    return (
      rightPosition.sortValue.localeCompare(leftPosition.sortValue) ||
      rightPosition.id.localeCompare(leftPosition.id)
    );
  });
  const remaining = position
    ? sorted.filter((item) => {
      const itemPosition = toPosition(item);
      return (
        itemPosition.sortValue < position.sortValue ||
        (itemPosition.sortValue === position.sortValue && itemPosition.id < position.id)
      );
    })
    : sorted;
  const items = remaining.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      remaining.length > items.length && last
        ? encodeCursor(kind, scope, toPosition(last))
        : null,
  };
}

function deterministicUuid(value: string): string {
  const hex = fingerprint(value).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export class BankingSystem {
  readonly core: CoreBankingPort;
  private readonly auditEventStore: AuditEvent[] = [];
  private readonly outboxEventStore: OutboxEvent[] = [];

  private readonly clock: Clock;
  private readonly bankingEnvironment: string;
  private readonly sandboxOtp: string | undefined;
  private readonly sandboxMfaOtp: string | undefined;
  private readonly allowUnsafeDirectSandboxStepUp: boolean;
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
  /** One-request bridge for a challenge verified by the persistent MFA boundary. */
  private readonly externalStepUpVerifications = new Map<string, ExternalStepUpVerification>();
  private readonly pendingRegistrations = new Map<string, PendingRegistrationRecord>();
  private readonly testVerificationCodes = new Map<string, string>();
  private readonly otpDigestKeyring: OtpDigestKeyring;
  private readonly otpCodeGenerator: OtpCodeGenerator;
  private readonly mfaCodeGenerator: OtpCodeGenerator;
  private readonly verificationCodeDelivery: VerificationCodeDeliveryPort;
  private readonly deliveryRequired: boolean;
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
  private readonly customerDevices = new Map<string, { id: string; customerId: string; deviceId: string; deviceName: string; attestationStatus: "PENDING" | "VERIFIED" | "REVOKED"; createdAt: string; lastSeenAt: string; revokedAt: string | null }>();
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
  private readonly creditApplications = new Map<string, CreditApplicationRecord>();
  private readonly creditApplicationIdempotency = new Map<string, CreditApplicationIdempotencyRecord>();
  private readonly creditActivationIdempotency = new Map<string, CreditActivationIdempotencyRecord>();
  private readonly fraudReports = new Map<string, FraudReportRecord>();
  private readonly fraudReportIdempotency = new Map<string, FraudReportIdempotencyRecord>();
  private readonly transactionAnomalies = new Map<string, TransactionAnomaly>();
  private readonly biometricCredentials = new Map<string, BiometricCredentialRecord>();
  private readonly policy: ControlPolicy;

  constructor(
    options: {
      clock?: Clock;
      core?: CoreBankingPort;
      /** @deprecated Test-only deterministic email code. Never read from environment. */
      sandboxOtp?: string;
      /** @deprecated Test-only deterministic login code. Never read from environment. */
      sandboxMfaOtp?: string;
      otpDigestKeyring?: OtpDigestKeyring;
      otpCodeGenerator?: OtpCodeGenerator;
      mfaCodeGenerator?: OtpCodeGenerator;
      verificationCodeDelivery?: VerificationCodeDeliveryPort;
      /** Test-only compatibility switch. Never enabled by the HTTP server. */
      allowUnsafeDirectSandboxStepUp?: boolean;
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
    this.core = options.core ?? new InMemoryCoreBanking();
    this.sandboxOtp = options.sandboxOtp;
    this.sandboxMfaOtp = options.sandboxMfaOtp;
    this.otpDigestKeyring = options.otpDigestKeyring ?? OtpDigestKeyring.fromEnvironment({ required: false });
    this.otpCodeGenerator = options.otpCodeGenerator ?? new SecureOtpCodeGenerator();
    this.mfaCodeGenerator = options.mfaCodeGenerator ?? (
      this.sandboxMfaOtp ? new DeterministicOtpCodeGenerator(this.sandboxMfaOtp) : this.otpCodeGenerator
    );
    this.deliveryRequired = options.verificationCodeDelivery !== undefined;
    this.verificationCodeDelivery = options.verificationCodeDelivery ?? new NullEmailProvider();
    this.allowUnsafeDirectSandboxStepUp =
      options.allowUnsafeDirectSandboxStepUp ?? false;
    if (
      this.allowUnsafeDirectSandboxStepUp &&
      (this.bankingEnvironment === "preview" ||
        this.bankingEnvironment === "production")
    ) {
      throw new Error(
        "Unsafe direct sandbox step-up proofs cannot be enabled outside local development.",
      );
    }
    this.mfaRequired =
      options.mfaRequired ??
      (process.env.BANKING_MFA_REQUIRED === "1" ||
        process.env.BANKING_ENV === "preview");
    this.authChallengeMethods = normalizeStepUpMethods(
      options.authChallengeMethods,
      ["OTP"],
    );
    if (
      !this.allowUnsafeDirectSandboxStepUp &&
      this.authChallengeMethods.includes("BIOMETRIC")
    ) {
      throw new Error(
        "Static sandbox biometric challenges require the explicit local-development unsafe switch.",
      );
    }
    this.allowlistPredicate = options.allowlist ?? (() => true);
    this.settleTransfersImmediately = options.settleTransfersImmediately ?? true;
    this.settleSavingsImmediately = options.settleSavingsImmediately ?? true;
    this.settleCreditPaymentsImmediately =
      options.settleCreditPaymentsImmediately ??
      process.env.BANKING_SETTLE_CREDIT_PAYMENTS_IMMEDIATELY !== "0";
    this.creditOverdueSeed =
      options.creditOverdueSeed ?? process.env.BANKING_SANDBOX_CREDIT_OVERDUE === "1";
    this.savingsProducts = (options.savingsProducts ?? DEFAULT_SAVINGS_PRODUCTS).map(
      (product) => {
        let minAmountMinor: bigint;
        let maxAmountMinor: bigint;
        try {
          minAmountMinor = BigInt(product.minAmountMinor);
          maxAmountMinor = BigInt(product.maxAmountMinor);
        } catch {
          throw new Error(`Savings product ${product.productId} has invalid amount limits.`);
        }
        if (
          minAmountMinor <= 0n ||
          maxAmountMinor < minAmountMinor ||
          !Number.isSafeInteger(product.termMonths) ||
          product.termMonths <= 0 ||
          !Number.isSafeInteger(product.annualRateBasisPoints) ||
          product.annualRateBasisPoints < 0
        ) {
          throw new Error(`Savings product ${product.productId} has invalid terms.`);
        }
        return {
          ...product,
          minAmountMinor: minAmountMinor.toString(),
          maxAmountMinor: maxAmountMinor.toString(),
        };
      },
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
      stepUpMethods: normalizeStepUpMethods(options.stepUpMethods, ["OTP"]),
      savingsEnabled:
        options.savingsEnabled ?? process.env.BANKING_SAVINGS_ENABLED !== "0",
      savingsAllowlisted:
        options.savingsAllowlisted ?? process.env.BANKING_SAVINGS_ALLOWLIST_ENABLED !== "0",
      maxSavingsAmountMinor: normalizeTransferLimit(
        options.maxSavingsAmountMinor ?? process.env.BANKING_MAX_SAVINGS_AMOUNT_MINOR,
        500_000_000n,
      ),
      savingsStepUpMethods: normalizeStepUpMethods(options.savingsStepUpMethods, ["OTP"]),
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
        ["OTP"],
      ),
      cardUnlockStepUpMethods: normalizeStepUpMethods(
        options.cardUnlockStepUpMethods,
        ["OTP"],
      ),
      updatedAt: nowIso(this.clock),
    };
    if (
      !this.allowUnsafeDirectSandboxStepUp &&
      [
        this.policy.stepUpMethods,
        this.policy.savingsStepUpMethods,
        this.policy.creditPaymentStepUpMethods,
        this.policy.cardUnlockStepUpMethods,
      ].some((methods) => methods.includes("BIOMETRIC"))
    ) {
      throw new Error(
        "Static sandbox biometric step-up requires the explicit local-development unsafe switch.",
      );
    }
  }

  private prepareRegistration(
    input: {
      fullName: string;
      email: string;
      phoneNumber: string;
      password: string;
    },
    rateLimitKey?: string,
  ): PreparedRegistrationWithPassword {
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

  private registrationIdentity(
    prepared: PreparedRegistrationWithPassword,
  ): PreparedRegistration {
    return {
      fullName: prepared.fullName,
      email: prepared.email,
      phoneNumber: prepared.phoneNumber,
    };
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
    const passwordMaterial = hashPassword(prepared.password);
    return this.completeRegistration(
      this.registrationIdentity(prepared),
      passwordMaterial,
    );
  }

  async registerAsync(input: {
    fullName: string;
    email: string;
    phoneNumber: string;
    password: string;
  }, rateLimitKey?: string): Promise<{ user: AuthUser }> {
    const prepared = this.prepareRegistration(input, rateLimitKey);
    const passwordMaterial = await hashPasswordAsync(prepared.password);
    return this.completeRegistration(
      this.registrationIdentity(prepared),
      passwordMaterial,
    );
  }

  async beginRegistrationAsync(
    input: {
      fullName: string;
      email: string;
      phoneNumber: string;
      password: string;
    },
    rateLimitKey?: string,
    deviceId?: string,
  ): Promise<AuthChallengeResponse> {
    const prepared = this.prepareRegistration(input, rateLimitKey);
    const passwordMaterial = await hashPasswordAsync(prepared.password);
    const registrationId = createId("registration");
    this.pendingRegistrations.set(registrationId, {
      prepared: this.registrationIdentity(prepared),
      passwordMaterial,
      expiresAt: this.clock() + AUTH_CHALLENGE_TTL_MS,
    });
    return this.issueOtpChallenge(
      registrationId,
      this.normalizeDeviceId(deviceId),
      "REGISTRATION_VERIFY",
      registrationId,
      fingerprint({ email: prepared.email, phoneNumber: prepared.phoneNumber }),
      ["OTP"],
      this.sandboxOtp ?? undefined,
    );
  }

  verifyRegistrationChallenge(
    challengeId: string,
    proof: string,
    deviceId?: string,
  ): { user: AuthUser } {
    this.cleanupExpiredState();
    const challengeHash = hashOpaqueToken(requireString(challengeId, "challengeId"));
    const challenge = this.authChallenges.get(challengeHash);
    if (!challenge || challenge.purpose !== "REGISTRATION_VERIFY") {
      throw unauthorized("Registration challenge is invalid or expired.");
    }
    const registrationId = challenge.resourceId ?? challenge.userId;
    const pending = this.pendingRegistrations.get(registrationId);
    if (!pending || pending.expiresAt <= this.clock()) {
      throw unauthorized("Registration challenge is invalid or expired.");
    }
    if (
      this.usersByEmail.has(pending.prepared.email) ||
      this.usersByPhone.has(pending.prepared.phoneNumber)
    ) {
      throw conflict("Email or phone number already exists.");
    }
    this.verifyOtpChallenge(
      challengeId,
      challenge.userId,
      deviceId,
      "OTP",
      proof,
      "REGISTRATION_VERIFY",
      challenge.resourceId,
      challenge.requestFingerprint,
    );
    this.pendingRegistrations.delete(registrationId);
    const result = this.completeRegistration(pending.prepared, pending.passwordMaterial);
    this.recordAudit("REGISTRATION_CHALLENGE_VERIFIED", result.user.id, result.user.id);
    return result;
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

  async loginPasswordOnly(
    email: string,
    password: string,
    deviceId?: string,
  ): Promise<AuthUser> {
    const context = this.prepareLogin(email, password, deviceId);
    const valid = await verifyPasswordAsync(
      context.normalizedPassword,
      context.user?.passwordSalt ?? DUMMY_LOGIN_PASSWORD.salt,
      context.user?.passwordDigest ?? DUMMY_LOGIN_PASSWORD.digest,
    );
    if (!context.user || !valid) {
      for (const attemptKey of context.attemptKeys) {
        this.recordAuthFailure(attemptKey);
      }
      throw unauthorized("Invalid credentials.");
    }
    for (const attemptKey of context.attemptKeys) {
      this.authAttemptWindows.delete(attemptKey);
    }
    return this.publicUser(context.user);
  }

  issueMfaSession(userId: string, deviceId: string, deviceName?: string): LoginResponse {
    const user = this.users.get(userId);
    if (!user) {
      throw unauthorized("User session is invalid.");
    }
    return this.issueTokenPair(user, createId("refresh-family"), this.normalizeDeviceId(deviceId), deviceName);
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
    if (!challenge || challenge.expiresAt <= this.clock() || challenge.status !== "ACTIVE") {
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
      "TRANSFER",
      "SAVINGS_OPENING",
      "CREDIT_APPLICATION",
      "CARD_ACTIVATION",
      "CREDIT_PAYMENT",
      "CARD_UNLOCK",
      "CARD_REPORT_LOST",
    ];
    if (!supportedPurposes.includes(purpose)) {
      throw invalidRequest("OTP purpose is invalid.");
    }
    const normalizedDeviceId = this.normalizeDeviceId(deviceId);
    const normalizedResourceId = resourceId === null
      ? null
      : requireString(resourceId, "resourceId");
    this.consumeOtpChallengeIssuance(
      `otp-issuance:${userId}:${normalizedDeviceId}`,
    );
    const baseMethods =
      purpose === "TRANSFER"
        ? this.policy.stepUpMethods
        : purpose === "SAVINGS_OPENING"
          ? this.policy.savingsStepUpMethods
          : purpose === "CREDIT_PAYMENT"
            ? this.policy.creditPaymentStepUpMethods
            : purpose === "CARD_UNLOCK" || purpose === "CARD_REPORT_LOST"
              ? this.policy.cardUnlockStepUpMethods
              : ["OTP"] as StepUpMethod[];
    const methods =
      this.hasActiveBiometricCredential(userId, normalizedDeviceId) && !baseMethods.includes("BIOMETRIC")
        ? [...baseMethods, "BIOMETRIC" as StepUpMethod]
        : baseMethods;
    const effectiveFingerprint =
      this.resolveOtpRequestFingerprint(purpose, normalizedResourceId) ?? requestFingerprint;
    for (const [challengeHash, challenge] of this.authChallenges) {
      if (
        challenge.userId === userId &&
        challenge.deviceId === normalizedDeviceId &&
        challenge.purpose === purpose &&
        challenge.resourceId === normalizedResourceId
      ) {
        this.authChallenges.delete(challengeHash);
      }
    }
    return this.issueOtpChallenge(
      userId,
      normalizedDeviceId,
      purpose,
      normalizedResourceId,
      effectiveFingerprint,
      methods,
      this.sandboxOtp ?? undefined,
    );
  }

  /** Local test harness only; production-like HTTP never exposes this value. */
  readTestVerificationCode(challengeId: string): string {
    if (!new Set(["development", "test"]).has(this.bankingEnvironment)) {
      throw unauthorized("Reference test verification is disabled outside local development or disposable tests.");
    }
    const challengeHash = hashOpaqueToken(requireString(challengeId, "challengeId"));
    const challenge = this.authChallenges.get(challengeHash);
    if (!challenge) {
      throw notFound("Sandbox OTP challenge not found or expired.");
    }
    const configuredOtp = challenge
      ? challenge.purpose === "LOGIN"
        ? this.sandboxMfaOtp ?? this.sandboxOtp
        : this.sandboxOtp
      : undefined;
    const otp =
      this.testVerificationCodes.get(challengeHash) ??
      (configuredOtp && challenge?.proofDigest === this.otpDigestKeyring.digest(
        challengeHash,
        configuredOtp,
        challenge.digestKeyId ?? this.otpDigestKeyring.currentKeyId,
      )
        ? configuredOtp
        : undefined);
    if (challenge.expiresAt <= this.clock() || !otp) {
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

  getUser(userId: string): AuthUser {
    const user = this.users.get(userId);
    if (!user) {
      throw notFound("User not found.");
    }
    return this.publicUser(user);
  }

  verifyCurrentPassword(userId: string, password: string): boolean {
    const user = this.users.get(userId);
    return Boolean(user && typeof password === "string" && verifyPassword(password, user.passwordSalt, user.passwordDigest));
  }

  async changePasswordAsync(input: {
    customerId: string;
    currentPassword: string;
    newPassword: string;
    deviceId: string;
  }): Promise<void> {
    const normalizedDeviceId = this.normalizeDeviceId(input.deviceId);
    if (typeof input.currentPassword !== "string" || input.currentPassword.length === 0) {
      throw invalidRequest("Mật khẩu hiện tại là bắt buộc.", { currentPassword: "Mật khẩu hiện tại là bắt buộc." });
    }
    const validatedNew = validateStrongPassword(input.newPassword, "newPassword");
    if (validatedNew === input.currentPassword) {
      throw invalidRequest("Mật khẩu mới phải khác mật khẩu hiện tại.", { newPassword: "Mật khẩu mới phải khác mật khẩu hiện tại." });
    }
    const user = this.users.get(input.customerId);
    if (!user) throw unauthorized("User session is invalid.");
    const valid = await verifyPasswordAsync(input.currentPassword, user.passwordSalt, user.passwordDigest);
    if (!valid) throw unauthorized("Mật khẩu hiện tại không chính xác.");
    const nextHash = await hashPasswordAsync(validatedNew);
    user.passwordSalt = nextHash.salt;
    user.passwordDigest = nextHash.digest;
    this.revokeAllSessions(user.id);
    this.recordAudit("PASSWORD_CHANGED", user.id, normalizedDeviceId);
  }

  preparePasswordReset(email: string, networkFingerprint: string): { normalizedEmail: string; customer: { id: string; email: string } | null } {
    const normalizedEmail = assertEmail(email);
    this.consumeOtpChallengeIssuance(`password-forgot:email:${normalizedEmail}`);
    this.consumeOtpChallengeIssuance(`password-forgot:net:${networkFingerprint}`);
    for (const user of this.users.values()) {
      if (user.email.toLowerCase() === normalizedEmail) {
        return { normalizedEmail, customer: { id: user.id, email: user.email } };
      }
    }
    return { normalizedEmail, customer: null };
  }

  issuePasswordResetChallenge(email: string, deviceId: string, networkFingerprint: string): AuthChallengeResponse {
    const normalizedDeviceId = this.normalizeDeviceId(deviceId);
    const prepared = this.preparePasswordReset(email, networkFingerprint);
    if (!prepared.customer) {
      return {
        challengeId: createOpaqueToken(),
        expiresAt: new Date(this.clock() + 5 * 60 * 1000).toISOString(),
        methods: ["EMAIL_OTP"],
        method: "EMAIL_OTP",
        resendAfter: new Date(this.clock() + 60 * 1000).toISOString(),
        maskedDestination: maskEmailAddress(prepared.normalizedEmail),
        purpose: "PASSWORD_RESET",
      };
    }
    return this.issueOtpChallenge(prepared.customer.id, normalizedDeviceId, "PASSWORD_RESET", null, null, ["OTP"], this.sandboxOtp ?? undefined);
  }

  async resetPasswordAsync(input: { customerId: string; newPassword: string; deviceId: string }): Promise<void> {
    const normalizedDeviceId = this.normalizeDeviceId(input.deviceId);
    const validatedNew = validateStrongPassword(input.newPassword, "newPassword");
    const user = this.users.get(input.customerId);
    if (!user) throw unauthorized("Tài khoản không hợp lệ.");
    const nextHash = await hashPasswordAsync(validatedNew);
    user.passwordSalt = nextHash.salt;
    user.passwordDigest = nextHash.digest;
    this.revokeAllSessions(user.id);
    this.recordAudit("PASSWORD_RESET", user.id, normalizedDeviceId);
  }

  async resetPasswordWithChallengeAsync(challengeId: string, proof: string, newPassword: string, deviceId: string): Promise<void> {
    const normalizedDeviceId = this.normalizeDeviceId(deviceId);
    const validatedNew = validateStrongPassword(newPassword, "newPassword");
    const challengeHash = hashOpaqueToken(requireString(challengeId, "challengeId"));
    const challenge = this.authChallenges.get(challengeHash);
    if (!challenge || challenge.purpose !== "PASSWORD_RESET") {
      throw unauthorized("MFA challenge is invalid or expired.");
    }
    this.verifyOtpChallenge(challengeId, challenge.userId, normalizedDeviceId, "OTP", proof, "PASSWORD_RESET", null, null);
    await this.resetPasswordAsync({ customerId: challenge.userId, newPassword: validatedNew, deviceId: normalizedDeviceId });
  }

  listDevices(userId: string, currentDeviceId: string): CustomerDeviceSummary[] {
    const normalizedCurrent = this.normalizeDeviceId(currentDeviceId);
    const now = this.clock();
    const deviceIds = new Set<string>();
    for (const [key, entry] of this.customerDevices) {
      if (entry.customerId === userId && !entry.revokedAt) deviceIds.add(entry.deviceId);
      void key;
    }
    for (const session of this.accessSessions.values()) {
      if (session.userId === userId && session.expiresAt > now) {
        const key = `${userId}:${session.deviceId}`;
        if (!this.customerDevices.get(key)?.revokedAt) deviceIds.add(session.deviceId);
      }
    }
    for (const session of this.refreshSessions.values()) {
      if (session.userId === userId && !session.revoked && session.expiresAt > now) {
        const key = `${userId}:${session.deviceId}`;
        if (!this.customerDevices.get(key)?.revokedAt) deviceIds.add(session.deviceId);
      }
    }
    const items: CustomerDeviceSummary[] = [];
    for (const devId of deviceIds) {
      const key = `${userId}:${devId}`;
      const meta = this.customerDevices.get(key);
      let activeSessionCount = 0;
      for (const s of this.accessSessions.values()) {
        if (s.userId === userId && s.deviceId === devId && s.expiresAt > now) activeSessionCount += 1;
      }
      const createdAt = meta?.createdAt ?? nowIso(this.clock);
      items.push({
        id: meta?.id ?? createId("device"),
        deviceId: devId,
        deviceName: meta?.deviceName || "Thiết bị NOVA",
        attestationStatus: meta?.attestationStatus ?? "PENDING",
        isCurrentDevice: devId === normalizedCurrent,
        lastSeenAt: meta?.lastSeenAt ?? createdAt,
        createdAt,
        activeSessionCount,
      });
    }
    return items.sort((a, b) => Number(b.isCurrentDevice) - Number(a.isCurrentDevice) || b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  revokeDevice(userId: string, targetDeviceId: string, currentDeviceId: string): void {
    const normalizedTarget = targetDeviceId.trim();
    const normalizedCurrent = this.normalizeDeviceId(currentDeviceId);
    if (!normalizedTarget) {
      throw invalidRequest("deviceId is required.", { deviceId: "deviceId is required." });
    }
    const now = nowIso(this.clock);
    const list = this.listDevices(userId, normalizedCurrent);
    const match = list.find((item) => item.id === normalizedTarget || item.deviceId === normalizedTarget);
    if (!match) {
      throw notFound("Không tìm thấy thiết bị đang hoạt động.");
    }
    const key = `${userId}:${match.deviceId}`;
    const existing = this.customerDevices.get(key);
    this.customerDevices.set(key, {
      id: existing?.id ?? match.id,
      customerId: userId,
      deviceId: match.deviceId,
      deviceName: existing?.deviceName ?? match.deviceName,
      attestationStatus: "REVOKED",
      createdAt: existing?.createdAt ?? match.createdAt,
      lastSeenAt: existing?.lastSeenAt ?? match.lastSeenAt,
      revokedAt: now,
    });
    const familyIds = new Set<string>();
    for (const s of this.accessSessions.values()) {
      if (s.userId === userId && s.deviceId === match.deviceId) familyIds.add(s.familyId);
    }
    for (const s of this.refreshSessions.values()) {
      if (s.userId === userId && s.deviceId === match.deviceId) familyIds.add(s.familyId);
    }
    for (const familyId of familyIds) this.revokeFamily(familyId);
    for (const [credId, credential] of this.biometricCredentials.entries()) {
      if (
        credential.customerId === userId &&
        credential.deviceId === match.deviceId &&
        credential.status === "ACTIVE"
      ) {
        this.biometricCredentials.set(credId, {
          ...credential,
          status: "REVOKED",
          revokedAt: now,
        });
      }
    }
    this.recordAudit("DEVICE_REVOKED", userId, match.id);
  }

  hasActiveBiometricCredential(userId: string, deviceId?: string): boolean {
    if (!deviceId?.trim()) return false;
    const normalized = this.normalizeDeviceId(deviceId);
    for (const credential of this.biometricCredentials.values()) {
      if (
        credential.customerId === userId &&
        credential.deviceId === normalized &&
        credential.status === "ACTIVE"
      ) {
        return true;
      }
    }
    return false;
  }

  enrollBiometricCredential(
    userId: string,
    deviceId: string | undefined,
    displayName?: string,
  ): {
    credentialId: string;
    credentialType: "BIOMETRIC";
    deviceId: string;
    displayName: string;
    status: "ACTIVE";
    biometricSecret: string;
    enrolledAt: string;
  } {
    if (!this.users.has(userId)) {
      throw notFound("User not found.");
    }
    const normalizedDeviceId = this.normalizeDeviceId(deviceId);
    const now = nowIso(this.clock);
    for (const credential of this.biometricCredentials.values()) {
      if (
        credential.customerId === userId &&
        credential.deviceId === normalizedDeviceId &&
        credential.status !== "REVOKED"
      ) {
        credential.status = "REVOKED";
        credential.revokedAt = now;
      }
    }
    const credentialId = createId("mfa-credential");
    const biometricSecret = generateBiometricSecret();
    const deviceSuffix = fingerprint(normalizedDeviceId).slice(0, 6);
    const label = displayName?.trim()
      ? `${displayName.trim()} (${deviceSuffix})`
      : `Sinh trắc học thiết bị (${deviceSuffix})`;
    this.biometricCredentials.set(credentialId, {
      id: credentialId,
      customerId: userId,
      credentialType: "BIOMETRIC",
      deviceId: normalizedDeviceId,
      displayName: label,
      status: "ACTIVE",
      biometricSecret,
      enrolledAt: now,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: now,
    });
    this.recordAudit("MFA_BIOMETRIC_ENROLLED", userId, credentialId);
    return {
      credentialId,
      credentialType: "BIOMETRIC",
      deviceId: normalizedDeviceId,
      displayName: label,
      status: "ACTIVE",
      biometricSecret,
      enrolledAt: now,
    };
  }

  listBiometricCredentials(userId: string) {
    return [...this.biometricCredentials.values()]
      .filter((item) => item.customerId === userId)
      .map(({ biometricSecret: _secret, ...summary }) => ({
        ...summary,
        algorithm: "HMAC-SHA256",
        digits: 6,
        periodSeconds: 30,
        lastAcceptedTimeStep: null,
        compromisedAt: null,
      }));
  }

  revokeBiometricCredential(userId: string, credentialId: string): void {
    const credential = this.biometricCredentials.get(credentialId);
    if (!credential || credential.customerId !== userId || credential.status === "REVOKED") {
      throw notFound("MFA credential not found.");
    }
    credential.status = "REVOKED";
    credential.revokedAt = nowIso(this.clock);
    this.recordAudit("MFA_FACTOR_REVOKED", userId, credentialId);
  }

  private hasExternalStepUpVerificationForMethod(
    userId: string,
    challengeId: string | undefined,
    deviceId: string | undefined,
    method: StepUpMethod,
  ): boolean {
    if (!challengeId || !deviceId?.trim()) return false;
    const normalized = this.normalizeDeviceId(deviceId);
    for (const marker of this.externalStepUpVerifications.values()) {
      if (
        marker.userId === userId &&
        marker.challengeId === challengeId &&
        marker.deviceId === normalized &&
        marker.method === method &&
        marker.expiresAt > this.clock()
      ) {
        return true;
      }
    }
    return false;
  }

  private isStepUpMethodEnabledForRequest(
    userId: string,
    deviceId: string | undefined,
    stepUp: { method: StepUpMethod; challengeId?: string },
    configuredMethods: readonly StepUpMethod[],
  ): boolean {
    if (configuredMethods.includes(stepUp.method)) return true;
    if (stepUp.method === "BIOMETRIC") {
      return (
        this.hasActiveBiometricCredential(userId, deviceId) ||
        this.hasExternalStepUpVerificationForMethod(userId, stepUp.challengeId, deviceId, "BIOMETRIC")
      );
    }
    return false;
  }

  /**
   * Records a successful verification performed by PersistentMfaService.
   * The marker is memory-only, bound to the complete command context, and
   * consumed by exactly one financial command.
   */
  registerExternalStepUpVerification(input: {
    userId: string;
    challengeId: string;
    deviceId?: string;
    method: StepUpMethod;
    purpose: OtpPurpose;
    resourceId?: string | null;
    requestFingerprint?: string | null;
    expiresAt?: number;
  }): void {
    const challengeId = requireString(input.challengeId, "challengeId");
    const deviceId = this.normalizeDeviceId(input.deviceId);
    const resourceId = input.resourceId ?? null;
    const requestFingerprint = input.requestFingerprint ?? null;
    const key = this.externalStepUpKey(
      input.userId,
      challengeId,
      deviceId,
      input.purpose,
      resourceId,
      requestFingerprint,
    );
    this.externalStepUpVerifications.set(key, {
      userId: input.userId,
      challengeId,
      deviceId,
      method: input.method,
      purpose: input.purpose,
      resourceId,
      requestFingerprint,
      expiresAt: input.expiresAt ?? this.clock() + AUTH_CHALLENGE_TTL_MS,
    });
  }

  private externalStepUpKey(
    userId: string,
    challengeId: string,
    deviceId: string,
    purpose: OtpPurpose,
    resourceId: string | null,
    requestFingerprint: string | null,
  ): string {
    return [
      userId,
      challengeId,
      deviceId,
      purpose,
      resourceId ?? "",
      requestFingerprint ?? "",
    ].join("\u001f");
  }

  private consumeExternalStepUpVerification(input: {
    userId: string;
    challengeId: string;
    deviceId?: string;
    method: StepUpMethod;
    purpose: OtpPurpose;
    resourceId: string | null;
    requestFingerprint: string | null;
  }): boolean {
    const deviceId = this.normalizeDeviceId(input.deviceId);
    const key = this.externalStepUpKey(
      input.userId,
      input.challengeId,
      deviceId,
      input.purpose,
      input.resourceId,
      input.requestFingerprint,
    );
    const marker = this.externalStepUpVerifications.get(key);
    if (!marker) return false;
    this.externalStepUpVerifications.delete(key);
    return marker.expiresAt > this.clock() && marker.method === input.method;
  }

  listAccounts(userId: string): PaymentAccount[] {
    return this.core.listPaymentAccounts(userId);
  }

  seedReferenceFunding(
    idempotencyKey: string,
    input: ReferenceFundingRequest,
  ): FundingReceipt {
    if (!new Set(["development", "test"]).has(this.bankingEnvironment)) {
      throw conflictWithCode(
        "REFERENCE_FIXTURE_DISABLED",
        "Reference fixture funding chỉ được phép trong local development hoặc disposable test.",
      );
    }
    const normalizedKey = requireIdempotencyKey(idempotencyKey, 8);
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
      type: "SECURITY",
      title: "Tài khoản đã được nạp tiền",
      body: "Một khoản ghi có đã được cập nhật vào tài khoản.",
      resourceId: receipt.transactionId,
      resourceAccountId: target.accountId,
      read: false,
      createdAt: receipt.createdAt,
    });
    return { ...receipt, amount: { ...receipt.amount } };
  }

  seedReferenceCredit(userId: string): CreditCard[] {
    if (!new Set(["development", "test"]).has(this.bankingEnvironment)) {
      throw unauthorized("Reference fixture credit is disabled outside local development or disposable tests.");
    }
    if (!this.users.has(userId)) {
      throw notFound("Sandbox user not found.");
    }
    this.assertCreditVisible(userId);
    this.createCreditProduct(
      userId,
      nowIso(this.clock),
      BigInt(DEFAULT_POSTED_OUTSTANDING_MINOR),
      BigInt(DEFAULT_CREDIT_LIMIT_MINOR),
      "CREDIT_ACCOUNT_SEEDED",
    );
    return this.listCards(userId);
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
    filters?: TransactionListFilters,
  ): ListTransactionsResult {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw invalidRequest("limit must be an integer between 1 and 100.", {
        limit: "limit must be between 1 and 100.",
      });
    }

    const normalized = normalizeTransactionFilters(filters);
    const all = this.core.listTransactions(userId, accountId).filter((tx) => {
      if (normalized.status && tx.status !== normalized.status) return false;
      if (normalized.direction && tx.direction !== normalized.direction) return false;
      const occurredTs = Date.parse(tx.occurredAt);
      if (normalized.fromIso && occurredTs < Date.parse(normalized.fromIso)) return false;
      if (normalized.toIso && occurredTs > Date.parse(normalized.toIso)) return false;
      if (normalized.q) {
        const needle = normalized.q.toLowerCase();
        const hay = `${tx.reference}\n${tx.description}\n${tx.counterpartyName ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const page = paginateByKeyset(
      all,
      cursor,
      limit,
      "ACCOUNT_TRANSACTIONS",
      accountId,
      (transaction) => ({ sortValue: transaction.occurredAt, id: transaction.id }),
    );

    return {
      items: page.items.map((transaction) => this.toTransaction(transaction)),
      nextCursor: page.nextCursor,
    };
  }

  getAccountMonthlySummary(
    userId: string,
    accountId: string,
    month?: string,
  ): AccountMonthlySummary {
    const period = parseSummaryMonth(month, new Date(this.clock()));
    const transactions = this.core.listTransactions(userId, accountId);
    const startTs = Date.parse(period.startIso);
    const endTs = Date.parse(period.endIso);
    let totalIncome = 0n;
    let totalExpense = 0n;
    let creditCount = 0;
    let debitCount = 0;

    for (const tx of transactions) {
      if (tx.status !== "SUCCEEDED") continue;
      const occurredTs = Date.parse(tx.occurredAt);
      if (Number.isNaN(occurredTs) || occurredTs < startTs || occurredTs >= endTs) {
        continue;
      }
      const amount = BigInt(tx.amount.amountMinor);
      if (tx.direction === "CREDIT") {
        totalIncome += amount;
        creditCount += 1;
      } else {
        totalExpense += amount;
        debitCount += 1;
      }
    }

    return {
      accountId,
      month: period.month,
      monthLabel: period.monthLabel,
      currency: "VND",
      totalIncomeMinor: totalIncome.toString(),
      totalExpenseMinor: totalExpense.toString(),
      netMinor: (totalIncome - totalExpense).toString(),
      succeededCount: creditCount + debitCount,
      creditCount,
      debitCount,
    };
  }

  exportAccountStatement(
    userId: string,
    accountId: string,
    options?: { from?: string; to?: string; format?: string },
  ): AccountStatementExport {
    const account = this.core.getPaymentAccount(userId, accountId);
    const normalized = normalizeTransactionFilters({
      from: options?.from,
      to: options?.to,
    });
    const transactions = this.core
      .listTransactions(userId, accountId)
      .filter((tx) => {
        const occurredTs = Date.parse(tx.occurredAt);
        if (normalized.fromIso && occurredTs < Date.parse(normalized.fromIso)) return false;
        if (normalized.toIso && occurredTs > Date.parse(normalized.toIso)) return false;
        return true;
      })
      .slice(0, 1000);
    return buildAccountStatementExport({
      account,
      transactions,
      fromIso: normalized.fromIso,
      toIso: normalized.toIso,
      format: options?.format,
    });
  }

  getTransaction(userId: string, accountId: string, transactionId: string): TransactionDetail {
    return this.core.getTransaction(userId, accountId, transactionId);
  }

  listCards(userId: string): CreditCard[] {
    this.assertCreditVisible(userId);
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
    return [...this.creditAccounts.values()]
      .filter((account) => account.userId === userId)
      .map(toPublicCreditAccount);
  }

  listCreditApplications(userId: string): CreditApplication[] {
    this.assertCreditVisible(userId);
    return [...this.creditApplications.values()]
      .filter((application) => application.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(toPublicCreditApplication);
  }

  getCreditApplication(userId: string, applicationId: string): CreditApplication {
    this.assertCreditVisible(userId);
    const application = this.creditApplications.get(requireString(applicationId, "applicationId"));
    if (!application || application.userId !== userId) {
      throw notFound("Credit application not found.");
    }
    return toPublicCreditApplication(application);
  }

  submitCreditApplication(
    userId: string,
    idempotencyKey: string,
    input: CreditApplicationRequest,
    deviceId?: string,
  ): CreditApplication {
    this.assertCreditVisible(userId);
    const normalizedKey = requireIdempotencyKey(idempotencyKey, 8);
    const requestedLimitMinor = input.requestedLimit
      ? parseMoney(input.requestedLimit, "requestedLimit")
      : BigInt(DEFAULT_CREDIT_LIMIT_MINOR);
    if (requestedLimitMinor <= 0n || requestedLimitMinor > 100_000_000n) {
      throw conflict("Requested credit limit is outside the sandbox range.");
    }
    const requestFingerprint = fingerprint({ requestedLimitMinor: requestedLimitMinor.toString() });
    const scopedIdempotencyKey = `${userId}:${normalizedKey}`;
    const existingIdempotency = this.creditApplicationIdempotency.get(scopedIdempotencyKey);
    if (existingIdempotency) {
      if (
        existingIdempotency.userId !== userId ||
        existingIdempotency.fingerprint !== requestFingerprint
      ) {
        throw conflictWithCode(
          "IDEMPOTENCY_CONFLICT",
          "Credit application idempotency key was reused with a different request.",
        );
      }
      return this.getCreditApplication(userId, existingIdempotency.applicationId);
    }
    const current = [...this.creditApplications.values()].find(
      (application) =>
        application.userId === userId &&
        (application.status === "SUBMITTED" ||
          application.status === "UNDER_REVIEW" ||
          application.status === "PENDING_ACTIVATION" ||
          application.status === "ACTIVE"),
    );
    if (current) {
      if (current.requestFingerprint === requestFingerprint) {
        this.creditApplicationIdempotency.set(scopedIdempotencyKey, {
          userId,
          fingerprint: requestFingerprint,
          applicationId: current.applicationId,
        });
        return toPublicCreditApplication(current);
      }
      throw conflict("A credit application already exists for this user.");
    }
    this.verifyCreditStepUp(
      userId,
      input.stepUp,
      null,
      this.policy.creditPaymentStepUpMethods,
      deviceId,
      "CREDIT_APPLICATION",
      requestFingerprint,
    );
    const now = nowIso(this.clock);
    const application: CreditApplicationRecord = {
      applicationId: newCreditId(),
      requestedLimit: creditMoney(requestedLimitMinor),
      approvedLimit: null,
      status: "SUBMITTED",
      decisionReason: null,
      creditAccountId: null,
      createdAt: now,
      updatedAt: now,
      userId,
      requestFingerprint,
    };
    this.creditApplications.set(application.applicationId, application);
    this.creditApplicationIdempotency.set(scopedIdempotencyKey, {
      userId,
      fingerprint: requestFingerprint,
      applicationId: application.applicationId,
    });
    this.recordAudit("CREDIT_APPLICATION_SUBMITTED", userId, application.applicationId);
    this.enqueueOutbox("CREDIT_APPLICATION_SUBMITTED", application.applicationId, now);
    return toPublicCreditApplication(application);
  }

  /**
   * Reference-only bridge used by deterministic tests until the Admin API and
   * the customer-facing credit repository share the same relational record.
   * It deliberately requires the existing test-only step-up switch and never
   * runs in preview/production-like environments. Production decisions must
   * be made by the Admin four-eyes action executor.
   */
  applyReferenceCreditDecisionForTest(
    applicationId: string,
    decision: "PENDING_ACTIVATION" | "REJECTED",
    reasonCode = "REFERENCE_REVIEW",
    approvedLimit?: Money,
  ): CreditApplication {
    if (!this.allowUnsafeDirectSandboxStepUp || !new Set(["development", "test"]).has(this.bankingEnvironment)) {
      throw unauthorized("Reference credit decisions are disabled outside test fixtures.");
    }
    const application = this.creditApplications.get(requireString(applicationId, "applicationId"));
    if (!application) throw notFound("Credit application not found.");
    if (application.status !== "SUBMITTED" && application.status !== "UNDER_REVIEW") {
      throw conflict("Credit application is not awaiting a reference review.");
    }
    const now = nowIso(this.clock);
    const requested = BigInt(application.requestedLimit.amountMinor);
    const limit = approvedLimit ? parseMoney(approvedLimit, "approvedLimit") : requested;
    if (decision === "PENDING_ACTIVATION" && (limit <= 0n || limit > requested)) {
      throw conflict("Approved credit limit is outside the requested limit.");
    }
    application.status = decision;
    application.approvedLimit = decision === "PENDING_ACTIVATION" ? creditMoney(limit) : null;
    application.decisionReason = requireBoundedString(reasonCode, "reasonCode", 80);
    application.updatedAt = now;
    this.recordAudit("CREDIT_APPLICATION_REFERENCE_DECISION", application.userId, application.applicationId);
    this.enqueueOutbox(
      decision === "PENDING_ACTIVATION" ? "CREDIT_APPLICATION_APPROVED" : "CREDIT_APPLICATION_REJECTED",
      application.applicationId,
      now,
    );
    return toPublicCreditApplication(application);
  }

  activateCreditApplication(
    userId: string,
    applicationId: string,
    idempotencyKey: string,
    input: { stepUp: { method: StepUpMethod; proof: string; challengeId?: string } },
    deviceId?: string,
  ): CreditApplication {
    this.assertCreditVisible(userId);
    const normalizedKey = requireIdempotencyKey(idempotencyKey, 8);
    const application = this.creditApplications.get(requireString(applicationId, "applicationId"));
    if (!application || application.userId !== userId) {
      throw notFound("Credit application not found.");
    }
    const requestFingerprint = fingerprint({ applicationId });
    const scopedIdempotencyKey = `${userId}:${normalizedKey}`;
    const existingIdempotency = this.creditActivationIdempotency.get(scopedIdempotencyKey);
    if (existingIdempotency) {
      if (
        existingIdempotency.userId !== userId ||
        existingIdempotency.fingerprint !== requestFingerprint ||
        existingIdempotency.applicationId !== applicationId
      ) {
        throw conflictWithCode(
          "IDEMPOTENCY_CONFLICT",
          "Credit activation idempotency key was reused with a different request.",
        );
      }
      return this.getCreditApplication(userId, applicationId);
    }
    if (application.status === "ACTIVE") {
      this.creditActivationIdempotency.set(scopedIdempotencyKey, {
        userId,
        fingerprint: requestFingerprint,
        applicationId,
      });
      return toPublicCreditApplication(application);
    }
    if (application.status !== "PENDING_ACTIVATION") {
      throw conflict("Credit application cannot be activated.");
    }
    this.verifyCreditStepUp(
      userId,
      input.stepUp,
      applicationId,
      this.policy.creditPaymentStepUpMethods,
      deviceId,
      "CARD_ACTIVATION",
      requestFingerprint,
    );
    const now = nowIso(this.clock);
    const creditAccountId = this.createCreditProduct(
      userId,
      now,
      0n,
      BigInt(application.approvedLimit?.amountMinor ?? application.requestedLimit.amountMinor),
      "CREDIT_ACCOUNT_ACTIVATED",
    );
    application.status = "ACTIVE";
    application.creditAccountId = creditAccountId;
    application.updatedAt = now;
    this.creditActivationIdempotency.set(scopedIdempotencyKey, {
      userId,
      fingerprint: requestFingerprint,
      applicationId,
    });
    this.recordAudit("CREDIT_APPLICATION_ACTIVATED", userId, applicationId);
    this.enqueueOutbox("CREDIT_APPLICATION_ACTIVATED", applicationId, now);
    return toPublicCreditApplication(application);
  }

  getCard(userId: string, cardId: string): {
    card: CreditCard;
    creditAccount: CreditAccount;
    latestStatement: CreditStatement | null;
  } {
    this.assertCreditVisible(userId);
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
    return toPublicCreditAccount(this.requireCreditAccount(userId, creditAccountId));
  }

  listCreditTransactions(
    userId: string,
    creditAccountId: string,
    cursor?: string,
    limit = 20,
  ): CreditTransactionsResult {
    this.assertCreditVisible(userId);
    this.requireCreditAccount(userId, creditAccountId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw invalidRequest("limit must be an integer between 1 and 100.", {
        limit: "limit must be between 1 and 100.",
      });
    }
    const all = [...this.creditTransactions.values()]
      .filter((transaction) => transaction.userId === userId && transaction.creditAccountId === creditAccountId);
    const page = paginateByKeyset(
      all,
      cursor,
      limit,
      "CREDIT_TRANSACTIONS",
      creditAccountId,
      (transaction) => ({
        sortValue: transaction.occurredAt,
        id: transaction.transactionId,
      }),
    );
    const items = page.items.map((transaction) => {
      const { userId: _userId, ...publicTransaction } = transaction;
      return cloneCreditTransaction(publicTransaction);
    });
    return { items, nextCursor: page.nextCursor };
  }

  listCreditStatements(
    userId: string,
    creditAccountId: string,
    cursor?: string,
    limit = 20,
  ): CreditStatementsResult {
    this.assertCreditVisible(userId);
    this.requireCreditAccount(userId, creditAccountId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw invalidRequest("limit must be an integer between 1 and 100.", {
        limit: "limit must be between 1 and 100.",
      });
    }
    const all = [...this.creditStatements.values()]
      .filter((statement) => statement.userId === userId && statement.creditAccountId === creditAccountId);
    const page = paginateByKeyset(
      all,
      cursor,
      limit,
      "CREDIT_STATEMENTS",
      creditAccountId,
      (statement) => ({ sortValue: statement.issuedAt, id: statement.statementId }),
    );
    return {
      items: page.items.map(toPublicCreditStatement),
      nextCursor: page.nextCursor,
    };
  }

  getCreditStatement(userId: string, creditAccountId: string, statementId: string): CreditStatement {
    this.assertCreditVisible(userId);
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
    const latestStatement = this.findLatestCreditStatement(creditAccountId);
    if (!latestStatement || latestStatement.statementId !== statement.statementId) {
      throw conflictWithCode(
        "STATEMENT_SUPERSEDED",
        "Sao kê này đã được chuyển sang kỳ mới; hãy thanh toán trên sao kê hiện tại.",
      );
    }
    if (
      [...this.creditPayments.values()].some(
        (payment) =>
          payment.userId === userId &&
          payment.creditAccountId === creditAccountId &&
          payment.status === "PENDING",
      )
    ) {
      throw conflictWithCode(
        "PAYMENT_PENDING",
        "Một khoản thanh toán tín dụng đang được xử lý; hãy chờ kết quả trước khi tạo lệnh mới.",
      );
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
    const outstandingMinor = BigInt(account.postedOutstanding.amountMinor);
    if (amountMinor > outstandingMinor) {
      throw conflictWithCode("OVERPAYMENT", "Không thể thanh toán vượt dư nợ tài khoản tín dụng.");
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
      outstandingAfter: creditMoney(outstandingMinor - amountMinor),
      minimumPaymentRemainingBefore: cloneMoney(statement.minimumPaymentRemaining),
      minimumPaymentRemainingAfter: creditMoney(
        BigInt(statement.minimumPaymentRemaining.amountMinor) - amountMinor > 0n
          ? BigInt(statement.minimumPaymentRemaining.amountMinor) - amountMinor
          : 0n,
      ),
      terms: "Đây là thanh toán tín dụng sandbox; không phải nghĩa vụ tín dụng thật.",
      expiresAt: new Date(this.clock() + CREDIT_QUOTE_TTL_MS).toISOString(),
    };
    const requestFingerprint = fingerprint({ quoteId: quote.quoteId });
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
    const quoteId = requireString(request.quoteId, "quoteId");
    this.cleanupExpiredState(new Set([quoteId]));
    const normalizedKey = requireIdempotencyKey(idempotencyKey, 16);
    const requestFingerprint = fingerprint({ quoteId });
    const existing = this.creditIdempotency.get(`${userId}:${normalizedKey}`);
    if (existing) {
      if (existing.fingerprint !== requestFingerprint) {
        throw conflictWithCode("IDEMPOTENCY_CONFLICT", "Idempotency-Key đã được dùng cho yêu cầu khác.");
      }
      const payment = this.creditPayments.get(existing.paymentId);
      if (!payment) {
        throw conflictWithCode(
          "IDEMPOTENCY_STATE_MISSING",
          "Đã tìm thấy khóa yêu cầu nhưng thiếu bản ghi thanh toán; cần đối soát thủ công.",
        );
      }
      return this.getCreditPayment(userId, payment.paymentId);
    }
    this.assertCreditPaymentAvailable(userId);
    const quote = this.creditQuotes.get(quoteId);
    if (!quote || quote.userId !== userId) {
      throw notFound("Credit payment quote not found.");
    }
    if (quote.consumedPaymentId) {
      const payment = this.creditPayments.get(quote.consumedPaymentId);
      if (!payment || payment.userId !== userId) {
        throw conflictWithCode(
          "IDEMPOTENCY_STATE_MISSING",
          "Báo giá đã được dùng nhưng thiếu bản ghi thanh toán; cần đối soát thủ công.",
        );
      }
      this.creditIdempotency.set(`${userId}:${normalizedKey}`, {
        userId,
        fingerprint: requestFingerprint,
        paymentId: payment.paymentId,
      });
      return this.getCreditPayment(userId, payment.paymentId);
    }
    if (Date.parse(quote.expiresAt) <= this.clock()) {
      throw conflictWithCode("QUOTE_EXPIRED", "Báo giá thanh toán đã hết hạn.");
    }
    const statement = this.creditStatements.get(quote.statementId);
    if (!statement || statement.version !== quote.statementVersion) {
      throw conflictWithCode("STATEMENT_CHANGED", "Sao kê đã thay đổi; hãy tạo báo giá mới.");
    }
    const latestStatement = this.findLatestCreditStatement(quote.creditAccountId);
    if (!latestStatement || latestStatement.statementId !== statement.statementId) {
      throw conflictWithCode(
        "STATEMENT_SUPERSEDED",
        "Sao kê này đã được chuyển sang kỳ mới; hãy tạo báo giá trên sao kê hiện tại.",
      );
    }
    if (
      [...this.creditPayments.values()].some(
        (payment) =>
          payment.userId === userId &&
          payment.creditAccountId === quote.creditAccountId &&
          payment.status === "PENDING",
      )
    ) {
      throw conflictWithCode(
        "PAYMENT_PENDING",
        "Một khoản thanh toán tín dụng đang được xử lý; chưa thể gửi lệnh mới.",
      );
    }
    const creditAccount = this.requireCreditAccount(userId, quote.creditAccountId);
    const paymentAmountMinor = BigInt(quote.amount.amountMinor);
    if (
      paymentAmountMinor > BigInt(creditAccount.postedOutstanding.amountMinor) ||
      paymentAmountMinor > BigInt(statement.remainingAmountDue.amountMinor)
    ) {
      throw conflictWithCode(
        "OVERPAYMENT",
        "Khoản thanh toán vượt nghĩa vụ tín dụng hiện tại; hãy tạo báo giá mới.",
      );
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
    return toPublicCreditPayment(payment);
  }

  settleCreditPayment(userId: string, paymentId: string): CreditPayment {
    return this.transitionCreditPayment(userId, paymentId, "SUCCEEDED");
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

    const productMaxAmountMinor = BigInt(product.maxAmountMinor);
    const policyMaxAmountMinor = BigInt(this.policy.maxSavingsAmountMinor);
    const maxAmountMinor =
      productMaxAmountMinor < policyMaxAmountMinor
        ? productMaxAmountMinor
        : policyMaxAmountMinor;
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
      fingerprint: fingerprint({ quoteId: quote.quoteId }),
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
    const quoteId = requireString(request.quoteId, "quoteId");
    this.cleanupExpiredState(new Set([quoteId]));
    const normalizedKey = requireIdempotencyKey(idempotencyKey, 16);
    const requestFingerprint = fingerprint({ quoteId });
    const idempotencyMapKey = `${userId}:${normalizedKey}`;
    const existing = this.savingsIdempotency.get(idempotencyMapKey);
    if (existing) {
      if (existing.fingerprint !== requestFingerprint) {
        throw conflictWithCode(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was reused with a different request.",
        );
      }
      const existingOpening = this.savingsOpenings.get(existing.openingId);
      if (!existingOpening) {
        throw conflictWithCode(
          "IDEMPOTENCY_STATE_MISSING",
          "Đã tìm thấy khóa yêu cầu nhưng thiếu bản ghi mở khoản; cần đối soát thủ công.",
        );
      }
      return toPublicSavingsOpening(existingOpening);
    }
    this.assertSavingsAvailable(userId);
    const quoteRecord = this.savingsQuotes.get(quoteId);
    if (!quoteRecord || quoteRecord.userId !== userId) {
      throw notFound("Savings quote not found.");
    }
    if (quoteRecord.consumedOpeningId) {
      const opening = this.savingsOpenings.get(quoteRecord.consumedOpeningId);
      if (!opening || opening.userId !== userId) {
        throw conflictWithCode(
          "IDEMPOTENCY_STATE_MISSING",
          "The quote was consumed but its savings opening is missing; manual reconciliation is required.",
        );
      }
      this.savingsIdempotency.set(idempotencyMapKey, {
        userId,
        fingerprint: requestFingerprint,
        openingId: opening.openingId,
      });
      return toPublicSavingsOpening(opening);
    }
    if (Date.parse(quoteRecord.expiresAt) <= this.clock()) {
      throw conflictWithCode("QUOTE_EXPIRED", "Savings quote has expired.");
    }

    const stepUpRateKey = `savings-step-up:${userId}`;
    this.assertSavingsStepUpAttemptAllowed(stepUpRateKey);
    const stepUp = request.stepUp;
    if (
      !stepUp ||
      (stepUp.method !== "OTP" && stepUp.method !== "TOTP" && stepUp.method !== "BIOMETRIC") ||
      typeof stepUp.proof !== "string" ||
      !stepUp.proof.trim()
    ) {
      this.recordSavingsStepUpFailure(stepUpRateKey);
      throw invalidRequest("stepUp proof is required.");
    }
    if (!this.isStepUpMethodEnabledForRequest(userId, deviceId, stepUp, this.policy.savingsStepUpMethods)) {
      throw conflict("The requested step-up method is not enabled.");
    }
    try {
      if (stepUp.challengeId) {
        const externallyVerified = this.consumeExternalStepUpVerification({
          userId,
          challengeId: stepUp.challengeId,
          deviceId,
          method: stepUp.method,
          purpose: "SAVINGS_OPENING",
          resourceId: quoteRecord.quoteId,
          requestFingerprint,
        });
        if (!externallyVerified) {
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
        }
      } else if (
        !this.allowUnsafeDirectSandboxStepUp ||
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
      rethrowFinancialStepUpFailure(error);
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
    return toPublicSavingsOpening(opening);
  }

  settleSavingsOpening(userId: string, openingId: string): SavingsOpening {
    return this.transitionSavingsOpening(userId, openingId, "SUCCEEDED");
  }

  failSavingsOpening(userId: string, openingId: string): SavingsOpening {
    return this.transitionSavingsOpening(userId, openingId, "FAILED");
  }

  listSavingsDeposits(userId: string): SavingsListResult {
    this.assertSavingsAvailable(userId);
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

  updateSavingsDepositMaturityInstruction(
    userId: string,
    depositId: string,
    maturityInstruction: MaturityInstruction,
  ): SavingsDeposit {
    this.assertSavingsAvailable(userId);
    const deposit = this.savingsDeposits.get(depositId);
    if (!deposit || deposit.userId !== userId) {
      throw notFound("Savings deposit not found.");
    }
    if (deposit.status !== "ACTIVE") {
      throw conflict("Only ACTIVE savings deposits can update maturity instruction.");
    }
    deposit.maturityInstruction = maturityInstruction;
    deposit.updatedAt = new Date(this.clock()).toISOString();
    return toPublicSavingsDeposit(deposit);
  }

  withdrawSavingsDepositEarly(
    userId: string,
    depositId: string,
    idempotencyKey?: string,
  ): SavingsWithdrawalReceipt {
    this.assertSavingsAvailable(userId);
    const deposit = this.savingsDeposits.get(depositId);
    if (!deposit || deposit.userId !== userId) {
      throw notFound("Savings deposit not found.");
    }
    if (deposit.status !== "ACTIVE") {
      throw conflict("Only ACTIVE savings deposits can be withdrawn.");
    }
    const now = new Date(this.clock()).toISOString();
    const principalMinor = BigInt(deposit.principal.amountMinor);
    const calc = calculateEarlyWithdrawal(principalMinor, deposit.openedAt, now);
    const payoutMinor = BigInt(calc.totalPayout.amountMinor);
    const interestMinor = BigInt(calc.earlyInterest.amountMinor);
    const key = idempotencyKey?.trim() || `early-wth:${depositId}`;

    const maturityInput: CoreSavingsMaturityInput = {
      idempotencyKey: key,
      depositId: deposit.depositId,
      accountId: deposit.sourceAccountId,
      principalMinor,
      interestMinor,
      creditToPaymentMinor: payoutMinor,
      newSavingsPrincipalMinor: 0n,
      now,
      description: `Tất toán trước hạn tiết kiệm ${deposit.productName}`,
    };
    this.core.postSavingsMaturity(userId, maturityInput);

    deposit.status = "CLOSED";
    deposit.updatedAt = now;
    deposit.earlyWithdrawnAt = now;
    deposit.earlyInterest = calc.earlyInterest;

    const reference = `WTH-${deposit.depositId.slice(-12).toUpperCase()}`;
    return {
      depositId: deposit.depositId,
      sourceAccountId: deposit.sourceAccountId,
      principal: deposit.principal,
      interestDays: calc.interestDays,
      demandRateBasisPoints: calc.demandRateBasisPoints,
      earlyInterest: calc.earlyInterest,
      totalPayout: calc.totalPayout,
      status: "CLOSED",
      reference,
      withdrawnAt: now,
    };
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
      const ownedAccounts = this.listAccounts(userId).filter(
        (a) => a.id !== target.accountId && a.status === "ACTIVE",
      );
      if (ownedAccounts.length === 0) {
        throw conflict("Không thể chuyển tiền cho chính tài khoản của mình.");
      }
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
    if (destinationAccountId === sourceAccountId) {
      throw conflict("A transfer cannot be sent to the source account.");
    }

    const feeMinor = 1_000n;
    const now = nowIso(this.clock);
    const isSavedBeneficiary = Boolean(
      this.beneficiaries
        .get(userId)
        ?.some((item) => item.destinationAccountId === destinationAccountId),
    );
    const anomalyAssessment = this.evaluateInMemoryTransferAnomaly({
      userId,
      sourceAccountId,
      destinationAccountId,
      amountMinor,
      feeMinor,
      isSavedBeneficiary,
      occurredAt: now,
    });
    const quote: TransferQuote = {
      quoteId: createId("quote"),
      sourceAccountId,
      beneficiary: { ...beneficiary },
      amount: toMoney(amountMinor),
      fee: toMoney(feeMinor),
      totalDebit: toMoney(amountMinor + feeMinor),
      expiresAt: new Date(this.clock() + QUOTE_TTL_MS).toISOString(),
      anomalyAssessment,
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
    const quoteId = requireString(request.quoteId, "quoteId");
    this.cleanupExpiredState(new Set([quoteId]));
    const normalizedKey = requireIdempotencyKey(idempotencyKey, 16);
    const requestFingerprint = fingerprint({ quoteId });
    const existing = this.idempotency.get(`${userId}:${normalizedKey}`);
    if (existing) {
      if (existing.fingerprint !== requestFingerprint) {
        throw conflictWithCode(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was reused with a different request.",
        );
      }
      return this.requireCanonicalTransferForReplay(userId, existing.receipt.transferId);
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
    if (quoteRecord.consumedTransferId) {
      const receipt = this.requireCanonicalTransferForReplay(
        userId,
        quoteRecord.consumedTransferId,
      );
      this.idempotency.set(`${userId}:${normalizedKey}`, {
        userId,
        fingerprint: requestFingerprint,
        receipt: cloneReceipt(receipt),
      });
      return receipt;
    }
    if (Date.parse(quoteRecord.quote.expiresAt) <= this.clock()) {
      throw conflictWithCode("QUOTE_EXPIRED", "Transfer quote has expired.");
    }

    const stepUpRateKey = `transfer-step-up:${userId}`;
    this.assertTransferStepUpAttemptAllowed(stepUpRateKey);
    const stepUp = request.stepUp;
    if (
      !stepUp ||
      (stepUp.method !== "OTP" && stepUp.method !== "TOTP" && stepUp.method !== "BIOMETRIC") ||
      typeof stepUp.proof !== "string" ||
      !stepUp.proof.trim()
    ) {
      this.recordTransferStepUpFailure(stepUpRateKey);
      throw invalidRequest("stepUp proof is required.");
    }
    if (!this.isStepUpMethodEnabledForRequest(userId, deviceId, stepUp, this.policy.stepUpMethods)) {
      throw conflict("The requested step-up method is not enabled.");
    }
    const transferContextFingerprint = fingerprint({
      quoteId,
      amountMinor: quoteRecord.quote.amount.amountMinor,
    });
    try {
      if (stepUp.challengeId) {
        const externallyVerified = this.consumeExternalStepUpVerification({
          userId,
          challengeId: stepUp.challengeId,
          deviceId,
          method: stepUp.method,
          purpose: "TRANSFER",
          resourceId: quoteId,
          requestFingerprint: transferContextFingerprint,
        });
        if (!externallyVerified) {
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
        }
      } else if (
        !this.allowUnsafeDirectSandboxStepUp ||
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
      rethrowFinancialStepUpFailure(error);
    }

    this.transferStepUpAttemptWindows.delete(stepUpRateKey);
    this.recordAudit("TRANSFER_STEP_UP_VERIFIED", userId, quoteRecord.quote.quoteId);

    const now = nowIso(this.clock);
    const amountMinor = BigInt(quoteRecord.quote.amount.amountMinor);
    const feeMinor = BigInt(quoteRecord.quote.fee.amountMinor);
    const isSavedBeneficiary = Boolean(
      this.beneficiaries
        .get(userId)
        ?.some((item) => item.destinationAccountId === quoteRecord.destinationAccountId),
    );
    const anomalyAssessment = this.evaluateInMemoryTransferAnomaly({
      userId,
      sourceAccountId: quoteRecord.quote.sourceAccountId,
      destinationAccountId: quoteRecord.destinationAccountId,
      amountMinor,
      feeMinor,
      isSavedBeneficiary,
      occurredAt: now,
    });
    if (anomalyAssessment.riskLevel === "CRITICAL" && !request.confirmHighRisk) {
      throw conflictWithCode(
        "CRITICAL_ANOMALY_BLOCKED",
        "Giao dịch có dấu hiệu bất thường nghiêm trọng (CRITICAL) và đã bị chặn theo chính sách an toàn.",
      );
    }

    const rawReceipt = this.core.postTransfer(userId, {
      accountId: quoteRecord.quote.sourceAccountId,
      destinationAccountId: quoteRecord.destinationAccountId,
      destinationOwnerId: quoteRecord.destinationOwnerId,
      amountMinor,
      feeMinor,
      counterpartyName: quoteRecord.quote.beneficiary.displayName,
      description: `Chuyển tiền đến ${quoteRecord.quote.beneficiary.displayName}`,
      now,
      settleImmediately: this.settleTransfersImmediately,
    });
    const receipt: TransferReceipt = {
      ...rawReceipt,
      anomalyAssessment,
    };
    const transferTarget = this.core.getTransferTarget(userId, receipt.transferId);
    quoteRecord.consumedTransferId = receipt.transferId;
    for (const [hash, lookup] of this.recipientLookups.entries()) {
      if (lookup.userId === userId && lookup.destinationAccountId === quoteRecord.destinationAccountId) {
        this.recipientLookups.delete(hash);
      }
    }
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
    if (anomalyAssessment.flagged && anomalyAssessment.riskLevel !== "LOW") {
      const anomalyRecord: TransactionAnomaly = {
        id: createId("anomaly"),
        customerId: userId,
        accountId: quoteRecord.quote.sourceAccountId,
        transferId: receipt.transferId,
        transactionId: transferTarget.transactionId,
        amount: { ...receipt.amount },
        counterpartyName: quoteRecord.quote.beneficiary.displayName,
        maskedDestinationAccount: quoteRecord.quote.beneficiary.maskedAccountNumber,
        riskLevel: anomalyAssessment.riskLevel,
        riskScore: anomalyAssessment.riskScore,
        ruleCodes: anomalyAssessment.flags.map((flag) => flag.code),
        summary: anomalyAssessment.summary,
        flags: anomalyAssessment.flags.map((flag) => ({ ...flag })),
        status: "OPEN",
        customerNote: null,
        acknowledgedAt: null,
        resolutionCode: null,
        resolvedAt: null,
        createdAt: receipt.createdAt,
        updatedAt: receipt.updatedAt,
      };
      this.transactionAnomalies.set(anomalyRecord.id, anomalyRecord);
      this.recordAudit("TRANSACTION_ANOMALY_DETECTED", userId, anomalyRecord.id);
      this.enqueueOutbox("SECURITY_ANOMALY_DETECTED", anomalyRecord.id, receipt.updatedAt);
      const userNotifications = this.notifications.get(userId);
      if (userNotifications) {
        userNotifications.splice(1, 0, {
          id: createId("notification"),
          type: "SECURITY",
          title: "Cảnh báo giao dịch bất thường",
          body: anomalyAssessment.summary,
          resourceId: anomalyRecord.id,
          resourceAccountId: null,
          read: false,
          createdAt: receipt.updatedAt,
        });
      }
    }
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

  private requireCanonicalTransferForReplay(
    userId: string,
    transferId: string,
  ): TransferReceipt {
    const canonical = this.transfers.get(transferId);
    if (!canonical || canonical.userId !== userId) {
      throw conflictWithCode(
        "IDEMPOTENCY_STATE_MISSING",
        "The transfer recovery record is missing; manual reconciliation is required.",
      );
    }
    try {
      this.core.getTransferTarget(userId, transferId);
    } catch (error) {
      if (error instanceof DomainError && error.status === 404) {
        throw conflictWithCode(
          "IDEMPOTENCY_STATE_MISSING",
          "The core transfer recovery record is missing; manual reconciliation is required.",
        );
      }
      throw error;
    }
    return cloneReceipt(canonical.receipt);
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

  runReferenceScheduledWork(
    userId?: string,
  ): {
    usersProcessed: number;
    transfersSettled: number;
    savingsOpeningsSettled: number;
    creditPaymentsSettled: number;
    savingsMaturities: number;
    creditStatements: number;
  } {
    if (!new Set(["development", "test"]).has(this.bankingEnvironment)) {
      throw unauthorized("Reference scheduled work is disabled outside local development or disposable tests.");
    }
    const targetUserIds = userId
      ? [requireString(userId, "userId")]
      : [...this.users.keys()];
    if (userId && !this.users.has(userId)) {
      throw notFound("Sandbox user not found.");
    }
    let transfersSettled = 0;
    let savingsOpeningsSettled = 0;
    let creditPaymentsSettled = 0;
    let savingsMaturities = 0;
    let creditStatements = 0;
    for (const targetUserId of targetUserIds) {
      for (const [transferId, transfer] of this.transfers) {
        if (transfer.userId === targetUserId && transfer.receipt.status === "PENDING") {
          this.settleTransfer(targetUserId, transferId);
          transfersSettled += 1;
        }
      }
      for (const [openingId, opening] of this.savingsOpenings) {
        if (opening.userId === targetUserId && opening.status === "PENDING") {
          this.settleSavingsOpening(targetUserId, openingId);
          savingsOpeningsSettled += 1;
        }
      }
      for (const [paymentId, payment] of this.creditPayments) {
        if (payment.userId === targetUserId && payment.status === "PENDING") {
          this.settleCreditPayment(targetUserId, paymentId);
          creditPaymentsSettled += 1;
        }
      }
      savingsMaturities += this.processSavingsMaturities(targetUserId);
      creditStatements += this.processCreditStatements(targetUserId);
    }
    return {
      usersProcessed: targetUserIds.length,
      transfersSettled,
      savingsOpeningsSettled,
      creditPaymentsSettled,
      savingsMaturities,
      creditStatements,
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
        (row) => row.differenceMinor !== "0" || !row.invariantValid,
      );
      const hasSavingsMismatch = this.reconcileSavings().some(
        (row) => row.differenceMinor !== "0" || !row.invariantValid,
      );
      const reconciliationStatus = hasMismatch ? "mismatch" : "ok";
      return {
        status:
          hasMismatch || hasCreditMismatch || hasSavingsMismatch || outboxStatus === "degraded"
            ? "degraded"
            : "ok",
        checkedAt: nowIso(this.clock),
        reconciliation:
          hasMismatch || hasCreditMismatch || hasSavingsMismatch
            ? "mismatch"
            : reconciliationStatus,
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

  private transitionSavingsOpening(
    userId: string,
    openingId: string,
    status: "SUCCEEDED" | "FAILED",
  ): SavingsOpening {
    const opening = this.savingsOpenings.get(requireString(openingId, "openingId"));
    if (!opening || opening.userId !== userId) {
      throw notFound("Savings opening not found.");
    }
    if (opening.status === status) {
      return toPublicSavingsOpening(opening);
    }
    if (opening.status !== "PENDING") {
      throw conflict("A terminal savings opening cannot change state.");
    }
    const receipt = this.core.transitionSavingsOpening(
      userId,
      opening.openingId,
      status,
      nowIso(this.clock),
    );
    opening.status = receipt.status;
    opening.reference = receipt.reference;
    opening.failureReason = receipt.status === "FAILED"
      ? "SANDBOX_SETTLEMENT_FAILED"
      : null;
    opening.updatedAt = receipt.updatedAt;
    if (receipt.status === "SUCCEEDED") {
      const quote = this.savingsQuotes.get(opening.quoteId);
      if (!quote) {
        throw notFound("Savings quote not found.");
      }
      this.createSavingsDepositFromOpening(quote, opening);
    }
    this.recordAudit(`SAVINGS_OPENING_${receipt.status}`, userId, opening.openingId);
    this.enqueueOutbox(
      `SAVINGS_OPENING_${receipt.status}`,
      opening.openingId,
      receipt.updatedAt,
    );
    this.notifications.get(userId)?.unshift({
      id: createId("notification"),
      type: "SAVINGS",
      title: receipt.status === "SUCCEEDED"
        ? "Mở tiết kiệm thành công"
        : "Mở tiết kiệm không thành công",
      body: receipt.status === "SUCCEEDED"
        ? `Yêu cầu ${receipt.reference} đã được ghi nhận.`
        : `Yêu cầu ${receipt.reference} đã thất bại và số tiền giữ chỗ được hoàn lại.`,
      resourceId: receipt.status === "SUCCEEDED" ? opening.depositId : opening.openingId,
      resourceAccountId: null,
      read: false,
      createdAt: receipt.updatedAt,
    });
    return toPublicSavingsOpening(opening);
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

  private processSavingsMaturities(userId: string): number {
    const now = this.clock();
    let processed = 0;
    for (let iteration = 0; iteration < 240; iteration += 1) {
      const deposit = [...this.savingsDeposits.values()]
        .filter(
          (candidate) =>
            candidate.userId === userId &&
            candidate.status === "ACTIVE" &&
            Date.parse(candidate.maturityAt) <= now,
        )
        .sort((left, right) => left.maturityAt.localeCompare(right.maturityAt))[0];
      if (!deposit) break;

      const principalMinor = BigInt(deposit.principal.amountMinor);
      const interestMinor = BigInt(deposit.expectedInterest.amountMinor);
      const renews = deposit.maturityInstruction !== "RETURN_PRINCIPAL_AND_INTEREST";
      const maturityKey = `${deposit.depositId}:${deposit.maturityAt}`;
      const requestedNewDepositId = renews
        ? deterministicUuid(`savings-renewal:${maturityKey}`)
        : undefined;
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
        idempotencyKey: maturityKey,
        depositId: deposit.depositId,
        newDepositId: requestedNewDepositId,
        accountId: deposit.sourceAccountId,
        principalMinor,
        interestMinor,
        creditToPaymentMinor,
        newSavingsPrincipalMinor: newPrincipalMinor,
        now: nowIso(this.clock),
        description: "Tất toán tiền gửi tiết kiệm sandbox",
      };
      const receipt = this.core.postSavingsMaturity(userId, maturityInput);
      const newDepositId = receipt.newDepositId ?? undefined;

      deposit.status = renews ? "CLOSED" : "MATURED";
      deposit.renewedDepositId = newDepositId ?? null;
      deposit.updatedAt = receipt.occurredAt;
      if (newDepositId) {
        const product = this.savingsProducts.find(
          (candidate) =>
            candidate.productId === deposit.productId &&
            candidate.status === "ACTIVE",
        );
        const openedAt = deposit.maturityAt;
        const termMonths = product?.termMonths ?? deposit.termMonths;
        const maturityAt = addMonthsClamped(openedAt, termMonths);
        const interestDays = calculateActualDays(openedAt, maturityAt);
        const annualRateBasisPoints =
          product?.annualRateBasisPoints ?? deposit.annualRateBasisPoints;
        const renewedInterestMinor = calculateSavingsInterest(
          newPrincipalMinor,
          annualRateBasisPoints,
          interestDays,
        );
        this.savingsDeposits.set(newDepositId, {
          ...deposit,
          depositId: newDepositId,
          productName: product?.name ?? deposit.productName,
          termsVersion: product?.termsVersion ?? deposit.termsVersion,
          termMonths,
          principal: toMoney(newPrincipalMinor),
          annualRateBasisPoints,
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

      processed += 1;
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
    if (
      [...this.savingsDeposits.values()].some(
        (deposit) =>
          deposit.userId === userId &&
          deposit.status === "ACTIVE" &&
          Date.parse(deposit.maturityAt) <= now,
      )
    ) {
      this.recordAudit("SAVINGS_MATURITY_BACKLOG", userId, null);
    }
    return processed;
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

  private createCreditProduct(
    userId: string,
    now: string,
    openingOutstandingMinor = BigInt(DEFAULT_POSTED_OUTSTANDING_MINOR),
    creditLimitMinor = BigInt(DEFAULT_CREDIT_LIMIT_MINOR),
    auditEvent = "CREDIT_ACCOUNT_ACTIVATED",
  ): string {
    const existing = [...this.creditAccounts.values()].some((account) => account.userId === userId);
    if (existing) {
      return [...this.creditAccounts.values()].find((account) => account.userId === userId)!.creditAccountId;
    }
    const creditAccountId = newCreditId();
    const cardId = newCreditId();
    const statementId = newCreditId();
    const transactionId = newCreditId();
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
      status: openingOutstandingMinor === 0n ? "PAID" : "ISSUED",
      version: 1,
      items: openingOutstandingMinor > 0n ? [cloneCreditTransaction(transaction)] : [],
      payments: [],
      userId,
    };
    if (openingOutstandingMinor > 0n) {
      this.core.seedCreditPurchase(creditAccountId, openingOutstandingMinor, now);
    }
    this.creditAccounts.set(creditAccountId, account);
    this.creditCards.set(cardId, card);
    if (openingOutstandingMinor > 0n) {
      this.creditTransactions.set(transactionId, transaction);
    }
    this.creditStatements.set(statementId, statement);
    if (openingOutstandingMinor > 0n) {
      this.creditSeedPurchases.set(creditAccountId, {
        userId,
        creditAccountId,
        transactionId,
      });
    }
    this.recordAudit(auditEvent, userId, creditAccountId);
    return creditAccountId;
  }

  private refreshCreditStatementStatus(statement: CreditStatementRecord): void {
    const nextStatus = getStatementStatus(
      BigInt(statement.remainingAmountDue.amountMinor),
      BigInt(statement.minimumPaymentRemaining.amountMinor),
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

  private processCreditStatements(userId: string): number {
    const now = this.clock();
    let processed = 0;
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
        processed += 1;
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
    return processed;
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
    if (
      amountMinor > currentOutstanding ||
      amountMinor > BigInt(statement.remainingAmountDue.amountMinor)
    ) {
      throw conflictWithCode(
        "CREDIT_INVARIANT_VIOLATION",
        "Thanh toán sẽ làm dư nợ tín dụng âm; cần đối soát thủ công.",
      );
    }
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
    payment.creditApplied = true;
    this.recomputeCreditStatementPaymentTotals(statement);
    statement.version += 1;
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
      payment.creditApplied = false;
      this.recomputeCreditStatementPaymentTotals(statement);
      statement.version += 1;
      const paymentIndex = statement.payments.findIndex(
        (item) => item.paymentId === payment.paymentId,
      );
      const reversedPayment = toPublicCreditPayment(payment);
      if (paymentIndex >= 0) statement.payments[paymentIndex] = reversedPayment;
      else statement.payments.push(reversedPayment);
    }
    payment.creditApplied = false;
  }

  private recomputeCreditStatementPaymentTotals(
    statement: CreditStatementRecord,
  ): void {
    const validPaid = [...this.creditPayments.values()]
      .filter(
        (payment) =>
          payment.statementId === statement.statementId &&
          payment.status === "SUCCEEDED" &&
          payment.creditApplied,
      )
      .reduce((total, payment) => total + BigInt(payment.amount.amountMinor), 0n);
    const closingBalance = BigInt(statement.closingBalance.amountMinor);
    const minimumDue = BigInt(statement.minimumPaymentDue.amountMinor);
    statement.paidAmount = creditMoney(validPaid);
    statement.remainingAmountDue = creditMoney(
      closingBalance > validPaid ? closingBalance - validPaid : 0n,
    );
    statement.minimumPaymentRemaining = creditMoney(
      minimumDue > validPaid ? minimumDue - validPaid : 0n,
    );
    statement.status = getStatementStatus(
      BigInt(statement.remainingAmountDue.amountMinor),
      BigInt(statement.minimumPaymentRemaining.amountMinor),
      validPaid,
      statement.dueAt,
      this.clock(),
    );
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
    const latestStatement = this.findLatestCreditStatement(payment.creditAccountId);
    if (
      status !== "FAILED" &&
      (!latestStatement || latestStatement.statementId !== payment.statementId)
    ) {
      throw conflictWithCode(
        isReversal ? "REVERSAL_REQUIRES_REVIEW" : "PAYMENT_STATEMENT_SUPERSEDED",
        isReversal
          ? "Không thể hoàn tác tự động sau khi nghĩa vụ đã chuyển kỳ; cần đối soát thủ công."
          : "Không thể quyết toán vào sao kê đã chuyển kỳ; cần thất bại/hoàn tiền lệnh chờ và đối soát.",
      );
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
    const card = this.creditCards.get(payment.cardId);
    this.notifications.get(userId)?.unshift({
      id: createId("notification"),
      type: "CREDIT",
      title:
        receipt.status === "SUCCEEDED"
          ? "Thanh toán thẻ thành công"
          : receipt.status === "REVERSED"
            ? "Thanh toán thẻ đã hoàn tác"
            : "Thanh toán thẻ không thành công",
      body: `Thanh toán ${payment.reference} có trạng thái ${receipt.status}.`,
      resourceId: card?.cardId ?? payment.cardId,
      resourceAccountId: payment.sourceAccountId,
      read: false,
      createdAt: receipt.updatedAt,
    });
    return toPublicCreditPayment(payment);
  }

  private verifyCreditStepUp(
    userId: string,
    stepUp: { method: StepUpMethod; proof: string; challengeId?: string } | undefined,
    resourceId: string | null,
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
      (stepUp.method !== "OTP" && stepUp.method !== "TOTP" && stepUp.method !== "BIOMETRIC") ||
      typeof stepUp.proof !== "string" ||
      !stepUp.proof.trim()
    ) {
      this.recordCreditStepUpFailure(key);
      throw invalidRequest("stepUp proof is required.");
    }
    if (!this.isStepUpMethodEnabledForRequest(userId, deviceId, stepUp, allowedMethods)) {
      throw conflictWithCode("STEP_UP_INVALID", "Phương thức xác thực bước hai không được bật.");
    }
    try {
      if (stepUp.challengeId) {
        const externallyVerified = this.consumeExternalStepUpVerification({
          userId,
          challengeId: stepUp.challengeId,
          deviceId,
          method: stepUp.method,
          purpose,
          resourceId,
          requestFingerprint,
        });
        if (!externallyVerified) {
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
        }
      } else if (
        !this.allowUnsafeDirectSandboxStepUp ||
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
      rethrowFinancialStepUpFailure(error);
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
      pendingRegistrations: [...this.pendingRegistrations.entries()].map(([registrationId, record]) => [
        registrationId,
        {
          prepared: {
            fullName: record.prepared.fullName,
            email: record.prepared.email,
            phoneNumber: record.prepared.phoneNumber,
          },
          passwordMaterial: { ...record.passwordMaterial },
          expiresAt: record.expiresAt,
        },
      ]),
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
      creditApplications: [...this.creditApplications.entries()].map(([key, record]) => [
        key,
        {
          ...record,
          requestedLimit: { ...record.requestedLimit },
          approvedLimit: record.approvedLimit ? { ...record.approvedLimit } : null,
        },
      ]),
      creditApplicationIdempotency: [...this.creditApplicationIdempotency.entries()].map(([key, record]) => [key, { ...record }]),
      creditActivationIdempotency: [...this.creditActivationIdempotency.entries()].map(([key, record]) => [key, { ...record }]),
      fraudReports: [...this.fraudReports.entries()].map(([reportId, record]) => [
        reportId,
        { ...record },
      ]),
      fraudReportIdempotency: [...this.fraudReportIdempotency.entries()].map(
        ([key, record]) => [key, { ...record }],
      ),
      transactionAnomalies: [...this.transactionAnomalies.entries()].map(([id, record]) => [
        id,
        cloneTransactionAnomaly(record),
      ]),
      biometricCredentials: [...this.biometricCredentials.entries()].map(([id, record]) => [
        id,
        { ...record },
      ]),
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
    this.testVerificationCodes.clear();
    const legacySnapshot = (rawState.stateVersion ?? 1) < BANKING_SYSTEM_STATE_VERSION;
    for (const [hash, challenge] of state.authChallenges) {
      const legacyFixedOtp = challenge.purpose === "LOGIN"
        ? this.sandboxMfaOtp ?? this.sandboxOtp
        : this.sandboxOtp;
      const legacyOtpHashMatches =
        (legacySnapshot || !challenge.proofDigest) &&
        Boolean(challenge.otpHash && legacyFixedOtp) &&
        (challenge.otpHash === hashOpaqueToken(legacyFixedOtp!) || legacySnapshot);
      const migratedProofDigest = legacyOtpHashMatches && legacyFixedOtp
        ? this.otpDigestKeyring.digest(hash, legacyFixedOtp!)
        : challenge.proofDigest ?? challenge.otpHash ?? null;
      this.authChallenges.set(hash, {
        ...challenge,
        methods: [...challenge.methods],
        purpose: challenge.purpose ?? "LOGIN",
        resourceId: challenge.resourceId ?? null,
        requestFingerprint: challenge.requestFingerprint ?? null,
        otpHash: migratedProofDigest,
        proofDigest: migratedProofDigest,
        digestKeyId: challenge.digestKeyId ?? this.otpDigestKeyring.currentKeyId,
        status: challenge.status ?? "ACTIVE",
        maxAttempts: challenge.maxAttempts ?? AUTH_RATE_LIMIT_MAX_ATTEMPTS,
        resendCount: challenge.resendCount ?? 0,
        lastSentAt: challenge.lastSentAt ?? null,
        credentialId: challenge.credentialId ?? null,
      });
    }
    this.pendingRegistrations.clear();
    for (const [registrationId, record] of state.pendingRegistrations ?? []) {
      this.pendingRegistrations.set(registrationId, {
        prepared: {
          fullName: record.prepared.fullName,
          email: record.prepared.email,
          phoneNumber: record.prepared.phoneNumber,
        },
        passwordMaterial: { ...record.passwordMaterial },
        expiresAt: record.expiresAt,
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
    this.creditApplications.clear();
    for (const [key, record] of state.creditApplications ?? []) {
      this.creditApplications.set(key, {
        ...record,
        requestedLimit: { ...record.requestedLimit },
        approvedLimit: record.approvedLimit ? { ...record.approvedLimit } : null,
      });
    }
    this.creditApplicationIdempotency.clear();
    for (const [key, record] of state.creditApplicationIdempotency ?? []) {
      this.creditApplicationIdempotency.set(key, { ...record });
    }
    this.creditActivationIdempotency.clear();
    for (const [key, record] of state.creditActivationIdempotency ?? []) {
      this.creditActivationIdempotency.set(key, { ...record });
    }
    this.fraudReports.clear();
    for (const [reportId, record] of state.fraudReports ?? []) {
      this.fraudReports.set(reportId, { ...record });
    }
    this.fraudReportIdempotency.clear();
    for (const [key, record] of state.fraudReportIdempotency ?? []) {
      this.fraudReportIdempotency.set(key, { ...record });
    }
    this.transactionAnomalies.clear();
    for (const [id, record] of state.transactionAnomalies ?? []) {
      this.transactionAnomalies.set(id, cloneTransactionAnomaly(record));
    }
    this.biometricCredentials.clear();
    for (const [id, record] of state.biometricCredentials ?? []) {
      this.biometricCredentials.set(id, { ...record });
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

  private evaluateInMemoryTransferAnomaly(input: {
    userId: string;
    sourceAccountId: string;
    destinationAccountId: string;
    amountMinor: bigint;
    feeMinor: bigint;
    isSavedBeneficiary: boolean;
    occurredAt: string;
  }): TransferAnomalyAssessment {
    const sourceAccount = this.core.getPaymentAccount(input.userId, input.sourceAccountId);
    const availableBalanceMinor = BigInt(sourceAccount.availableBalance.amountMinor);
    const nowMs = Date.parse(input.occurredAt);
    let recentTransfersLast10mCount = 0;
    let sameRecipientLast15mCount = 0;
    let hasPriorSucceededTransfer = false;

    for (const record of this.transfers.values()) {
      if (record.userId !== input.userId) continue;
      const parties = this.core.getTransferParties(record.receipt.transferId);
      const createdMs = Date.parse(record.receipt.createdAt);
      const deltaMs = nowMs - createdMs;
      if (deltaMs >= 0 && deltaMs <= 10 * 60 * 1000) {
        recentTransfersLast10mCount += 1;
      }
      if (parties.destinationAccountId === input.destinationAccountId) {
        if (record.receipt.status === "SUCCEEDED") {
          hasPriorSucceededTransfer = true;
        }
        if (deltaMs >= 0 && deltaMs <= 15 * 60 * 1000) {
          sameRecipientLast15mCount += 1;
        }
      }
    }

    return evaluateTransferAnomaly({
      amountMinor: input.amountMinor,
      feeMinor: input.feeMinor,
      availableBalanceMinor,
      isNewRecipient: !input.isSavedBeneficiary && !hasPriorSucceededTransfer,
      recentTransfersLast10mCount,
      sameRecipientLast15mCount,
      occurredAt: input.occurredAt,
    });
  }

  listTransactionAnomalies(userId: string, status?: string): TransactionAnomaly[] {
    let statusFilter: AnomalyStatus | undefined;
    if (status && status.trim()) {
      const normalized = status.trim().toUpperCase();
      if (
        normalized !== "OPEN" &&
        normalized !== "CONFIRMED_SAFE" &&
        normalized !== "REPORTED_SUSPICIOUS" &&
        normalized !== "RESOLVED"
      ) {
        throw invalidRequest("status filter is invalid.", {
          status: "status must be OPEN, CONFIRMED_SAFE, REPORTED_SUSPICIOUS, or RESOLVED.",
        });
      }
      statusFilter = normalized;
    }

    return [...this.transactionAnomalies.values()]
      .filter((item) => item.customerId === userId && (!statusFilter || item.status === statusFilter))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .map(cloneTransactionAnomaly);
  }

  getTransactionAnomaly(userId: string, anomalyId: string): TransactionAnomaly {
    const item = this.transactionAnomalies.get(anomalyId);
    if (!item || item.customerId !== userId) {
      throw notFound("Transaction anomaly not found.");
    }
    return cloneTransactionAnomaly(item);
  }

  acknowledgeTransactionAnomaly(
    userId: string,
    anomalyId: string,
    input: { decision: unknown; note?: unknown },
  ): TransactionAnomaly {
    const item = this.transactionAnomalies.get(anomalyId);
    if (!item || item.customerId !== userId) {
      throw notFound("Transaction anomaly not found.");
    }
    if (input.decision !== "CONFIRMED_SAFE" && input.decision !== "REPORTED_SUSPICIOUS") {
      throw invalidRequest("decision is invalid.", {
        decision: "decision must be CONFIRMED_SAFE or REPORTED_SUSPICIOUS.",
      });
    }
    const rawNote = typeof input.note === "string" ? input.note.trim() : "";
    if (rawNote.length > 500) {
      throw invalidRequest("note is too long.", {
        note: "note must be at most 500 characters.",
      });
    }
    if (item.status === "RESOLVED") {
      throw conflict("Cảnh báo giao dịch này đã được quản trị viên đóng.");
    }
    if (item.status === input.decision) {
      return cloneTransactionAnomaly(item);
    }

    const now = nowIso(this.clock);
    item.status = input.decision;
    if (rawNote.length > 0) {
      item.customerNote = rawNote;
    }
    item.acknowledgedAt = now;
    item.updatedAt = now;

    this.recordAudit("TRANSACTION_ANOMALY_ACKNOWLEDGED", userId, item.id);
    if (input.decision === "REPORTED_SUSPICIOUS") {
      this.enqueueOutbox("SECURITY_ANOMALY_ACKNOWLEDGED", item.id, now);
      this.notifications.get(userId)?.unshift({
        id: createId("notification"),
        type: "SECURITY",
        title: "Đã tiếp nhận báo cáo giao dịch bất thường",
        body: "Báo cáo nghi ngờ giao dịch của bạn đã được chuyển tới bộ phận vận hành để rà soát.",
        resourceId: item.id,
        resourceAccountId: null,
        read: false,
        createdAt: now,
      });
    }
    return cloneTransactionAnomaly(item);
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
    invariantValid: boolean;
  }> {
    return [...this.creditAccounts.values()].map((account) => {
      const stored = BigInt(account.postedOutstanding.amountMinor);
      const expected = -this.core.getLedgerNetBalance(`credit-receivable:${account.creditAccountId}`);
      const difference = stored - expected;
      const creditLimit = BigInt(account.creditLimit.amountMinor);
      const pendingAuthorizations = BigInt(account.pendingAuthorizations.amountMinor);
      const availableCredit = BigInt(account.availableCredit.amountMinor);
      const invariantValid =
        stored >= 0n &&
        stored <= creditLimit &&
        pendingAuthorizations >= 0n &&
        availableCredit >= 0n &&
        availableCredit <= creditLimit &&
        availableCredit === creditLimit - stored - pendingAuthorizations &&
        this.findLatestCreditStatement(account.creditAccountId)?.remainingAmountDue.amountMinor ===
        stored.toString();
      if (difference !== 0n || !invariantValid) {
        this.recordAudit("CREDIT_RECONCILIATION_MISMATCH", null, account.creditAccountId);
      }
      return {
        creditAccountId: account.creditAccountId,
        storedOutstandingMinor: stored.toString(),
        expectedOutstandingMinor: expected.toString(),
        differenceMinor: difference.toString(),
        invariantValid,
      };
    });
  }

  reconcileSavings(): Array<{
    depositId: string;
    status: SavingsDeposit["status"] | "MISSING";
    expectedLiabilityMinor: string;
    postedLiabilityMinor: string;
    differenceMinor: string;
    invariantValid: boolean;
  }> {
    const liabilityPrefix = "savings-liability:";
    const postedLiabilities = new Map(
      this.core
        .listLedgerAccountBalances(liabilityPrefix)
        .map((row) => [
          row.accountId.slice(liabilityPrefix.length),
          BigInt(row.netBalanceMinor),
        ]),
    );
    const renewalParentCounts = new Map<string, number>();
    for (const deposit of this.savingsDeposits.values()) {
      if (deposit.renewedDepositId) {
        renewalParentCounts.set(
          deposit.renewedDepositId,
          (renewalParentCounts.get(deposit.renewedDepositId) ?? 0) + 1,
        );
      }
    }
    const depositIds = new Set([
      ...this.savingsDeposits.keys(),
      ...postedLiabilities.keys(),
    ]);

    return [...depositIds].sort((left, right) => left.localeCompare(right)).map((depositId) => {
      const deposit = this.savingsDeposits.get(depositId);
      const posted = postedLiabilities.get(depositId) ?? 0n;
      if (!deposit) {
        this.recordAudit("SAVINGS_RECONCILIATION_MISMATCH", null, depositId);
        return {
          depositId,
          status: "MISSING" as const,
          expectedLiabilityMinor: "0",
          postedLiabilityMinor: posted.toString(),
          differenceMinor: (-posted).toString(),
          invariantValid: false,
        };
      }

      const principal = BigInt(deposit.principal.amountMinor);
      const expected = deposit.status === "ACTIVE" ? principal : 0n;
      const difference = expected - posted;
      const renewedDeposit = deposit.renewedDepositId
        ? this.savingsDeposits.get(deposit.renewedDepositId)
        : undefined;
      const expectedRenewedPrincipal =
        deposit.maturityInstruction === "RENEW_PRINCIPAL"
          ? deposit.principal.amountMinor
          : deposit.maturityInstruction === "RENEW_PRINCIPAL_AND_INTEREST"
            ? deposit.totalAtMaturity.amountMinor
            : null;
      const opening = this.savingsOpenings.get(deposit.openingId);
      const incomingRenewalCount = renewalParentCounts.get(deposit.depositId) ?? 0;
      const renewalOriginValid = Boolean(
        opening &&
        opening.userId === deposit.userId &&
        opening.status === "SUCCEEDED" &&
        opening.depositId &&
        (opening.depositId === deposit.depositId
          ? incomingRenewalCount === 0
          : incomingRenewalCount === 1),
      );
      const renewalChainValid =
        deposit.status === "CLOSED"
          ? Boolean(
            deposit.renewedDepositId &&
            renewedDeposit &&
            renewalParentCounts.get(deposit.renewedDepositId) === 1 &&
            renewedDeposit.depositId !== deposit.depositId &&
            renewedDeposit.userId === deposit.userId &&
            renewedDeposit.sourceAccountId === deposit.sourceAccountId &&
            renewedDeposit.openingId === deposit.openingId &&
            renewedDeposit.openedAt === deposit.maturityAt &&
            renewedDeposit.principal.amountMinor === expectedRenewedPrincipal,
          )
          : deposit.renewedDepositId === null;
      const invariantValid =
        postedLiabilities.has(deposit.depositId) &&
        principal > 0n &&
        BigInt(deposit.expectedInterest.amountMinor) >= 0n &&
        BigInt(deposit.totalAtMaturity.amountMinor) ===
        principal + BigInt(deposit.expectedInterest.amountMinor) &&
        renewalOriginValid &&
        renewalChainValid;
      if (difference !== 0n || !invariantValid) {
        this.recordAudit("SAVINGS_RECONCILIATION_MISMATCH", null, deposit.depositId);
      }
      return {
        depositId: deposit.depositId,
        status: deposit.status,
        expectedLiabilityMinor: expected.toString(),
        postedLiabilityMinor: posted.toString(),
        differenceMinor: difference.toString(),
        invariantValid,
      };
    });
  }

  private issueTokenPair(
    user: UserRecord,
    familyId: string,
    deviceId: string,
    deviceName?: string,
  ): LoginResponse {
    const accessToken = createOpaqueToken();
    const refreshToken = createOpaqueToken();
    const now = this.clock();
    const nowTimestamp = new Date(now).toISOString();
    const deviceKey = `${user.id}:${deviceId}`;
    const existingDevice = this.customerDevices.get(deviceKey);
    this.customerDevices.set(deviceKey, {
      id: existingDevice?.id ?? createId("device"),
      customerId: user.id,
      deviceId,
      deviceName: deviceName?.trim() || existingDevice?.deviceName || "Thiết bị NOVA",
      attestationStatus: existingDevice?.attestationStatus === "REVOKED" ? "PENDING" : (existingDevice?.attestationStatus ?? "PENDING"),
      createdAt: existingDevice?.createdAt ?? nowTimestamp,
      lastSeenAt: nowTimestamp,
      revokedAt: null,
    });
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

  private resolveOtpRequestFingerprint(
    purpose: OtpPurpose,
    resourceId: string | null,
  ): string | null {
    if (!resourceId) {
      return null;
    }
    if (purpose === "TRANSFER") {
      const quote = this.quotes.get(resourceId);
      return quote
        ? fingerprint({
          quoteId: quote.quote.quoteId,
          amountMinor: quote.quote.amount.amountMinor,
        })
        : null;
    }
    if (purpose === "SAVINGS_OPENING") {
      return this.savingsQuotes.has(resourceId) ? fingerprint({ quoteId: resourceId }) : null;
    }
    if (purpose === "SAVINGS_WITHDRAWAL") {
      return this.savingsDeposits.has(resourceId) ? fingerprint({ depositId: resourceId, action: "EARLY_WITHDRAWAL" }) : null;
    }
    if (purpose === "CREDIT_PAYMENT") {
      return this.creditQuotes.has(resourceId) ? fingerprint({ quoteId: resourceId }) : null;
    }
    if (purpose === "CARD_ACTIVATION") {
      return this.creditApplications.has(resourceId) ? fingerprint({ applicationId: resourceId }) : null;
    }
    return null;
  }

  /** Canonical context binding shared by the HTTP MFA boundary and commands. */
  getStepUpRequestFingerprint(
    purpose: OtpPurpose,
    resourceId: string | null,
    suppliedFingerprint?: string | null,
  ): string | null {
    return this.resolveOtpRequestFingerprint(purpose, resourceId) ?? suppliedFingerprint ?? null;
  }

  getCreditApplicationRequestFingerprint(requestedLimit: unknown): string {
    const requestedLimitMinor = requestedLimit === undefined
      ? BigInt(DEFAULT_CREDIT_LIMIT_MINOR)
      : parseMoney(requestedLimit as Money, "requestedLimit");
    return fingerprint({ requestedLimitMinor: requestedLimitMinor.toString() });
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
    const otp = fixedOtp ?? (
      purpose === "LOGIN" ? this.mfaCodeGenerator.generate() : this.otpCodeGenerator.generate()
    );
    const proofDigest = this.otpDigestKeyring.digest(challengeHash, otp);
    const deterministicTestCode = (this.bankingEnvironment === "development" || this.bankingEnvironment === "test")
      ? otp
      : undefined;
    this.authChallenges.set(challengeHash, {
      userId,
      deviceId,
      expiresAt,
      methods: [...methods],
      attempts: 0,
      purpose,
      resourceId,
      requestFingerprint,
      otpHash: proofDigest,
      proofDigest,
      digestKeyId: this.otpDigestKeyring.currentKeyId,
      status: "ACTIVE",
      maxAttempts: 5,
      resendCount: 0,
      lastSentAt: this.clock(),
      credentialId: null,
    });
    if (deterministicTestCode) {
      this.testVerificationCodes.set(challengeHash, otp);
    }
    void this.verificationCodeDelivery.send({
      deliveryId: challengeHash,
      purpose,
      destination: "masked@example.invalid",
      code: otp,
      expiresAt: new Date(expiresAt).toISOString(),
    }).then((result) => {
      if (this.deliveryRequired && result.status === "FAILED") {
        const current = this.authChallenges.get(challengeHash);
        if (current?.status === "ACTIVE") {
          current.status = "DELIVERY_FAILED";
          this.recordAudit("OTP_DELIVERY_FAILED", userId, resourceId);
        }
      }
    }).catch(() => {
      const current = this.authChallenges.get(challengeHash);
      if (this.deliveryRequired && current?.status === "ACTIVE") {
        current.status = "DELIVERY_FAILED";
        this.recordAudit("OTP_DELIVERY_FAILED", userId, resourceId);
      }
    });
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
    if (!challenge || challenge.expiresAt <= this.clock() || challenge.status !== "ACTIVE") {
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
    if (
      (!(challenge.methods.includes(method) || (method === "TOTP" && challenge.methods.includes("OTP")))) ||
      typeof proof !== "string" ||
      !proof.trim()
    ) {
      this.recordChallengeFailure(challengeHash, challenge);
      throw unauthorized("OTP challenge is invalid.");
    }
    const activeBiometric =
      method === "BIOMETRIC" && deviceId?.trim()
        ? [...this.biometricCredentials.values()].find(
          (credential) =>
            credential.customerId === userId &&
            credential.deviceId === this.normalizeDeviceId(deviceId) &&
            credential.status === "ACTIVE",
        )
        : undefined;
    const valid =
      method === "OTP" || method === "TOTP"
        ? challenge.proofDigest !== null && this.otpDigestKeyring.verify(
          challengeHash,
          proof,
          challenge.proofDigest,
          challenge.digestKeyId ?? undefined,
        )
        : activeBiometric && proof.startsWith("biometric-v1.")
          ? verifyBiometricAssertion(proof, activeBiometric.biometricSecret, {
            challengeId,
            deviceId: this.normalizeDeviceId(deviceId),
            purpose,
            resourceId,
          })
          : this.allowUnsafeDirectSandboxStepUp && proof === "sandbox-biometric";
    if (!valid) {
      this.recordChallengeFailure(challengeHash, challenge);
      throw unauthorized("OTP challenge verification failed.");
    }
    if (activeBiometric && proof.startsWith("biometric-v1.")) {
      activeBiometric.lastUsedAt = nowIso(this.clock);
    }
    this.authChallenges.delete(challengeHash);
    this.testVerificationCodes.delete(challengeHash);
  }

  private cleanupExpiredState(preservedQuoteIds: ReadonlySet<string> = new Set()): void {
    const now = this.clock();
    const isExpired = (value: string | number): boolean => {
      const timestamp = typeof value === "number" ? value : Date.parse(value);
      return Number.isFinite(timestamp) && timestamp <= now;
    };

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
      }
    }
    for (const [key, marker] of this.externalStepUpVerifications) {
      if (marker.expiresAt <= now) {
        this.externalStepUpVerifications.delete(key);
      }
    }
    for (const [registrationId, registration] of this.pendingRegistrations) {
      if (registration.expiresAt <= now) {
        this.pendingRegistrations.delete(registrationId);
      }
    }
    for (const [lookupHash, lookup] of this.recipientLookups) {
      if (isExpired(lookup.expiresAt)) {
        this.recipientLookups.delete(lookupHash);
      }
    }
    for (const [quoteId, record] of this.quotes) {
      if (
        record.consumedTransferId === undefined &&
        !preservedQuoteIds.has(quoteId) &&
        isExpired(record.quote.expiresAt)
      ) {
        this.quotes.delete(quoteId);
      }
    }
    for (const [quoteId, record] of this.savingsQuotes) {
      if (
        record.consumedOpeningId === null &&
        !preservedQuoteIds.has(quoteId) &&
        isExpired(record.expiresAt)
      ) {
        this.savingsQuotes.delete(quoteId);
      }
    }
    for (const [quoteId, record] of this.creditQuotes) {
      if (
        record.consumedPaymentId === null &&
        !preservedQuoteIds.has(quoteId) &&
        isExpired(record.expiresAt)
      ) {
        this.creditQuotes.delete(quoteId);
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
    for (const [key, window] of this.creditStepUpAttemptWindows) {
      if (now - window.startedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
        this.creditStepUpAttemptWindows.delete(key);
      }
    }

    const outboxRetentionCutoff = now - OUTBOX_EVENT_RETENTION_MS;
    for (let index = this.outboxEventStore.length - 1; index >= 0; index -= 1) {
      const event = this.outboxEventStore[index];
      const occurredAt = event ? Date.parse(event.occurredAt) : Number.NaN;
      if (
        event?.published &&
        Number.isFinite(occurredAt) &&
        occurredAt <= outboxRetentionCutoff
      ) {
        this.outboxEventStore.splice(index, 1);
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

  private consumeOtpChallengeIssuance(key: string): void {
    const current = this.authAttemptWindows.get(key);
    if (!current || this.clock() - current.startedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
      this.authAttemptWindows.set(key, { startedAt: this.clock(), attempts: 1 });
      return;
    }
    if (current.attempts >= OTP_CHALLENGE_ISSUANCE_RATE_LIMIT_MAX_ATTEMPTS) {
      throw rateLimited("Too many OTP challenge requests.");
    }
    current.attempts += 1;
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
    if (challenge.attempts >= challenge.maxAttempts) {
      challenge.status = "LOCKED";
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

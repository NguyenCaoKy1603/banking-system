import {
  conflict,
  invalidRequest,
  notFound,
  rateLimited,
  unauthorized,
} from "./errors.js";
import {
  InMemoryCoreBanking,
  type CoreBankingPort,
  type InMemoryCoreState,
  type TerminalTransferStatus,
} from "./coreBanking.js";
import { parseMoney, toMoney } from "./money.js";
import {
  createId,
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
  FraudReportResponse,
  LoginResponse,
  LoginResult,
  Money,
  Notification,
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
  consumedTransferId?: string;
};

type BeneficiaryRecord = Beneficiary & {
  accountNumberFingerprint: string;
};

type IdempotencyRecord = {
  userId: string;
  fingerprint: string;
  receipt: TransferReceipt;
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
  beneficiaryId: string;
  amount: Money;
};

export type BeneficiaryInput = {
  displayName: string;
  accountNumber: string;
  bankName: string;
};

export type SubmitTransferRequest = {
  quoteId: string;
  stepUp: {
    method: "OTP" | "BIOMETRIC";
    proof: string;
  };
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
};

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const QUOTE_TTL_MS = 5 * 60 * 1000;
const AUTH_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const AUTH_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const AUTH_RATE_LIMIT_MAX_ATTEMPTS = 5;
const REGISTRATION_RATE_LIMIT_MAX_ATTEMPTS = 5;
const TRANSFER_STEP_UP_RATE_LIMIT_MAX_ATTEMPTS = 5;
const DEFAULT_OUTBOX_PENDING_THRESHOLD = 100;
const DEFAULT_TRANSFER_LIMIT_MINOR = 5_000_000n;
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
  const { accountNumberFingerprint: _accountNumberFingerprint, ...publicBeneficiary } =
    beneficiary;
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

export type BankingSystemState = {
  core: InMemoryCoreState;
  users: Array<[string, UserRecord]>;
  accessSessions: Array<[string, AccessSession]>;
  authChallenges: Array<[string, AuthChallengeRecord]>;
  authAttemptWindows: Array<[string, AttemptWindowState]>;
  registrationAttemptWindows: Array<[string, AttemptWindowState]>;
  transferStepUpAttemptWindows: Array<[string, AttemptWindowState]>;
  refreshSessions: Array<[string, RefreshSession]>;
  refreshFamilies: Array<[string, string[]]>;
  beneficiaries: Array<[string, BeneficiaryRecord[]]>;
  notifications: Array<[string, Notification[]]>;
  quotes: Array<[string, QuoteRecord]>;
  transfers: Array<[string, { userId: string; receipt: TransferReceipt }]>;
  idempotency: Array<[string, IdempotencyRecord]>;
  auditEventStore: AuditEvent[];
  outboxEventStore: OutboxEvent[];
};

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
  private readonly sandboxOtp: string;
  private readonly sandboxMfaOtp: string;
  private readonly mfaRequired: boolean;
  private readonly authChallengeMethods: StepUpMethod[];
  private readonly allowlistPredicate: (userId: string) => boolean;
  private readonly settleTransfersImmediately: boolean;
  private readonly outboxPendingThreshold: number;
  private readonly users = new Map<string, UserRecord>();
  private readonly usersByEmail = new Map<string, string>();
  private readonly usersByPhone = new Map<string, string>();
  private readonly accessSessions = new Map<string, AccessSession>();
  private readonly authChallenges = new Map<string, AuthChallengeRecord>();
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
  private readonly refreshSessions = new Map<string, RefreshSession>();
  private readonly refreshFamilies = new Map<string, Set<string>>();
  private readonly beneficiaries = new Map<string, BeneficiaryRecord[]>();
  private readonly notifications = new Map<string, Notification[]>();
  private readonly quotes = new Map<string, QuoteRecord>();
  private readonly transfers = new Map<string, { userId: string; receipt: TransferReceipt }>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly policy: ControlPolicy;

  constructor(
    options: {
      clock?: Clock;
      core?: CoreBankingPort;
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
      outboxPendingThreshold?: number;
    } = {},
  ) {
    this.clock = options.clock ?? (() => Date.now());
    this.core = options.core ?? new InMemoryCoreBanking();
    this.sandboxOtp = options.sandboxOtp ?? process.env.BANKING_SANDBOX_OTP ?? "123456";
    this.sandboxMfaOtp =
      options.sandboxMfaOtp ?? process.env.BANKING_SANDBOX_MFA_OTP ?? "654321";
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
    this.outboxPendingThreshold =
      options.outboxPendingThreshold ??
      Number(process.env.BANKING_OUTBOX_PENDING_THRESHOLD ?? DEFAULT_OUTBOX_PENDING_THRESHOLD);
    if (!Number.isInteger(this.outboxPendingThreshold) || this.outboxPendingThreshold < 0) {
      throw new Error("outboxPendingThreshold must be a non-negative integer.");
    }
    this.policy = {
      configVersion: "sandbox-1",
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
    this.beneficiaries.set(user.id, [
      {
        id: createId("beneficiary"),
        displayName: "Người nhận sandbox",
        maskedAccountNumber: "•••• 9876",
        bankName: "Ngân hàng reference",
        status: "ACTIVE",
        accountNumberFingerprint: fingerprint("sandbox-default-account-9876"),
      },
    ]);
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

    if (challenge.deviceId !== this.normalizeDeviceId(deviceId)) {
      throw unauthorized("Device binding mismatch.");
    }

    if (!challenge.methods.includes(method) || typeof proof !== "string" || !proof.trim()) {
      this.recordChallengeFailure(tokenHash, challenge);
      throw unauthorized("Authentication challenge is invalid.");
    }

    if (
      (method === "OTP" && proof !== this.sandboxMfaOtp) ||
      (method === "BIOMETRIC" && proof !== "sandbox-biometric")
    ) {
      this.recordChallengeFailure(tokenHash, challenge);
      throw unauthorized("Authentication challenge verification failed.");
    }

    const user = this.users.get(challenge.userId);
    if (!user) {
      throw unauthorized("User session is invalid.");
    }

    this.authChallenges.delete(tokenHash);
    this.recordAudit("AUTH_CHALLENGE_VERIFIED", user.id, null);
    return this.issueTokenPair(user, createId("refresh-family"), challenge.deviceId);
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

  lookupBeneficiary(userId: string, beneficiaryId: string): Beneficiary {
    const beneficiary = this.beneficiaries
      .get(userId)
      ?.find((item) => item.id === beneficiaryId);
    if (!beneficiary) {
      throw notFound("Beneficiary not found.");
    }
    return toPublicBeneficiary(beneficiary);
  }

  listBeneficiaries(userId: string): Beneficiary[] {
    return (this.beneficiaries.get(userId) ?? []).map(toPublicBeneficiary);
  }

  createBeneficiary(userId: string, input: BeneficiaryInput): Beneficiary {
    const displayName = requireBoundedString(input.displayName, "displayName", 80);
    const accountNumber = normalizeAccountNumber(input.accountNumber);
    const bankName = requireBoundedString(input.bankName, "bankName", 120);
    const beneficiaries = this.beneficiaries.get(userId) ?? [];

    const accountNumberFingerprint = fingerprint(accountNumber);
    if (
      beneficiaries.some(
        (beneficiary) =>
          beneficiary.accountNumberFingerprint === accountNumberFingerprint &&
          normalizeBankName(beneficiary.bankName) === normalizeBankName(bankName),
      )
    ) {
      throw conflict("Beneficiary already exists.");
    }

    const beneficiary: BeneficiaryRecord = {
      id: createId("beneficiary"),
      displayName,
      maskedAccountNumber: maskAccountNumber(accountNumber),
      bankName,
      status: "ACTIVE",
      accountNumberFingerprint,
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
    const beneficiaryId = requireString(input.beneficiaryId, "beneficiaryId");
    const amountMinor = parseMoney(input.amount, "amount");
    if (amountMinor <= 0n || amountMinor > BigInt(this.policy.maxTransferAmountMinor)) {
      throw conflict("Transfer amount is outside the sandbox limit.");
    }

    this.core.getPaymentAccount(userId, sourceAccountId);
    const beneficiary = this.lookupBeneficiary(userId, beneficiaryId);
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
    this.quotes.set(quote.quoteId, { userId, quote: cloneQuote(quote) });
    this.recordAudit("TRANSFER_QUOTED", userId, quote.quoteId);
    return cloneQuote(quote);
  }

  submitTransfer(
    userId: string,
    idempotencyKey: string,
    request: SubmitTransferRequest,
  ): TransferReceipt {
    this.cleanupExpiredState();
    const normalizedKey = requireString(idempotencyKey, "Idempotency-Key");
    const quoteId = requireString(request.quoteId, "quoteId");
    const requestFingerprint = fingerprint({
      quoteId,
      stepUpMethod: request.stepUp?.method,
    });
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
    if (
      (stepUp.method === "OTP" && stepUp.proof !== this.sandboxOtp) ||
      (stepUp.method === "BIOMETRIC" && stepUp.proof !== "sandbox-biometric")
    ) {
      this.recordTransferStepUpFailure(stepUpRateKey);
      this.recordAudit("STEP_UP_VERIFICATION_FAILED", userId, quoteRecord.quote.quoteId);
      throw unauthorized("Step-up verification failed.");
    }

    this.transferStepUpAttemptWindows.delete(stepUpRateKey);
    this.recordAudit("TRANSFER_STEP_UP_VERIFIED", userId, quoteRecord.quote.quoteId);

    const receipt = this.core.postTransfer(userId, {
      accountId: quoteRecord.quote.sourceAccountId,
      amountMinor: BigInt(quoteRecord.quote.amount.amountMinor),
      feeMinor: BigInt(quoteRecord.quote.fee.amountMinor),
      counterpartyName: quoteRecord.quote.beneficiary.displayName,
      description: `Chuyển tiền đến ${quoteRecord.quote.beneficiary.displayName}`,
      now: nowIso(this.clock),
      settleImmediately: this.settleTransfersImmediately,
    });
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
      resourceId: receipt.transferId,
      read: false,
      createdAt: receipt.updatedAt,
    });
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
    if (transfer.receipt.status !== "PENDING") {
      throw conflict("A terminal transfer cannot change state.");
    }

    const transitioned = this.core.transitionTransfer(
      userId,
      transferId,
      status,
      nowIso(this.clock),
    );
    transfer.receipt = transitioned;

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
      resourceId: transferId,
      read: false,
      createdAt: transitioned.updatedAt,
    });

    return transitioned;
  }

  getControlPolicy(userId?: string): ControlPolicy {
    return {
      ...this.policy,
      allowlisted:
        userId === undefined
          ? this.policy.allowlisted
          : this.isUserAllowlisted(userId),
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
      const reconciliationStatus = hasMismatch ? "mismatch" : "ok";
      return {
        status: hasMismatch || outboxStatus === "degraded" ? "degraded" : "ok",
        checkedAt: nowIso(this.clock),
        reconciliation: reconciliationStatus,
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
      core: this.core.exportState(),
      users: [...this.users.entries()].map(([userId, user]) => [userId, { ...user }]),
      accessSessions: [...this.accessSessions.entries()].map(([hash, session]) => [hash, { ...session }]),
      authChallenges: [...this.authChallenges.entries()].map(([hash, challenge]) => [hash, { ...challenge, methods: [...challenge.methods] }]),
      authAttemptWindows: [...this.authAttemptWindows.entries()].map(([key, window]) => [key, { ...window }]),
      registrationAttemptWindows: [...this.registrationAttemptWindows.entries()].map(([key, window]) => [key, { ...window }]),
      transferStepUpAttemptWindows: [...this.transferStepUpAttemptWindows.entries()].map(([key, window]) => [key, { ...window }]),
      refreshSessions: [...this.refreshSessions.entries()].map(([hash, session]) => [hash, { ...session }]),
      refreshFamilies: [...this.refreshFamilies.entries()].map(([familyId, tokenHashes]) => [familyId, [...tokenHashes]]),
      beneficiaries: [...this.beneficiaries.entries()].map(([userId, items]) => [
        userId,
        items.map((item) => ({ ...item })),
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
      auditEventStore: this.auditEventStore.map((event) => ({ ...event })),
      outboxEventStore: this.outboxEventStore.map((event) => ({ ...event })),
    };
  }

  importState(state: BankingSystemState): void {
    if (!(this.core instanceof InMemoryCoreBanking)) {
      throw new Error("Persistent sandbox requires an InMemoryCoreBanking instance.");
    }

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
    for (const [hash, challenge] of state.authChallenges) {
      this.authChallenges.set(hash, { ...challenge, methods: [...challenge.methods] });
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
      this.beneficiaries.set(userId, items.map((item) => ({ ...item })));
    }
    this.notifications.clear();
    for (const [userId, items] of state.notifications) {
      this.notifications.set(userId, items.map((item) => ({ ...item })));
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
    const challengeId = createOpaqueToken();
    const expiresAt = this.clock() + AUTH_CHALLENGE_TTL_MS;
    this.authChallenges.set(hashOpaqueToken(challengeId), {
      userId,
      deviceId,
      expiresAt,
      methods: [...this.authChallengeMethods],
      attempts: 0,
    });
    this.recordAudit("AUTH_CHALLENGE_CREATED", userId, null);
    return {
      challengeId,
      expiresAt: new Date(expiresAt).toISOString(),
      methods: [...this.authChallengeMethods],
    };
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

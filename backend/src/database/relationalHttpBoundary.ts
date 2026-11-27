import type {
  AccountMonthlySummary,
  AccountStatementExport,
  AuthUser,
  Beneficiary,
  CustomerDeviceSummary,
  LoginResponse,
  PaymentAccount,
  Transaction,
  TransactionAnomaly,
  TransactionDetail,
  TransactionListFilters,
  TransferQuote,
  TransferReceipt,
} from "../types.js";
import { RelationalAccountReadService } from "./relationalAccountReadService.js";
import { RelationalAnomalyService } from "./anomalyService.js";
import { RelationalAuthService } from "./relationalAuthService.js";
import { RelationalRegistrationService, type RegistrationBeginInput } from "./registrationService.js";
import { RelationalBeneficiaryService } from "./relationalBeneficiaryService.js";
import {
  RelationalTransferService,
  type ExternalRecipientLookupResult,
  type TransferQuoteCommandInput,
} from "./transferService.js";
import { RelationalSavingsService } from "./savingsService.js";
import type { SavingsListResult, SavingsQuoteRequest, SubmitSavingsOpeningRequest } from "../bankingSystem.js";
import type { MaturityInstruction, SavingsDeposit, SavingsOpening, SavingsProduct, SavingsQuote, SavingsWithdrawalReceipt } from "../domain/savings/index.js";
import { RelationalCreditService } from "./creditService.js";
import type { CardReportedLostResult, CreditApplication, CreditApplicationRequest, CreditCard, CreditPayment, CreditPaymentQuote, CreditPaymentQuoteRequest, CreditStatement, CreditTransaction, CreditAccount } from "../domain/credit/index.js";
import { RelationalRemainingService } from "./remainingService.js";
import type { ControlPolicy, InternalRecipientLookup, Notification } from "../types.js";
import type { MfaChallengeResponse, PersistentMfaService } from "../mfa/persistentMfaService.js";
import { UnitOfWork } from "./unitOfWork.js";
import { ControlPolicyRepository } from "./controlPolicyRepository.js";
import { RelationalKycService, type CustomerKycApplication, type CustomerKycInput } from "./kycService.js";

export type RelationalHttpRoute = "auth" | "registration" | "mfa" | "accounts" | "beneficiaries" | "transfers" | "savings" | "credit" | "recipients" | "notifications" | "kyc";

const RELATIONAL_V2_DEFAULT_ROUTES = "auth,registration,mfa,accounts,beneficiaries,transfers,savings,credit,recipients,notifications,kyc";

function configuredRoutes(value = process.env.BANKING_RELATIONAL_HTTP_ROUTES): Set<RelationalHttpRoute> {
  const routes = new Set<RelationalHttpRoute>();
  const configured = value?.trim() || (process.env.BANKING_PERSISTENCE_MODE?.trim() === "relational-v2" ? RELATIONAL_V2_DEFAULT_ROUTES : "");
  for (const item of configured.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean)) {
    if (item === "auth" || item === "registration" || item === "mfa" || item === "accounts" || item === "beneficiaries" || item === "transfers" || item === "savings" || item === "credit" || item === "recipients" || item === "notifications" || item === "kyc") routes.add(item);
    else throw new Error(`BANKING_RELATIONAL_HTTP_ROUTES contains unsupported route group: ${item}.`);
  }
  return routes;
}

export class RelationalHttpBoundary {
  private readonly unitOfWork: UnitOfWork;
  private readonly routes: Set<RelationalHttpRoute>;
  private readonly auth: RelationalAuthService;
  private readonly accounts: RelationalAccountReadService;
  private readonly anomalies: RelationalAnomalyService;
  private readonly registration: RelationalRegistrationService;
  private readonly beneficiaries: RelationalBeneficiaryService;
  private readonly transfers: RelationalTransferService;
  private readonly savings: RelationalSavingsService;
  private readonly credit: RelationalCreditService;
  private readonly remaining: RelationalRemainingService;
  private readonly kyc: RelationalKycService;

  constructor(unitOfWork: UnitOfWork, routeConfig?: string) {
    this.unitOfWork = unitOfWork;
    this.routes = configuredRoutes(routeConfig);
    if (["accounts", "beneficiaries", "transfers", "savings", "credit", "mfa", "recipients", "notifications", "kyc"].some((route) => this.routes.has(route as RelationalHttpRoute)) && !this.routes.has("auth")) {
      throw new Error("BANKING_RELATIONAL_HTTP_ROUTES account and command groups require auth so they have a direct session boundary.");
    }
    this.auth = new RelationalAuthService(unitOfWork);
    this.accounts = new RelationalAccountReadService(unitOfWork);
    this.anomalies = new RelationalAnomalyService(unitOfWork);
    this.registration = new RelationalRegistrationService(unitOfWork);
    this.beneficiaries = new RelationalBeneficiaryService(unitOfWork);
    this.transfers = new RelationalTransferService(unitOfWork);
    this.savings = new RelationalSavingsService(unitOfWork);
    this.credit = new RelationalCreditService(unitOfWork);
    this.remaining = new RelationalRemainingService(unitOfWork);
    this.kyc = new RelationalKycService(unitOfWork);
  }

  get enabled(): boolean { return this.routes.size > 0; }

  assertRelationalV2Complete(): void {
    const required: Array<[string, string[]]> = [
      ["POST", ["auth", "login"]],
      ["POST", ["auth", "verify"]],
      ["POST", ["auth", "refresh"]],
      ["POST", ["auth", "logout"]],
      ["POST", ["auth", "logout-all"]],
      ["POST", ["auth", "password", "change"]],
      ["POST", ["auth", "password", "forgot"]],
      ["POST", ["auth", "password", "reset"]],
      ["GET", ["auth", "devices"]],
      ["DELETE", ["auth", "devices", "00000000-0000-4000-8000-000000000000"]],
      ["POST", ["auth", "register"]],
      ["POST", ["auth", "register", "verify"]],
      ["POST", ["auth", "register", "cancel"]],
      ["GET", ["auth", "mfa", "methods"]],
      ["POST", ["auth", "otp", "challenges"]],
      ["GET", ["accounts"]],
      ["GET", ["beneficiaries"]],
      ["POST", ["transfers", "quote"]],
      ["POST", ["transfers"]],
      ["GET", ["savings", "products"]],
      ["POST", ["savings", "quotes"]],
      ["POST", ["savings", "deposits"]],
      ["GET", ["cards"]],
      ["POST", ["cards", "00000000-0000-4000-8000-000000000000", "lock"]],
      ["POST", ["cards", "00000000-0000-4000-8000-000000000000", "unlock"]],
      ["POST", ["cards", "00000000-0000-4000-8000-000000000000", "report-lost"]],
      ["GET", ["credit", "applications"]],
      ["POST", ["credit", "applications"]],
      ["POST", ["credit", "payment-quotes"]],
      ["POST", ["credit", "payments"]],
      ["POST", ["internal-recipients", "lookup"]],
      ["POST", ["external-recipients", "lookup"]],
      ["GET", ["notifications"]],
      ["POST", ["notifications", "00000000-0000-4000-8000-000000000000", "read"]],
      ["GET", ["mobile", "control-policy"]],
      ["GET", ["kyc", "application"]],
      ["POST", ["kyc", "application"]],
      ["POST", ["kyc", "application", "submit"]],
    ];
    const missing = required.filter(([method, segments]) => !this.isRouteEnabled(method, segments)).map(([method, segments]) => `${method} /${segments.join("/")}`);
    if (missing.length > 0) throw new Error(`Relational-v2 HTTP cutover is incomplete; missing direct routes: ${missing.join(", ")}.`);
  }

  isRouteEnabled(method: string | undefined, segments: readonly string[]): boolean {
    const verb = (method ?? "").toUpperCase();
    if (this.routes.has("auth") && verb === "GET" && segments.length === 2 && segments[0] === "mobile" && segments[1] === "control-policy") return true;
    if (this.routes.has("auth") && segments[0] === "auth") {
      // Session, password and device routes use the relational auth boundary.
      // Registration and MFA lifecycle routes are selected by their dedicated route groups below.
      const sessionRoutes =
        (verb === "POST" && segments.length === 2 && ["login", "verify", "refresh", "logout"].includes(segments[1] ?? "")) ||
        (verb === "POST" && segments.length === 2 && segments[1] === "logout-all") ||
        (verb === "POST" && segments.length === 5 && segments[1] === "mfa" && segments[2] === "biometric" && segments[3] === "login" && ["challenge", "verify"].includes(segments[4] ?? "")) ||
        (verb === "POST" && segments.length === 3 && segments[1] === "password" && ["change", "forgot", "reset"].includes(segments[2] ?? "")) ||
        (verb === "GET" && segments.length === 2 && segments[1] === "devices") ||
        (verb === "DELETE" && segments.length === 3 && segments[1] === "devices");
      if (sessionRoutes) return true;
    }
    if (this.routes.has("mfa") && segments[0] === "auth") {
      const mfaLifecycleRoute =
        (verb === "GET" && segments.length === 3 && segments[1] === "mfa" && segments[2] === "methods") ||
        (verb === "POST" && segments.length === 4 && segments[1] === "mfa" && segments[2] === "biometric" && segments[3] === "enroll") ||
        (verb === "POST" && segments.length === 4 && segments[1] === "mfa" && segments[2] === "totp" && (segments[3] === "enroll" || segments[3] === "confirm")) ||
        (verb === "DELETE" && segments.length === 4 && segments[1] === "mfa" && segments[2] === "methods") ||
        (verb === "POST" && segments.length === 3 && segments[1] === "mfa" && segments[2] === "recover") ||
        (verb === "POST" && segments.length === 4 && segments[1] === "mfa" && segments[2] === "recover" && ["verify", "complete", "enroll"].includes(segments[3] ?? "")) ||
        (verb === "POST" && segments.length === 4 && segments[1] === "mfa" && segments[2] === "recovery-codes" && segments[3] === "rotate") ||
        (verb === "POST" && segments.length === 4 && segments[1] === "challenges" && segments[3] === "resend") ||
        (verb === "POST" && segments.length === 3 && segments[1] === "otp" && segments[2] === "challenges");
      if (mfaLifecycleRoute) return true;
    }
    if (this.routes.has("registration") && verb === "POST" && segments[0] === "auth" && segments[1] === "register") {
      return segments.length === 2 || (segments.length === 3 && (segments[2] === "verify" || segments[2] === "cancel"));
    }
    if (this.routes.has("beneficiaries") && segments[0] === "beneficiaries") {
      return (verb === "GET" && (segments.length === 1 || segments.length === 2)) ||
        (verb === "POST" && segments.length === 1) ||
        (verb === "PATCH" && segments.length === 2) ||
        (verb === "DELETE" && segments.length === 2);
    }
    if ((this.routes.has("transfers") || this.routes.has("accounts")) && segments[0] === "anomalies") {
      return (verb === "GET" && (segments.length === 1 || segments.length === 2)) ||
        (verb === "POST" && segments.length === 3 && segments[2] === "acknowledge");
    }
    if (this.routes.has("transfers") && segments[0] === "transfers") {
      return (verb === "POST" && segments.length === 2 && segments[1] === "quote") ||
        (verb === "POST" && segments.length === 1) ||
        (verb === "GET" && segments.length === 2);
    }
    if (this.routes.has("savings") && segments[0] === "savings") {
      return (verb === "GET" && segments.length === 2 && segments[1] === "products") ||
        (verb === "POST" && segments.length === 2 && (segments[1] === "quotes" || segments[1] === "deposits")) ||
        (verb === "GET" && segments.length === 3 && (segments[1] === "openings" || segments[1] === "deposits")) ||
        (verb === "GET" && segments.length === 2 && segments[1] === "deposits") ||
        (verb === "PATCH" && segments.length === 3 && segments[1] === "deposits") ||
        (verb === "POST" && segments.length === 4 && segments[1] === "deposits" && segments[3] === "withdraw");
    }
    if (this.routes.has("credit")) {
      if (segments[0] === "cards") {
        return (verb === "GET" && (segments.length === 1 || segments.length === 2)) ||
          (verb === "POST" && segments.length === 3 && ["lock", "unlock", "report-lost"].includes(segments[2] ?? ""));
      }
      if (segments[0] === "credit") {
        return (verb === "GET" && segments.length === 2 && ["applications", "accounts"].includes(segments[1] ?? "")) ||
          (verb === "POST" && segments.length === 2 && ["applications", "payment-quotes", "payments"].includes(segments[1] ?? "")) ||
          (verb === "GET" && segments.length === 3 && ["applications", "accounts", "payments"].includes(segments[1] ?? "")) ||
          (verb === "POST" && segments.length === 4 && segments[1] === "applications" && segments[3] === "activate") ||
          (verb === "GET" && segments.length === 4 && segments[1] === "accounts" && ["transactions", "statements"].includes(segments[3] ?? "")) ||
          (verb === "GET" && segments.length === 5 && segments[1] === "accounts" && segments[3] === "statements");
      }
    }
    if (
      this.routes.has("recipients") &&
      verb === "POST" &&
      segments.length === 2 &&
      (segments[0] === "internal-recipients" || segments[0] === "external-recipients") &&
      segments[1] === "lookup"
    ) return true;
    if (this.routes.has("notifications")) {
      if (verb === "GET" && segments.length === 1 && segments[0] === "notifications") return true;
      if (verb === "POST" && segments.length === 3 && segments[0] === "notifications" && segments[2] === "read") return true;
    }
    if (this.routes.has("kyc") && segments[0] === "kyc") {
      return (verb === "GET" && segments.length === 2 && segments[1] === "application") ||
        (verb === "POST" && segments.length === 2 && segments[1] === "application") ||
        (verb === "POST" && segments.length === 3 && segments[1] === "application" && segments[2] === "submit");
    }
    if (!this.routes.has("accounts")) return false;
    if (verb === "GET" && segments.length === 1 && segments[0] === "accounts") return true;
    if (
      verb === "GET" &&
      segments.length === 3 &&
      segments[0] === "accounts" &&
      (segments[2] === "number" ||
        segments[2] === "transactions" ||
        segments[2] === "summary" ||
        segments[2] === "statement-export")
    ) return true;
    if (verb === "GET" && segments.length === 4 && segments[0] === "accounts" && segments[2] === "transactions") return true;
    return false;
  }

  loginPasswordOnly(email: string, password: string, deviceId: string): Promise<AuthUser> {
    return this.auth.loginPasswordOnly(email, password, deviceId);
  }

  findCustomerIdByEmail(email: string): Promise<string | null> {
    return this.auth.findCustomerIdByEmail(email);
  }

  beginRegistration(input: RegistrationBeginInput, deviceId: string, mfaService: PersistentMfaService, networkFingerprint: string): Promise<MfaChallengeResponse> {
    return this.registration.begin(input, deviceId, mfaService, networkFingerprint);
  }

  async verifyRegistration(challengeId: string, proof: string, deviceId: string, mfaService: PersistentMfaService): Promise<{ user: AuthUser }> {
    const completed = await this.registration.verify(challengeId, proof, deviceId, mfaService);
    return { user: await this.auth.getUser(completed.customerId) };
  }

  cancelRegistration(challengeId: string, deviceId: string): Promise<void> {
    return this.registration.cancel(challengeId, deviceId);
  }

  issueMfaSession(customerId: string, deviceId: string, deviceName?: string): Promise<LoginResponse> {
    return this.auth.issueSession(customerId, deviceId, deviceName);
  }

  authenticate(accessToken: string, deviceId: string): Promise<AuthUser> {
    return this.auth.authenticate(accessToken, deviceId);
  }

  getUser(customerId: string): Promise<AuthUser> { return this.auth.getUser(customerId); }

  async getControlPolicy(): Promise<ControlPolicy> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const row = await new ControlPolicyRepository(client).read();
      const list = (value: unknown): Array<"OTP" | "TOTP" | "BIOMETRIC"> => Array.isArray(value) ? value.map((item) => String(item) as "OTP" | "TOTP" | "BIOMETRIC") : [];
      return {
        configVersion: String(row.config_version),
        globalKillSwitch: Boolean(row.global_kill_switch),
        transfersEnabled: Boolean(row.transfers_enabled),
        allowlisted: Boolean(row.allowlist_enabled),
        maxTransferAmountMinor: String(row.max_transfer_amount_minor),
        ...(row.daily_transfer_limit_minor !== undefined && row.daily_transfer_limit_minor !== null
          ? { dailyTransferLimitMinor: String(row.daily_transfer_limit_minor) }
          : {}),
        ...(row.transfer_fee_minor !== undefined && row.transfer_fee_minor !== null
          ? { transferFeeMinor: String(row.transfer_fee_minor) }
          : {}),
        stepUpMethods: list(row.step_up_methods),
        savingsEnabled: Boolean(row.savings_enabled),
        savingsAllowlisted: Boolean(row.savings_allowlist_enabled),
        maxSavingsAmountMinor: String(row.max_savings_amount_minor),
        savingsStepUpMethods: list(row.savings_step_up_methods),
        creditEnabled: Boolean(row.credit_enabled),
        creditAllowlisted: Boolean(row.credit_allowlisted),
        creditPaymentsEnabled: Boolean(row.credit_payments_enabled),
        cardControlsEnabled: Boolean(row.card_controls_enabled),
        maxCreditPaymentAmountMinor: String(row.max_credit_payment_amount_minor),
        creditPaymentStepUpMethods: list(row.credit_payment_step_up_methods),
        cardUnlockStepUpMethods: list(row.card_unlock_step_up_methods),
        updatedAt: new Date(String(row.updated_at)).toISOString(),
      };
    });
  }

  verifyCurrentPassword(customerId: string, password: string): Promise<boolean> {
    return this.auth.verifyCurrentPassword(customerId, password);
  }

  refresh(refreshToken: string, deviceId: string): Promise<LoginResponse> {
    return this.auth.refresh(refreshToken, deviceId);
  }

  revoke(refreshToken: string, deviceId: string): Promise<boolean> {
    return this.auth.revoke(refreshToken, deviceId);
  }

  revokeAllSessions(customerId: string): Promise<void> { return this.auth.revokeAllSessions(customerId); }

  changePassword(input: { customerId: string; currentPassword: string; newPassword: string; deviceId: string }): Promise<void> {
    return this.auth.changePassword(input);
  }

  preparePasswordReset(email: string, networkFingerprint: string): Promise<{ normalizedEmail: string; customer: { id: string; email: string } | null }> {
    return this.auth.preparePasswordReset(email, networkFingerprint);
  }

  resetPassword(input: { customerId: string; newPassword: string; deviceId: string }): Promise<void> {
    return this.auth.resetPassword(input);
  }

  listDevices(customerId: string, currentDeviceId: string): Promise<CustomerDeviceSummary[]> {
    return this.auth.listDevices(customerId, currentDeviceId);
  }

  revokeDevice(customerId: string, targetDeviceId: string, currentDeviceId: string): Promise<void> {
    return this.auth.revokeDevice(customerId, targetDeviceId, currentDeviceId);
  }

  listAccounts(customerId: string): Promise<PaymentAccount[]> { return this.accounts.listAccounts(customerId); }

  getAccountNumber(customerId: string, accountId: string): Promise<string> {
    return this.accounts.getAccountNumber(customerId, accountId);
  }

  listTransactions(
    customerId: string,
    accountId: string,
    cursor?: string,
    limit?: number,
    filters?: TransactionListFilters,
  ): Promise<{ items: Transaction[]; nextCursor: string | null }> {
    return this.accounts.listTransactions(customerId, accountId, cursor, limit, filters);
  }

  getAccountMonthlySummary(
    customerId: string,
    accountId: string,
    month?: string,
  ): Promise<AccountMonthlySummary> {
    return this.accounts.getMonthlySummary(customerId, accountId, month);
  }

  exportAccountStatement(
    customerId: string,
    accountId: string,
    options?: { from?: string; to?: string; format?: string },
  ): Promise<AccountStatementExport> {
    return this.accounts.exportStatement(customerId, accountId, options);
  }

  getTransaction(customerId: string, accountId: string, transactionId: string): Promise<TransactionDetail> {
    return this.accounts.getTransaction(customerId, accountId, transactionId);
  }

  listBeneficiaries(customerId: string): Promise<Beneficiary[]> {
    return this.beneficiaries.list(customerId);
  }

  getBeneficiary(customerId: string, beneficiaryId: string): Promise<Beneficiary> {
    return this.beneficiaries.get(customerId, beneficiaryId);
  }

  createBeneficiary(customerId: string, input: { displayName: unknown; accountNumber: unknown }): Promise<Beneficiary> {
    return this.beneficiaries.create(customerId, input);
  }

  renameBeneficiary(customerId: string, beneficiaryId: string, displayName: unknown): Promise<Beneficiary> {
    return this.beneficiaries.rename(customerId, beneficiaryId, displayName);
  }

  removeBeneficiary(customerId: string, beneficiaryId: string): Promise<void> {
    return this.beneficiaries.remove(customerId, beneficiaryId);
  }

  createTransferQuote(input: TransferQuoteCommandInput): Promise<TransferQuote> {
    return this.transfers.createQuote(input);
  }

  lookupInternalRecipient(customerId: string, accountNumber: unknown): Promise<InternalRecipientLookup> {
    return this.remaining.lookupRecipient(customerId, accountNumber);
  }

  lookupExternalRecipient(
    customerId: string,
    input: { bankBin: unknown; accountNumber: unknown },
  ): Promise<ExternalRecipientLookupResult> {
    return this.transfers.lookupExternalRecipient(customerId, input);
  }

  listNotifications(customerId: string): Promise<Notification[]> {
    return this.remaining.listNotifications(customerId);
  }

  markNotificationRead(customerId: string, notificationId: string): Promise<Notification> {
    return this.remaining.markNotificationRead(customerId, notificationId);
  }

  getKycApplication(customerId: string): Promise<CustomerKycApplication | null> { return this.kyc.get(customerId); }
  saveKycDraft(customerId: string, input: CustomerKycInput): Promise<CustomerKycApplication> { return this.kyc.saveDraft(customerId, input); }
  submitKycApplication(customerId: string, input: CustomerKycInput): Promise<CustomerKycApplication> { return this.kyc.submit(customerId, input); }

  async submitTransfer(input: {
    customerId: string;
    idempotencyKey: string;
    quoteId: string;
    requestFingerprint: string;
    confirmHighRisk?: boolean;
    traceId?: string;
  }): Promise<TransferReceipt> {
    const transfer = await this.transfers.submit(input);
    return this.transfers.toPublic(transfer);
  }

  getTransfer(customerId: string, transferId: string): Promise<TransferReceipt> {
    return this.transfers.get(customerId, transferId);
  }

  listAnomalies(customerId: string, status?: string): Promise<TransactionAnomaly[]> {
    return this.anomalies.listAnomalies(customerId, status);
  }

  getAnomaly(customerId: string, anomalyId: string): Promise<TransactionAnomaly> {
    return this.anomalies.getAnomaly(customerId, anomalyId);
  }

  acknowledgeAnomaly(input: {
    customerId: string;
    anomalyId: string;
    decision: unknown;
    note?: unknown;
    traceId?: string;
  }): Promise<TransactionAnomaly> {
    return this.anomalies.acknowledgeAnomaly(input);
  }

  getTransferStepUpRequestFingerprint(quoteId: string): Promise<string | null> {
    return this.transfers.getStepUpRequestFingerprint(quoteId);
  }

  listSavingsProducts(customerId: string): Promise<SavingsProduct[]> { return this.savings.listProducts(customerId); }

  createSavingsQuote(customerId: string, input: SavingsQuoteRequest): Promise<SavingsQuote> {
    return this.savings.createQuote(customerId, input);
  }

  getSavingsStepUpRequestFingerprint(quoteId: string): Promise<string | null> {
    return this.savings.getQuoteStepUpRequestFingerprint(quoteId);
  }

  submitSavingsOpening(input: { customerId: string; idempotencyKey: string; request: SubmitSavingsOpeningRequest; traceId?: string }): Promise<SavingsOpening> {
    return this.savings.submitOpening(input);
  }

  getSavingsOpening(customerId: string, openingId: string): Promise<SavingsOpening> { return this.savings.getOpening(customerId, openingId); }
  listSavingsDeposits(customerId: string): Promise<SavingsListResult> { return this.savings.listDeposits(customerId); }
  getSavingsDeposit(customerId: string, depositId: string): Promise<SavingsDeposit> { return this.savings.getDeposit(customerId, depositId); }
  updateSavingsDepositMaturityInstruction(
    customerId: string,
    depositId: string,
    maturityInstruction: MaturityInstruction,
  ): Promise<SavingsDeposit> {
    return this.savings.updateMaturityInstruction(customerId, depositId, maturityInstruction);
  }
  withdrawSavingsDepositEarly(input: {
    customerId: string;
    depositId: string;
    idempotencyKey: string;
    traceId?: string;
  }): Promise<SavingsWithdrawalReceipt> {
    return this.savings.withdrawEarly(input);
  }

  listCards(customerId: string): Promise<{ items: CreditCard[] }> { return this.credit.listCards(customerId); }
  getCard(customerId: string, cardId: string): Promise<{ card: CreditCard; creditAccount: CreditAccount; latestStatement: CreditStatement | null }> { return this.credit.getCard(customerId, cardId); }
  listCreditApplications(customerId: string): Promise<{ items: CreditApplication[] }> { return this.credit.listApplications(customerId); }
  getCreditApplication(customerId: string, applicationId: string): Promise<CreditApplication> { return this.credit.getApplication(customerId, applicationId); }
  getCreditApplicationRequestFingerprint(requestedLimit: unknown): Promise<string> { return this.credit.getApplicationRequestFingerprint(requestedLimit); }
  submitCreditApplication(input: { customerId: string; idempotencyKey: string; request: CreditApplicationRequest; traceId?: string }): Promise<CreditApplication> { return this.credit.submitApplication(input); }
  activateCreditApplication(input: { customerId: string; applicationId: string; idempotencyKey: string; traceId?: string }): Promise<CreditApplication> { return this.credit.activateApplication(input); }
  listCreditAccounts(customerId: string): Promise<CreditAccount[]> { return this.credit.listAccounts(customerId); }
  getCreditAccount(customerId: string, accountId: string): Promise<CreditAccount> { return this.credit.getAccount(customerId, accountId); }
  listCreditTransactions(customerId: string, accountId: string, cursor?: string, limit?: number): Promise<{ items: CreditTransaction[]; nextCursor: string | null }> { return this.credit.listTransactions(customerId, accountId, cursor, limit); }
  listCreditStatements(customerId: string, accountId: string, cursor?: string, limit?: number): Promise<{ items: CreditStatement[]; nextCursor: string | null }> { return this.credit.listStatements(customerId, accountId, cursor, limit); }
  getCreditStatement(customerId: string, accountId: string, statementId: string): Promise<CreditStatement> { return this.credit.getStatement(customerId, accountId, statementId); }
  createCreditPaymentQuote(customerId: string, input: CreditPaymentQuoteRequest): Promise<CreditPaymentQuote> { return this.credit.createPaymentQuote(customerId, input); }
  getCreditPaymentStepUpRequestFingerprint(quoteId: string): Promise<string | null> { return this.credit.getPaymentStepUpRequestFingerprint(quoteId); }
  submitCreditPayment(input: { customerId: string; idempotencyKey: string; quoteId: string; requestFingerprint: string; traceId?: string }): Promise<CreditPayment> { return this.credit.submitPayment(input); }
  getCreditPayment(customerId: string, paymentId: string): Promise<CreditPayment> { return this.credit.getPayment(customerId, paymentId); }
  lockCard(customerId: string, cardId: string): Promise<CreditCard> { return this.credit.setCardStatus(customerId, cardId, "LOCKED"); }
  unlockCard(customerId: string, cardId: string): Promise<CreditCard> { return this.credit.setCardStatus(customerId, cardId, "ACTIVE"); }
  reportCardLost(customerId: string, cardId: string, traceId?: string): Promise<CardReportedLostResult> { return this.credit.reportCardLost(customerId, cardId, traceId); }
}

import type { AuthUser, Beneficiary, LoginResponse, PaymentAccount, Transaction, TransactionDetail, TransferQuote, TransferReceipt } from "../types.js";
import { RelationalAccountReadService } from "./relationalAccountReadService.js";
import { RelationalAuthService } from "./relationalAuthService.js";
import { RelationalRegistrationService, type RegistrationBeginInput } from "./registrationService.js";
import { RelationalBeneficiaryService } from "./relationalBeneficiaryService.js";
import { RelationalTransferService, type TransferQuoteCommandInput } from "./transferService.js";
import { RelationalSavingsService } from "./savingsService.js";
import type { SavingsListResult, SavingsQuoteRequest, SubmitSavingsOpeningRequest } from "../bankingSystem.js";
import type { SavingsDeposit, SavingsOpening, SavingsProduct, SavingsQuote } from "../savings.js";
import type { MfaChallengeResponse, PersistentMfaService } from "../mfa/persistentMfaService.js";
import { UnitOfWork } from "./unitOfWork.js";

export type RelationalHttpRoute = "auth" | "registration" | "mfa" | "accounts" | "beneficiaries" | "transfers" | "savings";

function configuredRoutes(value = process.env.BANKING_RELATIONAL_HTTP_ROUTES): Set<RelationalHttpRoute> {
  const routes = new Set<RelationalHttpRoute>();
  for (const item of (value ?? "").split(",").map((part) => part.trim().toLowerCase()).filter(Boolean)) {
    if (item === "auth" || item === "registration" || item === "mfa" || item === "accounts" || item === "beneficiaries" || item === "transfers" || item === "savings") routes.add(item);
    else throw new Error(`BANKING_RELATIONAL_HTTP_ROUTES contains unsupported route group: ${item}.`);
  }
  return routes;
}

export class RelationalHttpBoundary {
  private readonly routes: Set<RelationalHttpRoute>;
  private readonly auth: RelationalAuthService;
  private readonly accounts: RelationalAccountReadService;
  private readonly registration: RelationalRegistrationService;
  private readonly beneficiaries: RelationalBeneficiaryService;
  private readonly transfers: RelationalTransferService;
  private readonly savings: RelationalSavingsService;

  constructor(unitOfWork: UnitOfWork, routeConfig?: string) {
    this.routes = configuredRoutes(routeConfig);
    if (["accounts", "beneficiaries", "transfers", "savings", "mfa"].some((route) => this.routes.has(route as RelationalHttpRoute)) && !this.routes.has("auth")) {
      throw new Error("BANKING_RELATIONAL_HTTP_ROUTES account and command groups require auth so they have a direct session boundary.");
    }
    this.auth = new RelationalAuthService(unitOfWork);
    this.accounts = new RelationalAccountReadService(unitOfWork);
    this.registration = new RelationalRegistrationService(unitOfWork);
    this.beneficiaries = new RelationalBeneficiaryService(unitOfWork);
    this.transfers = new RelationalTransferService(unitOfWork);
    this.savings = new RelationalSavingsService(unitOfWork);
  }

  get enabled(): boolean { return this.routes.size > 0; }

  isRouteEnabled(method: string | undefined, segments: readonly string[]): boolean {
    const verb = (method ?? "").toUpperCase();
    if (this.routes.has("auth") && segments[0] === "auth") {
      // Session routes use the relational auth boundary. Registration and MFA
      // lifecycle routes are selected by their dedicated route groups below.
      const sessionRoutes =
        (verb === "POST" && segments.length === 2 && ["login", "verify", "refresh", "logout"].includes(segments[1] ?? "")) ||
        (verb === "POST" && segments.length === 2 && segments[1] === "logout-all");
      if (sessionRoutes) return true;
    }
    if (this.routes.has("mfa") && segments[0] === "auth") {
      const mfaLifecycleRoute =
        (verb === "GET" && segments.length === 3 && segments[1] === "mfa" && segments[2] === "methods") ||
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
      return segments.length === 2 || (segments.length === 3 && segments[2] === "verify");
    }
    if (this.routes.has("beneficiaries") && segments[0] === "beneficiaries") {
      return (verb === "GET" && (segments.length === 1 || segments.length === 2)) ||
        (verb === "POST" && segments.length === 1) ||
        (verb === "PATCH" && segments.length === 2) ||
        (verb === "DELETE" && segments.length === 2);
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
        (verb === "GET" && segments.length === 2 && segments[1] === "deposits");
    }
    if (!this.routes.has("accounts")) return false;
    if (verb === "GET" && segments.length === 1 && segments[0] === "accounts") return true;
    if (verb === "GET" && segments.length === 3 && segments[0] === "accounts" && (segments[2] === "number" || segments[2] === "transactions")) return true;
    if (verb === "GET" && segments.length === 4 && segments[0] === "accounts" && segments[2] === "transactions") return true;
    return false;
  }

  loginPasswordOnly(email: string, password: string, deviceId: string): Promise<AuthUser> {
    return this.auth.loginPasswordOnly(email, password, deviceId);
  }

  beginRegistration(input: RegistrationBeginInput, deviceId: string, mfaService: PersistentMfaService, rateLimitKey?: string): Promise<MfaChallengeResponse> {
    return this.registration.begin(input, deviceId, mfaService, rateLimitKey);
  }

  async verifyRegistration(challengeId: string, proof: string, deviceId: string, mfaService: PersistentMfaService): Promise<{ user: AuthUser }> {
    const completed = await this.registration.verify(challengeId, proof, deviceId, mfaService);
    return { user: await this.auth.getUser(completed.customerId) };
  }

  issueMfaSession(customerId: string, deviceId: string): Promise<LoginResponse> {
    return this.auth.issueSession(customerId, deviceId);
  }

  authenticate(accessToken: string, deviceId: string): Promise<AuthUser> {
    return this.auth.authenticate(accessToken, deviceId);
  }

  getUser(customerId: string): Promise<AuthUser> { return this.auth.getUser(customerId); }

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

  listAccounts(customerId: string): Promise<PaymentAccount[]> { return this.accounts.listAccounts(customerId); }

  getAccountNumber(customerId: string, accountId: string): Promise<string> {
    return this.accounts.getAccountNumber(customerId, accountId);
  }

  listTransactions(customerId: string, accountId: string, cursor?: string, limit?: number): Promise<{ items: Transaction[]; nextCursor: string | null }> {
    return this.accounts.listTransactions(customerId, accountId, cursor, limit);
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

  async submitTransfer(input: {
    customerId: string;
    idempotencyKey: string;
    quoteId: string;
    requestFingerprint: string;
    traceId?: string;
  }): Promise<TransferReceipt> {
    const transfer = await this.transfers.submit(input);
    return this.transfers.toPublic(transfer);
  }

  getTransfer(customerId: string, transferId: string): Promise<TransferReceipt> {
    return this.transfers.get(customerId, transferId);
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
}

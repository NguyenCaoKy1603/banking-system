import type { AuthUser, LoginResponse, PaymentAccount, Transaction, TransactionDetail } from "../types.js";
import { RelationalAccountReadService } from "./relationalAccountReadService.js";
import { RelationalAuthService } from "./relationalAuthService.js";
import { RelationalRegistrationService, type RegistrationBeginInput } from "./registrationService.js";
import type { MfaChallengeResponse, PersistentMfaService } from "../mfa/persistentMfaService.js";
import { UnitOfWork } from "./unitOfWork.js";

export type RelationalHttpRoute = "auth" | "registration" | "accounts";

function configuredRoutes(value = process.env.BANKING_RELATIONAL_HTTP_ROUTES): Set<RelationalHttpRoute> {
  const routes = new Set<RelationalHttpRoute>();
  for (const item of (value ?? "").split(",").map((part) => part.trim().toLowerCase()).filter(Boolean)) {
    if (item === "auth" || item === "registration" || item === "accounts") routes.add(item);
    else throw new Error(`BANKING_RELATIONAL_HTTP_ROUTES contains unsupported route group: ${item}.`);
  }
  return routes;
}

export class RelationalHttpBoundary {
  private readonly routes: Set<RelationalHttpRoute>;
  private readonly auth: RelationalAuthService;
  private readonly accounts: RelationalAccountReadService;
  private readonly registration: RelationalRegistrationService;

  constructor(unitOfWork: UnitOfWork, routeConfig?: string) {
    this.routes = configuredRoutes(routeConfig);
    if (this.routes.has("accounts") && !this.routes.has("auth")) {
      throw new Error("BANKING_RELATIONAL_HTTP_ROUTES accounts requires auth so account reads have a direct session boundary.");
    }
    this.auth = new RelationalAuthService(unitOfWork);
    this.accounts = new RelationalAccountReadService(unitOfWork);
    this.registration = new RelationalRegistrationService(unitOfWork);
  }

  get enabled(): boolean { return this.routes.size > 0; }

  isRouteEnabled(method: string | undefined, segments: readonly string[]): boolean {
    const verb = (method ?? "").toUpperCase();
    if (this.routes.has("auth") && segments[0] === "auth") {
      // Registration and MFA lifecycle still depend on their dedicated
      // persistent challenge boundary; keep them on the legacy adapter until
      // their end-to-end relational contract is cut over as one unit.
      const sessionRoutes =
        (verb === "POST" && segments.length === 2 && ["login", "verify", "refresh", "logout"].includes(segments[1] ?? "")) ||
        (verb === "POST" && segments.length === 2 && segments[1] === "logout-all");
      if (sessionRoutes) return true;
    }
    if (this.routes.has("registration") && verb === "POST" && segments[0] === "auth" && segments[1] === "register") {
      return segments.length === 2 || (segments.length === 3 && segments[2] === "verify");
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
}

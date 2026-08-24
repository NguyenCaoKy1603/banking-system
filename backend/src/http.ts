import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";

import { BankingSystem, type BankingSystemState } from "./bankingSystem.js";
import { DomainError, invalidRequest, notFound, unauthorized } from "./errors.js";
import type { RelationalStateOperation } from "./postgresRelationalRepository.js";

const API_PREFIX = "/api/v1";
const MAX_BODY_BYTES = 1_000_000;

export type HttpOptions = {
  allowedOrigins?: string[];
  environment?: string;
  storage?: string;
  commitSha?: string;
};

type RequestStateDisposition =
  | "COMMIT_ALL"
  | "COMMIT_SECURITY_ONLY"
  | "ROLLBACK_ALL";

type RequestStateBoundary = {
  rejectDomainRequest(): void;
  rejectUnexpectedFailure(): void;
};

const PERSISTED_SECURITY_FAILURE_AUDIT_EVENTS = new Set([
  "STEP_UP_VERIFICATION_FAILED",
  "CREDIT_STEP_UP_VERIFICATION_FAILED",
]);

/**
 * Domain rejections can intentionally mutate abuse-prevention state before
 * returning a 4xx response (for example, refresh-token family revocation or a
 * failed OTP counter). Preserve only those security controls and roll every
 * business aggregate back to its transaction-start snapshot.
 */
function mergeRejectedSecurityState(
  transactionStartState: BankingSystemState,
  rejectedState: BankingSystemState,
): BankingSystemState {
  const existingAuditIds = new Set(
    transactionStartState.auditEventStore.map((event) => event.id),
  );
  const securityFailureAuditEvents = rejectedState.auditEventStore.filter(
    (event) =>
      !existingAuditIds.has(event.id) &&
      PERSISTED_SECURITY_FAILURE_AUDIT_EVENTS.has(event.eventType),
  );
  return {
    ...transactionStartState,
    accessSessions: rejectedState.accessSessions,
    authChallenges: rejectedState.authChallenges,
    authAttemptWindows: rejectedState.authAttemptWindows,
    registrationAttemptWindows: rejectedState.registrationAttemptWindows,
    transferStepUpAttemptWindows: rejectedState.transferStepUpAttemptWindows,
    savingsStepUpAttemptWindows: rejectedState.savingsStepUpAttemptWindows,
    creditStepUpAttemptWindows: rejectedState.creditStepUpAttemptWindows,
    refreshSessions: rejectedState.refreshSessions,
    refreshFamilies: rejectedState.refreshFamilies,
    auditEventStore: [
      ...transactionStartState.auditEventStore,
      ...securityFailureAuditEvents,
    ],
  };
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function getRequestId(request: IncomingMessage): string {
  return header(request, "x-request-id")?.trim() || `backend-${randomUUID()}`;
}

function writeResponse(
  response: ServerResponse,
  status: number,
  traceId: string,
  payload?: unknown,
): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Request-ID", traceId);
  if (payload === undefined) {
    response.end();
    return;
  }
  response.end(JSON.stringify(payload));
}

function writeError(
  response: ServerResponse,
  status: number,
  traceId: string,
  error: DomainError,
): void {
  writeResponse(response, status, traceId, {
    code: error.code,
    message: error.message,
    fieldErrors: error.fieldErrors,
    traceId,
  });
}

function runtimeMetadata(options: HttpOptions = {}): {
  service: string;
  environment: string;
  storage: string;
  commitSha: string;
} {
  return {
    service: "banking-reference-backend",
    environment:
      options.environment?.trim() || process.env.BANKING_ENV?.trim() || "development",
    storage: options.storage?.trim() || process.env.BANKING_STORAGE?.trim() || "in-memory",
    commitSha: options.commitSha?.trim() || process.env.BUILD_COMMIT_SHA?.trim() || "local",
  };
}

class BufferedResponse {
  private readonly headers = new Map<string, number | string | string[]>();
  private body: string | Buffer | undefined;
  private ended = false;
  private status = 200;

  constructor(private readonly target: ServerResponse) {}

  set statusCode(value: number) {
    this.status = value;
  }

  get statusCode(): number {
    return this.status;
  }

  setHeader(name: string, value: number | string | string[]): void {
    this.headers.set(name, value);
  }

  get headersSent(): boolean {
    return this.ended;
  }

  end(body?: string | Buffer): void {
    this.body = body;
    this.ended = true;
  }

  flush(): void {
    if (this.target.writableEnded) {
      return;
    }
    this.target.statusCode = this.status;
    for (const [name, value] of this.headers) {
      this.target.setHeader(name, value);
    }
    this.target.end(this.body);
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }

  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw invalidRequest("Request body is too large.");
    }
    chunks.push(buffer);
  }

  if (size === 0) {
    return undefined;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw invalidRequest("Request body must be valid JSON.");
  }
}

function requireObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalidRequest("Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

function requireBearer(request: IncomingMessage, system: BankingSystem): string {
  const authorization = header(request, "authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw unauthorized("Access token is required.");
  }
  const deviceId = header(request, "x-device-id");
  if (!deviceId?.trim()) {
    throw unauthorized("Device binding is required.");
  }
  return system.authenticate(authorization.slice("Bearer ".length), deviceId).id;
}

function requireDeviceId(request: IncomingMessage): string {
  const deviceId = header(request, "x-device-id");
  if (!deviceId?.trim()) {
    throw unauthorized("Device binding is required.");
  }
  return deviceId.trim();
}

function getRateLimitKey(request: IncomingMessage): string {
  const forwardedFor = header(request, "x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.socket.remoteAddress || "unknown-client";
}

function pathSegments(pathname: string): string[] {
  try {
    return pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    throw invalidRequest("Path parameter is invalid.");
  }
}

function isAuthenticatedRoute(
  method: string | undefined,
  segments: readonly string[],
): boolean {
  if (!method) {
    return false;
  }
  if (method === "GET" && segments.length === 1 && segments[0] === "notifications") {
    return true;
  }
  if (
    method === "POST" &&
    segments.length === 3 &&
    segments[0] === "notifications" &&
    segments[2] === "read"
  ) {
    return true;
  }
  if (method === "POST" && segments.length === 1 && segments[0] === "fraud-reports") {
    return true;
  }
  if (method === "GET" && segments.length === 2 && segments[0] === "fraud-reports") {
    return true;
  }
  if (
    method === "POST" &&
    segments.length === 2 &&
    segments[0] === "internal-recipients" &&
    segments[1] === "lookup"
  ) {
    return true;
  }
  if (
    method === "POST" &&
    segments.length === 3 &&
    segments[0] === "auth" &&
    segments[1] === "otp" &&
    segments[2] === "challenges"
  ) {
    return true;
  }
  if (method === "GET" && segments.length === 1 && segments[0] === "accounts") {
    return true;
  }
  if (
    method === "GET" &&
    segments.length === 3 &&
    segments[0] === "accounts" &&
    segments[2] === "number"
  ) {
    return true;
  }
  if (
    method === "GET" &&
    segments.length === 3 &&
    segments[0] === "accounts" &&
    segments[2] === "transactions"
  ) {
    return true;
  }
  if (
    method === "GET" &&
    segments.length === 4 &&
    segments[0] === "accounts" &&
    segments[2] === "transactions"
  ) {
    return true;
  }
  if (segments[0] === "beneficiaries") {
    return (
      (method === "GET" && (segments.length === 1 || segments.length === 2)) ||
      (method === "POST" && segments.length === 1) ||
      (method === "PATCH" && segments.length === 2) ||
      (method === "DELETE" && segments.length === 2)
    );
  }
  if (method === "POST" && segments.length === 2 && segments[0] === "transfers" && segments[1] === "quote") {
    return true;
  }
  if (method === "POST" && segments.length === 1 && segments[0] === "transfers") {
    return true;
  }
  if (method === "GET" && segments.length === 2 && segments[0] === "transfers") {
    return true;
  }
  if (method === "GET" && segments.length === 2 && segments[0] === "savings" && segments[1] === "products") {
    return true;
  }
  if (method === "GET" && segments.length === 1 && segments[0] === "cards") {
    return true;
  }
  if (method === "GET" && segments.length === 2 && segments[0] === "cards") {
    return true;
  }
  if (
    method === "POST" &&
    segments.length === 3 &&
    segments[0] === "cards" &&
    (segments[2] === "lock" || segments[2] === "unlock")
  ) {
    return true;
  }
  if (method === "GET" && segments.length === 2 && segments[0] === "credit" && segments[1] === "accounts") {
    return true;
  }
  if (
    (method === "GET" && segments.length === 2 && segments[0] === "credit" && segments[1] === "applications") ||
    (method === "POST" && segments.length === 2 && segments[0] === "credit" && segments[1] === "applications") ||
    (method === "GET" && segments.length === 3 && segments[0] === "credit" && segments[1] === "applications") ||
    (method === "POST" && segments.length === 4 && segments[0] === "credit" && segments[1] === "applications" && segments[3] === "activate")
  ) {
    return true;
  }
  if (method === "GET" && segments.length === 3 && segments[0] === "credit" && segments[1] === "accounts") {
    return true;
  }
  if (
    method === "GET" &&
    segments.length === 4 &&
    segments[0] === "credit" &&
    segments[1] === "accounts" &&
    (segments[3] === "transactions" || segments[3] === "statements")
  ) {
    return true;
  }
  if (
    method === "GET" &&
    segments.length === 5 &&
    segments[0] === "credit" &&
    segments[1] === "accounts" &&
    segments[3] === "statements"
  ) {
    return true;
  }
  if (method === "POST" && segments.length === 2 && segments[0] === "credit" && segments[1] === "payment-quotes") {
    return true;
  }
  if (method === "POST" && segments.length === 2 && segments[0] === "credit" && segments[1] === "payments") {
    return true;
  }
  if (method === "GET" && segments.length === 3 && segments[0] === "credit" && segments[1] === "payments") {
    return true;
  }
  if (method === "POST" && segments.length === 2 && segments[0] === "savings" && segments[1] === "quotes") {
    return true;
  }
  if (method === "POST" && segments.length === 2 && segments[0] === "savings" && segments[1] === "deposits") {
    return true;
  }
  if (method === "GET" && segments.length === 2 && segments[0] === "savings" && segments[1] === "deposits") {
    return true;
  }
  if (method === "GET" && segments.length === 3 && segments[0] === "savings" && segments[1] === "openings") {
    return true;
  }
  return method === "GET" && segments.length === 3 && segments[0] === "savings" && segments[1] === "deposits";
}

export async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  system: BankingSystem,
  options: HttpOptions = {},
  parsedBody?: unknown,
  bodyAlreadyRead = false,
  stateBoundary?: RequestStateBoundary,
): Promise<void> {
  const traceId = getRequestId(request);
  const configuredOrigins = options.allowedOrigins ?? ["*"];
  const origin = header(request, "origin");
  if (
    origin &&
    !configuredOrigins.includes("*") &&
    !configuredOrigins.includes(origin)
  ) {
    writeError(
      response,
      403,
      traceId,
      new DomainError(403, "CORS_ORIGIN_DENIED", "Origin is not allowed."),
    );
    return;
  }
  if (configuredOrigins.includes("*")) {
    response.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && configuredOrigins.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
  }
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, X-Device-ID, X-Request-ID, X-Sandbox-Operator-Key");
  response.setHeader("Access-Control-Allow-Methods", "DELETE,GET,PATCH,POST,OPTIONS");

  if (request.method === "OPTIONS") {
    writeResponse(response, 204, traceId);
    return;
  }

  try {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && requestUrl.pathname === "/livez") {
      writeResponse(response, 200, traceId, {
        ...runtimeMetadata(options),
        status: "ok",
        checkedAt: new Date().toISOString(),
      });
      return;
    }
    if (
      request.method === "GET" &&
      (requestUrl.pathname === "/healthz" || requestUrl.pathname === "/readyz")
    ) {
      const health = system.getHealth();
      writeResponse(response, health.status === "ok" ? 200 : 503, traceId, {
        ...runtimeMetadata(options),
        ...health,
      });
      return;
    }

    if (!requestUrl.pathname.startsWith(API_PREFIX)) {
      throw notFound("API route not found.");
    }
    const routePath = requestUrl.pathname.slice(API_PREFIX.length) || "/";
    const segments = pathSegments(routePath);
    const body = bodyAlreadyRead ? parsedBody : await readJson(request);

    if (
      request.method === "POST" &&
      segments.length === 2 &&
      segments[0] === "sandbox" &&
      segments[1] === "fundings"
    ) {
      const data = requireObject(body);
      writeResponse(
        response,
        200,
        traceId,
        system.fundSandbox(
          header(request, "x-sandbox-operator-key") ?? "",
          header(request, "idempotency-key") ?? "",
          data as never,
        ),
      );
      return;
    }

    if (
      request.method === "GET" &&
      segments.length === 3 &&
      segments[0] === "sandbox" &&
      segments[1] === "otp"
    ) {
      writeResponse(
        response,
        200,
        traceId,
        { otp: system.getSandboxOtp(header(request, "x-sandbox-operator-key") ?? "", segments[2]) },
      );
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 2 &&
      segments[0] === "sandbox" &&
      segments[1] === "process-scheduled"
    ) {
      const data = body === undefined ? {} : requireObject(body);
      const unsupportedField = Object.keys(data).find((key) => key !== "userId");
      if (unsupportedField) {
        throw invalidRequest(`Unsupported scheduled-work field: ${unsupportedField}.`);
      }
      if (
        Object.prototype.hasOwnProperty.call(data, "userId") &&
        (typeof data.userId !== "string" || !data.userId.trim())
      ) {
        throw invalidRequest("userId must be a non-empty string when provided.");
      }
      writeResponse(
        response,
        200,
        traceId,
        system.processScheduledWork(
          header(request, "x-sandbox-operator-key") ?? "",
          typeof data.userId === "string" ? data.userId.trim() : undefined,
        ),
      );
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 2 &&
      segments[0] === "auth" &&
      segments[1] === "register"
    ) {
      const data = requireObject(body);
      writeResponse(
        response,
        202,
        traceId,
        await system.beginRegistrationAsync(
          data as never,
          getRateLimitKey(request),
          requireDeviceId(request),
        ),
      );
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 3 &&
      segments[0] === "auth" &&
      segments[1] === "register" &&
      segments[2] === "verify"
    ) {
      const data = requireObject(body);
      writeResponse(
        response,
        201,
        traceId,
        await Promise.resolve(
          system.verifyRegistrationChallenge(
            data.challengeId as string,
            data.proof as string,
            requireDeviceId(request),
          ),
        ),
      );
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 2 &&
      segments[0] === "auth" &&
      segments[1] === "login"
    ) {
      const data = requireObject(body);
      const result = await system.loginAsync(
        data.email as string,
        data.password as string,
        requireDeviceId(request),
      );
      writeResponse(
        response,
        "accessToken" in result ? 200 : 202,
        traceId,
        result,
      );
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 2 &&
      segments[0] === "auth" &&
      segments[1] === "verify"
    ) {
      const data = requireObject(body);
      writeResponse(
        response,
        200,
        traceId,
        system.verifyLoginChallenge(
          data.challengeId as string,
          data.method as "OTP" | "BIOMETRIC",
          data.proof as string,
          requireDeviceId(request),
        ),
      );
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 2 &&
      segments[0] === "auth" &&
      segments[1] === "refresh"
    ) {
      const data = requireObject(body);
      writeResponse(
        response,
        200,
        traceId,
        system.refresh(data.refreshToken as string, requireDeviceId(request)),
      );
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 2 &&
      segments[0] === "auth" &&
      segments[1] === "logout"
    ) {
      const data = requireObject(body);
      if (!system.revoke(data.refreshToken as string, requireDeviceId(request))) {
        throw unauthorized("Refresh token is invalid.");
      }
      writeResponse(response, 204, traceId);
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 2 &&
      segments[0] === "auth" &&
      segments[1] === "logout-all"
    ) {
      const userId = requireBearer(request, system);
      system.revokeAllSessions(userId);
      writeResponse(response, 204, traceId);
      return;
    }

    if (
      request.method === "GET" &&
      segments.length === 2 &&
      segments[0] === "mobile" &&
      segments[1] === "control-policy"
    ) {
      const userId = requireBearer(request, system);
      writeResponse(response, 200, traceId, system.getControlPolicy(userId));
      return;
    }

    if (!isAuthenticatedRoute(request.method, segments)) {
      throw notFound("API route not found.");
    }

    const userId = requireBearer(request, system);

    if (
      request.method === "POST" &&
      segments.length === 3 &&
      segments[0] === "auth" &&
      segments[1] === "otp" &&
      segments[2] === "challenges"
    ) {
      const data = requireObject(body);
      writeResponse(
        response,
        201,
        traceId,
        system.createOtpChallenge(
          userId,
          requireDeviceId(request),
          data.purpose as never,
          typeof data.resourceId === "string" ? data.resourceId : null,
          typeof data.requestFingerprint === "string" ? data.requestFingerprint : null,
        ),
      );
      return;
    }

    if (request.method === "GET" && segments.length === 1 && segments[0] === "notifications") {
      writeResponse(response, 200, traceId, { items: system.listNotifications(userId) });
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 3 &&
      segments[0] === "notifications" &&
      segments[2] === "read"
    ) {
      writeResponse(response, 200, traceId, system.markNotificationRead(userId, segments[1]));
      return;
    }

    if (request.method === "POST" && segments.length === 1 && segments[0] === "fraud-reports") {
      const data = requireObject(body);
      const unsupportedField = Object.keys(data).find(
        (key) => key !== "accountId" && key !== "transactionId" && key !== "reason",
      );
      if (unsupportedField) {
        throw invalidRequest(`Unsupported fraud report field: ${unsupportedField}.`, {
          [unsupportedField]: "This field is not supported.",
        });
      }
      writeResponse(
        response,
        201,
        traceId,
        system.reportFraud(
          userId,
          data.accountId as string,
          data.transactionId as string,
          data.reason as string,
          header(request, "idempotency-key") ?? "",
        ),
      );
      return;
    }

    if (
      request.method === "GET" &&
      segments.length === 2 &&
      segments[0] === "fraud-reports"
    ) {
      writeResponse(
        response,
        200,
        traceId,
        system.getFraudReport(userId, segments[1]),
      );
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 2 &&
      segments[0] === "internal-recipients" &&
      segments[1] === "lookup"
    ) {
      const data = requireObject(body);
      writeResponse(response, 200, traceId, {
        recipient: system.lookupInternalRecipient(userId, data.accountNumber as string),
      });
      return;
    }

    if (request.method === "GET" && segments.length === 1 && segments[0] === "accounts") {
      writeResponse(response, 200, traceId, { accounts: system.listAccounts(userId) });
      return;
    }

    if (request.method === "GET" && segments.length === 1 && segments[0] === "cards") {
      writeResponse(response, 200, traceId, { items: system.listCards(userId) });
      return;
    }

    if (request.method === "GET" && segments.length === 2 && segments[0] === "credit" && segments[1] === "applications") {
      writeResponse(response, 200, traceId, { items: system.listCreditApplications(userId) });
      return;
    }

    if (request.method === "POST" && segments.length === 2 && segments[0] === "credit" && segments[1] === "applications") {
      const data = requireObject(body);
      writeResponse(
        response,
        201,
        traceId,
        system.submitCreditApplication(
          userId,
          header(request, "idempotency-key") ?? "",
          data as never,
          requireDeviceId(request),
        ),
      );
      return;
    }

    if (request.method === "GET" && segments.length === 3 && segments[0] === "credit" && segments[1] === "applications") {
      writeResponse(response, 200, traceId, system.getCreditApplication(userId, segments[2]));
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 4 &&
      segments[0] === "credit" &&
      segments[1] === "applications" &&
      segments[3] === "activate"
    ) {
      const data = requireObject(body);
      writeResponse(
        response,
        200,
        traceId,
        system.activateCreditApplication(
          userId,
          segments[2],
          header(request, "idempotency-key") ?? "",
          data as never,
          requireDeviceId(request),
        ),
      );
      return;
    }

    if (request.method === "GET" && segments.length === 2 && segments[0] === "cards") {
      writeResponse(response, 200, traceId, system.getCard(userId, segments[1]));
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 3 &&
      segments[0] === "cards" &&
      segments[2] === "lock"
    ) {
      writeResponse(response, 200, traceId, { card: system.lockCard(userId, segments[1]) });
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 3 &&
      segments[0] === "cards" &&
      segments[2] === "unlock"
    ) {
      const data = requireObject(body);
      writeResponse(response, 200, traceId, {
        card: system.unlockCard(userId, segments[1], data as never, requireDeviceId(request)),
      });
      return;
    }

    if (request.method === "GET" && segments.length === 2 && segments[0] === "credit" && segments[1] === "accounts") {
      writeResponse(response, 200, traceId, { items: system.listCreditAccounts(userId) });
      return;
    }

    if (request.method === "GET" && segments.length === 3 && segments[0] === "credit" && segments[1] === "accounts") {
      writeResponse(response, 200, traceId, system.getCreditAccount(userId, segments[2]));
      return;
    }

    if (
      request.method === "GET" &&
      segments.length === 4 &&
      segments[0] === "credit" &&
      segments[1] === "accounts" &&
      segments[3] === "transactions"
    ) {
      const limitValue = requestUrl.searchParams.get("limit");
      const limit = limitValue === null ? undefined : Number(limitValue);
      writeResponse(
        response,
        200,
        traceId,
        system.listCreditTransactions(
          userId,
          segments[2],
          requestUrl.searchParams.get("cursor") ?? undefined,
          limit,
        ),
      );
      return;
    }

    if (
      request.method === "GET" &&
      segments.length === 4 &&
      segments[0] === "credit" &&
      segments[1] === "accounts" &&
      segments[3] === "statements"
    ) {
      const limitValue = requestUrl.searchParams.get("limit");
      const limit = limitValue === null ? undefined : Number(limitValue);
      writeResponse(
        response,
        200,
        traceId,
        system.listCreditStatements(
          userId,
          segments[2],
          requestUrl.searchParams.get("cursor") ?? undefined,
          limit,
        ),
      );
      return;
    }

    if (
      request.method === "GET" &&
      segments.length === 5 &&
      segments[0] === "credit" &&
      segments[1] === "accounts" &&
      segments[3] === "statements"
    ) {
      writeResponse(response, 200, traceId, {
        statement: system.getCreditStatement(userId, segments[2], segments[4]),
      });
      return;
    }

    if (request.method === "POST" && segments.length === 2 && segments[0] === "credit" && segments[1] === "payment-quotes") {
      const data = requireObject(body);
      writeResponse(response, 200, traceId, system.createCreditPaymentQuote(userId, data as never));
      return;
    }

    if (request.method === "POST" && segments.length === 2 && segments[0] === "credit" && segments[1] === "payments") {
      const data = requireObject(body);
      const payment = system.submitCreditPayment(
        userId,
        header(request, "idempotency-key") ?? "",
        data as never,
        requireDeviceId(request),
      );
      writeResponse(response, payment.status === "PENDING" ? 202 : 200, traceId, payment);
      return;
    }

    if (request.method === "GET" && segments.length === 3 && segments[0] === "credit" && segments[1] === "payments") {
      writeResponse(response, 200, traceId, system.getCreditPayment(userId, segments[2]));
      return;
    }

    if (
      request.method === "GET" &&
      segments.length === 3 &&
      segments[0] === "accounts" &&
      segments[2] === "number"
    ) {
      writeResponse(response, 200, traceId, {
        accountNumber: system.getAccountNumber(userId, segments[1]),
      });
      return;
    }

    if (
      request.method === "GET" &&
      segments.length === 3 &&
      segments[0] === "accounts" &&
      segments[2] === "transactions"
    ) {
      const limitValue = requestUrl.searchParams.get("limit");
      const limit = limitValue === null ? undefined : Number(limitValue);
      const result = system.listTransactions(
        userId,
        segments[1],
        requestUrl.searchParams.get("cursor") ?? undefined,
        limit,
      );
      writeResponse(response, 200, traceId, result);
      return;
    }

    if (
      request.method === "GET" &&
      segments.length === 4 &&
      segments[0] === "accounts" &&
      segments[2] === "transactions"
    ) {
      writeResponse(
        response,
        200,
        traceId,
        system.getTransaction(userId, segments[1], segments[3]),
      );
      return;
    }

    if (
      request.method === "GET" &&
      segments.length === 2 &&
      segments[0] === "savings" &&
      segments[1] === "products"
    ) {
      writeResponse(response, 200, traceId, {
        items: system.listSavingsProducts(userId),
      });
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 2 &&
      segments[0] === "savings" &&
      segments[1] === "quotes"
    ) {
      const data = requireObject(body);
      writeResponse(response, 200, traceId, system.createSavingsQuote(userId, data as never));
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 2 &&
      segments[0] === "savings" &&
      segments[1] === "deposits"
    ) {
      const data = requireObject(body);
      const opening = system.submitSavingsOpening(
        userId,
        header(request, "idempotency-key") ?? "",
        data as never,
        requireDeviceId(request),
      );
      writeResponse(response, opening.status === "PENDING" ? 202 : 200, traceId, opening);
      return;
    }

    if (
      request.method === "GET" &&
      segments.length === 3 &&
      segments[0] === "savings" &&
      segments[1] === "openings"
    ) {
      writeResponse(response, 200, traceId, system.getSavingsOpening(userId, segments[2]));
      return;
    }

    if (
      request.method === "GET" &&
      segments.length === 2 &&
      segments[0] === "savings" &&
      segments[1] === "deposits"
    ) {
      writeResponse(response, 200, traceId, system.listSavingsDeposits(userId));
      return;
    }

    if (
      request.method === "GET" &&
      segments.length === 3 &&
      segments[0] === "savings" &&
      segments[1] === "deposits"
    ) {
      writeResponse(response, 200, traceId, system.getSavingsDeposit(userId, segments[2]));
      return;
    }

    if (
      request.method === "GET" &&
      segments.length === 1 &&
      segments[0] === "beneficiaries"
    ) {
      writeResponse(response, 200, traceId, {
        items: system.listBeneficiaries(userId),
      });
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 1 &&
      segments[0] === "beneficiaries"
    ) {
      const data = requireObject(body);
      writeResponse(response, 201, traceId, {
        beneficiary: system.createBeneficiary(userId, data as never),
      });
      return;
    }

    if (
      request.method === "PATCH" &&
      segments.length === 2 &&
      segments[0] === "beneficiaries"
    ) {
      const data = requireObject(body);
      writeResponse(response, 200, traceId, {
        beneficiary: system.renameBeneficiary(
          userId,
          segments[1],
          data.displayName as string,
        ),
      });
      return;
    }

    if (
      request.method === "DELETE" &&
      segments.length === 2 &&
      segments[0] === "beneficiaries"
    ) {
      system.deleteBeneficiary(userId, segments[1]);
      writeResponse(response, 204, traceId);
      return;
    }

    if (
      request.method === "GET" &&
      segments.length === 2 &&
      segments[0] === "beneficiaries"
    ) {
      writeResponse(response, 200, traceId, {
        beneficiary: system.lookupBeneficiary(userId, segments[1]),
      });
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 2 &&
      segments[0] === "transfers" &&
      segments[1] === "quote"
    ) {
      const data = requireObject(body);
      writeResponse(response, 200, traceId, system.createQuote(userId, data as never));
      return;
    }

    if (request.method === "POST" && segments.length === 1 && segments[0] === "transfers") {
      const data = requireObject(body);
      const receipt = system.submitTransfer(
        userId,
        header(request, "idempotency-key") ?? "",
        data as never,
        requireDeviceId(request),
      );
      writeResponse(
        response,
        receipt.status === "PENDING" ? 202 : 200,
        traceId,
        receipt,
      );
      return;
    }

    if (
      request.method === "GET" &&
      segments.length === 2 &&
      segments[0] === "transfers"
    ) {
      writeResponse(response, 200, traceId, system.getTransfer(userId, segments[1]));
      return;
    }

    throw notFound("API route not found.");
  } catch (error: unknown) {
    if (error instanceof DomainError) {
      stateBoundary?.rejectDomainRequest();
      writeError(response, error.status, traceId, error);
      return;
    }

    stateBoundary?.rejectUnexpectedFailure();
    writeError(
      response,
      500,
      traceId,
      new DomainError(500, "INTERNAL_ERROR", "Unexpected server error."),
    );
  }
}

export function createBankingServer(
  system = new BankingSystem(),
  options: HttpOptions = {},
): Server {
  return createServer((request, response) => {
    void handleRequest(request, response, system, options);
  });
}

export function createPersistentBankingServer(
  repository: {
    withState<T>(initialState: unknown, operation: RelationalStateOperation<T>): Promise<T>;
    healthCheck?: () => Promise<void>;
  },
  system = new BankingSystem(),
  options: HttpOptions = {},
): Server {
  return createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (request.method === "GET" && pathname === "/livez") {
      void handleRequest(request, response, system, options);
      return;
    }
    if (
      request.method === "GET" &&
      (pathname === "/healthz" || pathname === "/readyz") &&
      repository.healthCheck
    ) {
      void repository
        .healthCheck()
        .then(() => handleRequest(request, response, system, options))
        .catch(() => {
          const traceId = getRequestId(request);
          writeError(
            response,
            503,
            traceId,
            new DomainError(503, "PERSISTENCE_UNAVAILABLE", "Persistent sandbox is temporarily unavailable."),
          );
        });
      return;
    }
    const traceId = getRequestId(request);
    const bufferedResponse = new BufferedResponse(response);
    void readJson(request)
      .then((parsedBody) =>
        repository.withState(system.exportState(), async (state) => {
          system.importState(state as never);
          const transactionStartState = system.exportState();
          const requestState = {
            disposition: "COMMIT_ALL" as RequestStateDisposition,
          };
          await handleRequest(
            request,
            bufferedResponse as unknown as ServerResponse,
            system,
            options,
            parsedBody,
            true,
            {
              rejectDomainRequest: () => {
                requestState.disposition = "COMMIT_SECURITY_ONLY";
              },
              rejectUnexpectedFailure: () => {
                requestState.disposition = "ROLLBACK_ALL";
              },
            },
          );
          const requestEndState = system.exportState();
          const nextState =
            requestState.disposition === "COMMIT_ALL"
              ? requestEndState
              : requestState.disposition === "COMMIT_SECURITY_ONLY"
                ? mergeRejectedSecurityState(transactionStartState, requestEndState)
                : transactionStartState;
          return {
            result: undefined,
            nextState,
          };
        }),
      )
      .then(() => bufferedResponse.flush())
      .catch((error: unknown) => {
        if (!response.headersSent) {
          if (error instanceof DomainError) {
            writeError(response, error.status, traceId, error);
            return;
          }
          writeError(
            response,
            503,
            traceId,
            new DomainError(
              503,
              "PERSISTENCE_UNAVAILABLE",
              "Persistent sandbox is temporarily unavailable.",
            ),
          );
        } else {
          response.destroy();
        }
      });
  });
}

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { BankingSystem, type BankingSystemState } from "./bankingSystem.js";
import { DomainError, conflictWithCode, invalidRequest, notFound, unauthorized } from "./errors.js";
import type {
  RelationalStateBoundaryOptions,
  RelationalStateOperation,
} from "./postgresRelationalRepository.js";
import type {
  MfaChallengePurpose,
  PersistentMfaService,
} from "./mfa/persistentMfaService.js";
import type { EmailProviderHealth } from "./mfa/delivery.js";
import type { OtpPurpose } from "./types.js";
import type { RuntimeMetadata } from "./runtimeMetadata.js";
import { createRequestContext, normalizeRequestId, requestContextHeaders, type RequestContext } from "./observability/requestContext.js";
import { createStructuredLogger, type StructuredLogger } from "./observability/logger.js";
import { collectDatabaseMetrics, PrometheusRegistry, registerBusinessMetrics, registerHttpMetrics, type DatabasePoolMetricSnapshot } from "./observability/metrics.js";
import type { RelationalHttpBoundary } from "./database/relationalHttpBoundary.js";
import { DatabaseCommandError } from "./database/commandErrors.js";
import { computeRegistrationNetworkFingerprint, fingerprint } from "./security.js";
import {
  AssistantHelpService,
  resolveAssistantConfig,
  type AssistantConfig,
  AssistantRateLimiter,
  readAssistantBody,
  parseAndValidateAssistantPayload,
  scanSensitiveData,
} from "./assistant/index.js";

const API_PREFIX = "/api/v1";
const MAX_BODY_BYTES = 1_000_000;

export type HttpOptions = {
  allowedOrigins?: string[];
  environment?: string;
  storage?: string;
  commitSha?: string;
  runtimeMetadata?: RuntimeMetadata;
  startupReady?: boolean | (() => boolean);
  /** Direct persistence/schema check used by readiness, never by liveness. */
  readinessCheck?: () => Promise<void>;
  /** Database-backed business health snapshot; kept separate from liveness. */
  businessHealthCheck?: () => Promise<{
    status: "ok" | "degraded";
    reconciliation: "ok" | "mismatch";
    outbox: "ok" | "degraded";
    pendingOutboxEvents: number;
  }>;
  /** Redacted OTP provider readiness; credentials are never returned. */
  emailProviderHealth?: () => EmailProviderHealth | Promise<EmailProviderHealth>;
  metrics?: PrometheusRegistry;
  logger?: StructuredLogger;
  serviceName?: string;
  databaseMetrics?: () => DatabasePoolMetricSnapshot;
  /** Internal marker: persistent server instruments the real response before buffering. */
  instrumented?: boolean;
  /** PostgreSQL-backed MFA boundary. Omitted only for legacy unit-test servers. */
  mfaService?: PersistentMfaService;
  /** Optional persistent customer-access gate owned by the Admin control plane. */
  customerAccessStatus?: (customerId: string) => Promise<"ACTIVE" | "LOCKED" | null>;
  /** Optional route-scoped direct relational boundary used during cutover. */
  relationalHttp?: RelationalHttpBoundary;
  /** Optional assistant configuration for AI help endpoint */
  assistantConfig?: Partial<AssistantConfig>;
  /** Optional preconfigured assistant help service */
  assistantService?: AssistantHelpService;
  /** Optional rate limiter instance for assistant requests */
  assistantRateLimiter?: AssistantRateLimiter;
  /** HMAC key for registration network fingerprint; required at all runtimes. */
  registrationFingerprintKey: Buffer;
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
  return normalizeRequestId(header(request, "x-request-id"));
}

function metricRoute(request: IncomingMessage): string {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (["/livez", "/startupz", "/readyz", "/healthz", "/versionz", "/metrics"].includes(pathname)) return pathname;
  const parts = pathname.split("/").filter(Boolean).slice(0, 6).map((part) =>
    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(part) || /^\d{8,}$/.test(part) || part.length > 48 ? ":id" : part,
  );
  return `/${parts.join("/")}`.slice(0, 64) || "/";
}

function outcomeForStatus(status: number): string {
  if (status >= 500) return "platform_failure";
  if (status === 401 || status === 403 || status === 429) return "security_rejection";
  if (status >= 400) return "domain_rejection";
  return "success";
}

function instrumentResponse(request: IncomingMessage, response: ServerResponse, options: HttpOptions, context: RequestContext): void {
  const registry = options.metrics;
  if (!registry || typeof (response as unknown as { once?: unknown }).once !== "function") return;
  const startedAt = performance.now();
  const route = metricRoute(request);
  const method = (request.method ?? "GET").toUpperCase();
  registry.add("http_requests_active", 1, { service: options.serviceName ?? "banking-reference-backend" });
  let completed = false;
  const complete = (): void => {
    if (completed) return;
    completed = true;
    const status = response.statusCode || 500;
    const statusClass = `${Math.floor(status / 100)}xx`;
    const outcome = outcomeForStatus(status);
    registry.increment("http_requests_total", 1, { method, route, status_class: statusClass, outcome });
    registry.observe("http_request_duration_seconds", (performance.now() - startedAt) / 1000, { method, route });
    if (route.includes("/transfers")) {
      const operation = route.includes("/quote") ? "quote" : route.endsWith("/transfers") ? "submit" : "read";
      registry.increment("banking_transfer_requests_total", 1, { operation, outcome });
    }
    registry.add("http_requests_active", -1, { service: options.serviceName ?? "banking-reference-backend" });
    options.logger?.log(status >= 500 ? "error" : status >= 400 ? "info" : "info", "http_request_completed", {
      requestId: context.requestId,
      traceId: context.traceId,
      spanId: context.spanId,
      method,
      route,
      statusClass,
      outcome,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    });
  };
  response.once("finish", complete);
  response.once("close", complete);
}

function collectRuntimeMetrics(options: HttpOptions): void {
  if (!options.metrics) return;
  collectDatabaseMetrics(options.metrics, options.databaseMetrics?.());
}

function recordBusinessHealth(options: HttpOptions, health: { status: string; reconciliation?: string; pendingOutboxEvents?: number }): void {
  if (!options.metrics) return;
  options.metrics.increment("banking_health_checks_total", 1, { status: health.status });
  options.metrics.set("banking_reconciliation_mismatch", health.reconciliation === "mismatch" ? 1 : 0);
  options.metrics.set("banking_outbox_pending_events", Number(health.pendingOutboxEvents ?? 0));
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

function writeTextResponse(
  response: ServerResponse,
  status: number,
  traceId: string,
  body: string,
): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Request-ID", traceId);
  response.end(body);
}

function writeError(
  response: ServerResponse,
  status: number,
  traceId: string,
  error: DomainError,
): void {
  if (error.retryAfterSeconds !== null) {
    response.setHeader("Retry-After", String(Math.max(1, Math.ceil(error.retryAfterSeconds))));
  }
  writeResponse(response, status, traceId, {
    code: error.code,
    message: error.message,
    fieldErrors: error.fieldErrors,
    traceId,
  });
}

function runtimeMetadataFor(options: HttpOptions): RuntimeMetadata & { storage: string } {
  if (options.runtimeMetadata) {
    return {
      ...options.runtimeMetadata,
      storage: options.storage?.trim() || process.env.BANKING_STORAGE?.trim() || "in-memory",
    };
  }
  return {
    service: "banking-reference-backend",
    releaseId: process.env.RELEASE_ID?.trim() || "local",
    imageDigest: process.env.IMAGE_DIGEST?.trim() || "unknown",
    environment:
      options.environment?.trim() || process.env.BANKING_ENV?.trim() || "development",
    moneyMode: process.env.BANKING_MONEY_MODE?.trim() || "virtual",
    schemaVersion: process.env.SCHEMA_VERSION?.trim() || "unknown",
    migrationSetDigest: process.env.MIGRATION_SET_DIGEST?.trim() || "unknown",
    apiContractDigest: process.env.API_CONTRACT_DIGEST?.trim() || "unknown",
    builtAt: process.env.BUILD_CREATED_AT?.trim() || null,
    startedAt: new Date().toISOString(),
    storage: options.storage?.trim() || process.env.BANKING_STORAGE?.trim() || "in-memory",
    commitSha: options.commitSha?.trim() || process.env.BUILD_COMMIT_SHA?.trim() || "local",
  };
}

function isStartupReady(options: HttpOptions): boolean {
  return typeof options.startupReady === "function"
    ? options.startupReady()
    : options.startupReady !== false;
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

async function requireBearer(
  request: IncomingMessage,
  system: BankingSystem,
  options: HttpOptions,
  relationalAuth?: RelationalHttpBoundary,
): Promise<string> {
  const authorization = header(request, "authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw unauthorized("Access token is required.");
  }
  const deviceId = header(request, "x-device-id");
  if (!deviceId?.trim()) {
    throw unauthorized("Device binding is required.");
  }
  const userId = (relationalAuth
    ? await relationalAuth.authenticate(authorization.slice("Bearer ".length), deviceId)
    : system.authenticate(authorization.slice("Bearer ".length), deviceId)).id;
  if (options.customerAccessStatus && (await options.customerAccessStatus(userId)) === "LOCKED") {
    throw unauthorized("Customer access is locked by the control plane.");
  }
  return userId;
}

function requireDeviceId(request: IncomingMessage): string {
  const deviceId = header(request, "x-device-id");
  if (!deviceId?.trim()) {
    throw unauthorized("Device binding is required.");
  }
  return deviceId.trim();
}

function getRateLimitKey(request: IncomingMessage, registrationFingerprintKey: Buffer): string {
  return computeRegistrationNetworkFingerprint(request.socket.remoteAddress, registrationFingerprintKey);
}

// Registration must never fall back to x-forwarded-for, because that header is
// client-spoofable; it derives its bucket solely from the socket address through
// the keyed HMAC. The authenticated MFA flows predate that hardening and keep
// their original derivation so B2B does not change non-Registration behavior.
function getMfaClientAddress(request: IncomingMessage): string {
  const forwardedFor = header(request, "x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.socket.remoteAddress || "unknown-client";
}

type PersistentStepUpPurpose = Extract<
  MfaChallengePurpose,
  "TRANSFER" | "SAVINGS_OPENING" | "CREDIT_APPLICATION" | "CARD_ACTIVATION" | "CREDIT_PAYMENT" | "CARD_UNLOCK" | "CARD_REPORT_LOST" | "RECOVERY_CODE_ROTATION" | "MFA_FACTOR_CHANGE" | "MFA_FACTOR_REMOVAL"
>;

async function verifyMfaLifecycleChallenge(
  mfaService: PersistentMfaService,
  request: IncomingMessage,
  customerId: string,
  data: Record<string, unknown>,
  purpose: "MFA_FACTOR_CHANGE" | "MFA_FACTOR_REMOVAL",
): Promise<void> {
  if (typeof data.challengeId !== "string" || typeof data.code !== "string") {
    throw conflictWithCode("MFA_CURRENT_FACTOR_REQUIRED", "Current TOTP verification is required for this MFA change.");
  }
  const result = await mfaService.verifyChallenge({
    challengeId: data.challengeId,
    customerId,
    deviceId: requireDeviceId(request),
    proof: data.code,
    purpose,
    resourceId: null,
    requestFingerprint: null,
  });
  if (result.customerId !== customerId) {
    throw unauthorized("MFA user binding is invalid.");
  }
}

async function verifyPersistentStepUp(
  mfaService: PersistentMfaService,
  system: BankingSystem,
  request: IncomingMessage,
  userId: string,
  data: Record<string, unknown>,
  purpose: PersistentStepUpPurpose,
  resourceId: string | null,
  suppliedFingerprint?: string | null,
): Promise<void> {
  const rawStepUp = data.stepUp;
  if (typeof rawStepUp !== "object" || rawStepUp === null || Array.isArray(rawStepUp)) {
    throw invalidRequest("stepUp is required for this command.");
  }
  const stepUp = rawStepUp as Record<string, unknown>;
  if (stepUp.method !== "TOTP") {
    throw conflictWithCode("STEP_UP_INVALID", "Production-like runtime chỉ chấp nhận TOTP cho step-up.");
  }
  if (typeof stepUp.challengeId !== "string" || !stepUp.challengeId.trim()) {
    throw invalidRequest("stepUp.challengeId is required.");
  }
  if (typeof stepUp.proof !== "string" || !stepUp.proof.trim()) {
    throw invalidRequest("stepUp.proof is required.");
  }
  const deviceId = requireDeviceId(request);
  const requestFingerprint = system.getStepUpRequestFingerprint(
    purpose as OtpPurpose,
    resourceId,
    suppliedFingerprint,
  );
  const result = await mfaService.verifyChallenge({
    challengeId: stepUp.challengeId,
    customerId: userId,
    deviceId,
    proof: stepUp.proof,
    purpose,
    resourceId,
    requestFingerprint,
  });
  if (result.customerId !== userId) {
    throw unauthorized("MFA user binding is invalid.");
  }
  system.registerExternalStepUpVerification({
    userId,
    challengeId: stepUp.challengeId,
    deviceId,
    method: "TOTP",
    purpose: purpose as OtpPurpose,
    resourceId,
    requestFingerprint,
  });
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
  if (
    (method === "GET" && segments.length === 3 && segments[0] === "auth" && segments[1] === "mfa" && segments[2] === "methods") ||
    (method === "POST" && segments.length === 4 && segments[0] === "auth" && segments[1] === "mfa" && segments[2] === "totp" && (segments[3] === "enroll" || segments[3] === "confirm")) ||
    (method === "DELETE" && segments.length === 4 && segments[0] === "auth" && segments[1] === "mfa" && segments[2] === "methods") ||
    (method === "POST" && segments.length === 4 && segments[0] === "auth" && segments[1] === "mfa" && segments[2] === "recovery-codes" && segments[3] === "rotate") ||
    (method === "POST" && segments.length === 3 && segments[0] === "auth" && segments[1] === "mfa" && segments[2] === "recover") ||
    (method === "POST" && segments.length === 4 && segments[0] === "auth" && segments[1] === "mfa" && segments[2] === "recover" && (segments[3] === "verify" || segments[3] === "complete")) ||
    (method === "POST" && segments.length === 4 && segments[0] === "auth" && segments[1] === "challenges" && segments[3] === "resend")
  ) {
    return true;
  }
  if (method === "POST" && segments.length === 1 && segments[0] === "fraud-reports") {
    return true;
  }
  if (
    (method === "GET" && segments.length === 2 && segments[0] === "kyc" && segments[1] === "application") ||
    (method === "POST" && segments.length === 2 && segments[0] === "kyc" && segments[1] === "application") ||
    (method === "POST" && segments.length === 3 && segments[0] === "kyc" && segments[1] === "application" && segments[2] === "submit")
  ) {
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
    (segments[2] === "lock" || segments[2] === "unlock" || segments[2] === "report-lost")
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

const defaultAssistantRateLimiter = new AssistantRateLimiter(resolveAssistantConfig());

async function handleAssistantRoute(
  request: IncomingMessage,
  response: ServerResponse,
  system: BankingSystem,
  options: HttpOptions,
  segments: readonly string[],
  traceId: string,
): Promise<void> {
  if (request.method !== "POST" || segments.length !== 2 || segments[1] !== "help") {
    throw notFound("API route not found.");
  }

  const config = resolveAssistantConfig(options.assistantConfig);
  if (!config.enabled) {
    throw new DomainError(503, "ASSISTANT_UNAVAILABLE", "Assistant help service is currently unavailable.");
  }

  const rawContentType = header(request, "content-type");
  if (!rawContentType) {
    throw new DomainError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
  }
  const [mediaType] = rawContentType.split(";").map((s) => s.trim().toLowerCase());
  if (mediaType !== "application/json") {
    throw new DomainError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
  }

  const requestAbortController = new AbortController();
  let requestTimedOut = false;
  const requestDeadlineTimer = setTimeout(() => {
    requestTimedOut = true;
    requestAbortController.abort();
  }, config.requestTimeoutMs);
  requestDeadlineTimer.unref();

  const onClientPrematureClose = () => {
    if (!response.writableEnded && !response.writableFinished) {
      requestAbortController.abort();
    }
  };
  response.once("close", onClientPrematureClose);
  if (request.socket) {
    request.socket.once("close", onClientPrematureClose);
  }

  // Start reading stream body immediately so Node doesn't drop chunks during async auth
  const bodyPromise = readAssistantBody(request, config.maxBodyBytes, requestAbortController.signal);
  // Ensure unhandled rejection is avoided if auth fails first
  bodyPromise.catch(() => {});

  try {
    // Race auth against request deadline so a hanging auth call doesn't block past deadline
    const authPromise = requireBearer(request, system, options, options.relationalHttp);
    authPromise.catch(() => {});

    let onAuthAbort: (() => void) | undefined;
    const deadlineRejection = new Promise<never>((_, reject) => {
      if (requestAbortController.signal.aborted) {
        reject(new DomainError(504, "ASSISTANT_TIMEOUT", "Assistant service request timed out."));
        return;
      }
      onAuthAbort = () => reject(new DomainError(504, "ASSISTANT_TIMEOUT", "Assistant service request timed out."));
      requestAbortController.signal.addEventListener("abort", onAuthAbort, { once: true });
    });

    let userId: string;
    try {
      userId = await Promise.race([authPromise, deadlineRejection]);
    } finally {
      if (onAuthAbort) {
        requestAbortController.signal.removeEventListener("abort", onAuthAbort);
      }
    }
    const rawBody = await bodyPromise;
    const validated = parseAndValidateAssistantPayload(rawBody, config.maxQuestionCodePoints);

    if (scanSensitiveData(validated.question)) {
      throw new DomainError(422, "ASSISTANT_SENSITIVE_INPUT", "Request contains sensitive information; please remove credentials or secrets before asking.");
    }

    const rateLimiter = options.assistantRateLimiter ?? (options.assistantConfig ? new AssistantRateLimiter(config) : defaultAssistantRateLimiter);
    const releaseSlot = rateLimiter.acquire(userId);

    try {
      if (requestTimedOut || requestAbortController.signal.aborted) {
        throw new DomainError(504, "ASSISTANT_TIMEOUT", "Assistant service request timed out.");
      }

      const service = options.assistantService ?? new AssistantHelpService(config);
        const answer = await service.executeHelpRequest(
          validated.question,
          requestAbortController.signal,
          () => rateLimiter.consumeProviderCall(),
        );

      if (requestTimedOut || requestAbortController.signal.aborted) {
        throw new DomainError(504, "ASSISTANT_TIMEOUT", "Assistant service request timed out.");
      }

      if (response.writableEnded || response.destroyed) {
        return;
      }

      response.setHeader("Cache-Control", "no-store");
      writeResponse(response, 200, traceId, { answer });
    } finally {
      releaseSlot();
    }
  } catch (error: unknown) {
    if (!request.readableEnded) {
      request.resume();
    }
    if (response.writableEnded || response.destroyed) {
      return;
    }
    if (requestTimedOut) {
      writeError(response, 504, traceId, new DomainError(504, "ASSISTANT_TIMEOUT", "Assistant service request timed out."));
      return;
    }
    if (error instanceof DomainError) {
      writeError(response, error.status, traceId, error);
      return;
    }
    writeError(response, 500, traceId, new DomainError(500, "INTERNAL_ERROR", "Internal server error."));
  } finally {
    clearTimeout(requestDeadlineTimer);
    response.removeListener("close", onClientPrematureClose);
    if (request.socket) {
      request.socket.removeListener("close", onClientPrematureClose);
    }
  }
}

export async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  system: BankingSystem,
  options: HttpOptions,
  parsedBody?: unknown,
  bodyAlreadyRead = false,
  stateBoundary?: RequestStateBoundary,
  requestContext?: RequestContext,
): Promise<void> {
  const context = requestContext ?? createRequestContext(request);
  const traceId = context.requestId;
  for (const [name, value] of Object.entries(requestContextHeaders(context))) response.setHeader(name, value);
  if (!options.instrumented) instrumentResponse(request, response, options, context);
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
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, X-Device-ID, X-Request-ID, traceparent, tracestate");
  response.setHeader("Access-Control-Allow-Methods", "DELETE,GET,PATCH,POST,OPTIONS");

  if (request.method === "OPTIONS") {
    writeResponse(response, 204, traceId);
    return;
  }

  try {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && requestUrl.pathname === "/livez") {
      writeResponse(response, 200, traceId, {
        ...runtimeMetadataFor(options),
        status: "ok",
        checkedAt: new Date().toISOString(),
      });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/startupz") {
      const ready = isStartupReady(options);
      writeResponse(response, ready ? 200 : 503, traceId, {
        ...runtimeMetadataFor(options),
        status: ready ? "ok" : "starting",
        checkedAt: new Date().toISOString(),
      });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/versionz") {
      writeResponse(response, 200, traceId, runtimeMetadataFor(options));
      return;
    }
    if (
      request.method === "GET" &&
      (requestUrl.pathname === "/healthz" || requestUrl.pathname === "/readyz")
    ) {
      if (options.readinessCheck && !options.instrumented) {
        try {
          await options.readinessCheck();
        } catch {
          writeError(
            response,
            503,
            traceId,
            new DomainError(503, "PERSISTENCE_UNAVAILABLE", "Persistent sandbox is temporarily unavailable."),
          );
          return;
        }
      }
      const health = system.getHealth();
      if (options.businessHealthCheck) {
        try {
          const databaseHealth = await options.businessHealthCheck();
          health.status = health.status === "ok" && databaseHealth.status === "ok" ? "ok" : "degraded";
          health.reconciliation = health.reconciliation === "ok" && databaseHealth.reconciliation === "ok" ? "ok" : "mismatch";
          health.outbox = databaseHealth.outbox;
          health.pendingOutboxEvents = databaseHealth.pendingOutboxEvents;
        } catch {
          health.status = "degraded";
          health.outbox = "degraded";
        }
      }
      if (options.emailProviderHealth) {
        try {
          const emailProvider = await options.emailProviderHealth();
          health.emailProvider = emailProvider;
          const isProductionLike = options.environment === "staging" || options.environment === "production-like";
          if (isProductionLike && emailProvider.status === "degraded") {
            health.status = "degraded";
          }
        } catch {
          const isProductionLike = options.environment === "staging" || options.environment === "production-like";
          if (isProductionLike) {
            health.status = "degraded";
          }
          health.emailProvider = {
            provider: "smtp",
            status: "degraded",
            configured: false,
            credentialConfigured: false,
            lastErrorCode: "email-provider-health-failed",
          };
        }
      }
      recordBusinessHealth(options, health);
      writeResponse(response, health.status === "ok" ? 200 : 503, traceId, {
        ...runtimeMetadataFor(options),
        ...health,
      });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/metrics" && (options.mfaService || options.metrics)) {
      collectRuntimeMetrics(options);
      const sections = [options.metrics?.prometheus(), options.mfaService?.metrics.prometheus()].filter(Boolean);
      writeTextResponse(response, 200, traceId, `${sections.join("\n")}`);
      return;
    }

    if (!requestUrl.pathname.startsWith(API_PREFIX)) {
      throw notFound("API route not found.");
    }
    const routePath = requestUrl.pathname.slice(API_PREFIX.length) || "/";
    const segments = pathSegments(routePath);
    if (segments[0] === "assistant") {
      await handleAssistantRoute(
        request,
        response,
        system,
        options,
        segments,
        traceId,
      );
      return;
    }
    const body = bodyAlreadyRead ? parsedBody : await readJson(request);
    const relationalV2 = process.env.BANKING_PERSISTENCE_MODE?.trim() === "relational-v2";
    const registrationRoute = (request.method === "POST" && segments[0] === "auth" && segments[1] === "register");
    if (relationalV2 && registrationRoute && !(options.relationalHttp?.isRouteEnabled(request.method, segments) ?? false)) {
      writeError(response, 503, traceId, new DomainError(503, "RELATIONAL_ROUTE_OUT_OF_SCOPE", "Registration requires an approved relational email-provider boundary and is disabled in this local relational-v2 cutover."));
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 2 &&
      segments[0] === "auth" &&
      segments[1] === "register"
    ) {
      const data = requireObject(body);
      const relationalAuth = options.relationalHttp?.isRouteEnabled(request.method, segments)
        ? options.relationalHttp
        : undefined;
      writeResponse(
        response,
        202,
        traceId,
        relationalAuth && options.mfaService
          ? await relationalAuth.beginRegistration(
            data as never,
            requireDeviceId(request),
            options.mfaService,
            getRateLimitKey(request, options.registrationFingerprintKey),
          )
          : await system.beginRegistrationAsync(data as never, getRateLimitKey(request, options.registrationFingerprintKey), requireDeviceId(request)),
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
      const challengeId = data.challengeId;
      const method = data.method;
      const proof = data.proof;

      if (typeof challengeId !== "string" || challengeId.length < 1) {
        throw invalidRequest("challengeId is required.", { challengeId: "challengeId must be a non-empty string." });
      }
      if (method !== "EMAIL_OTP") {
        throw invalidRequest("method must be EMAIL_OTP for registration verification.", { method: "method must be EMAIL_OTP." });
      }
      if (typeof proof !== "string" || proof.length < 1) {
        throw invalidRequest("proof is required.", { proof: "proof must be a non-empty string." });
      }

      const relationalAuth = options.relationalHttp?.isRouteEnabled(request.method, segments)
        ? options.relationalHttp
        : undefined;
      writeResponse(
        response,
        201,
        traceId,
        relationalAuth && options.mfaService
          ? await relationalAuth.verifyRegistration(
            challengeId,
            proof,
            requireDeviceId(request),
            options.mfaService,
          )
          : await Promise.resolve(system.verifyRegistrationChallenge(challengeId, proof, requireDeviceId(request))),
      );
      return;
    }
    if (
      request.method === "POST" &&
      segments.length === 3 &&
      segments[0] === "auth" &&
      segments[1] === "register" &&
      segments[2] === "cancel"
    ) {
      const data = requireObject(body);
      const challengeId = data.challengeId;

      if (typeof challengeId !== "string" || challengeId.length < 1) {
        throw invalidRequest("challengeId is required.", { challengeId: "challengeId must be a non-empty string." });
      }

      const rawDeviceId = header(request, "x-device-id");
      if (!rawDeviceId?.trim()) {
        throw invalidRequest("Device binding is required.");
      }
      const deviceId = rawDeviceId.trim();

      const relationalAuth = options.relationalHttp?.isRouteEnabled(request.method, segments)
        ? options.relationalHttp
        : undefined;

      if (relationalAuth) {
        // Bypass typescript private modifier to access registration service since relationalHttpBoundary is outside allowlist
        await (relationalAuth as any).registration.cancel(challengeId, deviceId);
      } else {
        await (system as any).cancelRegistrationChallenge?.(challengeId, deviceId);
      }

      writeResponse(response, 204, traceId);
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 2 &&
      segments[0] === "auth" &&
      segments[1] === "login"
    ) {
      const data = requireObject(body);
      const relationalAuth = options.relationalHttp?.isRouteEnabled(request.method, segments)
        ? options.relationalHttp
        : undefined;
      // Customer login is deliberately password-only in every HTTP runtime.
      // Transactional and account-security step-up challenges are separate
      // authenticated flows and must never be part of session issuance.
      const user = relationalAuth
        ? await relationalAuth.loginPasswordOnly(data.email as string, data.password as string, requireDeviceId(request))
        : await system.loginPasswordOnly(data.email as string, data.password as string, requireDeviceId(request));
      if (options.customerAccessStatus && (await options.customerAccessStatus(user.id)) === "LOCKED") {
        throw unauthorized("Customer access is locked by the control plane.");
      }
      writeResponse(response, 200, traceId, relationalAuth
        ? await relationalAuth.issueMfaSession(user.id, requireDeviceId(request))
        : system.issueMfaSession(user.id, requireDeviceId(request)));
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 2 &&
      segments[0] === "auth" &&
      segments[1] === "verify"
    ) {
      const data = requireObject(body);
      const relationalAuth = options.relationalHttp?.isRouteEnabled(request.method, segments)
        ? options.relationalHttp
        : undefined;
      // The persistent customer runtime has a password-only login contract.
      // Keep the legacy challenge verifier available only to the in-memory
      // reference harness; no relational-v2 request can use it as a second
      // login factor.
      if (relationalAuth) {
        throw invalidRequest("Relational-v2 login is password-only; no login MFA challenge is supported.");
      }
      if (options.mfaService) {
        const result = await options.mfaService.verifyChallenge({
          challengeId: data.challengeId as string,
          deviceId: requireDeviceId(request),
          proof: data.proof as string,
          purpose: "LOGIN",
        });
        if (!result.customerId) {
          throw unauthorized("MFA user binding is invalid.");
        }
        if (options.customerAccessStatus && (await options.customerAccessStatus(result.customerId)) === "LOCKED") {
          throw unauthorized("Customer access is locked by the control plane.");
        }
        writeResponse(response, 200, traceId, system.issueMfaSession(result.customerId, requireDeviceId(request)));
        return;
      }
      writeResponse(
        response,
        200,
        traceId,
        system.verifyLoginChallenge(
          data.challengeId as string,
          data.method as "OTP" | "TOTP" | "BIOMETRIC",
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
      const relationalAuth = options.relationalHttp?.isRouteEnabled(request.method, segments)
        ? options.relationalHttp
        : undefined;
      writeResponse(response, 200, traceId, relationalAuth
        ? await relationalAuth.refresh(data.refreshToken as string, requireDeviceId(request))
        : system.refresh(data.refreshToken as string, requireDeviceId(request)));
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 2 &&
      segments[0] === "auth" &&
      segments[1] === "logout"
    ) {
      const data = requireObject(body);
      const relationalAuth = options.relationalHttp?.isRouteEnabled(request.method, segments)
        ? options.relationalHttp
        : undefined;
      const revoked = relationalAuth
        ? await relationalAuth.revoke(data.refreshToken as string, requireDeviceId(request))
        : system.revoke(data.refreshToken as string, requireDeviceId(request));
      if (!revoked) {
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
      const relationalAuth = options.relationalHttp?.isRouteEnabled(request.method, segments)
        ? options.relationalHttp
        : undefined;
      const userId = await requireBearer(request, system, options, relationalAuth);
      if (relationalAuth) await relationalAuth.revokeAllSessions(userId);
      else system.revokeAllSessions(userId);
      writeResponse(response, 204, traceId);
      return;
    }

    // Recovery may start after the normal session has been revoked.  Accept a
    // password + recovery code (or a one-time recovery token for completion)
    // before the bearer-authenticated route gate; never issue a banking session
    // from this endpoint.
    if (
      options.mfaService &&
      request.method === "POST" &&
      segments[0] === "auth" &&
      segments[1] === "mfa" &&
      ((segments.length === 3 && segments[2] === "recover") ||
        (segments.length === 4 && segments[2] === "recover" && (segments[3] === "verify" || segments[3] === "complete"))) &&
      !header(request, "authorization")
    ) {
      const data = requireObject(body);
      if (segments[3] === "complete") {
        if (typeof data.recoveryToken !== "string" || !data.recoveryToken.trim()) {
          throw invalidRequest("recoveryToken is required.");
        }
        await options.mfaService.completeRecovery({ recoveryToken: data.recoveryToken });
        writeResponse(response, 202, traceId, { status: "RECOVERY_COMPLETED" });
        return;
      }
      if (typeof data.email !== "string" || typeof data.password !== "string" || typeof data.code !== "string") {
        throw invalidRequest("email, password and code are required to start MFA recovery.");
      }
      const relationalAuth = options.relationalHttp?.isRouteEnabled(request.method, segments)
        ? options.relationalHttp
        : undefined;
      const user = relationalAuth
        ? await relationalAuth.loginPasswordOnly(data.email, data.password, requireDeviceId(request))
        : await system.loginPasswordOnly(data.email, data.password, requireDeviceId(request));
      const recovery = await options.mfaService.verifyRecoveryCode(user.id, data.code);
      if (relationalAuth) await relationalAuth.revokeAllSessions(user.id);
      else system.revokeAllSessions(user.id);
      writeResponse(response, 202, traceId, { ...recovery, status: "RECOVERY_STARTED" });
      return;
    }

    // A completed recovery request yields only a short-lived enrollment
    // capability. It cannot read banking data or mint a session; it exists
    // solely to replace the revoked TOTP factor.
    if (
      options.mfaService &&
      request.method === "POST" &&
      segments.length === 4 &&
      segments[0] === "auth" &&
      segments[1] === "mfa" &&
      segments[2] === "recover" &&
      segments[3] === "enroll" &&
      !header(request, "authorization")
    ) {
      const data = requireObject(body);
      if (typeof data.recoveryToken !== "string" || !data.recoveryToken.trim()) {
        throw invalidRequest("recoveryToken is required.");
      }
      writeResponse(response, 201, traceId, await options.mfaService.beginRecoveryTotpEnrollment({
        recoveryToken: data.recoveryToken,
        displayName: typeof data.displayName === "string" ? data.displayName : undefined,
      }));
      return;
    }

    if (
      options.mfaService &&
      request.method === "POST" &&
      segments.length === 4 &&
      segments[0] === "auth" &&
      segments[1] === "mfa" &&
      segments[2] === "totp" &&
      segments[3] === "confirm" &&
      !header(request, "authorization")
    ) {
      const data = requireObject(body);
      if (
        typeof data.recoveryToken === "string" &&
        typeof data.credentialId === "string" &&
        typeof data.code === "string"
      ) {
        writeResponse(response, 200, traceId, await options.mfaService.confirmTotpEnrollment({
          recoveryToken: data.recoveryToken,
          credentialId: data.credentialId,
          code: data.code,
        }));
        return;
      }
    }

    // Registration is still pre-authentication, so its OTP must be
    // resendable without a bearer token. The service resolves the pending
    // registration email server-side and never trusts a client destination.
    if (
      options.mfaService &&
      request.method === "POST" &&
      segments.length === 4 &&
      segments[0] === "auth" &&
      segments[1] === "challenges" &&
      segments[3] === "resend" &&
      !header(request, "authorization")
    ) {
      requireObject(body);
      writeResponse(response, 200, traceId, await options.mfaService.resendRegistrationChallenge({
        challengeId: segments[2]!,
        deviceId: requireDeviceId(request),
        networkFingerprint: getRateLimitKey(request, options.registrationFingerprintKey),
      }));
      return;
    }

    if (
      request.method === "GET" &&
      segments.length === 2 &&
      segments[0] === "mobile" &&
      segments[1] === "control-policy"
    ) {
      const directPolicyRoute = options.relationalHttp?.isRouteEnabled(request.method, ["mobile", "control-policy"]) ?? false;
      const userId = await requireBearer(request, system, options, directPolicyRoute ? options.relationalHttp : undefined);
      writeResponse(response, 200, traceId, directPolicyRoute && options.relationalHttp
        ? await options.relationalHttp.getControlPolicy()
        : system.getControlPolicy(userId));
      return;
    }

    if (!isAuthenticatedRoute(request.method, segments)) {
      throw notFound("API route not found.");
    }

    const relationalRoute = options.relationalHttp?.isRouteEnabled(request.method, segments) ?? false;
    const userId = await requireBearer(
      request,
      system,
      options,
      relationalRoute ? options.relationalHttp : undefined,
    );
    const relationalAuth = relationalRoute ? options.relationalHttp : undefined;

    if (relationalRoute && options.relationalHttp) {
      if (request.method === "GET" && segments.length === 2 && segments[0] === "kyc" && segments[1] === "application") {
        writeResponse(response, 200, traceId, { application: await options.relationalHttp.getKycApplication(userId) });
        return;
      }
      if (request.method === "POST" && segments.length === 2 && segments[0] === "kyc" && segments[1] === "application") {
        const data = requireObject(body);
        writeResponse(response, 200, traceId, { application: await options.relationalHttp.saveKycDraft(userId, data as never) });
        return;
      }
      if (request.method === "POST" && segments.length === 3 && segments[0] === "kyc" && segments[1] === "application" && segments[2] === "submit") {
        const data = requireObject(body);
        writeResponse(response, 201, traceId, { application: await options.relationalHttp.submitKycApplication(userId, data as never) });
        return;
      }
      if (request.method === "GET" && segments.length === 1 && segments[0] === "cards") {
        writeResponse(response, 200, traceId, await options.relationalHttp.listCards(userId));
        return;
      }
      if (request.method === "GET" && segments.length === 2 && segments[0] === "cards") {
        writeResponse(response, 200, traceId, await options.relationalHttp.getCard(userId, segments[1]));
        return;
      }
      if (request.method === "GET" && segments.length === 2 && segments[0] === "credit" && segments[1] === "applications") {
        writeResponse(response, 200, traceId, await options.relationalHttp.listCreditApplications(userId));
        return;
      }
      if (request.method === "POST" && segments.length === 2 && segments[0] === "credit" && segments[1] === "applications") {
        const data = requireObject(body);
        if (!options.mfaService) throw invalidRequest("TOTP step-up challenge is required for relational credit application.");
        const stepUp = typeof data.stepUp === "object" && data.stepUp !== null && !Array.isArray(data.stepUp) ? data.stepUp as Record<string, unknown> : null;
        if (!stepUp || stepUp.method !== "TOTP" || typeof stepUp.challengeId !== "string" || typeof stepUp.proof !== "string") throw invalidRequest("TOTP step-up challenge is required for relational credit application.");
        const requestFingerprint = await options.relationalHttp.getCreditApplicationRequestFingerprint(data.requestedLimit);
        const verified = await options.mfaService.verifyChallenge({ challengeId: stepUp.challengeId, customerId: userId, deviceId: requireDeviceId(request), proof: stepUp.proof, purpose: "CREDIT_APPLICATION", resourceId: null, requestFingerprint });
        if (verified.customerId !== userId) throw unauthorized("MFA user binding is invalid.");
        writeResponse(response, 201, traceId, await options.relationalHttp.submitCreditApplication({ customerId: userId, idempotencyKey: header(request, "idempotency-key") ?? "", request: data as never, traceId }));
        return;
      }
      if (request.method === "GET" && segments.length === 3 && segments[0] === "credit" && segments[1] === "applications") {
        writeResponse(response, 200, traceId, await options.relationalHttp.getCreditApplication(userId, segments[2]));
        return;
      }
      if (request.method === "POST" && segments.length === 4 && segments[0] === "credit" && segments[1] === "applications" && segments[3] === "activate") {
        const data = requireObject(body);
        if (!options.mfaService) throw invalidRequest("TOTP step-up challenge is required for relational credit activation.");
        const stepUp = typeof data.stepUp === "object" && data.stepUp !== null && !Array.isArray(data.stepUp) ? data.stepUp as Record<string, unknown> : null;
        if (!stepUp || stepUp.method !== "TOTP" || typeof stepUp.challengeId !== "string" || typeof stepUp.proof !== "string") throw invalidRequest("TOTP step-up challenge is required for relational credit activation.");
        const verified = await options.mfaService.verifyChallenge({ challengeId: stepUp.challengeId, customerId: userId, deviceId: requireDeviceId(request), proof: stepUp.proof, purpose: "CARD_ACTIVATION", resourceId: segments[2], requestFingerprint: fingerprint({ applicationId: segments[2] }) });
        if (verified.customerId !== userId) throw unauthorized("MFA user binding is invalid.");
        writeResponse(response, 200, traceId, await options.relationalHttp.activateCreditApplication({ customerId: userId, applicationId: segments[2], idempotencyKey: header(request, "idempotency-key") ?? "", traceId }));
        return;
      }
      if (request.method === "POST" && segments.length === 3 && segments[0] === "cards" && (segments[2] === "lock" || segments[2] === "unlock" || segments[2] === "report-lost")) {
        const data = segments[2] === "unlock" || segments[2] === "report-lost"
          ? requireObject(body)
          : (body === undefined ? {} : requireObject(body));
        let card;
        if (segments[2] === "lock") {
          // Emergency lock is deliberately available with an authenticated
          // customer session and device binding; it must not depend on a
          // credit kill-switch or a working TOTP provider.
          card = await options.relationalHttp.lockCard(userId, segments[1]);
        } else if (segments[2] === "unlock") {
          if (!options.mfaService) throw invalidRequest("TOTP step-up challenge is required for relational card unlock.");
          const stepUp = typeof data.stepUp === "object" && data.stepUp !== null && !Array.isArray(data.stepUp) ? data.stepUp as Record<string, unknown> : null;
          if (!stepUp || stepUp.method !== "TOTP" || typeof stepUp.challengeId !== "string" || typeof stepUp.proof !== "string") throw invalidRequest("TOTP step-up challenge is required for relational card unlock.");
          const verified = await options.mfaService.verifyChallenge({ challengeId: stepUp.challengeId, customerId: userId, deviceId: requireDeviceId(request), proof: stepUp.proof, purpose: "CARD_UNLOCK", resourceId: segments[1], requestFingerprint: fingerprint({ cardId: segments[1] }) });
          if (verified.customerId !== userId) throw unauthorized("MFA user binding is invalid.");
          card = await options.relationalHttp.unlockCard(userId, segments[1]);
        } else {
          if (!options.mfaService) throw invalidRequest("TOTP step-up challenge is required to report a card lost.");
          const stepUp = typeof data.stepUp === "object" && data.stepUp !== null && !Array.isArray(data.stepUp) ? data.stepUp as Record<string, unknown> : null;
          if (!stepUp || stepUp.method !== "TOTP" || typeof stepUp.challengeId !== "string" || typeof stepUp.proof !== "string") throw invalidRequest("TOTP step-up challenge is required to report a card lost.");
          const verified = await options.mfaService.verifyChallenge({ challengeId: stepUp.challengeId, customerId: userId, deviceId: requireDeviceId(request), proof: stepUp.proof, purpose: "CARD_REPORT_LOST", resourceId: segments[1], requestFingerprint: fingerprint({ cardId: segments[1], action: "REPORT_LOST" }) });
          if (verified.customerId !== userId) throw unauthorized("MFA user binding is invalid.");
          writeResponse(response, 200, traceId, await options.relationalHttp.reportCardLost(userId, segments[1], traceId));
          return;
        }
        writeResponse(response, 200, traceId, { card });
        return;
      }
      if (request.method === "GET" && segments.length === 2 && segments[0] === "credit" && segments[1] === "accounts") {
        writeResponse(response, 200, traceId, { items: await options.relationalHttp.listCreditAccounts(userId) });
        return;
      }
      if (request.method === "GET" && segments.length === 3 && segments[0] === "credit" && segments[1] === "accounts") {
        writeResponse(response, 200, traceId, await options.relationalHttp.getCreditAccount(userId, segments[2]));
        return;
      }
      if (request.method === "GET" && segments.length === 4 && segments[0] === "credit" && segments[1] === "accounts" && segments[3] === "transactions") {
        const limit = requestUrl.searchParams.get("limit");
        writeResponse(response, 200, traceId, await options.relationalHttp.listCreditTransactions(userId, segments[2], requestUrl.searchParams.get("cursor") ?? undefined, limit === null ? undefined : Number(limit)));
        return;
      }
      if (request.method === "GET" && segments.length === 4 && segments[0] === "credit" && segments[1] === "accounts" && segments[3] === "statements") {
        const limit = requestUrl.searchParams.get("limit");
        writeResponse(response, 200, traceId, await options.relationalHttp.listCreditStatements(userId, segments[2], requestUrl.searchParams.get("cursor") ?? undefined, limit === null ? undefined : Number(limit)));
        return;
      }
      if (request.method === "GET" && segments.length === 5 && segments[0] === "credit" && segments[1] === "accounts" && segments[3] === "statements") {
        writeResponse(response, 200, traceId, { statement: await options.relationalHttp.getCreditStatement(userId, segments[2], segments[4]) });
        return;
      }
      if (request.method === "POST" && segments.length === 2 && segments[0] === "credit" && segments[1] === "payment-quotes") {
        const data = requireObject(body);
        writeResponse(response, 200, traceId, await options.relationalHttp.createCreditPaymentQuote(userId, data as never));
        return;
      }
      if (request.method === "POST" && segments.length === 2 && segments[0] === "credit" && segments[1] === "payments") {
        const data = requireObject(body);
        const stepUp = typeof data.stepUp === "object" && data.stepUp !== null && !Array.isArray(data.stepUp) ? data.stepUp as Record<string, unknown> : null;
        if (!options.mfaService || !stepUp || stepUp.method !== "TOTP" || typeof stepUp.challengeId !== "string" || typeof stepUp.proof !== "string") throw invalidRequest("TOTP step-up challenge is required for relational credit payment.");
        const quoteId = typeof data.quoteId === "string" ? data.quoteId : "";
        const requestFingerprint = await options.relationalHttp.getCreditPaymentStepUpRequestFingerprint(quoteId);
        if (!requestFingerprint) throw notFound("Credit payment quote not found.");
        const verified = await options.mfaService.verifyChallenge({ challengeId: stepUp.challengeId, customerId: userId, deviceId: requireDeviceId(request), proof: stepUp.proof, purpose: "CREDIT_PAYMENT", resourceId: quoteId, requestFingerprint });
        if (verified.customerId !== userId) throw unauthorized("MFA user binding is invalid.");
        writeResponse(response, 200, traceId, await options.relationalHttp.submitCreditPayment({ customerId: userId, idempotencyKey: header(request, "idempotency-key") ?? "", quoteId, requestFingerprint, traceId }));
        return;
      }
      if (request.method === "GET" && segments.length === 3 && segments[0] === "credit" && segments[1] === "payments") {
        writeResponse(response, 200, traceId, await options.relationalHttp.getCreditPayment(userId, segments[2]));
        return;
      }
      if (request.method === "GET" && segments.length === 2 && segments[0] === "savings" && segments[1] === "products") {
        writeResponse(response, 200, traceId, { items: await options.relationalHttp.listSavingsProducts(userId) });
        return;
      }
      if (request.method === "POST" && segments.length === 2 && segments[0] === "savings" && segments[1] === "quotes") {
        const data = requireObject(body);
        writeResponse(response, 200, traceId, await options.relationalHttp.createSavingsQuote(userId, data as never));
        return;
      }
      if (request.method === "POST" && segments.length === 2 && segments[0] === "savings" && segments[1] === "deposits") {
        const data = requireObject(body);
        const stepUp = typeof data.stepUp === "object" && data.stepUp !== null && !Array.isArray(data.stepUp)
          ? data.stepUp as Record<string, unknown>
          : null;
        if (!options.mfaService || !stepUp || stepUp.method !== "TOTP" || typeof stepUp.challengeId !== "string" || typeof stepUp.proof !== "string") {
          throw invalidRequest("TOTP step-up challenge is required for relational savings opening.");
        }
        const quoteId = typeof data.quoteId === "string" ? data.quoteId : "";
        const savingsRequestFingerprint = await options.relationalHttp.getSavingsStepUpRequestFingerprint(quoteId);
        if (!savingsRequestFingerprint) throw notFound("Savings quote not found.");
        const verified = await options.mfaService.verifyChallenge({
          challengeId: stepUp.challengeId,
          customerId: userId,
          deviceId: requireDeviceId(request),
          proof: stepUp.proof,
          purpose: "SAVINGS_OPENING",
          resourceId: quoteId,
          requestFingerprint: savingsRequestFingerprint,
        });
        if (verified.customerId !== userId) throw unauthorized("MFA user binding is invalid.");
        const opening = await options.relationalHttp.submitSavingsOpening({
          customerId: userId,
          idempotencyKey: header(request, "idempotency-key") ?? "",
          request: data as never,
          traceId,
        });
        writeResponse(response, opening.status === "PENDING" ? 202 : 200, traceId, opening);
        return;
      }
      if (request.method === "GET" && segments.length === 3 && segments[0] === "savings" && segments[1] === "openings") {
        writeResponse(response, 200, traceId, await options.relationalHttp.getSavingsOpening(userId, segments[2]));
        return;
      }
      if (request.method === "GET" && segments.length === 2 && segments[0] === "savings" && segments[1] === "deposits") {
        writeResponse(response, 200, traceId, await options.relationalHttp.listSavingsDeposits(userId));
        return;
      }
      if (request.method === "GET" && segments.length === 3 && segments[0] === "savings" && segments[1] === "deposits") {
        writeResponse(response, 200, traceId, await options.relationalHttp.getSavingsDeposit(userId, segments[2]));
        return;
      }
      if (request.method === "GET" && segments.length === 1 && segments[0] === "beneficiaries") {
        writeResponse(response, 200, traceId, { items: await options.relationalHttp.listBeneficiaries(userId) });
        return;
      }
      if (request.method === "GET" && segments.length === 2 && segments[0] === "beneficiaries") {
        writeResponse(response, 200, traceId, { beneficiary: await options.relationalHttp.getBeneficiary(userId, segments[1]) });
        return;
      }
      if (request.method === "POST" && segments.length === 1 && segments[0] === "beneficiaries") {
        const data = requireObject(body);
        writeResponse(response, 201, traceId, {
          beneficiary: await options.relationalHttp.createBeneficiary(userId, {
            displayName: data.displayName,
            accountNumber: data.accountNumber,
          }),
        });
        return;
      }
      if (request.method === "PATCH" && segments.length === 2 && segments[0] === "beneficiaries") {
        const data = requireObject(body);
        writeResponse(response, 200, traceId, {
          beneficiary: await options.relationalHttp.renameBeneficiary(userId, segments[1], data.displayName),
        });
        return;
      }
      if (request.method === "DELETE" && segments.length === 2 && segments[0] === "beneficiaries") {
        await options.relationalHttp.removeBeneficiary(userId, segments[1]);
        writeResponse(response, 204, traceId);
        return;
      }
      if (request.method === "POST" && segments.length === 2 && segments[0] === "transfers" && segments[1] === "quote") {
        const data = requireObject(body);
        writeResponse(response, 200, traceId, await options.relationalHttp.createTransferQuote({
          customerId: userId,
          sourceAccountId: data.sourceAccountId as string,
          beneficiaryId: typeof data.beneficiaryId === "string" ? data.beneficiaryId : undefined,
          lookupId: typeof data.lookupId === "string" ? data.lookupId : undefined,
          amount: data.amount,
        }));
        return;
      }
      if (request.method === "POST" && segments.length === 1 && segments[0] === "transfers") {
        const data = requireObject(body);
        const quoteId = typeof data.quoteId === "string" ? data.quoteId : "";
        const stepUp = typeof data.stepUp === "object" && data.stepUp !== null && !Array.isArray(data.stepUp)
          ? data.stepUp as Record<string, unknown>
          : null;
        if (!options.mfaService || !stepUp || stepUp.method !== "TOTP" || typeof stepUp.challengeId !== "string" || typeof stepUp.proof !== "string") {
          throw invalidRequest("TOTP step-up challenge is required for relational transfer submission.");
        }
        const transferRequestFingerprint = await options.relationalHttp.getTransferStepUpRequestFingerprint(quoteId);
        if (!transferRequestFingerprint) throw notFound("Transfer quote not found.");
        const verified = await options.mfaService.verifyChallenge({
          challengeId: stepUp.challengeId,
          customerId: userId,
          deviceId: requireDeviceId(request),
          proof: stepUp.proof,
          purpose: "TRANSFER",
          resourceId: quoteId,
          requestFingerprint: transferRequestFingerprint,
        });
        if (verified.customerId !== userId) throw unauthorized("MFA user binding is invalid.");
        const idempotencyKey = header(request, "idempotency-key")?.trim() ?? "";
        if (idempotencyKey.length < 16) throw invalidRequest("Idempotency-Key must contain at least 16 characters.");
        writeResponse(response, 200, traceId, await options.relationalHttp.submitTransfer({
          customerId: userId,
          idempotencyKey,
          quoteId,
          requestFingerprint: transferRequestFingerprint,
          traceId,
        }));
        return;
      }
      if (request.method === "GET" && segments.length === 2 && segments[0] === "transfers") {
        writeResponse(response, 200, traceId, await options.relationalHttp.getTransfer(userId, segments[1]));
        return;
      }
      if (request.method === "POST" && segments.length === 2 && segments[0] === "internal-recipients" && segments[1] === "lookup") {
        const data = requireObject(body);
        writeResponse(response, 200, traceId, { recipient: await options.relationalHttp.lookupInternalRecipient(userId, data.accountNumber) });
        return;
      }
      if (request.method === "GET" && segments.length === 1 && segments[0] === "notifications") {
        writeResponse(response, 200, traceId, { items: await options.relationalHttp.listNotifications(userId) });
        return;
      }
      if (request.method === "POST" && segments.length === 3 && segments[0] === "notifications" && segments[2] === "read") {
        writeResponse(response, 200, traceId, await options.relationalHttp.markNotificationRead(userId, segments[1]));
        return;
      }
      if (request.method === "POST" && segments.length === 1 && segments[0] === "fraud-reports") {
        const data = requireObject(body);
        const unsupportedField = Object.keys(data).find((key) => !["accountId", "transactionId", "reason"].includes(key));
        if (unsupportedField) throw invalidRequest(`Unsupported fraud report field: ${unsupportedField}.`, { [unsupportedField]: "This field is not supported." });
        writeResponse(response, 201, traceId, await options.relationalHttp.reportFraud({
          customerId: userId,
          accountId: typeof data.accountId === "string" ? data.accountId : "",
          transactionId: typeof data.transactionId === "string" ? data.transactionId : "",
          reason: typeof data.reason === "string" ? data.reason : "",
          idempotencyKey: header(request, "idempotency-key") ?? "",
          traceId,
        }));
        return;
      }
      if (request.method === "GET" && segments.length === 2 && segments[0] === "fraud-reports") {
        writeResponse(response, 200, traceId, await options.relationalHttp.getFraudReport(userId, segments[1]));
        return;
      }
    }

    if (options.mfaService && request.method === "GET" && segments.length === 3 && segments[0] === "auth" && segments[1] === "mfa" && segments[2] === "methods") {
      writeResponse(response, 200, traceId, { items: await options.mfaService.listCredentials(userId) });
      return;
    }

    if (options.mfaService && request.method === "POST" && segments.length === 4 && segments[0] === "auth" && segments[1] === "mfa" && segments[2] === "totp" && segments[3] === "enroll") {
      const data = requireObject(body);
      const passwordValid = relationalAuth
        ? await relationalAuth.verifyCurrentPassword(userId, typeof data.password === "string" ? data.password : "")
        : typeof data.password === "string" && system.verifyCurrentPassword(userId, data.password);
      if (!passwordValid) {
        throw unauthorized("Current password is invalid.");
      }
      const credentials = await options.mfaService.listCredentials(userId);
      if (credentials.some((credential) => credential.status === "ACTIVE")) {
        await verifyMfaLifecycleChallenge(options.mfaService, request, userId, data, "MFA_FACTOR_CHANGE");
      }
      const user = relationalAuth
        ? await relationalAuth.getUser(userId)
        : system.getUser(userId);
      writeResponse(response, 201, traceId, await options.mfaService.beginTotpEnrollment({
        customerId: userId,
        email: user.email,
        displayName: typeof data.displayName === "string" ? data.displayName : undefined,
      }));
      return;
    }

    if (options.mfaService && request.method === "POST" && segments.length === 4 && segments[0] === "auth" && segments[1] === "mfa" && segments[2] === "totp" && segments[3] === "confirm") {
      const data = requireObject(body);
      const confirmation = await options.mfaService.confirmTotpEnrollment({
        customerId: userId,
        credentialId: data.credentialId as string,
        code: data.code as string,
      });
      if (relationalAuth) await relationalAuth.revokeAllSessions(userId);
      else system.revokeAllSessions(userId);
      writeResponse(response, 200, traceId, confirmation);
      return;
    }

    if (options.mfaService && request.method === "DELETE" && segments.length === 4 && segments[0] === "auth" && segments[1] === "mfa" && segments[2] === "methods") {
      const data = body === undefined ? {} : requireObject(body);
      const passwordValid = relationalAuth
        ? await relationalAuth.verifyCurrentPassword(userId, typeof data.password === "string" ? data.password : "")
        : typeof data.password === "string" && system.verifyCurrentPassword(userId, data.password);
      if (!passwordValid) {
        throw unauthorized("Current password is invalid.");
      }
      const credentials = await options.mfaService.listCredentials(userId);
      if (credentials.some((credential) => credential.status === "ACTIVE")) {
        await verifyMfaLifecycleChallenge(options.mfaService, request, userId, data, "MFA_FACTOR_REMOVAL");
      }
      await options.mfaService.revokeCredential(userId, segments[3]);
      if (relationalAuth) await relationalAuth.revokeAllSessions(userId);
      else system.revokeAllSessions(userId);
      writeResponse(response, 204, traceId);
      return;
    }

    if (options.mfaService && request.method === "POST" && segments.length === 3 && segments[0] === "auth" && segments[1] === "mfa" && segments[2] === "recover") {
      const data = requireObject(body);
      const recovery = await options.mfaService.verifyRecoveryCode(userId, data.code as string);
      if (relationalAuth) await relationalAuth.revokeAllSessions(userId);
      else system.revokeAllSessions(userId);
      writeResponse(response, 202, traceId, { ...recovery, status: "RECOVERY_STARTED" });
      return;
    }

    if (options.mfaService && request.method === "POST" && segments.length === 4 && segments[0] === "auth" && segments[1] === "mfa" && segments[2] === "recover" && segments[3] === "verify") {
      const data = requireObject(body);
      const recovery = await options.mfaService.verifyRecoveryCode(userId, data.code as string);
      if (relationalAuth) await relationalAuth.revokeAllSessions(userId);
      else system.revokeAllSessions(userId);
      writeResponse(response, 202, traceId, { ...recovery, status: "RECOVERY_STARTED" });
      return;
    }

    if (options.mfaService && request.method === "POST" && segments.length === 4 && segments[0] === "auth" && segments[1] === "mfa" && segments[2] === "recover" && segments[3] === "complete") {
      const data = requireObject(body);
      if (typeof data.recoveryToken !== "string" || !data.recoveryToken.trim()) {
        throw invalidRequest("recoveryToken is required.");
      }
      await options.mfaService.completeRecovery({
        customerId: userId,
        recoveryToken: data.recoveryToken,
      });
      writeResponse(response, 202, traceId, { status: "RECOVERY_COMPLETED" });
      return;
    }

    if (options.mfaService && request.method === "POST" && segments.length === 4 && segments[0] === "auth" && segments[1] === "mfa" && segments[2] === "recovery-codes" && segments[3] === "rotate") {
      const data = requireObject(body);
      const passwordValid = relationalAuth
        ? await relationalAuth.verifyCurrentPassword(userId, typeof data.password === "string" ? data.password : "")
        : typeof data.password === "string" && system.verifyCurrentPassword(userId, data.password);
      if (typeof data.password === "string" && !passwordValid) {
        throw unauthorized("Current password is invalid.");
      }
      if (typeof data.challengeId !== "string" || typeof data.code !== "string") {
        throw invalidRequest("challengeId and code are required for recovery-code rotation.");
      }
      const result = await options.mfaService.verifyChallenge({
        challengeId: data.challengeId,
        customerId: userId,
        deviceId: requireDeviceId(request),
        proof: data.code,
        purpose: "RECOVERY_CODE_ROTATION",
      });
      if (result.customerId !== userId) {
        throw unauthorized("MFA user binding is invalid.");
      }
      if (relationalAuth) await relationalAuth.revokeAllSessions(userId);
      else system.revokeAllSessions(userId);
      writeResponse(response, 200, traceId, {
        status: "ROTATED",
        recoveryCodes: await options.mfaService.rotateRecoveryCodes(userId),
      });
      return;
    }

    if (options.mfaService && request.method === "POST" && segments.length === 4 && segments[0] === "auth" && segments[1] === "challenges" && segments[3] === "resend") {
      const data = requireObject(body);
      const user = relationalAuth
        ? await relationalAuth.getUser(userId)
        : system.getUser(userId);
      writeResponse(response, 200, traceId, await options.mfaService.resendChallenge({
        challengeId: segments[2],
        customerId: userId,
        deviceId: requireDeviceId(request),
        destination: user.email,
        networkFingerprint: getMfaClientAddress(request),
      }));
      return;
    }

    if (
      request.method === "POST" &&
      segments.length === 3 &&
      segments[0] === "auth" &&
      segments[1] === "otp" &&
      segments[2] === "challenges"
    ) {
      const data = requireObject(body);
      if (options.mfaService) {
        const supportedPurposes = new Set<PersistentStepUpPurpose>([
          "TRANSFER",
          "SAVINGS_OPENING",
          "CREDIT_APPLICATION",
          "CARD_ACTIVATION",
          "CREDIT_PAYMENT",
          "CARD_UNLOCK",
          "CARD_REPORT_LOST",
          "RECOVERY_CODE_ROTATION",
          "MFA_FACTOR_CHANGE",
          "MFA_FACTOR_REMOVAL",
        ]);
        if (typeof data.purpose !== "string" || !supportedPurposes.has(data.purpose as PersistentStepUpPurpose)) {
          throw invalidRequest("purpose is not supported for persistent TOTP step-up.");
        }
        const purpose = data.purpose as PersistentStepUpPurpose;
        const resourceId = typeof data.resourceId === "string" ? data.resourceId : null;
        const directTransferCutover = purpose === "TRANSFER" && resourceId && options.relationalHttp?.isRouteEnabled("POST", ["transfers"]);
        const directSavingsCutover = purpose === "SAVINGS_OPENING" && resourceId && options.relationalHttp?.isRouteEnabled("POST", ["savings", "deposits"]);
        const directCreditPaymentCutover = purpose === "CREDIT_PAYMENT" && resourceId && options.relationalHttp?.isRouteEnabled("POST", ["credit", "payments"]);
        const directCreditCardCutover = purpose === "CARD_UNLOCK" && resourceId && options.relationalHttp?.isRouteEnabled("POST", ["cards", resourceId, "unlock"]);
        const directCardLostCutover = purpose === "CARD_REPORT_LOST" && resourceId && options.relationalHttp?.isRouteEnabled("POST", ["cards", resourceId, "report-lost"]);
        const directCreditApplicationCutover = purpose === "CREDIT_APPLICATION" && options.relationalHttp?.isRouteEnabled("POST", ["credit", "applications"]);
        const directCreditActivationCutover = purpose === "CARD_ACTIVATION" && resourceId && options.relationalHttp?.isRouteEnabled("POST", ["credit", "applications", resourceId, "activate"]);
        const directMfaLifecycle = options.relationalHttp?.isRouteEnabled("POST", ["auth", "otp", "challenges"]) &&
          ["MFA_FACTOR_CHANGE", "MFA_FACTOR_REMOVAL", "RECOVERY_CODE_ROTATION"].includes(purpose);
        const requestFingerprint = directTransferCutover && options.relationalHttp
          ? await options.relationalHttp.getTransferStepUpRequestFingerprint(resourceId)
          : directSavingsCutover && options.relationalHttp
            ? await options.relationalHttp.getSavingsStepUpRequestFingerprint(resourceId)
            : directCreditPaymentCutover && options.relationalHttp
              ? await options.relationalHttp.getCreditPaymentStepUpRequestFingerprint(resourceId)
              : directCreditCardCutover
                ? fingerprint({ cardId: resourceId })
              : directCardLostCutover
                ? fingerprint({ cardId: resourceId, action: "REPORT_LOST" })
              : directCreditApplicationCutover
                  ? (typeof data.requestFingerprint === "string" ? data.requestFingerprint : null)
                  : directCreditActivationCutover
                    ? fingerprint({ applicationId: resourceId })
          : directMfaLifecycle
            ? (typeof data.requestFingerprint === "string" ? data.requestFingerprint : null)
            : system.getStepUpRequestFingerprint(
              purpose as OtpPurpose,
              resourceId,
              typeof data.requestFingerprint === "string" ? data.requestFingerprint : null,
            );
        const challenge = await options.mfaService.beginTotpChallenge({
          customerId: userId,
          deviceId: requireDeviceId(request),
          purpose,
          resourceId,
          requestFingerprint,
          networkFingerprint: getMfaClientAddress(request),
        });
        writeResponse(response, 201, traceId, {
          challengeId: challenge.challengeId,
          expiresAt: challenge.expiresAt,
          methods: ["TOTP"],
          method: "TOTP",
          purpose,
        });
        return;
      }
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
      writeResponse(response, 200, traceId, {
        accounts: relationalRoute && options.relationalHttp
          ? await options.relationalHttp.listAccounts(userId)
          : system.listAccounts(userId),
      });
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
      if (options.mfaService) {
        await verifyPersistentStepUp(
          options.mfaService,
          system,
          request,
          userId,
          data,
          "CREDIT_APPLICATION",
          null,
          system.getCreditApplicationRequestFingerprint(data.requestedLimit),
        );
      }
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
      if (options.mfaService) {
        await verifyPersistentStepUp(
          options.mfaService,
          system,
          request,
          userId,
          data,
          "CARD_ACTIVATION",
          segments[2],
        );
      }
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
      if (options.mfaService) {
        await verifyPersistentStepUp(
          options.mfaService,
          system,
          request,
          userId,
          data,
          "CARD_UNLOCK",
          segments[1],
        );
      }
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
      if (options.mfaService) {
        await verifyPersistentStepUp(
          options.mfaService,
          system,
          request,
          userId,
          data,
          "CREDIT_PAYMENT",
          typeof data.quoteId === "string" ? data.quoteId : null,
        );
      }
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
        accountNumber: relationalRoute && options.relationalHttp
          ? await options.relationalHttp.getAccountNumber(userId, segments[1])
          : system.getAccountNumber(userId, segments[1]),
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
      const result = relationalRoute && options.relationalHttp
        ? await options.relationalHttp.listTransactions(
          userId,
          segments[1],
          requestUrl.searchParams.get("cursor") ?? undefined,
          limit,
        )
        : system.listTransactions(
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
        relationalRoute && options.relationalHttp
          ? await options.relationalHttp.getTransaction(userId, segments[1], segments[3])
          : system.getTransaction(userId, segments[1], segments[3]),
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
      if (options.mfaService) {
        await verifyPersistentStepUp(
          options.mfaService,
          system,
          request,
          userId,
          data,
          "SAVINGS_OPENING",
          typeof data.quoteId === "string" ? data.quoteId : null,
        );
      }
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
      if (options.mfaService) {
        await verifyPersistentStepUp(
          options.mfaService,
          system,
          request,
          userId,
          data,
          "TRANSFER",
          typeof data.quoteId === "string" ? data.quoteId : null,
        );
      }
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
      options.logger?.log("info", "http_request_rejected", {
        requestId: context.requestId,
        traceId: context.traceId,
        method: (request.method ?? "GET").toUpperCase(),
        route: metricRoute(request),
        status: error.status,
        errorCode: error.code,
      });
      stateBoundary?.rejectDomainRequest();
      writeError(response, error.status, traceId, error);
      return;
    }
    if (error instanceof DatabaseCommandError) {
      options.logger?.log("error", "http_database_command_rejected", {
        requestId: context.requestId,
        traceId: context.traceId,
        method: (request.method ?? "GET").toUpperCase(),
        route: metricRoute(request),
        status: error.status,
        errorCode: error.code,
      });
      stateBoundary?.rejectDomainRequest();
      writeError(response, error.status, traceId, new DomainError(error.status, error.code, error.message));
      return;
    }

    const unexpected = error as {
      name?: unknown;
      code?: unknown;
      constraint?: unknown;
    };
    options.logger?.log("error", "http_request_failed", {
      requestId: context.requestId,
      traceId: context.traceId,
      method: (request.method ?? "GET").toUpperCase(),
      route: metricRoute(request),
      errorName: typeof unexpected.name === "string" ? unexpected.name : "unknown",
      errorCode: typeof unexpected.code === "string" ? unexpected.code : undefined,
      errorConstraint: typeof unexpected.constraint === "string" ? unexpected.constraint : undefined,
    });
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
  options: HttpOptions,
): Server {
  const metrics = options.metrics ?? new PrometheusRegistry();
  registerHttpMetrics(metrics);
  registerBusinessMetrics(metrics);
  const assistantConfig = resolveAssistantConfig(options.assistantConfig);
  const resolvedOptions: HttpOptions = {
    ...options,
    assistantConfig,
    assistantRateLimiter: options.assistantRateLimiter ?? new AssistantRateLimiter(assistantConfig),
    metrics,
    logger: options.logger ?? createStructuredLogger({ service: options.serviceName ?? "banking-reference-backend" }),
    serviceName: options.serviceName ?? "banking-reference-backend",
  };
  return createServer((request, response) => {
    void handleRequest(request, response, system, resolvedOptions, undefined, false, undefined, createRequestContext(request));
  });
}

export function createPersistentBankingServer(
  repository: {
    withState<T>(
      initialState: unknown,
      operation: RelationalStateOperation<T>,
      boundaryOptions?: RelationalStateBoundaryOptions,
    ): Promise<T>;
    healthCheck?: () => Promise<void>;
    poolMetrics?: () => DatabasePoolMetricSnapshot;
    businessHealthCheck?: () => Promise<{
      status: "ok" | "degraded";
      reconciliation: "ok" | "mismatch";
      outbox: "ok" | "degraded";
      pendingOutboxEvents: number;
    }>;
    customerAccessStatus?: (customerId: string) => Promise<"ACTIVE" | "LOCKED" | null>;
  },
  system = new BankingSystem(),
  options: HttpOptions,
): Server {
  const assistantConfig = resolveAssistantConfig(options.assistantConfig);
  const resolvedOptions: HttpOptions = {
    ...options,
    assistantConfig,
    assistantRateLimiter: options.assistantRateLimiter ?? new AssistantRateLimiter(assistantConfig),
    customerAccessStatus: options.customerAccessStatus ?? repository.customerAccessStatus?.bind(repository),
    readinessCheck: options.readinessCheck ?? repository.healthCheck?.bind(repository),
    businessHealthCheck: options.businessHealthCheck ?? repository.businessHealthCheck?.bind(repository),
    databaseMetrics: options.databaseMetrics ?? repository.poolMetrics?.bind(repository),
  };
  const metrics = resolvedOptions.metrics ?? new PrometheusRegistry();
  registerHttpMetrics(metrics);
  registerBusinessMetrics(metrics);
  resolvedOptions.metrics = metrics;
  resolvedOptions.logger = resolvedOptions.logger ?? createStructuredLogger({ service: resolvedOptions.serviceName ?? "banking-reference-backend" });
  resolvedOptions.serviceName = resolvedOptions.serviceName ?? "banking-reference-backend";
  resolvedOptions.instrumented = true;
  return createServer((request, response) => {
    const requestContext = createRequestContext(request);
    for (const [name, value] of Object.entries(requestContextHeaders(requestContext))) response.setHeader(name, value);
    instrumentResponse(request, response, resolvedOptions, requestContext);
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (request.method === "GET" && ["/livez", "/startupz", "/versionz", "/metrics"].includes(pathname)) {
      void handleRequest(request, response, system, resolvedOptions, undefined, false, undefined, requestContext);
      return;
    }
    if (
      request.method === "GET" &&
      (pathname === "/healthz" || pathname === "/readyz") &&
      repository.healthCheck
    ) {
      void repository
        .healthCheck()
        .then(() => handleRequest(request, response, system, resolvedOptions, undefined, false, undefined, requestContext))
        .catch(() => {
          const traceId = requestContext.requestId;
          writeError(
            response,
            503,
            traceId,
            new DomainError(503, "PERSISTENCE_UNAVAILABLE", "Persistent sandbox is temporarily unavailable."),
          );
        });
      return;
    }
    if (pathname.startsWith(`${API_PREFIX}/assistant`)) {
      void handleRequest(request, response, system, resolvedOptions, undefined, false, undefined, requestContext);
      return;
    }
    const traceId = getRequestId(request);
    const bufferedResponse = new BufferedResponse(response);
    void readJson(request)
      .then(async (parsedBody) => {
        const routeSegments = pathSegments(new URL(request.url ?? "/", "http://localhost").pathname.slice(API_PREFIX.length) || "/");
        const directRelationalRoute = resolvedOptions.relationalHttp?.isRouteEnabled(request.method, routeSegments) ?? false;
        if (directRelationalRoute) {
          await handleRequest(
            request,
            bufferedResponse as unknown as ServerResponse,
            system,
            resolvedOptions,
            parsedBody,
            true,
            undefined,
            requestContext,
          );
          return;
        }
        if (process.env.BANKING_PERSISTENCE_MODE?.trim() === "relational-v2") {
          writeError(bufferedResponse as unknown as ServerResponse, 503, requestContext.requestId, new DomainError(503, "RELATIONAL_ROUTE_NOT_CUTOVER", "This HTTP route is not part of the approved relational-v2 boundary."));
          return;
        }
        await repository.withState(system.exportState(), async (state) => {
          system.importState(state as never);
          const transactionStartState = system.exportState();
          const requestState = {
            disposition: "COMMIT_ALL" as RequestStateDisposition,
          };
          await handleRequest(
            request,
            bufferedResponse as unknown as ServerResponse,
            system,
            resolvedOptions,
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
            requestContext,
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
        }, { preservePersistentAuthState: Boolean(options.mfaService) });
      })
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

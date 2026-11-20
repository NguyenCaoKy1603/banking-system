import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { BankingSystem, type BankingSystemState } from "./bankingSystem.js";
import { DomainError, notFound } from "./errors.js";
import type {
  RelationalStateBoundaryOptions,
  RelationalStateOperation,
} from "./database/postgresRelationalRepository.js";
import type {
  PersistentMfaService,
} from "./mfa/persistentMfaService.js";
import type { EmailProviderHealth } from "./mfa/delivery.js";
import type { RuntimeMetadata } from "./runtimeMetadata.js";
import { createRequestContext, normalizeRequestId, requestContextHeaders, type RequestContext } from "./observability/requestContext.js";
import { createStructuredLogger, type StructuredLogger } from "./observability/logger.js";
import { PrometheusRegistry, registerBusinessMetrics, registerHttpMetrics, type DatabasePoolMetricSnapshot } from "./observability/metrics.js";
import type { RelationalHttpBoundary } from "./database/relationalHttpBoundary.js";
import {
  resolveAssistantConfig,
  type AssistantConfig,
  type AssistantHelpService,
  AssistantRateLimiter,
} from "./assistant/index.js";
import type {
  FinancialAdviceConfig,
  FinancialAdviceService,
} from "./financialAdvice/index.js";
import {
  writeResponse,
  writeTextResponse,
  writeError,
  readJson,
  BufferedResponse,
  header,
} from "./routes/httpUtils.js";
import {
  handleCorsMiddleware,
  requireBearer,
  verifyPersistentStepUp,
  pathSegments,
  isAuthenticatedRoute,
  handleHttpError,
  type PersistentStepUpPurpose,
  type RecipientLookupRateLimiter,
} from "./middlewares/index.js";
import {
  handleSystemRoute,
  runtimeMetadataFor,
  isStartupReady,
  recordBusinessHealth,
  collectRuntimeMetrics,
} from "./routes/systemRoutes.js";
import { handleAccountRoute } from "./routes/accountRoutes.js";
import { handleTransferRoute } from "./routes/transferRoutes.js";
import { handleSavingsRoute } from "./routes/savingsRoutes.js";
import { handleCardRoute } from "./routes/cardRoutes.js";
import { handleKycRoute } from "./routes/kycRoutes.js";
import { handleNotificationRoute } from "./routes/notificationRoutes.js";
import { handleAnomalyRoute } from "./routes/anomalyRoutes.js";
import { handleAssistantRoute } from "./routes/assistantRoutes.js";
import { handleMobileRoute } from "./routes/mobileRoutes.js";
import {
  handlePublicAuthRoute,
  handleAuthenticatedMfaRoute,
} from "./routes/authRoutes.js";

export {
  writeResponse,
  writeTextResponse,
  writeError,
  handleSystemRoute,
  runtimeMetadataFor,
  isStartupReady,
  recordBusinessHealth,
  collectRuntimeMetrics,
  type PersistentStepUpPurpose,
};

const API_PREFIX = "/api/v1";

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
  /** Optional financial advice configuration */
  financialAdviceConfig?: Partial<FinancialAdviceConfig>;
  /** Optional preconfigured financial advice service */
  financialAdviceService?: FinancialAdviceService;
  /** Optional rate limiter instance for recipient lookup requests */
  lookupRateLimiter?: RecipientLookupRateLimiter;
  /** HMAC key for registration network fingerprint; required at all runtimes. */
  registrationFingerprintKey: Buffer;
};

export type RequestStateDisposition =
  | "COMMIT_ALL"
  | "COMMIT_SECURITY_ONLY"
  | "ROLLBACK_ALL";

export type RequestStateBoundary = {
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

  // CORS middleware: handles origins and OPTIONS preflight
  if (handleCorsMiddleware(request, response, options.allowedOrigins, traceId)) {
    return;
  }

  try {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const systemHandled = await handleSystemRoute(
      request,
      response,
      requestUrl,
      options,
      system,
      traceId,
    );
    if (systemHandled) {
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
        requireBearer,
      );
      return;
    }

    const body = bodyAlreadyRead ? parsedBody : await readJson(request);
    const publicAuthHandled = await handlePublicAuthRoute(
      request,
      response,
      segments,
      body,
      options,
      system,
      traceId,
      requireBearer,
    );
    if (publicAuthHandled) {
      return;
    }

    const mobileHandled = await handleMobileRoute(
      request,
      response,
      segments,
      options,
      system,
      traceId,
      requireBearer,
    );
    if (mobileHandled) {
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

    const accountHandled = await handleAccountRoute(
      request,
      response,
      requestUrl,
      segments,
      userId,
      relationalRoute,
      options,
      system,
      traceId,
    );
    if (accountHandled) {
      return;
    }

    const transferHandled = await handleTransferRoute(
      request,
      response,
      segments,
      body,
      userId,
      relationalRoute,
      options,
      system,
      traceId,
      verifyPersistentStepUp,
    );
    if (transferHandled) {
      return;
    }

    const cardHandled = await handleCardRoute(
      request,
      response,
      requestUrl,
      segments,
      body,
      userId,
      relationalRoute,
      options,
      system,
      traceId,
      verifyPersistentStepUp,
    );
    if (cardHandled) {
      return;
    }

    const savingsHandled = await handleSavingsRoute(
      request,
      response,
      segments,
      body,
      userId,
      relationalRoute,
      options,
      system,
      traceId,
      verifyPersistentStepUp,
    );
    if (savingsHandled) {
      return;
    }

    const kycHandled = await handleKycRoute(
      request,
      response,
      segments,
      body,
      userId,
      relationalRoute,
      options,
      traceId,
    );
    if (kycHandled) {
      return;
    }

    const notificationHandled = await handleNotificationRoute(
      request,
      response,
      segments,
      userId,
      relationalRoute,
      options,
      system,
      traceId,
    );
    if (notificationHandled) {
      return;
    }

    const anomalyHandled = await handleAnomalyRoute(
      request,
      response,
      requestUrl,
      segments,
      body,
      userId,
      relationalRoute,
      options,
      system,
      traceId,
    );
    if (anomalyHandled) {
      return;
    }

    const mfaHandled = await handleAuthenticatedMfaRoute(
      request,
      response,
      segments,
      body,
      userId,
      relationalAuth,
      options,
      system,
      traceId,
    );
    if (mfaHandled) {
      return;
    }

    throw notFound("API route not found.");
  } catch (error: unknown) {
    handleHttpError(
      error,
      request,
      response,
      options,
      context,
      traceId,
      metricRoute(request),
      stateBoundary,
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
        const isCorsPreflight = request.method?.toUpperCase() === "OPTIONS";
        if (isCorsPreflight || directRelationalRoute) {
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

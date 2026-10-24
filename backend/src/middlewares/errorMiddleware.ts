import type { IncomingMessage, ServerResponse } from "node:http";
import { DomainError } from "../errors.js";
import { DatabaseCommandError } from "../database/commandErrors.js";
import { writeError } from "../routes/httpUtils.js";
import type { RequestContext } from "../observability/requestContext.js";
import type { HttpOptions, RequestStateBoundary } from "../http.js";

/**
 * Centralized HTTP Error Handling Middleware:
 * Maps DomainError, DatabaseCommandError, and unexpected errors to standard JSON error responses,
 * logs errors with trace context, and signals request state boundaries.
 */
export function handleHttpError(
  error: unknown,
  request: IncomingMessage,
  response: ServerResponse,
  options: HttpOptions,
  context: RequestContext,
  traceId: string,
  metricRoute: string,
  stateBoundary?: RequestStateBoundary,
): void {
  if (error instanceof DomainError) {
    options.logger?.log("info", "http_request_rejected", {
      requestId: context.requestId,
      traceId: context.traceId,
      method: (request.method ?? "GET").toUpperCase(),
      route: metricRoute,
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
      route: metricRoute,
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
    route: metricRoute,
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

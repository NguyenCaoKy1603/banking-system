import type { IncomingMessage, ServerResponse } from "node:http";
import { DomainError } from "../errors.js";
import { header, writeError, writeResponse } from "../routes/httpUtils.js";

/**
 * CORS Middleware: handles cross-origin headers, allowed origins verification,
 * and OPTIONS preflight responses.
 * Returns true if request was handled (either 403 denied or 204 preflight), false otherwise.
 */
export function handleCorsMiddleware(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: string[] | undefined,
  traceId: string,
): boolean {
  const configuredOrigins = allowedOrigins ?? ["*"];
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
    return true;
  }

  if (configuredOrigins.includes("*")) {
    response.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && configuredOrigins.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
  }

  response.setHeader("Vary", "Origin");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Idempotency-Key, X-Device-ID, X-Device-Name, X-Request-ID, traceparent, tracestate",
  );
  response.setHeader("Access-Control-Allow-Methods", "DELETE,GET,PATCH,POST,OPTIONS");

  if (request.method === "OPTIONS") {
    writeResponse(response, 204, traceId);
    return true;
  }

  return false;
}

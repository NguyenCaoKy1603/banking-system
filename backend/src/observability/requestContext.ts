import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

/** Correlation data is intentionally kept separate from metric dimensions. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

export type RequestContext = {
  requestId: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  traceparent: string;
  tracestate: string | null;
  startedAt: string;
};

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function validTraceId(value: string): boolean {
  return /^[0-9a-f]{32}$/i.test(value) && !/^0+$/.test(value);
}

function validSpanId(value: string): boolean {
  return /^[0-9a-f]{16}$/i.test(value) && !/^0+$/.test(value);
}

export function isValidRequestId(value: string | undefined): value is string {
  return value !== undefined && REQUEST_ID_PATTERN.test(value);
}

export function normalizeRequestId(value: string | undefined, prefix = "backend"): string {
  const candidate = value?.trim();
  if (isValidRequestId(candidate)) return candidate;
  return `${prefix}-${randomUUID()}`.slice(0, 64);
}

export function createRequestContext(request: IncomingMessage, prefix = "backend"): RequestContext {
  const requestId = normalizeRequestId(header(request, "x-request-id"), prefix);
  const incomingTraceparent = header(request, "traceparent")?.trim();
  const parsed = incomingTraceparent ? TRACEPARENT_PATTERN.exec(incomingTraceparent) : null;
  const traceId = parsed && validTraceId(parsed[1]!) ? parsed[1]!.toLowerCase() : hex(16);
  const parentSpanId = parsed && validSpanId(parsed[2]!) ? parsed[2]!.toLowerCase() : null;
  const spanId = hex(8);
  const flags = parsed?.[3] && /^[0-9a-f]{2}$/i.test(parsed[3]) ? parsed[3]!.toLowerCase() : "01";
  const tracestate = header(request, "tracestate")?.trim() || null;
  return {
    requestId,
    traceId,
    spanId,
    parentSpanId,
    traceparent: `00-${traceId}-${spanId}-${flags}`,
    tracestate,
    startedAt: new Date().toISOString(),
  };
}

export function requestContextHeaders(context: RequestContext): Record<string, string> {
  return {
    "X-Request-ID": context.requestId,
    "X-Trace-ID": context.traceId,
    traceparent: context.traceparent,
    ...(context.tracestate ? { tracestate: context.tracestate } : {}),
  };
}


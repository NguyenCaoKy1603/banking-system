import type { IncomingMessage, ServerResponse } from "node:http";
import { type DomainError, invalidRequest, unauthorized } from "../errors.js";

export function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function requireObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalidRequest("Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

export function requireDeviceId(request: IncomingMessage): string {
  const deviceId = header(request, "x-device-id");
  if (!deviceId?.trim()) {
    throw unauthorized("Device binding is required.");
  }
  return deviceId.trim();
}

export function writeResponse(
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

export function writeTextResponse(
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

export function writeError(
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

export const MAX_BODY_BYTES = 1_000_000;

export async function readJson(request: IncomingMessage): Promise<unknown> {
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

export class BufferedResponse {
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

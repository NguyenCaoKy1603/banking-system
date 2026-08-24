export type ErrorClass = "RETRYABLE" | "PERMANENT" | "INVALID_ENDPOINT" | "CONFIGURATION";

export type ClassifiedError = {
  errorClass: ErrorClass;
  code: string;
  retryAfterMs: number | null;
  summary: string;
};

export class ProviderError extends Error {
  readonly status?: number;
  readonly code: string;
  readonly retryAfterMs?: number;
  readonly errorClass?: ErrorClass;

  constructor(message: string, options: {
    code?: string;
    status?: number;
    retryAfterMs?: number;
    errorClass?: ErrorClass;
  } = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = options.code ?? "PROVIDER_ERROR";
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.errorClass = options.errorClass;
  }
}

export function classifyProviderError(error: unknown): ClassifiedError {
  if (error instanceof ProviderError) {
    return {
      errorClass: error.errorClass ?? classifyStatus(error.status),
      code: error.code,
      retryAfterMs: error.retryAfterMs ?? null,
      summary: safeSummary(error.message),
    };
  }
  const candidate = error as { code?: unknown; status?: unknown; message?: unknown } | null;
  const status = typeof candidate?.status === "number" ? candidate.status : undefined;
  const code = typeof candidate?.code === "string" ? candidate.code : "PROVIDER_UNKNOWN";
  return {
    errorClass: classifyStatus(status),
    code,
    retryAfterMs: null,
    summary: safeSummary(typeof candidate?.message === "string" ? candidate.message : "Provider request failed."),
  };
}

function classifyStatus(status: number | undefined): ErrorClass {
  if (status === 401 || status === 403) return "CONFIGURATION";
  if (status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500)) return "RETRYABLE";
  if (status !== undefined && status >= 400) return "PERMANENT";
  return "RETRYABLE";
}

function safeSummary(message: string): string {
  return message
    .replace(/(postgres(?:ql)?|https?):\/\/[^\s@]+@/gi, "$1://[redacted]@")
    .replace(/bearer\s+[^\s]+/gi, "bearer [redacted]")
    .replace(/(token|secret|password|api[-_ ]?key|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 300);
}

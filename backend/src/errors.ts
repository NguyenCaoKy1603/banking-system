export type FieldErrors = Record<string, string> | null;

export class DomainError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: FieldErrors;
  readonly retryAfterSeconds: number | null;

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors: FieldErrors = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "DomainError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function invalidRequest(
  message: string,
  fieldErrors: FieldErrors = null,
): DomainError {
  return new DomainError(422, "VALIDATION_ERROR", message, fieldErrors);
}

export function unauthorized(message = "Unauthorized."): DomainError {
  return new DomainError(401, "UNAUTHORIZED", message);
}

export function forbiddenWithCode(code: string, message: string): DomainError {
  return new DomainError(403, code, message);
}

export function notFound(message = "Resource not found."): DomainError {
  return new DomainError(404, "NOT_FOUND", message);
}

export function conflict(message: string): DomainError {
  return new DomainError(409, "CONFLICT", message);
}

export function conflictWithCode(code: string, message: string): DomainError {
  return new DomainError(409, code, message);
}

export function rateLimited(
  message = "Too many requests.",
  retryAfterSeconds: number | null = null,
): DomainError {
  return new DomainError(429, "RATE_LIMITED", message, null, retryAfterSeconds);
}

export type FieldErrors = Record<string, string> | null;

export class DomainError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: FieldErrors;

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors: FieldErrors = null,
  ) {
    super(message);
    this.name = "DomainError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
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

export function notFound(message = "Resource not found."): DomainError {
  return new DomainError(404, "NOT_FOUND", message);
}

export function conflict(message: string): DomainError {
  return new DomainError(409, "CONFLICT", message);
}

export function conflictWithCode(code: string, message: string): DomainError {
  return new DomainError(409, code, message);
}

export function rateLimited(message = "Too many requests."): DomainError {
  return new DomainError(429, "RATE_LIMITED", message);
}

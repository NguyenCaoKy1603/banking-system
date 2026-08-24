export class DatabaseCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "DatabaseCommandError";
  }
}

export class IdempotencyConflictError extends DatabaseCommandError {
  constructor() {
    super(
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was reused with a different request.",
      409,
    );
  }
}

export class RelationalNotFoundError extends DatabaseCommandError {
  constructor(message: string) {
    super("NOT_FOUND", message, 404);
  }
}

export class RelationalConflictError extends DatabaseCommandError {
  constructor(code: string, message: string) {
    super(code, message, 409);
  }
}

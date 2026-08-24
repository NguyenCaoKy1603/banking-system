export type PostgresLikeError = {
  code?: string;
  constraint?: string;
  detail?: string;
  table?: string;
  column?: string;
};

export function isPostgresError(error: unknown): error is PostgresLikeError {
  return typeof error === "object" && error !== null && "code" in error;
}

export function postgresCode(error: unknown): string | undefined {
  return isPostgresError(error) ? error.code : undefined;
}

export function isSerializationFailure(error: unknown): boolean {
  return postgresCode(error) === "40001";
}

export function isDeadlockDetected(error: unknown): boolean {
  return postgresCode(error) === "40P01";
}

export function isRetryableTransactionError(error: unknown): boolean {
  return isSerializationFailure(error) || isDeadlockDetected(error);
}

export function isUniqueViolation(error: unknown): boolean {
  return postgresCode(error) === "23505";
}

export function isForeignKeyViolation(error: unknown): boolean {
  return postgresCode(error) === "23503";
}

export function isCheckViolation(error: unknown): boolean {
  return postgresCode(error) === "23514";
}

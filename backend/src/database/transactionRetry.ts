import { isRetryableTransactionError } from "./postgresErrors.js";

export type TransactionRetryOptions = {
  maxRetries?: number;
  retryDelayMs?: number;
  onRetry?: (attempt: number, error: unknown) => void;
};

/**
 * Retries only a complete database callback after PostgreSQL aborts the
 * transaction with serialization/deadlock. Never wrap external side effects
 * in this callback; the caller must use idempotency when commit visibility is
 * uncertain.
 */
export async function withTransactionRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: TransactionRetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 10;
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 2) {
    throw new Error("maxRetries must be an integer between 0 and 2.");
  }

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error: unknown) {
      if (!isRetryableTransactionError(error) || attempt >= maxRetries) {
        throw error;
      }
      options.onRetry?.(attempt + 1, error);
      if (retryDelayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }
}

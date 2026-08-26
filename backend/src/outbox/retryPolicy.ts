export type RetryPolicyOptions = {
  baseDelayMs: number;
  capDelayMs: number;
  maximumAttempts: number;
  random?: () => number;
};

export function fullJitterDelayMs(attempt: number, options: RetryPolicyOptions): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error("attempt must be a positive integer");
  const maximum = Math.min(
    options.capDelayMs,
    options.baseDelayMs * 2 ** Math.max(0, attempt - 1),
  );
  const random = options.random ?? Math.random;
  return Math.floor(Math.max(0, Math.min(1, random())) * maximum);
}

export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value?.trim()) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, timestamp - now);
}

export function retryDefaultsFromEnv(): RetryPolicyOptions {
  const positive = (name: string, fallback: number): number => {
    const value = process.env[name]?.trim();
    if (!value) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
    return parsed;
  };
  return {
    baseDelayMs: positive("OUTBOX_RETRY_BASE_MS", 5_000),
    capDelayMs: positive("OUTBOX_RETRY_CAP_MS", 900_000),
    maximumAttempts: positive("OUTBOX_MAX_ATTEMPTS", 8),
  };
}

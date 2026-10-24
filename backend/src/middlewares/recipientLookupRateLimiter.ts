import { rateLimited } from "../errors.js";

export type RecipientLookupRateLimiterOptions = {
  rateLimitPerMinute?: number;
  now?: () => number;
};

export class RecipientLookupRateLimiter {
  private readonly rateLimitPerMinute: number;
  private readonly now: () => number;
  private readonly userRequestTimestamps = new Map<string, number[]>();

  constructor(options?: RecipientLookupRateLimiterOptions) {
    this.rateLimitPerMinute = options?.rateLimitPerMinute ?? 15;
    this.now = options?.now ?? (() => Date.now());
  }

  acquire(userId: string): void {
    const currentTime = this.now();
    const windowStart = currentTime - 60_000;
    const timestamps = this.userRequestTimestamps.get(userId) ?? [];
    const validTimestamps = timestamps.filter((t) => t > windowStart);

    if (validTimestamps.length >= this.rateLimitPerMinute) {
      const oldestValid = validTimestamps[0] ?? currentTime;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldestValid + 60_000 - currentTime) / 1000));
      this.userRequestTimestamps.set(userId, validTimestamps);
      throw rateLimited("Bạn đã tra cứu người nhận quá nhiều lần. Vui lòng thử lại sau.", retryAfterSeconds);
    }

    validTimestamps.push(currentTime);
    this.userRequestTimestamps.set(userId, validTimestamps);
  }

  reset(): void {
    this.userRequestTimestamps.clear();
  }
}

export const defaultRecipientLookupRateLimiter = new RecipientLookupRateLimiter();

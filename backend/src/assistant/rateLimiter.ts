import { DomainError, rateLimited } from "../errors.js";

export const MAX_ASSISTANT_PROVIDER_CALLS_PER_SERVER_RUN = 10;

export type RateLimiterOptions = {
  rateLimitPerMinute: number;
  maxConcurrentRequests: number;
  maxConcurrentPerUser?: number;
  now?: () => number;
};

export class AssistantRateLimiter {
  private readonly rateLimitPerMinute: number;
  private readonly maxConcurrentRequests: number;
  private readonly maxConcurrentPerUser: number;
  private readonly now: () => number;

  private readonly userRequestTimestamps = new Map<string, number[]>();
  private readonly userActiveConcurrency = new Map<string, number>();
  private activeConcurrency = 0;
  private providerCallCount = 0;

  constructor(options: RateLimiterOptions) {
    this.rateLimitPerMinute = options.rateLimitPerMinute;
    this.maxConcurrentRequests = options.maxConcurrentRequests;
    this.maxConcurrentPerUser = options.maxConcurrentPerUser ?? options.maxConcurrentRequests;
    this.now = options.now ?? (() => Date.now());
  }

  acquire(userId: string): () => void {
    const currentTime = this.now();
    const windowStart = currentTime - 60_000;

    // 1. Kiểm tra giới hạn đồng thời toàn cục (Global Concurrency check)
    if (this.activeConcurrency >= this.maxConcurrentRequests) {
      throw rateLimited("Assistant service is busy with maximum concurrent requests. Please try again shortly.", 2);
    }

    // 2. Kiểm tra giới hạn đồng thời theo từng người dùng (Per-user Concurrency check)
    const userActive = this.userActiveConcurrency.get(userId) ?? 0;
    if (userActive >= this.maxConcurrentPerUser) {
      throw rateLimited("You already have an active assistant request in progress. Please wait for it to complete.", 2);
    }

    // 3. Dọn dẹp và kiểm tra tần suất người dùng (User Rate limit check)
    const timestamps = this.userRequestTimestamps.get(userId) ?? [];
    const validTimestamps = timestamps.filter((t) => t > windowStart);

    if (validTimestamps.length >= this.rateLimitPerMinute) {
      const oldestValid = validTimestamps[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldestValid + 60_000 - currentTime) / 1000));
      this.userRequestTimestamps.set(userId, validTimestamps);
      throw rateLimited("Too many assistant requests. Please wait before asking again.", retryAfterSeconds);
    }

    // 4. Tiêu thụ lượt gọi nguyên tử (không hoàn trả lượt đếm)
    validTimestamps.push(currentTime);
    this.userRequestTimestamps.set(userId, validTimestamps);

    this.activeConcurrency++;
    this.userActiveConcurrency.set(userId, userActive + 1);
    let released = false;

    return () => {
      if (!released) {
        released = true;
        this.activeConcurrency = Math.max(0, this.activeConcurrency - 1);
        const current = this.userActiveConcurrency.get(userId) ?? 1;
        if (current <= 1) {
          this.userActiveConcurrency.delete(userId);
        } else {
          this.userActiveConcurrency.set(userId, current - 1);
        }
      }
    };
  }

  consumeProviderCall(): void {
    if (this.providerCallCount >= MAX_ASSISTANT_PROVIDER_CALLS_PER_SERVER_RUN) {
      throw new DomainError(
        503,
        "ASSISTANT_UNAVAILABLE",
        "Assistant provider-call limit reached for this server run.",
      );
    }

    this.providerCallCount += 1;
  }

  getProviderCallCount(): number {
    return this.providerCallCount;
  }

  getActiveConcurrency(): number {
    return this.activeConcurrency;
  }

  getUserActiveConcurrency(userId: string): number {
    return this.userActiveConcurrency.get(userId) ?? 0;
  }

  reset(): void {
    this.userRequestTimestamps.clear();
    this.userActiveConcurrency.clear();
    this.activeConcurrency = 0;
    this.providerCallCount = 0;
  }
}

import type {
  DeliveryResult,
  EmailProviderHealth,
  VerificationCodeDeliveryInput,
  VerificationCodeDeliveryPort,
} from "./delivery.js";

export type HttpEmailProviderOptions = {
  endpoint: string;
  bearerToken?: string;
  timeoutMs: number;
  maxAttempts: number;
  retryDelayMs: number;
  fetchImpl?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
};

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "email-provider-timeout";
  if (error instanceof Error && error.name === "AbortError") return "email-provider-timeout";
  return "email-provider-network";
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Provider-neutral HTTP adapter. The local capture service (for example
 * Mailpit or a test HTTP inbox) and staging provider use the same contract.
 * The OTP is present only in the request body sent to the provider; this
 * class never logs it and never writes it to the outbox.
 */
export class HttpEmailProvider implements VerificationCodeDeliveryPort {
  private lastErrorCode: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (delayMs: number) => Promise<void>;

  constructor(private readonly options: HttpEmailProviderOptions) {
    const parsed = new URL(options.endpoint);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("EMAIL_PROVIDER_URL must use HTTP or HTTPS.");
    if (parsed.username || parsed.password) throw new Error("EMAIL_PROVIDER_URL must not contain credentials.");
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) throw new Error("EMAIL_PROVIDER_TIMEOUT_MS must be positive.");
    if (!Number.isInteger(options.maxAttempts) || options.maxAttempts <= 0) throw new Error("EMAIL_PROVIDER_MAX_ATTEMPTS must be positive.");
    if (!Number.isInteger(options.retryDelayMs) || options.retryDelayMs < 0) throw new Error("EMAIL_PROVIDER_RETRY_DELAY_MS must be non-negative.");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async send(input: VerificationCodeDeliveryInput): Promise<DeliveryResult> {
    let lastReason = "email-provider-network";
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const response = await this.fetchImpl(this.options.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.options.bearerToken ? { authorization: `Bearer ${this.options.bearerToken}` } : {}),
          },
          body: JSON.stringify({
            deliveryId: input.deliveryId,
            purpose: input.purpose,
            destination: input.destination,
            code: input.code,
            expiresAt: input.expiresAt,
          }),
          signal: controller.signal,
        });
        if (response.ok) {
          this.lastErrorCode = undefined;
          const providerMessageId = response.headers.get("x-provider-message-id") ?? undefined;
          return { status: "SENT", providerMessageId };
        }
        lastReason = `email-provider-http-${response.status}`;
        this.lastErrorCode = lastReason;
        if (!retryableStatus(response.status) || attempt >= this.options.maxAttempts) {
          return { status: "FAILED", reason: lastReason };
        }
      } catch (error) {
        lastReason = safeErrorCode(error);
        this.lastErrorCode = lastReason;
        if (attempt >= this.options.maxAttempts) return { status: "FAILED", reason: lastReason };
      } finally {
        clearTimeout(timeout);
      }
      const delay = this.options.retryDelayMs * 2 ** (attempt - 1);
      if (delay > 0) await this.sleep(delay);
    }
    return { status: "FAILED", reason: lastReason };
  }

  health(): EmailProviderHealth {
    return {
      provider: "http",
      status: this.lastErrorCode ? "degraded" : "ok",
      configured: true,
      credentialConfigured: Boolean(this.options.bearerToken),
      ...(this.lastErrorCode ? { lastErrorCode: this.lastErrorCode } : {}),
    };
  }
}

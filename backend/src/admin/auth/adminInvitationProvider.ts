import type { BankingRuntimeEnvironment } from "../../runtimeConfig.js";
import { referenceFor } from "../../secrets/runtimeSecrets.js";
import type { SecretProvider } from "../../secrets/SecretProvider.js";
import type { AdminRole } from "../authorization/permissionRegistry.js";

export type AdminInvitationDeliveryInput = {
  deliveryId: string;
  purpose: "STAFF_INVITATION";
  destination: string;
  displayName: string;
  role: AdminRole;
  invitationToken: string;
  activationUrl: string;
  expiresAt: string;
};

export type AdminInvitationDeliveryResult =
  | { status: "SENT"; providerMessageId?: string }
  | { status: "FAILED"; reason: string };

export type AdminInvitationProviderHealth = {
  provider: "http";
  status: "ok" | "degraded";
  configured: boolean;
  credentialConfigured: boolean;
  lastErrorCode?: string;
};

export interface AdminInvitationDeliveryPort {
  send(input: AdminInvitationDeliveryInput): Promise<AdminInvitationDeliveryResult>;
  health(): AdminInvitationProviderHealth;
}

export type HttpAdminInvitationProviderOptions = {
  endpoint: string;
  bearerToken?: string;
  timeoutMs: number;
  maxAttempts: number;
  retryDelayMs: number;
  allowedDomains?: ReadonlySet<string>;
  fetchImpl?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
};

export type RuntimeAdminInvitationProviderOptions = {
  environment: BankingRuntimeEnvironment;
  isProductionLike: boolean;
  secretProvider: SecretProvider;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
};

const LOCAL_CAPTURE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "mailpit", "mailhog", "invitation-capture"]);

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "invitation-provider-timeout";
  if (error instanceof Error && error.name === "AbortError") return "invitation-provider-timeout";
  return "invitation-provider-network";
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number, allowZero = false): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || (allowZero ? value < 0 : value <= 0)) throw new Error(`${name} must be ${allowZero ? "non-negative" : "positive"}.`);
  return value;
}

function parseEndpoint(value: string, productionLike: boolean): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("ADMIN_INVITATION_PROVIDER_URL must be a valid URL.");
  }
  if (!/^https?:$/.test(endpoint.protocol)) throw new Error("ADMIN_INVITATION_PROVIDER_URL must use HTTP or HTTPS.");
  if (endpoint.username || endpoint.password) throw new Error("ADMIN_INVITATION_PROVIDER_URL must not contain credentials.");
  if (productionLike && endpoint.protocol !== "https:") throw new Error("Staging and production-like invitation delivery requires HTTPS.");
  if (!productionLike && !LOCAL_CAPTURE_HOSTS.has(endpoint.hostname.toLowerCase())) {
    throw new Error("Local invitation delivery must target a loopback or local capture service host.");
  }
  return endpoint;
}

function parseDomains(value: string | undefined, productionLike: boolean): ReadonlySet<string> {
  const domains = new Set((value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
  if (productionLike && domains.size === 0) throw new Error("ADMIN_INVITATION_ALLOWED_DOMAINS is required for staging and production-like delivery.");
  return domains;
}

function assertDestination(destination: string, allowedDomains: ReadonlySet<string>): void {
  const normalized = destination.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  const domain = at > 0 ? normalized.slice(at + 1) : "";
  if (!domain || (allowedDomains.size > 0 && !allowedDomains.has(domain))) {
    throw new Error("Invitation destination is outside the configured test domain allowlist.");
  }
}

function assertActivationUrl(value: string, productionLike: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("ADMIN_INVITATION_ACTIVATION_URL must be a valid URL.");
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("ADMIN_INVITATION_ACTIVATION_URL must be an HTTP(S) URL without credentials.");
  if (productionLike && url.protocol !== "https:") throw new Error("Staging and production-like activation URLs require HTTPS.");
  return url.toString();
}

/**
 * Provider-neutral invitation adapter. The invitation token is sent only in
 * the HTTPS request body and is never logged, returned by health, or persisted
 * by this adapter. The receiver must not echo the token in its response.
 */
export class HttpAdminInvitationProvider implements AdminInvitationDeliveryPort {
  private lastErrorCode: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly allowedDomains: ReadonlySet<string>;

  constructor(private readonly options: HttpAdminInvitationProviderOptions) {
    const endpoint = new URL(options.endpoint);
    if (!/^https?:$/.test(endpoint.protocol)) throw new Error("ADMIN_INVITATION_PROVIDER_URL must use HTTP or HTTPS.");
    if (endpoint.username || endpoint.password) throw new Error("ADMIN_INVITATION_PROVIDER_URL must not contain credentials.");
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) throw new Error("ADMIN_INVITATION_PROVIDER_TIMEOUT_MS must be positive.");
    if (!Number.isInteger(options.maxAttempts) || options.maxAttempts <= 0) throw new Error("ADMIN_INVITATION_PROVIDER_MAX_ATTEMPTS must be positive.");
    if (!Number.isInteger(options.retryDelayMs) || options.retryDelayMs < 0) throw new Error("ADMIN_INVITATION_PROVIDER_RETRY_DELAY_MS must be non-negative.");
    this.allowedDomains = options.allowedDomains ?? new Set();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async send(input: AdminInvitationDeliveryInput): Promise<AdminInvitationDeliveryResult> {
    assertDestination(input.destination, this.allowedDomains);
    let lastReason = "invitation-provider-network";
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
            displayName: input.displayName,
            role: input.role,
            token: input.invitationToken,
            activationUrl: input.activationUrl,
            expiresAt: input.expiresAt,
          }),
          signal: controller.signal,
        });
        if (response.ok) {
          this.lastErrorCode = undefined;
          const providerMessageId = response.headers.get("x-provider-message-id") ?? undefined;
          return { status: "SENT", providerMessageId };
        }
        lastReason = `invitation-provider-http-${response.status}`;
        this.lastErrorCode = lastReason;
        if (!retryableStatus(response.status) || attempt >= this.options.maxAttempts) return { status: "FAILED", reason: lastReason };
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

  health(): AdminInvitationProviderHealth {
    return {
      provider: "http",
      status: this.lastErrorCode ? "degraded" : "ok",
      configured: true,
      credentialConfigured: Boolean(this.options.bearerToken),
      ...(this.lastErrorCode ? { lastErrorCode: this.lastErrorCode } : {}),
    };
  }
}

/** Resolve local capture or managed staging credentials without exposing values. */
export async function createRuntimeAdminInvitationProvider(options: RuntimeAdminInvitationProviderOptions): Promise<HttpAdminInvitationProvider> {
  const env = options.env ?? process.env;
  // Invitation delivery has a distinct payload from OTP delivery; do not
  // silently route it to the OTP endpoint configured by EMAIL_PROVIDER_URL.
  const endpointValue = env.ADMIN_INVITATION_PROVIDER_URL?.trim();
  if (!endpointValue) throw new Error("ADMIN_INVITATION_PROVIDER_URL is required for Admin bootstrap delivery.");
  const endpoint = parseEndpoint(endpointValue, options.isProductionLike);
  const allowedDomains = parseDomains(env.ADMIN_INVITATION_ALLOWED_DOMAINS, options.isProductionLike);
  let bearerToken = env.ADMIN_INVITATION_PROVIDER_TOKEN?.trim() || env.EMAIL_PROVIDER_TOKEN?.trim() || undefined;
  if (options.isProductionLike) {
    const secret = await options.secretProvider.getSecret(referenceFor("emailProviderToken", options.environment));
    bearerToken = secret.value.trim();
    if (!bearerToken) throw new Error("Managed email provider token is empty.");
  }
  return new HttpAdminInvitationProvider({
    endpoint: endpoint.toString(),
    bearerToken,
    timeoutMs: positiveInteger(env, "ADMIN_INVITATION_PROVIDER_TIMEOUT_MS", 5_000),
    maxAttempts: positiveInteger(env, "ADMIN_INVITATION_PROVIDER_MAX_ATTEMPTS", 3),
    retryDelayMs: positiveInteger(env, "ADMIN_INVITATION_PROVIDER_RETRY_DELAY_MS", 100, true),
    allowedDomains,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
  });
}

export function validateAdminInvitationActivationUrl(value: string, productionLike: boolean): string {
  return assertActivationUrl(value, productionLike);
}

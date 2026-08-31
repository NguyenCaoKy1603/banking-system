import nodemailer from "nodemailer";
import type { SendMailOptions } from "nodemailer";

import type {
  DeliveryResult,
  EmailProviderHealth,
  VerificationCodeDeliveryInput,
  VerificationCodeDeliveryPort,
} from "./delivery.js";

const GMAIL_SMTP_HOST = "smtp.gmail.com";
const GMAIL_SMTP_PORTS = new Set([465, 587]);

export type SmtpSendInfo = {
  messageId?: string;
  accepted?: Array<string | { address?: string }>;
  rejected?: Array<string | { address?: string }>;
};

/** Narrow seam used by tests so no test needs to connect to Gmail. */
export type SmtpTransport = {
  sendMail(options: SendMailOptions): Promise<SmtpSendInfo>;
};

export type SmtpEmailProviderOptions = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  timeoutMs: number;
  maxAttempts: number;
  retryDelayMs: number;
  transport?: SmtpTransport;
  sleep?: (delayMs: number) => Promise<void>;
};

function normalizeEmail(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalized)) {
    throw new Error(`${field} must be a valid email address.`);
  }
  return normalized;
}

function normalizePassword(value: string): string {
  // Google displays App Passwords with spaces; those spaces are formatting,
  // not part of the credential.
  const password = value.replace(/\s+/g, "");
  if (!password) throw new Error("SMTP credential is required.");
  return password;
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function errorProperty(error: unknown, property: string): unknown {
  if (!error || typeof error !== "object") return undefined;
  return (error as Record<string, unknown>)[property];
}

function safeFailure(error: unknown): { reason: string; retryable: boolean } {
  const code = String(errorProperty(error, "code") ?? "").toUpperCase();
  const responseCode = Number(errorProperty(error, "responseCode"));

  if (code === "EAUTH" || code === "EENVELOPE" || (Number.isInteger(responseCode) && responseCode >= 500)) {
    return { reason: "smtp-provider-rejected", retryable: false };
  }
  if (Number.isInteger(responseCode) && responseCode >= 400 && responseCode < 500) {
    return { reason: "smtp-provider-transient", retryable: true };
  }
  if (["ETIMEDOUT", "ESOCKET", "ECONNECTION", "ECONNRESET", "EPIPE", "ENETUNREACH", "EAI_AGAIN"].includes(code)) {
    return { reason: code === "ETIMEDOUT" ? "smtp-provider-timeout" : "smtp-provider-network", retryable: true };
  }
  // Unknown transport errors are retried only within the configured bound.
  // The caller still receives a safe, non-sensitive reason.
  return { reason: "smtp-provider-network", retryable: true };
}

function acceptedAddress(value: string | { address?: string }): string {
  return typeof value === "string" ? value.trim().toLowerCase() : String(value.address ?? "").trim().toLowerCase();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function registrationMessage(input: VerificationCodeDeliveryInput, from: string): SendMailOptions {
  const text = [
    "Xác nhận đăng ký tài khoản Banking Sandbox",
    "",
    `Mã xác nhận của bạn là: ${input.code}`,
    `Mã có hiệu lực đến: ${input.expiresAt}`,
    "",
    "Không chia sẻ mã này với bất kỳ ai. Nếu bạn không yêu cầu đăng ký, hãy bỏ qua email này.",
  ].join("\n");
  const html = [
    "<p>Xác nhận đăng ký tài khoản Banking Sandbox</p>",
    `<p>Mã xác nhận của bạn là: <strong>${escapeHtml(input.code)}</strong></p>`,
    `<p>Mã có hiệu lực đến: ${escapeHtml(input.expiresAt)}</p>`,
    "<p>Không chia sẻ mã này với bất kỳ ai. Nếu bạn không yêu cầu đăng ký, hãy bỏ qua email này.</p>",
  ].join("");
  return {
    from,
    to: input.destination,
    subject: "Mã xác nhận đăng ký tài khoản",
    text,
    html,
  };
}

/** Gmail SMTP adapter for small local/staging rehearsals. */
export class SmtpEmailProvider implements VerificationCodeDeliveryPort {
  private readonly transport: SmtpTransport;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly options: SmtpEmailProviderOptions;
  private lastErrorCode: string | undefined;

  constructor(options: SmtpEmailProviderOptions) {
    const host = options.host.trim().toLowerCase();
    const user = normalizeEmail(options.user, "SMTP_USER");
    const from = normalizeEmail(options.from, "SMTP_FROM");
    if (host !== GMAIL_SMTP_HOST) throw new Error("Gmail SMTP host must be smtp.gmail.com.");
    if (!GMAIL_SMTP_PORTS.has(options.port)) throw new Error("Gmail SMTP port must be 465 or 587.");
    if ((options.port === 465 && !options.secure) || (options.port === 587 && options.secure)) {
      throw new Error("Gmail SMTP TLS settings must use secure=true on port 465 or secure=false on port 587.");
    }
    if (from !== user) throw new Error("SMTP_FROM must match SMTP_USER for Gmail personal SMTP.");
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) throw new Error("EMAIL_PROVIDER_TIMEOUT_MS must be positive.");
    if (!Number.isInteger(options.maxAttempts) || options.maxAttempts <= 0) throw new Error("EMAIL_PROVIDER_MAX_ATTEMPTS must be positive.");
    if (!Number.isInteger(options.retryDelayMs) || options.retryDelayMs < 0) throw new Error("EMAIL_PROVIDER_RETRY_DELAY_MS must be non-negative.");

    const password = normalizePassword(options.password);
    this.options = { ...options, host, user, from, password };
    this.sleep = options.sleep ?? defaultSleep;
    this.transport = options.transport ?? nodemailer.createTransport({
      host,
      port: options.port,
      secure: options.secure,
      requireTLS: !options.secure,
      auth: { user, pass: password },
      connectionTimeout: options.timeoutMs,
      greetingTimeout: options.timeoutMs,
      socketTimeout: options.timeoutMs,
      tls: { minVersion: "TLSv1.2" },
    });
  }

  async send(input: VerificationCodeDeliveryInput): Promise<DeliveryResult> {
    const destination = normalizeEmail(input.destination, "email destination");
    let lastFailure = { reason: "smtp-provider-network", retryable: true };
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      try {
        const info = await this.transport.sendMail(registrationMessage({ ...input, destination }, this.options.from));
        const accepted = (info.accepted ?? []).map(acceptedAddress).filter(Boolean);
        const rejected = (info.rejected ?? []).map(acceptedAddress).filter(Boolean);
        if (rejected.includes(destination) || (Array.isArray(info.accepted) && accepted.length > 0 && !accepted.includes(destination))) {
          this.lastErrorCode = "smtp-provider-recipient-rejected";
          return { status: "FAILED", reason: this.lastErrorCode };
        }
        this.lastErrorCode = undefined;
        return {
          status: "SENT",
          providerMessageId: typeof info.messageId === "string" ? info.messageId : undefined,
        };
      } catch (error) {
        lastFailure = safeFailure(error);
        this.lastErrorCode = lastFailure.reason;
        if (!lastFailure.retryable || attempt >= this.options.maxAttempts) {
          return { status: "FAILED", reason: lastFailure.reason };
        }
      }
      const delay = this.options.retryDelayMs * 2 ** (attempt - 1);
      if (delay > 0) await this.sleep(delay);
    }
    return { status: "FAILED", reason: lastFailure.reason };
  }

  health(): EmailProviderHealth {
    return {
      provider: "smtp",
      status: this.lastErrorCode ? "degraded" : "ok",
      configured: true,
      credentialConfigured: true,
      ...(this.lastErrorCode ? { lastErrorCode: this.lastErrorCode } : {}),
    };
  }
}

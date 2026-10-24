import assert from "node:assert/strict";
import test from "node:test";

import { SmtpEmailProvider, type SmtpTransport } from "../mfa/smtpEmailProvider.js";

const input = {
  deliveryId: "delivery-1",
  purpose: "REGISTRATION_EMAIL_VERIFY",
  destination: "Person@example.com",
  code: "123456",
  expiresAt: "2026-08-26T00:05:00.000Z",
};

function options(overrides: Partial<ConstructorParameters<typeof SmtpEmailProvider>[0]> = {}) {
  return {
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    user: "banking.demo@gmail.com",
    password: "1234 5678 9012 3456",
    from: "banking.demo@gmail.com",
    timeoutMs: 100,
    maxAttempts: 2,
    retryDelayMs: 0,
    ...overrides,
  };
}

test("Gmail SMTP provider sends a registration message and exposes safe health", async () => {
  let message: Record<string, unknown> | undefined;
  const transport: SmtpTransport = {
    async sendMail(value) {
      message = value as Record<string, unknown>;
      return { messageId: "<smtp-message-1>", accepted: ["person@example.com"], rejected: [] };
    },
  };
  const provider = new SmtpEmailProvider(options({ transport }));

  assert.deepEqual(await provider.send(input), { status: "SENT", providerMessageId: "<smtp-message-1>" });
  assert.equal(message?.from, "banking.demo@gmail.com");
  assert.equal(message?.to, "person@example.com");
  assert.equal(message?.subject, "Mã xác nhận đăng ký tài khoản");
  assert.match(String(message?.text), /123456/);
  assert.match(String(message?.html), /123456/);
  assert.deepEqual(provider.health(), { provider: "smtp", status: "ok", configured: true, credentialConfigured: true });
});

test("Gmail SMTP retries bounded transient failures but does not retry authentication failures", async () => {
  let attempts = 0;
  const temporaryTransport: SmtpTransport = {
    async sendMail() {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error("temporary network failure"), { code: "ETIMEDOUT" });
      return { messageId: "<smtp-message-2>", accepted: ["person@example.com"] };
    },
  };
  const provider = new SmtpEmailProvider(options({ transport: temporaryTransport, maxAttempts: 2 }));
  assert.equal((await provider.send(input)).status, "SENT");
  assert.equal(attempts, 2);

  attempts = 0;
  const authTransport: SmtpTransport = {
    async sendMail() {
      attempts += 1;
      throw Object.assign(new Error("authentication failure"), { code: "EAUTH" });
    },
  };
  const failed = new SmtpEmailProvider(options({ transport: authTransport, maxAttempts: 3 }));
  assert.deepEqual(await failed.send(input), { status: "FAILED", reason: "smtp-provider-rejected" });
  assert.equal(attempts, 1);
  assert.equal(failed.health().lastErrorCode, "smtp-provider-rejected");
});

test("Gmail SMTP rejects recipient failures and unsafe connection settings", async () => {
  const rejected: SmtpTransport = {
    async sendMail() {
      return { messageId: "<smtp-message-3>", accepted: [], rejected: ["person@example.com"] };
    },
  };
  const provider = new SmtpEmailProvider(options({ transport: rejected }));
  assert.deepEqual(await provider.send(input), { status: "FAILED", reason: "smtp-provider-recipient-rejected" });

  assert.throws(() => new SmtpEmailProvider(options({ host: "smtp.example.com" })), /smtp\.gmail\.com/i);
  assert.throws(() => new SmtpEmailProvider(options({ port: 587, secure: true })), /TLS settings/i);
  assert.throws(() => new SmtpEmailProvider(options({ from: "other@gmail.com" })), /SMTP_FROM/i);
});

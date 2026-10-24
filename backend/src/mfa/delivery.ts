export type VerificationCodeDeliveryInput = {
  deliveryId: string;
  purpose: string;
  destination: string;
  code: string;
  expiresAt: string;
};

export type DeliveryResult =
  | { status: "SENT"; providerMessageId?: string }
  | { status: "FAILED"; reason: string };

export type EmailProviderHealth = {
  provider: "fake" | "disabled" | "http" | "smtp";
  status: "ok" | "disabled" | "degraded";
  configured: boolean;
  credentialConfigured: boolean;
  lastErrorCode?: string;
};

export interface VerificationCodeDeliveryPort {
  send(input: VerificationCodeDeliveryInput): Promise<DeliveryResult>;
  /** A redacted health snapshot; it must never include endpoint credentials. */
  health(): EmailProviderHealth;
}

/** In-memory provider for tests; it exposes messages to the test process only. */
export class FakeEmailProvider implements VerificationCodeDeliveryPort {
  readonly messages: VerificationCodeDeliveryInput[] = [];

  constructor(private readonly shouldFail = false) {}

  async send(input: VerificationCodeDeliveryInput): Promise<DeliveryResult> {
    if (this.shouldFail) {
      return { status: "FAILED", reason: "fake-provider-failure" };
    }
    this.messages.push({ ...input });
    return { status: "SENT", providerMessageId: `fake-${input.deliveryId}` };
  }

  health(): EmailProviderHealth {
    return { provider: "fake", status: "ok", configured: true, credentialConfigured: false };
  }

  latestCode(purpose?: string): string | undefined {
    return [...this.messages].reverse().find((message) => !purpose || message.purpose === purpose)?.code;
  }
}

export class NullEmailProvider implements VerificationCodeDeliveryPort {
  async send(_input: VerificationCodeDeliveryInput): Promise<DeliveryResult> {
    return { status: "FAILED", reason: "email-provider-not-configured" };
  }

  health(): EmailProviderHealth {
    return { provider: "disabled", status: "disabled", configured: false, credentialConfigured: false };
  }
}

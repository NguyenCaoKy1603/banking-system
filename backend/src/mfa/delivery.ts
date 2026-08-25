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

export interface VerificationCodeDeliveryPort {
  send(input: VerificationCodeDeliveryInput): Promise<DeliveryResult>;
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

  latestCode(purpose?: string): string | undefined {
    return [...this.messages].reverse().find((message) => !purpose || message.purpose === purpose)?.code;
  }
}

export class NullEmailProvider implements VerificationCodeDeliveryPort {
  async send(_input: VerificationCodeDeliveryInput): Promise<DeliveryResult> {
    return { status: "FAILED", reason: "email-provider-not-configured" };
  }
}

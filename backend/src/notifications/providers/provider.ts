import type { DeliveryRow } from "../../outbox/types.js";
import { EndpointCrypto } from "../endpointCrypto.js";
import { ProviderError } from "../../outbox/errorClassifier.js";

export type ProviderResult = {
  providerMessageId: string;
};

export type ProviderInput = {
  delivery: DeliveryRow;
  address: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
};

export interface PushProvider {
  readonly name: string;
  send(input: ProviderInput): Promise<ProviderResult>;
}

export interface EmailProvider {
  readonly name: string;
  send(input: ProviderInput & { recipient: string; templateKey: string; variables: Record<string, string> }): Promise<ProviderResult>;
}

export class DisabledPushProvider implements PushProvider {
  readonly name = "disabled";
  async send(): Promise<ProviderResult> {
    throw new ProviderError("Push provider is disabled.", { code: "PUSH_PROVIDER_DISABLED", errorClass: "PERMANENT" });
  }
}

export class DisabledEmailProvider implements EmailProvider {
  readonly name = "disabled";
  async send(): Promise<ProviderResult> {
    throw new ProviderError("Email provider is disabled.", { code: "EMAIL_PROVIDER_DISABLED", errorClass: "PERMANENT" });
  }
}

export class FakePushProvider implements PushProvider {
  readonly name = "fake";
  readonly calls: ProviderInput[] = [];
  constructor(private readonly outcome?: (input: ProviderInput) => ProviderResult | Error | Promise<ProviderResult | Error>) {}
  async send(input: ProviderInput): Promise<ProviderResult> {
    this.calls.push({ ...input, payload: { ...input.payload } });
    const result = await this.outcome?.(input);
    if (result instanceof Error) throw result;
    return result ?? { providerMessageId: `fake-push-${this.calls.length}` };
  }
}

export class FakeEmailProvider implements EmailProvider {
  readonly name = "fake";
  readonly calls: Array<ProviderInput & { recipient: string; templateKey: string; variables: Record<string, string> }> = [];
  constructor(private readonly outcome?: (input: ProviderInput & { recipient: string; templateKey: string; variables: Record<string, string> }) => ProviderResult | Error | Promise<ProviderResult | Error>) {}
  async send(input: ProviderInput & { recipient: string; templateKey: string; variables: Record<string, string> }): Promise<ProviderResult> {
    this.calls.push({ ...input, payload: { ...input.payload }, variables: { ...input.variables } });
    const result = await this.outcome?.(input);
    if (result instanceof Error) throw result;
    return result ?? { providerMessageId: `fake-email-${this.calls.length}` };
  }
}

export type ProviderSet = {
  push: PushProvider;
  email: EmailProvider;
  endpointCrypto: EndpointCrypto;
};

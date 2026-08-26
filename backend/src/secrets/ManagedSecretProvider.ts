import type { SecretProvider, SecretReference, SecretValue } from "./SecretProvider.js";

export interface ManagedSecretClient {
  getSecret(reference: SecretReference): Promise<SecretValue>;
}

/**
 * Provider-neutral seam for AWS/GCP/Azure/Vault adapters. The default
 * constructor deliberately fails closed: claiming `managed` without wiring a
 * real client would be worse than refusing to start.
 */
export class ManagedSecretProvider implements SecretProvider {
  constructor(private readonly client?: ManagedSecretClient) {}

  private requireClient(): ManagedSecretClient {
    if (!this.client) {
      throw new Error("Managed SecretProvider is not configured; choose a cloud provider and inject its client.");
    }
    return this.client;
  }

  async getSecret(reference: SecretReference): Promise<SecretValue> {
    if (reference.environment !== "staging" && reference.environment !== "production-like") {
      throw new Error("Managed SecretProvider accepts only staging or production-like references.");
    }
    const resolved = await this.requireClient().getSecret(reference);
    if (resolved.source !== "managed" || !resolved.version.trim() || !resolved.value?.trim()) {
      throw new Error(`Managed secret ${reference.secretId} did not return a managed version.`);
    }
    return resolved;
  }

  async getSecretVersion(reference: SecretReference): Promise<string> {
    return (await this.getSecret(reference)).version;
  }

  async refresh(reference: SecretReference): Promise<void> {
    await this.getSecret(reference);
  }
}
